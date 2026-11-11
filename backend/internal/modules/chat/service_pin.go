package chat

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
)

// Ghim tin nhắn (migration 0021): nhóm - trưởng / phó nhóm; chat 1-1 - cả hai bên. Tối đa maxPins tin mỗi hội thoại.

const maxPins = 5

// PinDTO: một tin đang ghim (kèm tóm tắt tin để hiện thanh ghim mà không cần tải lịch sử).
type PinDTO struct {
	MessageID    int64   `json:"message_id"`
	Seq          int64   `json:"seq"`
	SenderID     int64   `json:"sender_id"`
	SenderName   string  `json:"sender_name"`
	MsgType      string  `json:"msg_type"`
	Content      string  `json:"content"`
	FileName     *string `json:"file_name"`
	PinnedBy     int64   `json:"pinned_by"`
	PinnedByName string  `json:"pinned_by_name"`
	PinnedAt     string  `json:"pinned_at"`
}

// PinList: kết quả GET / POST / DELETE ghim và dữ liệu gói pins.updated.
type PinList struct {
	ConversationID int64    `json:"conversation_id"`
	Pins           []PinDTO `json:"pins"`
}

type pinBody struct {
	MessageID int64 `json:"message_id"`
}

func listPins(ctx context.Context, q querier, convID int64) (*PinList, error) {
	rows, err := q.Query(ctx, `select m.id, m.seq, m.sender_id, su.display_name, m.message_type, m.content, m.file_name,
			p.pinned_by, pu.display_name, p.pinned_at
		from chat_pinned_messages p
		join chat_messages m on m.id = p.message_id
		join chat_users su on su.id = m.sender_id
		join chat_users pu on pu.id = p.pinned_by
		where p.conversation_id = $1
		order by p.pinned_at desc, m.seq desc`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &PinList{ConversationID: convID, Pins: []PinDTO{}}
	for rows.Next() {
		var d PinDTO
		var at time.Time
		if err := rows.Scan(&d.MessageID, &d.Seq, &d.SenderID, &d.SenderName, &d.MsgType, &d.Content, &d.FileName,
			&d.PinnedBy, &d.PinnedByName, &at); err != nil {
			return nil, err
		}
		d.PinnedAt = iso(at)
		out.Pins = append(out.Pins, d)
	}
	return out, rows.Err()
}

// Pins: danh sách tin đang ghim (mới ghim trước); thành viên đang hoạt động hoặc dòng chỉ đọc của nhóm đã giải tán.
func (s *Service) Pins(ctx context.Context, uid, convID int64) (*PinList, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	ok, err := canReadConv(ctx, p, uid, convID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errNotMember
	}
	return listPins(ctx, p, convID)
}

// lockPinConv: khoá dòng hội thoại, uid phải là thành viên đang hoạt động và có quyền ghim (nhóm đã giải tán -> 410).
func lockPinConv(ctx context.Context, tx pgx.Tx, convID, uid int64) (convRef, string, error) {
	var c convRef
	var role, actor string
	var visible, disbanded bool
	err := tx.QueryRow(ctx, `select c.conversation_type, c.name, m.member_role, u.display_name, `+convVisible+`, c.disbanded_at is not null
		from chat_conversations c
		join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
		join chat_users u on u.id = m.user_id
		where c.id = $1 for update of c`, convID, uid).Scan(&c.typ, &c.name, &role, &actor, &visible, &disbanded)
	if noRows(err) || (err == nil && !visible) {
		return c, "", errNotMember
	}
	if err != nil {
		return c, "", err
	}
	c.id = convID
	if disbanded {
		return c, "", errGroupDisbanded
	}
	if c.typ == "group" && !canDo(role, GroupSettingsDTO{}, ActPin) {
		return c, "", errForbidden("Chỉ trưởng / phó nhóm được ghim tin nhắn")
	}
	return c, actor, nil
}

// PinMessage: ghim tin messageID của hội thoại (đã ghim -> giữ nguyên, không thêm tin hệ thống).
func (s *Service) PinMessage(ctx context.Context, uid, convID, messageID int64) (*PinList, error) {
	if messageID <= 0 {
		return nil, errBad("Thiếu message_id")
	}
	var msg *msgRow
	var list *PinList
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, actor, err := lockPinConv(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		var typ string
		var recalled bool
		err = tx.QueryRow(ctx, `select message_type, recalled_at is not null from chat_messages where id = $1 and conversation_id = $2`,
			messageID, convID).Scan(&typ, &recalled)
		if noRows(err) {
			return errNotFound("Không tìm thấy tin nhắn trong cuộc trò chuyện này")
		}
		if err != nil {
			return err
		}
		if typ == "system" {
			return errBad("Không ghim được tin hệ thống")
		}
		if recalled { // thu hồi cùng khoá dòng hội thoại: tin đã thu hồi không còn dòng ghim nào
			return errMessageRecalled
		}
		var n int
		var already bool
		if err := tx.QueryRow(ctx, `select count(*), coalesce(bool_or(message_id = $2), false) from chat_pinned_messages
			where conversation_id = $1`, convID, messageID).Scan(&n, &already); err != nil {
			return err
		}
		if !already {
			if n >= maxPins {
				return errBad("Mỗi cuộc trò chuyện ghim tối đa 5 tin, hãy bỏ ghim bớt")
			}
			if _, err := tx.Exec(ctx, `insert into chat_pinned_messages (conversation_id, message_id, pinned_by) values ($1, $2, $3)`,
				convID, messageID, uid); err != nil {
				return err
			}
			if msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", actor+" đã ghim một tin nhắn", nil, nil, nil); err != nil {
				return err
			}
		}
		list, err = listPins(ctx, tx, convID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if msg != nil {
		s.dispatch(msg, nil)
		s.broadcastPins(list)
	}
	return list, nil
}

// UnpinMessage: bỏ ghim (không ghim -> giữ nguyên). Không có tin hệ thống.
func (s *Service) UnpinMessage(ctx context.Context, uid, convID, messageID int64) (*PinList, error) {
	var changed bool
	var list *PinList
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, _, err := lockPinConv(ctx, tx, convID, uid); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `delete from chat_pinned_messages where conversation_id = $1 and message_id = $2`, convID, messageID)
		if err != nil {
			return err
		}
		changed = tag.RowsAffected() > 0
		list, err = listPins(ctx, tx, convID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if changed {
		s.broadcastPins(list)
	}
	return list, nil
}

// broadcastPins: pins.updated tới thành viên đang hoạt động, qua bộ chạy tuần tự theo hội thoại (sau message.new của tin hệ thống).
func (s *Service) broadcastPins(list *PinList) {
	job := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		mem, err := s.activeMembers(ctx, list.ConversationID)
		if err != nil {
			logger.Error("chat", "đọc thành viên hội thoại", list.ConversationID, "lỗi:", err.Error())
			return
		}
		to := make([]int64, 0, len(mem))
		for _, x := range mem {
			to = append(to, x.userID)
		}
		s.sendTo(to, "pins.updated", list)
	}
	g := s.gateway()
	if g == nil {
		job()
		return
	}
	if !g.Submit(list.ConversationID, job) {
		logger.Error("chat", "hàng đợi phân phối đầy, bỏ pins.updated của hội thoại", list.ConversationID)
	}
}
