package sales

import (
	"context"
	"os"
	"regexp"
	"sort"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ---- repo giả cho đổi tên (service_rename.go) ----

func (f *fakeRepo) LeadPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	rows, err := f.ListLeads(ctx)
	return onlyIDs(rows, ids), err
}
func (f *fakeRepo) TaskPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	return onlyIDs(byID(f.tasks), ids), nil
}
func (f *fakeRepo) AppointmentPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	return onlyIDs(byID(f.appts), ids), nil
}

func onlyIDs(rows []*omap.Map, ids []float64) []*omap.Map {
	if len(ids) == 0 {
		return rows
	}
	want := map[float64]bool{}
	for _, id := range ids {
		want[id] = true
	}
	out := []*omap.Map{}
	for _, r := range rows {
		if want[jsval.ToNumber(r.Val("id"))] {
			out = append(out, r)
		}
	}
	return out
}
func (f *fakeRepo) Accounts(ctx context.Context) ([]*omap.Map, error) { return f.staff, nil }

func byID(m map[float64]*omap.Map) []*omap.Map {
	out := []*omap.Map{}
	for _, r := range m {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return jsval.ToNumber(out[i].Val("id")) < jsval.ToNumber(out[j].Val("id")) })
	return out
}

// countingRepo: đếm số lần ghi để kiểm "chỉ ghi dòng thật sự đổi".
type countingRepo struct {
	*fakeRepo
	writes []string
}

func (c *countingRepo) UpdateLead(ctx context.Context, id float64, p *omap.Map) (*omap.Map, error) {
	c.writes = append(c.writes, "lead:"+jsval.Str(id))
	return c.fakeRepo.UpdateLead(ctx, id, p)
}
func (c *countingRepo) UpdateTask(ctx context.Context, id float64, p *omap.Map) (*omap.Map, error) {
	c.writes = append(c.writes, "task:"+jsval.Str(id))
	return c.fakeRepo.UpdateTask(ctx, id, p)
}
func (c *countingRepo) UpdateAppointment(ctx context.Context, id float64, p *omap.Map) (*omap.Map, error) {
	c.writes = append(c.writes, "appt:"+jsval.Str(id))
	return c.fakeRepo.UpdateAppointment(ctx, id, p)
}

func renameFixture(staff ...*omap.Map) *countingRepo {
	f := newFake()
	f.staff = staff
	// 1: mục có username của tuan + mục chỉ có tên (hoa thường khác) + người khác; quản lý / người tạo là tên cũ
	f.leads[1] = omap.Of("id", 1.0, "ten_khach", "A", "quan_ly", "Tuấn", "nguoi_tao_ten", " tuấn ", "phu_trach", []any{
		omap.Of("name", "Tuấn", "role", "Sale", "username", "tuan", "since", "2026-01-02", "dept", "kinhdoanh"),
		omap.Of("name", "TUẤN ", "role", "TK", "since", "2026-02-03", "dept", "thietke"),
		omap.Of("name", "Lan", "role", "QS", "username", "lan"),
	})
	// 2: mục của tài khoản KHÁC tên Tuấn (username khác) -> giữ nguyên; người tạo là username -> giữ
	f.leads[2] = omap.Of("id", 2.0, "ten_khach", "B", "quan_ly", "Lan", "nguoi_tao_ten", "tuan", "phu_trach", []any{
		omap.Of("name", "Tuấn", "role", "Sale", "username", "tuan2"),
	})
	// 3: không liên quan
	f.leads[3] = omap.Of("id", 3.0, "ten_khach", "C", "quan_ly", "", "phu_trach", []any{})
	f.nextID = 4
	f.tasks = map[float64]*omap.Map{
		10: omap.Of("id", 10.0, "khach_hang_id", 1.0, "phu_trach", []any{omap.Of("name", "Tuấn", "username", ""), omap.Of("name", "Lan", "username", "lan")}),
		11: omap.Of("id", 11.0, "khach_hang_id", 1.0, "phu_trach", []any{omap.Of("name", "Lan", "username", "lan")}),
	}
	f.appts = map[float64]*omap.Map{
		20: omap.Of("id", 20.0, "khach_hang_id", 1.0, "thanh_vien", []any{"Lan", "Tuấn"}),
		21: omap.Of("id", 21.0, "khach_hang_id", 2.0, "thanh_vien", []any{"Lan"}),
	}
	return &countingRepo{fakeRepo: f}
}

func TestUserRenamed(t *testing.T) {
	ctx := context.Background()
	tuan := omap.Of("id", "u1", "username", "tuan", "ho_ten", "Nguyễn Quốc Tuấn")
	lan := omap.Of("id", "u2", "username", "lan", "ho_ten", "Lan")

	r := renameFixture(tuan, lan)
	s := New(Deps{Repo: r})
	if err := s.UserRenamed(ctx, "c1", "tuan", "Tuấn", "Nguyễn Quốc Tuấn"); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"lead1": `{"id":1,"ten_khach":"A","quan_ly":"Nguyễn Quốc Tuấn","nguoi_tao_ten":"Nguyễn Quốc Tuấn","phu_trach":[` +
			`{"name":"Nguyễn Quốc Tuấn","role":"Sale","username":"tuan","since":"2026-01-02","dept":"kinhdoanh"},` +
			`{"name":"Nguyễn Quốc Tuấn","role":"TK","since":"2026-02-03","dept":"thietke","username":"tuan"},` +
			`{"name":"Lan","role":"QS","username":"lan"}]}`,
		"lead2":  `{"id":2,"ten_khach":"B","quan_ly":"Lan","nguoi_tao_ten":"tuan","phu_trach":[{"name":"Tuấn","role":"Sale","username":"tuan2"}]}`,
		"lead3":  `{"id":3,"ten_khach":"C","quan_ly":"","phu_trach":[]}`,
		"task10": `{"id":10,"khach_hang_id":1,"phu_trach":[{"name":"Nguyễn Quốc Tuấn","username":"tuan"},{"name":"Lan","username":"lan"}]}`,
		"task11": `{"id":11,"khach_hang_id":1,"phu_trach":[{"name":"Lan","username":"lan"}]}`,
		"appt20": `{"id":20,"khach_hang_id":1,"thanh_vien":["Lan","Nguyễn Quốc Tuấn"]}`,
		"appt21": `{"id":21,"khach_hang_id":2,"thanh_vien":["Lan"]}`,
	}
	got := map[string]*omap.Map{"lead1": r.leads[1], "lead2": r.leads[2], "lead3": r.leads[3], "task10": r.tasks[10], "task11": r.tasks[11],
		"appt20": r.appts[20], "appt21": r.appts[21]}
	for k, w := range want {
		if g := mustJSON(t, got[k]); g != w {
			t.Errorf("%s =\n%s\nmuốn\n%s", k, g, w)
		}
	}
	if js := mustJSON(t, r.writes); js != `["lead:1","task:10","appt:20"]` {
		t.Errorf("ghi = %s", js)
	}

	// chạy lại: không còn gì đổi -> không ghi
	r.writes = nil
	if err := s.UserRenamed(ctx, "c1", "tuan", "Tuấn", "Nguyễn Quốc Tuấn"); err != nil || len(r.writes) != 0 {
		t.Errorf("lần 2 ghi %v (%v)", r.writes, err)
	}

	// tên cũ trùng tài khoản khác trong công ty (họ tên hoặc tên đăng nhập) -> chỉ đổi mục có username
	for _, other := range []*omap.Map{omap.Of("id", "u3", "username", "tuan2", "ho_ten", " tuấn"), omap.Of("id", "u3", "username", "Tuấn", "ho_ten", "")} {
		r := renameFixture(tuan, lan, other)
		if err := New(Deps{Repo: r}).UserRenamed(ctx, "c1", "tuan", "Tuấn", "Nguyễn Quốc Tuấn"); err != nil {
			t.Fatal(err)
		}
		pt := r.leads[1].Val("phu_trach").([]any)
		if jsval.Str(pt[0].(*omap.Map).Val("name")) != "Nguyễn Quốc Tuấn" || jsval.Str(pt[1].(*omap.Map).Val("name")) != "TUẤN " || pt[1].(*omap.Map).Has("username") {
			t.Errorf("mơ hồ: phu_trach = %s", mustJSON(t, pt))
		}
		if r.leads[1].Val("quan_ly") != "Tuấn" || mustJSON(t, r.appts[20].Val("thanh_vien")) != `["Lan","Tuấn"]` {
			t.Errorf("mơ hồ mà vẫn đổi theo tên: %s %s", mustJSON(t, r.leads[1]), mustJSON(t, r.appts[20]))
		}
		if js := mustJSON(t, r.writes); js != `["lead:1"]` {
			t.Errorf("mơ hồ: ghi = %s", js)
		}
	}

	// tài khoản chưa có họ tên: tên đang hiện = username
	r = renameFixture(lan)
	if err := New(Deps{Repo: r}).UserRenamed(ctx, "c1", "tuan", "", "Tuấn Mới"); err != nil {
		t.Fatal(err)
	}
	if r.leads[2].Val("nguoi_tao_ten") != "Tuấn Mới" {
		t.Errorf("người tạo = username phải đổi: %s", mustJSON(t, r.leads[2]))
	}

	// không có công ty (super) / tên mới rỗng / không đổi -> không đọc, không ghi
	for _, c := range [][3]any{{nil, "Tuấn", "X"}, {"c1", "Tuấn", ""}, {"c1", "Tuấn", " Tuấn "}} {
		r := renameFixture(tuan)
		if err := New(Deps{Repo: r}).UserRenamed(ctx, c[0], "tuan", c[1].(string), c[2].(string)); err != nil || len(r.writes) != 0 {
			t.Errorf("%v: ghi %v (%v)", c, r.writes, err)
		}
	}
}

// racingRepo: người khác lưu khách 1 giữa lượt tìm và lượt khoá + ghi của UserRenamed.
type racingRepo struct {
	*countingRepo
	locked [][]float64
}

func (r *racingRepo) LeadPeople(ctx context.Context, ids []float64) ([]*omap.Map, error) {
	if len(ids) > 0 {
		r.locked = append(r.locked, ids)
		pt := append(r.leads[1].Val("phu_trach").([]any), omap.Of("name", "Hà", "role", "CTV", "username", "ha"))
		r.leads[1].Set("phu_trach", pt)
	}
	return r.countingRepo.LeadPeople(ctx, ids)
}

// Lượt ghi đọc lại (có khoá) đúng các dòng cần đổi rồi tính lại: thay đổi của người khác giữa 2 lượt không bị mất.
func TestUserRenamedDocLaiTruocKhiGhi(t *testing.T) {
	r := &racingRepo{countingRepo: renameFixture(omap.Of("id", "u1", "username", "tuan", "ho_ten", "Nguyễn Quốc Tuấn"))}
	if err := New(Deps{Repo: r}).UserRenamed(context.Background(), "c1", "tuan", "Tuấn", "Nguyễn Quốc Tuấn"); err != nil {
		t.Fatal(err)
	}
	if js := mustJSON(t, r.locked); js != `[[1]]` {
		t.Errorf("khoá = %s, muốn chỉ khách 1", js)
	}
	pt := r.leads[1].Val("phu_trach").([]any)
	if len(pt) != 4 || jsval.Str(pt[0].(*omap.Map).Val("name")) != "Nguyễn Quốc Tuấn" || jsval.Str(pt[3].(*omap.Map).Val("name")) != "Hà" {
		t.Errorf("phu_trach = %s", mustJSON(t, pt))
	}
}

// Đổi tên ở công ty A không đụng dữ liệu công ty B (qspro_gotest, cần 2 công ty có sẵn).
func TestUserRenamedCachLyDB(t *testing.T) {
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
			_, _ = pool.Exec(bg, `delete from sales_leads where customer_name like 'ZZ\_kdrn\_%'`)
		}
	})
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	ctA, ctB := cts[0].Val("id"), cts[1].Val("id")
	s := New(Deps{DB: db, Users: fakeUsers{}, UserFmt: fakeUsers{}, Lines: fakeLines{}, Projects: fakeProjects{}})
	const oldName, newName = "ZZ Tên Cũ Đổi Tên", "ZZ Tên Mới Đổi Tên"
	mk := func(ct any, name string) float64 {
		ctx := tenant.With(bg, tenant.Ctx{Role: "admin", CongTyID: ct})
		row, err := db.InsertOne(ctx, "kd_khach_hang", omap.Of("ten_khach", name, "giai_doan", "tiep-can", "quan_ly", oldName,
			"phu_trach", []any{omap.Of("name", oldName, "role", "Sale", "username", "zz_rename_u", "since", "2026-01-02")}))
		if err != nil || len(row) == 0 {
			t.Fatal(err)
		}
		id := row[0].Val("id").(float64)
		if _, err := db.InsertOne(ctx, "kd_nhiem_vu_kh", omap.Of("khach_hang_id", id, "tieu_de", "ZZ task",
			"phu_trach", []any{omap.Of("name", oldName, "username", "zz_rename_u")})); err != nil {
			t.Fatal(err)
		}
		return id
	}
	idA, idB := mk(ctA, "ZZ_kdrn_A"), mk(ctB, "ZZ_kdrn_B")
	if err := s.UserRenamed(bg, ctA, "zz_rename_u", oldName, newName); err != nil {
		t.Fatal(err)
	}
	read := func(id float64) (*omap.Map, *omap.Map) {
		l, err := db.Select(bg, "kd_khach_hang", database.SelectOpt{Filter: database.Eq("id", id), NoScope: true})
		if err != nil || len(l) == 0 {
			t.Fatal(err)
		}
		tk, err := db.Select(bg, "kd_nhiem_vu_kh", database.SelectOpt{Filter: database.Eq("khach_hang_id", id), NoScope: true})
		if err != nil || len(tk) == 0 {
			t.Fatal(err)
		}
		return l[0], tk[0]
	}
	la, ta := read(idA)
	lb, tb := read(idB)
	nameOf := func(m *omap.Map) string { return jsval.Str(m.Val("phu_trach").([]any)[0].(*omap.Map).Val("name")) }
	if nameOf(la) != newName || la.Val("quan_ly") != newName || nameOf(ta) != newName {
		t.Errorf("công ty A chưa đổi: %s %s", mustJSON(t, la), mustJSON(t, ta))
	}
	if p := la.Val("phu_trach").([]any)[0].(*omap.Map); p.Val("role") != "Sale" || p.Val("since") != "2026-01-02" {
		t.Errorf("mất role / since: %s", mustJSON(t, p))
	}
	if nameOf(lb) != oldName || lb.Val("quan_ly") != oldName || nameOf(tb) != oldName {
		t.Errorf("công ty B bị đổi: %s %s", mustJSON(t, lb), mustJSON(t, tb))
	}
}
