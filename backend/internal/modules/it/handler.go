package it

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/validator"
)

var ticketBody = []rpc.GoField{
	{Name: "title", In: "body", Desc: "Tiêu đề (bắt buộc khi tạo)"},
	{Name: "desc", In: "body", Desc: "Mô tả chi tiết"},
	{Name: "priority", In: "body", Desc: "urgent / high / medium / low"},
	{Name: "category", In: "body", Desc: "hardware / software / network / account / other"},
	{Name: "deadline", In: "body", Desc: "Deadline yyyy-mm-dd; rỗng = bỏ"},
	{Name: "requester", In: "body", Desc: "Tên người yêu cầu (trống khi tạo = người đăng nhập)"},
	{Name: "requesterUsername", In: "body", Desc: "Tên đăng nhập người yêu cầu (chọn từ GET /it/staff)"},
	{Name: "roles", In: "body", Type: "array", Desc: "Người liên quan [{label, people: [{name, username}]}]; người có username nhận thông báo"},
	{Name: "images", In: "body", Type: "array", Desc: "Ảnh [{name, url: /files/...}] hoặc [{name, data: data:image/...;base64,...}] (tối đa 8, mỗi ảnh 8 MB)"},
}

var idPath = rpc.GoField{Name: "id", In: "path", Desc: "Mã (số)"}

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). Quyền chi tiết kiểm trong service.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	tag := "IT"
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itListTickets", Method: "GET", Path: "/it/tickets", Perm: rpc.Login, Tag: tag,
		Summary: "Yêu cầu hỗ trợ IT, mới nhất trước: quyền IT thấy tất cả, người khác (hoặc ?mine=1) chỉ thấy yêu cầu mình gửi; {tickets, canManage}",
		Fields:  []rpc.GoField{{Name: "mine", In: "query", Desc: "1 = chỉ yêu cầu của tôi"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itCreateTicket", Method: "POST", Path: "/it/tickets", Perm: rpc.Login, Tag: tag,
		Summary: "Tạo yêu cầu (trang IT / nút Báo lỗi); báo người được giao, không ai thì báo nhân sự có quyền IT",
		Fields: append(append([]rpc.GoField{}, ticketBody...),
			rpc.GoField{Name: "source", In: "body", Desc: "manual / report (Báo lỗi)"}, rpc.GoField{Name: "page", In: "body", Desc: "Trang gửi báo lỗi"})})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itUpdateTicket", Method: "PATCH", Path: "/it/tickets/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa 1 phần yêu cầu (quyền IT): bảng xử lý, trạng thái, tiến độ, đã tiếp nhận, thông tin",
		Fields: append(append([]rpc.GoField{idPath}, ticketBody...),
			rpc.GoField{Name: "status", In: "body", Desc: "moi / dangxuly / chodoi / hoanthanh / dong"},
			rpc.GoField{Name: "tasks", In: "body", Type: "array", Desc: "Công việc trên bảng (FlowBoard items); null = dựng lại mặc định"},
			rpc.GoField{Name: "stages", In: "body", Type: "array", Desc: "Quy trình (cột) của bảng; null = quy trình mặc định"},
			rpc.GoField{Name: "progress", In: "body", Type: "number", Desc: "% công việc xong 0-100"},
			rpc.GoField{Name: "received", In: "body", Type: "boolean", Desc: "IT đã tiếp nhận"})})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itDeleteTicket", Method: "DELETE", Path: "/it/tickets/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá hẳn yêu cầu (chỉ admin)", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itStaff", Method: "GET", Path: "/it/staff", Perm: rpc.Login, Tag: tag,
		Summary: "Tài khoản đang hoạt động của công ty để chọn người: {staff: [{username, name, department, role, it}]}"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itListAssets", Method: "GET", Path: "/it/assets", Perm: rpc.Login, Tag: tag,
		Summary: "Thiết bị & tài sản CNTT (quyền IT): {assets: [{id, name, type, owner, status, note}]}"})
	assetBody := []rpc.GoField{{Name: "name", In: "body", Desc: "Tên thiết bị (bắt buộc khi tạo)"}, {Name: "type", In: "body", Desc: "Loại"},
		{Name: "owner", In: "body", Desc: "Người / vị trí sử dụng"}, {Name: "status", In: "body", Desc: "active / maintenance / broken"}, {Name: "note", In: "body", Desc: "Ghi chú"}}
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itCreateAsset", Method: "POST", Path: "/it/assets", Perm: rpc.Login, Tag: tag,
		Summary: "Thêm thiết bị (quyền IT)", Fields: assetBody})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itUpdateAsset", Method: "PATCH", Path: "/it/assets/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa thiết bị (quyền IT)", Fields: append([]rpc.GoField{idPath}, assetBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "itDeleteAsset", Method: "DELETE", Path: "/it/assets/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá thiết bị (quyền IT)", Fields: []rpc.GoField{idPath}})
}

// RegisterRoutes: REST /api/v1/it, khớp từng GoRoute ở trên.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/it", middleware.RequireLogin())
	withID := func(fn func(ctx context.Context, a *actor.Actor, id float64, c *gin.Context) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			id, err := validator.ParamNum(c, "id")
			if err != nil {
				response.Error(c, err)
				return
			}
			r, err := fn(c.Request.Context(), actor.FromGin(c), id, c)
			response.Result(c, r, err)
		}
	}
	withBody := func(fn func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			r, err := fn(c.Request.Context(), actor.FromGin(c), c)
			response.Result(c, r, err)
		}
	}
	g.GET("/tickets", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		return s.ListTickets(ctx, a, c.Query("mine") == "1")
	}))
	g.POST("/tickets", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.CreateTicket(ctx, a, body)
	}))
	g.PATCH("/tickets/:id", withID(func(ctx context.Context, a *actor.Actor, id float64, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.UpdateTicket(ctx, a, id, body)
	}))
	g.DELETE("/tickets/:id", withID(func(ctx context.Context, a *actor.Actor, id float64, _ *gin.Context) (any, error) {
		return s.DeleteTicket(ctx, a, id)
	}))
	g.GET("/staff", withBody(func(ctx context.Context, a *actor.Actor, _ *gin.Context) (any, error) { return s.ListStaff(ctx, a) }))
	g.GET("/assets", withBody(func(ctx context.Context, a *actor.Actor, _ *gin.Context) (any, error) { return s.ListAssets(ctx, a) }))
	g.POST("/assets", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.CreateAsset(ctx, a, body)
	}))
	g.PATCH("/assets/:id", withID(func(ctx context.Context, a *actor.Actor, id float64, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.UpdateAsset(ctx, a, id, body)
	}))
	g.DELETE("/assets/:id", withID(func(ctx context.Context, a *actor.Actor, id float64, _ *gin.Context) (any, error) {
		return s.DeleteAsset(ctx, a, id)
	}))
}
