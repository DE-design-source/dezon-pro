// Package gemini: client tối giản gọi Google Gemini API (generateContent), chỉ dùng thư viện chuẩn (net/http).
// Dùng cho phân tích khách hàng Kinh doanh (GEMINI_API_KEY / GEMINI_MODEL). Khoá API gửi qua header x-goog-api-key,
// không nằm trong URL và không bao giờ xuất hiện trong thông báo lỗi / log.
package gemini

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	// DefaultModel: model mặc định khi không đặt GEMINI_MODEL.
	DefaultModel   = "gemini-3.8-flash"
	defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta"
	defaultTimeout = 60 * time.Second
	partsTimeout   = 5 * time.Minute // GenerateJSONParts (âm thanh): chờ lâu hơn
	maxBody        = 4 << 20         // trần đọc phản hồi (4 MB)
	listTimeout    = 15 * time.Second
	listTTL        = time.Hour   // danh sách model lấy được: giữ 1 giờ
	listErrTTL     = time.Minute // lấy lỗi: thử lại sau 1 phút
	listMaxPages   = 5
	descMax        = 160 // ký tự mô tả model giữ lại
)

// Config: APIKey bắt buộc; Model trống = DefaultModel; BaseURL trống = API thật (test trỏ httptest); Timeout 0 = 60 giây.
type Config struct {
	APIKey  string
	Model   string
	BaseURL string
	Timeout time.Duration
}

// Client gọi generateContent. An toàn khi dùng song song.
type Client struct {
	key, model, base string
	http             *http.Client
	httpParts        *http.Client     // timeout dài cho GenerateJSONParts
	now              func() time.Time // test đổi được để thử hết hạn cache

	listSem   chan struct{} // khoá 1 chỗ cho cache danh sách model; người chờ bỏ cuộc theo ctx của họ
	listVal   []ModelInfo
	listErr   error
	listUntil time.Time

	fastMu sync.Mutex
	noFast map[string]bool // model không nhận thinkingLevel (GenerateJSONFast gọi thẳng kiểu thường)
}

// ModelInfo: 1 model Gemini dùng được cho generateContent (ID không có tiền tố "models/").
type ModelInfo struct {
	ID, Label, Desc string
}

// New tạo client; thiếu khoá -> lỗi.
func New(c Config) (*Client, error) {
	key := strings.TrimSpace(c.APIKey)
	if key == "" {
		return nil, errors.New("gemini: thiếu GEMINI_API_KEY")
	}
	model := strings.TrimSpace(c.Model)
	if model == "" {
		model = DefaultModel
	}
	base := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if base == "" {
		base = defaultBaseURL
	}
	to := c.Timeout
	if to <= 0 {
		to = defaultTimeout
	}
	long := partsTimeout
	if to > long {
		long = to
	}
	return &Client{key: key, model: model, base: base, http: &http.Client{Timeout: to},
		httpParts: &http.Client{Timeout: long}, now: time.Now, listSem: make(chan struct{}, 1)}, nil
}

// Model: tên model đang dùng.
func (c *Client) Model() string { return c.model }

// Part: 1 phần của nội dung gửi Gemini: chữ (Text) hoặc dữ liệu nhị phân (MIME + Data, gửi inlineData base64).
type Part struct {
	Text string
	MIME string
	Data []byte
}

type inlineData struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"` // base64 chuẩn
}

type part struct {
	Text       string      `json:"text"`
	InlineData *inlineData `json:"inlineData,omitempty"`
	Thought    bool        `json:"thought,omitempty"` // phần "suy nghĩ" của model đời mới: không thuộc câu trả lời
}

// MarshalJSON: phần dữ liệu nhị phân chỉ gửi {"inlineData":...} (không kèm "text":""); phần chữ giữ nguyên như cũ.
func (p part) MarshalJSON() ([]byte, error) {
	if p.InlineData != nil {
		return json.Marshal(struct {
			InlineData *inlineData `json:"inlineData"`
		}{p.InlineData})
	}
	return json.Marshal(struct {
		Text    string `json:"text"`
		Thought bool   `json:"thought,omitempty"`
	}{p.Text, p.Thought})
}

type content struct {
	Role  string `json:"role,omitempty"`
	Parts []part `json:"parts"`
}

type request struct {
	SystemInstruction *content       `json:"systemInstruction,omitempty"`
	Contents          []content      `json:"contents"`
	GenerationConfig  map[string]any `json:"generationConfig"`
}

type response struct {
	Candidates []struct {
		Content      content `json:"content"`
		FinishReason string  `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

// GenerateJSON gửi system + prompt, yêu cầu trả JSON (responseMimeType application/json) và trả nguyên văn phần chữ
// của ứng viên đầu tiên. Lỗi HTTP / bị chặn / rỗng -> error (thông báo không chứa khoá).
func (c *Client) GenerateJSON(ctx context.Context, system, prompt string) (string, error) {
	return c.GenerateJSONWith(ctx, "", system, prompt)
}

// GenerateJSONWith như GenerateJSON nhưng gọi model chỉ định cho lần này ("" = model mặc định của client).
func (c *Client) GenerateJSONWith(ctx context.Context, model, system, prompt string) (string, error) {
	return c.generate(ctx, c.http, model, system, []part{{Text: prompt}}, nil)
}

// GenerateJSONFast như GenerateJSONWith nhưng bảo model "suy nghĩ" ít (thinkingLevel low) để trả nhanh (gợi ý trực tiếp
// khi Live: ~3-4 giây thay vì ~8 giây). Model không nhận tham số này (HTTP 400 nói tới thinking) -> gọi lại kiểu thường
// và nhớ model đó để lần sau gọi thẳng kiểu thường.
func (c *Client) GenerateJSONFast(ctx context.Context, model, system, prompt string) (string, error) {
	key := strings.TrimPrefix(strings.TrimSpace(model), "models/")
	if key == "" {
		key = c.model
	}
	c.fastMu.Lock()
	no := c.noFast[key]
	c.fastMu.Unlock()
	if !no {
		out, err := c.generate(ctx, c.http, model, system, []part{{Text: prompt}}, map[string]any{"thinkingConfig": map[string]any{"thinkingLevel": "low"}})
		if err == nil || !strings.Contains(err.Error(), "HTTP 400") || !strings.Contains(strings.ToLower(err.Error()), "think") {
			return out, err
		}
		c.fastMu.Lock()
		if c.noFast == nil {
			c.noFast = map[string]bool{}
		}
		c.noFast[key] = true
		c.fastMu.Unlock()
	}
	return c.generate(ctx, c.http, model, system, []part{{Text: prompt}}, nil)
}

// GenerateJSONParts như GenerateJSONWith nhưng nội dung gồm nhiều phần (vd âm thanh + chữ); timeout riêng dài hơn (5 phút).
func (c *Client) GenerateJSONParts(ctx context.Context, model, system string, parts []Part) (string, error) {
	ps := make([]part, 0, len(parts))
	for _, p := range parts {
		if len(p.Data) > 0 {
			mime := strings.ToLower(strings.TrimSpace(strings.SplitN(p.MIME, ";", 2)[0]))
			if mime == "" {
				return "", errors.New("gemini: thiếu kiểu dữ liệu (MIME) của phần nhị phân")
			}
			ps = append(ps, part{InlineData: &inlineData{MimeType: mime, Data: base64.StdEncoding.EncodeToString(p.Data)}})
			continue
		}
		if p.Text != "" {
			ps = append(ps, part{Text: p.Text})
		}
	}
	if len(ps) == 0 {
		return "", errors.New("gemini: nội dung gửi đi rỗng")
	}
	return c.generate(ctx, c.httpParts, model, system, ps, nil)
}

func (c *Client) generate(ctx context.Context, hc *http.Client, model, system string, parts []part, extra map[string]any) (string, error) {
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	if model == "" {
		model = c.model
	}
	body := request{
		Contents:         []content{{Role: "user", Parts: parts}},
		GenerationConfig: map[string]any{"responseMimeType": "application/json", "temperature": 0.4},
	}
	for k, v := range extra {
		body.GenerationConfig[k] = v
	}
	if system != "" {
		body.SystemInstruction = &content{Parts: []part{{Text: system}}}
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	u := c.base + "/models/" + url.PathEscape(model) + ":generateContent"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", c.key)
	res, err := hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("gemini: không gọi được API: %w", scrub(err, c.key))
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	if err != nil {
		return "", fmt.Errorf("gemini: đọc phản hồi lỗi: %w", scrub(err, c.key))
	}
	var out response
	jerr := json.Unmarshal(raw, &out)
	if res.StatusCode/100 != 2 {
		msg := http.StatusText(res.StatusCode)
		if jerr == nil && out.Error != nil && out.Error.Message != "" {
			msg = out.Error.Message
		}
		return "", fmt.Errorf("gemini: HTTP %d: %s", res.StatusCode, strings.ReplaceAll(msg, c.key, "***"))
	}
	if jerr != nil {
		return "", errors.New("gemini: phản hồi không phải JSON")
	}
	if out.PromptFeedback != nil && out.PromptFeedback.BlockReason != "" {
		return "", errors.New("gemini: yêu cầu bị chặn (" + out.PromptFeedback.BlockReason + ")")
	}
	if len(out.Candidates) == 0 {
		return "", errors.New("gemini: không có kết quả")
	}
	var sb strings.Builder
	for _, p := range out.Candidates[0].Content.Parts {
		if p.Thought {
			continue
		}
		sb.WriteString(p.Text)
	}
	text := strings.TrimSpace(sb.String())
	if text == "" {
		return "", errors.New("gemini: kết quả rỗng (" + out.Candidates[0].FinishReason + ")")
	}
	return text, nil
}

type listResponse struct {
	Models []struct {
		Name                       string   `json:"name"`
		DisplayName                string   `json:"displayName"`
		Description                string   `json:"description"`
		SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
	} `json:"models"`
	NextPageToken string `json:"nextPageToken"`
	Error         *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// ListModels: các model "gemini..." hỗ trợ generateContent, sắp theo ID. Kết quả giữ trong bộ nhớ 1 giờ
// (lỗi giữ 1 phút; lỗi do ctx của người gọi bị huỷ / hết giờ không giữ). Đang có lần lấy khác thì chờ tới khi ctx hết.
// Trả bản sao, người gọi sửa thoải mái.
func (c *Client) ListModels(ctx context.Context) ([]ModelInfo, error) {
	select {
	case c.listSem <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-c.listSem }()
	now := c.now()
	if now.Before(c.listUntil) {
		return append([]ModelInfo(nil), c.listVal...), c.listErr
	}
	lctx, cancel := context.WithTimeout(ctx, listTimeout)
	list, err := c.fetchModels(lctx)
	cancel()
	if err != nil {
		if ctx.Err() == nil {
			c.listVal, c.listErr, c.listUntil = nil, err, now.Add(listErrTTL)
		}
		return nil, err
	}
	c.listVal, c.listErr, c.listUntil = list, nil, now.Add(listTTL)
	return append([]ModelInfo(nil), list...), nil
}

func (c *Client) fetchModels(ctx context.Context) ([]ModelInfo, error) {
	seen := map[string]bool{}
	out := []ModelInfo{}
	token := ""
	for page := 0; page < listMaxPages; page++ {
		q := url.Values{"pageSize": {"200"}}
		if token != "" {
			q.Set("pageToken", token)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/models?"+q.Encode(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-goog-api-key", c.key)
		res, err := c.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("gemini: không lấy được danh sách model: %w", scrub(err, c.key))
		}
		raw, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
		res.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("gemini: đọc danh sách model lỗi: %w", scrub(err, c.key))
		}
		var lr listResponse
		jerr := json.Unmarshal(raw, &lr)
		if res.StatusCode/100 != 2 {
			msg := http.StatusText(res.StatusCode)
			if jerr == nil && lr.Error != nil && lr.Error.Message != "" {
				msg = lr.Error.Message
			}
			return nil, fmt.Errorf("gemini: HTTP %d: %s", res.StatusCode, strings.ReplaceAll(msg, c.key, "***"))
		}
		if jerr != nil {
			return nil, errors.New("gemini: danh sách model không phải JSON")
		}
		for _, m := range lr.Models {
			id := strings.TrimPrefix(m.Name, "models/")
			if !strings.HasPrefix(id, "gemini") || seen[id] || !hasMethod(m.SupportedGenerationMethods, "generateContent") {
				continue
			}
			seen[id] = true
			label := strings.TrimSpace(m.DisplayName)
			if label == "" {
				label = id
			}
			out = append(out, ModelInfo{ID: id, Label: label, Desc: clipRunes(strings.TrimSpace(m.Description), descMax)})
		}
		if token = lr.NextPageToken; token == "" {
			break
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func hasMethod(ms []string, want string) bool {
	for _, m := range ms {
		if m == want {
			return true
		}
	}
	return false
}

func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n])) + "..."
}

// scrub: phòng xa - bỏ khoá khỏi thông báo lỗi mạng (khoá không nằm trong URL nên bình thường không có).
func scrub(err error, key string) error {
	if s := err.Error(); key != "" && strings.Contains(s, key) {
		return errors.New(strings.ReplaceAll(s, key, "***"))
	}
	return err
}
