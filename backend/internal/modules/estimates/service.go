// Package estimates: CÔNG TÁC XÂY DỰNG (Phần thô) - bản chuyển 1:1 của khối ct* trong server/store_supa.js
// (S:1297-1508), các cửa ngõ kiểm quyền ct*Gated của server/auth.js (A:574-596) và route xuất Excel
// POST /export/cong-tac của server/index.js (I:692-743).
package estimates

import (
	"context"
	"regexp"
	"strings"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

// Deps: phụ thuộc của module. Perms do materials cài (spPerms_), Auditor do users cài (logAudit_).
// Repo để trống thì dùng NewRepository(DB); test truyền repository giả.
type Deps struct {
	DB      *database.DB
	Cfg     *config.Config
	Perms   contracts.ProductPerms
	Auditor contracts.Auditor
	Repo    Repository
	Access  contracts.AccessChecker // phân quyền 3 cấp (N21, access_gate.go); nil = không kiểm (test golden đối chiếu Node)
}

// Service: nghiệp vụ công tác.
type Service struct {
	access contracts.AccessChecker // N21: cổng rpc / REST kiểm quyền (access_gate.go)
	repo   Repository
	cfg    *config.Config
	perms  contracts.ProductPerms
	audit  contracts.Auditor
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = NewRepository(d.DB)
	}
	return &Service{access: d.Access, repo: repo, cfg: d.Cfg, perms: d.Perms, audit: d.Auditor}
}

/*** ===== ĐỔI DÒNG DB <-> OBJECT ===== ***/

// s(v) || def
func sOr(v any, def string) string {
	if t := jsval.S(v); t != "" {
		return t
	}
	return def
}

// v == null ? "" : n(v)
func numOrEmpty(v any) any {
	if jsval.IsNullish(v) {
		return ""
	}
	return qscore.N(v)
}

// ctToObj (S:1301-1317): dòng cong_tac -> object cho client.
func ctToObj(r *omap.Map) *omap.Map {
	return omap.Of(
		"id", r.Val("id"), "loai", sOr(r.Val("loai"), "kt_chitiet"), "mode", sOr(r.Val("che_do"), "item"),
		"maNhom", jsval.S(r.Val("ma_nhom")), "hangMuc", jsval.S(r.Val("hang_muc")), "deMuc", jsval.S(r.Val("de_muc")),
		"ten", jsval.S(r.Val("ten")), "dvt", jsval.S(r.Val("dvt")), "ncc", jsval.S(r.Val("nha_cung_cap")),
		"kl", numOrEmpty(r.Val("khoi_luong")),
		"dt", numOrEmpty(r.Val("dien_tich")),
		"hs", numOrEmpty(r.Val("he_so")),
		"dgnt", qscore.N(r.Val("don_gia_nha_thau")), "dg", qscore.N(r.Val("don_gia")),
		"gc", jsval.S(r.Val("ghi_chu")), "hinhAnh", jsval.S(r.Val("hinh_anh")), "thongSo", jsval.S(r.Val("thong_so")),
		"phamVi", jsval.S(r.Val("pham_vi")), "linkTaiLieu", jsval.S(r.Val("link_tai_lieu")),
		"daDuyet", r.Val("da_duyet") == true, "nguoiDuyet", jsval.S(r.Val("nguoi_duyet")), "ngayDuyet", jsval.Or(r.Val("ngay_duyet"), ""),
		"yeuThich", r.Val("yeu_thich") == true,
		"nguoiTao", jsval.S(r.Val("nguoi_tao")), "ngayTao", jsval.Or(r.Val("ngay_tao"), ""),
		"nguoiSua", jsval.S(r.Val("nguoi_sua")), "ngayCapNhat", jsval.Or(r.Val("ngay_cap_nhat"), ""),
		"thuTu", qscore.N(r.Val("thu_tu")),
	)
}

func ctRows(rows []*omap.Map) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = ctToObj(r)
	}
	return out
}

// typeErrRead: thông báo TypeError của V8 khi đọc thuộc tính của null / undefined.
func typeErrRead(v any, prop string) error {
	kind := "null"
	if jsval.IsUndefined(v) {
		kind = "undefined"
	}
	return apperr.New("Cannot read properties of " + kind + " (reading '" + prop + "')")
}

// ctToRow (S:1322-1334): object của client -> dòng cong_tac. d không phải object thì mọi khoá là undefined
// (như đọc thuộc tính của số / chuỗi); d null / undefined -> TypeError như Node.
func ctToRow(d any) (*omap.Map, error) {
	if jsval.IsNullish(d) {
		return nil, typeErrRead(d, "loai")
	}
	g := func(k string) any { return jsval.Get(d, k) }
	num := func(v any) any {
		if jsval.IsNullish(v) || jsval.StrictEquals(v, "") {
			return nil
		}
		return qscore.N(v)
	}
	r := omap.Of(
		"loai", sOr(g("loai"), "kt_chitiet"), "che_do", sOr(g("mode"), "item"),
		"ma_nhom", jsval.S(g("maNhom")), "hang_muc", jsval.S(g("hangMuc")), "de_muc", jsval.S(g("deMuc")),
		"ten", jsval.S(g("ten")), "dvt", jsval.S(g("dvt")), "nha_cung_cap", jsval.S(g("ncc")),
		"khoi_luong", num(g("kl")), "dien_tich", num(g("dt")), "he_so", num(g("hs")),
		"don_gia_nha_thau", num(g("dgnt")), "don_gia", num(g("dg")),
		"ghi_chu", jsval.S(g("gc")), "hinh_anh", jsval.S(g("hinhAnh")), "thong_so", jsval.S(g("thongSo")),
		"pham_vi", jsval.S(g("phamVi")), "link_tai_lieu", jsval.S(g("linkTaiLieu")),
	)
	if tt := g("thuTu"); !jsval.IsNullish(tt) && !jsval.StrictEquals(tt, "") {
		r.Set("thu_tu", qscore.N(tt))
	}
	return r, nil
}

/*** ===== LỖI ===== ***/

// Dấu chấm của JS không khớp \n, \r, U+2028, U+2029 (Go chỉ loại \n).
const jsDot = `[^\n\r\x{2028}\x{2029}]`

// ci: chuỗi cố định -> biểu thức không phân biệt hoa thường CHỈ trong ASCII như cờ /i của JS (không có cờ u).
// (?i) của Go gập chữ theo Unicode nên "s" khớp cả U+017F, "k" khớp cả U+212A - JS thì không.
func ci(lit string) string {
	var b strings.Builder
	for _, r := range lit {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteString("[" + string(r) + string(r-32) + "]")
		case r >= 'A' && r <= 'Z':
			b.WriteString("[" + string(r+32) + string(r) + "]")
		default:
			b.WriteString(regexp.QuoteMeta(string(r)))
		}
	}
	return b.String()
}

var (
	reCtMissingCol = regexp.MustCompile(ci("Could not find the '") + `([a-zA-Z0-9_]+)` + ci("' column"))
	reCtNoTable    = regexp.MustCompile(ci("relation ") + jsDot + "*" + ci("cong_tac") + jsDot + "*" + ci(" does not exist") +
		"|" + ci("PGRST205") + "|" + ci("Could not find the table"))
	reCtNoPerm    = regexp.MustCompile(ci("42501") + "|" + ci("row-level security"))
	reCtListEmpty = regexp.MustCompile(ci("does not exist") + "|" + ci("PGRST205") + "|" + ci("Could not find the table"))
	reCtHistThieu = regexp.MustCompile(ci("does not exist") + "|" + ci("not find the table") + "|" + ci("42P01") +
		"|" + ci("PGRST205") + "|404")
)

// ctMissingCol (S:1337-1341): tên cột thiếu trong lỗi PGRST204; không phải lỗi đó -> "".
func ctMissingCol(err error) string {
	if err == nil {
		return ""
	}
	if g := reCtMissingCol.FindStringSubmatch(err.Error()); g != nil {
		return g[1]
	}
	return ""
}

// ctTry (S:1342-1353): ghi; thiếu đúng một cột mà dòng ghi có mang thì bỏ cột đó và ghi lại MỘT lần.
// Node nhận cả mảng lẫn object đơn - ở đây bản vá đơn được bọc thành mảng 1 phần tử.
func ctTry(fn func(body []*omap.Map) ([]*omap.Map, error), body []*omap.Map) ([]*omap.Map, error) {
	out, err := fn(body)
	if err == nil {
		return out, nil
	}
	var first *omap.Map
	if len(body) > 0 {
		first = body[0]
	}
	if col := ctMissingCol(err); col != "" && first.Has(col) {
		logger.Error("cong_tac", "thiếu cột "+col+` — chạy "npm run migrate". Tạm bỏ cột này.`)
		stripped := make([]*omap.Map, len(body))
		for i, o := range body {
			c := o.Clone()
			c.Delete(col)
			stripped[i] = c
		}
		return fn(stripped)
	}
	return nil, err
}

// ctErr (S:1354-1361): lỗi của bảng cong_tac -> lỗi dễ hiểu; lỗi khác trả nguyên.
func ctErr(err error) error {
	m := err.Error()
	if reCtNoTable.MatchString(m) {
		return apperr.New("Chưa có bảng cong_tac. " + apperr.HDMig)
	}
	if reCtNoPerm.MatchString(m) {
		return apperr.New("Tài khoản database không có quyền ghi bảng cong_tac — kiểm tra quyền của tài khoản trong DATABASE_URL.")
	}
	return err
}

// ctHistThieu (S:1402-1405): lỗi do chưa có bảng cong_tac_history.
func ctHistThieu(err error) bool {
	m := err.Error()
	return strings.Contains(m, "cong_tac_history") && reCtHistThieu.MatchString(m)
}

/*** ===== NGƯỜI THAO TÁC ===== ***/

// (actor && actor.u) || "ẩn danh"
func whoOf(a *actor.Actor) string {
	if a != nil && a.U != "" {
		return a.U
	}
	return "ẩn danh"
}

// (actor && actor.uid) || null
func uidOf(a *actor.Actor) any {
	if a != nil && jsval.Truthy(a.UID) {
		return a.UID
	}
	return nil
}

// logAudit_ (S:587-594) qua contracts.Auditor: nuốt lỗi, chạy đồng bộ.
func (s *Service) logAudit(ctx context.Context, a *actor.Actor, action, detail string) {
	if s.audit != nil {
		s.audit.Audit(ctx, a, action, detail, nil)
	}
}

// Array.isArray(ids) ? ids : [ids]
func idList(ids any) []any {
	if arr, ok := ids.([]any); ok {
		return arr
	}
	return []any{ids}
}

// kết quả của ctDelete / ctDuyet / ctFav: {ok[, errors]}
func batchOut(ok int, errs []any) *omap.Map {
	out := omap.Of("ok", float64(ok))
	if len(errs) > 0 {
		out.Set("errors", errs)
	}
	return out
}

func itoa(n int) string { return jsval.NumberToString(float64(n)) }

/*** ===== ĐỌC ===== ***/

// CtList = ctList (S:1362-1371): toàn bộ thư viện công tác của công ty; chưa có bảng -> [].
func (s *Service) CtList(ctx context.Context) ([]any, error) {
	rows, err := s.repo.ListCongTac(ctx)
	if err != nil {
		if reCtListEmpty.MatchString(err.Error()) {
			return []any{}, nil
		}
		return nil, err
	}
	return ctRows(qscore.ChamTran(rows, qscore.LIM, "Thư viện công tác")), nil
}

// CtGetHistory = ctGetHistory (S:1430-1439): lịch sử của một công tác, mới nhất trước.
func (s *Service) CtGetHistory(ctx context.Context, id any) ([]any, error) {
	if !jsval.Truthy(id) {
		return []any{}, nil
	}
	rows, err := s.repo.ListHistory(ctx, id)
	if err != nil {
		if ctHistThieu(err) {
			return []any{}, nil
		}
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = omap.Of("field", jsval.S(r.Val("field")), "old", jsval.S(r.Val("old_value")), "new", jsval.S(r.Val("new_value")),
			"by", jsval.S(r.Val("changed_by_name")), "at", jsval.S(r.Val("changed_at")))
	}
	return out, nil
}
