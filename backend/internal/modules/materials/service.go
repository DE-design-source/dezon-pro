// Package materials: danh mục sản phẩm (db_san_pham) - đọc / thêm / sửa / xoá, duyệt, yêu thích, combo, biến thể,
// lịch sử, nhập hàng loạt, yêu cầu xoá, tải file và xuất Excel. Bản chuyển 1:1 của store_supa.js:26-220, 442-1003,
// 1031-1080, auth.js:466-569, 600-602 và index.js:652-687, 744-778.
package materials

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// Deps: Auditor / Users / UserFmt = users; Notifier / Admins = notifications; Uploader = platform/storage.
// Repo để trống thì dùng DB.
type Deps struct {
	DB       *database.DB
	Cfg      *config.Config
	Auditor  contracts.Auditor
	Users    contracts.UserReader
	UserFmt  contracts.UserFormatter
	Notifier contracts.Notifier
	Admins   contracts.AdminLister
	Uploader contracts.Uploader
	Repo     Repository
	// DuyetDelay > 0 (chỉ bản Go): gom thao tác thêm / sửa SP của tài khoản không phải admin trong khoảng này rồi báo
	// người duyệt 1 lần (notify_duyet.go). 0 = tắt (test golden không có thông báo này).
	DuyetDelay time.Duration
}

// Service: nghiệp vụ danh mục sản phẩm.
type Service struct {
	repo     Repository
	cfg      *config.Config
	aud      contracts.Auditor
	users    contracts.UserReader
	userFmt  contracts.UserFormatter
	notifier contracts.Notifier
	admins   contracts.AdminLister
	uploader contracts.Uploader
	db       *database.DB // D-13: mở transaction; nil (repo giả trong test unit) -> chạy thẳng

	// _cache / _cacheAt (S:157): danh mục theo từng công ty, xoá TOÀN BỘ khi có sản phẩm thay đổi
	mu      sync.Mutex
	cache   map[string][]any
	cacheAt map[string]float64

	// _hasWhoCol === false (S:488): đã biết database thiếu cột nguoi_tao / ngay_tao / nguoi_sua. Không bao giờ bật lại.
	whoColMissing atomic.Bool

	duyetDelay time.Duration
	duyetMu    sync.Mutex
	duyetPend  map[string]*duyetBatch
}

var (
	_ contracts.ProductPerms  = (*Service)(nil)
	_ contracts.ProductSaver  = (*Service)(nil)
	_ contracts.CatalogReader = (*Service)(nil)
	_ contracts.ProductLister = (*Service)(nil)
)

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = NewRepository(d.DB)
	}
	return &Service{repo: repo, cfg: d.Cfg, aud: d.Auditor, users: d.Users, userFmt: d.UserFmt,
		notifier: d.Notifier, admins: d.Admins, uploader: d.Uploader, db: d.DB,
		cache: map[string][]any{}, cacheAt: map[string]float64{},
		duyetDelay: d.DuyetDelay, duyetPend: map[string]*duyetBatch{}}
}

// tx: chạy fn trong 1 transaction (D-13). Không có DB (repo giả trong test unit) -> chạy thẳng.
// Việc phụ (lịch sử, audit, cacheClear) đặt SAU tx, không để trong fn.
// Bọc Tx làm khoá dòng giữ tới commit -> 2 người cùng sửa 1 nhóm biến thể / combo có thể deadlock (40P01; Postgres
// huỷ 1 bên, bên đó đã rollback sạch). KHÔNG tự chạy lại: ở READ COMMITTED lần chạy lại có thể đọc trước khi bên thắng
// commit, rồi ghi theo dữ liệu cũ, đè mất thay đổi bên kia (database chưa có SELECT ... FOR UPDATE để đọc có khoá).
// Bên bị huỷ nhận lỗi tiếng Việt (không lỗi DB thô), dữ liệu = chỉ bên thắng. Đang trong Tx ngoài thì trả nguyên lỗi
// để Tx ngoài quyết.
func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	err := s.db.Tx(ctx, fn)
	if laDeadlock(err) && !s.db.InTx(ctx) {
		return apperr.New(loiTranhChap)
	}
	return err
}

// loiTranhChap: lỗi trả về khi s.tx gặp deadlock (thao tác đã rollback, không thay đổi gì).
const loiTranhChap = "Có người khác đang sửa cùng các sản phẩm này nên thao tác chưa được lưu (không thay đổi gì). Tải lại trang rồi thử lại."

// laDeadlock: lỗi deadlock của Postgres (40P01).
func laDeadlock(err error) bool {
	var de *database.Error
	return errors.As(err, &de) && de.Code == "40P01"
}

// ckey = _ckey_ (S:166).
func ckey(ctx context.Context) string {
	return jsval.ToString(jsval.Or(tenant.TenantID(ctx), "_all"))
}

// cacheClear = _cacheClear_ (S:167): xoá cache của MỌI công ty.
func (s *Service) cacheClear() {
	s.mu.Lock()
	s.cache, s.cacheAt = map[string][]any{}, map[string]float64{}
	s.mu.Unlock()
}

// logAudit = logAudit_ (S:587-594) / audit (A:59-69): nuốt lỗi, chạy đồng bộ.
func (s *Service) logAudit(ctx context.Context, a *actor.Actor, action, detail string) {
	if s.aud != nil {
		s.aud.Audit(ctx, a, action, detail, nil)
	}
}

func actorUID(a *actor.Actor) any {
	if a != nil && jsval.Truthy(a.UID) {
		return a.UID
	}
	return nil
}

// actorName = (actor && actor.u) || def.
func actorName(a *actor.Actor, def string) string {
	if a != nil && a.U != "" {
		return a.U
	}
	return def
}

func isDigits(s string) bool { // /^\d+$/
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// keyFilter: khoá toàn chữ số LUÔN là id dòng, còn lại là mã sản phẩm (S:204, 600, 756).
func keyFilter(test string, key any) string {
	if isDigits(test) {
		return database.Eq("id", key)
	}
	return database.Eq("ma_sp", key)
}

// guardSpChung = guardSpChung_ (S:202-208): chặn sửa / xoá sản phẩm của công ty khác (kho chung).
func (s *Service) guardSpChung(ctx context.Context, key any) error {
	t := tenant.TenantID(ctx)
	if !jsval.Truthy(t) { // super admin: cho phép
		return nil
	}
	rows, err := s.repo.Select(ctx, "db_san_pham", database.SelectOpt{Select: "id,cong_ty_id",
		Filter: keyFilter(jsval.ToString(key), key), Order: "id.asc", Limit: 1, NoScope: true})
	if err != nil {
		return err
	}
	if len(rows) > 0 && jsval.ToString(rows[0].Val("cong_ty_id")) != jsval.ToString(t) {
		return apperr.New(loiKhoChung)
	}
	return nil
}

// ───────────── Quyền sửa / duyệt sản phẩm (A:517-527) ─────────────

// SpPerms = spPerms_ (A:517-526), dạng 3 cờ của contracts.ProductPerms.
func (s *Service) SpPerms(ctx context.Context, a *actor.Actor) (edit, duyet, admin bool, err error) {
	if a == nil {
		return false, false, false, nil
	}
	if a.R == "admin" || a.R == "super" {
		return true, true, true, nil
	}
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return false, false, false, err
	}
	var perms any
	if u != nil {
		perms = u.Val("perms")
	}
	hasEdit, hasDuyet := false, false
	for _, p := range s.userFmt.PermsArr(perms) {
		switch p {
		case "sp_edit":
			hasEdit = true
		case "sp_duyet":
			hasDuyet = true
		}
	}
	// Chưa cấu hình gì -> giữ như cũ: sửa + duyệt (tránh khoá tài khoản đang dùng)
	if !hasEdit && !hasDuyet {
		return true, true, false, nil
	}
	return hasDuyet || hasEdit, hasDuyet, false, nil
}

// SpMyPerms = spMyPerms (A:527): {edit, duyet} và thêm admin: true với admin / super.
func (s *Service) SpMyPerms(ctx context.Context, a *actor.Actor) (*omap.Map, error) {
	edit, duyet, admin, err := s.SpPerms(ctx, a)
	if err != nil {
		return nil, err
	}
	out := omap.Of("edit", edit, "duyet", duyet)
	if admin {
		out.Set("admin", true)
	}
	return out, nil
}
