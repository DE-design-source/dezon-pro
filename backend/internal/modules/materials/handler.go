package materials

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"mime"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/response"
)

// RegisterRPC: 20 hàm /api/:fn của module (REGISTRY, I:31-116). Hàm thuộc ACTOR_FNS (I:119-127) nhận actor;
// deleteDbProduct, listDeleteRequests, resolveDeleteRequest thuộc ADMIN_FNS (I:130-135).
// Tham số thiếu ở cuối = undefined (ArgU): setSpDuyet / setYeuThich coi thiếu và null là "bật".
// Hàm ghi bọc accRPC (N21, access_gate.go), trừ setSpDuyet (duyệt sản phẩm M14.6, ngoài ma trận) và tải tệp lên.
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	reg.Register("getProducts", rpc.Login, func(ctx context.Context, _ *actor.Actor, _ rpc.Args) (any, error) {
		return s.GetProducts(ctx)
	})
	reg.Register("saveDbProduct", rpc.Login, s.accRPC("create", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.CreateProductGated(ctx, a, args.ArgU(0))
	}))
	reg.Register("uploadImage", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.UploadImage(ctx, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("uploadFile", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.UploadFile(ctx, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("deleteDbProduct", rpc.Admin, s.accRPC("delete", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.DeleteDbProduct(ctx, a, args.ArgU(0))
	}))
	reg.Register("getDbProduct", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetDbProduct(ctx, args.ArgU(0))
	})
	reg.Register("updateDbProductTracked", rpc.Login, s.accRPC("edit", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.UpdateProductGated(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("setSpDuyet", rpc.Login, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SetSpDuyetGated(ctx, a, args.ArgU(0), args.ArgU(1))
	})
	reg.Register("setYeuThich", rpc.Login, s.accRPC("edit", "QS", accQS, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SetYeuThichGated(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("getCombo", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetCombo(ctx, args.ArgU(0))
	})
	reg.Register("setCombo", rpc.Login, s.accRPC("edit", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SetComboGated(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("getBienThe", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetBienThe(ctx, args.ArgU(0))
	})
	reg.Register("setBienThe", rpc.Login, s.accRPC("edit", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.SetBienTheGated(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("spMyPerms", rpc.Login, func(ctx context.Context, a *actor.Actor, _ rpc.Args) (any, error) {
		return s.SpMyPerms(ctx, a)
	})
	reg.Register("getProductHistory", rpc.Login, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.GetProductHistory(ctx, args.ArgU(0))
	})
	reg.Register("importParse", rpc.Login, s.accRPC("create", "QS > Nhập dữ liệu", accImport, func(ctx context.Context, _ *actor.Actor, args rpc.Args) (any, error) {
		return s.ImportParse(ctx, args.ArgU(0), args.ArgU(1), args.ArgU(2))
	}))
	reg.Register("importCommit", rpc.Login, s.accRPC("create", "QS > Nhập dữ liệu", accImport, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.ImportGated(ctx, a, args.ArgU(0))
	}))
	reg.Register("requestDeleteProducts", rpc.Login, s.accRPC("delete", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.RequestDeleteProducts(ctx, a, args.ArgU(0), args.ArgU(1))
	}))
	reg.Register("listDeleteRequests", rpc.Admin, func(ctx context.Context, a *actor.Actor, _ rpc.Args) (any, error) {
		return s.ListDeleteRequests(ctx, a)
	})
	reg.Register("resolveDeleteRequest", rpc.Admin, s.accRPC("delete", "QS > Danh sách sản phẩm", accProduct, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
		return s.ResolveDeleteRequest(ctx, a, args.ArgU(0), args.ArgU(1), args.ArgU(2))
	}))
	// Route chỉ bản Go (roadmap M10.1): tạo bản sao riêng từ sản phẩm kho chung Dezon.
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "copySharedProduct", Method: "POST", Path: "/products/:key/private-copy", Perm: rpc.Login, Tag: "Sản phẩm",
		Summary: "Tạo bản sao riêng (Chưa duyệt, không combo / biến thể) của sản phẩm kho chung Dezon cho công ty mình -> {ok, id, ma, ten}",
		Fields:  []rpc.GoField{{Name: "key", In: "path", Type: "string", Required: true, Desc: "id dòng của sản phẩm trong kho chung Dezon"}},
	})
	// Route chỉ bản Go (roadmap M14.6): quyền duyệt sản phẩm theo phân cấp của tài khoản đang đăng nhập.
	reg.RegisterGoRoute(rpc.GoRoute{
		Name: "spApprovalRights", Method: "GET", Path: "/product-approval-rights", Perm: rpc.Login, Tag: "Sản phẩm",
		Summary: "Quyền duyệt sản phẩm của tài khoản đang đăng nhập -> {duyet, giaoDuyet} (super luôn có; admin khi được super giao; nhân viên có sp_duyet thì duyệt được, không giao được)",
	})
}

// RegisterRoutes: REST /api/v1 (PORTING_MAP mục A) - gọi đúng phương thức service mà hàm rpc gọi.
// :key là id dòng (toàn chữ số) hoặc mã sản phẩm; riêng /history nhận MÃ.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	login, admin := middleware.RequireLogin(), middleware.RequireAdmin()
	ctx := func(c *gin.Context) context.Context { return c.Request.Context() }

	p := v1.Group("/products")
	p.GET("", login, func(c *gin.Context) {
		r, err := s.GetProducts(ctx(c))
		response.Result(c, r, err)
	})
	p.POST("", login, s.accMW("create", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.CreateProductGated(ctx(c), actor.FromGin(c), middleware.Body(c))
		response.Result(c, r, err)
	})
	p.GET("/:key", login, func(c *gin.Context) {
		r, err := s.GetDbProduct(ctx(c), c.Param("key"))
		response.Result(c, r, err)
	})
	p.PATCH("/:key", login, s.accMW("edit", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.UpdateProductGated(ctx(c), actor.FromGin(c), c.Param("key"), middleware.Body(c))
		response.Result(c, r, err)
	})
	p.DELETE("/:key", admin, s.accMW("delete", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.DeleteDbProduct(ctx(c), actor.FromGin(c), c.Param("key"))
		response.Result(c, r, err)
	})
	p.GET("/:key/combo", login, func(c *gin.Context) {
		r, err := s.GetCombo(ctx(c), c.Param("key"))
		response.Result(c, r, err)
	})
	p.PUT("/:key/combo", login, s.accMW("edit", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.SetComboGated(ctx(c), actor.FromGin(c), c.Param("key"), bodyVal(c, "items"))
		response.Result(c, r, err)
	})
	p.GET("/:key/variants", login, func(c *gin.Context) {
		r, err := s.GetBienThe(ctx(c), c.Param("key"))
		response.Result(c, r, err)
	})
	p.PUT("/:key/variants", login, s.accMW("edit", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.SetBienTheGated(ctx(c), actor.FromGin(c), c.Param("key"), bodyVal(c, "ids"))
		response.Result(c, r, err)
	})
	p.GET("/:key/history", login, func(c *gin.Context) {
		r, err := s.GetProductHistory(ctx(c), c.Param("key"))
		response.Result(c, r, err)
	})
	// route chỉ bản Go (M10.1), khai ở RegisterRPC
	p.POST("/:key/private-copy", login, s.accMW("create", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.CopySharedProduct(ctx(c), actor.FromGin(c), c.Param("key"))
		response.Result(c, r, err)
	})

	v1.POST("/product-approvals", login, func(c *gin.Context) {
		r, err := s.SetSpDuyetGated(ctx(c), actor.FromGin(c), bodyVal(c, "keys"), bodyVal(c, "approve"))
		response.Result(c, r, err)
	})
	v1.POST("/product-favorites", login, s.accMW("edit", "QS", accQS), func(c *gin.Context) {
		r, err := s.SetYeuThichGated(ctx(c), actor.FromGin(c), bodyVal(c, "keys"), bodyVal(c, "on"))
		response.Result(c, r, err)
	})
	v1.GET("/product-permissions", login, func(c *gin.Context) {
		r, err := s.SpMyPerms(ctx(c), actor.FromGin(c))
		response.Result(c, r, err)
	})
	// route chỉ bản Go (M14.6), khai ở RegisterRPC
	v1.GET("/product-approval-rights", login, func(c *gin.Context) {
		r, err := s.SpApprovalRightsOut(ctx(c), actor.FromGin(c))
		response.Result(c, r, err)
	})
	v1.POST("/uploads/images", login, func(c *gin.Context) {
		r, err := s.UploadImage(ctx(c), bodyVal(c, "base64"), bodyVal(c, "fileName"))
		response.Result(c, r, err)
	})
	v1.POST("/uploads/files-base64", login, func(c *gin.Context) {
		r, err := s.UploadFile(ctx(c), bodyVal(c, "base64"), bodyVal(c, "fileName"))
		response.Result(c, r, err)
	})
	v1.POST("/product-imports/parse", login, s.accMW("create", "QS > Nhập dữ liệu", accImport), func(c *gin.Context) {
		r, err := s.ImportParse(ctx(c), bodyVal(c, "base64"), bodyVal(c, "ext"), bodyVal(c, "nganh"))
		response.Result(c, r, err)
	})
	v1.POST("/product-imports/commit", login, s.accMW("create", "QS > Nhập dữ liệu", accImport), func(c *gin.Context) {
		r, err := s.ImportGated(ctx(c), actor.FromGin(c), bodyVal(c, "products"))
		response.Result(c, r, err)
	})

	d := v1.Group("/product-delete-requests")
	d.POST("", login, s.accMW("delete", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.RequestDeleteProducts(ctx(c), actor.FromGin(c), bodyVal(c, "items"), bodyVal(c, "lyDo"))
		response.Result(c, r, err)
	})
	d.GET("", admin, func(c *gin.Context) {
		r, err := s.ListDeleteRequests(ctx(c), actor.FromGin(c))
		response.Result(c, r, err)
	})
	d.POST("/:id/resolve", admin, s.accMW("delete", "QS > Danh sách sản phẩm", accProduct), func(c *gin.Context) {
		r, err := s.ResolveDeleteRequest(ctx(c), actor.FromGin(c), c.Param("id"), bodyVal(c, "approve"), bodyVal(c, "lyDo"))
		response.Result(c, r, err)
	})
}

// RegisterRoot: route lẻ POST /export/san-pham (I:744-760) và POST /upload/file (I:763-778).
func (s *Service) RegisterRoot(root *gin.RouterGroup) {
	root.POST("/export/san-pham", s.accMW("export", "QS", accQS), s.exportSanPham)
	root.POST("/upload/file", s.uploadFileRoute)
}

// ETag yếu của Express cho res.send(Buffer).
func etagOf(b []byte) string {
	sum := sha1.Sum(b)
	return `W/"` + strconv.FormatInt(int64(len(b)), 16) + "-" + base64.StdEncoding.EncodeToString(sum[:])[:27] + `"`
}

// exportSanPham: thân {keys?}. Chạy trong ngữ cảnh công ty của người đăng nhập (kể cả x-view-company của super) -
// group root đã dựng sẵn ngữ cảnh đó, đúng như tctx của I:747-748.
func (s *Service) exportSanPham(c *gin.Context) {
	if actor.FromGin(c) == nil {
		response.Fail(c, 401, "Chưa đăng nhập")
		return
	}
	keys, _ := middleware.BodyMap(c).Val("keys").([]any) // không phải mảng -> null = xuất tất cả
	out, err := s.ExportProductsXlsx(c.Request.Context(), keys)
	if err != nil {
		logger.Error("export SP", "lỗi:", err.Error())
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

// uploadLimit: giới hạn thân của express.raw ở /upload/file = (DOC_MAX_MB + 1) MB.
const uploadLimit = (DocMaxMB + 1) << 20

// loiQuaLon (I:776): số MB lấy từ DocMaxMB như Node lấy từ store.DOC_MAX_MB.
var loiQuaLon = "File quá lớn (tối đa " + strconv.Itoa(DocMaxMB) + "MB) — hãy dán link thay vì tải lên."

// laJSON: Content-Type mà express.json nhận (cùng phép thử với middleware.JSONBody).
func laJSON(ct string) bool {
	mt, _, err := mime.ParseMediaType(ct)
	return err == nil && mt == "application/json" && !strings.HasSuffix(strings.TrimRight(ct, " \t"), ";")
}

// qsDecode = utils.decode của qs: '+' thành dấu cách; chuỗi %xx hỏng thì giữ nguyên văn (không bỏ cả cặp như net/url).
func qsDecode(s string) string {
	s = strings.ReplaceAll(s, "+", " ")
	if d, err := jsval.DecodeURIComponent(s); err == nil {
		return d
	}
	return s
}

// qsName = String(req.query.name || "") theo bộ phân tích query "extended" của Express 4 (qs, arrayLimit 1000): chỉ tách
// ở '&' (không tách ở ';'), name lặp lại / name[] / name[i] (i <= 1000) gộp thành mảng rồi nối bằng dấu phẩy, dạng khác
// của name[...] là object -> "[object Object]". Chưa tái hiện: object trộn với chuỗi / mảng (Node có thể ra
// "a,[object Object]"), nhiều nhóm ngoặc liên tiếp như name[][] (Node ra mảng lồng), mảng quá 1000 phần tử.
func qsName(raw string) string {
	// tempObj của qs: khoá đã giải mã -> các giá trị, theo thứ tự xuất hiện
	var khoa []string
	giaTri := map[string][]string{}
	parts := strings.Split(raw, "&")
	if len(parts) > 1000 { // parameterLimit
		parts = parts[:1000]
	}
	for _, p := range parts {
		pos := strings.Index(p, "]=")
		if pos < 0 {
			pos = strings.IndexByte(p, '=')
		} else {
			pos++
		}
		k, v := "", ""
		if pos < 0 {
			k = qsDecode(p)
		} else {
			k, v = qsDecode(p[:pos]), qsDecode(p[pos+1:])
		}
		if _, co := giaTri[k]; !co {
			khoa = append(khoa, k)
		}
		giaTri[k] = append(giaTri[k], v)
	}
	const (
		chua = iota
		chuoi
		mang
		doiTuong
	)
	loai, str := chua, ""
	var arr []*string // nil = ô trống của mảng thưa
	for _, k := range khoa {
		vals := giaTri[k]
		var src []*string // nguồn dạng mảng; nil = nguồn là chuỗi đơn vals[0]
		switch {
		case k == "name":
			if len(vals) > 1 {
				for i := range vals {
					src = append(src, &vals[i])
				}
			}
		case strings.HasPrefix(k, "name["):
			// splitKeyIntoSegments: nhóm ngoặc đầu tiên (đếm ngoặc lồng); không đóng ngoặc -> cả phần còn lại là 1 khoá object
			dong := -1
			for i, muc := 5, 1; i < len(k) && dong < 0; i++ {
				switch k[i] {
				case '[':
					muc++
				case ']':
					if muc--; muc == 0 {
						dong = i
					}
				}
			}
			if dong < 0 || strings.IndexByte(k[dong+1:], '[') >= 0 {
				loai = doiTuong
				continue
			}
			trong := k[5:dong]
			idx, err := strconv.Atoi(trong)
			switch {
			case trong == "":
				for i := range vals {
					src = append(src, &vals[i])
				}
			case err == nil && idx >= 0 && idx <= 1000 && strconv.Itoa(idx) == trong:
				src = make([]*string, idx+1)
				gop := strings.Join(vals, ",")
				src[idx] = &gop
			default:
				loai = doiTuong
				continue
			}
		default:
			continue
		}
		// utils.merge(đích, nguồn) của qs
		switch {
		case loai == doiTuong:
		case loai == chua && src == nil:
			loai, str = chuoi, vals[0]
		case loai == chua:
			loai, arr = mang, src
		case src == nil: // nguồn là chuỗi: rỗng thì bỏ qua, không thì đẩy vào mảng
			if vals[0] != "" && loai == mang {
				arr = append(arr, &vals[0])
			}
		case loai == chuoi:
			s0 := str
			loai, arr = mang, append([]*string{&s0}, src...)
		default: // mảng với mảng: ô đã có thì đẩy xuống cuối, ô trống thì điền
			for i, it := range src {
				switch {
				case it == nil:
				case i < len(arr) && arr[i] != nil:
					arr = append(arr, it)
				default:
					for len(arr) <= i {
						arr = append(arr, nil)
					}
					arr[i] = it
				}
			}
		}
	}
	switch loai {
	case chuoi:
		return str
	case doiTuong:
		return "[object Object]"
	case mang:
		out := []string{}
		for _, it := range arr { // utils.compact bỏ ô trống
			if it != nil {
				out = append(out, *it)
			}
		}
		return strings.Join(out, ",")
	}
	return ""
}

// uploadFileRoute: thân = nội dung file (mọi Content-Type), ?name= tên gốc. Chạy NGOÀI ngữ cảnh công ty (không đọc database).
// Thứ tự như Node: express.raw đọc thân trước (quá giới hạn -> 413 JSON, kể cả khi chưa đăng nhập) rồi mới kiểm tra đăng nhập.
func (s *Service) uploadFileRoute(c *gin.Context) {
	r := c.Request
	var buf []byte
	var doDai any = 0.0 // req.body.length
	// Khoá "qs.body" là nơi middleware.JSONBody cất thân đã phân tích.
	if parsed, daDoc := c.Get("qs.body"); daDoc {
		// Thân application/json đã bị express.json đọc trước: express.raw bỏ qua, req.body là mảng / object chứ không phải
		// Buffer. uploadFileBuf chỉ nhìn .length rồi fetch gửi String(req.body) lên kho.
		switch v := parsed.(type) {
		case []any:
			buf, doDai = []byte(jsval.ToString(v)), float64(len(v))
		case *omap.Map:
			buf, doDai = []byte("[object Object]"), v.Val("length")
		}
	} else if r.Body != nil && (r.ContentLength != 0 || len(r.TransferEncoding) > 0 || r.Header.Get("Content-Length") != "") {
		// express.raw (body-parser): giải nén gzip / deflate, giới hạn tính trên dữ liệu SAU khi giải nén
		var src io.Reader = r.Body
		switch strings.ToLower(r.Header.Get("Content-Encoding")) {
		case "", "identity":
			if r.ContentLength > uploadLimit {
				response.Fail(c, 413, loiQuaLon)
				return
			}
		case "gzip":
			zr, err := gzip.NewReader(r.Body)
			if err != nil {
				response.HTMLError(c, 400, "Bad Request")
				return
			}
			src = zr
		case "deflate":
			zr, err := zlib.NewReader(r.Body)
			if err != nil {
				response.HTMLError(c, 400, "Bad Request")
				return
			}
			src = zr
		default:
			response.HTMLError(c, 415, "Unsupported Media Type")
			return
		}
		b, err := io.ReadAll(io.LimitReader(src, uploadLimit+1))
		if len(b) > uploadLimit {
			response.Fail(c, 413, loiQuaLon)
			return
		}
		if err != nil {
			response.HTMLError(c, 400, "Bad Request")
			return
		}
		// Thân JSON chỉ có BOM: express.json đặt req.body = {} (JSONBody không cất gì cho thân rỗng sau BOM)
		if !(laJSON(r.Header.Get("Content-Type")) && len(bytes.TrimPrefix(b, []byte("\xEF\xBB\xBF"))) == 0) {
			buf, doDai = b, float64(len(b))
		}
	}
	if actor.FromGin(c) == nil {
		response.Fail(c, 401, "Chưa đăng nhập")
		return
	}
	out, err := s.uploadDoc(r.Context(), buf, doDai, qsName(r.URL.RawQuery), c.GetHeader("Content-Type"))
	if err != nil {
		logger.Error("upload file", "lỗi:", err.Error())
		response.Fail(c, 400, err.Error())
		return
	}
	response.JSON(c, 200, out)
}
