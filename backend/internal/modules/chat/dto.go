package chat

import (
	"time"

	"qspro-backend/internal/shared/omap"
)

// Kiểu dữ liệu trả cho client (REST result + data của gói WebSocket). Khoá snake_case như CHAT.md mục 5.
// Thời điểm là chuỗi RFC3339 UTC có mili giây (2026-10-30T03:04:05.123Z), dựng sẵn thành string để mọi bộ mã hoá JSON
// (response của REST, encoding/json của gateway) ra cùng một dạng.

// iso: thời điểm -> chuỗi; isoPtr: nil -> null.
func iso(t time.Time) string { return omap.ISOTime(t) }

func isoPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := iso(*t)
	return &s
}

// Quan hệ của tôi với một người (User.relation).
const (
	relSelf     = "self"
	relFriend   = "friend"
	relOutgoing = "outgoing"
	relIncoming = "incoming"
	relBlocked  = "blocked"
	relNone     = "none"
)

// UserDTO: một người dùng chat nhìn từ phía người đang đăng nhập.
// Phone chỉ có với chính mình, bạn bè và kết quả tra đúng số / đồng bộ danh bạ; Email chỉ có với chính mình, bạn bè và
// kết quả tra đúng email (tra số không lộ email và ngược lại); tài khoản không có số / email thì null.
// Bị người đó chặn thì relation = "none" (không lộ).
type UserDTO struct {
	ID          int64   `json:"id"`
	DisplayName string  `json:"display_name"`
	Phone       *string `json:"phone"`
	Email       *string `json:"email"`
	Relation    string  `json:"relation"`
	Online      bool    `json:"online"`
}

// MeDTO: tài khoản của chính mình.
type MeDTO struct {
	UserDTO
	ShowReadReceipts bool   `json:"show_read_receipts"`
	CreatedAt        string `json:"created_at"`
}

// MatchedUserDTO: kết quả đồng bộ danh bạ; Matched = số / hash đúng như client gửi.
type MatchedUserDTO struct {
	UserDTO
	Matched string `json:"matched"`
}

// RequestUserDTO: một lời mời kết bạn.
type RequestUserDTO struct {
	UserDTO
	RequestedAt string `json:"requested_at"`
}

// MessageDTO: một tin nhắn (REST + gói message.new).
type MessageDTO struct {
	ID             int64   `json:"id"`
	ConversationID int64   `json:"conversation_id"`
	Seq            int64   `json:"seq"`
	ClientMsgID    *string `json:"client_msg_id"`
	SenderID       int64   `json:"sender_id"`
	SenderName     string  `json:"sender_name"`
	MsgType        string  `json:"msg_type"`
	Content        string  `json:"content"`
	CreatedAt      string  `json:"created_at"`
	// Tệp đính kèm của tin image / video / file / voice (đúng 1); tin text / system không có khoá này.
	Attachments []MediaDTO `json:"attachments,omitempty"`
	// @nhắc tên trong content (chat_messages.mentions, sắp theo offset); không có thì không có khoá này.
	Mentions []Mention `json:"mentions,omitempty"`
	// Giai đoạn 2 (migration 0023, dto_phase2.go). Khoá vắng = false / null.
	ReplyTo    *ReplyPreviewDTO    `json:"reply_to,omitempty"`    // tin được trả lời
	Forwarded  bool                `json:"forwarded,omitempty"`   // "Đã chuyển tiếp"
	EditedAt   *string             `json:"edited_at,omitempty"`   // "Đã chỉnh sửa"
	Recalled   bool                `json:"recalled,omitempty"`    // "Tin nhắn đã bị thu hồi" (content rỗng, không tệp)
	RecalledBy *int64              `json:"recalled_by,omitempty"` // khác sender_id = trưởng / phó nhóm thu hồi
	Reactions  *ReactionSummaryDTO `json:"reactions,omitempty"`   // chỉ có ở REST (messages, around, changes); không có reaction -> vắng
}

// ConversationDTO: một dòng danh sách hội thoại. MutedUntil = "forever" khi tắt thông báo vĩnh viễn.
type ConversationDTO struct {
	ID               int64       `json:"id"`
	Type             string      `json:"type"`
	Name             *string     `json:"name"`
	Peer             *UserDTO    `json:"peer"`
	MemberCount      int64       `json:"member_count"`
	Role             string      `json:"role"`
	LastSeq          int64       `json:"last_seq"`
	LastReadSeq      int64       `json:"last_read_seq"`
	LastDeliveredSeq int64       `json:"last_delivered_seq"`
	Unread           int64       `json:"unread"`
	LastMessage      *MessageDTO `json:"last_message"`
	LastMessageAt    *string     `json:"last_message_at"`
	MutedUntil       *string     `json:"muted_until"`
	Left             bool        `json:"left"`
	CreatedAt        string      `json:"created_at"`
	UpdatedAt        string      `json:"updated_at"`
	// Quản trị nhóm (0022). Description / Avatar / Settings: null với chat 1-1 và dòng đã rời.
	Description *string           `json:"description"`
	Avatar      *MediaDTO         `json:"avatar"`
	Settings    *GroupSettingsDTO `json:"settings"`
	// Disbanded: nhóm đã giải tán, dòng chỉ đọc (left = false, member_count = 0, unread = 0).
	Disbanded bool `json:"disbanded"`
	// LastMentionSeq: seq của tin mới nhất nhắc tới tôi (hoặc @Tất cả), 0 = chưa có; UnreadMention = LastMentionSeq > LastReadSeq
	// (false với dòng đã rời / đã giải tán).
	LastMentionSeq int64 `json:"last_mention_seq"`
	UnreadMention  bool  `json:"unread_mention"`
}

// MemberDTO: thành viên đang hoạt động; LastReadSeq = null khi người đó tắt "hiển thị đã xem" (trừ chính mình).
type MemberDTO struct {
	UserID           int64  `json:"user_id"`
	DisplayName      string `json:"display_name"`
	Role             string `json:"role"`
	LastReadSeq      *int64 `json:"last_read_seq"`
	LastDeliveredSeq int64  `json:"last_delivered_seq"`
	JoinedAt         string `json:"joined_at"`
}

// ConversationDetailDTO = ConversationDTO + thành viên.
type ConversationDetailDTO struct {
	ConversationDTO
	Members []MemberDTO `json:"members"`
	// PendingJoinRequests: số yêu cầu vào nhóm đang chờ duyệt (chỉ trưởng / phó nhóm thấy, người khác 0).
	PendingJoinRequests int64 `json:"pending_join_requests"`
}

// OTPRequestResult: kết quả POST /chat/auth/otp/request - đúng một trong Phone / Email (nơi đã gửi mã, đã chuẩn hoá).
// DevCode chỉ có khi CHAT_OTP_DEV=1.
type OTPRequestResult struct {
	Phone       string `json:"phone,omitempty"`
	Email       string `json:"email,omitempty"`
	ExpiresIn   int    `json:"expires_in"`
	ResendAfter int    `json:"resend_after"`
	DevCode     string `json:"dev_code,omitempty"`
}

// AuthResult: cặp token mới (verify / refresh). IsNew chỉ có ở verify.
type AuthResult struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	DeviceID     int64  `json:"device_id"`
	User         *MeDTO `json:"user"`
	IsNew        *bool  `json:"is_new,omitempty"`
}

// SendAck: data của gói "ack" cho message.send.
type SendAck struct {
	ConversationID int64   `json:"conversation_id"`
	ClientMsgID    *string `json:"client_msg_id"`
	MessageID      int64   `json:"message_id"`
	Seq            int64   `json:"seq"`
	CreatedAt      string  `json:"created_at"`
	Duplicate      bool    `json:"duplicate"`
	// Tệp đính kèm như đã lưu (client dùng bản này, không dùng media_id của mình - gửi trùng trả tin gốc).
	Attachments []MediaDTO `json:"attachments,omitempty"`
	// @nhắc tên như đã lưu (bỏ người không còn trong nhóm); không có thì không có khoá này.
	Mentions []Mention `json:"mentions,omitempty"`
	// Tin được trả lời như đã lưu (giai đoạn 2); không trả lời thì không có khoá này.
	ReplyTo *ReplyPreviewDTO `json:"reply_to,omitempty"`

	mediaID  *int64  // tin đã lưu (đường gửi trùng): chat_messages.media_id
	fileName *string // chat_messages.file_name
}

// ReceiptAck: data của gói "ack" cho message.delivered / message.read (con trỏ hiện tại của tôi).
type ReceiptAck struct {
	ConversationID int64 `json:"conversation_id"`
	DeliveredSeq   int64 `json:"delivered_seq"`
	ReadSeq        int64 `json:"read_seq"`
}

// ReceiptUpdate: gói receipt.update; ReadSeq = null gửi cho người khác khi user tắt "hiển thị đã xem".
type ReceiptUpdate struct {
	ConversationID int64  `json:"conversation_id"`
	UserID         int64  `json:"user_id"`
	DeliveredSeq   int64  `json:"delivered_seq"`
	ReadSeq        *int64 `json:"read_seq"`
}

// ---- thân request ----

// OTPRequestInput: thân POST /chat/auth/otp/request - gửi một trong phone / email.
type OTPRequestInput struct {
	Phone string `json:"phone"`
	Email string `json:"email"`
}

// VerifyInput: thân POST /chat/auth/otp/verify (phone hoặc email đã xin mã).
type VerifyInput struct {
	Phone  string `json:"phone"`
	Email  string `json:"email"`
	OTP    string `json:"otp"`
	Device struct {
		Platform string `json:"platform"`
		Name     string `json:"name"`
	} `json:"device"`
	DisplayName string `json:"display_name"`
	// Do handler điền (không đọc từ JSON): IP của request, header User-Agent -> chat_devices.last_ip / user_agent.
	ClientIP  string `json:"-"`
	UserAgent string `json:"-"`
}

type refreshBody struct {
	RefreshToken string `json:"refresh_token"`
}

// MePatch: thân PATCH /chat/me (khoá không gửi = giữ nguyên).
type MePatch struct {
	DisplayName      *string `json:"display_name"`
	ShowReadReceipts *bool   `json:"show_read_receipts"`
}

type userIDBody struct {
	UserID int64 `json:"user_id"`
}

type matchBody struct {
	Phones      []string `json:"phones"`
	PhoneHashes []string `json:"phone_hashes"`
}

type createConvBody struct {
	Type      string  `json:"type"`
	UserID    int64   `json:"user_id"`
	Name      string  `json:"name"`
	MemberIDs []int64 `json:"member_ids"`
}

type addMembersBody struct {
	UserIDs []int64 `json:"user_ids"`
}

type roleBody struct {
	Role string `json:"role"`
}

type muteBody struct {
	Until *string `json:"until"`
}

type pushBody struct {
	PushKind  string `json:"push_kind"`
	PushToken string `json:"push_token"`
}

// SendInput: data của gói message.send. Attachments: [media_id] (đúng 1 với image / video / file / voice);
// FileName: chỉ tin file, tên hiển thị / tải về của tin này (bỏ trống = tên lúc tải lên).
type SendInput struct {
	ConversationID int64   `json:"conversation_id"`
	ClientMsgID    string  `json:"client_msg_id"`
	MsgType        string  `json:"msg_type"`
	Content        string  `json:"content"`
	Attachments    []int64 `json:"attachments"`
	FileName       string  `json:"file_name"`
	// Mentions: @nhắc tên (chỉ nhóm; luật kiểm ở API.md mục "Quản trị nhóm").
	Mentions []Mention `json:"mentions"`
	// ReplyToMessageID: trả lời tin này (cùng hội thoại, không phải tin hệ thống, chưa thu hồi); 0 / vắng = không trả lời.
	ReplyToMessageID int64 `json:"reply_to_message_id"`
}

type receiptInput struct {
	ConversationID int64 `json:"conversation_id"`
	Seq            int64 `json:"seq"`
}
