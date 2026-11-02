package realtime

import (
	"bufio"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// fakeHijackRW: ResponseWriter hijack được, trả một net.Conn thật đã bị đặt hạn đọc (như http.Server với ReadTimeout).
type fakeHijackRW struct {
	*httptest.ResponseRecorder
	nc       net.Conn
	headerUp bool
}

func (f *fakeHijackRW) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return f.nc, bufio.NewReadWriter(bufio.NewReader(f.nc), bufio.NewWriter(f.nc)), nil
}

func (f *fakeHijackRW) WriteHeaderNow() { f.headerUp = true }

// unwrapRW: writer bọc kiểu middleware, chỉ lộ Unwrap.
type unwrapRW struct{ inner http.ResponseWriter }

func (u unwrapRW) Header() http.Header         { return u.inner.Header() }
func (u unwrapRW) Write(b []byte) (int, error) { return u.inner.Write(b) }
func (u unwrapRW) WriteHeader(code int)        { u.inner.WriteHeader(code) }
func (u unwrapRW) Unwrap() http.ResponseWriter { return u.inner }

func tcpPair(t *testing.T) (server, client net.Conn) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	client, err = net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	server, err = ln.Accept()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close(); client.Close() })
	return server, client
}

func TestHijackWriterClearsDeadline(t *testing.T) {
	sc, cc := tcpPair(t)
	_ = sc.SetDeadline(time.Now().Add(100 * time.Millisecond))
	inner := &fakeHijackRW{ResponseRecorder: httptest.NewRecorder(), nc: sc}
	w := &hijackWriter{ResponseWriter: inner}

	nc, _, err := w.Hijack()
	if err != nil || nc != sc || w.conn != sc {
		t.Fatalf("Hijack: %v", err)
	}
	time.Sleep(250 * time.Millisecond) // quá hạn cũ
	if _, err := cc.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 1)
	if n, err := nc.Read(buf); err != nil || n != 1 {
		t.Fatalf("đọc sau hijack vẫn dính hạn cũ: n=%d err=%v", n, err)
	}
	if _, err := nc.Write([]byte("y")); err != nil {
		t.Fatalf("ghi sau hijack vẫn dính hạn cũ: %v", err)
	}

	// Các khả năng khác của writer gốc vẫn còn.
	w.WriteHeaderNow()
	if !inner.headerUp {
		t.Fatal("WriteHeaderNow không chuyển tiếp")
	}
	if w.Unwrap() != inner {
		t.Fatal("Unwrap sai")
	}
	rec := httptest.NewRecorder()
	(&hijackWriter{ResponseWriter: rec}).Flush()
	if !rec.Flushed {
		t.Fatal("Flush không chuyển tiếp")
	}
	if canHijack(rec) || !canHijack(inner) || !canHijack(unwrapRW{inner}) || canHijack(unwrapRW{rec}) {
		t.Fatal("canHijack sai")
	}
	if _, _, err := (&hijackWriter{ResponseWriter: rec}).Hijack(); err == nil {
		t.Fatal("writer không hijack được phải trả lỗi")
	}
}

// refuseRW: như gin >= 1.11 - từ chối Hijack sau WriteHeaderNow, Unwrap tới writer hijack được.
type refuseRW struct{ unwrapRW }

func (refuseRW) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, errors.New("gin: response already written")
}

func TestHijackWriterFallsBackToInner(t *testing.T) {
	sc, _ := tcpPair(t)
	inner := &fakeHijackRW{ResponseRecorder: httptest.NewRecorder(), nc: sc}
	w := &hijackWriter{ResponseWriter: refuseRW{unwrapRW{inner}}}
	if nc, _, err := w.Hijack(); err != nil || nc != sc {
		t.Fatalf("không hijack được writer bên trong: %v", err)
	}
	only := &hijackWriter{ResponseWriter: refuseRW{unwrapRW{httptest.NewRecorder()}}}
	if _, _, err := only.Hijack(); err == nil || err.Error() != "gin: response already written" {
		t.Fatalf("lỗi trả về = %v", err)
	}
}

// http.Server có ReadTimeout / WriteTimeout 1 giây (như ReadTimeout 300 giây của app): kết nối WebSocket vẫn sống > 3 giây,
// qua cả mux chuẩn lẫn gin (gin cần WriteHeaderNow để gửi 101 trước khi hijack).
func TestServerTimeoutsDoNotKillWebSocket(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, viaGin := range []bool{false, true} {
		name := "net/http"
		if viaGin {
			name = "gin"
		}
		t.Run(name, func(t *testing.T) {
			fb := newFakeBackend()
			h := NewHub(Options{Backend: fb})
			var handler http.Handler = h
			path := ""
			if viaGin {
				e := gin.New()
				e.GET("/api/v1/chat/ws", func(c *gin.Context) { h.ServeHTTP(c.Writer, c.Request) })
				handler, path = e, "/api/v1/chat/ws"
			}
			srv := httptest.NewUnstartedServer(handler)
			srv.Config.ReadTimeout = time.Second
			srv.Config.WriteTimeout = time.Second
			srv.Start()
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				h.Shutdown(ctx)
				srv.Close()
			})

			c := connectURL(t, srv.URL+path)
			c.auth(1, 1)
			start := time.Now()
			for time.Since(start) < 3500*time.Millisecond {
				time.Sleep(250 * time.Millisecond)
				c.ping()
			}
			h.SendToUsers([]int64{1}, TypeMessageNew, map[string]int{"seq": 1})
			c.expect(TypeMessageNew)
		})
	}
}
