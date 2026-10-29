// Package sales: trang Kinh doanh (SiteFlow /kinh-doanh) - khách hàng tiềm năng (pipeline) + lịch sử chăm sóc.
// Tính năng mới, chỉ bản Go: REST /api/v1/sales/... (không có hàm /api/:fn). Bảng: kd_khach_hang, kd_cham_soc (migration 0015).
package sales

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

// Tab = khoá quyền trong users.perms và cong_ty.tinh_nang (giao diện: PERM_TABS).
const Tab = "kinhdoanh"

var (
	stages      = set("tiep-can", "tu-van", "bao-gia", "dam-phan", "chot-hd", "bao-gia-thi-cong", "thiet-ke", "thi-cong", "truot-thau")
	wonStages   = set("chot-hd", "bao-gia-thi-cong", "thiet-ke", "thi-cong")
	boardStages = set("intake", "concept", "drafting", "review", "approved", "prep", "structure", "finishing", "acceptance", "handover")
	depts       = set("dan-dung", "du-an")
	kinds       = set("call", "meeting", "site", "zalo", "email", "quote", "note")
	outcomes    = set("", "good", "neutral", "bad")
	isoDate     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

func set(xs ...string) map[string]bool {
	m := map[string]bool{}
	for _, x := range xs {
		m[x] = true
	}
	return m
}

// Deps: do internal/server/routes.go truyền vào. Repo chỉ dùng trong test (bỏ trống = Postgres).
type Deps struct {
	DB       *database.DB
	Cfg      *config.Config
	Users    contracts.UserReader
	UserFmt  contracts.UserFormatter
	Lines    contracts.LineReader
	Projects contracts.ProjectReader
	Delivery contracts.DeliveryFromLead
	Repo     Repository
}

// Service: nghiệp vụ Kinh doanh.
type Service struct {
	repo     Repository
	users    contracts.UserReader
	userFmt  contracts.UserFormatter
	lines    contracts.LineReader
	projects contracts.ProjectReader
	delivery contracts.DeliveryFromLead
	db       *database.DB
	now      func() time.Time
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = newPgRepo(d.DB)
	}
	return &Service{repo: repo, users: d.Users, userFmt: d.UserFmt, lines: d.Lines, projects: d.Projects, delivery: d.Delivery, db: d.DB, now: time.Now}
}

// tx: ghi khách hàng + tạo dự án triển khai trong cùng 1 transaction. Repo giả trong test không có DB -> chạy thẳng.
func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	return s.db.Tx(ctx, fn)
}

// deliveryKind: giai đoạn của khách -> loại dự án triển khai cần có.
var deliveryKind = map[string]string{"thiet-ke": "design", "thi-cong": "construction"}

// saveAndDeliver: chạy write (chèn / sửa khách hàng) rồi, nếu khách đang ở thiet-ke / thi-cong, bảo đảm có dự án triển khai.
func (s *Service) saveAndDeliver(ctx context.Context, a *actor.Actor, write func(ctx context.Context) (*omap.Map, error)) (*omap.Map, any, error) {
	var out *omap.Map
	var q any
	err := s.tx(ctx, func(ctx context.Context) error {
		var err error
		if out, err = write(ctx); err != nil || out == nil {
			return err
		}
		if q, err = s.getQuote(ctx, out); err != nil {
			return err
		}
		if k := deliveryKind[jsval.Str(out.Val("giai_doan"))]; k != "" && s.delivery != nil {
			v := jsval.ToNumber(out.Val("gia_tri_vnd"))
			if m, ok := q.(*omap.Map); ok {
				v = jsval.ToNumber(m.Val("ban"))
			}
			_, err = s.delivery.EnsureFromLead(ctx, a, out, v, k)
		}
		return err
	})
	return out, q, err
}

// allow: giống canTab('kinhdoanh') của giao diện. Super phải "xem như" 1 công ty (không thì thấy lẫn mọi công ty và
// không có công ty để gắn dòng mới); công ty có danh sách tính năng mà thiếu tab -> không ai được; admin được;
// nhân viên cần được cấp tab.
func (s *Service) allow(ctx context.Context, a *actor.Actor) error {
	if a == nil {
		return apperr.E(401, "Chưa đăng nhập", "NOAUTH")
	}
	t := tenant.TenantID(ctx)
	if !jsval.Truthy(t) {
		if a.IsSuper() {
			return apperr.BadRequest("Chọn công ty (Xem như công ty) để dùng Kinh doanh")
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
	if ct != nil && !coTinhNang(ct.Val("tinh_nang"), Tab) {
		return apperr.Forbidden("Công ty chưa được cấp tính năng Kinh doanh")
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
	return apperr.Forbidden("Tài khoản không có quyền vào Kinh doanh")
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

// ListLeads: mọi khách hàng của công ty + tổng báo giá QS (chưa VAT) của dự án đã gắn.
func (s *Service) ListLeads(ctx context.Context, a *actor.Actor) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListLeads(ctx)
	if err != nil {
		return nil, err
	}
	quotes := map[string]any{}
	out := make([]any, 0, len(rows))
	for _, r := range rows {
		ma := jsval.Str(r.Val("ma_da"))
		if ma != "" {
			if _, ok := quotes[ma]; !ok {
				// ponytail: đọc dòng bóc tách từng dự án đã gắn (N truy vấn); cần 1 truy vấn gộp khi số lead gắn dự án lớn
				if quotes[ma], err = s.quote(ctx, ma); err != nil {
					return nil, err
				}
			}
		}
		out = append(out, leadOut(r, quotes[ma]))
	}
	return omap.Of("leads", out), nil
}

// quote: tổng bán / vốn (chưa VAT) theo dòng bóc tách - cùng công thức thanhTienBan / thanhTienVon của takeoff.
func (s *Service) quote(ctx context.Context, ma string) (any, error) {
	lines, err := s.lines.GetLines(ctx, ma)
	if err != nil {
		return nil, err
	}
	ban, von := 0.0, 0.0
	for _, l := range lines {
		if m, ok := l.(*omap.Map); ok {
			ban += jsval.ToNumber(m.Val("thanhTienBan"))
			von += jsval.ToNumber(m.Val("thanhTienVon"))
		}
	}
	return omap.Of("ban", ban, "von", von, "soDong", float64(len(lines))), nil
}

func (s *Service) getQuote(ctx context.Context, r *omap.Map) (any, error) {
	if ma := jsval.Str(r.Val("ma_da")); ma != "" {
		return s.quote(ctx, ma)
	}
	return nil, nil
}

// CreateLead: thêm khách hàng. body theo khoá của giao diện (xem fields).
func (s *Service) CreateLead(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if !body.Has("name") {
		return nil, apperr.BadRequest("Thiếu tên khách hàng")
	}
	row, err := s.fields(ctx, body)
	if err != nil {
		return nil, err
	}
	if !row.Has("giai_doan") {
		row.Set("giai_doan", "tiep-can")
	}
	if !row.Has("nguoi_tao_ten") || row.Val("nguoi_tao_ten") == "" {
		row.Set("nguoi_tao_ten", a.U)
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	if wonStages[jsval.Str(row.Val("giai_doan"))] {
		row.Set("ngay_chot", now)
	}
	row.Set("nguoi_tao", a.UID).Set("ngay_tao", now).Set("cap_nhat", now)
	out, q, err := s.saveAndDeliver(ctx, a, func(ctx context.Context) (*omap.Map, error) { return s.repo.InsertLead(ctx, row) })
	if err != nil {
		return nil, err
	}
	return leadOut(out, q), nil
}

// UpdateLead: sửa một phần (chỉ khoá có trong body) - dùng cho cả kéo-thả giai đoạn, bảng con, người phụ trách, sửa form.
func (s *Service) UpdateLead(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	old, err := s.repo.GetLead(ctx, id)
	if err != nil {
		return nil, err
	}
	if old == nil {
		return nil, apperr.NotFound("Không tìm thấy khách hàng")
	}
	patch, err := s.fields(ctx, body)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	if g, ok := patch.Get("giai_doan"); ok {
		wasWon, isWon := wonStages[jsval.Str(old.Val("giai_doan"))], wonStages[jsval.Str(g)]
		if isWon && !wasWon {
			patch.Set("ngay_chot", now)
		} else if !isWon {
			patch.Set("ngay_chot", nil)
		}
	}
	patch.Set("cap_nhat", now)
	out, q, err := s.saveAndDeliver(ctx, a, func(ctx context.Context) (*omap.Map, error) { return s.repo.UpdateLead(ctx, id, patch) })
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy khách hàng")
	}
	return leadOut(out, q), nil
}

// DeleteLead: xoá khách hàng (lịch sử chăm sóc xoá theo, khoá ngoại cascade).
func (s *Service) DeleteLead(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	n, err := s.repo.DeleteLead(ctx, id)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apperr.NotFound("Không tìm thấy khách hàng")
	}
	return omap.Of("ok", true), nil
}

// ListActivities: lịch sử chăm sóc, mới nhất trước.
func (s *Service) ListActivities(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if l, err := s.repo.GetLead(ctx, id); err != nil || l == nil {
		if err == nil {
			err = apperr.NotFound("Không tìm thấy khách hàng")
		}
		return nil, err
	}
	rows, err := s.repo.ListActivities(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = activityOut(r)
	}
	return out, nil
}

// AddActivity: ghi 1 lần chăm sóc. Người viết lấy từ body.by (tên hiển thị), thiếu thì tên đăng nhập.
func (s *Service) AddActivity(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if l, err := s.repo.GetLead(ctx, id); err != nil || l == nil {
		if err == nil {
			err = apperr.NotFound("Không tìm thấy khách hàng")
		}
		return nil, err
	}
	kind := str(body, "type")
	if !kinds[kind] {
		return nil, apperr.BadRequest("Loại chăm sóc không hợp lệ")
	}
	title, content := str(body, "title"), str(body, "content")
	if title == "" {
		return nil, apperr.BadRequest("Thiếu tiêu đề")
	}
	outcome := str(body, "outcome")
	if !outcomes[outcome] {
		return nil, apperr.BadRequest("Kết quả không hợp lệ")
	}
	date := str(body, "date")
	if !isoDate.MatchString(date) {
		date = s.now().In(vn).Format("2006-01-02")
	}
	var next any
	if n := str(body, "next"); n != "" {
		if !isoDate.MatchString(n) {
			return nil, apperr.BadRequest("Ngày hẹn không hợp lệ")
		}
		next = n
	}
	by := str(body, "by")
	if by == "" {
		by = a.U
	}
	row := omap.Of("khach_hang_id", id, "ngay", date, "loai", kind, "tieu_de", title, "noi_dung", content, "ket_qua", outcome,
		"hen_tiep", next, "ghi_chu_hen", str(body, "nextNote"), "nguoi_viet", by, "nguoi_tao", a.UID)
	out, err := s.repo.InsertActivity(ctx, row)
	if err != nil {
		return nil, err
	}
	return activityOut(out), nil
}

// fields: đọc + kiểm các khoá của giao diện có trong body -> patch theo tên cột trong code.
func (s *Service) fields(ctx context.Context, b *omap.Map) (*omap.Map, error) {
	p := omap.New()
	text := map[string]string{"phone": "sdt", "email": "email", "address": "dia_chi", "source": "nguon",
		"projectType": "loai_cong_trinh", "scale": "quy_mo", "concept": "concept", "notes": "ghi_chu",
		"creator": "nguoi_tao_ten", "manager": "quan_ly", "boqFile": "file_boq"}
	for _, k := range []string{"phone", "email", "address", "source", "projectType", "scale", "concept", "notes", "creator", "manager", "boqFile"} {
		if b.Has(k) {
			p.Set(text[k], str(b, k))
		}
	}
	if b.Has("name") {
		n := str(b, "name")
		if n == "" {
			return nil, apperr.BadRequest("Thiếu tên khách hàng")
		}
		p.Set("ten_khach", n)
	}
	if b.Has("dept") {
		if d := str(b, "dept"); depts[d] {
			p.Set("phong_kd", d)
		} else {
			return nil, apperr.BadRequest("Phòng kinh doanh không hợp lệ")
		}
	}
	if b.Has("stage") {
		if g := str(b, "stage"); stages[g] {
			p.Set("giai_doan", g)
		} else {
			return nil, apperr.BadRequest("Giai đoạn không hợp lệ")
		}
	}
	if b.Has("sub") {
		switch g := str(b, "sub"); {
		case g == "":
			p.Set("giai_doan_con", nil)
		case boardStages[g]:
			p.Set("giai_doan_con", g)
		default:
			return nil, apperr.BadRequest("Giai đoạn con không hợp lệ")
		}
	}
	if b.Has("valueVnd") {
		v := jsval.ToNumber(b.Val("valueVnd"))
		if v != v || v < 0 || v > 1e17 {
			return nil, apperr.BadRequest("Giá trị không hợp lệ")
		}
		p.Set("gia_tri_vnd", jsval.Round(v))
	}
	if b.Has("partner") {
		p.Set("doi_tac", jsval.Truthy(b.Val("partner")))
	}
	if b.Has("categories") {
		cats := []any{}
		if arr, ok := b.Val("categories").([]any); ok {
			for _, x := range arr {
				if t := jsval.Trim(jsval.Str(x)); t != "" && len(cats) < 50 {
					cats = append(cats, t)
				}
			}
		}
		p.Set("hang_muc", cats)
	}
	if b.Has("assignees") {
		list := []any{}
		if arr, ok := b.Val("assignees").([]any); ok {
			for _, x := range arr {
				if m, ok := x.(*omap.Map); ok && str(m, "name") != "" && len(list) < 50 {
					list = append(list, omap.Of("name", str(m, "name"), "role", str(m, "role")))
				}
			}
		}
		p.Set("phu_trach", list)
	}
	if b.Has("handoff") {
		if m, ok := b.Val("handoff").(*omap.Map); ok {
			h := omap.New()
			for _, k := range []string{"status", "dept", "requestedAt", "assignee"} {
				if v := m.Val(k); jsval.IsNullish(v) {
					h.Set(k, nil)
				} else {
					h.Set(k, jsval.Str(v))
				}
			}
			p.Set("ban_giao", h)
		} else {
			p.Set("ban_giao", nil)
		}
	}
	if b.Has("maDA") {
		ma := str(b, "maDA")
		if ma == "" {
			p.Set("ma_da", nil)
		} else {
			// dự án phải thuộc công ty đang làm việc (GetProject có phạm vi công ty)
			pr, err := s.projects.GetProject(ctx, ma)
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

func str(m *omap.Map, k string) string {
	v := m.Val(k)
	if jsval.IsNullish(v) {
		return ""
	}
	return jsval.Trim(jsval.Str(v))
}

var vn = time.FixedZone("ICT", 7*3600)

// ngayVN: thời điểm ISO -> ngày yyyy-mm-dd giờ Việt Nam (giao diện lọc theo ngày).
func ngayVN(v any) any {
	t, err := time.Parse(time.RFC3339Nano, jsval.Str(v))
	if err != nil {
		return nil
	}
	return t.In(vn).Format("2006-01-02")
}

func orArr(v any) any {
	if _, ok := v.([]any); ok {
		return v
	}
	return []any{}
}

// leadOut: dòng kd_khach_hang -> object của giao diện (khoá như lead trong kinhDoanhData.js).
func leadOut(r *omap.Map, quote any) *omap.Map {
	return omap.Of(
		"id", r.Val("id"), "name", r.Val("ten_khach"), "phone", r.Val("sdt"), "email", r.Val("email"), "address", r.Val("dia_chi"),
		"source", r.Val("nguon"), "dept", r.Val("phong_kd"), "stage", r.Val("giai_doan"), "sub", jsval.Or(r.Val("giai_doan_con"), ""),
		"projectType", r.Val("loai_cong_trinh"), "scale", r.Val("quy_mo"), "valueVnd", jsval.ToNumber(r.Val("gia_tri_vnd")),
		"categories", orArr(r.Val("hang_muc")), "concept", r.Val("concept"), "notes", r.Val("ghi_chu"),
		"partner", jsval.Truthy(r.Val("doi_tac")), "creator", r.Val("nguoi_tao_ten"), "manager", r.Val("quan_ly"),
		"assignees", orArr(r.Val("phu_trach")), "handoff", jsval.Or(r.Val("ban_giao"), nil), "boqFile", r.Val("file_boq"),
		"maDA", jsval.Or(r.Val("ma_da"), ""), "quote", quote,
		"createdAt", ngayVN(r.Val("ngay_tao")), "wonAt", ngayVN(r.Val("ngay_chot")), "updatedAt", r.Val("cap_nhat"),
	)
}

func activityOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "date", r.Val("ngay"), "type", r.Val("loai"), "title", r.Val("tieu_de"),
		"content", r.Val("noi_dung"), "outcome", r.Val("ket_qua"), "next", jsval.Or(r.Val("hen_tiep"), ""),
		"nextNote", r.Val("ghi_chu_hen"), "by", r.Val("nguoi_viet"), "createdAt", r.Val("ngay_tao"))
}
