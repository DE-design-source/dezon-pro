package chat

import (
	"context"
	"errors"
	"hash/fnv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
)

// Đăng nhập chat bằng tài khoản Dezon Pro (0045_chat_users_dezon_link.sql, CHAT.md 6.7): phiên QS đã đăng nhập đổi
// lấy cặp token chat, không cần OTP. Mỗi tài khoản Dezon Pro (users.id) gắn đúng một tài khoản chat (chat_users.qs_user_id).

// CodeChatNoPerm: nhân viên chưa được quản trị viên cấp quyền "chat".
const CodeChatNoPerm = "CHAT_NO_PERM"

// PermChat: khoá quyền trong users.perms mở trang Chat cho nhân viên (admin / super luôn được).
const PermChat = "chat"

var (
	errChatNoPerm  = apperr.E(403, "Tài khoản chưa được cấp quyền Chat. Nhờ quản trị viên cấp quyền.", CodeChatNoPerm)
	errDezonNoAuth = apperr.E(401, middleware.MsgNoAuth, middleware.CodeNoAuth)
	errNoUsers     = errors.New("chat: chưa nối Deps.Users / Deps.UserFmt (internal/server/routes.go)")
)

// DezonInput: thân POST /chat/auth/dezon (thiết bị như otp/verify).
type DezonInput struct {
	Device struct {
		Platform string `json:"platform"`
		Name     string `json:"name"`
	} `json:"device"`
	// Do handler điền: IP của request, header User-Agent -> chat_devices.last_ip / user_agent.
	ClientIP  string `json:"-"`
	UserAgent string `json:"-"`
}

// dezonKey: khoá limiter của một tài khoản Dezon Pro (uuid -> int64).
func dezonKey(qsID string) int64 {
	h := fnv.New64a()
	h.Write([]byte(qsID))
	return int64(h.Sum64())
}

// dezonName: tên hiển thị chat lấy từ Dezon Pro - họ tên, trống thì username; tối đa 100 ký tự, không rỗng.
func dezonName(fullName, username string) string {
	for _, n := range []string{fullName, username} {
		if v, ok := cleanText(truncRunes(strings.TrimSpace(strings.ReplaceAll(n, "\x00", "")), 100), 100); ok {
			return v
		}
	}
	return "Người dùng"
}

// dezonAllowed: admin / super luôn được; nhân viên cần quyền "chat" trong users.perms.
func dezonAllowed(role string, perms []any) bool {
	if role == "admin" || role == "super" {
		return true
	}
	for _, p := range perms {
		if p == PermChat {
			return true
		}
	}
	return false
}

// DezonLogin: người đã đăng nhập Dezon Pro (a) lấy phiên chat. Tìm tài khoản chat gắn với users.id, chưa có thì tạo (tên =
// họ tên Dezon Pro) và kết bạn sẵn với mọi đồng nghiệp cùng công ty đã có tài khoản chat; có rồi thì cập nhật tên theo
// Dezon Pro, và nếu đã chuyển công ty (0046) thì làm lại kết bạn đồng nghiệp (dezonMoveTx).
// KHÔNG tự gắn tài khoản OTP cũ trùng email (email Dezon Pro không được xác minh -> chiếm tài khoản người khác).
func (s *Service) DezonLogin(ctx context.Context, a *actor.Actor, in DezonInput) (*AuthResult, error) {
	if a == nil {
		return nil, errDezonNoAuth
	}
	platform := strings.TrimSpace(in.Device.Platform)
	if platform == "" {
		platform = "web"
	}
	if !platforms[platform] {
		return nil, errBad("device.platform phải là ios, android, web hoặc desktop")
	}
	devName := truncRunes(strings.ReplaceAll(strings.TrimSpace(in.Device.Name), "\x00", ""), 200)
	ua, ip := devCleanUA(in.UserAgent, maxUserAgent), devCleanIP(in.ClientIP)
	if s.users == nil || s.userFmt == nil {
		return nil, errNoUsers
	}
	row, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	if row == nil || row.Val("active") == false {
		return nil, errDezonNoAuth
	}
	qsID := jsval.AsString(row.Val("id"))
	if qsID == "" {
		return nil, errDezonNoAuth
	}
	if !dezonAllowed(jsval.AsString(row.Val("role")), s.userFmt.PermsArr(row.Val("perms"))) {
		return nil, errChatNoPerm
	}
	if !s.dezonLimit.allow(dezonKey(qsID)) {
		return nil, errRateLimit
	}
	name := dezonName(jsval.AsString(row.Val("ho_ten")), jsval.AsString(row.Val("username")))
	company := jsval.AsString(row.Val("cong_ty_id"))
	var raw string
	var uid, did int64
	var isNew bool
	var me *MeDTO
	var unfriended []int64
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if err := xactLock(ctx, tx, "qs:"+qsID); err != nil {
			return err
		}
		var oldCo string
		err := tx.QueryRow(ctx, `select id, coalesce(qs_company_id::text, '') from chat_users where qs_user_id = $1::uuid`,
			qsID).Scan(&uid, &oldCo)
		switch {
		case err == nil:
			if _, err := tx.Exec(ctx, `update chat_users set display_name = $2, updated_at = now()
				where id = $1 and display_name <> $2`, uid, name); err != nil {
				return err
			}
			if oldCo != company {
				if unfriended, err = s.dezonMoveTx(ctx, tx, uid, oldCo, company); err != nil {
					return err
				}
			}
		case noRows(err):
			isNew = true
			if err := s.dezonCreateTx(ctx, tx, qsID, company, name, &uid); err != nil {
				return err
			}
		default:
			return err
		}
		if did, raw, err = s.devCreateTx(ctx, tx, uid, platform, devName, ua, ip, LoginDezon); err != nil {
			return err
		}
		me, err = s.loadMe(ctx, tx, uid)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.recheckPresence(ctx, uid, unfriended)
	res := s.authResult(uid, did, raw, me)
	res.IsNew = &isNew
	s.devNotify(uid, "login", did)
	return res, nil
}

// dezonCreateTx: tạo tài khoản chat gắn qsID + kết bạn (accepted hai chiều) với tài khoản chat của mọi người đang hoạt
// động cùng công ty. Khoá theo công ty để hai đồng nghiệp tạo cùng lúc vẫn thấy nhau (thứ tự khoá luôn qs: -> qsco:).
// Chỉ chạy lúc tạo (và khi đổi công ty - dezonMoveTx): ai đã huỷ kết bạn với đồng nghiệp thì lần đăng nhập sau không bị kết bạn lại.
func (s *Service) dezonCreateTx(ctx context.Context, tx pgx.Tx, qsID, company, name string, uid *int64) error {
	if company != "" {
		if err := xactLock(ctx, tx, "qsco:"+company); err != nil {
			return err
		}
	}
	if err := tx.QueryRow(ctx, `insert into chat_users (qs_user_id, qs_company_id, display_name)
		values ($1::uuid, nullif($2, '')::uuid, $3) returning id`, qsID, company, name).Scan(uid); err != nil {
		return err
	}
	return dezonFriendMatesTx(ctx, tx, *uid, company)
}

// dezonMoveTx: tài khoản chat uid đã gắn Dezon Pro, công ty Dezon Pro đổi oldCo -> company ("" = không công ty). Bỏ kết bạn
// (chỉ dòng accepted) với tài khoản gắn Dezon Pro đang thuộc công ty cũ, kết bạn với đồng nghiệp công ty mới, ghi công ty
// mới. Không đụng tài khoản OTP / QR, dòng blocked / pending, bạn ở công ty thứ ba. Trả id những người vừa bỏ kết bạn.
func (s *Service) dezonMoveTx(ctx context.Context, tx pgx.Tx, uid int64, oldCo, company string) ([]int64, error) {
	if company != "" {
		if err := xactLock(ctx, tx, "qsco:"+company); err != nil {
			return nil, err
		}
	}
	var gone []int64
	if oldCo != "" {
		var err error
		gone, err = idList(ctx, tx, `with old as (
				select c.id from chat_users c join users u on u.id = c.qs_user_id
				where u.company_id = $2::uuid and c.id <> $1
			), del as (
				delete from chat_friendships f where f.status = 'accepted'
				and ((f.user_id = $1 and f.friend_id in (select id from old)) or (f.friend_id = $1 and f.user_id in (select id from old)))
				returning case when f.user_id = $1 then f.friend_id else f.user_id end as id
			)
			select distinct id from del order by id`, uid, oldCo)
		if err != nil {
			return nil, err
		}
	}
	if err := dezonFriendMatesTx(ctx, tx, uid, company); err != nil {
		return nil, err
	}
	_, err := tx.Exec(ctx, `update chat_users set qs_company_id = nullif($2, '')::uuid, updated_at = now() where id = $1`, uid, company)
	return gone, err
}

// dezonFriendMatesTx: kết bạn (accepted hai chiều) uid với tài khoản chat gắn Dezon Pro của mọi người đang hoạt động trong
// company. Bỏ qua người đã có dòng quan hệ bất kỳ với uid (blocked / pending / accepted, chiều nào cũng vậy). Người gọi giữ
// khoá qsco:company.
func dezonFriendMatesTx(ctx context.Context, tx pgx.Tx, uid int64, company string) error {
	if company == "" {
		return nil // super / tài khoản không thuộc công ty: không có đồng nghiệp
	}
	_, err := tx.Exec(ctx, `with mates as (
			select c.id from chat_users c join users u on u.id = c.qs_user_id
			where u.company_id = $2::uuid and u.is_active and c.id <> $1
			and not exists (select 1 from chat_friendships x
				where (x.user_id = $1 and x.friend_id = c.id) or (x.user_id = c.id and x.friend_id = $1))
		)
		insert into chat_friendships (user_id, friend_id, status)
		select $1, id, 'accepted' from mates
		union all
		select id, $1, 'accepted' from mates
		on conflict (user_id, friend_id) do nothing`, uid, company)
	return err
}

// dezonRefreshOK: tài khoản chat uid còn được xoay refresh token? Tài khoản OTP / QR (qs_user_id null) luôn được; tài khoản
// gắn Dezon Pro cần dòng users còn, đang hoạt động và dezonAllowed (như DezonLogin).
func (s *Service) dezonRefreshOK(ctx context.Context, tx pgx.Tx, uid int64) (bool, error) {
	var linked bool
	var role, perms *string
	var active *bool
	err := tx.QueryRow(ctx, `select c.qs_user_id is not null, u.role, coalesce(u.permissions, ''), u.is_active
		from chat_users c left join users u on u.id = c.qs_user_id where c.id = $1`, uid).Scan(&linked, &role, &perms, &active)
	if noRows(err) {
		return false, nil
	}
	if err != nil || !linked {
		return err == nil, err
	}
	if role == nil || active == nil || !*active {
		return false, nil
	}
	if s.userFmt == nil {
		return false, errNoUsers
	}
	return dezonAllowed(*role, s.userFmt.PermsArr(*perms)), nil
}

// dezonLimitPer: đổi phiên Dezon Pro lấy phiên chat - 30 lần / 10 phút / tài khoản Dezon Pro (mỗi lần tạo 1 thiết bị).
const dezonLimitPer = 10 * time.Minute
