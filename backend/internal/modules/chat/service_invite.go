package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
)

// Link mời vào nhóm + hàng chờ duyệt (migration 0022, API.md mục "Quản trị nhóm" - Link mời / tham gia).
// Token = 32 byte ngẫu nhiên base64url (43 ký tự), DB chỉ lưu sha256 hex; tối đa 1 link hiệu lực mỗi nhóm
// (uq_chat_group_invite_links_conversation_id). Vào nhóm qua link KHÔNG cần là bạn bè của ai.

var reInviteToken = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// Giới hạn tần suất (API.md: tạo link 30 / giờ, preview 60 / phút, join 20 / giờ mỗi người).
type inviteLimits struct {
	create, preview, join *limiter
}

// inviteLimitMap: *Service -> *inviteLimits (khởi tạo lười, không đụng struct Service ở service.go).
var inviteLimitMap sync.Map

func (s *Service) inviteLimiters() *inviteLimits {
	if v, ok := inviteLimitMap.Load(s); ok {
		return v.(*inviteLimits)
	}
	l := &inviteLimits{
		create:  newLimiter(30, time.Hour, s.now),
		preview: newLimiter(60, time.Minute, s.now),
		join:    newLimiter(20, time.Hour, s.now),
	}
	v, _ := inviteLimitMap.LoadOrStore(s, l)
	return v.(*inviteLimits)
}

// pendingJoinRequestCount: số yêu cầu vào nhóm đang chờ duyệt của hội thoại (ConversationDetail.pending_join_requests,
// join_requests.updated).
func pendingJoinRequestCount(ctx context.Context, q querier, convID int64) (int, error) {
	var n int
	err := q.QueryRow(ctx, `select count(*) from chat_group_join_requests where conversation_id = $1 and status = 'pending'`,
		convID).Scan(&n)
	return n, err
}

// inviteTokenHash: sha256 hex chữ thường của token (cột token_hash).
func inviteTokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// newInviteToken: 32 byte ngẫu nhiên -> base64url không đệm (43 ký tự).
func newInviteToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

const inviteLinkCols = `l.id, l.conversation_id, l.requires_approval, l.expires_at, coalesce(l.expires_at <= now(), false),
  l.use_count, l.created_by, u.display_name, l.created_at`

func scanInviteLink(r pgx.Row) (*InviteLinkDTO, error) {
	d := &InviteLinkDTO{}
	var exp *time.Time
	var at time.Time
	if err := r.Scan(&d.ID, &d.ConversationID, &d.RequiresApproval, &exp, &d.Expired, &d.UseCount, &d.CreatedBy,
		&d.CreatedByName, &at); err != nil {
		return nil, err
	}
	d.ExpiresAt, d.CreatedAt = isoPtr(exp), iso(at)
	return d, nil
}

// inviteViewer: vai trò của uid trong nhóm convID để ĐỌC (thành viên đang hoạt động, hoặc dòng chỉ đọc sau giải tán:
// left_at = disbanded_at). Không phải thành viên -> errNotMember; chat 1-1 -> errNotGroup.
func inviteViewer(ctx context.Context, q querier, convID, uid int64) (role string, disbanded bool, err error) {
	var typ string
	err = q.QueryRow(ctx, `select c.conversation_type, c.disbanded_at is not null, m.member_role
		from chat_conversations c
		join chat_conversation_members m on m.conversation_id = c.id and m.user_id = $2
		where c.id = $1 and (m.left_at is null or (c.disbanded_at is not null and m.left_at = c.disbanded_at))`,
		convID, uid).Scan(&typ, &disbanded, &role)
	if noRows(err) {
		return "", false, errNotMember
	}
	if err != nil {
		return "", false, err
	}
	if typ != "group" {
		return "", false, errNotGroup
	}
	return role, disbanded, nil
}

// lockInviteGroup: khoá dòng hội thoại để GHI (lockGroup) + 410 với nhóm đã giải tán (kể cả khi uid chỉ còn dòng chỉ
// đọc) + cài đặt quyền của nhóm.
func lockInviteGroup(ctx context.Context, tx pgx.Tx, convID, uid int64) (convRef, string, string, GroupSettingsDTO, error) {
	var st GroupSettingsDTO
	c, role, actor, err := lockGroup(ctx, tx, convID, uid)
	if err == errNotMember {
		var ro bool
		if e2 := tx.QueryRow(ctx, `select exists(select 1 from chat_conversation_members m
			join chat_conversations c on c.id = m.conversation_id
			where m.conversation_id = $1 and m.user_id = $2 and c.disbanded_at is not null and m.left_at = c.disbanded_at)`,
			convID, uid).Scan(&ro); e2 != nil {
			return c, "", "", st, e2
		}
		if ro {
			return c, "", "", st, errGroupDisbanded
		}
	}
	if err != nil {
		return c, "", "", st, err
	}
	if err := requireGroupWritable(ctx, tx, convID); err != nil {
		return c, "", "", st, err
	}
	st, err = groupSettings(ctx, tx, convID)
	return c, role, actor, st, err
}

// GetInviteLink: link hiệu lực (chưa thu hồi; có thể đã quá hạn - expired = true) của nhóm, không có token. Mọi thành
// viên xem được; use_count chỉ trưởng / phó nhóm thấy số thật. Nhóm đã giải tán -> null.
func (s *Service) GetInviteLink(ctx context.Context, uid, convID int64) (*InviteLinkResult, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	role, disbanded, err := inviteViewer(ctx, p, convID, uid)
	if err != nil {
		return nil, err
	}
	res := &InviteLinkResult{}
	if disbanded {
		return res, nil
	}
	d, err := scanInviteLink(p.QueryRow(ctx, `select `+inviteLinkCols+` from chat_group_invite_links l
		join chat_users u on u.id = l.created_by where l.conversation_id = $1 and l.revoked_at is null`, convID))
	if noRows(err) {
		return res, nil
	}
	if err != nil {
		return nil, err
	}
	if !canDo(role, GroupSettingsDTO{}, ActManageRequests) {
		d.UseCount = 0
	}
	res.InviteLink = d
	return res, nil
}

// CreateInviteLink: tạo link mới (thu hồi link hiệu lực cũ trong cùng transaction = "tạo lại link"). Kết quả có token +
// url_path (lần duy nhất). Không sinh tin hệ thống.
func (s *Service) CreateInviteLink(ctx context.Context, uid, convID int64, in InviteCreateInput) (*InviteLinkResult, error) {
	if in.ExpiresIn != nil && (*in.ExpiresIn < inviteMinExpiresIn || *in.ExpiresIn > inviteMaxExpiresIn) {
		return nil, errBad("expires_in phải từ " + strconv.Itoa(inviteMinExpiresIn) + " đến " + strconv.Itoa(inviteMaxExpiresIn) + " giây")
	}
	if !s.inviteLimiters().create.allow(uid) {
		return nil, errRateLimit
	}
	token, err := newInviteToken()
	if err != nil {
		return nil, err
	}
	var d *InviteLinkDTO
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		_, role, _, st, err := lockInviteGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		if !canDo(role, st, ActCreateInvite) {
			return errForbidden("Chỉ trưởng / phó nhóm được tạo link mời")
		}
		// Thành viên thường không được "tạo lại" đè lên link của người khác (cùng luật với thu hồi): tránh việc thay
		// link cần duyệt của trưởng nhóm bằng link vào thẳng.
		var oldID, oldBy int64
		err = tx.QueryRow(ctx, `select id, created_by from chat_group_invite_links where conversation_id = $1 and revoked_at is null
			for update`, convID).Scan(&oldID, &oldBy)
		if err != nil && !noRows(err) {
			return err
		}
		if err == nil {
			if role != "owner" && role != "admin" && oldBy != uid {
				return errForbidden("Bạn không có quyền thu hồi link này")
			}
			if _, err := tx.Exec(ctx, `update chat_group_invite_links set revoked_at = now() where id = $1`, oldID); err != nil {
				return err
			}
		}
		var id int64
		if err := tx.QueryRow(ctx, `insert into chat_group_invite_links (conversation_id, token_hash, created_by, requires_approval, expires_at)
			values ($1, $2, $3, $4::boolean, case when $5::bigint is null then null else now() + $5::bigint * interval '1 second' end)
			returning id`, convID, inviteTokenHash(token), uid, in.RequiresApproval, in.ExpiresIn).Scan(&id); err != nil {
			return err
		}
		d, err = scanInviteLink(tx.QueryRow(ctx, `select `+inviteLinkCols+` from chat_group_invite_links l
			join chat_users u on u.id = l.created_by where l.id = $1`, id))
		return err
	})
	if err != nil {
		return nil, err
	}
	d.Token, d.URLPath = token, InviteJoinPathPrefix+token
	return &InviteLinkResult{InviteLink: d}, nil
}

// RevokeInviteLink: thu hồi link hiệu lực (trưởng / phó nhóm; thành viên thường chỉ link do mình tạo). Không có link
// -> nil (idempotent). Yêu cầu đang chờ của link vẫn duyệt được.
func (s *Service) RevokeInviteLink(ctx context.Context, uid, convID int64) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		_, role, _, _, err := lockInviteGroup(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		var id, by int64
		err = tx.QueryRow(ctx, `select id, created_by from chat_group_invite_links where conversation_id = $1 and revoked_at is null
			for update`, convID).Scan(&id, &by)
		if noRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if role != "owner" && role != "admin" && by != uid {
			return errForbidden("Bạn không có quyền thu hồi link này")
		}
		_, err = tx.Exec(ctx, `update chat_group_invite_links set revoked_at = now() where id = $1`, id)
		return err
	})
}

// InvitePreview: nhóm nhìn từ người cầm link (mọi tài khoản chat): tên, mô tả, ảnh, số thành viên - không lộ thành viên;
// conversation_id chỉ khi đã là thành viên.
func (s *Service) InvitePreview(ctx context.Context, uid int64, token string) (*InvitePreviewDTO, error) {
	if !reInviteToken.MatchString(token) {
		return nil, errInviteInvalid
	}
	if !s.inviteLimiters().preview.allow(uid) {
		return nil, errRateLimit
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	var (
		convID, count              int64
		exp                        *time.Time
		revoked, expired           bool
		typ                        string
		name, desc                 *string
		avatarID                   *int64
		disbanded, member, pending bool
		approval                   bool
	)
	err = p.QueryRow(ctx, `select l.conversation_id, l.requires_approval, l.expires_at, l.revoked_at is not null,
		coalesce(l.expires_at <= now(), false), c.conversation_type, c.name, c.description, c.avatar_media_id, c.disbanded_at is not null,
		(select count(*) from chat_conversation_members x where x.conversation_id = c.id and x.left_at is null),
		exists(select 1 from chat_conversation_members x where x.conversation_id = c.id and x.user_id = $2 and x.left_at is null),
		exists(select 1 from chat_group_join_requests r where r.conversation_id = c.id and r.user_id = $2 and r.status = 'pending')
		from chat_group_invite_links l join chat_conversations c on c.id = l.conversation_id
		where l.token_hash = $1`, inviteTokenHash(token), uid).Scan(&convID, &approval, &exp, &revoked, &expired, &typ, &name, &desc,
		&avatarID, &disbanded, &count, &member, &pending)
	if noRows(err) {
		return nil, errInviteInvalid
	}
	if err != nil {
		return nil, err
	}
	if revoked || disbanded || typ != "group" {
		return nil, errInviteInvalid
	}
	if expired {
		return nil, errInviteExpired
	}
	d := &InvitePreviewDTO{
		Group:            InviteGroupDTO{Name: deref(name), Description: desc, MemberCount: count},
		RequiresApproval: approval, ExpiresAt: isoPtr(exp), Membership: MembershipNone,
	}
	switch {
	case member:
		d.Membership = MembershipMember
		id := convID
		d.ConversationID = &id
	case pending:
		d.Membership = MembershipPending
	}
	if avatarID != nil {
		mds, err := s.mediaDTOs(ctx, p, []int64{*avatarID})
		if err != nil {
			return nil, err
		}
		d.Group.Avatar = groupAvatar(avatarID, mds)
	}
	return d, nil
}

// inviteAddMemberTx: thêm / cho vào lại user với vai trò member như AddMembers (con trỏ = last_seq, xoá muted_until).
func inviteAddMemberTx(ctx context.Context, tx pgx.Tx, convID, user int64) error {
	_, err := tx.Exec(ctx, `insert into chat_conversation_members (conversation_id, user_id, member_role, last_read_seq, last_delivered_seq)
		select $1, $2, 'member', c.last_seq, c.last_seq from chat_conversations c where c.id = $1
		on conflict (conversation_id, user_id) do update set member_role = 'member', left_at = null, joined_at = now(),
			last_read_seq = excluded.last_read_seq, last_delivered_seq = excluded.last_delivered_seq, muted_until = null, updated_at = now()`,
		convID, user)
	return err
}

// inviteGroupFull: nhóm đã đủ maxGroupMembers thành viên đang hoạt động.
func inviteGroupFull(ctx context.Context, tx pgx.Tx, convID int64) (bool, error) {
	var n int
	err := tx.QueryRow(ctx, `select count(*) from chat_conversation_members where conversation_id = $1 and left_at is null`,
		convID).Scan(&n)
	return n >= maxGroupMembers, err
}

// JoinByInvite: vào nhóm qua link. Thứ tự kiểm (API.md): token sai dạng / không có / đã thu hồi -> INVITE_INVALID; quá hạn
// -> INVITE_EXPIRED; (khoá dòng hội thoại) đã là thành viên -> already_member; chặn với trưởng nhóm hoặc người tạo link
// -> BLOCKED; link cần duyệt -> pending; đủ 1000 người -> GROUP_FULL; còn lại vào nhóm + tin hệ thống -> joined.
func (s *Service) JoinByInvite(ctx context.Context, uid int64, token string) (*JoinResultDTO, error) {
	if !reInviteToken.MatchString(token) {
		return nil, errInviteInvalid
	}
	if !s.inviteLimiters().join.allow(uid) {
		return nil, errRateLimit
	}
	hash := inviteTokenHash(token)
	res := &JoinResultDTO{}
	var (
		convID              int64
		msg                 *msgRow
		notifyMem, notifyRq bool
	)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `select conversation_id from chat_group_invite_links where token_hash = $1`, hash).Scan(&convID); err != nil {
			if noRows(err) {
				return errInviteInvalid
			}
			return err
		}
		// khoá dòng hội thoại (tuần tự với gửi tin / đổi thành viên / giải tán) rồi mới đọc lại trạng thái link
		c := convRef{id: convID}
		var disbanded bool
		if err := tx.QueryRow(ctx, `select conversation_type, name, disbanded_at is not null from chat_conversations where id = $1 for update`,
			convID).Scan(&c.typ, &c.name, &disbanded); err != nil {
			return err
		}
		var (
			linkID, creator  int64
			revoked, expired bool
			approval         bool
		)
		if err := tx.QueryRow(ctx, `select id, created_by, requires_approval, revoked_at is not null, coalesce(expires_at <= now(), false)
			from chat_group_invite_links where token_hash = $1 for update`, hash).Scan(&linkID, &creator, &approval, &revoked, &expired); err != nil {
			if noRows(err) {
				return errInviteInvalid
			}
			return err
		}
		if revoked || c.typ != "group" {
			return errInviteInvalid
		}
		if expired {
			return errInviteExpired
		}
		if disbanded { // giải tán đã thu hồi link (phòng thủ)
			return errGroupDisbanded
		}
		role, err := activeRole(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		if role != "" {
			res.Status, res.ConversationID = JoinAlreadyMember, &convID
			return nil
		}
		owners, err := idList(ctx, tx, `select user_id from chat_conversation_members
			where conversation_id = $1 and left_at is null and member_role = 'owner'`, convID)
		if err != nil {
			return err
		}
		for _, other := range append(owners, creator) {
			b, err := blockedBetween(ctx, tx, uid, other)
			if err != nil {
				return err
			}
			if b {
				return errBlocked("Bạn không thể tham gia nhóm này")
			}
		}
		if approval {
			var reqID int64
			err := tx.QueryRow(ctx, `select id from chat_group_join_requests where conversation_id = $1 and user_id = $2 and status = 'pending'`,
				convID, uid).Scan(&reqID)
			if noRows(err) {
				err = tx.QueryRow(ctx, `insert into chat_group_join_requests (conversation_id, user_id, invite_link_id) values ($1, $2, $3)
					returning id`, convID, uid, linkID).Scan(&reqID)
				notifyRq = true
			}
			if err != nil {
				return err
			}
			res.Status, res.RequestID = JoinPending, &reqID
			return nil
		}
		full, err := inviteGroupFull(ctx, tx, convID)
		if err != nil {
			return err
		}
		if full {
			return errGroupFull
		}
		if err := inviteAddMemberTx(ctx, tx, convID, uid); err != nil {
			return err
		}
		// yêu cầu đang chờ (qua link cần duyệt khác) không còn ý nghĩa
		tag, err := tx.Exec(ctx, `update chat_group_join_requests set status = 'cancelled', resolved_at = now()
			where conversation_id = $1 and user_id = $2 and status = 'pending'`, convID, uid)
		if err != nil {
			return err
		}
		notifyRq = tag.RowsAffected() > 0
		if _, err := tx.Exec(ctx, `update chat_group_invite_links set use_count = use_count + 1 where id = $1`, linkID); err != nil {
			return err
		}
		names, err := displayNames(ctx, tx, []int64{uid})
		if err != nil {
			return err
		}
		if msg, err = insertMessageTx(ctx, tx, c, uid, names[uid], "system", names[uid]+" đã tham gia nhóm qua link mời", nil, nil, nil); err != nil {
			return err
		}
		notifyMem = true
		res.Status, res.ConversationID = JoinJoined, &convID
		return nil
	})
	if err != nil {
		return nil, err
	}
	if msg != nil {
		s.forgetMembers(convID)
		s.dispatch(msg, nil)
	}
	s.inviteNotify(convID, notifyMem, notifyRq)
	return res, nil
}

// lockJoinRequest: yêu cầu reqID còn chờ duyệt của nhóm convID (khoá dòng) -> người xin + link đã dùng.
func lockJoinRequest(ctx context.Context, tx pgx.Tx, convID, reqID int64) (user, linkID int64, err error) {
	var conv int64
	var status string
	err = tx.QueryRow(ctx, `select conversation_id, user_id, invite_link_id, status from chat_group_join_requests where id = $1 for update`,
		reqID).Scan(&conv, &user, &linkID, &status)
	if noRows(err) || (err == nil && (conv != convID || status != "pending")) {
		return 0, 0, errNotFound("Yêu cầu không còn chờ duyệt")
	}
	return user, linkID, err
}

// lockRequestManager: khoá nhóm để duyệt / từ chối; chỉ trưởng / phó nhóm.
func lockRequestManager(ctx context.Context, tx pgx.Tx, convID, uid int64) (convRef, string, error) {
	c, role, actor, st, err := lockInviteGroup(ctx, tx, convID, uid)
	if err != nil {
		return c, "", err
	}
	if !canDo(role, st, ActManageRequests) {
		return c, "", errForbidden("Chỉ trưởng / phó nhóm được duyệt thành viên")
	}
	return c, actor, nil
}

// ListJoinRequests: yêu cầu đang chờ duyệt của nhóm (cũ trước, tối đa maxJoinRequestList); chỉ trưởng / phó nhóm.
// Nhóm đã giải tán (dòng chỉ đọc): không còn yêu cầu nào -> danh sách rỗng.
func (s *Service) ListJoinRequests(ctx context.Context, uid, convID int64) (*JoinRequestList, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	role, disbanded, err := inviteViewer(ctx, p, convID, uid)
	if err != nil {
		return nil, err
	}
	if !canDo(role, GroupSettingsDTO{}, ActManageRequests) {
		return nil, errForbidden("Chỉ trưởng / phó nhóm được duyệt thành viên")
	}
	out := &JoinRequestList{Requests: []JoinRequestDTO{}}
	if disbanded {
		return out, nil
	}
	rows, err := p.Query(ctx, `select id, user_id, created_at from chat_group_join_requests
		where conversation_id = $1 and status = 'pending' order by created_at, id limit `+strconv.Itoa(maxJoinRequestList), convID)
	if err != nil {
		return nil, err
	}
	type reqRow struct {
		id, user int64
		at       time.Time
	}
	var rs []reqRow
	var ids []int64
	for rows.Next() {
		var r reqRow
		if err := rows.Scan(&r.id, &r.user, &r.at); err != nil {
			rows.Close()
			return nil, err
		}
		rs = append(rs, r)
		ids = append(ids, r.user)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	users, err := loadUsers(ctx, p, uid, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range rs {
		u := users[r.user]
		if u == nil {
			continue
		}
		out.Requests = append(out.Requests, JoinRequestDTO{ID: r.id, ConversationID: convID, User: u.dto(uid, false, false, false, nil),
			CreatedAt: iso(r.at)})
	}
	return out, nil
}

// ApproveJoinRequest: duyệt yêu cầu: người xin đã là thành viên -> approved, không tin hệ thống; nhóm đủ -> GROUP_FULL
// (yêu cầu vẫn chờ); còn lại vào nhóm + tin hệ thống "A đã duyệt B vào nhóm" + use_count của link đã dùng.
func (s *Service) ApproveJoinRequest(ctx context.Context, uid, convID, reqID int64) (*JoinRequestResult, error) {
	var msg *msgRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, actor, err := lockRequestManager(ctx, tx, convID, uid)
		if err != nil {
			return err
		}
		user, linkID, err := lockJoinRequest(ctx, tx, convID, reqID)
		if err != nil {
			return err
		}
		role, err := activeRole(ctx, tx, convID, user)
		if err != nil {
			return err
		}
		if role == "" {
			// kiểm lại chặn (như lúc xin vào): có thể phát sinh sau khi yêu cầu được tạo; yêu cầu vẫn chờ
			var creator int64
			if err := tx.QueryRow(ctx, `select created_by from chat_group_invite_links where id = $1`, linkID).Scan(&creator); err != nil {
				return err
			}
			owners, err := idList(ctx, tx, `select user_id from chat_conversation_members
				where conversation_id = $1 and left_at is null and member_role = 'owner'`, convID)
			if err != nil {
				return err
			}
			for _, other := range append(owners, creator) {
				b, err := blockedBetween(ctx, tx, user, other)
				if err != nil {
					return err
				}
				if b {
					return errBlocked("Bạn không thể tham gia nhóm này")
				}
			}
			full, err := inviteGroupFull(ctx, tx, convID)
			if err != nil {
				return err
			}
			if full {
				return errGroupFull
			}
			if err := inviteAddMemberTx(ctx, tx, convID, user); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `update chat_group_invite_links set use_count = use_count + 1 where id = $1`, linkID); err != nil {
				return err
			}
			names, err := displayNames(ctx, tx, []int64{user})
			if err != nil {
				return err
			}
			if msg, err = insertMessageTx(ctx, tx, c, uid, actor, "system", actor+" đã duyệt "+names[user]+" vào nhóm", nil, nil, nil); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `update chat_group_join_requests set status = 'approved', resolved_by = $2, resolved_at = now() where id = $1`,
			reqID, uid)
		return err
	})
	if err != nil {
		return nil, err
	}
	if msg != nil {
		s.forgetMembers(convID)
		s.dispatch(msg, nil)
	}
	s.inviteNotify(convID, msg != nil, true)
	return &JoinRequestResult{Status: "approved"}, nil
}

// RejectJoinRequest: từ chối yêu cầu (không tin hệ thống, người xin không được báo).
func (s *Service) RejectJoinRequest(ctx context.Context, uid, convID, reqID int64) (*JoinRequestResult, error) {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, _, err := lockRequestManager(ctx, tx, convID, uid); err != nil {
			return err
		}
		if _, _, err := lockJoinRequest(ctx, tx, convID, reqID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `update chat_group_join_requests set status = 'rejected', resolved_by = $2, resolved_at = now() where id = $1`,
			reqID, uid)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.inviteNotify(convID, false, true)
	return &JoinRequestResult{Status: "rejected"}, nil
}

// inviteNotify: members.updated (thành viên đang hoạt động) và / hoặc join_requests.updated (trưởng / phó nhóm đang hoạt
// động), qua bộ chạy tuần tự theo hội thoại - SAU message.new của tin hệ thống cùng thao tác. Số liệu đọc lúc gửi.
func (s *Service) inviteNotify(convID int64, members, requests bool) {
	if !members && !requests {
		return
	}
	job := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if members {
			mem, err := s.activeMembers(ctx, convID)
			if err != nil {
				logger.Error("chat", "đọc thành viên hội thoại", convID, "lỗi:", err.Error())
			} else {
				to := make([]int64, 0, len(mem))
				for _, x := range mem {
					to = append(to, x.userID)
				}
				s.sendTo(to, "members.updated", MembersUpdatedDTO{ConversationID: convID, MemberCount: int64(len(to))})
			}
		}
		if requests {
			p, err := s.pool()
			if err != nil {
				return
			}
			admins, err := idList(ctx, p, `select user_id from chat_conversation_members
				where conversation_id = $1 and left_at is null and member_role in ('owner', 'admin')`, convID)
			if err != nil {
				logger.Error("chat", "đọc trưởng / phó nhóm của hội thoại", convID, "lỗi:", err.Error())
				return
			}
			n, err := pendingJoinRequestCount(ctx, p, convID)
			if err != nil {
				logger.Error("chat", "đếm yêu cầu vào nhóm của hội thoại", convID, "lỗi:", err.Error())
				return
			}
			s.sendTo(admins, "join_requests.updated", JoinRequestsUpdatedDTO{ConversationID: convID, PendingCount: int64(n)})
		}
	}
	g := s.gateway()
	if g == nil {
		job()
		return
	}
	if !g.Submit(convID, job) {
		logger.Error("chat", "hàng đợi phân phối đầy, bỏ members.updated / join_requests.updated của hội thoại", convID)
	}
}
