package chat

import (
	"net/mail"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// reEmail: đúng một dấu @, có dấu chấm sau @, không rỗng hai bên dấu chấm cuối - cùng mẫu với ck_chat_users_email
// (infra/db/migrations/0019_chat_email.sql) và chatLogic.normalizeEmail của giao diện.
var reEmail = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// emailSpace: khoảng trắng chung với EMAIL_SPACE của chatLogic.js (Zs + tab, xuống dòng, VT, FF, NEL, LS, PS, BOM):
// cắt hai đầu / cấm bên trong đúng cùng một tập ký tự ở hai bên (strings.TrimSpace không cắt BOM, trim() của JS không cắt NEL).
func emailSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', 0x85, 0x2028, 0x2029, 0xfeff:
		return true
	}
	return unicode.Is(unicode.Zs, r)
}

// emailSpecials: ký tự đặc biệt của RFC 5322 - net/mail coi là chú thích / tên hiển thị / dấu ngoặc nên "1<a@b.vn>" hay
// "a@b.vn(x)" sẽ gửi tới hộp thư a@b.vn dưới một danh tính khác (vượt giới hạn mã / email). Cấm hẳn, như chatLogic.js.
const emailSpecials = `"(),:;<>[]\`

// dotAtom: không rỗng, không có dấu chấm ở đầu / cuối / hai dấu chấm liền nhau (net/mail từ chối các dạng này).
func dotAtom(s string) bool {
	return s != "" && s[0] != '.' && s[len(s)-1] != '.' && !strings.Contains(s, "..")
}

// NormalizeEmail chuẩn hoá email (cùng kết quả với chatLogic.normalizeEmail của giao diện):
//   - cắt khoảng trắng hai đầu, đổi toàn bộ sang chữ thường; không bỏ dấu chấm / phần +tag của Gmail;
//   - sai nếu rỗng, dài quá 254 byte, phần trước @ quá 64 byte, còn khoảng trắng / ký tự điều khiển / ký tự đặc biệt
//     ("(),:;<>[]\) bên trong, dấu chấm ở đầu / cuối / liền nhau ở một trong hai phần, hoặc không khớp reEmail;
//   - lưới an toàn: net/mail phải đọc ra đúng chuỗi này (thư gửi đúng hộp thư đã xác thực, mailer không báo lỗi -> 500).
//
// Sai -> ("", false) (EMAIL_INVALID).
func NormalizeEmail(in string) (string, bool) {
	if !utf8.ValidString(in) {
		return "", false
	}
	s := strings.ToLower(strings.TrimFunc(in, emailSpace))
	if s == "" || len(s) > 254 {
		return "", false
	}
	for _, r := range s {
		if emailSpace(r) || unicode.IsSpace(r) || unicode.IsControl(r) || strings.ContainsRune(emailSpecials, r) {
			return "", false
		}
	}
	at := strings.IndexByte(s, '@')
	if at > 64 || !reEmail.MatchString(s) || !dotAtom(s[:at]) || !dotAtom(s[at+1:]) {
		return "", false
	}
	if a, err := mail.ParseAddress(s); err != nil || a.Name != "" || a.Address != s {
		return "", false
	}
	return s, true
}
