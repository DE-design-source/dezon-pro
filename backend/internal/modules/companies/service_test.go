package companies

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// Giá trị mong đợi trong testdata/*.json sinh từ mã Node thật: xem testdata/gen.js.

func loadGolden(t *testing.T, name string) *omap.Map {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	v, err := omap.Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	return jsval.AsMap(v)
}

func js(t *testing.T, v any) string {
	t.Helper()
	s, err := omap.MarshalString(v)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestAdminUserLower(t *testing.T) {
	for _, c := range jsval.AsArray(loadGolden(t, "golden_pure.json").Val("adminUser")) {
		m := jsval.AsMap(c)
		in := m.Val("in")
		if in == "__undefined__" {
			in = jsval.Undefined
		}
		if got, want := adminUserOf(in), jsval.AsString(m.Val("out")); got != want {
			t.Errorf("adminUser(%s) = %q, Node cho %q", js(t, m.Val("in")), got, want)
		}
	}
}

func TestSlugMa(t *testing.T) {
	for _, c := range jsval.AsArray(loadGolden(t, "golden_pure.json").Val("slug")) {
		m := jsval.AsMap(c)
		got := slugMa(jsval.ToString(jsval.Or(m.Val("ma"), m.Val("ten"))))
		if want := jsval.AsString(m.Val("out")); got != want {
			t.Errorf("slug(%s, %s) = %q, Node cho %q", js(t, m.Val("ma")), js(t, m.Val("ten")), got, want)
		}
	}
}

func TestCtOut(t *testing.T) {
	for _, c := range jsval.AsArray(loadGolden(t, "golden_pure.json").Val("ctOut")) {
		m := jsval.AsMap(c)
		if got, want := js(t, ctOut(jsval.AsMap(m.Val("row")))), js(t, m.Val("out")); got != want {
			t.Errorf("ctOut(%s)\n Go:   %s\n Node: %s", js(t, m.Val("row")), got, want)
		}
	}
}

func TestTodayVNAndHetHan(t *testing.T) {
	g := loadGolden(t, "golden_pure.json")
	s := &Service{}
	at := func(ms any) { s.now = func() time.Time { return jsval.FromMs(jsval.ToNumber(ms)) } }
	for _, c := range jsval.AsArray(g.Val("todayVN")) {
		m := jsval.AsMap(c)
		at(m.Val("now"))
		if got, want := s.todayVN(), jsval.AsString(m.Val("out")); got != want {
			t.Errorf("todayVN(%s) = %q, Node cho %q", js(t, m.Val("now")), got, want)
		}
	}
	for _, c := range jsval.AsArray(g.Val("hetHan")) {
		m := jsval.AsMap(c)
		at(m.Val("now"))
		if got, want := s.HetHan(jsval.AsMap(m.Val("ct"))), m.Val("out") == true; got != want {
			t.Errorf("hetHan(%s) lúc %s = %v, Node cho %v", js(t, m.Val("ct")), js(t, m.Val("now")), got, want)
		}
	}
}

func TestTenantTablesOrder(t *testing.T) {
	if len(tenantTablesOrder) != len(database.TenantTables) {
		t.Fatalf("tenantTablesOrder có %d bảng, database.TenantTables có %d", len(tenantTablesOrder), len(database.TenantTables))
	}
	seen := map[string]bool{}
	for _, tb := range tenantTablesOrder {
		if !database.TenantTables[tb] || seen[tb] {
			t.Errorf("bảng lạ hoặc lặp: %s", tb)
		}
		seen[tb] = true
	}
	if tenantTablesOrder[len(tenantTablesOrder)-1] != "users" {
		t.Error("users phải xoá sau cùng")
	}
}

// ───────────── giả lập module users ─────────────

type auditStub struct {
	adminID any
	calls   []any
}

func (s *auditStub) Audit(_ context.Context, a *actor.Actor, action, detail string, congTyID any) {
	uid := a.UID
	if s.adminID != nil && jsval.StrictEquals(uid, s.adminID) {
		uid = "<admin>"
	}
	s.calls = append(s.calls, omap.Of("action", action, "detail", detail, "uid", uid))
	if congTyID != nil {
		panic("companies không bao giờ truyền congTyID cho audit")
	}
}

type fmtStub struct{}

// UserOut: chép userOut (A:73-77) để so danh sách tài khoản với bản Node.
func (fmtStub) UserOut(r *omap.Map) *omap.Map {
	return omap.Of("id", r.Val("id"), "username", r.Val("username"), "hoTen", jsval.Or(r.Val("ho_ten"), ""),
		"role", jsval.Or(r.Val("role"), "staff"), "perms", fmtStub{}.PermsArr(r.Val("perms")),
		"active", !jsval.StrictEquals(r.Val("active"), false), "createdAt", r.Val("created_at"), "lastLogin", r.Val("last_login"),
		"congTyId", jsval.Or(r.Val("cong_ty_id"), nil), "email", jsval.Or(r.Val("email"), ""), "phongBan", jsval.Or(r.Val("phong_ban"), ""))
}

func (fmtStub) PermsArr(v any) []any { return splitTrim(v) }

type creatorStub struct {
	db    *database.DB
	calls []*omap.Map
	err   error
}

// AdminCreateUser giả: ghi lại data và (khi có db) chèn 1 dòng users tối thiểu để các bước sau thấy tài khoản.
func (s *creatorStub) AdminCreateUser(ctx context.Context, _ *actor.Actor, data *omap.Map) (*omap.Map, error) {
	s.calls = append(s.calls, data.Clone())
	if s.err != nil {
		return nil, s.err
	}
	if s.db == nil {
		return omap.Of("username", data.Val("username")), nil
	}
	res, err := s.db.InsertOne(ctx, "users", omap.Of("username", data.Val("username"), "ho_ten", jsval.StrOr(data.Val("hoTen"), ""),
		"email", jsval.StrOr(data.Val("email"), ""), "password_hash", "x", "role", "admin", "perms", "", "active", true,
		"cong_ty_id", data.Val("congTyId")), database.Opt{NoScope: true})
	if err != nil {
		return nil, err
	}
	return fmtStub{}.UserOut(res[0]), nil
}

// ───────────── test đơn vị với repository giả ─────────────

type fakeRepo struct {
	Repository
	probes   int
	probeErr error
	inserted *omap.Map
	removed  []string
}

func (f *fakeRepo) ProbeShareCol(context.Context) error { f.probes++; return f.probeErr }
func (f *fakeRepo) CongTyByMa(context.Context, string) ([]*omap.Map, error) {
	return nil, nil
}
func (f *fakeRepo) CongTyByID(_ context.Context, id any) ([]*omap.Map, error) {
	return []*omap.Map{omap.Of("id", id, "ten", "Cty giả")}, nil
}
func (f *fakeRepo) UserIDsByName(context.Context, string) ([]*omap.Map, error) { return nil, nil }
func (f *fakeRepo) InsertCongTy(_ context.Context, row *omap.Map) ([]*omap.Map, error) {
	f.inserted = row
	return []*omap.Map{omap.Assign(omap.Of("id", "ID-1"), row)}, nil
}
func (f *fakeRepo) RemoveTenantRows(_ context.Context, table, filter string) error {
	f.removed = append(f.removed, table+"?"+filter)
	if table == "du_an" {
		return errors.New("bảng chưa có cột") // lỗi từng bảng phải bị nuốt
	}
	return nil
}
func (f *fakeRepo) RemoveCongTy(_ context.Context, id any) error {
	f.removed = append(f.removed, "cong_ty?"+database.Eq("id", id))
	return nil
}

var super = &actor.Actor{UID: "u1", U: "sa", R: "super"}

func TestShareColProbeOnceAndCreateRefuses(t *testing.T) {
	repo := &fakeRepo{probeErr: errors.New("42703")}
	s := &Service{repo: repo, now: time.Now, auditor: &auditStub{}, creator: &creatorStub{}}
	for i := 0; i < 2; i++ {
		_, err := s.CreateCongTy(context.Background(), super, omap.Of("ten", "A", "dungSpDezon", true))
		if err == nil || err.Error() != msgNoShareCol {
			t.Fatalf("lần %d: muốn lỗi thiếu cột, được %v", i, err)
		}
	}
	// thiếu cột: tắt (falsy) thì bỏ qua không lỗi, patch rỗng -> trả getCongTy
	if _, err := s.UpdateCongTy(context.Background(), super, "ID-1", omap.Of("dungSpDezon", false)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateCongTy(context.Background(), super, "ID-1", omap.Of("dungSpDezon", 1.0)); err == nil || err.Error() != msgNoShareCol {
		t.Fatalf("muốn lỗi thiếu cột, được %v", err)
	}
	if repo.probes != 1 {
		t.Errorf("dò cột %d lần, Node chỉ dò 1 lần rồi giữ kết quả", repo.probes)
	}
	if repo.inserted != nil {
		t.Error("không được chèn công ty khi thiếu cột")
	}
}

// db=nil nên chỉ kiểm thứ tự chèn; bản Go chạy thật bọc s.tx, lỗi thì không còn công ty mồ côi (D-13, xem tx_db_test.go).
func TestCreateCongTyOwnerDataAndOrphan(t *testing.T) {
	repo := &fakeRepo{}
	cr := &creatorStub{err: errors.New("Mật khẩu tối thiểu 4 ký tự")}
	au := &auditStub{}
	s := &Service{repo: repo, now: time.Now, auditor: au, creator: cr}
	_, err := s.CreateCongTy(context.Background(), super, omap.Of("ten", " Cty Ê ", "adminUser", " Chủ.A ", "adminPass", "abc",
		"adminEmail", "", "email", "c@x.vn", "hanDung", "2030-01-01"))
	if err == nil || err.Error() != "Mật khẩu tối thiểu 4 ký tự" {
		t.Fatalf("lỗi của adminCreateUser phải đi ra nguyên văn, được %v", err)
	}
	if repo.inserted == nil {
		t.Fatal("công ty phải được chèn TRƯỚC khi tạo tài khoản chủ (A:146-152)")
	}
	if len(au.calls) != 0 {
		t.Error("tạo tài khoản chủ lỗi thì không ghi audit create_company")
	}
	want := `{"username":"chủ.a","password":"abc","role":"admin","congTyId":"ID-1","hoTen":"Quản trị Cty Ê","email":"c@x.vn"}`
	if got := js(t, cr.calls[0]); got != want {
		t.Errorf("data gửi adminCreateUser\n Go:  %s\n cần: %s", got, want)
	}
	wantRow := `{"ten":"Cty Ê","ma":"cty-e","logo_url":"","email":"c@x.vn","sdt":"","tinh_nang":"","gioi_han_user":10,"active":true,"han_dung":"2030-01-01","ghi_chu":""}`
	if got := js(t, repo.inserted); got != wantRow {
		t.Errorf("dòng chèn cong_ty\n Go:  %s\n cần: %s", got, wantRow)
	}
}

func TestNilActorTypeError(t *testing.T) {
	s := &Service{}
	ctx := context.Background()
	const want = "Cannot read properties of null (reading 'r')"
	errs := []error{}
	_, e := s.ListCongTy(ctx, nil)
	errs = append(errs, e)
	_, e = s.CreateCongTy(ctx, nil, nil)
	errs = append(errs, e)
	_, e = s.ListCongTyUsers(ctx, nil, "C1")
	errs = append(errs, e)
	_, e = s.CreateCongTyUser(ctx, nil, "C1", nil)
	errs = append(errs, e)
	_, e = s.UpdateCongTy(ctx, nil, "C1", nil)
	errs = append(errs, e)
	_, e = s.DeleteCongTy(ctx, nil, "C1")
	errs = append(errs, e)
	for i, e := range errs {
		if e == nil || e.Error() != want {
			t.Errorf("hàm %d: muốn %q, được %v", i, want, e)
		}
	}
}

func TestCreateCongTyUserData(t *testing.T) {
	cr := &creatorStub{}
	s := &Service{creator: cr}
	ctx := context.Background()
	if _, err := s.CreateCongTyUser(ctx, &actor.Actor{R: "admin"}, "C1", nil); err == nil || err.Error() != msgSuperOnly {
		t.Fatalf("muốn %q, được %v", msgSuperOnly, err)
	}
	in := omap.Of("username", "a", "congTyId", "bị đè", "role", "staff")
	for _, c := range []struct {
		id, data any
		want     string
	}{
		{"C1", in, `{"username":"a","congTyId":"C1","role":"staff"}`},
		{"C1", nil, `{"congTyId":"C1"}`},
		{jsval.Undefined, jsval.Undefined, `{}`},
		// giá trị mong đợi lấy từ Node: Object.assign({}, data || {}, {congTyId})
		{7.0, "aé", `{"0":"a","1":"é","congTyId":7}`},
		{7.0, []any{"x", nil, omap.Of("a", 1.0)}, `{"0":"x","1":null,"2":{"a":1},"congTyId":7}`},
		{7.0, 5.0, `{"congTyId":7}`},
		{7.0, true, `{"congTyId":7}`},
	} {
		if _, err := s.CreateCongTyUser(ctx, super, c.id, c.data); err != nil {
			t.Fatal(err)
		}
		if got := js(t, cr.calls[len(cr.calls)-1]); got != c.want {
			t.Errorf("data = %s, cần %s", got, c.want)
		}
	}
	if js(t, in) != `{"username":"a","congTyId":"bị đè","role":"staff"}` {
		t.Error("không được sửa object của client (Object.assign({}, data, ...))")
	}
}

func TestDeleteCongTyOrder(t *testing.T) {
	repo := &fakeRepo{}
	au := &auditStub{}
	s := &Service{repo: repo, now: time.Now, auditor: au}
	res, err := s.DeleteCongTy(context.Background(), super, "a b")
	if err != nil {
		t.Fatal(err)
	}
	if got := js(t, res); got != `{"ok":true,"ten":"Cty giả"}` {
		t.Errorf("kết quả %s", got)
	}
	// thứ tự Object.keys(TENANT_TABLES) của supa.js:34-40 + 2 bảng Kinh doanh (chỉ bản Go, con trước cha), users sau cùng, rồi mới tới cong_ty
	want := "du_an,db_bao_gia,khai_toan,db_san_pham,db_san_pham_history,don_mua_hang,chi_tiet_mua_hang,notifications,delete_requests," +
		"audit_log,sp_combo,sp_yeu_thich,cong_tac,de_xuat,chi_tiet_de_xuat_ck,chi_tiet_de_xuat_tt,cong_tac_history,du_an_data,cai_dat_cong_ty,kd_cham_soc,kd_khach_hang," +
		"tk_binh_luan,tk_cong_viec,tk_giai_doan,tk_thau_phu,tk_thanh_vien,tk_du_an,users,cong_ty"
	var got []string
	for i, r := range repo.removed {
		tb, f, _ := strings.Cut(r, "?")
		got = append(got, tb)
		if i < len(repo.removed)-1 && f != "cong_ty_id=eq.a%20b" {
			t.Errorf("bộ lọc của %s = %q", tb, f)
		}
	}
	if strings.Join(got, ",") != want {
		t.Errorf("thứ tự xoá\n Go:  %s\n cần: %s", strings.Join(got, ","), want)
	}
	if js(t, au.calls) != `[{"action":"delete_company","detail":"Xoá công ty Cty giả và toàn bộ dữ liệu","uid":"u1"}]` {
		t.Errorf("audit %s", js(t, au.calls))
	}
}

// ───────────── đối chiếu với Node trên database thử ─────────────

var (
	reTS1 = regexp.MustCompile(`"\d{4}-\d\d-\d\dT[\d:.]+\+00:00"`)
	reTS2 = regexp.MustCompile(`\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?\+00`)
)

type differ struct {
	t      *testing.T
	golden *omap.Map
	labels [][2]string
	seen   map[string]bool
}

func (d *differ) label(id any, name string) {
	d.labels = append(d.labels, [2]string{jsval.ToString(id), name})
}

func (d *differ) norm(v any) string {
	s := js(d.t, v)
	for _, p := range d.labels {
		s = strings.ReplaceAll(s, p[0], p[1])
	}
	return reTS2.ReplaceAllString(reTS1.ReplaceAllString(s, `"<ts>"`), "<ts>")
}

// check so 1 bước với bản Node: {ok: kết quả} hoặc {err: thông báo}.
func (d *differ) check(name string, out any, err error) {
	d.t.Helper()
	var r *omap.Map
	if err != nil {
		r = omap.Of("err", err.Error())
	} else {
		r = omap.Of("ok", out)
	}
	d.raw(name, r)
}

func (d *differ) raw(name string, v any) {
	d.t.Helper()
	d.seen[name] = true
	if !d.golden.Has(name) {
		d.t.Errorf("%s: không có trong golden_db.json", name)
		return
	}
	if got, want := d.norm(v), js(d.t, d.golden.Val(name)); got != want {
		d.t.Errorf("%s\n Go:   %s\n Node: %s", name, got, want)
	}
}

func TestDiffDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !strings.Contains(url, "/qspro_gotest") {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	defer db.Close()
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	bg := context.Background()
	sweep := func() {
		for _, q := range []string{
			"delete from audit_logs where username like 'zz_companies%'",
			"delete from notifications where company_id in (select id from companies where code like 'zz-companies%')",
			"delete from users where username like 'zz_companies%'",
			"delete from companies where code like 'zz-companies%'",
		} {
			if _, err := pool.Exec(bg, q); err != nil {
				t.Errorf("dọn dữ liệu thử: %v", err)
			}
		}
	}
	sweep()
	defer sweep()

	one := func(table, filter string) *omap.Map {
		rows, err := db.Select(bg, table, database.SelectOpt{Filter: filter, Limit: 1, NoScope: true})
		if err != nil || len(rows) == 0 {
			t.Fatalf("không đọc được %s %s: %v", table, filter, err)
		}
		return rows[0]
	}
	admin := one("users", database.Eq("username", "admin"))
	dezon := one("cong_ty", database.Eq("ma", "dezon"))
	ctx := tenant.With(bg, tenant.Ctx{UID: admin.Val("id"), Role: "super", CongTyID: dezon.Val("id")})
	SA := &actor.Actor{UID: admin.Val("id"), U: "zz_companies_u", R: "super", CT: dezon.Val("id")}
	AD := func(ct any) *actor.Actor {
		return &actor.Actor{UID: admin.Val("id"), U: "zz_companies_u", R: "admin", CT: ct}
	}
	ST := &actor.Actor{UID: admin.Val("id"), U: "zz_companies_u", R: "staff", CT: dezon.Val("id")}
	const zero = "00000000-0000-0000-0000-000000000000"
	U := jsval.Undefined

	au := &auditStub{adminID: admin.Val("id")}
	cr := &creatorStub{db: db}
	s := New(Deps{DB: db, UserCreator: cr, UserFormatter: fmtStub{}, Auditor: au})
	d := &differ{t: t, golden: loadGolden(t, "golden_db.json"), seen: map[string]bool{}}

	created := func(name, lbl string, data any) any {
		c, err := s.CreateCongTy(ctx, SA, data)
		if err == nil {
			d.label(c.Val("id"), lbl)
		}
		d.check(name, c, err)
		if c == nil {
			t.Fatalf("%s: không tạo được công ty: %v", name, err)
		}
		return c.Val("id")
	}

	{
		r, err := s.ListCongTy(ctx, AD(dezon.Val("id")))
		d.check("s01_list_admin", r, err)
	}
	{
		all, err := s.ListCongTy(ctx, SA)
		out := []any{}
		for _, c := range all {
			m := jsval.AsMap(c)
			switch m.Val("ma") {
			case "dezon", "b-123", "decox-basic":
				out = append(out, m.Clone().Set("soUser", jsval.TypeOf(m.Val("soUser"))))
			}
		}
		d.check("s02_list_super", out, err)
	}
	{
		r, err := s.CreateCongTy(ctx, SA, nil)
		d.check("s03a_create_null", r, err)
		r, err = s.CreateCongTy(ctx, SA, omap.Of("ten", "   "))
		d.check("s03b_create_blank", r, err)
		r, err = s.CreateCongTy(ctx, AD(dezon.Val("id")), omap.Of("ten", "ZZ_companies X"))
		d.check("s03c_create_admin", r, err)
		r, err = s.CreateCongTy(ctx, SA, "abc")
		d.check("s03d_create_string", r, err)
	}
	ct1 := created("s04_create_full", "<CT1>", omap.Of("ten", "  ZZ_companies Công Ty Đỗ Ánh #1 ", "email", "a@zz.vn", "sdt", "0909",
		"logoUrl", "http://x/l.png", "tinhNang", []any{"boc", nil, " duan "}, "gioiHanUser", "7", "active", false,
		"hanDung", "2030-01-02", "ghiChu", "ghi chú", "dungSpDezon", true, "mauChinh", "#fff"))
	{
		r, err := s.CreateCongTy(ctx, SA, omap.Of("ten", "zz companies cong ty do anh 1"))
		d.check("s05_create_dup", r, err)
	}
	ct2 := created("s06_create_ma", "<CT2>", omap.Of("ten", "ZZ_companies Hai", "ma", "ZZ_companies_Mã 2", "tinhNang", "x, y",
		"gioiHanUser", 0.0, "hanDung", "", "active", nil, "email", 5.0, "logoUrl", 0.0, "dungSpDezon", "true"))
	{
		r, err := s.CreateCongTy(ctx, SA, omap.Of("ten", "ZZ_companies Ba", "adminUser", " Admin ", "adminPass", "secret1"))
		d.check("s07_create_dup_user", r, err)
		rows, err := db.Select(bg, "cong_ty", database.SelectOpt{Filter: database.Eq("ma", "zz-companies-ba"), NoScope: true})
		d.check("s07b_orphan_check", float64(len(rows)), err)
	}
	ct3 := created("s08_create_with_owner", "<CT3>", omap.Of("ten", "ZZ_companies Bốn", "adminUser", " ZZ_Companies_Adm ",
		"adminPass", "secret1", "adminHoTen", "", "email", "e@zz.vn"))
	if len(cr.calls) != 1 {
		t.Fatalf("adminCreateUser được gọi %d lần, cần đúng 1", len(cr.calls))
	}
	if got, want := d.norm(cr.calls[0]), `{"username":"zz_companies_adm","password":"secret1","role":"admin","congTyId":"<CT3>","hoTen":"Quản trị ZZ_companies Bốn","email":"e@zz.vn"}`; got != want {
		t.Errorf("data gửi adminCreateUser\n Go:  %s\n cần: %s", got, want)
	}
	created("s08b_owner_no_pass", "<CT5>", omap.Of("ten", "ZZ_companies Năm", "adminUser", "zz_companies_nopass", "adminPass", "",
		"gioiHanUser", "abc", "hanDung", 0.0))
	if len(cr.calls) != 1 {
		t.Error("adminPass rỗng thì không tạo tài khoản chủ")
	}
	{
		rows, err := s.ListCongTyUsers(ctx, SA, ct3)
		out := make([]any, len(rows))
		for i, r := range rows {
			u := jsval.AsMap(r)
			o := omap.New()
			for _, k := range []string{"username", "hoTen", "role", "perms", "active", "congTyId", "email", "phongBan"} {
				o.Set(k, u.Val(k))
			}
			out[i] = o
		}
		d.check("s09_users_ct3", out, err)
		rows, err = s.ListCongTyUsers(ctx, SA, ct1)
		d.check("s09b_users_ct1", rows, err)
		rows, err = s.ListCongTyUsers(ctx, AD(ct3), ct3)
		d.check("s09c_users_admin", rows, err)
		rows, err = s.ListCongTyUsers(ctx, SA, U)
		d.check("s09d_users_undefined", rows, err)
		rows, err = s.ListCongTyUsers(ctx, SA, "not-a-uuid")
		d.check("s09e_users_bad_id", rows, err)
	}
	get := func(name string, id any) {
		r, err := s.GetCongTy(ctx, id)
		d.check(name, r, err)
	}
	get("s10a_get", ct1)
	get("s10b_get_null", nil)
	get("s10c_get_missing", zero)
	get("s10d_get_zero", 0.0)

	upd := func(name string, a *actor.Actor, id, data any) {
		r, err := s.UpdateCongTy(ctx, a, id, data)
		d.check(name, r, err)
	}
	upd("s11a_upd_staff", ST, ct1, omap.Of("ten", "ZZ_companies x"))
	upd("s11b_upd_other", AD(ct2), ct1, omap.Of("ten", "ZZ_companies x"))
	upd("s11b2_upd_admin_noct", AD(nil), ct1, omap.Of("ten", "ZZ_companies x"))
	upd("s11c_upd_owner", AD(ct1), ct1, omap.Of("ten", "ZZ_companies Một đổi", "logoUrl", "", "mauChinh", "#123", "email", nil, "sdt", 123.0,
		"gioiHanUser", 99.0, "active", true, "ghiChu", "bị bỏ qua", "tinhNang", "bo", "hanDung", "2040-01-01", "dungSpDezon", false))
	upd("s11d_upd_super", SA, ct1, omap.Of("tinhNang", []any{"a", "b", nil, 3.0}, "gioiHanUser", "abc", "active", 0.0, "dungSpDezon", false,
		"hanDung", "", "ghiChu", 5.0))
	upd("s11e_upd_super2", SA, ct1, omap.Of("tinhNang", "k1,k2", "gioiHanUser", "12", "active", "yes", "dungSpDezon", 1.0,
		"hanDung", "2031-12-31", "email", "m@zz.vn"))
	upd("s11f_upd_empty", SA, ct1, omap.New())
	upd("s11g_upd_null", SA, ct1, nil)
	upd("s11h_upd_missing", SA, zero, omap.Of("ten", "ZZ_companies y"))
	upd("s11i_upd_owner_empty", AD(ct1), ct1, omap.Of("gioiHanUser", 5.0))
	upd("s11j_upd_bad_id", SA, "not-a-uuid", omap.Of("ten", "ZZ_companies z"))
	upd("s11k_upd_bad_date", SA, ct1, omap.Of("hanDung", "không phải ngày"))
	upd("s11l_upd_neg_limit", SA, ct1, omap.Of("gioiHanUser", -3.0))
	upd("s11m_upd_undefined_id", SA, U, omap.Of("ten", "ZZ_companies u"))
	get("s11z_final", ct1)

	del := func(name string, a *actor.Actor, id any) {
		r, err := s.DeleteCongTy(ctx, a, id)
		d.check(name, r, err)
	}
	del("s12a_del_admin", AD(ct3), ct3)
	del("s12b_del_missing", SA, zero)
	del("s12c_del_undefined", SA, U)
	del("s12d_del_bad_id", SA, "not-a-uuid")
	count := func(id any) (*omap.Map, error) {
		o := omap.New()
		for _, tb := range []string{"users", "notifications", "audit_log"} {
			rows, err := db.Select(bg, tb, database.SelectOpt{Filter: database.Eq("cong_ty_id", id), NoScope: true})
			if err != nil {
				return nil, err
			}
			o.Set(tb, float64(len(rows)))
		}
		rows, err := db.Select(bg, "cong_ty", database.SelectOpt{Filter: database.Eq("id", id), NoScope: true})
		if err != nil {
			return nil, err
		}
		return o.Set("cong_ty", float64(len(rows))), nil
	}
	{
		u := one("users", database.Eq("cong_ty_id", ct3))
		no := database.Opt{NoScope: true}
		if _, err := db.InsertOne(bg, "notifications", omap.Of("user_id", u.Val("id"), "kind", "zz", "title", "ZZ_companies", "body", "",
			"ref_id", nil, "is_read", false, "cong_ty_id", ct3), no); err != nil {
			t.Fatal(err)
		}
		if _, err := db.InsertOne(bg, "audit_log", omap.Of("user_id", nil, "username", "zz_companies_child", "action", "zz", "detail", "",
			"cong_ty_id", ct3), no); err != nil {
			t.Fatal(err)
		}
		r, err := count(ct3)
		d.check("s12e_children", r, err)
	}
	del("s12f_del_ct3", SA, ct3)
	{
		r, err := count(ct3)
		d.check("s12g_after", r, err)
	}
	del("s12h_del_ct2", SA, ct2)
	del("s12i_del_ct1", SA, ct1)
	del("s12j_del_again", SA, ct1)

	d.raw("audit", au.calls)
	for _, k := range d.golden.Keys() {
		if !d.seen[k] {
			t.Errorf("bước %s của bản Node chưa được chạy bên Go", k)
		}
	}
}
