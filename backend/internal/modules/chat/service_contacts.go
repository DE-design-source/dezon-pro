package chat

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Danh bạ: tra số điện thoại / email, đồng bộ danh bạ, bạn bè, lời mời kết bạn, chặn (CHAT.md 3 - User service).

const (
	maxMatch    = 1000
	matchPerDay = 5000 // số được tra (tra 1 số + đối chiếu danh bạ) / ngày / người, xem Service.matchLimit
)

var reSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func pairKey(a, b int64) string {
	if a > b {
		a, b = b, a
	}
	return "pair:" + strconv.FormatInt(a, 10) + ":" + strconv.FormatInt(b, 10)
}

// userExists: tài khoản id có tồn tại không.
func userExists(ctx context.Context, q querier, id int64) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `select exists(select 1 from chat_users where id = $1)`, id).Scan(&ok)
	return ok, err
}

// SearchUser tra đúng một số điện thoại hoặc một email (rawPhone / rawEmail, đúng một trong hai, cùng quy tắc với
// RequestOTP); không có -> nil. Tra số chỉ lộ số, tra email chỉ lộ email của người tìm thấy.
func (s *Service) SearchUser(ctx context.Context, uid int64, rawPhone, rawEmail string) (*UserDTO, error) {
	to, err := parseTarget(rawPhone, rawEmail)
	if err != nil {
		return nil, err
	}
	if !s.searchLimit.allow(uid) {
		return nil, errRateLimit
	}
	if !s.matchLimit.allow(uid) {
		return nil, errMatchLimit
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	var id int64
	if err := p.QueryRow(ctx, `select id from chat_users where `+to.col+` = $1`, to.value).Scan(&id); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, err
	}
	u, err := loadUser(ctx, p, uid, id)
	if err != nil || u == nil {
		return nil, err
	}
	d := u.dto(uid, !to.isEmail(), to.isEmail(), false, s.online([]int64{id}))
	return &d, nil
}

// MatchContacts: người đang dùng chat trong danh bạ gửi lên (số điện thoại thô và / hoặc sha256 hex của số E.164).
func (s *Service) MatchContacts(ctx context.Context, uid int64, phones, hashes []string) ([]MatchedUserDTO, error) {
	if len(phones) > maxMatch || len(hashes) > maxMatch {
		return nil, errBad("Tối đa 1000 số và 1000 hash mỗi lần")
	}
	if !s.searchLimit.allow(uid) {
		return nil, errRateLimit
	}
	byPhone := map[string]string{} // E.164 -> chuỗi client gửi
	norm := []string{}
	for _, raw := range phones {
		if p, ok := NormalizePhone(raw); ok {
			if _, dup := byPhone[p]; !dup {
				byPhone[p] = raw
				norm = append(norm, p)
			}
		}
	}
	byHash := map[string]string{}
	hs := []string{}
	for _, raw := range hashes {
		h := strings.ToLower(strings.TrimSpace(raw))
		if reSHA256.MatchString(h) {
			if _, dup := byHash[h]; !dup {
				byHash[h] = raw
				hs = append(hs, h)
			}
		}
	}
	out := []MatchedUserDTO{}
	if len(norm) == 0 && len(hs) == 0 {
		return out, nil
	}
	// giới hạn theo SỐ được tra chứ không chỉ theo lượt gọi: 60 lượt x 2000 số / phút đủ dò hết dải số di động trong
	// vài ngày (lộ số -> tên của mọi người dùng)
	if !s.matchLimit.allowN(uid, float64(len(norm)+len(hs))) {
		return nil, errMatchLimit
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	// tài khoản tạo bằng email (phone, phone_hash null) không bao giờ khớp
	rows, err := p.Query(ctx, `select `+userCols+`, coalesce(u.phone_hash, '') from chat_users u
		where (u.phone = any($2::text[]) or u.phone_hash = any($3::text[])) and u.id <> $1
		order by lower(u.display_name), u.id`, uid, norm, hs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []*userRow
	for rows.Next() {
		var ph string
		u, err := scanUser(rows, &ph)
		if err != nil {
			return nil, err
		}
		u.matchHash = ph
		found = append(found, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids := make([]int64, len(found))
	for i, u := range found {
		ids[i] = u.id
	}
	online := s.online(ids)
	for _, u := range found {
		m, ok := "", false
		if u.phone != nil {
			m, ok = byPhone[*u.phone]
		}
		if !ok {
			m = byHash[u.matchHash]
		}
		out = append(out, MatchedUserDTO{UserDTO: u.dto(uid, true, false, false, online), Matched: m})
	}
	return out, nil
}

// Friends: bạn bè (hai chiều accepted), sắp theo tên.
func (s *Service) Friends(ctx context.Context, uid int64) ([]UserDTO, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	ids, err := idList(ctx, p, `select f.friend_id from chat_friendships f join chat_users u on u.id = f.friend_id
		where f.user_id = $1 and f.status = 'accepted' order by lower(u.display_name), u.id`, uid)
	if err != nil {
		return nil, err
	}
	return s.orderedUsers(ctx, p, uid, ids, true, true)
}

// FriendRequests: lời mời tới tôi (incoming) và tôi đã gửi (outgoing), mới nhất trước.
func (s *Service) FriendRequests(ctx context.Context, uid int64) (incoming, outgoing []RequestUserDTO, err error) {
	p, err := s.pool()
	if err != nil {
		return nil, nil, err
	}
	load := func(sql string) ([]RequestUserDTO, error) {
		rows, err := p.Query(ctx, sql, uid)
		if err != nil {
			return nil, err
		}
		var ids []int64
		at := map[int64]string{}
		for rows.Next() {
			var id int64
			var t time.Time
			if err := rows.Scan(&id, &t); err != nil {
				rows.Close()
				return nil, err
			}
			ids = append(ids, id)
			at[id] = iso(t)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		us, err := s.orderedUsers(ctx, p, uid, ids, false, false)
		if err != nil {
			return nil, err
		}
		out := make([]RequestUserDTO, 0, len(us))
		for _, u := range us {
			out = append(out, RequestUserDTO{UserDTO: u, RequestedAt: at[u.ID]})
		}
		return out, nil
	}
	if incoming, err = load(`select user_id, created_at from chat_friendships where friend_id = $1 and status = 'pending' order by created_at desc, user_id`); err != nil {
		return nil, nil, err
	}
	if outgoing, err = load(`select friend_id, created_at from chat_friendships where user_id = $1 and status = 'pending' order by created_at desc, friend_id`); err != nil {
		return nil, nil, err
	}
	return incoming, outgoing, nil
}

// friendState: trạng thái hai chiều giữa me và other ("" = không có dòng).
func friendState(ctx context.Context, q querier, me, other int64) (mine, theirs string, err error) {
	err = q.QueryRow(ctx, `select
		coalesce((select status from chat_friendships where user_id = $1 and friend_id = $2), ''),
		coalesce((select status from chat_friendships where user_id = $2 and friend_id = $1), '')`, me, other).Scan(&mine, &theirs)
	return
}

func upsertFriend(ctx context.Context, tx pgx.Tx, from, to int64, status string) error {
	_, err := tx.Exec(ctx, `insert into chat_friendships (user_id, friend_id, status) values ($1, $2, $3)
		on conflict (user_id, friend_id) do update set status = excluded.status, updated_at = now()`, from, to, status)
	return err
}

// SendFriendRequest gửi lời mời tới other. Họ đã mời tôi trước -> thành bạn luôn ("accepted").
func (s *Service) SendFriendRequest(ctx context.Context, uid, other int64) (string, error) {
	if other <= 0 {
		return "", errBad("Thiếu user_id")
	}
	if other == uid {
		return "", errBad("Không thể kết bạn với chính mình")
	}
	if !s.friendLimit.allow(uid) {
		return "", errRateLimit
	}
	status := ""
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := xactLock(ctx, tx, pairKey(uid, other)); err != nil {
			return err
		}
		if ok, err := userExists(ctx, tx, other); err != nil || !ok {
			if err == nil {
				err = errNotFound("Không tìm thấy người dùng")
			}
			return err
		}
		mine, theirs, err := friendState(ctx, tx, uid, other)
		if err != nil {
			return err
		}
		switch {
		case theirs == "blocked":
			return errForbidden("Không thể gửi lời mời")
		case mine == "blocked":
			return errBlocked("Bạn đã chặn người này, bỏ chặn trước khi kết bạn")
		case mine == "accepted":
			status = "accepted"
			return nil
		case theirs == "pending":
			status = "accepted"
			if err := upsertFriend(ctx, tx, other, uid, "accepted"); err != nil {
				return err
			}
			return upsertFriend(ctx, tx, uid, other, "accepted")
		case mine == "pending":
			status = "pending"
			return nil
		}
		status = "pending"
		return upsertFriend(ctx, tx, uid, other, "pending")
	})
	return status, err
}

// AcceptFriendRequest: chấp nhận lời mời của other.
func (s *Service) AcceptFriendRequest(ctx context.Context, uid, other int64) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if err := xactLock(ctx, tx, pairKey(uid, other)); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `update chat_friendships set status = 'accepted', updated_at = now()
			where user_id = $1 and friend_id = $2 and status = 'pending'`, other, uid)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotFound("Không có lời mời kết bạn từ người này")
		}
		return upsertFriend(ctx, tx, uid, other, "accepted")
	})
}

// RejectFriendRequest: từ chối lời mời của other (không có thì thôi).
func (s *Service) RejectFriendRequest(ctx context.Context, uid, other int64) error {
	return s.exec(ctx, `delete from chat_friendships where user_id = $1 and friend_id = $2 and status = 'pending'`, other, uid)
}

// CancelFriendRequest: rút lời mời tôi đã gửi.
func (s *Service) CancelFriendRequest(ctx context.Context, uid, other int64) error {
	return s.exec(ctx, `delete from chat_friendships where user_id = $1 and friend_id = $2 and status = 'pending'`, uid, other)
}

// Unfriend: huỷ kết bạn (xoá cả hai chiều accepted; dòng chặn giữ nguyên). Không còn hội thoại chung nào cho phép
// -> thôi xem online của nhau.
func (s *Service) Unfriend(ctx context.Context, uid, other int64) error {
	if err := s.exec(ctx, `delete from chat_friendships where status = 'accepted'
		and ((user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1))`, uid, other); err != nil {
		return err
	}
	s.recheckPresence(ctx, uid, []int64{other})
	return nil
}

// Blocks: người tôi đã chặn, mới nhất trước.
func (s *Service) Blocks(ctx context.Context, uid int64) ([]UserDTO, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	ids, err := idList(ctx, p, `select friend_id from chat_friendships where user_id = $1 and status = 'blocked' order by updated_at desc, friend_id`, uid)
	if err != nil {
		return nil, err
	}
	return s.orderedUsers(ctx, p, uid, ids, false, false)
}

// Block: chặn other - bỏ quan hệ bạn bè / lời mời của họ với tôi (dòng họ chặn tôi thì giữ).
func (s *Service) Block(ctx context.Context, uid, other int64) error {
	if other <= 0 {
		return errBad("Thiếu user_id")
	}
	if other == uid {
		return errBad("Không thể tự chặn chính mình")
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := xactLock(ctx, tx, pairKey(uid, other)); err != nil {
			return err
		}
		if ok, err := userExists(ctx, tx, other); err != nil || !ok {
			if err == nil {
				err = errNotFound("Không tìm thấy người dùng")
			}
			return err
		}
		if err := upsertFriend(ctx, tx, uid, other, "blocked"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `delete from chat_friendships where user_id = $1 and friend_id = $2 and status <> 'blocked'`, other, uid)
		return err
	})
	if err != nil {
		return err
	}
	// đăng ký presence đang có của hai bên bị gỡ ngay (không đợi client đăng ký lại); chat 1-1 thôi chuyển typing / receipt
	s.revokePresence(uid, []int64{other})
	s.revokePresence(other, []int64{uid})
	s.forgetDirect(ctx, uid, other)
	return nil
}

// Unblock: bỏ chặn.
func (s *Service) Unblock(ctx context.Context, uid, other int64) error {
	if err := s.exec(ctx, `delete from chat_friendships where user_id = $1 and friend_id = $2 and status = 'blocked'`, uid, other); err != nil {
		return err
	}
	s.forgetDirect(ctx, uid, other)
	return nil
}

func (s *Service) exec(ctx context.Context, sql string, args ...any) error {
	p, err := s.pool()
	if err != nil {
		return err
	}
	_, err = p.Exec(ctx, sql, args...)
	return err
}
