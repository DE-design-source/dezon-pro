package quotations

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"qspro-backend/internal/platform/storage"
	"qspro-backend/internal/shared/httpx"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

/* Phần TẢI ẢNH của fetchImage đối chiếu với fetch THẬT của Node: testdata/gen-fetch.js chạy export.js thật tới 1 máy chủ thử
   và ghi testdata/fetch.json (URL fetch gửi đi, dòng yêu cầu + header máy chủ nhận được, kết quả theo Content-Encoding).
   Bên Go chạy đúng các ca đó qua http.Client mặc định của module tới 1 máy chủ TCP thô (net/http server từ chối dòng yêu cầu
   có "%" lẻ nên không dùng httptest). */

type rawReq struct {
	line, host string
	header     map[string]string
}

// rawServer: máy chủ HTTP/1.1 tối thiểu, mỗi kết nối 1 yêu cầu, ghi lại nguyên văn dòng yêu cầu.
type rawServer struct {
	ln      net.Listener
	mu      sync.Mutex
	last    *rawReq
	first   *rawReq
	respond func(path string) (status int, headers []string, body []byte)
}

func newRawServer(t *testing.T, respond func(path string) (int, []string, []byte)) *rawServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &rawServer{ln: ln, respond: respond}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go s.serve(c)
		}
	}()
	t.Cleanup(func() { ln.Close() })
	return s
}

func (s *rawServer) serve(c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	first, err := br.ReadString('\n')
	if err != nil {
		return
	}
	parts := strings.SplitN(strings.TrimRight(first, "\r\n"), " ", 3)
	if len(parts) != 3 {
		return
	}
	rq := &rawReq{line: parts[1], header: map[string]string{}}
	for {
		l, err := br.ReadString('\n')
		if err != nil {
			return
		}
		if l = strings.TrimRight(l, "\r\n"); l == "" {
			break
		}
		k, v, _ := strings.Cut(l, ":")
		rq.header[strings.ToLower(k)] = strings.TrimSpace(v)
	}
	rq.host = rq.header["host"]
	s.mu.Lock()
	s.last = rq
	if s.first == nil {
		s.first = rq
	}
	s.mu.Unlock()
	status, headers, body := s.respond(rq.line)
	var b bytes.Buffer
	b.WriteString("HTTP/1.1 " + strconv.Itoa(status) + " X\r\nConnection: close\r\n")
	for _, h := range headers {
		b.WriteString(h + "\r\n")
	}
	b.WriteString("\r\n")
	b.Write(body)
	_, _ = c.Write(b.Bytes())
}

func (s *rawServer) port() string {
	_, p, _ := net.SplitHostPort(s.ln.Addr().String())
	return p
}

func (s *rawServer) take() *rawReq {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.last
	s.last = nil
	return r
}

func TestFetchNode(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "fetch.json"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	fx := jsval.AsMap(v)
	cs := loadCases(t)
	png := newStubs(cs).png

	// URL fetch gửi đi (new Request(url).url); null = fetch từ chối URL
	for _, c := range jsval.AsArray(fx.Val("href")) {
		pair := jsval.AsArray(c)
		u := jsval.AsString(pair[0])
		_, target, ok := parseImageURL(u)
		if pair[1] == nil {
			if ok {
				t.Errorf("%q: Node từ chối, Go tải %s", u, hrefOf(target))
			}
			continue
		}
		// phần #... không gửi đi; "?" trần (query rỗng) không có trong dòng yêu cầu
		want, _, _ := strings.Cut(jsval.AsString(pair[1]), "#")
		if strings.Count(want, "?") == 1 {
			want = strings.TrimSuffix(want, "?")
		}
		if !ok {
			t.Errorf("%q: Go từ chối, Node tải %s", u, want)
		} else if got := hrefOf(target); got != want {
			t.Errorf("%q:\n  node: %s\n  go:   %s", u, want, got)
		}
	}

	big := bytes.Repeat([]byte{'A'}, 6*1024*1024)
	copy(big, png)
	rnd := bytes.Repeat([]byte{'B'}, 5*1024*1024-10)
	copy(rnd, png)
	gz := func(src []byte, level int) []byte {
		var o bytes.Buffer
		w, _ := gzip.NewWriterLevel(&o, level)
		_, _ = w.Write(src)
		_ = w.Close()
		return o.Bytes()
	}
	encs := map[string]*omap.Map{}
	bodies := map[string][]byte{}
	for _, e := range jsval.AsArray(fx.Val("enc")) {
		m := jsval.AsMap(e)
		n := jsval.AsString(m.Val("n"))
		encs[n] = m
		switch {
		case n == "gzip-big":
			bodies[n] = gz(big, gzip.BestSpeed)
		case n == "gzip-len-over":
			bodies[n] = gz(rnd, gzip.NoCompression)
			if len(bodies[n]) <= imgMax {
				t.Fatalf("gzip-len-over: thân nén %d byte, cần vượt IMG_MAX", len(bodies[n]))
			}
		case n == "plain-big":
			bodies[n] = big
		default:
			bodies[n], err = base64.StdEncoding.DecodeString(jsval.AsString(m.Val("body")))
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	srv := newRawServer(t, func(path string) (int, []string, []byte) {
		if n, ok := strings.CutPrefix(path, "/enc/"); ok {
			m := encs[n]
			var h []string
			if enc := jsval.AsString(m.Val("enc")); enc != "" {
				h = append(h, "content-encoding: "+enc)
			}
			if !jsval.Truthy(m.Val("noLen")) {
				h = append(h, "content-length: "+strconv.Itoa(len(bodies[n])))
			}
			return 200, h, bodies[n]
		}
		switch path {
		case "/redirect-abs":
			return 302, []string{"location: /moved/a.png?x=1", "content-length: 0"}, nil
		case "/dir/redirect-rel":
			return 302, []string{"location: b.png", "content-length: 0"}, nil
		}
		return 200, []string{"content-length: " + strconv.Itoa(len(png))}, png
	})
	st := newStubs(cs)
	svc := New(Deps{Repo: &fakeRepo{}, Lines: st, Projects: st, Media: st})
	// mọi tên miền trỏ về máy chủ thử (gen-fetch.js thay dns.lookup)
	httpx.Inner(svc.http.Transport).(*http.Transport).DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.ln.Addr().String())
	}
	base := "http://img.zz-quotations.example:" + srv.port()
	ctx := context.Background()

	for _, c := range jsval.AsArray(fx.Val("sent")) {
		row := jsval.AsArray(c)
		tail := jsval.AsString(row[0])
		srv.take()
		res := svc.fetchImage(ctx, base+tail)
		rq := srv.take()
		if rq == nil {
			t.Errorf("%q: Go không gửi yêu cầu, Node gửi %v", tail, row[1])
			continue
		}
		if rq.line != jsval.AsString(row[1]) {
			t.Errorf("%q: dòng yêu cầu\n  node: %s\n  go:   %s", tail, jsval.AsString(row[1]), rq.line)
		}
		if host := strings.ReplaceAll(rq.host, ":"+srv.port(), ":{P}"); host != jsval.AsString(row[2]) {
			t.Errorf("%q: Host node %q, go %q", tail, jsval.AsString(row[2]), host)
		}
		if (res != nil) != jsval.Truthy(row[3]) {
			t.Errorf("%q: nhận ảnh node %v, go %v", tail, row[3], res != nil)
		}
	}

	// header fetch của Node gửi kèm
	for _, h := range jsval.AsArray(fx.Val("headers")) {
		kv := jsval.AsArray(h)
		if got := srv.first.header[jsval.AsString(kv[0])]; got != jsval.AsString(kv[1]) {
			t.Errorf("header %s: node %q, go %q", jsval.AsString(kv[0]), jsval.AsString(kv[1]), got)
		}
	}
	if ref, ok := srv.first.header["referer"]; ok {
		t.Errorf("Go gửi Referer %q, Node không gửi", ref)
	}

	for _, e := range jsval.AsArray(fx.Val("enc")) {
		m := jsval.AsMap(e)
		n := jsval.AsString(m.Val("n"))
		res := svc.fetchImage(ctx, base+"/enc/"+n)
		want := jsval.Truthy(m.Val("ok"))
		if n == "br" {
			want = false // khác biệt đã biết: Go không có bộ giải brotli (Node cũng không xin br, máy chủ tự ý gửi mới gặp)
		}
		if (res != nil) != want {
			t.Errorf("enc %s (%s): nhận ảnh node %v, go %v", n, jsval.AsString(m.Val("enc")), want, res != nil)
		} else if res != nil && res.ext != jsval.AsString(m.Val("ext")) {
			t.Errorf("enc %s: ext node %v, go %s", n, m.Val("ext"), res.ext)
		}
	}
}

// khongGoiMang: http.Client của ảnh /files/... không được dùng tới.
type khongGoiMang struct{ t *testing.T }

func (k khongGoiMang) RoundTrip(r *http.Request) (*http.Response, error) {
	k.t.Errorf("không được tải qua HTTP: %s", r.URL)
	return nil, http.ErrNotSupported
}

// /files/... (kho UPLOAD_DIR): đọc thẳng từ đĩa, không gọi HTTP; vẫn chỉ nhận PNG / JPEG, tối đa 5 MB, không ra ngoài kho.
func TestFetchImageKhoFile(t *testing.T) {
	ctx := context.Background()
	base := t.TempDir()
	kho := storage.New(filepath.Join(base, "kho"))
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, "du-lieu"...)
	up := func(p string, b []byte) string {
		u, err := kho.Upload(ctx, b, p, "")
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	uPng := up("sp/ảnh 1.png", png)
	uJpg := up("logo/a.jpg", []byte{0xFF, 0xD8, 0xFF, 0xE0, 1})
	uTxt := up("sp/a.png", []byte("khong-phai-anh"))
	uLon := up("sp/lon.png", append(append([]byte{}, png...), make([]byte, imgMax)...))
	if err := os.WriteFile(filepath.Join(base, "ngoai.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	svc := New(Deps{Repo: &fakeRepo{}, Files: kho, HTTP: &http.Client{Transport: khongGoiMang{t}}})
	if res := svc.fetchImage(ctx, uPng); res == nil || res.ext != "png" || !bytes.Equal(res.buf, png) {
		t.Errorf("png: %+v", res)
	}
	if res := svc.fetchImage(ctx, uJpg+"?v=1"); res == nil || res.ext != "jpeg" {
		t.Errorf("jpg: %+v", res)
	}
	for _, u := range []string{uTxt, uLon, "/files/sp/khong-co.png", "/files/sp", "/files/../ngoai.png", "/files/%2e%2e/ngoai.png"} {
		if res := svc.fetchImage(ctx, u); res != nil {
			t.Errorf("%s: phải bỏ ảnh", u)
		}
	}
	if res := New(Deps{Repo: &fakeRepo{}}).fetchImage(ctx, uPng); res != nil {
		t.Error("không có kho: phải bỏ ảnh")
	}
}
