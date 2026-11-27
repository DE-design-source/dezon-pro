// Package reqcache: bộ nhớ đệm sống đúng 1 request (gắn vào context.Context ở middleware.RequestContext). Dùng cho dữ liệu
// đọc lặp lại trong cùng request (vd quyền thực của phân quyền 3 cấp - module access). Context không có bộ đệm thì
// Get luôn trượt, Set không làm gì (job nền, test).
package reqcache

import (
	"context"
	"sync"
)

type ctxKey struct{}

type store struct {
	mu sync.Mutex
	m  map[string]any
}

// With: context mang bộ đệm mới (đã có thì giữ nguyên).
func With(ctx context.Context) context.Context {
	if _, ok := ctx.Value(ctxKey{}).(*store); ok {
		return ctx
	}
	return context.WithValue(ctx, ctxKey{}, &store{m: map[string]any{}})
}

// Get: giá trị đã lưu theo khoá.
func Get(ctx context.Context, key string) (any, bool) {
	s, ok := ctx.Value(ctxKey{}).(*store)
	if !ok {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[key]
	return v, ok
}

// Set: lưu giá trị theo khoá (context không có bộ đệm: bỏ qua).
func Set(ctx context.Context, key string, v any) {
	if s, ok := ctx.Value(ctxKey{}).(*store); ok {
		s.mu.Lock()
		s.m[key] = v
		s.mu.Unlock()
	}
}

// Forget: bỏ các khoá bắt đầu bằng prefix (sau khi ghi dữ liệu mà bộ đệm phản ánh).
func Forget(ctx context.Context, prefix string) {
	s, ok := ctx.Value(ctxKey{}).(*store)
	if !ok {
		return
	}
	s.mu.Lock()
	for k := range s.m {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			delete(s.m, k)
		}
	}
	s.mu.Unlock()
}
