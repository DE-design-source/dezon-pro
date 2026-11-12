// Package users: quản lý tài khoản (admin*), nhật ký hoạt động và các hàm dùng chung về users
// (audit, getUserById, userOut, permsArr_) - bản chuyển 1:1 từ server/auth.js.
package users

import (
	"context"
	"math"
	"strings"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// Deps: do internal/server/routes.go truyền vào. CompanyReader và SessionInvalidator gắn sau bằng setter
// (vòng auth <-> users <-> companies, ARCHITECTURE 11.2).
type Deps struct {
	DB  *database.DB
	Cfg *config.Config
}

// Service: nghiệp vụ tài khoản.
type Service struct {
	repo      Repository
	cfg       *config.Config
	companies contracts.CompanyReader
	sessions  contracts.SessionInvalidator
}

var (
	_ contracts.Auditor       = (*Service)(nil)
	_ contracts.UserReader    = (*Service)(nil)
	_ contracts.UserFormatter = (*Service)(nil)
	_ contracts.UserCreator   = (*Service)(nil)
)

// New tạo service.
func New(d Deps) *Service { return &Service{repo: NewRepository(d.DB), cfg: d.Cfg} }

// SetCompanyReader: users <- companies (getCongTy, A:340).
func (s *Service) SetCompanyReader(c contracts.CompanyReader) { s.companies = c }

// SetSessionInvalidator: users <- auth (forgetSession_, A:407, 422, 431).
func (s *Service) SetSessionInvalidator(si contracts.SessionInvalidator) { s.sessions = si }

func (s *Service) forgetSession(uid any) {
	if s.sessions != nil {
		s.sessions.ForgetSession(uid)
	}
}

// Audit = audit (A:59-69) gộp logAudit_ (S:587-594). Nuốt mọi lỗi: nhật ký không được làm hỏng nghiệp vụ.
func (s *Service) Audit(ctx context.Context, a *actor.Actor, action, detail string, congTyID any) {
	defer func() { _ = recover() }()
	var uid any
	username := ""
	if a != nil {
		if jsval.Truthy(a.UID) {
			uid = a.UID
		}
		username = a.U
	}
	row := omap.Of("user_id", uid, "username", username, "action", action, "detail", detail)
	if jsval.Truthy(congTyID) { // login chạy ngoài ngữ cảnh công ty
		row.Set("cong_ty_id", congTyID)
	}
	_ = s.repo.InsertAudit(ctx, row)
}

// PermsArr = permsArr_ (A:72).
func (s *Service) PermsArr(v any) []any {
	out := []any{}
	for _, x := range strings.Split(jsval.StrOr(v, ""), ",") {
		if x = jsval.Trim(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// UserOut = userOut (A:73-77).
func (s *Service) UserOut(r *omap.Map) *omap.Map {
	return omap.Of(
		"id", r.Val("id"), "username", r.Val("username"), "hoTen", jsval.Or(r.Val("ho_ten"), ""),
		"role", jsval.Or(r.Val("role"), "staff"), "perms", s.PermsArr(r.Val("perms")),
		"active", !jsval.StrictEquals(r.Val("active"), false),
		"createdAt", r.Val("created_at"), "lastLogin", r.Val("last_login"),
		"congTyId", jsval.Or(r.Val("cong_ty_id"), nil), "email", jsval.Or(r.Val("email"), ""),
		"phongBan", jsval.Or(r.Val("phong_ban"), ""))
}

// GetByID = getUserById (A:212-215).
func (s *Service) GetByID(ctx context.Context, id any) (*omap.Map, error) {
	return s.repo.UserByID(ctx, id)
}

// phongBanColErr = phongBanColErr_ (A:300-303): chưa có cột phong_ban -> bỏ qua cột, không chặn thao tác.
func phongBanColErr(err error) bool {
	m := err.Error()
	return strings.Contains(m, "phong_ban") && reColErr.MatchString(m)
}

// permsColErr = permsColErr_ (A:304-310).
func permsColErr(err error) error {
	m := err.Error()
	if strings.Contains(m, "perms") && rePermsWhat.MatchString(m) {
		return apperr.New(msgPermsCol)
	}
	return err
}

// joinArr: Array.isArray(v) ? v.join(",") : "".
func joinArr(v any) string {
	if arr, ok := v.([]any); ok {
		return jsval.ToString(arr)
	}
	return ""
}

// AdminListUsers = adminListUsers (A:311-318). Super xem toàn hệ thống, admin chỉ xem công ty mình.
func (s *Service) AdminListUsers(ctx context.Context, a *actor.Actor) ([]any, error) {
	rows, err := s.repo.ListUsers(ctx, a != nil && a.R == "super")
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = s.UserOut(r)
	}
	return out, nil
}

// AdminCreateUser = adminCreateUser (A:319-362).
func (s *Service) AdminCreateUser(ctx context.Context, a *actor.Actor, data *omap.Map) (*omap.Map, error) {
	username := toLowerCase(jsval.Trim(jsval.StrOr(data.Val("username"), "")))
	if !reUsername.MatchString(username) {
		return nil, apperr.New(msgUsername)
	}
	if jsval.Len16(jsval.StrOr(data.Val("password"), "")) < 4 {
		return nil, apperr.New(msgPwMin)
	}
	// Công ty của tài khoản mới: super chọn tay -> công ty đang xem (viewAs) -> công ty của người tạo
	var ctID any
	if a.R == "super" && jsval.Truthy(data.Val("congTyId")) {
		ctID = data.Val("congTyId")
	} else {
		ctID = jsval.Or(tenant.TenantID(ctx), a.CT, nil)
	}
	if !jsval.Truthy(ctID) {
		return nil, apperr.New(msgNoCompany)
	}
	dup, err := s.repo.UsersByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if len(dup) > 0 {
		return nil, apperr.New(`Tên đăng nhập "` + username + `" đã có người dùng — chọn tên khác`)
	}
	// Không vượt số user của gói dịch vụ
	ct, err := s.companies.GetCongTy(ctx, ctID)
	if err != nil {
		return nil, err
	}
	if ct != nil && jsval.ToNumber(ct.Val("gioiHanUser")) > 0 {
		cur, err := s.repo.CompanyUserIDs(ctx, ctID)
		if err != nil {
			return nil, err
		}
		if float64(len(cur)) >= jsval.ToNumber(ct.Val("gioiHanUser")) {
			return nil, apperr.New("Đã đạt giới hạn " + jsval.ToString(ct.Val("gioiHanUser")) + " tài khoản của gói. Liên hệ để nâng gói.")
		}
	}
	// Chỉ super mới tạo được super admin
	role := "staff"
	switch {
	case jsval.StrictEquals(data.Val("role"), "super"):
		if a.R == "super" {
			role = "super"
		}
	case jsval.StrictEquals(data.Val("role"), "admin"):
		role = "admin"
	}
	perms := ""
	if role != "admin" && role != "super" {
		perms = joinArr(data.Val("perms"))
	}
	hash, err := hashSync(jsval.ToString(data.Val("password")))
	if err != nil {
		return nil, err
	}
	row := omap.Of("username", username, "ho_ten", jsval.StrOr(data.Val("hoTen"), ""), "email", jsval.StrOr(data.Val("email"), ""),
		"password_hash", hash, "role", role, "perms", perms, "active", true, "cong_ty_id", ctID)
	if jsval.Trim(jsval.StrOr(data.Val("phongBan"), "")) != "" {
		row.Set("phong_ban", jsval.Trim(jsval.ToString(data.Val("phongBan"))))
	}
	res, err := s.repo.InsertUser(ctx, row)
	if err != nil {
		if !phongBanColErr(err) {
			return nil, permsColErr(err)
		}
		row.Delete("phong_ban")
		if res, err = s.repo.InsertUser(ctx, row); err != nil {
			return nil, err
		}
	}
	s.Audit(ctx, a, "create_user", "Tạo tài khoản "+username+" ("+role+")", nil)
	if len(res) == 0 {
		return nil, apperr.New("Cannot read properties of undefined (reading 'id')")
	}
	return s.UserOut(res[0]), nil
}

// targetUser = targetUser_ (A:364-371): tài khoản đích phải thuộc công ty đang quản lý; chỉ super đụng được super.
func (s *Service) targetUser(ctx context.Context, a *actor.Actor, id any) (*omap.Map, error) {
	u, err := s.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, apperr.New(msgNotFound)
	}
	if a.R != "super" {
		if jsval.StrictEquals(u.Val("role"), "super") ||
			jsval.StrOr(u.Val("cong_ty_id"), "") != jsval.StrOr(tenant.TenantID(ctx), "") {
			return nil, apperr.New(msgNotFound)
		}
	}
	return u, nil
}

// keepLastAdmin = keepLastAdmin_ (A:373-379): không để công ty mất admin đang hoạt động cuối cùng.
func (s *Service) keepLastAdmin(ctx context.Context, u *omap.Map) error {
	if !jsval.StrictEquals(u.Val("role"), "admin") || jsval.StrictEquals(u.Val("active"), false) {
		return nil
	}
	admins, err := s.repo.ActiveAdmins(ctx, u.Val("cong_ty_id"))
	if err != nil {
		return err
	}
	if len(admins) <= 1 {
		return apperr.New(msgLastAdmin)
	}
	return nil
}

// AdminUpdateUser = adminUpdateUser (A:380-410). fields.hasOwnProperty(k) = có khoá, kể cả khi giá trị null.
func (s *Service) AdminUpdateUser(ctx context.Context, a *actor.Actor, id any, fields *omap.Map) (*omap.Map, error) {
	u, err := s.targetUser(ctx, a, id)
	if err != nil {
		return nil, err
	}
	// Node gọi fields.hasOwnProperty(k): khoá tên "hasOwnProperty" trong fields che mất hàm ấy -> TypeError trước khi ghi
	if fields.Has("hasOwnProperty") {
		return nil, apperr.New("fields.hasOwnProperty is not a function")
	}
	patch := omap.New()
	if fields.Has("hoTen") {
		patch.Set("ho_ten", jsval.StrOr(fields.Val("hoTen"), ""))
	}
	if fields.Has("role") {
		// Tài khoản ĐANG là super giữ nguyên super; "super" chỉ super gán được
		var role any
		switch {
		case jsval.StrictEquals(u.Val("role"), "super"):
			role = "super"
		case jsval.StrictEquals(fields.Val("role"), "super"):
			if a.R == "super" {
				role = "super"
			} else {
				role = u.Val("role")
			}
		case jsval.StrictEquals(fields.Val("role"), "admin"):
			role = "admin"
		default:
			role = "staff"
		}
		patch.Set("role", role)
		if role != "admin" && role != "super" {
			if err := s.keepLastAdmin(ctx, u); err != nil {
				return nil, err
			}
		}
	}
	if fields.Has("perms") {
		patch.Set("perms", joinArr(fields.Val("perms")))
	}
	if fields.Has("phongBan") {
		patch.Set("phong_ban", jsval.Trim(jsval.StrOr(fields.Val("phongBan"), "")))
	}
	// Chỉ super được chuyển tài khoản sang công ty khác
	if fields.Has("congTyId") && a.R == "super" {
		patch.Set("cong_ty_id", jsval.Or(fields.Val("congTyId"), nil))
	}
	// Email: đường chỉ bản Go (M14.1) - Node bỏ qua khoá này khi sửa
	if fields.Has("email") {
		email, doi, err := s.checkEmail(ctx, u, fields.Val("email"), patch)
		if err != nil {
			return nil, err
		}
		if doi {
			patch.Set("email", email)
		}
	}
	// Admin thì bỏ giới hạn perms
	if patch.Val("role") == "admin" {
		patch.Set("perms", "")
	}
	if patch.Len() == 0 {
		return omap.Of("ok", true), nil
	}
	res, err := s.repo.UpdateUser(ctx, id, patch)
	if err != nil {
		if !phongBanColErr(err) {
			return nil, permsColErr(err)
		}
		patch.Delete("phong_ban")
		if res, err = s.repo.UpdateUser(ctx, id, patch); err != nil {
			return nil, err
		}
	}
	s.forgetSession(id)
	// res[0] && res[0].username: không có dòng nào -> in "undefined"
	var name any = jsval.Undefined
	if len(res) > 0 {
		name = res[0].Val("username")
	}
	js, _ := omap.MarshalString(patch)
	s.Audit(ctx, a, "update_user", "Sửa tài khoản "+jsval.ToString(name)+" "+js, nil)
	if len(res) > 0 {
		return s.UserOut(res[0]), nil
	}
	return omap.Of("ok", true), nil
}

// UpdateMyProfile (chỉ bản Go, Cài đặt > Tài khoản): người dùng tự sửa họ tên / email của CHÍNH MÌNH. Chỉ nhận khoá hoTen,
// email (khoá khác bỏ qua - vai trò, quyền, phòng ban, công ty vẫn chỉ admin đổi). Họ tên trim, tối đa 100 ký tự (UTF-16, như
// giao diện); email kiểm như admin sửa (checkEmail: dạng, trùng trong công ty). Không đổi gì -> không ghi. Trả UserOut.
func (s *Service) UpdateMyProfile(ctx context.Context, a *actor.Actor, fields *omap.Map) (*omap.Map, error) {
	u, err := s.repo.UserByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	if u == nil || jsval.StrictEquals(u.Val("active"), false) {
		return nil, apperr.New(msgNotFound)
	}
	patch := omap.New()
	if fields.Has("hoTen") {
		ten := jsval.Trim(jsval.StrOr(fields.Val("hoTen"), ""))
		if jsval.Len16(ten) > 100 {
			return nil, apperr.BadRequest("Họ tên tối đa 100 ký tự")
		}
		if ten != jsval.StrOr(u.Val("ho_ten"), "") {
			patch.Set("ho_ten", ten)
		}
	}
	if fields.Has("email") {
		email, doi, err := s.checkEmail(ctx, u, fields.Val("email"), patch)
		if err != nil {
			return nil, err
		}
		if doi {
			patch.Set("email", email)
		}
	}
	if patch.Len() == 0 {
		return s.UserOut(u), nil
	}
	res, err := s.repo.UpdateUser(ctx, a.UID, patch)
	if err != nil {
		return nil, err
	}
	if len(res) == 0 {
		return nil, apperr.New(msgNotFound)
	}
	s.forgetSession(a.UID)
	js, _ := omap.MarshalString(patch)
	s.Audit(ctx, a, "update_profile", "Tự sửa hồ sơ "+js, nil)
	return s.UserOut(res[0]), nil
}

// checkEmail (M14.1): trim + chữ thường; rỗng = xoá; sai dạng -> msgEmailBad; trùng tài khoản khác trong CÙNG công ty
// (công ty sau khi sửa) -> msgEmailDup. Trùng giữa các công ty khác nhau được phép (đăng nhập chọn theo loginScore).
// Email gửi lên trùng email đang lưu (không phân biệt hoa thường) = KHÔNG đổi: không kiểm dạng, không ghi (doi = false),
// để tài khoản có email cũ sai dạng (tạo qua adminCreateUser / createCongTy lưu nguyên văn) vẫn sửa được trường khác;
// chỉ khi đồng thời chuyển công ty mới kiểm trùng ở công ty mới.
func (s *Service) checkEmail(ctx context.Context, u *omap.Map, v any, patch *omap.Map) (email string, doi bool, err error) {
	email = toLowerCase(jsval.Trim(jsval.StrOr(v, "")))
	ct := u.Val("cong_ty_id")
	if patch.Has("cong_ty_id") {
		ct = patch.Val("cong_ty_id")
	}
	doiCt := jsval.StrOr(ct, "") != jsval.StrOr(u.Val("cong_ty_id"), "")
	old := toLowerCase(jsval.Trim(jsval.StrOr(u.Val("email"), "")))
	if email == old {
		if email != "" && doiCt {
			if err = s.emailDup(ctx, email, ct, u.Val("id")); err != nil {
				return "", false, err
			}
		}
		return email, false, nil
	}
	if email == "" {
		return "", true, nil
	}
	if !reEmail.MatchString(email) {
		return "", false, apperr.New(msgEmailBad)
	}
	if err = s.emailDup(ctx, email, ct, u.Val("id")); err != nil {
		return "", false, err
	}
	return email, true, nil
}

// emailDup: lỗi msgEmailDup nếu tài khoản khác exceptID trong công ty ct đã dùng email.
func (s *Service) emailDup(ctx context.Context, email string, ct, exceptID any) error {
	dup, err := s.repo.UserByEmailInCompanyExcept(ctx, email, ct, exceptID)
	if err != nil {
		return err
	}
	if dup != nil {
		return apperr.New(msgEmailDup)
	}
	return nil
}

// AdminSetPassword = adminSetPassword (A:411-417).
func (s *Service) AdminSetPassword(ctx context.Context, a *actor.Actor, id any, newPassword any) (*omap.Map, error) {
	if jsval.Len16(jsval.StrOr(newPassword, "")) < 4 {
		return nil, apperr.New(msgPwMin)
	}
	u, err := s.targetUser(ctx, a, id)
	if err != nil {
		return nil, err
	}
	hash, err := hashSync(jsval.ToString(newPassword))
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.UpdateUser(ctx, id, omap.Of("password_hash", hash)); err != nil {
		return nil, err
	}
	// M1.2: mật khẩu cũ có thể đã lộ -> thu hồi mọi phiên của tài khoản (token kẻ gian đang giữ hết hiệu lực ngay);
	// admin tự đặt lại cho chính mình thì giữ phiên đang dùng.
	if s.sessions != nil {
		keep := ""
		if a != nil && jsval.ToString(a.UID) == jsval.ToString(u.Val("id")) {
			keep = a.SID
		}
		if err := s.sessions.RevokeUserSessions(ctx, u.Val("id"), keep); err != nil {
			return nil, err
		}
	}
	s.Audit(ctx, a, "reset_password", "Đặt lại mật khẩu cho "+jsval.ToString(u.Val("username")), nil)
	return omap.Of("ok", true), nil
}

// AdminSetActive = adminSetActive (A:418-425).
func (s *Service) AdminSetActive(ctx context.Context, a *actor.Actor, id any, active any) (*omap.Map, error) {
	u, err := s.targetUser(ctx, a, id)
	if err != nil {
		return nil, err
	}
	on := jsval.Truthy(active)
	if !on {
		if err := s.keepLastAdmin(ctx, u); err != nil {
			return nil, err
		}
	}
	if _, err := s.repo.UpdateUser(ctx, id, omap.Of("active", on)); err != nil {
		return nil, err
	}
	s.forgetSession(id)
	action, verb := "lock_user", "Khóa "
	if on {
		action, verb = "unlock_user", "Mở khóa "
	}
	s.Audit(ctx, a, action, verb+jsval.ToString(u.Val("username")), nil)
	return omap.Of("ok", true), nil
}

// AdminDeleteUser = adminDeleteUser (A:426-434).
func (s *Service) AdminDeleteUser(ctx context.Context, a *actor.Actor, id any) (*omap.Map, error) {
	u, err := s.targetUser(ctx, a, id)
	if err != nil {
		return nil, err
	}
	if jsval.StrictEquals(u.Val("id"), a.UID) {
		return nil, apperr.New(msgSelfDelete)
	}
	if err := s.keepLastAdmin(ctx, u); err != nil {
		return nil, err
	}
	if err := s.repo.DeleteUser(ctx, id); err != nil {
		return nil, err
	}
	s.forgetSession(id)
	s.Audit(ctx, a, "delete_user", "Xóa tài khoản "+jsval.ToString(u.Val("username")), nil)
	return omap.Of("ok", true), nil
}

// auditLimit = Math.min(Number(limit) || 200, 1000) rồi Math.floor như supa.select (supa.js:373-378).
// ok = false: Node chạy "limit 0" (0 < giới hạn < 1) -> không có dòng nào.
// text != "": số âm ngoài khoảng int32, Node ghép nguyên chữ ấy vào câu SQL ("-1e+30", "-Infinity").
func auditLimit(limit any) (n int, text string, ok bool) {
	lim := math.Min(jsval.NumOr(limit, 200), 1000)
	lim = math.Floor(lim)
	if lim == 0 {
		return 0, "", false
	}
	if lim < math.MinInt32 {
		return math.MinInt32, jsval.NumberToString(lim), true
	}
	return int(lim), "", true
}

// GetAuditLog = getAuditLog (A:444-447). Không nhận actor (không nằm trong ACTOR_FNS).
func (s *Service) GetAuditLog(ctx context.Context, limit any) ([]any, error) {
	n, text, ok := auditLimit(limit)
	if !ok {
		return []any{}, nil
	}
	rows, err := s.repo.AuditLog(ctx, n)
	if err != nil {
		// Lỗi "LIMIT âm" của số đã kẹp: Postgres bên Node báo lỗi khác với chữ số gốc (bigint out of range,
		// column "infinity" does not exist) -> hỏi lại Postgres bằng đúng chữ ấy. Lỗi xảy ra trước đó thì giữ nguyên.
		if text != "" && database.CodeOf(err) == "2201W" {
			if e := s.repo.LimitError(ctx, text); e != nil {
				return nil, e
			}
		}
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = omap.Of("id", r.Val("id"), "username", r.Val("username"), "action", r.Val("action"),
			"detail", r.Val("detail"), "at", r.Val("created_at"))
	}
	return out, nil
}
