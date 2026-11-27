package users

import (
	"context"

	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Cửa ngõ kiểm quyền (chỉ bản Go, 2026-11-20) cho 5 hàm quản lý tài khoản: tài khoản quản trị công ty (role admin) chỉ
// quản trị hệ thống (super) tạo / sửa / đặt mật khẩu / khoá / xoá; admin công ty chỉ quản lý nhân viên của công ty mình
// và vẫn tự sửa / đặt mật khẩu cho chính mình (không tự đổi vai trò). Hàm lõi Admin* giữ nguyên như bản Node (TestDiffNode);
// cổng rpc / REST gọi bản Gated.
// Vai trò subadmin (nhãn "Admin", M14.7; chỉ qua REST /api/v1, hàm /api/admin* vẫn chỉ admin): chỉ tạo / sửa / đặt mật khẩu /
// khoá / xoá tài khoản nhân viên (staff) cùng công ty mà toàn bộ quyền của đích nằm trong quyền của mình (subTargetGate);
// quyền cấp thêm không vượt quyền của mình (permsGate, subPermsGate); tự sửa mình thì không đổi vai trò, không đổi perms.
// Tài khoản subadmin tạo / sửa perms được ghim người cấp = subadmin (AccessGranter.PinGrantedBy).

// adminGate: lỗi nếu actor (không phải super) đụng tới tài khoản admin khác mình, nâng ai lên admin, hoặc tự đổi vai trò.
// curRole = vai trò hiện tại của tài khoản đích ("" = tạo mới); newRole = vai trò gửi lên (nil = không đổi); self = đích là chính mình.
// subadmin: chỉ đích là nhân viên (hoặc tạo mới) và vai trò mới là nhân viên; tự sửa mình thì giữ subadmin.
func adminGate(a *actor.Actor, curRole string, newRole any, self bool) error {
	if a == nil || a.R == "super" {
		return nil
	}
	if a.IsSubAdmin() {
		if self {
			if newRole == nil || jsval.StrictEquals(newRole, actor.RoleSubAdmin) {
				return nil
			}
			return apperr.New(msgSelfRole)
		}
		if (curRole != "" && curRole != "staff") || (newRole != nil && !jsval.StrictEquals(newRole, "staff")) {
			return apperr.New(msgSubStaffOnly)
		}
		return nil
	}
	if curRole == "admin" && !self {
		return apperr.New(msgAdminOnlySuper)
	}
	if newRole == nil {
		return nil
	}
	if jsval.StrictEquals(newRole, "admin") && curRole != "admin" {
		return apperr.New(msgAdminOnlySuper)
	}
	if curRole == "admin" && !jsval.StrictEquals(newRole, "admin") {
		return apperr.New(msgSelfRole)
	}
	return nil
}

// gateTarget: đọc tài khoản đích (như targetUser) rồi kiểm adminGate.
func (s *Service) gateTarget(ctx context.Context, a *actor.Actor, id any, newRole any) error {
	if a == nil || a.R == "super" {
		return nil
	}
	u, err := s.targetUser(ctx, a, id)
	if err != nil {
		return err
	}
	self := jsval.ToString(u.Val("id")) == jsval.ToString(a.UID)
	if err := adminGate(a, jsval.StrOr(u.Val("role"), ""), newRole, self); err != nil {
		return err
	}
	return s.subTargetGate(ctx, a, u)
}

// Quyền ngoài ma trận N21 mà subadmin phải có thì mới quản lý / cấp được (M14.7).
const (
	permSpEdit  = "sp_edit"
	permDaDuyet = "da_duyet"
)

// spLevel: mức quyền sản phẩm của perms - "sp_duyet" (sửa + duyệt), "sp_edit" (sửa chờ duyệt) hoặc "" (chưa cấu hình:
// materials.SpPerms coi như sửa + duyệt).
func (s *Service) spLevel(perms any) string {
	switch {
	case s.coPerm(perms, permSpDuyet):
		return permSpDuyet
	case s.coPerm(perms, permSpEdit):
		return permSpEdit
	}
	return ""
}

// myPerms: users.perms của chính actor (không tìm thấy -> lỗi msgNotFound).
func (s *Service) myPerms(ctx context.Context, a *actor.Actor) (any, error) {
	me, err := s.GetByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	if me == nil {
		return nil, apperr.New(msgNotFound)
	}
	return me.Val("perms"), nil
}

// subTargetGate (M14.7): subadmin quản lý tài khoản KHÁC u - quyền thực N21 của u phải nằm trong quyền của subadmin
// (AccessGranter.CheckUserWithin), và u không giữ sp_duyet / da_duyet / mức sản phẩm "" mà subadmin không có
// và vai trò HR cao hơn của subadmin (contracts.HRRoleReader) (không thì đặt lại mật khẩu rồi đăng nhập thay u là vượt quyền).
// Không phải subadmin / đích là chính mình -> nil.
func (s *Service) subTargetGate(ctx context.Context, a *actor.Actor, u *omap.Map) error {
	if !a.IsSubAdmin() || u == nil || jsval.ToString(u.Val("id")) == jsval.ToString(a.UID) {
		return nil
	}
	if s.access != nil {
		if err := s.access.CheckUserWithin(ctx, a, u.Val("id")); err != nil {
			return err
		}
	}
	mine, err := s.myPerms(ctx, a)
	if err != nil {
		return err
	}
	theirs := u.Val("perms")
	if (s.coPerm(theirs, permSpDuyet) && !s.coPerm(mine, permSpDuyet)) ||
		(s.coPerm(theirs, permDaDuyet) && !s.coPerm(mine, permDaDuyet)) ||
		(s.spLevel(theirs) == "" && s.spLevel(mine) == permSpEdit) {
		return apperr.New(msgSubTargetPerm)
	}
	// vai trò HR (hr_nhan_vien.vai_tro_hr, ngoài N21) của đích cao hơn của mình -> đăng nhập thay đích là mở rộng phạm vi HR
	if s.hr != nil {
		theirRank, err := s.hr.HRRoleRank(ctx, u.Val("id"))
		if err != nil {
			return err
		}
		myRank, err := s.hr.HRRoleRank(ctx, a.UID)
		if err != nil {
			return err
		}
		if theirRank > myRank {
			return apperr.New(msgSubTargetHR)
		}
	}
	return nil
}

// storedPerms: perms gửi lên -> giá trị lệnh lõi sẽ ghi (joinArr: không phải mảng thì ghi ""; nil giữ nil), để cửa ngõ kiểm
// đúng cái được lưu (chuỗi "sp_edit" gửi thẳng sẽ thành "" = sửa + duyệt).
func storedPerms(v any) any {
	if _, ok := v.([]any); ok || v == nil {
		return v
	}
	return ""
}

// subPermsGate (M14.7): subadmin cấp perms (cur = perms hiện tại, nil khi tạo mới) - cấp MỚI da_duyet cần chính mình có
// da_duyet; subadmin chỉ ở mức sp_edit thì nhân viên cũng chỉ được mức sp_edit (mức "" = sửa + duyệt). Không phải subadmin -> nil.
func (s *Service) subPermsGate(ctx context.Context, a *actor.Actor, cur, perms any) error {
	if !a.IsSubAdmin() {
		return nil
	}
	mine, err := s.myPerms(ctx, a)
	if err != nil {
		return err
	}
	if s.coPerm(perms, permDaDuyet) && !s.coPerm(cur, permDaDuyet) && !s.coPerm(mine, permDaDuyet) {
		return apperr.New(msgSubDaDuyet)
	}
	if s.spLevel(mine) == permSpEdit && s.spLevel(perms) != permSpEdit {
		return apperr.New(msgSubSpLevel)
	}
	return nil
}

// pinGrants (M14.7): sau khi subadmin tạo / sửa perms tài khoản id - ghim người cấp = subadmin. Không phải subadmin -> nil.
func (s *Service) pinGrants(ctx context.Context, a *actor.Actor, id any) error {
	if s.access == nil || !a.IsSubAdmin() {
		return nil
	}
	return s.access.PinGrantedBy(ctx, a, id)
}

// permSpDuyet: quyền duyệt sản phẩm của nhân viên (M14.6).
const permSpDuyet = "sp_duyet"

// coPerm: danh sách perms (mảng của client hoặc chuỗi "a,b" của database) có quyền p.
func (s *Service) coPerm(v any, p string) bool {
	if arr, ok := v.([]any); ok {
		v = joinArr(arr)
	}
	for _, x := range s.PermsArr(v) {
		if x == p {
			return true
		}
	}
	return false
}

// spDuyetGate (M14.6): actor không phải super, chưa được super giao duyệt (users.duoc_duyet_sp) mà cấp MỚI sp_duyet
// (newPerms có, curPerms chưa có) -> lỗi. Giữ / bỏ quyền đã cấp thì được.
func (s *Service) spDuyetGate(ctx context.Context, a *actor.Actor, curPerms, newPerms any) error {
	if a == nil || a.R == "super" || !s.coPerm(newPerms, permSpDuyet) || s.coPerm(curPerms, permSpDuyet) {
		return nil
	}
	me, err := s.GetByID(ctx, a.UID)
	if err != nil {
		return err
	}
	// cờ giao duyệt chỉ có hiệu lực khi đang là admin công ty (subadmin / admin đã bị hạ còn sót cờ thì không cấp được)
	if me != nil && me.Val("duoc_duyet_sp") == true && jsval.StrictEquals(me.Val("role"), "admin") {
		return nil
	}
	return apperr.New(msgGrantSpDuyet)
}

// permsGate (N21): admin công ty (không phải super) cấp users.perms cho nhân viên - phần cấp thêm không vượt quyền thực của
// admin (contracts.AccessGranter). Đích là admin / super (perms không tạo quyền thực) hoặc chưa nối Access -> không kiểm.
func (s *Service) permsGate(ctx context.Context, a *actor.Actor, targetRole string, cur, perms any) error {
	if s.access == nil || a == nil || a.R == "super" || targetRole == "admin" || targetRole == "super" {
		return nil
	}
	return s.access.CheckLegacyPerms(ctx, a, cur, perms)
}

// freezeGrants (N21): tài khoản admin công ty / subadmin (M14.7) sắp bị xoá (fields nil) / đổi vai trò / chuyển công ty ->
// cắt sẵn quyền của nhân viên do tài khoản này cấp theo quyền cuối của nó (giới hạn không mất theo người cấp). Không đổi gì
// quyền thực hiện tại, nên chạy trước lệnh lõi (lệnh lõi lỗi cũng không sao).
func (s *Service) freezeGrants(ctx context.Context, id any, fields *omap.Map) error {
	if s.access == nil {
		return nil
	}
	u, err := s.GetByID(ctx, id)
	if err != nil || u == nil {
		return err
	}
	curRole := jsval.StrOr(u.Val("role"), "")
	if curRole != "admin" && curRole != actor.RoleSubAdmin {
		return nil
	}
	if fields != nil {
		demote := fields.Has("role") && !jsval.StrictEquals(fields.Val("role"), curRole)
		move := fields.Has("congTyId") && jsval.ToString(jsval.Or(fields.Val("congTyId"), "")) != jsval.ToString(jsval.Or(u.Val("cong_ty_id"), ""))
		if !demote && !move {
			return nil
		}
	}
	return s.access.FreezeGrantsBy(ctx, u.Val("id"))
}

// AdminCreateUserGated: không phải super thì không tạo được tài khoản admin; cấp sp_duyet cần được giao duyệt.
func (s *Service) AdminCreateUserGated(ctx context.Context, a *actor.Actor, data *omap.Map) (*omap.Map, error) {
	var role, perms any
	if data != nil && data.Has("role") {
		role = data.Val("role")
	}
	if err := adminGate(a, "", role, false); err != nil {
		return nil, err
	}
	if data != nil {
		perms = storedPerms(data.Val("perms"))
	}
	if err := s.spDuyetGate(ctx, a, "", perms); err != nil {
		return nil, err
	}
	if err := s.subPermsGate(ctx, a, nil, perms); err != nil {
		return nil, err
	}
	if err := s.permsGate(ctx, a, "", nil, perms); err != nil {
		return nil, err
	}
	res, err := s.AdminCreateUser(ctx, a, data)
	if err != nil {
		return nil, err
	}
	if err := s.pinGrants(ctx, a, res.Val("id")); err != nil {
		return nil, err
	}
	return res, nil
}

// AdminUpdateUserGated: không sửa admin khác, không nâng lên admin, không tự đổi vai trò; cấp mới sp_duyet cần được giao duyệt.
func (s *Service) AdminUpdateUserGated(ctx context.Context, a *actor.Actor, id any, fields *omap.Map) (*omap.Map, error) {
	var role, pinID any
	if fields != nil && fields.Has("role") {
		role = fields.Val("role")
	}
	if a != nil && a.R != "super" {
		u, err := s.targetUser(ctx, a, id)
		if err != nil {
			return nil, err
		}
		self := jsval.ToString(u.Val("id")) == jsval.ToString(a.UID)
		if err := adminGate(a, jsval.StrOr(u.Val("role"), ""), role, self); err != nil {
			return nil, err
		}
		// subadmin tự sửa mình (M14.7): bỏ perms (không tự cấp quyền) và role (đã kiểm: không gửi / giữ subadmin;
		// role null sẽ bị lệnh lõi hạ về staff)
		if a.IsSubAdmin() && self && fields != nil {
			fields = fields.Clone()
			fields.Delete("perms")
			fields.Delete("role")
		}
		if err := s.subTargetGate(ctx, a, u); err != nil {
			return nil, err
		}
		if fields != nil && fields.Has("perms") {
			np := storedPerms(fields.Val("perms"))
			if err := s.spDuyetGate(ctx, a, u.Val("perms"), np); err != nil {
				return nil, err
			}
			if err := s.subPermsGate(ctx, a, u.Val("perms"), np); err != nil {
				return nil, err
			}
			if err := s.permsGate(ctx, a, jsval.StrOr(u.Val("role"), ""), u.Val("perms"), np); err != nil {
				return nil, err
			}
			if a.IsSubAdmin() {
				pinID = u.Val("id")
			}
		}
	}
	// admin công ty bị hạ xuống subadmin (M14.7): sau khi lưu, nhân viên do nó cấp thôi bị giới hạn theo quyền subadmin
	// (thường nhỏ hơn quyền admin cũ) - FreezeGrantsBy đã cắt sẵn theo quyền admin cuối, quyền thực của họ giữ nguyên
	var release any
	if s.access != nil && fields != nil && fields.Has("role") && jsval.StrictEquals(fields.Val("role"), actor.RoleSubAdmin) {
		cur, err := s.GetByID(ctx, id)
		if err != nil {
			return nil, err
		}
		if cur != nil && jsval.StrictEquals(cur.Val("role"), "admin") {
			release = cur.Val("id")
		}
	}
	if fields != nil && (fields.Has("role") || fields.Has("congTyId")) {
		if err := s.freezeGrants(ctx, id, fields); err != nil {
			return nil, err
		}
	}
	res, err := s.AdminUpdateUser(ctx, a, id, fields)
	if err != nil {
		return res, err
	}
	if release != nil {
		if err := s.access.ReleaseGrantsBy(ctx, a, release); err != nil {
			return nil, err
		}
	}
	if pinID == nil {
		return res, nil
	}
	if err := s.pinGrants(ctx, a, pinID); err != nil {
		return nil, err
	}
	return res, nil
}

// AdminSetPasswordGated: không đặt mật khẩu cho admin khác.
func (s *Service) AdminSetPasswordGated(ctx context.Context, a *actor.Actor, id any, newPassword any) (*omap.Map, error) {
	if err := s.gateTarget(ctx, a, id, nil); err != nil {
		return nil, err
	}
	return s.AdminSetPassword(ctx, a, id, newPassword)
}

// AdminSetActiveGated: không khoá / mở khoá admin khác.
func (s *Service) AdminSetActiveGated(ctx context.Context, a *actor.Actor, id any, active any) (*omap.Map, error) {
	if err := s.gateTarget(ctx, a, id, nil); err != nil {
		return nil, err
	}
	return s.AdminSetActive(ctx, a, id, active)
}

// AdminDeleteUserGated: không xoá admin khác (tự xoá đã bị hàm lõi chặn).
func (s *Service) AdminDeleteUserGated(ctx context.Context, a *actor.Actor, id any) (*omap.Map, error) {
	if err := s.gateTarget(ctx, a, id, nil); err != nil {
		return nil, err
	}
	if err := s.freezeGrants(ctx, id, nil); err != nil {
		return nil, err
	}
	return s.AdminDeleteUser(ctx, a, id)
}

// ProductApprovers (chỉ bản Go, M14.6): tài khoản admin công ty trong phạm vi (super: mọi công ty hoặc công ty đang xem;
// admin: công ty mình) kèm cờ được giao duyệt sản phẩm -> [{id, duocDuyetSp}].
func (s *Service) ProductApprovers(ctx context.Context) ([]any, error) {
	rows, err := s.repo.CompanyAdmins(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = omap.Of("id", r.Val("id"), "duocDuyetSp", r.Val("duoc_duyet_sp") == true)
	}
	return out, nil
}

// SetProductApproval (chỉ bản Go, M14.6): super bật / tắt quyền duyệt sản phẩm (và giao sp_duyet cho nhân viên) của 1
// tài khoản admin công ty. Ghi audit vào công ty của tài khoản đó. -> {ok: true}
func (s *Service) SetProductApproval(ctx context.Context, a *actor.Actor, id any, on any) (*omap.Map, error) {
	if a == nil || a.R != "super" {
		return nil, apperr.New(msgSuperOnly)
	}
	u, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, apperr.New(msgNotFound)
	}
	if !jsval.StrictEquals(u.Val("role"), "admin") {
		return nil, apperr.New(msgApprovalAdminOnly)
	}
	bat := jsval.Truthy(on)
	if _, err := s.repo.UpdateUser(ctx, u.Val("id"), omap.Of("duoc_duyet_sp", bat)); err != nil {
		return nil, err
	}
	action, detail := "giao_duyet_sp", "Giao quyền duyệt sản phẩm cho "
	if !bat {
		action, detail = "thu_duyet_sp", "Thu quyền duyệt sản phẩm của "
	}
	s.Audit(ctx, a, action, detail+jsval.StrOr(u.Val("username"), ""), u.Val("cong_ty_id"))
	return omap.Of("ok", true), nil
}
