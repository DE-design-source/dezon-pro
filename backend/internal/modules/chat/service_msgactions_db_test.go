package chat

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Giai đoạn 2 - trả lời, sửa, thu hồi, chuyển tiếp, changes, around_seq (API.md mục "Giai đoạn 2 ...").

func msgRequirePhase2(t *testing.T, e *env) {
	t.Helper()
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select to_regclass('public.chat_message_reactions') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có migration 0023 (chat_message_reactions): %v", err)
	}
}

// msgFind: tin id trong trang (nil = không có).
func msgFind(ms []MessageDTO, id int64) *MessageDTO {
	for i := range ms {
		if ms[i].ID == id {
			return &ms[i]
		}
	}
	return nil
}

// msgLatest: tin id đọc qua GET .../messages (mới nhất 100 tin) của uid.
func msgLatest(t *testing.T, e *env, uid, conv, id int64) *MessageDTO {
	t.Helper()
	pg, err := e.s.Messages(context.Background(), uid, conv, nil, nil, 100)
	if err != nil {
		t.Fatal(err)
	}
	m := msgFind(pg.Messages, id)
	if m == nil {
		t.Fatalf("không thấy tin %d", id)
	}
	return m
}

// msgUpdated: các gói message.updated đã gửi (xoá danh sách gói).
func msgUpdated(e *env) []MessageUpdatedEvent {
	var out []MessageUpdatedEvent
	for _, p := range e.gw.packets(EvMessageUpdated, false) {
		out = append(out, p.data.(MessageUpdatedEvent))
	}
	e.gw.packets("", true)
	return out
}

func msgSend(e *env, u *tu, in SendInput) (*SendAck, error) {
	if in.ClientMsgID == "" {
		in.ClientMsgID = newUUID()
	}
	if in.MsgType == "" {
		in.MsgType = "text"
	}
	return e.s.SendMessage(context.Background(), u.id, in)
}

// Trả lời: lưu reply_to, ack / message.new / messages có khung trích dẫn (bản mới nhất), gửi trùng, các lỗi.
func TestReplyDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	lan, binh, chau := e.user("Lan"), e.user("Bình"), e.user("Châu")
	g := e.newGroupFor(t, lan, binh, chau)
	long := strings.Repeat("dài ", 80) // 320 ký tự
	orig := e.send(binh, g, "  Báo giá tuần này "+long)
	e.gw.packets("", true)

	cid := newUUID()
	ack, err := msgSend(e, lan, SendInput{ConversationID: g, ClientMsgID: cid, Content: "ok", ReplyToMessageID: orig.MessageID})
	if err != nil {
		t.Fatal(err)
	}
	rp := ack.ReplyTo
	if rp == nil || rp.MessageID != orig.MessageID || rp.Seq != orig.Seq || rp.SenderID != binh.id || rp.SenderName != "Bình" ||
		rp.MsgType != "text" || rp.Recalled || rp.FileName != nil || len([]rune(rp.Content)) != replySnippetRunes ||
		!strings.HasPrefix(rp.Content, "Báo giá tuần này") {
		t.Fatalf("ack.reply_to: %+v", rp)
	}
	var stored *int64
	_ = e.pool.QueryRow(ctx, `select reply_to_message_id from chat_messages where id = $1`, ack.MessageID).Scan(&stored)
	if stored == nil || *stored != orig.MessageID {
		t.Fatalf("reply_to_message_id: %v", stored)
	}
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 || pk[0].data.(MessageDTO).ReplyTo == nil || pk[0].data.(MessageDTO).ReplyTo.MessageID != orig.MessageID {
		t.Fatalf("message.new phải có reply_to: %+v", pk)
	}
	if m := msgLatest(t, e, chau.id, g, ack.MessageID); m.ReplyTo == nil || m.ReplyTo.SenderName != "Bình" {
		t.Fatalf("messages: reply_to %+v", m.ReplyTo)
	}
	// gửi trùng: ack cũ kèm reply_to (kể cả khi lần này trả lời tin khác / không trả lời)
	dup, err := msgSend(e, lan, SendInput{ConversationID: g, ClientMsgID: cid, Content: "ok"})
	if err != nil || !dup.Duplicate || dup.MessageID != ack.MessageID || dup.ReplyTo == nil || dup.ReplyTo.MessageID != orig.MessageID ||
		dup.ReplyTo.SenderName != "Bình" {
		t.Fatalf("gửi trùng: %+v %v", dup, err)
	}

	// lỗi: tin hội thoại khác / không có, tin hệ thống, id âm
	d, _ := e.s.CreateDirect(ctx, lan.id, binh.id)
	other := e.send(lan, d.ID, "riêng")
	_, err = msgSend(e, lan, SendInput{ConversationID: g, Content: "x", ReplyToMessageID: other.MessageID})
	wantCode(t, "trả lời tin hội thoại khác", err, CodeNotFound)
	_, err = msgSend(e, lan, SendInput{ConversationID: g, Content: "x", ReplyToMessageID: 1 << 60})
	wantCode(t, "trả lời tin không có", err, CodeNotFound)
	var sysID int64
	_ = e.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and message_type = 'system' limit 1`, g).Scan(&sysID)
	_, err = msgSend(e, lan, SendInput{ConversationID: g, Content: "x", ReplyToMessageID: sysID})
	wantCode(t, "trả lời tin hệ thống", err, CodeBadRequest)
	_, err = msgSend(e, lan, SendInput{ConversationID: g, Content: "x", ReplyToMessageID: -1})
	wantCode(t, "reply_to âm", err, CodeBadRequest)
	// người ngoài: 403 trước khi xét tin được trả lời
	_, err = msgSend(e, chau, SendInput{ConversationID: d.ID, Content: "x", ReplyToMessageID: other.MessageID})
	wantCode(t, "người ngoài trả lời", err, CodeForbidden)

	// tin gốc sửa -> khung trích dẫn đổi theo; thu hồi -> recalled, content rỗng; không trả lời tin đã thu hồi
	short := e.send(binh, g, "gốc")
	r2, err := msgSend(e, chau, SendInput{ConversationID: g, Content: "trả lời", ReplyToMessageID: short.MessageID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.EditMessage(ctx, binh.id, short.MessageID, EditInput{Content: "gốc đã sửa"}); err != nil {
		t.Fatal(err)
	}
	if m := msgLatest(t, e, lan.id, g, r2.MessageID); m.ReplyTo == nil || m.ReplyTo.Content != "gốc đã sửa" {
		t.Fatalf("trích dẫn sau khi sửa: %+v", m.ReplyTo)
	}
	if _, err := e.s.RecallMessage(ctx, binh.id, short.MessageID); err != nil {
		t.Fatal(err)
	}
	if m := msgLatest(t, e, lan.id, g, r2.MessageID); m.ReplyTo == nil || !m.ReplyTo.Recalled || m.ReplyTo.Content != "" {
		t.Fatalf("trích dẫn sau khi thu hồi: %+v", m.ReplyTo)
	}
	_, err = msgSend(e, lan, SendInput{ConversationID: g, Content: "x", ReplyToMessageID: short.MessageID})
	wantCode(t, "trả lời tin đã thu hồi", err, CodeMessageRecalled)
	// thu hồi chính tin trả lời: không còn reply_to
	if _, err := e.s.RecallMessage(ctx, chau.id, r2.MessageID); err != nil {
		t.Fatal(err)
	}
	if m := msgLatest(t, e, lan.id, g, r2.MessageID); m.ReplyTo != nil || !m.Recalled {
		t.Fatalf("tin trả lời đã thu hồi: %+v", m)
	}
}

// Sửa tin: quyền, loại tin, cửa sổ 24 giờ, không đổi, mentions kiểm lại + last_mention_seq, message.updated tới mọi thành
// viên (kể cả người sửa), pins.updated khi tin đang ghim, updated_at của tin + hội thoại.
func TestEditMessageDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	lan, binh, chau, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Lạ")
	g := e.newGroupFor(t, lan, binh, chau)
	m1 := e.send(binh, g, "chào cả nhà")
	var convAt0 time.Time
	_ = e.pool.QueryRow(ctx, `select updated_at from chat_conversations where id = $1`, g).Scan(&convAt0)
	e.gw.packets("", true)

	got, err := e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "  chào cả nhà, @Châu  ",
		Mentions: []Mention{{UserID: chau.id, Offset: 15, Length: 5}}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "chào cả nhà, @Châu" || got.EditedAt == nil || len(got.Mentions) != 1 || got.Mentions[0].Offset != 13 ||
		got.Seq != m1.Seq || got.Recalled {
		t.Fatalf("kết quả sửa: %+v", got)
	}
	ev := msgUpdated(e)
	if len(ev) != 1 || ev[0].Action != ActionEdit || ev[0].ConversationID != g || ev[0].Message.Content != got.Content ||
		ev[0].Message.Reactions != nil {
		t.Fatalf("message.updated: %+v", ev)
	}
	var mentionSeq int64
	var msgAt, convAt *time.Time
	_ = e.pool.QueryRow(ctx, `select last_mention_seq from chat_conversation_members where conversation_id = $1 and user_id = $2`,
		g, chau.id).Scan(&mentionSeq)
	_ = e.pool.QueryRow(ctx, `select m.updated_at, c.updated_at from chat_messages m join chat_conversations c on c.id = m.conversation_id
		where m.id = $1`, m1.MessageID).Scan(&msgAt, &convAt)
	if mentionSeq != m1.Seq || msgAt == nil || convAt == nil || !convAt.After(convAt0) {
		t.Fatalf("last_mention_seq %d, updated_at %v / %v (trước %v)", mentionSeq, msgAt, convAt, convAt0)
	}
	// /conversations: last_message đã sửa
	if l, err := e.s.ListConversations(ctx, lan.id, "", 10); err != nil || l.Conversations[0].LastMessage == nil ||
		l.Conversations[0].LastMessage.EditedAt == nil || l.Conversations[0].LastMessage.Content != got.Content {
		t.Fatalf("last_message: %+v %v", l, err)
	}

	// như cũ: không ghi, không gói
	if _, err := e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "chào cả nhà, @Châu",
		Mentions: []Mention{{UserID: chau.id, Offset: 13, Length: 5}}}); err != nil {
		t.Fatal(err)
	}
	if ev := msgUpdated(e); len(ev) != 0 {
		t.Fatalf("sửa như cũ không gửi gói: %+v", ev)
	}

	// lỗi
	_, err = e.s.EditMessage(ctx, lan.id, m1.MessageID, EditInput{Content: "x"})
	wantCode(t, "sửa tin người khác", err, CodeForbidden)
	_, err = e.s.EditMessage(ctx, la.id, m1.MessageID, EditInput{Content: "x"})
	wantCode(t, "người ngoài sửa", err, CodeNotFound)
	_, err = e.s.EditMessage(ctx, binh.id, 1<<60, EditInput{Content: "x"})
	wantCode(t, "tin không có", err, CodeNotFound)
	_, err = e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "   "})
	wantCode(t, "nội dung trống", err, CodeBadRequest)
	_, err = e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: strings.Repeat("a", maxContent+1)})
	wantCode(t, "quá 4000 ký tự", err, CodeBadRequest)
	_, err = e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "@Tất cả họp", Mentions: []Mention{{UserID: MentionAll, Offset: 0, Length: 7}}})
	wantCode(t, "member nhắc cả nhóm", err, CodeForbidden)
	_, err = e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "@x", Mentions: []Mention{{UserID: chau.id, Offset: 1, Length: 1}}})
	wantCode(t, "vị trí nhắc sai", err, CodeBadRequest)
	var sysID int64
	_ = e.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and message_type = 'system' limit 1`, g).Scan(&sysID)
	_, err = e.s.EditMessage(ctx, lan.id, sysID, EditInput{Content: "x"})
	wantCode(t, "sửa tin hệ thống", err, CodeBadRequest)
	if ev := msgUpdated(e); len(ev) != 0 {
		t.Fatalf("lỗi không gửi gói: %+v", ev)
	}

	// nhắc người không còn trong nhóm: bị bỏ; @Tất cả của trưởng nhóm nâng last_mention_seq của mọi người
	m2 := e.send(lan, g, "họp")
	if d, err := e.s.EditMessage(ctx, lan.id, m2.MessageID, EditInput{Content: "@Lạ @Tất cả họp",
		Mentions: []Mention{{UserID: la.id, Offset: 0, Length: 3}, {UserID: MentionAll, Offset: 4, Length: 7}}}); err != nil ||
		len(d.Mentions) != 1 || d.Mentions[0].UserID != MentionAll {
		t.Fatalf("sửa @Tất cả: %+v %v", d, err)
	}
	_ = e.pool.QueryRow(ctx, `select min(last_mention_seq) from chat_conversation_members where conversation_id = $1 and user_id <> $2`,
		g, lan.id).Scan(&mentionSeq)
	if mentionSeq != m2.Seq {
		t.Fatalf("@Tất cả khi sửa: last_mention_seq %d, muốn %d", mentionSeq, m2.Seq)
	}

	// tin đang ghim: pins.updated mang nội dung mới
	if _, err := e.s.PinMessage(ctx, lan.id, g, m2.MessageID); err != nil {
		t.Fatal(err)
	}
	e.gw.packets("", true)
	if _, err := e.s.EditMessage(ctx, lan.id, m2.MessageID, EditInput{Content: "họp lúc 9 giờ"}); err != nil {
		t.Fatal(err)
	}
	pins := e.gw.packets("pins.updated", false)
	if len(msgUpdated(e)) != 1 || len(pins) != 1 || pins[0].data.(*PinList).Pins[0].Content != "họp lúc 9 giờ" {
		t.Fatalf("pins.updated sau khi sửa: %+v", pins)
	}

	// cửa sổ 24 giờ
	e.clk.add(msgActionWindow + time.Minute)
	_, err = e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "muộn"})
	wantCode(t, "sửa quá 24 giờ", err, CodeMessageTooOld)
	e.clk.add(-msgActionWindow - time.Minute)

	// admins_only_send: member không sửa được
	if _, err := e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{AdminsOnlySend: gaBool(true)}); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.EditMessage(ctx, binh.id, m1.MessageID, EditInput{Content: "sửa khi chỉ admin gửi"})
	wantCode(t, "member sửa khi admins_only_send", err, CodeForbidden)

	// chat 1-1: không nhắc tên; đang chặn -> BLOCKED
	d, _ := e.s.CreateDirect(ctx, lan.id, la.id)
	dm := e.send(lan, d.ID, "chào")
	_, err = e.s.EditMessage(ctx, lan.id, dm.MessageID, EditInput{Content: "@Lạ", Mentions: []Mention{{UserID: la.id, Offset: 0, Length: 3}}})
	wantCode(t, "nhắc tên trong 1-1", err, CodeBadRequest)
	if err := e.s.Block(ctx, la.id, lan.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.EditMessage(ctx, lan.id, dm.MessageID, EditInput{Content: "chào lại"})
	wantCode(t, "sửa khi bị chặn", err, CodeBlocked)

	// đã rời nhóm -> 403
	if err := e.s.RemoveMember(ctx, chau.id, g, chau.id); err != nil {
		t.Fatal(err)
	}
	m3 := e.send(lan, g, "sau khi Châu rời")
	_, err = e.s.EditMessage(ctx, chau.id, m3.MessageID, EditInput{Content: "x"})
	wantCode(t, "người đã rời sửa", err, CodeForbidden)
}

// Thu hồi: xoá thật nội dung / nhắc tên / tệp, xoá reaction, bỏ ghim, idempotent, cửa sổ 24 giờ, ma trận kiểm duyệt nhóm,
// chat 1-1, đã rời, giải tán; tin đã thu hồi không ghim / sửa được; last_message + messages hiện "đã thu hồi".
func TestRecallMessageDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	msgRequirePhase2(t, e)
	requirePinSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, dung, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng"), e.user("Lạ")
	g := e.newGroupFor(t, lan, binh, chau, dung)
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, binh.id, "admin"); err != nil {
		t.Fatal(err)
	}
	m1, err := msgSend(e, chau, SendInput{ConversationID: g, Content: "@Dũng xem giá", Mentions: []Mention{{UserID: dung.id, Offset: 0, Length: 5}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.PinMessage(ctx, lan.id, g, m1.MessageID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into chat_message_reactions (message_id, user_id, reaction) values ($1, $2, 'like'), ($1, $3, 'love')`,
		m1.MessageID, lan.id, binh.id); err != nil {
		t.Fatal(err)
	}
	e.gw.packets("", true)

	got, err := e.s.RecallMessage(ctx, chau.id, m1.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Recalled || got.Content != "" || got.Mentions != nil || got.RecalledBy == nil || *got.RecalledBy != chau.id ||
		got.Reactions != nil || got.EditedAt != nil {
		t.Fatalf("kết quả thu hồi: %+v", got)
	}
	var content string
	var mentions *string
	var by *int64
	var nReact, nPin int
	_ = e.pool.QueryRow(ctx, `select content, mentions::text, recalled_by,
		(select count(*) from chat_message_reactions where message_id = m.id), (select count(*) from chat_pinned_messages where message_id = m.id)
		from chat_messages m where id = $1`, m1.MessageID).Scan(&content, &mentions, &by, &nReact, &nPin)
	if content != "" || mentions != nil || by == nil || *by != chau.id || nReact != 0 || nPin != 0 {
		t.Fatalf("dòng sau thu hồi: %q %v %v react %d pin %d", content, mentions, by, nReact, nPin)
	}
	ev := e.gw.packets(EvMessageUpdated, false)
	pins := e.gw.packets("pins.updated", false)
	if len(ev) != 1 || len(ev[0].users) != 4 || !containsID(ev[0].users, chau.id) || ev[0].data.(MessageUpdatedEvent).Action != ActionRecall ||
		!ev[0].data.(MessageUpdatedEvent).Message.Recalled || len(pins) != 1 || len(pins[0].data.(*PinList).Pins) != 0 {
		t.Fatalf("message.updated / pins.updated: %+v %+v", ev, pins)
	}
	if n := len(e.gw.packets("message.new", true)); n != 0 {
		t.Fatalf("thu hồi không có tin hệ thống: %d", n)
	}
	if m := msgLatest(t, e, dung.id, g, m1.MessageID); !m.Recalled || m.Content != "" || m.Mentions != nil {
		t.Fatalf("messages: %+v", m)
	}
	last := e.send(chau, g, "tin cuối")
	if _, err := e.s.RecallMessage(ctx, chau.id, last.MessageID); err != nil {
		t.Fatal(err)
	}
	if l, err := e.s.ListConversations(ctx, dung.id, "", 10); err != nil || l.Conversations[0].LastMessage == nil ||
		l.Conversations[0].LastMessage.ID != last.MessageID || !l.Conversations[0].LastMessage.Recalled ||
		l.Conversations[0].LastMessage.Content != "" || *l.Conversations[0].LastMessage.RecalledBy != chau.id {
		t.Fatalf("last_message thu hồi: %+v %v", l, err)
	}
	e.gw.packets("", true)
	// idempotent: trả lại tin, không gói
	if again, err := e.s.RecallMessage(ctx, chau.id, m1.MessageID); err != nil || !again.Recalled {
		t.Fatalf("thu hồi lại: %+v %v", again, err)
	}
	if n := len(msgUpdated(e)); n != 0 {
		t.Fatalf("thu hồi lại không gửi gói: %d", n)
	}
	_, err = e.s.PinMessage(ctx, lan.id, g, m1.MessageID)
	wantCode(t, "ghim tin đã thu hồi", err, CodeMessageRecalled)
	_, err = e.s.EditMessage(ctx, chau.id, m1.MessageID, EditInput{Content: "x"})
	wantCode(t, "sửa tin đã thu hồi", err, CodeMessageRecalled)

	// cửa sổ 24 giờ với tin của mình; kiểm duyệt không giới hạn thời gian
	mc := e.send(chau, g, "tin của Châu")
	ml := e.send(lan, g, "tin của trưởng nhóm")
	mb := e.send(binh, g, "tin của phó nhóm")
	e.clk.add(msgActionWindow + time.Minute)
	_, err = e.s.RecallMessage(ctx, chau.id, mc.MessageID)
	wantCode(t, "thu hồi quá 24 giờ", err, CodeMessageTooOld)
	_, err = e.s.RecallMessage(ctx, dung.id, mc.MessageID)
	wantCode(t, "member thu hồi tin người khác", err, CodeForbidden)
	_, err = e.s.RecallMessage(ctx, binh.id, ml.MessageID)
	wantCode(t, "phó nhóm thu hồi tin trưởng nhóm", err, CodeForbidden)
	if r, err := e.s.RecallMessage(ctx, binh.id, mc.MessageID); err != nil || !r.Recalled || *r.RecalledBy != binh.id {
		t.Fatalf("phó nhóm thu hồi tin member: %+v %v", r, err)
	}
	if r, err := e.s.RecallMessage(ctx, lan.id, mb.MessageID); err != nil || !r.Recalled {
		t.Fatalf("trưởng nhóm thu hồi tin phó nhóm: %+v %v", r, err)
	}
	e.clk.add(-msgActionWindow - time.Minute)

	// phó nhóm thu hồi tin của người đã rời
	md := e.send(dung, g, "tin trước khi rời")
	if err := e.s.RemoveMember(ctx, dung.id, g, dung.id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RecallMessage(ctx, binh.id, md.MessageID); err != nil {
		t.Fatalf("phó nhóm thu hồi tin người đã rời: %v", err)
	}
	// người đã rời -> 403; người ngoài -> 404; tin hệ thống -> 400
	m4 := e.send(lan, g, "sau khi Dũng rời")
	_, err = e.s.RecallMessage(ctx, dung.id, m4.MessageID)
	wantCode(t, "người đã rời thu hồi", err, CodeForbidden)
	_, err = e.s.RecallMessage(ctx, la.id, m4.MessageID)
	wantCode(t, "người ngoài thu hồi", err, CodeNotFound)
	var sysID int64
	_ = e.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and message_type = 'system' limit 1`, g).Scan(&sysID)
	_, err = e.s.RecallMessage(ctx, lan.id, sysID)
	wantCode(t, "thu hồi tin hệ thống", err, CodeBadRequest)

	// chat 1-1: không thu hồi tin người kia; tin của mình thu hồi được cả khi bị chặn
	d, _ := e.s.CreateDirect(ctx, lan.id, la.id)
	theirs := e.send(la, d.ID, "chào")
	mine := e.send(lan, d.ID, "chào lại")
	_, err = e.s.RecallMessage(ctx, lan.id, theirs.MessageID)
	wantCode(t, "thu hồi tin người kia (1-1)", err, CodeForbidden)
	if err := e.s.Block(ctx, la.id, lan.id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RecallMessage(ctx, lan.id, mine.MessageID); err != nil {
		t.Fatalf("thu hồi khi bị chặn: %v", err)
	}

	// nhóm đã giải tán -> 410 (sửa / thu hồi)
	if err := e.s.DisbandGroup(ctx, lan.id, g); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.RecallMessage(ctx, lan.id, m4.MessageID)
	wantCode(t, "thu hồi trong nhóm đã giải tán", err, CodeGroupDisbanded)
	_, err = e.s.EditMessage(ctx, lan.id, m4.MessageID, EditInput{Content: "x"})
	wantCode(t, "sửa trong nhóm đã giải tán", err, CodeGroupDisbanded)
}

// Thu hồi bỏ push còn trong hàng đợi (runPush kiểm recalled_at).
func TestRecallDropsPushDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	if err := e.s.SetPushToken(ctx, b.id, b.did, "webpush", subJSON("recall-b")); err != nil {
		t.Fatal(err)
	}
	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	m1 := e.send(a, d.ID, "bí mật")
	m2 := e.send(a, d.ID, "thường")
	for e.push.next(300*time.Millisecond) != nil {
	}
	if _, err := e.s.RecallMessage(ctx, a.id, m1.MessageID); err != nil {
		t.Fatal(err)
	}
	e.s.runPush(pushJob{convID: d.ID, seq: m1.Seq, title: "An", body: "bí mật", users: []int64{b.id}})
	if c := e.push.next(300 * time.Millisecond); c != nil {
		t.Fatalf("push của tin đã thu hồi phải bị bỏ: %+v", c)
	}
	e.s.runPush(pushJob{convID: d.ID, seq: m2.Seq, title: "An", body: "thường", users: []int64{b.id}})
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "thường" {
		t.Fatalf("push tin thường: %+v", c)
	}
}

// Chuyển tiếp: kiểm đầu vào, tin nguồn (đọc được / hệ thống / thu hồi), dùng lại tệp không tải lại + quyền đọc tệp của người
// nhận, is_forwarded, không mentions / reply_to, luật gửi của từng đích (thành viên, giải tán, admins_only_send, chặn), gửi lại.
func TestForwardMessageDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	lan, binh, chau, dung, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng"), e.user("Lạ")
	src := e.newGroupFor(t, binh, lan, chau)
	img := e.readyMedia(binh.id, MediaImage)
	srcImg, err := msgSend(e, binh, SendInput{ConversationID: src, MsgType: MediaImage, Content: "@Lan ảnh công trình",
		Attachments: []int64{img}, Mentions: []Mention{{UserID: lan.id, Offset: 0, Length: 4}}})
	if err != nil {
		t.Fatal(err)
	}
	pdf := e.readyMedia(binh.id, MediaFile)
	srcFile, err := msgSend(e, binh, SendInput{ConversationID: src, MsgType: MediaFile, Attachments: []int64{pdf}, FileName: "bao_gia.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	srcText := e.send(binh, src, "báo giá")

	direct, _ := e.s.CreateDirect(ctx, lan.id, dung.id) // Dũng không ở hội thoại nguồn
	adminsOnly := e.newGroupFor(t, dung, lan)
	if _, err := e.s.UpdateGroupSettings(ctx, dung.id, adminsOnly, GroupSettingsPatch{AdminsOnlySend: gaBool(true)}); err != nil {
		t.Fatal(err)
	}
	disbanded := e.newGroupFor(t, lan, chau)
	if err := e.s.DisbandGroup(ctx, lan.id, disbanded); err != nil {
		t.Fatal(err)
	}
	blocked, _ := e.s.CreateDirect(ctx, lan.id, la.id)
	if err := e.s.Block(ctx, la.id, lan.id); err != nil {
		t.Fatal(err)
	}
	notMine, _ := e.s.CreateDirect(ctx, binh.id, dung.id)
	e.gw.packets("", true)

	tg := func(conv int64) ForwardTarget { return ForwardTarget{ConversationID: conv, ClientMsgID: newUUID()} }
	ok := tg(direct.ID)
	res, err := e.s.ForwardMessage(ctx, lan.id, srcImg.MessageID, ForwardInput{Targets: []ForwardTarget{
		ok, tg(adminsOnly), tg(disbanded), tg(blocked.ID), tg(notMine.ID)}})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"", CodeForbidden, CodeGroupDisbanded, CodeBlocked, CodeForbidden}
	if len(res.Results) != len(want) {
		t.Fatalf("số kết quả: %+v", res)
	}
	for i, w := range want {
		r := res.Results[i]
		if (w == "") != r.OK || (w != "" && (r.Error == nil || r.Error.Code != w || r.Error.Message == "")) || (w == "" && r.Ack == nil) {
			t.Fatalf("đích %d: %+v (muốn %q)", i, r, w)
		}
	}
	a := res.Results[0].Ack
	if a.ConversationID != direct.ID || len(a.Attachments) != 1 || a.Attachments[0].ID != img || a.Mentions != nil || a.ReplyTo != nil || a.Duplicate {
		t.Fatalf("ack chuyển tiếp: %+v", a)
	}
	var fwd bool
	var mediaID *int64
	var content string
	var mentions, reply *string
	_ = e.pool.QueryRow(ctx, `select is_forwarded, media_id, content, mentions::text, reply_to_message_id::text from chat_messages where id = $1`,
		a.MessageID).Scan(&fwd, &mediaID, &content, &mentions, &reply)
	if !fwd || mediaID == nil || *mediaID != img || content != "@Lan ảnh công trình" || mentions != nil || reply != nil {
		t.Fatalf("dòng chuyển tiếp: %v %v %q %v %v", fwd, mediaID, content, mentions, reply)
	}
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 || !pk[0].data.(MessageDTO).Forwarded || !containsID(pk[0].users, dung.id) || !containsID(pk[0].users, lan.id) {
		t.Fatalf("message.new chuyển tiếp: %+v", pk)
	}
	if m := msgLatest(t, e, dung.id, direct.ID, a.MessageID); !m.Forwarded || len(m.Attachments) != 1 || m.Attachments[0].URL == "" {
		t.Fatalf("messages của người nhận: %+v", m)
	}
	// người nhận đọc được tệp (thành viên hội thoại có tin dùng tệp); người ngoài thì không
	if md, err := e.s.MediaGet(ctx, dung.id, img, false, 0); err != nil || md.URL == "" {
		t.Fatalf("người nhận đọc tệp: %+v %v", md, err)
	}
	_, err = e.s.MediaGet(ctx, la.id, img, false, 0)
	wantCode(t, "người ngoài đọc tệp", err, CodeMediaNotFound)

	// gửi lại cùng client_msg_id cho cùng đích -> ack cũ
	again, err := e.s.ForwardMessage(ctx, lan.id, srcImg.MessageID, ForwardInput{Targets: []ForwardTarget{ok}})
	if err != nil || !again.Results[0].OK || !again.Results[0].Ack.Duplicate || again.Results[0].Ack.MessageID != a.MessageID ||
		len(again.Results[0].Ack.Attachments) != 1 {
		t.Fatalf("gửi lại: %+v %v", again, err)
	}
	if n := len(e.gw.packets("message.new", true)); n != 0 {
		t.Fatalf("gửi lại không phân phối: %d", n)
	}

	// tệp: giữ tên của tin nguồn; trả lời tin tệp có file_name
	fr, err := e.s.ForwardMessage(ctx, lan.id, srcFile.MessageID, ForwardInput{Targets: []ForwardTarget{tg(direct.ID)}})
	if err != nil || !fr.Results[0].OK || fr.Results[0].Ack.Attachments[0].FileName != "bao_gia.pdf" {
		t.Fatalf("chuyển tiếp tệp: %+v %v", fr, err)
	}
	rf, err := msgSend(e, dung, SendInput{ConversationID: direct.ID, Content: "nhận", ReplyToMessageID: fr.Results[0].Ack.MessageID})
	if err != nil || rf.ReplyTo == nil || rf.ReplyTo.FileName == nil || *rf.ReplyTo.FileName != "bao_gia.pdf" || rf.ReplyTo.MsgType != MediaFile {
		t.Fatalf("trả lời tin tệp: %+v %v", rf, err)
	}
	// chuyển tiếp vào chính hội thoại nguồn được
	if r, err := e.s.ForwardMessage(ctx, chau.id, srcText.MessageID, ForwardInput{Targets: []ForwardTarget{tg(src)}}); err != nil || !r.Results[0].OK {
		t.Fatalf("chuyển tiếp vào hội thoại nguồn: %+v %v", r, err)
	}

	// đầu vào
	_, err = e.s.ForwardMessage(ctx, lan.id, srcText.MessageID, ForwardInput{})
	wantCode(t, "không đích", err, CodeBadRequest)
	many := make([]ForwardTarget, maxForwardTargets+1)
	for i := range many {
		many[i] = ForwardTarget{ConversationID: int64(i + 1), ClientMsgID: newUUID()}
	}
	_, err = e.s.ForwardMessage(ctx, lan.id, srcText.MessageID, ForwardInput{Targets: many})
	wantCode(t, "quá 20 đích", err, CodeBadRequest)
	_, err = e.s.ForwardMessage(ctx, lan.id, srcText.MessageID, ForwardInput{Targets: []ForwardTarget{tg(direct.ID), tg(direct.ID)}})
	wantCode(t, "trùng đích", err, CodeBadRequest)
	_, err = e.s.ForwardMessage(ctx, lan.id, srcText.MessageID, ForwardInput{Targets: []ForwardTarget{{ConversationID: direct.ID, ClientMsgID: "x"}}})
	wantCode(t, "client_msg_id sai", err, CodeBadRequest)

	// tin nguồn: người ngoài 404, hệ thống 400, đã thu hồi 410, đã rời 403
	_, err = e.s.ForwardMessage(ctx, la.id, srcText.MessageID, ForwardInput{Targets: []ForwardTarget{tg(blocked.ID)}})
	wantCode(t, "người ngoài chuyển tiếp", err, CodeNotFound)
	var sysID int64
	_ = e.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and message_type = 'system' limit 1`, src).Scan(&sysID)
	_, err = e.s.ForwardMessage(ctx, lan.id, sysID, ForwardInput{Targets: []ForwardTarget{tg(direct.ID)}})
	wantCode(t, "chuyển tiếp tin hệ thống", err, CodeBadRequest)
	gone := e.send(binh, src, "sẽ thu hồi")
	if _, err := e.s.RecallMessage(ctx, binh.id, gone.MessageID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.ForwardMessage(ctx, lan.id, gone.MessageID, ForwardInput{Targets: []ForwardTarget{tg(direct.ID)}})
	wantCode(t, "chuyển tiếp tin đã thu hồi", err, CodeMessageRecalled)
	if err := e.s.RemoveMember(ctx, chau.id, src, chau.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.ForwardMessage(ctx, chau.id, srcText.MessageID, ForwardInput{Targets: []ForwardTarget{tg(direct.ID)}})
	wantCode(t, "người đã rời chuyển tiếp", err, CodeForbidden)

	// máy chủ tắt tệp: tin tệp lỗi MEDIA_DISABLED ở đích, tin chữ vẫn được
	e2 := newEnv(t, envOpt{})
	x, y := e2.user("X"), e2.user("Y")
	dx, _ := e2.s.CreateDirect(ctx, x.id, y.id)
	if _, err := e2.pool.Exec(ctx, `insert into chat_messages (conversation_id, seq, sender_id, message_type, content, media_id, client_msg_id)
		select $1, 1, $2, 'image', '', $3, $4::uuid`, dx.ID, x.id, img, newUUID()); err != nil {
		t.Fatal(err)
	}
	if _, err := e2.pool.Exec(ctx, `update chat_conversations set last_seq = 1 where id = $1`, dx.ID); err != nil {
		t.Fatal(err)
	}
	var imgMsg int64
	_ = e2.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and seq = 1`, dx.ID).Scan(&imgMsg)
	r, err := e2.s.ForwardMessage(ctx, x.id, imgMsg, ForwardInput{Targets: []ForwardTarget{tg(dx.ID)}})
	if err != nil || r.Results[0].OK || r.Results[0].Error.Code != CodeMediaDisabled {
		t.Fatalf("tắt tệp: %+v %v", r, err)
	}
	txt := e2.send(x, dx.ID, "chữ")
	if r, err := e2.s.ForwardMessage(ctx, y.id, txt.MessageID, ForwardInput{Targets: []ForwardTarget{tg(dx.ID)}}); err != nil || !r.Results[0].OK {
		t.Fatalf("chuyển tiếp chữ khi tắt tệp: %+v %v", r, err)
	}
	if _, err := e2.pool.Exec(ctx, `delete from chat_messages where conversation_id = $1`, dx.ID); err != nil { // trả tệp cho e dọn
		t.Fatal(err)
	}
}

// Nhảy tới tin (around_seq): khoảng [S - limit/2, ...], kẹp S về last_seq, has_more / has_newer, lỗi.
func TestMessagesAroundDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	a, b, c := e.user("An"), e.user("Bình"), e.user("Châu")
	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	for i := 1; i <= 30; i++ {
		if i%10 == 0 {
			e.clk.add(time.Second) // hạn mức 20 tin / giây
		}
		e.send(a, d.ID, "tin "+itoa(int64(i)))
	}
	seqs := func(p *MessagePage) []int64 {
		var out []int64
		for _, m := range p.Messages {
			out = append(out, m.Seq)
		}
		return out
	}
	p, err := e.s.MessagesAround(ctx, b.id, d.ID, 15, 10)
	if err != nil || len(p.Messages) != 10 || p.Messages[0].Seq != 10 || p.Messages[9].Seq != 19 || !p.HasMore || p.HasNewer == nil || !*p.HasNewer {
		t.Fatalf("around 15: %v %+v %v", seqs(p), p, err)
	}
	if p, err = e.s.MessagesAround(ctx, b.id, d.ID, 1000, 10); err != nil || len(p.Messages) != 6 || p.Messages[0].Seq != 25 ||
		p.Messages[5].Seq != 30 || !p.HasMore || *p.HasNewer {
		t.Fatalf("around quá last_seq: %v %v", seqs(p), err)
	}
	if p, err = e.s.MessagesAround(ctx, b.id, d.ID, 2, 10); err != nil || len(p.Messages) != 10 || p.Messages[0].Seq != 1 || p.HasMore || !*p.HasNewer {
		t.Fatalf("around 2: %v %v", seqs(p), err)
	}
	_, err = e.s.MessagesAround(ctx, b.id, d.ID, 0, 10)
	wantCode(t, "around_seq = 0", err, CodeBadRequest)
	_, err = e.s.MessagesAround(ctx, c.id, d.ID, 5, 10)
	wantCode(t, "người ngoài", err, CodeForbidden)
	// chế độ cũ không có has_newer
	if p, err = e.s.Messages(ctx, b.id, d.ID, nil, nil, 5); err != nil || p.HasNewer != nil {
		t.Fatalf("messages thường: %+v %v", p, err)
	}
}

// Đồng bộ thay đổi: since (trừ 10 giây chồng lấn) / cursor, thứ tự (updated_at, id), phân trang, lỗi.
func TestMessageChangesDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	a, b, c := e.user("An"), e.user("Bình"), e.user("Châu")
	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	m1, m2, m3 := e.send(a, d.ID, "một"), e.send(a, d.ID, "hai"), e.send(b, d.ID, "ba")
	l, err := e.s.ListConversations(ctx, a.id, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	since := l.SyncCursor
	if pg, err := e.s.MessageChanges(ctx, a.id, d.ID, since, "", 0); err != nil || len(pg.Messages) != 0 || pg.NextCursor != nil {
		t.Fatalf("chưa đổi gì: %+v %v", pg, err)
	}
	if _, err := e.s.EditMessage(ctx, a.id, m2.MessageID, EditInput{Content: "hai (sửa)"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RecallMessage(ctx, b.id, m3.MessageID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.EditMessage(ctx, a.id, m1.MessageID, EditInput{Content: "một (sửa)"}); err != nil {
		t.Fatal(err)
	}
	pg, err := e.s.MessageChanges(ctx, b.id, d.ID, since, "", 2)
	if err != nil || len(pg.Messages) != 2 || pg.Messages[0].ID != m2.MessageID || pg.Messages[1].ID != m3.MessageID ||
		!pg.Messages[1].Recalled || pg.Messages[0].EditedAt == nil || pg.NextCursor == nil {
		t.Fatalf("trang 1: %+v %v", pg, err)
	}
	pg, err = e.s.MessageChanges(ctx, b.id, d.ID, "", *pg.NextCursor, 2)
	if err != nil || len(pg.Messages) != 1 || pg.Messages[0].ID != m1.MessageID || pg.Messages[0].Content != "một (sửa)" || pg.NextCursor != nil {
		t.Fatalf("trang 2: %+v %v", pg, err)
	}
	// cursor thắng since
	if pg, err = e.s.MessageChanges(ctx, b.id, d.ID, "0", changesEncodeCursor(time.Now().Add(time.Hour), 1), 0); err != nil || len(pg.Messages) != 0 {
		t.Fatalf("cursor thắng since: %+v %v", pg, err)
	}
	_, err = e.s.MessageChanges(ctx, b.id, d.ID, "", "", 0)
	wantCode(t, "thiếu since / cursor", err, CodeBadRequest)
	_, err = e.s.MessageChanges(ctx, b.id, d.ID, "", "hỏng!", 0)
	wantCode(t, "cursor hỏng", err, CodeBadRequest)
	_, err = e.s.MessageChanges(ctx, b.id, d.ID, "abc", "", 0)
	wantCode(t, "since hỏng", err, CodeBadRequest)
	_, err = e.s.MessageChanges(ctx, c.id, d.ID, since, "", 0)
	wantCode(t, "người ngoài", err, CodeForbidden)
}

func TestChangesCursor(t *testing.T) {
	at := time.Date(2026, 11, 3, 1, 2, 3, 456789000, time.UTC)
	got, id, err := changesDecodeCursor(changesEncodeCursor(at, 42))
	if err != nil || !got.Equal(at) || id != 42 {
		t.Fatalf("%v %d %v", got, id, err)
	}
	for _, bad := range []string{"", "x", "dTE6MA", "bjE6Mg"} { // "u1:0", "n1:2"
		if _, _, err := changesDecodeCursor(bad); codeOf(err) != CodeBadRequest {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

// Thu hồi commit sau khi forwardSource đã đọc tin nguồn: forwardOne đọc lại có khoá, trả MESSAGE_RECALLED, không chép nội dung.
func TestForwardAfterRecallDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	msgRequirePhase2(t, e)
	ctx := context.Background()
	lan, binh, dung := e.user("Lan"), e.user("Bình"), e.user("Dũng")
	srcConv := e.newGroupFor(t, binh, lan)
	srcMsg := e.send(binh, srcConv, "nội dung sẽ thu hồi")
	direct, _ := e.s.CreateDirect(ctx, lan.id, dung.id)
	src, err := forwardSource(ctx, e.pool, lan.id, srcMsg.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RecallMessage(ctx, binh.id, srcMsg.MessageID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.forwardOne(ctx, lan.id, src, ForwardTarget{ConversationID: direct.ID, ClientMsgID: newUUID()}); codeOf(err) != CodeMessageRecalled {
		t.Fatalf("chuyển tiếp tin vừa thu hồi: %v", err)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_messages where conversation_id = $1 and is_forwarded`, direct.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("đã chép %d tin chuyển tiếp", n)
	}
}
