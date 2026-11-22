package materials

import (
	"context"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// userMap: bản thế UserReader theo id -> dòng thô users.
type userMap map[string]*omap.Map

func (m userMap) GetByID(_ context.Context, id any) (*omap.Map, error) {
	return m[jsval.ToString(id)], nil
}

// spRepo: chỉ trả dòng db_san_pham đặt sẵn và ghi lại bộ lọc.
type spRepo struct {
	Repository
	rows    []*omap.Map
	filters []string
}

func (r *spRepo) Select(_ context.Context, table string, opt ...database.SelectOpt) ([]*omap.Map, error) {
	if len(opt) > 0 {
		r.filters = append(r.filters, table+"?"+opt[0].Filter)
	}
	return r.rows, nil
}

func TestSpApprovalRights(t *testing.T) {
	users := userMap{
		"a1": omap.Of("id", "a1", "role", "admin", "duoc_duyet_sp", true),
		"a2": omap.Of("id", "a2", "role", "admin", "duoc_duyet_sp", false),
		"n1": omap.Of("id", "n1", "role", "staff", "perms", "sp_edit,sp_duyet"),
		"n2": omap.Of("id", "n2", "role", "staff", "perms", "sp_edit"),
		"n3": omap.Of("id", "n3", "role", "staff", "perms", ""), // chưa cấu hình: spPerms_ cho duyệt, phân cấp thì không
	}
	s := New(Deps{Repo: &spRepo{}, Users: users, UserFmt: stubDeps{}})
	cases := []struct {
		a           *actor.Actor
		duyet, giao bool
	}{
		{nil, false, false},
		{&actor.Actor{UID: "s", R: "super"}, true, true},
		{&actor.Actor{UID: "a1", R: "admin"}, true, true},
		{&actor.Actor{UID: "a2", R: "admin"}, false, false},
		{&actor.Actor{UID: "n1", R: "staff"}, true, false},
		{&actor.Actor{UID: "n2", R: "staff"}, false, false},
		{&actor.Actor{UID: "n3", R: "staff"}, false, false},
		{&actor.Actor{UID: "mat", R: "staff"}, false, false},
	}
	ctx := context.Background()
	for _, c := range cases {
		d, g, err := s.SpApprovalRights(ctx, c.a)
		if err != nil || d != c.duyet || g != c.giao {
			t.Errorf("%+v: duyet=%v giao=%v err=%v, muốn %v %v", c.a, d, g, err, c.duyet, c.giao)
		}
	}
	out, _ := s.SpApprovalRightsOut(ctx, &actor.Actor{UID: "n1", R: "staff"})
	if js(out) != `{"duyet":true,"giaoDuyet":false}` {
		t.Errorf("SpApprovalRightsOut = %s", js(out))
	}
	// spMyPerms (đầu ra đóng băng) giữ nguyên ngoại lệ "chưa cấu hình gì thì được duyệt"
	if mp, _ := s.SpMyPerms(ctx, &actor.Actor{UID: "n3", R: "staff"}); js(mp) != `{"edit":true,"duyet":true}` {
		t.Errorf("SpMyPerms đổi: %s", js(mp))
	}
	// cửa ngõ duyệt theo phân cấp: admin chưa được giao, nhân viên chưa cấu hình -> bị chặn trước khi đụng dữ liệu
	for _, a := range []*actor.Actor{{UID: "a2", R: "admin"}, {UID: "n3", R: "staff"}} {
		if _, err := s.SetSpDuyetGated(ctx, a, []any{"X"}, true); err == nil || err.Error() != msgKhongDuyet {
			t.Errorf("%s duyệt được: %v", a.UID, err)
		}
	}
}

func TestChuaDuyet(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		ma   string
		rows []*omap.Map
		want bool
	}{
		{"  ", []*omap.Map{omap.Of("da_duyet", false)}, false},
		{"SP1", nil, false},
		{"SP1", []*omap.Map{omap.Of("da_duyet", false)}, true},
		{"SP1", []*omap.Map{omap.Of("da_duyet", nil)}, true},
		{"SP1", []*omap.Map{omap.Of("da_duyet", false), omap.Of("da_duyet", true)}, false},
	}
	for i, c := range cases {
		r := &spRepo{rows: c.rows}
		got, err := New(Deps{Repo: r}).ChuaDuyet(ctx, c.ma)
		if err != nil || got != c.want {
			t.Errorf("ca %d: %v %v, muốn %v", i, got, err, c.want)
		}
	}
	r := &spRepo{}
	_, _ = New(Deps{Repo: r}).ChuaDuyet(ctx, " A&B ")
	if len(r.filters) != 1 || r.filters[0] != "db_san_pham?ma_sp=eq.A%26B" {
		t.Errorf("bộ lọc: %v", r.filters)
	}
}
