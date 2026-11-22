package sales

import (
	"context"
	"errors"
	"strings"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Repository: truy cập dữ liệu. kd_khach_hang / kd_cham_soc (+ 4 bảng con của 0053) nằm trong TenantTables nên mọi lệnh tự lọc theo công ty
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
	ListStaff(ctx context.Context) ([]*omap.Map, error)

	// trang khách hàng dạng dashboard (migration 0053): kd_cham_diem, kd_lich_hen, kd_nhiem_vu_kh, kd_goi_y - bảng con,
	// công ty xét qua dòng cha kd_khach_hang nên đọc / sửa theo id cũng không ra khỏi công ty
	GetScore(ctx context.Context, leadID float64) (*omap.Map, error)
	InsertScore(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateScore(ctx context.Context, leadID float64, patch *omap.Map) (*omap.Map, error)
	ListAppointments(ctx context.Context, leadID float64) ([]*omap.Map, error)
	GetAppointment(ctx context.Context, id float64) (*omap.Map, error)
	InsertAppointment(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateAppointment(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
	DeleteAppointment(ctx context.Context, id float64) (int, error)
	ListTasks(ctx context.Context, leadID float64) ([]*omap.Map, error)
	GetTask(ctx context.Context, id float64) (*omap.Map, error)
	InsertTask(ctx context.Context, row *omap.Map) (*omap.Map, error)
	UpdateTask(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
	DeleteTask(ctx context.Context, id float64) (int, error)
	LatestInsight(ctx context.Context, leadID float64) (*omap.Map, error)
	InsertInsight(ctx context.Context, row *omap.Map) (*omap.Map, error)
	PruneInsights(ctx context.Context, leadID float64, keep int) error

	// đổi tên người phụ trách theo họ tên mới của tài khoản (service_rename.go): mọi dòng của công ty đang làm việc,
	// chỉ các cột chứa tên người; ids rỗng = mọi dòng (không khoá), có ids = chỉ các dòng đó và KHOÁ chúng (FOR UPDATE, gọi trong Tx).
	// Accounts gồm cả tài khoản đã khoá (để nhận ra tên trùng)
	LeadPeople(ctx context.Context, ids []float64) ([]*omap.Map, error)
	TaskPeople(ctx context.Context, ids []float64) ([]*omap.Map, error)
	AppointmentPeople(ctx context.Context, ids []float64) ([]*omap.Map, error)
	Accounts(ctx context.Context) ([]*omap.Map, error)

	// cài đặt công ty (cai_dat_cong_ty, thuộc TenantTables: tự lọc / tự gắn công ty đang làm việc), vd khoá kdAiConfig
	GetSetting(ctx context.Context, key string) (*omap.Map, error)
	SaveSetting(ctx context.Context, key string, row *omap.Map) error
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
	return r.db.Select(ctx, "kd_khach_hang", database.SelectOpt{Order: "id.asc", Limit: 5000}) // thứ tự thêm vào, như mảng leads cũ (thẻ mới nối cuối)
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

// ListStaff: tài khoản đang hoạt động của công ty (users thuộc TenantTables nên tự lọc theo công ty; super không có công ty nên không lẫn vào).
func (r *pgRepo) ListStaff(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Select: "id,username,ho_ten,phong_ban,role,perms", Filter: database.Eq("active", true), Order: "username.asc", Limit: 1000})
}

func (r *pgRepo) GetScore(ctx context.Context, leadID float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "kd_cham_diem", database.SelectOpt{Filter: database.Eq("khach_hang_id", leadID), Limit: 1}))
}

func (r *pgRepo) InsertScore(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "kd_cham_diem", row))
}

func (r *pgRepo) UpdateScore(ctx context.Context, leadID float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "kd_cham_diem", database.Eq("khach_hang_id", leadID), patch))
}

func (r *pgRepo) ListAppointments(ctx context.Context, leadID float64) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_lich_hen", database.SelectOpt{Filter: database.Eq("khach_hang_id", leadID), Order: "ngay.asc,gio_bat_dau.asc,id.asc", Limit: 500})
}

func (r *pgRepo) GetAppointment(ctx context.Context, id float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "kd_lich_hen", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1}))
}

func (r *pgRepo) InsertAppointment(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "kd_lich_hen", row))
}

func (r *pgRepo) UpdateAppointment(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "kd_lich_hen", database.Eq("id", id), patch))
}

func (r *pgRepo) DeleteAppointment(ctx context.Context, id float64) (int, error) {
	rows, err := r.db.Remove(ctx, "kd_lich_hen", database.Eq("id", id))
	return len(rows), err
}

func (r *pgRepo) ListTasks(ctx context.Context, leadID float64) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_nhiem_vu_kh", database.SelectOpt{Filter: database.Eq("khach_hang_id", leadID), Order: "xong.asc,han.asc.nullslast,id.asc", Limit: 500})
}

func (r *pgRepo) GetTask(ctx context.Context, id float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "kd_nhiem_vu_kh", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1}))
}

func (r *pgRepo) InsertTask(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "kd_nhiem_vu_kh", row))
}

func (r *pgRepo) UpdateTask(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	return first(r.db.Update(ctx, "kd_nhiem_vu_kh", database.Eq("id", id), patch))
}

func (r *pgRepo) DeleteTask(ctx context.Context, id float64) (int, error) {
	rows, err := r.db.Remove(ctx, "kd_nhiem_vu_kh", database.Eq("id", id))
	return len(rows), err
}

// LatestInsight: bản phân tích mới nhất (các bản cũ giữ lại làm lịch sử, không trả ra).
func (r *pgRepo) LatestInsight(ctx context.Context, leadID float64) (*omap.Map, error) {
	return first(r.db.Select(ctx, "kd_goi_y", database.SelectOpt{Filter: database.Eq("khach_hang_id", leadID), Order: "ngay_tao.desc,id.desc", Limit: 1}))
}

func (r *pgRepo) InsertInsight(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	return first(r.db.InsertOne(ctx, "kd_goi_y", row))
}

// PruneInsights: chỉ giữ keep bản phân tích mới nhất của khách (thứ tự như LatestInsight).
func (r *pgRepo) PruneInsights(ctx context.Context, leadID float64, keep int) error {
	rows, err := r.db.Select(ctx, "kd_goi_y", database.SelectOpt{Select: "id", Filter: database.Eq("khach_hang_id", leadID), Order: "ngay_tao.desc,id.desc", Limit: keep + 200})
	if err != nil || len(rows) <= keep {
		return err
	}
	ids := make([]string, 0, len(rows)-keep)
	for _, x := range rows[keep:] {
		ids = append(ids, jsval.Str(x.Val("id")))
	}
	_, err = r.db.Remove(ctx, "kd_goi_y", database.Eq("khach_hang_id", leadID)+"&id=in.("+strings.Join(ids, ",")+")")
	return err
}

func (r *pgRepo) LeadPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_khach_hang", peopleOpt("id,phu_trach,quan_ly,nguoi_tao_ten", ids))
}

func (r *pgRepo) TaskPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_nhiem_vu_kh", peopleOpt("id,phu_trach", ids))
}

func (r *pgRepo) AppointmentPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	return r.db.Select(ctx, "kd_lich_hen", peopleOpt("id,thanh_vien", ids))
}

// peopleOpt: có ids -> chỉ các dòng đó, khoá theo thứ tự id (2 lần đổi tên cùng lúc không khoá chéo nhau)
func peopleOpt(cols string, ids []float64) database.SelectOpt {
	o := database.SelectOpt{Select: cols, Order: "id.asc"}
	if len(ids) > 0 {
		s := make([]string, len(ids))
		for i, id := range ids {
			s[i] = jsval.Str(id)
		}
		o.Filter, o.Lock = "id=in.("+strings.Join(s, ",")+")", true
	}
	return o
}

func (r *pgRepo) Accounts(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Select: "id,username,ho_ten", Order: "id.asc"})
}

func (r *pgRepo) GetSetting(ctx context.Context, key string) (*omap.Map, error) {
	return first(r.db.Select(ctx, "cai_dat_cong_ty", database.SelectOpt{Select: "khoa,gia_tri,cap_nhat,nguoi_sua", Filter: database.Eq("khoa", key), Limit: 1}))
}

// SaveSetting: có dòng -> sửa, chưa có -> thêm; 2 lần lưu cùng lúc cùng thêm (trùng khoá 23505) -> sửa.
func (r *pgRepo) SaveSetting(ctx context.Context, key string, row *omap.Map) error {
	loc := database.Eq("khoa", key)
	cur, err := r.GetSetting(ctx, key)
	if err != nil {
		return err
	}
	if cur == nil {
		_, err = r.db.InsertOne(ctx, "cai_dat_cong_ty", row.Clone().Set("khoa", key))
		var de *database.Error
		if !errors.As(err, &de) || de.Code != "23505" {
			return err
		}
	}
	_, err = r.db.Update(ctx, "cai_dat_cong_ty", loc, row)
	return err
}
