package projects

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
	_ "golang.org/x/image/webp" // đăng ký bộ giải mã WebP
)

// Ảnh nhập từ dezon.vn lưu trên máy chủ QS: JPEG cạnh dài tối đa 1280 px, chất lượng 78 (ảnh gốc PNG 0.5-2.5 MB).
// orientImage / exifOrientation / scaleOnWhite / thumbSize chép từ chat/media_image.go (gói module không import lẫn nhau).

const (
	dzImgEdge      = 1280
	dzImgQuality   = 78
	dzImgMaxPixels = 40_000_000 // ảnh lớn hơn không giải mã (chặn ảnh "bom" ngốn RAM)
)

// dzDecodeSem: số ảnh giải mã cùng lúc trên cả máy chủ (mọi lượt nhập, mọi công ty) - ảnh gốc lớn tốn vài trăm MB RAM khi giải mã.
var dzDecodeSem = make(chan struct{}, 2)

var errDzImage = errors.New("không đọc được ảnh")

// dzShrinkJPEG: ảnh jpeg / png / webp / gif -> JPEG đã xoay theo EXIF, thu cạnh dài về dzImgEdge (không phóng to).
func dzShrinkJPEG(data []byte) ([]byte, error) {
	dzDecodeSem <- struct{}{}
	defer func() { <-dzDecodeSem }()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, errDzImage
	}
	if float64(cfg.Width)*float64(cfg.Height) > dzImgMaxPixels {
		return nil, errors.New("ảnh quá lớn")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errDzImage
	}
	orient := 1
	if format == "jpeg" {
		orient = exifOrientation(data)
	}
	b := src.Bounds()
	w, h := thumbSize(b.Dx(), b.Dy(), dzImgEdge)
	out := orientImage(scaleOnWhite(src, w, h, xdraw.CatmullRom), orient)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: dzImgQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
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
