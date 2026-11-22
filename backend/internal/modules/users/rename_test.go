package users

import (
	"context"
	"errors"
	"testing"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// renameSpy: ghi lại lời gọi UserRenamed "công ty|username|tên cũ|tên mới".
type renameSpy struct {
	calls []string
	err   error
}

func (r *renameSpy) UserRenamed(_ context.Context, ct any, username, oldName, newName string) error {
	r.calls = append(r.calls, jsval.StrOr(ct, "")+"|"+username+"|"+oldName+"|"+newName)
	return r.err
}

// Đổi họ tên (admin sửa / tự sửa) -> báo listener với công ty CỦA TÀI KHOẢN bị đổi; tên không đổi -> không báo;
// lỗi listener không đổi kết quả.
func TestRenameListener(t *testing.T) {
	newRepo := func() *emailRepo {
		return &emailRepo{user: omap.Of("id", "u1", "username", "tuan", "ho_ten", "Tuấn", "role", "staff", "cong_ty_id", "c1", "email", "", "active", true)}
	}
	super := &actor.Actor{UID: "s", U: "sa", R: "super"}
	admin := &actor.Actor{UID: "a", U: "ad", R: "admin", CT: "c1"}
	ctxAdmin := tenant.With(context.Background(), tenant.Ctx{UID: "a", Role: "admin", CongTyID: "c1"})
	cases := []struct {
		name   string
		run    func(s *Service) (*omap.Map, error)
		want   string // "" = không gọi
		listen error
	}{
		{"super sửa họ tên tài khoản công ty c1", func(s *Service) (*omap.Map, error) {
			return s.AdminUpdateUser(context.Background(), super, "u1", omap.Of("hoTen", " Nguyễn Quốc Tuấn "))
		}, "c1|tuan|Tuấn|Nguyễn Quốc Tuấn", nil},
		{"admin c1 sửa", func(s *Service) (*omap.Map, error) {
			return s.AdminUpdateUser(ctxAdmin, admin, "u1", omap.Of("hoTen", "Nguyễn Quốc Tuấn"))
		}, "c1|tuan|Tuấn|Nguyễn Quốc Tuấn", nil},
		{"super chuyển công ty + đổi tên -> công ty cũ (nơi lưu tên cũ)", func(s *Service) (*omap.Map, error) {
			return s.AdminUpdateUser(context.Background(), super, "u1", omap.Of("hoTen", "Tuấn B", "congTyId", "c2"))
		}, "c1|tuan|Tuấn|Tuấn B", nil},
		{"tên giữ nguyên (chỉ khác khoảng trắng)", func(s *Service) (*omap.Map, error) {
			return s.AdminUpdateUser(context.Background(), super, "u1", omap.Of("hoTen", " Tuấn "))
		}, "", nil},
		{"đổi về rỗng -> không báo", func(s *Service) (*omap.Map, error) {
			return s.AdminUpdateUser(context.Background(), super, "u1", omap.Of("hoTen", ""))
		}, "", nil},
		{"không gửi hoTen", func(s *Service) (*omap.Map, error) {
			return s.AdminUpdateUser(context.Background(), super, "u1", omap.Of("phongBan", "KD"))
		}, "", nil},
		{"tự sửa hồ sơ", func(s *Service) (*omap.Map, error) {
			return s.UpdateMyProfile(context.Background(), &actor.Actor{UID: "u1", U: "tuan", R: "staff", CT: "c1"}, omap.Of("hoTen", "Nguyễn Quốc Tuấn"))
		}, "c1|tuan|Tuấn|Nguyễn Quốc Tuấn", nil},
		{"tự sửa, tên không đổi", func(s *Service) (*omap.Map, error) {
			return s.UpdateMyProfile(context.Background(), &actor.Actor{UID: "u1", U: "tuan", R: "staff", CT: "c1"}, omap.Of("hoTen", "Tuấn", "email", "t@cty.vn"))
		}, "", nil},
		{"listener lỗi -> vẫn trả kết quả", func(s *Service) (*omap.Map, error) {
			return s.UpdateMyProfile(context.Background(), &actor.Actor{UID: "u1", U: "tuan", R: "staff", CT: "c1"}, omap.Of("hoTen", "X"))
		}, "c1|tuan|Tuấn|X", errors.New("hỏng")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			spy := &renameSpy{err: c.listen}
			s := &Service{repo: newRepo()}
			s.SetRenameListener(spy)
			res, err := c.run(s)
			if err != nil || res == nil {
				t.Fatalf("lỗi = %v", err)
			}
			got := ""
			if len(spy.calls) > 0 {
				got = spy.calls[0]
			}
			if len(spy.calls) > 1 || got != c.want {
				t.Errorf("gọi = %v, muốn %q", spy.calls, c.want)
			}
		})
	}
	// chưa nối listener -> chạy bình thường
	if _, err := (&Service{repo: newRepo()}).UpdateMyProfile(context.Background(), &actor.Actor{UID: "u1"}, omap.Of("hoTen", "Y")); err != nil {
		t.Fatal(err)
	}
}
