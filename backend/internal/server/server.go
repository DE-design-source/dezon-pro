// Package server: dựng HTTP server (Gin) thay cho server/index.js.
//   - Phục vụ file tĩnh nhúng trong binary mà giao diện React tải thẳng (/vs-spec.js, /son-spec.js, /ct-spec.js,
//     /logo.svg, /mau-nhap-hang-loat.xlsx - xem assets.go)
//   - Kho ảnh / tài liệu tải lên (UPLOAD_DIR) tại /files/<path> - xem uploads.go
//   - Tuỳ chọn: giao diện cũ trong STATIC_DIR và thư viện bảng tính dưới /vendor (chỉ khi đặt STATIC_DIR)
//   - POST /api/:fn    -> cổng tương thích với giao diện hiện tại (xem package rpc)
//   - /api/v1/...      -> REST, dùng chung service với cổng trên
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/platform/redis"
	"qspro-backend/internal/platform/storage"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/contracts"
	"qspro-backend/internal/shared/response"
)

// Deps: hạ tầng dùng chung, truyền cho mọi module.
type Deps struct {
	Cfg      *config.Config
	DB       *database.DB
	Storage  *storage.Client
	Redis    *redis.Client             // nil khi không cấu hình REDIS_URL
	Reg      *rpc.Registry             // nơi module đăng ký hàm /api/:fn
	Sessions *middleware.SessionHolder // module auth gắn SessionResolver vào đây
}

// Server: gin engine + http.Server.
type Server struct {
	deps   *Deps
	engine *gin.Engine
	http   *http.Server
	stop   []func(context.Context) // việc cần làm khi tắt (dừng job nền...)

	reports   contracts.ReportRunner   // module reports, cho job nền
	expiry    contracts.ExpiryReminder // module companies: nhắc gia hạn trong ứng dụng (M17.3), cho job nền
	swaggerOn bool                     // /api-docs có bật không

	routesOnce sync.Once
	routeList  [][2]string // {method, path} của các route đã đăng ký, cho looseMatch

	assets map[string]*asset // file nhúng theo đường dẫn URL; điền trong routes()
}

var reRevalidate = regexp.MustCompile(`(?i)\.(html|js|css)$`)

// New dựng engine và gắn toàn bộ route. Các trường nil của Deps được tạo từ Cfg.
func New(d *Deps) *Server {
	if d.Cfg == nil {
		d.Cfg = config.Load()
	}
	cfg := d.Cfg
	if d.DB == nil {
		d.DB = database.New(database.Config{URL: cfg.DatabaseURL, PoolMax: cfg.DBPoolMax, SortCollation: cfg.DBSortCollation})
	}
	if d.Storage == nil {
		d.Storage = storage.New(cfg.UploadDir)
	}
	if d.Reg == nil {
		d.Reg = rpc.NewRegistry()
	}
	if d.Sessions == nil {
		d.Sessions = middleware.NewSessionHolder()
	}
	if cfg.Debug {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}
	e := gin.New()
	// IP client (dùng cho RATE_LIMIT_RPS): chỉ đọc X-Forwarded-For khi kết nối tới từ proxy khai trong TRUSTED_PROXIES;
	// không khai thì lấy địa chỉ kết nối trực tiếp (gin mặc định tin mọi proxy -> giả header là né được giới hạn).
	if err := e.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		logger.Error("server", "TRUSTED_PROXIES sai, không tin proxy nào:", err.Error())
		_ = e.SetTrustedProxies(nil)
	}
	// Express không chuyển hướng / sửa đường dẫn; giữ nguyên để 404 giống nhau
	e.RedirectTrailingSlash = false
	e.RedirectFixedPath = false
	e.HandleMethodNotAllowed = false
	e.Use(recovery())
	// Hai lớp dưới là bổ sung của bản Go, mặc định TẮT (bản Node không có)
	if len(cfg.CORSOrigins) > 0 {
		e.Use(middleware.CORS(cfg.CORSOrigins))
	}
	if cfg.RateLimit > 0 {
		e.Use(middleware.RateLimit(cfg.RateLimit, d.Redis))
	}
	// Thứ tự như server/index.js: đọc thân JSON -> file tĩnh -> route.
	// DrainBody: đọc bỏ thân chưa đọc sau khi trả lời (Node tự làm) để client gửi thân quá lớn vẫn nhận được 413
	e.Use(middleware.DrainBody())
	e.Use(middleware.JSONBody(middleware.JSONBodyLimit))
	// Kho file tải lên (UPLOAD_DIR) tại /files/...: công khai, không tra phiên
	e.Use(uploads(d.Storage))
	// File nhúng trong binary (spec ngành, logo, file mẫu): đứng TRƯỚC STATIC_DIR nên luôn là bản nhúng
	assets := map[string]*asset{}
	e.Use(embeddedAssets(assets))
	// Giao diện cũ (public/ của app Node) + thư viện bảng tính của nó: TUỲ CHỌN, chỉ bật khi đặt STATIC_DIR
	if cfg.StaticDir != "" {
		// Thư viện bảng tính (MIT) lấy từ node_modules - không phụ thuộc CDN bên ngoài
		const week = 7 * 24 * 3600
		e.Use(static("/vendor/jspreadsheet", filepath.Join(cfg.VendorDir, "jspreadsheet-ce", "dist"), week, nil))
		e.Use(static("/vendor/formula", filepath.Join(cfg.VendorDir, "@jspreadsheet", "formula", "dist"), week, nil))
		e.Use(static("/vendor/jsuites", filepath.Join(cfg.VendorDir, "jsuites", "dist"), week, nil))
		e.Use(static("", cfg.StaticDir, 0, func(h http.Header, filePath string) {
			// HTML/JS/CSS luôn revalidate -> deploy mới là trình duyệt lấy ngay (không kẹt cache cũ)
			if reRevalidate.MatchString(filePath) {
				h.Set("Cache-Control", "no-cache")
			}
		}))
	}

	// Tham số đường dẫn lấy từ dạng còn mã hoá rồi mới giải mã, như Express: /api/a%2Fb -> fn = "a/b"
	e.UseRawPath = true
	e.UnescapePathValues = true

	s := &Server{deps: d, engine: e, assets: assets}
	s.routes()
	e.NoRoute(s.noRoute)
	for _, m := range MissingStatic(cfg) {
		logger.Error("server", "thiếu "+m+" - giao diện sẽ không chạy đủ (xem STATIC_DIR / VENDOR_DIR, thư mục chạy phải là backend/)")
	}
	// Giới hạn thời gian như mặc định của Node 22: headersTimeout 60 giây, requestTimeout 300 giây (nhận xong cả
	// request). Kết nối keep-alive rảnh đóng sau 120 giây (Node: 5 giây).
	s.http = &http.Server{Addr: ":" + strconv.Itoa(cfg.Port), Handler: e,
		ReadHeaderTimeout: 60 * time.Second, ReadTimeout: 300 * time.Second, IdleTimeout: 120 * time.Second}
	return s
}

// MissingStatic: các file / thư mục giao diện cần có mà không thấy (index.html của STATIC_DIR, 3 thư viện dưới VENDOR_DIR).
// Không đặt STATIC_DIR = không phục vụ giao diện cũ -> không thiếu gì.
func MissingStatic(cfg *config.Config) []string {
	if cfg.StaticDir == "" {
		return nil
	}
	var out []string
	if st, err := os.Stat(filepath.Join(cfg.StaticDir, "index.html")); err != nil || st.IsDir() {
		out = append(out, filepath.Join(cfg.StaticDir, "index.html"))
	}
	for _, d := range [][]string{{"jspreadsheet-ce", "dist"}, {"@jspreadsheet", "formula", "dist"}, {"jsuites", "dist"}} {
		p := filepath.Join(append([]string{cfg.VendorDir}, d...)...)
		if st, err := os.Stat(p); err != nil || !st.IsDir() {
			out = append(out, p)
		}
	}
	return out
}

type retryKey struct{}

// noRoute: gin không khớp route nào. Trước khi trả 404 thử lại MỘT lần theo cách Express khớp route:
//   - HEAD dùng handler của GET (net/http tự bỏ thân trả về);
//   - không phân biệt hoa thường ở phần cố định, cho phép thừa một dấu "/" cuối.
func (s *Server) noRoute(c *gin.Context) {
	r := c.Request
	if r.Context().Value(retryKey{}) == nil {
		method := r.Method
		if method == http.MethodHead {
			method = http.MethodGet
		}
		raw, fixed := s.looseMatch(method, r.URL.EscapedPath())
		if fixed || method != r.Method {
			// bản sao: net/http nhìn Method của request GỐC để biết có ghi thân hay không
			r2 := r.WithContext(context.WithValue(r.Context(), retryKey{}, r.Method))
			r2.Method = method
			if fixed {
				if p, err := url.PathUnescape(raw); err == nil {
					u := *r.URL
					u.Path, u.RawPath = p, raw
					r2.URL = &u
				}
			}
			c.Request = r2
			s.engine.HandleContext(c)
			return
		}
	}
	// Node gắn Swagger UI bằng app.use SAU mọi route: nhận mọi method, mọi đường dẫn con
	if s.swaggerOn && s.swaggerUI(c) {
		return
	}
	method := r.Method
	if m, ok := r.Context().Value(retryKey{}).(string); ok {
		method = m
	}
	// 404 dưới /api/v1 không qua middleware của group -> tự gắn x-app-ver như cổng /api/:fn (M1.1)
	if p := strings.ToLower(r.URL.Path); p == "/api/v1" || strings.HasPrefix(p, "/api/v1/") {
		c.Header("x-app-ver", s.deps.Cfg.AppVer)
	}
	response.HTMLError(c, http.StatusNotFound, "Cannot "+method+" "+r.URL.EscapedPath())
}

// looseMatch tìm route đã đăng ký khớp với đường dẫn (còn mã hoá) theo luật của Express 4 và trả đường dẫn
// viết đúng như route (giữ nguyên giá trị tham số). fixed = false khi không có hoặc đường dẫn vốn đã đúng.
func (s *Server) looseMatch(method, rawPath string) (string, bool) {
	s.routesOnce.Do(func() {
		for _, ri := range s.engine.Routes() {
			if !strings.Contains(ri.Path, "*") {
				s.routeList = append(s.routeList, [2]string{ri.Method, ri.Path})
			}
		}
	})
	p := rawPath
	if len(p) > 1 && strings.HasSuffix(p, "/") {
		p = p[:len(p)-1]
	}
	segs := strings.Split(p, "/")
next:
	for _, rt := range s.routeList {
		if rt[0] != method {
			continue
		}
		rs := strings.Split(rt[1], "/")
		if len(rs) != len(segs) {
			continue
		}
		out := make([]string, len(rs))
		for i, seg := range rs {
			switch {
			case strings.HasPrefix(seg, ":"):
				if segs[i] == "" {
					continue next
				}
				out[i] = segs[i]
			case strings.EqualFold(seg, segs[i]):
				out[i] = seg
			default:
				continue next
			}
		}
		fixedPath := strings.Join(out, "/")
		return fixedPath, fixedPath != rawPath
	}
	return "", false
}

// recovery: panic ngoài cổng /api/:fn -> 500 kiểu Express.
func recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if p := recover(); p != nil {
				logger.Error("http", c.Request.Method, c.Request.URL.Path, "panic:", fmt.Sprint(p), "\n"+string(debug.Stack()))
				if !c.Writer.Written() {
					response.HTMLError(c, http.StatusInternalServerError, "Internal Server Error")
				} else {
					c.Abort()
				}
			}
		}()
		c.Next()
	}
}

// Engine trả gin engine (test dùng httptest).
func (s *Server) Engine() *gin.Engine { return s.engine }

// Deps trả hạ tầng dùng chung.
func (s *Server) Deps() *Deps { return s.deps }

// Reports trả module reports đã nối (job nền dùng).
func (s *Server) Reports() contracts.ReportRunner { return s.reports }

// Expiry trả phần nhắc gia hạn của module companies (job nền dùng, M17.3).
func (s *Server) Expiry() contracts.ExpiryReminder { return s.expiry }

// SwaggerOn: tài liệu API /api-docs có bật không.
func (s *Server) SwaggerOn() bool { return s.swaggerOn }

// OnShutdown đăng ký việc chạy khi server tắt (vd dừng job nền).
func (s *Server) OnShutdown(fn func(context.Context)) { s.stop = append(s.stop, fn) }

// Run mở cổng và chạy tới khi ctx bị huỷ (SIGINT / SIGTERM), rồi tắt êm: ngừng nhận request mới,
// chờ request đang chạy tối đa 15 giây, đóng pool database.
func (s *Server) Run(ctx context.Context) error {
	errc := make(chan error, 1)
	go func() {
		fmt.Println("QS Pro chạy tại http://localhost:" + strconv.Itoa(s.deps.Cfg.Port))
		if s.swaggerOn {
			fmt.Println("Swagger UI: http://localhost:" + strconv.Itoa(s.deps.Cfg.Port) + "/api-docs")
		}
		if err := s.http.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- err
		}
		close(errc)
	}()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	sctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := s.http.Shutdown(sctx)
	for _, fn := range s.stop {
		fn(sctx)
	}
	s.deps.DB.Close()
	if s.deps.Redis != nil {
		_ = s.deps.Redis.Close()
	}
	return err
}
