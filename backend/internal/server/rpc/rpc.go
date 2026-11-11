// Package rpc: cổng tương thích POST /api/:fn - bản chuyển nguyên vẹn của dispatcher trong server/index.js.
// Giao diện hiện tại gọi POST /api/<tênHàm> với thân {"args":[...]} và nhận {"ok":true,"result":...}.
//
// Mỗi module đăng ký hàm của mình bằng Registry.Register; trùng tên là panic lúc khởi động
// (tên hàm API là duy nhất toàn hệ thống). Tính năng mới không thêm hàm ở đây mà khai route REST
// "chỉ bản Go" bằng Registry.RegisterGoRoute (ARCHITECTURE 10.4).
package rpc

import (
	"context"
	"fmt"
	"math"
	"runtime/debug"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/response"
)

// Perm: quyền gọi hàm. Kết hợp được: rpc.Admin|rpc.Super (hàm nằm trong cả ADMIN_FNS và SUPER_FNS).
type Perm uint8

const (
	Login  Perm = 0         // phải đăng nhập (mặc định)
	Public Perm = 1 << iota // không cần đăng nhập (PUBLIC_FNS) - bỏ qua mọi kiểm tra khác
	Admin                   // chỉ admin / super (ADMIN_FNS)
	Super                   // chỉ super (SUPER_FNS)
	// SelfAuth: CHỈ cho route chỉ bản Go - module tự xác thực bằng token riêng của nó (vd chat: access token JWT của
	// tài khoản chat, không phải phiên QS). Middleware phân quyền của QS không bao giờ chặn route này; module tự trả 401.
	SelfAuth
)

// Args: mảng args của request (req.body.args).
type Args []any

// Len: số tham số client gửi.
func (a Args) Len() int { return len(a) }

// Has: client có gửi tham số thứ i không.
func (a Args) Has(i int) bool { return i >= 0 && i < len(a) }

// Arg: tham số thứ i; thiếu -> nil.
func (a Args) Arg(i int) any {
	if a.Has(i) {
		return a[i]
	}
	return nil
}

// ArgU: tham số thứ i; thiếu -> jsval.Undefined (đúng như JS; cần khi hàm Node phân biệt undefined với null,
// vd tham số có giá trị mặc định hoặc Number(x) / String(x) trên tham số thiếu).
func (a Args) ArgU(i int) any {
	if a.Has(i) {
		return a[i]
	}
	return jsval.Undefined
}

// Str: String(x ?? "") - null / undefined thành chuỗi rỗng.
func (a Args) Str(i int) string { return jsval.Str(a.Arg(i)) }

// Num: Number(x) - thiếu tham số -> NaN (Number(undefined)), null -> 0.
func (a Args) Num(i int) float64 {
	if !a.Has(i) {
		return math.NaN()
	}
	return jsval.ToNumber(a[i])
}

// Map: tham số là object -> *omap.Map, ngược lại nil (đọc trên nil vẫn an toàn).
func (a Args) Map(i int) *omap.Map { return jsval.AsMap(a.Arg(i)) }

// Arr: tham số là mảng -> []any, ngược lại nil.
func (a Args) Arr(i int) []any { return jsval.AsArray(a.Arg(i)) }

// Bool: !!x.
func (a Args) Bool(i int) bool { return jsval.Truthy(a.Arg(i)) }

// Handler: một hàm API. actor là người đăng nhập (nil khi chưa đăng nhập - chỉ xảy ra với hàm Public);
// hàm nào bên Node nhận actor làm tham số đầu (ACTOR_FNS) thì dùng, không thì bỏ qua.
// ctx đã mang ngữ cảnh công ty (tenant.From) và không bị huỷ khi client ngắt kết nối.
type Handler func(ctx context.Context, a *actor.Actor, args Args) (any, error)

type entry struct {
	perm Perm
	h    Handler
}

// Registry: danh sách trắng các hàm client được phép gọi (REGISTRY của Node),
// cộng danh sách route REST "chỉ bản Go" (chỉ để tài liệu và test biết tới, không đi qua cổng /api/:fn).
type Registry struct {
	fns      map[string]entry
	goRoutes []GoRoute
}

// NewRegistry tạo registry rỗng.
func NewRegistry() *Registry { return &Registry{fns: map[string]entry{}} }

// Register đăng ký 1 hàm. Trùng tên (với hàm khác hoặc với route chỉ bản Go) / thiếu handler -> panic (server không khởi động).
func (r *Registry) Register(name string, perm Perm, h Handler) {
	if name == "" || h == nil {
		panic("rpc: đăng ký hàm thiếu tên hoặc thiếu handler: " + name)
	}
	if perm&SelfAuth != 0 { // cổng /api/:fn chỉ biết phiên QS
		panic("rpc: SelfAuth chỉ dùng cho route chỉ bản Go: " + name)
	}
	if _, dup := r.fns[name]; dup {
		panic("rpc: trùng tên hàm API: " + name)
	}
	for _, g := range r.goRoutes {
		if g.Name == name {
			panic("rpc: tên hàm API trùng tên route chỉ bản Go: " + name)
		}
	}
	r.fns[name] = entry{perm: perm, h: h}
}

// GoField: một tham số của route chỉ bản Go, dùng để dựng tài liệu /api-docs.json.
//   - In: "path" | "query" | "body" (body = một khoá của thân JSON object); cặp (In, Name) không được trùng
//   - In "path": Name phải là một tham số ":ten" của Path; luôn bắt buộc (Required bỏ qua), thiếu Type = string
//   - Type: kiểu OpenAPI (string, number, integer, boolean, object, array); rỗng = không ghi kiểu
type GoField struct {
	Name, In, Type, Desc string
	Required             bool
}

// GoRoute: route REST "chỉ bản Go" dưới /api/v1 - tính năng mới không có hàm /api/:fn tương ứng
// (ARCHITECTURE 10.4). Module khai bằng Registry.RegisterGoRoute trong RegisterRPC và tự gắn route gin
// cùng Method + Path trong RegisterRoutes, với middleware khớp Perm (RequireLogin / RequireAdmin / RequireSuper /
// RequireAdminSuper; Public thì không gắn).
//   - Name: tên duy nhất (camelCase), không trùng hàm rpc nào; operationId trong tài liệu là v1go_<Name>
//   - Path: cú pháp gin, tính từ sau /api/v1 (vd /products/:key/private-copy)
//   - Tag: nhóm nghiệp vụ (vd "Sản phẩm"); tài liệu ghi "REST - <Tag> (chỉ bản Go)"
type GoRoute struct {
	Name, Method, Path string
	Perm               Perm
	Tag, Summary       string
	Fields             []GoField
}

var goMethods = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}

var goFieldIn = map[string]bool{"path": true, "query": true, "body": true}

// goPathParams: tên các tham số ":ten" của path gin theo thứ tự; ok = false khi có đoạn "*" (tài liệu không mô tả được),
// ":" không tên, hoặc tên trùng.
func goPathParams(p string) (names []string, ok bool) {
	seen := map[string]bool{}
	for _, seg := range strings.Split(p, "/") {
		if strings.HasPrefix(seg, "*") {
			return nil, false
		}
		if strings.HasPrefix(seg, ":") {
			n := seg[1:]
			if n == "" || seen[n] {
				return nil, false
			}
			seen[n] = true
			names = append(names, n)
		}
	}
	return names, true
}

// RegisterGoRoute khai 1 route chỉ bản Go. Thiếu tên / method lạ / path không bắt đầu bằng "/" (hoặc có "*",
// ":" không tên, tham số trùng) / In lạ / tham số trùng (In, Name) / tham số path không có trong Path,
// trùng Name, trùng Method + Path, hoặc Name trùng tên hàm rpc -> panic (server không khởi động).
func (r *Registry) RegisterGoRoute(g GoRoute) {
	if g.Name == "" || !goMethods[g.Method] || len(g.Path) == 0 || g.Path[0] != '/' {
		panic("rpc: route chỉ bản Go thiếu tên / method / path không hợp lệ: " + g.Name + " " + g.Method + " " + g.Path)
	}
	names, ok := goPathParams(g.Path)
	if !ok {
		panic("rpc: route chỉ bản Go " + g.Name + ": path không hợp lệ (có '*', ':' không tên hoặc tham số trùng): " + g.Path)
	}
	inPath := map[string]bool{}
	for _, n := range names {
		inPath[n] = true
	}
	seen := map[string]bool{}
	for _, f := range g.Fields {
		if f.Name == "" || !goFieldIn[f.In] {
			panic("rpc: route chỉ bản Go " + g.Name + ": tham số thiếu tên hoặc In không phải path/query/body: " + f.Name)
		}
		if seen[f.In+" "+f.Name] {
			panic("rpc: route chỉ bản Go " + g.Name + ": trùng tham số " + f.In + " " + f.Name)
		}
		seen[f.In+" "+f.Name] = true
		if f.In == "path" && !inPath[f.Name] {
			panic("rpc: route chỉ bản Go " + g.Name + ": tham số path " + f.Name + " không có trong Path " + g.Path)
		}
	}
	if _, dup := r.fns[g.Name]; dup {
		panic("rpc: route chỉ bản Go trùng tên hàm API: " + g.Name)
	}
	for _, x := range r.goRoutes {
		if x.Name == g.Name {
			panic("rpc: trùng tên route chỉ bản Go: " + g.Name)
		}
		if x.Method == g.Method && x.Path == g.Path {
			panic("rpc: trùng route chỉ bản Go: " + g.Method + " " + g.Path)
		}
	}
	g.Fields = append([]GoField(nil), g.Fields...)
	r.goRoutes = append(r.goRoutes, g)
}

// GoRoutes: các route chỉ bản Go theo thứ tự đăng ký (bản sao, sửa không ảnh hưởng registry).
func (r *Registry) GoRoutes() []GoRoute {
	out := make([]GoRoute, len(r.goRoutes))
	for i, g := range r.goRoutes {
		g.Fields = append([]GoField(nil), g.Fields...)
		out[i] = g
	}
	return out
}

// Has: hàm đã đăng ký chưa.
func (r *Registry) Has(name string) bool { _, ok := r.fns[name]; return ok }

// PermOf: quyền của hàm (ok = false nếu chưa đăng ký).
func (r *Registry) PermOf(name string) (Perm, bool) {
	e, ok := r.fns[name]
	return e.perm, ok
}

// Names: tên mọi hàm đã đăng ký, theo thứ tự chữ cái.
func (r *Registry) Names() []string {
	out := make([]string, 0, len(r.fns))
	for k := range r.fns {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Call gọi thẳng 1 hàm đã đăng ký (không kiểm quyền) - cho test và cho job nền.
func (r *Registry) Call(ctx context.Context, name string, a *actor.Actor, args ...any) (any, error) {
	e, ok := r.fns[name]
	if !ok {
		return nil, apperr.New("Không hỗ trợ hàm: " + name)
	}
	return e.h(ctx, a, Args(args))
}

// safeCall chạy handler, đổi panic thành lỗi (bên Node là exception bị try / catch của dispatcher bắt).
func safeCall(ctx context.Context, h Handler, a *actor.Actor, args Args) (res any, err error) {
	defer func() {
		if p := recover(); p != nil {
			logger.Error("api", "panic:", fmt.Sprint(p), "\n"+string(debug.Stack()))
			if e, ok := p.(error); ok {
				err = e
			} else {
				err = apperr.New(fmt.Sprint(p))
			}
		}
	}()
	return h(ctx, a, args)
}

// Handle trả gin handler cho POST /api/:fn. appVer là mã phiên bản đang chạy (header x-app-ver):
// đổi sau mỗi lần deploy -> trang đang mở biết mà nhắc tải lại.
func (r *Registry) Handle(sessions middleware.SessionResolver, appVer string) gin.HandlerFunc {
	return func(c *gin.Context) {
		fn := c.Param("fn")
		// Express: decodeURIComponent(param) hỏng (vd /api/%ff) -> 400 trước khi vào handler
		if !utf8.ValidString(fn) {
			response.HTMLError(c, 400, "Bad Request")
			return
		}
		c.Header("x-app-ver", appVer)
		e, ok := r.fns[fn]
		if !ok {
			response.Fail(c, 404, "Không hỗ trợ hàm: "+fn)
			return
		}
		// ---- Xác thực & phân quyền ----
		a := middleware.ActorOf(c, sessions)
		if c.IsAborted() { // kho phiên hỏng (vd chưa chạy migration 0014): ActorOf đã trả 500 kèm thông báo
			return
		}
		if e.perm&Public == 0 {
			if st, msg, code := middleware.Deny(a, e.perm&Admin != 0, e.perm&Super != 0); st != 0 {
				response.Fail(c, st, msg, code)
				return
			}
		}
		args, _ := middleware.BodyMap(c).Val("args").([]any)
		ctx := middleware.RequestContext(c.Request, a)
		result, err := safeCall(ctx, e.h, a, Args(args))
		if err != nil {
			logger.Error("api", fn+" lỗi:", err.Error())
			response.Fail(c, 500, apperr.Message(err))
			return
		}
		response.OK(c, result)
	}
}
