package chat

import (
	"context"
	"testing"
	"time"
)

func reactRequireSchema(t *testing.T, e *env) {
	t.Helper()
	var ok bool
	if err := e.pool.QueryRow(context.Background(), `select to_regclass('public.chat_message_reactions') is not null`).Scan(&ok); err != nil || !ok {
		t.Fatalf("database thử chưa có bảng chat_message_reactions (áp 0023_chat_phase2.sql): %v", err)
	}
}

// reactWantSum: so tổng hợp reaction.
func reactWantSum(t *testing.T, what string, got *ReactionSummaryDTO, want map[string]int64, mine string) {
	t.Helper()
	if got == nil || got.Counts == nil {
		t.Fatalf("%s: tổng hợp nil / counts nil: %+v", what, got)
	}
	var total int64
	for k, v := range want {
		total += v
		if got.Counts[k] != v {
			t.Fatalf("%s: counts %v, muốn %v", what, got.Counts, want)
		}
	}
	if len(got.Counts) != len(want) || got.Total != total {
		t.Fatalf("%s: counts %v total %d, muốn %v", what, got.Counts, got.Total, want)
	}
	if (mine == "") != (got.Mine == nil) || (got.Mine != nil && *got.Mine != mine) {
		t.Fatalf("%s: mine %v, muốn %q", what, got.Mine, mine)
	}
}

// reactEvents: các gói reactions.updated đã gửi (xoá danh sách gói).
func reactEvents(t *testing.T, e *env) []ReactionsUpdatedEvent {
	t.Helper()
	var out []ReactionsUpdatedEvent
	for _, p := range e.gw.packets(EvReactionsUpdated, true) {
		ev, ok := p.data.(ReactionsUpdatedEvent)
		if !ok {
			t.Fatalf("data của reactions.updated: %T", p.data)
		}
		out = append(out, ev)
	}
	return out
}

// reactUpdatedAt: chat_messages.updated_at + chat_conversations.updated_at.
func reactUpdatedAt(t *testing.T, e *env, msgID int64) (*time.Time, time.Time) {
	t.Helper()
	var m *time.Time
	var c time.Time
	if err := e.pool.QueryRow(context.Background(), `select m.updated_at, c.updated_at from chat_messages m
		join chat_conversations c on c.id = m.conversation_id where m.id = $1`, msgID).Scan(&m, &c); err != nil {
		t.Fatal(err)
	}
	return m, c
}

// Reaction trong nhóm: đặt / thay / giống cũ / bỏ / idempotent, tổng hợp theo người xem, danh sách người thả, reactions.updated,
// updated_at của tin + hội thoại, member vẫn thả được khi admins_only_send, code sai, tin hệ thống, tin đã thu hồi, người ngoài,
// đã rời, nhóm đã giải tán.
func TestReactionsGroupDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	reactRequireSchema(t, e)
	ctx := context.Background()
	lan, binh, chau, dung := e.user("Lan"), e.user("Bình"), e.user("Châu"), e.user("Dũng")
	e.friends(lan, binh)
	e.friends(lan, chau)
	e.friends(lan, dung)
	g, err := e.s.CreateGroup(ctx, lan.id, "Nhóm cảm xúc", []int64{binh.id, chau.id, dung.id})
	if err != nil {
		t.Fatal(err)
	}
	ack := e.send(binh, g.ID, "Báo giá xong rồi")
	plain := e.send(binh, g.ID, "chưa ai thả")
	e.gw.packets("", true)
	if mu, _ := reactUpdatedAt(t, e, ack.MessageID); mu != nil {
		t.Fatalf("tin mới đã có updated_at: %v", mu)
	}
	_, convBefore := reactUpdatedAt(t, e, ack.MessageID)

	// đặt
	sum, err := e.s.SetReaction(ctx, chau.id, ack.MessageID, "like")
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "Châu thả like", sum, map[string]int64{"like": 1}, "like")
	evs := reactEvents(t, e)
	if len(evs) != 1 {
		t.Fatalf("reactions.updated: %d gói", len(evs))
	}
	ev := evs[0]
	if ev.ConversationID != g.ID || ev.MessageID != ack.MessageID || ev.Seq != ack.Seq || ev.UserID != chau.id ||
		ev.Reaction == nil || *ev.Reaction != "like" || ev.Total != 1 || ev.Counts["like"] != 1 {
		t.Fatalf("data reactions.updated: %+v", ev)
	}
	mu, convAfter := reactUpdatedAt(t, e, ack.MessageID)
	if mu == nil || convAfter.Before(convBefore) || convAfter.Equal(convBefore) {
		t.Fatalf("updated_at sau khi thả: tin %v, hội thoại %v -> %v", mu, convBefore, convAfter)
	}

	// người nhận gói: mọi thành viên đang hoạt động (cả người thả)
	if _, err := e.s.SetReaction(ctx, lan.id, ack.MessageID, "love"); err != nil {
		t.Fatal(err)
	}
	pk := e.gw.packets(EvReactionsUpdated, false)
	if len(pk) != 1 || len(pk[0].users) != 4 {
		t.Fatalf("người nhận reactions.updated: %+v", pk)
	}
	reactEvents(t, e)

	// thay reaction
	sum, err = e.s.SetReaction(ctx, chau.id, ack.MessageID, "haha")
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "Châu đổi sang haha", sum, map[string]int64{"love": 1, "haha": 1}, "haha")
	if evs := reactEvents(t, e); len(evs) != 1 || *evs[0].Reaction != "haha" || evs[0].Counts["like"] != 0 || len(evs[0].Counts) != 2 {
		t.Fatalf("gói khi đổi reaction: %+v", evs)
	}

	// giống cũ: không đổi, không gói, updated_at giữ nguyên
	mu1, _ := reactUpdatedAt(t, e, ack.MessageID)
	sum, err = e.s.SetReaction(ctx, chau.id, ack.MessageID, "haha")
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "thả lại haha", sum, map[string]int64{"love": 1, "haha": 1}, "haha")
	if evs := reactEvents(t, e); len(evs) != 0 {
		t.Fatalf("thả lại giống cũ không được gửi gói: %+v", evs)
	}
	if mu2, _ := reactUpdatedAt(t, e, ack.MessageID); !mu2.Equal(*mu1) {
		t.Fatalf("thả lại giống cũ đổi updated_at: %v -> %v", mu1, mu2)
	}

	// tổng hợp theo người xem; tin không có reaction không có trong map
	m, err := e.s.reactionSummaries(ctx, e.pool, binh.id, []int64{ack.MessageID, plain.MessageID})
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "Bình xem", m[ack.MessageID], map[string]int64{"love": 1, "haha": 1}, "")
	if _, ok := m[plain.MessageID]; ok || len(m) != 1 {
		t.Fatalf("tin chưa có reaction không được có trong map: %+v", m)
	}
	m, _ = e.s.reactionSummaries(ctx, e.pool, lan.id, []int64{ack.MessageID})
	reactWantSum(t, "Lan xem", m[ack.MessageID], map[string]int64{"love": 1, "haha": 1}, "love")
	if m, err := e.s.reactionSummaries(ctx, e.pool, lan.id, nil); err != nil || m == nil || len(m) != 0 {
		t.Fatalf("danh sách rỗng: %+v %v", m, err)
	}

	// danh sách người thả: mới trước
	list, err := e.s.Reactions(ctx, binh.id, ack.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	if list.MessageID != ack.MessageID || len(list.Reactions) != 2 || list.Reactions[0].UserID != chau.id ||
		list.Reactions[0].DisplayName != "Châu" || list.Reactions[0].Reaction != "haha" || list.Reactions[0].CreatedAt == "" ||
		list.Reactions[1].UserID != lan.id || list.Reactions[1].Reaction != "love" {
		t.Fatalf("danh sách reaction: %+v", list)
	}
	if list, err := e.s.Reactions(ctx, binh.id, plain.MessageID); err != nil || list.Reactions == nil || len(list.Reactions) != 0 {
		t.Fatalf("danh sách rỗng phải là []: %+v %v", list, err)
	}

	// bỏ; bỏ lại = idempotent, không gói
	sum, err = e.s.RemoveReaction(ctx, chau.id, ack.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "Châu bỏ", sum, map[string]int64{"love": 1}, "")
	if evs := reactEvents(t, e); len(evs) != 1 || evs[0].Reaction != nil || evs[0].UserID != chau.id || evs[0].Total != 1 {
		t.Fatalf("gói khi bỏ: %+v", evs)
	}
	sum, err = e.s.RemoveReaction(ctx, chau.id, ack.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "bỏ lại", sum, map[string]int64{"love": 1}, "")
	if evs := reactEvents(t, e); len(evs) != 0 {
		t.Fatalf("bỏ lại không được gửi gói: %+v", evs)
	}
	sum, err = e.s.RemoveReaction(ctx, lan.id, ack.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	reactWantSum(t, "bỏ hết", sum, map[string]int64{}, "")
	if evs := reactEvents(t, e); len(evs) != 1 || evs[0].Total != 0 || evs[0].Counts == nil || len(evs[0].Counts) != 0 {
		t.Fatalf("gói khi bỏ hết: %+v", evs)
	}

	// code sai (phân biệt hoa thường) / rỗng
	for _, bad := range []string{"", "LIKE", "👍", "heart"} {
		_, err = e.s.SetReaction(ctx, chau.id, ack.MessageID, bad)
		wantCode(t, "code "+bad, err, CodeBadRequest)
	}

	// tin không có / người ngoài nhóm -> 404 (không lộ tin)
	_, err = e.s.SetReaction(ctx, chau.id, 0, "like")
	wantCode(t, "tin id 0", err, CodeNotFound)
	_, err = e.s.SetReaction(ctx, chau.id, ack.MessageID+1_000_000_000, "like")
	wantCode(t, "tin không có", err, CodeNotFound)
	ngoai := e.user("Người ngoài")
	_, err = e.s.SetReaction(ctx, ngoai.id, ack.MessageID, "like")
	wantCode(t, "người ngoài thả", err, CodeNotFound)
	_, err = e.s.Reactions(ctx, ngoai.id, ack.MessageID)
	wantCode(t, "người ngoài xem", err, CodeNotFound)
	_, err = e.s.RemoveReaction(ctx, ngoai.id, ack.MessageID)
	wantCode(t, "người ngoài bỏ", err, CodeNotFound)

	// tin hệ thống
	var sysID int64
	if err := e.pool.QueryRow(ctx, `select id from chat_messages where conversation_id = $1 and message_type = 'system' limit 1`,
		g.ID).Scan(&sysID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SetReaction(ctx, chau.id, sysID, "like")
	wantCode(t, "tin hệ thống", err, CodeBadRequest)

	// member vẫn thả được khi nhóm bật admins_only_send
	yes := true
	if _, err := e.s.UpdateGroupSettings(ctx, lan.id, g.ID, GroupSettingsPatch{AdminsOnlySend: &yes}); err != nil {
		t.Fatal(err)
	}
	if sum, err = e.s.SetReaction(ctx, dung.id, ack.MessageID, "wow"); err != nil {
		t.Fatalf("member thả khi admins_only_send: %v", err)
	}
	reactWantSum(t, "Dũng thả wow", sum, map[string]int64{"wow": 1}, "wow")

	// tin đã thu hồi: 410 (thu hồi giả bằng SQL - phần thu hồi thật của BE-MSG xoá reaction)
	rec := e.send(lan, g.ID, "sẽ thu hồi")
	if _, err := e.pool.Exec(ctx, `update chat_messages set content = '', mentions = null, recalled_at = now(), recalled_by = sender_id,
		updated_at = now() where id = $1`, rec.MessageID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SetReaction(ctx, chau.id, rec.MessageID, "like")
	wantCode(t, "thả tin đã thu hồi", err, CodeMessageRecalled)
	_, err = e.s.RemoveReaction(ctx, chau.id, rec.MessageID)
	wantCode(t, "bỏ trên tin đã thu hồi", err, CodeMessageRecalled)
	if list, err := e.s.Reactions(ctx, chau.id, rec.MessageID); err != nil || len(list.Reactions) != 0 {
		t.Fatalf("xem reaction tin đã thu hồi: %+v %v", list, err)
	}

	// đã rời nhóm -> 403
	if err := e.s.RemoveMember(ctx, chau.id, g.ID, chau.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SetReaction(ctx, chau.id, ack.MessageID, "like")
	wantCode(t, "đã rời thả", err, CodeForbidden)
	_, err = e.s.Reactions(ctx, chau.id, ack.MessageID)
	wantCode(t, "đã rời xem", err, CodeForbidden)
	e.gw.packets("", true)

	// nhóm đã giải tán: ghi -> 410, xem vẫn được (dòng chỉ đọc)
	if err := e.s.DisbandGroup(ctx, lan.id, g.ID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SetReaction(ctx, binh.id, ack.MessageID, "like")
	wantCode(t, "thả trên nhóm đã giải tán", err, CodeGroupDisbanded)
	_, err = e.s.RemoveReaction(ctx, dung.id, ack.MessageID)
	wantCode(t, "bỏ trên nhóm đã giải tán", err, CodeGroupDisbanded)
	if list, err := e.s.Reactions(ctx, binh.id, ack.MessageID); err != nil || len(list.Reactions) != 1 || list.Reactions[0].UserID != dung.id {
		t.Fatalf("xem reaction nhóm đã giải tán: %+v %v", list, err)
	}
	if evs := reactEvents(t, e); len(evs) != 0 {
		t.Fatalf("lỗi không được gửi gói: %+v", evs)
	}
}

// Reaction chat 1-1: cả hai bên thả được; đang chặn (bên nào chặn cũng vậy) -> BLOCKED; xem vẫn được.
func TestReactionsDirectBlockDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	reactRequireSchema(t, e)
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")
	e.friends(lan, binh)
	d, err := e.s.CreateDirect(ctx, lan.id, binh.id)
	if err != nil {
		t.Fatal(err)
	}
	ack := e.send(binh, d.ID, "chào")
	e.gw.packets("", true)
	if _, err := e.s.SetReaction(ctx, lan.id, ack.MessageID, "love"); err != nil {
		t.Fatal(err)
	}
	if sum, err := e.s.SetReaction(ctx, binh.id, ack.MessageID, "love"); err != nil {
		t.Fatal(err)
	} else {
		reactWantSum(t, "hai bên love", sum, map[string]int64{"love": 2}, "love")
	}
	if pk := e.gw.packets(EvReactionsUpdated, true); len(pk) != 2 || len(pk[1].users) != 2 {
		t.Fatalf("reactions.updated chat 1-1: %+v", pk)
	}

	if err := e.s.Block(ctx, lan.id, binh.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SetReaction(ctx, binh.id, ack.MessageID, "angry")
	wantCode(t, "bị chặn thả", err, CodeBlocked)
	_, err = e.s.RemoveReaction(ctx, lan.id, ack.MessageID)
	wantCode(t, "người chặn bỏ", err, CodeBlocked)
	if list, err := e.s.Reactions(ctx, binh.id, ack.MessageID); err != nil || len(list.Reactions) != 2 {
		t.Fatalf("xem reaction khi đang chặn: %+v %v", list, err)
	}
}

// Hạn mức reaction (đặt + bỏ dùng chung s.reactLimit).
func TestReactionsRateLimitDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	reactRequireSchema(t, e)
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")
	e.friends(lan, binh)
	d, err := e.s.CreateDirect(ctx, lan.id, binh.id)
	if err != nil {
		t.Fatal(err)
	}
	ack := e.send(binh, d.ID, "chào")
	e.s.reactLimit = newLimiter(2, time.Minute, e.s.now)
	if _, err := e.s.SetReaction(ctx, lan.id, ack.MessageID, "like"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.RemoveReaction(ctx, lan.id, ack.MessageID); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.SetReaction(ctx, lan.id, ack.MessageID, "like")
	wantCode(t, "quá hạn mức", err, CodeRateLimit)
	// người khác không bị ảnh hưởng
	if _, err := e.s.SetReaction(ctx, binh.id, ack.MessageID, "like"); err != nil {
		t.Fatal(err)
	}
}

// Thả cảm xúc song song trên cùng một tin không deadlock, tổng đúng.
func TestReactionsConcurrentDB(t *testing.T) {
	e := newEnv(t, envOpt{})
	reactRequireSchema(t, e)
	ctx := context.Background()
	owner := e.user("Chủ")
	var others []*tu
	var ids []int64
	for i := 0; i < 6; i++ {
		u := e.user("Người " + itoa(int64(i)))
		e.friends(owner, u)
		others = append(others, u)
		ids = append(ids, u.id)
	}
	g, err := e.s.CreateGroup(ctx, owner.id, "Nhóm đông", ids)
	if err != nil {
		t.Fatal(err)
	}
	ack := e.send(owner, g.ID, "thả đi")
	errs := make(chan error, len(others))
	for i, u := range others {
		go func(uid int64, code string) {
			_, err := e.s.SetReaction(ctx, uid, ack.MessageID, code)
			errs <- err
		}(u.id, ReactionCodes[i%len(ReactionCodes)])
	}
	for range others {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	m, err := e.s.reactionSummaries(ctx, e.pool, owner.id, []int64{ack.MessageID})
	if err != nil || m[ack.MessageID] == nil || m[ack.MessageID].Total != int64(len(others)) || m[ack.MessageID].Mine != nil {
		t.Fatalf("tổng sau khi thả song song: %+v %v", m[ack.MessageID], err)
	}
}
