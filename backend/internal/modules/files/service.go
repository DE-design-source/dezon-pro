// Package files: tải ảnh cũ lưu trên Lark Drive (file_token) - bản chuyển của server/lark.js và route GET /media
// (server/index.js dòng 635-646). Ảnh mới nằm trong kho trên đĩa (platform/storage, /files/...), không đi qua đây.
package files

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"qspro-backend/internal/config"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/httpx"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Deps: module chỉ cần cấu hình Lark (LarkDomain, LarkAppID, LarkAppSecret).
type Deps struct {
	Cfg *config.Config
}

// Service: nghiệp vụ của module.
type Service struct {
	cfg  *config.Config
	http *http.Client
	// bodyTimeout của undici: thân phản hồi đứng yên quá lâu thì huỷ
	bodyTimeout time.Duration

	mu    sync.Mutex
	token *larkToken // _token của lark.js: dùng chung cho mọi request
	// now = Date.now(); test thay bằng đồng hồ giả để kiểm tra hạn của token
	now func() float64
}

var _ contracts.MediaDownloader = (*Service)(nil)

// errFetch: fetch của Node gói mọi lỗi mạng thành TypeError "fetch failed"; lỗi gốc giữ lại để ghi log.
type errFetch struct {
	msg   string
	cause error
}

func (e *errFetch) Error() string { return e.msg }
func (e *errFetch) Unwrap() error { return e.cause }

// New tạo service.
func New(d Deps) *Service {
	// fetch của Node (undici): chỉ HTTP/1.1, hạn kết nối 10 giây, hạn chờ header 300 giây, hạn thân đứng yên 300 giây,
	// đi theo tối đa 20 lần chuyển hướng.
	tr := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		ResponseHeaderTimeout: 300 * time.Second,
		TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{},
		MaxIdleConns:          20,
		IdleConnTimeout:       60 * time.Second,
	}
	// OneShot: fetch không tự gửi lại GET khi kết nối bị đóng (Lark chỉ nhận 1 request như bản Node)
	cl := &http.Client{Transport: httpx.OneShot(tr), CheckRedirect: func(_ *http.Request, via []*http.Request) error {
		if len(via) > 20 {
			return errors.New("redirect count exceeded")
		}
		return nil
	}}
	return &Service{cfg: d.Cfg, http: cl, bodyTimeout: 300 * time.Second, now: jsval.NowMs}
}

// headerFetch đặt các header fetch của Node luôn gửi kèm (Accept-Encoding để net/http tự lo).
func headerFetch(req *http.Request) {
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "*")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("User-Agent", "node")
}

// byteString = cách fetch nhận giá trị header: ký tự trên 255 hoặc NUL / CR / LF -> TypeError (không gửi request);
// còn lại gửi theo Latin-1 (1 ký tự = 1 byte), bỏ khoảng trắng hai đầu.
func byteString(v string) (string, error) {
	u := utf16.Encode([]rune(v))
	for i, c := range u {
		if c > 255 {
			return "", apperr.New("Cannot convert argument to a ByteString because the character at index " + strconv.Itoa(i) +
				" has a value of " + strconv.Itoa(int(c)) + " which is greater than 255.")
		}
	}
	b := make([]byte, len(u))
	for i, c := range u {
		b[i] = byte(c)
	}
	out := strings.Trim(string(b), "\t\n\r ")
	if strings.ContainsAny(out, "\x00\r\n") {
		gia := strings.Trim(v, "\t\n\r ")
		return "", apperr.New(`Headers.append: "` + gia + `" is an invalid header value.`)
	}
	return out, nil
}

// do gửi request rồi đọc hết thân; cancel khi thân đứng yên quá bodyTimeout.
func (s *Service) do(ctx context.Context, req *http.Request) (*http.Response, []byte, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	res, err := s.http.Do(req.WithContext(ctx))
	if err != nil {
		return nil, nil, &errFetch{"fetch failed", err}
	}
	defer res.Body.Close()
	timer := time.AfterFunc(s.bodyTimeout, cancel)
	defer timer.Stop()
	var buf bytes.Buffer
	chunk := make([]byte, 32<<10)
	for {
		n, err := res.Body.Read(chunk)
		buf.Write(chunk[:n])
		timer.Reset(s.bodyTimeout)
		if err == io.EOF {
			return res, buf.Bytes(), nil
		}
		if err != nil {
			return nil, nil, &errFetch{"terminated", err}
		}
	}
}

// tenantToken = tenantToken(force): tenant_access_token của app Lark, giữ lại tới khi còn dưới 60 giây.
// Không giữ khoá trong lúc gọi mạng (như Node: hai request cùng lúc có thể cùng xin token, bản sau ghi đè).
func (s *Service) tenantToken(ctx context.Context, force bool) (any, error) {
	now := s.now()
	s.mu.Lock()
	t := s.token
	s.mu.Unlock()
	if !force && t != nil && t.exp-now > 60*1000 {
		return t.value, nil
	}
	if s.cfg.LarkAppID == "" || s.cfg.LarkAppSecret == "" {
		return nil, apperr.New("Thiếu LARK_APP_ID / LARK_APP_SECRET")
	}
	body, err := omap.Marshal(omap.Of("app_id", s.cfg.LarkAppID, "app_secret", s.cfg.LarkAppSecret))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.LarkDomain+"/open-apis/auth/v3/tenant_access_token/internal", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	headerFetch(req)
	_, raw, err := s.do(ctx, req)
	if err != nil {
		return nil, err
	}
	// res.json(): không xét mã HTTP, bỏ BOM UTF-8 đầu thân, thân không phải JSON -> lỗi
	data, err := omap.Decode(bytes.TrimPrefix(raw, []byte("\xEF\xBB\xBF")))
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, apperr.New("Cannot read properties of null (reading 'code')")
	}
	if code := jsval.Get(data, "code"); !jsval.StrictEquals(code, 0.0) {
		return nil, apperr.New("Lấy tenant_access_token lỗi: " + jsval.ToString(code) + " " + jsval.ToString(jsval.Get(data, "msg")))
	}
	t = &larkToken{value: jsval.Get(data, "tenant_access_token"), exp: now + jsval.NumOr(jsval.Get(data, "expire"), 7200)*1000}
	s.mu.Lock()
	s.token = t
	s.mu.Unlock()
	return t.value, nil
}

// MediaDownload = lark.mediaDownload(fileToken): nội dung + content-type của 1 file_token.
// fileToken là giá trị đã giải mã; hàm tự encodeURIComponent khi ghép URL.
func (s *Service) MediaDownload(ctx context.Context, fileToken string) ([]byte, string, error) {
	token, err := s.tenantToken(ctx, false)
	if err != nil {
		return nil, "", err
	}
	// fetch chuẩn hoá URL theo WHATWG: đoạn "." bị bỏ, ".." bỏ luôn đoạn đứng trước nó
	base, seg := s.cfg.LarkDomain+"/open-apis/drive/v1/", jsval.EncodeURIComponent(fileToken)
	url := base + "medias/" + seg + "/download"
	switch seg {
	case ".":
		url = base + "medias/download"
	case "..":
		url = base + "download"
	}
	auth, err := byteString("Bearer " + jsval.ToString(token))
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", auth)
	headerFetch(req)
	res, buf, err := s.do(ctx, req)
	if err != nil {
		return nil, "", err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, "", apperr.New("Tải media lỗi HTTP " + jsval.ToString(float64(res.StatusCode)))
	}
	// headers.get(): các dòng content-type lặp được nối bằng ", "
	ct := strings.Join(res.Header.Values("Content-Type"), ", ")
	if ct == "" {
		ct = "application/octet-stream"
	}
	return buf, ct, nil
}
