package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qspro-backend/internal/config"
)

// /files/<path>: phục vụ file của kho UPLOAD_DIR, công khai (không tra phiên), 404 khi thiếu / thư mục / leo khỏi kho.
func TestUploadsRoute(t *testing.T) {
	base := t.TempDir()
	s := newWiredServer(t, &config.Config{UploadDir: filepath.Join(base, "kho")})
	dem := &demPhien{}
	s.deps.Sessions.Set(dem)
	if err := os.WriteFile(filepath.Join(base, "bi-mat.png"), []byte("bi-mat"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	up := func(p, body string) string {
		u, err := s.deps.Storage.Upload(ctx, []byte(body), p, "")
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	uPng := up("sp/ảnh 1.png", "png-data")
	uSvg := up("sp/1.svg+xml", "<svg/>")
	uHTML := up("docs/1-x.html", "<script>1</script>")
	uDocx := up("docs/1-bao-gia.docx", "PK")

	w := do(s, req{method: "GET", path: uPng, token: "tok"})
	h := w.Header()
	if w.Code != 200 || w.Body.String() != "png-data" || h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
		h.Get("Cache-Control") != "public, max-age=86400" || h.Get("Last-Modified") == "" || h.Get("Content-Security-Policy") != "" {
		t.Errorf("GET %s: %d %q %v", uPng, w.Code, w.Body.String(), h)
	}
	if w := do(s, req{method: "HEAD", path: uPng}); w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") != "8" {
		t.Errorf("HEAD: %d %q %v", w.Code, w.Body.String(), w.Header())
	}
	if w := do(s, req{method: "GET", path: uPng, hdr: map[string]string{"Range": "bytes=0-2"}}); w.Code != 206 || w.Body.String() != "png" {
		t.Errorf("Range: %d %q", w.Code, w.Body.String())
	}
	if w := do(s, req{method: "GET", path: uPng, hdr: map[string]string{"If-Modified-Since": h.Get("Last-Modified")}}); w.Code != 304 {
		t.Errorf("If-Modified-Since: %d", w.Code)
	}
	if n := dem.n.Load(); n != 0 {
		t.Errorf("/files tra phiên %d lần", n)
	}
	if w := do(s, req{method: "GET", path: uSvg}); w.Header().Get("Content-Type") != "image/svg+xml" ||
		!strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Errorf("svg: %v", w.Header())
	}
	// ngoài bảng kiểu: không bao giờ trả text/html
	if w := do(s, req{method: "GET", path: uHTML}); w.Code != 200 || w.Header().Get("Content-Type") != "application/octet-stream" {
		t.Errorf("html: %d %v", w.Code, w.Header())
	}
	if w := do(s, req{method: "GET", path: uDocx}); !strings.HasPrefix(w.Header().Get("Content-Type"), "application/vnd.openxmlformats-officedocument.wordprocessingml") {
		t.Errorf("docx: %v", w.Header())
	}

	for _, p := range []string{"/files/sp/khong-co.png", "/files/", "/files", "/files/sp", "/files/sp/", "/files/../bi-mat.png",
		"/files/%2e%2e/bi-mat.png", "/files/sp/..%2F..%2Fbi-mat.png", "/files/..%5Cbi-mat.png", "/files//bi-mat.png",
		"/files/" + filepath.ToSlash(filepath.Join(base, "bi-mat.png"))} {
		for _, m := range []string{"GET", "HEAD"} {
			if w := do(s, req{method: m, path: p}); w.Code != 404 || w.Body.String() == "bi-mat" {
				t.Errorf("%s %s: %d %q", m, p, w.Code, w.Body.String())
			}
		}
	}
	if w := do(s, req{method: "POST", path: uPng, body: `{}`}); w.Code != 404 {
		t.Errorf("POST: %d", w.Code)
	}
}
