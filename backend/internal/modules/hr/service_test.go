package hr

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

func status(err error) int {
	var e *apperr.AppError
	if errors.As(err, &e) {
		st, _ := apperr.Status(err)
		return st
	}
	return 0
}

// testDB: chỉ chạy trên qspro_gotest (TEST_DATABASE_URL), cần 2 công ty có sẵn. Dữ liệu thử: mã đơn vị zzhr*, mã NV ZZ_hr*.
func testDB(t *testing.T) (*database.DB, []any) {
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
			_, _ = pool.Exec(bg, `delete from hr_employees where employee_code like 'ZZ\_hr%'`)
			_, _ = pool.Exec(bg, `delete from hr_org_units where unit_key like 'zzhr%'`)
		}
	}
	clean()
	t.Cleanup(clean)
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Order: "id.asc", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	return db, []any{cts[0].Val("id"), cts[1].Val("id")}
}

func svcAs(db *database.DB, role, perms string, ct any) (*Service, context.Context, *actor.Actor) {
	ctx := tenant.With(context.Background(), tenant.Ctx{Role: role, CongTyID: ct})
	return New(Deps{DB: db, Users: fakeUsers{perms}, UserFmt: fakeUsers{perms}}), ctx, &actor.Actor{U: "an", R: role, CT: ct}
}

func emps(st any) map[string]*omap.Map {
	out := map[string]*omap.Map{}
	for _, x := range st.(*omap.Map).Val("employees").([]any) {
		e := x.(*omap.Map)
		out[jsval.Str(e.Val("code"))] = e
	}
	return out
}

func TestQuyen(t *testing.T) {
	db, cts := testDB(t)
	if _, err := New(Deps{DB: db}).Load(context.Background(), nil); status(err) != 401 {
		t.Errorf("chưa đăng nhập phải 401: %v", err)
	}
	s, ctx, a := svcAs(db, "user", "kinhdoanh", cts[0])
	if _, err := s.Load(ctx, a); status(err) != 403 {
		t.Errorf("nhân viên không có quyền hr phải 403: %v", err)
	}
	s, ctx, a = svcAs(db, "user", "kinhdoanh,hr", cts[0])
	if _, err := s.Load(ctx, a); status(err) != 403 {
		t.Errorf("nhân viên có tab hr nhưng chưa gắn hồ sơ phải 403: %v", err)
	}
	s, ctx, a = svcAs(db, "super", "", nil)
	if _, err := s.Load(ctx, a); status(err) != 400 {
		t.Errorf("super chưa chọn công ty phải 400: %v", err)
	}
}

func TestCoCauVaHoSo(t *testing.T) {
	db, cts := testDB(t)
	s, ctx, a := svcAs(db, "admin", "", cts[0])
	_, err := s.SaveOrg(ctx, a, omap.Of("units", []any{
		omap.Of("key", "zzhrceo", "label", "CEO", "type", "exec"),
		omap.Of("key", "zzhrqs", "label", "QS", "type", "dept", "parent", "zzhrceo", "tone", "qs"),
		omap.Of("key", "zzhrbks", "label", "Ban kiểm soát", "type", "board", "parent", "zzhrceo"),
		omap.Of("key", "zzhrsub", "label", "Cty con", "type", "subsidiary", "parent", "__holding"),
	}))
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hr1", "name", "Sếp", "dept", "zzhrceo", "status", "active", "joinDate", "2020-01-02",
		"salary", 50000000.0, "education", []any{omap.Of("school", "BK")}, "tax", omap.Of("mst", "123")))
	if err != nil {
		t.Fatal(err)
	}
	boss := r.(*omap.Map).Val("id")
	r, err = s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hr2", "name", "Trưởng QS", "dept", "zzhrqs", "managerId", boss))
	if err != nil {
		t.Fatal(err)
	}
	mid := r.(*omap.Map).Val("id")
	r, err = s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hr3", "name", "NV QS", "dept", "zzhrqs", "managerId", mid))
	if err != nil {
		t.Fatal(err)
	}
	staff := r.(*omap.Map).Val("id")

	if _, err := s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hr3", "name", "Trùng", "dept", "zzhrqs")); status(err) != 400 {
		t.Errorf("trùng mã NV phải 400: %v", err)
	}
	if _, err := s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hr9", "name", "X", "dept", "khongco")); status(err) != 400 {
		t.Errorf("phòng ban không có phải 400: %v", err)
	}
	if _, err := s.UpdateEmployee(ctx, a, jsval.ToNumber(boss), omap.Of("managerId", staff)); status(err) != 400 {
		t.Errorf("vòng quản lý phải 400: %v", err)
	}
	// sửa 1 phần: khoá chi tiết gộp, không mất khoá cũ
	st, err := s.UpdateEmployee(ctx, a, jsval.ToNumber(boss), omap.Of("promotions", []any{omap.Of("note", "Lên CEO")}))
	if err != nil {
		t.Fatal(err)
	}
	e := emps(st)["ZZ_hr1"]
	if e.Val("tax").(*omap.Map).Val("mst") != "123" || len(e.Val("promotions").([]any)) != 1 || e.Val("salary") != 50000000.0 || e.Val("dob") != "" {
		t.Errorf("hồ sơ sau khi sửa: %v", e)
	}

	// trưởng đơn vị + kiêm nhiệm; tổng > 90% bị chặn, không ghi gì
	if _, err := s.SaveOrg(ctx, a, omap.Of("units", []any{omap.Of("key", "zzhrqs", "headId", mid)},
		"members", []any{omap.Of("unit", "zzhrbks", "id", boss, "pct", 15.0, "title", "Trưởng ban", "allowance", 3000000.0)})); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveOrg(ctx, a, omap.Of("members", []any{omap.Of("unit", "zzhrsub", "id", boss, "pct", 80.0)})); status(err) != 400 {
		t.Errorf("kiêm nhiệm > 90%% phải 400: %v", err)
	}
	if _, err := s.SaveOrg(ctx, a, omap.Of("units", []any{omap.Of("key", "zzhrceo", "parent", "zzhrqs")})); status(err) != 400 {
		t.Errorf("chuyển đơn vị vào cấp dưới của nó phải 400: %v", err)
	}
	if _, err := s.SaveOrg(ctx, a, omap.Of("deleteUnits", []any{"zzhrqs"})); status(err) != 400 {
		t.Errorf("xoá đơn vị còn nhân sự phải 400: %v", err)
	}
	st, err = s.Load(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	m := st.(*omap.Map)
	if m.Val("heads").(*omap.Map).Val("zzhrqs") != mid {
		t.Errorf("heads: %v", m.Val("heads"))
	}
	if l := m.Val("members").(*omap.Map).Val("zzhrbks").([]any); len(l) != 1 || l[0].(*omap.Map).Val("pct") != 15.0 {
		t.Errorf("members: %v", m.Val("members"))
	}
	if _, ok := m.Val("members").(*omap.Map).Get("zzhrsub"); ok {
		t.Error("lệnh kiêm nhiệm bị từ chối vẫn ghi")
	}
	for _, x := range m.Val("units").([]any) {
		if u := x.(*omap.Map); u.Val("key") == "zzhrsub" && u.Val("parent") != "__holding" {
			t.Errorf("parent công ty con: %v", u)
		}
	}

	// nghỉ việc: cấp dưới chuyển lên quản lý cấp trên
	st, err = s.UpdateEmployee(ctx, a, jsval.ToNumber(mid), omap.Of("status", "left", "leaveDate", "2026-10-30"))
	if err != nil {
		t.Fatal(err)
	}
	if got := emps(st)["ZZ_hr3"].Val("managerId"); got != boss {
		t.Errorf("cấp dưới sau khi quản lý nghỉ: %v", got)
	}
	// xoá: trưởng đơn vị -> trống, kiêm nhiệm xoá theo
	st, err = s.DeleteEmployee(ctx, a, jsval.ToNumber(boss))
	if err != nil {
		t.Fatal(err)
	}
	if got := emps(st)["ZZ_hr3"].Val("managerId"); got != nil {
		t.Errorf("cấp dưới sau khi xoá quản lý: %v", got)
	}
	if _, ok := st.(*omap.Map).Val("members").(*omap.Map).Get("zzhrbks"); ok {
		t.Error("kiêm nhiệm của người đã xoá còn")
	}
}

// Rule 28 (database-rules.md): công ty A không đọc / sửa / xoá / tham chiếu được dữ liệu HR của B.
func TestCachLyCongTyDB(t *testing.T) {
	db, cts := testDB(t)
	sa, ctxA, aA := svcAs(db, "admin", "", cts[0])
	sb, ctxB, aB := svcAs(db, "admin", "", cts[1])
	if _, err := sb.SaveOrg(ctxB, aB, omap.Of("units", []any{omap.Of("key", "zzhrb", "label", "B", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	r, err := sb.CreateEmployee(ctxB, aB, omap.Of("code", "ZZ_hrB", "name", "Người B", "dept", "zzhrb"))
	if err != nil {
		t.Fatal(err)
	}
	idB := r.(*omap.Map).Val("id")
	if _, err := sa.SaveOrg(ctxA, aA, omap.Of("units", []any{omap.Of("key", "zzhra", "label", "A", "type", "dept")})); err != nil {
		t.Fatal(err)
	}

	st, err := sa.Load(ctxA, aA)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := emps(st)["ZZ_hrB"]; ok {
		t.Error("A thấy nhân sự của B")
	}
	if _, err := sa.UpdateEmployee(ctxA, aA, jsval.ToNumber(idB), omap.Of("name", "hack")); status(err) != 404 {
		t.Errorf("A sửa nhân sự của B phải 404: %v", err)
	}
	if _, err := sa.DeleteEmployee(ctxA, aA, jsval.ToNumber(idB)); status(err) != 404 {
		t.Errorf("A xoá nhân sự của B phải 404: %v", err)
	}
	if _, err := sa.CreateEmployee(ctxA, aA, omap.Of("code", "ZZ_hrA", "name", "A", "dept", "zzhrb")); status(err) != 400 {
		t.Errorf("A gắn phòng ban của B phải 400: %v", err)
	}
	if _, err := sa.CreateEmployee(ctxA, aA, omap.Of("code", "ZZ_hrA", "name", "A", "dept", "zzhra", "managerId", idB)); status(err) != 400 {
		t.Errorf("A chọn quản lý của B phải 400: %v", err)
	}
	if _, err := sa.SaveOrg(ctxA, aA, omap.Of("members", []any{omap.Of("unit", "zzhra", "id", idB, "pct", 5.0)})); status(err) != 400 {
		t.Errorf("A thêm người của B vào kiêm nhiệm phải 400: %v", err)
	}
	if _, err := sa.SaveOrg(ctxA, aA, omap.Of("units", []any{omap.Of("key", "zzhra", "headId", idB)})); status(err) != 400 {
		t.Errorf("A chọn trưởng đơn vị của B phải 400: %v", err)
	}
	if _, err := sa.SaveOrg(ctxA, aA, omap.Of("deleteUnits", []any{"zzhrb"})); status(err) != 404 {
		t.Errorf("A xoá đơn vị của B phải 404: %v", err)
	}
	// database tự chặn liên kết chéo khi bỏ qua service (khoá ngoại ghép công ty / bảng con xét qua đơn vị)
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `insert into hr_employees (company_id, employee_code, full_name, dept_key, join_date, manager_id)
		values ($1, 'ZZ_hrX', 'X', 'zzhra', '2026-01-01', $2)`, cts[0], idB); err == nil {
		t.Error("database cho nhân sự A trỏ quản lý sang B")
	}
	if _, err := pool.Exec(context.Background(), `update hr_org_units set head_employee_id = $1 where unit_key = 'zzhra'`, idB); err == nil {
		t.Error("database cho đơn vị A chọn trưởng đơn vị của B")
	}
	ub, _ := sb.unitByKey(ctxB, "zzhrb")
	if _, err := db.InsertOne(ctxA, "hr_kiem_nhiem", omap.Of("don_vi_id", ub.Val("id"), "nhan_vien_id", idB)); err == nil {
		t.Error("lớp dữ liệu cho A chèn kiêm nhiệm vào đơn vị của B")
	}
	st, err = sb.Load(ctxB, aB)
	if err != nil || emps(st)["ZZ_hrB"].Val("name") != "Người B" {
		t.Errorf("dữ liệu của B bị đổi: %v %v", err, st)
	}
}
