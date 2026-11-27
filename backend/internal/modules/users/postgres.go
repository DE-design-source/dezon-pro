package users

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

type pgRepo struct{ db *database.DB }

// NewRepository: Repository trên platform/database.
func NewRepository(db *database.DB) Repository { return &pgRepo{db: db} }

func (r *pgRepo) UserByID(ctx context.Context, id any) (*omap.Map, error) {
	rows, err := r.db.Select(ctx, "users", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1, NoScope: true})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (r *pgRepo) ListUsers(ctx context.Context, noScope bool) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Order: "created_at.asc", Limit: 500, NoScope: noScope})
}

func (r *pgRepo) UsersByUsername(ctx context.Context, username string) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Filter: database.Eq("username", username), Limit: 1, NoScope: true})
}

func (r *pgRepo) CompanyUserIDs(ctx context.Context, congTyID any) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Select: "id", Filter: database.Eq("cong_ty_id", congTyID), Limit: 1000, NoScope: true})
}

func (r *pgRepo) ActiveAdmins(ctx context.Context, congTyID any) ([]*omap.Map, error) {
	f := "cong_ty_id=is.null"
	if jsval.Truthy(congTyID) {
		f = database.Eq("cong_ty_id", congTyID)
	}
	return r.db.Select(ctx, "users", database.SelectOpt{Select: "id", Filter: "role=eq.admin&active=eq.true&" + f, Limit: 2, NoScope: true})
}

// UserByEmailInCompanyExcept: ilike để bỏ qua hoa thường, ký tự đại diện của LIKE được thoát; "*" (bộ lọc đổi thành
// "%") thay bằng "_" rồi so lại đúng chữ ở Go nên không khớp nhầm.
func (r *pgRepo) UserByEmailInCompanyExcept(ctx context.Context, email string, congTyID, exceptID any) (*omap.Map, error) {
	pat := strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`, "*", "_").Replace(email)
	ct := "cong_ty_id=is.null"
	if jsval.Truthy(congTyID) {
		ct = database.Eq("cong_ty_id", congTyID)
	}
	f := "email=ilike." + jsval.EncodeURIComponent(pat) + "&" + ct + "&id=neq." + jsval.EncodeURIComponent(exceptID)
	rows, err := r.db.Select(ctx, "users", database.SelectOpt{Select: "id,email", Filter: f, Limit: 50, NoScope: true})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if toLowerCase(jsval.Trim(jsval.StrOr(row.Val("email"), ""))) == email {
			return row, nil
		}
	}
	return nil, nil
}

func (r *pgRepo) CompanyAdmins(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "users", database.SelectOpt{Select: "id,duoc_duyet_sp", Filter: "role=eq.admin", Order: "created_at.asc", Limit: 500})
}

func (r *pgRepo) InsertUser(ctx context.Context, row *omap.Map) ([]*omap.Map, error) {
	return r.db.InsertOne(ctx, "users", row, database.Opt{NoScope: true})
}

func (r *pgRepo) UpdateUser(ctx context.Context, id any, patch *omap.Map) ([]*omap.Map, error) {
	return r.db.Update(ctx, "users", database.Eq("id", id), patch, database.Opt{NoScope: true})
}

func (r *pgRepo) DeleteUser(ctx context.Context, id any) error {
	_, err := r.db.Remove(ctx, "users", database.Eq("id", id), database.Opt{NoScope: true})
	return err
}

func (r *pgRepo) InsertAudit(ctx context.Context, row *omap.Map) error {
	_, err := r.db.InsertOne(ctx, "audit_log", row)
	return err
}

func (r *pgRepo) AuditLog(ctx context.Context, limit int) ([]*omap.Map, error) {
	return r.db.Select(ctx, "audit_log", database.SelectOpt{Order: "created_at.desc", Limit: limit})
}

var reLimitText = regexp.MustCompile(`^-(Infinity|[0-9]+(\.[0-9]+)?(e\+[0-9]+)?)$`)

// LimitError: SelectOpt.Limit là int nên không chở được số ngoài khoảng; chạy câu thử "limit <text>" để lấy đúng
// lỗi của Postgres rồi bọc theo dạng "DB GET audit_log -> 400 {...}" như database.Select.
func (r *pgRepo) LimitError(ctx context.Context, text string) error {
	if !reLimitText.MatchString(text) { // text ghép thẳng vào SQL: chỉ nhận chữ số do Number -> String sinh ra
		return nil
	}
	pool, err := r.db.Pool()
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, "select 1 limit "+text)
	var pe *pgconn.PgError
	if !errors.As(err, &pe) {
		return err
	}
	nz := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	js, _ := omap.MarshalString(omap.Of("code", pe.Code, "details", nz(pe.Detail), "hint", nz(pe.Hint), "message", pe.Message))
	return &database.Error{Msg: "DB GET audit_log -> 400 " + js, Code: pe.Code, Status: 400}
}
