package chat

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	apperr "qspro-backend/internal/shared/errors"
)

// Test có database: chỉ chạy khi đặt TEST_DATABASE_URL, và tên database phải chứa "test" hoặc "tmp"
// (vd qspro_chattest, đã chạy migration 0018 + 0019; test bật tệp cần thêm 0020). Mỗi test tự tạo tài khoản với số điện thoại / email ngẫu nhiên và
// dọn khi xong.

var (
	sharedDB   *database.DB
	sharedOnce sync.Once
)

func testDB(t *testing.T) *database.DB {
	t.Helper()
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("TEST_DATABASE_URL hỏng: %v", err)
	}
	name := strings.ToLower(strings.TrimPrefix(u.Path, "/"))
	if !strings.Contains(name, "test") && !strings.Contains(name, "tmp") {
		t.Fatalf("TEST_DATABASE_URL phải trỏ tới database thử (tên chứa test / tmp), đang là %q", name)
	}
	if dbu := os.Getenv("DATABASE_URL"); dbu != "" && dbu == raw {
		t.Fatal("TEST_DATABASE_URL trùng DATABASE_URL")
	}
	sharedOnce.Do(func() { sharedDB = database.New(database.Config{URL: raw}) })
	p, err := sharedDB.Pool()
	if err != nil {
		t.Fatal(err)
	}
	var ok bool
	if err := p.QueryRow(context.Background(), `select to_regclass('public.chat_messages') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có bảng chat (chạy go run ./cmd/migrate --url=...): %v", err)
	}
	return sharedDB
}

// env: service + công cụ của một test.
type env struct {
	t     *testing.T
	s     *Service
	pool  *pgxpool.Pool
	gw    *fakeGW
	media *fakeMediaStore // nil khi envOpt.media = false
	push  *fakePush
	sms   *fakeSMS
	mail  *fakeMail
	clk   *clock
	mu    sync.Mutex
	uids  []int64
	ph    []string
	em    []string
}

type envOpt struct {
	noGateway    bool
	push         bool
	otpDev       bool
	media        bool // bật tệp với kho giả fakeMediaStore (cần migration 0020)
	scanInfected bool // bộ quét giả báo mọi tệp nhiễm virus
}

func newEnv(t *testing.T, o envOpt) *env {
	t.Helper()
	db := testDB(t)
	p, _ := db.Pool()
	e := &env{t: t, pool: p, sms: &fakeSMS{}, mail: &fakeMail{}, clk: newClock()}
	d := Deps{DB: db, Cfg: &config.Config{AuthSecret: "bi-mat-test", ChatOTPDev: o.otpDev}, SMS: e.sms, Mail: e.mail, Now: e.clk.now}
	if o.push {
		e.push = newFakePush()
		d.Push = e.push
	}
	if o.media {
		requireMediaSchema(t, p)
		e.media = newFakeMediaStore()
		d.Media = e.media
		d.Scan = &fakeScanner{infected: o.scanInfected}
	}
	e.s = New(d)
	e.s.pushRetry = []time.Duration{time.Millisecond, 2 * time.Millisecond}
	if !o.noGateway {
		e.gw = newFakeGW()
		e.s.SetGateway(e.gw)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		e.s.Shutdown(ctx)
		e.cleanup()
	})
	return e
}

func (e *env) cleanup() {
	ctx := context.Background()
	e.mu.Lock()
	ids, phones, emails := e.uids, e.ph, e.em
	e.mu.Unlock()
	type cleanQ struct {
		sql string
		arg any
	}
	qs := []cleanQ{
		{`delete from chat_conversations where created_by = any($1::bigint[])`, ids},
		{`delete from chat_conversations c where exists (select 1 from chat_messages m where m.conversation_id = c.id and m.sender_id = any($1::bigint[]))`, ids},
	}
	var hasMedia bool
	_ = e.pool.QueryRow(ctx, `select to_regclass('public.chat_media') is not null`).Scan(&hasMedia)
	if hasMedia { // 0020: tệp của người thử (sau khi tin dùng tệp đã xoá theo hội thoại; FK on delete restrict)
		qs = append(qs, cleanQ{`delete from chat_media where uploader_id = any($1::bigint[])`, ids})
	}
	qs = append(qs,
		cleanQ{`delete from chat_users where id = any($1::bigint[])`, ids},
		cleanQ{`delete from chat_otp_codes where phone = any($1::text[])`, phones},
		cleanQ{`delete from chat_otp_codes where email = any($1::text[])`, emails},
	)
	for _, q := range qs {
		if _, err := e.pool.Exec(ctx, q.sql, q.arg); err != nil {
			e.t.Errorf("dọn dữ liệu thử: %v", err)
		}
	}
}

var phoneSeq atomic.Int64

// randPhone: số di động VN ngẫu nhiên +849xxxxxxxx (đăng ký để dọn).
func (e *env) randPhone() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1e7))
	p := fmt.Sprintf("+849%01d%07d", phoneSeq.Add(1)%10, n.Int64())
	e.mu.Lock()
	e.ph = append(e.ph, p)
	e.mu.Unlock()
	return p
}

// randEmail: email ngẫu nhiên chữ thường (đăng ký để dọn).
func (e *env) randEmail() string {
	m := "thu." + strings.ReplaceAll(newUUID(), "-", "")[:16] + "@chat-test.vn"
	e.mu.Lock()
	e.em = append(e.em, m)
	e.mu.Unlock()
	return m
}

func (e *env) track(uid int64) {
	e.mu.Lock()
	e.uids = append(e.uids, uid)
	e.mu.Unlock()
}

// tu: một tài khoản thử đã đăng nhập (1 thiết bị). phone = "" khi tạo bằng email (userEmail).
type tu struct {
	id, did int64
	phone   string
	email   string
	name    string
	token   string
}

// user tạo thẳng tài khoản + thiết bị trong DB (nhanh, không qua OTP).
func (e *env) user(name string) *tu {
	e.t.Helper()
	ctx := context.Background()
	u := &tu{phone: e.randPhone(), name: name}
	if err := e.pool.QueryRow(ctx, `insert into chat_users (phone, display_name) values ($1, $2) returning id`, u.phone, name).Scan(&u.id); err != nil {
		e.t.Fatal(err)
	}
	e.track(u.id)
	u.did = e.device(u.id)
	u.token = signAccess(e.s.jwtKey, u.id, u.did, e.clk.now(), e.s.accessTTL)
	return u
}

// userEmail tạo thẳng tài khoản theo email (không có số) + thiết bị trong DB.
func (e *env) userEmail(name string) *tu {
	e.t.Helper()
	ctx := context.Background()
	u := &tu{email: e.randEmail(), name: name}
	if err := e.pool.QueryRow(ctx, `insert into chat_users (email, display_name) values ($1, $2) returning id`, u.email, name).Scan(&u.id); err != nil {
		e.t.Fatal(err)
	}
	e.track(u.id)
	u.did = e.device(u.id)
	u.token = signAccess(e.s.jwtKey, u.id, u.did, e.clk.now(), e.s.accessTTL)
	return u
}

// device: thêm một thiết bị còn phiên (có refresh token chưa hết hạn, như sau otp/verify) cho tài khoản uid.
func (e *env) device(uid int64) int64 {
	e.t.Helper()
	ctx := context.Background()
	var did int64
	if err := e.pool.QueryRow(ctx, `insert into chat_devices (user_id, platform) values ($1, 'web') returning id`, uid).Scan(&did); err != nil {
		e.t.Fatal(err)
	}
	_, hash, err := newRefreshToken()
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into chat_refresh_tokens (device_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`,
		did, hash); err != nil {
		e.t.Fatal(err)
	}
	return did
}

// friends: a và b thành bạn bè.
func (e *env) friends(a, b *tu) {
	e.t.Helper()
	ctx := context.Background()
	if st, err := e.s.SendFriendRequest(ctx, a.id, b.id); err != nil || st != "pending" {
		e.t.Fatalf("mời kết bạn: %q %v", st, err)
	}
	if err := e.s.AcceptFriendRequest(ctx, b.id, a.id); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) send(u *tu, conv int64, text string) *SendAck {
	e.t.Helper()
	ack, err := e.s.SendMessage(context.Background(), u.id, SendInput{ConversationID: conv, ClientMsgID: newUUID(), MsgType: "text", Content: text})
	if err != nil {
		e.t.Fatalf("gửi tin: %v", err)
	}
	return ack
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// codeOf: mã lỗi chat của err ("" = không phải lỗi nghiệp vụ).
func codeOf(err error) string {
	var ae *apperr.AppError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return ""
}

func wantCode(t *testing.T, what string, err error, code string) {
	t.Helper()
	if got := codeOf(err); got != code {
		t.Fatalf("%s: lỗi %v (mã %q), muốn mã %q", what, err, got, code)
	}
}

// ───────────── Gateway / SMS / push giả ─────────────

type sentPkt struct {
	users []int64
	typ   string
	data  any
}

type fakeGW struct {
	mu      sync.Mutex
	sent    []sentPkt
	online  map[int64]bool
	closed  []int64
	revoked [][2]int64 // (người xem, người bị thôi xem)
}

func newFakeGW() *fakeGW { return &fakeGW{online: map[int64]bool{}} }

func (g *fakeGW) ServeHTTP(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(299) }

func (g *fakeGW) SendToUsers(ids []int64, typ string, data any) {
	g.mu.Lock()
	g.sent = append(g.sent, sentPkt{users: append([]int64(nil), ids...), typ: typ, data: data})
	g.mu.Unlock()
}

func (g *fakeGW) OnlineUsers(ids []int64) map[int64]bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := map[int64]bool{}
	for _, id := range ids {
		if g.online[id] {
			out[id] = true
		}
	}
	return out
}

func (g *fakeGW) CloseDevice(did int64) {
	g.mu.Lock()
	g.closed = append(g.closed, did)
	g.mu.Unlock()
}

func (g *fakeGW) RevokePresence(viewer int64, targets []int64) {
	g.mu.Lock()
	for _, t := range targets {
		g.revoked = append(g.revoked, [2]int64{viewer, t})
	}
	g.mu.Unlock()
}

// revokedPairs: các cặp RevokePresence đã gọi (xoá danh sách khi reset).
func (g *fakeGW) revokedPairs(reset bool) [][2]int64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := append([][2]int64(nil), g.revoked...)
	if reset {
		g.revoked = nil
	}
	return out
}

// Submit chạy luôn (đồng bộ): test thấy kết quả phân phối ngay sau khi gửi.
func (g *fakeGW) Submit(_ int64, job func()) bool { job(); return true }

func (g *fakeGW) Shutdown(context.Context) {}

func (g *fakeGW) setOnline(id int64, on bool) {
	g.mu.Lock()
	g.online[id] = on
	g.mu.Unlock()
}

// packets: các gói kiểu typ đã gửi (xoá danh sách khi reset).
func (g *fakeGW) packets(typ string, reset bool) []sentPkt {
	g.mu.Lock()
	defer g.mu.Unlock()
	var out []sentPkt
	for _, p := range g.sent {
		if p.typ == typ {
			out = append(out, p)
		}
	}
	if reset {
		g.sent = nil
	}
	return out
}

type fakeSMS struct {
	mu   sync.Mutex
	last map[string]string
}

func (f *fakeSMS) Send(_ context.Context, phone, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.last == nil {
		f.last = map[string]string{}
	}
	f.last[phone] = reOTPCode.FindString(text)
	return nil
}

func (f *fakeSMS) code(phone string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.last[phone]
}

// fakeMail: MailSender giả - nhớ thư cuối theo địa chỉ; fail != nil thì trả lỗi đó.
type fakeMail struct {
	mu   sync.Mutex
	fail error
	last map[string]sentMail
}

type sentMail struct{ subject, text, html string }

func (f *fakeMail) Send(_ context.Context, to, subject, text, html string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return f.fail
	}
	if f.last == nil {
		f.last = map[string]sentMail{}
	}
	f.last[to] = sentMail{subject, text, html}
	return nil
}

func (f *fakeMail) setFail(err error) {
	f.mu.Lock()
	f.fail = err
	f.mu.Unlock()
}

// msg: thư cuối đã gửi tới to; code: mã 6 số trong thư đó.
func (f *fakeMail) msg(to string) sentMail {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.last[to]
}

func (f *fakeMail) code(to string) string { return reOTPCode.FindString(f.msg(to).text) }

type pushCall struct {
	sub     string
	payload pushPayload
	ttl     int
	urgency string
	topic   string
}

type fakePush struct {
	mu     sync.Mutex
	calls  chan pushCall
	answer func(n int, sub string) (int, bool, error) // n = số lần gọi tính tới lần này (1, 2, ...)
	n      int
}

func newFakePush() *fakePush { return &fakePush{calls: make(chan pushCall, 100)} }

func (f *fakePush) PublicKey() string { return "BPubThu" }

func (f *fakePush) Send(_ context.Context, sub string, payload []byte, ttl int, urgency, topic string) (int, bool, error) {
	var p pushPayload
	_ = json.Unmarshal(payload, &p)
	f.mu.Lock()
	f.n++
	n, ans := f.n, f.answer
	f.mu.Unlock()
	f.calls <- pushCall{sub: sub, payload: p, ttl: ttl, urgency: urgency, topic: topic}
	if ans != nil {
		return ans(n, sub)
	}
	return 201, false, nil
}

// next: lần gọi push tiếp theo (hết giờ -> nil).
func (f *fakePush) next(d time.Duration) *pushCall {
	select {
	case c := <-f.calls:
		return &c
	case <-time.After(d):
		return nil
	}
}

// subJSON: PushSubscription hợp lệ (endpoint FCM giả).
func subJSON(tag string) string {
	b, _ := json.Marshal(map[string]any{"endpoint": "https://fcm.googleapis.com/fcm/send/" + tag,
		"keys": map[string]string{"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", "auth": "tBHItJI5svbpez7KI4CCXg"}})
	return string(b)
}

// ───────────── Kho tệp / bộ quét giả (tệp đính kèm, 0020) ─────────────

// requireMediaSchema: database thử phải có bảng chat_media (migration 0020) - chỉ test bật tệp mới cần.
func requireMediaSchema(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	var ok bool
	if err := p.QueryRow(context.Background(), `select to_regclass('public.chat_media') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có bảng chat_media (chạy go run ./cmd/migrate --url=... để áp 0020_chat_media.sql): %v", err)
	}
}

// fakeMediaStore: MediaStore giả trong bộ nhớ. URL ký có dạng http://fake/<khoá>?ttl=<giây>&...
type fakeMediaStore struct {
	mu       sync.Mutex
	objects  map[string][]byte
	types    map[string]string
	notReady bool  // Ready() = false (kho đang khởi động)
	failCopy error // != nil: Copy trả lỗi này
}

func newFakeMediaStore() *fakeMediaStore {
	return &fakeMediaStore{objects: map[string][]byte{}, types: map[string]string{}}
}

// putObject: đặt thẳng object (như trình duyệt đã PUT xong).
func (f *fakeMediaStore) putObject(key string, b []byte) {
	f.mu.Lock()
	f.objects[key] = append([]byte(nil), b...)
	f.mu.Unlock()
}

func (f *fakeMediaStore) has(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.objects[key]
	return ok
}

func (f *fakeMediaStore) Ready() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return !f.notReady
}

func (f *fakeMediaStore) PresignPut(_ context.Context, key, contentType string, size int64, ttl time.Duration) (string, map[string]string, error) {
	return fmt.Sprintf("http://fake/%s?ttl=%d&method=PUT", key, int64(ttl/time.Second)),
		map[string]string{"Content-Type": contentType, "Content-Length": fmt.Sprint(size)}, nil
}

func (f *fakeMediaStore) PresignGet(_ context.Context, key string, ttl time.Duration, contentType, disposition, cacheControl string) (string, error) {
	q := url.Values{}
	q.Set("ttl", fmt.Sprint(int64(ttl/time.Second)))
	q.Set("response-content-type", contentType)
	q.Set("response-content-disposition", disposition)
	q.Set("response-cache-control", cacheControl)
	return "http://fake/" + key + "?" + q.Encode(), nil
}

func (f *fakeMediaStore) Stat(_ context.Context, key string) (int64, string, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return 0, "", false, nil
	}
	return int64(len(b)), f.types[key], true, nil
}

func (f *fakeMediaStore) Copy(_ context.Context, src, dst string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failCopy != nil {
		return f.failCopy
	}
	b, ok := f.objects[src]
	if !ok {
		return fmt.Errorf("fake: không có object %s", src)
	}
	f.objects[dst] = append([]byte(nil), b...)
	f.types[dst] = f.types[src]
	return nil
}

func (f *fakeMediaStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("fake: không có object %s", key)
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (f *fakeMediaStore) ReadPrefix(_ context.Context, key string, n int64) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("fake: không có object %s", key)
	}
	return append([]byte(nil), b[:min(int64(len(b)), n)]...), nil
}

func (f *fakeMediaStore) Get(_ context.Context, key string, maxBytes int64) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("fake: không có object %s", key)
	}
	if int64(len(b)) > maxBytes {
		return nil, fmt.Errorf("fake: object %s lớn hơn %d byte", key, maxBytes)
	}
	return append([]byte(nil), b...), nil
}

func (f *fakeMediaStore) Put(_ context.Context, key string, data []byte, contentType string) error {
	f.mu.Lock()
	f.objects[key] = append([]byte(nil), data...)
	f.types[key] = contentType
	f.mu.Unlock()
	return nil
}

func (f *fakeMediaStore) Remove(_ context.Context, keys ...string) error {
	f.mu.Lock()
	for _, k := range keys {
		delete(f.objects, k)
		delete(f.types, k)
	}
	f.mu.Unlock()
	return nil
}

var _ MediaStore = (*fakeMediaStore)(nil)

// fakeScanner: bộ quét giả - đọc hết luồng (để TeeReader băm đủ), infected = true thì báo nhiễm.
type fakeScanner struct{ infected bool }

func (f *fakeScanner) Scan(_ context.Context, r io.Reader, _ int64) (bool, error) {
	if _, err := io.Copy(io.Discard, r); err != nil {
		return false, err
	}
	return !f.infected, nil
}

// readyMedia: tạo thẳng một tệp ready của uid (dòng chat_media + object trong kho giả), trả id.
// typ: image / video / file / voice. Cần envOpt.media.
func (e *env) readyMedia(uid int64, typ string) int64 {
	e.t.Helper()
	if e.media == nil {
		e.t.Fatal("readyMedia cần envOpt{media: true}")
	}
	body := make([]byte, 64)
	_, _ = rand.Read(body)
	mt := map[string]string{MediaImage: "image/png", MediaVideo: "video/mp4", MediaFile: "application/pdf", MediaVoice: "audio/webm"}[typ]
	if mt == "" {
		e.t.Fatalf("readyMedia: loại %q sai", typ)
	}
	var (
		name *string
		dur  *int
		wave []int16
	)
	if typ == MediaFile {
		n := "tai-lieu.pdf"
		name = &n
	}
	if typ == MediaVoice {
		d := 12000
		dur, wave = &d, []int16{0, 64, 128, 255}
	}
	key, err := objectKey(uid, e.clk.now())
	if err != nil {
		e.t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	now := e.clk.now()
	var id int64
	if err := e.pool.QueryRow(context.Background(), `insert into chat_media (uploader_id, media_type, mime_type, size_bytes, sha256, file_name,
		object_key, status, duration_ms, waveform, created_at, updated_at)
		values ($1::bigint, $2, $3, $4::bigint, $5, $6, $7, 'ready', $8::integer, $9::smallint[], $10::timestamptz, $10::timestamptz) returning id`,
		uid, typ, mt, int64(len(body)), hex.EncodeToString(sum[:]), name, key, dur, wave, now).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	e.media.putObject(key, body)
	return id
}
