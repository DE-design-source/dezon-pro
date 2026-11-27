package materials

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/response"
)

// Phân quyền 3 cấp (N21, chỉ bản Go): cổng rpc / REST của module bọc hàm lõi bằng accRPC / accMW - người đăng nhập phải có
// thao tác (view / create / edit / delete / approve / export) ở ít nhất 1 chỗ (module, tab) của danh mục quyền - đúng tab của
// giao diện gọi lệnh (pages/QS/state/qsAccess.js). Chưa có dòng phân quyền nào (không dòng riêng, không trần công ty) = như
// cũ: vào được ít nhất 1 tab QS là ghi được (LegacyAny). Hàm lõi giữ nguyên như bản Node: test golden đối chiếu
// Node dựng Service không có Access nên không kiểm (như Approval của takeoff). Đọc dữ liệu dùng chung không kiểm ở đây:
// bootstrap (mọi trang gọi khi mở) đã trả dự án + danh mục sản phẩm + dòng bóc tách cho mọi tài khoản đăng nhập.

// accScope: 1 chỗ trong danh mục quyền; tab "" = tab bất kỳ của module.
type accScope struct{ module, tab string }

// accQS: module QS, tab bất kỳ - dữ liệu dùng chung của nhiều tab (Bóc tách, Chi phí, Xuất báo giá, Dự án, Sản phẩm...).
var accQS = []accScope{{"qs", ""}}

// accProduct: ghi sản phẩm (thêm / sửa / xoá, combo, biến thể, bản sao riêng, yêu cầu xoá) - tab Danh sách sản phẩm (cả
// trang Nhà cung cấp), thêm còn từ tab Nhập dữ liệu. Yêu thích / xuất file vẫn theo accQS (dùng cả ở bảng dòng).
var accProduct = []accScope{{"qs", "sanpham"}, {"qs", "import"}}

// accImport: tab Nhập dữ liệu của QS.
var accImport = []accScope{{"qs", "import"}}

var accActionVN = map[string]string{"view": "xem", "create": "thêm", "edit": "sửa", "delete": "xoá", "approve": "duyệt", "export": "xuất"}

// accGate: nil = được. Super luôn được (AccessChecker); chưa nối Access = không kiểm.
func (s *Service) accGate(ctx context.Context, a *actor.Actor, action, area string, where []accScope) error {
	if s.access == nil {
		return nil
	}
	if a == nil {
		return apperr.E(401, "Chưa đăng nhập", "NOAUTH")
	}
	qs := false
	for _, w := range where {
		ok, err := s.access.Can(ctx, a, w.module, w.tab, action)
		if err != nil || ok {
			return err
		}
		qs = qs || w.module == "qs"
	}
	// chưa phân quyền N21 (không dòng riêng, không trần công ty): như cũ - vào được QS là ghi được mọi tab QS
	if qs {
		if ok, err := s.access.LegacyAny(ctx, a, "qs"); err != nil || ok {
			return err
		}
	}
	return apperr.Forbidden("Tài khoản không có quyền " + accActionVN[action] + " ở " + area)
}

// accRPC: bọc hàm rpc - kiểm accGate trước khi chạy h.
func (s *Service) accRPC(action, area string, where []accScope, h rpc.Handler) rpc.Handler {
	return func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		if err := s.accGate(ctx, a, action, area, where); err != nil {
			return nil, err
		}
		return h(ctx, a, args)
	}
}

// accMW: middleware gin tương ứng cho REST. Chưa đăng nhập: để route tự báo (giữ nguyên thông báo của route).
func (s *Service) accMW(action, area string, where []accScope) gin.HandlerFunc {
	return func(c *gin.Context) {
		a := actor.FromGin(c)
		if a == nil {
			return
		}
		if err := s.accGate(c.Request.Context(), a, action, area, where); err != nil {
			response.Error(c, err)
		}
	}
}
