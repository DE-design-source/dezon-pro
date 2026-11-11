// Package hr: trang HR (SiteFlow /cham-cong) - cơ cấu tổ chức, hồ sơ nhân sự, kiêm nhiệm.
// Tính năng mới, chỉ bản Go: REST /api/v1/hr/... (không có hàm /api/:fn). Bảng: hr_don_vi, hr_nhan_vien, hr_kiem_nhiem (migration 0024).
// Mọi lệnh ghi trả lại toàn bộ dữ liệu HR của công ty (giao diện thay state một lần, không tự ráp lại).
package hr

import (
	"context"
	"regexp"
	"strings"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// Tab = khoá quyền trong users.perms và cong_ty.tinh_nang (giao diện: WORK_TABS).
const Tab = "hr"

var (
	unitKinds = map[string]bool{"governance": true, "board": true, "exec": true, "dept": true, "subsidiary": true}
	statuses  = map[string]bool{"probation": true, "active": true, "left": true}
	unitKeyRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{0,59}$`)
	isoDate   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	vn        = time.FixedZone("ICT", 7*3600)
)

// Khoá của object nhân sự (giao diện) -> cột (tên trong code). Khoá khác (trừ id) vào tài liệu chi_tiet.
var empText = map[string]string{"gender": "gioi_tinh", "position": "chuc_danh", "level": "cap_bac", "site": "noi_lam_viec",
	"contractType": "loai_hd", "phone": "sdt", "email": "email"}
var empCols = map[string]bool{"id": true, "code": true, "name": true, "dob": true, "dept": true, "status": true, "joinDate": true,
	"leaveDate": true, "managerId": true, "salary": true, "userId": true, "hrRole": true, "candidateId": true}

const (
	maxDetailKeys  = 100
	maxDetailBytes = 512 * 1024
	groupHolding   = "__holding" // = HOLDING_KEY / MOTHER_KEY của hrData.js
	groupMother    = "__mother"
)

// Deps: do internal/server/routes.go truyền vào.
type Deps struct {
	DB      *database.DB
	Cfg     *config.Config
	Users   contracts.UserReader
	UserFmt contracts.UserFormatter
}

// Service: nghiệp vụ HR.
type Service struct {
	db      *database.DB
	users   contracts.UserReader
	userFmt contracts.UserFormatter
	now     func() time.Time
	prod    bool // NODE_ENV=production: tắt ResetData
}

// New tạo service.
func New(d Deps) *Service {
	return &Service{db: d.DB, users: d.Users, userFmt: d.UserFmt, now: time.Now, prod: d.Cfg != nil && d.Cfg.NodeEnv == "production"}
}

// allow: giống canTab('hr') của giao diện (xem sales.allow).
func (s *Service) allow(ctx context.Context, a *actor.Actor) error {
	if a == nil {
		return apperr.E(401, "Chưa đăng nhập", "NOAUTH")
	}
	t := tenant.TenantID(ctx)
	if !jsval.Truthy(t) {
		if a.IsSuper() {
			return apperr.BadRequest("Chọn công ty (Xem như công ty) để dùng HR")
		}
		return apperr.Forbidden("Tài khoản chưa gắn với công ty nào")
	}
	if a.IsSuper() {
		return nil
	}
	// NoScope: bảng companies không thuộc TenantTables; điều kiện id = công ty đang làm việc ghi ngay trong filter
	cts, err := s.db.Select(ctx, "cong_ty", database.SelectOpt{Select: "tinh_nang", Filter: database.Eq("id", t), Limit: 1, NoScope: true})
	if err != nil {
		return err
	}
	if len(cts) > 0 && !coTinhNang(cts[0].Val("tinh_nang"), Tab) {
		return apperr.Forbidden("Công ty chưa được cấp tính năng HR")
	}
	if a.IsAdmin() {
		return nil
	}
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return err
	}
	if u != nil {
		for _, p := range s.userFmt.PermsArr(u.Val("perms")) {
			if p == Tab {
				return nil
			}
		}
	}
	return apperr.Forbidden("Tài khoản không có quyền vào HR")
}

// coTinhNang = ctHasFeature_: danh sách tính năng rỗng = được mọi tab.
func coTinhNang(v any, tab string) bool {
	co := false
	for _, x := range strings.Split(jsval.Str(v), ",") {
		if x = jsval.Trim(x); x != "" {
			if x == tab {
				return true
			}
			co = true
		}
	}
	return !co
}

func (s *Service) nowISO() string { return s.now().UTC().Format(time.RFC3339Nano) }

// ---------- đọc ----------

// Load: toàn bộ dữ liệu HR của công ty, đúng dạng state của trang (units, heads, members, employees).
func (s *Service) Load(ctx context.Context, a *actor.Actor) (any, error) {
	x, err := s.gate(ctx, a, "", "")
	if err != nil {
		return nil, err
	}
	return s.state(ctx, x)
}

// state: dữ liệu HR theo phạm vi của người dùng (+ me = vai trò / quyền); không có quyền xem lương thì bỏ số lương.
func (s *Service) state(ctx context.Context, x *access) (*omap.Map, error) {
	units, err := s.db.Select(ctx, "hr_don_vi", database.SelectOpt{Order: "id.asc", Limit: 2000})
	if err != nil {
		return nil, err
	}
	emps, err := s.db.Select(ctx, "hr_nhan_vien", database.SelectOpt{Order: "id.asc", Limit: 10000})
	if err != nil {
		return nil, err
	}
	mems, err := s.db.Select(ctx, "hr_kiem_nhiem", database.SelectOpt{Order: "id.asc", Limit: 20000})
	if err != nil {
		return nil, err
	}
	keyOf := map[float64]string{}
	uOut, heads := make([]any, len(units)), omap.New()
	for i, u := range units {
		k := jsval.Str(u.Val("ma"))
		keyOf[jsval.ToNumber(u.Val("id"))] = k
		uOut[i] = unitOut(u)
		if h := u.Val("truong_don_vi"); !jsval.IsNullish(h) {
			heads.Set(k, h)
		}
	}
	members := omap.New()
	for _, m := range mems {
		k := keyOf[jsval.ToNumber(m.Val("don_vi_id"))]
		list, _ := members.Val(k).([]any)
		mo := omap.Of("id", m.Val("nhan_vien_id"), "pct", jsval.ToNumber(m.Val("ty_le_pct")), "title", m.Val("chuc_vu"))
		if x.can("payroll", "view") { // phụ cấp kiêm nhiệm là số tiền
			mo.Set("allowance", jsval.ToNumber(m.Val("phu_cap")))
		}
		members.Set(k, append(list, mo))
	}
	// như giao diện gốc: danh sách đủ người cho sơ đồ tổ chức; ngoài phạm vi (hoặc không có quyền xem hồ sơ) chỉ thông tin công khai
	eOut := []any{}
	for _, e := range emps {
		o := empOut(e)
		if !x.can("employees", "view") || !x.sees(e) {
			o = omap.Of("id", o.Val("id"), "code", o.Val("code"), "name", o.Val("name"), "dept", o.Val("dept"), "position", o.Val("position"),
				"level", o.Val("level"), "status", o.Val("status"), "managerId", o.Val("managerId"), "site", o.Val("site"),
				"joinDate", o.Val("joinDate"), "leaveDate", o.Val("leaveDate"), "gender", o.Val("gender"))
		} else if !x.can("payroll", "view") {
			hidePay(o)
		}
		eOut = append(eOut, o)
	}
	return omap.Of("units", uOut, "heads", heads, "members", members, "employees", eOut, "me", x.meOut()), nil
}

// unitOut: dòng hr_don_vi -> đơn vị như INITIAL_ORG_UNITS (parent = khoá cấp trên | __holding | __mother | null).
func unitOut(u *omap.Map) *omap.Map {
	var parent any
	switch {
	case !jsval.IsNullish(u.Val("cap_tren")):
		parent = u.Val("cap_tren")
	case jsval.Str(u.Val("lien_ket")) == "holding":
		parent = groupHolding
	case jsval.Str(u.Val("lien_ket")) == "mother":
		parent = groupMother
	}
	out := omap.Of("key", u.Val("ma"), "label", u.Val("nhan"), "name", jsval.Or(u.Val("ten"), u.Val("nhan")), "type", u.Val("loai"),
		"parent", parent, "tone", u.Val("mau"), "desc", u.Val("mo_ta"))
	if jsval.Truthy(u.Val("bo_nhiem_tu_me")) {
		out.Set("appointedFromParent", true)
	}
	return out
}

// empOut: dòng hr_nhan_vien -> object nhân sự của giao diện (chi_tiet trải ra, cột đè lên).
func empOut(e *omap.Map) *omap.Map {
	out := omap.New()
	if d, ok := e.Val("chi_tiet").(*omap.Map); ok {
		d.Each(func(k string, v any) { out.Set(k, v) })
	}
	out.Set("id", e.Val("id")).Set("code", e.Val("ma_nv")).Set("name", e.Val("ho_ten")).Set("dob", jsval.Or(e.Val("ngay_sinh"), "")).
		Set("dept", e.Val("phong_ban")).Set("status", e.Val("trang_thai")).Set("joinDate", e.Val("ngay_vao")).
		Set("leaveDate", jsval.Or(e.Val("ngay_nghi"), nil)).Set("managerId", jsval.Or(e.Val("quan_ly_id"), nil)).
		Set("salary", jsval.ToNumber(e.Val("luong"))).Set("userId", jsval.Or(e.Val("tai_khoan_id"), nil)).Set("hrRole", e.Val("vai_tro_hr"))
	for k, col := range empText {
		out.Set(k, e.Val(col))
	}
	return out
}

// ---------- nhân sự ----------

// CreateEmployee: thêm hồ sơ. Trả {id, ...state}.
func (s *Service) CreateEmployee(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	module, action := "employees", "create"
	if body.Has("candidateId") {
		module, action = "recruit", "approve" // Nhận việc từ Tuyển dụng
	}
	x, err := s.gate(ctx, a, module, action)
	if err != nil {
		return nil, err
	}
	if body.Has("candidateId") {
		if err := x.deptNeed(body.Val("dept")); err != nil {
			return nil, err
		}
	}
	for _, k := range []string{"code", "name", "dept"} {
		if str(body, k) == "" {
			return nil, apperr.BadRequest("Thiếu " + map[string]string{"code": "mã nhân viên", "name": "họ tên", "dept": "phòng ban"}[k])
		}
	}
	if !body.Has("joinDate") || str(body, "joinDate") == "" {
		body = body.Clone().Set("joinDate", s.now().In(vn).Format("2006-01-02"))
	}
	var id any
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		row, err := s.empFields(ctx, body, nil)
		if err != nil {
			return err
		}
		now := s.nowISO()
		row.Set("nguoi_tao", a.UID).Set("ngay_tao", now).Set("cap_nhat", now)
		if lv := str(body, "level"); lv == "Trưởng phòng" || lv == "Giám đốc" {
			row.Set("vai_tro_hr", "manager") // như giao diện gốc: cấp trưởng phòng / giám đốc mặc định là Trưởng phòng
		}
		out, err := s.db.InsertOne(ctx, "hr_nhan_vien", row)
		if err != nil {
			return dupCode(err)
		}
		id = out[0].Val("id")
		// Nhận việc từ Tuyển dụng: đánh dấu ứng viên trong cùng transaction (lỗi thì không tạo hồ sơ -> không trùng hồ sơ khi bấm lại)
		if body.Has("candidateId") {
			return s.markHired(ctx, x, jsval.ToNumber(body.Val("candidateId")), id)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "employees", "create", "Hồ sơ "+str(body, "code")+" "+str(body, "name"))
	st, err := s.state(ctx, x)
	if err != nil {
		return nil, err
	}
	return st.Set("id", id), nil
}

// UpdateEmployee: sửa hồ sơ (chỉ khoá gửi lên; khoá chi tiết gộp vào tài liệu cũ). Nghỉ việc -> cấp dưới chuyển cho quản lý cấp trên.
func (s *Service) UpdateEmployee(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "employees", "edit")
	if err != nil {
		return nil, err
	}
	old, err := s.target(ctx, x, id)
	if err != nil {
		if apperr.Message(err) == "Không tìm thấy nhân sự" {
			return nil, apperr.NotFound("Không tìm thấy nhân sự")
		}
		return nil, err
	}
	if err := s.db.Tx(ctx, func(ctx context.Context) error { return s.patchEmployee(ctx, x, id, body) }); err != nil {
		return nil, err
	}
	s.audit(ctx, x, "employees", "edit", "Hồ sơ "+jsval.Str(old.Val("ma_nv"))+" "+jsval.Str(old.Val("ho_ten")))
	return s.state(ctx, x)
}

func (s *Service) patchEmployee(ctx context.Context, x *access, id float64, body *omap.Map) error {
	old, err := s.getEmp(ctx, id)
	if err != nil {
		return err
	}
	if old == nil {
		return apperr.NotFound("Không tìm thấy nhân sự")
	}
	if !x.can("payroll", "view") {
		body = keepPay(body, old)
	}
	patch, err := s.empFields(ctx, body, old)
	if err != nil {
		return err
	}
	patch.Set("cap_nhat", s.nowISO())
	if _, err := s.db.Update(ctx, "hr_nhan_vien", database.Eq("id", id), patch); err != nil {
		return dupCode(err)
	}
	if jsval.Str(patch.Val("trang_thai")) == "left" && jsval.Str(old.Val("trang_thai")) != "left" {
		return s.offboard(ctx, old)
	}
	return nil
}

// DeleteEmployee: xoá hồ sơ; cấp dưới chuyển cho quản lý cấp trên, kiêm nhiệm xoá theo (cascade), trưởng đơn vị -> trống.
func (s *Service) DeleteEmployee(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	x, err := s.gateAll(ctx, a, "employees", "delete")
	if err != nil {
		return nil, err
	}
	var name string
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		old, err := s.getEmp(ctx, id)
		if err != nil {
			return err
		}
		if old == nil {
			return apperr.NotFound("Không tìm thấy nhân sự")
		}
		name = jsval.Str(old.Val("ma_nv")) + " " + jsval.Str(old.Val("ho_ten"))
		if err := s.reassignReports(ctx, old); err != nil {
			return err
		}
		_, err = s.db.Remove(ctx, "hr_nhan_vien", database.Eq("id", id))
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "employees", "delete", "Hồ sơ "+name)
	return s.state(ctx, x)
}

// validID: id số nguyên dương; khác (NaN do thiếu khoá, số âm, chuỗi) = không có dòng nào, không gửi xuống database.
func validID(id any) bool {
	n := jsval.ToNumber(id)
	return n == n && n > 0 && n == float64(int64(n))
}

func (s *Service) getEmp(ctx context.Context, id any) (*omap.Map, error) {
	if !validID(id) {
		return nil, nil
	}
	rows, err := s.db.Select(ctx, "hr_nhan_vien", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// offboard: nghỉ việc -> cấp dưới chuyển lên quản lý cấp trên (trưởng đơn vị, kiêm nhiệm giữ nguyên).
func (s *Service) offboard(ctx context.Context, emp *omap.Map) error {
	return s.reassignReports(ctx, emp)
}

func (s *Service) reassignReports(ctx context.Context, emp *omap.Map) error {
	_, err := s.db.Update(ctx, "hr_nhan_vien", database.Eq("quan_ly_id", emp.Val("id")),
		omap.Of("quan_ly_id", jsval.Or(emp.Val("quan_ly_id"), nil), "cap_nhat", s.nowISO()))
	return err
}

func dupCode(err error) error {
	if database.CodeOf(err) == "23505" {
		return apperr.BadRequest("Mã nhân viên đã tồn tại")
	}
	return err
}

// empFields: đọc + kiểm khoá của giao diện có trong body -> patch theo tên cột. old = dòng hiện có (nil khi thêm mới).
func (s *Service) empFields(ctx context.Context, b *omap.Map, old *omap.Map) (*omap.Map, error) {
	p := omap.New()
	if b.Has("code") {
		c := str(b, "code")
		if c == "" {
			return nil, apperr.BadRequest("Thiếu mã nhân viên")
		}
		p.Set("ma_nv", c)
	}
	if b.Has("name") {
		n := str(b, "name")
		if n == "" {
			return nil, apperr.BadRequest("Thiếu họ tên")
		}
		p.Set("ho_ten", n)
	}
	for k, col := range empText {
		if b.Has(k) {
			p.Set(col, str(b, k))
		}
	}
	for k, col := range map[string]string{"dob": "ngay_sinh", "leaveDate": "ngay_nghi", "joinDate": "ngay_vao"} {
		if !b.Has(k) {
			continue
		}
		d := str(b, k)
		switch {
		case d == "" && k == "joinDate":
			return nil, apperr.BadRequest("Thiếu ngày vào làm")
		case d == "":
			p.Set(col, nil)
		case !isoDate.MatchString(d):
			return nil, apperr.BadRequest("Ngày không hợp lệ: " + d)
		default:
			p.Set(col, d)
		}
	}
	if b.Has("status") {
		st := str(b, "status")
		if !statuses[st] {
			return nil, apperr.BadRequest("Trạng thái không hợp lệ")
		}
		p.Set("trang_thai", st)
	}
	if b.Has("salary") {
		v := jsval.ToNumber(b.Val("salary"))
		if str(b, "salary") == "" {
			v = 0
		}
		if v != v || v < 0 || v > 1e15 {
			return nil, apperr.BadRequest("Lương không hợp lệ")
		}
		p.Set("luong", jsval.Round(v))
	}
	if b.Has("dept") {
		d := str(b, "dept")
		u, err := s.db.Select(ctx, "hr_don_vi", database.SelectOpt{Select: "id", Filter: database.Eq("ma", d), Limit: 1})
		if err != nil {
			return nil, err
		}
		if len(u) == 0 {
			return nil, apperr.BadRequest("Không tìm thấy phòng ban " + d)
		}
		p.Set("phong_ban", d)
	}
	if b.Has("managerId") {
		m := b.Val("managerId")
		if jsval.IsNullish(m) || jsval.Str(m) == "" {
			p.Set("quan_ly_id", nil)
		} else {
			if err := s.checkManager(ctx, old, jsval.ToNumber(m)); err != nil {
				return nil, err
			}
			p.Set("quan_ly_id", jsval.ToNumber(m))
		}
	}
	doc := omap.New()
	if old != nil {
		if d, ok := old.Val("chi_tiet").(*omap.Map); ok {
			doc = d.Clone()
		}
	}
	changed := false
	b.Each(func(k string, v any) {
		if !empCols[k] && empText[k] == "" {
			doc.Set(k, v)
			changed = true
		}
	})
	if changed || old == nil {
		if doc.Len() > maxDetailKeys {
			return nil, apperr.BadRequest("Hồ sơ có quá nhiều trường")
		}
		if j, err := omap.Marshal(doc); err != nil || len(j) > maxDetailBytes {
			return nil, apperr.BadRequest("Hồ sơ quá lớn (tối đa 512 KB, file đính kèm phải tải lên riêng)")
		}
		p.Set("chi_tiet", doc)
	}
	return p, nil
}

// checkManager: quản lý phải cùng công ty (đọc có phạm vi công ty), khác chính mình và không tạo vòng.
func (s *Service) checkManager(ctx context.Context, self *omap.Map, mid float64) error {
	var selfID float64 = -1
	if self != nil {
		selfID = jsval.ToNumber(self.Val("id"))
	}
	for cur, n := mid, 0; n < 200; n++ {
		if cur == selfID {
			return apperr.BadRequest("Quản lý trực tiếp không hợp lệ (tạo vòng quản lý)")
		}
		e, err := s.getEmp(ctx, cur)
		if err != nil {
			return err
		}
		if e == nil {
			if n == 0 {
				return apperr.BadRequest("Không tìm thấy quản lý trực tiếp")
			}
			return nil
		}
		if n == 0 && jsval.Str(e.Val("trang_thai")) == "left" {
			return apperr.BadRequest("Quản lý trực tiếp đã nghỉ việc")
		}
		if jsval.IsNullish(e.Val("quan_ly_id")) {
			return nil
		}
		cur = jsval.ToNumber(e.Val("quan_ly_id"))
	}
	return nil
}

func str(m *omap.Map, k string) string {
	v := m.Val(k)
	if jsval.IsNullish(v) {
		return ""
	}
	return jsval.Trim(jsval.Str(v))
}

// hidePay: bỏ các số tiền lương khỏi object nhân sự gửi cho vai trò không có quyền xem lương.
func hidePay(o *omap.Map) {
	o.Set("salary", nil)
	if cs, ok := o.Val("contracts").([]any); ok {
		for _, c := range cs {
			if m, ok := c.(*omap.Map); ok {
				m.Delete("salary")
			}
		}
	}
	if ins, ok := o.Val("insurance").(*omap.Map); ok {
		ins.Delete("base") // mức đóng BHXH ~ lương
	}
}

// keepPay: vai trò không xem được lương chỉ nhận về bản đã bỏ số tiền (hidePay) -> khi lưu không được ghi đè lương,
// hợp đồng (có lương) và mức đóng bảo hiểm: bỏ salary / contracts khỏi lệnh sửa, giữ insurance.base cũ.
func keepPay(body, old *omap.Map) *omap.Map {
	b := body.Clone()
	b.Delete("salary")
	b.Delete("contracts")
	if ins, ok := b.Val("insurance").(*omap.Map); ok {
		ins = ins.Clone()
		ins.Delete("base")
		if d, ok := old.Val("chi_tiet").(*omap.Map); ok {
			if oi, ok := d.Val("insurance").(*omap.Map); ok && oi.Has("base") {
				ins.Set("base", oi.Val("base"))
			}
		}
		b.Set("insurance", ins)
	}
	return b
}
