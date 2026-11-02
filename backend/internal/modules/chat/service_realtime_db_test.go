package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"qspro-backend/internal/modules/chat/realtime"
)

func rtCode(err error) string {
	var re *realtime.Error
	if errors.As(err, &re) {
		return re.Code
	}
	return ""
}

// Backend của gateway: gói auth, message.send / delivered / read, gói lạ, data hỏng.
func TestRealtimeBackendDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	uid, err := e.s.Authenticate(ctx, a.token, a.did)
	if err != nil || uid != a.id {
		t.Fatalf("auth: %d %v", uid, err)
	}
	// thiếu device_id (0): từ chối - gateway xếp kết nối theo device_id của gói, nhận 0 thì đăng xuất / thu hồi
	// thiết bị không đóng được kết nối đó
	if _, err := e.s.Authenticate(ctx, a.token, 0); rtCode(err) != CodeAuthFailed {
		t.Fatalf("auth không gửi device_id: %v", err)
	}
	if _, err := e.s.Authenticate(ctx, a.token, b.did); rtCode(err) != CodeAuthFailed {
		t.Fatalf("device_id không khớp token: %v", err)
	}
	if _, err := e.s.Authenticate(ctx, "rác", a.did); rtCode(err) != CodeAuthFailed {
		t.Fatalf("token rác: %v", err)
	}
	var seen *string
	_ = e.pool.QueryRow(ctx, `select last_seen_at::text from chat_devices where id = $1`, a.did).Scan(&seen)
	if seen == nil {
		t.Error("auth WebSocket phải ghi last_seen_at của thiết bị")
	}

	d, _ := e.s.CreateDirect(ctx, a.id, b.id)
	ca := realtime.Client{UserID: a.id, DeviceID: a.did, ConnID: 1}
	cid := newUUID()
	raw, _ := json.Marshal(map[string]any{"conversation_id": d.ID, "client_msg_id": cid, "msg_type": "text", "content": "Chào bạn"})
	ack, err := e.s.HandleMessage(ctx, ca, "message.send", raw)
	if err != nil {
		t.Fatal(err)
	}
	js, _ := json.Marshal(ack)
	var got map[string]any
	_ = json.Unmarshal(js, &got)
	if got["conversation_id"] != float64(d.ID) || got["client_msg_id"] != cid || got["seq"] != float64(1) || got["duplicate"] != false ||
		got["message_id"] == nil || got["created_at"] == nil {
		t.Fatalf("ack message.send: %s", js)
	}
	cb := realtime.Client{UserID: b.id, DeviceID: b.did, ConnID: 2}
	rack, err := e.s.HandleMessage(ctx, cb, "message.read", json.RawMessage(`{"conversation_id":`+itoa(d.ID)+`,"seq":1}`))
	if err != nil {
		t.Fatal(err)
	}
	if r := rack.(*ReceiptAck); r.ReadSeq != 1 || r.DeliveredSeq != 1 {
		t.Fatalf("ack message.read: %+v", r)
	}
	if rack, err = e.s.HandleMessage(ctx, cb, "message.delivered", json.RawMessage(`{"conversation_id":`+itoa(d.ID)+`,"seq":1}`)); err != nil ||
		rack.(*ReceiptAck).DeliveredSeq != 1 {
		t.Fatalf("ack message.delivered: %+v %v", rack, err)
	}
	for _, c := range []struct {
		typ, data, code string
	}{
		{"message.edit", `{}`, CodeUnknownType},
		{"message.send", `[1]`, CodeBadRequest},
		{"message.send", `{"conversation_id":"x"}`, CodeBadRequest},
		{"message.send", `{"conversation_id":` + itoa(d.ID) + `,"client_msg_id":"` + newUUID() + `","msg_type":"image","content":"a"}`, CodeBadRequest},
		{"message.read", `{"conversation_id":` + itoa(d.ID) + `,"seq":-1}`, CodeBadRequest},
		{"message.read", ``, CodeBadRequest},
	} {
		if _, err := e.s.HandleMessage(ctx, ca, c.typ, json.RawMessage(c.data)); rtCode(err) != c.code {
			t.Errorf("%s %s: %v, muốn %s", c.typ, c.data, err, c.code)
		}
	}
	la := e.user("Lạ")
	_, err = e.s.HandleMessage(ctx, realtime.Client{UserID: la.id, DeviceID: la.did}, "message.send",
		json.RawMessage(`{"conversation_id":`+itoa(d.ID)+`,"client_msg_id":"`+newUUID()+`","msg_type":"text","content":"a"}`))
	if rtCode(err) != CodeForbidden {
		t.Fatalf("người ngoài gửi qua WebSocket: %v", err)
	}
	if _, err := e.s.TypingTargets(ctx, la.id, d.ID); rtCode(err) != CodeForbidden {
		t.Fatalf("typing người ngoài: %v", err)
	}
	// đăng xuất: gói auth bằng token cũ bị từ chối (cache thiết bị đã bỏ)
	if err := e.s.Logout(ctx, a.id, a.did); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.Authenticate(ctx, a.token, a.did); rtCode(err) != CodeAuthFailed {
		t.Fatalf("auth sau đăng xuất: %v", err)
	}
}
