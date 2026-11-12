package materials

import "testing"

func TestDuyetMsg(t *testing.T) {
	for _, c := range []struct {
		them, sua int
		vd, want  string
	}{
		{12, 3, "Bồn cầu", "lienpham đã thêm 12 SP, sửa 3 SP (vd: Bồn cầu) — đang Chưa duyệt, vào Danh sách sản phẩm lọc Chưa duyệt để duyệt."},
		{0, 1, "", "lienpham đã sửa 1 SP — đang Chưa duyệt, vào Danh sách sản phẩm lọc Chưa duyệt để duyệt."},
		{2, 0, "", "lienpham đã thêm 2 SP — đang Chưa duyệt, vào Danh sách sản phẩm lọc Chưa duyệt để duyệt."},
	} {
		if got := duyetMsg("lienpham", c.them, c.sua, c.vd); got != c.want {
			t.Errorf("%d/%d: %q", c.them, c.sua, got)
		}
	}
}
