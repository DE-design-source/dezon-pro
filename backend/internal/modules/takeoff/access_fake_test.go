package takeoff

import (
	"context"

	"qspro-backend/internal/modules/access"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// legacyAccess: phân quyền 3 cấp thật (module access) trên kho giả: vai trò + công ty lấy từ actor, perms / tính năng công ty
// cho trước; grant != nil = dòng phân quyền riêng của tài khoản (không có = cách cũ).
type legacyAccess struct {
	perms, tinhNang string
	grant           *omap.Map
}

func (l legacyAccess) svc(a *actor.Actor) (*access.Service, *actor.Actor) {
	if a != nil && !jsval.Truthy(a.UID) { // actor của test DB không có UID
		b := *a
		b.UID = "test-uid"
		a = &b
	}
	r := legacyRepo{perms: l.perms, tinhNang: l.tinhNang, grant: l.grant}
	if a != nil {
		r.role, r.ct = a.R, jsval.Str(a.CT)
	}
	return access.New(access.Deps{Repo: r}), a
}

func (l legacyAccess) Can(ctx context.Context, a *actor.Actor, module, tab, action string) (bool, error) {
	s, a := l.svc(a)
	return s.Can(ctx, a, module, tab, action)
}

func (l legacyAccess) LegacyAny(ctx context.Context, a *actor.Actor, module string) (bool, error) {
	s, a := l.svc(a)
	return s.LegacyAny(ctx, a, module)
}

type legacyRepo struct {
	role, perms, ct, tinhNang string
	grant                     *omap.Map
}

func (r legacyRepo) UserByID(ctx context.Context, id string) (*omap.Map, error) {
	return omap.Of("id", id, "username", "an", "role", r.role, "perms", r.perms, "cong_ty_id", r.ct), nil
}
func (r legacyRepo) CompanyByID(ctx context.Context, id string) (*omap.Map, error) {
	return omap.Of("id", id, "tinh_nang", r.tinhNang), nil
}
func (r legacyRepo) GrantRow(ctx context.Context, congTyID, uid string) (*omap.Map, error) {
	if uid == "" || r.grant == nil {
		return nil, nil
	}
	return omap.Of("quyen", r.grant, "nguoi_cap", nil), nil
}
func (legacyRepo) SaveGrant(ctx context.Context, congTyID, uid string, row *omap.Map) error {
	return nil
}
func (legacyRepo) GrantsBy(ctx context.Context, congTyID, by string) ([]*omap.Map, error) {
	return nil, nil
}
func (legacyRepo) DeleteGrant(ctx context.Context, congTyID, uid string) error { return nil }
