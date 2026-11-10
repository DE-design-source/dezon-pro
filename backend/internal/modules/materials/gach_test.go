package materials

import (
	"testing"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Gạch ốp lát (chỉ bản Go): ngành / đề mục tự nhận theo hạng mục; THÔNG TIN CHÍNH = cột M, THÔNG SỐ THIẾT KẾ = cột O của file gạch.
func TestProdToObjGach(t *testing.T) {
	p := prodToObj(omap.Of("ma_sp", "VD-6120-01", "ten_sp", "Gạch porcelain lát nền VD-6120-01", "dong_sp", "Gạch porcelain lát nền",
		"hang_muc", "Gạch lát nền", "kich_thuoc", "600 x 1200 (mm)", "be_mat", "Men mờ (Matt)", "xuong_gach", "Porcelain đồng chất (Granite)",
		"mau_sac", "Vân đá marble trắng xám", "do_day", "9 mm", "do_hut_nuoc", "≤ 0.5%", "chong_tron", "R10",
		"quy_cach_hop", "2 viên/hộp – 1.44 m²/hộp", "bao_hanh_nam", 2.0))
	want := map[string]string{
		"nganh": "gach", "muc": "Ốp lát",
		"moTa": "Bề mặt: Men mờ (Matt)\nXương gạch: Porcelain đồng chất (Granite)\nMàu sắc / Vân: Vân đá marble trắng xám\n" +
			"Dòng SP: Gạch porcelain lát nền\nHạng mục: Gạch lát nền\nBảo hành: 2 năm",
		"kichThuoc": "Kích thước: 600 x 1200 (mm)\nĐộ dày: 9 mm\nĐộ hút nước: ≤ 0.5%\nChống trơn: R10\nQuy cách đóng hộp: 2 viên/hộp – 1.44 m²/hộp",
	}
	for k, w := range want {
		if g := jsval.ToString(p.Val(k)); g != w {
			t.Errorf("%s:\n go:   %q\n muốn: %q", k, g, w)
		}
	}
	if g := prodToObj(omap.Of("hang_muc", "Ốp lát")).Val("nganh"); g != "gach" {
		t.Errorf("hạng mục ghi chung Ốp lát -> %v, muốn gach", g)
	}
}
