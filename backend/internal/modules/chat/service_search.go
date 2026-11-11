package chat

import (
	"context"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	apperr "qspro-backend/internal/shared/errors"
)

// Tìm tin nhắn (migration 0023, API.md mục "Tìm tin"): bỏ dấu tiếng Việt bằng foldVN (Go) = chat_search_fold (SQL), full-text
// cấu hình 'simple' với tiền tố cho từng từ, mới trước, phân trang theo id tin.

// searchErrRateLimit: quá 30 lần tìm / phút / người (s.msgSearchLimit).
var searchErrRateLimit = apperr.E(429, "Bạn tìm kiếm quá nhanh, thử lại sau", CodeRateLimit)

// Bảng 67 chữ có dấu dựng sẵn (chữ thường) -> chữ không dấu: ĐÚNG thứ tự / nội dung với translate() trong chat_search_fold.
const (
	foldFrom = "áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ"
	foldTo   = "aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy"
)

var foldTable = func() map[rune]rune {
	from, to := []rune(foldFrom), []rune(foldTo)
	if len(from) != len(to) {
		panic("chat: bảng bỏ dấu lệch độ dài")
	}
	m := make(map[rune]rune, len(from))
	for i, r := range from {
		m[r] = to[i]
	}
	return m
}()

// foldIsAlnum: ký tự giữ lại khi chuẩn hoá = [:alnum:] của Postgres (iswalnum theo locale UTF-8): chữ cái, chữ số, số dạng
// chữ (Nl) và dấu thuộc tính Alphabetic (Other_Alphabetic, vd nguyên âm Thái / Devanagari).
func foldIsAlnum(r rune) bool {
	if r < utf8.RuneSelf {
		return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
	}
	return unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.In(r, unicode.Nl, unicode.Other_Alphabetic)
}

// foldVN: chuẩn hoá để tìm (giống hệt SQL chat_search_fold, giao diện searchUtil.foldText): chữ thường -> bỏ dấu tổ hợp
// U+0300..U+036F -> chữ có dấu dựng sẵn về không dấu (đ -> d) -> mỗi chuỗi ký tự không phải chữ / số thành 1 khoảng trắng,
// bỏ khoảng trắng hai đầu.
func foldVN(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	gap := false
	for _, r := range s {
		r = unicode.ToLower(r)
		if r >= 0x300 && r <= 0x36F {
			continue
		}
		if m, ok := foldTable[r]; ok {
			r = m
		}
		if !foldIsAlnum(r) {
			gap = true
			continue
		}
		if gap && b.Len() > 0 {
			b.WriteByte(' ')
		}
		gap = false
		b.WriteRune(r)
	}
	return b.String()
}

// searchTerms: q người dùng gõ -> các từ đã chuẩn hoá (tối đa maxSearchTerms, bỏ từ trùng, giữ thứ tự). q quá
// maxSearchQueryRunes ký tự hoặc tổng số ký tự các từ < searchMinChars -> BAD_REQUEST.
func searchTerms(q string) ([]string, error) {
	q = strings.TrimSpace(q)
	if utf8.RuneCountInString(q) > maxSearchQueryRunes {
		return nil, errBad("Từ khoá tối đa " + strconv.Itoa(maxSearchQueryRunes) + " ký tự")
	}
	var terms []string
	seen := map[string]bool{}
	chars := 0
	for _, w := range strings.Fields(foldVN(q)) {
		if len(terms) == maxSearchTerms {
			break
		}
		chars += utf8.RuneCountInString(w)
		if seen[w] {
			continue
		}
		seen[w] = true
		terms = append(terms, w)
	}
	if chars < searchMinChars {
		return nil, errBad("Nhập ít nhất " + strconv.Itoa(searchMinChars) + " ký tự để tìm")
	}
	return terms, nil
}

// searchTSQuery: các từ -> chuỗi cho to_tsquery('simple', ...): mỗi từ khớp tiền tố ('tu':*), nối bằng & (mọi từ phải có).
func searchTSQuery(terms []string) string {
	parts := make([]string, len(terms))
	for i, t := range terms {
		t = strings.ReplaceAll(strings.ReplaceAll(t, `\`, `\\`), `'`, `''`)
		parts[i] = "'" + t + "':*"
	}
	return strings.Join(parts, " & ")
}

// searchEncodeCursor: next_cursor = base64url của "s:<id tin cuối trang>" (chuỗi mờ với client).
func searchEncodeCursor(lastID int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte("s:" + strconv.FormatInt(lastID, 10)))
}

// searchDecodeCursor: "" -> 0 (trang đầu); hỏng -> BAD_REQUEST.
func searchDecodeCursor(s string) (int64, error) {
	if s == "" {
		return 0, nil
	}
	bad := errBad("cursor không hợp lệ")
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return 0, bad
	}
	idStr, ok := strings.CutPrefix(string(b), "s:")
	if !ok {
		return 0, bad
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		return 0, bad
	}
	return id, nil
}

// searchClampLimit: mặc định searchDefaultLimit, tối đa searchMaxLimit.
func searchClampLimit(n int) int {
	if n <= 0 {
		return searchDefaultLimit
	}
	return min(n, searchMaxLimit)
}

// SearchMessages: tìm tin trong một hội thoại (in.ConversationID > 0; không xem được -> 403) hoặc mọi hội thoại tôi đang hoạt
// động / là dòng chỉ đọc của nhóm đã giải tán (ConversationID = 0). Bỏ tin hệ thống và tin đã thu hồi; mới trước.
func (s *Service) SearchMessages(ctx context.Context, uid int64, in SearchInput) (*SearchResult, error) {
	if in.ConversationID < 0 {
		return nil, errBad("conversation_id không hợp lệ")
	}
	terms, err := searchTerms(in.Query)
	if err != nil {
		return nil, err
	}
	before, err := searchDecodeCursor(in.Cursor)
	if err != nil {
		return nil, err
	}
	limit := searchClampLimit(in.Limit)
	if !s.msgSearchLimit.allow(uid) {
		return nil, searchErrRateLimit
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	if in.ConversationID > 0 {
		ok, err := canReadConv(ctx, p, uid, in.ConversationID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errNotMember
		}
	}
	// mb = dòng thành viên của tôi; điều kiện xem được như convVisible (khác alias vì m = chat_messages).
	sql := `select m.id, m.conversation_id, c.conversation_type,
			case when c.conversation_type = 'group' then coalesce(c.name, '') else coalesce((select pu.display_name
				from chat_conversation_members px join chat_users pu on pu.id = px.user_id
				where px.conversation_id = c.id and px.user_id <> $1 order by px.user_id limit 1), '') end,
			m.seq, m.sender_id, u.display_name, m.message_type, m.content, m.file_name, m.created_at
		from chat_messages m
		join chat_conversation_members mb on mb.conversation_id = m.conversation_id and mb.user_id = $1
		join chat_conversations c on c.id = m.conversation_id
		join chat_users u on u.id = m.sender_id
		where ` + searchDocSQL + ` @@ to_tsquery('simple'::regconfig, $2) and ` + searchFilterSQL + `
			and (mb.left_at is null or mb.left_at is not distinct from c.disbanded_at)`
	args := []any{uid, searchTSQuery(terms)}
	if in.ConversationID > 0 {
		args = append(args, in.ConversationID)
		sql += ` and m.conversation_id = $` + strconv.Itoa(len(args))
	}
	if before > 0 {
		args = append(args, before)
		sql += ` and m.id < $` + strconv.Itoa(len(args))
	}
	sql += ` order by m.id desc limit ` + strconv.Itoa(limit+1)
	rows, err := p.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	res := &SearchResult{Hits: []SearchHitDTO{}}
	for rows.Next() {
		var h SearchHitDTO
		var at time.Time
		if err := rows.Scan(&h.MessageID, &h.ConversationID, &h.ConversationType, &h.ConversationName, &h.Seq, &h.SenderID,
			&h.SenderName, &h.MsgType, &h.Content, &h.FileName, &at); err != nil {
			return nil, err
		}
		h.CreatedAt = iso(at)
		res.Hits = append(res.Hits, h)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(res.Hits) > limit {
		res.Hits = res.Hits[:limit]
		c := searchEncodeCursor(res.Hits[limit-1].MessageID)
		res.NextCursor = &c
	}
	return res, nil
}
