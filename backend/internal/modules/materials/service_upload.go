package materials

import (
	"context"
	"math/rand/v2"
	"regexp"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"

	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

var (
	reDataImg   = regexp.MustCompile(`^data:([^;]+);base64,`)
	reDataFile  = regexp.MustCompile(`^data:([^;]*);base64,`)
	reDuoi      = regexp.MustCompile(`\.[^.]+$`)
	reKhongHop  = regexp.MustCompile(`[^A-Za-z0-9_-]+`)
	reGachDau   = regexp.MustCompile(`^-+|-+$`)
	reKhoTuChoi = regexp.MustCompile(`(?i)\b413\b|too large|maximum allowed size`)
)

// bufferFromBase64 = Buffer.from(s, 'base64'): bỏ qua ký tự lạ, nhận cả bảng url-safe, dừng ở dấu '=' đầu tiên.
// (qscore có hàm này nhưng không xuất ra ngoài gói.)
func bufferFromBase64(s string) []byte {
	out := make([]byte, 0, len(s)*3/4)
	var acc uint32
	n := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		var v uint32
		switch {
		case c >= 'A' && c <= 'Z':
			v = uint32(c - 'A')
		case c >= 'a' && c <= 'z':
			v = uint32(c-'a') + 26
		case c >= '0' && c <= '9':
			v = uint32(c-'0') + 52
		case c == '+' || c == '-':
			v = 62
		case c == '/' || c == '_':
			v = 63
		case c == '=':
			i = len(s)
			continue
		default:
			continue
		}
		acc = acc<<6 | v
		if n++; n == 4 {
			out = append(out, byte(acc>>16), byte(acc>>8), byte(acc))
			acc, n = 0, 0
		}
	}
	switch n {
	case 2:
		out = append(out, byte(acc>>4))
	case 3:
		out = append(out, byte(acc>>10), byte(acc>>2))
	}
	return out
}

// UploadImage = uploadImage (S:965-974): ảnh base64 (có thể kèm tiền tố data:) -> kho file.
func (s *Service) UploadImage(ctx context.Context, base64, fileName any) (*omap.Map, error) {
	src := jsval.S(base64)
	ct := "image/jpeg"
	raw := src
	if loc := reDataImg.FindStringSubmatchIndex(src); loc != nil {
		ct = src[loc[2]:loc[3]]
		raw = src[loc[1]:]
	}
	buf := bufferFromBase64(raw)
	if len(buf) == 0 {
		return nil, apperr.New("Ảnh rỗng.")
	}
	ext := "jpg"
	if p := strings.Split(ct, "/"); len(p) > 1 && p[1] != "" {
		ext = p[1]
	}
	ext = strings.Replace(ext, "jpeg", "jpg", 1)
	path := "sp/" + jsval.NumberToString(jsval.NowMs()) + "-" + jsval.NumberToString(float64(rand.IntN(1000000))) + "." + ext
	url, err := s.uploader.Upload(ctx, buf, path, ct)
	if err != nil {
		return nil, err
	}
	return omap.Of("token", url, "url", url), nil
}

// UploadFile = uploadFile (S:980-983): bản cũ nhận base64 qua /api/uploadFile, giữ cho tab mở từ trước.
func (s *Service) UploadFile(ctx context.Context, base64, fileName any) (*omap.Map, error) {
	src := jsval.S(base64)
	ct := ""
	raw := src
	if loc := reDataFile.FindStringSubmatchIndex(src); loc != nil {
		ct = src[loc[2]:loc[3]]
		raw = src[loc[1]:]
	}
	return s.UploadFileBuf(ctx, bufferFromBase64(raw), fileName, ct)
}

// UploadFileBuf = uploadFileBuf (S:985-1003): file nhị phân -> kho file, giữ đuôi và tên gốc (đã bỏ dấu).
// contentType rỗng -> application/octet-stream.
func (s *Service) UploadFileBuf(ctx context.Context, buf []byte, fileName any, contentType string) (*omap.Map, error) {
	return s.uploadDoc(ctx, buf, float64(len(buf)), fileName, contentType)
}

// uploadDoc: doDai = buf.length như JS thấy. Tách khỏi len(buf) vì ở /upload/file thân JSON đã bị express.json đọc
// thành mảng / object: Node kiểm tra .length của giá trị đó rồi gửi String(giá trị) lên kho.
func (s *Service) uploadDoc(ctx context.Context, buf []byte, doDai any, fileName any, contentType string) (*omap.Map, error) {
	return saveDoc(doDai, fileName, contentType, func(path, ct string) (string, error) {
		return s.uploader.Upload(ctx, buf, path, ct)
	})
}

// saveDoc: kiểm tra (rỗng, cỡ, tên, đuôi) theo thứ tự của uploadFileBuf, dựng đường dẫn docs/<ms>-<tên>.<đuôi> rồi gọi put
// để lưu (buf trong RAM qua Upload, hoặc tệp tạm đã ghi theo luồng qua TempFile.Commit).
func saveDoc(doDai any, fileName any, contentType string, put func(path, contentType string) (string, error)) (*omap.Map, error) {
	if !jsval.Truthy(doDai) {
		return nil, apperr.New("File rỗng.")
	}
	mb := jsval.ToNumber(doDai) / 1048576
	if mb > DocMaxMB {
		return nil, apperr.New("File " + jsval.ToFixed(mb, 1) + "MB quá lớn (tối đa " + jsval.NumberToString(DocMaxMB) + "MB) — hãy dán link thay vì tải lên.")
	}
	ten := jsval.S(fileName)
	if i := strings.LastIndexAny(ten, `\/`); i >= 0 {
		ten = ten[i+1:]
	}
	if ten == "" {
		ten = "tai-lieu"
	}
	// tên không có dấu chấm: cả tên là "đuôi" (S:990)
	ext := cases.Lower(language.Und).String(ten[strings.LastIndexByte(ten, '.')+1:])
	if !docExt.MatchString(ext) {
		return nil, apperr.New("Định dạng ." + ext + " chưa hỗ trợ (PDF, ảnh, DWG/DXF, SKP, ZIP/RAR, Word, Excel).")
	}
	var b strings.Builder
	for _, r := range norm.NFD.String(reDuoi.ReplaceAllString(ten, "")) {
		switch {
		case r >= 0x300 && r <= 0x36f:
		case r == 'đ':
			b.WriteByte('d')
		case r == 'Đ':
			b.WriteByte('D')
		default:
			b.WriteRune(r)
		}
	}
	goc := reGachDau.ReplaceAllString(reKhongHop.ReplaceAllString(b.String(), "-"), "")
	if len(goc) > 60 { // tới đây chỉ còn ASCII
		goc = goc[:60]
	}
	if goc == "" {
		goc = "tai-lieu"
	}
	path := "docs/" + jsval.NumberToString(jsval.NowMs()) + "-" + goc + "." + ext
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	url, err := put(path, contentType)
	if err != nil {
		if reKhoTuChoi.MatchString(err.Error()) {
			return nil, apperr.New("Kho file từ chối: file " + jsval.ToFixed(mb, 1) + "MB vượt giới hạn — hãy dán link thay vì tải lên.")
		}
		return nil, err
	}
	return omap.Of("url", url, "name", ten), nil
}
