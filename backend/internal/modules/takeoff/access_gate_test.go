package takeoff

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

// Phân quyền 3 cấp (N21): hàm ghi dòng bóc tách cần thao tác ở 1 tab QS có bảng dòng (Bóc tách, Chi phí, Dự án, Mua hàng,
// Xuất báo giá). Chưa có dòng phân quyền = như cũ (tab QS nào cũng đủ); dòng riêng chỉ cho xem -> sửa bị chặn ở cả cổng rpc lẫn REST; super luôn được; chưa nối Access = không kiểm.
func TestAccessGate(t *testing.T) {
	ctx := context.Background()
	s := New(Deps{Repo: &fakeRepo{}, Perms: stubPerms{}, Saver: &stubSaver{}})
	a := &actor.Actor{UID: "u", U: "an", R: "user", CT: "ct"}
	if err := s.accGate(ctx, a, "edit", "QS", accLines); err != nil {
		t.Errorf("chưa nối Access phải không kiểm: %v", err)
	}
	for _, c := range []struct {
		perms string
		grant *omap.Map
		ok    bool
	}{
		{"boc", nil, true},
		{"sanpham", nil, true},
		{"kinhdoanh", nil, false},
		{"boc", omap.Of("qs", omap.Of("boc", []any{"view"})), false},
		{"", omap.Of("qs", omap.Of("chiphi", []any{"view", "edit"})), true},
		{"dash", nil, true}, // chưa phân quyền: vào được QS là ghi được (cách cũ)
		{"", omap.Of("qs", omap.Of("sanpham", []any{"view", "edit"})), false}, // dòng chỉ có tab không có bảng dòng
		{"", omap.Of("qs", omap.Of("export", []any{"view", "edit"})), true},
	} {
		s.access = legacyAccess{perms: c.perms, grant: c.grant}
		if err := s.accGate(ctx, a, "edit", "QS", accLines); (err == nil) != c.ok {
			t.Errorf("perms %q grant %v: %v, mong được = %v", c.perms, c.grant, err, c.ok)
		}
	}
	if err := s.accGate(ctx, &actor.Actor{UID: "s", R: "super"}, "delete", "QS", accLines); err != nil {
		t.Errorf("super: %v", err)
	}

	s.access = legacyAccess{perms: "boc", grant: omap.Of("qs", omap.Of("boc", []any{"view"}))}
	reg := rpc.NewRegistry()
	s.RegisterRPC(reg)
	if _, err := reg.Call(ctx, "updateLine", a, "l1", omap.Of("soLuong", 2.0)); err == nil || err.Error() != "Tài khoản không có quyền sửa ở QS" {
		t.Errorf("rpc updateLine: %v", err)
	}
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(func(c *gin.Context) { actor.Set(c, a) })
	s.RegisterRoutes(e.Group("/api/v1"))
	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest("DELETE", "/api/v1/lines/l1", nil))
	if w.Code != 403 || !strings.Contains(w.Body.String(), "Tài khoản không có quyền xoá ở QS") {
		t.Errorf("REST xoá dòng: %d %s", w.Code, w.Body.String())
	}
}
