package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
)

// 4 route tệp chat (design mục 3).
var chatMediaRoutes = [][2]string{
	{"GET", "/api/v1/chat/media/config"},
	{"POST", "/api/v1/chat/media/upload-url"},
	{"POST", "/api/v1/chat/media/:id/complete"},
	{"GET", "/api/v1/chat/media/:id"},
}

// chatMedia: chưa đặt CHAT_S3_ENDPOINT / thiếu khoá / endpoint sai -> interface nil THẬT (chat coi là tắt tệp);
// đủ cấu hình -> client (không gọi mạng lúc tạo), goroutine kiểm bucket dừng khi server tắt.
func TestChatMediaStore(t *testing.T) {
	s := newWiredServer(t, nil)
	for _, cfg := range []*config.Config{
		{},
		{ChatS3Endpoint: "http://minio:9000", ChatS3Bucket: "chat-media"},
		{ChatS3Endpoint: "http://minio:9000", ChatS3AccessKey: "a", ChatS3Bucket: "chat-media"},
		{ChatS3Endpoint: "minio:9000", ChatS3AccessKey: "a", ChatS3SecretKey: "s", ChatS3Bucket: "chat-media"},
	} {
		if m := chatMedia(cfg, s); m != nil {
			t.Errorf("%+v: %T, muốn nil", cfg, m)
		}
	}
	before := len(s.stop)
	m := chatMedia(&config.Config{ChatS3Endpoint: "http://127.0.0.1:1", ChatS3PublicURL: "http://127.0.0.1:1", ChatS3AccessKey: "a",
		ChatS3SecretKey: "s", ChatS3Bucket: "chat-media", ChatS3Region: "us-east-1"}, s)
	if m == nil {
		t.Fatal("cấu hình đủ: muốn có kho tệp")
	}
	if m.Ready() {
		t.Error("endpoint không tới được mà Ready")
	}
	if len(s.stop) != before+1 {
		t.Fatalf("phải đăng ký 1 việc OnShutdown, có %d", len(s.stop)-before)
	}
	s.stop[len(s.stop)-1](context.Background()) // huỷ goroutine kiểm bucket
}

// Route tệp có trên engine + registry; chưa có token -> lỗi JSON của chat (không phải 404 / HTML).
func TestChatMediaRoutes(t *testing.T) {
	s := newWiredServer(t, nil)
	have := map[string]bool{}
	for _, r := range s.engine.Routes() {
		have[r.Method+" "+r.Path] = true
	}
	for _, r := range chatMediaRoutes {
		if !have[r[0]+" "+r[1]] {
			t.Errorf("thiếu route %s %s", r[0], r[1])
		}
	}
	reg := map[string]bool{}
	for _, g := range s.deps.Reg.GoRoutes() {
		reg[g.Name] = true
	}
	for _, n := range []string{"chatMediaConfig", "chatMediaUploadURL", "chatMediaComplete", "chatMediaGet"} {
		if !reg[n] {
			t.Errorf("registry thiếu %s", n)
		}
	}
	for _, r := range chatMediaRoutes {
		p := strings.Replace(r[1], ":id", "1", 1)
		w := hit(s, r[0], p, "")
		var body struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		if w.Code != 401 || json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Error == "" {
			t.Errorf("%s %s không token: %d %s", r[0], p, w.Code, w.Body.String())
		}
		if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("%s %s: Cache-Control %q", r[0], p, cc)
		}
	}
}

// Có database thử (TEST_DATABASE_URL, đã chạy 0020): đăng nhập chat thật qua OTP (CHAT_OTP_DEV=1) rồi gọi route tệp khi
// CHƯA đặt CHAT_S3_ENDPOINT: config -> enabled:false, upload-url / complete / get -> 503 MEDIA_DISABLED dạng JSON.
func TestChatMediaDisabledHTTP(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if name := strings.ToLower(strings.TrimPrefix(u.Path, "/")); !strings.Contains(name, "test") && !strings.Contains(name, "tmp") {
		t.Fatalf("TEST_DATABASE_URL phải trỏ tới database thử, đang là %q", name)
	}
	if dbu := os.Getenv("DATABASE_URL"); dbu != "" && dbu == raw {
		t.Fatal("TEST_DATABASE_URL trùng DATABASE_URL")
	}
	db := database.New(database.Config{URL: raw})
	defer db.Close()
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	dir := t.TempDir()
	cfg := &config.Config{ChatOTPDev: true, ChatJWTSecret: "khoa-thu-chatmedia", StaticDir: dir, VendorDir: dir, AppVer: "ver-1"}
	s := New(&Deps{Cfg: cfg, DB: db})
	s.deps.Sessions.Set(fakeSessions{})
	email := fmt.Sprintf("chatmedia-%d@vidu.vn", time.Now().UnixNano())
	defer func() {
		if _, err := pool.Exec(ctx, `delete from chat_users where email = $1`, email); err != nil {
			t.Errorf("dọn chat_users: %v", err)
		}
		if _, err := pool.Exec(ctx, `delete from chat_otp_codes where email = $1`, email); err != nil {
			t.Errorf("dọn chat_otp_codes: %v", err)
		}
	}()

	call := func(method, path, token, body string) (int, map[string]any) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		s.engine.ServeHTTP(w, req)
		var m map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
			t.Fatalf("%s %s: không phải JSON (%d): %s", method, path, w.Code, w.Body.String())
		}
		return w.Code, m
	}
	code, m := call("POST", "/api/v1/chat/auth/otp/request", "", `{"email":"`+email+`"}`)
	res, _ := m["result"].(map[string]any)
	otp, _ := res["dev_code"].(string)
	if code != 200 || otp == "" {
		t.Fatalf("xin OTP: %d %v", code, m)
	}
	code, m = call("POST", "/api/v1/chat/auth/otp/verify", "",
		`{"email":"`+email+`","otp":"`+otp+`","device":{"platform":"web","name":"test"},"display_name":"Thử tệp"}`)
	res, _ = m["result"].(map[string]any)
	tok, _ := res["access_token"].(string)
	if code != 200 || tok == "" {
		t.Fatalf("xác nhận OTP: %d %v", code, m)
	}

	code, m = call("GET", "/api/v1/chat/media/config", tok, "")
	res, _ = m["result"].(map[string]any)
	if code != 200 || res == nil || res["enabled"] != false {
		t.Errorf("config khi tắt: %d %v", code, m)
	}
	for _, r := range [][3]string{
		{"POST", "/api/v1/chat/media/upload-url", `{"type":"image","mime":"image/png","size":10,"sha256":"` + strings.Repeat("a", 64) + `"}`},
		{"POST", "/api/v1/chat/media/1/complete", `{}`},
		{"GET", "/api/v1/chat/media/1", ""},
	} {
		code, m := call(r[0], r[1], tok, r[2])
		if code != 503 || m["code"] != "MEDIA_DISABLED" || m["error"] == "" {
			t.Errorf("%s %s khi tắt: %d %v", r[0], r[1], code, m)
		}
	}
}
