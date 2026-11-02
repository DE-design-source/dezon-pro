package realtime

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync"

	"qspro-backend/internal/platform/logger"
)

// executor: bộ chạy tuần tự theo khoá thay Kafka ở giai đoạn MVP. Cùng khoá -> cùng worker -> chạy đúng thứ tự
// đã nộp; khoá khác nhau chạy song song trên các worker khác. Mỗi worker có hàng đợi riêng, đầy thì từ chối
// (không bao giờ chặn người nộp).
type executor struct {
	mu     sync.RWMutex // giữ đọc khi nộp, giữ ghi khi đóng hàng đợi (không gửi vào channel đã đóng)
	closed bool
	queues []chan func()
	done   chan struct{} // đóng khi mọi worker đã chạy hết hàng đợi và thoát
}

func newExecutor(workers, size int) *executor {
	e := &executor{queues: make([]chan func(), workers), done: make(chan struct{})}
	var wg sync.WaitGroup
	for i := range e.queues {
		q := make(chan func(), size)
		e.queues[i] = q
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range q {
				runJob(job)
			}
		}()
	}
	go func() {
		wg.Wait()
		close(e.done)
	}()
	return e
}

// submit nộp job vào worker của khoá. false = hàng đợi đầy hoặc đã dừng (job bị bỏ).
func (e *executor) submit(key int64, job func()) bool {
	if job == nil {
		return false
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.closed {
		return false
	}
	q := e.queues[uint64(key)%uint64(len(e.queues))]
	select {
	case q <- job:
		return true
	default:
		return false
	}
}

// stop ngừng nhận job mới; worker chạy nốt job đã xếp hàng rồi thoát. Chờ tới khi xong hoặc ctx hết hạn.
func (e *executor) stop(ctx context.Context) {
	e.mu.Lock()
	if !e.closed {
		e.closed = true
		for _, q := range e.queues {
			close(q)
		}
	}
	e.mu.Unlock()
	select {
	case <-e.done:
	case <-ctx.Done():
	}
}

// runJob chạy một job, panic không làm chết worker.
func runJob(job func()) {
	defer func() {
		if r := recover(); r != nil {
			logger.Error(logTag, "job panic:", fmt.Sprint(r), string(debug.Stack()))
		}
	}()
	job()
}
