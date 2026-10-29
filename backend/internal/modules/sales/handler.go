package sales

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/validator"
)

var leadBody = func() []rpc.GoField {
	f := []rpc.GoField{
		{Name: "name", In: "body", Desc: "Tên khách hàng (bắt buộc khi tạo)"},
		{Name: "stage", In: "body", Desc: "Giai đoạn: tiep-can / tu-van / bao-gia / dam-phan / chot-hd / bao-gia-thi-cong / thiet-ke / thi-cong / truot-thau"},
		{Name: "sub", In: "body", Desc: "Giai đoạn trên bảng Thiết kế / Thi công; rỗng = chưa xếp"},
		{Name: "dept", In: "body", Desc: "dan-dung / du-an"},
		{Name: "valueVnd", In: "body", Type: "number", Desc: "Giá trị dự kiến (đồng), dùng khi chưa gắn dự án QS"},
		{Name: "maDA", In: "body", Desc: "Mã dự án QS gắn với khách hàng; rỗng = bỏ gắn"},
		{Name: "partner", In: "body", Type: "boolean", Desc: "Chuyển giao cho đối tác"},
		{Name: "categories", In: "body", Type: "array", Desc: "Hạng mục công việc (chuỗi)"},
		{Name: "assignees", In: "body", Type: "array", Desc: "Người phụ trách [{name, role}]"},
		{Name: "handoff", In: "body", Type: "object", Desc: "Phiếu bàn giao gần nhất {status, dept, requestedAt, assignee}; null = không có"},
	}
	for _, k := range []string{"phone", "email", "address", "source", "projectType", "scale", "concept", "notes", "creator", "manager", "boqFile"} {
		f = append(f, rpc.GoField{Name: k, In: "body", Desc: "Chuỗi tự do"})
	}
	return f
}()

var idPath = rpc.GoField{Name: "id", In: "path", Desc: "Mã khách hàng (số)"}

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). Quyền tab kiểm trong service.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	tag := "Kinh doanh"
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListLeads", Method: "GET", Path: "/sales/leads", Perm: rpc.Login, Tag: tag,
		Summary: "Danh sách khách hàng tiềm năng của công ty, kèm tổng báo giá QS (chưa VAT) nếu đã gắn dự án"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdCreateLead", Method: "POST", Path: "/sales/leads", Perm: rpc.Login, Tag: tag,
		Summary: "Thêm khách hàng tiềm năng", Fields: leadBody})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdUpdateLead", Method: "PATCH", Path: "/sales/leads/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa khách hàng (chỉ các khoá gửi lên): kéo-thả giai đoạn, bảng con, người phụ trách, form", Fields: append([]rpc.GoField{idPath}, leadBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdDeleteLead", Method: "DELETE", Path: "/sales/leads/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá khách hàng và lịch sử chăm sóc", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListActivities", Method: "GET", Path: "/sales/leads/:id/activities", Perm: rpc.Login, Tag: tag,
		Summary: "Lịch sử chăm sóc khách hàng, mới nhất trước", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdAddActivity", Method: "POST", Path: "/sales/leads/:id/activities", Perm: rpc.Login, Tag: tag,
		Summary: "Ghi một lần chăm sóc khách hàng", Fields: []rpc.GoField{idPath,
			{Name: "type", In: "body", Desc: "call / meeting / site / zalo / email / quote / note"},
			{Name: "title", In: "body", Desc: "Tiêu đề (bắt buộc)"}, {Name: "content", In: "body", Desc: "Nội dung"},
			{Name: "date", In: "body", Desc: "Ngày yyyy-mm-dd (trống = hôm nay)"}, {Name: "outcome", In: "body", Desc: "good / neutral / bad / rỗng"},
			{Name: "next", In: "body", Desc: "Ngày hẹn chăm sóc tiếp yyyy-mm-dd"}, {Name: "nextNote", In: "body", Desc: "Việc cần làm lần sau"},
			{Name: "by", In: "body", Desc: "Tên người ghi (trống = tên đăng nhập)"}}})
}

// RegisterRoutes: REST /api/v1/sales, khớp từng GoRoute ở trên.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/sales", middleware.RequireLogin())
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
	g.GET("/leads", func(c *gin.Context) {
		r, err := s.ListLeads(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	g.POST("/leads", func(c *gin.Context) {
		body, err := validator.Body(c)
		if err != nil {
			response.Error(c, err)
			return
		}
		r, err := s.CreateLead(c.Request.Context(), actor.FromGin(c), body)
		response.Result(c, r, err)
	})
	g.PATCH("/leads/:id", withID(func(ctx context.Context, a *actor.Actor, id float64, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.UpdateLead(ctx, a, id, body)
	}))
	g.DELETE("/leads/:id", withID(func(ctx context.Context, a *actor.Actor, id float64, _ *gin.Context) (any, error) {
		return s.DeleteLead(ctx, a, id)
	}))
	g.GET("/leads/:id/activities", withID(func(ctx context.Context, a *actor.Actor, id float64, _ *gin.Context) (any, error) {
		return s.ListActivities(ctx, a, id)
	}))
	g.POST("/leads/:id/activities", withID(func(ctx context.Context, a *actor.Actor, id float64, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.AddActivity(ctx, a, id, body)
	}))
}
