package mailer

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// ════════ Máy chủ SMTP giả ════════

// smtpGia: máy chủ SMTP tối giản trên 127.0.0.1, ghi lại lệnh và nội dung DATA (đã bỏ dot-stuffing).
type smtpGia struct {
	ln       net.Listener
	tlsCfg   *tls.Config // khác nil: quảng cáo STARTTLS
	tlsNgay  bool        // true: TLS ngay khi kết nối (kiểu cổng 465)
	auth     bool        // quảng cáo AUTH PLAIN
	treo     string      // "chao": không gửi lời chào; "data": im lặng sau khi nhận nội dung DATA
	mu       sync.Mutex
	lenh     []string
	thu      []string
	ketNoi   int
	authPlay string // phần base64 sau "AUTH PLAIN"
	dong     chan struct{}
}

func moSMTP(t *testing.T, s *smtpGia) *smtpGia {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if s.tlsNgay {
		ln = tls.NewListener(ln, s.tlsCfg)
	}
	s.ln, s.dong = ln, make(chan struct{})
	t.Cleanup(func() { close(s.dong); ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.ketNoi++
			s.mu.Unlock()
			go s.phucVu(conn)
		}
	}()
	return s
}

func (s *smtpGia) cong() int { return s.ln.Addr().(*net.TCPAddr).Port }

func (s *smtpGia) ghi(l string) {
	s.mu.Lock()
	s.lenh = append(s.lenh, l)
	s.mu.Unlock()
}

func (s *smtpGia) layLenh() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.lenh...)
}

func (s *smtpGia) layThu() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.thu...)
}

func (s *smtpGia) layAuth() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.authPlay
}

func (s *smtpGia) phucVu(conn net.Conn) {
	defer conn.Close()
	if s.treo == "chao" {
		<-s.dong
		return
	}
	tp := textproto.NewConn(conn)
	tp.PrintfLine("220 smtp-gia ESMTP")
	daTLS := s.tlsNgay
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		s.ghi(line)
		cmd := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(cmd, "EHLO "):
			ext := []string{"smtp-gia", "8BITMIME"}
			if s.tlsCfg != nil && !daTLS {
				ext = append(ext, "STARTTLS")
			}
			if s.auth {
				ext = append(ext, "AUTH PLAIN")
			}
			for i, e := range ext {
				sep := "-"
				if i == len(ext)-1 {
					sep = " "
				}
				tp.PrintfLine("250%s%s", sep, e)
			}
		case cmd == "STARTTLS":
			tp.PrintfLine("220 bắt đầu TLS")
			tc := tls.Server(conn, s.tlsCfg)
			if tc.Handshake() != nil {
				return
			}
			conn, tp, daTLS = tc, textproto.NewConn(tc), true
		case strings.HasPrefix(cmd, "AUTH PLAIN "):
			s.mu.Lock()
			s.authPlay = line[len("AUTH PLAIN "):]
			s.mu.Unlock()
			tp.PrintfLine("235 2.7.0 đăng nhập xong")
		case strings.HasPrefix(cmd, "MAIL FROM:"), strings.HasPrefix(cmd, "RCPT TO:"):
			tp.PrintfLine("250 ok")
		case cmd == "DATA":
			tp.PrintfLine("354 gửi đi, kết thúc bằng <CRLF>.<CRLF>")
			b, err := tp.ReadDotBytes()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.thu = append(s.thu, string(b))
			s.mu.Unlock()
			if s.treo == "data" {
				<-s.dong
				return
			}
			tp.PrintfLine("250 2.0.0 đã nhận")
		case cmd == "QUIT":
			tp.PrintfLine("221 tạm biệt")
			return
		default:
			tp.PrintfLine("502 không hỗ trợ")
		}
	}
}

// chungChiThu: chứng chỉ tự ký cho smtp.example.com + tập CA chỉ chứa nó.
func chungChiThu(t *testing.T) (*tls.Config, *x509.CertPool) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "smtp.example.com"}, DNSNames: []string{"smtp.example.com"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IsCA: true, BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: k}}}, pool
}

// clientToi: Client có Host = host nhưng thật ra nối tới máy chủ giả (giữ đúng ServerName khi bắt tay TLS).
func clientToi(t *testing.T, s *smtpGia, cfg Config, roots *x509.CertPool) *Client {
	t.Helper()
	if cfg.From == "" {
		cfg.From = "Dezon Chat <no-reply@dezon.vn>"
	}
	c, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	that := net.JoinHostPort("127.0.0.1", strconv.Itoa(s.cong()))
	c.dial = func(ctx context.Context, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "tcp", that)
	}
	c.roots = roots
	return c
}

// ════════ Đọc lại thư ════════

type thuDoc struct {
	h          mail.Header
	subject    string
	text, html string
}

// docThu tách thư nhận được (ReadDotBytes đã đổi CRLF thành LF): giải mã tiêu đề, giải base64 từng phần;
// kiểm mọi dòng <= 998 byte, dòng base64 <= 76 ký tự.
func docThu(t *testing.T, raw string) thuDoc {
	t.Helper()
	for _, l := range strings.Split(raw, "\n") {
		if len(l) > 998 {
			t.Errorf("dòng dài %d byte (> 998)", len(l))
		}
	}
	m, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	var dec mime.WordDecoder
	subject, err := dec.DecodeHeader(m.Header.Get("Subject"))
	if err != nil {
		t.Fatalf("tiêu đề %q: %v", m.Header.Get("Subject"), err)
	}
	out := thuDoc{h: m.Header, subject: subject}
	mt, params, err := mime.ParseMediaType(m.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	giai := func(r io.Reader) string {
		b, err := io.ReadAll(r)
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range strings.Split(strings.TrimRight(string(b), "\r\n"), "\n") {
			if len(strings.TrimSuffix(l, "\r")) > 76 {
				t.Errorf("dòng base64 dài %d ký tự (> 76)", len(l))
			}
		}
		v, err := base64.StdEncoding.DecodeString(strings.NewReplacer("\r", "", "\n", "").Replace(string(b)))
		if err != nil {
			t.Fatalf("base64: %v", err)
		}
		return string(v)
	}
	if mt == "text/plain" {
		out.text = giai(m.Body)
		return out
	}
	if mt != "multipart/alternative" {
		t.Fatalf("Content-Type %q", mt)
	}
	mr := multipart.NewReader(m.Body, params["boundary"])
	for {
		p, err := mr.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if enc := p.Header.Get("Content-Transfer-Encoding"); enc != "base64" {
			t.Errorf("Content-Transfer-Encoding %q", enc)
		}
		switch p.Header.Get("Content-Type") {
		case "text/plain; charset=UTF-8":
			out.text = giai(p)
		case "text/html; charset=UTF-8":
			out.html = giai(p)
		default:
			t.Errorf("phần lạ: %q", p.Header.Get("Content-Type"))
		}
	}
	return out
}

// ════════ Test ════════

func TestNew(t *testing.T) {
	for _, cfg := range []Config{
		{Host: "", From: "no-reply@dezon.vn"},
		{Host: "   ", From: "no-reply@dezon.vn"},
		{Host: "smtp.x.vn", From: ""},
		{Host: "smtp.x.vn", From: "khong-phai-email"},
		{Host: "smtp.x.vn", From: "Dezon <no-reply@dezon.vn"},
		{Host: "smtp.x.vn", From: "no-reply@dezon.vn\r\nBcc: a@b.vn"},
		{Host: "smtp.x.vn\r\nX: y", From: "no-reply@dezon.vn"},
		{Host: "smtp.x.vn", From: "no-reply@dezon.vn", Port: 70000},
	} {
		if _, err := New(cfg); err == nil {
			t.Errorf("New(%+v) phải lỗi", cfg)
		}
	}
	c, err := New(Config{Host: " smtp.x.vn ", From: "Dezon Chat <no-reply@dezon.vn>"})
	if err != nil {
		t.Fatal(err)
	}
	if c.port != 587 || c.addr != "smtp.x.vn:587" || c.timeout != 15*time.Second || c.from.Address != "no-reply@dezon.vn" {
		t.Errorf("mặc định: cổng %d, addr %q, hạn %v, from %q", c.port, c.addr, c.timeout, c.from.Address)
	}
	c, err = New(Config{Host: "smtp.x.vn", Port: 465, From: "no-reply@dezon.vn", Timeout: time.Second})
	if err != nil || c.port != 465 || c.addr != "smtp.x.vn:465" || c.timeout != time.Second {
		t.Errorf("cổng 465: %+v %v", c, err)
	}
}

// Kết nối thường, không AUTH: đúng thứ tự lệnh, thư multipart giải mã đúng, dấu chấm đầu dòng không làm hỏng nội dung.
func TestSendThuong(t *testing.T) {
	s := moSMTP(t, &smtpGia{})
	c, err := New(Config{Host: "127.0.0.1", Port: s.cong(), From: "Dezon Chat <no-reply@dezon.vn>"})
	if err != nil {
		t.Fatal(err)
	}
	c.now = func() time.Time { return time.Date(2026, 11, 2, 9, 30, 0, 0, time.FixedZone("ICT", 7*3600)) }
	subject := "Mã xác thực Dezon Chat - mã gồm 6 chữ số, hết hạn sau 5 phút, đừng chia sẻ với bất kỳ ai"
	text := "Mã xác thực: 123456\n.\n..hai chấm\r\n.\r\nHết hạn sau 5 phút.\n" + strings.Repeat("dài ", 200)
	html := "<p>Mã xác thực: <b>123456</b></p>\n.\n<p>.dấu chấm đầu dòng</p>"
	if err := c.Send(context.Background(), "nguoi.nhan@dezon.vn", subject, text, html); err != nil {
		t.Fatal(err)
	}
	lenh := s.layLenh()
	want := []string{"EHLO localhost", "MAIL FROM:<no-reply@dezon.vn>", "RCPT TO:<nguoi.nhan@dezon.vn>", "DATA", "QUIT"}
	var chinh []string
	for _, l := range lenh {
		if !strings.HasPrefix(l, "MAIL FROM:") {
			chinh = append(chinh, l)
			continue
		}
		chinh = append(chinh, strings.SplitN(l, " BODY=", 2)[0]) // net/smtp thêm BODY=8BITMIME khi máy chủ hỗ trợ
	}
	if strings.Join(chinh, "|") != strings.Join(want, "|") {
		t.Errorf("lệnh:\n got %q\nwant %q", chinh, want)
	}
	thu := s.layThu()
	if len(thu) != 1 {
		t.Fatalf("số thư nhận %d", len(thu))
	}
	m := docThu(t, thu[0])
	if m.subject != subject || m.text != text || m.html != html {
		t.Errorf("nội dung sai:\nsubject %q\ntext %q\nhtml %q", m.subject, m.text, m.html)
	}
	if strings.Contains(thu[0], "Mã xác thực") {
		t.Error("tiêu đề / thân có ký tự UTF-8 chưa mã hoá")
	}
	from, err := m.h.AddressList("From")
	if err != nil || len(from) != 1 || from[0].Name != "Dezon Chat" || from[0].Address != "no-reply@dezon.vn" {
		t.Errorf("From: %v %v", from, err)
	}
	if to, err := m.h.AddressList("To"); err != nil || len(to) != 1 || to[0].Address != "nguoi.nhan@dezon.vn" {
		t.Errorf("To: %v %v", to, err)
	}
	if d, err := m.h.Date(); err != nil || !d.Equal(c.now()) {
		t.Errorf("Date: %v %v", d, err)
	}
	if id := m.h.Get("Message-ID"); !strings.HasPrefix(id, "<") || !strings.HasSuffix(id, "@dezon.vn>") || len(id) != len("<@dezon.vn>")+32 {
		t.Errorf("Message-ID %q", id)
	}
	if v := m.h.Get("MIME-Version"); v != "1.0" {
		t.Errorf("MIME-Version %q", v)
	}
}

// html rỗng -> thư chỉ có text/plain; người gửi có tên tiếng Việt vẫn đọc lại đúng.
func TestSendChiText(t *testing.T) {
	s := moSMTP(t, &smtpGia{})
	c := clientToi(t, s, Config{Host: "localhost", From: "Trò chuyện Dezon <no-reply@dezon.vn>"}, nil)
	if err := c.Send(context.Background(), "Người Nhận <a@b.vn>", "Xin chào", "Nội dung\n.\nhết", ""); err != nil {
		t.Fatal(err)
	}
	m := docThu(t, s.layThu()[0])
	if m.text != "Nội dung\n.\nhết" || m.html != "" || m.subject != "Xin chào" {
		t.Errorf("thư: %+v", m)
	}
	if from, err := m.h.AddressList("From"); err != nil || from[0].Name != "Trò chuyện Dezon" {
		t.Errorf("From: %v %v", from, err)
	}
	if !strings.Contains(strings.Join(s.layLenh(), "|"), "RCPT TO:<a@b.vn>") {
		t.Errorf("RCPT TO phải chỉ có địa chỉ: %q", s.layLenh())
	}
}

// STARTTLS rồi AUTH PLAIN: máy chủ quảng cáo STARTTLS thì client nâng TLS (kiểm chứng chỉ theo Host) trước khi đăng nhập.
func TestSendSTARTTLSAuth(t *testing.T) {
	tlsCfg, roots := chungChiThu(t)
	s := moSMTP(t, &smtpGia{tlsCfg: tlsCfg, auth: true})
	c := clientToi(t, s, Config{Host: "smtp.example.com", Username: "nguoi-gui", Password: "mật khẩu"}, roots)
	if err := c.Send(context.Background(), "a@b.vn", "Mã", "123456", "<b>123456</b>"); err != nil {
		t.Fatal(err)
	}
	lenh := strings.Join(s.layLenh(), "|")
	if !strings.HasPrefix(lenh, "EHLO localhost|STARTTLS|EHLO localhost|AUTH PLAIN ") {
		t.Errorf("thứ tự lệnh: %s", lenh)
	}
	b, _ := base64.StdEncoding.DecodeString(s.layAuth())
	if string(b) != "\x00nguoi-gui\x00mật khẩu" {
		t.Errorf("AUTH PLAIN %q", b)
	}
	if n := len(s.layThu()); n != 1 {
		t.Errorf("số thư %d", n)
	}

	// chứng chỉ không khớp CA -> không gửi gì sau STARTTLS
	s2 := moSMTP(t, &smtpGia{tlsCfg: tlsCfg, auth: true})
	c2 := clientToi(t, s2, Config{Host: "smtp.example.com", Username: "u", Password: "p"}, x509.NewCertPool())
	if err := c2.Send(context.Background(), "a@b.vn", "Mã", "1", ""); err == nil {
		t.Error("chứng chỉ lạ phải lỗi")
	}
	if l := strings.Join(s2.layLenh(), "|"); strings.Contains(l, "AUTH") || strings.Contains(l, "MAIL") {
		t.Errorf("chứng chỉ lạ mà vẫn gửi lệnh: %s", l)
	}
}

// Cổng 465: TLS ngay khi kết nối, không STARTTLS.
func TestSendTLS465(t *testing.T) {
	tlsCfg, roots := chungChiThu(t)
	s := moSMTP(t, &smtpGia{tlsCfg: tlsCfg, tlsNgay: true, auth: true})
	c := clientToi(t, s, Config{Host: "smtp.example.com", Port: 465, Username: "u", Password: "p"}, roots)
	if err := c.Send(context.Background(), "a@b.vn", "Mã xác thực", "123456", "<b>123456</b>"); err != nil {
		t.Fatal(err)
	}
	lenh := strings.Join(s.layLenh(), "|")
	if strings.Contains(lenh, "STARTTLS") || !strings.Contains(lenh, "AUTH PLAIN ") || len(s.layThu()) != 1 {
		t.Errorf("lệnh: %s, số thư %d", lenh, len(s.layThu()))
	}
}

// Có Username mà máy chủ (không phải localhost) không hỗ trợ TLS -> lỗi, không gửi AUTH; localhost thì được.
func TestSendAuthCanTLS(t *testing.T) {
	s := moSMTP(t, &smtpGia{auth: true})
	c := clientToi(t, s, Config{Host: "smtp.example.com", Username: "u", Password: "bi-mat"}, nil)
	err := c.Send(context.Background(), "a@b.vn", "Mã", "1", "")
	if err == nil || !strings.Contains(err.Error(), "TLS") {
		t.Errorf("phải từ chối đăng nhập không TLS, được %v", err)
	}
	if l := strings.Join(s.layLenh(), "|"); strings.Contains(l, "AUTH") || strings.Contains(l, "MAIL") {
		t.Errorf("đã gửi lệnh: %s", l)
	}

	s2 := moSMTP(t, &smtpGia{auth: true})
	c2 := clientToi(t, s2, Config{Host: "127.0.0.1", Username: "u", Password: "p"}, nil)
	if err := c2.Send(context.Background(), "a@b.vn", "Mã", "1", ""); err != nil {
		t.Errorf("127.0.0.1 không TLS vẫn được đăng nhập: %v", err)
	}
	if s2.layAuth() == "" {
		t.Error("chưa gửi AUTH PLAIN")
	}
}

// CR / LF trong người nhận / tiêu đề -> lỗi trước khi mở kết nối; địa chỉ sai cũng vậy.
func TestSendTuChoiXuongDong(t *testing.T) {
	s := moSMTP(t, &smtpGia{})
	c := clientToi(t, s, Config{Host: "127.0.0.1"}, nil)
	for _, v := range [][2]string{
		{"a@b.vn\r\nBcc: x@y.vn", "Mã"},
		{"a@b.vn\nBcc: x@y.vn", "Mã"},
		{"a@b.vn", "Mã\r\nBcc: x@y.vn"},
		{"a@b.vn", "Mã\nX: y"},
		{"a@b.vn", "Mã\rX: y"},
		{"khong-phai-email", "Mã"},
		{"", "Mã"},
	} {
		if err := c.Send(context.Background(), v[0], v[1], "1", ""); err == nil {
			t.Errorf("Send(%q, %q) phải lỗi", v[0], v[1])
		}
	}
	time.Sleep(50 * time.Millisecond)
	s.mu.Lock()
	n := s.ketNoi
	s.mu.Unlock()
	if n != 0 {
		t.Errorf("đã mở %d kết nối", n)
	}
}

// Máy chủ treo: hết Timeout hoặc ctx huỷ -> Send trả lỗi đúng hạn, không chờ mãi.
func TestSendHetHan(t *testing.T) {
	cho := func(t *testing.T, ten string, toiDa time.Duration, f func() error) error {
		t.Helper()
		bd := time.Now()
		err := f()
		if d := time.Since(bd); d > toiDa {
			t.Errorf("%s: mất %v (tối đa %v)", ten, d, toiDa)
		}
		if err == nil {
			t.Errorf("%s: phải lỗi", ten)
		}
		return err
	}

	s := moSMTP(t, &smtpGia{treo: "chao"})
	c := clientToi(t, s, Config{Host: "127.0.0.1", Timeout: 300 * time.Millisecond}, nil)
	err := cho(t, "treo lời chào + Timeout", 3*time.Second, func() error {
		return c.Send(context.Background(), "a@b.vn", "Mã", "1", "")
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("phải là DeadlineExceeded: %v", err)
	}

	c = clientToi(t, s, Config{Host: "127.0.0.1", Timeout: time.Minute}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(200*time.Millisecond, cancel)
	err = cho(t, "treo lời chào + huỷ ctx", 3*time.Second, func() error {
		return c.Send(ctx, "a@b.vn", "Mã", "1", "")
	})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("phải là Canceled: %v", err)
	}

	ctx, cancel = context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	s2 := moSMTP(t, &smtpGia{treo: "data"})
	c = clientToi(t, s2, Config{Host: "127.0.0.1", Timeout: time.Minute}, nil)
	err = cho(t, "treo sau DATA + hạn ctx", 3*time.Second, func() error {
		return c.Send(ctx, "a@b.vn", "Mã", "1", "")
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("phải là DeadlineExceeded: %v", err)
	}

	// ctx đã huỷ từ trước: không kết nối
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if err := c.Send(ctx, "a@b.vn", "Mã", "1", ""); !errors.Is(err, context.Canceled) {
		t.Errorf("ctx đã huỷ: %v", err)
	}
}

// Máy chủ từ chối (mã 5xx) -> lỗi.
func TestSendMayChuTuChoi(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		conn.Write([]byte("220 x\r\n"))
		for {
			l, err := r.ReadString('\n')
			if err != nil {
				return
			}
			switch {
			case strings.HasPrefix(l, "EHLO"):
				conn.Write([]byte("250 x\r\n"))
			case strings.HasPrefix(l, "MAIL"):
				conn.Write([]byte("250 ok\r\n"))
			case strings.HasPrefix(l, "RCPT"):
				conn.Write([]byte("550 5.1.1 không có hộp thư này\r\n"))
			default:
				conn.Write([]byte("221 x\r\n"))
				return
			}
		}
	}()
	c, err := New(Config{Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port, From: "no-reply@dezon.vn", Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Send(context.Background(), "khong-co@b.vn", "Mã", "1", ""); err == nil || !strings.Contains(err.Error(), "550") {
		t.Errorf("RCPT 550 phải lỗi kèm mã: %v", err)
	}
}
