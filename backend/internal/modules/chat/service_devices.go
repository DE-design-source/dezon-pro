package chat

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Danh sách thiết bị đăng nhập + đăng xuất từ xa (CHAT.md mục 11 bước 5, API.md "Đa thiết bị").

// devCleanUA: User-Agent / tên thiết bị đã bỏ NUL, cắt khoảng trắng hai đầu, tối đa n ký tự.
func devCleanUA(s string, n int) string {
	return truncRunes(strings.TrimSpace(strings.ReplaceAll(s, "\x00", "")), n)
}

// devCleanIP: IP client tối đa maxIPLen ký tự (rỗng = không rõ).
func devCleanIP(ip string) string { return devCleanUA(ip, maxIPLen) }

// devCreateTx: thêm thiết bị + refresh token đầu tiên (otp/verify, QR) trong transaction tx -> (id thiết bị, refresh token).
func (s *Service) devCreateTx(ctx context.Context, tx pgx.Tx, uid int64, platform, name, ua, ip, method string) (int64, string, error) {
	raw, hash, err := newRefreshToken()
	if err != nil {
		return 0, "", err
	}
	var did int64
	if err := tx.QueryRow(ctx, `insert into chat_devices (user_id, platform, device_name, user_agent, last_ip, login_method, last_seen_at)
		values ($1, $2, $3, $4, $5, $6, now()) returning id`, uid, platform, name, ua, ip, method).Scan(&did); err != nil {
		return 0, "", err
	}
	if _, err := tx.Exec(ctx, `insert into chat_refresh_tokens (device_id, token_hash, expires_at)
		values ($1, $2, now() + $3::interval)`, did, hash, secs(s.refreshTTL)); err != nil {
		return 0, "", err
	}
	return did, raw, nil
}

// devNotify: gói devices.updated tới mọi kết nối của chính tài khoản (bảng thiết bị đang mở thì tải lại).
func (s *Service) devNotify(uid int64, reason string, deviceID int64) {
	s.sendTo([]int64{uid}, EvDevicesUpdated, DevicesUpdatedDTO{Reason: reason, DeviceID: deviceID})
}

// Devices: thiết bị còn phiên của tôi (có refresh token chưa dùng, chưa hết hạn) + thiết bị hiện tại; hiện tại trước, rồi
// last_seen_at mới trước.
func (s *Service) Devices(ctx context.Context, uid, did int64) (*DeviceList, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	rows, err := p.Query(ctx, `select d.id, d.platform, d.device_name, d.user_agent, d.last_ip, d.login_method,
		d.push_token is not null, d.last_seen_at, d.created_at
		from chat_devices d
		where d.user_id = $1 and (d.id = $2 or exists (select 1 from chat_refresh_tokens t
			where t.device_id = d.id and t.used_at is null and t.expires_at > now()))
		order by (d.id = $2) desc, d.last_seen_at desc nulls last, d.id desc`, uid, did)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &DeviceList{Devices: []DeviceDTO{}}
	var ids []int64
	for rows.Next() {
		var d DeviceDTO
		var seen *time.Time
		var created time.Time
		if err := rows.Scan(&d.ID, &d.Platform, &d.Name, &d.UserAgent, &d.LastIP, &d.LoginMethod, &d.Push, &seen, &created); err != nil {
			return nil, err
		}
		d.Current = d.ID == did
		d.LastSeenAt = isoPtr(seen)
		d.CreatedAt = iso(created)
		out.Devices = append(out.Devices, d)
		ids = append(ids, d.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if on, ok := s.gateway().(deviceOnliner); ok && len(ids) > 0 {
		m := on.OnlineDevices(ids)
		for i := range out.Devices {
			out.Devices[i].Online = m[out.Devices[i].ID]
		}
	}
	return out, nil
}

// RevokeDevice: đăng xuất từ xa một thiết bị khác của tôi - xoá dòng chat_devices (kéo theo refresh token + push token),
// bỏ cache, gateway gửi force_logout + đóng 4403, rồi báo devices.updated {reason: "revoked"}.
func (s *Service) RevokeDevice(ctx context.Context, uid, did, target int64) error {
	if target == did {
		return errBad("Dùng Đăng xuất để thoát thiết bị này")
	}
	if target <= 0 {
		return errNotFound("Không tìm thấy thiết bị")
	}
	p, err := s.pool()
	if err != nil {
		return err
	}
	tag, err := p.Exec(ctx, `delete from chat_devices where id = $1 and user_id = $2`, target, uid)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNotFound("Không tìm thấy thiết bị")
	}
	s.dropDevice(target)
	s.devNotify(uid, "revoked", target)
	return nil
}

// RevokeOtherDevices: như RevokeDevice cho mọi thiết bị của tôi trừ thiết bị hiện tại -> số thiết bị đã đăng xuất.
func (s *Service) RevokeOtherDevices(ctx context.Context, uid, did int64) (*RevokeOthersResult, error) {
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	rows, err := p.Query(ctx, `delete from chat_devices where user_id = $1 and id <> $2 returning id`, uid, did)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		s.dropDevice(id)
	}
	for _, id := range ids {
		s.devNotify(uid, "revoked", id)
	}
	return &RevokeOthersResult{Revoked: int64(len(ids))}, nil
}
