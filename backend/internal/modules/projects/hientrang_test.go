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

// M8.3: hienTrang (cột hien_trang) chỉ ghi khi client gửi khoá; kết quả dự án luôn có hienTrang, nối sau linkDezon.
func TestHienTrangGhiKhiCoKhoa(t *testing.T) {
	f := &fakeRepo{log: []any{}, ret: omap.New(), errs: omap.New()}
	svc := New(Deps{Repo: f})
	svc.now = func() string { return "<ts>" }
	svc.genMa = func() string { return "<ma>" }
	ctx := context.Background()

	// tham số i của lệnh InsertProject / UpdateProject gần nhất (sửa không ra dòng nào thì service đọc lại bằng FindProject)
	lastArg := func(i int) *omap.Map {
		for k := len(f.log) - 1; k >= 0; k-- {
			if m := jsval.AsString(jsval.Get(f.log[k], "m")); m == "InsertProject" || m == "UpdateProject" {
				return jsval.AsMap(jsval.AsArray(jsval.Get(f.log[k], "a"))[i])
			}
		}
		t.Fatal("không có lệnh ghi dự án")
		return nil
	}
	// tạo không gửi khoá / gửi rỗng -> dòng chèn không có hien_trang
	for _, data := range []*omap.Map{omap.Of("ten", "A"), omap.Of("ten", "A", "hienTrang", "")} {
		p, err := svc.CreateProject(ctx, data)
		if err != nil {
			t.Fatal(err)
		}
		if lastArg(0).Has("hien_trang") {
			t.Errorf("tạo %s: không được ghi hien_trang", mustJSON(t, data))
		}
		// khoá chỉ bản Go nối cuối theo thứ tự projMap (goOnlyResultKeys: hienTrang, kienTrucSu - 0018, studio - 0020, 4 khoá của 0021), đều rỗng
		keys := p.Keys()
		tail := keys[len(keys)-len(goOnlyResultKeys):]
		for i, k := range goOnlyResultKeys {
			if tail[i] != k || !jsval.StrictEquals(p.Val(k), "") {
				t.Errorf("kết quả phải nối %v rỗng ở cuối: %s", goOnlyResultKeys, mustJSON(t, p))
				break
			}
		}
	}
	p, err := svc.CreateProject(ctx, omap.Of("ten", "A", "hienTrang", "Nhà cũ 2 tầng"))
	if err != nil {
		t.Fatal(err)
	}
	if !jsval.StrictEquals(lastArg(0).Val("hien_trang"), "Nhà cũ 2 tầng") || !jsval.StrictEquals(p.Val("hienTrang"), "Nhà cũ 2 tầng") {
		t.Errorf("tạo có hienTrang: dòng %s, kết quả %s", mustJSON(t, lastArg(0)), mustJSON(t, p))
	}

	// sửa không gửi khoá -> patch không có hien_trang; gửi khoá (kể cả rỗng) -> ghi đúng giá trị
	if _, err := svc.UpdateProject(ctx, "DA-1", omap.Of("quyMo", "3 tầng")); err != nil {
		t.Fatal(err)
	}
	if lastPatch := lastArg(1); lastPatch.Has("hien_trang") {
		t.Errorf("sửa không gửi hienTrang mà patch có hien_trang: %s", mustJSON(t, lastPatch))
	}
	for _, v := range []string{"Đất trống", ""} {
		if _, err := svc.UpdateProject(ctx, "DA-1", omap.Of("hienTrang", v)); err != nil {
			t.Fatal(err)
		}
		if got := lastArg(1); !got.Has("hien_trang") || !jsval.StrictEquals(got.Val("hien_trang"), v) {
			t.Errorf("sửa hienTrang %q: patch %s", v, mustJSON(t, got))
		}
	}
}

// Trên qspro_gotest: ghi rồi đọc lại hienTrang qua getProjects / getProject; dự án khác không bị đụng.
func TestHienTrangDB(t *testing.T) {
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
			_, _ = pool.Exec(bg, `delete from projects where project_code like 'ZZ\_U7ht\_%'`)
		}
	})
	us, err := db.Select(bg, "users", database.SelectOpt{Filter: database.Eq("username", "admin") + "&cong_ty_id=not.is.null", Limit: 1, NoScope: true})
	if err != nil || len(us) == 0 {
		t.Fatalf("database thử không có tài khoản admin thuộc công ty: %v", err)
	}
	ctx := ctxOf(omap.Of("uid", us[0].Val("id"), "role", "admin", "congTyId", us[0].Val("cong_ty_id")))
	svc := New(Deps{DB: db, Catalog: &stubCatalog{}, Lines: &stubLines{}})
	a, err := svc.CreateProject(ctx, omap.Of("maDA", "ZZ_U7ht_A", "ten", "ZZ_U7ht dự án A"))
	if err != nil {
		t.Fatal(err)
	}
	if !jsval.StrictEquals(a.Val("hienTrang"), "") {
		t.Errorf("dự án mới: hienTrang = %s", mustJSON(t, a.Val("hienTrang")))
	}
	if _, err := svc.CreateProject(ctx, omap.Of("maDA", "ZZ_U7ht_B", "ten", "ZZ_U7ht dự án B", "hienTrang", "Có sẵn")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateProject(ctx, "ZZ_U7ht_A", omap.Of("hienTrang", "Nhà cấp 4 cũ")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateProject(ctx, "ZZ_U7ht_B", omap.Of("quyMo", "2 tầng")); err != nil {
		t.Fatal(err)
	}
	all, err := svc.GetProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"ZZ_U7ht_A": "Nhà cấp 4 cũ", "ZZ_U7ht_B": "Có sẵn"}
	seen := 0
	for _, p := range all {
		ma := jsval.AsString(jsval.Get(p, "maDA"))
		if w, ok := want[ma]; ok {
			seen++
			if got := jsval.Get(p, "hienTrang"); !jsval.StrictEquals(got, w) {
				t.Errorf("%s: hienTrang = %s, cần %q", ma, mustJSON(t, got), w)
			}
		}
	}
	if seen != 2 {
		t.Errorf("getProjects thấy %d / 2 dự án thử", seen)
	}
	g, err := svc.GetProject(ctx, "ZZ_U7ht_A")
	if err != nil || g == nil || !jsval.StrictEquals(g.Val("hienTrang"), "Nhà cấp 4 cũ") {
		t.Errorf("getProject: %v %s", err, mustJSON(t, g))
	}
}
