package users

import (
	"context"

	"qspro-backend/internal/shared/omap"
)

// Repository: những gì service cần từ kho dữ liệu. Dòng trả về là dòng THÔ (khoá = tên cột bên Node).
type Repository interface {
	// UserByID: getUserById (A:212-215) - noScope, limit 1; không có -> nil.
	UserByID(ctx context.Context, id any) (*omap.Map, error)
	// ListUsers: A:314-316 - order created_at.asc, limit 500; noScope khi người gọi là super.
	ListUsers(ctx context.Context, noScope bool) ([]*omap.Map, error)
	// UsersByUsername: A:336 - noScope, limit 1.
	UsersByUsername(ctx context.Context, username string) ([]*omap.Map, error)
	// CompanyUserIDs: A:342 - select id, noScope, limit 1000.
	CompanyUserIDs(ctx context.Context, congTyID any) ([]*omap.Map, error)
	// ActiveAdmins: A:375-377 - admin đang mở của 1 công ty (hoặc không thuộc công ty nào), limit 2.
	ActiveAdmins(ctx context.Context, congTyID any) ([]*omap.Map, error)
	// UserByEmailInCompanyExcept (chỉ bản Go, M14.1): tài khoản KHÁC exceptID trong công ty congTyID (nil = không thuộc
	// công ty nào) có email trùng (không phân biệt hoa thường); noScope; không có -> nil.
	UserByEmailInCompanyExcept(ctx context.Context, email string, congTyID, exceptID any) (*omap.Map, error)
	// CompanyAdmins (chỉ bản Go, M14.6): id + duoc_duyet_sp của tài khoản role admin, CÓ phạm vi công ty của ctx
	// (super không xem công ty nào -> mọi công ty), order created_at.asc, limit 500.
	CompanyAdmins(ctx context.Context) ([]*omap.Map, error)
	InsertUser(ctx context.Context, row *omap.Map) ([]*omap.Map, error)
	UpdateUser(ctx context.Context, id any, patch *omap.Map) ([]*omap.Map, error)
	DeleteUser(ctx context.Context, id any) error
	// InsertAudit: insert audit_log CÓ phạm vi công ty của ctx.
	InsertAudit(ctx context.Context, row *omap.Map) error
	// AuditLog: A:445 - có phạm vi công ty, order created_at.desc.
	AuditLog(ctx context.Context, limit int) ([]*omap.Map, error)
	// LimitError: lỗi Postgres trả cho "limit <text>" trên audit_log, theo dạng lỗi của supa.select (nil nếu không lỗi).
	LimitError(ctx context.Context, text string) error
}
