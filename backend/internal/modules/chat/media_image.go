package chat

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif" // đăng ký bộ giải mã GIF (lấy khung đầu)
	"image/jpeg"
	_ "image/png" // đăng ký bộ giải mã PNG

	xdraw "golang.org/x/image/draw"
)

// Xử lý ảnh khi complete: đo kích thước (đã xoay theo EXIF), làm ảnh nhỏ JPEG cạnh dài 320 px, blurhash.
// Thu nhỏ TRƯỚC rồi mới xoay (xoay ảnh nhỏ rẻ hơn nhiều so với xoay ảnh gốc 40 triệu điểm).

// imageInfo: kết quả xử lý một ảnh.
type imageInfo struct {
	width, height int    // như hiển thị (đã áp EXIF orientation)
	thumb         []byte // JPEG ảnh nhỏ; nil = không cần (ảnh gốc là JPEG <= 320 px, không xoay) hoặc quá lớn để giải mã
	blurhash      string // "" khi quá lớn để giải mã
}

var errImageDecode = errors.New("không giải mã được ảnh")

// processImage: data là toàn bộ ảnh (jpeg / png / gif / webp). Quá mediaMaxPixels -> chỉ đo kích thước, không lỗi.
func processImage(data []byte) (*imageInfo, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, errImageDecode
	}
	orient := 1
	if format == "jpeg" {
		orient = exifOrientation(data)
	}
	info := &imageInfo{width: cfg.Width, height: cfg.Height}
	if orient >= 5 {
		info.width, info.height = cfg.Height, cfg.Width
	}
	if float64(cfg.Width)*float64(cfg.Height) > mediaMaxPixels {
		return info, nil
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errImageDecode
	}
	if !(format == "jpeg" && orient == 1 && max(cfg.Width, cfg.Height) <= mediaThumbEdge) {
		tw, th := thumbSize(cfg.Width, cfg.Height, mediaThumbEdge)
		small := orientImage(scaleOnWhite(src, tw, th, xdraw.CatmullRom), orient)
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, small, &jpeg.Options{Quality: 75}); err != nil {
			return nil, err
		}
		info.thumb = buf.Bytes()
	}
	info.blurhash = blurOf(src, orient)
	return info, nil
}

// blurOf: blurhash từ bản thu nhỏ cạnh dài 32 px (đã xoay).
func blurOf(src image.Image, orient int) string {
	b := src.Bounds()
	w, h := thumbSize(b.Dx(), b.Dy(), 32)
	return blurhashEncode(orientImage(scaleOnWhite(src, w, h, xdraw.ApproxBiLinear), orient), mediaBlurX, mediaBlurY)
}

// scaleOnWhite: thu ảnh về w x h trên nền trắng (ảnh trong suốt không thành nền đen khi ra JPEG).
func scaleOnWhite(src image.Image, w, h int, k xdraw.Interpolator) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	k.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
	return dst
}

// thumbSize: kích thước sau khi thu cạnh dài về edge (giữ tỉ lệ, tối thiểu 1 px); đã nhỏ hơn thì giữ nguyên.
func thumbSize(w, h, edge int) (int, int) {
	if w <= 0 || h <= 0 {
		return 0, 0
	}
	if max(w, h) <= edge {
		return w, h
	}
	if w >= h {
		return edge, max(1, int(float64(h)*float64(edge)/float64(w)+0.5))
	}
	return max(1, int(float64(w)*float64(edge)/float64(h)+0.5)), edge
}

// orientImage: áp EXIF orientation 2..8 (1 hoặc sai = giữ nguyên). 5..8 đổi chiều rộng / cao.
func orientImage(src *image.RGBA, o int) *image.RGBA {
	if o < 2 || o > 8 {
		return src
	}
	w, h := src.Bounds().Dx(), src.Bounds().Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			var sx, sy int
			switch o {
			case 2:
				sx, sy = w-1-x, y
			case 3:
				sx, sy = w-1-x, h-1-y
			case 4:
				sx, sy = x, h-1-y
			case 5:
				sx, sy = y, x
			case 6:
				sx, sy = y, h-1-x
			case 7:
				sx, sy = w-1-y, h-1-x
			case 8:
				sx, sy = w-1-y, x
			}
			dst.SetRGBA(x, y, src.RGBAAt(sx, sy))
		}
	}
	return dst
}

// exifOrientation: thẻ Orientation (0x0112) trong APP1 Exif của JPEG; không có / hỏng -> 1.
func exifOrientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	p := 2
	for p+4 <= len(data) {
		if data[p] != 0xFF {
			return 1
		}
		marker := data[p+1]
		if marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) || marker == 0xFF {
			p++
			continue
		}
		if marker == 0xDA || marker == 0xD9 { // bắt đầu dữ liệu ảnh: hết phần đầu
			return 1
		}
		n := int(binary.BigEndian.Uint16(data[p+2:]))
		if n < 2 || p+2+n > len(data) {
			return 1
		}
		seg := data[p+4 : p+2+n]
		if marker == 0xE1 && len(seg) >= 6 && string(seg[:6]) == "Exif\x00\x00" {
			return tiffOrientation(seg[6:])
		}
		p += 2 + n
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	if bo.Uint16(t[2:]) != 42 {
		return 1
	}
	off := int(bo.Uint32(t[4:]))
	if off < 8 || off+2 > len(t) {
		return 1
	}
	cnt := int(bo.Uint16(t[off:]))
	for i := 0; i < cnt; i++ {
		e := off + 2 + i*12
		if e+12 > len(t) {
			return 1
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			if bo.Uint16(t[e+2:]) != 3 { // kiểu SHORT
				return 1
			}
			v := int(bo.Uint16(t[e+8:]))
			if v < 1 || v > 8 {
				return 1
			}
			return v
		}
	}
	return 1
}

// posterJPEG: kiểm ảnh bìa video (jpeg / webp, cạnh dài <= 640 px). Trả JPEG để lưu (webp được đổi sang JPEG,
// JPEG giữ nguyên byte) + blurhash. Không hợp lệ -> lỗi.
func posterJPEG(data []byte) ([]byte, string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "webp") || cfg.Width <= 0 || cfg.Height <= 0 ||
		max(cfg.Width, cfg.Height) > mediaPosterEdge {
		return nil, "", errImageDecode
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", errImageDecode
	}
	out := data
	if format != "jpeg" {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
			return nil, "", err
		}
		out = buf.Bytes()
	}
	return out, blurOf(img, 1), nil
}
