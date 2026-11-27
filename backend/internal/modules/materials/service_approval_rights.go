package materials

import (
	"context"
	"strings"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	"qspro-backend/internal/shared/omap"
)

// Duyệt sản phẩm theo phân cấp (chỉ bản Go, roadmap M14.6, migration 0051):
//   - quản trị hệ thống (super): luôn duyệt được và giao được quyền duyệt (sp_duyet) cho nhân viên;
//   - admin công ty: chỉ khi super đã giao (users.duoc_duyet_sp) - khi đó duyệt và giao tiếp được;
//   - nhân viên: chỉ khi có quyền sp_duyet (bỏ ngoại lệ "chưa cấu hình gì thì được duyệt" của spPerms_); không giao được.
// spMyPerms / SpPerms giữ nguyên như bản Node (đầu ra đóng băng); quyền duyệt thật đọc ở đây.

const msgKhongDuyet = "Tài khoản không có quyền duyệt sản phẩm"

var _ contracts.ApprovalChecker = (*Service)(nil)

// SpApprovalRights: duyet = được duyệt / bỏ duyệt sản phẩm; giaoDuyet = được cấp quyền sp_duyet cho nhân viên.
func (s *Service) SpApprovalRights(ctx context.Context, a *actor.Actor) (duyet, giaoDuyet bool, err error) {
	if a == nil {
		return false, false, nil
	}
	if a.R == "super" {
		return true, true, nil
	}
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil || u == nil {
		return false, false, err
	}
	if a.R == "admin" {
		ok := u.Val("duoc_duyet_sp") == true
		return ok, ok, nil
	}
	for _, p := range s.userFmt.PermsArr(u.Val("perms")) {
		if p == "sp_duyet" {
			return true, false, nil
		}
	}
	return false, false, nil
}

// SpApprovalRightsOut: GET /product-approval-rights -> {duyet, giaoDuyet}.
func (s *Service) SpApprovalRightsOut(ctx context.Context, a *actor.Actor) (*omap.Map, error) {
	duyet, giao, err := s.SpApprovalRights(ctx, a)
	if err != nil {
		return nil, err
	}
	return omap.Of("duyet", duyet, "giaoDuyet", giao), nil
}

// ChuaDuyet (contracts.ApprovalChecker): mã có trong danh mục của công ty trong ctx mà chưa dòng nào được duyệt.
func (s *Service) ChuaDuyet(ctx context.Context, ma string) (bool, error) {
	ma = strings.TrimSpace(ma)
	if ma == "" {
		return false, nil
	}
	rows, err := s.repo.Select(ctx, "db_san_pham", database.SelectOpt{Select: "id,da_duyet", Filter: database.Eq("ma_sp", ma), Limit: 50})
	if err != nil || len(rows) == 0 {
		return false, err
	}
	for _, r := range rows {
		if r.Val("da_duyet") == true {
			return false, nil
		}
	}
	return true, nil
}
