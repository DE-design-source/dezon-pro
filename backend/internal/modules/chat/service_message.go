package chat

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"qspro-backend/internal/platform/logger"
)

// Gửi tin, chống trùng, cấp seq, phân phối, đã nhận / đã xem, cache thành viên (CHAT.md 8, 9, 10).

const maxContent = 4000

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

const uqClientMsg = "uq_chat_messages_conversation_id_sender_id_client_msg_id"

// convRef: hội thoại của một tin (tiêu đề push).
type convRef struct {
	id   int64
	typ  string
	name *string
}

// msgRow: tin vừa lưu, chờ phân phối.
type msgRow struct {
	conv       convRef
	id, seq    int64
	senderID   int64
	senderName string
	clientID   *string
	typ        string
	content    string
	createdAt  time.Time
	mediaID    *int64           // chat_messages.media_id (tin image / video / file / voice)
	fileName   *string          // chat_messages.file_name (tin file)
	media      *MediaDTO        // tệp đính kèm đã dựng (FileName = tên của tin), nil với text / system
	mentions   []Mention        // chat_messages.mentions đã chuẩn hoá (nil = không nhắc ai)
	replyTo    *ReplyPreviewDTO // tin được trả lời (giai đoạn 2), nil = không trả lời
	forwarded  bool             // chat_messages.is_forwarded
}

func (m *msgRow) dto() MessageDTO {
	d := MessageDTO{ID: m.id, ConversationID: m.conv.id, Seq: m.seq, ClientMsgID: m.clientID, SenderID: m.senderID,
		SenderName: m.senderName, MsgType: m.typ, Content: m.content, CreatedAt: iso(m.createdAt), Mentions: m.mentions,
		ReplyTo: m.replyTo, Forwarded: m.forwarded}
	if m.media != nil {
		d.Attachments = []MediaDTO{*m.media}
	}
	return d
}

// ───────────── @nhắc tên (API.md mục "Quản trị nhóm" - Định dạng @nhắc tên) ─────────────

// utf16Len: số đơn vị UTF-16 của s (độ dài chuỗi JavaScript).
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// shiftMentions: client có thể tính offset trên content CHƯA cắt khoảng trắng -> trừ số đơn vị UTF-16 đã cắt ở đầu.
// raw = content gốc, trimmed = strings.TrimSpace(raw).
func shiftMentions(ms []Mention, raw, trimmed string) []Mention {
	if len(ms) == 0 || trimmed == "" {
		return ms
	}
	lead := utf16Len(raw[:strings.Index(raw, trimmed)])
	if lead == 0 {
		return ms
	}
	out := make([]Mention, len(ms))
	for i, x := range ms {
		x.Offset -= lead
		out[i] = x
	}
	return out
}

// checkMentions: luật kiểm thuần (không DB) theo thứ tự của hợp đồng: chỉ nhóm, không với tin thoại, tối đa 50, từng
// phần tử hợp lệ (user_id >= 0, offset >= 0, length >= 2, nằm trong content, bắt đầu bằng '@'), sắp theo offset, không
// chồng nhau. Trả bản sao đã sắp; rỗng -> nil.
func checkMentions(convType, msgType, content string, ms []Mention) ([]Mention, error) {
	if len(ms) == 0 {
		return nil, nil
	}
	if convType != "group" {
		return nil, errBad("Chỉ nhắc tên được trong nhóm")
	}
	if msgType == MediaVoice {
		return nil, errBad("Tin nhắn thoại không nhắc tên được")
	}
	if len(ms) > maxMentions {
		return nil, errBad("Tối đa 50 lượt nhắc tên mỗi tin")
	}
	u := utf16.Encode([]rune(content))
	bad := errBad("Vị trí nhắc tên không hợp lệ")
	out := make([]Mention, len(ms))
	copy(out, ms)
	for _, x := range out {
		if x.UserID < 0 || x.Offset < 0 || x.Length < 2 || x.Offset >= len(u) || x.Length > len(u)-x.Offset || u[x.Offset] != '@' {
			return nil, bad
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Offset < out[j].Offset })
	for i := 1; i < len(out); i++ {
		if out[i-1].Offset+out[i-1].Length > out[i].Offset {
			return nil, bad
		}
	}
	return out, nil
}

// resolveMentions (trong transaction gửi tin): @Tất cả chỉ owner / admin (member -> 403); bỏ phần tử nhắc chính người
// gửi hoặc người không còn là thành viên đang hoạt động. Trả danh sách còn lại (nil nếu rỗng), có @Tất cả không, và
// id những người được nhắc đích danh (đã khử trùng).
func resolveMentions(ctx context.Context, q querier, convID, uid int64, role string, st GroupSettingsDTO, ms []Mention) ([]Mention, bool, []int64, error) {
	if len(ms) == 0 {
		return nil, false, nil, nil
	}
	all := false
	var ids []int64
	seen := map[int64]bool{}
	for _, x := range ms {
		if x.UserID == MentionAll {
			all = true
		} else if x.UserID != uid && !seen[x.UserID] {
			seen[x.UserID] = true
			ids = append(ids, x.UserID)
		}
	}
	if all && !canDo(role, st, ActMentionAll) {
		return nil, false, nil, errForbidden("Chỉ trưởng / phó nhóm được nhắc cả nhóm")
	}
	active := map[int64]bool{}
	if len(ids) > 0 {
		rows, err := q.Query(ctx, `select user_id from chat_conversation_members
			where conversation_id = $1 and left_at is null and user_id = any($2::bigint[])`, convID, ids)
		if err != nil {
			return nil, false, nil, err
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, false, nil, err
			}
			active[id] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, false, nil, err
		}
	}
	var out []Mention
	var users []int64
	for _, x := range ms {
		if x.UserID == MentionAll || active[x.UserID] {
			out = append(out, x)
		}
	}
	for _, id := range ids {
		if active[id] {
			users = append(users, id)
		}
	}
	return out, all, users, nil
}

// parseMentions: đọc chat_messages.mentions (jsonb, NULL -> nil). Dùng cho mọi chỗ dựng Message từ DB.
func parseMentions(b []byte) []Mention {
	if len(b) == 0 {
		return nil
	}
	var ms []Mention
	if json.Unmarshal(b, &ms) != nil || len(ms) == 0 {
		return nil
	}
	return ms
}

// mentionsArg: tham số jsonb cho câu SQL (nil -> NULL).
func mentionsArg(ms []Mention) any {
	if len(ms) == 0 {
		return nil
	}
	b, _ := json.Marshal(ms)
	return string(b)
}

// msgMedia: tệp đính kèm của một tin từ kết quả mediaDTOs (bản sao; FileName = chat_messages.file_name của chính tin,
// chỉ tin file có). Tin không có tệp / tệp không đọc được -> nil.
func (s *Service) msgMedia(ctx context.Context, mediaID *int64, fileName *string, mds map[int64]*MediaDTO) ([]MediaDTO, error) {
	if mediaID == nil {
		return nil, nil
	}
	md := mds[*mediaID]
	if md == nil {
		return nil, nil
	}
	d := *md
	if err := s.fileNamed(ctx, &d, deref(fileName)); err != nil {
		return nil, err
	}
	return []MediaDTO{d}, nil
}

// fileNamed: đặt FileName theo tin; tin file ký lại url để Content-Disposition tải về đúng tên hiển thị.
func (s *Service) fileNamed(ctx context.Context, d *MediaDTO, name string) error {
	old := d.FileName
	d.FileName = name
	if d.Type != MediaFile || d.URL == "" || d.row == nil || name == old {
		return nil
	}
	nd, err := s.buildDTO(ctx, d.row, name, false)
	if err != nil {
		return err
	}
	d.URL, d.ExpiresAt = nd.URL, nd.ExpiresAt
	return nil
}

// insertMessageTx: cấp seq (khoá dòng hội thoại tới hết transaction = thứ tự trong hội thoại), lưu tin, đẩy con trỏ
// đã nhận / đã xem của người gửi lên seq đó. Dùng chung cho tin của người dùng và tin hệ thống (mediaID / fileName nil).
func insertMessageTx(ctx context.Context, tx pgx.Tx, c convRef, senderID int64, senderName, typ, content string, clientID *string,
	mediaID *int64, fileName *string) (*msgRow, error) {
	return insertMessageMentionsTx(ctx, tx, c, senderID, senderName, typ, content, clientID, mediaID, fileName, nil)
}

// insertMessageMentionsTx: như insertMessageTx, lưu kèm chat_messages.mentions (đã chuẩn hoá; nil = NULL).
func insertMessageMentionsTx(ctx context.Context, tx pgx.Tx, c convRef, senderID int64, senderName, typ, content string, clientID *string,
	mediaID *int64, fileName *string, mentions []Mention) (*msgRow, error) {
	return msgInsertTx(ctx, tx, c, senderID, senderName, typ, content, clientID, mediaID, fileName, mentions, nil, false)
}

// msgInsertTx: như insertMessageMentionsTx, lưu kèm reply_to_message_id (nil = không trả lời) và is_forwarded (giai đoạn 2).
func msgInsertTx(ctx context.Context, tx pgx.Tx, c convRef, senderID int64, senderName, typ, content string, clientID *string,
	mediaID *int64, fileName *string, mentions []Mention, replyTo *int64, forwarded bool) (*msgRow, error) {
	m := &msgRow{conv: c, senderID: senderID, senderName: senderName, clientID: clientID, typ: typ, content: content,
		mediaID: mediaID, fileName: fileName, mentions: mentions, forwarded: forwarded}
	var cid any
	if clientID != nil {
		cid = *clientID
	}
	// last_message_at không bao giờ lùi (đồng hồ máy chủ DB có thể bị chỉnh lùi): created_at luôn tăng theo seq trong hội thoại
	if err := tx.QueryRow(ctx, `with c as (
			update chat_conversations set last_seq = last_seq + 1,
				last_message_at = greatest(clock_timestamp(), last_message_at + interval '1 microsecond'), updated_at = clock_timestamp()
			where id = $1 returning id, last_seq, last_message_at)
		insert into chat_messages (conversation_id, seq, client_msg_id, sender_id, message_type, content, media_id, file_name, mentions,
			reply_to_message_id, is_forwarded, created_at)
		select c.id, c.last_seq, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9::bigint, $10::boolean, c.last_message_at from c
		returning id, seq, created_at`, c.id, cid, senderID, typ, content, mediaID, fileName, mentionsArg(mentions), replyTo, forwarded).
		Scan(&m.id, &m.seq, &m.createdAt); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `update chat_conversation_members set last_read_seq = greatest(last_read_seq, $3),
		last_delivered_seq = greatest(last_delivered_seq, $3), updated_at = clock_timestamp()
		where conversation_id = $1 and user_id = $2`, c.id, senderID, m.seq); err != nil {
		return nil, err
	}
	return m, nil
}

// validateSend: client_msg_id là UUID; theo msg_type (design mục 4):
//   - text: không tệp, không file_name, nội dung (đã cắt khoảng trắng) 1..4000 ký tự;
//   - image / video: đúng 1 tệp, chú thích 0..4000, không file_name;
//   - file: đúng 1 tệp, chú thích 0..4000, file_name tuỳ chọn (làm sạch, chặn đuôi .exe ...);
//   - voice: đúng 1 tệp, nội dung rỗng, không file_name;
//   - loại khác (kể cả system): BAD_REQUEST.
func validateSend(in *SendInput) error {
	if in.ConversationID <= 0 {
		return errBad("Thiếu conversation_id")
	}
	if in.ReplyToMessageID < 0 {
		return errBad("reply_to_message_id không hợp lệ")
	}
	in.ClientMsgID = strings.ToLower(strings.TrimSpace(in.ClientMsgID))
	if !reUUID.MatchString(in.ClientMsgID) {
		return errBad("client_msg_id phải là UUID")
	}
	raw := in.Content
	in.Content = strings.TrimSpace(in.Content)
	in.Mentions = shiftMentions(in.Mentions, raw, in.Content)
	if utf8.RuneCountInString(in.Content) > maxContent || strings.ContainsRune(in.Content, 0) {
		return errBad("Tin nhắn tối đa 4000 ký tự")
	}
	switch in.MsgType {
	case "text":
		if len(in.Attachments) > 0 {
			return errBad("Tin văn bản không kèm tệp")
		}
		if in.Content == "" {
			return errBad("Tin nhắn trống")
		}
	case MediaImage, MediaVideo, MediaFile, MediaVoice:
		if len(in.Attachments) != 1 || in.Attachments[0] <= 0 {
			return errBad("Tin này cần đúng 1 tệp đính kèm")
		}
		if in.MsgType == MediaVoice && in.Content != "" {
			return errBad("Tin nhắn thoại không kèm chữ")
		}
	default:
		return errBad("msg_type không hợp lệ (text / image / video / file / voice)")
	}
	if in.MsgType != MediaFile {
		if strings.TrimSpace(in.FileName) != "" {
			return errBad("file_name chỉ dùng cho tin tệp (msg_type = file)")
		}
		in.FileName = ""
		return nil
	}
	if strings.TrimSpace(in.FileName) != "" {
		in.FileName = sanitizeFileName(in.FileName)
		if deniedFileName(in.FileName) {
			return errMediaType
		}
	} else {
		in.FileName = ""
	}
	return nil
}

// isFK: lỗi vi phạm khoá ngoại (23503) của đúng ràng buộc constraint.
func isFK(err error, constraint string) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23503" && pe.ConstraintName == constraint
}

// SendMessage lưu tin (chống trùng theo client_msg_id) rồi phân phối bất đồng bộ; trả data của ack.
func (s *Service) SendMessage(ctx context.Context, uid int64, in SendInput) (*SendAck, error) {
	if err := validateSend(&in); err != nil {
		return nil, err
	}
	if !s.sendLimit.allow(uid) {
		return nil, errSendRateLimit
	}
	var ack *SendAck
	var msg *msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		g, dup, err := msgGateTx(ctx, tx, uid, in.ConversationID, in.ClientMsgID)
		if err != nil || dup != nil {
			ack = dup
			return err
		}
		c := g.conv
		mentions, err := checkMentions(c.typ, in.MsgType, in.Content, in.Mentions)
		if err != nil {
			return err
		}
		mentions, mentionAll, mentioned, err := resolveMentions(ctx, tx, c.id, uid, g.role, g.st, mentions)
		if err != nil {
			return err
		}
		var replyID *int64
		var reply *ReplyPreviewDTO
		if in.ReplyToMessageID > 0 {
			if reply, err = s.replyTargetTx(ctx, tx, c.id, in.ReplyToMessageID); err != nil {
				return err
			}
			id := in.ReplyToMessageID
			replyID = &id
		}
		var mediaID *int64
		var fileName *string
		var md *MediaDTO
		if in.MsgType != "text" {
			// khoá tệp tới hết transaction (janitor bỏ qua), kiểm chủ / ready / đúng loại
			if md, err = s.lockSendMedia(ctx, tx, uid, in.MsgType, in.Attachments); err != nil {
				return err
			}
			id := md.ID
			mediaID = &id
			if in.MsgType == MediaFile {
				name := in.FileName
				if name == "" {
					name = sanitizeFileName(md.FileName) // tên lúc tải lên (rỗng -> "tep")
				}
				fileName = &name
			}
			if err = s.fileNamed(ctx, md, deref(fileName)); err != nil {
				return err
			}
		}
		cid := in.ClientMsgID
		if msg, err = msgInsertTx(ctx, tx, c, uid, g.sender, in.MsgType, in.Content, &cid, mediaID, fileName, mentions, replyID, false); err != nil {
			return err
		}
		msg.media, msg.replyTo = md, reply
		// dấu '@' chưa đọc: last_mention_seq của người được nhắc (@Tất cả: mọi thành viên đang hoạt động trừ người gửi)
		if mentionAll {
			_, err = tx.Exec(ctx, `update chat_conversation_members set last_mention_seq = greatest(last_mention_seq, $2)
				where conversation_id = $1 and left_at is null and user_id <> $3`, c.id, msg.seq, uid)
		} else if len(mentioned) > 0 {
			_, err = tx.Exec(ctx, `update chat_conversation_members set last_mention_seq = greatest(last_mention_seq, $2)
				where conversation_id = $1 and left_at is null and user_id = any($3::bigint[])`, c.id, msg.seq, mentioned)
		}
		return err
	})
	if isUnique(err, uqClientMsg) { // gửi trùng song song: bản kia đã lưu trước
		p, perr := s.pool()
		if perr != nil {
			return nil, perr
		}
		if ack, err = findSent(ctx, p, in.ConversationID, uid, in.ClientMsgID); err == nil && ack == nil {
			err = errBad("Không tìm thấy tin vừa gửi")
		}
		if err != nil {
			return nil, err
		}
		return ack, s.ackMedia(ctx, p, ack)
	}
	if isFK(err, "fk_chat_messages_media_id") { // phòng thủ: tệp vừa bị janitor xoá
		return nil, errMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	if ack != nil { // gửi lại tin đã lưu: trả tin gốc (kể cả tệp gốc nếu lần này gửi tệp khác)
		p, perr := s.pool()
		if perr != nil {
			return nil, perr
		}
		return ack, s.ackMedia(ctx, p, ack)
	}
	s.dispatch(msg, nil)
	return msgAck(msg), nil
}

// msgAck: ack của tin vừa lưu.
func msgAck(msg *msgRow) *SendAck {
	a := &SendAck{ConversationID: msg.conv.id, ClientMsgID: msg.clientID, MessageID: msg.id, Seq: msg.seq,
		CreatedAt: iso(msg.createdAt), Mentions: msg.mentions, ReplyTo: msg.replyTo}
	if msg.media != nil {
		a.Attachments = []MediaDTO{*msg.media}
	}
	return a
}

// msgGate: hội thoại + người gửi sau khi qua cổng gửi tin (msgGateTx).
type msgGate struct {
	conv   convRef
	sender string // tên hiển thị của người gửi
	role   string // vai trò của người gửi trong hội thoại
	st     GroupSettingsDTO
}

// msgGateTx (trong transaction gửi tin / chuyển tiếp): khoá dòng hội thoại tới hết transaction (thứ tự seq); người gửi phải
// là thành viên đang hoạt động (dòng chỉ đọc của nhóm đã giải tán -> 410; đã rời / bị xoá trước đó hoặc đã gỡ nhóm khỏi
// danh sách -> 403 như REST); đã có tin cùng client_msg_id -> trả ack trùng (không kiểm tiếp); nhóm bật admins_only_send
// mà là member -> 403; chat 1-1 đang chặn (một trong hai bên) -> BLOCKED.
func msgGateTx(ctx context.Context, tx pgx.Tx, uid, convID int64, clientID string) (*msgGate, *SendAck, error) {
	g := &msgGate{}
	var active, readonly bool
	err := tx.QueryRow(ctx, `select c.conversation_type, c.name, m.left_at is null, u.display_name, m.member_role,
			c.is_admin_only_send, c.is_admin_only_info, c.is_admin_only_add,
			c.disbanded_at is not null and m.left_at = c.disbanded_at
		from chat_conversations c
		join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
		join chat_users u on u.id = m.user_id
		where c.id = $1 for update of c`, convID, uid).Scan(&g.conv.typ, &g.conv.name, &active, &g.sender, &g.role,
		&g.st.AdminsOnlySend, &g.st.AdminsOnlyEditInfo, &g.st.AdminsOnlyAddMembers, &readonly)
	if noRows(err) {
		return nil, nil, errNotMember
	}
	if err != nil {
		return nil, nil, err
	}
	g.conv.id = convID
	if readonly {
		return nil, nil, errGroupDisbanded
	}
	if !active {
		return nil, nil, errNotMember
	}
	ack, err := findSent(ctx, tx, convID, uid, clientID)
	if err != nil || ack != nil {
		return nil, ack, err
	}
	if g.conv.typ == "group" && !canDo(g.role, g.st, ActSend) {
		return nil, nil, errForbidden("Chỉ trưởng / phó nhóm được gửi tin trong nhóm này")
	}
	if g.conv.typ == "direct" {
		blocked, err := msgBlocked(ctx, tx, convID, uid)
		if err != nil {
			return nil, nil, err
		}
		if blocked {
			return nil, nil, errBlocked("Không thể nhắn tin với người này")
		}
	}
	return g, nil, nil
}

// msgBlocked: chat 1-1 convID mà uid và người kia có một bên chặn bên kia.
func msgBlocked(ctx context.Context, q querier, convID, uid int64) (bool, error) {
	var blocked bool
	err := q.QueryRow(ctx, `select exists(select 1 from chat_conversation_members x
		join chat_friendships f on f.status = 'blocked'
			and ((f.user_id = $2 and f.friend_id = x.user_id) or (f.user_id = x.user_id and f.friend_id = $2))
		where x.conversation_id = $1 and x.user_id <> $2)`, convID, uid).Scan(&blocked)
	return blocked, err
}

// ackMedia: điền attachments (tin đã lưu có tệp) và reply_to (tin trả lời) cho ack gửi trùng.
func (s *Service) ackMedia(ctx context.Context, q querier, a *SendAck) error {
	if a.ReplyTo != nil { // findSent chỉ điền message_id: dựng khung trích dẫn từ tin gốc (bản mới nhất)
		ps, err := s.replyPreviews(ctx, q, []int64{a.ReplyTo.MessageID})
		if err != nil {
			return err
		}
		a.ReplyTo = ps[a.ReplyTo.MessageID]
	}
	if a.mediaID == nil {
		return nil
	}
	mds, err := s.mediaDTOs(ctx, q, []int64{*a.mediaID})
	if err != nil {
		return err
	}
	a.Attachments, err = s.msgMedia(ctx, a.mediaID, a.fileName, mds)
	return err
}

// findSent: tin đã lưu với cùng (hội thoại, người gửi, client_msg_id) -> ack duplicate (kèm media_id / file_name để
// dựng attachments sau transaction); chưa có -> nil.
func findSent(ctx context.Context, q querier, convID, uid int64, clientID string) (*SendAck, error) {
	a := &SendAck{ConversationID: convID, Duplicate: true}
	var at time.Time
	var cid string
	var mentions []byte
	var replyID *int64
	err := q.QueryRow(ctx, `select id, seq, created_at, client_msg_id::text, media_id, file_name, mentions::text,
			case when recalled_at is null then reply_to_message_id end
		from chat_messages where conversation_id = $1 and sender_id = $2 and client_msg_id = $3::uuid`, convID, uid, clientID).
		Scan(&a.MessageID, &a.Seq, &at, &cid, &a.mediaID, &a.fileName, &mentions, &replyID)
	if noRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.CreatedAt, a.ClientMsgID, a.Mentions = iso(at), &cid, parseMentions(mentions)
	if replyID != nil { // ackMedia dựng khung trích dẫn đầy đủ
		a.ReplyTo = &ReplyPreviewDTO{MessageID: *replyID}
	}
	return a, nil
}

// dispatch: giao việc phân phối cho bộ chạy tuần tự theo hội thoại của gateway (thay Kafka, giữ thứ tự).
// Tin đã nằm trong DB: hàng đợi đầy / tiến trình chết giữa chừng thì client tự lấy lại qua seq hở + /sync.
// Không có gateway: chạy luôn (chỉ còn phần push).
func (s *Service) dispatch(m *msgRow, extra []int64) {
	if m == nil {
		return
	}
	job := func() { s.deliver(m, extra) }
	g := s.gateway()
	if g == nil {
		job()
		return
	}
	if !g.Submit(m.conv.id, job) {
		logger.Error("chat", "hàng đợi phân phối đầy, bỏ phân phối tin", m.id, "của hội thoại", m.conv.id)
	}
}

// deliver: message.new tới mọi thành viên đang hoạt động (+ extra: người vừa bị xoá / vừa rời, để họ thấy tin hệ
// thống), kể cả các kết nối khác của người gửi; thành viên không online và không tắt thông báo -> push.
func (s *Service) deliver(m *msgRow, extra []int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	mem, err := s.activeMembers(ctx, m.conv.id)
	if err != nil {
		logger.Error("chat", "đọc thành viên hội thoại", m.conv.id, "lỗi:", err.Error())
	}
	seen := map[int64]bool{}
	var to []int64
	for _, x := range mem {
		seen[x.userID] = true
		to = append(to, x.userID)
	}
	for _, u := range extra {
		if !seen[u] {
			seen[u] = true
			to = append(to, u)
		}
	}
	s.sendTo(to, "message.new", m.dto())
	if s.push == nil {
		return
	}
	var others []int64
	for _, x := range mem {
		if x.userID != m.senderID {
			others = append(others, x.userID)
		}
	}
	online := s.online(others)
	nowMs := s.now().UnixMilli()
	title := m.senderName
	if m.conv.typ == "group" && m.conv.name != nil {
		title = m.senderName + " · " + *m.conv.name
	}
	// người được nhắc (đích danh hoặc @Tất cả) nhận push kể cả khi tắt thông báo, nội dung "Nhắc đến bạn: ...", không gộp 3 giây
	all, named := false, map[int64]bool{}
	for _, x := range m.mentions {
		if x.UserID == MentionAll {
			all = true
		} else {
			named[x.UserID] = true
		}
	}
	var users, mentionUsers []int64
	for _, x := range mem {
		if x.userID == m.senderID || online[x.userID] {
			continue
		}
		if all || named[x.userID] {
			mentionUsers = append(mentionUsers, x.userID)
			continue
		}
		if x.mutedMs > nowMs {
			continue
		}
		users = append(users, x.userID)
	}
	body := previewBody(m.typ, m.content, deref(m.fileName), m.media)
	if len(mentionUsers) > 0 {
		s.enqueuePush(pushJob{convID: m.conv.id, seq: m.seq, title: title, body: mentionPushPrefix + body, users: mentionUsers, noCoalesce: true})
	}
	if len(users) > 0 {
		s.enqueuePush(pushJob{convID: m.conv.id, seq: m.seq, title: title, body: body, users: users})
	}
}

// ───────────── Cache thành viên (typing + phân phối) ─────────────

type memberInfo struct {
	userID  int64
	mutedMs int64 // tắt thông báo tới (mili giây epoch); 0 = không tắt; MaxInt64 = vĩnh viễn
}

type memberEntry struct {
	at      time.Time
	list    []memberInfo
	blocked bool // chat 1-1 mà một bên đã chặn bên kia: không chuyển typing / receipt cho bên kia
}

// activeMembers: thành viên đang hoạt động của hội thoại, cache 30 giây (bỏ khi thành viên / tắt thông báo đổi).
func (s *Service) activeMembers(ctx context.Context, convID int64) ([]memberInfo, error) {
	e, err := s.convMembers(ctx, convID)
	return e.list, err
}

// convMembers: activeMembers + cờ chặn của chat 1-1 (bỏ cache cả khi chặn / bỏ chặn, xem forgetDirect).
func (s *Service) convMembers(ctx context.Context, convID int64) (memberEntry, error) {
	now := s.now()
	s.memMu.Lock()
	if e, ok := s.members[convID]; ok && now.Sub(e.at) < memberCacheTTL {
		s.memMu.Unlock()
		return e, nil
	}
	gen := s.memGen
	s.memMu.Unlock()
	p, err := s.pool()
	if err != nil {
		return memberEntry{}, err
	}
	var blocked bool
	if err := p.QueryRow(ctx, `select coalesce((select c.conversation_type = 'direct' and exists (select 1
			from chat_conversation_members a
			join chat_conversation_members b on b.conversation_id = a.conversation_id and b.user_id <> a.user_id
			join chat_friendships f on f.user_id = a.user_id and f.friend_id = b.user_id and f.status = 'blocked'
			where a.conversation_id = c.id)
		from chat_conversations c where c.id = $1), false)`, convID).Scan(&blocked); err != nil {
		return memberEntry{}, err
	}
	rows, err := p.Query(ctx, `select user_id, case when muted_until is null then 0
			when muted_until = 'infinity'::timestamptz then 9223372036854775807
			else floor(extract(epoch from muted_until) * 1000)::bigint end
		from chat_conversation_members where conversation_id = $1 and left_at is null order by user_id`, convID)
	if err != nil {
		return memberEntry{}, err
	}
	defer rows.Close()
	e := memberEntry{at: now, list: []memberInfo{}, blocked: blocked}
	for rows.Next() {
		var x memberInfo
		if err := rows.Scan(&x.userID, &x.mutedMs); err != nil {
			return memberEntry{}, err
		}
		e.list = append(e.list, x)
	}
	if err := rows.Err(); err != nil {
		return memberEntry{}, err
	}
	s.memMu.Lock()
	if len(s.members) > 50000 {
		s.members = map[int64]memberEntry{}
	}
	// có lần bỏ cache trong lúc đang đọc thì không ghi dữ liệu có thể đã cũ vào cache
	if s.memGen == gen {
		s.members[convID] = e
	}
	s.memMu.Unlock()
	return e, nil
}

// forgetMembers: bỏ cache thành viên của hội thoại (gọi SAU khi commit thay đổi thành viên / tắt thông báo).
func (s *Service) forgetMembers(convID int64) {
	s.memMu.Lock()
	delete(s.members, convID)
	s.memGen++
	s.memMu.Unlock()
}

// forgetDirect: bỏ cache thành viên của chat 1-1 giữa a và b (nếu có) - gọi sau khi chặn / bỏ chặn.
func (s *Service) forgetDirect(ctx context.Context, a, b int64) {
	p, err := s.pool()
	if err != nil {
		return
	}
	var convID int64
	err = p.QueryRow(ctx, `select conversation_id from chat_direct_pairs where user_low = $1 and user_high = $2`, min(a, b), max(a, b)).Scan(&convID)
	if err != nil {
		if !noRows(err) {
			logger.Error("chat", "đọc chat 1-1 lỗi:", err.Error())
		}
		return
	}
	s.forgetMembers(convID)
}

// ───────────── Đã nhận / đã xem ─────────────

// MarkReceipt đẩy con trỏ đã nhận (read = false) / đã xem (read = true, kéo theo đã nhận) lên seq: kẹp ở last_seq,
// không bao giờ lùi. Có thay đổi -> receipt.update tới các thiết bị của tôi và các thành viên khác (người tắt
// "hiển thị đã xem" thì người khác nhận read_seq = null).
func (s *Service) MarkReceipt(ctx context.Context, uid, convID, seq int64, read bool) (*ReceiptAck, error) {
	if convID <= 0 || seq < 0 {
		return nil, errBad("Thiếu conversation_id / seq")
	}
	if seq > math.MaxInt64/2 {
		seq = math.MaxInt64 / 2
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	ack := &ReceiptAck{ConversationID: convID}
	var show bool
	err = p.QueryRow(ctx, `update chat_conversation_members m set
			last_delivered_seq = greatest(m.last_delivered_seq, least($3::bigint, c.last_seq)),
			last_read_seq = case when $4::boolean then greatest(m.last_read_seq, least($3::bigint, c.last_seq)) else m.last_read_seq end,
			updated_at = now()
		from chat_conversations c, chat_users u
		where c.id = $1 and m.conversation_id = c.id and m.user_id = $2 and u.id = m.user_id and m.left_at is null
			and (least($3::bigint, c.last_seq) > m.last_delivered_seq or ($4::boolean and least($3::bigint, c.last_seq) > m.last_read_seq))
		returning m.last_delivered_seq, m.last_read_seq, u.show_read_receipts`, convID, uid, seq, read).Scan(&ack.DeliveredSeq, &ack.ReadSeq, &show)
	if noRows(err) { // không đổi gì: còn là thành viên thì trả con trỏ hiện tại
		var active bool
		err = p.QueryRow(ctx, `select left_at is null, last_delivered_seq, last_read_seq from chat_conversation_members
			where conversation_id = $1 and user_id = $2`, convID, uid).Scan(&active, &ack.DeliveredSeq, &ack.ReadSeq)
		if noRows(err) {
			return nil, errNotMember
		}
		if err != nil {
			return nil, err
		}
		if !active {
			// dòng chỉ đọc của nhóm đã giải tán -> 410 (client không gửi con trỏ cho nhóm disbanded)
			ro, err := readonlyDisbanded(ctx, p, uid, convID)
			if err != nil {
				return nil, err
			}
			if ro {
				return nil, errGroupDisbanded
			}
			return nil, errNotMember
		}
		return ack, nil
	}
	if err != nil {
		return nil, err
	}
	rs := ack.ReadSeq
	up := ReceiptUpdate{ConversationID: convID, UserID: uid, DeliveredSeq: ack.DeliveredSeq, ReadSeq: &rs}
	s.sendTo([]int64{uid}, "receipt.update", up)
	e, err := s.convMembers(ctx, convID)
	if err != nil {
		logger.Error("chat", "đọc thành viên hội thoại", convID, "lỗi:", err.Error())
		return ack, nil
	}
	if e.blocked { // chat 1-1 đang chặn: bên kia không thấy mình đã nhận / đã xem (như online bị ẩn)
		return ack, nil
	}
	var others []int64
	for _, x := range e.list {
		if x.userID != uid {
			others = append(others, x.userID)
		}
	}
	if !show {
		up.ReadSeq = nil
	}
	s.sendTo(others, "receipt.update", up)
	return ack, nil
}
