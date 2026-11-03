// Package objstore: kho tệp S3 (MinIO) cho tệp chat - thoả interface chat.MediaStore, chỉ dùng kiểu cơ bản để không
// phải import chat.
//
//   - Hai client minio-go: internal (CHAT_S3_ENDPOINT, mạng nội bộ) cho Stat / Copy / Open / Get / Put / Remove / bucket;
//     signer (CHAT_S3_PUBLIC_URL) chỉ để ký URL. SigV4 ký cả host nên trình duyệt phải gọi đúng host đó.
//     Đã đặt Region nên ký URL không cần hỏi mạng (không gọi GetBucketLocation).
//   - New không gọi mạng; Start chạy goroutine kiểm / tạo bucket (thử lại 1 s .. 60 s) rồi mới Ready().
//   - PresignPut ký Content-Type + Content-Length: MinIO từ chối PUT khác loại / khác kích thước đã khai.
//
// Client an toàn khi gọi song song từ nhiều goroutine.
package objstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"qspro-backend/internal/platform/logger"
)

// Config: cấu hình kho (lấy từ CHAT_S3_*). PublicURL trống = dùng Endpoint; Region trống = us-east-1.
type Config struct {
	Endpoint, PublicURL, AccessKey, SecretKey, Bucket, Region string
}

// Client: kho tệp trên một bucket.
type Client struct {
	internal *minio.Client
	signer   *minio.Client
	bucket   string
	region   string
	ready    atomic.Bool
}

// Thời gian chờ giữa các lần thử kiểm / tạo bucket (gấp đôi mỗi lần).
const (
	startBackoffMin = time.Second
	startBackoffMax = 60 * time.Second
)

// New: tạo client, không gọi mạng. Endpoint / PublicURL là URL kèm scheme (http / https), không có đường dẫn.
func New(cfg Config) (*Client, error) {
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, errors.New("objstore: thiếu access key / secret key")
	}
	if cfg.Bucket == "" {
		return nil, errors.New("objstore: thiếu tên bucket")
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	if cfg.PublicURL == "" {
		cfg.PublicURL = cfg.Endpoint
	}
	in, err := newMinio(cfg.Endpoint, cfg)
	if err != nil {
		return nil, fmt.Errorf("objstore: endpoint: %w", err)
	}
	sg, err := newMinio(cfg.PublicURL, cfg)
	if err != nil {
		return nil, fmt.Errorf("objstore: public url: %w", err)
	}
	return &Client{internal: in, signer: sg, bucket: cfg.Bucket, region: cfg.Region}, nil
}

func newMinio(raw string, cfg Config) (*minio.Client, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%q phải bắt đầu bằng http:// hoặc https://", raw)
	}
	if u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		return nil, fmt.Errorf("%q chỉ được có scheme + host[:port]", raw)
	}
	return minio.New(u.Host, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure:       u.Scheme == "https",
		Region:       cfg.Region,
		BucketLookup: minio.BucketLookupPath,
	})
}

// Start: goroutine kiểm bucket (chưa có thì tạo), lỗi thì thử lại với thời gian chờ tăng dần 1 s .. 60 s;
// xong thì Ready() = true. Dừng khi ctx bị huỷ.
func (c *Client) Start(ctx context.Context) {
	go func() {
		wait := startBackoffMin
		for {
			err := c.ensureBucket(ctx)
			if err == nil {
				c.ready.Store(true)
				logger.Info("objstore", "kho tệp sẵn sàng, bucket", c.bucket)
				return
			}
			if ctx.Err() != nil {
				return
			}
			logger.Error("objstore", "chưa kiểm / tạo được bucket", c.bucket+":", err.Error(), "- thử lại sau", wait.String())
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			wait = min(wait*2, startBackoffMax)
		}
	}()
}

func (c *Client) ensureBucket(ctx context.Context) error {
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	ok, err := c.internal.BucketExists(cctx, c.bucket)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	err = c.internal.MakeBucket(cctx, c.bucket, minio.MakeBucketOptions{Region: c.region})
	if err != nil {
		if code := minio.ToErrorResponse(err).Code; code == "BucketAlreadyOwnedByYou" || code == "BucketAlreadyExists" {
			return nil
		}
	}
	return err
}

// Ready: đã kiểm / tạo bucket xong.
func (c *Client) Ready() bool { return c.ready.Load() }

// PresignPut: URL PUT (host = PublicURL) ký cả Content-Type + Content-Length; trả các header trình duyệt phải gửi
// (Content-Length trình duyệt tự đặt theo blob nên không có trong map).
func (c *Client) PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (string, map[string]string, error) {
	if size < 0 {
		return "", nil, errors.New("objstore: kích thước âm")
	}
	h := http.Header{}
	h.Set("Content-Type", contentType)
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	u, err := c.signer.PresignHeader(ctx, http.MethodPut, c.bucket, key, ttl, nil, h)
	if err != nil {
		return "", nil, err
	}
	return u.String(), map[string]string{"Content-Type": contentType}, nil
}

// PresignGet: URL GET (host = PublicURL); tham số trống thì không ghi đè header phản hồi tương ứng.
func (c *Client) PresignGet(ctx context.Context, key string, ttl time.Duration, contentType, disposition, cacheControl string) (string, error) {
	q := url.Values{}
	if contentType != "" {
		q.Set("response-content-type", contentType)
	}
	if disposition != "" {
		q.Set("response-content-disposition", disposition)
	}
	if cacheControl != "" {
		q.Set("response-cache-control", cacheControl)
	}
	u, err := c.signer.PresignedGetObject(ctx, c.bucket, key, ttl, q)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

func notFound(err error) bool {
	r := minio.ToErrorResponse(err)
	return r.Code == minio.NoSuchKey || r.StatusCode == http.StatusNotFound
}

// Stat: kích thước + Content-Type của object; không có -> found = false, err = nil.
func (c *Client) Stat(ctx context.Context, key string) (int64, string, bool, error) {
	oi, err := c.internal.StatObject(ctx, c.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if notFound(err) {
			return 0, "", false, nil
		}
		return 0, "", false, err
	}
	return oi.Size, oi.ContentType, true, nil
}

// Copy: chép phía server (giữ metadata, Content-Type) src -> dst trong cùng bucket.
func (c *Client) Copy(ctx context.Context, src, dst string) error {
	_, err := c.internal.CopyObject(ctx, minio.CopyDestOptions{Bucket: c.bucket, Object: dst},
		minio.CopySrcOptions{Bucket: c.bucket, Object: src})
	return err
}

// Open: đọc dạng luồng; lỗi ngay nếu object không có (người gọi phải Close).
func (c *Client) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	o, err := c.internal.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := o.Stat(); err != nil {
		o.Close()
		return nil, err
	}
	return o, nil
}

// ReadPrefix: tối đa n byte đầu của object (object ngắn hơn -> cả object).
func (c *Client) ReadPrefix(ctx context.Context, key string, n int64) ([]byte, error) {
	if n <= 0 {
		return []byte{}, nil
	}
	opts := minio.GetObjectOptions{}
	if err := opts.SetRange(0, n-1); err != nil {
		return nil, err
	}
	o, err := c.internal.GetObject(ctx, c.bucket, key, opts)
	if err != nil {
		return nil, err
	}
	defer o.Close()
	b, err := io.ReadAll(io.LimitReader(o, n))
	if err != nil {
		if minio.ToErrorResponse(err).Code == "InvalidRange" { // object rỗng
			if _, _, found, serr := c.Stat(ctx, key); serr == nil && found {
				return []byte{}, nil
			}
		}
		return nil, err
	}
	return b, nil
}

// ErrTooLarge: object lớn hơn maxBytes của Get.
var ErrTooLarge = errors.New("objstore: object vượt kích thước cho phép")

// Get: đọc cả object vào bộ nhớ; lớn hơn maxBytes -> ErrTooLarge (không đọc hết).
func (c *Client) Get(ctx context.Context, key string, maxBytes int64) ([]byte, error) {
	o, err := c.internal.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	defer o.Close()
	oi, err := o.Stat()
	if err != nil {
		return nil, err
	}
	if oi.Size > maxBytes {
		return nil, ErrTooLarge
	}
	b, err := io.ReadAll(io.LimitReader(o, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > maxBytes {
		return nil, ErrTooLarge
	}
	return b, nil
}

// Put: ghi object nhỏ (ảnh nhỏ, ảnh bìa) do server làm.
func (c *Client) Put(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := c.internal.PutObject(ctx, c.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	return err
}

// Remove: xoá các object; khoá không có không tính là lỗi.
func (c *Client) Remove(ctx context.Context, keys ...string) error {
	var first error
	for _, k := range keys {
		if k == "" {
			continue
		}
		if err := c.internal.RemoveObject(ctx, c.bucket, k, minio.RemoveObjectOptions{}); err != nil && !notFound(err) && first == nil {
			first = err
		}
	}
	return first
}
