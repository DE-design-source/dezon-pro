package server

import "testing"

// M14.7: token "m" (subadmin) qua được middleware của route quản lý tài khoản nhân viên (REST /api/v1), còn mọi route /
// hàm chỉ admin khác (kể cả 7 hàm /api/admin* + getAuditLog đóng băng) vẫn trả đúng thân 403 "chỉ Admin" như nhân viên.
func TestSubAdminRoutes(t *testing.T) {
	s := newWiredServer(t, nil)
	open := [][2]string{
		{"GET", "/api/v1/users"},
		{"POST", "/api/v1/users"},
		{"PATCH", "/api/v1/users/1"},
		{"PUT", "/api/v1/users/1/password"},
		{"PUT", "/api/v1/users/1/active"},
		{"DELETE", "/api/v1/users/1"},
		{"GET", "/api/v1/users/1/access"},
		{"PUT", "/api/v1/users/1/access"},
		{"GET", "/api/v1/access/me"},
	}
	for _, r := range open {
		if w := hitCancelled(s, r[0], r[1], "m"); w.Code == 404 || denyBodies[w.Body.String()] {
			t.Errorf("%s %s subadmin bị chặn: %d %s", r[0], r[1], w.Code, w.Body.String())
		}
	}
	const deny = `{"error":"Không có quyền (chỉ Admin)"}`
	closed := [][2]string{
		{"GET", "/api/v1/users/product-approvers"},
		{"PUT", "/api/v1/users/1/product-approval"},
		{"GET", "/api/v1/audit-log"},
		{"GET", "/api/v1/product-delete-requests"},
		{"POST", "/api/v1/product-delete-requests/1/resolve"},
		{"PATCH", "/api/v1/companies/1"},
		{"GET", "/api/v1/purchase-orders"},
		{"GET", "/api/v1/purchase-orders/1"},
		{"POST", "/api/v1/purchase-orders/1/resolve"},
		{"GET", "/api/v1/proposals"},
		{"POST", "/api/v1/proposals/1/resolve"},
		{"POST", "/api/adminListUsers"},
		{"POST", "/api/adminCreateUser"},
		{"POST", "/api/adminUpdateUser"},
		{"POST", "/api/adminSetPassword"},
		{"POST", "/api/adminSetActive"},
		{"POST", "/api/adminDeleteUser"},
		{"POST", "/api/getAuditLog"},
		{"POST", "/api/updateCongTy"},
	}
	for _, r := range closed {
		if w := hit(s, r[0], r[1], "m"); w.Code != 403 || w.Body.String() != deny {
			t.Errorf("%s %s subadmin: %d %s, mong 403 %s", r[0], r[1], w.Code, w.Body.String(), deny)
		}
	}
	// super-only vẫn là super-only
	if w := hit(s, "PUT", "/api/v1/companies/1/access", "m"); w.Code != 403 || w.Body.String() != `{"error":"Chỉ quản trị hệ thống"}` {
		t.Errorf("PUT /companies/1/access subadmin: %d %s", w.Code, w.Body.String())
	}
}
