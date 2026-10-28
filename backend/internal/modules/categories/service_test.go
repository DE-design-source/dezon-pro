package categories

import (
	"archive/zip"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/specs"
)

// Mọi giá trị mong đợi nằm trong testdata/golden.json, do testdata/gen.js ghi lại từ mã Node THẬT
// (store_supa.js, *-template.js, handler Express chép nguyên văn từ index.js). Đối chiếu file mẫu ở mức ô bằng ExcelJS:
// xem testdata/compare.js.

func loadGolden(t *testing.T) *omap.Map {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return jsval.AsMap(v)
}

func js(t *testing.T, v any) string {
	t.Helper()
	s, err := omap.MarshalString(v)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// arg: giá trị tham số trong golden; {"$undefined": true} là undefined của JS.
func arg(v any) any {
	if m := jsval.AsMap(v); m != nil && m.Has("$undefined") {
		return jsval.Undefined
	}
	return v
}

func TestNganhCuaGolden(t *testing.T) {
	cases := jsval.AsArray(loadGolden(t).Val("nganhCua"))
	if len(cases) < 200 {
		t.Fatalf("golden thiếu ca: %d", len(cases))
	}
	for _, cv := range cases {
		c := jsval.AsMap(cv)
		if got := NganhCua(arg(c.Val("nganh")), arg(c.Val("hm"))); got != c.Val("out") {
			t.Errorf("NganhCua(%s, %s) = %q, node = %v", js(t, c.Val("nganh")), js(t, c.Val("hm")), got, c.Val("out"))
		}
	}
}

func TestSpecNganhVaMuc(t *testing.T) {
	for ng, want := range map[string]*specs.Spec{"vs": specs.VS, "son": specs.SON, "ct": specs.CT, "dl": specs.DL, "den": nil, "": nil, "VS": nil, " vs": nil} {
		if got := SpecNganh(ng); got != want {
			t.Errorf("SpecNganh(%q) sai", ng)
		}
	}
	got := []any{}
	MucNganh.Each(func(k string, v any) { got = append(got, []any{k, v}) })
	g := loadGolden(t)
	// golden của Node chưa có dl (ngành chỉ bản Go, nối cuối): so phần Node + kiểm riêng dl
	if js(t, got[len(got)-1]) != js(t, []any{"dl", "Điện lạnh"}) || Muc("dl") != "Điện lạnh" {
		t.Errorf("MUC_NGANH thiếu dl ở cuối: %s", js(t, got))
	}
	got = got[:len(got)-1]
	if a, b := js(t, got), js(t, g.Val("mucNganh")); a != b {
		t.Errorf("MUC_NGANH\n go:   %s\n node: %s", a, b)
	}
	for _, kv := range jsval.AsArray(g.Val("mucNganh")) {
		p := jsval.AsArray(kv)
		if Muc(jsval.AsString(p[0])) != p[1] {
			t.Errorf("Muc(%v) = %q", p[0], Muc(jsval.AsString(p[0])))
		}
	}
	if Muc("la") != "Thiết bị đèn" || Muc("") != "Thiết bị đèn" {
		t.Error("Muc phải mặc định Thiết bị đèn")
	}
}

// nodePart: bảng nhãn <-> cột của Go = bảng của Node + nhãn Điện lạnh nối cuối (ngành chỉ bản Go).
// Trả phần đầu dài n để so với golden; mọi phần thêm phải là nhãn của dl-spec.js (lbAt = vị trí nhãn trong cặp).
func nodePart(t *testing.T, ds []any, n, lbAt int) []any {
	t.Helper()
	if len(ds) < n {
		t.Fatalf("bảng ngắn hơn bản Node: %d < %d", len(ds), n)
	}
	for _, x := range ds[n:] {
		if lb := jsval.AsString(jsval.AsArray(x)[lbAt]); specs.DL.Metric.Val(lb) == nil {
			t.Errorf("thêm ngoài bản Node mà không phải nhãn Điện lạnh: %s", js(t, x))
		}
	}
	return ds[:n]
}

func TestLabelColGolden(t *testing.T) {
	g := loadGolden(t)
	l2c := []any{}
	for _, lc := range DBLabel2Col {
		l2c = append(l2c, []any{lc.Label, lc.Col})
		if ColOf(lc.Label) != lc.Col {
			t.Errorf("ColOf(%q) = %q, bảng = %q", lc.Label, ColOf(lc.Label), lc.Col)
		}
	}
	l2c = nodePart(t, l2c, len(jsval.AsArray(g.Val("dbLabel2Col"))), 0)
	if a, b := js(t, l2c), js(t, g.Val("dbLabel2Col")); a != b {
		t.Errorf("DB_LABEL2COL khác Node (thứ tự / nội dung)\n go:   %s\n node: %s", a, b)
	}
	c2l := []any{}
	for _, lc := range Col2Label {
		c2l = append(c2l, []any{lc.Col, lc.Label})
		if LabelOf(lc.Col) != lc.Label {
			t.Errorf("LabelOf(%q) = %q", lc.Col, LabelOf(lc.Col))
		}
	}
	c2l = nodePart(t, c2l, len(jsval.AsArray(g.Val("col2Label"))), 1)
	if a, b := js(t, c2l), js(t, g.Val("col2Label")); a != b {
		t.Errorf("COL2LABEL khác Node\n go:   %s\n node: %s", a, b)
	}
	labels := Labels()
	if len(labels) != len(DBLabel2Col) || labels[0] != "MÃ SẢN PHẨM" {
		t.Errorf("Labels() sai: %d", len(labels))
	}
	labels[0] = "x" // slice mới mỗi lần gọi
	if DBLabel2Col[0].Label != "MÃ SẢN PHẨM" || ColOf("khong co") != "" || LabelOf("khong_co") != "" {
		t.Error("bảng nhãn bị sửa hoặc tra nhãn lạ không ra rỗng")
	}
}

func TestSonTemplateNameGolden(t *testing.T) {
	for _, kv := range jsval.AsArray(loadGolden(t).Val("tenSon")) {
		p := jsval.AsArray(kv)
		if got := SonTemplateName(p[0]); got != p[1] {
			t.Errorf("SonTemplateName(%q) = %q, node = %v", p[0], got, p[1])
		}
	}
}

func buildVariant(kind string, hm any) ([]byte, error) {
	switch kind {
	case "vs":
		return BuildVsTemplate()
	case "son":
		return BuildSonTemplate(hm)
	}
	return BuildCtTemplate(hm)
}

func cotMauOf(kind string, hm any) []cot {
	switch kind {
	case "vs":
		return vsCotMau()
	case "son":
		return sonCotMau(specs.SON.ChuanHM(hm))
	}
	return ctCotMau(specs.CT.ChuanHM(hm))
}

func TestCotMauGolden(t *testing.T) {
	for _, vv := range jsval.AsArray(loadGolden(t).Val("variants")) {
		v := jsval.AsMap(vv)
		got := []any{}
		for _, c := range cotMauOf(jsval.AsString(v.Val("kind")), v.Val("hm")) {
			req := 0.0
			if c.Req {
				req = 1
			}
			got = append(got, []any{c.Label, req, c.Width})
		}
		if a, b := js(t, got), js(t, v.Val("cotMau")); a != b {
			t.Errorf("%v: cotMau\n go:   %s\n node: %s", v.Val("name"), a, b)
		}
	}
}

func argb(c string) *omap.Map {
	c = strings.ToUpper(strings.TrimPrefix(c, "#"))
	if len(c) == 6 {
		c = "FF" + c
	}
	return omap.Of("argb", c)
}

// styleExcelJS đổi style đọc lại bằng excelize sang dạng cell.style của ExcelJS (khoá xếp theo bảng chữ cái như xlsx-dump.js).
func styleExcelJS(t *testing.T, f *excelize.File, id int) *omap.Map {
	out := omap.New()
	if id == 0 {
		return out
	}
	st, err := f.GetStyle(id)
	if err != nil {
		t.Fatal(err)
	}
	if a := st.Alignment; a != nil && (a.Horizontal != "" || a.Vertical != "" || a.WrapText) {
		al := omap.New()
		if a.Horizontal != "" {
			al.Set("horizontal", a.Horizontal)
		}
		if a.Vertical == "center" {
			al.Set("vertical", "middle")
		} else if a.Vertical != "" {
			al.Set("vertical", a.Vertical)
		}
		if a.WrapText {
			al.Set("wrapText", true)
		}
		out.Set("alignment", al)
	}
	sides := map[string]*omap.Map{}
	for _, b := range st.Border {
		if b.Style == 1 {
			sides[b.Type] = omap.Of("color", argb(b.Color), "style", "thin")
		}
	}
	border := omap.New()
	for _, side := range []string{"bottom", "left", "right", "top"} {
		if s := sides[side]; s != nil {
			border.Set(side, s)
		}
	}
	out.Set("border", border)
	if st.Fill.Type == "pattern" && st.Fill.Pattern == 1 && len(st.Fill.Color) > 0 {
		out.Set("fill", omap.Of("fgColor", argb(st.Fill.Color[0]), "pattern", "solid", "type", "pattern"))
	} else {
		out.Set("fill", omap.Of("pattern", "none", "type", "pattern"))
	}
	if fn := st.Font; fn != nil {
		font := omap.New()
		if fn.Bold {
			font.Set("bold", true)
		}
		font.Set("color", argb(fn.Color))
		if fn.Italic {
			font.Set("italic", true)
		}
		font.Set("name", fn.Family).Set("size", fn.Size)
		out.Set("font", font)
	}
	return out
}

// File mẫu đọc lại bằng excelize phải khớp bản mô tả ExcelJS của file Node: tên sheet, giá trị và kiểu từng ô, style,
// vùng gộp, độ rộng cột, chiều cao dòng, khung cố định, người tạo.
func TestTemplatesGolden(t *testing.T) {
	variants := jsval.AsArray(loadGolden(t).Val("variants"))
	if len(variants) < 30 {
		t.Fatalf("golden thiếu biến thể: %d", len(variants))
	}
	cells := 0
	for _, vv := range variants {
		v := jsval.AsMap(vv)
		name := jsval.AsString(v.Val("name"))
		buf, err := buildVariant(jsval.AsString(v.Val("kind")), v.Val("hm"))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		f, err := excelize.OpenReader(bytes.NewReader(buf))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		d := jsval.AsMap(v.Val("dump"))
		styles := jsval.AsArray(d.Val("styles"))
		props, err := f.GetDocProps()
		if err != nil || props.Creator != d.Val("creator") || props.LastModifiedBy != d.Val("lastModifiedBy") {
			t.Errorf("%s: docProps %+v (%v)", name, props, err)
		}
		sheets := jsval.AsArray(d.Val("sheets"))
		list := f.GetSheetList()
		if len(list) != len(sheets) {
			t.Fatalf("%s: %d sheet, node %d", name, len(list), len(sheets))
		}
		for si, sv := range sheets {
			s := jsval.AsMap(sv)
			sh := list[si]
			if sh != s.Val("name") {
				t.Errorf("%s: sheet %d tên %q, node %v", name, si, sh, s.Val("name"))
			}
			merges, _ := f.GetMergeCells(sh)
			mg := []any{}
			for _, m := range merges {
				mg = append(mg, m.GetStartAxis()+":"+m.GetEndAxis())
			}
			if a, b := js(t, mg), js(t, s.Val("merges")); a != b {
				t.Errorf("%s/%s: merge %s, node %s", name, sh, a, b)
			}
			panes, _ := f.GetPanes(sh)
			var view *omap.Map
			if vs := jsval.AsArray(s.Val("views")); len(vs) > 0 {
				view = jsval.AsMap(vs[0])
			}
			if view.Val("state") == "frozen" {
				if !panes.Freeze || float64(panes.YSplit) != view.Val("ySplit") || float64(panes.XSplit) != view.Val("xSplit") || panes.TopLeftCell != view.Val("topLeftCell") {
					t.Errorf("%s/%s: khung cố định %+v, node %s", name, sh, panes, js(t, view))
				}
			} else if panes.Freeze {
				t.Errorf("%s/%s: không được cố định khung", name, sh)
			}
			for _, cv := range jsval.AsArray(s.Val("columns")) {
				c := jsval.AsMap(cv)
				col, _ := excelize.ColumnNumberToName(int(jsval.ToNumber(c.Val("n"))))
				if w, _ := f.GetColWidth(sh, col); w != c.Val("width") {
					t.Errorf("%s/%s: cột %s rộng %v, node %v", name, sh, col, w, c.Val("width"))
				}
			}
			rows := jsval.AsArray(s.Val("rows"))
			if all, _ := f.GetRows(sh); len(all) != len(rows) {
				t.Errorf("%s/%s: %d dòng, node %d", name, sh, len(all), len(rows))
			}
			for _, rv := range rows {
				r := jsval.AsMap(rv)
				n := int(jsval.ToNumber(r.Val("n")))
				want := 15.0 // dòng không đặt chiều cao: mặc định của sheet
				if h, ok := r.Val("height").(float64); ok {
					want = h
				}
				if h, _ := f.GetRowHeight(sh, n); h != want {
					t.Errorf("%s/%s: dòng %d cao %v, node %v", name, sh, n, h, r.Val("height"))
				}
				for ci, cellv := range jsval.AsArray(r.Val("cells")) {
					cell := jsval.AsArray(cellv)
					addr := cellName(ci+1, n)
					cells++
					val, _ := f.GetCellValue(sh, addr)
					typ, _ := f.GetCellType(sh, addr)
					switch cell[0] {
					case 0.0: // Null
						if val != "" || typ != excelize.CellTypeUnset {
							t.Errorf("%s/%s!%s: phải trống, có %q", name, sh, addr, val)
						}
					case 1.0: // Merge: ô phụ của vùng gộp - cả ExcelJS lẫn excelize trả giá trị của ô chủ
						if val != cell[1] {
							t.Errorf("%s/%s!%s: ô gộp %q (kiểu %v), node %q", name, sh, addr, val, typ, cell[1])
						}
					case 2.0: // Number
						if typ != excelize.CellTypeNumber && typ != excelize.CellTypeUnset || val != jsval.ToString(cell[1]) {
							t.Errorf("%s/%s!%s: số %q (kiểu %v), node %v", name, sh, addr, val, typ, cell[1])
						}
					case 3.0: // String
						if typ != excelize.CellTypeSharedString || val != cell[1] {
							t.Errorf("%s/%s!%s: chuỗi %q (kiểu %v), node %q", name, sh, addr, val, typ, cell[1])
						}
					default:
						t.Errorf("%s/%s!%s: kiểu ô lạ trong golden %v", name, sh, addr, cell[0])
					}
					sid, _ := f.GetCellStyle(sh, addr)
					if a, b := js(t, styleExcelJS(t, f, sid)), js(t, styles[int(jsval.ToNumber(cell[2]))]); a != b {
						t.Errorf("%s/%s!%s: style\n go:   %s\n node: %s", name, sh, addr, a, b)
					}
				}
			}
		}
		f.Close()
		if t.Failed() {
			t.Fatalf("dừng ở %s", name)
		}
	}
	if cells < 5000 {
		t.Fatalf("mới so %d ô", cells)
	}
}

// Những chỗ excelize ghi khác ExcelJS đã được sửa tay trong finish / nhuExcelJS: kiểm tra chúng còn hiệu lực.
func TestTemplateXMLNhuExcelJS(t *testing.T) {
	buf, err := BuildVsTemplate()
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		t.Fatal(err)
	}
	parts := map[string]string{}
	for _, zf := range zr.File {
		rc, _ := zf.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		parts[zf.Name] = string(b)
	}
	for _, sh := range []string{"xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"} {
		if !strings.Contains(parts[sh], `<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="55">`) || !strings.Contains(parts[sh], `mc:Ignorable="x14ac"`) ||
			!strings.Contains(parts[sh], `xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"`) {
			t.Errorf("%s thiếu x14ac:dyDescent", sh)
		}
		if !strings.Contains(parts[sh], `<pageSetup `) || !strings.Contains(parts[sh], `<pageMargins `) {
			t.Errorf("%s thiếu pageSetup / pageMargins", sh)
		}
	}
	if !strings.Contains(parts["xl/worksheets/sheet1.xml"], `state="frozen"`) || strings.Contains(parts["xl/worksheets/sheet2.xml"], "<sheetViews>") {
		t.Error("sheetViews: sheet 1 phải cố định dòng đầu, sheet 2 không có sheetViews")
	}
	if strings.Contains(parts["xl/workbook.xml"], "bookViews") {
		t.Error("workbook.xml còn bookViews")
	}
	if strings.Count(parts["xl/styles.xml"], "<family") != 1 {
		t.Error("styles.xml: chỉ font mặc định được có <family>")
	}
	if strings.Contains(parts["xl/styles.xml"], "<alignment></alignment>") {
		t.Error("styles.xml còn <alignment> rỗng")
	}
	// Vùng dimension, sheet đang chọn, dòng rỗng, app.xml, calcId: lấy từ file ExcelJS thật (buildVsTemplate của Node)
	s1, s2 := parts["xl/worksheets/sheet1.xml"], parts["xl/worksheets/sheet2.xml"]
	for _, c := range []struct {
		kind, hm, d1, d2 string
		r1, r2           int
	}{
		{"vs", "", "A1:AS4", "A1:C26", 4, 24}, {"son", "", "A1:AN4", "A1:C25", 4, 23}, {"son", "Sơn lót", "A1:AN3", "A1:C17", 3, 15},
		{"ct", "", "A1:BI4", "A1:C15", 4, 13}, {"ct", "Ổ cắm điện", "A1:AW3", "A1:C14", 3, 12},
	} {
		b, err := buildVariant(c.kind, c.hm)
		if err != nil {
			t.Fatal(err)
		}
		zr, _ := zip.NewReader(bytes.NewReader(b), int64(len(b)))
		for _, zf := range zr.File {
			d, n := c.d1, c.r1
			switch zf.Name {
			case "xl/worksheets/sheet1.xml":
			case "xl/worksheets/sheet2.xml":
				d, n = c.d2, c.r2
			default:
				continue
			}
			rc, _ := zf.Open()
			x, _ := io.ReadAll(rc)
			rc.Close()
			if !bytes.Contains(x, []byte(`<dimension ref="`+d+`">`)) || bytes.Count(x, []byte("<row ")) != n {
				t.Errorf("%s %q %s: dimension phải là %s với %d dòng: %.300s", c.kind, c.hm, zf.Name, d, n, x)
			}
		}
	}
	if strings.Contains(s1, "tabSelected") || strings.Contains(s2, `<row r="2">`) {
		t.Error("còn tabSelected hoặc dòng 2 rỗng của sheet hướng dẫn")
	}
	if !strings.Contains(parts["xl/workbook.xml"], `calcId="171027"`) {
		t.Error("workbook.xml: calcId phải là 171027")
	}
	if app := parts["docProps/app.xml"]; !strings.Contains(app, "<Application>Microsoft Excel</Application>") ||
		!strings.Contains(app, "<vt:lpstr>San pham</vt:lpstr><vt:lpstr>Hướng dẫn</vt:lpstr>") {
		t.Errorf("app.xml sai: %s", app)
	}
	core := parts["docProps/core.xml"]
	if !strings.Contains(core, "<dc:creator>Dezon QS Pro</dc:creator>") || !strings.Contains(core, "<cp:lastModifiedBy>Unknown</cp:lastModifiedBy>") ||
		!regexp.MustCompile(`<dcterms:created xsi:type="dcterms:W3CDTF">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ</dcterms:created>`).MatchString(core) {
		t.Errorf("core.xml sai: %s", core)
	}
}

// 3 route file mẫu: mã trạng thái, header, tên file tải về và nội dung (theo ?hm=) như handler Express của Node.
func TestTemplateRoutesGolden(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	svc := New(Deps{})
	svc.RegisterRPC(rpc.NewRegistry())
	svc.RegisterRoutes(gin.New().Group("/api/v1")) // route Điện lạnh: TestDlTemplateRoute
	svc.RegisterRoot(&engine.RouterGroup)
	if n := len(engine.Routes()); n != 3 {
		t.Fatalf("RegisterRoot phải gắn 3 route, có %d", n)
	}
	reETag := regexp.MustCompile(`^W/"[0-9a-f]+-.{27}"$`)
	cases := jsval.AsArray(loadGolden(t).Val("http"))
	if len(cases) < 20 {
		t.Fatalf("golden thiếu ca HTTP: %d", len(cases))
	}
	for _, cv := range cases {
		c := jsval.AsMap(cv)
		url := jsval.AsString(c.Val("url"))
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, url, nil))
		h := w.Header()
		hdr := func(k string) any {
			if v := h.Get(k); v != "" {
				return v
			}
			return nil
		}
		body := w.Body.Bytes()
		got := omap.Of("url", url, "status", float64(w.Code), "contentType", hdr("Content-Type"), "contentDisposition", hdr("Content-Disposition"),
			"cacheControl", hdr("Cache-Control"), "etagYeu", reETag.MatchString(h.Get("ETag")), "contentLengthDung", h.Get("Content-Length") == jsval.ToString(float64(len(body))))
		f, err := excelize.OpenReader(bytes.NewReader(body))
		if err != nil {
			t.Fatalf("%s: thân không phải xlsx: %v", url, err)
		}
		tieuDe, _ := f.GetCellValue(sheetHD, "A1")
		hmVD, _ := f.GetCellValue(sheetSP, "C2")
		rows, _ := f.GetRows(sheetSP)
		f.Close()
		cot := make([]any, len(rows[0]))
		for i, s := range rows[0] {
			cot[i] = s
		}
		got.Set("tieuDe", tieuDe).Set("cot", cot).Set("hmVD", hmVD)
		if a, b := js(t, got), js(t, c); a != b {
			t.Errorf("%s\n go:   %s\n node: %s", url, a, b)
		}
	}

	// ETag + If-None-Match: file mẫu cũng đi qua res.send nên có 304 (ngày tạo trong file đổi theo giây -> chỉ thử trong cùng giây)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/mau-nhap-son-nuoc.xlsx", nil)
	req.Header.Set("If-None-Match", "*")
	engine.ServeHTTP(w, req)
	if w.Code != 304 || w.Body.Len() != 0 || w.Header().Get("Content-Type") != "" || w.Header().Get("Content-Length") != "" || w.Header().Get("ETag") == "" {
		t.Errorf("If-None-Match: * phải ra 304 không thân, có %d %v", w.Code, w.Header())
	}
}

// Nhánh lỗi của route (Node: res.status(500).send("Lỗi tạo file mẫu: " + e.message)) - không tạo được từ Node, kiểm theo mã nguồn.
func TestSendTemplateError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/x", nil)
	sendTemplate(c, "x", nil, io.ErrUnexpectedEOF)
	if w.Code != 500 || w.Body.String() != "Lỗi tạo file mẫu: unexpected EOF" || w.Header().Get("Content-Type") != "text/html; charset=utf-8" ||
		w.Header().Get("Content-Disposition") != "" {
		t.Errorf("%d %q %v", w.Code, w.Body.String(), w.Header())
	}
}

// Ghi file .xlsx của mọi biến thể ra thư mục CATEGORIES_XLSX_OUT để testdata/compare.js đọc lại bằng ExcelJS.
func TestDumpTemplates(t *testing.T) {
	dir := os.Getenv("CATEGORIES_XLSX_OUT")
	if dir == "" {
		t.Skip("không đặt CATEGORIES_XLSX_OUT")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, vv := range jsval.AsArray(loadGolden(t).Val("variants")) {
		v := jsval.AsMap(vv)
		buf, err := buildVariant(jsval.AsString(v.Val("kind")), v.Val("hm"))
		if err != nil {
			t.Fatalf("%v: %v", v.Val("name"), err)
		}
		if err := os.WriteFile(filepath.Join(dir, jsval.AsString(v.Val("name"))+".xlsx"), buf, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// File mẫu Điện lạnh (chỉ bản Go): route /api/v1, cột theo hạng mục, dòng ví dụ tự bỏ qua, sheet Hướng dẫn.
func TestDlTemplateRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	New(Deps{}).RegisterRoutes(engine.Group("/api/v1"))
	get := func(q string) (*httptest.ResponseRecorder, *excelize.File) {
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/product-templates/dien-lanh"+q, nil))
		if w.Code != 200 || w.Header().Get("Content-Type") != xlsxMime ||
			w.Header().Get("Content-Disposition") != `attachment; filename="Mau-nhap-dien-lanh-DezonQS.xlsx"` {
			t.Fatalf("%s: %d %v", q, w.Code, w.Header())
		}
		f, err := excelize.OpenReader(bytes.NewReader(w.Body.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		return w, f
	}
	header := func(f *excelize.File) []string {
		rows, err := f.GetRows("San pham")
		if err != nil || len(rows) < 2 {
			t.Fatalf("sheet San pham: %v", err)
		}
		return rows[0]
	}
	_, f := get("?hm=" + "%C4%90i%E1%BB%81u%20ho%C3%A0%20kh%C3%B4ng%20kh%C3%AD") // Điều hoà không khí
	h := strings.Join(header(f), "|")
	if !strings.Contains(h, "LOẠI MÁY") || !strings.Contains(h, "KHỐI LƯỢNG DÀN NÓNG (kg)") || strings.Contains(h, "QUY CÁCH") {
		t.Errorf("cột của Điều hoà không khí sai: %s", h)
	}
	rows, _ := f.GetRows("San pham")
	if len(rows) != 3 || !strings.HasPrefix(rows[1][4], specs.DL.VD) {
		t.Errorf("phải có 2 dòng ví dụ bắt đầu %q: %v", specs.DL.VD, rows)
	}
	_, f = get("?hm=ong%20dong%20dan%20gas")
	if h := strings.Join(header(f), "|"); strings.Contains(h, "LOẠI MÁY") || !strings.Contains(h, "QUY CÁCH") {
		t.Errorf("cột của Ống đồng dẫn gas sai: %s", h)
	}
	_, f = get("")
	if h := strings.Join(header(f), "|"); !strings.Contains(h, "LOẠI MÁY") || !strings.Contains(h, "QUY CÁCH") {
		t.Errorf("không chọn hạng mục phải có cột của mọi hạng mục: %s", h)
	}
	if i, _ := f.GetSheetIndex("Hướng dẫn"); i < 0 {
		t.Error("thiếu sheet Hướng dẫn")
	}
}
