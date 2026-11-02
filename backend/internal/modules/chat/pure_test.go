package chat

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

// Phần không cần database: số điện thoại, email, JWT, OTP, token bucket, cursor, kiểm tra tin / push subscription.

func TestNormalizePhone(t *testing.T) {
	ok := map[string]string{
		"0901234567":          "+84901234567",
		"090 123 4567":        "+84901234567",
		"090.123.4567":        "+84901234567",
		"090-123-4567":        "+84901234567",
		"(090) 123-4567":      "+84901234567",
		" 0901234567 ":        "+84901234567",
		"84901234567":         "+84901234567",
		"+84901234567":        "+84901234567",
		"+84 90 123 4567":     "+84901234567",
		"+84 (0) 90 123 4567": "+84901234567",
		"84 0901234567":       "+84901234567",
		"+840901234567":       "+84901234567",
		"0321234567":          "+84321234567", // Viettel đầu 03
		"0561234567":          "+84561234567",
		"0701234567":          "+84701234567",
		"0812345678":          "+84812345678",
		"0987654321":          "+84987654321",
		"+1 415 555 2671":     "+14155552671", // nước ngoài: giữ nguyên
		"+44 20 7946 0958":    "+442079460958",
		"+12345678":           "+12345678", // 8 chữ số: ngắn nhất
		"+123456789012345":    "+123456789012345",
		"0901 234\t567":       "+84901234567",
	}
	for in, want := range ok {
		if got, good := NormalizePhone(in); !good || got != want {
			t.Errorf("NormalizePhone(%q) = %q, %v; muốn %q", in, got, good, want)
		}
	}
	for _, in := range []string{
		"", "   ", "+", "abc", "090123456", "09012345678", "0101234567", "0201234567", "0401234567", "0601234567",
		"+84201234567", "+8490123456", "+849012345678", "8490123456", "+0901234567", "+1234567", "+1234567890123456",
		"0901234567a", "0901-234-56x", "++84901234567", "84 1901234567", "001 415 555 2671", "+84 0 0901234567",
	} {
		if got, good := NormalizePhone(in); good {
			t.Errorf("NormalizePhone(%q) = %q phải báo sai", in, got)
		}
	}
	if lastDigits("+84901234567", 4) != "4567" {
		t.Error("lastDigits")
	}
}

// NormalizeEmail: phải cho cùng kết quả với chatLogic.normalizeEmail của giao diện.
func TestNormalizeEmail(t *testing.T) {
	nbsp, ideo, bom, nel := string(rune(0xa0)), string(rune(0x3000)), string(rune(0xfeff)), string(rune(0x85))
	local64, domain189 := strings.Repeat("a", 64), strings.Repeat("d", 186)+".vn"
	ok := map[string]string{
		"ten@congty.vn":                "ten@congty.vn",
		"  Ten.Ho+Tag@CongTy.VN  ":     "ten.ho+tag@congty.vn", // giữ dấu chấm + phần +tag
		"\tA@B.CO\r\n":                 "a@b.co",
		nbsp + "a@b.co" + ideo:         "a@b.co", // khoảng trắng Unicode hai đầu (như String.prototype.trim)
		bom + "a@b.co":                 "a@b.co",
		"a@b.c.d":                      "a@b.c.d",
		nel + "a@b.co" + bom:           "a@b.co", // NEL / BOM hai đầu: cắt như chatLogic.js (EMAIL_TRIM)
		"a!#$%&*/=?^_`{|}~@b.co":       "a!#$%&*/=?^_`{|}~@b.co",
		"ÁNH@VÍ-DỤ.VN":                 "ánh@ví-dụ.vn",
		local64 + "@b.co":              local64 + "@b.co",
		local64 + "@" + domain189:      local64 + "@" + domain189, // đúng 254 byte
		"first_last-1'x@sub.congty.vn": "first_last-1'x@sub.congty.vn",
	}
	for in, want := range ok {
		if got, good := NormalizeEmail(in); !good || got != want {
			t.Errorf("NormalizeEmail(%q) = %q, %v; muốn %q", in, got, good, want)
		}
	}
	for _, in := range []string{
		"", "   ", nbsp, "abc", "a@", "@b.co", "a@b", "a@b.", "a@.b", "a.b@c", "a@@b.co", "a@b@c.co", "a b@c.co", "a@b .co",
		"a\tb@c.co", "a" + nbsp + "b@c.co", "a" + ideo + "@b.co", "a\x00@b.co", "a\x7f@b.co", "a" + nel + "b@c.co", "a" + bom + "b@c.co",
		// ký tự đặc biệt: net/mail đọc "1<victim@corp.vn>" / "victim@corp.vn(x)" ra hộp thư victim@corp.vn (vượt giới hạn mã / email)
		"1<victim@corp.vn>", "victim@corp.vn(x)", "(x)victim@corp.vn", `"a"@b.co`, "a,b@c.co", "a;b@c.co", "a:b@c.co", "a[b]@c.co",
		"a" + string(rune(92)) + "b@c.co",
		// dấu chấm ở đầu / cuối / liền nhau (net/mail từ chối -> trước đây thành lỗi 500 khi gửi thư)
		".a@b.co", "a.@b.co", "a..b@c.co", "a@b..c", "a@b.co.", "a@.b.co",
		"a\xff@b.co", strings.Repeat("a", 65) + "@b.co", local64 + "@d" + domain189,
	} {
		if got, good := NormalizeEmail(in); good || got != "" {
			t.Errorf("NormalizeEmail(%q) = %q phải báo sai", in, got)
		}
	}
}

// parseTarget: đúng một trong số / email; tên cột chỉ là hằng; khoá advisory + tên mặc định theo loại.
func TestParseTarget(t *testing.T) {
	to, err := parseTarget("0901234567", "")
	if err != nil || to != (otpTarget{col: colPhone, value: "+84901234567"}) || to.isEmail() || to.lockKey() != "otp:+84901234567" ||
		to.defaultName() != "Người dùng 4567" || to.subject() != "Số này" {
		t.Fatalf("số: %+v %v", to, err)
	}
	to, err = parseTarget("  ", " Ten.Ho@CongTy.vn ")
	if err != nil || to != (otpTarget{col: colEmail, value: "ten.ho@congty.vn"}) || !to.isEmail() || to.lockKey() != "otp:email:ten.ho@congty.vn" ||
		to.defaultName() != "ten.ho" || to.subject() != "Email này" {
		t.Fatalf("email: %+v %v", to, err)
	}
	for _, c := range []struct{ phone, email, code string }{
		{"0901234567", "ten@congty.vn", CodeBadRequest},
		{"", "ten@congty", CodeEmailInvalid},
		{"123", "", CodePhoneInvalid},
		{"", "", CodePhoneInvalid},
		{"ten@congty.vn", "", CodePhoneInvalid}, // email gửi nhầm vào phone: không tự đoán
	} {
		if _, err := parseTarget(c.phone, c.email); codeOf(err) != c.code {
			t.Errorf("parseTarget(%q, %q): %v, muốn %s", c.phone, c.email, err, c.code)
		}
	}
	if n := (otpTarget{col: colEmail, value: strings.Repeat("x", 64) + "@b.co"}).defaultName(); n != strings.Repeat("x", 64) {
		t.Errorf("tên mặc định %q", n)
	}
	b, _ := json.Marshal(OTPRequestResult{Email: "ten@congty.vn", ExpiresIn: 300, ResendAfter: 60})
	if string(b) != `{"email":"ten@congty.vn","expires_in":300,"resend_after":60}` {
		t.Errorf("OTPRequestResult email: %s", b)
	}
	b, _ = json.Marshal(OTPRequestResult{Phone: "+84901234567", ExpiresIn: 300, ResendAfter: 60, DevCode: "123456"})
	if string(b) != `{"phone":"+84901234567","expires_in":300,"resend_after":60,"dev_code":"123456"}` {
		t.Errorf("OTPRequestResult số: %s", b)
	}
}

// userRow.dto: số / email chỉ lộ đúng chỗ - tra số không lộ email và ngược lại, chặn thì không lộ gì.
func TestUserDTOContactVisibility(t *testing.T) {
	ph, em := "+84901234567", "ten@congty.vn"
	on := map[int64]bool{2: true}
	for _, c := range []struct {
		what                 string
		id                   int64
		mine, theirs         string
		showPhone, showEmail bool
		wantPhone, wantEmail bool
	}{
		{"chính mình", 1, "", "", false, false, true, true},
		{"người lạ trong danh sách", 2, "", "", false, false, false, false},
		{"tra đúng số", 2, "", "", true, false, true, false},
		{"tra đúng email", 2, "", "", false, true, false, true},
		{"bạn bè", 2, "accepted", "accepted", false, false, true, true},
		{"lời mời tới tôi", 2, "", "pending", false, false, false, false},
		{"họ chặn tôi, tra email", 2, "", "blocked", false, true, false, false},
		{"tôi chặn họ, tra số", 2, "blocked", "", true, false, false, false},
	} {
		u := &userRow{id: c.id, name: "B", phone: &ph, email: &em, mine: c.mine, theirs: c.theirs}
		d := u.dto(1, c.showPhone, c.showEmail, false, on)
		if (d.Phone != nil) != c.wantPhone || (d.Email != nil) != c.wantEmail {
			t.Errorf("%s: phone %v email %v", c.what, d.Phone, d.Email)
		}
	}
	// tài khoản tạo bằng email: bạn bè thấy email, phone = null
	u := &userRow{id: 2, name: "B", email: &em, mine: "accepted", theirs: "accepted"}
	b, _ := json.Marshal(u.dto(1, true, false, true, on))
	if string(b) != `{"id":2,"display_name":"B","phone":null,"email":"ten@congty.vn","relation":"friend","online":true}` {
		t.Errorf("bạn bè chỉ có email: %s", b)
	}
}

func TestAccessToken(t *testing.T) {
	key := []byte("khoa-thu")
	now := time.Unix(1_800_000_000, 0)
	tok := signAccess(key, 5, 7, now, 15*time.Minute)
	uid, did, err := parseAccess(key, tok, now.Add(14*time.Minute))
	if err != nil || uid != 5 || did != 7 {
		t.Fatalf("token hợp lệ: %d %d %v", uid, did, err)
	}
	// payload đúng định dạng spec
	parts := strings.Split(tok, ".")
	pb, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var c map[string]any
	_ = json.Unmarshal(pb, &c)
	if c["sub"] != "5" || c["did"] != float64(7) || c["typ"] != "chat" || c["iat"] != float64(now.Unix()) || c["exp"] != float64(now.Unix()+900) {
		t.Errorf("claims: %v", c)
	}
	hb, _ := base64.RawURLEncoding.DecodeString(parts[0])
	if string(hb) != `{"alg":"HS256","typ":"JWT"}` {
		t.Errorf("header: %s", hb)
	}
	bad := func(name, tok string, at time.Time) {
		t.Helper()
		if _, _, err := parseAccess(key, tok, at); err == nil {
			t.Errorf("%s: phải từ chối", name)
		}
	}
	bad("hết hạn", tok, now.Add(15*time.Minute))
	bad("khoá khác", signAccess([]byte("khac"), 5, 7, now, time.Minute), now)
	bad("rỗng", "", now)
	bad("2 phần", parts[0]+"."+parts[1], now)
	bad("4 phần", tok+".x", now)
	bad("dài quá", strings.Repeat("a", maxTokenLen+1), now)
	bad("sửa payload", parts[0]+"."+base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"6","did":7,"typ":"chat","exp":9999999999}`))+"."+parts[2], now)

	// tự ký với header / claims tuỳ ý
	forge := func(header, payload string, k []byte) string {
		in := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + base64.RawURLEncoding.EncodeToString([]byte(payload))
		h := hmac.New(sha256.New, k)
		h.Write([]byte(in))
		return in + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	}
	good := `{"sub":"5","did":7,"typ":"chat","iat":1,"exp":9999999999}`
	if _, _, err := parseAccess(key, forge(`{"alg":"HS256"}`, good, key), now); err != nil {
		t.Errorf("token tự ký đúng khoá phải nhận: %v", err)
	}
	// alg confusion: "none", HS512, RS256, thiếu alg, viết hoa khác
	for _, h := range []string{`{"alg":"none"}`, `{"alg":"HS512"}`, `{"alg":"RS256"}`, `{}`, `{"alg":"hs256"}`, `not json`} {
		bad("alg "+h, forge(h, good, key), now)
	}
	none := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`)) + "." + base64.RawURLEncoding.EncodeToString([]byte(good)) + "."
	bad("alg none không chữ ký", none, now)
	for _, p := range []string{
		`{"sub":"5","did":7,"typ":"qs","exp":9999999999}`,   // không phải token chat
		`{"sub":"5","did":0,"typ":"chat","exp":9999999999}`, // thiếu thiết bị
		`{"sub":"x","did":7,"typ":"chat","exp":9999999999}`,
		`{"sub":"0","did":7,"typ":"chat","exp":9999999999}`,
		`{"sub":"5","did":7,"typ":"chat"}`, // không có exp
		`{"sub":"5","did":7,"typ":"chat","exp":"9999999999"}`,
		`[1]`,
	} {
		bad("claims "+p, forge(`{"alg":"HS256"}`, p, key), now)
	}
	// token phiên QS (body.sig) không bao giờ là token chat
	bad("token QS", "eyJ1aWQiOjF9.c2ln", now)
}

func TestRefreshToken(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		raw, hash, err := newRefreshToken()
		if err != nil || len(raw) != 43 || seen[raw] {
			t.Fatalf("token %q %v", raw, err)
		}
		seen[raw] = true
		sum := sha256.Sum256([]byte(raw))
		if hash != hex.EncodeToString(sum[:]) || hashToken(raw) != hash || !reSHA256.MatchString(hash) {
			t.Fatalf("hash %q", hash)
		}
	}
}

func TestOTP(t *testing.T) {
	seen := map[string]int{}
	for i := 0; i < 200; i++ {
		c, err := newOTP()
		if err != nil || len(c) != 6 || !allDigits(c) {
			t.Fatalf("otp %q %v", c, err)
		}
		seen[c]++
	}
	if len(seen) < 190 {
		t.Errorf("otp lặp nhiều bất thường: %d mã khác nhau / 200", len(seen))
	}
	key := []byte("k")
	h := otpHash(key, "+84901234567", "123456")
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("+84901234567:123456"))
	if h != hex.EncodeToString(mac.Sum(nil)) {
		t.Errorf("otpHash = %s", h)
	}
	if otpHash(key, "+84901234568", "123456") == h || otpHash(key, "+84901234567", "123457") == h || otpHash([]byte("k2"), "+84901234567", "123456") == h {
		t.Error("otpHash phải phụ thuộc khoá, số và mã")
	}
	if !otpEqual(h, otpHash(key, "+84901234567", "123456")) || otpEqual(h, h[:63]+"0") {
		t.Error("otpEqual")
	}
	if got := otpText("123456"); got != "Mã xác thực Dezon Chat: 123456 (hết hạn sau 5 phút)" || reOTPCode.FindString(got) != "123456" {
		t.Errorf("otpText %q", got)
	}
	subject, text, body := otpEmail("012345")
	if subject != "Mã xác thực Dezon Chat" || reOTPCode.FindString(text) != "012345" || !strings.Contains(body, ">012345<") {
		t.Errorf("otpEmail: %q / %q / %q", subject, text, body)
	}
	for _, want := range []string{"hết hạn sau 5 phút", "không chia sẻ mã", "Nếu bạn không yêu cầu mã thì bỏ qua email này"} {
		if !strings.Contains(text, want) || !strings.Contains(body, want) {
			t.Errorf("email OTP thiếu %q", want)
		}
	}
	// không có Mail -> logMailer (ghi mã vào log), không lỗi
	s := New(Deps{})
	if _, ok := s.mail.(logMailer); !ok || s.mail.Send(context.Background(), "ten@congty.vn", subject, text, body) != nil {
		t.Errorf("Mail mặc định: %T", s.mail)
	}
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *clock { return &clock{t: time.Now()} }

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func TestLimiter(t *testing.T) {
	clk := newClock()
	l := newLimiter(20, time.Second, clk.now)
	for i := 0; i < 20; i++ {
		if !l.allow(1) {
			t.Fatalf("lượt %d phải được", i+1)
		}
	}
	if l.allow(1) {
		t.Fatal("lượt 21 trong cùng giây phải bị chặn")
	}
	if !l.allow(2) {
		t.Fatal("người khác không bị ảnh hưởng")
	}
	clk.add(50 * time.Millisecond) // hồi 1 lượt
	if !l.allow(1) || l.allow(1) {
		t.Fatal("sau 50ms hồi đúng 1 lượt")
	}
	clk.add(10 * time.Second) // hồi đầy, không vượt burst
	n := 0
	for l.allow(1) {
		n++
	}
	if n != 20 {
		t.Fatalf("hồi đầy = %d lượt, muốn 20", n)
	}
	// 30 / giờ
	h := newLimiter(30, time.Hour, clk.now)
	for i := 0; i < 30; i++ {
		h.allow(9)
	}
	if h.allow(9) {
		t.Fatal("lời mời thứ 31 trong giờ phải bị chặn")
	}
	clk.add(2 * time.Minute)
	if !h.allow(9) {
		t.Fatal("sau 2 phút hồi 1 lượt")
	}
	// dọn bucket đầy
	clk.add(2 * time.Hour)
	h.allow(10)
	if _, ok := h.buckets[9]; ok {
		t.Error("bucket đã hồi đầy phải được dọn")
	}
	// an toàn khi chạy song song
	var wg sync.WaitGroup
	c := newLimiter(1000, time.Hour, clk.now)
	var mu sync.Mutex
	got := 0
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 30; j++ {
				if c.allow(3) {
					mu.Lock()
					got++
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	if got != 1000 {
		t.Errorf("song song: %d lượt, muốn đúng 1000", got)
	}
}

func TestListCursor(t *testing.T) {
	at := time.Date(2026, 10, 30, 3, 4, 5, 123456000, time.UTC)
	for _, c := range []listCursor{{at: &at, id: 12}, {id: 7}, {at: &at, id: 1 << 40}} {
		got, err := decodeListCursor(encodeListCursor(c))
		if err != nil || got.id != c.id || (c.at == nil) != (got.at == nil) || (c.at != nil && !got.at.Equal(*c.at)) {
			t.Errorf("cursor %+v -> %+v %v", c, got, err)
		}
	}
	if c, err := decodeListCursor(""); c != nil || err != nil {
		t.Error("cursor rỗng = trang đầu")
	}
	for _, s := range []string{"x", "!!!", base64.RawURLEncoding.EncodeToString([]byte("t1:")), base64.RawURLEncoding.EncodeToString([]byte("q:1")),
		base64.RawURLEncoding.EncodeToString([]byte("n:0")), base64.RawURLEncoding.EncodeToString([]byte("tx:1")), base64.RawURLEncoding.EncodeToString([]byte("n1"))} {
		if _, err := decodeListCursor(s); err == nil {
			t.Errorf("cursor hỏng %q phải báo lỗi", s)
		}
	}
	if ts, err := parseSyncCursor("1730100000123"); err != nil || ts.UnixMilli() != 1730100000123 {
		t.Errorf("sync cursor: %v %v", ts, err)
	}
	for _, s := range []string{"", "abc", "-1", "1.5", "99999999999999999999"} {
		if _, err := parseSyncCursor(s); err == nil {
			t.Errorf("sync cursor %q phải báo lỗi", s)
		}
	}
	if got := pgTime(at); got != "2026-10-30 03:04:05.123456Z" {
		t.Errorf("pgTime = %q", got)
	}
}

func TestValidateSend(t *testing.T) {
	id := "6B1E0C7A-3F0E-4C51-9A0E-2D4B7F1C9E11"
	in := SendInput{ConversationID: 9, ClientMsgID: id, MsgType: "text", Content: "  Chào bạn \n"}
	if err := validateSend(&in); err != nil || in.Content != "Chào bạn" || in.ClientMsgID != strings.ToLower(id) {
		t.Fatalf("hợp lệ: %v %+v", err, in)
	}
	long := strings.Repeat("ạ", maxContent)
	if err := validateSend(&SendInput{ConversationID: 9, ClientMsgID: id, MsgType: "text", Content: long}); err != nil {
		t.Errorf("đúng 4000 ký tự (nhiều byte) phải nhận: %v", err)
	}
	for name, in := range map[string]SendInput{
		"thiếu hội thoại": {ClientMsgID: id, MsgType: "text", Content: "a"},
		"ảnh":             {ConversationID: 9, ClientMsgID: id, MsgType: "image", Content: "a"},
		"system":          {ConversationID: 9, ClientMsgID: id, MsgType: "system", Content: "a"},
		"trống":           {ConversationID: 9, ClientMsgID: id, MsgType: "text", Content: " \n\t "},
		"dài":             {ConversationID: 9, ClientMsgID: id, MsgType: "text", Content: long + "a"},
		"NUL":             {ConversationID: 9, ClientMsgID: id, MsgType: "text", Content: "a\x00b"},
		"uuid sai":        {ConversationID: 9, ClientMsgID: "123", MsgType: "text", Content: "a"},
		"uuid thiếu":      {ConversationID: 9, MsgType: "text", Content: "a"},
	} {
		if err := validateSend(&in); err == nil {
			t.Errorf("%s: phải báo BAD_REQUEST", name)
		}
	}
}

func TestValidSubscription(t *testing.T) {
	// khoá của ví dụ RFC 8291 phụ lục A (điểm P-256 thật + auth 16 byte): webpush.Send nhận được
	const p256dh, auth = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg"
	subK := func(ep, p, a string) string {
		b, _ := json.Marshal(map[string]any{"endpoint": ep, "keys": map[string]string{"p256dh": p, "auth": a}})
		return string(b)
	}
	sub := func(ep string) string { return subK(ep, p256dh, auth) }
	for _, ep := range []string{"https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
		"https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/QGx"} {
		if !validSubscription(sub(ep)) {
			t.Errorf("%s phải hợp lệ", ep)
		}
	}
	for _, s := range []string{sub("http://fcm.googleapis.com/x"), sub("https://127.0.0.1/x"), sub("https://evil.example/x"),
		sub("https://fcm.googleapis.com.evil.example/x"), sub("https://u:p@fcm.googleapis.com/x"), sub(""),
		`{"endpoint":"https://fcm.googleapis.com/x","keys":{"auth":"a"}}`, `not json`, sub("https://fcm.googleapis.com/" + strings.Repeat("a", 5000)),
		// khoá sai: webpush.Send sẽ luôn từ chối -> không được lưu
		subK("https://fcm.googleapis.com/x", "BNc", auth), subK("https://fcm.googleapis.com/x", p256dh, "tBH"),
		subK("https://fcm.googleapis.com/x", "B"+strings.Repeat("A", 86), auth)} {
		if validSubscription(s) {
			t.Errorf("%s phải bị từ chối", s)
		}
	}
}

// Topic Web Push theo (người nhận, hội thoại), tối đa 32 ký tự; dài hơn thì không gửi Topic.
func TestPushTopic(t *testing.T) {
	if got := pushTopic(12, 345); got != "c12-345" {
		t.Errorf("pushTopic(12, 345) = %q", got)
	}
	if got := pushTopic(123456789012345, 123456789012345); got != "c123456789012345-123456789012345" || len(got) != 32 {
		t.Errorf("đúng 32 ký tự phải giữ: %q", got)
	}
	if got := pushTopic(1234567890123456, 123456789012345); got != "" {
		t.Errorf("33 ký tự phải bỏ Topic: %q", got)
	}
	if got := pushTopic(9223372036854775807, 9223372036854775807); got != "" {
		t.Errorf("id bigint lớn nhất phải bỏ Topic: %q", got)
	}
}

func TestHelpers(t *testing.T) {
	if got := cleanIDs([]int64{3, 0, 5, 3, -1, 9, 5}, 9); len(got) != 2 || got[0] != 3 || got[1] != 5 {
		t.Errorf("cleanIDs %v", got)
	}
	names := map[int64]string{1: "An", 2: "Bình", 3: "Châu", 4: "Dũng", 5: "Em", 6: "Giang", 7: "Hà"}
	if got := nameList(names, []int64{2, 3}); got != "Bình, Châu" {
		t.Errorf("nameList %q", got)
	}
	if got := nameList(names, []int64{1, 2, 3, 4, 5, 6, 7}); got != "An, Bình, Châu, Dũng, Em và 2 người khác" {
		t.Errorf("nameList dài %q", got)
	}
	if s, ok := cleanText("  Nhóm A ", 100); !ok || s != "Nhóm A" {
		t.Error("cleanText")
	}
	if _, ok := cleanText(strings.Repeat("a", 101), 100); ok {
		t.Error("cleanText dài")
	}
	if truncRunes("Xin chào các bạn", 8) != "Xin chào" {
		t.Error("truncRunes")
	}
	if pairKey(9, 3) != pairKey(3, 9) {
		t.Error("pairKey phải đối xứng")
	}
}

func TestLimiterAllowN(t *testing.T) {
	clk := newClock()
	l := newLimiter(100, time.Hour, clk.now)
	if !l.allowN(1, 60) || l.allowN(1, 41) {
		t.Fatal("100 lượt: lấy 60 rồi 41 thì lần sau phải bị chặn")
	}
	if !l.allowN(1, 40) || l.allow(1) {
		t.Fatal("bị chặn thì không trừ: còn đúng 40")
	}
	clk.add(30 * time.Minute)
	if !l.allowN(1, 50) || l.allow(1) {
		t.Fatal("nửa giờ hồi 50 lượt")
	}
}

// Push: một job cho một tin (không phải một job cho mỗi người nhận); gộp tin ngay lúc xếp hàng; hàng đợi đầy thì bỏ
// và chỉ đếm (log tối đa 1 dòng / phút).
func TestPushQueuePerMessage(t *testing.T) {
	clk := newClock()
	s := New(Deps{Push: newFakePush(), Now: clk.now})
	s.pushQ = make(chan pushJob, 1)
	s.pushStarted = true // không chạy worker: xem thẳng hàng đợi
	users := make([]int64, 999)
	for i := range users {
		users[i] = int64(i + 1)
	}
	s.enqueuePush(pushJob{convID: 1, seq: 1, users: users})
	if len(s.pushQ) != 1 {
		t.Fatalf("tin cho 999 người phải chiếm 1 chỗ, có %d", len(s.pushQ))
	}
	if j := <-s.pushQ; len(j.users) != 999 || j.seq != 1 {
		t.Fatalf("job: %d người, seq %d", len(j.users), j.seq)
	}
	s.enqueuePush(pushJob{convID: 1, seq: 2, users: users})
	if len(s.pushQ) != 0 {
		t.Fatal("cùng hội thoại trong 3 giây: gộp ngay lúc xếp hàng")
	}
	s.enqueuePush(pushJob{convID: 1, seq: 3, users: []int64{5, 1000}})
	if j := <-s.pushQ; len(j.users) != 1 || j.users[0] != 1000 {
		t.Fatalf("chỉ người chưa được push trong 3 giây: %v", j.users)
	}
	s.enqueuePush(pushJob{convID: 2, users: []int64{1}})
	s.enqueuePush(pushJob{convID: 3, users: []int64{1, 2}}) // đầy: bỏ, ghi log ngay lần đầu
	s.enqueuePush(pushJob{convID: 4, users: []int64{1, 2, 3}})
	if s.pushDrops != 3 {
		t.Fatalf("trong 1 phút chỉ đếm, chưa ghi log: %d", s.pushDrops)
	}
	clk.add(time.Minute)
	s.enqueuePush(pushJob{convID: 5, users: []int64{1}})
	if s.pushDrops != 0 {
		t.Fatalf("qua 1 phút: ghi log tổng rồi đếm lại, còn %d", s.pushDrops)
	}
}
