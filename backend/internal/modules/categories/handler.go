package categories

import (
	"github.com/gin-gonic/gin"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/jsval"
)

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// RegisterRPC: module không có hàm /api/:fn nào; chỉ khai route "chỉ bản Go" file mẫu Điện lạnh
// (bảng route gốc /mau-nhap-*.xlsx đóng băng theo bản Node nên ngành mới đi dưới /api/v1).
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.RegisterGoRoute(rpc.GoRoute{Name: "mauNhapDienLanh", Method: "GET", Path: "/product-templates/dien-lanh", Perm: rpc.Public,
		Tag: "Sản phẩm", Summary: "File mẫu nhập hàng loạt Điện lạnh (.xlsx), tạo động từ dl-spec.js",
		Fields: []rpc.GoField{{Name: "hm", In: "query", Desc: "Hạng mục (vd Điều hoà không khí); trống = mọi hạng mục"}}})
}

// RegisterRoutes: GET /api/v1/product-templates/dien-lanh, công khai như các file mẫu ở gốc.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.GET("/product-templates/dien-lanh", func(c *gin.Context) {
		hm, err := queryHM(c)
		var buf []byte
		if err == nil {
			buf, err = BuildDlTemplate(hm)
		}
		sendTemplate(c, "Mau-nhap-dien-lanh", buf, err)
	})
}

// RegisterRoot gắn 3 route tải file mẫu nhập hàng loạt (server/index.js dòng 797-829). Không cần đăng nhập.
func (s *Service) RegisterRoot(root *gin.RouterGroup) {
	root.GET("/mau-nhap-thiet-bi-ve-sinh.xlsx", func(c *gin.Context) {
		buf, err := BuildVsTemplate()
		sendTemplate(c, "Mau-nhap-thiet-bi-ve-sinh", buf, err)
	})
	root.GET("/mau-nhap-cong-tac-o-cam.xlsx", func(c *gin.Context) {
		hm, err := queryHM(c)
		var buf []byte
		if err == nil {
			buf, err = BuildCtTemplate(hm)
		}
		sendTemplate(c, "Mau-nhap-cong-tac-o-cam", buf, err)
	})
	root.GET("/mau-nhap-son-nuoc.xlsx", func(c *gin.Context) {
		hm, err := queryHM(c)
		var buf []byte
		if err == nil {
			buf, err = BuildSonTemplate(hm)
		}
		sendTemplate(c, SonTemplateName(hm), buf, err)
	})
}

// queryHM = String((req.query && req.query.hm) || "").trim(). Lỗi = String() ném TypeError (nằm trong try của Node -> 500).
func queryHM(c *gin.Context) (string, error) {
	q := expressQuery(rawQuery(c.Request), "hm")
	return jsval.Trim(q.Str), q.Err
}

func sendTemplate(c *gin.Context, ten string, buf []byte, err error) {
	if err != nil {
		sendText(c, 500, "Lỗi tạo file mẫu: "+err.Error())
		return
	}
	h := c.Writer.Header()
	h.Set("Content-Type", xlsxMime)
	h.Set("Content-Disposition", `attachment; filename="`+ten+`-DezonQS.xlsx"`)
	h.Set("Cache-Control", "no-cache")
	send(c, 200, xlsxMime, buf)
}
