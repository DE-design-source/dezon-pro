package users

import (
	"regexp"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	apperr "qspro-backend/internal/shared/errors"
)

// Thông báo lỗi - nguyên văn của server/auth.js.
const (
	msgUsername   = "Tên đăng nhập ≥3 ký tự (chữ thường, số, . _ -)"
	msgPwMin      = "Mật khẩu tối thiểu 4 ký tự"
	msgNoCompany  = "Tài khoản của bạn chưa gắn với công ty nào nên chưa tạo được tài khoản mới — chọn một công ty ở tab Công ty rồi thử lại."
	msgNotFound   = "Không tìm thấy tài khoản"
	msgLastAdmin  = "Phải còn ít nhất 1 admin đang hoạt động"
	msgSelfDelete = "Không thể tự xóa tài khoản đang đăng nhập"
	// Chỉ bản Go (2026-11-20): admin công ty chỉ quản lý nhân viên; tài khoản quản trị công ty do quản trị hệ thống (super) quản lý
	msgAdminOnlySuper = "Chỉ quản trị hệ thống mới tạo / sửa được tài khoản quản trị công ty"
	msgSelfRole       = "Không thể tự đổi vai trò của tài khoản đang đăng nhập"
	// Chỉ bản Go (M14.6): duyệt sản phẩm theo phân cấp
	msgGrantSpDuyet      = "Bạn chưa được quản trị hệ thống giao quyền duyệt sản phẩm nên không cấp được quyền duyệt cho nhân viên"
	msgApprovalAdminOnly = "Chỉ giao quyền duyệt cho tài khoản quản trị công ty"
	msgSuperOnly         = "Chỉ quản trị hệ thống"
	msgPermsCol          = `Chưa cài cột phân quyền. Hãy chạy "npm run migrate" rồi khởi động lại server.`
)

// Thông báo lỗi của vai trò subadmin (nhãn giao diện "Admin", chỉ bản Go, M14.7).
const (
	msgSubStaffOnly  = "Admin chỉ tạo / sửa được tài khoản nhân viên"
	msgSubTargetPerm = "Tài khoản này có quyền duyệt mà bạn không có nên bạn không quản lý được"
	msgSubDaDuyet    = "Bạn chưa có quyền duyệt sửa thông tin dự án nên không cấp được quyền này cho nhân viên"
	msgSubSpLevel    = "Bạn chỉ được sửa sản phẩm (chờ duyệt) nên không cấp được quyền sửa sản phẩm không cần duyệt"
	msgSubTargetHR   = "Tài khoản này có vai trò HR cao hơn của bạn nên bạn không quản lý được"
)

// Thông báo lỗi của đường sửa email (chỉ bản Go, roadmap M14.1).
const (
	msgEmailBad = "Email không hợp lệ"
	msgEmailDup = "Email đã dùng cho tài khoản khác trong công ty"
)

var (
	reUsername  = regexp.MustCompile(`^[a-z0-9._-]{3,}$`)
	reColErr    = regexp.MustCompile(`(?i)(column|schema cache|PGRST204)`)
	rePermsWhat = regexp.MustCompile(`(?i)(column|schema cache)`)
	// reEmail = /^[^\s@]+@[^\s@]+$/ của JS: \s của JS gồm cả khoảng trắng Unicode, \s của RE2 chỉ có ASCII.
	reEmail = regexp.MustCompile(`^[^` + jsSpace + `@]+@[^` + jsSpace + `@]+$`)
)

// jsSpace: lớp ký tự \s của JavaScript (dùng trong [...] của RE2).
const jsSpace = `\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// bcryptCost: bcrypt.hashSync(x, 10).
const bcryptCost = 10

// hashSync = bcrypt.hashSync(s, 10) của bcryptjs 2.4.3 (tiền tố $2a$10$).
// bcryptjs chỉ dùng 72 byte đầu của mật khẩu; bcrypt của Go báo lỗi khi dài hơn -> cắt trước.
func hashSync(s string) (string, error) {
	b := []byte(s)
	if len(b) > 72 {
		b = b[:72]
	}
	h, err := bcrypt.GenerateFromPassword(b, bcryptCost)
	if err != nil {
		return "", apperr.New(err.Error())
	}
	return string(h), nil
}

// toLowerCase = String.prototype.toLowerCase (đủ quy tắc Unicode: sigma cuối từ, I có chấm...).
// Caser có trạng thái nên tạo mới mỗi lần gọi.
func toLowerCase(s string) string { return cases.Lower(language.Und).String(s) }
