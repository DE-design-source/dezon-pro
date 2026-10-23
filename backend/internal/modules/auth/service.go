// Package auth: đăng nhập, phiên (token HMAC tự ký mang id phiên + bảng user_sessions), cài đặt giao diện theo
// tài khoản - chuyển từ server/auth.js. Từ M1.2 token phải có id phiên còn dòng trong user_sessions: token cũ của
// Node / Go trước 0014 (không có sid) bị từ chối.
package auth

import (
	"context"
	"sort"
	"strings"
	"sync"
	"unicode/utf16"

	"qspro-backend/internal/config"
	"qspro-backend/internal/middleware"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Deps: do internal/server/routes.go truyền vào (ARCHITECTURE 11.2).
type Deps struct {
	DB            *database.DB
	Cfg           *config.Config
	Users         contracts.UserReader    // getUserById
	UserFormatter contracts.UserFormatter // userOut
	Auditor       contracts.Auditor       // audit
	Companies     contracts.CompanyReader // getCongTy, hetHan_
}

// Service: nghiệp vụ đăng nhập / phiên.
type Service struct {
	repo      Repository
	secret    string
	users     contracts.UserReader
	fmt       contracts.UserFormatter
	auditor   contracts.Auditor
	companies contracts.CompanyReader
	now       func() float64 // Date.now() - thay được trong test

	mu      sync.Mutex
	sess    map[string]sessEntry // _sess (A:37), khoá = sid
	revoked map[string]float64   // sid vừa thu hồi -> lúc thu hồi (xem revokeCache)
	sweptAt float64              // lần dọn cache gần nhất (sweepCache)
}

var (
	_ contracts.SessionInvalidator = (*Service)(nil)
	_ middleware.SessionResolver   = (*Service)(nil)
)

// New tạo service. Thiếu Cfg -> khoá ký mặc định của môi trường dev (A:14).
func New(d Deps) *Service {
	secret := config.DefaultAuthSecret
	if d.Cfg != nil && d.Cfg.AuthSecret != "" {
		secret = d.Cfg.AuthSecret
	}
	return &Service{repo: NewRepository(d.DB), secret: secret, users: d.Users, fmt: d.UserFormatter,
		auditor: d.Auditor, companies: d.Companies, now: jsval.NowMs, sess: map[string]sessEntry{}, revoked: map[string]float64{}}
}

// getUsersByName = getUsersByName_ (A:78-91): đăng nhập bằng TÊN ĐĂNG NHẬP hoặc EMAIL, trả mọi dòng trùng.
func (s *Service) getUsersByName(ctx context.Context, username string) ([]*omap.Map, error) {
	key := jsval.Trim(username)
	if key == "" {
		return nil, nil
	}
	rows, err := s.repo.UsersByUsername(ctx, toLowerCase(key))
	if err != nil {
		return nil, err
	}
	if len(rows) > 0 {
		return rows, nil
	}
	// Chặn ký tự đại diện: "%@%" từng khớp mọi tài khoản
	if strings.Index(key, "@") > 0 && !reWildcard.MatchString(key) {
		if rows, err = s.repo.UsersByEmail(ctx, strings.ReplaceAll(key, "_", `\_`)); err != nil {
			rows = nil // Node nuốt lỗi của lần tìm theo email
		}
	}
	return rows, nil
}

// loginScore: ưu tiên tài khoản đang mở khoá và đã thuộc một công ty (A:229).
func loginScore(r *omap.Map) int {
	n := 2
	if jsval.StrictEquals(r.Val("active"), false) {
		n = 0
	}
	if jsval.Truthy(r.Val("cong_ty_id")) {
		n++
	}
	return n
}

// sortCandidates: rows.sort((a, b) => sb - sa) - sort của JS ổn định.
func sortCandidates(rows []*omap.Map) {
	sort.SliceStable(rows, func(i, j int) bool { return loginScore(rows[i]) > loginScore(rows[j]) })
}

// pwOk = pwOk_ (A:218-222): bcrypt, hoặc so thẳng với mật khẩu chữ thường (nhập tay vào database).
func pwOk(row *omap.Map, password string) (ok, isBcrypt bool, err error) {
	stored := jsval.StrOr(row.Val("password_hash"), "")
	if reBcrypt.MatchString(stored) {
		ok, err = compareSync(password, stored)
		return ok, true, err
	}
	return password != "" && password == stored, false, nil
}

// prefsOf = prefsOf_ (A:268): ui_prefs là object (không phải mảng) -> chính nó, ngược lại {}.
func prefsOf(u *omap.Map) *omap.Map {
	if p, ok := u.Val("ui_prefs").(*omap.Map); ok && p != nil {
		return p
	}
	return omap.New()
}

func orNull(m *omap.Map) any {
	if m == nil {
		return nil
	}
	return m
}

// Login = login (A:223-256).
func (s *Service) Login(ctx context.Context, username, password any) (*omap.Map, error) {
	name := jsval.Trim(jsval.StrOr(username, ""))
	pw := jsval.StrOr(password, "")
	rows, err := s.getUsersByName(ctx, name)
	if err != nil {
		return nil, err
	}
	sortCandidates(rows)
	var u *omap.Map
	isBcrypt := false
	for _, r := range rows {
		ok, bc, err := pwOk(r, pw)
		if err != nil {
			return nil, err
		}
		if ok {
			u, isBcrypt = r, bc
			break
		}
	}
	if u == nil {
		var ctID any
		if len(rows) > 0 {
			ctID = rows[0].Val("cong_ty_id")
		}
		s.auditor.Audit(ctx, &actor.Actor{U: name}, "login_fail", msgLoginFail, ctID)
		return nil, apperr.New(msgLoginFail)
	}
	if jsval.StrictEquals(u.Val("active"), false) {
		return nil, apperr.New(msgLocked)
	}
	patch := omap.Of("last_login", jsval.NowISO())
	// Tự nâng cấp mật khẩu chữ thường -> băm bcrypt
	if !isBcrypt {
		hash, err := hashSync(pw)
		if err != nil {
			return nil, err
		}
		patch.Set("password_hash", hash)
	}
	// Công ty bị khoá hoặc hết hạn thì không cho vào (super miễn trừ)
	var ct *omap.Map
	if !jsval.StrictEquals(u.Val("role"), "super") {
		if ct, err = s.companies.GetCongTy(ctx, u.Val("cong_ty_id")); err != nil {
			return nil, err
		}
		if ct == nil {
			return nil, apperr.New(msgNoCompany)
		}
		if !jsval.Truthy(ct.Val("active")) {
			return nil, apperr.New(`Công ty "` + jsval.ToString(ct.Val("ten")) + `" đang bị tạm khoá`)
		}
		if s.companies.HetHan(ct) {
			return nil, apperr.New(`Gói dịch vụ của "` + jsval.ToString(ct.Val("ten")) + `" đã hết hạn ngày ` + jsval.ToString(ct.Val("hanDung")))
		}
	} else if jsval.Truthy(u.Val("cong_ty_id")) {
		if ct, err = s.companies.GetCongTy(ctx, u.Val("cong_ty_id")); err != nil {
			return nil, err
		}
	}
	// Mở phiên TRƯỚC khi ghi last_login / nhật ký: thiếu bảng phiên thì đăng nhập báo lỗi đích danh, không ghi gì
	token, err := s.openSession(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateUser(ctx, u.Val("id"), patch); err != nil {
		return nil, err
	}
	detail := "Đăng nhập"
	if !isBcrypt {
		detail += " (tự băm mật khẩu)"
	}
	s.auditor.Audit(ctx, &actor.Actor{UID: u.Val("id"), U: jsval.StrOr(u.Val("username"), "")}, "login", detail, u.Val("cong_ty_id"))
	user := omap.Assign(s.fmt.UserOut(u), omap.Of("uiPrefs", prefsOf(u)))
	return omap.Of("token", token, "user", user, "congTy", orNull(ct)), nil
}

// Me = me (A:257-264).
func (s *Service) Me(ctx context.Context, a *actor.Actor) (*omap.Map, error) {
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	if u == nil || jsval.StrictEquals(u.Val("active"), false) {
		return nil, apperr.New(msgBadSession)
	}
	out := s.fmt.UserOut(u)
	out.Set("uiPrefs", prefsOf(u))
	ct, err := s.companies.GetCongTy(ctx, u.Val("cong_ty_id"))
	if err != nil {
		return nil, err
	}
	out.Set("congTy", orNull(ct))
	return out, nil
}

// colsOK: Array.isArray(v) && v.length <= 60 && mọi phần tử là chuỗi ngắn hơn 40 (đơn vị UTF-16).
func colsOK(v any) bool {
	arr, ok := v.([]any)
	if !ok || len(arr) > 60 {
		return false
	}
	for _, x := range arr {
		str, ok := x.(string)
		if !ok || jsval.Len16(str) >= 40 {
			return false
		}
	}
	return true
}

// presetsOK: tối đa 20 bộ, mỗi bộ {name: chuỗi 1-39 ký tự, cols: như colsOK}.
func presetsOK(v any) bool {
	arr, ok := v.([]any)
	if !ok || len(arr) > 20 {
		return false
	}
	for _, x := range arr {
		m, ok := x.(*omap.Map)
		if !ok {
			return false
		}
		name, ok := m.Val("name").(string)
		if !ok || name == "" || jsval.Len16(name) >= 40 || !colsOK(m.Val("cols")) {
			return false
		}
	}
	return true
}

// idsOK: tkOrder - tối đa 60 id, mỗi id là chuỗi 1-59 ký tự.
func idsOK(v any) bool {
	arr, ok := v.([]any)
	if !ok || len(arr) > 60 {
		return false
	}
	for _, x := range arr {
		str, ok := x.(string)
		if !ok || str == "" || jsval.Len16(str) >= 60 {
			return false
		}
	}
	return true
}

// biaMauOK: bgBiaMau - tối đa 10 mẫu, mỗi mẫu {id: chuỗi 1-39, ten: chuỗi 1-39, cfg: object}.
func biaMauOK(v any) bool {
	arr, ok := v.([]any)
	if !ok || len(arr) > 10 {
		return false
	}
	for _, x := range arr {
		m, ok := x.(*omap.Map)
		if !ok {
			return false
		}
		id, ok1 := m.Val("id").(string)
		ten, ok2 := m.Val("ten").(string)
		_, ok3 := m.Val("cfg").(*omap.Map)
		if !ok1 || !ok2 || !ok3 || id == "" || ten == "" || jsval.Len16(id) >= 40 || jsval.Len16(ten) >= 40 {
			return false
		}
	}
	return true
}

// SetMyPref = setMyPref (A:271-287). value null / thiếu -> xoá khoá đó.
func (s *Service) SetMyPref(ctx context.Context, a *actor.Actor, key, value any) (*omap.Map, error) {
	k, isStr := key.(string)
	valid := false
	for _, pk := range prefKeys {
		valid = valid || (isStr && pk == k)
	}
	if !valid {
		return nil, apperr.New(msgPrefKey)
	}
	if !jsval.IsNullish(value) && strings.HasSuffix(k, "Cols") && !colsOK(value) {
		return nil, apperr.New(msgPrefCols)
	}
	if !jsval.IsNullish(value) && k == "tkPresets" && !presetsOK(value) {
		return nil, apperr.New(msgPrefCols)
	}
	if str, ok := value.(string); !jsval.IsNullish(value) && k == "tkQuick" && (!ok || str == "" || jsval.Len16(str) >= 60) {
		return nil, apperr.New(msgPrefCols)
	}
	if !jsval.IsNullish(value) && k == "tkOrder" && !idsOK(value) {
		return nil, apperr.New(msgPrefCols)
	}
	if !jsval.IsNullish(value) && k == "bgBiaMau" && !biaMauOK(value) {
		return nil, apperr.New(msgPrefCols)
	}
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, apperr.New(msgBadSession)
	}
	prefs := prefsOf(u).Clone()
	if jsval.IsNullish(value) {
		prefs.Delete(k)
	} else {
		prefs.Set(k, value)
	}
	if err := s.repo.UpdateUser(ctx, u.Val("id"), omap.Of("ui_prefs", prefs)); err != nil {
		if m := err.Error(); strings.Contains(m, "ui_prefs") && reColErr.MatchString(m) {
			return nil, apperr.New(msgPrefsCol)
		}
		return nil, err
	}
	return omap.Of("ok", true, "uiPrefs", prefs), nil
}

// Logout = logout (A:288) + thu hồi phiên của token đang dùng (M1.2): token đó bị từ chối ngay ở request kế tiếp;
// phiên ở máy / trình duyệt khác của cùng tài khoản vẫn chạy.
func (s *Service) Logout(ctx context.Context, a *actor.Actor) (*omap.Map, error) {
	if a != nil {
		if err := s.closeSession(ctx, a.SID); err != nil {
			return nil, err
		}
	}
	s.auditor.Audit(ctx, a, "logout", "Đăng xuất", nil)
	return omap.Of("ok", true), nil
}

// ChangePassword = changePassword (A:289-296). Chỉ so bằng bcrypt: tài khoản còn mật khẩu chữ thường không tự đổi được.
// Đổi xong thu hồi mọi phiên KHÁC của tài khoản (M1.2); phiên đang dùng giữ nguyên.
func (s *Service) ChangePassword(ctx context.Context, a *actor.Actor, oldPw, newPw any) (*omap.Map, error) {
	u, err := s.users.GetByID(ctx, a.UID)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, apperr.New(msgOldPw)
	}
	ok, err := compareSync(jsval.StrOr(oldPw, ""), jsval.AsString(jsval.Or(u.Val("password_hash"), "")))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, apperr.New(msgOldPw)
	}
	if jsval.Len16(jsval.StrOr(newPw, "")) < 4 {
		return nil, apperr.New(msgNewPwMin)
	}
	hash, err := hashSync(jsval.ToString(newPw))
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateUser(ctx, u.Val("id"), omap.Of("password_hash", hash)); err != nil {
		return nil, err
	}
	// actor không có SID chỉ gặp ở lời gọi nội bộ / test (SessionActor từ chối token không có phiên): không thu hồi
	if a.SID != "" {
		if err := s.closeOtherSessions(ctx, u.Val("id"), a.SID); err != nil {
			return nil, err
		}
	}
	s.auditor.Audit(ctx, a, "change_password", "Tự đổi mật khẩu", nil)
	return omap.Of("ok", true), nil
}

// LogClientError = logClientError (A:436-443): lỗi JS phía trình duyệt, ghi vào nhật ký để thấy được lỗi vặt.
func (s *Service) LogClientError(ctx context.Context, a *actor.Actor, info any) (*omap.Map, error) {
	tab, cut1 := sliceCut(jsval.StrOr(jsval.Get(info, "tab"), ""), 20)
	parts := []string{"[" + tab + "]"}
	msg, cut2 := sliceCut(jsval.StrOr(jsval.Get(info, "msg"), ""), 300)
	if msg != "" {
		parts = append(parts, msg)
	}
	cut3 := false
	if src := jsval.Get(info, "src"); jsval.Truthy(src) {
		var sl string
		sl, cut3 = sliceCut(reSrcHost.ReplaceAllString(jsval.ToString(src), ""), 120)
		parts = append(parts, "@ "+sl)
	}
	d := strings.Join(parts, " ")
	who := "?"
	if a != nil && a.U != "" {
		who = a.U
	}
	logger.Error("lỗi giao diện", who, d)
	// slice cắt đôi một emoji: bên Node nửa surrogate lẻ làm Postgres từ chối dòng (22P02), audit nuốt lỗi
	// -> không có dòng nhật ký. Chuỗi Go không giữ được nửa ấy (thành U+FFFD) nên phải tự bỏ lần ghi.
	if !cut1 && !cut2 && !cut3 {
		s.auditor.Audit(ctx, a, "loi_giao_dien", d, nil)
	}
	return omap.Of("ok", true), nil
}

// sliceCut = s.slice(0, n); cut = true khi đơn vị UTF-16 cuối cùng giữ lại là nửa đầu của một cặp surrogate.
func sliceCut(s string, n int) (out string, cut bool) {
	out = jsval.Slice(s, 0, n)
	if u := utf16.Encode([]rune(s)); len(u) > n && utf16.IsSurrogate(rune(u[n-1])) && u[n-1] < 0xDC00 {
		cut = true
	}
	return out, cut
}
