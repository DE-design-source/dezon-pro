package auth

import (
	"context"
	"time"

	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Phiên đăng nhập lưu phía máy chủ (M1.2, bảng phien_dang_nhap = user_sessions, migration 0014).
// Mỗi lần đăng nhập = 1 dòng; token mang id dòng (khoá "sid"). Đăng xuất xoá dòng -> token đó hết hiệu lực ngay.
// Token cũ không có sid (phát trước khi có bảng phiên) bị từ chối: người dùng đăng nhập lại 1 lần.

// sessEntry: một mục của _sess (A:37), khoá = sid. u == nil là kết quả ÂM (tài khoản khoá / công ty khoá, hết hạn,
// phiên đã thu hồi) - cũng được giữ 30 giây. uid để ForgetSession xoá mọi phiên của một tài khoản.
type sessEntry struct {
	at  float64
	uid string
	u   *omap.Map // {r, ct, u} theo database
}

// phienErr: lỗi của bảng phiên. Thiếu bảng (chưa chạy 0014) -> SessionStoreError mang thông báo đích danh
// (middleware trả 500 kèm thông báo đó thay vì 401); lỗi khác giữ nguyên.
func phienErr(err error) error {
	if err == nil {
		return nil
	}
	if c := database.CodeOf(err); c == "PGRST205" || c == "42P01" {
		return &middleware.SessionStoreError{Msg: msgSessTable}
	}
	return err
}

func isoMs(ms float64) string { return jsval.ToISOString(time.UnixMilli(int64(ms))) }

// openSession: mở phiên cho dòng users u -> token mang sid. Dọn trước các phiên đã quá hạn của chính tài khoản
// này để bảng không phình mãi.
func (s *Service) openSession(ctx context.Context, u *omap.Map) (string, error) {
	now := s.now()
	if err := s.repo.RemoveExpiredSessions(ctx, u.Val("id"), isoMs(now)); err != nil {
		return "", phienErr(err)
	}
	sid, err := s.repo.InsertSession(ctx, u.Val("id"), isoMs(now+s.ttlMs))
	if err != nil {
		return "", phienErr(err)
	}
	return s.makeTokenSid(u, sid), nil
}

// revokeCache: bỏ mục cache của các phiên bị thu hồi và ghi nhớ chúng thêm 2 chu kỳ cache, để một request đang chạy
// song song (đã đọc database TRƯỚC khi xoá dòng) không ghi lại kết quả dương vào cache.
func (s *Service) revokeCache(match func(sid string, e sessEntry) bool, extra ...string) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for sid, at := range s.revoked {
		if now-at > 2*sessionCacheMs {
			delete(s.revoked, sid)
		}
	}
	for sid, e := range s.sess {
		if match(sid, e) {
			delete(s.sess, sid)
			s.revoked[sid] = now
		}
	}
	for _, sid := range extra {
		delete(s.sess, sid)
		s.revoked[sid] = now
	}
}

// closeSession: đăng xuất - xoá đúng phiên sid.
func (s *Service) closeSession(ctx context.Context, sid string) error {
	if sid == "" {
		return nil
	}
	s.revokeCache(func(string, sessEntry) bool { return false }, sid)
	return phienErr(s.repo.RemoveSession(ctx, sid))
}

// closeOtherSessions: thu hồi mọi phiên của uid trừ phiên keep (keep = "" -> tất cả). Bỏ cache 2 lần: trước khi xoá
// (các sid đang có trong cache) và sau khi xoá (đúng các sid database vừa xoá) - một request của phiên CHƯA có trong cache
// đã đọc "còn dòng" trước lệnh xoá cũng không ghi lại được kết quả dương.
func (s *Service) closeOtherSessions(ctx context.Context, uid any, keep string) error {
	key := jsval.ToString(uid)
	s.revokeCache(func(sid string, e sessEntry) bool { return e.uid == key && sid != keep })
	ids, err := s.repo.RemoveUserSessions(ctx, uid, keep)
	if err != nil {
		return phienErr(err)
	}
	s.revokeCache(func(string, sessEntry) bool { return false }, ids...)
	return nil
}

// RevokeUserSessions (contracts.SessionInvalidator): users gọi sau khi admin đặt lại mật khẩu - thu hồi mọi phiên của
// uid trừ keep (keep = phiên của chính admin khi tự đặt lại cho mình, ngược lại "").
func (s *Service) RevokeUserSessions(ctx context.Context, uid any, keep string) error {
	return s.closeOtherSessions(ctx, uid, keep)
}

// ForgetSession = forgetSession_ (A:39): bỏ cache của mọi phiên thuộc uid (khoá / đổi vai trò / đổi công ty / xoá
// tài khoản có hiệu lực ngay). KHÔNG xoá dòng phiên: khoá rồi mở lại thì phiên cũ dùng tiếp như bản Node.
func (s *Service) ForgetSession(uid any) {
	key := jsval.ToString(uid)
	s.mu.Lock()
	for sid, e := range s.sess {
		if e.uid == key {
			delete(s.sess, sid)
		}
	}
	s.mu.Unlock()
}

// sweepCache: khoá cache là sid (mỗi lần đăng nhập 1 khoá mới) nên phải dọn mục đã hết 30 giây, không thì bộ nhớ tăng
// theo số lần đăng nhập. Chạy tối đa 1 lần / chu kỳ cache; gọi khi đang giữ s.mu.
func (s *Service) sweepCache(now float64) {
	if now-s.sweptAt < sessionCacheMs {
		return
	}
	s.sweptAt = now
	for sid, e := range s.sess {
		if now-e.at >= sessionCacheMs {
			delete(s.sess, sid)
		}
	}
	for sid, at := range s.revoked {
		if now-at > 2*sessionCacheMs {
			delete(s.revoked, sid)
		}
	}
}

// overlay = Object.assign({}, p, u): payload của token đè r / ct / u đang có trong database.
func overlay(p, u *omap.Map) *actor.Actor {
	return actor.FromMap(omap.Assign(p.Clone(), u))
}

// SessionActor = sessionActor (A:43-56) + kiểm phiên (M1.2). Token sống 7 ngày nên khoá / đổi vai trò / đổi công ty
// phải có hiệu lực ngay: đối chiếu database, giữ kết quả 30 giây. Thứ tự: tài khoản -> công ty -> phiên còn dòng.
// Không khoá trong lúc truy vấn (Node cũng cho các request đan xen).
func (s *Service) SessionActor(ctx context.Context, token string) (*actor.Actor, error) {
	p := s.VerifyToken(token)
	if p == nil {
		return nil, nil
	}
	sid := jsval.AsString(p.Val("sid"))
	if !reSid.MatchString(sid) { // token cũ không có phiên (hoặc sid hỏng): đăng nhập lại
		return nil, nil
	}
	s.mu.Lock()
	hit, ok := s.sess[sid]
	s.mu.Unlock()
	if ok && s.now()-hit.at < sessionCacheMs && hit.uid == jsval.ToString(p.Val("uid")) {
		if hit.u == nil {
			return nil, nil
		}
		return overlay(p, hit.u), nil
	}
	rows, err := s.repo.SessionUser(ctx, p.Val("uid"))
	if err != nil {
		return nil, err
	}
	var u *omap.Map
	if len(rows) > 0 && !jsval.StrictEquals(rows[0].Val("active"), false) {
		u = omap.Of("r", rows[0].Val("role"), "ct", jsval.Or(rows[0].Val("cong_ty_id"), nil), "u", rows[0].Val("username"))
	}
	if u != nil && !jsval.StrictEquals(u.Val("r"), "super") {
		var ct *omap.Map
		if jsval.Truthy(u.Val("ct")) {
			if ct, err = s.companies.GetCongTy(ctx, u.Val("ct")); err != nil {
				return nil, err
			}
		}
		if ct == nil || !jsval.Truthy(ct.Val("active")) || s.companies.HetHan(ct) {
			u = nil
		}
	}
	if u != nil {
		alive, err := s.repo.SessionAlive(ctx, sid, p.Val("uid"), isoMs(s.now()))
		if err != nil {
			return nil, phienErr(err)
		}
		if !alive { // đã đăng xuất / bị thu hồi / quá hạn
			u = nil
		}
	}
	s.mu.Lock()
	if _, gone := s.revoked[sid]; gone { // vừa bị thu hồi trong lúc đang đọc database
		u = nil
	}
	now := s.now()
	s.sweepCache(now)
	s.sess[sid] = sessEntry{at: now, uid: jsval.ToString(p.Val("uid")), u: u}
	s.mu.Unlock()
	if u == nil {
		return nil, nil
	}
	return overlay(p, u), nil
}
