package database

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// Test tích hợp: cần TEST_DATABASE_URL trỏ tới database thử (qspro_gotest). Không có thì bỏ qua.
func testDB(t *testing.T) *DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	d := New(Config{URL: url})
	t.Cleanup(d.Close)
	return d
}

func ctxOf(v any) context.Context {
	ctx := context.Background()
	m := jsval.AsMap(v)
	if m == nil {
		return ctx
	}
	return tenant.With(ctx, tenant.Ctx{
		UID:      m.Val("uid"),
		Role:     jsval.AsString(m.Val("role")),
		CongTyID: jsval.Or(m.Val("congTyId"), nil),
		ViewAs:   jsval.Or(m.Val("viewAs"), nil),
	})
}

var reTpl = regexp.MustCompile(`\{\{([^.}]+)\.(\d+)\.([^.}]+)\}\}`)

type caseOut struct {
	rows []*omap.Map
	err  error
}

func (o caseOut) json() string {
	var m *omap.Map
	if o.err != nil {
		var code, status any
		if c := CodeOf(o.err); c != "" {
			code = c
		}
		if s := StatusOf(o.err); s != 0 {
			status = float64(s)
		}
		m = omap.Of("err", o.err.Error(), "code", code, "status", status)
	} else {
		m = omap.Of("ok", jsval.Rows(o.rows))
	}
	s, _ := omap.MarshalString(m)
	return s
}

func runCase(d *DB, ctx context.Context, c *omap.Map) ([]*omap.Map, error) {
	tbl := jsval.AsString(c.Val("table"))
	o := Opt{NoScope: jsval.Truthy(c.Val("noScope"))}
	switch jsval.AsString(c.Val("op")) {
	case "select":
		opt := jsval.AsMap(c.Val("opt"))
		if opt == nil {
			return d.Select(ctx, tbl)
		}
		return d.Select(ctx, tbl, SelectOpt{
			Select: jsval.Str(opt.Val("select")), Filter: jsval.Str(opt.Val("filter")), Order: jsval.Str(opt.Val("order")),
			Limit: int(jsval.Num0(opt.Val("limit"))), NoScope: jsval.Truthy(opt.Val("noScope")),
		})
	case "insert":
		rows := []*omap.Map{}
		for _, r := range jsval.AsArray(c.Val("rows")) {
			rows = append(rows, jsval.AsMap(r))
		}
		return d.Insert(ctx, tbl, rows, o)
	case "update":
		return d.Update(ctx, tbl, jsval.Str(c.Val("filter")), jsval.AsMap(c.Val("patch")), o)
	case "remove":
		return d.Remove(ctx, tbl, jsval.Str(c.Val("filter")), o)
	}
	panic("op lạ")
}

// dumpCases chạy mọi ca trong tests/fixtures/db-diff-cases.json, trả mỗi ca 1 dòng "tên<TAB>json"
// (cùng định dạng với tests/fixtures/db-diff-golden.txt do bản Node sinh).
func dumpCases(t *testing.T, d *DB) string {
	raw, err := os.ReadFile("../../../tests/fixtures/db-diff-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	specV, err := omap.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	spec := jsval.AsMap(specV)
	ctxs := jsval.AsMap(spec.Val("contexts"))
	results := map[string]caseOut{}
	var sb strings.Builder
	for _, cv := range jsval.AsArray(spec.Val("cases")) {
		js, _ := omap.MarshalString(cv)
		js = reTpl.ReplaceAllStringFunc(js, func(m string) string {
			p := reTpl.FindStringSubmatch(m)
			i, _ := strconv.Atoi(p[2])
			r := results[p[1]]
			if r.err != nil || i >= len(r.rows) {
				return "MISSING"
			}
			return jsval.ToString(r.rows[i].Val(p[3]))
		})
		filled, err := omap.DecodeString(js)
		if err != nil {
			t.Fatal(err)
		}
		c := jsval.AsMap(filled)
		name := jsval.AsString(c.Val("n"))
		rows, err := runCase(d, ctxOf(ctxs.Val(jsval.AsString(c.Val("ctx")))), c)
		out := caseOut{rows: rows, err: err}
		results[name] = out
		sb.WriteString(name + "\t" + out.json() + "\n")
	}
	return sb.String()
}

// TestDiffDump: DIFF_OUT=<file> -> ghi kết quả ra file để so với bản Node (xem docs/ARCHITECTURE.md mục 9).
func TestDiffDump(t *testing.T) {
	d := testDB(t)
	out := os.Getenv("DIFF_OUT")
	if out == "" {
		t.Skip("chưa đặt DIFF_OUT")
	}
	if err := os.WriteFile(out, []byte(dumpCases(t, d)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSelectBasics(t *testing.T) {
	d := testDB(t)
	bg := context.Background()
	if !d.Ok() {
		t.Fatal("Ok() phải true")
	}
	rows, err := d.Select(bg, "cong_ty", SelectOpt{Select: "id,ma,ten,active", Order: "ma.asc"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Skip("cong_ty rỗng: cần database đã nạp seed (qspro_gotest), database chỉ có schema thì bỏ qua")
	}
	if ks := rows[0].Keys(); strings.Join(ks, ",") != "id,ma,ten,active" {
		t.Errorf("thứ tự khoá theo select: %v", ks)
	}
	if _, ok := rows[0].Val("active").(bool); !ok {
		t.Errorf("active phải là bool, được %T", rows[0].Val("active"))
	}
	ct := rows[0].Val("id")

	// bảng thuộc công ty: tự lọc theo ngữ cảnh, NoScope thì không
	scoped := tenant.With(bg, tenant.Ctx{UID: "u", Role: "admin", CongTyID: ct})
	mine, err := d.Select(scoped, "users", SelectOpt{Select: "id,cong_ty_id"})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range mine {
		if r.Val("cong_ty_id") != ct {
			t.Fatalf("lọt dòng của công ty khác: %v", r.Val("cong_ty_id"))
		}
	}
	all, err := d.Select(scoped, "users", SelectOpt{Select: "id", NoScope: true})
	if err != nil || len(all) < len(mine) {
		t.Fatalf("NoScope: %v", err)
	}

	// người dùng không có công ty bị chặn
	_, err = d.Select(tenant.With(bg, tenant.Ctx{UID: "u", Role: "staff"}), "users")
	if err == nil || err.Error() != "Tài khoản chưa gắn với công ty nào" {
		t.Errorf("phải chặn tài khoản không có công ty: %v", err)
	}
}

func TestErrorsLikePostgREST(t *testing.T) {
	d := testDB(t)
	bg := context.Background()
	_, err := d.Select(bg, "bang_khong_co")
	want := `DB GET bang_khong_co -> 404 {"code":"PGRST205","details":null,"hint":null,"message":"Could not find the table 'public.bang_khong_co' in the schema cache"}`
	if err == nil || err.Error() != want || CodeOf(err) != "PGRST205" || StatusOf(err) != 404 {
		t.Errorf("bảng lạ:\n got %v\nwant %s", err, want)
	}
	_, err = d.Select(bg, "du_an", SelectOpt{Select: "khong_co", NoScope: true})
	want = `DB GET du_an -> 400 {"code":"42703","details":null,"hint":null,"message":"column du_an.khong_co does not exist"}`
	if err == nil || err.Error() != want || CodeOf(err) != "42703" {
		t.Errorf("cột lạ:\n got %v\nwant %s", err, want)
	}
	_, err = d.Update(bg, "cong_ty", "", omap.Of("ghi_chu", "x"))
	want = `DB PATCH cong_ty -> 400 {"code":"PGRST100","details":null,"hint":null,"message":"Từ chối UPDATE không có điều kiện lọc"}`
	if err == nil || err.Error() != want {
		t.Errorf("update không lọc:\n got %v\nwant %s", err, want)
	}
	_, err = d.Remove(bg, "cong_ty", "")
	if err == nil || CodeOf(err) != "PGRST100" || !strings.Contains(err.Error(), "Từ chối DELETE không có điều kiện lọc") {
		t.Errorf("delete không lọc: %v", err)
	}
	_, err = d.InsertOne(bg, "audit_log", omap.Of("cot_la", 1.0))
	if err == nil || CodeOf(err) != "PGRST204" {
		t.Errorf("insert cột lạ: %v", err)
	}
	if got := Eq("ma_da", "A B/é"); got != "ma_da=eq.A%20B%2F%C3%A9" {
		t.Errorf("Eq: %s", got)
	}
	if got := Eq("id", 12.0); got != "id=eq.12" {
		t.Errorf("Eq số: %s", got)
	}
}

func TestWriteRoundTrip(t *testing.T) {
	d := testDB(t)
	bg := context.Background()
	const mark = "ZZGOTEST"
	_, _ = d.Remove(bg, "audit_log", Eq("action", mark))
	ins, err := d.Insert(bg, "audit_log", []*omap.Map{
		omap.Of("action", mark, "detail", "một", "bo_qua", omap.Undefined),
		omap.Of("action", mark, "detail", "hai"),
	})
	if err == nil {
		t.Fatal("khoá undefined vẫn là cột lạ -> phải lỗi PGRST204")
	}
	ins, err = d.Insert(bg, "audit_log", []*omap.Map{
		omap.Of("action", mark, "detail", "một", "username", omap.Undefined),
		omap.Of("action", mark, "detail", "hai", "username", "u2"),
	})
	if err != nil || len(ins) != 2 {
		t.Fatalf("insert: %v", err)
	}
	if ins[0].Val("username") != nil || ins[1].Val("username") != "u2" || ins[0].Val("detail") != "một" {
		t.Errorf("giá trị sau insert: %v", ins)
	}
	if _, ok := ins[0].Val("id").(float64); !ok {
		t.Errorf("id phải là số: %T", ins[0].Val("id"))
	}
	upd, err := d.Update(bg, "audit_log", Eq("action", mark)+"&detail=eq.hai", omap.Of("detail", "hai sửa"))
	if err != nil || len(upd) != 1 || upd[0].Val("detail") != "hai sửa" {
		t.Fatalf("update: %v %v", upd, err)
	}
	del, err := d.Remove(bg, "audit_log", Eq("action", mark))
	if err != nil || len(del) != 2 {
		t.Fatalf("remove: %v %v", del, err)
	}
	left, _ := d.Select(bg, "audit_log", SelectOpt{Filter: Eq("action", mark), NoScope: true})
	if len(left) != 0 {
		t.Fatal("còn sót dòng thử")
	}
}

// TestDiffGolden: DIFF_GOLDEN=<file kết quả của bản Node> -> chạy lại mọi ca và so từng dòng
// (bỏ qua id / thời điểm sinh tự động).
func TestDiffGolden(t *testing.T) {
	d := testDB(t)
	golden := os.Getenv("DIFF_GOLDEN")
	if golden == "" {
		t.Skip("chưa đặt DIFF_GOLDEN")
	}
	want, err := os.ReadFile(golden)
	if err != nil && !filepath.IsAbs(golden) {
		// đường dẫn tương đối tính từ gốc module (backend/), vì go test chạy trong thư mục của gói
		want, err = os.ReadFile(filepath.Join("..", "..", "..", golden))
	}
	if err != nil {
		t.Fatal(err)
	}
	g := strings.Split(strings.TrimSpace(NormalizeDiff(string(want))), "\n")
	h := strings.Split(strings.TrimSpace(NormalizeDiff(dumpCases(t, d))), "\n")
	if len(g) != len(h) {
		t.Fatalf("số ca khác nhau: node %d, go %d", len(g), len(h))
	}
	bad := 0
	for i := range g {
		if g[i] == h[i] || sortedRows(g[i]) == sortedRows(h[i]) {
			continue
		}
		bad++
		j := 0
		for j < len(g[i]) && j < len(h[i]) && g[i][j] == h[i][j] {
			j++
		}
		cut := func(s string) string { return s[max(0, j-80):min(len(s), j+200)] }
		t.Errorf("KHÁC ở ca %d, từ byte %d:\nnode: %s\n  go: %s", i+1, j, cut(g[i]), cut(h[i]))
	}
	t.Logf("%d ca, %d khác", len(g), bad)
}

// sortedRows: UPDATE / DELETE nhiều dòng không có ORDER BY nên thứ tự dòng trả về do Postgres quyết định
// (bản Node cũng vậy) -> với các ca upd-* / del-* so không kể thứ tự dòng.
func sortedRows(line string) string {
	name, js, _ := strings.Cut(line, "\t")
	if !strings.HasPrefix(name, "upd-") && !strings.HasPrefix(name, "del-") {
		return line
	}
	v, err := omap.DecodeString(js)
	if err != nil {
		return line
	}
	rows := jsval.AsArray(jsval.AsMap(v).Val("ok"))
	if rows == nil {
		return line
	}
	parts := make([]string, len(rows))
	for i, r := range rows {
		parts[i], _ = omap.MarshalString(r)
	}
	sort.Strings(parts)
	return name + "\t" + strings.Join(parts, "\n")
}

var (
	reVolatile  = regexp.MustCompile(`"(id|sp_id|sp_kem_id)":("[^"]*"|-?[0-9.]+)`)
	reTimestamp = regexp.MustCompile(`\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?\+00(:00)?`)
	reFailRow   = regexp.MustCompile(`Failing row contains \(\d+`)
)

// NormalizeDiff che các giá trị sinh tự động (id, thời điểm) trước khi so hai bản.
func NormalizeDiff(s string) string {
	s = reVolatile.ReplaceAllString(strings.ReplaceAll(s, "\r", ""), `"$1":"~"`)
	s = reTimestamp.ReplaceAllString(s, "~T~")
	return reFailRow.ReplaceAllString(s, "Failing row contains (~")
}
