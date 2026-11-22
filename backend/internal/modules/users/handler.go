package users

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/response"
)

// RegisterRPC: 7 hàm, đều thuộc ADMIN_FNS (I:130-131). getAuditLog KHÔNG nằm trong ACTOR_FNS -> không nhận actor.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.Register("adminListUsers", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.AdminListUsers(ctx, a)
	})
	reg.Register("adminCreateUser", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.AdminCreateUserGated(ctx, a, args.Map(0))
	})
	reg.Register("adminUpdateUser", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.AdminUpdateUserGated(ctx, a, args.ArgU(0), args.Map(1))
	})
	reg.Register("adminSetPassword", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.AdminSetPasswordGated(ctx, a, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("adminSetActive", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.AdminSetActiveGated(ctx, a, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("adminDeleteUser", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.AdminDeleteUserGated(ctx, a, args.ArgU(0))
	})
	reg.Register("getAuditLog", rpc.Admin, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetAuditLog(ctx, args.ArgU(0))
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "updateMyProfile", Method: "PATCH", Path: "/auth/me", Perm: rpc.Login, Tag: "Tài khoản",
		Summary: "Tự sửa họ tên / email của tài khoản đang đăng nhập (chỉ các khoá gửi lên) -> tài khoản sau khi sửa",
		Fields: []rpc.GoField{
			{Name: "hoTen", In: "body", Type: "string", Desc: "Họ tên, tối đa 100 ký tự"},
			{Name: "email", In: "body", Type: "string", Desc: "Email; rỗng = xoá; không được trùng tài khoản khác trong công ty"},
		},
	})
	// Duyệt sản phẩm theo phân cấp (roadmap M14.6)
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "productApprovers", Method: "GET", Path: "/users/product-approvers", Perm: rpc.Admin, Tag: "Tài khoản",
		Summary: "Tài khoản quản trị công ty (super: mọi công ty hoặc công ty đang xem; admin: công ty mình) kèm cờ được giao duyệt sản phẩm -> [{id, duocDuyetSp}]",
	})
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "setProductApproval", Method: "PUT", Path: "/users/:id/product-approval", Perm: rpc.Admin | rpc.Super, Tag: "Tài khoản",
		Summary: "Quản trị hệ thống bật / tắt quyền duyệt sản phẩm (và giao quyền duyệt cho nhân viên) của 1 tài khoản quản trị công ty -> {ok}",
		Fields: []rpc.GoField{
			{Name: "id", In: "path", Type: "string", Required: true, Desc: "id tài khoản (phải có vai trò admin)"},
			{Name: "on", In: "body", Type: "boolean", Required: true, Desc: "true = giao, false = thu lại"},
		},
	})
}

// RegisterRoutes: REST /api/v1 - gọi đúng phương thức service mà hàm rpc gọi (bản Gated của 5 hàm quản lý tài khoản).
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/users", middleware.RequireAdmin())
	g.GET("", func(c *gin.Context) {
		r, err := s.AdminListUsers(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	g.POST("", func(c *gin.Context) {
		r, err := s.AdminCreateUserGated(c.Request.Context(), actor.FromGin(c), bodyMap(c))
		response.Result(c, r, err)
	})
	g.PATCH("/:id", func(c *gin.Context) {
		r, err := s.AdminUpdateUserGated(c.Request.Context(), actor.FromGin(c), c.Param("id"), bodyMap(c))
		response.Result(c, r, err)
	})
	g.PUT("/:id/password", func(c *gin.Context) {
		r, err := s.AdminSetPasswordGated(c.Request.Context(), actor.FromGin(c), c.Param("id"), bodyVal(c, "newPassword"))
		response.Result(c, r, err)
	})
	g.PUT("/:id/active", func(c *gin.Context) {
		r, err := s.AdminSetActiveGated(c.Request.Context(), actor.FromGin(c), c.Param("id"), bodyVal(c, "active"))
		response.Result(c, r, err)
	})
	// route chỉ bản Go (M14.6), khai ở RegisterRPC; group đã RequireAdmin, thêm RequireSuper = RequireAdminSuper
	g.GET("/product-approvers", func(c *gin.Context) {
		r, err := s.ProductApprovers(c.Request.Context())
		response.Result(c, r, err)
	})
	g.PUT("/:id/product-approval", middleware.RequireSuper(), func(c *gin.Context) {
		r, err := s.SetProductApproval(c.Request.Context(), actor.FromGin(c), c.Param("id"), bodyVal(c, "on"))
		response.Result(c, r, err)
	})
	g.DELETE("/:id", func(c *gin.Context) {
		r, err := s.AdminDeleteUserGated(c.Request.Context(), actor.FromGin(c), c.Param("id"))
		response.Result(c, r, err)
	})
	v1.PATCH("/auth/me", middleware.RequireLogin(), func(c *gin.Context) {
		r, err := s.UpdateMyProfile(c.Request.Context(), actor.FromGin(c), bodyMap(c))
		response.Result(c, r, err)
	})
	v1.GET("/audit-log", middleware.RequireAdmin(), func(c *gin.Context) {
		var limit any = jsval.Undefined
		if v, ok := c.GetQuery("limit"); ok {
			limit = v
		}
		r, err := s.GetAuditLog(c.Request.Context(), limit)
		response.Result(c, r, err)
	})
}
