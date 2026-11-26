// Package storage: kho FILE (ảnh / tài liệu tải lên) trên ổ đĩa của máy chủ, thư mục UPLOAD_DIR.
// File lưu ở <UPLOAD_DIR>/<path>, phục vụ công khai tại /files/<path> (internal/server/uploads.go).
// Mọi truy cập đi qua os.Root nên không leo ra ngoài thư mục kho, kể cả qua symlink.
package storage

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"math/rand/v2"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/contracts"
	"qspro-backend/internal/shared/jsval"
)

const (
	DefaultDir = "uploads" // UPLOAD_DIR mặc định, tương đối với thư mục chạy
	Prefix     = "/files/" // tiền tố URL công khai của file trong kho
	// TempDir: thư mục tệp tạm của CreateTemp trong kho. Bắt đầu bằng dấu chấm nên ValidPath chặn, /files/ không phục vụ.
	TempDir = ".tmp"
)

var (
	errPath   = errors.New("Đường dẫn file không hợp lệ")
	errGhi    = errors.New("Không lưu được file lên máy chủ")
	errQuaLon = errors.New("File quá lớn")
)

// Client: kho file trên đĩa.
type Client struct {
	dir   string
	sweep sync.Once // dọn tệp tạm cũ (máy chủ tắt giữa lúc tải) ở lần CreateTemp đầu tiên
}

// New: dir rỗng -> DefaultDir. Thư mục được tạo ở lần ghi đầu tiên.
func New(dir string) *Client {
	if dir == "" {
		dir = DefaultDir
	}
	return &Client{dir: dir}
}

// Dir: thư mục gốc của kho.
func (s *Client) Dir() string { return s.dir }

// PublicURL: đường dẫn công khai của 1 file - /files/ + từng đoạn qua encodeURIComponent.
func (s *Client) PublicURL(p string) string {
	segs := strings.Split(p, "/")
	for i, sg := range segs {
		segs[i] = jsval.EncodeURIComponent(sg)
	}
	return Prefix + strings.Join(segs, "/")
}

// ValidPath: đường dẫn tương đối trong kho - các đoạn cách nhau "/", không rỗng, không bắt đầu bằng dấu chấm
// (chặn "." / ".." và file tạm), không có "\", ":" hay NUL, không phải tên thiết bị của Windows (NUL, COM1...).
func ValidPath(p string) bool {
	if p == "" || strings.ContainsAny(p, "\\:\x00") || !fs.ValidPath(p) {
		return false
	}
	for _, sg := range strings.Split(p, "/") {
		if strings.HasPrefix(sg, ".") {
			return false
		}
	}
	return filepath.IsLocal(filepath.FromSlash(p))
}

// Upload ghi buf vào <dir>/<path> (ghi đè nếu trùng tên) và trả URL công khai. Ghi ra file tạm cùng thư mục rồi
// đổi tên: người đọc không bao giờ thấy file ghi dở. contentType không được lưu: khi phục vụ, kiểu lấy theo đuôi file.
func (s *Client) Upload(_ context.Context, buf []byte, p, _ string) (string, error) {
	if !ValidPath(p) {
		return "", errPath
	}
	if err := s.write(p, buf); err != nil {
		logger.Error("storage", "ghi", p, "lỗi:", err.Error())
		return "", errGhi
	}
	return s.PublicURL(p), nil
}

func (s *Client) write(p string, buf []byte) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		return err
	}
	defer root.Close()
	if d := path.Dir(p); d != "." {
		if err := root.MkdirAll(filepath.FromSlash(d), 0o755); err != nil {
			return err
		}
	}
	tmp := filepath.FromSlash(path.Join(path.Dir(p), "."+path.Base(p)+"."+strconv.FormatUint(rand.Uint64(), 36)+".tmp"))
	f, err := root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(buf)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = root.Rename(tmp, filepath.FromSlash(p))
	}
	if err != nil {
		_ = root.Remove(tmp)
	}
	return err
}

// CreateTemp mở tệp tạm mới trong <dir>/.tmp (tạo thư mục nếu thiếu) để ghi file lớn theo luồng rồi Commit vào kho.
// Cùng ổ đĩa với kho nên Commit chỉ đổi tên, không chép lại.
func (s *Client) CreateTemp(_ context.Context) (contracts.TempFile, error) {
	t, err := s.createTemp()
	if err != nil {
		logger.Error("storage", "tạo tệp tạm lỗi:", err.Error())
		return nil, errGhi
	}
	return t, nil
}

func (s *Client) createTemp() (*tempFile, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		return nil, err
	}
	if err := root.MkdirAll(TempDir, 0o755); err != nil {
		root.Close()
		return nil, err
	}
	s.sweep.Do(func() { sweepTemp(root) })
	name := filepath.Join(TempDir, strconv.FormatUint(rand.Uint64(), 36)+".tmp")
	f, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		root.Close()
		return nil, err
	}
	return &tempFile{s: s, root: root, f: f, name: name}, nil
}

// sweepTemp xoá tệp trong .tmp sửa lần cuối quá 1 ngày: tệp còn lại khi máy chủ tắt giữa lúc tải.
func sweepTemp(root *os.Root) {
	d, err := root.Open(TempDir)
	if err != nil {
		return
	}
	defer d.Close()
	items, _ := d.ReadDir(-1)
	han := time.Now().Add(-24 * time.Hour)
	for _, it := range items {
		if st, err := it.Info(); err == nil && st.Mode().IsRegular() && st.ModTime().Before(han) {
			_ = root.Remove(filepath.Join(TempDir, it.Name()))
		}
	}
}

// tempFile: tệp tạm của CreateTemp. Không dùng song song từ nhiều goroutine.
type tempFile struct {
	s    *Client
	root *os.Root
	f    *os.File
	name string // đường dẫn trong kho, vd .tmp/<rnd>.tmp
	done bool   // đã Commit thành công hoặc đã Discard
}

func (t *tempFile) Write(b []byte) (int, error) {
	if t.done {
		return 0, os.ErrClosed
	}
	n, err := t.f.Write(b)
	if err != nil {
		logger.Error("storage", "ghi tệp tạm", t.name, "lỗi:", err.Error())
		return n, errGhi
	}
	return n, nil
}

func (t *tempFile) Commit(p, _ string) (string, error) {
	if t.done {
		return "", errGhi
	}
	if !ValidPath(p) {
		t.Discard()
		return "", errPath
	}
	err := t.f.Sync()
	if cerr := t.f.Close(); err == nil {
		err = cerr
	}
	if d := path.Dir(p); err == nil && d != "." {
		err = t.root.MkdirAll(filepath.FromSlash(d), 0o755)
	}
	if err == nil {
		err = t.root.Rename(t.name, filepath.FromSlash(p))
	}
	if err != nil {
		logger.Error("storage", "ghi", p, "lỗi:", err.Error())
		t.Discard()
		return "", errGhi
	}
	t.done = true
	t.root.Close()
	return t.s.PublicURL(p), nil
}

func (t *tempFile) Discard() {
	if t.done {
		return
	}
	t.done = true
	_ = t.f.Close() // đã đóng (Commit lỗi sau Close) thì chỉ trả lỗi, không sao
	if err := t.root.Remove(t.name); err != nil && !errors.Is(err, fs.ErrNotExist) {
		logger.Error("storage", "xoá tệp tạm", t.name, "lỗi:", err.Error())
	}
	t.root.Close()
}

// Open mở 1 file của kho theo đường dẫn tương đối (đã giải mã). Đường dẫn sai, thư mục, không có file -> fs.ErrNotExist.
// Nơi gọi đóng file.
func (s *Client) Open(p string) (*os.File, fs.FileInfo, error) {
	if !ValidPath(p) {
		return nil, nil, fs.ErrNotExist
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		return nil, nil, fs.ErrNotExist
	}
	defer root.Close() // file đã mở vẫn dùng được sau khi đóng root
	f, err := root.Open(filepath.FromSlash(p))
	if err != nil {
		return nil, nil, fs.ErrNotExist
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		f.Close()
		return nil, nil, fs.ErrNotExist
	}
	return f, st, nil
}

// Remove xoá 1 file của kho theo đường dẫn tương đối. Không có file -> nil (xoá lặp lại không lỗi); đường dẫn sai -> lỗi.
func (s *Client) Remove(p string) error {
	if !ValidPath(p) {
		return errPath
	}
	root, err := os.OpenRoot(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.Remove(filepath.FromSlash(p)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// PathOf: đường dẫn trong kho của URL công khai "/files/<path>" (bỏ ?query / #..., giải mã %XX).
// ok = false khi URL không thuộc kho hoặc đường dẫn không hợp lệ.
func PathOf(u string) (string, bool) {
	if !strings.HasPrefix(u, Prefix) {
		return "", false
	}
	p := u[len(Prefix):]
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	p, err := url.PathUnescape(p)
	if err != nil || !ValidPath(p) {
		return "", false
	}
	return p, true
}

// ReadURL đọc nội dung file của kho theo URL công khai, tối đa max byte. URL không thuộc kho, không có file
// hoặc lớn hơn max -> lỗi.
func (s *Client) ReadURL(u string, max int64) ([]byte, error) {
	p, ok := PathOf(u)
	if !ok {
		return nil, fs.ErrNotExist
	}
	f, st, err := s.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if st.Size() > max {
		return nil, errQuaLon
	}
	buf, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(buf)) > max {
		return nil, errQuaLon
	}
	return buf, nil
}
