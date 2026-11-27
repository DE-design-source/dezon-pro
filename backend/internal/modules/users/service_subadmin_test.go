package users

import (
	"context"
	"errors"
	"strings"
	"testing"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// subRepo: approvalRepo + các lệnh tạo / xoá / liệt kê cho cửa ngõ của subadmin (M14.7). okWrite = UpdateUser thành công.
type subRepo struct {
	*approvalRepo
	okWrite bool
	inserts []string
	deletes []string
	list    []*omap.Map
}

func (r *subRepo) UpdateUser(ctx context.Context, id any, patch *omap.Map) ([]*omap.Map, error) {
	res, err := r.approvalRepo.UpdateUser(ctx, id, patch)
	if r.okWrite {
		return []*omap.Map{r.users[jsval.ToString(id)]}, nil
	}
	return res, err
}

func (r *subRepo) UsersByUsername(context.Context, string) ([]*omap.Map, error) { return nil, nil }

func (r *subRepo) InsertUser(_ context.Context, row *omap.Map) ([]*omap.Map, error) {
	js, _ := omap.MarshalString(omap.Of("role", row.Val("role"), "perms", row.Val("perms"), "cong_ty_id", row.Val("cong_ty_id")))
	r.inserts = append(r.inserts, js)
	return []*omap.Map{omap.Of("id", "new", "username", row.Val("username"), "role", row.Val("role"))}, nil
}

func (r *subRepo) DeleteUser(_ context.Context, id any) error {
	r.deletes = append(r.deletes, jsval.ToString(id))
	return errors.New("dừng sau kiểm quyền")
}

func (r *subRepo) ListUsers(context.Context, bool) ([]*omap.Map, error) { return r.list, nil }

func (r *subRepo) ActiveAdmins(context.Context, any) ([]*omap.Map, error) {
	return []*omap.Map{omap.Of("id", "a1"), omap.Of("id", "a2")}, nil
}

type noCompanies struct{}

func (noCompanies) GetCongTy(context.Context, any) (*omap.Map, error) { return nil, nil }
func (noCompanies) HetHan(*omap.Map) bool                             { return false }

func newSubRepo() *subRepo {
	r := &subRepo{approvalRepo: newApprovalRepo()}
	for k, v := range map[string]*omap.Map{
		"m1": omap.Of("id", "m1", "username", "sub1", "role", "subadmin", "cong_ty_id", "c1", "perms", "boc,sp_edit"),
		"m2": omap.Of("id", "m2", "username", "sub2", "role", "subadmin", "cong_ty_id", "c1", "perms", "boc"),
		"m3": omap.Of("id", "m3", "username", "sub3", "role", "subadmin", "cong_ty_id", "c1", "perms", "sp_duyet,da_duyet", "duoc_duyet_sp", true),
		"n3": omap.Of("id", "n3", "username", "nv3", "role", "staff", "cong_ty_id", "c1", "perms", "sp_edit,da_duyet"),
		"n4": omap.Of("id", "n4", "username", "nv4", "role", "staff", "cong_ty_id", "c1", "perms", "boc"),
		"x1": omap.Of("id", "x1", "username", "nvx", "role", "staff", "cong_ty_id", "c2", "perms", "sp_edit"),
	} {
		r.users[k] = v
	}
	return r
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

const stopWrite = "dừng sau kiểm quyền"

func TestSubAdminGated(t *testing.T) {
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "m1", Role: "subadmin", CongTyID: "c1"})
	m1 := &actor.Actor{UID: "m1", U: "sub1", R: "subadmin", CT: "c1"}
	m2 := &actor.Actor{UID: "m2", U: "sub2", R: "subadmin", CT: "c1"}
	m3 := &actor.Actor{UID: "m3", U: "sub3", R: "subadmin", CT: "c1"}
	a1 := &actor.Actor{UID: "a1", U: "ad1", R: "admin", CT: "c1"}
	sup := &actor.Actor{UID: "s", U: "sa", R: "super"}
	perms := func(p ...any) []any { return p }
	type env struct {
		s *Service
		r *subRepo
		g *fakeGranter
	}
	mk := func() env {
		r := newSubRepo()
		g := &fakeGranter{legacyOK: true}
		s := &Service{repo: r, access: g, companies: noCompanies{}}
		return env{s, r, g}
	}
	calls := func(g *fakeGranter) string { return strings.Join(g.calls, ";") }

	// tự sửa mình: perms bị bỏ, role (giữ subadmin) bị bỏ; không kiểm / ghim gì
	e := mk()
	_, err := e.s.AdminUpdateUserGated(ctx, m1, "m1", omap.Of("perms", perms("sp_duyet", "da_duyet"), "role", "subadmin", "hoTen", "x"))
	if errStr(err) != stopWrite || len(e.r.patches) != 1 || e.r.patches[0] != `m1 {"ho_ten":"x"}` || calls(e.g) != "" {
		t.Errorf("tự sửa: %v %v %q", err, e.r.patches, calls(e.g))
	}
	if _, err := mk().s.AdminUpdateUserGated(ctx, m1, "m1", omap.Of("role", "staff")); errStr(err) != msgSelfRole {
		t.Errorf("tự hạ vai trò: %v", err)
	}
	// tự đặt mật khẩu cho mình: qua cửa ngõ, không CheckUserWithin
	e = mk()
	if _, err := e.s.AdminSetPasswordGated(ctx, m1, "m1", "12345"); errStr(err) != stopWrite || calls(e.g) != "" {
		t.Errorf("tự đặt mật khẩu: %v %q", err, calls(e.g))
	}

	// không đụng admin / subadmin khác / công ty khác
	for _, id := range []string{"a1", "m2"} {
		if _, err := mk().s.AdminSetPasswordGated(ctx, m1, id, "12345"); errStr(err) != msgSubStaffOnly {
			t.Errorf("đặt mật khẩu %s: %v", id, err)
		}
	}
	if _, err := mk().s.AdminDeleteUserGated(ctx, m1, "x1"); errStr(err) != msgNotFound {
		t.Errorf("xoá công ty khác: %v", err)
	}
	if _, err := mk().s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("role", "subadmin")); errStr(err) != msgSubStaffOnly {
		t.Errorf("nâng nhân viên: %v", err)
	}

	// CheckUserWithin lỗi -> trả nguyên lỗi, không ghi
	ops := map[string]func(s *Service) error{
		"mật khẩu": func(s *Service) error { _, err := s.AdminSetPasswordGated(ctx, m1, "n1", "12345"); return err },
		"khoá":     func(s *Service) error { _, err := s.AdminSetActiveGated(ctx, m1, "n1", false); return err },
		"xoá":      func(s *Service) error { _, err := s.AdminDeleteUserGated(ctx, m1, "n1"); return err },
		"sửa": func(s *Service) error {
			_, err := s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("hoTen", "y"))
			return err
		},
	}
	for n, f := range ops {
		e := mk()
		e.g.withinErr = errors.New("vượt quyền của bạn")
		if err := f(e.s); errStr(err) != "vượt quyền của bạn" || len(e.r.patches)+len(e.r.deletes) != 0 || calls(e.g) != "within:m1 n1" {
			t.Errorf("%s khi đích vượt quyền: %v %v %v %q", n, err, e.r.patches, e.r.deletes, calls(e.g))
		}
		// đích trong quyền -> tới bước ghi
		e = mk()
		if err := f(e.s); errStr(err) != stopWrite {
			t.Errorf("%s đích trong quyền: %v", n, err)
		}
	}

	// đích giữ quyền duyệt / mức sản phẩm mà subadmin không có
	cases := []struct {
		n    string
		a    *actor.Actor
		id   string
		want string
	}{
		{"đích có sp_duyet", m1, "n2", msgSubTargetPerm},
		{"đích có da_duyet", m1, "n3", msgSubTargetPerm},
		{"đích mức sản phẩm rỗng, mình sp_edit", m1, "n4", msgSubTargetPerm},
		{"đích mức sản phẩm rỗng, mình cũng rỗng", m2, "n4", stopWrite},
		{"mình có sp_duyet + da_duyet", m3, "n2", stopWrite},
		{"mình có sp_duyet + da_duyet (đích da_duyet)", m3, "n3", stopWrite},
	}
	for _, c := range cases {
		if _, err := mk().s.AdminSetPasswordGated(ctx, c.a, c.id, "12345"); errStr(err) != c.want {
			t.Errorf("%s: lỗi %q, muốn %q", c.n, errStr(err), c.want)
		}
		if _, err := mk().s.AdminUpdateUserGated(ctx, c.a, c.id, omap.Of("hoTen", "z")); errStr(err) != c.want {
			t.Errorf("%s (sửa): lỗi %q, muốn %q", c.n, errStr(err), c.want)
		}
	}

	// cấp mới da_duyet khi mình không có
	if _, err := mk().s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("perms", perms("sp_edit", "da_duyet"))); errStr(err) != msgSubDaDuyet {
		t.Errorf("cấp da_duyet: %v", err)
	}
	if _, err := mk().s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234", "perms", perms("sp_edit", "da_duyet"))); errStr(err) != msgSubDaDuyet {
		t.Errorf("tạo kèm da_duyet: %v", err)
	}
	// mình ở mức sp_edit: nhân viên mới mức "" bị chặn, mức sp_edit được (và ghim người cấp)
	e = mk()
	if _, err := e.s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234", "perms", perms("boc"))); errStr(err) != msgSubSpLevel || len(e.r.inserts) != 0 {
		t.Errorf("tạo mức rỗng: %v %v", err, e.r.inserts)
	}
	if _, err := mk().s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234")); errStr(err) != msgSubSpLevel {
		t.Errorf("tạo không gửi perms: %v", err)
	}
	e = mk()
	out, err := e.s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234", "perms", perms("boc", "sp_edit")))
	if err != nil || out == nil || len(e.r.inserts) != 1 || e.r.inserts[0] != `{"role":"staff","perms":"boc,sp_edit","cong_ty_id":"c1"}` ||
		calls(e.g) != `check:m1 null ["boc","sp_edit"];pin:m1 new` {
		t.Errorf("tạo mức sp_edit: %v %v %q", err, e.r.inserts, calls(e.g))
	}
	// lỗi ghim người cấp trả nguyên
	e = mk()
	e.g.pinErr = errors.New("không ghim được")
	if _, err := e.s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234", "perms", perms("sp_edit"))); errStr(err) != "không ghim được" {
		t.Errorf("lỗi ghim: %v", err)
	}
	// tạo tài khoản admin / subadmin bị chặn trước khi ghi
	for _, role := range []string{"admin", "subadmin"} {
		e = mk()
		if _, err := e.s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234", "role", role, "perms", perms("sp_edit"))); errStr(err) != msgSubStaffOnly || len(e.r.inserts) != 0 {
			t.Errorf("tạo %s: %v %v", role, err, e.r.inserts)
		}
	}
	// subadmin có cờ duoc_duyet_sp vẫn không cấp được sp_duyet
	if _, err := mk().s.AdminCreateUserGated(ctx, m3, omap.Of("username", "nv9", "password", "1234", "perms", perms("sp_duyet"))); errStr(err) != msgGrantSpDuyet {
		t.Errorf("subadmin có cờ cấp sp_duyet: %v", err)
	}

	// ghim người cấp: chỉ subadmin, chỉ khi sửa perms tài khoản khác thành công
	e = mk()
	e.r.okWrite = true
	if _, err := e.s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("perms", perms("boc", "sp_edit"))); err != nil ||
		calls(e.g) != `within:m1 n1;check:m1 "sp_edit" ["boc","sp_edit"];pin:m1 n1` {
		t.Errorf("subadmin sửa perms: %v %q", err, calls(e.g))
	}
	e = mk()
	e.r.okWrite = true
	if _, err := e.s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("hoTen", "k")); err != nil || calls(e.g) != `within:m1 n1` {
		t.Errorf("subadmin sửa họ tên: %v %q", err, calls(e.g))
	}
	e = mk()
	if _, err := e.s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("perms", perms("boc", "sp_edit"))); errStr(err) != stopWrite || strings.Contains(calls(e.g), "pin:") {
		t.Errorf("ghi lỗi thì không ghim: %v %q", err, calls(e.g))
	}
	actx := tenant.With(context.Background(), tenant.Ctx{UID: "a1", Role: "admin", CongTyID: "c1"})
	e = mk()
	e.r.okWrite = true
	if _, err := e.s.AdminUpdateUserGated(actx, a1, "n1", omap.Of("perms", perms("boc"))); err != nil || calls(e.g) != `check:a1 "sp_edit" ["boc"]` {
		t.Errorf("admin sửa perms: %v %q", err, calls(e.g))
	}
	e = mk()
	if _, err := e.s.AdminCreateUserGated(actx, a1, omap.Of("username", "nv9", "password", "1234", "perms", perms("boc"))); err != nil || calls(e.g) != `check:a1 null ["boc"]` {
		t.Errorf("admin tạo: %v %q", err, calls(e.g))
	}

	// cắt quyền nhân viên do subadmin cấp khi subadmin bị xoá / hạ / nâng; giữ vai trò thì không
	freeze := []struct {
		n    string
		want string
		f    func(s *Service) error
	}{
		{"xoá subadmin", "freeze:m1", func(s *Service) error { _, err := s.AdminDeleteUserGated(actx, sup, "m1"); return err }},
		{"hạ subadmin", "freeze:m1", func(s *Service) error {
			_, err := s.AdminUpdateUserGated(actx, a1, "m1", omap.Of("role", "staff"))
			return err
		}},
		{"nâng subadmin", "freeze:m1", func(s *Service) error {
			_, err := s.AdminUpdateUserGated(actx, sup, "m1", omap.Of("role", "admin"))
			return err
		}},
		{"giữ vai trò subadmin", "", func(s *Service) error {
			_, err := s.AdminUpdateUserGated(actx, a1, "m1", omap.Of("role", "subadmin"))
			return err
		}},
		{"admin hạ admin (như cũ)", "freeze:a2", func(s *Service) error {
			_, err := s.AdminUpdateUserGated(actx, sup, "a2", omap.Of("role", "subadmin"))
			return err
		}},
	}
	for _, c := range freeze {
		e := mk()
		err := c.f(e.s)
		if calls(e.g) != c.want {
			t.Errorf("%s: gọi %q, muốn %q (lỗi %v)", c.n, calls(e.g), c.want, err)
		}
	}
}

// fakeHR: hạng vai trò HR theo id tài khoản (contracts.HRRoleReader); err: lỗi trả về.
type fakeHR struct {
	rank map[string]int
	err  error
}

func (f fakeHR) HRRoleRank(_ context.Context, userID any) (int, error) {
	return f.rank[jsval.ToString(userID)], f.err
}

// perms gửi dạng chuỗi (không phải mảng) bị lệnh lõi ghi "" (= sửa + duyệt): cửa ngõ kiểm đúng giá trị được lưu.
func TestSubAdminStringPerms(t *testing.T) {
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "m1", Role: "subadmin", CongTyID: "c1"})
	m1 := &actor.Actor{UID: "m1", U: "sub1", R: "subadmin", CT: "c1"}
	mk := func() (*Service, *subRepo) {
		r := newSubRepo()
		return &Service{repo: r, access: &fakeGranter{legacyOK: true}, companies: noCompanies{}}, r
	}
	for _, p := range []any{"sp_edit", "boc,sp_edit", 1.0, true} {
		s, r := mk()
		if _, err := s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("perms", p)); errStr(err) != msgSubSpLevel || len(r.patches) != 0 {
			t.Errorf("sửa perms %v: %v %v", p, err, r.patches)
		}
		s, r = mk()
		if _, err := s.AdminCreateUserGated(ctx, m1, omap.Of("username", "nv9", "password", "1234", "perms", p)); errStr(err) != msgSubSpLevel || len(r.inserts) != 0 {
			t.Errorf("tạo perms %v: %v %v", p, err, r.inserts)
		}
	}
	// mảng vẫn như cũ
	s, _ := mk()
	if _, err := s.AdminUpdateUserGated(ctx, m1, "n1", omap.Of("perms", []any{"sp_edit"})); errStr(err) != stopWrite {
		t.Errorf("sửa perms mảng: %v", err)
	}
}

// subadmin không quản lý tài khoản có vai trò HR cao hơn mình (đặt lại mật khẩu rồi đăng nhập thay = mở rộng phạm vi HR).
func TestSubAdminHRRole(t *testing.T) {
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "m2", Role: "subadmin", CongTyID: "c1"})
	m2 := &actor.Actor{UID: "m2", U: "sub2", R: "subadmin", CT: "c1"}
	cases := []struct {
		n    string
		hr   fakeHR
		want string
	}{
		{"đích hradmin, mình employee", fakeHR{rank: map[string]int{"m2": 1, "n4": 3}}, msgSubTargetHR},
		{"đích manager, mình chưa gắn hồ sơ", fakeHR{rank: map[string]int{"n4": 2}}, msgSubTargetHR},
		{"cùng hạng", fakeHR{rank: map[string]int{"m2": 2, "n4": 2}}, stopWrite},
		{"đích thấp hơn", fakeHR{rank: map[string]int{"m2": 3, "n4": 1}}, stopWrite},
		{"lỗi đọc HR", fakeHR{err: errors.New("lỗi HR")}, "lỗi HR"},
	}
	for _, c := range cases {
		ops := map[string]func(s *Service) error{
			"mật khẩu": func(s *Service) error { _, err := s.AdminSetPasswordGated(ctx, m2, "n4", "12345"); return err },
			"sửa": func(s *Service) error {
				_, err := s.AdminUpdateUserGated(ctx, m2, "n4", omap.Of("hoTen", "y"))
				return err
			},
			"xoá": func(s *Service) error { _, err := s.AdminDeleteUserGated(ctx, m2, "n4"); return err },
		}
		for n, f := range ops {
			r := newSubRepo()
			s := &Service{repo: r, access: &fakeGranter{legacyOK: true}, companies: noCompanies{}, hr: c.hr}
			if err := f(s); errStr(err) != c.want {
				t.Errorf("%s (%s): lỗi %q, muốn %q", c.n, n, errStr(err), c.want)
			}
		}
	}
	// admin công ty không bị kiểm vai trò HR
	actx := tenant.With(context.Background(), tenant.Ctx{UID: "a1", Role: "admin", CongTyID: "c1"})
	s := &Service{repo: newSubRepo(), hr: fakeHR{rank: map[string]int{"n4": 4}}}
	if _, err := s.AdminSetPasswordGated(actx, &actor.Actor{UID: "a1", R: "admin", CT: "c1"}, "n4", "12345"); errStr(err) != stopWrite {
		t.Errorf("admin: %v", err)
	}
}

// admin công ty bị hạ xuống subadmin: sau khi lưu, nhân viên do nó cấp chuyển người cấp (ReleaseGrantsBy); hạ về nhân viên /
// lưu lỗi thì không.
func TestDemoteAdminToSubAdminReleases(t *testing.T) {
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "s", Role: "super", CongTyID: "c1"})
	sup := &actor.Actor{UID: "s", U: "sa", R: "super"}
	cases := []struct {
		n       string
		id      string
		role    string
		okWrite bool
		want    string
	}{
		{"admin -> subadmin", "a2", "subadmin", true, "freeze:a2;release:s a2"},
		{"admin -> subadmin, lưu lỗi", "a2", "subadmin", false, "freeze:a2"},
		{"admin -> nhân viên", "a2", "staff", true, "freeze:a2"},
		{"subadmin giữ vai trò", "m1", "subadmin", true, ""},
		{"nhân viên -> subadmin", "n1", "subadmin", true, ""},
	}
	for _, c := range cases {
		r := newSubRepo()
		r.okWrite = c.okWrite
		g := &fakeGranter{legacyOK: true, freezeOK: true}
		s := &Service{repo: r, access: g, companies: noCompanies{}}
		_, err := s.AdminUpdateUserGated(ctx, sup, c.id, omap.Of("role", c.role))
		if got := strings.Join(g.calls, ";"); got != c.want {
			t.Errorf("%s: gọi %q, muốn %q (lỗi %v)", c.n, got, c.want, err)
		}
	}
}

func TestAdminListUsersGated(t *testing.T) {
	ctx := context.Background()
	r := newSubRepo()
	r.list = []*omap.Map{
		omap.Of("id", "a1", "username", "ad1", "role", "admin"),
		omap.Of("id", "m1", "username", "sub1", "role", "subadmin"),
		omap.Of("id", "m2", "username", "sub2", "role", "subadmin"),
		omap.Of("id", "n1", "username", "nv1", "role", "staff"),
		omap.Of("id", "n5", "username", "nv5"), // role trống = nhân viên
	}
	s := &Service{repo: r}
	ids := func(v []any) string {
		var out []string
		for _, x := range v {
			out = append(out, jsval.ToString(jsval.AsMap(x).Val("id")))
		}
		return strings.Join(out, ",")
	}
	got, err := s.AdminListUsersGated(ctx, &actor.Actor{UID: "m1", R: "subadmin", CT: "c1"})
	if err != nil || ids(got) != "m1,n1,n5" {
		t.Errorf("subadmin: %s %v", ids(got), err)
	}
	for _, a := range []*actor.Actor{{UID: "a1", R: "admin", CT: "c1"}, {UID: "s", R: "super"}} {
		got, err := s.AdminListUsersGated(ctx, a)
		want, _ := s.AdminListUsers(ctx, a)
		g, _ := omap.MarshalString(got)
		w, _ := omap.MarshalString(want)
		if err != nil || g != w || ids(got) != "a1,m1,m2,n1,n5" {
			t.Errorf("%s: %s, muốn %s (%v)", a.R, g, w, err)
		}
	}
}
