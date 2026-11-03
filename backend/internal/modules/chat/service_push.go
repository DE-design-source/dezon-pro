package chat

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/platform/webpush"
)

// Push notification (CHAT.md 13): chỉ gửi cho người không có kết nối WebSocket, qua hàng đợi riêng có thử lại để
// dịch vụ push chậm không làm nghẽn luồng tin nhắn. Giai đoạn MVP: Web Push (VAPID) cho trình duyệt.

const (
	pushWorkers  = 4
	pushParallel = 8 // số request tới dịch vụ push chạy song song trong một job
	pushCoalesce = 3 * time.Second
	pushTTL      = 86400
)

// pushJob: MỘT job cho một tin (không phải một job cho mỗi người nhận): tin trong nhóm 1000 người chỉ chiếm 1 chỗ
// của hàng đợi chung.
type pushJob struct {
	convID, seq int64
	title, body string
	users       []int64 // người nhận (đã bỏ người online / tắt thông báo / vừa được push trong 3 giây)
	noCoalesce  bool    // job của người được @nhắc tên: không bỏ ai vì gộp 3 giây (vẫn ghi nhận lần push để gộp tin sau)
}

// mentionPushPrefix: đầu nội dung push gửi người được @nhắc tên (API.md mục "Quản trị nhóm" - Push).
const mentionPushPrefix = "Nhắc đến bạn: "

// pushPayload: thân thông báo mà service worker (chat-sw.js) đọc. UserID = người nhận: một trình duyệt có thể đăng
// nhập nhiều tài khoản (mỗi tab một tài khoản) dùng chung một subscription, service worker cần biết thông báo của ai.
type pushPayload struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	UserID         int64  `json:"user_id"`
	ConversationID int64  `json:"conversation_id"`
	Seq            int64  `json:"seq"`
	Badge          int64  `json:"badge"`
	Tag            string `json:"tag"`
	URL            string `json:"url"`
}

// pushTopic: Topic Web Push "c<uid>-<cid>" (tin mới thay tin cũ chưa giao của CÙNG người nhận + hội thoại; hai tài khoản
// trên một subscription không đè thông báo của nhau). Quá 32 ký tự (RFC 8030 mục 5.4) thì không gửi Topic.
func pushTopic(uid, cid int64) string {
	t := "c" + strconv.FormatInt(uid, 10) + "-" + strconv.FormatInt(cid, 10)
	if len(t) > 32 {
		return ""
	}
	return t
}

// pushHosts: đuôi tên máy chủ của các dịch vụ Web Push của trình duyệt (Chrome / Edge / Firefox / Safari).
// Endpoint ngoài danh sách bị từ chối: server không POST tới địa chỉ tuỳ ý do client gửi (chống SSRF).
var pushHosts = []string{"fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"}

func allowedPushHost(h string) bool {
	h = strings.ToLower(h)
	for _, x := range pushHosts {
		if h == x || strings.HasSuffix(h, "."+x) {
			return true
		}
	}
	return false
}

// validSubscription: PushSubscription JSON có endpoint https (dịch vụ push đã biết) + keys.p256dh + keys.auth,
// và qua đúng bộ kiểm của webpush.Send (p256dh là khoá P-256, auth 16 byte) - token đã lưu luôn gửi được.
func validSubscription(js string) bool {
	if len(js) > 4096 {
		return false
	}
	var sub struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if json.Unmarshal([]byte(js), &sub) != nil || sub.Keys.P256dh == "" || sub.Keys.Auth == "" {
		return false
	}
	u, err := url.Parse(sub.Endpoint)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && allowedPushHost(u.Hostname()) &&
		webpush.ValidateSubscription(js) == nil
}

// PushConfigResult: GET /chat/push/config.
type PushConfigResult struct {
	Enabled        bool    `json:"enabled"`
	VAPIDPublicKey *string `json:"vapid_public_key"`
}

// PushConfig: push có bật không + khoá công khai VAPID cho pushManager.subscribe.
func (s *Service) PushConfig() *PushConfigResult {
	if s.push == nil {
		return &PushConfigResult{}
	}
	k := s.push.PublicKey()
	return &PushConfigResult{Enabled: true, VAPIDPublicKey: &k}
}

// SetPushToken gắn push subscription cho thiết bị hiện tại. Chỉ gỡ subscription đó khỏi thiết bị KHÁC CỦA CÙNG người
// dùng (đăng nhập lại trên cùng trình duyệt thì chỉ thiết bị mới nhận): một trình duyệt đăng nhập nhiều tài khoản
// (mỗi tab một tài khoản) chỉ có một subscription, thiết bị của từng tài khoản đều giữ nó. Vì vậy một người dùng
// không bao giờ có cùng một subscription trên hai thiết bị của mình.
func (s *Service) SetPushToken(ctx context.Context, uid, did int64, kind, token string) error {
	if kind != "webpush" {
		return errBad("Giai đoạn này chỉ hỗ trợ push_kind = webpush")
	}
	token = strings.TrimSpace(token)
	if !validSubscription(token) {
		return errBad("push_token phải là PushSubscription JSON (endpoint https của dịch vụ push, keys.p256dh, keys.auth)")
	}
	p, err := s.pool()
	if err != nil {
		return err
	}
	if _, err := p.Exec(ctx, `update chat_devices set push_kind = null, push_token = null
		where push_token = $1 and id <> $2 and user_id = $3`, token, did, uid); err != nil {
		return err
	}
	tag, err := p.Exec(ctx, `update chat_devices set push_kind = $3, push_token = $4 where id = $1 and user_id = $2`, did, uid, kind, token)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errNoAuth
	}
	return nil
}

// ClearPushToken: thiết bị hiện tại thôi nhận push.
func (s *Service) ClearPushToken(ctx context.Context, uid, did int64) error {
	return s.exec(ctx, `update chat_devices set push_kind = null, push_token = null where id = $1 and user_id = $2`, did, uid)
}

// enqueuePush: không bao giờ chặn (gọi từ bộ chạy phân phối); gộp tin ngay tại đây (người vừa được push cho hội
// thoại này trong 3 giây thì bỏ, trước khi chiếm chỗ hàng đợi); hàng đợi đầy thì bỏ thông báo.
func (s *Service) enqueuePush(j pushJob) {
	if s.push == nil {
		return
	}
	users := make([]int64, 0, len(j.users))
	for _, u := range j.users {
		if j.noCoalesce {
			s.markPushed(u, j.convID)
			users = append(users, u)
		} else if !s.coalesced(u, j.convID) {
			users = append(users, u)
		}
	}
	if len(users) == 0 {
		return
	}
	j.users = users
	// khởi động worker lần đầu; đã Shutdown thì thôi (không Add vào WaitGroup đang Wait)
	s.pushStartMu.Lock()
	if s.pushStopped {
		s.pushStartMu.Unlock()
		return
	}
	if !s.pushStarted {
		s.pushStarted = true
		for i := 0; i < pushWorkers; i++ {
			s.pushWG.Add(1)
			go s.pushWorker()
		}
	}
	s.pushStartMu.Unlock()
	select {
	case s.pushQ <- j:
	default:
		s.noteDropped(len(j.users))
	}
}

// noteDropped: đếm thông báo bị bỏ vì hàng đợi đầy, ghi log tối đa 1 dòng / phút (không làm ngập log).
func (s *Service) noteDropped(n int) {
	now := s.now()
	s.pushMu.Lock()
	s.pushDrops += int64(n)
	if !s.pushDropLog.IsZero() && now.Sub(s.pushDropLog) < time.Minute {
		s.pushMu.Unlock()
		return
	}
	total := s.pushDrops
	s.pushDrops, s.pushDropLog = 0, now
	s.pushMu.Unlock()
	logger.Error("chat", "hàng đợi push đầy, đã bỏ", total, "thông báo")
}

func (s *Service) pushWorker() {
	defer s.pushWG.Done()
	for {
		select {
		case <-s.pushQuit:
			return
		case j := <-s.pushQ:
			s.runPush(j)
		}
	}
}

// coalesced: đã push cho (người nhận, hội thoại) trong 3 giây vừa qua -> bỏ (gộp tin); chưa thì ghi nhận lần này.
func (s *Service) coalesced(user, conv int64) bool {
	now := s.now()
	key := [2]int64{user, conv}
	s.pushMu.Lock()
	defer s.pushMu.Unlock()
	if t, ok := s.pushLast[key]; ok && now.Sub(t) < pushCoalesce {
		return true
	}
	if len(s.pushLast) > 10000 {
		for k, t := range s.pushLast {
			if now.Sub(t) >= pushCoalesce {
				delete(s.pushLast, k)
			}
		}
	}
	s.pushLast[key] = now
	return false
}

// markPushed: ghi nhận vừa push cho (người nhận, hội thoại) mà không kiểm gộp (push @nhắc tên); tin thường ngay sau đó bị gộp.
func (s *Service) markPushed(user, conv int64) {
	now := s.now()
	s.pushMu.Lock()
	s.pushLast[[2]int64{user, conv}] = now
	s.pushMu.Unlock()
}

type pushDevice struct {
	id, userID int64
	token      string
}

// runPush: một câu đọc thiết bị + một câu đếm chưa đọc cho cả danh sách người nhận, rồi gửi song song (tối đa
// pushParallel request cùng lúc). Chỉ thiết bị còn phiên (còn refresh token chưa hết hạn): phiên hết hạn / đăng xuất
// lúc mất mạng để lại dòng thiết bị giữ subscription mà trình duyệt vẫn dùng cho tài khoản khác (SetPushToken không gỡ
// subscription khỏi thiết bị của người khác) -> không được hiện tin của tài khoản đã rời trình duyệt.
func (s *Service) runPush(j pushJob) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	p, err := s.pool()
	if err != nil {
		logger.Error("chat", "push:", err.Error())
		return
	}
	// tin đã bị thu hồi khi job còn trong hàng đợi (cửa sổ gộp 3 giây / hàng chờ) -> bỏ, không lộ nội dung đã xoá
	var recalled bool
	if err := p.QueryRow(ctx, `select exists (select 1 from chat_messages where conversation_id = $1 and seq = $2 and recalled_at is not null)`,
		j.convID, j.seq).Scan(&recalled); err != nil {
		logger.Error("chat", "push: đọc trạng thái thu hồi lỗi:", err.Error())
		return
	}
	if recalled {
		return
	}
	rows, err := p.Query(ctx, `select d.id, d.user_id, d.push_token from chat_devices d
		where d.user_id = any($1::bigint[]) and d.push_kind = 'webpush'
			and exists (select 1 from chat_refresh_tokens t where t.device_id = d.id and t.expires_at > now())
		order by d.user_id, d.id`, j.users)
	if err != nil {
		logger.Error("chat", "push: đọc thiết bị lỗi:", err.Error())
		return
	}
	var devs []pushDevice
	var owners []int64
	for rows.Next() {
		var d pushDevice
		if err := rows.Scan(&d.id, &d.userID, &d.token); err != nil {
			rows.Close()
			logger.Error("chat", "push: đọc thiết bị lỗi:", err.Error())
			return
		}
		if len(devs) == 0 || devs[len(devs)-1].userID != d.userID {
			owners = append(owners, d.userID)
		}
		devs = append(devs, d)
	}
	rows.Close()
	if len(devs) == 0 {
		return
	}
	badges, err := s.unreadTotals(ctx, owners)
	if err != nil {
		logger.Error("chat", "push: đếm tin chưa đọc lỗi:", err.Error())
	}
	cid := strconv.FormatInt(j.convID, 10)
	// url có ?u=<uid>: trang mở ra chuyển tab sang đúng tài khoản nhận (nếu trình duyệt đăng nhập nhiều tài khoản)
	payloads := make(map[int64][]byte, len(owners))
	for _, u := range owners {
		uid := strconv.FormatInt(u, 10)
		payloads[u], _ = json.Marshal(pushPayload{Title: j.title, Body: j.body, UserID: u, ConversationID: j.convID, Seq: j.seq,
			Badge: badges[u], Tag: "conv-" + uid + "-" + cid, URL: "/chat?u=" + uid + "#c" + cid})
	}
	sem := make(chan struct{}, pushParallel)
	var wg sync.WaitGroup
	for _, d := range devs {
		sem <- struct{}{}
		wg.Add(1)
		go func(d pushDevice) {
			defer func() { <-sem; wg.Done() }()
			s.sendPush(ctx, d, payloads[d.userID], pushTopic(d.userID, j.convID))
		}(d)
	}
	wg.Wait()
}

// sendPush: 404 / 410 (subscription hết hạn) -> gỡ token của thiết bị; 5xx / 429 / lỗi mạng (status 0) -> thử lại 2 lần
// (1 s, 5 s); 4xx khác (400 / 401 / 403 / 413...) là lỗi cố định, thử lại vô ích -> ghi log, bỏ.
func (s *Service) sendPush(ctx context.Context, d pushDevice, payload []byte, topic string) {
	for attempt := 0; ; attempt++ {
		status, gone, err := s.push.Send(ctx, d.token, payload, pushTTL, "high", topic)
		// token lưu từ trước khi kiểm chặt (Send luôn từ chối) cũng gỡ như subscription hết hạn, không thử lại
		if status == 0 && err != nil && webpush.ValidateSubscription(d.token) != nil {
			logger.Error("chat", "push: subscription của thiết bị", d.id, "không hợp lệ, gỡ:", err.Error())
			gone = true
		}
		if gone {
			p, perr := s.pool()
			if perr == nil {
				_, perr = p.Exec(ctx, `update chat_devices set push_kind = null, push_token = null where id = $1 and push_token = $2`, d.id, d.token)
			}
			if perr != nil {
				logger.Error("chat", "push: gỡ subscription hết hạn lỗi:", perr.Error())
			}
			return
		}
		// quyết theo mã HTTP, không theo err: webpush.Client trả err cho MỌI mã không phải 2xx
		if status != 0 && status != 429 && status < 500 {
			if status >= 400 {
				msg := ""
				if err != nil {
					msg = err.Error()
				}
				logger.Error("chat", "push: dịch vụ push từ chối, mã", status, "thiết bị", d.id, msg)
			}
			return
		}
		if attempt >= len(s.pushRetry) {
			msg := "mã " + strconv.Itoa(status)
			if err != nil {
				msg = err.Error()
			}
			logger.Error("chat", "push: gửi không được sau", attempt+1, "lần, thiết bị", d.id, msg)
			return
		}
		select {
		case <-time.After(s.pushRetry[attempt]):
		case <-s.pushQuit:
			return
		case <-ctx.Done():
			return
		}
	}
}

// unreadTotals: tổng tin chưa đọc của mọi hội thoại đang tham gia (badge) của từng người (không có dòng = 0).
func (s *Service) unreadTotals(ctx context.Context, uids []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	p, err := s.pool()
	if err != nil {
		return out, err
	}
	rows, err := p.Query(ctx, `select m.user_id, coalesce(sum(greatest(c.last_seq - m.last_read_seq, 0)), 0)::bigint
		from chat_conversation_members m join chat_conversations c on c.id = m.conversation_id
		where m.user_id = any($1::bigint[]) and m.left_at is null group by m.user_id`, uids)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var u, n int64
		if err := rows.Scan(&u, &n); err != nil {
			return out, err
		}
		out[u] = n
	}
	return out, rows.Err()
}
