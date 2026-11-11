package realtime

import (
	"bufio"
	"net"
	"net/http"
	"time"
)

// hijackWriter bọc ResponseWriter để Hijack() xoá hạn đọc / ghi của net.Conn. http.Server của app đặt
// ReadTimeout 300 giây (internal/server/server.go); hạn đó gắn vào net.Conn và còn nguyên sau khi hijack ở một số
// bản Go, khiến mọi kết nối WebSocket bị cắt sau 5 phút. Bọc thêm giữ nguyên các khả năng khác của writer gốc:
// Unwrap (http.ResponseController), Flush, và WriteHeaderNow của gin (thư viện websocket gọi nó để gin ghi dòng
// trạng thái 101 trước khi hijack).
type hijackWriter struct {
	http.ResponseWriter
	conn net.Conn // kết nối đã hijack; chỉ ghi một lần trong Accept, đọc sau khi Accept trả về
}

func (w *hijackWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *hijackWriter) Flush() { _ = http.NewResponseController(w.ResponseWriter).Flush() }

func (w *hijackWriter) WriteHeaderNow() {
	if g, ok := w.ResponseWriter.(interface{ WriteHeaderNow() }); ok {
		g.WriteHeaderNow()
	}
}

// Hijack thử từ writer ngoài cùng vào trong theo Unwrap: gin >= 1.11 từ chối hijack sau WriteHeaderNow
// ("response already written") dù dòng 101 chưa ra mạng, khi đó hijack thẳng writer của net/http bên dưới
// (nó tự ghi dòng 101 đang chờ trước khi trao kết nối).
func (w *hijackWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	var err error = http.ErrNotSupported
	for rw := w.ResponseWriter; rw != nil; {
		if hj, ok := rw.(http.Hijacker); ok {
			var nc net.Conn
			var brw *bufio.ReadWriter
			if nc, brw, err = hj.Hijack(); err == nil {
				_ = nc.SetDeadline(time.Time{})
				w.conn = nc
				return nc, brw, nil
			}
		}
		u, ok := rw.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			break
		}
		rw = u.Unwrap()
	}
	return nil, nil, err
}

// canHijack: writer (hoặc writer nó bọc qua Unwrap) có hijack được không - giống cách thư viện websocket dò.
func canHijack(w http.ResponseWriter) bool {
	for {
		switch t := w.(type) {
		case http.Hijacker:
			return true
		case interface{ Unwrap() http.ResponseWriter }:
			w = t.Unwrap()
		default:
			return false
		}
	}
}
