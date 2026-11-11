package chat

import "strings"

// phoneJunk: ký tự trang trí người dùng hay gõ trong số điện thoại.
var phoneJunk = strings.NewReplacer(" ", "", ".", "", "-", "", "(", "", ")", "", "\t", "", " ", "")

// NormalizePhone đưa số điện thoại về E.164 (+84901234567). Quy tắc:
//   - bỏ khoảng trắng, dấu chấm, gạch ngang, ngoặc;
//   - 0 + 9 số -> +84 + 9 số (Việt Nam); 84 + 9 số -> +84...; "+84 (0)9x..." / "84 09x..." bỏ số 0 thừa sau mã nước;
//   - "+" + 8..15 chữ số giữ nguyên (số nước ngoài);
//   - số +84 phải là số di động: đúng 9 số sau 84, bắt đầu bằng 3, 5, 7, 8 hoặc 9.
//
// Sai -> ok = false (PHONE_INVALID).
func NormalizePhone(in string) (string, bool) {
	s := phoneJunk.Replace(strings.TrimSpace(in))
	plus := strings.HasPrefix(s, "+")
	if plus {
		s = s[1:]
	}
	if s == "" || !allDigits(s) {
		return "", false
	}
	switch {
	case plus:
	case len(s) == 10 && s[0] == '0':
		s = "84" + s[1:]
	case len(s) == 11 && strings.HasPrefix(s, "84"):
	case len(s) == 12 && strings.HasPrefix(s, "840"):
	default:
		return "", false
	}
	if len(s) == 12 && strings.HasPrefix(s, "840") { // 84 + 0 thừa + 9 số
		s = "84" + s[3:]
	}
	if len(s) < 8 || len(s) > 15 || s[0] == '0' {
		return "", false
	}
	if strings.HasPrefix(s, "84") {
		rest := s[2:]
		if len(rest) != 9 || strings.IndexByte("35789", rest[0]) < 0 {
			return "", false
		}
	}
	return "+" + s, true
}

func allDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// lastDigits: n chữ số cuối (tên mặc định "Người dùng 4567").
func lastDigits(phone string, n int) string {
	if len(phone) <= n {
		return strings.TrimPrefix(phone, "+")
	}
	return phone[len(phone)-n:]
}
