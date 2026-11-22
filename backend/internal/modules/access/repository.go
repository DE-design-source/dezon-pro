package access

import (
	"context"

	"qspro-backend/internal/shared/omap"
)

// Repository: kho dữ liệu của phân quyền 3 cấp. Mọi lệnh ghi rõ công ty trong điều kiện (super thao tác công ty bất kỳ).
type Repository interface {
	// UserByID: {id, username, role, perms, cong_ty_id} của 1 tài khoản; nil = không có.
	UserByID(ctx context.Context, id string) (*omap.Map, error)
	// CompanyByID: {id, tinh_nang}; nil = không có.
	CompanyByID(ctx context.Context, id string) (*omap.Map, error)
	// GrantRow: dòng phan_quyen {quyen, nguoi_cap, nguoi_sua, cap_nhat} của công ty (uid "" = trần công ty) hoặc của 1 tài khoản;
	// nil = chưa có (hoặc database chưa migrate 0052).
	GrantRow(ctx context.Context, congTyID, uid string) (*omap.Map, error)
	// SaveGrant: ghi đè (chưa có thì thêm) dòng phan_quyen; row gồm quyen, nguoi_cap, nguoi_sua, cap_nhat.
	SaveGrant(ctx context.Context, congTyID, uid string, row *omap.Map) error
	// GrantsBy: dòng phan_quyen {tai_khoan_id, quyen} của tài khoản trong công ty do tài khoản by cấp (nguoi_cap = by);
	// database chưa migrate 0052 -> rỗng.
	GrantsBy(ctx context.Context, congTyID, by string) ([]*omap.Map, error)
	// DeleteGrant: xoá dòng (về cách cũ).
	DeleteGrant(ctx context.Context, congTyID, uid string) error
}
