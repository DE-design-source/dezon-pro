package chat

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"qspro-backend/internal/modules/chat/realtime"
	"qspro-backend/internal/platform/logger"
	apperr "qspro-backend/internal/shared/errors"
)

// Cài realtime.Backend: gateway hỏi service về xác thực, gói nghiệp vụ, đang soạn tin, online.

// Authenticate: gói "auth" {access_token, device_id}. device_id BẮT BUỘC và phải khớp token: gateway xếp kết nối theo
// device_id của gói, thiếu / 0 mà vẫn nhận thì đăng xuất / thu hồi thiết bị (CloseDevice) không đóng được kết nối đó.
func (s *Service) Authenticate(ctx context.Context, accessToken string, deviceID int64) (int64, error) {
	uid, did, err := s.authToken(ctx, accessToken)
	if err != nil {
		var ae *apperr.AppError
		if errors.As(err, &ae) {
			return 0, &realtime.Error{Code: CodeAuthFailed, Message: MsgNoAuth}
		}
		logger.Error("chat", "xác thực WebSocket lỗi:", err.Error())
		return 0, err
	}
	if deviceID != did {
		return 0, &realtime.Error{Code: CodeAuthFailed, Message: MsgNoAuth}
	}
	p, err := s.pool()
	if err != nil {
		return 0, err
	}
	// đọc lại dòng thiết bị (không qua cache): vừa đăng xuất / bị thu hồi (cache có thể còn) thì 0 dòng -> từ chối
	tag, err := p.Exec(ctx, `update chat_devices set last_seen_at = now() where id = $1 and user_id = $2`, did, uid)
	if err != nil {
		logger.Error("chat", "ghi truy cập thiết bị lỗi:", err.Error())
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		s.forgetDevice(did)
		return 0, &realtime.Error{Code: CodeAuthFailed, Message: MsgNoAuth}
	}
	return uid, nil
}

// HandleMessage: message.send / message.delivered / message.read của một kết nối đã xác thực.
func (s *Service) HandleMessage(ctx context.Context, c realtime.Client, typ string, data json.RawMessage) (any, error) {
	switch typ {
	case "message.send":
		var in SendInput
		if err := decodeData(data, &in); err != nil {
			return nil, wsError(typ, err)
		}
		ack, err := s.SendMessage(ctx, c.UserID, in)
		if err != nil {
			return nil, wsError(typ, err)
		}
		return ack, nil
	case "message.delivered", "message.read":
		var in receiptInput
		if err := decodeData(data, &in); err != nil {
			return nil, wsError(typ, err)
		}
		ack, err := s.MarkReceipt(ctx, c.UserID, in.ConversationID, in.Seq, typ == "message.read")
		if err != nil {
			return nil, wsError(typ, err)
		}
		return ack, nil
	}
	return nil, &realtime.Error{Code: CodeUnknownType, Message: "Không hỗ trợ gói tin: " + typ}
}

// decodeData: data của gói phải là JSON object.
func decodeData(data json.RawMessage, dst any) error {
	if len(data) == 0 || data[0] != '{' {
		return errBadBody
	}
	if err := json.Unmarshal(data, dst); err != nil {
		return errBadBody
	}
	return nil
}

// TypingTargets: thành viên đang hoạt động trừ userID; userID không còn trong hội thoại -> lỗi. Chat 1-1 mà một trong
// hai bên đã chặn bên kia -> không ai (không báo lỗi: người bị chặn không biết mình bị chặn).
func (s *Service) TypingTargets(ctx context.Context, userID, conversationID int64) ([]int64, error) {
	e, err := s.convMembers(ctx, conversationID)
	if err != nil {
		return nil, wsError("typing", err)
	}
	var out []int64
	in := false
	for _, x := range e.list {
		if x.userID == userID {
			in = true
		} else {
			out = append(out, x.userID)
		}
	}
	if !in {
		return nil, wsError("typing", errNotMember)
	}
	if e.blocked {
		return nil, nil
	}
	return out, nil
}

// presenceCond: điều kiện SQL "v được xem online của t" (v, t là biểu thức SQL): không ai chặn ai, và là bạn bè hoặc
// chung một hội thoại đang hoạt động - nhóm, hoặc chat 1-1 mà t đã nhắn ít nhất một tin (mở chat 1-1 trống với người lạ
// không đủ để theo dõi họ). KHÔNG đối xứng (vế chat 1-1).
func presenceCond(v, t string) string {
	return `(not exists (select 1 from chat_friendships f where f.status = 'blocked'
			and ((f.user_id = ` + v + ` and f.friend_id = ` + t + `) or (f.user_id = ` + t + ` and f.friend_id = ` + v + `)))
		and (exists (select 1 from chat_friendships f where f.user_id = ` + v + ` and f.friend_id = ` + t + ` and f.status = 'accepted')
			or exists (select 1 from chat_conversation_members a
				join chat_conversation_members b on b.conversation_id = a.conversation_id and b.user_id = ` + t + ` and b.left_at is null
				join chat_conversations c on c.id = a.conversation_id
				where a.user_id = ` + v + ` and a.left_at is null and (c.conversation_type = 'group'
					or exists (select 1 from chat_messages x where x.conversation_id = c.id and x.sender_id = ` + t + `)))))`
}

// recheckPresence: sau khi quan hệ / thành viên đổi (huỷ kết bạn, rời / bị xoá khỏi nhóm), chiều nào giữa user và từng
// người trong others không còn được xem online thì gateway gỡ đăng ký presence của chiều đó. Lỗi chỉ ghi log.
func (s *Service) recheckPresence(ctx context.Context, user int64, others []int64) {
	if s.gateway() == nil || len(others) == 0 {
		return
	}
	p, err := s.pool()
	if err != nil {
		return
	}
	rows, err := p.Query(ctx, `select o.id, `+presenceCond("$1::bigint", "o.id")+`, `+presenceCond("o.id", "$1::bigint")+`
		from unnest($2::bigint[]) as o(id) where o.id <> $1::bigint`, user, others)
	if err != nil {
		logger.Error("chat", "kiểm lại quyền xem online lỗi:", err.Error())
		return
	}
	defer rows.Close()
	var lost []int64 // user thôi được xem họ
	var lostBack []int64
	for rows.Next() {
		var id int64
		var see, seen bool
		if err := rows.Scan(&id, &see, &seen); err != nil {
			logger.Error("chat", "kiểm lại quyền xem online lỗi:", err.Error())
			return
		}
		if !see {
			lost = append(lost, id)
		}
		if !seen {
			lostBack = append(lostBack, id) // họ thôi được xem user
		}
	}
	if rows.Err() != nil {
		return
	}
	s.revokePresence(user, lost)
	for _, o := range lostBack {
		s.revokePresence(o, []int64{user})
	}
}

// PresenceInfo: trong targets, người userID được xem online (presenceCond; chính mình cũng được) kèm truy cập lần cuối
// (zero = chưa có).
func (s *Service) PresenceInfo(ctx context.Context, userID int64, targets []int64) (map[int64]time.Time, error) {
	out := map[int64]time.Time{}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, t := range targets {
		if t > 0 && !seen[t] && len(ids) < 500 {
			seen[t] = true
			ids = append(ids, t)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	rows, err := p.Query(ctx, `select u.id, u.last_seen_at from chat_users u
		where u.id = any($2::bigint[]) and (u.id = $1::bigint or `+presenceCond("$1::bigint", "u.id")+`)`, userID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var at *time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		if at != nil {
			out[id] = *at
		} else {
			out[id] = time.Time{}
		}
	}
	return out, rows.Err()
}

// PresenceChanged: offline -> ghi chat_users.last_seen_at (lỗi chỉ ghi log). Online không cần ghi gì.
func (s *Service) PresenceChanged(userID int64, online bool, at time.Time) {
	if online {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	p, err := s.pool()
	if err == nil {
		_, err = p.Exec(ctx, `update chat_users set last_seen_at = $2::timestamptz where id = $1`, userID, pgTime(at))
	}
	if err != nil {
		logger.Error("chat", "ghi truy cập lần cuối lỗi:", err.Error())
	}
}
