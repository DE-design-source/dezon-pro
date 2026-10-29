package server

import (
	"crypto/sha1"
	"encoding/hex"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qspro-backend/internal/config"
)

// 6 file trước đây nằm trong public/ của app Node (+ dl-spec.js của ngành Điện lạnh, chỉ bản Go): phục vụ từ binary, đúng từng byte bản cuối trong git
// (mã blob của git = sha1("blob <độ dài>\x00" + nội dung)), đúng Content-Type / Cache-Control như express.static.
var embeddedWant = []struct{ path, blob, ctype, cache string }{
	{"/vs-spec.js", "4e4e1251b21ae70fe0f329c9e196b6e9607ff3dd", "application/javascript; charset=UTF-8", "no-cache"},
	{"/son-spec.js", "5ea484e438ccddc6af67ea895e058fdfc5c92f26", "application/javascript; charset=UTF-8", "no-cache"},
	{"/ct-spec.js", "4e5fe093f783c1c37c5c4ba92af822af942c1d54", "application/javascript; charset=UTF-8", "no-cache"},
	{"/dl-spec.js", "2e3b7652d6e4592025b928a64a2a0687d3ca42cd", "application/javascript; charset=UTF-8", "no-cache"}, // chép từ QS Pro ea787b6 (chỉ bản Go)
	{"/logo.svg", "37a0c5cdd5f94eefb3d8d45b99fe3a57194e7b7f", "image/svg+xml", "public, max-age=0"},
	{"/mau-nhap-hang-loat.xlsx", "ab186d8a9b83398a31bf0e5520a3001896497d4c",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "public, max-age=0"},
	{"/mau-nhap-cong-tac.xlsx", "079fb9212aafddf642810cedfb2afdbc59d15080",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "public, max-age=0"},
}

func gitBlob(b []byte) string {
	h := sha1.New()
	h.Write([]byte("blob " + strconv.Itoa(len(b)) + "\x00"))
	h.Write(b)
	return hex.EncodeToString(h.Sum(nil))
}

func TestEmbeddedAssets(t *testing.T) {
	// không có STATIC_DIR (public/ đã bỏ): vẫn phục vụ đủ 7 file, "/" thì 404
	s := New(&Deps{Cfg: &config.Config{AppVer: "ver-1", VendorDir: filepath.Join(t.TempDir(), "khong-co")}})
	if len(s.assets) != len(embeddedWant) {
		t.Errorf("có %d file nhúng, muốn %d", len(s.assets), len(embeddedWant))
	}
	for _, f := range embeddedWant {
		w := do(s, req{method: "GET", path: f.path})
		if w.Code != 200 || gitBlob(w.Body.Bytes()) != f.blob {
			t.Errorf("%s: %d, blob %s, muốn %s", f.path, w.Code, gitBlob(w.Body.Bytes()), f.blob)
		}
		h := w.Header()
		if h.Get("Content-Type") != f.ctype || h.Get("Cache-Control") != f.cache || h.Get("Accept-Ranges") != "bytes" ||
			h.Get("ETag") == "" || h.Get("Content-Length") != strconv.Itoa(w.Body.Len()) {
			t.Errorf("%s header: %v", f.path, h)
		}
		if w2 := do(s, req{method: "GET", path: f.path, hdr: map[string]string{"If-None-Match": h.Get("ETag")}}); w2.Code != 304 {
			t.Errorf("%s If-None-Match: %d, muốn 304", f.path, w2.Code)
		}
		if w2 := do(s, req{method: "GET", path: f.path, hdr: map[string]string{"If-None-Match": h.Get("ETag"), "Cache-Control": "no-cache"}}); w2.Code != 200 {
			t.Errorf("%s no-cache: %d, muốn 200", f.path, w2.Code)
		}
		if w2 := do(s, req{method: "HEAD", path: f.path}); w2.Code != 200 || w2.Body.Len() != 0 || w2.Header().Get("Content-Type") != f.ctype {
			t.Errorf("%s HEAD: %d %d", f.path, w2.Code, w2.Body.Len())
		}
		if w2 := do(s, req{method: "GET", path: f.path, hdr: map[string]string{"Range": "bytes=0-3"}}); w2.Code != 206 || w2.Body.Len() != 4 {
			t.Errorf("%s Range: %d %d", f.path, w2.Code, w2.Body.Len())
		}
		if w2 := do(s, req{method: "POST", path: f.path}); w2.Code != 404 {
			t.Errorf("POST %s: %d, muốn 404", f.path, w2.Code)
		}
	}
	for _, p := range []string{"/", "/index.html", "/app.js", "/vendor/jsuites/jsuites.js", "/vs-spec.js/", "/js/vs-spec.js"} {
		if w := do(s, req{method: "GET", path: p}); w.Code != 404 {
			t.Errorf("%s phải 404 khi không có STATIC_DIR, được %d", p, w.Code)
		}
	}
	// đường dẫn có đoạn "." / ".." / "//" (client gửi thô): chuẩn hoá như send; leo khỏi gốc thì không phục vụ
	raw := func(p string) *httptest.ResponseRecorder {
		q := httptest.NewRequest("GET", "/", nil)
		q.URL.Path, q.URL.RawPath, q.RequestURI = p, "", p
		w := httptest.NewRecorder()
		s.Engine().ServeHTTP(w, q)
		return w
	}
	for p, want := range map[string]int{
		"/./vs-spec.js": 200, "/x/../vs-spec.js": 200, "//logo.svg": 200, "/a/b/../../ct-spec.js": 200,
		"/../vs-spec.js": 404, "/x/../../vs-spec.js": 404, "/./vs-spec.js/": 404, "/vs-spec.js\x00": 404,
	} {
		w := raw(p)
		if w.Code != want {
			t.Errorf("%q: %d, muốn %d", p, w.Code, want)
		}
		if want == 200 && w.Header().Get("Content-Type") == "" {
			t.Errorf("%q: thiếu Content-Type", p)
		}
	}
	if w := raw("/x/../vs-spec.js"); gitBlob(w.Body.Bytes()) != embeddedWant[0].blob {
		t.Errorf("/x/../vs-spec.js không phải bản nhúng")
	}
}

// Có STATIC_DIR chứa bản cũ / khác: bản nhúng vẫn thắng (nguồn duy nhất); file khác của STATIC_DIR vẫn phục vụ.
func TestEmbeddedAssetsBeatStaticDir(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"vs-spec.js", "logo.svg", "khac.js"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("cu"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := New(&Deps{Cfg: &config.Config{AppVer: "ver-1", StaticDir: dir, VendorDir: dir}})
	for _, p := range []string{"/vs-spec.js", "/logo.svg"} {
		if w := do(s, req{method: "GET", path: p}); w.Code != 200 || w.Body.String() == "cu" {
			t.Errorf("%s: phải là bản nhúng (%d %q)", p, w.Code, w.Body.String())
		}
	}
	if w := do(s, req{method: "GET", path: "/khac.js"}); w.Code != 200 || w.Body.String() != "cu" {
		t.Errorf("/khac.js từ STATIC_DIR: %d %q", w.Code, w.Body.String())
	}
}
