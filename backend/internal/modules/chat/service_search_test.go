package chat

import (
	"strings"
	"testing"
)

// Test thuần (không database) của tìm tin: foldVN, searchTerms, searchTSQuery, cursor.

func TestSearchFoldVN(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Báo giá", "bao gia"},
		{"NGUYỄN Văn Đức", "nguyen van duc"},
		{"đĐ", "dd"},
		{"Đường  Ấp-Bắc, NGUYỄN", "duong ap bac nguyen"},
		{"Việt Nam", "viet nam"},                 // NFD
		{"Ừ Ớ", "u o"},                         // NFD hoa: Ừ Ớ
		{"áb", "ab"},                              // dấu tổ hợp giữa hai chữ không tách từ
		{"  bao_gia_Q3.xlsx  ", "bao gia q3 xlsx"}, // tên tệp
		{"Giá: 1.250.000đ!!!", "gia 1 250 000d"},   //
		{"xin chào 😀👍🏻 bạn", "xin chao ban"},       // emoji
		{"❤️", ""},                                 // emoji + VS16
		{"中文 消息", "中文 消息"},                         // CJK giữ nguyên
		{"ÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬ", "aaaaaaaaaaaaaaaaa"}, // 17 chữ a hoa
		{"ÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊ", "eeeeeeeeeeeiiiii"},   //
		{"ÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢ", "ooooooooooooooooo"}, //
		{"ÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ", "uuuuuuuuuuuyyyyy"},   //
		{"", ""},
		{"...", ""},
	}
	for _, c := range cases {
		if got := foldVN(c.in); got != c.want {
			t.Errorf("foldVN(%q) = %q, muốn %q", c.in, got, c.want)
		}
	}
	if n := len([]rune(foldFrom)); n != 67 {
		t.Fatalf("bảng bỏ dấu có %d chữ, muốn 67", n)
	}
}

func TestSearchTerms(t *testing.T) {
	got, err := searchTerms("  Báo   GIÁ báo ")
	if err != nil || strings.Join(got, "|") != "bao|gia" {
		t.Fatalf("searchTerms trùng từ: %v %v", got, err)
	}
	if _, err := searchTerms("a"); codeOf(err) != CodeBadRequest || !strings.Contains(err.Error(), "ít nhất 2 ký tự") {
		t.Fatalf("1 ký tự: %v", err)
	}
	if _, err := searchTerms("!!! ,,, "); codeOf(err) != CodeBadRequest {
		t.Fatalf("chỉ dấu câu: %v", err)
	}
	if got, err := searchTerms("a b"); err != nil || len(got) != 2 {
		t.Fatalf("2 từ 1 ký tự (tổng 2): %v %v", got, err)
	}
	if got, err := searchTerms("đ"); err == nil {
		t.Fatalf("đ 1 ký tự phải lỗi: %v", got)
	}
	if _, err := searchTerms(strings.Repeat("á", 100)); err != nil {
		t.Fatalf("100 ký tự có dấu: %v", err)
	}
	if _, err := searchTerms(strings.Repeat("á", 101)); codeOf(err) != CodeBadRequest || !strings.Contains(err.Error(), "tối đa 100") {
		t.Fatalf("101 ký tự: %v", err)
	}
	got, err = searchTerms("t1 t2 t3 t4 t5 t6 t7 t8 t9 t10")
	if err != nil || len(got) != maxSearchTerms || got[7] != "t8" {
		t.Fatalf("lấy 8 từ đầu: %v %v", got, err)
	}
}

func TestSearchTSQuery(t *testing.T) {
	if q := searchTSQuery([]string{"bao", "gia"}); q != "'bao':* & 'gia':*" {
		t.Fatalf("tsquery: %q", q)
	}
	if q := searchTSQuery([]string{`a'b\c`}); q != `'a''b\\c':*` {
		t.Fatalf("tsquery thoát ký tự: %q", q)
	}
}

func TestSearchCursor(t *testing.T) {
	c := searchEncodeCursor(12345)
	if id, err := searchDecodeCursor(c); err != nil || id != 12345 {
		t.Fatalf("cursor: %d %v", id, err)
	}
	if id, err := searchDecodeCursor(""); err != nil || id != 0 {
		t.Fatalf("cursor rỗng: %d %v", id, err)
	}
	for _, bad := range []string{"@@", "czp4", searchEncodeCursor(0), "eDox"} {
		if _, err := searchDecodeCursor(bad); codeOf(err) != CodeBadRequest {
			t.Errorf("cursor hỏng %q: %v", bad, err)
		}
	}
	if searchClampLimit(0) != searchDefaultLimit || searchClampLimit(500) != searchMaxLimit || searchClampLimit(7) != 7 {
		t.Fatal("searchClampLimit")
	}
}
