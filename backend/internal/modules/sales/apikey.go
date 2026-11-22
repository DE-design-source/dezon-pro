package sales

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/response"
)

// Khoá API CHỈ ĐỌC cho hệ thống ngoài (vd Vua Thầu đọc khách hàng lên bản đồ).
// Cấu hình: SALES_READ_KEYS = "ten:cong_ty_id:sha256hex" (nhiều khoá cách nhau dấu phẩy). Chỉ lưu SHA-256 của khoá,
// khoá thật chỉ bên dùng giữ. Gửi: Authorization: Bearer <khoá>.
//   - Chỉ dùng được cho GET /api/v1/sales/leads và GET /api/v1/sales/staff, thấy như admin của công ty đó
//     (mọi khách hàng của mọi phòng, cùng dữ liệu web đang dùng).
//   - Mọi phương thức / đường khác dưới /sales -> 403. Ngoài /sales khoá không phải phiên -> coi như chưa đăng nhập.
//   - Thu hồi: bỏ dòng khỏi SALES_READ_KEYS rồi khởi động lại api.

// MsgReadOnlyKey: trả khi khoá chỉ đọc gọi đường / phương thức không được phép.
const MsgReadOnlyKey = "Khoá API chỉ được đọc khách hàng (GET /sales/leads) và nhân sự (GET /sales/staff)"

type readKey struct {
	name string
	ct   string
	sum  [32]byte
}

// readKeyPaths: route (c.FullPath) khoá chỉ đọc được gọi, chỉ với GET.
var readKeyPaths = map[string]bool{"/api/v1/sales/leads": true, "/api/v1/sales/staff": true}

func parseReadKeys(s string) []readKey {
	var out []readKey
	for _, item := range strings.Split(s, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		p := strings.Split(item, ":")
		var sum []byte
		var err error
		if len(p) == 3 {
			sum, err = hex.DecodeString(strings.ToLower(strings.TrimSpace(p[2])))
		}
		if len(p) != 3 || strings.TrimSpace(p[0]) == "" || strings.TrimSpace(p[1]) == "" || err != nil || len(sum) != 32 {
			logger.Error("sales", "SALES_READ_KEYS: bỏ qua mục sai dạng (cần ten:cong_ty_id:sha256hex)")
			continue
		}
		k := readKey{name: strings.TrimSpace(p[0]), ct: strings.TrimSpace(p[1])}
		copy(k.sum[:], sum)
		out = append(out, k)
	}
	return out
}

func (s *Service) matchReadKey(tok string) *readKey {
	sum := sha256.Sum256([]byte(tok))
	var hit *readKey
	for i := range s.readKeys {
		if subtle.ConstantTimeCompare(sum[:], s.readKeys[i].sum[:]) == 1 {
			hit = &s.readKeys[i]
		}
	}
	return hit
}

// readKeyAuth: gắn TRƯỚC RequireLogin của group /sales. Đã có phiên đăng nhập / không có khoá cấu hình /
// token không khớp khoá nào -> để nguyên (RequireLogin quyết định).
func (s *Service) readKeyAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if len(s.readKeys) == 0 || actor.FromGin(c) != nil {
			return
		}
		tok := middleware.BearerToken(c.Request)
		if tok == "" {
			return
		}
		k := s.matchReadKey(tok)
		if k == nil {
			return
		}
		if c.Request.Method != http.MethodGet || !readKeyPaths[c.FullPath()] {
			response.Fail(c, 403, MsgReadOnlyKey, "READONLY_KEY")
			return
		}
		a := &actor.Actor{U: "apikey:" + k.name, R: "admin", CT: k.ct}
		actor.Set(c, a)
		c.Request = c.Request.WithContext(middleware.RequestContext(c.Request, a))
	}
}
