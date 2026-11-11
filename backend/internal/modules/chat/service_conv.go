package chat

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Hội thoại 1-1 và nhóm: danh sách, chi tiết, tạo, thành viên, quyền, tắt thông báo, lịch sử tin, đồng bộ (CHAT.md 8, 9, 11).

const (
	maxGroupMembers = 1000
	maxPageLimit    = 100
	defaultLimit    = 50
	maxSyncRows     = 500
)

// ConversationList: kết quả GET /chat/conversations.
type ConversationList struct {
	Conversations []ConversationDTO `json:"conversations"`
	NextCursor    *string           `json:"next_cursor"`
	SyncCursor    string            `json:"sync_cursor"`
}

// SyncResult: kết quả GET /chat/sync.
type SyncResult struct {
	Conversations []ConversationDTO `json:"conversations"`
	SyncCursor    string            `json:"sync_cursor"`
	Truncated     bool              `json:"truncated"`
}

// MessagePage: kết quả GET /chat/conversations/:id/messages (tăng dần theo seq).
type MessagePage struct {
	Messages []MessageDTO `json:"messages"`
	HasMore  bool         `json:"has_more"`
	// HasNewer: còn tin mới hơn trang này - chỉ có ở chế độ around_seq (MessagesAround).
	HasNewer *bool `json:"has_newer,omitempty"`
}

// convRow: 1 hội thoại nhìn từ một thành viên (kể cả đã rời).
type convRow struct {
	id                       int64
	typ                      string
	name                     *string
	lastSeq                  int64
	lastMsgAt                *time.Time
	createdAt, updatedAt     time.Time
	role                     string
	readSeq, delivSeq        int64
	mutedForever             bool
	mutedUntil               *time.Time
	left                     bool
	memberUpdated            time.Time
	memberCount              int64
	peerID                   *int64
	peerPosted               bool // chat 1-1: người kia đã nhắn ít nhất một tin (cho xem online của họ)
	lmID, lmSeq, lmSender    *int64
	lmClient, lmType, lmText *string
	lmAt                     *time.Time
	lmSenderName             *string
	lmMedia                  *int64  // chat_messages.media_id của tin cuối
	lmFile                   *string // chat_messages.file_name của tin cuối
	lmMentions               *string // chat_messages.mentions (jsonb dạng chữ) của tin cuối
	description              *string // null với chat 1-1 / dòng đã rời
	avatarID                 *int64  // chat_conversations.avatar_media_id (null với dòng đã rời)
	settings                 GroupSettingsDTO
	disbanded                bool       // nhóm đã giải tán và dòng này là dòng chỉ đọc (left_at = disbanded_at)
	lastMention              int64      // last_mention_seq (0 với dòng đã rời)
	lmEdited                 *time.Time // chat_messages.edited_at của tin cuối
	lmRecalled               bool       // tin cuối đã thu hồi
	lmRecalledBy             *int64
	lmForwarded              bool
}

// convVisible: dòng thành viên còn xem được hội thoại - đang hoạt động, hoặc dòng chỉ đọc của nhóm đã giải tán
// (left_at = disbanded_at). m = chat_conversation_members, c = chat_conversations.
const convVisible = `(m.left_at is null or m.left_at is not distinct from c.disbanded_at)`

// convSelect: $1 = người xem. Dòng đã rời (left) chỉ còn dữ liệu của chính mình: không tên, không tin cuối, last_seq =
// con trỏ đã nhận của mình, updated_at = lúc dòng thành viên đổi, member_count 0 - người đã rời / bị xoá không theo dõi
// được tên, lượng tin, hoạt động, số thành viên của nhóm qua /sync?cursor=0. Dòng chỉ đọc của nhóm đã giải tán hiện
// như hội thoại thường (left = false, disbanded = true, member_count 0).
const convSelect = `select c.id, c.conversation_type, case when ` + convVisible + ` then c.name end,
  case when ` + convVisible + ` then c.last_seq else m.last_delivered_seq end,
  case when ` + convVisible + ` then c.last_message_at end, c.created_at,
  case when ` + convVisible + ` then c.updated_at else m.updated_at end,
  m.member_role, m.last_read_seq, m.last_delivered_seq,
  coalesce(m.muted_until > now() and m.muted_until = 'infinity'::timestamptz, false),
  case when m.muted_until > now() and m.muted_until < 'infinity'::timestamptz then m.muted_until end,
  not ` + convVisible + `, m.updated_at,
  case when m.left_at is null then
    (select count(*) from chat_conversation_members x where x.conversation_id = c.id and x.left_at is null) else 0 end,
  case when c.conversation_type = 'direct' then
    (select x.user_id from chat_conversation_members x where x.conversation_id = c.id and x.user_id <> m.user_id limit 1) end,
  c.conversation_type = 'direct' and exists (select 1 from chat_messages x where x.conversation_id = c.id and x.sender_id <> m.user_id),
  lm.id, lm.seq, lm.sender_id, lm.client_msg_id::text, lm.message_type, lm.content, lm.created_at, su.display_name,
  lm.media_id, lm.file_name, lm.mentions::text,
  case when ` + convVisible + ` then c.description end, case when ` + convVisible + ` then c.avatar_media_id end,
  c.is_admin_only_send, c.is_admin_only_info, c.is_admin_only_add,
  c.disbanded_at is not null and m.left_at is not distinct from c.disbanded_at,
  case when ` + convVisible + ` then m.last_mention_seq else 0 end,
  lm.edited_at, coalesce(lm.recalled_at is not null, false), lm.recalled_by, coalesce(lm.is_forwarded, false)
from chat_conversation_members m
join chat_conversations c on c.id = m.conversation_id
left join chat_messages lm on ` + convVisible + ` and lm.conversation_id = c.id and lm.seq = c.last_seq
left join chat_users su on su.id = lm.sender_id
where m.user_id = $1 `

func queryConvs(ctx context.Context, q querier, sql string, args ...any) ([]*convRow, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*convRow
	for rows.Next() {
		r := &convRow{}
		if err := rows.Scan(&r.id, &r.typ, &r.name, &r.lastSeq, &r.lastMsgAt, &r.createdAt, &r.updatedAt,
			&r.role, &r.readSeq, &r.delivSeq, &r.mutedForever, &r.mutedUntil, &r.left, &r.memberUpdated,
			&r.memberCount, &r.peerID, &r.peerPosted,
			&r.lmID, &r.lmSeq, &r.lmSender, &r.lmClient, &r.lmType, &r.lmText, &r.lmAt, &r.lmSenderName, &r.lmMedia, &r.lmFile,
			&r.lmMentions, &r.description, &r.avatarID, &r.settings.AdminsOnlySend, &r.settings.AdminsOnlyEditInfo,
			&r.settings.AdminsOnlyAddMembers, &r.disbanded, &r.lastMention,
			&r.lmEdited, &r.lmRecalled, &r.lmRecalledBy, &r.lmForwarded); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// convDTOs: dựng dòng trả về, kèm người còn lại của hội thoại 1-1 (quan hệ + online).
func (s *Service) convDTOs(ctx context.Context, q querier, uid int64, rows []*convRow) ([]ConversationDTO, error) {
	var peers []int64
	for _, r := range rows {
		if r.peerID != nil {
			peers = append(peers, *r.peerID)
		}
	}
	users, err := loadUsers(ctx, q, uid, peers)
	if err != nil {
		return nil, err
	}
	online := s.online(peers)
	var mediaIDs []int64
	for _, r := range rows {
		if r.lmMedia != nil {
			mediaIDs = append(mediaIDs, *r.lmMedia)
		}
		if r.avatarID != nil {
			mediaIDs = append(mediaIDs, *r.avatarID)
		}
	}
	mds, err := s.mediaDTOs(ctx, q, mediaIDs)
	if err != nil {
		return nil, err
	}
	out := make([]ConversationDTO, 0, len(rows))
	for _, r := range rows {
		d := ConversationDTO{
			ID: r.id, Type: r.typ, Name: r.name, MemberCount: r.memberCount, Role: r.role,
			LastSeq: r.lastSeq, LastReadSeq: r.readSeq, LastDeliveredSeq: r.delivSeq,
			LastMessageAt: isoPtr(r.lastMsgAt), MutedUntil: isoPtr(r.mutedUntil), Left: r.left,
			CreatedAt: iso(r.createdAt), UpdatedAt: iso(r.updatedAt),
		}
		if r.mutedForever {
			f := "forever"
			d.MutedUntil = &f
		}
		if !r.left && !r.disbanded && r.lastSeq > r.readSeq {
			d.Unread = r.lastSeq - r.readSeq
		}
		if r.typ == "group" && !r.left {
			d.Description = r.description
			d.Avatar = groupAvatar(r.avatarID, mds)
			st := r.settings
			d.Settings = &st
			d.Disbanded = r.disbanded
			d.LastMentionSeq = r.lastMention
			d.UnreadMention = !r.disbanded && r.lastMention > r.readSeq
		}
		if r.peerID != nil {
			if u := users[*r.peerID]; u != nil {
				// online của người chưa là bạn chỉ hiện khi họ đã nhắn trong chat này (cùng quy tắc PresenceInfo): mở
				// chat 1-1 trống với người lạ không cho xem được họ online
				pd := u.dto(uid, false, false, r.peerPosted, online)
				d.Peer = &pd
			}
		}
		if r.lmID != nil {
			m := MessageDTO{ID: *r.lmID, ConversationID: r.id, Seq: *r.lmSeq, ClientMsgID: r.lmClient, SenderID: *r.lmSender,
				MsgType: deref(r.lmType), Content: deref(r.lmText), SenderName: deref(r.lmSenderName)}
			// tin đã thu hồi: content rỗng, không tệp / nhắc tên (đã xoá khỏi dòng), không nhãn sửa / chuyển tiếp
			if r.lmRecalled {
				m.Content, m.Recalled, m.RecalledBy = "", true, r.lmRecalledBy
			} else {
				m.Forwarded, m.EditedAt = r.lmForwarded, isoPtr(r.lmEdited)
				if r.lmMentions != nil {
					m.Mentions = parseMentions([]byte(*r.lmMentions))
				}
				if m.Attachments, err = s.msgMedia(ctx, r.lmMedia, r.lmFile, mds); err != nil {
					return nil, err
				}
			}
			if r.lmAt != nil {
				m.CreatedAt = iso(*r.lmAt)
			}
			d.LastMessage = &m
		}
		out = append(out, d)
	}
	return out, nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// dbNowMs: giờ của database (mili giây) - mốc sync_cursor cùng đồng hồ với updated_at.
func dbNowMs(ctx context.Context, q querier) (string, error) {
	var ms int64
	err := q.QueryRow(ctx, `select floor(extract(epoch from clock_timestamp()) * 1000)::bigint`).Scan(&ms)
	return strconv.FormatInt(ms, 10), err
}

func clampLimit(n int) int {
	if n <= 0 {
		return defaultLimit
	}
	return min(n, maxPageLimit)
}

// ListConversations: hội thoại đang tham gia, tin mới nhất trước; cursor từ next_cursor của trang trước.
func (s *Service) ListConversations(ctx context.Context, uid int64, cursor string, limit int) (*ConversationList, error) {
	cur, err := decodeListCursor(cursor)
	if err != nil {
		return nil, err
	}
	limit = clampLimit(limit)
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	sc, err := dbNowMs(ctx, p)
	if err != nil {
		return nil, err
	}
	sql := convSelect + `and ` + convVisible + ` `
	args := []any{uid}
	switch {
	case cur == nil:
	case cur.at != nil:
		sql += `and (c.last_message_at < $2::timestamptz or (c.last_message_at = $2::timestamptz and c.id < $3) or c.last_message_at is null) `
		args = append(args, pgTime(*cur.at), cur.id)
	default:
		sql += `and c.last_message_at is null and c.id < $2 `
		args = append(args, cur.id)
	}
	sql += `order by c.last_message_at desc nulls last, c.id desc limit ` + strconv.Itoa(limit+1)
	rows, err := queryConvs(ctx, p, sql, args...)
	if err != nil {
		return nil, err
	}
	res := &ConversationList{SyncCursor: sc}
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[limit-1]
		nc := encodeListCursor(listCursor{at: last.lastMsgAt, id: last.id})
		res.NextCursor = &nc
	}
	if res.Conversations, err = s.convDTOs(ctx, p, uid, rows); err != nil {
		return nil, err
	}
	return res, nil
}

// Sync: hội thoại có thay đổi từ cursor - 10 giây (tin mới, đổi tên, thành viên, con trỏ / tắt thông báo của tôi,
// bị xoá khỏi nhóm -> left: true). Hội thoại đã rời chỉ còn hiện khi dòng thành viên của tôi đổi.
func (s *Service) Sync(ctx context.Context, uid int64, cursor string) (*SyncResult, error) {
	since, err := parseSyncCursor(cursor)
	if err != nil {
		return nil, err
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	sc, err := dbNowMs(ctx, p)
	if err != nil {
		return nil, err
	}
	rows, err := queryConvs(ctx, p, convSelect+`and ((`+convVisible+` and c.updated_at >= $2::timestamptz) or m.updated_at >= $2::timestamptz)
		order by case when `+convVisible+` then greatest(c.updated_at, m.updated_at) else m.updated_at end desc, c.id desc
		limit `+strconv.Itoa(maxSyncRows+1), uid, pgTime(since.Add(-syncOverlap)))
	if err != nil {
		return nil, err
	}
	res := &SyncResult{SyncCursor: sc}
	if len(rows) > maxSyncRows {
		rows, res.Truncated = rows[:maxSyncRows], true
	}
	if res.Conversations, err = s.convDTOs(ctx, p, uid, rows); err != nil {
		return nil, err
	}
	return res, nil
}

// convFor: dòng hội thoại convID của uid; activeOnly: đã rời -> FORBIDDEN.
func (s *Service) convFor(ctx context.Context, q querier, uid, convID int64, activeOnly bool) (*ConversationDTO, error) {
	rows, err := queryConvs(ctx, q, convSelect+`and c.id = $2`, uid, convID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 || (activeOnly && rows[0].left) {
		return nil, errNotMember
	}
	ds, err := s.convDTOs(ctx, q, uid, rows)
	if err != nil {
		return nil, err
	}
	return &ds[0], nil
}

// Conversation: chi tiết hội thoại + thành viên đang hoạt động (chỉ thành viên xem được; nhóm đã giải tán: dòng chỉ đọc
// xem được, members rỗng). pending_join_requests chỉ có số thật với trưởng / phó nhóm.
func (s *Service) Conversation(ctx context.Context, uid, convID int64) (*ConversationDetailDTO, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	c, err := s.convFor(ctx, p, uid, convID, true)
	if err != nil {
		return nil, err
	}
	if c.Disbanded {
		return &ConversationDetailDTO{ConversationDTO: *c, Members: []MemberDTO{}}, nil
	}
	var pending int64
	if c.Type == "group" && (c.Role == "owner" || c.Role == "admin") {
		n, err := pendingJoinRequestCount(ctx, p, convID)
		if err != nil {
			return nil, err
		}
		pending = int64(n)
	}
	rows, err := p.Query(ctx, `select m.user_id, u.display_name, m.member_role, m.last_read_seq, u.show_read_receipts,
		m.last_delivered_seq, m.joined_at
		from chat_conversation_members m join chat_users u on u.id = m.user_id
		where m.conversation_id = $1 and m.left_at is null order by m.joined_at, m.user_id`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	d := &ConversationDetailDTO{ConversationDTO: *c, Members: []MemberDTO{}, PendingJoinRequests: pending}
	for rows.Next() {
		var m MemberDTO
		var read int64
		var show bool
		var joined time.Time
		if err := rows.Scan(&m.UserID, &m.DisplayName, &m.Role, &read, &show, &m.LastDeliveredSeq, &joined); err != nil {
			return nil, err
		}
		if show || m.UserID == uid {
			r := read
			m.LastReadSeq = &r
		}
		m.JoinedAt = iso(joined)
		d.Members = append(d.Members, m)
	}
	return d, rows.Err()
}

// CreateDirect: hội thoại 1-1 với other; cặp đã có thì trả hội thoại cũ (khoá cặp + PK chat_direct_pairs).
func (s *Service) CreateDirect(ctx context.Context, uid, other int64) (*ConversationDetailDTO, error) {
	if other <= 0 {
		return nil, errBad("Thiếu user_id")
	}
	if other == uid {
		return nil, errBad("Không thể tự nhắn tin với chính mình")
	}
	low, high := min(uid, other), max(uid, other)
	var convID int64
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := xactLock(ctx, tx, "direct:"+pairKey(low, high)); err != nil {
			return err
		}
		if ok, err := userExists(ctx, tx, other); err != nil || !ok {
			if err == nil {
				err = errNotFound("Không tìm thấy người dùng")
			}
			return err
		}
		if b, err := blockedBetween(ctx, tx, uid, other); err != nil || b {
			if err == nil {
				err = errBlocked("Không thể nhắn tin với người này")
			}
			return err
		}
		err := tx.QueryRow(ctx, `select conversation_id from chat_direct_pairs where user_low = $1 and user_high = $2`, low, high).Scan(&convID)
		if err == nil || !noRows(err) {
			return err
		}
		// cặp mới với người chưa là bạn: giới hạn 30 / giờ (id tuần tự - không cho lặp user_id = 1..N để gom tên,
		// rải hội thoại trống vào danh sách người khác; CHAT.md 15 "giới hạn với người chưa kết bạn")
		mine, _, err := friendState(ctx, tx, uid, other)
		if err != nil {
			return err
		}
		if mine != "accepted" && !s.directLimit.allow(uid) {
			return errRateLimit
		}
		if err := tx.QueryRow(ctx, `insert into chat_conversations (conversation_type, created_by) values ('direct', $1) returning id`,
			uid).Scan(&convID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into chat_direct_pairs (user_low, user_high, conversation_id) values ($1, $2, $3)`, low, high, convID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `insert into chat_conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)`, convID, uid, other)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.forgetMembers(convID)
	return s.Conversation(ctx, uid, convID)
}

// cleanIDs: bỏ trùng, bỏ id <= 0 và chính tôi, giữ thứ tự.
func cleanIDs(ids []int64, me int64) []int64 {
	seen := map[int64]bool{}
	out := []int64{}
	for _, id := range ids {
		if id > 0 && id != me && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// nameList: "Bình, Châu" - quá 5 người thì "A, B, C, D, E và N người khác".
func nameList(names map[int64]string, ids []int64) string {
	var parts []string
	for i, id := range ids {
		if i == 5 {
			return strings.Join(parts, ", ") + " và " + strconv.Itoa(len(ids)-5) + " người khác"
		}
		parts = append(parts, names[id])
	}
	return strings.Join(parts, ", ")
}

func groupName(name string) (string, error) {
	n, ok := cleanText(name, 100)
	if !ok {
		return "", errBad("Tên nhóm phải có từ 1 đến 100 ký tự")
	}
	return n, nil
}

// CreateGroup: nhóm mới, người tạo là trưởng nhóm; mọi thành viên phải là bạn bè của người tạo.
func (s *Service) CreateGroup(ctx context.Context, uid int64, name string, memberIDs []int64) (*ConversationDetailDTO, error) {
	name, err := groupName(name)
	if err != nil {
		return nil, err
	}
	ids := cleanIDs(memberIDs, uid)
	if len(ids) == 0 {
		return nil, errBad("Nhóm cần ít nhất 1 thành viên khác")
	}
	if len(ids)+1 > maxGroupMembers {
		return nil, errBad("Nhóm tối đa 1000 thành viên")
	}
	var msg *msgRow
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		n, err := countFriends(ctx, tx, uid, ids)
		if err != nil {
			return err
		}
		if n != len(ids) {
			return errForbidden("Chỉ thêm được bạn bè vào nhóm")
		}
		var convID int64
		if err := tx.QueryRow(ctx, `insert into chat_conversations (conversation_type, name, created_by) values ('group', $1, $2) returning id`,
			name, uid).Scan(&convID); err != nil {
			return err
		}
		all := append([]int64{uid}, ids...)
		if _, err := tx.Exec(ctx, `insert into chat_conversation_members (conversation_id, user_id, member_role)
			select $1, u, case when u = $2 then 'owner' else 'member' end from unnest($3::bigint[]) u`, convID, uid, all); err != nil {
			return err
		}
		names, err := displayNames(ctx, tx, []int64{uid})
		if err != nil {
			return err
		}
		msg, err = insertMessageTx(ctx, tx, convRef{id: convID, typ: "group", name: &name}, uid, names[uid], "system",
			names[uid]+" đã tạo nhóm “"+name+"”", nil, nil, nil)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.forgetMembers(msg.conv.id)
	s.dispatch(msg, nil)
	return s.Conversation(ctx, uid, msg.conv.id)
}

// lockGroup: khoá dòng hội thoại (tuần tự với gửi tin / đổi thành viên khác), uid phải là thành viên nhóm đang hoạt động.
// Nhóm đã giải tán (uid còn dòng chỉ đọc) -> 410 GROUP_DISBANDED.
func lockGroup(ctx context.Context, tx pgx.Tx, convID, uid int64) (convRef, string, string, error) {
	var c convRef
	var role, actor string
	var visible, disbanded bool
	err := tx.QueryRow(ctx, `select c.conversation_type, c.name, m.member_role, u.display_name, `+convVisible+`, c.disbanded_at is not null
		from chat_conversations c
		join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
		join chat_users u on u.id = m.user_id
		where c.id = $1 for update of c`, convID, uid).Scan(&c.typ, &c.name, &role, &actor, &visible, &disbanded)
	if noRows(err) || (err == nil && !visible) {
		return c, "", "", errNotMember
	}
	if err != nil {
		return c, "", "", err
	}
	c.id = convID
	if c.typ != "group" {
		return c, "", "", errNotGroup
	}
	if disbanded {
		return c, "", "", errGroupDisbanded
	}
	return c, role, actor, nil
}

// activeRole: vai trò của user trong hội thoại ("" = không còn là thành viên).
func activeRole(ctx context.Context, tx pgx.Tx, convID, user int64) (string, error) {
	var role string
	err := tx.QueryRow(ctx, `select member_role from chat_conversation_members where conversation_id = $1 and user_id = $2 and left_at is null`,
		convID, user).Scan(&role)
	if noRows(err) {
		return "", nil
	}
	return role, err
}

// AddMembers: thành viên thêm bạn bè của mình vào nhóm (người đã rời được thêm lại); nhóm bật admins_only_add_members
// thì chỉ trưởng / phó nhóm. Người được thêm đang có yêu cầu vào nhóm chờ duyệt -> yêu cầu thành cancelled.
func (s *Service) AddMembers(ctx context.Context, uid, convID int64, userIDs []int64) (*ConversationDetailDTO, error) {
	ids := cleanIDs(userIDs, uid)
	if len(ids) == 0 {
		return nil, errBad("Thiếu user_ids")
	}
	if len(ids) > maxGroupMembers {
		return nil, errBad("Nhóm tối đa 1000 thành viên")
	}
	var msg *msgRow
	var cancelled bool
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		st, err := groupSettings(ctx, tx, convID)
		if err != nil {
			return err
		}
		if !canDo(role, st, ActAddMembers) {
			return errForbidden("Chỉ trưởng / phó nhóm được thêm thành viên")
		}
		n, err := countFriends(ctx, tx, uid, ids)
		if err != nil {
			return err
		}
		if n != len(ids) {
			return errForbidden("Chỉ thêm được bạn bè của bạn vào nhóm")
		}
		existing, err := idList(ctx, tx, `select user_id from chat_conversation_members
			where conversation_id = $1 and left_at is null and user_id = any($2::bigint[])`, convID, ids)
		if err != nil {
			return err
		}
		have := map[int64]bool{}
		for _, id := range existing {
			have[id] = true
		}
		var add []int64
		for _, id := range ids {
			if !have[id] {
				add = append(add, id)
			}
		}
		if len(add) == 0 {
			return nil
		}
		var active int
		if err := tx.QueryRow(ctx, `select count(*) from chat_conversation_members where conversation_id = $1 and left_at is null`,
			convID).Scan(&active); err != nil {
			return err
		}
		if active+len(add) > maxGroupMembers {
			return errBad("Nhóm tối đa 1000 thành viên")
		}
		// người mới / vào lại: con trỏ đã nhận / đã xem = tin hiện tại (chỉ tin từ lúc vào mới tính là chưa đọc)
		if _, err := tx.Exec(ctx, `insert into chat_conversation_members (conversation_id, user_id, member_role, last_read_seq, last_delivered_seq)
			select $1, u, 'member', c.last_seq, c.last_seq from unnest($2::bigint[]) u, chat_conversations c where c.id = $1
			on conflict (conversation_id, user_id) do update set member_role = 'member', left_at = null, joined_at = now(),
				last_read_seq = excluded.last_read_seq, last_delivered_seq = excluded.last_delivered_seq, muted_until = null, updated_at = now()`,
			convID, add); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `update chat_group_join_requests set status = 'cancelled', resolved_at = clock_timestamp()
			where conversation_id = $1 and user_id = any($2::bigint[]) and status = 'pending'`, convID, add)
		if err != nil {
			return err
		}
		cancelled = tag.RowsAffected() > 0
		names, err := displayNames(ctx, tx, add)
		if err != nil {
			return err
		}
		msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", actor+" đã thêm "+nameList(names, add)+" vào nhóm", nil, nil, nil)
		return err
	})
	if err != nil {
		return nil, err
	}
	if msg != nil {
		s.forgetMembers(convID)
		s.dispatch(msg, nil)
		s.emitMembersUpdated(convID)
		if cancelled {
			s.emitJoinRequestsUpdated(convID)
		}
	}
	return s.Conversation(ctx, uid, convID)
}

// RemoveMember: target = chính mình -> rời nhóm (trưởng nhóm rời thì chuyển cho phó nhóm vào sớm nhất, không có thì
// thành viên vào sớm nhất); người khác -> trưởng nhóm xoá được mọi người, phó nhóm chỉ xoá thành viên thường.
func (s *Service) RemoveMember(ctx context.Context, uid, convID, target int64) error {
	if target <= 0 {
		return errBad("Mã người dùng không hợp lệ")
	}
	if target == uid {
		// nhóm đã giải tán: gỡ dòng chỉ đọc khỏi danh sách của mình (không tin hệ thống)
		if done, err := s.hideDisbanded(ctx, uid, convID); err != nil || done {
			return err
		}
	}
	var msg *msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		var content string
		if target == uid {
			content = actor + " đã rời nhóm"
			if role == "owner" {
				if _, err := tx.Exec(ctx, `update chat_conversation_members set member_role = 'owner', updated_at = now()
					where conversation_id = $1 and user_id = (select user_id from chat_conversation_members
						where conversation_id = $1 and left_at is null and user_id <> $2
						order by (member_role = 'admin') desc, joined_at, user_id limit 1)`, convID, uid); err != nil {
					return err
				}
			}
		} else {
			tr, err := activeRole(ctx, tx, convID, target)
			if err != nil {
				return err
			}
			if tr == "" {
				return errNotFound("Người này không còn trong nhóm")
			}
			if !(role == "owner" || (role == "admin" && tr == "member")) {
				return errForbidden("Bạn không có quyền xoá thành viên này")
			}
			names, err := displayNames(ctx, tx, []int64{target})
			if err != nil {
				return err
			}
			content = actor + " đã xoá " + names[target] + " khỏi nhóm"
		}
		// tin hệ thống trước (người rời vẫn là thành viên lúc gửi), rồi mới đánh dấu rời
		if msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", content, nil, nil, nil); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update chat_conversation_members set left_at = now(), member_role = 'member', updated_at = clock_timestamp()
			where conversation_id = $1 and user_id = $2`, convID, target)
		return err
	})
	if err != nil {
		return err
	}
	s.forgetMembers(convID)
	forgetSendGate(convID)
	s.dispatch(msg, []int64{target})
	s.emitMembersUpdated(convID)
	// người rời và các thành viên còn lại: ai không còn chung hội thoại nào (và không là bạn) thì thôi xem online của nhau
	if mem, err := s.activeMembers(ctx, convID); err == nil {
		ids := make([]int64, 0, len(mem))
		for _, x := range mem {
			ids = append(ids, x.userID)
		}
		s.recheckPresence(ctx, target, ids)
	}
	return nil
}

// SetMemberRole: trưởng nhóm đặt / bỏ phó nhóm (role admin | member).
func (s *Service) SetMemberRole(ctx context.Context, uid, convID, target int64, newRole string) (*ConversationDetailDTO, error) {
	if newRole != "admin" && newRole != "member" {
		return nil, errBad("role phải là admin hoặc member")
	}
	if target <= 0 {
		return nil, errBad("Mã người dùng không hợp lệ")
	}
	var msg *msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		if role != "owner" {
			return errForbidden("Chỉ trưởng nhóm được đổi quyền thành viên")
		}
		if target == uid {
			return errBad("Không thể đổi quyền của chính mình")
		}
		tr, err := activeRole(ctx, tx, convID, target)
		if err != nil {
			return err
		}
		if tr == "" {
			return errNotFound("Người này không còn trong nhóm")
		}
		if tr == newRole {
			return nil
		}
		if _, err := tx.Exec(ctx, `update chat_conversation_members set member_role = $3, updated_at = now()
			where conversation_id = $1 and user_id = $2`, convID, target, newRole); err != nil {
			return err
		}
		names, err := displayNames(ctx, tx, []int64{target})
		if err != nil {
			return err
		}
		content := actor + " đã đặt " + names[target] + " làm quản trị viên"
		if newRole == "member" {
			content = actor + " đã bỏ quyền quản trị của " + names[target]
		}
		msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", content, nil, nil, nil)
		return err
	})
	if err != nil {
		return nil, err
	}
	if msg != nil {
		forgetSendGate(convID)
		s.dispatch(msg, nil)
		s.emitMembersUpdated(convID)
	}
	return s.Conversation(ctx, uid, convID)
}

// RenameGroup: đổi tên nhóm (= UpdateGroupInfo chỉ với name; quyền theo admins_only_edit_info).
func (s *Service) RenameGroup(ctx context.Context, uid, convID int64, name string) (*ConversationDetailDTO, error) {
	return s.UpdateGroupInfo(ctx, uid, convID, GroupInfoPatch{Name: &name})
}

// Mute: tắt thông báo tới until (RFC3339), "forever" = vĩnh viễn, null / quá khứ = bật lại.
func (s *Service) Mute(ctx context.Context, uid, convID int64, until *string) (*ConversationDTO, error) {
	var val any
	if until != nil && strings.TrimSpace(*until) != "" {
		u := strings.TrimSpace(*until)
		if u == "forever" {
			val = "infinity"
		} else {
			t, err := time.Parse(time.RFC3339Nano, u)
			if err != nil {
				return nil, errBad(`until phải là thời điểm RFC3339, "forever" hoặc null`)
			}
			if t.After(s.now()) {
				val = pgTime(t)
			}
		}
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	tag, err := p.Exec(ctx, `update chat_conversation_members set muted_until = $3::timestamptz, updated_at = now()
		where conversation_id = $1 and user_id = $2 and left_at is null`, convID, uid, val)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		if ro, err := readonlyDisbanded(ctx, p, uid, convID); err != nil || ro {
			if err == nil {
				err = errGroupDisbanded
			}
			return nil, err
		}
		return nil, errNotMember
	}
	s.forgetMembers(convID)
	return s.convFor(ctx, p, uid, convID, true)
}

// Messages: lịch sử tin (tăng dần theo seq). beforeSeq: các tin ngay trước seq đó (cuộn lên); afterSeq: các tin sau
// (đồng bộ / lấp chỗ hở); không có cả hai: limit tin mới nhất.
func (s *Service) Messages(ctx context.Context, uid, convID int64, beforeSeq, afterSeq *int64, limit int) (*MessagePage, error) {
	if beforeSeq != nil && afterSeq != nil {
		return nil, errBad("Chỉ dùng một trong before_seq / after_seq")
	}
	limit = clampLimit(limit)
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
	sql := msgSelect + `where m.conversation_id = $1 `
	args := []any{convID}
	asc := false
	switch {
	case beforeSeq != nil:
		sql += `and m.seq < $2 order by m.seq desc`
		args = append(args, *beforeSeq)
	case afterSeq != nil:
		sql += `and m.seq > $2 order by m.seq asc`
		args = append(args, *afterSeq)
		asc = true
	default:
		sql += `order by m.seq desc`
	}
	recs, err := msgQuery(ctx, p, sql+` limit `+strconv.Itoa(limit+1), args...)
	if err != nil {
		return nil, err
	}
	page := &MessagePage{}
	if len(recs) > limit {
		recs, page.HasMore = recs[:limit], true
	}
	if !asc {
		for i, j := 0, len(recs)-1; i < j; i, j = i+1, j-1 {
			recs[i], recs[j] = recs[j], recs[i]
		}
	}
	if page.Messages, err = s.msgDTOs(ctx, p, uid, recs, true); err != nil {
		return nil, err
	}
	return page, nil
}
