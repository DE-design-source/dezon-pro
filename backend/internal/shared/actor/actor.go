// Package actor: người thao tác của request - đúng các trường auth.sessionActor() trả về
// ({uid, u, r, ct, exp} lấy từ token rồi đè r / ct / u theo database).
package actor

import (
	"context"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Actor: thứ tự trường = thứ tự khoá của object bên Node (uid, u, r, ct, exp).
type Actor struct {
	UID any     `json:"uid"` // users.id (số)
	U   string  `json:"u"`   // username
	R   string  `json:"r"`   // role: "staff" | "subadmin" | "admin" | "super"
	CT  any     `json:"ct"`  // cong_ty_id hoặc nil
	Exp float64 `json:"exp"` // hạn token (ms)
	// SID: id phiên (user_sessions.id) trong token - đăng xuất thu hồi đúng phiên này (M1.2).
	// Không ra JSON / Map(): kết quả trả client và golden Node giữ nguyên dạng {uid, u, r, ct, exp}.
	SID string `json:"-"`
}

// IsAdmin: r là "admin" hoặc "super" ("super" có mọi quyền của admin).
func (a *Actor) IsAdmin() bool { return a != nil && (a.R == "admin" || a.R == "super") }

// IsSuper: r === "super".
func (a *Actor) IsSuper() bool { return a != nil && a.R == "super" }

// RoleSubAdmin: vai trò "Admin" trên giao diện (roadmap M14.7) - giữa nhân viên và quản trị công ty: chỉ quản lý tài khoản
// nhân viên của công ty mình trong phạm vi quyền của chính mình. Không phải IsAdmin (quyền dữ liệu như nhân viên).
const RoleSubAdmin = "subadmin"

// IsSubAdmin: r === "subadmin".
func (a *Actor) IsSubAdmin() bool { return a != nil && a.R == RoleSubAdmin }

// CanManageStaff: được vào các route quản lý tài khoản nhân viên (admin, super hoặc subadmin).
func (a *Actor) CanManageStaff() bool { return a.IsAdmin() || a.IsSubAdmin() }

// Map đổi sang object JS (khi mã Node dùng actor như object thường).
func (a *Actor) Map() *omap.Map {
	if a == nil {
		return nil
	}
	return omap.Of("uid", a.UID, "u", a.U, "r", a.R, "ct", a.CT, "exp", a.Exp)
}

// FromMap dựng Actor từ payload token / object {uid, u, r, ct, exp}.
func FromMap(m *omap.Map) *Actor {
	if m == nil {
		return nil
	}
	a := &Actor{UID: nilIfUndef(m.Val("uid")), CT: nilIfUndef(m.Val("ct"))}
	a.U = jsval.AsString(m.Val("u"))
	a.R = jsval.AsString(m.Val("r"))
	a.SID = jsval.AsString(m.Val("sid"))
	if f, ok := m.Val("exp").(float64); ok {
		a.Exp = f
	}
	return a
}

func nilIfUndef(v any) any {
	if jsval.IsUndefined(v) {
		return nil
	}
	return v
}

const ginKey = "qs.actor"

type ctxKey struct{}

// Set gắn actor vào gin.Context (middleware auth gọi). a có thể nil.
func Set(c *gin.Context, a *Actor) { c.Set(ginKey, a) }

// FromGin lấy actor của request; chưa đăng nhập -> nil.
func FromGin(c *gin.Context) *Actor {
	v, ok := c.Get(ginKey)
	if !ok {
		return nil
	}
	a, _ := v.(*Actor)
	return a
}

// With mang actor trong context.Context (cho tầng service của REST).
func With(ctx context.Context, a *Actor) context.Context {
	return context.WithValue(ctx, ctxKey{}, a)
}

// From lấy actor từ context.Context; không có -> nil.
func From(ctx context.Context) *Actor {
	a, _ := ctx.Value(ctxKey{}).(*Actor)
	return a
}
