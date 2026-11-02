package projects

import (
	"context"
	"testing"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Yêu cầu sửa dự án (migration 0019): chỉ giữ khoá được phép và khác giá trị đang có; admin sửa thẳng;
// không có thay đổi / tên rỗng báo lỗi; người không có quyền duyệt cần database để tạo phiếu.
func TestRequestProjectEdit(t *testing.T) {
	f := &fakeRepo{log: []any{}, ret: omap.New(), errs: omap.New()}
	f.ret.Set("FindProject", []any{omap.Of("ma_da", "DA-1", "ten_du_an", "Cũ", "khach_hang", "Anh A", "vat_pct", 8.0)})
	svc := New(Deps{Repo: f})
	svc.now = func() string { return "<ts>" }
	ctx := context.Background()
	admin := &actor.Actor{UID: "u1", U: "ad", R: "admin"}

	r, err := svc.RequestProjectEdit(ctx, admin, "DA-1", omap.Of("ten", " Mới ", "khachHang", "Anh A", "vat", "8", "nhomTuTao", "x", "kienTrucSu", "KTS B"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !jsval.StrictEquals(r.Val("applied"), true) {
		t.Fatalf("admin phải sửa thẳng: %s", mustJSON(t, r))
	}
	var patch *omap.Map
	for k := len(f.log) - 1; k >= 0; k-- {
		if jsval.AsString(jsval.Get(f.log[k], "m")) == "UpdateProject" {
			patch = jsval.AsMap(jsval.AsArray(jsval.Get(f.log[k], "a"))[1])
			break
		}
	}
	if patch == nil {
		t.Fatal("không có lệnh UpdateProject")
	}
	if got := mustJSON(t, patch); got != `{"cap_nhat":"<ts>","ten_du_an":"Mới","kien_truc_su":"KTS B"}` {
		t.Errorf("patch = %s (chỉ khoá đổi, bỏ nhomTuTao, trim chuỗi, vat 8 = 8)", got)
	}

	if _, err := svc.RequestProjectEdit(ctx, admin, "DA-1", omap.Of("ten", "Cũ", "vat", 8), nil); err == nil || err.Error() != "Không có thay đổi nào" {
		t.Errorf("không đổi gì: lỗi = %v", err)
	}
	if _, err := svc.RequestProjectEdit(ctx, admin, "DA-1", omap.Of("ten", "  "), nil); err == nil || err.Error() != "Tên dự án không được để trống" {
		t.Errorf("tên rỗng: lỗi = %v", err)
	}
	staff := &actor.Actor{UID: "u2", U: "nv", R: "user"}
	if _, err := svc.RequestProjectEdit(ctx, staff, "DA-1", omap.Of("ten", "Khác"), nil); err == nil || err.Error() != "Chưa nối database" {
		t.Errorf("nhân viên không có users / database: lỗi = %v", err)
	}
	if _, err := svc.ResolveProjectEditRequest(ctx, staff, 1, true, nil); err == nil || err.Error() != "Tài khoản không có quyền duyệt sửa dự án" {
		t.Errorf("nhân viên duyệt: lỗi = %v", err)
	}
}
