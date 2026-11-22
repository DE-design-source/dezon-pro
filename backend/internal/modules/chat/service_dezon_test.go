package chat

import (
	"context"
	"strings"
	"testing"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

func TestDezonName(t *testing.T) {
	long := strings.Repeat("Ư", 120)
	for _, c := range []struct{ full, user, want string }{
		{"  Nguyễn Văn An ", "an", "Nguyễn Văn An"},
		{"", "an.nv", "an.nv"},
		{"   ", "", "Người dùng"},
		{"a\x00b", "x", "ab"},
		{long, "x", strings.Repeat("Ư", 100)},
	} {
		if got := dezonName(c.full, c.user); got != c.want {
			t.Errorf("dezonName(%q, %q) = %q, muốn %q", c.full, c.user, got, c.want)
		}
	}
}

func TestDezonAllowed(t *testing.T) {
	for _, c := range []struct {
		role, perms string
		grant       *omap.Map
		want        bool
	}{
		{"admin", "", nil, true},
		{"super", "", nil, true},
		{"staff", "boc,chat", nil, true},
		{"staff", "boc,chatx", nil, false},
		{"staff", "", nil, false},
		{"", "newsfeed", nil, false},
		{"staff", "chat", omap.Of("newsfeed", omap.Of("*", []any{"view"})), false}, // dòng phân quyền riêng thay perms
		{"staff", "", omap.Of("chat", omap.Of("main", []any{"view"})), true},
	} {
		s := New(Deps{Access: legacyAccess{perms: c.perms, grant: c.grant}})
		got, err := s.dezonAllowed(context.Background(), &actor.Actor{UID: "u1", R: c.role, CT: "ct"})
		if err != nil || got != c.want {
			t.Errorf("dezonAllowed(%q, %q, %v) = %v %v", c.role, c.perms, c.grant, got, err)
		}
	}
	if _, err := New(Deps{}).dezonAllowed(context.Background(), &actor.Actor{UID: "u1", R: "admin"}); err != errNoUsers {
		t.Errorf("thiếu Access: %v", err)
	}
}

// Chưa nối Users (routes.go) -> lỗi nội bộ (500), không panic; thiết bị sai báo trước khi đọc database.
func TestDezonLoginNoUsers(t *testing.T) {
	s := New(Deps{})
	a := &actor.Actor{UID: "00000000-0000-0000-0000-000000000001", R: "admin"}
	if _, err := s.DezonLogin(context.Background(), a, DezonInput{}); err != errNoUsers {
		t.Fatalf("thiếu Users: %v", err)
	}
	var in DezonInput
	in.Device.Platform = "symbian"
	_, err := s.DezonLogin(context.Background(), a, in)
	if codeOf(err) != CodeBadRequest {
		t.Fatalf("platform sai: %v", err)
	}
	w := call(engineFor(s), "POST", "/api/v1/chat/auth/dezon", "", `{}`)
	if w.Code != 401 || w.Body.String() != `{"error":"Chưa đăng nhập","code":"NOAUTH"}` {
		t.Fatalf("không phiên Dezon Pro: %d %s", w.Code, w.Body.String())
	}
}
