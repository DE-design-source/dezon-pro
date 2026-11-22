package gemini

import (
	"context"
	"encoding/json"
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
