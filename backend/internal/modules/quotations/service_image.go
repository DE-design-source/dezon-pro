package quotations

import (
	"bufio"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/idna"

	"qspro-backend/internal/shared/httpx"
	"qspro-backend/internal/shared/jsval"
)

type imageData struct {
	buf []byte
	ext string // png | jpeg
}

var (
	reToken     = regexp.MustCompile(`[?&]token=([^&]+)`)
	reHostLocal = regexp.MustCompile(`\.(local|internal)$`)
	reHostPriv  = regexp.MustCompile(`^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)`)
	reScheme    = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.\-]*:`)
)

// newImageClient: http.Client cho ảnh do người dùng nhập. fetch của Node đi theo tối đa 20 lần chuyển hướng,
// không gửi Referer và không dùng proxy của biến môi trường.
func newImageClient() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil
	// OneShot: fetch không tự gửi lại GET khi kết nối bị đóng
	return &http.Client{Transport: httpx.OneShot(tr), CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 20 {
			return errors.New("redirect count exceeded")
		}
		req.Header.Del("Referer")
		return nil
	}}
}

// domainToASCII của WHATWG URL (UTS 46, không chuyển tiếp): đổi chữ thường, chuẩn hoá ký tự rộng, punycode.
var hostProfile = idna.New(idna.MapForLookup(), idna.Transitional(false), idna.StrictDomainName(false), idna.CheckHyphens(false))

// ipv4Number: 1 phần của địa chỉ IPv4 theo WHATWG - thập phân, 0x.. (hex), 0.. (bát phân).
func ipv4Number(s string) (uint64, bool) {
	if s == "" {
		return 0, false
	}
	base := 10
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		s, base = s[2:], 16
	} else if len(s) >= 2 && s[0] == '0' {
		s, base = s[1:], 8
	}
	if s == "" {
		return 0, true
	}
	n, err := strconv.ParseUint(s, base, 64)
	return n, err == nil
}

// normIPv4: host kết thúc bằng một phần dạng số được WHATWG đọc như IPv4 ("2130706433", "0x7f.1", "127.1" -> "127.0.0.1").
// Trả (host đã chuẩn hoá, true); host dạng số nhưng sai -> ("", false) (URL không hợp lệ). Không phải dạng số -> giữ nguyên.
func normIPv4(host string) (string, bool) {
	parts := strings.Split(host, ".")
	if parts[len(parts)-1] == "" {
		if len(parts) == 1 {
			return host, true
		}
		parts = parts[:len(parts)-1]
	}
	last := parts[len(parts)-1]
	allDigits := last != "" && strings.Trim(last, "0123456789") == ""
	if _, ok := ipv4Number(last); !allDigits && !(ok && len(last) >= 2 && (last[:2] == "0x" || last[:2] == "0X")) {
		return host, true
	}
	if len(parts) > 4 {
		return "", false
	}
	nums := make([]uint64, len(parts))
	for i, p := range parts {
		n, ok := ipv4Number(p)
		if !ok {
			return "", false
		}
		nums[i] = n
	}
	for _, n := range nums[:len(nums)-1] {
		if n > 255 {
			return "", false
		}
	}
	lastN := nums[len(nums)-1]
	limit := uint64(1) << (8 * uint(5-len(nums)))
	if lastN >= limit {
		return "", false
	}
	ip := lastN
	for i, n := range nums[:len(nums)-1] {
		ip += n << (8 * uint(3-i))
	}
	return strconv.FormatUint(ip>>24, 10) + "." + strconv.FormatUint(ip>>16&255, 10) + "." +
		strconv.FormatUint(ip>>8&255, 10) + "." + strconv.FormatUint(ip&255, 10), true
}

// pctEncode: percent-encode của WHATWG URL - byte điều khiển, byte >= 0x7F và các ký tự trong set thành %HH (hex hoa).
// Dấu % có sẵn giữ nguyên, kể cả khi không phải mã hợp lệ.
func pctEncode(s, set string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c <= 0x20 || c >= 0x7F || strings.IndexByte(set, c) >= 0 {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

// Bộ ký tự phải mã hoá của WHATWG (ngoài byte điều khiển, dấu cách và byte >= 0x7F): đường dẫn và query của scheme http(s).
const (
	pctPath  = "\"#<>?`{}"
	pctQuery = "\"#<>'"
)

// whatwgPath: đường dẫn như URL.pathname của Node - bỏ đoạn "." / ".." (kể cả viết %2e), mã hoá ký tự, rỗng thành "/".
func whatwgPath(p string) string {
	if p == "" {
		p = "/"
	}
	segs := strings.Split(p[1:], "/")
	out := make([]string, 0, len(segs))
	for i, sg := range segs {
		last := i == len(segs)-1
		switch strings.ReplaceAll(strings.ToLower(sg), "%2e", ".") {
		case "..":
			if len(out) > 0 {
				out = out[:len(out)-1]
			}
			if last {
				out = append(out, "")
			}
		case ".":
			if last {
				out = append(out, "")
			}
		default:
			out = append(out, pctEncode(sg, pctPath))
		}
	}
	return "/" + strings.Join(out, "/")
}

// parseImageURL đọc URL http(s) theo cách new URL() / fetch của Node: trả hostname đã chuẩn hoá (chữ thường,
// IPv4 dạng số -> a.b.c.d, IPv6 giữ ngoặc vuông) và URL để tải ĐÚNG như Node gửi đi (đường dẫn + query đã chuẩn hoá
// theo WHATWG, bỏ cổng mặc định). ok = false khi Node ném lỗi (URL sai, scheme không phải http / https,
// URL kèm tài khoản) - fetchImage trả null.
func parseImageURL(raw string) (host string, target *url.URL, ok bool) {
	u := strings.Map(func(r rune) rune {
		if r == '\t' || r == '\n' || r == '\r' {
			return -1
		}
		return r
	}, strings.TrimFunc(raw, func(r rune) bool { return r <= 0x20 }))
	m := reScheme.FindString(u)
	if m == "" {
		return "", nil, false
	}
	scheme := strings.ToLower(m[:len(m)-1])
	if scheme != "http" && scheme != "https" {
		return "", nil, false // fetch chỉ tải http / https
	}
	rest := strings.TrimLeft(u[len(m):], `/\`)
	end := strings.IndexAny(rest, `/\?#`)
	authority, tail := rest, ""
	if end >= 0 {
		authority, tail = rest[:end], rest[end:]
	}
	if i := strings.LastIndex(authority, "@"); i >= 0 {
		// fetch từ chối URL có tài khoản / mật khẩu; "@" hoặc ":@" trần (cả hai rỗng) thì vẫn tải
		if ui := authority[:i]; ui != "" && ui != ":" {
			return "", nil, false
		}
		authority = authority[i+1:]
	}
	port := ""
	h := authority
	if strings.HasPrefix(h, "[") {
		i := strings.Index(h, "]")
		if i < 0 {
			return "", nil, false
		}
		h, port = h[:i+1], h[i+1:]
	} else if i := strings.LastIndex(h, ":"); i >= 0 {
		h, port = h[:i], h[i:]
	}
	if port != "" {
		if port[0] != ':' || strings.Trim(port[1:], "0123456789") != "" {
			return "", nil, false
		}
		n, _ := strconv.Atoi(port[1:])
		if n > 65535 {
			return "", nil, false
		}
		// cổng viết lại dạng số gọn; cổng mặc định của scheme và ":" trần bị bỏ
		if port == ":" || (scheme == "http" && n == 80) || (scheme == "https" && n == 443) {
			port = ""
		} else {
			port = ":" + strconv.Itoa(n)
		}
	}
	if h == "" {
		return "", nil, false
	}
	if h[0] != '[' {
		dec, err := jsval.DecodeURIComponent(h)
		if err != nil {
			dec = h
		}
		asc, err := hostProfile.ToASCII(dec)
		if err != nil || asc == "" || strings.ContainsAny(asc, " #/:<>?@[\\]^|%") {
			return "", nil, false
		}
		if h, ok = normIPv4(strings.ToLower(asc)); !ok {
			return "", nil, false
		}
	} else {
		h = strings.ToLower(h)
	}
	if i := strings.Index(tail, "#"); i >= 0 {
		tail = tail[:i]
	}
	// đường dẫn: WHATWG coi "\" như "/" (chỉ trước phần ?)
	p, query, _ := strings.Cut(tail, "?")
	p = whatwgPath(strings.ReplaceAll(p, `\`, "/"))
	target = &url.URL{Scheme: scheme, Host: h + port, Path: p, RawQuery: pctEncode(query, pctQuery)}
	if dec, err := url.PathUnescape(p); err == nil {
		target.Path, target.RawPath = dec, p
	}
	// url.URL mã hoá lại đường dẫn theo luật của Go khi RawPath không hợp lệ với nó ("%" lẻ, "|", "^"...):
	// Opaque được net/http ghi nguyên văn vào dòng yêu cầu. Đường dẫn bắt đầu bằng "//" không dùng được Opaque
	// (Go hiểu thành //host).
	if target.EscapedPath() != p && !strings.HasPrefix(p, "//") {
		target.Opaque = p
	}
	return h, target, true
}

// hrefOf: URL đầy đủ của target (url.URL.String() bỏ host khi có Opaque).
func hrefOf(u *url.URL) string { return u.Scheme + "://" + u.Host + u.RequestURI() }

// hostBlocked: điều kiện chặn của fetchImage (X:338-339) - localhost, .local / .internal, IPv6, dải IPv4 riêng.
func hostBlocked(host string) bool {
	return host == "" || host == "localhost" || reHostLocal.MatchString(host) || strings.Contains(host, ":") ||
		reHostPriv.MatchString(host)
}

// bodyDecoder: giải nén thân trả lời theo Content-Encoding như fetch của Node (undici): gzip / x-gzip / deflate,
// nhiều lớp thì gỡ từ lớp cuối; gặp 1 mã không biết thì để nguyên thân. ok = false: mã Node giải được mà Go không (br).
func bodyDecoder(body io.Reader, contentEncoding string) (r io.Reader, ok bool) {
	if contentEncoding == "" {
		return body, true
	}
	codings := strings.Split(strings.ToLower(contentEncoding), ",")
	for i := range codings {
		codings[i] = strings.TrimSpace(codings[i])
		switch codings[i] {
		case "gzip", "x-gzip", "deflate", "br":
		default:
			return body, true
		}
	}
	r = body
	for i := len(codings) - 1; i >= 0; i-- {
		switch codings[i] {
		case "br":
			return nil, false
		case "deflate":
			// undici: byte đầu có nibble thấp = 8 là zlib, ngược lại là deflate thô
			br := bufio.NewReader(r)
			if b, err := br.Peek(1); err == nil && b[0]&0x0F == 0x08 {
				r = &lazyReader{open: func() (io.Reader, error) { return zlib.NewReader(br) }}
			} else {
				r = flate.NewReader(br)
			}
		default:
			src := r
			r = &lazyReader{open: func() (io.Reader, error) { return gzip.NewReader(src) }}
		}
	}
	return r, true
}

// lazyReader: mở bộ giải nén ở lần đọc đầu (gzip.NewReader / zlib.NewReader đọc header ngay khi tạo).
type lazyReader struct {
	open func() (io.Reader, error)
	r    io.Reader
	err  error
}

func (l *lazyReader) Read(p []byte) (int, error) {
	if l.r == nil && l.err == nil {
		l.r, l.err = l.open()
	}
	if l.err != nil {
		return 0, l.err
	}
	return l.r.Read(p)
}

// download = fetch(url, {signal: AbortSignal.timeout(8000)}) + các kiểm tra của fetchImage (X:341-344).
// URL do người dùng nhập: giới hạn thời gian + dung lượng để 1 link treo / khổng lồ không chặn cả file xuất.
// nil = bỏ ảnh.
func (s *Service) download(ctx context.Context, target *url.URL) []byte {
	tctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(tctx, http.MethodGet, "http://x/", nil)
	if err != nil {
		return nil
	}
	req.URL, req.Host = target, ""
	// header mặc định của fetch trong Node. Tự đặt Accept-Encoding nên net/http KHÔNG tự giải nén và giữ nguyên
	// Content-Length: Node so content-length của thân CÒN NÉN với IMG_MAX.
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "*")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("User-Agent", "node")
	req.Header.Set("Accept-Encoding", "gzip, deflate")
	res, err := s.http.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil
	}
	if cl := res.Header.Get("Content-Length"); cl != "" && jsval.ToNumber(cl) > imgMax {
		return nil
	}
	var body io.Reader = res.Body
	if !res.Uncompressed {
		var ok bool
		if body, ok = bodyDecoder(res.Body, strings.Join(res.Header.Values("Content-Encoding"), ", ")); !ok {
			return nil
		}
	}
	buf, err := io.ReadAll(io.LimitReader(body, imgMax+1))
	// thân nén bị cắt cụt: Node (Z_SYNC_FLUSH) vẫn nhận phần đã giải được
	if (err != nil && !errors.Is(err, io.ErrUnexpectedEOF)) || len(buf) > imgMax {
		return nil
	}
	return buf
}

// fetchImage = fetchImage (X:328-354): /files/... đọc thẳng từ kho trên đĩa, /media?token=... tải qua Lark, URL http
// tải trực tiếp (không tải địa chỉ nội bộ, tối đa 8 giây và 5 MB). Chỉ nhận PNG / JPEG theo CHỮ KÝ FILE. Mọi lỗi -> nil (bỏ ảnh).
func (s *Service) fetchImage(ctx context.Context, url string) *imageData {
	var buf []byte
	m := reToken.FindStringSubmatch(url)
	switch {
	case strings.HasPrefix(url, "/files/"):
		// URL tương đối của kho UPLOAD_DIR: không tải qua HTTP được
		if s.files == nil {
			return nil
		}
		var err error
		if buf, err = s.files.ReadURL(url, imgMax); err != nil {
			return nil
		}
	case strings.HasPrefix(url, "/media") && m != nil:
		token, err := jsval.DecodeURIComponent(m[1])
		if err != nil || s.media == nil {
			return nil
		}
		if buf, _, err = s.media.MediaDownload(ctx, token); err != nil {
			return nil
		}
	case strings.HasPrefix(url, "http"):
		host, target, ok := parseImageURL(url)
		if !ok || hostBlocked(host) {
			return nil
		}
		if buf = s.download(ctx, target); buf == nil {
			return nil
		}
	default:
		return nil
	}
	laPng := len(buf) > 8 && buf[0] == 0x89 && buf[1] == 0x50 && buf[2] == 0x4E && buf[3] == 0x47
	laJpg := len(buf) > 3 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF
	if !laPng && !laJpg {
		return nil
	}
	if laPng {
		return &imageData{buf: buf, ext: "png"}
	}
	return &imageData{buf: buf, ext: "jpeg"}
}
