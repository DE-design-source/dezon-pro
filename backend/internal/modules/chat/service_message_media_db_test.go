package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Tin có tệp đính kèm (design mục 4): kiểm đầu vào, gửi, ack / message.new / push, gửi trùng, đọc lại.

func TestValidateSendMedia(t *testing.T) {
	u := "0b5e2c1e-6b0e-4c55-9d3a-6f1f5b0d2a11"
	long := strings.Repeat("a", maxContent+1)
	for _, c := range []struct {
		name string
		in   SendInput
		code string // "" = hợp lệ
	}{
		{"text", SendInput{MsgType: "text", Content: " chào "}, ""},
		{"text trống", SendInput{MsgType: "text", Content: "  "}, CodeBadRequest},
		{"text quá dài", SendInput{MsgType: "text", Content: long}, CodeBadRequest},
		{"text kèm tệp", SendInput{MsgType: "text", Content: "a", Attachments: []int64{1}}, CodeBadRequest},
		{"text kèm file_name", SendInput{MsgType: "text", Content: "a", FileName: "a.pdf"}, CodeBadRequest},
		{"image không chú thích", SendInput{MsgType: "image", Attachments: []int64{1}}, ""},
		{"image có chú thích", SendInput{MsgType: "image", Content: "ảnh", Attachments: []int64{1}}, ""},
		{"image không tệp", SendInput{MsgType: "image", Content: "a"}, CodeBadRequest},
		{"image 2 tệp", SendInput{MsgType: "image", Attachments: []int64{1, 2}}, CodeBadRequest},
		{"image id 0", SendInput{MsgType: "image", Attachments: []int64{0}}, CodeBadRequest},
		{"image chú thích quá dài", SendInput{MsgType: "image", Content: long, Attachments: []int64{1}}, CodeBadRequest},
		{"image chú thích có NUL", SendInput{MsgType: "image", Content: "a\x00b", Attachments: []int64{1}}, CodeBadRequest},
		{"image kèm file_name", SendInput{MsgType: "image", Attachments: []int64{1}, FileName: "a.png"}, CodeBadRequest},
		{"video", SendInput{MsgType: "video", Attachments: []int64{1}}, ""},
		{"video kèm file_name", SendInput{MsgType: "video", Attachments: []int64{1}, FileName: "a.mp4"}, CodeBadRequest},
		{"file", SendInput{MsgType: "file", Attachments: []int64{1}}, ""},
		{"file có tên + chú thích", SendInput{MsgType: "file", Content: "xem", Attachments: []int64{1}, FileName: "b.pdf"}, ""},
		{"file tên .exe", SendInput{MsgType: "file", Attachments: []int64{1}, FileName: "a.EXE."}, CodeMediaType},
		{"file không tệp", SendInput{MsgType: "file"}, CodeBadRequest},
		{"voice", SendInput{MsgType: "voice", Attachments: []int64{1}}, ""},
		{"voice có chữ", SendInput{MsgType: "voice", Content: "a", Attachments: []int64{1}}, CodeBadRequest},
		{"voice kèm file_name", SendInput{MsgType: "voice", Attachments: []int64{1}, FileName: "a.webm"}, CodeBadRequest},
		{"voice 2 tệp", SendInput{MsgType: "voice", Attachments: []int64{1, 2}}, CodeBadRequest},
		{"system", SendInput{MsgType: "system", Content: "a"}, CodeBadRequest},
		{"loại lạ", SendInput{MsgType: "sticker", Attachments: []int64{1}}, CodeBadRequest},
	} {
		in := c.in
		in.ConversationID, in.ClientMsgID = 1, u
		err := validateSend(&in)
		if got := codeOf(err); (c.code == "" && err != nil) || (c.code != "" && got != c.code) {
			t.Errorf("%s: %v, muốn %q", c.name, err, c.code)
		}
	}
	// file_name được làm sạch; bỏ trống giữ rỗng (lấy tên lúc tải lên khi gửi)
	in := SendInput{ConversationID: 1, ClientMsgID: u, MsgType: "file", Attachments: []int64{1}, FileName: `C:\x\b.doc`}
	if err := validateSend(&in); err != nil || in.FileName != "b.doc" {
		t.Fatalf("làm sạch file_name: %q %v", in.FileName, err)
	}
	in = SendInput{ConversationID: 1, ClientMsgID: u, MsgType: "file", Attachments: []int64{1}, FileName: "  "}
	if err := validateSend(&in); err != nil || in.FileName != "" {
		t.Fatalf("file_name trắng: %q %v", in.FileName, err)
	}
}

func TestIsFKMedia(t *testing.T) {
	err := fmt.Errorf("bọc: %w", &pgconn.PgError{Code: "23503", ConstraintName: "fk_chat_messages_media_id"})
	if !isFK(err, "fk_chat_messages_media_id") || isFK(err, "fk_khac") || isFK(errors.New("x"), "fk_chat_messages_media_id") {
		t.Fatal("isFK sai")
	}
}

// sendMedia: gửi tin có tệp, trả ack + lỗi.
func (e *env) sendMedia(u *tu, conv int64, typ, content, fileName string, ids ...int64) (*SendAck, error) {
	return e.s.SendMessage(context.Background(), u.id, SendInput{ConversationID: conv, ClientMsgID: newUUID(), MsgType: typ,
		Content: content, Attachments: ids, FileName: fileName})
}

func TestSendMediaDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true, push: true})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	if err := e.s.SetPushToken(ctx, b.id, b.did, "webpush", subJSON("b-media")); err != nil {
		t.Fatal(err)
	}
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	e.gw.packets("message.new", true)

	// ảnh không chú thích: ack + message.new mang attachments[0].url
	img := e.readyMedia(a.id, MediaImage)
	ack, err := e.sendMedia(a, d.ID, MediaImage, "", "", img)
	if err != nil {
		t.Fatal(err)
	}
	if len(ack.Attachments) != 1 || ack.Attachments[0].ID != img || ack.Attachments[0].URL == "" || ack.Attachments[0].Type != MediaImage {
		t.Fatalf("ack ảnh: %+v", ack)
	}
	pk := e.gw.packets("message.new", true)
	if len(pk) != 1 {
		t.Fatalf("message.new: %+v", pk)
	}
	md := pk[0].data.(MessageDTO)
	if md.MsgType != MediaImage || md.Content != "" || len(md.Attachments) != 1 || md.Attachments[0].URL == "" || md.Attachments[0].FileName != "" {
		t.Fatalf("message.new ảnh: %+v", md)
	}
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "[Hình ảnh]" {
		t.Fatalf("push ảnh: %+v", c)
	}

	// tệp gửi tên b.pdf trên tệp đã tải tên tai-lieu.pdf (dedup dùng lại object): tin mang tên riêng
	e.clk.add(3 * time.Second)
	f := e.readyMedia(a.id, MediaFile)
	fack, err := e.sendMedia(a, d.ID, MediaFile, "", "b.pdf", f)
	if err != nil {
		t.Fatal(err)
	}
	if fack.Attachments[0].FileName != "b.pdf" {
		t.Fatalf("ack tệp: %+v", fack.Attachments)
	}
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "[Tệp] b.pdf" {
		t.Fatalf("push tệp: %+v", c)
	}
	// không gửi tên: lấy tên lúc tải lên
	e.clk.add(3 * time.Second)
	f2ack, err := e.sendMedia(a, d.ID, MediaFile, "", "", f)
	if err != nil || f2ack.Attachments[0].FileName != "tai-lieu.pdf" {
		t.Fatalf("tệp không tên: %+v %v", f2ack, err)
	}
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "[Tệp] tai-lieu.pdf" {
		t.Fatalf("push tệp không tên: %+v", c)
	}
	var dbName string
	if err := e.pool.QueryRow(ctx, `select file_name from chat_messages where id = $1`, f2ack.MessageID).Scan(&dbName); err != nil || dbName != "tai-lieu.pdf" {
		t.Fatalf("chat_messages.file_name: %q %v", dbName, err)
	}

	// thoại 12 giây
	e.clk.add(3 * time.Second)
	v := e.readyMedia(a.id, MediaVoice)
	if _, err := e.sendMedia(a, d.ID, MediaVoice, "", "", v); err != nil {
		t.Fatal(err)
	}
	if c := e.push.next(2 * time.Second); c == nil || c.payload.Body != "[Tin nhắn thoại] 0:12" {
		t.Fatalf("push thoại: %+v", c)
	}

	// từ chối
	pending := e.readyMedia(a.id, MediaImage)
	if _, err := e.pool.Exec(ctx, `update chat_media set status = 'pending' where id = $1`, pending); err != nil {
		t.Fatal(err)
	}
	_, err = e.sendMedia(a, d.ID, MediaImage, "", "", pending)
	wantCode(t, "tệp pending", err, CodeMediaNotReady)
	other := e.readyMedia(b.id, MediaImage)
	_, err = e.sendMedia(a, d.ID, MediaImage, "", "", other)
	wantCode(t, "tệp của người khác", err, CodeMediaNotFound)
	_, err = e.sendMedia(a, d.ID, MediaImage, "", "", 9_000_000_000)
	wantCode(t, "tệp không có", err, CodeMediaNotFound)
	_, err = e.sendMedia(a, d.ID, MediaVideo, "", "", img)
	wantCode(t, "sai loại", err, CodeBadRequest)
	_, err = e.sendMedia(a, d.ID, MediaImage, "", "", img, img)
	wantCode(t, "2 tệp", err, CodeBadRequest)
	_, err = e.sendMedia(a, d.ID, "text", "chào", "", img)
	wantCode(t, "text kèm tệp", err, CodeBadRequest)
	_, err = e.sendMedia(a, d.ID, MediaVoice, "nói", "", v)
	wantCode(t, "thoại có chữ", err, CodeBadRequest)
	_, err = e.sendMedia(a, d.ID, MediaImage, "", "a.png", img)
	wantCode(t, "file_name trên ảnh", err, CodeBadRequest)
	_, err = e.sendMedia(a, d.ID, MediaFile, "", "x.exe", f)
	wantCode(t, "tên .exe", err, CodeMediaType)

	// lịch sử + danh sách hội thoại + sync + chi tiết: attachments ở mọi đường đọc
	p, err := e.s.Messages(ctx, b.id, d.ID, nil, nil, 100)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[int64]MessageDTO{}
	for _, m := range p.Messages {
		byID[m.ID] = m
	}
	if m := byID[ack.MessageID]; len(m.Attachments) != 1 || m.Attachments[0].ID != img || m.Attachments[0].URL == "" {
		t.Fatalf("Messages ảnh: %+v", m)
	}
	if m := byID[fack.MessageID]; len(m.Attachments) != 1 || m.Attachments[0].FileName != "b.pdf" ||
		!strings.Contains(m.Attachments[0].URL, "response-content-type=application%2Foctet-stream") {
		t.Fatalf("Messages tệp: %+v", m)
	}
	if m := byID[f2ack.MessageID]; m.Attachments[0].FileName != "tai-lieu.pdf" {
		t.Fatalf("Messages tệp 2: %+v", m)
	}
	for _, m := range p.Messages {
		if m.MsgType == "system" || m.MsgType == "text" {
			if m.Attachments != nil {
				t.Fatalf("tin %s có attachments: %+v", m.MsgType, m)
			}
		} else if len(m.Attachments) != 1 || m.Attachments[0].Type != m.MsgType {
			t.Fatalf("tin %s thiếu attachments: %+v", m.MsgType, m)
		}
	}
	checkLast := func(what string, lm *MessageDTO) {
		t.Helper()
		if lm == nil || lm.MsgType != MediaVoice || len(lm.Attachments) != 1 || lm.Attachments[0].ID != v ||
			lm.Attachments[0].DurationMs == nil || *lm.Attachments[0].DurationMs != 12000 || len(lm.Attachments[0].Waveform) != 4 {
			t.Fatalf("%s last_message: %+v", what, lm)
		}
	}
	l, err := e.s.ListConversations(ctx, b.id, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range l.Conversations {
		if c.ID == d.ID {
			found = true
			checkLast("ListConversations", c.LastMessage)
		}
	}
	if !found {
		t.Fatal("ListConversations thiếu hội thoại")
	}
	sr, err := e.s.Sync(ctx, b.id, "0")
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range sr.Conversations {
		if c.ID == d.ID {
			checkLast("Sync", c.LastMessage)
		}
	}
	cd, err := e.s.Conversation(ctx, b.id, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	checkLast("Conversation", cd.LastMessage)
	// JSON: tin text không có khoá attachments (omitempty)
	tack := e.send(a, d.ID, "chữ")
	if raw, _ := json.Marshal(tack); strings.Contains(string(raw), "attachments") {
		t.Fatalf("ack text có attachments: %s", raw)
	}
	l, _ = e.s.ListConversations(ctx, b.id, "", 0)
	for _, c := range l.Conversations {
		if c.ID == d.ID {
			if raw, _ := json.Marshal(c.LastMessage); strings.Contains(string(raw), "attachments") {
				t.Fatalf("last_message text có attachments: %s", raw)
			}
		}
	}

	// nhóm: tin hệ thống vẫn chạy
	c := e.user("Châu")
	e.friends(a, b)
	e.friends(a, c)
	g, err := e.s.CreateGroup(ctx, a.id, "Nhóm tệp", []int64{b.id, c.id})
	if err != nil {
		t.Fatal(err)
	}
	if g.LastMessage == nil || g.LastMessage.MsgType != "system" || g.LastMessage.Attachments != nil {
		t.Fatalf("tin hệ thống: %+v", g.LastMessage)
	}
	if _, err := e.sendMedia(a, g.ID, MediaImage, "ảnh nhóm", "", img); err != nil {
		t.Fatalf("gửi lại cùng tệp sang nhóm: %v", err)
	}
	// người ngoài nhóm không đọc được tệp; thành viên đọc được
	if _, err := e.s.MediaGet(ctx, c.id, img, false, 0); err != nil {
		t.Fatalf("thành viên đọc tệp: %v", err)
	}
	la := e.user("Lạ")
	_, err = e.s.MediaGet(ctx, la.id, img, false, 0)
	wantCode(t, "người ngoài đọc tệp", err, CodeMediaNotFound)
}

// Gửi trùng client_msg_id: cả đường gửi lại thường lẫn đường đua unique đều trả attachments của tin gốc.
func TestSendMediaDuplicateDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	f := e.readyMedia(a.id, MediaFile)
	in := SendInput{ConversationID: d.ID, ClientMsgID: newUUID(), MsgType: MediaFile, Attachments: []int64{f}, FileName: "goc.pdf"}
	first, err := e.s.SendMessage(ctx, a.id, in)
	if err != nil {
		t.Fatal(err)
	}
	// gửi lại với tệp khác: trả tin gốc + tệp gốc
	f2 := e.readyMedia(a.id, MediaFile)
	in2 := in
	in2.Attachments, in2.FileName = []int64{f2}, "khac.pdf"
	dup, err := e.s.SendMessage(ctx, a.id, in2)
	if err != nil {
		t.Fatal(err)
	}
	if !dup.Duplicate || dup.MessageID != first.MessageID || len(dup.Attachments) != 1 || dup.Attachments[0].ID != f ||
		dup.Attachments[0].FileName != "goc.pdf" || dup.Attachments[0].URL == "" {
		t.Fatalf("gửi trùng: %+v", dup)
	}
	// url của tin file ký theo tên của chính tin (goc.pdf), không theo tên lúc tải lên (tai-lieu.pdf)
	for _, u := range []string{first.Attachments[0].URL, dup.Attachments[0].URL} {
		if !strings.Contains(u, "goc.pdf") || strings.Contains(u, "tai-lieu") {
			t.Errorf("url tin file ký sai tên: %s", u)
		}
	}

	// đường đua unique: một transaction khác chèn sẵn (chưa commit) tin cùng client_msg_id -> SendMessage chờ ở unique,
	// commit xong thì lỗi 23505 -> đọc lại tin kia + attachments. Tắt trigger khoá ngoại trong transaction đó (replica):
	// kiểm FK sẽ khoá "for key share" dòng hội thoại, làm SendMessage chờ ngay ở "for update" (rồi đi đường gửi lại thường).
	img := e.readyMedia(a.id, MediaImage)
	cid := newUUID()
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
		t.Skipf("không đặt được session_replication_role (cần quyền superuser): %v", err)
	}
	var raceID int64
	if err := tx.QueryRow(ctx, `insert into chat_messages (conversation_id, seq, client_msg_id, sender_id, message_type, content, media_id)
		values ($1, 1000000, $2::uuid, $3, 'image', '', $4) returning id`, d.ID, cid, a.id, img).Scan(&raceID); err != nil {
		t.Fatal(err)
	}
	type res struct {
		ack *SendAck
		err error
	}
	done := make(chan res, 1)
	go func() {
		ack, err := e.s.SendMessage(ctx, a.id, SendInput{ConversationID: d.ID, ClientMsgID: cid, MsgType: MediaImage, Attachments: []int64{img}})
		done <- res{ack, err}
	}()
	waitLockWait(t, e)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var r res
	select {
	case r = <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("SendMessage không trả về")
	}
	if r.err != nil {
		t.Fatal(r.err)
	}
	if !r.ack.Duplicate || r.ack.MessageID != raceID || len(r.ack.Attachments) != 1 || r.ack.Attachments[0].ID != img || r.ack.Attachments[0].URL == "" {
		t.Fatalf("đua unique: %+v", r.ack)
	}
}

// waitLockWait: chờ tới khi có phiên đang đợi khoá trong database thử (SendMessage chờ ở unique index).
func waitLockWait(t *testing.T, e *env) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := e.pool.QueryRow(context.Background(), `select count(*) from pg_stat_activity
			where datname = current_database() and wait_event_type = 'Lock' and query like '%insert into chat_messages%'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	rows, _ := e.pool.Query(context.Background(), `select coalesce(wait_event_type,''), coalesce(wait_event,''), state, left(query, 80) from pg_stat_activity where datname = current_database()`)
	for rows.Next() {
		var a, b, c, q string
		_ = rows.Scan(&a, &b, &c, &q)
		t.Log(a, b, c, q)
	}
	rows.Close()
	t.Fatal("SendMessage không chờ khoá unique")
}

// Máy chủ tắt tệp: gửi tin có tệp -> MEDIA_DISABLED; tin văn bản vẫn gửi được.
func TestSendMediaDisabledDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.sendMedia(a, d.ID, MediaImage, "", "", 1)
	wantCode(t, "tắt tệp", err, CodeMediaDisabled)
	e.send(a, d.ID, "vẫn gửi chữ được")
}
