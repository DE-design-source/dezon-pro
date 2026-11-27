package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/tenant"
)

func engine(mw ...gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	e := gin.New()
	e.Use(mw...)
	return e
}

func hit(e *gin.Engine, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.ServeHTTP(w, r)
	return w
}

func TestRBACAndTenant(t *testing.T) {
	who := map[string]*actor.Actor{
		"u": {UID: "1", U: "u", R: "staff", CT: "c1"},
		"a": {UID: "2", U: "a", R: "admin", CT: "c1"},
		"s": {UID: "3", U: "s", R: "super"},
	}
	fake := func(c *gin.Context) { actor.Set(c, who[c.GetHeader("X-Who")]) }
	e := engine(fake, Tenant())
	ok := func(c *gin.Context) {
		ctx := c.Request.Context()
		response.OK(c, []any{tenant.TenantID(ctx), tenant.From(ctx).Role, actor.From(ctx) != nil})
	}
	e.GET("/login", RequireLogin(), ok)
	e.GET("/admin", RequireAdmin(), ok)
	e.GET("/super", RequireSuper(), ok)
	cases := []struct {
		path, who, view string
		status          int
		body            string
	}{
		{"/login", "", "", 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`},
		{"/login", "u", "c9", 200, `{"ok":true,"result":["c1","staff",true]}`},
		{"/admin", "", "", 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`},
		{"/admin", "u", "", 403, `{"error":"Không có quyền (chỉ Admin)"}`},
		{"/admin", "a", "", 200, `{"ok":true,"result":["c1","admin",true]}`},
		{"/super", "a", "", 403, `{"error":"Chỉ quản trị hệ thống"}`},
		{"/super", "s", "", 200, `{"ok":true,"result":[null,"super",true]}`},
		{"/super", "s", "c9", 200, `{"ok":true,"result":["c9","super",true]}`},
	}
	for _, c := range cases {
		w := hit(e, "GET", c.path, "", map[string]string{"X-Who": c.who, "X-View-Company": c.view})
		if w.Code != c.status || w.Body.String() != c.body {
			t.Errorf("%s who=%q: got %d %s, want %d %s", c.path, c.who, w.Code, w.Body.String(), c.status, c.body)
		}
	}
}

// M14.7: RequireStaffManager cho subadmin / admin / super qua, chặn giống hệt RequireAdmin; RequireAdmin vẫn chặn subadmin.
func TestRequireStaffManager(t *testing.T) {
	who := map[string]*actor.Actor{
		"u": {UID: "1", U: "u", R: "staff", CT: "c1"},
		"m": {UID: "4", U: "m", R: "subadmin", CT: "c1"},
		"a": {UID: "2", U: "a", R: "admin", CT: "c1"},
		"s": {UID: "3", U: "s", R: "super"},
	}
	fake := func(c *gin.Context) { actor.Set(c, who[c.GetHeader("X-Who")]) }
	e := engine(fake)
	ok := func(c *gin.Context) { response.OK(c, "ok") }
	e.GET("/staff", RequireStaffManager(), ok)
	e.GET("/admin", RequireAdmin(), ok)
	const okBody = `{"ok":true,"result":"ok"}`
	cases := []struct {
		path, who string
		status    int
		body      string
	}{
		{"/staff", "", 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`},
		{"/staff", "u", 403, `{"error":"Không có quyền (chỉ Admin)"}`},
		{"/staff", "m", 200, okBody},
		{"/staff", "a", 200, okBody},
		{"/staff", "s", 200, okBody},
		{"/admin", "m", 403, `{"error":"Không có quyền (chỉ Admin)"}`},
	}
	for _, c := range cases {
		w := hit(e, "GET", c.path, "", map[string]string{"X-Who": c.who})
		if w.Code != c.status || w.Body.String() != c.body {
			t.Errorf("%s who=%q: got %d %s, want %d %s", c.path, c.who, w.Code, w.Body.String(), c.status, c.body)
		}
	}
}

func TestBearerAndBody(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "BEARER   abc.def")
	if BearerToken(r) != "abc.def" {
		t.Errorf("BearerToken: %q", BearerToken(r))
	}
	r.Header.Set("Authorization", "abc")
	if BearerToken(r) != "abc" {
		t.Error("không có tiền tố Bearer thì giữ nguyên")
	}
	e := engine(JSONBody(16))
	e.POST("/", func(c *gin.Context) { response.OK(c, Body(c)) })
	j := map[string]string{"Content-Type": "application/json; charset=utf-8"}
	if w := hit(e, "POST", "/", `{"b":1,"a":2}`, j); w.Body.String() != `{"ok":true,"result":{"b":1,"a":2}}` {
		t.Errorf("thân JSON: %s", w.Body.String())
	}
	if w := hit(e, "POST", "/", `{"b":1}`, nil); w.Body.String() != `{"ok":true,"result":{}}` {
		t.Errorf("không phải JSON -> {}: %s", w.Body.String())
	}
	if w := hit(e, "POST", "/", ``, j); w.Body.String() != `{"ok":true,"result":{}}` {
		t.Errorf("thân rỗng -> {}: %s", w.Body.String())
	}
	if w := hit(e, "POST", "/", `{"a":"0123456789abcdef"}`, j); w.Code != 413 {
		t.Errorf("quá giới hạn phải 413, được %d", w.Code)
	}
	if w := hit(e, "POST", "/", `12`, j); w.Code != 400 {
		t.Errorf("không phải object / mảng phải 400, được %d", w.Code)
	}
}

// Thân quá giới hạn: Node trả 413 rồi đọc bỏ phần còn lại, kết nối vẫn dùng tiếp được. Không có DrainBody thì net/http
// đóng kết nối khi còn hơn 256 KB chưa đọc (client đang gửi dở nhận lỗi kết nối thay vì trang 413).
func TestDrainBodyKeepsConnection(t *testing.T) {
	run := func(mw ...gin.HandlerFunc) (status int, reused bool) {
		e := engine(mw...)
		e.POST("/", func(c *gin.Context) { response.OK(c, nil) })
		srv := httptest.NewServer(e)
		defer srv.Close()
		cl := srv.Client()
		big := `{"a":"` + strings.Repeat("x", 2<<20) + `"}`
		res, err := cl.Post(srv.URL, "application/json", strings.NewReader(big))
		if err != nil {
			t.Fatalf("gửi thân lớn: %v", err)
		}
		status = res.StatusCode
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		req, _ := http.NewRequest("POST", srv.URL, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(httptrace.WithClientTrace(req.Context(), &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reused = i.Reused }}))
		res2, err := cl.Do(req)
		if err != nil {
			t.Fatalf("request thứ 2: %v", err)
		}
		res2.Body.Close()
		return status, reused
	}
	if st, reused := run(DrainBody(), JSONBody(1024)); st != 413 || !reused {
		t.Errorf("có DrainBody: status %d, dùng lại kết nối %v; muốn 413, true", st, reused)
	}
	// đối chứng: không có DrainBody thì kết nối bị đóng (nếu net/http đổi hành vi, test này báo để xem lại)
	if st, reused := run(JSONBody(1024)); st != 413 || reused {
		t.Logf("không DrainBody: status %d, dùng lại kết nối %v (net/http đã tự đọc bỏ?)", st, reused)
	}
}

func TestCORSAndRateLimit(t *testing.T) {
	e := engine(CORS([]string{"https://a.vn"}))
	e.GET("/", func(c *gin.Context) { c.Status(200) })
	if w := hit(e, "GET", "/", "", map[string]string{"Origin": "https://a.vn"}); w.Header().Get("Access-Control-Allow-Origin") != "https://a.vn" {
		t.Error("origin được phép phải có header CORS")
	}
	// header riêng của server phải đọc được từ origin khác: x-app-ver (rpc), tên file và X-Row-Count (route xuất file)
	if w := hit(e, "GET", "/", "", map[string]string{"Origin": "https://a.vn"}); w.Header().Get("Access-Control-Expose-Headers") != "x-app-ver, Content-Disposition, X-Row-Count" {
		t.Errorf("Expose-Headers: %q", w.Header().Get("Access-Control-Expose-Headers"))
	}
	if w := hit(e, "GET", "/", "", map[string]string{"Origin": "https://b.vn"}); w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("origin lạ không được có header CORS")
	}
	if w := hit(e, "OPTIONS", "/", "", map[string]string{"Origin": "https://a.vn", "Access-Control-Request-Method": "POST"}); w.Code != http.StatusNoContent {
		t.Errorf("preflight phải 204, được %d", w.Code)
	}

	e = engine(RateLimit(1, nil))
	e.GET("/", func(c *gin.Context) { c.Status(200) })
	codes := []int{}
	for i := 0; i < 4; i++ {
		codes = append(codes, hit(e, "GET", "/", "", nil).Code)
	}
	if codes[0] != 200 || codes[1] != 200 || codes[3] != 429 {
		t.Errorf("rps=1 (burst 2): %v", codes)
	}
	e = engine(RateLimit(0, nil))
	e.GET("/", func(c *gin.Context) { c.Status(200) })
	for i := 0; i < 20; i++ {
		if hit(e, "GET", "/", "", nil).Code != 200 {
			t.Fatal("rps=0 là không giới hạn")
		}
	}
}

// Thân JSON vượt giới hạn: /upload/file (và đường dẫn con, không phân biệt hoa thường) trả JSON 413 như error middleware
// của Node (server/index.js 775-778); đường khác vẫn là trang 413 của Express.
func TestJSONBodyTooLargeUploadFile(t *testing.T) {
	e := engine(JSONBody(16))
	e.NoRoute(func(c *gin.Context) { c.String(200, "ok") })
	big := `{"a":"` + strings.Repeat("x", 64) + `"}`
	hdr := map[string]string{"Content-Type": "application/json"}
	for _, p := range []string{"/upload/file", "/upload/file?name=a.pdf", "/UPLOAD/File/x"} {
		w := hit(e, "POST", p, big, hdr)
		if w.Code != 413 || w.Body.String() != `{"error":"File quá lớn (tối đa 300MB) — hãy dán link thay vì tải lên."}` || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
			t.Errorf("%s: %d %s %q", p, w.Code, w.Header().Get("Content-Type"), w.Body.String())
		}
	}
	for _, p := range []string{"/api/x", "/upload/files", "/export/bang"} {
		w := hit(e, "POST", p, big, hdr)
		if w.Code != 413 || !strings.Contains(w.Body.String(), "<pre>Payload Too Large</pre>") {
			t.Errorf("%s: %d %q", p, w.Code, w.Body.String())
		}
	}
}
