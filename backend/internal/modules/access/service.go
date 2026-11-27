// Package access: phân quyền 3 cấp (roadmap N21). Quản trị hệ thống (super) đặt TRẦN quyền cho từng công ty và từng
// quản trị công ty; quản trị công ty cấp cho nhân viên tập con quyền của chính mình. Quyền theo Module > Tab > Thao tác
// (danh mục: catalog.json). Quyền thực = giao các cấp, tính lúc đọc:
//
//	công ty  = dòng trần công ty (phan_quyen.tai_khoan_id null) hoặc, chưa có dòng, suy từ companies.features
//	admin    = công ty ∩ dòng của admin (chưa có dòng = mọi thứ trong trần công ty)
//	nhân viên = công ty ∩ dòng của nhân viên ∩ quyền thực của admin đã cấp (nguoi_cap là admin cùng công ty);
//	           chưa có dòng = công ty ∩ suy từ users.permissions
//	subadmin = như nhân viên (nhãn giao diện "Admin", M14.7)
//	super    = mọi thứ
//
// Người cấp là subadmin cùng công ty: dòng của nhân viên còn giao thêm quyền THỰC của subadmin (tính đệ quy, chống vòng,
// sâu quá maxGranterDepth hoặc gặp vòng = rỗng). Subadmin chỉ xem / phân quyền nhân viên công ty mình (đọc được cả chính
// mình), chỉ trong quyền thực của mình, không đặt null (theo mặc định cũ) và không chạm nhân viên có quyền vượt mình.
//
// Duyệt sản phẩm (M14.6: users.duoc_duyet_sp, quyền sp_duyet) và duyệt sửa dự án KHÔNG thuộc ma trận này.
// Chỉ bản Go: REST /api/v1/access/..., /companies/:id/access, /users/:id/access (không có hàm /api/:fn).
package access

import (
	"context"
	"strings"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/reqcache"
)

// Thông báo lỗi.
const (
	msgNoAuth       = "Chưa đăng nhập"
	msgNoCompany    = "Không tìm thấy công ty"
	msgNoUser       = "Không tìm thấy tài khoản"
	msgSuperTarget  = "Không phân quyền cho tài khoản quản trị hệ thống (luôn có mọi quyền)"
	msgUserNoCt     = "Tài khoản chưa gắn với công ty nào"
	msgOtherCompany = "Chỉ phân quyền được cho tài khoản trong công ty của bạn"
	msgAdminTarget  = "Chỉ quản trị hệ thống mới phân quyền được cho quản trị công ty"
	msgOnlyAdmins   = "Không có quyền phân quyền"
	msgExceed       = "Không cấp được quyền vượt quá quyền của bạn: "
	msgMig          = "Chưa có bảng phân quyền (migration 0052_access_grants). "
	msgNoGrants     = "Thiếu grants (gửi null để bỏ phân quyền riêng)"
)

// Thông báo lỗi của vai trò subadmin (nhãn "Admin", M14.7).
const (
	msgSubTarget    = "Admin chỉ phân quyền được cho tài khoản nhân viên khác trong công ty"
	msgSubNoDefault = "Admin phải chọn quyền cụ thể, không đặt được theo mặc định cũ"
	msgTargetExceed = "Tài khoản này có quyền vượt quá quyền của bạn: "
)

// maxGranterDepth: số cấp người cấp là subadmin tối đa khi tính quyền thực (sâu hơn = rỗng).
const maxGranterDepth = 3

// Deps: do internal/server/routes.go truyền vào. Repo chỉ dùng trong test (bỏ trống = Postgres).
type Deps struct {
	DB   *database.DB
	Cfg  *config.Config
	Repo Repository
}

// Service: nghiệp vụ phân quyền 3 cấp; cài contracts.AccessChecker.
type Service struct {
	repo Repository
	now  func() string
}

var (
	_ contracts.AccessChecker = (*Service)(nil)
	_ contracts.AccessGranter = (*Service)(nil)
)

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = NewRepository(d.DB)
	}
	return &Service{repo: repo, now: jsval.NowISO}
}

// ---------- tính quyền thực ----------

func roleOf(u *omap.Map) string {
	if r := jsval.Str(u.Val("role")); r != "" {
		return r
	}
	return "staff"
}

// companyCeiling: trần công ty (+ dòng thô, nil = chưa có dòng). Công ty không có -> nil, nil, nil.
func (s *Service) companyCeiling(ctx context.Context, ctID string) (Set, *omap.Map, error) {
	ct, err := s.repo.CompanyByID(ctx, ctID)
	if err != nil || ct == nil {
		return nil, nil, err
	}
	row, err := s.repo.GrantRow(ctx, ctID, "")
	if err != nil {
		return nil, nil, err
	}
	if row != nil {
		return expand(row.Val("quyen")), row, nil
	}
	return legacyCompany(ct.Val("tinh_nang")), nil, nil
}

// userEffective: quyền thực của tài khoản u (dòng users {id, role, perms, cong_ty_id}) + dòng phan_quyen thô của nó.
func (s *Service) userEffective(ctx context.Context, u *omap.Map) (Set, *omap.Map, error) {
	st, err := s.userState(ctx, u)
	return st.eff, st.row, err
}

// state: quyền thực + dòng riêng (nil = chưa có) + legacy (chưa phân quyền: không có dòng riêng lẫn dòng trần công ty).
type state struct {
	eff    Set
	row    *omap.Map
	legacy bool
}

func (s *Service) userState(ctx context.Context, u *omap.Map) (state, error) {
	return s.userStateD(ctx, u, nil)
}

// userStateD: userState với seen = các tài khoản đang tính dở trên chuỗi người cấp (chống vòng khi người cấp là subadmin).
func (s *Service) userStateD(ctx context.Context, u *omap.Map, seen map[string]bool) (state, error) {
	role := roleOf(u)
	if role == "super" {
		return state{eff: fullSet()}, nil
	}
	ctID := jsval.Str(u.Val("cong_ty_id"))
	if ctID == "" {
		return state{eff: Set{}}, nil
	}
	ceil, ceilRow, err := s.companyCeiling(ctx, ctID)
	if err != nil || ceil == nil {
		return state{eff: Set{}}, err
	}
	uid := jsval.Str(u.Val("id"))
	row, err := s.repo.GrantRow(ctx, ctID, uid)
	if err != nil {
		return state{}, err
	}
	legacy := row == nil && ceilRow == nil
	if role == "admin" {
		if row == nil {
			return state{eff: ceil, legacy: legacy}, nil
		}
		return state{eff: intersect(ceil, expand(row.Val("quyen"))), row: row}, nil
	}
	if row == nil {
		return state{eff: intersect(ceil, legacyStaff(u.Val("perms"))), legacy: legacy}, nil
	}
	eff := intersect(ceil, expand(row.Val("quyen")))
	// admin đã cấp bị thu bớt quyền -> nhân viên mất theo; người cấp là super / không còn là admin cùng công ty -> chỉ trần công ty
	// (admin bị xoá / hạ vai trò / chuyển công ty: FreezeGrantsBy đã cắt sẵn dòng của nhân viên theo quyền cuối của admin;
	// hạ xuống subadmin: ReleaseGrantsBy chuyển người cấp sang người hạ, không bị cắt tiếp theo quyền subadmin)
	if by := jsval.Str(row.Val("nguoi_cap")); by != "" && by != uid {
		g, err := s.repo.UserByID(ctx, by)
		if err != nil {
			return state{}, err
		}
		if g != nil && roleOf(g) == "admin" && jsval.Str(g.Val("cong_ty_id")) == ctID {
			gRow, err := s.repo.GrantRow(ctx, ctID, by)
			if err != nil {
				return state{}, err
			}
			if gRow != nil {
				eff = intersect(eff, expand(gRow.Val("quyen")))
			}
		} else if g != nil && roleOf(g) == actor.RoleSubAdmin && jsval.Str(g.Val("cong_ty_id")) == ctID {
			// người cấp là subadmin: giao quyền THỰC của subadmin (kể cả khi nó chưa có dòng riêng); vòng / quá sâu = rỗng
			if seen[by] || len(seen) >= maxGranterDepth {
				eff = Set{}
			} else {
				next := make(map[string]bool, len(seen)+1)
				for k := range seen {
					next[k] = true
				}
				next[uid] = true
				gSt, err := s.userStateD(ctx, g, next)
				if err != nil {
					return state{}, err
				}
				eff = intersect(eff, gSt.eff)
			}
		}
	}
	return state{eff: eff, row: row}, nil
}

// cacheKey: khoá bộ đệm theo request (reqcache) của quyền thực người đăng nhập.
const cacheKey = "access.eff:"

// actorState: quyền thực của người đăng nhập (super: mọi thứ, không đọc database). Tính 1 lần mỗi request khi context có
// bộ đệm (middleware.RequestContext); lần ghi phân quyền trong request bỏ bộ đệm (save).
func (s *Service) actorState(ctx context.Context, a *actor.Actor) (state, error) {
	if a.IsSuper() {
		return state{eff: fullSet()}, nil
	}
	uid := jsval.Str(a.UID)
	if uid == "" {
		return state{eff: Set{}}, nil
	}
	if v, ok := reqcache.Get(ctx, cacheKey+uid); ok {
		return v.(state), nil
	}
	u, err := s.repo.UserByID(ctx, uid)
	if err != nil || u == nil {
		return state{eff: Set{}}, err
	}
	st, err := s.userState(ctx, u)
	if err != nil {
		return state{}, err
	}
	reqcache.Set(ctx, cacheKey+uid, st)
	return st, nil
}

// actorEffective: quyền thực của người đang đăng nhập.
func (s *Service) actorEffective(ctx context.Context, a *actor.Actor) (Set, error) {
	st, err := s.actorState(ctx, a)
	return st.eff, err
}

// Can: người đăng nhập có thao tác action ở module / tab không (contracts.AccessChecker). Super luôn true.
// tab "" hoặc "*" = ở ít nhất 1 tab của module. action "" = view.
func (s *Service) Can(ctx context.Context, a *actor.Actor, module, tab, action string) (bool, error) {
	if a == nil {
		return false, nil
	}
	if a.IsSuper() {
		return true, nil
	}
	if action == "" {
		action = "view"
	}
	bit := actionBit[action]
	if bit == 0 || modIdx[module] == nil {
		return false, nil
	}
	eff, err := s.actorEffective(ctx, a)
	if err != nil {
		return false, err
	}
	if tab == "" || tab == TabAll {
		return eff.any(module, bit), nil
	}
	return eff.get(module, tab)&bit != 0, nil
}

// LegacyAny: tài khoản chưa phân quyền theo N21 (không có dòng riêng, công ty không có dòng trần) và xem được ít nhất 1 tab
// của module -> true (contracts.AccessChecker). Cổng ghi của QS dùng để giữ cách cũ (đăng nhập + vào được QS là ghi được).
// Super / a nil -> false.
func (s *Service) LegacyAny(ctx context.Context, a *actor.Actor, module string) (bool, error) {
	if a == nil || a.IsSuper() || modIdx[module] == nil {
		return false, nil
	}
	st, err := s.actorState(ctx, a)
	if err != nil {
		return false, err
	}
	return st.legacy && st.eff.any(module, actionBit["view"]), nil
}

// ---------- route ----------

// CatalogOut: danh mục quyền {actions: [{key, label}], modules: [{key, label, tabs: [{key, label, actions}]}]}.
func (s *Service) CatalogOut() *omap.Map { return catOut }

// Me: {grants: quyền thực, grantable: quyền được phép cấp cho người khác (super: mọi thứ; admin, subadmin: quyền thực của
// mình; nhân viên: {})}.
func (s *Service) Me(ctx context.Context, a *actor.Actor) (*omap.Map, error) {
	if a == nil {
		return nil, apperr.E(401, msgNoAuth, "NOAUTH")
	}
	eff, err := s.actorEffective(ctx, a)
	if err != nil {
		return nil, err
	}
	grantable := omap.New()
	if a.CanManageStaff() {
		grantable = eff.Out()
	}
	return omap.Of("grants", eff.Out(), "grantable", grantable), nil
}

func rawOrNil(row *omap.Map) any {
	if row == nil {
		return nil
	}
	if g, ok := row.Val("quyen").(*omap.Map); ok {
		return g
	}
	return omap.New()
}

// CompanyAccess: trần quyền của công ty -> {grants: dòng đã lưu | null (chưa đặt = theo tính năng công ty), effective}.
// Chỉ super (gắn ở route).
func (s *Service) CompanyAccess(ctx context.Context, id string) (*omap.Map, error) {
	ceil, row, err := s.companyCeiling(ctx, id)
	if err != nil {
		return nil, err
	}
	if ceil == nil {
		return nil, apperr.NotFound(msgNoCompany)
	}
	return omap.Of("grants", rawOrNil(row), "effective", ceil.Out()), nil
}

// SetCompanyAccess: đặt trần quyền của công ty; grants null / thiếu = xoá (về theo tính năng công ty). Chỉ super.
func (s *Service) SetCompanyAccess(ctx context.Context, a *actor.Actor, id string, grants any) (*omap.Map, error) {
	if !a.IsSuper() {
		return nil, apperr.Forbidden(msgOnlyAdmins)
	}
	ct, err := s.repo.CompanyByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if ct == nil {
		return nil, apperr.NotFound(msgNoCompany)
	}
	if err := s.save(ctx, a, id, "", grants); err != nil {
		return nil, err
	}
	return s.CompanyAccess(ctx, id)
}

// UserAccess: quyền của 1 tài khoản -> {grants: dòng đã lưu | null (chưa đặt = cách cũ), effective}.
// super: mọi tài khoản; admin: tài khoản cùng công ty; subadmin: nhân viên cùng công ty và chính mình.
func (s *Service) UserAccess(ctx context.Context, a *actor.Actor, id string) (*omap.Map, error) {
	u, err := s.targetUser(ctx, a, id, false)
	if err != nil {
		return nil, err
	}
	eff, row, err := s.userEffective(ctx, u)
	if err != nil {
		return nil, err
	}
	return omap.Of("grants", rawOrNil(row), "effective", eff.Out()), nil
}

// SetUserAccess: đặt quyền của 1 tài khoản; grants null / thiếu = xoá (về cách cũ).
// super: đặt cho admin và nhân viên; admin: chỉ nhân viên (kể cả subadmin) cùng công ty, chỉ tập con quyền thực của mình;
// subadmin: chỉ nhân viên KHÁC cùng công ty, quyền hiện tại của nhân viên không vượt mình, grants phải cụ thể (không null),
// chỉ tập con quyền thực của mình; không ai đặt cho tài khoản super.
func (s *Service) SetUserAccess(ctx context.Context, a *actor.Actor, id string, grants any) (*omap.Map, error) {
	u, err := s.targetUser(ctx, a, id, true)
	if err != nil {
		return nil, err
	}
	role := roleOf(u)
	if role == "super" {
		return nil, apperr.BadRequest(msgSuperTarget)
	}
	ctID := jsval.Str(u.Val("cong_ty_id"))
	if ctID == "" {
		return nil, apperr.BadRequest(msgUserNoCt)
	}
	if !a.IsSuper() {
		if role == "admin" {
			return nil, apperr.Forbidden(msgAdminTarget)
		}
		if a.IsSubAdmin() {
			// null = về users.perms: perms cũ không bị người cấp giới hạn -> subadmin không được đặt
			if jsval.IsNullish(grants) {
				return nil, apperr.Forbidden(msgSubNoDefault)
			}
			if err := s.CheckUserWithin(ctx, a, u.Val("id")); err != nil {
				return nil, err
			}
		}
		var want Set
		if jsval.IsNullish(grants) {
			// bỏ phân quyền riêng = về users.perms: quyền suy ra từ perms cũng không được vượt quyền của admin
			ceil, _, err := s.companyCeiling(ctx, ctID)
			if err != nil {
				return nil, err
			}
			want = intersect(ceil, legacyStaff(u.Val("perms")))
		} else {
			g, err := parseGrants(grants)
			if err != nil {
				return nil, err
			}
			want = expand(g)
		}
		if err := s.within(ctx, a, want); err != nil {
			return nil, err
		}
	}
	if err := s.save(ctx, a, ctID, jsval.Str(u.Val("id")), grants); err != nil {
		return nil, err
	}
	return s.UserAccess(ctx, a, id)
}

// within: want phải là tập con quyền thực của a, không thì 403 nêu ô đầu tiên vượt quyền.
func (s *Service) within(ctx context.Context, a *actor.Actor, want Set) error {
	have, err := s.actorEffective(ctx, a)
	if err != nil {
		return err
	}
	if m, t, act, bad := firstOutside(want, have); bad {
		return apperr.Forbidden(msgExceed + modIdx[m].Label + " > " + tabLabel(modIdx[m], t) + " > " + actionLabel(act))
	}
	return nil
}

// CheckLegacyPerms (contracts.AccessGranter): admin / subadmin công ty (a không phải super) cấp users.perms cho nhân viên công ty mình -
// phần quyền perms cấp THÊM so với cur (nil khi tạo mới), giao trần công ty, phải nằm trong quyền thực của a; không thì 403.
// perms / cur: mảng của client hoặc chuỗi "a,b" của database. a nil / super -> nil.
func (s *Service) CheckLegacyPerms(ctx context.Context, a *actor.Actor, cur, perms any) error {
	if a == nil || a.IsSuper() {
		return nil
	}
	ctID := jsval.Str(a.CT)
	if ctID == "" {
		return apperr.Forbidden(msgOnlyAdmins)
	}
	ceil, _, err := s.companyCeiling(ctx, ctID)
	if err != nil {
		return err
	}
	want := minus(intersect(ceil, legacyStaff(permsStr(perms))), legacyStaff(permsStr(cur)))
	return s.within(ctx, a, want)
}

// permsStr: mảng khoá quyền của client -> chuỗi "a,b" như cột users.perms.
func permsStr(v any) any {
	arr, ok := v.([]any)
	if !ok {
		return v
	}
	parts := make([]string, 0, len(arr))
	for _, x := range arr {
		parts = append(parts, jsval.ToString(x))
	}
	return strings.Join(parts, ",")
}

// FreezeGrantsBy (contracts.AccessGranter): gọi TRƯỚC khi tài khoản admin công ty adminID bị xoá / đổi vai trò / chuyển
// công ty. Quyền thực của nhân viên do admin này cấp đang bị giới hạn thêm bởi quyền của admin (đọc lúc tính); sau thao tác
// đó giới hạn này mất (granted_by thành null hoặc không còn là admin cùng công ty) -> cắt sẵn dòng của nhân viên theo quyền
// thực cuối của admin. Quyền thực của nhân viên không đổi (giao đã có sẵn). Subadmin (người cấp có giới hạn như admin) cũng
// vậy. Không phải admin / subadmin, chưa gắn công ty -> nil.
func (s *Service) FreezeGrantsBy(ctx context.Context, adminID any) error {
	uid := jsval.Str(adminID)
	if uid == "" {
		return nil
	}
	u, err := s.repo.UserByID(ctx, uid)
	if err != nil || u == nil {
		return err
	}
	if r := roleOf(u); r != "admin" && r != actor.RoleSubAdmin {
		return nil
	}
	ctID := jsval.Str(u.Val("cong_ty_id"))
	if ctID == "" {
		return nil
	}
	limit, _, err := s.userEffective(ctx, u)
	if err != nil {
		return err
	}
	rows, err := s.repo.GrantsBy(ctx, ctID, uid)
	if err != nil {
		return err
	}
	for _, r := range rows {
		tid := jsval.Str(r.Val("tai_khoan_id"))
		if tid == "" || tid == uid {
			continue
		}
		cur := expand(r.Val("quyen"))
		clipped := intersect(cur, limit)
		if _, _, _, extra := firstOutside(cur, clipped); !extra {
			continue
		}
		if err := s.repo.SaveGrant(ctx, ctID, tid, omap.Of("quyen", clipped.Out(), "cap_nhat", s.now())); err != nil {
			return migErr(err)
		}
	}
	reqcache.Forget(ctx, cacheKey)
	return nil
}

// ReleaseGrantsBy (contracts.AccessGranter, M14.7): gọi SAU khi tài khoản admin công ty granterID đã bị hạ xuống subadmin.
// Nhân viên do nó cấp đã được FreezeGrantsBy cắt theo quyền admin cuối; nếu vẫn ghi người cấp = nó thì từ nay bị giới hạn thêm
// theo quyền subadmin (thường nhỏ hơn, vd perms cũ rỗng) -> chuyển người cấp sang a để quyền thực của họ không đổi.
// a nil / tài khoản không phải subadmin / chưa gắn công ty -> nil.
func (s *Service) ReleaseGrantsBy(ctx context.Context, a *actor.Actor, granterID any) error {
	uid := jsval.Str(granterID)
	if a == nil || uid == "" {
		return nil
	}
	u, err := s.repo.UserByID(ctx, uid)
	if err != nil || u == nil {
		return err
	}
	if roleOf(u) != actor.RoleSubAdmin {
		return nil
	}
	ctID := jsval.Str(u.Val("cong_ty_id"))
	if ctID == "" {
		return nil
	}
	rows, err := s.repo.GrantsBy(ctx, ctID, uid)
	if err != nil {
		return err
	}
	var by any
	if v := jsval.Str(a.UID); v != "" && v != uid {
		by = v
	}
	for _, r := range rows {
		tid := jsval.Str(r.Val("tai_khoan_id"))
		if tid == "" || tid == uid {
			continue
		}
		if err := s.repo.SaveGrant(ctx, ctID, tid, omap.Of("nguoi_cap", by, "nguoi_sua", a.U, "cap_nhat", s.now())); err != nil {
			return migErr(err)
		}
	}
	reqcache.Forget(ctx, cacheKey)
	return nil
}

// targetUser: tài khoản được xem (write false) / phân quyền (write true), kiểm người thao tác được chạm tới nó.
// Subadmin: xem nhân viên cùng công ty và chính mình; phân quyền nhân viên khác cùng công ty (admin để SetUserAccess báo
// msgAdminTarget).
func (s *Service) targetUser(ctx context.Context, a *actor.Actor, id string, write bool) (*omap.Map, error) {
	if a == nil {
		return nil, apperr.E(401, msgNoAuth, "NOAUTH")
	}
	if !a.CanManageStaff() {
		return nil, apperr.Forbidden(msgOnlyAdmins)
	}
	if id == "" {
		return nil, apperr.NotFound(msgNoUser)
	}
	u, err := s.repo.UserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, apperr.NotFound(msgNoUser)
	}
	if !a.IsSuper() {
		own := jsval.Str(a.CT)
		if own == "" || jsval.Str(u.Val("cong_ty_id")) != own {
			return nil, apperr.Forbidden(msgOtherCompany)
		}
	}
	if a.IsSubAdmin() {
		self := jsval.Str(u.Val("id")) == jsval.Str(a.UID)
		role := roleOf(u)
		if write && (self || (role != "staff" && role != "admin")) {
			return nil, apperr.Forbidden(msgSubTarget)
		}
		if !write && !self && role != "staff" {
			return nil, apperr.Forbidden(msgSubTarget)
		}
	}
	return u, nil
}

// CheckUserWithin (contracts.AccessGranter): a là subadmin -> quyền thực hiện tại của tài khoản targetID phải nằm trong quyền
// thực của a, không thì 403 nêu ô đầu tiên vượt (msgTargetExceed). a nil / không phải subadmin -> nil.
func (s *Service) CheckUserWithin(ctx context.Context, a *actor.Actor, targetID any) error {
	if a == nil || !a.IsSubAdmin() {
		return nil
	}
	uid := jsval.Str(targetID)
	if uid == "" {
		return apperr.NotFound(msgNoUser)
	}
	u, err := s.repo.UserByID(ctx, uid)
	if err != nil {
		return err
	}
	if u == nil {
		return apperr.NotFound(msgNoUser)
	}
	eff, _, err := s.userEffective(ctx, u)
	if err != nil {
		return err
	}
	have, err := s.actorEffective(ctx, a)
	if err != nil {
		return err
	}
	if m, t, act, bad := firstOutside(eff, have); bad {
		return apperr.Forbidden(msgTargetExceed + modIdx[m].Label + " > " + tabLabel(modIdx[m], t) + " > " + actionLabel(act))
	}
	return nil
}

// PinGrantedBy (contracts.AccessGranter): a là subadmin vừa tạo / sửa perms nhân viên userID cùng công ty mà nhân viên chưa có
// dòng phân quyền riêng -> ghi dòng = trần công ty ∩ suy từ users.perms ∩ quyền thực của a, người cấp = a (để sau này vẫn bị
// giới hạn theo a). Đã có dòng / a nil / không phải subadmin / tài khoản không phải nhân viên khác -> nil.
func (s *Service) PinGrantedBy(ctx context.Context, a *actor.Actor, userID any) error {
	if a == nil || !a.IsSubAdmin() {
		return nil
	}
	uid := jsval.Str(userID)
	if uid == "" || uid == jsval.Str(a.UID) {
		return nil
	}
	u, err := s.repo.UserByID(ctx, uid)
	if err != nil {
		return err
	}
	if u == nil {
		return apperr.NotFound(msgNoUser)
	}
	if roleOf(u) != "staff" {
		return nil
	}
	ctID := jsval.Str(u.Val("cong_ty_id"))
	if ctID == "" || ctID != jsval.Str(a.CT) {
		return apperr.Forbidden(msgOtherCompany)
	}
	row, err := s.repo.GrantRow(ctx, ctID, uid)
	if err != nil {
		return migErr(err)
	}
	if row != nil {
		return nil
	}
	ceil, _, err := s.companyCeiling(ctx, ctID)
	if err != nil || ceil == nil {
		return err
	}
	have, err := s.actorEffective(ctx, a)
	if err != nil {
		return err
	}
	return s.save(ctx, a, ctID, uid, intersect(ceil, legacyStaff(u.Val("perms")), have).Out())
}

// save: chuẩn hoá + ghi (grants null / thiếu = xoá dòng).
func (s *Service) save(ctx context.Context, a *actor.Actor, ctID, uid string, grants any) error {
	if jsval.IsNullish(grants) {
		reqcache.Forget(ctx, cacheKey)
		return migErr(s.repo.DeleteGrant(ctx, ctID, uid))
	}
	g, err := parseGrants(grants)
	if err != nil {
		return err
	}
	var by any
	if v := jsval.Str(a.UID); v != "" {
		by = v
	}
	row := omap.Of("quyen", g, "nguoi_cap", by, "nguoi_sua", a.U, "cap_nhat", s.now())
	reqcache.Forget(ctx, cacheKey)
	return migErr(s.repo.SaveGrant(ctx, ctID, uid, row))
}

// migErr: chưa chạy migration 0052 -> báo đúng nguyên nhân; lỗi khác trả nguyên.
func migErr(err error) error {
	if err != nil && thieuBang(err) {
		return apperr.New(msgMig + apperr.HDMig)
	}
	return err
}
