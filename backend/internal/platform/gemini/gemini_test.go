package gemini

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewThieuKhoa(t *testing.T) {
	if _, err := New(Config{APIKey: "  "}); err == nil {
		t.Fatal("thiếu khoá phải lỗi")
	}
	c, err := New(Config{APIKey: "k"})
	if err != nil || c.Model() != DefaultModel {
		t.Fatalf("model mặc định: %v %v", c, err)
	}
}

func TestGenerateJSON(t *testing.T) {
	var got struct {
		path, key string
		body      map[string]any
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.path, got.key = r.URL.Path, r.Header.Get("x-goog-api-key")
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got.body)
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"a\":"},{"text":"1}"}]},"finishReason":"STOP"}]}`))
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "bi-mat", Model: "gemini-x", BaseURL: srv.URL + "/"})
	text, err := c.GenerateJSON(context.Background(), "hệ thống", "câu hỏi")
	if err != nil || text != `{"a":1}` {
		t.Fatalf("kết quả %q %v", text, err)
	}
	if got.path != "/models/gemini-x:generateContent" || got.key != "bi-mat" {
		t.Errorf("path %q key %q", got.path, got.key)
	}
	gc, _ := got.body["generationConfig"].(map[string]any)
	if gc["responseMimeType"] != "application/json" {
		t.Errorf("generationConfig %v", got.body["generationConfig"])
	}
	if si, _ := got.body["systemInstruction"].(map[string]any); si == nil {
		t.Error("thiếu systemInstruction")
	}
}

func TestGenerateJSONLoi(t *testing.T) {
	cases := []struct {
		name, body string
		code       int
		want       string
	}{
		{"http", `{"error":{"code":400,"message":"API key not valid. bi-mat","status":"INVALID_ARGUMENT"}}`, 400, "HTTP 400: API key not valid. ***"},
		{"chan", `{"promptFeedback":{"blockReason":"SAFETY"}}`, 200, "bị chặn (SAFETY)"},
		{"rong", `{"candidates":[]}`, 200, "không có kết quả"},
		{"khong-json", `<html>`, 200, "không phải JSON"},
		{"chu-rong", `{"candidates":[{"content":{"parts":[{"text":"  "}]},"finishReason":"MAX_TOKENS"}]}`, 200, "rỗng (MAX_TOKENS)"},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.code)
			_, _ = w.Write([]byte(tc.body))
		}))
		c, _ := New(Config{APIKey: "bi-mat", BaseURL: srv.URL})
		_, err := c.GenerateJSON(context.Background(), "", "x")
		srv.Close()
		if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "bi-mat") {
			t.Errorf("%s: lỗi %v, cần chứa %q và không lộ khoá", tc.name, err, tc.want)
		}
	}
}

func TestGenerateJSONTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "bi-mat", BaseURL: srv.URL, Timeout: 20 * time.Millisecond})
	if _, err := c.GenerateJSON(context.Background(), "", "x"); err == nil || strings.Contains(err.Error(), "bi-mat") {
		t.Errorf("timeout: %v", err)
	}
}

func TestGenerateJSONWithModel(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}`))
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "k", Model: "gemini-mac-dinh", BaseURL: srv.URL})
	for _, m := range []string{"gemini-khac", " models/gemini-khac2 ", ""} {
		if _, err := c.GenerateJSONWith(context.Background(), m, "", "x"); err != nil {
			t.Fatal(err)
		}
	}
	want := "/models/gemini-khac:generateContent,/models/gemini-khac2:generateContent,/models/gemini-mac-dinh:generateContent"
	if strings.Join(paths, ",") != want {
		t.Errorf("paths %v", paths)
	}
	if c.Model() != "gemini-mac-dinh" {
		t.Errorf("model mặc định không được đổi: %s", c.Model())
	}
}

func TestListModels(t *testing.T) {
	calls := 0
	fail := false
	var gotKey, gotQuery []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		gotKey = append(gotKey, r.Header.Get("x-goog-api-key"))
		gotQuery = append(gotQuery, r.URL.RawQuery)
		if r.URL.Path != "/models" || r.Method != http.MethodGet {
			t.Errorf("gọi %s %s", r.Method, r.URL.Path)
		}
		if fail {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"error":{"message":"bad key bi-mat"}}`))
			return
		}
		if r.URL.Query().Get("pageToken") == "" {
			_, _ = w.Write([]byte(`{"models":[
				{"name":"models/gemini-z-pro","displayName":"Gemini Z Pro","description":"Mạnh","supportedGenerationMethods":["generateContent","countTokens"]},
				{"name":"models/embedding-001","displayName":"Embedding","supportedGenerationMethods":["embedContent"]},
				{"name":"models/gemini-embed","displayName":"Gemini Embed","supportedGenerationMethods":["embedContent"]},
				{"name":"models/imagen-3","supportedGenerationMethods":["generateContent"]}
			],"nextPageToken":"p2"}`))
			return
		}
		_, _ = w.Write([]byte(`{"models":[
			{"name":"models/gemini-a-flash","supportedGenerationMethods":["generateContent"],"description":"` + strings.Repeat("d", 300) + `"},
			{"name":"models/gemini-z-pro","displayName":"Trùng","supportedGenerationMethods":["generateContent"]}
		]}`))
	}))
	defer srv.Close()
	now := time.Date(2026, 11, 22, 8, 0, 0, 0, time.UTC)
	c, _ := New(Config{APIKey: "bi-mat", BaseURL: srv.URL})
	c.now = func() time.Time { return now }

	list, err := c.ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "gemini-a-flash" || list[0].Label != "gemini-a-flash" || len([]rune(list[0].Desc)) != descMax+3 ||
		list[1] != (ModelInfo{ID: "gemini-z-pro", Label: "Gemini Z Pro", Desc: "Mạnh"}) {
		t.Errorf("danh sách %+v", list)
	}
	if calls != 2 || gotKey[0] != "bi-mat" || strings.Contains(gotQuery[0], "bi-mat") || !strings.Contains(gotQuery[0], "pageSize=200") ||
		!strings.Contains(gotQuery[1], "pageToken=p2") {
		t.Errorf("gọi %d lần, key %v, query %v", calls, gotKey, gotQuery)
	}
	// trong 1 giờ: dùng cache, bản trả về là bản sao
	list[0].ID = "sua"
	now = now.Add(59 * time.Minute)
	list, _ = c.ListModels(context.Background())
	if calls != 2 || list[0].ID != "gemini-a-flash" {
		t.Errorf("cache 1 giờ: %d lần, %+v", calls, list)
	}
	// hết 1 giờ + API lỗi: lỗi không lộ khoá, giữ lỗi 1 phút
	now = now.Add(2 * time.Minute)
	fail = true
	if _, err := c.ListModels(context.Background()); err == nil || !strings.Contains(err.Error(), "HTTP 403") || strings.Contains(err.Error(), "bi-mat") {
		t.Errorf("lỗi: %v", err)
	}
	if _, err := c.ListModels(context.Background()); err == nil || calls != 3 {
		t.Errorf("lỗi giữ 1 phút: %v %d", err, calls)
	}
	fail = false
	now = now.Add(61 * time.Second)
	if list, err := c.ListModels(context.Background()); err != nil || len(list) != 2 || calls != 5 {
		t.Errorf("sau 1 phút thử lại: %v %d %d", err, len(list), calls)
	}
}

func TestListModelsCtxHuy(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-x","supportedGenerationMethods":["generateContent"]}]}`))
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "k", BaseURL: srv.URL})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.ListModels(ctx); err == nil {
		t.Fatal("ctx huỷ phải lỗi")
	}
	if list, err := c.ListModels(context.Background()); err != nil || len(list) != 1 {
		t.Errorf("lỗi do ctx huỷ không được giữ: %v %v", list, err)
	}
}

// Đang có lần lấy danh sách khác giữ khoá: người chờ bỏ cuộc theo ctx của mình, không xếp hàng tới hết lần kia.
func TestListModelsChoTheoCtx(t *testing.T) {
	c, _ := New(Config{APIKey: "k", BaseURL: "http://127.0.0.1:9"})
	c.listSem <- struct{}{}
	defer func() { <-c.listSem }()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := c.ListModels(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("phải lỗi hết giờ, được %v", err)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("chờ quá lâu: %v", d)
	}
}

func TestGenerateJSONParts(t *testing.T) {
	audio := []byte{0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 'x'}
	var path string
	var raw []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		raw, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"nghĩ","thought":true},{"text":"{\"lines\":[]}"}]}}]}`))
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "k", Model: "gemini-mac-dinh", BaseURL: srv.URL})
	text, err := c.GenerateJSONParts(context.Background(), " models/gemini-am-thanh ", "hệ thống", []Part{
		{MIME: "audio/webm;codecs=opus", Data: audio},
		{Text: "gợi ý"},
		{Text: ""},
	})
	if err != nil || text != `{"lines":[]}` {
		t.Fatalf("kết quả %q %v", text, err)
	}
	if path != "/models/gemini-am-thanh:generateContent" {
		t.Errorf("path %q", path)
	}
	var body struct {
		Contents []struct {
			Parts []map[string]json.RawMessage `json:"parts"`
		} `json:"contents"`
		GenerationConfig map[string]any `json:"generationConfig"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body.GenerationConfig["responseMimeType"] != "application/json" {
		t.Errorf("generationConfig %v", body.GenerationConfig)
	}
	ps := body.Contents[0].Parts
	if len(ps) != 2 {
		t.Fatalf("số phần %d: %s", len(ps), raw)
	}
	if _, ok := ps[0]["text"]; ok || len(ps[0]) != 1 {
		t.Errorf("phần âm thanh không được kèm text: %s", raw)
	}
	var inl struct{ MimeType, Data string }
	_ = json.Unmarshal(ps[0]["inlineData"], &inl)
	dec, _ := base64.StdEncoding.DecodeString(inl.Data)
	if inl.MimeType != "audio/webm" || string(dec) != string(audio) {
		t.Errorf("inlineData %+v", inl)
	}
	var txt string
	_ = json.Unmarshal(ps[1]["text"], &txt)
	if txt != "gợi ý" || len(ps[1]) != 1 {
		t.Errorf("phần chữ %s", raw)
	}
	if !strings.Contains(string(raw), `"systemInstruction":{"parts":[{"text":"hệ thống"}]}`) {
		t.Errorf("systemInstruction %s", raw)
	}
	if c.httpParts.Timeout != partsTimeout || c.http.Timeout != defaultTimeout {
		t.Errorf("timeout %v %v", c.httpParts.Timeout, c.http.Timeout)
	}
}

func TestGenerateJSONPartsLoi(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"error":{"code":403,"message":"key bi-mat bị từ chối"}}`))
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "bi-mat", BaseURL: srv.URL})
	_, err := c.GenerateJSONParts(context.Background(), "", "", []Part{{MIME: "audio/ogg", Data: []byte("a")}})
	if err == nil || !strings.Contains(err.Error(), "HTTP 403: key *** bị từ chối") || strings.Contains(err.Error(), "bi-mat") {
		t.Errorf("lỗi %v", err)
	}
	if _, err := c.GenerateJSONParts(context.Background(), "", "", []Part{{Text: ""}}); err == nil {
		t.Error("nội dung rỗng phải lỗi")
	}
	if _, err := c.GenerateJSONParts(context.Background(), "", "", []Part{{Data: []byte("a")}}); err == nil {
		t.Error("thiếu MIME phải lỗi")
	}
}

func TestPartJSONGiuNguyen(t *testing.T) {
	b, _ := json.Marshal([]part{{Text: ""}, {Text: "a", Thought: true}})
	if string(b) != `[{"text":""},{"text":"a","thought":true}]` {
		t.Errorf("json %s", b)
	}
}

func TestGenerateJSONFast(t *testing.T) {
	var bodies []string
	reject := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		if reject && strings.Contains(string(b), "thinkingConfig") {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":{"code":400,"message":"Thinking level is not supported for this model."}}`))
			return
		}
		w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"{\"ok\":1}"}]}}]}`))
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "khoa-thu-123", BaseURL: srv.URL})
	out, err := c.GenerateJSONFast(context.Background(), "m1", "", "p")
	if err != nil || out != `{"ok":1}` || len(bodies) != 2 || !strings.Contains(bodies[0], `"thinkingLevel":"low"`) || strings.Contains(bodies[1], "thinkingConfig") {
		t.Fatalf("thử lại kiểu thường: %v %q %v", err, out, bodies)
	}
	bodies = nil
	c.GenerateJSONFast(context.Background(), "m1", "", "p")
	if len(bodies) != 1 || strings.Contains(bodies[0], "thinkingConfig") {
		t.Errorf("model đã biết không nhận: gọi thẳng kiểu thường: %v", bodies)
	}
	reject, bodies = false, nil
	if out, err = c.GenerateJSONFast(context.Background(), "m2", "", "p"); err != nil || len(bodies) != 1 || !strings.Contains(bodies[0], `"thinkingLevel":"low"`) {
		t.Errorf("model nhận thinkingLevel: %v %v", err, bodies)
	}
}
