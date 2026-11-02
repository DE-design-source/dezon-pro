// Package mailer: gửi email qua SMTP, chỉ dùng thư viện chuẩn của Go (net/smtp, mime, mime/multipart).
// Dùng cho mã OTP email của chat (SMTP_HOST / SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD / SMTP_FROM).
//
//   - Cổng 465: TLS ngay khi kết nối (SMTPS). Cổng khác: kết nối thường rồi STARTTLS nếu máy chủ hỗ trợ.
//   - Có Username: BẮT BUỘC kết nối đã TLS trước khi AUTH PLAIN (trừ máy chủ localhost / 127.0.0.1 / ::1),
//     không thì từ chối gửi chứ không lộ mật khẩu qua kết nối không mã hoá.
//   - Hạn của cả phiên SMTP = hạn sớm hơn giữa ctx và Config.Timeout; ctx huỷ giữa chừng -> cắt kết nối ngay.
//   - Thư: multipart/alternative (text/plain + text/html, UTF-8, base64 dòng <= 76 ký tự); html rỗng -> chỉ text/plain.
//     Tiêu đề mã hoá Q (RFC 2047) UTF-8. CR / LF trong người nhận, tiêu đề, người gửi bị từ chối (chặn chèn header).
//
// Client không giữ trạng thái giữa các lần gửi (mỗi lần 1 kết nối), an toàn khi gọi Send song song.
package mailer

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPort    = 587
	defaultTimeout = 15 * time.Second
	portTLS        = 465 // SMTPS: TLS ngay từ đầu
	b64LineLen     = 76  // RFC 2045: dòng base64 tối đa 76 ký tự
)

// Config: cấu hình máy chủ SMTP. Port 0 -> 587; Timeout 0 -> 15 giây.
// From là người gửi dạng "Dezon Chat <no-reply@dezon.vn>" hoặc "no-reply@dezon.vn".
type Config struct {
	Host                     string
	Port                     int
	Username, Password, From string
	Timeout                  time.Duration
}

// Client gửi email qua 1 máy chủ SMTP.
type Client struct {
	host, addr         string // addr = host:port
	port               int
	username, password string
	from               *mail.Address
	timeout            time.Duration

	// Móc cho test (không export).
	dial  func(ctx context.Context, addr string) (net.Conn, error) // mở kết nối TCP
	roots *x509.CertPool                                           // CA tin cậy khi bắt tay TLS; nil = của hệ thống
	now   func() time.Time                                         // đồng hồ cho header Date
}

// New kiểm cấu hình: Host rỗng hoặc From không đọc được bằng net/mail.ParseAddress -> lỗi.
func New(cfg Config) (*Client, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, errors.New("mailer: thiếu Host (SMTP_HOST)")
	}
	if strings.ContainsAny(host, "\r\n") {
		return nil, errors.New("mailer: Host (SMTP_HOST) có ký tự xuống dòng")
	}
	if strings.ContainsAny(cfg.From, "\r\n") {
		return nil, errors.New("mailer: người gửi (SMTP_FROM) có ký tự xuống dòng")
	}
	from, err := mail.ParseAddress(cfg.From)
	if err != nil {
		return nil, fmt.Errorf("mailer: người gửi (SMTP_FROM) không hợp lệ, vd \"Dezon Chat <no-reply@dezon.vn>\": %w", err)
	}
	port := cfg.Port
	if port == 0 {
		port = defaultPort
	}
	if port < 0 || port > 65535 {
		return nil, fmt.Errorf("mailer: cổng SMTP %d không hợp lệ", cfg.Port)
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	return &Client{
		host:     host,
		addr:     net.JoinHostPort(host, strconv.Itoa(port)),
		port:     port,
		username: cfg.Username,
		password: cfg.Password,
		from:     from,
		timeout:  timeout,
		dial: func(ctx context.Context, addr string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "tcp", addr)
		},
		now: time.Now,
	}, nil
}

// Send gửi 1 email tới to (1 địa chỉ, có thể kèm tên "Tên <a@b.vn>"). html rỗng -> thư chỉ có text/plain.
// Trả nil khi máy chủ SMTP đã nhận thư (trả 250 sau DATA); lỗi mạng / máy chủ từ chối / hết hạn -> error.
func (c *Client) Send(ctx context.Context, to, subject, text, html string) error {
	if strings.ContainsAny(to, "\r\n") {
		return errors.New("mailer: địa chỉ người nhận có ký tự xuống dòng")
	}
	if strings.ContainsAny(subject, "\r\n") {
		return errors.New("mailer: tiêu đề có ký tự xuống dòng")
	}
	rcpt, err := mail.ParseAddress(to)
	if err != nil {
		return fmt.Errorf("mailer: địa chỉ người nhận không hợp lệ: %w", err)
	}
	msg, err := c.build(rcpt, subject, text, html)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	conn, err := c.dial(ctx, c.addr)
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("mailer: dừng gửi (%w): %v", ctx.Err(), err)
		}
		return fmt.Errorf("mailer: không kết nối được %s: %w", c.addr, err)
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	// ctx huỷ / hết hạn -> mọi lệnh đọc / ghi đang chờ trên kết nối (kể cả bắt tay TLS) trả lỗi ngay
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Unix(1, 0)) })
	defer stop()

	if err := c.session(ctx, conn, rcpt.Address, msg); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("mailer: dừng gửi (%w): %v", ctx.Err(), err)
		}
		return err
	}
	return nil
}

// session: 1 phiên SMTP trên conn đã mở - (TLS) -> EHLO -> (STARTTLS) -> (AUTH PLAIN) -> MAIL FROM -> RCPT TO -> DATA -> QUIT.
func (c *Client) session(ctx context.Context, conn net.Conn, rcpt string, msg []byte) error {
	secure := false
	if c.port == portTLS {
		tc := tls.Client(conn, c.tlsConfig())
		if err := tc.HandshakeContext(ctx); err != nil {
			return fmt.Errorf("mailer: bắt tay TLS với %s lỗi: %w", c.addr, err)
		}
		conn, secure = tc, true // net/smtp nhận *tls.Conn -> tự biết kết nối đã mã hoá
	}
	sc, err := smtp.NewClient(conn, c.host)
	if err != nil {
		return fmt.Errorf("mailer: máy chủ SMTP %s không chào: %w", c.addr, err)
	}
	defer sc.Close()
	if !secure {
		if ok, _ := sc.Extension("STARTTLS"); ok {
			if err := sc.StartTLS(c.tlsConfig()); err != nil {
				return fmt.Errorf("mailer: STARTTLS với %s lỗi: %w", c.addr, err)
			}
			secure = true
		}
	}
	if c.username != "" {
		if !secure && !isLocal(c.host) {
			return fmt.Errorf("mailer: máy chủ SMTP %s không hỗ trợ TLS, không gửi mật khẩu qua kết nối không mã hoá", c.addr)
		}
		if ok, _ := sc.Extension("AUTH"); !ok {
			return fmt.Errorf("mailer: máy chủ SMTP %s không hỗ trợ đăng nhập (AUTH)", c.addr)
		}
		if err := sc.Auth(smtp.PlainAuth("", c.username, c.password, c.host)); err != nil {
			return fmt.Errorf("mailer: đăng nhập SMTP lỗi: %w", err)
		}
	}
	if err := sc.Mail(c.from.Address); err != nil {
		return fmt.Errorf("mailer: máy chủ từ chối người gửi %s: %w", c.from.Address, err)
	}
	if err := sc.Rcpt(rcpt); err != nil {
		return fmt.Errorf("mailer: máy chủ từ chối người nhận %s: %w", rcpt, err)
	}
	w, err := sc.Data()
	if err != nil {
		return fmt.Errorf("mailer: máy chủ từ chối DATA: %w", err)
	}
	if _, err := w.Write(msg); err != nil { // writer của net/smtp tự thêm dấu chấm ở dòng bắt đầu bằng "."
		return fmt.Errorf("mailer: lỗi khi gửi nội dung thư: %w", err)
	}
	if err := w.Close(); err != nil { // gửi "." rồi chờ máy chủ xác nhận đã nhận thư
		return fmt.Errorf("mailer: máy chủ không nhận thư: %w", err)
	}
	_ = sc.Quit() // thư đã được nhận, lỗi lúc QUIT không quan trọng
	return nil
}

func (c *Client) tlsConfig() *tls.Config {
	return &tls.Config{ServerName: c.host, RootCAs: c.roots, MinVersion: tls.VersionTLS12}
}

// isLocal: máy chủ trên chính máy này - net/smtp cũng chỉ cho AUTH PLAIN không TLS với đúng các tên này.
func isLocal(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// build dựng toàn bộ thư (header + thân, xuống dòng CRLF).
func (c *Client) build(rcpt *mail.Address, subject, text, html string) ([]byte, error) {
	id, err := c.messageID()
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	header := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	header("Date", c.now().Format(time.RFC1123Z))
	header("From", c.from.String()) // tên có dấu được net/mail mã hoá RFC 2047
	header("To", rcpt.String())
	header("Subject", encodeSubject(subject))
	header("Message-ID", id)
	header("MIME-Version", "1.0")

	if html == "" {
		header("Content-Type", "text/plain; charset=UTF-8")
		header("Content-Transfer-Encoding", "base64")
		b.WriteString("\r\n")
		writeBase64(&b, text)
		b.WriteString("\r\n")
		return b.Bytes(), nil
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, p := range []struct{ typ, content string }{{"text/plain", text}, {"text/html", html}} {
		w, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {p.typ + "; charset=UTF-8"},
			"Content-Transfer-Encoding": {"base64"},
		})
		if err != nil {
			return nil, fmt.Errorf("mailer: không dựng được thư: %w", err)
		}
		var part bytes.Buffer
		writeBase64(&part, p.content)
		if _, err := w.Write(part.Bytes()); err != nil {
			return nil, fmt.Errorf("mailer: không dựng được thư: %w", err)
		}
	}
	if err := mw.Close(); err != nil {
		return nil, fmt.Errorf("mailer: không dựng được thư: %w", err)
	}
	header("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
	b.WriteString("\r\n")
	b.Write(body.Bytes())
	return b.Bytes(), nil
}

// messageID: <32 ký tự hex ngẫu nhiên@tên miền của người gửi>.
func (c *Client) messageID() (string, error) {
	r := make([]byte, 16)
	if _, err := rand.Read(r); err != nil {
		return "", fmt.Errorf("mailer: không sinh được Message-ID: %w", err)
	}
	domain := c.from.Address[strings.LastIndexByte(c.from.Address, '@')+1:]
	if domain == "" {
		domain = "localhost"
	}
	return "<" + hex.EncodeToString(r) + "@" + domain + ">", nil
}

// encodeSubject: mã hoá Q UTF-8 (RFC 2047); tiêu đề dài bị net/mime tách nhiều encoded-word cách nhau 1 dấu cách,
// gấp mỗi chỗ tách xuống dòng mới (CRLF + dấu cách) để dòng header không quá dài.
func encodeSubject(s string) string {
	return strings.ReplaceAll(mime.QEncoding.Encode("UTF-8", s), "?= =?", "?=\r\n =?")
}

// writeBase64 ghi s dạng base64, mỗi dòng <= 76 ký tự, các dòng cách nhau CRLF (không có CRLF ở cuối).
func writeBase64(b *bytes.Buffer, s string) {
	enc := base64.StdEncoding.EncodeToString([]byte(s))
	for i := 0; i < len(enc); i += b64LineLen {
		if i > 0 {
			b.WriteString("\r\n")
		}
		b.WriteString(enc[i:min(i+b64LineLen, len(enc))])
	}
}
