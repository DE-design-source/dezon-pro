package access

import (
	"context"
	"sort"
	"strings"
	"testing"

	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/reqcache"
)

// ---------- kho giả ----------

type fakeRepo struct {
	users     map[string]*omap.Map
	companies map[string]*omap.Map
	grants    map[string]*omap.Map // "<công ty>|<uid>" (uid "" = trần công ty)
	calls     []string
}

func newFake() *fakeRepo {
	return &fakeRepo{users: map[string]*omap.Map{}, companies: map[string]*omap.Map{}, grants: map[string]*omap.Map{}}
}

func (f *fakeRepo) user(id, role, perms, ct string) *fakeRepo {
	var c any
	if ct != "" {
		c = ct
	}
	f.users[id] = omap.Of("id", id, "username", "u_"+id, "role", role, "perms", perms, "cong_ty_id", c)
	return f
}
func (f *fakeRepo) company(id, tinhNang string) *fakeRepo {
	f.companies[id] = omap.Of("id", id, "tinh_nang", tinhNang)
	return f
}
func (f *fakeRepo) grant(ct, uid string, g *omap.Map, by string) *fakeRepo {
	var b any
	if by != "" {
		b = by
	}
	f.grants[ct+"|"+uid] = omap.Of("quyen", g, "nguoi_cap", b, "nguoi_sua", "x", "cap_nhat", "t")
	return f
}

func (f *fakeRepo) UserByID(_ context.Context, id string) (*omap.Map, error) { return f.users[id], nil }
func (f *fakeRepo) CompanyByID(_ context.Context, id string) (*omap.Map, error) {
	return f.companies[id], nil
}
func (f *fakeRepo) GrantRow(_ context.Context, ct, uid string) (*omap.Map, error) {
	return f.grants[ct+"|"+uid], nil
}
func (f *fakeRepo) SaveGrant(_ context.Context, ct, uid string, row *omap.Map) error {
	f.calls = append(f.calls, "save:"+ct+"|"+uid)
	if cur := f.grants[ct+"|"+uid]; cur != nil { // như UPDATE: chỉ ghi các cột gửi lên
		cur = cur.Clone()
		for _, k := range row.Keys() {
			cur.Set(k, row.Val(k))
		}
		row = cur
	}
	f.grants[ct+"|"+uid] = row
	return nil
}
func (f *fakeRepo) GrantsBy(_ context.Context, ct, by string) ([]*omap.Map, error) {
	keys := make([]string, 0, len(f.grants))
	for k := range f.grants {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []*omap.Map{}
	for _, k := range keys {
		c, uid, _ := strings.Cut(k, "|")
		if r := f.grants[k]; c == ct && uid != "" && r.Val("nguoi_cap") == by {
			out = append(out, omap.Of("tai_khoan_id", uid, "quyen", r.Val("quyen")))
		}
	}
	return out, nil
}
func (f *fakeRepo) DeleteGrant(_ context.Context, ct, uid string) error {
	f.calls = append(f.calls, "delete:"+ct+"|"+uid)
	delete(f.grants, ct+"|"+uid)
	return nil
}

func newSvc(f *fakeRepo) *Service {
	s := New(Deps{Repo: f})
	s.now = func() string { return "2026-11-20T00:00:00.000Z" }
	return s
}

// g dựng grants từ chuỗi "module.tab:act,act;module.tab:act".
func g(spec string) *omap.Map {
	out := omap.New()
	if spec == "" {
		return out
	}
	for _, part := range strings.Split(spec, ";") {
		key, acts, _ := strings.Cut(part, ":")
		m, t, _ := strings.Cut(key, ".")
		mo, _ := out.Val(m).(*omap.Map)
		if mo == nil {
			mo = omap.New()
			out.Set(m, mo)
		}
		arr := []any{}
		for _, a := range strings.Split(acts, ",") {
			arr = append(arr, a)
		}
		mo.Set(t, arr)
	}
	return out
}

func js(t *testing.T, v any) string {
	t.Helper()
	b, err := omap.MarshalString(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func status(err error) int { st, _ := apperr.Status(err); return st }

var (
	superA = &actor.Actor{UID: "s1", U: "sa", R: "super"}
	adminA = &actor.Actor{UID: "a1", U: "ad", R: "admin", CT: "c1"}
	staffA = &actor.Actor{UID: "u1", U: "nv", R: "staff", CT: "c1"}
)

// ---------- danh mục ----------

func TestCatalog(t *testing.T) {
	want := []string{"newsfeed", "chat", "marketing", "kinhdoanh", "thietke", "thicong", "hr", "taichinh", "qs", "bim", "muahang",
		"sanxuat", "it", "rd", "banlamviec", "lich", "wiki"}
	var got []string
	for _, m := range cat.Modules {
		got = append(got, m.Key)
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("module = %v", got)
	}
	qs := []string{}
	for _, tb := range modIdx["qs"].Tabs {
		qs = append(qs, tb.Key)
	}
	if strings.Join(qs, ",") != "dash,boc,chiphi,export,muahang,duan,sanpham,import,dsduan,dsncc,dsntk" {
		t.Errorf("tab QS = %v", qs)
	}
	hr := []string{}
	for _, tb := range modIdx["hr"].Tabs {
		hr = append(hr, tb.Key)
	}
	if strings.Join(hr, ",") != "employees,org,attendance,payroll,recruit,performance,security,admin" {
		t.Errorf("tab HR = %v", hr)
	}
	out := js(t, newSvc(newFake()).CatalogOut())
	if !strings.HasPrefix(out, `{"actions":[{"key":"view","label":"Xem"},{"key":"create","label":"Tạo"}`) ||
		!strings.Contains(out, `{"key":"dash","label":"Bảng điều khiển","actions":["view","export"]}`) {
		t.Errorf("catalog = %.300s", out)
	}
}

// ---------- tập quyền ----------

func TestExpandStarAndUnsupported(t *testing.T) {
	// "*" áp cho mọi tab (bỏ thao tác tab không hỗ trợ), hợp với ô riêng của tab; khoá lạ bị bỏ qua
	s := expand(g("qs.*:view;qs.boc:edit,approve;qs.lạ:view;lạ.x:view"))
	if got := js(t, s.Out().Val("qs")); got !=
		`{"dash":["view"],"boc":["view","edit"],"chiphi":["view"],"export":["view"],"muahang":["view"],"duan":["view"],"sanpham":["view"],"import":["view"],"dsduan":["view"],"dsncc":["view"],"dsntk":["view"]}` {
		t.Errorf("qs = %s", got)
	}
	if s.Out().Len() != 1 {
		t.Errorf("module lạ không được vào: %s", js(t, s.Out()))
	}
	if expand(nil).Out().Len() != 0 || expand("x").Out().Len() != 0 {
		t.Error("giá trị không phải object = rỗng")
	}
}

func TestIntersectAndSubset(t *testing.T) {
	a := expand(g("qs.boc:view,edit,delete;hr.*:view,edit"))
	b := expand(g("qs.boc:view,delete;hr.employees:view;chat.main:view"))
	if got := js(t, intersect(a, b).Out()); got != `{"hr":{"employees":["view"]},"qs":{"boc":["view","delete"]}}` {
		t.Errorf("giao = %s", got)
	}
	if got := js(t, intersect(a, b, Set{}).Out()); got != `{}` {
		t.Errorf("giao với rỗng = %s", got)
	}
	if _, _, _, bad := firstOutside(b, a); !bad {
		t.Error("b có chat mà a không có: phải vượt")
	}
	m, tb, act, bad := firstOutside(expand(g("qs.boc:view,export")), a)
	if !bad || m != "qs" || tb != "boc" || act != "export" {
		t.Errorf("vượt = %s %s %s %v", m, tb, act, bad)
	}
	if _, _, _, bad := firstOutside(intersect(a, b), a); bad {
		t.Error("giao luôn là tập con")
	}
	if _, _, _, bad := firstOutside(fullSet(), fullSet()); bad {
		t.Error("full ⊆ full")
	}
}

func TestParseGrants(t *testing.T) {
	// thứ tự danh mục, "*" trước, bỏ trùng, bỏ ô rỗng
	ok, err := parseGrants(omap.Of("qs", omap.Of("boc", []any{"edit", "view", "view"}, "*", []any{"view"}),
		"chat", omap.Of("main", []any{}), "hr", omap.Of("employees", []any{"approve"})))
	if err != nil {
		t.Fatal(err)
	}
	if got := js(t, ok); got != `{"hr":{"employees":["approve"]},"qs":{"*":["view"],"boc":["view","edit"]}}` {
		t.Errorf("chuẩn hoá = %s", got)
	}
	cases := []struct {
		v   any
		msg string
	}{
		{"x", msgShape},
		{[]any{}, msgShape},
		{omap.Of("lạ", omap.New()), "Phân hệ không có trong danh mục quyền: lạ"},
		{omap.Of("qs", "x"), msgShape},
		{omap.Of("qs", omap.Of("lạ", []any{"view"})), "Tab không có trong phân hệ QS: lạ"},
		{omap.Of("qs", omap.Of("boc", "view")), msgShape},
		{omap.Of("qs", omap.Of("boc", []any{"fly"})), "Thao tác không hợp lệ: fly"},
		{omap.Of("qs", omap.Of("boc", []any{1.0})), "Thao tác không hợp lệ: 1"},
		{omap.Of("qs", omap.Of("dash", []any{"edit"})), "Thao tác Sửa không áp dụng cho QS > Bảng điều khiển"},
		{omap.Of("chat", omap.Of("*", []any{"approve"})), "Thao tác Duyệt không áp dụng cho Chat > Mọi tab"},
	}
	for _, c := range cases {
		_, err := parseGrants(c.v)
		if err == nil || err.Error() != c.msg || status(err) != 400 {
			t.Errorf("%v: lỗi = %v (%d), muốn %q", js(t, c.v), err, status(err), c.msg)
		}
	}
}

// ---------- cách cũ ----------

func TestLegacyCompany(t *testing.T) {
	if _, _, _, bad := firstOutside(fullSet(), legacyCompany("")); bad {
		t.Error("tính năng rỗng = mọi thứ")
	}
	if _, _, _, bad := firstOutside(fullSet(), legacyCompany(" , ")); bad {
		t.Error("chỉ dấu phẩy = rỗng = mọi thứ")
	}
	s := legacyCompany("boc, hr,sanpham")
	out := s.Out()
	if got := js(t, out.Val("qs")); got != `{"boc":["view","create","edit","delete","export"],"sanpham":["view","create","edit","delete","export"],"dsncc":["view","create","edit","delete"]}` {
		t.Errorf("qs = %s", got)
	}
	for _, m := range []string{"kinhdoanh", "thietke", "thicong", "muahang"} {
		if out.Has(m) {
			t.Errorf("%s bị khoá theo tính năng công ty mà vẫn có", m)
		}
	}
	for _, m := range []string{"hr", "newsfeed", "chat", "marketing", "taichinh", "bim", "sanxuat", "it", "rd", "banlamviec", "lich", "wiki"} {
		if !s.any(m, actionBit["view"]) {
			t.Errorf("%s phải có", m)
		}
	}
	if !legacyCompany("muahang").any("muahang", actionBit["approve"]) || legacyCompany("muahang").get("qs", "muahang") == 0 {
		t.Error("'muahang' mở cả trang Mua hàng lẫn tab Mua hàng của QS")
	}
}

func TestLegacyStaff(t *testing.T) {
	s := legacyStaff("boc,muahang, chat,sp_duyet,sp_edit,qs,lạ")
	out := s.Out()
	var mods []string
	for _, k := range out.Keys() {
		mods = append(mods, k)
	}
	if strings.Join(mods, ",") != "chat,qs,muahang" {
		t.Errorf("module = %v (%s)", mods, js(t, out))
	}
	if got := js(t, out.Val("qs")); got != `{"boc":["view","create","edit","delete","export"],"muahang":["view","create","edit","delete","approve","export"]}` {
		t.Errorf("qs = %s", got)
	}
	if got := js(t, out.Val("muahang")); got != `{"main":["view","create","edit","delete","approve","export"],"nhansu":["view","edit"]}` {
		t.Errorf("muahang = %s", got)
	}
	if legacyStaff("").Out().Len() != 0 {
		t.Error("perms rỗng = không có gì")
	}
}

// ---------- quyền thực ----------

func eff(t *testing.T, s *Service, id string) string {
	t.Helper()
	u, _ := s.repo.UserByID(context.Background(), id)
	e, _, err := s.userEffective(context.Background(), u)
	if err != nil {
		t.Fatal(err)
	}
	return js(t, e.Out())
}

func TestEffectiveLegacy(t *testing.T) {
	f := newFake().company("c1", "boc,hr").user("a1", "admin", "", "c1").user("u1", "staff", "boc,dash,hr,chat", "c1").
		user("s1", "super", "", "").user("x", "staff", "chat", "")
	s := newSvc(f)
	// admin chưa có dòng = trần công ty
	if got, want := eff(t, s, "a1"), js(t, legacyCompany("boc,hr").Out()); got != want {
		t.Errorf("admin = %s", got)
	}
	// nhân viên chưa có dòng = công ty ∩ perms (dash bị công ty tắt)
	if got := eff(t, s, "u1"); !strings.Contains(got, `"qs":{"boc":`) || strings.Contains(got, `"dash"`) ||
		!strings.Contains(got, `"hr":{"employees"`) || !strings.Contains(got, `"chat":{"main"`) {
		t.Errorf("nhân viên = %s", got)
	}
	if got, want := eff(t, s, "s1"), js(t, fullSet().Out()); got != want {
		t.Error("super = mọi thứ")
	}
	if got := eff(t, s, "x"); got != `{}` {
		t.Errorf("không công ty = %s", got)
	}
}

func TestEffectiveRows(t *testing.T) {
	f := newFake().company("c1", "").
		user("a1", "admin", "", "c1").user("a2", "admin", "", "c1").user("u1", "staff", "boc", "c1").user("u2", "staff", "", "c1").
		user("s1", "super", "", "")
	s := newSvc(f)
	// trần công ty: QS bóc tách + HR (xem)
	f.grant("c1", "", g("qs.boc:view,create,edit,delete,export;hr.*:view"), "s1")
	if got := eff(t, s, "a1"); got != `{"hr":{"employees":["view"],"org":["view"],"attendance":["view"],"payroll":["view"],"recruit":["view"],"performance":["view"],"security":["view"],"admin":["view"]},"qs":{"boc":["view","create","edit","delete","export"]}}` {
		t.Errorf("admin không dòng = trần công ty: %s", got)
	}
	// trần admin rộng hơn công ty -> bị cắt theo công ty
	f.grant("c1", "a1", g("qs.*:view,edit;chat.main:view"), "s1")
	if got := eff(t, s, "a1"); got != `{"qs":{"boc":["view","edit"]}}` {
		t.Errorf("admin = %s", got)
	}
	// nhân viên do a1 cấp: bị cắt theo quyền của a1
	f.grant("c1", "u1", g("qs.boc:view,edit,delete;hr.employees:view"), "a1")
	if got := eff(t, s, "u1"); got != `{"qs":{"boc":["view","edit"]}}` {
		t.Errorf("nhân viên (a1 cấp) = %s", got)
	}
	// super thu bớt quyền của a1 -> nhân viên mất theo
	f.grant("c1", "a1", g("qs.boc:view"), "s1")
	if got := eff(t, s, "u1"); got != `{"qs":{"boc":["view"]}}` {
		t.Errorf("sau khi thu quyền admin = %s", got)
	}
	// công ty thu quyền -> mọi cấp mất
	f.grant("c1", "", g("hr.*:view"), "s1")
	if got := eff(t, s, "u1"); got != `{}` {
		t.Errorf("sau khi thu trần công ty = %s", got)
	}
	f.grant("c1", "", g("qs.boc:view,edit,delete;hr.*:view"), "s1")
	// nhân viên do super cấp: chỉ cắt theo trần công ty
	f.grant("c1", "u2", g("qs.boc:view,delete;hr.employees:view,edit"), "s1")
	if got := eff(t, s, "u2"); got != `{"hr":{"employees":["view"]},"qs":{"boc":["view","delete"]}}` {
		t.Errorf("nhân viên (super cấp) = %s", got)
	}
	// người cấp không còn là admin (bị hạ xuống nhân viên) -> chỉ trần công ty
	f.grant("c1", "u2", g("qs.boc:view,delete"), "a2")
	f.grant("c1", "a2", g("chat.main:view"), "s1")
	if got := eff(t, s, "u2"); got != `{}` {
		t.Errorf("a2 không có QS -> nhân viên mất: %s", got)
	}
	f.user("a2", "staff", "", "c1")
	if got := eff(t, s, "u2"); got != `{"qs":{"boc":["view","delete"]}}` {
		t.Errorf("người cấp không còn là admin = %s", got)
	}
}

func TestCan(t *testing.T) {
	f := newFake().company("c1", "").user("a1", "admin", "", "c1").user("u1", "staff", "", "c1")
	f.grant("c1", "u1", g("qs.boc:view,edit"), "a1")
	s := newSvc(f)
	ctx := context.Background()
	cases := []struct {
		a                   *actor.Actor
		module, tab, action string
		want                bool
	}{
		{nil, "qs", "boc", "view", false},
		{superA, "lạ", "lạ", "fly", true},
		{staffA, "qs", "boc", "", true},
		{staffA, "qs", "boc", "edit", true},
		{staffA, "qs", "boc", "delete", false},
		{staffA, "qs", "dash", "view", false},
		{staffA, "qs", "", "view", true},
		{staffA, "qs", "*", "edit", true},
		{staffA, "qs", "*", "export", false},
		{staffA, "hr", "", "view", false},
		{staffA, "lạ", "", "view", false},
		{staffA, "qs", "boc", "fly", false},
		{adminA, "hr", "payroll", "approve", true},
		{&actor.Actor{UID: "khong-co", R: "staff", CT: "c1"}, "qs", "boc", "view", false},
	}
	for _, c := range cases {
		got, err := s.Can(ctx, c.a, c.module, c.tab, c.action)
		if err != nil || got != c.want {
			who := "nil"
			if c.a != nil {
				who = c.a.U
			}
			t.Errorf("Can(%s, %s, %s, %s) = %v %v, muốn %v", who, c.module, c.tab, c.action, got, err, c.want)
		}
	}
}

func TestMe(t *testing.T) {
	f := newFake().company("c1", "").user("a1", "admin", "", "c1").user("u1", "staff", "chat", "c1")
	f.grant("c1", "a1", g("qs.boc:view"), "s1")
	s := newSvc(f)
	ctx := context.Background()
	r, err := s.Me(ctx, adminA)
	if err != nil || js(t, r) != `{"grants":{"qs":{"boc":["view"]}},"grantable":{"qs":{"boc":["view"]}}}` {
		t.Errorf("admin = %v %v", js(t, r), err)
	}
	r, err = s.Me(ctx, staffA)
	if err != nil || js(t, r) != `{"grants":{"chat":{"main":["view","create","delete"]}},"grantable":{}}` {
		t.Errorf("nhân viên = %v %v", js(t, r), err)
	}
	r, err = s.Me(ctx, superA)
	full := js(t, fullSet().Out())
	if err != nil || js(t, r) != `{"grants":`+full+`,"grantable":`+full+`}` {
		t.Errorf("super = %v", err)
	}
	if _, err := s.Me(ctx, nil); status(err) != 401 {
		t.Errorf("chưa đăng nhập: %v", err)
	}
}

// ---------- ghi ----------

func TestSetCompanyAccess(t *testing.T) {
	f := newFake().company("c1", "boc")
	s := newSvc(f)
	ctx := context.Background()
	r, err := s.CompanyAccess(ctx, "c1")
	if err != nil || r.Val("grants") != nil || js(t, r.Val("effective")) != js(t, legacyCompany("boc").Out()) {
		t.Fatalf("chưa đặt = %v %v", js(t, r), err)
	}
	r, err = s.SetCompanyAccess(ctx, superA, "c1", g("hr.*:view;qs.dash:export,view"))
	if err != nil {
		t.Fatal(err)
	}
	if js(t, r.Val("grants")) != `{"hr":{"*":["view"]},"qs":{"dash":["view","export"]}}` ||
		!strings.Contains(js(t, r.Val("effective")), `"qs":{"dash":["view","export"]}`) {
		t.Errorf("sau khi đặt = %s", js(t, r))
	}
	row := f.grants["c1|"]
	if row.Val("nguoi_cap") != "s1" || row.Val("nguoi_sua") != "sa" || row.Val("cap_nhat") != "2026-11-20T00:00:00.000Z" {
		t.Errorf("dòng = %s", js(t, row))
	}
	if r, err = s.SetCompanyAccess(ctx, superA, "c1", nil); err != nil || r.Val("grants") != nil {
		t.Errorf("null = xoá: %v %v", js(t, r), err)
	}
	if got := strings.Join(f.calls, ","); got != "save:c1|,delete:c1|" {
		t.Errorf("lệnh = %s", got)
	}
	if _, err := s.SetCompanyAccess(ctx, superA, "khong", g("hr.*:view")); status(err) != 404 {
		t.Errorf("công ty không có: %v", err)
	}
	if _, err := s.CompanyAccess(ctx, "khong"); status(err) != 404 {
		t.Errorf("công ty không có: %v", err)
	}
	if _, err := s.SetCompanyAccess(ctx, adminA, "c1", nil); status(err) != 403 {
		t.Errorf("admin: %v", err)
	}
	if _, err := s.SetCompanyAccess(ctx, superA, "c1", g("lạ.x:view")); status(err) != 400 {
		t.Errorf("grants sai: %v", err)
	}
}

func TestSetUserAccessRules(t *testing.T) {
	f := newFake().company("c1", "").company("c2", "").
		user("a1", "admin", "", "c1").user("a3", "admin", "", "c1").user("u1", "staff", "", "c1").user("u9", "staff", "", "c2").
		user("s2", "super", "", "").user("n", "staff", "", "")
	f.grant("c1", "a1", g("qs.boc:view,edit;hr.employees:view"), "s1")
	s := newSvc(f)
	ctx := context.Background()
	cases := []struct {
		name string
		a    *actor.Actor
		id   string
		v    any
		st   int
		msg  string
	}{
		{"chưa đăng nhập", nil, "u1", nil, 401, msgNoAuth},
		{"nhân viên", staffA, "u1", nil, 403, msgOnlyAdmins},
		{"không có", adminA, "zz", nil, 404, msgNoUser},
		{"id rỗng", adminA, "", nil, 404, msgNoUser},
		{"công ty khác", adminA, "u9", nil, 403, msgOtherCompany},
		{"admin đặt admin", adminA, "a3", g("qs.boc:view"), 403, msgAdminTarget},
		{"admin tự đặt", adminA, "a1", g("qs.boc:view"), 403, msgAdminTarget},
		{"đặt cho super (super)", superA, "s2", nil, 400, msgSuperTarget},
		{"không công ty", superA, "n", g("qs.boc:view"), 400, msgUserNoCt},
		{"vượt quyền admin", adminA, "u1", g("qs.boc:view,delete"), 403, msgExceed + "QS > Bóc tách > Xoá"},
		{"vượt bằng *", adminA, "u1", g("hr.*:view"), 403, msgExceed + "HR > Sơ đồ tổ chức > Xem"},
		{"grants sai", adminA, "u1", g("qs.lạ:view"), 400, "Tab không có trong phân hệ QS: lạ"},
	}
	for _, c := range cases {
		_, err := s.SetUserAccess(ctx, c.a, c.id, c.v)
		if err == nil || err.Error() != c.msg || status(err) != c.st {
			t.Errorf("%s: lỗi = %v (%d), muốn %d %q", c.name, err, status(err), c.st, c.msg)
		}
	}
	if len(f.calls) != 0 {
		t.Fatalf("lỗi thì không được ghi: %v", f.calls)
	}
	// admin cấp tập con -> lưu, người cấp = admin
	r, err := s.SetUserAccess(ctx, adminA, "u1", g("qs.boc:edit,view;hr.employees:view"))
	if err != nil {
		t.Fatal(err)
	}
	if js(t, r) != `{"grants":{"hr":{"employees":["view"]},"qs":{"boc":["view","edit"]}},"effective":{"hr":{"employees":["view"]},"qs":{"boc":["view","edit"]}}}` {
		t.Errorf("sau khi cấp = %s", js(t, r))
	}
	if row := f.grants["c1|u1"]; row.Val("nguoi_cap") != "a1" || row.Val("nguoi_sua") != "ad" {
		t.Errorf("dòng = %s", js(t, row))
	}
	// admin đọc tài khoản cùng công ty (kể cả admin khác)
	if r, err = s.UserAccess(ctx, adminA, "a3"); err != nil || r.Val("grants") != nil {
		t.Errorf("đọc admin khác = %v %v", js(t, r), err)
	}
	// admin bỏ phân quyền riêng của nhân viên (về cách cũ)
	if r, err = s.SetUserAccess(ctx, adminA, "u1", nil); err != nil || r.Val("grants") != nil || js(t, r.Val("effective")) != `{}` {
		t.Errorf("null = %v %v", js(t, r), err)
	}
	// super đặt trần cho admin (không cần tập con) và cho nhân viên công ty khác
	if _, err := s.SetUserAccess(ctx, superA, "a3", g("chat.*:view")); err != nil {
		t.Errorf("super đặt admin: %v", err)
	}
	if _, err := s.SetUserAccess(ctx, superA, "u9", g("wiki.main:view")); err != nil {
		t.Errorf("super đặt nhân viên công ty khác: %v", err)
	}
	if got := strings.Join(f.calls, ","); got != "save:c1|u1,delete:c1|u1,save:c1|a3,save:c2|u9" {
		t.Errorf("lệnh = %s", got)
	}
	// super đọc tài khoản super: mọi quyền, grants null
	if r, err = s.UserAccess(ctx, superA, "s2"); err != nil || r.Val("grants") != nil || js(t, r.Val("effective")) != js(t, fullSet().Out()) {
		t.Errorf("super đọc super: %v", err)
	}
}

// bỏ phân quyền riêng (grants null) = về users.perms: quyền suy từ perms cũng không được vượt quyền của admin.
func TestSetUserAccessNullChecksLegacyPerms(t *testing.T) {
	f := newFake().company("c1", "").user("a1", "admin", "", "c1").user("u1", "staff", "boc,hr", "c1").
		user("u2", "staff", "boc", "c1")
	f.grant("c1", "a1", g("qs.boc:view,create,edit,delete,export"), "s1")
	f.grant("c1", "u1", g("qs.boc:view"), "a1")
	f.grant("c1", "u2", g("qs.boc:view"), "a1")
	s := newSvc(f)
	ctx := context.Background()
	if _, err := s.SetUserAccess(ctx, adminA, "u1", nil); status(err) != 403 || err.Error() != msgExceed+"HR > Hồ sơ nhân sự > Xem" {
		t.Errorf("perms vượt quyền admin: %v", err)
	}
	if f.grants["c1|u1"] == nil {
		t.Error("bị từ chối thì không được xoá dòng")
	}
	if _, err := s.SetUserAccess(ctx, adminA, "u2", nil); err != nil {
		t.Errorf("perms trong quyền admin: %v", err)
	}
	// super không bị giới hạn
	if _, err := s.SetUserAccess(ctx, superA, "u1", nil); err != nil {
		t.Errorf("super: %v", err)
	}
}

func TestCheckLegacyPerms(t *testing.T) {
	f := newFake().company("c1", "boc,hr").user("a1", "admin", "", "c1")
	f.grant("c1", "a1", g("qs.boc:view,edit"), "s1")
	s := newSvc(f)
	ctx := context.Background()
	cases := []struct {
		name      string
		a         *actor.Actor
		cur, next any
		msg       string
	}{
		{"super", superA, nil, []any{"boc", "hr"}, ""},
		{"nil", nil, nil, "boc", ""},
		{"cấp thêm boc (mọi thao tác) vượt quyền", adminA, nil, []any{"boc"}, msgExceed + "QS > Bóc tách > Tạo"},
		{"giữ boc đã có", adminA, "boc", []any{"boc"}, ""},
		{"bỏ bớt", adminA, "boc,hr", []any{}, ""},
		{"module công ty không có (kinhdoanh) không tính", adminA, nil, "kinhdoanh,sp_duyet", ""},
		{"thêm hr", adminA, "boc", "boc,hr", msgExceed + "HR > Hồ sơ nhân sự > Xem"},
		{"admin không công ty", &actor.Actor{UID: "a9", R: "admin"}, nil, "boc", msgOnlyAdmins},
	}
	for _, c := range cases {
		err := s.CheckLegacyPerms(ctx, c.a, c.cur, c.next)
		got := ""
		if err != nil {
			got = err.Error()
			if status(err) != 403 {
				t.Errorf("%s: status %d", c.name, status(err))
			}
		}
		if got != c.msg {
			t.Errorf("%s: %q, muốn %q", c.name, got, c.msg)
		}
	}
	// admin chưa bị giới hạn (không dòng) = trần công ty: perms trong trần là được
	f2 := newFake().company("c1", "boc,hr").user("a1", "admin", "", "c1")
	if err := newSvc(f2).CheckLegacyPerms(ctx, adminA, nil, []any{"boc", "hr", "dash"}); err != nil {
		t.Errorf("admin không giới hạn: %v", err)
	}
}

func TestLegacyAny(t *testing.T) {
	ctx := context.Background()
	staff := func(id string) *actor.Actor { return &actor.Actor{UID: id, R: "staff", CT: "c1"} }
	f := newFake().company("c1", "").user("a1", "admin", "", "c1").user("u1", "staff", "dash", "c1").
		user("u2", "staff", "chat", "c1").user("u3", "staff", "boc", "c1")
	f.grant("c1", "u3", g("qs.boc:view"), "a1")
	s := newSvc(f)
	for _, c := range []struct {
		name string
		a    *actor.Actor
		want bool
	}{
		{"nhân viên perms dash", staff("u1"), true},
		{"nhân viên không vào QS", staff("u2"), false},
		{"nhân viên có dòng riêng", staff("u3"), false},
		{"admin không dòng", adminA, true},
		{"super", superA, false},
		{"nil", nil, false},
	} {
		if got, err := s.LegacyAny(ctx, c.a, "qs"); err != nil || got != c.want {
			t.Errorf("%s: %v %v", c.name, got, err)
		}
	}
	// công ty có dòng trần -> không còn cách cũ
	f.grant("c1", "", g("qs.*:view,edit"), "s1")
	if got, _ := s.LegacyAny(ctx, staff("u1"), "qs"); got {
		t.Error("công ty có trần: phải false")
	}
}

func TestFreezeGrantsBy(t *testing.T) {
	ctx := context.Background()
	f := newFake().company("c1", "").user("a1", "admin", "", "c1").user("u1", "staff", "", "c1").user("u2", "staff", "", "c1").
		user("u3", "staff", "", "c1")
	f.grant("c1", "a1", g("qs.boc:view,edit"), "s1")
	f.grant("c1", "u1", g("qs.boc:view,edit,delete;hr.employees:view"), "a1")
	f.grant("c1", "u2", g("qs.boc:view,delete"), "s1")
	f.grant("c1", "u3", g("qs.boc:view"), "a1")
	s := newSvc(f)
	before := eff(t, s, "u1")
	if err := s.FreezeGrantsBy(ctx, "u1"); err != nil || len(f.calls) != 0 {
		t.Fatalf("không phải admin: %v %v", err, f.calls)
	}
	if err := s.FreezeGrantsBy(ctx, "a1"); err != nil {
		t.Fatal(err)
	}
	// chỉ u1 (do a1 cấp, rộng hơn a1) bị cắt; u3 đã nằm trong quyền a1; u2 do super cấp
	if got := strings.Join(f.calls, ","); got != "save:c1|u1" {
		t.Errorf("lệnh = %s", got)
	}
	row := f.grants["c1|u1"]
	if js(t, row.Val("quyen")) != `{"qs":{"boc":["view","edit"]}}` || row.Val("nguoi_cap") != "a1" {
		t.Errorf("dòng u1 = %s", js(t, row))
	}
	if got := eff(t, s, "u1"); got != before {
		t.Errorf("quyền thực đổi: %s -> %s", before, got)
	}
	// admin bị hạ vai trò / xoá: nhân viên giữ đúng giới hạn cũ
	f.user("a1", "staff", "", "c1")
	if got := eff(t, s, "u1"); got != before || got != `{"qs":{"boc":["view","edit"]}}` {
		t.Errorf("sau khi hạ admin = %s", got)
	}
	delete(f.users, "a1")
	if got := eff(t, s, "u1"); got != before {
		t.Errorf("sau khi xoá admin = %s", got)
	}
}

// countRepo: đếm số lần đọc tài khoản (bộ đệm theo request).
type countRepo struct {
	*fakeRepo
	n int
}

func (c *countRepo) UserByID(ctx context.Context, id string) (*omap.Map, error) {
	c.n++
	return c.fakeRepo.UserByID(ctx, id)
}

func TestActorStateCachedPerRequest(t *testing.T) {
	f := newFake().company("c1", "").user("a1", "admin", "", "c1").user("u1", "staff", "", "c1")
	f.grant("c1", "u1", g("qs.boc:view,edit"), "a1")
	r := &countRepo{fakeRepo: f}
	s := New(Deps{Repo: r})
	ctx := reqcache.With(context.Background())
	for i := 0; i < 5; i++ {
		if ok, err := s.Can(ctx, staffA, "qs", "boc", "edit"); err != nil || !ok {
			t.Fatalf("Can: %v %v", ok, err)
		}
	}
	if r.n != 2 { // nhân viên + người cấp, chỉ lần đầu
		t.Errorf("đọc tài khoản %d lần, muốn 2", r.n)
	}
	// ghi phân quyền trong request -> bỏ bộ đệm
	if _, err := s.SetUserAccess(ctx, adminA, "u1", g("qs.boc:view")); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.Can(ctx, staffA, "qs", "boc", "edit"); ok {
		t.Error("sau khi ghi: bộ đệm cũ")
	}
	// context không có bộ đệm: mỗi lần đọc lại
	r.n = 0
	for i := 0; i < 3; i++ {
		_, _ = s.Can(context.Background(), staffA, "qs", "boc", "view")
	}
	if r.n != 6 {
		t.Errorf("không bộ đệm: %d lần", r.n)
	}
}

// ---------- subadmin (nhãn "Admin", M14.7) ----------

var subA = &actor.Actor{UID: "m1", U: "sub", R: actor.RoleSubAdmin, CT: "c1"}

// subFake: công ty c1 (không trần), admin a1 (dòng do super cấp), subadmin m1 (dòng do a1 cấp).
func subFake() *fakeRepo {
	f := newFake().company("c1", "").company("c2", "").
		user("a1", "admin", "", "c1").user("m1", "subadmin", "", "c1").user("m2", "subadmin", "", "c1").
		user("u1", "staff", "", "c1").user("u2", "staff", "", "c1").user("u9", "staff", "", "c2")
	f.grant("c1", "a1", g("qs.boc:view,edit,delete;hr.employees:view;chat.main:view"), "s1")
	f.grant("c1", "m1", g("qs.boc:view,edit;hr.employees:view"), "a1")
	return f
}

func TestSubAdminMe(t *testing.T) {
	s := newSvc(subFake())
	r, err := s.Me(context.Background(), subA)
	want := `{"hr":{"employees":["view"]},"qs":{"boc":["view","edit"]}}`
	if err != nil || js(t, r) != `{"grants":`+want+`,"grantable":`+want+`}` {
		t.Errorf("subadmin = %v %v", js(t, r), err)
	}
	if subA.IsAdmin() {
		t.Error("subadmin không được là admin")
	}
}

func TestSubAdminSetUserAccess(t *testing.T) {
	f := subFake()
	f.grant("c1", "u2", g("qs.boc:view,delete"), "s1")
	s := newSvc(f)
	ctx := context.Background()
	cases := []struct {
		name string
		id   string
		v    any
		st   int
		msg  string
	}{
		{"đặt admin", "a1", g("qs.boc:view"), 403, msgAdminTarget},
		{"đặt subadmin khác", "m2", g("qs.boc:view"), 403, msgSubTarget},
		{"tự đặt", "m1", g("qs.boc:view"), 403, msgSubTarget},
		{"tự đặt null", "m1", nil, 403, msgSubTarget},
		{"null = theo mặc định cũ", "u1", nil, 403, msgSubNoDefault},
		{"vượt quyền mình", "u1", g("qs.boc:view,delete"), 403, msgExceed + "QS > Bóc tách > Xoá"},
		{"nhân viên có quyền vượt mình", "u2", g("qs.boc:view"), 403, msgTargetExceed + "QS > Bóc tách > Xoá"},
		{"công ty khác", "u9", g("qs.boc:view"), 403, msgOtherCompany},
		{"không có", "zz", g("qs.boc:view"), 404, msgNoUser},
	}
	for _, c := range cases {
		_, err := s.SetUserAccess(ctx, subA, c.id, c.v)
		if err == nil || err.Error() != c.msg || status(err) != c.st {
			t.Errorf("%s: lỗi = %v (%d), muốn %d %q", c.name, err, status(err), c.st, c.msg)
		}
	}
	if len(f.calls) != 0 {
		t.Fatalf("lỗi thì không được ghi: %v", f.calls)
	}
	r, err := s.SetUserAccess(ctx, subA, "u1", g("qs.boc:view;hr.employees:view"))
	if err != nil {
		t.Fatal(err)
	}
	if js(t, r) != `{"grants":{"hr":{"employees":["view"]},"qs":{"boc":["view"]}},"effective":{"hr":{"employees":["view"]},"qs":{"boc":["view"]}}}` {
		t.Errorf("sau khi cấp = %s", js(t, r))
	}
	if row := f.grants["c1|u1"]; row.Val("nguoi_cap") != "m1" || row.Val("nguoi_sua") != "sub" {
		t.Errorf("dòng = %s", js(t, row))
	}
	// đọc: chính mình và nhân viên (kể cả nhân viên vượt quyền) được; admin / subadmin khác không
	if _, err := s.UserAccess(ctx, subA, "m1"); err != nil {
		t.Errorf("tự đọc: %v", err)
	}
	if _, err := s.UserAccess(ctx, subA, "u2"); err != nil {
		t.Errorf("đọc nhân viên: %v", err)
	}
	for _, id := range []string{"a1", "m2"} {
		if _, err := s.UserAccess(ctx, subA, id); status(err) != 403 || err.Error() != msgSubTarget {
			t.Errorf("đọc %s: %v", id, err)
		}
	}
	// admin phân quyền được cho subadmin (trong quyền của admin)
	if _, err := s.SetUserAccess(ctx, adminA, "m2", g("qs.boc:view")); err != nil {
		t.Errorf("admin đặt subadmin: %v", err)
	}
}

func TestSubAdminGranterCap(t *testing.T) {
	f := subFake()
	f.grant("c1", "u1", g("qs.boc:view,edit,delete;hr.employees:view;chat.main:view"), "m1")
	s := newSvc(f)
	// nhân viên do subadmin cấp: cắt theo quyền thực của subadmin
	if got := eff(t, s, "u1"); got != `{"hr":{"employees":["view"]},"qs":{"boc":["view","edit"]}}` {
		t.Errorf("nhân viên (m1 cấp) = %s", got)
	}
	// admin thu quyền của subadmin -> nhân viên mất theo
	f.grant("c1", "m1", g("qs.boc:view"), "a1")
	if got := eff(t, s, "u1"); got != `{"qs":{"boc":["view"]}}` {
		t.Errorf("sau khi thu quyền subadmin = %s", got)
	}
	// chuỗi nhân viên -> subadmin -> admin: dòng của admin cũng giới hạn
	f.grant("c1", "m1", g("qs.boc:view,edit,delete;hr.employees:view"), "a1")
	f.grant("c1", "a1", g("qs.boc:view,edit"), "s1")
	if got := eff(t, s, "u1"); got != `{"qs":{"boc":["view","edit"]}}` {
		t.Errorf("chuỗi tới admin = %s", got)
	}
	// subadmin chưa có dòng (perms cũ) vẫn giới hạn
	f.user("m2", "subadmin", "chat", "c1")
	f.grant("c1", "u2", g("qs.boc:view;chat.main:view"), "m2")
	if got := eff(t, s, "u2"); got != `{"chat":{"main":["view"]}}` {
		t.Errorf("subadmin chưa có dòng = %s", got)
	}
	// vòng m3 <-> m4: dừng, rỗng
	f.user("m3", "subadmin", "", "c1").user("m4", "subadmin", "", "c1").user("u3", "staff", "", "c1")
	f.grant("c1", "m3", g("qs.boc:view"), "m4")
	f.grant("c1", "m4", g("qs.boc:view"), "m3")
	f.grant("c1", "u3", g("qs.boc:view"), "m3")
	for _, id := range []string{"m3", "m4", "u3"} {
		if got := eff(t, s, id); got != `{}` {
			t.Errorf("vòng %s = %s", id, got)
		}
	}
	// độ sâu: u4 -> ma -> mb -> mc -> a1 vẫn tính; thêm 1 subadmin nữa (mc -> md) = rỗng
	f.user("ma", "subadmin", "", "c1").user("mb", "subadmin", "", "c1").user("mc", "subadmin", "", "c1").
		user("md", "subadmin", "", "c1").user("u4", "staff", "", "c1")
	f.grant("c1", "u4", g("qs.boc:view"), "ma")
	f.grant("c1", "ma", g("qs.boc:view"), "mb")
	f.grant("c1", "mb", g("qs.boc:view"), "mc")
	f.grant("c1", "mc", g("qs.boc:view"), "a1")
	if got := eff(t, s, "u4"); got != `{"qs":{"boc":["view"]}}` {
		t.Errorf("3 cấp subadmin = %s", got)
	}
	f.grant("c1", "mc", g("qs.boc:view"), "md")
	f.grant("c1", "md", g("qs.boc:view"), "a1")
	if got := eff(t, s, "u4"); got != `{}` {
		t.Errorf("4 cấp subadmin = %s", got)
	}
	// subadmin công ty khác không giới hạn (như admin công ty khác)
	f.user("mx", "subadmin", "", "c2").user("u5", "staff", "", "c1")
	f.grant("c2", "mx", g("chat.main:view"), "s1")
	f.grant("c1", "u5", g("qs.boc:view"), "mx")
	if got := eff(t, s, "u5"); got != `{"qs":{"boc":["view"]}}` {
		t.Errorf("người cấp công ty khác = %s", got)
	}
}

func TestFreezeGrantsBySubAdmin(t *testing.T) {
	f := subFake()
	f.grant("c1", "u1", g("qs.boc:view,edit,delete"), "m1")
	f.grant("c1", "u2", g("qs.boc:view"), "m1")
	s := newSvc(f)
	before := eff(t, s, "u1")
	if err := s.FreezeGrantsBy(context.Background(), "m1"); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.calls, ","); got != "save:c1|u1" {
		t.Errorf("lệnh = %s", got)
	}
	if row := f.grants["c1|u1"]; js(t, row.Val("quyen")) != `{"qs":{"boc":["view","edit"]}}` || row.Val("nguoi_cap") != "m1" {
		t.Errorf("dòng u1 = %s", js(t, row))
	}
	f.user("m1", "staff", "", "c1")
	if got := eff(t, s, "u1"); got != before {
		t.Errorf("sau khi hạ subadmin: %s -> %s", before, got)
	}
}

// admin công ty (không có dòng riêng, perms rỗng) bị hạ xuống subadmin: Freeze + Release -> quyền thực nhân viên nó cấp không đổi.
func TestReleaseGrantsBy(t *testing.T) {
	ctx := context.Background()
	f := newFake().company("c1", "").user("a9", "admin", "", "c1").user("u1", "staff", "", "c1").user("u2", "staff", "", "c1")
	f.grant("c1", "u1", g("qs.boc:view,edit;hr.employees:view"), "a9")
	f.grant("c1", "u2", g("qs.boc:view"), "s1")
	s := newSvc(f)
	before := eff(t, s, "u1")
	// chưa phải subadmin / a nil: không ghi
	if err := s.ReleaseGrantsBy(ctx, superA, "a9"); err != nil || len(f.calls) != 0 {
		t.Fatalf("còn là admin: %v %v", err, f.calls)
	}
	if err := s.FreezeGrantsBy(ctx, "a9"); err != nil {
		t.Fatal(err)
	}
	f.user("a9", "subadmin", "", "c1")
	if got := eff(t, s, "u1"); got != `{}` {
		t.Fatalf("chưa release: nhân viên bị giới hạn theo subadmin = %s", got)
	}
	if err := s.ReleaseGrantsBy(ctx, nil, "a9"); err != nil || len(f.calls) != 0 {
		t.Fatalf("a nil: %v %v", err, f.calls)
	}
	if err := s.ReleaseGrantsBy(ctx, superA, "a9"); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.calls, ","); got != "save:c1|u1" {
		t.Errorf("lệnh = %s", got)
	}
	row := f.grants["c1|u1"]
	if row.Val("nguoi_cap") != "s1" || row.Val("nguoi_sua") != "sa" || js(t, row.Val("quyen")) != `{"qs":{"boc":["view","edit"]},"hr":{"employees":["view"]}}` {
		t.Errorf("dòng u1 = %s", js(t, row))
	}
	if got := eff(t, s, "u1"); got != before {
		t.Errorf("quyền thực đổi: %s -> %s", before, got)
	}
}

func TestCheckUserWithin(t *testing.T) {
	f := subFake()
	f.grant("c1", "u1", g("qs.boc:view"), "s1")
	f.grant("c1", "u2", g("qs.boc:view,delete"), "s1")
	s := newSvc(f)
	ctx := context.Background()
	if err := s.CheckUserWithin(ctx, subA, "u1"); err != nil {
		t.Errorf("tập con: %v", err)
	}
	if err := s.CheckUserWithin(ctx, subA, "u2"); status(err) != 403 || err.Error() != msgTargetExceed+"QS > Bóc tách > Xoá" {
		t.Errorf("vượt: %v", err)
	}
	if err := s.CheckUserWithin(ctx, subA, "zz"); status(err) != 404 {
		t.Errorf("không có: %v", err)
	}
	for _, a := range []*actor.Actor{nil, adminA, superA, staffA} {
		if err := s.CheckUserWithin(ctx, a, "u2"); err != nil {
			t.Errorf("không phải subadmin: %v", err)
		}
	}
}

func TestPinGrantedBy(t *testing.T) {
	f := subFake()
	f.user("u1", "staff", "boc,chat", "c1")
	f.grant("c1", "u2", g("qs.boc:view"), "a1")
	s := newSvc(f)
	ctx := context.Background()
	// không phải subadmin / chính mình / đã có dòng / không phải nhân viên: không ghi
	for _, a := range []*actor.Actor{nil, adminA, superA} {
		if err := s.PinGrantedBy(ctx, a, "u1"); err != nil {
			t.Errorf("không phải subadmin: %v", err)
		}
	}
	for _, id := range []string{"m1", "u2", "m2"} {
		if err := s.PinGrantedBy(ctx, subA, id); err != nil {
			t.Errorf("%s: %v", id, err)
		}
	}
	if len(f.calls) != 0 {
		t.Fatalf("không được ghi: %v", f.calls)
	}
	if err := s.PinGrantedBy(ctx, subA, "u9"); status(err) != 403 {
		t.Errorf("công ty khác: %v", err)
	}
	// nhân viên perms cũ: ghi dòng = perms ∩ quyền của subadmin, người cấp = subadmin
	if err := s.PinGrantedBy(ctx, subA, "u1"); err != nil {
		t.Fatal(err)
	}
	row := f.grants["c1|u1"]
	if js(t, row.Val("quyen")) != `{"qs":{"boc":["view","edit"]}}` || row.Val("nguoi_cap") != "m1" {
		t.Errorf("dòng u1 = %s", js(t, row))
	}
	if err := s.PinGrantedBy(ctx, subA, "u1"); err != nil || strings.Join(f.calls, ",") != "save:c1|u1" {
		t.Errorf("đã có dòng thì không ghi lại: %v %v", err, f.calls)
	}
	// sau đó subadmin bị thu quyền -> nhân viên mất theo
	f.grant("c1", "m1", g("qs.boc:view"), "a1")
	if got := eff(t, s, "u1"); got != `{"qs":{"boc":["view"]}}` {
		t.Errorf("sau khi thu quyền subadmin = %s", got)
	}
}
