package chat

import (
	"image"
	"math"
	"strings"
)

// Blurhash (https://blurha.sh): chuỗi ngắn mô tả ảnh mờ, client vẽ trong lúc chờ tải ảnh thật. Bộ mã hoá theo đặc tả
// gốc; ảnh vào nên nhỏ (ảnh nhỏ cạnh dài 32 px) vì chi phí = số điểm ảnh x số thành phần.

const base83Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~"

// blurhashEncode: nx x ny thành phần (1..9). Ảnh rỗng -> "".
func blurhashEncode(img image.Image, nx, ny int) string {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 || nx < 1 || nx > 9 || ny < 1 || ny > 9 {
		return ""
	}
	// đổi trước sang tuyến tính một lần
	lin := make([][3]float64, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, bl, _ := img.At(b.Min.X+x, b.Min.Y+y).RGBA()
			lin[y*w+x] = [3]float64{srgbToLinear(int(r >> 8)), srgbToLinear(int(g >> 8)), srgbToLinear(int(bl >> 8))}
		}
	}
	factors := make([][3]float64, 0, nx*ny)
	for j := 0; j < ny; j++ {
		for i := 0; i < nx; i++ {
			norm := 2.0
			if i == 0 && j == 0 {
				norm = 1
			}
			var f [3]float64
			for y := 0; y < h; y++ {
				by := math.Cos(math.Pi * float64(j) * float64(y) / float64(h))
				for x := 0; x < w; x++ {
					basis := math.Cos(math.Pi*float64(i)*float64(x)/float64(w)) * by
					p := lin[y*w+x]
					f[0] += basis * p[0]
					f[1] += basis * p[1]
					f[2] += basis * p[2]
				}
			}
			scale := norm / float64(w*h)
			factors = append(factors, [3]float64{f[0] * scale, f[1] * scale, f[2] * scale})
		}
	}
	var sb strings.Builder
	sb.WriteString(base83((nx-1)+(ny-1)*9, 1))
	maxVal := 1.0
	if len(factors) > 1 {
		actual := 0.0
		for _, f := range factors[1:] {
			actual = math.Max(actual, math.Max(math.Abs(f[0]), math.Max(math.Abs(f[1]), math.Abs(f[2]))))
		}
		q := int(math.Max(0, math.Min(82, math.Floor(actual*166-0.5))))
		maxVal = float64(q+1) / 166
		sb.WriteString(base83(q, 1))
	} else {
		sb.WriteString(base83(0, 1))
	}
	dc := factors[0]
	sb.WriteString(base83(linearToSrgb(dc[0])<<16+linearToSrgb(dc[1])<<8+linearToSrgb(dc[2]), 4))
	for _, f := range factors[1:] {
		q := func(v float64) int {
			return int(math.Max(0, math.Min(18, math.Floor(signPow(v/maxVal, 0.5)*9+9.5))))
		}
		sb.WriteString(base83(q(f[0])*19*19+q(f[1])*19+q(f[2]), 2))
	}
	return sb.String()
}

func base83(v, length int) string {
	out := make([]byte, length)
	for i := 1; i <= length; i++ {
		d := (v / int(math.Pow(83, float64(length-i)))) % 83
		out[i-1] = base83Chars[d]
	}
	return string(out)
}

func srgbToLinear(c int) float64 {
	v := float64(c) / 255
	if v <= 0.04045 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func linearToSrgb(v float64) int {
	v = math.Max(0, math.Min(1, v))
	if v <= 0.0031308 {
		return int(v*12.92*255 + 0.5)
	}
	return int((1.055*math.Pow(v, 1/2.4)-0.055)*255 + 0.5)
}

func signPow(v, e float64) float64 {
	return math.Copysign(math.Pow(math.Abs(v), e), v)
}
