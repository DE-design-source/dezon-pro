package projects

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

// Phân quyền 3 cấp (N21): dữ liệu phụ của dự án / công ty ghi được từ QS, Kinh doanh, Marketing; tạo / xoá dự án theo tab
// Dự án (tạo còn từ Bóc tách); sửa thuộc tính dự án ở tab có bảng dòng. Chưa phân quyền (không dòng) = như cũ: vào được QS là ghi.
func TestAccessGate(t *testing.T) {
	ctx := context.Background()
	s := New(Deps{Repo: &fakeRepo{}})
	a := &actor.Actor{UID: "u", U: "an", R: "user", CT: "ct"}
	g := func(tab string, acts ...any) *omap.Map { return omap.Of("qs", omap.Of(tab, acts)) }
	for _, c := range []struct {
		name                    string
		perms                   string
		grant                   *omap.Map
		data, create, edit, del bool
	}{
		{"perms boc (cách cũ)", "boc", nil, true, true, true, true},
		{"perms dash (cách cũ: vào được QS là ghi)", "dash", nil, true, true, true, true},
		{"perms kinhdoanh", "kinhdoanh", nil, true, false, false, false},
		{"perms marketing", "marketing", nil, true, false, false, false},
		{"perms thietke", "thietke", nil, false, false, false, false},
		{"dòng: Dự án đủ quyền", "", g("duan", "view", "create", "edit", "delete"), true, true, true, true},
		{"dòng: Bóc tách thêm + sửa", "", g("boc", "view", "create", "edit"), true, true, true, false},
		{"dòng: Chi phí sửa", "", g("chiphi", "view", "edit"), true, false, true, false},
		{"dòng: Danh sách sản phẩm", "", g("sanpham", "view", "create", "edit", "delete"), true, false, false, false},
	} {
		s.access = legacyAccess{perms: c.perms, grant: c.grant}
		for _, x := range []struct {
			what, action string
			where        []accScope
			want         bool
		}{
			{"dữ liệu phụ", "edit", accProjData, c.data},
			{"tạo", "create", accProjCreate, c.create},
			{"sửa", "edit", accProjEdit, c.edit},
			{"xoá", "delete", accProjTab, c.del},
		} {
			if err := s.accGate(ctx, a, x.action, "QS", x.where); (err == nil) != x.want {
				t.Errorf("%s: %s = %v, muốn %v", c.name, x.what, err, x.want)
			}
		}
	}
}

// Nhập dự án từ dezon.vn (REST chỉ bản Go): ngoài RequireAdmin còn cổng N21 như tạo dự án - POST = thêm, GET (trạng thái) = xem
// ở tab Dự án / Bóc tách / Danh sách dự án. Admin bị thu hẹp quyền về tab khác bị chặn 403; nhân viên bị RequireAdmin chặn trước.
func TestDezonImportRouteGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	g := func(tab string, acts ...any) *omap.Map { return omap.Of("qs", omap.Of(tab, acts)) }
	for _, c := range []struct {
		name      string
		role      string
		grant     *omap.Map
		post, get bool // qua được cổng quyền
	}{
		{"admin chưa phân quyền", "admin", nil, true, true},
		{"admin: Dự án thêm", "admin", g("duan", "view", "create"), true, true},
		{"admin: Bóc tách chỉ xem", "admin", g("boc", "view"), false, true},
		{"admin: chỉ Chi phí", "admin", g("chiphi", "view", "edit"), false, false},
		{"nhân viên đủ quyền Dự án", "user", g("duan", "view", "create"), false, false},
	} {
		s := New(Deps{Repo: &fakeRepo{}})
		s.access = legacyAccess{grant: c.grant}
		e := gin.New()
		a := &actor.Actor{UID: "u", U: "an", R: c.role, CT: "ct"}
		e.Use(func(ctx *gin.Context) { actor.Set(ctx, a) })
		s.RegisterRoutes(e.Group("/api/v1"))
		for _, x := range []struct {
			method, action string
			want           bool
		}{{"POST", "thêm", c.post}, {"GET", "xem", c.get}} {
			w := httptest.NewRecorder()
			e.ServeHTTP(w, httptest.NewRequest(x.method, "/api/v1/projects/import-dezonvn", strings.NewReader("{}")))
			denied := w.Code == 403
			if denied == x.want {
				t.Errorf("%s: %s = %d %s, muốn qua cổng = %v", c.name, x.method, w.Code, w.Body.String(), x.want)
			}
			if c.role == "admin" && denied && !strings.Contains(w.Body.String(), "Tài khoản không có quyền "+x.action+" ở QS > Dự án") {
				t.Errorf("%s: %s thông báo = %s", c.name, x.method, w.Body.String())
			}
		}
	}
}
