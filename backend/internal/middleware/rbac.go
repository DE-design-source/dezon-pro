package middleware

import (
	"github.com/gin-gonic/gin"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
)

// Thông báo phân quyền - nguyên văn của server/index.js.
const (
	MsgNoAuth    = "Chưa đăng nhập"
	CodeNoAuth   = "NOAUTH"
	MsgAdminOnly = "Không có quyền (chỉ Admin)"
	MsgSuperOnly = "Chỉ quản trị hệ thống"
)

// Deny kiểm quyền theo đúng thứ tự của dispatcher Node: chưa đăng nhập (401) -> chỉ Admin (403) -> chỉ super (403).
// Trả status = 0 khi được phép.
func Deny(a *actor.Actor, needAdmin, needSuper bool) (status int, msg, code string) {
	if a == nil {
		return 401, MsgNoAuth, CodeNoAuth
	}
	// 'super' (quản trị hệ thống) có mọi quyền của admin
	if needAdmin && !a.IsAdmin() {
		return 403, MsgAdminOnly, ""
	}
	if needSuper && !a.IsSuper() {
		return 403, MsgSuperOnly, ""
	}
	return 0, "", ""
}

func require(needAdmin, needSuper bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if st, msg, code := Deny(actor.FromGin(c), needAdmin, needSuper); st != 0 {
			response.Fail(c, st, msg, code)
		}
	}
}

// RequireLogin: phải đăng nhập.
func RequireLogin() gin.HandlerFunc { return require(false, false) }

// RequireAdmin: admin hoặc super.
func RequireAdmin() gin.HandlerFunc { return require(true, false) }

// RequireStaffManager (M14.7): admin, super hoặc subadmin (route quản lý tài khoản nhân viên). Chặn giống hệt RequireAdmin:
// chưa đăng nhập 401 NOAUTH, nhân viên 403 "Không có quyền (chỉ Admin)".
func RequireStaffManager() gin.HandlerFunc {
	return func(c *gin.Context) {
		a := actor.FromGin(c)
		if a.CanManageStaff() {
			return
		}
		st, msg, code := Deny(a, true, false)
		response.Fail(c, st, msg, code)
	}
}

// RequireSuper: chỉ quản trị hệ thống.
func RequireSuper() gin.HandlerFunc { return require(false, true) }

// RequireAdminSuper: hàm vừa thuộc ADMIN_FNS vừa thuộc SUPER_FNS.
func RequireAdminSuper() gin.HandlerFunc { return require(true, true) }
