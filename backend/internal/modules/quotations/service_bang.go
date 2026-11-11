package quotations

import (
	"context"
	"math"
	"strings"

	"qspro-backend/internal/shared/jsval"
)

const (
	bangNavy    = "FF12324C"
	bangMaxCols = 60
	bangMaxRows = 20000
)

// buildBang dựng workbook của buildBangXlsx (X:527-565).
func buildBang(b any) (*xBook, error) {
	cols, rows := jsval.AsArray(prop(b, "cols")), jsval.AsArray(prop(b, "rows"))
	cols, rows = cols[:min(len(cols), bangMaxCols)], rows[:min(len(rows), bangMaxRows)]
	wb := &xBook{}
	name := jsval.Slice(reSheetChars.ReplaceAllString(jsval.StrOr(prop(b, "sheet"), "Bang"), " "), 0, 30)
	if name == "" {
		name = "Bang"
	}
	ws, err := wb.addWorksheet(name)
	if err != nil {
		return nil, err
	}
	n := len(cols)
	// dep (chỉ bản Go, client mới gửi true): bảng có viền, canh giữa theo chiều dọc, số nguyên không còn dấu chấm thừa,
	// cột {img: true} nhúng ảnh theo url trong ô, cột {w: số} đặt độ rộng. Không có dep = đúng file của bản Node.
	dep := jsval.Truthy(prop(b, "dep"))
	isImg := make([]bool, n)
	r := 1
	if ten := prop(b, "ten"); jsval.Truthy(ten) {
		ws.cell(r, 1).set(jsval.ToString(ten))
		ws.cell(r, 1).font(xFont{Bold: true, Size: 14, Color: bangNavy})
		r += 2
	}
	isNum := make([]bool, n)
	for i, c := range cols {
		if jsval.IsNullish(c) {
			return nil, typeErrRead(c, "label")
		}
		isNum[i] = jsval.Truthy(prop(c, "num"))
		cell := ws.cell(r, i+1)
		cell.set(jsval.StrOr(prop(c, "label"), ""))
		cell.font(xFont{Bold: true, Color: mauWhite})
		cell.fill(bangNavy)
		h := "left"
		if isNum[i] {
			h = "right"
		}
		cell.align(xAlign{V: "middle", Wrap: true, H: h})
		switch {
		case i == 0:
			ws.widths[i+1] = 8
		case isNum[i]:
			ws.widths[i+1] = 16
		default:
			ws.widths[i+1] = 34
		}
		if dep {
			isImg[i] = jsval.Truthy(prop(c, "img"))
			cell.align(xAlign{V: "middle", Wrap: true, H: "center"})
			cell.border()
			if w := jsval.Num0(prop(c, "w")); w >= 4 && w <= 120 {
				ws.widths[i+1] = w
			} else if isImg[i] {
				ws.widths[i+1] = 12
			}
		}
	}
	ws.row(r).ht = 30
	ws.ySplit = r
	r++
	for _, row := range rows {
		if jsval.Truthy(row) {
			if g := prop(row, "group"); !jsval.IsNullish(g) {
				c := ws.cell(r, 1)
				c.set(jsval.ToString(g))
				c.font(xFont{Bold: true, Color: bangNavy})
				c.fill("FFEEF2F7")
				if dep {
					c.align(xAlign{V: "middle"})
					for i := 1; i <= n; i++ {
						ws.cell(r, i).border()
					}
				}
				if n > 1 {
					ws.merge(r, 1, r, n)
				}
				r++
				continue
			}
		}
		var cells []any
		if jsval.Truthy(row) {
			cells = jsval.AsArray(prop(row, "cells"))
		}
		if dep {
			for i := 1; i <= n; i++ {
				ws.cell(r, i).border()
			}
		}
		for i, v := range cells[:min(len(cells), n)] {
			cell := ws.cell(r, i+1)
			if dep && isImg[i] {
				// ô ảnh: không ghi chữ, chờ BuildBangXlsx tải + nhúng ảnh đầu tiên
				if u := jsval.Trim(strings.SplitN(jsval.StrOr(v, ""), "\n", 2)[0]); u != "" {
					ws.pend = append(ws.pend, pendImg{r, i + 1, u})
					ws.row(r).ht = 52
				}
				continue
			}
			f, laSo := v.(float64)
			_, laChu := v.(string)
			if (laSo && !math.IsInf(f, 0) && !math.IsNaN(f)) || laChu {
				cell.set(v)
			} else {
				cell.set("")
			}
			if laSo {
				cell.numFmt("#,##0.##")
			}
			cell.align(xAlign{V: "top", Wrap: !isNum[i]})
			if dep {
				h := "left"
				if laSo {
					h = "right"
					if f == math.Trunc(f) {
						cell.numFmt("#,##0") // "#,##0.##" hiện "255,000." với số nguyên
					}
				} else if i == 0 {
					h = "center"
				}
				cell.align(xAlign{V: "middle", Wrap: !isNum[i], H: h})
			}
		}
		r++
	}
	if tong, ok := prop(b, "tong").([]any); ok && n >= 2 {
		r++
		for _, t := range tong[:min(len(tong), 20)] {
			if jsval.IsNullish(t) {
				return nil, typeErrRead(t, "0")
			}
			ws.cell(r, n-1).set(jsval.StrOr(prop(t, "0"), ""))
			ws.cell(r, n-1).font(xFont{Bold: true})
			c := ws.cell(r, n)
			c.set(jsval.Num0(prop(t, "1")))
			c.numFmt(fmtInt)
			c.font(xFont{Bold: true})
			r++
		}
	}
	return wb, nil
}

// BuildBangXlsx = buildBangXlsx (X:527-567): 1 bảng do client dựng sẵn -> file Excel.
// b = {ten, sheet, cols: [{label, num, img?, w?}], rows: [{cells: []} | {group: ""}], tong: [[nhãn, số]], dep?}. Không đọc database;
// ảnh của cột img (chỉ khi dep) tải như file báo giá (fetchImage, best-effort: ảnh lỗi thì bỏ trống ô).
func (s *Service) BuildBangXlsx(ctx context.Context, b any) ([]byte, error) {
	wb, err := buildBang(b)
	if err != nil {
		return nil, err
	}
	for _, ws := range wb.sheets {
		for _, p := range ws.pend {
			if data := s.fetchImage(ctx, p.url); data != nil {
				ws.addImage(data.buf, data.ext, float64(p.col-1)+0.1, float64(p.row-1)+0.1)
			}
		}
	}
	return wb.write()
}
