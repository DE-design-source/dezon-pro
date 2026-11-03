package hr

import (
	"context"
	"testing"
	"time"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Phân quyền HR (rule 28 + vai trò): tài khoản thử zz_hrp_* tạo trong qspro_gotest, xoá sau test.
func TestPhanQuyen(t *testing.T) {
	db, cts := testDB(t)
	sa, ctx, adm := svcAs(db, "admin", "", cts[0])
	cleanShifts(t, sa)
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	bg := context.Background()
	mkUser := func(name string, ct any) string {
		var id string
		if err := pool.QueryRow(bg, `insert into users (username, full_name, password_hash, role, is_active, company_id, permissions)
			values ($1, $1, 'x', 'staff', true, $2, 'hr') returning id`, name, ct).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(bg, `delete from hr_security_settings where company_id = $1`, cts[0])
		_, _ = pool.Exec(bg, `delete from users where username like 'zz\_hrp\_%'`)
	})
	_, _ = pool.Exec(bg, `delete from users where username like 'zz\_hrp\_%'`)
	uM, uE, uX, uB := mkUser("zz_hrp_m", cts[0]), mkUser("zz_hrp_e", cts[0]), mkUser("zz_hrp_x", cts[0]), mkUser("zz_hrp_b", cts[1])
	as := func(uid string) (*Service, *actor.Actor) {
		s, _, a := svcAs(db, "user", "hr", cts[0])
		a.UID = uid
		return s, a
	}
	id := idFn(t)

	if _, err := sa.SaveOrg(ctx, adm, omap.Of("units", []any{omap.Of("key", "zzhrpa", "label", "PA", "type", "dept"), omap.Of("key", "zzhrpb", "label", "PB", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	m := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrPM", "name", "Trưởng PA", "dept", "zzhrpa", "salary", 30000000.0)))
	e1 := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrPE", "name", "NV PA", "dept", "zzhrpa", "managerId", m, "salary", 15000000.0)))
	e2 := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrPF", "name", "NV PB", "dept", "zzhrpb", "salary", 16000000.0)))
	for _, b := range []*omap.Map{omap.Of("empId", m, "userId", uM, "role", "manager"), omap.Of("empId", e1, "userId", uE, "role", "employee")} {
		if _, err := sa.SetUserRole(ctx, adm, b); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := sa.SetUserRole(ctx, adm, omap.Of("empId", e2, "userId", uE)); status(err) != 400 {
		t.Errorf("1 tài khoản gắn 2 hồ sơ phải 400: %v", err)
	}
	if _, err := sa.SetUserRole(ctx, adm, omap.Of("empId", e2, "userId", uB)); status(err) != 400 {
		t.Errorf("gắn tài khoản công ty khác phải 400: %v", err)
	}
	codes := func(st any) map[string]*omap.Map {
		out := map[string]*omap.Map{}
		for _, x := range st.(*omap.Map).Val("employees").([]any) {
			out[jsval.Str(x.(*omap.Map).Val("code"))] = x.(*omap.Map)
		}
		return out
	}

	// tài khoản có tab hr nhưng chưa gắn hồ sơ
	sx, ax := as(uX)
	if _, err := sx.Load(ctx, ax); status(err) != 403 {
		t.Errorf("chưa gắn hồ sơ phải 403: %v", err)
	}

	// nhân viên: chỉ thấy mình, tự gửi đơn / chấm GPS cho mình, không duyệt, không làm thay người khác
	se, ae := as(uE)
	st, err := se.Load(ctx, ae)
	if err != nil {
		t.Fatal(err)
	}
	if c := codes(st); len(c) != 1 || c["ZZ_hrPE"] == nil || c["ZZ_hrPE"].Val("salary") != 15000000.0 {
		t.Errorf("nhân viên thấy: %v", c)
	}
	if me := st.(*omap.Map).Val("me").(*omap.Map); me.Val("role") != "employee" || me.Val("employeeId") != e1 {
		t.Errorf("me: %v", me)
	}
	if _, err := se.CreateRequest(ctx, ae, omap.Of("empId", e2, "type", "late", "from", "2031-04-01")); status(err) != 403 {
		t.Errorf("nhân viên gửi đơn cho người khác phải 403: %v", err)
	}
	rq := id(se.CreateRequest(ctx, ae, omap.Of("empId", e1, "type", "late", "from", "2031-04-01")))
	if _, err := se.DecideRequest(ctx, ae, rq, omap.Of("approve", true)); status(err) != 403 {
		t.Errorf("nhân viên duyệt đơn phải 403: %v", err)
	}
	// tự chấm GPS: chỉ hôm nay, giờ theo máy chủ, không chấm vào 2 lần
	se.now = func() time.Time { return time.Date(2031, 4, 1, 1, 5, 0, 0, time.UTC) } // 08:05 giờ VN
	if _, err := se.SaveLogs(ctx, ae, omap.Of("logs", []any{omap.Of("empId", e1, "date", "2031-03-15", "in", "07:00", "source", "gps", "gps", "in", "dist", 0.0)})); status(err) != 400 {
		t.Errorf("tự chấm GPS ngày đã qua phải 400: %v", err)
	}
	if _, err := se.SaveLogs(ctx, ae, omap.Of("logs", []any{omap.Of("empId", e1, "in", "07:00", "source", "gps", "gps", "in", "dist", 20.0)})); err != nil {
		t.Errorf("nhân viên tự chấm GPS: %v", err)
	}
	if _, err := se.SaveLogs(ctx, ae, omap.Of("logs", []any{omap.Of("empId", e1, "in", "07:00", "source", "gps", "gps", "in", "dist", 20.0)})); status(err) != 400 {
		t.Errorf("chấm vào lần 2 phải 400: %v", err)
	}
	if ast, _ := se.AttState(ctx, ae, "2031-04-01", "2031-04-01"); len(ast.(*omap.Map).Val("logs").([]any)) != 1 || ast.(*omap.Map).Val("logs").([]any)[0].(*omap.Map).Val("in") != "08:05" {
		t.Errorf("giờ vào phải theo máy chủ 08:05: %v", ast)
	}
	if _, err := se.SaveLogs(ctx, ae, omap.Of("logs", []any{omap.Of("empId", e1, "date", "2031-04-02", "in", "08:00", "source", "manual")})); status(err) != 403 {
		t.Errorf("nhân viên tự bổ sung giờ (manual) phải 403: %v", err)
	}
	if _, err := se.SaveOrg(ctx, ae, omap.Of("units", []any{omap.Of("key", "zzhrpa", "label", "x")})); status(err) != 403 {
		t.Errorf("nhân viên sửa cơ cấu phải 403: %v", err)
	}

	// trưởng phòng: thấy phòng mình, không thấy lương, duyệt đơn trong phòng, không tự duyệt đơn mình
	sm, am := as(uM)
	st, err = sm.Load(ctx, am)
	if err != nil {
		t.Fatal(err)
	}
	c := codes(st)
	if len(c) != 2 || c["ZZ_hrPF"] != nil || c["ZZ_hrPE"].Val("salary") != nil {
		t.Errorf("trưởng phòng thấy: %v", c)
	}
	if _, err := sm.DecideRequest(ctx, am, rq, omap.Of("approve", true)); err != nil {
		t.Errorf("trưởng phòng duyệt đơn trong phòng: %v", err)
	}
	own := id(sa.CreateRequest(ctx, adm, omap.Of("empId", m, "type", "late", "from", "2031-04-03")))
	if _, err := sm.DecideRequest(ctx, am, own, omap.Of("approve", true)); status(err) != 403 {
		t.Errorf("trưởng phòng tự duyệt đơn mình phải 403: %v", err)
	}
	if _, err := sm.PayrollState(ctx, am); status(err) != 403 {
		t.Errorf("trưởng phòng xem lương phải 403: %v", err)
	}
	if _, err := sm.SaveSecurity(ctx, am, omap.Of("maskSalary", false)); status(err) != 403 {
		t.Errorf("trưởng phòng sửa phân quyền phải 403: %v", err)
	}
	ast, err := sm.AttState(ctx, am, "2031-04-01", "2031-04-30")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range ast.(*omap.Map).Val("requests").([]any) {
		if r.(*omap.Map).Val("empId") == e2 {
			t.Error("trưởng phòng thấy đơn của phòng khác")
		}
	}

	// System Admin bỏ quyền xem lương của nhân viên -> hồ sơ của mình cũng mất số lương
	perms := DefaultPerms()
	perms.Val("employee").(*omap.Map).Set("payroll", []any{})
	if _, err := sa.SaveSecurity(ctx, adm, omap.Of("perms", perms)); err != nil {
		t.Fatal(err)
	}
	st, _ = se.Load(ctx, ae)
	if codes(st)["ZZ_hrPE"].Val("salary") != nil {
		t.Error("nhân viên vẫn thấy lương khi đã bỏ quyền xem lương")
	}
	if _, err := se.PayrollState(ctx, ae); status(err) != 403 {
		t.Errorf("nhân viên không còn quyền lương phải 403: %v", err)
	}
	sec, err := sa.SecurityState(ctx, adm)
	if err != nil {
		t.Fatal(err)
	}
	if len(sec.(*omap.Map).Val("audit").([]any)) == 0 {
		t.Error("nhật ký HR trống")
	}
}

// Bảo vệ số tiền + tuyển dụng theo phòng + nhận việc nguyên khối.
func TestBaoVeLuongTuyenDung(t *testing.T) {
	db, cts := testDB(t)
	sa, ctx, adm := svcAs(db, "admin", "", cts[0])
	cleanShifts(t, sa)
	cleanTalent(t, sa)
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	bg := context.Background()
	t.Cleanup(func() {
		_, _ = pool.Exec(bg, `delete from hr_security_settings where company_id = $1`, cts[0])
		_, _ = pool.Exec(bg, `delete from users where username like 'zz\_hrq\_%'`)
	})
	_, _ = pool.Exec(bg, `delete from users where username like 'zz\_hrq\_%'`)
	mk := func(name string) string {
		var uid string
		if err := pool.QueryRow(bg, `insert into users (username, full_name, password_hash, role, is_active, company_id, permissions)
			values ($1, $1, 'x', 'staff', true, $2, 'hr') returning id`, name, cts[0]).Scan(&uid); err != nil {
			t.Fatal(err)
		}
		return uid
	}
	uH, uM := mk("zz_hrq_h"), mk("zz_hrq_m")
	as := func(uid string) (*Service, *actor.Actor) {
		s, _, a := svcAs(db, "user", "hr", cts[0])
		a.UID = uid
		return s, a
	}
	id := idFn(t)
	if _, err := sa.SaveOrg(ctx, adm, omap.Of("units", []any{omap.Of("key", "zzhrqa", "label", "QA", "type", "dept"), omap.Of("key", "zzhrqb", "label", "QB", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	h := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrQH", "name", "HR", "dept", "zzhrqa")))
	m := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrQM", "name", "TP QA", "dept", "zzhrqa")))
	e := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrQE", "name", "NV", "dept", "zzhrqa", "salary", 20000000.0,
		"insurance", omap.Of("base", 20000000.0, "since", "2026-01-01"), "contracts", []any{omap.Of("no", "HĐ1", "salary", 20000000.0)})))
	if _, err := sa.SaveOrg(ctx, adm, omap.Of("members", []any{omap.Of("unit", "zzhrqb", "id", e, "pct", 10.0, "allowance", 2000000.0)})); err != nil {
		t.Fatal(err)
	}
	for _, b := range []*omap.Map{omap.Of("empId", h, "userId", uH, "role", "hradmin"), omap.Of("empId", m, "userId", uM, "role", "manager")} {
		if _, err := sa.SetUserRole(ctx, adm, b); err != nil {
			t.Fatal(err)
		}
	}
	// HR Admin bị bỏ quyền xem lương: không thấy lương / BH / phụ cấp, lưu hồ sơ không xoá được các số đó
	perms := DefaultPerms()
	perms.Val("hradmin").(*omap.Map).Set("payroll", []any{})
	if _, err := sa.SaveSecurity(ctx, adm, omap.Of("perms", perms)); err != nil {
		t.Fatal(err)
	}
	sh, ah := as(uH)
	st, err := sh.Load(ctx, ah)
	if err != nil {
		t.Fatal(err)
	}
	var got *omap.Map
	for _, x := range st.(*omap.Map).Val("employees").([]any) {
		if x.(*omap.Map).Val("id") == e {
			got = x.(*omap.Map)
		}
	}
	if got.Val("salary") != nil || got.Val("insurance").(*omap.Map).Has("base") || got.Val("contracts").([]any)[0].(*omap.Map).Has("salary") {
		t.Errorf("vai trò không xem lương vẫn thấy số tiền: %v", got)
	}
	if mem := st.(*omap.Map).Val("members").(*omap.Map).Val("zzhrqb").([]any)[0].(*omap.Map); mem.Has("allowance") {
		t.Errorf("vai trò không xem lương vẫn thấy phụ cấp kiêm nhiệm: %v", mem)
	}
	// lưu lại đúng object nhận được (form gửi salary 0, insurance không có base, contracts không có lương)
	if _, err := sh.UpdateEmployee(ctx, ah, e, omap.Assign(omap.New(), got).Set("salary", 0.0).Set("phone", "0909")); err != nil {
		t.Fatal(err)
	}
	full, _ := sa.Load(ctx, adm)
	for _, x := range full.(*omap.Map).Val("employees").([]any) {
		if r := x.(*omap.Map); r.Val("id") == e {
			if r.Val("salary") != 20000000.0 || r.Val("insurance").(*omap.Map).Val("base") != 20000000.0 || r.Val("contracts").([]any)[0].(*omap.Map).Val("salary") != 20000000.0 || r.Val("phone") != "0909" {
				t.Errorf("số tiền bị ghi đè khi vai trò không xem lương lưu hồ sơ: %v", r)
			}
		}
	}

	// tuyển dụng theo phòng: trưởng phòng QA chỉ thấy / thao tác tin của QA
	jdA := id(sa.SaveJD(ctx, adm, omap.Of("title", "ZZ_tl A", "dept", "zzhrqa")))
	jdB := id(sa.SaveJD(ctx, adm, omap.Of("title", "ZZ_tl B", "dept", "zzhrqb")))
	jobA := id(sa.SaveJob(ctx, adm, omap.Of("jdId", jdA, "qty", 1.0)))
	jobB := id(sa.SaveJob(ctx, adm, omap.Of("jdId", jdB, "qty", 1.0)))
	cB := id(sa.CreateCandidate(ctx, adm, omap.Of("jobId", jobB, "name", "UV B", "email", "b@x.vn")))
	sm, am := as(uM)
	ts, err := sm.TalentState(ctx, am)
	if err != nil {
		t.Fatal(err)
	}
	for k, hidden := range map[string]float64{"jds": jdB, "jobs": jobB, "candidates": cB} {
		for _, x := range ts.(*omap.Map).Val(k).([]any) {
			if x.(*omap.Map).Val("id") == hidden {
				t.Errorf("trưởng phòng QA thấy %s của phòng QB", k)
			}
		}
	}
	if _, err := sm.CreateCandidate(ctx, am, omap.Of("jobId", jobB, "name", "x")); status(err) != 403 {
		t.Errorf("trưởng phòng thêm ứng viên vào tin phòng khác phải 403: %v", err)
	}
	if _, err := sm.UpdateCandidate(ctx, am, cB, omap.Of("stage", "rejected")); status(err) != 403 {
		t.Errorf("trưởng phòng sửa ứng viên phòng khác phải 403: %v", err)
	}
	cOwn := id(sa.CreateCandidate(ctx, adm, omap.Of("jobId", jobA, "name", "UV A")))
	if _, err := sm.UpdateCandidate(ctx, am, cOwn, omap.Of("stage", "screening")); err != nil {
		t.Errorf("trưởng phòng chuyển ứng viên của phòng mình: %v", err)
	}

	// nhận việc nguyên khối: tạo hồ sơ + đánh dấu ứng viên; ứng viên đã nhận việc -> lỗi và KHÔNG tạo hồ sơ
	cA := id(sa.CreateCandidate(ctx, adm, omap.Of("jobId", jobA, "name", "UV nhận việc")))
	nv := id(sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrQN", "name", "UV nhận việc", "dept", "zzhrqa", "candidateId", cA)))
	if _, err := sa.CreateEmployee(ctx, adm, omap.Of("code", "ZZ_hrQN2", "name", "Trùng", "dept", "zzhrqa", "candidateId", cA)); status(err) != 400 {
		t.Errorf("nhận việc lần 2 phải 400: %v", err)
	}
	ts, _ = sa.TalentState(ctx, adm)
	for _, x := range ts.(*omap.Map).Val("candidates").([]any) {
		if c := x.(*omap.Map); c.Val("id") == cA && (c.Val("stage") != "hired" || c.Val("empId") != nv) {
			t.Errorf("ứng viên sau nhận việc: %v", c)
		}
	}
	var n int
	_ = pool.QueryRow(bg, `select count(*) from hr_employees where employee_code = 'ZZ_hrQN2'`).Scan(&n)
	if n != 0 {
		t.Error("nhận việc lỗi vẫn tạo hồ sơ")
	}
	if _, err := sa.UpdateCandidate(ctx, adm, cB, omap.Of("stage", "hired", "hiredEmployeeId", nv)); status(err) != 400 {
		t.Errorf("gắn 1 hồ sơ cho 2 ứng viên phải 400: %v", err)
	}
}
