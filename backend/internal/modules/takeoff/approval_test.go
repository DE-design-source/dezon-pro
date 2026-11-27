package takeoff

import (
	"context"
	"errors"
	"testing"

	"qspro-backend/internal/server/rpc"
	"qspro-backend/internal/shared/omap"
)

// chuaDuyet: bản thế contracts.ApprovalChecker - mã nằm trong tập là sản phẩm chưa duyệt.
type chuaDuyet struct {
	ma  map[string]bool
	hoi []string
	loi error
}

func (c *chuaDuyet) ChuaDuyet(_ context.Context, ma string) (bool, error) {
	c.hoi = append(c.hoi, ma)
	return c.ma[ma], c.loi
}

func TestAddLineGatedChuaDuyet(t *testing.T) {
	ctx := context.Background()
	ck := &chuaDuyet{ma: map[string]bool{"SP_CHO": true}}
	f := &fakeRepo{}
	svc := New(Deps{Repo: f, Perms: stubPerms{}, Saver: &stubSaver{}, Approval: ck})
	reg := rpc.NewRegistry()
	svc.RegisterRPC(reg)

	// sản phẩm chưa duyệt: lỗi, không ghi gì
	if _, err := reg.Call(ctx, "addLine", nil, "DA1", omap.Of("ma", "SP_CHO", "ten", "A"), 1.0); err == nil || err.Error() != msgChuaDuyet {
		t.Fatalf("addLine SP chưa duyệt: %v", err)
	}
	if len(f.log) != 0 {
		t.Errorf("đã đụng repo: %v", f.log)
	}
	// sản phẩm đã duyệt / dòng tự nhập (không mã) / dòng trống: thêm bình thường
	for _, p := range []any{omap.Of("ma", "SP_OK", "ten", "B"), omap.Of("ten", "C"), nil} {
		if _, err := svc.AddLineGated(ctx, "DA1", p, 1.0); err != nil {
			t.Errorf("%v: %v", p, err)
		}
	}
	if _, err := svc.AddBlankLine(ctx, "DA1", nil); err != nil {
		t.Errorf("dòng trống: %v", err)
	}
	if got := len(ck.hoi); got != 3 { // SP_CHO, SP_OK, "" (AddBlankLine gọi thẳng hàm lõi)
		t.Errorf("số lần hỏi duyệt = %d (%v)", got, ck.hoi)
	}
	// lỗi đọc danh mục trả nguyên
	ck.loi = errors.New("db hỏng")
	if _, err := svc.AddLineGated(ctx, "DA1", omap.Of("ma", "SP_OK"), 1.0); err == nil || err.Error() != "db hỏng" {
		t.Errorf("lỗi đọc danh mục: %v", err)
	}
	// không nối Approval (test golden): không kiểm
	svc2 := New(Deps{Repo: &fakeRepo{}, Perms: stubPerms{}, Saver: &stubSaver{}})
	if _, err := svc2.AddLineGated(ctx, "DA1", omap.Of("ma", "SP_CHO"), 1.0); err != nil {
		t.Errorf("không có Approval: %v", err)
	}
}
