package users

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"qspro-backend/internal/modules/users/userstest"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

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

func TestPureGolden(t *testing.T) {
	pure := loadPure(t)
	s := &Service{}
	for _, c := range jsval.AsArray(pure.Val("permsArr")) {
		p := jsval.AsArray(c)
		if got, want := js(s.PermsArr(p[0])), js(p[1]); got != want {
			t.Errorf("PermsArr(%s) = %s, node = %s", js(p[0]), got, want)
		}
	}
	for _, c := range jsval.AsArray(pure.Val("userOut")) {
		p := jsval.AsArray(c)
		if got, want := js(s.UserOut(jsval.AsMap(p[0]))), js(p[1]); got != want {
			t.Errorf("UserOut(%s)\n  go:   %s\n  node: %s", js(p[0]), got, want)
		}
	}
	for _, c := range jsval.AsArray(pure.Val("limit")) {
		p := jsval.AsArray(c)
		n, text, ok := auditLimit(p[0])
		want := jsval.ToNumber(p[1])
		if text != "" { // số âm ngoài int32: so chữ Node ghép vào SQL
			if text != jsval.NumberToString(want) {
				t.Errorf("auditLimit(%s) text = %q; node = %s", js(p[0]), text, js(p[1]))
			}
			continue
		}
		if (want == 0) != !ok || (ok && float64(n) != want) {
			t.Errorf("auditLimit(%s) = %d, %v; node = %s", js(p[0]), n, ok, js(p[1]))
		}
	}
	for _, c := range jsval.AsArray(pure.Val("lower")) {
		p := jsval.AsArray(c)
		if got := toLowerCase(jsval.AsString(p[0])); got != p[1] {
			t.Errorf("toLowerCase(%q) = %q, node = %q", p[0], got, p[1])
		}
	}
	for _, c := range jsval.AsArray(pure.Val("colErr")) {
		p := jsval.AsArray(c)
		e := errors.New(jsval.AsString(p[0]))
		if got := phongBanColErr(e); got != p[1] {
			t.Errorf("phongBanColErr(%q) = %v", p[0], got)
		}
		if got := permsColErr(e).Error(); got != p[2] {
			t.Errorf("permsColErr(%q) = %q, node = %q", p[0], got, p[2])
		}
	}
}

func TestPermsArrUndefined(t *testing.T) {
	s := &Service{}
	if got := js(s.PermsArr(jsval.Undefined)); got != "[]" {
		t.Errorf("PermsArr(undefined) = %s", got)
	}
	if got := js(s.PermsArr(nil)); got != "[]" {
		t.Errorf("PermsArr(null) = %s", got)
	}
}

func TestHashSync(t *testing.T) {
	// hash của Go phải có dạng bcryptjs sinh ra ($2a$10$, 60 ký tự); mật khẩu dài hơn 72 byte không được báo lỗi
	long := ""
	for i := 0; i < 30; i++ {
		long += "mật"
	}
	for _, pw := range []string{"abcd", "", long} {
		h, err := hashSync(pw)
		if err != nil || len(h) != 60 || h[:7] != "$2a$10$" {
			t.Errorf("hashSync(%q) = %q, %v", pw, h, err)
		}
	}
}

// ───────────── repository giả: Audit nuốt lỗi, thứ tự khoá của dòng ghi ─────────────

type fakeRepo struct {
	Repository
	audits []*omap.Map
	fail   bool
	boom   bool
}

func (f *fakeRepo) InsertAudit(_ context.Context, row *omap.Map) error {
	if f.boom {
		panic("hỏng")
	}
	f.audits = append(f.audits, row)
	if f.fail {
		return errors.New("lỗi database")
	}
	return nil
}

func TestAuditRow(t *testing.T) {
	f := &fakeRepo{}
	s := &Service{repo: f}
	ctx := context.Background()
	s.Audit(ctx, nil, "a", "d", nil)
	s.Audit(ctx, &actor.Actor{U: "ten"}, "login_fail", "x", jsval.Undefined)
	s.Audit(ctx, &actor.Actor{UID: "u1", U: "ten"}, "login", "y", "c1")
	s.Audit(ctx, &actor.Actor{UID: 0.0, U: "job", R: "super"}, "z", "", "")
	want := []string{
		`{"user_id":null,"username":"","action":"a","detail":"d"}`,
		`{"user_id":null,"username":"ten","action":"login_fail","detail":"x"}`,
		`{"user_id":"u1","username":"ten","action":"login","detail":"y","cong_ty_id":"c1"}`,
		`{"user_id":null,"username":"job","action":"z","detail":""}`,
	}
	for i, w := range want {
		if got := js(f.audits[i]); got != w {
			t.Errorf("audit %d = %s, muốn %s", i, got, w)
		}
	}
	f.fail = true
	s.Audit(ctx, nil, "a", "d", nil) // lỗi insert bị nuốt
	f.boom = true
	s.Audit(ctx, nil, "a", "d", nil) // panic cũng không lọt ra ngoài
}

// ───────────── đối chiếu với Node trên database thử ─────────────

type forgetRec struct{ uids, revoked []string }

func (f *forgetRec) ForgetSession(uid any) { f.uids = append(f.uids, jsval.ToString(uid)) }

func (f *forgetRec) RevokeUserSessions(_ context.Context, uid any, _ string) error {
	f.revoked = append(f.revoked, jsval.ToString(uid))
	return nil
}

// TestDiffNode chạy testdata/diff-cases.json qua cổng rpc của module (qspro_gotest) và so từng ca với kết quả của
// server/auth.js trên qspro_nodetest (testdata/diff-golden.txt, sinh bằng userstest/diff-node.js u 1 ...).
func TestDiffNode(t *testing.T) {
	su := userstest.Open(t, "u", "1")
	rec := &forgetRec{}
	su.Diff(t, "testdata/diff-cases.json", "testdata/diff-golden.txt", func() func(userstest.Case, userstest.Who, []any) (any, error) {
		svc := New(Deps{DB: su.DB})
		svc.SetCompanyReader(userstest.Companies{DB: su.DB})
		rec.uids, rec.revoked = nil, nil
		svc.SetSessionInvalidator(rec)
		reg := rpc.NewRegistry()
		svc.RegisterRPC(reg)
		if n := len(reg.Names()); n != 7 {
			t.Fatalf("đăng ký %d hàm rpc, muốn 7", n)
		}
		for _, n := range reg.Names() {
			if p, _ := reg.PermOf(n); p != rpc.Admin {
				t.Errorf("%s: quyền %v, muốn Admin", n, p)
			}
		}
		return func(c userstest.Case, w userstest.Who, args []any) (any, error) {
			switch c.Fn {
			case "$getUserById":
				return svc.GetByID(w.Ctx, args[0])
			case "$audit":
				a := rpc.Args(args)
				svc.Audit(w.Ctx, actor.FromMap(a.Map(0)), a.Str(1), a.Str(2), a.ArgU(3))
				return nil, nil
			}
			return reg.Call(w.Ctx, c.Fn, w.Actor, args...)
		}
	})
	// forgetSession_ được gọi sau mỗi lần sửa / khoá / xoá thành công (A:407, 422, 431)
	if len(rec.uids) < 10 {
		t.Errorf("ForgetSession được gọi %d lần", len(rec.uids))
	}
	// M1.2: admin đặt lại mật khẩu thành công -> thu hồi phiên của tài khoản đó
	if len(rec.revoked) == 0 {
		t.Error("AdminSetPassword không thu hồi phiên")
	}
}

// Route REST: đúng đường dẫn của PORTING_MAP mục A, đăng ký không đụng nhau, chưa đăng nhập -> 401 NOAUTH.
func TestRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	(&Service{}).RegisterRoutes(e.Group("/api/v1"))
	want := map[string]bool{"GET /api/v1/users": true, "POST /api/v1/users": true, "PATCH /api/v1/users/:id": true,
		"PUT /api/v1/users/:id/password": true, "PUT /api/v1/users/:id/active": true, "DELETE /api/v1/users/:id": true,
		"GET /api/v1/audit-log": true, "PATCH /api/v1/auth/me": true}
	for _, r := range e.Routes() {
		k := r.Method + " " + r.Path
		if !want[k] {
			t.Errorf("route thừa: %s", k)
		}
		delete(want, k)
		w := httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest(r.Method, strings.ReplaceAll(r.Path, ":id", "x"), nil))
		if w.Code != 401 || w.Body.String() != `{"error":"Chưa đăng nhập","code":"NOAUTH"}` {
			t.Errorf("%s chưa đăng nhập: %d %s", k, w.Code, w.Body.String())
		}
	}
	for k := range want {
		t.Errorf("thiếu route: %s", k)
	}
}
