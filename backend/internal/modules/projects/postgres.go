package projects

import (
	"context"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

type pgRepo struct{ db *database.DB }

// NewRepository: Repository trên tầng dữ liệu chung (bản chuyển của các lệnh supa.* trong store_supa.js).
func NewRepository(db *database.DB) Repository { return &pgRepo{db: db} }

func (r *pgRepo) ListProjects(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "du_an", database.SelectOpt{Select: "*", Order: "ngay_tao.desc", Limit: 2000})
}

func (r *pgRepo) FindProject(ctx context.Context, maDA any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "du_an", database.SelectOpt{Filter: database.Eq("ma_da", maDA), Limit: 1})
}

func (r *pgRepo) InsertProject(ctx context.Context, row *omap.Map) ([]*omap.Map, error) {
	return r.db.InsertOne(ctx, "du_an", row)
}

func (r *pgRepo) UpdateProject(ctx context.Context, maDA any, patch *omap.Map) ([]*omap.Map, error) {
	return r.db.Update(ctx, "du_an", database.Eq("ma_da", maDA), patch)
}

func (r *pgRepo) DeleteProject(ctx context.Context, maDA any) error {
	_, err := r.db.Remove(ctx, "du_an", database.Eq("ma_da", maDA))
	return err
}

func (r *pgRepo) DeleteLines(ctx context.Context, maDA any) error {
	_, err := r.db.Remove(ctx, "db_bao_gia", database.Eq("ma_du_an", maDA))
	return err
}

func (r *pgRepo) DeleteCover(ctx context.Context, maDA any) error {
	_, err := r.db.Remove(ctx, "khai_toan", database.Eq("ma_da", maDA))
	return err
}

func (r *pgRepo) DeleteProjData(ctx context.Context, maDA any) error {
	_, err := r.db.Remove(ctx, "du_an_data", database.Eq("ma_da", maDA))
	return err
}

func (r *pgRepo) ListLinesRaw(ctx context.Context, maDA any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "db_bao_gia", database.SelectOpt{Select: "*", Filter: database.Eq("ma_du_an", maDA),
		Order: "sort_no.asc", Limit: qscore.LIM})
}

func (r *pgRepo) InsertLines(ctx context.Context, rows []*omap.Map) error {
	_, err := r.db.Insert(ctx, "db_bao_gia", rows)
	return err
}

func (r *pgRepo) ListCoverRaw(ctx context.Context, maDA any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "khai_toan", database.SelectOpt{Select: "*", Filter: database.Eq("ma_da", maDA), Limit: 2000})
}

func (r *pgRepo) InsertCover(ctx context.Context, rows []*omap.Map) error {
	_, err := r.db.Insert(ctx, "khai_toan", rows)
	return err
}

func (r *pgRepo) ListProjDataRaw(ctx context.Context, maDA any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "du_an_data", database.SelectOpt{Select: "*", Filter: database.Eq("ma_da", maDA), Limit: 50})
}

func (r *pgRepo) InsertProjDataRows(ctx context.Context, rows []*omap.Map) error {
	_, err := r.db.Insert(ctx, "du_an_data", rows)
	return err
}

func (r *pgRepo) ListProjDataKV(ctx context.Context, maDA string) ([]*omap.Map, error) {
	return r.db.Select(ctx, "du_an_data", database.SelectOpt{Select: "khoa,gia_tri", Filter: database.Eq("ma_da", maDA), Limit: 50})
}

// settingsNotProj: khoá cai_dat_cong_ty của module khác, không trả qua getProjData (kdAiConfig: cấu hình AI Kinh doanh,
// chỉ đọc qua /sales/ai-config có kiểm quyền).
const settingsNotProj = "khoa=neq.kdAiConfig"

// Không có công ty (super chưa chọn công ty): chỉ các dòng cong_ty_id NULL, bỏ lọc tự động.
func (r *pgRepo) ListCompanySettings(ctx context.Context, khongCongTy bool) ([]*omap.Map, error) {
	if khongCongTy {
		return r.db.Select(ctx, "cai_dat_cong_ty", database.SelectOpt{Select: "khoa,gia_tri", Filter: "cong_ty_id=is.null&" + settingsNotProj,
			Limit: 50, NoScope: true})
	}
	return r.db.Select(ctx, "cai_dat_cong_ty", database.SelectOpt{Select: "khoa,gia_tri", Filter: settingsNotProj, Limit: 50})
}

func (r *pgRepo) FindCompanySetting(ctx context.Context, loc string, khongCongTy bool) ([]*omap.Map, error) {
	return r.db.Select(ctx, "cai_dat_cong_ty", database.SelectOpt{Select: "khoa", Filter: loc, Limit: 1, NoScope: khongCongTy})
}

func (r *pgRepo) UpdateCompanySetting(ctx context.Context, loc string, row *omap.Map, khongCongTy bool) error {
	_, err := r.db.Update(ctx, "cai_dat_cong_ty", loc, row, database.Opt{NoScope: khongCongTy})
	return err
}

func (r *pgRepo) InsertCompanySetting(ctx context.Context, row *omap.Map, khongCongTy bool) error {
	_, err := r.db.InsertOne(ctx, "cai_dat_cong_ty", row, database.Opt{NoScope: khongCongTy})
	return err
}

func projDataLoc(maDA, khoa string) string {
	return database.Eq("ma_da", maDA) + "&" + database.Eq("khoa", khoa)
}

func (r *pgRepo) FindProjData(ctx context.Context, maDA, khoa string) ([]*omap.Map, error) {
	return r.db.Select(ctx, "du_an_data", database.SelectOpt{Select: "ma_da", Filter: projDataLoc(maDA, khoa), Limit: 1})
}

func (r *pgRepo) UpdateProjData(ctx context.Context, maDA, khoa string, row *omap.Map) error {
	_, err := r.db.Update(ctx, "du_an_data", projDataLoc(maDA, khoa), row)
	return err
}

func (r *pgRepo) InsertProjData(ctx context.Context, row *omap.Map) error {
	_, err := r.db.InsertOne(ctx, "du_an_data", row)
	return err
}
