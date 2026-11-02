package chat

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

// OTP: giới hạn gửi (60 giây, 5 / giờ / số, 20 / giờ / IP), sai 5 lần khoá 15 phút, hết hạn, dev_code, dọn dòng cũ.
func TestOTPRequestLimitsDB(t *testing.T) {
	e := newEnv(t, envOpt{otpDev: true})
	ctx := context.Background()
	phone := e.randPhone()
	local := "0" + phone[3:] // cùng số, gõ kiểu 09...

	r, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: local}, "10.1.1.1")
	if err != nil {
		t.Fatal(err)
	}
	if r.Phone != phone || r.ExpiresIn != 300 || r.ResendAfter != 60 || len(r.DevCode) != 6 || r.DevCode != e.sms.code(phone) {
		t.Fatalf("kết quả: %+v, sms %q", r, e.sms.code(phone))
	}
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, "10.1.1.1")
	wantCode(t, "gửi lại ngay", err, CodeOTPRateLimit)
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Phone: "123"}, "10.1.1.1")
	wantCode(t, "số sai", err, CodePhoneInvalid)

	// lùi thời gian các mã đã gửi: hết 60 giây chờ, vẫn trong 1 giờ -> tối đa 5 lần
	back := func(sql string) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, sql, phone); err != nil {
			t.Fatal(err)
		}
	}
	for i := 2; i <= 5; i++ {
		back(`update chat_otp_codes set created_at = created_at - interval '61 seconds' where phone = $1`)
		if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, "10.1.1.1"); err != nil {
			t.Fatalf("lần %d: %v", i, err)
		}
	}
	back(`update chat_otp_codes set created_at = created_at - interval '61 seconds' where phone = $1`)
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, "10.1.1.1")
	wantCode(t, "lần 6 trong giờ", err, CodeOTPRateLimit)

	// sau 1 giờ được gửi tiếp; dòng cũ hơn 24 giờ bị dọn
	back(`update chat_otp_codes set created_at = created_at - interval '25 hours' where phone = $1`)
	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, ""); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_otp_codes where phone = $1`, phone).Scan(&n)
	if n != 1 {
		t.Errorf("dòng cũ hơn 24 giờ phải bị dọn, còn %d dòng", n)
	}
	var ip string
	_ = e.pool.QueryRow(ctx, `select request_ip from chat_otp_codes where phone = $1`, phone).Scan(&ip)
	if ip != "" {
		t.Errorf("request_ip = %q", ip)
	}

	// 20 lần / giờ / IP (các số khác nhau)
	ipx := "10.9." + newUUID()[:8]
	for i := 0; i < 20; i++ {
		if _, err := e.pool.Exec(ctx, `insert into chat_otp_codes (phone, code_hash, request_ip, expires_at) values ($1, 'x', $2, now())`,
			e.randPhone(), ipx); err != nil {
			t.Fatal(err)
		}
	}
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Phone: e.randPhone()}, ipx)
	wantCode(t, "IP thứ 21", err, CodeOTPRateLimit)

	// không bật CHAT_OTP_DEV: không trả mã
	e2 := newEnv(t, envOpt{})
	r2, err := e2.s.RequestOTP(ctx, OTPRequestInput{Phone: e2.randPhone()}, "")
	if err != nil || r2.DevCode != "" {
		t.Fatalf("không dev: %+v %v", r2, err)
	}
}

func TestOTPVerifyDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	phone := e.randPhone()
	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, ""); err != nil {
		t.Fatal(err)
	}
	code := e.sms.code(phone)
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	in := VerifyInput{Phone: phone, OTP: wrong, DisplayName: "  Lan  "}
	in.Device.Platform, in.Device.Name = "web", "Chrome Windows"

	_, err := e.s.VerifyOTP(ctx, VerifyInput{Phone: phone, OTP: "12a456"})
	wantCode(t, "mã không phải 6 số", err, CodeOTPInvalid)
	bad := in
	bad.OTP, bad.Device.Platform = code, "tivi"
	_, err = e.s.VerifyOTP(ctx, bad)
	wantCode(t, "platform lạ", err, CodeBadRequest)

	for i := 1; i <= 4; i++ {
		_, err := e.s.VerifyOTP(ctx, in)
		wantCode(t, "sai lần "+string(rune('0'+i)), err, CodeOTPInvalid)
	}
	_, err = e.s.VerifyOTP(ctx, in)
	wantCode(t, "sai lần 5", err, CodeOTPLocked)
	in.OTP = code
	_, err = e.s.VerifyOTP(ctx, in)
	wantCode(t, "đúng mã khi đang khoá", err, CodeOTPLocked)
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, "")
	wantCode(t, "xin mã khi đang khoá", err, CodeOTPLocked)
	var attempts int
	_ = e.pool.QueryRow(ctx, `select attempts from chat_otp_codes where phone = $1`, phone).Scan(&attempts)
	if attempts != 5 {
		t.Errorf("attempts = %d", attempts)
	}

	// hết khoá: mã cũ đã hết hạn
	if _, err := e.pool.Exec(ctx, `update chat_otp_codes set locked_until = now() - interval '1 second', expires_at = now() - interval '1 second',
		created_at = created_at - interval '2 minutes' where phone = $1`, phone); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.VerifyOTP(ctx, in)
	wantCode(t, "mã hết hạn", err, CodeOTPExpired)

	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, ""); err != nil {
		t.Fatal(err)
	}
	in.OTP = e.sms.code(phone)
	res, err := e.s.VerifyOTP(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	e.track(res.User.ID)
	if res.IsNew == nil || !*res.IsNew || res.User.DisplayName != "Lan" || res.User.Relation != relSelf || res.User.Phone == nil ||
		*res.User.Phone != phone || !res.User.ShowReadReceipts || res.ExpiresIn != 900 || res.DeviceID <= 0 || res.RefreshToken == "" {
		t.Fatalf("verify: %+v %+v", res, res.User)
	}
	uid, did, err := e.s.authToken(ctx, res.AccessToken)
	if err != nil || uid != res.User.ID || did != res.DeviceID {
		t.Fatalf("access token: %d %d %v", uid, did, err)
	}
	var plat, name string
	_ = e.pool.QueryRow(ctx, `select platform, device_name from chat_devices where id = $1`, did).Scan(&plat, &name)
	if plat != "web" || name != "Chrome Windows" {
		t.Errorf("thiết bị: %q %q", plat, name)
	}
	// mã đã dùng không dùng lại được
	_, err = e.s.VerifyOTP(ctx, in)
	wantCode(t, "dùng lại mã", err, CodeOTPExpired)

	// đăng nhập lần 2: cùng tài khoản, thiết bị mới, tên không đổi; tên mặc định chỉ cho tài khoản mới
	if _, err := e.pool.Exec(ctx, `update chat_otp_codes set created_at = created_at - interval '61 seconds' where phone = $1`, phone); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, ""); err != nil {
		t.Fatal(err)
	}
	in2 := VerifyInput{Phone: phone, OTP: e.sms.code(phone), DisplayName: "Tên khác"}
	res2, err := e.s.VerifyOTP(ctx, in2)
	if err != nil || *res2.IsNew || res2.User.ID != res.User.ID || res2.DeviceID == res.DeviceID || res2.User.DisplayName != "Lan" {
		t.Fatalf("đăng nhập lần 2: %+v %v", res2, err)
	}
	p2 := e.randPhone()
	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: p2}, ""); err != nil {
		t.Fatal(err)
	}
	res3, err := e.s.VerifyOTP(ctx, VerifyInput{Phone: p2, OTP: e.sms.code(p2)})
	if err != nil {
		t.Fatal(err)
	}
	e.track(res3.User.ID)
	if res3.User.DisplayName != "Người dùng "+p2[len(p2)-4:] {
		t.Errorf("tên mặc định %q", res3.User.DisplayName)
	}
}

// OTP qua email: gửi thư (MailSender), dev_code, tạo tài khoản theo email (không có số), đăng nhập lại bằng chữ HOA cùng
// tài khoản, giới hạn 60 giây / 5 lần / giờ / email, IP đếm chung với số, sai 5 lần khoá email, gửi thư lỗi -> 500.
func TestOTPEmailDB(t *testing.T) {
	e := newEnv(t, envOpt{otpDev: true})
	ctx := context.Background()
	email := e.randEmail()

	r, err := e.s.RequestOTP(ctx, OTPRequestInput{Email: "  " + strings.ToUpper(email) + " "}, "10.2.2.2")
	if err != nil {
		t.Fatal(err)
	}
	m := e.mail.msg(email)
	if r.Email != email || r.Phone != "" || r.ExpiresIn != 300 || r.ResendAfter != 60 || len(r.DevCode) != 6 || r.DevCode != e.mail.code(email) ||
		m.subject != "Mã xác thực Dezon Chat" || !strings.Contains(m.html, r.DevCode) {
		t.Fatalf("kết quả: %+v, thư %+v", r, m)
	}
	var phoneNull bool
	var hash string
	_ = e.pool.QueryRow(ctx, `select phone is null, code_hash from chat_otp_codes where email = $1`, email).Scan(&phoneNull, &hash)
	if !phoneNull || hash != otpHash(e.s.otpKey, email, r.DevCode) {
		t.Errorf("dòng OTP: phone null %v, hash %q", phoneNull, hash)
	}
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Email: email}, "10.2.2.2")
	wantCode(t, "gửi lại ngay", err, CodeOTPRateLimit)
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Email: "ten@congty"}, "")
	wantCode(t, "email sai", err, CodeEmailInvalid)
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Phone: e.randPhone(), Email: email}, "")
	wantCode(t, "gửi cả số lẫn email", err, CodeBadRequest)
	_, err = e.s.VerifyOTP(ctx, VerifyInput{Phone: e.randPhone(), Email: email, OTP: r.DevCode})
	wantCode(t, "verify cả số lẫn email", err, CodeBadRequest)

	// tài khoản mới theo email: tên mặc định = phần trước @, không có số
	res, err := e.s.VerifyOTP(ctx, VerifyInput{Email: strings.ToUpper(email), OTP: r.DevCode})
	if err != nil {
		t.Fatal(err)
	}
	e.track(res.User.ID)
	local, _, _ := strings.Cut(email, "@")
	if res.IsNew == nil || !*res.IsNew || res.User.DisplayName != local || res.User.Phone != nil || res.User.Email == nil ||
		*res.User.Email != email || res.User.Relation != relSelf {
		t.Fatalf("verify email: %+v %+v", res, res.User)
	}
	me, err := e.s.Me(ctx, res.User.ID)
	if err != nil || me.Email == nil || *me.Email != email || me.Phone != nil {
		t.Fatalf("/me: %+v %v", me, err)
	}

	// đăng nhập lại bằng chữ HOA: cùng tài khoản, không tạo mới
	if _, err := e.pool.Exec(ctx, `update chat_otp_codes set created_at = created_at - interval '61 seconds' where email = $1`, email); err != nil {
		t.Fatal(err)
	}
	r2, err := e.s.RequestOTP(ctx, OTPRequestInput{Email: strings.ToUpper(email)}, "")
	if err != nil {
		t.Fatal(err)
	}
	res2, err := e.s.VerifyOTP(ctx, VerifyInput{Email: strings.ToUpper(email), OTP: r2.DevCode, DisplayName: "Tên khác"})
	if err != nil || *res2.IsNew || res2.User.ID != res.User.ID || res2.User.DisplayName != local {
		t.Fatalf("đăng nhập lại: %+v %v", res2, err)
	}

	// 5 mã / giờ / email
	lim := e.randEmail()
	for i := 1; i <= 5; i++ {
		if _, err := e.pool.Exec(ctx, `update chat_otp_codes set created_at = created_at - interval '61 seconds' where email = $1`, lim); err != nil {
			t.Fatal(err)
		}
		if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Email: lim}, ""); err != nil {
			t.Fatalf("lần %d: %v", i, err)
		}
	}
	if _, err := e.pool.Exec(ctx, `update chat_otp_codes set created_at = created_at - interval '61 seconds' where email = $1`, lim); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Email: lim}, "")
	wantCode(t, "lần 6 trong giờ", err, CodeOTPRateLimit)
	if !strings.Contains(err.Error(), "Email này đã xin mã quá nhiều lần") {
		t.Errorf("thông báo: %v", err)
	}

	// 20 mã / giờ / IP đếm chung số lẫn email
	ipx := "10.8." + newUUID()[:8]
	for i := 0; i < 20; i++ {
		if _, err := e.pool.Exec(ctx, `insert into chat_otp_codes (phone, code_hash, request_ip, expires_at) values ($1, 'x', $2, now())`,
			e.randPhone(), ipx); err != nil {
			t.Fatal(err)
		}
	}
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Email: e.randEmail()}, ipx)
	wantCode(t, "IP thứ 21 (email)", err, CodeOTPRateLimit)

	// sai 5 lần thì khoá email (số khác không bị ảnh hưởng)
	lk := e.randEmail()
	rl, err := e.s.RequestOTP(ctx, OTPRequestInput{Email: lk}, "")
	if err != nil {
		t.Fatal(err)
	}
	wrong := "000000"
	if rl.DevCode == wrong {
		wrong = "111111"
	}
	for i := 1; i <= 4; i++ {
		_, err := e.s.VerifyOTP(ctx, VerifyInput{Email: lk, OTP: wrong})
		wantCode(t, "sai lần "+string(rune('0'+i)), err, CodeOTPInvalid)
	}
	_, err = e.s.VerifyOTP(ctx, VerifyInput{Email: lk, OTP: wrong})
	wantCode(t, "sai lần 5", err, CodeOTPLocked)
	_, err = e.s.VerifyOTP(ctx, VerifyInput{Email: lk, OTP: rl.DevCode})
	wantCode(t, "đúng mã khi đang khoá", err, CodeOTPLocked)
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Email: lk}, "")
	wantCode(t, "xin mã khi đang khoá", err, CodeOTPLocked)
	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: e.randPhone()}, ""); err != nil {
		t.Fatalf("số khác khi email đang khoá: %v", err)
	}

	// gửi thư lỗi -> 500, không lộ lỗi SMTP
	e.mail.setFail(errors.New("smtp: 535 sai mật khẩu"))
	_, err = e.s.RequestOTP(ctx, OTPRequestInput{Email: e.randEmail()}, "")
	wantCode(t, "gửi thư lỗi", err, CodeInternal)
	if strings.Contains(err.Error(), "smtp") {
		t.Errorf("lộ lỗi SMTP: %v", err)
	}
}

// Refresh: xoay vòng, dùng lại trong 30 giây = race (không thu hồi), cũ hơn = thu hồi thiết bị; 2 request song song.
func TestRefreshDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	login := func() *AuthResult {
		t.Helper()
		p := e.randPhone()
		if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: p}, ""); err != nil {
			t.Fatal(err)
		}
		r, err := e.s.VerifyOTP(ctx, VerifyInput{Phone: p, OTP: e.sms.code(p)})
		if err != nil {
			t.Fatal(err)
		}
		e.track(r.User.ID)
		return r
	}
	a := login()
	_, err := e.s.Refresh(ctx, "")
	wantCode(t, "thiếu token", err, CodeBadRequest)
	_, err = e.s.Refresh(ctx, "khong-co-that")
	wantCode(t, "token lạ", err, CodeRefreshInvalid)

	b, err := e.s.Refresh(ctx, a.RefreshToken)
	if err != nil || b.RefreshToken == a.RefreshToken || b.DeviceID != a.DeviceID || b.User.ID != a.User.ID || b.IsNew != nil {
		t.Fatalf("refresh: %+v %v", b, err)
	}
	_, err = e.s.Refresh(ctx, a.RefreshToken)
	wantCode(t, "token cũ trong 30 giây", err, CodeRefreshRace)
	if _, _, err := e.s.authToken(ctx, b.AccessToken); err != nil {
		t.Fatalf("race không được thu hồi: %v", err)
	}
	// token cũ bị trình lại sau 30 giây: thu hồi cả thiết bị
	if _, err := e.pool.Exec(ctx, `update chat_refresh_tokens set used_at = used_at - interval '31 seconds' where device_id = $1 and used_at is not null`,
		a.DeviceID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.Refresh(ctx, a.RefreshToken)
	wantCode(t, "dùng lại token cũ", err, CodeRefreshReused)
	_, err = e.s.Refresh(ctx, b.RefreshToken)
	wantCode(t, "token mới sau khi thu hồi", err, CodeRefreshInvalid)
	_, _, err = e.s.authToken(ctx, b.AccessToken)
	wantCode(t, "access token sau khi thu hồi", err, CodeNoAuth)
	if len(e.gw.closed) != 1 || e.gw.closed[0] != a.DeviceID {
		t.Errorf("phải đóng kết nối của thiết bị bị thu hồi: %v", e.gw.closed)
	}

	// hết hạn
	c := login()
	if _, err := e.pool.Exec(ctx, `update chat_refresh_tokens set expires_at = now() - interval '1 second' where device_id = $1`, c.DeviceID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.Refresh(ctx, c.RefreshToken)
	wantCode(t, "hết hạn", err, CodeRefreshInvalid)

	// 2 request song song cùng token: đúng 1 thành công, cái kia REFRESH_RACE, thiết bị còn
	d := login()
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = e.s.Refresh(ctx, d.RefreshToken)
		}(i)
	}
	wg.Wait()
	okN, race := 0, 0
	for _, err := range errs {
		switch codeOf(err) {
		case "":
			if err == nil {
				okN++
			}
		case CodeRefreshRace:
			race++
		}
	}
	if okN != 1 || race != 1 {
		t.Fatalf("song song: %v", errs)
	}
	var devs int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_devices where id = $1`, d.DeviceID).Scan(&devs)
	if devs != 1 {
		t.Error("race không được xoá thiết bị")
	}

	// đăng xuất: xoá thiết bị, token hết dùng, đóng WebSocket của thiết bị
	if err := e.s.Logout(ctx, d.User.ID, d.DeviceID); err != nil {
		t.Fatal(err)
	}
	var toks int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_refresh_tokens where device_id = $1`, d.DeviceID).Scan(&toks)
	if toks != 0 {
		t.Error("đăng xuất phải xoá refresh token")
	}
	if e.gw.closed[len(e.gw.closed)-1] != d.DeviceID {
		t.Error("đăng xuất phải đóng kết nối thiết bị")
	}
}

func TestMeDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a := e.user("An")
	me, err := e.s.Me(ctx, a.id)
	if err != nil || me.DisplayName != "An" || !me.ShowReadReceipts || me.Relation != relSelf || *me.Phone != a.phone {
		t.Fatalf("me: %+v %v", me, err)
	}
	off := false
	name := " An Nguyễn "
	me, err = e.s.UpdateMe(ctx, a.id, MePatch{DisplayName: &name, ShowReadReceipts: &off})
	if err != nil || me.DisplayName != "An Nguyễn" || me.ShowReadReceipts {
		t.Fatalf("đổi: %+v %v", me, err)
	}
	me, err = e.s.UpdateMe(ctx, a.id, MePatch{})
	if err != nil || me.DisplayName != "An Nguyễn" || me.ShowReadReceipts {
		t.Fatalf("không đổi gì: %+v %v", me, err)
	}
	blank := "   "
	_, err = e.s.UpdateMe(ctx, a.id, MePatch{DisplayName: &blank})
	wantCode(t, "tên trống", err, CodeBadRequest)
}
