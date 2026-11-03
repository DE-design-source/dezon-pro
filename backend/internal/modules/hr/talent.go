package hr

import (
	"context"
	"strconv"
	"strings"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Tuyển dụng + hiệu suất & đào tạo (migration 0023): thư viện JD (hr_jd), tin tuyển dụng (hr_tin_tuyen), ứng viên kèm đánh giá
// và lịch phỏng vấn (hr_ung_vien), mục tiêu OKR (hr_muc_tieu), đánh giá theo kỳ (hr_danh_gia), ghi danh khoá học (hr_ghi_danh).
// Lệnh ghi trả {ok} (thêm mới trả thêm id); giao diện đọc lại GET /hr/talent.

var (
	candStages    = map[string]bool{"applied": true, "screening": true, "interview": true, "offer": true, "hired": true, "rejected": true}
	openingStatus = map[string]bool{"open": true, "paused": true, "closed": true}
)

// strArr: mảng chuỗi (bỏ phần tử rỗng), tối đa 100 phần tử.
func strArr(b *omap.Map, k string) []any {
	out := []any{}
	arr, _ := b.Val(k).([]any)
	for _, x := range arr {
		if t := jsval.Trim(jsval.Str(x)); t != "" && len(out) < 100 {
			out = append(out, t)
		}
	}
	return out
}

func numOr0(v any) float64 {
	n := jsval.ToNumber(v)
	if n != n {
		return 0
	}
	return n
}

// TalentState: jds, jobs, candidates, interviews (trải từ ứng viên), okrs, reviews {kỳ: {empId: ...}}, enroll {empId: {courseId: %}}.
func (s *Service) TalentState(ctx context.Context, a *actor.Actor) (any, error) {
	x, err := s.gate(ctx, a, "", "")
	if err != nil {
		return nil, err
	}
	sel := func(tbl, order string) ([]*omap.Map, error) {
		return s.db.Select(ctx, tbl, database.SelectOpt{Order: order, Limit: 20000})
	}
	jds, err := sel("hr_jd", "id.asc")
	if err != nil {
		return nil, err
	}
	jdOut := make([]any, len(jds))
	for i, r := range jds {
		jdOut[i] = omap.Of("id", r.Val("id"), "code", r.Val("ma"), "title", r.Val("ten"), "dept", r.Val("phong_ban"), "level", r.Val("cap_bac"),
			"salary", r.Val("luong"), "summary", r.Val("tom_tat"), "duties", orArr(r.Val("nhiem_vu")), "requirements", orArr(r.Val("yeu_cau")),
			"benefits", orArr(r.Val("quyen_loi")), "updated", ngay(r.Val("cap_nhat")))
	}
	jobs, err := sel("hr_tin_tuyen", "id.asc")
	if err != nil {
		return nil, err
	}
	jobOut := make([]any, len(jobs))
	for i, r := range jobs {
		jobOut[i] = omap.Of("id", r.Val("id"), "jdId", r.Val("jd_id"), "title", r.Val("ten"), "dept", r.Val("phong_ban"), "qty", jsval.ToNumber(r.Val("so_luong")),
			"site", r.Val("noi_lam_viec"), "salary", r.Val("luong"), "deadline", jsval.Or(r.Val("han_nop"), ""), "status", r.Val("trang_thai"),
			"channels", orArr(r.Val("kenh")), "desc", r.Val("mo_ta"))
	}
	emps, err := s.db.Select(ctx, "hr_nhan_vien", database.SelectOpt{Select: "id,ma_nv,phong_ban", Limit: 10000})
	if err != nil {
		return nil, err
	}
	empOf := map[float64]*omap.Map{}
	for _, e := range emps {
		empOf[jsval.ToNumber(e.Val("id"))] = e
	}
	cands, err := sel("hr_ung_vien", "id.asc")
	if err != nil {
		return nil, err
	}
	cOut, ivOut := make([]any, len(cands)), []any{}
	for i, r := range cands {
		cid := jsval.ToNumber(r.Val("id"))
		c := omap.Of("id", r.Val("id"), "jobId", r.Val("tin_id"), "name", r.Val("ho_ten"), "email", r.Val("email"), "phone", r.Val("sdt"),
			"source", r.Val("nguon"), "stage", r.Val("giai_doan"), "applied", r.Val("ngay_nop"), "cv", r.Val("cv"), "cvUrl", r.Val("cv_url"), "exp", r.Val("kinh_nghiem"),
			"reviews", orArr(r.Val("danh_gia")))
		if e := empOf[jsval.ToNumber(r.Val("nhan_vien_id"))]; e != nil {
			c.Set("empId", e.Val("id")).Set("empCode", e.Val("ma_nv")).Set("empDept", e.Val("phong_ban")).Set("hiredAt", jsval.Or(r.Val("ngay_nhan_viec"), ""))
		}
		cOut[i] = c
		for j, x := range orArr(r.Val("phong_van")) {
			if m, ok := x.(*omap.Map); ok {
				ivOut = append(ivOut, omap.Assign(omap.New(), m).Set("id", cid*1000+float64(j)).Set("candidateId", r.Val("id")))
			}
		}
	}
	okrs, err := sel("hr_muc_tieu", "id.asc")
	if err != nil {
		return nil, err
	}
	okrOut := make([]any, len(okrs))
	for i, r := range okrs {
		okrOut[i] = omap.Of("id", r.Val("id"), "period", r.Val("ky"), "title", r.Val("ten"), "owner", jsval.Or(r.Val("phu_trach_id"), nil),
			"dept", r.Val("phong_ban"), "krs", orArr(r.Val("ket_qua")))
	}
	revs, err := sel("hr_danh_gia", "id.asc")
	if err != nil {
		return nil, err
	}
	revOut := omap.New()
	for _, r := range revs {
		per := jsval.Str(r.Val("ky"))
		m, _ := revOut.Val(per).(*omap.Map)
		if m == nil {
			m = omap.New()
			revOut.Set(per, m)
		}
		m.Set(jsval.Str(r.Val("nhan_vien_id")), omap.Of("state", r.Val("trang_thai"), "self", jsval.Or(r.Val("tu_cham"), nil), "mgr", jsval.Or(r.Val("ql_cham"), nil),
			"selfNote", r.Val("tu_nhan_xet"), "mgrNote", r.Val("ql_nhan_xet")))
	}
	courses, err := sel("hr_khoa_hoc", "id.asc")
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	cOutC := make([]any, len(courses))
	for i, r := range courses {
		known[jsval.Str(r.Val("id"))] = true
		cOutC[i] = omap.Of("id", r.Val("id"), "title", r.Val("ten"), "category", r.Val("nhom"), "hours", jsval.ToNumber(r.Val("so_gio")),
			"format", r.Val("hinh_thuc"), "mandatory", jsval.Truthy(r.Val("bat_buoc")), "tone", r.Val("mau"))
	}
	paths, err := sel("hr_lo_trinh", "id.asc")
	if err != nil {
		return nil, err
	}
	pOut := make([]any, len(paths))
	for i, r := range paths {
		ids := []any{}
		for _, c := range orArr(r.Val("khoa_hoc_ids")) {
			if known[jsval.Str(c)] {
				ids = append(ids, jsval.ToNumber(c))
			}
		}
		pOut[i] = omap.Of("id", r.Val("id"), "title", r.Val("ten"), "for", r.Val("doi_tuong"), "courses", ids)
	}
	ens, err := sel("hr_ghi_danh", "id.asc")
	if err != nil {
		return nil, err
	}
	enOut := omap.New()
	for _, r := range ens {
		k := jsval.Str(r.Val("nhan_vien_id"))
		m, _ := enOut.Val(k).(*omap.Map)
		if m == nil {
			m = omap.New()
			enOut.Set(k, m)
		}
		if known[jsval.Str(r.Val("khoa_hoc_id"))] {
			m.Set(jsval.Str(r.Val("khoa_hoc_id")), jsval.ToNumber(r.Val("tien_do_pct")))
		}
	}
	// trưởng phòng (phạm vi phòng ban): chỉ JD / tin / ứng viên / lịch phỏng vấn của phòng mình
	if x.scope != "all" {
		keepJob := map[string]bool{}
		fJD, fJob, fCand, fIv := []any{}, []any{}, []any{}, []any{}
		for _, v := range jdOut {
			if x.deptOK(v.(*omap.Map).Val("dept")) {
				fJD = append(fJD, v)
			}
		}
		for _, v := range jobOut {
			if m := v.(*omap.Map); x.deptOK(m.Val("dept")) {
				keepJob[jsval.Str(m.Val("id"))] = true
				fJob = append(fJob, v)
			}
		}
		keepCand := map[string]bool{}
		for _, v := range cOut {
			if m := v.(*omap.Map); keepJob[jsval.Str(m.Val("jobId"))] {
				keepCand[jsval.Str(m.Val("id"))] = true
				fCand = append(fCand, v)
			}
		}
		for _, v := range ivOut {
			if keepCand[jsval.Str(v.(*omap.Map).Val("candidateId"))] {
				fIv = append(fIv, v)
			}
		}
		jdOut, jobOut, cOut, ivOut = fJD, fJob, fCand, fIv
	}
	// không có quyền xem phân hệ -> trả rỗng; đánh giá / ghi danh chỉ của người trong phạm vi
	if !x.can("recruit", "view") {
		jdOut, jobOut, cOut, ivOut = []any{}, []any{}, []any{}, []any{}
	}
	if !x.can("performance", "view") {
		okrOut, revOut, enOut, cOutC, pOut = []any{}, omap.New(), omap.New(), []any{}, []any{}
	}
	ids, err := s.scopedIDs(ctx, x)
	if err != nil {
		return nil, err
	}
	if ids != nil {
		revOut.Each(func(per string, v any) {
			m := v.(*omap.Map)
			for _, k := range m.Keys() {
				if !ids[k] {
					m.Delete(k)
				}
			}
		})
		for _, k := range enOut.Keys() {
			if !ids[k] {
				enOut.Delete(k)
			}
		}
	}
	return omap.Of("jds", jdOut, "jobs", jobOut, "candidates", cOut, "interviews", ivOut, "okrs", okrOut, "reviews", revOut, "enroll", enOut,
		"courses", cOutC, "paths", pOut), nil
}

// ngay: thời điểm -> yyyy-mm-dd giờ Việt Nam.
func ngay(v any) any {
	t, err := time.Parse(time.RFC3339Nano, jsval.Str(v))
	if err != nil {
		return nil
	}
	return t.In(vn).Format("2006-01-02")
}

func (s *Service) one(ctx context.Context, tbl string, id any) (*omap.Map, error) {
	if !validID(id) {
		return nil, nil
	}
	rows, err := s.db.Select(ctx, tbl, database.SelectOpt{Filter: database.Eq("id", id), Limit: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// upsert: sửa dòng id (phải thuộc công ty) hoặc thêm mới; trả id.
func (s *Service) upsert(ctx context.Context, tbl string, id any, row *omap.Map, notFound string) (any, error) {
	now := s.nowISO()
	row.Set("cap_nhat", now)
	if !jsval.IsNullish(id) && jsval.Str(id) != "" {
		out, err := s.db.Update(ctx, tbl, database.Eq("id", id), row)
		if err != nil {
			return nil, err
		}
		if len(out) == 0 {
			return nil, apperr.NotFound(notFound)
		}
		return out[0].Val("id"), nil
	}
	out, err := s.db.InsertOne(ctx, tbl, row.Set("ngay_tao", now))
	if err != nil {
		return nil, err
	}
	return out[0].Val("id"), nil
}

// SaveJD: thêm / sửa JD {id?, code, title, dept, level, salary, summary, duties[], requirements[], benefits[]};
// sửa tên / phòng ban thì các tin dùng JD đổi theo.
func (s *Service) SaveJD(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "recruit", "edit")
	if err != nil {
		return nil, err
	}
	title := str(b, "title")
	if title == "" {
		return nil, apperr.BadRequest("Thiếu tên vị trí")
	}
	if err := s.jdAllowed(ctx, x, b.Val("id"), str(b, "dept")); err != nil {
		return nil, err
	}
	row := omap.Of("ma", str(b, "code"), "ten", title, "phong_ban", str(b, "dept"), "cap_bac", str(b, "level"), "luong", str(b, "salary"),
		"tom_tat", str(b, "summary"), "nhiem_vu", strArr(b, "duties"), "yeu_cau", strArr(b, "requirements"), "quyen_loi", strArr(b, "benefits"))
	var id any
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		var err error
		if id, err = s.upsert(ctx, "hr_jd", b.Val("id"), row, "Không tìm thấy JD"); err != nil {
			return err
		}
		_, err = s.db.Update(ctx, "hr_tin_tuyen", database.Eq("jd_id", id), omap.Of("ten", title, "phong_ban", str(b, "dept"), "cap_nhat", s.nowISO()))
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "recruit", "edit", "Thư viện JD: "+title)
	return omap.Of("ok", true, "id", id), nil
}

// DeleteJD: xoá JD chưa có tin nào dùng.
func (s *Service) DeleteJD(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	x, err := s.gate(ctx, a, "recruit", "delete")
	if err != nil {
		return nil, err
	}
	if err := s.jdAllowed(ctx, x, id, ""); err != nil {
		return nil, err
	}
	rows, err := s.db.Remove(ctx, "hr_jd", database.Eq("id", id))
	if database.CodeOf(err) == "23503" {
		return nil, apperr.BadRequest("JD đang được dùng bởi tin tuyển dụng - không thể xoá")
	}
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, apperr.NotFound("Không tìm thấy JD")
	}
	s.audit(ctx, x, "recruit", "delete", "Xoá JD #"+jsval.NumberToString(id))
	return okRes, nil
}

// SaveJob: thêm / sửa tin {id?, jdId, title, dept, qty, site, salary, deadline, status, channels[], desc}.
func (s *Service) SaveJob(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "recruit", "edit")
	if err != nil {
		return nil, err
	}
	jd, err := s.one(ctx, "hr_jd", jsval.ToNumber(b.Val("jdId")))
	if err != nil {
		return nil, err
	}
	if jd == nil {
		return nil, apperr.BadRequest("Chọn JD trong thư viện")
	}
	if err := x.deptNeed(jsval.StrOr(str(b, "dept"), jsval.Str(jd.Val("phong_ban")))); err != nil {
		return nil, err
	}
	if validID(b.Val("id")) {
		if old, err := s.one(ctx, "hr_tin_tuyen", b.Val("id")); err != nil {
			return nil, err
		} else if old != nil {
			if err := x.deptNeed(old.Val("phong_ban")); err != nil {
				return nil, err
			}
		}
	}
	qty := jsval.ToNumber(b.Val("qty"))
	if qty != qty || qty < 1 || qty > 1000 {
		return nil, apperr.BadRequest("Số lượng tuyển phải từ 1 đến 1000")
	}
	st := jsval.StrOr(str(b, "status"), "open")
	if !openingStatus[st] {
		return nil, apperr.BadRequest("Trạng thái tin không hợp lệ")
	}
	var dl any
	if d := str(b, "deadline"); d != "" {
		if !isoDate.MatchString(d) {
			return nil, apperr.BadRequest("Hạn nộp không hợp lệ")
		}
		dl = d
	}
	row := omap.Of("jd_id", jd.Val("id"), "ten", jsval.StrOr(str(b, "title"), jsval.Str(jd.Val("ten"))), "phong_ban", jsval.StrOr(str(b, "dept"), jsval.Str(jd.Val("phong_ban"))),
		"so_luong", jsval.Round(qty), "noi_lam_viec", str(b, "site"), "luong", str(b, "salary"), "han_nop", dl, "trang_thai", st,
		"kenh", strArr(b, "channels"), "mo_ta", str(b, "desc"))
	id, err := s.upsert(ctx, "hr_tin_tuyen", b.Val("id"), row, "Không tìm thấy tin tuyển dụng")
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "recruit", "edit", "Tin tuyển dụng: "+jsval.Str(row.Val("ten")))
	return omap.Of("ok", true, "id", id), nil
}

// CreateCandidate: {jobId, name, email, phone, source, cv, exp}.
func (s *Service) CreateCandidate(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "recruit", "create")
	if err != nil {
		return nil, err
	}
	job, err := s.one(ctx, "hr_tin_tuyen", jsval.ToNumber(b.Val("jobId")))
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, apperr.BadRequest("Không tìm thấy tin tuyển dụng")
	}
	if err := x.deptNeed(job.Val("phong_ban")); err != nil {
		return nil, err
	}
	name := str(b, "name")
	if name == "" {
		return nil, apperr.BadRequest("Thiếu tên ứng viên")
	}
	cvURL := str(b, "cvUrl")
	if cvURL != "" && !strings.HasPrefix(cvURL, "/files/") && !strings.HasPrefix(cvURL, "https://") {
		return nil, apperr.BadRequest("Link CV phải là file trong kho (/files/...) hoặc https://")
	}
	out, err := s.db.InsertOne(ctx, "hr_ung_vien", omap.Of("tin_id", job.Val("id"), "ho_ten", name, "email", str(b, "email"), "sdt", str(b, "phone"),
		"nguon", str(b, "source"), "cv", str(b, "cv"), "cv_url", cvURL, "kinh_nghiem", str(b, "exp"), "ngay_nop", s.now().In(vn).Format("2006-01-02"),
		"nguoi_tao", a.UID, "ngay_tao", s.nowISO(), "cap_nhat", s.nowISO()))
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "recruit", "create", "Ứng viên "+name)
	return omap.Of("ok", true, "id", out[0].Val("id")), nil
}

// UpdateCandidate: {stage?, review? (thêm 1 đánh giá), interview? (thêm 1 lịch; ứng viên đang applied / screening -> interview),
// hiredEmployeeId? (kèm stage hired: hồ sơ nhân sự tạo ở bước Nhận việc)}. Ứng viên đã nhận việc không đổi giai đoạn được.
func (s *Service) UpdateCandidate(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "recruit", "edit")
	if err != nil {
		return nil, err
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		// khoá dòng trước khi đọc - sửa tài liệu JSON (2 người lưu cùng lúc không làm mất bản của nhau)
		if _, err := s.db.Update(ctx, "hr_ung_vien", database.Eq("id", id), omap.Of("cap_nhat", s.nowISO())); err != nil {
			return err
		}
		c, err := s.one(ctx, "hr_ung_vien", id)
		if err != nil {
			return err
		}
		if c == nil {
			return apperr.NotFound("Không tìm thấy ứng viên")
		}
		if job, err := s.one(ctx, "hr_tin_tuyen", c.Val("tin_id")); err != nil {
			return err
		} else if job != nil {
			if err := x.deptNeed(job.Val("phong_ban")); err != nil {
				return err
			}
		}
		p := omap.Of("cap_nhat", s.nowISO())
		stage := jsval.Str(c.Val("giai_doan"))
		if b.Has("stage") {
			ns := str(b, "stage")
			if !candStages[ns] {
				return apperr.BadRequest("Giai đoạn không hợp lệ")
			}
			if !jsval.IsNullish(c.Val("nhan_vien_id")) && ns != stage {
				return apperr.BadRequest("Ứng viên đã nhận việc - không thể chuyển lại")
			}
			if ns == "hired" && stage != "hired" {
				e, err := s.getEmp(ctx, jsval.ToNumber(b.Val("hiredEmployeeId")))
				if err != nil {
					return err
				}
				if e == nil {
					return apperr.BadRequest("Nhận việc cần hồ sơ nhân sự đã tạo")
				}
				if err := s.hireFree(ctx, e.Val("id"), id); err != nil {
					return err
				}
				p.Set("nhan_vien_id", e.Val("id")).Set("ngay_nhan_viec", s.now().In(vn).Format("2006-01-02"))
			}
			p.Set("giai_doan", ns)
			stage = ns
		}
		if r, ok := b.Val("review").(*omap.Map); ok {
			scores := omap.New()
			if sc, ok := r.Val("scores").(*omap.Map); ok {
				sc.Each(func(k string, v any) { scores.Set(k, numOr0(v)) })
			}
			p.Set("danh_gia", append(orArr(c.Val("danh_gia")), omap.Of("by", jsval.StrOr(str(r, "by"), a.U), "round", str(r, "round"),
				"scores", scores, "note", str(r, "note"), "date", s.now().In(vn).Format("2006-01-02"))))
		}
		if v, ok := b.Val("interview").(*omap.Map); ok {
			d := str(v, "date")
			if !isoDate.MatchString(d) {
				return apperr.BadRequest("Ngày phỏng vấn không hợp lệ")
			}
			iv := omap.Of("date", d)
			for _, k := range []string{"time", "round", "interviewer", "mode", "place"} {
				iv.Set(k, str(v, k))
			}
			p.Set("phong_van", append(orArr(c.Val("phong_van")), iv))
			if stage == "applied" || stage == "screening" {
				p.Set("giai_doan", "interview")
			}
		}
		_, err = s.db.Update(ctx, "hr_ung_vien", database.Eq("id", id), p)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "recruit", "edit", "Ứng viên #"+jsval.NumberToString(id))
	return okRes, nil
}

// CreateOKR: {period, title, owner, krs: [{title, target, unit, owner, inverse}]}; phòng ban lấy theo người phụ trách.
func (s *Service) CreateOKR(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "performance", "create")
	if err != nil {
		return nil, err
	}
	period, title := str(b, "period"), str(b, "title")
	if period == "" || title == "" {
		return nil, apperr.BadRequest("Thiếu kỳ hoặc tên mục tiêu")
	}
	owner, err := s.getEmp(ctx, jsval.ToNumber(b.Val("owner")))
	if err != nil {
		return nil, err
	}
	if owner == nil {
		return nil, apperr.BadRequest("Chọn người phụ trách mục tiêu")
	}
	krs := []any{}
	for i, k := range list(b, "krs") {
		if str(k, "title") == "" {
			continue
		}
		krs = append(krs, omap.Of("id", float64(i+1), "title", str(k, "title"), "target", numOr0(k.Val("target")), "current", 0.0,
			"unit", str(k, "unit"), "owner", numOr0(k.Val("owner")), "inverse", jsval.Truthy(k.Val("inverse"))))
	}
	if len(krs) == 0 || len(krs) > 20 {
		return nil, apperr.BadRequest("Mục tiêu cần 1 đến 20 kết quả then chốt")
	}
	now := s.nowISO()
	out, err := s.db.InsertOne(ctx, "hr_muc_tieu", omap.Of("ky", period, "ten", title, "phu_trach_id", owner.Val("id"), "phong_ban", owner.Val("phong_ban"),
		"ket_qua", krs, "ngay_tao", now, "cap_nhat", now))
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", "create", "Mục tiêu "+period+": "+title)
	return omap.Of("ok", true, "id", out[0].Val("id")), nil
}

// SetKR: cập nhật tiến độ 1 kết quả then chốt {krId, current}.
func (s *Service) SetKR(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "performance", "edit")
	if err != nil {
		return nil, err
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		// khoá dòng trước khi đọc - sửa tài liệu JSON (2 người lưu cùng lúc không làm mất bản của nhau)
		if _, err := s.db.Update(ctx, "hr_muc_tieu", database.Eq("id", id), omap.Of("cap_nhat", s.nowISO())); err != nil {
			return err
		}
		o, err := s.one(ctx, "hr_muc_tieu", id)
		if err != nil {
			return err
		}
		if o == nil {
			return apperr.NotFound("Không tìm thấy mục tiêu")
		}
		// ngoài phạm vi toàn công ty: chỉ cập nhật KR do người trong phạm vi phụ trách (nhân viên: KR của mình)
		if x.scope != "all" {
			for _, k := range orArr(o.Val("ket_qua")) {
				if m, ok := k.(*omap.Map); ok && jsval.ToNumber(m.Val("id")) == jsval.ToNumber(b.Val("krId")) {
					if _, err := s.target(ctx, x, m.Val("owner")); err != nil {
						return err
					}
				}
			}
		}
		cur := jsval.ToNumber(b.Val("current"))
		if cur != cur {
			return apperr.BadRequest("Tiến độ phải là số")
		}
		krs, found := orArr(omap.DeepClone(o.Val("ket_qua"))), false
		for _, x := range krs {
			if m, ok := x.(*omap.Map); ok && jsval.ToNumber(m.Val("id")) == jsval.ToNumber(b.Val("krId")) {
				m.Set("current", cur)
				found = true
			}
		}
		if !found {
			return apperr.NotFound("Không tìm thấy kết quả then chốt")
		}
		_, err = s.db.Update(ctx, "hr_muc_tieu", database.Eq("id", id), omap.Of("ket_qua", krs, "cap_nhat", s.nowISO()))
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", "edit", "Tiến độ KR mục tiêu #"+jsval.NumberToString(id))
	return okRes, nil
}

// ReviewAction: {period, action, ...}. launch {empIds}: mở đợt (người chưa có đánh giá kỳ này -> chờ tự đánh giá);
// self {empId, scores, note}: tự đánh giá (chờ tự đánh giá / chưa bắt đầu -> chờ quản lý); mgr {empId, scores, note}: quản lý chấm (-> hoàn tất).
func (s *Service) ReviewAction(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "performance", "view")
	if err != nil {
		return nil, err
	}
	period, action := str(b, "period"), str(b, "action")
	if period == "" {
		return nil, apperr.BadRequest("Thiếu kỳ đánh giá")
	}
	scoresOf := func() (*omap.Map, error) {
		out := omap.New()
		sc, _ := b.Val("scores").(*omap.Map)
		if sc == nil {
			return nil, apperr.BadRequest("Thiếu điểm đánh giá")
		}
		var bad error
		sc.Each(func(k string, v any) {
			n := jsval.ToNumber(v)
			if n != n || n < 1 || n > 5 {
				bad = apperr.BadRequest("Điểm đánh giá từ 1 đến 5")
			}
			out.Set(k, n)
		})
		return out, bad
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		get := func(eid float64) (*omap.Map, error) {
			rows, err := s.db.Select(ctx, "hr_danh_gia", database.SelectOpt{Filter: database.Eq("nhan_vien_id", eid) + "&" + database.Eq("ky", period), Limit: 1})
			if err != nil || len(rows) == 0 {
				return nil, err
			}
			return rows[0], nil
		}
		switch action {
		case "launch":
			if err := x.need("performance", "create"); err != nil {
				return err
			}
			ids, _ := b.Val("empIds").([]any)
			for _, v := range ids {
				eid := jsval.ToNumber(v)
				if _, err := s.target(ctx, x, eid); err != nil {
					return apperr.BadRequest("Nhân sự " + strconv.FormatFloat(eid, 'f', -1, 64) + ": " + apperr.Message(err))
				}
				if r, err := get(eid); err != nil || r != nil {
					if err != nil {
						return err
					}
					continue
				}
				if _, err := s.db.InsertOne(ctx, "hr_danh_gia", omap.Of("nhan_vien_id", eid, "ky", period, "trang_thai", "self", "cap_nhat", s.nowISO())); err != nil {
					return err
				}
			}
			return nil
		case "self", "mgr":
			eid := jsval.ToNumber(b.Val("empId"))
			if _, err := s.target(ctx, x, eid); err != nil {
				return err
			}
			// tự đánh giá: chỉ chính mình (admin chưa gắn hồ sơ nhập thay được); quản lý chấm: cần quyền duyệt, không tự chấm mình
			if action == "self" && x.role != "sysadmin" && eid != x.meID() {
				return apperr.Forbidden("Chỉ nhân sự tự đánh giá cho mình")
			}
			if action == "mgr" {
				if err := x.need("performance", "approve"); err != nil {
					return err
				}
				if eid == x.meID() {
					return apperr.Forbidden("Không tự chấm đánh giá quản lý cho mình")
				}
			}
			sc, err := scoresOf()
			if err != nil {
				return err
			}
			r, err := get(eid)
			if err != nil {
				return err
			}
			st := "self"
			if r != nil {
				st = jsval.Str(r.Val("trang_thai"))
			}
			p := omap.Of("cap_nhat", s.nowISO())
			if action == "self" {
				if st != "self" {
					return apperr.BadRequest("Đã tự đánh giá kỳ này")
				}
				p.Set("trang_thai", "manager").Set("tu_cham", sc).Set("tu_nhan_xet", str(b, "note"))
			} else {
				if st != "manager" {
					return apperr.BadRequest("Nhân sự chưa tự đánh giá hoặc đã hoàn tất")
				}
				p.Set("trang_thai", "done").Set("ql_cham", sc).Set("ql_nhan_xet", str(b, "note"))
			}
			if r != nil {
				_, err = s.db.Update(ctx, "hr_danh_gia", database.Eq("id", r.Val("id")), p)
			} else {
				_, err = s.db.InsertOne(ctx, "hr_danh_gia", p.Set("nhan_vien_id", eid).Set("ky", period))
			}
			return err
		}
		return apperr.BadRequest("Thao tác không hợp lệ (launch / self / mgr)")
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", map[string]string{"launch": "create", "self": "edit", "mgr": "approve"}[action], "Đánh giá "+period+": "+action)
	return okRes, nil
}

// Enroll: ghi danh / cập nhật tiến độ {empId, courses: {courseId: %}}.
func (s *Service) Enroll(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "performance", "edit")
	if err != nil {
		return nil, err
	}
	eid := jsval.ToNumber(b.Val("empId"))
	e, err := s.target(ctx, x, eid)
	if err != nil {
		return nil, err
	}
	courses, _ := b.Val("courses").(*omap.Map)
	if courses == nil || courses.Len() == 0 || courses.Len() > 200 {
		return nil, apperr.BadRequest("Thiếu khoá học")
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		var ferr error
		courses.Each(func(k string, v any) {
			if ferr != nil {
				return
			}
			cid, err := strconv.Atoi(k)
			pct := jsval.ToNumber(v)
			if err != nil || cid <= 0 || pct != pct || pct < 0 || pct > 100 {
				ferr = apperr.BadRequest("Khoá học / tiến độ không hợp lệ")
				return
			}
			if c, err := s.one(ctx, "hr_khoa_hoc", cid); err != nil || c == nil {
				if err == nil {
					err = apperr.BadRequest("Không tìm thấy khoá học " + k)
				}
				ferr = err
				return
			}
			f := database.Eq("nhan_vien_id", eid) + "&" + database.Eq("khoa_hoc_id", cid)
			cur, err := s.db.Select(ctx, "hr_ghi_danh", database.SelectOpt{Select: "id", Filter: f, Limit: 1})
			if err != nil {
				ferr = err
				return
			}
			p := omap.Of("tien_do_pct", pct, "cap_nhat", s.nowISO())
			if len(cur) > 0 {
				_, ferr = s.db.Update(ctx, "hr_ghi_danh", database.Eq("id", cur[0].Val("id")), p)
			} else {
				_, ferr = s.db.InsertOne(ctx, "hr_ghi_danh", p.Set("nhan_vien_id", eid).Set("khoa_hoc_id", float64(cid)))
			}
		})
		return ferr
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", "edit", "Ghi danh / tiến độ khoá học — "+jsval.Str(e.Val("ho_ten")))
	return okRes, nil
}

// SaveCourse: thêm / sửa khoá học {id?, title, category, hours, format, mandatory, tone} (danh mục cấp công ty).
func (s *Service) SaveCourse(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "performance", "edit")
	if err != nil {
		return nil, err
	}
	title := str(b, "title")
	if title == "" {
		return nil, apperr.BadRequest("Thiếu tên khoá học")
	}
	h := numOr0(b.Val("hours"))
	if h < 0 || h > 10000 {
		return nil, apperr.BadRequest("Số giờ không hợp lệ")
	}
	id, err := s.upsert(ctx, "hr_khoa_hoc", b.Val("id"), omap.Of("ten", title, "nhom", str(b, "category"), "so_gio", h, "hinh_thuc", str(b, "format"),
		"bat_buoc", jsval.Truthy(b.Val("mandatory")), "mau", jsval.StrOr(str(b, "tone"), "primary")), "Không tìm thấy khoá học")
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", "edit", "Khoá học: "+title)
	return omap.Of("ok", true, "id", id), nil
}

// DeleteCourse: xoá khoá học, bỏ khỏi các lộ trình (ghi danh cũ bị bỏ qua khi đọc).
func (s *Service) DeleteCourse(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	x, err := s.gateAll(ctx, a, "performance", "delete")
	if err != nil {
		return nil, err
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		rows, err := s.db.Remove(ctx, "hr_khoa_hoc", database.Eq("id", id))
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return apperr.NotFound("Không tìm thấy khoá học")
		}
		paths, err := s.db.Select(ctx, "hr_lo_trinh", database.SelectOpt{Select: "id,khoa_hoc_ids", Limit: 2000})
		if err != nil {
			return err
		}
		for _, p := range paths {
			ids, changed := []any{}, false
			for _, c := range orArr(p.Val("khoa_hoc_ids")) {
				if jsval.ToNumber(c) == id {
					changed = true
					continue
				}
				ids = append(ids, c)
			}
			if changed {
				if _, err := s.db.Update(ctx, "hr_lo_trinh", database.Eq("id", p.Val("id")), omap.Of("khoa_hoc_ids", ids, "cap_nhat", s.nowISO())); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", "delete", "Xoá khoá học #"+jsval.NumberToString(id))
	return okRes, nil
}

// SavePath: thêm / sửa lộ trình {id?, title, for, courses: [id khoá học]}.
func (s *Service) SavePath(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "performance", "edit")
	if err != nil {
		return nil, err
	}
	title := str(b, "title")
	if title == "" {
		return nil, apperr.BadRequest("Thiếu tên lộ trình")
	}
	arr, _ := b.Val("courses").([]any)
	if len(arr) > 100 {
		return nil, apperr.BadRequest("Lộ trình tối đa 100 khoá học")
	}
	ids := []any{}
	for _, c := range arr {
		cr, err := s.one(ctx, "hr_khoa_hoc", jsval.ToNumber(c))
		if err != nil {
			return nil, err
		}
		if cr == nil {
			return nil, apperr.BadRequest("Không tìm thấy khoá học " + jsval.Str(c))
		}
		ids = append(ids, cr.Val("id"))
	}
	id, err := s.upsert(ctx, "hr_lo_trinh", b.Val("id"), omap.Of("ten", title, "doi_tuong", str(b, "for"), "khoa_hoc_ids", ids), "Không tìm thấy lộ trình")
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "performance", "edit", "Lộ trình: "+title)
	return omap.Of("ok", true, "id", id), nil
}

// DeletePath: xoá lộ trình (ghi danh giữ nguyên).
func (s *Service) DeletePath(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	x, err := s.gateAll(ctx, a, "performance", "delete")
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Remove(ctx, "hr_lo_trinh", database.Eq("id", id))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, apperr.NotFound("Không tìm thấy lộ trình")
	}
	s.audit(ctx, x, "performance", "delete", "Xoá lộ trình #"+jsval.NumberToString(id))
	return okRes, nil
}

// hireFree: 1 hồ sơ nhân sự chỉ gắn với 1 ứng viên.
func (s *Service) hireFree(ctx context.Context, empID any, candID float64) error {
	rows, err := s.db.Select(ctx, "hr_ung_vien", database.SelectOpt{Select: "id", Filter: database.Eq("nhan_vien_id", empID), Limit: 2})
	if err != nil {
		return err
	}
	for _, r := range rows {
		if jsval.ToNumber(r.Val("id")) != candID {
			return apperr.BadRequest("Hồ sơ nhân sự này đã gắn với ứng viên khác")
		}
	}
	return nil
}

// markHired: ứng viên -> Nhận việc, gắn hồ sơ vừa tạo (gọi trong transaction của CreateEmployee).
func (s *Service) markHired(ctx context.Context, x *access, candID float64, empID any) error {
	if err := x.need("recruit", "edit"); err != nil {
		return err
	}
	c, err := s.one(ctx, "hr_ung_vien", candID)
	if err != nil {
		return err
	}
	if c == nil {
		return apperr.BadRequest("Không tìm thấy ứng viên")
	}
	if !jsval.IsNullish(c.Val("nhan_vien_id")) {
		return apperr.BadRequest("Ứng viên đã nhận việc (đã có hồ sơ nhân sự)")
	}
	_, err = s.db.Update(ctx, "hr_ung_vien", database.Eq("id", candID), omap.Of("giai_doan", "hired", "nhan_vien_id", empID,
		"ngay_nhan_viec", s.now().In(vn).Format("2006-01-02"), "cap_nhat", s.nowISO()))
	return err
}

// jdAllowed: sửa / xoá JD ngoài phạm vi toàn công ty chỉ với JD của phòng mình (cả phòng cũ khi sửa).
func (s *Service) jdAllowed(ctx context.Context, x *access, id any, dept string) error {
	if x.scope == "all" {
		return nil
	}
	if validID(id) {
		old, err := s.one(ctx, "hr_jd", id)
		if err != nil {
			return err
		}
		if old != nil {
			if err := x.deptNeed(old.Val("phong_ban")); err != nil {
				return err
			}
			if dept == "" {
				return nil
			}
		}
	}
	return x.deptNeed(dept)
}
