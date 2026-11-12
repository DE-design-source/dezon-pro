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
	if p == nil || p.Val("name") != "ZZ_tk Anh Long — Biệt thự" || p.Val("contractValueVnd") != 2.5e9 || p.Val("phone") != "0909" || p.Val("status") != "thiet-ke" {
		t.Fatalf("dự án tạo từ khách hàng: %v", p)
	}
	id := p.Val("id").(float64)

	// 2 đề mục cốt lõi tạo cùng dự án; không xoá / đổi tên được
	det, err := sa.GetProject(ctxA, aA, id)
	if err != nil {
		t.Fatal(err)
	}
	core := map[string]float64{}
	for _, x := range det.(*omap.Map).Val("phases").([]any) {
		if ph := x.(*omap.Map); isCorePhase(ph.Val("name")) {
			core[jsval.Str(ph.Val("name"))] = jsval.ToNumber(ph.Val("id"))
		}
	}
	if len(core) != 2 {
		t.Fatalf("dự án mới phải có 2 đề mục cốt lõi: %v", core)
	}
	if _, err := sa.AddPhase(ctxA, aA, id, omap.Of("name", corePhases[0].name)); status(err) != 400 {
		t.Errorf("thêm đề mục trùng tên đề mục cốt lõi phải 400: %v", err)
	}
	for _, pid := range core {
		if _, err := sa.RemoveItem(ctxA, aA, "tk_giai_doan", id, pid); status(err) != 400 {
			t.Errorf("xoá đề mục cốt lõi phải 400: %v", err)
		}
		if _, err := sa.UpdatePhase(ctxA, aA, id, pid, omap.Of("name", "Đổi tên")); status(err) != 400 {
			t.Errorf("đổi tên đề mục cốt lõi phải 400: %v", err)
		}
	}

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

	// dữ liệu riêng của giao diện bản cũ: tiến độ nhập tay (khi chưa có công việc), màu thanh, sơ đồ tổ chức, đơn mua hàng
	oc := omap.Of("parallel", []any{omap.Of("dept", "ban-co-van", "label", "Ban cố vấn", "color", "attendance", "icon", "advisory", "dashed", true, "caption", "Song song", "removable", false, "x", "bỏ")},
		"children", []any{omap.Of("dept", "custom-1", "label", "Kết cấu", "color", "qs", "icon", "dept", "removable", true)})
	if _, err := sa.UpdateProject(ctxA, aA, oid, omap.Of("progress", 27, "barColor", "var(--game)", "status", "dang-lam", "orgChart", oc)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []*omap.Map{omap.Of("barColor", "red;x"), omap.Of("progress", 120), omap.Of("status", "lung-tung"),
		omap.Of("orgChart", omap.Of("children", []any{omap.Of("label", "x", "icon", "<svg onload=x>")}))} {
		if _, err := sa.UpdateProject(ctxA, aA, oid, bad); status(err) != 400 {
			t.Errorf("%v phải 400: %v", bad, err)
		}
	}
	list, _ = sa.ListProjects(ctxA, aA, "design")
	for _, x := range list.(*omap.Map).Val("projects").([]any) {
		if m := x.(*omap.Map); m.Val("id") == oid {
			ch := m.Val("orgChart").(*omap.Map).Val("parallel").([]any)[0].(*omap.Map)
			if m.Val("progress") != 27.0 || m.Val("barColor") != "var(--game)" || ch.Val("icon") != "advisory" || ch.Has("x") || ch.Val("dashed") != true {
				t.Errorf("dự án tạo tay: %v", m)
			}
		}
	}
	po := []any{omap.Of("id", "pu1-1", "code", "PO-1", "item", "Thép", "value", 756, "due", "2026-08-30", "owner", "Trang", "stage", "complete", "assignees", []any{"Trang"})}
	tk, err := sa.AddTask(ctxA, aA, id, omap.Of("name", "Đặt thép", "phaseId", phID, "start", "2026-11-01", "end", "2026-11-02", "purchaseItems", po))
	if err != nil {
		t.Fatal(err)
	}
	if got := tk.(*omap.Map).Val("purchaseItems").([]any); len(got) != 1 || got[0].(*omap.Map).Val("value") != 756.0 || got[0].(*omap.Map).Has("dept") {
		t.Errorf("đơn mua hàng: %v", got)
	}
	ext := omap.Of("id", "x", "pm", "Dũng", "buyer", []any{"Ý", " ", "Tân"}, "leadTime", "14", "timeOffset", -2, "orderActualPc", "2026-07-13",
		"filesPm", []any{omap.Of("name", "a.pdf", "url", "/files/a.pdf")})
	if up, err := sa.UpdateTask(ctxA, aA, id, tk.(*omap.Map).Val("id").(float64), omap.Of("purchaseItems", []any{ext})); err != nil {
		t.Fatal(err)
	} else if m := up.(*omap.Map).Val("purchaseItems").([]any)[0].(*omap.Map); m.Val("pm") != "Dũng" || len(m.Val("buyer").([]any)) != 2 || m.Val("leadTime") != 14.0 || m.Val("timeOffset") != -2.0 || m.Val("orderActualPc") != "2026-07-13" || len(m.Val("filesPm").([]any)) != 1 || m.Has("accountant") {
		t.Errorf("trường phiếu đơn mua hàng: %v", m)
	}
	for _, bad := range []*omap.Map{omap.Of("id", "x", "createdAt", "13/07"), omap.Of("id", "x", "leadTime", "abc"), omap.Of("id", "x", "filesPm", []any{omap.Of("url", "javascript:alert(1)")})} {
		if _, err := sa.UpdateTask(ctxA, aA, id, tk.(*omap.Map).Val("id").(float64), omap.Of("purchaseItems", []any{bad})); status(err) != 400 {
			t.Errorf("phải 400: %v -> %v", bad, err)
		}
	}
	if _, err := sa.UpdateTask(ctxA, aA, id, tk.(*omap.Map).Val("id").(float64), omap.Of("purchaseItems", []any{omap.Of("id", "x", "due", "30/08")})); status(err) != 400 {
		t.Errorf("ngày đơn mua hàng sai phải 400: %v", err)
	}
	if tk.(*omap.Map).Val("purchaseFlow") != nil {
		t.Errorf("quy trình mua hàng mặc định phải null: %v", tk.(*omap.Map).Val("purchaseFlow"))
	}
	tkID := tk.(*omap.Map).Val("id").(float64)
	flow := []any{omap.Of("key", "s1", "label", " Báo giá ", "color", "#8b6fd6", "owners", []any{"Trang"}, "x", 1),
		omap.Of("key", "done", "label", "Hoàn tất", "color", "var(--done)", "dept", "Kho", "received", true)}
	if _, err := sa.UpdateTask(ctxA, aA, id, tkID, omap.Of("purchaseFlow", flow)); err != nil {
		t.Fatal(err)
	}
	d, _ = sa.GetProject(ctxA, aA, id)
	for _, ph := range d.(*omap.Map).Val("phases").([]any) {
		for _, x := range ph.(*omap.Map).Val("tasks").([]any) {
			if m := x.(*omap.Map); m.Val("id") == tkID {
				f, _ := m.Val("purchaseFlow").([]any)
				if len(f) != 2 || f[0].(*omap.Map).Val("label") != "Báo giá" || f[0].(*omap.Map).Has("x") ||
					f[1].(*omap.Map).Val("received") != true || f[1].(*omap.Map).Val("depts").([]any)[0] != "Kho" {
					t.Errorf("quy trình mua hàng đọc lại: %v", f)
				}
			}
		}
	}
	for _, bad := range []any{[]any{}, "x", []any{omap.Of("key", "a", "label", "")}, []any{omap.Of("key", "a", "label", "A"), omap.Of("key", "a", "label", "B")},
		[]any{omap.Of("key", "a", "label", "A", "color", "red;x")}} {
		if _, err := sa.UpdateTask(ctxA, aA, id, tkID, omap.Of("purchaseFlow", bad)); status(err) != 400 {
			t.Errorf("quy trình mua hàng sai phải 400: %v -> %v", bad, err)
		}
	}
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
	if n := len(d.(*omap.Map).Val("phases").([]any)); n != len(corePhases) || d.(*omap.Map).Val("comments").(*omap.Map).Len() != 0 {
		t.Errorf("xoá giai đoạn còn sót: %d giai đoạn (chỉ được còn %d đề mục cốt lõi), %v", n, len(corePhases), d.(*omap.Map).Val("comments"))
	}
	if _, err := sa.DeleteProject(ctxA, aA, id); err != nil {
		t.Fatal(err)
	}
}

// Trên qspro_gotest: bàn giao Kinh doanh -> dự án không làm mất dữ liệu đội thiết kế / thi công nhập.
// EnsureFromLead tạo 1 lần, gọi lại không ghi đè giá trị HĐ; RenameFromLead chỉ đổi tên còn do khách sinh ra;
// DetachFromLead: dự án đã đụng tới -> ẩn (rời giai đoạn) / bỏ liên kết (xoá khách), không bao giờ xoá; còn nguyên -> xoá;
// quay lại giai đoạn -> hiện lại đúng dự án cũ, không tạo trùng.
func TestBanGiaoTuKinhDoanhDB(t *testing.T) {
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
			_, _ = pool.Exec(bg, `delete from delivery_projects where name like 'ZZ\_bg%' or client_name like 'ZZ\_bg%'`)
			_, _ = pool.Exec(bg, `delete from sales_leads where customer_name like 'ZZ\_bg%'`)
		}
	}
	clean()
	t.Cleanup(clean)
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 1, NoScope: true})
	if err != nil || len(cts) < 1 {
		t.Fatalf("database thử cần ít nhất 1 công ty: %v", err)
	}
	ct := cts[0].Val("id")
	s := New(Deps{DB: db, Users: fakeUsers{}, UserFmt: fakeUsers{}, Projects: noProjects{}})
	ctx, a := tenant.With(bg, tenant.Ctx{Role: "admin", CongTyID: ct}), &actor.Actor{U: "an", R: "admin", CT: ct}

	newLead := func(ten string) *omap.Map {
		ins, err := db.InsertOne(ctx, "kd_khach_hang", omap.Of("ten_khach", ten, "loai_cong_trinh", "Biệt thự", "quy_mo", "300m2", "giai_doan", "tu-van"))
		if err != nil {
			t.Fatal(err)
		}
		for _, k := range []string{"design", "construction"} {
			if made, err := s.EnsureFromLead(ctx, a, ins[0], 2e9, k); err != nil || !made {
				t.Fatalf("tạo %s: %v %v", k, made, err)
			}
		}
		return ins[0]
	}
	byKind := func(leadID any) map[string]*omap.Map {
		out := map[string]*omap.Map{}
		ps, err := s.repo.ProjectsOfLead(ctx, leadID)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range ps {
			out[jsval.Str(p.Val("loai"))] = p
		}
		return out
	}
	listed := func(id float64) bool {
		rows, err := s.repo.ListProjects(ctx, "construction")
		if err != nil {
			t.Fatal(err)
		}
		rows2, _ := s.repo.ListProjects(ctx, "design")
		for _, r := range append(rows, rows2...) {
			if jsval.ToNumber(r.Val("id")) == id {
				return true
			}
		}
		return false
	}

	lead := newLead("ZZ_bg Chị Hoa")
	leadID := lead.Val("id")
	ps := byKind(leadID)
	if len(ps) != 2 || ps["design"].Val("ten") != "ZZ_bg Chị Hoa — Biệt thự (300m2)" || jsval.ToNumber(ps["construction"].Val("gia_tri_hd")) != 2e9 {
		t.Fatalf("dự án tạo từ khách: %v", ps)
	}
	designID, consID := jsval.ToNumber(ps["design"].Val("id")), jsval.ToNumber(ps["construction"].Val("id"))
	if ok, err := s.pristine(ctx, ps["design"]); err != nil || !ok {
		t.Fatalf("dự án vừa tạo phải còn nguyên: %v %v", ok, err)
	}

	// đội đặt giá trị HĐ (thi công), tự đổi tên (thiết kế); gọi lại Ensure không ghi đè, không tạo thêm
	if _, err := s.UpdateProject(ctx, a, consID, omap.Of("contractValueVnd", 5e9)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateProject(ctx, a, designID, omap.Of("name", "ZZ_bg Villa đội đặt")); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"design", "construction"} {
		if made, err := s.EnsureFromLead(ctx, a, lead, 3e9, k); err != nil || made {
			t.Fatalf("ensure lại %s: %v %v", k, made, err)
		}
	}
	if ps = byKind(leadID); len(ps) != 2 || jsval.ToNumber(ps["construction"].Val("gia_tri_hd")) != 5e9 {
		t.Fatalf("giá trị HĐ đội nhập bị ghi đè: %v", ps)
	}

	// khách đổi tên -> chỉ dự án còn tên sinh từ khách đổi theo; tên khách đổi ở cả 2; giá trị HĐ giữ
	newer := lead.Clone().Set("ten_khach", "ZZ_bg Chị Hoa Lê")
	if err := s.RenameFromLead(ctx, lead, newer); err != nil {
		t.Fatal(err)
	}
	ps = byKind(leadID)
	if ps["construction"].Val("ten") != "ZZ_bg Chị Hoa Lê — Biệt thự (300m2)" || ps["design"].Val("ten") != "ZZ_bg Villa đội đặt" ||
		ps["design"].Val("khach") != "ZZ_bg Chị Hoa Lê" || jsval.ToNumber(ps["construction"].Val("gia_tri_hd")) != 5e9 {
		t.Fatalf("đổi tên theo khách: %v", ps)
	}

	// chỉ rời trang thi công: chỉ dự án thi công ẩn, thiết kế vẫn hiện
	if err := s.DetachFromLead(ctx, leadID, "construction", false); err != nil {
		t.Fatal(err)
	}
	if ps = byKind(leadID); len(ps) != 2 || !listed(designID) || listed(consID) || jsval.Truthy(ps["design"].Val("tach_khach_hang")) {
		t.Fatalf("rời 1 trang chỉ ẩn dự án của trang đó: %v", ps)
	}
	// rời mọi trang: dự án đã sửa -> ẩn, giữ liên kết, không xoá
	if err := s.DetachFromLead(ctx, leadID, "", false); err != nil {
		t.Fatal(err)
	}
	if ps = byKind(leadID); len(ps) != 2 || !jsval.Truthy(ps["design"].Val("tach_khach_hang")) || listed(designID) || listed(consID) {
		t.Fatalf("rời giai đoạn phải ẩn, giữ dự án + liên kết: %v", ps)
	}
	// quay lại: hiện lại đúng 2 dự án cũ, không tạo trùng
	for _, k := range []string{"design", "construction"} {
		if made, err := s.EnsureFromLead(ctx, a, lead, 9e9, k); err != nil || made {
			t.Fatalf("quay lại %s: %v %v", k, made, err)
		}
	}
	if ps = byKind(leadID); len(ps) != 2 || jsval.ToNumber(ps["design"].Val("id")) != designID || jsval.ToNumber(ps["construction"].Val("id")) != consID ||
		!listed(designID) || !listed(consID) || jsval.ToNumber(ps["construction"].Val("gia_tri_hd")) != 5e9 {
		t.Fatalf("quay lại phải hiện đúng dự án cũ: %v", ps)
	}

	// xoá khách: dự án đã sửa -> bỏ liên kết, hiện như dự án tạo tay
	if err := s.DetachFromLead(ctx, leadID, "", true); err != nil {
		t.Fatal(err)
	}
	for _, id := range []float64{designID, consID} {
		if p, _ := s.repo.GetProject(ctx, id); p == nil || p.Val("khach_hang_id") != nil || jsval.Truthy(p.Val("tach_khach_hang")) || !listed(id) {
			t.Errorf("xoá khách: dự án %v phải còn, bỏ liên kết, hiện: %v", id, p)
		}
	}

	// khách 2: thiết kế còn nguyên -> xoá; thi công chỉ thêm 1 đề mục (không công việc) -> giữ, ẩn
	lead2 := newLead("ZZ_bg Anh Bình")
	ps = byKind(lead2.Val("id"))
	d2, c2 := jsval.ToNumber(ps["design"].Val("id")), jsval.ToNumber(ps["construction"].Val("id"))
	if _, err := s.AddPhase(ctx, a, c2, omap.Of("name", "Móng")); err != nil {
		t.Fatal(err)
	}
	if err := s.DetachFromLead(ctx, lead2.Val("id"), "", false); err != nil {
		t.Fatal(err)
	}
	if p, _ := s.repo.GetProject(ctx, d2); p != nil {
		t.Error("dự án thiết kế còn nguyên phải bị xoá khi rời giai đoạn")
	}
	if p, _ := s.repo.GetProject(ctx, c2); p == nil || !jsval.Truthy(p.Val("tach_khach_hang")) || listed(c2) {
		t.Errorf("dự án có đề mục riêng phải còn, ẩn: %v", p)
	}
	// quay lại: thi công hiện lại (không trùng), thiết kế tạo mới
	made := map[string]bool{}
	for _, k := range []string{"design", "construction"} {
		if made[k], err = s.EnsureFromLead(ctx, a, lead2, 1e9, k); err != nil {
			t.Fatal(err)
		}
	}
	if ps = byKind(lead2.Val("id")); !made["design"] || made["construction"] || len(ps) != 2 || jsval.ToNumber(ps["construction"].Val("id")) != c2 {
		t.Fatalf("quay lại sau khi xoá dự án còn nguyên: %v %v", made, ps)
	}

	// người dùng xoá dự án; khách vẫn ở giai đoạn bàn giao, đổi tên -> không tạo lại
	if _, err := s.DeleteProject(ctx, a, c2); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameFromLead(ctx, lead2, lead2.Clone().Set("ten_khach", "ZZ_bg Anh Bình 2")); err != nil {
		t.Fatal(err)
	}
	if ps = byKind(lead2.Val("id")); len(ps) != 1 || ps["construction"] != nil {
		t.Fatalf("dự án người dùng đã xoá bị tạo lại: %v", ps)
	}
}
