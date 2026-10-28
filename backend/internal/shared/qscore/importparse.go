package qscore

import (
	"math"
	"strings"

	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/specs"
)

/*** ===== NHẬP HÀNG LOẠT TỪ FILE (Excel / CSV) ===== ***/

type importAlias struct {
	key   string
	names []string
}

// IMPORT_ALIAS, đúng thứ tự khoá (thứ tự quyết định cột nào khớp trước)
var importAliases = []importAlias{
	{"ten", []string{"TÊN SẢN PHẨM", "TÊN SP", "TÊN HÀNG", "TÊN", "NAME", "PRODUCT NAME", "PRODUCT"}},
	{"nhom", []string{"NHÓM", "NGÀNH HÀNG", "CATEGORY"}},
	{"hangMuc", []string{"HẠNG MỤC"}},
	{"thuongHieu", []string{"THƯƠNG HIỆU", "BRAND", "HÃNG"}},
	{"ncc", []string{"NHÀ CUNG CẤP", "NCC", "SUPPLIER"}},
	{"ma", []string{"MÃ SP", "MÃ SẢN PHẨM", "MÃ HÀNG", "MÃ", "CODE", "SKU"}},
	{"kichThuoc", []string{"KÍCH THƯỚC", "SIZE", "QUY CÁCH", "DIMENSION"}},
	{"dvt", []string{"ĐVT", "ĐƠN VỊ TÍNH", "ĐƠN VỊ", "UNIT"}},
	{"gia", []string{"ĐƠN GIÁ BÁN", "GIÁ BÁN LẺ", "ĐƠN GIÁ", "GIÁ BÁN", "GIÁ", "PRICE"}},
	{"moTa", []string{"MÔ TẢ", "DESCRIPTION", "GHI CHÚ"}},
	{"hinhAnh", []string{"LINK ẢNH", "HÌNH ẢNH", "ẢNH", "IMAGE", "URL ẢNH", "IMAGE URL"}},
}

// alias đã chuẩn hoá: [0] = normalize_, [1] = dạng tách từ
var aliasNorm = func() [][][2]string {
	out := make([][][2]string, len(importAliases))
	for i, a := range importAliases {
		for _, n := range a.names {
			nn := Normalize(n)
			out[i] = append(out[i], [2]string{nn, words(nn)})
		}
	}
	return out
}()

// n.replace(/[^A-Z0-9]+/g, ' ').trim()
func words(n string) string {
	var b strings.Builder
	gap := false
	for i := 0; i < len(n); i++ {
		c := n[i]
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			if gap && b.Len() > 0 {
				b.WriteByte(' ')
			}
			gap = false
			b.WriteByte(c)
		} else {
			gap = true
		}
	}
	return b.String()
}

// matchAlias_: tiêu đề cột -> khoá trường ("" nếu không khớp).
func matchAlias(h any) string {
	n := Normalize(h)
	if n == "" {
		return ""
	}
	for i, a := range aliasNorm {
		for _, p := range a {
			if n == p[0] {
				return importAliases[i].key
			}
		}
	}
	// Khớp theo NGUYÊN TỪ (không khớp chuỗi con): "ẢNH" không được khớp nhầm vào "BẢO HÀNH", "MÃ" vào "MÀU SẮC"...
	w := " " + words(n) + " "
	for i, a := range aliasNorm {
		for _, p := range a {
			if p[1] != "" && strings.Contains(w, " "+p[1]+" ") {
				return importAliases[i].key
			}
		}
	}
	return ""
}

/*
oChu_: ô SỐ của Excel có phần thập phân -> ghi kiểu VN (dấu phẩy thập phân). Nếu để "12.125" thì ToNumber hiểu

	dấu chấm là hàng nghìn (12125). Số nguyên và ô chữ giữ nguyên.
*/
func oChu(v any) string {
	if jsval.IsNullish(v) {
		return ""
	}
	s := jsval.ToString(v)
	if f, ok := v.(float64); ok && !math.IsInf(f, 0) && f == f && f != math.Trunc(f) {
		s = strings.Replace(s, ".", ",", 1)
	}
	return jsval.Trim(s)
}

// pick2_: ô theo chỉ số cột (idx < 0: không có cột)
func pick2(row []any, idx int) string {
	if idx < 0 || idx >= len(row) {
		return ""
	}
	return oChu(row[idx])
}

// thuộc tính có sẵn của Object.prototype: seenH[h] "truthy" dù chưa gán
var objectProto = map[string]bool{"constructor": true, "toString": true, "valueOf": true, "hasOwnProperty": true,
	"isPrototypeOf": true, "propertyIsEnumerable": true, "toLocaleString": true, "__proto__": true,
	"__defineGetter__": true, "__defineSetter__": true, "__lookupGetter__": true, "__lookupSetter__": true}

// Buffer.from(s, 'base64'): bỏ qua ký tự lạ, nhận cả bảng url-safe, dừng ở dấu '=' đầu tiên.
func decodeBase64(s string) []byte {
	out := make([]byte, 0, len(s)*3/4)
	var acc uint32
	n := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		var v uint32
		switch {
		case c >= 'A' && c <= 'Z':
			v = uint32(c - 'A')
		case c >= 'a' && c <= 'z':
			v = uint32(c-'a') + 26
		case c >= '0' && c <= '9':
			v = uint32(c-'0') + 52
		case c == '+' || c == '-':
			v = 62
		case c == '/' || c == '_':
			v = 63
		case c == '=':
			i = len(s)
			continue
		default:
			continue
		}
		acc = acc<<6 | v
		if n++; n == 4 {
			out = append(out, byte(acc>>16), byte(acc>>8), byte(acc))
			acc, n = 0, 0
		}
	}
	switch n {
	case 2:
		out = append(out, byte(acc>>4))
	case 3:
		out = append(out, byte(acc>>10), byte(acc>>2))
	}
	return out
}

// specOf: bộ thông số theo hạng mục của ngành - 'vs' (thiết bị vệ sinh) · 'son' (sơn nước) · 'ct' (công tắc - ổ cắm)
// · 'dl' (điện lạnh, chỉ bản Go)
func specOf(nganh any) *specs.Spec {
	switch nganh {
	case "vs":
		return specs.VS
	case "son":
		return specs.SON
	case "ct":
		return specs.CT
	case "dl":
		return specs.DL
	}
	return nil
}

const maxImportRows = 2000

/*
ImportParse = importParse(base64, ext, nganh): đọc file nhập hàng loạt, trả

	{count, products, mapped, headers}.
	Thiết bị đèn: chỉ đọc sheet đầu. Ngành có bộ thông số (vs / son / ct / dl): đọc MỌI sheet (trừ "Hướng dẫn"),
	ô HẠNG MỤC trống thì lấy theo tên sheet.
*/
func ImportParse(base64Data, ext, nganh any) (*omap.Map, error) {
	buf := decodeBase64(jsval.StrOr(base64Data, ""))
	var all []*sheet
	var err error
	if strings.Contains(strings.ToLower(jsval.StrOr(ext, "")), "csv") {
		all, err = readCSV(buf)
	} else {
		all, err = readXLSX(buf)
	}
	if err != nil {
		return nil, err
	}
	if len(all) == 0 {
		return nil, apperr.New("File không có sheet dữ liệu")
	}
	spec := specOf(nganh)
	vs := spec != nil
	sheets := all[:1]
	if vs {
		sheets = nil
		for _, w := range all {
			if Normalize(w.name) != "HUONG DAN" {
				sheets = append(sheets, w)
			}
		}
	}
	products := []any{}
	headerList := []any{}
	seenH := map[string]bool{}
	mapped := omap.New()
	found := false
	for _, ws := range sheets {
		grid := ws.grid
		if len(grid) == 0 {
			continue
		}
		hr := -1
		var keys []string // khoá theo thứ tự cột khớp đầu tiên
		var cols map[string]int
		for i := 0; i < len(grid) && i < 15; i++ {
			m := map[string]int{}
			var ks []string
			for ci, h := range grid[i] {
				if key := matchAlias(h); key != "" {
					if _, ok := m[key]; !ok {
						m[key] = ci
						ks = append(ks, key)
					}
				}
			}
			if _, ok := m["ten"]; ok {
				hr, cols, keys = i, m, ks
				break
			}
		}
		if hr < 0 {
			continue
		}
		found = true
		col := func(k string) int {
			if i, ok := cols[k]; ok {
				return i
			}
			return -1
		}
		headers := make([]string, len(grid[hr]))
		for i, h := range grid[hr] {
			headers[i] = jsval.Trim(jsval.Str(h))
		}
		for _, h := range headers {
			if h != "" && !seenH[h] && !objectProto[h] {
				seenH[h] = true
				headerList = append(headerList, h)
			}
		}
		for _, k := range keys {
			if !jsval.Truthy(mapped.Val(k)) {
				mapped.Set(k, headers[cols[k]])
			}
		}
		hmSheet := ""
		if vs {
			hmSheet = spec.ChuanHM(ws.name)
		}
		for r := hr + 1; r < len(grid); r++ {
			row := grid[r]
			ten := pick2(row, col("ten"))
			if ten == "" {
				continue
			}
			if vs && strings.HasPrefix(ten, spec.VD) { // dòng ví dụ của file mẫu
				continue
			}
			// _raw: giữ nguyên MỌI cột theo tiêu đề gốc để importCommit map đầy đủ trường (thông số đèn / vệ sinh)
			raw := omap.New()
			for ci, h := range headers {
				if h != "" && h != "__proto__" {
					raw.Set(h, pick2(row, ci))
				}
			}
			if vs {
				const hmKey = "HẠNG MỤC"
				if !jsval.Truthy(raw.Val(hmKey)) && hmSheet != "" {
					raw.Set(hmKey, hmSheet)
				}
				if cur := raw.Val(hmKey); jsval.Truthy(cur) {
					if hm := spec.ChuanHM(cur); hm != "" {
						raw.Set(hmKey, hm)
					}
				}
			}
			var hangMuc any
			if vs {
				hangMuc = jsval.Or(raw.Val("HẠNG MỤC"), "")
			} else {
				hangMuc = pick2(row, col("hangMuc"))
			}
			dvt := pick2(row, col("dvt"))
			if dvt == "" {
				dvt = "Cái"
			}
			var nganhOut any = omap.Undefined
			if vs {
				nganhOut = nganh
			}
			products = append(products, omap.Of(
				"ten", ten, "nhom", pick2(row, col("nhom")), "hangMuc", hangMuc, "thuongHieu", pick2(row, col("thuongHieu")),
				"ncc", pick2(row, col("ncc")), "ma", pick2(row, col("ma")), "kichThuoc", pick2(row, col("kichThuoc")),
				"dvt", dvt, "gia", Round0Num(ToNumber(pick2(row, col("gia")))),
				"moTa", pick2(row, col("moTa")), "hinhAnh", pick2(row, col("hinhAnh")), "_raw", raw,
				"_sheet", ws.name, "_nganh", nganhOut))
			if len(products) >= maxImportRows {
				break
			}
		}
		if len(products) >= maxImportRows {
			break
		}
	}
	if !found {
		return nil, apperr.New(`Không tìm thấy cột "Tên sản phẩm" trong file (cần 1 cột tiêu đề có chữ Tên / Name)`)
	}
	if vs && !seenH["HẠNG MỤC"] {
		at := min(2, len(headerList))
		headerList = append(headerList[:at], append([]any{"HẠNG MỤC"}, headerList[at:]...)...)
	}
	return omap.Of("count", float64(len(products)), "products", products, "mapped", mapped, "headers", headerList), nil
}
