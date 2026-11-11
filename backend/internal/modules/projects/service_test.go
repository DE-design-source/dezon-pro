package projects

import (
	"context"
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/goonly"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

/* Giá trị mong đợi trong testdata/ đều do mã Node THẬT sinh ra:
   - unit.json  (gen_unit.js): hàm của store_supa.js chạy trên tầng supa giả, ghi lại từng lệnh đọc / ghi + kết quả
   - genma.json (gen_ma.js):   mã dự án của genMaDA_ với Date.now / Math.random cố định
   - diff.json  (gen_diff.js): kịch bản chạy trên database thử qspro_nodetest; TestDiffDB chạy lại trên qspro_gotest */

func loadJSON(t *testing.T, name string) any {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	s, err := omap.MarshalString(v)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func ctxOf(v any) context.Context {
	m := jsval.AsMap(v)
	if m == nil {
		return context.Background()
	}
	return tenant.With(context.Background(), tenant.Ctx{UID: jsval.Or(m.Val("uid"), nil), Role: jsval.AsString(m.Val("role")),
		CongTyID: jsval.Or(m.Val("congTyId"), nil), ViewAs: jsval.Or(m.Val("viewAs"), nil)})
}

func actorOf(v any) *actor.Actor {
	if m := jsval.AsMap(v); m != nil {
		return actor.FromMap(m)
	}
	return nil
}

// callFn gọi hàm qua đúng bộ đăng ký rpc (kiểm luôn cách ánh xạ tham số); getProject không phải hàm rpc.
func callFn(s *Service, reg *rpc.Registry, ctx context.Context, fn string, a *actor.Actor, args []any) (any, error) {
	if fn == "getProject" {
		return s.GetProject(ctx, rpc.Args(args).ArgU(0))
	}
	return reg.Call(ctx, fn, a, args...)
}

func resultOf(res any, err error) *omap.Map {
	if err != nil {
		return omap.Of("error", err.Error())
	}
	if jsval.IsNullish(res) {
		res = nil
	}
	return omap.Of("result", res)
}

// ───────────── repository giả ─────────────

type fakeRepo struct {
	log       []any
	ret, errs *omap.Map
	gate      chan struct{} // khác nil: mọi lệnh chờ tới khi kênh đóng
}

func (f *fakeRepo) call(m string, a []any, dflt func() []*omap.Map) ([]*omap.Map, error) {
	if f.gate != nil {
		<-f.gate
	}
	f.log = append(f.log, omap.Of("m", m, "a", omap.DeepClone(a)))
	if e, ok := f.errs.Get(m); ok {
		return nil, errors.New(jsval.ToString(e))
	}
	if v, ok := f.ret.Get(m); ok {
		arr := jsval.AsArray(omap.DeepClone(v))
		out := make([]*omap.Map, len(arr))
		for i := range arr {
			out[i] = jsval.AsMap(arr[i])
		}
		return out, nil
	}
	if dflt != nil {
		return dflt(), nil
	}
	return []*omap.Map{}, nil
}

func (f *fakeRepo) exec(m string, a []any) error { _, err := f.call(m, a, nil); return err }

func str(v any) string { return jsval.ToString(v) }

func (f *fakeRepo) ListProjects(context.Context) ([]*omap.Map, error) {
	return f.call("ListProjects", []any{}, nil)
}
func (f *fakeRepo) FindProject(_ context.Context, maDA any) ([]*omap.Map, error) {
	return f.call("FindProject", []any{str(maDA)}, nil)
}
func (f *fakeRepo) InsertProject(_ context.Context, row *omap.Map) ([]*omap.Map, error) {
	return f.call("InsertProject", []any{row}, func() []*omap.Map {
		return []*omap.Map{omap.Assign(omap.Of("id", 900.0), jsval.AsMap(omap.DeepClone(row)))}
	})
}
func (f *fakeRepo) UpdateProject(_ context.Context, maDA any, patch *omap.Map) ([]*omap.Map, error) {
	return f.call("UpdateProject", []any{str(maDA), patch}, nil)
}
func (f *fakeRepo) DeleteProject(_ context.Context, maDA any) error {
	return f.exec("DeleteProject", []any{str(maDA)})
}
func (f *fakeRepo) DeleteLines(_ context.Context, maDA any) error {
	return f.exec("DeleteLines", []any{str(maDA)})
}
func (f *fakeRepo) DeleteCover(_ context.Context, maDA any) error {
	return f.exec("DeleteCover", []any{str(maDA)})
}
func (f *fakeRepo) DeleteProjData(_ context.Context, maDA any) error {
	return f.exec("DeleteProjData", []any{str(maDA)})
}
func (f *fakeRepo) ListLinesRaw(_ context.Context, maDA any) ([]*omap.Map, error) {
	return f.call("ListLinesRaw", []any{str(maDA)}, nil)
}
func (f *fakeRepo) InsertLines(_ context.Context, rows []*omap.Map) error {
	return f.exec("InsertLines", []any{rows})
}
func (f *fakeRepo) ListCoverRaw(_ context.Context, maDA any) ([]*omap.Map, error) {
	return f.call("ListCoverRaw", []any{str(maDA)}, nil)
}
func (f *fakeRepo) InsertCover(_ context.Context, rows []*omap.Map) error {
	return f.exec("InsertCover", []any{rows})
}
func (f *fakeRepo) ListProjDataRaw(_ context.Context, maDA any) ([]*omap.Map, error) {
	return f.call("ListProjDataRaw", []any{str(maDA)}, nil)
}
func (f *fakeRepo) InsertProjDataRows(_ context.Context, rows []*omap.Map) error {
	return f.exec("InsertProjDataRows", []any{rows})
}
func (f *fakeRepo) ListProjDataKV(_ context.Context, maDA string) ([]*omap.Map, error) {
	return f.call("ListProjDataKV", []any{maDA}, nil)
}
func (f *fakeRepo) ListCompanySettings(_ context.Context, kc bool) ([]*omap.Map, error) {
	return f.call("ListCompanySettings", []any{kc}, nil)
}
func (f *fakeRepo) FindCompanySetting(_ context.Context, loc string, kc bool) ([]*omap.Map, error) {
	return f.call("FindCompanySetting", []any{loc, kc}, nil)
}
func (f *fakeRepo) UpdateCompanySetting(_ context.Context, loc string, row *omap.Map, kc bool) error {
	return f.exec("UpdateCompanySetting", []any{loc, row, kc})
}
func (f *fakeRepo) InsertCompanySetting(_ context.Context, row *omap.Map, kc bool) error {
	return f.exec("InsertCompanySetting", []any{row, kc})
}
func (f *fakeRepo) FindProjData(_ context.Context, maDA, khoa string) ([]*omap.Map, error) {
	return f.call("FindProjData", []any{projDataLoc(maDA, khoa)}, nil)
}
func (f *fakeRepo) UpdateProjData(_ context.Context, maDA, khoa string, row *omap.Map) error {
	return f.exec("UpdateProjData", []any{projDataLoc(maDA, khoa), row})
}
func (f *fakeRepo) InsertProjData(_ context.Context, row *omap.Map) error {
	return f.exec("InsertProjData", []any{row})
}

// ───────────── module khác (giả) ─────────────

type stubCatalog struct {
	products []any
	err      error
	calls    atomic.Int32
	gate     chan struct{} // khác nil: chờ tới khi kênh đóng mới trả kết quả
	ctxErr   atomic.Value  // ctx.Err() lúc trả kết quả
}

func (s *stubCatalog) GetProductsCached(ctx context.Context) ([]any, error) {
	s.calls.Add(1)
	if s.gate != nil {
		<-s.gate
	}
	if e := ctx.Err(); e != nil {
		s.ctxErr.Store(e)
	}
	return s.products, s.err
}

type stubLines struct {
	lines []any
	err   error
	got   []any
}

func (s *stubLines) GetLines(_ context.Context, maDA any) ([]any, error) {
	s.got = append(s.got, maDA)
	return s.lines, s.err
}

// ───────────── test đơn vị ─────────────

func TestUnitGolden(t *testing.T) {
	for _, cv := range jsval.AsArray(loadJSON(t, "unit.json")) {
		c := jsval.AsMap(cv)
		name := jsval.AsString(c.Val("name"))
		f := &fakeRepo{log: []any{}, ret: jsval.AsMap(jsval.GetPath(c, "fake", "ret")), errs: jsval.AsMap(jsval.GetPath(c, "fake", "err"))}
		svc := New(Deps{Repo: f})
		svc.now = func() string { return "<ts>" }
		svc.genMa = func() string { return "<ma>" }
		reg := rpc.NewRegistry()
		svc.RegisterRPC(reg)
		res, err := callFn(svc, reg, ctxOf(c.Val("ctx")), jsval.AsString(c.Val("fn")), actorOf(c.Val("actor")), jsval.AsArray(c.Val("args")))
		got := omap.Assign(omap.Of("log", f.log), resultOf(res, err))
		got = jsval.AsMap(stripGoOnlyResult(t, name, got))
		if g, w := mustJSON(t, got), mustJSON(t, c.Val("expect")); g != w {
			t.Errorf("%s\n  go:   %s\n  node: %s", name, g, w)
		}
	}
}

func TestGenMaDAGolden(t *testing.T) {
	for _, cv := range jsval.AsArray(loadJSON(t, "genma.json")) {
		c := jsval.AsArray(cv)
		ms, x, want := jsval.ToNumber(c[0]), jsval.ToNumber(c[1]), jsval.AsString(c[2])
		if got := genMaDA(time.UnixMilli(int64(ms)), x); got != want {
			t.Errorf("genMaDA(%v, %v) = %q, node: %q", ms, x, got, want)
		}
	}
}

func TestGenMaShape(t *testing.T) {
	re := regexp.MustCompile(`^DA-\d{8}-\d{6}[0-9A-Z]{0,2}$`)
	s := New(Deps{Repo: &fakeRepo{}})
	for i := 0; i < 200; i++ {
		if ma := s.genMa(); !re.MatchString(ma) {
			t.Fatalf("mã lạ: %q", ma)
		}
	}
}

func TestRPCNames(t *testing.T) {
	reg := rpc.NewRegistry()
	New(Deps{Repo: &fakeRepo{}}).RegisterRPC(reg)
	want := []string{"bootstrap", "getProjects", "createProject", "updateProject", "deleteProject", "duplicateProject", "getProjData", "setProjData"}
	if len(reg.Names()) != len(want) {
		t.Fatalf("số hàm rpc = %d, cần %d", len(reg.Names()), len(want))
	}
	for _, n := range want {
		if p, ok := reg.PermOf(n); !ok || p != rpc.Login {
			t.Errorf("%s: quyền %v, có %v", n, p, ok)
		}
	}
}

// bootstrap: getProductsCached thuộc module materials nên phần ghép kết quả thử bằng bản giả
// (catSheets với danh mục thật của Node được đối chiếu trong TestDiffDB).
func TestBootstrap(t *testing.T) {
	prods := []any{omap.Of("nhom", "A"), omap.Of("nhom", ""), omap.Of("ten", "x"), omap.Of("nhom", "B"), omap.Of("nhom", "A"), omap.Of("nhom", nil), omap.Of("nhom", 5.0), omap.Of("nhom", "5")}
	run := func(cat *stubCatalog, ln *stubLines, f *fakeRepo, maDA any) (string, error) {
		svc := New(Deps{Repo: f, Catalog: cat, Lines: ln})
		reg := rpc.NewRegistry()
		svc.RegisterRPC(reg)
		args := []any{}
		if !jsval.IsUndefined(maDA) {
			args = append(args, maDA)
		}
		r, err := reg.Call(context.Background(), "bootstrap", nil, args...)
		if err != nil {
			return "", err
		}
		return mustJSON(t, r), nil
	}
	ln := &stubLines{lines: []any{omap.Of("lineId", "1")}}
	got, err := run(&stubCatalog{products: prods}, ln, &fakeRepo{}, "DA-1")
	want := `{"projects":[],"products":[{"nhom":"A"},{"nhom":""},{"ten":"x"},{"nhom":"B"},{"nhom":"A"},{"nhom":null},{"nhom":5},{"nhom":"5"}],"lines":[{"lineId":"1"}],"catSheets":["A","B",5],"sheetCols":[]}`
	if err != nil || got != want {
		t.Errorf("bootstrap:\n  %s\n  %v", got, err)
	}
	if len(ln.got) != 1 || ln.got[0] != "DA-1" {
		t.Errorf("getLines nhận %v", ln.got)
	}
	// maDA falsy -> không đọc dòng
	for _, ma := range []any{jsval.Undefined, nil, "", 0.0, false} {
		ln = &stubLines{lines: []any{omap.Of("lineId", "1")}}
		got, err = run(&stubCatalog{}, ln, &fakeRepo{}, ma)
		if err != nil || got != `{"projects":[],"products":[],"lines":[],"catSheets":[],"sheetCols":[]}` || len(ln.got) != 0 {
			t.Errorf("bootstrap(%v): %s %v %v", ma, got, err, ln.got)
		}
	}
	// lỗi đọc dòng bị nuốt
	got, err = run(&stubCatalog{}, &stubLines{err: errors.New("hỏng")}, &fakeRepo{}, "DA-1")
	if err != nil || got != `{"projects":[],"products":[],"lines":[],"catSheets":[],"sheetCols":[]}` {
		t.Errorf("bootstrap lỗi dòng: %s %v", got, err)
	}
	// lỗi danh mục / lỗi dự án được ném ra (cả hai cùng hỏng: xem TestBootstrapFailFast, lỗi nào về trước thì báo lỗi đó)
	if _, err = run(&stubCatalog{err: errors.New("danh mục hỏng")}, &stubLines{}, &fakeRepo{}, "DA-1"); err == nil || err.Error() != "danh mục hỏng" {
		t.Errorf("lỗi danh mục: %v", err)
	}
	if _, err = run(&stubCatalog{}, &stubLines{}, &fakeRepo{errs: omap.Of("ListProjects", "dự án hỏng")}, "DA-1"); err == nil || err.Error() != "dự án hỏng" {
		t.Errorf("lỗi dự án: %v", err)
	}
}

// Promise.all (S:1018) từ chối ngay khi việc đầu tiên hỏng: bootstrap không chờ việc còn lại,
// và việc còn lại vẫn chạy nốt (không bị huỷ theo request).
func TestBootstrapFailFast(t *testing.T) {
	type out struct {
		r   any
		err error
	}
	call := func(ctx context.Context, cat *stubCatalog, f *fakeRepo) chan out {
		svc := New(Deps{Repo: f, Catalog: cat, Lines: &stubLines{}})
		ch := make(chan out, 1)
		go func() {
			r, err := svc.Bootstrap(ctx, "DA-1")
			ch <- out{r, err}
		}()
		return ch
	}
	wait := func(name string, ch chan out, want string) {
		t.Helper()
		select {
		case o := <-ch:
			if o.err == nil || o.err.Error() != want {
				t.Errorf("%s: lỗi %v, cần %q", name, o.err, want)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("%s: bootstrap vẫn chờ việc còn lại", name)
		}
	}
	// dự án hỏng trong lúc danh mục còn đang nạp
	ctx, cancel := context.WithCancel(context.Background())
	cat := &stubCatalog{gate: make(chan struct{}), products: []any{}}
	wait("dự án hỏng", call(ctx, cat, &fakeRepo{errs: omap.Of("ListProjects", "dự án hỏng")}), "dự án hỏng")
	cancel() // request kết thúc
	close(cat.gate)
	for i := 0; i < 200 && cat.calls.Load() != 1; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	if cat.calls.Load() != 1 || cat.ctxErr.Load() != nil {
		t.Errorf("danh mục: gọi %d lần, ctx %v", cat.calls.Load(), cat.ctxErr.Load())
	}
	// danh mục hỏng trong lúc dự án còn đang đọc
	gate := make(chan struct{})
	f := &fakeRepo{gate: gate}
	wait("danh mục hỏng", call(context.Background(), &stubCatalog{err: errors.New("danh mục hỏng")}, f), "danh mục hỏng")
	close(gate)
}

// ───────────── đối chiếu trên database thử ─────────────

var (
	reTpl     = regexp.MustCompile(`\{\{(\w+)\}\}`)
	reDigits  = regexp.MustCompile(`^\d+$`)
	reID      = regexp.MustCompile(`"id":\d+`)
	reLineID  = regexp.MustCompile(`"lineId":"\d+"`)
	reFailRow = regexp.MustCompile(`Failing row contains \(\d+,`)
	reTime    = regexp.MustCompile(`\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d(:\d\d)?)`)
)

// Cột chỉ bản Go (migration 0011, M8.3: projects.current_condition = du_an.hien_trang; migration 0036:
// projects.architect = du_an.kien_truc_su; migration 0038: projects.studio = du_an.studio; migration 0039: design_team,
// photographer, contractor, completion_year): golden Node không có
// -> bỏ khỏi kết quả và khỏi chi tiết lỗi "Failing row contains" trước khi so (backend/docs/ARCHITECTURE.md 10.4).
// Chỉ bỏ khi giá trị là null (goonly.StripNull): cột chỉ ghi khi client gửi khoá, ca golden không gửi, nên giá trị
// khác null = ghi sai và phép so báo khác.
//
// Khoá kết quả chỉ bản Go: goOnlyResultKeys (projToObj đọc từ các cột goOnlyKeys, cùng thứ tự). Ca golden không ghi cột này nên khoá luôn là chuỗi rỗng;
// stripGoOnlyResult kiểm điều đó rồi mới bỏ khoá (giá trị khác rỗng = đọc / ghi sai, test báo lỗi).
var (
	goOnlyKeys       = []string{"hien_trang", "kien_truc_su", "studio", "nhom_thiet_ke", "nhiep_anh_gia", "nha_thau_thi_cong", "nam_hoan_thien"}
	goOnlyCols       = map[string]int{"projects": 7}
	goOnlyResultKeys = []string{"hienTrang", "kienTrucSu", "studio", "nhomThietKe", "nhiepAnhGia", "nhaThauThiCong", "namHoanThien"}
)

// stripGoOnlyResult: khoá kết quả chỉ bản Go phải rỗng ở mọi chỗ, rồi bỏ khỏi v trước khi so với golden.
func stripGoOnlyResult(t *testing.T, where string, v any) any {
	t.Helper()
	var walk func(x any)
	walk = func(x any) {
		switch m := x.(type) {
		case *omap.Map:
			if m == nil {
				return
			}
			m.Each(func(k string, e any) {
				for _, g := range goOnlyResultKeys {
					if k == g && !jsval.StrictEquals(e, "") {
						t.Errorf("%s: khoá chỉ bản Go %s = %s, golden không ghi nên phải rỗng", where, k, mustJSON(t, e))
					}
				}
				walk(e)
			})
		case []any:
			for _, e := range m {
				walk(e)
			}
		case []*omap.Map:
			for _, e := range m {
				walk(e)
			}
		}
	}
	walk(v)
	return goonly.Strip(v, goOnlyResultKeys...)
}

type diffRun struct {
	t     *testing.T
	db    *database.DB
	svc   *Service
	reg   *rpc.Registry
	cat   *stubCatalog
	actor *actor.Actor
	names []string
	saved map[string]string
}

func (d *diffRun) norm(v any) string {
	s := mustJSON(d.t, v)
	for _, n := range d.names {
		// id dạng số không thay theo chuỗi (dễ trùng với số khác); đã có các mẫu "id" / "lineId" bên dưới
		if !reDigits.MatchString(d.saved[n]) {
			s = strings.ReplaceAll(s, d.saved[n], "<"+n+">")
		}
	}
	s = reID.ReplaceAllString(s, `"id":"<id>"`)
	s = reLineID.ReplaceAllString(s, `"lineId":"<id>"`)
	s = reFailRow.ReplaceAllString(s, "Failing row contains (<id>,")
	return reTime.ReplaceAllString(s, "<ts>")
}

func (d *diffRun) fill(raw *omap.Map) *omap.Map {
	in := raw.Clone()
	in.Delete("out")
	s := reTpl.ReplaceAllStringFunc(mustJSON(d.t, in), func(m string) string {
		if v, ok := d.saved[m[2:len(m)-2]]; ok {
			return v
		}
		return "MISSING"
	})
	v, err := omap.DecodeString(s)
	if err != nil {
		d.t.Fatal(err)
	}
	return jsval.AsMap(v)
}

func onlyZZ(list []any, prefix string) []any {
	out := []any{}
	for _, p := range list {
		if strings.HasPrefix(jsval.ToString(jsval.Get(p, "ten")), prefix) {
			out = append(out, p)
		}
	}
	return out
}

func (d *diffRun) step(ctx context.Context, st *omap.Map) (*omap.Map, error) {
	table, filter := jsval.AsString(st.Val("table")), jsval.AsString(st.Val("filter"))
	noScope := jsval.Truthy(st.Val("noScope"))
	args := jsval.AsArray(st.Val("args"))
	switch jsval.AsString(st.Val("op")) {
	case "insert":
		arr := jsval.AsArray(st.Val("rows"))
		rows := make([]*omap.Map, len(arr))
		for i := range arr {
			rows[i] = jsval.AsMap(arr[i])
		}
		if _, err := d.db.Insert(ctx, table, rows, database.Opt{NoScope: noScope}); err != nil {
			return nil, err
		}
		return omap.Of("ok", true), nil
	case "remove":
		if _, err := d.db.Remove(ctx, table, filter, database.Opt{NoScope: noScope}); err != nil {
			return nil, err
		}
		return omap.Of("ok", true), nil
	case "rows":
		rows, err := d.db.Select(ctx, table, database.SelectOpt{Filter: filter, Select: jsval.AsString(st.Val("select")),
			Order: jsval.AsString(st.Val("order")), NoScope: noScope})
		if err != nil {
			return nil, err
		}
		return omap.Of("rows", jsval.Rows(rows)), nil
	case "bootstrap":
		d.cat.products = []any{}
		for _, n := range jsval.AsArray(jsval.GetPath(st, "aux", "nhom")) {
			d.cat.products = append(d.cat.products, omap.Of("nhom", n))
		}
		rv, err := d.reg.Call(ctx, "bootstrap", d.actor, args...)
		if err != nil {
			return nil, err
		}
		r := jsval.AsMap(rv)
		keys := []any{}
		for _, k := range r.Keys() {
			keys = append(keys, k)
		}
		return omap.Of("keys", keys, "projects", onlyZZ(jsval.AsArray(r.Val("projects")), jsval.AsString(st.Val("only"))),
			"catSheets", r.Val("catSheets"), "sheetCols", r.Val("sheetCols")), nil
	}
	res, err := callFn(d.svc, d.reg, ctx, jsval.AsString(st.Val("fn")), d.actor, args)
	if err != nil {
		return nil, err
	}
	if jsval.IsNullish(res) {
		res = nil
	}
	if sv := jsval.AsMap(st.Val("save")); sv != nil {
		n := jsval.AsString(sv.Val("name"))
		d.names = append(d.names, n)
		d.saved[n] = jsval.ToString(jsval.Get(res, jsval.AsString(sv.Val("key"))))
	}
	if only, ok := st.Val("only").(string); ok {
		if arr, isArr := res.([]any); isArr {
			res = onlyZZ(arr, only)
		}
	}
	if pick := jsval.AsArray(st.Val("pick")); pick != nil && res != nil {
		o := omap.New()
		jsval.AsMap(res).Each(func(k string, v any) {
			for _, p := range pick {
				if p == k {
					o.Set(k, v)
				}
			}
		})
		res = o
	}
	return omap.Of("result", res), nil
}

// sortResultKeys: xếp lại khoá của "result" theo bảng chữ cái (kết quả lỗi / không phải object giữ nguyên).
func sortResultKeys(t *testing.T, s string) string {
	t.Helper()
	v, err := omap.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	res := jsval.AsMap(jsval.Get(v, "result"))
	if res == nil {
		return s
	}
	keys := append([]string(nil), res.Keys()...)
	sort.Strings(keys)
	o := omap.New()
	for _, k := range keys {
		o.Set(k, res.Val(k))
	}
	return mustJSON(t, omap.Of("result", o))
}

func TestDiffDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	t.Cleanup(db.Close)
	// lưới an toàn: test hỏng giữa chừng cũng không để lại dòng ZZ_projects_ (dòng con xoá theo khoá ngoại)
	t.Cleanup(func() {
		pool, err := db.Pool()
		if err != nil {
			return
		}
		_, _ = pool.Exec(context.Background(), `delete from projects where project_name like 'ZZ\_projects\_%' or project_code like 'ZZ\_projects\_%'`)
		_, _ = pool.Exec(context.Background(), `delete from company_settings where updated_by = 'ZZ_projects_u'`)
	})
	spec := jsval.AsMap(loadJSON(t, "diff.json"))
	// kịch bản ghi rồi xoá khoá btFmt của cai_dat_cong_ty (khoá trong danh sách cho phép, không gắn được tiền tố ZZ_):
	// đã có dòng btFmt không phải của test thì bỏ qua, không ghi đè / xoá dữ liệu có sẵn
	nguoiTest := jsval.AsString(jsval.GetPath(spec, "actor", "u"))
	daXet := map[string]bool{}
	var coSan bool
	jsval.AsMap(spec.Val("contexts")).Each(func(_ string, c any) {
		loc := "is.null"
		if ct := jsval.Get(c, "congTyId"); jsval.Truthy(ct) {
			loc = "eq." + jsval.ToString(ct)
		}
		if daXet[loc] {
			return
		}
		daXet[loc] = true
		rows, err := db.Select(context.Background(), "cai_dat_cong_ty", database.SelectOpt{Filter: "khoa=eq.btFmt&cong_ty_id=" + loc, NoScope: true})
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rows {
			if !jsval.StrictEquals(r.Val("nguoi_sua"), nguoiTest) {
				coSan = true
			}
		}
	})
	if coSan {
		t.Skip("cai_dat_cong_ty đã có dòng btFmt không phải của test - bỏ qua để không đụng dữ liệu có sẵn")
	}
	cat := &stubCatalog{}
	svc := New(Deps{DB: db, Catalog: cat, Lines: &stubLines{lines: []any{}}})
	// đồng hồ của máy thử có lúc lùi (container trên máy ảo) làm sai thứ tự ngay_tao.desc -> ép tăng dần từng ms
	var last time.Time
	svc.now = func() string {
		n := time.Now().UTC().Truncate(time.Millisecond)
		if !n.After(last) {
			n = last.Add(time.Millisecond)
		}
		last = n
		return jsval.ToISOString(n)
	}
	// 2 ký tự ngẫu nhiên của mã dự án: các lần tạo trong cùng 1 giây trùng nhau với xác suất 1/1296 (Node cũng vậy)
	// -> test dùng dãy không lặp để không rớt ngẫu nhiên; định dạng mã vẫn do genMaDA thật sinh
	seq := 0
	svc.random = func() float64 { seq++; return (float64(seq*37%1296) + 0.5) / 1296 }
	reg := rpc.NewRegistry()
	svc.RegisterRPC(reg)
	d := &diffRun{t: t, db: db, svc: svc, reg: reg, cat: cat, actor: actorOf(spec.Val("actor")), saved: map[string]string{}}
	contexts := jsval.AsMap(spec.Val("contexts"))
	for i, raw := range jsval.AsArray(spec.Val("steps")) {
		st := d.fill(jsval.AsMap(raw))
		out, err := d.step(ctxOf(contexts.Val(jsval.AsString(st.Val("ctx")))), st)
		if err != nil {
			out = omap.Of("error", err.Error())
		}
		want := jsval.AsString(jsval.Get(raw, "out"))
		got := goonly.StripFailingRow(d.norm(stripGoOnlyResult(t, "bước "+jsval.ToString(float64(i)), goonly.StripNull(out, goOnlyKeys...))), goOnlyCols)
		if st.Has("pick") {
			// getProjData không sắp xếp: thứ tự khoá theo thứ tự dòng database trả về (đổi theo kế hoạch truy vấn,
			// ở Node cũng vậy - bước 38 và 45 của diff.json ra hai kiểu) -> so không kể thứ tự khoá
			got, want = sortResultKeys(t, got), sortResultKeys(t, want)
		}
		if got != want {
			t.Errorf("bước %d (%s %s%s)\n  go:   %s\n  node: %s", i, jsval.AsString(st.Val("op")), jsval.AsString(st.Val("fn")), jsval.AsString(st.Val("table")), got, want)
		}
	}
}

// Route REST: đăng ký không panic (trùng tham số / trùng đường dẫn) và đủ 8 route của PORTING_MAP mục A
// + 3 route chỉ bản Go của yêu cầu sửa dự án (migration 0037).
func TestRESTRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	New(Deps{Repo: &fakeRepo{}}).RegisterRoutes(e.Group("/api/v1"))
	got := map[string]bool{}
	for _, r := range e.Routes() {
		got[r.Method+" "+r.Path] = true
	}
	want := []string{"GET /api/v1/bootstrap", "GET /api/v1/projects", "POST /api/v1/projects", "PATCH /api/v1/projects/:id",
		"DELETE /api/v1/projects/:id", "POST /api/v1/projects/:id/duplicate", "GET /api/v1/projects/:id/data", "PUT /api/v1/projects/:id/data/:khoa",
		"POST /api/v1/projects/:id/edit-requests", "GET /api/v1/project-edit-requests", "POST /api/v1/project-edit-requests/:rid/resolve"}
	if len(got) != len(want) {
		t.Errorf("số route = %d, cần %d", len(got), len(want))
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("thiếu route %s", w)
		}
	}
}
