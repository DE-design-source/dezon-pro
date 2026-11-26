package sales

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/omap"
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
		{Name: "handoff", In: "body", Type: "object", Desc: "Phiếu bàn giao gần nhất {status, dept, requestedAt, assignee, stage}; stage = giai đoạn gửi phiếu, dept Thiết kế / Thi công quyết định trang triển khai; null = không có"},
	}
	for _, k := range []string{"phone", "email", "address", "source", "projectType", "scale", "concept", "notes", "creator", "manager", "boqFile"} {
		f = append(f, rpc.GoField{Name: k, In: "body", Desc: "Chuỗi tự do"})
	}
	return f
}()

var (
	idPath   = rpc.GoField{Name: "id", In: "path", Desc: "Mã khách hàng (số)"}
	apptPath = rpc.GoField{Name: "apptId", In: "path", Desc: "Mã lịch hẹn (số)"}
	taskPath = rpc.GoField{Name: "taskId", In: "path", Desc: "Mã task (số)"}
	recPath  = rpc.GoField{Name: "recId", In: "path", Desc: "Mã hội thoại (số)"}
	apptBody = []rpc.GoField{
		{Name: "date", In: "body", Desc: "Ngày hẹn yyyy-mm-dd (bắt buộc khi tạo)"},
		{Name: "start", In: "body", Desc: "Giờ bắt đầu HH:MM (rỗng = chưa đặt)"}, {Name: "end", In: "body", Desc: "Giờ kết thúc HH:MM, sau giờ bắt đầu"},
		{Name: "title", In: "body", Desc: "Tiêu đề (bắt buộc khi tạo)"}, {Name: "mode", In: "body", Desc: "Hình thức (Họp trực tiếp, Online...)"},
		{Name: "place", In: "body", Desc: "Địa điểm"}, {Name: "goal", In: "body", Desc: "Mục tiêu buổi hẹn"},
		{Name: "members", In: "body", Type: "array", Desc: "Người tham gia [tên]"},
		{Name: "prep", In: "body", Type: "array", Desc: "Danh sách chuẩn bị [{text, done}]"},
		{Name: "status", In: "body", Desc: "planned / done / cancelled (mặc định planned)"},
		{Name: "by", In: "body", Desc: "Tên người ghi (trống = họ tên tài khoản)"},
	}
	taskBody = []rpc.GoField{
		{Name: "title", In: "body", Desc: "Việc cần làm (bắt buộc khi tạo)"}, {Name: "dueDate", In: "body", Desc: "Hạn yyyy-mm-dd; rỗng = không hạn"},
		{Name: "assignees", In: "body", Type: "array", Desc: "Người làm [{name, username}]"}, {Name: "note", In: "body", Desc: "Ghi chú"},
		{Name: "done", In: "body", Type: "boolean", Desc: "Đã xong (ghi kèm thời điểm xong)"}, {Name: "source", In: "body", Desc: "rỗng / ai (tạo từ gợi ý AI)"},
		{Name: "by", In: "body", Desc: "Tên người ghi (trống = họ tên tài khoản)"},
	}
)

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). Quyền tab kiểm trong service.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	tag := "Kinh doanh"
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListLeads", Method: "GET", Path: "/sales/leads", Perm: rpc.Login, Tag: tag,
		Summary: "Danh sách khách hàng tiềm năng của công ty, kèm tổng báo giá QS (chưa VAT) nếu đã gắn dự án"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListStaff", Method: "GET", Path: "/sales/staff", Perm: rpc.Login, Tag: tag,
		Summary: "Tài khoản đang hoạt động của công ty để giao phụ trách khách hàng: {staff: [{username, name, department, role, sales}]}, sales = vào được Kinh doanh"})
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

	// trang khách hàng dạng dashboard (migration 0053)
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdGetScore", Method: "GET", Path: "/sales/leads/:id/score", Perm: rpc.Login, Tag: tag,
		Summary: "Chỉ số chính: 6 tiêu chí × 4 câu -> {checks, criteria, critScore, dealScore, locks, prevWeek, updatedAt, updatedBy}", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdSaveScore", Method: "PUT", Path: "/sales/leads/:id/score", Perm: rpc.Login, Tag: tag,
		Summary: "Lưu câu trả lời 6 tiêu chí và thêm 1 điểm lịch sử (So với tuần trước)", Fields: []rpc.GoField{idPath,
			{Name: "checks", In: "body", Type: "object", Desc: "{tien, quyetdinh, dat, thoidiem, nhucau, canhtranh: [bool×4]}"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListAppointments", Method: "GET", Path: "/sales/leads/:id/appointments", Perm: rpc.Login, Tag: tag,
		Summary: "Lịch hẹn của khách hàng, theo ngày giờ tăng dần: {appointments: [...]}", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdAddAppointment", Method: "POST", Path: "/sales/leads/:id/appointments", Perm: rpc.Login, Tag: tag,
		Summary: "Thêm lịch hẹn với khách hàng", Fields: append([]rpc.GoField{idPath}, apptBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdUpdateAppointment", Method: "PATCH", Path: "/sales/appointments/:apptId", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa lịch hẹn (chỉ các khoá gửi lên): dời lịch, chuẩn bị, xong / huỷ", Fields: append([]rpc.GoField{apptPath}, apptBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdDeleteAppointment", Method: "DELETE", Path: "/sales/appointments/:apptId", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá lịch hẹn", Fields: []rpc.GoField{apptPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListTasks", Method: "GET", Path: "/sales/leads/:id/tasks", Perm: rpc.Login, Tag: tag,
		Summary: "Task của khách hàng, chưa xong trước rồi theo hạn: {tasks: [...]}", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdAddTask", Method: "POST", Path: "/sales/leads/:id/tasks", Perm: rpc.Login, Tag: tag,
		Summary: "Thêm task cho khách hàng", Fields: append([]rpc.GoField{idPath}, taskBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdUpdateTask", Method: "PATCH", Path: "/sales/tasks/:taskId", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa task (chỉ các khoá gửi lên): tick xong, hạn, người làm", Fields: append([]rpc.GoField{taskPath}, taskBody...)})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdDeleteTask", Method: "DELETE", Path: "/sales/tasks/:taskId", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá task", Fields: []rpc.GoField{taskPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdGetInsights", Method: "GET", Path: "/sales/leads/:id/insights", Perm: rpc.Login, Tag: tag,
		Summary: "Bản phân tích AI mới nhất của khách hàng: {insight: {...} | null}", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdGenerateInsights", Method: "POST", Path: "/sales/leads/:id/insights/generate", Perm: rpc.Login, Tag: tag,
		Summary: "Lập phân tích mới bằng Gemini (chưa có GEMINI_API_KEY / lỗi -> gợi ý theo quy tắc, engine rules), lưu lại và trả {insight}",
		Fields: []rpc.GoField{idPath, {Name: "start", In: "body", Desc: "Khởi công dự kiến yyyy-mm-dd (tuỳ chọn)"},
			{Name: "extra", In: "body", Type: "array", Desc: "Tài liệu bổ sung [{name, url}] (tuỳ chọn)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdUpdateInsight", Method: "PATCH", Path: "/sales/leads/:id/insights", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa tay bản phân tích mới nhất (chuẩn hoá như kết quả Gemini, phần thiếu giữ nguyên, ghi editedBy / editedAt), trả {insight}",
		Fields: []rpc.GoField{idPath, {Name: "content", In: "body", Type: "object", Required: true, Desc: "{actions, strategy, ideas, roadmap}; actions.main.title bắt buộc; mảng rỗng = xoá hết"},
			{Name: "generatedAt", In: "body", Desc: "generatedAt của bản đang sửa; khác bản mới nhất -> 409 (tuỳ chọn)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdInsightChat", Method: "POST", Path: "/sales/leads/:id/insights/chat", Perm: rpc.Login, Tag: tag,
		Summary: "Hỏi AI về khách hàng / bản phân tích hoặc nhờ sửa 1 phần (không lưu): {reply, proposal: {section, summary, content, generatedAt, editedAt} | null, engine, model}",
		Fields: []rpc.GoField{idPath, {Name: "messages", In: "body", Type: "array", Required: true, Desc: "Cuộc trò chuyện [{role: user | ai, text}], tin cuối là câu hỏi của người dùng; giữ 20 tin gần nhất, mỗi tin tối đa 2000 ký tự"},
			{Name: "generatedAt", In: "body", Desc: "generatedAt của bản phân tích đang xem (tuỳ chọn; đề xuất luôn dựa trên bản mới nhất)"}}})

	// hội thoại ghi lại từ khối Live (service_recording.go, migration 0055)
	recSum := " -> {id, leadId, kind, title, durationSec, status, engine, model, error, summary, lines, liveLines, audioUrl, audioMime, audioBytes, staffName, customerName, authorName, activityId, createdAt, updatedAt}"
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdListRecordings", Method: "GET", Path: "/sales/leads/:id/recordings", Perm: rpc.Login, Tag: tag,
		Summary: "Hội thoại đã ghi của khách hàng, mới nhất trước: {recordings: [...]}", Fields: []rpc.GoField{idPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdAddRecording", Method: "POST", Path: "/sales/leads/:id/recordings", Perm: rpc.Login, Tag: tag,
		Summary: "Lưu hội thoại (multipart/form-data): tạo lần chăm sóc, AI (Gemini) tách người nói Nhân viên / Khách + tóm tắt chạy nền" + recSum,
		Fields: []rpc.GoField{idPath,
			{Name: "meta", In: "body", Required: true, Desc: `Chuỗi JSON {kind: meeting|call, durationSec, staffName, customerName, liveLines: [{who: nv|kh, t, at (giây)}], audioComplete}`},
			{Name: "audio", In: "body", Desc: "File ghi âm (tuỳ chọn, tối đa 20 MB): audio/webm, ogg, mp4, mpeg, wav"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdUpdateRecording", Method: "PATCH", Path: "/sales/recordings/:recId", Perm: rpc.Login, Tag: tag,
		Summary: "Sửa tay lời thoại (đổi người nói / sửa chữ), ghi lại nội dung lần chăm sóc" + recSum,
		Fields:  []rpc.GoField{recPath, {Name: "lines", In: "body", Type: "array", Required: true, Desc: "[{who: nv|kh, t, at (giây)}]"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdReprocessRecording", Method: "POST", Path: "/sales/recordings/:recId/reprocess", Perm: rpc.Login, Tag: tag,
		Summary: "Chạy lại AI cho hội thoại (đang xử lý chưa quá 10 phút -> 409; chưa cấu hình Gemini -> 400)" + recSum, Fields: []rpc.GoField{recPath}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdDeleteRecording", Method: "DELETE", Path: "/sales/recordings/:recId", Perm: rpc.Login, Tag: tag,
		Summary: "Xoá hội thoại + file ghi âm (lần chăm sóc giữ nguyên): {ok}", Fields: []rpc.GoField{recPath}})

	// Cấu hình AI (service_aiconfig.go): hướng dẫn cho khối "Đề xuất hành động", lưu ở cài đặt công ty khoá kdAiConfig
	aiDraft := []rpc.GoField{{Name: "leadId", In: "body", Type: "number", Required: true, Desc: "Mã khách hàng dùng để thử"},
		{Name: "instructions", In: "body", Desc: "Hướng dẫn nháp (thiếu / null = bản đang lưu; rỗng = mặc định)"}}
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdGetAiConfig", Method: "GET", Path: "/sales/ai-config", Perm: rpc.Login, Tag: tag,
		Summary: "Cấu hình AI: {instructions, defaultInstructions, custom, fixedRules, outputShape, aiEnabled, model, modelChoice, defaultModel, models, modelsError, updatedAt, updatedBy, canEdit, maxLength, history}"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdSaveAiConfig", Method: "PUT", Path: "/sales/ai-config", Perm: rpc.Admin, Tag: tag,
		Summary: "Lưu hướng dẫn + model cho AI (rỗng / trùng mặc định -> dùng mặc định; bản cũ vào lịch sử, giữ 20 bản), trả như GET",
		Fields: []rpc.GoField{{Name: "instructions", In: "body", Required: true, Desc: "Hướng dẫn cho AI, tối đa 8000 ký tự"},
			{Name: "model", In: "body", Desc: "Model Gemini (thiếu / null = giữ; rỗng = mặc định máy chủ; sai -> 400)"}}})
	aiTest := append(append([]rpc.GoField{}, aiDraft...),
		rpc.GoField{Name: "model", In: "body", Desc: "Model nháp (thiếu / null = model đã lưu; rỗng = mặc định máy chủ; sai -> 400)"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdGetLiveKnowledge", Method: "GET", Path: "/sales/live-knowledge", Perm: rpc.Login, Tag: tag,
		Summary: "Kiến thức bán hàng cho AI gợi ý khi Live: {text, updatedAt, updatedBy, canEdit, maxLength, aiEnabled}"})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdSaveLiveKnowledge", Method: "PUT", Path: "/sales/live-knowledge", Perm: rpc.Admin, Tag: tag,
		Summary: "Lưu kiến thức bán hàng (bảng giá, gói dịch vụ, câu trả lời mẫu) cho AI gợi ý khi Live, trả như GET",
		Fields:  []rpc.GoField{{Name: "text", In: "body", Required: true, Desc: "Nội dung, tối đa 8000 ký tự; rỗng = xoá"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdReadLandCert", Method: "POST", Path: "/sales/land-cert/read", Perm: rpc.Login, Tag: tag,
		Summary: "AI đọc ảnh sổ đỏ đã tải lên (không lưu): {docType, area (m²), width, length (m), shapeNote, plotNo, mapSheet, purpose, address, note, model}",
		Fields:  []rpc.GoField{{Name: "url", In: "body", Required: true, Desc: "Đường dẫn ảnh trong kho tệp (/files/...), JPG / PNG / WEBP / GIF, tối đa 15 MB"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdLiveSuggest", Method: "POST", Path: "/sales/leads/:id/live-suggest", Perm: rpc.Login, Tag: tag,
		Summary: "AI gợi ý cho nhân viên trong lúc Live (không lưu): {stage, insight, answers: [{q, a}], ask, missing, engine, model, at}",
		Fields: []rpc.GoField{idPath, {Name: "lines", In: "body", Type: "array", Required: true, Desc: "Hội thoại gần nhất [{who: nv | kh, t, at (giây)}]; giữ 60 dòng / 8000 ký tự cuối"},
			{Name: "elapsedSec", In: "body", Type: "number", Desc: "Số giây đã ghi (tuỳ chọn)"}}})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdPreviewAiPrompt", Method: "POST", Path: "/sales/ai-config/preview", Perm: rpc.Admin, Tag: tag,
		Summary: "Xem trước {system, prompt} sẽ gửi Gemini cho 1 khách với hướng dẫn nháp; không gọi AI", Fields: aiDraft})
	reg.RegisterGoRoute(rpc.GoRoute{Name: "kdTestAiPrompt", Method: "POST", Path: "/sales/ai-config/test", Perm: rpc.Admin, Tag: tag,
		Summary: "Chạy thử hướng dẫn / model nháp với 1 khách (không lưu phân tích): {content, engine, model, warning, ms, raw}; cùng người trong 5 giây -> 429",
		Fields:  aiTest})
}

// RegisterRoutes: REST /api/v1/sales, khớp từng GoRoute ở trên.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/sales", s.readKeyAuth(), middleware.RequireLogin()) // readKeyAuth: khoá API chỉ đọc, apikey.go
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
	// withParam: đọc tham số số trên path (+ body JSON nếu withBody) rồi gọi service
	withParam := func(name string, withBody bool, fn func(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			id, err := validator.ParamNum(c, name)
			if err != nil {
				response.Error(c, err)
				return
			}
			body := omap.New()
			if withBody {
				if body, err = validator.Body(c); err != nil {
					response.Error(c, err)
					return
				}
			}
			r, err := fn(c.Request.Context(), actor.FromGin(c), id, body)
			response.Result(c, r, err)
		}
	}
	noBody := func(fn func(ctx context.Context, a *actor.Actor, id float64) (any, error)) func(context.Context, *actor.Actor, float64, *omap.Map) (any, error) {
		return func(ctx context.Context, a *actor.Actor, id float64, _ *omap.Map) (any, error) { return fn(ctx, a, id) }
	}
	g.GET("/leads/:id/score", withParam("id", false, noBody(s.GetScore)))
	g.PUT("/leads/:id/score", withParam("id", true, s.SaveScore))
	g.GET("/leads/:id/appointments", withParam("id", false, noBody(s.ListAppointments)))
	g.POST("/leads/:id/appointments", withParam("id", true, s.AddAppointment))
	g.PATCH("/appointments/:apptId", withParam("apptId", true, s.UpdateAppointment))
	g.DELETE("/appointments/:apptId", withParam("apptId", false, noBody(s.DeleteAppointment)))
	g.GET("/leads/:id/tasks", withParam("id", false, noBody(s.ListTasks)))
	g.POST("/leads/:id/tasks", withParam("id", true, s.AddTask))
	g.PATCH("/tasks/:taskId", withParam("taskId", true, s.UpdateTask))
	g.DELETE("/tasks/:taskId", withParam("taskId", false, noBody(s.DeleteTask)))
	g.GET("/leads/:id/insights", withParam("id", false, noBody(s.GetInsights)))
	g.PATCH("/leads/:id/insights", withParam("id", true, s.UpdateInsight))
	g.POST("/leads/:id/insights/generate", withParam("id", true, s.GenerateInsights))
	g.POST("/leads/:id/insights/chat", withParam("id", true, s.ChatInsight))
	g.GET("/leads/:id/recordings", withParam("id", false, noBody(s.ListRecordings)))
	g.POST("/leads/:id/recordings", func(c *gin.Context) {
		id, err := validator.ParamNum(c, "id")
		if err != nil {
			response.Error(c, err)
			return
		}
		up, err := readRecordingForm(c)
		if err != nil {
			response.Error(c, err)
			return
		}
		r, err := s.CreateRecording(c.Request.Context(), actor.FromGin(c), id, up)
		response.Result(c, r, err)
	})
	g.PATCH("/recordings/:recId", withParam("recId", true, s.UpdateRecording))
	g.POST("/recordings/:recId/reprocess", withParam("recId", false, noBody(s.ReprocessRecording)))
	g.DELETE("/recordings/:recId", withParam("recId", false, noBody(s.DeleteRecording)))
	withBody := func(fn func(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			body, err := validator.Body(c)
			if err != nil {
				response.Error(c, err)
				return
			}
			r, err := fn(c.Request.Context(), actor.FromGin(c), body)
			response.Result(c, r, err)
		}
	}
	g.GET("/ai-config", func(c *gin.Context) {
		r, err := s.GetAiConfig(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	g.PUT("/ai-config", middleware.RequireAdmin(), withBody(s.SaveAiConfig))
	g.GET("/live-knowledge", func(c *gin.Context) {
		r, err := s.GetLiveKnowledge(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	g.PUT("/live-knowledge", middleware.RequireAdmin(), withBody(s.SaveLiveKnowledge))
	g.POST("/leads/:id/live-suggest", withParam("id", true, s.LiveSuggest))
	g.POST("/land-cert/read", withBody(s.ReadLandCert))
	g.POST("/ai-config/preview", middleware.RequireAdmin(), withBody(s.PreviewAiPrompt))
	g.POST("/ai-config/test", middleware.RequireAdmin(), withBody(s.TestAiPrompt))
	g.GET("/leads", func(c *gin.Context) {
		r, err := s.ListLeads(c.Request.Context(), actor.FromGin(c))
		response.Result(c, r, err)
	})
	g.GET("/staff", func(c *gin.Context) {
		r, err := s.ListStaff(c.Request.Context(), actor.FromGin(c))
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

// readRecordingForm: đọc multipart/form-data của POST /sales/leads/:id/recordings - trường "meta" (chuỗi JSON) + file "audio"
// (tuỳ chọn, Content-Type của phần file = kiểu ghi âm). Thân tối đa recMaxBody; file quá 20 MB -> 413. Phần khác bỏ qua.
func readRecordingForm(c *gin.Context) (RecordingUpload, error) {
	var up RecordingUpload
	tooBig := apperr.E(http.StatusRequestEntityTooLarge, "File ghi âm quá lớn (tối đa 20 MB)")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, recMaxBody)
	mr, err := c.Request.MultipartReader()
	if err != nil {
		return up, apperr.BadRequest("Dữ liệu gửi lên phải là multipart/form-data")
	}
	read := func(p io.Reader, max int64, over error) ([]byte, error) {
		b, err := io.ReadAll(io.LimitReader(p, max+1))
		var mbe *http.MaxBytesError
		switch {
		case errors.As(err, &mbe):
			return nil, tooBig
		case err != nil:
			return nil, apperr.BadRequest("Dữ liệu gửi lên không hợp lệ")
		case int64(len(b)) > max:
			return nil, over
		}
		return b, nil
	}
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			return up, nil
		}
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return up, tooBig
		}
		if err != nil {
			return up, apperr.BadRequest("Dữ liệu gửi lên không hợp lệ")
		}
		switch p.FormName() {
		case "meta":
			b, err := read(p, recMaxMeta, apperr.BadRequest("Thông tin hội thoại (meta) quá lớn"))
			if err != nil {
				return up, err
			}
			v, err := omap.Decode(b)
			m, ok := v.(*omap.Map)
			if err != nil || !ok {
				return up, apperr.BadRequest("Thông tin hội thoại (meta) phải là JSON object")
			}
			up.Meta = m
		case "audio":
			b, err := read(p, recMaxAudio, tooBig)
			if err != nil {
				return up, err
			}
			up.Audio, up.AudioMIME = b, p.Header.Get("Content-Type")
		default:
			if _, err := read(p, recMaxBody, tooBig); err != nil {
				return up, err
			}
		}
		_ = p.Close()
	}
}
