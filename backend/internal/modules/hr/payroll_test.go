package hr

import (
	"context"
	"testing"
	"time"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// dữ liệu thử: kỳ lương tháng 2031-xx, nhân sự ZZ_hr*, đơn vị zzhr*; cấu hình lương của 2 công ty thử bị xoá sau test.
func cleanPayroll(t *testing.T, s *Service) {
	t.Cleanup(func() {
		if pool, err := s.db.Pool(); err == nil {
			bg := context.Background()
			_, _ = pool.Exec(bg, `delete from hr_payroll_runs where pay_month >= '2031-01-01'`)
			_, _ = pool.Exec(bg, `delete from hr_payroll_settings where config ? 'zzTest'`)
		}
	})
}

func TestLuong(t *testing.T) {
	db, cts := testDB(t)
	s, ctx, a := svcAs(db, "admin", "", cts[0])
	s.now = func() time.Time { return time.Date(2031, 3, 1, 3, 0, 0, 0, time.UTC) } // tháng 2031-01 đã hết
	cleanShifts(t, s)
	cleanPayroll(t, s)
	if _, err := s.SaveOrg(ctx, a, omap.Of("units", []any{omap.Of("key", "zzhrpl", "label", "PL", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	r, _ := s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hrP", "name", "Lương", "dept", "zzhrpl", "salary", 20000000.0))
	eid := r.(*omap.Map).Val("id")

	if _, err := s.SavePayrollConfig(ctx, a, omap.Of("config", omap.Of("zzTest", true, "lunch", 730000.0))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePayrollConfig(ctx, a, omap.Of("config", "x")); status(err) != 400 {
		t.Errorf("cấu hình không phải object phải 400: %v", err)
	}
	added, err := s.AddAdjustment(ctx, a, omap.Of("empId", eid, "month", "2031-01", "kind", "bonus", "label", "Thưởng", "amount", 5000000.0))
	if err != nil {
		t.Fatal(err)
	}
	adjID := added.(*omap.Map).Val("id")
	if jsval.ToNumber(adjID) <= 0 {
		t.Fatalf("AddAdjustment phải trả id: %v", added)
	}
	if _, err := s.AddAdjustment(ctx, a, omap.Of("empId", eid, "month", "2031-01", "kind", "tip", "label", "x", "amount", 1.0)); status(err) != 400 {
		t.Errorf("loại điều chỉnh sai phải 400: %v", err)
	}
	if _, err := s.SaveBudget(ctx, a, omap.Of("unit", "zzhrpl", "fund", 60000000.0, "items", []any{omap.Of("name", "Thuê kho", "amount", 5000000.0)})); err != nil {
		t.Fatal(err)
	}
	m, err := s.PayrollState(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	st := m.(*omap.Map)
	if st.Val("config").(*omap.Map).Val("lunch") != 730000.0 {
		t.Errorf("config: %v", st.Val("config"))
	}
	adj := st.Val("adjustments").(*omap.Map).Val("2031-01").(*omap.Map).Val(jsval.Str(eid)).([]any)
	if len(adj) != 1 || adj[0].(*omap.Map).Val("amount") != 5000000.0 || jsval.Str(adj[0].(*omap.Map).Val("id")) != jsval.Str(adjID) {
		t.Errorf("adjustments: %v", adj)
	}
	if f := st.Val("fixed").(*omap.Map).Val("zzhrpl").(*omap.Map); f.Val("fund") != 60000000.0 || len(f.Val("items").([]any)) != 1 {
		t.Errorf("fixed: %v", f)
	}

	// chốt công -> không ghi chấm công tháng đó; mở chốt -> ghi lại được
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "close")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLogs(ctx, a, omap.Of("logs", []any{omap.Of("empId", eid, "date", "2031-01-06", "in", "08:00", "source", "manual")})); status(err) != 400 {
		t.Errorf("ghi chấm công tháng đã chốt phải 400: %v", err)
	}
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "open")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLogs(ctx, a, omap.Of("logs", []any{omap.Of("empId", eid, "date", "2031-01-06", "in", "08:00", "source", "manual")})); err != nil {
		t.Errorf("mở chốt công rồi vẫn không ghi được: %v", err)
	}

	// duyệt cần bản chụp; đã duyệt -> khoá điều chỉnh; chi trả; mở lại -> bỏ bản chụp
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "approve")); status(err) != 400 {
		t.Errorf("duyệt không có bản chụp phải 400: %v", err)
	}
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "pay")); status(err) != 400 {
		t.Errorf("chi trả bảng lương nháp phải 400: %v", err)
	}
	slips := omap.Of(jsval.Str(eid), omap.Of("p", omap.Of("net", 21000000.0)))
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "approve", "payslips", slips)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddAdjustment(ctx, a, omap.Of("empId", eid, "month", "2031-01", "kind", "penalty", "label", "Muộn", "amount", 100000.0)); status(err) != 400 {
		t.Errorf("thêm điều chỉnh khi đã duyệt phải 400: %v", err)
	}
	if _, err := s.DeleteAdjustment(ctx, a, jsval.ToNumber(adj[0].(*omap.Map).Val("id"))); status(err) != 400 {
		t.Errorf("xoá điều chỉnh khi đã duyệt phải 400: %v", err)
	}
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "pay")); err != nil {
		t.Fatal(err)
	}
	m, _ = s.PayrollState(ctx, a)
	run := m.(*omap.Map).Val("runs").(*omap.Map).Val("2031-01").(*omap.Map)
	if run.Val("status") != "paid" || !jsval.Truthy(run.Val("closed")) || run.Val("payslips") == nil {
		t.Errorf("kỳ lương sau chi trả: %v", run)
	}
	if _, err := s.RunAction(ctx, a, omap.Of("month", "2031-01", "action", "reopen")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteAdjustment(ctx, a, jsval.ToNumber(adj[0].(*omap.Map).Val("id"))); err != nil {
		t.Errorf("xoá điều chỉnh sau khi mở lại: %v", err)
	}
	m, _ = s.PayrollState(ctx, a)
	if run := m.(*omap.Map).Val("runs").(*omap.Map).Val("2031-01").(*omap.Map); run.Val("status") != "draft" || run.Val("payslips") != nil {
		t.Errorf("kỳ lương sau khi mở lại: %v", run)
	}
}

func TestLuongCachLyDB(t *testing.T) {
	db, cts := testDB(t)
	sa, ctxA, aA := svcAs(db, "admin", "", cts[0])
	sb, ctxB, aB := svcAs(db, "admin", "", cts[1])
	sa.now = func() time.Time { return time.Date(2031, 3, 1, 3, 0, 0, 0, time.UTC) }
	sb.now = sa.now
	cleanShifts(t, sa)
	cleanPayroll(t, sa)
	if _, err := sb.SaveOrg(ctxB, aB, omap.Of("units", []any{omap.Of("key", "zzhrb", "label", "B", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	r, _ := sb.CreateEmployee(ctxB, aB, omap.Of("code", "ZZ_hrB", "name", "B", "dept", "zzhrb"))
	idB := r.(*omap.Map).Val("id")
	if _, err := sb.SavePayrollConfig(ctxB, aB, omap.Of("config", omap.Of("zzTest", "B"))); err != nil {
		t.Fatal(err)
	}
	if _, err := sb.AddAdjustment(ctxB, aB, omap.Of("empId", idB, "month", "2031-02", "kind", "bonus", "label", "B", "amount", 1.0)); err != nil {
		t.Fatal(err)
	}
	if _, err := sb.RunAction(ctxB, aB, omap.Of("month", "2031-02", "action", "close")); err != nil {
		t.Fatal(err)
	}
	if _, err := sb.SaveBudget(ctxB, aB, omap.Of("unit", "zzhrb", "fund", 1.0)); err != nil {
		t.Fatal(err)
	}
	mb, _ := sb.PayrollState(ctxB, aB)
	adjB := mb.(*omap.Map).Val("adjustments").(*omap.Map).Val("2031-02").(*omap.Map).Val(jsval.Str(idB)).([]any)[0].(*omap.Map).Val("id")

	ma, err := sa.PayrollState(ctxA, aA)
	if err != nil {
		t.Fatal(err)
	}
	st := ma.(*omap.Map)
	if c, ok := st.Val("config").(*omap.Map); ok && c.Val("zzTest") == "B" {
		t.Error("A thấy cấu hình lương của B")
	}
	if _, ok := st.Val("adjustments").(*omap.Map).Get("2031-02"); ok {
		t.Error("A thấy điều chỉnh lương của B")
	}
	if _, ok := st.Val("runs").(*omap.Map).Get("2031-02"); ok {
		t.Error("A thấy kỳ lương của B")
	}
	if _, ok := st.Val("fixed").(*omap.Map).Get("zzhrb"); ok {
		t.Error("A thấy định phí của B")
	}
	if _, err := sa.AddAdjustment(ctxA, aA, omap.Of("empId", idB, "month", "2031-02", "kind", "bonus", "label", "x", "amount", 1.0)); status(err) != 400 {
		t.Errorf("A thêm điều chỉnh cho người của B phải 400: %v", err)
	}
	if _, err := sa.DeleteAdjustment(ctxA, aA, jsval.ToNumber(adjB)); status(err) != 404 {
		t.Errorf("A xoá điều chỉnh của B phải 404: %v", err)
	}
	if _, err := sa.SaveBudget(ctxA, aA, omap.Of("unit", "zzhrb", "fund", 2.0)); status(err) != 400 {
		t.Errorf("A sửa định phí đơn vị của B phải 400: %v", err)
	}
	// kỳ lương theo công ty: A chốt / mở tháng 2031-02 không đụng kỳ của B
	if _, err := sa.RunAction(ctxA, aA, omap.Of("month", "2031-02", "action", "open")); err != nil {
		t.Fatal(err)
	}
	mb, _ = sb.PayrollState(ctxB, aB)
	if !jsval.Truthy(mb.(*omap.Map).Val("runs").(*omap.Map).Val("2031-02").(*omap.Map).Val("closed")) {
		t.Error("A mở chốt công làm đổi kỳ lương của B")
	}
	if _, err := db.InsertOne(ctxA, "hr_dieu_chinh_luong", omap.Of("nhan_vien_id", idB, "thang", "2031-02-01", "loai", "bonus", "noi_dung", "x", "so_tien", 1.0)); err == nil {
		t.Error("lớp dữ liệu cho A chèn điều chỉnh vào người của B")
	}
}
