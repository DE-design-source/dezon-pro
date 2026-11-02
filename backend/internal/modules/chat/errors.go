package chat

import (
	"errors"

	"qspro-backend/internal/modules/chat/realtime"
	"qspro-backend/internal/platform/logger"
	apperr "qspro-backend/internal/shared/errors"
)

// Mã lỗi của chat (REST: khoá "code"; WebSocket: data.code của gói "error").
const (
	CodeBadRequest     = "BAD_REQUEST"
	CodePhoneInvalid   = "PHONE_INVALID"
	CodeEmailInvalid   = "EMAIL_INVALID"
	CodeOTPInvalid     = "OTP_INVALID"
	CodeOTPExpired     = "OTP_EXPIRED"
	CodeOTPRateLimit   = "OTP_RATE_LIMIT"
	CodeOTPLocked      = "OTP_LOCKED"
	CodeNoAuth         = "CHAT_NOAUTH"
	CodeRefreshInvalid = "REFRESH_INVALID"
	CodeRefreshReused  = "REFRESH_REUSED"
	CodeRefreshRace    = "REFRESH_RACE"
	CodeForbidden      = "FORBIDDEN"
	CodeBlocked        = "BLOCKED"
	CodeNotFound       = "NOT_FOUND"
	CodeRateLimit      = "RATE_LIMIT"
	CodeInternal       = "INTERNAL"
	CodeAuthFailed     = "AUTH_FAILED"
	CodeUnknownType    = "UNKNOWN_TYPE"
	CodeUnavailable    = "UNAVAILABLE"
)

// MsgNoAuth: thông báo 401 của middleware chat.
const MsgNoAuth = "Phiên chat đã hết, mời đăng nhập lại"

var (
	errNoAuth         = apperr.E(401, MsgNoAuth, CodeNoAuth)
	errPhoneInvalid   = apperr.E(400, "Số điện thoại không hợp lệ", CodePhoneInvalid)
	errEmailInvalid   = apperr.E(400, "Email không hợp lệ", CodeEmailInvalid)
	errPhoneAndEmail  = apperr.E(400, "Chỉ gửi một trong hai: số điện thoại hoặc email", CodeBadRequest)
	errOTPInvalid     = apperr.E(400, "Mã xác thực không đúng", CodeOTPInvalid)
	errOTPExpired     = apperr.E(400, "Mã xác thực đã hết hạn, mời gửi lại mã", CodeOTPExpired)
	errRefreshInvalid = apperr.E(401, "Phiên đăng nhập không hợp lệ, mời đăng nhập lại", CodeRefreshInvalid)
	errRefreshReused  = apperr.E(401, "Phiên đăng nhập đã bị thu hồi vì token bị dùng lại, mời đăng nhập lại", CodeRefreshReused)
	errRefreshRace    = apperr.E(409, "Phiên vừa được làm mới ở nơi khác, hãy đọc lại token đã lưu", CodeRefreshRace)
	errNotMember      = apperr.E(403, "Bạn không còn trong cuộc trò chuyện này", CodeForbidden)
	errNotGroup       = apperr.E(400, "Thao tác này chỉ dành cho nhóm", CodeBadRequest)
	errRateLimit      = apperr.E(429, "Bạn thao tác quá nhanh, thử lại sau ít phút", CodeRateLimit)
	errSendRateLimit  = apperr.E(429, "Bạn gửi tin quá nhanh", CodeRateLimit)
	errMatchLimit     = apperr.E(429, "Hôm nay bạn đã tra quá nhiều số điện thoại / email, thử lại sau", CodeRateLimit)
	errNoDB           = errors.New("Chưa cấu hình DATABASE_URL (chuỗi kết nối PostgreSQL)")
)

func errBad(msg string) error       { return apperr.E(400, msg, CodeBadRequest) }
func errForbidden(msg string) error { return apperr.E(403, msg, CodeForbidden) }
func errBlocked(msg string) error   { return apperr.E(403, msg, CodeBlocked) }
func errNotFound(msg string) error  { return apperr.E(404, msg, CodeNotFound) }

// errBadBody: thân JSON hỏng / sai kiểu.
var errBadBody = apperr.E(400, "Dữ liệu gửi lên không hợp lệ", CodeBadRequest)

// wsError đổi lỗi nghiệp vụ thành lỗi gói "error" của WebSocket; lỗi khác (database...) ghi log và để gateway trả INTERNAL.
func wsError(where string, err error) error {
	if err == nil {
		return nil
	}
	var ae *apperr.AppError
	if errors.As(err, &ae) {
		code := ae.Code
		if code == "" {
			code = CodeInternal
		}
		return &realtime.Error{Code: code, Message: ae.Msg}
	}
	var re *realtime.Error
	if errors.As(err, &re) {
		return re
	}
	logger.Error("chat", where+" lỗi:", err.Error())
	return err
}
