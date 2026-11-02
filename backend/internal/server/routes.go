package server

import (
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/modules/auth"
	"qspro-backend/internal/modules/categories"
	"qspro-backend/internal/modules/chat"
	"qspro-backend/internal/modules/chat/realtime"
	"qspro-backend/internal/modules/companies"
	"qspro-backend/internal/modules/delivery"
	"qspro-backend/internal/modules/estimates"
	"qspro-backend/internal/modules/files"
	"qspro-backend/internal/modules/materials"
	"qspro-backend/internal/modules/notifications"
	"qspro-backend/internal/modules/projects"
	"qspro-backend/internal/modules/purchasing"
	"qspro-backend/internal/modules/quotations"
	"qspro-backend/internal/modules/reports"
	"qspro-backend/internal/modules/sales"
	"qspro-backend/internal/modules/system"
	"qspro-backend/internal/modules/takeoff"
	"qspro-backend/internal/modules/users"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/platform/mailer"
	"qspro-backend/internal/platform/webpush"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/response"
)

// Module: mẫu chung của một module nghiệp vụ (internal/modules/<tên>).
//   - RegisterRPC:    đăng ký các hàm /api/:fn (tên + quyền giữ nguyên như REGISTRY của Node)
//   - RegisterRoutes: gắn route REST dưới /api/v1 (group đã có Auth + Tenant; quyền gắn theo từng route)
type Module interface {
	RegisterRPC(reg *rpc.Registry)
	RegisterRoutes(v1 *gin.RouterGroup)
}

// RootModule: module có thêm route LẺ ở gốc (không nằm dưới /api), vd /export/san-pham, /upload/file, /media.
// root đã có Auth + Tenant như v1 (trừ route công khai trong publicRoot: không tra phiên); đường dẫn giữ nguyên như server Node.
type RootModule interface {
	RegisterRoot(root *gin.RouterGroup)
}

// publicRoot: route lẻ không cần đăng nhập của server/index.js (635-646, 797-829).
var publicRoot = map[string]bool{
	"/media":                          true,
	"/mau-nhap-thiet-bi-ve-sinh.xlsx": true,
	"/mau-nhap-cong-tac-o-cam.xlsx":   true,
	"/mau-nhap-son-nuoc.xlsx":         true,
}

func (s *Server) routes() {
	d, e := s.deps, s.engine

	e.GET("/healthz", func(c *gin.Context) {
		response.JSON(c, 200, struct {
			OK bool `json:"ok"`
		}{true})
	})

	// Cổng tương thích với giao diện hiện tại
	e.POST("/api/:fn", d.Reg.Handle(d.Sessions, d.Cfg.AppVer))

	// REST: xác định người đăng nhập + ngữ cảnh công ty cho mọi route; chặn theo quyền ở từng route
	// (middleware.RequireLogin / RequireAdmin / RequireSuper).
	// AppVer đứng đầu: mọi response REST (kể cả 401/403) có x-app-ver như cổng /api/:fn (M1.1).
	v1 := e.Group("/api/v1", middleware.AppVer(d.Cfg.AppVer), middleware.Auth(d.Sessions), middleware.Tenant())
	// Route lẻ: /media và 3 file mẫu là CÔNG KHAI ở Node (không gọi actorOf_) nên không tra phiên đăng nhập
	// (không đụng database, không ghi log lỗi phiên); các route còn lại tra như v1.
	rootAuth := middleware.Auth(d.Sessions)
	root := e.Group("", func(c *gin.Context) {
		if !publicRoot[c.FullPath()] {
			rootAuth(c)
		}
	}, middleware.Tenant())

	// File tĩnh nhúng (thay cho public/ của app Node): logo của server, spec + file mẫu của module
	s.addAsset("/logo.svg", logoSVG)
	for _, m := range s.modules() {
		m.RegisterRPC(d.Reg)
		m.RegisterRoutes(v1)
		if rm, ok := m.(RootModule); ok {
			rm.RegisterRoot(root)
		}
		if am, ok := m.(AssetModule); ok {
			for p, b := range am.Assets() {
				s.addAsset(p, b)
			}
		}
	}

	// Tài liệu API: dựng SAU khi mọi module đã đăng ký (đọc registry + bảng route REST)
	s.swaggerOn = s.mountSwagger()
}

// modules: NƠI DUY NHẤT tạo và nối các module nghiệp vụ.
//
// ═══════════════════ MODULE WIRING - BẮT ĐẦU ═══════════════════
// Thứ tự dựng theo ARCHITECTURE mục 11.2. Phụ thuộc chéo truyền qua Deps bằng interface của gói contracts;
// vòng auth <-> users <-> companies cắt bằng đúng hai setter trên users.
// Các gói module KHÔNG import lẫn nhau.
func (s *Server) modules() []Module {
	d := s.deps

	sys := system.New(system.Deps{DB: d.DB, Cfg: d.Cfg})

	usersSvc := users.New(users.Deps{DB: d.DB, Cfg: d.Cfg})
	// notifications dựng trước companies: nhắc gia hạn (M17.3) lấy admin đang hoạt động qua Admins
	notifSvc := notifications.New(notifications.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, Auditor: usersSvc})
	compSvc := companies.New(companies.Deps{DB: d.DB, Cfg: d.Cfg, UserCreator: usersSvc, UserFormatter: usersSvc, Auditor: usersSvc,
		Admins: notifSvc})
	authSvc := auth.New(auth.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, UserFormatter: usersSvc, Auditor: usersSvc, Companies: compSvc})
	usersSvc.SetCompanyReader(compSvc)
	usersSvc.SetSessionInvalidator(authSvc)
	// cổng /api/:fn và REST nhận ra người đăng nhập qua auth
	d.Sessions.Set(authSvc)

	catSvc := categories.New(categories.Deps{})
	filesSvc := files.New(files.Deps{Cfg: d.Cfg})
	matSvc := materials.New(materials.Deps{DB: d.DB, Cfg: d.Cfg, Auditor: usersSvc, Users: usersSvc, UserFmt: usersSvc,
		Notifier: notifSvc, Admins: notifSvc, Uploader: d.Storage})
	takeoffSvc := takeoff.New(takeoff.Deps{DB: d.DB, Cfg: d.Cfg, Perms: matSvc, Saver: matSvc})
	projSvc := projects.New(projects.Deps{DB: d.DB, Cfg: d.Cfg, Catalog: matSvc, Lines: takeoffSvc})
	quoteSvc := quotations.New(quotations.Deps{DB: d.DB, Cfg: d.Cfg, Lines: takeoffSvc, Projects: projSvc, Media: filesSvc,
		Files: d.Storage})
	estSvc := estimates.New(estimates.Deps{DB: d.DB, Cfg: d.Cfg, Perms: matSvc, Auditor: usersSvc})
	purchSvc := purchasing.New(purchasing.Deps{DB: d.DB, Cfg: d.Cfg, PurchaseNotifier: notifSvc, Notifier: notifSvc,
		Users: usersSvc, Auditor: usersSvc})
	reportsSvc := reports.New(reports.Deps{DB: d.DB, Cfg: d.Cfg})
	// Kinh doanh -> Quản lý thiết kế / Quản lý dự án: kéo khách sang thiet-ke / thi-cong tự tạo dự án triển khai (DeliveryFromLead)
	delivSvc := delivery.New(delivery.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, UserFmt: usersSvc, Projects: projSvc})
	salesSvc := sales.New(sales.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, UserFmt: usersSvc, Lines: takeoffSvc, Projects: projSvc,
		Delivery: delivSvc})
	// Chat (tài khoản theo số điện thoại hoặc email, không phụ thuộc module nào). Gateway WebSocket một tiến trình (realtime.Hub)
	// hỏi nghiệp vụ qua chatSvc (Backend) và chatSvc đẩy tin qua hub (Gateway): vòng này cắt bằng SetGateway.
	// Tắt server: hub báo client "reconnect" + đóng TRƯỚC http.Server.Shutdown (không theo dõi kết nối đã hijack);
	// bộ chạy phân phối + worker push dừng SAU, khi request REST đang dở đã xong (tin hệ thống của chúng vẫn phân phối + push).
	chatSvc := chat.New(chat.Deps{DB: d.DB, Cfg: d.Cfg, Mail: chatMail(d.Cfg), Push: chatPush(d.Cfg)})
	chatHub := realtime.NewHub(realtime.Options{Backend: chatSvc, OriginPatterns: wsOrigins(d.Cfg.CORSOrigins)})
	chatSvc.SetGateway(chatHub)
	s.OnShutdownFirst(chatHub.Drain) // chỉ đóng kết nối; bộ chạy phân phối dừng trong chatSvc.Shutdown (sau HTTP)
	s.OnShutdown(chatSvc.Shutdown)
	// job nền (cmd/api/main.go) lấy qua Server.Reports() / Server.Expiry()
	s.reports = reportsSvc
	s.expiry = compSvc

	return []Module{
		sys,
		usersSvc, compSvc, authSvc, notifSvc, catSvc, filesSvc, matSvc, takeoffSvc, projSvc, quoteSvc, estSvc, purchSvc, reportsSvc, salesSvc, delivSvc, chatSvc,
	}
}

// ═══════════════════ MODULE WIRING - KẾT THÚC ═══════════════════

// chatMail: client SMTP gửi mã OTP khi đăng nhập chat bằng email; chưa đặt SMTP_HOST hoặc cấu hình sai -> nil (mã OTP
// email ghi vào log server, ghi 1 dòng log). Trả interface nil thật như chatPush.
func chatMail(cfg *config.Config) chat.MailSender {
	if cfg.SMTPHost == "" {
		logger.Info("chat", "email chat tắt: chưa đặt SMTP_HOST, mã OTP email ghi vào log")
		return nil
	}
	c, err := mailer.New(mailer.Config{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
		From: cfg.SMTPFrom})
	if err != nil {
		logger.Error("chat", "email chat tắt (mã OTP email ghi vào log):", err.Error())
		return nil
	}
	return c
}

// chatPush: client Web Push của chat khi đủ 3 biến CHAT_VAPID_*; thiếu hoặc khoá sai -> nil (tắt push, ghi 1 dòng log).
// Trả interface nil thật (không phải *webpush.Client nil) để chat.Service nhận đúng là "tắt".
func chatPush(cfg *config.Config) chat.PushSender {
	pub, priv, sub := cfg.ChatVAPIDPublic, cfg.ChatVAPIDPrivate, cfg.ChatVAPIDSubject
	if pub == "" && priv == "" && sub == "" {
		logger.Info("chat", "push chat tắt: chưa đặt CHAT_VAPID_PUBLIC_KEY / CHAT_VAPID_PRIVATE_KEY / CHAT_VAPID_SUBJECT (sinh khoá: go run ./cmd/vapid)")
		return nil
	}
	if pub == "" || priv == "" || sub == "" {
		logger.Error("chat", "push chat tắt: phải đặt đủ cả 3 biến CHAT_VAPID_PUBLIC_KEY, CHAT_VAPID_PRIVATE_KEY, CHAT_VAPID_SUBJECT")
		return nil
	}
	c, err := webpush.New(webpush.Options{PublicKey: pub, PrivateKey: priv, Subject: sub})
	if err != nil {
		logger.Error("chat", "push chat tắt:", err.Error())
		return nil
	}
	return c
}

// wsOrigins: OriginPatterns của gateway chat = host (bỏ scheme) của CORS_ORIGINS - trang ở origin khác API (giao diện
// React) được mở WebSocket; cùng host với API luôn được phép. CORS so khớp nguyên chuỗi nên ký tự đặc biệt của
// path.Match ([ ] * ? \, vd "[::1]:5199") được thoát; riêng "*" giữ nguyên = mọi origin, như CORS.
func wsOrigins(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		o = strings.TrimSpace(o)
		if o == "*" {
			out = append(out, o)
			continue
		}
		if i := strings.Index(o, "://"); i >= 0 {
			o = o[i+3:]
		}
		o = strings.TrimRight(o, "/")
		if o == "" {
			continue
		}
		var b strings.Builder
		for _, r := range o {
			if strings.ContainsRune(`[]*?\`, r) {
				b.WriteByte('\\')
			}
			b.WriteRune(r)
		}
		out = append(out, b.String())
	}
	return out
}
