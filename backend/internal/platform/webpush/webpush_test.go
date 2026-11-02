package webpush

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Ví dụ RFC 8291 mục 5 + phụ lục A, chép từ https://www.rfc-editor.org/rfc/rfc8291.txt (khoảng trắng bị bỏ khi giải mã).
const (
	rfcPlaintext  = `V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24`
	rfcASPublic   = `BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`
	rfcASPrivate  = `yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw`
	rfcUAPublic   = `BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`
	rfcUAPrivate  = `q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94`
	rfcSalt       = `DGv6ra1nlYgDCS1FRnbzlw`
	rfcAuth       = `BTBZMqHH6r4Tts7J_aSIgg`
	rfcECDHSecret = `kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs`
	rfcPRKKey     = `Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k`
	rfcKeyInfo    = `V2ViUHVzaDogaW5mbwAEJXGyvs3942BVG q8e0PTNNmwR zr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3
	                 ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0Ew bZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAv MBKiiujwa7t45ewP`
	rfcIKM        = `S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg`
	rfcPRK        = `09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc`
	rfcCEK        = `oIhVW04MRdy2XN9CiKLxTg`
	rfcNonce      = `4h_95klXJ5E_qnoN`
	rfcHeader     = `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`
	rfcPadded     = `V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0 byBiZSBhIHdhdGVybWVsb24C`
	rfcCiphertext = `8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ`
	rfcMessage    = `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
	                 mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
	                 pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`
)

// Ví dụ RFC 8292 mục 2.4 (https://www.rfc-editor.org/rfc/rfc8292.txt).
const (
	rfcJWT = `eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3
	          B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1ha
	          Wx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_H
	          LGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA`
	rfcVAPIDKey = `BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dR uU_RCPCfA5aq9ojSwk5Y2EmClBPs`
	rfcJWKX     = `DUfHPKLVFQzVvnCPGyfucbECzPDa7rWbXriLcysAjEc`
	rfcJWKY     = `F6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs`
)

func unwrap(s string) string { return strings.Join(strings.Fields(s), "") }

func rfcB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(unwrap(s))
	if err != nil {
		t.Fatalf("giải mã base64url %q: %v", s, err)
	}
	return b
}

func hmacSHA256(key []byte, parts ...[]byte) []byte {
	m := hmac.New(sha256.New, key)
	for _, p := range parts {
		m.Write(p)
	}
	return m.Sum(nil)
}

// rfcDerive: suy khoá đúng từng bước giả mã RFC 8291 mục 3.4 bằng HMAC thuần - độc lập với deriveKeys (crypto/hkdf).
func rfcDerive(ecdhSecret, authSecret, uaPub, asPub, salt []byte) (prkKey, keyInfo, ikm, prk, cek, nonce []byte) {
	prkKey = hmacSHA256(authSecret, ecdhSecret)
	keyInfo = append(append([]byte("WebPush: info\x00"), uaPub...), asPub...)
	ikm = hmacSHA256(prkKey, keyInfo, []byte{0x01})
	prk = hmacSHA256(salt, ikm)
	cek = hmacSHA256(prk, []byte("Content-Encoding: aes128gcm\x00"), []byte{0x01})[:16]
	nonce = hmacSHA256(prk, []byte("Content-Encoding: nonce\x00"), []byte{0x01})[:12]
	return
}

// decrypt: phía trình duyệt (RFC 8291 + RFC 8188, đúng 1 record) - kiểm bản mã của encrypt / Send.
func decrypt(body []byte, uaPriv *ecdh.PrivateKey, authSecret []byte) ([]byte, error) {
	if len(body) < 21 {
		return nil, errors.New("thân quá ngắn")
	}
	salt := body[:16]
	rs := binary.BigEndian.Uint32(body[16:20])
	idlen := int(body[20])
	if idlen != 65 || len(body) < 21+idlen {
		return nil, fmt.Errorf("keyid dài %d byte", idlen)
	}
	keyid := body[21 : 21+idlen]
	ct := body[21+idlen:]
	if rs < 18 || uint32(len(ct)) >= rs {
		return nil, fmt.Errorf("không phải 1 record: rs=%d, bản mã %d byte", rs, len(ct))
	}
	asPub, err := ecdh.P256().NewPublicKey(keyid)
	if err != nil {
		return nil, err
	}
	secret, err := uaPriv.ECDH(asPub)
	if err != nil {
		return nil, err
	}
	_, _, _, _, cek, nonce := rfcDerive(secret, authSecret, uaPriv.PublicKey().Bytes(), keyid, salt)
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, err
	}
	i := len(plain) - 1
	for i >= 0 && plain[i] == 0 {
		i--
	}
	if i < 0 || plain[i] != 0x02 {
		return nil, errors.New("thiếu byte phân cách 0x02")
	}
	return plain[:i], nil
}

// verifyJWT kiểm chữ ký ES256 (r || s 64 byte) bằng khoá công khai k (base64url, điểm không nén) rồi trả header + claims.
func verifyJWT(token, k string) (header, claims map[string]any, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, fmt.Errorf("JWT có %d phần", len(parts))
	}
	pubRaw, err := base64.RawURLEncoding.DecodeString(k)
	if err != nil {
		return nil, nil, err
	}
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pubRaw)
	if err != nil {
		return nil, nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, nil, err
	}
	if len(sig) != 64 {
		return nil, nil, fmt.Errorf("chữ ký dài %d byte, cần 64 (r || s)", len(sig))
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(pub, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		return nil, nil, errors.New("sai chữ ký")
	}
	for i, dst := range []*map[string]any{&header, &claims} {
		raw, err := base64.RawURLEncoding.DecodeString(parts[i])
		if err != nil {
			return nil, nil, err
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			return nil, nil, err
		}
	}
	return header, claims, nil
}

// parseVapidAuth tách "vapid t=<jwt>, k=<khoá>".
func parseVapidAuth(t *testing.T, h string) (token, k string) {
	t.Helper()
	rest, ok := strings.CutPrefix(h, "vapid ")
	if !ok {
		t.Fatalf("Authorization không theo scheme vapid: %q", h)
	}
	for _, p := range strings.Split(rest, ",") {
		p = strings.TrimSpace(p)
		if v, ok := strings.CutPrefix(p, "t="); ok {
			token = v
		} else if v, ok := strings.CutPrefix(p, "k="); ok {
			k = v
		}
	}
	if token == "" || k == "" {
		t.Fatalf("Authorization thiếu t= hoặc k=: %q", h)
	}
	return token, k
}

var testNow = time.Date(2026, 10, 30, 3, 4, 5, 0, time.UTC)

func newTestClient(t *testing.T, hc *http.Client) *Client {
	t.Helper()
	pub, priv, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	c, err := New(Options{PublicKey: pub, PrivateKey: priv, Subject: "https://dezon.tech", HTTPClient: hc})
	if err != nil {
		t.Fatal(err)
	}
	c.allowInsecure = true
	c.now = func() time.Time { return testNow }
	return c
}

// browserSub: cặp khoá + auth secret ngẫu nhiên như trình duyệt sinh, kèm chuỗi JSON PushSubscription.
func browserSub(t *testing.T, endpoint string) (*ecdh.PrivateKey, []byte, string) {
	t.Helper()
	ua, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	rand.Read(auth)
	b, _ := json.Marshal(map[string]any{
		"endpoint":       endpoint,
		"expirationTime": nil,
		"keys":           map[string]string{"p256dh": b64(ua.PublicKey().Bytes()), "auth": b64(auth)},
	})
	return ua, auth, string(b)
}

type captured struct {
	method, path string
	header       http.Header
	body         []byte
}

// pushServer: dịch vụ push giả, ghi lại request rồi trả status + body cho trước.
func pushServer(t *testing.T, status int, respBody string) (*httptest.Server, chan captured) {
	t.Helper()
	ch := make(chan captured, 10)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		ch <- captured{r.Method, r.URL.Path, r.Header.Clone(), b}
		w.WriteHeader(status)
		io.WriteString(w, respBody)
	}))
	t.Cleanup(srv.Close)
	return srv, ch
}

func TestEncryptRFC8291Vector(t *testing.T) {
	uaPub, err := ecdh.P256().NewPublicKey(rfcB64(t, rfcUAPublic))
	if err != nil {
		t.Fatal(err)
	}
	uaPriv, err := ecdh.P256().NewPrivateKey(rfcB64(t, rfcUAPrivate))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(uaPriv.PublicKey().Bytes(), uaPub.Bytes()) {
		t.Fatal("khoá công khai ua của RFC không khớp khoá bí mật")
	}
	asPriv, err := ecdh.P256().NewPrivateKey(rfcB64(t, rfcASPrivate))
	if err != nil {
		t.Fatal(err)
	}
	asPub := asPriv.PublicKey().Bytes()
	if !bytes.Equal(asPub, rfcB64(t, rfcASPublic)) {
		t.Fatal("khoá công khai as của RFC không khớp khoá bí mật")
	}
	auth, salt := rfcB64(t, rfcAuth), rfcB64(t, rfcSalt)

	// Giá trị trung gian (phụ lục A).
	secret, err := asPriv.ECDH(uaPub)
	if err != nil {
		t.Fatal(err)
	}
	check := func(name string, got []byte, want string) {
		t.Helper()
		if w := rfcB64(t, want); !bytes.Equal(got, w) {
			t.Errorf("%s:\n got %s\nwant %s", name, b64(got), b64(w))
		}
	}
	check("ecdh_secret", secret, rfcECDHSecret)
	prkKey, keyInfo, ikm, prk, cek0, nonce0 := rfcDerive(secret, auth, uaPub.Bytes(), asPub, salt)
	check("PRK_key", prkKey, rfcPRKKey)
	check("key_info", keyInfo, rfcKeyInfo)
	check("IKM", ikm, rfcIKM)
	check("PRK", prk, rfcPRK)
	check("CEK (rfcDerive)", cek0, rfcCEK)
	check("NONCE (rfcDerive)", nonce0, rfcNonce)
	cek, nonce, err := deriveKeys(secret, auth, uaPub.Bytes(), asPub, salt)
	if err != nil {
		t.Fatal(err)
	}
	check("CEK", cek, rfcCEK)
	check("NONCE", nonce, rfcNonce)

	// Bản mã đầy đủ phải trùng từng byte.
	body, err := encrypt(rfcB64(t, rfcPlaintext), uaPub, auth, asPriv, salt)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != headerLen+len(rfcB64(t, rfcPadded))+tagLen {
		t.Errorf("độ dài thân %d", len(body))
	}
	check("header", body[:headerLen], rfcHeader)
	check("ciphertext", body[headerLen:], rfcCiphertext)
	check("message", body, rfcMessage)

	got, err := decrypt(body, uaPriv, auth)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "When I grow up, I want to be a watermelon" {
		t.Errorf("giải mã: %q", got)
	}
}

// Qua Send với khoá tạm + salt bơm từ móc: thân POST tới dịch vụ push phải đúng ví dụ RFC 8291 mục 5.
func TestSendRFC8291Vector(t *testing.T) {
	srv, ch := pushServer(t, http.StatusCreated, "")
	c := newTestClient(t, srv.Client())
	asPriv, err := ecdh.P256().NewPrivateKey(rfcB64(t, rfcASPrivate))
	if err != nil {
		t.Fatal(err)
	}
	c.ephemeral = func() (*ecdh.PrivateKey, []byte, error) { return asPriv, rfcB64(t, rfcSalt), nil }
	sub, _ := json.Marshal(map[string]any{
		"endpoint": srv.URL + "/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
		"keys":     map[string]string{"p256dh": unwrap(rfcUAPublic), "auth": rfcAuth},
	})
	status, gone, err := c.Send(context.Background(), string(sub), rfcB64(t, rfcPlaintext), 10, "", "")
	if err != nil || status != http.StatusCreated || gone {
		t.Fatalf("Send = %d %v %v", status, gone, err)
	}
	req := <-ch
	if req.path != "/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV" {
		t.Errorf("path %q", req.path)
	}
	if want := rfcB64(t, rfcMessage); !bytes.Equal(req.body, want) {
		t.Errorf("thân:\n got %s\nwant %s", b64(req.body), b64(want))
	}
	// RFC 8291 mục 5 ghi "Content-Length: 145" nhưng chính thân mẫu của RFC giải mã ra 144 byte
	// (86 header + 41 byte chữ + 1 phân cách + 16 tag) - so với thân mẫu, không so với con số in trong RFC.
	if got, want := req.header.Get("Content-Length"), fmt.Sprint(len(rfcB64(t, rfcMessage))); got != want || want != "144" {
		t.Errorf("Content-Length %q, cần %s (144)", got, want)
	}
}

func TestEncryptRoundTrip(t *testing.T) {
	for _, n := range []int{0, 1, 15, 16, 17, 100, 3993, maxPayload} {
		ua, auth, _ := browserSub(t, "https://push.example.net/x")
		payload := make([]byte, n)
		rand.Read(payload)
		as1, salt1, err := randomEphemeral()
		if err != nil {
			t.Fatal(err)
		}
		body, err := encrypt(payload, ua.PublicKey(), auth, as1, salt1)
		if err != nil {
			t.Fatalf("n=%d: %v", n, err)
		}
		if len(body) != headerLen+n+1+tagLen {
			t.Errorf("n=%d: thân %d byte", n, len(body))
		}
		got, err := decrypt(body, ua, auth)
		if err != nil || !bytes.Equal(got, payload) {
			t.Fatalf("n=%d: giải mã lệch (%v)", n, err)
		}
		// Sai auth secret -> không giải mã được.
		wrong := bytes.Clone(auth)
		wrong[0] ^= 1
		if _, err := decrypt(body, ua, wrong); err == nil {
			t.Errorf("n=%d: giải mã được với auth sai", n)
		}
		// Khoá tạm + salt mới cho mỗi tin -> bản mã khác nhau.
		as2, salt2, _ := randomEphemeral()
		body2, _ := encrypt(payload, ua.PublicKey(), auth, as2, salt2)
		if bytes.Equal(body, body2) {
			t.Errorf("n=%d: 2 lần mã hoá ra cùng bản mã", n)
		}
	}
}

func TestVAPIDToken(t *testing.T) {
	// Kiểm hàm kiểm chữ ký bằng chính JWT mẫu của RFC 8292 (chữ ký do bên thứ ba tạo).
	k := unwrap(rfcVAPIDKey)
	if want := append(append([]byte{0x04}, rfcB64(t, rfcJWKX)...), rfcB64(t, rfcJWKY)...); !bytes.Equal(rfcB64(t, k), want) {
		t.Fatal("k của RFC 8292 không khớp JWK x/y")
	}
	if _, claims, err := verifyJWT(unwrap(rfcJWT), k); err != nil {
		t.Fatalf("JWT mẫu RFC 8292: %v", err)
	} else if claims["aud"] != "https://push.example.net" {
		t.Errorf("claims mẫu: %v", claims)
	}

	c := newTestClient(t, nil)
	// Cùng aud / exp / sub với ví dụ RFC 8292 -> 2 phần đầu (header.claims) phải trùng từng ký tự.
	c.subject = "mailto:push@example.com"
	c.now = func() time.Time { return time.Unix(1453523768, 0).Add(-12 * time.Hour) }
	tok, err := c.vapidToken("https://push.example.net")
	if err != nil {
		t.Fatal(err)
	}
	rfcParts := strings.Split(unwrap(rfcJWT), ".")
	if parts := strings.Split(tok, "."); len(parts) != 3 || parts[0] != rfcParts[0] || parts[1] != rfcParts[1] {
		t.Errorf("header.claims:\n got %s\nwant %s.%s", tok, rfcParts[0], rfcParts[1])
	}
	header, claims, err := verifyJWT(tok, c.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	if header["typ"] != "JWT" || header["alg"] != "ES256" || len(header) != 2 {
		t.Errorf("header %v", header)
	}
	if claims["aud"] != "https://push.example.net" || claims["exp"] != float64(1453523768) || claims["sub"] != "mailto:push@example.com" {
		t.Errorf("claims %v", claims)
	}

	// exp = now + 12 giờ.
	c.now = func() time.Time { return testNow }
	tok, _ = c.vapidToken("https://fcm.googleapis.com")
	if _, claims, err = verifyJWT(tok, c.PublicKey()); err != nil {
		t.Fatal(err)
	}
	if claims["exp"] != float64(testNow.Add(12*time.Hour).Unix()) {
		t.Errorf("exp %v", claims["exp"])
	}

	// Sửa claims hoặc dùng khoá khác -> chữ ký không còn hợp lệ.
	parts := strings.Split(tok, ".")
	forged := parts[0] + "." + b64([]byte(`{"aud":"https://evil.example","exp":1,"sub":"x"}`)) + "." + parts[2]
	if _, _, err := verifyJWT(forged, c.PublicKey()); err == nil {
		t.Error("claims bị sửa vẫn qua kiểm chữ ký")
	}
	other := newTestClient(t, nil)
	if _, _, err := verifyJWT(tok, other.PublicKey()); err == nil {
		t.Error("khoá khác vẫn qua kiểm chữ ký")
	}
}

func TestSendHeaders(t *testing.T) {
	srv, ch := pushServer(t, http.StatusCreated, "")
	c := newTestClient(t, srv.Client())
	ua, auth, sub := browserSub(t, srv.URL+"/fcm/send/dQw4:APA91bH-DEF_123")
	payload := []byte(`{"title":"Lan · Nhóm A","body":"Chào cả nhà","conversation_id":12,"seq":41,"badge":3}`)

	status, gone, err := c.Send(context.Background(), sub, payload, 86400, "high", "conv-12")
	if err != nil || status != http.StatusCreated || gone {
		t.Fatalf("Send = %d %v %v", status, gone, err)
	}
	req := <-ch
	if req.method != http.MethodPost || req.path != "/fcm/send/dQw4:APA91bH-DEF_123" {
		t.Errorf("request %s %s", req.method, req.path)
	}
	for h, want := range map[string]string{
		"TTL":              "86400",
		"Content-Encoding": "aes128gcm",
		"Content-Type":     "application/octet-stream",
		"Urgency":          "high",
		"Topic":            "conv-12",
	} {
		if got := req.header.Get(h); got != want {
			t.Errorf("header %s = %q, cần %q", h, got, want)
		}
	}
	if got := req.header.Values("Content-Encoding"); len(got) != 1 {
		t.Errorf("Content-Encoding phải có đúng 1 giá trị: %v", got)
	}
	token, k := parseVapidAuth(t, req.header.Get("Authorization"))
	if k != c.PublicKey() {
		t.Errorf("k=%s, cần %s", k, c.PublicKey())
	}
	_, claims, err := verifyJWT(token, k)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(srv.URL)
	if claims["aud"] != "http://"+u.Host || claims["sub"] != "https://dezon.tech" {
		t.Errorf("claims %v", claims)
	}
	got, err := decrypt(req.body, ua, auth)
	if err != nil || !bytes.Equal(got, payload) {
		t.Errorf("giải mã thân: %q %v", got, err)
	}

	// Mặc định: Urgency normal, không có Topic.
	if _, _, err := c.Send(context.Background(), sub, []byte("x"), 0, "", ""); err != nil {
		t.Fatal(err)
	}
	req = <-ch
	if req.header.Get("Urgency") != "normal" || req.header.Get("TTL") != "0" {
		t.Errorf("Urgency %q TTL %q", req.header.Get("Urgency"), req.header.Get("TTL"))
	}
	if _, ok := req.header["Topic"]; ok {
		t.Errorf("không truyền topic mà vẫn có header Topic: %q", req.header.Get("Topic"))
	}
}

func TestSendStatus(t *testing.T) {
	long := strings.Repeat("lỗi ", 200)
	cases := []struct {
		status  int
		body    string
		gone    bool
		wantErr string // rỗng = không lỗi
	}{
		{http.StatusCreated, "", false, ""},
		{http.StatusOK, "", false, ""},
		{http.StatusAccepted, "", false, ""},
		{http.StatusGone, "push subscription has unsubscribed or expired", true, ""},
		{http.StatusNotFound, "not found", true, ""},
		{http.StatusInternalServerError, "lỗi\nmáy chủ", false, "500: lỗi máy chủ"},
		{http.StatusTooManyRequests, "", false, "429: (không có nội dung)"},
		{http.StatusForbidden, long, false, "403: lỗi lỗi"},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			srv, ch := pushServer(t, tc.status, tc.body)
			c := newTestClient(t, srv.Client())
			_, _, sub := browserSub(t, srv.URL+"/p/secret-path")
			status, gone, err := c.Send(context.Background(), sub, []byte("hi"), 60, "normal", "")
			<-ch
			if status != tc.status || gone != tc.gone {
				t.Errorf("status %d gone %v, cần %d %v", status, gone, tc.status, tc.gone)
			}
			if tc.wantErr == "" {
				if err != nil {
					t.Errorf("lỗi không mong đợi: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, cần chứa %q", err, tc.wantErr)
			}
			if strings.Contains(err.Error(), "secret-path") {
				t.Errorf("lỗi lộ đường dẫn endpoint: %v", err)
			}
			if len(err.Error()) > excerptLen+100 {
				t.Errorf("lỗi quá dài (%d byte)", len(err.Error()))
			}
		})
	}
}

func TestSendRejectsInvalidInput(t *testing.T) {
	srv, ch := pushServer(t, http.StatusCreated, "")
	c := newTestClient(t, srv.Client())
	ua, auth, okSub := browserSub(t, srv.URL+"/p/1")
	keys := func(p256dh, a string) string {
		b, _ := json.Marshal(map[string]any{"endpoint": srv.URL + "/p/1", "keys": map[string]string{"p256dh": p256dh, "auth": a}})
		return string(b)
	}
	pk := b64(ua.PublicKey().Bytes())
	notOnCurve := ua.PublicKey().Bytes()
	notOnCurve[64] ^= 1
	subs := map[string]string{
		"không phải JSON":    `{"endpoint":`,
		"chuỗi JSON":         `"https://push.example.net/x"`,
		"null":               `null`,
		"thiếu endpoint":     `{"keys":{"p256dh":"` + pk + `","auth":"` + b64(auth) + `"}}`,
		"endpoint rỗng":      `{"endpoint":"","keys":{"p256dh":"` + pk + `","auth":"` + b64(auth) + `"}}`,
		"endpoint ftp":       `{"endpoint":"ftp://push.example.net/x","keys":{"p256dh":"` + pk + `","auth":"` + b64(auth) + `"}}`,
		"endpoint tương đối": `{"endpoint":"/p/1","keys":{"p256dh":"` + pk + `","auth":"` + b64(auth) + `"}}`,
		"thiếu keys":         `{"endpoint":"` + srv.URL + `/p/1"}`,
		"p256dh hỏng":        keys("!!!", b64(auth)),
		"p256dh 33 byte":     keys(b64(ua.PublicKey().Bytes()[:33]), b64(auth)),
		"p256dh ngoài P-256": keys(b64(notOnCurve), b64(auth)),
		"auth 15 byte":       keys(pk, b64(auth[:15])),
		"auth rỗng":          keys(pk, ""),
	}
	for name, sub := range subs {
		status, gone, err := c.Send(context.Background(), sub, []byte("x"), 60, "", "")
		if err == nil || status != 0 || gone {
			t.Errorf("%s: Send = %d %v %v, cần lỗi", name, status, gone, err)
		}
		// ValidateSubscription (bên lưu token dùng) phải từ chối đúng những gì Send từ chối
		if ValidateSubscription(sub) == nil {
			t.Errorf("%s: ValidateSubscription phải báo lỗi", name)
		}
	}
	if err := ValidateSubscription(strings.Replace(okSub, "http://", "https://", 1)); err != nil {
		t.Errorf("ValidateSubscription subscription https đúng: %v", err)
	}
	if ValidateSubscription(okSub) == nil {
		t.Error("ValidateSubscription phải từ chối endpoint http:// (không có móc allowInsecure)")
	}
	// Tham số gửi sai.
	params := []struct {
		name           string
		ttl            int
		urgency, topic string
	}{
		{"TTL âm", -1, "", ""},
		{"urgency lạ", 60, "urgent", ""},
		{"urgency hoa", 60, "HIGH", ""},
		{"topic 33 ký tự", 60, "", strings.Repeat("a", 33)},
		{"topic có dấu chấm", 60, "", "conv.12"},
		{"topic có khoảng trắng", 60, "", "conv 12"},
	}
	for _, p := range params {
		if status, _, err := c.Send(context.Background(), okSub, []byte("x"), p.ttl, p.urgency, p.topic); err == nil || status != 0 {
			t.Errorf("%s: Send = %d %v, cần lỗi", p.name, status, err)
		}
	}
	// Endpoint http:// bị từ chối khi không bật móc allowInsecure.
	c.allowInsecure = false
	if _, _, err := c.Send(context.Background(), okSub, []byte("x"), 60, "", ""); err == nil || !strings.Contains(err.Error(), "https") {
		t.Errorf("endpoint http: err = %v", err)
	}
	if len(ch) != 0 {
		t.Errorf("dịch vụ push nhận %d request dù đầu vào sai", len(ch))
	}
	// Topic đúng 32 ký tự base64url + khoá có '=' đệm vẫn nhận.
	c.allowInsecure = true
	padded := keys(base64.URLEncoding.EncodeToString(ua.PublicKey().Bytes()), base64.URLEncoding.EncodeToString(auth))
	if _, _, err := c.Send(context.Background(), padded, []byte("x"), 60, "very-low", strings.Repeat("A-_9", 8)); err != nil {
		t.Errorf("topic 32 ký tự / khoá có đệm: %v", err)
	}
	<-ch
}

func TestSendPayloadTooLarge(t *testing.T) {
	srv, ch := pushServer(t, http.StatusCreated, "")
	c := newTestClient(t, srv.Client())
	ua, auth, sub := browserSub(t, srv.URL+"/p/1")
	if _, _, err := c.Send(context.Background(), sub, make([]byte, maxPayload+1), 60, "", ""); !errors.Is(err, errPayloadTooLarge) {
		t.Errorf("payload %d byte: err = %v", maxPayload+1, err)
	}
	if len(ch) != 0 {
		t.Error("payload quá lớn mà vẫn gửi")
	}
	payload := bytes.Repeat([]byte("a"), maxPayload)
	if _, _, err := c.Send(context.Background(), sub, payload, 60, "", ""); err != nil {
		t.Fatalf("payload %d byte: %v", maxPayload, err)
	}
	req := <-ch
	if len(req.body) != headerLen+maxPayload+1+tagLen {
		t.Errorf("thân %d byte", len(req.body))
	}
	if got, err := decrypt(req.body, ua, auth); err != nil || !bytes.Equal(got, payload) {
		t.Errorf("giải mã: %v", err)
	}
	if maxPayload != 4078 {
		t.Errorf("maxPayload = %d", maxPayload)
	}
}

// 1 Client dùng chung cho nhiều goroutine (worker push của chat) - chạy với -race.
func TestSendConcurrent(t *testing.T) {
	const n = 20
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	c := newTestClient(t, srv.Client())
	_, _, sub := browserSub(t, srv.URL+"/p/1")
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			_, _, err := c.Send(context.Background(), sub, []byte(fmt.Sprint("tin ", i)), 60, "high", "conv-1")
			errs <- err
		}()
	}
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Error(err)
		}
	}
}

// Endpoint https thật (TLS của httptest) chạy được khi KHÔNG bật allowInsecure.
func TestSendHTTPS(t *testing.T) {
	gotAuth := make(chan string, 1)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth <- r.Header.Get("Authorization")
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	c := newTestClient(t, srv.Client())
	c.allowInsecure = false
	_, _, sub := browserSub(t, srv.URL+"/p/1")
	if status, gone, err := c.Send(context.Background(), sub, []byte("x"), 60, "", ""); err != nil || status != 201 || gone {
		t.Fatalf("Send = %d %v %v", status, gone, err)
	}
	token, _ := parseVapidAuth(t, <-gotAuth)
	_, claims, err := verifyJWT(token, c.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := url.Parse(srv.URL); claims["aud"] != "https://"+u.Host {
		t.Errorf("aud %v", claims["aud"])
	}
}

func TestSendNetworkError(t *testing.T) {
	srv, _ := pushServer(t, http.StatusCreated, "")
	c := newTestClient(t, srv.Client())
	_, _, sub := browserSub(t, srv.URL+"/p/secret-path")
	srv.Close()
	status, gone, err := c.Send(context.Background(), sub, []byte("x"), 60, "", "")
	if err == nil || status != 0 || gone {
		t.Fatalf("Send = %d %v %v, cần lỗi mạng", status, gone, err)
	}
	if strings.Contains(err.Error(), "secret-path") {
		t.Errorf("lỗi lộ đường dẫn endpoint: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	srv2, _ := pushServer(t, http.StatusCreated, "")
	_, _, sub2 := browserSub(t, srv2.URL+"/p/1")
	if _, _, err := c.Send(ctx, sub2, []byte("x"), 60, "", ""); !errors.Is(err, context.Canceled) {
		t.Errorf("context đã huỷ: err = %v", err)
	}
}

func TestGenerateVAPIDKeysAndNew(t *testing.T) {
	pub, priv, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{pub, priv} {
		if strings.ContainsAny(s, "=+/") {
			t.Errorf("không phải base64url không đệm: %q", s)
		}
	}
	pubRaw, _ := base64.RawURLEncoding.DecodeString(pub)
	privRaw, _ := base64.RawURLEncoding.DecodeString(priv)
	if len(pubRaw) != 65 || pubRaw[0] != 0x04 || len(privRaw) != 32 {
		t.Fatalf("khoá công khai %d byte, khoá bí mật %d byte", len(pubRaw), len(privRaw))
	}
	c, err := New(Options{PublicKey: pub, PrivateKey: priv, Subject: "mailto:support@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if c.PublicKey() != pub || c.hc == nil || c.hc.Timeout != defaultTimeout {
		t.Errorf("PublicKey %q, hc %v", c.PublicKey(), c.hc)
	}
	// Dán khoá có '=' đệm vẫn nhận, PublicKey() trả dạng chuẩn không đệm.
	if c2, err := New(Options{PublicKey: base64.URLEncoding.EncodeToString(pubRaw), PrivateKey: priv, Subject: " https://dezon.tech "}); err != nil || c2.PublicKey() != pub || c2.subject != "https://dezon.tech" {
		t.Errorf("khoá có đệm: %v", err)
	}
	pub2, priv2, _ := GenerateVAPIDKeys()
	if pub2 == pub || priv2 == priv {
		t.Error("2 lần sinh ra cùng khoá")
	}
	zero := b64(make([]byte, 32))
	bad := []struct {
		name string
		o    Options
	}{
		{"khoá không khớp", Options{PublicKey: pub, PrivateKey: priv2, Subject: "https://dezon.tech"}},
		{"thiếu subject", Options{PublicKey: pub, PrivateKey: priv}},
		{"subject toàn khoảng trắng", Options{PublicKey: pub, PrivateKey: priv, Subject: "   "}},
		{"subject không phải URI liên hệ", Options{PublicKey: pub, PrivateKey: priv, Subject: "dezon.tech"}},
		{"thiếu khoá công khai", Options{PrivateKey: priv, Subject: "https://dezon.tech"}},
		{"thiếu khoá bí mật", Options{PublicKey: pub, Subject: "https://dezon.tech"}},
		{"khoá công khai hỏng", Options{PublicKey: "@@@", PrivateKey: priv, Subject: "https://dezon.tech"}},
		{"khoá công khai 64 byte", Options{PublicKey: b64(pubRaw[1:]), PrivateKey: priv, Subject: "https://dezon.tech"}},
		{"khoá bí mật 31 byte", Options{PublicKey: pub, PrivateKey: b64(privRaw[:31]), Subject: "https://dezon.tech"}},
		{"khoá bí mật = 0", Options{PublicKey: pub, PrivateKey: zero, Subject: "https://dezon.tech"}},
		{"đảo 2 khoá", Options{PublicKey: priv, PrivateKey: pub, Subject: "https://dezon.tech"}},
	}
	for _, b := range bad {
		if c, err := New(b.o); err == nil || c != nil {
			t.Errorf("%s: New không báo lỗi", b.name)
		}
	}
}

func TestOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"https://fcm.googleapis.com/fcm/send/abc:def":          "https://fcm.googleapis.com",
		"https://updates.push.services.mozilla.com/wpush/v2/x": "https://updates.push.services.mozilla.com",
		"https://Web.Push.Apple.COM:443/QGu":                   "https://web.push.apple.com",
		"https://push.example.net:8443/p?q=1#f":                "https://push.example.net:8443",
		"http://127.0.0.1:80/p":                                "http://127.0.0.1",
		"http://127.0.0.1:5000/p":                              "http://127.0.0.1:5000",
		"https://[2001:db8::1]/p":                              "https://[2001:db8::1]",
		"https://[2001:db8::1]:8443/p":                         "https://[2001:db8::1]:8443",
	} {
		u, err := url.Parse(in)
		if err != nil {
			t.Fatal(err)
		}
		if got := origin(u); got != want {
			t.Errorf("origin(%s) = %s, cần %s", in, got, want)
		}
	}
}
