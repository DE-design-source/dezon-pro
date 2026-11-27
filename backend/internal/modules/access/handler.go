package access

import (
	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
)

const tag = "Phân quyền"

// RegisterRPC: không có hàm /api/:fn, chỉ khai route chỉ bản Go.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	grantsField := rpc.GoField{Name: "grants", In: "body", Type: "object",
		Desc: `{"<module>": {"<tab>" | "*": ["view","create","edit","delete","approve","export"]}}; null = xoá (về cách cũ)`}
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "accessCatalog", Method: "GET", Path: "/access/catalog", Perm: rpc.Login, Tag: tag,
		Summary: "Danh mục quyền Module > Tab > Thao tác -> {actions: [{key, label}], modules: [{key, label, tabs: [{key, label, actions}]}]}",
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "accessMe", Method: "GET", Path: "/access/me", Perm: rpc.Login, Tag: tag,
		Summary: "Quyền thực của tài khoản đang đăng nhập -> {grants, grantable} (grantable: super = mọi quyền, admin và Admin (subadmin) = quyền của mình, nhân viên = {})",
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "companyAccess", Method: "GET", Path: "/companies/:id/access", Perm: rpc.Super, Tag: tag,
		Summary: "Trần quyền của 1 công ty -> {grants: đã đặt | null (theo tính năng công ty), effective}",
		Fields:  []rpc.GoField{{Name: "id", In: "path", Type: "string", Required: true, Desc: "id công ty"}},
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "setCompanyAccess", Method: "PUT", Path: "/companies/:id/access", Perm: rpc.Super, Tag: tag,
		Summary: "Quản trị hệ thống đặt trần quyền của 1 công ty -> {grants, effective}",
		Fields:  []rpc.GoField{{Name: "id", In: "path", Type: "string", Required: true, Desc: "id công ty"}, grantsField},
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "userAccess", Method: "GET", Path: "/users/:id/access", Perm: rpc.Admin, Tag: tag,
		Summary: "Quyền của 1 tài khoản (admin: tài khoản cùng công ty; Admin (subadmin): nhân viên công ty mình và chính mình) -> " +
			"{grants: đã đặt | null (cách cũ), effective}",
		Fields: []rpc.GoField{{Name: "id", In: "path", Type: "string", Required: true, Desc: "id tài khoản"}},
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "setUserAccess", Method: "PUT", Path: "/users/:id/access", Perm: rpc.Admin, Tag: tag,
		Summary: "Phân quyền 1 tài khoản -> {grants, effective}. Super: admin và nhân viên; admin: nhân viên công ty mình, " +
			"chỉ trong quyền của chính mình; Admin (subadmin): chỉ nhân viên công ty mình, trong quyền của mình, không đặt null; " +
			"không đặt cho tài khoản super",
		Fields: []rpc.GoField{{Name: "id", In: "path", Type: "string", Required: true, Desc: "id tài khoản"}, grantsField},
	})
}

// RegisterRoutes: REST dưới /api/v1.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/access", middleware.RequireLogin())
	g.GET("/catalog", func(c *gin.Context) { response.OK(c, s.CatalogOut()) })
	g.GET("/me", func(c *gin.Context) {
		r, err := s.Me(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	v1.GET("/companies/:id/access", middleware.RequireSuper(), func(c *gin.Context) {
		r, err := s.CompanyAccess(c.Request.Context(), c.Param("id"))
		response.Result(c, r, err)
	})
	v1.PUT("/companies/:id/access", middleware.RequireSuper(), func(c *gin.Context) {
		g, ok := grantsOf(c)
		if !ok {
			return
		}
		r, err := s.SetCompanyAccess(c.Request.Context(), actor.FromGin(c), c.Param("id"), g)
		response.Result(c, r, err)
	})
	v1.GET("/users/:id/access", middleware.RequireStaffManager(), func(c *gin.Context) {
		r, err := s.UserAccess(c.Request.Context(), actor.FromGin(c), c.Param("id"))
		response.Result(c, r, err)
	})
	v1.PUT("/users/:id/access", middleware.RequireStaffManager(), func(c *gin.Context) {
		g, ok := grantsOf(c)
		if !ok {
			return
		}
		r, err := s.SetUserAccess(c.Request.Context(), actor.FromGin(c), c.Param("id"), g)
		response.Result(c, r, err)
	})
}

// grantsOf: khoá grants của thân PUT (bắt buộc gửi; null = xoá). Thiếu -> trả 400.
func grantsOf(c *gin.Context) (any, bool) {
	b := middleware.BodyMap(c)
	if !b.Has("grants") {
		response.Fail(c, 400, msgNoGrants)
		return nil, false
	}
	return b.Val("grants"), true
}
