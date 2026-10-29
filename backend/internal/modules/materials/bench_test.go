package materials

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/tenant"
)

// ───────────── đo bộ nhớ của đường trả danh mục (getProducts / bootstrap) ─────────────
// Chạy: TEST_DATABASE_URL=... go test ./internal/modules/materials/ -run '^$' -bench Catalog -benchmem

// discardWriter: ResponseWriter bỏ thân - chỉ đo phần cấp phát của response.OK, không tính bộ đệm của máy thu.
type discardWriter struct {
	h http.Header
	n int
}

func (w *discardWriter) Header() http.Header         { return w.h }
func (w *discardWriter) WriteHeader(int)             {}
func (w *discardWriter) Write(b []byte) (int, error) { w.n += len(b); return len(b), nil }

func benchSvc(tb testing.TB) (*Service, context.Context, func()) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		tb.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		tb.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	deps := stubDeps{repo: db}
	s := New(Deps{DB: db, Auditor: deps, Users: deps, UserFmt: deps, Notifier: deps, Admins: deps, Uploader: &fakeUploader{}})
	return s, tenant.With(context.Background(), tenant.Ctx{Role: "super"}), db.Close
}

// guiOK đẩy v qua đúng đường của cổng rpc: response.OK trên gin.Context.
func guiOK(v any) int {
	w := &discardWriter{h: http.Header{}}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Writer = &ginDiscard{ResponseWriter: c.Writer, w: w}
	c.Request = httptest.NewRequest("POST", "/api/getProducts", nil)
	response.OK(c, v)
	return w.n
}

type ginDiscard struct {
	gin.ResponseWriter
	w *discardWriter
}

func (g *ginDiscard) Header() http.Header         { return g.w.h }
func (g *ginDiscard) WriteHeader(int)             {}
func (g *ginDiscard) WriteHeaderNow()             {}
func (g *ginDiscard) Write(b []byte) (int, error) { return g.w.Write(b) }

// BenchmarkCatalogEncode: chỉ phần ghi JSON + ETag của danh mục đã có trong cache.
func BenchmarkCatalogEncode(b *testing.B) {
	gin.SetMode(gin.TestMode)
	s, ctx, done := benchSvc(b)
	defer done()
	prods, err := s.GetProductsCached(ctx)
	if err != nil {
		b.Fatal(err)
	}
	n := guiOK(prods)
	b.Logf("%d sản phẩm, thân %d byte", len(prods), n)
	b.SetBytes(int64(n))
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			guiOK(prods)
		}
	})
}

// BenchmarkCatalogRead: getProducts trọn vẹn (đọc database + dựng object + ghi JSON), như 1 request rpc.
func BenchmarkCatalogRead(b *testing.B) {
	gin.SetMode(gin.TestMode)
	s, ctx, done := benchSvc(b)
	defer done()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		prods, err := s.GetProducts(ctx)
		if err != nil {
			b.Fatal(err)
		}
		guiOK(prods)
	}
}

// TestCatalogMemProbe: in số byte cấp phát / request của từng chặng và đỉnh heap khi 100 request chạy cùng lúc.
// Chỉ chạy khi đặt CATALOG_MEM=1 (đo, không khẳng định gì).
func TestCatalogMemProbe(t *testing.T) {
	if os.Getenv("CATALOG_MEM") == "" {
		t.Skip("đặt CATALOG_MEM=1 để đo")
	}
	gin.SetMode(gin.TestMode)
	s, ctx, done := benchSvc(t)
	defer done()
	prods, err := s.GetProducts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	body := guiOK(prods)
	do := func(name string, n int, fn func()) {
		runtime.GC()
		var a, z runtime.MemStats
		runtime.ReadMemStats(&a)
		for i := 0; i < n; i++ {
			fn()
		}
		runtime.ReadMemStats(&z)
		per := (z.TotalAlloc - a.TotalAlloc) / uint64(n)
		t.Logf("%-28s %9d byte/request = %.2f lần thân (%d byte)", name, per, float64(per)/float64(body), body)
	}
	do("ghi JSON (response.OK)", 20, func() { guiOK(prods) })
	do("omap.Marshal", 20, func() { _, _ = omap.Marshal(prods) })
	do("đọc database + dựng object", 10, func() { _, _ = s.GetProducts(ctx) })
	do("getProducts trọn vẹn", 10, func() {
		p, _ := s.GetProducts(ctx)
		guiOK(p)
	})
	for _, kind := range []string{"ghi JSON", "getProducts trọn vẹn"} {
		runtime.GC()
		var a runtime.MemStats
		runtime.ReadMemStats(&a)
		var peak uint64
		stop := make(chan struct{})
		var mon sync.WaitGroup
		mon.Add(1)
		go func() {
			defer mon.Done()
			var m runtime.MemStats
			for {
				select {
				case <-stop:
					return
				default:
				}
				runtime.ReadMemStats(&m)
				if m.HeapInuse > peak {
					peak = m.HeapInuse
				}
			}
		}()
		var wg sync.WaitGroup
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if kind == "ghi JSON" {
					guiOK(prods)
					return
				}
				p, err := s.GetProducts(ctx)
				if err == nil {
					guiOK(p)
				}
			}()
		}
		wg.Wait()
		close(stop)
		mon.Wait()
		var z runtime.MemStats
		runtime.ReadMemStats(&z)
		t.Logf("100 request cùng lúc, %-22s đỉnh HeapInuse %4d MB, cấp phát %5d MB (%.1f MB/request), Sys %d MB", kind+":",
			peak>>20, (z.TotalAlloc-a.TotalAlloc)>>20, float64(z.TotalAlloc-a.TotalAlloc)/100/(1<<20), z.Sys>>20)
	}
}

// TestCatalogResponseBytes: danh mục cỡ thật (hơn 949 sản phẩm dựng bằng prodToObj từ các dòng của unit.json, có gắn
// yeuThich / comboN như getProducts) đi qua response.OK phải ra đúng {"ok":true,"result":[...]} ghép từ JSON mà Node
// sinh cho từng sản phẩm, kèm ETag yếu của Express tính trên chính thân đó - kể cả khi bộ đệm được dùng lại.
func TestCatalogResponseBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := arr(jsval.AsMap(loadJSON(t, "unit.json").Val("pure")).Val("prodToObj"))
	var prods []any
	var parts []string
	for len(prods) < 949 {
		for i, c := range cases {
			row := jsval.AsMap(arr(c)[0])
			yt, combo := i%3 == 0, float64(i%4)
			p := stripDL(prodToObj(row)).(*omap.Map)
			p.Set("yeuThich", yt)
			p.Set("comboN", combo)
			prods = append(prods, p)
			// JSON của Node cho sản phẩm này + hai khoá getProducts gắn thêm ở cuối
			want := js(arr(c)[1])
			parts = append(parts, want[:len(want)-1]+`,"yeuThich":`+strconv.FormatBool(yt)+`,"comboN":`+strconv.Itoa(int(combo))+"}")
		}
	}
	body := `{"ok":true,"result":[` + strings.Join(parts, ",") + `]}`
	for round := 0; round < 3; round++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/api/getProducts", nil)
		response.OK(c, prods)
		if got := w.Body.String(); got != body {
			i := 0
			for i < len(got) && i < len(body) && got[i] == body[i] {
				i++
			}
			t.Fatalf("vòng %d: thân khác Node tại byte %d (%d / %d byte)", round, i, len(got), len(body))
		}
		if got, want := w.Header().Get("ETag"), etagOf([]byte(body)); got != want {
			t.Errorf("vòng %d: ETag %s, muốn %s", round, got, want)
		}
		if got := w.Header().Get("Content-Length"); got != strconv.Itoa(len(body)) {
			t.Errorf("vòng %d: Content-Length %s, muốn %d", round, got, len(body))
		}
	}
	t.Logf("%d sản phẩm, thân %d byte", len(prods), len(body))
}
