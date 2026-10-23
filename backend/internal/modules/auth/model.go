package auth

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	apperr "qspro-backend/internal/shared/errors"
)

// Hằng của server/auth.js.
const (
	tokenTTLMs     = 7 * 24 * 3600 * 1000 // TOKEN_TTL_MS (A:15)
	sessionCacheMs = 30 * 1000            // SESSION_CACHE_MS (A:38)
	bcryptCost     = 10
)

// prefKeys = PREF_KEYS (A:270) + tkPresets: bộ cột tự đặt tên của bảng Bóc tách [{name, cols}]
// + tkQuick: bộ cột gán vào nút nhanh trên thanh công cụ Bóc tách ("p:<id bộ có sẵn>" / "u:<tên bộ tự đặt>")
// + tkOrder: thứ tự các bộ trong khung "Chọn nhanh cột" (mảng id như tkQuick)
// + tkLastCols: cột đang hiện của bảng Bóc tách, tự lưu mỗi lần đổi (kiểm như *Cols)
// + bgBiaMau: mẫu tờ bìa báo giá tự lưu [{id, ten, mau, cfg}] (tối đa 10).
var prefKeys = []string{"tkCols", "cpCols", "daCols", "spCols", "tkPresets", "tkQuick", "tkOrder", "tkLastCols", "bgBiaMau"}

// Thông báo lỗi - nguyên văn của server/auth.js.
const (
	msgLoginFail  = "Sai tài khoản hoặc mật khẩu"
	msgLocked     = "Tài khoản đã bị khóa"
	msgNoCompany  = "Tài khoản chưa được gán công ty — liên hệ quản trị hệ thống"
	msgBadSession = "Phiên không hợp lệ"
	msgPrefKey    = "Khoá cài đặt không hợp lệ"
	msgPrefCols   = "Bộ cột không hợp lệ"
	msgPrefsCol   = `Cơ sở dữ liệu chưa có cột "ui_prefs". Hãy chạy "npm run migrate" rồi khởi động lại server.`
	msgOldPw      = "Mật khẩu hiện tại không đúng"
	msgNewPwMin   = "Mật khẩu mới tối thiểu 4 ký tự"
	// msgSessTable: database chưa chạy migration 0014 (M1.2) - báo đích danh như lỗi thiếu cột.
	msgSessTable = `Cơ sở dữ liệu chưa có bảng "user_sessions" (phiên đăng nhập, migration 0014). Hãy chạy "go run ./cmd/migrate" rồi khởi động lại server.`
)

var (
	reBcrypt   = regexp.MustCompile(`^\$2[aby]\$`)
	reWildcard = regexp.MustCompile(`[*%\\]`)
	reColErr   = regexp.MustCompile(`(?i)(column|schema cache|PGRST204)`)
	reSrcHost  = regexp.MustCompile(`^https?://[^/]+/`)
	reSid      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// toLowerCase = String.prototype.toLowerCase (đủ quy tắc Unicode). Caser có trạng thái nên tạo mới mỗi lần.
func toLowerCase(s string) string { return cases.Lower(language.Und).String(s) }

// ───────────── bcryptjs 2.4.3 ─────────────

// bcryptjs chỉ dùng 72 byte đầu của khoá (mật khẩu UTF-8 + byte 0); bcrypt của Go báo lỗi khi dài hơn 72 byte.
func pw72(s string) []byte {
	b := []byte(s)
	if len(b) > 72 {
		b = b[:72]
	}
	return b
}

// hashSync = bcrypt.hashSync(s, 10): tiền tố $2a$10$ như bcryptjs 2.4.3.
func hashSync(s string) (string, error) {
	h, err := bcrypt.GenerateFromPassword(pw72(s), bcryptCost)
	if err != nil {
		return "", apperr.New(err.Error())
	}
	return string(h), nil
}

const bcryptAlphabet = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

func b64Index(u uint16) int {
	if u > 127 {
		return -1
	}
	return strings.IndexByte(bcryptAlphabet, byte(u))
}

// saltLen: số byte base64_decode(real_salt, 16) của bcryptjs giải được (dừng ở ký tự lạ, trừ ký tự thứ 4 của mỗi nhóm).
func saltLen(s []uint16) int {
	off, olen := 0, 0
	for off < len(s)-1 && olen < 16 {
		c1, c2 := b64Index(s[off]), b64Index(s[off+1])
		off += 2
		if c1 == -1 || c2 == -1 {
			break
		}
		if olen++; olen >= 16 || off >= len(s) {
			break
		}
		c3 := b64Index(s[off])
		off++
		if c3 == -1 {
			break
		}
		if olen++; olen >= 16 || off >= len(s) {
			break
		}
		off++
		olen++
	}
	return olen
}

// compareSync = bcrypt.compareSync(s, hash) của bcryptjs 2.4.3, kể cả các trường hợp nó NÉM lỗi với hash hỏng
// (lỗi đó thành thông báo của login / changePassword) và trả false với hash không ở dạng chuẩn.
func compareSync(s, hash string) (bool, error) {
	u := utf16.Encode([]rune(hash))
	if len(u) != 60 {
		return false, nil
	}
	sub := func(a, b int) string { return string(utf16.Decode(u[a:b])) }
	if u[0] != '$' || u[1] != '2' {
		return false, apperr.New("Invalid salt version: " + sub(0, 2))
	}
	offset, minor := 3, uint16(0)
	if u[2] != '$' {
		minor = u[2]
		if (minor != 'a' && minor != 'b' && minor != 'y') || u[3] != '$' {
			return false, apperr.New("Invalid salt revision: " + sub(2, 4))
		}
		offset = 4
	}
	if u[offset+2] > '$' {
		return false, apperr.New("Missing salt rounds")
	}
	// parseInt của từng ký tự: không phải chữ số -> NaN -> không qua được phép so cuối, nhưng vẫn kiểm độ dài salt
	d1, d2 := int(u[offset])-'0', int(u[offset+1])-'0'
	roundsOK := d1 >= 0 && d1 <= 9 && d2 >= 0 && d2 <= 9
	if rounds := d1*10 + d2; roundsOK && (rounds < 4 || rounds > 31) {
		return false, apperr.New("Illegal number of rounds (4-31): " + strconv.Itoa(rounds))
	}
	salt := u[offset+3 : offset+25]
	if n := saltLen(salt); n != 16 {
		return false, apperr.New("Illegal salt length: " + strconv.Itoa(n) + " != 16")
	}
	// bcryptjs dựng lại "$2" + minor + "$" + rounds + "$" + salt chuẩn + hash rồi so cả chuỗi
	if !roundsOK || minor == 0 || u[6] != '$' {
		return false, nil
	}
	for _, c := range salt {
		if b64Index(c) == -1 {
			return false, nil
		}
	}
	if b64Index(salt[21])&0x0f != 0 { // 4 bit thừa của ký tự salt cuối phải bằng 0
		return false, nil
	}
	for _, c := range u[29:] {
		if c > 127 {
			return false, nil
		}
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), pw72(s)) == nil, nil
}
