package delivery

import (
	"context"
	"errors"
	"os"
	"regexp"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

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

type noProjects struct{}

func (noProjects) GetProject(ctx context.Context, ma any) (*omap.Map, error) { return nil, nil }

// repo giả tối thiểu cho test quyền: chỉ Company + ListProjects được gọi
type permRepo struct {
	Repository
	tinhNang string
}

func (r permRepo) Company(ctx context.Context, id any) (*omap.Map, error) {
	return omap.Of("tinh_nang", r.tinhNang), nil
}
func (r permRepo) ListProjects(ctx context.Context, kind string) ([]*omap.Map, error) {
	return nil, nil
}

func status(err error) int {
	var e *apperr.AppError
	if errors.As(err, &e) {
		st, _ := apperr.Status(err)
		return st
	}
	return 0
}

func TestQuyenTheoTrang(t *testing.T) {
	cases := []struct {
		name, role, perms, tinhNang, kind string
		ct                                any
		want                              int
	}{
		{"nhân viên có thietke vào trang thiết kế", "user", "thietke", "", "design", "ct", 0},
		{"nhân viên có thietke vào trang thi công", "user", "thietke", "", "construction", "ct", 403},
		{"nhân viên có thicong", "user", "boc,thicong", "", "construction", "ct", 0},
		{"admin, công ty thiếu tính năng", "admin", "", "boc,thietke", "construction", "ct", 403},
		{"admin", "admin", "", "", "construction", "ct", 0},
		{"loại lạ", "admin", "", "", "xyz", "ct", 400},
		{"super chưa xem như công ty", "super", "", "", "design", nil, 400},
	}
	for _, c := range cases {
		s := New(Deps{Repo: permRepo{tinhNang: c.tinhNang}, Users: fakeUsers{c.perms}, UserFmt: fakeUsers{c.perms}})
		ctx := tenant.With(context.Background(), tenant.Ctx{UID: "u", Role: c.role, CongTyID: c.ct})
		_, err := s.ListProjects(ctx, &actor.Actor{UID: "u", U: "an", R: c.role, CT: c.ct}, c.kind)
		if got := status(err); got != c.want {
			t.Errorf("%s: %d (%v), mong %d", c.name, got, err, c.want)
		}
	}
}

// Trên qspro_gotest: tạo từ khách hàng Kinh doanh (1 lần / loại), tiến độ, khoá ngoại ghép, cách ly công ty (rule 28).
func TestDuAnTrienKhaiDB(t *testing.T) {
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
	clean := func() {
		if pool, err := db.Pool(); err == nil {
			_, _ = pool.Exec(bg, `delete from delivery_projects where name like 'ZZ\_tk%'`)
			_, _ = pool.Exec(bg, `delete from sales_leads where customer_name like 'ZZ\_tk%'`)
		}
	}
	clean()
	t.Cleanup(clean)
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	as := func(ct any) (*Service, context.Context, *actor.Actor) {
		return New(Deps{DB: db, Users: fakeUsers{}, UserFmt: fakeUsers{}, Projects: noProjects{}}),
			tenant.With(bg, tenant.Ctx{Role: "admin", CongTyID: ct}), &actor.Actor{U: "an", R: "admin", CT: ct}
	}
	sa, ctxA, aA := as(cts[0].Val("id"))
	sb, ctxB, aB := as(cts[1].Val("id"))

	// khách hàng Kinh doanh của A -> dự án thiết kế, gọi 2 lần chỉ tạo 1
	lead, err := db.InsertOne(ctxA, "kd_khach_hang", omap.Of("ten_khach", "ZZ_tk Anh Long", "loai_cong_trinh", "Biệt thự", "giai_doan", "thiet-ke", "sdt", "0909"))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []bool{true, false} {
		made, err := sa.EnsureFromLead(ctxA, aA, lead[0], 2.5e9, "design")
		if err != nil || made != want {
			t.Fatalf("EnsureFromLead lần %d: %v %v", i+1, made, err)
		}
	}
	list, err := sa.ListProjects(ctxA, aA, "design")
	if err != nil {
		t.Fatal(err)
	}
	var p *omap.Map
	for _, x := range list.(*omap.Map).Val("projects").([]any) {
		if x.(*omap.Map).Val("leadId") == lead[0].Val("id") {
			p = x.(*omap.Map)
		}
	}
	if p == nil || p.Val("name") != "ZZ_tk Anh Long — Biệt thự" || p.Val("contractValueVnd") != 2.5e9 || p.Val("phone") != "0909" {
		t.Fatalf("dự án tạo từ khách hàng: %v", p)
	}
	id := p.Val("id").(float64)

	// tiến độ: 2 công việc 40% + 80% -> 60%; mốc thu không tính
	ph, err := sa.AddPhase(ctxA, aA, id, omap.Of("name", "Concept", "members", []any{omap.Of("name", "Lan", "role", "KTS")}))
	if err != nil {
		t.Fatal(err)
	}
	phID := ph.(*omap.Map).Val("id")
	for _, b := range []*omap.Map{
		omap.Of("name", "Phác thảo", "phaseId", phID, "start", "2026-11-01", "end", "2026-11-10", "progress", 40, "owners", []any{"Lan"}),
		omap.Of("name", "3D", "phaseId", phID, "start", "2026-11-05", "end", "2026-11-20", "progress", 80),
		omap.Of("name", "Thu đợt 1", "phaseId", phID, "start", "2026-11-10", "end", "2026-11-10", "finType", "thu", "amountVnd", 1e9),
	} {
		if _, err := sa.AddTask(ctxA, aA, id, b); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := sa.AddTask(ctxA, aA, id, omap.Of("name", "x", "phaseId", phID, "start", "2026-11-10", "end", "2026-11-01")); status(err) != 400 {
		t.Errorf("kết thúc trước bắt đầu phải 400: %v", err)
	}
	list, _ = sa.ListProjects(ctxA, aA, "design")
	for _, x := range list.(*omap.Map).Val("projects").([]any) {
		if m := x.(*omap.Map); m.Val("id") == id && (m.Val("progress") != 60.0 || m.Val("taskCount") != 2.0) {
			t.Errorf("tiến độ: %v / %v", m.Val("progress"), m.Val("taskCount"))
		}
	}
	d, err := sa.GetProject(ctxA, aA, id)
	if err != nil {
		t.Fatal(err)
	}
	tasks := d.(*omap.Map).Val("phases").([]any)[0].(*omap.Map).Val("tasks").([]any)
	taskID := tasks[0].(*omap.Map).Val("id").(float64)
	if len(tasks) != 3 || tasks[2].(*omap.Map).Val("amountVnd") != 1e9 || len(tasks[0].(*omap.Map).Val("owners").([]any)) != 1 {
		t.Errorf("chi tiết công việc: %v", tasks)
	}
	if _, err := sa.AddComment(ctxA, aA, id, taskID, omap.Of("text", "@Lan xem giúp")); err != nil {
		t.Fatal(err)
	}

	// dự án khác (cùng công ty) không dùng được giai đoạn / công việc của dự án này
	other, err := sa.CreateProject(ctxA, aA, omap.Of("kind", "design", "name", "ZZ_tk khác"))
	if err != nil {
		t.Fatal(err)
	}
	oid := other.(*omap.Map).Val("id").(float64)
	if _, err := sa.AddTask(ctxA, aA, oid, omap.Of("name", "x", "phaseId", phID, "start", "2026-11-01", "end", "2026-11-02")); status(err) != 400 {
		t.Errorf("gắn công việc vào giai đoạn của dự án khác phải 400: %v", err)
	}
	if _, err := sa.AddComment(ctxA, aA, oid, taskID, omap.Of("text", "x")); status(err) != 404 {
		t.Errorf("bình luận công việc của dự án khác phải 404: %v", err)
	}
	if _, err := db.InsertOne(ctxA, "tk_cong_viec", omap.Of("du_an_id", oid, "giai_doan_id", phID, "ten", "x", "bat_dau", "2026-11-01", "ket_thuc", "2026-11-01")); err == nil {
		t.Error("database cho công việc trỏ sang giai đoạn của dự án khác")
	}

	// công ty B không thấy / không sửa / không xoá được
	listB, _ := sb.ListProjects(ctxB, aB, "design")
	for _, x := range listB.(*omap.Map).Val("projects").([]any) {
		if x.(*omap.Map).Val("id") == id {
			t.Error("B thấy dự án của A")
		}
	}
	for name, fn := range map[string]func() (any, error){
		"đọc": func() (any, error) { return sb.GetProject(ctxB, aB, id) },
		"sửa": func() (any, error) { return sb.UpdateProject(ctxB, aB, id, omap.Of("name", "ZZ_tk hack")) },
		"xoá": func() (any, error) { return sb.DeleteProject(ctxB, aB, id) },
		"thêm công việc": func() (any, error) {
			return sb.AddTask(ctxB, aB, id, omap.Of("name", "x", "phaseId", phID, "start", "2026-11-01", "end", "2026-11-02"))
		},
		"xoá giai đoạn": func() (any, error) { return sb.RemoveItem(ctxB, aB, "tk_giai_doan", id, phID.(float64)) },
	} {
		if _, err := fn(); status(err) != 404 {
			t.Errorf("B %s dự án của A phải 404: %v", name, err)
		}
	}
	if _, err := db.InsertOne(ctxB, "tk_giai_doan", omap.Of("du_an_id", id, "ten", "hack")); err == nil {
		t.Error("lớp dữ liệu cho B chèn giai đoạn vào dự án của A")
	}

	// xoá giai đoạn -> công việc + bình luận đi theo; xoá dự án
	if _, err := sa.RemoveItem(ctxA, aA, "tk_giai_doan", id, phID.(float64)); err != nil {
		t.Fatal(err)
	}
	d, _ = sa.GetProject(ctxA, aA, id)
	if n := len(d.(*omap.Map).Val("phases").([]any)); n != 0 || d.(*omap.Map).Val("comments").(*omap.Map).Len() != 0 {
		t.Errorf("xoá giai đoạn còn sót: %d giai đoạn, %v", n, d.(*omap.Map).Val("comments"))
	}
	if _, err := sa.DeleteProject(ctxA, aA, id); err != nil {
		t.Fatal(err)
	}
}
