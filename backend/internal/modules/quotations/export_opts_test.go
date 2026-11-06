package quotations

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// reCoreTime: thời điểm tạo / sửa trong docProps/core.xml (đổi theo đồng hồ mỗi lần ghi).
var reCoreTime = regexp.MustCompile(`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ`)

// xlsxHash: sha256 của mọi phần trong file xlsx theo đúng thứ tự trong zip (tên + nội dung), che thời điểm của core.xml.
func xlsxHash(t *testing.T, buf []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.New()
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		if f.Name == "docProps/core.xml" {
			b = reCoreTime.ReplaceAll(b, []byte("<ts>"))
		}
		fmt.Fprintf(h, "%s\x00%d\x00%d\x00", f.Name, f.Method, len(b))
		h.Write(b)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// exportHashes: chạy mọi bước exportBaoGia thành công của cases.json qua rpc (đúng tham số golden, không opts)
// và trả hash của từng file.
func exportHashes(t *testing.T, extra ...any) map[string]string {
	t.Helper()
	cs := loadCases(t)
	st := newStubs(cs)
	svc := newTestService(st, nil, &fakeRepo{})
	reg := rpc.NewRegistry()
	svc.RegisterRPC(reg)
	out := map[string]string{}
	for _, sv := range jsval.AsArray(cs.spec.Val("steps")) {
		step := jsval.AsMap(sv)
		if jsval.AsString(step.Val("fn")) != "exportBaoGia" || step.Has("dump") || jsval.Truthy(step.Val("dbOnly")) {
			continue
		}
		st.lines = jsval.AsArray(jsval.GetPath(cs.spec.Val("lines"), jsval.StrOr(step.Val("lines"), "NONE")))
		st.project = nil
		if p := step.Val("project"); jsval.Truthy(p) {
			st.project = jsval.AsMap(jsval.GetPath(cs.spec.Val("projects"), jsval.AsString(p)))
		}
		args := append([]any{}, jsval.AsArray(step.Val("args"))...)
		if len(extra) > 0 {
			for len(args) < 8 {
				args = append(args, jsval.Undefined)
			}
			args = append(args[:8], extra...)
		}
		res, err := reg.Call(context.Background(), "exportBaoGia", nil, args...)
		if err != nil {
			continue
		}
		buf, err := base64.StdEncoding.DecodeString(res.(*ExportFile).Base64)
		if err != nil {
			t.Fatal(err)
		}
		out[jsval.AsString(step.Val("n"))] = xlsxHash(t, buf)
	}
	return out
}

// Hash file của từng bước exportBaoGia trong cases.json, ghi lại TRƯỚC khi thêm opts (M8.1-M8.3). Không có opts
// (thiếu, null, hay không phải object) thì file phải giống từng byte (trừ thời điểm trong core.xml).
var exportHashTruocOpts = map[string]string{
	"export-custom":           "90bf113f80769ef577bca1b33280f0ddc67dab282024727aeeda4de759ca6f1e",
	"ok-nodes-string-nolines": "b4e7a265937a73ffa5844766f5ffb51af5d14b0164de679ed59a78c9babf34b6",
	"export-cover-proto":      "b954a0842393bcaffe743ee1ea5dfd183e04dcec58e5526b9bff987d40791ea7",
	"export-sheet-proto":      "7716e910e59e5f50b6b4f2296128464be7bf61aa5873133f9a8ef12cc03ac4e4",
	"err-col-proto-2":         "fe3eec4234dfbac01125fbc50eba338acbf76abe14f72ec000014a61cbc8a64b",
	"export-sup":              "e5a45c43f01afe6a90f0505fcf421759e680840b10874a725f3ebb9b9c699b95",
	"export-noproject":        "e7b1d685ded7c86bcf83f4760ebd71b93ba911b7f4b3c696200d778294e8c16f",
	"export-1col":             "a5df942a6fd8d8627d70c20261ba96c02b540391656645b01c816d6578b2c48c",
	"export-2col-img":         "6cf7dc01e6bb316b3d675f64229e856d0b3a59944230a5d53a1fd10cefe8b509",
	"ok-phantho-items-falsy":  "0288f9c2afb728b855a9a3560cd1419d3d05de5e5d728a64f1d9ac72a82f94b3",
	"export-cover-proto-an":   "67d26d943e4c5de5d9aa27eb1bc45cc10193bdd70661723f46b8dbe919406295",
	"col-proto-label-nolines": "b163a2438538c0bee357d3e2526990bbfb016d7b7d55a1442025ade466e21dd3",
	"col-proto-label-lines-2": "cb07ca5edab6c946f187916db138f68b44992eb822d4e5cc0af623beb57c380a",
	"export-default":          "9c3b17a15699242fe6d1cf2429dcf4f6f4c5a9d79cc472386dacf2b9ecef18ed",
}

func TestExportKhongOptsGiuNguyenByte(t *testing.T) {
	for _, c := range []struct {
		name  string
		extra []any
	}{{"không gửi opts", nil}, {"opts undefined", []any{jsval.Undefined}}, {"opts null", []any{nil}},
		{"opts là chuỗi", []any{"m1"}}, {"opts là mảng", []any{[]any{"m1"}}}} {
		got := exportHashes(t, c.extra...)
		if len(got) != len(exportHashTruocOpts) {
			t.Errorf("%s: %d bước xuất được, cần %d", c.name, len(got), len(exportHashTruocOpts))
		}
		for n, want := range exportHashTruocOpts {
			if got[n] != want {
				t.Errorf("%s: %s khác file trước khi có opts", c.name, n)
			}
		}
	}
}

// ───────────── xuất có opts ─────────────

func mustDecode(t *testing.T, js string) any {
	t.Helper()
	v, err := omap.DecodeString(js)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// exportWithOpts: gọi exportBaoGia qua rpc (dự án A + dòng A của cases.json, kho tờ bìa rỗng -> dựng từ mẫu), so file
// với mô hình rồi mở lại file bằng excelize.
func exportWithOpts(t *testing.T, project *omap.Map, cols, tong, opts any) (*excelize.File, *xBook, *stubs) {
	t.Helper()
	cs := loadCases(t)
	st := newStubs(cs)
	svc := newTestService(st, nil, &fakeRepo{})
	reg := rpc.NewRegistry()
	svc.RegisterRPC(reg)
	st.lines = jsval.AsArray(jsval.GetPath(cs.spec.Val("lines"), "A"))
	st.project = project
	if st.project == nil {
		st.project = jsval.AsMap(jsval.GetPath(cs.spec.Val("projects"), "A"))
	}
	st.media, st.fetched = []any{}, []any{}
	ctx := context.Background()
	res, err := reg.Call(ctx, "exportBaoGia", nil, "ZZ_quotations_P1", cols, "xlsx", nil, nil, nil, tong, "ZZ Công ty Org", opts)
	if err != nil {
		t.Fatal(err)
	}
	buf, err := base64.StdEncoding.DecodeString(res.(*ExportFile).Base64)
	if err != nil {
		t.Fatal(err)
	}
	wb, _, err := svc.buildBaoGia(ctx, "ZZ_quotations_P1", cols, nil, nil, nil, tong, "ZZ Công ty Org", opts)
	if err != nil {
		t.Fatal(err)
	}
	checkFile(t, "opts", wb, buf)
	f, err := excelize.OpenReader(bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f, wb, st
}

// sheetText: mọi ô có chữ của 1 sheet dạng "A1=...", theo thứ tự dòng.
func sheetText(t *testing.T, f *excelize.File, sheet string) []string {
	t.Helper()
	rows, err := f.GetRows(sheet)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for r, row := range rows {
		for c, v := range row {
			if v != "" {
				out = append(out, cellName(c+1, r+1)+"="+v)
			}
		}
	}
	return out
}

func anyStrings(list []any) []string {
	out := make([]string, len(list))
	for i, x := range list {
		out[i] = jsval.ToString(x)
	}
	return out
}

func hasText(list []string, sub string) bool {
	for _, x := range list {
		if strings.Contains(x, sub) {
			return true
		}
	}
	return false
}

func TestExportOptsMau1(t *testing.T) {
	f, wb, _ := exportWithOpts(t, nil, nil, nil, mustDecode(t, `{"coverMau":"m1"}`))
	txt := sheetText(t, f, "Tờ bìa")
	head, soNO := -1, 0
	rows, _ := f.GetRows("Tờ bìa")
	for r, row := range rows {
		if len(row) > 0 && row[0] == "NO" {
			soNO++
			head = r + 1
			if strings.Join(row, "|") != "NO|HẠNG MỤC|NỘI DUNG|CHI PHÍ DỰ KIẾN|TỶ TRỌNG|MÔ TẢ" {
				t.Errorf("đầu bảng Mẫu 1: %v", row)
			}
		}
	}
	if soNO != 1 {
		t.Errorf("tờ bìa Mẫu 1 có %d dòng đầu bảng, cần 1", soNO)
	}
	if head < 0 {
		t.Fatalf("không thấy đầu bảng Mẫu 1: %v", txt)
	}
	// ô NO / HẠNG MỤC gộp dọc theo mục lớn
	mcs, _ := f.GetMergeCells("Tờ bìa")
	doc := 0
	for _, m := range mcs {
		c1, r1, _ := excelize.CellNameToCoordinates(m.GetStartAxis())
		c2, r2, _ := excelize.CellNameToCoordinates(m.GetEndAxis())
		if r2 > r1 && c1 == c2 && (c1 == 1 || c1 == 2) && r1 > head {
			doc++
		}
	}
	if doc < 4 {
		t.Errorf("Mẫu 1 cần các ô NO / HẠNG MỤC gộp dọc, có %d", doc)
	}
	if !hasText(txt, "(gồm các mục dưới)") {
		t.Error("Mẫu 1: mục có con phải ghi '(gồm các mục dưới)'")
	}
	if !hasText(txt, "TỔNG CHI PHÍ DỰ KIẾN (VNĐ)") || !hasText(txt, "Hiện trạng:") {
		t.Errorf("Mẫu 1 thiếu dòng tổng / Hiện trạng: %v", txt)
	}
	if w := wb.sheets[0].widths; len(w) != 6 {
		t.Errorf("Mẫu 1 có %d cột, cần 6", len(w))
	}
	// Mẫu 2 (khi có opts mà coverMau khác 'm1'): bảng 4 cột như cũ
	f2, wb2, _ := exportWithOpts(t, nil, nil, nil, mustDecode(t, `{"coverMau":"m2"}`))
	if hasText(sheetText(t, f2, "Tờ bìa"), "NỘI DUNG") || len(wb2.sheets[0].widths) != 4 {
		t.Error("Mẫu 2 không được có cột NỘI DUNG")
	}
}

func TestExportOptsHienTrang(t *testing.T) {
	p := jsval.AsMap(mustDecode(t, `{"maDA":"ZZ_quotations_P1","ten":"ZZ dự án","khachHang":"Chị A","hienTrang":"Nhà cấp 4 cũ, cần phá dỡ"}`))
	f, _, _ := exportWithOpts(t, p, nil, nil, mustDecode(t, `{}`))
	if !hasText(sheetText(t, f, "Tờ bìa"), "Hiện trạng:  Nhà cấp 4 cũ, cần phá dỡ") {
		t.Error("tờ bìa phải có Hiện trạng")
	}
	// không opts: bố cục Node, không có dòng Hiện trạng
	f2, _, _ := exportWithOpts(t, p, nil, nil, nil)
	if hasText(sheetText(t, f2, "Tờ bìa"), "Hiện trạng") {
		t.Error("không opts thì không in Hiện trạng (giữ file như bản Node)")
	}
	// nhiều dòng (ô nhập là textarea): giữ xuống dòng, ô gộp được nới chiều cao đủ số dòng
	p3 := jsval.AsMap(mustDecode(t, `{"maDA":"ZZ_quotations_P1","hienTrang":"ZZ dòng 1\r\nZZ dòng 2\nZZ dòng 3"}`))
	for _, mau := range []string{"m1", "m2"} {
		f3, _, _ := exportWithOpts(t, p3, nil, nil, mustDecode(t, `{"coverMau":"`+mau+`"}`))
		rows, _ := f3.GetRows("Tờ bìa")
		found := false
		for r, row := range rows {
			if len(row) == 0 || !strings.HasPrefix(row[0], "Hiện trạng:") {
				continue
			}
			found = true
			if row[0] != "Hiện trạng:  ZZ dòng 1\nZZ dòng 2\nZZ dòng 3" {
				t.Errorf("%s: Hiện trạng phải giữ xuống dòng: %q", mau, row[0])
			}
			if h, _ := f3.GetRowHeight("Tờ bìa", r+1); h < 45 {
				t.Errorf("%s: dòng Hiện trạng 3 dòng phải cao >= 45pt, có %v", mau, h)
			}
		}
		if !found {
			t.Errorf("%s: không thấy dòng Hiện trạng", mau)
		}
	}
	// 1 dòng ngắn: giữ chiều cao mặc định
	f4, _, _ := exportWithOpts(t, p, nil, nil, mustDecode(t, `{}`))
	rows4, _ := f4.GetRows("Tờ bìa")
	for r, row := range rows4 {
		if len(row) > 0 && strings.HasPrefix(row[0], "Hiện trạng:") {
			if h, _ := f4.GetRowHeight("Tờ bìa", r+1); h > 20 {
				t.Errorf("Hiện trạng 1 dòng không cần nới chiều cao, có %v", h)
			}
		}
	}
}

func TestExportOptsCongTyTongKet(t *testing.T) {
	opts := mustDecode(t, `{"coverMau":"m2",
	  "org":{"ten":"ZZ Công ty Thiết kế","logo":"/logo.svg","lines":["12 Đường Số 1, Q.1","ĐT: 0909 000 111   Email: a@b.vn",""]},
	  "tongKet":{"ngay":"15/10/2026","hieuLuc":30,"nguoi":"Nguyễn Văn A",
	    "dot":[{"noiDung":"Tạm ứng khi ký hợp đồng","pct":50,"soTien":1234567},{"noiDung":"Nghiệm thu","pct":50,"soTien":1234568},{"noiDung":"  ","pct":1}],
	    "ghiChu":["Khối lượng trên là tạm tính.","Báo giá có hiệu lực 30 ngày kể từ ngày 15/10/2026 (đến hết ngày 14/11/2026)."]}}`)
	tong := mustDecode(t, `[["Cộng (chưa VAT)",2286266],["VAT 8%",182901],["TỔNG THANH TOÁN",2469135]]`)
	f, wb, st := exportWithOpts(t, nil, nil, tong, opts)
	bia := sheetText(t, f, "Tờ bìa")
	for _, w := range []string{"A1=ZZ Công ty Thiết kế", "A2=12 Đường Số 1, Q.1", "A3=ĐT: 0909 000 111   Email: a@b.vn", "BẢNG ƯỚC TÍNH CHI PHÍ DỰ ÁN"} {
		if !hasText(bia, w) {
			t.Errorf("tờ bìa thiếu %q: %v", w, bia)
		}
	}
	if len(wb.sheets[0].images) != 0 || hasText(anyStrings(st.fetched), "logo") {
		t.Errorf("logo SVG / đường dẫn tương đối phải bị bỏ: ảnh %d, đã tải %v", len(wb.sheets[0].images), st.fetched)
	}
	tk := sheetText(t, f, "Tổng cộng")
	for _, w := range []string{"TỔNG THANH TOÁN", "Ngày báo giá: 15/10/2026 · Hiệu lực: 30 ngày", "TIẾN ĐỘ THANH TOÁN",
		"=Đợt 1: Tạm ứng khi ký hợp đồng", "=Đợt 2: Nghiệm thu", "GHI CHÚ & ĐIỀU KHOẢN:", "=1. Khối lượng trên là tạm tính.",
		"=2. Báo giá có hiệu lực 30 ngày kể từ ngày 15/10/2026 (đến hết ngày 14/11/2026).", "=Người lập: Nguyễn Văn A"} {
		if !hasText(tk, w) {
			t.Errorf("sheet Tổng cộng thiếu %q: %v", w, tk)
		}
	}
	if hasText(tk, "Đợt 3") {
		t.Error("đợt không có nội dung phải bị bỏ")
	}
	// số tiền đợt là ô số đúng giá trị client gửi (không tính lại)
	rows, _ := f.GetRows("Tổng cộng", excelize.Options{RawCellValue: true})
	for _, want := range []string{"1234567", "1234568"} {
		found := false
		for _, row := range rows {
			if len(row) >= 2 && row[1] == want {
				found = true
			}
		}
		if !found {
			t.Errorf("không thấy số tiền đợt %s", want)
		}
	}
	// tiêu đề sheet chi tiết vẫn lấy tên công ty từ tham số org (tham số thứ 8)
	if v, _ := f.GetCellValue("3.2.6.1", "A1"); v != "ZZ CÔNG TY ORG" {
		t.Errorf("sheet chi tiết A1 = %q", v)
	}
}

func TestExportOptsLogoPNG(t *testing.T) {
	_, wb, st := exportWithOpts(t, nil, nil, nil, mustDecode(t, `{"org":{"ten":"ZZ","logo":"http://cdn.example.com/logo.png"}}`))
	if len(wb.sheets[0].images) != 1 || !hasText(anyStrings(st.fetched), "http://cdn.example.com/logo.png") {
		t.Errorf("logo PNG phải được nhúng: ảnh %d, tải %v", len(wb.sheets[0].images), st.fetched)
	}
	_, wb2, _ := exportWithOpts(t, nil, nil, nil, mustDecode(t, `{"org":{"ten":"ZZ","logo":"http://127.0.0.1/logo.png"}}`))
	if len(wb2.sheets[0].images) != 0 {
		t.Error("logo ở địa chỉ nội bộ phải bị bỏ")
	}
}

func TestExportOptsDoRongCot(t *testing.T) {
	cols := mustDecode(t, `[{"key":"stt","label":"STT"},{"key":"thanhTien","label":"THÀNH TIỀN","w":200},{"key":"ten","label":"TÊN SẢN PHẨM","w":310},{"key":"dvt","label":"ĐVT","w":"abc"}]`)
	f, _, _ := exportWithOpts(t, nil, cols, nil, mustDecode(t, `{}`))
	rows, _ := f.GetRows("3.2.6.1")
	var head []string
	for _, row := range rows {
		if len(row) > 0 && row[0] == "STT" {
			head = row
			break
		}
	}
	if strings.Join(head, "|") != "STT|THÀNH TIỀN|TÊN SẢN PHẨM|ĐVT" {
		t.Errorf("thứ tự cột chi tiết: %v", head)
	}
	for _, c := range []struct {
		col  string
		want float64
	}{{"A", px(34)}, {"B", px(200)}, {"C", px(310)}, {"D", px(42)}} {
		if w, _ := f.GetColWidth("3.2.6.1", c.col); w != c.want {
			t.Errorf("cột %s rộng %v, cần %v", c.col, w, c.want)
		}
	}
	// không opts: w bị bỏ qua như bản Node
	f2, _, _ := exportWithOpts(t, nil, cols, nil, nil)
	if w, _ := f2.GetColWidth("3.2.6.1", "C"); w != px(175) {
		t.Errorf("không opts: cột C rộng %v, cần %v", w, px(175))
	}
}

// REST: khoá opts của thân POST /projects/:id/quotation/export tới được exportBaoGia.
func TestExportOptsREST(t *testing.T) {
	cs := loadCases(t)
	st := newStubs(cs)
	st.lines = jsval.AsArray(jsval.GetPath(cs.spec.Val("lines"), "A"))
	e := testEngine(newTestService(st, nil, &fakeRepo{}))
	body := `{"cols":[{"key":"ten"},{"key":"thanhTienBan"}],"org":"Cty","opts":{"coverMau":"m1","org":{"ten":"ZZ REST"}}}`
	w := do(e, "POST", "/api/v1/projects/ZZ_quotations_P1/quotation/export", body, true)
	if w.Code != 200 {
		t.Fatalf("POST quotation/export: %d %.300s", w.Code, w.Body.String())
	}
	v, err := omap.Decode(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	buf, err := base64.StdEncoding.DecodeString(jsval.AsString(jsval.GetPath(v, "result", "base64")))
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	txt := sheetText(t, f, "Tờ bìa")
	if !hasText(txt, "A1=ZZ REST") || !hasText(txt, "=NỘI DUNG") {
		t.Errorf("opts qua REST không có hiệu lực: %v", txt)
	}
}

// VAT theo hạng mục: tờ bìa thêm dòng VAT (client tính) + TỔNG GỒM VAT; sheet hạng mục có % trong vatHm thêm VAT + THÀNH TIỀN (VAT)
func TestExportOptsVatHangMuc(t *testing.T) {
	opts := mustDecode(t, `{"coverMau":"m2","vatBia":{"nhan":"5% · 8%","vat":1000},"vatHm":{"3.2.6.1":8}}`)
	f, _, _ := exportWithOpts(t, nil, nil, nil, opts)
	bia := sheetText(t, f, "Tờ bìa")
	for _, w := range []string{"=VAT 5% · 8%", "=TỔNG CHI PHÍ DỰ KIẾN (GỒM VAT)"} {
		if !hasText(bia, w) {
			t.Errorf("tờ bìa thiếu %q: %v", w, bia)
		}
	}
	hm := sheetText(t, f, "3.2.6.1")
	for _, w := range []string{"=VAT 8%", "=THÀNH TIỀN (VAT)"} {
		if !hasText(hm, w) {
			t.Errorf("sheet hạng mục thiếu %q: %v", w, hm)
		}
	}
	// hạng mục không có trong vatHm: không thêm dòng VAT (giữ như cũ)
	for _, sh := range f.GetSheetList() {
		if sh == "Tờ bìa" || sh == "3.2.6.1" || sh == "Tổng cộng" {
			continue
		}
		if hasText(sheetText(t, f, sh), "THÀNH TIỀN (VAT)") {
			t.Errorf("sheet %s không có %% VAT mà vẫn có dòng THÀNH TIỀN (VAT)", sh)
		}
	}
}
