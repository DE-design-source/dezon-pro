// Package categories: ngành hàng, hạng mục và bảng nhãn <-> cột database (server/store_supa.js dòng 14-22,
// 449-472, 596), cùng ba file mẫu nhập hàng loạt (server/vs-template.js, son-template.js, ct-template.js).
//
// Phần dữ liệu và hàm là THUẦN (không database, không trạng thái đổi được): module khác import trực tiếp gói này.
// Service chỉ tồn tại để gắn 3 route tải file mẫu.
package categories

import (
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/specs"
)

// Deps: module không cần gì từ bên ngoài.
type Deps struct{}

// Service: chỉ mang các route file mẫu.
type Service struct{}

// New tạo service.
func New(Deps) *Service { return &Service{} }

// NganhCua = nganhCua_(nganh, hangMuc): ngành đã đóng dấu thì giữ; chưa thì đoán theo hạng mục,
// thứ tự son -> ct -> vs -> dl -> den (KHÁC specs.NganhOf, vốn chỉ biết vs / den).
// dl (chỉ bản Go, theo QS Pro ea787b6): hạng mục điện lạnh chuẩn hoặc ghi chung ("Điện lạnh", "Máy lạnh"...);
// xét sau vs để chữ chung ("thông gió"...) không giành hạng mục vệ sinh.
func NganhCua(nganh, hangMuc any) string {
	if n := jsval.Trim(jsval.Str(nganh)); n != "" {
		return n
	}
	if specs.SON.ChuanHM(hangMuc) != "" {
		return "son"
	}
	if specs.CT.ChuanHM(hangMuc) != "" {
		return "ct"
	}
	if specs.VS.ChuanHM(hangMuc) != "" {
		return "vs"
	}
	if specs.DL.ChuanHM(hangMuc) != "" || specs.DLLaChung(hangMuc) {
		return "dl"
	}
	return "den"
}

// SpecNganh = specNganh_(ng): bộ thông số của ngành; ngành không có bộ riêng (den, lạ) -> nil.
func SpecNganh(ng string) *specs.Spec {
	switch ng {
	case "vs":
		return specs.VS
	case "son":
		return specs.SON
	case "ct":
		return specs.CT
	case "dl":
		return specs.DL
	}
	return nil
}

// MucNganh = MUC_NGANH: ngành -> tên đề mục trên cây. Chỉ đọc.
var MucNganh = omap.Of("vs", "Thiết bị vệ sinh", "son", "Sơn nước", "den", "Thiết bị đèn", "ct", specs.CT.Muc, "dl", specs.DL.Muc)

// Muc = MUC_NGANH[ng] || "Thiết bị đèn" (cả hai nơi dùng bên Node đều kèm giá trị mặc định này).
func Muc(ng string) string {
	return jsval.ToString(jsval.Or(MucNganh.Val(ng), "Thiết bị đèn"))
}

// dbLabel2ColBase: phần viết tay của DB_LABEL2COL (S:449-466), đúng thứ tự khai báo.
var dbLabel2ColBase = []LabelCol{
	{"MÃ SẢN PHẨM", "ma_sp"}, {"TÊN SẢN PHẨM", "ten_sp"}, {"DÒNG SẢN PHẨM", "dong_sp"}, {"HẠNG MỤC", "hang_muc"}, {"NHÓM SẢN PHẨM", "nhom_sp"},
	{"THƯƠNG HIỆU", "thuong_hieu"}, {"NHÀ CUNG CẤP", "nha_cung_cap"}, {"CÔNG SUẤT (W)", "cong_suat_w"}, {"NHIỆT ĐỘ MÀU (K)", "nhiet_do_mau_k"},
	{"QUANG THÔNG (lm)", "quang_thong_lm"}, {"GÓC CHIẾU (°)", "goc_chieu_deg"}, {"GÓC NGHIÊNG (°)", "goc_nghieng_deg"}, {"MÀU SẮC", "mau_sac"},
	{"CHẤT LIỆU", "chat_lieu"}, {"CHIỀU CAO (mm)", "chieu_cao_mm"}, {"ĐƯỜNG KÍNH (mm)", "duong_kinh_mm"}, {"LỖ KHOÉT TRẦN (mm)", "cutout_mm"},
	{"CHỈ SỐ IP", "chi_so_ip"}, {"CRI", "cri"}, {"HIỆU SUẤT PHÁT QUANG (lm/W)", "hieu_suat_lm_w"}, {"UGR", "ugr"}, {"SDCM", "sdcm"}, {"COI", "coi"},
	{"TUỔI THỌ", "tuoi_tho"}, {"TÊN CHIP LED", "ten_chip_led"}, {"LOẠI CHIP LED", "loai_chip_led"}, {"CẤP BẢO VỆ ĐIỆN", "class_rating"}, {"LẮP NGUỒN RỜI", "lap_nguon_roi"},
	{"TÊN BỘ NGUỒN", "ten_bo_nguon"}, {"MÃ BỘ NGUỒN", "ma_bo_nguon"}, {"HÃNG BỘ NGUỒN", "hang_bo_nguon"}, {"GIÁ BÁN BỘ NGUỒN", "gia_ban_bo_nguon"}, {"VỊ TRÍ LẮP NGUỒN", "vi_tri_lap_nguon"},
	{"TƯƠNG THÍCH ĐIỀU KHIỂN", "dieu_khien"}, {"DÒNG RA TỐI ĐA (mA)", "dong_ra_max_ma"}, {"BẢO HÀNH (năm)", "bao_hanh_nam"}, {"ĐƠN VỊ TÍNH", "dvt"},
	{"GIÁ BÁN LẺ", "gia_ban_le"}, {"CHIẾT KHẤU ĐẠI LÝ (%)", "ck_dai_ly_pct"}, {"ẢNH SẢN PHẨM", "anh_sp"}, {"LINK DATASHEET", "link_datasheet"},
	{"TRẠNG THÁI", "trang_thai"}, {"GHI CHÚ", "ghi_chu"},
	// Ngành thiết bị vệ sinh
	{"NGÀNH HÀNG", "nganh"}, {"KÍCH THƯỚC", "kich_thuoc"}, {"HỆ THỐNG XẢ", "he_thong_xa"},
	{"LƯỢNG NƯỚC XẢ", "luong_nuoc_xa"}, {"THIẾT KẾ", "thiet_ke"}, {"TÂM XẢ", "tam_xa"},
	{"ÁP LỰC NƯỚC", "ap_luc_nuoc"}, {"LƯU Ý", "luu_y"}, {"TÍNH NĂNG", "tinh_nang"},
	// Tài liệu sản phẩm
	{"THÔNG SỐ KỸ THUẬT", "thong_so_file"}, {"HƯỚNG DẪN CÀI ĐẶT", "huong_dan_lap_dat"}, {"FILE BẢN VẼ", "file_ban_ve"},
}

// DBLabel2Col = DB_LABEL2COL theo đúng thứ tự Object.keys(): phần viết tay rồi nhãn METRIC của VS, SON, CT
// (chỉ thêm khi nhãn chưa có cột). Thứ tự này quyết định thứ tự khoá của raw, cột file xuất sản phẩm. Chỉ đọc.
var DBLabel2Col []LabelCol

// Col2Label = COL2LABEL theo thứ tự Object.keys(): cột -> nhãn, nhiều nhãn chung một cột thì nhãn SAU CÙNG thắng. Chỉ đọc.
var Col2Label []LabelCol

var (
	label2col = map[string]string{}
	col2label = map[string]string{}
)

func init() {
	m := omap.New()
	for _, lc := range dbLabel2ColBase {
		m.Set(lc.Label, lc.Col)
	}
	for _, sp := range []*specs.Spec{specs.VS, specs.SON, specs.CT, specs.DL} {
		for _, lb := range sp.Metric.Keys() {
			if !jsval.Truthy(m.Val(lb)) {
				m.Set(lb, sp.MetricCol(lb))
			}
		}
	}
	rev := omap.New()
	m.Each(func(lb string, v any) {
		col := jsval.ToString(v) // khoá object của JS luôn là chuỗi
		DBLabel2Col = append(DBLabel2Col, LabelCol{Label: lb, Col: jsval.AsString(v)})
		label2col[lb] = jsval.AsString(v)
		rev.Set(col, lb)
	})
	rev.Each(func(col string, v any) {
		Col2Label = append(Col2Label, LabelCol{Label: jsval.AsString(v), Col: col})
		col2label[col] = jsval.AsString(v)
	})
}

// ColOf = DB_LABEL2COL[label]; nhãn lạ -> "" (mọi nơi dùng bên Node đều thử falsy).
func ColOf(label string) string { return label2col[label] }

// LabelOf = COL2LABEL[col]; cột lạ -> "".
func LabelOf(col string) string { return col2label[col] }

// Labels = Object.keys(DB_LABEL2COL). Slice mới mỗi lần gọi.
func Labels() []string {
	out := make([]string, len(DBLabel2Col))
	for i, lc := range DBLabel2Col {
		out[i] = lc.Label
	}
	return out
}
