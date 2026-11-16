package settings

import (
	"context"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/omap"
)

const tblSettings = "cai_dat_he_thong"

type pgRepo struct{ db *database.DB }

// NewRepository: Repository trên tầng dữ liệu chung.
func NewRepository(db *database.DB) Repository { return &pgRepo{db: db} }

func (r *pgRepo) ListSettings(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, tblSettings, database.SelectOpt{Select: "khoa,gia_tri,cap_nhat,nguoi_sua",
		Order: "cap_nhat.desc,khoa.asc", Limit: 50})
}

func (r *pgRepo) FindSetting(ctx context.Context, khoa string) ([]*omap.Map, error) {
	return r.db.Select(ctx, tblSettings, database.SelectOpt{Select: "khoa", Filter: database.Eq("khoa", khoa), Limit: 1})
}

func (r *pgRepo) UpdateSetting(ctx context.Context, khoa string, row *omap.Map) error {
	_, err := r.db.Update(ctx, tblSettings, database.Eq("khoa", khoa), row)
	return err
}

func (r *pgRepo) InsertSetting(ctx context.Context, row *omap.Map) error {
	_, err := r.db.InsertOne(ctx, tblSettings, row)
	return err
}

func (r *pgRepo) DeleteSetting(ctx context.Context, khoa string) error {
	_, err := r.db.Remove(ctx, tblSettings, database.Eq("khoa", khoa))
	return err
}
