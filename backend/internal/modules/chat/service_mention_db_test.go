package chat

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

// @nhắc tên (migration 0022, API.md mục "Quản trị nhóm"): kiểm đầu vào, lưu mentions + last_mention_seq, ack / message.new,
// chỉ trưởng / phó nhóm gửi tin, nhóm đã giải tán (410), push cho người được nhắc.

// Luật kiểm thuần (không DB): offset UTF-16 trên content đã cắt khoảng trắng.
func TestCheckMentions(t *testing.T) {
	m := func(uid int64, off, n int) Mention { return Mention{UserID: uid, Offset: off, Length: n} }
	ok := []struct {
		conv, typ, content string
		in, want           []Mention
	}{
		{"group", "text", "@Bình @Tất cả họp", []Mention{m(0, 6, 7), m(12, 0, 5)}, []Mention{m(12, 0, 5), m(0, 6, 7)}},
		{"group", "text", "😀 @Châu", []Mention{m(5, 3, 5)}, []Mention{m(5, 3, 5)}}, // emoji = 2 đơn vị UTF-16
		{"group", "image", "@An", []Mention{m(5, 0, 3)}, []Mention{m(5, 0, 3)}},
		{"direct", "text", "chào", nil, nil}, // không nhắc ai: không kiểm loại hội thoại
		{"group", "voice", "", []Mention{}, nil},
	}
	for i, c := range ok {
		got, err := checkMentions(c.conv, c.typ, c.content, c.in)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("ok %d: %+v %v, muốn %+v", i, got, err, c.want)
		}
	}
	many := make([]Mention, 51)
	for i := range many {
		many[i] = m(int64(i+1), i*3, 2)
	}
	bad := []struct {
		conv, typ, content string
		in                 []Mention
		msg                string
	}{
		{"direct", "text", "@An", []Mention{m(5, 0, 3)}, "Chỉ nhắc tên được trong nhóm"},
		{"group", "voice", "", []Mention{m(5, 0, 3)}, "Tin nhắn thoại không nhắc tên được"},
		{"group", "text", strings.Repeat("@x ", 51), many, "Tối đa 50 lượt nhắc tên mỗi tin"},
		{"group", "text", "@An", []Mention{m(-1, 0, 3)}, "Vị trí nhắc tên không hợp lệ"},
		{"group", "text", "@An", []Mention{m(5, -1, 3)}, "Vị trí nhắc tên không hợp lệ"},
		{"group", "text", "@An", []Mention{m(5, 0, 1)}, "Vị trí nhắc tên không hợp lệ"},
		{"group", "text", "@An", []Mention{m(5, 0, 4)}, "Vị trí nhắc tên không hợp lệ"},
		{"group", "text", "@An", []Mention{m(5, 3, 2)}, "Vị trí nhắc tên không hợp lệ"},
		{"group", "text", "An @", []Mention{m(5, 0, 2)}, "Vị trí nhắc tên không hợp lệ"},    // không bắt đầu bằng '@'
		{"group", "text", "😀 @Châu", []Mention{m(5, 2, 5)}, "Vị trí nhắc tên không hợp lệ"}, // offset theo rune là sai
		{"group", "text", "@An @Bé", []Mention{m(5, 0, 5), m(6, 4, 3)}, "Vị trí nhắc tên không hợp lệ"},
		{"group", "text", "@An", []Mention{m(5, 0, 1<<62)}, "Vị trí nhắc tên không hợp lệ"},
	}
	for i, c := range bad {
		_, err := checkMentions(c.conv, c.typ, c.content, c.in)
		if codeOf(err) != CodeBadRequest || !strings.Contains(err.Error(), c.msg) {
			t.Errorf("bad %d: %v, muốn %q", i, err, c.msg)
		}
	}
	// validateSend trừ khoảng trắng đầu (theo đơn vị UTF-16) khỏi offset, không sửa mảng của người gọi
	orig := []Mention{m(7, 3, 5)}
	in := SendInput{ConversationID: 1, ClientMsgID: newUUID(), MsgType: "text", Content: " 　 @Châu ", Mentions: orig}
	if err := validateSend(&in); err != nil || in.Content != "@Châu" || in.Mentions[0].Offset != 0 || orig[0].Offset != 3 {
		t.Fatalf("validateSend: %q %+v %+v %v", in.Content, in.Mentions, orig, err)
	}
	if got := parseMentions([]byte(`[{"user_id":0,"offset":1,"length":7}]`)); len(got) != 1 || got[0] != m(0, 1, 7) {
		t.Fatalf("parseMentions: %+v", got)
	}
	if parseMentions(nil) != nil || parseMentions([]byte("[]")) != nil || mentionsArg(nil) != nil {
		t.Fatal("rỗng phải là nil / NULL")
	}
}

// lastMention: chat_conversation_members.last_mention_seq của u.
func (e *env) lastMention(conv int64, u *tu) int64 {
	e.t.Helper()
	var v int64
	if err := e.pool.QueryRow(context.Background(), `select last_mention_seq from chat_conversation_members
		where conversation_id = $1 and user_id = $2`, conv, u.id).Scan(&v); err != nil {
		e.t.Fatal(err)
	}
	return v
}

// storedMentions: chat_messages.mentions của tin (NULL -> nil).
func (e *env) storedMentions(msgID int64) []Mention {
	e.t.Helper()
	var b []byte
	if err := e.pool.QueryRow(context.Background(), `select mentions::text from chat_messages where id = $1`, msgID).Scan(&b); err != nil {
		e.t.Fatal(err)
	}
	return parseMentions(b)
}

func TestMentionSendDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	e.s.sendLimit = newLimiter(100000, time.Second, e.clk.now)
	ctx := context.Background()
	lan, binh, chau, dung, ngoai := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng"), e.user("Ngoại")
	g := e.newGroupFor(t, lan, binh, chau, dung)
	send := func(u *tu, conv int64, content string, ms []Mention) (*SendAck, error) {
		return e.s.SendMessage(ctx, u.id, SendInput{ConversationID: conv, ClientMsgID: newUUID(), MsgType: "text", Content: content, Mentions: ms})
	}
	e.gw.packets("", true)

	// member nhắc Châu (khoảng trắng đầu được trừ khỏi offset)
	ack, err := send(binh, g, "  @Châu chiều nay họp", []Mention{{UserID: chau.id, Offset: 2, Length: 5}})
	want := []Mention{{UserID: chau.id, Offset: 0, Length: 5}}
	if err != nil || !reflect.DeepEqual(ack.Mentions, want) {
		t.Fatalf("ack nhắc tên: %+v %v", ack, err)
	}
	if got := e.storedMentions(ack.MessageID); !reflect.DeepEqual(got, want) {
		t.Fatalf("mentions lưu: %+v", got)
	}
	if e.lastMention(g, chau) != ack.Seq || e.lastMention(g, dung) != 0 || e.lastMention(g, binh) != 0 {
		t.Fatal("last_mention_seq chỉ của Châu")
	}
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 || !reflect.DeepEqual(pk[0].data.(MessageDTO).Mentions, want) {
		t.Fatalf("message.new phải mang mentions: %+v", pk)
	}
	// gửi trùng trả mentions của tin gốc
	in := SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: "@Dũng ơi", Mentions: []Mention{{UserID: dung.id, Offset: 0, Length: 5}}}
	a1, err := e.s.SendMessage(ctx, binh.id, in)
	if err != nil {
		t.Fatal(err)
	}
	in.Content, in.Mentions = "khác", nil
	if a2, err := e.s.SendMessage(ctx, binh.id, in); err != nil || !a2.Duplicate || a2.Seq != a1.Seq || !reflect.DeepEqual(a2.Mentions, a1.Mentions) {
		t.Fatalf("gửi trùng: %+v %v", a2, err)
	}

	// nhắc chính mình + người ngoài nhóm: bị bỏ, tin vẫn gửi, mentions NULL; không có khoá mentions
	ack, err = send(binh, g, "@Bình @Ngoại", []Mention{{UserID: binh.id, Offset: 0, Length: 5}, {UserID: ngoai.id, Offset: 6, Length: 6}})
	if err != nil || ack.Mentions != nil || e.storedMentions(ack.MessageID) != nil || e.lastMention(g, binh) != 0 {
		t.Fatalf("bỏ phần tử không hợp lệ: %+v %v", ack, err)
	}
	// người đã rời nhóm không được nhắc
	if err := e.s.RemoveMember(ctx, dung.id, g, dung.id); err != nil {
		t.Fatal(err)
	}
	before := e.lastMention(g, dung)
	if ack, err = send(binh, g, "@Dũng", []Mention{{UserID: dung.id, Offset: 0, Length: 5}}); err != nil || ack.Mentions != nil || e.lastMention(g, dung) != before {
		t.Fatalf("nhắc người đã rời: %+v %v", ack, err)
	}

	// member @Tất cả -> 403; owner @Tất cả -> mọi thành viên đang hoạt động trừ người gửi
	_, err = send(binh, g, "@Tất cả", []Mention{{UserID: MentionAll, Offset: 0, Length: 7}})
	wantCode(t, "member @Tất cả", err, CodeForbidden)
	ack, err = send(lan, g, "@Tất cả @Bình", []Mention{{UserID: binh.id, Offset: 8, Length: 5}, {UserID: MentionAll, Offset: 0, Length: 7}})
	if err != nil || len(ack.Mentions) != 2 || ack.Mentions[0].UserID != MentionAll || ack.Mentions[1].UserID != binh.id {
		t.Fatalf("owner @Tất cả (sắp theo offset): %+v %v", ack, err)
	}
	if e.lastMention(g, binh) != ack.Seq || e.lastMention(g, chau) != ack.Seq || e.lastMention(g, lan) != 0 || e.lastMention(g, dung) != before {
		t.Fatal("@Tất cả: last_mention_seq của mọi thành viên đang hoạt động trừ người gửi")
	}
	// phó nhóm cũng được @Tất cả
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, chau.id, "admin"); err != nil {
		t.Fatal(err)
	}
	if ack, err = send(chau, g, "@Tất cả", []Mention{{UserID: MentionAll, Offset: 0, Length: 7}}); err != nil || len(ack.Mentions) != 1 {
		t.Fatalf("phó nhóm @Tất cả: %+v %v", ack, err)
	}
	if e.lastMention(g, lan) != ack.Seq || e.lastMention(g, chau) == ack.Seq {
		t.Fatal("phó nhóm @Tất cả: người gửi không tự nhắc mình")
	}

	// lỗi đầu vào: sai vị trí / chồng nhau / chat 1-1
	_, err = send(lan, g, "@Bình", []Mention{{UserID: binh.id, Offset: 1, Length: 4}})
	wantCode(t, "không bắt đầu bằng @", err, CodeBadRequest)
	_, err = send(lan, g, "@Bình", []Mention{{UserID: binh.id, Offset: 0, Length: 5}, {UserID: chau.id, Offset: 0, Length: 5}})
	wantCode(t, "chồng nhau", err, CodeBadRequest)
	d, err := e.s.CreateDirect(ctx, lan.id, binh.id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = send(lan, d.ID, "@Bình", []Mention{{UserID: binh.id, Offset: 0, Length: 5}})
	wantCode(t, "chat 1-1", err, CodeBadRequest)
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_messages where conversation_id = $1 and message_type <> 'system'`, d.ID).Scan(&n)
	if n != 0 {
		t.Fatal("tin lỗi không được lưu")
	}

	// Danh sách tin (REST) mang mentions như đã lưu
	page, err := e.s.Messages(ctx, binh.id, g, nil, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, x := range page.Messages {
		if x.Content == "@Tất cả @Bình" {
			found = len(x.Mentions) == 2
		}
	}
	if !found {
		t.Error("GET /messages phải mang mentions (service_conv.go: Messages đọc chat_messages.mentions)")
	}
}

// Chỉ trưởng / phó nhóm gửi tin (is_admin_only_send) + nhóm đã giải tán (410 cho gửi tin và con trỏ).
func TestSendAdminOnlyAndDisbandedDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	e.s.sendLimit = newLimiter(100000, time.Second, e.clk.now)
	ctx := context.Background()
	lan, binh, chau, ngoai, cu := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Ngoại"), e.user("Cũ")
	g := e.newGroupFor(t, lan, binh, chau, cu)
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, chau.id, "admin"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `update chat_conversations set is_admin_only_send = true where id = $1`, g); err != nil {
		t.Fatal(err)
	}
	_, err := e.s.SendMessage(ctx, binh.id, SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: "xin chào"})
	wantCode(t, "member khi chỉ trưởng / phó nhóm gửi", err, CodeForbidden)
	if err == nil || !strings.Contains(err.Error(), "Chỉ trưởng / phó nhóm được gửi tin trong nhóm này") {
		t.Fatalf("thông báo: %v", err)
	}
	e.send(lan, g, "trưởng nhóm gửi được")
	last := e.send(chau, g, "phó nhóm gửi được")
	// member vẫn đánh dấu đã xem
	if _, err := e.s.MarkReceipt(ctx, binh.id, g, last.Seq, true); err != nil {
		t.Fatal(err)
	}
	// chat 1-1 không bị ảnh hưởng bởi cờ (cờ chỉ có nghĩa với nhóm)
	d, _ := e.s.CreateDirect(ctx, binh.id, lan.id)
	e.send(binh, d.ID, "chào")

	// Cũ rời nhóm trước khi giải tán
	if _, err := e.pool.Exec(ctx, `update chat_conversation_members set left_at = clock_timestamp() - interval '1 hour'
		where conversation_id = $1 and user_id = $2`, g, cu.id); err != nil {
		t.Fatal(err)
	}
	// giải tán (giả lập trực tiếp trên DB như DisbandGroup): mọi thành viên đang hoạt động left_at = disbanded_at
	if _, err := e.pool.Exec(ctx, `with c as (update chat_conversations set disbanded_at = clock_timestamp() where id = $1 returning disbanded_at)
		update chat_conversation_members m set left_at = c.disbanded_at from c where m.conversation_id = $1 and m.left_at is null`, g); err != nil {
		t.Fatal(err)
	}
	e.s.forgetMembers(g)
	for _, u := range []*tu{lan, chau, binh} {
		_, err = e.s.SendMessage(ctx, u.id, SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: "còn ai không"})
		wantCode(t, "gửi tin vào nhóm đã giải tán", err, CodeGroupDisbanded)
		_, err = e.s.MarkReceipt(ctx, u.id, g, last.Seq, true)
		wantCode(t, "con trỏ của nhóm đã giải tán", err, CodeGroupDisbanded)
	}
	// người đã rời trước khi giải tán, người đã gỡ nhóm khỏi danh sách: 403 như REST (không lộ nhóm đã giải tán)
	if done, err := e.s.hideDisbanded(ctx, lan.id, g); err != nil || !done {
		t.Fatalf("gỡ nhóm khỏi danh sách: %v %v", done, err)
	}
	for _, u := range []*tu{cu, lan} {
		_, err = e.s.SendMessage(ctx, u.id, SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: "x"})
		wantCode(t, "gửi tin của dòng đã rời", err, CodeForbidden)
		_, err = e.s.MarkReceipt(ctx, u.id, g, last.Seq, true)
		wantCode(t, "con trỏ của dòng đã rời", err, CodeForbidden)
	}
	// người chưa từng ở nhóm: vẫn 403 (không lộ nhóm đã giải tán)
	_, err = e.s.SendMessage(ctx, ngoai.id, SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: "x"})
	wantCode(t, "người ngoài", err, CodeForbidden)
	_, err = e.s.MarkReceipt(ctx, ngoai.id, g, 1, true)
	wantCode(t, "người ngoài (con trỏ)", err, CodeForbidden)
}

// Push: người được nhắc nhận push kể cả khi tắt thông báo, nội dung "Nhắc đến bạn: ...", không gộp 3 giây.
func TestMentionPushDB(t *testing.T) {
	e := newEnv(t, envOpt{push: true})
	e.s.sendLimit = newLimiter(100000, time.Second, e.clk.now)
	ctx := context.Background()
	lan, binh, chau, dung := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng")
	g := e.newGroupFor(t, lan, binh, chau, dung)
	for _, u := range []*tu{lan, binh, chau, dung} {
		if err := e.s.SetPushToken(ctx, u.id, u.did, "webpush", subJSON("dev-"+u.name)); err != nil {
			t.Fatal(err)
		}
	}
	forever := "forever"
	for _, u := range []*tu{binh, chau} {
		if _, err := e.s.Mute(ctx, u.id, g, &forever); err != nil {
			t.Fatal(err)
		}
	}
	for e.push.next(300*time.Millisecond) != nil {
	}
	e.clk.add(time.Minute)
	// collect: các push trong lúc chờ, theo người nhận
	collect := func() map[int64]pushPayload {
		out := map[int64]pushPayload{}
		for {
			c := e.push.next(400 * time.Millisecond)
			if c == nil {
				return out
			}
			if _, dup := out[c.payload.UserID]; dup {
				t.Fatalf("hai push cho cùng người %d", c.payload.UserID)
			}
			out[c.payload.UserID] = c.payload
		}
	}
	mention := func(u *tu, content string, ms ...Mention) {
		t.Helper()
		if _, err := e.s.SendMessage(ctx, u.id, SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: content, Mentions: ms}); err != nil {
			t.Fatal(err)
		}
	}

	mention(lan, "@Bình xem giúp", Mention{UserID: binh.id, Offset: 0, Length: 5})
	got := collect()
	if len(got) != 2 || got[binh.id].Body != "Nhắc đến bạn: @Bình xem giúp" || got[dung.id].Body != "@Bình xem giúp" ||
		got[binh.id].Title != "Lan · Nhóm thử" {
		t.Fatalf("push lần 1 (Bình tắt thông báo nhưng được nhắc, Dũng thường, Châu tắt): %+v", got)
	}
	// trong 3 giây: Bình được nhắc lại vẫn nhận (không gộp), Dũng bị gộp
	e.clk.add(time.Second)
	mention(lan, "@Bình nữa", Mention{UserID: binh.id, Offset: 0, Length: 5})
	got = collect()
	if len(got) != 1 || got[binh.id].Body != "Nhắc đến bạn: @Bình nữa" {
		t.Fatalf("push nhắc tên không gộp 3 giây: %+v", got)
	}
	// tin thường ngay sau push nhắc tên: gộp như cũ (Bình tắt thông báo nên vốn không nhận)
	e.clk.add(5 * time.Second)
	mention(lan, "@Tất cả họp", Mention{UserID: MentionAll, Offset: 0, Length: 7})
	got = collect()
	if len(got) != 3 || got[chau.id].Body != "Nhắc đến bạn: @Tất cả họp" || got[binh.id].Body != "Nhắc đến bạn: @Tất cả họp" ||
		got[dung.id].Body != "Nhắc đến bạn: @Tất cả họp" {
		t.Fatalf("push @Tất cả tới mọi người (kể cả tắt thông báo), không có người gửi: %+v", got)
	}
	e.clk.add(time.Second)
	e.send(lan, g, "tin thường")
	if got = collect(); len(got) != 0 {
		t.Fatalf("tin thường trong 3 giây sau push nhắc tên phải gộp: %+v", got)
	}
	// người gửi online không ảnh hưởng; người được nhắc đang online thì không push
	e.clk.add(5 * time.Second)
	e.gw.setOnline(binh.id, true)
	mention(lan, "@Bình", Mention{UserID: binh.id, Offset: 0, Length: 5})
	if got = collect(); len(got) != 1 || got[dung.id].Body != "@Bình" {
		t.Fatalf("người được nhắc đang online không nhận push: %+v", got)
	}
}
