package chat

import (
	"context"
	"errors"
	"hash/fnv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Truy cập PostgreSQL của chat: SQL thô trên pool pgx của database.DB (lý do: comment của package, service.go).

// querier: *pgxpool.Pool hoặc pgx.Tx.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (s *Service) pool() (*pgxpool.Pool, error) {
	if s.db == nil {
		return nil, errNoDB
	}
	return s.db.Pool()
}

// inTx chạy fn trong 1 transaction: fn trả nil -> commit, lỗi -> rollback. Lỗi nghiệp vụ cần GIỮ thay đổi
// (vd đếm số lần nhập sai OTP) thì fn ghi lỗi ra biến ngoài và trả nil.
func (s *Service) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	p, err := s.pool()
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, p, fn)
}

// xactLock: khoá advisory tới hết transaction theo một khoá chữ (cặp người dùng, số điện thoại...).
func xactLock(ctx context.Context, tx pgx.Tx, key string) error {
	h := fnv.New64a()
	h.Write([]byte("qspro-chat:" + key))
	_, err := tx.Exec(ctx, "select pg_advisory_xact_lock($1::bigint)", int64(h.Sum64()))
	return err
}

// isUnique: lỗi vi phạm unique (23505) của đúng ràng buộc constraint.
func isUnique(err error, constraint string) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505" && pe.ConstraintName == constraint
}

// isCheck: lỗi vi phạm ràng buộc check (23514) của đúng ràng buộc constraint.
func isCheck(err error, constraint string) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23514" && pe.ConstraintName == constraint
}

func noRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// ───────────── Người dùng nhìn từ phía tôi ─────────────

// userRow: 1 tài khoản + quan hệ hai chiều với người đang xem (mine = tôi -> họ, theirs = họ -> tôi; "" = không có).
type userRow struct {
	id         int64
	name       string
	phone      *string // null: tài khoản tạo bằng email
	email      *string // null: tài khoản tạo bằng số điện thoại
	showRead   bool
	lastSeen   *time.Time
	createdAt  time.Time
	mine       string
	theirs     string
	matchPhone string // chỉ dùng khi đồng bộ danh bạ
	matchHash  string
}

func (u *userRow) relation(me int64) string {
	switch {
	case u.id == me:
		return relSelf
	case u.mine == "blocked":
		return relBlocked
	case u.theirs == "blocked": // bị họ chặn: không cho biết
		return relNone
	case u.mine == "accepted":
		return relFriend
	case u.mine == "pending":
		return relOutgoing
	case u.theirs == "pending":
		return relIncoming
	}
	return relNone
}

// blockedEither: một trong hai bên đã chặn bên kia.
func (u *userRow) blockedEither() bool { return u.mine == "blocked" || u.theirs == "blocked" }

// dto: phone chỉ hiện với chính mình / bạn bè / khi showPhone (tra đúng số, đồng bộ danh bạ); email chỉ hiện với chính
// mình / bạn bè / khi showEmail (tra đúng email) - tra số không lộ email và ngược lại; showPhone / showEmail vô hiệu khi
// một bên đã chặn bên kia. online chỉ hiện khi showOnline (bạn bè, chung hội thoại) và không ai chặn ai.
func (u *userRow) dto(me int64, showPhone, showEmail, showOnline bool, online map[int64]bool) UserDTO {
	rel := u.relation(me)
	d := UserDTO{ID: u.id, DisplayName: u.name, Relation: rel}
	known := rel == relSelf || rel == relFriend
	if known || (showPhone && !u.blockedEither()) {
		d.Phone = u.phone
	}
	if known || (showEmail && !u.blockedEither()) {
		d.Email = u.email
	}
	if (rel == relSelf || rel == relFriend || showOnline) && !u.blockedEither() {
		d.Online = online[u.id]
	}
	return d
}

const userCols = `u.id, u.display_name, u.phone, u.email, u.show_read_receipts, u.last_seen_at, u.created_at,
  coalesce((select f.status from chat_friendships f where f.user_id = $1 and f.friend_id = u.id), ''),
  coalesce((select f.status from chat_friendships f where f.user_id = u.id and f.friend_id = $1), '')`

func scanUser(r pgx.Row, extra ...any) (*userRow, error) {
	u := &userRow{}
	dst := append([]any{&u.id, &u.name, &u.phone, &u.email, &u.showRead, &u.lastSeen, &u.createdAt, &u.mine, &u.theirs}, extra...)
	if err := r.Scan(dst...); err != nil {
		return nil, err
	}
	return u, nil
}

// loadUsers: các tài khoản ids (thiếu thì không có trong map) kèm quan hệ với me.
func loadUsers(ctx context.Context, q querier, me int64, ids []int64) (map[int64]*userRow, error) {
	out := map[int64]*userRow{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `select `+userCols+` from chat_users u where u.id = any($2::bigint[])`, me, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out[u.id] = u
	}
	return out, rows.Err()
}

func loadUser(ctx context.Context, q querier, me, id int64) (*userRow, error) {
	m, err := loadUsers(ctx, q, me, []int64{id})
	if err != nil {
		return nil, err
	}
	return m[id], nil
}

// orderedUsers: dto theo đúng thứ tự ids (bỏ id không còn); danh sách không bao giờ lộ email của người lạ.
func (s *Service) orderedUsers(ctx context.Context, q querier, me int64, ids []int64, showPhone, showOnline bool) ([]UserDTO, error) {
	m, err := loadUsers(ctx, q, me, ids)
	if err != nil {
		return nil, err
	}
	online := s.online(ids)
	out := make([]UserDTO, 0, len(ids))
	for _, id := range ids {
		if u := m[id]; u != nil {
			out = append(out, u.dto(me, showPhone, false, showOnline, online))
		}
	}
	return out, nil
}

// idList: cột bigint đầu của mọi dòng.
func idList(ctx context.Context, q querier, sql string, args ...any) ([]int64, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// displayNames: tên hiển thị của các tài khoản (cho tin hệ thống).
func displayNames(ctx context.Context, q querier, ids []int64) (map[int64]string, error) {
	rows, err := q.Query(ctx, `select id, display_name from chat_users where id = any($1::bigint[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var id int64
		var n string
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// areFriends: số người trong ids là bạn bè (hai chiều accepted) của me.
func countFriends(ctx context.Context, q querier, me int64, ids []int64) (int, error) {
	var n int
	err := q.QueryRow(ctx, `select count(*) from chat_friendships a
		join chat_friendships b on b.user_id = a.friend_id and b.friend_id = a.user_id and b.status = 'accepted'
		where a.user_id = $1 and a.status = 'accepted' and a.friend_id = any($2::bigint[])`, me, ids).Scan(&n)
	return n, err
}

// blockedBetween: a chặn b hoặc b chặn a.
func blockedBetween(ctx context.Context, q querier, a, b int64) (bool, error) {
	var x bool
	err := q.QueryRow(ctx, `select exists(select 1 from chat_friendships where status = 'blocked'
		and ((user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)))`, a, b).Scan(&x)
	return x, err
}
