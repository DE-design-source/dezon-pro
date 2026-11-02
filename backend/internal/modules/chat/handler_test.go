package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/config"
	"qspro-backend/internal/server/rpc"
)

func engineFor(s *Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	s.RegisterRoutes(r.Group("/api/v1"))
	return r
}

func call(r http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	var rd *strings.Reader
	if body != "" {
		rd = strings.NewReader(body)
	} else {
		rd = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

const bodyNoAuth = `{"error":"Phiên chat đã hết, mời đăng nhập lại","code":"CHAT_NOAUTH"}`

// Không có database: xác thực, kiểm tra thân request, phong bì trả lời, WebSocket khi chưa có gateway.
func TestHandlersNoDB(t *testing.T) {
	clk := newClock()
	s := New(Deps{Cfg: &config.Config{AuthSecret: "x"}, Now: clk.now})
	r := engineFor(s)

	for _, tok := range []string{"", "qs-body.qs-sig", "a.b.c", signAccess([]byte("khoa-khac"), 5, 7, clk.now(), time.Minute),
		signAccess(s.jwtKey, 5, 7, clk.now().Add(-time.Hour), time.Minute)} {
		if w := call(r, "GET", "/api/v1/chat/me", tok, ""); w.Code != 401 || w.Body.String() != bodyNoAuth {
			t.Errorf("token %q: %d %s", tok, w.Code, w.Body.String())
		}
	}
	for _, c := range []struct{ path, body, code string }{
		{"/api/v1/chat/auth/otp/request", `{}`, `"code":"PHONE_INVALID"`},
		{"/api/v1/chat/auth/otp/request", `{"phone":"123"}`, `"code":"PHONE_INVALID"`},
		{"/api/v1/chat/auth/otp/request", `not json`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/otp/request", `[1]`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/otp/request", `{"phone":5}`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/otp/request", `{"email":"ten@congty"}`, `"code":"EMAIL_INVALID"`},
		{"/api/v1/chat/auth/otp/request", `{"phone":"0901234567","email":"ten@congty.vn"}`, `"error":"Chỉ gửi một trong hai: số điện thoại hoặc email","code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/otp/request", `{"email":7}`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/otp/verify", `{}`, `"code":"PHONE_INVALID"`},
		{"/api/v1/chat/auth/otp/verify", `{"phone":"0901234567","otp":"12"}`, `"code":"OTP_INVALID"`},
		{"/api/v1/chat/auth/otp/verify", `{"email":"ten@@congty.vn","otp":"123456"}`, `"code":"EMAIL_INVALID"`},
		{"/api/v1/chat/auth/otp/verify", `{"email":"ten@congty.vn","otp":"12"}`, `"code":"OTP_INVALID"`},
		{"/api/v1/chat/auth/otp/verify", `{"phone":"0901234567","email":"ten@congty.vn","otp":"123456"}`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/refresh", `{}`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/refresh", ``, `"code":"BAD_REQUEST"`},
	} {
		w := call(r, "POST", c.path, "", c.body)
		if w.Code != 400 || !strings.Contains(w.Body.String(), c.code) || !strings.HasPrefix(w.Body.String(), `{"error":"`) {
			t.Errorf("%s %s: %d %s", c.path, c.body, w.Code, w.Body.String())
		}
	}
	if w := call(r, "POST", "/api/v1/chat/auth/otp/verify", "", `{}`); w.Header().Get("Cache-Control") != "no-store" {
		t.Error("verify phải có Cache-Control: no-store")
	}
	// WebSocket chưa bật
	if w := call(r, "GET", "/api/v1/chat/ws", "", ""); w.Code != 503 || !strings.Contains(w.Body.String(), `"code":"UNAVAILABLE"`) {
		t.Errorf("ws không gateway: %d %s", w.Code, w.Body.String())
	}
	s.SetGateway(newFakeGW())
	if w := call(r, "GET", "/api/v1/chat/ws", "", ""); w.Code != 299 {
		t.Errorf("ws phải chuyển cho gateway: %d", w.Code)
	}

	// token hợp lệ + thiết bị đã có trong cache: không cần database
	tok := signAccess(s.jwtKey, 5, 7, clk.now(), s.accessTTL)
	s.devHit[7] = devEntry{uid: 5, at: clk.now()}
	if w := call(r, "GET", "/api/v1/chat/push/config", tok, ""); w.Code != 200 || w.Body.String() != `{"ok":true,"result":{"enabled":false,"vapid_public_key":null}}` {
		t.Errorf("push config: %d %s", w.Code, w.Body.String())
	}
	for _, c := range []struct{ method, path, body, want string }{
		{"DELETE", "/api/v1/chat/friends/abc", "", `"code":"BAD_REQUEST"`},
		{"DELETE", "/api/v1/chat/friends/0", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/conversations?limit=x", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/conversations/1/messages?before_seq=-1", "", `"code":"BAD_REQUEST"`},
		{"POST", "/api/v1/chat/conversations", `{"type":"kênh"}`, `"code":"BAD_REQUEST"`},
		{"POST", "/api/v1/chat/conversations", `{"type":"group","name":"","member_ids":[2]}`, `"code":"BAD_REQUEST"`},
		{"POST", "/api/v1/chat/friend-requests", `{"user_id":"5"}`, `"code":"BAD_REQUEST"`},
		{"POST", "/api/v1/chat/friend-requests", `{"user_id":5}`, `"code":"BAD_REQUEST"`}, // chính mình
		{"POST", "/api/v1/chat/devices/push", `{"push_kind":"webpush","push_token":"{}"}`, `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/sync", "", `"code":"BAD_REQUEST"`},
		{"PUT", "/api/v1/chat/conversations/1/mute", `{"until":"mai"}`, `"code":"BAD_REQUEST"`},
	} {
		if w := call(r, c.method, c.path, tok, c.body); w.Code != 400 || !strings.Contains(w.Body.String(), c.want) {
			t.Errorf("%s %s %s: %d %s", c.method, c.path, c.body, w.Code, w.Body.String())
		}
	}
	// lỗi database: 500 INTERNAL, không lộ chi tiết
	if w := call(r, "GET", "/api/v1/chat/me", tok, ""); w.Code != 500 || w.Body.String() != `{"error":"Lỗi máy chủ","code":"INTERNAL"}` {
		t.Errorf("không có database: %d %s", w.Code, w.Body.String())
	}
	// cache thiết bị hết 30 giây -> phải hỏi database lại
	clk.add(31 * time.Second)
	if w := call(r, "GET", "/api/v1/chat/push/config", tok, ""); w.Code != 500 {
		t.Errorf("cache thiết bị hết hạn: %d %s", w.Code, w.Body.String())
	}
}

// Mỗi GoRoute khai trong RegisterRPC đều được gắn route gin, nhóm "Chat", path dưới /chat.
func TestRegisterRPCMatchesRoutes(t *testing.T) {
	s := New(Deps{})
	reg := rpc.NewRegistry()
	s.RegisterRPC(reg)
	have := map[string]bool{}
	for _, rt := range engineFor(s).Routes() {
		have[rt.Method+" "+rt.Path] = true
	}
	gs := reg.GoRoutes()
	if len(gs) != 32 {
		t.Errorf("số route chat: %d", len(gs))
	}
	for _, g := range gs {
		if !have[g.Method+" /api/v1"+g.Path] || g.Tag != "Chat" || !strings.HasPrefix(g.Path, "/chat/") || g.Summary == "" {
			t.Errorf("route %+v chưa gắn / khai thiếu", g)
		}
		public := g.Path == "/chat/auth/otp/request" || g.Path == "/chat/auth/otp/verify" || g.Path == "/chat/auth/refresh"
		if public != (g.Perm == rpc.Public) || (!public && g.Perm != rpc.SelfAuth) {
			t.Errorf("quyền của %s: %d", g.Path, g.Perm)
		}
	}
	if len(have) != len(gs) {
		t.Errorf("gin có %d route, khai %d", len(have), len(gs))
	}
}

// Luồng thật qua HTTP: xin OTP (dev_code) -> verify -> /me -> tạo chat 1-1 -> danh sách -> đăng xuất -> 401.
func TestHandlersHappyPathDB(t *testing.T) {
	e := newEnv(t, envOpt{otpDev: true})
	r := engineFor(e.s)
	phone := e.randPhone()
	local := "0" + phone[3:]
	w := call(r, "POST", "/api/v1/chat/auth/otp/request", "", `{"phone":"`+local+`"}`)
	var otp struct {
		OK     bool             `json:"ok"`
		Result OTPRequestResult `json:"result"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &otp) != nil || !otp.OK || otp.Result.Phone != phone || len(otp.Result.DevCode) != 6 {
		t.Fatalf("otp/request: %d %s", w.Code, w.Body.String())
	}
	w = call(r, "POST", "/api/v1/chat/auth/otp/verify", "", `{"phone":"`+phone+`","otp":"`+otp.Result.DevCode+`","device":{"platform":"web","name":"Thử"},"display_name":"Lan"}`)
	var ver struct {
		Result struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
			DeviceID     int64  `json:"device_id"`
			IsNew        bool   `json:"is_new"`
			User         struct {
				ID               int64  `json:"id"`
				DisplayName      string `json:"display_name"`
				Relation         string `json:"relation"`
				ShowReadReceipts bool   `json:"show_read_receipts"`
			} `json:"user"`
		} `json:"result"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &ver) != nil || ver.Result.AccessToken == "" || !ver.Result.IsNew ||
		ver.Result.User.DisplayName != "Lan" || ver.Result.User.Relation != "self" || ver.Result.ExpiresIn != 900 {
		t.Fatalf("otp/verify: %d %s", w.Code, w.Body.String())
	}
	e.track(ver.Result.User.ID)
	tok := ver.Result.AccessToken
	w = call(r, "GET", "/api/v1/chat/me", tok, "")
	if w.Code != 200 || !strings.HasPrefix(w.Body.String(), `{"ok":true,"result":{"id":`) ||
		!strings.Contains(w.Body.String(), `"display_name":"Lan","phone":"`+phone+`","email":null,"relation":"self","online":false,"show_read_receipts":true,"created_at":"`) {
		t.Fatalf("/me: %d %s", w.Code, w.Body.String())
	}
	other := e.user("Bình")
	w = call(r, "POST", "/api/v1/chat/conversations", tok, `{"type":"direct","user_id":`+itoa(other.id)+`}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"direct","name":null,"peer":{"id":`+itoa(other.id)) ||
		!strings.Contains(w.Body.String(), `"members":[`) {
		t.Fatalf("tạo chat 1-1: %d %s", w.Code, w.Body.String())
	}
	w = call(r, "GET", "/api/v1/chat/conversations", tok, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"next_cursor":null,"sync_cursor":"`) {
		t.Fatalf("danh sách: %d %s", w.Code, w.Body.String())
	}
	w = call(r, "GET", "/api/v1/chat/users/search?phone="+other.phone, tok, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"user":{"id":`+itoa(other.id)) {
		t.Fatalf("tra số: %d %s", w.Code, w.Body.String())
	}
	byMail := e.userEmail("Chi")
	w = call(r, "GET", "/api/v1/chat/users/search?email="+strings.ToUpper(byMail.email), tok, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"user":{"id":`+itoa(byMail.id)+`,"display_name":"Chi","phone":null,"email":"`+byMail.email+`","relation":"none"`) {
		t.Fatalf("tra email: %d %s", w.Code, w.Body.String())
	}
	for q, code := range map[string]string{"?email=khong-phai-email": "EMAIL_INVALID", "?phone=0901234567&email=" + byMail.email: "BAD_REQUEST", "": "PHONE_INVALID"} {
		if w = call(r, "GET", "/api/v1/chat/users/search"+q, tok, ""); w.Code != 400 || !strings.Contains(w.Body.String(), `"code":"`+code+`"`) {
			t.Fatalf("tra %q: %d %s", q, w.Code, w.Body.String())
		}
	}
	if w = call(r, "GET", "/api/v1/chat/conversations/"+itoa(1<<50), tok, ""); w.Code != 403 || !strings.Contains(w.Body.String(), `"code":"FORBIDDEN"`) {
		t.Fatalf("hội thoại không phải của mình: %d %s", w.Code, w.Body.String())
	}
	w = call(r, "POST", "/api/v1/chat/auth/refresh", "", `{"refresh_token":"`+ver.Result.RefreshToken+`"}`)
	if w.Code != 200 || strings.Contains(w.Body.String(), `"is_new"`) {
		t.Fatalf("refresh: %d %s", w.Code, w.Body.String())
	}
	if w = call(r, "POST", "/api/v1/chat/auth/logout", tok, ""); w.Code != 200 || w.Body.String() != `{"ok":true,"result":{}}` {
		t.Fatalf("logout: %d %s", w.Code, w.Body.String())
	}
	if w = call(r, "GET", "/api/v1/chat/me", tok, ""); w.Code != 401 || w.Body.String() != bodyNoAuth {
		t.Fatalf("sau logout: %d %s", w.Code, w.Body.String())
	}
}
