package realtime

import (
	"context"
	"net/http"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"qspro-backend/internal/platform/logger"
)

const logTag = "chat-ws"

// Hub: gateway WebSocket trong bộ nhớ. Mọi map dùng chung đều do mu bảo vệ; mỗi kết nối có goroutine đọc
// (chính goroutine của ServeHTTP) và goroutine ghi riêng, gửi qua channel có đệm nên SendToUsers không bao giờ chặn.
type Hub struct {
	o       Options
	backend Backend
	now     func() time.Time

	// baseCtx: ngữ cảnh gọi Backend cho gói nghiệp vụ (không huỷ khi client rớt, để tin đã tới máy chủ vẫn được lưu);
	// chỉ huỷ khi Shutdown kết thúc.
	baseCtx    context.Context
	baseCancel context.CancelFunc

	mu        sync.RWMutex
	closed    bool                         // Shutdown đã gọi: từ chối kết nối mới, kết nối vừa vào bị đóng ngay
	killed    bool                         // Shutdown hết hạn chờ: cắt hẳn mọi kết nối
	conns     map[*conn]struct{}           // mọi kết nối, kể cả chưa xác thực
	byUser    map[int64]map[*conn]struct{} // kết nối đã xác thực theo người dùng
	byDevice  map[int64]map[*conn]struct{} // kết nối đã xác thực theo thiết bị
	presence  map[int64]*presenceState     // người đang online (còn kết nối hoặc đang trong OfflineGrace)
	lastSeen  map[int64]time.Time          // thời điểm offline vừa ghi nhận (Backend ghi DB bất đồng bộ)
	subs      map[int64]map[*conn]struct{} // người được theo dõi -> kết nối đang theo dõi (presence.subscribe)
	seenSwept time.Time
	presEpoch map[int64]uint64    // người xem -> tăng mỗi lần RevokePresence (presence.subscribe đang hỏi Backend dở thì hỏi lại)
	revoked   map[int64]time.Time // thiết bị vừa CloseDevice: gói auth đang xử lý dở của thiết bị đó không được đăng ký nữa
	revSwept  time.Time

	typingMu    sync.Mutex
	typingLast  map[typingKey]time.Time
	typingSwept time.Time

	nextConnID atomic.Uint64
	connWG     sync.WaitGroup // mỗi ServeHTTP đang chạy

	exec    *executor
	presQ   *presenceQueue
	drainCh chan struct{} // đóng khi Drain xong
	stopCh  chan struct{} // đóng khi Shutdown xong
	started atomic.Bool   // Drain đã bắt đầu
	stopped atomic.Bool   // Shutdown (dừng bộ chạy tuần tự) đã bắt đầu
}

// NewHub tạo gateway. Options.Backend bắt buộc.
func NewHub(o Options) *Hub {
	if o.Backend == nil {
		panic("realtime: Options.Backend bắt buộc")
	}
	if o.AuthTimeout <= 0 {
		o.AuthTimeout = 10 * time.Second
	}
	if o.IdleTimeout <= 0 {
		o.IdleTimeout = 60 * time.Second
	}
	if o.OfflineGrace <= 0 {
		o.OfflineGrace = 30 * time.Second
	}
	if o.Workers <= 0 {
		o.Workers = 4
	}
	if o.QueueSize <= 0 {
		o.QueueSize = 1024
	}
	if o.SendBuffer <= 0 {
		o.SendBuffer = 256
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	o.OriginPatterns = cleanOriginPatterns(o.OriginPatterns)

	h := &Hub{
		o:          o,
		backend:    o.Backend,
		now:        o.Now,
		conns:      map[*conn]struct{}{},
		byUser:     map[int64]map[*conn]struct{}{},
		byDevice:   map[int64]map[*conn]struct{}{},
		presence:   map[int64]*presenceState{},
		lastSeen:   map[int64]time.Time{},
		subs:       map[int64]map[*conn]struct{}{},
		presEpoch:  map[int64]uint64{},
		revoked:    map[int64]time.Time{},
		typingLast: map[typingKey]time.Time{},
		exec:       newExecutor(o.Workers, o.QueueSize),
		presQ:      newPresenceQueue(o.Backend),
		drainCh:    make(chan struct{}),
		stopCh:     make(chan struct{}),
	}
	h.baseCtx, h.baseCancel = context.WithCancel(context.Background())
	return h
}

// cleanOriginPatterns: bỏ khoảng trắng, dấu "/" cuối, mẫu rỗng và mẫu sai cú pháp path.Match
// (để thư viện không phải từ chối từng request vì mẫu hỏng).
func cleanOriginPatterns(in []string) []string {
	out := make([]string, 0, len(in))
	for _, p := range in {
		p = strings.TrimRight(strings.TrimSpace(p), "/")
		if p == "" {
			continue
		}
		if _, err := path.Match(p, ""); err != nil {
			logger.Error(logTag, "bỏ mẫu origin sai:", p)
			continue
		}
		out = append(out, p)
	}
	return out
}

// ServeHTTP nâng cấp request lên WebSocket rồi chạy kết nối tới khi đóng (chặn suốt vòng đời kết nối).
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"Máy chủ chat đang khởi động lại, mời thử lại sau","code":"UNAVAILABLE"}`))
		return
	}
	h.connWG.Add(1)
	h.mu.Unlock()
	defer h.connWG.Done()

	hw := &hijackWriter{ResponseWriter: w}
	var rw http.ResponseWriter = hw
	if !canHijack(w) {
		rw = w // để thư viện tự trả 501
	}
	ws, err := websocket.Accept(rw, r, &websocket.AcceptOptions{OriginPatterns: h.o.OriginPatterns})
	if err != nil {
		return // Accept đã ghi phản hồi lỗi (403 origin, 426 không phải WebSocket...)
	}
	ws.SetReadLimit(maxFrameBytes)

	c := newConn(h, ws, hw.conn)
	h.addConn(c)
	go c.writeLoop()
	c.readLoop()
	c.finish()
}

// addConn ghi nhận kết nối vừa nâng cấp. Hub đang tắt -> báo reconnect và đóng ngay.
func (h *Hub) addConn(c *conn) {
	h.mu.Lock()
	h.conns[c] = struct{}{}
	closed, killed := h.closed, h.killed
	h.mu.Unlock()
	switch {
	case killed:
		c.kill()
	case closed:
		c.closeWithPacket(reconnectPacket(), CloseServerRestart, "server restart")
	}
}

// SendToUsers gửi một gói tới mọi kết nối đã xác thực của các người dùng (kể cả nhiều thiết bị). Không chặn:
// kết nối có hàng đợi đầy bị đóng (client chậm).
func (h *Hub) SendToUsers(userIDs []int64, typ string, data any) {
	if len(userIDs) == 0 || typ == "" {
		return
	}
	if data == nil {
		data = emptyObject
	}
	b, err := encodePacket(typ, nil, data)
	if err != nil {
		logger.Error(logTag, "mã hoá gói", typ, "lỗi:", err.Error())
		return
	}
	var targets []*conn
	seen := make(map[int64]struct{}, len(userIDs))
	h.mu.RLock()
	for _, uid := range userIDs {
		if _, dup := seen[uid]; dup {
			continue
		}
		seen[uid] = struct{}{}
		for c := range h.byUser[uid] {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	for _, c := range targets {
		c.enqueue(b)
	}
}

// OnlineUsers: true = người dùng còn ít nhất một kết nối đã xác thực (không tính thời gian chờ OfflineGrace).
func (h *Hub) OnlineUsers(userIDs []int64) map[int64]bool {
	out := make(map[int64]bool, len(userIDs))
	h.mu.RLock()
	for _, uid := range userIDs {
		out[uid] = len(h.byUser[uid]) > 0
	}
	h.mu.RUnlock()
	return out
}

// OnlineDevices: true = thiết bị còn ít nhất một kết nối đã xác thực (danh sách thiết bị, cột "đang trực tuyến").
func (h *Hub) OnlineDevices(deviceIDs []int64) map[int64]bool {
	out := make(map[int64]bool, len(deviceIDs))
	h.mu.RLock()
	for _, id := range deviceIDs {
		out[id] = len(h.byDevice[id]) > 0
	}
	h.mu.RUnlock()
	return out
}

// revokedKeep: nhớ thiết bị vừa bị đóng chừng này - đủ để gói auth đang xử lý dở (Backend đã nhận token trước khi
// thiết bị bị xoá) không lọt vào map sau CloseDevice. Mã thiết bị không bao giờ dùng lại nên nhớ lâu hơn cũng không sai.
const revokedKeep = time.Minute

// CloseDevice gửi force_logout rồi đóng mọi kết nối của thiết bị (đăng xuất / thu hồi); kết nối của thiết bị đó đang
// xác thực dở cũng bị từ chối (authConn).
func (h *Hub) CloseDevice(deviceID int64) {
	h.mu.Lock()
	now := h.now()
	h.revoked[deviceID] = now
	if now.Sub(h.revSwept) > revokedKeep {
		h.revSwept = now
		for d, at := range h.revoked {
			if now.Sub(at) > revokedKeep {
				delete(h.revoked, d)
			}
		}
	}
	list := make([]*conn, 0, len(h.byDevice[deviceID]))
	for c := range h.byDevice[deviceID] {
		list = append(list, c)
	}
	h.mu.Unlock()
	if len(list) == 0 {
		return
	}
	b, _ := encodePacket(TypeForceLogout, nil, emptyObject)
	for _, c := range list {
		c.closeWithPacket(b, CloseForceLogout, "logged out")
	}
}

// Submit chạy job tuần tự theo khoá (cùng key % Workers -> cùng worker, giữ thứ tự). false = hàng đợi đầy hoặc
// hub đã Shutdown, job bị bỏ (client tự bù qua phát hiện hở seq + /sync). Sau Drain vẫn nhận job: request REST
// đang dở lúc tắt server vẫn phân phối + push được.
func (h *Hub) Submit(key int64, job func()) bool {
	return h.exec.submit(key, job)
}

// Drain: gửi reconnect cho mọi kết nối, đóng từ từ (CHAT.md mục 7 bước 8), báo offline cho người còn online. Hết ctx
// thì cắt hẳn kết nối còn lại. Bộ chạy tuần tự vẫn chạy tới Shutdown. Gọi nhiều lần an toàn.
func (h *Hub) Drain(ctx context.Context) {
	if h.started.CompareAndSwap(false, true) {
		h.drain(ctx)
		close(h.drainCh)
		return
	}
	// Lần gọi sau (hoặc gọi đồng thời): chỉ chờ lần đầu xong, trong hạn ctx của mình.
	select {
	case <-h.drainCh:
	case <-ctx.Done():
	}
}

// Shutdown: Drain (nếu chưa) rồi dừng bộ chạy tuần tự (chạy nốt job đã xếp hàng). Server gọi Drain trước khi dừng
// HTTP, Shutdown sau khi request REST đang dở đã xong (chat.Service.Shutdown). Gọi nhiều lần an toàn.
func (h *Hub) Shutdown(ctx context.Context) {
	h.Drain(ctx)
	if h.stopped.CompareAndSwap(false, true) {
		h.exec.stop(ctx)
		h.baseCancel()
		close(h.stopCh)
		return
	}
	select {
	case <-h.stopCh:
	case <-ctx.Done():
	}
}

func (h *Hub) drain(ctx context.Context) {
	h.mu.Lock()
	h.closed = true
	list := make([]*conn, 0, len(h.conns))
	for c := range h.conns {
		list = append(list, c)
	}
	h.mu.Unlock()
	rp := reconnectPacket()
	for _, c := range list {
		c.closeWithPacket(rp, CloseServerRestart, "server restart")
	}

	done := make(chan struct{})
	go func() {
		h.connWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		h.mu.Lock()
		h.killed = true
		list = list[:0]
		for c := range h.conns {
			list = append(list, c)
		}
		h.mu.Unlock()
		for _, c := range list {
			c.kill()
		}
		h.baseCancel() // huỷ cả lệnh Backend đang chạy dở (HandleMessage) để goroutine đọc thoát ngay
		<-done
	}

	h.flushPresence()
	h.presQ.stop(ctx)
	h.baseCancel()
}

func reconnectPacket() []byte {
	b, _ := encodePacket(TypeReconnect, nil, emptyObject)
	return b
}

// removeConn gỡ kết nối khỏi mọi map; kết nối cuối cùng của người dùng -> bắt đầu đếm OfflineGrace.
func (h *Hub) removeConn(c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns, c)
	h.unsubscribeLocked(c)
	if !c.authed {
		return
	}
	if set := h.byDevice[c.deviceID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.byDevice, c.deviceID)
		}
	}
	set := h.byUser[c.userID]
	if set == nil {
		return
	}
	delete(set, c)
	if len(set) > 0 {
		return
	}
	delete(h.byUser, c.userID)
	delete(h.presEpoch, c.userID) // không còn kết nối -> không còn presence.subscribe đang dở
	h.startGraceLocked(c.userID)
}

// authConn đưa kết nối vừa xác thực vào map và xếp gói auth.ok trước mọi gói khác (cùng khoá với SendToUsers).
// ok = false: không đăng ký - hub đang tắt, kết nối đang đóng, hoặc (revoked = true) thiết bị vừa bị CloseDevice
// trong lúc Backend xác thực.
func (h *Hub) authConn(c *conn, userID, deviceID int64, authOK []byte) (ok, revoked bool) {
	h.mu.Lock()
	if _, r := h.revoked[deviceID]; r {
		h.mu.Unlock()
		return false, true
	}
	if h.closed || c.isClosing() {
		h.mu.Unlock()
		return false, false
	}
	c.userID, c.deviceID, c.authed = userID, deviceID, true
	c.logUser.Store(userID)
	addTo(h.byUser, userID, c)
	addTo(h.byDevice, deviceID, c)
	c.enqueue(authOK)
	cameOnline := h.markOnlineLocked(userID)
	h.mu.Unlock()
	if cameOnline {
		h.presQ.push(presenceEvent{userID: userID, online: true, at: h.now()})
	}
	return true, false
}

func addTo(m map[int64]map[*conn]struct{}, key int64, c *conn) {
	set := m[key]
	if set == nil {
		set = map[*conn]struct{}{}
		m[key] = set
	}
	set[c] = struct{}{}
}
