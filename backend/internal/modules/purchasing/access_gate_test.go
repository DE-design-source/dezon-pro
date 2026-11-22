package purchasing

import (
	"context"
	"testing"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

// Phân quyền 3 cấp (N21): mua hàng được khi có thao tác ở tab Mua hàng của QS HOẶC trang Mua hàng; duyệt cần approve.
func TestAccessGate(t *testing.T) {
	ctx := context.Background()
	s := New(Deps{Repo: &fakeRepo{}})
	a := &actor.Actor{UID: "u", U: "an", R: "user", CT: "ct"}
	for _, c := range []struct {
		perms, action string
		grant         *omap.Map
		ok            bool
	}{
		{"muahang", "create", nil, true},
		{"boc", "view", nil, false},
		{"", "create", omap.Of("muahang", omap.Of("main", []any{"view", "create"})), true},
		{"", "create", omap.Of("qs", omap.Of("muahang", []any{"view"})), false},
		{"", "view", omap.Of("qs", omap.Of("muahang", []any{"view"})), true},
		{"muahang", "approve", omap.Of("muahang", omap.Of("main", []any{"view"})), false},
	} {
		s.access = legacyAccess{perms: c.perms, grant: c.grant}
		if err := s.accGate(ctx, a, c.action, "Mua hàng", accMua); (err == nil) != c.ok {
			t.Errorf("perms %q %s grant %v: %v, mong được = %v", c.perms, c.action, c.grant, err, c.ok)
		}
	}
	s.access = legacyAccess{perms: "boc"}
	reg := rpc.NewRegistry()
	s.RegisterRPC(reg)
	if _, err := reg.Call(ctx, "getPurchaseOrders", a, "DA1"); err == nil || err.Error() != "Tài khoản không có quyền xem ở Mua hàng" {
		t.Errorf("rpc getPurchaseOrders: %v", err)
	}
}
