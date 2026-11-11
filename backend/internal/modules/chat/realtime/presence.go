package realtime

import (
	"context"
	"fmt"
	"sync"
	"time"

	"qspro-backend/internal/platform/logger"
)

// presenceState: người dùng đang online theo góc nhìn người khác - còn kết nối, hoặc vừa mất kết nối cuối cùng
// nhưng chưa quá OfflineGrace (chống nhấp nháy, CHAT.md mục 10). gen tăng mỗi lần trạng thái đổi để timer cũ
// (đã nổ nhưng chưa kịp lấy khoá) tự bỏ qua.
type presenceState struct {
	gen   uint64
	timer *time.Timer // khác nil = đang đếm OfflineGrace
}

const lastSeenKeep = 10 * time.Minute // giữ thời điểm offline trong bộ nhớ chừng này (Backend đã ghi DB từ lâu)

// markOnlineLocked: kết nối đã xác thực đầu tiên của người dùng (hoặc kết nối lại trong OfflineGrace).
// true = người dùng vừa chuyển sang online (báo người theo dõi + Backend). Gọi khi giữ h.mu.
func (h *Hub) markOnlineLocked(uid int64) bool {
	if ps := h.presence[uid]; ps != nil {
		if ps.timer != nil {
			ps.timer.Stop()
			ps.timer = nil
		}
		ps.gen++
		return false
	}
	h.presence[uid] = &presenceState{}
	delete(h.lastSeen, uid)
	h.notifyPresenceLocked(uid, true, time.Time{})
	return true
}

// startGraceLocked: người dùng vừa mất kết nối cuối cùng. Hub đang tắt thì không hẹn giờ - flushPresence lo.
func (h *Hub) startGraceLocked(uid int64) {
	ps := h.presence[uid]
	if ps == nil {
		ps = &presenceState{}
		h.presence[uid] = ps
	}
	if ps.timer != nil {
		ps.timer.Stop()
		ps.timer = nil
	}
	ps.gen++
	if h.closed {
		return
	}
	g := ps.gen
	ps.timer = time.AfterFunc(h.o.OfflineGrace, func() { h.graceExpired(uid, g) })
}

// graceExpired: hết OfflineGrace mà không kết nối lại -> offline, báo người theo dõi và Backend.
func (h *Hub) graceExpired(uid int64, gen uint64) {
	h.mu.Lock()
	ps := h.presence[uid]
	if ps == nil || ps.gen != gen || len(h.byUser[uid]) > 0 || h.closed {
		h.mu.Unlock()
		return
	}
	delete(h.presence, uid)
	at := h.now()
	h.lastSeen[uid] = at
	h.sweepLastSeenLocked(at)
	h.notifyPresenceLocked(uid, false, at)
	h.mu.Unlock()
	h.presQ.push(presenceEvent{userID: uid, online: false, at: at})
}

func (h *Hub) sweepLastSeenLocked(now time.Time) {
	if now.Sub(h.seenSwept) < time.Minute {
		return
	}
	h.seenSwept = now
	for uid, at := range h.lastSeen {
		if now.Sub(at) > lastSeenKeep {
			delete(h.lastSeen, uid)
		}
	}
}

// notifyPresenceLocked xếp gói presence.update cho mọi kết nối đang theo dõi uid. Xếp ngay trong khoá để thứ tự
// online / offline tới người theo dõi đúng thứ tự xảy ra.
func (h *Hub) notifyPresenceLocked(uid int64, online bool, at time.Time) {
	set := h.subs[uid]
	if len(set) == 0 {
		return
	}
	b, err := encodePacket(TypePresenceUpdate, nil, presencePayload(uid, online, at))
	if err != nil {
		return
	}
	for c := range set {
		c.enqueue(b)
	}
}

func presencePayload(uid int64, online bool, lastSeen time.Time) presenceData {
	d := presenceData{UserID: uid, Online: online}
	if !online && !lastSeen.IsZero() {
		s := formatTime(lastSeen)
		d.LastSeen = &s
	}
	return d
}

// presenceEpoch: mốc RevokePresence hiện tại của người xem (đọc trước khi hỏi Backend.PresenceInfo).
func (h *Hub) presenceEpoch(viewer int64) uint64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.presEpoch[viewer]
}

// subscribe thay tập người kết nối c theo dõi bằng những người Backend cho phép (allowed), rồi gửi ngay ảnh chụp
// trạng thái của từng người theo thứ tự yêu cầu. false = đã có RevokePresence của người xem sau mốc epoch (allowed có
// thể đã cũ): không đổi gì.
func (h *Hub) subscribe(c *conn, order []int64, allowed map[int64]time.Time, epoch uint64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.presEpoch[c.userID] != epoch {
		return false
	}
	h.unsubscribeLocked(c)
	for _, t := range order {
		dbSeen, ok := allowed[t]
		if !ok {
			continue
		}
		if c.subs == nil {
			c.subs = map[int64]struct{}{}
		}
		c.subs[t] = struct{}{}
		addTo(h.subs, t, c)

		online := h.presence[t] != nil
		last := dbSeen
		if ls, ok := h.lastSeen[t]; ok && ls.After(last) {
			last = ls
		}
		if b, err := encodePacket(TypePresenceUpdate, nil, presencePayload(t, online, last)); err == nil {
			c.enqueue(b)
		}
	}
	return true
}

// RevokePresence: viewer thôi được xem trạng thái của targets (chặn, huỷ kết bạn, rời / bị xoá khỏi hội thoại chung -
// Backend quyết định). Gỡ đăng ký của mọi kết nối của viewer với từng target và gửi presence.update
// {online: false, last_seen: null} để client thôi hiện trạng thái cũ; presence.subscribe đang hỏi Backend dở thì hỏi lại.
func (h *Hub) RevokePresence(viewer int64, targets []int64) {
	if viewer <= 0 || len(targets) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.byUser[viewer]) == 0 {
		return // không có kết nối: không có đăng ký nào, cũng không có lượt đăng ký đang dở
	}
	h.presEpoch[viewer]++
	for c := range h.byUser[viewer] {
		for _, t := range targets {
			if _, ok := c.subs[t]; !ok {
				continue
			}
			delete(c.subs, t)
			if set := h.subs[t]; set != nil {
				delete(set, c)
				if len(set) == 0 {
					delete(h.subs, t)
				}
			}
			if b, err := encodePacket(TypePresenceUpdate, nil, presencePayload(t, false, time.Time{})); err == nil {
				c.enqueue(b)
			}
		}
	}
}

func (h *Hub) unsubscribeLocked(c *conn) {
	for t := range c.subs {
		if set := h.subs[t]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(h.subs, t)
			}
		}
	}
	c.subs = nil
}

// flushPresence (Shutdown, sau khi mọi kết nối đã đóng): báo offline ngay cho người còn online / đang chờ grace
// để Backend ghi last_seen trước khi tiến trình dừng.
func (h *Hub) flushPresence() {
	h.mu.Lock()
	at := h.now()
	evs := make([]presenceEvent, 0, len(h.presence))
	for uid, ps := range h.presence {
		if ps.timer != nil {
			ps.timer.Stop()
			ps.timer = nil
		}
		ps.gen++
		evs = append(evs, presenceEvent{userID: uid, online: false, at: at})
	}
	h.presence = map[int64]*presenceState{}
	h.mu.Unlock()
	for _, ev := range evs {
		h.presQ.push(ev)
	}
}

// presenceEvent: một lần gọi Backend.PresenceChanged.
type presenceEvent struct {
	userID int64
	online bool
	at     time.Time
}

// presenceQueue gọi Backend.PresenceChanged trên một goroutine riêng, đúng thứ tự xảy ra (không chặn gateway).
// Hàng đợi đầy thì gọi trên goroutine phụ (mất thứ tự nhưng không mất sự kiện, không chặn).
type presenceQueue struct {
	backend Backend
	mu      sync.Mutex
	closed  bool
	ch      chan presenceEvent
	extra   sync.WaitGroup
	done    chan struct{}
}

func newPresenceQueue(b Backend) *presenceQueue {
	q := &presenceQueue{backend: b, ch: make(chan presenceEvent, 4096), done: make(chan struct{})}
	go func() {
		defer close(q.done)
		for ev := range q.ch {
			q.call(ev)
		}
	}()
	return q
}

func (q *presenceQueue) push(ev presenceEvent) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	select {
	case q.ch <- ev:
	default:
		q.extra.Add(1)
		go func() {
			defer q.extra.Done()
			q.call(ev)
		}()
	}
}

func (q *presenceQueue) call(ev presenceEvent) {
	defer func() {
		if r := recover(); r != nil {
			logger.Error(logTag, "PresenceChanged panic:", fmt.Sprint(r))
		}
	}()
	q.backend.PresenceChanged(ev.userID, ev.online, ev.at)
}

// stop: ngừng nhận sự kiện, chờ gọi xong những sự kiện đã xếp (tối đa tới khi ctx hết hạn).
func (q *presenceQueue) stop(ctx context.Context) {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		close(q.ch)
	}
	q.mu.Unlock()
	done := make(chan struct{})
	go func() {
		<-q.done
		q.extra.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}
