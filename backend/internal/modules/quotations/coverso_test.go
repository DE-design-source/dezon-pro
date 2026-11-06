package quotations

import (
	"testing"

	"qspro-backend/internal/shared/omap"
)

// coverSoLai: các mục còn hiện sau khi ẩn được đánh lại liên tục (1, 1.1, 1.1.1…), khớp coverSoLai_ của frontend (lib/quote.js).
func TestCoverSoLai(t *testing.T) {
	rows := []any{}
	for _, s := range []string{"3", "3.2", "3.2.6", "3.2.7", "5", "5.1", "5.3"} {
		rows = append(rows, omap.Of("stt", s))
	}
	got := coverSoLai(rows)
	want := map[string]string{"3": "1", "3.2": "1.1", "3.2.6": "1.1.1", "3.2.7": "1.1.2", "5": "2", "5.1": "2.1", "5.3": "2.2"}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("coverSoLai[%s] = %q, muốn %q", k, got[k], v)
		}
	}
	// tổ tiên trực tiếp không có mặt (vd 4.1 vắng, chỉ còn 4.1.2) -> đánh theo tổ tiên gần nhất có mặt
	got = coverSoLai([]any{omap.Of("stt", "4"), omap.Of("stt", "4.1.2")})
	if got["4"] != "1" || got["4.1.2"] != "1.1" {
		t.Errorf("thiếu mục cha: %v", got)
	}
}
