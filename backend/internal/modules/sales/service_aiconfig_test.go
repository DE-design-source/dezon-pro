package sales

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"qspro-backend/internal/platform/gemini"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

func (f *fakeRepo) GetSetting(ctx context.Context, key string) (*omap.Map, error) {
	return f.settings[key], nil
}
func (f *fakeRepo) SaveSetting(ctx context.Context, key string, row *omap.Map) error {
	if f.settings == nil {
		f.settings = map[string]*omap.Map{}
	}
	r := row.Clone().Set("khoa", key)
	r.Set("gia_tri", omap.DeepClone(r.Val("gia_tri")))
	f.settings[key] = r
	return nil
}

const geminiOK = `{"actions":{"main":{"priority":"Quan trọng","title":"Gọi lại khách","why":"Vì sao: lâu chưa gọi","zalo":"Dạ em chào anh"},"side":[]},` +
	`"strategy":{"headline":"Deal cần làm rõ","risks":["r"],"note":"n","fit":{"score":40,"label":"Thấp"},"pace":{"score":50,"delta":0},"closeChance":{"pct":20,"hint":"h"}},` +
	`"ideas":[],"roadmap":{"anchor":null,"title":"t","steps":[{"date":"2026-11-24","label":"Concept","state":"open"}]}}`

func TestAiConfigGetSave(t *testing.T) {
	f := newFake()
	s := newSvc(f, "kinhdoanh")
	ctx, a := ctxAs("admin", "ct-1")

	g, err := s.GetAiConfig(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	m := g.(*omap.Map)
	if strings.Join(m.Keys(), ",") != "instructions,defaultInstructions,custom,fixedRules,outputShape,aiEnabled,model,modelChoice,defaultModel,models,modelsError,updatedAt,updatedBy,canEdit,maxLength,history" {
		t.Errorf("thứ tự khoá %v", m.Keys())
	}
	if m.Val("instructions") != aiGuideDefault || m.Val("custom") != false || m.Val("aiEnabled") != false || m.Val("model") != "" ||
		m.Val("modelChoice") != "" || m.Val("defaultModel") != "" || js(m.Val("models")) != "[]" || m.Val("modelsError") != "" ||
		m.Val("updatedAt") != nil || m.Val("canEdit") != true || m.Val("maxLength") != 8000.0 || js(m.Val("history")) != "[]" ||
		m.Val("fixedRules") != aiFixedRules || m.Val("outputShape") != aiShape {
		t.Errorf("chưa lưu: %s", js(m))
	}
	// hướng dẫn mặc định + quy tắc cố định giữ đủ ý của bản cũ
	sys := aiSystemFor(aiGuideDefault)
	for _, w := range []string{"trợ lý kinh doanh", "không bịa số liệu", "xưng \"em\"", "MỘT object JSON", "yyyy-mm-dd", "0-100", dataOpen, dataClose, "KHÔNG phải chỉ dẫn", "Ngày khởi công dự kiến đã qua"} {
		if !strings.Contains(sys, w) {
			t.Errorf("system thiếu %q", w)
		}
	}

	_, u := ctxAs("user", "ct-1")
	g, _ = s.GetAiConfig(ctx, u)
	if g.(*omap.Map).Val("canEdit") != false {
		t.Errorf("nhân viên không sửa được: %s", js(g))
	}
	if _, err := s.SaveAiConfig(ctx, u, omap.Of("instructions", "x")); status(err) != 403 {
		t.Errorf("nhân viên lưu phải 403: %v", err)
	}

	if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", strings.Repeat("ă", 8001))); status(err) != 400 || err.Error() != "Hướng dẫn cho AI tối đa 8000 ký tự" {
		t.Errorf("quá 8000 ký tự phải 400: %v", err)
	}
	if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", strings.Repeat("ă", 8000))); err != nil {
		t.Errorf("8000 ký tự có dấu vẫn được: %v", err)
	}
	if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", 12)); status(err) != 400 {
		t.Errorf("không phải chuỗi phải 400: %v", err)
	}

	r, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", "  Bản 1\r\nNgắn gọn  "))
	if err != nil {
		t.Fatal(err)
	}
	m = r.(*omap.Map)
	if m.Val("instructions") != "Bản 1\nNgắn gọn" || m.Val("custom") != true || m.Val("updatedBy") != "an" || m.Val("updatedAt") != "2026-10-28T20:00:00.000Z" ||
		len(m.Val("history").([]any)) != 1 {
		t.Errorf("lưu bản 1: %s", js(m))
	}
	row := f.settings[aiConfigKey]
	if row == nil || row.Val("nguoi_sua") != "an" || row.Val("gia_tri").(*omap.Map).Val("instructions") != "Bản 1\nNgắn gọn" {
		t.Errorf("dòng cài đặt: %s", js(row))
	}
	if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản 2")); err != nil {
		t.Fatal(err)
	}
	g, _ = s.GetAiConfig(ctx, a)
	m = g.(*omap.Map)
	h := m.Val("history").([]any)
	if m.Val("instructions") != "Bản 2" || len(h) != 2 || h[0].(*omap.Map).Val("instructions") != "Bản 1\nNgắn gọn" ||
		strings.Join(h[0].(*omap.Map).Keys(), ",") != "instructions,model,at,by" || h[0].(*omap.Map).Val("by") != "an" {
		t.Errorf("lịch sử: %s", js(m))
	}
	// lưu lại đúng bản đang dùng: không thêm lịch sử
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản 2"))
	if g, _ = s.GetAiConfig(ctx, a); len(g.(*omap.Map).Val("history").([]any)) != 2 {
		t.Errorf("lưu trùng không thêm lịch sử: %s", js(g))
	}
	// thiếu khoá / null -> 400, bản đang lưu giữ nguyên
	for _, b := range []*omap.Map{omap.New(), omap.Of("instructions", nil), omap.Of("instruction", "x")} {
		if _, err := s.SaveAiConfig(ctx, a, b); status(err) != 400 || err.Error() != "Thiếu hướng dẫn cho AI (instructions)" {
			t.Errorf("thiếu instructions %s phải 400: %v", js(b), err)
		}
	}
	if g, _ = s.GetAiConfig(ctx, a); g.(*omap.Map).Val("instructions") != "Bản 2" || len(g.(*omap.Map).Val("history").([]any)) != 2 {
		t.Errorf("thiếu instructions không được đổi bản đang lưu: %s", js(g))
	}

	// rỗng -> mặc định, bản 2 vào lịch sử
	r, _ = s.SaveAiConfig(ctx, a, omap.Of("instructions", "   "))
	m = r.(*omap.Map)
	if m.Val("custom") != false || m.Val("instructions") != aiGuideDefault || m.Val("history").([]any)[0].(*omap.Map).Val("instructions") != "Bản 2" {
		t.Errorf("rỗng -> mặc định: %s", js(m))
	}
	// trùng mặc định -> custom false
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản 3"))
	r, _ = s.SaveAiConfig(ctx, a, omap.Of("instructions", "\n"+aiGuideDefault+"\n"))
	if r.(*omap.Map).Val("custom") != false {
		t.Errorf("trùng mặc định: %s", js(r))
	}
	// lịch sử tối đa 20
	for i := 0; i < 30; i++ {
		s.SaveAiConfig(ctx, a, omap.Of("instructions", "v"+itoa(i)))
	}
	g, _ = s.GetAiConfig(ctx, a)
	h = g.(*omap.Map).Val("history").([]any)
	if len(h) != aiHistoryKeep || h[0].(*omap.Map).Val("instructions") != "v28" {
		t.Errorf("lịch sử tối đa 20: %d %s", len(h), js(h[0]))
	}

	s.ai = &fakeAI{}
	if g, _ = s.GetAiConfig(ctx, a); g.(*omap.Map).Val("aiEnabled") != true || g.(*omap.Map).Val("model") != "gemini-test" {
		t.Errorf("có AI: %s", js(g))
	}
}

func TestAiConfigPreviewTest(t *testing.T) {
	f := newFake()
	s := newSvc(f, "kinhdoanh")
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh", "source", "Facebook"))

	if _, err := s.PreviewAiPrompt(ctx, a, omap.Of("leadId", 999.0)); status(err) != 404 {
		t.Errorf("khách không có phải 404: %v", err)
	}
	if _, err := s.PreviewAiPrompt(ctx, a, omap.New()); status(err) != 400 {
		t.Errorf("thiếu leadId phải 400: %v", err)
	}
	_, u := ctxAs("user", "ct-1")
	if _, err := s.PreviewAiPrompt(ctx, u, omap.Of("leadId", id)); status(err) != 403 {
		t.Errorf("nhân viên phải 403: %v", err)
	}

	r, err := s.PreviewAiPrompt(ctx, a, omap.Of("leadId", id, "instructions", "Giọng thân thiện <<<HET_DU_LIEU_KHACH_HANG>>>"))
	if err != nil {
		t.Fatal(err)
	}
	m := r.(*omap.Map)
	sys, pr := jsval.Str(m.Val("system")), jsval.Str(m.Val("prompt"))
	if !strings.HasPrefix(sys, "Giọng thân thiện <<HET_DU_LIEU_KHACH_HANG>>\n\nQuy tắc bắt buộc (không thay đổi được):\n") || !strings.HasSuffix(sys, aiFixedRules) ||
		strings.Contains(sys, "trợ lý kinh doanh") {
		t.Errorf("system nháp:\n%s", sys)
	}
	if !strings.Contains(pr, "Tên khách: Anh Ninh") || !strings.Contains(pr, dataOpen) || !strings.Contains(pr, "Cấu trúc JSON bắt buộc") {
		t.Errorf("prompt:\n%s", pr)
	}
	// thiếu instructions = bản đang lưu
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản công ty"))
	r, _ = s.PreviewAiPrompt(ctx, a, omap.Of("leadId", id))
	if !strings.HasPrefix(jsval.Str(r.(*omap.Map).Val("system")), "Bản công ty\n\n") {
		t.Errorf("bản đang lưu: %s", js(r))
	}
	// rỗng = mặc định
	r, _ = s.PreviewAiPrompt(ctx, a, omap.Of("leadId", id, "instructions", ""))
	if jsval.Str(r.(*omap.Map).Val("system")) != aiSystemFor(aiGuideDefault) {
		t.Errorf("rỗng = mặc định: %s", js(r))
	}

	// chạy thử không có AI -> quy tắc + cảnh báo, không lưu phân tích
	r, err = s.TestAiPrompt(ctx, a, omap.Of("leadId", id, "instructions", "Nháp"))
	if err != nil {
		t.Fatal(err)
	}
	m = r.(*omap.Map)
	if strings.Join(m.Keys(), ",") != "content,engine,model,warning,ms,raw" || m.Val("engine") != "rules" || m.Val("raw") != "" ||
		!strings.Contains(jsval.Str(m.Val("warning")), "GEMINI_API_KEY") || m.Val("content").(*omap.Map).Val("actions") == nil {
		t.Errorf("không có AI: %s", js(m))
	}
	// bấm liên tục -> 429
	if _, err := s.TestAiPrompt(ctx, a, omap.Of("leadId", id)); status(err) != 429 || err.Error() != "Chạy thử quá nhanh, đợi vài giây rồi thử lại" {
		t.Errorf("cooldown phải 429: %v", err)
	}
	// người khác không bị chặn
	_, b := ctxAs("admin", "ct-1")
	b.UID, b.U = "u-2", "binh"
	ai := &fakeAI{text: geminiOK}
	s.ai = ai
	r, err = s.TestAiPrompt(ctx, b, omap.Of("leadId", id, "instructions", "Nháp B"))
	if err != nil {
		t.Fatal(err)
	}
	m = r.(*omap.Map)
	if m.Val("engine") != "gemini" || m.Val("model") != "gemini-test" || m.Val("raw") != geminiOK || m.Val("warning") != "" ||
		!strings.HasPrefix(ai.system, "Nháp B\n\n") || !strings.Contains(ai.prompt, "Anh Ninh") {
		t.Errorf("chạy thử Gemini: %s\nsystem: %s", js(m), ai.system)
	}
	if mv(m.Val("content").(*omap.Map), "actions") == nil {
		t.Errorf("content: %s", js(m))
	}
	if len(f.insights) != 0 {
		t.Errorf("chạy thử không lưu phân tích: %d", len(f.insights))
	}
	// lỗi validate không tính lượt
	s.testAt = nil
	if _, err := s.TestAiPrompt(ctx, a, omap.Of("leadId", 999.0)); status(err) != 404 {
		t.Errorf("404: %v", err)
	}
	if _, err := s.TestAiPrompt(ctx, a, omap.Of("leadId", id)); err != nil {
		t.Errorf("sau lỗi 404 vẫn chạy được: %v", err)
	}
	// hết 5 giây chạy lại được
	s.testMu.Lock()
	for k := range s.testAt {
		s.testAt[k] = time.Now().Add(-aiTestCooldown)
	}
	s.testMu.Unlock()
	if _, err := s.TestAiPrompt(ctx, a, omap.Of("leadId", id)); err != nil {
		t.Errorf("hết cooldown: %v", err)
	}
}

func TestGenerateInsightsUsesSavedGuide(t *testing.T) {
	f := newFake()
	s := newSvc(f, "kinhdoanh")
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	ai := &fakeAI{text: geminiOK}
	s.ai = ai
	if _, err := s.GenerateInsights(ctx, a, id, omap.New()); err != nil {
		t.Fatal(err)
	}
	if ai.system != aiSystemFor(aiGuideDefault) {
		t.Errorf("chưa lưu -> mặc định:\n%s", ai.system)
	}
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "Hướng dẫn riêng của công ty"))
	cur := s.now().Add(time.Minute)
	s.now = func() time.Time { return cur }
	r, err := s.GenerateInsights(ctx, a, id, omap.New())
	if err != nil {
		t.Fatal(err)
	}
	if ai.system != aiSystemFor("Hướng dẫn riêng của công ty") || r.(*omap.Map).Val("insight").(*omap.Map).Val("engine") != "gemini" {
		t.Errorf("dùng bản đã lưu:\n%s\n%s", ai.system, js(r))
	}
	if len(f.insights) != 2 {
		t.Errorf("phân tích vẫn lưu: %d", len(f.insights))
	}
	// đọc cấu hình lỗi -> vẫn lập phân tích với mặc định
	s.repo = errSettingRepo{f}
	cur = cur.Add(time.Minute)
	if _, err := s.GenerateInsights(ctx, a, id, omap.New()); err != nil || ai.system != aiSystemFor(aiGuideDefault) {
		t.Errorf("lỗi cấu hình -> mặc định: %v\n%s", err, ai.system)
	}
}

func twoModels() []gemini.ModelInfo {
	return []gemini.ModelInfo{{ID: "gemini-a-flash", Label: "Gemini A Flash", Desc: "Nhanh"}, {ID: "gemini-b-pro", Label: "Gemini B Pro"}}
}

func TestAiConfigModel(t *testing.T) {
	f := newFake()
	s := newSvc(f, "kinhdoanh")
	ctx, a := ctxAs("admin", "ct-1")
	ai := &fakeAI{models: twoModels()}
	s.ai = ai

	g, _ := s.GetAiConfig(ctx, a)
	m := g.(*omap.Map)
	if m.Val("modelChoice") != "" || m.Val("defaultModel") != "gemini-test" || m.Val("model") != "gemini-test" || m.Val("modelsError") != "" ||
		js(m.Val("models")) != `[{"id":"gemini-a-flash","label":"Gemini A Flash","desc":"Nhanh"},{"id":"gemini-b-pro","label":"Gemini B Pro","desc":""}]` {
		t.Errorf("chưa chọn model: %s", js(m))
	}

	// chọn model có trong danh sách (chỉ đổi model, hướng dẫn mặc định)
	r, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", "", "model", " gemini-b-pro "))
	if err != nil {
		t.Fatal(err)
	}
	m = r.(*omap.Map)
	if m.Val("modelChoice") != "gemini-b-pro" || m.Val("model") != "gemini-b-pro" || m.Val("custom") != false || js(m.Val("history")) != "[]" ||
		m.Val("updatedBy") != "an" {
		t.Errorf("chọn model: %s", js(m))
	}
	if v := f.settings[aiConfigKey].Val("gia_tri").(*omap.Map); strings.Join(v.Keys(), ",") != "instructions,model,updatedAt,updatedBy,history" ||
		v.Val("model") != "gemini-b-pro" {
		t.Errorf("lưu model: %s", js(v))
	}

	// model không hợp lệ -> 400, giữ nguyên
	for _, bad := range []any{"gemini-khong-co", 12.0, true} {
		if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A", "model", bad)); status(err) != 400 || err.Error() != "Model AI không hợp lệ" {
			t.Errorf("model %v phải 400: %v", bad, err)
		}
	}
	if g, _ = s.GetAiConfig(ctx, a); g.(*omap.Map).Val("modelChoice") != "gemini-b-pro" || g.(*omap.Map).Val("custom") != false {
		t.Errorf("model sai không được lưu gì: %s", js(g))
	}

	// thiếu model = giữ; bản trước (chỉ có model) vào lịch sử
	r, _ = s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A"))
	m = r.(*omap.Map)
	h := m.Val("history").([]any)
	if m.Val("modelChoice") != "gemini-b-pro" || m.Val("instructions") != "Bản A" || len(h) != 1 ||
		js(h[0]) != `{"instructions":"","model":"gemini-b-pro","at":"2026-10-28T20:00:00.000Z","by":"an"}` {
		t.Errorf("thiếu model = giữ: %s", js(m))
	}
	// null = giữ, không đổi gì -> không thêm lịch sử
	r, _ = s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A", "model", nil))
	if len(r.(*omap.Map).Val("history").([]any)) != 1 || r.(*omap.Map).Val("modelChoice") != "gemini-b-pro" {
		t.Errorf("null = giữ: %s", js(r))
	}
	// "" = về mặc định máy chủ; đổi model cũng là 1 phiên bản
	r, _ = s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A", "model", ""))
	m = r.(*omap.Map)
	h = m.Val("history").([]any)
	if m.Val("modelChoice") != "" || m.Val("model") != "gemini-test" || len(h) != 2 || h[0].(*omap.Map).Val("model") != "gemini-b-pro" ||
		h[0].(*omap.Map).Val("instructions") != "Bản A" {
		t.Errorf("về mặc định: %s", js(m))
	}

	// model đã lưu không còn trong danh sách -> model đang dùng là mặc định
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A", "model", "gemini-a-flash"))
	ai.models = twoModels()[1:]
	if g, _ = s.GetAiConfig(ctx, a); g.(*omap.Map).Val("modelChoice") != "gemini-a-flash" || g.(*omap.Map).Val("model") != "gemini-test" {
		t.Errorf("model không còn: %s", js(g))
	}
	// gửi lại đúng model đang lưu (đã rời danh sách) kèm hướng dẫn mới -> vẫn lưu được, model giữ nguyên
	if r, err = s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản B", "model", " gemini-a-flash ")); err != nil ||
		r.(*omap.Map).Val("instructions") != "Bản B" || r.(*omap.Map).Val("modelChoice") != "gemini-a-flash" {
		t.Errorf("gửi lại model đang lưu: %s %v", js(r), err)
	}
	// đổi sang model khác ngoài danh sách vẫn 400
	if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản B", "model", "gemini-khong-co")); status(err) != 400 {
		t.Errorf("model ngoài danh sách phải 400: %v", err)
	}

	// không lấy được danh sách -> modelsError, kiểm theo mẫu tên
	ai.models, ai.listErr = nil, errors.New("gemini: HTTP 403: Permission denied")
	g, _ = s.GetAiConfig(ctx, a)
	m = g.(*omap.Map)
	if js(m.Val("models")) != "[]" || !strings.Contains(jsval.Str(m.Val("modelsError")), "Không lấy được danh sách model") ||
		!strings.Contains(jsval.Str(m.Val("modelsError")), "HTTP 403") || m.Val("model") != "gemini-a-flash" {
		t.Errorf("lỗi danh sách: %s", js(m))
	}
	for _, bad := range []string{"gpt-4o", "Gemini-X", "gemini-", "gemini-a/../b", "gemini-" + strings.Repeat("a", 62)} {
		if _, err := s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A", "model", bad)); status(err) != 400 {
			t.Errorf("mẫu tên %q phải 400: %v", bad, err)
		}
	}
	if r, err = s.SaveAiConfig(ctx, a, omap.Of("instructions", "Bản A", "model", "gemini-9.9-pro-preview")); err != nil ||
		r.(*omap.Map).Val("model") != "gemini-9.9-pro-preview" {
		t.Errorf("đúng mẫu tên: %s %v", js(r), err)
	}

	// không có AI: model đang dùng / mặc định rỗng, vẫn trả lựa chọn đã lưu
	s.ai = nil
	g, _ = s.GetAiConfig(ctx, a)
	m = g.(*omap.Map)
	if m.Val("model") != "" || m.Val("defaultModel") != "" || m.Val("modelChoice") != "gemini-9.9-pro-preview" || js(m.Val("models")) != "[]" ||
		m.Val("modelsError") != "" {
		t.Errorf("không có AI: %s", js(m))
	}
}

func TestAiConfigTestModel(t *testing.T) {
	f := newFake()
	s := newSvc(f, "kinhdoanh")
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	ai := &fakeAI{text: geminiOK, models: twoModels()}
	s.ai = ai
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "", "model", "gemini-b-pro"))

	run := func(body *omap.Map) (*omap.Map, error) {
		s.testAt = nil
		r, err := s.TestAiPrompt(ctx, a, body)
		if err != nil {
			return nil, err
		}
		return r.(*omap.Map), nil
	}
	// thiếu / null = model đã lưu
	for _, b := range []*omap.Map{omap.Of("leadId", id), omap.Of("leadId", id, "model", nil)} {
		if m, err := run(b); err != nil || ai.model != "gemini-b-pro" || m.Val("model") != "gemini-b-pro" || m.Val("engine") != "gemini" {
			t.Errorf("model đã lưu: %s %v (gọi %q)", js(m), err, ai.model)
		}
	}
	// model nháp, không đổi bản đã lưu
	if m, err := run(omap.Of("leadId", id, "model", "gemini-a-flash")); err != nil || ai.model != "gemini-a-flash" || m.Val("model") != "gemini-a-flash" {
		t.Errorf("model nháp: %s %v", js(m), err)
	}
	if g, _ := s.GetAiConfig(ctx, a); g.(*omap.Map).Val("modelChoice") != "gemini-b-pro" {
		t.Errorf("chạy thử không lưu model: %s", js(g))
	}
	// "" = mặc định máy chủ
	if m, err := run(omap.Of("leadId", id, "model", "")); err != nil || ai.model != "" || m.Val("model") != "gemini-test" {
		t.Errorf("mặc định: %s %v", js(m), err)
	}
	// model sai -> 400, không gọi AI, không tính lượt chạy thử
	s.testAt = nil
	calls := ai.calls
	if _, err := s.TestAiPrompt(ctx, a, omap.Of("leadId", id, "model", "gemini-khong-co")); status(err) != 400 || err.Error() != "Model AI không hợp lệ" ||
		ai.calls != calls {
		t.Errorf("model sai phải 400: %v", err)
	}
	if _, err := s.TestAiPrompt(ctx, a, omap.Of("leadId", id)); err != nil {
		t.Errorf("model sai không tính lượt: %v", err)
	}
	// model đã lưu không còn trong danh sách -> mặc định
	ai.models = twoModels()[:1]
	if m, err := run(omap.Of("leadId", id)); err != nil || ai.model != "" || m.Val("model") != "gemini-test" {
		t.Errorf("model đã lưu không còn: %s %v", js(m), err)
	}
	// Gemini lỗi -> quy tắc, model rỗng như cũ
	ai.err = errors.New("gemini: HTTP 404: model not found")
	if m, err := run(omap.Of("leadId", id, "model", "gemini-a-flash")); err != nil || m.Val("engine") != "rules" || m.Val("model") != "" ||
		!strings.Contains(jsval.Str(m.Val("warning")), "HTTP 404") {
		t.Errorf("Gemini lỗi: %s %v", js(m), err)
	}
}

func TestGenerateInsightsUsesSavedModel(t *testing.T) {
	f := newFake()
	s := newSvc(f, "kinhdoanh")
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	ai := &fakeAI{text: geminiOK, models: twoModels()}
	s.ai = ai
	cur := s.now()
	s.now = func() time.Time { return cur }
	gen := func() *omap.Map {
		t.Helper()
		cur = cur.Add(time.Minute)
		r, err := s.GenerateInsights(ctx, a, id, omap.New())
		if err != nil {
			t.Fatal(err)
		}
		return r.(*omap.Map).Val("insight").(*omap.Map)
	}
	if in := gen(); ai.model != "" || in.Val("model") != "gemini-test" {
		t.Errorf("chưa chọn -> mặc định: %q %s", ai.model, js(in))
	}
	s.SaveAiConfig(ctx, a, omap.Of("instructions", "", "model", "gemini-b-pro"))
	if in := gen(); ai.model != "gemini-b-pro" || in.Val("model") != "gemini-b-pro" || in.Val("engine") != "gemini" {
		t.Errorf("dùng model đã lưu: %q %s", ai.model, js(in))
	}
	// không còn trong danh sách -> mặc định máy chủ
	ai.models = twoModels()[:1]
	if in := gen(); ai.model != "" || in.Val("model") != "gemini-test" {
		t.Errorf("model không còn -> mặc định: %q %s", ai.model, js(in))
	}
	// không lấy được danh sách -> vẫn dùng model đã lưu (đúng mẫu tên)
	ai.models, ai.listErr = nil, errors.New("gemini: HTTP 500")
	if in := gen(); ai.model != "gemini-b-pro" || in.Val("model") != "gemini-b-pro" {
		t.Errorf("lỗi danh sách -> model đã lưu: %q %s", ai.model, js(in))
	}
	if len(f.insights) != 4 {
		t.Errorf("mỗi lần lưu 1 bản: %d", len(f.insights))
	}
}

type errSettingRepo struct{ *fakeRepo }

func (errSettingRepo) GetSetting(ctx context.Context, key string) (*omap.Map, error) {
	return nil, context.DeadlineExceeded
}
