// Package webpush: gửi thông báo Web Push tới trình duyệt theo chuẩn IETF, chỉ dùng thư viện chuẩn của Go
// (không cần FCM / tài khoản bên thứ ba - trình duyệt tự chọn dịch vụ push: FCM cho Chrome, Mozilla autopush, Apple...).
//
//   - Mã hoá nội dung: RFC 8291 (ECDH P-256 + HKDF-SHA256 + AES-128-GCM), Content-Encoding "aes128gcm" của RFC 8188,
//     đúng 1 record, rs = 4096, không đệm thêm. Mỗi tin dùng khoá ECDH tạm + salt ngẫu nhiên mới.
//   - Định danh máy chủ: VAPID RFC 8292 - header "Authorization: vapid t=<JWT ES256>, k=<khoá công khai>",
//     JWT có aud = origin của endpoint, exp = lúc gửi + 12 giờ, sub = Options.Subject.
//
// Khoá VAPID sinh 1 lần bằng `go run ./cmd/vapid` (từ backend/) rồi giữ cố định: đổi khoá thì mọi đăng ký thông báo
// cũ của trình duyệt mất hiệu lực. Subscription là chuỗi JSON PushSubscription của trình duyệt
// ({"endpoint":"https://...","keys":{"p256dh":"...","auth":"..."}}), chat lưu nguyên chuỗi ở chat_devices.push_token.
// Client an toàn khi gọi Send song song từ nhiều goroutine.
package webpush

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultTimeout = 30 * time.Second // HTTPClient mặc định khi Options.HTTPClient = nil
	excerptLen     = 200              // số byte thân phản hồi lỗi đưa vào error
	maxTopicLen    = 32               // RFC 8030 mục 5.4
)

// Options: cấu hình Client. PublicKey / PrivateKey là chuỗi base64url của GenerateVAPIDKeys
// (CHAT_VAPID_PUBLIC_KEY / CHAT_VAPID_PRIVATE_KEY); Subject là URI liên hệ "https://<tên miền>" hoặc "mailto:<email>"
// (CHAT_VAPID_SUBJECT). HTTPClient nil -> client riêng, timeout 30 giây.
type Options struct {
	PublicKey, PrivateKey, Subject string
	HTTPClient                     *http.Client
}

// Client gửi Web Push bằng 1 cặp khoá VAPID.
type Client struct {
	pub     string // khoá công khai base64url không đệm (tham số k=, applicationServerKey phía trình duyệt)
	priv    *ecdsa.PrivateKey
	subject string
	hc      *http.Client

	// Móc cho test (không export).
	now           func() time.Time                         // đồng hồ cho exp của JWT
	ephemeral     func() (*ecdh.PrivateKey, []byte, error) // khoá ECDH tạm + salt 16 byte của mỗi tin
	allowInsecure bool                                     // cho phép endpoint http:// (httptest.NewServer)
}

// GenerateVAPIDKeys sinh cặp khoá VAPID P-256 mới, trả base64url không đệm:
// khoá công khai = điểm không nén 65 byte (0x04 || X || Y), khoá bí mật = số vô hướng 32 byte.
func GenerateVAPIDKeys() (publicKey, privateKey string, err error) {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("webpush: không sinh được khoá VAPID: %w", err)
	}
	pub, err := k.PublicKey.Bytes()
	if err != nil {
		return "", "", fmt.Errorf("webpush: không mã hoá được khoá công khai: %w", err)
	}
	priv, err := k.Bytes()
	if err != nil {
		return "", "", fmt.Errorf("webpush: không mã hoá được khoá bí mật: %w", err)
	}
	return b64(pub), b64(priv), nil
}

// New kiểm cặp khoá VAPID (đúng độ dài, nằm trên đường cong P-256, khoá công khai khớp khoá bí mật) và Subject.
func New(o Options) (*Client, error) {
	subject := strings.TrimSpace(o.Subject)
	if subject == "" {
		return nil, errors.New("webpush: thiếu Subject (CHAT_VAPID_SUBJECT), vd https://<tên miền> hoặc mailto:<email>")
	}
	if !strings.HasPrefix(subject, "https://") && !strings.HasPrefix(subject, "mailto:") {
		return nil, errors.New("webpush: Subject (CHAT_VAPID_SUBJECT) phải bắt đầu bằng https:// hoặc mailto:")
	}
	pubRaw, err := decodeB64(o.PublicKey)
	if err != nil || len(pubRaw) != 65 || pubRaw[0] != 0x04 {
		return nil, errors.New("webpush: khoá công khai VAPID không hợp lệ (cần base64url của điểm P-256 không nén 65 byte)")
	}
	if _, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pubRaw); err != nil {
		return nil, errors.New("webpush: khoá công khai VAPID không nằm trên đường cong P-256")
	}
	privRaw, err := decodeB64(o.PrivateKey)
	if err != nil || len(privRaw) != 32 {
		return nil, errors.New("webpush: khoá bí mật VAPID không hợp lệ (cần base64url của số 32 byte)")
	}
	priv, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), privRaw)
	if err != nil {
		return nil, errors.New("webpush: khoá bí mật VAPID không hợp lệ trên đường cong P-256")
	}
	derived, err := priv.PublicKey.Bytes()
	if err != nil || !bytes.Equal(derived, pubRaw) {
		return nil, errors.New("webpush: khoá công khai VAPID không khớp khoá bí mật")
	}
	hc := o.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: defaultTimeout}
	}
	return &Client{
		pub:       b64(pubRaw),
		priv:      priv,
		subject:   subject,
		hc:        hc,
		now:       time.Now,
		ephemeral: randomEphemeral,
	}, nil
}

// PublicKey: khoá công khai VAPID (base64url không đệm) - trình duyệt dùng làm applicationServerKey khi subscribe.
func (c *Client) PublicKey() string { return c.pub }

// Send mã hoá payload (RFC 8291, Content-Encoding aes128gcm, record size 4096, 1 record) rồi POST tới endpoint của
// subscription kèm VAPID (RFC 8292: Authorization: vapid t=<JWT ES256 aud=origin của endpoint, exp = +12 giờ, sub>,
// k=<khoá công khai>). ttl = số giây dịch vụ push giữ tin khi thiết bị offline (>= 0); urgency very-low|low|normal|high
// (rỗng = normal); topic rỗng = không gửi, có thì <= 32 ký tự base64url (tin mới cùng topic thay tin cũ chưa giao).
// Trả mã HTTP của dịch vụ push; gone = true khi 404/410 (subscription hết hạn: bên gọi xoá push_token, err = nil).
// Mã 2xx -> err nil; mã khác -> err kèm mã + một đoạn thân phản hồi; lỗi mạng -> status 0.
// Payload tối đa maxPayload byte; dịch vụ push chỉ buộc phải nhận thân 4096 byte (~3993 byte payload).
func (c *Client) Send(ctx context.Context, subscriptionJSON string, payload []byte, ttl int, urgency, topic string) (status int, gone bool, err error) {
	sub, err := c.parseSubscription(subscriptionJSON)
	if err != nil {
		return 0, false, err
	}
	if ttl < 0 {
		return 0, false, errors.New("webpush: TTL không được âm")
	}
	if urgency == "" {
		urgency = "normal"
	}
	switch urgency {
	case "very-low", "low", "normal", "high":
	default:
		return 0, false, fmt.Errorf("webpush: Urgency %q không hợp lệ (very-low|low|normal|high)", urgency)
	}
	if !validTopic(topic) {
		return 0, false, fmt.Errorf("webpush: Topic %q không hợp lệ (tối đa %d ký tự A-Z a-z 0-9 - _)", topic, maxTopicLen)
	}
	if len(payload) > maxPayload {
		return 0, false, errPayloadTooLarge
	}
	asPriv, salt, err := c.ephemeral()
	if err != nil {
		return 0, false, fmt.Errorf("webpush: không sinh được khoá tạm: %w", err)
	}
	body, err := encrypt(payload, sub.p256dh, sub.auth, asPriv, salt)
	if err != nil {
		return 0, false, err
	}
	jwt, err := c.vapidToken(origin(sub.endpoint))
	if err != nil {
		return 0, false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.rawEndpoint, bytes.NewReader(body))
	if err != nil {
		return 0, false, fmt.Errorf("webpush: không tạo được request: %w", err)
	}
	req.Header.Set("TTL", strconv.Itoa(ttl))
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Urgency", urgency)
	if topic != "" {
		req.Header.Set("Topic", topic)
	}
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+c.pub)

	resp, err := c.hc.Do(req)
	if err != nil {
		// Bỏ URL khỏi lỗi: đường dẫn endpoint là bí mật của subscription, không ghi ra log.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return 0, false, fmt.Errorf("webpush: không gửi được tới %s: %w", sub.endpoint.Host, err)
	}
	defer resp.Body.Close()
	excerpt, _ := io.ReadAll(io.LimitReader(resp.Body, excerptLen))
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)) // xả phần còn lại để tái dùng kết nối

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return resp.StatusCode, false, nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return resp.StatusCode, true, nil
	}
	return resp.StatusCode, false, fmt.Errorf("webpush: %s trả mã %d: %s", sub.endpoint.Host, resp.StatusCode, cleanExcerpt(excerpt))
}

// ValidateSubscription kiểm chuỗi PushSubscription JSON đúng như Send kiểm (endpoint https, keys.p256dh là điểm P-256
// không nén 65 byte, keys.auth 16 byte). Bên lưu subscription (POST /chat/devices/push) dùng hàm này để không lưu
// token mà Send sẽ luôn từ chối (thử lại mãi không bao giờ gỡ).
func ValidateSubscription(subscriptionJSON string) error {
	_, err := (&Client{}).parseSubscription(subscriptionJSON)
	return err
}

// subscription: PushSubscription của trình duyệt đã kiểm.
type subscription struct {
	endpoint    *url.URL
	rawEndpoint string          // gửi nguyên chuỗi của trình duyệt, không qua url.String() để khỏi đổi cách mã hoá đường dẫn
	p256dh      *ecdh.PublicKey // khoá ECDH của trình duyệt (ua_public)
	auth        []byte          // auth secret 16 byte
}

func (c *Client) parseSubscription(s string) (*subscription, error) {
	var raw struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.Unmarshal([]byte(s), &raw); err != nil {
		return nil, errors.New("webpush: subscription không phải JSON PushSubscription hợp lệ")
	}
	rawEndpoint := strings.TrimSpace(raw.Endpoint)
	u, err := url.Parse(rawEndpoint)
	if err != nil || u.Host == "" || u.Hostname() == "" {
		return nil, errors.New("webpush: subscription thiếu endpoint hoặc endpoint không phải URL")
	}
	if u.Scheme != "https" && !(c.allowInsecure && u.Scheme == "http") {
		return nil, errors.New("webpush: endpoint của subscription phải là URL https://")
	}
	pk, err := decodeB64(raw.Keys.P256dh)
	if err != nil {
		return nil, errors.New("webpush: keys.p256dh không phải base64url")
	}
	p256dh, err := ecdh.P256().NewPublicKey(pk)
	if err != nil {
		return nil, errors.New("webpush: keys.p256dh không phải khoá P-256 không nén 65 byte")
	}
	auth, err := decodeB64(raw.Keys.Auth)
	if err != nil || len(auth) != 16 {
		return nil, errors.New("webpush: keys.auth phải là base64url của 16 byte")
	}
	return &subscription{endpoint: u, rawEndpoint: rawEndpoint, p256dh: p256dh, auth: auth}, nil
}

// origin: chuỗi origin RFC 6454 của endpoint (scheme://host[:port], bỏ cổng mặc định) - giá trị aud của JWT.
func origin(u *url.URL) string {
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		return scheme + "://" + net.JoinHostPort(host, port)
	}
	if strings.Contains(host, ":") { // IPv6
		host = "[" + host + "]"
	}
	return scheme + "://" + host
}

// validTopic: rỗng hoặc 1..32 ký tự trong bảng chữ base64url (RFC 8030 mục 5.4).
func validTopic(t string) bool {
	if len(t) > maxTopicLen {
		return false
	}
	for i := 0; i < len(t); i++ {
		ch := t[i]
		if !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func randomEphemeral() (*ecdh.PrivateKey, []byte, error) {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, nil, err
	}
	return k, salt, nil
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// decodeB64 nhận base64url có hoặc không có '=' đệm; chấp nhận cả bảng chữ base64 thường (+ /) cho dễ dán khoá.
func decodeB64(s string) ([]byte, error) {
	s = strings.TrimRight(strings.TrimSpace(s), "=")
	if s == "" {
		return nil, errors.New("rỗng")
	}
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

// cleanExcerpt: đoạn thân phản hồi lỗi trên 1 dòng, UTF-8 hợp lệ (có thể bị cắt giữa ký tự).
func cleanExcerpt(b []byte) string {
	s := strings.Join(strings.Fields(strings.ToValidUTF8(string(b), "")), " ")
	if s == "" {
		return "(không có nội dung)"
	}
	return s
}
