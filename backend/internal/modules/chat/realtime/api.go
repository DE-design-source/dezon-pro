// Package realtime: WebSocket gateway của chat (CHAT.md mục 5, 7, 10) cho giai đoạn MVP - MỘT gateway, trạng thái
// trong bộ nhớ: giữ kết nối, xác thực gói đầu tiên, ping / pong, đẩy sự kiện tới người dùng, online / truy cập lần cuối,
// đang soạn tin, và bộ chạy tuần tự theo khoá (thay Kafka: tin của cùng một hội thoại được phân phối đúng thứ tự).
// Gói này không biết database hay quy tắc chat: mọi quyết định nghiệp vụ hỏi qua Backend (gói chat cài).
//
// File này là HỢP ĐỒNG giữa gói chat và gói realtime: kiểu và chữ ký ở đây không đổi; phần cài đặt nằm ở các file khác.
package realtime

import (
	"context"
	"encoding/json"
	"time"
)

// Backend: nghiệp vụ mà gateway gọi tới. *chat.Service cài interface này.
type Backend interface {
	// Authenticate xử lý gói "auth" {access_token, device_id}: trả userID của token. Lỗi -> gateway gửi "error"
	// (mã lấy từ *Error nếu có, không thì "AUTH_FAILED") rồi đóng kết nối.
	Authenticate(ctx context.Context, accessToken string, deviceID int64) (userID int64, err error)

	// HandleMessage xử lý gói nghiệp vụ "message.send", "message.delivered", "message.read" của một kết nối đã xác thực.
	// Trả data của gói "ack" (nil = gửi ack với data {} nếu gói có req_id). Lỗi -> gói "error".
	HandleMessage(ctx context.Context, c Client, typ string, data json.RawMessage) (ack any, err error)

	// TypingTargets: ai nhận gói "typing" khi userID gõ trong conversationID (thành viên còn trong hội thoại, trừ userID).
	// userID không phải thành viên -> lỗi, gói typing bị bỏ.
	TypingTargets(ctx context.Context, userID, conversationID int64) ([]int64, error)

	// PresenceInfo: trong targets, những người userID được xem trạng thái online (bạn bè hoặc chung một hội thoại),
	// kèm thời điểm truy cập lần cuối đã lưu (zero = chưa có). Người không được xem không có trong map.
	PresenceInfo(ctx context.Context, userID int64, targets []int64) (map[int64]time.Time, error)

	// PresenceChanged: userID vừa online (kết nối đầu tiên) hoặc offline (hết thời gian chống nhấp nháy, Options.OfflineGrace).
	// Gọi trên goroutine riêng; Backend tự ghi last_seen và tự nuốt lỗi.
	PresenceChanged(userID int64, online bool, at time.Time)
}

// Client: một kết nối WebSocket đã xác thực.
type Client struct {
	UserID   int64
	DeviceID int64
	ConnID   uint64
}

// Error: lỗi gửi cho client trong gói "error" {code, message}. Backend trả *Error để chọn mã;
// lỗi khác -> mã "INTERNAL", message "Lỗi máy chủ".
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// Options: cấu hình Hub. Trường để trống lấy giá trị mặc định ghi ở từng dòng.
type Options struct {
	Backend        Backend
	OriginPatterns []string      // host (không có scheme) được phép trong header Origin, ngoài chính host của request
	AuthTimeout    time.Duration // chưa gửi "auth" sau khoảng này thì đóng kết nối; mặc định 10 giây
	IdleTimeout    time.Duration // không nhận gói nào (kể cả ping) trong khoảng này thì coi kết nối đã chết; mặc định 60 giây
	OfflineGrace   time.Duration // mất kết nối cuối cùng quá khoảng này mới báo offline; mặc định 30 giây
	Workers        int           // số worker của bộ chạy tuần tự Submit; mặc định 4
	QueueSize      int           // sức chứa hàng đợi của mỗi worker; mặc định 1024
	SendBuffer     int           // số gói chờ ghi của mỗi kết nối, đầy thì đóng kết nối (client chậm); mặc định 256
	Now            func() time.Time
}
