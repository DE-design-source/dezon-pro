package sales

import (
	"context"
	"regexp"
	"time"

	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Lịch hẹn (khối "Việc tiếp theo") và task (khối "Danh sách Task") của khách hàng. Bảng con kd_lich_hen / kd_nhiem_vu_kh:
// mọi lệnh đọc dòng con trước (tự lọc theo công ty qua dòng cha) rồi đọc lại khách hàng cha, không thấy -> 404.

var (
	hhmm         = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
	apptStatuses = set("planned", "done", "cancelled")
	taskSources  = set("", "ai")
)

const (
	maxMembers = 30
	maxPrep    = 50
	maxTaskBy  = 20
	maxText    = 2000
)

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// boolOf: m[k] chỉ nhận true / false của JSON (thiếu = false); "1", 1, "true"... -> 400.
func boolOf(m *omap.Map, k string) (bool, error) {
	v, ok := m.Get(k)
	if !ok {
		return false, nil
	}
	b, ok := v.(bool)
	if !ok {
		return false, apperr.BadRequest("Giá trị " + k + " chỉ nhận true / false")
	}
	return b, nil
}

// apptFields: đọc + kiểm các khoá lịch hẹn có trong body -> patch theo tên cột trong code.
func apptFields(b *omap.Map) (*omap.Map, error) {
	p := omap.New()
	if b.Has("date") {
		d := str(b, "date")
		if !isDay(d) {
			return nil, apperr.BadRequest("Ngày hẹn không hợp lệ")
		}
		p.Set("ngay", d)
	}
	for k, col := range map[string]string{"start": "gio_bat_dau", "end": "gio_ket_thuc"} {
		if b.Has(k) {
			t := str(b, k)
			if t != "" && !hhmm.MatchString(t) {
				return nil, apperr.BadRequest("Giờ hẹn không hợp lệ (HH:MM)")
			}
			p.Set(col, t)
		}
	}
	if b.Has("title") {
		t := str(b, "title")
		if t == "" {
			return nil, apperr.BadRequest("Thiếu tiêu đề lịch hẹn")
		}
		p.Set("tieu_de", clip(t, 300))
	}
	for k, col := range map[string]string{"mode": "hinh_thuc", "place": "dia_diem", "goal": "muc_tieu"} {
		if b.Has(k) {
			p.Set(col, clip(str(b, k), maxText))
		}
	}
	if b.Has("members") {
		list := []any{}
		arr, ok := b.Val("members").([]any)
		if !ok {
			return nil, apperr.BadRequest("Danh sách người tham gia (members) phải là mảng")
		}
		for _, x := range arr {
			if n := jsval.Trim(jsval.Str(x)); n != "" && len(list) < maxMembers {
				list = append(list, clip(n, 200))
			}
		}
		p.Set("thanh_vien", list)
	}
	if b.Has("prep") {
		list := []any{}
		arr, ok := b.Val("prep").([]any)
		if !ok {
			return nil, apperr.BadRequest("Danh sách chuẩn bị (prep) phải là mảng")
		}
		for _, x := range arr {
			m, ok := x.(*omap.Map)
			if !ok || str(m, "text") == "" || len(list) >= maxPrep {
				continue
			}
			done, err := boolOf(m, "done")
			if err != nil {
				return nil, err
			}
			list = append(list, omap.Of("text", clip(str(m, "text"), 500), "done", done))
		}
		p.Set("chuan_bi", list)
	}
	if b.Has("status") {
		st := str(b, "status")
		if !apptStatuses[st] {
			return nil, apperr.BadRequest("Trạng thái lịch hẹn không hợp lệ")
		}
		p.Set("trang_thai", st)
	}
	return p, nil
}

// checkApptTimes: giờ kết thúc phải sau giờ bắt đầu (khi có cả hai).
func checkApptTimes(start, end string) error {
	if start != "" && end != "" && end <= start {
		return apperr.BadRequest("Giờ kết thúc phải sau giờ bắt đầu")
	}
	return nil
}

func apptOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "date", r.Val("ngay"), "start", jsval.Str(r.Val("gio_bat_dau")), "end", jsval.Str(r.Val("gio_ket_thuc")),
		"title", r.Val("tieu_de"), "mode", jsval.Str(r.Val("hinh_thuc")), "place", jsval.Str(r.Val("dia_diem")), "goal", jsval.Str(r.Val("muc_tieu")),
		"members", orArr(r.Val("thanh_vien")), "prep", orArr(r.Val("chuan_bi")), "status", r.Val("trang_thai"),
		"by", jsval.Str(r.Val("nguoi_viet")), "createdAt", r.Val("ngay_tao"))
}

// ListAppointments: lịch hẹn của khách, theo ngày / giờ tăng dần.
func (s *Service) ListAppointments(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.leadOr404(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListAppointments(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = apptOut(r)
	}
	return omap.Of("appointments", out), nil
}

// AddAppointment: thêm lịch hẹn (date, title bắt buộc; status mặc định planned).
func (s *Service) AddAppointment(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.leadOr404(ctx, id); err != nil {
		return nil, err
	}
	if !body.Has("date") {
		return nil, apperr.BadRequest("Ngày hẹn không hợp lệ")
	}
	if !body.Has("title") {
		return nil, apperr.BadRequest("Thiếu tiêu đề lịch hẹn")
	}
	row, err := apptFields(body)
	if err != nil {
		return nil, err
	}
	if err := checkApptTimes(jsval.Str(row.Val("gio_bat_dau")), jsval.Str(row.Val("gio_ket_thuc"))); err != nil {
		return nil, err
	}
	if !row.Has("trang_thai") {
		row.Set("trang_thai", "planned")
	}
	by := str(body, "by")
	if by == "" {
		by = s.displayName(ctx, a)
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	row.Set("khach_hang_id", id).Set("nguoi_viet", clip(by, 200)).Set("nguoi_tao", a.UID).Set("ngay_tao", now).Set("cap_nhat", now)
	out, err := s.repo.InsertAppointment(ctx, row)
	if err != nil {
		return nil, err
	}
	return apptOut(out), nil
}

// apptOr404: lịch hẹn + khách hàng cha thuộc công ty đang làm việc.
func (s *Service) apptOr404(ctx context.Context, apptID float64) (*omap.Map, error) {
	r, err := s.repo.GetAppointment(ctx, apptID)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, apperr.NotFound("Không tìm thấy lịch hẹn")
	}
	if _, err := s.leadOr404(ctx, r.Val("khach_hang_id")); err != nil {
		return nil, err
	}
	return r, nil
}

// UpdateAppointment: sửa một phần (dời lịch, tick chuẩn bị, đánh dấu xong / huỷ...).
func (s *Service) UpdateAppointment(ctx context.Context, a *actor.Actor, apptID float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	old, err := s.apptOr404(ctx, apptID)
	if err != nil {
		return nil, err
	}
	patch, err := apptFields(body)
	if err != nil {
		return nil, err
	}
	start, end := jsval.Str(old.Val("gio_bat_dau")), jsval.Str(old.Val("gio_ket_thuc"))
	if v, ok := patch.Get("gio_bat_dau"); ok {
		start = jsval.Str(v)
	}
	if v, ok := patch.Get("gio_ket_thuc"); ok {
		end = jsval.Str(v)
	}
	if err := checkApptTimes(start, end); err != nil {
		return nil, err
	}
	patch.Set("cap_nhat", s.now().UTC().Format(time.RFC3339Nano))
	out, err := s.repo.UpdateAppointment(ctx, apptID, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy lịch hẹn")
	}
	return apptOut(out), nil
}

// DeleteAppointment: xoá lịch hẹn.
func (s *Service) DeleteAppointment(ctx context.Context, a *actor.Actor, apptID float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.apptOr404(ctx, apptID); err != nil {
		return nil, err
	}
	n, err := s.repo.DeleteAppointment(ctx, apptID)
	if err == nil && n == 0 {
		err = apperr.NotFound("Không tìm thấy lịch hẹn")
	}
	if err != nil {
		return nil, err
	}
	return omap.Of("ok", true), nil
}

// ---- Task ----

// taskFields: đọc + kiểm các khoá task có trong body; done đổi -> ngày xong = bây giờ / null.
func taskFields(b *omap.Map, now string) (*omap.Map, error) {
	p := omap.New()
	if b.Has("title") {
		t := str(b, "title")
		if t == "" {
			return nil, apperr.BadRequest("Thiếu tên task")
		}
		p.Set("tieu_de", clip(t, 500))
	}
	if b.Has("dueDate") {
		d := str(b, "dueDate")
		switch {
		case d == "":
			p.Set("han", nil)
		case isDay(d):
			p.Set("han", d)
		default:
			return nil, apperr.BadRequest("Hạn task không hợp lệ")
		}
	}
	if b.Has("assignees") {
		list := []any{}
		arr, ok := b.Val("assignees").([]any)
		if !ok {
			return nil, apperr.BadRequest("Danh sách người làm (assignees) phải là mảng")
		}
		for _, x := range arr {
			m, ok := x.(*omap.Map)
			if !ok || str(m, "name") == "" || len(list) >= maxTaskBy {
				continue
			}
			list = append(list, omap.Of("name", clip(str(m, "name"), 200), "username", clip(str(m, "username"), 200)))
		}
		p.Set("phu_trach", list)
	}
	if b.Has("note") {
		p.Set("ghi_chu", clip(str(b, "note"), maxText))
	}
	if b.Has("done") {
		done, err := boolOf(b, "done")
		if err != nil {
			return nil, err
		}
		p.Set("xong", done)
		if done {
			p.Set("ngay_xong", now)
		} else {
			p.Set("ngay_xong", nil)
		}
	}
	if b.Has("source") {
		src := str(b, "source")
		if !taskSources[src] {
			return nil, apperr.BadRequest("Nguồn task không hợp lệ")
		}
		p.Set("nguon", src)
	}
	return p, nil
}

func taskOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "title", r.Val("tieu_de"), "dueDate", jsval.Or(r.Val("han"), ""), "assignees", orArr(r.Val("phu_trach")),
		"note", jsval.Str(r.Val("ghi_chu")), "done", jsval.Truthy(r.Val("xong")), "doneAt", jsval.Or(r.Val("ngay_xong"), nil),
		"source", jsval.Str(r.Val("nguon")), "by", jsval.Str(r.Val("nguoi_viet")), "createdAt", r.Val("ngay_tao"))
}

// ListTasks: task của khách - chưa xong trước, theo hạn (không hạn cuối).
func (s *Service) ListTasks(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.leadOr404(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListTasks(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = taskOut(r)
	}
	return omap.Of("tasks", out), nil
}

// AddTask: thêm task (title bắt buộc; source 'ai' = tạo từ gợi ý của khối Phân tích AI).
func (s *Service) AddTask(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.leadOr404(ctx, id); err != nil {
		return nil, err
	}
	if !body.Has("title") {
		return nil, apperr.BadRequest("Thiếu tên task")
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	row, err := taskFields(body, now)
	if err != nil {
		return nil, err
	}
	by := str(body, "by")
	if by == "" {
		by = s.displayName(ctx, a)
	}
	row.Set("khach_hang_id", id).Set("nguoi_viet", clip(by, 200)).Set("nguoi_tao", a.UID).Set("ngay_tao", now).Set("cap_nhat", now)
	out, err := s.repo.InsertTask(ctx, row)
	if err != nil {
		return nil, err
	}
	return taskOut(out), nil
}

// taskOr404: task + khách hàng cha thuộc công ty đang làm việc.
func (s *Service) taskOr404(ctx context.Context, taskID float64) (*omap.Map, error) {
	r, err := s.repo.GetTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, apperr.NotFound("Không tìm thấy task")
	}
	if _, err := s.leadOr404(ctx, r.Val("khach_hang_id")); err != nil {
		return nil, err
	}
	return r, nil
}

// UpdateTask: sửa một phần (tick xong, đổi hạn, người làm...). Gửi done trùng giá trị cũ thì giữ ngày xong cũ.
func (s *Service) UpdateTask(ctx context.Context, a *actor.Actor, taskID float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	old, err := s.taskOr404(ctx, taskID)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	patch, err := taskFields(body, now)
	if err != nil {
		return nil, err
	}
	if v, ok := patch.Get("xong"); ok && jsval.Truthy(v) == jsval.Truthy(old.Val("xong")) {
		patch.Delete("ngay_xong")
	}
	patch.Set("cap_nhat", now)
	out, err := s.repo.UpdateTask(ctx, taskID, patch)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, apperr.NotFound("Không tìm thấy task")
	}
	return taskOut(out), nil
}

// DeleteTask: xoá task.
func (s *Service) DeleteTask(ctx context.Context, a *actor.Actor, taskID float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.taskOr404(ctx, taskID); err != nil {
		return nil, err
	}
	n, err := s.repo.DeleteTask(ctx, taskID)
	if err == nil && n == 0 {
		err = apperr.NotFound("Không tìm thấy task")
	}
	if err != nil {
		return nil, err
	}
	return omap.Of("ok", true), nil
}
