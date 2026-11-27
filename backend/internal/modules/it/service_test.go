package it

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ---- đồ giả ----

type fakeRepo struct {
	tickets map[float64]*omap.Map
	assets  map[float64]*omap.Map
	staff   []*omap.Map
	nextID  float64
}

func newFake() *fakeRepo {
	return &fakeRepo{tickets: map[float64]*omap.Map{}, assets: map[float64]*omap.Map{}, nextID: 1}
}

func (f *fakeRepo) ListTickets(ctx context.Context, createdBy any) ([]*omap.Map, error) {
	out := []*omap.Map{}
	for i := f.nextID; i >= 1; i-- {
		if r, ok := f.tickets[i]; ok && (createdBy == nil || jsval.Str(r.Val("nguoi_tao")) == jsval.Str(createdBy)) {
			out = append(out, r.Clone())
		}
	}
	return out, nil
}
func (f *fakeRepo) GetTicket(ctx context.Context, id float64) (*omap.Map, error) {
	if r := f.tickets[id]; r != nil {
		return r.Clone(), nil
	}
	return nil, nil
}
func (f *fakeRepo) InsertTicket(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	r := row.Clone().Set("id", f.nextID)
	f.tickets[f.nextID] = r
	f.nextID++
	return r.Clone(), nil
}
func (f *fakeRepo) UpdateTicket(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	r := f.tickets[id]
	if r == nil {
		return nil, nil
	}
	r = r.Clone()
	patch.Each(func(k string, v any) { r.Set(k, v) })
	f.tickets[id] = r
	return r.Clone(), nil
}
func (f *fakeRepo) DeleteTicket(ctx context.Context, id float64) (int, error) {
	if f.tickets[id] == nil {
		return 0, nil
	}
	delete(f.tickets, id)
	return 1, nil
}
func (f *fakeRepo) ListAssets(ctx context.Context) ([]*omap.Map, error) {
	out := []*omap.Map{}
	for _, r := range f.assets {
		out = append(out, r)
	}
	return out, nil
}
func (f *fakeRepo) InsertAsset(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	r := row.Clone().Set("id", f.nextID)
	f.assets[f.nextID] = r
	f.nextID++
	return r, nil
}
func (f *fakeRepo) UpdateAsset(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	r := f.assets[id]
	if r == nil {
		return nil, nil
	}
	patch.Each(func(k string, v any) { r.Set(k, v) })
	return r, nil
}
func (f *fakeRepo) DeleteAsset(ctx context.Context, id float64) (int, error) {
	if f.assets[id] == nil {
		return 0, nil
	}
	delete(f.assets, id)
	return 1, nil
}
func (f *fakeRepo) ListStaff(ctx context.Context) ([]*omap.Map, error) { return f.staff, nil }

// fakeUsers: tài khoản đang đăng nhập có perms / họ tên cho trước.
type fakeUsers struct{ perms, name string }

func (u fakeUsers) GetByID(ctx context.Context, id any) (*omap.Map, error) {
	return omap.Of("perms", u.perms, "ho_ten", u.name), nil
}
func (u fakeUsers) UserOut(row *omap.Map) *omap.Map { return row }
func (u fakeUsers) PermsArr(v any) []any {
	out := []any{}
	for _, x := range regexp.MustCompile(`\s*,\s*`).Split(jsval.Str(v), -1) {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

type fakeNotifier struct{ got []string }

func (n *fakeNotifier) Notify(ctx context.Context, userID any, kind, title, body string, refID any) {
	n.got = append(n.got, jsval.Str(userID)+"|"+kind+"|"+title+"|"+body+"|"+jsval.Str(refID))
}

type fakeUploader struct{ paths, types []string }

func (u *fakeUploader) Upload(ctx context.Context, buf []byte, path, contentType string) (string, error) {
	u.paths = append(u.paths, path)
	u.types = append(u.types, contentType)
	return "/files/" + path, nil
}

func newSvc(f *fakeRepo, perms string) *Service {
	s := New(Deps{Repo: f, Users: fakeUsers{perms, "An Nguyễn"}, UserFmt: fakeUsers{}, Access: legacyAccess{perms: perms}})
	s.now = func() time.Time { return time.Date(2026, 10, 28, 20, 0, 0, 0, time.UTC) } // 29/10 giờ VN
	return s
}

func ctxAs(uid, role string, ct any) (context.Context, *actor.Actor) {
	return tenant.With(context.Background(), tenant.Ctx{UID: uid, Role: role, CongTyID: ct}),
		&actor.Actor{UID: uid, U: "user-" + uid, R: role, CT: ct}
}

func status(err error) int {
	var e *apperr.AppError
	if errors.As(err, &e) {
		st, _ := apperr.Status(err)
		return st
	}
	return 0
}

func as(xs ...any) []any { return xs }

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	s, err := omap.MarshalString(v)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// ---- test ----

func TestQuyenThanhVien(t *testing.T) {
	s := newSvc(newFake(), "it")
	ctx, _ := ctxAs("u1", "user", "ct-1")
	if _, err := s.ListTickets(ctx, nil, false); status(err) != 401 {
		t.Errorf("chưa đăng nhập: %v, mong 401", err)
	}
	ctx, a := ctxAs("u1", "user", nil)
	if _, err := s.CreateTicket(ctx, a, omap.Of("title", "x")); status(err) != 403 {
		t.Errorf("chưa có công ty: %v, mong 403", err)
	}
	ctx, a = ctxAs("u1", "super", nil)
	if _, err := s.ListStaff(ctx, a); status(err) != 400 {
		t.Errorf("super chưa xem như: %v, mong 400", err)
	}
}

// Phân quyền 3 cấp (N21): dòng riêng chỉ cho xem yêu cầu -> thấy mọi yêu cầu nhưng không sửa, không vào thiết bị;
// chưa nối Access -> chỉ thấy yêu cầu mình gửi.
func TestQuyenITPhanQuyen(t *testing.T) {
	f := newFake()
	ctx, a := ctxAs("u1", "user", "ct-1")
	if _, err := newSvc(f, "").CreateTicket(ctx, a, omap.Of("title", "Máy in kẹt giấy")); err != nil {
		t.Fatal(err)
	}
	s := newSvc(f, "it")
	s.access = legacyAccess{perms: "it", grant: omap.Of("it", omap.Of("main", []any{"view"}))}
	r, err := s.ListTickets(ctx, a, false)
	if err != nil || r.(*omap.Map).Val("canManage") != true {
		t.Errorf("xem mọi yêu cầu: %v %v", r, err)
	}
	if _, err := s.UpdateTicket(ctx, a, 1, omap.Of("status", "dangxuly")); status(err) != 403 {
		t.Errorf("sửa khi chỉ có quyền xem: %v, mong 403", err)
	}
	if _, err := s.ListAssets(ctx, a); status(err) != 403 {
		t.Errorf("thiết bị ngoài dòng phân quyền: %v, mong 403", err)
	}
	s.access = nil
	if r, err := s.ListTickets(ctx, a, false); err != nil || r.(*omap.Map).Val("canManage") != false {
		t.Errorf("thiếu Access: %v %v", r, err)
	}
}

// Nhân viên không có quyền IT: chỉ thấy yêu cầu mình gửi, không sửa yêu cầu / không đụng thiết bị.
// Có quyền IT hoặc admin thì được; xoá yêu cầu chỉ admin.
func TestQuyenIT(t *testing.T) {
	f := newFake()
	ctx1, a1 := ctxAs("u1", "user", "ct-1")
	ctx2, a2 := ctxAs("u2", "user", "ct-1")
	if _, err := newSvc(f, "").CreateTicket(ctx1, a1, omap.Of("title", "Máy in kẹt giấy")); err != nil {
		t.Fatal(err)
	}
	if _, err := newSvc(f, "").CreateTicket(ctx2, a2, omap.Of("title", "Mất mạng")); err != nil {
		t.Fatal(err)
	}

	staff := newSvc(f, "boc,duan")
	r, err := staff.ListTickets(ctx1, a1, false)
	if err != nil {
		t.Fatal(err)
	}
	m := r.(*omap.Map)
	if list := m.Val("tickets").([]any); len(list) != 1 || list[0].(*omap.Map).Val("issue") != "Máy in kẹt giấy" || m.Val("canManage") != false {
		t.Errorf("nhân viên thường thấy: %v", mustJSON(t, m))
	}
	if _, err := staff.UpdateTicket(ctx1, a1, 1, omap.Of("status", "dangxuly")); status(err) != 403 {
		t.Errorf("PATCH không quyền: %v, mong 403", err)
	}
	if _, err := staff.ListAssets(ctx1, a1); status(err) != 403 {
		t.Errorf("thiết bị không quyền: %v, mong 403", err)
	}
	if _, err := staff.CreateAsset(ctx1, a1, omap.Of("name", "Laptop")); status(err) != 403 {
		t.Errorf("thêm thiết bị không quyền: %v, mong 403", err)
	}

	itStaff := newSvc(f, "boc, it")
	r, err = itStaff.ListTickets(ctx1, a1, false)
	if err != nil {
		t.Fatal(err)
	}
	if m := r.(*omap.Map); len(m.Val("tickets").([]any)) != 2 || m.Val("canManage") != true {
		t.Errorf("quyền IT thấy: %v", mustJSON(t, m))
	}
	if r, _ := itStaff.ListTickets(ctx1, a1, true); len(r.(*omap.Map).Val("tickets").([]any)) != 1 {
		t.Errorf("mine=1 phải chỉ còn yêu cầu của tôi")
	}
	if _, err := itStaff.UpdateTicket(ctx1, a1, 2, omap.Of("status", "dangxuly", "received", true, "progress", 33.4)); err != nil {
		t.Errorf("PATCH có quyền IT: %v", err)
	}
	if got := f.tickets[2]; got.Val("trang_thai") != "dangxuly" || got.Val("da_tiep_nhan") != true || got.Val("tien_do") != 33.0 {
		t.Errorf("PATCH ghi sai: %v", mustJSON(t, got))
	}
	if _, err := itStaff.CreateAsset(ctx1, a1, omap.Of("name", "Laptop")); err != nil {
		t.Errorf("thêm thiết bị có quyền IT: %v", err)
	}
	if _, err := itStaff.DeleteTicket(ctx1, a1, 1); status(err) != 403 {
		t.Errorf("xoá yêu cầu không phải admin: %v, mong 403", err)
	}

	ctxA, admin := ctxAs("ad", "admin", "ct-1")
	adm := newSvc(f, "")
	if _, err := adm.ListAssets(ctxA, admin); err != nil {
		t.Errorf("admin đọc thiết bị: %v", err)
	}
	if _, err := adm.DeleteTicket(ctxA, admin, 1); err != nil {
		t.Errorf("admin xoá: %v", err)
	}
	if _, err := adm.DeleteTicket(ctxA, admin, 1); status(err) != 404 {
		t.Errorf("xoá lần 2: %v, mong 404", err)
	}
}

func TestKiemDuLieuVao(t *testing.T) {
	f := newFake()
	s := newSvc(f, "")
	ctx, a := ctxAs("ad", "admin", "ct-1")
	png := "data:image/png;base64,iVBORw0KGgo="
	imgs := func(n int) []any {
		out := []any{}
		for i := 0; i < n; i++ {
			out = append(out, omap.Of("name", "a.png", "url", "/files/it/a.png"))
		}
		return out
	}
	bad := []struct {
		name string
		body *omap.Map
	}{
		{"thiếu tiêu đề", omap.Of("title", "   ")},
		{"priority sai", omap.Of("title", "x", "priority", "gap")},
		{"category sai", omap.Of("title", "x", "category", "printer")},
		{"deadline sai định dạng", omap.Of("title", "x", "deadline", "16/11/2026")},
		{"deadline ngày không có", omap.Of("title", "x", "deadline", "2026-02-30")},
		{"roles không phải mảng", omap.Of("title", "x", "roles", "an")},
		{"quá 8 ảnh", omap.Of("title", "x", "images", imgs(9))},
		{"ảnh không phải data:image", omap.Of("title", "x", "images", as(omap.Of("name", "a.txt", "data", "data:text/plain;base64,YQ==")))},
		{"ảnh base64 hỏng", omap.Of("title", "x", "images", as(omap.Of("data", "data:image/png;base64,@@@")))},
	}
	for _, c := range bad {
		if _, err := s.CreateTicket(ctx, a, c.body); status(err) != 400 {
			t.Errorf("tạo - %s: %v, mong 400", c.name, err)
		}
	}
	if len(f.tickets) != 0 {
		t.Fatalf("dữ liệu sai vẫn được ghi: %d dòng", len(f.tickets))
	}
	if _, err := s.CreateTicket(ctx, a, omap.Of("title", "ok", "images", imgs(8))); err != nil {
		t.Errorf("8 ảnh phải được: %v", err)
	}
	if _, err := s.CreateTicket(ctx, a, omap.Of("title", "ok", "images", as(omap.Of("data", png)))); err == nil {
		t.Error("chưa có kho file mà vẫn nhận ảnh data:")
	}
	for _, c := range []struct {
		name string
		body *omap.Map
	}{
		{"status sai", omap.Of("status", "xong")},
		{"progress âm", omap.Of("progress", -1.0)},
		{"progress > 100", omap.Of("progress", 101.0)},
		{"progress không phải số", omap.Of("progress", "abc")},
		{"tasks không phải mảng", omap.Of("tasks", "x")},
		{"stages là object", omap.Of("stages", omap.Of("a", 1.0))},
		{"xoá tiêu đề", omap.Of("title", "")},
	} {
		if _, err := s.UpdateTicket(ctx, a, 1, c.body); status(err) != 400 {
			t.Errorf("sửa - %s: %v, mong 400", c.name, err)
		}
	}
	if _, err := s.UpdateTicket(ctx, a, 99, omap.Of("status", "dong")); status(err) != 404 {
		t.Errorf("sửa yêu cầu không có: %v, mong 404", err)
	}
	if _, err := s.UpdateTicket(ctx, a, 1, omap.Of("tasks", nil, "deadline", "")); err != nil {
		t.Errorf("tasks null / deadline rỗng phải được: %v", err)
	}
	if r := f.tickets[1]; !r.Has("cong_viec") || r.Val("cong_viec") != nil || r.Val("han_xu_ly") != nil {
		t.Errorf("null phải ghi null: %v", mustJSON(t, r))
	}
	if _, err := s.CreateAsset(ctx, a, omap.Of("name", " ")); status(err) != 400 {
		t.Errorf("thiết bị thiếu tên: %v", err)
	}
	if _, err := s.CreateAsset(ctx, a, omap.Of("name", "Laptop", "status", "lost")); status(err) != 400 {
		t.Errorf("trạng thái thiết bị sai: %v", err)
	}
}

// roles làm sạch: bỏ vai trò rỗng tên / không phải object; people nhận chuỗi và object, bỏ người rỗng tên, bỏ khoá lạ.
func TestRolesLamSach(t *testing.T) {
	got, err := rolesIn(as(
		omap.Of("label", "  ", "people", as("Ai đó")),
		"chuỗi",
		omap.Of("label", "Phê duyệt", "people", as("  Hà ", omap.Of("name", "Tuấn", "username", "tuan", "x", 1.0), omap.Of("name", ""), 5.0)),
		omap.Of("label", "Thực hiện"),
	))
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"label":"Phê duyệt","people":[{"name":"Hà"},{"name":"Tuấn","username":"tuan"}]},{"label":"Thực hiện","people":[]}]`
	if s := mustJSON(t, got); s != want {
		t.Errorf("roles = %s\nmong %s", s, want)
	}
}

// Ảnh data URL lưu qua Uploader (it/<số>-<số>.png|jpg), url /files/... giữ nguyên.
func TestAnhDinhKem(t *testing.T) {
	f := newFake()
	s := newSvc(f, "")
	up := &fakeUploader{}
	s.uploader = up
	ctx, a := ctxAs("ad", "admin", "ct-1")
	_, err := s.CreateTicket(ctx, a, omap.Of("title", "Lỗi màn hình", "images", as(
		omap.Of("name", "cu.png", "url", "/files/it/cu.png"),
		omap.Of("name", "moi.png", "data", "data:image/png;base64,iVBORw0KGgo="),
		omap.Of("data", "data:image/jpg;base64,/9j/4AAQ"),
	)))
	if err != nil {
		t.Fatal(err)
	}
	if len(up.paths) != 2 || !regexp.MustCompile(`^it/\d+-\d+\.png$`).MatchString(up.paths[0]) ||
		!regexp.MustCompile(`^it/\d+-\d+\.jpg$`).MatchString(up.paths[1]) || strings.Join(up.types, ",") != "image/png,image/jpeg" {
		t.Errorf("upload: %v %v", up.paths, up.types)
	}
	img := f.tickets[1].Val("hinh_anh").([]any)
	if len(img) != 3 || img[0].(*omap.Map).Val("url") != "/files/it/cu.png" || img[1].(*omap.Map).Val("url") != "/files/"+up.paths[0] ||
		img[2].(*omap.Map).Val("name") != "anh.jpg" {
		t.Errorf("hinh_anh = %s", mustJSON(t, img))
	}
}

// Tạo mới: báo người trong roles có username (trừ người tạo); không ai được giao thì báo nhân viên có quyền IT.
// PATCH: chỉ báo người VỪA được thêm (it_assign); không đổi roles thì không báo.
func TestThongBao(t *testing.T) {
	f := newFake()
	f.staff = []*omap.Map{
		omap.Of("id", 7.0, "username", "tuan", "role", "staff", "perms", "it"),
		omap.Of("id", 8.0, "username", "mai", "role", "staff", "perms", ""),
		omap.Of("id", 9.0, "username", "lan", "role", "staff", "perms", "boc,it"),
		omap.Of("id", 1.0, "username", "user-u1", "role", "staff", "perms", "it"),
		omap.Of("id", 2.0, "username", "boss", "role", "admin", "perms", ""),
	}
	n := &fakeNotifier{}
	s := newSvc(f, "it")
	s.notifier, s.userFmt = n, fakeUsers{}
	ctx, a := ctxAs("u1", "user", "ct-1")
	p := func(name, user string) *omap.Map { return omap.Of("name", name, "username", user) }

	if _, err := s.CreateTicket(ctx, a, omap.Of("title", "Mất mạng", "roles", as(
		omap.Of("label", "Thực hiện", "people", as(p("Mai", "mai"), p("Tôi", "user-u1"), "Gõ tay", p("Lạ", "nguoila"))),
	))); err != nil {
		t.Fatal(err)
	}
	if want := "8|it_ticket|Yêu cầu IT mới #1|An Nguyễn: Mất mạng|1"; strings.Join(n.got, ",") != want {
		t.Errorf("tạo có người giao: %v, mong %v", n.got, want)
	}

	n.got = nil
	if _, err := s.CreateTicket(ctx, a, omap.Of("title", "Máy in", "source", "report")); err != nil {
		t.Fatal(err)
	}
	if want := "7|it_ticket|Yêu cầu IT mới #2|An Nguyễn: Máy in|2,9|it_ticket|Yêu cầu IT mới #2|An Nguyễn: Máy in|2"; strings.Join(n.got, ",") != want {
		t.Errorf("tạo không ai được giao: %v, mong %v", n.got, want)
	}

	n.got = nil
	// dữ liệu đọc từ database: phần tử jsonb là map[string]any
	f.tickets[1].Set("vai_tro", as(map[string]any{"label": "Thực hiện", "people": []any{map[string]any{"name": "Mai", "username": "mai"}}}))
	if _, err := s.UpdateTicket(ctx, a, 1, omap.Of("roles", as(
		omap.Of("label", "Thực hiện", "people", as(p("Mai", "mai"), p("Tuấn", "tuan"))),
		omap.Of("label", "Điều phối", "people", as(p("Tuấn", "tuan"), p("Tôi", "user-u1"))),
	))); err != nil {
		t.Fatal(err)
	}
	if want := "7|it_assign|Bạn được giao xử lý yêu cầu IT #1|Mất mạng|1"; strings.Join(n.got, ",") != want {
		t.Errorf("PATCH thêm người: %v, mong %v", n.got, want)
	}

	n.got = nil
	if _, err := s.UpdateTicket(ctx, a, 1, omap.Of("status", "dangxuly")); err != nil {
		t.Fatal(err)
	}
	if len(n.got) != 0 {
		t.Errorf("không đổi roles mà vẫn báo: %v", n.got)
	}
}

func TestTicketOut(t *testing.T) {
	row := omap.Of("id", 5.0, "tieu_de", "x", "nguon", "report", "nguoi_tao", "u1", "ngay_tao", "2026-10-28T17:30:00Z",
		"han_xu_ly", nil, "vai_tro", nil, "tien_do", 40.0, "da_tiep_nhan", true)
	o := ticketOut(row, &actor.Actor{UID: "u1"})
	if o.Val("date") != "29/10/2026" || o.Val("reported") != true || o.Val("mine") != true || o.Val("deadline") != "" ||
		mustJSON(t, o.Val("roles")) != "[]" || o.Val("progress") != 40.0 || o.Val("received") != true {
		t.Errorf("ticketOut = %s", mustJSON(t, o))
	}
	row.Set("ngay_tao", "2026-10-28T16:59:00Z").Set("nguon", "manual")
	o = ticketOut(row, &actor.Actor{UID: "u2"})
	if o.Val("date") != "28/10/2026" || o.Val("reported") != false || o.Val("mine") != false {
		t.Errorf("ticketOut người khác = %s", mustJSON(t, o))
	}
	if o := ticketOut(row, &actor.Actor{}); o.Val("mine") != false {
		t.Error("không có UID thì mine phải false")
	}
}

// Người có quyền IT (admin / được cấp 'it') xếp trước rồi theo tên; thiếu họ tên dùng tên đăng nhập; không trả perms.
func TestListStaff(t *testing.T) {
	f := newFake()
	f.staff = []*omap.Map{
		omap.Of("username", "mai", "ho_ten", "sao mai", "phong_ban", "", "role", "staff", "perms", "boc"),
		omap.Of("username", "tuan", "ho_ten", "Tuấn", "phong_ban", "IT", "role", "staff", "perms", "boc,it"),
		omap.Of("username", "lien", "ho_ten", "", "phong_ban", "", "role", "admin", "perms", ""),
		omap.Of("username", "", "ho_ten", "rỗng", "role", "staff"),
		omap.Of("username", "binh", "ho_ten", "Bình", "role", "staff", "perms", ""),
	}
	s := newSvc(f, "")
	s.userFmt = fakeUsers{}
	ctx, a := ctxAs("u1", "user", "ct-1")
	r, err := s.ListStaff(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, x := range r.(*omap.Map).Val("staff").([]any) {
		m := x.(*omap.Map)
		if m.Has("perms") || m.Has("id") {
			t.Errorf("không được trả perms / id: %v", m)
		}
		got = append(got, jsval.Str(m.Val("username"))+"|"+jsval.Str(m.Val("name"))+"|"+jsval.Str(m.Val("it")))
	}
	want := "lien|lien|true,tuan|Tuấn|true,binh|Bình|false,mai|sao mai|false"
	if strings.Join(got, ",") != want {
		t.Errorf("staff = %v, mong %v", got, want)
	}
}

// Rule 28 (database-rules.md): công ty A không đọc / sửa / xoá được yêu cầu và thiết bị của B; jsonb / date đọc ra đúng kiểu.
// Chạy trên qspro_gotest (TEST_DATABASE_URL, đã migrate 0048), cần 2 công ty có sẵn.
func TestCachLyCongTyIT_DB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	t.Cleanup(db.Close)
	bg := context.Background()
	t.Cleanup(func() {
		if pool, err := db.Pool(); err == nil {
			_, _ = pool.Exec(bg, `delete from it_tickets where title like 'ZZ\_it\_%'`)
			_, _ = pool.Exec(bg, `delete from it_assets where asset_name like 'ZZ\_it\_%'`)
		}
	})
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	svcOf := func(ct any) (*Service, context.Context, *actor.Actor) {
		ctx := tenant.With(bg, tenant.Ctx{Role: "admin", CongTyID: ct})
		return New(Deps{DB: db, Users: fakeUsers{}, UserFmt: fakeUsers{}, Access: legacyAccess{}}), ctx, &actor.Actor{U: "zz", R: "admin", CT: ct}
	}
	sa, ctxA, aA := svcOf(cts[0].Val("id"))
	sb, ctxB, aB := svcOf(cts[1].Val("id"))

	tb, err := sb.CreateTicket(ctxB, aB, omap.Of("title", "ZZ_it_B", "priority", "high", "category", "network", "deadline", "2026-12-01",
		"roles", as(omap.Of("label", "Thực hiện", "people", as(omap.Of("name", "Tuấn", "username", "tuan")))),
		"images", as(omap.Of("name", "a.png", "url", "/files/it/a.png"))))
	if err != nil {
		t.Fatal(err)
	}
	idB := tb.(*omap.Map).Val("id").(float64)
	if d := jsval.Str(tb.(*omap.Map).Val("date")); !regexp.MustCompile(`^\d{2}/\d{2}/\d{4}$`).MatchString(d) {
		t.Errorf("date = %q", d)
	}
	if _, err := sb.UpdateTicket(ctxB, aB, idB, omap.Of("tasks", as(omap.Of("id", "t1", "title", "Kiểm tra")), "stages", as("moi", "xong"), "progress", 50.0)); err != nil {
		t.Fatal(err)
	}
	ab, err := sb.CreateAsset(ctxB, aB, omap.Of("name", "ZZ_it_laptop", "type", "Laptop"))
	if err != nil {
		t.Fatal(err)
	}
	assetB := ab.(*omap.Map).Val("id").(float64)

	list, err := sa.ListTickets(ctxA, aA, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range list.(*omap.Map).Val("tickets").([]any) {
		if x.(*omap.Map).Val("id") == idB {
			t.Error("A thấy yêu cầu của B")
		}
	}
	if r, _ := sa.repo.GetTicket(ctxA, idB); r != nil {
		t.Error("repo của A đọc được yêu cầu của B")
	}
	if _, err := sa.UpdateTicket(ctxA, aA, idB, omap.Of("title", "ZZ_it_hack")); status(err) != 404 {
		t.Errorf("A sửa yêu cầu của B phải 404: %v", err)
	}
	if _, err := sa.DeleteTicket(ctxA, aA, idB); status(err) != 404 {
		t.Errorf("A xoá yêu cầu của B phải 404: %v", err)
	}
	if rows, err := db.Update(ctxA, "it_yeu_cau", database.Eq("id", idB), omap.Of("tieu_de", "ZZ_it_hack")); err != nil || len(rows) != 0 {
		t.Errorf("lớp dữ liệu cho A sửa yêu cầu của B: %v %v", rows, err)
	}
	al, err := sa.ListAssets(ctxA, aA)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range al.(*omap.Map).Val("assets").([]any) {
		if x.(*omap.Map).Val("id") == assetB {
			t.Error("A thấy thiết bị của B")
		}
	}
	if _, err := sa.UpdateAsset(ctxA, aA, assetB, omap.Of("status", "broken")); status(err) != 404 {
		t.Errorf("A sửa thiết bị của B phải 404: %v", err)
	}
	if _, err := sa.DeleteAsset(ctxA, aA, assetB); status(err) != 404 {
		t.Errorf("A xoá thiết bị của B phải 404: %v", err)
	}

	// B còn nguyên, jsonb / date đọc lại đúng kiểu
	r, err := sb.repo.GetTicket(ctxB, idB)
	if err != nil || r == nil {
		t.Fatalf("B đọc lại: %v %v", r, err)
	}
	if r.Val("tieu_de") != "ZZ_it_B" || r.Val("han_xu_ly") != "2026-12-01" || jsval.ToNumber(r.Val("tien_do")) != 50 {
		t.Errorf("yêu cầu của B bị đổi / sai kiểu: %s", mustJSON(t, r))
	}
	roles, ok1 := r.Val("vai_tro").([]any)
	imgs, ok2 := r.Val("hinh_anh").([]any)
	tasks, ok3 := r.Val("cong_viec").([]any)
	stages, ok4 := r.Val("quy_trinh").([]any)
	if !ok1 || !ok2 || !ok3 || !ok4 || len(roles) != 1 || len(imgs) != 1 || len(tasks) != 1 || len(stages) != 2 {
		t.Errorf("jsonb đọc sai kiểu: %s", mustJSON(t, r))
	}
	if u := roleUsers(r); len(u) != 1 || u[0] != "tuan" {
		t.Errorf("roleUsers từ jsonb = %v", u)
	}
	if out := ticketOut(r, aB); out.Val("deadline") != "2026-12-01" || !regexp.MustCompile(`^\d{2}/\d{2}/\d{4}$`).MatchString(jsval.Str(out.Val("date"))) {
		t.Errorf("ticketOut từ DB = %s", mustJSON(t, out))
	}
	if _, err := sb.DeleteTicket(ctxB, aB, idB); err != nil {
		t.Errorf("B xoá yêu cầu của mình: %v", err)
	}
	if _, err := sb.DeleteAsset(ctxB, aB, assetB); err != nil {
		t.Errorf("B xoá thiết bị của mình: %v", err)
	}
}
