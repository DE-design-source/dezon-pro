// Package chat: nhắn tin giai đoạn MVP (backend/CHAT.md): đăng nhập bằng số điện thoại hoặc email + OTP, danh bạ / kết bạn / chặn,
// chat 1-1 và nhóm (văn bản), đã gửi / đã nhận / đã xem, online + truy cập lần cuối, đang soạn tin, push (Web Push),
// đồng bộ khi offline. Tính năng mới, chỉ bản Go: REST /api/v1/chat/... (route chỉ bản Go, quyền rpc.SelfAuth) +
// WebSocket /api/v1/chat/ws (gói realtime, gắn qua SetGateway).
//
// Tài khoản chat là bảng riêng chat_users (danh tính = số điện thoại HOẶC email, 0019_chat_email.sql), KHÔNG phải users của QS và KHÔNG thuộc công ty
// (dùng chung mọi công ty như Zalo): access token JWT HS256 + refresh token xoay vòng của chính module, phiên QS không
// dùng được ở đây và ngược lại - trừ POST /chat/auth/dezon: phiên QS đổi lấy phiên chat của tài khoản chat gắn với users.id
// (chat_users.qs_user_id, 0045, service_dezon.go).
//
// Truy cập dữ liệu: SQL thô qua database.DB.Pool() (pgx, transaction riêng) với tên bảng / cột tiếng Anh. Lớp
// database.DB kiểu PostgREST không diễn đạt được "last_seq = last_seq + 1 RETURNING", GREATEST(...), upsert hay các câu
// nối của danh sách hội thoại, và bảng chat không phải bảng theo công ty (không lọc tenant) - xem infra/db/migrations/0018_chat.sql.
// Pool chạy simple protocol nên mọi tham số mảng / thời điểm / boolean đều ép kiểu tường minh trong SQL ($1::bigint[] ...).
package chat

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/modules/chat/realtime"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/contracts"
)

// Gateway: WebSocket gateway (*realtime.Hub). nil = chưa bật realtime: REST vẫn chạy, phân phối tin chạy đồng bộ
// (chỉ còn phần push).
type Gateway interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request)
	SendToUsers(userIDs []int64, typ string, data any)
	OnlineUsers(userIDs []int64) map[int64]bool
	CloseDevice(deviceID int64)
	RevokePresence(viewer int64, targets []int64)
	Submit(key int64, job func()) bool
	Shutdown(ctx context.Context)
}

// SMSSender gửi tin nhắn SMS (mã OTP). nil = logSender (ghi mã vào log server).
type SMSSender interface {
	Send(ctx context.Context, phone, text string) error
}

// MailSender gửi email (mã OTP; *mailer.Client của platform/mailer). nil = logMailer (ghi mã vào log server).
type MailSender interface {
	Send(ctx context.Context, to, subject, text, html string) error
}

// PushSender gửi Web Push (*webpush.Client). nil = tắt push.
type PushSender interface {
	PublicKey() string
	Send(ctx context.Context, subscriptionJSON string, payload []byte, ttl int, urgency, topic string) (int, bool, error)
}

// Deps: do internal/server/routes.go truyền vào.
type Deps struct {
	DB   *database.DB
	Cfg  *config.Config
	SMS  SMSSender  // nil = logSender
	Mail MailSender // nil = logMailer
	Push PushSender // nil = tắt push
	// Media: kho tệp S3 (*objstore.Client); nil = tắt gửi ảnh / tệp (route tệp trả MEDIA_DISABLED).
	// Phải là nil interface thật, không phải con trỏ nil bọc trong interface.
	Media MediaStore
	Scan  MediaScanner // nil = logScanner (chưa quét virus, coi như sạch)
	// Users / UserFmt: đọc tài khoản Dezon Pro cho POST /chat/auth/dezon (module users); nil = route đó trả 500.
	Users   contracts.UserReader
	UserFmt contracts.UserFormatter
	Now     func() time.Time
}

// Service: nghiệp vụ chat.
type Service struct {
	db   *database.DB
	sms  SMSSender
	mail MailSender
	push PushSender
	now  func() time.Time

	users   contracts.UserReader    // đăng nhập bằng tài khoản Dezon Pro (service_dezon.go)
	userFmt contracts.UserFormatter // PermsArr của users.perms

	media         MediaStore   // nil = tắt tệp
	scan          MediaScanner // không nil khi media != nil
	mediaMaxImage int64        // byte, CHAT_MEDIA_MAX_IMAGE_MB
	mediaMaxFile  int64        // byte, CHAT_MEDIA_MAX_FILE_MB (video + tệp)
	mediaDaily    int64        // byte / người / 24 giờ, CHAT_MEDIA_DAILY_MB
	mediaURLTTL   time.Duration
	uploadLimit   *limiter       // upload-url: 60 lần / phút / người
	imgSem        chan struct{}  // giới hạn số ảnh giải mã cùng lúc
	mediaQuit     chan struct{}  // đóng khi Shutdown: dừng janitor
	mediaWG       sync.WaitGroup // janitor

	jwtKey     []byte
	otpKey     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
	otpDev     bool

	gwMu sync.RWMutex
	gw   Gateway

	devMu  sync.Mutex
	devHit map[int64]devEntry // thiết bị -> chủ, cache 30 giây cho middleware / gói auth
	devGen uint64             // tăng mỗi lần bỏ cache thiết bị (như memGen)

	memMu   sync.Mutex
	members map[int64]memberEntry // hội thoại -> thành viên đang hoạt động, cache 30 giây (typing + phân phối)
	memGen  uint64                // tăng mỗi lần bỏ cache: lượt đọc bắt đầu trước đó không được ghi vào cache

	friendLimit *limiter // 30 lời mời / giờ / người
	sendLimit   *limiter // 20 tin / giây / người
	searchLimit *limiter // tra số điện thoại / email, đồng bộ danh bạ: 60 lần / phút / người
	matchLimit  *limiter // số điện thoại / email / hash được tra: 5000 / ngày / người (mỗi số 1 lượt; chống dò cả dải số)
	directLimit *limiter // mở chat 1-1 MỚI với người chưa là bạn: 30 lần / giờ / người

	// Giai đoạn 2 (dto_phase2.go). Chuyển tiếp dùng sendLimit (mỗi đích 1 lượt).
	editLimit      *limiter // sửa + thu hồi tin: 30 lần / phút / người
	reactLimit     *limiter // đặt / bỏ reaction: 60 lần / phút / người
	msgSearchLimit *limiter // tìm tin: 30 lần / phút / người
	qrPollLimit    *limiter // poll phiên QR: 3 lần / 3 giây / qr_id (client poll mỗi 2 giây)
	qrScanLimit    *limiter // quét / gõ mã QR (kể cả sai): 20 lần / phút / người
	dezonLimit     *limiter // POST /chat/auth/dezon: 30 lần / 10 phút / tài khoản Dezon Pro

	pushQ       chan pushJob
	pushStartMu sync.Mutex
	pushStarted bool // worker push đã chạy (khởi động lười ở lần push đầu)
	pushStopped bool // đã Shutdown: không khởi động worker nữa
	pushQuit    chan struct{}
	pushWG      sync.WaitGroup
	pushMu      sync.Mutex
	pushLast    map[[2]int64]time.Time // (người nhận, hội thoại) -> lần push gần nhất (gộp tin trong 3 giây)
	pushDrops   int64                  // thông báo bị bỏ vì hàng đợi đầy, chưa ghi log
	pushDropLog time.Time              // lần ghi log "hàng đợi push đầy" gần nhất
	pushRetry   []time.Duration        // chờ trước mỗi lần thử lại (test rút ngắn)
	shutOnce    sync.Once
}

// *Service là Backend của WebSocket gateway.
var _ realtime.Backend = (*Service)(nil)

const (
	devCacheTTL    = 30 * time.Second
	memberCacheTTL = 30 * time.Second
)

// New tạo service. Khoá JWT: CHAT_JWT_SECRET, trống thì hex(HMAC-SHA256(AUTH_SECRET, "qspro-chat-jwt")).
func New(d Deps) *Service {
	cfg := d.Cfg
	if cfg == nil {
		cfg = &config.Config{}
	}
	now := d.Now
	if now == nil {
		now = time.Now
	}
	secret := cfg.ChatJWTSecret
	if secret == "" {
		secret = hmacHex([]byte(cfg.AuthSecret), "qspro-chat-jwt")
	}
	accessMin, refreshDays := cfg.ChatAccessTTLMin, cfg.ChatRefreshTTLDays
	if !(accessMin > 0) {
		accessMin = 15
	}
	if !(refreshDays > 0) {
		refreshDays = 30
	}
	s := &Service{
		db: d.DB, sms: d.SMS, mail: d.Mail, push: d.Push, now: now, users: d.Users, userFmt: d.UserFmt,
		jwtKey:     []byte(secret),
		otpKey:     []byte(hmacHex([]byte(secret), "qspro-chat-otp")),
		accessTTL:  time.Duration(accessMin * float64(time.Minute)),
		refreshTTL: time.Duration(refreshDays * 24 * float64(time.Hour)),
		otpDev:     cfg.ChatOTPDev,
		devHit:     map[int64]devEntry{},
		members:    map[int64]memberEntry{},

		friendLimit: newLimiter(30, time.Hour, now),
		sendLimit:   newLimiter(20, time.Second, now),
		searchLimit: newLimiter(60, time.Minute, now),
		matchLimit:  newLimiter(matchPerDay, 24*time.Hour, now),
		directLimit: newLimiter(30, time.Hour, now),

		editLimit:      newLimiter(30, time.Minute, now),
		reactLimit:     newLimiter(60, time.Minute, now),
		msgSearchLimit: newLimiter(30, time.Minute, now),
		qrPollLimit:    newLimiter(3, 3*time.Second, now),
		qrScanLimit:    newLimiter(20, time.Minute, now),
		dezonLimit:     newLimiter(30, dezonLimitPer, now),

		pushQ:     make(chan pushJob, 1000),
		pushQuit:  make(chan struct{}),
		pushLast:  map[[2]int64]time.Time{},
		pushRetry: []time.Duration{time.Second, 5 * time.Second},
	}
	if s.sms == nil {
		s.sms = logSender{}
	}
	if s.mail == nil {
		s.mail = logMailer{}
	}
	if s.otpDev {
		logger.Info("chat", "CHAT_OTP_DEV=1: API trả luôn mã OTP (chỉ dùng khi thử ở máy)")
	}
	s.initMedia(d, cfg)
	return s
}

// initMedia: giới hạn tệp từ config (trống / sai -> mặc định), bộ quét, janitor (chỉ khi có kho tệp).
func (s *Service) initMedia(d Deps, cfg *config.Config) {
	mb := func(v float64, def int64) int64 {
		if v > 0 {
			return int64(v * (1 << 20))
		}
		return def
	}
	s.mediaMaxImage = mb(cfg.ChatMediaMaxImageMB, mediaMaxImageBytesD)
	s.mediaMaxFile = min(mb(cfg.ChatMediaMaxFileMB, mediaMaxFileBytesD), mediaHardMaxBytes)
	s.mediaMaxImage = min(s.mediaMaxImage, mediaHardMaxBytes)
	s.mediaDaily = mb(cfg.ChatMediaDailyMB, mediaDailyBytesD)
	s.mediaURLTTL = mediaURLTTLD
	if cfg.ChatMediaURLTTLMin > 0 {
		s.mediaURLTTL = time.Duration(min(max(cfg.ChatMediaURLTTLMin, 5), 720) * float64(time.Minute))
	}
	s.uploadLimit = newLimiter(mediaUploadPerMin, time.Minute, s.now)
	s.imgSem = make(chan struct{}, mediaImgConc)
	s.mediaQuit = make(chan struct{})
	s.media, s.scan = d.Media, d.Scan
	if s.media == nil {
		return
	}
	if s.scan == nil {
		s.scan = logScanner{}
		noteLogScanner()
	}
	s.startMediaJanitor()
}

func hmacHex(key []byte, msg string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(msg))
	return hex.EncodeToString(h.Sum(nil))
}

// SetGateway gắn WebSocket gateway (nối ở routes.go sau khi dựng hub với Backend = service này).
func (s *Service) SetGateway(g Gateway) {
	s.gwMu.Lock()
	s.gw = g
	s.gwMu.Unlock()
}

func (s *Service) gateway() Gateway {
	s.gwMu.RLock()
	defer s.gwMu.RUnlock()
	return s.gw
}

// Shutdown (sau khi HTTP đã dừng nhận request): đóng gateway - kết nối (nếu routes chưa Drain trước) rồi bộ chạy phân
// phối, chạy nốt tin đang xếp hàng (kể cả việc xếp push) - rồi mới dừng worker push. Gọi nhiều lần cũng được.
func (s *Service) Shutdown(ctx context.Context) {
	s.shutOnce.Do(func() {
		if g := s.gateway(); g != nil {
			g.Shutdown(ctx)
		}
		s.pushStartMu.Lock()
		s.pushStopped = true
		s.pushStartMu.Unlock()
		close(s.pushQuit)
		close(s.mediaQuit)
		done := make(chan struct{})
		go func() { s.pushWG.Wait(); s.mediaWG.Wait(); close(done) }()
		select {
		case <-done:
		case <-ctx.Done():
		}
	})
}

// online: người đang có kết nối WebSocket (không có gateway -> không ai online).
func (s *Service) online(ids []int64) map[int64]bool {
	g := s.gateway()
	if g == nil || len(ids) == 0 {
		return map[int64]bool{}
	}
	m := g.OnlineUsers(ids)
	if m == nil {
		return map[int64]bool{}
	}
	return m
}

// revokePresence: viewer thôi được xem trạng thái online của targets - gateway gỡ đăng ký presence đang có.
func (s *Service) revokePresence(viewer int64, targets []int64) {
	if g := s.gateway(); g != nil && viewer > 0 && len(targets) > 0 {
		g.RevokePresence(viewer, targets)
	}
}

// sendTo đẩy 1 gói tới mọi kết nối của các người dùng (không có gateway -> bỏ).
func (s *Service) sendTo(ids []int64, typ string, data any) {
	if g := s.gateway(); g != nil && len(ids) > 0 {
		g.SendToUsers(ids, typ, data)
	}
}
