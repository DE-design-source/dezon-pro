package quotations

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
	"qspro-backend/internal/shared/response"
)

// quotations không cài interface nào của contracts; chỉ DÙNG ba interface dưới (kiểm lúc biên dịch rằng Deps khớp).
var (
	_ contracts.LineReader      = Deps{}.Lines
	_ contracts.ProjectReader   = Deps{}.Projects
	_ contracts.MediaDownloader = Deps{}.Media
)

// RegisterRPC: 4 hàm /api/:fn của module (index.js REGISTRY). Không hàm nào thuộc ACTOR_FNS, tất cả chỉ cần đăng nhập.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.Register("saveCover", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.SaveCover(ctx, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("buildCoverFromTemplate", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.BuildCoverFromTemplate(ctx, args.ArgU(0))
	})
	reg.Register("getCoverOrInit", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetCoverOrInit(ctx, args.ArgU(0))
	})
	reg.Register("exportBaoGia", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.ExportBaoGia(ctx, args.ArgU(0), args.ArgU(1), args.ArgU(2), args.ArgU(3), args.ArgU(4), args.ArgU(5),
			args.ArgU(6), args.ArgU(7), args.ArgU(8)) // tham số 9 (opts) chỉ bản Go
	})
}

// RegisterRoutes: REST /api/v1 (PORTING_MAP mục A). :id là mã dự án; các tham số còn lại lấy từ thân JSON theo tên tham số.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	p := v1.Group("/projects", middleware.RequireLogin())
	p.GET("/:id/cover", func(c *gin.Context) {
		r, err := s.GetCoverOrInit(c.Request.Context(), c.Param("id"))
		response.Result(c, r, err)
	})
	p.GET("/:id/cover/template", func(c *gin.Context) {
		r, err := s.BuildCoverFromTemplate(c.Request.Context(), c.Param("id"))
		response.Result(c, r, err)
	})
	p.PUT("/:id/cover", func(c *gin.Context) {
		b := readSaveCoverBody(c)
		r, err := s.SaveCover(c.Request.Context(), c.Param("id"), b.Rows)
		response.Result(c, r, doiLoiChiPhiAm(err, b.Rows))
	})
	p.POST("/:id/quotation/export", func(c *gin.Context) {
		b := readExportBody(c)
		r, err := s.ExportBaoGia(c.Request.Context(), c.Param("id"), b.Cols, b.Format, b.Nodes, b.PhanTho, b.AnMuc, b.Tong, b.Org, b.Opts)
		response.Result(c, r, err)
	})
}

// RegisterRoot: route lẻ POST /export/bang (index.js:780-794).
func (s *Service) RegisterRoot(root *gin.RouterGroup) {
	root.POST("/export/bang", s.exportBang)
}

// ETag yếu của Express cho res.send(Buffer).
func etagOf(b []byte) string {
	sum := sha1.Sum(b)
	return `W/"` + strconv.FormatInt(int64(len(b)), 16) + "-" + base64.StdEncoding.EncodeToString(sum[:])[:27] + `"`
}

// Xuất 1 bảng do client dựng sẵn ra Excel. Chạy NGOÀI ngữ cảnh công ty và không đọc database.
func (s *Service) exportBang(c *gin.Context) {
	if actor.FromGin(c) == nil {
		response.Fail(c, 401, "Chưa đăng nhập")
		return
	}
	b := bangBody(middleware.Body(c))
	if cols, ok := prop(b, "cols").([]any); !ok || len(cols) == 0 {
		response.Fail(c, 400, "Không có cột nào để xuất")
		return
	}
	buf, err := s.BuildBangXlsx(c.Request.Context(), b)
	if err != nil {
		logger.Error("export bảng", "lỗi:", err.Error())
		response.Fail(c, 500, err.Error())
		return
	}
	h := c.Writer.Header()
	h.Set("Content-Disposition", `attachment; filename="bang.xlsx"`)
	h.Set("ETag", etagOf(buf))
	h.Set("Content-Length", strconv.Itoa(len(buf)))
	c.Data(200, xlsxMime, buf)
}
