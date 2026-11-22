package projects

import (
	"context"
	"testing"

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
