package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"qspro-backend/internal/platform/logger"
)

// conn: một kết nối WebSocket. Goroutine đọc (ServeHTTP) xử lý gói theo đúng thứ tự client gửi; goroutine ghi
// (writeLoop) là nơi DUY NHẤT ghi gói dữ liệu, lấy từ channel send.
//
// Hai cách đóng:
//   - đóng êm (closeWithPacket): ghi nốt các gói đang chờ, gửi khung close kèm mã rồi chờ client đáp (có giới hạn);
//   - cắt hẳn (kill): huỷ ngữ cảnh + đóng net.Conn, mọi lệnh đọc / ghi đang chờ trả lỗi ngay.
type conn struct {
	hub     *Hub
	ws      *websocket.Conn
	netConn net.Conn // net.Conn đã hijack, đóng nó để cắt hẳn
	id      uint64

	ctx        context.Context // huỷ = cắt hẳn
	cancel     context.CancelFunc
	send       chan []byte
	writerDone chan struct{}
	killOnce   sync.Once
	slowLogged atomic.Bool
	logUser    atomic.Int64 // bản sao userID để ghi log từ goroutine bất kỳ

	closeMu     sync.Mutex
	closeReq    bool
	closeCode   websocket.StatusCode
	closeReason string
	closeCh     chan struct{} // đóng khi có yêu cầu đóng êm

	// Do hub.mu bảo vệ; userID / deviceID / authed chỉ ghi một lần trong authConn.
	userID   int64
	deviceID int64
	authed   bool
	subs     map[int64]struct{}
}

func newConn(h *Hub, ws *websocket.Conn, nc net.Conn) *conn {
	c := &conn{
		hub:        h,
		ws:         ws,
		netConn:    nc,
		id:         h.nextConnID.Add(1),
		send:       make(chan []byte, h.o.SendBuffer),
		writerDone: make(chan struct{}),
		closeCh:    make(chan struct{}),
	}
	c.ctx, c.cancel = context.WithCancel(context.Background())
	return c
}

func (c *conn) client() Client {
	return Client{UserID: c.userID, DeviceID: c.deviceID, ConnID: c.id}
}

// enqueue xếp một gói chờ ghi, không bao giờ chặn. Hàng đợi đầy = client đọc không kịp -> cắt kết nối.
func (c *conn) enqueue(b []byte) {
	select {
	case c.send <- b:
	default:
		if c.slowLogged.CompareAndSwap(false, true) {
			logger.Info(logTag, "đóng kết nối chậm của người dùng", c.logUser.Load(), "(hàng đợi gửi đầy)")
		}
		c.kill()
	}
}

// closeWithPacket: xếp gói b (nếu có) rồi yêu cầu đóng êm với mã code. Chỉ yêu cầu đầu tiên có hiệu lực.
func (c *conn) closeWithPacket(b []byte, code websocket.StatusCode, reason string) {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	if c.closeReq {
		return
	}
	c.closeReq, c.closeCode, c.closeReason = true, code, reason
	if b != nil {
		c.enqueue(b)
	}
	close(c.closeCh)
}

func (c *conn) isClosing() bool {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	return c.closeReq || c.ctx.Err() != nil
}

func (c *conn) kill() {
	c.killOnce.Do(func() {
		c.cancel()
		if c.netConn != nil {
			_ = c.netConn.Close()
		}
	})
}

// writeLoop: goroutine ghi duy nhất của kết nối.
func (c *conn) writeLoop() {
	defer close(c.writerDone)
	for {
		select {
		case <-c.ctx.Done():
			return
		case b := <-c.send:
			if !c.write(b) {
				c.kill()
				return
			}
		case <-c.closeCh:
		drain:
			for {
				select {
				case b := <-c.send:
					if !c.write(b) {
						c.kill()
						return
					}
				default:
					break drain
				}
			}
			c.closeMu.Lock()
			code, reason := c.closeCode, c.closeReason
			c.closeMu.Unlock()
			_ = c.ws.Close(code, reason)
			return
		}
	}
}

func (c *conn) write(b []byte) bool {
	ctx, cancel := context.WithTimeout(c.ctx, writeTimeout)
	defer cancel()
	return c.ws.Write(ctx, websocket.MessageText, b) == nil
}

// read đọc một gói; không có gói nào trong IdleTimeout thì thư viện đóng kết nối và trả lỗi.
func (c *conn) read() ([]byte, bool) {
	ctx, cancel := context.WithTimeout(c.ctx, c.hub.o.IdleTimeout)
	defer cancel()
	_, b, err := c.ws.Read(ctx)
	return b, err == nil
}

// readLoop: gói đầu tiên phải là "auth" trong AuthTimeout, sau đó xử lý tuần tự từng gói tới khi kết nối đóng.
func (c *conn) readLoop() {
	timer := time.AfterFunc(c.hub.o.AuthTimeout, func() {
		c.closeWithPacket(nil, CloseAuthTimeout, "auth timeout")
	})
	b, ok := c.read()
	if !timer.Stop() || !ok {
		return // đã quá hạn xác thực (đang đóng 4408) hoặc kết nối đã đứt
	}
	if !c.handleAuth(b) {
		return
	}
	for {
		b, ok := c.read()
		if !ok || c.isClosing() {
			return
		}
		c.dispatch(b)
		if c.isClosing() {
			return
		}
	}
}

// finish (goroutine đọc, khi readLoop kết thúc): chờ goroutine ghi xong bắt tay đóng (nếu đang đóng êm), dọn dẹp,
// gỡ khỏi hub.
func (c *conn) finish() {
	if !c.isClosing() {
		c.kill()
	}
	t := time.NewTimer(closeWait)
	select {
	case <-c.writerDone:
	case <-t.C:
		c.kill()
		<-c.writerDone
	}
	t.Stop()
	c.kill()
	_ = c.ws.CloseNow()
	c.hub.removeConn(c)
}

func (c *conn) sendPacket(typ string, reqID json.RawMessage, data any) {
	b, err := encodePacket(typ, reqID, data)
	if err != nil {
		logger.Error(logTag, "mã hoá gói", typ, "lỗi:", err.Error())
		b, _ = encodePacket(TypeError, reqID, errorData{Code: CodeInternal, Message: msgInternal})
	}
	c.enqueue(b)
}

func (c *conn) sendError(reqID json.RawMessage, e errorData) {
	c.sendPacket(TypeError, reqID, e)
}

func (c *conn) ackIfRequested(reqID json.RawMessage, data any) {
	if reqID == nil {
		return
	}
	if data == nil {
		data = emptyObject
	}
	c.sendPacket(TypeAck, reqID, data)
}

// backendError đổi lỗi Backend thành gói error; lỗi không phải *Error được ghi log (lỗi máy chủ thật).
func backendError(op string, err error) errorData {
	var e *Error
	if !errors.As(err, &e) {
		logger.Error(logTag, op, "lỗi:", err.Error())
	}
	return errorOf(err, CodeInternal, msgInternal)
}

// handleAuth xử lý gói đầu tiên. false = không xác thực được (đã gửi error và yêu cầu đóng 4401).
func (c *conn) handleAuth(b []byte) (ok bool) {
	p, err := parsePacket(b)
	if err != nil {
		c.sendError(p.ReqID, errorData{Code: CodeBadRequest, Message: msgBadRequest})
		c.closeWithPacket(nil, CloseUnauthorized, "bad request")
		return false
	}
	if p.Type != TypeAuth {
		c.sendError(p.ReqID, errorData{Code: CodeUnauthenticated, Message: msgUnauthenticated})
		c.closeWithPacket(nil, CloseUnauthorized, "unauthenticated")
		return false
	}
	fail := func(e errorData) bool {
		c.sendError(p.ReqID, e)
		c.closeWithPacket(nil, CloseUnauthorized, "auth failed")
		return false
	}
	var d authData
	if err := json.Unmarshal(p.Data, &d); err != nil || d.AccessToken == "" {
		return fail(errorData{Code: CodeAuthFailed, Message: msgAuthFailed})
	}

	var uid int64
	func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Error(logTag, "Authenticate panic:", fmt.Sprint(r))
				err = errors.New("panic")
			}
		}()
		ctx, cancel := context.WithTimeout(c.ctx, authCallTimeout)
		defer cancel()
		uid, err = c.hub.backend.Authenticate(ctx, d.AccessToken, int64(d.DeviceID))
	}()
	if err != nil || uid <= 0 {
		return fail(errorOf(err, CodeAuthFailed, msgAuthFailed))
	}

	okb, err := encodePacket(TypeAuthOK, p.ReqID, authOKData{UserID: uid, ServerTime: formatTime(c.hub.now())})
	if err != nil {
		return fail(errorData{Code: CodeInternal, Message: msgInternal})
	}
	ok, revoked := c.hub.authConn(c, uid, int64(d.DeviceID), okb)
	if revoked {
		return fail(errorData{Code: CodeAuthFailed, Message: msgAuthFailed})
	}
	return ok
}

// dispatch xử lý một gói của kết nối đã xác thực.
func (c *conn) dispatch(b []byte) {
	p, err := parsePacket(b)
	if err != nil {
		c.sendError(p.ReqID, errorData{Code: CodeBadRequest, Message: msgBadRequest})
		return
	}
	defer func() {
		if r := recover(); r != nil {
			logger.Error(logTag, "xử lý gói", p.Type, "panic:", fmt.Sprint(r), string(debug.Stack()))
			c.sendError(p.ReqID, errorData{Code: CodeInternal, Message: msgInternal})
		}
	}()
	switch p.Type {
	case TypePing:
		c.sendPacket(TypePong, p.ReqID, nil)
	case TypeAuth:
		c.sendError(p.ReqID, errorData{Code: CodeBadRequest, Message: msgAlreadyAuthed})
	case TypeMessageSend, TypeMessageDelivered, TypeMessageRead:
		c.handleMessage(p)
	case TypeTypingStart, TypeTypingStop:
		c.handleTyping(p)
	case TypePresenceSub:
		c.handlePresenceSub(p)
	default:
		c.sendError(p.ReqID, errorData{Code: CodeUnknownType, Message: msgUnknownType})
	}
}

// handleMessage: gói nghiệp vụ -> Backend.HandleMessage. Ngữ cảnh không gắn với kết nối: client rớt giữa chừng
// thì tin đã tới máy chủ vẫn được lưu (client gửi lại cùng client_msg_id sẽ nhận ack trùng).
func (c *conn) handleMessage(p packetIn) {
	ctx, cancel := context.WithTimeout(c.hub.baseCtx, messageCallTimeout)
	defer cancel()
	ack, err := c.hub.backend.HandleMessage(ctx, c.client(), p.Type, p.Data)
	if err != nil {
		c.sendError(p.ReqID, backendError(p.Type, err))
		return
	}
	c.ackIfRequested(p.ReqID, ack)
}

// handleTyping chuyển typing tới các thành viên khác (không ghi DB). typing.start lặp lại trong 1 giây bị bỏ.
func (c *conn) handleTyping(p packetIn) {
	var d conversationData
	if err := json.Unmarshal(p.Data, &d); err != nil || d.ConversationID <= 0 {
		c.sendError(p.ReqID, errorData{Code: CodeBadRequest, Message: msgBadRequest})
		return
	}
	h, uid, conv := c.hub, c.userID, int64(d.ConversationID)
	start := p.Type == TypeTypingStart
	if start {
		if !h.typingAllow(uid, conv) {
			c.ackIfRequested(p.ReqID, nil)
			return
		}
	} else {
		h.typingReset(uid, conv)
	}
	ctx, cancel := context.WithTimeout(c.ctx, lookupCallTimeout)
	targets, err := h.backend.TypingTargets(ctx, uid, conv)
	cancel()
	if err != nil {
		if p.ReqID != nil {
			c.sendError(p.ReqID, backendError(p.Type, err))
		}
		return
	}
	others := targets[:0:0]
	for _, t := range targets {
		if t != uid {
			others = append(others, t)
		}
	}
	h.SendToUsers(others, TypeTyping, typingData{ConversationID: conv, UserID: uid, IsTyping: start})
	c.ackIfRequested(p.ReqID, nil)
}

// handlePresenceSub thay tập người kết nối này theo dõi (tối đa 100) và gửi ngay trạng thái hiện tại.
func (c *conn) handlePresenceSub(p packetIn) {
	var d presenceSubData
	if err := json.Unmarshal(p.Data, &d); err != nil {
		c.sendError(p.ReqID, errorData{Code: CodeBadRequest, Message: msgBadRequest})
		return
	}
	if len(d.UserIDs) > maxPresenceTargets {
		c.sendError(p.ReqID, errorData{Code: CodeBadRequest, Message: msgTooManyTargets})
		return
	}
	uid := c.userID
	order := make([]int64, 0, len(d.UserIDs))
	seen := make(map[int64]struct{}, len(d.UserIDs))
	for _, v := range d.UserIDs {
		t := int64(v)
		if _, dup := seen[t]; dup || t <= 0 || t == uid {
			continue
		}
		seen[t] = struct{}{}
		order = append(order, t)
	}
	// RevokePresence chạy xen giữa lúc hỏi Backend và lúc đăng ký -> kết quả có thể đã cũ: hỏi lại (tối đa 3 lần;
	// vẫn lệch thì giữ tập cũ, RevokePresence đã gỡ người bị thu hồi khỏi đó)
	for try := 0; try < 3; try++ {
		ep := c.hub.presenceEpoch(uid)
		var allowed map[int64]time.Time
		if len(order) > 0 {
			ctx, cancel := context.WithTimeout(c.ctx, lookupCallTimeout)
			var err error
			allowed, err = c.hub.backend.PresenceInfo(ctx, uid, order)
			cancel()
			if err != nil {
				c.sendError(p.ReqID, backendError(p.Type, err))
				return
			}
		}
		if c.hub.subscribe(c, order, allowed, ep) {
			break
		}
	}
	c.ackIfRequested(p.ReqID, nil)
}

// typingKey: (người gõ, hội thoại) cho bộ chặn typing.start lặp.
type typingKey struct{ user, conv int64 }

func (h *Hub) typingAllow(user, conv int64) bool {
	now := h.now()
	k := typingKey{user, conv}
	h.typingMu.Lock()
	defer h.typingMu.Unlock()
	if last, ok := h.typingLast[k]; ok && now.Sub(last) < typingThrottle && !now.Before(last) {
		return false
	}
	h.typingLast[k] = now
	if now.Sub(h.typingSwept) > 30*time.Second {
		h.typingSwept = now
		for key, at := range h.typingLast {
			if now.Sub(at) >= typingThrottle {
				delete(h.typingLast, key)
			}
		}
	}
	return true
}

func (h *Hub) typingReset(user, conv int64) {
	h.typingMu.Lock()
	delete(h.typingLast, typingKey{user, conv})
	h.typingMu.Unlock()
}
