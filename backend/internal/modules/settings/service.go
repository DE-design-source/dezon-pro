// Package settings: cài đặt mặc định TOÀN HỆ THỐNG (giao diện, chung, hiển thị) do Siêu quản trị viên lưu,
// mọi tài khoản đăng nhập đọc được. Chỉ bản Go: REST /api/v1/system-defaults (không có hàm /api/:fn).
// Bảng cai_dat_he_thong = system_settings (migration 0047), không theo công ty.
package settings

import (
	"context"
	"strings"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// sections: các mục mặc định, đúng thứ tự khoá của kết quả GET.
var sections = []string{"appearance", "general", "display"}

// maxValueBytes: giới hạn kích thước JSON của 1 mục.
const maxValueBytes = 64 * 1024

// Deps: do internal/server/routes.go truyền vào. Repo chỉ dùng trong test (bỏ trống = Postgres).
type Deps struct {
	DB   *database.DB
	Cfg  *config.Config
	Repo Repository
}

// Service: nghiệp vụ cài đặt mặc định hệ thống.
type Service struct {
	repo Repository
	now  func() string
}

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = NewRepository(d.DB)
	}
	return &Service{repo: repo, now: jsval.NowISO}
}

// thieuBang: database chưa chạy migration 0047 (bảng system_settings chưa có).
func thieuBang(err error) bool {
	switch database.CodeOf(err) {
	case "PGRST205", "42P01":
		return true
	}
	m := err.Error()
	return strings.Contains(m, "system_settings") && strings.Contains(m, "does not exist")
}

func validSection(sec string) bool {
	for _, s := range sections {
		if s == sec {
			return true
		}
	}
	return false
}

func emptyDefaults() *omap.Map {
	out := omap.New()
	for _, s := range sections {
		out.Set(s, nil)
	}
	return out.Set("updatedAt", nil).Set("updatedBy", nil)
}

// GetDefaults: {appearance, general, display, updatedAt, updatedBy}; mục chưa lưu = null.
// updatedAt / updatedBy lấy từ dòng sửa gần nhất. Chưa có bảng -> toàn null (ghi log), app vẫn chạy.
func (s *Service) GetDefaults(ctx context.Context) (*omap.Map, error) {
	rows, err := s.repo.ListSettings(ctx)
	if err != nil {
		if thieuBang(err) {
			logger.Error("settings", "chưa có bảng system_settings (migration 0047_system_settings), trả mặc định rỗng:", err.Error())
			return emptyDefaults(), nil
		}
		return nil, err
	}
	out := emptyDefaults()
	first := true
	for _, r := range rows {
		k := jsval.S(r.Val("khoa"))
		if !validSection(k) {
			continue
		}
		v := r.Val("gia_tri")
		if jsval.IsUndefined(v) {
			v = nil
		}
		out.Set(k, v)
		if first {
			first = false
			out.Set("updatedAt", nullable(r.Val("cap_nhat")))
			out.Set("updatedBy", nullable(r.Val("nguoi_sua")))
		}
	}
	return out, nil
}

func nullable(v any) any {
	if jsval.IsNullish(v) {
		return nil
	}
	return v
}

// SaveDefault: ghi đè (hoặc xoá khi value null / thiếu) mặc định của 1 mục. Chỉ super (gắn ở route).
func (s *Service) SaveDefault(ctx context.Context, a *actor.Actor, section string, value any) (*omap.Map, error) {
	if !validSection(section) {
		return nil, apperr.BadRequest("Mục mặc định không hợp lệ: " + section)
	}
	if jsval.IsNullish(value) {
		if err := s.repo.DeleteSetting(ctx, section); err != nil {
			return nil, migErr(err)
		}
		return omap.Of("ok", true), nil
	}
	if _, ok := value.(*omap.Map); !ok {
		return nil, apperr.BadRequest("Giá trị mặc định phải là object")
	}
	js, err := omap.MarshalString(value)
	if err != nil {
		return nil, apperr.BadRequest("Giá trị mặc định phải là object")
	}
	if len(js) > maxValueBytes {
		return nil, apperr.BadRequest("Giá trị mặc định quá lớn (tối đa 64 KB)")
	}
	nguoiSua := ""
	if a != nil {
		nguoiSua = a.U
	}
	row := omap.Of("khoa", section, "gia_tri", value, "cap_nhat", s.now(), "nguoi_sua", nguoiSua)
	co, err := s.repo.FindSetting(ctx, section)
	if err != nil {
		return nil, migErr(err)
	}
	if len(co) > 0 {
		err = s.repo.UpdateSetting(ctx, section, row)
	} else {
		// 2 lần lưu cùng lúc: lần sau gặp trùng khoá thì ghi đè
		if err = s.repo.InsertSetting(ctx, row); database.CodeOf(err) == "23505" {
			err = s.repo.UpdateSetting(ctx, section, row)
		}
	}
	if err != nil {
		return nil, migErr(err)
	}
	return omap.Of("ok", true), nil
}

// migErr: chưa chạy migration 0047 -> báo đúng nguyên nhân; lỗi khác trả nguyên.
func migErr(err error) error {
	if err != nil && thieuBang(err) {
		return apperr.New("Chưa có bảng cài đặt mặc định hệ thống (migration 0047_system_settings). " + apperr.HDMig)
	}
	return err
}
