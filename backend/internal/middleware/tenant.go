package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/reqcache"
	"qspro-backend/internal/shared/tenant"
)

// ViewCompany: header x-view-company (Node nối các header trùng tên bằng ", ").
func ViewCompany(r *http.Request) string {
	return strings.Join(r.Header.Values("X-View-Company"), ", ")
}

// RequestContext dựng context cho tầng service, đúng như dispatcher của Node:
//   - ngữ cảnh CÔNG TY: mọi truy vấn bên dưới tự lọc theo công ty của người đăng nhập;
//     super admin không gán công ty -> thấy toàn hệ thống, có thể "xem như" 1 công ty qua header x-view-company;
//   - chưa đăng nhập -> không có ngữ cảnh (không lọc);
//   - KHÔNG huỷ theo kết nối của client: Node vẫn chạy hết handler khi client ngắt giữa chừng;
//   - bộ đệm theo request (reqcache): quyền thực của phân quyền 3 cấp chỉ tính 1 lần mỗi request.
func RequestContext(r *http.Request, a *actor.Actor) context.Context {
	ctx := reqcache.With(context.WithoutCancel(r.Context()))
	if a == nil {
		return ctx
	}
	var viewAs any
	if a.R == "super" {
		if v := ViewCompany(r); v != "" {
			viewAs = v
		}
	}
	ctx = tenant.With(ctx, tenant.Ctx{UID: a.UID, Role: a.R, CongTyID: jsval.Or(a.CT, nil), ViewAs: viewAs})
	return actor.With(ctx, a)
}

// Tenant gắn RequestContext vào c.Request (dùng sau Auth) để handler REST gọi service bằng c.Request.Context().
func Tenant() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request = c.Request.WithContext(RequestContext(c.Request, actor.FromGin(c)))
	}
}
