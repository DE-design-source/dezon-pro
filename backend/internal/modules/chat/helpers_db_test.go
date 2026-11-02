package chat

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
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
// (vd qspro_chattest, đã chạy migration 0018 + 0019). Mỗi test tự tạo tài khoản với số điện thoại / email ngẫu nhiên và
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
	t    *testing.T
	s    *Service
	pool *pgxpool.Pool
	gw   *fakeGW
	push *fakePush
	sms  *fakeSMS
	mail *fakeMail
	clk  *clock
	mu   sync.Mutex
	uids []int64
	ph   []string
	em   []string
}

type envOpt struct {
	noGateway bool
	push      bool
	otpDev    bool
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
	for _, q := range []struct {
		sql string
		arg any
	}{
		{`delete from chat_conversations where created_by = any($1::bigint[])`, ids},
		{`delete from chat_conversations c where exists (select 1 from chat_messages m where m.conversation_id = c.id and m.sender_id = any($1::bigint[]))`, ids},
		{`delete from chat_users where id = any($1::bigint[])`, ids},
		{`delete from chat_otp_codes where phone = any($1::text[])`, phones},
		{`delete from chat_otp_codes where email = any($1::text[])`, emails},
	} {
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
