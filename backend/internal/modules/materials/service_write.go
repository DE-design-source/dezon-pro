package materials

import (
	"context"
	"regexp"
	"strings"

	"qspro-backend/internal/modules/categories"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
	"qspro-backend/internal/shared/specs"
)

var (
	reWhoCol    = regexp.MustCompile(`(nguoi_tao|ngay_tao|nguoi_sua)`)
	reColSchema = regexp.MustCompile(`(?i)(column|schema cache|PGRST204)`)
	reFilterEsc = regexp.MustCompile(`["\\]`)
)

// whoColMissingErr = whoColMissing_ (S:489-492).
func whoColMissingErr(err error) bool {
	m := err.Error()
	return reWhoCol.MatchString(m) && reColSchema.MatchString(m)
}

// laCo = /^(có|yes|true|1|x)$/i.test(s). Cờ i của JS (không cờ u) chỉ gộp hoa / thường từng ký tự;
// (?i) của Go còn gộp thêm ſ với s nên so tay.
func laCo(s string) bool {
	switch len(s) {
	case 1:
		return s == "1" || s == "x" || s == "X"
	case 3:
		return (s[0] == 'c' || s[0] == 'C') && (s[1:] == "ó" || s[1:] == "Ó") || asciiFold(s, "yes")
	case 4:
		return asciiFold(s, "true")
	}
	return false
}

func asciiFold(s, lower string) bool {
	if len(s) != len(lower) {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		if c != lower[i] {
			return false
		}
	}
	return true
}

func rong(v any) bool { return jsval.IsNullish(v) || v == "" } // v == null || v === ''

// spHistory = spHistory_ (S:494-502): ghi lịch sử sản phẩm, nuốt lỗi.
func (s *Service) spHistory(ctx context.Context, a *actor.Actor, ma string, changes []change) {
	if len(changes) == 0 {
		return
	}
	rows := make([]*omap.Map, len(changes))
	for i, c := range changes {
		rows[i] = omap.Of("ma_sp", ma, "field", c.field, "old_value", c.old, "new_value", c.new,
			"changed_by", actorUID(a), "changed_by_name", actorName(a, anDanh))
	}
	if _, err := s.repo.Insert(ctx, "db_san_pham_history", rows); err != nil {
		logger.Error("product history", err.Error())
	}
}

// SaveDbProduct = saveDbProduct (S:503-560): tạo hoặc cập nhật sản phẩm theo MÃ + các trục biến thể.
// Bước hoán đổi tham số saveDbProduct(data) (S:506) không tới được qua cổng rpc (actor luôn có uid).
func (s *Service) SaveDbProduct(ctx context.Context, a *actor.Actor, data *omap.Map, opts *omap.Map) (*omap.Map, error) {
	who := actorName(a, "")
	ten := jsval.Trim(jsval.S(data.Val(nhanTen)))
	if ten == "" {
		return nil, apperr.New("Chưa có Tên sản phẩm.")
	}
	row := omap.New()
	data.Each(func(label string, v any) {
		col := categories.ColOf(label)
		if col == "" || rong(v) {
			return
		}
		if label == nhanLapRoi {
			v = laCo(jsval.ToString(v))
		} else if dbNum[label] {
			v = qscore.N(v)
		}
		row.Set(col, v)
	})
	if !jsval.Truthy(row.Val("nganh")) {
		if ng0 := categories.NganhCua("", row.Val("hang_muc")); ng0 != "den" {
			row.Set("nganh", ng0)
		}
	}
	// Điện lạnh (chỉ bản Go, theo QS Pro): hạng mục ghi chung -> hạng mục con đoán theo tên SP
	if row.Val("nganh") == "dl" && jsval.Truthy(row.Val("hang_muc")) {
		row.Set("hang_muc", specs.DLDoanHM(row.Val("hang_muc"), ten))
	}
	ma := jsval.Trim(jsval.S(data.Val(nhanMa)))
	// Khoá trùng = MÃ SP + các trục BIẾN THỂ: cùng mã nhưng khác nhiệt độ màu là 2 sản phẩm riêng.
	if ma != "" {
		keyCols := []string{"nhiet_do_mau_k", "cong_suat_w", "goc_chieu_deg", "mau_sac"}
		if ng := row.Val("nganh"); ng == "vs" || ng == "son" || jsval.Truthy(row.Val("kich_thuoc")) {
			keyCols = append(keyCols, "kich_thuoc")
		}
		conds := make([]string, len(keyCols))
		for i, col := range keyCols {
			// '' và null coi là một (khớp unique index coalesce(col, ''))
			if v := row.Val(col); rong(v) {
				conds[i] = "or(" + col + ".is.null," + col + ".eq.)"
			} else {
				conds[i] = col + ".eq." + jsval.EncodeURIComponent(`"`+reFilterEsc.ReplaceAllString(jsval.ToString(v), `\$0`)+`"`)
			}
		}
		filter := database.Eq("ma_sp", ma) + "&and=(" + strings.Join(conds, ",") + ")"
		ex, err := s.repo.Select(ctx, "db_san_pham", database.SelectOpt{Select: "id,da_duyet", Filter: filter, Limit: 1})
		if err != nil {
			return nil, err
		}
		if len(ex) > 0 {
			// nội dung sản phẩm đã duyệt bị đổi qua đường này cũng phải duyệt lại
			if ex[0].Val("da_duyet") == true {
				row.Set("da_duyet", false).Set("nguoi_duyet", nil).Set("ngay_duyet", nil)
			}
			if who != "" && !s.whoColMissing.Load() {
				row.Set("nguoi_sua", who).Set("ngay_cap_nhat", jsval.NowISO())
			}
			idEq := database.Eq("id", ex[0].Val("id"))
			if _, err := s.repo.Update(ctx, "db_san_pham", idEq, row); err != nil {
				if !whoColMissingErr(err) {
					return nil, apperr.ColErr(err)
				}
				// nhánh này chỉ bỏ nguoi_sua và KHÔNG đặt cờ thiếu cột (S:541)
				row.Delete("nguoi_sua")
				if _, err := s.repo.Update(ctx, "db_san_pham", idEq, row); err != nil {
					return nil, err
				}
			}
			s.cacheClear()
			s.spHistory(ctx, a, ma, []change{{"CẬP NHẬT (nhập liệu)", "", ten}})
			if !jsval.Truthy(opts.Val("noAudit")) {
				s.logAudit(ctx, a, "cap_nhat_sp", "Cập nhật SP "+ma+" ("+ten+") qua form Nhập dữ liệu")
			}
			return omap.Of("updated", true, "ma", ma, "ten", ten, "id", ex[0].Val("id")), nil
		}
	}
	// mặc định chỉ áp khi TẠO MỚI
	if macDinh := jsval.AsMap(opts.Val("macDinh")); macDinh != nil {
		macDinh.Each(func(c string, v any) {
			if rong(row.Val(c)) {
				row.Set(c, v)
			}
		})
	}
	if who != "" && !s.whoColMissing.Load() {
		row.Set("nguoi_tao", who).Set("ngay_tao", jsval.NowISO())
	}
	res, err := s.repo.InsertOne(ctx, "db_san_pham", row)
	if err != nil {
		if !whoColMissingErr(err) {
			return nil, apperr.ColErr(err)
		}
		row.Delete("nguoi_tao")
		row.Delete("ngay_tao")
		s.whoColMissing.Store(true)
		if res, err = s.repo.InsertOne(ctx, "db_san_pham", row); err != nil {
			return nil, err
		}
	}
	s.cacheClear()
	maLS, moi := ma, ten
	if maLS == "" {
		maLS = ten
	}
	if who != "" {
		moi += " (bởi " + who + ")"
	}
	s.spHistory(ctx, a, maLS, []change{{"TẠO SẢN PHẨM", "", moi}})
	if !jsval.Truthy(opts.Val("noAudit")) {
		s.logAudit(ctx, a, "them_sp", "Thêm SP mới "+ma+" ("+ten+")")
	}
	var id any = jsval.Undefined
	if len(res) > 0 && res[0] != nil {
		id = res[0].Val("id")
	}
	return omap.Of("created", true, "ma", ma, "ten", ten, "id", id), nil
}

// DeleteDbProduct = deleteDbProduct (S:561-585): xoá ĐÚNG một dòng + liên kết + lịch sử + audit.
// D-13: xoá sản phẩm + dọn liên kết chạy trong 1 transaction. Schema hiện có ON DELETE CASCADE (products ->
// product_combos x2, favorite_products) nên lệnh xoá đã tự dọn liên kết; 3 lệnh dọn giữ như Node, phòng DB thiếu FK.
// Transaction chỉ còn tác dụng khi sập giữa chừng (panic) với DB thiếu FK. Lệnh dọn vẫn nuốt lỗi như Node
// (savepoint từng lệnh, không làm hỏng transaction).
// cacheClear dời ra SAU commit (trước đây chạy ngay sau lệnh xoá); lịch sử + audit sau commit như cũ.
func (s *Service) DeleteDbProduct(ctx context.Context, a *actor.Actor, key any) (*omap.Map, error) {
	// guardSpChung_ chạy TRƯỚC khi cắt khoảng trắng / kiểm tra rỗng (S:564-565)
	if err := s.guardSpChung(ctx, key); err != nil {
		return nil, err
	}
	k := jsval.Trim(jsval.S(key))
	if k == "" {
		return nil, apperr.New("Thiếu mã/ID sản phẩm.")
	}
	cur, err := s.getDbProduct(ctx, k)
	if err != nil {
		return nil, err
	}
	if cur == nil {
		return nil, apperr.New("Không tìm thấy sản phẩm để xoá.")
	}
	id := cur.Val("id")
	err = s.tx(ctx, func(ctx context.Context) error {
		if _, err := s.repo.Remove(ctx, "db_san_pham", database.Eq("id", id)); err != nil {
			return err
		}
		// Dọn liên kết trỏ tới sản phẩm vừa xoá; lỗi (bảng chưa có) bỏ qua như Node
		_, _ = s.repo.Remove(ctx, "sp_combo", database.Eq("sp_id", id))
		_, _ = s.repo.Remove(ctx, "sp_combo", database.Eq("sp_kem_id", id))
		_, _ = s.repo.Remove(ctx, "sp_yeu_thich", database.Eq("sp_id", id))
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.cacheClear()
	ma, ten := jsval.S(cur.Val("ma_sp")), jsval.S(cur.Val("ten_sp"))
	if _, err := s.repo.InsertOne(ctx, "db_san_pham_history", omap.Of("ma_sp", ma, "field", "XOÁ SẢN PHẨM",
		"old_value", ten, "new_value", "", "changed_by", actorUID(a), "changed_by_name", actorName(a, anDanh))); err != nil {
		logger.Error("product history", "xoá:", err.Error())
	}
	s.logAudit(ctx, a, "xoa_sp", "Xoá SP "+ma+" ("+ten+")")
	return omap.Of("ok", true, "ma", ma, "ten", ten), nil
}

// getDbProduct: key đã là chuỗi cắt khoảng trắng. Mã không unique -> sắp theo id để luôn trúng một dòng.
func (s *Service) getDbProduct(ctx context.Context, key string) (*omap.Map, error) {
	if key == "" {
		return nil, nil
	}
	rows, err := s.repo.Select(ctx, "db_san_pham", database.SelectOpt{Select: "*", Filter: keyFilter(key, key), Order: "id.asc", Limit: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// GetDbProduct = getDbProduct (S:598-605): dòng thô theo id (khoá toàn chữ số) hoặc mã; không có -> nil.
func (s *Service) GetDbProduct(ctx context.Context, key any) (*omap.Map, error) {
	return s.getDbProduct(ctx, jsval.Trim(jsval.S(key)))
}

// dataToRow = dataToRow_ (S:607-618): {nhãn: giá trị} -> {cột: giá trị đã ép kiểu}.
// Khác saveDbProduct: chữ null -> "", số "" / null -> null, boolean luôn được tính.
func dataToRow(data *omap.Map) *omap.Map {
	row := omap.New()
	data.Each(func(label string, v any) {
		col := categories.ColOf(label)
		if col == "" {
			return
		}
		switch {
		case label == nhanLapRoi:
			v = laCo(jsval.ToString(v))
		case dbNum[label]:
			if rong(v) {
				v = nil
			} else {
				v = qscore.N(v)
			}
		case jsval.IsNullish(v):
			v = ""
		default:
			v = jsval.ToString(v)
		}
		row.Set(col, v)
	})
	return row
}

// diffDbProduct (S:621-634): so dữ liệu gửi lên với sản phẩm đang có -> các trường thật sự đổi.
func (s *Service) diffDbProduct(ctx context.Context, key string, data *omap.Map) (cur, row *omap.Map, changes []change, err error) {
	if cur, err = s.getDbProduct(ctx, key); err != nil {
		return nil, nil, nil, err
	}
	if cur == nil {
		return nil, nil, nil, apperr.New("Không tìm thấy sản phẩm.")
	}
	row = dataToRow(data)
	for _, col := range row.Keys() {
		v := row.Val(col)
		// Cột chưa có trong database mà cũng không nhập gì -> bỏ, tránh lỗi "column does not exist"
		if !cur.Has(col) && rong(v) {
			row.Delete(col)
			continue
		}
		oldS, newS := jsval.S(cur.Val(col)), jsval.S(v)
		if oldS != newS {
			field := categories.LabelOf(col)
			if field == "" {
				field = col
			}
			changes = append(changes, change{field, oldS, newS})
		}
	}
	return cur, row, changes, nil
}

// UpdateDbProductTracked = updateDbProductTracked (S:635-665): sửa + lịch sử + audit; nội dung đổi thì phải duyệt lại.
// opts (chỉ nơi gọi nội bộ truyền): giuDuyet, noAudit, auditAction, auditPrefix.
func (s *Service) UpdateDbProductTracked(ctx context.Context, a *actor.Actor, key any, data any, opts *omap.Map) (*omap.Map, error) {
	k := jsval.Trim(jsval.S(key))
	if k == "" {
		return nil, apperr.New("Thiếu mã/ID sản phẩm.")
	}
	if err := s.guardSpChung(ctx, k); err != nil {
		return nil, err
	}
	// data không phải object: Object.keys cho khoá chỉ số, không nhãn nào khớp -> coi như {}
	cur, row, changes, err := s.diffDbProduct(ctx, k, jsval.AsMap(data))
	if err != nil {
		return nil, err
	}
	ma := jsval.S(cur.Val("ma_sp"))
	if len(changes) == 0 {
		return omap.Of("updated", false, "changes", 0.0), nil
	}
	row.Set("ngay_cap_nhat", jsval.NowISO())
	if !s.whoColMissing.Load() && a != nil && a.U != "" {
		row.Set("nguoi_sua", a.U)
	}
	daDuyet := cur.Val("da_duyet") == true
	if !jsval.Truthy(opts.Val("giuDuyet")) && daDuyet {
		row.Set("da_duyet", false).Set("nguoi_duyet", nil).Set("ngay_duyet", nil)
		changes = append(changes, change{"TRẠNG THÁI DUYỆT", "Đã duyệt", "Chưa duyệt (do sửa lại)"})
	}
	// CHỈ cập nhật đúng dòng đang sửa
	idEq := database.Eq("id", cur.Val("id"))
	if _, err := s.repo.Update(ctx, "db_san_pham", idEq, row); err != nil {
		if !whoColMissingErr(err) {
			return nil, apperr.ColErr(err)
		}
		s.whoColMissing.Store(true)
		row.Delete("nguoi_sua")
		if _, err := s.repo.Update(ctx, "db_san_pham", idEq, row); err != nil {
			return nil, err
		}
	}
	s.cacheClear()
	who := actorName(a, anDanh)
	hist := make([]*omap.Map, len(changes))
	fields := make([]string, len(changes))
	for i, c := range changes {
		hist[i] = omap.Of("ma_sp", ma, "field", c.field, "old_value", c.old, "new_value", c.new,
			"changed_by", actorUID(a), "changed_by_name", who)
		fields[i] = c.field
	}
	if _, err := s.repo.Insert(ctx, "db_san_pham_history", hist); err != nil {
		logger.Error("product history", "insert lỗi:", err.Error())
	}
	ten := jsval.S(cur.Val("ten_sp"))
	if !jsval.Truthy(opts.Val("noAudit")) {
		s.logAudit(ctx, a, jsval.ToString(jsval.Or(opts.Val("auditAction"), "sua_sp")),
			jsval.ToString(jsval.Or(opts.Val("auditPrefix"), "Sửa SP "))+ma+" ("+ten+"): "+strings.Join(fields, ", "))
	}
	if row.Val("da_duyet") == false {
		daDuyet = false
	}
	return omap.Of("updated", true, "changes", float64(len(changes)), "ten", ten, "ma", ma, "id", cur.Val("id"), "daDuyet", daDuyet), nil
}

// ───────────── Cửa ngõ kiểm quyền (A:529-545) ─────────────

// UpdateProductGated = updateProductGated (A:529-533).
func (s *Service) UpdateProductGated(ctx context.Context, a *actor.Actor, key any, data any) (*omap.Map, error) {
	edit, _, _, err := s.SpPerms(ctx, a)
	if err != nil {
		return nil, err
	}
	if !edit {
		return nil, apperr.New("Tài khoản không có quyền sửa sản phẩm")
	}
	return s.UpdateDbProductTracked(ctx, a, key, data, nil)
}

// CreateProductGated = createProductGated (A:535-539). data không phải object -> không có tên -> lỗi "Chưa có Tên sản phẩm.".
func (s *Service) CreateProductGated(ctx context.Context, a *actor.Actor, data any) (*omap.Map, error) {
	edit, _, _, err := s.SpPerms(ctx, a)
	if err != nil {
		return nil, err
	}
	if !edit {
		return nil, apperr.New("Tài khoản không có quyền thêm/sửa sản phẩm")
	}
	return s.SaveDbProduct(ctx, a, jsval.AsMap(data), nil)
}
