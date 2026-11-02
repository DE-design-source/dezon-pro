package chat

import (
	"bytes"
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/server/rpc"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/response"
)

const tag = "Chat"

const (
	ctxUID = "chat.uid"
	ctxDID = "chat.did"
)

var (
	userPath = rpc.GoField{Name: "user_id", In: "path", Type: "integer", Desc: "Mã người dùng chat"}
	convPath = rpc.GoField{Name: "id", In: "path", Type: "integer", Desc: "Mã hội thoại (conversation_id)"}
)

// RegisterRPC: chỉ khai route REST "chỉ bản Go" (không có hàm /api/:fn). otp/request, otp/verify, refresh công khai;
// còn lại rpc.SelfAuth: module tự kiểm access token của chat (middleware QS không chặn).
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
	r("chatRenameConversation", "PATCH", "/conversations/:id", rpc.SelfAuth, "Đổi tên nhóm (trưởng / phó nhóm)", convPath,
		rpc.GoField{Name: "name", In: "body", Type: "string", Required: true})
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
		rpc.GoField{Name: "limit", In: "query", Type: "integer", Desc: "Mặc định 50, tối đa 100"})
	r("chatSync", "GET", "/sync", rpc.SelfAuth, "Hội thoại thay đổi từ lần đồng bộ trước (kể cả bị xoá khỏi nhóm: left = true)",
		rpc.GoField{Name: "cursor", In: "query", Type: "string", Required: true, Desc: "sync_cursor (mili giây) của lần trước"})
	r("chatPushConfig", "GET", "/push/config", rpc.SelfAuth, "Push có bật không + khoá công khai VAPID")
	r("chatSetPushToken", "POST", "/devices/push", rpc.SelfAuth, "Đăng ký Web Push cho thiết bị hiện tại",
		rpc.GoField{Name: "push_kind", In: "body", Type: "string", Required: true, Desc: "webpush"},
		rpc.GoField{Name: "push_token", In: "body", Type: "string", Required: true, Desc: "JSON.stringify(PushSubscription)"})
	r("chatClearPushToken", "DELETE", "/devices/push", rpc.SelfAuth, "Thiết bị hiện tại thôi nhận push")
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
		r, err := s.VerifyOTP(c.Request.Context(), in)
		reply(c, r, err)
	})
	g.POST("/auth/refresh", func(c *gin.Context) {
		var in refreshBody
		if err := bindJSON(c, &in); err != nil {
			fail(c, err)
			return
		}
		r, err := s.Refresh(c.Request.Context(), in.RefreshToken)
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
		var in renameBody
		if err := bindJSON(c, &in); err != nil {
			return nil, err
		}
		return s.RenameGroup(c.Request.Context(), uidOf(c), conv, in.Name)
	}))
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
		limit, err := queryLimit(c)
		if err != nil {
			return nil, err
		}
		return s.Messages(c.Request.Context(), uidOf(c), conv, before, after, limit)
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
}
