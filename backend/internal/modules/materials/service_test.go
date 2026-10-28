package materials

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/goonly"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/specs"
	"qspro-backend/internal/shared/tenant"
)

// Mọi giá trị mong đợi trong testdata/*.json lấy bằng cách chạy mã Node thật (testdata/gen_unit.js, gen_diff.js).

func loadJSON(t *testing.T, name string) *omap.Map {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return jsval.AsMap(v)
}

// dlRawCols: cột thông số Điện lạnh (ngành chỉ bản Go). Khối raw của mọi sản phẩm có các cột này (rỗng) mà golden
// Node không có: bỏ khi rỗng trước khi so, nên ghi giá trị thật vào các cột này vẫn làm test báo khác.
var dlRawCols = func() []string {
	out := []string{}
	for _, lb := range specs.DL.All {
		out = append(out, specs.DL.MetricCol(lb))
	}
	return out
}()

func stripDL(v any) any { return goonly.StripEmpty(v, dlRawCols...) }

func js(v any) string {
	s, err := omap.MarshalString(v)
	if err != nil {
		return "LỖI MARSHAL: " + err.Error()
	}
	return s
}

var reISO = regexp.MustCompile(`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z`)

func tsNorm(s string) string { return reISO.ReplaceAllString(s, "<ts>") }

func arr(v any) []any { return jsval.AsArray(v) }

func eachCase(t *testing.T, pure *omap.Map, key string, fn func(c []any) (got, want string)) {
	t.Helper()
	cases := arr(pure.Val(key))
	if len(cases) == 0 {
		t.Fatalf("unit.json thiếu mục %s", key)
	}
	for i, c := range cases {
		if got, want := fn(arr(c)); got != want {
			t.Errorf("%s[%d] %s\n  go:   %s\n  node: %s", key, i, js(arr(c)[0]), got, want)
		}
	}
}

func TestPureGolden(t *testing.T) {
	pure := jsval.AsMap(loadJSON(t, "unit.json").Val("pure"))
	eachCase(t, pure, "prodToObj", func(c []any) (string, string) { return js(stripDL(prodToObj(jsval.AsMap(c[0])))), js(c[1]) })
	eachCase(t, pure, "dataToRow", func(c []any) (string, string) { return js(dataToRow(jsval.AsMap(c[0]))), js(c[1]) })
	eachCase(t, pure, "laCo", func(c []any) (string, string) {
		return js(dataToRow(omap.Of(nhanLapRoi, c[0])).Val("lap_nguon_roi")), js(c[1])
	})
	eachCase(t, pure, "fmtUnit", func(c []any) (string, string) { return fmtUnit(c[0], c[1].(string)), c[2].(string) })
	eachCase(t, pure, "fmtList", func(c []any) (string, string) { return fmtList(c[0], c[1].(string)), c[2].(string) })
	eachCase(t, pure, "fmtCutout", func(c []any) (string, string) { return fmtCutout(c[0]), c[1].(string) })
	eachCase(t, pure, "firstImg", func(c []any) (string, string) { return firstImg(c[0]), c[1].(string) })
	eachCase(t, pure, "parseItems", func(c []any) (string, string) { return js(parseItems(c[0])), js(c[1]) })
	eachCase(t, pure, "errs", func(c []any) (string, string) {
		e := errors.New(c[0].(string))
		got := []any{c[0], whoColMissingErr(e), comboMissing(e), btMissing(e),
			tblErr(e, "sp_yeu_thich").Error(), tblErr(e, "sp_combo").Error(), tblErr(e, "db_san_pham").Error()}
		return js(got), js(c)
	})
}

// ───────────── bản thế của các module khác (Deps), chạy trên cùng Repository với service ─────────────
// Mỗi bản thế phát đúng lệnh supa.* mà hàm Node tương ứng phát (audit A:59-69, getUserById A:212-215, permsArr_ A:72,
// notify_ A:451-454, getAdmins_ A:450) nên test phát lại lẫn test trên database thật đều so được từng lệnh / từng dòng.

type stubDeps struct{ repo Repository }

func (d stubDeps) Audit(ctx context.Context, a *actor.Actor, action, detail string, congTyID any) {
	row := omap.Of("user_id", actorUID(a), "username", actorName(a, ""), "action", action, "detail", detail)
	if jsval.Truthy(congTyID) {
		row.Set("cong_ty_id", congTyID)
	}
	_, _ = d.repo.InsertOne(ctx, "audit_log", row)
}

func (d stubDeps) GetByID(ctx context.Context, id any) (*omap.Map, error) {
	rows, err := d.repo.Select(ctx, "users", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1, NoScope: true})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (stubDeps) UserOut(row *omap.Map) *omap.Map { return row }

func (stubDeps) PermsArr(v any) []any {
	out := []any{}
	for _, x := range strings.Split(jsval.StrOr(v, ""), ",") {
		if x = jsval.Trim(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func (d stubDeps) Notify(ctx context.Context, userID any, kind, title, body string, refID any) {
	if !jsval.Truthy(userID) {
		return
	}
	_, _ = d.repo.InsertOne(ctx, "notifications", omap.Of("user_id", userID, "kind", kind, "title", title, "body", body,
		"ref_id", jsval.Or(refID, nil), "is_read", false))
}

func (d stubDeps) ActiveAdmins(ctx context.Context) ([]any, error) {
	rows, err := d.repo.Select(ctx, "users", database.SelectOpt{Filter: database.Eq("role", "admin")})
	if err != nil {
		return nil, err
	}
	out := []any{}
	for _, u := range rows {
		if u.Val("active") != false {
			out = append(out, u)
		}
	}
	return out, nil
}

// fakeUploader: bản thế của kho file - ghi lại lần tải, trả "URL:<path>" hoặc lỗi đặt sẵn.
type fakeUploader struct {
	rec  *omap.Map
	fail string
	buf  []byte
}

func (u *fakeUploader) Upload(_ context.Context, buf []byte, path, contentType string) (string, error) {
	u.buf = buf
	u.rec = omap.Of("len", float64(len(buf)), "path", path, "ct", contentType)
	if u.fail != "" {
		return "", errors.New(u.fail)
	}
	return "URL:" + path, nil
}

func newSvc(repo Repository, up *fakeUploader) (*Service, *rpc.Registry) {
	d := stubDeps{repo: repo}
	s := New(Deps{Repo: repo, Auditor: d, Users: d, UserFmt: d, Notifier: d, Admins: d, Uploader: up})
	reg := rpc.NewRegistry()
	s.RegisterRPC(reg)
	return s, reg
}

func ctxOf(v any) context.Context {
	m := jsval.AsMap(v)
	if m == nil { // tenant.run(null, fn)
		return context.Background()
	}
	return tenant.With(context.Background(), tenant.Ctx{UID: m.Val("uid"), Role: jsval.AsString(m.Val("role")),
		CongTyID: m.Val("congTyId"), ViewAs: m.Val("viewAs")})
}

func actorOf(v any) *actor.Actor {
	if m := jsval.AsMap(v); m != nil {
		return actor.FromMap(m)
	}
	return nil
}

func argAt(args []any, i int) any {
	if i < len(args) {
		return args[i]
	}
	return jsval.Undefined
}

// callFn: bảng hàm của testdata/noderef.js - tên trong REGISTRY đi qua cổng rpc của module, tên có $ gọi thẳng service.
func callFn(ctx context.Context, s *Service, reg *rpc.Registry, a *actor.Actor, fn string, args []any) (any, error) {
	switch fn {
	case "$saveDbProduct":
		return s.SaveDbProduct(ctx, actorOf(argAt(args, 0)), jsval.AsMap(argAt(args, 1)), jsval.AsMap(argAt(args, 2)))
	case "$deleteDbProduct":
		return s.DeleteDbProduct(ctx, actorOf(argAt(args, 0)), argAt(args, 1))
	case "$updateDbProductTracked":
		return s.UpdateDbProductTracked(ctx, actorOf(argAt(args, 0)), argAt(args, 1), argAt(args, 2), jsval.AsMap(argAt(args, 3)))
	case "$importCommit":
		return s.ImportCommit(ctx, actorOf(argAt(args, 0)), argAt(args, 1))
	case "$getProductsCached":
		return s.GetProductsCached(ctx)
	case "$getCatalogSheets":
		return s.GetCatalogSheets(ctx)
	case "$buildCatalog":
		return s.BuildCatalog(ctx)
	case "$uploadFileBuf":
		var buf []byte
		if n, ok := argAt(args, 0).(float64); ok {
			buf = bytes.Repeat([]byte{'A'}, int(n))
		}
		return s.UploadFileBuf(ctx, buf, argAt(args, 1), jsval.AsString(argAt(args, 2)))
	}
	return reg.Call(ctx, fn, a, args...)
}

var (
	reUpMs  = regexp.MustCompile(`(sp|docs)/\d+-`)
	reUpRnd = regexp.MustCompile(`sp/<ms>-\d+\.`)
)

func upNorm(s string) string {
	return reUpRnd.ReplaceAllString(reUpMs.ReplaceAllString(s, "${1}/<ms>-"), "sp/<ms>-<rnd>.")
}

// uploadImage / uploadFile / uploadFileBuf: tên file, đuôi, content-type, thông báo lỗi - so với Node từng ca.
func TestUploadGolden(t *testing.T) {
	cases := arr(loadJSON(t, "unit.json").Val("upload"))
	if len(cases) < 40 {
		t.Fatalf("chỉ có %d ca upload", len(cases))
	}
	for i, c := range cases {
		m := jsval.AsMap(c)
		up := &fakeUploader{fail: jsval.AsString(m.Val("fail"))}
		s, reg := newSvc(nil, up)
		res, err := callFn(context.Background(), s, reg, nil, m.Val("fn").(string), arr(m.Val("args")))
		got := omap.Of("fn", m.Val("fn"), "args", m.Val("args"), "fail", m.Val("fail"))
		if err != nil {
			got.Set("error", err.Error())
		} else {
			got.Set("result", res)
		}
		var rec any
		if up.rec != nil {
			rec = up.rec
		}
		got.Set("up", rec)
		if g, w := upNorm(js(got)), js(m); g != w {
			t.Errorf("upload[%d]\n  go:   %s\n  node: %s", i, g, w)
		}
	}
}

// ───────────── phát lại: từng lệnh supa.* của hàm Node phải khớp lệnh của bản Go ─────────────

type replayRepo struct {
	t     *testing.T
	name  string
	calls []any
	i     int
}

func nul(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (r *replayRepo) next(m, table string, a *omap.Map) ([]*omap.Map, error) {
	got := tsNorm(js(omap.Of("m", m, "table", table, "a", a)))
	if r.i >= len(r.calls) {
		r.t.Errorf("%s: Go phát thừa lệnh thứ %d: %s", r.name, r.i+1, got)
		return nil, errors.New("replay: thừa lệnh")
	}
	c := jsval.AsMap(r.calls[r.i])
	r.i++
	if want := js(omap.Of("m", c.Val("m"), "table", c.Val("table"), "a", c.Val("a"))); got != want {
		r.t.Errorf("%s: lệnh thứ %d khác\n  go:   %s\n  node: %s", r.name, r.i, got, want)
	}
	if e, ok := c.Val("err").(string); ok {
		return nil, errors.New(e)
	}
	rows := []*omap.Map{}
	for _, x := range arr(c.Val("ret")) {
		rows = append(rows, jsval.AsMap(x))
	}
	return rows, nil
}

func noScope(opt []database.Opt) bool { return len(opt) > 0 && opt[0].NoScope }

func rowsAny(rows []*omap.Map) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}

func (r *replayRepo) Select(_ context.Context, table string, opt ...database.SelectOpt) ([]*omap.Map, error) {
	var o database.SelectOpt
	if len(opt) > 0 {
		o = opt[0]
	}
	var limit any
	if o.Limit != 0 {
		limit = float64(o.Limit)
	}
	return r.next("select", table, omap.Of("select", nul(o.Select), "filter", nul(o.Filter), "order", nul(o.Order), "limit", limit, "noScope", o.NoScope))
}

func (r *replayRepo) Insert(_ context.Context, table string, rows []*omap.Map, opt ...database.Opt) ([]*omap.Map, error) {
	return r.next("insert", table, omap.Of("rows", rowsAny(rows), "noScope", noScope(opt)))
}

func (r *replayRepo) InsertOne(_ context.Context, table string, row *omap.Map, opt ...database.Opt) ([]*omap.Map, error) {
	return r.next("insert", table, omap.Of("rows", row, "noScope", noScope(opt)))
}

func (r *replayRepo) Update(_ context.Context, table, filter string, patch *omap.Map, opt ...database.Opt) ([]*omap.Map, error) {
	return r.next("update", table, omap.Of("filter", filter, "patch", patch, "noScope", noScope(opt)))
}

func (r *replayRepo) Remove(_ context.Context, table, filter string, opt ...database.Opt) ([]*omap.Map, error) {
	return r.next("remove", table, omap.Of("filter", filter, "noScope", noScope(opt)))
}

// TestFlowsReplay: mỗi ca của unit.json "flows" là một lần gọi hàm Node thật trên tầng supa giả, kèm nhật ký lệnh.
// Bản Go chạy cùng ca: phải phát ĐÚNG chuỗi lệnh đó (bảng, bộ lọc, dòng ghi, thứ tự khoá) và trả cùng kết quả / lỗi.
// Một service dùng xuyên suốt nên cache danh mục và cờ thiếu cột người tạo đi theo đúng thứ tự như bên Node.
func TestFlowsReplay(t *testing.T) {
	flows := arr(loadJSON(t, "unit.json").Val("flows"))
	if len(flows) < 100 {
		t.Fatalf("chỉ có %d ca", len(flows))
	}
	replayFlows(t, flows)
}

// replayFlows phát lại lần lượt các ca trên MỘT service mới (cache và cờ của service đi xuyên suốt các ca).
func replayFlows(t *testing.T, flows []any) {
	t.Helper()
	repo := &replayRepo{t: t}
	s, reg := newSvc(repo, &fakeUploader{})
	for _, f := range flows {
		m := jsval.AsMap(f)
		repo.name, repo.calls, repo.i = jsval.AsString(m.Val("name")), arr(m.Val("calls")), 0
		res, err := callFn(ctxOf(m.Val("ctx")), s, reg, actorOf(m.Val("actor")), m.Val("fn").(string), arr(m.Val("args")))
		if repo.i < len(repo.calls) {
			t.Errorf("%s: Go chỉ phát %d / %d lệnh; lệnh thiếu: %s", repo.name, repo.i, len(repo.calls), js(repo.calls[repo.i]))
		}
		if want, ok := m.Val("error").(string); ok {
			if err == nil || err.Error() != want {
				t.Errorf("%s: lỗi\n  go:   %v\n  node: %s", repo.name, err, want)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: Go báo lỗi %q, Node trả %s", repo.name, err.Error(), js(m.Val("result")))
			continue
		}
		if got, want := tsNorm(js(stripDL(res))), js(m.Val("result")); got != want {
			t.Errorf("%s: kết quả\n  go:   %s\n  node: %s", repo.name, got, want)
		}
	}
}

// TestCacheInvalidation: cache danh mục phải bị xoá sau MỖI chỗ ghi sản phẩm (9 chỗ gọi _cacheClear_ của Node:
// S:542, 556, 570, 653, 714, 793, 894, 947, 1074) - cho mọi công ty, không riêng công ty vừa ghi - và còn nguyên khi
// lệnh ghi dừng sớm hoặc chỉ đọc. testdata/cache.json (gen_cache.js) ghi lại hành vi của mã Node thật: mỗi nhóm là
// nạp cache c1 + super -> ghi -> c1 và super đọc lại; bản Go phải phát đúng chuỗi lệnh đó, tức là đọc lại database
// đúng những lần Node đọc lại.
func TestCacheInvalidation(t *testing.T) {
	spec := loadJSON(t, "cache.json")
	sum := arr(spec.Val("summary"))
	if len(sum) < 30 {
		t.Fatalf("chỉ có %d nhóm", len(sum))
	}
	// 9 nhóm đầu là 9 chỗ xoá cache: Node phải đọc lại ở cả hai công ty (nếu không thì file mẫu không còn kiểm được gì)
	for i, r := range sum[:9] {
		if x := arr(r); x[1] != true || x[2] != true {
			t.Errorf("nhóm %d (%v): Node không đọc lại danh mục sau khi ghi: %s", i, x[0], js(r))
		}
	}
	giu := 0
	for _, r := range sum[9:] {
		if arr(r)[1] == false {
			giu++
		}
	}
	if giu < 10 {
		t.Errorf("chỉ có %d nhóm giữ nguyên cache", giu)
	}
	replayFlows(t, arr(spec.Val("flows")))
}

// ───────────── đăng ký rpc + route ─────────────

func TestRPCNames(t *testing.T) {
	_, reg := newSvc(nil, nil)
	want := map[string]rpc.Perm{
		"getProducts": rpc.Login, "saveDbProduct": rpc.Login, "uploadImage": rpc.Login, "uploadFile": rpc.Login, "deleteDbProduct": rpc.Admin,
		"getDbProduct": rpc.Login, "updateDbProductTracked": rpc.Login, "setSpDuyet": rpc.Login, "setYeuThich": rpc.Login, "getCombo": rpc.Login,
		"setCombo": rpc.Login, "getBienThe": rpc.Login, "setBienThe": rpc.Login, "spMyPerms": rpc.Login, "getProductHistory": rpc.Login,
		"importParse": rpc.Login, "importCommit": rpc.Login, "requestDeleteProducts": rpc.Login, "listDeleteRequests": rpc.Admin,
		"resolveDeleteRequest": rpc.Admin,
	}
	if n := len(reg.Names()); n != len(want) {
		t.Errorf("đăng ký %d hàm rpc, muốn %d", n, len(want))
	}
	for name, perm := range want {
		if p, ok := reg.PermOf(name); !ok || p != perm {
			t.Errorf("%s: quyền %v (có = %v), muốn %v", name, p, ok, perm)
		}
	}
}

func testEngine(s *Service, a *actor.Actor) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(middleware.JSONBody(middleware.JSONBodyLimit))
	auth := func(c *gin.Context) {
		if c.GetHeader("Authorization") != "" {
			actor.Set(c, a)
		}
	}
	s.RegisterRoutes(e.Group("/api/v1", auth, middleware.Tenant()))
	s.RegisterRoot(e.Group("", auth, middleware.Tenant()))
	return e
}

func do(e *gin.Engine, method, path, ct string, body []byte, login bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	if login {
		req.Header.Set("Authorization", "Bearer x")
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

// Route REST: đúng đường dẫn của PORTING_MAP mục A; chưa đăng nhập -> 401 NOAUTH; route của admin chặn nhân viên.
func TestRESTRoutes(t *testing.T) {
	s, _ := newSvc(nil, nil)
	e := testEngine(s, &actor.Actor{UID: "u", U: "nv", R: "staff"})
	admin := map[string]bool{"DELETE /api/v1/products/:key": true, "GET /api/v1/product-delete-requests": true,
		"POST /api/v1/product-delete-requests/:id/resolve": true}
	want := map[string]bool{"POST /export/san-pham": true, "POST /upload/file": true}
	for _, k := range []string{"GET /products", "POST /products", "GET /products/:key", "PATCH /products/:key", "DELETE /products/:key",
		"GET /products/:key/combo", "PUT /products/:key/combo", "GET /products/:key/variants", "PUT /products/:key/variants",
		"GET /products/:key/history", "POST /product-approvals", "POST /product-favorites", "GET /product-permissions",
		"POST /uploads/images", "POST /uploads/files-base64", "POST /product-imports/parse", "POST /product-imports/commit",
		"POST /product-delete-requests", "GET /product-delete-requests", "POST /product-delete-requests/:id/resolve",
		"POST /products/:key/private-copy"} { // route chỉ bản Go M10.1
		method, path, _ := strings.Cut(k, " ")
		want[method+" /api/v1"+path] = true
	}
	for _, r := range e.Routes() {
		k := r.Method + " " + r.Path
		if !want[k] {
			t.Errorf("route thừa: %s", k)
		}
		delete(want, k)
		if !strings.HasPrefix(r.Path, "/api/v1") {
			continue
		}
		path := strings.NewReplacer(":key", "x", ":id", "1").Replace(r.Path)
		if w := do(e, r.Method, path, "", nil, false); w.Code != 401 || w.Body.String() != `{"error":"Chưa đăng nhập","code":"NOAUTH"}` {
			t.Errorf("%s chưa đăng nhập: %d %s", k, w.Code, w.Body.String())
		}
		if admin[k] {
			if w := do(e, r.Method, path, "", nil, true); w.Code != 403 || w.Body.String() != `{"error":"Không có quyền (chỉ Admin)"}` {
				t.Errorf("%s nhân viên gọi: %d %s", k, w.Code, w.Body.String())
			}
		}
	}
	for k := range want {
		t.Errorf("thiếu route: %s", k)
	}
}

// POST /upload/file (I:763-778): mã trạng thái, thân và thứ tự kiểm tra (đối chiếu bằng cách đọc mã Node).
func TestUploadRoute(t *testing.T) {
	up := &fakeUploader{}
	s, _ := newSvc(nil, up)
	e := testEngine(s, &actor.Actor{UID: "u", U: "nv", R: "staff"})
	pdf := []byte("%PDF-1.4")
	check := func(name string, w *httptest.ResponseRecorder, code int, body string) {
		t.Helper()
		if w.Code != code || upNorm(w.Body.String()) != body {
			t.Errorf("%s: %d %s", name, w.Code, w.Body.String())
		}
	}
	check("chưa đăng nhập", do(e, "POST", "/upload/file?name=a.pdf", "application/pdf", pdf, false), 401, `{"error":"Chưa đăng nhập"}`)
	check("thân rỗng", do(e, "POST", "/upload/file?name=a.pdf", "application/pdf", nil, true), 400, `{"error":"File rỗng."}`)
	check("thiếu tên", do(e, "POST", "/upload/file", "application/pdf", pdf, true), 400,
		`{"error":"Định dạng .tai-lieu chưa hỗ trợ (PDF, ảnh, DWG/DXF, SKP, ZIP/RAR, Word, Excel)."}`)
	check("thân json đã bị express.json đọc", do(e, "POST", "/upload/file?name=a.pdf", "application/json", []byte(`{"a":1}`), true), 400, `{"error":"File rỗng."}`)
	w := do(e, "POST", "/upload/file?name=B%E1%BA%A3n+v%E1%BA%BD.PDF", "application/pdf", pdf, true)
	check("tải được", w, 200, `{"url":"URL:docs/<ms>-Ban-ve.pdf","name":"Bản vẽ.PDF"}`)
	if got := js(up.rec.Val("ct")) + js(up.rec.Val("len")); got != `"application/pdf"8` {
		t.Errorf("kho nhận: %s", js(up.rec))
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type: %s", ct)
	}
	up.rec = nil
	check("không content-type", do(e, "POST", "/upload/file?name=a.zip", "", pdf, true), 200, `{"url":"URL:docs/<ms>-a.zip","name":"a.zip"}`)
	if up.rec.Val("ct") != "application/octet-stream" {
		t.Errorf("content-type mặc định: %s", js(up.rec))
	}
	// quá (DOC_MAX_MB + 1) MB: 413 JSON kể cả khi chưa đăng nhập (express.raw chạy trước khi kiểm tra đăng nhập)
	big := make([]byte, uploadLimit+1)
	const qua = `{"error":"File quá lớn (tối đa 50MB) — hãy dán link thay vì tải lên."}`
	check("quá giới hạn thân", do(e, "POST", "/upload/file?name=a.pdf", "application/pdf", big, false), 413, qua)
	// giữa 50 MB và 51 MB: thân đọc được, uploadFileBuf từ chối -> 400
	check("quá giới hạn file", do(e, "POST", "/upload/file?name=a.pdf", "application/pdf", big[:DocMaxMB<<20+1], true), 400,
		`{"error":"File 50.0MB quá lớn (tối đa 50MB) — hãy dán link thay vì tải lên."}`)
	up.fail = "Storage upload -> 413 Payload too large"
	check("kho từ chối", do(e, "POST", "/upload/file?name=a.pdf", "application/pdf", pdf, true), 400,
		`{"error":"Kho file từ chối: file 0.0MB vượt giới hạn — hãy dán link thay vì tải lên."}`)
}

// TestUploadRouteNode: các request lạ tới POST /upload/file (thân JSON, query không chuẩn, Content-Encoding) - mã trạng
// thái, thân JSON và đúng các byte gửi lên kho lấy từ route Node thật (testdata/gen_upload_route.js).
func TestUploadRouteNode(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "upload_route.json"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	cases := arr(v)
	if len(cases) < 50 {
		t.Fatalf("chỉ có %d ca", len(cases))
	}
	for _, c := range cases {
		m := jsval.AsMap(c)
		name := jsval.AsString(m.Val("name"))
		up := &fakeUploader{}
		s, _ := newSvc(nil, up)
		e := testEngine(s, &actor.Actor{UID: "u", U: "nv", R: "staff"})
		body, _ := hex.DecodeString(jsval.AsString(m.Val("bodyHex")))
		req := httptest.NewRequest("POST", "/upload/file", bytes.NewReader(body))
		req.URL.RawQuery = strings.TrimPrefix(jsval.AsString(m.Val("query")), "?")
		hs := jsval.AsMap(m.Val("headers"))
		for _, k := range hs.Keys() {
			req.Header.Set(k, jsval.AsString(hs.Val(k)))
		}
		if m.Val("login") == true {
			req.Header.Set("Authorization", "Bearer x")
		}
		w := httptest.NewRecorder()
		e.ServeHTTP(w, req)
		if want := int(jsval.ToNumber(m.Val("status"))); w.Code != want {
			t.Errorf("%s: mã %d, Node %d (%s)", name, w.Code, want, w.Body.String())
			continue
		}
		// trang lỗi HTML của Express (body = null): chỉ so mã trạng thái
		if want, ok := m.Val("body").(string); ok && upNorm(w.Body.String()) != want {
			t.Errorf("%s: thân\n  go:   %s\n  node: %s", name, w.Body.String(), want)
		}
		var got any
		if up.rec != nil {
			got = omap.Of("hex", hex.EncodeToString(up.buf), "path", up.rec.Val("path"), "ct", up.rec.Val("ct"))
		}
		if g, w := upNorm(js(got)), js(m.Val("up")); g != w {
			t.Errorf("%s: kho nhận\n  go:   %s\n  node: %s", name, g, w)
		}
	}
}

// ───────────── M10.1: tạo bản sao riêng từ kho chung Dezon (chỉ bản Go, không có golden Node) ─────────────

// pcRepo: kho giả - Select trả dòng theo hàm sel (bảng, lọc, NoScope), ghi lại mọi lệnh.
type pcRepo struct {
	sel    func(table, filter string, noScope bool) []*omap.Map
	selErr func(table, filter string) error  // nil = không lỗi
	ins    func(table string, lan int) error // lỗi cho lần InsertOne thứ lan (đếm từ 1) vào bảng; nil = không lỗi
	nIns   map[string]int
	calls  []string
}

func (r *pcRepo) Select(_ context.Context, table string, opt ...database.SelectOpt) ([]*omap.Map, error) {
	o := database.SelectOpt{}
	if len(opt) > 0 {
		o = opt[0]
	}
	r.calls = append(r.calls, "select "+table+" "+o.Filter)
	if r.selErr != nil {
		if err := r.selErr(table, o.Filter); err != nil {
			return nil, err
		}
	}
	return r.sel(table, o.Filter, o.NoScope), nil
}
func (r *pcRepo) Insert(_ context.Context, table string, rows []*omap.Map, _ ...database.Opt) ([]*omap.Map, error) {
	r.calls = append(r.calls, "insert "+table+" "+js(rows))
	return rows, nil
}
func (r *pcRepo) InsertOne(_ context.Context, table string, row *omap.Map, _ ...database.Opt) ([]*omap.Map, error) {
	if r.ins != nil {
		if r.nIns == nil {
			r.nIns = map[string]int{}
		}
		r.nIns[table]++
		if err := r.ins(table, r.nIns[table]); err != nil {
			return nil, err
		}
	}
	r.calls = append(r.calls, "insert "+table+" "+js(row))
	return []*omap.Map{row.Clone().Set("id", 9001.0)}, nil
}
func (r *pcRepo) Update(_ context.Context, table, _ string, _ *omap.Map, _ ...database.Opt) ([]*omap.Map, error) {
	r.calls = append(r.calls, "update "+table)
	return nil, nil
}
func (r *pcRepo) Remove(_ context.Context, table, _ string, _ ...database.Opt) ([]*omap.Map, error) {
	r.calls = append(r.calls, "remove "+table)
	return nil, nil
}

func (r *pcRepo) ghi() []string {
	out := []string{}
	for _, c := range r.calls {
		if !strings.HasPrefix(c, "select ") {
			out = append(out, c)
		}
	}
	return out
}

func TestCopySharedProduct(t *testing.T) {
	src := omap.Of("id", 55.0, "ma_sp", "DZ-1", "ten_sp", "Đèn Dezon", "cong_ty_id", "dz", "nganh", "den", "nhiet_do_mau_k", "3000K",
		"cong_suat_w", "", "gia_ban_le", 100000.0, "gia_dai_ly", 90000.0, "ck_dai_ly_pct", 10.0, "anh_sp", "https://x/a.png",
		"datasheet", "https://x/a.pdf", "da_duyet", true, "nguoi_duyet", "dz_admin", "ngay_duyet", "2026-01-01", "nguoi_tao", "dz",
		"ngay_tao", "2026-01-01", "nguoi_sua", "dz", "ngay_cap_nhat", "2026-01-02", "nhom_bt", "BT1", "ghi_chu", nil)
	type tc struct {
		name                 string
		a                    *actor.Actor
		key                  any
		perms                string
		dungKho, coSP, trung bool
		loi                  string
	}
	admin := &actor.Actor{UID: "A1", U: "zz_admin", R: "admin"}
	nv := &actor.Actor{UID: "U2", U: "nv", R: "staff"}
	cases := []tc{
		{name: "nhân viên không có tab sanpham", a: nv, key: "55", perms: "boc,duan", dungKho: true, coSP: true, loi: "Tài khoản không có quyền thêm dữ liệu"},
		{name: "nhân viên được sửa nhưng thiếu tab", a: nv, key: "55", perms: "boc,sp_edit", dungKho: true, coSP: true, loi: "Tài khoản không có quyền thêm dữ liệu"},
		{name: "công ty chưa bật kho chung", a: admin, key: "55", dungKho: false, coSP: true, loi: "Công ty chưa được dùng kho chung Dezon"},
		{name: "không có trong kho chung", a: admin, key: "55", dungKho: true, coSP: false, loi: "Không tìm thấy sản phẩm trong kho chung"},
		{name: "khoá không phải id", a: admin, key: "DZ-1", dungKho: true, coSP: true, loi: "Không tìm thấy sản phẩm trong kho chung"},
		{name: "trùng mã + biến thể", a: admin, key: "55", dungKho: true, coSP: true, trung: true, loi: "Công ty bạn đã có sản phẩm mã DZ-1"},
		{name: "admin sao chép", a: admin, key: " 55 ", dungKho: true, coSP: true},
		{name: "nhân viên có tab sanpham", a: nv, key: 55.0, perms: "boc,sanpham", dungKho: true, coSP: true},
	}
	for _, c := range cases {
		var dupFilter string
		r := &pcRepo{sel: func(table, filter string, noScope bool) []*omap.Map {
			switch {
			case table == "users":
				return []*omap.Map{omap.Of("id", "U2", "perms", c.perms)}
			case table == "cong_ty" && filter == "id=eq.c1":
				return []*omap.Map{omap.Of("id", "c1", "dung_sp_dezon", c.dungKho)}
			case table == "cong_ty" && filter == "ma=eq.dezon":
				return []*omap.Map{omap.Of("id", "dz")}
			case table == "db_san_pham" && noScope:
				if !c.coSP || filter != "id=eq.55&cong_ty_id=eq.dz" {
					return nil
				}
				return []*omap.Map{src.Clone()}
			case table == "db_san_pham":
				dupFilter = filter
				if c.trung {
					return []*omap.Map{omap.Of("id", 3.0)}
				}
			}
			return nil
		}}
		s, _ := newSvc(r, nil)
		ctx := tenant.With(context.Background(), tenant.Ctx{UID: c.a.UID, Role: c.a.R, CongTyID: "c1"})
		out, err := s.CopySharedProduct(ctx, c.a, c.key)
		if c.loi != "" {
			if err == nil || err.Error() != c.loi {
				t.Errorf("%s: lỗi %v, muốn %q", c.name, err, c.loi)
			}
			if w := r.ghi(); len(w) > 0 {
				t.Errorf("%s: không được ghi: %v", c.name, w)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if g := js(out); g != `{"ok":true,"id":9001,"ma":"DZ-1","ten":"Đèn Dezon"}` {
			t.Errorf("%s: kết quả %s", c.name, g)
		}
		if want := "ma_sp=eq.DZ-1&and=(nhiet_do_mau_k.eq.%223000K%22,or(cong_suat_w.is.null,cong_suat_w.eq.)," +
			"or(goc_chieu_deg.is.null,goc_chieu_deg.eq.),or(mau_sac.is.null,mau_sac.eq.))"; dupFilter != want {
			t.Errorf("%s: lọc trùng\n  %s\n  %s", c.name, dupFilter, want)
		}
		w := r.ghi()
		if len(w) != 3 {
			t.Fatalf("%s: lệnh ghi %v", c.name, w)
		}
		if want := `insert db_san_pham {"ma_sp":"DZ-1","ten_sp":"Đèn Dezon","nganh":"den","nhiet_do_mau_k":"3000K","gia_ban_le":100000,` +
			`"ck_dai_ly_pct":10,"anh_sp":"https://x/a.png","datasheet":"https://x/a.pdf","nguoi_tao":"` + c.a.U + `","ngay_tao":"<ts>"}`; tsNorm(w[0]) != want {
			t.Errorf("%s: dòng mới\n  %s\n  %s", c.name, tsNorm(w[0]), want)
		}
		if want := `insert db_san_pham_history [{"ma_sp":"DZ-1","field":"SAO CHÉP TỪ KHO DEZON","old_value":"","new_value":"Đèn Dezon (từ SP #55 kho Dezon) (bởi ` +
			c.a.U + `)","changed_by":"` + c.a.UID.(string) + `","changed_by_name":"` + c.a.U + `"}]`; w[1] != want {
			t.Errorf("%s: lịch sử\n  %s\n  %s", c.name, w[1], want)
		}
		if !strings.HasPrefix(w[2], `insert audit_log {"user_id":"`+c.a.UID.(string)+`","username":"`+c.a.U+`","action":"sao_chep_sp_dezon"`) {
			t.Errorf("%s: nhật ký %s", c.name, w[2])
		}
	}
}

// Các nhánh phụ của CopySharedProduct: tính năng công ty (canTab), trục kích thước khi kiểm trùng, cột người tạo chưa có,
// lỗi đọc công ty, unique index 23505 khi hai yêu cầu cùng qua phép kiểm trùng.
func TestCopySharedProductNhanh(t *testing.T) {
	type tc struct {
		name     string
		a        *actor.Actor
		perms    string
		tinhNang string
		src      *omap.Map
		selErr   func(table, filter string) error
		ins      func(table string, lan int) error
		loi      string
		dup      string // lọc kiểm trùng mong đợi ("" = không kiểm)
		dong     string // dòng chèn mong đợi ("" = không kiểm)
	}
	admin := &actor.Actor{UID: "A1", U: "zz_admin", R: "admin"}
	nv := &actor.Actor{UID: "U2", U: "nv", R: "staff"}
	super := &actor.Actor{UID: "S1", U: "zz_super", R: "super"}
	den := omap.Of("id", 55.0, "ma_sp", "DZ-1", "ten_sp", "Đèn Dezon", "cong_ty_id", "dz", "nganh", "den")
	son := omap.Of("id", 55.0, "ma_sp", "2IN1", "ten_sp", "Sơn 2IN1", "cong_ty_id", "dz", "nganh", "son", "kich_thuoc", "15L")
	denKT := omap.Of("id", 55.0, "ma_sp", "DZ-1", "ten_sp", "Đèn Dezon", "cong_ty_id", "dz", "nganh", "den", "kich_thuoc", "D90")
	sonRong := omap.Of("id", 55.0, "ma_sp", "2IN1", "ten_sp", "Sơn 2IN1", "cong_ty_id", "dz", "nganh", "son")
	dupDen := "ma_sp=eq.DZ-1&and=(or(nhiet_do_mau_k.is.null,nhiet_do_mau_k.eq.),or(cong_suat_w.is.null,cong_suat_w.eq.)," +
		"or(goc_chieu_deg.is.null,goc_chieu_deg.eq.),or(mau_sac.is.null,mau_sac.eq.))"
	dup2in1 := "ma_sp=eq.2IN1&and=(or(nhiet_do_mau_k.is.null,nhiet_do_mau_k.eq.),or(cong_suat_w.is.null,cong_suat_w.eq.)," +
		"or(goc_chieu_deg.is.null,goc_chieu_deg.eq.),or(mau_sac.is.null,mau_sac.eq.),"
	thieuCot := errors.New(`DB POST products -> 400 {"code":"PGRST204","message":"Could not find the 'nguoi_tao' column in the schema cache"}`)
	trungIdx := &database.Error{Msg: "duplicate key value violates unique constraint", Code: "23505", Status: 409}
	cases := []tc{
		{name: "tính năng công ty thiếu sanpham: admin", a: admin, tinhNang: "boc, duan", src: den, loi: "Tài khoản không có quyền thêm dữ liệu"},
		{name: "tính năng công ty thiếu sanpham: nhân viên có tab", a: nv, perms: "sanpham", tinhNang: "boc,duan", src: den, loi: "Tài khoản không có quyền thêm dữ liệu"},
		{name: "tính năng công ty có sanpham", a: nv, perms: "sanpham", tinhNang: "boc, sanpham", src: den, dup: dupDen},
		{name: "super không xét tính năng", a: super, tinhNang: "boc", src: den, dup: dupDen},
		{name: "sơn: kích thước là trục biến thể", a: admin, src: son, dup: dup2in1 + "kich_thuoc.eq.%2215L%22)"},
		{name: "sơn kích thước rỗng", a: admin, src: sonRong, dup: dup2in1 + "or(kich_thuoc.is.null,kich_thuoc.eq.))"},
		{name: "đèn có kích thước", a: admin, src: denKT, dup: strings.TrimSuffix(dupDen, ")") + ",kich_thuoc.eq.%22D90%22)"},
		{name: "lỗi đọc công ty", a: admin, src: den, loi: "boom",
			selErr: func(table, filter string) error {
				if table == "cong_ty" && filter == "ma=eq.dezon" {
					return errors.New("boom")
				}
				return nil
			}},
		{name: "unique index 23505", a: admin, src: den, loi: "Công ty bạn đã có sản phẩm mã DZ-1",
			ins: func(table string, _ int) error {
				if table == "db_san_pham" {
					return trungIdx
				}
				return nil
			}},
		{name: "23505 sau khi bỏ cột người tạo", a: admin, src: den, loi: "Công ty bạn đã có sản phẩm mã DZ-1",
			ins: func(table string, lan int) error {
				if table != "db_san_pham" {
					return nil
				}
				if lan == 1 {
					return thieuCot
				}
				return trungIdx
			}},
		{name: "thiếu cột người tạo: chèn lại không có", a: admin, src: den, dup: dupDen,
			dong: `insert db_san_pham {"ma_sp":"DZ-1","ten_sp":"Đèn Dezon","nganh":"den"}`,
			ins: func(table string, lan int) error {
				if table == "db_san_pham" && lan == 1 {
					return thieuCot
				}
				return nil
			}},
	}
	for _, c := range cases {
		var dupFilter string
		r := &pcRepo{selErr: c.selErr, ins: c.ins, sel: func(table, filter string, noScope bool) []*omap.Map {
			switch {
			case table == "users":
				return []*omap.Map{omap.Of("id", "U2", "perms", c.perms)}
			case table == "cong_ty" && filter == "id=eq.c1":
				return []*omap.Map{omap.Of("id", "c1", "dung_sp_dezon", true, "tinh_nang", c.tinhNang)}
			case table == "cong_ty" && filter == "ma=eq.dezon":
				return []*omap.Map{omap.Of("id", "dz")}
			case table == "db_san_pham" && noScope:
				return []*omap.Map{c.src.Clone()}
			case table == "db_san_pham":
				dupFilter = filter
			}
			return nil
		}}
		s, _ := newSvc(r, nil)
		ctx := tenant.With(context.Background(), tenant.Ctx{UID: c.a.UID, Role: c.a.R, CongTyID: "c1"})
		_, err := s.CopySharedProduct(ctx, c.a, "55")
		if c.loi != "" {
			if err == nil || err.Error() != c.loi {
				t.Errorf("%s: lỗi %v, muốn %q", c.name, err, c.loi)
			}
			if w := r.ghi(); len(w) > 0 {
				t.Errorf("%s: không được ghi: %v", c.name, w)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if c.dup != "" && dupFilter != c.dup {
			t.Errorf("%s: lọc trùng\n  %s\n  %s", c.name, dupFilter, c.dup)
		}
		w := r.ghi()
		if len(w) != 3 {
			t.Fatalf("%s: lệnh ghi %v", c.name, w)
		}
		if c.dong != "" && w[0] != c.dong {
			t.Errorf("%s: dòng mới\n  %s\n  %s", c.name, w[0], c.dong)
		}
		if c.dong != "" && !s.whoColMissing.Load() {
			t.Errorf("%s: phải nhớ whoColMissing", c.name)
		}
	}
}

// Danh mục: sản phẩm riêng chỉ che dòng kho chung trùng ĐỦ khoá kiểm trùng (thêm kích thước khi có trục này).
func TestGhepKhoChungKichThuoc(t *testing.T) {
	dz := func(id float64, ma, nganh, kt string) *omap.Map {
		return omap.Of("id", id, "ma_sp", ma, "ten_sp", ma+" "+kt, "cong_ty_id", "dz", "nganh", nganh, "kich_thuoc", kt)
	}
	shared := []*omap.Map{dz(1, "2IN1", "son", "1L"), dz(2, "2IN1", "son", "5L"), dz(3, "2IN1", "son", "15L"),
		dz(4, "DEN-A", "den", ""), dz(5, "DEN-B", "den", "D90"), dz(6, "DEN-B", "den", "D120"), dz(7, "DEN-C", "den", "")}
	own := []*omap.Map{
		omap.Of("id", 101.0, "ma_sp", "2IN1", "ten_sp", "2IN1 riêng", "nganh", "son", "kich_thuoc", "15L"),
		omap.Of("id", 102.0, "ma_sp", "DEN-A", "ten_sp", "DEN-A riêng", "nganh", "den"),
		omap.Of("id", 103.0, "ma_sp", "DEN-B", "ten_sp", "DEN-B riêng", "nganh", "den", "kich_thuoc", "D90"),
		// dòng kho chung DEN-C không có trục kích thước: phép kiểm trùng của nó bỏ qua kích thước -> bị che
		omap.Of("id", 104.0, "ma_sp", "DEN-C", "ten_sp", "DEN-C riêng", "nganh", "den", "kich_thuoc", "X"),
	}
	r := &pcRepo{sel: func(table, filter string, noScope bool) []*omap.Map {
		switch {
		case table == "cong_ty" && filter == "id=eq.c1":
			return []*omap.Map{omap.Of("id", "c1", "dung_sp_dezon", true)}
		case table == "cong_ty" && filter == "ma=eq.dezon":
			return []*omap.Map{omap.Of("id", "dz")}
		case table == "db_san_pham" && noScope:
			return shared
		case table == "db_san_pham":
			return own
		}
		return nil
	}}
	s, _ := newSvc(r, nil)
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "A1", Role: "admin", CongTyID: "c1"})
	list, err := s.GetProducts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	chung := []string{}
	for _, p := range list {
		if m := p.(*omap.Map); m.Val("spChung") == true {
			chung = append(chung, jsval.ToString(m.Val("recordId")))
		}
	}
	sort.Strings(chung)
	if g := strings.Join(chung, ","); g != "1,2,6" {
		t.Errorf("dòng kho chung còn hiện: %s, muốn 1,2,6 (1L, 5L của 2IN1 và DEN-B D120)", g)
	}
}

// Route chỉ bản Go: khai trong registry (Login) + route gin cùng đường dẫn; không thành hàm /api/:fn.
func TestCopySharedProductRoute(t *testing.T) {
	r := &pcRepo{sel: func(string, string, bool) []*omap.Map { return nil }}
	s, reg := newSvc(r, nil)
	gr := reg.GoRoutes()
	if len(gr) != 1 || gr[0].Name != "copySharedProduct" || gr[0].Method != "POST" || gr[0].Path != "/products/:key/private-copy" || gr[0].Perm != rpc.Login {
		t.Fatalf("route chỉ bản Go: %+v", gr)
	}
	if _, ok := reg.PermOf("copySharedProduct"); ok {
		t.Error("route chỉ bản Go không được thành hàm /api/:fn")
	}
	e := testEngine(s, &actor.Actor{UID: "A1", U: "ad", R: "admin"})
	if w := do(e, "POST", "/api/v1/products/55/private-copy", "", nil, false); w.Code != 401 {
		t.Errorf("chưa đăng nhập: %d %s", w.Code, w.Body)
	}
	// ngữ cảnh không có công ty (super xem toàn hệ thống): không có kho chung để chép
	if w := do(e, "POST", "/api/v1/products/55/private-copy", "", nil, true); w.Code == 200 || !strings.Contains(w.Body.String(), "Công ty chưa được dùng kho chung Dezon") {
		t.Errorf("không có công ty: %d %s", w.Code, w.Body)
	}
}

// Trên qspro_gotest: công ty ZZ bật kho chung chép một SP ZZ của Dezon -> SP riêng của ZZ (Chưa duyệt, sửa được, không spChung,
// che bản kho chung trong danh mục); lần 2 báo trùng; tắt kho chung -> lỗi. Dọn sạch ở cuối.
func TestCopySharedProductDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	defer db.Close()
	root := tenant.With(context.Background(), tenant.Ctx{Role: "super"})
	ns := database.Opt{NoScope: true}
	dz, err := db.Select(root, "cong_ty", database.SelectOpt{Filter: database.Eq("ma", "dezon"), Limit: 1, NoScope: true})
	if err != nil || len(dz) == 0 {
		t.Skipf("qspro_gotest không có công ty dezon: %v", err)
	}
	dzID := dz[0].Val("id")
	const ma, maKT, maCT = "ZZ_GOTEST_PCOPY", "ZZ_GOTEST_PCOPY_KT", "zz-gotest-pcopy"
	var ctID any
	don := func() {
		for _, m := range []string{ma, maKT} {
			_, _ = db.Remove(root, "db_san_pham", database.Eq("ma_sp", m), ns)
			_, _ = db.Remove(root, "db_san_pham_history", database.Eq("ma_sp", m), ns)
		}
		if ctID != nil {
			_, _ = db.Remove(root, "audit_log", database.Eq("cong_ty_id", ctID), ns)
		}
		_, _ = db.Remove(root, "cong_ty", database.Eq("ma", maCT), ns)
	}
	don()
	defer don()
	ct, err := db.InsertOne(root, "cong_ty", omap.Of("ten", "ZZ_GOTEST_PCOPY", "ma", maCT, "dung_sp_dezon", true), ns)
	if err != nil {
		t.Fatal(err)
	}
	ctID = ct[0].Val("id")
	sp, err := db.InsertOne(root, "db_san_pham", omap.Of("ma_sp", ma, "ten_sp", "ZZ đèn kho chung", "cong_ty_id", dzID, "nganh", "den",
		"nhiet_do_mau_k", "4000K", "gia_ban_le", 250000.0, "ck_dai_ly_pct", 20.0, "anh_sp", "https://example.invalid/zz.png",
		"da_duyet", true, "nguoi_duyet", "zz", "nhom_bt", "ZZ_BT"), ns)
	if err != nil {
		t.Fatal(err)
	}
	spID := jsval.ToString(sp[0].Val("id"))

	deps := stubDeps{repo: db}
	s := New(Deps{DB: db, Auditor: deps, Users: deps, UserFmt: deps, Notifier: deps, Admins: deps, Uploader: &fakeUploader{}})
	a := &actor.Actor{U: "zz_pcopy_admin", R: "admin"}
	ctx := tenant.With(context.Background(), tenant.Ctx{Role: "admin", CongTyID: ctID})
	demMa := func(maSP string) (chung, rieng int) {
		list, err := s.GetProducts(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range list {
			if m := p.(*omap.Map); m.Val("ma") == maSP {
				if m.Val("spChung") == true {
					chung++
				} else {
					rieng++
				}
			}
		}
		return
	}
	dem := func() (int, int) { return demMa(ma) }
	if c, r := dem(); c != 1 || r != 0 {
		t.Fatalf("trước khi chép: kho chung %d, riêng %d", c, r)
	}
	out, err := s.CopySharedProduct(ctx, a, spID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Val("ok") != true || out.Val("ma") != ma || out.Val("ten") != "ZZ đèn kho chung" || !jsval.Truthy(out.Val("id")) {
		t.Fatalf("kết quả %s", js(out))
	}
	newID := out.Val("id")
	rows, err := db.Select(root, "db_san_pham", database.SelectOpt{Select: "*", Filter: database.Eq("id", newID), Limit: 1, NoScope: true})
	if err != nil || len(rows) != 1 {
		t.Fatalf("đọc bản sao: %v %d", err, len(rows))
	}
	r := rows[0]
	if jsval.ToString(r.Val("cong_ty_id")) != jsval.ToString(ctID) || r.Val("da_duyet") == true || jsval.Truthy(r.Val("nguoi_duyet")) ||
		jsval.Truthy(r.Val("nhom_bt")) || r.Val("nhiet_do_mau_k") != "4000K" || jsval.ToNumber(r.Val("gia_ban_le")) != 250000 ||
		jsval.ToNumber(r.Val("gia_dai_ly")) != 200000 || r.Val("anh_sp") != "https://example.invalid/zz.png" || r.Val("nguoi_tao") != "zz_pcopy_admin" {
		t.Errorf("bản sao sai: %s", js(r))
	}
	if c, rr := dem(); c != 0 || rr != 1 {
		t.Errorf("sau khi chép: kho chung %d, riêng %d (bản riêng phải che bản kho chung)", c, rr)
	}
	if _, err := s.CopySharedProduct(ctx, a, spID); err == nil || err.Error() != "Công ty bạn đã có sản phẩm mã "+ma {
		t.Errorf("lần 2: %v", err)
	}
	// bản sao sửa được (guardSpChung không chặn)
	up, err := s.UpdateProductGated(ctx, a, jsval.ToString(newID), omap.Of("GIÁ BÁN LẺ", "260000"))
	if err != nil || up.Val("updated") != true {
		t.Errorf("sửa bản sao: %v %s", err, js(up))
	}
	hist, _ := db.Select(root, "db_san_pham_history", database.SelectOpt{
		Filter: database.Eq("ma_sp", ma) + "&" + database.Eq("field", "SAO CHÉP TỪ KHO DEZON"), NoScope: true})
	if len(hist) != 1 {
		t.Errorf("lịch sử sao chép: %d dòng", len(hist))
	}
	// hai biến thể kích thước (sơn 1L / 5L) cùng mã: chép 5L chỉ che 5L, 1L vẫn hiện và chép được
	kt := map[string]string{}
	for _, size := range []string{"1L", "5L"} {
		v, err := db.InsertOne(root, "db_san_pham", omap.Of("ma_sp", maKT, "ten_sp", "ZZ sơn "+size, "cong_ty_id", dzID, "nganh", "son",
			"kich_thuoc", size, "gia_ban_le", 100000.0), ns)
		if err != nil {
			t.Fatal(err)
		}
		kt[size] = jsval.ToString(v[0].Val("id"))
	}
	if c, rr := demMa(maKT); c != 2 || rr != 0 {
		t.Fatalf("biến thể kích thước trước khi chép: kho chung %d, riêng %d", c, rr)
	}
	if _, err := s.CopySharedProduct(ctx, a, kt["5L"]); err != nil {
		t.Fatal(err)
	}
	if c, rr := demMa(maKT); c != 1 || rr != 1 {
		t.Errorf("sau khi chép 5L: kho chung %d, riêng %d (1L phải còn hiện)", c, rr)
	}
	if _, err := s.CopySharedProduct(ctx, a, kt["1L"]); err != nil {
		t.Errorf("chép 1L sau 5L: %v", err)
	}
	if c, rr := demMa(maKT); c != 0 || rr != 2 {
		t.Errorf("sau khi chép 1L: kho chung %d, riêng %d", c, rr)
	}
	if _, err := s.CopySharedProduct(ctx, a, kt["5L"]); err == nil || err.Error() != "Công ty bạn đã có sản phẩm mã "+maKT {
		t.Errorf("chép lại 5L: %v", err)
	}
	if _, err := db.Update(root, "cong_ty", database.Eq("id", ctID), omap.Of("dung_sp_dezon", false), ns); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CopySharedProduct(ctx, a, spID); err == nil || err.Error() != "Công ty chưa được dùng kho chung Dezon" {
		t.Errorf("chưa bật kho chung: %v", err)
	}
}
