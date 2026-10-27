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

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/jsval"
)

const (
	DefaultDir = "uploads" // UPLOAD_DIR mặc định, tương đối với thư mục chạy
	Prefix     = "/files/" // tiền tố URL công khai của file trong kho
)

var (
	errPath   = errors.New("Đường dẫn file không hợp lệ")
	errGhi    = errors.New("Không lưu được file lên máy chủ")
	errQuaLon = errors.New("File quá lớn")
)

// Client: kho file trên đĩa.
type Client struct {
	dir string
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
