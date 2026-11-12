package materials

import (
	"context"
	"strconv"
	"time"

	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
)

// Báo NGƯỜI DUYỆT khi người nhập (tài khoản không phải admin) thêm / sửa sản phẩm - chỉ bản Go.
// Gom theo (công ty, người nhập) trong duyetDelay rồi gửi 1 thông báo, để nhập file 50 SP không thành 50 thông báo.
// Người nhận: admin đang hoạt động + tài khoản có quyền sp_duyet, trừ chính người nhập.
// ponytail: gom trong bộ nhớ tiến trình; server khởi động lại giữa chừng thì mất lượt báo đang gom (SP vẫn ở Chưa duyệt).

type duyetBatch struct {
	them, sua int
	vd        string // tên 1 sản phẩm làm ví dụ
}

const kindChoDuyet = "sp_cho_duyet"

// duyetMsg: nội dung thông báo, vd "lienpham đã thêm 12 SP, sửa 3 SP (vd: Bồn cầu 1 khối) — đang Chưa duyệt, ...".
func duyetMsg(who string, them, sua int, vd string) string {
	m := who + " đã"
	if them > 0 {
		m += " thêm " + strconv.Itoa(them) + " SP"
	}
	if sua > 0 {
		if them > 0 {
			m += ","
		}
		m += " sửa " + strconv.Itoa(sua) + " SP"
	}
	if vd != "" {
		m += " (vd: " + vd + ")"
	}
	return m + " — đang Chưa duyệt, vào Danh sách sản phẩm lọc Chưa duyệt để duyệt."
}

// baoDuyet ghi nhận 1 thao tác thêm (them) / sửa (sua) của a; lần đầu trong lượt gom thì hẹn giờ gửi.
func (s *Service) baoDuyet(ctx context.Context, a *actor.Actor, them, sua int, vd string) {
	if s.duyetDelay <= 0 || s.notifier == nil || a == nil || a.IsAdmin() || them+sua <= 0 {
		return
	}
	key := jsval.ToString(a.CT) + "|" + jsval.ToString(a.UID)
	s.duyetMu.Lock()
	defer s.duyetMu.Unlock()
	b := s.duyetPend[key]
	if b == nil {
		b = &duyetBatch{}
		s.duyetPend[key] = b
		bg := context.WithoutCancel(ctx) // giữ ngữ cảnh công ty của request, không bị huỷ khi request xong
		who := actorName(a, "Người dùng")
		time.AfterFunc(s.duyetDelay, func() { s.guiDuyet(bg, key, who, a.UID) })
	}
	b.them += them
	b.sua += sua
	if b.vd == "" {
		b.vd = vd
	}
}

func (s *Service) guiDuyet(ctx context.Context, key, who string, uid any) {
	s.duyetMu.Lock()
	b := s.duyetPend[key]
	delete(s.duyetPend, key)
	s.duyetMu.Unlock()
	if b == nil {
		return
	}
	nhan := map[string]any{}
	if s.admins != nil {
		if ads, err := s.admins.ActiveAdmins(ctx); err == nil {
			for _, ad := range ads {
				nhan[jsval.ToString(jsval.Get(ad, "id"))] = jsval.Get(ad, "id")
			}
		}
	}
	if s.userFmt != nil {
		if us, err := s.repo.Select(ctx, "users"); err == nil {
			for _, u := range us {
				if jsval.StrictEquals(u.Val("active"), false) {
					continue
				}
				for _, p := range s.userFmt.PermsArr(u.Val("perms")) {
					if p == "sp_duyet" {
						nhan[jsval.ToString(u.Val("id"))] = u.Val("id")
					}
				}
			}
		}
	}
	delete(nhan, jsval.ToString(uid))
	msg := duyetMsg(who, b.them, b.sua, b.vd)
	for _, id := range nhan {
		s.notifier.Notify(ctx, id, kindChoDuyet, "Sản phẩm chờ duyệt", msg, nil)
	}
}
