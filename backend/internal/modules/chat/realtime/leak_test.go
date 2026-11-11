package realtime

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"runtime"
	"runtime/pprof"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// settledGoroutines: số goroutine sau khi ổn định (không đổi trong 200 ms).
func settledGoroutines() int {
	http.DefaultTransport.(*http.Transport).CloseIdleConnections()
	last, stable := runtime.NumGoroutine(), 0
	for i := 0; i < 100 && stable < 4; i++ {
		time.Sleep(50 * time.Millisecond)
		n := runtime.NumGoroutine()
		if n == last {
			stable++
		} else {
			last, stable = n, 0
		}
	}
	return last
}

// Sau Shutdown không còn goroutine nào của hub / kết nối / worker / hàng đợi presence.
func TestNoGoroutineLeakAfterShutdown(t *testing.T) {
	base := settledGoroutines()

	fb := newFakeBackend()
	fb.members[1] = []int64{1, 2, 3}
	h := NewHub(Options{Backend: fb, OfflineGrace: time.Hour, SendBuffer: 8})
	srv := httptest.NewServer(h)

	var clients []*tclient
	for uid := int64(1); uid <= 3; uid++ {
		for d := 0; d < 2; d++ {
			c := connectURL(t, srv.URL)
			c.auth(uid, uid*10+int64(d))
			clients = append(clients, c)
		}
	}
	anon := connectURL(t, srv.URL) // chưa xác thực
	clients = append(clients, anon)

	clients[0].send(TypePresenceSub, "p", map[string]any{"user_ids": []int64{2, 3}})
	clients[0].send(TypeTypingStart, "t", map[string]any{"conversation_id": 1})
	clients[0].send(TypeMessageSend, "m", map[string]any{"content": "chào"})
	for i := 0; i < 100; i++ {
		h.Submit(int64(i), func() { h.SendToUsers([]int64{1, 2, 3}, TypeMessageNew, map[string]int{"i": i}) })
	}
	// Một người rớt hẳn -> timer OfflineGrace đang chờ lúc Shutdown.
	_ = clients[4].ws.Close(websocket.StatusNormalClosure, "")
	_ = clients[5].ws.Close(websocket.StatusNormalClosure, "")
	eventually(t, "user 3 rớt", func() bool { return !h.OnlineUsers([]int64{3})[3] })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.Shutdown(ctx)
	h.Shutdown(ctx)
	for _, c := range clients {
		c.waitClosed()
	}
	srv.Close()

	deadline := time.Now().Add(5 * time.Second)
	n := 0
	for time.Now().Before(deadline) {
		http.DefaultTransport.(*http.Transport).CloseIdleConnections()
		if n = runtime.NumGoroutine(); n <= base {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	var buf bytes.Buffer
	_ = pprof.Lookup("goroutine").WriteTo(&buf, 1)
	t.Fatalf("rò goroutine: trước %d, sau %d\n%s", base, n, buf.String())
}
