package hr

import (
	"context"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// Phân quyền HR (migration 0028): tài khoản đăng nhập gắn với 1 hồ sơ nhân sự (hr_nhan_vien.tai_khoan_id) có vai trò HR.
// Admin / super của công ty luôn là sysadmin. Vai trò -> phạm vi dữ liệu (all / dept / self) + ma trận quyền theo phân hệ
// (hr_bao_mat, thiếu thì DefaultPerms). Mọi lệnh HR qua gate(): kiểm tab hr, quyền phân hệ; dữ liệu đọc lọc theo phạm vi.

var (
	allActions = []string{"view", "create", "edit", "delete", "approve", "export"}
	hrModules  = []string{"employees", "attendance", "payroll", "recruit", "performance", "security"}
	hrRoles    = map[string]string{"sysadmin": "all", "hradmin": "all", "manager": "dept", "employee": "self"}
)

// DefaultPerms = DEFAULT_PERMS của giao diện (hrData2.js), dùng khi công ty chưa lưu ma trận quyền.
func DefaultPerms() *omap.Map {
	all := func() []any {
		out := []any{}
		for _, a := range allActions {
			out = append(out, a)
		}
		return out
	}
	l := func(xs ...string) []any {
		out := []any{}
		for _, x := range xs {
			out = append(out, x)
		}
		return out
	}
	return omap.Of(
		"hradmin", omap.Of("employees", all(), "attendance", all(), "payroll", all(), "recruit", all(), "performance", all(), "security", l("view", "export")),
		"manager", omap.Of("employees", l("view", "export"), "attendance", l("view", "approve", "export"), "payroll", l(), "recruit", l("view", "edit", "approve"),
			"performance", l("view", "create", "edit", "approve"), "security", l()),
		"employee", omap.Of("employees", l("view"), "attendance", l("view", "create"), "payroll", l("view"), "recruit", l(), "performance", l("view", "edit"), "security", l()),
	)
}

// access: người đang dùng HR.
type access struct {
	a     *actor.Actor
	role  string
	scope string    // all / dept / self
	me    *omap.Map // hồ sơ gắn với tài khoản (nil với admin chưa gắn hồ sơ)
	perms *omap.Map // ma trận quyền của công ty
	mask  bool      // ẩn lương mặc định
}

func (x *access) meID() float64 {
	if x.me == nil {
		return -1
	}
	return jsval.ToNumber(x.me.Val("id"))
}

// can: quyền thao tác trên phân hệ.
func (x *access) can(module, action string) bool {
	if x.role == "sysadmin" {
		return true
	}
	r, _ := x.perms.Val(x.role).(*omap.Map)
	if r == nil {
		return false
	}
	acts, _ := r.Val(module).([]any)
	for _, v := range acts {
		if jsval.Str(v) == action {
			return true
		}
	}
	return false
}

// sees: nhân sự (dòng hr_nhan_vien) nằm trong phạm vi dữ liệu.
func (x *access) sees(e *omap.Map) bool {
	switch x.scope {
	case "all":
		return true
	case "dept":
		return x.me != nil && jsval.Str(e.Val("phong_ban")) == jsval.Str(x.me.Val("phong_ban"))
	}
	return jsval.ToNumber(e.Val("id")) == x.meID()
}

// deptOK: dữ liệu gắn với phòng ban (JD, tin tuyển dụng) nằm trong phạm vi: toàn công ty, hoặc đúng phòng của mình.
func (x *access) deptOK(dept any) bool {
	return x.scope == "all" || (x.me != nil && jsval.Str(dept) != "" && jsval.Str(dept) == jsval.Str(x.me.Val("phong_ban")))
}

func (x *access) deptNeed(dept any) error {
	if !x.deptOK(dept) {
		return apperr.Forbidden("Chỉ thao tác được tuyển dụng của phòng ban mình")
	}
	return nil
}

// need: lỗi 403 khi thiếu quyền.
func (x *access) need(module, action string) error {
	if !x.can(module, action) {
		return apperr.Forbidden("Vai trò HR của bạn không có quyền này")
	}
	return nil
}

// needAll: thao tác cấp công ty (cơ cấu, ca, cấu hình lương...): như giao diện gốc, chỉ cần quyền theo ma trận.
func (x *access) needAll(module, action string) error {
	return x.need(module, action)
}

// meOut: thông tin quyền gửi cho giao diện.
func (x *access) meOut() *omap.Map {
	perms := omap.New()
	for _, m := range hrModules {
		acts := []any{}
		for _, a := range allActions {
			if x.can(m, a) {
				acts = append(acts, a)
			}
		}
		perms.Set(m, acts)
	}
	var eid any
	if x.me != nil {
		eid = x.me.Val("id")
	}
	return omap.Of("role", x.role, "scope", x.scope, "employeeId", eid, "perms", perms, "maskSalary", x.mask)
}

// gate: allow (tab hr) + vai trò; module rỗng = chỉ cần vào được HR (đọc lọc theo phạm vi sau).
func (s *Service) gate(ctx context.Context, a *actor.Actor, module, action string) (*access, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	x := &access{a: a, perms: DefaultPerms(), mask: true}
	rows, err := s.db.Select(ctx, "hr_bao_mat", database.SelectOpt{Select: "quyen,an_luong", Limit: 1})
	if err != nil {
		return nil, err
	}
	if len(rows) > 0 {
		if p, ok := rows[0].Val("quyen").(*omap.Map); ok {
			x.perms = p
		}
		x.mask = jsval.Truthy(rows[0].Val("an_luong"))
	}
	if jsval.Truthy(a.UID) {
		me, err := s.db.Select(ctx, "hr_nhan_vien", database.SelectOpt{Filter: database.Eq("tai_khoan_id", a.UID), Limit: 1})
		if err != nil {
			return nil, err
		}
		if len(me) > 0 {
			x.me = me[0]
		}
	}
	switch {
	case a.IsSuper() || a.IsAdmin():
		x.role = "sysadmin"
	case x.me != nil:
		x.role = jsval.Str(x.me.Val("vai_tro_hr"))
	default:
		return nil, apperr.Forbidden("Tài khoản chưa gắn với hồ sơ nhân sự - nhờ quản trị HR gắn ở Phân quyền & bảo mật")
	}
	x.scope = hrRoles[x.role]
	if x.scope == "" {
		return nil, apperr.Forbidden("Vai trò HR không hợp lệ")
	}
	if module != "" {
		if err := x.need(module, action); err != nil {
			return nil, err
		}
	}
	return x, nil
}

// gateAll: gate + thao tác cấp công ty (phạm vi toàn công ty).
func (s *Service) gateAll(ctx context.Context, a *actor.Actor, module, action string) (*access, error) {
	x, err := s.gate(ctx, a, module, action)
	if err != nil {
		return nil, err
	}
	if err := x.needAll(module, action); err != nil {
		return nil, err
	}
	return x, nil
}

// target: nhân sự có id phải tồn tại trong công ty và trong phạm vi; trả dòng của người đó.
func (s *Service) target(ctx context.Context, x *access, id any) (*omap.Map, error) {
	e, err := s.getEmp(ctx, id)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, apperr.BadRequest("Không tìm thấy nhân sự")
	}
	if !x.sees(e) {
		return nil, apperr.Forbidden("Nhân sự ngoài phạm vi được phân quyền")
	}
	return e, nil
}

// scopedIDs: id nhân sự trong phạm vi (nil = toàn công ty).
func (s *Service) scopedIDs(ctx context.Context, x *access) (map[string]bool, error) {
	if x.scope == "all" {
		return nil, nil
	}
	rows, err := s.db.Select(ctx, "hr_nhan_vien", database.SelectOpt{Select: "id,phong_ban", Limit: 10000})
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for _, e := range rows {
		if x.sees(e) {
			ids[jsval.Str(e.Val("id"))] = true
		}
	}
	return ids, nil
}

// audit: ghi nhật ký HR vào audit_logs (action hr.<phân hệ>.<thao tác>). Nuốt lỗi: nhật ký không làm hỏng nghiệp vụ.
func (s *Service) audit(ctx context.Context, x *access, module, action, detail string) {
	defer func() { _ = recover() }()
	var uid any
	if jsval.Truthy(x.a.UID) {
		uid = x.a.UID
	}
	_, _ = s.db.InsertOne(ctx, "audit_log", omap.Of("user_id", uid, "username", x.a.U, "action", "hr."+module+"."+action, "detail", detail))
}

// ---------- Phân quyền & bảo mật ----------

// SecurityState: ma trận quyền, ẩn lương, tài khoản của công ty (để gắn hồ sơ), 500 dòng nhật ký HR mới nhất.
func (s *Service) SecurityState(ctx context.Context, a *actor.Actor) (any, error) {
	x, err := s.gate(ctx, a, "security", "view")
	if err != nil {
		return nil, err
	}
	users, err := s.db.Select(ctx, "users", database.SelectOpt{Select: "id,username,ho_ten,role,active", Order: "username.asc", Limit: 2000})
	if err != nil {
		return nil, err
	}
	accs := make([]any, len(users))
	for i, u := range users {
		accs[i] = omap.Of("id", u.Val("id"), "username", u.Val("username"), "name", u.Val("ho_ten"), "role", u.Val("role"), "active", !jsval.StrictEquals(u.Val("active"), false))
	}
	logs, err := s.db.Select(ctx, "audit_log", database.SelectOpt{Filter: "action=like.hr.*", Order: "created_at.desc", Limit: 500})
	if err != nil {
		return nil, err
	}
	lOut := make([]any, len(logs))
	for i, l := range logs {
		lOut[i] = omap.Of("id", l.Val("id"), "at", l.Val("created_at"), "user", l.Val("username"), "action", l.Val("action"), "detail", l.Val("detail"))
	}
	ui, err := s.uiState(ctx)
	if err != nil {
		return nil, err
	}
	// nhật ký do giao diện ghi (POST /hr/audit): mỗi dòng là 1 mục như INITIAL_AUDIT của giao diện
	uiLogs, err := s.db.Select(ctx, "audit_log", database.SelectOpt{Filter: database.Eq("action", "hr.ui"), Order: "created_at.desc", Limit: 1000})
	if err != nil {
		return nil, err
	}
	uiOut := []any{}
	for _, l := range uiLogs {
		if m, err := omap.DecodeString(jsval.Str(l.Val("detail"))); err == nil {
			if mm, ok := m.(*omap.Map); ok {
				uiOut = append(uiOut, mm.Set("id", l.Val("id")))
			}
		}
	}
	return omap.Of("perms", x.perms, "maskSalary", x.mask, "accounts", accs, "audit", lOut, "ui", ui, "uiAudit", uiOut), nil
}

// uiState: tài liệu cài đặt bảo mật của giao diện (hr_bao_mat.giao_dien); chưa lưu = {}.
func (s *Service) uiState(ctx context.Context) (any, error) {
	rows, err := s.db.Select(ctx, "hr_bao_mat", database.SelectOpt{Select: "giao_dien", Limit: 1})
	if err != nil || len(rows) == 0 {
		return omap.New(), err
	}
	if m, ok := rows[0].Val("giao_dien").(*omap.Map); ok {
		return m, nil
	}
	return omap.New(), nil
}

const maxAuditEntryBytes = 4 * 1024

// AddAudit: {entries: [{time, user, role, module, action, target, ip, warn?}]} - nhật ký thao tác do giao diện ghi
// (audit_logs, action hr.ui, detail = JSON của mục). Ai vào được HR cũng ghi được nhật ký của mình.
func (s *Service) AddAudit(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	if _, err := s.gate(ctx, a, "", ""); err != nil {
		return nil, err
	}
	entries := list(b, "entries")
	if len(entries) == 0 || len(entries) > 200 {
		return nil, apperr.BadRequest("Cần 1 đến 200 dòng nhật ký")
	}
	rows := []*omap.Map{}
	for _, e := range entries {
		e = e.Clone()
		e.Delete("id")
		j, err := omap.Marshal(e)
		if err != nil || len(j) > maxAuditEntryBytes {
			return nil, apperr.BadRequest("Dòng nhật ký không hợp lệ")
		}
		var uid any
		if jsval.Truthy(a.UID) {
			uid = a.UID
		}
		rows = append(rows, omap.Of("user_id", uid, "username", a.U, "action", "hr.ui", "detail", string(j)))
	}
	if _, err := s.db.Insert(ctx, "audit_log", rows); err != nil {
		return nil, err
	}
	return okRes, nil
}

// SaveSecurity: {perms?, maskSalary?, ui? (cài đặt bảo mật của giao diện)} - chỉ System Admin (security edit).
func (s *Service) SaveSecurity(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "security", "edit")
	if err != nil {
		return nil, err
	}
	p := omap.Of("nguoi_sua", a.UID, "cap_nhat", s.nowISO())
	if b.Has("perms") {
		in, ok := b.Val("perms").(*omap.Map)
		if !ok {
			return nil, apperr.BadRequest("Ma trận quyền phải là object")
		}
		valid := map[string]bool{}
		for _, a := range allActions {
			valid[a] = true
		}
		clean := omap.New()
		for _, role := range []string{"hradmin", "manager", "employee"} {
			rm, _ := in.Val(role).(*omap.Map)
			r := omap.New()
			for _, m := range hrModules {
				acts := []any{}
				if rm != nil {
					arr, _ := rm.Val(m).([]any)
					for _, v := range arr {
						if valid[jsval.Str(v)] {
							acts = append(acts, jsval.Str(v))
						}
					}
				}
				r.Set(m, acts)
			}
			clean.Set(role, r)
		}
		p.Set("quyen", clean)
	}
	if b.Has("maskSalary") {
		p.Set("an_luong", jsval.Truthy(b.Val("maskSalary")))
	}
	if b.Has("ui") {
		ui, ok := b.Val("ui").(*omap.Map)
		if j, err := omap.Marshal(ui); !ok || err != nil || len(j) > maxConfigBytes {
			return nil, apperr.BadRequest("Cài đặt bảo mật phải là object (tối đa 64 KB)")
		}
		p.Set("giao_dien", ui)
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		cur, err := s.db.Select(ctx, "hr_bao_mat", database.SelectOpt{Select: "id", Limit: 1})
		if err != nil {
			return err
		}
		if len(cur) > 0 {
			_, err = s.db.Update(ctx, "hr_bao_mat", database.Eq("id", cur[0].Val("id")), p)
			return err
		}
		if !p.Has("quyen") {
			p.Set("quyen", x.perms)
		}
		_, err = s.db.InsertOne(ctx, "hr_bao_mat", p)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "security", "edit", "Cập nhật phân quyền / cài đặt bảo mật HR")
	return okRes, nil
}

// SetUserRole: {empId, role?, userId? (rỗng = bỏ gắn)} - gắn tài khoản với hồ sơ và đặt vai trò HR (security edit).
func (s *Service) SetUserRole(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "security", "edit")
	if err != nil {
		return nil, err
	}
	e, err := s.getEmp(ctx, jsval.ToNumber(b.Val("empId")))
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, apperr.BadRequest("Không tìm thấy nhân sự")
	}
	p := omap.Of("cap_nhat", s.nowISO())
	detail := "Hồ sơ " + jsval.Str(e.Val("ma_nv"))
	if b.Has("role") {
		r := str(b, "role")
		if hrRoles[r] == "" {
			return nil, apperr.BadRequest("Vai trò HR không hợp lệ")
		}
		p.Set("vai_tro_hr", r)
		detail += ": vai trò " + r
	}
	if b.Has("userId") {
		uid := str(b, "userId")
		if uid == "" {
			p.Set("tai_khoan_id", nil)
			detail += ": bỏ gắn tài khoản"
		} else {
			// users thuộc TenantTables: tài khoản công ty khác không đọc được
			u, err := s.db.Select(ctx, "users", database.SelectOpt{Select: "id,username", Filter: database.Eq("id", uid), Limit: 1})
			if err != nil {
				return nil, err
			}
			if len(u) == 0 {
				return nil, apperr.BadRequest("Không tìm thấy tài khoản trong công ty")
			}
			p.Set("tai_khoan_id", uid)
			detail += ": gắn tài khoản " + jsval.Str(u[0].Val("username"))
		}
	}
	if _, err := s.db.Update(ctx, "hr_nhan_vien", database.Eq("id", e.Val("id")), p); err != nil {
		if database.CodeOf(err) == "23505" {
			return nil, apperr.BadRequest("Tài khoản này đã gắn với hồ sơ khác")
		}
		return nil, err
	}
	s.audit(ctx, x, "security", "role", detail)
	return okRes, nil
}

// ResetData: xoá toàn bộ dữ liệu HR của công ty đang đăng nhập (nạp lại dữ liệu mẫu demo). Chỉ admin của 1 công ty
// (super phải chọn "xem như công ty"); thiếu ngữ cảnh công ty thì từ chối để không xoá xuyên công ty.
func (s *Service) ResetData(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	if _, err := s.gate(ctx, a, "", ""); err != nil {
		return nil, err
	}
	if s.prod {
		return nil, apperr.Forbidden("Không xoá dữ liệu HR trên production (chỉ dùng khi nạp dữ liệu mẫu ở máy phát triển)")
	}
	if !a.IsAdmin() || !tenant.Scoped(ctx) {
		return nil, apperr.Forbidden("Chỉ admin công ty xoá được dữ liệu HR")
	}
	if str(b, "confirm") != "XOA_DU_LIEU_HR" {
		return nil, apperr.BadRequest("Thiếu xác nhận confirm = XOA_DU_LIEU_HR")
	}
	err := s.db.Tx(ctx, func(ctx context.Context) error {
		// bảng gốc theo công ty; bảng con (chấm công, đơn, ứng viên...) xoá theo khoá ngoại cascade
		for _, t := range []string{"hr_tin_tuyen", "hr_jd", "hr_muc_tieu", "hr_lo_trinh", "hr_khoa_hoc", "hr_ky_luong", "hr_cau_hinh_luong",
			"hr_nhan_vien", "hr_don_vi", "hr_ca", "hr_dia_diem", "hr_bao_mat"} {
			if _, err := s.db.Remove(ctx, t, ""); err != nil {
				return err
			}
		}
		_, err := s.db.Remove(ctx, "audit_log", "action=like.hr.*")
		return err
	})
	if err != nil {
		return nil, err
	}
	return okRes, nil
}
