package chat

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestQRNormalizeCode(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"ABCDE-FGHJK", "ABCDEFGHJK"},
		{"abcde fghjk", "ABCDEFGHJK"},
		{"  0123456789 ", "0123456789"},
		{"oOiIl-xyzab", "00111XYZAB"},
		{"https://chat.dezon.vn/chat/qr#abcde-fghjk", "ABCDEFGHJK"},
		{"/chat/qr#MNPQR-STVWX", "MNPQRSTVWX"},
	} {
		if got, ok := qrNormalizeCode(c.in); !ok || got != c.want {
			t.Errorf("qrNormalizeCode(%q) = %q %v, muốn %q", c.in, got, ok, c.want)
		}
	}
	for _, in := range []string{"", "ABCDEFGHJ", "ABCDEFGHJKM", "ABCDEFGHJU", "ABCDE_FGHJK", "ÀBCDEFGHJK", "https://x/chat/qr#", strings.Repeat("A", 300)} {
		if got, ok := qrNormalizeCode(in); ok {
			t.Errorf("qrNormalizeCode(%q) = %q phải sai dạng", in, got)
		}
	}
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		c, err := qrNewCode()
		if err != nil {
			t.Fatal(err)
		}
		if n, ok := qrNormalizeCode(c); !ok || n != c || len(c) != qrCodeLen {
			t.Fatalf("mã sinh ra %q không chuẩn", c)
		}
		if seen[c] {
			t.Fatalf("mã trùng %q", c)
		}
		seen[c] = true
	}
}

// qrEnv: env + IP riêng của test (đếm hạn mức theo IP, dọn phiên chưa quét).
func qrEnv(t *testing.T) (*env, string) {
	e := newEnv(t, envOpt{})
	ip := "qrtest-" + newUUID()[:13]
	t.Cleanup(func() {
		if _, err := e.pool.Exec(context.Background(), `delete from chat_qr_login_sessions where request_ip = $1`, ip); err != nil {
			t.Errorf("dọn phiên QR: %v", err)
		}
	})
	return e, ip
}

func qrStartT(t *testing.T, e *env, ip string) *QRStartResult {
	t.Helper()
	r, err := e.s.QRStart(context.Background(), QRStartInput{Device: DeviceInput{Platform: "desktop", Name: "Chrome trên Windows"}}, ip, "Mozilla/5.0 (Windows NT 10.0)")
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// qrPollT: poll (đẩy đồng hồ 2 giây trước mỗi lần cho khỏi chạm hạn mức poll).
func qrPollT(t *testing.T, e *env, r *QRStartResult) *QRPollResult {
	t.Helper()
	e.clk.add(2 * time.Second)
	p, err := e.s.QRPoll(context.Background(), QRPollInput{QRID: r.QRID, PollToken: r.PollToken})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestQRLoginFlowDB(t *testing.T) {
	e, ip := qrEnv(t)
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	r := qrStartT(t, e, ip)
	if len(r.Code) != qrCodeLen || r.PollToken == "" || r.ExpiresIn != 120 || r.PollInterval != 2 || r.QRID <= 0 {
		t.Fatalf("start: %+v", r)
	}
	var codeHash, pollHash string
	_ = e.pool.QueryRow(ctx, `select code_hash, poll_token_hash from chat_qr_login_sessions where id = $1`, r.QRID).Scan(&codeHash, &pollHash)
	if codeHash != e.s.qrCodeHash(r.Code) || pollHash != hashToken(r.PollToken) || strings.Contains(codeHash, r.Code) {
		t.Fatal("DB chỉ lưu HMAC của mã + sha256 của poll_token")
	}
	_, err := e.s.QRStart(ctx, QRStartInput{Device: DeviceInput{Platform: "tivi"}}, ip, "")
	wantCode(t, "platform lạ", err, CodeBadRequest)

	// poll sai
	_, err = e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID, PollToken: r.PollToken + "x"})
	wantCode(t, "poll_token sai", err, CodeQRInvalid)
	_, err = e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID + 1e9, PollToken: r.PollToken})
	wantCode(t, "qr_id sai", err, CodeQRInvalid)
	_, err = e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID})
	wantCode(t, "thiếu poll_token", err, CodeQRInvalid)
	if p := qrPollT(t, e, r); p.Status != QRPending || p.Approver != nil || p.Auth != nil || p.ExpiresIn <= 0 || p.ExpiresIn > 120 {
		t.Fatalf("poll pending: %+v", p)
	}

	// duyệt trước khi quét; mã sai
	_, err = e.s.QRApprove(ctx, a.id, a.did, r.Code)
	wantCode(t, "duyệt khi chưa quét", err, CodeBadRequest)
	_, err = e.s.QRScan(ctx, a.id, a.did, "ZZZZZ-ZZZZZ")
	wantCode(t, "mã không có", err, CodeQRInvalid)
	_, err = e.s.QRScan(ctx, a.id, a.did, "abc")
	wantCode(t, "mã sai dạng", err, CodeQRInvalid)

	// quét (dạng URL, chữ thường, gạch nối)
	url := "https://chat.dezon.vn/chat/qr#" + strings.ToLower(r.Code[:5]+"-"+r.Code[5:])
	info, err := e.s.QRScan(ctx, a.id, a.did, url)
	if err != nil {
		t.Fatal(err)
	}
	if info.QRID != r.QRID || info.Status != QRScanned || info.Platform != "desktop" || info.DeviceName != "Chrome trên Windows" ||
		info.UserAgent != "Mozilla/5.0 (Windows NT 10.0)" || info.RequestIP != ip || info.CreatedAt == "" || info.ExpiresAt == "" || info.ExpiresIn <= 0 {
		t.Fatalf("thông tin phiên: %+v", info)
	}
	if again, err := e.s.QRScan(ctx, a.id, a.did, r.Code); err != nil || again.QRID != r.QRID || again.Status != QRScanned {
		t.Fatalf("quét lại (idempotent): %+v %v", again, err)
	}
	_, err = e.s.QRScan(ctx, b.id, b.did, r.Code)
	wantCode(t, "người khác quét", err, CodeQRUsed)
	_, err = e.s.QRApprove(ctx, b.id, b.did, r.Code)
	wantCode(t, "người khác duyệt", err, CodeQRUsed)
	_, err = e.s.QRReject(ctx, b.id, b.did, r.Code)
	wantCode(t, "người khác từ chối", err, CodeQRUsed)
	if p := qrPollT(t, e, r); p.Status != QRScanned || p.Approver != nil || p.Auth != nil {
		t.Fatalf("poll scanned: %+v", p)
	}

	// duyệt (kéo hạn ít nhất 60 giây)
	if _, err := e.pool.Exec(ctx, `update chat_qr_login_sessions set expires_at = now() + interval '5 seconds' where id = $1`, r.QRID); err != nil {
		t.Fatal(err)
	}
	if d, err := e.s.QRApprove(ctx, a.id, a.did, r.Code); err != nil || d.Status != QRApproved {
		t.Fatalf("duyệt: %+v %v", d, err)
	}
	var left float64
	_ = e.pool.QueryRow(ctx, `select extract(epoch from expires_at - now())::float8 from chat_qr_login_sessions where id = $1`, r.QRID).Scan(&left)
	if left < 55 {
		t.Fatalf("duyệt phải kéo hạn tới >= 60 giây, còn %.1f", left)
	}
	if d, err := e.s.QRApprove(ctx, a.id, a.did, r.Code); err != nil || d.Status != QRApproved {
		t.Fatalf("duyệt lại (idempotent): %+v %v", d, err)
	}
	_, err = e.s.QRReject(ctx, a.id, a.did, r.Code)
	wantCode(t, "từ chối sau khi duyệt", err, CodeQRUsed)
	e.gw.packets("", true)

	// máy mới nhận token đúng một lần
	p := qrPollT(t, e, r)
	if p.Status != QRApproved || p.Auth == nil || p.Approver == nil || p.Auth.User == nil || p.Auth.User.ID != a.id || p.Auth.IsNew != nil ||
		p.Auth.RefreshToken == "" || p.Auth.DeviceID <= 0 {
		t.Fatalf("poll approved: %+v", p)
	}
	uid, did, err := e.s.authToken(ctx, p.Auth.AccessToken)
	if err != nil || uid != a.id || did != p.Auth.DeviceID {
		t.Fatalf("access token QR: %d %d %v", uid, did, err)
	}
	var plat, name, ua, lastIP, method, status string
	_ = e.pool.QueryRow(ctx, `select platform, device_name, user_agent, last_ip, login_method from chat_devices where id = $1`, did).
		Scan(&plat, &name, &ua, &lastIP, &method)
	if plat != "desktop" || name != "Chrome trên Windows" || ua != "Mozilla/5.0 (Windows NT 10.0)" || lastIP != ip || method != LoginQR {
		t.Fatalf("thiết bị QR: %q %q %q %q %q", plat, name, ua, lastIP, method)
	}
	_ = e.pool.QueryRow(ctx, `select status from chat_qr_login_sessions where id = $1`, r.QRID).Scan(&status)
	if status != QRConsumed {
		t.Fatalf("phiên phải consumed: %q", status)
	}
	if ps := devPackets(t, e.gw, a.id); len(ps) != 1 || ps[0] != (DevicesUpdatedDTO{Reason: "login", DeviceID: did}) {
		t.Fatalf("devices.updated login QR: %+v", ps)
	}
	if p2 := qrPollT(t, e, r); p2.Status != QRConsumed || p2.Auth != nil {
		t.Fatalf("poll sau khi đã nhận: %+v", p2)
	}
	if d, err := e.s.QRApprove(ctx, a.id, a.did, r.Code); err != nil || d.Status != QRApproved {
		t.Fatalf("duyệt sau khi đã dùng: %+v %v", d, err)
	}
	_, err = e.s.QRScan(ctx, a.id, a.did, r.Code)
	wantCode(t, "quét mã đã dùng", err, CodeQRUsed)
	if _, err := e.s.Refresh(ctx, p.Auth.RefreshToken); err != nil {
		t.Fatalf("refresh token của thiết bị QR: %v", err)
	}
	l, err := e.s.Devices(ctx, a.id, a.did)
	if err != nil || devFind(l, did) == nil || devFind(l, did).LoginMethod != LoginQR {
		t.Fatalf("thiết bị QR trong danh sách: %+v %v", l, err)
	}
}

func TestQRLoginRejectExpireDB(t *testing.T) {
	e, ip := qrEnv(t)
	ctx := context.Background()
	a := e.user("An")

	// từ chối
	r := qrStartT(t, e, ip)
	_, err := e.s.QRReject(ctx, a.id, a.did, r.Code)
	wantCode(t, "từ chối khi chưa quét", err, CodeBadRequest)
	if _, err := e.s.QRScan(ctx, a.id, a.did, r.Code); err != nil {
		t.Fatal(err)
	}
	if d, err := e.s.QRReject(ctx, a.id, a.did, r.Code); err != nil || d.Status != QRRejected {
		t.Fatalf("từ chối: %+v %v", d, err)
	}
	if d, err := e.s.QRReject(ctx, a.id, a.did, r.Code); err != nil || d.Status != QRRejected {
		t.Fatalf("từ chối lại: %+v %v", d, err)
	}
	_, err = e.s.QRApprove(ctx, a.id, a.did, r.Code)
	wantCode(t, "duyệt sau khi từ chối", err, CodeQRUsed)
	if p := qrPollT(t, e, r); p.Status != QRRejected || p.Auth != nil {
		t.Fatalf("poll rejected: %+v", p)
	}

	// hết hạn khi chưa quét
	r2 := qrStartT(t, e, ip)
	expire := func(id int64) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, `update chat_qr_login_sessions set created_at = now() - interval '3 minutes',
			expires_at = now() - interval '1 minute' where id = $1`, id); err != nil {
			t.Fatal(err)
		}
	}
	expire(r2.QRID)
	if p := qrPollT(t, e, r2); p.Status != QRExpired || p.ExpiresIn != 0 || p.Auth != nil {
		t.Fatalf("poll hết hạn: %+v", p)
	}
	_, err = e.s.QRScan(ctx, a.id, a.did, r2.Code)
	wantCode(t, "quét mã hết hạn", err, CodeQRExpired)
	_, err = e.s.QRApprove(ctx, a.id, a.did, r2.Code)
	wantCode(t, "duyệt mã hết hạn chưa quét", err, CodeQRExpired)

	// hết hạn sau khi quét, trước khi duyệt
	r3 := qrStartT(t, e, ip)
	if _, err := e.s.QRScan(ctx, a.id, a.did, r3.Code); err != nil {
		t.Fatal(err)
	}
	expire(r3.QRID)
	_, err = e.s.QRApprove(ctx, a.id, a.did, r3.Code)
	wantCode(t, "duyệt mã hết hạn", err, CodeQRExpired)
	_, err = e.s.QRReject(ctx, a.id, a.did, r3.Code)
	wantCode(t, "từ chối mã hết hạn", err, CodeQRExpired)
	if p := qrPollT(t, e, r3); p.Status != QRExpired {
		t.Fatalf("poll scanned hết hạn: %+v", p)
	}

	// duyệt rồi quá hạn mà máy mới chưa nhận -> expired, không cấp token
	r4 := qrStartT(t, e, ip)
	if _, err := e.s.QRScan(ctx, a.id, a.did, r4.Code); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.QRApprove(ctx, a.id, a.did, r4.Code); err != nil {
		t.Fatal(err)
	}
	expire(r4.QRID)
	if p := qrPollT(t, e, r4); p.Status != QRExpired || p.Auth != nil {
		t.Fatalf("poll approved hết hạn: %+v", p)
	}
}

// Hai lần poll song song sau khi duyệt: chỉ một lần nhận token, chỉ một thiết bị được tạo.
func TestQRLoginConsumeOnceDB(t *testing.T) {
	e, ip := qrEnv(t)
	ctx := context.Background()
	a := e.user("An")
	r := qrStartT(t, e, ip)
	if _, err := e.s.QRScan(ctx, a.id, a.did, r.Code); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.QRApprove(ctx, a.id, a.did, r.Code); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	res := make([]*QRPollResult, 3)
	errs := make([]error, 3)
	for i := range res {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res[i], errs[i] = e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID, PollToken: r.PollToken})
		}(i)
	}
	wg.Wait()
	got := 0
	for i := range res {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if res[i].Auth != nil {
			got++
		} else if res[i].Status != QRConsumed {
			t.Fatalf("poll song song: %+v", res[i])
		}
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_devices where user_id = $1 and login_method = 'qr'`, a.id).Scan(&n)
	if got != 1 || n != 1 {
		t.Fatalf("token cấp %d lần, %d thiết bị QR", got, n)
	}
}

func TestQRLoginLimitsDB(t *testing.T) {
	e, ip := qrEnv(t)
	ctx := context.Background()
	a := e.user("An")

	// poll: 3 lần / 3 giây / qr_id
	r := qrStartT(t, e, ip)
	for i := 0; i < 3; i++ {
		if _, err := e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID, PollToken: r.PollToken}); err != nil {
			t.Fatal(err)
		}
	}
	_, err := e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID, PollToken: r.PollToken})
	wantCode(t, "poll quá nhanh", err, CodeRateLimit)
	// poll_token sai không tốn lượt của máy thật
	e.clk.add(3 * time.Second)
	for i := 0; i < 5; i++ {
		_, err := e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID, PollToken: "sai"})
		wantCode(t, "poll token sai", err, CodeQRInvalid)
	}
	if _, err := e.s.QRPoll(ctx, QRPollInput{QRID: r.QRID, PollToken: r.PollToken}); err != nil {
		t.Fatalf("poll sau khi kẻ khác dò: %v", err)
	}

	// quét: 20 lần / phút / người, tính cả mã sai
	for i := 0; i < 20; i++ {
		_, err := e.s.QRScan(ctx, a.id, a.did, "ZZZZZZZZZZ")
		wantCode(t, "mã sai", err, CodeQRInvalid)
	}
	_, err = e.s.QRScan(ctx, a.id, a.did, r.Code)
	wantCode(t, "quét quá nhiều", err, CodeRateLimit)
	_, err = e.s.QRApprove(ctx, a.id, a.did, r.Code)
	wantCode(t, "duyệt khi hết lượt", err, CodeRateLimit)
	e.clk.add(time.Minute)
	if _, err := e.s.QRScan(ctx, a.id, a.did, r.Code); err != nil {
		t.Fatalf("quét sau 1 phút: %v", err)
	}

	// start: 20 phiên / 10 phút / IP (đã có 1)
	for i := 0; i < qrStartPerIP-1; i++ {
		qrStartT(t, e, ip)
	}
	_, err = e.s.QRStart(ctx, QRStartInput{}, ip, "")
	wantCode(t, "start quá nhiều", err, CodeRateLimit)
	if r2, err := e.s.QRStart(ctx, QRStartInput{}, "", ""); err != nil || r2.QRID <= 0 {
		t.Fatalf("không rõ IP thì không đếm theo IP: %v", err)
	} else {
		_, _ = e.pool.Exec(ctx, `delete from chat_qr_login_sessions where id = $1`, r2.QRID)
	}
	// phiên cũ hơn 24 giờ bị xoá ở lần start kế tiếp
	if _, err := e.pool.Exec(ctx, `update chat_qr_login_sessions set created_at = now() - interval '25 hours',
		expires_at = now() - interval '25 hours' + interval '2 minutes' where request_ip = $1`, ip); err != nil {
		t.Fatal(err)
	}
	r3 := qrStartT(t, e, ip)
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_qr_login_sessions where request_ip = $1`, ip).Scan(&n)
	if n != 1 || r3.QRID <= 0 {
		t.Fatalf("dọn phiên cũ: còn %d", n)
	}
}
