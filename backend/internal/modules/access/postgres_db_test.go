package access

import (
	"context"
	"os"
	"regexp"
	"testing"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Trên qspro_gotest (TEST_DATABASE_URL, đã migrate 0052): ghi đè trần công ty (user_id null không tạo dòng thứ 2),
// quyền tài khoản, jsonb đọc ra đúng dạng, xoá về cách cũ; công ty khác không bị đụng.
func TestAccessRepo_DB(t *testing.T) {
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
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	c1, c2 := jsval.Str(cts[0].Val("id")), jsval.Str(cts[1].Val("id"))
	us, err := db.Select(bg, "users", database.SelectOpt{Select: "id,role,cong_ty_id", Filter: database.Eq("cong_ty_id", c1), Limit: 1,
		NoScope: true})
	if err != nil || len(us) == 0 {
		t.Fatalf("database thử cần 1 tài khoản của công ty %s: %v", c1, err)
	}
	uid := jsval.Str(us[0].Val("id"))
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	clean := func() {
		_, _ = pool.Exec(bg, `delete from access_grants where company_id in ($1, $2)`, c1, c2)
	}
	clean()
	t.Cleanup(clean)

	r := NewRepository(db)
	if row, err := r.GrantRow(bg, c1, ""); err != nil || row != nil {
		t.Fatalf("chưa có dòng: %v %v", row, err)
	}
	s := New(Deps{Repo: r})
	sa := &actor.Actor{UID: nil, U: "zz_super", R: "super"}
	for _, spec := range []string{"qs.boc:view,edit", "qs.boc:view;hr.*:view"} {
		if _, err := s.SetCompanyAccess(bg, sa, c1, g(spec)); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := pool.QueryRow(bg, `select count(*) from access_grants where company_id = $1 and user_id is null`, c1).Scan(&n); err != nil || n != 1 {
		t.Fatalf("trần công ty phải 1 dòng (nulls not distinct): %d %v", n, err)
	}
	row, err := r.GrantRow(bg, c1, "")
	if err != nil || row == nil {
		t.Fatal(err)
	}
	if got, _ := omap.MarshalString(row.Val("quyen")); got != `{"hr":{"*":["view"]},"qs":{"boc":["view"]}}` {
		t.Errorf("quyen = %s", got)
	}
	if row.Val("nguoi_sua") != "zz_super" || row.Val("nguoi_cap") != nil || jsval.Str(row.Val("cap_nhat")) == "" {
		t.Errorf("dòng = %v", row)
	}
	if err := r.SaveGrant(bg, c1, uid, omap.Of("quyen", g("chat.main:view"), "nguoi_cap", uid, "nguoi_sua", "zz", "cap_nhat", jsval.NowISO())); err != nil {
		t.Fatal(err)
	}
	if row, err := r.GrantRow(bg, c1, uid); err != nil || row == nil || jsval.Str(row.Val("nguoi_cap")) != uid {
		t.Fatalf("dòng tài khoản: %v %v", row, err)
	}
	// GrantsBy: dòng tài khoản do uid cấp (dòng trần công ty không tính); FreezeGrantsBy ghi chỉ cột quyen / cap_nhat
	if rows, err := r.GrantsBy(bg, c1, uid); err != nil || len(rows) != 1 || jsval.Str(rows[0].Val("tai_khoan_id")) != uid {
		t.Errorf("GrantsBy: %v %v", rows, err)
	}
	if rows, err := r.GrantsBy(bg, c1, "khong-phai-uuid"); err != nil || len(rows) != 0 {
		t.Errorf("GrantsBy id sai dạng: %v %v", rows, err)
	}
	if err := r.SaveGrant(bg, c1, uid, omap.Of("quyen", g("chat.main:view,create"), "cap_nhat", jsval.NowISO())); err != nil {
		t.Fatal(err)
	}
	if row, err := r.GrantRow(bg, c1, uid); err != nil || row == nil || jsval.Str(row.Val("nguoi_cap")) != uid || row.Val("nguoi_sua") != "zz" {
		t.Errorf("ghi 1 phần phải giữ người cấp: %v %v", row, err)
	}
	if row, err := r.GrantRow(bg, c2, ""); err != nil || row != nil {
		t.Errorf("công ty khác không có dòng: %v %v", row, err)
	}
	if err := r.DeleteGrant(bg, c1, ""); err != nil {
		t.Fatal(err)
	}
	if row, _ := r.GrantRow(bg, c1, ""); row != nil {
		t.Error("xoá trần công ty")
	}
	if row, _ := r.GrantRow(bg, c1, uid); row == nil {
		t.Error("xoá trần công ty không được xoá dòng tài khoản")
	}
	if u, err := r.UserByID(bg, uid); err != nil || u == nil || jsval.Str(u.Val("cong_ty_id")) != c1 {
		t.Errorf("UserByID: %v %v", u, err)
	}
	if u, err := r.UserByID(bg, "khong-phai-uuid"); err != nil || u != nil {
		t.Errorf("id sai dạng = không có: %v %v", u, err)
	}
	if ct, err := r.CompanyByID(bg, c2); err != nil || ct == nil || !ct.Has("tinh_nang") {
		t.Errorf("CompanyByID: %v %v", ct, err)
	}
}
