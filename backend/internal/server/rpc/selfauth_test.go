package rpc

import "testing"

// SelfAuth chỉ dành cho route chỉ bản Go: đăng ký hàm /api/:fn với SelfAuth là lỗi lúc khởi động; GoRoute thì nhận.
func TestSelfAuthOnlyGoRoute(t *testing.T) {
	if SelfAuth&(Public|Admin|Super) != 0 || SelfAuth == Login {
		t.Fatalf("SelfAuth trùng bit với quyền khác: %d", SelfAuth)
	}
	r := NewRegistry()
	mustPanic(t, "SelfAuth chỉ dùng cho route chỉ bản Go", func() { r.Register("chatX", SelfAuth, noop) })
	r.RegisterGoRoute(GoRoute{Name: "chatMe", Method: "GET", Path: "/chat/me", Perm: SelfAuth})
	if g := r.GoRoutes(); len(g) != 1 || g[0].Perm != SelfAuth {
		t.Fatalf("GoRoutes: %+v", g)
	}
}
