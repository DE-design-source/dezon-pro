package chat

import (
	"context"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
	apperr "qspro-backend/internal/shared/errors"
)

// Đăng ký / đăng nhập bằng số điện thoại (SMS) hoặc email + OTP, token, đăng xuất, hồ sơ (CHAT.md 6).

var platforms = map[string]bool{"ios": true, "android": true, "web": true, "desktop": true}

// refreshRaceWindow: token vừa xoay vòng trong khoảng này mà bị trình lại = 2 tab / 2 request refresh cùng lúc
// (REFRESH_RACE, không thu hồi); cũ hơn = token bị lộ, dùng lại (REFRESH_REUSED, thu hồi thiết bị).
const refreshRaceWindow = 30 * time.Second

type devEntry struct {
	uid int64
	at  time.Time
}

// cleanText: cắt khoảng trắng hai đầu; rỗng / dài quá max ký tự / có ký tự NUL -> ok = false.
func cleanText(s string, max int) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) > max || strings.ContainsRune(s, 0) {
		return s, false
	}
	return s, true
}

// truncRunes: tối đa n ký tự.
func truncRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n])
}

// Tên cột danh tính của chat_users / chat_otp_codes - chỉ hai hằng này được ghép vào SQL.
const (
	colPhone = "phone"
	colEmail = "email"
)

// otpTarget: nơi nhận mã / danh tính tài khoản đã chuẩn hoá - đúng một trong số điện thoại / email.
type otpTarget struct {
	col   string // colPhone / colEmail
	value string // số E.164 hoặc email chữ thường
}

// parseTarget: phone / email người dùng gửi -> otpTarget. Cả hai khác rỗng -> BAD_REQUEST; có email -> đường email
// (sai -> EMAIL_INVALID); không có email -> đường số như cũ (sai / rỗng -> PHONE_INVALID).
func parseTarget(rawPhone, rawEmail string) (otpTarget, error) {
	if strings.TrimSpace(rawEmail) == "" {
		phone, ok := NormalizePhone(rawPhone)
		if !ok {
			return otpTarget{}, errPhoneInvalid
		}
		return otpTarget{col: colPhone, value: phone}, nil
	}
	if strings.TrimSpace(rawPhone) != "" {
		return otpTarget{}, errPhoneAndEmail
	}
	email, ok := NormalizeEmail(rawEmail)
	if !ok {
		return otpTarget{}, errEmailInvalid
	}
	return otpTarget{col: colEmail, value: email}, nil
}

func (t otpTarget) isEmail() bool { return t.col == colEmail }

// lockKey: khoá advisory của nơi nhận ("otp:" + số giữ như trước khi có email).
func (t otpTarget) lockKey() string {
	if t.isEmail() {
		return "otp:email:" + t.value
	}
	return "otp:" + t.value
}

// subject: chủ ngữ của thông báo giới hạn ("Số này" / "Email này").
func (t otpTarget) subject() string {
	if t.isEmail() {
		return "Email này"
	}
	return "Số này"
}

// defaultName: tên tài khoản mới khi không nhập - "Người dùng <4 số cuối>" / phần trước @ của email.
func (t otpTarget) defaultName() string {
	if !t.isEmail() {
		return "Người dùng " + lastDigits(t.value, 4)
	}
	local, _, _ := strings.Cut(t.value, "@")
	if n, ok := cleanText(truncRunes(local, 100), 100); ok {
		return n
	}
	return "Người dùng"
}

// sendOTP: SMS tới số / email tới địa chỉ; lỗi ghi log, trả 500 chung (không lộ lỗi của nhà cung cấp).
func (s *Service) sendOTP(ctx context.Context, to otpTarget, code string) error {
	var err error
	what := "SMS"
	if to.isEmail() {
		what = "email"
		subject, text, html := otpEmail(code)
		err = s.mail.Send(ctx, to.value, subject, text, html)
	} else {
		err = s.sms.Send(ctx, to.value, otpText(code))
	}
	if err != nil {
		logger.Error("chat", "gửi "+what+" OTP lỗi:", err.Error())
		return apperr.E(500, "Không gửi được mã xác thực, thử lại sau", CodeInternal)
	}
	return nil
}

// RequestOTP gửi mã đăng nhập tới số điện thoại (SMS) hoặc email - in.Phone / in.Email, đúng một trong hai; tài khoản
// tạo ở bước verify nếu chưa có. Giới hạn của số và của email như nhau (otp.go).
func (s *Service) RequestOTP(ctx context.Context, in OTPRequestInput, ip string) (*OTPRequestResult, error) {
	to, err := parseTarget(in.Phone, in.Email)
	if err != nil {
		return nil, err
	}
	ip = truncRunes(ip, 100)
	code, err := newOTP()
	if err != nil {
		return nil, err
	}
	var biz error
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		// khoá IP trước khoá số / email (VerifyOTP chỉ khoá số / email nên không thể chờ vòng): các request song song
		// cùng IP (kể cả số và email lẫn lộn) đếm tuần tự, không cùng đọc "chưa tới 20" rồi cùng ghi
		if ip != "" {
			if err := xactLock(ctx, tx, "otpip:"+ip); err != nil {
				return err
			}
		}
		if err := xactLock(ctx, tx, to.lockKey()); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from chat_otp_codes where `+to.col+` = $1 and created_at < now() - interval '24 hours'`, to.value); err != nil {
			return err
		}
		var lockedLeft, lastAgo float64
		var perTarget int
		if err := tx.QueryRow(ctx, `select
			coalesce(extract(epoch from max(locked_until) filter (where locked_until > now()) - now()), 0)::float8,
			coalesce(extract(epoch from now() - max(created_at)), 1e9)::float8,
			count(*) filter (where created_at > now() - interval '1 hour')
			from chat_otp_codes where `+to.col+` = $1`, to.value).Scan(&lockedLeft, &lastAgo, &perTarget); err != nil {
			return err
		}
		switch {
		case lockedLeft > 0:
			biz = errLocked(lockedLeft)
		case lastAgo < otpResend.Seconds():
			biz = apperr.E(429, "Vui lòng đợi "+strconv.Itoa(int(math.Ceil(otpResend.Seconds()-lastAgo)))+" giây rồi gửi lại mã", CodeOTPRateLimit)
		case perTarget >= otpPerPhone:
			biz = apperr.E(429, to.subject()+" đã xin mã quá nhiều lần, thử lại sau 1 giờ", CodeOTPRateLimit)
		}
		if biz != nil {
			return nil
		}
		if ip != "" {
			var perIP int
			if err := tx.QueryRow(ctx, `select count(*) from chat_otp_codes where request_ip = $1 and created_at > now() - interval '1 hour'`,
				ip).Scan(&perIP); err != nil {
				return err
			}
			if perIP >= otpPerIP {
				biz = apperr.E(429, "Thiết bị này đã xin mã quá nhiều lần, thử lại sau 1 giờ", CodeOTPRateLimit)
				return nil
			}
		}
		// mã mới thay mã cũ (CHAT.md 6.3): mã cũ chưa dùng hết hạn ngay (số lần sai của chúng vẫn được tính, xem VerifyOTP)
		if _, err := tx.Exec(ctx, `update chat_otp_codes set expires_at = least(expires_at, now())
			where `+to.col+` = $1 and consumed_at is null`, to.value); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into chat_otp_codes (`+to.col+`, code_hash, request_ip, expires_at)
			values ($1, $2, $3, now() + $4::interval)`, to.value, otpHash(s.otpKey, to.value, code), ip, secs(otpTTL))
		return err
	})
	if isCheck(err, "ck_chat_otp_codes_email") { // chữ thường của Go khác lower() của PostgreSQL (ký tự Unicode hiếm)
		return nil, errEmailInvalid
	}
	if err != nil {
		return nil, err
	}
	if biz != nil {
		return nil, biz
	}
	if err := s.sendOTP(ctx, to, code); err != nil {
		return nil, err
	}
	res := &OTPRequestResult{ExpiresIn: int(otpTTL.Seconds()), ResendAfter: int(otpResend.Seconds())}
	if to.isEmail() {
		res.Email = to.value
	} else {
		res.Phone = to.value
	}
	if s.otpDev {
		res.DevCode = code
	}
	return res, nil
}

func errLocked(left float64) error {
	m := int(math.Ceil(left / 60))
	if m < 1 {
		m = 1
	}
	return apperr.E(429, "Bạn đã nhập sai mã quá nhiều lần, thử lại sau "+strconv.Itoa(m)+" phút", CodeOTPLocked)
}

// secs: khoảng thời gian dạng chữ cho ::interval.
func secs(d time.Duration) string { return strconv.FormatFloat(d.Seconds(), 'f', -1, 64) + " seconds" }

// VerifyOTP kiểm mã của số / email (in.Phone / in.Email, đúng một trong hai); đúng thì tìm / tạo tài khoản theo số /
// email, ghi thiết bị, cấp token - mọi lệnh ghi trong một transaction.
func (s *Service) VerifyOTP(ctx context.Context, in VerifyInput) (*AuthResult, error) {
	to, err := parseTarget(in.Phone, in.Email)
	if err != nil {
		return nil, err
	}
	code := strings.TrimSpace(in.OTP)
	if len(code) != 6 || !allDigits(code) {
		return nil, errOTPInvalid
	}
	platform := strings.TrimSpace(in.Device.Platform)
	if platform == "" {
		platform = "web"
	}
	if !platforms[platform] {
		return nil, errBad("device.platform phải là ios, android, web hoặc desktop")
	}
	devName := truncRunes(strings.ReplaceAll(strings.TrimSpace(in.Device.Name), "\x00", ""), 200)
	name := strings.TrimSpace(in.DisplayName)
	if name != "" {
		var ok bool
		if name, ok = cleanText(name, 100); !ok {
			return nil, errBad("Tên hiển thị tối đa 100 ký tự")
		}
	}
	ua, ip := devCleanUA(in.UserAgent, maxUserAgent), devCleanIP(in.ClientIP)
	var raw string
	var biz error
	var uid, did int64
	var isNew bool
	var me *MeDTO
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if err := xactLock(ctx, tx, to.lockKey()); err != nil {
			return err
		}
		var lockedLeft float64
		if err := tx.QueryRow(ctx, `select coalesce(extract(epoch from max(locked_until) - now()), 0)::float8
			from chat_otp_codes where `+to.col+` = $1 and locked_until > now()`, to.value).Scan(&lockedLeft); err != nil {
			return err
		}
		if lockedLeft > 0 {
			biz = errLocked(lockedLeft)
			return nil
		}
		var otpID int64
		var codeHash string
		var attempts int
		var expired bool
		err := tx.QueryRow(ctx, `select id, code_hash, attempts, expires_at <= now() from chat_otp_codes
			where `+to.col+` = $1 and consumed_at is null order by created_at desc, id desc limit 1 for update`, to.value).
			Scan(&otpID, &codeHash, &attempts, &expired)
		if noRows(err) || (err == nil && expired) {
			biz = errOTPExpired
			return nil
		}
		if err != nil {
			return err
		}
		if !otpEqual(codeHash, otpHash(s.otpKey, to.value, code)) {
			// sai 5 lần thì khoá SỐ / EMAIL (CHAT.md 6.3): đếm số lần sai của mọi mã chưa dùng của số trong 1 giờ (cùng cửa sổ
			// với giới hạn 5 mã / giờ) kể từ lần khoá gần nhất - xin mã mới không xoá được các lần sai trước
			var wrong int
			if err := tx.QueryRow(ctx, `select coalesce(sum(attempts), 0)::int from chat_otp_codes
				where `+to.col+` = $1 and consumed_at is null and created_at > now() - interval '1 hour'
					and created_at > coalesce((select max(locked_until) from chat_otp_codes where `+to.col+` = $1), '-infinity'::timestamptz)`,
				to.value).Scan(&wrong); err != nil {
				return err
			}
			attempts++
			if wrong+1 >= otpMaxAttempts {
				biz = errLocked(otpLock.Seconds())
				_, err = tx.Exec(ctx, `update chat_otp_codes set attempts = $2, locked_until = now() + $3::interval where id = $1`,
					otpID, attempts, secs(otpLock))
			} else {
				biz = errOTPInvalid
				_, err = tx.Exec(ctx, `update chat_otp_codes set attempts = $2 where id = $1`, otpID, attempts)
			}
			return err // commit: số lần sai phải được lưu
		}
		// dùng hết mọi mã chưa dùng của số: mã cũ không "sống lại" làm mã mới nhất sau khi mã này đã đăng nhập
		if _, err := tx.Exec(ctx, `update chat_otp_codes set consumed_at = now() where `+to.col+` = $1 and consumed_at is null`, to.value); err != nil {
			return err
		}
		if name == "" {
			name = to.defaultName()
		}
		err = tx.QueryRow(ctx, `insert into chat_users (`+to.col+`, display_name) values ($1, $2)
			on conflict (`+to.col+`) do nothing returning id`, to.value, name).Scan(&uid)
		switch {
		case err == nil:
			isNew = true
		case noRows(err):
			if err := tx.QueryRow(ctx, `select id from chat_users where `+to.col+` = $1`, to.value).Scan(&uid); err != nil {
				return err
			}
		default:
			return err
		}
		if did, raw, err = s.devCreateTx(ctx, tx, uid, platform, devName, ua, ip, LoginOTP); err != nil {
			return err
		}
		me, err = s.loadMe(ctx, tx, uid)
		return err
	})
	if isCheck(err, "ck_chat_users_email") {
		return nil, errEmailInvalid
	}
	if err != nil {
		return nil, err
	}
	if biz != nil {
		return nil, biz
	}
	res := s.authResult(uid, did, raw, me)
	res.IsNew = &isNew
	s.devNotify(uid, "login", did)
	return res, nil
}

func (s *Service) authResult(uid, did int64, refresh string, me *MeDTO) *AuthResult {
	return &AuthResult{
		AccessToken:  signAccess(s.jwtKey, uid, did, s.now(), s.accessTTL),
		RefreshToken: refresh,
		ExpiresIn:    int64(s.accessTTL.Seconds()),
		DeviceID:     did,
		User:         me,
	}
}

// Refresh xoay vòng refresh token (CHAT.md 6.5): token cũ đánh dấu đã dùng, cấp cặp mới. Token đã dùng bị trình lại:
// trong 30 giây -> REFRESH_RACE (request song song, không thu hồi); cũ hơn -> xoá thiết bị (mọi token) -> REFRESH_REUSED.
func (s *Service) Refresh(ctx context.Context, token string) (*AuthResult, error) {
	return s.RefreshFrom(ctx, token, "")
}

// RefreshFrom: như Refresh, ip khác rỗng thì ghi vào chat_devices.last_ip (bảng thiết bị).
func (s *Service) RefreshFrom(ctx context.Context, token, ip string) (*AuthResult, error) {
	ip = devCleanIP(ip)
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errBad("Thiếu refresh_token")
	}
	if len(token) > 200 {
		return nil, errRefreshInvalid
	}
	raw, hash, err := newRefreshToken()
	if err != nil {
		return nil, err
	}
	var biz error
	var uid, did, revoked int64
	var me *MeDTO
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		// khoá dòng thiết bị TRƯỚC dòng token (cùng thứ tự với đăng xuất / thu hồi: xoá chat_devices rồi cascade xoá
		// token) - khoá token trước thì INSERT token mới (kiểm khoá ngoại tới thiết bị) và đăng xuất chờ nhau -> 40P01
		var lockedDev int64
		err := tx.QueryRow(ctx, `select d.id from chat_devices d join chat_refresh_tokens t on t.device_id = d.id
			where t.token_hash = $1 for no key update of d`, hashToken(token)).Scan(&lockedDev)
		if noRows(err) {
			biz = errRefreshInvalid
			return nil
		}
		if err != nil {
			return err
		}
		var tid int64
		var expired, used bool
		var usedAgo float64
		err = tx.QueryRow(ctx, `select t.id, t.device_id, d.user_id, t.expires_at <= now(), t.used_at is not null,
			coalesce(extract(epoch from now() - t.used_at), 0)::float8
			from chat_refresh_tokens t join chat_devices d on d.id = t.device_id
			where t.token_hash = $1 for update of t`, hashToken(token)).Scan(&tid, &did, &uid, &expired, &used, &usedAgo)
		if noRows(err) {
			biz = errRefreshInvalid
			return nil
		}
		if err != nil {
			return err
		}
		switch {
		case used && usedAgo < refreshRaceWindow.Seconds():
			biz = errRefreshRace
			return nil
		case used:
			biz, revoked = errRefreshReused, did
			_, err := tx.Exec(ctx, `delete from chat_devices where id = $1`, did)
			return err
		case expired:
			biz = errRefreshInvalid
			_, err := tx.Exec(ctx, `delete from chat_refresh_tokens where id = $1`, tid)
			return err
		}
		if _, err := tx.Exec(ctx, `update chat_refresh_tokens set used_at = now() where id = $1`, tid); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from chat_refresh_tokens where device_id = $1 and expires_at < now()`, did); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into chat_refresh_tokens (device_id, token_hash, expires_at)
			values ($1, $2, now() + $3::interval)`, did, hash, secs(s.refreshTTL)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update chat_devices set last_seen_at = now(),
			last_ip = case when $2::text = '' then last_ip else $2::text end where id = $1`, did, ip); err != nil {
			return err
		}
		me, err = s.loadMe(ctx, tx, uid)
		return err
	})
	if err != nil {
		return nil, err
	}
	if revoked != 0 {
		s.dropDevice(revoked)
	}
	if biz != nil {
		return nil, biz
	}
	return s.authResult(uid, did, raw, me), nil
}

// Logout: xoá thiết bị (kéo theo refresh token + push token), đóng kết nối WebSocket của thiết bị.
func (s *Service) Logout(ctx context.Context, uid, did int64) error {
	p, err := s.pool()
	if err != nil {
		return err
	}
	tag, err := p.Exec(ctx, `delete from chat_devices where id = $1 and user_id = $2`, did, uid)
	if err != nil {
		return err
	}
	s.dropDevice(did)
	if tag.RowsAffected() > 0 {
		s.devNotify(uid, "logout", did)
	}
	return nil
}

// dropDevice: bỏ cache thiết bị + gửi force_logout, đóng kết nối của thiết bị.
func (s *Service) dropDevice(did int64) {
	s.forgetDevice(did)
	if g := s.gateway(); g != nil {
		g.CloseDevice(did)
	}
}

// forgetDevice: bỏ cache thiết bị; lượt đọc DB của authToken bắt đầu trước đó không được ghi lại vào cache.
func (s *Service) forgetDevice(did int64) {
	s.devMu.Lock()
	delete(s.devHit, did)
	s.devGen++
	s.devMu.Unlock()
}

// authToken: access token hợp lệ (chữ ký, alg, typ, hạn) và thiết bị còn (cache 30 giây, bỏ khi đăng xuất / thu hồi).
func (s *Service) authToken(ctx context.Context, tok string) (uid, did int64, err error) {
	uid, did, err = parseAccess(s.jwtKey, tok, s.now())
	if err != nil {
		return 0, 0, errNoAuth
	}
	now := s.now()
	s.devMu.Lock()
	e, ok := s.devHit[did]
	gen := s.devGen
	s.devMu.Unlock()
	if ok && e.uid == uid && now.Sub(e.at) < devCacheTTL {
		return uid, did, nil
	}
	p, err := s.pool()
	if err != nil {
		return 0, 0, err
	}
	var owner int64
	if err := p.QueryRow(ctx, `select user_id from chat_devices where id = $1`, did).Scan(&owner); err != nil {
		if noRows(err) {
			return 0, 0, errNoAuth
		}
		return 0, 0, err
	}
	if owner != uid {
		return 0, 0, errNoAuth
	}
	s.devMu.Lock()
	if len(s.devHit) > 100000 {
		s.devHit = map[int64]devEntry{}
	}
	// có đăng xuất / thu hồi trong lúc đọc thì không ghi (dòng vừa đọc có thể đã bị xoá)
	if s.devGen == gen {
		s.devHit[did] = devEntry{uid: uid, at: now}
	}
	s.devMu.Unlock()
	return uid, did, nil
}

func (s *Service) loadMe(ctx context.Context, q querier, uid int64) (*MeDTO, error) {
	u, err := loadUser(ctx, q, uid, uid)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, errNoAuth
	}
	return &MeDTO{UserDTO: u.dto(uid, true, true, true, s.online([]int64{uid})), ShowReadReceipts: u.showRead, CreatedAt: iso(u.createdAt)}, nil
}

// Me: hồ sơ của tôi.
func (s *Service) Me(ctx context.Context, uid int64) (*MeDTO, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	return s.loadMe(ctx, p, uid)
}

// UpdateMe đổi tên hiển thị / bật tắt "cho người khác biết tôi đã xem".
func (s *Service) UpdateMe(ctx context.Context, uid int64, in MePatch) (*MeDTO, error) {
	var name any
	if in.DisplayName != nil {
		n, ok := cleanText(*in.DisplayName, 100)
		if !ok {
			return nil, errBad("Tên hiển thị phải có từ 1 đến 100 ký tự")
		}
		name = n
	}
	var show any
	if in.ShowReadReceipts != nil {
		show = *in.ShowReadReceipts
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	if name != nil || show != nil {
		if _, err := p.Exec(ctx, `update chat_users set display_name = coalesce($2::text, display_name),
			show_read_receipts = coalesce($3::boolean, show_read_receipts), updated_at = now() where id = $1`, uid, name, show); err != nil {
			return nil, err
		}
	}
	return s.loadMe(ctx, p, uid)
}
