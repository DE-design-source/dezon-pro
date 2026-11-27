package access

import (
	"strings"

	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// Set: quyền đã TRẢI RA theo danh mục: module -> tab (không có "*") -> tập thao tác (bit).
// Chỉ chứa ô khác 0; thao tác tab không hỗ trợ đã bị bỏ.
type Set map[string]map[string]mask

func (s Set) put(m, t string, b mask) {
	b &= tabMask[m][t]
	if b == 0 {
		return
	}
	if s[m] == nil {
		s[m] = map[string]mask{}
	}
	s[m][t] |= b
}

func (s Set) get(m, t string) mask { return s[m][t] }

// fullSet: mọi thao tác của mọi tab (super; công ty / admin chưa bị giới hạn).
func fullSet() Set {
	out := Set{}
	for _, m := range cat.Modules {
		for _, t := range m.Tabs {
			out.put(m.Key, t.Key, tabMask[m.Key][t.Key])
		}
	}
	return out
}

// intersect: giao các tập (thu quyền ở cấp trên thì cấp dưới tự mất).
func intersect(sets ...Set) Set {
	if len(sets) == 0 {
		return Set{}
	}
	out := Set{}
	for m, tabs := range sets[0] {
		for t, b := range tabs {
			for _, o := range sets[1:] {
				b &= o.get(m, t)
			}
			out.put(m, t, b)
		}
	}
	return out
}

// minus: ô của a không có trong b.
func minus(a, b Set) Set {
	out := Set{}
	for m, tabs := range a {
		for t, x := range tabs {
			out.put(m, t, x&^b.get(m, t))
		}
	}
	return out
}

// firstOutside: ô đầu tiên (theo thứ tự danh mục) có trong want mà không có trong have; ok = false khi want là tập con.
func firstOutside(want, have Set) (module, tab, action string, ok bool) {
	for _, m := range cat.Modules {
		for _, t := range m.Tabs {
			extra := want.get(m.Key, t.Key) &^ have.get(m.Key, t.Key)
			if extra == 0 {
				continue
			}
			for _, a := range cat.Actions {
				if extra&actionBit[a.Key] != 0 {
					return m.Key, t.Key, a.Key, true
				}
			}
		}
	}
	return "", "", "", false
}

// any: có thao tác act ở ít nhất 1 tab của module.
func (s Set) any(module string, act mask) bool {
	for _, b := range s[module] {
		if b&act != 0 {
			return true
		}
	}
	return false
}

// Out: dạng JSON trả client {"<module>": {"<tab>": ["view", ...]}}, đúng thứ tự danh mục, không có "*".
func (s Set) Out() *omap.Map {
	out := omap.New()
	for _, m := range cat.Modules {
		tabs := s[m.Key]
		if len(tabs) == 0 {
			continue
		}
		mo := omap.New()
		for _, t := range m.Tabs {
			if b := tabs[t.Key]; b != 0 {
				mo.Set(t.Key, actionsOf(b))
			}
		}
		out.Set(m.Key, mo)
	}
	return out
}

func actionsOf(b mask) []any {
	out := []any{}
	for _, a := range cat.Actions {
		if b&actionBit[a.Key] != 0 {
			out = append(out, a.Key)
		}
	}
	return out
}

// expand: grants đã lưu (dạng {"module": {"tab" | "*": [thao tác]}}) -> Set. Khoá / thao tác lạ bị bỏ qua
// (dữ liệu cũ sau khi danh mục đổi không làm hỏng việc đọc).
func expand(v any) Set {
	out := Set{}
	g, ok := v.(*omap.Map)
	if !ok {
		return out
	}
	for _, m := range cat.Modules {
		tabs, ok := g.Val(m.Key).(*omap.Map)
		if !ok {
			continue
		}
		star := maskOf(tabs.Val(TabAll))
		for _, t := range m.Tabs {
			out.put(m.Key, t.Key, star|maskOf(tabs.Val(t.Key)))
		}
	}
	return out
}

func maskOf(v any) mask {
	arr, _ := v.([]any)
	var b mask
	for _, x := range arr {
		if s, ok := x.(string); ok {
			b |= actionBit[s]
		}
	}
	return b
}

const msgShape = `Quyền phải có dạng {"phân hệ": {"tab": ["view", ...]}}`

// parseGrants: kiểm grants client gửi theo danh mục -> bản chuẩn hoá để lưu (đúng thứ tự danh mục, bỏ trùng,
// bỏ ô rỗng; giữ "*"). Khoá / thao tác lạ -> lỗi 400 tiếng Việt.
func parseGrants(v any) (*omap.Map, error) {
	g, ok := v.(*omap.Map)
	if !ok {
		return nil, apperr.BadRequest(msgShape)
	}
	for _, mk := range g.Keys() {
		m := modIdx[mk]
		if m == nil {
			return nil, apperr.BadRequest("Phân hệ không có trong danh mục quyền: " + mk)
		}
		tabs, ok := g.Val(mk).(*omap.Map)
		if !ok {
			return nil, apperr.BadRequest(msgShape)
		}
		for _, tk := range tabs.Keys() {
			allowed := modMask[mk]
			if tk != TabAll {
				if tabMask[mk][tk] == 0 {
					return nil, apperr.BadRequest("Tab không có trong phân hệ " + m.Label + ": " + tk)
				}
				allowed = tabMask[mk][tk]
			}
			arr, ok := tabs.Val(tk).([]any)
			if !ok {
				return nil, apperr.BadRequest(msgShape)
			}
			for _, x := range arr {
				s, ok := x.(string)
				if !ok || actionBit[s] == 0 {
					return nil, apperr.BadRequest("Thao tác không hợp lệ: " + jsval.ToString(x))
				}
				if allowed&actionBit[s] == 0 {
					return nil, apperr.BadRequest("Thao tác " + actionLabel(s) + " không áp dụng cho " + m.Label + " > " + tabName(m, tk))
				}
			}
		}
	}
	out := omap.New()
	for _, m := range cat.Modules {
		tabs, ok := g.Val(m.Key).(*omap.Map)
		if !ok {
			continue
		}
		mo := omap.New()
		if b := maskOf(tabs.Val(TabAll)); b != 0 {
			mo.Set(TabAll, actionsOf(b))
		}
		for _, t := range m.Tabs {
			if b := maskOf(tabs.Val(t.Key)); b != 0 {
				mo.Set(t.Key, actionsOf(b))
			}
		}
		if mo.Len() > 0 {
			out.Set(m.Key, mo)
		}
	}
	return out, nil
}

func tabName(m *Module, tab string) string {
	if tab == TabAll {
		return "Mọi tab"
	}
	return tabLabel(m, tab)
}

// ---------- tương thích cách cũ (chưa có dòng access_grants) ----------

// legacyFeatureModules: module bị khoá theo tính năng công ty (companies.features) - giống canPage của giao diện
// (services/workSession.js FEATURE_KEYS = tab QS + WORK_TABS; trang Mua hàng chung khoá 'muahang' với tab Mua hàng của QS).
// Module khác (newsfeed, chat, marketing, ...) không bị khoá theo công ty.
var legacyFeatureModules = map[string]bool{"kinhdoanh": true, "thietke": true, "thicong": true, "hr": true, "muahang": true}

// legacyQsModule: module QS - mỗi tab là 1 khoá tính năng / quyền cũ (PERM_TABS của store QS).
const legacyQsModule = "qs"

func splitList(v any) []string {
	out := []string{}
	for _, x := range strings.Split(jsval.Str(v), ",") {
		if x = jsval.Trim(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func grantModule(s Set, mk string) {
	if m := modIdx[mk]; m != nil {
		for _, t := range m.Tabs {
			s.put(mk, t.Key, tabMask[mk][t.Key])
		}
	}
}

// legacyCompany: trần công ty suy ra từ companies.features (tinh_nang). Rỗng = mọi thứ.
// Có danh sách: tab QS chỉ còn tab có trong danh sách; module khoá theo tính năng chỉ còn khi có khoá của nó;
// module còn lại giữ nguyên.
// legacyQsAlias: trang phụ của QS trước N21 dùng chung quyền tab cũ (store.js tabAlias): Dự án -> Danh sách dự án,
// Đơn vị thiết kế; Danh sách sản phẩm -> Nhà cung cấp.
var legacyQsAlias = map[string][]string{"duan": {"dsduan", "dsntk"}, "sanpham": {"dsncc"}}

// putQsLegacy: tab QS k (kèm các trang phụ dùng chung quyền của nó) với mọi thao tác tab hỗ trợ.
func putQsLegacy(out Set, k string) {
	for _, t := range append([]string{k}, legacyQsAlias[k]...) {
		if tabMask[legacyQsModule][t] != 0 {
			out.put(legacyQsModule, t, tabMask[legacyQsModule][t])
		}
	}
}

func legacyCompany(tinhNang any) Set {
	list := splitList(tinhNang)
	if len(list) == 0 {
		return fullSet()
	}
	has := map[string]bool{}
	for _, x := range list {
		has[x] = true
	}
	out := Set{}
	for _, m := range cat.Modules {
		switch {
		case m.Key == legacyQsModule:
			for _, t := range m.Tabs {
				if has[t.Key] {
					putQsLegacy(out, t.Key)
				}
			}
		case legacyFeatureModules[m.Key]:
			if has[m.Key] {
				grantModule(out, m.Key)
			}
		default:
			grantModule(out, m.Key)
		}
	}
	return out
}

// legacyStaff: quyền nhân viên suy ra từ users.permissions (perms): mỗi khoá trang (= khoá module) cho mọi thao tác
// của module; mỗi khoá tab QS cho mọi thao tác của tab đó; 'muahang' cho cả tab Mua hàng của QS lẫn trang Mua hàng.
// Khoá khác (sp_duyet - duyệt sản phẩm M14.6, không thuộc ma trận) bỏ qua.
func legacyStaff(perms any) Set {
	out := Set{}
	for _, k := range splitList(perms) {
		if tabMask[legacyQsModule][k] != 0 {
			putQsLegacy(out, k)
		}
		if k != legacyQsModule {
			grantModule(out, k)
		}
	}
	return out
}
