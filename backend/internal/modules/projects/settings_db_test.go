package projects

import (
	"context"
	"errors"
	"os"
	"regexp"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/omap"
)

// Trên qspro_gotest: getProjData không trả khoá kdAiConfig (cấu hình AI Kinh doanh) của cai_dat_cong_ty.
func TestProjDataSkipsAiConfigDB(t *testing.T) {
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
	us, err := db.Select(bg, "users", database.SelectOpt{Filter: database.Eq("username", "admin") + "&cong_ty_id=not.is.null", Limit: 1, NoScope: true})
	if err != nil || len(us) == 0 {
		t.Fatalf("database thử không có tài khoản admin thuộc công ty: %v", err)
	}
	ctx := ctxOf(omap.Of("uid", us[0].Val("id"), "role", "admin", "congTyId", us[0].Val("cong_ty_id")))
	_, err = db.InsertOne(ctx, "cai_dat_cong_ty", omap.Of("khoa", "kdAiConfig", "gia_tri", omap.Of("instructions", "ZZ thử")))
	var de *database.Error
	switch {
	case err == nil:
		t.Cleanup(func() { _, _ = db.Remove(ctx, "cai_dat_cong_ty", database.Eq("khoa", "kdAiConfig")) })
	case !errors.As(err, &de) || de.Code != "23505":
		t.Fatal(err)
	}
	svc := New(Deps{DB: db, Catalog: &stubCatalog{}, Lines: &stubLines{}})
	out, err := svc.GetProjData(ctx, "ZZ_U7ai_A")
	if err != nil {
		t.Fatal(err)
	}
	if out.Has("kdAiConfig") {
		t.Errorf("getProjData lộ kdAiConfig: %s", mustJSON(t, out))
	}
}

// Trên qspro_gotest: danh sách dự án đã nhập từ dezon.vn ghi / đọc lại được (tạo rồi sửa), không trả qua getProjData.
func TestDezonSeenDB(t *testing.T) {
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
	us, err := db.Select(bg, "users", database.SelectOpt{Filter: database.Eq("username", "admin") + "&cong_ty_id=not.is.null", Limit: 1, NoScope: true})
	if err != nil || len(us) == 0 {
		t.Fatalf("database thử không có tài khoản admin thuộc công ty: %v", err)
	}
	ctx := ctxOf(omap.Of("uid", us[0].Val("id"), "role", "admin", "congTyId", us[0].Val("cong_ty_id")))
	repo := &pgRepo{db: db}
	truoc, err := repo.DezonSeen(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(truoc) > 0 {
		t.Skip("database thử đã có dezonDaNhap, không đè")
	}
	t.Cleanup(func() { _, _ = db.Remove(ctx, "cai_dat_cong_ty", database.Eq("khoa", dzSeenKey)) })
	for _, links := range [][]string{{"dezon.vn/du-an/a"}, {"dezon.vn/du-an/a", "dezon.vn/du-an/b"}} {
		if err := repo.SaveDezonSeen(ctx, links, "admin", "2026-11-27T00:00:00.000Z"); err != nil {
			t.Fatal(err)
		}
		got, err := repo.DezonSeen(ctx)
		if err != nil || len(got) != len(links) || got[len(got)-1] != links[len(links)-1] {
			t.Fatalf("đọc lại %v: %v %v", links, got, err)
		}
	}
	svc := New(Deps{DB: db, Catalog: &stubCatalog{}, Lines: &stubLines{}})
	out, err := svc.GetProjData(ctx, "ZZ_U7ai_A")
	if err != nil {
		t.Fatal(err)
	}
	if out.Has(dzSeenKey) {
		t.Errorf("getProjData lộ %s: %s", dzSeenKey, mustJSON(t, out))
	}
}
