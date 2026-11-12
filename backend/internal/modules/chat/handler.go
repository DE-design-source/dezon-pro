package chat

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/response"
)

const tag = "Chat"

const (
	ctxUID = "chat.uid"
	ctxDID = "chat.did"
)

var (
	userPath  = rpc.GoField{Name: "user_id", In: "path", Type: "integer", Desc: "Mã người dùng chat"}
	convPath  = rpc.GoField{Name: "id", In: "path", Type: "integer", Desc: "Mã hội thoại (conversation_id)"}
	mediaPath = rpc.GoField{Name: "id", In: "path", Type: "integer", Desc: "Mã tệp (media_id)"}
	// invitePath: token link mời 43 ký tự base64url; requestPath: mã yêu cầu vào nhóm.
	invitePath  = rpc.GoField{Name: "token", In: "path", Type: "string", Desc: "Token link mời (43 ký tự, trong url_path /chat/join/<token>)"}
	requestPath = rpc.GoField{Name: "request_id", In: "path", Type: "integer", Desc: "Mã yêu cầu vào nhóm"}
	// Giai đoạn 2: tin theo mã toàn hệ thống, thiết bị, mã QR, tìm tin.
	msgPath    = rpc.GoField{Name: "message_id", In: "path", Type: "integer", Desc: "Mã tin nhắn (duy nhất toàn hệ thống)"}
	devicePath = rpc.GoField{Name: "device_id", In: "path", Type: "integer", Desc: "Mã thiết bị"}
	qrCode     = rpc.GoField{Name: "code", In: "body", Type: "string", Required: true,
		Desc: "Mã 10 ký tự (ABCDE-FGHJK; nhận chữ thường, gạch nối, khoảng trắng, O -> 0, I / L -> 1, hoặc cả URL <origin>/chat/qr#<code>)"}
	searchQ      = rpc.GoField{Name: "q", In: "query", Type: "string", Required: true, Desc: "Từ khoá 2..100 ký tự, không phân biệt dấu / hoa thường, mỗi từ khớp tiền tố"}
	searchCursor = rpc.GoField{Name: "cursor", In: "query", Type: "string", Desc: "next_cursor của trang trước"}
	searchLimit  = rpc.GoField{Name: "limit", In: "query", Type: "integer", Desc: "Mặc định 20, tối đa 50"}
)

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). otp/request, otp/verify, refresh công khai;
// auth/dezon rpc.Login (phiên Dezon Pro, middleware.RequireLogin); còn lại rpc.SelfAuth: module tự kiểm access token của chat
// (middleware QS không chặn).
func (s *Service) RegisterRPC(reg *rpc.Registry) {
	r := func(name, method, path string, perm rpc.Perm, sum string, f ...rpc.GoField) {
		reg.RegisterGoRoute(rpc.GoRoute{Name: name, Method: method, Path: "/chat" + path, Perm: perm, Tag: tag, Summary: sum, Fields: f})
	}
	r("chatOtpRequest", "POST", "/auth/otp/request", rpc.Public,
		"Gửi mã OTP 6 số qua SMS tới số điện thoại hoặc qua email (gửi một trong hai; 5 lần / giờ / số hoặc email, 20 lần / giờ / IP, gửi lại sau 60 giây)",
		rpc.GoField{Name: "phone", In: "body", Type: "string", Desc: "Số điện thoại (0901234567, +84901234567...); không gửi cùng email"},
		rpc.GoField{Name: "email", In: "body", Type: "string", Desc: "Email (ten@congty.vn), không phân biệt hoa thường; sai -> EMAIL_INVALID"})
	r("chatOtpVerify", "POST", "/auth/otp/verify", rpc.Public,
		"Xác thực OTP: tìm / tạo tài khoản theo số hoặc email, ghi thiết bị, cấp access token (15 phút) + refresh token (30 ngày)",
		rpc.GoField{Name: "phone", In: "body", Type: "string", Desc: "Số điện thoại đã xin mã (hoặc gửi email)"},
		rpc.GoField{Name: "email", In: "body", Type: "string", Desc: "Email đã xin mã (hoặc gửi phone)"},
		rpc.GoField{Name: "otp", In: "body", Type: "string", Required: true, Desc: "Mã 6 số"},
		rpc.GoField{Name: "device", In: "body", Type: "object", Desc: `{"platform":"web|ios|android|desktop","name":"Chrome Windows"}`},
		rpc.GoField{Name: "display_name", In: "body", Type: "string", Desc: "Tên hiển thị khi tạo tài khoản mới (trống = \"Người dùng <4 số cuối>\" / phần trước @ của email)"})
	r("chatDezonLogin", "POST", "/auth/dezon", rpc.Login,
		"Đăng nhập chat bằng phiên Dezon Pro (Authorization: Bearer <token Dezon Pro>, không cần OTP): tìm / tạo tài khoản chat gắn với tài khoản Dezon Pro, ghi thiết bị, cấp token như otp/verify. Nhân viên cần quyền chat (CHAT_NO_PERM); 30 lần / 10 phút",
		rpc.GoField{Name: "device", In: "body", Type: "object", Desc: `{"platform":"web|ios|android|desktop","name":"Chrome Windows"}`})
	r("chatRefresh", "POST", "/auth/refresh", rpc.Public,
		"Đổi refresh token lấy cặp token mới (token cũ hết dùng; dùng lại token cũ = thu hồi thiết bị)",
		rpc.GoField{Name: "refresh_token", In: "body", Type: "string", Required: true})
	r("chatLogout", "POST", "/auth/logout", rpc.SelfAuth, "Đăng xuất thiết bị hiện tại (xoá refresh token + push token, đóng WebSocket)")
	r("chatMe", "GET", "/me", rpc.SelfAuth, "Hồ sơ chat của tôi")
	r("chatUpdateMe", "PATCH", "/me", rpc.SelfAuth, "Đổi tên hiển thị / bật tắt cho người khác biết tôi đã xem",
		rpc.GoField{Name: "display_name", In: "body", Type: "string", Desc: "1..100 ký tự"},
		rpc.GoField{Name: "show_read_receipts", In: "body", Type: "boolean"})
	r("chatSearchUser", "GET", "/users/search", rpc.SelfAuth,
		"Tìm người dùng theo đúng số điện thoại hoặc đúng email (gửi một trong hai; tra số chỉ trả số, tra email chỉ trả email)",
		rpc.GoField{Name: "phone", In: "query", Type: "string", Desc: "Số điện thoại"},
		rpc.GoField{Name: "email", In: "query", Type: "string", Desc: "Email"})
	r("chatMatchContacts", "POST", "/contacts/match", rpc.SelfAuth, "Đồng bộ danh bạ: ai trong danh bạ đang dùng chat",
		rpc.GoField{Name: "phones", In: "body", Type: "array", Desc: "Số điện thoại (tối đa 1000)"},
		rpc.GoField{Name: "phone_hashes", In: "body", Type: "array", Desc: "sha256 hex của số E.164 (tối đa 1000)"})
	r("chatListFriends", "GET", "/friends", rpc.SelfAuth, "Bạn bè, sắp theo tên")
	r("chatUnfriend", "DELETE", "/friends/:user_id", rpc.SelfAuth, "Huỷ kết bạn", userPath)
	r("chatListFriendRequests", "GET", "/friend-requests", rpc.SelfAuth, "Lời mời kết bạn tới tôi (incoming) và tôi đã gửi (outgoing)")
	r("chatSendFriendRequest", "POST", "/friend-requests", rpc.SelfAuth,
		"Gửi lời mời kết bạn (30 lần / giờ); người kia đã mời tôi thì thành bạn luôn",
		rpc.GoField{Name: "user_id", In: "body", Type: "integer", Required: true})
	r("chatAcceptFriendRequest", "POST", "/friend-requests/:user_id/accept", rpc.SelfAuth, "Chấp nhận lời mời kết bạn", userPath)
	r("chatRejectFriendRequest", "POST", "/friend-requests/:user_id/reject", rpc.SelfAuth, "Từ chối lời mời kết bạn", userPath)
	r("chatCancelFriendRequest", "DELETE", "/friend-requests/:user_id", rpc.SelfAuth, "Rút lời mời kết bạn tôi đã gửi", userPath)
	r("chatListBlocks", "GET", "/blocks", rpc.SelfAuth, "Người tôi đã chặn")
	r("chatBlockUser", "POST", "/blocks", rpc.SelfAuth, "Chặn người dùng (không nhắn tin / mời kết bạn được nữa)",
		rpc.GoField{Name: "user_id", In: "body", Type: "integer", Required: true})
	r("chatUnblockUser", "DELETE", "/blocks/:user_id", rpc.SelfAuth, "Bỏ chặn", userPath)
	r("chatListConversations", "GET", "/conversations", rpc.SelfAuth,
		"Hội thoại đang tham gia, tin mới nhất trước, kèm số tin chưa đọc",
		rpc.GoField{Name: "cursor", In: "query", Type: "string", Desc: "next_cursor của trang trước"},
		rpc.GoField{Name: "limit", In: "query", Type: "integer", Desc: "Mặc định 50, tối đa 100"})
	r("chatCreateConversation", "POST", "/conversations", rpc.SelfAuth,
		"Tạo chat 1-1 (đã có thì trả hội thoại cũ) hoặc nhóm (thành viên là bạn bè của tôi)",
		rpc.GoField{Name: "type", In: "body", Type: "string", Required: true, Desc: "direct / group"},
		rpc.GoField{Name: "user_id", In: "body", Type: "integer", Desc: "direct: người nhắn cùng"},
		rpc.GoField{Name: "name", In: "body", Type: "string", Desc: "group: tên nhóm 1..100 ký tự"},
		rpc.GoField{Name: "member_ids", In: "body", Type: "array", Desc: "group: mã các thành viên khác"})
	r("chatGetConversation", "GET", "/conversations/:id", rpc.SelfAuth, "Chi tiết hội thoại + thành viên", convPath)
	r("chatRenameConversation", "PATCH", "/conversations/:id", rpc.SelfAuth,
		"Đổi tên / mô tả / ảnh nhóm (trưởng / phó nhóm; thành viên khi tắt admins_only_edit_info). Khoá vắng = giữ nguyên", convPath,
		rpc.GoField{Name: "name", In: "body", Type: "string", Desc: "1..100 ký tự"},
		rpc.GoField{Name: "description", In: "body", Type: "string", Desc: `Tối đa 500 ký tự; "" / null = xoá mô tả`},
		rpc.GoField{Name: "avatar_media_id", In: "body", Type: "integer", Desc: "Tệp ảnh ready của chính mình; null = xoá ảnh nhóm"})
	r("chatUpdateGroupSettings", "PATCH", "/conversations/:id/settings", rpc.SelfAuth,
		"Đổi cài đặt quyền của nhóm (trưởng / phó nhóm). Khoá vắng = giữ nguyên", convPath,
		rpc.GoField{Name: "admins_only_send", In: "body", Type: "boolean", Desc: "Chỉ trưởng / phó nhóm được gửi tin"},
		rpc.GoField{Name: "admins_only_edit_info", In: "body", Type: "boolean", Desc: "Chỉ trưởng / phó nhóm được đổi tên / ảnh / mô tả"},
		rpc.GoField{Name: "admins_only_add_members", In: "body", Type: "boolean", Desc: "Chỉ trưởng / phó nhóm được thêm thành viên / tạo link mời"})
	r("chatTransferOwnership", "POST", "/conversations/:id/owner", rpc.SelfAuth,
		"Chuyển quyền trưởng nhóm (chỉ trưởng nhóm); trưởng nhóm cũ thành phó nhóm", convPath,
		rpc.GoField{Name: "user_id", In: "body", Type: "integer", Required: true, Desc: "Thành viên đang hoạt động nhận quyền"})
	r("chatDisbandGroup", "POST", "/conversations/:id/disband", rpc.SelfAuth,
		"Giải tán nhóm (chỉ trưởng nhóm): tin cũ giữ lại chỉ đọc, mọi thao tác ghi sau đó -> 410 GROUP_DISBANDED", convPath)
	r("chatGetInviteLink", "GET", "/conversations/:id/invite-link", rpc.SelfAuth,
		"Link mời đang hiệu lực của nhóm (không có token); null khi chưa có hoặc nhóm đã giải tán", convPath)
	r("chatCreateInviteLink", "POST", "/conversations/:id/invite-link", rpc.SelfAuth,
		"Tạo (lại) link mời: thu hồi link cũ, trả token + url_path một lần duy nhất (30 lần / giờ)", convPath,
		rpc.GoField{Name: "requires_approval", In: "body", Type: "boolean", Desc: "Vào nhóm phải chờ trưởng / phó nhóm duyệt (mặc định false)"},
		rpc.GoField{Name: "expires_in", In: "body", Type: "integer", Desc: "Số giây 3600..2592000; null / vắng = không hết hạn"})
	r("chatRevokeInviteLink", "DELETE", "/conversations/:id/invite-link", rpc.SelfAuth,
		"Thu hồi link mời hiện hành (trưởng / phó nhóm; thành viên chỉ link do mình tạo); không có link -> {}", convPath)
	r("chatInvitePreview", "GET", "/invites/:token", rpc.SelfAuth,
		"Xem trước nhóm qua link mời: tên, mô tả, ảnh, số thành viên, trạng thái của tôi (60 lần / phút)", invitePath)
	r("chatJoinByInvite", "POST", "/invites/:token/join", rpc.SelfAuth,
		"Vào nhóm qua link mời: joined / pending (chờ duyệt) / already_member (20 lần / giờ)", invitePath)
	r("chatListJoinRequests", "GET", "/conversations/:id/join-requests", rpc.SelfAuth,
		"Yêu cầu vào nhóm đang chờ duyệt, cũ trước, tối đa 500 (trưởng / phó nhóm)", convPath)
	r("chatApproveJoinRequest", "POST", "/conversations/:id/join-requests/:request_id/approve", rpc.SelfAuth,
		"Duyệt yêu cầu vào nhóm (trưởng / phó nhóm)", convPath, requestPath)
	r("chatRejectJoinRequest", "POST", "/conversations/:id/join-requests/:request_id/reject", rpc.SelfAuth,
		"Từ chối yêu cầu vào nhóm (trưởng / phó nhóm; người xin không được báo)", convPath, requestPath)
	r("chatAddMembers", "POST", "/conversations/:id/members", rpc.SelfAuth, "Thêm bạn bè vào nhóm (tối đa 1000 thành viên)", convPath,
		rpc.GoField{Name: "user_ids", In: "body", Type: "array", Required: true})
	r("chatRemoveMember", "DELETE", "/conversations/:id/members/:user_id", rpc.SelfAuth,
		"Rời nhóm (user_id = tôi) hoặc xoá thành viên (trưởng nhóm: mọi người; phó nhóm: thành viên thường)", convPath, userPath)
	r("chatSetMemberRole", "PATCH", "/conversations/:id/members/:user_id", rpc.SelfAuth, "Đặt / bỏ phó nhóm (chỉ trưởng nhóm)",
		convPath, userPath, rpc.GoField{Name: "role", In: "body", Type: "string", Required: true, Desc: "admin / member"})
	r("chatMuteConversation", "PUT", "/conversations/:id/mute", rpc.SelfAuth, "Tắt / bật thông báo của hội thoại", convPath,
		rpc.GoField{Name: "until", In: "body", Type: "string", Desc: `Thời điểm RFC3339, "forever" hoặc null (bật lại)`})
	r("chatListMessages", "GET", "/conversations/:id/messages", rpc.SelfAuth, "Lịch sử tin nhắn (tăng dần theo seq)", convPath,
		rpc.GoField{Name: "before_seq", In: "query", Type: "integer", Desc: "Các tin ngay trước seq này (cuộn lên)"},
		rpc.GoField{Name: "after_seq", In: "query", Type: "integer", Desc: "Các tin sau seq này (đồng bộ)"},
		rpc.GoField{Name: "around_seq", In: "query", Type: "integer", Desc: "Các tin quanh seq này (nhảy tới tin; trả thêm has_newer). Không dùng cùng before_seq / after_seq"},
		rpc.GoField{Name: "limit", In: "query", Type: "integer", Desc: "Mặc định 50, tối đa 100"})
	r("chatMessageChanges", "GET", "/conversations/:id/messages/changes", rpc.SelfAuth,
		"Tin đã sửa / thu hồi / đổi reaction sau mốc (cũ trước theo updated_at); gọi sau mỗi /sync cho hội thoại đang giữ tin", convPath,
		rpc.GoField{Name: "since", In: "query", Type: "string", Desc: "sync_cursor (mili giây) của lần /sync trước"},
		rpc.GoField{Name: "cursor", In: "query", Type: "string", Desc: "next_cursor của trang trước (thắng since)"},
		rpc.GoField{Name: "limit", In: "query", Type: "integer", Desc: "Mặc định 100, tối đa 200"})
	r("chatSearchConversationMessages", "GET", "/conversations/:id/messages/search", rpc.SelfAuth,
		"Tìm tin trong một hội thoại (không dấu, mới trước, 30 lần / phút)", convPath, searchQ, searchCursor, searchLimit)
	r("chatSearchMessages", "GET", "/search/messages", rpc.SelfAuth,
		"Tìm tin trong mọi hội thoại tôi xem được (không dấu, mới trước, 30 lần / phút)", searchQ, searchCursor, searchLimit)
	r("chatEditMessage", "PATCH", "/messages/:message_id", rpc.SelfAuth,
		"Sửa tin văn bản của mình (trong 24 giờ; kiểm lại mentions; không push)", msgPath,
		rpc.GoField{Name: "content", In: "body", Type: "string", Required: true, Desc: "1..4000 ký tự"},
		rpc.GoField{Name: "mentions", In: "body", Type: "array", Desc: "Như message.send (chỉ nhóm), offset trên content mới"})
	r("chatRecallMessage", "POST", "/messages/:message_id/recall", rpc.SelfAuth,
		"Thu hồi tin (của mình trong 24 giờ; trưởng / phó nhóm thu hồi tin người khác trong nhóm): xoá hẳn nội dung, reaction, ghim", msgPath)
	r("chatForwardMessage", "POST", "/messages/:message_id/forward", rpc.SelfAuth,
		"Chuyển tiếp tin tới 1..20 hội thoại (mỗi đích một tin mới, dùng lại tệp; kết quả theo từng đích)", msgPath,
		rpc.GoField{Name: "targets", In: "body", Type: "array", Required: true, Desc: `[{"conversation_id":1,"client_msg_id":"<uuid>"}]`})
	r("chatSetReaction", "PUT", "/messages/:message_id/reaction", rpc.SelfAuth,
		"Thả / đổi cảm xúc của tôi cho tin (1 cảm xúc / người / tin; 60 lần / phút)", msgPath,
		rpc.GoField{Name: "reaction", In: "body", Type: "string", Required: true, Desc: "like / love / haha / wow / sad / angry"})
	r("chatRemoveReaction", "DELETE", "/messages/:message_id/reaction", rpc.SelfAuth, "Bỏ cảm xúc của tôi khỏi tin", msgPath)
	r("chatListReactions", "GET", "/messages/:message_id/reactions", rpc.SelfAuth, "Ai đã thả cảm xúc cho tin (mới trước)", msgPath)
	r("chatListPins", "GET", "/conversations/:id/pins", rpc.SelfAuth, "Tin đang ghim của hội thoại (mới ghim trước, tối đa 5)", convPath)
	r("chatPinMessage", "POST", "/conversations/:id/pins", rpc.SelfAuth,
		"Ghim tin (nhóm: trưởng / phó nhóm; chat 1-1: cả hai bên; tối đa 5; không ghim tin hệ thống)", convPath,
		rpc.GoField{Name: "message_id", In: "body", Type: "integer", Required: true})
	r("chatUnpinMessage", "DELETE", "/conversations/:id/pins/:message_id", rpc.SelfAuth, "Bỏ ghim tin", convPath,
		rpc.GoField{Name: "message_id", In: "path", Type: "integer", Desc: "Mã tin nhắn"})
	r("chatSync", "GET", "/sync", rpc.SelfAuth, "Hội thoại thay đổi từ lần đồng bộ trước (kể cả bị xoá khỏi nhóm: left = true)",
		rpc.GoField{Name: "cursor", In: "query", Type: "string", Required: true, Desc: "sync_cursor (mili giây) của lần trước"})
	r("chatPushConfig", "GET", "/push/config", rpc.SelfAuth, "Push có bật không + khoá công khai VAPID")
	r("chatSetPushToken", "POST", "/devices/push", rpc.SelfAuth, "Đăng ký Web Push cho thiết bị hiện tại",
		rpc.GoField{Name: "push_kind", In: "body", Type: "string", Required: true, Desc: "webpush"},
		rpc.GoField{Name: "push_token", In: "body", Type: "string", Required: true, Desc: "JSON.stringify(PushSubscription)"})
	r("chatClearPushToken", "DELETE", "/devices/push", rpc.SelfAuth, "Thiết bị hiện tại thôi nhận push")
	r("chatListDevices", "GET", "/devices", rpc.SelfAuth, "Thiết bị đang đăng nhập của tôi (thiết bị hiện tại trước)")
	r("chatRevokeDevice", "DELETE", "/devices/:device_id", rpc.SelfAuth,
		"Đăng xuất từ xa một thiết bị khác của tôi (force_logout + đóng WebSocket của thiết bị đó)", devicePath)
	r("chatRevokeOtherDevices", "POST", "/devices/logout-others", rpc.SelfAuth, "Đăng xuất mọi thiết bị khác của tôi")
	r("chatQrStart", "POST", "/auth/qr/start", rpc.Public,
		"Máy mới xin mã QR đăng nhập (sống 2 phút; 20 phiên / 10 phút / IP)",
		rpc.GoField{Name: "device", In: "body", Type: "object", Desc: `{"platform":"web|ios|android|desktop","name":"Chrome Windows"}`})
	r("chatQrPoll", "POST", "/auth/qr/poll", rpc.Public,
		"Máy mới hỏi trạng thái phiên QR (mỗi 2 giây); approved -> auth (một lần duy nhất)",
		rpc.GoField{Name: "qr_id", In: "body", Type: "integer", Required: true},
		rpc.GoField{Name: "poll_token", In: "body", Type: "string", Required: true, Desc: "poll_token của qr/start (không nằm trong QR)"})
	r("chatQrScan", "POST", "/auth/qr/scan", rpc.SelfAuth,
		"Máy đã đăng nhập quét mã QR: xem thông tin máy đang chờ (20 lần / phút)", qrCode)
	r("chatQrApprove", "POST", "/auth/qr/approve", rpc.SelfAuth, "Xác nhận đăng nhập máy mới (chỉ người đã quét)", qrCode)
	r("chatQrReject", "POST", "/auth/qr/reject", rpc.SelfAuth, "Từ chối đăng nhập máy mới (chỉ người đã quét)", qrCode)
	r("chatMediaConfig", "GET", "/media/config", rpc.SelfAuth,
		"Gửi tệp có bật không + giới hạn (kích thước theo loại, MIME, đuôi tệp bị chặn); client không tự đặt giới hạn")
	r("chatMediaUploadURL", "POST", "/media/upload-url", rpc.SelfAuth,
		"Xin presigned PUT (15 phút) để tải tệp thẳng lên kho S3; cùng nội dung đã ready -> dedup = true, không cần tải (60 lần / phút)",
		rpc.GoField{Name: "type", In: "body", Type: "string", Required: true, Desc: "image / video / file / voice"},
		rpc.GoField{Name: "mime", In: "body", Type: "string", Required: true, Desc: "MIME của tệp (ảnh: jpeg / png / webp / gif; file: trống = application/octet-stream)"},
		rpc.GoField{Name: "size", In: "body", Type: "integer", Required: true, Desc: "Số byte (ký vào URL, phải đúng khi PUT)"},
		rpc.GoField{Name: "sha256", In: "body", Type: "string", Required: true, Desc: "SHA-256 hex chữ thường của nội dung (server tính lại khi complete)"},
		rpc.GoField{Name: "file_name", In: "body", Type: "string", Desc: "Bắt buộc với file; .exe .msi .bat .cmd .com .scr .ps1 .vbs .js .jar bị chặn"},
		rpc.GoField{Name: "width", In: "body", Type: "integer", Desc: "Video: gợi ý chiều rộng"},
		rpc.GoField{Name: "height", In: "body", Type: "integer", Desc: "Video: gợi ý chiều cao"},
		rpc.GoField{Name: "duration_ms", In: "body", Type: "integer", Desc: "Bắt buộc với voice (1..600000); video: tuỳ chọn"},
		rpc.GoField{Name: "waveform", In: "body", Type: "array", Desc: "Bắt buộc với voice: 1..128 số 0..255"},
		rpc.GoField{Name: "poster", In: "body", Type: "object", Desc: `Video: ảnh bìa {"mime":"image/jpeg|image/webp","size":...} (<= 512 KB, cạnh dài <= 640 px)`})
	r("chatMediaComplete", "POST", "/media/:id/complete", rpc.SelfAuth,
		"Báo đã PUT xong: server chép sang khoá cuối, kiểm kích thước / loại / sha256 / virus, làm ảnh nhỏ; trả media (ready)", mediaPath)
	r("chatMediaGet", "GET", "/media/:id", rpc.SelfAuth,
		"URL đọc tệp (presigned GET, mặc định 60 phút) cho người tải hoặc thành viên hội thoại có tin dùng tệp", mediaPath,
		rpc.GoField{Name: "download", In: "query", Type: "integer", Desc: "1 = tải về (attachment)"},
		rpc.GoField{Name: "message_id", In: "query", Type: "integer", Desc: "Tin dùng tệp: lấy tên tải về của tin đó"})
	r("chatWebSocket", "GET", "/ws", rpc.SelfAuth,
		"WebSocket thời gian thực: gói đầu tiên phải là {\"type\":\"auth\",\"data\":{\"access_token\",\"device_id\"}} (CHAT.md mục 5)")
}

// fail: lỗi nghiệp vụ -> {"error","code"} đúng mã; lỗi khác (database...) ghi log, trả 500 INTERNAL không lộ chi tiết.
func fail(c *gin.Context, err error) {
	var ae *apperr.AppError
	if errors.As(err, &ae) {
		response.Fail(c, ae.Status, ae.Msg, ae.Code)
		return
	}
	logger.Error("chat", c.Request.Method+" "+c.FullPath()+" lỗi:", err.Error())
	response.Fail(c, 500, "Lỗi máy chủ", CodeInternal)
}

func reply(c *gin.Context, r any, err error) {
	if err != nil {
		fail(c, err)
		return
	}
	response.OK(c, r)
}

// empty: kết quả {} của thao tác không trả dữ liệu.
type empty struct{}

func done(c *gin.Context, err error) { reply(c, empty{}, err) }

// bindJSON đọc thân JSON object vào dst; thân trống = {}; hỏng / sai kiểu -> BAD_REQUEST.
func bindJSON(c *gin.Context, dst any) error {
	if c.Request.Body == nil {
		return nil
	}
	b, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20+1))
	if err != nil || len(b) > 1<<20 {
		return errBadBody
	}
	b = bytes.TrimSpace(b)
	if len(b) == 0 {
		return nil
	}
	if b[0] != '{' {
		return errBadBody
	}
	if err := decodeData(b, dst); err != nil {
		return err
	}
	return nil
}

func pathID(c *gin.Context, name string) (int64, error) {
	v, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil || v <= 0 {
		return 0, errBad("Mã không hợp lệ: " + name)
	}
	return v, nil
}

// queryInt: tham số số nguyên tuỳ chọn (nil = không gửi).
func queryInt(c *gin.Context, name string) (*int64, error) {
	s := strings.TrimSpace(c.Query(name))
	if s == "" {
		return nil, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v < 0 {
		return nil, errBad(name + " phải là số nguyên không âm")
	}
	return &v, nil
}

func queryLimit(c *gin.Context) (int, error) {
	v, err := queryInt(c, "limit")
	if err != nil || v == nil {
		return 0, err
	}
	return int(min(*v, 1000)), nil
}

// requireChat: access token chat hợp lệ, thiết bị còn -> gắn uid / did; sai -> 401 CHAT_NOAUTH.
func (s *Service) requireChat() gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, did, err := s.authToken(c.Request.Context(), middleware.BearerToken(c.Request))
		if err != nil {
			fail(c, err)
			c.Abort()
			return
		}
		c.Set(ctxUID, uid)
		c.Set(ctxDID, did)
	}
}

func uidOf(c *gin.Context) int64 { return c.GetInt64(ctxUID) }
func didOf(c *gin.Context) int64 { return c.GetInt64(ctxDID) }

// noStore: dữ liệu chat là riêng tư (có cả token) -> trình duyệt / proxy không được lưu.
func noStore(c *gin.Context) { c.Header("Cache-Control", "no-store") }

// RegisterRoutes: REST /api/v1/chat, khớp từng GoRoute ở trên.
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/chat", noStore)

	g.POST("/auth/otp/request", func(c *gin.Context) {
		var in OTPRequestInput
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		r, err := s.RequestOTP(c.Request.Context(), in, c.ClientIP())
		reply(c, r, err)
	})
	g.POST("/auth/otp/verify", func(c *gin.Context) {
		var in VerifyInput
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		in.ClientIP = c.ClientIP()
		in.UserAgent = c.Request.UserAgent()
		r, err := s.VerifyOTP(c.Request.Context(), in)
		reply(c, r, err)
	})
	// Phiên Dezon Pro -> phiên chat: v1 đã có middleware.Auth + Tenant, RequireLogin chặn khi chưa đăng nhập Dezon Pro.
	g.POST("/auth/dezon", middleware.RequireLogin(), func(c *gin.Context) {
		var in DezonInput
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		in.ClientIP = c.ClientIP()
		in.UserAgent = c.Request.UserAgent()
		r, err := s.DezonLogin(c.Request.Context(), actor.FromGin(c), in)
		reply(c, r, err)
	})
	g.POST("/auth/refresh", func(c *gin.Context) {
		var in refreshBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		r, err := s.RefreshFrom(c.Request.Context(), in.RefreshToken, c.ClientIP())
		reply(c, r, err)
	})
	// Đăng nhập bằng QR - phía máy mới (chưa có phiên): start + poll công khai, poll_token chỉ máy mới giữ.
	g.POST("/auth/qr/start", func(c *gin.Context) {
		var in QRStartInput
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		r, err := s.QRStart(c.Request.Context(), in, c.ClientIP(), c.Request.UserAgent())
		reply(c, r, err)
	})
	g.POST("/auth/qr/poll", func(c *gin.Context) {
		var in QRPollInput
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		// Thiếu hẳn tham số = request hỏng (400); có mà sai mới là 404 QR_INVALID.
		if in.QRID <= 0 || strings.TrimSpace(in.PollToken) == "" {
			fail(c, errBad("Thiếu qr_id hoặc poll_token"))
			return
		}
		r, err := s.QRPoll(c.Request.Context(), in)
		reply(c, r, err)
	})
	g.GET("/ws", func(c *gin.Context) {
		gw := s.gateway()
		if gw == nil {
			response.Fail(c, 503, "Chat thời gian thực chưa bật", CodeUnavailable)
			return
		}
		gw.ServeHTTP(c.Writer, c.Request)
		c.Abort()
	})

	a := g.Group("", s.requireChat())
	a.POST("/auth/logout", func(c *gin.Context) { done(c, s.Logout(c.Request.Context(), uidOf(c), didOf(c))) })
	a.GET("/me", func(c *gin.Context) {
		r, err := s.Me(c.Request.Context(), uidOf(c))
		reply(c, r, err)
	})
	a.PATCH("/me", func(c *gin.Context) {
		var in MePatch
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		r, err := s.UpdateMe(c.Request.Context(), uidOf(c), in)
		reply(c, r, err)
	})
	a.GET("/users/search", func(c *gin.Context) {
		u, err := s.SearchUser(c.Request.Context(), uidOf(c), c.Query("phone"), c.Query("email"))
		reply(c, struct {
			User *UserDTO `json:"user"`
		}{u}, err)
	})
	a.POST("/contacts/match", func(c *gin.Context) {
		var in matchBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		us, err := s.MatchContacts(c.Request.Context(), uidOf(c), in.Phones, in.PhoneHashes)
		reply(c, struct {
			Users []MatchedUserDTO `json:"users"`
		}{us}, err)
	})
	a.GET("/friends", func(c *gin.Context) {
		us, err := s.Friends(c.Request.Context(), uidOf(c))
		reply(c, struct {
			Friends []UserDTO `json:"friends"`
		}{us}, err)
	})
	// withUser: handler có :user_id
	withUser := func(fn func(c *gin.Context, other int64) error) gin.HandlerFunc {
		return func(c *gin.Context) {
			other, err := pathID(c, "user_id")
			if err == nil {
				err = fn(c, other)
			}
			done(c, err)
		}
	}
	a.DELETE("/friends/:user_id", withUser(func(c *gin.Context, other int64) error {
		return s.Unfriend(c.Request.Context(), uidOf(c), other)
	}))
	a.GET("/friend-requests", func(c *gin.Context) {
		in, out, err := s.FriendRequests(c.Request.Context(), uidOf(c))
		reply(c, struct {
			Incoming []RequestUserDTO `json:"incoming"`
			Outgoing []RequestUserDTO `json:"outgoing"`
		}{in, out}, err)
	})
	a.POST("/friend-requests", func(c *gin.Context) {
		var in userIDBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		st, err := s.SendFriendRequest(c.Request.Context(), uidOf(c), in.UserID)
		reply(c, struct {
			Status string `json:"status"`
		}{st}, err)
	})
	a.POST("/friend-requests/:user_id/accept", func(c *gin.Context) {
		other, err := pathID(c, "user_id")
		if err == nil {
			err = s.AcceptFriendRequest(c.Request.Context(), uidOf(c), other)
		}
		reply(c, struct {
			Status string `json:"status"`
		}{"accepted"}, err)
	})
	a.POST("/friend-requests/:user_id/reject", withUser(func(c *gin.Context, other int64) error {
		return s.RejectFriendRequest(c.Request.Context(), uidOf(c), other)
	}))
	a.DELETE("/friend-requests/:user_id", withUser(func(c *gin.Context, other int64) error {
		return s.CancelFriendRequest(c.Request.Context(), uidOf(c), other)
	}))
	a.GET("/blocks", func(c *gin.Context) {
		us, err := s.Blocks(c.Request.Context(), uidOf(c))
		reply(c, struct {
			Users []UserDTO `json:"users"`
		}{us}, err)
	})
	a.POST("/blocks", func(c *gin.Context) {
		var in userIDBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		done(c, s.Block(c.Request.Context(), uidOf(c), in.UserID))
	})
	a.DELETE("/blocks/:user_id", withUser(func(c *gin.Context, other int64) error {
		return s.Unblock(c.Request.Context(), uidOf(c), other)
	}))

	a.GET("/conversations", func(c *gin.Context) {
		limit, err := queryLimit(c)
		if err != nil {
			fail(c, err)
			return
		}
		r, err := s.ListConversations(c.Request.Context(), uidOf(c), c.Query("cursor"), limit)
		reply(c, r, err)
	})
	a.POST("/conversations", func(c *gin.Context) {
		var in createConvBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		switch in.Type {
		case "direct":
			r, err := s.CreateDirect(c.Request.Context(), uidOf(c), in.UserID)
			reply(c, r, err)
		case "group":
			r, err := s.CreateGroup(c.Request.Context(), uidOf(c), in.Name, in.MemberIDs)
			reply(c, r, err)
		default:
			fail(c, errBad("type phải là direct hoặc group"))
		}
	})
	// withConv: handler có :id (hội thoại)
	withConv := func(fn func(c *gin.Context, conv int64) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			conv, err := pathID(c, "id")
			if err != nil {
				fail(c, err)
				return
			}
			r, err := fn(c, conv)
			reply(c, r, err)
		}
	}
	a.GET("/conversations/:id", withConv(func(c *gin.Context, conv int64) (any, error) {
		return s.Conversation(c.Request.Context(), uidOf(c), conv)
	}))
	a.PATCH("/conversations/:id", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in GroupInfoPatch
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.UpdateGroupInfo(c.Request.Context(), uidOf(c), conv, in)
	}))
	a.PATCH("/conversations/:id/settings", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in GroupSettingsPatch
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.UpdateGroupSettings(c.Request.Context(), uidOf(c), conv, in)
	}))
	a.POST("/conversations/:id/owner", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in transferOwnerBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.TransferOwnership(c.Request.Context(), uidOf(c), conv, in.UserID)
	}))
	a.POST("/conversations/:id/disband", withConv(func(c *gin.Context, conv int64) (any, error) {
		return empty{}, s.DisbandGroup(c.Request.Context(), uidOf(c), conv)
	}))
	a.GET("/conversations/:id/invite-link", withConv(func(c *gin.Context, conv int64) (any, error) {
		return s.GetInviteLink(c.Request.Context(), uidOf(c), conv)
	}))
	a.POST("/conversations/:id/invite-link", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in InviteCreateInput
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.CreateInviteLink(c.Request.Context(), uidOf(c), conv, in)
	}))
	a.DELETE("/conversations/:id/invite-link", withConv(func(c *gin.Context, conv int64) (any, error) {
		return empty{}, s.RevokeInviteLink(c.Request.Context(), uidOf(c), conv)
	}))
	a.GET("/conversations/:id/join-requests", withConv(func(c *gin.Context, conv int64) (any, error) {
		return s.ListJoinRequests(c.Request.Context(), uidOf(c), conv)
	}))
	a.POST("/conversations/:id/join-requests/:request_id/approve", withConv(func(c *gin.Context, conv int64) (any, error) {
		rid, err := pathID(c, "request_id")
		if err != nil {
			return nil, err
		}
		return s.ApproveJoinRequest(c.Request.Context(), uidOf(c), conv, rid)
	}))
	a.POST("/conversations/:id/join-requests/:request_id/reject", withConv(func(c *gin.Context, conv int64) (any, error) {
		rid, err := pathID(c, "request_id")
		if err != nil {
			return nil, err
		}
		return s.RejectJoinRequest(c.Request.Context(), uidOf(c), conv, rid)
	}))
	// Token kiểm định dạng trong service (sai -> 404 INVITE_INVALID, không đọc DB). join: thân rỗng.
	a.GET("/invites/:token", func(c *gin.Context) {
		r, err := s.InvitePreview(c.Request.Context(), uidOf(c), c.Param("token"))
		reply(c, r, err)
	})
	a.POST("/invites/:token/join", func(c *gin.Context) {
		r, err := s.JoinByInvite(c.Request.Context(), uidOf(c), c.Param("token"))
		reply(c, r, err)
	})
	a.POST("/conversations/:id/members", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in addMembersBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.AddMembers(c.Request.Context(), uidOf(c), conv, in.UserIDs)
	}))
	a.DELETE("/conversations/:id/members/:user_id", withConv(func(c *gin.Context, conv int64) (any, error) {
		target, err := pathID(c, "user_id")
		if err != nil {
			return nil, err
		}
		return empty{}, s.RemoveMember(c.Request.Context(), uidOf(c), conv, target)
	}))
	a.PATCH("/conversations/:id/members/:user_id", withConv(func(c *gin.Context, conv int64) (any, error) {
		target, err := pathID(c, "user_id")
		if err != nil {
			return nil, err
		}
		var in roleBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.SetMemberRole(c.Request.Context(), uidOf(c), conv, target, in.Role)
	}))
	a.PUT("/conversations/:id/mute", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in muteBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.Mute(c.Request.Context(), uidOf(c), conv, in.Until)
	}))
	a.GET("/conversations/:id/messages", withConv(func(c *gin.Context, conv int64) (any, error) {
		before, err := queryInt(c, "before_seq")
		if err != nil {
			return nil, err
		}
		after, err := queryInt(c, "after_seq")
		if err != nil {
			return nil, err
		}
		around, err := queryInt(c, "around_seq")
		if err != nil {
			return nil, err
		}
		limit, err := queryLimit(c)
		if err != nil {
			return nil, err
		}
		if around != nil {
			if before != nil || after != nil {
				return nil, errBad("Chỉ dùng một trong before_seq / after_seq / around_seq")
			}
			return s.MessagesAround(c.Request.Context(), uidOf(c), conv, *around, limit)
		}
		return s.Messages(c.Request.Context(), uidOf(c), conv, before, after, limit)
	}))
	a.GET("/conversations/:id/messages/changes", withConv(func(c *gin.Context, conv int64) (any, error) {
		limit, err := queryLimit(c)
		if err != nil {
			return nil, err
		}
		return s.MessageChanges(c.Request.Context(), uidOf(c), conv, c.Query("since"), c.Query("cursor"), limit)
	}))
	// search: q / cursor / limit của hai route tìm tin (conv = 0: mọi hội thoại).
	search := func(c *gin.Context, conv int64) (any, error) {
		limit, err := queryLimit(c)
		if err != nil {
			return nil, err
		}
		return s.SearchMessages(c.Request.Context(), uidOf(c), SearchInput{ConversationID: conv, Query: c.Query("q"),
			Cursor: c.Query("cursor"), Limit: limit})
	}
	a.GET("/conversations/:id/messages/search", withConv(search))
	a.GET("/search/messages", func(c *gin.Context) {
		r, err := search(c, 0)
		reply(c, r, err)
	})
	// withMsg: handler có :message_id (mã tin toàn hệ thống).
	withMsg := func(fn func(c *gin.Context, mid int64) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			mid, err := pathID(c, "message_id")
			if err != nil {
				fail(c, err)
				return
			}
			r, err := fn(c, mid)
			reply(c, r, err)
		}
	}
	a.PATCH("/messages/:message_id", withMsg(func(c *gin.Context, mid int64) (any, error) {
		var in EditInput
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.EditMessage(c.Request.Context(), uidOf(c), mid, in)
	}))
	a.POST("/messages/:message_id/recall", withMsg(func(c *gin.Context, mid int64) (any, error) {
		return s.RecallMessage(c.Request.Context(), uidOf(c), mid)
	}))
	a.POST("/messages/:message_id/forward", withMsg(func(c *gin.Context, mid int64) (any, error) {
		var in ForwardInput
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.ForwardMessage(c.Request.Context(), uidOf(c), mid, in)
	}))
	a.PUT("/messages/:message_id/reaction", withMsg(func(c *gin.Context, mid int64) (any, error) {
		var in reactionBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.SetReaction(c.Request.Context(), uidOf(c), mid, in.Reaction)
	}))
	a.DELETE("/messages/:message_id/reaction", withMsg(func(c *gin.Context, mid int64) (any, error) {
		return s.RemoveReaction(c.Request.Context(), uidOf(c), mid)
	}))
	a.GET("/messages/:message_id/reactions", withMsg(func(c *gin.Context, mid int64) (any, error) {
		return s.Reactions(c.Request.Context(), uidOf(c), mid)
	}))
	a.GET("/conversations/:id/pins", withConv(func(c *gin.Context, conv int64) (any, error) {
		return s.Pins(c.Request.Context(), uidOf(c), conv)
	}))
	a.POST("/conversations/:id/pins", withConv(func(c *gin.Context, conv int64) (any, error) {
		var in pinBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.PinMessage(c.Request.Context(), uidOf(c), conv, in.MessageID)
	}))
	a.DELETE("/conversations/:id/pins/:message_id", withConv(func(c *gin.Context, conv int64) (any, error) {
		mid, err := pathID(c, "message_id")
		if err != nil {
			return nil, err
		}
		return s.UnpinMessage(c.Request.Context(), uidOf(c), conv, mid)
	}))
	a.GET("/sync", func(c *gin.Context) {
		r, err := s.Sync(c.Request.Context(), uidOf(c), c.Query("cursor"))
		reply(c, r, err)
	})
	a.GET("/push/config", func(c *gin.Context) { response.OK(c, s.PushConfig()) })
	a.POST("/devices/push", func(c *gin.Context) {
		var in pushBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		done(c, s.SetPushToken(c.Request.Context(), uidOf(c), didOf(c), in.PushKind, in.PushToken))
	})
	a.DELETE("/devices/push", func(c *gin.Context) {
		done(c, s.ClearPushToken(c.Request.Context(), uidOf(c), didOf(c)))
	})
	a.GET("/devices", func(c *gin.Context) {
		r, err := s.Devices(c.Request.Context(), uidOf(c), didOf(c))
		reply(c, r, err)
	})
	a.DELETE("/devices/:device_id", func(c *gin.Context) {
		target, err := pathID(c, "device_id")
		if err == nil {
			err = s.RevokeDevice(c.Request.Context(), uidOf(c), didOf(c), target)
		}
		done(c, err)
	})
	a.POST("/devices/logout-others", func(c *gin.Context) {
		r, err := s.RevokeOtherDevices(c.Request.Context(), uidOf(c), didOf(c))
		reply(c, r, err)
	})
	// Đăng nhập bằng QR - phía máy đã đăng nhập: quét, rồi duyệt / từ chối (chỉ người đã quét).
	withQR := func(fn func(ctx context.Context, uid, did int64, code string) (any, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			var in QRCodeInput
			if err := bindJSON(c, &in); err != nil {
				fail(c, err)
				return
			}
			r, err := fn(c.Request.Context(), uidOf(c), didOf(c), in.Code)
			reply(c, r, err)
		}
	}
	a.POST("/auth/qr/scan", withQR(func(ctx context.Context, uid, did int64, code string) (any, error) {
		return s.QRScan(ctx, uid, did, code)
	}))
	a.POST("/auth/qr/approve", withQR(func(ctx context.Context, uid, did int64, code string) (any, error) {
		return s.QRApprove(ctx, uid, did, code)
	}))
	a.POST("/auth/qr/reject", withQR(func(ctx context.Context, uid, did int64, code string) (any, error) {
		return s.QRReject(ctx, uid, did, code)
	}))

	a.GET("/media/config", func(c *gin.Context) {
		r, err := s.MediaConfig(c.Request.Context(), uidOf(c))
		reply(c, r, err)
	})
	a.POST("/media/upload-url", func(c *gin.Context) {
		var in MediaUploadInput
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		r, err := s.MediaUploadURL(c.Request.Context(), uidOf(c), in)
		reply(c, r, err)
	})
	a.POST("/media/:id/complete", func(c *gin.Context) {
		id, err := pathID(c, "id")
		if err != nil {
			fail(c, err)
			return
		}
		md, err := s.MediaComplete(c.Request.Context(), uidOf(c), id)
		reply(c, struct {
			Media *MediaDTO `json:"media"`
		}{md}, err)
	})
	a.GET("/media/:id", func(c *gin.Context) {
		id, err := pathID(c, "id")
		if err != nil {
			fail(c, err)
			return
		}
		dl := strings.TrimSpace(c.Query("download"))
		if dl != "" && dl != "0" && dl != "1" {
			fail(c, errBad("download phải là 0 hoặc 1"))
			return
		}
		msg, err := queryInt(c, "message_id")
		if err != nil {
			fail(c, err)
			return
		}
		var mid int64
		if msg != nil {
			mid = *msg
		}
		md, err := s.MediaGet(c.Request.Context(), uidOf(c), id, dl == "1", mid)
		reply(c, struct {
			Media *MediaDTO `json:"media"`
		}{md}, err)
	})
}
