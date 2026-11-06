package quotations

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

/* Tuỳ chọn CHỈ BẢN GO của exportBaoGia (roadmap M8.1, M8.2, M8.3): tham số rpc thứ 9 / khoá "opts" của thân REST.
     opts = { coverMau: 'm1' | 'm2',                               // bố cục tờ bìa; khác 'm1' = Mẫu 2 (bố cục Excel cũ)
              org: { ten, logo, lines: [..] },                      // = bgOrg_() của bản xem trước
              tongKet: { ngay, hieuLuc, dot: [{noiDung, pct, soTien}], ghiChu: [..], nguoi } }   // = bgTongKetData_()
   Mọi chữ / số do client dựng bằng ĐÚNG hàm của bản xem trước; máy chủ chỉ in ra, không tính lại.
   Có opts thì thêm: khối tên + địa chỉ công ty đầu tờ bìa (logo best-effort), ô "Hiện trạng" ở khối thông tin,
   Mẫu 1 khi coverMau = 'm1', độ rộng cột chi tiết theo cols[i].w (px), khối tiến độ thanh toán + ghi chú ở sheet Tổng cộng.
   Không có opts (undefined / null / không phải object) -> file giữ nguyên từng byte như bản Node. */

const (
	optTextMax  = 500 // độ dài tối đa của 1 dòng chữ
	optLinesMax = 10  // số dòng địa chỉ / liên hệ tối đa
	optDotMax   = 20  // số đợt thanh toán tối đa
	optGhiMax   = 30  // số câu ghi chú tối đa
	optLogoMax  = 2048
	optColWMax  = 2000 // bề rộng cột (px) tối đa nhận từ client
)

type orgOpt struct {
	ten, logo string
	lines     []string
}

type dotOpt struct {
	noiDung     string
	pct, soTien float64
}

type tongKetOpt struct {
	ngay    string
	hieuLuc float64
	dot     []dotOpt
	ghiChu  []string
	nguoi   string
}

// vatBiaOpt: VAT của khối tổng tờ bìa do client tính theo % từng hạng mục (bản xem trước) - nhan = "10%" hoặc "5% · 8% · 10%".
type vatBiaOpt struct {
	nhan string
	vat  float64
}

type exportOpts struct {
	vatBia  *vatBiaOpt
	vatHm   *omap.Map // % VAT của từng hạng mục (mã l.nhom -> %): sheet của hạng mục thêm dòng VAT + THÀNH TIỀN (VAT)
	m1      bool
	soLai   bool      // đánh số lại liên tục các mục tờ bìa đang hiện (coverSoLai)
	colsHm  *omap.Map // cột riêng từng hạng mục: {mã hạng mục (l.nhom): danh sách cột như tham số cols} - sheet của hạng mục dùng thay cols
	org     *orgOpt
	tongKet *tongKetOpt
}

// optStr: chuỗi đã cắt khoảng trắng hai đầu, tối đa n ký tự; số được đổi ra chữ, giá trị khác -> rỗng.
func optStr(v any, n int) string {
	var s string
	switch x := v.(type) {
	case string:
		s = x
	case float64:
		s = jsval.ToString(x)
	default:
		return ""
	}
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if utf8.RuneCountInString(s) > n {
		s = string([]rune(s)[:n])
	}
	return s
}

// optNum: số hữu hạn (số hoặc chuỗi số), ngược lại 0.
func optNum(v any) float64 {
	if !jsval.IsNumber(v) {
		if s, ok := v.(string); !ok || strings.TrimSpace(s) == "" {
			return 0
		}
	}
	n := jsval.ToNumber(v)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0
	}
	return n
}

// optLines: mảng chuỗi, bỏ dòng rỗng, tối đa max dòng.
func optLines(v any, max int) []string {
	var out []string
	for _, x := range jsval.AsArray(v) {
		if s := optStr(x, optTextMax); s != "" && len(out) < max {
			out = append(out, s)
		}
	}
	return out
}

// parseExportOpts: nil khi không có opts (giữ nguyên file như bản Node).
func parseExportOpts(v any) *exportOpts {
	m := jsval.AsMap(v)
	if m == nil {
		return nil
	}
	o := &exportOpts{m1: jsval.StrictEquals(m.Val("coverMau"), "m1"), soLai: jsval.StrictEquals(m.Val("soLai"), true)}
	if h := jsval.AsMap(m.Val("colsHm")); h != nil {
		o.colsHm = h
	}
	if h := jsval.AsMap(m.Val("vatHm")); h != nil {
		o.vatHm = h
	}
	if b := jsval.AsMap(m.Val("vatBia")); b != nil {
		o.vatBia = &vatBiaOpt{nhan: optStr(b.Val("nhan"), 60), vat: optNum(b.Val("vat"))}
	}
	if g := jsval.AsMap(m.Val("org")); g != nil {
		org := &orgOpt{ten: optStr(g.Val("ten"), 200), logo: optStr(g.Val("logo"), optLogoMax), lines: optLines(g.Val("lines"), optLinesMax)}
		if org.ten != "" || len(org.lines) > 0 || org.logo != "" {
			o.org = org
		}
	}
	if t := jsval.AsMap(m.Val("tongKet")); t != nil {
		tk := &tongKetOpt{ngay: optStr(t.Val("ngay"), 40), hieuLuc: optNum(t.Val("hieuLuc")),
			ghiChu: optLines(t.Val("ghiChu"), optGhiMax), nguoi: optStr(t.Val("nguoi"), 200)}
		for _, d := range jsval.AsArray(t.Val("dot")) {
			dm := jsval.AsMap(d)
			if dm == nil || len(tk.dot) >= optDotMax {
				continue
			}
			nd := optStr(dm.Val("noiDung"), optTextMax)
			if nd == "" {
				continue
			}
			tk.dot = append(tk.dot, dotOpt{noiDung: nd, pct: optNum(dm.Val("pct")), soTien: optNum(dm.Val("soTien"))})
		}
		o.tongKet = tk
	}
	return o
}

// applyColWidths: cols[i].w (px, bề rộng cột trên bản xem trước) thay bề rộng mặc định của cột chi tiết thứ i.
func applyColWidths(excols []exCol, cols any) {
	for i, c := range jsval.AsArray(cols) {
		if i >= len(excols) {
			break
		}
		w := prop(c, "w")
		if !jsval.IsNumber(w) {
			continue
		}
		if n := jsval.ToNumber(w); n > 0 && !math.IsInf(n, 0) {
			excols[i].W = math.Min(n, optColWMax)
		}
	}
}

// coverNcol: số cột của tờ bìa (Mẫu 2 = 4 cột như bản Node, Mẫu 1 = 6 cột như bgCoverPage_).
func coverNcol(o *exportOpts) int {
	if o != nil && o.m1 {
		return 6
	}
	return 4
}

// writeOrgBlock: tên công ty + các dòng địa chỉ / liên hệ ở đầu tờ bìa (bgOrg_ của bản xem trước), logo nhúng ở ô A1
// nếu tải được PNG / JPG. Trả dòng kế tiếp.
func writeOrgBlock(ws *xSheet, org *orgOpt, ncol int, logo *imageData) int {
	r := 1
	if org.ten != "" {
		ws.merge(r, 1, r, ncol)
		c := ws.cell(r, 1)
		c.set(org.ten)
		c.font(xFont{Name: "Arial", Bold: true, Size: 14, Color: mauNavy2})
		c.align(xAlign{H: "center", V: "middle"})
		ws.row(r).ht = 24
		r++
	}
	for _, l := range org.lines {
		ws.merge(r, 1, r, ncol)
		c := ws.cell(r, 1)
		c.set(l)
		c.font(xFont{Name: "Arial", Size: 10, Color: "FF5B6B7B"})
		c.align(xAlign{H: "center", V: "middle"})
		r++
	}
	if logo != nil {
		// ảnh cao 48 px (~36 pt): đủ chỗ thì nằm trong các dòng tên + địa chỉ, thiếu thì nới dòng đầu
		if r-1 < 2 {
			ws.row(1).ht = 40
		}
		ws.addImage(logo.buf, logo.ext, 0.1, 0.1)
	}
	if r > 1 || logo != nil {
		if r == 1 {
			r++ // chỉ có logo
		}
		r++ // dòng trống trước tiêu đề
	}
	return r
}

// writeHienTrang: dòng "Hiện trạng" của khối thông tin (M8.3), nửa trái; nửa phải để trống. Giữ xuống dòng như ô nhập
// (textarea) và bản xem trước; ô gộp không tự giãn chiều cao nên ước số dòng theo bề rộng nửa trái.
func writeHienTrang(ws *xSheet, r, ncol int, p *omap.Map) {
	const nhan = "Hiện trạng:  "
	half := ncol / 2
	ws.merge(r, 1, r, half)
	ws.merge(r, half+1, r, ncol)
	v := strings.ReplaceAll(strings.ReplaceAll(jsval.StrOr(p.Val("hienTrang"), ""), "\r\n", "\n"), "\r", "\n")
	ws.cell(r, 1).set([]xRun{{Text: nhan, Font: &xFont{Bold: true}}, {Text: v}})
	ws.cell(r, 1).align(xAlign{Wrap: true})
	rong := 0.0
	for i := 1; i <= half; i++ {
		rong += ws.widths[i]
	}
	perLine := math.Max(10, math.Floor(rong*1.1)) // bề rộng cột (đơn vị ký tự) ~ số ký tự Arial 10 một dòng
	soDong := 0.0
	for i, l := range strings.Split(v, "\n") {
		n := utf8.RuneCountInString(l)
		if i == 0 {
			n += utf8.RuneCountInString(nhan)
		}
		soDong += math.Max(1, math.Ceil(float64(n)/perLine))
	}
	if soDong > 1 {
		ws.row(r).ht = 15 * soDong
	}
}

// buildCoverM1: bảng tờ bìa Mẫu 1 (bgCoverPage_ 158-181): gộp NO / HẠNG MỤC theo mục lớn, cột NỘI DUNG là mục con
// (mục có con in đậm kèm "(gồm các mục dưới)", mục cấp 3 trở đi thụt vào), MÔ TẢ ở cột cuối. sorted = tờ bìa đã sắp.
func buildCoverM1(ws *xSheet, sorted []any, cost *omap.Map, total float64, r int, noOf func(any) any) {
	const ncol = 6
	headerRow := r
	for i, h := range []string{"NO", "HẠNG MỤC", "NỘI DUNG", "CHI PHÍ DỰ KIẾN", "TỶ TRỌNG", "MÔ TẢ"} {
		c := ws.cell(r, i+1)
		c.set(h)
		c.font(fontHead)
		c.align(xAlign{H: "center", V: "middle"})
		c.fill(mauNavy2)
	}
	ws.row(r).ht = 24
	r++
	sttOf := func(c any) string { return jsval.ToString(jsval.Get(c, "stt")) }
	depth := func(s string) int { return len(strings.Split(s, ".")) }
	hasChild := func(stt string) bool {
		for _, d := range sorted {
			if s := sttOf(d); s != stt && strings.HasPrefix(s, stt+".") {
				return true
			}
		}
		return false
	}
	for _, sec := range sorted {
		ss := sttOf(sec)
		if depth(ss) != 1 {
			continue
		}
		var kids []any
		for _, c := range sorted {
			if s := sttOf(c); s != ss && strings.HasPrefix(s, ss+".") {
				kids = append(kids, c)
			}
		}
		if len(kids) == 0 {
			kids = []any{sec}
		}
		first := r
		for _, c := range kids {
			s := sttOf(c)
			val := jsval.Num0(jsval.Or(cost.Val(s), 0.0))
			laSec := len(kids) == 1 && s == ss
			gop := !laSec && hasChild(s)
			sau := max(0, depth(s)-2)
			nd := ws.cell(r, 3)
			if !laSec {
				ten := strings.Repeat("    ", sau) + jsval.StrOr(jsval.Get(c, "hangMuc"), "")
				if gop {
					nd.set([]xRun{{Text: ten, Font: &xFont{Bold: true}},
						{Text: " (gồm các mục dưới)", Font: &xFont{Italic: true, Color: "FF94A3B8"}}})
				} else if sau > 0 {
					nd.set([]xRun{{Text: ten, Font: &xFont{Color: "FF5B6B7B"}}})
				} else {
					nd.set(ten)
				}
			}
			nd.align(xAlign{Wrap: true, V: "middle"})
			costCell := ws.cell(r, 4)
			costCell.set(val)
			costCell.numFmt(fmtInt)
			costCell.align(xAlign{H: "right", V: "middle"})
			costCell.font(xFont{Name: "Arial", Bold: gop})
			pctCell := ws.cell(r, 5)
			if total > 0 {
				pctCell.set(val / total)
			} else {
				pctCell.set(0.0)
			}
			pctCell.numFmt("0.00%")
			pctCell.align(xAlign{H: "right", V: "middle"})
			mt := ws.cell(r, 6)
			mt.set(jsval.StrOr(jsval.Get(c, "moTa"), ""))
			mt.font(xFont{Name: "Arial", Italic: true, Color: "FF666666"})
			mt.align(xAlign{Wrap: true, V: "middle"})
			r++
		}
		// ô NO / HẠNG MỤC dùng chung cho các dòng con của mục lớn
		ws.merge(first, 1, r-1, 1)
		ws.merge(first, 2, r-1, 2)
		no := ws.cell(first, 1)
		no.set(noOf(jsval.Get(sec, "stt")))
		no.font(xFont{Name: "Arial", Bold: true})
		no.align(xAlign{H: "center", V: "middle"})
		no.fill("FFEEF0F2")
		hm := ws.cell(first, 2)
		hm.set(jsval.StrOr(jsval.Get(sec, "hangMuc"), ""))
		hm.font(xFont{Name: "Arial", Bold: true})
		hm.align(xAlign{Wrap: true, V: "middle"})
		hm.fill("FFEEF0F2")
	}
	ws.merge(r, 1, r, 3)
	tCell := ws.cell(r, 1)
	tCell.set("TỔNG CHI PHÍ DỰ KIẾN (VNĐ)")
	tCell.font(fontHead)
	tCell.align(xAlign{H: "right"})
	tCell.fill(mauNavy2)
	tVal := ws.cell(r, 4)
	tVal.set(total)
	tVal.numFmt(fmtInt)
	tVal.font(xFont{Name: "Arial", Bold: true, Size: 12, Color: mauWhite})
	tVal.align(xAlign{H: "right"})
	tVal.fill(mauNavy2)
	tPct := ws.cell(r, 5)
	tPct.set(1.0)
	tPct.numFmt("0%")
	tPct.font(xFont{Name: "Arial", Bold: true, Color: mauWhite})
	tPct.align(xAlign{H: "right"})
	tPct.fill(mauNavy2)
	ws.cell(r, 6).fill(mauNavy2)
	for rr := headerRow; rr <= r; rr++ {
		for cc := 1; cc <= ncol; cc++ {
			ws.cell(rr, cc).border()
		}
	}
	ws.ySplit = headerRow
}

// writeTongKet: tiến độ thanh toán + ghi chú & điều khoản + người lập ở sheet "Tổng cộng" (bgTongKetHTML_), từ dòng r.
func writeTongKet(ws *xSheet, tk *tongKetOpt, r int) {
	ws.widths[3] = 14
	head := func(text string) {
		ws.merge(r, 1, r, 3)
		c := ws.cell(r, 1)
		c.set(text)
		c.font(xFont{Name: "Arial", Bold: true, Size: 12, Color: "FF1F3A5F"})
		r++
	}
	if tk.ngay != "" || tk.hieuLuc > 0 {
		var parts []string
		if tk.ngay != "" {
			parts = append(parts, "Ngày báo giá: "+tk.ngay)
		}
		if tk.hieuLuc > 0 {
			parts = append(parts, "Hiệu lực: "+jsval.ToString(tk.hieuLuc)+" ngày")
		}
		ws.merge(r, 1, r, 3)
		ws.cell(r, 1).set(strings.Join(parts, " · "))
		ws.cell(r, 1).font(xFont{Name: "Arial", Italic: true, Color: "FF5B6B7B"})
		r += 2
	}
	if len(tk.dot) > 0 {
		head("TIẾN ĐỘ THANH TOÁN")
		for i, h := range []string{"Nội dung", "Số tiền", "Tỷ lệ (%)"} {
			c := ws.cell(r, i+1)
			c.set(h)
			c.font(fontHead)
			c.fill(mauNavy2)
			c.align(xAlign{H: "center", V: "middle"})
			c.border()
		}
		r++
		for i, d := range tk.dot {
			a := ws.cell(r, 1)
			a.set("Đợt " + jsval.ToString(float64(i+1)) + ": " + d.noiDung)
			a.align(xAlign{Wrap: true, V: "middle"})
			b := ws.cell(r, 2)
			b.set(d.soTien)
			b.numFmt(fmtInt)
			b.align(xAlign{H: "right", V: "middle"})
			c := ws.cell(r, 3)
			c.set(d.pct)
			c.align(xAlign{H: "center", V: "middle"})
			for k := 1; k <= 3; k++ {
				ws.cell(r, k).border()
			}
			r++
		}
		r++
	}
	if len(tk.ghiChu) > 0 {
		head("GHI CHÚ & ĐIỀU KHOẢN:")
		for i, g := range tk.ghiChu {
			ws.merge(r, 1, r, 3)
			c := ws.cell(r, 1)
			c.set(jsval.ToString(float64(i+1)) + ". " + g)
			c.align(xAlign{Wrap: true, V: "top"})
			// ô gộp không tự giãn chiều cao: ước theo độ dài (~70 ký tự một dòng)
			if n := utf8.RuneCountInString(g); n > 70 {
				ws.row(r).ht = 15 * math.Ceil(float64(n)/70)
			}
			r++
		}
		r++
	}
	if tk.nguoi != "" {
		ws.merge(r, 1, r, 3)
		ws.cell(r, 1).set("Người lập: " + tk.nguoi)
		ws.cell(r, 1).font(xFont{Name: "Arial", Bold: true})
	}
}

// coverSoLai: số in ở cột NO khi đánh số lại liên tục (= coverSoLai_ của lib/quote.js): sorted = các mục đang hiện đã sắp,
// mục lớn đầu tiên = 1, mục con = 1.1…; tổ tiên không có mặt thì đánh theo tổ tiên gần nhất có mặt. Trả {stt gốc: số in}.
func coverSoLai(sorted []any) map[string]string {
	disp, cnt := map[string]string{}, map[string]int{}
	for _, c := range sorted {
		stt := jsval.ToString(jsval.Get(c, "stt"))
		parts := strings.Split(stt, ".")
		pk := ""
		for i := len(parts) - 1; i >= 1; i-- {
			if d, ok := disp[strings.Join(parts[:i], ".")]; ok {
				pk = d
				break
			}
		}
		cnt[pk]++
		if pk != "" {
			disp[stt] = pk + "." + strconv.Itoa(cnt[pk])
		} else {
			disp[stt] = strconv.Itoa(cnt[pk])
		}
	}
	return disp
}
