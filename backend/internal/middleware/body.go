package middleware

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/response"
)

const bodyKey = "qs.body"

// JSONBodyLimit: giới hạn thân JSON, bằng express.json({ limit: '30mb' }).
const JSONBodyLimit = 30 << 20

// DocMaxMB = store.DOC_MAX_MB của Node: giới hạn 1 file tài liệu tải lên. Phải bằng materials.DocMaxMB
// (middleware không import được module; internal/server có test giữ hai hằng bằng nhau).
const DocMaxMB = 300

// MsgUploadTooLarge: thông báo 413 của /upload/file (server/index.js 776).
var MsgUploadTooLarge = "File quá lớn (tối đa " + strconv.Itoa(DocMaxMB) + "MB) — hãy dán link thay vì tải lên."

// tooLarge: thân JSON vượt giới hạn -> trang 413 của Express. Riêng /upload/file bản Node có error middleware
// (server/index.js 775-778, app.use nên khớp cả đường dẫn con, không phân biệt hoa thường) trả JSON dễ hiểu.
func tooLarge(c *gin.Context) {
	p := strings.ToLower(c.Request.URL.Path)
	if p == "/upload/file" || strings.HasPrefix(p, "/upload/file/") {
		response.Fail(c, http.StatusRequestEntityTooLarge, MsgUploadTooLarge)
		c.Abort()
		return
	}
	response.HTMLError(c, http.StatusRequestEntityTooLarge, "Payload Too Large")
}

// JSONBody làm việc của express.json(): request có Content-Type application/json thì đọc thân
// (quá limit -> 413), phân tích về JS value model (chỉ nhận object / mảng, sai -> 400) và cất vào context.
// Thân gốc được đặt lại vào c.Request.Body để handler REST vẫn tự đọc được nếu muốn.
func JSONBody(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		if r.Body == nil || r.Body == http.NoBody || (r.ContentLength == 0 && len(r.TransferEncoding) == 0) {
			return
		}
		// Content-Type sai cú pháp (vd "application/json;" hay "application/json; foo") thì body-parser bỏ qua thân
		ct := r.Header.Get("Content-Type")
		mt, params, perr := mime.ParseMediaType(ct)
		if perr != nil || mt != "application/json" || strings.HasSuffix(strings.TrimRight(ct, " \t"), ";") {
			return
		}
		if cs := params["charset"]; cs != "" && !strings.HasPrefix(strings.ToLower(cs), "utf-") {
			response.HTMLError(c, http.StatusUnsupportedMediaType, "Unsupported Media Type")
			return
		}
		enc := strings.ToLower(r.Header.Get("Content-Encoding"))
		var src io.Reader = r.Body
		switch enc {
		case "", "identity":
			if r.ContentLength > limit {
				tooLarge(c)
				return
			}
		case "gzip":
			zr, err := gzip.NewReader(r.Body)
			if err != nil {
				response.HTMLError(c, http.StatusBadRequest, "Bad Request")
				return
			}
			src = zr
		case "deflate":
			zr, err := zlib.NewReader(r.Body)
			if err != nil {
				response.HTMLError(c, http.StatusBadRequest, "Bad Request")
				return
			}
			src = zr
		default:
			response.HTMLError(c, http.StatusUnsupportedMediaType, "Unsupported Media Type")
			return
		}
		// giới hạn tính trên dữ liệu SAU khi giải nén (như raw-body)
		raw, err := io.ReadAll(io.LimitReader(src, limit+1))
		if err != nil {
			response.HTMLError(c, http.StatusBadRequest, "Bad Request")
			return
		}
		if int64(len(raw)) > limit {
			tooLarge(c)
			return
		}
		if enc == "gzip" || enc == "deflate" {
			// handler phía sau đọc lại thân thì nhận bản đã giải nén
			r.Header.Del("Content-Encoding")
			r.ContentLength = int64(len(raw))
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		if cs := strings.ToLower(params["charset"]); cs != "" && cs != "utf-8" && cs != "utf8" {
			// utf-16 / utf-32: thân ASCII đọc theo bảng mã đó ra chữ vô nghĩa -> body-parser trả 400.
			// (Thân mã hoá UTF-16 thật thì Node đọc được; bản Go không hỗ trợ.)
			response.HTMLError(c, http.StatusBadRequest, "Bad Request")
			return
		}
		raw = bytes.TrimPrefix(raw, []byte("\xEF\xBB\xBF")) // iconv-lite bỏ BOM trước khi JSON.parse
		if len(raw) == 0 {
			return
		}
		// chế độ strict của body-parser: ký tự đầu phải là { hoặc [
		trimmed := strings.TrimLeft(string(raw), " \t\n\r")
		if trimmed == "" || (trimmed[0] != '{' && trimmed[0] != '[') {
			response.HTMLError(c, http.StatusBadRequest, "Bad Request")
			return
		}
		v, err := omap.Decode(raw)
		if err != nil {
			response.HTMLError(c, http.StatusBadRequest, "Bad Request")
			return
		}
		c.Set(bodyKey, v)
	}
}

// DrainBody: sau khi handler xong, đọc bỏ phần thân request CHƯA đọc - như Node (req._dump() sau khi trả lời).
// Thiếu bước này net/http chỉ đọc bỏ tối đa 256 KB rồi ĐÓNG kết nối: client đang gửi thân lớn (vd JSON quá 30 MB -> 413)
// không nhận được trang lỗi mà gặp lỗi kết nối / treo sau proxy. Đặt TRƯỚC JSONBody (giữ thân gốc, vì JSONBody thay r.Body).
// Request có "Expect: 100-continue" thì bỏ qua: client chưa gửi thân, đọc sẽ phải chờ.
func DrainBody() gin.HandlerFunc {
	return func(c *gin.Context) {
		body := c.Request.Body
		if body == nil || body == http.NoBody || strings.EqualFold(c.GetHeader("Expect"), "100-continue") {
			return
		}
		defer func() { _, _ = io.Copy(io.Discard, body) }()
		c.Next()
	}
}

// Body trả thân JSON đã phân tích (req.body): *omap.Map, []any, hoặc object rỗng khi không có thân JSON.
func Body(c *gin.Context) any {
	if v, ok := c.Get(bodyKey); ok {
		return v
	}
	return omap.New()
}

// BodyMap trả thân JSON nếu là object, ngược lại object rỗng.
func BodyMap(c *gin.Context) *omap.Map {
	if m, ok := Body(c).(*omap.Map); ok && m != nil {
		return m
	}
	return omap.New()
}
