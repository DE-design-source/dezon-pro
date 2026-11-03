package hr

import (
	"context"
	"testing"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// dữ liệu thử: JD / mục tiêu có tên ZZ_tl*, kỳ ZZ-ky; nhân sự ZZ_hr* (xoá kéo theo đánh giá, ghi danh).
func cleanTalent(t *testing.T, s *Service) {
	t.Cleanup(func() {
		if pool, err := s.db.Pool(); err == nil {
			bg := context.Background()
			_, _ = pool.Exec(bg, `delete from hr_job_openings where title like 'ZZ\_tl%'`)
			_, _ = pool.Exec(bg, `delete from hr_job_descriptions where title like 'ZZ\_tl%'`)
			_, _ = pool.Exec(bg, `delete from hr_objectives where title like 'ZZ\_tl%'`)
			_, _ = pool.Exec(bg, `delete from hr_learning_paths where title like 'ZZ\_tl%'`)
			_, _ = pool.Exec(bg, `delete from hr_courses where title like 'ZZ\_tl%'`)
		}
	})
}

// idFn: id(s.X(...)) lấy id từ kết quả {id, ...}, dừng test nếu lỗi.
func idFn(t *testing.T) func(any, error) float64 {
	return func(r any, err error) float64 {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return jsval.ToNumber(r.(*omap.Map).Val("id"))
	}
}

func TestTuyenDungHieuSuat(t *testing.T) {
	db, cts := testDB(t)
	s, ctx, a := svcAs(db, "admin", "", cts[0])
	cleanShifts(t, s)
	cleanTalent(t, s)
	id := idFn(t)
	if _, err := s.SaveOrg(ctx, a, omap.Of("units", []any{omap.Of("key", "zzhrtl", "label", "TL", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	eid := id(s.CreateEmployee(ctx, a, omap.Of("code", "ZZ_hrT", "name", "Người TL", "dept", "zzhrtl")))

	jd := id(s.SaveJD(ctx, a, omap.Of("title", "ZZ_tl KS", "dept", "zzhrtl", "duties", []any{"Giám sát", " ", "Nghiệm thu"})))
	job := id(s.SaveJob(ctx, a, omap.Of("jdId", jd, "qty", 2.0, "channels", []any{"TopCV"}, "deadline", "2026-12-31")))
	if _, err := s.SaveJob(ctx, a, omap.Of("jdId", 999999999.0, "qty", 1.0)); status(err) != 400 {
		t.Errorf("tin không có JD phải 400: %v", err)
	}
	// đổi tên JD -> tin đổi theo; JD đang dùng không xoá được
	if _, err := s.SaveJD(ctx, a, omap.Of("id", jd, "title", "ZZ_tl KS giám sát", "dept", "zzhrtl")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteJD(ctx, a, jd); status(err) != 400 {
		t.Errorf("xoá JD đang dùng phải 400: %v", err)
	}
	if _, err := s.CreateCandidate(ctx, a, omap.Of("jobId", job, "name", "X", "cvUrl", "javascript:alert(1)")); status(err) != 400 {
		t.Errorf("link CV lạ phải 400: %v", err)
	}
	cid := id(s.CreateCandidate(ctx, a, omap.Of("jobId", job, "name", "Ứng viên A", "source", "TopCV", "cvUrl", "/files/cv/a.pdf")))
	if _, err := s.UpdateCandidate(ctx, a, cid, omap.Of("interview", omap.Of("date", "2026-11-05", "time", "09:00", "round", "Vòng 1"),
		"review", omap.Of("round", "Vòng 1", "scores", omap.Of("chuyenmon", 4.0), "note", "Tốt"))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateCandidate(ctx, a, cid, omap.Of("stage", "hired")); status(err) != 400 {
		t.Errorf("nhận việc không có hồ sơ phải 400: %v", err)
	}
	if _, err := s.UpdateCandidate(ctx, a, cid, omap.Of("stage", "hired", "hiredEmployeeId", eid)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateCandidate(ctx, a, cid, omap.Of("stage", "offer")); status(err) != 400 {
		t.Errorf("chuyển ứng viên đã nhận việc phải 400: %v", err)
	}

	okr := id(s.CreateOKR(ctx, a, omap.Of("period", "ZZ-ky", "title", "ZZ_tl Mục tiêu", "owner", eid,
		"krs", []any{omap.Of("title", "KR1", "target", 100.0, "unit", "%", "owner", eid)})))
	if _, err := s.SetKR(ctx, a, okr, omap.Of("krId", 1.0, "current", 40.0)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewAction(ctx, a, omap.Of("period", "ZZ-ky", "action", "mgr", "empId", eid, "scores", omap.Of("kq", 4.0))); status(err) != 400 {
		t.Errorf("quản lý chấm trước khi tự đánh giá phải 400: %v", err)
	}
	if _, err := s.ReviewAction(ctx, a, omap.Of("period", "ZZ-ky", "action", "launch", "empIds", []any{eid})); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewAction(ctx, a, omap.Of("period", "ZZ-ky", "action", "self", "empId", eid, "scores", omap.Of("kq", 6.0))); status(err) != 400 {
		t.Errorf("điểm 6 phải 400: %v", err)
	}
	for _, act := range []string{"self", "mgr"} {
		if _, err := s.ReviewAction(ctx, a, omap.Of("period", "ZZ-ky", "action", act, "empId", eid, "scores", omap.Of("kq", 4.0), "note", act)); err != nil {
			t.Fatal(err)
		}
	}
	c1 := id(s.SaveCourse(ctx, a, omap.Of("title", "ZZ_tl ATLĐ", "hours", 16.0, "mandatory", true)))
	c2 := id(s.SaveCourse(ctx, a, omap.Of("title", "ZZ_tl Văn hoá", "hours", 3.0)))
	k1, k2 := jsval.NumberToString(c1), jsval.NumberToString(c2)
	pth := id(s.SavePath(ctx, a, omap.Of("title", "ZZ_tl Lộ trình", "courses", []any{c2, c1})))
	if _, err := s.Enroll(ctx, a, omap.Of("empId", eid, "courses", omap.Of("999999999", 1.0))); status(err) != 400 {
		t.Errorf("ghi danh khoá không có phải 400: %v", err)
	}
	if _, err := s.Enroll(ctx, a, omap.Of("empId", eid, "courses", omap.Of(k2, 0.0, k1, 50.0))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Enroll(ctx, a, omap.Of("empId", eid, "courses", omap.Of(k1, 100.0))); err != nil {
		t.Fatal(err)
	}

	st, err := s.TalentState(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	m := st.(*omap.Map)
	var gotJob, gotCand, gotOkr *omap.Map
	for _, x := range m.Val("jobs").([]any) {
		if x.(*omap.Map).Val("id") == job {
			gotJob = x.(*omap.Map)
		}
	}
	for _, x := range m.Val("candidates").([]any) {
		if x.(*omap.Map).Val("id") == cid {
			gotCand = x.(*omap.Map)
		}
	}
	for _, x := range m.Val("okrs").([]any) {
		if x.(*omap.Map).Val("id") == okr {
			gotOkr = x.(*omap.Map)
		}
	}
	if gotJob == nil || gotJob.Val("title") != "ZZ_tl KS giám sát" || gotJob.Val("qty") != 2.0 {
		t.Errorf("tin: %v", gotJob)
	}
	if gotCand == nil || gotCand.Val("stage") != "hired" || gotCand.Val("empCode") != "ZZ_hrT" || len(gotCand.Val("reviews").([]any)) != 1 {
		t.Errorf("ứng viên: %v", gotCand)
	}
	ivs := 0
	for _, x := range m.Val("interviews").([]any) {
		if x.(*omap.Map).Val("candidateId") == cid {
			ivs++
		}
	}
	if ivs != 1 {
		t.Errorf("lịch phỏng vấn của ứng viên: %d", ivs)
	}
	if kr := gotOkr.Val("krs").([]any)[0].(*omap.Map); kr.Val("current") != 40.0 {
		t.Errorf("KR: %v", kr)
	}
	if r := m.Val("reviews").(*omap.Map).Val("ZZ-ky").(*omap.Map).Val(jsval.Str(eid)).(*omap.Map); r.Val("state") != "done" || r.Val("mgrNote") != "mgr" {
		t.Errorf("đánh giá: %v", r)
	}
	if en := m.Val("enroll").(*omap.Map).Val(jsval.Str(eid)).(*omap.Map); en.Val(k1) != 100.0 || en.Val(k2) != 0.0 {
		t.Errorf("ghi danh: %v", en)
	}
	if gotCand.Val("cvUrl") != "/files/cv/a.pdf" {
		t.Errorf("cvUrl: %v", gotCand.Val("cvUrl"))
	}
	// xoá khoá học -> bỏ khỏi lộ trình, ghi danh của khoá đó không còn trả về
	if _, err := s.DeleteCourse(ctx, a, c2); err != nil {
		t.Fatal(err)
	}
	st, _ = s.TalentState(ctx, a)
	for _, x := range st.(*omap.Map).Val("paths").([]any) {
		if p := x.(*omap.Map); p.Val("id") == pth && len(p.Val("courses").([]any)) != 1 {
			t.Errorf("lộ trình sau khi xoá khoá: %v", p)
		}
	}
	if en := st.(*omap.Map).Val("enroll").(*omap.Map).Val(jsval.Str(eid)).(*omap.Map); en.Has(k2) {
		t.Errorf("ghi danh khoá đã xoá vẫn trả về: %v", en)
	}
}

func TestTuyenDungCachLyDB(t *testing.T) {
	db, cts := testDB(t)
	sa, ctxA, aA := svcAs(db, "admin", "", cts[0])
	sb, ctxB, aB := svcAs(db, "admin", "", cts[1])
	cleanShifts(t, sa)
	cleanTalent(t, sa)
	id := idFn(t)
	if _, err := sb.SaveOrg(ctxB, aB, omap.Of("units", []any{omap.Of("key", "zzhrb", "label", "B", "type", "dept")})); err != nil {
		t.Fatal(err)
	}
	eB := id(sb.CreateEmployee(ctxB, aB, omap.Of("code", "ZZ_hrB", "name", "B", "dept", "zzhrb")))
	jdB := id(sb.SaveJD(ctxB, aB, omap.Of("title", "ZZ_tl B")))
	jobB := id(sb.SaveJob(ctxB, aB, omap.Of("jdId", jdB, "qty", 1.0)))
	cB := id(sb.CreateCandidate(ctxB, aB, omap.Of("jobId", jobB, "name", "UV B")))
	okrB := id(sb.CreateOKR(ctxB, aB, omap.Of("period", "ZZ-ky", "title", "ZZ_tl B", "owner", eB, "krs", []any{omap.Of("title", "KR")})))

	st, err := sa.TalentState(ctxA, aA)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"jds", "jobs", "candidates", "okrs"} {
		for _, x := range st.(*omap.Map).Val(k).([]any) {
			if id := x.(*omap.Map).Val("id"); id == jdB || id == jobB || id == cB || id == okrB {
				t.Errorf("A thấy %s của B", k)
			}
		}
	}
	if _, err := sa.SaveJD(ctxA, aA, omap.Of("id", jdB, "title", "hack")); status(err) != 404 {
		t.Errorf("A sửa JD của B phải 404: %v", err)
	}
	if _, err := sa.DeleteJD(ctxA, aA, jdB); status(err) != 404 {
		t.Errorf("A xoá JD của B phải 404: %v", err)
	}
	if _, err := sa.SaveJob(ctxA, aA, omap.Of("jdId", jdB, "qty", 1.0)); status(err) != 400 {
		t.Errorf("A đăng tin từ JD của B phải 400: %v", err)
	}
	if _, err := sa.CreateCandidate(ctxA, aA, omap.Of("jobId", jobB, "name", "x")); status(err) != 400 {
		t.Errorf("A thêm ứng viên vào tin của B phải 400: %v", err)
	}
	if _, err := sa.UpdateCandidate(ctxA, aA, cB, omap.Of("stage", "rejected")); status(err) != 404 {
		t.Errorf("A sửa ứng viên của B phải 404: %v", err)
	}
	if _, err := sa.SetKR(ctxA, aA, okrB, omap.Of("krId", 1.0, "current", 1.0)); status(err) != 404 {
		t.Errorf("A sửa mục tiêu của B phải 404: %v", err)
	}
	if _, err := sa.CreateOKR(ctxA, aA, omap.Of("period", "ZZ-ky", "title", "ZZ_tl A", "owner", eB, "krs", []any{omap.Of("title", "KR")})); status(err) != 400 {
		t.Errorf("A giao mục tiêu cho người của B phải 400: %v", err)
	}
	for _, b := range []*omap.Map{omap.Of("period", "ZZ-ky", "action", "launch", "empIds", []any{eB}), omap.Of("period", "ZZ-ky", "action", "self", "empId", eB, "scores", omap.Of("kq", 3.0))} {
		if _, err := sa.ReviewAction(ctxA, aA, b); status(err) != 400 {
			t.Errorf("A đánh giá người của B phải 400: %v", err)
		}
	}
	if _, err := sa.Enroll(ctxA, aA, omap.Of("empId", eB, "courses", omap.Of("1", 10.0))); status(err) != 400 {
		t.Errorf("A ghi danh người của B phải 400: %v", err)
	}
	if _, err := db.InsertOne(ctxA, "hr_ung_vien", omap.Of("tin_id", jobB, "ho_ten", "x", "ngay_nop", "2026-11-03")); err == nil {
		t.Error("lớp dữ liệu cho A chèn ứng viên vào tin của B")
	}
}
