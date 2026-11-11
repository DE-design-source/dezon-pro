package chat

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Test có database của tìm tin (service_search.go): bỏ dấu tiếng Việt, phạm vi thành viên, bỏ tin hệ thống / thu hồi,
// phân trang, nhảy tới tin.

// searchCorpus: chuỗi đối chiếu foldVN (Go) với chat_search_fold (SQL).
var searchCorpus = []string{
	"Báo giá Q3", "BÁO GIÁ", "báo giá", "Bao Gia", "NGUYỄN Văn Đức", "nguyễn văn đức", "đĐ đường ĐƯỜNG",
	"Đường  Ấp-Bắc, NGUYỄN", "Việt Nam", "VIỆT NAM", "Ừ ớ ắ ễ",
	"áb", "Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ ấ ầ ẩ ẫ ậ ế ề ể ễ ệ ố ồ ổ ỗ ộ ớ ờ ở ỡ ợ ứ ừ ử ữ ự ỳ ỷ ỹ ỵ ý",
	"ÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ",
	"  bao_gia_Q3.xlsx  ", "Giá: 1.250.000đ!!! (đã gồm VAT 10%)", "email@dezon.vn / https://dezon.vn/a?b=c#d",
	"tab\tnew\nline\r\nend", "xin chào 😀👍🏻 bạn ❤️ 👨‍👩‍👧", "❤️", "中文 消息 日本語のテキスト 한국어", "Ｆｕｌｌｗｉｄｔｈ ＡＢＣ １２３",
	"Ñandú Ärger Öl Übung ß Ç ç", "Σίσυφος ΑΘΗΝΑ", "Москва ПРИВЕТ", "", "...", "---a---", "a  b", "x_y-z.w",
	"«quotes» “smart” ‘single’ — dash … ellipsis", "1/2 3,5 4.000 50% #tag @mention $100",
}

func TestSearchFoldParityDB(t *testing.T) {
	e := newEnv(t, envOpt{noGateway: true})
	ctx := context.Background()
	for _, s := range searchCorpus {
		var got string
		if err := e.pool.QueryRow(ctx, `select chat_search_fold($1::text)`, s).Scan(&got); err != nil {
			t.Fatalf("chat_search_fold(%q): %v", s, err)
		}
		if want := foldVN(s); got != want {
			t.Errorf("lệch Go / SQL với %q: SQL %q, Go %q", s, got, want)
		}
	}
}

// searchDo: SearchMessages sau khi đẩy đồng hồ 2 giây (không chạm hạn mức 30 lần tìm / phút).
func searchDo(e *env, uid int64, in SearchInput) (*SearchResult, error) {
	e.clk.add(2 * time.Second)
	return e.s.SearchMessages(context.Background(), uid, in)
}

// searchIDs: id các tin trong kết quả (đúng thứ tự).
func searchIDs(r *SearchResult) []int64 {
	out := make([]int64, 0, len(r.Hits))
	for _, h := range r.Hits {
		out = append(out, h.MessageID)
	}
	return out
}

func searchSame(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSearchMessagesDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan, binh, chau, la := e.user("Lan"), e.user("Bình Nguyễn"), e.user("Châu"), e.user("Người lạ")
	e.friends(lan, binh)
	e.friends(lan, chau)
	g, err := e.s.CreateGroup(ctx, lan.id, "Dự án Kho Đức Hòa", []int64{binh.id, chau.id})
	if err != nil {
		t.Fatal(err)
	}
	d, err := e.s.CreateDirect(ctx, lan.id, binh.id)
	if err != nil {
		t.Fatal(err)
	}
	m1 := e.send(lan, g.ID, "Gửi anh Báo giá Q3 nhé")
	m2 := e.send(binh, g.ID, "BÁO GIÁ đã nhận, cảm ơn NGUYỄN")
	m3 := e.send(chau, g.ID, "Hôm nay trời đẹp")
	m4 := e.send(lan, d.ID, "Bình xem lại báo giá giúp mình")
	m5 := e.send(binh, g.ID, "Việt Nam - Đường Ấp Bắc") // NFD
	f := e.readyMedia(binh.id, MediaFile)
	fm, err := e.s.SendMessage(ctx, binh.id, SendInput{ConversationID: g.ID, ClientMsgID: newUUID(), MsgType: MediaFile,
		Attachments: []int64{f}, FileName: "Bao_gia_kho_2026.xlsx"})
	if err != nil {
		t.Fatal(err)
	}
	rc := e.send(chau, g.ID, "báo giá cũ sai, bỏ qua")
	// thu hồi (như RecallMessage: xoá nội dung) -> không ra trong tìm kiếm; thêm 1 tin thu hồi còn giữ chữ cũ ở nơi khác
	if _, err := e.pool.Exec(ctx, `update chat_messages set content = '', mentions = null, media_id = null, file_name = null,
		recalled_at = now(), recalled_by = sender_id, updated_at = now() where id = $1`, rc.MessageID); err != nil {
		t.Fatal(err)
	}

	// trong một hội thoại: bỏ dấu, hoa thường, tiền tố, mọi từ (AND), thứ tự tuỳ ý; mới trước
	cases := []struct {
		q    string
		want []int64
	}{
		{"bao gia", []int64{fm.MessageID, m2.MessageID, m1.MessageID}},
		{"BÁO GIÁ", []int64{fm.MessageID, m2.MessageID, m1.MessageID}},
		{"bao gi", []int64{fm.MessageID, m2.MessageID, m1.MessageID}},
		{"gia bao", []int64{fm.MessageID, m2.MessageID, m1.MessageID}},
		{"báo giá", []int64{fm.MessageID, m2.MessageID, m1.MessageID}}, // truy vấn NFD
		{"nguyen", []int64{m2.MessageID}},
		{"Nguyễn cảm", []int64{m2.MessageID}},
		{"bao q3", []int64{m1.MessageID}},
		{"xlsx", []int64{fm.MessageID}},
		{"kho 2026", []int64{fm.MessageID}},
		{"viet nam", []int64{m5.MessageID}},
		{"Việt", []int64{m5.MessageID}},
		{"duong ap", []int64{m5.MessageID}},
		{"đường", []int64{m5.MessageID}},
		{"troi dep", []int64{m3.MessageID}},
		{"tao nhom", nil}, // tin hệ thống "Lan đã tạo nhóm ..." không ra
		{"duc hoa", nil},  // tên nhóm chỉ có trong tin hệ thống
		{"sai bo qua", nil},
		{"bao giax", nil},
		{"xem lai", nil}, // tin ở chat 1-1, không ở nhóm này
	}
	for _, c := range cases {
		r, err := searchDo(e, binh.id, SearchInput{ConversationID: g.ID, Query: c.q})
		if err != nil {
			t.Fatalf("tìm %q: %v", c.q, err)
		}
		if !searchSame(searchIDs(r), c.want) || r.NextCursor != nil {
			t.Errorf("tìm %q: %v (cursor %v), muốn %v", c.q, searchIDs(r), r.NextCursor, c.want)
		}
	}

	// nội dung kết quả
	r, err := searchDo(e, chau.id, SearchInput{ConversationID: g.ID, Query: "xlsx"})
	if err != nil || len(r.Hits) != 1 {
		t.Fatalf("tìm tệp: %+v %v", r, err)
	}
	h := r.Hits[0]
	if h.ConversationID != g.ID || h.ConversationType != "group" || h.ConversationName != "Dự án Kho Đức Hòa" || h.Seq != fm.Seq ||
		h.SenderID != binh.id || h.SenderName != "Bình Nguyễn" || h.MsgType != MediaFile || h.Content != "" ||
		h.FileName == nil || *h.FileName != "Bao_gia_kho_2026.xlsx" || h.CreatedAt == "" {
		t.Fatalf("hit tệp: %+v", h)
	}

	// mọi hội thoại: gồm chat 1-1 (tên = người kia), mới trước
	r, err = searchDo(e, lan.id, SearchInput{Query: "bao gia"})
	if err != nil || !searchSame(searchIDs(r), []int64{fm.MessageID, m4.MessageID, m2.MessageID, m1.MessageID}) {
		t.Fatalf("tìm mọi hội thoại (Lan): %v %v", searchIDs(r), err)
	}
	if r.Hits[1].ConversationID != d.ID || r.Hits[1].ConversationType != "direct" || r.Hits[1].ConversationName != "Bình Nguyễn" {
		t.Fatalf("hit chat 1-1 nhìn từ Lan: %+v", r.Hits[1])
	}
	r, err = searchDo(e, binh.id, SearchInput{Query: "xem lai bao"})
	if err != nil || len(r.Hits) != 1 || r.Hits[0].MessageID != m4.MessageID || r.Hits[0].ConversationName != "Lan" {
		t.Fatalf("hit chat 1-1 nhìn từ Bình: %+v %v", r, err)
	}
	// Châu không ở chat 1-1 của Lan - Bình
	r, err = searchDo(e, chau.id, SearchInput{Query: "bao gia"})
	if err != nil || !searchSame(searchIDs(r), []int64{fm.MessageID, m2.MessageID, m1.MessageID}) {
		t.Fatalf("tìm mọi hội thoại (Châu): %v %v", searchIDs(r), err)
	}
	// người ngoài: hội thoại cụ thể -> 403; tìm chung -> rỗng
	_, err = searchDo(e, la.id, SearchInput{ConversationID: g.ID, Query: "bao gia"})
	wantCode(t, "người ngoài tìm trong nhóm", err, CodeForbidden)
	_, err = searchDo(e, la.id, SearchInput{ConversationID: 1 << 40, Query: "bao gia"})
	wantCode(t, "hội thoại không có", err, CodeForbidden)
	if r, err = searchDo(e, la.id, SearchInput{Query: "bao gia"}); err != nil || len(r.Hits) != 0 || r.NextCursor != nil {
		t.Fatalf("người ngoài tìm chung: %+v %v", r, err)
	}

	// nhảy tới tin: seq của kết quả mở đúng tin
	r, err = searchDo(e, chau.id, SearchInput{ConversationID: g.ID, Query: "nguyen"})
	if err != nil || len(r.Hits) != 1 {
		t.Fatalf("tìm nguyen: %+v %v", r, err)
	}
	prev := r.Hits[0].Seq - 1
	pg, err := e.s.Messages(ctx, chau.id, g.ID, nil, &prev, 1)
	if err != nil || len(pg.Messages) != 1 || pg.Messages[0].ID != m2.MessageID || pg.Messages[0].Seq != r.Hits[0].Seq {
		t.Fatalf("mở tin theo seq: %+v %v", pg, err)
	}

	// dữ liệu vào sai
	for _, q := range []string{"", " ", "a", "!!", "đ", strings.Repeat("x", 101)} {
		_, err = searchDo(e, lan.id, SearchInput{ConversationID: g.ID, Query: q})
		wantCode(t, "q sai "+q, err, CodeBadRequest)
	}
	_, err = searchDo(e, lan.id, SearchInput{Query: "bao gia", Cursor: "hỏng"})
	wantCode(t, "cursor hỏng", err, CodeBadRequest)

	// rời nhóm: hết tìm được tin cũ (cả chung lẫn riêng)
	if err := e.s.RemoveMember(ctx, chau.id, g.ID, chau.id); err != nil {
		t.Fatal(err)
	}
	_, err = searchDo(e, chau.id, SearchInput{ConversationID: g.ID, Query: "bao gia"})
	wantCode(t, "đã rời tìm trong nhóm", err, CodeForbidden)
	if r, err = searchDo(e, chau.id, SearchInput{Query: "bao gia"}); err != nil || len(r.Hits) != 0 {
		t.Fatalf("đã rời tìm chung: %v %v", searchIDs(r), err)
	}

	// giải tán: dòng chỉ đọc vẫn tìm được
	if err := e.s.DisbandGroup(ctx, lan.id, g.ID); err != nil {
		t.Fatal(err)
	}
	if r, err = searchDo(e, binh.id, SearchInput{ConversationID: g.ID, Query: "bao gia"}); err != nil ||
		!searchSame(searchIDs(r), []int64{fm.MessageID, m2.MessageID, m1.MessageID}) {
		t.Fatalf("nhóm đã giải tán (trong nhóm): %v %v", searchIDs(r), err)
	}
	if r, err = searchDo(e, binh.id, SearchInput{Query: "bao gia"}); err != nil ||
		!searchSame(searchIDs(r), []int64{fm.MessageID, m4.MessageID, m2.MessageID, m1.MessageID}) {
		t.Fatalf("nhóm đã giải tán (tìm chung): %v %v", searchIDs(r), err)
	}
}

func TestSearchMessagesPagingDB(t *testing.T) {
	e := newEnv(t, envOpt{noGateway: true})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bảo")
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	var want []int64 // mới trước
	for i := 0; i < 25; i++ {
		if i%10 == 9 {
			e.clk.add(2 * time.Second) // hạn mức gửi 20 tin / giây
		}
		ack := e.send(a, d.ID, "Hợp đồng số "+string(rune('A'+i)))
		want = append([]int64{ack.MessageID}, want...)
		if i%5 == 0 {
			e.send(b, d.ID, "tin khác")
		}
	}
	var got []int64
	cursor := ""
	pages := 0
	for {
		r, err := searchDo(e, b.id, SearchInput{ConversationID: d.ID, Query: "hop dong", Cursor: cursor, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		pages++
		got = append(got, searchIDs(r)...)
		if r.NextCursor == nil {
			break
		}
		if len(r.Hits) != 10 {
			t.Fatalf("trang %d có %d tin", pages, len(r.Hits))
		}
		cursor = *r.NextCursor
		if pages > 5 {
			t.Fatal("phân trang không dừng")
		}
	}
	if pages != 3 || !searchSame(got, want) {
		t.Fatalf("phân trang: %d trang, %v, muốn %v", pages, got, want)
	}
	r, err := searchDo(e, a.id, SearchInput{Query: "hop dong", Limit: 1000})
	if err != nil || len(r.Hits) != 25 || r.NextCursor != nil {
		t.Fatalf("limit 1000: %d %v %v", len(r.Hits), r.NextCursor, err)
	}
	r, err = searchDo(e, a.id, SearchInput{Query: "hop dong"})
	if err != nil || len(r.Hits) != searchDefaultLimit || r.NextCursor == nil {
		t.Fatalf("limit mặc định: %d %v %v", len(r.Hits), r.NextCursor, err)
	}
}

func TestSearchMessagesRateLimitDB(t *testing.T) {
	e := newEnv(t, envOpt{noGateway: true})
	ctx := context.Background()
	a, b := e.user("An"), e.user("Bảo")
	d, err := e.s.CreateDirect(ctx, a.id, b.id)
	if err != nil {
		t.Fatal(err)
	}
	e.send(a, d.ID, "xin chào")
	for i := 0; i < 30; i++ {
		if _, err := e.s.SearchMessages(ctx, a.id, SearchInput{Query: "xin chao"}); err != nil {
			t.Fatalf("lần %d: %v", i+1, err)
		}
	}
	_, err = e.s.SearchMessages(ctx, a.id, SearchInput{Query: "xin chao"})
	wantCode(t, "lần tìm thứ 31 trong 1 phút", err, CodeRateLimit)
	if !strings.Contains(err.Error(), "tìm kiếm quá nhanh") {
		t.Fatalf("câu lỗi: %v", err)
	}
	// người khác không bị ảnh hưởng; 2 giây sau có lại 1 lượt
	if _, err := e.s.SearchMessages(ctx, b.id, SearchInput{Query: "xin chao"}); err != nil {
		t.Fatal(err)
	}
	e.clk.add(2 * time.Second)
	if _, err := e.s.SearchMessages(ctx, a.id, SearchInput{Query: "xin chao"}); err != nil {
		t.Fatalf("sau 2 giây: %v", err)
	}
}
