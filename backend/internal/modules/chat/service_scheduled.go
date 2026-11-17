package chat

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"qspro-backend/internal/platform/logger"
	apperr "qspro-backend/internal/shared/errors"
)

// Tin hẹn giờ (migration 0048, API.md mục "Tin hẹn giờ"): người dùng hẹn một tin văn bản, tới send_at worker gửi hộ qua
// đúng đường SendMessage (lưu tin + ack trùng + phân phối realtime + push), bỏ qua giới hạn gửi tương tác (sendLimit).
// Thứ tự khoá: dòng chat_scheduled_messages TRƯỚC, dòng chat_conversations SAU (worker và PATCH cùng thứ tự, không deadlock).

const (
	schedEvery      = 15 * time.Second // chu kỳ worker
	schedMinLead    = 30 * time.Second // giờ hẹn sớm nhất tính từ lúc tạo / sửa
	schedMaxPending = 50               // tin đang chờ tối đa / người / hội thoại
	schedBatch      = 100              // số tin tối đa gửi trong một lượt worker
)

// Mã lỗi tin hẹn giờ.
const (
	CodeScheduledLimit = "SCHEDULED_LIMIT"
	CodeScheduledDone  = "SCHEDULED_DONE"
)

var (
	errScheduledNotFound = apperr.E(404, "Không tìm thấy tin hẹn giờ", CodeNotFound)
	errScheduledDone     = apperr.E(409, "Tin hẹn giờ đã gửi hoặc đã huỷ", CodeScheduledDone)
	errScheduledLimit    = apperr.E(409, "Mỗi cuộc trò chuyện chỉ hẹn tối đa 50 tin đang chờ", CodeScheduledLimit)
)

// schedClientID: client_msg_id (UUID) của tin gửi từ tin hẹn id - cố định theo id nên gửi lại (instance khác, chết giữa
// chừng) chỉ ra ack trùng. Dạng UUID phiên bản 5 lấy từ sha256("qspro-chat-sched-<id>").
func schedClientID(id int64) string {
	b := sha256.Sum256([]byte("qspro-chat-sched-" + strconv.FormatInt(id, 10)))
	b[6] = b[6]&0x0f | 0x50
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// cleanScheduled: cắt khoảng trắng (dời offset nhắc tên theo), nội dung 1..4000 ký tự như tin văn bản.
func cleanScheduled(raw string, ms []Mention) (string, []Mention, error) {
	content := strings.TrimSpace(raw)
	ms = shiftMentions(ms, raw, content)
	if utf8.RuneCountInString(content) > maxContent || strings.ContainsRune(content, 0) {
		return "", nil, errBad("Tin nhắn tối đa 4000 ký tự")
	}
	if content == "" {
		return "", nil, errBad("Tin nhắn trống")
	}
	return content, ms, nil
}

// parseSendAt: thời điểm RFC3339, từ now + 30 giây tới now + 1 năm.
func parseSendAt(raw string, now time.Time) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, errBad("Thiếu send_at")
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return time.Time{}, errBad("send_at phải là thời điểm RFC3339 (vd 2026-12-01T08:00:00+07:00)")
	}
	if t.Before(now.Add(schedMinLead)) {
		return time.Time{}, errBad("Giờ hẹn phải sau thời điểm hiện tại ít nhất 30 giây")
	}
	if t.After(now.AddDate(1, 0, 0)) {
		return time.Time{}, errBad("Giờ hẹn tối đa 1 năm kể từ bây giờ")
	}
	return t.Truncate(time.Microsecond), nil
}

const schedCols = `id, user_id, conversation_id, content, mentions::text, reply_to_message_id, send_at, status, error, message_id, created_at`

type schedRow struct {
	id, userID, convID int64
	content            string
	mentions           []byte
	replyTo            *int64
	sendAt             time.Time
	status             string
	errMsg             *string
	messageID          *int64
	createdAt          time.Time
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSched(r rowScanner) (*schedRow, error) {
	x := &schedRow{}
	if err := r.Scan(&x.id, &x.userID, &x.convID, &x.content, &x.mentions, &x.replyTo, &x.sendAt, &x.status, &x.errMsg,
		&x.messageID, &x.createdAt); err != nil {
		return nil, err
	}
	return x, nil
}

func (x *schedRow) dto() ScheduledDTO {
	ms := parseMentions(x.mentions)
	if ms == nil {
		ms = []Mention{}
	}
	return ScheduledDTO{ID: x.id, ConversationID: x.convID, Content: x.content, Mentions: ms, ReplyToMessageID: x.replyTo,
		SendAt: iso(x.sendAt), Status: x.status, CreatedAt: iso(x.createdAt), MessageID: x.messageID, Error: x.errMsg}
}

// schedCheckTx (trong transaction): người hẹn qua được cổng gửi tin (thành viên đang hoạt động, quyền gửi trong nhóm, không
// bị chặn - khoá dòng hội thoại), nhắc tên hợp lệ (bỏ người không còn trong nhóm, @Tất cả chỉ trưởng / phó nhóm), tin
// được trả lời còn hợp lệ. Trả nhắc tên đã chuẩn hoá.
func (s *Service) schedCheckTx(ctx context.Context, tx pgx.Tx, uid, convID int64, content string, ms []Mention, replyTo int64) ([]Mention, error) {
	g, _, err := msgGateTx(ctx, tx, uid, convID, "")
	if err != nil {
		return nil, err
	}
	if ms, err = checkMentions(g.conv.typ, "text", content, ms); err != nil {
		return nil, err
	}
	if ms, _, _, err = resolveMentions(ctx, tx, convID, uid, g.role, g.st, ms); err != nil {
		return nil, err
	}
	if replyTo > 0 {
		if _, err := s.replyTargetTx(ctx, tx, convID, replyTo); err != nil {
			return nil, err
		}
	}
	return ms, nil
}

// notifySched: gói scheduled.updated tới mọi thiết bị của người hẹn (đồng bộ danh sách tin hẹn giữa các máy).
func (s *Service) notifySched(x *schedRow) {
	if x != nil {
		s.sendTo([]int64{x.userID}, "scheduled.updated", x.dto())
	}
}

// CreateScheduled hẹn một tin văn bản trong hội thoại convID.
func (s *Service) CreateScheduled(ctx context.Context, uid, convID int64, in ScheduleInput) (*ScheduledDTO, error) {
	if convID <= 0 {
		return nil, errBad("Thiếu conversation_id")
	}
	if in.ReplyToMessageID < 0 {
		return nil, errBad("reply_to_message_id không hợp lệ")
	}
	content, ms, err := cleanScheduled(in.Content, in.Mentions)
	if err != nil {
		return nil, err
	}
	sendAt, err := parseSendAt(in.SendAt, s.now())
	if err != nil {
		return nil, err
	}
	var x *schedRow
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if ms, err = s.schedCheckTx(ctx, tx, uid, convID, content, ms, in.ReplyToMessageID); err != nil {
			return err
		}
		// dòng hội thoại đang khoá (msgGateTx): đếm + thêm của cùng người trong cùng hội thoại chạy tuần tự
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from chat_scheduled_messages
			where user_id = $1 and conversation_id = $2 and status = 'pending'`, uid, convID).Scan(&n); err != nil {
			return err
		}
		if n >= schedMaxPending {
			return errScheduledLimit
		}
		var reply any
		if in.ReplyToMessageID > 0 {
			reply = in.ReplyToMessageID
		}
		x, err = scanSched(tx.QueryRow(ctx, `insert into chat_scheduled_messages
				(user_id, conversation_id, content, mentions, reply_to_message_id, send_at)
			values ($1, $2, $3, $4::jsonb, $5::bigint, $6::timestamptz) returning `+schedCols,
			uid, convID, content, mentionsArg(ms), reply, sendAt))
		return err
	})
	if err != nil {
		return nil, err
	}
	s.notifySched(x)
	d := x.dto()
	return &d, nil
}

// ListScheduled: tin hẹn đang chờ của tôi trong hội thoại convID, sớm trước.
func (s *Service) ListScheduled(ctx context.Context, uid, convID int64) (*ScheduledList, error) {
	if convID <= 0 {
		return nil, errBad("Thiếu conversation_id")
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	rows, err := p.Query(ctx, `select `+schedCols+` from chat_scheduled_messages
		where user_id = $1 and conversation_id = $2 and status = 'pending' order by send_at, id`, uid, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ScheduledList{Items: []ScheduledDTO{}}
	for rows.Next() {
		x, err := scanSched(rows)
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, x.dto())
	}
	return out, rows.Err()
}

// UpdateScheduled sửa nội dung / nhắc tên / giờ hẹn của tin hẹn đang chờ (chỉ người hẹn).
func (s *Service) UpdateScheduled(ctx context.Context, uid, sid int64, in SchedulePatch) (*ScheduledDTO, error) {
	if sid <= 0 {
		return nil, errBad("Mã không hợp lệ: sid")
	}
	var sendAt *time.Time
	if in.SendAt != nil {
		t, err := parseSendAt(*in.SendAt, s.now())
		if err != nil {
			return nil, err
		}
		sendAt = &t
	}
	var content *string
	var ms []Mention
	if in.Content != nil {
		c, m, err := cleanScheduled(*in.Content, in.Mentions)
		if err != nil {
			return nil, err
		}
		content, ms = &c, m
	}
	var x *schedRow
	changed := false
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		cur, err := scanSched(tx.QueryRow(ctx, `select `+schedCols+` from chat_scheduled_messages
			where id = $1 and user_id = $2 for update`, sid, uid))
		if noRows(err) {
			return errScheduledNotFound
		}
		if err != nil {
			return err
		}
		if cur.status != "pending" {
			return errScheduledDone
		}
		x = cur
		if content == nil && in.Mentions == nil && sendAt == nil {
			return nil
		}
		newContent, newMentions := cur.content, parseMentions(cur.mentions)
		if content != nil || in.Mentions != nil {
			newContent, newMentions = cur.content, in.Mentions
			if content != nil {
				newContent, newMentions = *content, ms
			}
			var reply int64
			if cur.replyTo != nil {
				reply = *cur.replyTo
			}
			if newMentions, err = s.schedCheckTx(ctx, tx, uid, cur.convID, newContent, newMentions, reply); err != nil {
				return err
			}
		}
		at := cur.sendAt
		if sendAt != nil {
			at = *sendAt
		}
		x, err = scanSched(tx.QueryRow(ctx, `update chat_scheduled_messages set content = $2, mentions = $3::jsonb,
				send_at = $4::timestamptz, updated_at = now()
			where id = $1 returning `+schedCols, sid, newContent, mentionsArg(newMentions), at))
		changed = err == nil
		return err
	})
	if err != nil {
		return nil, err
	}
	if changed {
		s.notifySched(x)
	}
	d := x.dto()
	return &d, nil
}

// CancelScheduled huỷ tin hẹn đang chờ (chỉ người hẹn): status = canceled.
func (s *Service) CancelScheduled(ctx context.Context, uid, sid int64) error {
	if sid <= 0 {
		return errBad("Mã không hợp lệ: sid")
	}
	p, err := s.pool()
	if err != nil {
		return err
	}
	// worker đang gửi tin này thì giữ khoá dòng: update chờ tới khi worker xong rồi thấy status đã đổi
	x, err := scanSched(p.QueryRow(ctx, `update chat_scheduled_messages set status = 'canceled', updated_at = now()
		where id = $1 and user_id = $2 and status = 'pending' returning `+schedCols, sid, uid))
	if noRows(err) {
		var st string
		err = p.QueryRow(ctx, `select status from chat_scheduled_messages where id = $1 and user_id = $2`, sid, uid).Scan(&st)
		if noRows(err) {
			return errScheduledNotFound
		}
		if err != nil {
			return err
		}
		return errScheduledDone
	}
	if err != nil {
		return err
	}
	s.notifySched(x)
	return nil
}

// ───────────── Worker ─────────────

// StartScheduler chạy worker gửi tin hẹn giờ mỗi 15 giây tới khi Shutdown (cmd/api gọi qua Server.StartChatScheduler).
// Không có database / đã Shutdown / đã chạy -> bỏ qua. Nhiều instance cùng chạy được (FOR UPDATE SKIP LOCKED + client_msg_id cố định).
func (s *Service) StartScheduler() {
	s.schedMu.Lock()
	defer s.schedMu.Unlock()
	if s.db == nil || s.schedStarted || s.schedStopped {
		return
	}
	s.schedStarted = true
	s.schedWG.Add(1)
	go func() {
		defer s.schedWG.Done()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		go func() {
			select {
			case <-s.schedQuit:
				cancel()
			case <-ctx.Done():
			}
		}()
		tk := time.NewTicker(schedEvery)
		defer tk.Stop()
		for {
			select {
			case <-s.schedQuit:
				return
			case <-tk.C:
				if _, err := s.RunScheduledOnce(ctx); err != nil && ctx.Err() == nil {
					logger.Error("chat", "gửi tin hẹn giờ lỗi:", err.Error())
				}
			}
		}
	}()
}

// RunScheduledOnce: một lượt worker - gửi lần lượt các tin tới hạn (tối đa schedBatch), dừng ở lỗi tạm thời đầu tiên
// (tin đó giữ pending, lượt sau thử lại). Trả số tin đã xử lý (sent + failed).
func (s *Service) RunScheduledOnce(ctx context.Context) (int, error) {
	n := 0
	for n < schedBatch {
		ok, err := s.sendOneScheduled(ctx)
		if err != nil {
			return n, err
		}
		if !ok {
			break
		}
		n++
	}
	return n, nil
}

// sendOneScheduled: khoá 1 tin tới hạn (SKIP LOCKED: instance khác bỏ qua), gửi qua sendMessage trong transaction riêng,
// rồi ghi sent / failed. Lỗi nghiệp vụ (không còn trong hội thoại, bị chặn, nhóm giải tán, nhắc tên / tin trả lời không còn
// hợp lệ...) -> failed + error; lỗi khác (database...) -> rollback, tin giữ pending. Chết sau khi tin đã lưu mà chưa ghi
// sent: lần sau gửi lại cùng client_msg_id -> ack trùng -> ghi sent với tin cũ. false = không còn tin tới hạn.
func (s *Service) sendOneScheduled(ctx context.Context) (bool, error) {
	var x *schedRow
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		cur, err := scanSched(tx.QueryRow(ctx, `select `+schedCols+` from chat_scheduled_messages
			where status = 'pending' and send_at <= $1::timestamptz order by send_at limit 1 for update skip locked`, s.now()))
		if noRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		in := SendInput{ConversationID: cur.convID, ClientMsgID: schedClientID(cur.id), MsgType: "text", Content: cur.content,
			Mentions: parseMentions(cur.mentions)}
		if cur.replyTo != nil {
			in.ReplyToMessageID = *cur.replyTo
		}
		ack, serr := s.sendMessage(ctx, cur.userID, in, false)
		var ae *apperr.AppError
		switch {
		case serr == nil:
			cur, err = scanSched(tx.QueryRow(ctx, `update chat_scheduled_messages set status = 'sent', sent_at = $2::timestamptz,
					message_id = $3, error = null, updated_at = now()
				where id = $1 returning `+schedCols, cur.id, s.now(), ack.MessageID))
		case errors.As(serr, &ae) && ae.Status < 500 && ae.Status != 429:
			cur, err = s.failScheduled(ctx, tx, cur.id, ae.Msg)
		case permanentPgErr(serr):
			logger.Error("chat", "tin hẹn giờ", cur.id, "không gửi được:", serr.Error())
			cur, err = s.failScheduled(ctx, tx, cur.id, "Không gửi được tin hẹn giờ")
		default:
			return serr
		}
		x = cur
		return err
	})
	if err != nil {
		return false, err
	}
	s.notifySched(x)
	return x != nil, nil
}

func (s *Service) failScheduled(ctx context.Context, tx pgx.Tx, id int64, msg string) (*schedRow, error) {
	return scanSched(tx.QueryRow(ctx, `update chat_scheduled_messages set status = 'failed', error = $2, updated_at = now()
		where id = $1 returning `+schedCols, id, msg))
}

// permanentPgErr: lỗi dữ liệu (22xxx) / ràng buộc (23xxx) của PostgreSQL - thử lại vẫn hỏng, không giữ pending (chặn hàng đợi).
func permanentPgErr(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && (strings.HasPrefix(pe.Code, "22") || strings.HasPrefix(pe.Code, "23"))
}
