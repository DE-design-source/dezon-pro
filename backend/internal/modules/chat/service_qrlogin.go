package chat

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Đăng nhập web / desktop bằng mã QR (CHAT.md mục 11 bước 3, API.md "Đăng nhập bằng QR", bảng chat_qr_login_sessions):
// máy mới tạo phiên (start) và poll bằng poll_token bí mật; máy đã đăng nhập quét / gõ mã (scan), xem thông tin máy mới rồi
// duyệt (approve) / từ chối (reject); máy mới nhận token ĐÚNG MỘT LẦN ở lần poll đầu tiên thấy approved (phiên -> consumed).
// Mọi mốc thời gian theo now() của PostgreSQL (như OTP).

// qrAlphabet: Crockford base32 (bỏ I L O U), 32 ký tự -> mỗi ký tự 5 bit.
const qrAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// qrNewCode: mã qrCodeLen ký tự Crockford base32 ngẫu nhiên (crypto/rand, 50 bit).
func qrNewCode() (string, error) {
	b := make([]byte, qrCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = qrAlphabet[b[i]&31]
	}
	return string(b), nil
}

// qrNormalizeCode: mã người dùng quét / gõ -> dạng chuẩn (viết hoa, không gạch). Nhận cả URL <origin>/chat/qr#<code>, chữ
// thường, gạch nối, khoảng trắng, O -> 0, I / L -> 1. Sai dạng -> ok = false.
func qrNormalizeCode(raw string) (string, bool) {
	if i := strings.LastIndexByte(raw, '#'); i >= 0 {
		raw = raw[i+1:]
	}
	if len(raw) > 200 {
		return "", false
	}
	var b strings.Builder
	for _, r := range strings.ToUpper(raw) {
		switch {
		case r == '-' || r == ' ' || r == '\t' || r == '\n' || r == '\r':
			continue
		case r == 'O':
			r = '0'
		case r == 'I' || r == 'L':
			r = '1'
		}
		if r > 127 || !strings.ContainsRune(qrAlphabet, r) {
			return "", false
		}
		b.WriteRune(r)
	}
	code := b.String()
	if len(code) != qrCodeLen {
		return "", false
	}
	return code, true
}

// qrCodeHash: HMAC-SHA256(khoá máy chủ, "qr:" + mã chuẩn) dạng hex (cột code_hash).
func (s *Service) qrCodeHash(code string) string { return hmacHex(s.otpKey, "qr:"+code) }

// QRStart: máy mới (chưa đăng nhập) tạo phiên QR. ip / userAgent lấy từ request (handler).
func (s *Service) QRStart(ctx context.Context, in QRStartInput, ip, userAgent string) (*QRStartResult, error) {
	platform := strings.TrimSpace(in.Device.Platform)
	if platform == "" {
		platform = "web"
	}
	if !platforms[platform] {
		return nil, errBad("device.platform phải là ios, android, web hoặc desktop")
	}
	name := devCleanUA(in.Device.Name, 200)
	ua := devCleanUA(userAgent, maxUserAgent)
	ip = devCleanIP(ip)
	poll, pollHash, err := newRefreshToken()
	if err != nil {
		return nil, err
	}
	for try := 0; ; try++ {
		code, err := qrNewCode()
		if err != nil {
			return nil, err
		}
		var id int64
		var limited bool
		err = s.inTx(ctx, func(tx pgx.Tx) error {
			if ip != "" { // đếm tuần tự theo IP: các request song song không cùng đọc "chưa tới 20"
				if err := xactLock(ctx, tx, "qrip:"+ip); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(ctx, `delete from chat_qr_login_sessions where created_at < now() - interval '24 hours'`); err != nil {
				return err
			}
			if ip != "" {
				var n int
				if err := tx.QueryRow(ctx, `select count(*) from chat_qr_login_sessions
					where request_ip = $1 and created_at > now() - $2::interval`, ip, secs(qrStartWindow)).Scan(&n); err != nil {
					return err
				}
				if n >= qrStartPerIP {
					limited = true
					return nil
				}
			}
			return tx.QueryRow(ctx, `insert into chat_qr_login_sessions (code_hash, poll_token_hash, platform, device_name, user_agent,
				request_ip, expires_at) values ($1, $2, $3, $4, $5, $6, now() + $7::interval) returning id`,
				s.qrCodeHash(code), pollHash, platform, name, ua, ip, secs(qrTTL)).Scan(&id)
		})
		if isUnique(err, "uq_chat_qr_login_sessions_code_hash") && try < 3 { // trùng mã đang có (rất hiếm): sinh mã khác
			continue
		}
		if err != nil {
			return nil, err
		}
		if limited {
			return nil, errRateLimit
		}
		return &QRStartResult{QRID: id, Code: code, PollToken: poll, ExpiresIn: int(qrTTL.Seconds()), PollInterval: qrPollIntervalSec}, nil
	}
}

// qrRow: một dòng chat_qr_login_sessions (khoá FOR UPDATE trong transaction của thao tác).
type qrRow struct {
	id                     int64
	pollHash, status       string
	uid                    *int64
	platform, name, ua, ip string
	expired                bool
	left                   int
	createdAt, expiresAt   time.Time
}

const qrSelect = `select id, poll_token_hash, status, user_id, platform, device_name, user_agent, request_ip, expires_at <= now(),
	greatest(0, ceil(extract(epoch from expires_at - now())))::int, created_at, expires_at from chat_qr_login_sessions `

func qrScanRow(row pgx.Row) (*qrRow, error) {
	var r qrRow
	if err := row.Scan(&r.id, &r.pollHash, &r.status, &r.uid, &r.platform, &r.name, &r.ua, &r.ip, &r.expired, &r.left,
		&r.createdAt, &r.expiresAt); err != nil {
		return nil, err
	}
	if r.expired {
		r.left = 0
	}
	return &r, nil
}

func (r *qrRow) scannedBy(uid int64) bool { return r.uid != nil && *r.uid == uid }

// QRPoll: máy mới hỏi kết quả bằng qr_id + poll_token. Thấy approved lần đầu: cùng transaction tạo thiết bị (login_method qr)
// + refresh token, phiên -> consumed, trả auth; các lần sau -> consumed không auth.
func (s *Service) QRPoll(ctx context.Context, in QRPollInput) (*QRPollResult, error) {
	tok := strings.TrimSpace(in.PollToken)
	if in.QRID <= 0 || tok == "" || len(tok) > 200 {
		return nil, errQRInvalid
	}
	hash := hashToken(tok)
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	// kiểm poll_token trước hạn mức: người không có token không làm nghẽn poll của máy thật (qr_id là số tăng dần)
	var stored string
	if err := p.QueryRow(ctx, `select poll_token_hash from chat_qr_login_sessions where id = $1`, in.QRID).Scan(&stored); err != nil {
		if noRows(err) {
			return nil, errQRInvalid
		}
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(stored), []byte(hash)) != 1 {
		return nil, errQRInvalid
	}
	if !s.qrPollLimit.allow(in.QRID) {
		return nil, errActionRateLimit
	}
	var res *QRPollResult
	var uid, did int64
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		r, err := qrScanRow(tx.QueryRow(ctx, qrSelect+`where id = $1 for update`, in.QRID))
		if noRows(err) {
			return errQRInvalid
		}
		if err != nil {
			return err
		}
		res = &QRPollResult{Status: r.status, ExpiresIn: r.left}
		switch {
		case r.status == QRRejected || r.status == QRConsumed:
			return nil
		case r.expired:
			res.Status = QRExpired
			return nil
		case r.status != QRApproved:
			// pending / scanned: KHÔNG trả tên người quét - mở link QR (tự gọi scan) chưa phải đồng ý, không lộ danh tính
			return nil
		}
		var display string
		if err := tx.QueryRow(ctx, `select display_name from chat_users where id = $1`, *r.uid).Scan(&display); err != nil {
			return err
		}
		res.Approver = &QRApproverDTO{DisplayName: display}
		var raw string
		if did, raw, err = s.devCreateTx(ctx, tx, *r.uid, r.platform, r.name, r.ua, r.ip, LoginQR); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update chat_qr_login_sessions set status = 'consumed', consumed_at = now() where id = $1`, r.id); err != nil {
			return err
		}
		me, err := s.loadMe(ctx, tx, *r.uid)
		if err != nil {
			return err
		}
		uid = *r.uid
		res.Auth = s.authResult(uid, did, raw, me)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if did != 0 {
		s.devNotify(uid, "login", did)
	}
	return res, nil
}

// qrLockByCode: chuẩn hoá mã -> khoá dòng phiên theo code_hash (sai dạng / không có -> QR_INVALID).
func (s *Service) qrLockByCode(ctx context.Context, tx pgx.Tx, code string) (*qrRow, error) {
	c, ok := qrNormalizeCode(code)
	if !ok {
		return nil, errQRInvalid
	}
	r, err := qrScanRow(tx.QueryRow(ctx, qrSelect+`where code_hash = $1 for update`, s.qrCodeHash(c)))
	if noRows(err) {
		return nil, errQRInvalid
	}
	return r, err
}

func (r *qrRow) info(status string) *QRSessionInfoDTO {
	return &QRSessionInfoDTO{QRID: r.id, Status: status, Platform: r.platform, DeviceName: r.name, UserAgent: r.ua, RequestIP: r.ip,
		CreatedAt: iso(r.createdAt), ExpiresAt: iso(r.expiresAt), ExpiresIn: r.left}
}

// QRScan: người đã đăng nhập quét / gõ mã -> pending thành scanned (user_id = người quét), trả thông tin máy đang chờ.
// Người đã quét gọi lại -> trả lại thông tin (idempotent).
func (s *Service) QRScan(ctx context.Context, uid, did int64, code string) (*QRSessionInfoDTO, error) {
	if !s.qrScanLimit.allow(uid) {
		return nil, errActionRateLimit
	}
	var out *QRSessionInfoDTO
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		r, err := s.qrLockByCode(ctx, tx, code)
		if err != nil {
			return err
		}
		switch {
		case r.status != QRPending && r.status != QRScanned:
			return errQRUsed
		case r.expired:
			return errQRExpired
		case r.status == QRScanned && !r.scannedBy(uid):
			return errQRUsed
		case r.status == QRScanned:
			out = r.info(QRScanned)
			return nil
		}
		if _, err := tx.Exec(ctx, `update chat_qr_login_sessions set status = 'scanned', user_id = $2, scanned_at = now()
			where id = $1`, r.id, uid); err != nil {
			return err
		}
		out = r.info(QRScanned)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// QRApprove: người đã quét duyệt -> approved, expires_at kéo tới ít nhất lúc duyệt + qrClaimGrace để máy mới kịp nhận.
func (s *Service) QRApprove(ctx context.Context, uid, did int64, code string) (*QRDecisionResult, error) {
	return s.qrDecide(ctx, uid, code, true)
}

// QRReject: người đã quét từ chối -> rejected (máy mới thấy "Đăng nhập đã bị từ chối").
func (s *Service) QRReject(ctx context.Context, uid, did int64, code string) (*QRDecisionResult, error) {
	return s.qrDecide(ctx, uid, code, false)
}

// qrDecide: duyệt / từ chối. Chưa quét -> 400; người khác đã quét / đã có quyết định khác -> QR_USED; hết hạn -> QR_EXPIRED;
// lặp lại đúng quyết định đã ghi -> trả lại (idempotent). Hạn mức dùng chung với quét (chống dò mã).
func (s *Service) qrDecide(ctx context.Context, uid int64, code string, approve bool) (*QRDecisionResult, error) {
	if !s.qrScanLimit.allow(uid) {
		return nil, errActionRateLimit
	}
	want := QRRejected
	if approve {
		want = QRApproved
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		r, err := s.qrLockByCode(ctx, tx, code)
		if err != nil {
			return err
		}
		switch {
		case r.status == QRPending && r.expired:
			return errQRExpired
		case r.status == QRPending:
			return errBad("Hãy quét mã trước")
		case !r.scannedBy(uid):
			return errQRUsed
		case r.status == want || (approve && r.status == QRConsumed):
			return nil
		case r.status != QRScanned:
			return errQRUsed
		case r.expired:
			return errQRExpired
		}
		if approve {
			_, err = tx.Exec(ctx, `update chat_qr_login_sessions set status = 'approved', resolved_at = now(),
				expires_at = greatest(expires_at, now() + $2::interval) where id = $1`, r.id, secs(qrClaimGrace))
		} else {
			_, err = tx.Exec(ctx, `update chat_qr_login_sessions set status = 'rejected', resolved_at = now() where id = $1`, r.id)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return &QRDecisionResult{Status: want}, nil
}
