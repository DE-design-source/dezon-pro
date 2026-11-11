package quotations

import (
	"context"
	"encoding/base64"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

// nz = nz_ (X:56): Number(v) || 0.
func nz(v any) float64 { return jsval.Num0(v) }

// donGiaNet: l.donGia != null && l.donGia !== 0 (đơn giá NET đã lưu trên dòng).
func coDonGia(l any) bool {
	v := jsval.Get(l, "donGia")
	return !jsval.IsNullish(v) && !jsval.StrictEquals(v, 0.0)
}

// cellOfLine = cellOfLine_ (X:57-73): giá trị cột dẫn xuất của bảng Bóc tách; ok = false khi không phải cột dẫn xuất (null).
func cellOfLine(l any, k any) (any, bool) {
	von, ck, sl := nz(jsval.Get(l, "donGiaVon")), nz(jsval.Get(l, "chietKhau")), nz(jsval.Get(l, "soLuong"))
	daiLy := jsval.Round(von * (1 - ck/100))
	var net float64
	if coDonGia(l) {
		net = nz(jsval.Get(l, "donGia"))
	} else {
		net = jsval.Round(nz(jsval.Get(l, "donGiaBan")) * (1 - nz(jsval.Get(l, "ckKhach"))/100))
	}
	ks, _ := k.(string)
	switch ks {
	case "nganh":
		return jsval.Or(jsval.GetPath(l, "extra", "nganh"), ""), true
	case "giaNCC":
		return von, true
	case "giaDaiLy":
		return daiLy, true
	case "donGia":
		return nz(jsval.Get(l, "donGiaBan")), true
	case "donGiaCK":
		return net, true
	case "markup":
		if daiLy > 0 {
			return jsval.Round((net - daiLy) / daiLy * 100), true
		}
		return 0.0, true
	case "margin":
		if net > 0 {
			return jsval.Round((net - daiLy) / net * 100), true
		}
		return 0.0, true
	case "lnVnd":
		return jsval.Round((net - daiLy) * sl), true
	case "thanhTien":
		return nz(jsval.Get(l, "thanhTienBan")), true
	}
	return nil, false
}

// px (X:75): bề rộng pixel -> bề rộng cột Excel.
func px(w float64) float64 {
	if w == 0 || w != w {
		w = 90
	}
	return max(6, jsval.Round(w/7))
}

var romans = []string{"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV",
	"XVI", "XVII", "XVIII", "XIX", "XX"}

// roman = roman_ (X:76-80).
func roman(n int) string {
	if n >= 0 && n < len(romans) && romans[n] != "" {
		return romans[n]
	}
	return jsval.ToString(float64(n))
}

var reSheetChars = regexp.MustCompile(`[:\\/?*\[\]]`)

// sheetName = sheetName_ (X:356-359).
func sheetName(s any) string {
	n := jsval.Slice(jsval.Trim(reSheetChars.ReplaceAllString(jsval.StrOr(s, "Sheet"), " ")), 0, 30)
	if n == "" {
		return "Sheet"
	}
	return n
}

var (
	fontHead = xFont{Name: "Arial", Bold: true, Color: mauWhite}
	fontBold = xFont{Name: "Arial", Bold: true}
)

/*** ===== Tờ bìa ===== ***/

// buildCoverSheet (X:89-164). o = tuỳ chọn chỉ bản Go (nil = đúng bố cục Node): khối công ty ở đầu sheet (logo nếu tải được),
// dòng "Hiện trạng" ở khối thông tin, Mẫu 1 (6 cột) khi o.m1 - xem service_export_opts.go.
func buildCoverSheet(ws *xSheet, p *omap.Map, cover []any, o *exportOpts, logo *imageData) {
	comp := qscore.CoverComputed(cover)
	cost, total := jsval.AsMap(comp.Val("cost")), jsval.ToNumber(comp.Val("total"))
	ncol := coverNcol(o)
	if ncol == 6 {
		ws.setWidths([]float64{px(52), px(170), px(260), px(120), px(80), px(240)})
	} else {
		ws.setWidths([]float64{px(52), px(380), px(190), px(120)})
	}
	r := 1
	if o != nil && o.org != nil {
		r = writeOrgBlock(ws, o.org, ncol, logo)
	}
	// bigHeader
	ws.merge(r, 1, r, ncol)
	c := ws.cell(r, 1)
	c.set("BẢNG ƯỚC TÍNH CHI PHÍ DỰ ÁN")
	c.font(xFont{Name: "Arial", Bold: true, Size: 16, Color: mauWhite})
	c.align(xAlign{H: "center", V: "middle"})
	c.fill(mauNavy2)
	ws.row(r).ht = 30
	r++
	for _, t := range []string{"[Tư vấn thiết kế, thi công chuyên nghiệp]", plus("Mã báo giá số : ", jsval.Or(p.Val("maBaoGia"), ""))} {
		ws.merge(r, 1, r, ncol)
		c := ws.cell(r, 1)
		c.set(t)
		c.font(xFont{Name: "Arial", Color: "FFC7D3E6"})
		c.align(xAlign{H: "center"})
		c.fill(mauNavy2)
		r++
	}
	r++
	half := ncol / 2
	info := func(l1 string, v1 any, l2 string, v2 any) {
		ws.merge(r, 1, r, half)
		ws.merge(r, half+1, r, ncol)
		ws.cell(r, 1).set([]xRun{{Text: l1 + ":  ", Font: &xFont{Bold: true}}, {Text: jsval.StrOr(v1, "")}})
		ws.cell(r, half+1).set([]xRun{{Text: l2 + ":  ", Font: &xFont{Bold: true}}, {Text: jsval.StrOr(v2, "")}})
		ws.cell(r, 1).align(xAlign{Wrap: true})
		ws.cell(r, half+1).align(xAlign{Wrap: true})
		r++
	}
	info("Khách hàng", p.Val("khachHang"), "Quy mô", p.Val("quyMo"))
	info("Tổng diện tích XD (m²)", p.Val("tongDT"), "Nhu cầu", p.Val("nhuCau"))
	info("DT báo giá [đã nhân hệ số] (m²)", p.Val("dtBaoGia"), "Phân khúc", p.Val("phanKhuc"))
	if o != nil {
		writeHienTrang(ws, r, ncol, p)
		r++
	}
	r++

	headerRow := r
	if ncol == 4 { // Mẫu 1 tự ghi đầu bảng 6 cột (buildCoverM1)
		for i, h := range []string{"NO", "HẠNG MỤC", "CHI PHÍ DỰ KIẾN", "TỶ TRỌNG"} {
			c := ws.cell(r, i+1)
			c.set(h)
			c.font(fontHead)
			c.align(xAlign{H: "center", V: "middle"})
			c.fill(mauNavy2)
		}
		ws.row(r).ht = 24
		r++
	}

	ckey := func(s any) []float64 {
		parts := strings.Split(jsval.ToString(s), ".")
		out := make([]float64, len(parts))
		for i, x := range parts {
			if n := jsval.ParseInt(x, 10); n == n {
				out[i] = n
			}
		}
		return out
	}
	sorted := append([]any{}, cover...)
	sort.SliceStable(sorted, func(i, j int) bool {
		ka, kb := ckey(jsval.Get(sorted[i], "stt")), ckey(jsval.Get(sorted[j], "stt"))
		for x := 0; x < max(len(ka), len(kb)); x++ {
			var a, b float64
			if x < len(ka) {
				a = ka[x]
			}
			if x < len(kb) {
				b = kb[x]
			}
			if d := a - b; d != 0 {
				return d < 0
			}
		}
		return false
	})
	// cột NO: số đánh lại liên tục (opts.soLai) hoặc mã gốc
	disp := map[string]string{}
	if o != nil && o.soLai {
		disp = coverSoLai(sorted)
	}
	noOf := func(stt any) any {
		if d, ok := disp[jsval.ToString(stt)]; ok {
			return d
		}
		return stt
	}
	if ncol == 6 {
		buildCoverM1(ws, sorted, cost, total, r, noOf)
		return
	}
	for _, cv := range sorted {
		stt := jsval.Get(cv, "stt")
		lvl := len(strings.Split(jsval.ToString(stt), "."))
		val := jsval.Num0(jsval.Or(cost.Val(jsval.ToString(stt)), 0.0))
		indent := ""
		if lvl > 1 {
			indent = strings.Repeat("    ", lvl-1)
		}
		name := plus(indent, jsval.Or(jsval.Get(cv, "hangMuc"), ""))
		ws.cell(r, 1).set(noOf(stt))
		ws.cell(r, 1).align(xAlign{H: "center"})
		ws.cell(r, 1).font(xFont{Name: "Arial", Bold: lvl == 1})
		nameCell := ws.cell(r, 2)
		runs := []xRun{{Text: name, Font: &xFont{Bold: lvl <= 2, Italic: lvl >= 3}}}
		if moTa := jsval.Get(cv, "moTa"); jsval.Truthy(moTa) {
			runs = append(runs, xRun{Text: plus("\n", moTa), Font: &xFont{Italic: true, Color: "FF666666"}})
		}
		nameCell.set(runs)
		nameCell.align(xAlign{Wrap: true, V: "middle"})
		costCell := ws.cell(r, 3)
		costCell.set(val)
		costCell.numFmt(fmtInt)
		costCell.align(xAlign{H: "right"})
		costCell.font(xFont{Name: "Arial", Bold: lvl <= 2})
		pctCell := ws.cell(r, 4)
		if total > 0 {
			pctCell.set(val / total)
		} else {
			pctCell.set(0.0)
		}
		pctCell.numFmt("0.0%")
		pctCell.align(xAlign{H: "right"})
		pctCell.font(xFont{Name: "Arial", Bold: lvl <= 2})
		if lvl == 1 {
			for k := 1; k <= 4; k++ {
				ws.cell(r, k).fill("FFC9CCD1")
			}
		} else if lvl == 2 {
			for k := 1; k <= 4; k++ {
				ws.cell(r, k).fill("FFEEF0F2")
			}
		}
		r++
	}
	ws.merge(r, 1, r, 2)
	tCell := ws.cell(r, 1)
	tCell.set("TỔNG CHI PHÍ DỰ KIẾN (VNĐ)")
	tCell.font(fontHead)
	tCell.fill(mauNavy2)
	tVal := ws.cell(r, 3)
	tVal.set(total)
	tVal.numFmt(fmtInt)
	tVal.font(xFont{Name: "Arial", Bold: true, Size: 12, Color: mauWhite})
	tVal.align(xAlign{H: "right"})
	tVal.fill(mauNavy2)
	ws.cell(r, 4).fill(mauNavy2)
	// khối tổng như bản xem trước: VAT (theo % từng hạng mục, client tính) + TỔNG CHI PHÍ DỰ KIẾN (GỒM VAT)
	if o != nil && o.vatBia != nil {
		dong := func(nhan string, v float64, nen, chu string, size float64) {
			r++
			ws.merge(r, 1, r, 2)
			l := ws.cell(r, 1)
			l.set(nhan)
			l.font(xFont{Name: "Arial", Bold: true, Color: chu})
			l.align(xAlign{H: "right"})
			l.fill(nen)
			c := ws.cell(r, 3)
			c.set(v)
			c.numFmt(fmtInt)
			c.font(xFont{Name: "Arial", Bold: true, Size: size, Color: chu})
			c.align(xAlign{H: "right"})
			c.fill(nen)
			ws.cell(r, 4).fill(nen)
		}
		dong("VAT "+o.vatBia.nhan, o.vatBia.vat, "FFEEF1F5", "FF12233A", 11)
		dong("TỔNG CHI PHÍ DỰ KIẾN (GỒM VAT)", total+o.vatBia.vat, mauNavy2, mauWhite, 12)
	}

	for rr := headerRow; rr <= r; rr++ {
		for cc := 1; cc <= 4; cc++ {
			ws.cell(rr, cc).border()
		}
	}
	ws.ySplit = headerRow
}

/*** ===== 3.2 Phần hoàn thiện ===== ***/

// buildSection32 (X:167-231).
func buildSection32(ws *xSheet, p *omap.Map, cover []any, lines []any) {
	ncol := len(s32Cols)
	widths := make([]float64, ncol)
	for i, c := range s32Cols {
		widths[i] = px(c.W)
	}
	ws.setWidths(widths)
	byStt, covBy := map[string]float64{}, map[string]any{}
	cost := jsval.AsMap(qscore.CoverComputed(cover).Val("cost")) // mục có con = tổng mục con (như màn hình)
	for _, c := range cover {
		k := jsval.ToString(jsval.Get(c, "stt"))
		byStt[k] = jsval.Num0(jsval.Or(cost.Val(k), 0.0))
		covBy[k] = c
	}
	subs := qscore.S32Subs
	total32 := 0.0
	for _, s := range subs {
		total32 += byStt[s]
	}
	kl := qscore.ToNumber(p.Val("dtBaoGia"))
	if kl == 0 || kl != kl {
		kl = qscore.ToNumber(p.Val("tongDT"))
	}
	if kl != kl {
		kl = 0
	}

	r := 1
	ws.merge(r, 1, r, ncol)
	c1 := ws.cell(r, 1)
	c1.set("3.2. PHẦN HOÀN THIỆN CƠ BẢN")
	c1.font(xFont{Name: "Arial", Bold: true, Size: 15, Color: mauWhite})
	c1.align(xAlign{H: "center", V: "middle"})
	c1.fill(mauNavy)
	ws.row(r).ht = 26
	r++
	ws.merge(r, 1, r, ncol)
	ws.cell(r, 1).set(duAnKhach(p))
	r++
	r++
	headerRow := r
	for i, c := range s32Cols {
		cell := ws.cell(r, i+1)
		cell.set(c.Label)
		cell.font(fontHead)
		cell.align(xAlign{H: "center", V: "middle", Wrap: true})
		cell.fill(mauNavy)
	}
	ws.row(r).ht = 28
	r++

	donGia := 0.0
	if kl > 0 {
		donGia = total32 / kl
	}
	data := [][]any{{"3.2", "PHẦN HOÀN THIỆN CƠ BẢN", "", "m2", kl, donGia, total32, 1.0, ""}}
	const dash = " — "
	for _, s := range subs {
		cov, chiPhi := covBy[s], byStt[s]
		// thương hiệu / NCC thật sự có trong hạng mục này của dự án (không trùng, tối đa 8)
		var sup [][2]string
		daCo := map[string]bool{}
		for _, l := range lines {
			c := jsval.StrOr(jsval.Get(l, "nhom"), "")
			if c != s && !strings.HasPrefix(c, s+".") {
				continue
			}
			th, nc := jsval.Trim(jsval.StrOr(jsval.Get(l, "thuongHieu"), "")), jsval.Trim(jsval.StrOr(jsval.Get(l, "ncc"), ""))
			if th == "" && nc == "" {
				continue
			}
			k := jsLower(th + "|" + nc)
			if daCo[k] || len(sup) >= 8 {
				continue
			}
			daCo[k] = true
			if th != "" && nc != "" && jsLower(th) != jsLower(nc) {
				sup = append(sup, [2]string{th, nc})
			} else if th != "" {
				sup = append(sup, [2]string{th, ""})
			} else {
				sup = append(sup, [2]string{nc, ""})
			}
		}
		supText := func(x [2]string) string {
			if x[1] != "" {
				return x[0] + dash + x[1]
			}
			return x[0]
		}
		first := ""
		if len(sup) > 0 {
			first = supText(sup[0])
		}
		ratio := 0.0
		if total32 > 0 {
			ratio = chiPhi / total32
		}
		data = append(data, []any{s, jsval.Or(jsval.Get(cov, "hangMuc"), s), jsval.Or(jsval.Get(cov, "moTa"), ""), "gói", 1.0, "",
			chiPhi, ratio, first})
		for k := 1; k < len(sup); k++ {
			data = append(data, []any{"", "", "", "", "", "", "", "", supText(sup[k])})
		}
	}
	firstData := r
	for _, row := range data {
		for ci, c := range s32Cols {
			cell := ws.cell(r, ci+1)
			cell.set(row[ci])
			cell.align(xAlign{H: c.Al, Wrap: c.Wrap, V: "middle"})
			if c.Num {
				cell.numFmt(fmtInt)
			}
			if c.Pct {
				cell.numFmt("0.0%")
			}
			if c.Bold {
				cell.font(fontBold)
			}
		}
		r++
	}
	for cc := 1; cc <= ncol; cc++ {
		ws.cell(firstData, cc).fill("FFC9CCD1")
		ws.cell(firstData, cc).font(fontBold)
	}
	for rr := headerRow; rr < r; rr++ {
		for c2 := 1; c2 <= ncol; c2++ {
			ws.cell(rr, c2).border()
		}
	}
	ws.ySplit = headerRow
}

// "Dự án: ...      Khách hàng: ..." (X:190, 259).
func duAnKhach(p *omap.Map) string {
	return plus(plus("Dự án: ", jsval.Or(p.Val("ten"), ""))+"      Khách hàng: ", jsval.Or(p.Val("khachHang"), ""))
}

/*** ===== Sheet chi tiết theo Nhóm ===== ***/

var reXuongDong = regexp.MustCompile(`\r?\n`)

type detailGroup struct {
	name  string
	items []any
	sub   any
}

// jsAdd = a + b của JS: có chuỗi thì nối chuỗi, ngược lại cộng số (thanhTienBan của dòng bóc tách bình thường là số).
func jsAdd(a, b any) any {
	_, sa := a.(string)
	_, sb := b.(string)
	if sa || sb {
		return jsval.ToString(a) + jsval.ToString(b)
	}
	return jsval.ToNumber(a) + jsval.ToNumber(b)
}

// buildDetailSheet (X:234-324): 1 sheet của 1 nhóm, gom theo Tầng, nhúng ảnh (lỗi ảnh thì bỏ qua ảnh đó).
// vatPct < 0: không in dòng VAT (không có opts.vatHm - đúng bố cục Node)
func (s *Service) buildDetailSheet(ctx context.Context, ws *xSheet, items []any, p *omap.Map, excols []exCol, catName string, vatPct float64) error {
	ncol := len(excols)
	colIdx := func(key string) int {
		for i, c := range excols {
			if k, ok := c.K.(string); ok && k == key {
				return i + 1
			}
		}
		return 0
	}
	ttCol := colIdx("thanhTienBan") // client gửi khoá "thanhTien"
	if ttCol == 0 {
		ttCol = colIdx("thanhTien")
	}
	if ttCol == 0 {
		ttCol = ncol
	}
	imgCol := colIdx("hinhAnh")
	nameCol := colIdx("khuVuc")
	if nameCol == 0 {
		nameCol = 1
		if ncol >= 2 {
			nameCol = 2
		}
	}

	widths := make([]float64, ncol)
	for i, c := range excols {
		widths[i] = px(c.W)
	}
	ws.setWidths(widths)
	var groups []*detailGroup
	gmap := map[string]*detailGroup{}
	var catTotal any = 0.0
	for _, l := range items {
		k := jsval.Trim(jsval.StrOr(jsval.Get(l, "tang"), ""))
		if k == "" {
			k = "CHƯA PHÂN TẦNG"
		}
		if protoKeys[k] {
			return errPush()
		}
		g := gmap[k]
		if g == nil {
			g = &detailGroup{name: k, sub: 0.0}
			gmap[k] = g
			groups = append(groups, g)
		}
		tt := jsval.Get(l, "thanhTienBan")
		g.items = append(g.items, l)
		g.sub = jsAdd(g.sub, tt)
		catTotal = jsAdd(catTotal, tt)
	}

	r := 1
	ws.merge(r, 1, r, ncol)
	h1 := ws.cell(r, 1)
	// tên công ty đang in trên báo giá (client gửi)
	h1.set(jsUpper(jsval.ToString(jsval.Or(p.Val("_org"), "CÔNG TY THIẾT KẾ & THI CÔNG DEZON"))))
	h1.font(xFont{Name: "Arial", Bold: true, Size: 13, Color: mauWhite})
	h1.align(xAlign{H: "center", V: "middle"})
	h1.fill(mauNavy)
	ws.row(r).ht = 24
	r++
	ws.merge(r, 1, r, ncol)
	h2 := ws.cell(r, 1)
	h2.set("BÁO GIÁ CHI TIẾT — " + jsUpper(catName))
	h2.font(xFont{Name: "Arial", Bold: true, Size: 15, Color: mauNavy})
	h2.align(xAlign{H: "center"})
	ws.row(r).ht = 24
	r++
	ws.merge(r, 1, r, ncol)
	ws.cell(r, 1).set(duAnKhach(p))
	ws.cell(r, 1).font(xFont{Color: "FF666666"})
	r++
	r++

	headerRow := r
	for i, c := range excols {
		cell := ws.cell(r, i+1)
		cell.set(c.Label)
		cell.font(fontHead)
		cell.align(xAlign{H: "center", V: "middle", Wrap: true})
		cell.fill(mauNavy)
	}
	ws.row(r).ht = 34
	r++

	type img struct {
		row int
		url string
	}
	var imgList []img
	for gi, g := range groups {
		// dòng nhóm (theo Tầng)
		for x := 1; x <= ncol; x++ {
			ws.cell(r, x).fill(mauGHead)
		}
		ws.cell(r, 1).set(roman(gi + 1))
		ws.cell(r, 1).align(xAlign{H: "center"})
		ws.cell(r, nameCol).set(g.name)
		ws.cell(r, ttCol).set(g.sub)
		ws.cell(r, ttCol).numFmt(fmtInt)
		ws.cell(r, ttCol).align(xAlign{H: "right"})
		for xx := 1; xx <= ncol; xx++ {
			ws.cell(r, xx).font(xFont{Name: "Arial", Bold: true, Color: mauNavy})
		}
		ws.row(r).ht = 22
		r++
		for idx, l := range g.items {
			for ci, c := range excols {
				cell := ws.cell(r, ci+1)
				ks, _ := c.K.(string)
				switch ks {
				case "stt":
					cell.set(float64(idx + 1))
				case "hinhAnh":
					cell.set("")
				case "soLuong":
					cell.set(jsval.Get(l, "soLuong"))
				case "donGiaBan": // đơn giá NET -> đơn giá x SL = thành tiền
					if coDonGia(l) {
						cell.set(jsval.Get(l, "donGia"))
					} else {
						cell.set(jsval.Get(l, "donGiaBan"))
					}
				case "thanhTienBan":
					cell.set(jsval.Get(l, "thanhTienBan"))
				default:
					if cv, ok := cellOfLine(l, c.K); ok {
						cell.set(cv)
					} else if kk := jsval.ToString(c.K); protoKeys[kk] && jsval.IsUndefined(jsval.Get(l, kk)) {
						// l[key] của dòng là thuộc tính thừa hưởng: __proto__ là object rỗng, còn lại là hàm
						if kk == "__proto__" {
							cell.set(omap.New())
						} else {
							cell.set(jsFunc{})
						}
					} else {
						cell.set(jsval.Or(jsval.Get(l, kk), ""))
					}
				}
				cell.align(xAlign{H: c.Al, Wrap: c.Wrap, V: "middle"})
				if c.Num {
					cell.numFmt(fmtInt)
				}
				if c.Bold {
					cell.font(fontBold)
				}
			}
			if idx%2 == 1 {
				for x := 1; x <= ncol; x++ {
					if ws.cell(r, x).st.Fill == "" {
						ws.cell(r, x).fill(mauStripe)
					}
				}
			}
			// ô nhiều ảnh: lấy ảnh đầu (như màn hình)
			anh1 := ""
			for _, x := range reXuongDong.Split(jsval.StrOr(jsval.Get(l, "hinhAnh"), ""), -1) {
				if x = jsval.Trim(x); x != "" {
					anh1 = x
					break
				}
			}
			if imgCol != 0 && anh1 != "" {
				imgList = append(imgList, img{r, anh1})
			}
			ws.row(r).ht = 40
			r++
		}
	}
	// tổng nhóm
	for t := 1; t <= ncol; t++ {
		ws.cell(r, t).fill(mauGold)
	}
	lbl := 1
	if ttCol-1 > 0 {
		lbl = ttCol - 1
	}
	ws.cell(r, lbl).set("TỔNG " + catName)
	ws.cell(r, lbl).font(fontBold)
	ws.cell(r, lbl).align(xAlign{H: "right"})
	ws.cell(r, ttCol).set(catTotal)
	ws.cell(r, ttCol).numFmt(fmtInt)
	ws.cell(r, ttCol).font(xFont{Name: "Arial", Bold: true, Size: 11, Color: "FF8F6F42"})
	// VAT của riêng hạng mục (% đặt ở Bóc tách) + THÀNH TIỀN (VAT), như 3 ô ở đầu trang hạng mục trên bản xem trước
	if vatPct >= 0 {
		vat := qscore.Round0(nz(catTotal) * vatPct / 100)
		dong := func(nhan string, v float64, nen, chu string) {
			r++
			for t := 1; t <= ncol; t++ {
				ws.cell(r, t).fill(nen)
			}
			ws.cell(r, lbl).set(nhan)
			ws.cell(r, lbl).font(xFont{Name: "Arial", Bold: true, Color: chu})
			ws.cell(r, lbl).align(xAlign{H: "right"})
			ws.cell(r, ttCol).set(v)
			ws.cell(r, ttCol).numFmt(fmtInt)
			ws.cell(r, ttCol).font(xFont{Name: "Arial", Bold: true, Size: 11, Color: chu})
		}
		dong("VAT "+jsval.ToString(vatPct)+"%", vat, "FFEEF1F5", "FF12233A")
		dong("THÀNH TIỀN (VAT)", nz(catTotal)+vat, mauNavy2, mauWhite)
	}
	lastRow := r

	for rr := headerRow; rr <= lastRow; rr++ {
		for cc := 1; cc <= ncol; cc++ {
			ws.cell(rr, cc).border()
		}
	}
	ws.ySplit = headerRow

	// nhúng ảnh (best-effort)
	if imgCol != 0 {
		for _, im := range imgList {
			data := s.fetchImage(ctx, im.url)
			if data == nil {
				continue
			}
			ws.addImage(data.buf, data.ext, float64(imgCol-1)+0.1, float64(im.row-1)+0.1)
			ws.row(im.row).ht = 52
		}
	}
	return nil
}

/*** ===== Sheet "3.1 Phần thô" ===== ***/

// secItems = (sec.items || []) rồi gọi .some / .forEach: items truthy mà không phải mảng thì ném TypeError.
func secItems(sec any, method string) ([]any, error) {
	v := prop(sec, "items")
	if !jsval.Truthy(v) {
		return nil, nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, apperr.New("(sec.items || [])." + method + " is not a function")
	}
	return arr, nil
}

// buildPhanThoSheet (X:366-448). Bảng phần thô nằm ở máy người dùng nên client gửi kèm:
// pt = [{ten, tt, items: [{n, dvt, kl, dgnt, ttnt, dg, tt, gc}]}].
func buildPhanThoSheet(ws *xSheet, p *omap.Map, pt []any) error {
	// Giá NHÀ THẦU là số nội bộ: chỉ in 2 cột này khi client GỬI KÈM dgnt (đã bật "in cột nội bộ").
	coNT := false
tim:
	for _, sec := range pt {
		if jsval.IsNullish(sec) {
			return typeErrRead(sec, "items")
		}
		items, err := secItems(sec, "some")
		if err != nil {
			return err
		}
		for _, it := range items {
			if jsval.Truthy(it) && !jsval.IsNullish(prop(it, "dgnt")) {
				coNT = true
				break tim
			}
		}
	}
	var cols []ptCol
	for _, c := range ptCols {
		if coNT || !c.NT {
			cols = append(cols, c)
		}
	}
	n := len(cols)
	widths := make([]float64, n)
	for i, c := range cols {
		widths[i] = c.W
	}
	ws.setWidths(widths)
	ws.merge(1, 1, 1, n)
	t := ws.cell(1, 1)
	t.set("PHẦN THÔ — BẢNG ƯỚC TÍNH CHI PHÍ XÂY DỰNG")
	t.font(xFont{Bold: true, Size: 13, Color: mauNavy})
	t.align(xAlign{H: "center", V: "middle"})
	ws.row(1).ht = 26
	ws.merge(2, 1, 2, n)
	t2 := ws.cell(2, 1)
	t2.set("Dự án: " + jsval.StrOr(p.Val("ten"), ""))
	t2.font(xFont{Italic: true, Size: 10, Color: "FF5B6B7B"})
	ws.row(4).ht = 30
	for i, c := range cols {
		cell := ws.cell(4, i+1)
		cell.set(c.Label)
		cell.fill(mauNavy2)
		cell.font(xFont{Bold: true, Color: mauWhite, Size: 10})
		cell.align(xAlign{H: "center", V: "middle", Wrap: true})
		cell.border()
	}
	r, tong := 5, 0.0
	for si, sec := range pt {
		if jsval.IsNullish(sec) {
			return typeErrRead(sec, "ten")
		}
		row := r
		r++
		tt := jsval.Num0(prop(sec, "tt"))
		ws.cell(row, 1).set(float64(si + 1))
		ws.cell(row, 2).set(jsval.StrOr(prop(sec, "ten"), ""))
		ws.cell(row, n-1).set(tt)
		for i := 1; i <= n; i++ {
			c := ws.cell(row, i)
			c.fill(mauGHead)
			c.font(xFont{Bold: true, Color: mauNavy})
			c.border()
			c.align(xAlign{H: cols[i-1].Al, V: "middle", Wrap: cols[i-1].Wrap})
			if i == n-1 {
				c.numFmt(fmtInt)
			}
		}
		tong += tt
		items, err := secItems(sec, "forEach")
		if err != nil {
			return err
		}
		for ii, it := range items {
			rw := r
			r++
			for i, col := range cols {
				c := ws.cell(rw, i+1)
				switch {
				case col.K == "stt":
					c.set(float64(ii + 1))
				case jsval.IsNullish(it):
					return typeErrRead(it, col.K)
				case col.Fmt != "":
					c.set(jsval.Num0(prop(it, col.K)))
				default:
					c.set(jsval.StrOr(prop(it, col.K), ""))
				}
				c.border()
				c.align(xAlign{H: col.Al, V: "top", Wrap: col.Wrap})
				if col.Fmt != "" {
					c.numFmt(col.Fmt)
				}
				if ii%2 == 1 {
					c.fill(mauStripe)
				}
			}
		}
	}
	ws.merge(r, 1, r, n-2)
	ws.cell(r, 1).set("TỔNG PHẦN THÔ")
	ws.cell(r, n-1).set(tong)
	for i := 1; i <= n; i++ {
		c := ws.cell(r, i)
		c.fill(mauNavy2)
		c.font(xFont{Bold: true, Color: mauWhite, Size: 11})
		c.border()
		c.align(xAlign{H: "right", V: "middle"})
		if i == n-1 {
			c.numFmt(fmtInt)
		}
	}
	ws.ySplit = 4
	return nil
}

/*** ===== Sheet "Tổng cộng" ===== ***/

// buildTongSheet (X:452-463): hộp tổng trang cuối của PDF, client tính rồi gửi lên. tong = [[nhãn, số], ...].
func buildTongSheet(ws *xSheet, p *omap.Map, tong []any) error {
	ws.setWidths([]float64{34, 22})
	t := ws.cell(1, 1)
	t.set("TỔNG GIÁ TRỊ BÁO GIÁ — " + jsUpper(jsval.StrOr(p.Val("ten"), "")))
	t.font(xFont{Bold: true, Size: 13, Color: "FF1F3A5F"})
	ws.merge(1, 1, 1, 2)
	for i, row := range tong[:min(len(tong), 20)] {
		if jsval.IsNullish(row) {
			return typeErrRead(row, "0")
		}
		r := i + 3
		ws.cell(r, 1).set(jsval.Str(prop(row, "0")))
		ws.cell(r, 2).set(jsval.Num0(prop(row, "1")))
		ws.cell(r, 2).numFmt(fmtInt)
		ws.cell(r, 2).align(xAlign{H: "right"})
		if i == len(tong)-1 {
			for c := 1; c <= 2; c++ {
				ws.cell(r, c).font(xFont{Bold: true, Color: mauWhite})
				ws.cell(r, c).fill("FF1F3A5F")
			}
		}
	}
	return nil
}

/*** ===== ENTRY ===== ***/

var reKhongAnToan = regexp.MustCompile(`[^\w\-]+`)

// tenFile: tên file xuất (X:516) - bỏ dấu (NFD rồi bỏ dấu kết hợp U+0300..U+036F), ký tự ngoài [A-Za-z0-9_-] thành "_".
func tenFile(v any) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(jsval.ToString(v)) {
		if !(unicode.Is(unicode.Mn, r) && r >= 0x300 && r <= 0x36F) {
			b.WriteRune(r)
		}
	}
	return "BaoGia_" + reKhongAnToan.ReplaceAllString(b.String(), "_") + ".xlsx"
}

// ExportFile: kết quả của exportBaoGia - {name, mimeType, base64}.
type ExportFile struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Base64   string `json:"base64"`
}

// exCols dựng EXCOLS (X:477-485). NHÃN lấy theo tên cột đang hiện trên màn hình (client gửi);
// EXPORT_STY chỉ lo bề rộng / căn lề / định dạng số.
func exCols(cols any) ([]exCol, error) {
	var chosen []any
	if jsval.Truthy(cols) && jsval.Truthy(jsval.Get(cols, "length")) {
		arr, ok := cols.([]any)
		if !ok {
			return nil, apperr.New("chosen.map is not a function")
		}
		chosen = arr
	} else {
		for _, k := range exportStyKeys {
			chosen = append(chosen, omap.Of("key", k))
		}
	}
	out := make([]exCol, len(chosen))
	for i, c := range chosen {
		if jsval.IsNullish(c) {
			return nil, typeErrRead(c, "key")
		}
		key, label := prop(c, "key"), prop(c, "label")
		ks := jsval.ToString(key)
		st, ok := exportStyMap[ks]
		if protoKeys[ks] && !jsval.IsUndefined(key) {
			// EXPORT_STY[key] là thuộc tính thừa hưởng (truthy, không có label / w / al): nhãn chỉ còn c.label
			out[i] = exCol{K: key, Label: jsval.Or(label, jsval.Undefined), W: 90, Al: "left"}
			continue
		}
		if !ok || jsval.IsUndefined(key) {
			out[i] = exCol{K: key, Label: jsval.Or(label, jsval.Or(label, key)), W: 90, Al: "left"}
			continue
		}
		out[i] = exCol{K: key, Label: jsval.Or(label, st.Label), W: st.W, Al: st.Al, Wrap: st.Wrap, Bold: st.Bold, Num: st.Num, Img: st.Img}
	}
	return out, nil
}

// buildBaoGia dựng workbook của exportBaoGia (X:466-515); tách khỏi ExportBaoGia để test đọc được mô hình.
// opts = tuỳ chọn chỉ bản Go (service_export_opts.go); không có thì workbook đúng như bản Node.
func (s *Service) buildBaoGia(ctx context.Context, maDA, cols, nodes, phanTho, anMuc, tong, org, opts any) (*xBook, *omap.Map, error) {
	o := parseExportOpts(opts)
	q, err := s.GetQuote(ctx, maDA)
	if err != nil {
		return nil, nil, err
	}
	p := omap.New()
	if q.Project != nil {
		p = q.Project.Clone()
	}
	if jsval.Truthy(org) {
		if t := jsval.Trim(jsval.ToString(org)); t != "" {
			p.Set("_org", jsval.Slice(t, 0, 120))
		}
	}
	// chỉ xuất các hạng mục được tích ở tab Xuất báo giá (rỗng = xuất hết)
	lines := q.Lines
	if jsval.Truthy(nodes) && jsval.Truthy(jsval.Get(nodes, "length")) {
		nds, isArr := nodes.([]any)
		kept := []any{}
		for _, l := range lines {
			if !isArr {
				return nil, nil, apperr.New("nodes.some is not a function")
			}
			c := jsval.StrOr(jsval.Get(l, "nhom"), "")
			for _, nd := range nds {
				if jsval.StrictEquals(c, nd) || strings.HasPrefix(c, jsval.ToString(nd)+".") {
					kept = append(kept, l)
					break
				}
			}
		}
		lines = kept
	}
	excols, err := exCols(cols)
	if err != nil {
		return nil, nil, err
	}
	var logo *imageData
	if o != nil {
		applyColWidths(excols, cols)
		if o.org != nil {
			if !p.Has("_org") && o.org.ten != "" {
				p.Set("_org", jsval.Slice(o.org.ten, 0, 120))
			}
			if o.org.logo != "" {
				logo = s.fetchImage(ctx, o.org.logo) // best-effort: SVG, địa chỉ nội bộ, lỗi tải -> không có logo
			}
		}
	}

	wb := &xBook{}
	// mục người dùng đã ẩn khỏi tờ bìa (mục lớn hoặc mục con; ẩn 1 mục = ẩn cả mục con) -> file Excel cũng bỏ, khớp bản PDF (bgHidden, lib/quote.js)
	an := map[string]bool{}
	for _, k := range jsval.AsArray(anMuc) {
		an[jsval.ToString(k)] = true
	}
	all, err := s.GetCoverOrInit(ctx, maDA)
	if err != nil {
		return nil, nil, err
	}
	cover := []any{}
	for _, c := range all {
		// an là {} của JS: mục có đoạn đầu của stt trùng tên thuộc tính của Object.prototype luôn bị coi là đã ẩn
		parts := strings.Split(jsval.ToString(jsval.Get(c, "stt")), ".")
		hide := protoKeys[parts[0]]
		for i := 1; i <= len(parts) && !hide; i++ {
			hide = an[strings.Join(parts[:i], ".")]
		}
		if !hide {
			cover = append(cover, c)
		}
	}
	ws, err := wb.addWorksheet("Tờ bìa")
	if err != nil {
		return nil, nil, err
	}
	buildCoverSheet(ws, p, cover, o, logo)
	coTongKet := o != nil && o.tongKet != nil
	if tg := jsval.AsArray(tong); len(tg) > 0 || coTongKet {
		if ws, err = wb.addWorksheet("Tổng cộng"); err != nil {
			return nil, nil, err
		}
		if err := buildTongSheet(ws, p, tg); err != nil {
			return nil, nil, err
		}
		if coTongKet {
			writeTongKet(ws, o.tongKet, 3+min(len(tg), 20)+1)
		}
	}
	if ws, err = wb.addWorksheet("3.2 Phần hoàn thiện"); err != nil {
		return nil, nil, err
	}
	buildSection32(ws, p, cover, lines)
	if pt := jsval.AsArray(phanTho); len(pt) > 0 {
		if ws, err = wb.addWorksheet("3.1 Phần thô"); err != nil {
			return nil, nil, err
		}
		if err := buildPhanThoSheet(ws, p, pt); err != nil {
			return nil, nil, err
		}
	}

	type cat struct {
		name  string
		items []any
	}
	var cats []*cat
	cmap := map[string]*cat{}
	for _, l := range lines {
		k := jsval.Trim(jsval.ToString(jsval.Or(jsval.Get(l, "nhom"), "Khác")))
		if k == "" {
			k = "Khác"
		}
		if protoKeys[k] {
			return nil, nil, errPush()
		}
		c := cmap[k]
		if c == nil {
			c = &cat{name: k}
			cmap[k] = c
			cats = append(cats, c)
		}
		c.items = append(c.items, l)
	}
	if len(cats) == 0 {
		if ws, err = wb.addWorksheet("Báo giá"); err != nil {
			return nil, nil, err
		}
		if err := s.buildDetailSheet(ctx, ws, nil, p, excols, "Báo giá", -1); err != nil {
			return nil, nil, err
		}
	} else {
		// used là {} của JS: "constructor" / "__proto__" (tên đã viết thường) coi như đã dùng
		used := map[string]bool{"constructor": true, "__proto__": true}
		for _, c := range cats {
			// Excel so tên sheet không phân biệt hoa thường; cắt base để hậu tố " k" luôn vừa
			nm := sheetName(c.name)
			base := jsval.Slice(nm, 0, 26)
			for k := 2; used[jsLower(nm)]; k++ {
				nm = base + " " + jsval.ToString(float64(k))
			}
			used[jsLower(nm)] = true
			if ws, err = wb.addWorksheet(nm); err != nil {
				return nil, nil, err
			}
			// cột riêng của hạng mục (opts.colsHm[mã]) nếu có và hợp lệ, không thì cột chung
			cc := excols
			if o != nil && o.colsHm != nil {
				if v := o.colsHm.Val(c.name); v != nil && jsval.Truthy(jsval.Get(v, "length")) {
					if x, e := exCols(v); e == nil && len(x) > 0 {
						cc = x
					}
				}
			}
			vp := -1.0
			if o != nil && o.vatHm != nil {
				if v := o.vatHm.Val(c.name); jsval.IsNumber(v) {
					vp = jsval.ToNumber(v)
				}
			}
			if err := s.buildDetailSheet(ctx, ws, c.items, p, cc, c.name, vp); err != nil {
				return nil, nil, err
			}
		}
	}
	return wb, p, nil
}

// ExportBaoGia = exportBaoGia (X:466-522). format không được dùng (PDF do trình duyệt in).
// Thứ tự sheet: Tờ bìa | Tổng cộng (nếu có) | 3.2 Phần hoàn thiện | 3.1 Phần thô (nếu có) | mỗi Nhóm 1 sheet.
// opts (tham số thứ 9, chỉ bản Go): bố cục tờ bìa, thông tin công ty, tổng kết, độ rộng cột - service_export_opts.go.
func (s *Service) ExportBaoGia(ctx context.Context, maDA, cols, format, nodes, phanTho, anMuc, tong, org, opts any) (*ExportFile, error) {
	_ = format
	wb, p, err := s.buildBaoGia(ctx, maDA, cols, nodes, phanTho, anMuc, tong, org, opts)
	if err != nil {
		return nil, err
	}
	buf, err := wb.write()
	if err != nil {
		return nil, err
	}
	return &ExportFile{
		Name:     tenFile(jsval.Or(p.Val("ten"), maDA, "BaoGia")),
		MimeType: xlsxMime,
		Base64:   base64.StdEncoding.EncodeToString(buf),
	}, nil
}
