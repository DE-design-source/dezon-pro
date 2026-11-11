package chat

import (
	"context"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
)

// Quản trị nhóm (migration 0022, API.md mục "Quản trị nhóm"): ma trận quyền, nhóm đã giải tán (410), đổi thông tin /
// cài đặt nhóm, chuyển trưởng nhóm, giải tán.

// Hành động của ma trận quyền (canDo). Giao diện: canDo trong frontend/src/pages/Chat/state/chatLogic.js (cùng bảng).
const (
	ActSend           = "send"            // message.send (typing của member bị bỏ im lặng khi không được gửi)
	ActEditInfo       = "edit_info"       // đổi tên / ảnh / mô tả
	ActAddMembers     = "add_members"     // thêm thành viên
	ActCreateInvite   = "create_invite"   // tạo link mời (cùng cờ admins_only_add_members)
	ActViewInvite     = "view_invite"     // xem link mời hiện hành
	ActManageRequests = "manage_requests" // xem / duyệt / từ chối yêu cầu vào nhóm
	ActEditSettings   = "edit_settings"   // đổi cài đặt nhóm
	ActMentionAll     = "mention_all"     // @Tất cả
	ActPin            = "pin"             // ghim / bỏ ghim
	ActSetRole        = "set_role"        // đặt / bỏ phó nhóm
	ActTransferOwner  = "transfer_owner"  // chuyển trưởng nhóm
	ActDisband        = "disband"         // giải tán nhóm
)

// canDo: role (owner / admin / member) được làm action trong nhóm có cài đặt st không (ma trận quyền của API.md).
// Thu hồi link mời (member chỉ link do mình tạo) và xoá thành viên (phụ thuộc vai trò người bị xoá) không nằm ở đây.
// Hành động lạ -> false.
func canDo(role string, st GroupSettingsDTO, action string) bool {
	admin := role == "owner" || role == "admin"
	member := admin || role == "member"
	switch action {
	case ActSend, "send_message":
		return admin || (member && !st.AdminsOnlySend)
	case ActEditInfo, "edit", "rename":
		return admin || (member && !st.AdminsOnlyEditInfo)
	case ActAddMembers, ActCreateInvite, "add", "invite":
		return admin || (member && !st.AdminsOnlyAddMembers)
	case ActViewInvite:
		return member
	case ActManageRequests, "approve", "join_requests", ActEditSettings, "settings", ActMentionAll, ActPin:
		return admin
	case ActSetRole, ActTransferOwner, "transfer", ActDisband:
		return role == "owner"
	}
	return false
}

// requireGroupWritable: hội thoại đã giải tán -> 410 GROUP_DISBANDED (không có / chưa giải tán -> nil, các bước kiểm
// khác lo). Gọi trong transaction đã khoá dòng hội thoại để không đua với DisbandGroup.
func requireGroupWritable(ctx context.Context, q querier, convID int64) error {
	var disbanded bool
	err := q.QueryRow(ctx, `select disbanded_at is not null from chat_conversations where id = $1`, convID).Scan(&disbanded)
	if noRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if disbanded {
		return errGroupDisbanded
	}
	return nil
}

// groupSettings: cài đặt quyền của hội thoại (chat 1-1: mọi cờ false - không dùng).
func groupSettings(ctx context.Context, q querier, convID int64) (GroupSettingsDTO, error) {
	var st GroupSettingsDTO
	err := q.QueryRow(ctx, `select is_admin_only_send, is_admin_only_info, is_admin_only_add from chat_conversations where id = $1`,
		convID).Scan(&st.AdminsOnlySend, &st.AdminsOnlyEditInfo, &st.AdminsOnlyAddMembers)
	if noRows(err) {
		return st, nil
	}
	return st, err
}

// ───────────── Đọc / ghi theo trạng thái giải tán ─────────────

// canReadConv: uid còn đọc được hội thoại (thành viên đang hoạt động hoặc dòng chỉ đọc của nhóm đã giải tán).
func canReadConv(ctx context.Context, q querier, uid, convID int64) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `select exists (select 1 from chat_conversation_members m join chat_conversations c on c.id = m.conversation_id
		where m.conversation_id = $1 and m.user_id = $2 and `+convVisible+`)`, convID, uid).Scan(&ok)
	return ok, err
}

// readonlyDisbanded: dòng của uid là dòng chỉ đọc của nhóm đã giải tán (left_at = disbanded_at).
func readonlyDisbanded(ctx context.Context, q querier, uid, convID int64) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `select exists (select 1 from chat_conversation_members m join chat_conversations c on c.id = m.conversation_id
		where m.conversation_id = $1 and m.user_id = $2 and c.disbanded_at is not null and m.left_at = c.disbanded_at)`, convID, uid).Scan(&ok)
	return ok, err
}

// hideDisbanded: DELETE /conversations/:id/members/<mình> trên nhóm đã giải tán = gỡ nhóm khỏi danh sách của mình
// (left_at mới khác disbanded_at -> dòng thành left thường, hết đọc lịch sử; không tin hệ thống). done = false: không
// phải dòng chỉ đọc (xử lý như rời nhóm thường).
func (s *Service) hideDisbanded(ctx context.Context, uid, convID int64) (bool, error) {
	p, err := s.pool()
	if err != nil {
		return false, err
	}
	tag, err := p.Exec(ctx, `update chat_conversation_members m
		set left_at = greatest(clock_timestamp(), c.disbanded_at + interval '1 microsecond'), updated_at = clock_timestamp()
		from chat_conversations c
		where c.id = m.conversation_id and m.conversation_id = $1 and m.user_id = $2
			and c.disbanded_at is not null and m.left_at = c.disbanded_at`, convID, uid)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// groupAvatar: ảnh nhóm (bản sao, chỉ khi tệp ready) từ kết quả mediaDTOs.
func groupAvatar(id *int64, mds map[int64]*MediaDTO) *MediaDTO {
	if id == nil {
		return nil
	}
	md := mds[*id]
	if md == nil || md.Status != mediaReady {
		return nil
	}
	d := *md
	d.FileName = ""
	return &d
}

// ───────────── Chặn typing của member khi admins_only_send ─────────────

// sendGate: cờ admins_only_send + trưởng / phó nhóm đang hoạt động của một hội thoại, cache 30 giây cho typing.
// Bỏ cache ở mọi chỗ đổi cờ / vai trò (UpdateGroupSettings, SetMemberRole, TransferOwnership, RemoveMember, DisbandGroup);
// người mới vào (AddMembers, link mời) luôn là member nên không cần bỏ cache.
type sendGate struct {
	at         time.Time
	adminsOnly bool
	admins     map[int64]bool
}

var sendGates = struct {
	sync.Mutex
	m   map[int64]sendGate
	gen uint64
}{m: map[int64]sendGate{}}

func forgetSendGate(convID int64) {
	sendGates.Lock()
	delete(sendGates.m, convID)
	sendGates.gen++
	sendGates.Unlock()
}

// typingAllowed: uid (thành viên đang hoạt động) được chuyển typing không - member của nhóm bật admins_only_send thì không.
func (s *Service) typingAllowed(ctx context.Context, convID, uid int64) (bool, error) {
	now := s.now()
	sendGates.Lock()
	g, ok := sendGates.m[convID]
	gen := sendGates.gen
	sendGates.Unlock()
	if !ok || now.Sub(g.at) >= memberCacheTTL || now.Before(g.at) {
		p, err := s.pool()
		if err != nil {
			return false, err
		}
		var admins []int64
		g = sendGate{at: now, admins: map[int64]bool{}}
		err = p.QueryRow(ctx, `select c.conversation_type = 'group' and c.is_admin_only_send,
				coalesce((select array_agg(m.user_id) from chat_conversation_members m
					where m.conversation_id = c.id and m.left_at is null and m.member_role in ('owner', 'admin')), '{}'::bigint[])
			from chat_conversations c where c.id = $1`, convID).Scan(&g.adminsOnly, &admins)
		if noRows(err) {
			return true, nil
		}
		if err != nil {
			return false, err
		}
		for _, id := range admins {
			g.admins[id] = true
		}
		sendGates.Lock()
		if len(sendGates.m) > 50000 {
			sendGates.m = map[int64]sendGate{}
		}
		if sendGates.gen == gen {
			sendGates.m[convID] = g
		}
		sendGates.Unlock()
	}
	return !g.adminsOnly || g.admins[uid], nil
}

// ───────────── Gói WebSocket của quản trị nhóm ─────────────

// groupJob: chạy job qua bộ chạy tuần tự theo hội thoại của gateway (sau message.new của tin hệ thống cùng thao tác).
// Không có gateway: bỏ (job chỉ gửi gói WebSocket / gỡ presence).
func (s *Service) groupJob(convID int64, what string, job func(ctx context.Context, p querier)) {
	g := s.gateway()
	if g == nil {
		return
	}
	run := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		p, err := s.pool()
		if err != nil {
			return
		}
		job(ctx, p)
	}
	if !g.Submit(convID, run) {
		logger.Error("chat", "hàng đợi phân phối đầy, bỏ", what, "của hội thoại", convID)
	}
}

// activeIDs: thành viên đang hoạt động (adminsOnly: chỉ trưởng / phó nhóm).
func activeIDs(ctx context.Context, q querier, convID int64, adminsOnly bool) ([]int64, error) {
	return idList(ctx, q, `select user_id from chat_conversation_members where conversation_id = $1 and left_at is null
		and (not $2::boolean or member_role in ('owner', 'admin')) order by user_id`, convID, adminsOnly)
}

// groupInfo: data của conversation.updated (giống nhau với mọi người nhận).
func (s *Service) groupInfo(ctx context.Context, q querier, convID int64) (*GroupInfoDTO, error) {
	d := &GroupInfoDTO{ConversationID: convID, Settings: &GroupSettingsDTO{}}
	var avatar *int64
	var at time.Time
	if err := q.QueryRow(ctx, `select name, description, avatar_media_id, is_admin_only_send, is_admin_only_info, is_admin_only_add,
			disbanded_at is not null, updated_at
		from chat_conversations where id = $1`, convID).Scan(&d.Name, &d.Description, &avatar, &d.Settings.AdminsOnlySend,
		&d.Settings.AdminsOnlyEditInfo, &d.Settings.AdminsOnlyAddMembers, &d.Disbanded, &at); err != nil {
		return nil, err
	}
	d.UpdatedAt = iso(at)
	if avatar != nil {
		mds, err := s.mediaDTOs(ctx, q, []int64{*avatar})
		if err != nil {
			return nil, err
		}
		d.Avatar = groupAvatar(avatar, mds)
	}
	return d, nil
}

// emitConversationUpdated: conversation.updated tới thành viên đang hoạt động (to != nil: đúng những người này - giải tán).
func (s *Service) emitConversationUpdated(convID int64, to []int64) {
	s.groupJob(convID, "conversation.updated", func(ctx context.Context, p querier) {
		d, err := s.groupInfo(ctx, p, convID)
		ids := to
		if err == nil && ids == nil {
			ids, err = activeIDs(ctx, p, convID, false)
		}
		if err != nil {
			logger.Error("chat", "dựng conversation.updated của hội thoại", convID, "lỗi:", err.Error())
			return
		}
		s.sendTo(ids, "conversation.updated", d)
	})
}

// emitMembersUpdated: members.updated {conversation_id, member_count} tới thành viên đang hoạt động (sau thay đổi):
// thêm / xoá / rời, đổi vai trò, chuyển trưởng nhóm, vào qua link, được duyệt.
func (s *Service) emitMembersUpdated(convID int64) {
	s.groupJob(convID, "members.updated", func(ctx context.Context, p querier) {
		to, err := activeIDs(ctx, p, convID, false)
		if err != nil {
			logger.Error("chat", "dựng members.updated của hội thoại", convID, "lỗi:", err.Error())
			return
		}
		s.sendTo(to, "members.updated", MembersUpdatedDTO{ConversationID: convID, MemberCount: int64(len(to))})
	})
}

// emitJoinRequestsUpdated: join_requests.updated {conversation_id, pending_count} tới trưởng / phó nhóm đang hoạt động.
func (s *Service) emitJoinRequestsUpdated(convID int64) {
	s.groupJob(convID, "join_requests.updated", func(ctx context.Context, p querier) {
		n, err := pendingJoinRequestCount(ctx, p, convID)
		var to []int64
		if err == nil {
			to, err = activeIDs(ctx, p, convID, true)
		}
		if err != nil {
			logger.Error("chat", "dựng join_requests.updated của hội thoại", convID, "lỗi:", err.Error())
			return
		}
		s.sendTo(to, "join_requests.updated", JoinRequestsUpdatedDTO{ConversationID: convID, PendingCount: int64(n)})
	})
}

// ───────────── Thông tin, cài đặt, trưởng nhóm, giải tán ─────────────

func eqStrPtr(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
func eqIDPtr(a, b *int64) bool   { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// UpdateGroupInfo: PATCH /conversations/:id - đổi tên / mô tả / ảnh nhóm (khoá vắng = giữ nguyên). Quyền: trưởng / phó
// nhóm; member khi admins_only_edit_info = false. Mỗi thay đổi một tin hệ thống (tên -> ảnh -> mô tả), rồi
// conversation.updated. Ảnh: tệp image ready của chính người đổi, khoá for share trong transaction (janitor bỏ qua).
func (s *Service) UpdateGroupInfo(ctx context.Context, uid, convID int64, in GroupInfoPatch) (*ConversationDetailDTO, error) {
	if in.Name == nil && !in.Description.Set && !in.AvatarMediaID.Set {
		return nil, errBad("Không có gì để cập nhật")
	}
	var name, desc *string
	var avatar *int64
	if in.Name != nil {
		n, err := groupName(*in.Name)
		if err != nil {
			return nil, err
		}
		name = &n
	}
	if in.Description.Set && in.Description.Value != nil {
		d := strings.TrimSpace(*in.Description.Value)
		if utf8.RuneCountInString(d) > maxDescription || strings.ContainsRune(d, 0) {
			return nil, errBad("Mô tả nhóm tối đa 500 ký tự")
		}
		if d != "" {
			desc = &d
		}
	}
	if in.AvatarMediaID.Set && in.AvatarMediaID.ID != nil {
		if s.media == nil {
			return nil, errMediaDisabled
		}
		if *in.AvatarMediaID.ID <= 0 {
			return nil, errMediaNotFound
		}
		avatar = in.AvatarMediaID.ID
	}
	var msgs []*msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		st, err := groupSettings(ctx, tx, convID)
		if err != nil {
			return err
		}
		if !canDo(role, st, ActEditInfo) {
			return errForbidden("Chỉ trưởng / phó nhóm được đổi thông tin nhóm")
		}
		var curDesc *string
		var curAvatar *int64
		if err := tx.QueryRow(ctx, `select description, avatar_media_id from chat_conversations where id = $1`, convID).
			Scan(&curDesc, &curAvatar); err != nil {
			return err
		}
		newName, newDesc, newAvatar := c.name, curDesc, curAvatar
		var contents []string
		if name != nil && !eqStrPtr(c.name, name) {
			newName = name
			contents = append(contents, actor+" đã đổi tên nhóm thành “"+*name+"”")
		}
		if in.AvatarMediaID.Set && !eqIDPtr(curAvatar, avatar) {
			if avatar != nil {
				var owner int64
				var typ, status string
				err := tx.QueryRow(ctx, `select uploader_id, media_type, status from chat_media where id = $1 for share`, *avatar).
					Scan(&owner, &typ, &status)
				if noRows(err) || (err == nil && owner != uid) {
					return errMediaNotFound
				}
				if err != nil {
					return err
				}
				if status != mediaReady {
					return errMediaNotReady
				}
				if typ != MediaImage {
					return errBad("Ảnh nhóm phải là tệp ảnh")
				}
				contents = append(contents, actor+" đã đổi ảnh đại diện nhóm")
			} else {
				contents = append(contents, actor+" đã xoá ảnh đại diện nhóm")
			}
			newAvatar = avatar
		}
		if in.Description.Set && !eqStrPtr(curDesc, desc) {
			newDesc = desc
			if desc != nil {
				contents = append(contents, actor+" đã cập nhật mô tả nhóm")
			} else {
				contents = append(contents, actor+" đã xoá mô tả nhóm")
			}
		}
		if len(contents) == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `update chat_conversations set name = $2, description = $3, avatar_media_id = $4::bigint,
			updated_at = clock_timestamp() where id = $1`, convID, newName, newDesc, newAvatar); err != nil {
			return err
		}
		c.name = newName
		for _, content := range contents {
			m, err := insertMessageTx(ctx, tx, c, uid, actor, "system", content, nil, nil, nil)
			if err != nil {
				return err
			}
			msgs = append(msgs, m)
		}
		return nil
	})
	if isFK(err, "fk_chat_conversations_avatar_media_id") { // phòng thủ: tệp vừa bị xoá
		return nil, errMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(msgs) > 0 {
		for _, m := range msgs {
			s.dispatch(m, nil)
		}
		s.emitConversationUpdated(convID, nil)
	}
	return s.Conversation(ctx, uid, convID)
}

// UpdateGroupSettings: PATCH /conversations/:id/settings - trưởng / phó nhóm bật / tắt 3 cờ quyền (khoá vắng = giữ
// nguyên). Mỗi cờ đổi một tin hệ thống (gửi tin -> đổi thông tin -> thêm thành viên), rồi conversation.updated.
func (s *Service) UpdateGroupSettings(ctx context.Context, uid, convID int64, in GroupSettingsPatch) (*ConversationDetailDTO, error) {
	if in.AdminsOnlySend == nil && in.AdminsOnlyEditInfo == nil && in.AdminsOnlyAddMembers == nil {
		return nil, errBad("Không có gì để cập nhật")
	}
	var msgs []*msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		st, err := groupSettings(ctx, tx, convID)
		if err != nil {
			return err
		}
		if !canDo(role, st, ActEditSettings) {
			return errForbidden("Chỉ trưởng / phó nhóm được đổi cài đặt nhóm")
		}
		var contents []string
		flag := func(cur *bool, want *bool, tail string) {
			if want == nil || *want == *cur {
				return
			}
			*cur = *want
			verb := " đã tắt chế độ chỉ trưởng / phó nhóm được "
			if *want {
				verb = " đã bật chế độ chỉ trưởng / phó nhóm được "
			}
			contents = append(contents, actor+verb+tail)
		}
		flag(&st.AdminsOnlySend, in.AdminsOnlySend, "gửi tin")
		flag(&st.AdminsOnlyEditInfo, in.AdminsOnlyEditInfo, "đổi thông tin nhóm")
		flag(&st.AdminsOnlyAddMembers, in.AdminsOnlyAddMembers, "thêm thành viên")
		if len(contents) == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `update chat_conversations set is_admin_only_send = $2::boolean, is_admin_only_info = $3::boolean,
			is_admin_only_add = $4::boolean, updated_at = clock_timestamp() where id = $1`,
			convID, st.AdminsOnlySend, st.AdminsOnlyEditInfo, st.AdminsOnlyAddMembers); err != nil {
			return err
		}
		for _, content := range contents {
			m, err := insertMessageTx(ctx, tx, c, uid, actor, "system", content, nil, nil, nil)
			if err != nil {
				return err
			}
			msgs = append(msgs, m)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(msgs) > 0 {
		forgetSendGate(convID)
		for _, m := range msgs {
			s.dispatch(m, nil)
		}
		s.emitConversationUpdated(convID, nil)
	}
	return s.Conversation(ctx, uid, convID)
}

// TransferOwnership: POST /conversations/:id/owner - trưởng nhóm chuyển quyền cho thành viên đang hoạt động target
// (target thành owner, trưởng nhóm cũ thành admin) + tin hệ thống + members.updated.
func (s *Service) TransferOwnership(ctx context.Context, uid, convID, target int64) (*ConversationDetailDTO, error) {
	if target <= 0 {
		return nil, errBad("Thiếu user_id")
	}
	var msg *msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		if !canDo(role, GroupSettingsDTO{}, ActTransferOwner) {
			return errForbidden("Chỉ trưởng nhóm được chuyển quyền trưởng nhóm")
		}
		if target == uid {
			return errBad("Bạn đã là trưởng nhóm")
		}
		tr, err := activeRole(ctx, tx, convID, target)
		if err != nil {
			return err
		}
		if tr == "" {
			return errNotFound("Người này không còn trong nhóm")
		}
		if _, err := tx.Exec(ctx, `update chat_conversation_members set member_role = 'admin', updated_at = clock_timestamp()
			where conversation_id = $1 and user_id = $2`, convID, uid); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update chat_conversation_members set member_role = 'owner', updated_at = clock_timestamp()
			where conversation_id = $1 and user_id = $2`, convID, target); err != nil {
			return err
		}
		names, err := displayNames(ctx, tx, []int64{target})
		if err != nil {
			return err
		}
		msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", actor+" đã chuyển quyền trưởng nhóm cho "+names[target], nil, nil, nil)
		return err
	})
	if err != nil {
		return nil, err
	}
	forgetSendGate(convID)
	s.dispatch(msg, nil)
	s.emitMembersUpdated(convID)
	return s.Conversation(ctx, uid, convID)
}

// maxDisbandPresenceRecheck: giải tán nhóm lớn hơn thì không kiểm lại quyền xem online từng cặp (N^2 phép kiểm); đăng ký
// presence cũ còn tới khi client kết nối lại / đăng ký lại.
const maxDisbandPresenceRecheck = 200

// DisbandGroup: POST /conversations/:id/disband - trưởng nhóm giải tán. GIỮ tin (chỉ đọc), trong MỘT transaction khoá
// dòng hội thoại: tin hệ thống (khi mọi người còn là thành viên) -> disbanded_at -> mọi thành viên đang hoạt động
// left_at = disbanded_at (giữ vai trò) -> thu hồi link mời -> yêu cầu chờ duyệt thành cancelled. Sau commit: message.new
// rồi conversation.updated (disbanded: true) tới mọi thành viên lúc giải tán, bỏ cache thành viên.
func (s *Service) DisbandGroup(ctx context.Context, uid, convID int64) error {
	var msg *msgRow
	var members []int64
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, role, actor, err := lockGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		if !canDo(role, GroupSettingsDTO{}, ActDisband) {
			return errForbidden("Chỉ trưởng nhóm được giải tán nhóm")
		}
		if members, err = activeIDs(ctx, tx, convID, false); err != nil {
			return err
		}
		if msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", actor+" đã giải tán nhóm", nil, nil, nil); err != nil {
			return err
		}
		var at time.Time
		if err := tx.QueryRow(ctx, `update chat_conversations set disbanded_at = greatest(clock_timestamp(), updated_at),
				updated_at = greatest(clock_timestamp(), updated_at)
			where id = $1 returning disbanded_at`, convID).Scan(&at); err != nil {
			return err
		}
		// so sánh left_at = disbanded_at phải khớp từng micro giây: đặt bằng chính cột vừa ghi, không qua giá trị Go
		if _, err := tx.Exec(ctx, `update chat_conversation_members m set left_at = c.disbanded_at, updated_at = c.disbanded_at
			from chat_conversations c where c.id = m.conversation_id and m.conversation_id = $1 and m.left_at is null`, convID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update chat_group_invite_links set revoked_at = $2::timestamptz
			where conversation_id = $1 and revoked_at is null`, convID, pgTime(at)); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update chat_group_join_requests set status = 'cancelled', resolved_at = $2::timestamptz
			where conversation_id = $1 and status = 'pending'`, convID, pgTime(at))
		return err
	})
	if err != nil {
		return err
	}
	s.forgetMembers(convID)
	forgetSendGate(convID)
	s.dispatch(msg, members)
	s.emitConversationUpdated(convID, members)
	if len(members) <= maxDisbandPresenceRecheck {
		s.groupJob(convID, "kiểm lại quyền xem online", func(ctx context.Context, _ querier) {
			for i, u := range members {
				s.recheckPresence(ctx, u, members[i+1:])
			}
		})
	}
	return nil
}
