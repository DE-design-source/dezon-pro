package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

// Đăng nhập chat bằng tài khoản Dezon Pro (service_dezon.go, 0045). Tài khoản / công ty Dezon Pro là dòng thật trong users /
// companies của database thử (câu kết bạn đồng nghiệp nối users), dọn khi xong.

// dbUsers: UserReader + UserFormatter đọc thẳng bảng users (dòng thô khoá tiếng Việt như users.GetByID).
type dbUsers struct{ p *pgxpool.Pool }

func (u dbUsers) GetByID(ctx context.Context, id any) (*omap.Map, error) {
	var uid, username, name, role, perms string
	var active bool
	var ct *string
	err := u.p.QueryRow(ctx, `select id::text, username, coalesce(full_name, ''), role, coalesce(permissions, ''), is_active,
		company_id::text from users where id = $1::uuid`, id).Scan(&uid, &username, &name, &role, &perms, &active, &ct)
	if noRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var cty any
	if ct != nil {
		cty = *ct
	}
	return omap.Of("id", uid, "username", username, "ho_ten", name, "role", role, "perms", perms, "active", active, "cong_ty_id", cty), nil
}

func (dbUsers) UserOut(row *omap.Map) *omap.Map { return row }

func (dbUsers) PermsArr(v any) []any {
	out := []any{}
	s, _ := v.(string)
	for _, x := range strings.Split(s, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// dezonEnv: env chat + Users nối vào bảng users thật.
type dezonEnv struct {
	*env
	companies []string
}

func newDezonEnv(t *testing.T) *dezonEnv {
	e := newEnv(t, envOpt{})
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select exists(select 1 from information_schema.columns
		where table_schema = 'public' and table_name = 'chat_users' and column_name = 'qs_user_id')`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa chạy migration 0045 (go run ./cmd/migrate --url=...): %v", err)
	}
	u := dbUsers{e.pool}
	e.s.users, e.s.userFmt = u, u
	d := &dezonEnv{env: e}
	t.Cleanup(func() { // chạy TRƯỚC dọn của env (LIFO): xoá công ty kéo theo users (fk on delete cascade)
		ctx := context.Background()
		if _, err := e.pool.Exec(ctx, `delete from companies where id = any($1::uuid[])`, d.companies); err != nil {
			t.Errorf("dọn công ty thử: %v", err)
		}
	})
	return d
}

func (d *dezonEnv) company() string {
	d.t.Helper()
	var id string
	if err := d.pool.QueryRow(context.Background(), `insert into companies (name) values ($1) returning id::text`,
		"Công ty thử chat "+newUUID()[:8]).Scan(&id); err != nil {
		d.t.Fatal(err)
	}
	d.companies = append(d.companies, id)
	return id
}

// qsUser: tài khoản Dezon Pro trong công ty company ("" = không công ty, phải tự dọn - chỉ dùng cho super).
func (d *dezonEnv) qsUser(company, role, perms, name string) *actor.Actor {
	d.t.Helper()
	var ct any
	if company != "" {
		ct = company
	}
	var id string
	username := "chat.thu." + strings.ReplaceAll(newUUID(), "-", "")[:12]
	if err := d.pool.QueryRow(context.Background(), `insert into users (username, full_name, password_hash, role, permissions, company_id)
		values ($1, $2, 'x', $3, $4, $5::uuid) returning id::text`, username, name, role, perms, ct).Scan(&id); err != nil {
		d.t.Fatal(err)
	}
	if company == "" {
		d.t.Cleanup(func() { _, _ = d.pool.Exec(context.Background(), `delete from users where id = $1::uuid`, id) })
	}
	return &actor.Actor{UID: id, U: username, R: role, CT: ct}
}

func (d *dezonEnv) login(a *actor.Actor) (*AuthResult, error) {
	var in DezonInput
	in.Device.Platform = "web"
	in.Device.Name = "Chrome thử"
	r, err := d.s.DezonLogin(context.Background(), a, in)
	if err == nil {
		d.track(r.User.ID)
	}
	return r, err
}

func (d *dezonEnv) mustLogin(a *actor.Actor) *AuthResult {
	d.t.Helper()
	r, err := d.login(a)
	if err != nil {
		d.t.Fatalf("đăng nhập Dezon Pro %s: %v", a.U, err)
	}
	return r
}

func (d *dezonEnv) status(from, to int64) string {
	d.t.Helper()
	var st string
	err := d.pool.QueryRow(context.Background(), `select status from chat_friendships where user_id = $1 and friend_id = $2`, from, to).Scan(&st)
	if noRows(err) {
		return ""
	}
	if err != nil {
		d.t.Fatal(err)
	}
	return st
}

func TestDezonLoginCreatesAndReusesDB(t *testing.T) {
	d := newDezonEnv(t)
	ctx := context.Background()
	co := d.company()
	a := d.qsUser(co, "staff", "boc,chat", "Nguyễn Văn An")
	r := d.mustLogin(a)
	if r.IsNew == nil || !*r.IsNew || r.AccessToken == "" || r.RefreshToken == "" || r.DeviceID <= 0 || r.ExpiresIn != 900 {
		t.Fatalf("lần đầu: %+v", r)
	}
	if r.User.DisplayName != "Nguyễn Văn An" || r.User.Phone != nil || r.User.Email != nil || r.User.Relation != "self" {
		t.Fatalf("hồ sơ: %+v", r.User.UserDTO)
	}
	uid, did, err := d.s.authToken(ctx, r.AccessToken)
	if err != nil || uid != r.User.ID || did != r.DeviceID {
		t.Fatalf("access token: %d %d %v", uid, did, err)
	}
	var method, qs string
	if err := d.pool.QueryRow(ctx, `select d.login_method, u.qs_user_id::text from chat_devices d join chat_users u on u.id = d.user_id
		where d.id = $1`, r.DeviceID).Scan(&method, &qs); err != nil || method != LoginDezon || qs != a.UID {
		t.Fatalf("thiết bị: %q %q %v", method, qs, err)
	}
	if len(d.gw.packets(EvDevicesUpdated, false)) == 0 {
		t.Fatal("thiếu devices.updated")
	}
	// refresh token dùng được như otp/verify
	if rr, err := d.s.Refresh(ctx, r.RefreshToken); err != nil || rr.User.ID != r.User.ID {
		t.Fatalf("refresh: %v", err)
	}

	// đổi họ tên bên Dezon Pro -> lần sau tên chat theo; cùng tài khoản, thiết bị mới
	if _, err := d.pool.Exec(ctx, `update users set full_name = '' where id = $1::uuid`, a.UID); err != nil {
		t.Fatal(err)
	}
	r2 := d.mustLogin(a)
	if *r2.IsNew || r2.User.ID != r.User.ID || r2.DeviceID == r.DeviceID || r2.User.DisplayName != a.U {
		t.Fatalf("lần hai: new=%v id=%d/%d did=%d/%d tên=%q", *r2.IsNew, r2.User.ID, r.User.ID, r2.DeviceID, r.DeviceID, r2.User.DisplayName)
	}
	var n int
	if err := d.pool.QueryRow(ctx, `select count(*) from chat_users where qs_user_id = $1::uuid`, a.UID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("số tài khoản chat của 1 tài khoản Dezon Pro: %d %v", n, err)
	}
}

func TestDezonLoginPermsDB(t *testing.T) {
	d := newDezonEnv(t)
	co := d.company()
	_, err := d.login(d.qsUser(co, "staff", "boc,duan", "Không quyền"))
	wantCode(t, "nhân viên không có quyền chat", err, CodeChatNoPerm)
	if !strings.Contains(err.Error(), "Tài khoản chưa được cấp quyền Chat. Nhờ quản trị viên cấp quyền.") {
		t.Fatalf("thông báo: %v", err)
	}
	d.mustLogin(d.qsUser(co, "admin", "", "Quản trị"))
	sup := d.mustLogin(d.qsUser("", "super", "", "Hệ thống"))
	var n int
	if err := d.pool.QueryRow(context.Background(), `select count(*) from chat_friendships where user_id = $1 or friend_id = $1`,
		sup.User.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("super không có đồng nghiệp: %d %v", n, err)
	}

	off := d.qsUser(co, "staff", "chat", "Đã khoá")
	if _, err := d.pool.Exec(context.Background(), `update users set is_active = false where id = $1::uuid`, off.UID); err != nil {
		t.Fatal(err)
	}
	_, err = d.login(off)
	wantCode(t, "tài khoản đã khoá", err, "NOAUTH")
	_, err = d.login(&actor.Actor{UID: newUUID(), R: "staff"})
	wantCode(t, "tài khoản không còn", err, "NOAUTH")
	_, err = d.s.DezonLogin(context.Background(), nil, DezonInput{})
	wantCode(t, "chưa đăng nhập", err, "NOAUTH")
	var in DezonInput
	in.Device.Platform = "symbian"
	_, err = d.s.DezonLogin(context.Background(), d.qsUser(co, "admin", "", "Sai máy"), in)
	wantCode(t, "platform sai", err, CodeBadRequest)
}

func TestDezonLoginColleaguesDB(t *testing.T) {
	d := newDezonEnv(t)
	ctx := context.Background()
	co, other := d.company(), d.company()
	a := d.mustLogin(d.qsUser(co, "staff", "chat", "An"))
	bq := d.qsUser(co, "staff", "chat", "Bình")
	b := d.mustLogin(bq)
	c := d.mustLogin(d.qsUser(other, "staff", "chat", "Chi"))
	if d.status(a.User.ID, b.User.ID) != "accepted" || d.status(b.User.ID, a.User.ID) != "accepted" {
		t.Fatalf("cùng công ty phải là bạn: %q %q", d.status(a.User.ID, b.User.ID), d.status(b.User.ID, a.User.ID))
	}
	if d.status(a.User.ID, c.User.ID) != "" || d.status(c.User.ID, a.User.ID) != "" {
		t.Fatal("khác công ty không được kết bạn")
	}
	// tài khoản OTP không gắn Dezon Pro: không bao giờ bị kết bạn tự động
	otp := d.user("OTP")
	dq := d.qsUser(co, "staff", "chat", "Dũng")
	dd := d.mustLogin(dq)
	if d.status(dd.User.ID, otp.id) != "" {
		t.Fatal("tài khoản OTP bị kết bạn")
	}
	if d.status(dd.User.ID, a.User.ID) != "accepted" || d.status(dd.User.ID, b.User.ID) != "accepted" {
		t.Fatal("người mới phải là bạn của mọi đồng nghiệp đã có")
	}
	// danh bạ + chat 1-1 dùng được ngay
	fs, err := d.s.Friends(ctx, a.User.ID)
	if err != nil || len(fs) != 2 {
		t.Fatalf("bạn của An: %d %v", len(fs), err)
	}
	if _, err := d.s.CreateDirect(ctx, a.User.ID, b.User.ID); err != nil {
		t.Fatalf("chat 1-1: %v", err)
	}
	if _, err := d.s.CreateGroup(ctx, a.User.ID, "Phòng thử", []int64{b.User.ID, dd.User.ID}); err != nil {
		t.Fatalf("tạo nhóm đồng nghiệp: %v", err)
	}
	// huỷ kết bạn rồi đăng nhập lại: không bị kết bạn lại
	if err := d.s.Unfriend(ctx, b.User.ID, a.User.ID); err != nil {
		t.Fatal(err)
	}
	d.mustLogin(bq)
	if d.status(a.User.ID, b.User.ID) != "" || d.status(b.User.ID, a.User.ID) != "" {
		t.Fatal("đăng nhập lại kết bạn lại người đã huỷ")
	}
}

// Qua HTTP: route cần phiên Dezon Pro (RequireLogin), trả AuthResult như otp/verify.
func TestDezonLoginHTTPDB(t *testing.T) {
	d := newDezonEnv(t)
	a := d.qsUser(d.company(), "staff", "chat", "Hà")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if c.GetHeader("Authorization") == "Bearer qs-token" {
			actor.Set(c, a)
		}
	})
	d.s.RegisterRoutes(r.Group("/api/v1"))

	w := call(r, "POST", "/api/v1/chat/auth/dezon", "", `{"device":{"platform":"web"}}`)
	if w.Code != 401 || w.Body.String() != `{"error":"Chưa đăng nhập","code":"NOAUTH"}` {
		t.Fatalf("không phiên: %d %s", w.Code, w.Body.String())
	}
	w = call(r, "POST", "/api/v1/chat/auth/dezon", "qs-token", `{"device":{"platform":"web","name":"Chrome"}}`)
	var res struct {
		OK     bool       `json:"ok"`
		Result AuthResult `json:"result"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &res) != nil || !res.OK || res.Result.AccessToken == "" ||
		res.Result.RefreshToken == "" || res.Result.IsNew == nil || !*res.Result.IsNew || res.Result.User == nil {
		t.Fatalf("đăng nhập: %d %s", w.Code, w.Body.String())
	}
	d.track(res.Result.User.ID)
	body := w.Body.String()
	if !strings.HasPrefix(body, `{"ok":true,"result":{"access_token":"`) || !strings.Contains(body, `"display_name":"Hà","phone":null,"email":null,"relation":"self"`) {
		t.Fatalf("thân: %s", body)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control %q", cc)
	}
	// token chat dùng được ở route chat
	if w := call(r, "GET", "/api/v1/chat/me", res.Result.AccessToken, ""); w.Code != 200 {
		t.Fatalf("/me: %d %s", w.Code, w.Body.String())
	}
	if w := call(r, "POST", "/api/v1/chat/auth/dezon", "qs-token", `[1]`); w.Code != 400 {
		t.Fatalf("thân hỏng: %d %s", w.Code, w.Body.String())
	}
}

// Refresh của tài khoản gắn Dezon Pro kiểm lại tài khoản Dezon Pro: thu quyền chat / khoá / xoá -> REFRESH_INVALID + xoá thiết bị.
func TestDezonRefreshRevokedDB(t *testing.T) {
	d := newDezonEnv(t)
	ctx := context.Background()
	co := d.company()
	a := d.qsUser(co, "staff", "boc,chat", "Lan")
	exec := func(sql string) {
		t.Helper()
		if _, err := d.pool.Exec(ctx, sql, a.UID); err != nil {
			t.Fatal(err)
		}
	}
	devGone := func(what string, did int64) {
		t.Helper()
		var n int
		if err := d.pool.QueryRow(ctx, `select count(*) from chat_devices where id = $1`, did).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s: thiết bị còn %d %v", what, n, err)
		}
	}
	cases := []struct{ what, bad, fix string }{
		{"thu quyền chat", `update users set permissions = 'boc' where id = $1::uuid`, `update users set permissions = 'boc,chat' where id = $1::uuid`},
		{"khoá tài khoản", `update users set is_active = false where id = $1::uuid`, `update users set is_active = true where id = $1::uuid`},
		{"xoá tài khoản", `delete from users where id = $1::uuid`, ``},
	}
	for _, c := range cases {
		r := d.mustLogin(a)
		rr, err := d.s.Refresh(ctx, r.RefreshToken)
		if err != nil {
			t.Fatalf("%s: refresh trước: %v", c.what, err)
		}
		exec(c.bad)
		_, err = d.s.Refresh(ctx, rr.RefreshToken)
		wantCode(t, c.what, err, CodeRefreshInvalid)
		devGone(c.what, r.DeviceID)
		if c.fix != "" {
			exec(c.fix)
		}
	}
	// admin không cần quyền "chat"; tài khoản OTP không bị kiểm (qs_user_id null)
	ad := d.mustLogin(d.qsUser(co, "admin", "", "Quản trị"))
	if _, err := d.s.Refresh(ctx, ad.RefreshToken); err != nil {
		t.Fatalf("admin refresh: %v", err)
	}
	otp := d.user("OTP")
	raw, hash, err := newRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.pool.Exec(ctx, `insert into chat_refresh_tokens (device_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`,
		otp.did, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := d.s.Refresh(ctx, raw); err != nil {
		t.Fatalf("OTP refresh: %v", err)
	}
}

// Đổi công ty bên Dezon Pro: lần đăng nhập chat sau bỏ kết bạn với đồng nghiệp cũ (tài khoản gắn Dezon Pro), kết bạn đồng
// nghiệp mới; bạn OTP, bạn ở công ty thứ ba, dòng blocked giữ nguyên. Không đổi công ty thì không kết bạn lại.
func TestDezonLoginMoveCompanyDB(t *testing.T) {
	d := newDezonEnv(t)
	ctx := context.Background()
	co, other, third := d.company(), d.company(), d.company()
	aq := d.qsUser(co, "staff", "chat", "An")
	a := d.mustLogin(aq)
	b := d.mustLogin(d.qsUser(co, "staff", "chat", "Bình"))
	c := d.mustLogin(d.qsUser(other, "staff", "chat", "Chi"))
	e := d.mustLogin(d.qsUser(other, "staff", "chat", "Em"))
	x := d.mustLogin(d.qsUser(third, "staff", "chat", "Xuân"))
	qsCo := func() string {
		t.Helper()
		var v string
		if err := d.pool.QueryRow(ctx, `select coalesce(qs_company_id::text, '') from chat_users where id = $1`, a.User.ID).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	if qsCo() != co {
		t.Fatalf("qs_company_id lúc tạo: %q", qsCo())
	}
	me, otp := &tu{id: a.User.ID}, d.user("OTP")
	d.friends(me, otp)
	d.friends(me, &tu{id: x.User.ID})
	if err := d.s.Block(ctx, e.User.ID, a.User.ID); err != nil {
		t.Fatal(err)
	}
	both := func(what string, other int64, want string) {
		t.Helper()
		if d.status(a.User.ID, other) != want || d.status(other, a.User.ID) != want {
			t.Fatalf("%s: %q %q, muốn %q", what, d.status(a.User.ID, other), d.status(other, a.User.ID), want)
		}
	}
	d.mustLogin(aq)
	both("chưa đổi công ty", b.User.ID, "accepted")
	both("chưa đổi công ty", c.User.ID, "")

	if _, err := d.pool.Exec(ctx, `update users set company_id = $2::uuid where id = $1::uuid`, aq.UID, other); err != nil {
		t.Fatal(err)
	}
	d.mustLogin(aq)
	both("đồng nghiệp cũ", b.User.ID, "")
	both("đồng nghiệp mới", c.User.ID, "accepted")
	both("bạn OTP", otp.id, "accepted")
	both("bạn công ty thứ ba", x.User.ID, "accepted")
	if d.status(e.User.ID, a.User.ID) != "blocked" || d.status(a.User.ID, e.User.ID) != "" {
		t.Fatalf("dòng chặn bị đụng: %q %q", d.status(e.User.ID, a.User.ID), d.status(a.User.ID, e.User.ID))
	}
	if qsCo() != other {
		t.Fatalf("qs_company_id sau khi chuyển: %q", qsCo())
	}
	// đã ở công ty mới: huỷ kết bạn rồi đăng nhập lại không bị kết bạn lại
	if err := d.s.Unfriend(ctx, a.User.ID, c.User.ID); err != nil {
		t.Fatal(err)
	}
	d.mustLogin(aq)
	both("huỷ kết bạn ở công ty mới", c.User.ID, "")
}
