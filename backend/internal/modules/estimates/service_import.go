package estimates

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

/*** ===== NHẬP CÔNG TÁC TỪ FILE MẪU (chỉ bản Go, roadmap M5.1) =====
Đọc file mẫu /mau-nhap-cong-tac.xlsx (hoặc CSV cùng tiêu đề) thành các object công tác theo khoá của ctSave / ctToRow.
Máy chủ chỉ ĐỌC file, không ghi gì: giao diện đưa kết quả vào danh sách chờ rồi lưu bằng ctSave như form nhập tay. */

// ctImportMaxRows: số dòng dữ liệu tối đa đọc từ 1 file (như giới hạn nhập sản phẩm của importParse).
const ctImportMaxRows = 2000

var (
	reSoNguyen = regexp.MustCompile(`^[0-9]+$`)
	reSoVN     = regexp.MustCompile(`^[+-]?[0-9][0-9.,]*$`)                               // 450.000 / 1.234,5 / 12,5 / -5
	reSoMu     = regexp.MustCompile(`^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)[eE][+-]?[0-9]+$`) // 1.2E+06 (Excel xuất CSV)
)

// ctImportSo: ô số -> (giá trị, đọc được không). Ô số của xlsx giữ nguyên. Chuỗi (ô CSV, ô chữ của xlsx) đọc kiểu Việt Nam
// như ô nhập tay của form (qscore.N = toNumber_ / tkNum_: "450.000" = 450000, "1.234,5" = 1234,5, "12,5" = 12,5); bỏ khoảng
// trắng và đuôi đơn vị tiền "đ" / "₫" / "vnđ" / "vnd"; dạng số mũ "1.2E+06" đọc như số JS. Chữ khác -> không đọc được.
func ctImportSo(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, !math.IsNaN(x) && !math.IsInf(x, 0)
	case string:
		s := strings.ToLower(strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, norm.NFC.String(x)))
		for _, u := range []string{"vnđ", "vnd", "đ", "₫"} {
			if strings.HasSuffix(s, u) {
				s = strings.TrimSuffix(s, u)
				break
			}
		}
		switch {
		case reSoVN.MatchString(s):
			return qscore.N(s), true
		case reSoMu.MatchString(s):
			if f, err := strconv.ParseFloat(s, 64); err == nil && !math.IsInf(f, 0) {
				return f, true
			}
		}
	}
	return 0, false
}

// ctImportCols: 16 tiêu đề của file mẫu (dòng 1) -> khoá ctSave, đúng thứ tự cột của file mẫu.
var ctImportCols = [][2]string{
	{"Nội dung công việc", "ten"}, {"Hạng mục", "hangMuc"}, {"Số hạng mục", "maNhom"}, {"Loại báo giá", "loai"},
	{"Cách tính", "mode"}, {"ĐVT", "dvt"}, {"Khối lượng", "kl"}, {"Diện tích", "dt"}, {"Hệ số", "hs"},
	{"Nhà thầu", "ncc"}, {"Giá bán lẻ", "dg"}, {"Đơn giá nhà thầu", "dgnt"}, {"Ghi chú", "gc"},
	{"Thông số kỹ thuật", "thongSo"}, {"Phạm vi ứng dụng", "phamVi"}, {"Ảnh", "hinhAnh"},
}

// Nhãn "Loại báo giá" của file mẫu (PT_LOAI_NHOM, breakdown/sheet/ptLoai.js:9-12) -> mã loại.
var ctImportLoai = [][2]string{
	{"Khái toán chi tiết", "kt_chitiet"}, {"Khái toán sơ bộ", "kt_sobo"},
	{"Dự toán · Nhân công", "dt_nhancong"}, {"Dự toán · Vật tư", "dt_vattu"},
}

// Nhãn "Cách tính" của file mẫu (MODES, importer/pt/CtForm.jsx:13) -> mã chế độ.
var ctImportMode = [][2]string{
	{"Khối lượng × đơn giá", "item"}, {"Diện tích × hệ số", "area"},
	{"Chỉ tính khối lượng", "area0"}, {"Chỉ liệt kê", "none"},
}

// Khoá số: ô trống giữ "" (ctToRow ghi null), còn lại đọc bằng qscore.N.
var ctImportNum = map[string]bool{"kl": true, "dt": true, "hs": true, "dg": true, "dgnt": true}

// ctKey: so khớp tiêu đề / nhãn không phân biệt hoa thường và khoảng trắng (chuẩn hoá NFC để chữ có dấu gõ kiểu
// tổ hợp vẫn khớp; "×" và "x" là hai ký tự khác nhau).
func ctKey(v any) string {
	s := strings.ToLower(norm.NFC.String(jsval.S(v)))
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' }), "")
}

// ctLabelMap: bảng nhãn -> mã; nhận cả chính mã (kt_chitiet, item...) cho file xuất từ chỗ khác.
func ctLabelMap(pairs [][2]string) map[string]string {
	m := map[string]string{}
	for _, p := range pairs {
		m[ctKey(p[0])] = p[1]
		m[ctKey(p[1])] = p[1]
	}
	return m
}

var (
	ctLoaiByLabel = ctLabelMap(ctImportLoai)
	ctModeByLabel = ctLabelMap(ctImportMode)
	ctColByHeader = func() map[string]string {
		m := map[string]string{ctKey("Thứ tự"): "thuTu", ctKey("Mã sản phẩm"): "maSP"} // cột tuỳ chọn, file mẫu không có
		for _, c := range ctImportCols {
			m[ctKey(c[0])] = c[1]
		}
		return m
	}()
)

// cellStr: ô -> chuỗi đã cắt khoảng trắng (số theo cách JS đổi ra chuỗi).
func cellStr(row []any, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return jsval.Trim(jsval.S(row[i]))
}

// ctImportRows: các dòng có dữ liệu của sheet đầu -> {rows, loi}. dong = số dòng thật trong file (qscore.SheetRow.Dong).
func ctImportRows(sr []qscore.SheetRow) (*omap.Map, error) {
	hr := -1
	cols := map[string]int{}
	for i := 0; i < len(sr) && i < 15; i++ {
		m := map[string]int{}
		for ci, h := range sr[i].Cells {
			if k, ok := ctColByHeader[ctKey(h)]; ok {
				if _, dup := m[k]; !dup {
					m[k] = ci
				}
			}
		}
		if _, ok := m["ten"]; ok {
			hr, cols = i, m
			break
		}
	}
	if hr < 0 {
		return nil, apperr.BadRequest("Không tìm thấy dòng tiêu đề có cột 'Nội dung công việc' - hãy dùng file mẫu")
	}
	idx := func(k string) int {
		if i, ok := cols[k]; ok {
			return i
		}
		return -1
	}
	rows := []any{}
	loi := []any{}
	n := 0
	for ri := hr + 1; ri < len(sr); ri++ {
		r := sr[ri].Cells
		dong := sr[ri].Dong
		ten := cellStr(r, idx("ten"))
		if ten == "" {
			continue
		}
		// dòng ghi chú cuối file mẫu: cột A "Ghi chú: ...", các ô khác trống
		if a := cellStr(r, 0); strings.HasPrefix(ctKey(a), ctKey("Ghi chú:")) {
			khac := false
			for ci := 1; ci < len(r); ci++ {
				if cellStr(r, ci) != "" {
					khac = true
					break
				}
			}
			if !khac {
				continue
			}
		}
		if n >= ctImportMaxRows {
			loi = append(loi, omap.Of("dong", dong, "msg", "Chỉ đọc "+strconv.Itoa(ctImportMaxRows)+" công tác đầu tiên của file - tách file để nhập phần còn lại", "ten", ten))
			break
		}
		n++
		o := omap.New()
		var msgs []string
		for _, c := range ctImportCols {
			k, nhan := c[1], c[0]
			v := cellStr(r, idx(k))
			switch {
			case k == "loai":
				ma := "kt_chitiet"
				if v != "" {
					if x, ok := ctLoaiByLabel[ctKey(v)]; ok {
						ma = x
					} else {
						msgs = append(msgs, "Loại báo giá '"+v+"' không hợp lệ")
						ma = ""
					}
				}
				o.Set(k, ma)
			case k == "mode":
				ma := "item"
				if v != "" {
					if x, ok := ctModeByLabel[ctKey(v)]; ok {
						ma = x
					} else {
						msgs = append(msgs, "Cách tính '"+v+"' không hợp lệ")
						ma = ""
					}
				}
				o.Set(k, ma)
			case ctImportNum[k]:
				// ô sai giữ "" trong row để người dùng nhập lại ở form
				f, ok := 0.0, true
				if v != "" {
					f, ok = ctImportSo(r[idx(k)])
				}
				switch {
				case v == "":
					o.Set(k, "")
				case !ok:
					msgs = append(msgs, nhan+" '"+v+"' không phải số")
					o.Set(k, "")
				case f < 0:
					msgs = append(msgs, nhan+" '"+v+"' không được âm")
					o.Set(k, "")
				default:
					o.Set(k, f)
				}
			default:
				o.Set(k, v)
			}
		}
		// cột "Thứ tự" (tuỳ chọn): số nguyên ≥ 0 như ràng buộc của cột sort_order
		if v := cellStr(r, idx("thuTu")); v != "" {
			f, isNum := r[idx("thuTu")].(float64)
			if !isNum && reSoNguyen.MatchString(v) {
				f, isNum = qscore.N(v), true
			}
			if isNum && f >= 0 && f == math.Trunc(f) && f <= math.MaxInt32 {
				o.Set("thuTu", f)
			} else {
				msgs = append(msgs, "Thứ tự '"+v+"' phải là số nguyên không âm")
			}
		}
		// cột "Mã sản phẩm" (tuỳ chọn, migration 0055): chỉ thêm khoá khi file có cột này
		if i := idx("maSP"); i >= 0 {
			o.Set("maSP", cellStr(r, i))
		}
		if jsval.S(o.Val("hangMuc")) == "" {
			msgs = append(msgs, "Thiếu Hạng mục")
		}
		if len(msgs) > 0 {
			loi = append(loi, omap.Of("dong", dong, "msg", strings.Join(msgs, "; "), "ten", ten, "row", o))
			continue
		}
		rows = append(rows, o)
	}
	return omap.Of("rows", rows, "loi", loi), nil
}

// CtImportParse: đọc file nhập công tác (base64 + đuôi file "xlsx" / "csv") -> {rows, loi}.
//   - rows: object công tác theo khoá ctSave (ten, hangMuc, maNhom, loai, mode, dvt, kl, dt, hs, ncc, dg, dgnt, gc,
//     thongSo, phamVi, hinhAnh); ô Loại / Cách tính trống -> mặc định của ctToRow (kt_chitiet / item);
//     thêm thuTu khi file có cột "Thứ tự" (tuỳ chọn, ngoài 16 cột của file mẫu) và ô đó có giá trị
//   - loi: [{dong, msg, ten, row}] - dòng có nhãn Loại / Cách tính lạ, ô số không đọc được hoặc âm, Thứ tự sai, thiếu
//     Hạng mục; row = bản đọc được, ô sai để trống, giao diện đưa vào danh sách chờ để người dùng sửa;
//     dong = số dòng thật trong file (tính cả dòng trống xen giữa)
//   - số: ô số của xlsx giữ nguyên; chuỗi đọc kiểu Việt Nam như form (xem ctImportSo)
//   - bỏ qua dòng không có Nội dung công việc và dòng "Ghi chú: ..." của file mẫu
//
// Cùng quyền với CtSaveGated: chỉ tài khoản được thêm dữ liệu.
func (s *Service) CtImportParse(ctx context.Context, a *actor.Actor, base64Data, ext any) (*omap.Map, error) {
	edit, _, err := s.spPerms(ctx, a)
	if err != nil {
		return nil, err
	}
	if !edit {
		return nil, apperr.New("Tài khoản không có quyền thêm dữ liệu")
	}
	buf := qscore.DecodeBase64(jsval.S(base64Data))
	if len(buf) == 0 {
		return nil, apperr.BadRequest("Chưa có nội dung file")
	}
	csv := strings.Contains(strings.ToLower(jsval.S(ext)), "csv")
	sr, err := qscore.SheetRows(buf, jsval.S(ext))
	switch {
	case err == nil:
	case err.Error() == "File không có sheet dữ liệu":
		return nil, apperr.BadRequest(err.Error())
	case csv:
		return nil, apperr.BadRequest("Không đọc được file CSV - hãy lưu lại bằng Excel dạng 'CSV UTF-8' rồi chọn lại")
	default:
		// lỗi của bộ đọc zip (tiếng Anh, như JSZip) không đưa ra giao diện
		return nil, apperr.BadRequest("Không đọc được file Excel (.xlsx) - file hỏng hoặc không phải .xlsx. Hãy mở bằng Excel, lưu lại dạng .xlsx (hoặc CSV UTF-8) rồi chọn lại")
	}
	return ctImportRows(sr)
}
