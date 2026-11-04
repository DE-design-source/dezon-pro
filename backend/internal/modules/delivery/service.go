// Package delivery: dự án triển khai sau Kinh doanh - trang Quản lý thiết kế (kind "design", tab quyền "thietke")
// và Quản lý dự án (kind "construction", tab "thicong"): thông tin dự án, thành viên, thầu phụ, tiến độ Gantt, bình luận.
// Tính năng mới, chỉ bản Go: REST /api/v1/delivery/... Bảng tk_* (migration 0016).
package delivery

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

var (
	tabOf       = map[string]string{"design": "thietke", "construction": "thicong"}
	statuses    = map[string]bool{"nhap": true, "thiet-ke": true, "dang-lam": true, "tam-dung": true, "hoan-tat": true}
	subStatuses = map[string]bool{"active": true, "pending": true, "done": true}
	isoDate     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	cssColor    = regexp.MustCompile(`^(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})?$`)
	slug        = regexp.MustCompile(`^[a-z0-9-]{0,40}$`)
)

var _ contracts.DeliveryFromLead = (*Service)(nil)

// Deps: do internal/server/routes.go truyền vào. Repo chỉ dùng trong test (bỏ trống = Postgres).
type Deps struct {
	DB       *database.DB
	Cfg      *config.Config
	Users    contracts.UserReader
	UserFmt  contracts.UserFormatter
	Projects contracts.ProjectReader
	Repo     Repository
}

// Service: nghiệp vụ dự án triển khai.
type Service struct {
	repo     Repository
	db       *database.DB
	users    contracts.UserReader
	userFmt  contracts.UserFormatter
	projects contracts.ProjectReader
	now      func() time.Time
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = newPgRepo(d.DB)
	}
	return &Service{repo: repo, db: d.DB, users: d.Users, userFmt: d.UserFmt, projects: d.Projects, now: time.Now}
}

func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	return s.db.Tx(ctx, fn)
}

func (s *Service) nowISO() string { return s.now().UTC().Format(time.RFC3339Nano) }

// allow: giống canTab(tab) của giao diện (xem sales.allow): super phải "xem như" công ty, tính năng công ty, admin, perms.
func (s *Service) allow(ctx context.Context, a *actor.Actor, kind string) error {
	tab, ok := tabOf[kind]
	if !ok {
		return apperr.BadRequest("Loại dự án không hợp lệ (design / construction)")
	}
	if a == nil {
		return apperr.E(401, "Chưa đăng nhập", "NOAUTH")
	}
	t := tenant.TenantID(ctx)
	if !jsval.Truthy(t) {
		if a.IsSuper() {
			return apperr.BadRequest("Chọn công ty (Xem như công ty) để dùng phần này")
		}
		return apperr.Forbidden("Tài khoản chưa gắn với công ty nào")
	}
	if a.IsSuper() {
		return nil
	}
	ct, err := s.repo.Company(ctx, t)
	if err != nil {
		return err
	}
	if ct != nil && !coTinhNang(ct.Val("tinh_nang"), tab) {
		return apperr.Forbidden("Công ty chưa được cấp tính năng này")
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
			if p == tab {
				return nil
			}
		}
	}
	return apperr.Forbidden("Tài khoản không có quyền vào phần này")
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

// project: dự án theo id (có phạm vi công ty) + kiểm quyền theo loại của nó.
func (s *Service) project(ctx context.Context, a *actor.Actor, id float64) (*omap.Map, error) {
	if a == nil {
		return nil, apperr.E(401, "Chưa đăng nhập", "NOAUTH")
	}
	if !jsval.Truthy(tenant.TenantID(ctx)) {
		return nil, s.allow(ctx, a, "design") // cùng thông báo "chọn công ty" / "chưa gắn công ty"
	}
	p, err := s.repo.GetProject(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, apperr.NotFound("Không tìm thấy dự án")
	}
	if err := s.allow(ctx, a, jsval.Str(p.Val("loai"))); err != nil {
		return nil, err
	}
	return p, nil
}

// ---------- dự án ----------

// ListProjects: dự án của 1 trang, kèm tiến độ (trung bình % công việc thường), số công việc và thành viên.
func (s *Service) ListProjects(ctx context.Context, a *actor.Actor, kind any) (any, error) {
	k := jsval.Str(kind)
	if err := s.allow(ctx, a, k); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListProjects(ctx, k)
	if err != nil {
		return nil, err
	}
	ids := make([]any, len(rows))
	for i, r := range rows {
		ids[i] = r.Val("id")
	}
	sum, cnt, mem := map[float64]float64{}, map[float64]float64{}, map[float64][]any{}
	if len(ids) > 0 {
		ms, err := s.repo.MembersOf(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, m := range ms {
			id := jsval.ToNumber(m.Val("du_an_id"))
			mem[id] = append(mem[id], memberOut(m))
		}
		tasks, err := s.repo.TaskProgress(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, t := range tasks {
			if jsval.Truthy(t.Val("cot_moc")) || jsval.Truthy(t.Val("loai_tien")) { // như KPI "TB" của Gantt: bỏ mốc và dòng thu / chi
				continue
			}
			id := jsval.ToNumber(t.Val("du_an_id"))
			sum[id] += jsval.ToNumber(t.Val("tien_do"))
			cnt[id]++
		}
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		id := jsval.ToNumber(r.Val("id"))
		prog := jsval.ToNumber(r.Val("tien_do")) // chưa có công việc: tiến độ nhập tay (bản cũ ghi sẵn ở danh sách), null = 0
		if prog != prog {
			prog = 0
		}
		if cnt[id] > 0 {
			prog = jsval.Round(sum[id] / cnt[id])
		}
		ml := mem[id]
		if ml == nil {
			ml = []any{}
		}
		out[i] = projectOut(r).Set("progress", prog).Set("taskCount", cnt[id]).Set("members", ml)
	}
	return omap.Of("projects", out), nil
}

// CreateProject: tạo tay (không từ Kinh doanh). body.kind bắt buộc.
func (s *Service) CreateProject(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	k := str(body, "kind")
	if err := s.allow(ctx, a, k); err != nil {
		return nil, err
	}
	if !body.Has("name") {
		return nil, apperr.BadRequest("Thiếu tên dự án")
	}
	row, err := s.projectFields(ctx, body)
	if err != nil {
		return nil, err
	}
	now := s.nowISO()
	row.Set("loai", k).Set("nguoi_tao", a.UID).Set("ngay_tao", now).Set("cap_nhat", now)
	out, err := s.repo.InsertProject(ctx, row)
	if err != nil {
		return nil, err
	}
	if err := s.ensureCorePhases(ctx, jsval.ToNumber(out.Val("id"))); err != nil {
		return nil, err
	}
	return projectOut(out).Set("progress", 0.0).Set("taskCount", 0.0).Set("members", []any{}), nil
}

// GetProject: toàn bộ dự án cho trang chi tiết - thành viên, thầu phụ, giai đoạn (kèm công việc), bình luận theo công việc.
func (s *Service) GetProject(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	p, err := s.project(ctx, a, id)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.Children(ctx, "tk_thanh_vien", id, "id.asc")
	if err != nil {
		return nil, err
	}
	subs, err := s.repo.Children(ctx, "tk_thau_phu", id, "id.asc")
	if err != nil {
		return nil, err
	}
	phases, err := s.repo.Children(ctx, "tk_giai_doan", id, "thu_tu.asc")
	if err != nil {
		return nil, err
	}
	tasks, err := s.repo.Children(ctx, "tk_cong_viec", id, "thu_tu.asc")
	if err != nil {
		return nil, err
	}
	comments, err := s.repo.Children(ctx, "tk_binh_luan", id, "ngay_tao.asc")
	if err != nil {
		return nil, err
	}
	byPhase := map[float64][]any{}
	for _, t := range tasks {
		pid := jsval.ToNumber(t.Val("giai_doan_id"))
		byPhase[pid] = append(byPhase[pid], taskOut(t))
	}
	ph := make([]any, len(phases))
	for i, r := range phases {
		list := byPhase[jsval.ToNumber(r.Val("id"))]
		if list == nil {
			list = []any{}
		}
		ph[i] = phaseOut(r).Set("tasks", list)
	}
	cm := omap.New()
	for _, c := range comments {
		k := jsval.Str(c.Val("cong_viec_id"))
		arr, _ := cm.Val(k).([]any)
		cm.Set(k, append(arr, commentOut(c)))
	}
	return omap.Of("project", projectOut(p), "members", mapList(members, memberOut), "subcontractors", mapList(subs, subOut),
		"phases", ph, "comments", cm), nil
}

// UpdateProject: sửa thông tin dự án (chỉ khoá gửi lên).
func (s *Service) UpdateProject(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	patch, err := s.projectFields(ctx, body)
	if err != nil {
		return nil, err
	}
	patch.Set("cap_nhat", s.nowISO())
	out, err := s.repo.UpdateProject(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy dự án")
	}
	return projectOut(out), nil
}

// DeleteProject: xoá dự án và mọi thứ bên trong (khoá ngoại cascade).
func (s *Service) DeleteProject(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	if _, err := s.repo.Remove(ctx, "tk_du_an", id, 0); err != nil {
		return nil, err
	}
	return omap.Of("ok", true), nil
}

// leadProjectName: tên dự án sinh từ khách, như pushSyncedProject cũ: type (loại công trình + quy mô) có "—" thì lấy type,
// không thì "tên — type".
func leadProjectName(lead *omap.Map) string {
	typ := jsval.Str(lead.Val("loai_cong_trinh"))
	if typ == "" {
		typ = "Chưa xác định"
	}
	if qm := jsval.Str(lead.Val("quy_mo")); qm != "" {
		typ += " (" + qm + ")"
	}
	if strings.Contains(typ, "—") {
		return typ
	}
	return jsval.Str(lead.Val("ten_khach")) + " — " + typ
}

// EnsureFromLead: cài contracts.DeliveryFromLead (module sales gọi khi khách VÀO tu-van / dam-phan / thiet-ke).
// Đã có dự án gắn khách -> chỉ hiện lại nếu đang ẩn, không ghi đè thông tin đội thiết kế / thi công đã sửa.
// Không kiểm quyền tab: người kéo thẻ ở Kinh doanh không cần quyền vào trang thiết kế / thi công.
func (s *Service) EnsureFromLead(ctx context.Context, a *actor.Actor, lead *omap.Map, valueVnd float64, kind string) (bool, error) {
	if _, ok := tabOf[kind]; !ok || lead == nil {
		return false, nil
	}
	have, err := s.repo.ProjectOfLead(ctx, lead.Val("id"), kind)
	if err != nil {
		return false, err
	}
	if have != nil {
		if jsval.Truthy(have.Val("tach_khach_hang")) {
			// không đổi cap_nhat: ẩn / hiện tự động không tính là người dùng sửa dự án (xem pristine)
			_, err = s.repo.UpdateProject(ctx, jsval.ToNumber(have.Val("id")), omap.Of("tach_khach_hang", false))
		}
		return false, err
	}
	var uid any
	if a != nil {
		uid = a.UID
	}
	now, ten := s.nowISO(), jsval.Str(lead.Val("ten_khach"))
	row := omap.Of("loai", kind, "khach_hang_id", lead.Val("id"), "ma_da", jsval.Or(lead.Val("ma_da"), nil), "ten", leadProjectName(lead),
		"khach", ten, "sdt", lead.Val("sdt"), "email", lead.Val("email"), "dia_chi", lead.Val("dia_chi"), "loai_cong_trinh", jsval.Str(lead.Val("loai_cong_trinh")),
		"gia_tri_hd", jsval.Round(valueVnd), "ghi_chu", "Tạo tự động từ Kinh doanh", "trang_thai", "thiet-ke", "nguoi_tao", uid, "ngay_tao", now, "cap_nhat", now)
	out, err := s.repo.InsertProject(ctx, row)
	if err != nil {
		return false, err
	}
	return true, s.ensureCorePhases(ctx, jsval.ToNumber(out.Val("id")))
}

// RenameFromLead: cài contracts.DeliveryFromLead - khách đổi tên / loại công trình / quy mô khi vẫn ở giai đoạn bàn giao.
// Chỉ đổi chỗ còn đúng giá trị sinh từ khách cũ (đội chưa tự đổi); không đổi cap_nhat (dự án còn nguyên vẫn coi là nguyên).
func (s *Service) RenameFromLead(ctx context.Context, old, lead *omap.Map) error {
	if old == nil || lead == nil {
		return nil
	}
	oldName, name := leadProjectName(old), leadProjectName(lead)
	oldTen, ten := jsval.Str(old.Val("ten_khach")), jsval.Str(lead.Val("ten_khach"))
	if oldName == name && oldTen == ten {
		return nil
	}
	ps, err := s.repo.ProjectsOfLead(ctx, lead.Val("id"))
	if err != nil {
		return err
	}
	for _, p := range ps {
		patch := omap.New()
		if jsval.Str(p.Val("ten")) == oldName {
			patch.Set("ten", name)
		}
		if jsval.Str(p.Val("khach")) == oldTen {
			patch.Set("khach", ten)
		}
		if patch.Len() > 0 {
			if _, err := s.repo.UpdateProject(ctx, jsval.ToNumber(p.Val("id")), patch); err != nil {
				return err
			}
		}
	}
	return nil
}

// DetachFromLead: cài contracts.DeliveryFromLead - khách rời tu-van / dam-phan / thiet-ke (leadDeleted = false) hoặc bị xoá.
// Chỉ xoá dự án còn nguyên như lúc tạo; còn lại: rời giai đoạn -> ẩn, giữ liên kết; khách bị xoá -> bỏ liên kết, hiện lại.
func (s *Service) DetachFromLead(ctx context.Context, leadID any, leadDeleted bool) error {
	ps, err := s.repo.ProjectsOfLead(ctx, leadID)
	if err != nil {
		return err
	}
	for _, p := range ps {
		id := jsval.ToNumber(p.Val("id"))
		clean, err := s.pristine(ctx, p)
		if err != nil {
			return err
		}
		switch {
		case clean:
			_, err = s.repo.Remove(ctx, "tk_du_an", id, 0)
		case leadDeleted:
			_, err = s.repo.UpdateProject(ctx, id, omap.Of("khach_hang_id", nil, "tach_khach_hang", false))
		default:
			_, err = s.repo.UpdateProject(ctx, id, omap.Of("tach_khach_hang", true))
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// pristine: dự án tạo từ khách còn nguyên - chưa ai sửa thông tin (UpdateProject luôn đổi cap_nhat; vẫn soát các ô cài đặt),
// chỉ có các đề mục cốt lõi chưa gán người, không có công việc / thành viên / thầu phụ / bình luận. Xoá được mà không mất gì.
func (s *Service) pristine(ctx context.Context, p *omap.Map) (bool, error) {
	if jsval.Str(p.Val("cap_nhat")) != jsval.Str(p.Val("ngay_tao")) || jsval.ToNumber(p.Val("ngan_sach")) != 0 || jsval.Str(p.Val("mau_thanh")) != "" {
		return false, nil
	}
	for _, k := range []string{"ngay_bat_dau", "ngay_ban_giao", "tien_do", "so_do_to_chuc"} {
		if !jsval.IsNullish(p.Val(k)) {
			return false, nil
		}
	}
	id := jsval.ToNumber(p.Val("id"))
	for _, t := range []string{"tk_cong_viec", "tk_thanh_vien", "tk_thau_phu", "tk_binh_luan", "tk_giai_doan"} {
		// ponytail: đọc cả bảng con của dự án để biết có dòng không; cần truy vấn limit 1 riêng nếu dự án rất lớn
		rows, err := s.repo.Children(ctx, t, id, "id.asc")
		if err != nil {
			return false, err
		}
		for _, r := range rows {
			if mem, _ := r.Val("thanh_vien").([]any); t != "tk_giai_doan" || !isCorePhase(r.Val("ten")) || len(mem) > 0 {
				return false, nil
			}
		}
	}
	return true, nil
}

// projectFields: khoá giao diện -> cột trong code; chỉ khoá có trong body.
func (s *Service) projectFields(ctx context.Context, b *omap.Map) (*omap.Map, error) {
	p := omap.New()
	text := [][2]string{{"client", "khach"}, {"contact", "lien_he"}, {"phone", "sdt"}, {"email", "email"}, {"address", "dia_chi"},
		{"projectType", "loai_cong_trinh"}, {"note", "ghi_chu"}}
	for _, kv := range text {
		if b.Has(kv[0]) {
			p.Set(kv[1], str(b, kv[0]))
		}
	}
	if b.Has("name") {
		n := str(b, "name")
		if n == "" {
			return nil, apperr.BadRequest("Thiếu tên dự án")
		}
		p.Set("ten", n)
	}
	if b.Has("status") {
		if st := str(b, "status"); statuses[st] {
			p.Set("trang_thai", st)
		} else {
			return nil, apperr.BadRequest("Trạng thái không hợp lệ")
		}
	}
	for _, kv := range [][2]string{{"startDate", "ngay_bat_dau"}, {"handoverDate", "ngay_ban_giao"}} {
		if b.Has(kv[0]) {
			d, err := optDate(b, kv[0])
			if err != nil {
				return nil, err
			}
			p.Set(kv[1], d)
		}
	}
	for _, kv := range [][2]string{{"contractValueVnd", "gia_tri_hd"}, {"approvedBudgetVnd", "ngan_sach"}} {
		if b.Has(kv[0]) {
			v, err := money(b, kv[0])
			if err != nil {
				return nil, err
			}
			p.Set(kv[1], v)
		}
	}
	if b.Has("progress") {
		if jsval.IsNullish(b.Val("progress")) || b.Val("progress") == "" {
			p.Set("tien_do", nil)
		} else if v := jsval.ToNumber(b.Val("progress")); v != v || v < 0 || v > 100 {
			return nil, apperr.BadRequest("Tiến độ phải từ 0 đến 100")
		} else {
			p.Set("tien_do", v)
		}
	}
	if b.Has("barColor") {
		c := str(b, "barColor")
		if !cssColor.MatchString(c) {
			return nil, apperr.BadRequest("Màu thanh tiến độ không hợp lệ")
		}
		p.Set("mau_thanh", c)
	}
	if b.Has("orgChart") {
		oc, err := orgChart(b.Val("orgChart"))
		if err != nil {
			return nil, err
		}
		p.Set("so_do_to_chuc", oc)
	}
	if b.Has("maDA") {
		ma := str(b, "maDA")
		if ma == "" {
			p.Set("ma_da", nil)
		} else {
			pr, err := s.projects.GetProject(ctx, ma) // có phạm vi công ty
			if err != nil {
				return nil, err
			}
			if pr == nil {
				return nil, apperr.BadRequest("Không tìm thấy dự án QS " + ma)
			}
			p.Set("ma_da", ma)
		}
	}
	return p, nil
}

// ---------- thành viên, thầu phụ ----------

func (s *Service) AddMember(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	name := str(b, "name")
	if name == "" {
		return nil, apperr.BadRequest("Thiếu tên thành viên")
	}
	dept := str(b, "dept")
	if dept == "" {
		dept = "general"
	}
	out, err := s.repo.Insert(ctx, "tk_thanh_vien", omap.Of("du_an_id", id, "ten", name, "vai_tro", str(b, "role"), "bo_phan", dept))
	if err != nil {
		return nil, err
	}
	return memberOut(out), nil
}

func (s *Service) AddSubcontractor(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	if str(b, "name") == "" {
		return nil, apperr.BadRequest("Thiếu tên thầu phụ")
	}
	row, err := subFields(b)
	if err != nil {
		return nil, err
	}
	if !row.Has("trang_thai") {
		row.Set("trang_thai", "pending")
	}
	out, err := s.repo.Insert(ctx, "tk_thau_phu", row.Set("du_an_id", id))
	if err != nil {
		return nil, err
	}
	return subOut(out), nil
}

func (s *Service) UpdateSubcontractor(ctx context.Context, a *actor.Actor, id, item float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	patch, err := subFields(b)
	if err != nil {
		return nil, err
	}
	if patch.Has("ten") && patch.Val("ten") == "" {
		return nil, apperr.BadRequest("Thiếu tên thầu phụ")
	}
	out, err := s.repo.Update(ctx, "tk_thau_phu", id, item, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy thầu phụ")
	}
	return subOut(out), nil
}

func subFields(b *omap.Map) (*omap.Map, error) {
	p := omap.New()
	for _, kv := range [][2]string{{"name", "ten"}, {"scope", "pham_vi"}, {"contact", "lien_he"}, {"phone", "sdt"}} {
		if b.Has(kv[0]) {
			p.Set(kv[1], str(b, kv[0]))
		}
	}
	if b.Has("valueVnd") {
		v, err := money(b, "valueVnd")
		if err != nil {
			return nil, err
		}
		p.Set("gia_tri", v)
	}
	if b.Has("status") {
		if st := str(b, "status"); subStatuses[st] {
			p.Set("trang_thai", st)
		} else {
			return nil, apperr.BadRequest("Trạng thái thầu phụ không hợp lệ")
		}
	}
	return p, nil
}

// RemoveItem: xoá thành viên / thầu phụ / giai đoạn / công việc của dự án (dòng phải thuộc đúng dự án).
func (s *Service) RemoveItem(ctx context.Context, a *actor.Actor, table string, id, item float64) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	if table == "tk_giai_doan" {
		if ph, err := s.repo.Get(ctx, table, id, item); err != nil {
			return nil, err
		} else if ph != nil && isCorePhase(ph.Val("ten")) {
			return nil, apperr.BadRequest("Không xoá được đề mục \"" + jsval.Str(ph.Val("ten")) + "\" (dự án luôn có đề mục này)")
		}
	}
	n, err := s.repo.Remove(ctx, table, id, item)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apperr.NotFound("Không tìm thấy dòng cần xoá")
	}
	return omap.Of("ok", true), nil
}

// ---------- tiến độ ----------

// corePhases: 2 đề mục mọi dự án luôn có (kanban mua hàng, dòng tiền thu / chi): tạo cùng dự án, không xoá / đổi tên được.
var corePhases = []struct {
	name  string
	order float64
}{{"Mua hàng & cung ứng", 5}, {"Tài chính — dòng tiền", 6}}

func isCorePhase(name any) bool {
	for _, c := range corePhases {
		if jsval.Str(name) == c.name {
			return true
		}
	}
	return false
}

// ensureCorePhases: thêm đề mục cốt lõi còn thiếu cho dự án.
func (s *Service) ensureCorePhases(ctx context.Context, project float64) error {
	rows, err := s.repo.Children(ctx, "tk_giai_doan", project, "thu_tu.asc")
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, r := range rows {
		have[jsval.Str(r.Val("ten"))] = true
	}
	for _, c := range corePhases {
		if !have[c.name] {
			if _, err := s.repo.Insert(ctx, "tk_giai_doan", omap.Of("du_an_id", project, "ten", c.name, "thu_tu", c.order, "thanh_vien", []any{})); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) AddPhase(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	if str(b, "name") == "" {
		return nil, apperr.BadRequest("Thiếu tên giai đoạn")
	}
	if isCorePhase(str(b, "name")) {
		return nil, apperr.BadRequest("Dự án đã có sẵn đề mục \"" + str(b, "name") + "\"")
	}
	row := phaseFields(b).Set("du_an_id", id)
	out, err := s.repo.Insert(ctx, "tk_giai_doan", row)
	if err != nil {
		return nil, err
	}
	return phaseOut(out).Set("tasks", []any{}), nil
}

func (s *Service) UpdatePhase(ctx context.Context, a *actor.Actor, id, item float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	patch := phaseFields(b)
	if patch.Has("ten") && patch.Val("ten") == "" {
		return nil, apperr.BadRequest("Thiếu tên giai đoạn")
	}
	if patch.Has("ten") {
		if ph, err := s.repo.Get(ctx, "tk_giai_doan", id, item); err != nil {
			return nil, err
		} else if ph != nil && isCorePhase(ph.Val("ten")) && patch.Val("ten") != ph.Val("ten") {
			return nil, apperr.BadRequest("Không đổi tên được đề mục \"" + jsval.Str(ph.Val("ten")) + "\" (dự án luôn có đề mục này)")
		} else if ph != nil && !isCorePhase(ph.Val("ten")) && isCorePhase(patch.Val("ten")) {
			return nil, apperr.BadRequest("Dự án đã có sẵn đề mục \"" + jsval.Str(patch.Val("ten")) + "\"")
		}
	}
	out, err := s.repo.Update(ctx, "tk_giai_doan", id, item, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy giai đoạn")
	}
	return phaseOut(out), nil
}

func phaseFields(b *omap.Map) *omap.Map {
	p := omap.New()
	if b.Has("name") {
		p.Set("ten", str(b, "name"))
	}
	if b.Has("sortOrder") {
		p.Set("thu_tu", jsval.Round(jsval.ToNumber(b.Val("sortOrder"))))
	}
	if b.Has("members") {
		p.Set("thanh_vien", people(b.Val("members")))
	}
	return p
}

func (s *Service) AddTask(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	for _, k := range []string{"name", "phaseId", "start", "end"} {
		if !b.Has(k) {
			return nil, apperr.BadRequest("Thiếu " + k)
		}
	}
	row, err := s.taskFields(ctx, id, b, nil)
	if err != nil {
		return nil, err
	}
	now := s.nowISO()
	out, err := s.repo.Insert(ctx, "tk_cong_viec", row.Set("du_an_id", id).Set("ngay_tao", now).Set("cap_nhat", now))
	if err != nil {
		return nil, err
	}
	return taskOut(out), nil
}

func (s *Service) UpdateTask(ctx context.Context, a *actor.Actor, id, item float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	old, err := s.repo.Get(ctx, "tk_cong_viec", id, item)
	if err != nil {
		return nil, err
	}
	if old == nil {
		return nil, apperr.NotFound("Không tìm thấy công việc")
	}
	patch, err := s.taskFields(ctx, id, b, old)
	if err != nil {
		return nil, err
	}
	out, err := s.repo.Update(ctx, "tk_cong_viec", id, item, patch.Set("cap_nhat", s.nowISO()))
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy công việc")
	}
	return taskOut(out), nil
}

// taskFields: kiểm + đổi khoá công việc. old != nil khi sửa (để kiểm ngày kết thúc >= bắt đầu theo giá trị sau khi sửa).
func (s *Service) taskFields(ctx context.Context, project float64, b *omap.Map, old *omap.Map) (*omap.Map, error) {
	p := omap.New()
	if b.Has("name") {
		n := str(b, "name")
		if n == "" {
			return nil, apperr.BadRequest("Thiếu tên công việc")
		}
		p.Set("ten", n)
	}
	if b.Has("phaseId") {
		ph := jsval.ToNumber(b.Val("phaseId"))
		got, err := s.repo.Get(ctx, "tk_giai_doan", project, ph)
		if err != nil {
			return nil, err
		}
		if got == nil {
			return nil, apperr.BadRequest("Giai đoạn không thuộc dự án này")
		}
		p.Set("giai_doan_id", ph)
	}
	start, end := "", ""
	if old != nil {
		start, end = jsval.Str(old.Val("bat_dau")), jsval.Str(old.Val("ket_thuc"))
	}
	for _, kv := range [][2]string{{"start", "bat_dau"}, {"end", "ket_thuc"}} {
		if b.Has(kv[0]) {
			d := str(b, kv[0])
			if !isoDate.MatchString(d) {
				return nil, apperr.BadRequest("Ngày không hợp lệ: " + kv[0])
			}
			p.Set(kv[1], d)
			if kv[0] == "start" {
				start = d
			} else {
				end = d
			}
		}
	}
	if end < start {
		return nil, apperr.BadRequest("Ngày kết thúc phải sau ngày bắt đầu")
	}
	if b.Has("progress") {
		v := jsval.ToNumber(b.Val("progress"))
		if v != v || v < 0 || v > 100 {
			return nil, apperr.BadRequest("Tiến độ phải từ 0 đến 100")
		}
		p.Set("tien_do", v)
	}
	for _, kv := range [][2]string{{"critical", "quan_trong"}, {"milestone", "cot_moc"}, {"confirmed", "da_xac_nhan"}} {
		if b.Has(kv[0]) {
			p.Set(kv[1], jsval.Truthy(b.Val(kv[0])))
		}
	}
	if b.Has("desc") {
		p.Set("mo_ta", str(b, "desc"))
	}
	for _, kv := range [][2]string{{"depts", "bo_phan"}, {"owners", "phu_trach"}} {
		if b.Has(kv[0]) {
			p.Set(kv[1], strList(b.Val(kv[0])))
		}
	}
	if b.Has("finType") {
		switch f := str(b, "finType"); f {
		case "":
			p.Set("loai_tien", nil)
		case "thu", "chi":
			p.Set("loai_tien", f)
		default:
			return nil, apperr.BadRequest("Loại thu / chi không hợp lệ")
		}
	}
	if b.Has("planStart") {
		d, err := optDate(b, "planStart")
		if err != nil {
			return nil, err
		}
		p.Set("ngay_ke_hoach", d)
	}
	if b.Has("amountVnd") {
		if jsval.IsNullish(b.Val("amountVnd")) || b.Val("amountVnd") == "" {
			p.Set("so_tien", nil)
		} else {
			v, err := money(b, "amountVnd")
			if err != nil {
				return nil, err
			}
			p.Set("so_tien", v)
		}
	}
	if b.Has("sortOrder") {
		p.Set("thu_tu", jsval.Round(jsval.ToNumber(b.Val("sortOrder"))))
	}
	if b.Has("purchaseItems") {
		po, err := purchaseItems(b.Val("purchaseItems"))
		if err != nil {
			return nil, err
		}
		p.Set("don_mua", po)
	}
	if b.Has("purchaseFlow") {
		pf, err := purchaseFlow(b.Val("purchaseFlow"))
		if err != nil {
			return nil, err
		}
		p.Set("quy_trinh_mua", pf)
	}
	return p, nil
}

// AddComment: bình luận vào công việc của dự án.
func (s *Service) AddComment(ctx context.Context, a *actor.Actor, id, task float64, b *omap.Map) (any, error) {
	if _, err := s.project(ctx, a, id); err != nil {
		return nil, err
	}
	t, err := s.repo.Get(ctx, "tk_cong_viec", id, task)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, apperr.NotFound("Không tìm thấy công việc")
	}
	text := str(b, "text")
	if text == "" {
		return nil, apperr.BadRequest("Nội dung bình luận trống")
	}
	who := str(b, "who")
	if who == "" {
		who = a.U
	}
	out, err := s.repo.Insert(ctx, "tk_binh_luan", omap.Of("du_an_id", id, "cong_viec_id", task, "nguoi_viet", who, "noi_dung", text, "nguoi_tao", a.UID))
	if err != nil {
		return nil, err
	}
	return commentOut(out), nil
}

// ---------- tiện ích ----------

func str(m *omap.Map, k string) string {
	v := m.Val(k)
	if jsval.IsNullish(v) {
		return ""
	}
	return jsval.Trim(jsval.Str(v))
}

func optDate(b *omap.Map, k string) (any, error) {
	d := str(b, k)
	if d == "" {
		return nil, nil
	}
	if !isoDate.MatchString(d) {
		return nil, apperr.BadRequest("Ngày không hợp lệ: " + k)
	}
	return d, nil
}

func money(b *omap.Map, k string) (float64, error) {
	v := jsval.ToNumber(b.Val(k))
	if v != v || v < 0 || v > 1e17 {
		return 0, apperr.BadRequest("Số tiền không hợp lệ: " + k)
	}
	return jsval.Round(v), nil
}

func strList(v any) []any {
	out := []any{}
	if arr, ok := v.([]any); ok {
		for _, x := range arr {
			if t := jsval.Trim(jsval.Str(x)); t != "" && len(out) < 50 {
				out = append(out, t)
			}
		}
	}
	return out
}

func people(v any) []any {
	out := []any{}
	if arr, ok := v.([]any); ok {
		for _, x := range arr {
			if m, ok := x.(*omap.Map); ok && str(m, "name") != "" && len(out) < 50 {
				out = append(out, omap.Of("name", str(m, "name"), "role", str(m, "role")))
			}
		}
	}
	return out
}

// orgChart: sơ đồ tổ chức {parallel, children} - mỗi bộ phận chỉ giữ khoá đã biết; icon là tên khoá (không phải SVG).
func orgChart(v any) (any, error) {
	if jsval.IsNullish(v) {
		return nil, nil
	}
	m, ok := v.(*omap.Map)
	if !ok {
		return nil, apperr.BadRequest("Sơ đồ tổ chức không hợp lệ")
	}
	out := omap.New()
	for _, row := range []string{"parallel", "children"} {
		arr, _ := m.Val(row).([]any)
		list := []any{}
		for _, x := range arr {
			it, ok := x.(*omap.Map)
			if !ok || str(it, "label") == "" || len(list) >= 50 {
				return nil, apperr.BadRequest("Sơ đồ tổ chức không hợp lệ")
			}
			if !slug.MatchString(str(it, "color")) || !slug.MatchString(str(it, "icon")) || len(str(it, "dept")) > 80 {
				return nil, apperr.BadRequest("Sơ đồ tổ chức không hợp lệ")
			}
			o := omap.Of("dept", str(it, "dept"), "label", str(it, "label"), "color", str(it, "color"), "icon", str(it, "icon"),
				"dashed", jsval.Truthy(it.Val("dashed")), "removable", jsval.Truthy(it.Val("removable")))
			if c := str(it, "caption"); c != "" {
				o.Set("caption", c)
			}
			list = append(list, o)
		}
		out.Set(row, list)
	}
	return out, nil
}

// purchaseItems: đơn mua hàng của 1 công việc (bảng kanban). value = triệu đồng, due = yyyy-mm-dd.
func purchaseItems(v any) ([]any, error) {
	arr, ok := v.([]any)
	if !ok && !jsval.IsNullish(v) {
		return nil, apperr.BadRequest("Danh sách đơn mua hàng không hợp lệ")
	}
	out := []any{}
	for _, x := range arr {
		it, ok := x.(*omap.Map)
		if !ok || str(it, "id") == "" || len(out) >= 500 {
			return nil, apperr.BadRequest("Đơn mua hàng không hợp lệ")
		}
		if d := str(it, "due"); d != "" && !isoDate.MatchString(d) {
			return nil, apperr.BadRequest("Ngày cần hàng không hợp lệ")
		}
		val := jsval.ToNumber(it.Val("value"))
		if val != val || val < 0 {
			return nil, apperr.BadRequest("Giá trị đơn mua hàng không hợp lệ")
		}
		o := omap.Of("id", str(it, "id"), "code", str(it, "code"), "item", str(it, "item"), "supplier", str(it, "supplier"),
			"qty", str(it, "qty"), "value", val, "due", str(it, "due"), "owner", str(it, "owner"), "stage", str(it, "stage"))
		if it.Has("assignees") {
			o.Set("assignees", strList(it.Val("assignees")))
		}
		if it.Has("dept") {
			o.Set("dept", str(it, "dept"))
		}
		out = append(out, o)
	}
	return out, nil
}

// purchaseFlow: các bước (cột) bảng kanban mua hàng của 1 công việc; null = quy trình mặc định của giao diện.
func purchaseFlow(v any) (any, error) {
	if jsval.IsNullish(v) {
		return nil, nil
	}
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 || len(arr) > 30 {
		return nil, apperr.BadRequest("Quy trình mua hàng không hợp lệ")
	}
	out := []any{}
	seen := map[string]bool{}
	for _, x := range arr {
		it, ok := x.(*omap.Map)
		if !ok {
			return nil, apperr.BadRequest("Bước quy trình mua hàng không hợp lệ")
		}
		key, label := str(it, "key"), str(it, "label")
		if key == "" || label == "" || len(key) > 60 || len(label) > 120 || seen[key] || !cssColor.MatchString(str(it, "color")) {
			return nil, apperr.BadRequest("Bước quy trình mua hàng không hợp lệ")
		}
		seen[key] = true
		depts, owners := strList(it.Val("depts")), strList(it.Val("owners"))
		if d := str(it, "dept"); d != "" && len(depts) == 0 { // dạng cũ PO_STAGES: 1 phòng ban / 1 người
			depts = []any{d}
		}
		if o := str(it, "owner"); o != "" && len(owners) == 0 {
			owners = []any{o}
		}
		out = append(out, omap.Of("key", key, "label", label, "color", str(it, "color"), "depts", depts, "owners", owners,
			"received", jsval.Truthy(it.Val("received")), "closed", jsval.Truthy(it.Val("closed"))))
	}
	return out, nil
}

func orArr(v any) any {
	if _, ok := v.([]any); ok {
		return v
	}
	return []any{}
}

func mapList(rows []*omap.Map, f func(*omap.Map) *omap.Map) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = f(r)
	}
	return out
}

func projectOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "kind", r.Val("loai"), "leadId", r.Val("khach_hang_id"), "maDA", jsval.Or(r.Val("ma_da"), ""),
		"name", r.Val("ten"), "client", r.Val("khach"), "contact", r.Val("lien_he"), "phone", r.Val("sdt"), "email", r.Val("email"),
		"address", r.Val("dia_chi"), "projectType", r.Val("loai_cong_trinh"), "status", r.Val("trang_thai"),
		"startDate", jsval.Or(r.Val("ngay_bat_dau"), ""), "handoverDate", jsval.Or(r.Val("ngay_ban_giao"), ""),
		"contractValueVnd", jsval.ToNumber(r.Val("gia_tri_hd")), "approvedBudgetVnd", jsval.ToNumber(r.Val("ngan_sach")),
		"note", r.Val("ghi_chu"), "barColor", jsval.Or(r.Val("mau_thanh"), ""), "orgChart", r.Val("so_do_to_chuc"),
		"createdAt", r.Val("ngay_tao"), "updatedAt", r.Val("cap_nhat"))
}

func memberOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "name", r.Val("ten"), "role", r.Val("vai_tro"), "dept", r.Val("bo_phan"))
}

func subOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "name", r.Val("ten"), "scope", r.Val("pham_vi"), "contact", r.Val("lien_he"), "phone", r.Val("sdt"),
		"valueVnd", jsval.ToNumber(r.Val("gia_tri")), "status", r.Val("trang_thai"))
}

func phaseOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "name", r.Val("ten"), "sortOrder", r.Val("thu_tu"), "members", orArr(r.Val("thanh_vien")))
}

func taskOut(r *omap.Map) *omap.Map {
	var amount any
	if !jsval.IsNullish(r.Val("so_tien")) {
		amount = jsval.ToNumber(r.Val("so_tien"))
	}
	return omap.Of("id", r.Val("id"), "phaseId", r.Val("giai_doan_id"), "name", r.Val("ten"), "start", r.Val("bat_dau"), "end", r.Val("ket_thuc"),
		"progress", jsval.ToNumber(r.Val("tien_do")), "critical", jsval.Truthy(r.Val("quan_trong")), "milestone", jsval.Truthy(r.Val("cot_moc")),
		"desc", r.Val("mo_ta"), "depts", orArr(r.Val("bo_phan")), "owners", orArr(r.Val("phu_trach")),
		"finType", jsval.Or(r.Val("loai_tien"), ""), "planStart", jsval.Or(r.Val("ngay_ke_hoach"), ""), "amountVnd", amount,
		"confirmed", jsval.Truthy(r.Val("da_xac_nhan")), "sortOrder", r.Val("thu_tu"), "purchaseItems", orArr(r.Val("don_mua")),
		"purchaseFlow", r.Val("quy_trinh_mua"))
}

func commentOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "taskId", r.Val("cong_viec_id"), "who", r.Val("nguoi_viet"), "text", r.Val("noi_dung"), "createdAt", r.Val("ngay_tao"))
}
