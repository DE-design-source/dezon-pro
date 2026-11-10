package categories

import (
	"strings"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/specs"
)

// File mẫu nhập hàng loạt GẠCH ỐP LÁT (chỉ bản Go). Cùng khuôn với file mẫu Điện lạnh; mọi hạng mục gạch
// dùng chung 1 bộ 8 thông số nên cột thông số luôn theo đúng thứ tự cột I của file gạch (GACH.ALL).

func gachCotMau(hm string) []cot {
	sp := specs.GACH
	cols := cotDau(20, 22, 18)
	for _, lb := range sp.All {
		w := 16.0
		if sp.MetricKind(lb) == "sel" {
			w = 22
		}
		cols = append(cols, cot{lb, batBuoc(sp, lb, hm), w})
	}
	return append(cols, cotCuoi()...)
}

// gachDongMau: chọn 1 hạng mục -> dòng gốc + 1 dòng giá + 20000; không chọn -> ví dụ của mọi hạng mục.
func gachDongMau(hm string) []*omap.Map {
	sp := specs.GACH
	base := omap.Of("THƯƠNG HIỆU", "Viglacera", "NHÀ CUNG CẤP", "Công ty ABC", "HẠNG MỤC", "",
		"CHIẾT KHẤU ĐẠI LÝ (%)", 20.0, "BẢO HÀNH (năm)", 2.0, "TRẠNG THÁI", "Đang kinh doanh")
	if hm != "" {
		gia := jsval.ToNumber(jsval.Or(jsval.GetPath(sp.HMGet(hm), "mau", "GIÁ BÁN LẺ"), 0.0)) + 20000
		return danhDauVD(sp, []*omap.Map{mk(sp, base, hm, nil), mk(sp, base, hm, omap.Of("GIÁ BÁN LẺ", gia))})
	}
	ds := []*omap.Map{}
	for _, x := range sp.HangMuc {
		ds = append(ds, mk(sp, base, x, nil))
	}
	return danhDauVD(sp, ds)
}

// BuildGachTemplate: file mẫu Gạch ốp lát. Hạng mục lạ / bỏ trống -> mọi hạng mục.
func BuildGachTemplate(hangMuc any) ([]byte, error) {
	sp := specs.GACH
	hm := sp.ChuanHM(hangMuc)
	b := newBook()
	b.sheetSanPham(gachCotMau(hm), gachDongMau(hm))

	title := "HƯỚNG DẪN NHẬP HÀNG LOẠT — GẠCH ỐP LÁT"
	if hm != "" {
		title += " · " + upper(hm)
	}
	gd := b.sheetHuongDan([]float64{5, 30, 110}, title+" — DEZON QS PRO", 40)
	gd.line(`Điền vào sheet "San pham"`, `Mỗi dòng = 1 sản phẩm (1 mã). Tiêu đề XANH SÁNG là bắt buộc, xanh đậm là tuỳ chọn. Các dòng ví dụ (chữ nghiêng, tên bắt đầu "`+sp.VD+`") được hệ thống TỰ BỎ QUA khi nhập.`, 0)
	if hm != "" {
		gd.line("Hạng mục (quan trọng)", `File này dành RIÊNG cho hạng mục "`+hm+`". Giữ nguyên cột HẠNG MỤC; muốn nhập hạng mục khác thì tải file mẫu của hạng mục đó.`, 58)
	} else {
		gd.line("Hạng mục (quan trọng)", "Cột HẠNG MỤC phải là 1 trong: "+strings.Join(sp.HangMuc, " / ")+". Mọi hạng mục dùng chung 1 bộ thông số.", 44)
	}
	gd.line("Giá & chiết khấu", "GIÁ BÁN LẺ nhập số, tính theo ĐƠN VỊ TÍNH (thường là m², vd 450000). Giá đại lý hệ thống TỰ TÍNH = Giá bán lẻ × (1 − Chiết khấu %).", 30)
	gd.line("Đơn vị tính", "Gạch: m² (khuyến nghị) / Hộp / Viên. Số lượng m² ở bảng bóc tách nên cộng hao hụt cắt gạch theo dự án.", 30)
	gd.line("Kích thước", "Bắt buộc. Ghi dạng Rộng x Dài (mm), vd 600 x 1200 (mm).", 28)
	gd.line("Biến thể", "Mỗi mã gạch (mỗi MÃ SẢN PHẨM) là 1 dòng. Trùng mã → CẬP NHẬT dòng cũ.", 28)
	gd.line("Ảnh sản phẩm", "KHÔNG nhập ảnh trong file này. Sau khi tải file lên, hệ thống hiện danh sách để tải ảnh cho từng sản phẩm rồi lưu.", 30)
	gd.line("Tải lên", `Lưu file → tab "Nhập dữ liệu" → chọn ngành "Gạch ốp lát" → mục "Nhập hàng loạt từ file" → chọn file này.`, 28)

	gd.bang("THÔNG SỐ GẠCH", "(* = bắt buộc · trong ngoặc = giá trị gợi ý)", false)
	x := hm
	if x == "" {
		x = sp.HangMuc[0]
	}
	txt := mapJoin(sp.All, tenThongSo(sp, sp.HMGet(x)), "\n")
	name := hm
	if name == "" {
		name = "MỌI HẠNG MỤC GẠCH"
	}
	gd.dongBang(name, txt, caoDong(txt, 60, 100, 30), true)
	return b.finish()
}
