package chat

import (
	"context"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"
)

// msgs: toàn bộ tin của hội thoại (tăng dần seq) nhìn từ u.
func (e *env) msgs(u *tu, conv int64) []MessageDTO {
	e.t.Helper()
	p, err := e.s.Messages(context.Background(), u.id, conv, nil, nil, 100)
	if err != nil {
		e.t.Fatal(err)
	}
	return p.Messages
}

func (e *env) conv(u *tu, id int64) *ConversationDetailDTO {
	e.t.Helper()
	d, err := e.s.Conversation(context.Background(), u.id, id)
	if err != nil {
		e.t.Fatal(err)
	}
	return d
}

func roleOf(d *ConversationDetailDTO, uid int64) string {
	for _, m := range d.Members {
		if m.UserID == uid {
			return m.Role
		}
	}
	return ""
}

// Nhóm: tạo / thêm / xoá / rời (chuyển trưởng nhóm) / đổi tên / đổi quyền - mỗi thao tác là 1 tin hệ thống có seq.
func TestGroupDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	lan, binh, chau, dung, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng"), e.user("Người lạ")
	e.friends(lan, binh)
	e.friends(lan, chau)
	e.friends(binh, dung)

	_, err := e.s.CreateGroup(ctx, lan.id, "  ", []int64{binh.id})
	wantCode(t, "tên trống", err, CodeBadRequest)
	_, err = e.s.CreateGroup(ctx, lan.id, "Nhóm A", []int64{lan.id})
	wantCode(t, "không có ai khác", err, CodeBadRequest)
	_, err = e.s.CreateGroup(ctx, lan.id, "Nhóm A", []int64{binh.id, la.id})
	wantCode(t, "có người không phải bạn", err, CodeForbidden)

	g, err := e.s.CreateGroup(ctx, lan.id, " Nhóm A ", []int64{binh.id, chau.id, binh.id})
	if err != nil {
		t.Fatal(err)
	}
	if g.Type != "group" || *g.Name != "Nhóm A" || g.MemberCount != 3 || g.Role != "owner" || g.LastSeq != 1 || g.Unread != 0 ||
		g.LastMessage == nil || g.LastMessage.MsgType != "system" || g.LastMessage.Content != "Lan đã tạo nhóm “Nhóm A”" || g.LastMessage.ClientMsgID != nil {
		t.Fatalf("tạo nhóm: %+v %+v", g, g.LastMessage)
	}
	if roleOf(g, binh.id) != "member" || roleOf(g, lan.id) != "owner" {
		t.Fatalf("vai trò: %+v", g.Members)
	}
	if pk := e.gw.packets("message.new", true); len(pk) != 1 || len(pk[0].users) != 3 {
		t.Fatalf("tin hệ thống phải tới cả 3 người: %+v", pk)
	}
	if gb := e.conv(binh, g.ID); gb.Unread != 1 || gb.Role != "member" {
		t.Fatalf("Bình thấy: %+v", gb)
	}

	// Bình (thành viên thường) thêm bạn của Bình; không thêm được người không phải bạn của Bình
	_, err = e.s.AddMembers(ctx, binh.id, g.ID, []int64{chau.id, la.id})
	wantCode(t, "thêm người không phải bạn", err, CodeForbidden)
	g, err = e.s.AddMembers(ctx, binh.id, g.ID, []int64{dung.id})
	if err != nil || g.MemberCount != 4 || g.LastSeq != 2 || g.LastMessage.Content != "Bình đã thêm Dũng vào nhóm" {
		t.Fatalf("thêm: %+v %v", g, err)
	}
	gd := e.conv(dung, g.ID)
	if gd.LastReadSeq != 1 || gd.LastDeliveredSeq != 1 || gd.Unread != 1 {
		t.Fatalf("người mới: con trỏ = tin lúc vào: %+v", gd)
	}
	// thêm người đã có: không sinh tin
	if g2, err := e.s.AddMembers(ctx, lan.id, g.ID, []int64{binh.id}); err != nil || g2.LastSeq != 2 {
		t.Fatalf("thêm người đã có: %+v %v", g2, err)
	}
	// không phải thành viên
	_, err = e.s.AddMembers(ctx, la.id, g.ID, []int64{lan.id})
	wantCode(t, "người ngoài thêm", err, CodeForbidden)

	// đổi tên: thành viên thường không được; trưởng nhóm được
	_, err = e.s.RenameGroup(ctx, binh.id, g.ID, "Tên mới")
	wantCode(t, "thành viên đổi tên", err, CodeForbidden)
	g, err = e.s.RenameGroup(ctx, lan.id, g.ID, "Nhóm B")
	if err != nil || *g.Name != "Nhóm B" || g.LastSeq != 3 || g.LastMessage.Content != "Lan đã đổi tên nhóm thành “Nhóm B”" {
		t.Fatalf("đổi tên: %+v %v", g, err)
	}
	if g2, _ := e.s.RenameGroup(ctx, lan.id, g.ID, "Nhóm B"); g2.LastSeq != 3 {
		t.Fatal("tên không đổi: không sinh tin")
	}

	// quyền: chỉ trưởng nhóm
	_, err = e.s.SetMemberRole(ctx, binh.id, g.ID, chau.id, "admin")
	wantCode(t, "thành viên đổi quyền", err, CodeForbidden)
	_, err = e.s.SetMemberRole(ctx, lan.id, g.ID, chau.id, "owner")
	wantCode(t, "role lạ", err, CodeBadRequest)
	_, err = e.s.SetMemberRole(ctx, lan.id, g.ID, lan.id, "member")
	wantCode(t, "đổi quyền chính mình", err, CodeBadRequest)
	g, err = e.s.SetMemberRole(ctx, lan.id, g.ID, chau.id, "admin")
	if err != nil || roleOf(g, chau.id) != "admin" || g.LastSeq != 4 || g.LastMessage.Content != "Lan đã đặt Châu làm quản trị viên" {
		t.Fatalf("đặt phó nhóm: %+v %v", g, err)
	}
	// phó nhóm đổi tên được; xoá thành viên thường được, không xoá được trưởng nhóm
	if _, err := e.s.RenameGroup(ctx, chau.id, g.ID, "Nhóm C"); err != nil {
		t.Fatal(err)
	}
	err = e.s.RemoveMember(ctx, chau.id, g.ID, lan.id)
	wantCode(t, "phó nhóm xoá trưởng nhóm", err, CodeForbidden)
	err = e.s.RemoveMember(ctx, binh.id, g.ID, dung.id)
	wantCode(t, "thành viên xoá người khác", err, CodeForbidden)
	e.gw.packets("", true)
	if err := e.s.RemoveMember(ctx, chau.id, g.ID, dung.id); err != nil {
		t.Fatal(err)
	}
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 || !containsID(pk[0].users, dung.id) || pk[0].data.(MessageDTO).Content != "Châu đã xoá Dũng khỏi nhóm" {
		t.Fatalf("người bị xoá cũng nhận tin hệ thống: %+v", pk)
	}
	_, err = e.s.Conversation(ctx, dung.id, g.ID)
	wantCode(t, "người bị xoá xem nhóm", err, CodeForbidden)
	_, err = e.s.SendMessage(ctx, dung.id, SendInput{ConversationID: g.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "còn đây"})
	wantCode(t, "người bị xoá gửi tin", err, CodeForbidden)
	err = e.s.RemoveMember(ctx, chau.id, g.ID, dung.id)
	wantCode(t, "xoá người đã rời", err, CodeNotFound)
	// bỏ phó nhóm
	g, err = e.s.SetMemberRole(ctx, lan.id, g.ID, chau.id, "member")
	if err != nil || g.LastMessage.Content != "Lan đã bỏ quyền quản trị của Châu" {
		t.Fatalf("bỏ phó nhóm: %+v %v", g, err)
	}
	// đặt lại Châu làm phó; Bình vào trước Châu nhưng chỉ là thành viên -> trưởng nhóm rời thì Châu (phó nhóm) lên
	if _, err := e.s.SetMemberRole(ctx, lan.id, g.ID, chau.id, "admin"); err != nil {
		t.Fatal(err)
	}
	if err := e.s.RemoveMember(ctx, lan.id, g.ID, lan.id); err != nil {
		t.Fatal(err)
	}
	g = e.conv(binh, g.ID)
	if roleOf(g, chau.id) != "owner" || roleOf(g, lan.id) != "" || g.MemberCount != 2 || g.LastMessage.Content != "Lan đã rời nhóm" {
		t.Fatalf("trưởng nhóm rời: %+v", g)
	}
	// không còn phó nhóm: thành viên vào sớm nhất lên trưởng nhóm
	if err := e.s.RemoveMember(ctx, chau.id, g.ID, chau.id); err != nil {
		t.Fatal(err)
	}
	if g = e.conv(binh, g.ID); roleOf(g, binh.id) != "owner" || g.MemberCount != 1 {
		t.Fatalf("chuyển cho thành viên: %+v", g)
	}
	// thêm lại người đã rời (Bình và Lan đã là bạn): vào lại với vai trò thành viên, con trỏ = tin hiện tại
	g, err = e.s.AddMembers(ctx, binh.id, g.ID, []int64{lan.id})
	if err != nil || g.MemberCount != 2 || roleOf(g, lan.id) != "member" {
		t.Fatalf("thêm lại: %+v %v", g, err)
	}
	if gl := e.conv(lan, g.ID); gl.LastReadSeq != g.LastSeq-1 || gl.Unread != 1 || gl.Left {
		t.Fatalf("Lan vào lại: %+v", gl)
	}
	// seq của mọi tin hệ thống liền mạch 1..N
	ms := e.msgs(binh, g.ID)
	for i, m := range ms {
		if m.Seq != int64(i+1) || m.MsgType != "system" {
			t.Fatalf("seq lệch tại %d: %+v", i, m)
		}
	}
	if int64(len(ms)) != g.LastSeq {
		t.Fatalf("%d tin, last_seq %d", len(ms), g.LastSeq)
	}
	// thao tác nhóm trên hội thoại 1-1
	d, _ := e.s.CreateDirect(ctx, lan.id, la.id)
	_, err = e.s.RenameGroup(ctx, lan.id, d.ID, "x")
	wantCode(t, "đổi tên 1-1", err, CodeBadRequest)
	err = e.s.RemoveMember(ctx, lan.id, d.ID, lan.id)
	wantCode(t, "rời 1-1", err, CodeBadRequest)
}

func containsID(ids []int64, id int64) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// Gửi tin: kiểm tra, chặn, chống trùng tuần tự + song song, 50 tin song song -> seq 1..50 liền mạch.
func TestSendDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, la := e.user("An"), e.user("Bình"), e.user("Lạ")
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	cid := newUUID()
	in := SendInput{ConversationID: d.ID, ClientMsgID: cid, MsgType: "text", Content: " Chào bạn "}
	ack, err := e.s.SendMessage(ctx, a.id, in)
	if err != nil || ack.Seq != 1 || ack.Duplicate || ack.MessageID <= 0 || *ack.ClientMsgID != cid || ack.CreatedAt == "" {
		t.Fatalf("gửi: %+v %v", ack, err)
	}
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 || len(pk[0].users) != 2 || pk[0].data.(MessageDTO).Content != "Chào bạn" || pk[0].data.(MessageDTO).SenderName != "An" {
		t.Fatalf("message.new: %+v", pk)
	}
	// gửi lại cùng client_msg_id: ack cũ, không phân phối lại, không thêm dòng
	ack2, err := e.s.SendMessage(ctx, a.id, in)
	if err != nil || !ack2.Duplicate || ack2.Seq != 1 || ack2.MessageID != ack.MessageID || ack2.CreatedAt != ack.CreatedAt {
		t.Fatalf("gửi lại: %+v %v", ack2, err)
	}
	if len(e.gw.packets("message.new", true)) != 0 {
		t.Error("tin trùng không phân phối lại")
	}
	// cùng client_msg_id nhưng người khác gửi: là tin khác
	if ack3, err := e.s.SendMessage(ctx, b.id, in); err != nil || ack3.Duplicate || ack3.Seq != 2 {
		t.Fatalf("người khác cùng id: %+v %v", ack3, err)
	}
	// kiểm tra đầu vào
	for name, x := range map[string]SendInput{
		"ảnh":   {ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "image", Content: "a"},
		"trống": {ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "   "},
		"uuid":  {ConversationID: d.ID, ClientMsgID: "x", MsgType: "text", Content: "a"},
	} {
		_, err := e.s.SendMessage(ctx, a.id, x)
		wantCode(t, name, err, CodeBadRequest)
	}
	_, err = e.s.SendMessage(ctx, la.id, SendInput{ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "a"})
	wantCode(t, "người ngoài gửi", err, CodeForbidden)
	_, err = e.s.SendMessage(ctx, a.id, SendInput{ConversationID: 1 << 50, ClientMsgID: newUUID(), MsgType: "text", Content: "a"})
	wantCode(t, "hội thoại không có", err, CodeForbidden)
	// chặn nhau: không gửi được nữa (cả hai chiều); gửi lại tin cũ vẫn trả ack cũ
	if err := e.s.Block(ctx, b.id, a.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SendMessage(ctx, a.id, SendInput{ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "a"})
	wantCode(t, "gửi cho người chặn mình", err, CodeBlocked)
	_, err = e.s.SendMessage(ctx, b.id, SendInput{ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "a"})
	wantCode(t, "gửi cho người mình chặn", err, CodeBlocked)
	if ack4, err := e.s.SendMessage(ctx, a.id, in); err != nil || !ack4.Duplicate {
		t.Fatalf("gửi lại tin cũ khi đã bị chặn: %+v %v", ack4, err)
	}
	_ = e.s.Unblock(ctx, b.id, a.id)

	// giới hạn 20 tin / giây / người (đồng hồ giả đứng yên: bucket không tự hồi)
	e.clk.add(2 * time.Second) // hồi đầy sau các lượt ở trên
	for i := 0; i < 20; i++ {
		e.send(a, d.ID, "nhanh "+strconv.Itoa(i))
	}
	_, err = e.s.SendMessage(ctx, a.id, SendInput{ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "quá nhanh"})
	wantCode(t, "tin thứ 21 trong 1 giây", err, CodeRateLimit)
	e.clk.add(time.Second)
	if _, err := e.s.SendMessage(ctx, a.id, SendInput{ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: "text", Content: "sau 1 giây"}); err != nil {
		t.Fatalf("sau 1 giây: %v", err)
	}

	// song song: nâng giới hạn để đo đúng phần cấp seq
	e.s.sendLimit = newLimiter(100000, time.Second, e.clk.now)
	g := e.newGroupFor(t, a, b)
	dupID := newUUID()
	var wg sync.WaitGroup
	acks := make([]*SendAck, 10)
	errs := make([]error, 10)
	for i := range acks {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			acks[i], errs[i] = e.s.SendMessage(ctx, a.id, SendInput{ConversationID: g, ClientMsgID: dupID, MsgType: "text", Content: "trùng"})
		}(i)
	}
	wg.Wait()
	dup := 0
	for i := range acks {
		if errs[i] != nil {
			t.Fatalf("gửi trùng song song: %v", errs[i])
		}
		if acks[i].MessageID != acks[0].MessageID || acks[i].Seq != acks[0].Seq {
			t.Fatalf("gửi trùng song song ra 2 tin: %+v %+v", acks[0], acks[i])
		}
		if acks[i].Duplicate {
			dup++
		}
	}
	var rows int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_messages where conversation_id = $1 and client_msg_id = $2::uuid`, g, dupID).Scan(&rows)
	if rows != 1 || dup != 9 {
		t.Fatalf("gửi trùng song song: %d dòng, %d ack trùng", rows, dup)
	}
	base := acks[0].Seq
	seqs := make([]int64, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			from := a
			if i%2 == 1 {
				from = b
			}
			ack, err := e.s.SendMessage(ctx, from.id, SendInput{ConversationID: g, ClientMsgID: newUUID(), MsgType: "text", Content: "tin " + strconv.Itoa(i)})
			if err != nil {
				t.Error(err)
				return
			}
			seqs[i] = ack.Seq
		}(i)
	}
	wg.Wait()
	sort.Slice(seqs, func(i, j int) bool { return seqs[i] < seqs[j] })
	for i, s := range seqs {
		if s != base+int64(i)+1 {
			t.Fatalf("50 tin song song: seq %v không liền mạch từ %d", seqs, base+1)
		}
	}
	ms := e.msgs(a, g)
	for i := 1; i < len(ms); i++ {
		if ms[i].Seq != ms[i-1].Seq+1 || ms[i].CreatedAt < ms[i-1].CreatedAt {
			t.Fatalf("lịch sử lệch tại %d: %+v %+v", i, ms[i-1], ms[i])
		}
	}
}

// newGroupFor: nhóm của owner với các thành viên (kết bạn trước nếu cần).
func (e *env) newGroupFor(t *testing.T, owner *tu, others ...*tu) int64 {
	t.Helper()
	ids := []int64{}
	for _, o := range others {
		if mine, _, _ := friendState(context.Background(), e.pool, owner.id, o.id); mine != "accepted" {
			e.friends(owner, o)
		}
		ids = append(ids, o.id)
	}
	g, err := e.s.CreateGroup(context.Background(), owner.id, "Nhóm thử", ids)
	if err != nil {
		t.Fatal(err)
	}
	return g.ID
}

// Đã nhận / đã xem: không lùi, kẹp ở last_seq, read kéo delivered, ẩn read_seq khi tắt hiển thị đã xem; số chưa đọc.
func TestReceiptsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c := e.user("An"), e.user("Bình"), e.user("Châu")
	g := e.newGroupFor(t, a, b, c) // seq 1 = tin tạo nhóm
	for i := 0; i < 3; i++ {
		e.send(a, g, "tin "+strconv.Itoa(i)) // seq 2..4
	}
	if gb := e.conv(b, g); gb.Unread != 4 || gb.LastSeq != 4 {
		t.Fatalf("Bình chưa đọc: %+v", gb)
	}
	if ga := e.conv(a, g); ga.Unread != 0 || ga.LastReadSeq != 4 {
		t.Fatalf("tin của mình không tính chưa đọc: %+v", ga)
	}
	e.gw.packets("", true)
	ack, err := e.s.MarkReceipt(ctx, b.id, g, 3, false)
	if err != nil || ack.DeliveredSeq != 3 || ack.ReadSeq != 0 {
		t.Fatalf("delivered 3: %+v %v", ack, err)
	}
	pk := e.gw.packets("receipt.update", true)
	if len(pk) != 2 || len(pk[0].users) != 1 || pk[0].users[0] != b.id || len(pk[1].users) != 2 {
		t.Fatalf("receipt.update: %+v", pk)
	}
	if u := pk[1].data.(ReceiptUpdate); u.UserID != b.id || u.DeliveredSeq != 3 || u.ReadSeq == nil || *u.ReadSeq != 0 {
		t.Fatalf("receipt.update cho người khác: %+v", u)
	}
	// không lùi: không đổi gì -> không gửi gói
	ack, _ = e.s.MarkReceipt(ctx, b.id, g, 2, false)
	if ack.DeliveredSeq != 3 || len(e.gw.packets("receipt.update", true)) != 0 {
		t.Fatalf("lùi delivered: %+v", ack)
	}
	// read 2: read = 2, delivered giữ 3
	if ack, _ = e.s.MarkReceipt(ctx, b.id, g, 2, true); ack.ReadSeq != 2 || ack.DeliveredSeq != 3 {
		t.Fatalf("read 2: %+v", ack)
	}
	if gb := e.conv(b, g); gb.Unread != 2 {
		t.Fatalf("chưa đọc sau read 2: %+v", gb)
	}
	// seq quá last_seq: kẹp
	if ack, _ = e.s.MarkReceipt(ctx, b.id, g, 999, true); ack.ReadSeq != 4 || ack.DeliveredSeq != 4 {
		t.Fatalf("kẹp seq: %+v", ack)
	}
	if gb := e.conv(b, g); gb.Unread != 0 {
		t.Fatalf("đọc hết: %+v", gb)
	}
	// tắt hiển thị đã xem: người khác nhận read_seq null, chi tiết nhóm ẩn last_read_seq của người đó (trừ chính họ)
	off := false
	if _, err := e.s.UpdateMe(ctx, c.id, MePatch{ShowReadReceipts: &off}); err != nil {
		t.Fatal(err)
	}
	e.gw.packets("", true)
	if _, err := e.s.MarkReceipt(ctx, c.id, g, 4, true); err != nil {
		t.Fatal(err)
	}
	pk = e.gw.packets("receipt.update", true)
	if len(pk) != 2 || pk[0].data.(ReceiptUpdate).ReadSeq == nil || pk[1].data.(ReceiptUpdate).ReadSeq != nil || pk[1].data.(ReceiptUpdate).DeliveredSeq != 4 {
		t.Fatalf("ẩn đã xem: %+v", pk)
	}
	member := func(d *ConversationDetailDTO, uid int64) MemberDTO {
		for _, m := range d.Members {
			if m.UserID == uid {
				return m
			}
		}
		t.Fatalf("thiếu thành viên %d", uid)
		return MemberDTO{}
	}
	if m := member(e.conv(a, g), c.id); m.LastReadSeq != nil || m.LastDeliveredSeq != 4 {
		t.Fatalf("An xem Châu: %+v", m)
	}
	if m := member(e.conv(c, g), c.id); m.LastReadSeq == nil || *m.LastReadSeq != 4 {
		t.Fatalf("Châu xem chính mình: %+v", m)
	}
	if m := member(e.conv(a, g), b.id); m.LastReadSeq == nil || *m.LastReadSeq != 4 {
		t.Fatalf("An xem Bình: %+v", m)
	}
	_, err = e.s.MarkReceipt(ctx, e.user("Lạ").id, g, 1, true)
	wantCode(t, "người ngoài", err, CodeForbidden)
	_, err = e.s.MarkReceipt(ctx, b.id, g, -1, true)
	wantCode(t, "seq âm", err, CodeBadRequest)
	if n, err := e.s.unreadTotals(ctx, []int64{b.id}); err != nil || n[b.id] != 0 {
		t.Fatalf("tổng chưa đọc Bình: %v %v", n, err)
	}
	e.send(a, g, "mới")
	if n, _ := e.s.unreadTotals(ctx, []int64{a.id, b.id}); n[b.id] != 1 || n[a.id] != 0 {
		t.Fatalf("tổng chưa đọc sau 1 tin: %v", n)
	}
}

func TestMessagesPagingDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	for i := 1; i <= 7; i++ {
		e.send(a, d.ID, "tin "+strconv.Itoa(i))
	}
	i64 := func(v int64) *int64 { return &v }
	check := func(name string, before, after *int64, limit int, want []int64, more bool) {
		t.Helper()
		p, err := e.s.Messages(ctx, b.id, d.ID, before, after, limit)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var got []int64
		for _, m := range p.Messages {
			got = append(got, m.Seq)
		}
		if strconv.Quote(fmtSeq(got)) != strconv.Quote(fmtSeq(want)) || p.HasMore != more {
			t.Fatalf("%s: %v has_more %v, muốn %v %v", name, got, p.HasMore, want, more)
		}
	}
	check("mới nhất", nil, nil, 3, []int64{5, 6, 7}, true)
	check("trước 5", i64(5), nil, 3, []int64{2, 3, 4}, true)
	check("trước 2", i64(2), nil, 3, []int64{1}, false)
	check("sau 4", nil, i64(4), 2, []int64{5, 6}, true)
	check("sau 6", nil, i64(6), 2, []int64{7}, false)
	check("sau 7", nil, i64(7), 2, nil, false)
	check("tất cả", nil, nil, 0, []int64{1, 2, 3, 4, 5, 6, 7}, false)
	_, err := e.s.Messages(ctx, b.id, d.ID, i64(3), i64(1), 10)
	wantCode(t, "cả before và after", err, CodeBadRequest)
	_, err = e.s.Messages(ctx, e.user("Lạ").id, d.ID, nil, nil, 10)
	wantCode(t, "người ngoài đọc", err, CodeForbidden)
	p, _ := e.s.Messages(ctx, b.id, d.ID, nil, nil, 1)
	if m := p.Messages[0]; m.SenderID != a.id || m.SenderName != "An" || m.MsgType != "text" || m.Content != "tin 7" || m.ClientMsgID == nil || m.ConversationID != d.ID {
		t.Fatalf("tin: %+v", m)
	}
}

func fmtSeq(xs []int64) string {
	s := ""
	for _, x := range xs {
		s += strconv.FormatInt(x, 10) + ","
	}
	return s
}

// Danh sách hội thoại: tin mới nhất trước, hội thoại chưa có tin ở cuối, phân trang bằng cursor; tắt thông báo.
func TestListConversationsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	me := e.user("Tôi")
	var ids []int64
	for i := 0; i < 4; i++ {
		o := e.user("Bạn " + strconv.Itoa(i))
		d, err := e.s.CreateDirect(ctx, me.id, o.id)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, d.ID)
	}
	e.send(me, ids[1], "cũ")
	e.send(me, ids[0], "mới hơn")
	e.send(me, ids[2], "mới nhất")
	// ids[3] chưa có tin: cuối danh sách
	want := []int64{ids[2], ids[0], ids[1], ids[3]}
	var got []int64
	cursor := ""
	pages := 0
	for {
		l, err := e.s.ListConversations(ctx, me.id, cursor, 1)
		if err != nil {
			t.Fatal(err)
		}
		pages++
		if l.SyncCursor == "" {
			t.Fatal("thiếu sync_cursor")
		}
		for _, c := range l.Conversations {
			got = append(got, c.ID)
		}
		if l.NextCursor == nil {
			break
		}
		cursor = *l.NextCursor
		if pages > 10 {
			t.Fatal("cursor lặp vô hạn")
		}
	}
	if fmtSeq(got) != fmtSeq(want) {
		t.Fatalf("thứ tự %v, muốn %v", got, want)
	}
	l, _ := e.s.ListConversations(ctx, me.id, "", 0)
	if len(l.Conversations) != 4 || l.NextCursor != nil || l.Conversations[0].LastMessage.Content != "mới nhất" ||
		l.Conversations[0].Peer == nil || l.Conversations[0].Unread != 0 {
		t.Fatalf("trang đủ: %+v", l)
	}
	_, err := e.s.ListConversations(ctx, me.id, "hỏng", 10)
	wantCode(t, "cursor hỏng", err, CodeBadRequest)

	// tắt thông báo
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	forever, past := "forever", time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	c, err := e.s.Mute(ctx, me.id, ids[0], &forever)
	if err != nil || c.MutedUntil == nil || *c.MutedUntil != "forever" {
		t.Fatalf("tắt vĩnh viễn: %+v %v", c, err)
	}
	if c, _ = e.s.Mute(ctx, me.id, ids[0], &future); c.MutedUntil == nil || (*c.MutedUntil)[:16] != future[:16] {
		t.Fatalf("tắt tới: %+v", c.MutedUntil)
	}
	if c, _ = e.s.Mute(ctx, me.id, ids[0], &past); c.MutedUntil != nil {
		t.Fatalf("quá khứ = bật lại: %+v", c.MutedUntil)
	}
	_, _ = e.s.Mute(ctx, me.id, ids[0], &forever)
	if c, _ = e.s.Mute(ctx, me.id, ids[0], nil); c.MutedUntil != nil {
		t.Fatalf("null = bật lại: %+v", c.MutedUntil)
	}
	bad := "mai"
	_, err = e.s.Mute(ctx, me.id, ids[0], &bad)
	wantCode(t, "until sai", err, CodeBadRequest)
	_, err = e.s.Mute(ctx, e.user("Lạ").id, ids[0], nil)
	wantCode(t, "người ngoài", err, CodeForbidden)
}

// /sync: hội thoại thay đổi từ cursor (tin mới, con trỏ của tôi), bị xoá khỏi nhóm -> left: true; không đổi thì không có.
func TestSyncDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c := e.user("An"), e.user("Bình"), e.user("Châu")
	g := e.newGroupFor(t, a, b, c)
	d, _ := e.s.CreateDirect(ctx, b.id, c.id)
	quiet, _ := e.s.CreateDirect(ctx, b.id, a.id)
	e.send(b, d.ID, "chào")
	// lùi mọi mốc thời gian của 3 hội thoại về 1 phút trước
	for _, id := range []int64{g, d.ID, quiet.ID} {
		for _, q := range []string{`update chat_conversations set updated_at = updated_at - interval '1 minute' where id = $1`,
			`update chat_conversation_members set updated_at = updated_at - interval '1 minute' where conversation_id = $1`} {
			if _, err := e.pool.Exec(ctx, q, id); err != nil {
				t.Fatal(err)
			}
		}
	}
	l, _ := e.s.ListConversations(ctx, b.id, "", 10)
	cursor := l.SyncCursor
	if r, err := e.s.Sync(ctx, b.id, cursor); err != nil || len(r.Conversations) != 0 || r.Truncated || r.SyncCursor == "" {
		t.Fatalf("chưa có gì đổi: %+v %v", r, err)
	}
	e.send(c, d.ID, "tin mới")
	if err := e.s.RemoveMember(ctx, a.id, g, b.id); err != nil {
		t.Fatal(err)
	}
	r, err := e.s.Sync(ctx, b.id, cursor)
	if err != nil {
		t.Fatal(err)
	}
	by := map[int64]ConversationDTO{}
	for _, x := range r.Conversations {
		by[x.ID] = x
	}
	if len(r.Conversations) != 2 || by[d.ID].LastSeq != 2 || by[d.ID].Unread != 1 || by[d.ID].Left || !by[g].Left || by[g].Unread != 0 || by[g].LastMessage != nil {
		t.Fatalf("sync: %+v", r.Conversations)
	}
	if _, ok := by[quiet.ID]; ok {
		t.Error("hội thoại không đổi không được trả")
	}
	// nhóm đã rời: tin mới trong nhóm không làm hiện lại dòng left
	r2c := r.SyncCursor
	if _, err := e.pool.Exec(ctx, `update chat_conversation_members set updated_at = updated_at - interval '1 minute' where conversation_id = $1 and user_id = $2`, g, b.id); err != nil {
		t.Fatal(err)
	}
	e.send(a, g, "Bình không thấy")
	r2, _ := e.s.Sync(ctx, b.id, r2c)
	for _, x := range r2.Conversations {
		if x.ID == g {
			t.Fatalf("nhóm đã rời hiện lại vì tin mới: %+v", x)
		}
	}
	// đọc tin = dòng thành viên của tôi đổi -> có trong sync
	if _, err := e.s.MarkReceipt(ctx, b.id, d.ID, 2, true); err != nil {
		t.Fatal(err)
	}
	r3, _ := e.s.Sync(ctx, b.id, r2c)
	found := false
	for _, x := range r3.Conversations {
		if x.ID == d.ID && x.Unread == 0 && x.LastReadSeq == 2 {
			found = true
		}
	}
	if !found {
		t.Fatalf("đọc tin phải có trong sync: %+v", r3.Conversations)
	}
	_, err = e.s.Sync(ctx, b.id, "")
	wantCode(t, "thiếu cursor", err, CodeBadRequest)
}

// Online: bạn bè hoặc chung hội thoại mới được xem; bị chặn thì không; offline ghi last_seen_at.
func TestPresenceDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, friend, peer, la, blocker := e.user("An"), e.user("Bạn"), e.user("Chung hội thoại"), e.user("Lạ"), e.user("Chặn")
	e.friends(a, friend)
	e.friends(a, blocker)
	pd, err := e.s.CreateDirect(ctx, a.id, peer.id)
	if err != nil {
		t.Fatal(err)
	}
	e.send(peer, pd.ID, "chào An") // chat 1-1 chỉ cho xem online khi người kia đã nhắn (TestPresenceStrangerDB)
	if err := e.s.Block(ctx, blocker.id, a.id); err != nil {
		t.Fatal(err)
	}
	at := time.Now().Add(-5 * time.Minute).UTC().Truncate(time.Millisecond)
	e.s.PresenceChanged(friend.id, false, at)
	e.s.PresenceChanged(friend.id, true, time.Now()) // online không ghi gì
	got, err := e.s.PresenceInfo(ctx, a.id, []int64{friend.id, peer.id, la.id, blocker.id, a.id, friend.id, -1})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || !got[friend.id].Equal(at) || !got[peer.id].IsZero() {
		t.Fatalf("presence: %v", got)
	}
	if _, ok := got[la.id]; ok {
		t.Error("người lạ không được xem")
	}
	if _, ok := got[blocker.id]; ok {
		t.Error("người chặn mình không được xem")
	}
	if got, _ := e.s.PresenceInfo(ctx, a.id, nil); len(got) != 0 {
		t.Error("rỗng")
	}
	// đang soạn tin: thành viên trừ mình; người ngoài -> lỗi
	d, _ := e.s.CreateDirect(ctx, a.id, peer.id)
	tg, err := e.s.TypingTargets(ctx, a.id, d.ID)
	if err != nil || len(tg) != 1 || tg[0] != peer.id {
		t.Fatalf("typing: %v %v", tg, err)
	}
	if _, err := e.s.TypingTargets(ctx, la.id, d.ID); err == nil {
		t.Fatal("người ngoài gõ phải lỗi")
	}
	// cache thành viên được bỏ khi thêm người vào nhóm
	g := e.newGroupFor(t, a, friend)
	if tg, _ := e.s.TypingTargets(ctx, a.id, g); len(tg) != 1 {
		t.Fatalf("typing nhóm: %v", tg)
	}
	e.friends(a, la)
	if _, err := e.s.AddMembers(ctx, a.id, g, []int64{la.id}); err != nil {
		t.Fatal(err)
	}
	if tg, _ := e.s.TypingTargets(ctx, a.id, g); len(tg) != 2 {
		t.Fatalf("typing sau khi thêm: %v", tg)
	}
}
