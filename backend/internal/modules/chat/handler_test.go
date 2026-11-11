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
		{"/api/v1/chat/auth/qr/start", `{"device":"web"}`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/qr/poll", `{"qr_id":"x"}`, `"code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/qr/poll", `{}`, `"error":"Thiếu qr_id hoặc poll_token","code":"BAD_REQUEST"`},
		{"/api/v1/chat/auth/qr/poll", `{"qr_id":5,"poll_token":" "}`, `"code":"BAD_REQUEST"`},
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
		// giai đoạn 2: kiểm tham số trước khi chạm database
		{"GET", "/api/v1/chat/conversations/1/messages?around_seq=5&before_seq=3", "", `"error":"Chỉ dùng một trong before_seq / after_seq / around_seq"`},
		{"GET", "/api/v1/chat/conversations/1/messages?around_seq=0", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/conversations/1/messages/changes", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/conversations/x/messages/search?q=bao", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/search/messages?q=a", "", `"error":"Nhập ít nhất 2 ký tự để tìm"`},
		{"PATCH", "/api/v1/chat/messages/abc", `{"content":"x"}`, `"code":"BAD_REQUEST"`},
		{"PUT", "/api/v1/chat/messages/1/reaction", `{"reaction":"cười"}`, `"error":"Cảm xúc không hợp lệ"`},
		{"POST", "/api/v1/chat/messages/1/forward", `{"targets":"x"}`, `"code":"BAD_REQUEST"`},
		{"DELETE", "/api/v1/chat/devices/abc", "", `"code":"BAD_REQUEST"`},
		{"POST", "/api/v1/chat/auth/qr/scan", `{"code":5}`, `"code":"BAD_REQUEST"`},
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
	if len(gs) != 67 {
		t.Errorf("số route chat: %d", len(gs))
	}
	for _, g := range gs {
		if !have[g.Method+" /api/v1"+g.Path] || g.Tag != "Chat" || !strings.HasPrefix(g.Path, "/chat/") || g.Summary == "" {
			t.Errorf("route %+v chưa gắn / khai thiếu", g)
		}
		public := g.Path == "/chat/auth/otp/request" || g.Path == "/chat/auth/otp/verify" || g.Path == "/chat/auth/refresh" ||
			g.Path == "/chat/auth/qr/start" || g.Path == "/chat/auth/qr/poll"
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

// Route quản trị nhóm (0022) qua HTTP: sửa thông tin, cài đặt, link mời, xem trước / vào nhóm, hàng chờ duyệt,
// chuyển trưởng nhóm, giải tán -> 410. Nghiệp vụ chi tiết đã có test riêng ở tầng service; đây kiểm gắn route + thân.
func TestGroupAdminHTTPDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	r := engineFor(e.s)
	a, b, c, d := e.user("An"), e.user("Bình"), e.user("Chi"), e.user("Dũng")
	e.friends(a, b)
	type res struct {
		code int
		body string
	}
	do := func(u *tu, method, path, body string) res {
		w := call(r, method, "/api/v1/chat"+path, u.token, body)
		return res{w.Code, w.Body.String()}
	}
	want := func(what string, got res, code int, sub ...string) {
		t.Helper()
		if got.code != code {
			t.Fatalf("%s: %d %s", what, got.code, got.body)
		}
		for _, s := range sub {
			if !strings.Contains(got.body, s) {
				t.Fatalf("%s: thiếu %s trong %s", what, s, got.body)
			}
		}
	}
	got := do(a, "POST", "/conversations", `{"type":"group","name":"Nhóm thử","member_ids":[`+itoa(b.id)+`]}`)
	want("tạo nhóm", got, 200)
	var cv struct {
		Result struct {
			ID int64 `json:"id"`
		} `json:"result"`
	}
	if json.Unmarshal([]byte(got.body), &cv) != nil || cv.Result.ID == 0 {
		t.Fatalf("tạo nhóm: %s", got.body)
	}
	cp := "/conversations/" + itoa(cv.Result.ID)

	want("PATCH rỗng", do(a, "PATCH", cp, `{}`), 400, `"code":"BAD_REQUEST"`)
	want("PATCH sai kiểu", do(a, "PATCH", cp, `{"avatar_media_id":"x"}`), 400, `"code":"BAD_REQUEST"`)
	want("đổi mô tả", do(a, "PATCH", cp, `{"description":"  Mô tả nhóm  "}`), 200, `"description":"Mô tả nhóm"`)
	want("member đổi tên", do(b, "PATCH", cp, `{"name":"Khác"}`), 403, `"code":"FORBIDDEN"`)
	want("cài đặt rỗng", do(a, "PATCH", cp+"/settings", `{}`), 400, `"code":"BAD_REQUEST"`)
	want("member đổi cài đặt", do(b, "PATCH", cp+"/settings", `{"admins_only_send":true}`), 403, `"code":"FORBIDDEN"`)
	want("đổi cài đặt", do(a, "PATCH", cp+"/settings", `{"admins_only_edit_info":false}`), 200, `"admins_only_edit_info":false`)
	want("member đổi tên sau khi mở", do(b, "PATCH", cp, `{"name":"Nhóm mới"}`), 200, `"name":"Nhóm mới"`)

	// link mời: tạo (có token) -> xem (không token) -> xem trước / vào nhóm bằng token
	want("chưa có link", do(b, "GET", cp+"/invite-link", ""), 200, `{"ok":true,"result":{"invite_link":null}}`)
	want("expires_in sai", do(a, "POST", cp+"/invite-link", `{"expires_in":60}`), 400, `"code":"BAD_REQUEST"`)
	got = do(a, "POST", cp+"/invite-link", `{"expires_in":3600}`)
	want("tạo link", got, 200, `"token":"`, `"url_path":"/chat/join/`)
	var il struct {
		Result InviteLinkResult `json:"result"`
	}
	if json.Unmarshal([]byte(got.body), &il) != nil || il.Result.InviteLink == nil || len(il.Result.InviteLink.Token) != 43 {
		t.Fatalf("tạo link: %s", got.body)
	}
	tok := il.Result.InviteLink.Token
	if got = do(b, "GET", cp+"/invite-link", ""); got.code != 200 || strings.Contains(got.body, `"token"`) || !strings.Contains(got.body, `"expired":false`) {
		t.Fatalf("xem link: %d %s", got.code, got.body)
	}
	want("token sai định dạng", do(c, "GET", "/invites/abc", ""), 404, `"code":"INVITE_INVALID"`)
	want("xem trước", do(c, "GET", "/invites/"+tok, ""), 200, `"membership":"none"`, `"conversation_id":null`, `"member_count":2`)
	want("vào nhóm", do(c, "POST", "/invites/"+tok+"/join", ""), 200, `"status":"joined","conversation_id":`+itoa(cv.Result.ID))
	want("vào lại", do(c, "POST", "/invites/"+tok+"/join", ""), 200, `"status":"already_member"`)
	want("member thu hồi link người khác", do(c, "DELETE", cp+"/invite-link", ""), 403, `"code":"FORBIDDEN"`)

	// link cần duyệt (tạo lại = thu hồi link cũ) -> D xin vào -> duyệt
	got = do(a, "POST", cp+"/invite-link", `{"requires_approval":true}`)
	want("tạo link cần duyệt", got, 200, `"requires_approval":true`)
	if json.Unmarshal([]byte(got.body), &il) != nil || il.Result.InviteLink == nil {
		t.Fatalf("tạo link cần duyệt: %s", got.body)
	}
	want("link cũ hết", do(d, "GET", "/invites/"+tok, ""), 404, `"code":"INVITE_INVALID"`)
	tok = il.Result.InviteLink.Token
	got = do(d, "POST", "/invites/"+tok+"/join", "")
	want("xin vào", got, 200, `"status":"pending","conversation_id":null,"request_id":`)
	var jr struct {
		Result JoinResultDTO `json:"result"`
	}
	if json.Unmarshal([]byte(got.body), &jr) != nil || jr.Result.RequestID == nil {
		t.Fatalf("xin vào: %s", got.body)
	}
	rq := cp + "/join-requests/" + itoa(*jr.Result.RequestID)
	want("member xem hàng chờ", do(b, "GET", cp+"/join-requests", ""), 403, `"code":"FORBIDDEN"`)
	want("xem hàng chờ", do(a, "GET", cp+"/join-requests", ""), 200, `"requests":[{"id":`+itoa(*jr.Result.RequestID))
	want("mã yêu cầu sai", do(a, "POST", cp+"/join-requests/abc/approve", ""), 400, `"code":"BAD_REQUEST"`)
	want("duyệt", do(a, "POST", rq+"/approve", ""), 200, `{"ok":true,"result":{"status":"approved"}}`)
	want("từ chối yêu cầu đã duyệt", do(a, "POST", rq+"/reject", ""), 404, `"code":"NOT_FOUND"`)
	want("thu hồi link", do(a, "DELETE", cp+"/invite-link", ""), 200, `{"ok":true,"result":{}}`)
	want("thu hồi lần nữa", do(a, "DELETE", cp+"/invite-link", ""), 200, `{"ok":true,"result":{}}`)

	// chuyển trưởng nhóm -> giải tán -> 410
	want("admin chuyển trưởng nhóm", do(b, "POST", cp+"/owner", `{"user_id":`+itoa(c.id)+`}`), 403, `"code":"FORBIDDEN"`)
	want("chuyển trưởng nhóm", do(a, "POST", cp+"/owner", `{"user_id":`+itoa(b.id)+`}`), 200, `"role":"admin"`)
	want("trưởng cũ giải tán", do(a, "POST", cp+"/disband", ""), 403, `"code":"FORBIDDEN"`)
	want("giải tán", do(b, "POST", cp+"/disband", ""), 200, `{"ok":true,"result":{}}`)
	want("chi tiết sau giải tán", do(a, "GET", cp, ""), 200, `"disbanded":true`, `"members":[]`)
	for _, x := range []struct{ method, path, body string }{
		{"PATCH", cp, `{"name":"Sau"}`},
		{"PATCH", cp + "/settings", `{"admins_only_send":true}`},
		{"POST", cp + "/owner", `{"user_id":` + itoa(a.id) + `}`},
		{"POST", cp + "/disband", ""},
		{"POST", cp + "/invite-link", `{}`},
	} {
		want(x.method+" "+x.path+" sau giải tán", do(b, x.method, x.path, x.body), 410, `"code":"GROUP_DISBANDED"`)
	}
	want("link sau giải tán", do(a, "GET", cp+"/invite-link", ""), 200, `"invite_link":null`)
	want("gỡ khỏi danh sách", do(a, "DELETE", cp+"/members/"+itoa(a.id), ""), 200, `{"ok":true,"result":{}}`)
}
