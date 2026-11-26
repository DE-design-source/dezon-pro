package estimates

// ctSrc = CT_SRC (store_supa.js:1319-1321): cột DB -> khoá phía client, giữ đúng thứ tự khoá
// (thứ tự này quyết định thứ tự cột của bản vá và thứ tự dòng lịch sử).
var ctSrc = [][2]string{
	{"loai", "loai"}, {"che_do", "mode"}, {"ma_nhom", "maNhom"}, {"hang_muc", "hangMuc"}, {"de_muc", "deMuc"},
	{"ten", "ten"}, {"dvt", "dvt"}, {"nha_cung_cap", "ncc"}, {"khoi_luong", "kl"}, {"dien_tich", "dt"},
	{"he_so", "hs"}, {"don_gia_nha_thau", "dgnt"}, {"don_gia", "dg"}, {"ghi_chu", "gc"}, {"hinh_anh", "hinhAnh"},
	{"thong_so", "thongSo"}, {"pham_vi", "phamVi"}, {"link_tai_lieu", "linkTaiLieu"}, {"thu_tu", "thuTu"},
	{"ma_sp", "maSP"}, // migration 0055: mã sản phẩm (cột "Mã sản phẩm" của bảng Phần thô)
}

// ctFieldLbl = CT_FIELD_LBL (store_supa.js:1395-1401): cột -> nhãn trong lịch sử.
var ctFieldLbl = map[string]string{
	"loai": "LOẠI BÁO GIÁ", "che_do": "CHẾ ĐỘ", "ma_nhom": "MÃ NHÓM", "hang_muc": "HẠNG MỤC", "de_muc": "ĐỀ MỤC BÓC TÁCH",
	"ten": "TÊN CÔNG TÁC", "dvt": "ĐƠN VỊ TÍNH", "nha_cung_cap": "NHÀ THẦU / NCC", "khoi_luong": "KHỐI LƯỢNG",
	"dien_tich": "DIỆN TÍCH", "he_so": "HỆ SỐ", "don_gia_nha_thau": "ĐƠN GIÁ NHÀ THẦU", "don_gia": "ĐƠN GIÁ",
	"ghi_chu": "GHI CHÚ", "hinh_anh": "HÌNH ẢNH", "thong_so": "THÔNG SỐ", "pham_vi": "PHẠM VI",
	"link_tai_lieu": "LINK TÀI LIỆU", "da_duyet": "TRẠNG THÁI DUYỆT", "yeu_thich": "YÊU THÍCH", "thu_tu": "THỨ TỰ",
	"ma_sp": "MÃ SẢN PHẨM",
}

// ctDiffSkip: cột "ai / lúc nào" không ghi vào lịch sử (store_supa.js:1420).
var ctDiffSkip = map[string]bool{"nguoi_sua": true, "ngay_cap_nhat": true, "nguoi_duyet": true, "ngay_duyet": true}

// change: một thay đổi {field, old, new} của ctDiff_ / ctHistory_.
type change struct {
	Field string
	Old   any
	New   any
}

// ctCol: một cột của file xuất công tác.
type ctCol struct {
	Key    string
	Header string
	Width  float64
}

// ctCols = CT_COLS (index.js:692-697).
var ctCols = []ctCol{
	{"stt", "STT", 6}, {"loai", "LOẠI BÁO GIÁ", 20}, {"hangMuc", "HẠNG MỤC", 30},
	{"noiDung", "NỘI DUNG CÔNG VIỆC", 52}, {"dvt", "ĐVT", 9},
	{"khoiLuong", "KHỐI LƯỢNG", 13}, {"dienTich", "DIỆN TÍCH", 12}, {"heSo", "HỆ SỐ", 9},
	{"dgnt", "ĐƠN GIÁ (NHÀ THẦU)", 20}, {"dg", "ĐƠN GIÁ", 16}, {"ghiChu", "GHI CHÚ", 46},
}

// Hằng của file xuất (index.js:702, 726, 732, 735).
const (
	exportSheet   = "Cong tac xay dung"
	exportName    = "cong-tac-xay-dung.xlsx"
	exportMaxRows = 5000
	xlsxMime      = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
