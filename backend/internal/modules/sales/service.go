// Package sales: trang Kinh doanh (SiteFlow /kinh-doanh) - khách hàng tiềm năng (pipeline) + lịch sử chăm sóc.
// Tính năng mới, chỉ bản Go: REST /api/v1/sales/... (không có hàm /api/:fn). Bảng: kd_khach_hang, kd_cham_soc (migration 0015);
// trang khách hàng dạng dashboard: kd_cham_diem, kd_lich_hen, kd_nhiem_vu_kh, kd_goi_y (migration 0053).
package sales

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
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
	stages    = set("tiep-can", "giao-ns", "tu-van", "bao-gia", "dam-phan", "chot-hd", "bao-gia-thi-cong", "thiet-ke", "thi-cong", "khong-tham-gia", "truot-thau", "spam")
	wonStages = set("chot-hd", "thiet-ke", "thi-cong") // = closedWon của giao diện (OverviewTab.jsx)
	// deliveryKindList: các trang triển khai, thứ tự gọi delivery cố định (xem deliveryKinds)
	deliveryKindList = []string{"design", "construction"}
	// handoffKind: phòng nhận phiếu bàn giao (HANDOFF_CONFIG.deptOptions của giao diện) -> trang triển khai; QS không có trang
	handoffKind = map[string]string{"Thiết kế": "design", "Thi công": "construction"}
	boardStages = set("intake", "concept", "drafting", "review", "approved", "prep", "structure", "finishing", "acceptance", "handover")
	depts       = set("dan-dung", "du-an")
	kinds       = set("call", "meeting", "site", "zalo", "email", "quote", "note")
	outcomes    = set("", "good", "neutral", "bad")
	// assigneeDepts: nhóm của người phụ trách trên khối Phụ trách (Kinh doanh / CTV Kinh doanh / Concept / Thiết kế / Nhà thầu)
	assigneeDepts = set("kinhdoanh", "ctv", "concept", "thietke", "nhathau")
	isoDate       = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
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
	Notifier contracts.Notifier // báo người vừa được giao phụ trách khách hàng; nil = không báo
	AI       AIClient           // Gemini (GEMINI_API_KEY); nil = phân tích khách hàng theo quy tắc
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
	notifier contracts.Notifier
	ai       AIClient
	db       *database.DB
	now      func() time.Time
	readKeys []readKey // khoá API chỉ đọc (SALES_READ_KEYS, apikey.go)
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = newPgRepo(d.DB)
	}
	s := &Service{repo: repo, users: d.Users, userFmt: d.UserFmt, lines: d.Lines, projects: d.Projects, delivery: d.Delivery, notifier: d.Notifier, ai: d.AI, db: d.DB, now: time.Now}
	if d.Cfg != nil {
		s.readKeys = parseReadKeys(d.Cfg.SalesReadKeys)
	}
	return s
}

// tx: ghi khách hàng + tạo dự án triển khai trong cùng 1 transaction. Repo giả trong test không có DB -> chạy thẳng.
func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	return s.db.Tx(ctx, fn)
}

// handoffOf: phiếu bàn giao gần nhất của khách -> (giai đoạn gửi phiếu, phòng nhận); phiếu cũ (trước khi ghi giai đoạn) có stage "".
func handoffOf(l *omap.Map) (stage, dept string) {
	if h, ok := l.Val("ban_giao").(*omap.Map); ok {
		return jsval.Str(h.Val("stage")), jsval.Str(h.Val("dept"))
	}
	return "", ""
}

// deliveryKinds: trang triển khai khách cần có dự án - gửi tới phòng nào thì chỉ hiện ở trang phòng đó. Phiếu bàn giao gửi
// từ chính giai đoạn đang đứng tới Phòng Thiết kế -> Quản lý thiết kế, Phòng Thi công -> Quản lý dự án. Chưa có phiếu đó (hoặc
// gửi QS): cột "Dự án (Thiết kế)" / "Dự án (Thi công)" -> trang của cột; tu-van / dam-phan -> chưa trang nào. Phiếu cũ không ghi
// giai đoạn chỉ còn tính ở tu-van / dam-phan (như lúc chuyển đổi, migration 0044). Giai đoạn khác -> không trang nào.
func deliveryKinds(l *omap.Map) map[string]bool {
	st := jsval.Str(l.Val("giai_doan"))
	switch st {
	case "tu-van", "dam-phan", "thiet-ke", "thi-cong":
		hs, dept := handoffOf(l)
		if k := handoffKind[dept]; k != "" && (hs == st || (hs == "" && (st == "tu-van" || st == "dam-phan"))) {
			return map[string]bool{k: true}
		}
	}
	switch st {
	case "thiet-ke":
		return map[string]bool{"design": true}
	case "thi-cong":
		return map[string]bool{"construction": true}
	}
	return nil
}

// routeChanged: giai đoạn hoặc phiếu bàn giao (giai đoạn gửi, phòng nhận) đổi -> trang cần có có thể đổi.
func routeChanged(old, out *omap.Map) bool {
	if old == nil {
		return true
	}
	os, od := handoffOf(old)
	ns, nd := handoffOf(out)
	return jsval.Str(old.Val("giai_doan")) != jsval.Str(out.Val("giai_doan")) || os != ns || od != nd
}

// saveAndDeliver: chạy write (chèn / sửa khách hàng) rồi đồng bộ dự án triển khai theo deliveryKinds - CHỈ khi giai đoạn /
// phiếu bàn giao đổi (routeChanged) hoặc tên / loại công trình đổi; sửa thứ khác (người phụ trách, bảng con, ghi chú...) không
// đụng dự án. old = dòng trước khi sửa (nil khi tạo mới). Đồng bộ theo dòng VỪA GHI (out), không so với old, để 2 lệnh sửa gần
// nhau (kéo thẻ rồi gửi phiếu) không lệch: trang cần -> tạo / hiện lại dự án (giá trị = giá trị ước tính, chỉ khi tạo; cả 2 lời
// gọi của delivery chạy lại được); trang không cần -> ẩn (xoá nếu còn nguyên). Tên khách đổi -> đổi tên mọi dự án gắn khách
// (cả dự án đang ẩn) nếu đội chưa tự đặt tên.
func (s *Service) saveAndDeliver(ctx context.Context, a *actor.Actor, old *omap.Map, write func(ctx context.Context) (*omap.Map, error)) (*omap.Map, any, error) {
	var out *omap.Map
	var q any
	err := s.tx(ctx, func(ctx context.Context) error {
		var err error
		if out, err = write(ctx); err != nil || out == nil {
			return err
		}
		if q, err = s.getQuote(ctx, out); err != nil || s.delivery == nil {
			return err
		}
		if old != nil && nameChanged(old, out) {
			if err = s.delivery.RenameFromLead(ctx, old, out); err != nil {
				return err
			}
		}
		if !routeChanged(old, out) {
			return nil
		}
		is := deliveryKinds(out)
		for _, k := range deliveryKindList {
			switch {
			case is[k]:
				_, err = s.delivery.EnsureFromLead(ctx, a, out, jsval.ToNumber(out.Val("gia_tri_vnd")), k)
			case old != nil:
				err = s.delivery.DetachFromLead(ctx, out.Val("id"), k, false)
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	return out, q, err
}

// nameChanged: các cột tạo nên tên dự án triển khai (delivery leadProjectName) có đổi không.
func nameChanged(old, out *omap.Map) bool {
	for _, k := range []string{"ten_khach", "loai_cong_trinh", "quy_mo"} {
		if jsval.Str(old.Val(k)) != jsval.Str(out.Val(k)) {
			return true
		}
	}
	return false
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
	row, err := s.fields(ctx, body, nil)
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
	// createdAt / wonAt (yyyy-mm-dd) khi tạo: nạp dữ liệu mẫu / dữ liệu cũ đúng ngày (createdAt sửa được ở UpdateLead)
	created, err := dayOr(body, "createdAt", now)
	if err != nil {
		return nil, err
	}
	won, err := dayOr(body, "wonAt", now)
	if err != nil {
		return nil, err
	}
	if wonStages[jsval.Str(row.Val("giai_doan"))] {
		row.Set("ngay_chot", won)
	}
	row.Set("nguoi_tao", a.UID).Set("ngay_tao", created).Set("cap_nhat", now).Set("ngay_doi_giai_doan", now)
	out, q, err := s.saveAndDeliver(ctx, a, nil, func(ctx context.Context) (*omap.Map, error) { return s.repo.InsertLead(ctx, row) })
	if err != nil {
		return nil, err
	}
	s.notifyAssigned(ctx, a, nil, out)
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
	patch, err := s.fields(ctx, body, old)
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
		if jsval.Str(g) != jsval.Str(old.Val("giai_doan")) {
			patch.Set("ngay_doi_giai_doan", now) // "Đã ở giai đoạn này N ngày"
		}
	}
	// sửa ngày tạo (yyyy-mm-dd, nút sửa ở Dự án quan tâm): 9:00 giờ VN ngày đó như khi tạo
	if str(body, "createdAt") != "" {
		created, err := dayOr(body, "createdAt", "")
		if err != nil {
			return nil, err
		}
		patch.Set("ngay_tao", created)
	}
	patch.Set("cap_nhat", now)
	old = old.Clone() // repo có thể trả lại chính map này sau khi sửa (repo giả trong test)
	out, q, err := s.saveAndDeliver(ctx, a, old, func(ctx context.Context) (*omap.Map, error) { return s.repo.UpdateLead(ctx, id, patch) })
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy khách hàng")
	}
	s.notifyAssigned(ctx, a, old, out)
	return leadOut(out, q), nil
}

// DeleteLead: xoá khách hàng (lịch sử chăm sóc xoá theo, khoá ngoại cascade) và gỡ dự án triển khai đã gắn (dự án đã có
// dữ liệu thì giữ, bỏ liên kết, hiện như dự án tạo tay).
func (s *Service) DeleteLead(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	// gỡ dự án triển khai trước (khoá ngoại chỉ set null), cùng transaction với lệnh xoá
	err := s.tx(ctx, func(ctx context.Context) error {
		if s.delivery != nil {
			if err := s.delivery.DetachFromLead(ctx, id, "", true); err != nil {
				return err
			}
		}
		n, err := s.repo.DeleteLead(ctx, id)
		if err == nil && n == 0 {
			err = apperr.NotFound("Không tìm thấy khách hàng")
		}
		return err
	})
	if err != nil {
		return nil, err
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

// assigneeUsernames: tên đăng nhập trong phu_trach (người được chọn từ GET /sales/staff); dòng chỉ có tên thì bỏ qua.
func assigneeUsernames(l *omap.Map) []string {
	if l == nil {
		return nil
	}
	arr, _ := l.Val("phu_trach").([]any)
	out := []string{}
	for _, x := range arr {
		var u string
		switch m := x.(type) {
		case *omap.Map:
			u = jsval.Str(m.Val("username"))
		case map[string]any:
			u = jsval.Str(m["username"])
		}
		if u = jsval.Trim(u); u != "" {
			out = append(out, u)
		}
	}
	return out
}

// notifyAssigned: sau khi lưu, báo (chuông thông báo, kind "kd_assign", refId = id khách) cho từng tài khoản VỪA được thêm
// vào người phụ trách (có trong out, chưa có trong old); không báo cho chính người giao. Lỗi chỉ log, không làm hỏng lần lưu.
func (s *Service) notifyAssigned(ctx context.Context, a *actor.Actor, old, out *omap.Map) {
	if s.notifier == nil || out == nil {
		return
	}
	had := map[string]bool{}
	for _, u := range assigneeUsernames(old) {
		had[u] = true
	}
	added := []string{}
	for _, u := range assigneeUsernames(out) {
		if !had[u] && (a == nil || u != a.U) {
			had[u] = true
			added = append(added, u)
		}
	}
	if len(added) == 0 {
		return
	}
	rows, err := s.repo.ListStaff(ctx)
	if err != nil {
		logger.Error("sales", "báo người phụ trách: đọc tài khoản lỗi:", err.Error())
		return
	}
	ids := map[string]any{}
	for _, r := range rows {
		ids[jsval.Str(r.Val("username"))] = r.Val("id")
	}
	who := ""
	if a != nil {
		who = a.U
		if s.users != nil && jsval.Truthy(a.UID) {
			if u, err := s.users.GetByID(ctx, a.UID); err == nil && u != nil {
				if n := jsval.Trim(jsval.Str(u.Val("ho_ten"))); n != "" {
					who = n
				}
			}
		}
	}
	ten := jsval.Str(out.Val("ten_khach"))
	for _, u := range added {
		id, ok := ids[u]
		if !ok {
			continue // tài khoản đã khoá / không thuộc công ty
		}
		body := "Khách hàng \"" + ten + "\""
		if who != "" {
			body = who + " giao bạn phụ trách khách hàng \"" + ten + "\""
		}
		s.notifier.Notify(ctx, id, "kd_assign", "Bạn được giao phụ trách khách hàng", body, jsval.Str(out.Val("id")))
	}
}

// ListStaff: tài khoản của công ty để giao phụ trách khách hàng (phiếu "Nhân sự KD phụ trách").
// sales = vào được Kinh doanh (admin, hoặc được cấp tab); người có quyền xếp trước, rồi theo tên.
func (s *Service) ListStaff(ctx context.Context, a *actor.Actor) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListStaff(ctx)
	if err != nil {
		return nil, err
	}
	type st struct {
		m     *omap.Map
		sales bool
		name  string
	}
	list := make([]st, 0, len(rows))
	for _, r := range rows {
		u := jsval.Str(r.Val("username"))
		if u == "" {
			continue
		}
		role := jsval.Str(r.Val("role"))
		sales := role == "admin"
		if !sales && s.userFmt != nil {
			for _, p := range s.userFmt.PermsArr(r.Val("perms")) {
				if p == Tab {
					sales = true
					break
				}
			}
		}
		name := jsval.Trim(jsval.Str(r.Val("ho_ten")))
		if name == "" {
			name = u
		}
		list = append(list, st{omap.Of("username", u, "name", name, "department", jsval.Str(r.Val("phong_ban")), "role", role, "sales", sales), sales, strings.ToLower(name)})
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].sales != list[j].sales {
			return list[i].sales
		}
		return list[i].name < list[j].name
	})
	out := make([]any, len(list))
	for i, x := range list {
		out[i] = x.m
	}
	return omap.Of("staff", out), nil
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

// fields: đọc + kiểm các khoá của giao diện có trong body -> patch theo tên cột trong code. old = dòng đang có (nil khi tạo).
func (s *Service) fields(ctx context.Context, b *omap.Map, old *omap.Map) (*omap.Map, error) {
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
		list, err := s.assignees(b.Val("assignees"), old)
		if err != nil {
			return nil, err
		}
		p.Set("phu_trach", list)
	}
	if b.Has("handoff") {
		if m, ok := b.Val("handoff").(*omap.Map); ok {
			h := omap.New()
			for _, k := range []string{"status", "dept", "requestedAt", "assignee", "stage"} {
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

// sameAssignee: so người phụ trách mới với danh sách cũ - theo tên đăng nhập, không có thì theo tên.
func sameAssignee(a, b *omap.Map) bool {
	ua, ub := str(a, "username"), str(b, "username")
	if ua != "" && ub != "" {
		return ua == ub
	}
	return str(a, "name") == str(b, "name")
}

// assignees: body.assignees -> phu_trach [{name, role, username?, since?, dept?}]. Người đã có trong danh sách cũ (old.phu_trach)
// mà giao diện không gửi since / dept -> giữ giá trị đã lưu; người mới không có since -> hôm nay (giờ VN). Không phải mảng -> 400.
func (s *Service) assignees(v any, old *omap.Map) ([]any, error) {
	arr, ok := v.([]any)
	if !ok {
		return nil, apperr.BadRequest("Danh sách người phụ trách (assignees) phải là mảng")
	}
	prev := []*omap.Map{}
	if old != nil {
		if xs, ok := old.Val("phu_trach").([]any); ok {
			for _, x := range xs {
				if m, ok := x.(*omap.Map); ok {
					prev = append(prev, m)
				}
			}
		}
	}
	today := s.now().In(vn).Format("2006-01-02")
	list := []any{}
	for _, x := range arr {
		m, ok := x.(*omap.Map)
		if !ok || str(m, "name") == "" || len(list) >= 50 {
			continue
		}
		a := omap.Of("name", str(m, "name"), "role", str(m, "role"))
		if u := str(m, "username"); u != "" {
			a.Set("username", u) // tài khoản được giao (chọn từ GET /sales/staff); thiếu = chỉ có tên
		}
		var was *omap.Map
		for _, p := range prev {
			if sameAssignee(a, p) {
				was = p
				break
			}
		}
		since := str(m, "since") // ngày nhận phụ trách ("Nhận từ 16/11/26")
		if since != "" && !isDay(since) {
			return nil, apperr.BadRequest("Ngày nhận phụ trách không hợp lệ")
		}
		if since == "" {
			if was != nil {
				since = str(was, "since")
			} else {
				since = today
			}
		}
		if since != "" {
			a.Set("since", since)
		}
		dept := str(m, "dept")
		if !m.Has("dept") && was != nil {
			dept = str(was, "dept")
		}
		if dept != "" {
			if !assigneeDepts[dept] {
				return nil, apperr.BadRequest("Nhóm phụ trách không hợp lệ")
			}
			a.Set("dept", dept)
		}
		list = append(list, a)
	}
	return list, nil
}

// dayOr: body[k] = yyyy-mm-dd -> 9:00 giờ VN ngày đó (ISO UTC); không có -> def.
func dayOr(b *omap.Map, k, def string) (string, error) {
	d := str(b, k)
	if d == "" {
		return def, nil
	}
	t, err := time.ParseInLocation("2006-01-02", d, vn)
	if err != nil {
		return "", apperr.BadRequest("Ngày không hợp lệ: " + k)
	}
	return t.Add(9 * time.Hour).UTC().Format(time.RFC3339Nano), nil
}

// isDay: chuỗi yyyy-mm-dd là ngày có thật.
func isDay(d string) bool {
	if !isoDate.MatchString(d) {
		return false
	}
	_, err := time.Parse("2006-01-02", d)
	return err == nil
}

// leadOr404: khách hàng thuộc công ty đang làm việc (repo tự lọc theo công ty) hoặc 404.
func (s *Service) leadOr404(ctx context.Context, id any) (*omap.Map, error) {
	l, err := s.repo.GetLead(ctx, jsval.ToNumber(id))
	if err == nil && l == nil {
		err = apperr.NotFound("Không tìm thấy khách hàng")
	}
	return l, err
}

// displayName: họ tên của người đang thao tác (thiếu thì tên đăng nhập) - ghi kèm dòng như nguoi_viet của kd_cham_soc.
func (s *Service) displayName(ctx context.Context, a *actor.Actor) string {
	if a == nil {
		return ""
	}
	if s.users != nil && jsval.Truthy(a.UID) {
		if u, err := s.users.GetByID(ctx, a.UID); err == nil && u != nil {
			if n := jsval.Trim(jsval.Str(u.Val("ho_ten"))); n != "" {
				return n
			}
		}
	}
	return a.U
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
		"stageChangedAt", jsval.Or(r.Val("ngay_doi_giai_doan"), r.Val("cap_nhat")),
	)
}

func activityOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "date", r.Val("ngay"), "type", r.Val("loai"), "title", r.Val("tieu_de"),
		"content", r.Val("noi_dung"), "outcome", r.Val("ket_qua"), "next", jsval.Or(r.Val("hen_tiep"), ""),
		"nextNote", r.Val("ghi_chu_hen"), "by", r.Val("nguoi_viet"), "createdAt", r.Val("ngay_tao"))
}
