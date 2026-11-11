package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"qspro-backend/internal/config"
)

type wsPacket struct {
	Type  string          `json:"type"`
	ReqID string          `json:"req_id"`
	Data  json.RawMessage `json:"data"`
}

func wsRead(t *testing.T, ctx context.Context, c *websocket.Conn) (*wsPacket, error) {
	t.Helper()
	_, b, err := c.Read(ctx)
	if err != nil {
		return nil, err
	}
	var p wsPacket
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatalf("gói không phải JSON: %s", b)
	}
	return &p, nil
}

func wsDial(ctx context.Context, url, origin string) (*websocket.Conn, *http.Response, error) {
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	return websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: h})
}

// GET /api/v1/chat/ws qua TOÀN BỘ engine (Auth + Tenant của /api/v1, CORS, JSONBody...): nâng cấp WebSocket thật,
// Origin lấy từ CORS_ORIGINS, token sai -> gói error AUTH_FAILED + đóng 4401; tắt server -> "reconnect" + 1012, rồi 503.
func TestChatWebSocketWiring(t *testing.T) {
	s := newWiredServer(t, &config.Config{CORSOrigins: []string{"http://localhost:5199", "http://[::1]:5199"}})
	ts := httptest.NewServer(s.Engine())
	defer ts.Close()
	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/chat/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if got := wsOrigins([]string{"http://localhost:5199", "https://app.dezon.tech/", "http://[::1]:5199", "*", " "}); strings.Join(got, " ") !=
		`localhost:5199 app.dezon.tech \[::1\]:5199 *` {
		t.Errorf("wsOrigins = %q", got)
	}

	// origin không có trong CORS_ORIGINS: từ chối ngay ở bước bắt tay
	if c, resp, err := wsDial(ctx, url, "http://evil.example"); err == nil {
		c.CloseNow()
		t.Error("origin lạ mà vẫn nâng cấp được")
	} else if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Errorf("origin lạ: %v %v", resp, err)
	}

	// cùng host với API (không gửi Origin = client không phải trình duyệt) + 2 origin khai trong CORS_ORIGINS
	for _, origin := range []string{"", "http://localhost:5199", "http://[::1]:5199"} {
		c, resp, err := wsDial(ctx, url, origin)
		if err != nil {
			t.Fatalf("origin %q: không nâng cấp được: %v", origin, err)
		}
		if resp.StatusCode != http.StatusSwitchingProtocols {
			t.Errorf("origin %q: mã %d", origin, resp.StatusCode)
		}
		// đã nâng cấp thì middleware QS (Auth với header Authorization) không chen vào; gói đầu tiên là auth
		if err := c.Write(ctx, websocket.MessageText, []byte(`{"type":"auth","req_id":"a1","data":{"access_token":"x.y.z","device_id":1}}`)); err != nil {
			t.Fatal(err)
		}
		p, err := wsRead(t, ctx, c)
		if err != nil || p.Type != "error" || p.ReqID != "a1" || !strings.Contains(string(p.Data), `"code":"AUTH_FAILED"`) {
			t.Errorf("origin %q: token sai phải nhận error AUTH_FAILED, được %+v %v", origin, p, err)
		}
		if _, err := wsRead(t, ctx, c); websocket.CloseStatus(err) != 4401 {
			t.Errorf("origin %q: phải đóng 4401, được %v", origin, err)
		}
		c.CloseNow()
	}

	// không phải yêu cầu WebSocket: hub trả lỗi của thư viện, không phải 404 / thân chặn của QS
	if w := hit(s, "GET", "/api/v1/chat/ws", ""); w.Code == 404 || denyBodies[w.Body.String()] || w.Code < 400 {
		t.Errorf("GET thường vào /chat/ws: %d %s", w.Code, w.Body.String())
	}

	// tắt server: việc OnShutdownFirst (hub) chạy trước http.Server.Shutdown -> client nhận reconnect rồi đóng 1012
	c, _, err := wsDial(ctx, url, "http://localhost:5199")
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	if len(s.drain) == 0 {
		t.Fatal("chưa đăng ký tắt gateway chat bằng OnShutdownFirst")
	}
	go func() {
		for _, fn := range s.drain {
			fn(ctx)
		}
	}()
	p, err := wsRead(t, ctx, c)
	if err != nil || p.Type != "reconnect" {
		t.Errorf("tắt server: phải nhận reconnect, được %+v %v", p, err)
	}
	if _, err := wsRead(t, ctx, c); websocket.CloseStatus(err) != websocket.StatusServiceRestart {
		t.Errorf("tắt server: phải đóng 1012, được %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		c2, resp, err := wsDial(ctx, url, "")
		if err != nil && resp != nil && resp.StatusCode == http.StatusServiceUnavailable {
			break
		}
		if c2 != nil {
			c2.CloseNow()
		}
		if time.Now().After(deadline) {
			t.Fatalf("sau khi tắt gateway phải trả 503: %v %v", resp, err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	// việc OnShutdown (chatSvc.Shutdown: gateway đã tắt + dừng worker push) không được treo
	done := make(chan struct{})
	go func() {
		for _, fn := range s.stop {
			fn(ctx)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("OnShutdown của chat treo")
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatal("hết giờ")
	}
}
