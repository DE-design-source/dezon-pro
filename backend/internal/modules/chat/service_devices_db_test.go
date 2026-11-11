package chat

import (
	"context"
	"testing"
)

// devGW: fakeGW + OnlineDevices (như *realtime.Hub) cho test danh sách thiết bị.
type devGW struct {
	*fakeGW
	on map[int64]bool
}

func (g *devGW) OnlineDevices(ids []int64) map[int64]bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := map[int64]bool{}
	for _, id := range ids {
		if g.on[id] {
			out[id] = true
		}
	}
	return out
}

// devPackets: các gói devices.updated tới uid (xoá danh sách gói).
func devPackets(t *testing.T, g *fakeGW, uid int64) []DevicesUpdatedDTO {
	t.Helper()
	var out []DevicesUpdatedDTO
	for _, p := range g.packets(EvDevicesUpdated, true) {
		if len(p.users) != 1 || p.users[0] != uid {
			t.Fatalf("devices.updated phải chỉ tới chính tài khoản %d: %v", uid, p.users)
		}
		out = append(out, p.data.(DevicesUpdatedDTO))
	}
	return out
}

func devFind(l *DeviceList, id int64) *DeviceDTO {
	for i := range l.Devices {
		if l.Devices[i].ID == id {
			return &l.Devices[i]
		}
	}
	return nil
}

func TestDevicesListRevokeDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	gw := &devGW{fakeGW: e.gw, on: map[int64]bool{}}
	e.s.SetGateway(gw)
	a, b := e.user("An"), e.user("Bình")
	d2, d3 := e.device(a.id), e.device(a.id)
	// thiết bị không còn phiên (refresh token đã dùng) -> không hiện, trừ khi là thiết bị hiện tại
	var stale int64
	if err := e.pool.QueryRow(ctx, `insert into chat_devices (user_id, platform, device_name) values ($1, 'android', 'Cũ') returning id`,
		a.id).Scan(&stale); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into chat_refresh_tokens (device_id, token_hash, expires_at, used_at)
		values ($1, $2, now() + interval '1 day', now())`, stale, hashToken(newUUID())); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `update chat_devices set last_seen_at = now() - interval '1 hour', user_agent = 'Mozilla/5.0 Thử',
		last_ip = '198.51.100.7', login_method = 'qr', push_kind = 'webpush', push_token = '{}' where id = $1`, d2); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `update chat_devices set last_seen_at = now() where id = $1`, d3); err != nil {
		t.Fatal(err)
	}
	gw.mu.Lock()
	gw.on[d3] = true
	gw.mu.Unlock()

	l, err := e.s.Devices(ctx, a.id, a.did)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Devices) != 3 || l.Devices[0].ID != a.did || !l.Devices[0].Current || l.Devices[1].ID != d3 || l.Devices[2].ID != d2 {
		t.Fatalf("thứ tự / phạm vi danh sách: %+v", l.Devices)
	}
	x := devFind(l, d2)
	if x.Current || x.Online || !x.Push || x.UserAgent != "Mozilla/5.0 Thử" || x.LastIP != "198.51.100.7" || x.LoginMethod != LoginQR ||
		x.LastSeenAt == nil || x.CreatedAt == "" || x.Platform != "web" {
		t.Fatalf("thiết bị 2: %+v", x)
	}
	if y := devFind(l, d3); !y.Online || y.Push || y.LoginMethod != LoginOTP {
		t.Fatalf("thiết bị 3: %+v", y)
	}
	if devFind(l, stale) != nil {
		t.Fatal("thiết bị hết phiên không được hiện")
	}
	// thiết bị hiện tại luôn hiện kể cả khi không còn refresh token hợp lệ
	l, err = e.s.Devices(ctx, a.id, stale)
	if err != nil || len(l.Devices) != 4 || l.Devices[0].ID != stale || !l.Devices[0].Current {
		t.Fatalf("thiết bị hiện tại hết phiên: %+v %v", l, err)
	}
	// không có gateway hỗ trợ OnlineDevices -> online = false
	e.s.SetGateway(e.gw)
	if l, _ = e.s.Devices(ctx, a.id, a.did); devFind(l, d3).Online {
		t.Fatal("gateway không có OnlineDevices thì online = false")
	}
	e.s.SetGateway(gw)

	// đăng xuất từ xa
	wantCode(t, "thu hồi thiết bị hiện tại", e.s.RevokeDevice(ctx, a.id, a.did, a.did), CodeBadRequest)
	wantCode(t, "thiết bị của người khác", e.s.RevokeDevice(ctx, a.id, a.did, b.did), CodeNotFound)
	wantCode(t, "thiết bị không có", e.s.RevokeDevice(ctx, a.id, a.did, 0), CodeNotFound)
	gw.packets("", true)
	tok2 := signAccess(e.s.jwtKey, a.id, d2, e.clk.now(), e.s.accessTTL)
	if _, _, err := e.s.authToken(ctx, tok2); err != nil { // nạp cache thiết bị
		t.Fatal(err)
	}
	if err := e.s.RevokeDevice(ctx, a.id, a.did, d2); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.s.authToken(ctx, tok2); codeOf(err) != CodeNoAuth {
		t.Fatalf("access token của thiết bị bị thu hồi phải bị từ chối ngay: %v", err)
	}
	gw.mu.Lock()
	closed := append([]int64(nil), gw.closed...)
	gw.mu.Unlock()
	if len(closed) != 1 || closed[0] != d2 {
		t.Fatalf("CloseDevice: %v", closed)
	}
	if ps := devPackets(t, e.gw, a.id); len(ps) != 1 || ps[0] != (DevicesUpdatedDTO{Reason: "revoked", DeviceID: d2}) {
		t.Fatalf("devices.updated: %+v", ps)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_refresh_tokens where device_id = $1`, d2).Scan(&n)
	if n != 0 {
		t.Fatal("refresh token của thiết bị bị thu hồi phải bị xoá")
	}
	wantCode(t, "thu hồi lần 2", e.s.RevokeDevice(ctx, a.id, a.did, d2), CodeNotFound)

	// đăng xuất mọi thiết bị khác: d3 + thiết bị hết phiên; thiết bị của b không đổi
	r, err := e.s.RevokeOtherDevices(ctx, a.id, a.did)
	if err != nil || r.Revoked != 2 {
		t.Fatalf("logout-others: %+v %v", r, err)
	}
	if ps := devPackets(t, e.gw, a.id); len(ps) != 2 || ps[0].Reason != "revoked" {
		t.Fatalf("devices.updated logout-others: %+v", ps)
	}
	l, _ = e.s.Devices(ctx, a.id, a.did)
	if len(l.Devices) != 1 || l.Devices[0].ID != a.did {
		t.Fatalf("sau logout-others: %+v", l.Devices)
	}
	if lb, _ := e.s.Devices(ctx, b.id, b.did); len(lb.Devices) != 1 {
		t.Fatalf("thiết bị của người khác bị đụng: %+v", lb.Devices)
	}
	if r, err = e.s.RevokeOtherDevices(ctx, a.id, a.did); err != nil || r.Revoked != 0 {
		t.Fatalf("logout-others lần 2: %+v %v", r, err)
	}
}

// otp/verify ghi User-Agent / IP / login_method + báo devices.updated; refresh cập nhật last_ip; logout báo devices.updated.
func TestDevicesLoginInfoDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	phone := e.randPhone()
	if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, ""); err != nil {
		t.Fatal(err)
	}
	long := ""
	for len([]rune(long)) < maxUserAgent+20 {
		long += "Trình duyệt "
	}
	in := VerifyInput{Phone: phone, OTP: e.sms.code(phone), ClientIP: "203.0.113.9", UserAgent: "  " + long}
	in.Device.Platform, in.Device.Name = "desktop", "Máy văn phòng"
	res, err := e.s.VerifyOTP(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	e.track(res.User.ID)
	var ua, ip, method string
	if err := e.pool.QueryRow(ctx, `select user_agent, last_ip, login_method from chat_devices where id = $1`, res.DeviceID).
		Scan(&ua, &ip, &method); err != nil {
		t.Fatal(err)
	}
	if len([]rune(ua)) != maxUserAgent || ua[:len("Trình")] != "Trình" || ip != "203.0.113.9" || method != LoginOTP {
		t.Fatalf("thiết bị sau verify: %d ký tự %q %q", len([]rune(ua)), ip, method)
	}
	if ps := devPackets(t, e.gw, res.User.ID); len(ps) != 1 || ps[0] != (DevicesUpdatedDTO{Reason: "login", DeviceID: res.DeviceID}) {
		t.Fatalf("devices.updated login: %+v", ps)
	}

	r2, err := e.s.RefreshFrom(ctx, res.RefreshToken, "2001:db8::1")
	if err != nil {
		t.Fatal(err)
	}
	_ = e.pool.QueryRow(ctx, `select last_ip from chat_devices where id = $1`, res.DeviceID).Scan(&ip)
	if ip != "2001:db8::1" {
		t.Fatalf("refresh phải ghi last_ip: %q", ip)
	}
	if _, err := e.s.Refresh(ctx, r2.RefreshToken); err != nil {
		t.Fatal(err)
	}
	_ = e.pool.QueryRow(ctx, `select last_ip from chat_devices where id = $1`, res.DeviceID).Scan(&ip)
	if ip != "2001:db8::1" {
		t.Fatalf("refresh không IP giữ last_ip cũ: %q", ip)
	}

	other := e.device(res.User.ID)
	e.gw.packets("", true)
	if err := e.s.Logout(ctx, res.User.ID, other); err != nil {
		t.Fatal(err)
	}
	if ps := devPackets(t, e.gw, res.User.ID); len(ps) != 1 || ps[0] != (DevicesUpdatedDTO{Reason: "logout", DeviceID: other}) {
		t.Fatalf("devices.updated logout: %+v", ps)
	}
	if err := e.s.Logout(ctx, res.User.ID, other); err != nil { // đã đăng xuất: không báo lại
		t.Fatal(err)
	}
	if ps := devPackets(t, e.gw, res.User.ID); len(ps) != 0 {
		t.Fatalf("logout lần 2 không gửi gói: %+v", ps)
	}
}
