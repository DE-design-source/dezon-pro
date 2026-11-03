package objstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
)

// Không cần MinIO: cấu hình sai bị từ chối, New không gọi mạng, URL ký theo host PublicURL (khác Endpoint).
func TestNewAndPresignOffline(t *testing.T) {
	for _, cfg := range []Config{
		{Endpoint: "http://minio:9000", Bucket: "b"},                                           // thiếu khoá
		{Endpoint: "http://minio:9000", AccessKey: "a", SecretKey: "s"},                        // thiếu bucket
		{Endpoint: "minio:9000", AccessKey: "a", SecretKey: "s", Bucket: "b"},                  // thiếu scheme
		{Endpoint: "ftp://minio:9000", AccessKey: "a", SecretKey: "s", Bucket: "b"},            // scheme sai
		{Endpoint: "http://minio:9000/duong-dan", AccessKey: "a", SecretKey: "s", Bucket: "b"}, // có đường dẫn
		{Endpoint: "http://minio:9000", PublicURL: "s3.vidu.vn", AccessKey: "a", SecretKey: "s", Bucket: "b"},
	} {
		if _, err := New(cfg); err == nil {
			t.Errorf("New(%+v): muốn lỗi", cfg)
		}
	}
	c, err := New(Config{Endpoint: "http://khong-ton-tai.invalid:9000", PublicURL: "https://s3.vidu.vn/", AccessKey: "a",
		SecretKey: "s", Bucket: "chat-media"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Ready() {
		t.Error("chưa Start mà đã Ready")
	}
	ctx := context.Background()
	put, hdr, err := c.PresignPut(ctx, "chat/in/u1/202611/abc", "image/png", 123, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(put)
	q := u.Query()
	if u.Scheme != "https" || u.Host != "s3.vidu.vn" || u.Path != "/chat-media/chat/in/u1/202611/abc" {
		t.Errorf("URL PUT: %s", put)
	}
	if sh := q.Get("X-Amz-SignedHeaders"); sh != "content-length;content-type;host" {
		t.Errorf("SignedHeaders = %q", sh)
	}
	if q.Get("X-Amz-Expires") != "900" || !strings.Contains(q.Get("X-Amz-Credential"), "/us-east-1/s3/") {
		t.Errorf("Expires / Credential: %s", put)
	}
	if len(hdr) != 1 || hdr["Content-Type"] != "image/png" {
		t.Errorf("header phải gửi: %v", hdr)
	}
	get, err := c.PresignGet(ctx, "chat/m/u1/202611/abc", time.Hour, "image/png", `attachment; filename="a.png"`, "private, max-age=3600")
	if err != nil {
		t.Fatal(err)
	}
	g, _ := url.Parse(get)
	gq := g.Query()
	if g.Host != "s3.vidu.vn" || gq.Get("response-content-type") != "image/png" ||
		gq.Get("response-content-disposition") != `attachment; filename="a.png"` || gq.Get("response-cache-control") != "private, max-age=3600" ||
		gq.Get("X-Amz-Expires") != "3600" {
		t.Errorf("URL GET: %s", get)
	}
	if g2, _ := c.PresignGet(ctx, "k", time.Minute, "", "", ""); strings.Contains(g2, "response-") {
		t.Errorf("tham số trống không được ghi đè header: %s", g2)
	}
}

// testClient: client thật trên MinIO (TEST_S3_ENDPOINT / TEST_S3_ACCESS_KEY / TEST_S3_SECRET_KEY), bucket riêng cho
// lượt test, xoá khi xong. Chưa đặt biến -> bỏ qua.
func testClient(t *testing.T) *Client {
	t.Helper()
	ep, ak, sk := os.Getenv("TEST_S3_ENDPOINT"), os.Getenv("TEST_S3_ACCESS_KEY"), os.Getenv("TEST_S3_SECRET_KEY")
	if ep == "" || ak == "" || sk == "" {
		t.Skip("chưa đặt TEST_S3_ENDPOINT / TEST_S3_ACCESS_KEY / TEST_S3_SECRET_KEY")
	}
	bucket := fmt.Sprintf("objstore-test-%d", time.Now().UnixNano())
	// PublicURL = Endpoint: 127.0.0.1 trong container test là chính nó, không phải MinIO
	c, err := New(Config{Endpoint: ep, PublicURL: ep, AccessKey: ak, SecretKey: sk, Bucket: bucket})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)
	deadline := time.Now().Add(20 * time.Second)
	for !c.Ready() {
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("bucket không Ready sau 20 s")
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Cleanup(func() {
		cancel()
		bg := context.Background()
		for o := range c.internal.ListObjects(bg, bucket, minio.ListObjectsOptions{Recursive: true}) {
			if o.Err == nil {
				_ = c.Remove(bg, o.Key)
			}
		}
		if err := c.internal.RemoveBucket(bg, bucket); err != nil {
			t.Logf("xoá bucket %s: %v", bucket, err)
		}
	})
	return c
}

func doPut(t *testing.T, u string, body []byte, contentType string, contentLength int64) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.ContentLength = contentLength
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp
}

// Tích hợp với MinIO thật + kiểm thử (spike) MinIO có ép Content-Type / Content-Length đã ký và trả lời preflight CORS.
func TestMinIOIntegration(t *testing.T) {
	c := testClient(t)
	ctx := context.Background()
	data := []byte("\x89PNG\r\n\x1a\n-noi-dung-thu-0123456789")
	key := "chat/in/u1/202611/" + strings.Repeat("ab", 16)

	put, hdr, err := c.PresignPut(ctx, key, "image/png", int64(len(data)), 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	// spike 2: Content-Type khác bản ký -> từ chối
	if r := doPut(t, put, data, "image/jpeg", int64(len(data))); r.StatusCode != http.StatusForbidden {
		t.Errorf("Content-Type sai: mã %d, muốn 403", r.StatusCode)
	}
	// spike 3: thân lớn hơn / nhỏ hơn Content-Length đã ký -> từ chối
	if r := doPut(t, put, append(append([]byte{}, data...), 'x'), hdr["Content-Type"], int64(len(data)+1)); r.StatusCode != http.StatusForbidden {
		t.Errorf("thân lớn hơn: mã %d, muốn 403", r.StatusCode)
	}
	if r := doPut(t, put, data[:len(data)-1], hdr["Content-Type"], int64(len(data)-1)); r.StatusCode != http.StatusForbidden {
		t.Errorf("thân nhỏ hơn: mã %d, muốn 403", r.StatusCode)
	}
	if _, _, found, err := c.Stat(ctx, key); err != nil || found {
		t.Fatalf("PUT bị từ chối mà vẫn có object: %v %v", found, err)
	}
	// spike 4: preflight CORS trên đường dẫn presigned
	// origin phải nằm trong MINIO_API_CORS_ALLOW_ORIGIN của MinIO thử (TEST_S3_CORS_ORIGIN, mặc định giao diện Vite ở máy)
	origin := os.Getenv("TEST_S3_CORS_ORIGIN")
	if origin == "" {
		origin = "http://localhost:5173"
	}
	preflight := func(o string) *http.Response {
		pre, _ := http.NewRequest(http.MethodOptions, put, nil)
		pre.Header.Set("Origin", o)
		pre.Header.Set("Access-Control-Request-Method", "PUT")
		pre.Header.Set("Access-Control-Request-Headers", "content-type")
		r, err := http.DefaultClient.Do(pre)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		t.Logf("preflight %s: mã %d, Allow-Origin=%q, Allow-Methods=%q, Allow-Headers=%q", o, r.StatusCode,
			r.Header.Get("Access-Control-Allow-Origin"), r.Header.Get("Access-Control-Allow-Methods"), r.Header.Get("Access-Control-Allow-Headers"))
		return r
	}
	if r := preflight(origin); r.StatusCode >= 300 || r.Header.Get("Access-Control-Allow-Origin") != origin ||
		!strings.Contains(r.Header.Get("Access-Control-Allow-Methods"), "PUT") ||
		!strings.Contains(strings.ToLower(r.Header.Get("Access-Control-Allow-Headers")), "content-type") {
		t.Errorf("preflight origin hợp lệ không được chấp nhận: mã %d", r.StatusCode)
	}
	if r := preflight("http://evil.example"); r.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("origin lạ vẫn được CORS: %q", r.Header.Get("Access-Control-Allow-Origin"))
	}

	// đúng loại + đúng kích thước -> 200, Stat thấy
	if r := doPut(t, put, data, hdr["Content-Type"], int64(len(data))); r.StatusCode != http.StatusOK {
		t.Fatalf("PUT đúng: mã %d", r.StatusCode)
	}
	if n, ct, found, err := c.Stat(ctx, key); err != nil || !found || n != int64(len(data)) || ct != "image/png" {
		t.Fatalf("Stat: %d %q %v %v", n, ct, found, err)
	}
	if _, _, found, err := c.Stat(ctx, "chat/in/khong-co"); err != nil || found {
		t.Errorf("Stat khoá không có: %v %v", found, err)
	}

	// Copy sang khoá cuối, giữ Content-Type
	final := "chat/m/u1/202611/" + strings.Repeat("ab", 16)
	if err := c.Copy(ctx, key, final); err != nil {
		t.Fatal(err)
	}
	if n, ct, found, err := c.Stat(ctx, final); err != nil || !found || n != int64(len(data)) || ct != "image/png" {
		t.Errorf("Stat sau Copy: %d %q %v %v", n, ct, found, err)
	}
	// Open
	rc, err := c.Open(ctx, final)
	if err != nil {
		t.Fatal(err)
	}
	all, _ := io.ReadAll(rc)
	rc.Close()
	if !bytes.Equal(all, data) {
		t.Errorf("Open: %q", all)
	}
	if _, err := c.Open(ctx, "chat/m/khong-co"); err == nil {
		t.Error("Open khoá không có: muốn lỗi")
	}
	// ReadPrefix
	if b, err := c.ReadPrefix(ctx, final, 8); err != nil || !bytes.Equal(b, data[:8]) {
		t.Errorf("ReadPrefix 8: %q %v", b, err)
	}
	if b, err := c.ReadPrefix(ctx, final, 512); err != nil || !bytes.Equal(b, data) {
		t.Errorf("ReadPrefix dài hơn object: %q %v", b, err)
	}
	// Get trong / quá giới hạn
	if b, err := c.Get(ctx, final, int64(len(data))); err != nil || !bytes.Equal(b, data) {
		t.Errorf("Get: %q %v", b, err)
	}
	if _, err := c.Get(ctx, final, int64(len(data)-1)); !errors.Is(err, ErrTooLarge) {
		t.Errorf("Get quá giới hạn: %v", err)
	}
	// Put + object rỗng
	thumb := final + ".t.jpg"
	if err := c.Put(ctx, thumb, []byte("jpeg-nho"), "image/jpeg"); err != nil {
		t.Fatal(err)
	}
	if n, ct, found, _ := c.Stat(ctx, thumb); !found || n != 8 || ct != "image/jpeg" {
		t.Errorf("Stat sau Put: %d %q %v", n, ct, found)
	}
	if err := c.Put(ctx, "chat/m/rong", nil, "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	if b, err := c.ReadPrefix(ctx, "chat/m/rong", 512); err != nil || len(b) != 0 {
		t.Errorf("ReadPrefix object rỗng: %q %v", b, err)
	}

	// PresignGet: 200, đúng byte, header phản hồi theo tham số đã ký
	get, err := c.PresignGet(ctx, final, time.Hour, "image/png", `attachment; filename="anh.png"`, "private, max-age=3600")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(get)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Equal(body, data) || resp.Header.Get("Content-Type") != "image/png" ||
		resp.Header.Get("Content-Disposition") != `attachment; filename="anh.png"` || resp.Header.Get("Cache-Control") != "private, max-age=3600" {
		t.Errorf("GET presigned: %d %q %v", resp.StatusCode, body, resp.Header)
	}

	// Remove: có + không có đều không lỗi
	if err := c.Remove(ctx, key, final, thumb, "chat/m/rong", "chat/m/khong-co"); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{key, final, thumb} {
		if _, _, found, err := c.Stat(ctx, k); err != nil || found {
			t.Errorf("sau Remove %s: %v %v", k, found, err)
		}
	}
}

// Start trên endpoint không tới được: không Ready, dừng khi huỷ ctx.
func TestStartUnreachable(t *testing.T) {
	c, err := New(Config{Endpoint: "http://127.0.0.1:1", AccessKey: "a", SecretKey: "s", Bucket: "chat-media"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)
	time.Sleep(300 * time.Millisecond)
	cancel()
	if c.Ready() {
		t.Error("endpoint không tới được mà Ready")
	}
}
