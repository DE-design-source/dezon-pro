// Package contracts: interface gọi chéo giữa các module (PORTING_MAP mục C, D).
//
// Luật: module CHỦ cài interface bằng phương thức của *Service với chữ ký ĐÚNG như dưới đây; module DÙNG nhận
// interface qua Deps của nó; internal/server/routes.go nối lại. Gói này chỉ import omap, actor và thư viện chuẩn.
// Giá trị trao đổi theo JS value model: object là *omap.Map, mảng là []any (phần tử *omap.Map / string / float64...).
// Chú thích dòng: S = server/store_supa.js, A = server/auth.js, I = server/index.js, X = server/export.js.
//
// sessionActor (A:43-56) đã có interface riêng: middleware.SessionResolver (module auth cài) - không lặp lại ở đây.
package contracts

import (
	"context"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

// Auditor - chủ: users. Gộp audit (A:59-69) và logAudit_ (S:587-594): cùng một dạng dòng audit_log.
//
// Ghi 1 dòng {user_id, username, action, detail[, cong_ty_id]} bằng insert CÓ phạm vi công ty của ctx:
//   - user_id = a.UID nếu truthy, ngược lại null; username = a.U, a == nil -> "".
//     a có thể là actor "khuyết": login thất bại truyền &actor.Actor{U: username}, job truyền &actor.Actor{R: "super"}.
//   - congTyID truthy -> thêm khoá cong_ty_id (login chạy ngoài ngữ cảnh công ty, A:237, 254); nơi khác truyền nil.
//     logAudit_ của store không có tham số này -> truyền nil.
//   - NUỐT mọi lỗi, không log, không panic, không trả gì: nhật ký không được làm hỏng nghiệp vụ.
//   - Chạy ĐỒNG BỘ (Node await): trả về sau khi insert xong, nên thứ tự so với thao tác DB kế tiếp được giữ.
//
// Nơi gọi tự ghép chuỗi action / detail (String(x || "") của Node đã nằm ở nơi gọi vì mọi nơi đều truyền chuỗi).
type Auditor interface {
	Audit(ctx context.Context, a *actor.Actor, action, detail string, congTyID any)
}

// UserReader - chủ: users. getUserById (A:212-215).
//
// Đọc bảng users theo id, noScope, limit 1. Trả DÒNG THÔ của database (khoá tên cột: id, username, ho_ten,
// password_hash, role, perms, active, cong_ty_id, email, phong_ban, ui_prefs, created_at, last_login...).
// Không có dòng -> (nil, nil). Lỗi database trả nguyên (nơi gọi không nuốt).
type UserReader interface {
	GetByID(ctx context.Context, id any) (*omap.Map, error)
}

// UserFormatter - chủ: users. userOut (A:73-77) và permsArr_ (A:72). Hàm thuần, không đọc database.
//
// UserOut đổi dòng thô users thành object cho client, khoá theo thứ tự:
// id, username, hoTen, role, perms, active, createdAt, lastLogin, congTyId, email, phongBan.
// Mỗi lần gọi trả một map MỚI (auth gắn thêm uiPrefs / congTy vào đó, A:255, 261-262). row không được nil.
//
// PermsArr = String(v || "").split(",") -> trim -> bỏ phần tử rỗng; trả []any gồm string, không bao giờ nil
// (ra JSON là [] chứ không phải null).
type UserFormatter interface {
	UserOut(row *omap.Map) *omap.Map
	PermsArr(v any) []any
}

// UserCreator - chủ: users. adminCreateUser (A:319-362).
//
// data theo khoá của client (username, password, role, perms, hoTen, email, phongBan, congTyId); nil coi như {}.
// Công ty của tài khoản mới: super có data.congTyId -> lấy nó; ngược lại tenant.TenantID(ctx) || a.CT (A:329-330),
// nên ctx phải mang ngữ cảnh công ty của request. Trả userOut của dòng vừa tạo; đã tự ghi audit "create_user".
// Lỗi kiểm tra (tên đăng nhập, mật khẩu, trùng tên, vượt giới hạn gói...) trả nguyên văn của Node.
// a không được nil.
type UserCreator interface {
	AdminCreateUser(ctx context.Context, a *actor.Actor, data *omap.Map) (*omap.Map, error)
}

// SessionInvalidator - chủ: auth. forgetSession_ (A:39) + thu hồi phiên (M1.2).
//
// ForgetSession: xoá mục cache phiên của String(uid) (cache 30 giây của sessionActor). Không đụng database, không lỗi,
// an toàn khi gọi song song. users gọi sau khi sửa / khoá / xoá tài khoản (A:407, 422, 431).
//
// RevokeUserSessions: xoá mọi phiên đăng nhập (bảng phien_dang_nhap) của uid trừ phiên keep ("" -> tất cả) và bỏ cache
// của chúng -> token đang giữ hết hiệu lực ngay. users gọi sau khi admin đặt lại mật khẩu. Thiếu bảng phiên ->
// *middleware.SessionStoreError.
type SessionInvalidator interface {
	ForgetSession(uid any)
	RevokeUserSessions(ctx context.Context, uid any, keep string) error
}

// CompanyReader - chủ: companies. getCongTy (A:107-111), hetHan_ (A:42, dùng todayVN_ A:41).
//
// GetCongTy: id falsy -> (nil, nil) KHÔNG đọc database; ngược lại đọc cong_ty noScope, limit 1 và trả ctOut_
// (A:100-106) với khoá: id, ten, ma, logoUrl, mauChinh, tinhNang ([]any string), gioiHanUser (float64), active (bool),
// hanDung, ghiChu, ngayTao, email, sdt, dungSpDezon (bool). Không có dòng -> (nil, nil).
//
// HetHan: !!(ct && ct.hanDung && String(ct.hanDung).slice(0, 10) < hôm nay theo giờ VN "YYYY-MM-DD") - so CHUỖI;
// ct nil -> false. Hàm thuần (chỉ đọc đồng hồ).
type CompanyReader interface {
	GetCongTy(ctx context.Context, id any) (*omap.Map, error)
	HetHan(ct *omap.Map) bool
}

// Notifier - chủ: notifications. notify_ (A:451-454).
//
// userID falsy -> không làm gì. Ngược lại insert notifications {user_id, kind, title, body, ref_id, is_read: false}
// (có phạm vi công ty của ctx); title / body rỗng giữ ""; refID falsy (nil, "", 0) -> null, ngược lại ghi nguyên giá trị
// (nơi gọi tự String(...) khi Node làm vậy: A:612, 652, 677, 706; A:475, 499, 503 truyền id dạng số).
// NUỐT lỗi insert (chỉ log "[notify] insert lỗi:"), không trả gì. Chạy đồng bộ.
type Notifier interface {
	Notify(ctx context.Context, userID any, kind, title, body string, refID any)
}

// AdminLister - chủ: notifications. getAdmins_ (A:450).
//
// Đọc users có role = admin THEO phạm vi công ty của ctx, không limit, rồi bỏ dòng active === false.
// Super không có viewAs -> admin của MỌI công ty (PORTING_MAP F60). Trả []any gồm *omap.Map dòng thô users
// (nơi gọi chỉ dùng khoá id), không bao giờ nil. Lỗi database trả nguyên.
type AdminLister interface {
	ActiveAdmins(ctx context.Context) ([]any, error)
}

// PurchaseNotifier - chủ: notifications. notifyPurchaseAdmins (A:605-616), notifyDeXuatAdmins (A:670-680), DX_TEN (A:669).
//
// NotifyPurchaseAdmins: orders nil coi như []; mỗi phần tử là *omap.Map {maDon, supplier} (I:304). Với mỗi đơn x mỗi
// admin đang hoạt động gửi thông báo kind "purchase_request" (refId = String(maDon)), rồi audit "request_purchase".
// NotifyDeXuatAdmins: dx = {ma, loai, supplier} (I:281); kind "de_xuat" (refId = String(ma)), rồi audit "request_de_xuat".
// Cả hai: a không được nil (đọc a.UID); lỗi đọc users được TRẢ VỀ - nơi gọi (purchasing, I:280-282, 301-306) tự nuốt và log.
//
// DeXuatTen = DX_TEN[loai] || "đề xuất": "ck" -> "đề xuất chiết khấu", "tt" -> "đề xuất thanh toán", còn lại -> "đề xuất"
// (đã gồm giá trị mặc định của A:674, 703; nơi gọi không cần || thêm).
type PurchaseNotifier interface {
	NotifyPurchaseAdmins(ctx context.Context, a *actor.Actor, orders []any) error
	NotifyDeXuatAdmins(ctx context.Context, a *actor.Actor, dx *omap.Map) error
	DeXuatTen(loai string) string
}

// ProductPerms - chủ: materials. spPerms_ (A:517-526).
//
// Ba dạng kết quả của Node gói vào 3 cờ:
//   - a == nil                      -> edit=false, duyet=false, admin=false   ({edit:false, duyet:false})
//   - a.R là "admin" hoặc "super"   -> true, true, true                       ({edit, duyet, admin:true}); không đọc database
//   - còn lại: đọc perms của users  -> admin=false; chưa cấu hình sp_edit lẫn sp_duyet -> edit=true, duyet=true;
//     ngược lại duyet = có sp_duyet, edit = duyet || có sp_edit.
//
// Lỗi đọc users trả nguyên. Nơi gọi (takeoff A:548, estimates A:575-590) chỉ dùng edit / duyet và tự ném thông báo riêng.
// Khoá "admin" chỉ có mặt trong JSON của spMyPerms khi admin == true (materials tự dựng object).
type ProductPerms interface {
	SpPerms(ctx context.Context, a *actor.Actor) (edit, duyet, admin bool, err error)
}

// ProductSaver - chủ: materials. saveDbProduct (S:503-560).
//
//   - a có thể nil (saveLineAsProduct không kèm actor, S:956): khi đó không đóng dấu nguoi_tao / nguoi_sua, lịch sử ghi "ẩn danh".
//   - data: khoá là NHÃN tiếng Việt của DB_LABEL2COL ("TÊN SẢN PHẨM", "MÃ SẢN PHẨM"...), duyệt theo thứ tự khoá của map;
//     giá trị nil / Undefined / "" bị bỏ qua. nil coi như {}. Bước hoán đổi tham số saveDbProduct(data) (S:506) là việc của
//     handler rpc của materials, KHÔNG thuộc hợp đồng này: nơi gọi luôn truyền đủ (a, data).
//   - opts: nil coi như {}; khoá được đọc: noAudit (truthy -> không ghi audit), macDinh (*omap.Map cột -> giá trị, chỉ áp khi TẠO MỚI).
//
// Trả {updated: true, ma, ten, id} hoặc {created: true, ma, ten, id}. Lỗi: "Chưa có Tên sản phẩm." và lỗi database đã qua colErr_.
// Tác dụng phụ: xoá cache danh mục của MỌI công ty, ghi db_san_pham_history và audit (lỗi của hai việc này bị nuốt).
type ProductSaver interface {
	SaveDbProduct(ctx context.Context, a *actor.Actor, data *omap.Map, opts *omap.Map) (*omap.Map, error)
}

// CatalogReader - chủ: materials. getProductsCached (S:209-213).
//
// Danh mục sản phẩm của công ty trong ctx (khoá cache = String(tenantId || "_all")), giữ 5 phút, xoá khi có sản phẩm thay đổi;
// hết hạn thì gọi getProducts. Phần tử là *omap.Map dạng prodToObj. Slice trả về là CHÍNH bản trong cache (Node trả cùng
// một mảng): nơi gọi chỉ đọc, không sửa phần tử, không sort / append tại chỗ.
type CatalogReader interface {
	GetProductsCached(ctx context.Context) ([]any, error)
}

// ProductLister - chủ: materials. getProducts (S:177-200).
//
// Luôn đọc lại database (kèm kho chung Dezon, đóng dấu yeuThich / comboN) và GHI ĐÈ cache của công ty trong ctx.
// Dùng cho xuất Excel danh sách sản phẩm (I:654: lọc theo String(p.recordId) hoặc String(p.ma)).
// Cùng quy ước chỉ-đọc như CatalogReader.
type ProductLister interface {
	GetProducts(ctx context.Context) ([]any, error)
}

// LineReader - chủ: takeoff. getLines (S:331-334).
//
// Dòng bóc tách của dự án maDA (bảng db_bao_gia, có phạm vi công ty, order sort_no.asc, limit LIM = 20000, có cảnh báo chạm trần).
// Phần tử là *omap.Map dạng lineToObj (S:315-330); không có dòng -> slice rỗng khác nil. Lỗi database trả nguyên:
// bootstrap (S:1020) tự nuốt thành [], getQuote (S:1007) và buildCoverFromTemplate (S:417) thì không.
// Nơi gọi tự quyết định có gọi hay không khi maDA falsy (S:417, 1020).
type LineReader interface {
	GetLines(ctx context.Context, maDA any) ([]any, error)
}

// ProjectReader - chủ: projects. getProject (S:236-239).
//
// Đọc du_an theo ma_da (có phạm vi công ty, limit 1), trả projToObj (S:227-231: maDA, ngayTao, capNhat rồi các khoá PROJ_MAP;
// vat và tienDo là float64, còn lại string). Không có -> (nil, nil) (JSON null).
type ProjectReader interface {
	GetProject(ctx context.Context, maDA any) (*omap.Map, error)
}

// MediaDownloader - chủ: files. lark.mediaDownload (lark.js:25-32).
//
// Tải 1 file_token từ Lark (tự lấy / giữ tenant_access_token). contentType = header content-type của Lark,
// thiếu -> "application/octet-stream". Lỗi: "Thiếu LARK_APP_ID / LARK_APP_SECRET", "Lấy tenant_access_token lỗi: ...",
// "Tải media lỗi HTTP <status>", lỗi mạng. Nơi gọi tự xử lý: /media trả 502 (I:644), fetchImage bỏ qua ảnh (X:353).
// fileToken là giá trị ĐÃ giải mã (X:333 gọi decodeURIComponent trước); hàm tự encodeURIComponent khi ghép URL.
type MediaDownloader interface {
	MediaDownload(ctx context.Context, fileToken string) (buf []byte, contentType string, err error)
}

// Uploader - chủ: platform/storage (*storage.Client đã khớp sẵn). Thay uploadToStorage (supa.js:461-469).
//
// Ghi buf vào kho trên đĩa (UPLOAD_DIR/<path>, ghi đè nếu trùng tên). Trả URL công khai tương đối "/files/<path>"
// (từng đoạn của path qua encodeURIComponent). contentType không được lưu: khi phục vụ, kiểu lấy theo đuôi file.
// Path không hợp lệ -> "Đường dẫn file không hợp lệ"; lỗi đĩa -> "Không lưu được file lên máy chủ" (chi tiết ghi log).
type Uploader interface {
	Upload(ctx context.Context, buf []byte, path, contentType string) (url string, err error)
}

// FileReader - chủ: platform/storage (*storage.Client). Đọc file của kho theo URL công khai "/files/<path>"
// (URL tương đối nên máy chủ không tải qua HTTP được).
//
// ReadURL: URL không thuộc kho, đường dẫn sai / leo khỏi kho, không có file hoặc lớn hơn max byte -> lỗi.
type FileReader interface {
	ReadURL(url string, max int64) ([]byte, error)
}

// ReportRunner - chủ: reports. baoCaoNhapSP (I:451-552), daGuiBaoCaoHomNay_ (I:554-564).
//
// BaoCaoNhapSP: a không được dùng tới trong thân hàm (job truyền &actor.Actor{R: "super"}); opts nil coi như {}, khoá được đọc:
// tuVN, dryRun. Mọi truy vấn là noScope nên ctx không cần ngữ cảnh công ty. Kết quả luôn có sent (bool) và count (float64);
// có message khi không gửi (I:456, 462, 463, 468); các dạng khác xem PORTING_MAP F65. Lỗi đọc database, webhook, audit đều bị
// nuốt hoặc đổi thành message bên trong (I:462, 472, 478, 541, 549) nên err khác nil chỉ dành cho lỗi bất ngờ; job chỉ log nó (I:575).
//
// DaGuiHomNay: trong 5 dòng audit_log mới nhất có action "bao_cao_nhap_sp" nào thuộc hôm nay (giờ VN) không; mọi lỗi -> false.
type ReportRunner interface {
	BaoCaoNhapSP(ctx context.Context, a *actor.Actor, opts *omap.Map) (*omap.Map, error)
	DaGuiHomNay(ctx context.Context) bool
}
