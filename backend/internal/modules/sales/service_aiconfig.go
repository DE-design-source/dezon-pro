package sales

import (
	"context"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"qspro-backend/internal/platform/gemini"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Cấu hình AI của Kinh doanh: quản trị công ty sửa hướng dẫn (prompt) cho khối "Đề xuất hành động" (GenerateInsights),
// xem trước prompt và chạy thử với 1 khách mà không lưu phân tích. Lưu ở cai_dat_cong_ty khoá kdAiConfig:
// {instructions, model, updatedAt, updatedBy, history: [{instructions, model, at, by}] mới nhất trước}.
// instructions rỗng = hướng dẫn mặc định; model rỗng / thiếu = model mặc định máy chủ (GEMINI_MODEL).

const (
	aiConfigKey    = "kdAiConfig"
	aiGuideMax     = 8000 // ký tự (rune)
	aiHistoryKeep  = 20
	aiTestCooldown = 5 * time.Second
	aiRawMax       = 20000
)

type aiConf struct {
	instructions, model, updatedAt, updatedBy string
	history                                   []any
}

// aiModelRe: mẫu tên model khi không lấy được danh sách từ Gemini.
var aiModelRe = regexp.MustCompile(`^gemini-[a-z0-9][a-z0-9.\-]{0,60}$`)

func (s *Service) loadAiConf(ctx context.Context) (aiConf, error) {
	c := aiConf{history: []any{}}
	row, err := s.repo.GetSetting(ctx, aiConfigKey)
	if err != nil || row == nil {
		return c, err
	}
	v, ok := row.Val("gia_tri").(*omap.Map)
	if !ok {
		return c, nil
	}
	c.instructions = jsval.Trim(jsval.Str(jsval.Or(v.Val("instructions"), "")))
	c.model = jsval.Trim(jsval.Str(jsval.Or(v.Val("model"), "")))
	c.updatedAt = jsval.Str(jsval.Or(v.Val("updatedAt"), ""))
	c.updatedBy = jsval.Str(jsval.Or(v.Val("updatedBy"), ""))
	for _, x := range av(v, "history") {
		if h, ok := x.(*omap.Map); ok && len(c.history) < aiHistoryKeep {
			c.history = append(c.history, omap.Of("instructions", jsval.Str(jsval.Or(h.Val("instructions"), "")),
				"model", jsval.Str(jsval.Or(h.Val("model"), "")),
				"at", jsval.Str(jsval.Or(h.Val("at"), "")), "by", jsval.Str(jsval.Or(h.Val("by"), ""))))
		}
	}
	return c, nil
}

// savedGuide: hướng dẫn công ty đang dùng (tuỳ chỉnh, không có thì mặc định).
func (s *Service) savedGuide(ctx context.Context) (string, error) {
	c, err := s.loadAiConf(ctx)
	if err != nil || c.instructions == "" {
		return aiGuideDefault, err
	}
	return c.instructions, nil
}

// cleanGuide: chuẩn hoá hướng dẫn gửi lên; rỗng / trùng mặc định -> "" (dùng mặc định).
func cleanGuide(v any) (string, error) {
	if jsval.IsNullish(v) {
		return "", nil
	}
	t, ok := v.(string)
	if !ok {
		return "", apperr.BadRequest("Hướng dẫn cho AI phải là chuỗi")
	}
	t = strings.TrimSpace(strings.ReplaceAll(t, "\r\n", "\n"))
	if utf8.RuneCountInString(t) > aiGuideMax {
		return "", apperr.BadRequest("Hướng dẫn cho AI tối đa 8000 ký tự")
	}
	if t == aiGuideDefault {
		return "", nil
	}
	return t, nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// aiModels: danh sách model dùng được (không có AI -> rỗng, không lỗi).
func (s *Service) aiModels(ctx context.Context) ([]gemini.ModelInfo, error) {
	if s.ai == nil {
		return nil, nil
	}
	return s.ai.ListModels(ctx)
}

// modelOK: model m (khác rỗng) dùng được không: lấy được danh sách -> phải có trong danh sách; không -> đúng mẫu tên.
func modelOK(m string, list []gemini.ModelInfo, listErr error) bool {
	if listErr == nil && len(list) > 0 {
		for _, x := range list {
			if x.ID == m {
				return true
			}
		}
		return false
	}
	return aiModelRe.MatchString(m)
}

// cleanModel: model gửi lên (đã biết không null) -> "" (mặc định máy chủ) hoặc id hợp lệ; sai -> 400.
func cleanModel(v any, list []gemini.ModelInfo, listErr error) (string, error) {
	t, ok := v.(string)
	if !ok {
		return "", apperr.BadRequest("Model AI không hợp lệ")
	}
	if t = strings.TrimSpace(t); t != "" && !modelOK(t, list, listErr) {
		return "", apperr.BadRequest("Model AI không hợp lệ")
	}
	return t, nil
}

// sameModel: giá trị model gửi lên là chuỗi trùng model đang lưu (sau trim).
func sameModel(v any, saved string) bool {
	t, ok := v.(string)
	return ok && strings.TrimSpace(t) == saved
}

// aiListWait: thời gian tối đa chờ danh sách model trước khi lập phân tích; hết giờ -> kiểm theo mẫu tên.
const aiListWait = 3 * time.Second

// useModel: model công ty đã chọn còn dùng được -> chính nó; rỗng / không còn trong danh sách -> "" (mặc định máy chủ, ghi log).
func (s *Service) useModel(ctx context.Context, choice string) string {
	if s.ai == nil || choice == "" {
		return ""
	}
	lctx, cancel := context.WithTimeout(ctx, aiListWait)
	list, err := s.ai.ListModels(lctx)
	cancel()
	if modelOK(choice, list, err) {
		return choice
	}
	logger.Error("sales", "phân tích khách hàng: model AI đã chọn không dùng được, dùng model mặc định:", choice)
	return ""
}

func (s *Service) aiConfOut(ctx context.Context, c aiConf, a *actor.Actor) *omap.Map {
	cur, def, model := aiGuideDefault, "", ""
	if c.instructions != "" {
		cur = c.instructions
	}
	models, modelsErr := []any{}, ""
	if s.ai != nil {
		def = s.ai.Model()
		model = def
		list, err := s.ai.ListModels(ctx)
		if err != nil {
			modelsErr = "Không lấy được danh sách model từ Gemini (" + clip(err.Error(), 200) + ")"
		}
		for _, x := range list {
			models = append(models, omap.Of("id", x.ID, "label", x.Label, "desc", x.Desc))
		}
		if c.model != "" && modelOK(c.model, list, err) {
			model = c.model
		}
	}
	return omap.Of("instructions", cur, "defaultInstructions", aiGuideDefault, "custom", c.instructions != "",
		"fixedRules", aiFixedRules, "outputShape", aiShape, "aiEnabled", s.ai != nil, "model", model,
		"modelChoice", c.model, "defaultModel", def, "models", models, "modelsError", modelsErr,
		"updatedAt", nullStr(c.updatedAt), "updatedBy", nullStr(c.updatedBy), "canEdit", a.IsAdmin(),
		"maxLength", float64(aiGuideMax), "history", c.history)
}

// GetAiConfig: hướng dẫn AI đang dùng + mặc định + quy tắc cố định + lịch sử.
func (s *Service) GetAiConfig(ctx context.Context, a *actor.Actor) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	c, err := s.loadAiConf(ctx)
	if err != nil {
		return nil, err
	}
	return s.aiConfOut(ctx, c, a), nil
}

// SaveAiConfig: body {instructions, model?}. instructions rỗng / trùng mặc định -> quay về mặc định;
// model thiếu / null = giữ, "" = mặc định máy chủ. Bản tuỳ chỉnh cũ (hướng dẫn hoặc model) đẩy vào history.
func (s *Service) SaveAiConfig(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if !a.IsAdmin() {
		return nil, apperr.Forbidden("Chỉ quản trị công ty được sửa cấu hình AI")
	}
	// Thiếu khoá / null -> báo lỗi, không lặng lẽ quay về mặc định (muốn quay về mặc định thì gửi chuỗi rỗng).
	v, ok := body.Get("instructions")
	if !ok || jsval.IsNullish(v) {
		return nil, apperr.BadRequest("Thiếu hướng dẫn cho AI (instructions)")
	}
	next, err := cleanGuide(v)
	if err != nil {
		return nil, err
	}
	c, err := s.loadAiConf(ctx)
	if err != nil {
		return nil, err
	}
	nextModel := c.model
	// Gửi lại đúng model đang lưu = không đổi, không kiểm lại (model đó có thể đã rời danh sách Gemini;
	// phân tích tự rơi về mặc định máy chủ), để vẫn lưu được hướng dẫn.
	if mv, ok := body.Get("model"); ok && !jsval.IsNullish(mv) && !sameModel(mv, c.model) {
		list, lerr := s.aiModels(ctx)
		if nextModel, err = cleanModel(mv, list, lerr); err != nil {
			return nil, err
		}
	}
	if next == c.instructions && nextModel == c.model {
		return s.aiConfOut(ctx, c, a), nil
	}
	if c.instructions != "" || c.model != "" {
		c.history = append([]any{omap.Of("instructions", c.instructions, "model", c.model, "at", c.updatedAt, "by", c.updatedBy)}, c.history...)
		if len(c.history) > aiHistoryKeep {
			c.history = c.history[:aiHistoryKeep]
		}
	}
	now := s.now()
	c.instructions, c.model, c.updatedAt, c.updatedBy = next, nextModel, omap.ISOTime(now), s.displayName(ctx, a)
	val := omap.Of("instructions", c.instructions, "model", c.model, "updatedAt", c.updatedAt, "updatedBy", c.updatedBy, "history", c.history)
	if err := s.repo.SaveSetting(ctx, aiConfigKey, omap.Of("gia_tri", val, "cap_nhat", now, "nguoi_sua", a.U)); err != nil {
		return nil, err
	}
	return s.aiConfOut(ctx, c, a), nil
}

// aiDraft: dữ liệu khách leadId + hướng dẫn nháp (body.instructions; thiếu / null = bản đang lưu) -> system, prompt.
func (s *Service) aiDraft(ctx context.Context, a *actor.Actor, body *omap.Map) (in *insightIn, rules *omap.Map, system, prompt string, err error) {
	if err = s.allow(ctx, a); err != nil {
		return
	}
	if !a.IsAdmin() {
		err = apperr.Forbidden("Chỉ quản trị công ty được thử cấu hình AI")
		return
	}
	id := jsval.ToNumber(body.Val("leadId"))
	if !(id > 0) {
		err = apperr.BadRequest("Chọn khách hàng để thử (leadId)")
		return
	}
	guide := ""
	if v := body.Val("instructions"); !jsval.IsNullish(v) {
		if guide, err = cleanGuide(v); err != nil {
			return
		}
		if guide == "" {
			guide = aiGuideDefault
		}
	} else if guide, err = s.savedGuide(ctx); err != nil {
		return
	}
	if in, err = s.gather(ctx, a, id, body); err != nil {
		return
	}
	if len(in.extra) == 0 {
		var prev *omap.Map
		if prev, err = s.repo.LatestInsight(ctx, id); err != nil {
			return
		}
		in.carried = carryFiles(prev)
	}
	rules = in.rulesInsight()
	return in, rules, aiSystemFor(guide), in.prompt(rules), nil
}

// PreviewAiPrompt: body {leadId, instructions?} -> {system, prompt} đúng như sẽ gửi Gemini; không gọi AI.
func (s *Service) PreviewAiPrompt(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	_, _, system, prompt, err := s.aiDraft(ctx, a, body)
	if err != nil {
		return nil, err
	}
	return omap.Of("system", system, "prompt", prompt), nil
}

// testAllowed: cùng 1 người chạy thử cách nhau ít nhất aiTestCooldown.
func (s *Service) testAllowed(a *actor.Actor) bool { return s.throttle(&s.testAt, a, aiTestCooldown) }

// throttle: cùng 1 người gọi cách nhau ít nhất d (lần gọi gần nhất ghi ở *at); được gọi -> ghi lại lúc này.
func (s *Service) throttle(at *map[string]time.Time, a *actor.Actor, d time.Duration) bool {
	key := jsval.Str(a.UID) + "|" + a.U
	now := time.Now()
	s.testMu.Lock()
	defer s.testMu.Unlock()
	if *at == nil {
		*at = map[string]time.Time{}
	}
	m := *at
	if t, ok := m[key]; ok && now.Sub(t) < d {
		return false
	}
	if len(m) > 1000 {
		for k, t := range m {
			if now.Sub(t) >= d {
				delete(m, k)
			}
		}
	}
	m[key] = now
	return true
}

// TestAiPrompt: body {leadId, instructions?, model?} -> gọi Gemini với hướng dẫn / model nháp, không lưu phân tích.
// model thiếu / null = model đã lưu, "" = mặc định máy chủ. -> {content, engine, model (đã dùng thật), warning, ms, raw}.
func (s *Service) TestAiPrompt(ctx context.Context, a *actor.Actor, body *omap.Map) (any, error) {
	in, rules, system, prompt, err := s.aiDraft(ctx, a, body)
	if err != nil {
		return nil, err
	}
	use := ""
	if mv, ok := body.Get("model"); ok && !jsval.IsNullish(mv) {
		list, lerr := s.aiModels(ctx)
		if use, err = cleanModel(mv, list, lerr); err != nil {
			return nil, err
		}
	} else {
		c, err := s.loadAiConf(ctx)
		if err != nil {
			return nil, err
		}
		use = s.useModel(ctx, c.model)
	}
	if !s.testAllowed(a) {
		return nil, apperr.E(429, "Chạy thử quá nhanh, đợi vài giây rồi thử lại")
	}
	t0 := time.Now()
	content, engine, model, warning, raw := s.runAI(ctx, use, system, prompt, rules, in.today)
	return omap.Of("content", content, "engine", engine, "model", model, "warning", warning,
		"ms", float64(time.Since(t0).Milliseconds()), "raw", clip(raw, aiRawMax)), nil
}
