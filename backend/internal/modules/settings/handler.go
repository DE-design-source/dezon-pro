package settings

import (
	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
)

// RegisterRPC: không có hàm /api/:fn, chỉ khai route chỉ bản Go.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "getSystemDefaults", Method: "GET", Path: "/system-defaults", Perm: rpc.Login, Tag: "Hệ thống",
		Summary: "Cài đặt mặc định toàn hệ thống do Siêu quản trị viên lưu -> {appearance, general, display, updatedAt, updatedBy} " +
			"(mục chưa lưu = null; database chưa migrate 0047 -> toàn null)",
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "saveSystemDefault", Method: "PUT", Path: "/system-defaults/:section", Perm: rpc.Super, Tag: "Hệ thống",
		Summary: "Lưu cài đặt mặc định 1 mục cho toàn hệ thống (chỉ Siêu quản trị viên) -> {ok}; value null / bỏ trống = xoá mặc định của mục",
		Fields: []rpc.GoField{
			{Name: "section", In: "path", Type: "string", Required: true, Desc: "appearance | general | display"},
			{Name: "value", In: "body", Type: "object", Desc: "object mặc định của mục (tối đa 64 KB JSON); null = xoá"},
		},
	})
}

// RegisterRoutes: REST dưới /api/v1/system-defaults.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/system-defaults")
	g.GET("", middleware.RequireLogin(), func(c *gin.Context) {
		r, err := s.GetDefaults(c.Request.Context())
		response.Result(c, r, err)
	})
	g.PUT("/:section", middleware.RequireSuper(), func(c *gin.Context) {
		r, err := s.SaveDefault(c.Request.Context(), actor.FromGin(c), c.Param("section"), middleware.BodyMap(c).Val("value"))
		response.Result(c, r, err)
	})
}
