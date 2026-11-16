package settings

import (
	"context"
	"os"
	"regexp"
	"strings"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/omap"
)

// fakeRepo: kho trong bộ nhớ, ghi lại các lệnh đã gọi.
type fakeRepo struct {
	rows  []*omap.Map
	calls []string
	err   error // trả cho mọi lệnh khi khác nil
}

func (f *fakeRepo) ListSettings(context.Context) ([]*omap.Map, error) {
	f.calls = append(f.calls, "list")
	return f.rows, f.err
}
func (f *fakeRepo) FindSetting(_ context.Context, k string) ([]*omap.Map, error) {
	f.calls = append(f.calls, "find:"+k)
	if f.err != nil {
		return nil, f.err
	}
	for _, r := range f.rows {
		if r.Val("khoa") == k {
			return []*omap.Map{r}, nil
		}
	}
	return nil, nil
}
func (f *fakeRepo) UpdateSetting(_ context.Context, k string, row *omap.Map) error {
	f.calls = append(f.calls, "update:"+k)
	for i, r := range f.rows {
		if r.Val("khoa") == k {
			f.rows[i] = row
		}
	}
	return f.err
}
func (f *fakeRepo) InsertSetting(_ context.Context, row *omap.Map) error {
	f.calls = append(f.calls, "insert:"+row.Val("khoa").(string))
	f.rows = append(f.rows, row)
	return f.err
}
func (f *fakeRepo) DeleteSetting(_ context.Context, k string) error {
	f.calls = append(f.calls, "delete:"+k)
	out := f.rows[:0]
	for _, r := range f.rows {
		if r.Val("khoa") != k {
			out = append(out, r)
		}
	}
	f.rows = out
	return f.err
}

func newSvc(f *fakeRepo) *Service {
	s := New(Deps{Repo: f})
	s.now = func() string { return "2026-11-12T00:00:00.000Z" }
	return s
}

var superA = &actor.Actor{U: "sa", R: "super"}

func status(err error) int { st, _ := apperr.Status(err); return st }

func TestSaveDefaultValidation(t *testing.T) {
	big := omap.Of("x", strings.Repeat("a", maxValueBytes))
	cases := []struct {
		name, section string
		value         any
		msg           string
	}{
		{"mục sai", "colors", omap.Of("a", 1), "Mục mặc định không hợp lệ: colors"},
		{"mục rỗng", "", omap.Of("a", 1), "Mục mặc định không hợp lệ: "},
		{"chuỗi", "general", "abc", "Giá trị mặc định phải là object"},
		{"số", "general", 1.0, "Giá trị mặc định phải là object"},
		{"mảng", "display", []any{1.0}, "Giá trị mặc định phải là object"},
		{"quá lớn", "appearance", big, "Giá trị mặc định quá lớn (tối đa 64 KB)"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeRepo{}
			_, err := newSvc(f).SaveDefault(context.Background(), superA, c.section, c.value)
			if err == nil || err.Error() != c.msg {
				t.Fatalf("lỗi = %v, muốn %q", err, c.msg)
			}
			if status(err) != 400 {
				t.Errorf("status = %d, muốn 400", status(err))
			}
			if len(f.calls) != 0 {
				t.Errorf("không được chạm kho: %v", f.calls)
			}
		})
	}
}

func TestSaveDefaultUpsertAndDelete(t *testing.T) {
	f := &fakeRepo{}
	s := newSvc(f)
	ctx := context.Background()
	if r, err := s.SaveDefault(ctx, superA, "general", omap.Of("lang", "vi")); err != nil || !r.Val("ok").(bool) {
		t.Fatalf("lưu lần 1: %v %v", r, err)
	}
	if _, err := s.SaveDefault(ctx, superA, "general", omap.Of("lang", "en")); err != nil {
		t.Fatal(err)
	}
	if len(f.rows) != 1 || f.rows[0].Val("gia_tri").(*omap.Map).Val("lang") != "en" || f.rows[0].Val("nguoi_sua") != "sa" ||
		f.rows[0].Val("cap_nhat") != "2026-11-12T00:00:00.000Z" {
		t.Fatalf("dòng sau 2 lần lưu: %v", f.rows)
	}
	want := "find:general,insert:general,find:general,update:general"
	if got := strings.Join(f.calls, ","); got != want {
		t.Errorf("lệnh = %s, muốn %s", got, want)
	}
	// null / thiếu (undefined) = xoá
	for _, v := range []any{nil, omap.New().Val("value")} {
		f.calls = nil
		if _, err := s.SaveDefault(ctx, superA, "general", v); err != nil {
			t.Fatal(err)
		}
		if got := strings.Join(f.calls, ","); got != "delete:general" {
			t.Errorf("value %v: lệnh = %s, muốn delete:general", v, got)
		}
	}
	if len(f.rows) != 0 {
		t.Errorf("còn dòng sau khi xoá: %v", f.rows)
	}
}

func TestGetDefaults(t *testing.T) {
	f := &fakeRepo{rows: []*omap.Map{
		omap.Of("khoa", "display", "gia_tri", omap.Of("density", "compact"), "cap_nhat", "2026-11-12T08:00:00+00:00", "nguoi_sua", "sa2"),
		omap.Of("khoa", "khac", "gia_tri", omap.Of("x", 1.0), "cap_nhat", "2026-11-11T00:00:00+00:00", "nguoi_sua", "z"),
		omap.Of("khoa", "appearance", "gia_tri", omap.Of("theme", "dark"), "cap_nhat", "2026-11-10T00:00:00+00:00", "nguoi_sua", "sa"),
	}}
	r, err := newSvc(f).GetDefaults(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	js, _ := omap.MarshalString(r)
	want := `{"appearance":{"theme":"dark"},"general":null,"display":{"density":"compact"},` +
		`"updatedAt":"2026-11-12T08:00:00+00:00","updatedBy":"sa2"}`
	if js != want {
		t.Errorf("kết quả = %s\nmuốn      %s", js, want)
	}

	r, err = newSvc(&fakeRepo{}).GetDefaults(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if js, _ := omap.MarshalString(r); js != `{"appearance":null,"general":null,"display":null,"updatedAt":null,"updatedBy":null}` {
		t.Errorf("không có dòng: %s", js)
	}
}

func TestMissingTable(t *testing.T) {
	missing := &database.Error{Msg: "DB GET cai_dat_he_thong -> 404 {\"code\":\"PGRST205\"}", Code: "PGRST205", Status: 404}
	r, err := newSvc(&fakeRepo{err: missing}).GetDefaults(context.Background())
	if err != nil {
		t.Fatalf("GET khi chưa migrate phải trả null, gặp %v", err)
	}
	if js, _ := omap.MarshalString(r); js != `{"appearance":null,"general":null,"display":null,"updatedAt":null,"updatedBy":null}` {
		t.Errorf("GET khi chưa migrate: %s", js)
	}
	for _, v := range []any{omap.Of("a", 1.0), nil} {
		_, err = newSvc(&fakeRepo{err: missing}).SaveDefault(context.Background(), superA, "general", v)
		if err == nil || !strings.Contains(err.Error(), apperr.HDMig) || !strings.Contains(err.Error(), "0047_system_settings") {
			t.Errorf("PUT %v khi chưa migrate: %v", v, err)
		}
	}
	// lỗi khác trả nguyên
	other := apperr.New("mất kết nối")
	if _, err = newSvc(&fakeRepo{err: other}).GetDefaults(context.Background()); err != other {
		t.Errorf("lỗi khác bị đổi: %v", err)
	}
}

// Chạy trên qspro_gotest (TEST_DATABASE_URL) đã migrate 0047. Không đụng dòng có sẵn: chỉ ghi khoá ZZ_settings_test ở tầng kho,
// và chỉ thử vòng lưu / đọc / xoá của service trên mục display khi mục đó chưa có dòng.
func TestSystemSettingsDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	t.Cleanup(db.Close)
	ctx := context.Background()
	repo := NewRepository(db)
	const k = "ZZ_settings_test"
	t.Cleanup(func() { _ = repo.DeleteSetting(ctx, k) })

	if err := repo.InsertSetting(ctx, omap.Of("khoa", k, "gia_tri", omap.Of("a", 1.0), "cap_nhat", "2026-11-12T00:00:00.000Z", "nguoi_sua", "t1")); err != nil {
		t.Fatal(err)
	}
	if err := repo.InsertSetting(ctx, omap.Of("khoa", k, "gia_tri", nil, "nguoi_sua", "t1")); database.CodeOf(err) != "23505" {
		t.Errorf("chèn trùng khoá phải lỗi 23505, gặp %v", err)
	}
	if err := repo.UpdateSetting(ctx, k, omap.Of("gia_tri", omap.Of("a", 2.0, "b", omap.Of("c", "d")), "nguoi_sua", "t2")); err != nil {
		t.Fatal(err)
	}
	got, err := repo.FindSetting(ctx, k)
	if err != nil || len(got) != 1 {
		t.Fatalf("tìm: %v %v", got, err)
	}
	rows, err := repo.ListSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var row *omap.Map
	for _, r := range rows {
		if r.Val("khoa") == k {
			row = r
		}
	}
	if row == nil {
		t.Fatalf("không thấy dòng %s trong %v", k, rows)
	}
	if js, _ := omap.MarshalString(row.Val("gia_tri")); js != `{"a":2,"b":{"c":"d"}}` || row.Val("nguoi_sua") != "t2" {
		t.Errorf("dòng sau sửa: %v", row)
	}
	if err := repo.DeleteSetting(ctx, k); err != nil {
		t.Fatal(err)
	}
	if got, _ := repo.FindSetting(ctx, k); len(got) != 0 {
		t.Errorf("còn dòng sau khi xoá: %v", got)
	}

	// vòng service trên mục thật, chỉ khi chưa có dữ liệu
	if co, err := repo.FindSetting(ctx, "display"); err != nil || len(co) > 0 {
		t.Logf("bỏ qua vòng service: display đã có dòng (%v)", err)
		return
	}
	t.Cleanup(func() { _ = repo.DeleteSetting(ctx, "display") })
	s := New(Deps{DB: db})
	if _, err := s.SaveDefault(ctx, superA, "display", omap.Of("density", "compact")); err != nil {
		t.Fatal(err)
	}
	r, err := s.GetDefaults(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if js, _ := omap.MarshalString(r.Val("display")); js != `{"density":"compact"}` {
		t.Errorf("display = %s", js)
	}
	if _, err := s.SaveDefault(ctx, superA, "display", nil); err != nil {
		t.Fatal(err)
	}
	if r, _ = s.GetDefaults(ctx); r.Val("display") != nil {
		t.Errorf("display sau khi xoá = %v", r.Val("display"))
	}
}
