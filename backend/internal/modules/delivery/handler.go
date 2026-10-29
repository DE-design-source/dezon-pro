package delivery

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/validator"
)

var (
	pID   = rpc.GoField{Name: "id", In: "path", Desc: "Mã dự án triển khai (số)"}
	pItem = rpc.GoField{Name: "itemId", In: "path", Desc: "Mã dòng con (số)"}
)

func body(fields ...[2]string) []rpc.GoField {
	out := make([]rpc.GoField, len(fields))
	for i, f := range fields {
		out[i] = rpc.GoField{Name: f[0], In: "body", Desc: f[1]}
	}
	return out
}

var (
	projectBody = body([2]string{"name", "Tên dự án"}, [2]string{"status", "nhap / dang-lam / tam-dung / hoan-tat"},
		[2]string{"client", "Khách hàng"}, [2]string{"contact", "Người liên hệ"}, [2]string{"phone", "Điện thoại"}, [2]string{"email", "Email"},
		[2]string{"address", "Địa chỉ công trình"}, [2]string{"projectType", "Loại công trình"},
		[2]string{"startDate", "Ngày bắt đầu yyyy-mm-dd"}, [2]string{"handoverDate", "Ngày bàn giao yyyy-mm-dd"},
		[2]string{"contractValueVnd", "Giá trị hợp đồng (đồng)"}, [2]string{"approvedBudgetVnd", "Ngân sách duyệt (đồng)"},
		[2]string{"note", "Ghi chú"}, [2]string{"maDA", "Mã dự án QS; rỗng = bỏ gắn"})
	taskBody = body([2]string{"name", "Tên công việc"}, [2]string{"phaseId", "Giai đoạn"}, [2]string{"start", "Ngày bắt đầu yyyy-mm-dd"},
		[2]string{"end", "Ngày kết thúc yyyy-mm-dd"}, [2]string{"progress", "Tiến độ 0-100"}, [2]string{"critical", "Đường găng"},
		[2]string{"milestone", "Cột mốc"}, [2]string{"desc", "Mô tả"}, [2]string{"depts", "Bộ phận phụ trách (mảng)"},
		[2]string{"owners", "Người phụ trách (mảng)"}, [2]string{"finType", "thu / chi / rỗng"}, [2]string{"planStart", "Ngày kế hoạch thu/chi"},
		[2]string{"amountVnd", "Số tiền thu/chi (đồng)"}, [2]string{"confirmed", "Đã xác nhận thu/chi"}, [2]string{"sortOrder", "Thứ tự"})
	subBody   = body([2]string{"name", "Tên thầu phụ"}, [2]string{"scope", "Phạm vi"}, [2]string{"contact", "Liên hệ"}, [2]string{"phone", "Điện thoại"}, [2]string{"valueVnd", "Giá trị (đồng)"}, [2]string{"status", "active / pending / done"})
	phaseBody = body([2]string{"name", "Tên giai đoạn"}, [2]string{"sortOrder", "Thứ tự"}, [2]string{"members", "Người phụ trách [{name, role}]"})
)

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). Quyền tab (thietke / thicong) kiểm trong service.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	tag := "Dự án triển khai"
	add := func(name, method, path, sum string, f ...rpc.GoField) {
		reg.RegisterGoRoute(rpc.GoRoute{Name: name, Method: method, Path: path, Perm: rpc.Login, Tag: tag, Summary: sum, Fields: f})
	}
	with := func(xs ...[]rpc.GoField) []rpc.GoField {
		out := []rpc.GoField{}
		for _, x := range xs {
			out = append(out, x...)
		}
		return out
	}
	one := []rpc.GoField{pID}
	two := []rpc.GoField{pID, pItem}
	add("tkListProjects", "GET", "/delivery/projects", "Danh sách dự án thiết kế / thi công kèm tiến độ",
		rpc.GoField{Name: "kind", In: "query", Desc: "design (Quản lý thiết kế) / construction (Quản lý dự án)"})
	add("tkCreateProject", "POST", "/delivery/projects", "Tạo dự án bằng tay", with(body([2]string{"kind", "design / construction"}), projectBody)...)
	add("tkGetProject", "GET", "/delivery/projects/:id", "Chi tiết dự án: thành viên, thầu phụ, giai đoạn + công việc, bình luận", one...)
	add("tkUpdateProject", "PATCH", "/delivery/projects/:id", "Sửa thông tin dự án (chỉ khoá gửi lên)", with(one, projectBody)...)
	add("tkDeleteProject", "DELETE", "/delivery/projects/:id", "Xoá dự án và mọi dữ liệu bên trong", one...)
	add("tkAddMember", "POST", "/delivery/projects/:id/members", "Thêm thành viên", with(one, body([2]string{"name", "Họ tên"}, [2]string{"role", "Vai trò"}, [2]string{"dept", "Bộ phận"}))...)
	add("tkRemoveMember", "DELETE", "/delivery/projects/:id/members/:itemId", "Bỏ thành viên", two...)
	add("tkAddSubcontractor", "POST", "/delivery/projects/:id/subcontractors", "Thêm thầu phụ", with(one, subBody)...)
	add("tkUpdateSubcontractor", "PATCH", "/delivery/projects/:id/subcontractors/:itemId", "Sửa thầu phụ", with(two, subBody)...)
	add("tkRemoveSubcontractor", "DELETE", "/delivery/projects/:id/subcontractors/:itemId", "Xoá thầu phụ", two...)
	add("tkAddPhase", "POST", "/delivery/projects/:id/phases", "Thêm giai đoạn tiến độ", with(one, phaseBody)...)
	add("tkUpdatePhase", "PATCH", "/delivery/projects/:id/phases/:itemId", "Sửa giai đoạn", with(two, phaseBody)...)
	add("tkRemovePhase", "DELETE", "/delivery/projects/:id/phases/:itemId", "Xoá giai đoạn và công việc trong đó", two...)
	add("tkAddTask", "POST", "/delivery/projects/:id/tasks", "Thêm công việc / cột mốc / mốc thu chi", with(one, taskBody)...)
	add("tkUpdateTask", "PATCH", "/delivery/projects/:id/tasks/:itemId", "Sửa công việc (chỉ khoá gửi lên)", with(two, taskBody)...)
	add("tkRemoveTask", "DELETE", "/delivery/projects/:id/tasks/:itemId", "Xoá công việc", two...)
	add("tkAddComment", "POST", "/delivery/projects/:id/tasks/:itemId/comments", "Bình luận vào công việc",
		with(two, body([2]string{"text", "Nội dung"}, [2]string{"who", "Tên người viết (trống = tên đăng nhập)"}))...)
}

type h1 func(ctx context.Context, a *actor.Actor, id float64, b *omap.Map) (any, error)
type h2 func(ctx context.Context, a *actor.Actor, id, item float64, b *omap.Map) (any, error)

// RegisterRoutes: REST /api/v1/delivery, khớp từng GoRoute ở trên. Route DELETE / GET không đọc thân request.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/delivery/projects", middleware.RequireLogin())
	run := func(c *gin.Context, needBody, needItem bool, fn1 h1, fn2 h2) {
		id, err := validator.ParamNum(c, "id")
		if err != nil {
			response.Error(c, err)
			return
		}
		b := omap.New()
		if needBody {
			if b, err = validator.Body(c); err != nil {
				response.Error(c, err)
				return
			}
		}
		ctx, a := c.Request.Context(), actor.FromGin(c)
		if !needItem {
			r, err := fn1(ctx, a, id, b)
			response.Result(c, r, err)
			return
		}
		item, err := validator.ParamNum(c, "itemId")
		if err != nil {
			response.Error(c, err)
			return
		}
		r, err := fn2(ctx, a, id, item, b)
		response.Result(c, r, err)
	}
	r1 := func(needBody bool, fn h1) gin.HandlerFunc {
		return func(c *gin.Context) { run(c, needBody, false, fn, nil) }
	}
	r2 := func(needBody bool, fn h2) gin.HandlerFunc {
		return func(c *gin.Context) { run(c, needBody, true, nil, fn) }
	}
	remove := func(table string) gin.HandlerFunc {
		return r2(false, func(ctx context.Context, a *actor.Actor, id, item float64, _ *omap.Map) (any, error) {
			return s.RemoveItem(ctx, a, table, id, item)
		})
	}

	g.GET("", func(c *gin.Context) {
		r, err := s.ListProjects(c.Request.Context(), actor.FromGin(c), validator.Query(c, "kind"))
		response.Result(c, r, err)
	})
	g.POST("", func(c *gin.Context) {
		b, err := validator.Body(c)
		if err != nil {
			response.Error(c, err)
			return
		}
		r, err := s.CreateProject(c.Request.Context(), actor.FromGin(c), b)
		response.Result(c, r, err)
	})
	g.GET("/:id", r1(false, func(ctx context.Context, a *actor.Actor, id float64, _ *omap.Map) (any, error) {
		return s.GetProject(ctx, a, id)
	}))
	g.PATCH("/:id", r1(true, s.UpdateProject))
	g.DELETE("/:id", r1(false, func(ctx context.Context, a *actor.Actor, id float64, _ *omap.Map) (any, error) {
		return s.DeleteProject(ctx, a, id)
	}))
	g.POST("/:id/members", r1(true, s.AddMember))
	g.DELETE("/:id/members/:itemId", remove("tk_thanh_vien"))
	g.POST("/:id/subcontractors", r1(true, s.AddSubcontractor))
	g.PATCH("/:id/subcontractors/:itemId", r2(true, s.UpdateSubcontractor))
	g.DELETE("/:id/subcontractors/:itemId", remove("tk_thau_phu"))
	g.POST("/:id/phases", r1(true, s.AddPhase))
	g.PATCH("/:id/phases/:itemId", r2(true, s.UpdatePhase))
	g.DELETE("/:id/phases/:itemId", remove("tk_giai_doan"))
	g.POST("/:id/tasks", r1(true, s.AddTask))
	g.PATCH("/:id/tasks/:itemId", r2(true, s.UpdateTask))
	g.DELETE("/:id/tasks/:itemId", remove("tk_cong_viec"))
	g.POST("/:id/tasks/:itemId/comments", r2(true, s.AddComment))
}
