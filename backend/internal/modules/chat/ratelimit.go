package chat

import (
	"sync"
	"time"
)

// limiter: token bucket theo người dùng, trong bộ nhớ (một gateway). Mỗi người có tối đa burst lượt, hồi lại
// burst lượt sau mỗi khoảng per.
type limiter struct {
	mu      sync.Mutex
	rate    float64 // lượt / giây
	burst   float64
	now     func() time.Time
	buckets map[int64]*bucket
	swept   time.Time
}

type bucket struct {
	tokens float64
	at     time.Time
}

func newLimiter(burst int, per time.Duration, now func() time.Time) *limiter {
	return &limiter{rate: float64(burst) / per.Seconds(), burst: float64(burst), now: now, buckets: map[int64]*bucket{}}
}

// allow lấy 1 lượt của key; hết lượt -> false.
func (l *limiter) allow(key int64) bool { return l.allowN(key, 1) }

// allowN lấy n lượt một lần; không đủ n lượt -> false, không trừ gì.
func (l *limiter) allowN(key int64, n float64) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now) // trước khi lấy bucket: không dọn mất bucket đang dùng
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, at: now}
		l.buckets[key] = b
	} else if el := now.Sub(b.at).Seconds(); el > 0 {
		b.tokens = min(l.burst, b.tokens+el*l.rate)
		b.at = now
	}
	if b.tokens < n {
		return false
	}
	b.tokens -= n
	return true
}

// sweep: mỗi phút bỏ các bucket đã hồi đầy (không còn ý nghĩa) để map không phình.
func (l *limiter) sweep(now time.Time) {
	if now.Sub(l.swept) < time.Minute {
		return
	}
	l.swept = now
	for k, b := range l.buckets {
		if b.tokens+now.Sub(b.at).Seconds()*l.rate >= l.burst {
			delete(l.buckets, k)
		}
	}
}
