package chat

import (
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

// listCursor: vị trí trong danh sách hội thoại (sắp last_message_at giảm dần, null cuối, rồi id giảm dần).
// at = nil: dòng chưa có tin nào.
type listCursor struct {
	at *time.Time
	id int64
}

// encodeListCursor: base64url của "t<unix micro>:<id>" hoặc "n:<id>" - đủ chính xác micro giây như timestamptz.
func encodeListCursor(c listCursor) string {
	s := "n:" + strconv.FormatInt(c.id, 10)
	if c.at != nil {
		s = "t" + strconv.FormatInt(c.at.UnixMicro(), 10) + ":" + strconv.FormatInt(c.id, 10)
	}
	return base64.RawURLEncoding.EncodeToString([]byte(s))
}

// decodeListCursor: chuỗi rỗng -> nil (trang đầu); hỏng -> BAD_REQUEST.
func decodeListCursor(s string) (*listCursor, error) {
	if s == "" {
		return nil, nil
	}
	bad := errBad("cursor không hợp lệ")
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, bad
	}
	head, idStr, ok := strings.Cut(string(b), ":")
	if !ok {
		return nil, bad
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return nil, bad
	}
	c := &listCursor{id: id}
	switch {
	case head == "n":
	case strings.HasPrefix(head, "t"):
		us, err := strconv.ParseInt(head[1:], 10, 64)
		if err != nil {
			return nil, bad
		}
		t := time.UnixMicro(us).UTC()
		c.at = &t
	default:
		return nil, bad
	}
	return c, nil
}

// syncOverlap: /sync trả cả thay đổi trong 10 giây trước cursor (giao dịch đang chạy lúc client đồng bộ lần trước);
// client gộp theo khoá nên nhận trùng không sao.
const syncOverlap = 10 * time.Second

// parseSyncCursor: số mili giây kể từ epoch do /sync hoặc /conversations trả về.
func parseSyncCursor(s string) (time.Time, error) {
	ms, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || ms < 0 || ms > 1<<53 {
		return time.Time{}, errBad("Thiếu hoặc sai cursor (số mili giây)")
	}
	return time.UnixMilli(ms).UTC(), nil
}

// pgTime: thời điểm gửi cho Postgres dạng chữ (pool chạy simple protocol), giữ đủ micro giây; SQL ép ::timestamptz.
func pgTime(t time.Time) string { return t.UTC().Format("2006-01-02 15:04:05.999999Z07:00") }
