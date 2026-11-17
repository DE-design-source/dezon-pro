package chat

import (
	"context"
	"strings"
	"testing"
	"time"
)

func requireSchedSchema(t *testing.T, e *env) {
	t.Helper()
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select to_regclass('public.chat_scheduled_messages') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có bảng chat_scheduled_messages (áp 0049_chat_scheduled_messages.sql): %v", err)
	}
}

func (e *env) schedStatus(id int64) (status string, msgID *int64, errMsg *string) {
	e.t.Helper()
	if err := e.pool.QueryRow(context.Background(), `select status, message_id, error from chat_scheduled_messages where id = $1`, id).
		Scan(&status, &msgID, &errMsg); err != nil {
		e.t.Fatal(err)
	}
	return
}

// Tạo / xem / sửa / huỷ: chỉ người hẹn, chỉ khi đang chờ; kiểm thành viên, nhắc tên, tin trả lời, giờ hẹn, giới hạn 50.
func TestScheduledCrudDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireSchedSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, ngoai := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Ngoài")
	e.friends(lan, binh)
	e.friends(lan, chau)
	g, err := e.s.CreateGroup(ctx, lan.id, "Nhóm hẹn", []int64{binh.id, chau.id})
	if err != nil {
		t.Fatal(err)
	}
	d, err := e.s.CreateDirect(ctx, lan.id, binh.id)
	if err != nil {
		t.Fatal(err)
	}
	first := e.send(binh, g.ID, "tin gốc")
	at := func(d time.Duration) string { return e.clk.now().Add(d).Format(time.RFC3339) }
	e.gw.packets("", true)

	// kiểm đầu vào
	_, err = e.s.CreateScheduled(ctx, ngoai.id, g.ID, ScheduleInput{Content: "x", SendAt: at(time.Hour)})
	wantCode(t, "người ngoài hẹn", err, CodeForbidden)
	_, err = e.s.CreateScheduled(ctx, lan.id, g.ID, ScheduleInput{Content: "  ", SendAt: at(time.Hour)})
	wantCode(t, "tin trống", err, CodeBadRequest)
	_, err = e.s.CreateScheduled(ctx, lan.id, g.ID, ScheduleInput{Content: "x", SendAt: at(10 * time.Second)})
	wantCode(t, "giờ hẹn quá sớm", err, CodeBadRequest)
	_, err = e.s.CreateScheduled(ctx, lan.id, d.ID, ScheduleInput{Content: "@Bình", SendAt: at(time.Hour),
		Mentions: []Mention{{UserID: binh.id, Offset: 0, Length: 5}}})
	wantCode(t, "nhắc tên trong chat 1-1", err, CodeBadRequest)
	_, err = e.s.CreateScheduled(ctx, binh.id, g.ID, ScheduleInput{Content: "@Tất cả", SendAt: at(time.Hour),
		Mentions: []Mention{{UserID: MentionAll, Offset: 0, Length: 7}}})
	wantCode(t, "member nhắc cả nhóm", err, CodeForbidden)
	_, err = e.s.CreateScheduled(ctx, lan.id, g.ID, ScheduleInput{Content: "x", SendAt: at(time.Hour), ReplyToMessageID: 1 << 50})
	wantCode(t, "trả lời tin không có", err, CodeNotFound)

	it, err := e.s.CreateScheduled(ctx, lan.id, g.ID, ScheduleInput{Content: " @Bình nhớ họp ", SendAt: at(2 * time.Hour),
		Mentions: []Mention{{UserID: binh.id, Offset: 1, Length: 5}}, ReplyToMessageID: first.MessageID})
	if err != nil || it.Content != "@Bình nhớ họp" || it.Status != "pending" || it.ConversationID != g.ID || len(it.Mentions) != 1 ||
		it.Mentions[0].Offset != 0 || it.ReplyToMessageID == nil || *it.ReplyToMessageID != first.MessageID || it.MessageID != nil {
		t.Fatalf("tạo: %+v %v", it, err)
	}
	if ps := e.gw.packets("scheduled.updated", true); len(ps) != 1 || len(ps[0].users) != 1 || ps[0].users[0] != lan.id {
		t.Fatalf("scheduled.updated khi tạo: %+v", ps)
	}
	if ps := e.gw.packets("message.new", true); len(ps) != 0 {
		t.Fatalf("hẹn giờ không được gửi ngay: %+v", ps)
	}

	// danh sách: chỉ của mình
	if l, err := e.s.ListScheduled(ctx, lan.id, g.ID); err != nil || len(l.Items) != 1 || l.Items[0].ID != it.ID {
		t.Fatalf("danh sách của Lan: %+v %v", l, err)
	}
	if l, err := e.s.ListScheduled(ctx, binh.id, g.ID); err != nil || l.Items == nil || len(l.Items) != 0 {
		t.Fatalf("danh sách của Bình: %+v %v", l, err)
	}

	// sửa: người khác -> 404; đổi content không kèm mentions -> bỏ nhắc tên; chỉ đổi giờ giữ nội dung
	newText := "Họp lúc 9 giờ"
	_, err = e.s.UpdateScheduled(ctx, binh.id, it.ID, SchedulePatch{Content: &newText})
	wantCode(t, "người khác sửa", err, CodeNotFound)
	up, err := e.s.UpdateScheduled(ctx, lan.id, it.ID, SchedulePatch{Content: &newText})
	if err != nil || up.Content != newText || len(up.Mentions) != 0 || up.SendAt != it.SendAt {
		t.Fatalf("sửa nội dung: %+v %v", up, err)
	}
	later := at(3 * time.Hour)
	up, err = e.s.UpdateScheduled(ctx, lan.id, it.ID, SchedulePatch{SendAt: &later})
	if err != nil || up.Content != newText || up.SendAt == it.SendAt {
		t.Fatalf("sửa giờ: %+v %v", up, err)
	}
	soon := at(5 * time.Second)
	_, err = e.s.UpdateScheduled(ctx, lan.id, it.ID, SchedulePatch{SendAt: &soon})
	wantCode(t, "sửa giờ quá sớm", err, CodeBadRequest)

	// huỷ: người khác -> 404; huỷ rồi -> SCHEDULED_DONE (cả sửa)
	two, err := e.s.CreateScheduled(ctx, lan.id, g.ID, ScheduleInput{Content: "huỷ tôi", SendAt: at(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	wantCode(t, "người khác huỷ", e.s.CancelScheduled(ctx, binh.id, two.ID), CodeNotFound)
	if err := e.s.CancelScheduled(ctx, lan.id, two.ID); err != nil {
		t.Fatal(err)
	}
	wantCode(t, "huỷ lại", e.s.CancelScheduled(ctx, lan.id, two.ID), CodeScheduledDone)
	_, err = e.s.UpdateScheduled(ctx, lan.id, two.ID, SchedulePatch{Content: &newText})
	wantCode(t, "sửa tin đã huỷ", err, CodeScheduledDone)
	if st, _, _ := e.schedStatus(two.ID); st != "canceled" {
		t.Fatalf("trạng thái sau huỷ: %s", st)
	}
	if l, _ := e.s.ListScheduled(ctx, lan.id, g.ID); len(l.Items) != 1 {
		t.Fatalf("danh sách sau huỷ: %+v", l)
	}

	// giới hạn 50 tin đang chờ / người / hội thoại
	if _, err := e.pool.Exec(ctx, `insert into chat_scheduled_messages (user_id, conversation_id, content, send_at)
		select $1, $2, 'đầy ' || i, now() + interval '300 days' from generate_series(1, 50) i`, binh.id, d.ID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.CreateScheduled(ctx, binh.id, d.ID, ScheduleInput{Content: "thứ 51", SendAt: at(time.Hour)})
	wantCode(t, "quá 50 tin", err, CodeScheduledLimit)
	if _, err := e.s.CreateScheduled(ctx, binh.id, g.ID, ScheduleInput{Content: "hội thoại khác", SendAt: at(time.Hour)}); err != nil {
		t.Fatalf("hội thoại khác không tính chung giới hạn: %v", err)
	}

	// HTTP: hình dạng JSON + {ok:true} của DELETE
	r := engineFor(e.s)
	w := call(r, "POST", "/api/v1/chat/conversations/"+itoa(g.ID)+"/scheduled", lan.token,
		`{"content":"qua HTTP","send_at":"`+at(time.Hour)+`"}`)
	body := w.Body.String()
	if w.Code != 200 || !strings.HasPrefix(body, `{"ok":true,"result":{"id":`) ||
		!strings.Contains(body, `,"conversation_id":`+itoa(g.ID)+`,"content":"qua HTTP","mentions":[],"reply_to_message_id":null,"send_at":"`) ||
		!strings.Contains(body, `"status":"pending","created_at":"`) {
		t.Fatalf("POST scheduled: %d %s", w.Code, body)
	}
	if w := call(r, "GET", "/api/v1/chat/conversations/"+itoa(g.ID)+"/scheduled", lan.token, ""); w.Code != 200 ||
		!strings.HasPrefix(w.Body.String(), `{"ok":true,"result":{"items":[{"id":`) {
		t.Fatalf("GET scheduled: %d %s", w.Code, w.Body.String())
	}
	if w := call(r, "DELETE", "/api/v1/chat/scheduled/"+itoa(it.ID), lan.token, ""); w.Code != 200 || w.Body.String() != `{"ok":true,"result":{"ok":true}}` {
		t.Fatalf("DELETE scheduled: %d %s", w.Code, w.Body.String())
	}
	if w := call(r, "PATCH", "/api/v1/chat/scheduled/"+itoa(it.ID), lan.token, `{"content":"x"}`); w.Code != 409 ||
		!strings.Contains(w.Body.String(), `"code":"SCHEDULED_DONE"`) {
		t.Fatalf("PATCH tin đã huỷ: %d %s", w.Code, w.Body.String())
	}
}

// Worker: tới hạn thì gửi đúng đường SendMessage (tin thật, message.new, ack chống trùng), không theo giới hạn gửi; không còn
// trong hội thoại -> failed; gửi lại sau khi "chết giữa chừng" không tạo tin thứ hai.
func TestScheduledWorkerDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireSchedSchema(t, e)
	ctx := context.Background()
	lan, binh, chau := e.user("Lan"), e.user("Bình"), e.user("Châu")
	e.friends(lan, binh)
	e.friends(lan, chau)
	g, err := e.s.CreateGroup(ctx, lan.id, "Nhóm worker", []int64{binh.id, chau.id})
	if err != nil {
		t.Fatal(err)
	}
	at := func(d time.Duration) string { return e.clk.now().Add(d).Format(time.RFC3339) }
	it, err := e.s.CreateScheduled(ctx, lan.id, g.ID, ScheduleInput{Content: "@Bình chúc mừng", SendAt: at(time.Minute),
		Mentions: []Mention{{UserID: binh.id, Offset: 0, Length: 5}}})
	if err != nil {
		t.Fatal(err)
	}
	gone, err := e.s.CreateScheduled(ctx, chau.id, g.ID, ScheduleInput{Content: "tin của Châu", SendAt: at(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.RemoveMember(ctx, chau.id, g.ID, chau.id); err != nil { // Châu rời nhóm trước giờ hẹn
		t.Fatal(err)
	}
	e.gw.packets("", true)

	// chưa tới giờ: không gửi gì
	if n, err := e.s.RunScheduledOnce(ctx); err != nil || n != 0 {
		t.Fatalf("chưa tới giờ: %d %v", n, err)
	}
	e.clk.add(2 * time.Minute)
	if n, err := e.s.RunScheduledOnce(ctx); err != nil || n != 2 {
		t.Fatalf("tới giờ: %d %v", n, err)
	}
	st, mid, _ := e.schedStatus(it.ID)
	if st != "sent" || mid == nil {
		t.Fatalf("tin của Lan: %s %v", st, mid)
	}
	var content, cid string
	var sender int64
	var mentions string
	if err := e.pool.QueryRow(ctx, `select content, sender_id, client_msg_id::text, coalesce(mentions::text, '') from chat_messages
		where id = $1 and conversation_id = $2`, *mid, g.ID).Scan(&content, &sender, &cid, &mentions); err != nil {
		t.Fatal(err)
	}
	if content != "@Bình chúc mừng" || sender != lan.id || cid != schedClientID(it.ID) || !strings.Contains(mentions, `"user_id": `+itoa(binh.id)) {
		t.Fatalf("tin đã gửi: %q %d %s %s", content, sender, cid, mentions)
	}
	if ps := e.gw.packets("message.new", false); len(ps) != 1 || ps[0].data.(MessageDTO).ID != *mid {
		t.Fatalf("message.new: %+v", ps)
	}
	var pkt *ScheduledDTO
	for _, p := range e.gw.packets("scheduled.updated", true) {
		if x := p.data.(ScheduledDTO); x.ID == it.ID {
			pkt = &x
		}
	}
	if pkt == nil || pkt.Status != "sent" || pkt.MessageID == nil || *pkt.MessageID != *mid {
		t.Fatalf("scheduled.updated khi gửi: %+v", pkt)
	}
	st, gmid, gerr := e.schedStatus(gone.ID)
	if st != "failed" || gmid != nil || gerr == nil || *gerr != "Bạn không còn trong cuộc trò chuyện này" {
		t.Fatalf("Châu đã rời: %s %v %v", st, gmid, gerr)
	}
	if l, _ := e.s.ListScheduled(ctx, lan.id, g.ID); len(l.Items) != 0 {
		t.Fatalf("đã gửi vẫn trong danh sách: %+v", l)
	}
	soon := at(time.Hour)
	_, err = e.s.UpdateScheduled(ctx, lan.id, it.ID, SchedulePatch{SendAt: &soon})
	wantCode(t, "sửa tin đã gửi", err, CodeScheduledDone)

	// "chết" sau khi tin đã lưu mà chưa ghi sent: lần sau ack trùng, không thêm tin
	if _, err := e.pool.Exec(ctx, `update chat_scheduled_messages set status = 'pending', sent_at = null, message_id = null where id = $1`, it.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := e.s.RunScheduledOnce(ctx); err != nil || n != 1 {
		t.Fatalf("gửi lại: %d %v", n, err)
	}
	if st, again, _ := e.schedStatus(it.ID); st != "sent" || again == nil || *again != *mid {
		t.Fatalf("gửi lại phải ra tin cũ: %s %v", st, again)
	}
	var cnt int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_messages where conversation_id = $1 and client_msg_id = $2::uuid`, g.ID, cid).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("số tin cùng client_msg_id: %d", cnt)
	}

	// nhiều tin tới hạn cùng lúc của một người: không vướng giới hạn 20 tin / giây
	if _, err := e.pool.Exec(ctx, `insert into chat_scheduled_messages (user_id, conversation_id, content, send_at)
		select $1, $2, 'loạt ' || i, $3::timestamptz from generate_series(1, 25) i`, binh.id, g.ID, e.clk.now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if n, err := e.s.RunScheduledOnce(ctx); err != nil || n != 25 {
		t.Fatalf("loạt 25 tin: %d %v", n, err)
	}
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_scheduled_messages where user_id = $1 and status = 'sent'`, binh.id).Scan(&cnt)
	if cnt != 25 {
		t.Fatalf("loạt 25 tin đã gửi: %d", cnt)
	}

	// StartScheduler / Shutdown: không treo
	e.s.StartScheduler()
	sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	e.s.Shutdown(sctx)
	if sctx.Err() != nil {
		t.Fatal("Shutdown chờ worker quá lâu")
	}
	e.s.StartScheduler() // sau Shutdown: bỏ qua
}
