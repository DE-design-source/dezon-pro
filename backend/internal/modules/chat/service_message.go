package chat

import (
	"context"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

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
}

func (m *msgRow) dto() MessageDTO {
	return MessageDTO{ID: m.id, ConversationID: m.conv.id, Seq: m.seq, ClientMsgID: m.clientID, SenderID: m.senderID,
		SenderName: m.senderName, MsgType: m.typ, Content: m.content, CreatedAt: iso(m.createdAt)}
}

// insertMessageTx: cấp seq (khoá dòng hội thoại tới hết transaction = thứ tự trong hội thoại), lưu tin, đẩy con trỏ
// đã nhận / đã xem của người gửi lên seq đó. Dùng chung cho tin của người dùng và tin hệ thống.
func insertMessageTx(ctx context.Context, tx pgx.Tx, c convRef, senderID int64, senderName, typ, content string, clientID *string) (*msgRow, error) {
	m := &msgRow{conv: c, senderID: senderID, senderName: senderName, clientID: clientID, typ: typ, content: content}
	var cid any
	if clientID != nil {
		cid = *clientID
	}
	// last_message_at không bao giờ lùi (đồng hồ máy chủ DB có thể bị chỉnh lùi): created_at luôn tăng theo seq trong hội thoại
	if err := tx.QueryRow(ctx, `with c as (
			update chat_conversations set last_seq = last_seq + 1,
				last_message_at = greatest(clock_timestamp(), last_message_at + interval '1 microsecond'), updated_at = clock_timestamp()
			where id = $1 returning id, last_seq, last_message_at)
		insert into chat_messages (conversation_id, seq, client_msg_id, sender_id, message_type, content, created_at)
		select c.id, c.last_seq, $2::uuid, $3, $4, $5, c.last_message_at from c
		returning id, seq, created_at`, c.id, cid, senderID, typ, content).Scan(&m.id, &m.seq, &m.createdAt); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `update chat_conversation_members set last_read_seq = greatest(last_read_seq, $3),
		last_delivered_seq = greatest(last_delivered_seq, $3), updated_at = clock_timestamp()
		where conversation_id = $1 and user_id = $2`, c.id, senderID, m.seq); err != nil {
		return nil, err
	}
	return m, nil
}

// validateSend: msg_type text, nội dung (đã cắt khoảng trắng) 1..4000 ký tự, client_msg_id là UUID.
func validateSend(in *SendInput) error {
	if in.ConversationID <= 0 {
		return errBad("Thiếu conversation_id")
	}
	if in.MsgType != "text" {
		return errBad("Giai đoạn này chỉ gửi được tin văn bản (msg_type = text)")
	}
	in.ClientMsgID = strings.ToLower(strings.TrimSpace(in.ClientMsgID))
	if !reUUID.MatchString(in.ClientMsgID) {
		return errBad("client_msg_id phải là UUID")
	}
	in.Content = strings.TrimSpace(in.Content)
	if in.Content == "" {
		return errBad("Tin nhắn trống")
	}
	if utf8.RuneCountInString(in.Content) > maxContent || strings.ContainsRune(in.Content, 0) {
		return errBad("Tin nhắn tối đa 4000 ký tự")
	}
	return nil
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
		var c convRef
		var active bool
		var sender string
		err := tx.QueryRow(ctx, `select c.conversation_type, c.name, m.left_at is null, u.display_name
			from chat_conversations c
			join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
			join chat_users u on u.id = m.user_id
			where c.id = $1 for update of c`, in.ConversationID, uid).Scan(&c.typ, &c.name, &active, &sender)
		if noRows(err) || (err == nil && !active) {
			return errNotMember
		}
		if err != nil {
			return err
		}
		c.id = in.ConversationID
		if ack, err = findSent(ctx, tx, in.ConversationID, uid, in.ClientMsgID); err != nil || ack != nil {
			return err
		}
		if c.typ == "direct" {
			var blocked bool
			if err := tx.QueryRow(ctx, `select exists(select 1 from chat_conversation_members x
				join chat_friendships f on f.status = 'blocked'
					and ((f.user_id = $2 and f.friend_id = x.user_id) or (f.user_id = x.user_id and f.friend_id = $2))
				where x.conversation_id = $1 and x.user_id <> $2)`, in.ConversationID, uid).Scan(&blocked); err != nil {
				return err
			}
			if blocked {
				return errBlocked("Không thể nhắn tin với người này")
			}
		}
		cid := in.ClientMsgID
		msg, err = insertMessageTx(ctx, tx, c, uid, sender, "text", in.Content, &cid)
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
		return ack, err
	}
	if err != nil {
		return nil, err
	}
	if ack != nil {
		return ack, nil
	}
	s.dispatch(msg, nil)
	return &SendAck{ConversationID: msg.conv.id, ClientMsgID: msg.clientID, MessageID: msg.id, Seq: msg.seq,
		CreatedAt: iso(msg.createdAt)}, nil
}

// findSent: tin đã lưu với cùng (hội thoại, người gửi, client_msg_id) -> ack duplicate; chưa có -> nil.
func findSent(ctx context.Context, q querier, convID, uid int64, clientID string) (*SendAck, error) {
	a := &SendAck{ConversationID: convID, Duplicate: true}
	var at time.Time
	var cid string
	err := q.QueryRow(ctx, `select id, seq, created_at, client_msg_id::text from chat_messages
		where conversation_id = $1 and sender_id = $2 and client_msg_id = $3::uuid`, convID, uid, clientID).Scan(&a.MessageID, &a.Seq, &at, &cid)
	if noRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.CreatedAt, a.ClientMsgID = iso(at), &cid
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
	var users []int64
	for _, x := range mem {
		if x.userID == m.senderID || online[x.userID] || x.mutedMs > nowMs {
			continue
		}
		users = append(users, x.userID)
	}
	if len(users) > 0 {
		s.enqueuePush(pushJob{convID: m.conv.id, seq: m.seq, title: title, body: truncRunes(m.content, 100), users: users})
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
		err = p.QueryRow(ctx, `select last_delivered_seq, last_read_seq from chat_conversation_members
			where conversation_id = $1 and user_id = $2 and left_at is null`, convID, uid).Scan(&ack.DeliveredSeq, &ack.ReadSeq)
		if noRows(err) {
			return nil, errNotMember
		}
		return ack, err
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
