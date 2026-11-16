// Package it: trang IT (SiteFlow /it) - yêu cầu hỗ trợ (helpdesk, bảng quy trình xử lý từng yêu cầu) + thiết bị & tài sản CNTT.
// Tính năng mới, chỉ bản Go: REST /api/v1/it/... (không có hàm /api/:fn). Bảng: it_yeu_cau, it_thiet_bi (migration 0048).
// Quyền: ai đăng nhập (có công ty) cũng tạo được yêu cầu (nút Báo lỗi ở mọi trang) và xem yêu cầu mình gửi;
// xem / xử lý mọi yêu cầu, quản lý thiết bị cần quyền trang IT (perms "it") hoặc admin.
package it

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"math/rand/v2"
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

// Tab = khoá quyền trang IT trong users.perms (giao diện: PAGE_TABS 'it').
const Tab = "it"

var (
	priorities  = set("urgent", "high", "medium", "low")
	categories  = set("hardware", "software", "network", "account", "other")
	statuses    = set("moi", "dangxuly", "chodoi", "hoanthanh", "dong")
	assetStatus = set("active", "maintenance", "broken")
	isoDate     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reDataImg   = regexp.MustCompile(`^data:image/(png|jpeg|jpg|webp|gif);base64,`)
)

const (
	maxImages    = 8
	maxImageSize = 8 << 20   // 8 MB / ảnh sau khi giải mã
	maxJSONBytes = 256 << 10 // tasks / stages / roles: 256 KB mỗi trường
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
	Notifier contracts.Notifier // báo người được giao / phòng IT khi có yêu cầu mới; nil = không báo
	Uploader contracts.Uploader // lưu ảnh đính kèm (UPLOAD_DIR, /files/it/...)
	Repo     Repository
}

// Service: nghiệp vụ IT.
type Service struct {
	repo     Repository
	users    contracts.UserReader
	userFmt  contracts.UserFormatter
	notifier contracts.Notifier
	uploader contracts.Uploader
	now      func() time.Time
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = newPgRepo(d.DB)
	}
	return &Service{repo: repo, users: d.Users, userFmt: d.UserFmt, notifier: d.Notifier, uploader: d.Uploader, now: time.Now}
}

/* ---------------- Quyền ---------------- */

// member: đăng nhập và đang làm việc trong 1 công ty (super phải "xem như" 1 công ty).
func member(ctx context.Context, a *actor.Actor) error {
	if a == nil {
		return apperr.E(401, "Chưa đăng nhập", "NOAUTH")
	}
	if !jsval.Truthy(tenant.TenantID(ctx)) {
		if a.IsSuper() {
			return apperr.BadRequest("Chọn công ty (Xem như công ty) để dùng IT")
		}
		return apperr.Forbidden("Tài khoản chưa gắn với công ty nào")
	}
	return nil
}

// isIT: được xem / xử lý mọi yêu cầu và quản lý thiết bị: admin / super, hoặc nhân viên được cấp trang IT.
func (s *Service) isIT(ctx context.Context, a *actor.Actor) (bool, error) {
	if a.IsAdmin() {
		return true, nil
	}
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil || u == nil {
		return false, err
	}
	return hasPerm(s.userFmt.PermsArr(u.Val("perms")), Tab), nil
}

func hasPerm(perms []any, tab string) bool {
	for _, p := range perms {
		if p == tab {
			return true
		}
	}
	return false
}

func (s *Service) allowIT(ctx context.Context, a *actor.Actor) error {
	if err := member(ctx, a); err != nil {
		return err
	}
	ok, err := s.isIT(ctx, a)
	if err != nil {
		return err
	}
	if !ok {
		return apperr.Forbidden("Tài khoản không có quyền vào IT")
	}
	return nil
}

/* ---------------- Yêu cầu hỗ trợ ---------------- */

// ListTickets: người có quyền IT thấy mọi yêu cầu của công ty; người khác (hoặc mine=true) chỉ thấy yêu cầu mình gửi.
// canManage cho giao diện biết có được mở bảng xử lý / quản lý thiết bị không.
func (s *Service) ListTickets(ctx context.Context, a *actor.Actor, mine bool) (any, error) {
	if err := member(ctx, a); err != nil {
		return nil, err
	}
	canManage, err := s.isIT(ctx, a)
	if err != nil {
		return nil, err
	}
	var by any
	if mine || !canManage {
		if !jsval.Truthy(a.UID) {
			return omap.Of("tickets", []any{}, "canManage", canManage), nil
		}
		by = a.UID
	}
	rows, err := s.repo.ListTickets(ctx, by)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = ticketOut(r, a)
	}
	return omap.Of("tickets", out, "canManage", canManage), nil
}

// CreateTicket: tạo yêu cầu (trang IT hoặc nút Báo lỗi). Ảnh dạng data:image/...;base64 được lưu vào kho file.
func (s *Service) CreateTicket(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	if err := member(ctx, a); err != nil {
		return nil, err
	}
	if str(body, "title") == "" {
		return nil, apperr.BadRequest("Thiếu tiêu đề yêu cầu")
	}
	row, err := s.ticketFields(ctx, body, true)
	if err != nil {
		return nil, err
	}
	if !row.Has("nguoi_yeu_cau") || row.Val("nguoi_yeu_cau") == "" {
		row.Set("nguoi_yeu_cau", s.displayName(ctx, a)).Set("nguoi_yeu_cau_tk", a.U)
	}
	src := "manual"
	if str(body, "source") == "report" {
		src = "report"
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	row.Set("nguon", src).Set("trang_thai", "moi").Set("nguoi_tao", jsval.Or(a.UID, nil)).Set("ngay_tao", now).Set("cap_nhat", now)
	if p := str(body, "page"); p != "" {
		row.Set("trang_bao", cut(p, 300))
	}
	out, err := s.repo.InsertTicket(ctx, row)
	if err != nil {
		return nil, err
	}
	s.notifyNew(ctx, a, out)
	return ticketOut(out, a), nil
}

// UpdateTicket: sửa một phần (chỉ khoá gửi lên): bảng xử lý (tasks / stages / status / progress), đã tiếp nhận, thông tin.
func (s *Service) UpdateTicket(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allowIT(ctx, a); err != nil {
		return nil, err
	}
	old, err := s.repo.GetTicket(ctx, id)
	if err != nil {
		return nil, err
	}
	if old == nil {
		return nil, apperr.NotFound("Không tìm thấy yêu cầu")
	}
	patch, err := s.ticketFields(ctx, body, false)
	if err != nil {
		return nil, err
	}
	if body.Has("status") {
		st := str(body, "status")
		if !statuses[st] {
			return nil, apperr.BadRequest("Trạng thái không hợp lệ")
		}
		patch.Set("trang_thai", st)
	}
	if body.Has("received") {
		patch.Set("da_tiep_nhan", jsval.Truthy(body.Val("received")))
	}
	if body.Has("progress") {
		p := jsval.ToNumber(body.Val("progress"))
		if p != p || p < 0 || p > 100 {
			return nil, apperr.BadRequest("Tiến độ phải từ 0 tới 100")
		}
		patch.Set("tien_do", float64(int(p+0.5)))
	}
	for _, k := range []struct{ in, col string }{{"tasks", "cong_viec"}, {"stages", "quy_trinh"}} {
		if !body.Has(k.in) {
			continue
		}
		v := body.Val(k.in)
		if jsval.IsNullish(v) {
			patch.Set(k.col, nil)
			continue
		}
		arr, ok := v.([]any)
		if !ok {
			return nil, apperr.BadRequest(k.in + " phải là mảng")
		}
		if err := sizeOK(arr, k.in); err != nil {
			return nil, err
		}
		patch.Set(k.col, arr)
	}
	if patch.Len() == 0 {
		return ticketOut(old, a), nil
	}
	patch.Set("cap_nhat", s.now().UTC().Format(time.RFC3339Nano))
	out, err := s.repo.UpdateTicket(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy yêu cầu")
	}
	s.notifyRoles(ctx, a, old, out)
	return ticketOut(out, a), nil
}

// DeleteTicket: xoá hẳn 1 yêu cầu (chỉ admin; bình thường đóng yêu cầu bằng trạng thái "Đóng").
func (s *Service) DeleteTicket(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := member(ctx, a); err != nil {
		return nil, err
	}
	if !a.IsAdmin() {
		return nil, apperr.Forbidden("Chỉ quản trị được xoá yêu cầu")
	}
	n, err := s.repo.DeleteTicket(ctx, id)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apperr.NotFound("Không tìm thấy yêu cầu")
	}
	return omap.Of("ok", true), nil
}

// ticketFields: body (khoá của giao diện) -> cột it_yeu_cau đã kiểm tra. create=true: điền mặc định cho khoá thiếu.
func (s *Service) ticketFields(ctx context.Context, b *omap.Map, create bool) (*omap.Map, error) {
	p := omap.New()
	if b.Has("title") {
		t := str(b, "title")
		if t == "" {
			return nil, apperr.BadRequest("Thiếu tiêu đề yêu cầu")
		}
		p.Set("tieu_de", cut(t, 300))
	}
	if b.Has("desc") {
		p.Set("mo_ta", cut(str(b, "desc"), 10000))
	}
	if b.Has("priority") || create {
		v := str(b, "priority")
		if v == "" {
			v = "medium"
		}
		if !priorities[v] {
			return nil, apperr.BadRequest("Mức độ không hợp lệ")
		}
		p.Set("muc_do", v)
	}
	if b.Has("category") || create {
		v := str(b, "category")
		if v == "" {
			v = "other"
		}
		if !categories[v] {
			return nil, apperr.BadRequest("Hạng mục không hợp lệ")
		}
		p.Set("hang_muc", v)
	}
	if b.Has("deadline") {
		d := str(b, "deadline")
		if d == "" {
			p.Set("han_xu_ly", nil)
		} else if _, err := time.Parse("2006-01-02", d); err != nil || !isoDate.MatchString(d) {
			return nil, apperr.BadRequest("Deadline không hợp lệ (yyyy-mm-dd)")
		} else {
			p.Set("han_xu_ly", d)
		}
	}
	if b.Has("requester") {
		p.Set("nguoi_yeu_cau", cut(str(b, "requester"), 120)).Set("nguoi_yeu_cau_tk", cut(str(b, "requesterUsername"), 120))
	}
	if b.Has("roles") || create {
		roles, err := rolesIn(b.Val("roles"))
		if err != nil {
			return nil, err
		}
		p.Set("vai_tro", roles)
	}
	if b.Has("images") || create {
		imgs, err := s.imagesIn(ctx, b.Val("images"))
		if err != nil {
			return nil, err
		}
		p.Set("hinh_anh", imgs)
	}
	return p, nil
}

// rolesIn: [{label, people: [{name, username}] | ["tên"]}] -> mảng đã làm sạch (bỏ vai trò rỗng tên).
func rolesIn(v any) ([]any, error) {
	out := []any{}
	if jsval.IsNullish(v) {
		return out, nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, apperr.BadRequest("roles phải là mảng")
	}
	for _, x := range arr {
		m, ok := x.(*omap.Map)
		if !ok {
			continue
		}
		label := cut(str(m, "label"), 60)
		if label == "" || len(out) >= 10 {
			continue
		}
		people := []any{}
		ps, _ := m.Val("people").([]any)
		for _, pv := range ps {
			var name, user string
			switch q := pv.(type) {
			case string:
				name = jsval.Trim(q)
			case *omap.Map:
				name, user = str(q, "name"), str(q, "username")
			}
			if name == "" || len(people) >= 20 {
				continue
			}
			pm := omap.Of("name", cut(name, 120))
			if user != "" {
				pm.Set("username", cut(user, 120))
			}
			people = append(people, pm)
		}
		out = append(out, omap.Of("label", label, "people", people))
	}
	return out, nil
}

// imagesIn: [{name, url}] (url /files/... giữ nguyên) hoặc [{name, data: "data:image/...;base64,..."}] (lưu vào kho file).
func (s *Service) imagesIn(ctx context.Context, v any) ([]any, error) {
	out := []any{}
	if jsval.IsNullish(v) {
		return out, nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, apperr.BadRequest("images phải là mảng")
	}
	if len(arr) > maxImages {
		return nil, apperr.BadRequest("Tối đa 8 ảnh")
	}
	for _, x := range arr {
		m, ok := x.(*omap.Map)
		if !ok {
			continue
		}
		name := cut(str(m, "name"), 200)
		if name == "" {
			name = "anh.jpg"
		}
		if u := str(m, "url"); strings.HasPrefix(u, "/files/") {
			out = append(out, omap.Of("name", name, "url", u))
			continue
		}
		data := jsval.Str(m.Val("data"))
		loc := reDataImg.FindStringSubmatchIndex(data)
		if loc == nil {
			return nil, apperr.BadRequest("Ảnh đính kèm không hợp lệ")
		}
		ext := data[loc[2]:loc[3]]
		buf, err := base64.StdEncoding.DecodeString(data[loc[1]:])
		if err != nil || len(buf) == 0 {
			return nil, apperr.BadRequest("Ảnh đính kèm không hợp lệ")
		}
		if len(buf) > maxImageSize {
			return nil, apperr.BadRequest("Ảnh quá lớn (tối đa 8 MB)")
		}
		if ext == "jpg" {
			ext = "jpeg"
		}
		if s.uploader == nil {
			return nil, apperr.New("Máy chủ chưa cấu hình kho file")
		}
		path := "it/" + jsval.NumberToString(jsval.NowMs()) + "-" + jsval.NumberToString(float64(rand.IntN(1000000))) + "." + strings.Replace(ext, "jpeg", "jpg", 1)
		url, err := s.uploader.Upload(ctx, buf, path, "image/"+ext)
		if err != nil {
			return nil, err
		}
		out = append(out, omap.Of("name", name, "url", url))
	}
	return out, nil
}

func sizeOK(v any, name string) error {
	b, err := json.Marshal(v)
	if err != nil {
		return apperr.BadRequest(name + " không hợp lệ")
	}
	if len(b) > maxJSONBytes {
		return apperr.BadRequest(name + " quá lớn")
	}
	return nil
}

/* ---------------- Thông báo ---------------- */

// roleUsers: tên đăng nhập trong vai trò (người chọn từ danh sách tài khoản).
func roleUsers(r *omap.Map) []string {
	if r == nil {
		return nil
	}
	out := []string{}
	roles, _ := r.Val("vai_tro").([]any)
	for _, x := range roles {
		m := asMap(x)
		if m == nil {
			continue
		}
		ps, _ := m.Val("people").([]any)
		for _, p := range ps {
			if pm := asMap(p); pm != nil {
				if u := jsval.Trim(jsval.Str(pm.Val("username"))); u != "" {
					out = append(out, u)
				}
			}
		}
	}
	return out
}

func asMap(v any) *omap.Map {
	switch m := v.(type) {
	case *omap.Map:
		return m
	case map[string]any:
		o := omap.New()
		for k, x := range m {
			o.Set(k, x)
		}
		return o
	}
	return nil
}

// notifyNew: yêu cầu mới -> báo người trong vai trò (trừ người tạo); không ai được giao thì báo những người có quyền IT
// (nhân viên được cấp trang IT, không tính admin để khỏi làm phiền cả công ty).
func (s *Service) notifyNew(ctx context.Context, a *actor.Actor, t *omap.Map) {
	if s.notifier == nil || t == nil {
		return
	}
	targets := roleUsers(t)
	staff, err := s.repo.ListStaff(ctx)
	if err != nil {
		logger.Error("it", "báo yêu cầu mới: đọc tài khoản lỗi:", err.Error())
		return
	}
	if len(targets) == 0 {
		for _, r := range staff {
			if hasPerm(s.perms(r), Tab) {
				targets = append(targets, jsval.Str(r.Val("username")))
			}
		}
	}
	title := "Yêu cầu IT mới #" + jsval.Str(t.Val("id"))
	body := jsval.Str(t.Val("nguoi_yeu_cau")) + ": " + jsval.Str(t.Val("tieu_de"))
	s.send(ctx, a, staff, targets, "it_ticket", title, body, jsval.Str(t.Val("id")))
}

// notifyRoles: sau khi sửa, báo người VỪA được thêm vào vai trò.
func (s *Service) notifyRoles(ctx context.Context, a *actor.Actor, old, out *omap.Map) {
	if s.notifier == nil || out == nil {
		return
	}
	had := map[string]bool{}
	for _, u := range roleUsers(old) {
		had[u] = true
	}
	added := []string{}
	for _, u := range roleUsers(out) {
		if !had[u] {
			had[u] = true
			added = append(added, u)
		}
	}
	if len(added) == 0 {
		return
	}
	staff, err := s.repo.ListStaff(ctx)
	if err != nil {
		logger.Error("it", "báo người được giao: đọc tài khoản lỗi:", err.Error())
		return
	}
	s.send(ctx, a, staff, added, "it_assign", "Bạn được giao xử lý yêu cầu IT #"+jsval.Str(out.Val("id")), jsval.Str(out.Val("tieu_de")), jsval.Str(out.Val("id")))
}

func (s *Service) send(ctx context.Context, a *actor.Actor, staff []*omap.Map, users []string, kind, title, body, ref string) {
	ids := map[string]any{}
	for _, r := range staff {
		ids[jsval.Str(r.Val("username"))] = r.Val("id")
	}
	seen := map[string]bool{}
	for _, u := range users {
		if seen[u] || (a != nil && u == a.U) {
			continue
		}
		seen[u] = true
		if id, ok := ids[u]; ok {
			s.notifier.Notify(ctx, id, kind, title, body, ref)
		}
	}
}

func (s *Service) perms(r *omap.Map) []any {
	if s.userFmt == nil {
		return nil
	}
	return s.userFmt.PermsArr(r.Val("perms"))
}

// displayName: họ tên của tài khoản đang đăng nhập (thiếu thì tên đăng nhập).
func (s *Service) displayName(ctx context.Context, a *actor.Actor) string {
	if s.users != nil && jsval.Truthy(a.UID) {
		if u, err := s.users.GetByID(ctx, a.UID); err == nil && u != nil {
			if n := jsval.Trim(jsval.Str(u.Val("ho_ten"))); n != "" {
				return n
			}
		}
	}
	return a.U
}

/* ---------------- Tài khoản để chọn người ---------------- */

// ListStaff: tài khoản đang hoạt động của công ty (chọn người yêu cầu / người liên quan / người trên bảng xử lý).
// it = có quyền trang IT (admin hoặc được cấp); người có quyền IT xếp trước, rồi theo tên. Không trả perms.
func (s *Service) ListStaff(ctx context.Context, a *actor.Actor) (any, error) {
	if err := member(ctx, a); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListStaff(ctx)
	if err != nil {
		return nil, err
	}
	type st struct {
		m    *omap.Map
		it   bool
		name string
	}
	list := make([]st, 0, len(rows))
	for _, r := range rows {
		u := jsval.Str(r.Val("username"))
		if u == "" {
			continue
		}
		role := jsval.Str(r.Val("role"))
		isIT := role == "admin" || hasPerm(s.perms(r), Tab)
		name := jsval.Trim(jsval.Str(r.Val("ho_ten")))
		if name == "" {
			name = u
		}
		list = append(list, st{omap.Of("username", u, "name", name, "department", jsval.Str(r.Val("phong_ban")), "role", role, "it", isIT), isIT, strings.ToLower(name)})
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].it != list[j].it {
			return list[i].it
		}
		return list[i].name < list[j].name
	})
	out := make([]any, len(list))
	for i, x := range list {
		out[i] = x.m
	}
	return omap.Of("staff", out), nil
}

/* ---------------- Thiết bị & tài sản ---------------- */

func (s *Service) ListAssets(ctx context.Context, a *actor.Actor) (any, error) {
	if err := s.allowIT(ctx, a); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListAssets(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = assetOut(r)
	}
	return omap.Of("assets", out), nil
}

func (s *Service) CreateAsset(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	if err := s.allowIT(ctx, a); err != nil {
		return nil, err
	}
	row, err := assetFields(body, true)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	row.Set("nguoi_tao", jsval.Or(a.UID, nil)).Set("ngay_tao", now).Set("cap_nhat", now)
	out, err := s.repo.InsertAsset(ctx, row)
	if err != nil {
		return nil, err
	}
	return assetOut(out), nil
}

func (s *Service) UpdateAsset(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allowIT(ctx, a); err != nil {
		return nil, err
	}
	patch, err := assetFields(body, false)
	if err != nil {
		return nil, err
	}
	patch.Set("cap_nhat", s.now().UTC().Format(time.RFC3339Nano))
	out, err := s.repo.UpdateAsset(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy thiết bị")
	}
	return assetOut(out), nil
}

func (s *Service) DeleteAsset(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allowIT(ctx, a); err != nil {
		return nil, err
	}
	n, err := s.repo.DeleteAsset(ctx, id)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apperr.NotFound("Không tìm thấy thiết bị")
	}
	return omap.Of("ok", true), nil
}

func assetFields(b *omap.Map, create bool) (*omap.Map, error) {
	p := omap.New()
	if b.Has("name") || create {
		n := str(b, "name")
		if n == "" {
			return nil, apperr.BadRequest("Thiếu tên thiết bị")
		}
		p.Set("ten", cut(n, 200))
	}
	for _, k := range []struct{ in, col string }{{"type", "loai"}, {"owner", "nguoi_dung"}, {"note", "ghi_chu"}} {
		if b.Has(k.in) {
			p.Set(k.col, cut(str(b, k.in), 500))
		}
	}
	if b.Has("status") || create {
		st := str(b, "status")
		if st == "" {
			st = "active"
		}
		if !assetStatus[st] {
			return nil, apperr.BadRequest("Trạng thái thiết bị không hợp lệ")
		}
		p.Set("trang_thai", st)
	}
	return p, nil
}

/* ---------------- Ra client ---------------- */

var vn = time.FixedZone("ICT", 7*3600)

// ngayVN: thời điểm ISO -> dd/mm/yyyy giờ Việt Nam (như date của itData.js).
func ngayVN(v any) string {
	t, err := time.Parse(time.RFC3339Nano, jsval.Str(v))
	if err != nil {
		return ""
	}
	return t.In(vn).Format("02/01/2006")
}

// ticketOut: dòng it_yeu_cau -> object của giao diện (khoá như ticket trong itData.js: issue, requester, date...).
func ticketOut(r *omap.Map, a *actor.Actor) *omap.Map {
	src := jsval.Str(r.Val("nguon"))
	mine := a != nil && jsval.Truthy(a.UID) && jsval.Str(r.Val("nguoi_tao")) == jsval.Str(a.UID)
	return omap.Of(
		"id", r.Val("id"), "issue", r.Val("tieu_de"), "desc", r.Val("mo_ta"), "priority", r.Val("muc_do"),
		"category", r.Val("hang_muc"), "status", r.Val("trang_thai"), "deadline", jsval.Or(r.Val("han_xu_ly"), ""),
		"requester", r.Val("nguoi_yeu_cau"), "requesterUsername", r.Val("nguoi_yeu_cau_tk"),
		"roles", orArr(r.Val("vai_tro")), "images", orArr(r.Val("hinh_anh")),
		"stages", jsval.Or(r.Val("quy_trinh"), nil), "tasks", jsval.Or(r.Val("cong_viec"), nil),
		"source", src, "reported", src == "report", "page", r.Val("trang_bao"),
		"received", jsval.Truthy(r.Val("da_tiep_nhan")), "progress", jsval.ToNumber(r.Val("tien_do")),
		"mine", mine, "date", ngayVN(r.Val("ngay_tao")), "createdAt", r.Val("ngay_tao"), "updatedAt", r.Val("cap_nhat"),
	)
}

func assetOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "name", r.Val("ten"), "type", r.Val("loai"), "owner", r.Val("nguoi_dung"),
		"status", r.Val("trang_thai"), "note", r.Val("ghi_chu"), "updatedAt", r.Val("cap_nhat"))
}

func orArr(v any) any {
	if _, ok := v.([]any); ok {
		return v
	}
	return []any{}
}

func str(m *omap.Map, k string) string {
	v := m.Val(k)
	if jsval.IsNullish(v) {
		return ""
	}
	return jsval.Trim(jsval.Str(v))
}

// cut: cắt chuỗi theo số ký tự (không cắt đôi ký tự tiếng Việt).
func cut(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
