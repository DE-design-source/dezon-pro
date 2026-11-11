package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func requireInviteSchema(t *testing.T, e *env) {
	t.Helper()
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select to_regclass('public.chat_group_invite_links') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có bảng chat_group_invite_links (áp 0022_chat_group_admin.sql): %v", err)
	}
}

// inviteGroup: Lan (trưởng nhóm) + Bình (phó nhóm) + Châu (thành viên thường).
func inviteGroup(t *testing.T, e *env) (lan, binh, chau *tu, convID int64) {
	t.Helper()
	ctx := context.Background()
	lan, binh, chau = e.user("Lan"), e.user("Bình"), e.user("Châu")
	e.friends(lan, binh)
	e.friends(lan, chau)
	g, err := e.s.CreateGroup(ctx, lan.id, "Nhóm mời", []int64{binh.id, chau.id})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.SetMemberRole(ctx, lan.id, g.ID, binh.id, "admin"); err != nil {
		t.Fatal(err)
	}
	e.gw.packets("", true)
	return lan, binh, chau, g.ID
}

func lastSystem(t *testing.T, e *env, convID int64) (string, int64) {
	t.Helper()
	var s string
	var sender int64
	if err := e.pool.QueryRow(context.Background(), `select content, sender_id from chat_messages where conversation_id = $1
		order by seq desc limit 1`, convID).Scan(&s, &sender); err != nil {
		t.Fatal(err)
	}
	return s, sender
}

func linkUseCount(t *testing.T, e *env, id int64) int64 {
	t.Helper()
	var n int64
	if err := e.pool.QueryRow(context.Background(), `select use_count from chat_group_invite_links where id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Tạo / xem / thu hồi link: quyền theo vai trò + cài đặt, token chỉ trả một lần và chỉ lưu sha256, tạo lại thu hồi link cũ.
func TestInviteLinkDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireInviteSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, g := inviteGroup(t, e)
	stranger := e.user("Người lạ")

	if n, err := pendingJoinRequestCount(ctx, e.pool, g); err != nil || n != 0 {
		t.Fatalf("pendingJoinRequestCount: %d %v", n, err)
	}
	if r, err := e.s.GetInviteLink(ctx, chau.id, g); err != nil || r.InviteLink != nil {
		t.Fatalf("chưa có link: %+v %v", r, err)
	}
	_, err := e.s.GetInviteLink(ctx, stranger.id, g)
	wantCode(t, "người ngoài xem link", err, CodeForbidden)

	// expires_in ngoài 3600..2592000
	for _, v := range []int64{0, 3599, 2592001} {
		v := v
		_, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{ExpiresIn: &v})
		wantCode(t, "expires_in "+itoa(v), err, CodeBadRequest)
	}

	// thành viên thường tạo được khi admins_only_add_members = false
	r, err := e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	l1 := r.InviteLink
	if !reInviteToken.MatchString(l1.Token) || l1.URLPath != "/chat/join/"+l1.Token || l1.ExpiresAt != nil || l1.Expired ||
		l1.RequiresApproval || l1.CreatedBy != chau.id || l1.CreatedByName != "Châu" || l1.ConversationID != g {
		t.Fatalf("link mới: %+v", l1)
	}
	var stored string
	_ = e.pool.QueryRow(ctx, `select token_hash from chat_group_invite_links where id = $1`, l1.ID).Scan(&stored)
	sum := sha256.Sum256([]byte(l1.Token))
	if stored != hex.EncodeToString(sum[:]) || strings.Contains(stored, l1.Token) {
		t.Fatalf("token_hash: %q", stored)
	}
	if n := len(e.gw.packets("message.new", false)); n != 0 {
		t.Fatalf("tạo link không sinh tin hệ thống: %d", n)
	}

	// GET: không có token; use_count chỉ trưởng / phó nhóm thấy
	if _, err := e.s.JoinByInvite(ctx, stranger.id, l1.Token); err != nil {
		t.Fatal(err)
	}
	gc, err := e.s.GetInviteLink(ctx, chau.id, g)
	if err != nil || gc.InviteLink == nil || gc.InviteLink.Token != "" || gc.InviteLink.URLPath != "" || gc.InviteLink.ID != l1.ID ||
		gc.InviteLink.UseCount != 0 {
		t.Fatalf("GET của thành viên: %+v %v", gc.InviteLink, err)
	}
	if ga, err := e.s.GetInviteLink(ctx, binh.id, g); err != nil || ga.InviteLink.UseCount != 1 {
		t.Fatalf("GET của phó nhóm: %+v %v", ga.InviteLink, err)
	}

	// tạo lại (phó nhóm, có hạn, cần duyệt) -> link cũ bị thu hồi
	exp := int64(3600)
	r2, err := e.s.CreateInviteLink(ctx, binh.id, g, InviteCreateInput{RequiresApproval: true, ExpiresIn: &exp})
	if err != nil || r2.InviteLink.ExpiresAt == nil || !r2.InviteLink.RequiresApproval || r2.InviteLink.Token == l1.Token {
		t.Fatalf("tạo lại: %+v %v", r2, err)
	}
	if at, _ := time.Parse(time.RFC3339Nano, *r2.InviteLink.ExpiresAt); at.Sub(time.Now()) < 59*time.Minute || at.Sub(time.Now()) > 61*time.Minute {
		t.Fatalf("expires_at: %s", *r2.InviteLink.ExpiresAt)
	}
	_, err = e.s.InvitePreview(ctx, chau.id, l1.Token)
	wantCode(t, "preview link đã thu hồi", err, CodeInviteInvalid)
	var active int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_group_invite_links where conversation_id = $1 and revoked_at is null`, g).Scan(&active)
	if active != 1 {
		t.Fatalf("số link hiệu lực: %d", active)
	}

	// thành viên thường không thu hồi được link của phó nhóm
	err = e.s.RevokeInviteLink(ctx, chau.id, g)
	wantCode(t, "thành viên thu hồi link người khác", err, CodeForbidden)

	// admins_only_add_members = true: thành viên thường không tạo được
	if _, err := e.pool.Exec(ctx, `update chat_conversations set is_admin_only_add = true where id = $1`, g); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{})
	wantCode(t, "thành viên tạo link khi chỉ admin được thêm", err, CodeForbidden)
	if _, err := e.pool.Exec(ctx, `update chat_conversations set is_admin_only_add = false where id = $1`, g); err != nil {
		t.Fatal(err)
	}

	// thành viên không tạo lại đè link của phó nhóm; phó nhóm thu hồi trước
	_, err = e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{})
	wantCode(t, "thành viên tạo lại đè link người khác", err, CodeForbidden)
	if err := e.s.RevokeInviteLink(ctx, binh.id, g); err != nil {
		t.Fatal(err)
	}
	// thành viên thu hồi link do chính mình tạo; thu hồi khi không có link -> nil
	r3, err := e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.s.RevokeInviteLink(ctx, chau.id, g); err != nil {
		t.Fatal(err)
	}
	if err := e.s.RevokeInviteLink(ctx, lan.id, g); err != nil {
		t.Fatalf("thu hồi lần 2: %v", err)
	}
	if gr, err := e.s.GetInviteLink(ctx, lan.id, g); err != nil || gr.InviteLink != nil {
		t.Fatalf("sau thu hồi: %+v %v", gr, err)
	}
	_, err = e.s.JoinByInvite(ctx, e.user("Hà").id, r3.InviteLink.Token)
	wantCode(t, "join link đã thu hồi", err, CodeInviteInvalid)

	// chat 1-1
	d, err := e.s.CreateDirect(ctx, lan.id, binh.id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.s.CreateInviteLink(ctx, lan.id, d.ID, InviteCreateInput{})
	wantCode(t, "link mời chat 1-1", err, CodeBadRequest)
	_, err = e.s.GetInviteLink(ctx, lan.id, d.ID)
	wantCode(t, "xem link chat 1-1", err, CodeBadRequest)
	_, err = e.s.CreateInviteLink(ctx, e.user("Lạ 2").id, g, InviteCreateInput{})
	wantCode(t, "người không có trong nhóm tạo link", err, CodeForbidden)
}

// Preview + tham gia trực tiếp: token sai dạng / không có / hết hạn, membership, đã là thành viên, chặn, tin hệ thống,
// use_count, members.updated, giới hạn tần suất.
func TestInviteJoinDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireInviteSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, g := inviteGroup(t, e)
	dung, ha, khoa := e.user("Dũng"), e.user("Hà"), e.user("Khoa")

	for _, tok := range []string{"", "ngan", strings.Repeat("a", 42), strings.Repeat("a", 44), strings.Repeat("a", 42) + "="} {
		_, err := e.s.InvitePreview(ctx, dung.id, tok)
		wantCode(t, "preview token sai dạng "+tok, err, CodeInviteInvalid)
		_, err = e.s.JoinByInvite(ctx, dung.id, tok)
		wantCode(t, "join token sai dạng "+tok, err, CodeInviteInvalid)
	}
	unknown, _ := newInviteToken()
	_, err := e.s.InvitePreview(ctx, dung.id, unknown)
	wantCode(t, "preview token không có", err, CodeInviteInvalid)

	r, err := e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	tok, linkID := r.InviteLink.Token, r.InviteLink.ID

	pv, err := e.s.InvitePreview(ctx, dung.id, tok)
	if err != nil || pv.Group.Name != "Nhóm mời" || pv.Group.MemberCount != 3 || pv.Membership != MembershipNone || pv.ConversationID != nil ||
		pv.RequiresApproval || pv.ExpiresAt != nil || pv.Group.Avatar != nil {
		t.Fatalf("preview người ngoài: %+v %v", pv, err)
	}
	if pv, err := e.s.InvitePreview(ctx, binh.id, tok); err != nil || pv.Membership != MembershipMember || pv.ConversationID == nil || *pv.ConversationID != g {
		t.Fatalf("preview thành viên: %+v %v", pv, err)
	}

	// Dũng không là bạn của ai vẫn vào được
	jr, err := e.s.JoinByInvite(ctx, dung.id, tok)
	if err != nil || jr.Status != JoinJoined || jr.ConversationID == nil || *jr.ConversationID != g || jr.RequestID != nil {
		t.Fatalf("join: %+v %v", jr, err)
	}
	if s, sender := lastSystem(t, e, g); s != "Dũng đã tham gia nhóm qua link mời" || sender != dung.id {
		t.Fatalf("tin hệ thống: %q %d", s, sender)
	}
	if n := linkUseCount(t, e, linkID); n != 1 {
		t.Fatalf("use_count: %d", n)
	}
	if pk := e.gw.packets("message.new", false); len(pk) != 1 || len(pk[0].users) != 4 {
		t.Fatalf("message.new: %+v", pk)
	}
	pk := e.gw.packets("members.updated", false)
	if len(pk) != 1 || len(pk[0].users) != 4 || pk[0].data.(MembersUpdatedDTO).MemberCount != 4 || pk[0].data.(MembersUpdatedDTO).ConversationID != g {
		t.Fatalf("members.updated: %+v", pk)
	}
	if n := len(e.gw.packets("join_requests.updated", true)); n != 0 {
		t.Fatalf("join_requests.updated khi vào thẳng: %d", n)
	}
	d, err := e.s.Conversation(ctx, dung.id, g)
	if err != nil || d.Role != "member" || d.Unread != 0 || len(d.Members) != 4 {
		t.Fatalf("chi tiết của người mới: %+v %v", d, err)
	}

	// vào lại -> already_member, không tin hệ thống
	if jr, err := e.s.JoinByInvite(ctx, dung.id, tok); err != nil || jr.Status != JoinAlreadyMember || *jr.ConversationID != g {
		t.Fatalf("join lần 2: %+v %v", jr, err)
	}
	if linkUseCount(t, e, linkID) != 1 || len(e.gw.packets("message.new", true)) != 0 {
		t.Fatal("already_member không được tăng use_count / sinh tin")
	}

	// người đã rời được vào lại
	if err := e.s.RemoveMember(ctx, dung.id, g, dung.id); err != nil {
		t.Fatal(err)
	}
	if jr, err := e.s.JoinByInvite(ctx, dung.id, tok); err != nil || jr.Status != JoinJoined {
		t.Fatalf("vào lại sau khi rời: %+v %v", jr, err)
	}

	// chặn trưởng nhóm (hai chiều) hoặc người tạo link -> BLOCKED
	if err := e.s.Block(ctx, lan.id, ha.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.JoinByInvite(ctx, ha.id, tok)
	wantCode(t, "trưởng nhóm chặn người xin", err, CodeBlocked)
	if err := e.s.Block(ctx, khoa.id, chau.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.JoinByInvite(ctx, khoa.id, tok)
	wantCode(t, "người xin chặn người tạo link", err, CodeBlocked)

	// hết hạn -> 410 INVITE_EXPIRED (preview + join)
	if _, err := e.pool.Exec(ctx, `update chat_group_invite_links set created_at = now() - interval '2 hours',
		expires_at = now() - interval '1 hour' where id = $1`, linkID); err != nil {
		t.Fatal(err)
	}
	other := e.user("Minh")
	_, err = e.s.InvitePreview(ctx, other.id, tok)
	wantCode(t, "preview link hết hạn", err, CodeInviteExpired)
	_, err = e.s.JoinByInvite(ctx, other.id, tok)
	wantCode(t, "join link hết hạn", err, CodeInviteExpired)
	if gl, err := e.s.GetInviteLink(ctx, lan.id, g); err != nil || gl.InviteLink == nil || !gl.InviteLink.Expired {
		t.Fatalf("GET link hết hạn: %+v %v", gl, err)
	}

	// giới hạn: preview 60 / phút, join 20 / giờ mỗi người
	rl := e.user("Spam")
	for i := 0; i < 60; i++ {
		_, err := e.s.InvitePreview(ctx, rl.id, unknown)
		wantCode(t, "preview lần "+itoa(int64(i)), err, CodeInviteInvalid)
	}
	_, err = e.s.InvitePreview(ctx, rl.id, unknown)
	wantCode(t, "preview lần 61", err, CodeRateLimit)
	for i := 0; i < 20; i++ {
		_, err := e.s.JoinByInvite(ctx, rl.id, unknown)
		wantCode(t, "join lần "+itoa(int64(i)), err, CodeInviteInvalid)
	}
	_, err = e.s.JoinByInvite(ctx, rl.id, unknown)
	wantCode(t, "join lần 21", err, CodeRateLimit)
	e.clk.add(time.Hour)
	_, err = e.s.JoinByInvite(ctx, rl.id, unknown)
	wantCode(t, "join sau 1 giờ", err, CodeInviteInvalid)
}

// Link cần duyệt: yêu cầu pending (gửi lại trả cùng yêu cầu), hàng chờ chỉ trưởng / phó nhóm xem, join_requests.updated
// chỉ tới trưởng / phó nhóm, duyệt (tin hệ thống, use_count), từ chối, duyệt khi người xin đã là thành viên, thêm
// trực tiếp huỷ yêu cầu chờ.
func TestInviteApprovalDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireInviteSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, g := inviteGroup(t, e)
	dung, ha, minh := e.user("Dũng"), e.user("Hà"), e.user("Minh")

	r, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{RequiresApproval: true})
	if err != nil {
		t.Fatal(err)
	}
	tok, linkID := r.InviteLink.Token, r.InviteLink.ID
	if pv, err := e.s.InvitePreview(ctx, dung.id, tok); err != nil || !pv.RequiresApproval || pv.Membership != MembershipNone {
		t.Fatalf("preview: %+v %v", pv, err)
	}

	j1, err := e.s.JoinByInvite(ctx, dung.id, tok)
	if err != nil || j1.Status != JoinPending || j1.RequestID == nil || j1.ConversationID != nil {
		t.Fatalf("join cần duyệt: %+v %v", j1, err)
	}
	pk := e.gw.packets("join_requests.updated", false)
	if len(pk) != 1 || len(pk[0].users) != 2 || pk[0].data.(JoinRequestsUpdatedDTO).PendingCount != 1 {
		t.Fatalf("join_requests.updated: %+v", pk)
	}
	for _, u := range pk[0].users {
		if u != lan.id && u != binh.id {
			t.Fatalf("join_requests.updated tới người không phải trưởng / phó nhóm: %v", pk[0].users)
		}
	}
	if len(e.gw.packets("message.new", false))+len(e.gw.packets("members.updated", true)) != 0 {
		t.Fatal("yêu cầu chờ không sinh tin / members.updated")
	}
	if j2, err := e.s.JoinByInvite(ctx, dung.id, tok); err != nil || j2.Status != JoinPending || *j2.RequestID != *j1.RequestID {
		t.Fatalf("join lần 2: %+v %v", j2, err)
	}
	if n := len(e.gw.packets("join_requests.updated", true)); n != 0 {
		t.Fatalf("yêu cầu cũ không gửi lại gói: %d", n)
	}
	if pv, err := e.s.InvitePreview(ctx, dung.id, tok); err != nil || pv.Membership != MembershipPending || pv.ConversationID != nil {
		t.Fatalf("preview khi đang chờ: %+v %v", pv, err)
	}
	jh, err := e.s.JoinByInvite(ctx, ha.id, tok)
	if err != nil {
		t.Fatal(err)
	}
	jm, err := e.s.JoinByInvite(ctx, minh.id, tok)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := pendingJoinRequestCount(ctx, e.pool, g); n != 3 {
		t.Fatalf("pendingJoinRequestCount: %d", n)
	}

	_, err = e.s.ListJoinRequests(ctx, chau.id, g)
	wantCode(t, "thành viên xem hàng chờ", err, CodeForbidden)
	_, err = e.s.ApproveJoinRequest(ctx, chau.id, g, *j1.RequestID)
	wantCode(t, "thành viên duyệt", err, CodeForbidden)
	_, err = e.s.RejectJoinRequest(ctx, chau.id, g, *j1.RequestID)
	wantCode(t, "thành viên từ chối", err, CodeForbidden)
	list, err := e.s.ListJoinRequests(ctx, binh.id, g)
	if err != nil || len(list.Requests) != 3 || list.Requests[0].ID != *j1.RequestID || list.Requests[0].User.ID != dung.id ||
		list.Requests[0].User.DisplayName != "Dũng" || list.Requests[0].User.Phone != nil || list.Requests[0].ConversationID != g {
		t.Fatalf("hàng chờ: %+v %v", list, err)
	}

	// duyệt Dũng (phó nhóm)
	e.gw.packets("", true)
	if res, err := e.s.ApproveJoinRequest(ctx, binh.id, g, *j1.RequestID); err != nil || res.Status != "approved" {
		t.Fatalf("duyệt: %+v %v", res, err)
	}
	if s, sender := lastSystem(t, e, g); s != "Bình đã duyệt Dũng vào nhóm" || sender != binh.id {
		t.Fatalf("tin hệ thống duyệt: %q %d", s, sender)
	}
	if n := linkUseCount(t, e, linkID); n != 1 {
		t.Fatalf("use_count sau duyệt: %d", n)
	}
	if pk := e.gw.packets("message.new", false); len(pk) != 1 || len(pk[0].users) != 4 {
		t.Fatalf("message.new duyệt: %+v", pk)
	}
	if pk := e.gw.packets("members.updated", false); len(pk) != 1 || pk[0].data.(MembersUpdatedDTO).MemberCount != 4 {
		t.Fatalf("members.updated duyệt: %+v", pk)
	}
	if pk := e.gw.packets("join_requests.updated", true); len(pk) != 1 || pk[0].data.(JoinRequestsUpdatedDTO).PendingCount != 2 {
		t.Fatalf("join_requests.updated duyệt: %+v", pk)
	}
	var st string
	var by *int64
	_ = e.pool.QueryRow(ctx, `select status, resolved_by from chat_group_join_requests where id = $1`, *j1.RequestID).Scan(&st, &by)
	if st != "approved" || by == nil || *by != binh.id {
		t.Fatalf("trạng thái yêu cầu: %s %v", st, by)
	}
	_, err = e.s.ApproveJoinRequest(ctx, lan.id, g, *j1.RequestID)
	wantCode(t, "duyệt lại", err, CodeNotFound)
	if jr, err := e.s.JoinByInvite(ctx, dung.id, tok); err != nil || jr.Status != JoinAlreadyMember {
		t.Fatalf("join sau khi được duyệt: %+v %v", jr, err)
	}

	// từ chối Hà: không tin hệ thống
	if res, err := e.s.RejectJoinRequest(ctx, lan.id, g, *jh.RequestID); err != nil || res.Status != "rejected" {
		t.Fatalf("từ chối: %+v %v", res, err)
	}
	if len(e.gw.packets("message.new", false)) != 0 {
		t.Fatal("từ chối không sinh tin hệ thống")
	}
	if pk := e.gw.packets("join_requests.updated", true); len(pk) != 1 || pk[0].data.(JoinRequestsUpdatedDTO).PendingCount != 1 {
		t.Fatalf("join_requests.updated từ chối: %+v", pk)
	}
	_, err = e.s.RejectJoinRequest(ctx, lan.id, g, *jh.RequestID)
	wantCode(t, "từ chối lại", err, CodeNotFound)
	// từ chối rồi xin lại -> yêu cầu mới
	if jh2, err := e.s.JoinByInvite(ctx, ha.id, tok); err != nil || jh2.Status != JoinPending || *jh2.RequestID == *jh.RequestID {
		t.Fatalf("xin lại sau khi bị từ chối: %+v %v", jh2, err)
	}

	// yêu cầu thuộc nhóm khác -> NOT_FOUND
	g2, err := e.s.CreateGroup(ctx, lan.id, "Nhóm khác", []int64{binh.id})
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.s.ApproveJoinRequest(ctx, lan.id, g2.ID, *jm.RequestID)
	wantCode(t, "duyệt yêu cầu của nhóm khác", err, CodeNotFound)

	// người xin đã vào bằng đường khác -> approved, không tin hệ thống, không tăng use_count
	if _, err := e.pool.Exec(ctx, `insert into chat_conversation_members (conversation_id, user_id) values ($1, $2)`, g, minh.id); err != nil {
		t.Fatal(err)
	}
	e.s.forgetMembers(g)
	e.gw.packets("", true)
	if res, err := e.s.ApproveJoinRequest(ctx, lan.id, g, *jm.RequestID); err != nil || res.Status != "approved" {
		t.Fatalf("duyệt người đã là thành viên: %+v %v", res, err)
	}
	if len(e.gw.packets("message.new", false)) != 0 || linkUseCount(t, e, linkID) != 1 {
		t.Fatal("duyệt người đã là thành viên không sinh tin / không tăng use_count")
	}

	// link bị thu hồi: yêu cầu chờ vẫn duyệt được
	if err := e.s.RevokeInviteLink(ctx, lan.id, g); err != nil {
		t.Fatal(err)
	}
	list, err = e.s.ListJoinRequests(ctx, lan.id, g)
	if err != nil || len(list.Requests) != 1 || list.Requests[0].User.ID != ha.id {
		t.Fatalf("hàng chờ sau thu hồi: %+v %v", list, err)
	}
	if _, err := e.s.ApproveJoinRequest(ctx, lan.id, g, list.Requests[0].ID); err != nil {
		t.Fatalf("duyệt sau thu hồi link: %v", err)
	}
	if n := linkUseCount(t, e, linkID); n != 2 {
		t.Fatalf("use_count sau duyệt (link đã thu hồi): %d", n)
	}

	// vào thẳng bằng link không cần duyệt huỷ yêu cầu chờ của chính mình
	r2, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{RequiresApproval: true})
	if err != nil {
		t.Fatal(err)
	}
	q := e.user("Quân")
	jq, err := e.s.JoinByInvite(ctx, q.id, r2.InviteLink.Token)
	if err != nil || jq.Status != JoinPending {
		t.Fatalf("Quân xin: %+v %v", jq, err)
	}
	r3, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	e.gw.packets("", true)
	if jr, err := e.s.JoinByInvite(ctx, q.id, r3.InviteLink.Token); err != nil || jr.Status != JoinJoined {
		t.Fatalf("Quân vào thẳng: %+v %v", jr, err)
	}
	_ = e.pool.QueryRow(ctx, `select status from chat_group_join_requests where id = $1`, *jq.RequestID).Scan(&st)
	if st != "cancelled" {
		t.Fatalf("yêu cầu cũ của Quân: %s", st)
	}
	if pk := e.gw.packets("join_requests.updated", false); len(pk) != 1 || pk[0].data.(JoinRequestsUpdatedDTO).PendingCount != 0 {
		t.Fatalf("join_requests.updated khi huỷ: %+v", pk)
	}
}

// Nhóm đủ 1000 người: join + duyệt -> GROUP_FULL (yêu cầu vẫn chờ).
func TestInviteGroupFullDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireInviteSchema(t, e)
	ctx := context.Background()
	lan, _, _, g := inviteGroup(t, e)
	ra, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{RequiresApproval: true})
	if err != nil {
		t.Fatal(err)
	}
	waiting := e.user("Chờ")
	jw, err := e.s.JoinByInvite(ctx, waiting.id, ra.InviteLink.Token)
	if err != nil || jw.Status != JoinPending {
		t.Fatalf("xin: %+v %v", jw, err)
	}
	// thêm 997 tài khoản -> 1000 thành viên
	tag := strings.ReplaceAll(newUUID(), "-", "")[:12]
	rows, err := e.pool.Query(ctx, `insert into chat_users (email, display_name)
		select 'day' || g || '.' || $1 || '@chat-test.vn', 'Đầy ' || g from generate_series(1, 997) g returning id`, tag)
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
		e.track(id)
	}
	rows.Close()
	if _, err := e.pool.Exec(ctx, `insert into chat_conversation_members (conversation_id, user_id) select $1, u from unnest($2::bigint[]) u`,
		g, ids); err != nil {
		t.Fatal(err)
	}
	e.s.forgetMembers(g)
	_, err = e.s.ApproveJoinRequest(ctx, lan.id, g, *jw.RequestID)
	wantCode(t, "duyệt khi nhóm đủ", err, CodeGroupFull)
	if n, _ := pendingJoinRequestCount(ctx, e.pool, g); n != 1 {
		t.Fatalf("yêu cầu vẫn chờ: %d", n)
	}
	// link cần duyệt vẫn nhận yêu cầu khi nhóm đủ (kiểm đủ sau bước tạo yêu cầu)
	full := e.user("Thừa")
	if jr, err := e.s.JoinByInvite(ctx, full.id, ra.InviteLink.Token); err != nil || jr.Status != JoinPending {
		t.Fatalf("xin khi nhóm đủ: %+v %v", jr, err)
	}
	rd, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.s.JoinByInvite(ctx, e.user("Thừa 2").id, rd.InviteLink.Token)
	wantCode(t, "join nhóm đủ", err, CodeGroupFull)
}

// Nhóm đã giải tán: link đọc ra null, mọi thao tác ghi -> 410, link cũ -> INVITE_INVALID; hàng chờ rỗng.
func TestInviteDisbandedDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireInviteSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, g := inviteGroup(t, e)
	r, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{RequiresApproval: true})
	if err != nil {
		t.Fatal(err)
	}
	dung := e.user("Dũng")
	jr, err := e.s.JoinByInvite(ctx, dung.id, r.InviteLink.Token)
	if err != nil {
		t.Fatal(err)
	}
	// giải tán như DisbandGroup nhưng CHƯA thu hồi link (kiểm phòng thủ của join)
	if _, err := e.pool.Exec(ctx, `with c as (update chat_conversations set disbanded_at = clock_timestamp() where id = $1 returning disbanded_at)
		update chat_conversation_members m set left_at = c.disbanded_at, updated_at = c.disbanded_at from c
		where m.conversation_id = $1 and m.left_at is null`, g); err != nil {
		t.Fatal(err)
	}
	e.s.forgetMembers(g)
	_, err = e.s.JoinByInvite(ctx, e.user("Hà").id, r.InviteLink.Token)
	wantCode(t, "join nhóm đã giải tán (link chưa thu hồi)", err, CodeGroupDisbanded)

	if gl, err := e.s.GetInviteLink(ctx, chau.id, g); err != nil || gl.InviteLink != nil {
		t.Fatalf("GET sau giải tán: %+v %v", gl, err)
	}
	if l, err := e.s.ListJoinRequests(ctx, lan.id, g); err != nil || len(l.Requests) != 0 {
		t.Fatalf("hàng chờ sau giải tán: %+v %v", l, err)
	}
	_, err = e.s.CreateInviteLink(ctx, binh.id, g, InviteCreateInput{})
	wantCode(t, "tạo link sau giải tán", err, CodeGroupDisbanded)
	err = e.s.RevokeInviteLink(ctx, lan.id, g)
	wantCode(t, "thu hồi sau giải tán", err, CodeGroupDisbanded)
	_, err = e.s.ApproveJoinRequest(ctx, lan.id, g, *jr.RequestID)
	wantCode(t, "duyệt sau giải tán", err, CodeGroupDisbanded)
	_, err = e.s.RejectJoinRequest(ctx, binh.id, g, *jr.RequestID)
	wantCode(t, "từ chối sau giải tán", err, CodeGroupDisbanded)

	// giải tán thật thu hồi link -> INVITE_INVALID
	if _, err := e.pool.Exec(ctx, `update chat_group_invite_links set revoked_at = now() where conversation_id = $1 and revoked_at is null`, g); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.InvitePreview(ctx, dung.id, r.InviteLink.Token)
	wantCode(t, "preview sau giải tán", err, CodeInviteInvalid)
	_, err = e.s.JoinByInvite(ctx, dung.id, r.InviteLink.Token)
	wantCode(t, "join sau giải tán", err, CodeInviteInvalid)

	// người rời TRƯỚC khi giải tán: dòng left thường -> 403, không phải 410
	outsider := e.user("Ngoài")
	_, err = e.s.CreateInviteLink(ctx, outsider.id, g, InviteCreateInput{})
	wantCode(t, "người ngoài tạo link nhóm đã giải tán", err, CodeForbidden)
}

// Thành viên thường không "tạo lại" đè link của người khác; chặn phát sinh sau khi xin vào -> duyệt bị 403 BLOCKED.
func TestInviteRegenerateAndBlockedApproveDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	requireInviteSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, g := inviteGroup(t, e)
	dung := e.user("Dũng")

	r, err := e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{RequiresApproval: true})
	if err != nil {
		t.Fatal(err)
	}
	tok := r.InviteLink.Token
	_, err = e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{})
	wantCode(t, "thành viên tạo lại đè link của trưởng nhóm", err, CodeForbidden)
	if pv, err := e.s.InvitePreview(ctx, dung.id, tok); err != nil || !pv.RequiresApproval {
		t.Fatalf("link của trưởng nhóm phải còn hiệu lực: %+v %v", pv, err)
	}
	// phó nhóm tạo lại được; thành viên tạo lại link của chính mình được
	if _, err := e.s.CreateInviteLink(ctx, binh.id, g, InviteCreateInput{RequiresApproval: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.s.RevokeInviteLink(ctx, binh.id, g); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.CreateInviteLink(ctx, chau.id, g, InviteCreateInput{}); err != nil {
		t.Fatalf("thành viên tạo lại link của mình: %v", err)
	}

	// chặn sau khi yêu cầu được tạo
	r, err = e.s.CreateInviteLink(ctx, lan.id, g, InviteCreateInput{RequiresApproval: true})
	if err != nil {
		t.Fatal(err)
	}
	j, err := e.s.JoinByInvite(ctx, dung.id, r.InviteLink.Token)
	if err != nil || j.Status != JoinPending {
		t.Fatalf("xin vào: %+v %v", j, err)
	}
	if err := e.s.Block(ctx, lan.id, dung.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.ApproveJoinRequest(ctx, binh.id, g, *j.RequestID)
	wantCode(t, "duyệt người bị trưởng nhóm chặn", err, CodeBlocked)
	var in bool
	if err := e.pool.QueryRow(ctx, `select exists(select 1 from chat_conversation_members where conversation_id = $1 and user_id = $2
		and left_at is null)`, g, dung.id).Scan(&in); err != nil || in {
		t.Fatalf("người bị chặn không được vào nhóm: %v %v", in, err)
	}
	if n, _ := pendingJoinRequestCount(ctx, e.pool, g); n != 1 {
		t.Fatalf("yêu cầu vẫn chờ: %d", n)
	}
}
