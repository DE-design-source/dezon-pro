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
	"TRUSTED_PROXIES", "UPLOAD_DIR"}

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
	}
	if !reflect.DeepEqual(c, want) {
		t.Errorf("mặc định:\n got %+v\nwant %+v", c, want)
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
