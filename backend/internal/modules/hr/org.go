package hr

import (
	"context"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// SaveOrg: một lần thiết lập cơ cấu tổ chức, chạy trong 1 transaction theo thứ tự:
// units (thêm / sửa theo key, kèm headId) -> employees (sửa từng người: phòng ban, quản lý, lịch sử...) ->
// deleteMembers -> members (thêm / sửa kiêm nhiệm) -> deleteUnits. Sau cùng kiểm cây đơn vị không có vòng và
// tổng kiêm nhiệm của mỗi người <= 90%. Lỗi ở bước nào thì không ghi gì.
func (s *Service) SaveOrg(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	x, err := s.gateAll(ctx, a, "employees", "edit")
	if err != nil {
		return nil, err
	}
	err = s.db.Tx(ctx, func(ctx context.Context) error {
		touchedUnits, touchedEmps := []string{}, map[float64]bool{}
		for _, x := range list(body, "units") {
			k, err := s.upsertUnit(ctx, x)
			if err != nil {
				return err
			}
			touchedUnits = append(touchedUnits, k)
		}
		for _, e := range list(body, "employees") {
			if err := s.patchEmployee(ctx, x, jsval.ToNumber(e.Val("id")), e); err != nil {
				return err
			}
		}
		for _, x := range list(body, "deleteMembers") {
			uid, eid, err := s.memberKeys(ctx, x)
			if err != nil {
				return err
			}
			if _, err := s.db.Remove(ctx, "hr_kiem_nhiem", database.Eq("don_vi_id", uid)+"&"+database.Eq("nhan_vien_id", eid)); err != nil {
				return err
			}
		}
		for _, m := range list(body, "members") {
			if !x.can("payroll", "view") { // phụ cấp kiêm nhiệm là số tiền
				m = m.Clone()
				m.Delete("allowance")
			}
			eid, err := s.upsertMember(ctx, m)
			if err != nil {
				return err
			}
			touchedEmps[eid] = true
		}
		for _, x := range strList(body, "deleteUnits") {
			if err := s.deleteUnit(ctx, x); err != nil {
				return err
			}
		}
		if err := s.checkTree(ctx, touchedUnits); err != nil {
			return err
		}
		for eid := range touchedEmps {
			rows, err := s.db.Select(ctx, "hr_kiem_nhiem", database.SelectOpt{Select: "ty_le_pct", Filter: database.Eq("nhan_vien_id", eid)})
			if err != nil {
				return err
			}
			sum := 0.0
			for _, r := range rows {
				sum += jsval.ToNumber(r.Val("ty_le_pct"))
			}
			if sum > 90 {
				return apperr.BadRequest("Tổng kiêm nhiệm tối đa 90% - phòng ban chính giữ ít nhất 10%")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.audit(ctx, x, "employees", "edit", "Thiết lập cơ cấu tổ chức")
	return s.state(ctx, x)
}

func list(b *omap.Map, k string) []*omap.Map {
	arr, _ := b.Val(k).([]any)
	out := []*omap.Map{}
	for _, x := range arr {
		if m, ok := x.(*omap.Map); ok {
			out = append(out, m)
		}
	}
	return out
}

func strList(b *omap.Map, k string) []string {
	arr, _ := b.Val(k).([]any)
	out := []string{}
	for _, x := range arr {
		out = append(out, jsval.Trim(jsval.Str(x)))
	}
	return out
}

func (s *Service) unitByKey(ctx context.Context, k string) (*omap.Map, error) {
	rows, err := s.db.Select(ctx, "hr_don_vi", database.SelectOpt{Filter: database.Eq("ma", k), Limit: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// upsertUnit: thêm (key chưa có) hoặc sửa (chỉ khoá gửi lên) 1 đơn vị. Không đổi được key.
func (s *Service) upsertUnit(ctx context.Context, b *omap.Map) (string, error) {
	k := str(b, "key")
	if !unitKeyRe.MatchString(k) {
		return "", apperr.BadRequest("Mã đơn vị không hợp lệ: " + k)
	}
	old, err := s.unitByKey(ctx, k)
	if err != nil {
		return "", err
	}
	p := omap.New()
	if b.Has("label") || old == nil {
		l := str(b, "label")
		if l == "" {
			return "", apperr.BadRequest("Thiếu tên đơn vị")
		}
		p.Set("nhan", l)
	}
	if b.Has("type") || old == nil {
		t := str(b, "type")
		if !unitKinds[t] {
			return "", apperr.BadRequest("Loại đơn vị không hợp lệ")
		}
		p.Set("loai", t)
	}
	for f, col := range map[string]string{"name": "ten", "tone": "mau", "desc": "mo_ta"} {
		if b.Has(f) {
			p.Set(col, str(b, f))
		}
	}
	if b.Has("appointedFromParent") {
		p.Set("bo_nhiem_tu_me", jsval.Truthy(b.Val("appointedFromParent")))
	}
	if b.Has("parent") {
		switch par := str(b, "parent"); par {
		case "":
			p.Set("cap_tren", nil).Set("lien_ket", nil)
		case groupHolding:
			p.Set("cap_tren", nil).Set("lien_ket", "holding")
		case groupMother:
			p.Set("cap_tren", nil).Set("lien_ket", "mother")
		default:
			if par == k {
				return "", apperr.BadRequest("Đơn vị không thể trực thuộc chính nó")
			}
			pu, err := s.unitByKey(ctx, par)
			if err != nil {
				return "", err
			}
			if pu == nil {
				return "", apperr.BadRequest("Không tìm thấy đơn vị cấp trên " + par)
			}
			p.Set("cap_tren", par).Set("lien_ket", nil)
		}
	}
	if b.Has("headId") {
		h := b.Val("headId")
		if jsval.IsNullish(h) || jsval.Str(h) == "" {
			p.Set("truong_don_vi", nil)
		} else {
			e, err := s.getEmp(ctx, jsval.ToNumber(h))
			if err != nil {
				return "", err
			}
			if e == nil {
				return "", apperr.BadRequest("Không tìm thấy trưởng đơn vị")
			}
			if jsval.Str(e.Val("trang_thai")) == "left" {
				return "", apperr.BadRequest("Trưởng đơn vị đã nghỉ việc")
			}
			p.Set("truong_don_vi", jsval.ToNumber(h))
		}
	}
	now := s.nowISO()
	p.Set("cap_nhat", now)
	if old == nil {
		_, err = s.db.InsertOne(ctx, "hr_don_vi", p.Set("ma", k).Set("ngay_tao", now))
	} else {
		_, err = s.db.Update(ctx, "hr_don_vi", database.Eq("id", old.Val("id")), p)
	}
	return k, err
}

func (s *Service) deleteUnit(ctx context.Context, k string) error {
	u, err := s.unitByKey(ctx, k)
	if err != nil {
		return err
	}
	if u == nil {
		return apperr.NotFound("Không tìm thấy đơn vị " + k)
	}
	// như giao diện gốc: chỉ đếm người đang làm; hồ sơ đã nghỉ chuyển sang đơn vị cấp trên (khoá ngoại phòng ban)
	emps, err := s.db.Select(ctx, "hr_nhan_vien", database.SelectOpt{Select: "id,trang_thai", Filter: database.Eq("phong_ban", k), Limit: 10000})
	if err != nil {
		return err
	}
	kids, err := s.db.Select(ctx, "hr_don_vi", database.SelectOpt{Select: "id", Filter: database.Eq("cap_tren", k), Limit: 1})
	if err != nil {
		return err
	}
	left := 0
	for _, e := range emps {
		if jsval.Str(e.Val("trang_thai")) == "left" {
			left++
		}
	}
	if len(emps) > left || len(kids) > 0 {
		return apperr.BadRequest("Không thể xoá: " + jsval.Str(u.Val("nhan")) + " còn nhân sự hoặc đơn vị trực thuộc")
	}
	if left > 0 {
		parent := jsval.Str(u.Val("cap_tren"))
		if parent == "" {
			return apperr.BadRequest("Không thể xoá: " + jsval.Str(u.Val("nhan")) + " còn hồ sơ nhân sự đã nghỉ và không có đơn vị cấp trên để chuyển sang")
		}
		if _, err := s.db.Update(ctx, "hr_nhan_vien", database.Eq("phong_ban", k), omap.Of("phong_ban", parent, "cap_nhat", s.nowISO())); err != nil {
			return err
		}
	}
	_, err = s.db.Remove(ctx, "hr_don_vi", database.Eq("id", u.Val("id")))
	return err
}

// checkTree: đi ngược cấp trên từ mỗi đơn vị vừa sửa, gặp lại chính nó = vòng.
func (s *Service) checkTree(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	rows, err := s.db.Select(ctx, "hr_don_vi", database.SelectOpt{Select: "ma,cap_tren", Limit: 5000})
	if err != nil {
		return err
	}
	parent := map[string]string{}
	for _, r := range rows {
		parent[jsval.Str(r.Val("ma"))] = jsval.Str(jsval.Or(r.Val("cap_tren"), ""))
	}
	for _, k := range keys {
		for cur, n := parent[k], 0; cur != "" && n <= len(rows); cur, n = parent[cur], n+1 {
			if cur == k {
				return apperr.BadRequest("Không thể chuyển đơn vị vào bên dưới chính nó")
			}
		}
	}
	return nil
}

// memberKeys: {unit, id} -> (id đơn vị, id nhân sự), cả hai phải thuộc công ty đang làm việc.
func (s *Service) memberKeys(ctx context.Context, b *omap.Map) (any, float64, error) {
	u, err := s.unitByKey(ctx, str(b, "unit"))
	if err != nil {
		return nil, 0, err
	}
	if u == nil {
		return nil, 0, apperr.BadRequest("Không tìm thấy đơn vị " + str(b, "unit"))
	}
	eid := jsval.ToNumber(b.Val("id"))
	e, err := s.getEmp(ctx, eid)
	if err != nil {
		return nil, 0, err
	}
	if e == nil {
		return nil, 0, apperr.BadRequest("Không tìm thấy nhân sự")
	}
	return u.Val("id"), eid, nil
}

func (s *Service) upsertMember(ctx context.Context, b *omap.Map) (float64, error) {
	uid, eid, err := s.memberKeys(ctx, b)
	if err != nil {
		return 0, err
	}
	if e, err := s.getEmp(ctx, eid); err != nil || (e != nil && jsval.Str(e.Val("trang_thai")) == "left") {
		if err == nil {
			err = apperr.BadRequest("Nhân sự đã nghỉ việc, không gán kiêm nhiệm được")
		}
		return 0, err
	}
	p := omap.New()
	if b.Has("pct") {
		v := jsval.ToNumber(b.Val("pct"))
		if v != v || v < 0 || v > 90 {
			return 0, apperr.BadRequest("Tỉ lệ kiêm nhiệm phải từ 0 đến 90%")
		}
		p.Set("ty_le_pct", v)
	}
	if b.Has("allowance") {
		v := jsval.ToNumber(b.Val("allowance"))
		if str(b, "allowance") == "" {
			v = 0
		}
		if v != v || v < 0 || v > 1e15 {
			return 0, apperr.BadRequest("Phụ cấp kiêm nhiệm không hợp lệ")
		}
		p.Set("phu_cap", jsval.Round(v))
	}
	if b.Has("title") {
		p.Set("chuc_vu", str(b, "title"))
	}
	f := database.Eq("don_vi_id", uid) + "&" + database.Eq("nhan_vien_id", eid)
	cur, err := s.db.Select(ctx, "hr_kiem_nhiem", database.SelectOpt{Select: "id", Filter: f, Limit: 1})
	if err != nil {
		return 0, err
	}
	if len(cur) > 0 {
		if p.Len() > 0 {
			_, err = s.db.Update(ctx, "hr_kiem_nhiem", database.Eq("id", cur[0].Val("id")), p)
		}
	} else {
		_, err = s.db.InsertOne(ctx, "hr_kiem_nhiem", p.Set("don_vi_id", uid).Set("nhan_vien_id", eid))
	}
	return eid, err
}
