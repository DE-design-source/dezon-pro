package realtime

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type presencePkt struct {
	UserID   int64   `json:"user_id"`
	Online   bool    `json:"online"`
	LastSeen *string `json:"last_seen"`
}

func expectPresence(t *testing.T, c *tclient) presencePkt {
	t.Helper()
	var d presencePkt
	c.expect(TypePresenceUpdate).decode(t, &d)
	return d
}

func waitPresenceCall(t *testing.T, fb *fakeBackend, uid int64, online bool) presenceCall {
	t.Helper()
	deadline := time.After(waitStep)
	for {
		select {
		case p := <-fb.presCh:
			if p.userID == uid && p.online == online {
				return p
			}
		case <-deadline:
			t.Fatalf("không thấy PresenceChanged(%d, %v)", uid, online)
		}
	}
}

func TestPresence(t *testing.T) {
	const grace = 300 * time.Millisecond
	h, srv, fb := newHubServer(t, Options{OfflineGrace: grace})
	t0 := time.Date(2026, 10, 30, 3, 4, 5, 123e6, time.UTC)
	fb.allow = func(viewer int64, targets []int64) map[int64]time.Time {
		out := map[int64]time.Time{}
		for _, x := range targets {
			switch x {
			case 2:
				out[x] = time.Time{}
			case 3:
				out[x] = t0
			}
		}
		return out
	}

	a := authed(t, srv, 1, 10)
	waitPresenceCall(t, fb, 1, true)
	b := authed(t, srv, 2, 20)
	waitPresenceCall(t, fb, 2, true)

	// Ảnh chụp ngay: 2 online, 3 offline với last_seen trong DB; 99 không được xem, 1 là chính mình.
	a.send(TypePresenceSub, "p1", map[string]any{"user_ids": []any{2, "3", 99, 1, 2}})
	got := map[int64]presencePkt{}
	for i := 0; i < 2; i++ {
		d := expectPresence(t, a)
		got[d.UserID] = d
	}
	if p := a.expect(TypeAck); p.reqID() != "p1" {
		t.Fatalf("ack req_id = %q", p.reqID())
	}
	if d := got[2]; !d.Online || d.LastSeen != nil {
		t.Fatalf("user 2 = %+v", d)
	}
	if d := got[3]; d.Online || d.LastSeen == nil || *d.LastSeen != "2026-10-30T03:04:05.123Z" {
		t.Fatalf("user 3 = %+v", d)
	}

	// 3 online -> người theo dõi nhận ngay.
	c3 := authed(t, srv, 3, 30)
	if d := expectPresence(t, a); d.UserID != 3 || !d.Online || d.LastSeen != nil {
		t.Fatalf("3 online = %+v", d)
	}
	waitPresenceCall(t, fb, 3, true)
	b.ping() // b không theo dõi ai

	// Rớt rồi vào lại trong OfflineGrace: không có offline, không gọi PresenceChanged lần nữa.
	_ = c3.ws.Close(websocket.StatusNormalClosure, "")
	eventually(t, "3 mất kết nối", func() bool { return !h.OnlineUsers([]int64{3})[3] })
	c3 = authed(t, srv, 3, 30)
	time.Sleep(grace + 200*time.Millisecond)
	a.ping()
	if calls := fb.presenceOf(3); len(calls) != 1 || !calls[0].online {
		t.Fatalf("PresenceChanged của 3 = %+v", calls)
	}

	// Rớt hẳn: sau OfflineGrace mới báo offline, last_seen = thời điểm Backend được báo.
	_ = c3.ws.Close(websocket.StatusNormalClosure, "")
	gone := time.Now()
	d := expectPresence(t, a)
	if el := time.Since(gone); el < grace-50*time.Millisecond {
		t.Fatalf("offline đến sau %v, sớm hơn OfflineGrace", el)
	}
	pc := waitPresenceCall(t, fb, 3, false)
	if d.UserID != 3 || d.Online || d.LastSeen == nil || *d.LastSeen != formatTime(pc.at) {
		t.Fatalf("3 offline = %+v, PresenceChanged at %v", d, pc.at)
	}

	// Theo dõi lại: last_seen trong bộ nhớ (mới hơn DB) được dùng.
	a.send(TypePresenceSub, "p2", map[string]any{"user_ids": []int64{3}})
	if d := expectPresence(t, a); d.Online || d.LastSeen == nil || *d.LastSeen != formatTime(pc.at) {
		t.Fatalf("ảnh chụp lại 3 = %+v", d)
	}
	a.expect(TypeAck)

	// Bỏ theo dõi (danh sách rỗng): 3 vào lại thì a không nhận gì.
	a.send(TypePresenceSub, "p3", map[string]any{"user_ids": []int64{}})
	a.expect(TypeAck)
	authed(t, srv, 3, 30)
	waitPresenceCall(t, fb, 3, true)
	a.ping()

	// Quá 100 người -> BAD_REQUEST.
	ids := make([]int64, maxPresenceTargets+1)
	for i := range ids {
		ids[i] = int64(i + 1000)
	}
	a.send(TypePresenceSub, "p4", map[string]any{"user_ids": ids})
	var e errorData
	a.expect(TypeError).decode(t, &e)
	if e.Code != CodeBadRequest {
		t.Fatalf("code = %s", e.Code)
	}
}

// Người theo dõi rớt kết nối: gỡ khỏi map theo dõi (không rò bộ nhớ, không gửi vào kết nối chết).
func TestPresenceUnsubscribeOnClose(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{OfflineGrace: 50 * time.Millisecond})
	a := authed(t, srv, 1, 10)
	a.send(TypePresenceSub, "p", map[string]any{"user_ids": []int64{2}})
	expectPresence(t, a)
	a.expect(TypeAck)
	_ = a.ws.Close(websocket.StatusNormalClosure, "")
	eventually(t, "gỡ theo dõi", func() bool {
		h.mu.RLock()
		defer h.mu.RUnlock()
		return len(h.subs) == 0 && len(h.conns) == 0
	})
	eventually(t, "1 offline sau grace", func() bool {
		h.mu.RLock()
		defer h.mu.RUnlock()
		return len(h.presence) == 0
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	h.Shutdown(ctx)
}

// RevokePresence (chặn, rời nhóm...): gỡ đăng ký ngay, báo offline không kèm last_seen, sau đó không còn gói nào của
// người đó; đăng ký của kết nối khác / người khác giữ nguyên.
func TestRevokePresence(t *testing.T) {
	h, srv, _ := newHubServer(t, Options{OfflineGrace: time.Hour})
	b1 := authed(t, srv, 2, 20)
	b2 := authed(t, srv, 2, 21)
	c := authed(t, srv, 3, 30)
	for _, x := range []*tclient{b1, b2, c} {
		x.send(TypePresenceSub, "p", map[string]any{"user_ids": []int64{1, 4}})
		expectPresence(t, x)
		expectPresence(t, x)
		x.expect(TypeAck)
	}
	h.RevokePresence(2, []int64{1, 99})
	h.RevokePresence(7, []int64{1}) // không có kết nối: bỏ qua
	for _, x := range []*tclient{b1, b2} {
		if d := expectPresence(t, x); d.UserID != 1 || d.Online || d.LastSeen != nil {
			t.Fatalf("gói thu hồi: %+v", d)
		}
	}
	a := authed(t, srv, 1, 10) // 1 online: chỉ c còn theo dõi
	if d := expectPresence(t, c); d.UserID != 1 || !d.Online {
		t.Fatalf("c theo dõi 1: %+v", d)
	}
	d4 := authed(t, srv, 4, 40) // 4 vẫn được 2 theo dõi
	for _, x := range []*tclient{b1, b2, c} {
		if d := expectPresence(t, x); d.UserID != 4 || !d.Online {
			t.Fatalf("theo dõi 4: %+v", d)
		}
		x.ping() // không còn gói nào của 1 cho b1 / b2
	}
	h.mu.RLock()
	n := len(h.subs[1])
	h.mu.RUnlock()
	if n != 1 {
		t.Fatalf("subs[1] còn %d kết nối, muốn 1 (c)", n)
	}
	_, _ = a, d4
}

// presence.subscribe đang hỏi Backend dở mà RevokePresence chạy xen: kết quả cũ không được ghi (hỏi lại).
func TestPresenceSubscribeEpoch(t *testing.T) {
	h, srv, fb := newHubServer(t, Options{OfflineGrace: time.Hour})
	b := authed(t, srv, 2, 20)
	var calls atomic.Int32
	fb.mu.Lock()
	fb.allow = func(viewer int64, targets []int64) map[int64]time.Time {
		if calls.Add(1) == 1 { // lần hỏi đầu: còn được xem 1, nhưng bị thu hồi trước khi kịp đăng ký
			h.RevokePresence(2, []int64{1})
			return map[int64]time.Time{1: {}}
		}
		return map[int64]time.Time{}
	}
	fb.mu.Unlock()
	b.send(TypePresenceSub, "p", map[string]any{"user_ids": []int64{1}})
	b.expect(TypeAck) // lần hỏi lại: không còn được xem -> không có presence.update nào
	if n := calls.Load(); n != 2 {
		t.Fatalf("PresenceInfo gọi %d lần, muốn 2", n)
	}
	h.mu.RLock()
	n := len(h.subs[1])
	h.mu.RUnlock()
	if n != 0 {
		t.Fatal("kết quả cũ của lần hỏi đầu vẫn được đăng ký")
	}
}
