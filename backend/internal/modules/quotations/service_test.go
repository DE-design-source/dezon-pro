package quotations

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

/* Đối chiếu với Node: testdata/gen.js chạy các bước của testdata/cases.json qua MÃ NODE THẬT (store_supa.js, export.js)
   trên qspro_nodetest và ghi testdata/golden.txt; file Excel của Node được đọc lại bằng ExcelJS rồi mô tả ở mức ô.
     - TestSteps:  cùng các bước với kho khai_toan GIẢ (không cần database), so từng dòng với golden.
     - TestDBDiff: cùng các bước trên qspro_gotest (TEST_DATABASE_URL), so cả các dòng khai_toan sau mỗi lần ghi.
   Bước xuất Excel so MÔ HÌNH workbook (dumpBook) với mô tả file của Node; file .xlsx thật của Go được so bằng
   testdata/compare.js (đặt QUOT_XLSX_OUT để ghi file). getLines / getProject / Lark / HTTP đều là bản giả cùng dữ liệu hai bên. */

// ───────────── bản giả ─────────────

type stubs struct {
	lines   []any
	project *omap.Map
	png     []byte
	jpg     []byte
	media   []any
	fetched []any
}

func (s *stubs) GetLines(_ context.Context, _ any) ([]any, error) {
	return jsval.AsArray(omap.DeepClone(s.lines)), nil
}

func (s *stubs) GetProject(_ context.Context, _ any) (*omap.Map, error) {
	if s.project == nil {
		return nil, nil
	}
	return jsval.AsMap(omap.DeepClone(s.project)), nil
}

func (s *stubs) MediaDownload(_ context.Context, token string) ([]byte, string, error) {
	s.media = append(s.media, token)
	if token == "bad" {
		return nil, "", errors.New("Tải media lỗi HTTP 404")
	}
	if strings.HasPrefix(token, "jpg") {
		return s.jpg, "application/octet-stream", nil
	}
	return s.png, "application/octet-stream", nil
}

// RoundTrip: bản giả của fetch trong gen.js - theo đường dẫn trả png / jpg / html / 404 / content-length quá lớn.
func (s *stubs) RoundTrip(req *http.Request) (*http.Response, error) {
	u := hrefOf(req.URL)
	s.fetched = append(s.fetched, u)
	res := &http.Response{StatusCode: 200, Header: http.Header{}, Request: req}
	body := []byte("<html></html>")
	switch {
	case strings.Contains(u, "notfound"):
		res.StatusCode, body = 404, nil
	case strings.Contains(u, ".jpg"):
		body = s.jpg
	case strings.Contains(u, ".png"):
		body = s.png
	}
	res.Header.Set("Content-Length", strconv.Itoa(len(body)))
	if strings.Contains(u, "toobig") {
		res.Header.Set("Content-Length", "6000000")
	}
	res.Body = io.NopCloser(bytes.NewReader(body))
	return res, nil
}

// fakeRepo: bảng khai_toan trong bộ nhớ.
type fakeRepo struct {
	rows   []*omap.Map
	nextID float64
}

func (r *fakeRepo) of(maDA any) []*omap.Map {
	var out []*omap.Map
	for _, x := range r.rows {
		if jsval.StrictEquals(x.Val("ma_da"), maDA) {
			out = append(out, x)
		}
	}
	return out
}

func (r *fakeRepo) CoverRows(_ context.Context, maDA any) ([]*omap.Map, error) {
	out := r.of(maDA)
	sort.SliceStable(out, func(i, j int) bool {
		return jsval.ToNumber(out[i].Val("sort_no")) < jsval.ToNumber(out[j].Val("sort_no"))
	})
	return out, nil
}

func (r *fakeRepo) CoverIDs(_ context.Context, maDA any) ([]*omap.Map, error) {
	out := []*omap.Map{}
	for _, x := range r.of(maDA) {
		out = append(out, omap.Of("id", x.Val("id")))
	}
	return out, nil
}

func (r *fakeRepo) InsertCover(_ context.Context, rows []*omap.Map) error {
	for _, x := range rows { // giả ràng buộc ck_cost_estimate_lines_cost: cả lệnh hỏng, không ghi dòng nào (chữ như golden save-neg)
		if jsval.ToNumber(x.Val("chi_phi")) < 0 {
			return errors.New(`DB POST khai_toan -> 409 {"code":"23514","message":"new row for relation \"cost_estimate_lines\" violates check constraint \"ck_cost_estimate_lines_cost\""}`)
		}
	}
	for _, x := range rows {
		r.nextID++
		r.rows = append(r.rows, omap.Assign(omap.Of("id", r.nextID), x))
	}
	return nil
}

func (r *fakeRepo) RemoveCover(_ context.Context, ids string) error {
	del := map[string]bool{}
	for _, id := range strings.Split(ids, ",") {
		del[id] = true
	}
	kept := r.rows[:0]
	for _, x := range r.rows {
		if !del[jsval.ToString(x.Val("id"))] {
			kept = append(kept, x)
		}
	}
	r.rows = kept
	return nil
}

// ───────────── mô tả workbook như xlsx-dump.js ─────────────

func argb(c string) *omap.Map { return omap.Of("argb", c) }

func fontJSON(f *xFont) *omap.Map {
	m := omap.New()
	if f.Bold {
		m.Set("bold", true)
	}
	if f.Color != "" {
		m.Set("color", argb(f.Color))
	}
	if f.Italic {
		m.Set("italic", true)
	}
	if f.Name != "" {
		m.Set("name", f.Name)
	}
	if f.Size != 0 {
		m.Set("size", f.Size)
	}
	return m
}

// styleJSON: style của 1 ô theo dạng ExcelJS đọc lại từ file (khoá xếp theo bảng chữ cái như clean() của xlsx-dump.js).
func styleJSON(st *xStyle) *omap.Map {
	m := omap.New()
	if a := st.Align; a != nil {
		am := omap.New()
		if a.H != "" {
			am.Set("horizontal", a.H)
		}
		if a.V != "" {
			am.Set("vertical", a.V)
		}
		if a.Wrap {
			am.Set("wrapText", true)
		}
		if am.Len() > 0 {
			m.Set("alignment", am)
		}
	}
	// ô có style luôn đọc lại được border / fill / font: không đặt thì là bản mặc định số 0 của styles.xml
	if st.Border {
		side := func() *omap.Map { return omap.Of("color", argb(mauLine), "style", "thin") }
		m.Set("border", omap.Of("bottom", side(), "left", side(), "right", side(), "top", side()))
	} else {
		m.Set("border", omap.New())
	}
	if st.Fill != "" {
		m.Set("fill", omap.Of("fgColor", argb(st.Fill), "pattern", "solid", "type", "pattern"))
	} else {
		m.Set("fill", omap.Of("pattern", "none", "type", "pattern"))
	}
	if st.Font != nil {
		m.Set("font", fontJSON(st.Font))
	} else {
		m.Set("font", omap.Of("color", omap.Of("theme", 1.0), "family", 2.0, "name", "Calibri", "scheme", "minor", "size", 11.0))
	}
	if st.NumFmt != "" {
		m.Set("numFmt", st.NumFmt)
	}
	return m
}

func dumpBook(t *testing.T, wb *xBook) *omap.Map {
	t.Helper()
	styles := []any{}
	idx := map[string]float64{}
	styleOf := func(st *xStyle) float64 {
		if st.empty() {
			return -1
		}
		js, err := omap.MarshalString(styleJSON(st))
		if err != nil {
			t.Fatal(err)
		}
		if i, ok := idx[js]; ok {
			return i
		}
		idx[js] = float64(len(styles))
		styles = append(styles, styleJSON(st))
		return idx[js]
	}
	sheets := []any{}
	for _, ws := range wb.sheets {
		merges := []string{}
		for _, m := range ws.merges {
			merges = append(merges, cellName(m[1], m[0])+":"+cellName(m[3], m[2]))
		}
		sort.Strings(merges)
		mg := make([]any, len(merges))
		for i, m := range merges {
			mg[i] = m
		}
		widths, heights, cells := omap.New(), omap.New(), []any{}
		for _, c := range sortedKeys(ws.widths) {
			if w := ws.widths[c]; w != 9 {
				widths.Set(strconv.Itoa(c), w)
			}
		}
		for _, r := range sortedKeys(ws.rows) {
			row := ws.rows[r]
			if row.ht != 0 {
				heights.Set(strconv.Itoa(r), row.ht)
			}
			for _, c := range sortedKeys(row.cells) {
				cell := row.cells[c]
				st := styleOf(cell.st)
				var typ float64
				var val, master any
				switch v := cell.val.(type) {
				case string:
					typ, val = 3, docLai(v)
				case float64:
					typ, val = 2, v
				case bool:
					typ, val = 9, v
				case []xRun:
					runs := make([]any, len(v))
					for i, run := range v {
						rm := omap.New()
						if run.Font != nil {
							rm.Set("font", fontJSON(run.Font))
						}
						runs[i] = rm.Set("text", docLai(run.Text))
					}
					typ, val = 8, omap.Of("richText", runs)
				}
				if cell.master != nil {
					typ = 1
					for _, m := range ws.merges {
						if r >= m[0] && r <= m[2] && c >= m[1] && c <= m[3] {
							master = cellName(m[1], m[0])
						}
					}
				}
				if typ == 0 && st < 0 {
					continue
				}
				cells = append(cells, []any{cellName(c, r), typ, val, st, master})
			}
		}
		images := []any{}
		for _, im := range ws.images {
			sum := sha1.Sum(im.buf)
			images = append(images, omap.Of("col", float64(im.col), "colOff", float64(im.colOff), "row", float64(im.row),
				"rowOff", float64(im.rowOff), "w", 60.0, "h", 48.0, "editAs", "oneCell", "ext", im.ext, "sha1", hex.EncodeToString(sum[:])))
		}
		sheets = append(sheets, omap.Of("name", ws.name, "ySplit", float64(ws.ySplit), "merges", mg, "widths", widths,
			"heights", heights, "cells", cells, "images", images))
	}
	return omap.Of("sheets", sheets, "styles", styles)
}

// ───────────── chạy các bước ─────────────

type caseSpec struct {
	spec   *omap.Map
	golden map[string]string
}

func loadCases(t *testing.T) *caseSpec {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	cs := &caseSpec{spec: jsval.AsMap(v), golden: map[string]string{}}
	f, err := os.Open(filepath.Join("testdata", "golden.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		if name, js, ok := strings.Cut(sc.Text(), "\t"); ok {
			cs.golden[name] = js
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return cs
}

// ExcelJS (và Excel) đọc cụm _xHHHH_ trong chuỗi thành ký tự có mã đó (text-xform.js:22).
var reBstrDoc = regexp.MustCompile(`_x([0-9A-F]{4})_`)

// docLai: chuỗi của mô hình như bộ đọc file trả về.
func docLai(s string) string {
	return reBstrDoc.ReplaceAllStringFunc(xlsStr(s), func(m string) string {
		n, _ := strconv.ParseUint(m[2:6], 16, 32)
		return string(rune(n))
	})
}

// id dòng trong thông báo lỗi Postgres và id công ty khác nhau tuỳ database thử: che như gen.js.
var (
	reFailingRow = regexp.MustCompile(`Failing row contains \(\d+,`)
	reUUID       = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
)

func firstDiff(a, b string) string {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	cut := func(s string) string {
		from, to := max(0, i-120), min(len(s), i+160)
		return s[from:to]
	}
	return "vị trí " + strconv.Itoa(i) + "\n  node: ..." + cut(a) + "\n  go:   ..." + cut(b)
}

func errOut(err error) *omap.Map { return omap.Of("err", err.Error()) }

// runSteps chạy cases.json. dumpRows == nil: kho giả (bỏ qua các bước cần database thật).
func runSteps(t *testing.T, cs *caseSpec, svc *Service, st *stubs, ctx context.Context, dumpRows func() (any, error)) {
	t.Helper()
	reg := rpc.NewRegistry()
	svc.RegisterRPC(reg)
	outDir := os.Getenv("QUOT_XLSX_OUT")
	if outDir != "" {
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	save := func(name string, buf []byte) {
		if outDir != "" {
			if err := os.WriteFile(filepath.Join(outDir, name+".xlsx"), buf, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	arg := func(args []any, i int) any {
		if i < len(args) {
			return args[i]
		}
		return jsval.Undefined
	}
	ran := 0
	for _, sv := range jsval.AsArray(cs.spec.Val("steps")) {
		step := jsval.AsMap(sv)
		name := jsval.AsString(step.Val("n"))
		fn := jsval.AsString(step.Val("fn"))
		args := jsval.AsArray(step.Val("args"))
		if dumpRows == nil && (step.Has("dump") || jsval.Truthy(step.Val("dbOnly"))) {
			continue
		}
		lineSet := jsval.StrOr(step.Val("lines"), "NONE")
		st.lines = jsval.AsArray(jsval.GetPath(cs.spec.Val("lines"), lineSet))
		st.project = nil
		if p := step.Val("project"); jsval.Truthy(p) {
			st.project = jsval.AsMap(jsval.GetPath(cs.spec.Val("projects"), jsval.AsString(p)))
		}
		st.media, st.fetched = []any{}, []any{}
		var out any
		switch {
		case step.Has("dump"):
			rows, err := dumpRows()
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			out = rows
		case fn == "urls":
			list := []any{}
			for _, u := range jsval.AsArray(cs.spec.Val("urls")) {
				st.fetched = []any{}
				res := svc.fetchImage(ctx, jsval.AsString(u))
				list = append(list, []any{u, len(st.fetched) > 0, res != nil})
			}
			out = list
		case fn == "bang":
			wb, err := buildBang(arg(args, 0))
			if err != nil {
				out = errOut(err)
				break
			}
			buf, err := svc.BuildBangXlsx(ctx, arg(args, 0))
			if err != nil {
				t.Fatalf("%s: mô hình dựng được nhưng ghi file lỗi: %v", name, err)
			}
			checkFile(t, name, wb, buf)
			save(name, buf)
			out = omap.Of("ok", omap.Of("dump", dumpBook(t, wb)))
		case fn == "exportBaoGia":
			res, err := reg.Call(ctx, fn, nil, args...)
			if err != nil {
				out = errOut(err)
				break
			}
			file := res.(*ExportFile)
			buf, err := base64.StdEncoding.DecodeString(file.Base64)
			if err != nil {
				t.Fatalf("%s: base64: %v", name, err)
			}
			save(name, buf)
			st.media, st.fetched = []any{}, []any{}
			wb, _, err := svc.buildBaoGia(ctx, arg(args, 0), arg(args, 1), arg(args, 3), arg(args, 4), arg(args, 5), arg(args, 6), arg(args, 7), arg(args, 8))
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			checkFile(t, name, wb, buf)
			out = omap.Of("ok", omap.Of("name", file.Name, "mimeType", file.MimeType, "media", st.media, "fetched", st.fetched,
				"dump", dumpBook(t, wb)))
		case fn == "getQuote": // không phải hàm rpc của Node, chỉ exportBaoGia dùng
			res, err := svc.GetQuote(ctx, arg(args, 0))
			if err != nil {
				out = errOut(err)
			} else {
				out = omap.Of("ok", res)
			}
		default:
			res, err := reg.Call(ctx, fn, nil, args...)
			if err != nil {
				out = errOut(err)
			} else {
				out = omap.Of("ok", res)
			}
		}
		js, err := omap.MarshalString(out)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		js = reUUID.ReplaceAllString(reFailingRow.ReplaceAllString(js, "Failing row contains (<id>,"), "<uuid>")
		want, ok := cs.golden[name]
		if !ok {
			t.Errorf("%s: golden.txt không có bước này (chạy lại testdata/gen.js)", name)
			continue
		}
		ran++
		if js != want {
			t.Errorf("%s: khác Node tại %s", name, firstDiff(want, js))
		}
	}
	if ran == 0 {
		t.Fatal("không có bước nào được chạy")
	}
}

// checkFile đọc lại file Go ghi ra bằng excelize và so với mô hình: tên + thứ tự sheet, vùng gộp, giá trị từng ô.
func checkFile(t *testing.T, name string, wb *xBook, buf []byte) {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(buf))
	if err != nil {
		t.Errorf("%s: excelize không mở được file: %v", name, err)
		return
	}
	defer f.Close()
	list := f.GetSheetList()
	if len(list) != len(wb.sheets) {
		t.Errorf("%s: %d sheet, mô hình có %d", name, len(list), len(wb.sheets))
		return
	}
	for i, ws := range wb.sheets {
		if list[i] != ws.name {
			t.Errorf("%s: sheet %d tên %q, cần %q", name, i+1, list[i], ws.name)
			continue
		}
		mcs, err := f.GetMergeCells(ws.name)
		if err != nil {
			t.Errorf("%s/%s: %v", name, ws.name, err)
		}
		if len(mcs) != len(ws.merges) {
			t.Errorf("%s/%s: %d vùng gộp trong file, mô hình có %d", name, ws.name, len(mcs), len(ws.merges))
		}
		bad := 0
		for _, r := range sortedKeys(ws.rows) {
			for _, c := range sortedKeys(ws.rows[r].cells) {
				cell := ws.rows[r].cells[c]
				at := cellName(c, r)
				got, err := f.GetCellValue(ws.name, at, excelize.Options{RawCellValue: true})
				if err != nil {
					t.Errorf("%s/%s!%s: %v", name, ws.name, at, err)
					continue
				}
				want := ""
				switch v := cell.val.(type) {
				case string:
					want = docLai(v)
				case float64:
					want = jsval.NumberToString(v)
				case bool:
					want = "0"
					if v {
						want = "1"
					}
				case []xRun:
					for _, run := range v {
						want += docLai(run.Text)
					}
				}
				if cell.master != nil {
					continue // excelize trả giá trị ô chính cho ô bị gộp
				}
				if got != want && bad < 5 {
					bad++
					t.Errorf("%s/%s!%s: file có %q, mô hình %q", name, ws.name, at, got, want)
				}
			}
		}
	}
}

func newStubs(cs *caseSpec) *stubs {
	png, _ := base64.StdEncoding.DecodeString(jsval.AsString(cs.spec.Val("png")))
	jpg, _ := base64.StdEncoding.DecodeString(jsval.AsString(cs.spec.Val("jpg")))
	return &stubs{png: png, jpg: jpg}
}

func newTestService(st *stubs, db *database.DB, repo Repository) *Service {
	return New(Deps{DB: db, Repo: repo, Lines: st, Projects: st, Media: st, HTTP: &http.Client{Transport: st}})
}

func TestSteps(t *testing.T) {
	cs := loadCases(t)
	st := newStubs(cs)
	svc := newTestService(st, nil, &fakeRepo{})
	runSteps(t, cs, svc, st, context.Background(), nil)
}

func TestDBDiff(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !strings.Contains(url, "/qspro_gotest") {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	cs := loadCases(t)
	prefix, p1 := jsval.AsString(cs.spec.Val("prefix")), jsval.AsString(cs.spec.Val("p1"))
	db := database.New(database.Config{URL: url})
	defer db.Close()
	bg := context.Background()
	no := database.Opt{NoScope: true}

	// Tài khoản có sẵn trong seed, không lấy "tài khoản đầu tiên theo id": gói test khác tạo rồi xoá tài khoản + công ty tạm
	// có uuid nhỏ giữa chừng, dòng của test này mất theo công ty đó.
	us, err := db.Select(bg, "users", database.SelectOpt{Filter: database.Eq("username", "admin") + "&cong_ty_id=not.is.null", Limit: 1, NoScope: true})
	if err != nil || len(us) == 0 {
		t.Fatalf("database thử không có tài khoản admin thuộc công ty: %v", err)
	}
	ctx := tenant.With(bg, tenant.Ctx{UID: us[0].Val("id"), Role: "admin", CongTyID: us[0].Val("cong_ty_id")})
	like := "ma_da=like." + prefix + "*"
	cleanup := func() {
		if _, err := db.Remove(bg, "khai_toan", like, no); err != nil {
			t.Errorf("dọn khai_toan: %v", err)
		}
		if _, err := db.Remove(bg, "du_an", like, no); err != nil {
			t.Errorf("dọn du_an: %v", err)
		}
	}
	cleanup()
	defer cleanup()
	if _, err := db.InsertOne(ctx, "du_an", omap.Of("ma_da", p1, "ten_du_an", prefix+"du an thu")); err != nil {
		t.Fatal(err)
	}

	st := newStubs(cs)
	svc := newTestService(st, db, nil)
	runSteps(t, cs, svc, st, ctx, func() (any, error) {
		rows, err := db.Select(ctx, "khai_toan", database.SelectOpt{Filter: database.Eq("ma_da", p1), Order: "sort_no.asc"})
		if err != nil {
			return nil, err
		}
		out := make([]any, len(rows))
		for i, r := range rows {
			c := r.Clone()
			c.Delete("id")
			out[i] = c
		}
		return out, nil
	})

	// Dự án THẬT của database thử (testdata/gen.js --real): dòng + dự án lấy từ file Node ghi ra, tờ bìa đọc từ qspro_gotest.
	real := os.Getenv("QUOT_REAL")
	if real == "" {
		return
	}
	b, err := os.ReadFile(real)
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	fx := jsval.AsMap(v)
	st.lines, st.project = jsval.AsArray(fx.Val("lines")), jsval.AsMap(fx.Val("project"))
	st.media, st.fetched = []any{}, []any{}
	rctx := tenant.With(bg, tenant.Ctx{UID: fx.Val("uid"), Role: "admin", CongTyID: fx.Val("congTyId")})
	a := jsval.AsArray(fx.Val("args"))
	file, err := svc.ExportBaoGia(rctx, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], jsval.Undefined)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ what, got, want string }{
		{"name", file.Name, jsval.AsString(fx.Val("name"))},
		{"media", jsval.ToString(st.media), jsval.ToString(fx.Val("media"))},
		{"fetched", jsval.ToString(st.fetched), jsval.ToString(fx.Val("fetched"))},
	} {
		if c.got != c.want {
			t.Errorf("dự án thật: %s khác Node\n  node: %s\n  go:   %s", c.what, c.want, c.got)
		}
	}
	if dir := os.Getenv("QUOT_XLSX_OUT"); dir != "" {
		buf, _ := base64.StdEncoding.DecodeString(file.Base64)
		if err := os.WriteFile(filepath.Join(dir, "real.xlsx"), buf, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
