// Package integration: test đầu-cuối trên database THỬ (TEST_DATABASE_URL). Không đặt biến thì bỏ qua.
//
// Gọi hàm notifList THẬT của module notifications (server đã nối đủ module) qua cổng /api/:fn
// để kiểm tra trọn chuỗi: thân JSON -> xác thực -> ngữ cảnh công ty -> tầng dữ liệu -> JSON trả về.
package integration

import (
	"context"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"qspro-backend/internal/config"
	"qspro-backend/internal/modules/system"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/server"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

type sessions struct{ a *actor.Actor }

func (s sessions) SessionActor(_ context.Context, tok string) (*actor.Actor, error) {
	if tok == "ok" {
		return s.a, nil
	}
	return nil, nil
}

func TestEndToEnd(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	dir := t.TempDir()
	cfg := &config.Config{DatabaseURL: url, StaticDir: dir, VendorDir: dir, AppVer: "it"}
	srv := server.New(&server.Deps{Cfg: cfg})
	d := srv.Deps()
	t.Cleanup(d.DB.Close)
	ctx := context.Background()

	if err := system.New(system.Deps{DB: d.DB, Cfg: cfg}).Ready(ctx); err != nil {
		t.Fatalf("database chưa sẵn sàng: %v", err)
	}
	users, err := d.DB.Select(ctx, "users", database.SelectOpt{Select: "id,username,role,cong_ty_id", Filter: "cong_ty_id=not.is.null", Order: "username.asc", Limit: 1, NoScope: true})
	if err != nil {
		t.Fatalf("không đọc được users: %v", err)
	}
	if len(users) == 0 {
		t.Skip("chưa có user thuộc công ty: cần database đã nạp seed (qspro_gotest)")
	}
	u := users[0]
	me := &actor.Actor{UID: u.Val("id"), U: jsval.AsString(u.Val("username")), R: "staff", CT: u.Val("cong_ty_id")}
	d.Sessions.Set(sessions{me})
	d.Reg.Register("myCompanyUsers", rpc.Login, func(ctx context.Context, a *actor.Actor, _ rpc.Args) (any, error) {
		return d.DB.Select(ctx, "users", database.SelectOpt{Select: "cong_ty_id"})
	})

	call := func(fn, tok, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/"+fn, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		srv.Engine().ServeHTTP(w, r)
		return w
	}
	if w := call("notifList", "", `{"args":[5]}`); w.Code != 401 || w.Body.String() != `{"error":"Chưa đăng nhập","code":"NOAUTH"}` {
		t.Errorf("chưa đăng nhập: %d %s", w.Code, w.Body.String())
	}
	w := call("notifList", "ok", `{"args":[5]}`)
	if w.Code != 200 || !strings.HasPrefix(w.Body.String(), `{"ok":true,"result":[`) {
		t.Fatalf("notifList: %d %s", w.Code, w.Body.String())
	}
	v, err := omap.Decode(w.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	list := jsval.AsArray(jsval.AsMap(v).Val("result"))
	if len(list) > 5 {
		t.Errorf("limit không có tác dụng: %d dòng", len(list))
	}
	if len(list) > 0 {
		if ks := strings.Join(jsval.AsMap(list[0]).Keys(), ","); ks != "id,kind,title,body,refId,read,at" {
			t.Errorf("thứ tự khoá: %s", ks)
		}
	}
	// ngữ cảnh công ty đi tới tầng dữ liệu: chỉ thấy người của công ty mình
	w = call("myCompanyUsers", "ok", `{}`)
	v, _ = omap.Decode(w.Body.Bytes())
	rows := jsval.AsArray(jsval.AsMap(v).Val("result"))
	if w.Code != 200 || len(rows) == 0 {
		t.Fatalf("myCompanyUsers: %d %s", w.Code, w.Body.String())
	}
	for _, r := range rows {
		if jsval.AsMap(r).Val("cong_ty_id") != me.CT {
			t.Fatalf("lọt dòng của công ty khác: %v", r)
		}
	}
}
