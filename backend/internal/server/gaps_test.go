package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/modules/materials"
	"qspro-backend/internal/shared/actor"
)

// Swagger UI gắn bằng app.use('/api-docs', ...): mọi method, mọi đường dẫn con, không phân biệt hoa thường.
// Mã trạng thái / Content-Type / Location lấy từ chạy express + swagger-ui-express thật (nội dung trang là của bản Go).
func TestSwaggerMountLikeNode(t *testing.T) {
	s := newWiredServer(t, nil)
	const htmlCT, redirCT = "text/html; charset=utf-8", "text/html; charset=UTF-8"
	for _, c := range []struct {
		method, path string
		status       int
		ctype, loc   string
	}{
		{"GET", "/api-docs", 301, redirCT, "/api-docs/"},
		{"HEAD", "/api-docs", 301, redirCT, "/api-docs/"},
		{"GET", "/API-Docs?x=1&y=<a>", 301, redirCT, "/API-Docs/?x=1&y=%3Ca%3E"},
		{"POST", "/api-docs", 200, htmlCT, ""},
		{"PUT", "/api-docs", 200, htmlCT, ""},
		{"POST", "/api-docs?a=1", 200, htmlCT, ""},
		{"DELETE", "/api-docs/", 200, htmlCT, ""},
		{"POST", "/api-docs/", 200, htmlCT, ""},
		{"HEAD", "/api-docs/", 200, htmlCT, ""},
		{"GET", "/api-docs/x", 200, htmlCT, ""},
		{"GET", "/api-docs/x/", 200, htmlCT, ""},
		{"POST", "/api-docs/x", 200, htmlCT, ""},
		{"POST", "/API-DOCS/x", 200, htmlCT, ""},
		{"OPTIONS", "/api-docs/x", 200, htmlCT, ""},
		{"POST", "/api-docs/swagger-ui.css", 200, htmlCT, ""},
		{"GET", "/api-docs/package.json", 404, "text/plain; charset=utf-8", ""},
		{"POST", "/api-docs/package.json", 404, "text/plain; charset=utf-8", ""},
		{"GET", "/api-docs/a/package.json", 404, "text/plain; charset=utf-8", ""},
		{"GET", "/api-docs/package.json?x=1", 404, "text/plain; charset=utf-8", ""},
		{"POST", "/api-docs.json", 404, htmlCT, ""},
		{"GET", "/api-docsx", 404, htmlCT, ""},
	} {
		w := do(s, req{method: c.method, path: c.path})
		if w.Code != c.status || w.Header().Get("Content-Type") != c.ctype || w.Header().Get("Location") != c.loc {
			t.Errorf("%s %s: %d %q %q, muốn %d %q %q", c.method, c.path, w.Code, w.Header().Get("Content-Type"),
				w.Header().Get("Location"), c.status, c.ctype, c.loc)
		}
	}
	w := do(s, req{method: "GET", path: "/api-docs"})
	want := "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to /api-docs/</pre>\n</body>\n</html>\n"
	if w.Body.String() != want || w.Header().Get("Content-Security-Policy") != "default-src 'none'" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("trang chuyển hướng: %q %v", w.Body.String(), w.Header())
	}
	if w := do(s, req{method: "GET", path: "/api-docs/package.json"}); w.Body.String() != "Not Found" {
		t.Errorf("package.json: %q", w.Body.String())
	}
	if w := do(s, req{method: "POST", path: "/api-docs/x"}); !strings.Contains(w.Body.String(), "<title>QS Pro API</title>") {
		t.Error("POST /api-docs/x phải trả trang Swagger UI")
	}
	// tắt tài liệu: không còn gì dưới /api-docs
	off := newWiredServer(t, &config.Config{SwaggerDocs: "0"})
	for _, m := range []string{"GET", "POST"} {
		for _, p := range []string{"/api-docs", "/api-docs/x", "/api-docs/package.json"} {
			if w := do(off, req{method: m, path: p}); w.Code != 404 || !strings.Contains(w.Body.String(), "<pre>Cannot "+m+" "+p+"</pre>") {
				t.Errorf("SWAGGER_DOCS=0 %s %s: %d %q", m, p, w.Code, w.Body.String())
			}
		}
	}
}

type demPhien struct{ n atomic.Int64 }

func (d *demPhien) SessionActor(context.Context, string) (*actor.Actor, error) {
	d.n.Add(1)
	return &actor.Actor{UID: "u1", U: "an", R: "staff"}, nil
}

// /media và 3 file mẫu công khai ở Node (không gọi actorOf_): có gửi token cũng không tra phiên.
func TestPublicRootSkipsSession(t *testing.T) {
	s := newWiredServer(t, nil)
	dem := &demPhien{}
	s.deps.Sessions.Set(dem)
	for _, c := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/media", 400},
		{"HEAD", "/media", 400},
		{"GET", "/MEDIA/", 400},
		{"GET", "/mau-nhap-thiet-bi-ve-sinh.xlsx", 200},
		{"GET", "/mau-nhap-cong-tac-o-cam.xlsx", 200},
		{"GET", "/mau-nhap-son-nuoc.xlsx", 200},
		{"GET", "/healthz", 200},
	} {
		w := do(s, req{method: c.method, path: c.path, token: "tok"})
		if w.Code != c.status {
			t.Errorf("%s %s: %d, muốn %d", c.method, c.path, w.Code, c.status)
		}
		if n := dem.n.Load(); n != 0 {
			t.Fatalf("%s %s: route công khai mà tra phiên %d lần", c.method, c.path, n)
		}
	}
	for path := range publicRoot {
		found := false
		for _, r := range RootRoutes {
			found = found || r[1] == path
		}
		if !found {
			t.Errorf("publicRoot có %s không nằm trong RootRoutes", path)
		}
	}
	// route lẻ cần đăng nhập vẫn tra phiên đúng 1 lần
	w := do(s, req{method: "POST", path: "/export/bang", body: `{}`, token: "tok"})
	if n := dem.n.Load(); n != 1 {
		t.Errorf("/export/bang: tra phiên %d lần (status %d), muốn 1", n, w.Code)
	}
	if w := do(s, req{method: "POST", path: "/export/bang", body: `{}`}); w.Code != 401 {
		t.Errorf("/export/bang không token: %d", w.Code)
	}
}

// Thiếu index.html / thư viện bảng tính: báo đủ tên để log lúc khởi động.
func TestMissingStatic(t *testing.T) {
	// không đặt STATIC_DIR (mặc định, không có public/) -> không báo thiếu gì, dù VENDOR_DIR không tồn tại
	if got := MissingStatic(&config.Config{VendorDir: filepath.Join(t.TempDir(), "khong-co")}); got != nil {
		t.Errorf("không đặt STATIC_DIR mà vẫn báo: %v", got)
	}
	dir := t.TempDir()
	cfg := &config.Config{StaticDir: filepath.Join(dir, "public"), VendorDir: filepath.Join(dir, "nm")}
	if got := MissingStatic(cfg); len(got) != 4 || got[0] != filepath.Join(dir, "public", "index.html") {
		t.Fatalf("thiếu hết: %v", got)
	}
	for _, d := range []string{"public", "nm/jspreadsheet-ce/dist", "nm/@jspreadsheet/formula/dist"} {
		if err := os.MkdirAll(filepath.Join(dir, filepath.FromSlash(d)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "public", "index.html"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := MissingStatic(cfg)
	if len(got) != 1 || got[0] != filepath.Join(dir, "nm", "jsuites", "dist") {
		t.Errorf("còn thiếu jsuites: %v", got)
	}
	if err := os.MkdirAll(filepath.Join(dir, "nm", "jsuites", "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := MissingStatic(cfg); len(got) != 0 {
		t.Errorf("đủ rồi mà vẫn báo: %v", got)
	}
}

// Thông báo 413 của /upload/file dựng từ DOC_MAX_MB: hằng của middleware phải bằng hằng của module materials.
func TestDocMaxMBInSync(t *testing.T) {
	if middleware.DocMaxMB != materials.DocMaxMB {
		t.Errorf("middleware.DocMaxMB = %d, materials.DocMaxMB = %d", middleware.DocMaxMB, materials.DocMaxMB)
	}
	// Node: 'File quá lớn (tối đa ' + store.DOC_MAX_MB + 'MB) — hãy dán link thay vì tải lên.'
	if middleware.MsgUploadTooLarge != "File quá lớn (tối đa 300MB) — hãy dán link thay vì tải lên." {
		t.Errorf("thông báo 413: %q", middleware.MsgUploadTooLarge)
	}
}

// RATE_LIMIT_RPS đếm theo IP kết nối; X-Forwarded-For chỉ được tin khi proxy nằm trong TRUSTED_PROXIES.
func TestRateLimitTrustedProxies(t *testing.T) {
	run := func(cfg *config.Config) []int {
		cfg.RateLimit = 1 // burst 2
		s := newWiredServer(t, cfg)
		var codes []int
		for i := 0; i < 4; i++ {
			r := httptest.NewRequest("GET", "/healthz", nil) // RemoteAddr của httptest: 192.0.2.1
			r.Header.Set("X-Forwarded-For", "10.9.8."+string(rune('1'+i)))
			w := httptest.NewRecorder()
			s.Engine().ServeHTTP(w, r)
			codes = append(codes, w.Code)
		}
		return codes
	}
	if c := run(&config.Config{}); c[0] != 200 || c[1] != 200 || c[3] != 429 {
		t.Errorf("không tin proxy: đổi X-Forwarded-For vẫn phải chung một xô, được %v", c)
	}
	if c := run(&config.Config{TrustedProxies: []string{"192.0.2.0/24"}}); c[0] != 200 || c[1] != 200 || c[2] != 200 || c[3] != 200 {
		t.Errorf("tin proxy: mỗi IP client một xô, được %v", c)
	}
	if c := run(&config.Config{TrustedProxies: []string{"10.0.0.0/8"}}); c[3] != 429 {
		t.Errorf("proxy không nằm trong danh sách tin: %v", c)
	}
	if c := run(&config.Config{TrustedProxies: []string{"khong-phai-ip"}}); c[3] != 429 {
		t.Errorf("TRUSTED_PROXIES sai phải thành không tin proxy nào: %v", c)
	}
}

func TestHTTPTimeouts(t *testing.T) {
	s := newWiredServer(t, nil)
	if h := s.http; h.ReadHeaderTimeout != 60*time.Second || h.ReadTimeout != 300*time.Second || h.IdleTimeout != 120*time.Second || h.WriteTimeout != 0 {
		t.Errorf("timeout: header %v, read %v, idle %v, write %v", h.ReadHeaderTimeout, h.ReadTimeout, h.IdleTimeout, h.WriteTimeout)
	}
	var _ http.Handler = s.Engine()
}
