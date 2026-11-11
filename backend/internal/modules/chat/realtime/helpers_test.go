package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"qspro-backend/internal/platform/logger"
)

const waitStep = 3 * time.Second // thời gian chờ tối đa một gói / một sự kiện trong test

// TestMain tắt log của gateway (panic giả, client chậm...) trừ khi chạy -v.
func TestMain(m *testing.M) {
	flag.Parse()
	if !testing.Verbose() {
		logger.SetDefault(logger.New(io.Discard, io.Discard))
	}
	os.Exit(m.Run())
}

// ---- Backend giả ----

type presenceCall struct {
	userID int64
	online bool
	at     time.Time
}

type handledCall struct {
	client Client
	typ    string
	data   string
}

// fakeBackend: token "u<id>" hợp lệ cho người dùng id; "bad" -> lỗi thường; "expired" -> *Error TOKEN_EXPIRED.
type fakeBackend struct {
	mu       sync.Mutex
	handle   func(c Client, typ string, data json.RawMessage) (any, error)
	members  map[int64][]int64                                       // hội thoại -> thành viên (TypingTargets)
	allow    func(viewer int64, targets []int64) map[int64]time.Time // nil = cho xem tất cả, last_seen rỗng
	presence []presenceCall
	handled  []handledCall
	presCh   chan presenceCall
}

func newFakeBackend() *fakeBackend {
	return &fakeBackend{members: map[int64][]int64{}, presCh: make(chan presenceCall, 1000)}
}

func (f *fakeBackend) Authenticate(_ context.Context, token string, _ int64) (int64, error) {
	switch {
	case token == "expired":
		return 0, &Error{Code: "TOKEN_EXPIRED", Message: "Phiên đã hết hạn"}
	case strings.HasPrefix(token, "u"):
		id, err := strconv.ParseInt(token[1:], 10, 64)
		if err == nil && id > 0 {
			return id, nil
		}
	}
	return 0, errors.New("token sai")
}

func (f *fakeBackend) HandleMessage(_ context.Context, c Client, typ string, data json.RawMessage) (any, error) {
	f.mu.Lock()
	f.handled = append(f.handled, handledCall{client: c, typ: typ, data: string(data)})
	h := f.handle
	f.mu.Unlock()
	if h == nil {
		return nil, nil
	}
	return h(c, typ, data)
}

func (f *fakeBackend) TypingTargets(_ context.Context, userID, conversationID int64) ([]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ms := f.members[conversationID]
	for _, m := range ms {
		if m == userID {
			out := make([]int64, 0, len(ms))
			for _, x := range ms {
				if x != userID {
					out = append(out, x)
				}
			}
			return out, nil
		}
	}
	return nil, &Error{Code: "FORBIDDEN", Message: "Không phải thành viên"}
}

func (f *fakeBackend) PresenceInfo(_ context.Context, userID int64, targets []int64) (map[int64]time.Time, error) {
	f.mu.Lock()
	allow := f.allow
	f.mu.Unlock()
	if allow != nil {
		return allow(userID, targets), nil
	}
	out := map[int64]time.Time{}
	for _, t := range targets {
		out[t] = time.Time{}
	}
	return out, nil
}

func (f *fakeBackend) PresenceChanged(userID int64, online bool, at time.Time) {
	f.mu.Lock()
	f.presence = append(f.presence, presenceCall{userID, online, at})
	f.mu.Unlock()
	f.presCh <- presenceCall{userID, online, at}
}

func (f *fakeBackend) presenceOf(uid int64) []presenceCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []presenceCall
	for _, p := range f.presence {
		if p.userID == uid {
			out = append(out, p)
		}
	}
	return out
}

func (f *fakeBackend) handledCalls() []handledCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]handledCall(nil), f.handled...)
}

// ---- máy chủ test ----

func newHubServer(t *testing.T, o Options) (*Hub, *httptest.Server, *fakeBackend) {
	t.Helper()
	fb := newFakeBackend()
	if o.Backend == nil {
		o.Backend = fb
	}
	h := NewHub(o)
	srv := httptest.NewServer(h)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		h.Shutdown(ctx)
		srv.Close()
	})
	return h, srv, fb
}

// ---- client test: goroutine đọc riêng đẩy gói vào channel, test chờ bằng select có hạn ----

type tpkt struct {
	Type  string          `json:"type"`
	ReqID json.RawMessage `json:"req_id"`
	Data  json.RawMessage `json:"data"`
}

func (p tpkt) reqID() string {
	var s string
	_ = json.Unmarshal(p.ReqID, &s)
	return s
}

func (p tpkt) decode(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(p.Data, v); err != nil {
		t.Fatalf("data của %s không đọc được: %v (%s)", p.Type, err, p.Data)
	}
}

type tclient struct {
	t    *testing.T
	ws   *websocket.Conn
	in   chan tpkt
	done chan struct{}
	err  error // lỗi kết thúc goroutine đọc (đọc sau khi done đóng)
}

func dialRaw(t *testing.T, url string, hdr http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), waitStep)
	defer cancel()
	ws, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: hdr})
	if ws != nil {
		ws.SetReadLimit(1 << 20)
		t.Cleanup(func() { _ = ws.CloseNow() })
	}
	return ws, resp, err
}

func connectURL(t *testing.T, url string) *tclient {
	t.Helper()
	ws, _, err := dialRaw(t, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return startClient(t, ws)
}

func connect(t *testing.T, srv *httptest.Server) *tclient {
	t.Helper()
	return connectURL(t, srv.URL)
}

func startClient(t *testing.T, ws *websocket.Conn) *tclient {
	c := &tclient{t: t, ws: ws, in: make(chan tpkt, 4096), done: make(chan struct{})}
	go func() {
		defer close(c.done)
		for {
			_, b, err := ws.Read(context.Background())
			if err != nil {
				c.err = err
				return
			}
			var p tpkt
			if err := json.Unmarshal(b, &p); err != nil {
				c.err = err
				return
			}
			c.in <- p
		}
	}()
	return c
}

func (c *tclient) sendRaw(b []byte) {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), waitStep)
	defer cancel()
	if err := c.ws.Write(ctx, websocket.MessageText, b); err != nil {
		c.t.Fatalf("ghi gói: %v", err)
	}
}

// send gửi gói; reqID rỗng = không có req_id.
func (c *tclient) send(typ, reqID string, data any) {
	c.t.Helper()
	m := map[string]any{"type": typ}
	if reqID != "" {
		m["req_id"] = reqID
	}
	if data != nil {
		m["data"] = data
	}
	b, _ := json.Marshal(m)
	c.sendRaw(b)
}

func (c *tclient) next() tpkt {
	c.t.Helper()
	select {
	case p := <-c.in:
		return p
	case <-c.done:
		select {
		case p := <-c.in:
			return p
		default:
		}
		c.t.Fatalf("kết nối đã đóng khi đang chờ gói: %v", c.err)
	case <-time.After(waitStep):
		c.t.Fatalf("quá hạn chờ gói")
	}
	return tpkt{}
}

func (c *tclient) expect(typ string) tpkt {
	c.t.Helper()
	p := c.next()
	if p.Type != typ {
		c.t.Fatalf("chờ gói %q, nhận %q: %s", typ, p.Type, p.Data)
	}
	return p
}

// ping: gói kế tiếp phải là pong - nghĩa là không có gói nào khác đang chờ trước nó.
func (c *tclient) ping() {
	c.t.Helper()
	c.send(TypePing, "", nil)
	c.expect(TypePong)
}

// waitClosed chờ kết nối đóng, trả lỗi đọc cuối cùng (dùng websocket.CloseStatus để lấy mã).
func (c *tclient) waitClosed() error {
	c.t.Helper()
	select {
	case <-c.done:
		return c.err
	case <-time.After(waitStep):
		c.t.Fatalf("kết nối không đóng")
	}
	return nil
}

func (c *tclient) expectCloseCode(code websocket.StatusCode) {
	c.t.Helper()
	err := c.waitClosed()
	if got := websocket.CloseStatus(err); got != code {
		c.t.Fatalf("mã đóng = %v, muốn %v (lỗi: %v)", got, code, err)
	}
}

func (c *tclient) auth(uid, device int64) tpkt {
	c.t.Helper()
	c.send(TypeAuth, "a", map[string]any{"access_token": "u" + strconv.FormatInt(uid, 10), "device_id": device})
	return c.expect(TypeAuthOK)
}

func authed(t *testing.T, srv *httptest.Server, uid, device int64) *tclient {
	t.Helper()
	c := connect(t, srv)
	c.auth(uid, device)
	return c
}

// eventually lặp cond tới khi đúng hoặc hết hạn.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(waitStep)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("hết hạn chờ: %s", what)
}
