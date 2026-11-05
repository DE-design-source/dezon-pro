package hr

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Chấm công & phép (migration 0025): ca (hr_ca), lịch tuần lặp lại (hr_lich_tuan), chấm công theo ngày (hr_cham_cong),
// đơn từ + luồng duyệt (hr_don_tu). Lệnh ghi trả {ok}; giao diện đọc lại GET /hr/attendance.

var (
	shiftCodeRe = regexp.MustCompile(`^[A-Z0-9]{1,8}$`)
	hmRe        = regexp.MustCompile(`^([01]?\d|2[0-3]):[0-5]\d$`)
	logSources  = map[string]bool{"machine": true, "gps": true, "import": true, "manual": true}
	reqKinds    = map[string]bool{"leave": true, "late": true, "ot": true}
	leaveKinds  = map[string]string{"annual": "Nghỉ phép năm", "sick": "Nghỉ ốm", "unpaid": "Nghỉ không lương", "other": "Nghỉ việc riêng (có lương)"}
)

const maxRangeDays = 400

func hm(v any) any {
	s := jsval.Str(v)
	if jsval.IsNullish(v) || len(s) < 5 {
		return nil
	}
	return s[:5]
}

func pad5(s string) string {
	if len(s) == 4 {
		return "0" + s
	}
	return s
}

func dmy(iso string) string { // yyyy-mm-dd -> dd/mm
	if len(iso) < 10 {
		return iso
	}
	return iso[8:10] + "/" + iso[5:7]
}

func (s *Service) stamp() string { return s.now().In(vn).Format("02/01/2006 · 15:04") }

// AttState: ca, lịch tuần, chấm công trong [from, to], đơn từ (mới nhất trước).
func (s *Service) AttState(ctx context.Context, a *actor.Actor, from, to string) (any, error) {
	x, err := s.gate(ctx, a, "attendance", "view")
	if err != nil {
		return nil, err
	}
	ids, err := s.scopedIDs(ctx, x)
	if err != nil {
		return nil, err
	}
	in := func(id any) bool { return ids == nil || ids[jsval.Str(id)] }
	f, err1 := time.Parse("2006-01-02", from)
	t, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil || t.Before(f) || t.Sub(f) > maxRangeDays*24*time.Hour {
		return nil, apperr.BadRequest("Khoảng ngày không hợp lệ (from, to dạng yyyy-mm-dd, tối đa 400 ngày)")
	}
	shifts, err := s.db.Select(ctx, "hr_ca", database.SelectOpt{Order: "id.asc", Limit: 500})
	if err != nil {
		return nil, err
	}
	codeOf := map[float64]string{}
	sOut := make([]any, len(shifts))
	for i, r := range shifts {
		codeOf[jsval.ToNumber(r.Val("id"))] = jsval.Str(r.Val("ma"))
		sOut[i] = omap.Of("id", r.Val("ma"), "name", r.Val("ten"), "start", hm(r.Val("gio_vao")), "end", hm(r.Val("gio_ra")),
			"breakMin", jsval.ToNumber(r.Val("nghi_phut")), "tone", r.Val("mau"), "note", r.Val("ghi_chu"))
	}
	pats, err := s.db.Select(ctx, "hr_lich_tuan", database.SelectOpt{Limit: 70000})
	if err != nil {
		return nil, err
	}
	sched := map[string][]any{}
	for _, r := range pats {
		k := jsval.Str(r.Val("nhan_vien_id"))
		if !in(k) {
			continue
		}
		if sched[k] == nil {
			sched[k] = []any{"off", "off", "off", "off", "off", "off", "off"}
		}
		if d := int(jsval.ToNumber(r.Val("thu"))); d >= 1 && d <= 7 {
			sched[k][d-1] = codeOf[jsval.ToNumber(r.Val("ca_id"))]
		}
	}
	schedOut := omap.New()
	for k, v := range sched {
		schedOut.Set(k, v)
	}
	logs, err := s.db.Select(ctx, "hr_cham_cong", database.SelectOpt{Filter: "ngay=gte." + from + "&ngay=lte." + to, Order: "ngay.asc", Limit: 100000})
	if err != nil {
		return nil, err
	}
	lOut := []any{}
	for _, r := range logs {
		if !in(r.Val("nhan_vien_id")) {
			continue
		}
		lOut = append(lOut, omap.Of("id", r.Val("id"), "empId", r.Val("nhan_vien_id"), "date", r.Val("ngay"), "in", hm(r.Val("gio_vao")), "out", hm(r.Val("gio_ra")),
			"source", r.Val("nguon"), "gps", jsval.Or(r.Val("gps"), nil), "dist", jsval.Or(r.Val("khoang_cach"), nil), "note", r.Val("ghi_chu")))
	}
	// ponytail: 2000 đơn mới nhất của cả công ty, không lọc theo khoảng ngày; thêm lọc + index khi số đơn lớn
	reqs, err := s.db.Select(ctx, "hr_don_tu", database.SelectOpt{Order: "id.desc", Limit: 2000})
	if err != nil {
		return nil, err
	}
	rOut := []any{}
	for _, r := range reqs {
		if in(r.Val("nhan_vien_id")) {
			rOut = append(rOut, reqOut(r))
		}
	}
	ovs, err := s.db.Select(ctx, "hr_lich_ngay", database.SelectOpt{Filter: "ngay=gte." + from + "&ngay=lte." + to, Limit: 100000})
	if err != nil {
		return nil, err
	}
	ovOut := omap.New()
	for _, r := range ovs {
		k := jsval.Str(r.Val("nhan_vien_id"))
		if !in(k) {
			continue
		}
		m, _ := ovOut.Val(k).(*omap.Map)
		if m == nil {
			m = omap.New()
			ovOut.Set(k, m)
		}
		code := "off"
		if !jsval.IsNullish(r.Val("ca_id")) {
			code = codeOf[jsval.ToNumber(r.Val("ca_id"))]
		}
		m.Set(jsval.Str(r.Val("ngay")), code)
	}
	sites, err := s.db.Select(ctx, "hr_dia_diem", database.SelectOpt{Order: "id.asc", Limit: 500})
	if err != nil {
		return nil, err
	}
	siteOut := make([]any, len(sites))
	for i, r := range sites {
		num := func(v any) any {
			if jsval.IsNullish(v) {
				return nil
			}
			return jsval.ToNumber(v)
		}
		siteOut[i] = omap.Of("name", r.Val("ten"), "lat", num(r.Val("vi_do")), "lng", num(r.Val("kinh_do")), "radius", jsval.ToNumber(r.Val("ban_kinh")),
			"isField", jsval.Truthy(r.Val("cong_truong")))
	}
	// tháng đã chốt công {yyyy-mm: draft|approved|paid} - người không xem được lương vẫn cần biết tháng nào đã khoá
	runs, err := s.db.Select(ctx, "hr_ky_luong", database.SelectOpt{Select: "thang,trang_thai", Filter: "chot_cong=is.true", Limit: 600})
	if err != nil {
		return nil, err
	}
	closed := omap.New()
	for _, r := range runs {
		closed.Set(monthOf(r.Val("thang")), r.Val("trang_thai"))
	}
	return omap.Of("shifts", sOut, "schedule", schedOut, "overrides", ovOut, "logs", lOut, "requests", rOut, "closedMonths", closed, "sites", siteOut), nil
}

func reqOut(r *omap.Map) *omap.Map {
	created := ""
	if t, err := time.Parse(time.RFC3339Nano, jsval.Str(r.Val("ngay_tao"))); err == nil {
		created = t.In(vn).Format("02/01/2006 · 15:04")
	}
	num := func(v any) any {
		if jsval.IsNullish(v) {
			return nil
		}
		return jsval.ToNumber(v)
	}
	return omap.Of("id", r.Val("id"), "empId", r.Val("nhan_vien_id"), "type", r.Val("loai"), "leaveKind", jsval.Or(r.Val("loai_nghi"), nil),
		"title", r.Val("tieu_de"), "from", r.Val("tu_ngay"), "to", r.Val("den_ngay"), "days", num(r.Val("so_ngay")), "hours", num(r.Val("so_gio")),
		"reason", r.Val("ly_do"), "createdAt", created, "steps", orArr(r.Val("cac_buoc")))
}

func orArr(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{}
}

var okRes = omap.Of("ok", true)

// SaveShifts: 1 transaction - thêm / sửa ca (orig = mã cũ khi đổi mã), xoá ca (ô lịch dùng ca đó thành nghỉ),
// rồi ghi đè lịch tuần của các nhân sự có trong schedule {empId: [7 mã ca | "off"]} (T2 -> CN).
func (s *Service) SaveShifts(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "attendance", "edit")
	if err != nil {
		return nil, err
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		for _, st := range list(body, "sites") {
			if err := s.upsertSite(ctx, st); err != nil {
				return err
			}
		}
		for _, n := range strList(body, "deleteSites") {
			if _, err := s.db.Remove(ctx, "hr_dia_diem", database.Eq("ten", n)); err != nil {
				return err
			}
		}
		for _, x := range list(body, "shifts") {
			if err := s.upsertShift(ctx, x); err != nil {
				return err
			}
		}
		for _, c := range strList(body, "deleteShifts") {
			rows, err := s.db.Remove(ctx, "hr_ca", database.Eq("ma", c))
			if err != nil {
				return err
			}
			if len(rows) == 0 {
				return apperr.NotFound("Không tìm thấy ca " + c)
			}
		}
		sched, _ := body.Val("schedule").(*omap.Map)
		if sched != nil && sched.Len() > 0 {
			if err := s.openPatternMonth(ctx); err != nil {
				return err
			}
		}
		overrides := list(body, "overrides")
		if (sched == nil || sched.Len() == 0) && len(overrides) == 0 {
			return nil
		}
		shifts, err := s.db.Select(ctx, "hr_ca", database.SelectOpt{Select: "id,ma", Limit: 500})
		if err != nil {
			return err
		}
		idOf := map[string]any{}
		for _, r := range shifts {
			idOf[jsval.Str(r.Val("ma"))] = r.Val("id")
		}
		var ferr error
		if sched != nil {
			sched.Each(func(k string, v any) {
				if ferr == nil {
					ferr = s.setPattern(ctx, k, v, idOf)
				}
			})
		}
		for _, o := range overrides {
			if ferr == nil {
				ferr = s.setOverride(ctx, o, idOf)
			}
		}
		return ferr
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "attendance", "edit", "Cập nhật ca / lịch làm việc")
	return okRes, nil
}

func (s *Service) upsertShift(ctx context.Context, b *omap.Map) error {
	code := strings.ToUpper(str(b, "id"))
	if !shiftCodeRe.MatchString(code) {
		return apperr.BadRequest("Mã ca chỉ gồm chữ in hoa / số, tối đa 8 ký tự")
	}
	orig := strings.ToUpper(str(b, "orig"))
	if orig == "" {
		orig = code
	}
	name := str(b, "name")
	if name == "" {
		return apperr.BadRequest("Thiếu tên ca")
	}
	start, end := pad5(str(b, "start")), pad5(str(b, "end"))
	if !hmRe.MatchString(start) || !hmRe.MatchString(end) {
		return apperr.BadRequest("Giờ vào / ra phải dạng HH:MM")
	}
	brk := jsval.ToNumber(b.Val("breakMin"))
	if str(b, "breakMin") == "" {
		brk = 0
	}
	if brk != brk || brk < 0 || brk > 600 {
		return apperr.BadRequest("Thời gian nghỉ giữa ca không hợp lệ")
	}
	row := omap.Of("ma", code, "ten", name, "gio_vao", start, "gio_ra", end, "nghi_phut", jsval.Round(brk),
		"mau", jsval.StrOr(str(b, "tone"), "primary"), "ghi_chu", str(b, "note"), "cap_nhat", s.nowISO())
	cur, err := s.db.Select(ctx, "hr_ca", database.SelectOpt{Select: "id", Filter: database.Eq("ma", orig), Limit: 1})
	if err != nil {
		return err
	}
	if len(cur) > 0 {
		_, err = s.db.Update(ctx, "hr_ca", database.Eq("id", cur[0].Val("id")), row)
	} else {
		_, err = s.db.InsertOne(ctx, "hr_ca", row)
	}
	if database.CodeOf(err) == "23505" {
		return apperr.BadRequest("Mã ca đã tồn tại: " + code)
	}
	return err
}

// upsertSite: thêm / sửa địa điểm {orig? (tên cũ khi đổi tên), name, lat?, lng?, radius, isField}.
func (s *Service) upsertSite(ctx context.Context, b *omap.Map) error {
	name := str(b, "name")
	if name == "" {
		return apperr.BadRequest("Thiếu tên địa điểm")
	}
	row := omap.Of("ten", name, "cong_truong", jsval.Truthy(b.Val("isField")), "cap_nhat", s.nowISO())
	if str(b, "lat") == "" && str(b, "lng") == "" {
		row.Set("vi_do", nil).Set("kinh_do", nil)
	} else {
		lat, lng := jsval.ToNumber(b.Val("lat")), jsval.ToNumber(b.Val("lng"))
		if lat != lat || lng != lng || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			return apperr.BadRequest("Toạ độ không hợp lệ (vĩ độ -90..90, kinh độ -180..180)")
		}
		row.Set("vi_do", lat).Set("kinh_do", lng)
	}
	r := jsval.ToNumber(b.Val("radius"))
	if str(b, "radius") == "" {
		r = 200
	}
	if r != r || r < 10 || r > 100000 {
		return apperr.BadRequest("Bán kính chấm công từ 10 m đến 100 km")
	}
	row.Set("ban_kinh", jsval.Round(r))
	orig := jsval.StrOr(str(b, "orig"), name)
	cur, err := s.db.Select(ctx, "hr_dia_diem", database.SelectOpt{Select: "id", Filter: database.Eq("ten", orig), Limit: 1})
	if err != nil {
		return err
	}
	if len(cur) > 0 {
		_, err = s.db.Update(ctx, "hr_dia_diem", database.Eq("id", cur[0].Val("id")), row)
	} else {
		_, err = s.db.InsertOne(ctx, "hr_dia_diem", row)
	}
	if database.CodeOf(err) == "23505" {
		return apperr.BadRequest("Tên địa điểm đã có: " + name)
	}
	if err != nil || orig == name || len(cur) == 0 {
		return err
	}
	// đổi tên: hồ sơ / tin tuyển dụng ghi theo tên cũ đổi theo
	for _, t := range []string{"hr_nhan_vien", "hr_tin_tuyen"} {
		if _, err := s.db.Update(ctx, t, database.Eq("noi_lam_viec", orig), omap.Of("noi_lam_viec", name)); err != nil {
			return err
		}
	}
	return nil
}

// setOverride: lịch riêng 1 ngày {empId, date, shift: mã ca | "off" (nghỉ) | "" (bỏ, về lịch tuần)}.
func (s *Service) setOverride(ctx context.Context, b *omap.Map, idOf map[string]any) error {
	eid := jsval.ToNumber(b.Val("empId"))
	if e, err := s.getEmp(ctx, eid); err != nil || e == nil {
		if err == nil {
			err = apperr.BadRequest("Không tìm thấy nhân sự")
		}
		return err
	}
	date := str(b, "date")
	if !isoDate.MatchString(date) {
		return apperr.BadRequest("Ngày của lịch riêng không hợp lệ")
	}
	if err := s.attClosed(ctx, date); err != nil {
		return err
	}
	f := database.Eq("nhan_vien_id", eid) + "&" + database.Eq("ngay", date)
	if _, err := s.db.Remove(ctx, "hr_lich_ngay", f); err != nil {
		return err
	}
	c := strings.ToUpper(str(b, "shift"))
	if c == "" {
		return nil
	}
	var sid any
	if c != "OFF" {
		id, ok := idOf[c]
		if !ok {
			return apperr.BadRequest("Không tìm thấy ca " + c)
		}
		sid = id
	}
	_, err := s.db.InsertOne(ctx, "hr_lich_ngay", omap.Of("nhan_vien_id", eid, "ngay", date, "ca_id", sid))
	return err
}

func (s *Service) setPattern(ctx context.Context, empKey string, v any, idOf map[string]any) error {
	eid, err := strconv.ParseFloat(empKey, 64)
	if err != nil {
		return apperr.BadRequest("Mã nhân sự không hợp lệ trong lịch: " + empKey)
	}
	if e, err := s.getEmp(ctx, eid); err != nil || e == nil {
		if err == nil {
			err = apperr.BadRequest("Không tìm thấy nhân sự " + empKey)
		}
		return err
	}
	days, ok := v.([]any)
	if !ok || len(days) != 7 {
		return apperr.BadRequest("Lịch tuần phải có đủ 7 ngày")
	}
	rows := []*omap.Map{}
	for i, d := range days {
		c := strings.ToUpper(jsval.Trim(jsval.Str(d)))
		if c == "" || c == "OFF" {
			continue
		}
		id, ok := idOf[c]
		if !ok {
			return apperr.BadRequest("Không tìm thấy ca " + c)
		}
		rows = append(rows, omap.Of("nhan_vien_id", eid, "thu", float64(i+1), "ca_id", id))
	}
	if _, err := s.db.Remove(ctx, "hr_lich_tuan", database.Eq("nhan_vien_id", eid)); err != nil {
		return err
	}
	_, err = s.db.Insert(ctx, "hr_lich_tuan", rows)
	return err
}

// SaveLogs: ghi chấm công {logs: [{empId, date, in?, out?, source, gps?, dist?, note?}]} - 1 dòng / người / ngày,
// chỉ sửa khoá gửi lên (chấm ra không xoá giờ vào). Tối đa 2000 dòng / lần.
func (s *Service) SaveLogs(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "", "")
	if err != nil {
		return nil, err
	}
	logs := list(body, "logs")
	if len(logs) > 2000 {
		return nil, apperr.BadRequest("Tối đa 2000 dòng chấm công mỗi lần")
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		for _, l := range logs {
			if err := s.saveLog(ctx, x, l); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "attendance", "edit", "Ghi "+strconv.Itoa(len(logs))+" dòng chấm công")
	return okRes, nil
}

// saveLog: tự chấm công GPS cho chính mình chỉ cần vào được HR; ghi cho người khác (import, HR bổ sung) cần
// attendance.edit và người đó trong phạm vi.
func (s *Service) saveLog(ctx context.Context, x *access, b *omap.Map) error {
	a := x.a
	eid := jsval.ToNumber(b.Val("empId"))
	selfGPS := str(b, "source") == "gps" && eid == x.meID()
	if !selfGPS {
		if err := x.need("attendance", "edit"); err != nil {
			return err
		}
	}
	if _, err := s.target(ctx, x, eid); err != nil {
		return err
	}
	date := str(b, "date")
	if selfGPS {
		// tự chấm GPS: chỉ hôm nay, ngày giờ theo đồng hồ máy chủ (giờ VN), không tin giờ trình duyệt gửi
		today := s.now().In(vn).Format("2006-01-02")
		if date != "" && date != today {
			return apperr.BadRequest("Chỉ tự chấm công GPS cho hôm nay")
		}
		date = today
	}
	if !isoDate.MatchString(date) {
		return apperr.BadRequest("Ngày chấm công không hợp lệ")
	}
	if err := s.attClosed(ctx, date); err != nil {
		return err
	}
	src := str(b, "source")
	if !logSources[src] {
		return apperr.BadRequest("Nguồn chấm công không hợp lệ")
	}
	p := omap.Of("nguon", src, "nguoi_tao", a.UID, "cap_nhat", s.nowISO())
	f := database.Eq("nhan_vien_id", eid) + "&" + database.Eq("ngay", date)
	cur, err := s.db.Select(ctx, "hr_cham_cong", database.SelectOpt{Select: "id,gio_vao", Filter: f, Limit: 1})
	if err != nil {
		return err
	}
	if selfGPS {
		now := s.now().In(vn).Format("15:04")
		hasIn := len(cur) > 0 && !jsval.IsNullish(cur[0].Val("gio_vao"))
		// đã có giờ vào + gửi out = chấm ra (kể cả khi giao diện gửi kèm in cũ)
		switch {
		case b.Has("in") && !hasIn:
			p.Set("gio_vao", now)
		case b.Has("out") && hasIn:
			p.Set("gio_ra", now)
		case b.Has("in"):
			return apperr.BadRequest("Hôm nay đã có giờ vào")
		default:
			return apperr.BadRequest("Chưa có giờ vào thì chưa chấm ra được")
		}
	}
	for k, col := range map[string]string{"in": "gio_vao", "out": "gio_ra"} {
		if selfGPS || !b.Has(k) { // tự chấm GPS: giờ đã đặt theo máy chủ ở trên
			continue
		}
		t := pad5(str(b, k))
		switch {
		case t == "":
			p.Set(col, nil)
		case hmRe.MatchString(t):
			p.Set(col, t)
		default:
			return apperr.BadRequest("Giờ chấm công phải dạng HH:MM")
		}
	}
	if src == "gps" {
		z := str(b, "gps")
		if z != "in" && z != "out" {
			return apperr.BadRequest("Thiếu kết quả vị trí GPS (in / out)")
		}
		d := jsval.ToNumber(b.Val("dist"))
		if d != d || d < 0 || d > 1e8 {
			return apperr.BadRequest("Khoảng cách GPS không hợp lệ")
		}
		p.Set("gps", z).Set("khoang_cach", jsval.Round(d))
	} else {
		p.Set("gps", nil).Set("khoang_cach", nil)
	}
	if b.Has("note") {
		p.Set("ghi_chu", str(b, "note"))
	}
	if len(cur) > 0 {
		_, err = s.db.Update(ctx, "hr_cham_cong", database.Eq("id", cur[0].Val("id")), p)
	} else {
		_, err = s.db.InsertOne(ctx, "hr_cham_cong", p.Set("nhan_vien_id", eid).Set("ngay", date))
	}
	if database.CodeOf(err) == "23514" {
		return apperr.BadRequest("Chưa có giờ vào thì chưa chấm ra được")
	}
	return err
}

// CreateRequest: tạo đơn {empId, type, leaveKind?, from, to?, days?, hours?, reason}. Luồng duyệt: quản lý trực tiếp
// (nếu có) rồi Nhân sự (trưởng đơn vị hcns nếu có), đơn đi muộn / về sớm chỉ quản lý trực tiếp; bước đầu ở trạng thái active.
func (s *Service) CreateRequest(ctx context.Context, a *actor.Actor, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "attendance", "create")
	if err != nil {
		return nil, err
	}
	emp, err := s.target(ctx, x, jsval.ToNumber(b.Val("empId")))
	if err != nil {
		return nil, err
	}
	kind := str(b, "type")
	if !reqKinds[kind] {
		return nil, apperr.BadRequest("Loại đơn không hợp lệ")
	}
	from, to := str(b, "from"), str(b, "to")
	if to == "" || kind != "leave" {
		to = from
	}
	if !isoDate.MatchString(from) || !isoDate.MatchString(to) || to < from {
		return nil, apperr.BadRequest("Ngày của đơn không hợp lệ")
	}
	if err := s.attClosedRange(ctx, from, to); err != nil {
		return nil, err
	}
	row := omap.Of("nhan_vien_id", emp.Val("id"), "loai", kind, "tu_ngay", from, "den_ngay", to, "ly_do", str(b, "reason"),
		"nguoi_tao", a.UID, "ngay_tao", s.nowISO(), "cap_nhat", s.nowISO())
	span := dmy(from)
	if to != from {
		span += " đến " + dmy(to)
	}
	switch kind {
	case "leave":
		lk := str(b, "leaveKind")
		if leaveKinds[lk] == "" {
			return nil, apperr.BadRequest("Loại nghỉ không hợp lệ")
		}
		d := jsval.ToNumber(b.Val("days"))
		if d != d || d <= 0 || d > 366 || d*2 != float64(int(d*2)) {
			return nil, apperr.BadRequest("Số ngày nghỉ phải > 0, bước 0,5 ngày")
		}
		row.Set("loai_nghi", lk).Set("so_ngay", d).Set("tieu_de", leaveKinds[lk]+" — "+span)
	case "late":
		row.Set("tieu_de", "Đi muộn / về sớm — "+span)
	case "ot":
		h := jsval.ToNumber(b.Val("hours"))
		if h != h || h <= 0 || h > 24 {
			return nil, apperr.BadRequest("Số giờ OT phải từ 0 đến 24")
		}
		row.Set("so_gio", h).Set("tieu_de", "OT — "+span+" ("+jsval.NumberToString(h)+" giờ)")
	}
	// tiêu đề / thời điểm tạo do người gửi ghi (dữ liệu mẫu, nhập lại đơn giấy); thời điểm tạo không sau hiện tại
	if t := str(b, "title"); t != "" && len([]rune(t)) <= 200 {
		row.Set("tieu_de", t)
	}
	if c := str(b, "createdAt"); c != "" {
		t, err := time.Parse(time.RFC3339, c)
		if err != nil || t.After(s.now()) {
			return nil, apperr.BadRequest("Thời điểm tạo đơn không hợp lệ")
		}
		row.Set("ngay_tao", t.UTC().Format(time.RFC3339Nano))
	}
	steps := []any{}
	if m := emp.Val("quan_ly_id"); !jsval.IsNullish(m) {
		if mg, err := s.getEmp(ctx, m); err != nil {
			return nil, err
		} else if mg != nil && jsval.Str(mg.Val("trang_thai")) != "left" {
			steps = append(steps, omap.Of("name", mg.Val("ho_ten"), "role", "Quản lý trực tiếp", "empId", mg.Val("id"), "state", "waiting"))
		}
	}
	hrName := any("Phòng nhân sự")
	if u, err := s.unitByKey(ctx, "hcns"); err != nil {
		return nil, err
	} else if u != nil && !jsval.IsNullish(u.Val("truong_don_vi")) {
		if h, err := s.getEmp(ctx, u.Val("truong_don_vi")); err != nil {
			return nil, err
		} else if h != nil {
			hrName = h.Val("ho_ten")
		}
	}
	// đi muộn / về sớm: chỉ quản lý trực tiếp duyệt (không có quản lý -> Nhân sự)
	if kind != "late" || len(steps) == 0 {
		steps = append(steps, omap.Of("name", hrName, "role", "Nhân sự (HR)", "state", "waiting"))
	}
	steps[0].(*omap.Map).Set("state", "active")
	out, err := s.db.InsertOne(ctx, "hr_don_tu", row.Set("cac_buoc", steps))
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "attendance", "create", jsval.Str(row.Val("tieu_de"))+" — "+jsval.Str(emp.Val("ho_ten")))
	return reqOut(out[0]), nil
}

// DecideRequest: duyệt / từ chối bước đang chờ {approve, note}; từ chối bắt buộc ghi chú. Người duyệt ghi theo tài khoản đăng nhập.
func (s *Service) DecideRequest(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error) {
	x, err := s.gate(ctx, a, "attendance", "approve")
	if err != nil {
		return nil, err
	}
	var out *omap.Map
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		rows, err := s.db.Select(ctx, "hr_don_tu", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1})
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return apperr.NotFound("Không tìm thấy đơn")
		}
		// khoá dòng (2 người duyệt cùng lúc không đè nhau) rồi đọc lại
		if _, err := s.db.Update(ctx, "hr_don_tu", database.Eq("id", id), omap.Of("cap_nhat", s.nowISO())); err != nil {
			return err
		}
		if rows, err = s.db.Select(ctx, "hr_don_tu", database.SelectOpt{Filter: database.Eq("id", id), Limit: 1}); err != nil {
			return err
		}
		if err := s.attClosedRange(ctx, jsval.Str(rows[0].Val("tu_ngay")), jsval.Str(rows[0].Val("den_ngay"))); err != nil {
			return err
		}
		// duyệt đơn của người trong phạm vi, không tự duyệt đơn của mình
		if _, err := s.target(ctx, x, rows[0].Val("nhan_vien_id")); err != nil {
			return err
		}
		if jsval.ToNumber(rows[0].Val("nhan_vien_id")) == x.meID() {
			return apperr.Forbidden("Không tự duyệt đơn của mình")
		}
		approve, note := jsval.Truthy(b.Val("approve")), str(b, "note")
		if !approve && note == "" {
			return apperr.BadRequest("Vui lòng nhập lý do từ chối")
		}
		steps := orArr(omap.DeepClone(rows[0].Val("cac_buoc")))
		cur := -1
		for i, x := range steps {
			if m, ok := x.(*omap.Map); ok && jsval.Str(m.Val("state")) == "active" {
				cur = i
				break
			}
		}
		if cur < 0 {
			return apperr.BadRequest("Đơn đã xử lý xong")
		}
		st := steps[cur].(*omap.Map)
		st.Set("state", map[bool]string{true: "done", false: "rejected"}[approve]).Set("time", s.stamp()).Set("by", a.U)
		if note != "" {
			st.Set("note", note)
		}
		if approve && cur+1 < len(steps) {
			if nx, ok := steps[cur+1].(*omap.Map); ok {
				nx.Set("state", "active")
			}
		}
		up, err := s.db.Update(ctx, "hr_don_tu", database.Eq("id", id), omap.Of("cac_buoc", steps, "cap_nhat", s.nowISO()))
		if err == nil && len(up) > 0 {
			out = reqOut(up[0])
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "attendance", map[bool]string{true: "approve", false: "reject"}[jsval.Truthy(b.Val("approve"))], "Đơn #"+jsval.NumberToString(id))
	return out, nil
}
