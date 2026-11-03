package hr

import (
	"context"
	"testing"
	"time"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// dữ liệu thử: mã ca ZZ*, nhân sự ZZ_hr* (xoá nhân sự kéo theo lịch / chấm công / đơn)
func cleanShifts(t *testing.T, s *Service) {
	t.Cleanup(func() {
		if pool, err := s.db.Pool(); err == nil {
			_, _ = pool.Exec(context.Background(), `delete from hr_employees where employee_code like 'ZZ\_hr%'`)
			_, _ = pool.Exec(context.Background(), `delete from hr_shifts where shift_code like 'ZZ%'`)
		}
	})
}

func att(t *testing.T, s *Service, ctx context.Context, a *actor.Actor) *omap.Map {
	t.Helper()
	st, err := s.AttState(ctx, a, "2031-03-01", "2031-03-31")
	if err != nil {
		t.Fatal(err)
	}
	return st.(*omap.Map)
}

func TestChamCong(t *testing.T) {
	db, cts := testDB(t)
	s, ctx, a := svcAs(db, "admin", "", cts[0])
	cleanShifts(t, s)
	s.now = func() time.Time { return time.Date(2026, 10, 30, 2, 0, 0, 0, time.UTC) }
	if _, err := s.SaveOrg(ctx, a, omap.Of("units", []any{omap.Of("key", "zzhrcc", "label", "CC", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	r, _ := s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hrM", "name", "Quản lý", "dept", "zzhrcc"))
	mid := r.(*omap.Map).Val("id")
	r, _ = s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hrN", "name", "Nhân viên", "dept", "zzhrcc", "managerId", mid))
	eid := r.(*omap.Map).Val("id")
	key := jsval.Str(eid)

	_, err := s.SaveShifts(ctx, a, omap.Of("shifts", []any{omap.Of("id", "zzhc", "name", "HC", "start", "8:00", "end", "17:00", "breakMin", 60.0),
		omap.Of("id", "ZZCT", "name", "CT", "start", "07:00", "end", "16:30")},
		"schedule", omap.Of(key, []any{"ZZHC", "ZZHC", "ZZHC", "ZZHC", "ZZHC", "ZZCT", "off"})))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveShifts(ctx, a, omap.Of("schedule", omap.Of(key, []any{"ZZXX", "off", "off", "off", "off", "off", "off"}))); status(err) != 400 {
		t.Errorf("ca không có phải 400: %v", err)
	}
	// đổi mã ca: lịch đi theo
	if _, err := s.SaveShifts(ctx, a, omap.Of("shifts", []any{omap.Of("orig", "ZZCT", "id", "ZZC2", "name", "CT", "start", "07:00", "end", "16:30")})); err != nil {
		t.Fatal(err)
	}
	m := att(t, s, ctx, a)
	row := m.Val("schedule").(*omap.Map).Val(key).([]any)
	if row[0] != "ZZHC" || row[5] != "ZZC2" || row[6] != "off" {
		t.Errorf("lịch tuần: %v", row)
	}

	if _, err := s.SaveLogs(ctx, a, omap.Of("logs", []any{omap.Of("empId", eid, "date", "2031-03-29", "in", "08:12", "source", "machine")})); err != nil {
		t.Fatal(err)
	}
	// chấm ra không xoá giờ vào; GPS cần vùng
	if _, err := s.SaveLogs(ctx, a, omap.Of("logs", []any{omap.Of("empId", eid, "date", "2031-03-29", "out", "17:05", "source", "gps", "gps", "in", "dist", 40.0)})); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveLogs(ctx, a, omap.Of("logs", []any{omap.Of("empId", eid, "date", "2031-03-30", "out", "17:05", "source", "manual")})); status(err) != 400 {
		t.Errorf("chấm ra khi chưa chấm vào phải 400: %v", err)
	}
	m = att(t, s, ctx, a)
	logs := m.Val("logs").([]any)
	if len(logs) != 1 || logs[0].(*omap.Map).Val("in") != "08:12" || logs[0].(*omap.Map).Val("out") != "17:05" || logs[0].(*omap.Map).Val("gps") != "in" {
		t.Errorf("chấm công: %v", logs)
	}

	// đơn: quản lý -> HR; từ chối cần ghi chú; duyệt hết = đã duyệt
	rq, err := s.CreateRequest(ctx, a, omap.Of("empId", eid, "type", "leave", "leaveKind", "annual", "from", "2031-03-29", "to", "2031-03-30", "days", 2.0, "reason", "Việc nhà"))
	if err != nil {
		t.Fatal(err)
	}
	req := rq.(*omap.Map)
	steps := req.Val("steps").([]any)
	if len(steps) != 2 || steps[0].(*omap.Map).Val("name") != "Quản lý" || steps[0].(*omap.Map).Val("state") != "active" || req.Val("title") != "Nghỉ phép năm — 29/03 đến 30/03" {
		t.Errorf("đơn mới: %v", req)
	}
	rid := jsval.ToNumber(req.Val("id"))
	if _, err := s.DecideRequest(ctx, a, rid, omap.Of("approve", false)); status(err) != 400 {
		t.Errorf("từ chối không ghi chú phải 400: %v", err)
	}
	if _, err := s.DecideRequest(ctx, a, rid, omap.Of("approve", true)); err != nil {
		t.Fatal(err)
	}
	out, err := s.DecideRequest(ctx, a, rid, omap.Of("approve", true, "note", "ok"))
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range out.(*omap.Map).Val("steps").([]any) {
		if x.(*omap.Map).Val("state") != "done" {
			t.Errorf("sau 2 lần duyệt: %v", out)
		}
	}
	if _, err := s.DecideRequest(ctx, a, rid, omap.Of("approve", true)); status(err) != 400 {
		t.Errorf("duyệt đơn đã xong phải 400: %v", err)
	}
	if _, err := s.CreateRequest(ctx, a, omap.Of("empId", eid, "type", "ot", "from", "2031-03-29", "hours", 30.0)); status(err) != 400 {
		t.Errorf("OT 30 giờ phải 400: %v", err)
	}
	// xoá ca -> ô lịch thành nghỉ
	if _, err := s.SaveShifts(ctx, a, omap.Of("deleteShifts", []any{"ZZC2"})); err != nil {
		t.Fatal(err)
	}
	// lịch riêng 1 ngày: đổi ca / nghỉ / bỏ về lịch tuần
	if _, err := s.SaveShifts(ctx, a, omap.Of("overrides", []any{omap.Of("empId", eid, "date", "2031-03-03", "shift", "off"),
		omap.Of("empId", eid, "date", "2031-03-04", "shift", "ZZHC")})); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveShifts(ctx, a, omap.Of("overrides", []any{omap.Of("empId", eid, "date", "2031-03-04", "shift", "")})); err != nil {
		t.Fatal(err)
	}
	if ov := att(t, s, ctx, a).Val("overrides").(*omap.Map).Val(key).(*omap.Map); ov.Val("2031-03-03") != "off" || ov.Has("2031-03-04") {
		t.Errorf("lịch riêng: %v", ov)
	}
	if row := att(t, s, ctx, a).Val("schedule").(*omap.Map).Val(key).([]any); row[5] != "off" || row[0] != "ZZHC" {
		t.Errorf("lịch sau khi xoá ca: %v", row)
	}
}

func TestChamCongCachLyDB(t *testing.T) {
	db, cts := testDB(t)
	sa, ctxA, aA := svcAs(db, "admin", "", cts[0])
	sb, ctxB, aB := svcAs(db, "admin", "", cts[1])
	cleanShifts(t, sa)
	if _, err := sb.SaveOrg(ctxB, aB, omap.Of("units", []any{omap.Of("key", "zzhrb", "label", "B", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	r, _ := sb.CreateEmployee(ctxB, aB, omap.Of("code", "ZZ_hrB", "name", "B", "dept", "zzhrb"))
	idB := r.(*omap.Map).Val("id")
	if _, err := sb.SaveShifts(ctxB, aB, omap.Of("shifts", []any{omap.Of("id", "ZZB", "name", "B", "start", "08:00", "end", "17:00")},
		"schedule", omap.Of(jsval.Str(idB), []any{"ZZB", "off", "off", "off", "off", "off", "off"}))); err != nil {
		t.Fatal(err)
	}
	if _, err := sb.SaveLogs(ctxB, aB, omap.Of("logs", []any{omap.Of("empId", idB, "date", "2031-03-29", "in", "08:00", "source", "manual")})); err != nil {
		t.Fatal(err)
	}
	rq, err := sb.CreateRequest(ctxB, aB, omap.Of("empId", idB, "type", "late", "from", "2031-03-29"))
	if err != nil {
		t.Fatal(err)
	}
	rid := jsval.ToNumber(rq.(*omap.Map).Val("id"))

	m := att(t, sa, ctxA, aA)
	for _, k := range []string{"shifts", "logs", "requests"} {
		for _, x := range m.Val(k).([]any) {
			x := x.(*omap.Map)
			if x.Val("id") == "ZZB" || x.Val("empId") == idB {
				t.Errorf("A thấy %s của B: %v", k, x)
			}
		}
	}
	if _, ok := m.Val("schedule").(*omap.Map).Get(jsval.Str(idB)); ok {
		t.Error("A thấy lịch của B")
	}
	if _, err := sa.SaveLogs(ctxA, aA, omap.Of("logs", []any{omap.Of("empId", idB, "date", "2031-03-30", "in", "08:00", "source", "manual")})); status(err) != 400 {
		t.Errorf("A chấm công cho người của B phải 400: %v", err)
	}
	if _, err := sa.SaveShifts(ctxA, aA, omap.Of("schedule", omap.Of(jsval.Str(idB), []any{"off", "off", "off", "off", "off", "off", "off"}))); status(err) != 400 {
		t.Errorf("A sửa lịch của B phải 400: %v", err)
	}
	if _, err := sa.SaveShifts(ctxA, aA, omap.Of("deleteShifts", []any{"ZZB"})); status(err) != 404 {
		t.Errorf("A xoá ca của B phải 404: %v", err)
	}
	if _, err := sa.CreateRequest(ctxA, aA, omap.Of("empId", idB, "type", "late", "from", "2031-03-29")); status(err) != 400 {
		t.Errorf("A tạo đơn cho người của B phải 400: %v", err)
	}
	if _, err := sa.DecideRequest(ctxA, aA, rid, omap.Of("approve", true)); status(err) != 404 {
		t.Errorf("A duyệt đơn của B phải 404: %v", err)
	}
	if _, err := db.InsertOne(ctxA, "hr_cham_cong", omap.Of("nhan_vien_id", idB, "ngay", "2031-03-31", "gio_vao", "08:00", "nguon", "manual")); err == nil {
		t.Error("lớp dữ liệu cho A chèn chấm công vào người của B")
	}
	if logs := att(t, sb, ctxB, aB).Val("logs").([]any); len(logs) != 1 {
		t.Errorf("chấm công của B bị đổi: %v", logs)
	}
}
