// Package takeoff: dòng bóc tách của dự án (db_bao_gia). Bản chuyển 1:1 của store_supa.js:315-405, 955-964
// và cửa ngõ saveLineAsProductGated (auth.js:547-551).
package takeoff

import (
	"context"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

// Deps: Perms + Saver + Approval = materials (spPerms_, saveDbProduct, sản phẩm chưa duyệt). Repo để trống thì dùng DB.
// Approval nil (test golden) -> không kiểm duyệt khi thêm dòng.
type Deps struct {
	DB       *database.DB
	Cfg      *config.Config
	Perms    contracts.ProductPerms
	Saver    contracts.ProductSaver
	Approval contracts.ApprovalChecker
	Repo     Repository
	Access   contracts.AccessChecker // phân quyền 3 cấp (N21, access_gate.go); nil = không kiểm (test golden đối chiếu Node)
}

// Service: nghiệp vụ dòng bóc tách.
type Service struct {
	access   contracts.AccessChecker // N21: cổng rpc / REST kiểm quyền (access_gate.go)
	repo     Repository
	cfg      *config.Config
	perms    contracts.ProductPerms
	saver    contracts.ProductSaver
	approval contracts.ApprovalChecker
}

var _ contracts.LineReader = (*Service)(nil)

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = NewRepository(d.DB)
	}
	return &Service{access: d.Access, repo: repo, cfg: d.Cfg, perms: d.Perms, saver: d.Saver, approval: d.Approval}
}

func bit(v any) float64 {
	if jsval.Truthy(v) {
		return 1
	}
	return 0
}

// lineToObj (S:315-330): dòng db_bao_gia -> object cho client.
func lineToObj(r *omap.Map) *omap.Map {
	n, s := qscore.N, jsval.S
	von, ck, sl := n(r.Val("gia_ban_le")), n(r.Val("ck_dai_ly_pct")), n(r.Val("so_luong"))
	giaDaiLy := n(r.Val("gia_dai_ly"))
	extra := r.Val("extra")
	if !jsval.Truthy(extra) {
		extra = omap.New()
	}
	return omap.Of(
		"lineId", jsval.ToString(r.Val("id")), "maDA", s(r.Val("ma_du_an")), "stt", n(r.Val("sort_no")),
		"nhom", s(r.Val("nhom")), "loai", s(r.Val("loai")), "tang", s(r.Val("tang")), "maSP", s(r.Val("ma_sp")), "ten", s(r.Val("ten_sp")),
		"thuongHieu", s(r.Val("thuong_hieu")), "ncc", s(r.Val("nha_cung_cap")), "moTa", s(r.Val("mo_ta")), "kichThuoc", s(r.Val("kich_thuoc")),
		"hinhAnh", s(r.Val("hinh_anh")), "dvt", jsval.Or(s(r.Val("dvt")), "Cái"), "khuVuc", s(r.Val("phong")), "maBanVe", s(r.Val("ma_so_ban_ve")),
		"soLuong", sl, "donGiaVon", von, "chietKhau", ck, "lnPct", n(r.Val("loi_nhuan_pct")), "donGiaBan", n(r.Val("gia_ban")),
		"ckKhach", n(r.Val("ck_khach_hang_pct")), "donGia", n(r.Val("don_gia")), // đơn giá NET (sau CK khách)
		"giamGiaNcc", n(r.Val("giam_gia_ncc_pct")),
		"thanhTienVon", qscore.Round0(sl*giaDaiLy), "thanhTienBan", n(r.Val("thanh_tien")),
		"trangThai", s(r.Val("trang_thai")), "ghiChu", s(r.Val("ghi_chu")), "tuNhap", bit(r.Val("tu_nhap")), "daLuuDM", bit(r.Val("da_luu_dm")),
		"extra", extra,
	)
}

// GetLines (S:331-334).
func (s *Service) GetLines(ctx context.Context, maDA any) ([]any, error) {
	rows, err := s.repo.ListLines(ctx, maDA)
	if err != nil {
		return nil, err
	}
	rows = qscore.ChamTran(rows, qscore.LIM, "Dòng bóc tách của dự án")
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = lineToObj(r)
	}
	return out, nil
}

// calc = calc_ (S:336-344): các cột dẫn xuất. ban nil = chưa có giá bán -> tính từ %LN.
// round0_ của Node đổi NaN / Infinity về 0 nên dùng qscore.Round0; markup / margin dùng Math.round thường.
func calc(von, ckDaiLy, ln float64, ban any, ckKhach, sl float64) calcOut {
	giaDaiLy := qscore.Round0(von * (1 - ckDaiLy/100))
	var b float64
	if jsval.IsNullish(ban) {
		b = qscore.Round0(von * (1 + ln/100))
	} else {
		b = jsval.ToNumber(ban)
	}
	donGia := qscore.Round0(b * (1 - ckKhach/100))
	markup, margin := 0.0, 0.0
	if giaDaiLy > 0 {
		markup = jsval.Round((donGia - giaDaiLy) / giaDaiLy * 100)
	}
	if donGia > 0 {
		margin = jsval.Round((donGia - giaDaiLy) / donGia * 100)
	}
	return calcOut{giaDaiLy: giaDaiLy, ban: b, donGia: donGia, markup: markup, margin: margin,
		thanhTien: qscore.Round0(sl * donGia), lnVnd: qscore.Round0((donGia - giaDaiLy) * sl)}
}

// AddLine (S:345-370): thêm 1 dòng, chụp lại thông tin sản phẩm tại thời điểm thêm.
func (s *Service) AddLine(ctx context.Context, maDA any, product any, soLuong any) (*omap.Map, error) {
	p := jsval.AsMap(product) // product || {}
	or := jsval.Or
	sl := jsval.NumOr(soLuong, 1) // 0 cũng thành 1
	von := qscore.N(p.Val("donGiaVon"))
	donGiaBan := p.Val("donGiaBan")
	var ln float64
	if von > 0 && jsval.Truthy(donGiaBan) {
		ln = jsval.Round((qscore.N(donGiaBan) - von) / von * 100)
	} else {
		ln = jsval.Num0(p.Val("lnPct"))
	}
	existing, err := s.repo.MaxSortNo(ctx, maDA)
	if err != nil {
		return nil, err
	}
	stt := 1.0
	if len(existing) > 0 && existing[0] != nil {
		stt = jsval.Num0(existing[0].Val("sort_no")) + 1
	}
	var ban any
	if !jsval.IsNullish(donGiaBan) {
		ban = qscore.N(donGiaBan)
	}
	ckDaiLy, ckKhach := jsval.Num0(p.Val("chietKhau")), jsval.Num0(p.Val("ckKhach"))
	c := calc(von, ckDaiLy, ln, ban, ckKhach, sl)
	row := omap.Of(
		"ma_du_an", maDA, "sort_no", stt, "stt", jsval.NumberToString(stt),
		"nhom", or(p.Val("nhom"), ""), "loai", or(p.Val("hangMuc"), p.Val("loai"), ""), "tang", or(p.Val("tang"), ""),
		"ma_sp", or(p.Val("ma"), ""), "ten_sp", or(p.Val("ten"), ""), "thuong_hieu", or(p.Val("thuongHieu"), ""), "nha_cung_cap", or(p.Val("ncc"), ""),
		"mo_ta", or(p.Val("moTa"), ""), "kich_thuoc", or(p.Val("kichThuoc"), ""), "hinh_anh", or(p.Val("hinhAnh"), ""), "dvt", or(p.Val("dvt"), "Cái"),
		"phong", or(p.Val("khuVuc"), ""), "ma_so_ban_ve", or(p.Val("maBanVe"), ""),
		"so_luong", sl, "gia_ban_le", von, "ck_dai_ly_pct", ckDaiLy, "loi_nhuan_pct", ln,
		"gia_dai_ly", c.giaDaiLy, "gia_ban", c.ban, "ck_khach_hang_pct", ckKhach, "don_gia", c.donGia,
		"thanh_tien", c.thanhTien, "markup_pct", c.markup, "margin_pct", c.margin, "loi_nhuan_vnd", c.lnVnd,
		"trang_thai", or(p.Val("trangThai"), ""), "ghi_chu", or(p.Val("ghiChu"), ""),
		"tu_nhap", jsval.Num0(p.Val("tuNhap")), "da_luu_dm", jsval.Num0(p.Val("daLuuDM")),
		"extra", or(p.Val("extra"), nil),
	)
	res, err := s.repo.InsertLine(ctx, row)
	if err != nil {
		if apperr.KhongCoCha(err) {
			return nil, apperr.New(apperr.DAMat)
		}
		return nil, err
	}
	if len(res) == 0 || res[0] == nil {
		return nil, apperr.New("Cannot read properties of undefined (reading 'gia_ban_le')")
	}
	return lineToObj(res[0]), nil
}

// msgChuaDuyet: lỗi khi đưa sản phẩm chưa duyệt vào bóc tách (M14.6).
const msgChuaDuyet = "Sản phẩm chưa được duyệt — không đưa vào bóc tách được"

// AddLineGated (chỉ bản Go, roadmap M14.6): sản phẩm (theo mã product.ma) đang Chưa duyệt thì không thêm vào bóc tách -
// chặn mọi đường thêm dòng mang sản phẩm (chọn ở Bóc tách, Ghi danh vào dự án, nhân bản dòng, nhập file). Dòng đã có không đổi.
// Hàm lõi AddLine giữ như bản Node (test golden).
func (s *Service) AddLineGated(ctx context.Context, maDA any, product any, soLuong any) (*omap.Map, error) {
	if s.approval != nil {
		if p := jsval.AsMap(product); p != nil {
			chua, err := s.approval.ChuaDuyet(ctx, jsval.S(p.Val("ma")))
			if err != nil {
				return nil, err
			}
			if chua {
				return nil, apperr.New(msgChuaDuyet)
			}
		}
	}
	return s.AddLine(ctx, maDA, product, soLuong)
}

// AddBlankLine (S:371-374): soLuong 0 nên dòng trống được lưu với số lượng 1 (Number(0) || 1).
func (s *Service) AddBlankLine(ctx context.Context, maDA any, opts any) (*omap.Map, error) {
	o := jsval.AsMap(opts)
	return s.AddLine(ctx, maDA, omap.Of("ten", "Hạng mục mới", "dvt", "Cái", "donGiaVon", 0.0, "donGiaBan", 0.0,
		"tang", jsval.Or(o.Val("tang"), ""), "nhom", jsval.Or(o.Val("nhom"), "")), 0.0)
}

// UpdateLine (S:378-404): sửa 1 dòng + tính lại giá. Không có dòng -> nil (JSON null).
// Mọi phép thử là hasOwnProperty: khoá có mặt là đủ, kể cả khi giá trị null.
func (s *Service) UpdateLine(ctx context.Context, lineID any, fields any) (*omap.Map, error) {
	f := jsval.AsMap(fields) // fields || {}
	curRows, err := s.repo.FindLine(ctx, lineID)
	if err != nil {
		return nil, err
	}
	if len(curRows) == 0 || curRows[0] == nil {
		return nil, nil
	}
	cur := curRows[0]
	// Node gọi fields.hasOwnProperty(k): khoá tên "hasOwnProperty" trong fields che mất hàm ấy -> TypeError trước khi ghi
	if f.Has("hasOwnProperty") {
		return nil, apperr.New("fields.hasOwnProperty is not a function")
	}
	n := qscore.N
	patch := omap.New()
	for _, m := range lineMap {
		if f.Has(m[0]) {
			v := f.Val(m[0])
			if jsval.IsNullish(v) {
				v = ""
			}
			patch.Set(m[1], v)
		}
	}
	if f.Has("giamGiaNcc") {
		patch.Set("giam_gia_ncc_pct", jsval.Num0(f.Val("giamGiaNcc")))
	}
	if f.Has("tuNhap") {
		patch.Set("tu_nhap", jsval.Num0(f.Val("tuNhap")))
	}
	if f.Has("daLuuDM") {
		patch.Set("da_luu_dm", jsval.Num0(f.Val("daLuuDM")))
	}
	if f.Has("stt") {
		patch.Set("sort_no", jsval.Num0(f.Val("stt"))).Set("stt", jsval.ToString(f.Val("stt")))
	}
	if f.Has("extra") {
		patch.Set("extra", jsval.Or(f.Val("extra"), nil))
	}
	pick := func(key, col string, vn bool) float64 {
		if !f.Has(key) {
			return n(cur.Val(col))
		}
		if vn {
			return n(f.Val(key))
		}
		return jsval.Num0(f.Val(key))
	}
	sl := pick("soLuong", "so_luong", false)
	von := pick("donGiaVon", "gia_ban_le", true)
	ckDaiLy := pick("chietKhau", "ck_dai_ly_pct", false)
	ckKhach := pick("ckKhach", "ck_khach_hang_pct", false)
	ln := pick("lnPct", "loi_nhuan_pct", false)
	var ban any
	if f.Has("donGiaBan") {
		b := n(f.Val("donGiaBan"))
		ban = b
		ln = 0
		if von > 0 {
			ln = jsval.Round((b - von) / von * 100)
		}
	} else if !f.Has("lnPct") && !f.Has("donGiaVon") {
		// chỉ sửa trường khác (khu vực, ghi chú...) -> GIỮ giá bán đã lưu, tránh trôi giá do %LN đã làm tròn
		ban = n(cur.Val("gia_ban"))
	}
	c := calc(von, ckDaiLy, ln, ban, ckKhach, sl)
	patch.Set("so_luong", sl).Set("gia_ban_le", von).Set("ck_dai_ly_pct", ckDaiLy).Set("loi_nhuan_pct", ln).
		Set("gia_dai_ly", c.giaDaiLy).Set("gia_ban", c.ban).Set("ck_khach_hang_pct", ckKhach).Set("don_gia", c.donGia).
		Set("thanh_tien", c.thanhTien).Set("markup_pct", c.markup).Set("margin_pct", c.margin).Set("loi_nhuan_vnd", c.lnVnd)
	res, err := s.repo.UpdateLine(ctx, lineID, patch)
	if err != nil {
		return nil, err
	}
	if len(res) == 0 || res[0] == nil {
		return nil, nil
	}
	return lineToObj(res[0]), nil
}

// DeleteLine (S:405).
func (s *Service) DeleteLine(ctx context.Context, lineID any) (*omap.Map, error) {
	if err := s.repo.DeleteLine(ctx, lineID); err != nil {
		return nil, err
	}
	return omap.Of("ok", true), nil
}

// SaveLineAsProductGated (A:547-551): cửa ngõ kiểm quyền sửa sản phẩm rồi mới lưu dòng thành sản phẩm.
func (s *Service) SaveLineAsProductGated(ctx context.Context, a *actor.Actor, line any) (*omap.Map, error) {
	edit, _, _, err := s.perms.SpPerms(ctx, a)
	if err != nil {
		return nil, err
	}
	if !edit {
		return nil, apperr.New("Tài khoản không có quyền thêm sản phẩm vào danh mục")
	}
	return s.SaveLineAsProduct(ctx, a, line)
}

// SaveLineAsProduct (S:955-964): dòng bóc tách -> sản phẩm trong danh mục.
// line là Undefined (client không gửi tham số) thì Node coi actor là dữ liệu và lưu không kèm người thao tác.
func (s *Service) SaveLineAsProduct(ctx context.Context, a *actor.Actor, line any) (*omap.Map, error) {
	if jsval.IsUndefined(line) {
		if a != nil {
			line = a.Map()
		} else {
			line = nil
		}
		a = nil
	}
	p := jsval.AsMap(line) // p || {}
	gia := p.Val("gia")
	giaBanLe := gia
	if jsval.IsNullish(gia) {
		giaBanLe = p.Val("donGiaBan")
	}
	data := omap.Of("TÊN SẢN PHẨM", p.Val("ten"), "MÃ SẢN PHẨM", p.Val("ma"), "DÒNG SẢN PHẨM", p.Val("nhom"), "HẠNG MỤC", p.Val("hangMuc"),
		"THƯƠNG HIỆU", p.Val("thuongHieu"), "NHÀ CUNG CẤP", p.Val("ncc"), "ĐƠN VỊ TÍNH", p.Val("dvt"), "GIÁ BÁN LẺ", giaBanLe,
		"GHI CHÚ", p.Val("moTa"), "ẢNH SẢN PHẨM", p.Val("hinhAnh"))
	r, err := s.saver.SaveDbProduct(ctx, a, data, nil)
	if err != nil {
		return nil, err
	}
	sv := jsval.S
	out := omap.Of("ten", p.Val("ten"), "ma", sv(p.Val("ma")), "thuongHieu", sv(p.Val("thuongHieu")), "ncc", sv(p.Val("ncc")),
		"nhom", sv(p.Val("nhom")), "hangMuc", sv(p.Val("hangMuc")), "dvt", jsval.Or(sv(p.Val("dvt")), "Cái"),
		"donGiaVon", qscore.N(gia), "donGiaBan", qscore.N(gia), "hinhAnh", sv(p.Val("hinhAnh")))
	return omap.Assign(out, r), nil
}
