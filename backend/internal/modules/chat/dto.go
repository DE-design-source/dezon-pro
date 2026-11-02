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

type renameBody struct {
	Name string `json:"name"`
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

// SendInput: data của gói message.send.
type SendInput struct {
	ConversationID int64  `json:"conversation_id"`
	ClientMsgID    string `json:"client_msg_id"`
	MsgType        string `json:"msg_type"`
	Content        string `json:"content"`
}

type receiptInput struct {
	ConversationID int64 `json:"conversation_id"`
	Seq            int64 `json:"seq"`
}
