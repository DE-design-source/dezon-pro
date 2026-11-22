package materials

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/platform/storage"
	"qspro-backend/internal/shared/actor"
)

// zeros: nguồn byte 0 vô hạn, không cấp phát (thân file lớn giả trong test).
type zeros struct{}

func (zeros) Read(b []byte) (int, error) {
	clear(b)
	return len(b), nil
}

// failAfter: thân đọc được n byte rồi lỗi - client ngắt giữa chừng.
type failAfter struct{ n int64 }

func (f *failAfter) Read(b []byte) (int, error) {
	if f.n <= 0 {
		return 0, io.ErrUnexpectedEOF
	}
	if int64(len(b)) > f.n {
		b = b[:f.n]
	}
	clear(b)
	f.n -= int64(len(b))
	return len(b), nil
}

// doStream: POST thân size byte 0 không cấp phát cả thân. size < 0 = không gửi Content-Length (chunked), đọc tới -size byte.
func doStream(e *gin.Engine, path, ct string, size int64, login bool) *httptest.ResponseRecorder {
	n := size
	if n < 0 {
		n = -n
	}
	return doReader(e, path, ct, io.LimitReader(zeros{}, n), size, "", login)
}

func doReader(e *gin.Engine, path, ct string, body io.Reader, size int64, enc string, login bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", path, body)
	req.ContentLength = size
	if size < 0 {
		req.ContentLength = -1
		req.TransferEncoding = []string{"chunked"}
	}
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	if enc != "" {
		req.Header.Set("Content-Encoding", enc)
	}
	if login {
		req.Header.Set("Authorization", "Bearer x")
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

func diskSvc(t *testing.T) (*gin.Engine, string) {
	t.Helper()
	dir := t.TempDir()
	d := stubDeps{}
	s := New(Deps{Auditor: d, Users: d, UserFmt: d, Notifier: d, Admins: d, Uploader: storage.New(dir)})
	return testEngine(s, &actor.Actor{UID: "u", U: "nv", R: "staff"}), dir
}

// tmpLeft: số tệp còn trong UPLOAD_DIR/.tmp.
func tmpLeft(t *testing.T, dir string) int {
	t.Helper()
	items, err := os.ReadDir(filepath.Join(dir, storage.TempDir))
	if errors.Is(err, os.ErrNotExist) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	return len(items)
}

func docFiles(t *testing.T, dir string) []os.FileInfo {
	t.Helper()
	items, _ := os.ReadDir(filepath.Join(dir, "docs"))
	var out []os.FileInfo
	for _, it := range items {
		st, err := it.Info()
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, st)
	}
	return out
}

func setUploadMax(t *testing.T, n int64) {
	old := uploadMax
	uploadMax = n
	t.Cleanup(func() { uploadMax = old })
}

// File lớn hơn giới hạn cũ 50MB: ghi theo luồng qua tệp tạm vào kho thật, bộ nhớ cấp phát không theo cỡ file.
func TestUploadStreamDisk(t *testing.T) {
	e, dir := diskSvc(t)
	const size = 60 << 20
	var m0, m1 runtime.MemStats
	runtime.ReadMemStats(&m0)
	w := doStream(e, "/upload/file?name=Ban-ve.pdf", "application/pdf", size, true)
	runtime.ReadMemStats(&m1)
	if w.Code != 200 || !strings.HasPrefix(w.Body.String(), `{"url":"/files/docs/`) {
		t.Fatalf("60MB: %d %s", w.Code, w.Body.String())
	}
	if alloc := m1.TotalAlloc - m0.TotalAlloc; alloc > 8<<20 {
		t.Errorf("cấp phát %d byte cho file 60MB - không ghi theo luồng?", alloc)
	}
	if fs := docFiles(t, dir); len(fs) != 1 || fs[0].Size() != size || !strings.HasSuffix(fs[0].Name(), "-Ban-ve.pdf") {
		t.Errorf("kho: %v", fs)
	}
	if n := tmpLeft(t, dir); n != 0 {
		t.Errorf("còn %d tệp tạm", n)
	}

	// gzip: giới hạn tính trên dữ liệu đã giải nén, file lưu bản giải nén
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	if _, err := io.Copy(zw, io.LimitReader(zeros{}, size)); err != nil {
		t.Fatal(err)
	}
	zw.Close()
	w = doReader(e, "/upload/file?name=nen.zip", "application/zip", bytes.NewReader(gz.Bytes()), int64(gz.Len()), "gzip", true)
	if w.Code != 200 {
		t.Fatalf("gzip: %d %s", w.Code, w.Body.String())
	}
	var nen os.FileInfo
	for _, f := range docFiles(t, dir) {
		if strings.HasSuffix(f.Name(), "-nen.zip") {
			nen = f
		}
	}
	if nen == nil || nen.Size() != size {
		t.Errorf("gzip trên đĩa: %v", nen)
	}
	if n := tmpLeft(t, dir); n != 0 {
		t.Errorf("gzip: còn %d tệp tạm", n)
	}
}

// Quá giới hạn / lỗi giữa chừng / tên sai: trả lỗi như cũ, không để lại tệp tạm và không có file trong kho.
func TestUploadStreamCleanup(t *testing.T) {
	setUploadMax(t, 2<<20)
	const qua = `{"error":"File quá lớn (tối đa 300MB) — hãy dán link thay vì tải lên."}`
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	_, _ = io.Copy(zw, io.LimitReader(zeros{}, 3<<20))
	zw.Close()
	for _, c := range []struct {
		name  string
		do    func(e *gin.Engine) *httptest.ResponseRecorder
		code  int
		body  string
		tmpOK bool // thư mục .tmp được phép đã có (đã ghi rồi xoá)
	}{
		{"chunked quá giới hạn", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doStream(e, "/upload/file?name=a.pdf", "application/pdf", -(3 << 20), true)
		}, 413, qua, true},
		{"gzip giải nén quá giới hạn", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doReader(e, "/upload/file?name=a.pdf", "application/pdf", bytes.NewReader(gz.Bytes()), int64(gz.Len()), "gzip", true)
		}, 413, qua, true},
		{"Content-Length quá giới hạn", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doStream(e, "/upload/file?name=a.pdf", "application/pdf", 3<<20, true)
		}, 413, qua, false},
		{"client ngắt giữa chừng", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doReader(e, "/upload/file?name=a.pdf", "application/pdf", &failAfter{n: 1 << 20}, -1, "", true)
		}, 400, "", true},
		{"đuôi không hỗ trợ", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doStream(e, "/upload/file?name=a.exe", "application/octet-stream", 1<<20, true)
		}, 400, `{"error":"Định dạng .exe chưa hỗ trợ (PDF, ảnh, DWG/DXF, SKP, ZIP/RAR, Word, Excel)."}`, true},
		{"chưa đăng nhập: không ghi đĩa", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doStream(e, "/upload/file?name=a.pdf", "application/pdf", -(1 << 20), false)
		}, 401, `{"error":"Chưa đăng nhập"}`, false},
		{"chưa đăng nhập, quá giới hạn: 413 trước 401", func(e *gin.Engine) *httptest.ResponseRecorder {
			return doStream(e, "/upload/file?name=a.pdf", "application/pdf", -(3 << 20), false)
		}, 413, qua, false},
	} {
		e, dir := diskSvc(t)
		w := c.do(e)
		if w.Code != c.code || (c.body != "" && w.Body.String() != c.body) {
			t.Errorf("%s: %d %s", c.name, w.Code, w.Body.String())
		}
		if n := tmpLeft(t, dir); n != 0 {
			t.Errorf("%s: còn %d tệp tạm", c.name, n)
		}
		if _, err := os.Stat(filepath.Join(dir, storage.TempDir)); !c.tmpOK && err == nil {
			t.Errorf("%s: đã tạo thư mục tệp tạm", c.name)
		}
		if fs := docFiles(t, dir); len(fs) != 0 {
			t.Errorf("%s: kho có file %v", c.name, fs)
		}
	}
}

// Thân gửi chậm hơn ReadTimeout của http.Server: /upload/file tự nới hạn đọc nên vẫn nhận đủ.
func TestUploadReadDeadline(t *testing.T) {
	e, dir := diskSvc(t)
	srv := httptest.NewUnstartedServer(e)
	srv.Config.ReadTimeout = 300 * time.Millisecond
	srv.Start()
	defer srv.Close()
	pr, pw := io.Pipe()
	go func() {
		chunk := make([]byte, 64<<10)
		for range 5 {
			time.Sleep(150 * time.Millisecond)
			if _, err := pw.Write(chunk); err != nil {
				return
			}
		}
		pw.Close()
	}()
	req, _ := http.NewRequest("POST", srv.URL+"/upload/file?name=cham.pdf", pr)
	req.Header.Set("Content-Type", "application/pdf")
	req.Header.Set("Authorization", "Bearer x")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("gửi chậm: %d %s", res.StatusCode, b)
	}
	if fs := docFiles(t, dir); len(fs) != 1 || fs[0].Size() != 5*64<<10 {
		t.Errorf("kho: %v", fs)
	}

	// chưa đăng nhập: không nới hạn, ReadTimeout của server cắt thân gửi chậm (không tới được 401)
	pr, pw = io.Pipe()
	go func() {
		chunk := make([]byte, 64<<10)
		for range 5 {
			time.Sleep(150 * time.Millisecond)
			if _, err := pw.Write(chunk); err != nil {
				return
			}
		}
		pw.Close()
	}()
	req, _ = http.NewRequest("POST", srv.URL+"/upload/file?name=cham.pdf", pr)
	req.Header.Set("Content-Type", "application/pdf")
	res, err = srv.Client().Do(req)
	if err == nil {
		b, _ = io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode == 401 {
			t.Errorf("chưa đăng nhập vẫn được nới hạn đọc: %d %s", res.StatusCode, b)
		}
	}
	pw.CloseWithError(io.ErrClosedPipe)
}
