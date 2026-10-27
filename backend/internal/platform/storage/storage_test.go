package storage

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestUpload(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "kho") // chưa có: lần ghi đầu tự tạo
	s := New(dir)
	url, err := s.Upload(context.Background(), []byte("abc"), "sp/ảnh 1.png", "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if want := "/files/sp/%E1%BA%A3nh%201.png"; url != want {
		t.Errorf("url:\n got %s\nwant %s", url, want)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "sp", "ảnh 1.png")); err != nil || string(b) != "abc" {
		t.Errorf("file trên đĩa: %q %v", b, err)
	}
	// ghi đè, không để lại file tạm
	if _, err := s.Upload(context.Background(), []byte("xyz"), "sp/ảnh 1.png", ""); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "sp", "ảnh 1.png")); string(b) != "xyz" {
		t.Errorf("ghi đè: %q", b)
	}
	if es, _ := os.ReadDir(filepath.Join(dir, "sp")); len(es) != 1 {
		t.Errorf("thư mục sp có %d mục, muốn 1", len(es))
	}
	if got := s.PublicURL("docs/a+b#c?.pdf"); got != "/files/docs/a%2Bb%23c%3F.pdf" {
		t.Errorf("PublicURL: %s", got)
	}
	if New("").Dir() != DefaultDir || DefaultDir != "uploads" {
		t.Error("thư mục mặc định sai")
	}
}

// Đường dẫn sai không được ghi ra đĩa, kể cả ra ngoài thư mục kho.
func TestUploadPathSai(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "kho")
	s := New(dir)
	for _, p := range []string{"", ".", "..", "../x.png", "sp/../../x.png", "/x.png", "sp//x.png", "sp/", `sp\x.png`,
		`..\x.png`, "C:/x.png", "a:b.png", "sp/.an.png", ".tmp", "x\x00.png"} {
		if _, err := s.Upload(context.Background(), []byte("a"), p, ""); err == nil || err.Error() != "Đường dẫn file không hợp lệ" {
			t.Errorf("%q: %v", p, err)
		}
	}
	if es, _ := os.ReadDir(base); len(es) != 0 {
		t.Errorf("đường dẫn sai mà vẫn ghi: %v", es)
	}
}

// Lỗi đĩa: thông báo chung, không lộ đường dẫn của máy chủ.
func TestUploadLoiDia(t *testing.T) {
	f := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(f, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := New(f).Upload(context.Background(), []byte("a"), "sp/a.png", "")
	if err == nil || err.Error() != "Không lưu được file lên máy chủ" {
		t.Errorf("lỗi: %v", err)
	}
}

func TestReadURL(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "kho")
	s := New(dir)
	if err := os.WriteFile(filepath.Join(base, "bi-mat.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	url, err := s.Upload(context.Background(), []byte("12345"), "sp/ảnh 1.png", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{url, url + "?v=2", url + "#x", "/files/sp/ảnh 1.png", "/files/sp%2F%E1%BA%A3nh%201.png"} {
		if b, err := s.ReadURL(u, 5); err != nil || string(b) != "12345" {
			t.Errorf("%s: %q %v", u, b, err)
		}
	}
	if _, err := s.ReadURL(url, 4); err == nil {
		t.Error("lớn hơn max phải lỗi")
	}
	for _, u := range []string{"/files/sp/khong-co.png", "/files/sp", "/files/", "/files/../bi-mat.png", "/files/%2e%2e/bi-mat.png",
		"/files/sp/..%2F..%2Fbi-mat.png", "/files/sp/%ZZ.png", "/media?token=x", "https://x.vn/files/sp/a.png", "files/sp/a.png"} {
		if b, err := s.ReadURL(u, 100); err == nil {
			t.Errorf("%s: phải lỗi, được %q", u, b)
		}
	}
	if _, _, err := s.Open("sp"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("mở thư mục: %v", err)
	}
}

// Symlink trỏ ra ngoài kho không đọc được (os.Root).
func TestOpenSymlinkRaNgoai(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "kho")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	ngoai := filepath.Join(base, "bi-mat.png")
	if err := os.WriteFile(ngoai, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(ngoai, filepath.Join(dir, "link.png")); err != nil {
		t.Skip("không tạo được symlink:", err)
	}
	if _, _, err := New(dir).Open("link.png"); err == nil {
		t.Error("symlink ra ngoài kho mà vẫn mở được")
	}
}

func TestValidPath(t *testing.T) {
	for p, want := range map[string]bool{"sp/1-2.jpg": true, "docs/123-tai-lieu.pdf": true, "sp/1.svg+xml": true, "a": true,
		"": false, "sp/../a": false, "sp/./a": false, "/a": false, "a/": false, "a//b": false, `a\b`: false, "a:b": false,
		".a": false, "sp/.a": false, "a\x00": false} {
		if got := ValidPath(p); got != want {
			t.Errorf("ValidPath(%q) = %v", p, got)
		}
	}
}
