// Package purchasing: đơn mua hàng và đề xuất mua hàng (chiết khấu / thanh toán) - bản chuyển 1:1 của
// server/store_supa.js dòng 1155-1296, server/auth.js dòng 617-666, 681-709 và server/index.js dòng 137-319.
package purchasing

import (
	"context"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"

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

// Deps: do internal/server/routes.go truyền vào. PurchaseNotifier và Notifier do module notifications cài,
// Users và Auditor do module users cài. Repo và HTTP chỉ để test thay thế (bỏ trống = bản thật).
type Deps struct {
	DB               *database.DB
	Cfg              *config.Config
	PurchaseNotifier contracts.PurchaseNotifier
	Notifier         contracts.Notifier
	Users            contracts.UserReader
	Auditor          contracts.Auditor
	Repo             Repository
	HTTP             *http.Client
	Access           contracts.AccessChecker // phân quyền 3 cấp (N21, access_gate.go); nil = không kiểm (test golden đối chiếu Node)
}

// Service: nghiệp vụ mua hàng.
type Service struct {
	access  contracts.AccessChecker // N21: cổng rpc / REST kiểm quyền (access_gate.go)
	repo    Repository
	db      *database.DB // transaction (D-13); nil khi test unit dùng repo giả
	cfg     *config.Config
	pn      contracts.PurchaseNotifier
	notify  contracts.Notifier
	users   contracts.UserReader
	auditor contracts.Auditor
	http    *http.Client
	now     func() time.Time // Date.now() / new Date()
	rnd     func() float64   // Math.random()
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = newPgRepo(d.DB)
	}
	hc := d.HTTP
	if hc == nil {
		// fetch của Node không đặt hạn riêng; undici tự cắt sau 300 giây chờ header
		hc = &http.Client{Timeout: 300 * time.Second}
	}
	return &Service{access: d.Access, repo: repo, db: d.DB, cfg: d.Cfg, pn: d.PurchaseNotifier, notify: d.Notifier, users: d.Users,
		auditor: d.Auditor, http: hc, now: time.Now, rnd: rand.Float64}
}

// tx: chạy fn trong transaction (D-13). Repo giả trong test unit không có DB -> chạy thẳng.
func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	return s.db.Tx(ctx, fn)
}

// typeErr: đọc thuộc tính key của v khi v là null / undefined -> TypeError như V8; ngược lại nil.
func typeErr(v any, key string) error {
	if !jsval.IsNullish(v) {
		return nil
	}
	kind := "null"
	if jsval.IsUndefined(v) {
		kind = "undefined"
	}
	return apperr.New("Cannot read properties of " + kind + " (reading '" + key + "')")
}

// objOr: x || {} rồi chỉ dùng như object. Giá trị truthy không phải object (chuỗi, số, mảng) không có khoá nào
// trong số các khoá nghiệp vụ đọc, nên tương đương object rỗng.
func objOr(v any) *omap.Map {
	if m := jsval.AsMap(v); m != nil {
		return m
	}
	return omap.New()
}

// arrOf: Array.isArray(x) ? x : [].
func arrOf(v any) []any { return jsval.AsArray(v) }

// strOr: s(v) || def.
func strOr(v any, def string) string {
	if t := jsval.S(v); t != "" {
		return t
	}
	return def
}

// uidOf: actor && actor.uid.
func uidOf(a *actor.Actor) any {
	if a == nil {
		return nil
	}
	return a.UID
}

// maSuffix: Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 1e4).
func (s *Service) maSuffix() string {
	return strings.ToUpper(strconv.FormatInt(s.now().UnixMilli(), 36)) + "-" + strconv.Itoa(int(s.rnd()*1e4))
}

// genMaDon: mã đơn mua hàng (genMaDon_, S:1156).
func (s *Service) genMaDon() string { return "MH-" + s.maSuffix() }

// SavePurchaseOrder: lưu đơn mua hàng, mỗi nhà cung cấp 1 đơn (S:1158-1191). Trả {saved: [mã đơn]}.
//
// D-13: MỖI đơn (phiếu + dòng hàng) ghi trong 1 transaction riêng -> lỗi giữa chừng không để lại phiếu thiếu dòng hàng,
// kể cả khi lệnh xoá bù trừ hỏng. KHÔNG gộp cả vòng vào 1 transaction: ngay_gui (sent_at DEFAULT now()) lấy giờ BẮT ĐẦU
// transaction -> các đơn của cùng lần gửi trùng ngay_gui, thứ tự "ngay_gui.desc" (getPurchaseOrders, listPurchaseRequests)
// đảo so với Node (golden TestDBDiff bắt được: po_get_da1, po_list, po_get_da3). Đơn đã commit trước đơn hỏng vẫn gỡ bằng
// bù trừ như Node (ngoài transaction, nuốt lỗi); xoá mã đang dở sau rollback chỉ xoá 0 dòng.
func (s *Service) SavePurchaseOrder(ctx context.Context, orderV any) (*omap.Map, error) {
	order := objOr(orderV)
	orders := arrOf(order.Val("orders"))
	saved := []any{}
	dang := ""
	err := func() error {
		for _, od := range orders {
			maDon := s.genMaDon()
			dang = maDon
			if err := typeErr(od, "items"); err != nil {
				return err
			}
			items := arrOf(jsval.Get(od, "items"))
			total, vat := qscore.N(jsval.Get(od, "total")), qscore.N(jsval.Get(od, "vat"))
			if err := s.tx(ctx, func(ctx context.Context) error {
				if err := s.repo.InsertOrder(ctx, omap.Of(
					"ma_don", maDon, "ma_du_an", jsval.S(order.Val("maDA")), "ten_du_an", jsval.S(order.Val("project")),
					"hang_muc", jsval.S(jsval.Or(order.Val("hangMuc"), order.Val("node"))),
					"nha_cung_cap", jsval.S(jsval.Get(od, "supplier")), "so_sp", float64(len(items)),
					"tong_truoc_vat", total-vat, "vat_pct", qscore.N(jsval.Get(od, "vatPct")),
					"vat", vat, "tong_cong", total, "trang_thai", ttChoDuyet, "kenh_gui", strOr(order.Val("kenh"), "Lark"),
					"ket_qua_gui", strOr(order.Val("ketQua"), "ok"), "nguoi_gui", jsval.S(order.Val("nguoiGui")),
					"phong_ban", jsval.S(order.Val("phongBan")), "ghi_chu", jsval.S(order.Val("ghiChu")),
					"requester_id", jsval.Or(order.Val("requesterId"), nil),
				)); err != nil {
					return err
				}
				if len(items) == 0 {
					return nil
				}
				rows := make([]*omap.Map, len(items))
				for i, it := range items {
					if err := typeErr(it, "sl"); err != nil {
						return err
					}
					sl, dg := qscore.N(jsval.Get(it, "sl")), qscore.N(jsval.Get(it, "donGia"))
					rows[i] = omap.Of("ma_don", maDon, "ma_sp", jsval.S(jsval.Get(it, "ma")), "ten_sp", jsval.S(jsval.Get(it, "ten")),
						"thuong_hieu", jsval.S(jsval.Get(it, "thuongHieu")), "phong", jsval.S(jsval.Get(it, "khuVuc")),
						"dvt", strOr(jsval.Get(it, "dvt"), "Cái"), "so_luong", sl, "don_gia", dg, "thanh_tien", sl*dg,
						"hinh_anh", jsval.S(jsval.Get(it, "hinhAnh")), "sort_no", float64(i))
				}
				return s.repo.InsertOrderItems(ctx, rows)
			}); err != nil {
				return err
			}
			saved = append(saved, maDon)
		}
		return nil
	}()
	if err != nil {
		// lỗi giữa chừng -> gỡ các phiếu đã commit của lần gửi này (không để gửi lại bị trùng); phiếu đang dở đã rollback
		xoa := append([]any{}, saved...)
		if dang != "" {
			xoa = append(xoa, dang) // khi có lỗi thì dang chưa nằm trong saved
		}
		for _, m := range xoa {
			_ = s.repo.DeleteOrder(ctx, m) // Node nuốt lỗi xoá
		}
		return nil, err
	}
	return omap.Of("saved", saved), nil
}

// GetPurchaseOrders: đơn mua hàng của 1 dự án kèm chi tiết (S:1193-1207).
func (s *Service) GetPurchaseOrders(ctx context.Context, maDA any) ([]any, error) {
	heads, err := s.repo.OrdersOfProject(ctx, maDA)
	if err != nil {
		return nil, err
	}
	out := []any{}
	for _, h := range heads {
		dt, err := s.repo.OrderItems(ctx, h.Val("ma_don"))
		if err != nil {
			return nil, err
		}
		items := make([]any, len(dt))
		for i, r := range dt {
			items[i] = omap.Of("ma", jsval.S(r.Val("ma_sp")), "ten", jsval.S(r.Val("ten_sp")), "thuongHieu", jsval.S(r.Val("thuong_hieu")),
				"khuVuc", jsval.S(r.Val("phong")), "dvt", jsval.S(r.Val("dvt")), "sl", qscore.N(r.Val("so_luong")),
				"donGia", qscore.N(r.Val("don_gia")), "thanhTien", qscore.N(r.Val("thanh_tien")), "hinhAnh", jsval.S(r.Val("hinh_anh")))
		}
		out = append(out, omap.Of(
			"maDon", jsval.S(h.Val("ma_don")), "ncc", jsval.S(h.Val("nha_cung_cap")), "hangMuc", jsval.S(h.Val("hang_muc")),
			"soSP", qscore.N(h.Val("so_sp")), "tongTruocVat", qscore.N(h.Val("tong_truoc_vat")), "vatPct", qscore.N(h.Val("vat_pct")),
			"vat", qscore.N(h.Val("vat")), "tongCong", qscore.N(h.Val("tong_cong")), "trangThai", jsval.S(h.Val("trang_thai")),
			"nguoiGui", jsval.S(h.Val("nguoi_gui")), "phongBan", jsval.S(h.Val("phong_ban")), "ghiChu", jsval.S(h.Val("ghi_chu")),
			"ngayGui", jsval.S(h.Val("ngay_gui")), "items", items,
			// khoá chỉ bản Go (M15.1, M9.1), nối cuối
			"nguoiDuyet", jsval.S(h.Val("nguoi_duyet")), "ngayDuyet", jsval.S(h.Val("ngay_duyet")), "ketQuaGui", jsval.S(h.Val("ket_qua_gui"))))
	}
	return out, nil
}

// ListPurchaseRequests: mọi đơn mua hàng cho Admin duyệt (A:617-623). Giá trị cột giữ nguyên (null vẫn là null).
func (s *Service) ListPurchaseRequests(ctx context.Context, _ *actor.Actor) ([]any, error) {
	rows, err := s.repo.ListOrders(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = omap.Of("maDon", r.Val("ma_don"), "project", r.Val("ten_du_an"), "supplier", r.Val("nha_cung_cap"),
			"soSp", jsval.Num0(r.Val("so_sp")), "total", jsval.Num0(r.Val("tong_cong")), "status", r.Val("trang_thai"),
			"requester", r.Val("nguoi_gui"), "phongBan", r.Val("phong_ban"), "at", r.Val("ngay_gui"),
			// khoá chỉ bản Go (M15.1), nối cuối; giá trị cột giữ nguyên như các khoá trên
			"resolver", r.Val("nguoi_duyet"), "resolvedAt", r.Val("ngay_duyet"))
	}
	return out, nil
}

// GetPurchaseOrder: chi tiết 1 đơn mua hàng (A:625-642). Số ép bằng Number(v) || 0, không phải bộ đọc số kiểu VN.
func (s *Service) GetPurchaseOrder(ctx context.Context, _ *actor.Actor, maDon any) (*omap.Map, error) {
	h, err := s.repo.OrderByCode(ctx, maDon)
	if err != nil {
		return nil, err
	}
	if h == nil {
		return nil, apperr.New(errKhongThayDon)
	}
	dt, err := s.repo.OrderItems(ctx, maDon)
	if err != nil {
		return nil, err
	}
	n, st := jsval.Num0, jsval.S
	items := make([]any, len(dt))
	for i, r := range dt {
		items[i] = omap.Of("ma", st(r.Val("ma_sp")), "ten", st(r.Val("ten_sp")), "thuongHieu", st(r.Val("thuong_hieu")),
			"phong", st(r.Val("phong")), "dvt", st(r.Val("dvt")), "sl", n(r.Val("so_luong")), "donGia", n(r.Val("don_gia")),
			"thanhTien", n(r.Val("thanh_tien")), "hinhAnh", st(r.Val("hinh_anh")))
	}
	return omap.Of(
		"maDon", st(h.Val("ma_don")), "project", st(h.Val("ten_du_an")), "maDA", st(h.Val("ma_du_an")), "supplier", st(h.Val("nha_cung_cap")),
		"hangMuc", st(h.Val("hang_muc")), "soSp", n(h.Val("so_sp")), "tongTruocVat", n(h.Val("tong_truoc_vat")), "vatPct", n(h.Val("vat_pct")),
		"vat", n(h.Val("vat")), "total", n(h.Val("tong_cong")), "status", st(h.Val("trang_thai")), "requester", st(h.Val("nguoi_gui")),
		"phongBan", st(h.Val("phong_ban")), "ghiChu", st(h.Val("ghi_chu")), "at", st(h.Val("ngay_gui")),
		"nguoiDuyet", st(h.Val("nguoi_duyet")), "ngayDuyet", st(h.Val("ngay_duyet")), "items", items,
		// khoá chỉ bản Go (M9.1), nối cuối
		"kenhGui", st(h.Val("kenh_gui")), "ketQuaGui", st(h.Val("ket_qua_gui"))), nil
}

// ngoac: x ? " (" + x + ")" : "".
func ngoac(v any) string {
	if jsval.Truthy(v) {
		return " (" + jsval.ToString(v) + ")"
	}
	return ""
}

// ResolvePurchaseRequest: duyệt / từ chối đơn, chỉ khi còn "Chờ duyệt" (A:643-655).
func (s *Service) ResolvePurchaseRequest(ctx context.Context, a *actor.Actor, maDon, approve any) (*omap.Map, error) {
	r, err := s.repo.OrderByCode(ctx, maDon)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, apperr.New(errKhongThayDon)
	}
	ok := jsval.Truthy(approve)
	status, kind, title, action := ttTuChoi, "purchase_rejected", "Đơn mua hàng bị từ chối", "reject_purchase"
	if ok {
		status, kind, title, action = ttDaDuyet, "purchase_approved", "Đơn mua hàng đã được duyệt", "approve_purchase"
	}
	// đổi có điều kiện: bấm 2 lần / 2 admin cùng duyệt không lật được kết quả
	n, err := s.repo.UpdateOrderStatus(ctx, maDon, ttChoDuyet, status)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apperr.New(errDonDaXuLy)
	}
	s.ghiNguoiDuyet(ctx, a, maDon)
	ma := jsval.ToString(maDon)
	if jsval.Truthy(r.Val("requester_id")) {
		s.notify.Notify(ctx, r.Val("requester_id"), kind, title, "Đơn "+ma+ngoac(r.Val("nha_cung_cap")), ma)
	}
	s.auditor.Audit(ctx, a, action, status+" đơn "+ma+" của "+jsval.ToString(jsval.Or(r.Val("nguoi_gui"), "")), nil)
	return omap.Of("ok", true), nil
}

// ghiNguoiDuyet (M15.1): lệnh RIÊNG, chạy sau khi đổi trạng thái thành công, ghi người duyệt (ho_ten || username như
// ResolveDeXuat; không đọc được tài khoản thì username của phiên) và thời điểm duyệt. Lỗi - kể cả database chưa chạy
// migration 0009 (42703 / PGRST204) - chỉ ghi log: việc duyệt đã xong, không được báo hỏng (ARCHITECTURE 10.4).
func (s *Service) ghiNguoiDuyet(ctx context.Context, a *actor.Actor, maDon any) {
	var resolver any = ""
	if a != nil {
		resolver = a.U
		if s.users != nil {
			me, err := s.users.GetByID(ctx, a.UID)
			if err != nil {
				logger.Error("mua hàng", "đọc người duyệt lỗi:", err.Error())
			} else if me != nil {
				resolver = jsval.Or(me.Val("ho_ten"), me.Val("username"))
			}
		}
	}
	patch := omap.Of("nguoi_duyet", resolver, "ngay_duyet", jsval.ToISOString(s.now()))
	if err := s.repo.PatchOrder(ctx, maDon, patch); err != nil {
		logger.Error("mua hàng", "ghi người duyệt lỗi:", err.Error())
	}
}

// SetPurchaseStatus: Đã duyệt -> Đã đặt hàng -> Đã nhận hàng, mỗi lần đúng 1 bước (A:660-666).
func (s *Service) SetPurchaseStatus(ctx context.Context, a *actor.Actor, maDon, status any) (*omap.Map, error) {
	key := jsval.ToString(status)
	truoc, ok := poBuoc[key]
	if !ok {
		src, proto := poBuocProto[key]
		if !proto {
			return nil, apperr.New(errTTKhongHopLe)
		}
		if src == "" {
			src = "function " + key + "() { [native code] }"
		}
		// Node lọc trang_thai theo mã nguồn hàm: không dòng nào khớp
		return nil, apperr.New(`Đơn phải ở trạng thái "` + src + `" mới chuyển sang "` + key + `"`)
	}
	n, err := s.repo.UpdateOrderStatus(ctx, maDon, truoc, status)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apperr.New(`Đơn phải ở trạng thái "` + truoc + `" mới chuyển sang "` + key + `"`)
	}
	s.auditor.Audit(ctx, a, "purchase_status", key+" — đơn "+jsval.ToString(maDon), nil)
	return omap.Of("ok", true, "status", status), nil
}
