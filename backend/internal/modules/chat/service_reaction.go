package chat

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
)

// Reaction trên tin nhắn (migration 0023, bảng chat_message_reactions; API.md mục "Giai đoạn 2 ..."): mỗi người tối đa một
// reaction / tin trong bộ cố định ReactionCodes; đặt reaction khác = thay. Không push. Mỗi lần đổi đẩy chat_messages.updated_at +
// chat_conversations.updated_at (để /sync + GET .../messages/changes bù được) và gửi reactions.updated sau commit.

// reactionMaxList: số người tối đa trả về ở GET /messages/:message_id/reactions (= cỡ nhóm).
const reactionMaxList = 1000

// reactMsg: tin đang thả cảm xúc (đã khoá dòng hội thoại + dòng tin).
type reactMsg struct {
	id, convID, seq int64
}

// reactionEmpty: tổng hợp rỗng (Counts không bao giờ nil).
func reactionEmpty() *ReactionSummaryDTO {
	return &ReactionSummaryDTO{Counts: map[string]int64{}}
}

// reactionSummaries: tổng hợp reaction của các tin (mine theo uid); tin không có reaction không có trong map.
func (s *Service) reactionSummaries(ctx context.Context, q querier, uid int64, messageIDs []int64) (map[int64]*ReactionSummaryDTO, error) {
	out := map[int64]*ReactionSummaryDTO{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `select message_id, reaction, count(*), bool_or(user_id = $2)
		from chat_message_reactions where message_id = any($1::bigint[])
		group by message_id, reaction`, messageIDs, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, n int64
		var code string
		var mine bool
		if err := rows.Scan(&id, &code, &n, &mine); err != nil {
			return nil, err
		}
		sum := out[id]
		if sum == nil {
			sum = reactionEmpty()
			out[id] = sum
		}
		sum.Counts[code] = n
		sum.Total += n
		if mine {
			c := code
			sum.Mine = &c
		}
	}
	return out, rows.Err()
}

// reactionSummaryOf: tổng hợp của một tin (không có reaction -> rỗng).
func (s *Service) reactionSummaryOf(ctx context.Context, q querier, uid, messageID int64) (*ReactionSummaryDTO, error) {
	m, err := s.reactionSummaries(ctx, q, uid, []int64{messageID})
	if err != nil {
		return nil, err
	}
	if sum := m[messageID]; sum != nil {
		return sum, nil
	}
	return reactionEmpty(), nil
}

// reactMember: trạng thái của uid trong hội thoại chứa tin messageID. found = false: tin không có hoặc uid chưa từng là thành
// viên (404, không lộ tin tồn tại). Khoá dòng hội thoại khi lock (thứ tự khoá hội thoại -> tin như thu hồi / sửa / gửi tin).
type reactMember struct {
	convID    int64
	convType  string
	found     bool
	active    bool // chưa rời
	readonly  bool // dòng chỉ đọc của nhóm đã giải tán
	visible   bool // convVisible: đang hoạt động hoặc chỉ đọc
	disbanded bool
}

func reactLoadMember(ctx context.Context, q querier, uid, messageID int64, lock bool) (reactMember, error) {
	var r reactMember
	if messageID <= 0 {
		return r, nil
	}
	err := q.QueryRow(ctx, `select conversation_id from chat_messages where id = $1`, messageID).Scan(&r.convID)
	if noRows(err) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	sql := `select c.conversation_type, c.disbanded_at is not null, m.user_id is not null, coalesce(m.left_at is null, false),
			coalesce(c.disbanded_at is not null and m.left_at = c.disbanded_at, false), coalesce(` + convVisible + `, false)
		from chat_conversations c
		left join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
		where c.id = $1`
	if lock {
		sql += ` for update of c`
	}
	err = q.QueryRow(ctx, sql, r.convID, uid).Scan(&r.convType, &r.disbanded, &r.found, &r.active, &r.readonly, &r.visible)
	if noRows(err) {
		r.found = false
		return r, nil
	}
	return r, err
}

// reactLoadMsgTx: kiểm quyền thả / bỏ cảm xúc (ma trận API.md: thành viên đang hoạt động, kể cả member khi nhóm bật
// admins_only_send; nhóm đã giải tán 410; đã rời 403; tin hệ thống 400; tin đã thu hồi 410; chat 1-1 đang chặn 403 BLOCKED),
// khoá dòng hội thoại rồi dòng tin tới hết transaction.
func reactLoadMsgTx(ctx context.Context, tx pgx.Tx, uid, messageID int64) (reactMsg, error) {
	r := reactMsg{id: messageID}
	mem, err := reactLoadMember(ctx, tx, uid, messageID, true)
	if err != nil {
		return r, err
	}
	if !mem.found {
		return r, errMessageNotFound
	}
	r.convID = mem.convID
	if mem.readonly {
		return r, errGroupDisbanded
	}
	if !mem.active {
		return r, errNotMember
	}
	if mem.disbanded { // không xảy ra với dòng đang hoạt động (giải tán đặt left_at mọi dòng) - phòng hờ
		return r, errGroupDisbanded
	}
	var typ string
	var recalled bool
	err = tx.QueryRow(ctx, `select seq, message_type, recalled_at is not null from chat_messages where id = $1 for update`,
		messageID).Scan(&r.seq, &typ, &recalled)
	if noRows(err) {
		return r, errMessageNotFound
	}
	if err != nil {
		return r, err
	}
	if typ == "system" {
		return r, errBad("Không thả cảm xúc cho tin hệ thống")
	}
	if recalled {
		return r, errMessageRecalled
	}
	if mem.convType == "direct" {
		var blocked bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from chat_conversation_members x
			join chat_friendships f on f.status = 'blocked'
				and ((f.user_id = $2 and f.friend_id = x.user_id) or (f.user_id = x.user_id and f.friend_id = $2))
			where x.conversation_id = $1 and x.user_id <> $2)`, r.convID, uid).Scan(&blocked); err != nil {
			return r, err
		}
		if blocked {
			return r, errBlocked("Không thể thả cảm xúc với người này")
		}
	}
	return r, nil
}

// reactTouchTx: đánh dấu tin + hội thoại vừa đổi (nguồn của /sync và GET .../messages/changes).
func reactTouchTx(ctx context.Context, tx pgx.Tx, r reactMsg) error {
	if _, err := tx.Exec(ctx, `update chat_messages set updated_at = now() where id = $1`, r.id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `update chat_conversations set updated_at = now() where id = $1`, r.convID)
	return err
}

// SetReaction: đặt reaction của uid trên tin (thay reaction cũ; giống cũ -> không đổi gì, không gói). Trả tổng hợp nhìn từ uid.
func (s *Service) SetReaction(ctx context.Context, uid, messageID int64, reaction string) (*ReactionSummaryDTO, error) {
	if !validReaction(reaction) {
		return nil, errBad("Cảm xúc không hợp lệ")
	}
	return s.reactChange(ctx, uid, messageID, &reaction)
}

// RemoveReaction: bỏ reaction của uid trên tin (chưa thả -> giữ nguyên, idempotent).
func (s *Service) RemoveReaction(ctx context.Context, uid, messageID int64) (*ReactionSummaryDTO, error) {
	return s.reactChange(ctx, uid, messageID, nil)
}

// reactChange: reaction = nil -> bỏ; khác -> đặt. Gửi reactions.updated sau commit khi có đổi.
func (s *Service) reactChange(ctx context.Context, uid, messageID int64, reaction *string) (*ReactionSummaryDTO, error) {
	if !s.reactLimit.allow(uid) {
		return nil, errActionRateLimit
	}
	var r reactMsg
	var sum *ReactionSummaryDTO
	var changed bool
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if r, err = reactLoadMsgTx(ctx, tx, uid, messageID); err != nil {
			return err
		}
		var n int64
		if reaction != nil {
			tag, err := tx.Exec(ctx, `insert into chat_message_reactions (message_id, user_id, reaction) values ($1, $2, $3)
				on conflict (message_id, user_id) do update set reaction = excluded.reaction, created_at = now()
				where chat_message_reactions.reaction <> excluded.reaction`, messageID, uid, *reaction)
			if err != nil {
				return err
			}
			n = tag.RowsAffected()
		} else {
			tag, err := tx.Exec(ctx, `delete from chat_message_reactions where message_id = $1 and user_id = $2`, messageID, uid)
			if err != nil {
				return err
			}
			n = tag.RowsAffected()
		}
		if changed = n > 0; changed {
			if err := reactTouchTx(ctx, tx, r); err != nil {
				return err
			}
		}
		sum, err = s.reactionSummaryOf(ctx, tx, uid, messageID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if changed {
		counts := make(map[string]int64, len(sum.Counts))
		for k, v := range sum.Counts {
			counts[k] = v
		}
		s.reactBroadcast(ReactionsUpdatedEvent{ConversationID: r.convID, MessageID: messageID, Seq: r.seq, Counts: counts,
			Total: sum.Total, UserID: uid, Reaction: reaction})
	}
	return sum, nil
}

// Reactions: ai đã thả cảm xúc gì trên tin (mới trước, tối đa reactionMaxList). Thành viên đang hoạt động hoặc dòng chỉ đọc của
// nhóm đã giải tán; tin hệ thống / đã thu hồi -> danh sách rỗng.
func (s *Service) Reactions(ctx context.Context, uid, messageID int64) (*ReactionList, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	mem, err := reactLoadMember(ctx, p, uid, messageID, false)
	if err != nil {
		return nil, err
	}
	if !mem.found {
		return nil, errMessageNotFound
	}
	if !mem.visible {
		return nil, errNotMember
	}
	rows, err := p.Query(ctx, `select r.user_id, u.display_name, r.reaction, r.created_at
		from chat_message_reactions r join chat_users u on u.id = r.user_id
		where r.message_id = $1
		order by r.created_at desc, r.user_id desc
		limit $2`, messageID, reactionMaxList)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ReactionList{MessageID: messageID, Reactions: []ReactionUserDTO{}}
	for rows.Next() {
		var d ReactionUserDTO
		var at time.Time
		if err := rows.Scan(&d.UserID, &d.DisplayName, &d.Reaction, &at); err != nil {
			return nil, err
		}
		d.CreatedAt = iso(at)
		out.Reactions = append(out.Reactions, d)
	}
	return out, rows.Err()
}

// reactBroadcast: reactions.updated tới mọi thành viên đang hoạt động (mọi thiết bị, kể cả người thao tác), qua bộ chạy tuần tự
// theo hội thoại để đúng thứ tự với message.new / message.updated.
func (s *Service) reactBroadcast(ev ReactionsUpdatedEvent) {
	job := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		mem, err := s.activeMembers(ctx, ev.ConversationID)
		if err != nil {
			logger.Error("chat", "đọc thành viên hội thoại", ev.ConversationID, "lỗi:", err.Error())
			return
		}
		to := make([]int64, 0, len(mem))
		for _, x := range mem {
			to = append(to, x.userID)
		}
		s.sendTo(to, EvReactionsUpdated, ev)
	}
	g := s.gateway()
	if g == nil {
		job()
		return
	}
	if !g.Submit(ev.ConversationID, job) {
		logger.Error("chat", "hàng đợi phân phối đầy, bỏ reactions.updated của hội thoại", ev.ConversationID)
	}
}
