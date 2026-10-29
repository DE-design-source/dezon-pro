package sales

import (
	"context"
	"errors"
	"os"
	"regexp"
	"testing"
	"time"

	apperr "qspro-backend/internal/shared/errors"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ---- đồ giả ----

type fakeRepo struct {
	tinhNang string
	leads    map[float64]*omap.Map
	acts     []*omap.Map
	nextID   float64
}

func newFake() *fakeRepo { return &fakeRepo{leads: map[float64]*omap.Map{}, nextID: 1} }

func (f *fakeRepo) Company(ctx context.Context, id any) (*omap.Map, error) {
	return omap.Of("tinh_nang", f.tinhNang), nil
}
func (f *fakeRepo) ListLeads(ctx context.Context) ([]*omap.Map, error) {
	out := []*omap.Map{}
	for i := float64(1); i < f.nextID; i++ {
		if r, ok := f.leads[i]; ok {
			out = append(out, r)
		}
	}
	return out, nil
}
func (f *fakeRepo) GetLead(ctx context.Context, id float64) (*omap.Map, error) {
	return f.leads[id], nil
}
func (f *fakeRepo) InsertLead(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	r := row.Clone().Set("id", f.nextID)
	f.leads[f.nextID] = r
	f.nextID++
	return r, nil
}
func (f *fakeRepo) UpdateLead(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	r := f.leads[id]
	if r == nil {
		return nil, nil
	}
	patch.Each(func(k string, v any) { r.Set(k, v) })
	return r, nil
}
func (f *fakeRepo) DeleteLead(ctx context.Context, id float64) (int, error) {
	if f.leads[id] == nil {
		return 0, nil
	}
	delete(f.leads, id)
	return 1, nil
}
func (f *fakeRepo) ListActivities(ctx context.Context, leadID float64) ([]*omap.Map, error) {
	return f.acts, nil
}
func (f *fakeRepo) InsertActivity(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	f.acts = append(f.acts, row)
	return row, nil
}

type fakeUsers struct{ perms string }

func (u fakeUsers) GetByID(ctx context.Context, id any) (*omap.Map, error) {
	return omap.Of("perms", u.perms), nil
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

type fakeLines map[string][]any

func (l fakeLines) GetLines(ctx context.Context, ma any) ([]any, error) { return l[jsval.Str(ma)], nil }

type fakeProjects map[string]bool

func (p fakeProjects) GetProject(ctx context.Context, ma any) (*omap.Map, error) {
	if p[jsval.Str(ma)] {
		return omap.Of("maDA", ma), nil
	}
	return nil, nil
}

func newSvc(f *fakeRepo, perms string) *Service {
	s := New(Deps{Repo: f, Users: fakeUsers{perms}, UserFmt: fakeUsers{perms},
		Lines:    fakeLines{"DA-1": {omap.Of("thanhTienBan", 1000.0, "thanhTienVon", 600.0), omap.Of("thanhTienBan", 500.0, "thanhTienVon", 300.0)}},
		Projects: fakeProjects{"DA-1": true}})
	s.now = func() time.Time { return time.Date(2026, 10, 28, 20, 0, 0, 0, time.UTC) } // 29/10 giờ VN
	return s
}

func ctxAs(role string, ct any) (context.Context, *actor.Actor) {
	return tenant.With(context.Background(), tenant.Ctx{UID: "u-1", Role: role, CongTyID: ct}),
		&actor.Actor{UID: "u-1", U: "an", R: role, CT: ct}
}

func status(err error) int {
	var e *apperr.AppError
	if errors.As(err, &e) {
		st, _ := apperr.Status(err)
		return st
	}
	return 0
}

// ---- test ----

func TestQuyen(t *testing.T) {
	cases := []struct {
		name, role, perms, tinhNang string
		ct                          any
		want                        int // 0 = được
	}{
		{"nhân viên chưa cấp tab", "user", "boc,duan", "", "ct-1", 403},
		{"nhân viên được cấp tab", "user", "boc, kinhdoanh", "", "ct-1", 0},
		{"admin", "admin", "", "", "ct-1", 0},
		{"công ty thiếu tính năng", "admin", "", "boc,duan", "ct-1", 403},
		{"công ty có tính năng", "user", "kinhdoanh", "boc,kinhdoanh", "ct-1", 0},
		{"super chưa xem như công ty", "super", "", "", nil, 400},
		{"nhân viên không có công ty", "user", "kinhdoanh", "", nil, 403},
	}
	for _, c := range cases {
		f := newFake()
		f.tinhNang = c.tinhNang
		ctx, a := ctxAs(c.role, c.ct)
		_, err := newSvc(f, c.perms).ListLeads(ctx, a)
		if got := status(err); got != c.want {
			t.Errorf("%s: status %d (%v), mong %d", c.name, got, err, c.want)
		}
	}
}

func TestTaoSuaKhachHang(t *testing.T) {
	f := newFake()
	s := newSvc(f, "")
	ctx, a := ctxAs("admin", "ct-1")

	if _, err := s.CreateLead(ctx, a, omap.Of("name", "  ")); status(err) != 400 {
		t.Errorf("tên rỗng phải 400: %v", err)
	}
	if _, err := s.CreateLead(ctx, a, omap.Of("name", "A", "stage", "xx")); status(err) != 400 {
		t.Errorf("giai đoạn lạ phải 400: %v", err)
	}
	if _, err := s.CreateLead(ctx, a, omap.Of("name", "A", "maDA", "DA-cong-ty-khac")); status(err) != 400 {
		t.Errorf("dự án QS không thuộc công ty phải 400: %v", err)
	}
	l, err := s.CreateLead(ctx, a, omap.Of("name", " Anh Minh ", "valueVnd", 1.5e9, "assignees", []any{omap.Of("name", "Lan", "role", "TK"), omap.Of("name", "")},
		"categories", []any{"Thiết kế nội thất", " "}))
	if err != nil {
		t.Fatal(err)
	}
	m := l.(*omap.Map)
	if m.Val("name") != "Anh Minh" || m.Val("stage") != "tiep-can" || m.Val("creator") != "an" || m.Val("valueVnd") != 1.5e9 {
		t.Errorf("tạo: %s", mustJSON(t, m))
	}
	if len(m.Val("assignees").([]any)) != 1 || len(m.Val("categories").([]any)) != 1 || m.Val("wonAt") != nil || m.Val("quote") != nil {
		t.Errorf("tạo: lọc người phụ trách / hạng mục rỗng sai: %s", mustJSON(t, m))
	}
	id := m.Val("id").(float64)

	// kéo sang chốt hợp đồng -> có ngày chốt (giờ VN); sang bảng thiết kế vẫn giữ ngày chốt; trượt thầu -> xoá
	l, _ = s.UpdateLead(ctx, a, id, omap.Of("stage", "chot-hd"))
	if l.(*omap.Map).Val("wonAt") != "2026-10-29" {
		t.Errorf("chốt: wonAt = %v", l.(*omap.Map).Val("wonAt"))
	}
	s.now = func() time.Time { return time.Date(2026, 11, 5, 1, 0, 0, 0, time.UTC) }
	l, _ = s.UpdateLead(ctx, a, id, omap.Of("stage", "thiet-ke", "sub", "concept"))
	if m := l.(*omap.Map); m.Val("wonAt") != "2026-10-29" || m.Val("sub") != "concept" || m.Val("name") != "Anh Minh" {
		t.Errorf("sang thiết kế: %s", mustJSON(t, m))
	}
	l, _ = s.UpdateLead(ctx, a, id, omap.Of("stage", "truot-thau"))
	if l.(*omap.Map).Val("wonAt") != nil {
		t.Errorf("trượt thầu phải xoá wonAt: %v", l.(*omap.Map).Val("wonAt"))
	}

	// gắn dự án QS -> quote = tổng dòng bóc tách
	l, err = s.UpdateLead(ctx, a, id, omap.Of("maDA", "DA-1"))
	if err != nil {
		t.Fatal(err)
	}
	if q := l.(*omap.Map).Val("quote").(*omap.Map); q.Val("ban") != 1500.0 || q.Val("von") != 900.0 {
		t.Errorf("quote: %s", mustJSON(t, q))
	}
	if _, err := s.UpdateLead(ctx, a, 99, omap.Of("stage", "tu-van")); status(err) != 404 {
		t.Errorf("sửa khách không có phải 404: %v", err)
	}
	if r, err := s.DeleteLead(ctx, a, id); err != nil || r.(*omap.Map).Val("ok") != true {
		t.Errorf("xoá: %v %v", r, err)
	}
	if _, err := s.DeleteLead(ctx, a, id); status(err) != 404 {
		t.Errorf("xoá lần 2 phải 404: %v", err)
	}
}

func TestChamSoc(t *testing.T) {
	f := newFake()
	s := newSvc(f, "")
	ctx, a := ctxAs("admin", "ct-1")
	l, _ := s.CreateLead(ctx, a, omap.Of("name", "A"))
	id := l.(*omap.Map).Val("id").(float64)
	if _, err := s.AddActivity(ctx, a, id, omap.Of("type", "fax", "title", "x")); status(err) != 400 {
		t.Errorf("loại lạ phải 400: %v", err)
	}
	if _, err := s.AddActivity(ctx, a, id, omap.Of("type", "call", "title", "")); status(err) != 400 {
		t.Errorf("thiếu tiêu đề phải 400: %v", err)
	}
	if _, err := s.AddActivity(ctx, a, 99, omap.Of("type", "call", "title", "x")); status(err) != 404 {
		t.Errorf("khách không có phải 404: %v", err)
	}
	r, err := s.AddActivity(ctx, a, id, omap.Of("type", "call", "title", "Gọi", "outcome", "good", "next", "2026-11-02"))
	if err != nil {
		t.Fatal(err)
	}
	if m := r.(*omap.Map); m.Val("date") != "2026-10-29" || m.Val("by") != "an" || m.Val("next") != "2026-11-02" {
		t.Errorf("chăm sóc: %s", mustJSON(t, m))
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	s, err := omap.MarshalString(v)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// Rule 28 (database-rules.md): công ty A không đọc / sửa / xoá được khách hàng của B, không ghi chăm sóc vào khách của B.
// Chạy trên qspro_gotest (TEST_DATABASE_URL), cần 2 công ty có sẵn.
func TestCachLyCongTyDB(t *testing.T) {
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
			_, _ = pool.Exec(bg, `delete from sales_leads where customer_name like 'ZZ\_kd\_%'`)
		}
	})
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	svcOf := func(ct any) (*Service, context.Context, *actor.Actor) {
		ctx, a := ctxAs("admin", ct)
		a.UID, ctx = nil, tenant.With(context.Background(), tenant.Ctx{Role: "admin", CongTyID: ct})
		return New(Deps{DB: db, Users: fakeUsers{}, UserFmt: fakeUsers{}, Lines: fakeLines{}, Projects: fakeProjects{}}), ctx, a
	}
	sa, ctxA, aA := svcOf(cts[0].Val("id"))
	sb, ctxB, aB := svcOf(cts[1].Val("id"))

	lb, err := sb.CreateLead(ctxB, aB, omap.Of("name", "ZZ_kd_B", "stage", "bao-gia", "assignees", []any{omap.Of("name", "Lan", "role", "TK")}))
	if err != nil {
		t.Fatal(err)
	}
	idB := lb.(*omap.Map).Val("id").(float64)
	if _, err := sb.AddActivity(ctxB, aB, idB, omap.Of("type", "call", "title", "ZZ gọi")); err != nil {
		t.Fatal(err)
	}

	list, err := sa.ListLeads(ctxA, aA)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range list.(*omap.Map).Val("leads").([]any) {
		if x.(*omap.Map).Val("id") == idB {
			t.Error("A thấy khách hàng của B")
		}
	}
	if _, err := sa.UpdateLead(ctxA, aA, idB, omap.Of("name", "ZZ_kd_hack")); status(err) != 404 {
		t.Errorf("A sửa khách của B phải 404: %v", err)
	}
	if _, err := sa.DeleteLead(ctxA, aA, idB); status(err) != 404 {
		t.Errorf("A xoá khách của B phải 404: %v", err)
	}
	if _, err := sa.ListActivities(ctxA, aA, idB); status(err) != 404 {
		t.Errorf("A đọc chăm sóc của B phải 404: %v", err)
	}
	if _, err := sa.AddActivity(ctxA, aA, idB, omap.Of("type", "call", "title", "x")); status(err) != 404 {
		t.Errorf("A ghi chăm sóc vào khách của B phải 404: %v", err)
	}
	// lớp dữ liệu cũng chặn khi gọi thẳng (bỏ qua bước kiểm của service)
	if _, err := db.InsertOne(ctxA, "kd_cham_soc", omap.Of("khach_hang_id", idB, "ngay", "2026-10-28", "loai", "call", "tieu_de", "x")); err == nil {
		t.Error("lớp dữ liệu cho A chèn chăm sóc vào khách của B")
	}
	// B vẫn còn nguyên, jsonb / mảng đọc lại đúng
	got, err := sb.ListActivities(ctxB, aB, idB)
	if err != nil || len(got.([]any)) != 1 {
		t.Errorf("B đọc chăm sóc: %v %v", got, err)
	}
	lb2, _ := sb.repo.GetLead(ctxB, idB)
	if lb2 == nil || jsval.Str(lb2.Val("ten_khach")) != "ZZ_kd_B" || len(lb2.Val("phu_trach").([]any)) != 1 {
		t.Errorf("khách của B bị đổi: %v", lb2)
	}
}
