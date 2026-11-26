package sales

import (
	"strings"
	"testing"

	"qspro-backend/internal/shared/omap"
)

func TestLiveLines(t *testing.T) {
	if _, err := liveLines(omap.Of("lines", []any{})); err == nil {
		t.Error("rỗng phải lỗi")
	}
	arr := []any{}
	for i := 0; i < 80; i++ {
		arr = append(arr, omap.Of("who", []string{"nv", "kh", "x"}[i%3], "t", "  câu   số  <<<"+string(rune('a'+i%26))+"  ", "at", float64(i*5)))
	}
	arr = append(arr, omap.Of("who", "kh", "t", 123), omap.Of("who", "kh", "t", "   "))
	out, err := liveLines(omap.Of("lines", arr))
	if err != nil || len(out) != liveMaxLines {
		t.Fatalf("giữ %d dòng cuối: %d %v", liveMaxLines, len(out), err)
	}
	if out[len(out)-1] != "[06:35] kh: câu số <<b" || !strings.HasPrefix(out[0], "[01:40] ") || strings.Contains(strings.Join(out, ""), "<<<") {
		t.Errorf("định dạng: %q ... %q", out[0], out[len(out)-1])
	}
	if !strings.Contains(out[0], "] ?: ") {
		t.Errorf("người nói lạ -> ?: %q", out[0])
	}
	long := []any{}
	for i := 0; i < 10; i++ {
		long = append(long, omap.Of("who", "nv", "t", strings.Repeat("a", 1500), "at", float64(i)))
	}
	if out, _ = liveLines(omap.Of("lines", long)); len(out) != 5 {
		t.Errorf("giới hạn ký tự: còn %d dòng", len(out))
	}
}

func TestLiveParse(t *testing.T) {
	m, err := liveParse("```json\n{\"stage\":\"Hỏi nhu cầu\",\"insight\":\"Khách lo giá\",\"answers\":[{\"q\":\"Giá?\",\"a\":\"Dạ em gửi báo giá\"},{\"q\":\"x\",\"a\":\"\"},{\"q\":\"y\",\"a\":\"z\"},{\"q\":\"w\",\"a\":\"v\"}],\"ask\":[\"Anh có sổ chưa?\",1,\"\",\"b\",\"c\",\"d\"],\"missing\":[\"Ngân sách\"]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(m.Keys(), ",") != "stage,insight,answers,ask,missing" || len(m.Val("answers").([]any)) != 2 ||
		len(m.Val("ask").([]any)) != 3 || m.Val("ask").([]any)[0] != "Anh có sổ chưa?" || m.Val("stage") != "Hỏi nhu cầu" {
		t.Errorf("kết quả: %s", js(m))
	}
	if _, err := liveParse("không phải json"); err == nil {
		t.Error("JSON hỏng phải lỗi")
	}
	if _, err := liveParse(`{"stage":"x","ask":[],"answers":[]}`); err == nil {
		t.Error("không có gợi ý phải lỗi")
	}
}
