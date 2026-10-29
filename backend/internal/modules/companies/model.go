package companies

// tenantTablesOrder = Object.keys(supa.TENANT_TABLES) bỏ "users" rồi nối "users" vào cuối (A:204).
// database.TenantTables là map của Go (không giữ thứ tự) nên thứ tự của Node (supa.js:34-40) chép lại ở đây;
// test TestTenantTablesOrder giữ cho danh sách này khớp với map đó.
var tenantTablesOrder = []string{
	"du_an", "db_bao_gia", "khai_toan", "db_san_pham", "db_san_pham_history",
	"don_mua_hang", "chi_tiet_mua_hang", "notifications", "delete_requests",
	"audit_log", "sp_combo", "sp_yeu_thich", "cong_tac",
	"de_xuat", "chi_tiet_de_xuat_ck", "chi_tiet_de_xuat_tt", "cong_tac_history",
	"du_an_data", "cai_dat_cong_ty", "kd_cham_soc", "kd_khach_hang",
	"tk_binh_luan", "tk_cong_viec", "tk_giai_doan", "tk_thau_phu", "tk_thanh_vien", "tk_du_an",
	"users",
}

// Thông báo lỗi - nguyên văn của server/auth.js.
const (
	msgListSuper   = "Chỉ quản trị hệ thống mới xem được"
	msgCreateSuper = "Chỉ quản trị hệ thống mới tạo được công ty"
	msgDeleteSuper = "Chỉ quản trị hệ thống mới xoá được công ty"
	msgSuperOnly   = "Chỉ quản trị hệ thống"
	msgNoTen       = "Chưa nhập tên công ty"
	msgNoPerm      = "Không có quyền"
	msgOwnOnly     = "Chỉ sửa được công ty của bạn"
	msgNotFound    = "Không tìm thấy công ty"
	msgMauChinh    = "Màu chính phải dạng #RRGGBB" // chỉ bản Go (M17.2)
	msgNoShareCol  = `Chưa bật được kho SP chung: cơ sở dữ liệu thiếu cột dung_sp_dezon. Hãy chạy "npm run migrate" rồi khởi động lại server.`
)
