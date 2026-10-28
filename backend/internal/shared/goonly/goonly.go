// Package goonly: bỏ các khoá / cột "chỉ bản Go" khỏi dữ liệu trước khi so với golden do bản Node sinh ra.
//
// Golden Node không sinh lại được (bản Node đã gỡ). Khi bản Go thêm cột mới (vd purchase_orders.resolver_name)
// hay khoá kết quả mới, dòng đọc từ database và log ghi của bản Go có thêm khoá mà golden không có.
// Mỗi gói test tự khai danh sách khoá của mình (goOnlyKeys) rồi gọi Strip / StripNull / StripWrites trước khi so.
// Danh sách khoá chỉ bản Go: backend/docs/ARCHITECTURE.md mục 10.4.
//
// Hàm KHÔNG sửa giá trị đầu vào: map / mảng được dựng lại, giá trị lá dùng chung.
package goonly

import (
	"strings"

	"qspro-backend/internal/shared/omap"
)

// dropFn: true = bỏ khoá k (giá trị v) khỏi object.
type dropFn func(k string, v any) bool

// Strip bỏ các khoá keys ở mọi cấp của v (object *omap.Map hoặc map[string]any, mảng []any / []*omap.Map /
// []map[string]any), BẤT KỂ giá trị. Thứ tự các khoá còn lại giữ nguyên. Giá trị khác trả nguyên.
// Khoá có thể mang giá trị do bản Go ghi mà golden không kiểm được thì nên dùng StripNull để phép so vẫn bắt ghi sai.
func Strip(v any, keys ...string) any {
	if len(keys) == 0 {
		return v
	}
	ks := set(keys)
	return strip(v, func(k string, _ any) bool { return ks[k] })
}

// StripNull như Strip nhưng chỉ bỏ khoá keys khi giá trị là null (nil hoặc omap.Undefined). Khoá có giá trị
// được giữ lại, nên phép so với golden (vốn không có khoá đó) báo khác: dùng cho cột mới mà ca golden phải để trống.
func StripNull(v any, keys ...string) any {
	if len(keys) == 0 {
		return v
	}
	ks := set(keys)
	return strip(v, func(k string, e any) bool { return ks[k] && (e == nil || omap.IsUndefined(e)) })
}

// StripEmpty như StripNull nhưng bỏ cả khi giá trị là chuỗi rỗng: dùng cho cột chỉ bản Go mà dòng của golden
// không có nên bản Go đọc ra "" (vd cột thông số ngành Điện lạnh trong khối raw của sản phẩm).
func StripEmpty(v any, keys ...string) any {
	if len(keys) == 0 {
		return v
	}
	ks := set(keys)
	return strip(v, func(k string, e any) bool { return ks[k] && (e == nil || omap.IsUndefined(e) || e == "") })
}

// StripWrites bỏ khoá keys khỏi payload của từng lệnh ghi trong log (mảng các lệnh, mỗi lệnh là một object
// như {m, table, a} hay {op, table, rows}). Payload = object con trực tiếp của lệnh, hoặc object là phần tử
// trực tiếp của một mảng con của lệnh (vd từng phần tử của a / rows). Lệnh có một payload chỉ gồm khoá chỉ bản Go
// - bị bỏ hết khoá thì thành rỗng - là lệnh ghi riêng của bản Go mà Node không có: bỏ cả lệnh.
// Object lồng SÂU hơn payload (vd giá trị cột JSON) bị bỏ hết khoá thì chỉ thành rỗng, không làm bỏ lệnh.
// Payload vốn đã rỗng không tính. log không phải mảng thì xử lý như Strip.
func StripWrites(log any, keys ...string) any {
	if len(keys) == 0 {
		return log
	}
	ks := set(keys)
	drop := dropFn(func(k string, _ any) bool { return ks[k] })
	switch l := log.(type) {
	case []any:
		out := make([]any, 0, len(l))
		for _, e := range l {
			if s, goOnly := stripEntry(e, drop); !goOnly {
				out = append(out, s)
			}
		}
		return out
	case []*omap.Map:
		out := make([]*omap.Map, 0, len(l))
		for _, e := range l {
			if s, goOnly := stripEntry(e, drop); !goOnly {
				out = append(out, s.(*omap.Map))
			}
		}
		return out
	case []map[string]any:
		out := make([]map[string]any, 0, len(l))
		for _, e := range l {
			if s, goOnly := stripEntry(e, drop); !goOnly {
				out = append(out, s.(map[string]any))
			}
		}
		return out
	}
	return strip(log, drop)
}

func set(keys []string) map[string]bool {
	m := make(map[string]bool, len(keys))
	for _, k := range keys {
		m[k] = true
	}
	return m
}

// stripEntry: bỏ khoá ở cấp của lệnh và mọi cấp dưới; goOnly = có payload (object con trực tiếp, hoặc object
// trong mảng con trực tiếp) vốn có khoá mà bị bỏ hết. Bản thân object lệnh (cấp 0) không xét rỗng.
func stripEntry(e any, drop dropFn) (any, bool) {
	switch m := e.(type) {
	case *omap.Map:
		if m == nil {
			return m, false
		}
		out := omap.NewSized(m.Len())
		goOnly := false
		m.Each(func(k string, v any) {
			if drop(k, v) {
				return
			}
			goOnly = goOnly || payloadEmptied(v, drop)
			out.Set(k, strip(v, drop))
		})
		return out, goOnly
	case map[string]any:
		if m == nil {
			return m, false
		}
		out := make(map[string]any, len(m))
		goOnly := false
		for k, v := range m {
			if drop(k, v) {
				continue
			}
			goOnly = goOnly || payloadEmptied(v, drop)
			out[k] = strip(v, drop)
		}
		return out, goOnly
	}
	return strip(e, drop), false
}

// payloadEmptied: v (con trực tiếp của lệnh) là payload bị bỏ hết khoá, hoặc là mảng có phần tử như vậy.
func payloadEmptied(v any, drop dropFn) bool {
	switch x := v.(type) {
	case []any:
		for _, e := range x {
			if objEmptied(e, drop) {
				return true
			}
		}
		return false
	case []*omap.Map:
		for _, e := range x {
			if e != nil && objEmptied(e, drop) {
				return true
			}
		}
		return false
	case []map[string]any:
		for _, e := range x {
			if objEmptied(e, drop) {
				return true
			}
		}
		return false
	}
	return objEmptied(v, drop)
}

// objEmptied: v là object có khoá và MỌI khoá cấp đầu của nó đều bị bỏ. Chỉ xét cấp đầu.
func objEmptied(v any, drop dropFn) bool {
	switch x := v.(type) {
	case *omap.Map:
		if x == nil || x.Len() == 0 {
			return false
		}
		all := true
		x.Each(func(k string, e any) { all = all && drop(k, e) })
		return all
	case map[string]any:
		if len(x) == 0 {
			return false
		}
		for k, e := range x {
			if !drop(k, e) {
				return false
			}
		}
		return true
	}
	return false
}

// strip trả bản đã bỏ các khoá mà drop chọn, ở mọi cấp.
func strip(v any, drop dropFn) any {
	switch x := v.(type) {
	case *omap.Map:
		if x == nil {
			return x
		}
		return stripOMap(x, drop)
	case map[string]any:
		if x == nil {
			return x
		}
		out := make(map[string]any, len(x))
		for k, e := range x {
			if !drop(k, e) {
				out[k] = strip(e, drop)
			}
		}
		return out
	case []any:
		if x == nil {
			return x
		}
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = strip(e, drop)
		}
		return out
	case []*omap.Map:
		if x == nil {
			return x
		}
		out := make([]*omap.Map, len(x))
		for i, e := range x {
			if e != nil {
				out[i] = stripOMap(e, drop)
			}
		}
		return out
	case []map[string]any:
		if x == nil {
			return x
		}
		out := make([]map[string]any, len(x))
		for i, e := range x {
			out[i], _ = strip(e, drop).(map[string]any)
		}
		return out
	}
	return v
}

func stripOMap(m *omap.Map, drop dropFn) *omap.Map {
	out := omap.NewSized(m.Len())
	m.Each(func(k string, e any) {
		if !drop(k, e) {
			out.Set(k, strip(e, drop))
		}
	})
	return out
}

const failingRow = "Failing row contains ("

// StripFailingRow bỏ giá trị của cột chỉ bản Go khỏi chi tiết lỗi ràng buộc của PostgreSQL
// ("Failing row contains (..., null, null)." kèm "new row for relation \"<bảng>\""): cột thêm bằng ADD COLUMN
// đứng CUỐI dòng, nên với bảng có cols[bảng] = n cột mới thì bỏ tối đa n giá trị null ở cuối bộ giá trị.
// Chỉ bỏ "null": cột mới mà có giá trị (bản Go đã ghi) thì giữ nguyên để phép so vẫn báo khác.
// Tên bảng là tên trong database (vd purchase_orders); chuỗi đã escape JSON một hay nhiều lần vẫn nhận ra.
func StripFailingRow(s string, cols map[string]int) string {
	if len(cols) == 0 {
		return s
	}
	var b strings.Builder
	pos := 0
	for {
		i := strings.Index(s[pos:], failingRow)
		if i < 0 {
			break
		}
		start := pos + i + len(failingRow)
		end := strings.Index(s[start:], ").")
		if end < 0 {
			break
		}
		end += start
		n := cols[relationAfter(s[end:])]
		body := s[start:end]
		for ; n > 0 && strings.HasSuffix(body, ", null"); n-- {
			body = body[:len(body)-len(", null")]
		}
		b.WriteString(s[pos:start])
		b.WriteString(body)
		pos = end
	}
	if pos == 0 {
		return s
	}
	b.WriteString(s[pos:])
	return b.String()
}

// relationAfter: tên bảng trong "relation \"x\"" đầu tiên của s, nếu nó đứng trước chi tiết lỗi kế tiếp.
func relationAfter(s string) string {
	const rel = "relation "
	k := strings.Index(s, rel)
	if k < 0 {
		return ""
	}
	if nx := strings.Index(s, failingRow); nx >= 0 && nx < k {
		return ""
	}
	t := strings.TrimLeft(s[k+len(rel):], `\"`)
	j := 0
	for j < len(t) && (t[j] == '_' || t[j] >= 'a' && t[j] <= 'z' || t[j] >= '0' && t[j] <= '9') {
		j++
	}
	return t[:j]
}
