package projects

import (
	"context"
	"strconv"
	"strings"
	"unicode/utf8"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Yêu cầu sửa thông tin dự án (chỉ bản Go, migration 0019, bảng yeu_cau_sua_du_an = project_edit_requests).
// Trang chi tiết dự án (React) bấm "Sửa thông tin": người duyệt (admin / super / tài khoản có quyền da_duyet) lưu thẳng
// vào du_an; người khác tạo phiếu chờ duyệt, báo cho người duyệt. Duyệt = áp các trường của phiếu vào du_an.
// Ghi chú: updateProject vẫn mở cho mọi tài khoản đăng nhập (Bóc tách / hộp Thông tin dự án dùng) - phiếu này chỉ là
// luồng của trang chi tiết.

const (
	tblYcSua    = "yeu_cau_sua_du_an"
	permDuyetDA = "da_duyet"
	ycLyDoMax   = 500
)

// ycKeys: khoá được yêu cầu sửa = projMap trừ dữ liệu của Bóc tách (nhomTuTao, tangTuTao) và tên bản nháp.
var ycKeys = func() []string {
	out := []string{}
	for _, p := range projMap {
		if p[0] != "nhomTuTao" && p[0] != "tangTuTao" && p[0] != "tenBanNhap" {
			out = append(out, p[0])
		}
	}
	return out
}()

// ycErr: chưa chạy migration 0019 -> báo đúng nguyên nhân; lỗi khác trả nguyên.
func ycErr(err error) error {
	if err == nil {
		return nil
	}
	m := err.Error()
	if (strings.Contains(m, "project_edit_requests") || strings.Contains(m, tblYcSua)) && strings.Contains(m, "does not exist") {
		return apperr.New("Chưa có bảng yêu cầu sửa dự án (migration 0019_project_edit_requests). " + apperr.HDMig)
	}
	return err
}

func (s *Service) needDB() error {
	if s.db == nil {
		return apperr.New("Chưa nối database")
	}
	return nil
}

// tenNguoi: họ tên (hoặc username) của người đang đăng nhập.
func (s *Service) tenNguoi(ctx context.Context, a *actor.Actor) string {
	if s.users != nil {
		if me, err := s.users.GetByID(ctx, a.UID); err == nil && me != nil {
			return jsval.ToString(jsval.Or(me.Val("ho_ten"), me.Val("username")))
		}
	}
	return a.U
}

func (s *Service) coQuyenDuyet(perms any) bool {
	if s.userFmt == nil {
		return false
	}
	for _, p := range s.userFmt.PermsArr(perms) {
		if p == permDuyetDA {
			return true
		}
	}
	return false
}

// CanApproveEdit: admin / super, hoặc tài khoản có quyền da_duyet.
func (s *Service) CanApproveEdit(ctx context.Context, a *actor.Actor) (bool, error) {
	if a == nil {
		return false, nil
	}
	if a.R == "admin" || a.R == "super" {
		return true, nil
	}
	if s.users == nil {
		return false, nil
	}
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return false, err
	}
	return u != nil && s.coQuyenDuyet(u.Val("perms")), nil
}

// ycVal: giá trị client gửi -> giá trị lưu (vat / tienDo là số, còn lại chuỗi đã trim).
func ycVal(k string, v any) any {
	if k == "vat" || k == "tienDo" {
		n := jsval.ToNumber(v)
		if n != n { // NaN
			return float64(0)
		}
		return n
	}
	return jsval.Trim(jsval.ToString(jsval.Or(v, "")))
}

func ycLyDo(v any) (string, error) {
	t, _ := v.(string)
	t = strings.TrimSpace(t)
	if utf8.RuneCountInString(t) > ycLyDoMax {
		return "", apperr.New("Lý do tối đa " + strconv.Itoa(ycLyDoMax) + " ký tự")
	}
	return t, nil
}

// RequestProjectEdit: fields = {khoá client: giá trị mới}; chỉ giữ khoá trong ycKeys và khác giá trị đang có.
// Người duyệt -> sửa thẳng, trả {applied: true, project}; người khác -> phiếu chờ duyệt, trả {pending: true, id}.
func (s *Service) RequestProjectEdit(ctx context.Context, a *actor.Actor, maDA any, fieldsV any, lyDoV any) (*omap.Map, error) {
	if a == nil {
		return nil, apperr.New("Chưa đăng nhập")
	}
	ma := jsval.Trim(jsval.ToString(jsval.Or(maDA, "")))
	if ma == "" {
		return nil, apperr.New("Thiếu mã dự án")
	}
	cur, err := s.GetProject(ctx, ma)
	if err != nil {
		return nil, err
	}
	if cur == nil {
		return nil, apperr.New("Không tìm thấy dự án")
	}
	fields := jsval.AsMap(fieldsV)
	changes, olds := omap.New(), omap.New()
	for _, k := range ycKeys {
		if !fields.Has(k) {
			continue
		}
		nv, ov := ycVal(k, fields.Val(k)), ycVal(k, cur.Val(k))
		if jsval.StrictEquals(nv, ov) {
			continue
		}
		changes.Set(k, nv)
		olds.Set(k, ov)
	}
	if changes.Len() == 0 {
		return nil, apperr.New("Không có thay đổi nào")
	}
	if t, ok := changes.Val("ten").(string); ok && t == "" {
		return nil, apperr.New("Tên dự án không được để trống")
	}
	lyDo, err := ycLyDo(lyDoV)
	if err != nil {
		return nil, err
	}
	duyet, err := s.CanApproveEdit(ctx, a)
	if err != nil {
		return nil, err
	}
	if duyet {
		p, err := s.UpdateProject(ctx, ma, changes)
		if err != nil {
			return nil, err
		}
		return omap.Of("applied", true, "project", p), nil
	}
	if err := s.needDB(); err != nil {
		return nil, err
	}
	who := s.tenNguoi(ctx, a)
	row := omap.Of("ma_du_an", ma, "ten_du_an", jsval.ToString(cur.Val("ten")), "requester_id", a.UID, "requester_name", who,
		"changes", changes, "old_values", olds, "status", "pending")
	if lyDo != "" {
		row.Set("note", lyDo)
	}
	res, err := s.db.InsertOne(ctx, tblYcSua, row)
	if err != nil {
		return nil, ycErr(err)
	}
	var id any
	if len(res) > 0 {
		id = res[0].Val("id")
	}
	s.notifyDuyet(ctx, a, id, who+" yêu cầu sửa "+strconv.Itoa(changes.Len())+" thông tin dự án "+jsval.ToString(cur.Val("ten")), lyDo)
	return omap.Of("pending", true, "id", id), nil
}

// notifyDuyet: báo admin đang hoạt động + tài khoản có quyền da_duyet (trừ chính người gửi). Lỗi chỉ ghi log.
func (s *Service) notifyDuyet(ctx context.Context, a *actor.Actor, id any, body, lyDo string) {
	if s.notifier == nil {
		return
	}
	if lyDo != "" {
		body += ": " + lyDo
	}
	sent := map[string]bool{jsval.ToString(a.UID): true}
	send := func(uid any) {
		k := jsval.ToString(uid)
		if k == "" || sent[k] {
			return
		}
		sent[k] = true
		s.notifier.Notify(ctx, uid, "project_edit_request", "Yêu cầu sửa thông tin dự án", body, id)
	}
	if s.admins != nil {
		if ads, err := s.admins.ActiveAdmins(ctx); err == nil {
			for _, ad := range ads {
				send(jsval.Get(ad, "id"))
			}
		} else {
			logger.Error("dự án", "đọc admin lỗi:", err.Error())
		}
	}
	if s.db != nil {
		us, err := s.db.Select(ctx, "users", database.SelectOpt{Select: "id,perms,active,role"})
		if err != nil {
			logger.Error("dự án", "đọc người duyệt lỗi:", err.Error())
			return
		}
		for _, u := range us {
			if !jsval.StrictEquals(u.Val("active"), false) && s.coQuyenDuyet(u.Val("perms")) {
				send(u.Val("id"))
			}
		}
	}
}

func ycOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "maDA", r.Val("ma_du_an"), "tenDA", r.Val("ten_du_an"), "requester", r.Val("requester_name"),
		"requesterId", r.Val("requester_id"), "changes", jsval.Or(r.Val("changes"), omap.New()), "oldValues", jsval.Or(r.Val("old_values"), omap.New()),
		"status", r.Val("status"), "lyDo", r.Val("note"), "at", r.Val("created_at"), "resolver", r.Val("resolver_name"),
		"resolvedAt", r.Val("resolved_at"), "lyDoTuChoi", r.Val("resolution_note"))
}

// ListProjectEditRequests: {canApprove, items} - 200 phiếu mới nhất (lọc theo mã dự án / trạng thái nếu có).
// Người duyệt thấy mọi phiếu của công ty; người khác chỉ thấy phiếu mình gửi.
func (s *Service) ListProjectEditRequests(ctx context.Context, a *actor.Actor, maDAV any, statusV any) (*omap.Map, error) {
	if a == nil {
		return nil, apperr.New("Chưa đăng nhập")
	}
	if err := s.needDB(); err != nil {
		return nil, err
	}
	duyet, err := s.CanApproveEdit(ctx, a)
	if err != nil {
		return nil, err
	}
	f := []string{}
	if ma := jsval.Trim(jsval.ToString(jsval.Or(maDAV, ""))); ma != "" {
		f = append(f, database.Eq("ma_du_an", ma))
	}
	if st := jsval.Trim(jsval.ToString(jsval.Or(statusV, ""))); st == "pending" || st == "approved" || st == "rejected" {
		f = append(f, database.Eq("status", st))
	}
	if !duyet {
		f = append(f, database.Eq("requester_id", jsval.ToString(a.UID)))
	}
	rows, err := s.db.Select(ctx, tblYcSua, database.SelectOpt{Filter: strings.Join(f, "&"), Order: "created_at.desc", Limit: 200})
	if err != nil {
		return nil, ycErr(err)
	}
	items := make([]any, len(rows))
	for i, r := range rows {
		items[i] = ycOut(r)
	}
	return omap.Of("canApprove", duyet, "items", items), nil
}

// ResolveProjectEditRequest: người duyệt duyệt (áp thay đổi vào du_an) hoặc từ chối (kèm lý do tuỳ chọn).
// Giành quyền xử lý bằng update có điều kiện status = pending (như resolveDeleteRequest); áp thay đổi lỗi thì trả phiếu về pending.
func (s *Service) ResolveProjectEditRequest(ctx context.Context, a *actor.Actor, id any, approve any, lyDoV any) (*omap.Map, error) {
	duyet, err := s.CanApproveEdit(ctx, a)
	if err != nil {
		return nil, err
	}
	if !duyet {
		return nil, apperr.New("Tài khoản không có quyền duyệt sửa dự án")
	}
	if err := s.needDB(); err != nil {
		return nil, err
	}
	rows, err := s.db.Select(ctx, tblYcSua, database.SelectOpt{Filter: database.Eq("id", jsval.ToString(id)), Limit: 1})
	if err != nil {
		return nil, ycErr(err)
	}
	if len(rows) == 0 {
		return nil, apperr.New("Không tìm thấy yêu cầu")
	}
	r := rows[0]
	if r.Val("status") != "pending" {
		return nil, apperr.New("Yêu cầu đã được xử lý")
	}
	lyDo, err := ycLyDo(lyDoV)
	if err != nil {
		return nil, err
	}
	ok := jsval.Truthy(approve)
	status := "rejected"
	if ok {
		status = "approved"
	}
	patch := omap.Of("status", status, "resolver_name", s.tenNguoi(ctx, a), "resolved_at", jsval.NowISO())
	if !ok && lyDo != "" {
		patch.Set("resolution_note", lyDo)
	}
	filt := database.Eq("id", jsval.ToString(id))
	claim, err := s.db.Update(ctx, tblYcSua, filt+"&status=eq.pending", patch)
	if err != nil {
		return nil, ycErr(err)
	}
	if len(claim) == 0 {
		return nil, apperr.New("Yêu cầu đã được xử lý")
	}
	ten := jsval.ToString(r.Val("ten_du_an"))
	if !ok {
		body := "Yêu cầu sửa dự án " + ten + " không được duyệt"
		if lyDo != "" {
			body += ": " + lyDo
		}
		if s.notifier != nil {
			s.notifier.Notify(ctx, r.Val("requester_id"), "project_edit_rejected", "Yêu cầu sửa dự án bị từ chối", body, r.Val("id"))
		}
		return omap.Of("ok", true), nil
	}
	p, err := s.UpdateProject(ctx, r.Val("ma_du_an"), jsval.AsMap(r.Val("changes")))
	if err != nil {
		if _, e2 := s.db.Update(ctx, tblYcSua, filt, omap.Of("status", "pending", "resolver_name", nil, "resolved_at", nil)); e2 != nil {
			logger.Error("dự án", "trả phiếu sửa về chờ duyệt lỗi:", e2.Error())
		}
		return nil, err
	}
	if s.notifier != nil {
		s.notifier.Notify(ctx, r.Val("requester_id"), "project_edit_approved", "Yêu cầu sửa dự án đã được duyệt",
			"Thông tin dự án "+ten+" đã được cập nhật theo yêu cầu của bạn", r.Val("id"))
	}
	return omap.Of("ok", true, "project", p), nil
}
