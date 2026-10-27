package server

import (
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/platform/storage"
	"qspro-backend/internal/shared/response"
)

// Kiểu nội dung của file trong kho theo đuôi: ảnh (đuôi lấy từ kiểu MIME lúc tải lên, vd "svg+xml") và tài liệu
// materials nhận (DOC_EXT). Ngoài bảng -> application/octet-stream: không đoán theo nội dung, không trả text/html.
var uploadTypes = map[string]string{
	".png":     "image/png",
	".jpg":     "image/jpeg",
	".jpeg":    "image/jpeg",
	".gif":     "image/gif",
	".webp":    "image/webp",
	".avif":    "image/avif",
	".bmp":     "image/bmp",
	".svg":     "image/svg+xml",
	".svg+xml": "image/svg+xml",
	".pdf":     "application/pdf",
	".dwg":     "image/vnd.dwg",
	".dxf":     "image/vnd.dxf",
	".skp":     "application/vnd.sketchup.skp",
	".zip":     "application/zip",
	".rar":     "application/vnd.rar",
	".7z":      "application/x-7z-compressed",
	".doc":     "application/msword",
	".docx":    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":     "application/vnd.ms-excel",
	".xlsx":    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt":     "application/vnd.ms-powerpoint",
	".pptx":    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

// uploads phục vụ file của kho UPLOAD_DIR: GET / HEAD /files/<path>, công khai (đứng trước mọi route nên không tra phiên).
// Không có file, thư mục (không liệt kê), đường dẫn sai hoặc leo khỏi kho -> 404. Có Range, Last-Modified / 304.
// Kho cùng tên miền với ứng dụng: SVG kèm CSP sandbox để script trong file không chạy được.
func uploads(st *storage.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		r := c.Request
		if (r.Method != http.MethodGet && r.Method != http.MethodHead) || !strings.HasPrefix(r.URL.Path, storage.Prefix) {
			return
		}
		f, fi, err := st.Open(r.URL.Path[len(storage.Prefix):])
		if err != nil {
			response.HTMLError(c, http.StatusNotFound, "Cannot "+r.Method+" "+r.URL.EscapedPath())
			return
		}
		defer f.Close()
		ct := uploadTypes[strings.ToLower(path.Ext(fi.Name()))]
		if ct == "" {
			ct = "application/octet-stream"
		}
		h := c.Writer.Header()
		h.Set("Content-Type", ct)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Cache-Control", "public, max-age=86400")
		if ct == "image/svg+xml" {
			h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
		}
		http.ServeContent(c.Writer, r, fi.Name(), fi.ModTime(), f)
		c.Abort()
	}
}
