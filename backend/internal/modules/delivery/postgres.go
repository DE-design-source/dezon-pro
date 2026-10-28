package delivery

import (
	"context"
	"strings"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Repository: truy cập dữ liệu. Mọi bảng tk_* nằm trong TenantTables nên tự lọc theo công ty (bảng con xét qua tk_du_an).
// Hàm theo bảng con (Children / Get / Insert / Update / Remove) luôn lọc thêm du_an_id: dòng phải thuộc đúng dự án.
type Repository interface {
	Company(ctx context.Context, id any) (*omap.Map, error)
	ListProjects(ctx context.Context, kind string) ([]*omap.Map, error)
	GetProject(ctx context.Context, id float64) (*omap.Map, error)
	ProjectOfLead(ctx context.Context, leadID any, kind string) (*omap.Map, error)
	InsertProject(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateProject(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
	TaskProgress(ctx context.Context, projectIDs []any) ([]*omap.Map, error)
	MembersOf(ctx context.Context, projectIDs []any) ([]*omap.Map, error)
	Children(ctx context.Context, table string, project float64, order string) ([]*omap.Map, error)
	Get(ctx context.Context, table string, project, item float64) (*omap.Map, error)
	Insert(ctx context.Context, table string, row *omap.Map) (*omap.Map, error)
	Update(ctx context.Context, table string, project, item float64, patch *omap.Map) (*omap.Map, error)
	// Remove: table "tk_du_an" xoá chính dự án (item bỏ qua); bảng con xoá dòng item của dự án.
	Remove(ctx context.Context, table string, project, item float64) (int, error)
}

type pgRepo struct{ db *database.DB }

func newPgRepo(db *database.DB) Repository { return &pgRepo{db: db} }

func first(rows []*omap.Map, err error) (*omap.Map, error) {
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func of(project, item float64) string {
	return database.Eq("du_an_id", project) + "&" + database.Eq("id", item)
}

func (r *pgRepo) Company(ctx context.Context, id any) (*omap.Map, error) {
	// NoScope: bảng companies không thuộc TenantTables; điều kiện id = công ty đang làm việc ghi ngay trong filter
	return first(r.db.Select(ctx, "cong_ty", database.SelectOpt{Select: "tinh_nang", Filter: database.Eq("id", id), Limit: 1, NoScope: true}))
}

func (r *pgRepo) ListProjects(ctx context.Context, kind string) ([]*omap.Map, error) {
	return r.db.Select(ctx, "tk_du_an", database.SelectOpt{Filter: database.Eq("loai", kind), Order: "ngay_tao.desc", Limit: 5000})
}

func (r *pgRepo) GetProject(ctx context.Context, id float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "tk_du_an", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1}))
}

func (r *pgRepo) ProjectOfLead(ctx context.Context, leadID any, kind string) (*omap.Map, error) {
	return first(r.db.Select(ctx, "tk_du_an", database.SelectOpt{Filter: database.Eq("khach_hang_id", leadID) + "&" + database.Eq("loai", kind), Limit: 1}))
}

func (r *pgRepo) InsertProject(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "tk_du_an", row))
}

func (r *pgRepo) UpdateProject(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "tk_du_an", database.Eq("id", id), patch))
}

func inIDs(ids []any) string {
	s := make([]string, len(ids))
	for i, id := range ids {
		s[i] = jsval.Str(id)
	}
	return "du_an_id=in.(" + strings.Join(s, ",") + ")"
}

func (r *pgRepo) TaskProgress(ctx context.Context, ids []any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "tk_cong_viec", database.SelectOpt{Select: "du_an_id,tien_do,loai_tien", Filter: inIDs(ids), Limit: 100000})
}

func (r *pgRepo) MembersOf(ctx context.Context, ids []any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "tk_thanh_vien", database.SelectOpt{Filter: inIDs(ids), Order: "id.asc", Limit: 100000})
}

func (r *pgRepo) Children(ctx context.Context, table string, project float64, order string) ([]*omap.Map, error) {
	return r.db.Select(ctx, table, database.SelectOpt{Filter: database.Eq("du_an_id", project), Order: order, Limit: 20000})
}

func (r *pgRepo) Get(ctx context.Context, table string, project, item float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, table, database.SelectOpt{Filter: of(project, item), Limit: 1}))
}

func (r *pgRepo) Insert(ctx context.Context, table string, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, table, row))
}

func (r *pgRepo) Update(ctx context.Context, table string, project, item float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, table, of(project, item), patch))
}

func (r *pgRepo) Remove(ctx context.Context, table string, project, item float64) (int, error) {
	f := of(project, item)
	if table == "tk_du_an" {
		f = database.Eq("id", project)
	}
	rows, err := r.db.Remove(ctx, table, f)
	return len(rows), err
}
