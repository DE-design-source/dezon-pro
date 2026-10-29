package sales

import (
	"context"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/omap"
)

// Repository: truy cập dữ liệu. kd_khach_hang / kd_cham_soc nằm trong TenantTables nên mọi lệnh tự lọc theo công ty
// (bảng con kd_cham_soc xét qua dòng cha).
type Repository interface {
	Company(ctx context.Context, id any) (*omap.Map, error)
	ListLeads(ctx context.Context) ([]*omap.Map, error)
	GetLead(ctx context.Context, id float64) (*omap.Map, error)
	InsertLead(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateLead(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
	DeleteLead(ctx context.Context, id float64) (int, error)
	ListActivities(ctx context.Context, leadID float64) ([]*omap.Map, error)
	InsertActivity(ctx context.Context, row *omap.Map) (*omap.Map, error)
}

type pgRepo struct{ db *database.DB }

func newPgRepo(db *database.DB) Repository { return &pgRepo{db: db} }

func first(rows []*omap.Map, err error) (*omap.Map, error) {
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (r *pgRepo) Company(ctx context.Context, id any) (*omap.Map, error) {
	// NoScope: bảng companies không thuộc TenantTables; điều kiện id = công ty đang làm việc ghi ngay trong filter
	return first(r.db.Select(ctx, "cong_ty", database.SelectOpt{Select: "tinh_nang", Filter: database.Eq("id", id), Limit: 1, NoScope: true}))
}

func (r *pgRepo) ListLeads(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_khach_hang", database.SelectOpt{Order: "ngay_tao.desc", Limit: 5000})
}

func (r *pgRepo) GetLead(ctx context.Context, id float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "kd_khach_hang", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1}))
}

func (r *pgRepo) InsertLead(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "kd_khach_hang", row))
}

func (r *pgRepo) UpdateLead(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "kd_khach_hang", database.Eq("id", id), patch))
}

func (r *pgRepo) DeleteLead(ctx context.Context, id float64) (int, error) {
	rows, err := r.db.Remove(ctx, "kd_khach_hang", database.Eq("id", id))
	return len(rows), err
}

func (r *pgRepo) ListActivities(ctx context.Context, leadID float64) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_cham_soc", database.SelectOpt{Filter: database.Eq("khach_hang_id", leadID), Order: "ngay.desc", Limit: 2000})
}

func (r *pgRepo) InsertActivity(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "kd_cham_soc", row))
}
