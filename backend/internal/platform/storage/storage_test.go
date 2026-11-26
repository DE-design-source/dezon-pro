package storage

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"
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

// CreateTemp -> Write -> Commit: file vào đúng chỗ (ghi đè nếu trùng), .tmp không còn gì; Discard xoá tệp tạm.
func TestCreateTemp(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "kho")
	s := New(dir)
	ctx := context.Background()
	for _, noiDung := range []string{"lần 1", "lần 2 dài hơn"} {
		tf, err := s.CreateTemp(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tf.Write([]byte(noiDung)); err != nil {
			t.Fatal(err)
		}
		url, err := tf.Commit("docs/1-a b.pdf", "application/pdf")
		if err != nil || url != "/files/docs/1-a%20b.pdf" {
			t.Fatalf("commit: %q %v", url, err)
		}
		tf.Discard() // sau Commit: không làm gì
		if b, err := os.ReadFile(filepath.Join(dir, "docs", "1-a b.pdf")); err != nil || string(b) != noiDung {
			t.Errorf("file: %q %v", b, err)
		}
	}
	tf, _ := s.CreateTemp(ctx)
	_, _ = tf.Write([]byte("bỏ"))
	tf.Discard()
	if _, err := tf.Write([]byte("x")); err == nil {
		t.Error("ghi sau Discard không lỗi")
	}
	// đường dẫn sai: lỗi như Upload, tệp tạm bị xoá
	tf, _ = s.CreateTemp(ctx)
	if _, err := tf.Commit("../x.pdf", ""); err == nil || err.Error() != "Đường dẫn file không hợp lệ" {
		t.Errorf("path sai: %v", err)
	}
	if es, _ := os.ReadDir(filepath.Join(dir, TempDir)); len(es) != 0 {
		t.Errorf("còn tệp tạm: %v", es)
	}
	if _, ok := PathOf("/files/.tmp/x.tmp"); ok {
		t.Error("/files/ phục vụ được tệp tạm")
	}
}

// Lần CreateTemp đầu tiên của Client dọn tệp tạm cũ hơn 1 ngày, giữ tệp mới.
func TestCreateTempSweep(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, TempDir), 0o755); err != nil {
		t.Fatal(err)
	}
	cu, moi := filepath.Join(dir, TempDir, "cu.tmp"), filepath.Join(dir, TempDir, "moi.tmp")
	for _, f := range []string{cu, moi} {
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(cu, old, old); err != nil {
		t.Fatal(err)
	}
	tf, err := New(dir).CreateTemp(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	tf.Discard()
	if _, err := os.Stat(cu); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("tệp tạm cũ còn: %v", err)
	}
	if _, err := os.Stat(moi); err != nil {
		t.Errorf("tệp tạm mới bị xoá: %v", err)
	}
}

func TestCreateTempLoiDia(t *testing.T) {
	f := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(f, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := New(f).CreateTemp(context.Background()); err == nil || err.Error() != "Không lưu được file lên máy chủ" {
		t.Errorf("lỗi: %v", err)
	}
}

func TestRemove(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "kho")
	s := New(dir)
	if err := s.Remove("kd-rec/1/a.webm"); err != nil { // kho chưa có thư mục: không lỗi
		t.Fatalf("kho trống: %v", err)
	}
	if _, err := s.Upload(context.Background(), []byte("abc"), "kd-rec/1/a.webm", "audio/webm"); err != nil {
		t.Fatal(err)
	}
	if err := s.Remove("kd-rec/1/a.webm"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "kd-rec", "1", "a.webm")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("file còn trên đĩa: %v", err)
	}
	if err := s.Remove("kd-rec/1/a.webm"); err != nil {
		t.Errorf("xoá lần 2: %v", err)
	}
	for _, p := range []string{"", "../x", "a/../../x", ".tmp/x"} {
		if err := s.Remove(p); err == nil {
			t.Errorf("đường dẫn sai %q phải lỗi", p)
		}
	}
}
