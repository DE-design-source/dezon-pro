package realtime

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestSubmitOrderPerKey(t *testing.T) {
	h := NewHub(Options{Backend: newFakeBackend(), Workers: 4, QueueSize: 100000})
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		h.Shutdown(ctx)
	}()

	const keys, perKey = 16, 2000
	results := make([][]int, keys)
	var wg sync.WaitGroup
	wg.Add(keys * perKey)
	var submitters sync.WaitGroup
	for k := 0; k < keys; k++ {
		submitters.Add(1)
		go func() {
			defer submitters.Done()
			key := int64(k) - 8 // có cả khoá âm
			for i := 0; i < perKey; i++ {
				if !h.Submit(key, func() {
					results[k] = append(results[k], i) // chỉ worker của khoá này chạm vào results[k]
					wg.Done()
				}) {
					t.Errorf("Submit(%d) bị từ chối", key)
					wg.Done()
				}
			}
		}()
	}
	submitters.Wait()
	wg.Wait()
	for k, r := range results {
		if len(r) != perKey {
			t.Fatalf("khoá %d chạy %d job", k, len(r))
		}
		for i, v := range r {
			if v != i {
				t.Fatalf("khoá %d sai thứ tự tại %d: %d", k, i, v)
			}
		}
	}
}

func TestSubmitQueueFull(t *testing.T) {
	h := NewHub(Options{Backend: newFakeBackend(), Workers: 1, QueueSize: 2})
	block, started := make(chan struct{}), make(chan struct{})
	if !h.Submit(1, func() { close(started); <-block }) {
		t.Fatal("job đầu bị từ chối")
	}
	<-started
	var ran sync.WaitGroup
	ran.Add(2)
	if !h.Submit(1, ran.Done) || !h.Submit(2, ran.Done) {
		t.Fatal("hàng đợi còn chỗ mà bị từ chối")
	}
	if h.Submit(3, func() {}) {
		t.Fatal("hàng đợi đầy phải trả false")
	}
	if h.Submit(1, nil) {
		t.Fatal("job nil phải trả false")
	}
	close(block)
	ran.Wait()

	// Job panic không giết worker.
	done := make(chan struct{})
	h.Submit(5, func() { panic("hỏng") })
	h.Submit(5, func() { close(done) })
	select {
	case <-done:
	case <-time.After(waitStep):
		t.Fatal("worker chết sau panic")
	}

	// Shutdown chạy nốt job đã xếp hàng.
	var after sync.WaitGroup
	after.Add(1)
	h.Submit(9, func() { time.Sleep(50 * time.Millisecond); after.Done() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.Shutdown(ctx)
	after.Wait()
	if h.Submit(1, func() {}) {
		t.Fatal("Submit sau Shutdown phải trả false")
	}
}
