package chat

import (
	"errors"
	"fmt"

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

// Mã lỗi phần tệp đính kèm (MEDIA_DISABLED khai ở media.go). REST: khoá "code"; WebSocket: data.code (qua wsError).
const (
	CodeMediaType        = "MEDIA_TYPE"
	CodeMediaTooLarge    = "MEDIA_TOO_LARGE"
	CodeMediaQuota       = "MEDIA_QUOTA"
	CodeMediaNotFound    = "MEDIA_NOT_FOUND"
	CodeMediaNotUploaded = "MEDIA_NOT_UPLOADED"
	CodeMediaMismatch    = "MEDIA_MISMATCH"
	CodeMediaNotReady    = "MEDIA_NOT_READY"
	CodeMediaBlocked     = "MEDIA_BLOCKED"
)

var (
	errMediaType        = apperr.E(415, "Loại tệp này không gửi được", CodeMediaType)
	errMediaImageType   = apperr.E(415, "Loại ảnh này không gửi được, hãy gửi dạng tệp", CodeMediaType)
	errMediaQuota       = apperr.E(429, "Hôm nay bạn đã gửi quá dung lượng cho phép", CodeMediaQuota)
	errMediaNotFound    = apperr.E(404, "Không tìm thấy tệp", CodeMediaNotFound)
	errMediaNotUploaded = apperr.E(409, "Tệp chưa tải lên xong", CodeMediaNotUploaded)
	errMediaMismatch    = apperr.E(422, "Tệp tải lên không khớp, mời gửi lại", CodeMediaMismatch)
	errMediaNotReady    = apperr.E(409, "Tệp chưa sẵn sàng để gửi", CodeMediaNotReady)
	errMediaBlocked     = apperr.E(422, "Tệp bị chặn vì nghi chứa mã độc", CodeMediaBlocked)
	errMediaStarting    = apperr.E(503, "Kho tệp đang khởi động, thử lại sau", CodeUnavailable)
	errMediaScanDown    = apperr.E(503, "Chưa kiểm tra được tệp, thử lại sau", CodeUnavailable)
)

// Mã lỗi phần quản trị nhóm (migration 0022, API.md mục "Quản trị nhóm").
const (
	CodeGroupDisbanded = "GROUP_DISBANDED"
	CodeGroupFull      = "GROUP_FULL"
	CodeInviteInvalid  = "INVITE_INVALID"
	CodeInviteExpired  = "INVITE_EXPIRED"
)

var (
	errGroupDisbanded = apperr.E(410, "Nhóm đã bị giải tán", CodeGroupDisbanded)
	errGroupFull      = apperr.E(409, "Nhóm đã đủ 1000 thành viên", CodeGroupFull)
	errInviteInvalid  = apperr.E(404, "Link mời không tồn tại hoặc đã bị thu hồi", CodeInviteInvalid)
	errInviteExpired  = apperr.E(410, "Link mời đã hết hạn", CodeInviteExpired)
)

// Mã lỗi giai đoạn 2 (migration 0023, API.md mục "Giai đoạn 2 ..."): sửa / thu hồi / trả lời / chuyển tiếp, đăng nhập QR.
const (
	CodeMessageRecalled = "MESSAGE_RECALLED"
	CodeMessageTooOld   = "MESSAGE_TOO_OLD"
	CodeQRInvalid       = "QR_INVALID"
	CodeQRExpired       = "QR_EXPIRED"
	CodeQRUsed          = "QR_USED"
)

var (
	errMessageNotFound = apperr.E(404, "Không tìm thấy tin nhắn", CodeNotFound)
	errMessageRecalled = apperr.E(410, "Tin nhắn đã bị thu hồi", CodeMessageRecalled)
	errRecallTooOld    = apperr.E(403, "Chỉ thu hồi được tin nhắn gửi trong vòng 24 giờ", CodeMessageTooOld)
	errEditTooOld      = apperr.E(403, "Chỉ sửa được tin nhắn gửi trong vòng 24 giờ", CodeMessageTooOld)
	errActionRateLimit = apperr.E(429, "Bạn thao tác quá nhanh, thử lại sau", CodeRateLimit)
	errQRInvalid       = apperr.E(404, "Mã đăng nhập không đúng hoặc đã bị huỷ", CodeQRInvalid)
	errQRExpired       = apperr.E(410, "Mã đăng nhập đã hết hạn, hãy tạo mã mới", CodeQRExpired)
	errQRUsed          = apperr.E(409, "Mã đăng nhập đã được dùng", CodeQRUsed)
)

// errMediaTooLarge: 413 kèm giới hạn (MB, làm tròn lên; dưới 1 MB ghi KB).
func errMediaTooLarge(maxBytes int64) error {
	lim := fmt.Sprintf("%d MB", (maxBytes+(1<<20)-1)>>20)
	if maxBytes < 1<<20 {
		lim = fmt.Sprintf("%d KB", (maxBytes+1023)>>10)
	}
	return apperr.E(413, "Tệp quá lớn (tối đa "+lim+")", CodeMediaTooLarge)
}
