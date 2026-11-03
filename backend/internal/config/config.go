// Package config: đọc biến môi trường. Giữ đúng tên và giá trị mặc định mà server Node dùng.
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/jsval"
)

// Config: toàn bộ cấu hình của backend.
type Config struct {
	Port int // PORT, mặc định 3000

	DatabaseURL     string // DATABASE_URL
	DBPoolMax       int    // DB_POOL_MAX, mặc định 10
	DBSortCollation string // DB_SORT_COLLATION, mặc định en-US-x-icu

	AuthSecret string // AUTH_SECRET

	LarkDomain    string // LARK_DOMAIN (đã cắt / ở cuối)
	LarkAppID     string // LARK_APP_ID
	LarkAppSecret string // LARK_APP_SECRET

	PurchaseWebhook string // PURCHASE_WEBHOOK
	ReportWebhook   string // REPORT_WEBHOOK || PURCHASE_WEBHOOK

	AppVer      string // RENDER_GIT_COMMIT || String(Date.now()) -> header x-app-ver
	SwaggerDocs string // SWAGGER_DOCS
	NodeEnv     string // NODE_ENV

	// Biến mới của bản Go
	StaticDir    string   // STATIC_DIR: thư mục giao diện cũ (public/ của app Node); rỗng (mặc định) = không phục vụ
	VendorDir    string   // VENDOR_DIR, mặc định ../node_modules (chỉ dùng khi đặt STATIC_DIR)
	CORSOrigins  []string // CORS_ORIGINS (cách nhau dấu phẩy); rỗng = không bật CORS
	RateLimit    float64  // RATE_LIMIT_RPS; <= 0 = không giới hạn
	RedisURL     string   // REDIS_URL; rỗng = không dùng Redis
	Debug        bool     // DEBUG: bật gin debug mode
	ReportJob    bool     // REPORT_JOB: chỉ "0" mới tắt job báo cáo tự động
	TokenTTLDays float64  // TOKEN_TTL_DAYS: hạn phiên đăng nhập (ngày); trống / <= 0 = 7 ngày như bản Node
	UploadDir    string   // UPLOAD_DIR: kho ảnh / tài liệu tải lên trên đĩa, mặc định "uploads" (tương đối với thư mục chạy)
	// TRUSTED_PROXIES (IP / CIDR, cách nhau dấu phẩy): proxy được tin khi lấy IP client từ X-Forwarded-For
	// cho RATE_LIMIT_RPS. Rỗng = không tin proxy nào, IP là địa chỉ kết nối trực tiếp.
	TrustedProxies []string

	// Chat (module internal/modules/chat, tài khoản theo số điện thoại, không dùng phiên QS)
	ChatJWTSecret      string  // CHAT_JWT_SECRET: khoá ký access token chat; rỗng = suy ra từ AUTH_SECRET
	ChatAccessTTLMin   float64 // CHAT_ACCESS_TTL_MIN: hạn access token (phút); trống / sai / <= 0 = 15
	ChatRefreshTTLDays float64 // CHAT_REFRESH_TTL_DAYS: hạn refresh token (ngày); trống / sai / <= 0 = 30
	ChatOTPDev         bool    // CHAT_OTP_DEV: chỉ "1" mới bật - API trả luôn mã OTP (dev_code), CHỈ dùng khi thử ở máy
	ChatVAPIDPublic    string  // CHAT_VAPID_PUBLIC_KEY: khoá công khai VAPID (Web Push); rỗng = tắt push
	ChatVAPIDPrivate   string  // CHAT_VAPID_PRIVATE_KEY
	ChatVAPIDSubject   string  // CHAT_VAPID_SUBJECT: mailto:... hoặc https://... của bên gửi push

	// Email (SMTP, internal/platform/mailer): gửi mã OTP khi đăng nhập chat bằng email; SMTP_HOST rỗng = mã ghi vào log
	SMTPHost     string // SMTP_HOST: máy chủ SMTP; rỗng = không gửi email
	SMTPPort     int    // SMTP_PORT: trống / sai / <= 0 = 587; 465 = TLS ngay, cổng khác STARTTLS nếu máy chủ hỗ trợ
	SMTPUsername string // SMTP_USERNAME: rỗng = không đăng nhập (AUTH)
	SMTPPassword string // SMTP_PASSWORD: giữ nguyên, không cắt khoảng trắng
	SMTPFrom     string // SMTP_FROM: người gửi, vd "Dezon Chat <no-reply@dezon.vn>"

	// Tệp đính kèm chat (MinIO / S3, internal/platform/objstore): CHAT_S3_ENDPOINT rỗng = tắt gửi ảnh / tệp
	ChatS3Endpoint      string  // CHAT_S3_ENDPOINT: URL nội bộ kèm scheme (http://minio:9000); scheme quyết định SSL
	ChatS3PublicURL     string  // CHAT_S3_PUBLIC_URL: host trình duyệt dùng (https://s3.<DOMAIN>); trống = như ChatS3Endpoint
	ChatS3AccessKey     string  // CHAT_S3_ACCESS_KEY: user ứng dụng (không phải root MinIO); bắt buộc khi có endpoint
	ChatS3SecretKey     string  // CHAT_S3_SECRET_KEY: giữ nguyên, không cắt khoảng trắng
	ChatS3Bucket        string  // CHAT_S3_BUCKET, mặc định chat-media
	ChatS3Region        string  // CHAT_S3_REGION, mặc định us-east-1
	ChatMediaMaxImageMB float64 // CHAT_MEDIA_MAX_IMAGE_MB: ảnh tối đa (MB); trống / sai / <= 0 = 25; > 200 kẹp về 200
	ChatMediaMaxFileMB  float64 // CHAT_MEDIA_MAX_FILE_MB: video + tệp tối đa (MB); trống / sai / <= 0 = 100; > 200 kẹp về 200
	ChatMediaDailyMB    float64 // CHAT_MEDIA_DAILY_MB: dung lượng khai báo / người / 24 giờ (MB); trống / sai / <= 0 = 2048
	ChatMediaURLTTLMin  float64 // CHAT_MEDIA_URL_TTL_MIN: hạn presigned GET (phút); trống / sai / <= 0 = 60; kẹp 5..720
}

// Giá trị mặc định lấy từ server Node.
const (
	DefaultAuthSecret      = "qs-pro-dev-secret-change-me"
	DefaultLarkDomain      = "https://open.larksuite.com"
	DefaultPurchaseWebhook = "https://open.larksuite.com/open-apis/bot/v2/hook/865751f9-d3e8-4e8e-9b4e-e0fa53ef4698"
	DefaultSortCollation   = "en-US-x-icu"
	DefaultUploadDir       = "uploads" // riêng bản Go: kho file trên đĩa
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// Load đọc cấu hình từ môi trường (gọi LoadDotenv trước nếu muốn dùng file .env).
func Load() *Config {
	c := &Config{
		Port:            int(jsval.NumOr(os.Getenv("PORT"), 3000)),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		DBPoolMax:       int(jsval.NumOr(os.Getenv("DB_POOL_MAX"), 10)),
		DBSortCollation: env("DB_SORT_COLLATION", DefaultSortCollation),
		AuthSecret:      env("AUTH_SECRET", DefaultAuthSecret),
		LarkDomain:      strings.TrimRight(env("LARK_DOMAIN", DefaultLarkDomain), "/"),
		LarkAppID:       os.Getenv("LARK_APP_ID"),
		LarkAppSecret:   os.Getenv("LARK_APP_SECRET"),
		PurchaseWebhook: env("PURCHASE_WEBHOOK", DefaultPurchaseWebhook),
		AppVer:          env("RENDER_GIT_COMMIT", strconv.FormatInt(time.Now().UnixMilli(), 10)),
		SwaggerDocs:     os.Getenv("SWAGGER_DOCS"),
		NodeEnv:         os.Getenv("NODE_ENV"),
		StaticDir:       os.Getenv("STATIC_DIR"),
		VendorDir:       env("VENDOR_DIR", filepath.Join("..", "node_modules")),
		RateLimit:       jsval.Num0(os.Getenv("RATE_LIMIT_RPS")),
		RedisURL:        os.Getenv("REDIS_URL"),
		Debug:           jsval.Truthy(os.Getenv("DEBUG")) && os.Getenv("DEBUG") != "0" && os.Getenv("DEBUG") != "false",
		UploadDir:       env("UPLOAD_DIR", DefaultUploadDir),
	}
	c.ReportWebhook = env("REPORT_WEBHOOK", c.PurchaseWebhook) // chưa đặt thì dùng chung webhook mua hàng
	c.ReportJob = os.Getenv("REPORT_JOB") != "0"
	c.TokenTTLDays, _ = strconv.ParseFloat(strings.TrimSpace(os.Getenv("TOKEN_TTL_DAYS")), 64)
	c.CORSOrigins = list(os.Getenv("CORS_ORIGINS"))
	c.TrustedProxies = list(os.Getenv("TRUSTED_PROXIES"))
	c.ChatJWTSecret = os.Getenv("CHAT_JWT_SECRET")
	c.ChatAccessTTLMin = positive(os.Getenv("CHAT_ACCESS_TTL_MIN"), 15)
	c.ChatRefreshTTLDays = positive(os.Getenv("CHAT_REFRESH_TTL_DAYS"), 30)
	c.ChatOTPDev = os.Getenv("CHAT_OTP_DEV") == "1"
	c.ChatVAPIDPublic = strings.TrimSpace(os.Getenv("CHAT_VAPID_PUBLIC_KEY"))
	c.ChatVAPIDPrivate = strings.TrimSpace(os.Getenv("CHAT_VAPID_PRIVATE_KEY"))
	c.ChatVAPIDSubject = strings.TrimSpace(os.Getenv("CHAT_VAPID_SUBJECT"))
	c.SMTPHost = strings.TrimSpace(os.Getenv("SMTP_HOST"))
	c.SMTPPort = tcpPort(os.Getenv("SMTP_PORT"), 587)
	c.SMTPUsername = strings.TrimSpace(os.Getenv("SMTP_USERNAME"))
	c.SMTPPassword = os.Getenv("SMTP_PASSWORD")
	c.SMTPFrom = strings.TrimSpace(os.Getenv("SMTP_FROM"))
	c.ChatS3Endpoint = strings.TrimRight(strings.TrimSpace(os.Getenv("CHAT_S3_ENDPOINT")), "/")
	c.ChatS3PublicURL = strings.TrimRight(strings.TrimSpace(os.Getenv("CHAT_S3_PUBLIC_URL")), "/")
	if c.ChatS3PublicURL == "" {
		c.ChatS3PublicURL = c.ChatS3Endpoint
	}
	c.ChatS3AccessKey = strings.TrimSpace(os.Getenv("CHAT_S3_ACCESS_KEY"))
	c.ChatS3SecretKey = os.Getenv("CHAT_S3_SECRET_KEY")
	c.ChatS3Bucket = env("CHAT_S3_BUCKET", "chat-media")
	c.ChatS3Region = env("CHAT_S3_REGION", "us-east-1")
	c.ChatMediaMaxImageMB = mediaMB("CHAT_MEDIA_MAX_IMAGE_MB", 25)
	c.ChatMediaMaxFileMB = mediaMB("CHAT_MEDIA_MAX_FILE_MB", 100)
	c.ChatMediaDailyMB = positive(os.Getenv("CHAT_MEDIA_DAILY_MB"), 2048)
	c.ChatMediaURLTTLMin = min(max(positive(os.Getenv("CHAT_MEDIA_URL_TTL_MIN"), 60), 5), 720)
	return c
}

// MaxMediaMB: trần cứng kích thước một tệp chat (giới hạn băm SHA-256 ở trình duyệt, khớp ck_chat_media_size_bytes).
const MaxMediaMB = 200

// mediaMB: số MB dương đọc từ biến k (trống / sai / <= 0 -> def), lớn hơn MaxMediaMB thì kẹp lại và ghi log.
func mediaMB(k string, def float64) float64 {
	v := positive(os.Getenv(k), def)
	if v > MaxMediaMB {
		logger.Infof("config", "%s=%g vượt trần %d MB, dùng %d", k, v, MaxMediaMB, MaxMediaMB)
		return MaxMediaMB
	}
	return v
}

// tcpPort: số cổng nguyên đọc từ v; trống / sai / <= 0 / > 65535 -> def.
func tcpPort(v string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n <= 0 || n > 65535 {
		return def
	}
	return n
}

// positive: số thực dương đọc từ v; trống / sai / <= 0 / vô cực -> def.
func positive(v string, def float64) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || !(f > 0) || f > 1e9 {
		return def
	}
	return f
}

// list tách chuỗi cách nhau dấu phẩy, bỏ khoảng trắng và phần tử rỗng.
func list(v string) []string {
	var out []string
	for _, o := range strings.Split(v, ",") {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}
