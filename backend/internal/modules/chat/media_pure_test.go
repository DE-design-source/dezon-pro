package chat

import (
	"bytes"
	"context"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"qspro-backend/internal/config"
)

// ───────────── Ảnh mẫu dựng trong test ─────────────

// gradImage: ảnh w x h màu chuyển dần (không phải một màu, để blurhash có AC).
func gradImage(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{uint8(x * 255 / max(1, w-1)), uint8(y * 255 / max(1, h-1)), 128, 255})
		}
	}
	return img
}

func pngBytes(w, h int) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, gradImage(w, h))
	return b.Bytes()
}

func jpegBytes(w, h int) []byte {
	var b bytes.Buffer
	_ = jpeg.Encode(&b, gradImage(w, h), &jpeg.Options{Quality: 85})
	return b.Bytes()
}

// withExif: chèn APP1 Exif có Orientation = o ngay sau SOI của JPEG (le: thứ tự byte II).
func withExif(j []byte, o uint16, le bool) []byte {
	var bo binary.ByteOrder = binary.BigEndian
	tiff := []byte("MM\x00\x2a\x00\x00\x00\x08")
	if le {
		bo = binary.LittleEndian
		tiff = []byte("II\x2a\x00\x08\x00\x00\x00")
	}
	ifd := make([]byte, 2+12+4)
	bo.PutUint16(ifd[0:], 1)
	bo.PutUint16(ifd[2:], 0x0112)
	bo.PutUint16(ifd[4:], 3)
	bo.PutUint32(ifd[6:], 1)
	bo.PutUint16(ifd[10:], o)
	seg := append([]byte("Exif\x00\x00"), append(tiff, ifd...)...)
	app1 := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(app1[2:], uint16(len(seg)+2))
	out := append([]byte{}, j[:2]...)
	out = append(out, app1...)
	out = append(out, seg...)
	return append(out, j[2:]...)
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// ───────────── Hàm thuần ─────────────

func TestNormalizeMimeKindAllowed(t *testing.T) {
	for in, want := range map[string]string{
		"image/JPEG": "image/jpeg", " audio/webm;codecs=opus ": "audio/webm", "video/mp4; codecs=\"avc1\"": "video/mp4",
		"": "", "jpeg": "", "image/": "", "a/b/c": "", "image/jpe g": "", "text/plain; charset=utf-8": "text/plain",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	} {
		if got := normalizeMime(in); got != want {
			t.Errorf("normalizeMime(%q) = %q, muốn %q", in, got, want)
		}
	}
	for _, c := range []struct {
		kind, mt string
		ok       bool
	}{
		{MediaImage, "image/jpeg", true}, {MediaImage, "image/png", true}, {MediaImage, "image/webp", true}, {MediaImage, "image/gif", true},
		{MediaImage, "image/heic", false}, {MediaImage, "image/svg+xml", false}, {MediaImage, "video/mp4", false},
		{MediaVideo, "video/mp4", true}, {MediaVideo, "video/webm", true}, {MediaVideo, "video/quicktime", true}, {MediaVideo, "video/x-msvideo", false},
		{MediaVoice, "audio/webm", true}, {MediaVoice, "audio/ogg", true}, {MediaVoice, "audio/mp4", true}, {MediaVoice, "audio/aac", true},
		{MediaVoice, "audio/mpeg", true}, {MediaVoice, "audio/wav", false},
		{MediaFile, "application/pdf", true}, {MediaFile, "image/heic", true}, {MediaFile, "", false}, {"sticker", "image/png", false},
	} {
		if got := kindAllowed(c.kind, c.mt); got != c.ok {
			t.Errorf("kindAllowed(%s, %s) = %v", c.kind, c.mt, got)
		}
	}
	if kindAllowed(MediaVoice, normalizeMime("audio/webm;codecs=opus")) != true {
		t.Error("audio/webm;codecs=opus phải được nhận sau khi bỏ tham số")
	}
}

func TestSniffOK(t *testing.T) {
	sn := func(b []byte) string { return http.DetectContentType(b) }
	var gifB bytes.Buffer
	_ = gif.Encode(&gifB, gradImage(4, 4), nil)
	webp := []byte("RIFF\x24\x00\x00\x00WEBPVP8 \x18\x00\x00\x00")
	jpg, pngB := jpegBytes(8, 8), pngBytes(8, 8)
	for _, c := range []struct {
		declared string
		data     []byte
		ok       bool
	}{
		{"image/jpeg", jpg, true}, {"image/png", jpg, true}, {"image/webp", pngB, true}, {"image/gif", gifB.Bytes(), true}, {"image/jpeg", webp, true},
		{"image/jpeg", fixture(t, "html-as.jpg"), false}, {"image/png", fixture(t, "video.mp4"), false},
		{"video/mp4", fixture(t, "video.mp4"), true}, {"video/mp4", fixture(t, "iphone.mov"), false}, {"video/mp4", fixture(t, "chrome-audio.webm"), false},
		{"video/webm", fixture(t, "chrome-audio.webm"), true}, {"video/webm", fixture(t, "video.mp4"), false},
		{"video/quicktime", fixture(t, "iphone.mov"), true}, {"video/quicktime", fixture(t, "video.mp4"), true}, {"video/quicktime", fixture(t, "html-as.jpg"), false},
		{"audio/webm", fixture(t, "chrome-audio.webm"), true}, {"audio/webm", fixture(t, "firefox-audio.ogg"), false},
		{"audio/ogg", fixture(t, "firefox-audio.ogg"), true}, {"audio/ogg", fixture(t, "chrome-audio.webm"), false},
		{"audio/mp4", fixture(t, "safari-audio.mp4"), true}, {"audio/mp4", fixture(t, "iphone.mov"), true}, {"audio/mp4", fixture(t, "html-as.jpg"), false},
		{"audio/aac", []byte{0xFF, 0xF1, 0x50, 0x80, 0x02, 0x1F, 0xFC}, true}, {"audio/aac", fixture(t, "html-as.jpg"), false},
		{"audio/mpeg", []byte("ID3\x04\x00\x00\x00\x00\x00\x00"), true}, {"audio/mpeg", fixture(t, "video.mp4"), false},
		{"application/pdf", []byte("%PDF-1.7"), false}, // loại file không đi qua sniffOK
	} {
		if got := sniffOK(c.declared, sn(c.data)); got != c.ok {
			t.Errorf("sniffOK(%s, %s) = %v, muốn %v", c.declared, sn(c.data), got, c.ok)
		}
	}
	// các mẫu thật phải ra đúng kết quả dò như bảng ở design
	for f, want := range map[string]string{"chrome-audio.webm": "video/webm", "firefox-audio.ogg": "application/ogg",
		"safari-audio.mp4": "video/mp4", "iphone.mov": "application/octet-stream", "video.mp4": "video/mp4", "html-as.jpg": "text/html"} {
		if got := normalizeMime(sn(fixture(t, f))); got != want {
			t.Errorf("dò %s = %s, muốn %s", f, got, want)
		}
	}
}

func TestSanitizeFileName(t *testing.T) {
	long := strings.Repeat("ă", 300)
	for in, want := range map[string]string{
		"../../a.pdf": "a.pdf", `C:\x\b.doc`: "b.doc", "a\x00b\x1f\x7fc.txt": "abc.txt", "  báo giá.xlsx  ": "báo giá.xlsx",
		"": "tep", "...": "tep", "/": "tep", "x/": "tep", "tài liệu. . ": "tài liệu", long: strings.Repeat("ă", 255),
	} {
		if got := sanitizeFileName(in); got != want {
			t.Errorf("sanitizeFileName(%q) = %q, muốn %q", in, got, want)
		}
	}
	for name, denied := range map[string]bool{"a.EXE.": true, "a.exe ": true, "setup.msi": true, "x.Js": true, "run.ps1": true,
		"a.pdf": false, "exe": false, "a.exe.pdf": false, "a.json": false} {
		if got := deniedFileName(name); got != denied {
			t.Errorf("deniedFileName(%q) = %v", name, got)
		}
		if got := deniedFileName(sanitizeFileName(name)); got != denied {
			t.Errorf("deniedFileName(sanitize(%q)) = %v", name, got)
		}
	}
}

func TestMediaSizeLimits(t *testing.T) {
	s := New(Deps{})
	if s.mediaMaxBytes(MediaImage) != 25<<20 || s.mediaMaxBytes(MediaVideo) != 100<<20 || s.mediaMaxBytes(MediaFile) != 100<<20 ||
		s.mediaMaxBytes(MediaVoice) != 10<<20 || s.mediaMaxBytes("x") != 0 || s.mediaDaily != 2048<<20 || s.mediaURLTTL != time.Hour {
		t.Errorf("mặc định: %d %d %d %d %v", s.mediaMaxImage, s.mediaMaxFile, s.mediaMaxBytes(MediaVoice), s.mediaDaily, s.mediaURLTTL)
	}
	s = New(Deps{Cfg: &config.Config{ChatMediaMaxImageMB: 300, ChatMediaMaxFileMB: 500, ChatMediaDailyMB: 10, ChatMediaURLTTLMin: 1}})
	if s.mediaMaxImage != 200<<20 || s.mediaMaxFile != 200<<20 || s.mediaDaily != 10<<20 || s.mediaURLTTL != 5*time.Minute {
		t.Errorf("kẹp: %d %d %d %v", s.mediaMaxImage, s.mediaMaxFile, s.mediaDaily, s.mediaURLTTL)
	}
	s = New(Deps{Cfg: &config.Config{ChatMediaURLTTLMin: 10000}})
	if s.mediaURLTTL != 720*time.Minute {
		t.Errorf("TTL tối đa: %v", s.mediaURLTTL)
	}
	for mb, want := range map[int64]string{25 << 20: "tối đa 25 MB", 512 << 10: "tối đa 512 KB", 10<<20 + 1: "tối đa 11 MB"} {
		if err := errMediaTooLarge(mb); codeOf(err) != CodeMediaTooLarge || !strings.Contains(err.Error(), want) {
			t.Errorf("errMediaTooLarge(%d) = %v", mb, err)
		}
	}
}

func TestPreviewBody(t *testing.T) {
	ms := func(v int) *int { return &v }
	md := &MediaDTO{FileName: "a.pdf"}
	for _, c := range []struct {
		typ, content, name string
		md                 *MediaDTO
		want               string
	}{
		{"text", "  xin chào ", "", nil, "xin chào"},
		{"system", "Lan đã tạo nhóm", "", nil, "Lan đã tạo nhóm"},
		{MediaImage, "", "", md, "[Hình ảnh]"},
		{MediaImage, " ảnh công trình ", "", md, "[Hình ảnh] ảnh công trình"},
		{MediaVideo, "", "", md, "[Video]"},
		{MediaVideo, "clip", "", md, "[Video] clip"},
		{MediaFile, "chú thích", "b.pdf", md, "[Tệp] b.pdf"},
		{MediaFile, "", "", md, "[Tệp] a.pdf"},
		{MediaVoice, "", "", &MediaDTO{DurationMs: ms(12000)}, "[Tin nhắn thoại] 0:12"},
		{MediaVoice, "", "", &MediaDTO{DurationMs: ms(0)}, "[Tin nhắn thoại] 0:00"},
		{MediaVoice, "", "", &MediaDTO{DurationMs: ms(999)}, "[Tin nhắn thoại] 0:01"},
		{MediaVoice, "", "", &MediaDTO{DurationMs: ms(61000)}, "[Tin nhắn thoại] 1:01"},
		{MediaVoice, "", "", &MediaDTO{}, "[Tin nhắn thoại]"},
		{MediaImage, "x", "", nil, "[Tệp đính kèm]"},
		{MediaVoice, "", "", nil, "[Tệp đính kèm]"},
	} {
		if got := previewBody(c.typ, c.content, c.name, c.md); got != c.want {
			t.Errorf("previewBody(%s, %q, %q) = %q, muốn %q", c.typ, c.content, c.name, got, c.want)
		}
	}
	long := strings.Repeat("ơ", 150)
	if got := previewBody(MediaImage, long, "", md); len([]rune(got)) != 100 || !strings.HasPrefix(got, "[Hình ảnh] ơ") {
		t.Errorf("cắt 100 ký tự: %d %q", len([]rune(got)), got)
	}
	if got := previewBody("text", long, "", nil); got != strings.Repeat("ơ", 100) {
		t.Errorf("cắt văn bản: %q", got)
	}
}

// decodeBase83 / dcOf: giải mã thành phần DC của blurhash (kiểm bộ mã hoá).
func decodeBase83(s string) int {
	v := 0
	for _, c := range s {
		v = v*83 + strings.IndexRune(base83Chars, c)
	}
	return v
}

func TestBlurhashEncode(t *testing.T) {
	solid := image.NewRGBA(image.Rect(0, 0, 32, 24))
	for i := range solid.Pix {
		solid.Pix[i] = []byte{200, 100, 50, 255}[i%4]
	}
	h := blurhashEncode(solid, 4, 3)
	if len(h) != 28 {
		t.Fatalf("độ dài %d: %q", len(h), h)
	}
	if h[0] != base83Chars[3+2*9] {
		t.Errorf("cờ kích thước: %q", h[:1])
	}
	dc := decodeBase83(h[2:6])
	for i, want := range []int{200, 100, 50} {
		if got := dc >> (16 - 8*i) & 0xFF; got < want-2 || got > want+2 {
			t.Errorf("DC kênh %d = %d, muốn %d±2", i, got, want)
		}
	}
	// Ảnh một màu: AC gần 0. Không đúng bằng 0 vì cơ sở cos(pi*i*x/w) của bản gốc (không lệch nửa điểm) có tổng bằng 1
	// với i lẻ -> AC = 2*màu/w; ảnh càng rộng càng nhỏ.
	if mx := blurMaxAC(h); mx > 0.06 {
		t.Errorf("AC lớn nhất của ảnh một màu = %.3f", mx)
	}
	if g := blurhashEncode(gradImage(32, 16), 4, 3); len(g) != 28 || g == h || blurMaxAC(g) < 0.1 {
		t.Errorf("ảnh chuyển màu: %q AC lớn nhất %.3f", g, blurMaxAC(g))
	}
	if blurhashEncode(image.NewRGBA(image.Rect(0, 0, 0, 0)), 4, 3) != "" {
		t.Error("ảnh rỗng phải ra chuỗi rỗng")
	}
}

func TestThumbSize(t *testing.T) {
	for _, c := range [][4]int{{1000, 500, 320, 160}, {500, 1000, 160, 320}, {320, 100, 320, 100}, {100, 50, 100, 50}, {4000, 3, 320, 1}, {321, 321, 320, 320}} {
		if w, h := thumbSize(c[0], c[1], 320); w != c[2] || h != c[3] {
			t.Errorf("thumbSize(%d, %d) = %d, %d", c[0], c[1], w, h)
		}
	}
	if w, h := thumbSize(0, 10, 320); w != 0 || h != 0 {
		t.Error("kích thước 0")
	}
}

func TestExifOrientation(t *testing.T) {
	j := jpegBytes(40, 20)
	if exifOrientation(j) != 1 {
		t.Error("JPEG không có EXIF phải ra 1")
	}
	for _, o := range []uint16{1, 3, 6, 8} {
		if got := exifOrientation(withExif(j, o, false)); got != int(o) {
			t.Errorf("MM orientation %d -> %d", o, got)
		}
		if got := exifOrientation(withExif(j, o, true)); got != int(o) {
			t.Errorf("II orientation %d -> %d", o, got)
		}
	}
	for _, g := range [][]byte{nil, {0xFF}, {0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, 'E'}, []byte("\xFF\xD8\xFF\xE1\x00\x10Exif\x00\x00XX\x00\x2a\x00\x00\x00\x08"),
		withExif(j, 9, false), pngBytes(4, 4), []byte("rác rác rác")} {
		if got := exifOrientation(g); got != 1 {
			t.Errorf("rác %q -> %d", g, got)
		}
	}
}

func TestProcessImage(t *testing.T) {
	info, err := processImage(pngBytes(1000, 500))
	if err != nil || info.width != 1000 || info.height != 500 || info.thumb == nil || len(info.blurhash) != 28 {
		t.Fatalf("PNG 1000x500: %+v %v", info, err)
	}
	if c, f, err := image.DecodeConfig(bytes.NewReader(info.thumb)); err != nil || f != "jpeg" || c.Width != 320 || c.Height != 160 {
		t.Errorf("ảnh nhỏ: %+v %s %v", c, f, err)
	}
	// JPEG nhỏ, không xoay: không cần ảnh nhỏ
	if info, err := processImage(jpegBytes(300, 200)); err != nil || info.thumb != nil || info.width != 300 || info.blurhash == "" {
		t.Errorf("JPEG 300x200: %+v %v", info, err)
	}
	// JPEG nhỏ nhưng xoay 90 độ: đổi rộng / cao, có ảnh nhỏ đã xoay
	info, err = processImage(withExif(jpegBytes(40, 20), 6, false))
	if err != nil || info.width != 20 || info.height != 40 || info.thumb == nil {
		t.Fatalf("JPEG xoay: %+v %v", info, err)
	}
	if c, _, _ := image.DecodeConfig(bytes.NewReader(info.thumb)); c.Width != 20 || c.Height != 40 {
		t.Errorf("ảnh nhỏ đã xoay: %+v", c)
	}
	var gb bytes.Buffer
	_ = gif.Encode(&gb, gradImage(50, 60), nil)
	if info, err := processImage(gb.Bytes()); err != nil || info.width != 50 || info.height != 60 || info.thumb == nil {
		t.Errorf("GIF: %+v %v", info, err)
	}
	if _, err := processImage(fixture(t, "html-as.jpg")); err != errImageDecode {
		t.Errorf("HTML: %v", err)
	}
}

func TestOrientImage(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 3, 2)) // điểm đánh dấu ở góc trên trái
	src.SetRGBA(0, 0, color.RGBA{255, 0, 0, 255})
	for o, want := range map[int][2]int{2: {2, 0}, 3: {2, 1}, 4: {0, 1}, 5: {0, 0}, 6: {1, 0}, 7: {1, 2}, 8: {0, 2}} {
		d := orientImage(src, o)
		if (o >= 5) != (d.Bounds().Dx() == 2) {
			t.Errorf("orientation %d: kích thước %v", o, d.Bounds())
		}
		if d.RGBAAt(want[0], want[1]).R != 255 {
			t.Errorf("orientation %d: điểm đánh dấu không ở %v", o, want)
		}
	}
}

func TestPosterJPEG(t *testing.T) {
	j := jpegBytes(64, 36)
	out, bh, err := posterJPEG(j)
	if err != nil || !bytes.Equal(out, j) || bh == "" {
		t.Errorf("poster JPEG: %v %q", err, bh)
	}
	if _, _, err := posterJPEG(jpegBytes(700, 10)); err == nil {
		t.Error("poster cạnh dài > 640 phải lỗi")
	}
	if _, _, err := posterJPEG(pngBytes(10, 10)); err == nil {
		t.Error("poster PNG phải lỗi")
	}
}

func TestObjectKeys(t *testing.T) {
	at := time.Date(2026, 11, 2, 23, 0, 0, 0, time.FixedZone("ICT", 7*3600))
	k, err := objectKey(42, at)
	if err != nil || !strings.HasPrefix(k, "chat/m/u42/202611/") || len(k) != len("chat/m/u42/202611/")+32 {
		t.Fatalf("objectKey: %q %v", k, err)
	}
	k2, _ := objectKey(42, at)
	if k == k2 {
		t.Error("objectKey phải ngẫu nhiên")
	}
	if st := stagingKey(k); st != "chat/in/"+strings.TrimPrefix(k, "chat/m/") {
		t.Errorf("stagingKey: %q", st)
	}
	if ks := mediaKeys("chat/m/u1/202611/ab"); len(ks) != 5 || ks[1] != "chat/m/u1/202611/ab.t.jpg" || ks[4] != "chat/in/u1/202611/ab.p.jpg" {
		t.Errorf("mediaKeys: %v", ks)
	}
}

func TestContentDisposition(t *testing.T) {
	if got := contentDisposition("attachment", `báo giá "Q4".pdf`); got != `attachment; filename="b_o gi_ _Q4_.pdf"; filename*=UTF-8''b%C3%A1o%20gi%C3%A1%20%22Q4%22.pdf` {
		t.Errorf("contentDisposition: %s", got)
	}
	r := &mediaRow{id: 7, typ: MediaImage, mime: "image/png"}
	if nameOr("", r) != "image-7.png" || nameOr("a.png", r) != "a.png" {
		t.Error("nameOr")
	}
}

// Máy chủ chưa bật tệp (Media nil): config enabled = false, mọi route tệp + khoá tệp khi gửi tin -> MEDIA_DISABLED.
func TestMediaDisabled(t *testing.T) {
	s := New(Deps{})
	ctx := context.Background()
	if c, err := s.MediaConfig(ctx, 1); err != nil || c.Enabled || c.MaxBytes != nil {
		t.Errorf("config: %+v %v", c, err)
	}
	_, err := s.MediaUploadURL(ctx, 1, MediaUploadInput{Type: "image"})
	wantCode(t, "upload-url", err, CodeMediaDisabled)
	_, err = s.MediaComplete(ctx, 1, 1)
	wantCode(t, "complete", err, CodeMediaDisabled)
	_, err = s.MediaGet(ctx, 1, 1, false, 0)
	wantCode(t, "get", err, CodeMediaDisabled)
	_, err = s.lockSendMedia(ctx, nil, 1, MediaImage, []int64{1})
	wantCode(t, "lockSendMedia", err, CodeMediaDisabled)
	if err := s.janitorOnce(ctx); err != nil {
		t.Error(err)
	}
	if m, err := s.mediaDTOs(ctx, nil, nil); err != nil || len(m) != 0 {
		t.Error("mediaDTOs rỗng")
	}
	// kho đang khởi động
	f := newFakeMediaStore()
	f.notReady = true
	s = New(Deps{Media: f, Scan: &fakeScanner{}})
	defer s.Shutdown(ctx)
	_, err = s.MediaUploadURL(ctx, 1, MediaUploadInput{Type: "image"})
	wantCode(t, "kho chưa sẵn sàng", err, CodeUnavailable)
	if c, _ := s.MediaConfig(ctx, 1); !c.Enabled || c.MaxBytes.Image != 25<<20 || c.MaxVoiceMs != 600000 || len(c.DeniedExt) != 10 || len(c.Mimes.Image) != 4 {
		t.Errorf("config bật: %+v", c)
	}
}

// Kiểm thân upload-url (không cần database: lỗi trước khi mở transaction).
func TestCheckUpload(t *testing.T) {
	s := New(Deps{})
	sha := strings.Repeat("a", 64)
	ms := func(v int) *int { return &v }
	for _, c := range []struct {
		in   MediaUploadInput
		code string
	}{
		{MediaUploadInput{Type: "sticker", Mime: "image/png", Size: 1, SHA256: sha}, CodeBadRequest},
		{MediaUploadInput{Type: "image", Mime: "image/heic", Size: 1, SHA256: sha}, CodeMediaType},
		{MediaUploadInput{Type: "image", Mime: "image/svg+xml", Size: 1, SHA256: sha}, CodeMediaType},
		{MediaUploadInput{Type: "image", Mime: "image/png", Size: 26 << 20, SHA256: sha}, CodeMediaTooLarge},
		{MediaUploadInput{Type: "image", Mime: "image/png", Size: 0, SHA256: sha}, CodeBadRequest},
		{MediaUploadInput{Type: "image", Mime: "image/png", Size: 1, SHA256: "xyz"}, CodeBadRequest},
		{MediaUploadInput{Type: "voice", Mime: "audio/webm", Size: 11 << 20, SHA256: sha, DurationMs: ms(1000), Waveform: []int{1}}, CodeMediaTooLarge},
		{MediaUploadInput{Type: "voice", Mime: "audio/webm", Size: 10, SHA256: sha, Waveform: []int{1}}, CodeBadRequest},
		{MediaUploadInput{Type: "voice", Mime: "audio/webm", Size: 10, SHA256: sha, DurationMs: ms(600001), Waveform: []int{1}}, CodeBadRequest},
		{MediaUploadInput{Type: "voice", Mime: "audio/webm", Size: 10, SHA256: sha, DurationMs: ms(1000)}, CodeBadRequest},
		{MediaUploadInput{Type: "voice", Mime: "audio/webm", Size: 10, SHA256: sha, DurationMs: ms(1000), Waveform: []int{256}}, CodeBadRequest},
		{MediaUploadInput{Type: "voice", Mime: "audio/wav", Size: 10, SHA256: sha, DurationMs: ms(1000), Waveform: []int{1}}, CodeMediaType},
		{MediaUploadInput{Type: "file", Mime: "application/pdf", Size: 10, SHA256: sha}, CodeBadRequest},
		{MediaUploadInput{Type: "file", Mime: "application/pdf", Size: 10, SHA256: sha, FileName: "a.EXE."}, CodeMediaType},
		{MediaUploadInput{Type: "file", Mime: "không phải mime", Size: 10, SHA256: sha, FileName: "a.pdf"}, CodeMediaType},
		{MediaUploadInput{Type: "file", Mime: "application/pdf", Size: 101 << 20, SHA256: sha, FileName: "a.pdf"}, CodeMediaTooLarge},
		{MediaUploadInput{Type: "image", Mime: "image/png", Size: 1, SHA256: sha, Poster: &MediaPosterInput{Mime: "image/jpeg", Size: 1}}, CodeBadRequest},
		{MediaUploadInput{Type: "video", Mime: "video/mp4", Size: 1, SHA256: sha, Poster: &MediaPosterInput{Mime: "image/png", Size: 1}}, CodeMediaType},
		{MediaUploadInput{Type: "video", Mime: "video/mp4", Size: 1, SHA256: sha, Poster: &MediaPosterInput{Mime: "image/jpeg", Size: 600 << 10}}, CodeMediaTooLarge},
	} {
		_, err := s.checkUpload(c.in)
		if codeOf(err) != c.code {
			t.Errorf("%+v: %v, muốn %s", c.in, err, c.code)
		}
	}
	v, err := s.checkUpload(MediaUploadInput{Type: " FILE ", Mime: "", Size: 10, SHA256: strings.ToUpper(sha), FileName: `..\x\báo giá.pdf `})
	if err != nil || v.kind != MediaFile || v.mime != mediaOctetStream || v.sha != sha || *v.fileName != "báo giá.pdf" {
		t.Errorf("file: %+v %v", v, err)
	}
	v, err = s.checkUpload(MediaUploadInput{Type: "video", Mime: "video/quicktime", Size: 10, SHA256: sha, Width: ms(200000), Height: ms(720),
		DurationMs: ms(5000), Waveform: []int{1}, FileName: "x.mov"})
	if err != nil || *v.width != 100000 || *v.height != 720 || *v.durationMs != 5000 || v.waveform != nil || v.fileName != nil {
		t.Errorf("video: %+v %v", v, err)
	}
	v, err = s.checkUpload(MediaUploadInput{Type: "image", Mime: "image/png", Size: 10, SHA256: sha, Width: ms(10), Height: ms(10)})
	if err != nil || v.width != nil {
		t.Errorf("ảnh: rộng / cao do server đo, bỏ gợi ý: %+v %v", v, err)
	}
	v, err = s.checkUpload(MediaUploadInput{Type: "voice", Mime: "audio/webm;codecs=opus", Size: 10, SHA256: sha, DurationMs: ms(12000), Waveform: []int{0, 128, 255}})
	if err != nil || v.mime != "audio/webm" || len(v.waveform) != 3 || v.waveform[2] != 255 {
		t.Errorf("voice: %+v %v", v, err)
	}
}

// blurMaxAC: |AC| lớn nhất giải mã lại từ chuỗi blurhash (theo bộ giải mã gốc).
func blurMaxAC(h string) float64 {
	maxVal := float64(decodeBase83(h[1:2])+1) / 166
	mx := 0.0
	for i := 6; i+2 <= len(h); i += 2 {
		v := decodeBase83(h[i : i+2])
		for _, q := range []int{v / (19 * 19), (v / 19) % 19, v % 19} {
			f := float64(q-9) / 9
			mx = max(mx, f*f*maxVal)
		}
	}
	return mx
}
