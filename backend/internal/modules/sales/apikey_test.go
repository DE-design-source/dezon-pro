package sales

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ctxRepo: ghi lại công ty của request khi đọc danh sách.
type ctxRepo struct {
	*fakeRepo
	seenCT []any
}

func (r *ctxRepo) ListLeads(ctx context.Context) ([]*omap.Map, error) {
	r.seenCT = append(r.seenCT, tenant.TenantID(ctx))
	return r.fakeRepo.ListLeads(ctx)
}

func (r *ctxRepo) ListStaff(ctx context.Context) ([]*omap.Map, error) {
	r.seenCT = append(r.seenCT, tenant.TenantID(ctx))
	return r.fakeRepo.ListStaff(ctx)
}

func TestReadKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const key = "vt_ro_test_key_123"
	sum := sha256.Sum256([]byte(key))
	f := newFake()
	f.staff = []*omap.Map{omap.Of("username", "an", "ho_ten", "An", "role", "user")}
	if _, err := f.InsertLead(context.Background(), omap.Of("ten_khach", "Khách A")); err != nil {
		t.Fatal(err)
	}
	repo := &ctxRepo{fakeRepo: f}
	s := New(Deps{Repo: repo, Users: fakeUsers{}, UserFmt: fakeUsers{}, Lines: fakeLines{}, Projects: fakeProjects{},
		Cfg: &config.Config{SalesReadKeys: "bad-entry, vuathau:ct-dezon:" + hex.EncodeToString(sum[:])}})
	if len(s.readKeys) != 1 {
		t.Fatalf("readKeys = %d, muốn 1 (mục sai dạng bị bỏ)", len(s.readKeys))
	}
	e := gin.New()
	s.RegisterRoutes(e.Group("/api/v1", middleware.Auth(nil), middleware.Tenant()))

	do := func(method, path, tok string) (int, string) {
		req := httptest.NewRequest(method, path, strings.NewReader(`{"name":"x","stage":"spam"}`))
		req.Header.Set("Content-Type", "application/json")
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		e.ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}

	if st, body := do("GET", "/api/v1/sales/leads", key); st != 200 || !strings.Contains(body, `"leads":[`) || !strings.Contains(body, "Khách A") {
		t.Fatalf("GET leads = %d %s", st, body)
	}
	if st, body := do("GET", "/api/v1/sales/staff", key); st != 200 || !strings.Contains(body, `"staff":[`) {
		t.Fatalf("GET staff = %d %s", st, body)
	}
	for _, ct := range repo.seenCT {
		if ct != "ct-dezon" {
			t.Fatalf("công ty của request = %v, muốn ct-dezon", ct)
		}
	}
	// ghi / đường khác: 403, không chạm dữ liệu
	for _, r := range [][2]string{
		{"POST", "/api/v1/sales/leads"}, {"PATCH", "/api/v1/sales/leads/1"}, {"DELETE", "/api/v1/sales/leads/1"},
		{"POST", "/api/v1/sales/leads/1/activities"}, {"GET", "/api/v1/sales/leads/1/activities"},
	} {
		if st, body := do(r[0], r[1], key); st != 403 || !strings.Contains(body, "READONLY_KEY") {
			t.Fatalf("%s %s = %d %s, muốn 403", r[0], r[1], st, body)
		}
	}
	if len(f.leads) != 1 || f.nextID != 2 || len(f.acts) != 0 {
		t.Fatalf("dữ liệu bị đổi: leads=%d acts=%d", len(f.leads), len(f.acts))
	}
	if r := f.leads[1]; r.Val("giai_doan") == "spam" || r.Val("ten_khach") != "Khách A" {
		t.Fatalf("khách bị sửa: %v", r)
	}
	// khoá sai / không khoá: như chưa đăng nhập
	for _, tok := range []string{"", "sai", key + "x"} {
		if st, _ := do("GET", "/api/v1/sales/leads", tok); st != 401 {
			t.Fatalf("token %q = %d, muốn 401", tok, st)
		}
	}
	// không cấu hình khoá: khoá cũ không dùng được
	s2 := New(Deps{Repo: repo, Users: fakeUsers{}, UserFmt: fakeUsers{}, Cfg: &config.Config{}})
	e2 := gin.New()
	s2.RegisterRoutes(e2.Group("/api/v1", middleware.Auth(nil), middleware.Tenant()))
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/v1/sales/leads", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	e2.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("không cấu hình khoá = %d, muốn 401", w.Code)
	}
}
