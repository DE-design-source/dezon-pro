package purchasing

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/validator"
)

// RegisterRPC: 11 hàm /api/:fn + 1 route chỉ bản Go (getMyDeXuat). getPurchaseOrders và getDeXuatList không thuộc ACTOR_FNS; 6 hàm duyệt thuộc ADMIN_FNS (I:118-135).
// Phân quyền 3 cấp (N21, access_gate.go): hàm của nhân viên + 2 hàm duyệt bọc accRPC (tab Mua hàng của QS hoặc trang Mua hàng);
// 4 hàm đọc danh sách / chi tiết của admin giữ nguyên (tab Quản trị luôn gọi, công ty tắt Mua hàng vẫn ra danh sách rỗng).
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.Register("sendPurchaseRequest", rpc.Login, s.accRPC("create", "Mua hàng", accMua, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SendPurchaseRequest(ctx, a, args.ArgU(0))
	}))
	reg.Register("getPurchaseOrders", rpc.Login, s.accRPC("view", "Mua hàng", accMua, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetPurchaseOrders(ctx, args.ArgU(0))
	}))
	reg.Register("setPurchaseStatus", rpc.Login, s.accRPC("edit", "Mua hàng", accMua, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SetPurchaseStatus(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("getDeXuatList", rpc.Login, s.accRPC("view", "Mua hàng", accMua, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetDeXuatList(ctx, args.ArgU(0))
	}))
	reg.Register("sendDeXuat", rpc.Login, s.accRPC("create", "Mua hàng", accMua, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SendDeXuat(ctx, a, args.ArgU(0))
	}))
	reg.Register("listPurchaseRequests", rpc.Admin, func(ctx context.Context, a *actor.Actor, _ rpc.Args) (any, error) {
		return s.ListPurchaseRequests(ctx, a)
	})
	reg.Register("getPurchaseOrder", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.GetPurchaseOrder(ctx, a, args.ArgU(0))
	})
	reg.Register("resolvePurchaseRequest", rpc.Admin, s.accRPC("approve", "Mua hàng", accMua, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.ResolvePurchaseRequest(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("listDeXuat", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.ListDeXuat(ctx, a, args.ArgU(0))
	})
	reg.Register("getDeXuat", rpc.Admin, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.GetDeXuat(ctx, a, args.ArgU(0))
	})
	reg.Register("resolveDeXuat", rpc.Admin, s.accRPC("approve", "Mua hàng", accMua, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.ResolveDeXuat(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.RegisterGoRoute(rpc.GoRoute{Name: "getMyDeXuat", Method: "GET", Path: "/my-proposals/:code", Perm: rpc.Login,
		Tag: "Mua hàng", Summary: "Chi tiết phiếu đề xuất của chính mình (admin / super: mọi phiếu của công ty)",
		Fields: []rpc.GoField{{Name: "code", In: "path", Desc: "Mã phiếu đề xuất (CK-... / TT-...)"}}})
}

// RegisterRoutes: REST /api/v1 (PORTING_MAP mục A), gọi đúng các phương thức mà cổng rpc gọi.
// :id là mã dự án (cùng tên tham số với module projects / takeoff), :code là mã đơn / mã phiếu.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	login, admin := middleware.RequireLogin(), middleware.RequireAdmin()

	p := v1.Group("/projects", login)
	p.GET("/:id/purchase-orders", s.accMW("view", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.GetPurchaseOrders(c.Request.Context(), c.Param("id"))
		response.Result(c, r, err)
	})
	p.GET("/:id/proposals", s.accMW("view", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.GetDeXuatList(c.Request.Context(), c.Param("id"))
		response.Result(c, r, err)
	})

	po := v1.Group("/purchase-orders")
	po.POST("", login, s.accMW("create", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.SendPurchaseRequest(c.Request.Context(), actor.FromGin(c), middleware.Body(c))
		response.Result(c, r, err)
	})
	po.GET("", admin, func(c *gin.Context) {
		r, err := s.ListPurchaseRequests(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	po.GET("/:code", admin, func(c *gin.Context) {
		r, err := s.GetPurchaseOrder(c.Request.Context(), actor.FromGin(c), c.Param("code"))
		response.Result(c, r, err)
	})
	po.PATCH("/:code/status", login, s.accMW("edit", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.SetPurchaseStatus(c.Request.Context(), actor.FromGin(c), c.Param("code"), bodyKey(c, "status"))
		response.Result(c, r, err)
	})
	po.POST("/:code/resolve", admin, s.accMW("approve", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.ResolvePurchaseRequest(c.Request.Context(), actor.FromGin(c), c.Param("code"), bodyKey(c, "approve"))
		response.Result(c, r, err)
	})

	// route chỉ bản Go (M13.1), khai ở RegisterRPC
	v1.GET("/my-proposals/:code", login, s.accMW("view", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.GetMyDeXuat(c.Request.Context(), actor.FromGin(c), c.Param("code"))
		response.Result(c, r, err)
	})

	dx := v1.Group("/proposals")
	dx.POST("", login, s.accMW("create", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.SendDeXuat(c.Request.Context(), actor.FromGin(c), middleware.Body(c))
		response.Result(c, r, err)
	})
	dx.GET("", admin, func(c *gin.Context) {
		r, err := s.ListDeXuat(c.Request.Context(), actor.FromGin(c), validator.Query(c, "loai"))
		response.Result(c, r, err)
	})
	dx.GET("/:code", admin, func(c *gin.Context) {
		r, err := s.GetDeXuat(c.Request.Context(), actor.FromGin(c), c.Param("code"))
		response.Result(c, r, err)
	})
	dx.POST("/:code/resolve", admin, s.accMW("approve", "Mua hàng", accMua), func(c *gin.Context) {
		r, err := s.ResolveDeXuat(c.Request.Context(), actor.FromGin(c), c.Param("code"), bodyKey(c, "approve"))
		response.Result(c, r, err)
	})
}
