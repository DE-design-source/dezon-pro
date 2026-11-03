package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestAuthOK(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	c := connect(t, srv)
	before := time.Now().Add(-time.Second)
	// device_id dạng chuỗi (localStorage) cũng nhận.
	c.send(TypeAuth, "c-1", map[string]any{"access_token": "u5", "device_id": "7"})
	p := c.expect(TypeAuthOK)
	if p.reqID() != "c-1" {
		t.Fatalf("req_id = %q", p.reqID())
	}
	var d struct {
		UserID     int64  `json:"user_id"`
		ServerTime string `json:"server_time"`
	}
	p.decode(t, &d)
	if d.UserID != 5 {
		t.Fatalf("user_id = %d", d.UserID)
	}
	st, err := time.Parse("2006-01-02T15:04:05.000Z", d.ServerTime)
	if err != nil || st.Before(before) {
		t.Fatalf("server_time = %q (%v)", d.ServerTime, err)
	}
	if !h.OnlineUsers([]int64{5})[5] || h.OnlineUsers([]int64{6})[6] {
		t.Fatal("OnlineUsers sai sau khi xác thực")
	}
	if od := h.OnlineDevices([]int64{7, 8}); !od[7] || od[8] || len(od) != 2 {
		t.Fatalf("OnlineDevices = %v", od)
	}
	c.ping()
}

func TestAuthFailure(t *testing.T) {
	_, srv, _ := newHubServer(t, Options{})
	cases := []struct {
		name, token, code string
	}{
		{"lỗi thường", "bad", CodeAuthFailed},
		{"lỗi của Backend", "expired", "TOKEN_EXPIRED"},
		{"token rỗng", "", CodeAuthFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := connect(t, srv)
			c.send(TypeAuth, "a1", map[string]any{"access_token": tc.token, "device_id": 1})
			p := c.expect(TypeError)
			var e errorData
			p.decode(t, &e)
			if e.Code != tc.code || e.Message == "" || p.reqID() != "a1" {
				t.Fatalf("error = %+v req_id=%q", e, p.reqID())
			}
			c.expectCloseCode(CloseUnauthorized)
		})
	}
}

func TestPacketBeforeAuth(t *testing.T) {
	_, srv, _ := newHubServer(t, Options{})
	t.Run("gói khác auth", func(t *testing.T) {
		c := connect(t, srv)
		c.send(TypePing, "p", nil)
		var e errorData
		c.expect(TypeError).decode(t, &e)
		if e.Code != CodeUnauthenticated {
			t.Fatalf("code = %s", e.Code)
		}
		c.expectCloseCode(CloseUnauthorized)
	})
	t.Run("JSON hỏng", func(t *testing.T) {
		c := connect(t, srv)
		c.sendRaw([]byte("{không phải json"))
		var e errorData
		c.expect(TypeError).decode(t, &e)
		if e.Code != CodeBadRequest {
			t.Fatalf("code = %s", e.Code)
		}
		c.expectCloseCode(CloseUnauthorized)
	})
}

func TestAuthTimeout(t *testing.T) {
	_, srv, _ := newHubServer(t, Options{AuthTimeout: 200 * time.Millisecond})
	start := time.Now()
	c := connect(t, srv)
	c.expectCloseCode(CloseAuthTimeout)
	if el := time.Since(start); el < 150*time.Millisecond {
		t.Fatalf("đóng quá sớm: %v", el)
	}
}

func TestPingPong(t *testing.T) {
	_, srv, _ := newHubServer(t, Options{})
	c := authed(t, srv, 1, 1)
	c.send(TypePing, "k-9", nil)
	p := c.expect(TypePong)
	if p.reqID() != "k-9" {
		t.Fatalf("pong req_id = %q", p.reqID())
	}
	// req_id dạng số được trả nguyên dạng.
	c.sendRaw([]byte(`{"type":"ping","req_id":42}`))
	if p := c.expect(TypePong); string(p.ReqID) != "42" {
		t.Fatalf("pong req_id = %s", p.ReqID)
	}
}

func TestIdleTimeout(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{IdleTimeout: 300 * time.Millisecond})
	c := authed(t, srv, 1, 1)
	// Ping đều đặn giữ kết nối sống lâu hơn nhiều lần IdleTimeout.
	for i := 0; i < 6; i++ {
		time.Sleep(150 * time.Millisecond)
		c.ping()
	}
	start := time.Now()
	if err := c.waitClosed(); err == nil {
		t.Fatal("kết nối phải đóng do im lặng")
	}
	if el := time.Since(start); el < 100*time.Millisecond {
		t.Fatalf("đóng quá sớm: %v", el)
	}
	eventually(t, "gỡ kết nối im lặng", func() bool { return !h.OnlineUsers([]int64{1})[1] })
}

func TestHandleMessage(t *testing.T) {
	_, srv, fb := newHubServer(t, Options{})
	fb.handle = func(c Client, typ string, data json.RawMessage) (any, error) {
		var d struct {
			Mode string `json:"mode"`
		}
		_ = json.Unmarshal(data, &d)
		switch d.Mode {
		case "forbidden":
			return nil, &Error{Code: "FORBIDDEN", Message: "Bạn không còn trong hội thoại"}
		case "db":
			return nil, errors.New("database lỗi")
		case "nil":
			return nil, nil
		case "panic":
			panic("hỏng")
		}
		return map[string]any{"seq": 41, "type": typ}, nil
	}
	c := authed(t, srv, 3, 30)

	c.send(TypeMessageSend, "m1", map[string]any{"mode": "ok"})
	p := c.expect(TypeAck)
	var ack struct {
		Seq  int    `json:"seq"`
		Type string `json:"type"`
	}
	p.decode(t, &ack)
	if p.reqID() != "m1" || ack.Seq != 41 || ack.Type != TypeMessageSend {
		t.Fatalf("ack = %s req_id=%q", p.Data, p.reqID())
	}

	// Không có req_id -> không ack (gói kế tiếp là pong).
	c.send(TypeMessageDelivered, "", map[string]any{"mode": "ok"})
	c.ping()

	c.send(TypeMessageRead, "m2", map[string]any{"mode": "nil"})
	if p := c.expect(TypeAck); string(p.Data) != "{}" || p.reqID() != "m2" {
		t.Fatalf("ack rỗng = %s", p.Data)
	}

	c.send(TypeMessageSend, "m3", map[string]any{"mode": "forbidden"})
	p = c.expect(TypeError)
	var e errorData
	p.decode(t, &e)
	if e.Code != "FORBIDDEN" || e.Message != "Bạn không còn trong hội thoại" || p.reqID() != "m3" {
		t.Fatalf("error = %+v", e)
	}

	for _, mode := range []string{"db", "panic"} {
		c.send(TypeMessageSend, "m4", map[string]any{"mode": mode})
		p = c.expect(TypeError)
		p.decode(t, &e)
		if e.Code != CodeInternal || e.Message != msgInternal || p.reqID() != "m4" {
			t.Fatalf("%s: error = %+v", mode, e)
		}
	}
	c.ping() // kết nối vẫn sống sau panic

	calls := fb.handledCalls()
	if len(calls) != 6 {
		t.Fatalf("HandleMessage gọi %d lần", len(calls))
	}
	cl := calls[0].client
	if cl.UserID != 3 || cl.DeviceID != 30 || cl.ConnID == 0 || calls[1].typ != TypeMessageDelivered {
		t.Fatalf("client = %+v, typ = %s", cl, calls[1].typ)
	}
	if !strings.Contains(calls[0].data, `"mode":"ok"`) {
		t.Fatalf("data = %s", calls[0].data)
	}
}

func TestBadPackets(t *testing.T) {
	_, srv, _ := newHubServer(t, Options{})
	c := authed(t, srv, 1, 1)
	for _, raw := range []string{`{hỏng`, `[1,2]`, `{"type":""}`, `{"type":"ping","req_id":{"x":1}}`} {
		c.sendRaw([]byte(raw))
		var e errorData
		c.expect(TypeError).decode(t, &e)
		if e.Code != CodeBadRequest {
			t.Fatalf("%s: code = %s", raw, e.Code)
		}
	}
	c.send("message.edit", "u1", map[string]any{})
	p := c.expect(TypeError)
	var e errorData
	p.decode(t, &e)
	if e.Code != CodeUnknownType || p.reqID() != "u1" {
		t.Fatalf("unknown: %+v %q", e, p.reqID())
	}
	c.send(TypeAuth, "a2", map[string]any{"access_token": "u1"})
	c.expect(TypeError).decode(t, &e)
	if e.Code != CodeBadRequest {
		t.Fatalf("auth lần hai: %+v", e)
	}
	c.ping()
}

func TestOversizedFrame(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	c := authed(t, srv, 1, 1)
	pad := func(n int) []byte {
		return []byte(`{"type":"ping","data":{"pad":"` + strings.Repeat("x", n) + `"}}`)
	}
	c.sendRaw(pad(maxFrameBytes - 100)) // vừa dưới 32 KiB: hợp lệ
	c.expect(TypePong)
	c.sendRaw(pad(maxFrameBytes + 1000))
	if err := c.waitClosed(); err == nil {
		t.Fatal("gói > 32 KiB phải đóng kết nối")
	}
	eventually(t, "gỡ kết nối", func() bool { return !h.OnlineUsers([]int64{1})[1] })
}

func TestTyping(t *testing.T) {
	_, srv, fb := newHubServer(t, Options{})
	fb.members[100] = []int64{1, 2}
	a1 := authed(t, srv, 1, 11)
	a2 := authed(t, srv, 1, 12) // thiết bị khác của chính người gõ: không nhận
	b := authed(t, srv, 2, 21)
	cc := authed(t, srv, 3, 31) // không phải thành viên

	expectTyping := func(want bool) {
		t.Helper()
		var d typingData
		b.expect(TypeTyping).decode(t, &d)
		if d.ConversationID != 100 || d.UserID != 1 || d.IsTyping != want {
			t.Fatalf("typing = %+v", d)
		}
	}
	send := func(typ, req string) {
		t.Helper()
		a1.send(typ, req, map[string]any{"conversation_id": 100})
		if p := a1.expect(TypeAck); p.reqID() != req {
			t.Fatalf("ack req_id = %q", p.reqID())
		}
	}

	send(TypeTypingStart, "t1")
	expectTyping(true)
	a2.ping()
	cc.ping()

	send(TypeTypingStart, "t2") // < 1 giây: bị bỏ
	b.ping()

	send(TypeTypingStop, "t3") // stop luôn chuyển và xoá mốc chặn
	expectTyping(false)
	send(TypeTypingStart, "t4")
	expectTyping(true)

	send(TypeTypingStart, "t5")
	b.ping()
	time.Sleep(typingThrottle + 100*time.Millisecond)
	send(TypeTypingStart, "t6")
	expectTyping(true)

	// Người ngoài hội thoại: lỗi của Backend, không ai nhận.
	cc.send(TypeTypingStart, "t7", map[string]any{"conversation_id": "100"})
	var e errorData
	cc.expect(TypeError).decode(t, &e)
	if e.Code != "FORBIDDEN" {
		t.Fatalf("code = %s", e.Code)
	}
	cc.send(TypeTypingStart, "t8", map[string]any{"conversation_id": "abc"})
	cc.expect(TypeError).decode(t, &e)
	if e.Code != CodeBadRequest {
		t.Fatalf("code = %s", e.Code)
	}
	b.ping()
	a2.ping()
}

func TestSendToUsers(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	u1a := authed(t, srv, 1, 11)
	u1b := authed(t, srv, 1, 12)
	u2 := authed(t, srv, 2, 21)
	u3 := authed(t, srv, 3, 31)
	anon := connect(t, srv) // chưa xác thực: không nhận

	h.SendToUsers([]int64{1, 2, 1, 99}, TypeMessageNew, map[string]any{"id": 901, "seq": 41})
	for _, c := range []*tclient{u1a, u1b, u2} {
		var d struct {
			ID  int `json:"id"`
			Seq int `json:"seq"`
		}
		c.expect(TypeMessageNew).decode(t, &d)
		if d.ID != 901 || d.Seq != 41 {
			t.Fatalf("message.new = %+v", d)
		}
		c.ping() // đúng một lần dù user 1 có trong danh sách hai lần
	}
	u3.ping()

	h.SendToUsers([]int64{3}, TypeReceiptUpdate, nil)
	if p := u3.expect(TypeReceiptUpdate); string(p.Data) != "{}" {
		t.Fatalf("data nil -> %s", p.Data)
	}
	anon.send(TypeAuth, "", map[string]any{"access_token": "u4", "device_id": 1})
	anon.expect(TypeAuthOK) // không có message.new nào xếp trước auth.ok

	got := h.OnlineUsers([]int64{1, 2, 3, 4, 5})
	if !got[1] || !got[2] || !got[3] || !got[4] || got[5] {
		t.Fatalf("OnlineUsers = %v", got)
	}
}

func TestSlowConsumer(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{SendBuffer: 4})
	slow, _, err := dialRaw(t, srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), waitStep)
	defer cancel()
	if err := slow.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","data":{"access_token":"u7","device_id":70}}`)); err != nil {
		t.Fatal(err)
	}
	if _, b, err := slow.Read(ctx); err != nil || !strings.Contains(string(b), TypeAuthOK) {
		t.Fatalf("auth chậm: %s %v", b, err)
	}
	// Từ đây client chậm không đọc nữa.
	fast := authed(t, srv, 8, 80)

	big := json.RawMessage(`"` + strings.Repeat("x", 30000) + `"`)
	start := time.Now()
	smalls := 0
	for i := 0; i < 5000 && h.OnlineUsers([]int64{7})[7]; i++ {
		h.SendToUsers([]int64{7}, "big", big)
		if i%50 == 0 {
			h.SendToUsers([]int64{8}, "small", map[string]int{"i": i})
			smalls++
		}
	}
	if el := time.Since(start); el > 10*time.Second {
		t.Fatalf("SendToUsers bị chặn bởi client chậm: %v", el)
	}
	eventually(t, "đóng client chậm", func() bool { return !h.OnlineUsers([]int64{7})[7] })
	for i := 0; i < smalls; i++ {
		fast.expect("small")
	}
	h.SendToUsers([]int64{8}, "after", nil)
	fast.expect("after")
	fast.ping()
}

func TestCloseDevice(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	d10a := authed(t, srv, 1, 10)
	d10b := authed(t, srv, 1, 10)
	d11 := authed(t, srv, 1, 11)
	other := authed(t, srv, 2, 20)

	h.CloseDevice(10)
	h.CloseDevice(999) // không có kết nối: bỏ qua
	for _, c := range []*tclient{d10a, d10b} {
		c.expect(TypeForceLogout)
		c.expectCloseCode(CloseForceLogout)
	}
	d11.ping()
	other.ping()
	if !h.OnlineUsers([]int64{1})[1] {
		t.Fatal("user 1 vẫn còn thiết bị 11")
	}
}

func TestShutdown(t *testing.T) {
	h, srv, fb := newHubServer(t, Options{})
	a := authed(t, srv, 1, 10)
	b := authed(t, srv, 2, 20)
	anon := connect(t, srv)
	eventually(t, "anon được ghi nhận", func() bool {
		h.mu.RLock()
		defer h.mu.RUnlock()
		return len(h.conns) == 3
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.Shutdown(ctx)
	for _, c := range []*tclient{a, b, anon} {
		c.expect(TypeReconnect)
		c.expectCloseCode(CloseServerRestart)
	}
	start := time.Now()
	h.Shutdown(ctx) // gọi lại: không làm gì
	if time.Since(start) > 100*time.Millisecond {
		t.Fatal("Shutdown lần hai phải trả ngay")
	}
	if h.Submit(1, func() {}) {
		t.Fatal("Submit sau Shutdown phải trả false")
	}
	if _, resp, err := dialRaw(t, srv.URL, nil); err == nil || resp == nil || resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("kết nối sau Shutdown: err=%v resp=%v", err, resp)
	}
	for _, uid := range []int64{1, 2} {
		calls := fb.presenceOf(uid)
		if len(calls) != 2 || !calls[0].online || calls[1].online {
			t.Fatalf("PresenceChanged của %d = %+v", uid, calls)
		}
	}
	h.SendToUsers([]int64{1}, TypeMessageNew, nil) // sau Shutdown: không panic
}

func TestShutdownForceClose(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	// Client không đọc: không bao giờ đáp khung close -> Shutdown phải cắt hẳn khi ctx hết hạn.
	ws, _, err := dialRaw(t, srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), waitStep)
	defer cancel()
	_ = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","data":{"access_token":"u1","device_id":1}}`))
	eventually(t, "xác thực", func() bool { return h.OnlineUsers([]int64{1})[1] })

	sctx, scancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer scancel()
	start := time.Now()
	h.Shutdown(sctx)
	if el := time.Since(start); el > 2*time.Second {
		t.Fatalf("Shutdown chờ quá lâu: %v", el)
	}
	h.mu.RLock()
	n := len(h.conns)
	h.mu.RUnlock()
	if n != 0 {
		t.Fatalf("còn %d kết nối sau Shutdown", n)
	}
}

func TestOrigin(t *testing.T) {
	_, srv, _ := newHubServer(t, Options{OriginPatterns: []string{" app.example.com/ ", "*.dezon.tech", "[hỏng"}})
	cases := []struct {
		origin string
		ok     bool
	}{
		{"", true},
		{srv.URL, true}, // cùng host
		{"https://app.example.com", true},
		{"https://chat.dezon.tech", true},
		{"https://evil.example.com", false},
		{"https://dezon.tech.evil.com", false},
	}
	for _, tc := range cases {
		hdr := http.Header{}
		if tc.origin != "" {
			hdr.Set("Origin", tc.origin)
		}
		ws, resp, err := dialRaw(t, srv.URL, hdr)
		if tc.ok {
			if err != nil {
				t.Fatalf("origin %q: %v", tc.origin, err)
			}
			c := startClient(t, ws)
			c.auth(1, 1)
			continue
		}
		if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Fatalf("origin %q phải bị chặn 403: err=%v resp=%v", tc.origin, err, resp)
		}
	}
}

// Thiết bị vừa bị CloseDevice (đăng xuất / thu hồi) trong lúc gói auth của nó đang xác thực: không được đăng ký
// (không thì kết nối sống mãi, không ai đóng).
func TestCloseDeviceRejectsPendingAuth(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	h.CloseDevice(10)
	c := connect(t, srv)
	c.send(TypeAuth, "a", map[string]any{"access_token": "u1", "device_id": 10})
	var e errorData
	c.expect(TypeError).decode(t, &e)
	if e.Code != CodeAuthFailed {
		t.Fatalf("code = %s", e.Code)
	}
	c.expectCloseCode(CloseUnauthorized)
	if h.OnlineUsers([]int64{1})[1] {
		t.Fatal("thiết bị đã thu hồi vẫn được đăng ký")
	}
	authed(t, srv, 1, 11).ping() // thiết bị khác của cùng người: bình thường
}

// Drain chỉ đóng kết nối: bộ chạy tuần tự vẫn nhận job (request REST đang dở lúc tắt server vẫn phân phối + push)
// tới Shutdown.
func TestDrainKeepsExecutor(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{})
	a := authed(t, srv, 1, 10)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.Drain(ctx)
	a.expect(TypeReconnect)
	a.expectCloseCode(CloseServerRestart)
	h.Drain(ctx) // gọi lại: không làm gì
	ran := make(chan struct{})
	if !h.Submit(1, func() { close(ran) }) {
		t.Fatal("Submit sau Drain phải nhận job")
	}
	select {
	case <-ran:
	case <-time.After(waitStep):
		t.Fatal("job sau Drain không chạy")
	}
	h.Shutdown(ctx)
	if h.Submit(1, func() {}) {
		t.Fatal("Submit sau Shutdown phải trả false")
	}
}
