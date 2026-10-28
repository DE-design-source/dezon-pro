package auth

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/modules/users"
	"qspro-backend/internal/modules/users/userstest"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/goonly"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

const testSecret = "zz-authusers-test-secret"

// Giá trị mong đợi trong testdata/pure.json lấy từ mã Node thật (testdata/gen.js).
func loadPure(t *testing.T) *omap.Map {
	t.Helper()
	b, err := os.ReadFile("testdata/pure.json")
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return jsval.AsMap(v)
}

func js(v any) string { s, _ := omap.MarshalString(v); return s }

func orNil(m *omap.Map) any {
	if m == nil {
		return nil
	}
	return m
}

type auditRec struct{ rows []*omap.Map }

func (r *auditRec) Audit(_ context.Context, a *actor.Actor, action, detail string, congTyID any) {
	var uid any
	u := ""
	if a != nil {
		uid, u = a.UID, a.U
	}
	r.rows = append(r.rows, omap.Of("uid", uid, "u", u, "action", action, "detail", detail, "ct", congTyID))
}

func newPure(secret string, now float64) *Service {
	s := New(Deps{Cfg: &config.Config{AuthSecret: secret}})
	s.now = func() float64 { return now }
	return s
}

func TestTokenGolden(t *testing.T) {
	pure := loadPure(t)
	now := jsval.ToNumber(pure.Val("now"))
	for _, c := range jsval.AsArray(pure.Val("makeToken")) {
		p := jsval.AsArray(c)
		s := newPure(jsval.AsString(p[0]), now)
		got := s.makeToken(jsval.AsMap(p[1]))
		if got != p[2] {
			t.Errorf("makeToken(%s) khoá %q\n  go:   %s\n  node: %s", js(p[1]), p[0], got, p[2])
		}
		// token Node phát ra phải kiểm được bằng Go (cùng khoá) và không kiểm được bằng khoá khác
		if s.VerifyToken(jsval.AsString(p[2])) == nil {
			t.Errorf("VerifyToken không nhận token của Node: %s", p[2])
		}
		if newPure("khoa-khac", now).VerifyToken(jsval.AsString(p[2])) != nil {
			t.Errorf("VerifyToken nhận token ký bằng khoá khác")
		}
	}
	s := newPure(testSecret, now)
	for i, c := range jsval.AsArray(pure.Val("verifyToken")) {
		p := jsval.AsArray(c)
		if got, want := js(orNil(s.VerifyToken(jsval.AsString(p[0])))), js(p[1]); got != want {
			t.Errorf("verifyToken #%d (%s)\n  go:   %s\n  node: %s", i, p[0], got, want)
		}
	}
	exp := jsval.AsArray(pure.Val("verifyExpired"))
	tok := jsval.AsString(exp[0])
	if newPure(testSecret, now+tokenTTLMs+1).VerifyToken(tok) != nil {
		t.Error("token quá hạn 1 ms vẫn được nhận")
	}
	if newPure(testSecret, now+tokenTTLMs).VerifyToken(tok) == nil {
		t.Error("token đúng lúc hết hạn (exp == now) phải còn được nhận như Node")
	}
}

func TestBcryptGolden(t *testing.T) {
	pure := loadPure(t)
	check := func(name string, ok bool, err error, want any) {
		t.Helper()
		if m := jsval.AsMap(want); m != nil {
			if err == nil || err.Error() != m.Val("err") {
				t.Errorf("%s: lỗi %v, node ném %q", name, err, m.Val("err"))
			}
			return
		}
		if err != nil || ok != want {
			t.Errorf("%s = %v, %v; node = %v", name, ok, err, want)
		}
	}
	for i, c := range jsval.AsArray(pure.Val("compareSync")) {
		p := jsval.AsArray(c)
		ok, err := compareSync(jsval.AsString(p[0]), jsval.AsString(p[1]))
		check("compareSync #"+jsval.ToString(float64(i))+" "+jsval.AsString(p[1]), ok, err, p[2])
	}
	for i, c := range jsval.AsArray(pure.Val("pwOk")) {
		p := jsval.AsArray(c)
		ok, isBcrypt, err := pwOk(jsval.AsMap(p[0]), jsval.AsString(p[1]))
		name := "pwOk #" + jsval.ToString(float64(i))
		if m := jsval.AsMap(p[2]); m != nil && m.Has("err") {
			check(name, ok, err, p[2])
			continue
		}
		if got, want := js(omap.Of("ok", ok, "isBcrypt", isBcrypt)), js(p[2]); err != nil || got != want {
			t.Errorf("%s = %s, %v; node = %s", name, got, err, want)
		}
	}
}

func TestHashSync(t *testing.T) {
	long := "ậ" + strings.Repeat("x", 68) + "ẩ" + "tail"
	for _, pw := range []string{"abcd", "", "mật khẩu 😀", long} {
		h, err := hashSync(pw)
		if err != nil || len(h) != 60 || h[:7] != "$2a$10$" {
			t.Fatalf("hashSync(%q) = %q, %v", pw, h, err)
		}
		if ok, err := compareSync(pw, h); !ok || err != nil {
			t.Errorf("compareSync không nhận hash vừa băm của %q", pw)
		}
	}
	h, _ := hashSync(long)
	if ok, _ := compareSync("ậ"+strings.Repeat("x", 68)+"ắ khác", h); !ok {
		t.Error("72 byte đầu giống nhau phải khớp như bcryptjs")
	}
	if ok, _ := compareSync("ậ"+strings.Repeat("x", 68)+"é", h); ok {
		t.Error("khác ở byte thứ 72 thì không được khớp")
	}
}

// TestInteropOut: đặt INTEROP_OUT=<file> để ghi token + hash do Go sinh ra, rồi kiểm bằng Node:
// AUTH_SECRET=zz-authusers-test-secret node testdata/interop-node.js <file>.
// Chỉ còn kiểm định dạng + chữ ký + bcrypt: từ M1.2 token không có "sid" (token của Node, makeToken ở đây) bị
// SessionActor từ chối, nên token Node và Go KHÔNG còn dùng lẫn để đăng nhập được.
func TestInteropOut(t *testing.T) {
	out := os.Getenv("INTEROP_OUT")
	if out == "" {
		t.Skip("chưa đặt INTEROP_OUT")
	}
	s := New(Deps{Cfg: &config.Config{AuthSecret: testSecret}})
	u := omap.Of("id", "68cb6934-c871-4681-8cfe-def02ba28b0c", "username", "ü名 \"x\"", "role", "admin", "cong_ty_id", nil)
	hashes := []any{}
	for _, pw := range []string{"abcd", "", "mật khẩu 😀", "ậ" + strings.Repeat("x", 68) + "ẩtail", strings.Repeat("y", 72), "a\x00b"} {
		h, err := hashSync(pw)
		if err != nil {
			t.Fatal(err)
		}
		hashes = append(hashes, omap.Of("pw", pw, "hash", h))
	}
	b, _ := omap.Marshal(omap.Of("token", s.makeToken(u), "user", u, "hashes", hashes))
	if err := os.WriteFile(out, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPureHelpersGolden(t *testing.T) {
	pure := loadPure(t)
	for i, c := range jsval.AsArray(pure.Val("sort")) {
		p := jsval.AsArray(c)
		rows := []*omap.Map{}
		for _, r := range jsval.AsArray(p[0]) {
			rows = append(rows, jsval.AsMap(r))
		}
		sortCandidates(rows)
		ids := make([]any, len(rows))
		for j, r := range rows {
			ids[j] = r.Val("id")
		}
		if got, want := js(ids), js(p[1]); got != want {
			t.Errorf("sort #%d = %s, node = %s", i, got, want)
		}
	}
	for _, c := range jsval.AsArray(pure.Val("prefsOf")) {
		p := jsval.AsArray(c)
		if got, want := js(prefsOf(jsval.AsMap(p[0]))), js(p[1]); got != want {
			t.Errorf("prefsOf(%s) = %s, node = %s", js(p[0]), got, want)
		}
	}
	rec := &auditRec{}
	s := New(Deps{Auditor: rec})
	for _, c := range jsval.AsArray(pure.Val("logClientError")) {
		p := jsval.AsArray(c)
		rec.rows = nil
		res, err := s.LogClientError(context.Background(), &actor.Actor{UID: "u1", U: "ten"}, p[0])
		if err != nil || js(res) != js(p[2]) || len(rec.rows) != 1 {
			t.Fatalf("LogClientError(%s) = %s, %v", js(p[0]), js(res), err)
		}
		want := jsval.AsMap(p[1])
		got := rec.rows[0]
		if got.Val("detail") != want.Val("detail") || got.Val("action") != want.Val("action") || got.Val("u") != want.Val("username") {
			t.Errorf("LogClientError(%s)\n  go:   %s\n  node: %s", js(p[0]), js(got), js(want))
		}
	}
}

func TestNodeBase64(t *testing.T) {
	// Buffer.from(x, "base64").toString("latin1") của Node
	cases := map[string]string{"": "", "QQ": "A", "QQ==": "A", "QUI": "AB", "QUJD": "ABC", "QU JD\n": "ABC", "QUJDRA": "ABCD",
		"Q": "", "QUJDR": "ABC", "QQ==QQ": "A", "_-8": "\xff\xef", "/+8": "\xff\xef", "Q!U@J#D": "ABC"}
	for in, want := range cases {
		if got := string(nodeBase64(in)); got != want {
			t.Errorf("nodeBase64(%q) = %q, muốn %q", in, got, want)
		}
	}
}

// ───────────── cache phiên 30 giây (repository + công ty giả) ─────────────

type fakeRepo struct {
	Repository
	rows  []*omap.Map
	err   error
	calls int

	phien    map[string]string // sid -> uid (bảng phiên giả)
	phienErr error             // lỗi của mọi lệnh trên bảng phiên
	alive    int               // số lần SessionAlive
	onRemove func()            // chạy ngay sau khi RemoveUserSessions xoá dòng (giả lập request xen giữa)
}

func (f *fakeRepo) SessionUser(context.Context, any) ([]*omap.Map, error) {
	f.calls++
	return f.rows, f.err
}

func (f *fakeRepo) SessionAlive(_ context.Context, sid string, uid any, _ string) (bool, error) {
	f.alive++
	if f.phienErr != nil {
		return false, f.phienErr
	}
	u, ok := f.phien[sid]
	return ok && u == jsval.ToString(uid), nil
}

func (f *fakeRepo) RemoveSession(_ context.Context, sid string) error {
	if f.phienErr != nil {
		return f.phienErr
	}
	delete(f.phien, sid)
	return nil
}

func (f *fakeRepo) RemoveUserSessions(_ context.Context, uid any, keep string) ([]string, error) {
	if f.phienErr != nil {
		return nil, f.phienErr
	}
	ids := []string{}
	for sid, u := range f.phien {
		if u == jsval.ToString(uid) && sid != keep {
			delete(f.phien, sid)
			ids = append(ids, sid)
		}
	}
	if f.onRemove != nil {
		f.onRemove()
	}
	return ids, nil
}

const (
	sid1 = "11111111-1111-4111-8111-111111111111"
	sid2 = "22222222-2222-4222-8222-222222222222"
)

type fakeCompanies struct {
	ct      *omap.Map
	expired bool
	calls   int
}

func (f *fakeCompanies) GetCongTy(_ context.Context, id any) (*omap.Map, error) {
	f.calls++
	return f.ct, nil
}
func (f *fakeCompanies) HetHan(*omap.Map) bool { return f.expired }

func TestSessionCache(t *testing.T) {
	now := 1790000000000.0
	repo := &fakeRepo{rows: []*omap.Map{omap.Of("id", "u1", "username", "moi", "role", "admin", "active", true, "cong_ty_id", "c1")}}
	comp := &fakeCompanies{ct: omap.Of("id", "c1", "active", true, "hanDung", "")}
	s := New(Deps{Cfg: &config.Config{AuthSecret: testSecret}, Companies: comp})
	repo.phien = map[string]string{sid1: "u1"}
	s.repo = repo
	s.now = func() float64 { return now }
	ctx := context.Background()
	tok := s.makeTokenSid(omap.Of("id", "u1", "username", "cu", "role", "staff", "cong_ty_id", nil), sid1)
	exp := now + tokenTTLMs

	get := func() *actor.Actor {
		t.Helper()
		a, err := s.SessionActor(ctx, tok)
		if err != nil {
			t.Fatal(err)
		}
		return a
	}
	// payload của token bị đè bởi r / ct / u trong database
	a := get()
	if a == nil || a.UID != "u1" || a.U != "moi" || a.R != "admin" || a.CT != "c1" || a.Exp != exp || a.SID != sid1 {
		t.Fatalf("actor = %+v", a)
	}
	if got := js(a); got != `{"uid":"u1","u":"moi","r":"admin","ct":"c1","exp":1790604800000}` {
		t.Errorf("actor json = %s", got)
	}
	// trong 30 giây: không đọc lại database dù dữ liệu đã đổi
	repo.rows[0].Set("active", false)
	now += sessionCacheMs - 1
	if get() == nil || repo.calls != 1 || comp.calls != 1 {
		t.Fatalf("cache dương không được dùng: calls = %d", repo.calls)
	}
	// đủ 30 giây: đọc lại -> tài khoản đã khoá -> nil, và kết quả ÂM cũng được giữ
	now++
	if get() != nil || repo.calls != 2 {
		t.Fatalf("hết hạn cache phải đọc lại: calls = %d", repo.calls)
	}
	repo.rows[0].Set("active", true)
	now += sessionCacheMs - 1
	if get() != nil || repo.calls != 2 {
		t.Fatal("cache âm không được dùng")
	}
	// ForgetSession: có hiệu lực ngay
	s.ForgetSession("u1")
	if get() == nil || repo.calls != 3 {
		t.Fatal("ForgetSession không xoá mục cache")
	}
	// công ty khoá / hết hạn / không có -> nil (super miễn trừ, không đọc công ty)
	for _, f := range []func(){
		func() { comp.ct = omap.Of("id", "c1", "active", false) },
		func() { comp.ct = omap.Of("id", "c1", "active", true); comp.expired = true },
		func() { comp.expired = false; comp.ct = nil },
		func() { comp.ct = omap.Of("id", "c1", "active", true); repo.rows[0].Set("cong_ty_id", nil) },
	} {
		f()
		s.ForgetSession("u1")
		if get() != nil {
			t.Error("công ty khoá / hết hạn / thiếu mà phiên vẫn hợp lệ")
		}
	}
	repo.rows[0].Set("role", "super")
	s.ForgetSession("u1")
	before := comp.calls
	if a := get(); a == nil || a.R != "super" || a.CT != nil || comp.calls != before {
		t.Errorf("super không cần công ty: %+v", a)
	}
	// không có dòng nào -> nil; lỗi database -> trả lỗi và KHÔNG ghi cache
	repo.rows = nil
	s.ForgetSession("u1")
	if get() != nil {
		t.Error("tài khoản không tồn tại mà phiên vẫn hợp lệ")
	}
	s.ForgetSession("u1")
	repo.err = errors.New("mất kết nối")
	if _, err := s.SessionActor(ctx, tok); err == nil {
		t.Fatal("lỗi database phải được trả về")
	}
	repo.err = nil
	n := repo.calls
	if get(); repo.calls != n+1 {
		t.Error("lỗi database không được ghi vào cache")
	}
	// token sai: không đọc database
	n = repo.calls
	if a, err := s.SessionActor(ctx, tok+"x"); a != nil || err != nil || repo.calls != n {
		t.Error("token sai chữ ký")
	}
	// uid dạng số: so theo String(uid)
	s.mu.Lock()
	s.sess[sid2] = sessEntry{at: now, uid: "12"}
	s.mu.Unlock()
	s.ForgetSession(12.0)
	if _, ok := s.sess[sid2]; ok {
		t.Error("ForgetSession(12) không xoá phiên của uid \"12\"")
	}
}

// ───────────── đối chiếu với Node trên database thử ─────────────

// TestDiffNode chạy testdata/diff-cases.json qua cổng rpc (module auth nối với module users thật, qspro_gotest)
// và so từng ca với kết quả của server/auth.js trên qspro_nodetest (testdata/diff-golden.txt, sinh bằng
// AUTH_SECRET=zz-authusers-test-secret node ../users/userstest/diff-node.js a 2 testdata/diff-cases.json testdata/diff-golden.txt).
func TestDiffNode(t *testing.T) {
	su := userstest.Open(t, "a", "2")
	su.Diff(t, "testdata/diff-cases.json", "testdata/diff-golden.txt", func() func(userstest.Case, userstest.Who, []any) (any, error) {
		cfg := &config.Config{AuthSecret: testSecret}
		comp := userstest.Companies{DB: su.DB}
		usersSvc := users.New(users.Deps{DB: su.DB, Cfg: cfg})
		svc := New(Deps{DB: su.DB, Cfg: cfg, Users: usersSvc, UserFormatter: usersSvc, Auditor: usersSvc, Companies: comp})
		usersSvc.SetCompanyReader(comp)
		usersSvc.SetSessionInvalidator(svc)
		reg := rpc.NewRegistry()
		svc.RegisterRPC(reg)
		wantPerm := map[string]rpc.Perm{"login": rpc.Public, "me": rpc.Login, "setMyPref": rpc.Login, "logout": rpc.Login,
			"changePassword": rpc.Login, "logClientError": rpc.Login}
		if n := len(reg.Names()); n != len(wantPerm) {
			t.Fatalf("đăng ký %d hàm rpc, muốn %d", n, len(wantPerm))
		}
		for n, p := range wantPerm {
			if got, ok := reg.PermOf(n); !ok || got != p {
				t.Errorf("%s: quyền %v, muốn %v", n, got, p)
			}
		}
		usersSvc.RegisterRPC(reg)
		return func(c userstest.Case, w userstest.Who, args []any) (any, error) {
			a := rpc.Args(args)
			switch c.Fn {
			case "$sessionActor":
				act, err := svc.SessionActor(w.Ctx, jsval.AsString(a.Arg(0)))
				if act == nil || err != nil {
					return nil, err
				}
				return act, nil
			case "$verifyToken": // khoá sid chỉ bản Go (M1.2, ARCHITECTURE 10.4)
				return goonly.Strip(orNil(svc.VerifyToken(jsval.AsString(a.Arg(0)))), "sid"), nil
			case "$makeToken":
				// Từ M1.2 token phải mang phiên còn dòng: mở phiên thật; uid không mở được phiên (không phải uuid /
				// không có tài khoản) thì gắn sid ngẫu nhiên - các ca đó dừng ở bước đọc tài khoản như Node.
				tok, err := svc.openSession(w.Ctx, a.Map(0))
				if err != nil {
					tok = svc.makeTokenSid(a.Map(0), "99999999-9999-4999-8999-999999999999")
				}
				return omap.Of("token", tok), nil
			case "$forget":
				svc.ForgetSession(a.Arg(0))
				return nil, nil
			}
			return reg.Call(w.Ctx, c.Fn, w.Actor, args...)
		}
	})
}

// Route REST: đúng đường dẫn của PORTING_MAP mục A; trừ login, chưa đăng nhập -> 401 NOAUTH.
func TestRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	New(Deps{}).RegisterRoutes(e.Group("/api/v1"))
	want := map[string]bool{"POST /api/v1/auth/login": true, "GET /api/v1/auth/me": true, "PUT /api/v1/auth/me/prefs/:key": true,
		"POST /api/v1/auth/logout": true, "POST /api/v1/auth/change-password": true, "POST /api/v1/client-errors": true}
	for _, r := range e.Routes() {
		k := r.Method + " " + r.Path
		if !want[k] {
			t.Errorf("route thừa: %s", k)
		}
		delete(want, k)
		if k == "POST /api/v1/auth/login" {
			continue
		}
		w := httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest(r.Method, strings.ReplaceAll(r.Path, ":key", "tkCols"), nil))
		if w.Code != 401 || w.Body.String() != `{"error":"Chưa đăng nhập","code":"NOAUTH"}` {
			t.Errorf("%s chưa đăng nhập: %d %s", k, w.Code, w.Body.String())
		}
	}
	for k := range want {
		t.Errorf("thiếu route: %s", k)
	}
}

func (f *fakeRepo) InsertSession(_ context.Context, uid any, _ string) (string, error) {
	if f.phienErr != nil {
		return "", f.phienErr
	}
	sid := sid1
	if _, ok := f.phien[sid1]; ok {
		sid = sid2
	}
	f.phien[sid] = jsval.ToString(uid)
	return sid, nil
}

func (f *fakeRepo) RemoveExpiredSessions(context.Context, any, string) error { return f.phienErr }

// ───────────── phiên lưu phía máy chủ (M1.2) ─────────────

func TestPhienDangNhap(t *testing.T) {
	now := 1790000000000.0
	repo := &fakeRepo{rows: []*omap.Map{omap.Of("id", "u1", "username", "a", "role", "super", "active", true)}, phien: map[string]string{}}
	s := New(Deps{Cfg: &config.Config{AuthSecret: testSecret}, Auditor: &auditRec{}})
	s.repo = repo
	s.now = func() float64 { return now }
	ctx := context.Background()
	u := omap.Of("id", "u1", "username", "a", "role", "super")
	get := func(tok string) *actor.Actor {
		t.Helper()
		a, err := s.SessionActor(ctx, tok)
		if err != nil {
			t.Fatal(err)
		}
		return a
	}

	// token cũ không có sid: từ chối, không đọc database
	if get(s.makeToken(u)) != nil || repo.calls != 0 {
		t.Fatal("token không có sid phải bị từ chối mà không đọc database")
	}
	// sid sai dạng: từ chối
	if get(s.makeTokenSid(u, "khong-phai-uuid")) != nil || repo.calls != 0 {
		t.Fatal("sid sai dạng phải bị từ chối")
	}

	// 2 nơi đăng nhập -> 2 phiên
	tokA, err := s.openSession(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	tokB, _ := s.openSession(ctx, u)
	if s.VerifyToken(tokA).Val("sid") != sid1 || s.VerifyToken(tokB).Val("sid") != sid2 {
		t.Fatalf("token không mang sid: %s / %s", js(s.VerifyToken(tokA)), js(s.VerifyToken(tokB)))
	}
	a := get(tokA)
	if a == nil || a.SID != sid1 || get(tokB) == nil {
		t.Fatal("phiên mới phải hợp lệ")
	}
	// sid của phiên này nhưng uid khác (không xảy ra với token thật) -> không hợp lệ
	if get(s.makeTokenSid(omap.Of("id", "u2", "username", "x", "role", "super"), sid1)) != nil {
		t.Error("phiên của u1 không được dùng cho u2")
	}

	// đăng xuất ở A: A bị từ chối NGAY (không chờ hết 30 giây cache), B vẫn chạy
	if _, err := s.Logout(ctx, a); err != nil {
		t.Fatal(err)
	}
	if get(tokA) != nil {
		t.Error("token đã đăng xuất vẫn được nhận")
	}
	if get(tokB) == nil {
		t.Error("đăng xuất một nơi làm nơi kia mất phiên")
	}

	// request đang đọc database lúc đăng xuất không được ghi lại kết quả dương vào cache
	tokC, _ := s.openSession(ctx, u) // sid1 trống lại -> dùng sid1
	repo.phien[sid1] = "u1"
	s.revokeCache(func(string, sessEntry) bool { return false }, sid1) // thu hồi xen giữa (dòng vẫn còn)
	if get(tokC) != nil {
		t.Error("phiên vừa thu hồi không được ghi cache dương")
	}
	now += 2*sessionCacheMs + 1
	s.revokeCache(func(string, sessEntry) bool { return false }) // dọn danh sách thu hồi cũ
	if _, ok := s.revoked[sid1]; ok {
		t.Error("danh sách thu hồi không được dọn")
	}

	// đổi mật khẩu: thu hồi mọi phiên KHÁC, giữ phiên đang dùng
	repo.phien = map[string]string{sid1: "u1", sid2: "u1"}
	s.ForgetSession("u1")
	if get(tokA) == nil || get(tokB) == nil {
		t.Fatal("chuẩn bị: 2 phiên phải hợp lệ")
	}
	if err := s.closeOtherSessions(ctx, "u1", sid2); err != nil {
		t.Fatal(err)
	}
	if get(tokA) != nil || get(tokB) == nil {
		t.Error("đổi mật khẩu phải thu hồi phiên khác và giữ phiên hiện tại")
	}

	// race khi thu hồi theo tài khoản: phiên A CHƯA có trong cache, request của A đọc "còn dòng" trước lệnh xoá và ghi
	// cache dương ngay sau lệnh xoá -> vẫn bị bỏ, và sid A nằm trong danh sách thu hồi (request ghi muộn hơn cũng bị chặn)
	repo.phien = map[string]string{sid1: "u1", sid2: "u1"}
	s.ForgetSession("u1")
	repo.onRemove = func() {
		s.mu.Lock()
		s.sess[sid1] = sessEntry{at: now, uid: "u1", u: omap.Of("r", "super", "ct", nil, "u", "a")}
		s.mu.Unlock()
	}
	if err := s.RevokeUserSessions(ctx, "u1", ""); err != nil { // admin đặt lại mật khẩu: thu hồi hết
		t.Fatal(err)
	}
	repo.onRemove = nil
	if _, ok := s.revoked[sid1]; !ok {
		t.Error("sid vừa xoá trong database phải vào danh sách thu hồi")
	}
	if get(tokA) != nil || get(tokB) != nil {
		t.Error("thu hồi mọi phiên mà token vẫn được nhận")
	}

	// cache không phình theo số lần đăng nhập: mục quá 30 giây bị dọn ở lần ghi kế tiếp
	s.mu.Lock()
	for i := 0; i < 100; i++ {
		s.sess["cu-"+jsval.ToString(float64(i))] = sessEntry{at: now, uid: "x"}
	}
	s.mu.Unlock()
	now += sessionCacheMs
	repo.phien = map[string]string{sid2: "u1"}
	s.revoked = map[string]float64{}
	if get(tokB) == nil {
		t.Fatal("phiên B mở lại phải hợp lệ")
	}
	if n := len(s.sess); n != 1 {
		t.Errorf("cache còn %d mục, muốn 1 (chỉ phiên vừa ghi)", n)
	}

	// database chưa chạy 0014: lỗi đích danh (SessionStoreError), không phải nil
	repo.phienErr = &database.Error{Msg: "DB GET phien_dang_nhap -> 404 ...", Code: "PGRST205", Status: 404}
	s.ForgetSession("u1")
	var se *middleware.SessionStoreError
	if _, err := s.SessionActor(ctx, tokB); !errors.As(err, &se) || se.Msg != msgSessTable {
		t.Errorf("thiếu bảng phiên: err = %v", err)
	}
	if _, err := s.openSession(ctx, u); !errors.As(err, &se) {
		t.Errorf("đăng nhập khi thiếu bảng phiên: err = %v", err)
	}
	if _, err := s.Logout(ctx, &actor.Actor{UID: "u1", SID: sid2}); !errors.As(err, &se) {
		t.Errorf("đăng xuất khi thiếu bảng phiên: err = %v", err)
	}
	// lỗi khác của database giữ nguyên
	repo.phienErr = errors.New("mất kết nối")
	if _, err := s.SessionActor(ctx, tokB); err == nil || errors.As(err, &se) {
		t.Errorf("lỗi thường bị đổi: %v", err)
	}
}

// Bảng phiên không có company_id và không nằm trong TenantTables (bảng hệ thống, mọi truy vấn noScope - xem
// data-dictionary.md). Lớp dữ liệu không có lọc dự phòng, nên chỉ module auth được chạm tới bảng: code mới ở
// chỗ khác phải đi qua auth (SessionInvalidator), không tự đọc / xoá phiên của mọi công ty.
func TestPhienChiTruyCapQuaAuth(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return err
		}
		if strings.HasPrefix(filepath.ToSlash(p), "../../modules/auth/") { // chủ của bảng
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if s := string(b); strings.Contains(s, `"phien_dang_nhap"`) || strings.Contains(s, `"user_sessions"`) {
			t.Errorf("%s truy cập thẳng bảng phiên đăng nhập; dùng contracts.SessionInvalidator của auth", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// TOKEN_TTL_DAYS (chỉ bản Go): đặt thì đổi hạn token + phiên; bỏ trống giữ 7 ngày của Node.
func TestTokenTTLDays(t *testing.T) {
	if got := New(Deps{Cfg: &config.Config{TokenTTLDays: 30}}).ttlMs; got != 30*24*3600*1000 {
		t.Errorf("TOKEN_TTL_DAYS=30: ttlMs = %v", got)
	}
	if got := New(Deps{Cfg: &config.Config{}}).ttlMs; got != tokenTTLMs {
		t.Errorf("không đặt: ttlMs = %v, mong %v", got, float64(tokenTTLMs))
	}
}
