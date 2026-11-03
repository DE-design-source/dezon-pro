package hr

import (
	"context"
	"regexp"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Lương & bảo hiểm (migration 0022): cấu hình (hr_cau_hinh_luong), thưởng / phạt / doanh số (hr_dieu_chinh_luong),
// kỳ lương (hr_ky_luong), định phí theo đơn vị (hr_dinh_phi). Bảng lương tính ở giao diện (calcPay); khi duyệt, giao diện
// gửi bản chụp phiếu lương để số đã duyệt không đổi theo dữ liệu sửa sau. Lệnh ghi trả {ok}; giao diện đọc lại GET /hr/payroll.

var (
	monthRe  = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
	adjKinds = map[string]bool{"bonus": true, "penalty": true, "sales": true}
)

const (
	maxConfigBytes   = 64 * 1024
	maxPayslipsBytes = 4 * 1024 * 1024
	maxItemsBytes    = 32 * 1024
)

func monthOf(v any) string { // date yyyy-mm-dd -> yyyy-mm
	s := jsval.Str(v)
	if len(s) < 7 {
		return s
	}
	return s[:7]
}

// PayrollState: {config (null = mặc định của giao diện), adjustments {tháng: {empId: [...]}}, runs {tháng: {...}}, fixed {unitKey: {fund, items}}}.
func (s *Service) PayrollState(ctx context.Context, a *actor.Actor) (any, error) {
	x, err := s.gate(ctx, a, "payroll", "view")
	if err != nil {
		return nil, err
	}
	ids, err := s.scopedIDs(ctx, x)
	if err != nil {
		return nil, err
	}
	in := func(id any) bool { return ids == nil || ids[jsval.Str(id)] }
	var cfg any
	rows, err := s.db.Select(ctx, "hr_cau_hinh_luong", database.SelectOpt{Select: "cau_hinh", Limit: 1})
	if err != nil {
		return nil, err
	}
	if len(rows) > 0 {
		cfg = rows[0].Val("cau_hinh")
	}
	// ponytail: đọc mọi điều chỉnh / kỳ lương của công ty; lọc theo khoảng tháng khi dữ liệu nhiều năm
	adjs, err := s.db.Select(ctx, "hr_dieu_chinh_luong", database.SelectOpt{Order: "id.asc", Limit: 50000})
	if err != nil {
		return nil, err
	}
	adjOut := omap.New()
	for _, r := range adjs {
		if !in(r.Val("nhan_vien_id")) {
			continue
		}
		m, _ := adjOut.Val(monthOf(r.Val("thang"))).(*omap.Map)
		if m == nil {
			m = omap.New()
			adjOut.Set(monthOf(r.Val("thang")), m)
		}
		k := jsval.Str(r.Val("nhan_vien_id"))
		l, _ := m.Val(k).([]any)
		m.Set(k, append(l, omap.Of("id", r.Val("id"), "kind", r.Val("loai"), "label", r.Val("noi_dung"), "amount", jsval.ToNumber(r.Val("so_tien")))))
	}
	runs, err := s.db.Select(ctx, "hr_ky_luong", database.SelectOpt{Order: "thang.desc", Limit: 600})
	if err != nil {
		return nil, err
	}
	runOut := omap.New()
	for _, r := range runs {
		var slips any
		if p, ok := r.Val("phieu_luong").(*omap.Map); ok {
			f := omap.New()
			p.Each(func(k string, v any) {
				if in(k) {
					f.Set(k, v)
				}
			})
			slips = f
		}
		runOut.Set(monthOf(r.Val("thang")), omap.Of("status", r.Val("trang_thai"), "closed", jsval.Truthy(r.Val("chot_cong")),
			"payslips", slips, "approvedAt", jsval.Or(r.Val("ngay_duyet"), nil), "paidAt", jsval.Or(r.Val("ngay_chi"), nil)))
	}
	units, err := s.db.Select(ctx, "hr_don_vi", database.SelectOpt{Select: "id,ma", Limit: 2000})
	if err != nil {
		return nil, err
	}
	keyOf := map[float64]string{}
	for _, u := range units {
		keyOf[jsval.ToNumber(u.Val("id"))] = jsval.Str(u.Val("ma"))
	}
	buds, err := s.db.Select(ctx, "hr_dinh_phi", database.SelectOpt{Limit: 2000})
	if err != nil {
		return nil, err
	}
	fixed := omap.New()
	if ids != nil {
		buds = nil // định phí đơn vị chỉ cho phạm vi toàn công ty
	}
	for _, b := range buds {
		fixed.Set(keyOf[jsval.ToNumber(b.Val("don_vi_id"))], omap.Of("fund", jsval.ToNumber(b.Val("quy_luong")), "items", orArr(b.Val("khoan_khac"))))
	}
	return omap.Of("config", cfg, "adjustments", adjOut, "runs", runOut, "fixed", fixed), nil
}

// SavePayrollConfig: ghi đè cấu hình {config: {...}} (tài liệu nguyên khối, tối đa 64 KB).
func (s *Service) SavePayrollConfig(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "payroll", "edit")
	if err != nil {
		return nil, err
	}
	cfg, ok := b.Val("config").(*omap.Map)
	if !ok {
		return nil, apperr.BadRequest("Cấu hình lương phải là object")
	}
	if j, err := omap.Marshal(cfg); err != nil || len(j) > maxConfigBytes {
		return nil, apperr.BadRequest("Cấu hình lương quá lớn")
	}
	row := omap.Of("cau_hinh", cfg, "nguoi_sua", a.UID, "cap_nhat", s.nowISO())
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		cur, err := s.db.Select(ctx, "hr_cau_hinh_luong", database.SelectOpt{Select: "id", Limit: 1})
		if err != nil {
			return err
		}
		if len(cur) > 0 {
			_, err = s.db.Update(ctx, "hr_cau_hinh_luong", database.Eq("id", cur[0].Val("id")), row)
		} else {
			_, err = s.db.InsertOne(ctx, "hr_cau_hinh_luong", row)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "payroll", "edit", "Cập nhật cấu hình công thức lương")
	return okRes, nil
}

func (s *Service) getRun(ctx context.Context, month string) (*omap.Map, error) {
	rows, err := s.db.Select(ctx, "hr_ky_luong", database.SelectOpt{Filter: database.Eq("thang", month+"-01"), Limit: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// adjOpen: điều chỉnh lương chỉ sửa được khi kỳ lương của tháng còn nháp.
func (s *Service) adjOpen(ctx context.Context, month string) error {
	r, err := s.getRun(ctx, month)
	if err != nil {
		return err
	}
	if r != nil && jsval.Str(r.Val("trang_thai")) != "draft" {
		return apperr.BadRequest("Bảng lương tháng " + month + " đã duyệt - mở lại bảng lương trước khi sửa thưởng / phạt")
	}
	return nil
}

// AddAdjustment: {empId, month (yyyy-mm), kind: bonus|penalty|sales, label, amount}.
func (s *Service) AddAdjustment(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "payroll", "edit")
	if err != nil {
		return nil, err
	}
	month, kind, label := str(b, "month"), str(b, "kind"), str(b, "label")
	if !monthRe.MatchString(month) {
		return nil, apperr.BadRequest("Tháng không hợp lệ (yyyy-mm)")
	}
	if !adjKinds[kind] {
		return nil, apperr.BadRequest("Loại điều chỉnh không hợp lệ")
	}
	if label == "" {
		return nil, apperr.BadRequest("Thiếu nội dung")
	}
	amt := jsval.ToNumber(b.Val("amount"))
	if amt != amt || amt <= 0 || amt > 1e15 {
		return nil, apperr.BadRequest("Số tiền phải lớn hơn 0")
	}
	emp, err := s.getEmp(ctx, jsval.ToNumber(b.Val("empId")))
	if err != nil {
		return nil, err
	}
	if emp == nil {
		return nil, apperr.BadRequest("Không tìm thấy nhân sự")
	}
	if err := s.adjOpen(ctx, month); err != nil {
		return nil, err
	}
	if _, err := s.db.InsertOne(ctx, "hr_dieu_chinh_luong", omap.Of("nhan_vien_id", emp.Val("id"), "thang", month+"-01", "loai", kind,
		"noi_dung", label, "so_tien", jsval.Round(amt), "nguoi_tao", a.UID)); err != nil {
		return nil, err
	}
	s.audit(ctx, x, "payroll", "edit", kind+" "+jsval.NumberToString(jsval.Round(amt))+" — "+jsval.Str(emp.Val("ho_ten"))+" ("+month+")")
	return okRes, nil
}

// DeleteAdjustment: xoá 1 điều chỉnh (kỳ lương của tháng phải còn nháp).
func (s *Service) DeleteAdjustment(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	x, err := s.gateAll(ctx, a, "payroll", "edit")
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Select(ctx, "hr_dieu_chinh_luong", database.SelectOpt{Select: "id,thang", Filter: database.Eq("id", id), Limit: 1})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, apperr.NotFound("Không tìm thấy khoản điều chỉnh")
	}
	if err := s.adjOpen(ctx, monthOf(rows[0].Val("thang"))); err != nil {
		return nil, err
	}
	if _, err := s.db.Remove(ctx, "hr_dieu_chinh_luong", database.Eq("id", id)); err != nil {
		return nil, err
	}
	s.audit(ctx, x, "payroll", "delete", "Xoá khoản điều chỉnh lương tháng "+monthOf(rows[0].Val("thang")))
	return okRes, nil
}

// RunAction: {month, action, payslips?}. action: close / open (chốt / mở chốt công, khi còn nháp), approve (nháp -> đã duyệt,
// kèm payslips bản chụp {empId: {emp, att, p}}), pay (đã duyệt -> đã chi trả), reopen (về nháp, bỏ bản chụp).
func (s *Service) RunAction(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "", "")
	if err != nil {
		return nil, err
	}
	month, action := str(b, "month"), str(b, "action")
	if !monthRe.MatchString(month) {
		return nil, apperr.BadRequest("Tháng không hợp lệ (yyyy-mm)")
	}
	// chốt công = duyệt chấm công; duyệt / chi trả = duyệt lương; mở lại = sửa lương; đều cấp công ty
	perm := map[string][2]string{"close": {"attendance", "approve"}, "open": {"attendance", "approve"},
		"approve": {"payroll", "approve"}, "pay": {"payroll", "approve"}, "reopen": {"payroll", "edit"}}[action]
	if perm[0] != "" {
		if err := x.needAll(perm[0], perm[1]); err != nil {
			return nil, err
		}
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		cur, err := s.getRun(ctx, month)
		if err != nil {
			return err
		}
		st := "draft"
		if cur != nil {
			st = jsval.Str(cur.Val("trang_thai"))
		}
		now := s.nowISO()
		p := omap.Of("cap_nhat", now)
		switch action {
		case "close", "open":
			if st != "draft" {
				return apperr.BadRequest("Bảng lương đã duyệt - mở lại bảng lương trước")
			}
			if action == "close" && s.now().In(vn).Format("2006-01-02") < lastDay(month) {
				return apperr.BadRequest("Chỉ chốt công từ ngày cuối tháng " + month + " (chốt sớm sẽ chặn chấm công các ngày còn lại)")
			}
			p.Set("chot_cong", action == "close")
		case "approve":
			if st != "draft" {
				return apperr.BadRequest("Bảng lương tháng " + month + " đã duyệt")
			}
			if s.now().In(vn).Format("2006-01-02") < lastDay(month) {
				return apperr.BadRequest("Chỉ duyệt lương từ ngày cuối tháng " + month + " (duyệt sẽ chốt công cả tháng)")
			}
			slips, ok := b.Val("payslips").(*omap.Map)
			if !ok {
				return apperr.BadRequest("Thiếu bản chụp phiếu lương")
			}
			if j, err := omap.Marshal(slips); err != nil || len(j) > maxPayslipsBytes {
				return apperr.BadRequest("Bản chụp phiếu lương quá lớn")
			}
			p.Set("trang_thai", "approved").Set("phieu_luong", slips).Set("ngay_duyet", now).Set("nguoi_duyet", a.UID).Set("chot_cong", true)
		case "pay":
			if st != "approved" {
				return apperr.BadRequest("Chỉ đánh dấu chi trả được bảng lương đã duyệt")
			}
			p.Set("trang_thai", "paid").Set("ngay_chi", now)
		case "reopen":
			if st == "draft" {
				return apperr.BadRequest("Bảng lương đang là nháp")
			}
			p.Set("trang_thai", "draft").Set("phieu_luong", nil).Set("ngay_duyet", nil).Set("nguoi_duyet", nil).Set("ngay_chi", nil)
		default:
			return apperr.BadRequest("Thao tác không hợp lệ (close / open / approve / pay / reopen)")
		}
		if cur != nil {
			_, err = s.db.Update(ctx, "hr_ky_luong", database.Eq("id", cur.Val("id")), p)
		} else {
			_, err = s.db.InsertOne(ctx, "hr_ky_luong", p.Set("thang", month+"-01"))
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, perm[0], perm[1], "Kỳ lương "+month+": "+action)
	return okRes, nil
}

// attClosed: chấm công của tháng đã chốt thì không ghi được nữa.
func (s *Service) attClosed(ctx context.Context, date string) error {
	r, err := s.getRun(ctx, date[:7])
	if err != nil {
		return err
	}
	if r != nil && jsval.Truthy(r.Val("chot_cong")) {
		return apperr.BadRequest("Đã chốt công tháng " + date[:7] + " - mở chốt công trước khi sửa chấm công")
	}
	return nil
}

// attClosedRange: mọi tháng chạm tới [from, to] phải chưa chốt công (đơn từ, lịch riêng ngày).
func (s *Service) attClosedRange(ctx context.Context, from, to string) error {
	for m := from[:7]; m <= to[:7]; m = nextMonth(m) {
		if err := s.attClosed(ctx, m+"-01"); err != nil {
			return err
		}
	}
	return nil
}

func nextMonth(m string) string {
	t, _ := time.Parse("2006-01", m)
	return t.AddDate(0, 1, 0).Format("2006-01")
}

// lastDay: ngày cuối của tháng yyyy-mm.
func lastDay(m string) string {
	t, _ := time.Parse("2006-01", m)
	return t.AddDate(0, 1, -1).Format("2006-01-02")
}

// openPatternMonth: lịch tuần không có ngày hiệu lực -> đổi lịch làm đổi công chuẩn của tháng đã chốt mà chưa duyệt lương.
// Chặn khi đang có tháng như vậy (duyệt lương thì số đã chụp lại, không đổi nữa).
func (s *Service) openPatternMonth(ctx context.Context) error {
	rows, err := s.db.Select(ctx, "hr_ky_luong", database.SelectOpt{Select: "thang", Filter: "chot_cong=is.true&" + database.Eq("trang_thai", "draft"), Limit: 1})
	if err != nil {
		return err
	}
	if len(rows) > 0 {
		return apperr.BadRequest("Tháng " + monthOf(rows[0].Val("thang")) + " đã chốt công nhưng chưa duyệt lương - duyệt lương hoặc mở chốt trước khi đổi lịch tuần")
	}
	return nil
}

// SaveBudget: định phí của 1 đơn vị {unit, fund?, items?: [{name, amount}]} (chỉ khoá gửi lên).
func (s *Service) SaveBudget(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "payroll", "edit")
	if err != nil {
		return nil, err
	}
	u, err := s.unitByKey(ctx, str(b, "unit"))
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, apperr.BadRequest("Không tìm thấy đơn vị " + str(b, "unit"))
	}
	p := omap.Of("cap_nhat", s.nowISO())
	if b.Has("fund") {
		f := jsval.ToNumber(b.Val("fund"))
		if str(b, "fund") == "" {
			f = 0
		}
		if f != f || f < 0 || f > 1e15 {
			return nil, apperr.BadRequest("Quỹ lương không hợp lệ")
		}
		p.Set("quy_luong", jsval.Round(f))
	}
	if b.Has("items") {
		items := []any{}
		arr, _ := b.Val("items").([]any)
		for _, x := range arr {
			m, ok := x.(*omap.Map)
			if !ok {
				return nil, apperr.BadRequest("Khoản định phí phải là {name, amount}")
			}
			amt := jsval.ToNumber(m.Val("amount"))
			if amt != amt || amt < 0 || amt > 1e15 {
				return nil, apperr.BadRequest("Số tiền định phí không hợp lệ")
			}
			items = append(items, omap.Of("name", str(m, "name"), "amount", jsval.Round(amt)))
		}
		if j, _ := omap.Marshal(items); len(j) > maxItemsBytes {
			return nil, apperr.BadRequest("Quá nhiều khoản định phí")
		}
		p.Set("khoan_khac", items)
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		cur, err := s.db.Select(ctx, "hr_dinh_phi", database.SelectOpt{Select: "id", Filter: database.Eq("don_vi_id", u.Val("id")), Limit: 1})
		if err != nil {
			return err
		}
		if len(cur) > 0 {
			_, err = s.db.Update(ctx, "hr_dinh_phi", database.Eq("id", cur[0].Val("id")), p)
		} else {
			_, err = s.db.InsertOne(ctx, "hr_dinh_phi", p.Set("don_vi_id", u.Val("id")))
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "payroll", "edit", "Định phí đơn vị "+str(b, "unit"))
	return okRes, nil
}
