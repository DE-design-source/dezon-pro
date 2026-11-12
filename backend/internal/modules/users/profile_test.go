package users

import (
	"context"
	"strings"
	"testing"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
)

// UpdateMyProfile: tự sửa họ tên / email của chính mình; khoá khác (vai trò, quyền, phòng ban, công ty) bị bỏ qua.
func TestUpdateMyProfile(t *testing.T) {
	ctx := context.Background()
	me := &actor.Actor{UID: "u1", U: "nv", R: "staff", CT: "c1"}
	newRepo := func() *emailRepo {
		return &emailRepo{
			user:   omap.Of("id", "u1", "username", "nv", "ho_ten", "Nguyễn A", "role", "staff", "cong_ty_id", "c1", "email", "a@cty.vn", "phong_ban", "QS", "active", true),
			others: []*omap.Map{omap.Of("id", "u2", "cong_ty_id", "c1", "email", "trung@cty.vn")},
		}
	}
	cases := []struct {
		name   string
		fields *omap.Map
		err    string
		patch  string // JSON patch ghi xuống; "" = không ghi
		hoTen  string // hoTen trong kết quả
	}{
		{"sửa họ tên (trim)", omap.Of("hoTen", "  Nguyễn Văn A "), "", `{"ho_ten":"Nguyễn Văn A"}`, "Nguyễn Văn A"},
		{"sửa email (chuẩn hoá)", omap.Of("email", " Moi@Cty.VN"), "", `{"email":"moi@cty.vn"}`, "Nguyễn A"},
		{"cả hai", omap.Of("hoTen", "B", "email", "b@cty.vn"), "", `{"ho_ten":"B","email":"b@cty.vn"}`, "B"},
		{"không đổi -> không ghi", omap.Of("hoTen", "Nguyễn A", "email", "A@cty.vn"), "", "", "Nguyễn A"},
		{"khoá khác bị bỏ qua", omap.Of("role", "admin", "perms", []any{"x"}, "phongBan", "KD", "congTyId", "c9"), "", "", "Nguyễn A"},
		{"email trùng trong công ty", omap.Of("email", "Trung@cty.vn"), msgEmailDup, "", ""},
		{"email sai dạng", omap.Of("email", "khong-hop-le"), msgEmailBad, "", ""},
		{"họ tên quá dài", omap.Of("hoTen", strings.Repeat("a", 101)), "Họ tên tối đa 100 ký tự", "", ""},
		{"body rỗng", nil, "", "", "Nguyễn A"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := newRepo()
			res, err := (&Service{repo: r}).UpdateMyProfile(ctx, me, c.fields)
			if c.err != "" {
				if err == nil || err.Error() != c.err {
					t.Fatalf("lỗi = %v, muốn %q", err, c.err)
				}
				if len(r.patches) != 0 {
					t.Errorf("lỗi mà vẫn ghi: %s", js(r.patches))
				}
				return
			}
			if err != nil {
				t.Fatalf("lỗi bất ngờ: %v", err)
			}
			got := ""
			if len(r.patches) > 0 {
				got = js(r.patches[0])
			}
			if got != c.patch {
				t.Errorf("patch = %s, muốn %s", got, c.patch)
			}
			if res.Val("hoTen") != c.hoTen || res.Val("role") != "staff" || res.Val("phongBan") != "QS" {
				t.Errorf("kết quả = %s", js(res))
			}
		})
	}
	// tài khoản đã khoá / không còn -> báo không tìm thấy, không ghi
	r := newRepo()
	r.user.Set("active", false)
	if _, err := (&Service{repo: r}).UpdateMyProfile(ctx, me, omap.Of("hoTen", "X")); err == nil || err.Error() != msgNotFound || len(r.patches) != 0 {
		t.Errorf("tài khoản khoá: %v %d", err, len(r.patches))
	}
}
