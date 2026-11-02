package projects

import "regexp"

// projMap = PROJ_MAP (store_supa.js:223-226): khoá của client -> cột du_an, giữ đúng thứ tự khoá.
// hienTrang (cột projects.current_condition, migration 0011, M8.3) là khoá CHỈ BẢN GO, nối cuối: tạo / sửa chỉ ghi khi
// client gửi khoá này, kết quả dự án có thêm hienTrang (backend/docs/ARCHITECTURE.md 10.4).
// kienTrucSu (cột projects.architect, migration 0018) và studio (cột projects.studio, migration 0020) cùng cách:
// khoá chỉ bản Go, nối sau hienTrang; nhomThietKe / nhiepAnhGia / nhaThauThiCong / namHoanThien (migration 0021) nối tiếp.
var projMap = [][2]string{
	{"ten", "ten_du_an"}, {"khachHang", "khach_hang"}, {"diaChi", "dia_chi"}, {"sdt", "sdt"}, {"trangThai", "trang_thai"},
	{"vat", "vat_pct"}, {"tienDo", "tien_do_pct"}, {"ghiChu", "ghi_chu"}, {"quyMo", "quy_mo"}, {"tongDT", "tong_dt"},
	{"dtBaoGia", "dt_bao_gia"}, {"nhuCau", "nhu_cau"}, {"phanKhuc", "phan_khuc"}, {"maBaoGia", "ma_bao_gia"},
	{"nhomTuTao", "nhom_tu_tao"}, {"tangTuTao", "tang_tu_tao"}, {"tenBanNhap", "ten_ban_nhap"}, {"linkDezon", "link_dezon"},
	{"hienTrang", "hien_trang"}, {"kienTrucSu", "kien_truc_su"}, {"studio", "studio"},
	{"nhomThietKe", "nhom_thiet_ke"}, {"nhiepAnhGia", "nhiep_anh_gia"}, {"nhaThauThiCong", "nha_thau_thi_cong"}, {"namHoanThien", "nam_hoan_thien"},
}

// projCol: tra nhanh khoá client -> cột.
var projCol = func() map[string]string {
	m := make(map[string]string, len(projMap))
	for _, p := range projMap {
		m[p[0]] = p[1]
	}
	return m
}()

// objProtoNames: thuộc tính Object.prototype của V8. Phép tra PROJ_MAP[k] / seen[k] trên object thường của Node
// đi qua chuỗi prototype nên các khoá này ra giá trị truthy dù không được khai báo.
var objProtoNames = map[string]bool{"constructor": true, "__defineGetter__": true, "__defineSetter__": true, "hasOwnProperty": true,
	"__lookupGetter__": true, "__lookupSetter__": true, "isPrototypeOf": true, "propertyIsEnumerable": true, "toString": true,
	"valueOf": true, "__proto__": true, "toLocaleString": true}

// protoCol = String(PROJ_MAP[k]) với k thuộc Object.prototype: tên "cột" mà Node đưa vào patch.
func protoCol(k string) (string, bool) {
	if !objProtoNames[k] {
		return "", false
	}
	switch k {
	case "__proto__":
		return "[object Object]", true
	case "constructor":
		k = "Object"
	}
	return "function " + k + "() { [native code] }", true
}

// projDataKeys =PROJ_DATA_KEYS (store_supa.js:1121).
// anhDuAn: ảnh công trình của dự án (mảng URL, ảnh đầu = ảnh bìa); boqFiles: file BOQ đính kèm (mảng {url, name, at}, Excel / PDF)
// - trang Danh sách dự án / chi tiết dự án của React. nccLogo: logo nhà cung cấp {thương hiệu: URL}, lưu theo công ty ('__cty') - trang Nhà cung cấp.
var projDataKeys = []string{"phanTho", "area", "ptInfo", "ptVat", "cpCfg", "bgCfg", "bgHist", "bgOrg", "mhPay", "btFmt", "anhDuAn", "boqFiles", "nccLogo"}

// daDataHD = DA_DATA_HD (store_supa.js:1098).
const daDataHD = "Bảng du_an_data chưa được cấp quyền ghi — kiểm tra quyền của tài khoản database trong DATABASE_URL rồi thử lại."

var (
	reDaData      = regexp.MustCompile(`du_an_data`)
	reThieuBang   = regexp.MustCompile(`(?i)(does not exist|not find the table|42P01|PGRST205|404)`)
	reDaDataQuyen = regexp.MustCompile(`(?i)42501|permission denied|row-level security`)
)
