package materials

import (
	"context"
	"regexp"
	"strings"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

var (
	reDup      = regexp.MustCompile(`(?i)duplicate|unique`)
	reCamQuyen = regexp.MustCompile(`(?i)42501|row-level security`)
	reThieuTbl = regexp.MustCompile(`(?i)does not exist|schema cache|PGRST205|404`)
)

// tblErr = tblErr_ (S:839-847): lỗi database của 1 bảng -> hướng dẫn đúng nguyên nhân; lỗi khác trả nguyên.
func tblErr(err error, table string) error {
	m := err.Error()
	if !strings.Contains(m, table) {
		return err
	}
	if reCamQuyen.MatchString(m) {
		return apperr.New("Tài khoản database không có quyền ghi bảng " + table + " — kiểm tra quyền của tài khoản trong DATABASE_URL.")
	}
	if reThieuTbl.MatchString(m) {
		return apperr.New("Chưa có bảng " + table + ". " + apperr.HDMig)
	}
	return err
}

// asKeys = Array.isArray(keys) ? keys : [keys].
func asKeys(keys any) []any {
	if arr, ok := keys.([]any); ok {
		return arr
	}
	return []any{keys}
}

func errItem(key any, msg string) *omap.Map { return omap.Of("key", key, "error", msg) }

// SetSpDuyet = setSpDuyet của store (S:668-718): duyệt / bỏ duyệt, chỉ đổi trạng thái + ghi lịch sử.
func (s *Service) SetSpDuyet(ctx context.Context, a *actor.Actor, keys any, approve bool) (*omap.Map, error) {
	who := actorName(a, anDanh)
	now := jsval.NowISO()
	ok, daDung := 0, 0
	errs := []any{}
	type histRow struct{ ma, old, new, ten string }
	var hist []histRow
	// Khoá là MÃ -> duyệt HẾT nhóm biến thể dùng chung mã (tối đa 200 dòng)
	ids := []string{}
	for _, k := range asKeys(keys) {
		raw := jsval.ToString(k)
		kt := jsval.Trim(raw)
		if isDigits(kt) {
			ids = append(ids, kt)
			continue
		}
		rows, err := s.repo.Select(ctx, "db_san_pham", database.SelectOpt{Select: "id", Filter: database.Eq("ma_sp", kt), Order: "id.asc", Limit: 200})
		if err != nil || len(rows) == 0 {
			ids = append(ids, raw)
			continue
		}
		for _, r := range rows {
			ids = append(ids, jsval.ToString(r.Val("id")))
		}
	}
	for _, k := range ids {
		err := func() error {
			cur, err := s.getDbProduct(ctx, jsval.Trim(k))
			if err != nil {
				return err
			}
			if cur == nil { // không qua giới hạn 5 lỗi (S:687)
				errs = append(errs, errItem(k, "Không tìm thấy sản phẩm"))
				return nil
			}
			// Đã đúng trạng thái rồi thì coi như xong
			if (cur.Val("da_duyet") == true) == approve {
				daDung++
				return nil
			}
			if err := s.guardSpChung(ctx, k); err != nil {
				return err
			}
			patch := omap.Of("da_duyet", false, "nguoi_duyet", nil, "ngay_duyet", nil)
			if approve {
				patch = omap.Of("da_duyet", true, "nguoi_duyet", who, "ngay_duyet", now)
			}
			if _, err := s.repo.Update(ctx, "db_san_pham", database.Eq("id", cur.Val("id")), patch); err != nil {
				return apperr.ColErr(err)
			}
			h := histRow{ma: jsval.S(cur.Val("ma_sp")), old: "Đã duyệt", new: "Chưa duyệt", ten: jsval.S(cur.Val("ten_sp"))}
			if approve {
				h.old, h.new = "Chưa duyệt", "Đã duyệt"
			}
			hist = append(hist, h)
			ok++
			return nil
		}()
		if err != nil && len(errs) < 5 {
			errs = append(errs, errItem(k, err.Error()))
		}
	}
	if len(hist) > 0 {
		rows := make([]*omap.Map, len(hist))
		ten := []string{}
		for i, h := range hist {
			rows[i] = omap.Of("ma_sp", h.ma, "field", "TRẠNG THÁI DUYỆT", "old_value", h.old, "new_value", h.new,
				"changed_by", actorUID(a), "changed_by_name", who)
			if i < 8 {
				if h.ma != "" {
					ten = append(ten, h.ma)
				} else {
					ten = append(ten, h.ten)
				}
			}
		}
		if _, err := s.repo.Insert(ctx, "db_san_pham_history", rows); err != nil {
			logger.Error("product history", "duyệt:", err.Error())
		}
		action, dau, duoi := "bo_duyet_sp", "Bỏ duyệt ", ""
		if approve {
			action, dau = "duyet_sp", "Duyệt "
		}
		if len(hist) > 8 {
			duoi = "…"
		}
		s.logAudit(ctx, a, action, dau+jsval.ToString(float64(ok))+" sản phẩm: "+strings.Join(ten, ", ")+duoi)
	}
	s.cacheClear()
	out := omap.Of("ok", float64(ok), "daDung", float64(daDung))
	if len(errs) > 0 {
		out.Set("errors", errs)
	}
	return out, nil
}

// SetSpDuyetGated = setSpDuyet của auth (A:565-569): cần quyền duyệt; approve !== false (thiếu / null = duyệt).
// Chỉ bản Go (M14.6): quyền duyệt theo phân cấp của SpApprovalRights, không theo spPerms_.
func (s *Service) SetSpDuyetGated(ctx context.Context, a *actor.Actor, keys any, approve any) (*omap.Map, error) {
	duyet, _, err := s.SpApprovalRights(ctx, a)
	if err != nil {
		return nil, err
	}
	if !duyet {
		return nil, apperr.New(msgKhongDuyet)
	}
	return s.SetSpDuyet(ctx, a, keys, approve != false)
}

// findSpAny = findSpAny_ (S:754-759): tìm sản phẩm kể cả trong kho chung (không phạm vi công ty, không sắp xếp).
func (s *Service) findSpAny(ctx context.Context, key any) (*omap.Map, error) {
	k := jsval.Trim(jsval.S(key))
	if k == "" {
		return nil, nil
	}
	rows, err := s.repo.Select(ctx, "db_san_pham", database.SelectOpt{Select: "id,ma_sp,ten_sp", Filter: keyFilter(k, k), Limit: 1, NoScope: true})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// SetYeuThich = setYeuThich của store (S:760-797): bật / tắt dấu yêu thích theo TỪNG công ty.
func (s *Service) SetYeuThich(ctx context.Context, a *actor.Actor, keys any, on bool) (*omap.Map, error) {
	who := actorName(a, anDanh)
	ct := tenant.TenantID(ctx)
	// LUÔN kèm điều kiện công ty: super không có ngữ cảnh công ty nên bộ lọc tự động không áp
	locCT := "cong_ty_id=is.null"
	if jsval.Truthy(ct) {
		locCT = database.Eq("cong_ty_id", ct)
	} else {
		ct = nil
	}
	ok := 0
	errs := []any{}
	for _, k := range asKeys(keys) {
		err := func() error {
			cur, err := s.findSpAny(ctx, k)
			if err != nil {
				return err
			}
			if cur == nil {
				errs = append(errs, errItem(k, "Không tìm thấy sản phẩm"))
				return nil
			}
			loc := database.Eq("sp_id", cur.Val("id")) + "&" + locCT
			if on {
				// chặn trùng ở tầng app: chỉ mục duy nhất coi NULL là khác nhau
				daCo, err := s.repo.Select(ctx, "sp_yeu_thich", database.SelectOpt{Select: "id", Filter: loc, Limit: 1, NoScope: true})
				if err == nil && len(daCo) > 0 {
					ok++
					return nil
				}
				if err == nil {
					_, err = s.repo.Insert(ctx, "sp_yeu_thich", []*omap.Map{omap.Of("cong_ty_id", ct, "sp_id", cur.Val("id"),
						"ma_sp", jsval.S(cur.Val("ma_sp")), "nguoi_tao", who)})
				}
				if err != nil {
					if reDup.MatchString(err.Error()) { // đã yêu thích rồi
						ok++
						return nil
					}
					return tblErr(err, "sp_yeu_thich")
				}
			} else if _, err := s.repo.Remove(ctx, "sp_yeu_thich", loc, database.Opt{NoScope: true}); err != nil {
				return tblErr(err, "sp_yeu_thich")
			}
			ok++
			return nil
		}()
		if err != nil && len(errs) < 5 {
			errs = append(errs, errItem(k, err.Error()))
		}
	}
	s.cacheClear()
	out := omap.Of("ok", float64(ok))
	if len(errs) > 0 {
		out.Set("errors", errs)
	}
	return out, nil
}

// SetYeuThichGated = setYeuThich của auth (A:600-602): ai đăng nhập cũng bật / tắt được; on !== false.
func (s *Service) SetYeuThichGated(ctx context.Context, a *actor.Actor, keys any, on any) (*omap.Map, error) {
	return s.SetYeuThich(ctx, a, keys, on != false)
}
