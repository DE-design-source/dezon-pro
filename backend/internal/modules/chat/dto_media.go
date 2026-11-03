package chat

// Dữ liệu vào / ra của phần tệp đính kèm (REST /chat/media/..., attachments của tin nhắn).

// MediaDTO: một tệp đính kèm. Trong tin nhắn, FileName là chat_messages.file_name của chính tin đó.
// URL / ThumbURL: presigned GET (hết hạn lúc ExpiresAt); rỗng khi máy chủ tắt tệp hoặc tệp chưa ready.
type MediaDTO struct {
	ID         int64   `json:"id"`
	Type       string  `json:"type"` // image / video / file / voice
	Mime       string  `json:"mime"`
	Size       int64   `json:"size"`
	FileName   string  `json:"file_name,omitempty"`
	Width      *int    `json:"width,omitempty"`
	Height     *int    `json:"height,omitempty"`
	DurationMs *int    `json:"duration_ms,omitempty"`
	Waveform   []int16 `json:"waveform,omitempty"`
	Blurhash   string  `json:"blurhash,omitempty"`
	Status     string  `json:"status"` // pending / processing / ready / failed / blocked
	URL        string  `json:"url,omitempty"`
	ThumbURL   string  `json:"thumb_url,omitempty"`
	ExpiresAt  string  `json:"expires_at,omitempty"`

	row *mediaRow // dòng gốc: tin file ký lại URL theo tên của chính tin (fileNamed)
}

// MediaPosterInput: ảnh bìa video do client làm (image/jpeg hoặc image/webp, tối đa 512 KB).
type MediaPosterInput struct {
	Mime string `json:"mime"`
	Size int64  `json:"size"`
}

// MediaUploadInput: thân POST /chat/media/upload-url.
type MediaUploadInput struct {
	Type       string            `json:"type"`
	Mime       string            `json:"mime"`
	Size       int64             `json:"size"`
	SHA256     string            `json:"sha256"`
	FileName   string            `json:"file_name,omitempty"`   // bắt buộc với file
	Width      *int              `json:"width,omitempty"`       // chỉ là gợi ý của video
	Height     *int              `json:"height,omitempty"`      // chỉ là gợi ý của video
	DurationMs *int              `json:"duration_ms,omitempty"` // bắt buộc với voice
	Waveform   []int             `json:"waveform,omitempty"`    // bắt buộc với voice: 1..128 số 0..255
	Poster     *MediaPosterInput `json:"poster,omitempty"`      // chỉ video
}

// MediaUploadTarget: nơi trình duyệt tải byte lên (không kèm Bearer).
// method PUT: gửi đúng Headers + blob. method POST (phương án dự phòng POST policy): FormData từ Fields + tệp.
type MediaUploadTarget struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers,omitempty"`
	Fields    map[string]string `json:"fields,omitempty"`
	ExpiresAt string            `json:"expires_at"`
}

// MediaUploadOutput: kết quả upload-url. Dedup = true: đã có tệp ready cùng nội dung, không cần tải lên (Media có sẵn).
type MediaUploadOutput struct {
	MediaID      int64              `json:"media_id"`
	Dedup        bool               `json:"dedup"`
	Upload       *MediaUploadTarget `json:"upload,omitempty"`
	PosterUpload *MediaUploadTarget `json:"poster_upload,omitempty"`
	Media        *MediaDTO          `json:"media,omitempty"`
}

// MediaMaxBytes: kích thước tối đa theo loại.
type MediaMaxBytes struct {
	Image int64 `json:"image"`
	Video int64 `json:"video"`
	File  int64 `json:"file"`
	Voice int64 `json:"voice"`
}

// MediaMimes: MIME khai báo được theo loại (file: mọi MIME).
type MediaMimes struct {
	Image []string `json:"image"`
	Video []string `json:"video"`
	Voice []string `json:"voice"`
}

// MediaConfigDTO: GET /chat/media/config. Enabled = false: máy chủ chưa bật tệp (các trường khác bỏ trống).
type MediaConfigDTO struct {
	Enabled        bool           `json:"enabled"`
	MaxBytes       *MediaMaxBytes `json:"max_bytes,omitempty"`
	MaxVoiceMs     int            `json:"max_voice_ms,omitempty"`
	MaxPosterBytes int64          `json:"max_poster_bytes,omitempty"`
	Mimes          *MediaMimes    `json:"mimes,omitempty"`
	DeniedExt      []string       `json:"denied_ext,omitempty"`
}
