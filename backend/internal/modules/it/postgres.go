package it

import (
	"context"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/omap"
)

// Repository: truy cập dữ liệu. it_yeu_cau / it_thiet_bi / users nằm trong TenantTables nên mọi lệnh tự lọc theo công ty
// của phiên (chèn dòng mới tự gắn cong_ty_id).
type Repository interface {
	ListTickets(ctx context.Context, createdBy any) ([]*omap.Map, error) // createdBy nil = mọi yêu cầu của công ty
	GetTicket(ctx context.Context, id float64) (*omap.Map, error)
	InsertTicket(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateTicket(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
	DeleteTicket(ctx context.Context, id float64) (int, error)
	ListAssets(ctx context.Context) ([]*omap.Map, error)
	InsertAsset(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateAsset(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
	DeleteAsset(ctx context.Context, id float64) (int, error)
	ListStaff(ctx context.Context) ([]*omap.Map, error)
}

type pgRepo struct{ db *database.DB }

func newPgRepo(db *database.DB) Repository { return &pgRepo{db: db} }

func first(rows []*omap.Map, err error) (*omap.Map, error) {
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (r *pgRepo) ListTickets(ctx context.Context, createdBy any) ([]*omap.Map, error) {
	o := database.SelectOpt{Order: "id.desc", Limit: 2000}
	if createdBy != nil {
		o.Filter = database.Eq("nguoi_tao", createdBy)
	}
	return r.db.Select(ctx, "it_yeu_cau", o)
}

func (r *pgRepo) GetTicket(ctx context.Context, id float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "it_yeu_cau", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1}))
}

func (r *pgRepo) InsertTicket(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "it_yeu_cau", row))
}

func (r *pgRepo) UpdateTicket(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "it_yeu_cau", database.Eq("id", id), patch))
}

func (r *pgRepo) DeleteTicket(ctx context.Context, id float64) (int, error) {
	rows, err := r.db.Remove(ctx, "it_yeu_cau", database.Eq("id", id))
	return len(rows), err
}

func (r *pgRepo) ListAssets(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "it_thiet_bi", database.SelectOpt{Order: "id.asc", Limit: 5000})
}

func (r *pgRepo) InsertAsset(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "it_thiet_bi", row))
}

func (r *pgRepo) UpdateAsset(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "it_thiet_bi", database.Eq("id", id), patch))
}

func (r *pgRepo) DeleteAsset(ctx context.Context, id float64) (int, error) {
	rows, err := r.db.Remove(ctx, "it_thiet_bi", database.Eq("id", id))
	return len(rows), err
}

// ListStaff: tài khoản đang hoạt động của công ty (chọn người yêu cầu / người liên quan, gửi thông báo).
func (r *pgRepo) ListStaff(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Select: "id,username,ho_ten,phong_ban,role,perms", Filter: database.Eq("active", true), Order: "username.asc", Limit: 1000})
}
