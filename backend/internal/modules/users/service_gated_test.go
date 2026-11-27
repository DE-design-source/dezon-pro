package users

import (
	"context"
	"errors"
	"testing"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

func TestAdminGate(t *testing.T) {
	sup := &actor.Actor{UID: "s", R: "super"}
	adm := &actor.Actor{UID: "a", R: "admin"}
	sub := &actor.Actor{UID: "m", R: "subadmin"}
	cases := []struct {
		n       string
		a       *actor.Actor
		cur     string
		newRole any
		self    bool
		want    string
	}{
		{"super tạo admin", sup, "", "admin", false, ""},
		{"super sửa admin khác", sup, "admin", "staff", false, ""},
		{"admin tạo nhân viên", adm, "", "staff", false, ""},
		{"admin tạo (không gửi vai trò)", adm, "", nil, false, ""},
		{"admin tạo admin", adm, "", "admin", false, msgAdminOnlySuper},
		{"admin sửa nhân viên", adm, "staff", "staff", false, ""},
		{"admin nâng nhân viên lên admin", adm, "staff", "admin", false, msgAdminOnlySuper},
		{"admin sửa admin khác", adm, "admin", nil, false, msgAdminOnlySuper},
		{"admin khoá admin khác", adm, "admin", nil, false, msgAdminOnlySuper},
		{"admin tự sửa mình (giữ vai trò)", adm, "admin", "admin", true, ""},
		{"admin tự sửa mình (không gửi vai trò)", adm, "admin", nil, true, ""},
		{"admin tự hạ mình xuống nhân viên", adm, "admin", "staff", true, msgSelfRole},
		// M14.7: subadmin chỉ quản lý nhân viên; admin quản lý được subadmin nhưng không nâng lên admin
		{"subadmin tạo nhân viên", sub, "", "staff", false, ""},
		{"subadmin tạo (không gửi vai trò)", sub, "", nil, false, ""},
		{"subadmin tạo admin", sub, "", "admin", false, msgSubStaffOnly},
		{"subadmin tạo subadmin", sub, "", "subadmin", false, msgSubStaffOnly},
		{"subadmin tạo super", sub, "", "super", false, msgSubStaffOnly},
		{"subadmin sửa nhân viên", sub, "staff", "staff", false, ""},
		{"subadmin sửa nhân viên (không gửi vai trò)", sub, "staff", nil, false, ""},
		{"subadmin sửa admin", sub, "admin", nil, false, msgSubStaffOnly},
		{"subadmin sửa subadmin khác", sub, "subadmin", nil, false, msgSubStaffOnly},
		{"subadmin nâng nhân viên lên subadmin", sub, "staff", "subadmin", false, msgSubStaffOnly},
		{"subadmin nâng nhân viên lên admin", sub, "staff", "admin", false, msgSubStaffOnly},
		{"subadmin tự sửa mình (giữ vai trò)", sub, "subadmin", "subadmin", true, ""},
		{"subadmin tự sửa mình (không gửi vai trò)", sub, "subadmin", nil, true, ""},
		{"subadmin tự hạ mình xuống nhân viên", sub, "subadmin", "staff", true, msgSelfRole},
		{"subadmin tự nâng mình lên admin", sub, "subadmin", "admin", true, msgSelfRole},
		{"admin tạo subadmin", adm, "", "subadmin", false, ""},
		{"admin sửa subadmin", adm, "subadmin", "subadmin", false, ""},
		{"admin sửa subadmin (không gửi vai trò)", adm, "subadmin", nil, false, ""},
		{"admin hạ subadmin xuống nhân viên", adm, "subadmin", "staff", false, ""},
		{"admin nâng nhân viên lên subadmin", adm, "staff", "subadmin", false, ""},
		{"admin nâng subadmin lên admin", adm, "subadmin", "admin", false, msgAdminOnlySuper},
	}
	for _, c := range cases {
		err := adminGate(c.a, c.cur, c.newRole, c.self)
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("%s: lỗi %q, muốn %q", c.n, got, c.want)
		}
	}
}

// approvalRepo: repository giả cho duyệt sản phẩm theo phân cấp (M14.6).
type approvalRepo struct {
	fakeRepo
	users   map[string]*omap.Map
	admins  []*omap.Map
	patches []string
}

func (r *approvalRepo) UserByID(_ context.Context, id any) (*omap.Map, error) {
	return r.users[jsval.ToString(id)], nil
}

func (r *approvalRepo) CompanyAdmins(context.Context) ([]*omap.Map, error) { return r.admins, nil }

func (r *approvalRepo) UpdateUser(_ context.Context, id any, patch *omap.Map) ([]*omap.Map, error) {
	js, _ := omap.MarshalString(patch)
	r.patches = append(r.patches, jsval.ToString(id)+" "+js)
	return nil, errors.New("dừng sau kiểm quyền")
}

func newApprovalRepo() *approvalRepo {
	return &approvalRepo{users: map[string]*omap.Map{
		"s":  omap.Of("id", "s", "role", "super"),
		"a1": omap.Of("id", "a1", "username", "ad1", "role", "admin", "cong_ty_id", "c1", "duoc_duyet_sp", true),
		"a2": omap.Of("id", "a2", "username", "ad2", "role", "admin", "cong_ty_id", "c1", "duoc_duyet_sp", false),
		"n1": omap.Of("id", "n1", "username", "nv1", "role", "staff", "cong_ty_id", "c1", "perms", "sp_edit"),
		"n2": omap.Of("id", "n2", "username", "nv2", "role", "staff", "cong_ty_id", "c1", "perms", "sp_edit,sp_duyet"),
	}}
}

func TestSpDuyetGate(t *testing.T) {
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "a2", Role: "admin", CongTyID: "c1"})
	r := newApprovalRepo()
	s := &Service{repo: r}
	sup := &actor.Actor{UID: "s", R: "super"}
	a1 := &actor.Actor{UID: "a1", R: "admin", CT: "c1"}
	a2 := &actor.Actor{UID: "a2", R: "admin", CT: "c1"}
	perms := func(p ...any) []any { return p }
	cases := []struct {
		n         string
		a         *actor.Actor
		cur, next any
		want      string
	}{
		{"super cấp", sup, "", perms("sp_duyet"), ""},
		{"admin được giao cấp", a1, "", perms("sp_duyet"), ""},
		{"admin chưa giao cấp mới", a2, "sp_edit", perms("sp_edit", " sp_duyet"), msgGrantSpDuyet},
		{"admin chưa giao giữ quyền đã cấp", a2, "sp_edit,sp_duyet", perms("sp_duyet", "sp_edit"), ""},
		{"admin chưa giao bỏ quyền", a2, "sp_duyet", perms("sp_edit"), ""},
		{"admin chưa giao cấp quyền khác", a2, "", perms("sp_edit"), ""},
		{"không gửi perms", a2, "", nil, ""},
	}
	for _, c := range cases {
		err := s.spDuyetGate(ctx, c.a, c.cur, c.next)
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("%s: lỗi %q, muốn %q", c.n, got, c.want)
		}
	}
	// qua cửa ngõ thật: tạo / sửa nhân viên kèm sp_duyet bị chặn trước khi ghi
	if _, err := s.AdminCreateUserGated(ctx, a2, omap.Of("username", "nv9", "password", "1234", "perms", perms("sp_duyet"))); err == nil || err.Error() != msgGrantSpDuyet {
		t.Errorf("tạo nhân viên có sp_duyet: %v", err)
	}
	if _, err := s.AdminUpdateUserGated(ctx, a2, "n1", omap.Of("perms", perms("sp_edit", "sp_duyet"))); err == nil || err.Error() != msgGrantSpDuyet {
		t.Errorf("sửa nhân viên thêm sp_duyet: %v", err)
	}
	if len(r.patches) != 0 {
		t.Errorf("đã ghi: %v", r.patches)
	}
	// giữ nguyên quyền đã cấp: qua cửa ngõ, tới bước ghi
	if _, err := s.AdminUpdateUserGated(ctx, a2, "n2", omap.Of("perms", perms("sp_edit", "sp_duyet"))); err == nil || err.Error() != "dừng sau kiểm quyền" {
		t.Errorf("giữ sp_duyet: %v", err)
	}
}

func TestSetProductApproval(t *testing.T) {
	ctx := context.Background()
	r := newApprovalRepo()
	r.admins = []*omap.Map{omap.Of("id", "a1", "duoc_duyet_sp", true), omap.Of("id", "a2", "duoc_duyet_sp", nil)}
	s := &Service{repo: r}
	sup := &actor.Actor{UID: "s", U: "sa", R: "super"}
	if _, err := s.SetProductApproval(ctx, &actor.Actor{UID: "a1", R: "admin"}, "a2", true); err == nil || err.Error() != msgSuperOnly {
		t.Errorf("admin giao: %v", err)
	}
	if _, err := s.SetProductApproval(ctx, sup, "n1", true); err == nil || err.Error() != msgApprovalAdminOnly {
		t.Errorf("giao cho nhân viên: %v", err)
	}
	if _, err := s.SetProductApproval(ctx, sup, "zz", true); err == nil || err.Error() != msgNotFound {
		t.Errorf("không có tài khoản: %v", err)
	}
	_, _ = s.SetProductApproval(ctx, sup, "a2", true)
	if len(r.patches) != 1 || r.patches[0] != `a2 {"duoc_duyet_sp":true}` {
		t.Errorf("ghi: %v", r.patches)
	}
	out, err := s.ProductApprovers(ctx)
	got, _ := omap.MarshalString(out)
	if err != nil || got != `[{"id":"a1","duocDuyetSp":true},{"id":"a2","duocDuyetSp":false}]` {
		t.Errorf("ProductApprovers = %s %v", got, err)
	}
}

// fakeGranter: ghi lại lệnh gọi phân quyền 3 cấp (N21), trả lỗi để dừng trước khi ghi.
// legacyOK: CheckLegacyPerms cho qua; withinErr / pinErr: lỗi trả của CheckUserWithin / PinGrantedBy (M14.7);
// freezeOK: FreezeGrantsBy cho qua (mặc định lỗi để dừng trước lệnh lõi).
type fakeGranter struct {
	calls             []string
	legacyOK          bool
	freezeOK          bool
	withinErr, pinErr error
}

func (g *fakeGranter) ReleaseGrantsBy(_ context.Context, a *actor.Actor, granterID any) error {
	g.calls = append(g.calls, "release:"+jsval.ToString(a.UID)+" "+jsval.ToString(granterID))
	return nil
}

func (g *fakeGranter) CheckLegacyPerms(_ context.Context, a *actor.Actor, cur, perms any) error {
	c, _ := omap.MarshalString(cur)
	p, _ := omap.MarshalString(perms)
	g.calls = append(g.calls, "check:"+jsval.ToString(a.UID)+" "+c+" "+p)
	if g.legacyOK {
		return nil
	}
	return errors.New("vượt quyền")
}

func (g *fakeGranter) FreezeGrantsBy(_ context.Context, adminID any) error {
	g.calls = append(g.calls, "freeze:"+jsval.ToString(adminID))
	if g.freezeOK {
		return nil
	}
	return errors.New("đã cắt")
}

func (g *fakeGranter) CheckUserWithin(_ context.Context, a *actor.Actor, targetID any) error {
	g.calls = append(g.calls, "within:"+jsval.ToString(a.UID)+" "+jsval.ToString(targetID))
	return g.withinErr
}

func (g *fakeGranter) PinGrantedBy(_ context.Context, a *actor.Actor, userID any) error {
	g.calls = append(g.calls, "pin:"+jsval.ToString(a.UID)+" "+jsval.ToString(userID))
	return g.pinErr
}

// N21: perms admin công ty cấp cho nhân viên qua AccessGranter (super / đích là admin thì không); xoá / hạ / chuyển công ty
// admin thì cắt quyền nhân viên do admin đó cấp TRƯỚC lệnh lõi.
func TestAccessGranterHooks(t *testing.T) {
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: "a1", Role: "admin", CongTyID: "c1"})
	sup := &actor.Actor{UID: "s", R: "super"}
	a1 := &actor.Actor{UID: "a1", R: "admin", CT: "c1"}
	perms := func(p ...any) []any { return p }
	run := func(name, want string, f func(s *Service) error) {
		t.Helper()
		g := &fakeGranter{}
		s := &Service{repo: newApprovalRepo(), access: g}
		err := f(s)
		got := ""
		for i, c := range g.calls {
			if i > 0 {
				got += ";"
			}
			got += c
		}
		if got != want {
			t.Errorf("%s: gọi %q, muốn %q (lỗi %v)", name, got, want, err)
		}
	}
	run("admin tạo nhân viên", `check:a1 null ["boc"]`, func(s *Service) error {
		_, err := s.AdminCreateUserGated(ctx, a1, omap.Of("username", "nv9", "password", "1234", "perms", perms("boc")))
		return err
	})
	run("admin sửa perms nhân viên", `check:a1 "sp_edit" ["boc"]`, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, a1, "n1", omap.Of("perms", perms("boc")))
		return err
	})
	run("admin tự sửa perms (admin)", ``, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, a1, "a1", omap.Of("perms", perms("boc"), "hoTen", "x"))
		return err
	})
	run("super cấp perms", ``, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, sup, "n1", omap.Of("perms", perms("boc")))
		return err
	})
	run("super hạ admin", `freeze:a2`, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, sup, "a2", omap.Of("role", "staff"))
		return err
	})
	run("super chuyển công ty admin", `freeze:a2`, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, sup, "a2", omap.Of("role", "admin", "congTyId", "c2"))
		return err
	})
	run("super sửa admin giữ vai trò", ``, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, sup, "a2", omap.Of("role", "admin", "congTyId", "c1"))
		return err
	})
	run("super xoá admin", `freeze:a2`, func(s *Service) error {
		_, err := s.AdminDeleteUserGated(ctx, sup, "a2")
		return err
	})
	run("super đổi vai trò nhân viên", ``, func(s *Service) error {
		_, err := s.AdminUpdateUserGated(ctx, sup, "n1", omap.Of("role", "staff"))
		return err
	})
}
