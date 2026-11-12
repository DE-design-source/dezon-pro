package quotations

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

/* Mô hình workbook kiểu ExcelJS: các hàm dựng sheet (service_export.go, service_bang.go) ghi vào mô hình này đúng theo
   thứ tự lệnh của export.js, rồi write() mới xuất ra file bằng excelize. Cần lớp này vì ngữ nghĩa của ExcelJS khác excelize:
   mỗi lần gán cell.font / alignment / fill thay TRỌN thuộc tính đó, và ô bị gộp DÙNG CHUNG object style với ô chính. */

type xFont struct {
	Name         string
	Bold, Italic bool
	Size         float64
	Color        string // ARGB, rỗng = không đặt
}

type xAlign struct {
	H, V string // V theo tên của ExcelJS: "middle", "top"
	Wrap bool
}

type xStyle struct {
	NumFmt string
	Font   *xFont
	Align  *xAlign
	Fill   string // ARGB của fgColor, rỗng = không tô
	Border bool   // viền mảnh 4 cạnh màu mauLine
}

func (s *xStyle) empty() bool {
	return s == nil || (s.NumFmt == "" && s.Font == nil && s.Align == nil && s.Fill == "" && !s.Border)
}

func (s *xStyle) key() string {
	var b strings.Builder
	b.WriteString(s.NumFmt)
	b.WriteByte('|')
	if f := s.Font; f != nil {
		b.WriteString(f.Name + "," + strconv.FormatBool(f.Bold) + "," + strconv.FormatBool(f.Italic) + "," +
			strconv.FormatFloat(f.Size, 'g', -1, 64) + "," + f.Color)
	} else {
		b.WriteByte('-')
	}
	b.WriteByte('|')
	if a := s.Align; a != nil {
		b.WriteString(a.H + "," + a.V + "," + strconv.FormatBool(a.Wrap))
	} else {
		b.WriteByte('-')
	}
	b.WriteString("|" + s.Fill + "|" + strconv.FormatBool(s.Border))
	return b.String()
}

// xRun: 1 đoạn của ô richText. Font nil = đoạn không khai báo font; font rỗng vẫn ghi <rPr/> như ExcelJS.
type xRun struct {
	Text string
	Font *xFont
}

type xCell struct {
	val    any // nil | string | float64 | bool | []xRun
	st     *xStyle
	master *xCell // khác nil: ô bị gộp, giá trị nằm ở ô chính
}

// set = cell.value = v, chọn kiểu ô như Value.getType của ExcelJS: null / undefined -> ô trống;
// object và mảng -> chuỗi JSON.stringify (kiểu JSON của ExcelJS ghi ra file là chuỗi).
func (c *xCell) set(v any) {
	if c.master != nil {
		c = c.master
	}
	switch x := v.(type) {
	case nil:
		c.val = nil
	case string, bool, []xRun, jsFunc:
		c.val = x
	case float64:
		c.val = x
	default:
		if jsval.IsUndefined(v) {
			c.val = nil
			return
		}
		if jsval.IsNumber(v) {
			c.val = jsval.ToNumber(v)
			return
		}
		js, err := omap.MarshalString(v)
		if err != nil {
			js = jsval.ToString(v)
		}
		c.val = js
	}
}

func (c *xCell) font(f xFont)     { c.st.Font = &f }
func (c *xCell) align(a xAlign)   { c.st.Align = &a }
func (c *xCell) fill(argb string) { c.st.Fill = argb }
func (c *xCell) border()          { c.st.Border = true }
func (c *xCell) numFmt(s string)  { c.st.NumFmt = s }

type xRow struct {
	ht    float64 // 0 = chưa đặt
	cells map[int]*xCell
}

type xImage struct {
	buf                      []byte
	ext                      string // png | jpeg
	col, colOff, row, rowOff int    // xdr:from (cột / dòng tính từ 0, lệch tính bằng EMU)
}

type xSheet struct {
	name   string
	widths map[int]float64
	rows   map[int]*xRow
	merges [][4]int // top, left, bottom, right
	ySplit int      // > 0: cố định ySplit dòng đầu
	images []xImage
	pend   []pendImg // ảnh chờ tải (bảng dep của buildBang): BuildBangXlsx tải rồi nhúng; không ghi ra file
}

// pendImg: ảnh của 1 ô (dòng, cột tính từ 1) cần tải theo url rồi nhúng.
type pendImg struct {
	row, col int
	url      string
}

type xBook struct {
	sheets []*xSheet
}

var (
	reSheetBad   = regexp.MustCompile(`[*?:/\\\[\]]`)
	reSheetQuote = regexp.MustCompile(`(^')|('$)`)
)

// addWorksheet = wb.addWorksheet(name) kèm các kiểm tra của setter name trong ExcelJS (worksheet.js:134-174).
func (b *xBook) addWorksheet(name string) (*xSheet, error) {
	switch {
	case name == "":
		return nil, apperr.New("The name can't be empty.")
	case name == "History":
		return nil, apperr.New(`The name "History" is protected. Please use a different name.`)
	case reSheetBad.MatchString(name):
		return nil, apperr.New("Worksheet name " + name + ` cannot include any of the following characters: * ? : \ / [ ]`)
	case reSheetQuote.MatchString(name):
		return nil, apperr.New("The first or last character of worksheet name cannot be a single quotation mark: " + name)
	}
	if jsval.Len16(name) > 31 {
		name = jsval.Substring(name, 0, 31)
	}
	low := jsLower(name)
	for _, ws := range b.sheets {
		if jsLower(ws.name) == low {
			return nil, apperr.New("Worksheet name already exists: " + name)
		}
	}
	ws := &xSheet{name: name, widths: map[int]float64{}, rows: map[int]*xRow{}}
	b.sheets = append(b.sheets, ws)
	return ws, nil
}

func (ws *xSheet) row(r int) *xRow {
	x := ws.rows[r]
	if x == nil {
		x = &xRow{cells: map[int]*xCell{}}
		ws.rows[r] = x
	}
	return x
}

// cell = ws.getCell(r, c): tạo ô nếu chưa có (ô đã được chạm tới sẽ mang style của nó ra file).
func (ws *xSheet) cell(r, c int) *xCell {
	row := ws.row(r)
	x := row.cells[c]
	if x == nil {
		x = &xCell{st: &xStyle{}}
		row.cells[c] = x
	}
	return x
}

// setWidths = ws.columns = [{width}, ...].
func (ws *xSheet) setWidths(w []float64) {
	for i, x := range w {
		ws.widths[i+1] = x
	}
}

// merge = ws.mergeCells(top, left, bottom, right): ô phụ trỏ về ô chính và dùng CHUNG style với nó.
// Gộp đúng 1 ô (bảng chỉ có 1 cột): ExcelJS không ghi gì ra file.
func (ws *xSheet) merge(top, left, bottom, right int) {
	m := ws.cell(top, left)
	if top == bottom && left == right {
		return
	}
	for r := top; r <= bottom; r++ {
		for c := left; c <= right; c++ {
			if r == top && c == left {
				continue
			}
			x := ws.cell(r, c)
			x.val, x.master, x.st = nil, m, m.st
		}
	}
	ws.merges = append(ws.merges, [4]int{top, left, bottom, right})
}

// addImage = ws.addImage(id, {tl: {col, row}, ext: {width: 60, height: 48}}). Phần lẻ của col / row đổi ra EMU theo
// bề rộng cột / chiều cao dòng TẠI LÚC GỌI (anchor.js:44-72), giữ đúng phép tính dấu phẩy động của JS (0.1 -> 10999, 39999).
func (ws *xSheet) addImage(buf []byte, ext string, col, row float64) {
	nc := math.Floor(col)
	cw := 640000.0
	if w, ok := ws.widths[int(nc)+1]; ok && w != 9 {
		cw = math.Floor(w * 10000)
	}
	nr := math.Floor(row)
	rh := 180000.0
	if r := ws.rows[int(nr)+1]; r != nil && r.ht != 0 {
		rh = math.Floor(r.ht * 10000)
	}
	ws.images = append(ws.images, xImage{buf: buf, ext: ext,
		col: int(nc), colOff: int(math.Floor((col - nc) * cw)), row: int(nr), rowOff: int(math.Floor((row - nr) * rh))})
}

func cellName(col, row int) string {
	s, _ := excelize.CoordinatesToCellName(col, row)
	return s
}

func ptr[T any](v T) *T { return &v }

// xlsStr: chuỗi như đọc lại từ file của ExcelJS - xmlEncode bỏ ký tự điều khiển (0-8, 11, 12, 14-31, 127),
// còn CR ghi thẳng vào XML nên bộ đọc chuẩn hoá CRLF / CR thành LF.
func xlsStr(s string) string {
	if !strings.ContainsFunc(s, func(r rune) bool { return r < 32 && r != 9 && r != 10 || r == 127 }) {
		return s
	}
	var b strings.Builder
	rs := []rune(s)
	for i, r := range rs {
		switch {
		case r == 13:
			if i+1 >= len(rs) || rs[i+1] != 10 {
				b.WriteByte(10)
			}
		case r < 32 && r != 9 && r != 10, r == 127:
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

var reBstr = regexp.MustCompile(`_x[0-9A-Fa-f]{4}_`)

// heldStrs: chuỗi excelize sẽ làm sai (dài hơn 32767 đơn vị UTF-16 bị cắt, cụm _xHHHH_ bị thêm escape) - ExcelJS ghi nguyên.
// Ô nhận một chuỗi giữ chỗ, patch() thay lại chuỗi thật trong bảng shared strings trước khi ghi file.
type heldStrs struct {
	full map[string]string // giữ chỗ -> chuỗi thật
	hold map[string]string // chuỗi thật -> giữ chỗ
}

func (l *heldStrs) of(s string) string {
	s = xlsStr(s)
	if jsval.Len16(s) <= excelize.TotalCellChars && !reBstr.MatchString(s) {
		return s
	}
	if h, ok := l.hold[s]; ok {
		return h
	}
	if l.full == nil {
		l.full, l.hold = map[string]string{}, map[string]string{}
	}
	// \x01 không thể có trong chuỗi đã qua xlsStr nên không trùng chuỗi của người dùng
	h := "\x01" + strconv.Itoa(len(l.full))
	l.full[h], l.hold[s] = s, h
	return h
}

func xlFont(f *xFont) *excelize.Font {
	if f == nil {
		return nil
	}
	x := &excelize.Font{Bold: f.Bold, Italic: f.Italic, Family: f.Name, Size: f.Size}
	if f.Color != "" {
		x.Color = f.Color[2:]
	}
	return x
}

func xlStyle(s *xStyle) *excelize.Style {
	st := &excelize.Style{Font: xlFont(s.Font)}
	switch s.NumFmt {
	case "":
	case "#,##0":
		st.NumFmt = 3 // mã dựng sẵn, ExcelJS cũng ghi numFmtId="3"
	default:
		st.CustomNumFmt = ptr(s.NumFmt)
	}
	if s.Fill != "" {
		st.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{s.Fill[2:]}}
	}
	if s.Border {
		for _, side := range []string{"left", "right", "top", "bottom"} {
			st.Border = append(st.Border, excelize.Border{Type: side, Color: mauLine[2:], Style: 1})
		}
	}
	if a := s.Align; a != nil {
		v := a.V
		if v == "middle" {
			v = "center"
		}
		st.Alignment = &excelize.Alignment{Horizontal: a.H, Vertical: v, WrapText: a.Wrap}
	}
	return st
}

func sortedKeys[V any](m map[int]V) []int {
	ks := make([]int, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Ints(ks)
	return ks
}

// write = wb.xlsx.writeBuffer().
func (b *xBook) write() ([]byte, error) {
	for _, ws := range b.sheets {
		for _, row := range ws.rows {
			for _, c := range row.cells {
				if _, ok := c.val.(jsFunc); ok {
					// shared-strings-xform.js:38 đọc .richText của JSON.stringify(hàm) = undefined
					return nil, apperr.New("Cannot read properties of undefined (reading 'richText')")
				}
			}
		}
	}
	f := excelize.NewFile()
	defer f.Close()
	styles := map[string]int{}
	var held heldStrs
	var firstErr error
	do := func(err error) {
		if firstErr == nil && err != nil {
			firstErr = err
		}
	}
	for i, ws := range b.sheets {
		sh := ws.name
		if i == 0 {
			do(f.SetSheetName("Sheet1", sh))
		} else {
			_, err := f.NewSheet(sh)
			do(err)
		}
		if firstErr != nil {
			return nil, firstErr
		}
		// ExcelJS luôn ghi sheetFormatPr, pageMargins và pageSetup mặc định
		do(f.SetSheetProps(sh, &excelize.SheetPropsOptions{DefaultRowHeight: ptr(15.0)}))
		do(f.SetPageMargins(sh, &excelize.PageLayoutMarginsOptions{
			Left: ptr(0.7), Right: ptr(0.7), Top: ptr(0.75), Bottom: ptr(0.75), Header: ptr(0.3), Footer: ptr(0.3),
		}))
		do(f.SetPageLayout(sh, &excelize.PageLayoutOptions{
			Orientation: ptr("portrait"), AdjustTo: ptr(uint(100)), FitToWidth: ptr(1), FitToHeight: ptr(1),
		}))
		for _, c := range sortedKeys(ws.widths) {
			// ExcelJS coi độ rộng 9 là mặc định và KHÔNG ghi thẻ <col> cho cột đó
			if w := ws.widths[c]; w != 9 {
				name, _ := excelize.ColumnNumberToName(c)
				do(f.SetColWidth(sh, name, name, w))
			}
		}
		for _, m := range ws.merges {
			do(f.MergeCell(sh, cellName(m[1], m[0]), cellName(m[3], m[2])))
		}
		maxC, maxR := 0, 0
		for _, r := range sortedKeys(ws.rows) {
			row := ws.rows[r]
			if row.ht != 0 {
				do(f.SetRowHeight(sh, r, row.ht))
			}
			for _, c := range sortedKeys(row.cells) {
				cell := row.cells[c]
				at := cellName(c, r)
				used := cell.master != nil
				switch v := cell.val.(type) {
				case nil:
				case string:
					used = true
					do(f.SetCellStr(sh, at, held.of(v)))
				case float64:
					used = true
					// đúng chuỗi số của JS (ExcelJS ghi String(number) vào <v>). NaN / Infinity: ExcelJS vẫn ghi <v>NaN</v> vào Ô SỐ;
					// excelize đổi giá trị không phải số thành chuỗi inline, fixSheet (reSoLaCell) trả lại dạng ô số.
					do(f.SetCellDefault(sh, at, jsval.NumberToString(v)))
				case bool:
					used = true
					do(f.SetCellBool(sh, at, v))
				case []xRun:
					used = true
					runs := make([]excelize.RichTextRun, len(v))
					for j, run := range v {
						runs[j] = excelize.RichTextRun{Text: held.of(run.Text), Font: xlFont(run.Font)}
					}
					do(f.SetCellRichText(sh, at, runs))
				}
				if !cell.st.empty() {
					used = true
					k := cell.st.key()
					id, ok := styles[k]
					if !ok {
						var err error
						id, err = f.NewStyle(xlStyle(cell.st))
						do(err)
						styles[k] = id
					}
					do(f.SetCellStyle(sh, at, at, id))
				}
				if used {
					maxC, maxR = max(maxC, c), max(maxR, r)
				}
			}
		}
		if ws.ySplit > 0 {
			do(f.SetPanes(sh, &excelize.Panes{
				Freeze: true, YSplit: ws.ySplit, TopLeftCell: cellName(1, ws.ySplit+1), ActivePane: "bottomLeft",
				Selection: []excelize.Selection{{Pane: "bottomLeft"}},
			}))
		}
		// excelize để nguyên <dimension ref="A1">; ExcelJS ghi đúng vùng có ô
		if maxC > 0 {
			do(f.SetSheetDimension(sh, "A1:"+cellName(maxC, maxR)))
		}
		if firstErr != nil {
			return nil, firstErr
		}
	}

	// ExcelJS chỉ ghi các thuộc tính font được đặt; excelize luôn thêm <family> và <color> rỗng.
	// Font mặc định (số 0) của ExcelJS có thêm <scheme val="minor"/>.
	if st := f.Styles; st != nil && st.Fonts != nil {
		for i, fnt := range st.Fonts.Font {
			if i == 0 && fnt != nil && fnt.Name != nil && fnt.Scheme == nil {
				sch := *fnt.Name
				sch.Val = ptr("minor")
				fnt.Scheme = &sch
			}
			if i > 0 && fnt != nil {
				fnt.Family = nil
				if fnt.Color != nil && fnt.Color.RGB == "" {
					fnt.Color = nil
				}
			}
		}
	}
	// Style không căn lề: excelize ghi <alignment/> rỗng kèm applyAlignment="false", ExcelJS không ghi gì.
	if st := f.Styles; st != nil && st.CellXfs != nil {
		for i := range st.CellXfs.Xf {
			if xf := &st.CellXfs.Xf[i]; xf.Alignment != nil && reflect.ValueOf(*xf.Alignment).IsZero() {
				xf.Alignment, xf.ApplyAlignment = nil, nil
			}
		}
	}
	if sst := f.SharedStrings; sst != nil {
		fix := func(t *string, space *xml.Attr) {
			s, ok := held.full[*t]
			if !ok {
				return
			}
			*t = s
			if strings.ContainsRune(" \t\n", rune(s[0])) || strings.ContainsRune(" \t\n", rune(s[len(s)-1])) {
				*space = xml.Attr{Name: xml.Name{Space: excelize.NameSpaceXML, Local: "space"}, Value: "preserve"}
			}
		}
		for i := range sst.SI {
			si := &sst.SI[i]
			if si.T != nil {
				fix(&si.T.Val, &si.T.Space)
			}
			for j := range si.R {
				run := &si.R[j]
				if run.T != nil {
					fix(&run.T.Val, &run.T.Space)
				}
				if p := run.RPr; p != nil {
					p.Family = nil
					if p.Color != nil && p.Color.RGB == "" {
						p.Color = nil
					}
				}
			}
		}
	}
	if wb := f.WorkBook; wb != nil {
		wb.BookViews = nil
		if wb.CalcPr != nil {
			wb.CalcPr.CalcID = 171027 // số ExcelJS ghi
		}
	}
	f.Pkg.Store("docProps/app.xml", []byte(b.appXML()))
	// excelize.SetDocProps ghi <lastModifiedBy> không kèm tiền tố cp: - ExcelJS 4.4 không đọc được file như vậy,
	// nên phần này ghi thẳng theo đúng dạng ExcelJS xuất ra (workbook không đặt creator -> "Unknown").
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	f.Pkg.Store("docProps/core.xml", []byte(coreXMLHead+now+coreXMLMid+now+coreXMLTail))
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return b.repack(buf.Bytes())
}

const (
	coreXMLHead = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Unknown</dc:creator><dc:title></dc:title><dc:subject></dc:subject><dc:description></dc:description><cp:keywords></cp:keywords><cp:category></cp:category><cp:lastModifiedBy>Unknown</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">`
	coreXMLMid  = `</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">`
	coreXMLTail = `</dcterms:modified></cp:coreProperties>`
)

func xmlEsc(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// docProps/app.xml theo dạng ExcelJS ghi (danh sách tên sheet).
func (b *xBook) appXML() string {
	n := strconv.Itoa(len(b.sheets))
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>` + n + `</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="` + n + `" baseType="lpstr">`)
	for _, ws := range b.sheets {
		sb.WriteString("<vt:lpstr>" + xmlEsc(ws.name) + "</vt:lpstr>")
	}
	sb.WriteString(`</vt:vector></TitlesOfParts><Company></Company><Manager></Manager><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`)
	return sb.String()
}

var (
	reWorksheetTag = regexp.MustCompile(`<worksheet [^>]*>`)
	reDongRong     = regexp.MustCompile(`<row r="\d+"></row>`)
	reSheetFile    = regexp.MustCompile(`^xl/worksheets/sheet(\d+)\.xml$`)
	reSheetFmt     = regexp.MustCompile(`<sheetFormatPr defaultRowHeight="15"([^>]*)>`)
	reTabSelected  = regexp.MustCompile(` tabSelected="(true|1)"`)
	reSoLaCell     = regexp.MustCompile(`(<c [^>]*?) t="inlineStr"([^>]*)><is><t>(NaN|-?Infinity)</t></is></c>`)
	sheetViewRong  = []byte(`<sheetViews><sheetView workbookViewId="0"></sheetView></sheetViews>`)
)

const (
	relNS      = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	relsHead   = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	drawingCT  = "application/vnd.openxmlformats-officedocument.drawing+xml"
	drawingXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
)

// anchorXML: 1 ảnh trong drawing, đúng dạng ExcelJS ghi (oneCellAnchor, ext 60 x 48 px = 571500 x 457200 EMU).
func anchorXML(im xImage, n int) string {
	i := strconv.Itoa
	return `<xdr:oneCellAnchor editAs="oneCell"><xdr:from><xdr:col>` + i(im.col) + `</xdr:col><xdr:colOff>` + i(im.colOff) +
		`</xdr:colOff><xdr:row>` + i(im.row) + `</xdr:row><xdr:rowOff>` + i(im.rowOff) + `</xdr:rowOff></xdr:from>` +
		`<xdr:ext cx="571500" cy="457200"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="` + i(n) + `" name="Picture ` + i(n) + `">` +
		`<a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{00000000-0008-0000-0000-000002000000}"/></a:ext></a:extLst></xdr:cNvPr>` +
		`<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="` + relNS + `" r:embed="rId` + i(n) + `" cstate="print"/>` +
		`<a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
}

type zipPart struct {
	name string
	data []byte
}

// repack sửa các phần excelize ghi khác ExcelJS rồi đóng gói lại file (.xlsx là zip):
//   - sheetFormatPr có x14ac:dyDescent="55" (kèm khai báo namespace), bỏ tabSelected, bỏ sheetViews rỗng và dòng không có ô;
//   - ảnh: excelize phải giải mã được ảnh và chỉ đặt lệch theo pixel, còn ExcelJS nhúng nguyên buffer với lệch tính bằng EMU,
//     nên media / drawing / rels được ghi thẳng ở đây (mỗi lần addImage là 1 file media riêng, không gộp ảnh trùng).
func (b *xBook) repack(src []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(src), int64(len(src)))
	if err != nil {
		return nil, err
	}
	var extra []zipPart
	exts := map[string]bool{}
	var extOrder []string
	nMedia, nDrawing := 0, 0
	drawingOf := map[int]int{} // sheet (từ 1) -> drawing
	for si, ws := range b.sheets {
		if len(ws.images) == 0 {
			continue
		}
		nDrawing++
		drawingOf[si+1] = nDrawing
		var dx, rels strings.Builder
		dx.WriteString(drawingXML)
		rels.WriteString(relsHead)
		for j, im := range ws.images {
			nMedia++
			file := "image" + strconv.Itoa(nMedia) + "." + im.ext
			if !exts[im.ext] {
				exts[im.ext] = true
				extOrder = append(extOrder, im.ext)
			}
			extra = append(extra, zipPart{"xl/media/" + file, im.buf})
			dx.WriteString(anchorXML(im, j+1))
			rels.WriteString(`<Relationship Id="rId` + strconv.Itoa(j+1) + `" Type="` + relNS + `/image" Target="../media/` + file + `"/>`)
		}
		dx.WriteString("</xdr:wsDr>")
		rels.WriteString("</Relationships>")
		d := strconv.Itoa(nDrawing)
		extra = append(extra,
			zipPart{"xl/drawings/drawing" + d + ".xml", []byte(dx.String())},
			zipPart{"xl/drawings/_rels/drawing" + d + ".xml.rels", []byte(rels.String())},
			zipPart{"xl/worksheets/_rels/sheet" + strconv.Itoa(si+1) + ".xml.rels", []byte(relsHead +
				`<Relationship Id="rId1" Type="` + relNS + `/drawing" Target="../drawings/drawing` + d + `.xml"/></Relationships>`)})
	}

	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	put := func(name string, data []byte) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	for _, zf := range zr.File {
		rc, err := zf.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		if m := reSheetFile.FindStringSubmatch(zf.Name); m != nil {
			n, _ := strconv.Atoi(m[1])
			data = b.fixSheet(data, drawingOf[n])
		} else if zf.Name == "[Content_Types].xml" && nDrawing > 0 {
			var add strings.Builder
			for _, e := range extOrder {
				add.WriteString(`<Default Extension="` + e + `" ContentType="image/` + e + `"/>`)
			}
			for d := 1; d <= nDrawing; d++ {
				add.WriteString(`<Override PartName="/xl/drawings/drawing` + strconv.Itoa(d) + `.xml" ContentType="` + drawingCT + `"/>`)
			}
			data = bytes.Replace(data, []byte("</Types>"), []byte(add.String()+"</Types>"), 1)
		}
		if err := put(zf.Name, data); err != nil {
			return nil, err
		}
	}
	for _, p := range extra {
		if err := put(p.name, p.data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (b *xBook) fixSheet(data []byte, drawing int) []byte {
	if tag := reWorksheetTag.Find(data); tag != nil && !bytes.Contains(tag, []byte("xmlns:x14ac")) {
		moi := append([]byte{}, tag[:len(tag)-1]...)
		if !bytes.Contains(tag, []byte("xmlns:r=")) {
			moi = append(moi, ` xmlns:r="`+relNS+`"`...)
		}
		if !bytes.Contains(tag, []byte("xmlns:mc=")) {
			moi = append(moi, ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac"`...)
		}
		moi = append(moi, ` xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">`...)
		data = bytes.Replace(data, tag, moi, 1)
		data = reSheetFmt.ReplaceAll(data, []byte(`<sheetFormatPr defaultRowHeight="15"${1} x14ac:dyDescent="55">`))
	}
	// chuỗi thường đi qua shared strings nên ô inlineStr mang NaN / Infinity chỉ có thể là ô số ghi ở Write
	data = reSoLaCell.ReplaceAll(data, []byte(`${1}${2}><v>${3}</v></c>`))
	data = reTabSelected.ReplaceAll(data, nil)
	data = bytes.Replace(data, sheetViewRong, nil, 1)
	data = reDongRong.ReplaceAll(data, nil)
	if drawing > 0 {
		data = bytes.Replace(data, []byte("</worksheet>"), []byte(`<drawing r:id="rId1"></drawing></worksheet>`), 1)
	}
	return data
}
