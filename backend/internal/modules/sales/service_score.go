package sales

import (
	"context"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Chỉ số chính của trang khách hàng: 6 tiêu chí × 4 câu (bảng CRIT của bản thiết kế Customer Dashboard).
// Câu bắt buộc (required) chưa có -> tiêu chí thành điểm liệt, không được tính điểm (0 điểm).

type critItem struct {
	text     string
	required bool
}

type criterion struct {
	key, label string
	weight     float64
	items      []critItem
}

var criteria = []criterion{
	{"tien", "Tiền", 25, []critItem{{"Khách đã nói rõ ngân sách", false}, {"Ngân sách khớp quy mô công trình", false},
		{"Khách đồng ý tiến độ thanh toán theo đợt", true}, {"Khách đồng ý khung phí thiết kế", false}}},
	{"quyetdinh", "Người quyết định", 20, []critItem{{"Đã xác định ai là người quyết định", false},
		{"Đã gặp hoặc nói chuyện trực tiếp", true}, {"Người quyết định đã xem phương án 3D", false},
		{"Người quyết định đồng ý hướng thiết kế", false}}},
	{"dat", "Đất & pháp lý", 20, []critItem{{"Đã biết diện tích, quy mô xây dựng", false}, {"Đã xác nhận khách có đất", false},
		{"Sổ, giấy tờ đất hợp lệ", true}, {"Đủ điều kiện xin phép xây dựng", false}}},
	{"thoidiem", "Thời điểm", 15, []critItem{{"Khách có mốc khởi công mong muốn", false}, {"Mốc đủ gần để tạo áp lực ký", false},
		{"Khách muốn ký sớm cho kịp mốc", false}, {"Lịch hồ sơ, giấy phép không vướng Tết", false}}},
	{"nhucau", "Nhu cầu & quan tâm", 10, []critItem{{"Phạm vi rõ: trọn gói 4 hạng mục", false}, {"Khách đã xem phương án 3D", false},
		{"Khách sẵn sàng chọn concept", false}, {"Tương tác gần đây tích cực", false}}},
	{"canhtranh", "Cạnh tranh", 10, []critItem{{"Đã hỏi khách có so sánh đơn vị khác", false}, {"Biết đối thủ là ai, báo giá ra sao", false},
		{"Khách nêu được lý do thích Vua Thầu", false}, {"Có lợi thế rõ: trọn gói TK + thi công", false}}},
}

const (
	okScore     = 75  // tiêu chí >= 75 điểm -> Đạt
	historyKeep = 500 // số điểm lịch sử giữ lại
)

// critResult: kết quả chấm 1 tiêu chí.
type critResult struct {
	c     criterion
	on    []bool
	score float64
	lock  bool
}

// scoreResult: kết quả chấm cả 6 tiêu chí.
type scoreResult struct {
	crits                []critResult
	critScore, dealScore float64
	locks                int
}

// computeScore: score_c = round(số câu có / 4 × 100); tiêu chí liệt nếu còn câu bắt buộc chưa có -> score_c = 0;
// critScore = round(Σ score_c × w / 100); dealScore = critScore.
func computeScore(checks map[string][]bool) scoreResult {
	r := scoreResult{}
	weighted := 0.0
	for _, c := range criteria {
		on := make([]bool, len(c.items))
		copy(on, checks[c.key])
		n := 0
		lock := false
		for i, it := range c.items {
			if on[i] {
				n++
			} else if it.required {
				lock = true
			}
		}
		sc := jsval.Round(float64(n) / float64(len(c.items)) * 100)
		if lock {
			r.locks++
			sc = 0
		}
		weighted += sc * c.weight / 100
		r.crits = append(r.crits, critResult{c: c, on: on, score: sc, lock: lock})
	}
	r.critScore = jsval.Round(weighted)
	r.dealScore = r.critScore
	return r
}

func (c critResult) status() string {
	switch {
	case c.lock:
		return "lock"
	case c.score >= okScore:
		return "ok"
	}
	return "watch"
}

// parseChecks: body.checks {key: [bool×4]} -> map; khoá lạ / không phải mảng / quá 4 câu / câu trả lời không phải true / false -> 400.
// Thiếu khoá = chưa có câu nào.
func parseChecks(v any) (map[string][]bool, error) {
	m, ok := v.(*omap.Map)
	if !ok {
		return nil, apperr.BadRequest("Thiếu danh sách tiêu chí (checks)")
	}
	known := map[string]int{}
	for _, c := range criteria {
		known[c.key] = len(c.items)
	}
	out := map[string][]bool{}
	var err error
	m.Each(func(k string, x any) {
		if err != nil {
			return
		}
		n, ok := known[k]
		if !ok {
			err = apperr.BadRequest("Tiêu chí không hợp lệ: " + k)
			return
		}
		arr, ok := x.([]any)
		if !ok || len(arr) > n {
			err = apperr.BadRequest("Câu trả lời của tiêu chí " + k + " phải là mảng tối đa " + jsval.NumberToString(float64(n)) + " giá trị")
			return
		}
		on := make([]bool, n)
		for i, b := range arr {
			v, ok := b.(bool)
			if !ok {
				err = apperr.BadRequest("Câu trả lời của tiêu chí " + k + " chỉ nhận true / false")
				return
			}
			on[i] = v
		}
		out[k] = on
	})
	return out, err
}

// checksOf: cột tieu_chi (jsonb) -> map; dữ liệu hỏng thì bỏ qua phần hỏng.
func checksOf(v any) map[string][]bool {
	out := map[string][]bool{}
	m, ok := v.(*omap.Map)
	if !ok {
		return out
	}
	for _, c := range criteria {
		on := make([]bool, len(c.items))
		if arr, ok := m.Val(c.key).([]any); ok {
			for i := 0; i < len(arr) && i < len(on); i++ {
				on[i] = jsval.Truthy(arr[i])
			}
		}
		out[c.key] = on
	}
	return out
}

// prevWeekScore: điểm lịch sử mới nhất tại hoặc trước now - 7 ngày; không có -> nil.
func prevWeekScore(history any, now time.Time) any {
	cut := now.Add(-7 * 24 * time.Hour)
	var best time.Time
	var val any
	arr, _ := history.([]any)
	for _, x := range arr {
		h, ok := x.(*omap.Map)
		if !ok {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, jsval.Str(h.Val("at")))
		if err != nil || t.After(cut) {
			continue
		}
		if val == nil || !t.Before(best) {
			best, val = t, jsval.ToNumber(h.Val("score"))
		}
	}
	return val
}

// scoreOut: object trả về giao diện (xem customerApi.js getScore).
func scoreOut(row *omap.Map, now time.Time) *omap.Map {
	var checks, history, updatedAt any
	by := ""
	if row != nil {
		checks, history, updatedAt, by = row.Val("tieu_chi"), row.Val("lich_su"), row.Val("cap_nhat"), jsval.Str(row.Val("nguoi_sua"))
	}
	r := computeScore(checksOf(checks))
	chk := omap.New()
	list := make([]any, 0, len(r.crits))
	for _, c := range r.crits {
		on := make([]any, len(c.on))
		items := make([]any, len(c.on))
		for i, b := range c.on {
			on[i] = b
			items[i] = omap.Of("text", c.c.items[i].text, "required", c.c.items[i].required, "on", b)
		}
		chk.Set(c.c.key, on)
		list = append(list, omap.Of("key", c.c.key, "label", c.c.label, "weight", c.c.weight, "score", c.score, "lock", c.lock,
			"status", c.status(), "items", items))
	}
	return omap.Of("checks", chk, "criteria", list, "critScore", r.critScore, "dealScore", r.dealScore, "locks", float64(r.locks),
		"prevWeek", prevWeekScore(history, now), "updatedAt", jsval.Or(updatedAt, nil), "updatedBy", by)
}

// GetScore: điểm 6 tiêu chí của khách (chưa chấm -> mọi câu chưa có).
func (s *Service) GetScore(ctx context.Context, a *actor.Actor, id float64) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	if _, err := s.leadOr404(ctx, id); err != nil {
		return nil, err
	}
	row, err := s.repo.GetScore(ctx, id)
	if err != nil {
		return nil, err
	}
	return scoreOut(row, s.now()), nil
}

// withHistory: lịch sử điểm cũ + điểm {at, score} mới - chỉ thêm khi điểm deal khác điểm gần nhất (lưu lại cùng điểm không làm
// dài lịch sử); giữ historyKeep điểm cuối.
func withHistory(old *omap.Map, at string, score float64) []any {
	hist := []any{}
	if old != nil {
		if h, ok := old.Val("lich_su").([]any); ok {
			hist = append(hist, h...)
		}
	}
	if n := len(hist); n > 0 {
		if last, ok := hist[n-1].(*omap.Map); ok && jsval.IsNumber(last.Val("score")) && jsval.ToNumber(last.Val("score")) == score {
			return hist
		}
	}
	hist = append(hist, omap.Of("at", at, "score", score))
	if len(hist) > historyKeep {
		hist = hist[len(hist)-historyKeep:]
	}
	return hist
}

// SaveScore: lưu câu trả lời (body.checks) và thêm 1 điểm lịch sử {at, score} khi điểm deal đổi (dùng cho "So với tuần trước").
// 2 lần lưu đầu tiên cùng lúc: lần sau gặp trùng khoá chính (23505) thì đọc lại dòng vừa có rồi sửa.
func (s *Service) SaveScore(ctx context.Context, a *actor.Actor, id float64, body *omap.Map) (any, error) {
	if err := s.allow(ctx, a); err != nil {
		return nil, err
	}
	checks, err := parseChecks(body.Val("checks"))
	if err != nil {
		return nil, err
	}
	r := computeScore(checks)
	doc := omap.New()
	for _, c := range r.crits {
		on := make([]any, len(c.on))
		for i, b := range c.on {
			on[i] = b
		}
		doc.Set(c.c.key, on)
	}
	now := s.now()
	at := now.UTC().Format(time.RFC3339Nano)
	by := s.displayName(ctx, a)
	var out *omap.Map
	err = s.tx(ctx, func(ctx context.Context) error {
		if _, err := s.leadOr404(ctx, id); err != nil {
			return err
		}
		old, err := s.repo.GetScore(ctx, id)
		if err != nil {
			return err
		}
		patch := func(old *omap.Map) *omap.Map {
			return omap.Of("tieu_chi", doc, "lich_su", withHistory(old, at, r.dealScore), "nguoi_sua", by, "cap_nhat", at)
		}
		if old == nil {
			out, err = s.repo.InsertScore(ctx, patch(nil).Set("khach_hang_id", id))
			if database.CodeOf(err) != "23505" {
				return err
			}
			// mỗi lệnh trong transaction có savepoint riêng: lệnh chèn hỏng không làm hỏng transaction
			if old, err = s.repo.GetScore(ctx, id); err != nil {
				return err
			}
		}
		out, err = s.repo.UpdateScore(ctx, id, patch(old))
		return err
	})
	if err != nil {
		return nil, err
	}
	return scoreOut(out, now), nil
}
