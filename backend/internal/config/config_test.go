package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"
)

var bienCauHinh = []string{"PORT", "DATABASE_URL", "DB_POOL_MAX", "DB_SORT_COLLATION", "AUTH_SECRET", "LARK_DOMAIN",
	"LARK_APP_ID", "LARK_APP_SECRET", "PURCHASE_WEBHOOK", "REPORT_WEBHOOK", "RENDER_GIT_COMMIT", "SWAGGER_DOCS",
	"NODE_ENV", "STATIC_DIR", "VENDOR_DIR", "CORS_ORIGINS", "RATE_LIMIT_RPS", "REDIS_URL", "DEBUG", "REPORT_JOB",
	"TRUSTED_PROXIES", "UPLOAD_DIR", "CHAT_JWT_SECRET", "CHAT_ACCESS_TTL_MIN", "CHAT_REFRESH_TTL_DAYS", "CHAT_OTP_DEV",
	"CHAT_VAPID_PUBLIC_KEY", "CHAT_VAPID_PRIVATE_KEY", "CHAT_VAPID_SUBJECT", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME",
	"SMTP_PASSWORD", "SMTP_FROM", "CHAT_S3_ENDPOINT", "CHAT_S3_PUBLIC_URL", "CHAT_S3_ACCESS_KEY", "CHAT_S3_SECRET_KEY",
	"CHAT_S3_BUCKET", "CHAT_S3_REGION", "CHAT_MEDIA_MAX_IMAGE_MB", "CHAT_MEDIA_MAX_FILE_MB", "CHAT_MEDIA_DAILY_MB", "CHAT_MEDIA_URL_TTL_MIN"}

// xoaEnv bỏ mọi biến cấu hình trong lúc test (t.Setenv trước để hết test được trả lại giá trị cũ).
func xoaEnv(t *testing.T) {
	t.Helper()
	for _, k := range bienCauHinh {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
}

// Chưa đặt biến nào: đúng giá trị mặc định của server Node (config.js 6-9, auth.js 14, supa.js 19, 25, 76,
// index.js 138, 340, 602).
func TestLoadDefaults(t *testing.T) {
	xoaEnv(t)
	truoc := time.Now().UnixMilli()
	c := Load()
	sau := time.Now().UnixMilli()
	ver, err := strconv.ParseInt(c.AppVer, 10, 64)
	if err != nil || ver < truoc || ver > sau {
		t.Errorf("AppVer mặc định phải là String(Date.now()), được %q", c.AppVer)
	}
	c.AppVer = ""
	want := &Config{
		Port:            3000,
		DBPoolMax:       10,
		DBSortCollation: "en-US-x-icu",
		AuthSecret:      "qs-pro-dev-secret-change-me",
		LarkDomain:      "https://open.larksuite.com",
		PurchaseWebhook: "https://open.larksuite.com/open-apis/bot/v2/hook/865751f9-d3e8-4e8e-9b4e-e0fa53ef4698",
		ReportWebhook:   "https://open.larksuite.com/open-apis/bot/v2/hook/865751f9-d3e8-4e8e-9b4e-e0fa53ef4698",
		VendorDir:       filepath.Join("..", "node_modules"), // STATIC_DIR mặc định rỗng: không phục vụ giao diện cũ
		ReportJob:       true,
		UploadDir:       "uploads",
		// chat: access 15 phút, refresh 30 ngày, không trả mã OTP, không có push
		ChatAccessTTLMin:   15,
		ChatRefreshTTLDays: 30,
		SMTPPort:           587, // email: chưa đặt SMTP_HOST = không gửi email
		// tệp chat: chưa đặt CHAT_S3_ENDPOINT = tắt; giới hạn mặc định
		ChatS3Bucket: "chat-media", ChatS3Region: "us-east-1", ChatMediaMaxImageMB: 25, ChatMediaMaxFileMB: 100, ChatMediaDailyMB: 2048,
		ChatMediaURLTTLMin: 60,
	}
	if !reflect.DeepEqual(c, want) {
		t.Errorf("mặc định:\n got %+v\nwant %+v", c, want)
	}
}

// Biến của chat: hạn token chỉ nhận số dương, CHAT_OTP_DEV chỉ "1" mới bật, khoá VAPID cắt khoảng trắng.
func TestLoadChat(t *testing.T) {
	xoaEnv(t)
	for k, v := range map[string]string{
		"CHAT_JWT_SECRET": "khoa-chat", "CHAT_ACCESS_TTL_MIN": " 5 ", "CHAT_REFRESH_TTL_DAYS": "0.5", "CHAT_OTP_DEV": "1",
		"CHAT_VAPID_PUBLIC_KEY": " BPub ", "CHAT_VAPID_PRIVATE_KEY": "priv\n", "CHAT_VAPID_SUBJECT": "mailto:a@dezon.vn",
	} {
		t.Setenv(k, v)
	}
	c := Load()
	if c.ChatJWTSecret != "khoa-chat" || c.ChatAccessTTLMin != 5 || c.ChatRefreshTTLDays != 0.5 || !c.ChatOTPDev ||
		c.ChatVAPIDPublic != "BPub" || c.ChatVAPIDPrivate != "priv" || c.ChatVAPIDSubject != "mailto:a@dezon.vn" {
		t.Errorf("chat: %+v", c)
	}
	for _, v := range []string{"", "abc", "0", "-3", "NaN", "Inf", "1e400"} {
		t.Setenv("CHAT_ACCESS_TTL_MIN", v)
		t.Setenv("CHAT_REFRESH_TTL_DAYS", v)
		if c := Load(); c.ChatAccessTTLMin != 15 || c.ChatRefreshTTLDays != 30 {
			t.Errorf("hạn token %q: %v / %v, mong 15 / 30", v, c.ChatAccessTTLMin, c.ChatRefreshTTLDays)
		}
	}
	for v, want := range map[string]bool{"1": true, "": false, "0": false, "true": false, "yes": false} {
		t.Setenv("CHAT_OTP_DEV", v)
		if got := Load().ChatOTPDev; got != want {
			t.Errorf("CHAT_OTP_DEV=%q: %v", v, got)
		}
	}
}

// Biến email (SMTP): host / tài khoản / người gửi cắt khoảng trắng, mật khẩu giữ nguyên, SMTP_PORT trống / sai -> 587.
func TestLoadSMTP(t *testing.T) {
	xoaEnv(t)
	for k, v := range map[string]string{
		"SMTP_HOST": " smtp.gmail.com ", "SMTP_PORT": " 465 ", "SMTP_USERNAME": " otp@dezon.vn\n", "SMTP_PASSWORD": " mk #1 ",
		"SMTP_FROM": " Dezon Chat <no-reply@dezon.vn> ",
	} {
		t.Setenv(k, v)
	}
	c := Load()
	if c.SMTPHost != "smtp.gmail.com" || c.SMTPPort != 465 || c.SMTPUsername != "otp@dezon.vn" || c.SMTPPassword != " mk #1 " ||
		c.SMTPFrom != "Dezon Chat <no-reply@dezon.vn>" {
		t.Errorf("smtp: %+v", c)
	}
	for v, want := range map[string]int{
		"": 587, "abc": 587, "0": 587, "-25": 587, "587.5": 587, "1e3": 587, "70000": 587, "0x19": 587,
		"25": 25, "2525": 2525, " 587 ": 587, "65535": 65535,
	} {
		t.Setenv("SMTP_PORT", v)
		if got := Load().SMTPPort; got != want {
			t.Errorf("SMTP_PORT=%q: %d, mong %d", v, got, want)
		}
	}
}

// Biến tệp chat (CHAT_S3_*, CHAT_MEDIA_*): URL cắt khoảng trắng + "/" cuối, PUBLIC_URL trống = ENDPOINT, secret giữ nguyên;
// giới hạn MB chỉ nhận số dương, ảnh / tệp kẹp trần 200 MB, hạn URL kẹp 5..720 phút.
func TestLoadChatMedia(t *testing.T) {
	xoaEnv(t)
	for k, v := range map[string]string{
		"CHAT_S3_ENDPOINT": " http://qspro-minio:9000/ ", "CHAT_S3_ACCESS_KEY": " qspro-app ", "CHAT_S3_SECRET_KEY": " bi mat ",
		"CHAT_S3_BUCKET": "tep-chat", "CHAT_S3_REGION": "ap-southeast-1", "CHAT_MEDIA_MAX_IMAGE_MB": "10",
		"CHAT_MEDIA_MAX_FILE_MB": "150", "CHAT_MEDIA_DAILY_MB": "500", "CHAT_MEDIA_URL_TTL_MIN": "30",
	} {
		t.Setenv(k, v)
	}
	c := Load()
	if c.ChatS3Endpoint != "http://qspro-minio:9000" || c.ChatS3PublicURL != "http://qspro-minio:9000" || c.ChatS3AccessKey != "qspro-app" ||
		c.ChatS3SecretKey != " bi mat " || c.ChatS3Bucket != "tep-chat" || c.ChatS3Region != "ap-southeast-1" ||
		c.ChatMediaMaxImageMB != 10 || c.ChatMediaMaxFileMB != 150 || c.ChatMediaDailyMB != 500 || c.ChatMediaURLTTLMin != 30 {
		t.Errorf("tệp chat: %+v", c)
	}
	t.Setenv("CHAT_S3_PUBLIC_URL", " https://s3.dezon.vn// ")
	if got := Load().ChatS3PublicURL; got != "https://s3.dezon.vn" {
		t.Errorf("CHAT_S3_PUBLIC_URL: %q", got)
	}
	for v, want := range map[string]float64{"": 100, "abc": 100, "0": 100, "-5": 100, "NaN": 100, "200": 200, "201": 200, "5000": 200, "0.5": 0.5} {
		t.Setenv("CHAT_MEDIA_MAX_FILE_MB", v)
		t.Setenv("CHAT_MEDIA_MAX_IMAGE_MB", v)
		wantImg := want
		if want == 100 {
			wantImg = 25
		}
		if c := Load(); c.ChatMediaMaxFileMB != want || c.ChatMediaMaxImageMB != wantImg {
			t.Errorf("MAX_*_MB=%q: tệp %v ảnh %v, mong %v / %v", v, c.ChatMediaMaxFileMB, c.ChatMediaMaxImageMB, want, wantImg)
		}
	}
	for v, want := range map[string]float64{"": 60, "abc": 60, "0": 60, "-1": 60, "1": 5, "4.9": 5, "5": 5, "90": 90, "720": 720, "721": 720, "99999": 720} {
		t.Setenv("CHAT_MEDIA_URL_TTL_MIN", v)
		if got := Load().ChatMediaURLTTLMin; got != want {
			t.Errorf("CHAT_MEDIA_URL_TTL_MIN=%q: %v, mong %v", v, got, want)
		}
	}
	for v, want := range map[string]float64{"": 2048, "0": 2048, "x": 2048, "100": 100} {
		t.Setenv("CHAT_MEDIA_DAILY_MB", v)
		if got := Load().ChatMediaDailyMB; got != want {
			t.Errorf("CHAT_MEDIA_DAILY_MB=%q: %v, mong %v", v, got, want)
		}
	}
}

// Biến đặt RỖNG coi như chưa đặt với mọi biến Node đọc bằng "||".
func TestLoadEmptyLikeUnset(t *testing.T) {
	xoaEnv(t)
	want := Load()
	for _, k := range bienCauHinh {
		t.Setenv(k, "")
	}
	got := Load()
	got.AppVer, want.AppVer = "", ""
	if !reflect.DeepEqual(got, want) {
		t.Errorf("đặt rỗng:\n got %+v\nwant %+v", got, want)
	}
}

// Giá trị mong đợi lấy từ chạy Node thật: Number(v) || mặc định, (v || mặc định).replace(/\/+$/, ”).
func TestLoadValues(t *testing.T) {
	for _, c := range []struct {
		in   string
		want int
	}{{"abc", 3000}, {"0", 3000}, {"8080", 8080}, {" 80 ", 80}, {"0x10", 16}, {"1e3", 1000}, {"-0", 3000}} {
		xoaEnv(t)
		t.Setenv("PORT", c.in)
		if got := Load().Port; got != c.want {
			t.Errorf("PORT=%q: %d, muốn %d", c.in, got, c.want)
		}
	}
	for _, c := range []struct {
		in   string
		want int
	}{{"0", 10}, {"abc", 10}, {"25", 25}, {" 7 ", 7}, {"1e1", 10}} {
		xoaEnv(t)
		t.Setenv("DB_POOL_MAX", c.in)
		if got := Load().DBPoolMax; got != c.want {
			t.Errorf("DB_POOL_MAX=%q: %d, muốn %d", c.in, got, c.want)
		}
	}
	for _, c := range [][2]string{{"https://x///", "https://x"}, {"https://x/a/", "https://x/a"}, {"/", ""}, {"///", ""}} {
		xoaEnv(t)
		t.Setenv("LARK_DOMAIN", c[0])
		if got := Load().LarkDomain; got != c[1] {
			t.Errorf("LARK_DOMAIN=%q: %q, muốn %q", c[0], got, c[1])
		}
	}

	xoaEnv(t)
	for k, v := range map[string]string{
		"DATABASE_URL": "postgresql://u:p@h/d", "DB_SORT_COLLATION": "vi-x-icu", "AUTH_SECRET": "bi-mat",
		"LARK_APP_ID": "cli_1", "LARK_APP_SECRET": "s1", "PURCHASE_WEBHOOK": "http://h/mua",
		"UPLOAD_DIR": "/srv/uploads", "RENDER_GIT_COMMIT": "abc123", "SWAGGER_DOCS": "1", "NODE_ENV": "production", "STATIC_DIR": "/srv/public",
		"VENDOR_DIR": "/srv/nm", "CORS_ORIGINS": " https://a.vn , ,https://b.vn", "RATE_LIMIT_RPS": "2.5",
		"REDIS_URL": "redis://r:6379/0", "DEBUG": "1", "REPORT_JOB": "0", "TRUSTED_PROXIES": "10.0.0.0/8, 127.0.0.1",
	} {
		t.Setenv(k, v)
	}
	got := Load()
	want := &Config{
		Port: 3000, DatabaseURL: "postgresql://u:p@h/d", DBPoolMax: 10, DBSortCollation: "vi-x-icu", AuthSecret: "bi-mat",
		LarkDomain: "https://open.larksuite.com", LarkAppID: "cli_1", LarkAppSecret: "s1",
		PurchaseWebhook: "http://h/mua", ReportWebhook: "http://h/mua", // REPORT_WEBHOOK chưa đặt -> dùng chung
		UploadDir: "/srv/uploads", AppVer: "abc123", SwaggerDocs: "1", NodeEnv: "production", StaticDir: "/srv/public", VendorDir: "/srv/nm",
		CORSOrigins: []string{"https://a.vn", "https://b.vn"}, RateLimit: 2.5, RedisURL: "redis://r:6379/0", Debug: true,
		ReportJob: false, TrustedProxies: []string{"10.0.0.0/8", "127.0.0.1"},
		ChatAccessTTLMin: 15, ChatRefreshTTLDays: 30, SMTPPort: 587,
		ChatS3Bucket: "chat-media", ChatS3Region: "us-east-1", ChatMediaMaxImageMB: 25, ChatMediaMaxFileMB: 100, ChatMediaDailyMB: 2048,
		ChatMediaURLTTLMin: 60,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("đặt đủ:\n got %+v\nwant %+v", got, want)
	}
	t.Setenv("REPORT_WEBHOOK", "http://h/bao-cao")
	if c := Load(); c.ReportWebhook != "http://h/bao-cao" || c.PurchaseWebhook != "http://h/mua" {
		t.Errorf("REPORT_WEBHOOK riêng: %q / %q", c.ReportWebhook, c.PurchaseWebhook)
	}
	for v, want := range map[string]bool{"0": false, "false": false, "": false, "1": true, "true": true} {
		t.Setenv("DEBUG", v)
		if got := Load().Debug; got != want {
			t.Errorf("DEBUG=%q: %v", v, got)
		}
	}
	for v, want := range map[string]bool{"0": false, "": true, "1": true, "false": true, "00": true} {
		t.Setenv("REPORT_JOB", v)
		if got := Load().ReportJob; got != want {
			t.Errorf("REPORT_JOB=%q: %v", v, got)
		}
	}
}

// DOTENV=0: không đọc file .env nào.
func TestLoadDotenvSwitch(t *testing.T) {
	f := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(f, []byte("QS_T_D=file\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("QS_T_D", "x")
	os.Unsetenv("QS_T_D")
	t.Setenv("DOTENV", "0")
	LoadDotenv(f)
	if v, ok := os.LookupEnv("QS_T_D"); ok {
		t.Errorf("DOTENV=0 vẫn đọc file: %q", v)
	}
	t.Setenv("DOTENV", "1")
	LoadDotenv(f)
	if v := os.Getenv("QS_T_D"); v != "file" {
		t.Errorf("DOTENV=1 phải đọc file, được %q", v)
	}
}
