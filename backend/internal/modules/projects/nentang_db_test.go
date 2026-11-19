package projects

import (
	"context"
	"os"
	"regexp"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Trên qspro_gotest: nenTang (cột projects.platform, migration 0050) ghi khi tạo / sửa rồi đọc lại qua getProject.
func TestNenTangDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	t.Cleanup(db.Close)
	bg := context.Background()
	t.Cleanup(func() {
		if pool, err := db.Pool(); err == nil {
			_, _ = pool.Exec(bg, `delete from projects where project_code like 'ZZ\_U7nt\_%'`)
		}
	})
	us, err := db.Select(bg, "users", database.SelectOpt{Filter: database.Eq("username", "admin") + "&cong_ty_id=not.is.null", Limit: 1, NoScope: true})
	if err != nil || len(us) == 0 {
		t.Fatalf("database thử không có tài khoản admin thuộc công ty: %v", err)
	}
	ctx := ctxOf(omap.Of("uid", us[0].Val("id"), "role", "admin", "congTyId", us[0].Val("cong_ty_id")))
	svc := New(Deps{DB: db, Catalog: &stubCatalog{}, Lines: &stubLines{}})
	a, err := svc.CreateProject(ctx, omap.Of("maDA", "ZZ_U7nt_A", "ten", "ZZ_U7nt dự án A", "nenTang", "Dezon.vn"))
	if err != nil {
		t.Fatal(err)
	}
	if !jsval.StrictEquals(a.Val("nenTang"), "Dezon.vn") {
		t.Errorf("tạo: nenTang = %s", mustJSON(t, a.Val("nenTang")))
	}
	if _, err := svc.UpdateProject(ctx, "ZZ_U7nt_A", omap.Of("nenTang", "Dezon Pro")); err != nil {
		t.Fatal(err)
	}
	g, err := svc.GetProject(ctx, "ZZ_U7nt_A")
	if err != nil || g == nil || !jsval.StrictEquals(g.Val("nenTang"), "Dezon Pro") {
		t.Fatalf("sửa rồi đọc lại: %v %s", err, mustJSON(t, g))
	}
}
