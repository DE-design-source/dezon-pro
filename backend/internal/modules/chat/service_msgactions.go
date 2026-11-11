package chat

import (
	"context"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
	apperr "qspro-backend/internal/shared/errors"
)

// Giai đoạn 2 - thao tác trên tin (API.md mục "Giai đoạn 2 ..."): trả lời (khung trích dẫn), sửa, thu hồi, chuyển tiếp,
// đồng bộ thay đổi (changes), nhảy tới tin (around_seq), và bộ dựng MessageDTO dùng chung cho mọi chế độ đọc tin.

// ───────────── Đọc tin -> MessageDTO ─────────────

// msgSelect: cột của một tin để dựng MessageDTO (m = chat_messages, u = người gửi); ghép thêm where / order / limit.
const msgSelect = `select m.id, m.conversation_id, m.seq, m.client_msg_id::text, m.sender_id, u.display_name, m.message_type,
	m.content, m.created_at, m.media_id, m.file_name, m.mentions::text, m.reply_to_message_id, m.is_forwarded, m.edited_at,
	m.recalled_at, m.recalled_by, m.updated_at
	from chat_messages m join chat_users u on u.id = m.sender_id `

// msgRec: một dòng của msgSelect.
type msgRec struct {
	d          MessageDTO // khoá cơ bản (id, conversation_id, seq, client_msg_id, sender, msg_type, content, created_at)
	mediaID    *int64
	fileName   *string
	mentions   *string
	replyID    *int64
	forwarded  bool
	editedAt   *time.Time
	recalledAt *time.Time
	recalledBy *int64
	updatedAt  *time.Time
}

func msgQuery(ctx context.Context, q querier, sql string, args ...any) ([]*msgRec, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*msgRec
	for rows.Next() {
		r := &msgRec{}
		var at time.Time
		if err := rows.Scan(&r.d.ID, &r.d.ConversationID, &r.d.Seq, &r.d.ClientMsgID, &r.d.SenderID, &r.d.SenderName, &r.d.MsgType,
			&r.d.Content, &at, &r.mediaID, &r.fileName, &r.mentions, &r.replyID, &r.forwarded, &r.editedAt,
			&r.recalledAt, &r.recalledBy, &r.updatedAt); err != nil {
			return nil, err
		}
		r.d.CreatedAt = iso(at)
		out = append(out, r)
	}
	return out, rows.Err()
}

// msgDTOs: dựng MessageDTO theo đúng thứ tự recs: tệp (URL ký), @nhắc tên, khung trích dẫn (bản mới nhất của tin gốc),
// nhãn sửa / chuyển tiếp; tin đã thu hồi chỉ còn recalled / recalled_by (content rỗng, không tệp / nhắc tên / trích dẫn /
// edited_at, forwarded false). withReactions: kèm tổng hợp reaction nhìn từ uid (chỉ tin có reaction).
func (s *Service) msgDTOs(ctx context.Context, q querier, uid int64, recs []*msgRec, withReactions bool) ([]MessageDTO, error) {
	out := make([]MessageDTO, 0, len(recs))
	var ids, mediaIDs, replyIDs []int64
	for _, r := range recs {
		if r.recalledAt != nil {
			continue
		}
		ids = append(ids, r.d.ID)
		if r.mediaID != nil {
			mediaIDs = append(mediaIDs, *r.mediaID)
		}
		if r.replyID != nil {
			replyIDs = append(replyIDs, *r.replyID)
		}
	}
	mds, err := s.mediaDTOs(ctx, q, mediaIDs)
	if err != nil {
		return nil, err
	}
	previews, err := s.replyPreviews(ctx, q, replyIDs)
	if err != nil {
		return nil, err
	}
	var reacts map[int64]*ReactionSummaryDTO
	if withReactions && len(ids) > 0 {
		if reacts, err = s.reactionSummaries(ctx, q, uid, ids); err != nil {
			return nil, err
		}
	}
	for _, r := range recs {
		d := r.d
		if r.recalledAt != nil {
			d.Content, d.Recalled, d.RecalledBy = "", true, r.recalledBy
			out = append(out, d)
			continue
		}
		d.Forwarded, d.EditedAt = r.forwarded, isoPtr(r.editedAt)
		if r.mentions != nil {
			d.Mentions = parseMentions([]byte(*r.mentions))
		}
		if d.Attachments, err = s.msgMedia(ctx, r.mediaID, r.fileName, mds); err != nil {
			return nil, err
		}
		if r.replyID != nil {
			d.ReplyTo = previews[*r.replyID]
		}
		if reacts != nil {
			d.Reactions = reacts[d.ID]
		}
		out = append(out, d)
	}
	return out, nil
}

// msgOne: một tin (kèm reactions nhìn từ uid) - kết quả sửa / thu hồi. Không kiểm quyền (người gọi đã kiểm).
func (s *Service) msgOne(ctx context.Context, uid, messageID int64) (*MessageDTO, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	recs, err := msgQuery(ctx, p, msgSelect+`where m.id = $1`, messageID)
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, errMessageNotFound
	}
	ds, err := s.msgDTOs(ctx, p, uid, recs, true)
	if err != nil {
		return nil, err
	}
	return &ds[0], nil
}

// ───────────── Trả lời ─────────────

// replyPreviews: khung trích dẫn của các tin ids (tin không còn -> vắng trong map). Dựng lúc đọc nên luôn là bản mới nhất:
// tin gốc sửa thì đổi theo, thu hồi thì recalled = true, content rỗng, không file_name. Content = văn bản thuần (không
// mentions) cắt khoảng trắng, tối đa replySnippetRunes ký tự; FileName chỉ tin file.
func (s *Service) replyPreviews(ctx context.Context, q querier, ids []int64) (map[int64]*ReplyPreviewDTO, error) {
	out := map[int64]*ReplyPreviewDTO{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `select m.id, m.seq, m.sender_id, u.display_name, m.message_type, m.content, m.file_name,
			m.recalled_at is not null
		from chat_messages m join chat_users u on u.id = m.sender_id where m.id = any($1::bigint[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		p := &ReplyPreviewDTO{}
		var fileName *string
		if err := rows.Scan(&p.MessageID, &p.Seq, &p.SenderID, &p.SenderName, &p.MsgType, &p.Content, &fileName, &p.Recalled); err != nil {
			return nil, err
		}
		if p.Recalled {
			p.Content = ""
		} else {
			p.Content = truncRunes(strings.TrimSpace(p.Content), replySnippetRunes)
			if p.MsgType == MediaFile {
				p.FileName = fileName
			}
		}
		out[p.MessageID] = p
	}
	return out, rows.Err()
}

// replyTargetTx (trong transaction gửi tin, đã khoá dòng hội thoại): tin được trả lời phải cùng hội thoại (khác / không có
// -> 404), không phải tin hệ thống (400), chưa thu hồi (410). Trả khung trích dẫn.
func (s *Service) replyTargetTx(ctx context.Context, q querier, convID, messageID int64) (*ReplyPreviewDTO, error) {
	var typ string
	var recalled bool
	err := q.QueryRow(ctx, `select message_type, recalled_at is not null from chat_messages where id = $1 and conversation_id = $2`,
		messageID, convID).Scan(&typ, &recalled)
	if noRows(err) {
		return nil, errMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	if typ == "system" {
		return nil, errBad("Không trả lời được tin hệ thống")
	}
	if recalled {
		return nil, errMessageRecalled
	}
	ps, err := s.replyPreviews(ctx, q, []int64{messageID})
	if err != nil {
		return nil, err
	}
	return ps[messageID], nil
}

// ───────────── Sửa / thu hồi ─────────────

// msgTarget: tin đang thao tác + hội thoại của nó nhìn từ người thao tác.
type msgTarget struct {
	conv      convRef
	role      string // vai trò hiện tại của người thao tác
	st        GroupSettingsDTO
	senderID  int64
	typ       string
	content   string
	mentions  *string
	createdAt time.Time
	recalled  bool
}

// msgLockTx: khoá dòng hội thoại của tin (tuần tự với gửi tin / ghim / sửa / thu hồi khác) rồi dòng tin. Không có tin hoặc
// uid chưa từng ở hội thoại đó -> 404 (không lộ tin tồn tại); dòng chỉ đọc của nhóm đã giải tán -> 410; đã rời -> 403.
func msgLockTx(ctx context.Context, tx pgx.Tx, uid, messageID int64) (*msgTarget, error) {
	var convID int64
	err := tx.QueryRow(ctx, `select conversation_id from chat_messages where id = $1`, messageID).Scan(&convID)
	if noRows(err) {
		return nil, errMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	t := &msgTarget{}
	var active, readonly bool
	err = tx.QueryRow(ctx, `select c.conversation_type, c.name, m.left_at is null, m.member_role,
			c.is_admin_only_send, c.is_admin_only_info, c.is_admin_only_add,
			c.disbanded_at is not null and m.left_at = c.disbanded_at
		from chat_conversations c
		join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
		where c.id = $1 for update of c`, convID, uid).Scan(&t.conv.typ, &t.conv.name, &active, &t.role,
		&t.st.AdminsOnlySend, &t.st.AdminsOnlyEditInfo, &t.st.AdminsOnlyAddMembers, &readonly)
	if noRows(err) {
		return nil, errMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	t.conv.id = convID
	if readonly {
		return nil, errGroupDisbanded
	}
	if !active {
		return nil, errNotMember
	}
	err = tx.QueryRow(ctx, `select sender_id, message_type, content, mentions::text, created_at, recalled_at is not null
		from chat_messages where id = $1 for update`, messageID).Scan(&t.senderID, &t.typ, &t.content, &t.mentions, &t.createdAt, &t.recalled)
	if noRows(err) {
		return nil, errMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	return t, nil
}

// msgTouchConvTx: đẩy chat_conversations.updated_at (để /sync trả hội thoại có tin vừa đổi).
func msgTouchConvTx(ctx context.Context, tx pgx.Tx, convID int64) error {
	_, err := tx.Exec(ctx, `update chat_conversations set updated_at = clock_timestamp() where id = $1`, convID)
	return err
}

// msgPinsIfPinnedTx: danh sách ghim của hội thoại nếu tin messageID đang được ghim (nil = không ghim).
func msgPinsIfPinnedTx(ctx context.Context, tx pgx.Tx, convID, messageID int64) (*PinList, error) {
	var pinned bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from chat_pinned_messages where conversation_id = $1 and message_id = $2)`,
		convID, messageID).Scan(&pinned); err != nil || !pinned {
		return nil, err
	}
	return listPins(ctx, tx, convID)
}

// EditMessage (PATCH /messages/:message_id): người gửi sửa tin văn bản của mình trong msgActionWindow. Content / mentions
// kiểm như message.send; như cũ -> trả tin, không ghi, không gói. Có đổi: ghi content, mentions, edited_at, updated_at
// (+ chat_conversations.updated_at) trong một transaction; người MỚI được nhắc có last_mention_seq nâng lên seq của tin.
// Không push, không tin hệ thống. Sau commit: message.updated {action: "edit"} (+ pins.updated nếu tin đang ghim).
func (s *Service) EditMessage(ctx context.Context, uid, messageID int64, in EditInput) (*MessageDTO, error) {
	if messageID <= 0 {
		return nil, errMessageNotFound
	}
	content := strings.TrimSpace(in.Content)
	mentions := shiftMentions(in.Mentions, in.Content, content)
	if content == "" {
		return nil, errBad("Tin nhắn trống")
	}
	if utf8.RuneCountInString(content) > maxContent || strings.ContainsRune(content, 0) {
		return nil, errBad("Tin nhắn tối đa 4000 ký tự")
	}
	if !s.editLimit.allow(uid) {
		return nil, errActionRateLimit
	}
	var changed bool
	var pins *PinList
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		t, err := msgLockTx(ctx, tx, uid, messageID)
		if err != nil {
			return err
		}
		if t.senderID != uid {
			return errForbidden("Bạn chỉ sửa được tin nhắn của mình")
		}
		if t.recalled {
			return errMessageRecalled
		}
		if t.typ != "text" {
			return errBad("Chỉ sửa được tin nhắn văn bản")
		}
		if s.now().Sub(t.createdAt) > msgActionWindow {
			return errEditTooOld
		}
		if t.conv.typ == "group" && !canDo(t.role, t.st, ActSend) {
			return errForbidden("Chỉ trưởng / phó nhóm được gửi tin trong nhóm này")
		}
		if t.conv.typ == "direct" {
			blocked, err := msgBlocked(ctx, tx, t.conv.id, uid)
			if err != nil {
				return err
			}
			if blocked {
				return errBlocked("Không thể nhắn tin với người này")
			}
		}
		ms, err := checkMentions(t.conv.typ, "text", content, mentions)
		if err != nil {
			return err
		}
		ms, all, users, err := resolveMentions(ctx, tx, t.conv.id, uid, t.role, t.st, ms)
		if err != nil {
			return err
		}
		var old []Mention
		if t.mentions != nil {
			old = parseMentions([]byte(*t.mentions))
		}
		if content == t.content && mentionsArg(ms) == mentionsArg(old) {
			return nil
		}
		changed = true
		var seq int64
		if err := tx.QueryRow(ctx, `update chat_messages set content = $2, mentions = $3::jsonb, edited_at = clock_timestamp(),
			updated_at = clock_timestamp() where id = $1 returning seq`, messageID, content, mentionsArg(ms)).Scan(&seq); err != nil {
			return err
		}
		if err := msgTouchConvTx(ctx, tx, t.conv.id); err != nil {
			return err
		}
		// dấu '@' chưa đọc chỉ cho người MỚI được nhắc (không hạ của người bị bỏ nhắc)
		oldAll, oldNamed := false, map[int64]bool{}
		for _, x := range old {
			if x.UserID == MentionAll {
				oldAll = true
			} else {
				oldNamed[x.UserID] = true
			}
		}
		var fresh []int64
		for _, id := range users {
			if !oldNamed[id] {
				fresh = append(fresh, id)
			}
		}
		switch {
		case oldAll: // cả nhóm đã được nhắc từ trước
		case all:
			_, err = tx.Exec(ctx, `update chat_conversation_members set last_mention_seq = greatest(last_mention_seq, $2)
				where conversation_id = $1 and left_at is null and user_id <> $3`, t.conv.id, seq, uid)
		case len(fresh) > 0:
			_, err = tx.Exec(ctx, `update chat_conversation_members set last_mention_seq = greatest(last_mention_seq, $2)
				where conversation_id = $1 and left_at is null and user_id = any($3::bigint[])`, t.conv.id, seq, fresh)
		}
		if err != nil {
			return err
		}
		pins, err = msgPinsIfPinnedTx(ctx, tx, t.conv.id, messageID)
		return err
	})
	if err != nil {
		return nil, err
	}
	d, err := s.msgOne(ctx, uid, messageID)
	if err != nil {
		return nil, err
	}
	if changed {
		ev := *d
		ev.Reactions = nil
		s.broadcastMessageUpdated(MessageUpdatedEvent{ConversationID: d.ConversationID, Action: ActionEdit, Message: ev})
		if pins != nil {
			s.broadcastPins(pins)
		}
	}
	return d, nil
}

// RecallMessage (POST /messages/:message_id/recall): thu hồi = XOÁ thật nội dung, @nhắc tên, tệp, tên tệp của tin (một
// transaction, khoá dòng hội thoại), xoá reaction, bỏ ghim. Người gửi: tin của mình trong msgActionWindow (cả khi bị chặn /
// admins_only_send). Kiểm duyệt nhóm (không giới hạn thời gian): trưởng nhóm - tin của mọi người; phó nhóm - tin của người
// đang là member hoặc đã rời. Đã thu hồi -> trả lại tin (idempotent). Sau commit: message.updated {action: "recall"}
// (+ pins.updated nếu vừa bỏ ghim). Không push, không tin hệ thống.
func (s *Service) RecallMessage(ctx context.Context, uid, messageID int64) (*MessageDTO, error) {
	if messageID <= 0 {
		return nil, errMessageNotFound
	}
	if !s.editLimit.allow(uid) {
		return nil, errActionRateLimit
	}
	var changed bool
	var pins *PinList
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		t, err := msgLockTx(ctx, tx, uid, messageID)
		if err != nil {
			return err
		}
		if t.recalled {
			return nil
		}
		if t.typ == "system" {
			return errBad("Không thu hồi được tin hệ thống")
		}
		if t.senderID == uid {
			if s.now().Sub(t.createdAt) > msgActionWindow {
				return errRecallTooOld
			}
		} else {
			if t.conv.typ != "group" {
				return errForbidden("Bạn chỉ thu hồi được tin của mình")
			}
			switch t.role {
			case "owner":
			case "admin":
				sr, err := activeRole(ctx, tx, t.conv.id, t.senderID)
				if err != nil {
					return err
				}
				if sr != "" && sr != "member" {
					return errForbidden("Bạn không có quyền thu hồi tin này")
				}
			default:
				return errForbidden("Bạn chỉ thu hồi được tin của mình")
			}
		}
		if _, err := tx.Exec(ctx, `update chat_messages set content = '', mentions = null, media_id = null, file_name = null,
			recalled_at = clock_timestamp(), recalled_by = $2, updated_at = clock_timestamp() where id = $1`, messageID, uid); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from chat_message_reactions where message_id = $1`, messageID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `delete from chat_pinned_messages where conversation_id = $1 and message_id = $2`, t.conv.id, messageID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			if pins, err = listPins(ctx, tx, t.conv.id); err != nil {
				return err
			}
		}
		changed = true
		return msgTouchConvTx(ctx, tx, t.conv.id)
	})
	if err != nil {
		return nil, err
	}
	d, err := s.msgOne(ctx, uid, messageID)
	if err != nil {
		return nil, err
	}
	if changed {
		ev := *d
		ev.Reactions = nil
		s.broadcastMessageUpdated(MessageUpdatedEvent{ConversationID: d.ConversationID, Action: ActionRecall, Message: ev})
		if pins != nil {
			s.broadcastPins(pins)
		}
	}
	return d, nil
}

// broadcastMessageUpdated: message.updated tới mọi thiết bị của thành viên đang hoạt động (kể cả các thiết bị khác của người
// thao tác), qua bộ chạy tuần tự theo hội thoại (đúng thứ tự với message.new).
func (s *Service) broadcastMessageUpdated(ev MessageUpdatedEvent) {
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
		s.sendTo(to, EvMessageUpdated, ev)
	}
	g := s.gateway()
	if g == nil {
		job()
		return
	}
	if !g.Submit(ev.ConversationID, job) {
		logger.Error("chat", "hàng đợi phân phối đầy, bỏ message.updated của hội thoại", ev.ConversationID)
	}
}

// ───────────── Chuyển tiếp ─────────────

// forwardSrc: tin nguồn của một lần chuyển tiếp.
type forwardSrc struct {
	id           int64
	typ, content string
	mediaID      *int64
	fileName     *string
}

// forwardSource: tin nguồn phải đọc được (thành viên đang hoạt động / dòng chỉ đọc của nhóm đã giải tán; chưa từng ở hội
// thoại -> 404, đã rời -> 403), không phải tin hệ thống, chưa thu hồi.
func forwardSource(ctx context.Context, q querier, uid, messageID int64) (*forwardSrc, error) {
	var convID int64
	var recalled bool
	src := &forwardSrc{id: messageID}
	err := q.QueryRow(ctx, `select conversation_id, message_type, content, media_id, file_name, recalled_at is not null
		from chat_messages where id = $1`, messageID).Scan(&convID, &src.typ, &src.content, &src.mediaID, &src.fileName, &recalled)
	if noRows(err) {
		return nil, errMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	var visible bool
	err = q.QueryRow(ctx, `select `+convVisible+` from chat_conversation_members m join chat_conversations c on c.id = m.conversation_id
		where m.conversation_id = $1 and m.user_id = $2`, convID, uid).Scan(&visible)
	if noRows(err) {
		return nil, errMessageNotFound
	}
	if err != nil {
		return nil, err
	}
	if !visible {
		return nil, errNotMember
	}
	if src.typ == "system" {
		return nil, errBad("Không chuyển tiếp được tin hệ thống")
	}
	if recalled {
		return nil, errMessageRecalled
	}
	return src, nil
}

// forwardMediaTx: khoá (for share - janitor bỏ qua) tệp của tin nguồn để dùng lại ở tin mới (không cần là người tải lên:
// quyền đọc tin nguồn đã kiểm); máy chủ tắt tệp -> MEDIA_DISABLED; tệp phải ready.
func (s *Service) forwardMediaTx(ctx context.Context, tx pgx.Tx, mediaID int64) (*MediaDTO, error) {
	if s.media == nil {
		return nil, errMediaDisabled
	}
	r, err := scanMedia(tx.QueryRow(ctx, `select `+mediaCols+` from chat_media where id = $1 for share`, mediaID))
	if noRows(err) {
		return nil, errMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	if r.status != mediaReady {
		return nil, errMediaNotReady
	}
	return s.buildDTO(ctx, r, strDeref(r.fileName), false)
}

// forwardOne: một đích = một tin mới (transaction riêng), kiểm như message.send của đích; gửi lại cùng client_msg_id -> ack
// của tin cũ (duplicate).
func (s *Service) forwardOne(ctx context.Context, uid int64, src *forwardSrc, t ForwardTarget) (*SendAck, error) {
	var ack *SendAck
	var msg *msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		g, dup, err := msgGateTx(ctx, tx, uid, t.ConversationID, t.ClientMsgID)
		if err != nil || dup != nil {
			ack = dup
			return err
		}
		// đọc lại tin nguồn có khoá (for share): thu hồi commit sau forwardSource thì không chép nội dung / tệp đã xoá.
		// Thứ tự khoá hội thoại đích -> tin nguồn; thu hồi khoá hội thoại nguồn -> tin, không lấy khoá hội thoại đích.
		var recalled bool
		if err := tx.QueryRow(ctx, `select recalled_at is not null, content, media_id, file_name from chat_messages
			where id = $1 for share`, src.id).Scan(&recalled, &src.content, &src.mediaID, &src.fileName); err != nil {
			if noRows(err) {
				return errMessageNotFound
			}
			return err
		}
		if recalled {
			return errMessageRecalled
		}
		var md *MediaDTO
		if src.mediaID != nil {
			if md, err = s.forwardMediaTx(ctx, tx, *src.mediaID); err != nil {
				return err
			}
			if err = s.fileNamed(ctx, md, deref(src.fileName)); err != nil {
				return err
			}
		}
		cid := t.ClientMsgID
		if msg, err = msgInsertTx(ctx, tx, g.conv, uid, g.sender, src.typ, src.content, &cid, src.mediaID, src.fileName, nil, nil, true); err != nil {
			return err
		}
		msg.media = md
		return nil
	})
	if isUnique(err, uqClientMsg) || (err == nil && ack != nil) {
		p, perr := s.pool()
		if perr != nil {
			return nil, perr
		}
		if ack == nil {
			if ack, err = findSent(ctx, p, t.ConversationID, uid, t.ClientMsgID); err == nil && ack == nil {
				err = errBad("Không tìm thấy tin vừa gửi")
			}
			if err != nil {
				return nil, err
			}
		}
		return ack, s.ackMedia(ctx, p, ack)
	}
	if isFK(err, "fk_chat_messages_media_id") {
		return nil, errMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	s.dispatch(msg, nil)
	return msgAck(msg), nil
}

// forwardErr: lỗi của một đích -> {code, message} như REST; lỗi khác (database...) ghi log, trả INTERNAL.
func forwardErr(err error) *ForwardError {
	var ae *apperr.AppError
	if errors.As(err, &ae) {
		code := ae.Code
		if code == "" {
			code = CodeInternal
		}
		return &ForwardError{Code: code, Message: ae.Msg}
	}
	logger.Error("chat", "chuyển tiếp tin lỗi:", err.Error())
	return &ForwardError{Code: CodeInternal, Message: "Lỗi máy chủ, thử lại sau"}
}

// ForwardMessage (POST /messages/:message_id/forward): chuyển tiếp tin nguồn tới 1..maxForwardTargets hội thoại. Mỗi đích là
// một tin mới cùng msg_type / content / file_name / media_id (dùng chung tệp, không tải lại), is_forwarded = true, không
// mentions / reply_to; lỗi của một đích không chặn đích khác. Mỗi đích tốn 1 lượt sendLimit (hết -> RATE_LIMIT cho các
// đích còn lại). Kết quả theo đúng thứ tự targets.
func (s *Service) ForwardMessage(ctx context.Context, uid, messageID int64, in ForwardInput) (*ForwardResult, error) {
	if len(in.Targets) == 0 || len(in.Targets) > maxForwardTargets {
		return nil, errBad("Chọn từ 1 đến 20 cuộc trò chuyện")
	}
	targets := make([]ForwardTarget, len(in.Targets))
	seen := map[int64]bool{}
	for i, t := range in.Targets {
		if t.ConversationID <= 0 {
			return nil, errBad("Thiếu conversation_id")
		}
		if seen[t.ConversationID] {
			return nil, errBad("Mỗi cuộc trò chuyện chỉ chọn một lần")
		}
		seen[t.ConversationID] = true
		t.ClientMsgID = strings.ToLower(strings.TrimSpace(t.ClientMsgID))
		if !reUUID.MatchString(t.ClientMsgID) {
			return nil, errBad("client_msg_id phải là UUID")
		}
		targets[i] = t
	}
	if messageID <= 0 {
		return nil, errMessageNotFound
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	src, err := forwardSource(ctx, p, uid, messageID)
	if err != nil {
		return nil, err
	}
	res := &ForwardResult{Results: make([]ForwardItemResult, 0, len(targets))}
	limited := false
	for _, t := range targets {
		r := ForwardItemResult{ConversationID: t.ConversationID}
		var ack *SendAck
		if !limited && !s.sendLimit.allow(uid) {
			limited = true
		}
		if limited {
			err = errSendRateLimit
		} else {
			ack, err = s.forwardOne(ctx, uid, src, t)
		}
		if err != nil {
			r.Error = forwardErr(err)
		} else {
			r.OK, r.Ack = true, ack
		}
		res.Results = append(res.Results, r)
	}
	return res, nil
}

// ───────────── Đồng bộ thay đổi / nhảy tới tin ─────────────

// changesEncodeCursor: next_cursor của GET .../messages/changes = base64url "u<updated_at micro giây>:<id>".
func changesEncodeCursor(at time.Time, id int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte("u" + strconv.FormatInt(at.UnixMicro(), 10) + ":" + strconv.FormatInt(id, 10)))
}

// changesDecodeCursor: sai dạng -> BAD_REQUEST.
func changesDecodeCursor(s string) (time.Time, int64, error) {
	bad := errBad("cursor không hợp lệ")
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, 0, bad
	}
	head, idStr, ok := strings.Cut(string(b), ":")
	if !ok || !strings.HasPrefix(head, "u") {
		return time.Time{}, 0, bad
	}
	us, err := strconv.ParseInt(head[1:], 10, 64)
	if err != nil {
		return time.Time{}, 0, bad
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return time.Time{}, 0, bad
	}
	return time.UnixMicro(us).UTC(), id, nil
}

// MessageChanges (GET /conversations/:id/messages/changes): tin đã sửa / thu hồi / đổi reaction (updated_at) sau mốc, cũ
// trước theo (updated_at, id). cursor (next_cursor của trang trước) thắng since (sync_cursor mili giây, trừ syncOverlap như
// /sync); thiếu cả hai / sai dạng -> 400. Kèm reactions như GET .../messages.
func (s *Service) MessageChanges(ctx context.Context, uid, convID int64, since, cursor string, limit int) (*MessageChangesPage, error) {
	if limit <= 0 {
		limit = defaultChangesLimit
	}
	limit = min(limit, maxChangesLimit)
	sql := msgSelect + `where m.conversation_id = $1 and m.updated_at is not null `
	args := []any{convID}
	switch {
	case strings.TrimSpace(cursor) != "":
		at, id, err := changesDecodeCursor(strings.TrimSpace(cursor))
		if err != nil {
			return nil, err
		}
		sql += `and (m.updated_at, m.id) > ($2::timestamptz, $3::bigint) `
		args = append(args, pgTime(at), id)
	case strings.TrimSpace(since) != "":
		t, err := parseSyncCursor(since)
		if err != nil {
			return nil, err
		}
		sql += `and m.updated_at >= $2::timestamptz `
		args = append(args, pgTime(t.Add(-syncOverlap)))
	default:
		return nil, errBad("Thiếu since hoặc cursor")
	}
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
	recs, err := msgQuery(ctx, p, sql+`order by m.updated_at, m.id limit `+strconv.Itoa(limit+1), args...)
	if err != nil {
		return nil, err
	}
	page := &MessageChangesPage{}
	if len(recs) > limit {
		recs = recs[:limit]
		last := recs[limit-1]
		nc := changesEncodeCursor(*last.updatedAt, last.d.ID)
		page.NextCursor = &nc
	}
	if page.Messages, err = s.msgDTOs(ctx, p, uid, recs, true); err != nil {
		return nil, err
	}
	return page, nil
}

// MessagesAround (GET /conversations/:id/messages?around_seq=): tin seq từ S - floor(limit/2) (S = aroundSeq kẹp về last_seq)
// tăng dần, tối đa limit, gồm S; has_more = còn tin cũ hơn, has_newer = còn tin mới hơn.
func (s *Service) MessagesAround(ctx context.Context, uid, convID, aroundSeq int64, limit int) (*MessagePage, error) {
	if aroundSeq <= 0 {
		return nil, errBad("around_seq phải lớn hơn 0")
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
	var last int64
	if err := p.QueryRow(ctx, `select last_seq from chat_conversations where id = $1`, convID).Scan(&last); err != nil {
		return nil, err
	}
	start := max(min(aroundSeq, last)-int64(limit/2), 1)
	recs, err := msgQuery(ctx, p, msgSelect+`where m.conversation_id = $1 and m.seq >= $2 order by m.seq limit `+strconv.Itoa(limit+1),
		convID, start)
	if err != nil {
		return nil, err
	}
	newer := len(recs) > limit
	if newer {
		recs = recs[:limit]
	}
	page := &MessagePage{HasNewer: &newer}
	if err := p.QueryRow(ctx, `select exists (select 1 from chat_messages where conversation_id = $1 and seq < $2)`,
		convID, start).Scan(&page.HasMore); err != nil {
		return nil, err
	}
	if page.Messages, err = s.msgDTOs(ctx, p, uid, recs, true); err != nil {
		return nil, err
	}
	return page, nil
}
