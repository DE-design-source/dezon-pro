package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

// Quản trị nhóm (0022) - thông tin nhóm (tên / ảnh / mô tả), cài đặt quyền, thêm thành viên theo cờ, khoá mới của
// Conversation (list / detail / sync), ảnh nhóm với janitor + GET /media/:id.

func requireGroupAdminSchema(t *testing.T, e *env) {
	t.Helper()
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select exists (select 1 from information_schema.columns
		where table_name = 'chat_conversations' and column_name = 'disbanded_at')`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có cột mới của 0022_chat_group_admin.sql: %v", err)
	}
}

// gaTypes: loại các gói đã gửi theo thứ tự (xoá danh sách khi reset).
func gaTypes(e *env, reset bool) []sentPkt {
	e.gw.mu.Lock()
	defer e.gw.mu.Unlock()
	out := append([]sentPkt(nil), e.gw.sent...)
	if reset {
		e.gw.sent = nil
	}
	return out
}

func gaTypeList(pk []sentPkt) string {
	var ts []string
	for _, p := range pk {
		ts = append(ts, p.typ)
	}
	return strings.Join(ts, ",")
}

// gaLastContents: nội dung n tin cuối của hội thoại (nhìn từ u).
func gaLastContents(e *env, u *tu, conv int64, n int) []string {
	ms := e.msgs(u, conv)
	var out []string
	for _, m := range ms[max(0, len(ms)-n):] {
		out = append(out, m.Content)
	}
	return out
}

func gaStr(s string) *string { return &s }
func gaBool(b bool) *bool    { return &b }
func gaID(v int64) *int64    { return &v }

func TestCanDo(t *testing.T) {
	def := GroupSettingsDTO{AdminsOnlyEditInfo: true}
	all := GroupSettingsDTO{AdminsOnlySend: true, AdminsOnlyEditInfo: true, AdminsOnlyAddMembers: true}
	none := GroupSettingsDTO{}
	cases := []struct {
		role   string
		st     GroupSettingsDTO
		action string
		want   bool
	}{
		{"member", def, ActSend, true}, {"member", all, ActSend, false}, {"admin", all, ActSend, true}, {"owner", all, ActSend, true},
		{"member", def, ActEditInfo, false}, {"member", none, ActEditInfo, true}, {"admin", all, ActEditInfo, true},
		{"member", def, ActAddMembers, true}, {"member", all, ActAddMembers, false}, {"member", all, ActCreateInvite, false},
		{"member", none, ActCreateInvite, true}, {"admin", all, ActCreateInvite, true},
		{"member", none, ActViewInvite, true}, {"member", none, ActManageRequests, false}, {"admin", all, ActManageRequests, true},
		{"member", none, ActEditSettings, false}, {"admin", none, ActEditSettings, true},
		{"member", none, ActMentionAll, false}, {"admin", none, ActMentionAll, true},
		{"member", none, ActPin, false}, {"admin", none, ActPin, true},
		{"admin", none, ActTransferOwner, false}, {"owner", none, ActTransferOwner, true},
		{"admin", none, ActDisband, false}, {"owner", none, ActDisband, true}, {"admin", none, ActSetRole, false},
		{"", none, ActSend, false}, {"", none, ActViewInvite, false}, {"owner", none, "la", false},
	}
	for _, c := range cases {
		if got := canDo(c.role, c.st, c.action); got != c.want {
			t.Errorf("canDo(%q, %+v, %q) = %v, muốn %v", c.role, c.st, c.action, got, c.want)
		}
	}
}

// Đổi tên / ảnh / mô tả: quyền theo admins_only_edit_info, tin hệ thống theo thứ tự tên -> ảnh -> mô tả, conversation.updated
// sau message.new, giá trị như cũ không sinh tin, kiểm ảnh (chủ / loại / ready), mô tả 500 ký tự.
func TestGroupInfoDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	requireGroupAdminSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, la := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Lạ")
	g := e.newGroupFor(t, lan, binh, chau)

	d := e.conv(binh, g)
	if d.Settings == nil || d.Settings.AdminsOnlySend || !d.Settings.AdminsOnlyEditInfo || d.Settings.AdminsOnlyAddMembers ||
		d.Description != nil || d.Avatar != nil || d.Disbanded || d.PendingJoinRequests != 0 || d.LastMentionSeq != 0 || d.UnreadMention {
		t.Fatalf("mặc định của nhóm: %+v", d.ConversationDTO)
	}
	_, err := e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{})
	wantCode(t, "không có khoá nào", err, CodeBadRequest)
	_, err = e.s.UpdateGroupInfo(ctx, binh.id, g, GroupInfoPatch{Name: gaStr("Tên của Bình")})
	wantCode(t, "member đổi tên khi admins_only_edit_info", err, CodeForbidden)
	_, err = e.s.UpdateGroupInfo(ctx, la.id, g, GroupInfoPatch{Name: gaStr("x")})
	wantCode(t, "người ngoài", err, CodeForbidden)
	_, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Description: OptionalString{Set: true, Value: gaStr(strings.Repeat("ạ", 501))}})
	wantCode(t, "mô tả 501 ký tự", err, CodeBadRequest)
	_, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Description: OptionalString{Set: true, Value: gaStr("a\x00b")}})
	wantCode(t, "mô tả có NUL", err, CodeBadRequest)
	_, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Name: gaStr("   ")})
	wantCode(t, "tên rỗng", err, CodeBadRequest)

	// ảnh không hợp lệ
	binhImg := e.readyMedia(binh.id, MediaImage)
	lanFile := e.readyMedia(lan.id, MediaFile)
	lanPending := e.readyMedia(lan.id, MediaImage)
	e.exec(`update chat_media set status = 'pending' where id = $1`, lanPending)
	for _, c := range []struct {
		what string
		id   int64
		code string
	}{{"ảnh của người khác", binhImg, CodeMediaNotFound}, {"không có", 1 << 60, CodeMediaNotFound}, {"id 0", 0, CodeMediaNotFound},
		{"chưa ready", lanPending, CodeMediaNotReady}, {"không phải ảnh", lanFile, CodeBadRequest}} {
		_, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{AvatarMediaID: OptionalID{Set: true, ID: gaID(c.id)}})
		wantCode(t, c.what, err, c.code)
	}

	// đổi cả 3: 3 tin hệ thống đúng thứ tự, rồi conversation.updated
	img := e.readyMedia(lan.id, MediaImage)
	gaTypes(e, true)
	d, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Name: gaStr(" Nhóm mới "), Description: OptionalString{Set: true, Value: gaStr("  Mô tả nhóm  ")},
		AvatarMediaID: OptionalID{Set: true, ID: gaID(img)}})
	if err != nil || *d.Name != "Nhóm mới" || d.Description == nil || *d.Description != "Mô tả nhóm" || d.Avatar == nil || d.Avatar.ID != img ||
		d.Avatar.URL == "" || d.LastSeq != 4 {
		t.Fatalf("đổi thông tin: %+v %v", d, err)
	}
	want := []string{"Lan đã đổi tên nhóm thành “Nhóm mới”", "Lan đã đổi ảnh đại diện nhóm", "Lan đã cập nhật mô tả nhóm"}
	if got := gaLastContents(e, binh, g, 3); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("tin hệ thống: %q", got)
	}
	pk := gaTypes(e, true)
	if gaTypeList(pk) != "message.new,message.new,message.new,conversation.updated" {
		t.Fatalf("thứ tự gói: %s", gaTypeList(pk))
	}
	cu := pk[3]
	info := cu.data.(*GroupInfoDTO)
	if len(cu.users) != 3 || !containsID(cu.users, chau.id) || info.ConversationID != g || *info.Name != "Nhóm mới" || *info.Description != "Mô tả nhóm" ||
		info.Avatar == nil || info.Avatar.ID != img || info.Avatar.URL == "" || info.Settings == nil || !info.Settings.AdminsOnlyEditInfo || info.Disbanded ||
		info.UpdatedAt == "" {
		t.Fatalf("conversation.updated: %+v %+v", cu.users, info)
	}
	// giá trị như cũ: không tin, không gói
	if d, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Name: gaStr("Nhóm mới"), Description: OptionalString{Set: true, Value: gaStr("Mô tả nhóm")},
		AvatarMediaID: OptionalID{Set: true, ID: gaID(img)}}); err != nil || d.LastSeq != 4 || len(gaTypes(e, true)) != 0 {
		t.Fatalf("không đổi gì: %+v %v", d, err)
	}

	// danh sách / sync / chi tiết của thành viên khác có các khoá mới; dòng 1-1 thì null
	lst, err := e.s.ListConversations(ctx, chau.id, "", 50)
	if err != nil || len(lst.Conversations) != 1 || lst.Conversations[0].Avatar == nil || *lst.Conversations[0].Description != "Mô tả nhóm" ||
		lst.Conversations[0].Settings == nil {
		t.Fatalf("danh sách: %+v %v", lst, err)
	}
	sy, err := e.s.Sync(ctx, chau.id, "0")
	if err != nil || len(sy.Conversations) != 1 || sy.Conversations[0].Avatar == nil {
		t.Fatalf("sync: %+v %v", sy, err)
	}
	dd, _ := e.s.CreateDirect(ctx, lan.id, binh.id)
	if dd.Settings != nil || dd.Description != nil || dd.Avatar != nil || dd.Disbanded {
		t.Fatalf("chat 1-1 không có khoá nhóm: %+v", dd.ConversationDTO)
	}

	// ảnh nhóm: thành viên đọc được; người ngoài không; janitor không xoá dù không tin nào dùng
	if md, err := e.s.MediaGet(ctx, chau.id, img, false, 0); err != nil || md.URL == "" {
		t.Fatalf("thành viên đọc ảnh nhóm: %+v %v", md, err)
	}
	_, err = e.s.MediaGet(ctx, la.id, img, false, 0)
	wantCode(t, "người ngoài đọc ảnh nhóm", err, CodeMediaNotFound)
	old := e.clk.now().Add(-25 * time.Hour)
	e.exec(`update chat_media set created_at = $2::timestamptz, updated_at = $2::timestamptz where id = $1`, img, old)
	if err := e.s.janitorOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if e.mediaRow(img).status != mediaReady {
		t.Fatal("janitor phải bỏ qua ảnh nhóm")
	}

	// xoá mô tả ("" ), xoá ảnh (null) - mỗi thay đổi một tin, theo thứ tự ảnh -> mô tả
	d, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Description: OptionalString{Set: true, Value: gaStr("  ")},
		AvatarMediaID: OptionalID{Set: true}})
	if err != nil || d.Description != nil || d.Avatar != nil {
		t.Fatalf("xoá ảnh + mô tả: %+v %v", d, err)
	}
	if got := gaLastContents(e, binh, g, 2); got[0] != "Lan đã xoá ảnh đại diện nhóm" || got[1] != "Lan đã xoá mô tả nhóm" {
		t.Fatalf("tin xoá: %q", got)
	}
	if pk := e.gw.packets("conversation.updated", true); len(pk) != 1 || pk[0].data.(*GroupInfoDTO).Avatar != nil || pk[0].data.(*GroupInfoDTO).Description != nil {
		t.Fatalf("conversation.updated sau khi xoá: %+v", pk)
	}
	// không còn là ảnh nhóm: janitor dọn được
	if err := e.s.janitorOnce(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_media where id = $1`, img).Scan(&n)
	if n != 0 {
		t.Fatal("ảnh cũ không ai dùng quá 24 giờ phải bị dọn")
	}
	// mô tả null = xoá (đã xoá: không tin)
	if d, err = e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{Description: OptionalString{Set: true}}); err != nil || d.Description != nil {
		t.Fatalf("mô tả null: %+v %v", d, err)
	}

	// RenameGroup vẫn chạy (= UpdateGroupInfo chỉ tên)
	if d, err = e.s.RenameGroup(ctx, lan.id, g, "Nhóm đổi tên"); err != nil || *d.Name != "Nhóm đổi tên" {
		t.Fatalf("RenameGroup: %+v %v", d, err)
	}
}

// Máy chủ tắt tệp: đặt ảnh -> MEDIA_DISABLED; xoá ảnh vẫn được.
func TestGroupInfoMediaDisabledDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireGroupAdminSchema(t, e)
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")
	g := e.newGroupFor(t, lan, binh)
	_, err := e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{AvatarMediaID: OptionalID{Set: true, ID: gaID(1)}})
	wantCode(t, "đặt ảnh khi tắt tệp", err, CodeMediaDisabled)
	if d, err := e.s.UpdateGroupInfo(ctx, lan.id, g, GroupInfoPatch{AvatarMediaID: OptionalID{Set: true}}); err != nil || d.Avatar != nil {
		t.Fatalf("xoá ảnh khi tắt tệp: %+v %v", d, err)
	}
}

// Cài đặt nhóm: chỉ trưởng / phó nhóm, tin hệ thống theo cờ, conversation.updated; cờ admins_only_edit_info /
// admins_only_add_members / admins_only_send (typing) có hiệu lực.
func TestGroupSettingsDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireGroupAdminSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, dung := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng")
	g := e.newGroupFor(t, lan, binh, chau)
	e.friends(binh, dung)

	_, err := e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{})
	wantCode(t, "không có khoá nào", err, CodeBadRequest)
	_, err = e.s.UpdateGroupSettings(ctx, binh.id, g, GroupSettingsPatch{AdminsOnlySend: gaBool(true)})
	wantCode(t, "member đổi cài đặt", err, CodeForbidden)

	gaTypes(e, true)
	d, err := e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{AdminsOnlySend: gaBool(true), AdminsOnlyEditInfo: gaBool(false),
		AdminsOnlyAddMembers: gaBool(false)})
	if err != nil || d.Settings == nil || !d.Settings.AdminsOnlySend || d.Settings.AdminsOnlyEditInfo || d.Settings.AdminsOnlyAddMembers || d.LastSeq != 3 {
		t.Fatalf("đổi cài đặt: %+v %v", d, err)
	}
	if got := gaLastContents(e, binh, g, 2); got[0] != "Lan đã bật chế độ chỉ trưởng / phó nhóm được gửi tin" ||
		got[1] != "Lan đã tắt chế độ chỉ trưởng / phó nhóm được đổi thông tin nhóm" {
		t.Fatalf("tin hệ thống: %q", got)
	}
	pk := gaTypes(e, true)
	if gaTypeList(pk) != "message.new,message.new,conversation.updated" || !pk[2].data.(*GroupInfoDTO).Settings.AdminsOnlySend {
		t.Fatalf("gói: %s", gaTypeList(pk))
	}
	if d, err = e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{AdminsOnlySend: gaBool(true)}); err != nil || d.LastSeq != 3 ||
		len(gaTypes(e, true)) != 0 {
		t.Fatalf("cờ như cũ: %+v %v", d, err)
	}
	if bd := e.conv(binh, g); bd.Settings == nil || !bd.Settings.AdminsOnlySend {
		t.Fatalf("Bình thấy cài đặt: %+v", bd.Settings)
	}

	// admins_only_edit_info = false: member đổi tên được
	if _, err := e.s.UpdateGroupInfo(ctx, binh.id, g, GroupInfoPatch{Name: gaStr("Tên của Bình")}); err != nil {
		t.Fatalf("member đổi tên khi tắt cờ: %v", err)
	}

	// admins_only_send: typing của member không chuyển cho ai (không lỗi); trưởng / phó nhóm vẫn chuyển
	if tg, err := e.s.TypingTargets(ctx, binh.id, g); err != nil || len(tg) != 0 {
		t.Fatalf("typing của member: %v %v", tg, err)
	}
	if tg, err := e.s.TypingTargets(ctx, lan.id, g); err != nil || len(tg) != 2 {
		t.Fatalf("typing của trưởng nhóm: %v %v", tg, err)
	}
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, chau.id, "admin"); err != nil {
		t.Fatal(err)
	}
	if tg, err := e.s.TypingTargets(ctx, chau.id, g); err != nil || len(tg) != 2 {
		t.Fatalf("typing của phó nhóm vừa đặt (bỏ cache): %v %v", tg, err)
	}
	if _, err := e.s.UpdateGroupSettings(ctx, chau.id, g, GroupSettingsPatch{AdminsOnlySend: gaBool(false)}); err != nil {
		t.Fatalf("phó nhóm đổi cài đặt: %v", err)
	}
	if tg, err := e.s.TypingTargets(ctx, binh.id, g); err != nil || len(tg) != 2 {
		t.Fatalf("typing của member sau khi tắt cờ: %v %v", tg, err)
	}

	// admins_only_add_members: member không thêm được; tắt thì được + members.updated
	if _, err := e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{AdminsOnlyAddMembers: gaBool(true)}); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.AddMembers(ctx, binh.id, g, []int64{dung.id})
	wantCode(t, "member thêm khi admins_only_add_members", err, CodeForbidden)
	if _, err := e.s.UpdateGroupSettings(ctx, lan.id, g, GroupSettingsPatch{AdminsOnlyAddMembers: gaBool(false)}); err != nil {
		t.Fatal(err)
	}
	gaTypes(e, true)
	if d, err = e.s.AddMembers(ctx, binh.id, g, []int64{dung.id}); err != nil || d.MemberCount != 4 {
		t.Fatalf("member thêm khi tắt cờ: %+v %v", d, err)
	}
	pk = gaTypes(e, true)
	if gaTypeList(pk) != "message.new,members.updated" || pk[1].data.(MembersUpdatedDTO).MemberCount != 4 || len(pk[1].users) != 4 {
		t.Fatalf("members.updated sau khi thêm: %s %+v", gaTypeList(pk), pk)
	}
}

// Thêm trực tiếp người đang có yêu cầu vào nhóm chờ duyệt -> yêu cầu cancelled + join_requests.updated tới trưởng / phó nhóm;
// pending_join_requests chỉ trưởng / phó nhóm thấy số thật.
func TestAddMembersCancelsJoinRequestDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireGroupAdminSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, dung := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng")
	g := e.newGroupFor(t, lan, binh, chau)
	if _, err := e.s.SetMemberRole(ctx, lan.id, g, binh.id, "admin"); err != nil {
		t.Fatal(err)
	}
	link := gaInsertLink(t, e, g, lan.id)
	reqID := gaInsertRequest(t, e, g, dung.id, link)
	if d := e.conv(lan, g); d.PendingJoinRequests != 1 {
		t.Fatalf("trưởng nhóm thấy số yêu cầu: %d", d.PendingJoinRequests)
	}
	if d := e.conv(chau, g); d.PendingJoinRequests != 0 {
		t.Fatalf("member thấy 0: %d", d.PendingJoinRequests)
	}
	e.friends(lan, dung)
	gaTypes(e, true)
	if _, err := e.s.AddMembers(ctx, lan.id, g, []int64{dung.id}); err != nil {
		t.Fatal(err)
	}
	var st string
	var resolved *time.Time
	_ = e.pool.QueryRow(ctx, `select status, resolved_at from chat_group_join_requests where id = $1`, reqID).Scan(&st, &resolved)
	if st != "cancelled" || resolved == nil {
		t.Fatalf("yêu cầu phải thành cancelled: %s %v", st, resolved)
	}
	pk := gaTypes(e, true)
	if gaTypeList(pk) != "message.new,members.updated,join_requests.updated" {
		t.Fatalf("gói: %s", gaTypeList(pk))
	}
	jr := pk[2]
	if d := jr.data.(JoinRequestsUpdatedDTO); d.PendingCount != 0 || d.ConversationID != g || len(jr.users) != 2 ||
		!containsID(jr.users, lan.id) || !containsID(jr.users, binh.id) {
		t.Fatalf("join_requests.updated chỉ tới trưởng / phó nhóm: %+v %+v", jr.users, jr.data)
	}
	if d := e.conv(lan, g); d.PendingJoinRequests != 0 {
		t.Fatalf("hết yêu cầu chờ: %d", d.PendingJoinRequests)
	}
}

// gaInsertLink: chèn thẳng một link mời hiệu lực (token ngẫu nhiên, chỉ lưu hash).
func gaInsertLink(t *testing.T, e *env, conv, by int64) int64 {
	t.Helper()
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	var id int64
	if err := e.pool.QueryRow(context.Background(), `insert into chat_group_invite_links (conversation_id, token_hash, created_by, requires_approval)
		values ($1, $2, $3, true) returning id`, conv, hex.EncodeToString(b), by).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// gaInsertRequest: chèn thẳng một yêu cầu vào nhóm đang chờ duyệt.
func gaInsertRequest(t *testing.T, e *env, conv, user, link int64) int64 {
	t.Helper()
	var id int64
	if err := e.pool.QueryRow(context.Background(), `insert into chat_group_join_requests (conversation_id, user_id, invite_link_id)
		values ($1, $2, $3) returning id`, conv, user, link).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
