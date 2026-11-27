package users

import (
	"context"
	"fmt"
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

// TestSubAdminRoleDB (M14.7, cần migration 0053 trên qspro_gotest): hàm lõi lưu vai trò subadmin và giữ perms; "boss" vẫn
// thành staff; hạ admin cuối cùng của công ty xuống subadmin bị chặn (subadmin không tính là admin).
func TestSubAdminRoleDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	defer db.Close()
	pool, err := db.Pool()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	tag := fmt.Sprintf("zz_subdb_%d", time.Now().UnixNano())
	code := strings.ReplaceAll(tag, "_", "-")
	sweep := func() {
		for _, q := range []string{
			"delete from audit_logs where detail like '%' || $1 || '%'",
			"delete from users where username like $1 || '%'",
			"delete from companies where code like replace($1, '_', '-') || '%'",
		} {
			if _, err := pool.Exec(ctx, q, tag); err != nil {
				t.Errorf("dọn dữ liệu thử: %v", err)
			}
		}
	}
	defer sweep()
	var ct, admID string
	if err := pool.QueryRow(ctx, "insert into companies(name, code) values ($1, $2) returning id::text", "ZZ_SUBDB", code).Scan(&ct); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "insert into users(username, password_hash, company_id, role, is_active) values ($1, 'x', $2, 'admin', true) returning id::text",
		tag+"_adm", ct).Scan(&admID); err != nil {
		t.Fatal(err)
	}
	s := New(Deps{DB: db})
	s.SetCompanyReader(noCompanies{})
	adm := &actor.Actor{UID: admID, U: tag + "_adm", R: "admin", CT: ct}
	actx := tenant.With(ctx, tenant.Ctx{UID: admID, Role: "admin", CongTyID: ct})
	stored := func(id any) string {
		var role, perms string
		if err := pool.QueryRow(ctx, "select role, coalesce(permissions, '') from users where id = $1", jsval.ToString(id)).Scan(&role, &perms); err != nil {
			t.Fatal(err)
		}
		return role + "|" + perms
	}

	out, err := s.AdminCreateUser(actx, adm, omap.Of("username", tag+"_sub", "password", "1234", "role", "subadmin", "perms", []any{"boc", "sp_edit"}))
	if err != nil {
		t.Fatalf("tạo subadmin: %v", err)
	}
	if got := stored(out.Val("id")); got != "subadmin|boc,sp_edit" || !jsval.StrictEquals(out.Val("role"), "subadmin") {
		t.Errorf("subadmin lưu %q, trả role %v", got, out.Val("role"))
	}
	boss, err := s.AdminCreateUser(actx, adm, omap.Of("username", tag+"_boss", "password", "1234", "role", "boss", "perms", []any{"boc"}))
	if err != nil {
		t.Fatalf("tạo boss: %v", err)
	}
	if got := stored(boss.Val("id")); got != "staff|boc" {
		t.Errorf("boss lưu %q", got)
	}
	// nhân viên -> subadmin giữ perms; subadmin -> staff
	if _, err := s.AdminUpdateUser(actx, adm, boss.Val("id"), omap.Of("role", "subadmin")); err != nil || stored(boss.Val("id")) != "subadmin|boc" {
		t.Errorf("nâng lên subadmin: %v %q", err, stored(boss.Val("id")))
	}
	if _, err := s.AdminUpdateUser(actx, adm, boss.Val("id"), omap.Of("role", "staff")); err != nil || stored(boss.Val("id")) != "staff|boc" {
		t.Errorf("hạ về staff: %v %q", err, stored(boss.Val("id")))
	}
	// admin cuối cùng không hạ xuống subadmin được
	sup := &actor.Actor{UID: nil, U: "sa", R: "super"}
	sctx := tenant.With(ctx, tenant.Ctx{Role: "super"})
	if _, err := s.AdminUpdateUser(sctx, sup, admID, omap.Of("role", "subadmin")); errStr(err) != msgLastAdmin || stored(admID) != "admin|" {
		t.Errorf("hạ admin cuối: %v %q", err, stored(admID))
	}
}
