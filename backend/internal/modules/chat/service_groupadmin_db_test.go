package chat

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"qspro-backend/internal/modules/chat/realtime"
)

// Quản trị nhóm (0022) - chuyển trưởng nhóm, giải tán (dòng chỉ đọc, 410 GROUP_DISBANDED, gỡ khỏi danh sách).

func TestTransferOwnershipDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireGroupAdminSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Lạ")
	g := e.newGroupFor(t, lan, binh, chau)

	_, err := e.s.TransferOwnership(ctx, lan.id, g, 0)
	wantCode(t, "thiếu user_id", err, CodeBadRequest)
	_, err = e.s.TransferOwnership(ctx, binh.id, g, chau.id)
	wantCode(t, "member chuyển", err, CodeForbidden)
	_, err = e.s.TransferOwnership(ctx, lan.id, g, lan.id)
	wantCode(t, "chuyển cho mình", err, CodeBadRequest)
	_, err = e.s.TransferOwnership(ctx, lan.id, g, la.id)
	wantCode(t, "chuyển cho người ngoài", err, CodeNotFound)
	_, err = e.s.TransferOwnership(ctx, la.id, g, binh.id)
	wantCode(t, "người ngoài chuyển", err, CodeForbidden)

	gaTypes(e, true)
	d, err := e.s.TransferOwnership(ctx, lan.id, g, binh.id)
	if err != nil || roleOf(d, binh.id) != "owner" || roleOf(d, lan.id) != "admin" || d.Role != "admin" ||
		d.LastMessage.Content != "Lan đã chuyển quyền trưởng nhóm cho Bình" {
		t.Fatalf("chuyển trưởng nhóm: %+v %v", d, err)
	}
	pk := gaTypes(e, true)
	if gaTypeList(pk) != "message.new,members.updated" || pk[1].data.(MembersUpdatedDTO).MemberCount != 3 || len(pk[1].users) != 3 {
		t.Fatalf("gói: %s %+v", gaTypeList(pk), pk)
	}
	var owners int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_conversation_members where conversation_id = $1 and member_role = 'owner'`, g).Scan(&owners)
	if owners != 1 {
		t.Fatalf("đúng 1 trưởng nhóm: %d", owners)
	}
	// trưởng nhóm cũ (giờ là phó nhóm) không chuyển / giải tán được nữa; trưởng nhóm mới chuyển lại được
	_, err = e.s.TransferOwnership(ctx, lan.id, g, chau.id)
	wantCode(t, "phó nhóm chuyển", err, CodeForbidden)
	err = e.s.DisbandGroup(ctx, lan.id, g)
	wantCode(t, "phó nhóm giải tán", err, CodeForbidden)
	if d, err = e.s.TransferOwnership(ctx, binh.id, g, chau.id); err != nil || roleOf(d, chau.id) != "owner" || roleOf(d, binh.id) != "admin" {
		t.Fatalf("chuyển lần 2: %+v %v", d, err)
	}
	// chat 1-1
	dd, _ := e.s.CreateDirect(ctx, lan.id, binh.id)
	_, err = e.s.TransferOwnership(ctx, lan.id, dd.ID, binh.id)
	wantCode(t, "chuyển trên chat 1-1", err, CodeBadRequest)
	err = e.s.DisbandGroup(ctx, lan.id, dd.ID)
	wantCode(t, "giải tán chat 1-1", err, CodeBadRequest)
}

// Giải tán: một transaction (tin hệ thống, disbanded_at, left_at = disbanded_at, thu hồi link, huỷ yêu cầu chờ); gói
// message.new rồi conversation.updated tới mọi thành viên lúc giải tán; dòng chỉ đọc đọc được, mọi thao tác ghi -> 410;
// gỡ khỏi danh sách.
func TestDisbandGroupDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	requireGroupAdminSchema(t, e)
	requirePinSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, dung, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng"), e.user("Lạ")
	g := e.newGroupFor(t, lan, binh, chau, dung)
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, binh.id, "admin"); err != nil {
		t.Fatal(err)
	}
	ack := e.send(chau, g, "tin trước khi giải tán")
	if _, err := e.s.PinMessage(ctx, lan.id, g, ack.MessageID); err != nil {
		t.Fatal(err)
	}
	img := e.readyMedia(lan.id, MediaImage)
	if _, err := e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{AvatarMediaID: OptionalID{Set: true, ID: gaID(img)},
		Description: OptionalString{Set: true, Value: gaStr("Nhóm sắp giải tán")}}); err != nil {
		t.Fatal(err)
	}
	if err := e.s.RemoveMember(ctx, lan.id, g, dung.id); err != nil { // Dũng rời TRƯỚC khi giải tán: dòng left thường
		t.Fatal(err)
	}
	link := gaInsertLink(t, e, g, lan.id)
	req := gaInsertRequest(t, e, g, la.id, link)

	err := e.s.DisbandGroup(ctx, binh.id, g)
	wantCode(t, "phó nhóm giải tán", err, CodeForbidden)
	err = e.s.DisbandGroup(ctx, la.id, g)
	wantCode(t, "người ngoài giải tán", err, CodeForbidden)

	gaTypes(e, true)
	e.gw.revokedPairs(true)
	if err := e.s.DisbandGroup(ctx, lan.id, g); err != nil {
		t.Fatal(err)
	}
	pk := gaTypes(e, true)
	if gaTypeList(pk) != "message.new,conversation.updated" {
		t.Fatalf("gói: %s", gaTypeList(pk))
	}
	for _, p := range pk {
		if len(p.users) != 3 || !containsID(p.users, lan.id) || !containsID(p.users, binh.id) || !containsID(p.users, chau.id) {
			t.Fatalf("%s phải tới đúng 3 thành viên lúc giải tán: %v", p.typ, p.users)
		}
	}
	if m := pk[0].data.(MessageDTO); m.Content != "Lan đã giải tán nhóm" || m.MsgType != "system" {
		t.Fatalf("tin hệ thống: %+v", m)
	}
	if info := pk[1].data.(*GroupInfoDTO); !info.Disbanded || info.Avatar == nil || info.Settings == nil {
		t.Fatalf("conversation.updated: %+v", info)
	}
	// Bình và Châu không là bạn, không còn hội thoại chung: thôi xem online của nhau
	rv := e.gw.revokedPairs(true)
	has := func(a, b int64) bool {
		for _, p := range rv {
			if p == [2]int64{a, b} {
				return true
			}
		}
		return false
	}
	if !has(binh.id, chau.id) || !has(chau.id, binh.id) || has(lan.id, chau.id) {
		t.Fatalf("gỡ presence sau giải tán: %v", rv)
	}

	// dữ liệu trong DB
	var disbanded time.Time
	if err := e.pool.QueryRow(ctx, `select disbanded_at from chat_conversations where id = $1`, g).Scan(&disbanded); err != nil {
		t.Fatal(err)
	}
	var ro, active int
	_ = e.pool.QueryRow(ctx, `select count(*) filter (where left_at = $2::timestamptz), count(*) filter (where left_at is null)
		from chat_conversation_members where conversation_id = $1`, g, pgTime(disbanded)).Scan(&ro, &active)
	if ro != 3 || active != 0 {
		t.Fatalf("dòng chỉ đọc %d, đang hoạt động %d", ro, active)
	}
	var revoked *time.Time
	var reqStatus string
	_ = e.pool.QueryRow(ctx, `select revoked_at from chat_group_invite_links where id = $1`, link).Scan(&revoked)
	_ = e.pool.QueryRow(ctx, `select status from chat_group_join_requests where id = $1`, req).Scan(&reqStatus)
	if revoked == nil || reqStatus != "cancelled" {
		t.Fatalf("link %v, yêu cầu %s", revoked, reqStatus)
	}
	if roleOf := func() string {
		var r string
		_ = e.pool.QueryRow(ctx, `select member_role from chat_conversation_members where conversation_id = $1 and user_id = $2`, g, binh.id).Scan(&r)
		return r
	}(); roleOf != "admin" {
		t.Fatalf("giữ vai trò: %s", roleOf)
	}

	// đọc được: chi tiết, danh sách, sync, tin, ghim, ảnh nhóm
	d := e.conv(chau, g)
	if !d.Disbanded || d.Left || d.MemberCount != 0 || d.Unread != 0 || d.UnreadMention || len(d.Members) != 0 || d.PendingJoinRequests != 0 ||
		d.Settings == nil || d.Avatar == nil || d.Description == nil || d.LastMessage == nil || d.LastMessage.Content != "Lan đã giải tán nhóm" {
		t.Fatalf("chi tiết dòng chỉ đọc: %+v", d)
	}
	if d := e.conv(lan, g); !d.Disbanded || d.Role != "owner" || d.PendingJoinRequests != 0 {
		t.Fatalf("trưởng nhóm xem nhóm đã giải tán: %+v", d)
	}
	lst, err := e.s.ListConversations(ctx, chau.id, "", 50)
	if err != nil || len(lst.Conversations) != 1 || !lst.Conversations[0].Disbanded || lst.Conversations[0].Left {
		t.Fatalf("danh sách: %+v %v", lst, err)
	}
	sy, err := e.s.Sync(ctx, chau.id, "0")
	if err != nil || len(sy.Conversations) != 1 || !sy.Conversations[0].Disbanded {
		t.Fatalf("sync: %+v %v", sy, err)
	}
	if ms := e.msgs(chau, g); len(ms) == 0 || ms[len(ms)-1].Content != "Lan đã giải tán nhóm" {
		t.Fatalf("tin của nhóm đã giải tán: %d", len(ms))
	}
	if pl, err := e.s.Pins(ctx, chau.id, g); err != nil || len(pl.Pins) != 1 {
		t.Fatalf("ghim: %+v %v", pl, err)
	}
	if md, err := e.s.MediaGet(ctx, chau.id, img, false, 0); err != nil || md.URL == "" {
		t.Fatalf("ảnh nhóm sau giải tán: %+v %v", md, err)
	}
	// Dũng rời trước: dòng left thường (không đọc được, disbanded false)
	_, err = e.s.Conversation(ctx, dung.id, g)
	wantCode(t, "người rời trước khi giải tán", err, CodeForbidden)
	if sy, err := e.s.Sync(ctx, dung.id, "0"); err != nil || len(sy.Conversations) != 1 || !sy.Conversations[0].Left || sy.Conversations[0].Disbanded ||
		sy.Conversations[0].Settings != nil || sy.Conversations[0].Avatar != nil {
		t.Fatalf("sync của người rời trước: %+v %v", sy, err)
	}
	_, err = e.s.MediaGet(ctx, dung.id, img, false, 0)
	wantCode(t, "người rời trước đọc ảnh nhóm", err, CodeMediaNotFound)

	// mọi thao tác ghi -> 410
	gone := func(what string, err error) {
		t.Helper()
		wantCode(t, what, err, CodeGroupDisbanded)
	}
	_, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Name: gaStr("x")})
	gone("đổi tên", err)
	_, err = e.s.RenameGroup(ctx, lan.id, g, "x")
	gone("RenameGroup", err)
	_, err = e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{AdminsOnlySend: gaBool(true)})
	gone("đổi cài đặt", err)
	_, err = e.s.TransferOwnership(ctx, lan.id, g, binh.id)
	gone("chuyển trưởng nhóm", err)
	gone("giải tán lần nữa", e.s.DisbandGroup(ctx, lan.id, g))
	e.friends(lan, la)
	_, err = e.s.AddMembers(ctx, lan.id, g, []int64{la.id})
	gone("thêm thành viên", err)
	gone("xoá người khác", e.s.RemoveMember(ctx, lan.id, g, chau.id))
	_, err = e.s.SetMemberRole(ctx, lan.id, g, chau.id, "admin")
	gone("đổi vai trò", err)
	_, err = e.s.PinMessage(ctx, lan.id, g, ack.MessageID)
	gone("ghim", err)
	_, err = e.s.UnpinMessage(ctx, lan.id, g, ack.MessageID)
	gone("bỏ ghim", err)
	_, err = e.s.Mute(ctx, chau.id, g, gaStr("forever"))
	gone("tắt thông báo", err)
	ca := realtime.Client{UserID: chau.id, DeviceID: chau.did, ConnID: 1}
	_, err = e.s.HandleMessage(ctx, ca, "message.read", json.RawMessage(`{"conversation_id":`+itoa(g)+`,"seq":1}`))
	if rtCode(err) != CodeGroupDisbanded {
		t.Fatalf("message.read trên nhóm đã giải tán: %v", err)
	}
	if tg, err := e.s.TypingTargets(ctx, chau.id, g); err != nil || len(tg) != 0 {
		t.Fatalf("typing trên nhóm đã giải tán bỏ im lặng: %v %v", tg, err)
	}
	// người ngoài vẫn 403 (không lộ nhóm đã giải tán)
	_, err = e.s.UpdateGroupInfo(ctx, la.id, g, GroupInfoPatch{Name: gaStr("x")})
	wantCode(t, "người ngoài ghi", err, CodeForbidden)
	_, err = e.s.Mute(ctx, la.id, g, nil)
	wantCode(t, "người ngoài tắt thông báo", err, CodeForbidden)

	// gỡ khỏi danh sách: không tin hệ thống, dòng thành left thường, người khác vẫn thấy
	lastSeq := e.conv(binh, g).LastSeq
	gaTypes(e, true)
	if err := e.s.RemoveMember(ctx, chau.id, g, chau.id); err != nil {
		t.Fatal(err)
	}
	if len(gaTypes(e, true)) != 0 || e.conv(binh, g).LastSeq != lastSeq {
		t.Fatal("gỡ khỏi danh sách không sinh tin / gói")
	}
	_, err = e.s.Conversation(ctx, chau.id, g)
	wantCode(t, "đã gỡ khỏi danh sách", err, CodeForbidden)
	if lst, _ := e.s.ListConversations(ctx, chau.id, "", 50); len(lst.Conversations) != 0 {
		t.Fatalf("đã gỡ: danh sách còn %d", len(lst.Conversations))
	}
	if sy, _ := e.s.Sync(ctx, chau.id, "0"); len(sy.Conversations) != 1 || !sy.Conversations[0].Left || sy.Conversations[0].Disbanded {
		t.Fatalf("sync sau khi gỡ: %+v", sy.Conversations)
	}
	_, err = e.s.Messages(ctx, chau.id, g, nil, nil, 10)
	wantCode(t, "đã gỡ đọc tin", err, CodeForbidden)
	err = e.s.RemoveMember(ctx, chau.id, g, chau.id)
	wantCode(t, "gỡ lần nữa", err, CodeForbidden)
	// janitor không xoá ảnh của nhóm đã giải tán
	e.exec(`update chat_media set created_at = $2::timestamptz, updated_at = $2::timestamptz where id = $1`, img, e.clk.now().Add(-25*time.Hour))
	if err := e.s.janitorOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if e.mediaRow(img).status != mediaReady {
		t.Fatal("janitor phải giữ ảnh của nhóm đã giải tán")
	}
}

// Trưởng nhóm rời / xoá thành viên / đổi vai trò: members.updated sau tin hệ thống.
func TestMembersUpdatedDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireGroupAdminSchema(t, e)
	ctx := context.Background()
	lan, binh, chau := e.user("Lan"), e.user("Bình"), e.user("Châu")
	g := e.newGroupFor(t, lan, binh, chau)
	gaTypes(e, true)
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, binh.id, "admin"); err != nil {
		t.Fatal(err)
	}
	if err := e.s.RemoveMember(ctx, lan.id, g, chau.id); err != nil {
		t.Fatal(err)
	}
	if err := e.s.RemoveMember(ctx, lan.id, g, lan.id); err != nil {
		t.Fatal(err)
	}
	pk := gaTypes(e, true)
	if gaTypeList(pk) != "message.new,members.updated,message.new,members.updated,message.new,members.updated" {
		t.Fatalf("gói: %s", gaTypeList(pk))
	}
	if last := pk[5]; last.data.(MembersUpdatedDTO).MemberCount != 1 || len(last.users) != 1 || last.users[0] != binh.id {
		t.Fatalf("members.updated cuối: %+v", last)
	}
	// không đổi gì (đặt lại cùng vai trò): không gói
	if _, err := e.s.SetMemberRole(ctx, binh.id, g, binh.id, "admin"); err == nil {
		t.Fatal("đổi vai trò chính mình phải lỗi")
	}
	if len(gaTypes(e, true)) != 0 {
		t.Fatal("lỗi thì không gói")
	}
}
