package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qspro-backend/internal/config"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// fakeSessions: token "u" / "a" / "s" -> user / admin / super; "m" -> subadmin (M14.7, chỉ dùng ở test riêng);
// "err" -> lỗi kiểm tra phiên.
type fakeSessions struct{}

func (fakeSessions) SessionActor(_ context.Context, tok string) (*actor.Actor, error) {
	switch tok {
	case "u":
		return &actor.Actor{UID: "uid-u", U: "user", R: "staff", CT: "ct-1", Exp: 1}, nil
	case "m":
		return &actor.Actor{UID: "uid-m", U: "subadmin", R: "subadmin", CT: "ct-1", Exp: 1}, nil
	case "a":
		return &actor.Actor{UID: "uid-a", U: "admin", R: "admin", CT: "ct-1", Exp: 1}, nil
	case "s":
		return &actor.Actor{UID: "uid-s", U: "root", R: "super", CT: nil, Exp: 1}, nil
	case "err":
		return nil, errors.New("db hỏng")
	}
	return nil, nil
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	dir := t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>QS</html>"), 0o644))
	must(os.WriteFile(filepath.Join(dir, "app.js"), []byte("var a=1;"), 0o644))
	must(os.WriteFile(filepath.Join(dir, "logo.svg"), []byte("<svg/>"), 0o644))
	must(os.WriteFile(filepath.Join(dir, ".secret"), []byte("x"), 0o644))
	vendor := filepath.Join(dir, "nm", "jsuites", "dist")
	must(os.MkdirAll(vendor, 0o755))
	must(os.WriteFile(filepath.Join(vendor, "jsuites.js"), []byte("js"), 0o644))
	cfg := &config.Config{Port: 0, StaticDir: dir, VendorDir: filepath.Join(dir, "nm"), AppVer: "ver-1"}
	s := New(&Deps{Cfg: cfg})
	s.deps.Sessions.Set(fakeSessions{})
	reg := s.deps.Reg
	reg.Register("pub", rpc.Public, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return omap.Of("z", args.Arg(0), "a", a == nil, "n", float64(args.Len()), "u", jsval.Undefined), nil
	})
	reg.Register("who", rpc.Login, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		tc := tenant.From(ctx)
		return omap.Of("actor", a, "uid", tc.UID, "role", tc.Role, "ct", tc.CongTyID, "viewAs", tc.ViewAs,
			"tenantId", tenant.TenantID(ctx), "scoped", tenant.Scoped(ctx), "sameActor", actor.From(ctx) == a), nil
	})
	reg.Register("adminOnly", rpc.Admin, func(context.Context, *actor.Actor, rpc.Args) (any, error) { return "ok", nil })
	reg.Register("superOnly", rpc.Super, func(context.Context, *actor.Actor, rpc.Args) (any, error) { return 1.5, nil })
	reg.Register("both", rpc.Admin|rpc.Super, func(context.Context, *actor.Actor, rpc.Args) (any, error) { return true, nil })
	reg.Register("undef", rpc.Login, func(context.Context, *actor.Actor, rpc.Args) (any, error) { return jsval.Undefined, nil })
	reg.Register("nilMap", rpc.Login, func(context.Context, *actor.Actor, rpc.Args) (any, error) { return (*omap.Map)(nil), nil })
	reg.Register("boom", rpc.Login, func(context.Context, *actor.Actor, rpc.Args) (any, error) {
		return nil, errors.New("Không tìm thấy dự án <b>")
	})
	reg.Register("boomEmpty", rpc.Login, func(context.Context, *actor.Actor, rpc.Args) (any, error) { return nil, errors.New("") })
	reg.Register("panic", rpc.Login, func(context.Context, *actor.Actor, rpc.Args) (any, error) { panic("hỏng") })
	return s
}

type req struct {
	method, path, body, token, ctype string
	hdr                              map[string]string
}

func do(s *Server, r req) *httptest.ResponseRecorder {
	var body *strings.Reader
	if r.method == "" {
		r.method = "POST"
	}
	body = strings.NewReader(r.body)
	q := httptest.NewRequest(r.method, r.path, body)
	if r.body != "" {
		if r.ctype == "" {
			r.ctype = "application/json"
		}
		q.Header.Set("Content-Type", r.ctype)
	}
	if r.token != "" {
		q.Header.Set("Authorization", "Bearer "+r.token)
	}
	for k, v := range r.hdr {
		q.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	s.Engine().ServeHTTP(w, q)
	return w
}

func expect(t *testing.T, name string, w *httptest.ResponseRecorder, status int, body string) {
	t.Helper()
	if w.Code != status || w.Body.String() != body {
		t.Errorf("%s:\n got %d %s\nwant %d %s", name, w.Code, w.Body.String(), status, body)
	}
}

func TestRPCDispatcher(t *testing.T) {
	s := newTestServer(t)

	w := do(s, req{path: "/api/khongCo", body: `{"args":[]}`})
	expect(t, "hàm lạ", w, 404, `{"error":"Không hỗ trợ hàm: khongCo"}`)
	if w.Header().Get("x-app-ver") != "ver-1" || w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Errorf("header: %v", w.Header())
	}
	expect(t, "hàm lạ không thân", do(s, req{path: "/api/khongCo"}), 404, `{"error":"Không hỗ trợ hàm: khongCo"}`)

	expect(t, "chưa đăng nhập", do(s, req{path: "/api/who", body: `{"args":[]}`}), 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`)
	expect(t, "token sai", do(s, req{path: "/api/who", token: "zzz"}), 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`)
	expect(t, "lỗi kiểm tra phiên", do(s, req{path: "/api/who", token: "err"}), 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`)
	expect(t, "token không phải chuỗi", do(s, req{path: "/api/who", body: `{"token":123}`}), 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`)
	expect(t, "admin: chưa đăng nhập", do(s, req{path: "/api/adminOnly"}), 401, `{"error":"Chưa đăng nhập","code":"NOAUTH"}`)
	expect(t, "admin: user", do(s, req{path: "/api/adminOnly", token: "u"}), 403, `{"error":"Không có quyền (chỉ Admin)"}`)
	expect(t, "admin: admin", do(s, req{path: "/api/adminOnly", token: "a"}), 200, `{"ok":true,"result":"ok"}`)
	expect(t, "admin: super", do(s, req{path: "/api/adminOnly", token: "s"}), 200, `{"ok":true,"result":"ok"}`)
	expect(t, "super: admin", do(s, req{path: "/api/superOnly", token: "a"}), 403, `{"error":"Chỉ quản trị hệ thống"}`)
	expect(t, "super: super", do(s, req{path: "/api/superOnly", token: "s"}), 200, `{"ok":true,"result":1.5}`)
	expect(t, "cả hai: user", do(s, req{path: "/api/both", token: "u"}), 403, `{"error":"Không có quyền (chỉ Admin)"}`)
	expect(t, "cả hai: admin", do(s, req{path: "/api/both", token: "a"}), 403, `{"error":"Chỉ quản trị hệ thống"}`)
	expect(t, "cả hai: super", do(s, req{path: "/api/both", token: "s"}), 200, `{"ok":true,"result":true}`)

	expect(t, "public không token", do(s, req{path: "/api/pub", body: `{"args":[{"b":1,"a":[2,"<x>"]},2]}`}), 200,
		`{"ok":true,"result":{"z":{"b":1,"a":[2,"<x>"]},"a":true,"n":2}}`)
	expect(t, "args không phải mảng", do(s, req{path: "/api/pub", body: `{"args":{"0":1}}`}), 200, `{"ok":true,"result":{"z":null,"a":true,"n":0}}`)
	expect(t, "thân là mảng", do(s, req{path: "/api/pub", body: `[1,2]`}), 200, `{"ok":true,"result":{"z":null,"a":true,"n":0}}`)
	expect(t, "thân không phải JSON", do(s, req{path: "/api/pub", body: `args=1`, ctype: "application/x-www-form-urlencoded"}), 200, `{"ok":true,"result":{"z":null,"a":true,"n":0}}`)
	expect(t, "public có token", do(s, req{path: "/api/pub", token: "u", body: `{"args":["x"]}`}), 200, `{"ok":true,"result":{"z":"x","a":false,"n":1}}`)

	expect(t, "token trong body", do(s, req{path: "/api/who", body: `{"token":"u","args":[]}`}), 200,
		`{"ok":true,"result":{"actor":{"uid":"uid-u","u":"user","r":"staff","ct":"ct-1","exp":1},"uid":"uid-u","role":"staff","ct":"ct-1","viewAs":null,"tenantId":"ct-1","scoped":true,"sameActor":true}}`)
	expect(t, "user gửi x-view-company bị bỏ qua", do(s, req{path: "/api/who", token: "u", hdr: map[string]string{"x-view-company": "ct-9"}}), 200,
		`{"ok":true,"result":{"actor":{"uid":"uid-u","u":"user","r":"staff","ct":"ct-1","exp":1},"uid":"uid-u","role":"staff","ct":"ct-1","viewAs":null,"tenantId":"ct-1","scoped":true,"sameActor":true}}`)
	expect(t, "super không chọn công ty", do(s, req{path: "/api/who", token: "s", hdr: map[string]string{"Authorization": "bearer   s"}}), 200,
		`{"ok":true,"result":{"actor":{"uid":"uid-s","u":"root","r":"super","ct":null,"exp":1},"uid":"uid-s","role":"super","ct":null,"viewAs":null,"tenantId":null,"scoped":false,"sameActor":true}}`)
	expect(t, "super xem như công ty", do(s, req{path: "/api/who", token: "s", hdr: map[string]string{"x-view-company": "ct-9"}}), 200,
		`{"ok":true,"result":{"actor":{"uid":"uid-s","u":"root","r":"super","ct":null,"exp":1},"uid":"uid-s","role":"super","ct":null,"viewAs":"ct-9","tenantId":"ct-9","scoped":true,"sameActor":true}}`)

	expect(t, "undefined -> null", do(s, req{path: "/api/undef", token: "u"}), 200, `{"ok":true,"result":null}`)
	expect(t, "map nil -> null", do(s, req{path: "/api/nilMap", token: "u"}), 200, `{"ok":true,"result":null}`)
	expect(t, "lỗi handler", do(s, req{path: "/api/boom", token: "u"}), 500, `{"error":"Không tìm thấy dự án <b>"}`)
	expect(t, "lỗi không thông báo", do(s, req{path: "/api/boomEmpty", token: "u"}), 500, `{"error":"Lỗi máy chủ"}`)
	expect(t, "panic", do(s, req{path: "/api/panic", token: "u"}), 500, `{"error":"hỏng"}`)

	if w := do(s, req{path: "/api/pub", body: `{"args":[`}); w.Code != 400 {
		t.Errorf("JSON hỏng phải 400, được %d", w.Code)
	}
	if w := do(s, req{path: "/api/pub", body: `"chuỗi"`}); w.Code != 400 {
		t.Errorf("JSON không phải object / mảng phải 400, được %d", w.Code)
	}
	if w := do(s, req{method: "GET", path: "/api/pub"}); w.Code != 404 || !strings.Contains(w.Body.String(), "<pre>Cannot GET /api/pub</pre>") {
		t.Errorf("GET /api/pub: %d %s", w.Code, w.Body.String())
	}
}

func TestRegistryDuplicatePanics(t *testing.T) {
	reg := rpc.NewRegistry()
	h := func(context.Context, *actor.Actor, rpc.Args) (any, error) { return nil, nil }
	reg.Register("x", rpc.Login, h)
	defer func() {
		if recover() == nil {
			t.Error("đăng ký trùng tên phải panic")
		}
	}()
	reg.Register("x", rpc.Admin, h)
}

func TestArgs(t *testing.T) {
	a := rpc.Args{"s", 2.0, nil, omap.Of("k", 1.0), []any{1.0}, false}
	if a.Len() != 6 || a.Arg(9) != nil || !jsval.IsUndefined(a.ArgU(9)) || a.ArgU(2) != nil || a.Has(6) || !a.Has(5) {
		t.Error("Arg / ArgU / Has")
	}
	if a.Str(0) != "s" || a.Str(1) != "2" || a.Str(2) != "" || a.Str(9) != "" || a.Num(1) != 2 || a.Num(2) != 0 || a.Num(9) == a.Num(9) {
		t.Error("Str / Num")
	}
	if a.Map(3).Val("k") != 1.0 || a.Map(0) != nil || len(a.Arr(4)) != 1 || a.Arr(3) != nil || a.Bool(5) || !a.Bool(0) || a.Bool(9) {
		t.Error("Map / Arr / Bool")
	}
}

func TestStaticAndHealth(t *testing.T) {
	s := newTestServer(t)
	get := func(path string, hdr map[string]string) *httptest.ResponseRecorder {
		return do(s, req{method: "GET", path: path, hdr: hdr})
	}
	w := get("/healthz", nil)
	expect(t, "healthz", w, 200, `{"ok":true}`)

	w = get("/", nil)
	expect(t, "index", w, 200, "<html>QS</html>")
	if w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("Content-Type") != "text/html; charset=UTF-8" || w.Header().Get("ETag") == "" || w.Header().Get("Last-Modified") == "" {
		t.Errorf("header index: %v", w.Header())
	}
	if w2 := get("/", map[string]string{"If-None-Match": w.Header().Get("ETag")}); w2.Code != 304 {
		t.Errorf("If-None-Match phải 304, được %d", w2.Code)
	}
	w = get("/app.js", nil)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-cache" || w.Header().Get("Content-Type") != "application/javascript; charset=UTF-8" {
		t.Errorf("app.js: %d %v", w.Code, w.Header())
	}
	w = get("/logo.svg", nil)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "public, max-age=0" || w.Header().Get("Content-Type") != "image/svg+xml" {
		t.Errorf("logo.svg: %d %v", w.Code, w.Header())
	}
	w = get("/vendor/jsuites/jsuites.js", nil)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "public, max-age=604800" || w.Body.String() != "js" {
		t.Errorf("vendor: %d %v", w.Code, w.Header())
	}
	for _, p := range []string{"/.secret", "/khong-co.js", "/../go.mod", "/app.js/", "/vendor/jsuites/none.js", "/nm/jsuites/dist/"} {
		if w := get(p, nil); w.Code != 404 {
			t.Errorf("%s phải 404, được %d", p, w.Code)
		}
	}
	w = get("/khong-co", nil)
	if w.Code != 404 || !strings.Contains(w.Body.String(), "<pre>Cannot GET /khong-co</pre>") || w.Header().Get("Content-Security-Policy") != "default-src 'none'" {
		t.Errorf("404: %d %s", w.Code, w.Body.String())
	}
	if w := do(s, req{method: "POST", path: "/app.js"}); w.Code != http.StatusNotFound {
		t.Errorf("POST file tĩnh phải rơi xuống 404, được %d", w.Code)
	}
}
