package categories

import (
	"strings"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/specs"
)

// File mẫu nhập hàng loạt ĐIỆN LẠNH (chỉ bản Go, theo buildDlTemplate trong ct-template.js của QS Pro ea787b6).
// Cùng khuôn với file mẫu Công tắc - ổ cắm; khác: 4 khối thông số theo DL.KHOI, ví dụ không có biến thể màu.

func dlCotMau(hm string) []cot {
	sp := specs.DL
	cols := cotDau(20, 22, 20)
	for _, lb := range metricCua(sp, hm) {
		w := 16.0
		if sp.MetricKind(lb) == "sel" {
			w = 20
		}
		cols = append(cols, cot{lb, batBuoc(sp, lb, hm), w})
	}
	return append(cols, cotCuoi()...)
}

// dlDongMau: chọn 1 hạng mục -> dòng gốc + 1 dòng giá + 20000; không chọn -> 3 hạng mục tiêu biểu.
func dlDongMau(hm string) []*omap.Map {
	sp := specs.DL
	base := omap.Of("THƯƠNG HIỆU", "Panasonic", "NHÀ CUNG CẤP", "Công ty ABC", "HẠNG MỤC", "",
		"CHIẾT KHẤU ĐẠI LÝ (%)", 25.0, "BẢO HÀNH (năm)", 2.0, "TRẠNG THÁI", "Đang kinh doanh")
	if hm != "" {
		gia := jsval.ToNumber(jsval.Or(jsval.GetPath(sp.HMGet(hm), "mau", "GIÁ BÁN LẺ"), 0.0)) + 20000
		return danhDauVD(sp, []*omap.Map{mk(sp, base, hm, nil), mk(sp, base, hm, omap.Of("GIÁ BÁN LẺ", gia))})
	}
	return danhDauVD(sp, []*omap.Map{
		mk(sp, base, "Điều hoà không khí", nil), mk(sp, base, "Ống đồng dẫn gas", nil), mk(sp, base, "Quạt hút / thông gió", nil),
	})
}

// BuildDlTemplate: file mẫu Điện lạnh. Hạng mục lạ / bỏ trống -> mọi hạng mục.
func BuildDlTemplate(hangMuc any) ([]byte, error) {
	sp := specs.DL
	hm := sp.ChuanHM(hangMuc)
	b := newBook()
	b.sheetSanPham(dlCotMau(hm), dlDongMau(hm))

	title := "HƯỚNG DẪN NHẬP HÀNG LOẠT — ĐIỆN LẠNH"
	if hm != "" {
		title += " · " + upper(hm)
	}
	gd := b.sheetHuongDan([]float64{5, 30, 110}, title+" — DEZON QS PRO", 40)
	gd.line(`Điền vào sheet "San pham"`, `Mỗi dòng = 1 sản phẩm (1 mã). Tiêu đề XANH SÁNG là bắt buộc, xanh đậm là tuỳ chọn. Các dòng ví dụ (chữ nghiêng, tên bắt đầu "`+sp.VD+`") được hệ thống TỰ BỎ QUA khi nhập.`, 0)
	if hm != "" {
		gd.line("Hạng mục (quan trọng)", `File này dành RIÊNG cho hạng mục "`+hm+`". Giữ nguyên cột HẠNG MỤC; muốn nhập hạng mục khác thì tải file mẫu của hạng mục đó.`, 58)
	} else {
		gd.line("Hạng mục (quan trọng)", "Cột HẠNG MỤC phải là 1 trong: "+strings.Join(sp.HangMuc, " / ")+`. Hạng mục "Điều hoà không khí" có đủ 4 khối thông số; các hạng mục vật tư / phụ kiện / thông gió chỉ có Quy cách và Xuất xứ — cột không thuộc hạng mục bị bỏ qua.`, 58)
	}
	gd.line("Giá & chiết khấu", "GIÁ BÁN LẺ nhập số (vd 21900000). Giá đại lý hệ thống TỰ TÍNH = Giá bán lẻ × (1 − Chiết khấu %).", 30)
	gd.line("Đơn vị tính", "Thiết bị: Bộ / Cái. Ống đồng, cách nhiệt, ống thoát nước, dây điện, ống gió: m. Vật tư phụ: Lô / Gói.", 30)
	gd.line("Công suất", "Điều hoà bắt buộc LOẠI MÁY và CÔNG SUẤT (HP). Công suất lạnh ghi kW (vd 5.6), BTU/h nếu có.", 30)
	gd.line("Biến thể", "Mỗi model (mỗi MÃ SẢN PHẨM) là 1 dòng. Trùng mã → CẬP NHẬT dòng cũ.", 28)
	gd.line("Ảnh sản phẩm", "KHÔNG nhập ảnh trong file này. Sau khi tải file lên, hệ thống hiện danh sách để tải ảnh cho từng sản phẩm rồi lưu.", 30)
	gd.line("Tải lên", `Lưu file → tab "Nhập dữ liệu" → chọn ngành "Điện lạnh" → mục "Nhập hàng loạt từ file" → chọn file này.`, 28)

	gd.bang("THÔNG SỐ THEO MODULE", "(* = bắt buộc · trong ngoặc = giá trị được chọn)", false)
	khoi := jsval.AsArray(sp.Data.Val("KHOI")) // [[khoá, "English|Tiếng Việt"], ...]
	module := map[string]string{"may": "THIẾT BỊ CHÍNH (điều hoà)", "vt": "VẬT TƯ · PHỤ KIỆN · THÔNG GIÓ"}
	daIn := map[string]bool{} // các hạng mục cùng module dùng chung 1 bộ thông số
	for _, x := range dsHM(sp, hm) {
		h := sp.HMGet(x)
		loai := jsval.ToString(h.Val("loai"))
		if daIn[loai] {
			continue
		}
		daIn[loai] = true
		ten := tenThongSo(sp, h)
		nhom := jsval.AsMap(h.Val("nhom"))
		dong := []string{}
		for _, k := range khoi {
			kv := jsval.AsArray(k)
			ds := specs.Strs(nhom.Val(jsval.AsString(kv[0])))
			if len(ds) == 0 {
				continue
			}
			nhan := jsval.AsString(kv[1])
			if i := strings.Index(nhan, "|"); i >= 0 {
				nhan = nhan[i+1:]
			}
			dong = append(dong, nhan+": "+mapJoin(ds, ten, " · "))
		}
		txt := strings.Join(dong, "\n")
		name := hm
		if name == "" {
			name = module[loai]
		}
		gd.dongBang(name, txt, caoDong(txt, 60, 100, 30), true)
	}
	return b.finish()
}
