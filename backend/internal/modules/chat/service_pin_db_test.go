package chat

import (
	"context"
	"testing"
)

func requirePinSchema(t *testing.T, e *env) {
	t.Helper()
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select to_regclass('public.chat_pinned_messages') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có bảng chat_pinned_messages (áp 0021_chat_pins.sql): %v", err)
	}
}

// Ghim tin: quyền theo vai trò nhóm / chat 1-1, tối đa 5, tin hệ thống, tin hội thoại khác, tin hệ thống "đã ghim", pins.updated.
func TestPinsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requirePinSchema(t, e)
	ctx := context.Background()
	lan, binh, chau := e.user("Lan"), e.user("Bình"), e.user("Châu")
	e.friends(lan, binh)
	e.friends(lan, chau)
	g, err := e.s.CreateGroup(ctx, lan.id, "Nhóm ghim", []int64{binh.id, chau.id})
	if err != nil {
		t.Fatal(err)
	}
	var acks []*SendAck
	for i := 0; i < 7; i++ {
		acks = append(acks, e.send(binh, g.ID, "tin "+itoa(int64(i))))
	}
	e.gw.packets("", true)

	// thành viên thường không ghim được trong nhóm
	_, err = e.s.PinMessage(ctx, binh.id, g.ID, acks[0].MessageID)
	wantCode(t, "thành viên thường ghim", err, CodeForbidden)

	l, err := e.s.PinMessage(ctx, lan.id, g.ID, acks[0].MessageID)
	if err != nil || len(l.Pins) != 1 || l.Pins[0].MessageID != acks[0].MessageID || l.Pins[0].Content != "tin 0" ||
		l.Pins[0].PinnedBy != lan.id || l.Pins[0].PinnedByName != "Lan" || l.Pins[0].SenderName != "Bình" {
		t.Fatalf("ghim: %+v %v", l, err)
	}
	var sys string
	_ = e.pool.QueryRow(ctx, `select content from chat_messages where conversation_id = $1 and message_type = 'system'
		order by seq desc limit 1`, g.ID).Scan(&sys)
	if sys != "Lan đã ghim một tin nhắn" {
		t.Fatalf("tin hệ thống: %q", sys)
	}
	if ps := e.gw.packets("pins.updated", false); len(ps) != 1 || len(ps[0].users) != 3 || ps[0].data.(*PinList).ConversationID != g.ID {
		t.Fatalf("pins.updated: %+v", ps)
	}
	if ps := e.gw.packets("message.new", true); len(ps) != 1 {
		t.Fatalf("message.new của tin hệ thống: %d", len(ps))
	}

	// ghim lại: giữ nguyên, không tin hệ thống, không gói
	if l, err = e.s.PinMessage(ctx, lan.id, g.ID, acks[0].MessageID); err != nil || len(l.Pins) != 1 {
		t.Fatalf("ghim lại: %+v %v", l, err)
	}
	if len(e.gw.packets("pins.updated", false))+len(e.gw.packets("message.new", true)) != 0 {
		t.Fatal("ghim lại không được gửi gói")
	}

	// không ghim tin hệ thống
	var sysID int64
	_ = e.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and message_type = 'system' limit 1`, g.ID).Scan(&sysID)
	_, err = e.s.PinMessage(ctx, lan.id, g.ID, sysID)
	wantCode(t, "ghim tin hệ thống", err, CodeBadRequest)

	// tin của hội thoại khác
	d, _ := e.s.CreateDirect(ctx, lan.id, binh.id)
	other := e.send(lan, d.ID, "riêng")
	_, err = e.s.PinMessage(ctx, lan.id, g.ID, other.MessageID)
	wantCode(t, "ghim tin hội thoại khác", err, CodeNotFound)

	// phó nhóm ghim được; tối đa 5
	if _, err := e.s.SetMemberRole(ctx, lan.id, g.ID, chau.id, "admin"); err != nil {
		t.Fatal(err)
	}
	for i := 1; i < 5; i++ {
		if _, err := e.s.PinMessage(ctx, chau.id, g.ID, acks[i].MessageID); err != nil {
			t.Fatalf("ghim %d: %v", i, err)
		}
	}
	_, err = e.s.PinMessage(ctx, lan.id, g.ID, acks[5].MessageID)
	wantCode(t, "ghim quá 5", err, CodeBadRequest)

	// danh sách: mới ghim trước; thành viên thường xem được
	if l, err = e.s.Pins(ctx, binh.id, g.ID); err != nil || len(l.Pins) != 5 || l.Pins[0].MessageID != acks[4].MessageID {
		t.Fatalf("danh sách: %+v %v", l, err)
	}

	// bỏ ghim: thành viên thường không được; trưởng nhóm được, gửi pins.updated, không tin hệ thống
	_, err = e.s.UnpinMessage(ctx, binh.id, g.ID, acks[0].MessageID)
	wantCode(t, "thành viên thường bỏ ghim", err, CodeForbidden)
	e.gw.packets("", true)
	if l, err = e.s.UnpinMessage(ctx, lan.id, g.ID, acks[0].MessageID); err != nil || len(l.Pins) != 4 {
		t.Fatalf("bỏ ghim: %+v %v", l, err)
	}
	if len(e.gw.packets("pins.updated", false)) != 1 || len(e.gw.packets("message.new", true)) != 0 {
		t.Fatal("bỏ ghim: phải có đúng 1 pins.updated, không message.new")
	}
	if l, err = e.s.UnpinMessage(ctx, lan.id, g.ID, acks[0].MessageID); err != nil || len(l.Pins) != 4 || len(e.gw.packets("pins.updated", true)) != 0 {
		t.Fatalf("bỏ ghim lần 2: %+v %v", l, err)
	}

	// chat 1-1: cả hai bên ghim / bỏ ghim
	if l, err = e.s.PinMessage(ctx, binh.id, d.ID, other.MessageID); err != nil || len(l.Pins) != 1 {
		t.Fatalf("ghim 1-1: %+v %v", l, err)
	}
	if l, err = e.s.UnpinMessage(ctx, lan.id, d.ID, other.MessageID); err != nil || len(l.Pins) != 0 {
		t.Fatalf("bỏ ghim 1-1: %+v %v", l, err)
	}

	// người ngoài
	_, err = e.s.Pins(ctx, chau.id, d.ID)
	wantCode(t, "người ngoài xem ghim", err, CodeForbidden)
	_, err = e.s.PinMessage(ctx, chau.id, d.ID, other.MessageID)
	wantCode(t, "người ngoài ghim", err, CodeForbidden)
}
