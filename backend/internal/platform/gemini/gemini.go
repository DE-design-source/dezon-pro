// Package gemini: client tối giản gọi Google Gemini API (generateContent), chỉ dùng thư viện chuẩn (net/http).
// Dùng cho phân tích khách hàng Kinh doanh (GEMINI_API_KEY / GEMINI_MODEL). Khoá API gửi qua header x-goog-api-key,
// không nằm trong URL và không bao giờ xuất hiện trong thông báo lỗi / log.
package gemini

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// DefaultModel: model mặc định khi không đặt GEMINI_MODEL.
	DefaultModel   = "gemini-3.8-flash"
	defaultBaseURL = "https://generativelanguage.googleapis.com/v1beta"
	defaultTimeout = 60 * time.Second
	maxBody        = 4 << 20 // trần đọc phản hồi (4 MB)
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
	return &Client{key: key, model: model, base: base, http: &http.Client{Timeout: to}}, nil
}

// Model: tên model đang dùng.
func (c *Client) Model() string { return c.model }

type part struct {
	Text    string `json:"text"`
	Thought bool   `json:"thought,omitempty"` // phần "suy nghĩ" của model đời mới: không thuộc câu trả lời
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
	body := request{
		Contents:         []content{{Role: "user", Parts: []part{{Text: prompt}}}},
		GenerationConfig: map[string]any{"responseMimeType": "application/json", "temperature": 0.4},
	}
	if system != "" {
		body.SystemInstruction = &content{Parts: []part{{Text: system}}}
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	u := c.base + "/models/" + url.PathEscape(c.model) + ":generateContent"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", c.key)
	res, err := c.http.Do(req)
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

// scrub: phòng xa - bỏ khoá khỏi thông báo lỗi mạng (khoá không nằm trong URL nên bình thường không có).
func scrub(err error, key string) error {
	if s := err.Error(); key != "" && strings.Contains(s, key) {
		return errors.New(strings.ReplaceAll(s, key, "***"))
	}
	return err
}
