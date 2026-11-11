package chat

// Tệp đính kèm chat (giai đoạn 2, backend/CHAT.md mục 12): ảnh / video / tệp / tin nhắn thoại nằm trên MinIO (S3), byte
// không đi qua API. Client xin presigned PUT tới khoá tạm chat/in/... (POST /chat/media/upload-url), PUT thẳng lên S3,
// báo xong (POST /chat/media/:id/complete): server chép sang khoá cuối chat/m/..., kiểm kích thước / loại / sha256 /
// quét virus, làm ảnh nhỏ; đọc bằng presigned GET (GET /chat/media/:id). Bảng chat_media (0020_chat_media.sql).
//
// File này: interface kho tệp / bộ quét, hằng số, hàm thuần (MIME, tên tệp, khoá object). Nghiệp vụ ở service_media.go,
// ảnh nhỏ / EXIF ở media_image.go, blurhash ở blurhash.go, chữ xem trước ở media_preview.go.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"path"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	_ "golang.org/x/image/webp" // đăng ký bộ giải mã WebP cho image.DecodeConfig / image.Decode

	"qspro-backend/internal/platform/logger"
	apperr "qspro-backend/internal/shared/errors"
)

// MediaStore: kho tệp S3 (*objstore.Client của platform/objstore). Chỉ dùng kiểu cơ bản để objstore không phải
// import chat. nil trong Deps = tắt gửi tệp.
type MediaStore interface {
	Ready() bool // đã kiểm / tạo bucket xong
	// PresignPut: URL PUT ký cả Content-Type + Content-Length; trả thêm các header trình duyệt phải gửi.
	PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (string, map[string]string, error)
	// PresignGet: URL GET ký kèm response-content-type / response-content-disposition / response-cache-control.
	PresignGet(ctx context.Context, key string, ttl time.Duration, contentType, disposition, cacheControl string) (string, error)
	Stat(ctx context.Context, key string) (size int64, contentType string, found bool, err error)
	Copy(ctx context.Context, src, dst string) error             // chép phía server, khoá tạm -> khoá cuối
	Open(ctx context.Context, key string) (io.ReadCloser, error) // đọc dạng luồng (sha256, quét virus)
	ReadPrefix(ctx context.Context, key string, n int64) ([]byte, error)
	Get(ctx context.Context, key string, maxBytes int64) ([]byte, error) // lỗi nếu object > maxBytes
	Put(ctx context.Context, key string, data []byte, contentType string) error
	Remove(ctx context.Context, keys ...string) error // khoá không có = không lỗi
}

// MediaScanner: quét virus nội dung tệp. nil trong Deps = logScanner (coi như sạch).
type MediaScanner interface {
	Scan(ctx context.Context, r io.Reader, size int64) (clean bool, err error)
}

// logScanner: chưa có bộ quét thật (ClamAV để sau) - đọc hết luồng, luôn trả sạch; ghi log 1 lần lúc khởi động.
type logScanner struct{}

func (logScanner) Scan(_ context.Context, r io.Reader, _ int64) (bool, error) {
	_, err := io.Copy(io.Discard, r)
	return err == nil, err
}

var logScannerOnce sync.Once

func noteLogScanner() {
	logScannerOnce.Do(func() { logger.Info("chat", "tệp chat: chưa có bộ quét virus, mọi tệp coi là sạch") })
}

// Hằng số cố định của phần tệp (giới hạn đổi được nằm trong config: CHAT_MEDIA_*).
const (
	mediaUploadURLTTL   = 15 * time.Minute // hạn URL PUT
	mediaMaxVoiceBytes  = 10 << 20         // tin nhắn thoại tối đa 10 MB
	mediaMaxVoiceMs     = 600000           // tin nhắn thoại tối đa 10 phút
	mediaMaxPosterBytes = 512 << 10        // ảnh bìa video (client làm) tối đa 512 KB
	mediaPosterEdge     = 640              // cạnh dài ảnh bìa video
	mediaThumbEdge      = 320              // cạnh dài ảnh nhỏ của ảnh
	mediaBlurX          = 4                // số thành phần blurhash theo ngang
	mediaBlurY          = 3                // ... theo dọc
	mediaMaxPixels      = 40e6             // quá số điểm ảnh này thì không giải mã (chỉ lưu rộng / cao)
	mediaImgConc        = 2                // số ảnh giải mã cùng lúc (imgSem)
	mediaCompleteTO     = 60 * time.Second // thời gian tối đa của complete
	mediaStuckAfter     = 10 * time.Minute // processing quá lâu -> janitor trả về pending
	mediaUploadPerMin   = 60               // upload-url: 60 lần / phút / người
	mediaHardMaxBytes   = 200 << 20        // trần cứng 200 MB (khớp ck_chat_media_size_bytes, giới hạn băm ở trình duyệt)
	mediaJanitorEvery   = 30 * time.Minute // chu kỳ dọn tệp
	mediaMaxImageBytesD = 25 << 20         // mặc định CHAT_MEDIA_MAX_IMAGE_MB
	mediaMaxFileBytesD  = 100 << 20        // mặc định CHAT_MEDIA_MAX_FILE_MB
	mediaDailyBytesD    = 2048 << 20       // mặc định CHAT_MEDIA_DAILY_MB
	mediaURLTTLD        = 60 * time.Minute // mặc định CHAT_MEDIA_URL_TTL_MIN
	mediaMaxWaveform    = 128              // số cột dạng sóng tối đa
	mediaMaxFileName    = 255              // độ dài tên tệp tối đa (rune)
	mediaDefaultName    = "tep"            // tên tệp khi làm sạch xong bị rỗng
	mediaKeyFinal       = "chat/m/"        // tiền tố khoá cuối (không bao giờ ký PUT)
	mediaKeyStaging     = "chat/in/"       // tiền tố khoá tạm (ILM xoá sau 1 ngày)
	mediaThumbSuffix    = ".t.jpg"         // ảnh nhỏ của ảnh
	mediaPosterSuffix   = ".p.jpg"         // ảnh bìa video
	mediaOctetStream    = "application/octet-stream"
)

// Loại tệp (chat_media.media_type = chat_messages.message_type của tin dùng nó).
const (
	MediaImage = "image"
	MediaVideo = "video"
	MediaFile  = "file"
	MediaVoice = "voice"
)

// Trạng thái chat_media.status.
const (
	mediaPending    = "pending"
	mediaProcessing = "processing"
	mediaReady      = "ready"
	mediaFailed     = "failed"
	mediaBlocked    = "blocked"
)

// MIME khai báo được chấp nhận theo loại (loại file: mọi MIME hợp lệ).
var (
	mediaImageMimes = []string{"image/jpeg", "image/png", "image/webp", "image/gif"}
	mediaVideoMimes = []string{"video/mp4", "video/webm", "video/quicktime"}
	mediaVoiceMimes = []string{"audio/webm", "audio/ogg", "audio/mp4", "audio/aac", "audio/mpeg"}
	// Đuôi tệp bị chặn (so sau khi hạ chữ thường và bỏ dấu chấm / khoảng trắng cuối).
	mediaDeniedExt = []string{".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".vbs", ".js", ".jar"}
)

// Mã lỗi tắt tệp. Các mã MEDIA_* còn lại do gói MEDIA thêm vào errors.go.
const CodeMediaDisabled = "MEDIA_DISABLED"

var errMediaDisabled = apperr.E(503, "Máy chủ chưa bật gửi ảnh / tệp", CodeMediaDisabled)

// mediaOn: đã cấu hình kho tệp (CHAT_S3_ENDPOINT).
func (s *Service) mediaOn() bool { return s.media != nil }

// normalizeMime: MIME chữ thường, bỏ tham số (";codecs=..."); sai cú pháp -> "".
func normalizeMime(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	mt, _, err := mime.ParseMediaType(v)
	if err != nil {
		return ""
	}
	mt = strings.ToLower(mt)
	if len(mt) > 100 || strings.Count(mt, "/") != 1 {
		return ""
	}
	for _, r := range mt {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || strings.ContainsRune("/.+-", r)) {
			return ""
		}
	}
	if strings.HasPrefix(mt, "/") || strings.HasSuffix(mt, "/") {
		return ""
	}
	return mt
}

// kindAllowed: MIME (đã normalizeMime) có được khai cho loại tệp này không.
func kindAllowed(kind, mt string) bool {
	switch kind {
	case MediaImage:
		return containsStr(mediaImageMimes, mt)
	case MediaVideo:
		return containsStr(mediaVideoMimes, mt)
	case MediaVoice:
		return containsStr(mediaVoiceMimes, mt)
	case MediaFile:
		return mt != ""
	}
	return false
}

// sniffOK: kết quả http.DetectContentType (512 byte đầu) có khớp MIME khai báo không. Loại file không gọi hàm này
// (mọi nội dung đều được, luôn phục vụ dạng application/octet-stream). Ảnh: khai loại ảnh nào cũng được miễn nội dung là
// một trong 4 loại ảnh (mime_type ghi lại theo kết quả dò).
func sniffOK(declared, sniffed string) bool {
	declared, sniffed = normalizeMime(declared), normalizeMime(sniffed)
	if containsStr(mediaImageMimes, declared) {
		return containsStr(mediaImageMimes, sniffed)
	}
	return containsStr(mediaSniffAccept[declared], sniffed)
}

// mediaSniffAccept: MIME khai báo (video / thoại) -> các kết quả dò chấp nhận. http.DetectContentType không nhận ra
// QuickTime / AAC (ra application/octet-stream) và coi webm / mp4 chỉ có tiếng là video.
var mediaSniffAccept = map[string][]string{
	"video/mp4":       {"video/mp4"},
	"video/webm":      {"video/webm"},
	"video/quicktime": {"video/mp4", mediaOctetStream},
	"audio/webm":      {"video/webm", "audio/webm"},
	"audio/mp4":       {"video/mp4", "audio/mp4", mediaOctetStream},
	"audio/ogg":       {"application/ogg", "audio/ogg"},
	"audio/aac":       {"audio/aac", mediaOctetStream},
	"audio/mpeg":      {"audio/mpeg"},
}

// sanitizeFileName: bỏ đường dẫn, ký tự điều khiển, khoảng trắng / dấu chấm cuối, cắt 255 rune; rỗng -> "tep".
func sanitizeFileName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = strings.TrimRight(strings.TrimSpace(name), ". ")
	if utf8.RuneCountInString(name) > mediaMaxFileName {
		name = strings.TrimRight(string([]rune(name)[:mediaMaxFileName]), ". ")
	}
	if name == "" {
		return mediaDefaultName
	}
	return name
}

// deniedFileName: tên tệp có đuôi bị chặn (.exe, .js ...); so chữ thường, bỏ dấu chấm / khoảng trắng cuối.
func deniedFileName(name string) bool {
	ext := path.Ext(strings.TrimRight(strings.ToLower(name), ". "))
	return containsStr(mediaDeniedExt, ext)
}

// objectKey: khoá cuối mới chat/m/u<uid>/<yyyymm>/<32 hex ngẫu nhiên>.
func objectKey(uid int64, t time.Time) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return fmt.Sprintf("%su%d/%s/%s", mediaKeyFinal, uid, t.UTC().Format("200601"), hex.EncodeToString(b)), nil
}

// stagingKey: khoá tạm (PUT) của khoá cuối - thay tiền tố chat/m/ bằng chat/in/.
func stagingKey(finalKey string) string {
	return mediaKeyStaging + strings.TrimPrefix(finalKey, mediaKeyFinal)
}

// mediaMaxBytes: kích thước tối đa theo loại (0 = loại sai).
func (s *Service) mediaMaxBytes(kind string) int64 {
	switch kind {
	case MediaImage:
		return s.mediaMaxImage
	case MediaVideo, MediaFile:
		return s.mediaMaxFile
	case MediaVoice:
		return mediaMaxVoiceBytes
	}
	return 0
}

func containsStr(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ───────────── Janitor ─────────────

// startMediaJanitor: chạy janitorOnce mỗi 30 phút tới khi Shutdown (chỉ khi đã bật tệp).
func (s *Service) startMediaJanitor() {
	s.mediaWG.Add(1)
	go func() {
		defer s.mediaWG.Done()
		tk := time.NewTicker(mediaJanitorEvery)
		defer tk.Stop()
		for {
			select {
			case <-s.mediaQuit:
				return
			case <-tk.C:
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
				if err := s.janitorOnce(ctx); err != nil {
					logger.Error("chat", "dọn tệp chat lỗi:", err.Error())
				}
				cancel()
			}
		}
	}()
}
