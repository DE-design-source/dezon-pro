package access

import (
	"context"
	"strings"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/omap"
)

const tblGrants = "phan_quyen"

type pgRepo struct{ db *database.DB }

// NewRepository: Repository trên tầng dữ liệu chung.
// NoScope ở mọi lệnh: super đọc / ghi quyền của công ty bất kỳ (không theo công ty đang "xem như"), và AccessChecker
// được gọi cả khi ngữ cảnh chưa có công ty; điều kiện công ty luôn ghi rõ trong filter.
func NewRepository(db *database.DB) Repository { return &pgRepo{db: db} }

func first(rows []*omap.Map, err error) (*omap.Map, error) {
	if database.CodeOf(err) == "22P02" { // id không phải uuid = không có
		return nil, nil
	}
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (r *pgRepo) UserByID(ctx context.Context, id string) (*omap.Map, error) {
	return first(r.db.Select(ctx, "users", database.SelectOpt{Select: "id,username,role,perms,cong_ty_id",
		Filter: database.Eq("id", id), Limit: 1, NoScope: true}))
}

func (r *pgRepo) CompanyByID(ctx context.Context, id string) (*omap.Map, error) {
	return first(r.db.Select(ctx, "cong_ty", database.SelectOpt{Select: "id,tinh_nang", Filter: database.Eq("id", id), Limit: 1,
		NoScope: true}))
}

func grantFilter(congTyID, uid string) string {
	f := database.Eq("cong_ty_id", congTyID)
	if uid == "" {
		return f + "&tai_khoan_id=is.null"
	}
	return f + "&" + database.Eq("tai_khoan_id", uid)
}

func (r *pgRepo) GrantRow(ctx context.Context, congTyID, uid string) (*omap.Map, error) {
	row, err := first(r.db.Select(ctx, tblGrants, database.SelectOpt{Select: "quyen,nguoi_cap,nguoi_sua,cap_nhat",
		Filter: grantFilter(congTyID, uid), Limit: 1, NoScope: true}))
	if err != nil && thieuBang(err) {
		return nil, nil // chưa migrate 0052: mọi tài khoản theo cách cũ
	}
	return row, err
}

func (r *pgRepo) SaveGrant(ctx context.Context, congTyID, uid string, row *omap.Map) error {
	f := grantFilter(congTyID, uid)
	up, err := r.db.Update(ctx, tblGrants, f, row, database.Opt{NoScope: true})
	if err != nil || len(up) > 0 {
		return err
	}
	ins := row.Clone().Set("cong_ty_id", congTyID)
	if uid != "" {
		ins.Set("tai_khoan_id", uid)
	}
	_, err = r.db.InsertOne(ctx, tblGrants, ins, database.Opt{NoScope: true})
	if database.CodeOf(err) == "23505" { // 2 lần lưu cùng lúc: lần sau ghi đè
		_, err = r.db.Update(ctx, tblGrants, f, row, database.Opt{NoScope: true})
	}
	return err
}

func (r *pgRepo) GrantsBy(ctx context.Context, congTyID, by string) ([]*omap.Map, error) {
	rows, err := r.db.Select(ctx, tblGrants, database.SelectOpt{Select: "tai_khoan_id,quyen",
		Filter: database.Eq("cong_ty_id", congTyID) + "&" + database.Eq("nguoi_cap", by) + "&tai_khoan_id=not.is.null",
		Order:  "id.asc", NoScope: true})
	if database.CodeOf(err) == "22P02" {
		return nil, nil
	}
	if err != nil && thieuBang(err) {
		return nil, nil
	}
	return rows, err
}

func (r *pgRepo) DeleteGrant(ctx context.Context, congTyID, uid string) error {
	_, err := r.db.Remove(ctx, tblGrants, grantFilter(congTyID, uid), database.Opt{NoScope: true})
	return err
}

// thieuBang: database chưa chạy migration 0052 (bảng access_grants chưa có).
func thieuBang(err error) bool {
	switch database.CodeOf(err) {
	case "PGRST205", "42P01":
		return true
	}
	m := err.Error()
	return strings.Contains(m, "access_grants") && strings.Contains(m, "does not exist")
}
