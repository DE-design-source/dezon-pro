package chat

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Phân phối: message.new tới mọi thành viên (cả người gửi); push cho người không online, không tắt thông báo.
func TestDeliveryDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true})
	ctx := context.Background()
	lan, on, off, muted, nodev := e.user("Lan"), e.user("Online"), e.user("Offline"), e.user("Tắt"), e.user("Không push")
	g := e.newGroupFor(t, lan, on, off, muted, nodev)
	for _, u := range []*tu{lan, on, off, muted} {
		if err := e.s.SetPushToken(ctx, u.id, u.did, "webpush", subJSON("dev-"+u.name)); err != nil {
			t.Fatal(err)
		}
	}
	forever := "forever"
	if _, err := e.s.Mute(ctx, muted.id, g, &forever); err != nil {
		t.Fatal(err)
	}
	e.gw.setOnline(on.id, true)
	e.gw.setOnline(lan.id, false)
	// bỏ các push của tin tạo nhóm
	for e.push.next(300*time.Millisecond) != nil {
	}
	e.clk.add(time.Minute) // qua khoảng gộp tin
	e.gw.packets("", true)
	long := strings.Repeat("Xin chào ", 20)
	ack := e.send(lan, g, long)
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 || len(pk[0].users) != 5 || !containsID(pk[0].users, lan.id) {
		t.Fatalf("message.new phải tới cả 5 thành viên (kể cả người gửi): %+v", pk)
	}
	c := e.push.next(2 * time.Second)
	if c == nil {
		t.Fatal("người offline phải nhận push")
	}
	if !strings.Contains(c.sub, "dev-Offline") || c.ttl != 86400 || c.urgency != "high" || c.topic != "c"+itoa(off.id)+"-"+itoa(g) {
		t.Fatalf("push: %+v", c)
	}
	p := c.payload
	if p.Title != "Lan · Nhóm thử" || p.Body != truncRunes(strings.TrimSpace(long), 100) || p.UserID != off.id || p.ConversationID != g ||
		p.Seq != ack.Seq || p.Tag != "conv-"+itoa(off.id)+"-"+itoa(g) || p.URL != "/chat?u="+itoa(off.id)+"#c"+itoa(g) || p.Badge != 2 {
		t.Fatalf("payload: %+v", p)
	}
	if extra := e.push.next(300 * time.Millisecond); extra != nil {
		t.Fatalf("chỉ người offline + không tắt thông báo nhận push, thừa: %+v", extra)
	}

	// không có gateway: vẫn push (mọi người coi như offline), tin 1-1 tiêu đề = tên người gửi
	e2 := newEnv(t, envOpt{push: true, noGateway: true})
	x, y := e2.user("X"), e2.user("Y")
	if err := e2.s.SetPushToken(ctx, y.id, y.did, "webpush", subJSON("y")); err != nil {
		t.Fatal(err)
	}
	d, _ := e2.s.CreateDirect(ctx, x.id, y.id)
	e2.send(x, d.ID, "chào Y")
	if c := e2.push.next(2 * time.Second); c == nil || c.payload.Title != "X" || c.payload.Body != "chào Y" || c.payload.Badge != 1 {
		t.Fatalf("push không gateway: %+v", c)
	}
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

// Worker push: gộp tin trong 3 giây, 410 -> gỡ subscription, 5xx / lỗi mạng -> thử lại 2 lần.
func TestPushWorkerDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	if err := e.s.SetPushToken(ctx, b.id, b.did, "webpush", subJSON("b1")); err != nil {
		t.Fatal(err)
	}
	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	e.send(a, d.ID, "1")
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "1" {
		t.Fatalf("push đầu: %+v", c)
	}
	e.send(a, d.ID, "2") // trong 3 giây: gộp
	if c := e.push.next(300 * time.Millisecond); c != nil {
		t.Fatalf("tin trong 3 giây phải gộp: %+v", c)
	}
	e.clk.add(3 * time.Second)
	e.send(a, d.ID, "3")
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "3" || c.payload.Badge != 3 {
		t.Fatalf("sau 3 giây: %+v", c)
	}

	// 5xx hai lần rồi thành công: 3 lần gọi
	e.push.mu.Lock()
	e.push.n = 0
	e.push.answer = func(n int, _ string) (int, bool, error) {
		if n <= 2 {
			return 503, false, nil
		}
		return 201, false, nil
	}
	e.push.mu.Unlock()
	e.clk.add(5 * time.Second)
	e.send(a, d.ID, "4")
	for i := 0; i < 3; i++ {
		if c := e.push.next(2 * time.Second); c == nil {
			t.Fatalf("lần thử %d không tới", i+1)
		}
	}
	if c := e.push.next(200 * time.Millisecond); c != nil {
		t.Fatal("thành công rồi không thử nữa")
	}
	// lỗi mạng mãi: 1 + 2 lần thử lại rồi bỏ
	e.push.mu.Lock()
	e.push.answer = func(int, string) (int, bool, error) { return 0, false, errors.New("mạng hỏng") }
	e.push.mu.Unlock()
	e.clk.add(5 * time.Second)
	e.send(a, d.ID, "5")
	for i := 0; i < 3; i++ {
		if c := e.push.next(2 * time.Second); c == nil {
			t.Fatalf("lần thử %d (lỗi mạng) không tới", i+1)
		}
	}
	if c := e.push.next(200 * time.Millisecond); c != nil {
		t.Fatal("quá 2 lần thử lại")
	}
	// 4xx thường (400 / 401 / 403 / 413): không thử lại. webpush.Client trả err cho mọi mã không phải 2xx
	for _, code := range []int{400, 401, 403, 413} {
		e.push.mu.Lock()
		e.push.answer = func(int, string) (int, bool, error) {
			return code, false, errors.New("webpush: dịch vụ push trả mã " + strconv.Itoa(code))
		}
		e.push.mu.Unlock()
		e.clk.add(5 * time.Second)
		e.send(a, d.ID, "6")
		if e.push.next(2*time.Second) == nil || e.push.next(200*time.Millisecond) != nil {
			t.Fatalf("%d: gọi đúng 1 lần", code)
		}
	}
	// 410: gỡ subscription của thiết bị
	e.push.mu.Lock()
	e.push.answer = func(int, string) (int, bool, error) { return 410, true, nil }
	e.push.mu.Unlock()
	e.clk.add(5 * time.Second)
	e.send(a, d.ID, "7")
	if e.push.next(2*time.Second) == nil {
		t.Fatal("410: phải gọi push")
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		var kind *string
		_ = e.pool.QueryRow(ctx, `select push_kind from chat_devices where id = $1`, b.did).Scan(&kind)
		if kind == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("410 phải gỡ push_token của thiết bị")
		}
		time.Sleep(20 * time.Millisecond)
	}
	e.clk.add(5 * time.Second)
	e.send(a, d.ID, "8")
	if c := e.push.next(300 * time.Millisecond); c != nil {
		t.Fatal("thiết bị không còn subscription thì không push")
	}
}

func TestPushTokenDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	if cfg := e.s.PushConfig(); !cfg.Enabled || cfg.VAPIDPublicKey == nil || *cfg.VAPIDPublicKey != "BPubThu" {
		t.Fatalf("push config: %+v", cfg)
	}
	err := e.s.SetPushToken(ctx, a.id, a.did, "fcm", "x")
	wantCode(t, "fcm chưa hỗ trợ", err, CodeBadRequest)
	err = e.s.SetPushToken(ctx, a.id, a.did, "webpush", `{"endpoint":"https://evil.example/x","keys":{"p256dh":"a","auth":"b"}}`)
	wantCode(t, "endpoint lạ", err, CodeBadRequest)
	sub := subJSON("chung")
	if err := e.s.SetPushToken(ctx, a.id, a.did, "webpush", sub); err != nil {
		t.Fatal(err)
	}
	// cùng trình duyệt, tài khoản khác (mỗi tab một tài khoản) đăng ký cùng subscription: cả hai thiết bị giữ
	if err := e.s.SetPushToken(ctx, b.id, b.did, "webpush", sub); err != nil {
		t.Fatal(err)
	}
	tok := func(did int64) *string {
		var s *string
		if err := e.pool.QueryRow(ctx, `select push_token from chat_devices where id = $1`, did).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if ta, tb := tok(a.did), tok(b.did); ta == nil || *ta != sub || tb == nil || *tb != sub {
		t.Fatalf("hai tài khoản chung subscription phải cùng giữ: a=%v b=%v", ta, tb)
	}
	// cùng người dùng đăng ký lại trên thiết bị thứ hai (đăng nhập lại): thiết bị cũ của người đó mất, người khác giữ
	a2 := e.device(a.id)
	if err := e.s.SetPushToken(ctx, a.id, a2, "webpush", sub); err != nil {
		t.Fatal(err)
	}
	if ta, ta2, tb := tok(a.did), tok(a2), tok(b.did); ta != nil || ta2 == nil || *ta2 != sub || tb == nil || *tb != sub {
		t.Fatalf("đăng ký lại cùng người dùng: a=%v a2=%v b=%v", ta, ta2, tb)
	}
	var ka *string
	_ = e.pool.QueryRow(ctx, `select push_kind from chat_devices where id = $1`, a.did).Scan(&ka)
	if ka != nil {
		t.Fatalf("thiết bị cũ phải gỡ cả push_kind: %v", *ka)
	}
	var kb *string
	// thiết bị của người khác
	err = e.s.SetPushToken(ctx, a.id, b.did, "webpush", subJSON("x"))
	wantCode(t, "thiết bị người khác", err, CodeNoAuth)
	if err := e.s.ClearPushToken(ctx, b.id, b.did); err != nil {
		t.Fatal(err)
	}
	_ = e.pool.QueryRow(ctx, `select push_kind from chat_devices where id = $1`, b.did).Scan(&kb)
	if kb != nil {
		t.Fatal("xoá push token")
	}
	if t2 := tok(a2); t2 == nil || *t2 != sub {
		t.Fatalf("tắt thông báo của một tài khoản không được gỡ subscription của tài khoản khác: a2=%v", t2)
	}
	off := New(Deps{Cfg: nil})
	if cfg := off.PushConfig(); cfg.Enabled || cfg.VAPIDPublicKey != nil {
		t.Fatalf("không có push: %+v", cfg)
	}
}

// Một trình duyệt, hai tài khoản (mỗi tab một tài khoản) chung một subscription: tin trong nhóm có cả hai -> hai thông
// báo tới cùng subscription, mỗi cái mang user_id / tag / url / Topic của tài khoản nhận (không đè nhau).
func TestPushMultiAccountDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true, noGateway: true})
	ctx := context.Background()
	lan, r1, r2 := e.user("Lan"), e.user("Tab 1"), e.user("Tab 2")
	g := e.newGroupFor(t, lan, r1, r2)
	sub := subJSON("mot-trinh-duyet")
	for _, u := range []*tu{r1, r2} {
		if err := e.s.SetPushToken(ctx, u.id, u.did, "webpush", sub); err != nil {
			t.Fatal(err)
		}
	}
	for e.push.next(300*time.Millisecond) != nil { // bỏ push của tin tạo nhóm (nếu có)
	}
	e.clk.add(time.Minute)
	ack := e.send(lan, g, "chào cả nhóm")
	got := map[int64]*pushCall{}
	for i := 0; i < 2; i++ {
		c := e.push.next(2 * time.Second)
		if c == nil {
			t.Fatalf("phải có 2 thông báo (mỗi tài khoản một), mới có %d", i)
		}
		got[c.payload.UserID] = c
	}
	if extra := e.push.next(300 * time.Millisecond); extra != nil {
		t.Fatalf("thừa thông báo: %+v", extra)
	}
	for _, u := range []*tu{r1, r2} {
		c := got[u.id]
		if c == nil {
			t.Fatalf("thiếu thông báo của %s (user_id %d): %+v", u.name, u.id, got)
		}
		p := c.payload
		if c.sub != sub || c.topic != "c"+itoa(u.id)+"-"+itoa(g) || p.ConversationID != g || p.Seq != ack.Seq ||
			p.Tag != "conv-"+itoa(u.id)+"-"+itoa(g) || p.URL != "/chat?u="+itoa(u.id)+"#c"+itoa(g) || p.Body != "chào cả nhóm" {
			t.Fatalf("thông báo của %s: topic %q payload %+v", u.name, c.topic, p)
		}
	}
	if got[r1.id].topic == got[r2.id].topic || got[r1.id].payload.Tag == got[r2.id].payload.Tag {
		t.Fatal("hai tài khoản trên một subscription phải khác Topic / tag")
	}

	// một tài khoản tắt thông báo (DELETE /chat/devices/push): tài khoản kia vẫn nhận trên cùng subscription
	if err := e.s.ClearPushToken(ctx, r1.id, r1.did); err != nil {
		t.Fatal(err)
	}
	e.clk.add(time.Minute)
	e.send(lan, g, "lần hai")
	if c := e.push.next(2 * time.Second); c == nil || c.payload.UserID != r2.id || c.sub != sub || c.payload.Body != "lần hai" {
		t.Fatalf("sau khi Tab 1 tắt, Tab 2 vẫn phải nhận: %+v", c)
	}
	if extra := e.push.next(300 * time.Millisecond); extra != nil {
		t.Fatalf("Tab 1 đã tắt mà vẫn nhận: %+v", extra)
	}
}

// Phiên của một tài khoản đã hết trên trình duyệt (refresh token hết hạn, hoặc đăng xuất lúc mất mạng nên máy chủ không
// xoá thiết bị) mà thiết bị vẫn giữ subscription chung với tài khoản khác: không push cho thiết bị đó nữa (tin của tài
// khoản đã rời trình duyệt không hiện ở đó), tài khoản còn đăng nhập vẫn nhận.
func TestPushDeadSessionDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true, noGateway: true})
	ctx := context.Background()
	x, a, b := e.user("Người gửi"), e.user("A hết phiên"), e.user("B còn phiên")
	sub := subJSON("trinh-duyet-chung")
	for _, u := range []*tu{a, b} {
		if err := e.s.SetPushToken(ctx, u.id, u.did, "webpush", sub); err != nil {
			t.Fatal(err)
		}
	}
	da, _ := e.s.CreateDirect(ctx, x.id, a.id)
	db, _ := e.s.CreateDirect(ctx, x.id, b.id)
	e.send(x, da.ID, "trước khi hết phiên")
	if c := e.push.next(2 * time.Second); c == nil || c.payload.UserID != a.id {
		t.Fatalf("A còn phiên thì nhận: %+v", c)
	}
	if _, err := e.pool.Exec(ctx, `update chat_refresh_tokens set expires_at = now() - interval '1 second' where device_id = $1`, a.did); err != nil {
		t.Fatal(err)
	}
	e.clk.add(time.Minute)
	e.send(x, da.ID, "sau khi hết phiên")
	if c := e.push.next(500 * time.Millisecond); c != nil {
		t.Fatalf("thiết bị hết phiên không được nhận push: %+v", c)
	}
	e.send(x, db.ID, "cho B")
	if c := e.push.next(2 * time.Second); c == nil || c.payload.UserID != b.id || c.sub != sub {
		t.Fatalf("B vẫn nhận trên cùng subscription: %+v", c)
	}
	if extra := e.push.next(300 * time.Millisecond); extra != nil {
		t.Fatalf("thừa thông báo: %+v", extra)
	}
}
