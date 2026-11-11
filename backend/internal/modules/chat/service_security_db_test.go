package chat

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Các lỗ hổng tìm thấy khi rà soát: khoá OTP theo SỐ (qua nhiều mã), mã cũ, khoá theo IP, thứ tự khoá refresh /
// đăng xuất, gói auth WebSocket theo thiết bị, giới hạn tra số / mở chat 1-1 với người lạ, thu hồi presence, chặn trong
// chat 1-1, dòng đã rời của /sync.

// otpPhone: số thử + hàm xin mã (lùi 61 giây trước mỗi lần để qua thời gian chờ gửi lại).
func (e *env) otpPhone(t *testing.T) (string, func() string) {
	t.Helper()
	ctx := context.Background()
	phone := e.randPhone()
	return phone, func() string {
		t.Helper()
		if _, err := e.pool.Exec(ctx, `update chat_otp_codes set created_at = created_at - interval '61 seconds' where phone = $1`, phone); err != nil {
			t.Fatal(err)
		}
		if _, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: phone}, ""); err != nil {
			t.Fatal(err)
		}
		return e.sms.code(phone)
	}
}

func wrongOTP(code string) string {
	if code == "000000" {
		return "111111"
	}
	return "000000"
}

// Sai 5 lần thì khoá số, kể cả khi xin mã mới giữa chừng (trước đây mỗi mã có bộ đếm riêng: 4 lần sai / mã x 5 mã / giờ).
func TestOTPLockAcrossCodesDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	phone, request := e.otpPhone(t)
	in := VerifyInput{Phone: phone}
	in.Device.Platform = "web"

	in.OTP = wrongOTP(request())
	for i := 1; i <= 4; i++ {
		_, err := e.s.VerifyOTP(ctx, in)
		wantCode(t, fmt.Sprintf("mã 1 sai lần %d", i), err, CodeOTPInvalid)
	}
	c2 := request()
	in.OTP = wrongOTP(c2)
	_, err := e.s.VerifyOTP(ctx, in)
	wantCode(t, "mã 2 sai lần đầu = lần sai thứ 5 của số", err, CodeOTPLocked)
	in.OTP = c2
	_, err = e.s.VerifyOTP(ctx, in)
	wantCode(t, "đúng mã 2 khi số đang khoá", err, CodeOTPLocked)

	// hết khoá: đếm lại từ đầu (các lần sai trước lúc khoá không tính nữa)
	if _, err := e.pool.Exec(ctx, `update chat_otp_codes set locked_until = now() - interval '1 second',
		created_at = created_at - interval '16 minutes' where phone = $1`, phone); err != nil {
		t.Fatal(err)
	}
	c3 := request()
	in.OTP = wrongOTP(c3)
	_, err = e.s.VerifyOTP(ctx, in)
	wantCode(t, "hết khoá: sai lần 1", err, CodeOTPInvalid)
	in.OTP = c3
	res, err := e.s.VerifyOTP(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	e.track(res.User.ID)
}

// Mã mới thay mã cũ; đăng nhập xong thì mọi mã chưa dùng của số đều hết dùng (mã cũ không "sống lại").
func TestOTPOldCodesDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	phone, request := e.otpPhone(t)
	in := VerifyInput{Phone: phone}
	in.Device.Platform = "web"
	c1 := request()
	c2 := request()
	var live int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_otp_codes where phone = $1 and expires_at > now()`, phone).Scan(&live)
	if live != 1 {
		t.Fatalf("xin mã mới: còn %d mã hiệu lực, muốn 1", live)
	}
	// dòng cũ còn hạn (ghi trước khi có quy tắc này): đăng nhập bằng mã mới vẫn phải dùng hết nó
	if _, err := e.pool.Exec(ctx, `update chat_otp_codes set expires_at = now() + interval '5 minutes' where phone = $1`, phone); err != nil {
		t.Fatal(err)
	}
	in.OTP = c2
	res, err := e.s.VerifyOTP(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	e.track(res.User.ID)
	if c1 != c2 {
		in.OTP = c1
		_, err = e.s.VerifyOTP(ctx, in)
		wantCode(t, "mã cũ sau khi đã đăng nhập bằng mã mới", err, CodeOTPExpired)
	}
	var open int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_otp_codes where phone = $1 and consumed_at is null`, phone).Scan(&open)
	if open != 0 {
		t.Fatalf("còn %d mã chưa dùng", open)
	}
}

// 20 mã / giờ / IP đúng cả khi xin song song cho nhiều số khác nhau (đếm và ghi tuần tự theo IP).
func TestOTPPerIPConcurrentDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	ip := "10.8." + newUUID()[:8]
	var ok, limited atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		ph := e.randPhone()
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := e.s.RequestOTP(ctx, OTPRequestInput{Phone: ph}, ip)
			switch {
			case err == nil:
				ok.Add(1)
			case codeOf(err) == CodeOTPRateLimit:
				limited.Add(1)
			default:
				t.Errorf("xin mã: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != otpPerIP || limited.Load() != 30-otpPerIP {
		t.Fatalf("được %d, bị chặn %d (muốn %d / %d)", ok.Load(), limited.Load(), otpPerIP, 30-otpPerIP)
	}
}

// Refresh khoá dòng thiết bị trước dòng token - cùng thứ tự với đăng xuất (xoá thiết bị rồi cascade xoá token), nên
// refresh + đăng xuất cùng lúc không bao giờ deadlock (40P01 -> 500).
func TestRefreshLogoutLockOrderDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	u := e.user("Khoá")
	raw, hash, _ := newRefreshToken()
	if _, err := e.pool.Exec(ctx, `insert into chat_refresh_tokens (device_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`,
		u.did, hash); err != nil {
		t.Fatal(err)
	}
	// đăng xuất "chậm": đã khoá dòng thiết bị như DELETE chat_devices, chưa tới phần cascade
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `set local lock_timeout = '5s'`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `select id from chat_devices where id = $1 for update`, u.did); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := e.s.Refresh(ctx, raw)
		done <- err
	}()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		_ = e.pool.QueryRow(ctx, `select count(*) from pg_stat_activity where datname = current_database()
			and wait_event_type = 'Lock' and query ilike '%chat_refresh_tokens%'`).Scan(&n)
		if n > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	// phần cascade: refresh mà đang giữ khoá dòng token thì câu này chờ refresh, refresh chờ thiết bị -> deadlock
	if _, err := tx.Exec(ctx, `delete from chat_refresh_tokens where device_id = $1`, u.did); err != nil {
		t.Fatalf("xoá token khi refresh đang chờ: %v", err)
	}
	if _, err := tx.Exec(ctx, `delete from chat_devices where id = $1`, u.did); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		wantCode(t, "refresh của thiết bị vừa đăng xuất", err, CodeRefreshInvalid)
	case <-time.After(5 * time.Second):
		t.Fatal("refresh treo")
	}
}

// Gói auth đọc lại dòng thiết bị (không tin cache): thiết bị vừa bị xoá mà cache còn -> từ chối, và bỏ cache.
func TestWSAuthDeviceGoneDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a := e.user("An")
	if _, _, err := e.s.authToken(ctx, a.token); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `delete from chat_devices where id = $1`, a.did); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.Authenticate(ctx, a.token, a.did); rtCode(err) != CodeAuthFailed {
		t.Fatalf("auth thiết bị đã xoá: %v", err)
	}
	_, _, err := e.s.authToken(ctx, a.token)
	wantCode(t, "middleware sau khi gói auth thấy thiết bị đã xoá", err, CodeNoAuth)
}

func vnPhones(base, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("09%08d", base+i)
	}
	return out
}

func sha256Hexes(tag string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s-%d", tag, i))))
	}
	return out
}

// Đối chiếu danh bạ tính theo SỐ được tra (5000 / ngày), không chỉ theo lượt gọi; tra 1 số cũng trừ vào đó.
func TestMatchContactsBudgetDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a := e.user("Dò số")
	// trùng / sai: chỉ tính số hợp lệ khác nhau (1 lượt)
	same := make([]string, maxMatch-1)
	for i := range same {
		same[i] = "0912345678"
	}
	if _, err := e.s.MatchContacts(ctx, a.id, append(same, "rác"), nil); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := e.s.MatchContacts(ctx, a.id, vnPhones(10000000+i*maxMatch, maxMatch), sha256Hexes(fmt.Sprint("h", i), maxMatch)); err != nil {
			t.Fatalf("lượt %d (2000 số): %v", i+1, err)
		}
	}
	// đã dùng 4001 / 5000: 2000 số nữa thì vượt (không trừ gì); 999 số thì vừa đủ
	_, err := e.s.MatchContacts(ctx, a.id, vnPhones(20000000, maxMatch), sha256Hexes("h3", maxMatch))
	wantCode(t, "vượt 5000 số / ngày", err, CodeRateLimit)
	if _, err := e.s.MatchContacts(ctx, a.id, vnPhones(30000000, 999), nil); err != nil {
		t.Fatalf("còn đủ 999 số: %v", err)
	}
	_, err = e.s.SearchUser(ctx, a.id, "0987654321", "")
	wantCode(t, "tra 1 số khi đã hết hạn mức", err, CodeRateLimit)
	if _, err := e.s.SearchUser(ctx, e.user("Khác").id, "0987654321", ""); err != nil {
		t.Fatalf("hạn mức theo từng người: %v", err)
	}
}

// Mở chat 1-1 MỚI với người chưa là bạn: 30 / giờ; bạn bè và cặp đã có không tính.
func TestCreateDirectLimitDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, f := e.user("Rải tin"), e.user("Bạn")
	e.friends(a, f)
	var first *tu
	for i := 0; i < 30; i++ {
		u := e.user(fmt.Sprint("Lạ ", i))
		if first == nil {
			first = u
		}
		if _, err := e.s.CreateDirect(ctx, a.id, u.id); err != nil {
			t.Fatalf("chat 1-1 thứ %d: %v", i+1, err)
		}
	}
	_, err := e.s.CreateDirect(ctx, a.id, e.user("Lạ 31").id)
	wantCode(t, "chat 1-1 mới thứ 31 với người lạ", err, CodeRateLimit)
	if _, err := e.s.CreateDirect(ctx, a.id, f.id); err != nil {
		t.Fatalf("với bạn bè: %v", err)
	}
	if _, err := e.s.CreateDirect(ctx, a.id, first.id); err != nil {
		t.Fatalf("cặp đã có: %v", err)
	}
}

// Chat 1-1 trống với người lạ không cho xem online của họ; người kia nhắn rồi mới được (cả presence lẫn peer.online).
func TestPresenceStrangerDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Lạ")
	e.gw.setOnline(a.id, true)
	e.gw.setOnline(b.id, true)
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	if d.Peer == nil || d.Peer.Online {
		t.Fatalf("chat trống: peer %+v", d.Peer)
	}
	sees := func(v, x *tu) bool {
		got, err := e.s.PresenceInfo(ctx, v.id, []int64{x.id})
		if err != nil {
			t.Fatal(err)
		}
		_, ok := got[x.id]
		return ok
	}
	if sees(a, b) || sees(b, a) {
		t.Fatal("chat trống: không ai được xem online của ai")
	}
	e.send(a, d.ID, "chào")
	if !sees(b, a) || sees(a, b) {
		t.Fatalf("An đã nhắn: Lạ xem được An (%v), An chưa xem được Lạ (%v)", sees(b, a), sees(a, b))
	}
	if !e.conv(b, d.ID).Peer.Online || e.conv(a, d.ID).Peer.Online {
		t.Fatal("peer.online phải theo cùng quy tắc")
	}
	e.send(b, d.ID, "chào lại")
	if !sees(a, b) || !e.conv(a, d.ID).Peer.Online {
		t.Fatal("Lạ đã trả lời: An xem được Lạ")
	}
}

func hasPair(ps [][2]int64, viewer, target int64) bool {
	for _, p := range ps {
		if p[0] == viewer && p[1] == target {
			return true
		}
	}
	return false
}

// Chặn / huỷ kết bạn / rời nhóm: đăng ký presence không còn được phép bị gỡ ngay (gateway.RevokePresence).
func TestPresenceRevokeDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c, d := e.user("An"), e.user("Bình"), e.user("Châu"), e.user("Dũng")
	g := e.newGroupFor(t, a, b, c) // a là bạn của b, c; b và c chỉ chung nhóm
	e.gw.revokedPairs(true)

	if err := e.s.RemoveMember(ctx, a.id, g, c.id); err != nil {
		t.Fatal(err)
	}
	ps := e.gw.revokedPairs(true)
	if !hasPair(ps, c.id, b.id) || !hasPair(ps, b.id, c.id) || len(ps) != 2 {
		t.Fatalf("Châu bị xoá khỏi nhóm: chỉ cặp Châu - Bình bị thu hồi (An còn là bạn), có %v", ps)
	}
	if err := e.s.Unfriend(ctx, a.id, c.id); err != nil {
		t.Fatal(err)
	}
	if ps := e.gw.revokedPairs(true); !hasPair(ps, a.id, c.id) || !hasPair(ps, c.id, a.id) || len(ps) != 2 {
		t.Fatalf("huỷ kết bạn, không còn hội thoại chung: %v", ps)
	}
	if err := e.s.Unfriend(ctx, a.id, b.id); err != nil {
		t.Fatal(err)
	}
	if ps := e.gw.revokedPairs(true); len(ps) != 0 {
		t.Fatalf("huỷ kết bạn nhưng vẫn chung nhóm: không thu hồi, có %v", ps)
	}
	e.friends(a, d)
	if err := e.s.Block(ctx, a.id, d.id); err != nil {
		t.Fatal(err)
	}
	if ps := e.gw.revokedPairs(true); !hasPair(ps, a.id, d.id) || !hasPair(ps, d.id, a.id) {
		t.Fatalf("chặn: thu hồi cả hai chiều, có %v", ps)
	}
}

// Chat 1-1 đang chặn: không chuyển "đang soạn tin" và đã nhận / đã xem cho bên kia (bỏ chặn thì lại chuyển).
func TestBlockedDirectSignalsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	e.send(a, d.ID, "1")
	e.send(b, d.ID, "2")
	if tg, err := e.s.TypingTargets(ctx, b.id, d.ID); err != nil || len(tg) != 1 || tg[0] != a.id {
		t.Fatalf("typing trước khi chặn: %v %v", tg, err)
	}
	if err := e.s.Block(ctx, a.id, b.id); err != nil {
		t.Fatal(err)
	}
	for _, u := range []*tu{a, b} {
		if tg, err := e.s.TypingTargets(ctx, u.id, d.ID); err != nil || len(tg) != 0 {
			t.Fatalf("typing khi đang chặn (%s): %v %v", u.name, tg, err)
		}
	}
	e.gw.packets("", true)
	if _, err := e.s.MarkReceipt(ctx, a.id, d.ID, 2, true); err != nil {
		t.Fatal(err)
	}
	pk := e.gw.packets("receipt.update", true)
	if len(pk) == 0 {
		t.Fatal("receipt.update tới chính mình vẫn phải gửi")
	}
	for _, p := range pk {
		if containsID(p.users, b.id) {
			t.Fatalf("receipt.update tới người bị chặn: %+v", p)
		}
	}
	if err := e.s.Unblock(ctx, a.id, b.id); err != nil {
		t.Fatal(err)
	}
	if tg, _ := e.s.TypingTargets(ctx, b.id, d.ID); len(tg) != 1 {
		t.Fatalf("bỏ chặn: typing lại tới An, có %v", tg)
	}
	e.send(a, d.ID, "3")
	e.gw.packets("", true)
	if _, err := e.s.MarkReceipt(ctx, b.id, d.ID, 3, true); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range e.gw.packets("receipt.update", true) {
		found = found || containsID(p.users, a.id)
	}
	if !found {
		t.Fatal("bỏ chặn: receipt.update lại tới An")
	}
}

// /sync?cursor=0 của người đã bị xoá khỏi nhóm: không lộ tên mới, số tin, hoạt động, số thành viên sau khi rời.
func TestSyncLeftRowDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c := e.user("An"), e.user("Bình"), e.user("Châu")
	g := e.newGroupFor(t, a, b, c)
	e.send(a, g, "trước khi xoá")
	if err := e.s.RemoveMember(ctx, a.id, g, c.id); err != nil {
		t.Fatal(err)
	}
	e.send(a, g, "sau khi xoá")
	if _, err := e.s.RenameGroup(ctx, a.id, g, "Tên mới"); err != nil {
		t.Fatal(err)
	}
	live := e.conv(a, g)
	r, err := e.s.Sync(ctx, c.id, "0")
	if err != nil {
		t.Fatal(err)
	}
	var row *ConversationDTO
	for i := range r.Conversations {
		if r.Conversations[i].ID == g {
			row = &r.Conversations[i]
		}
	}
	if row == nil || !row.Left {
		t.Fatalf("dòng đã rời phải có trong sync: %+v", r.Conversations)
	}
	if row.Name != nil || row.MemberCount != 0 || row.LastMessageAt != nil || row.LastMessage != nil || row.LastSeq >= live.LastSeq ||
		row.Unread != 0 || row.UpdatedAt == live.UpdatedAt {
		t.Fatalf("dòng đã rời lộ dữ liệu nhóm: %+v (nhóm hiện tại: %+v)", row, live.ConversationDTO)
	}
}
