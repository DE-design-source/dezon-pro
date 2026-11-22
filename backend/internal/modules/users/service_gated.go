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

// adminGate: lỗi nếu actor (không phải super) đụng tới tài khoản admin khác mình, nâng ai lên admin, hoặc tự đổi vai trò.
// curRole = vai trò hiện tại của tài khoản đích ("" = tạo mới); newRole = vai trò gửi lên (nil = không đổi); self = đích là chính mình.
func adminGate(a *actor.Actor, curRole string, newRole any, self bool) error {
	if a == nil || a.R == "super" {
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
	return adminGate(a, jsval.StrOr(u.Val("role"), ""), newRole, self)
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
	if me != nil && me.Val("duoc_duyet_sp") == true {
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

// freezeGrants (N21): tài khoản admin công ty sắp bị xoá (fields nil) / đổi vai trò / chuyển công ty -> cắt sẵn quyền của
// nhân viên do admin này cấp theo quyền cuối của admin (giới hạn không mất theo người cấp). Không đổi gì quyền thực hiện tại,
// nên chạy trước lệnh lõi (lệnh lõi lỗi cũng không sao).
func (s *Service) freezeGrants(ctx context.Context, id any, fields *omap.Map) error {
	if s.access == nil {
		return nil
	}
	u, err := s.GetByID(ctx, id)
	if err != nil || u == nil || !jsval.StrictEquals(u.Val("role"), "admin") {
		return err
	}
	if fields != nil {
		demote := fields.Has("role") && !jsval.StrictEquals(fields.Val("role"), "admin")
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
		perms = data.Val("perms")
	}
	if err := s.spDuyetGate(ctx, a, "", perms); err != nil {
		return nil, err
	}
	if err := s.permsGate(ctx, a, "", nil, perms); err != nil {
		return nil, err
	}
	return s.AdminCreateUser(ctx, a, data)
}

// AdminUpdateUserGated: không sửa admin khác, không nâng lên admin, không tự đổi vai trò; cấp mới sp_duyet cần được giao duyệt.
func (s *Service) AdminUpdateUserGated(ctx context.Context, a *actor.Actor, id any, fields *omap.Map) (*omap.Map, error) {
	var role any
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
		if fields != nil && fields.Has("perms") {
			if err := s.spDuyetGate(ctx, a, u.Val("perms"), fields.Val("perms")); err != nil {
				return nil, err
			}
			if err := s.permsGate(ctx, a, jsval.StrOr(u.Val("role"), ""), u.Val("perms"), fields.Val("perms")); err != nil {
				return nil, err
			}
		}
	}
	if fields != nil && (fields.Has("role") || fields.Has("congTyId")) {
		if err := s.freezeGrants(ctx, id, fields); err != nil {
			return nil, err
		}
	}
	return s.AdminUpdateUser(ctx, a, id, fields)
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
