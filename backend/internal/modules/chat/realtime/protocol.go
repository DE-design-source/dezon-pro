package realtime

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// Loại gói tin (CHAT.md mục 5).
const (
	// Client -> server.
	TypeAuth             = "auth"
	TypePing             = "ping"
	TypeMessageSend      = "message.send"
	TypeMessageDelivered = "message.delivered"
	TypeMessageRead      = "message.read"
	TypeTypingStart      = "typing.start"
	TypeTypingStop       = "typing.stop"
	TypePresenceSub      = "presence.subscribe"

	// Server -> client.
	TypeAuthOK         = "auth.ok"
	TypePong           = "pong"
	TypeAck            = "ack"
	TypeError          = "error"
	TypeMessageNew     = "message.new"
	TypeReceiptUpdate  = "receipt.update"
	TypePresenceUpdate = "presence.update"
	TypeTyping         = "typing"
	TypeReconnect      = "reconnect"
	TypeForceLogout    = "force_logout"

	// Server -> client, do Backend gửi qua bộ chạy tuần tự theo hội thoại (API.md mục "Quản trị nhóm" / ghim).
	TypePinsUpdated         = "pins.updated"
	TypeConversationUpdated = "conversation.updated"
	TypeMembersUpdated      = "members.updated"
	TypeJoinRequestsUpdated = "join_requests.updated"

	// Server -> client, giai đoạn 2 (API.md mục "Giai đoạn 2"; trùng tên chat.Ev*): tin bị sửa / thu hồi, reaction đổi
	// (qua bộ chạy tuần tự theo hội thoại), danh sách thiết bị của chính tài khoản đổi.
	TypeMessageUpdated   = "message.updated"
	TypeReactionsUpdated = "reactions.updated"
	TypeDevicesUpdated   = "devices.updated"
)

// Mã lỗi trong gói "error" do chính gateway sinh (mã nghiệp vụ khác do Backend trả qua *Error).
const (
	CodeAuthFailed      = "AUTH_FAILED"
	CodeUnauthenticated = "UNAUTHENTICATED"
	CodeBadRequest      = "BAD_REQUEST"
	CodeUnknownType     = "UNKNOWN_TYPE"
	CodeInternal        = "INTERNAL"
)

// Mã đóng kết nối WebSocket: 4xxx là mã riêng của ứng dụng, 1012 là mã chuẩn "máy chủ khởi động lại".
const (
	CloseUnauthorized  websocket.StatusCode = 4401 // xác thực thất bại / gửi gói khác trước "auth"
	CloseForceLogout   websocket.StatusCode = 4403 // thiết bị đã đăng xuất (sau gói "force_logout")
	CloseAuthTimeout   websocket.StatusCode = 4408 // không gửi "auth" trong Options.AuthTimeout
	CloseServerRestart websocket.StatusCode = 1012 // máy chủ khởi động lại (sau gói "reconnect")
)

const (
	maxFrameBytes      = 32 << 10         // gói lớn hơn 32 KiB -> đóng kết nối (thư viện gửi mã 1009)
	writeTimeout       = 10 * time.Second // ghi một gói quá lâu -> coi client đã chết
	closeWait          = 15 * time.Second // chờ tối đa bắt tay đóng kết nối trước khi cắt hẳn
	authCallTimeout    = 10 * time.Second
	messageCallTimeout = 15 * time.Second
	lookupCallTimeout  = 5 * time.Second
	typingThrottle     = time.Second // bỏ typing.start lặp lại của cùng (người, hội thoại) trong khoảng này
	maxPresenceTargets = 100
)

// Câu thông báo lỗi gửi cho client.
const (
	msgAuthFailed      = "Xác thực thất bại"
	msgUnauthenticated = "Chưa xác thực kết nối"
	msgBadRequest      = "Gói tin không hợp lệ"
	msgUnknownType     = "Loại gói tin không được hỗ trợ"
	msgInternal        = "Lỗi máy chủ"
	msgAlreadyAuthed   = "Kết nối đã xác thực"
	msgTooManyTargets  = "Tối đa 100 người mỗi lần theo dõi"
)

// emptyObject: data rỗng, mã hoá thành {}.
var emptyObject = struct{}{}

// packetIn: gói client gửi lên {"type","req_id"?,"data"?}.
type packetIn struct {
	Type  string          `json:"type"`
	ReqID json.RawMessage `json:"req_id"`
	Data  json.RawMessage `json:"data"`
}

// packetOut: gói server gửi xuống. req_id giữ nguyên dạng client gửi (chuỗi hoặc số).
type packetOut struct {
	Type  string          `json:"type"`
	ReqID json.RawMessage `json:"req_id,omitempty"`
	Data  any             `json:"data,omitempty"`
}

type errorData struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type authData struct {
	AccessToken string `json:"access_token"`
	DeviceID    flexID `json:"device_id"`
}

type authOKData struct {
	UserID     int64  `json:"user_id"`
	ServerTime string `json:"server_time"`
}

type conversationData struct {
	ConversationID flexID `json:"conversation_id"`
}

type typingData struct {
	ConversationID int64 `json:"conversation_id"`
	UserID         int64 `json:"user_id"`
	IsTyping       bool  `json:"is_typing"`
}

type presenceSubData struct {
	UserIDs []flexID `json:"user_ids"`
}

type presenceData struct {
	UserID   int64   `json:"user_id"`
	Online   bool    `json:"online"`
	LastSeen *string `json:"last_seen"`
}

var errBadPacket = errors.New("gói tin không hợp lệ")

// parsePacket đọc một gói: phải là object JSON có "type" không rỗng; req_id (nếu có) là chuỗi hoặc số;
// data thiếu hoặc null -> {}.
func parsePacket(b []byte) (packetIn, error) {
	var p packetIn
	if err := json.Unmarshal(b, &p); err != nil {
		return packetIn{}, errBadPacket
	}
	if rid := strings.TrimSpace(string(p.ReqID)); rid == "" || rid == "null" {
		p.ReqID = nil
	} else if c := rid[0]; c != '"' && c != '-' && (c < '0' || c > '9') {
		return packetIn{}, errBadPacket
	}
	if d := strings.TrimSpace(string(p.Data)); d == "" || d == "null" {
		p.Data = json.RawMessage("{}")
	}
	if p.Type == "" {
		// Vẫn trả req_id để client khớp được lỗi.
		return packetIn{ReqID: p.ReqID}, errBadPacket
	}
	return p, nil
}

// encodePacket mã hoá một gói gửi xuống. Lỗi chỉ xảy ra khi data không mã hoá được (lỗi lập trình).
func encodePacket(typ string, reqID json.RawMessage, data any) ([]byte, error) {
	return json.Marshal(packetOut{Type: typ, ReqID: reqID, Data: data})
}

// flexID: số nguyên dương nhận cả dạng số lẫn chuỗi số ("7") - localStorage của trình duyệt chỉ giữ chuỗi.
type flexID int64

func (f *flexID) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	if s == "null" {
		*f = 0
		return nil
	}
	if strings.HasPrefix(s, `"`) {
		u, err := strconv.Unquote(s)
		if err != nil {
			return err
		}
		s = strings.TrimSpace(u)
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return err
	}
	*f = flexID(n)
	return nil
}

// formatTime: RFC3339 UTC có mili giây, ví dụ 2026-10-30T03:04:05.123Z (cùng dạng với REST của chat).
func formatTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// errorOf đổi lỗi của Backend thành {code, message}: *Error giữ mã của nó, lỗi khác -> fallback.
func errorOf(err error, fallbackCode, fallbackMsg string) errorData {
	var e *Error
	if errors.As(err, &e) && e != nil && e.Code != "" {
		msg := e.Message
		if msg == "" {
			msg = fallbackMsg
		}
		return errorData{Code: e.Code, Message: msg}
	}
	return errorData{Code: fallbackCode, Message: fallbackMsg}
}
