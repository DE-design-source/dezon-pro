package chat

import "time"

// Dữ liệu vào / ra của chat giai đoạn 2 (migration 0023, backend/docs/API.md mục "Giai đoạn 2: trả lời, chuyển tiếp, thu hồi,
// sửa, reaction, tìm kiếm, đa thiết bị"): trả lời, chuyển tiếp, thu hồi, sửa tin, reaction, tìm tin, danh sách thiết bị +
// đăng xuất từ xa, đăng nhập bằng QR. File này là HỢP ĐỒNG giữa các phần: tên kiểu / khoá JSON / hằng không tự đổi.

// Gói WebSocket server -> client mới (gửi bằng s.sendTo; realtime/protocol.go khai cùng tên).
const (
	EvMessageUpdated   = "message.updated"   // MessageUpdatedEvent: tin bị sửa / thu hồi
	EvReactionsUpdated = "reactions.updated" // ReactionsUpdatedEvent: reaction của một tin đổi
	EvDevicesUpdated   = "devices.updated"   // DevicesUpdatedDTO: danh sách thiết bị của tôi đổi (chỉ tới chính tôi)
)

// MessageUpdatedEvent.Action.
const (
	ActionEdit   = "edit"
	ActionRecall = "recall"
)

// Giới hạn của giai đoạn 2 (API.md - Giới hạn).
const (
	msgActionWindow     = 24 * time.Hour // người gửi sửa / thu hồi tin của chính mình trong khoảng này (tính từ created_at)
	maxForwardTargets   = 20             // số hội thoại tối đa mỗi lần chuyển tiếp
	replySnippetRunes   = 200            // ReplyPreviewDTO.Content tối đa
	defaultChangesLimit = 100            // GET .../messages/changes
	maxChangesLimit     = 200
	searchMinChars      = 2   // tổng số ký tự chữ / số của truy vấn sau khi bỏ dấu
	maxSearchQueryRunes = 100 // q dài hơn -> BAD_REQUEST
	maxSearchTerms      = 8   // chỉ lấy 8 từ đầu
	searchDefaultLimit  = 20
	searchMaxLimit      = 50
	qrTTL               = 2 * time.Minute  // phiên QR sống từ lúc tạo
	qrClaimGrace        = time.Minute      // duyệt xong: expires_at >= lúc duyệt + 60 giây
	qrPollIntervalSec   = 2                // QRStartResult.PollInterval
	qrCodeLen           = 10               // ký tự Crockford base32 (50 bit)
	qrStartPerIP        = 20               // phiên QR / qrStartWindow / IP
	qrStartWindow       = 10 * time.Minute //
	maxUserAgent        = 500              // ký tự (chat_devices.user_agent, chat_qr_login_sessions.user_agent)
	maxIPLen            = 64
)

// ReactionCodes: bộ reaction cố định (ck_chat_message_reactions_reaction). Giao diện: 👍 ❤️ 😆 😮 😢 😡.
var ReactionCodes = []string{"like", "love", "haha", "wow", "sad", "angry"}

// validReaction: code thuộc ReactionCodes (phân biệt hoa thường).
func validReaction(code string) bool {
	for _, c := range ReactionCodes {
		if c == code {
			return true
		}
	}
	return false
}

// Tìm tin (service_search.go): truy vấn PHẢI dùng đúng biểu thức + điều kiện của index idx_chat_messages_content_file_name
// (m = chat_messages) thì planner mới chọn index; tsquery dựng từ các từ đã qua foldVN, mỗi từ dạng 'tu':* nối bằng &.
const (
	searchDocSQL    = `to_tsvector('simple'::regconfig, chat_search_fold(m.content || ' ' || coalesce(m.file_name, '')))`
	searchFilterSQL = `m.message_type <> 'system' and m.recalled_at is null`
)

// chat_devices.login_method.
const (
	LoginOTP = "otp"
	LoginQR  = "qr"
)

// Trạng thái phiên QR (chat_qr_login_sessions.status) + QRExpired (chỉ là kết quả poll / thông tin, không lưu).
const (
	QRPending  = "pending"
	QRScanned  = "scanned"
	QRApproved = "approved"
	QRRejected = "rejected"
	QRConsumed = "consumed"
	QRExpired  = "expired"
)

// deviceOnliner: gateway biết thiết bị nào đang có kết nối WebSocket (*realtime.Hub cài; không bắt buộc - kiểm bằng type
// assertion trên s.gateway(), không có thì DeviceDTO.Online = false).
type deviceOnliner interface {
	OnlineDevices(deviceIDs []int64) map[int64]bool
}

// ───────────── Trả lời / chuyển tiếp / sửa / thu hồi ─────────────

// ReplyPreviewDTO: tin được trả lời, dựng lúc đọc (MessageDTO.ReplyTo). Tin gốc đã thu hồi -> Recalled = true, Content = "",
// FileName = nil. Content là văn bản thuần (không kèm mentions), tối đa replySnippetRunes ký tự.
type ReplyPreviewDTO struct {
	MessageID  int64   `json:"message_id"`
	Seq        int64   `json:"seq"`
	SenderID   int64   `json:"sender_id"`
	SenderName string  `json:"sender_name"`
	MsgType    string  `json:"msg_type"`
	Content    string  `json:"content"`
	FileName   *string `json:"file_name,omitempty"` // tin file: tên của tin gốc
	Recalled   bool    `json:"recalled"`
}

// MessageUpdatedEvent: data của gói message.updated. Message là tin SAU thay đổi, KHÔNG có khoá reactions (giữ reaction đang
// có; recall thì client xoá reactions của tin). Recall: content "", không attachments / mentions / reply_to, recalled = true.
type MessageUpdatedEvent struct {
	ConversationID int64      `json:"conversation_id"`
	Action         string     `json:"action"` // edit / recall
	Message        MessageDTO `json:"message"`
}

// EditInput: thân PATCH /messages/:message_id. Mentions: như message.send (chỉ nhóm), kiểm lại toàn bộ.
type EditInput struct {
	Content  string    `json:"content"`
	Mentions []Mention `json:"mentions"`
}

// ForwardTarget: một hội thoại nhận + client_msg_id (UUID) riêng để gửi lại không trùng.
type ForwardTarget struct {
	ConversationID int64  `json:"conversation_id"`
	ClientMsgID    string `json:"client_msg_id"`
}

// ForwardInput: thân POST /messages/:message_id/forward (1..maxForwardTargets đích, không trùng conversation_id).
type ForwardInput struct {
	Targets []ForwardTarget `json:"targets"`
}

// ForwardError: lỗi của một đích (cùng code / message như lỗi REST).
type ForwardError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ForwardItemResult: kết quả của một đích, theo đúng thứ tự Targets. OK = true thì có Ack (như ack của message.send).
type ForwardItemResult struct {
	ConversationID int64         `json:"conversation_id"`
	OK             bool          `json:"ok"`
	Ack            *SendAck      `json:"ack,omitempty"`
	Error          *ForwardError `json:"error,omitempty"`
}

// ForwardResult: kết quả POST /messages/:message_id/forward.
type ForwardResult struct {
	Results []ForwardItemResult `json:"results"`
}

// MessageChangesPage: kết quả GET /conversations/:id/messages/changes - tin đã sửa / thu hồi / đổi reaction sau mốc, cũ trước
// (theo chat_messages.updated_at, id). NextCursor khác null: còn nữa, gọi lại với cursor = NextCursor.
type MessageChangesPage struct {
	Messages   []MessageDTO `json:"messages"`
	NextCursor *string      `json:"next_cursor"`
}

// ───────────── Reaction ─────────────

// ReactionSummaryDTO: tổng hợp reaction của một tin nhìn từ người xem. Counts chỉ có code > 0; Mine = code của tôi hoặc null.
type ReactionSummaryDTO struct {
	Counts map[string]int64 `json:"counts"`
	Total  int64            `json:"total"`
	Mine   *string          `json:"mine"`
}

// ReactionsUpdatedEvent: data của gói reactions.updated (giống nhau với mọi người nhận). UserID = người vừa đổi, Reaction = code
// mới của họ (null = vừa bỏ); client tự đặt "mine" khi UserID là mình.
type ReactionsUpdatedEvent struct {
	ConversationID int64            `json:"conversation_id"`
	MessageID      int64            `json:"message_id"`
	Seq            int64            `json:"seq"`
	Counts         map[string]int64 `json:"counts"`
	Total          int64            `json:"total"`
	UserID         int64            `json:"user_id"`
	Reaction       *string          `json:"reaction"`
}

// ReactionUserDTO: một người đã thả reaction.
type ReactionUserDTO struct {
	UserID      int64  `json:"user_id"`
	DisplayName string `json:"display_name"`
	Reaction    string `json:"reaction"`
	CreatedAt   string `json:"created_at"`
}

// ReactionList: kết quả GET /messages/:message_id/reactions (mới trước).
type ReactionList struct {
	MessageID int64             `json:"message_id"`
	Reactions []ReactionUserDTO `json:"reactions"`
}

// reactionBody: thân PUT /messages/:message_id/reaction.
type reactionBody struct {
	Reaction string `json:"reaction"`
}

// ───────────── Tìm tin ─────────────

// SearchInput: tham số tìm tin. ConversationID = 0: mọi hội thoại tôi đang xem được (đang hoạt động hoặc chỉ đọc sau giải tán).
// Cursor: next_cursor của trang trước ("" = trang đầu).
type SearchInput struct {
	ConversationID int64
	Query          string
	Cursor         string
	Limit          int
}

// SearchHitDTO: một tin khớp (mới trước). ConversationName: tên nhóm / tên người kia của chat 1-1. Content: toàn bộ nội dung
// (client tự cắt đoạn + tô từ khớp bằng cùng luật bỏ dấu). Không có attachments / URL.
type SearchHitDTO struct {
	ConversationID   int64   `json:"conversation_id"`
	ConversationType string  `json:"conversation_type"`
	ConversationName string  `json:"conversation_name"`
	MessageID        int64   `json:"message_id"`
	Seq              int64   `json:"seq"`
	SenderID         int64   `json:"sender_id"`
	SenderName       string  `json:"sender_name"`
	MsgType          string  `json:"msg_type"`
	Content          string  `json:"content"`
	FileName         *string `json:"file_name,omitempty"`
	CreatedAt        string  `json:"created_at"`
}

// SearchResult: kết quả GET /search/messages và GET /conversations/:id/messages/search.
type SearchResult struct {
	Hits       []SearchHitDTO `json:"hits"`
	NextCursor *string        `json:"next_cursor"`
}

// ───────────── Thiết bị ─────────────

// DeviceInput: thiết bị khai khi đăng nhập (OTP verify, QR start).
type DeviceInput struct {
	Platform string `json:"platform"`
	Name     string `json:"name"`
}

// DeviceDTO: một thiết bị đang đăng nhập của tôi.
type DeviceDTO struct {
	ID          int64   `json:"id"`
	Platform    string  `json:"platform"`
	Name        string  `json:"name"`
	UserAgent   string  `json:"user_agent"`
	LastIP      string  `json:"last_ip"`
	LoginMethod string  `json:"login_method"` // otp / qr
	Push        bool    `json:"push"`         // có push token
	Online      bool    `json:"online"`       // đang có kết nối WebSocket (gateway hỗ trợ deviceOnliner)
	Current     bool    `json:"current"`      // thiết bị của chính request này
	LastSeenAt  *string `json:"last_seen_at"`
	CreatedAt   string  `json:"created_at"`
}

// DeviceList: kết quả GET /devices (thiết bị hiện tại trước, rồi last_seen_at mới trước).
type DeviceList struct {
	Devices []DeviceDTO `json:"devices"`
}

// RevokeOthersResult: kết quả POST /devices/logout-others.
type RevokeOthersResult struct {
	Revoked int64 `json:"revoked"`
}

// DevicesUpdatedDTO: data của gói devices.updated (tới mọi kết nối của chính tôi). Reason: login / logout / revoked.
type DevicesUpdatedDTO struct {
	Reason   string `json:"reason"`
	DeviceID int64  `json:"device_id"`
}

// ───────────── Đăng nhập bằng QR ─────────────

// QRStartInput: thân POST /auth/qr/start (công khai).
type QRStartInput struct {
	Device DeviceInput `json:"device"`
}

// QRStartResult: Code (10 ký tự Crockford base32, viết hoa, không gạch) để hiện trong QR / cho gõ tay; PollToken chỉ máy chờ
// giữ (không đưa vào QR). ExpiresIn giây (120), PollInterval giây (2).
type QRStartResult struct {
	QRID         int64  `json:"qr_id"`
	Code         string `json:"code"`
	PollToken    string `json:"poll_token"`
	ExpiresIn    int    `json:"expires_in"`
	PollInterval int    `json:"poll_interval"`
}

// QRPollInput: thân POST /auth/qr/poll (công khai).
type QRPollInput struct {
	QRID      int64  `json:"qr_id"`
	PollToken string `json:"poll_token"`
}

// QRApproverDTO: người đã duyệt (chỉ trả kèm approved).
type QRApproverDTO struct {
	DisplayName string `json:"display_name"`
}

// QRPollResult: Status pending / scanned / approved / rejected / consumed / expired. Auth chỉ có đúng MỘT lần, ở lần poll đầu
// tiên thấy approved (cùng lúc phiên thành consumed); Approver chỉ có khi approved (scanned không lộ tên người quét).
type QRPollResult struct {
	Status    string         `json:"status"`
	ExpiresIn int            `json:"expires_in"`
	Approver  *QRApproverDTO `json:"approver,omitempty"`
	Auth      *AuthResult    `json:"auth,omitempty"`
}

// QRCodeInput: thân POST /auth/qr/scan | approve | reject (người đã đăng nhập). Code: như QRStartResult.Code; chấp nhận chữ
// thường, gạch nối, khoảng trắng, O -> 0, I / L -> 1, hoặc cả URL <origin>/chat/qr#<code>.
type QRCodeInput struct {
	Code string `json:"code"`
}

// QRSessionInfoDTO: thông tin máy đang chờ, cho màn xác nhận.
type QRSessionInfoDTO struct {
	QRID       int64  `json:"qr_id"`
	Status     string `json:"status"`
	Platform   string `json:"platform"`
	DeviceName string `json:"device_name"`
	UserAgent  string `json:"user_agent"`
	RequestIP  string `json:"request_ip"`
	CreatedAt  string `json:"created_at"`
	ExpiresAt  string `json:"expires_at"`
	ExpiresIn  int    `json:"expires_in"`
}

// QRDecisionResult: kết quả approve / reject.
type QRDecisionResult struct {
	Status string `json:"status"` // approved / rejected
}
