package settings

import (
	"context"

	"qspro-backend/internal/shared/omap"
)

// Repository: kho cài đặt mặc định toàn hệ thống (bảng cai_dat_he_thong = system_settings, không theo công ty).
type Repository interface {
	// ListSettings: mọi dòng {khoa, gia_tri, cap_nhat, nguoi_sua}, mới sửa trước.
	ListSettings(ctx context.Context) ([]*omap.Map, error)
	FindSetting(ctx context.Context, khoa string) ([]*omap.Map, error)
	UpdateSetting(ctx context.Context, khoa string, row *omap.Map) error
	InsertSetting(ctx context.Context, row *omap.Map) error
	DeleteSetting(ctx context.Context, khoa string) error
}
