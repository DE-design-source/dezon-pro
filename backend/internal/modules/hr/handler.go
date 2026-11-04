package hr

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

var empBody = []rpc.GoField{
	{Name: "code", In: "body", Desc: "Mã nhân viên, duy nhất trong công ty (bắt buộc khi tạo)"},
	{Name: "name", In: "body", Desc: "Họ tên (bắt buộc khi tạo)"},
	{Name: "dept", In: "body", Desc: "Khoá đơn vị chính (unit key, bắt buộc khi tạo)"},
	{Name: "status", In: "body", Desc: "probation / active / left (left: cấp dưới chuyển cho quản lý cấp trên)"},
	{Name: "joinDate", In: "body", Desc: "Ngày vào làm yyyy-mm-dd (trống = hôm nay)"},
	{Name: "dob", In: "body", Desc: "Ngày sinh yyyy-mm-dd"}, {Name: "leaveDate", In: "body", Desc: "Ngày nghỉ việc yyyy-mm-dd"},
	{Name: "managerId", In: "body", Type: "number", Desc: "Quản lý trực tiếp (id nhân sự cùng công ty); null = không có"},
	{Name: "salary", In: "body", Type: "number", Desc: "Lương cơ bản (đồng)"},
	{Name: "gender, position, level, site, contractType, phone, email", In: "body", Desc: "Chuỗi tự do"},
	{Name: "(khoá khác)", In: "body", Desc: "Lưu nguyên vào tài liệu hồ sơ (education, contracts, insurance, ...), gộp theo khoá với bản cũ"},
}

var idPath = rpc.GoField{Name: "id", In: "path", Desc: "Mã nhân sự (số)"}

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). Quyền tab hr kiểm trong service.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	tag := "HR"
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrLoad", Method: "GET", Path: "/hr", Perm: rpc.Login, Tag: tag,
		Summary: "Toàn bộ dữ liệu HR của công ty: units, heads {key: id}, members {key: [{id, pct, title, allowance}]}, employees"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrCreateEmployee", Method: "POST", Path: "/hr/employees", Perm: rpc.Login, Tag: tag,
		Summary: "Thêm hồ sơ nhân sự; trả {id, ...dữ liệu HR}", Fields: empBody})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrUpdateEmployee", Method: "PATCH", Path: "/hr/employees/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa hồ sơ (chỉ các khoá gửi lên)", Fields: append([]rpc.GoField{idPath}, empBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrDeleteEmployee", Method: "DELETE", Path: "/hr/employees/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá hồ sơ; cấp dưới chuyển cho quản lý cấp trên, kiêm nhiệm xoá theo", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrSaveOrg", Method: "POST", Path: "/hr/org", Perm: rpc.Login, Tag: tag,
		Summary: "Thiết lập cơ cấu tổ chức trong 1 transaction", Fields: []rpc.GoField{
			{Name: "units", In: "body", Type: "array", Desc: "Thêm / sửa đơn vị theo key: {key, label, name, type, parent (key | __holding | __mother | null), tone, desc, appointedFromParent, headId}"},
			{Name: "employees", In: "body", Type: "array", Desc: "Sửa nhân sự: {id, ...khoá như PATCH /hr/employees/:id}"},
			{Name: "deleteMembers", In: "body", Type: "array", Desc: "Gỡ kiêm nhiệm: {unit, id}"},
			{Name: "members", In: "body", Type: "array", Desc: "Thêm / sửa kiêm nhiệm: {unit, id, pct (0-90), title, allowance}"},
			{Name: "deleteUnits", In: "body", Type: "array", Desc: "Khoá đơn vị cần xoá (phải không còn nhân sự / đơn vị trực thuộc)"},
		}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrAttendance", Method: "GET", Path: "/hr/attendance", Perm: rpc.Login, Tag: tag,
		Summary: "Chấm công: shifts, schedule {empId: [7 mã ca | off]}, logs trong [from, to], requests (2000 đơn mới nhất)", Fields: []rpc.GoField{
			{Name: "from", In: "query", Desc: "yyyy-mm-dd"}, {Name: "to", In: "query", Desc: "yyyy-mm-dd (tối đa 400 ngày sau from)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrSaveShifts", Method: "POST", Path: "/hr/shifts", Perm: rpc.Login, Tag: tag,
		Summary: "Ca + lịch tuần trong 1 transaction", Fields: []rpc.GoField{
			{Name: "shifts", In: "body", Type: "array", Desc: "Thêm / sửa ca: {id (mã), orig (mã cũ khi đổi mã), name, start, end (HH:MM), breakMin, tone, note}"},
			{Name: "deleteShifts", In: "body", Type: "array", Desc: "Mã ca cần xoá (ô lịch dùng ca thành nghỉ)"},
			{Name: "schedule", In: "body", Type: "object", Desc: "Ghi đè lịch tuần: {empId: [7 mã ca | off]} từ T2 đến CN"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrSaveLogs", Method: "POST", Path: "/hr/logs", Perm: rpc.Login, Tag: tag,
		Summary: "Ghi chấm công (1 dòng / người / ngày, chỉ sửa khoá gửi lên)", Fields: []rpc.GoField{
			{Name: "logs", In: "body", Type: "array", Desc: "[{empId, date, in, out (HH:MM), source: machine|gps|import|manual, gps: in|out, dist (m), note}]"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrCreateRequest", Method: "POST", Path: "/hr/requests", Perm: rpc.Login, Tag: tag,
		Summary: "Tạo đơn nghỉ / đi muộn / OT; luồng duyệt quản lý trực tiếp -> Nhân sự", Fields: []rpc.GoField{
			{Name: "empId", In: "body", Type: "number", Desc: "Nhân sự"}, {Name: "type", In: "body", Desc: "leave / late / ot"},
			{Name: "leaveKind", In: "body", Desc: "leave: annual / sick / unpaid / other"}, {Name: "from", In: "body", Desc: "yyyy-mm-dd"},
			{Name: "to", In: "body", Desc: "leave: ngày cuối"}, {Name: "days", In: "body", Type: "number", Desc: "leave: số ngày (bước 0,5)"},
			{Name: "hours", In: "body", Type: "number", Desc: "ot: số giờ"}, {Name: "reason", In: "body", Desc: "Lý do"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrDecideRequest", Method: "POST", Path: "/hr/requests/:id/decide", Perm: rpc.Login, Tag: tag,
		Summary: "Duyệt / từ chối bước đang chờ của đơn", Fields: []rpc.GoField{{Name: "id", In: "path", Desc: "Mã đơn (số)"},
			{Name: "approve", In: "body", Type: "boolean", Desc: "true = duyệt"}, {Name: "note", In: "body", Desc: "Ghi chú (bắt buộc khi từ chối)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrPayroll", Method: "GET", Path: "/hr/payroll", Perm: rpc.Login, Tag: tag,
		Summary: "Lương: config (null = mặc định giao diện), adjustments {tháng: {empId: [...]}}, runs {tháng: {status, closed, payslips...}}, fixed {unitKey: {fund, items}}"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrSavePayrollConfig", Method: "POST", Path: "/hr/payroll/config", Perm: rpc.Login, Tag: tag,
		Summary: "Ghi đè cấu hình công thức lương", Fields: []rpc.GoField{{Name: "config", In: "body", Type: "object", Desc: "Tài liệu cấu hình (tối đa 64 KB)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrAddAdjustment", Method: "POST", Path: "/hr/payroll/adjustments", Perm: rpc.Login, Tag: tag,
		Summary: "Thêm thưởng / phạt / doanh số (bảng lương của tháng phải còn nháp); trả {ok, id}", Fields: []rpc.GoField{
			{Name: "empId", In: "body", Type: "number", Desc: "Nhân sự"}, {Name: "month", In: "body", Desc: "yyyy-mm"},
			{Name: "kind", In: "body", Desc: "bonus / penalty / sales"}, {Name: "label", In: "body", Desc: "Nội dung"}, {Name: "amount", In: "body", Type: "number", Desc: "Số tiền (> 0)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrDeleteAdjustment", Method: "DELETE", Path: "/hr/payroll/adjustments/:id", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá 1 khoản điều chỉnh (bảng lương của tháng phải còn nháp)", Fields: []rpc.GoField{{Name: "id", In: "path", Desc: "Mã khoản (số)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrRunAction", Method: "POST", Path: "/hr/payroll/runs", Perm: rpc.Login, Tag: tag,
		Summary: "Kỳ lương: close / open (chốt công), approve (kèm payslips), pay, reopen", Fields: []rpc.GoField{
			{Name: "month", In: "body", Desc: "yyyy-mm"}, {Name: "action", In: "body", Desc: "close / open / approve / pay / reopen"},
			{Name: "payslips", In: "body", Type: "object", Desc: "approve: bản chụp {empId: {emp, att, p}} (tối đa 4 MB)"},
			{Name: "sent", In: "body", Type: "array", Desc: "pay: id nhân sự đã gửi phiếu lương"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "hrSaveBudget", Method: "POST", Path: "/hr/payroll/budgets", Perm: rpc.Login, Tag: tag,
		Summary: "Định phí của 1 đơn vị (chỉ khoá gửi lên)", Fields: []rpc.GoField{
			{Name: "unit", In: "body", Desc: "Khoá đơn vị"}, {Name: "fund", In: "body", Type: "number", Desc: "Quỹ lương / tháng"},
			{Name: "items", In: "body", Type: "array", Desc: "Khoản định phí khác [{name, amount}]"}}})
	tr := func(name, method, path, sum string, fields ...rpc.GoField) {
		reg.RegisterGoRoute(rpc.GoRoute{Name: name, Method: method, Path: path, Perm: rpc.Login, Tag: tag, Summary: sum, Fields: fields})
	}
	body := func(name, typ, desc string) rpc.GoField {
		return rpc.GoField{Name: name, In: "body", Type: typ, Desc: desc}
	}
	pathID := rpc.GoField{Name: "id", In: "path", Desc: "Mã (số)"}
	tr("hrTalent", "GET", "/hr/talent", "Tuyển dụng + hiệu suất: jds, jobs, candidates, interviews, okrs, reviews {kỳ: {empId: ...}}, enroll {empId: {courseId: %}}")
	tr("hrSaveJD", "POST", "/hr/jds", "Thêm / sửa JD (sửa tên / phòng ban thì tin dùng JD đổi theo); trả {ok, id}",
		body("id", "number", "Có = sửa"), body("title", "", "Tên vị trí (bắt buộc)"), body("code, dept, level, salary, summary", "", "Chuỗi tự do"),
		body("duties, requirements, benefits", "array", "Danh sách chuỗi"))
	tr("hrDeleteJD", "DELETE", "/hr/jds/:id", "Xoá JD chưa có tin nào dùng", pathID)
	tr("hrSaveJob", "POST", "/hr/jobs", "Thêm / sửa tin tuyển dụng; trả {ok, id}", body("id", "number", "Có = sửa"), body("jdId", "number", "JD nguồn (bắt buộc)"),
		body("qty", "number", "Số lượng 1-1000"), body("status", "", "open / paused / closed"), body("deadline", "", "yyyy-mm-dd"),
		body("channels", "array", "Kênh đăng"), body("title, dept, site, salary, desc", "", "Chuỗi tự do"))
	tr("hrCreateCandidate", "POST", "/hr/candidates", "Thêm ứng viên; trả {ok, id}", body("jobId", "number", "Tin tuyển dụng"), body("name", "", "Họ tên (bắt buộc)"),
		body("email, phone, source, cv, exp", "", "Chuỗi tự do"))
	tr("hrUpdateCandidate", "PATCH", "/hr/candidates/:id", "Đổi giai đoạn / thêm đánh giá / thêm lịch phỏng vấn / nhận việc", pathID,
		body("stage", "", "applied / screening / interview / offer / hired / rejected"), body("hiredEmployeeId", "number", "stage hired: hồ sơ nhân sự đã tạo"),
		body("review", "object", "{by, round, scores {tiêu chí: 1-5}, note}"), body("interview", "object", "{date, time, round, interviewer, mode, place}"))
	tr("hrCreateOKR", "POST", "/hr/okrs", "Tạo mục tiêu; trả {ok, id}", body("period", "", "Kỳ"), body("title", "", "Mục tiêu"), body("owner", "number", "Người phụ trách"),
		body("krs", "array", "[{title, target, unit, owner, inverse}]"))
	tr("hrSetKR", "POST", "/hr/okrs/:id/kr", "Cập nhật tiến độ 1 kết quả then chốt", pathID, body("krId", "number", "Mã KR"), body("current", "number", "Giá trị hiện tại"))
	tr("hrReviewAction", "POST", "/hr/reviews", "Đánh giá: launch {empIds} / self / mgr {empId, scores, note}", body("period", "", "Kỳ"), body("action", "", "launch / self / mgr"),
		body("empId", "number", "Nhân sự"), body("empIds", "array", "launch: danh sách nhân sự"), body("scores", "object", "{kỹ năng: 1-5}"), body("note", "", "Nhận xét"))
	tr("hrEnroll", "POST", "/hr/enroll", "Ghi danh / cập nhật tiến độ khoá học", body("empId", "number", "Nhân sự"), body("courses", "object", "{courseId: % (0-100)}"))
	tr("hrSaveCourse", "POST", "/hr/courses", "Thêm / sửa khoá học trong danh mục; trả {ok, id}", body("id", "number", "Có = sửa"), body("title", "", "Tên (bắt buộc)"),
		body("category, format, tone", "", "Chuỗi tự do"), body("hours", "number", "Số giờ"), body("mandatory", "boolean", "Bắt buộc"))
	tr("hrDeleteCourse", "DELETE", "/hr/courses/:id", "Xoá khoá học (bỏ khỏi lộ trình)", pathID)
	tr("hrSavePath", "POST", "/hr/paths", "Thêm / sửa lộ trình học; trả {ok, id}", body("id", "number", "Có = sửa"), body("title", "", "Tên (bắt buộc)"),
		body("for", "", "Đối tượng"), body("courses", "array", "Id khoá học theo thứ tự"))
	tr("hrDeletePath", "DELETE", "/hr/paths/:id", "Xoá lộ trình", pathID)
	tr("hrSecurity", "GET", "/hr/security", "Phân quyền HR: perms (ma trận), maskSalary, accounts (tài khoản của công ty), audit (500 dòng nhật ký hr.* mới nhất), ui (cài đặt bảo mật của giao diện), uiAudit (nhật ký do giao diện ghi)")
	tr("hrSaveSecurity", "POST", "/hr/security", "Lưu ma trận quyền / ẩn lương / cài đặt bảo mật của giao diện (System Admin)", body("perms", "object", "{hradmin|manager|employee: {phân hệ: [thao tác]}}"),
		body("maskSalary", "boolean", "Ẩn lương mặc định"), body("ui", "object", "{settings, session, branches {empId: [chi nhánh]}, roleUsers {vai trò: empId}} (tối đa 64 KB)"))
	tr("hrAddAudit", "POST", "/hr/audit", "Ghi nhật ký thao tác của giao diện HR (audit_logs, action hr.ui); đọc lại ở GET /hr/security -> uiAudit",
		body("entries", "array", "[{time, user, role, module, action, target, ip, warn?}] (1-200 dòng)"))
	tr("hrReset", "POST", "/hr/reset", "Xoá toàn bộ dữ liệu HR của công ty đang đăng nhập (admin công ty; nạp lại dữ liệu mẫu)",
		body("confirm", "", "Phải là XOA_DU_LIEU_HR"))
	tr("hrSetUserRole", "POST", "/hr/security/user", "Gắn tài khoản với hồ sơ / đặt vai trò HR (System Admin)", body("empId", "number", "Hồ sơ nhân sự"),
		body("role", "", "sysadmin / hradmin / manager / employee"), body("userId", "", "Tài khoản (uuid); rỗng = bỏ gắn"))
}

// RegisterRoutes: REST /api/v1/hr, khớp từng GoRoute ở trên.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/hr", middleware.RequireLogin())
	withBody := func(fn func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			r, err := fn(c.Request.Context(), actor.FromGin(c), c)
			response.Result(c, r, err)
		}
	}
	g.GET("", withBody(func(ctx context.Context, a *actor.Actor, _ *gin.Context) (any, error) { return s.Load(ctx, a) }))
	g.POST("/employees", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.CreateEmployee(ctx, a, body)
	}))
	g.PATCH("/employees/:id", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		id, err := validator.ParamNum(c, "id")
		if err != nil {
			return nil, err
		}
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.UpdateEmployee(ctx, a, id, body)
	}))
	g.DELETE("/employees/:id", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		id, err := validator.ParamNum(c, "id")
		if err != nil {
			return nil, err
		}
		return s.DeleteEmployee(ctx, a, id)
	}))
	g.GET("/attendance", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		return s.AttState(ctx, a, c.Query("from"), c.Query("to"))
	}))
	for path, fn := range map[string]func(context.Context, *actor.Actor, *omap.Map) (any, error){
		"/shifts": s.SaveShifts, "/logs": s.SaveLogs, "/requests": s.CreateRequest,
		"/payroll/config": s.SavePayrollConfig, "/payroll/adjustments": s.AddAdjustment, "/payroll/runs": s.RunAction, "/payroll/budgets": s.SaveBudget,
		"/jds": s.SaveJD, "/jobs": s.SaveJob, "/candidates": s.CreateCandidate, "/okrs": s.CreateOKR, "/reviews": s.ReviewAction, "/enroll": s.Enroll,
		"/security": s.SaveSecurity, "/security/user": s.SetUserRole, "/courses": s.SaveCourse, "/paths": s.SavePath,
		"/audit": s.AddAudit, "/reset": s.ResetData,
	} {
		fn := fn
		g.POST(path, withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
			body, err := validator.Body(c)
			if err != nil {
				return nil, err
			}
			return fn(ctx, a, body)
		}))
	}
	g.GET("/talent", withBody(func(ctx context.Context, a *actor.Actor, _ *gin.Context) (any, error) { return s.TalentState(ctx, a) }))
	g.GET("/security", withBody(func(ctx context.Context, a *actor.Actor, _ *gin.Context) (any, error) { return s.SecurityState(ctx, a) }))
	for path, fn := range map[string]func(context.Context, *actor.Actor, float64) (any, error){
		"/jds/:id": s.DeleteJD, "/courses/:id": s.DeleteCourse, "/paths/:id": s.DeletePath,
	} {
		fn := fn
		g.DELETE(path, withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
			id, err := validator.ParamNum(c, "id")
			if err != nil {
				return nil, err
			}
			return fn(ctx, a, id)
		}))
	}
	for path, fn := range map[string]func(context.Context, *actor.Actor, float64, *omap.Map) (any, error){
		"/candidates/:id": s.UpdateCandidate, "/okrs/:id/kr": s.SetKR,
	} {
		fn, method := fn, map[bool]string{true: "PATCH", false: "POST"}[path == "/candidates/:id"]
		g.Handle(method, path, withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
			id, err := validator.ParamNum(c, "id")
			if err != nil {
				return nil, err
			}
			body, err := validator.Body(c)
			if err != nil {
				return nil, err
			}
			return fn(ctx, a, id, body)
		}))
	}
	g.GET("/payroll", withBody(func(ctx context.Context, a *actor.Actor, _ *gin.Context) (any, error) { return s.PayrollState(ctx, a) }))
	g.DELETE("/payroll/adjustments/:id", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		id, err := validator.ParamNum(c, "id")
		if err != nil {
			return nil, err
		}
		return s.DeleteAdjustment(ctx, a, id)
	}))
	g.POST("/requests/:id/decide", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		id, err := validator.ParamNum(c, "id")
		if err != nil {
			return nil, err
		}
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.DecideRequest(ctx, a, id, body)
	}))
	g.POST("/org", withBody(func(ctx context.Context, a *actor.Actor, c *gin.Context) (any, error) {
		body, err := validator.Body(c)
		if err != nil {
			return nil, err
		}
		return s.SaveOrg(ctx, a, body)
	}))
}
