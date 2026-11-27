package actor

import "testing"

// M14.7: subadmin không phải admin (quyền dữ liệu như nhân viên) nhưng được quản lý tài khoản nhân viên.
func TestRoles(t *testing.T) {
	cases := []struct {
		a                     *Actor
		admin, sub, can, supr bool
	}{
		{nil, false, false, false, false},
		{&Actor{R: "staff"}, false, false, false, false},
		{&Actor{R: ""}, false, false, false, false},
		{&Actor{R: RoleSubAdmin}, false, true, true, false},
		{&Actor{R: "admin"}, true, false, true, false},
		{&Actor{R: "super"}, true, false, true, true},
	}
	for _, c := range cases {
		r := "<nil>"
		if c.a != nil {
			r = c.a.R
		}
		if c.a.IsAdmin() != c.admin || c.a.IsSubAdmin() != c.sub || c.a.CanManageStaff() != c.can || c.a.IsSuper() != c.supr {
			t.Errorf("role %q: IsAdmin=%v IsSubAdmin=%v CanManageStaff=%v IsSuper=%v", r,
				c.a.IsAdmin(), c.a.IsSubAdmin(), c.a.CanManageStaff(), c.a.IsSuper())
		}
	}
	if RoleSubAdmin != "subadmin" {
		t.Errorf("RoleSubAdmin = %q", RoleSubAdmin)
	}
}
