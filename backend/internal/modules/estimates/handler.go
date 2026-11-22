package estimates

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"strconv"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/response"
	"qspro-backend/internal/shared/validator"
)

// estimates không cài interface nào của contracts; chỉ DÙNG hai interface dưới (kiểm lúc biên dịch rằng Deps khớp).
var (
	_ contracts.ProductPerms = Deps{}.Perms
	_ contracts.Auditor      = Deps{}.Auditor
)

// RegisterRPC: 7 hàm /api/:fn của công tác (index.js:54-59, 78). Mọi hàm chỉ cần đăng nhập;
// ctSave / ctUpdate / ctDelete / ctDuyet / ctFav thuộc ACTOR_FNS (index.js:126) nên nhận actor. Hàm ghi (trừ ctDuyet: duyệt
// theo quyền sản phẩm M14.6, ngoài ma trận) bọc accRPC (N21, access_gate.go).
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.Register("ctList", rpc.Login, func(ctx context.Context, _ *actor.Actor, _ rpc.Args) (any, error) {
		return s.CtList(ctx)
	})
	reg.Register("ctSave", rpc.Login, s.accRPC("create", "QS > Danh sách sản phẩm", accCT, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.CtSaveGated(ctx, a, args.ArgU(0))
	}))
	reg.Register("ctUpdate", rpc.Login, s.accRPC("edit", "QS > Danh sách sản phẩm", accCT, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.CtUpdateGated(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("ctDelete", rpc.Login, s.accRPC("delete", "QS > Danh sách sản phẩm", accCT, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.CtDeleteGated(ctx, a, args.ArgU(0))
	}))
	reg.Register("ctDuyet", rpc.Login, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.CtDuyetGated(ctx, a, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("ctFav", rpc.Login, s.accRPC("edit", "QS", accQS, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.CtFavGated(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("ctHistory", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.CtGetHistory(ctx, args.ArgU(0))
	})
	// Route chỉ bản Go (roadmap M5.1): đọc file mẫu nhập công tác, không ghi database.
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "ctImportParse", Method: "POST", Path: "/work-items/import/parse", Perm: rpc.Login, Tag: "Công tác",
		Summary: "Đọc file nhập công tác (mẫu /mau-nhap-cong-tac.xlsx hoặc CSV cùng tiêu đề) -> {rows, loi}; cùng quyền với ctSave",
		Fields: []rpc.GoField{
			{Name: "base64", In: "body", Type: "string", Required: true, Desc: "nội dung file mã hoá base64"},
			{Name: "ext", In: "body", Type: "string", Desc: "đuôi file: xlsx (mặc định) hoặc csv"},
		},
	})
}

// RegisterRoutes: REST /api/v1/work-items - gọi đúng các phương thức mà cổng rpc gọi.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/work-items", middleware.RequireLogin())
	g.GET("", func(c *gin.Context) {
		r, err := s.CtList(c.Request.Context())
		response.Result(c, r, err)
	})
	// thân là 1 object công tác hoặc mảng object (như tham số data của ctSave)
	g.POST("", s.accMW("create", "QS > Danh sách sản phẩm", accCT), func(c *gin.Context) {
		r, err := s.CtSaveGated(c.Request.Context(), actor.FromGin(c), middleware.Body(c))
		response.Result(c, r, err)
	})
	g.PATCH("/:id", s.accMW("edit", "QS > Danh sách sản phẩm", accCT), func(c *gin.Context) {
		body, err := validator.Body(c)
		if err != nil {
			response.Error(c, err)
			return
		}
		r, err := s.CtUpdateGated(c.Request.Context(), actor.FromGin(c), c.Param("id"), body)
		response.Result(c, r, err)
	})
	g.POST("/delete", s.accMW("delete", "QS > Danh sách sản phẩm", accCT), func(c *gin.Context) {
		b := readBatch(middleware.BodyMap(c), "")
		r, err := s.CtDeleteGated(c.Request.Context(), actor.FromGin(c), b.IDs)
		response.Result(c, r, err)
	})
	g.POST("/approval", func(c *gin.Context) {
		b := readBatch(middleware.BodyMap(c), "approve")
		r, err := s.CtDuyetGated(c.Request.Context(), actor.FromGin(c), b.IDs, b.Flag)
		response.Result(c, r, err)
	})
	g.POST("/favorites", s.accMW("edit", "QS", accQS), func(c *gin.Context) {
		b := readBatch(middleware.BodyMap(c), "on")
		r, err := s.CtFavGated(c.Request.Context(), actor.FromGin(c), b.IDs, b.Flag)
		response.Result(c, r, err)
	})
	g.POST("/import/parse", s.accMW("create", "QS > Nhập dữ liệu", accCT), func(c *gin.Context) {
		b := middleware.BodyMap(c)
		r, err := s.CtImportParse(c.Request.Context(), actor.FromGin(c), b.Val("base64"), b.Val("ext"))
		response.Result(c, r, err)
	})
	g.GET("/:id/history", func(c *gin.Context) {
		r, err := s.CtGetHistory(c.Request.Context(), c.Param("id"))
		response.Result(c, r, err)
	})
}

// RegisterRoot: route lẻ POST /export/cong-tac (index.js:728-743).
func (s *Service) RegisterRoot(root *gin.RouterGroup) {
	root.POST("/export/cong-tac", s.accMW("export", "QS", accQS), s.exportCongTac)
}

// ETag yếu của Express cho res.send(Buffer).
func etagOf(b []byte) string {
	sum := sha1.Sum(b)
	return `W/"` + strconv.FormatInt(int64(len(b)), 16) + "-" + base64.StdEncoding.EncodeToString(sum[:])[:27] + `"`
}

// Client gửi thẳng các dòng đang xem, server chỉ dựng file. Chạy NGOÀI ngữ cảnh công ty và không đọc database.
func (s *Service) exportCongTac(c *gin.Context) {
	if actor.FromGin(c) == nil {
		response.Fail(c, 401, "Chưa đăng nhập")
		return
	}
	rows := jsval.AsArray(middleware.BodyMap(c).Val("rows"))
	if len(rows) > exportMaxRows {
		rows = rows[:exportMaxRows]
	}
	if len(rows) == 0 {
		response.Fail(c, 400, "Không có dòng nào để xuất")
		return
	}
	out, err := s.ExportCongTacXlsx(rows)
	if err != nil {
		logger.Error("export cong tac", "lỗi:", err.Error())
		response.Fail(c, 500, err.Error())
		return
	}
	h := c.Writer.Header()
	h.Set("Content-Disposition", `attachment; filename="`+out.Name+`"`)
	h.Set("X-Row-Count", strconv.Itoa(out.Count))
	h.Set("ETag", etagOf(out.Buf))
	h.Set("Content-Length", strconv.Itoa(len(out.Buf)))
	c.Data(200, xlsxMime, out.Buf)
}
