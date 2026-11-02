package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/response"
)

// newWiredServer: server với TOÀN BỘ module đã nối, không có database (không route nào trong test chạm tới DB).
func newWiredServer(t *testing.T, cfg *config.Config) *Server {
	t.Helper()
	if cfg == nil {
		cfg = &config.Config{}
	}
	dir := t.TempDir()
	cfg.StaticDir, cfg.VendorDir, cfg.AppVer = dir, dir, "ver-1"
	s := New(&Deps{Cfg: cfg})
	s.deps.Sessions.Set(fakeSessions{})
	return s
}

// fixture đọc tests/fixtures/<tên> (sinh từ mã Node trước khi gỡ app Node; đóng băng).
func fixture(t *testing.T, name string) *omap.Map {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return jsval.AsMap(v)
}

func strSet(v any) map[string]bool {
	out := map[string]bool{}
	for _, x := range jsval.AsArray(v) {
		out[jsval.Str(x)] = true
	}
	return out
}

// Registry của bản Go phải đúng bằng REGISTRY + PUBLIC_FNS / ADMIN_FNS / SUPER_FNS của server/index.js.
func TestRegistryParity(t *testing.T) {
	s := newWiredServer(t, nil)
	fx := fixture(t, "registry.json")
	pub, adm, sup := strSet(fx.Val("public")), strSet(fx.Val("admin")), strSet(fx.Val("super"))
	want := map[string]rpc.Perm{}
	var names []string
	for _, n := range jsval.AsArray(fx.Val("names")) {
		name := jsval.Str(n)
		names = append(names, name)
		var p rpc.Perm
		if pub[name] {
			p = rpc.Public
		} else {
			if adm[name] {
				p |= rpc.Admin
			}
			if sup[name] {
				p |= rpc.Super
			}
		}
		want[name] = p
	}
	if len(want) != 80 {
		t.Fatalf("registry.json có %d hàm, mong 80", len(want))
	}
	reg := s.deps.Reg
	for name, p := range want {
		got, ok := reg.PermOf(name)
		if !ok {
			t.Errorf("thiếu hàm %s", name)
		} else if got != p {
			t.Errorf("hàm %s: quyền %d, Node là %d", name, got, p)
		}
	}
	for _, name := range reg.Names() {
		if _, ok := want[name]; !ok {
			t.Errorf("thừa hàm %s (Node không có)", name)
		}
	}
	if n := len(reg.Names()); n != 80 {
		t.Errorf("registry Go có %d hàm, mong 80", n)
	}
	// thứ tự nhúng cho /api-docs phải là thứ tự REGISTRY hiện tại của Node
	_, order, _ := apiDocs()
	if strings.Join(order, ",") != strings.Join(names, ",") {
		t.Error("apidocs/meta.json lệch với REGISTRY của bản Node (registry Go đổi thứ tự hoặc meta.json bị sửa)")
	}
}

func routeSet(s *Server) map[string]bool {
	out := map[string]bool{}
	for _, r := range s.engine.Routes() {
		out[r.Method+" "+r.Path] = true
	}
	return out
}

// 9 route lẻ của Node phải có đủ, đúng method; bảng RootRoutes khớp với danh sách đọc từ server/index.js.
func TestRootRoutes(t *testing.T) {
	s := newWiredServer(t, nil)
	have := routeSet(s)
	fx := fixture(t, "registry.json")
	var node []string
	for _, r := range jsval.AsArray(fx.Val("routes")) {
		m := jsval.AsMap(r)
		node = append(node, jsval.Str(m.Val("method"))+" "+jsval.Str(m.Val("path")))
	}
	var mine []string
	for _, r := range RootRoutes {
		mine = append(mine, r[0]+" "+r[1])
	}
	if len(node) != 9 || strings.Join(node, "|") != strings.Join(mine, "|") {
		t.Errorf("RootRoutes lệch với server/index.js:\n node %v\n go   %v", node, mine)
	}
	for _, k := range node {
		if !have[k] {
			t.Errorf("thiếu route %s", k)
		}
	}
	// ngoài /api, /api/v1 và /api-docs không được có route nào khác
	known := map[string]bool{"POST /api/:fn": true, "GET /api-docs.json": true}
	for _, k := range node {
		known[k] = true
	}
	for k := range have {
		if !known[k] && !strings.Contains(k, " /api/v1/") {
			t.Errorf("route lạ: %s", k)
		}
	}
}

func hit(s *Server, method, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.engine.ServeHTTP(w, req)
	return w
}

// hitCancelled như hit nhưng context của request đã huỷ: handler thật (khi middleware cho qua) không tới được database
// hay dịch vụ ngoài (server test vốn không có DATABASE_URL).
func hitCancelled(s *Server, method, path, token string) *httptest.ResponseRecorder {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(method, path, strings.NewReader("{}")).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.engine.ServeHTTP(w, req)
	return w
}

// denyBodies: thân trả lời của middleware chặn quyền (401 / 403).
var denyBodies = map[string]bool{
	`{"error":"` + middleware.MsgNoAuth + `","code":"` + middleware.CodeNoAuth + `"}`: true,
	`{"error":"` + middleware.MsgAdminOnly + `"}`:                                     true,
	`{"error":"` + middleware.MsgSuperOnly + `"}`:                                     true,
}

// urlOf thay mọi tham số đường dẫn gin (:id) bằng "1".
func urlOf(path string) string {
	url := "/api/v1" + path
	for _, seg := range strings.Split(path, "/") {
		if strings.HasPrefix(seg, ":") {
			url = strings.Replace(url, seg, "1", 1)
		}
	}
	return url
}

const bodyNoAuth = `{"error":"Chưa đăng nhập","code":"NOAUTH"}`

// restProblems: mọi chỗ lệch giữa route /api/v1 module thật sự gắn với bảng RestRoutes + reg.GoRoutes().
//   - mỗi hàm rpc có đúng một route REST (PORTING_MAP mục A), chặn quyền đúng như cổng /api/:fn chặn hàm đó;
//   - mỗi route chỉ bản Go đã khai (reg.RegisterGoRoute) phải được module gắn, không trùng bảng RestRoutes,
//     và chặn quyền đúng Perm (401 NOAUTH, 403 chỉ Admin / chỉ quản trị hệ thống); token đủ quyền thì không bị
//     middleware chặn (bắt middleware chặt hơn Perm) - gọi bằng context đã huỷ, nên handler không chạm database;
//   - route /api/v1 ngoài bảng RestRoutes mà không khai là route chỉ bản Go -> lỗi.
//
// Route của bảng RestRoutes chỉ gọi khi chắc chắn bị chặn (đủ quyền thì handler thật sẽ chạm database).
func restProblems(s *Server) []string {
	var out []string
	bad := func(f string, a ...any) { out = append(out, fmt.Sprintf(f, a...)) }
	have := routeSet(s)
	reg := s.deps.Reg
	inTable := map[string]bool{}
	fns := map[string]bool{}
	for _, rt := range RestRoutes {
		key := rt.Method + " /api/v1" + rt.Path
		if inTable[key] {
			bad("bảng RestRoutes trùng route %s", key)
		}
		if fns[rt.Fn] {
			bad("bảng RestRoutes trùng hàm %s", rt.Fn)
		}
		inTable[key], fns[rt.Fn] = true, true
		if !have[key] {
			bad("hàm %s: module chưa đăng ký route %s", rt.Fn, key)
			continue
		}
		p, ok := reg.PermOf(rt.Fn)
		if !ok {
			bad("bảng RestRoutes có hàm lạ %s", rt.Fn)
			continue
		}
		url := urlOf(rt.Path)
		// chưa đăng nhập: cùng thân trả lời với cổng /api/:fn
		w := hit(s, rt.Method, url, "")
		if p&rpc.Public != 0 {
			if w.Code == 401 || w.Code == 403 || w.Code == 404 {
				bad("%s: route công khai mà trả %d", key, w.Code)
			}
			continue
		}
		if w.Code != 401 || w.Body.String() != bodyNoAuth {
			bad("%s chưa đăng nhập: %d %s", key, w.Code, w.Body.String())
		}
		switch {
		case p&rpc.Admin != 0:
			if w := hit(s, rt.Method, url, "u"); w.Code != 403 || w.Body.String() != `{"error":"Không có quyền (chỉ Admin)"}` {
				bad("%s nhân viên: %d %s", key, w.Code, w.Body.String())
			}
			if w := hit(s, "POST", "/api/"+rt.Fn, "u"); w.Code != 403 || w.Body.String() != `{"error":"Không có quyền (chỉ Admin)"}` {
				bad("rpc %s nhân viên: %d %s", rt.Fn, w.Code, w.Body.String())
			}
		case p&rpc.Super != 0:
			for _, tok := range []string{"u", "a"} {
				if w := hit(s, rt.Method, url, tok); w.Code != 403 || w.Body.String() != `{"error":"Chỉ quản trị hệ thống"}` {
					bad("%s token %s: %d %s", key, tok, w.Code, w.Body.String())
				}
				if w := hit(s, "POST", "/api/"+rt.Fn, tok); w.Code != 403 || w.Body.String() != `{"error":"Chỉ quản trị hệ thống"}` {
					bad("rpc %s token %s: %d %s", rt.Fn, tok, w.Code, w.Body.String())
				}
			}
		}
	}
	for _, name := range reg.Names() {
		if !fns[name] {
			bad("hàm %s chưa có route REST trong bảng RestRoutes", name)
		}
	}
	// route chỉ bản Go
	goKeys := map[string]bool{}
	for _, g := range reg.GoRoutes() {
		key := g.Method + " /api/v1" + g.Path
		goKeys[key] = true
		if inTable[key] {
			bad("route chỉ bản Go %s trùng route của bảng RestRoutes %s", g.Name, key)
			continue
		}
		if !have[key] {
			bad("route chỉ bản Go %s: module chưa gắn route %s", g.Name, key)
			continue
		}
		url := urlOf(g.Path)
		w := hit(s, g.Method, url, "")
		if g.Perm&rpc.Public != 0 {
			if w.Code == 401 || w.Code == 403 || w.Code == 404 {
				bad("%s: route chỉ bản Go công khai mà trả %d", key, w.Code)
			}
			continue
		}
		// SelfAuth (vd chat): module tự xác thực bằng token riêng - middleware QS không được chặn, dù có phiên QS hay không.
		// Module trả gì cũng được (401 CHAT_NOAUTH, 400, 503...) miễn route có thật và không phải thân chặn của QS.
		if g.Perm&rpc.SelfAuth != 0 {
			for _, tok := range []string{"", "u", "a", "s"} {
				if w := hitCancelled(s, g.Method, url, tok); w.Code == 404 || denyBodies[w.Body.String()] {
					bad("%s (SelfAuth) token %q: %d %s", key, tok, w.Code, w.Body.String())
				}
			}
			continue
		}
		if w.Code != 401 || w.Body.String() != bodyNoAuth {
			bad("%s chưa đăng nhập: %d %s", key, w.Code, w.Body.String())
		}
		for _, tok := range []string{"u", "a", "s"} {
			a, _ := fakeSessions{}.SessionActor(context.Background(), tok)
			st, msg, _ := middleware.Deny(a, g.Perm&rpc.Admin != 0, g.Perm&rpc.Super != 0)
			if st == 0 {
				if w := hitCancelled(s, g.Method, url, tok); (w.Code == 401 || w.Code == 403) && denyBodies[w.Body.String()] {
					bad("%s token %s đủ quyền mà bị middleware chặn: %d %s", key, tok, w.Code, w.Body.String())
				}
				continue
			}
			if w := hit(s, g.Method, url, tok); w.Code != st || w.Body.String() != `{"error":"`+msg+`"}` {
				bad("%s token %s: %d %s, mong %d %s", key, tok, w.Code, w.Body.String(), st, msg)
			}
		}
	}
	var extra []string
	for k := range have {
		if strings.Contains(k, " /api/v1/") && !inTable[k] && !goKeys[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(extra)
	if len(extra) > 0 {
		bad("route REST ngoài bảng RestRoutes và không khai là route chỉ bản Go: %v", extra)
	}
	if len(RestRoutes) != 80 {
		bad("bảng RestRoutes có %d dòng, mong 80", len(RestRoutes))
	}
	return out
}

func TestRestRoutes(t *testing.T) {
	for _, p := range restProblems(newWiredServer(t, nil)) {
		t.Error(p)
	}
}

// mountModule nối thêm 1 module vào server đã dựng, đúng như routes() nối module thật (group /api/v1 có Auth + Tenant).
func mountModule(s *Server, m Module) {
	m.RegisterRPC(s.deps.Reg)
	m.RegisterRoutes(s.engine.Group("/api/v1", middleware.Auth(s.deps.Sessions), middleware.Tenant()))
}

// fakeGoModule: module giả (chỉ có trong test) khai 3 route chỉ bản Go đủ 3 mức quyền và gắn route gin
// với middleware khớp Perm - mẫu đúng mà module thật làm theo (API.md mục "REST chỉ bản Go").
type fakeGoModule struct{}

var fakeGoRoutes = []rpc.GoRoute{
	{Name: "zzThuDuyet", Method: "POST", Path: "/zz-thu/:id/duyet", Perm: rpc.Admin, Tag: "Thử", Summary: "Route thử (chỉ admin)",
		Fields: []rpc.GoField{{Name: "id", In: "path", Desc: "Mã bản ghi"},
			{Name: "lyDo", In: "body", Type: "string", Required: true, Desc: "Lý do"}, {Name: "soLuong", In: "body", Type: "number"}}},
	{Name: "zzThuXem", Method: "GET", Path: "/zz-thu/:id", Perm: rpc.Login, Tag: "Thử", Summary: "Route thử (đăng nhập)",
		Fields: []rpc.GoField{{Name: "q", In: "query", Type: "string", Desc: "Từ khoá"}}},
	{Name: "zzThuXoa", Method: "DELETE", Path: "/zz-thu/:id", Perm: rpc.Super},
}

func (fakeGoModule) RegisterRPC(reg *rpc.Registry) {
	for _, g := range fakeGoRoutes {
		reg.RegisterGoRoute(g)
	}
}

func (fakeGoModule) RegisterRoutes(v1 *gin.RouterGroup) {
	ok := func(c *gin.Context) { response.OK(c, c.Param("id")) }
	v1.POST("/zz-thu/:id/duyet", middleware.RequireAdmin(), ok)
	v1.GET("/zz-thu/:id", middleware.RequireLogin(), ok)
	v1.DELETE("/zz-thu/:id", middleware.RequireSuper(), ok)
}

// leakyGoModule: khai route admin nhưng quên middleware, khai route đăng nhập mà gắn middleware admin,
// và gắn thêm 1 route không khai.
type leakyGoModule struct{}

func (leakyGoModule) RegisterRPC(reg *rpc.Registry) {
	reg.RegisterGoRoute(rpc.GoRoute{Name: "zzHo", Method: "POST", Path: "/zz-ho", Perm: rpc.Admin})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "zzChuaGan", Method: "GET", Path: "/zz-chua-gan", Perm: rpc.Login})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "zzQuaChat", Method: "GET", Path: "/zz-qua-chat/:code", Perm: rpc.Login})
}

func (leakyGoModule) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.POST("/zz-ho", middleware.RequireLogin(), func(c *gin.Context) { response.OK(c, nil) })
	v1.GET("/zz-qua-chat/:code", middleware.RequireAdmin(), func(c *gin.Context) { response.OK(c, nil) })
	v1.GET("/zz-khong-khai", middleware.RequireLogin(), func(c *gin.Context) { response.OK(c, nil) })
}

// selfAuthModule: 1 route SelfAuth tự trả 401 riêng (đúng), 1 route SelfAuth lại gắn RequireLogin của QS (sai).
type selfAuthModule struct{}

func (selfAuthModule) RegisterRPC(reg *rpc.Registry) {
	reg.RegisterGoRoute(rpc.GoRoute{Name: "zzRieng", Method: "GET", Path: "/zz-rieng/:id", Perm: rpc.SelfAuth, Tag: "Thử"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "zzRiengSai", Method: "GET", Path: "/zz-rieng-sai", Perm: rpc.SelfAuth})
}

func (selfAuthModule) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.GET("/zz-rieng/:id", func(c *gin.Context) { response.Fail(c, 401, "Phiên riêng hết hạn", "ZZ_NOAUTH") })
	v1.GET("/zz-rieng-sai", middleware.RequireLogin(), func(c *gin.Context) { response.OK(c, nil) })
}

// Route SelfAuth: không bị middleware QS chặn; gắn nhầm RequireLogin thì restProblems bắt được; tài liệu ghi 401 riêng.
func TestSelfAuthGoRoutes(t *testing.T) {
	s := newWiredServer(t, nil)
	mountModule(s, selfAuthModule{})
	probs := strings.Join(restProblems(s), "\n")
	if !strings.Contains(probs, `GET /api/v1/zz-rieng-sai (SelfAuth) token "": 401`) {
		t.Errorf("restProblems không bắt được route SelfAuth gắn RequireLogin:\n%s", probs)
	}
	if strings.Contains(probs, "/zz-rieng/") {
		t.Errorf("route SelfAuth đúng mà bị báo:\n%s", probs)
	}
	op, _ := omap.MarshalString(jsval.AsMap(jsval.AsMap(jsval.AsMap(BuildSpec(s.deps.Reg).Val("paths")).Val("/api/v1/zz-rieng/{id}")).Val("get")))
	for _, want := range []string{`Phiên chat riêng`, `CHAT_NOAUTH`, `"security":[{"bearerAuth":[]}]`} {
		if !strings.Contains(op, want) {
			t.Errorf("tài liệu route SelfAuth thiếu %s:\n%s", want, op)
		}
	}
}

// Cơ chế route chỉ bản Go: module giả qua được TestRestRoutes, có trong /api-docs.json, chặn quyền đúng Perm;
// module khai sai thì restProblems bắt được.
func TestGoRoutes(t *testing.T) {
	s := newWiredServer(t, nil)
	if n := len(s.deps.Reg.GoRoutes()); n != 0 {
		// khi module thật bắt đầu khai route chỉ bản Go, phần dưới vẫn đúng; dòng này chỉ ghi lại hiện trạng
		t.Logf("server thật có %d route chỉ bản Go", n)
	}
	before := len(s.deps.Reg.GoRoutes())
	mountModule(s, fakeGoModule{})
	if got := s.deps.Reg.GoRoutes(); len(got) != before+3 || got[before].Name != "zzThuDuyet" {
		t.Fatalf("GoRoutes: %+v", got)
	}
	for _, p := range restProblems(s) {
		t.Error(p)
	}
	if n := len(s.deps.Reg.Names()); n != 80 {
		t.Errorf("route chỉ bản Go không được thêm hàm rpc: %d hàm", n)
	}
	// đủ quyền thì vào handler
	for _, c := range []struct{ method, path, tok string }{
		{"POST", "/api/v1/zz-thu/7/duyet", "a"}, {"POST", "/api/v1/zz-thu/7/duyet", "s"},
		{"GET", "/api/v1/zz-thu/7", "u"}, {"DELETE", "/api/v1/zz-thu/7", "s"},
	} {
		if w := hit(s, c.method, c.path, c.tok); w.Code != 200 || w.Body.String() != `{"ok":true,"result":"7"}` {
			t.Errorf("%s %s token %s: %d %s", c.method, c.path, c.tok, w.Code, w.Body.String())
		}
	}
	// không có cổng /api/:fn cho route chỉ bản Go
	if w := hit(s, "POST", "/api/zzThuDuyet", "a"); w.Code != 404 {
		t.Errorf("/api/zzThuDuyet: %d, mong 404", w.Code)
	}

	// tài liệu
	spec := BuildSpec(s.deps.Reg)
	paths := jsval.AsMap(spec.Val("paths"))
	rest := 0
	paths.Each(func(k string, v any) {
		if strings.HasPrefix(k, "/api/v1/") {
			rest += jsval.AsMap(v).Len()
		}
	})
	if want := 80 + len(s.deps.Reg.GoRoutes()); rest != want {
		t.Errorf("spec có %d thao tác REST, mong %d", rest, want)
	}
	op := jsval.AsMap(jsval.AsMap(paths.Val("/api/v1/zz-thu/{id}/duyet")).Val("post"))
	if op == nil {
		t.Fatal("thiếu thao tác POST /api/v1/zz-thu/{id}/duyet")
	}
	got, _ := omap.MarshalString(op)
	for _, want := range []string{
		`"tags":["REST - Thử (chỉ bản Go)"]`, `"operationId":"v1go_zzThuDuyet"`, `"summary":"Route thử (chỉ admin)"`,
		`"security":[{"bearerAuth":[]}]`,
		`"parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"},"description":"Mã bản ghi"}]`,
		`"required":["lyDo"]`, `"lyDo":{"type":"string","description":"Lý do"}`, `"soLuong":{"type":"number"}`,
		`"401":`, `"403":`, `Chỉ Admin / super`, `Chỉ có ở bản Go`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("thao tác chỉ bản Go thiếu %s:\n%s", want, got)
		}
	}
	xem, _ := omap.MarshalString(jsval.AsMap(paths.Val("/api/v1/zz-thu/{id}")))
	for _, want := range []string{`"operationId":"v1go_zzThuXem"`, `{"name":"q","in":"query","required":false,"schema":{"type":"string"},"description":"Từ khoá"}`,
		`"operationId":"v1go_zzThuXoa"`, `"summary":"zzThuXoa"`, `"tags":["REST - Khác (chỉ bản Go)"]`, `Chỉ quản trị hệ thống (super)`} {
		if !strings.Contains(xem, want) {
			t.Errorf("/api/v1/zz-thu/{id} thiếu %s:\n%s", want, xem)
		}
	}
	if get := jsval.AsMap(jsval.AsMap(jsval.AsMap(paths.Val("/api/v1/zz-thu/{id}")).Val("get")).Val("responses")); get == nil || get.Has("403") || !get.Has("401") {
		t.Error("GET chỉ cần đăng nhập: phải có 401, không có 403")
	}
	tags, _ := omap.MarshalString(spec.Val("tags"))
	if !strings.Contains(tags, `{"name":"REST - Thử (chỉ bản Go)"}`) {
		t.Errorf("thiếu nhóm REST - Thử (chỉ bản Go): %s", tags)
	}
	desc := jsval.Str(jsval.AsMap(spec.Val("info")).Val("description"))
	if i, j := strings.LastIndex(desc, "\n\nMỗi hàm RPC"), strings.Index(desc, "chỉ bản Go"); i < 0 || j < i {
		t.Errorf("câu về route chỉ bản Go phải nằm sau đoạn 'Mỗi hàm RPC': %q", desc)
	}
	// server không có route chỉ bản Go: mô tả không nhắc tới
	if d := jsval.Str(jsval.AsMap(BuildSpec(newWiredServer(t, nil).deps.Reg).Val("info")).Val("description")); before == 0 && strings.Contains(d, "chỉ bản Go") {
		t.Error("chưa có route chỉ bản Go mà mô tả đã nhắc")
	}

	// module khai sai: thiếu middleware quyền, middleware chặt hơn Perm, route không khai, route khai mà chưa gắn
	s2 := newWiredServer(t, nil)
	mountModule(s2, leakyGoModule{})
	probs := strings.Join(restProblems(s2), "\n")
	for _, want := range []string{
		"POST /api/v1/zz-ho token u: 200",
		"GET /api/v1/zz-qua-chat/:code token u đủ quyền mà bị middleware chặn: 403",
		"route chỉ bản Go zzChuaGan: module chưa gắn route GET /api/v1/zz-chua-gan",
		"không khai là route chỉ bản Go: [GET /api/v1/zz-khong-khai]",
	} {
		if !strings.Contains(probs, want) {
			t.Errorf("restProblems không bắt được %q:\n%s", want, probs)
		}
	}
}

// Phần /api/<fn> + route lẻ của spec phải giống hệt spec do server/swagger.js dựng (tests/fixtures/swagger-node.json).
func TestSwaggerSpecNode(t *testing.T) {
	s := newWiredServer(t, nil)
	spec := BuildSpec(s.deps.Reg)
	node := fixture(t, "swagger-node.json")

	paths := jsval.AsMap(spec.Val("paths"))
	rest := 0
	nodePaths := omap.New()
	paths.Each(func(k string, v any) {
		if strings.HasPrefix(k, "/api/v1/") {
			rest += jsval.AsMap(v).Len()
			return
		}
		nodePaths.Set(k, v)
	})
	if want := 80 + len(s.deps.Reg.GoRoutes()); rest != want {
		t.Errorf("spec có %d thao tác REST, mong %d (80 + route chỉ bản Go)", rest, want)
	}
	if n := nodePaths.Len(); n != 89 {
		t.Errorf("spec có %d path RPC + route lẻ, mong 89", n)
	}
	var tags []any
	for _, x := range jsval.AsArray(spec.Val("tags")) {
		if !strings.HasPrefix(jsval.Str(jsval.AsMap(x).Val("name")), tagREST) {
			tags = append(tags, x)
		}
	}
	info := jsval.AsMap(spec.Val("info")).Clone()
	desc := jsval.Str(info.Val("description"))
	if i := strings.LastIndex(desc, "\n\nMỗi hàm RPC"); i > 0 {
		desc = desc[:i]
	}
	info.Set("description", desc)
	cut := spec.Clone().Set("info", info).Set("tags", tags).Set("paths", nodePaths)

	got, err := omap.MarshalString(cut)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := omap.MarshalString(node)
	if got != want {
		i := 0
		for i < len(got) && i < len(want) && got[i] == want[i] {
			i++
		}
		lo := max(0, i-120)
		t.Fatalf("spec lệch với Node tại byte %d:\n go   ...%s\n node ...%s", i, got[lo:min(len(got), i+200)], want[lo:min(len(want), i+200)])
	}
}

func TestSwaggerEnabled(t *testing.T) {
	for _, c := range []struct {
		docs, env string
		want      bool
	}{{"", "", true}, {"", "development", true}, {"", "production", false}, {"1", "production", true},
		{"0", "", false}, {"0", "production", false}, {"true", "production", false}, {"2", "", true}} {
		if got := swaggerEnabled(c.docs, c.env); got != c.want {
			t.Errorf("SWAGGER_DOCS=%q NODE_ENV=%q: %v, mong %v", c.docs, c.env, got, c.want)
		}
	}
	on := newWiredServer(t, nil)
	if !on.SwaggerOn() {
		t.Fatal("mặc định phải bật")
	}
	if w := hit(on, "GET", "/api-docs.json", ""); w.Code != 200 || !strings.HasPrefix(w.Body.String(), `{"openapi":"3.0.3"`) ||
		w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Errorf("/api-docs.json: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	if w := hit(on, "GET", "/api-docs?x=1", ""); w.Code != 301 || w.Header().Get("Location") != "/api-docs/?x=1" {
		t.Errorf("/api-docs: %d %s", w.Code, w.Header().Get("Location"))
	}
	if w := hit(on, "GET", "/api-docs/", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "<title>QS Pro API</title>") {
		t.Errorf("/api-docs/: %d", w.Code)
	}
	if w := hit(on, "GET", "/api-docs/swagger-ui-bundle.js", ""); w.Code != 200 || w.Body.Len() < 100000 {
		t.Errorf("swagger-ui-bundle.js: %d, %d byte", w.Code, w.Body.Len())
	}
	if w := hit(on, "GET", "/api-docs/swagger-ui.css", ""); w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/css") {
		t.Errorf("swagger-ui.css: %d %s", w.Code, w.Header().Get("Content-Type"))
	}
	off := newWiredServer(t, &config.Config{SwaggerDocs: "0"})
	if off.SwaggerOn() {
		t.Error("SWAGGER_DOCS=0 mà vẫn bật")
	}
	for _, p := range []string{"/api-docs", "/api-docs/", "/api-docs.json"} {
		if w := hit(off, "GET", p, ""); w.Code != http.StatusNotFound {
			t.Errorf("SWAGGER_DOCS=0 %s: %d", p, w.Code)
		}
	}
}
