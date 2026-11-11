package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestFriendsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c, d := e.user("An"), e.user("Bình"), e.user("Châu"), e.user("Dũng")

	_, err := e.s.SendFriendRequest(ctx, a.id, a.id)
	wantCode(t, "mời chính mình", err, CodeBadRequest)
	_, err = e.s.SendFriendRequest(ctx, a.id, 1<<50)
	wantCode(t, "người không có", err, CodeNotFound)

	// mời -> pending; mời lại vẫn pending; bên kia thấy incoming, tôi thấy outgoing
	for i := 0; i < 2; i++ {
		if st, err := e.s.SendFriendRequest(ctx, a.id, b.id); err != nil || st != "pending" {
			t.Fatalf("mời: %q %v", st, err)
		}
	}
	in, out, err := e.s.FriendRequests(ctx, b.id)
	if err != nil || len(in) != 1 || in[0].ID != a.id || in[0].Relation != relIncoming || in[0].Phone != nil || in[0].RequestedAt == "" || len(out) != 0 {
		t.Fatalf("lời mời của B: %+v %+v %v", in, out, err)
	}
	_, out, _ = e.s.FriendRequests(ctx, a.id)
	if len(out) != 1 || out[0].ID != b.id || out[0].Relation != relOutgoing {
		t.Fatalf("lời mời A đã gửi: %+v", out)
	}
	// B mời lại A -> thành bạn luôn
	if st, err := e.s.SendFriendRequest(ctx, b.id, a.id); err != nil || st != "accepted" {
		t.Fatalf("tự chấp nhận: %q %v", st, err)
	}
	if st, _ := e.s.SendFriendRequest(ctx, a.id, b.id); st != "accepted" {
		t.Fatal("đã là bạn: accepted")
	}
	fs, err := e.s.Friends(ctx, a.id)
	if err != nil || len(fs) != 1 || fs[0].ID != b.id || fs[0].Relation != relFriend || fs[0].Phone == nil || *fs[0].Phone != b.phone {
		t.Fatalf("bạn bè của A: %+v %v", fs, err)
	}
	// huỷ kết bạn: hết cả hai chiều
	if err := e.s.Unfriend(ctx, b.id, a.id); err != nil {
		t.Fatal(err)
	}
	if fs, _ := e.s.Friends(ctx, a.id); len(fs) != 0 {
		t.Fatalf("sau huỷ: %+v", fs)
	}
	// mời + chấp nhận
	e.friends(a, c)
	e.gw.setOnline(c.id, true)
	fs, _ = e.s.Friends(ctx, a.id)
	if len(fs) != 1 || fs[0].ID != c.id || !fs[0].Online {
		t.Fatalf("bạn C online: %+v", fs)
	}
	err = e.s.AcceptFriendRequest(ctx, a.id, d.id)
	wantCode(t, "chấp nhận khi không có lời mời", err, CodeNotFound)
	// từ chối / rút lời mời
	_, _ = e.s.SendFriendRequest(ctx, a.id, d.id)
	if err := e.s.RejectFriendRequest(ctx, d.id, a.id); err != nil {
		t.Fatal(err)
	}
	if _, out, _ := e.s.FriendRequests(ctx, a.id); len(out) != 0 {
		t.Fatal("từ chối phải xoá lời mời")
	}
	_, _ = e.s.SendFriendRequest(ctx, d.id, a.id)
	if err := e.s.CancelFriendRequest(ctx, d.id, a.id); err != nil {
		t.Fatal(err)
	}
	if in, _, _ := e.s.FriendRequests(ctx, a.id); len(in) != 0 {
		t.Fatal("rút lời mời phải xoá")
	}

	// chặn: B chặn A (đang có lời mời của A)
	_, _ = e.s.SendFriendRequest(ctx, a.id, b.id)
	if err := e.s.Block(ctx, b.id, a.id); err != nil {
		t.Fatal(err)
	}
	if in, _, _ := e.s.FriendRequests(ctx, b.id); len(in) != 0 {
		t.Fatal("chặn phải xoá lời mời của người bị chặn")
	}
	_, err = e.s.SendFriendRequest(ctx, a.id, b.id)
	wantCode(t, "mời người đã chặn mình", err, CodeForbidden)
	_, err = e.s.SendFriendRequest(ctx, b.id, a.id)
	wantCode(t, "mời người mình chặn", err, CodeBlocked)
	bl, err := e.s.Blocks(ctx, b.id)
	if err != nil || len(bl) != 1 || bl[0].ID != a.id || bl[0].Relation != relBlocked {
		t.Fatalf("danh sách chặn: %+v %v", bl, err)
	}
	// A tra số B: thấy "none" (không lộ bị chặn), không thấy online
	e.gw.setOnline(b.id, true)
	u, err := e.s.SearchUser(ctx, a.id, "0"+b.phone[3:], "")
	if err != nil || u == nil || u.ID != b.id || u.Relation != relNone || u.Online {
		t.Fatalf("tra số người chặn mình: %+v %v", u, err)
	}
	u, _ = e.s.SearchUser(ctx, b.id, a.phone, "")
	if u.Relation != relBlocked {
		t.Fatalf("tra số người mình chặn: %+v", u)
	}
	// không nhắn 1-1 được (cả hai chiều)
	_, err = e.s.CreateDirect(ctx, a.id, b.id)
	wantCode(t, "tạo chat với người chặn mình", err, CodeBlocked)
	_, err = e.s.CreateDirect(ctx, b.id, a.id)
	wantCode(t, "tạo chat với người mình chặn", err, CodeBlocked)
	err = e.s.Block(ctx, b.id, b.id)
	wantCode(t, "tự chặn", err, CodeBadRequest)
	// bỏ chặn
	if err := e.s.Unblock(ctx, b.id, a.id); err != nil {
		t.Fatal(err)
	}
	if st, err := e.s.SendFriendRequest(ctx, a.id, b.id); err != nil || st != "pending" {
		t.Fatalf("sau bỏ chặn: %q %v", st, err)
	}
	// người lạ tra số: thấy số (tra đúng số), không thấy online
	u, _ = e.s.SearchUser(ctx, d.id, c.phone, "")
	if u == nil || u.Relation != relNone || u.Phone == nil || u.Online {
		t.Fatalf("người lạ tra số: %+v", u)
	}
	if u, err := e.s.SearchUser(ctx, d.id, "+84399999999", ""); err != nil || u != nil {
		t.Fatalf("số chưa dùng chat: %+v %v", u, err)
	}
	_, err = e.s.SearchUser(ctx, d.id, "12", "")
	wantCode(t, "tra số sai", err, CodePhoneInvalid)
}

// Tra theo email: thấy email (không lộ số); người lạ ở danh sách khác (lời mời, chặn, chat 1-1) không thấy email;
// bạn bè thấy cả số lẫn email; bị chặn thì tra email không lộ gì.
func TestSearchByEmailDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c := e.user("An"), e.userEmail("Bình"), e.user("Châu")
	cEmail := e.randEmail() // C có cả số lẫn email
	if _, err := e.pool.Exec(ctx, `update chat_users set email = $2 where id = $1`, c.id, cEmail); err != nil {
		t.Fatal(err)
	}

	u, err := e.s.SearchUser(ctx, a.id, "", " "+strings.ToUpper(b.email)+" ")
	if err != nil || u == nil || u.ID != b.id || u.Relation != relNone || u.Email == nil || *u.Email != b.email || u.Phone != nil || u.Online {
		t.Fatalf("tra email B: %+v %v", u, err)
	}
	u, err = e.s.SearchUser(ctx, a.id, "", cEmail)
	if err != nil || u == nil || u.ID != c.id || u.Email == nil || *u.Email != cEmail || u.Phone != nil {
		t.Fatalf("tra email không được lộ số: %+v %v", u, err)
	}
	u, err = e.s.SearchUser(ctx, a.id, c.phone, "")
	if err != nil || u == nil || u.ID != c.id || u.Phone == nil || *u.Phone != c.phone || u.Email != nil {
		t.Fatalf("tra số không được lộ email: %+v %v", u, err)
	}
	if u, err := e.s.SearchUser(ctx, a.id, "", e.randEmail()); err != nil || u != nil {
		t.Fatalf("email chưa dùng chat: %+v %v", u, err)
	}
	_, err = e.s.SearchUser(ctx, a.id, "", "ten@congty")
	wantCode(t, "tra email sai", err, CodeEmailInvalid)
	_, err = e.s.SearchUser(ctx, a.id, c.phone, cEmail)
	wantCode(t, "tra cả số lẫn email", err, CodeBadRequest)

	// lời mời / chat 1-1: người lạ không thấy email
	if st, err := e.s.SendFriendRequest(ctx, a.id, b.id); err != nil || st != "pending" {
		t.Fatalf("mời B: %q %v", st, err)
	}
	_, out, err := e.s.FriendRequests(ctx, a.id)
	if err != nil || len(out) != 1 || out[0].ID != b.id || out[0].Email != nil || out[0].Phone != nil {
		t.Fatalf("lời mời đã gửi: %+v %v", out, err)
	}
	d, err := e.s.CreateDirect(ctx, c.id, a.id)
	if err != nil || d.Peer == nil || d.Peer.Email != nil || d.Peer.Phone != nil {
		t.Fatalf("chat 1-1 với người lạ: %+v %v", d, err)
	}

	// bạn bè: thấy email (B không có số -> phone null); B thấy số của A
	if err := e.s.AcceptFriendRequest(ctx, b.id, a.id); err != nil {
		t.Fatal(err)
	}
	fs, err := e.s.Friends(ctx, a.id)
	if err != nil || len(fs) != 1 || fs[0].ID != b.id || fs[0].Email == nil || *fs[0].Email != b.email || fs[0].Phone != nil {
		t.Fatalf("bạn bè của A: %+v %v", fs, err)
	}
	fs, err = e.s.Friends(ctx, b.id)
	if err != nil || len(fs) != 1 || fs[0].Phone == nil || *fs[0].Phone != a.phone || fs[0].Email != nil {
		t.Fatalf("bạn bè của B: %+v %v", fs, err)
	}
	me, err := e.s.Me(ctx, b.id)
	if err != nil || me.Phone != nil || me.Email == nil || *me.Email != b.email {
		t.Fatalf("/me của B: %+v %v", me, err)
	}

	// C chặn A: A tra email C không thấy gì; danh sách chặn của C không lộ số / email của A
	if err := e.s.Block(ctx, c.id, a.id); err != nil {
		t.Fatal(err)
	}
	u, err = e.s.SearchUser(ctx, a.id, "", cEmail)
	if err != nil || u == nil || u.Relation != relNone || u.Email != nil || u.Phone != nil {
		t.Fatalf("tra email người chặn mình: %+v %v", u, err)
	}
	bl, err := e.s.Blocks(ctx, c.id)
	if err != nil || len(bl) != 1 || bl[0].Phone != nil || bl[0].Email != nil {
		t.Fatalf("danh sách chặn: %+v %v", bl, err)
	}
	// đồng bộ danh bạ bỏ qua tài khoản không có số
	got, err := e.s.MatchContacts(ctx, a.id, []string{c.phone}, nil)
	if err != nil || len(got) != 1 || got[0].ID != c.id || got[0].Email != nil {
		t.Fatalf("đồng bộ danh bạ: %+v %v", got, err)
	}
}

func TestMatchContactsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b, c := e.user("An"), e.user("Bình"), e.user("Châu")
	sum := sha256.Sum256([]byte(c.phone))
	hc := hex.EncodeToString(sum[:])
	local := "0" + b.phone[3:6] + " " + b.phone[6:]
	got, err := e.s.MatchContacts(ctx, a.id, []string{local, "abc", a.phone, "+84399999998"}, []string{hc, "khong-phai-hash"})
	if err != nil || len(got) != 2 {
		t.Fatalf("match: %+v %v", got, err)
	}
	by := map[int64]MatchedUserDTO{}
	for _, u := range got {
		by[u.ID] = u
	}
	if by[b.id].Matched != local || by[c.id].Matched != hc || by[b.id].Phone == nil || *by[c.id].Phone != c.phone {
		t.Fatalf("matched: %+v", got)
	}
	if _, ok := by[a.id]; ok {
		t.Error("không trả chính mình")
	}
	if got, err := e.s.MatchContacts(ctx, a.id, nil, nil); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("rỗng: %v %v", got, err)
	}
	_, err = e.s.MatchContacts(ctx, a.id, make([]string, 1001), nil)
	wantCode(t, "quá 1000 số", err, CodeBadRequest)
}

// Chat 1-1: tạo 2 lần / hai bên tạo cùng lúc -> đúng một hội thoại; không cần là bạn.
func TestDirectConversationDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bình")
	d1, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	if d1.Type != "direct" || d1.Name != nil || d1.MemberCount != 2 || d1.Role != "member" || d1.Peer == nil || d1.Peer.ID != b.id ||
		d1.Peer.Relation != relNone || d1.Peer.Phone != nil || len(d1.Members) != 2 || d1.LastSeq != 0 || d1.LastMessage != nil {
		t.Fatalf("hội thoại 1-1: %+v", d1)
	}
	d2, err := e.s.CreateDirect(ctx, b.id, a.id)
	if err != nil || d2.ID != d1.ID || d2.Peer.ID != a.id {
		t.Fatalf("tạo lại: %+v %v", d2, err)
	}
	_, err = e.s.CreateDirect(ctx, a.id, a.id)
	wantCode(t, "chat với chính mình", err, CodeBadRequest)
	_, err = e.s.CreateDirect(ctx, a.id, 1<<50)
	wantCode(t, "người không có", err, CodeNotFound)

	// hai bên bấm "Nhắn tin" cùng lúc
	for round := 0; round < 3; round++ {
		x, y := e.user("X"), e.user("Y")
		ids := make(chan int64, 8)
		errs := make(chan error, 8)
		for i := 0; i < 8; i++ {
			go func(i int) {
				me, other := x, y
				if i%2 == 1 {
					me, other = y, x
				}
				d, err := e.s.CreateDirect(ctx, me.id, other.id)
				if err != nil {
					errs <- err
					return
				}
				ids <- d.ID
			}(i)
		}
		var first int64
		for i := 0; i < 8; i++ {
			select {
			case err := <-errs:
				t.Fatal(err)
			case id := <-ids:
				if first == 0 {
					first = id
				} else if id != first {
					t.Fatalf("tạo song song ra 2 hội thoại: %d %d", first, id)
				}
			}
		}
		var n int
		_ = e.pool.QueryRow(ctx, `select count(*) from chat_conversation_members m join chat_conversations c on c.id = m.conversation_id
			where c.conversation_type = 'direct' and m.user_id = $1`, x.id).Scan(&n)
		if n != 1 {
			t.Fatalf("X có %d hội thoại 1-1", n)
		}
	}
}
