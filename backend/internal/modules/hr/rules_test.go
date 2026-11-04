package hr

import (
	"context"
	"testing"
	"time"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Quy tắc nghiệp vụ: chốt công khoá đủ thứ, duyệt đúng người của bước, nghỉ việc gỡ chức / kiêm nhiệm, địa điểm.
func TestQuyTacNghiepVu(t *testing.T) {
	db, cts := testDB(t)
	sa, ctx, adm := svcAs(db, "admin", "", cts[0])
	cleanShifts(t, sa)
	cleanPayroll(t, sa)
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	bg := context.Background()
	t.Cleanup(func() {
		_, _ = pool.Exec(bg, `delete from users where username like 'zz\_hrr\_%'`)
		_, _ = pool.Exec(bg, `delete from hr_work_sites where site_name like 'ZZ%'`)
	})
	_, _ = pool.Exec(bg, `delete from users where username like 'zz\_hrr\_%'`)
	var uH string
	if err := pool.QueryRow(bg, `insert into users (username, full_name, password_hash, role, is_active, company_id, permissions)
		values ('zz_hrr_h', 'h', 'x', 'staff', true, $1, 'hr') returning id`, cts[0]).Scan(&uH); err != nil {
		t.Fatal(err)
	}
	now := func() time.Time { return time.Date(2031, 6, 15, 3, 0, 0, 0, time.UTC) }
	sa.now = now
	id := idFn(t)
	if _, err := sa.SaveOrg(ctx, adm, omap.Of("units", []any{omap.Of("key", "zzhrra", "label", "RA", "type", "dept"), omap.Of("key", "zzhrrb", "label", "RB", "type", "board")})); err != nil {
		t.Fatal(err)
	}
	boss := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrRB", "name", "Sếp", "dept", "zzhrra")))
	hr := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrRH", "name", "HR", "dept", "zzhrra")))
	e := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrRE", "name", "NV", "dept", "zzhrra", "managerId", boss)))
	if _, err := sa.SetUserRole(ctx, adm, omap.Of("empId", hr, "userId", uH, "role", "hradmin")); err != nil {
		t.Fatal(err)
	}
	sh, _, ah := svcAs(db, "user", "hr", cts[0])
	ah.UID, sh.now = uH, now

	// chốt công không giới hạn ngày (như giao diện gốc)
	if _, err := sa.RunAction(ctx, adm, omap.Of("month", "2031-06", "action", "close")); err != nil {
		t.Errorf("chốt công giữa tháng: %v", err)
	}
	if _, err := sa.RunAction(ctx, adm, omap.Of("month", "2031-06", "action", "open")); err != nil {
		t.Fatal(err)
	}
	// đơn: ai có quyền duyệt (trong phạm vi) duyệt bước đang chờ; đi muộn / về sớm chỉ 1 bước quản lý trực tiếp
	rq := id(sa.CreateRequest(ctx, adm, omap.Of("empId", e, "type", "leave", "leaveKind", "annual", "from", "2031-05-20", "days", 1.0)))
	if _, err := sh.DecideRequest(ctx, ah, rq, omap.Of("approve", true)); err != nil {
		t.Errorf("HR Admin duyệt bước quản lý trực tiếp: %v", err)
	}
	if _, err := sh.DecideRequest(ctx, ah, rq, omap.Of("approve", true)); err != nil {
		t.Errorf("HR Admin duyệt bước HR: %v", err)
	}
	late := id(sa.CreateRequest(ctx, adm, omap.Of("empId", e, "type", "late", "from", "2031-05-19")))
	if r, _ := sa.AttState(ctx, adm, "2031-05-19", "2031-05-19"); r != nil {
		for _, x := range r.(*omap.Map).Val("requests").([]any) {
			if q := x.(*omap.Map); q.Val("id") == late && len(q.Val("steps").([]any)) != 1 {
				t.Errorf("đơn đi muộn phải 1 bước: %v", q.Val("steps"))
			}
		}
	}
	// chốt công tháng 5 -> chặn đơn, duyệt đơn, lịch riêng ngày; tháng chốt mà chưa duyệt lương -> chặn đổi lịch tuần
	pending := id(sa.CreateRequest(ctx, adm, omap.Of("empId", e, "type", "late", "from", "2031-05-21")))
	if _, err := sa.RunAction(ctx, adm, omap.Of("month", "2031-05", "action", "close")); err != nil {
		t.Fatal(err)
	}
	if _, err := sa.CreateRequest(ctx, adm, omap.Of("empId", e, "type", "leave", "leaveKind", "annual", "from", "2031-05-30", "to", "2031-06-02", "days", 2.0)); status(err) != 400 {
		t.Errorf("đơn chạm tháng đã chốt phải 400: %v", err)
	}
	if _, err := sa.DecideRequest(ctx, adm, pending, omap.Of("approve", true)); status(err) != 400 {
		t.Errorf("duyệt đơn của tháng đã chốt phải 400: %v", err)
	}
	if _, err := sa.SaveShifts(ctx, adm, omap.Of("shifts", []any{omap.Of("id", "ZZR", "name", "R", "start", "08:00", "end", "17:00")})); err != nil {
		t.Fatal(err)
	}
	if _, err := sa.SaveShifts(ctx, adm, omap.Of("overrides", []any{omap.Of("empId", e, "date", "2031-05-10", "shift", "off")})); status(err) != 400 {
		t.Errorf("lịch riêng ngày trong tháng đã chốt phải 400: %v", err)
	}
	if _, err := sa.SaveShifts(ctx, adm, omap.Of("schedule", omap.Of(jsval.Str(e), []any{"ZZR", "ZZR", "ZZR", "ZZR", "ZZR", "off", "off"}))); status(err) != 400 {
		t.Errorf("đổi lịch tuần khi có tháng chốt chưa duyệt lương phải 400: %v", err)
	}
	st, err := sa.AttState(ctx, adm, "2031-05-01", "2031-06-30")
	if err != nil {
		t.Fatal(err)
	}
	if st.(*omap.Map).Val("closedMonths").(*omap.Map).Val("2031-05") != "draft" {
		t.Errorf("closedMonths: %v", st.(*omap.Map).Val("closedMonths"))
	}
	if _, err := sa.RunAction(ctx, adm, omap.Of("month", "2031-05", "action", "open")); err != nil {
		t.Fatal(err)
	}

	// nghỉ việc: giữ trưởng đơn vị + kiêm nhiệm (như giao diện gốc); không chọn lại người đã nghỉ làm quản lý / trưởng đơn vị / kiêm nhiệm
	if _, err := sa.SaveOrg(ctx, adm, omap.Of("units", []any{omap.Of("key", "zzhrra", "headId", boss)},
		"members", []any{omap.Of("unit", "zzhrrb", "id", boss, "pct", 10.0)})); err != nil {
		t.Fatal(err)
	}
	full, err := sa.UpdateEmployee(ctx, adm, boss, omap.Of("status", "left", "leaveDate", "2031-06-15"))
	if err != nil {
		t.Fatal(err)
	}
	m := full.(*omap.Map)
	if !m.Val("heads").(*omap.Map).Has("zzhrra") || !m.Val("members").(*omap.Map).Has("zzhrrb") {
		t.Error("nghỉ việc không được gỡ trưởng đơn vị / kiêm nhiệm")
	}
	if _, err := sa.UpdateEmployee(ctx, adm, e, omap.Of("managerId", boss)); status(err) != 400 {
		t.Errorf("chọn quản lý đã nghỉ việc phải 400: %v", err)
	}
	if _, err := sa.SaveOrg(ctx, adm, omap.Of("units", []any{omap.Of("key", "zzhrra", "headId", boss)})); status(err) != 400 {
		t.Errorf("chọn trưởng đơn vị đã nghỉ việc phải 400: %v", err)
	}
	if _, err := sa.SaveOrg(ctx, adm, omap.Of("members", []any{omap.Of("unit", "zzhrrb", "id", boss, "pct", 5.0)})); status(err) != 400 {
		t.Errorf("gán kiêm nhiệm cho người đã nghỉ việc phải 400: %v", err)
	}

	// địa điểm: thêm / đổi tên (hồ sơ đổi theo) / toạ độ sai bị chặn
	if _, err := sa.SaveShifts(ctx, adm, omap.Of("sites", []any{omap.Of("name", "ZZ Văn phòng", "lat", 10.84, "lng", 106.8, "radius", 150.0)})); err != nil {
		t.Fatal(err)
	}
	if _, err := sa.UpdateEmployee(ctx, adm, e, omap.Of("site", "ZZ Văn phòng")); err != nil {
		t.Fatal(err)
	}
	if _, err := sa.SaveShifts(ctx, adm, omap.Of("sites", []any{omap.Of("orig", "ZZ Văn phòng", "name", "ZZ VP mới", "lat", 10.84, "lng", 106.8, "isField", true)})); err != nil {
		t.Fatal(err)
	}
	if _, err := sa.SaveShifts(ctx, adm, omap.Of("sites", []any{omap.Of("name", "ZZ sai", "lat", 200.0, "lng", 1.0)})); status(err) != 400 {
		t.Errorf("toạ độ sai phải 400: %v", err)
	}
	st, _ = sa.AttState(ctx, adm, "2031-06-01", "2031-06-30")
	found := false
	for _, x := range st.(*omap.Map).Val("sites").([]any) {
		if s := x.(*omap.Map); s.Val("name") == "ZZ VP mới" && s.Val("isField") == true && s.Val("lat") == 10.84 {
			found = true
		}
	}
	if !found {
		t.Errorf("địa điểm sau khi đổi tên: %v", st.(*omap.Map).Val("sites"))
	}
	ld, _ := sa.Load(ctx, adm)
	for _, x := range ld.(*omap.Map).Val("employees").([]any) {
		if r := x.(*omap.Map); r.Val("id") == e && r.Val("site") != "ZZ VP mới" {
			t.Errorf("hồ sơ không đổi theo tên địa điểm mới: %v", r.Val("site"))
		}
	}
}
