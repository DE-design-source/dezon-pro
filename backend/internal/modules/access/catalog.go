package access

import (
	_ "embed"
	"encoding/json"

	"qspro-backend/internal/shared/omap"
)

// catalogJSON: danh mục quyền Module > Tab > Thao tác - nguồn DUY NHẤT (giao diện đọc qua GET /api/v1/access/catalog).
// Khoá module = khoá quyền trang cũ (users.perms / data/navigation.js perm); khoá tab = khoá tab của trang (data/pageTabs.js...).
//
//go:embed catalog.json
var catalogJSON []byte

// Action: 1 thao tác (view, create, edit, delete, approve, export).
type Action struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Tab: 1 tab của module cùng các thao tác tab đó hỗ trợ.
type Tab struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Actions []string `json:"actions"`
}

// Module: 1 trang / phân hệ.
type Module struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Tabs  []Tab  `json:"tabs"`
}

// Catalog: toàn bộ danh mục quyền.
type Catalog struct {
	Actions []Action `json:"actions"`
	Modules []Module `json:"modules"`
}

// TabAll: khoá tab "*" trong grants = mọi tab của module.
const TabAll = "*"

// mask: tập thao tác dạng bit (bit i = Actions[i] của danh mục).
type mask uint8

var (
	cat       Catalog
	actionBit = map[string]mask{}
	modIdx    = map[string]*Module{}
	tabMask   = map[string]map[string]mask{} // module -> tab -> thao tác hỗ trợ
	modMask   = map[string]mask{}            // module -> hợp thao tác của mọi tab (dùng cho tab "*")
	catOut    *omap.Map
)

func init() {
	if err := json.Unmarshal(catalogJSON, &cat); err != nil {
		panic("access/catalog.json hỏng: " + err.Error())
	}
	if len(cat.Actions) > 8 {
		panic("access/catalog.json: tối đa 8 thao tác")
	}
	for i, a := range cat.Actions {
		actionBit[a.Key] = 1 << i
	}
	for i := range cat.Modules {
		m := &cat.Modules[i]
		if modIdx[m.Key] != nil {
			panic("access/catalog.json: trùng module " + m.Key)
		}
		modIdx[m.Key] = m
		tabMask[m.Key] = map[string]mask{}
		for _, t := range m.Tabs {
			if t.Key == TabAll || tabMask[m.Key][t.Key] != 0 {
				panic("access/catalog.json: tab sai hoặc trùng " + m.Key + "/" + t.Key)
			}
			var b mask
			for _, a := range t.Actions {
				if actionBit[a] == 0 {
					panic("access/catalog.json: thao tác lạ " + a)
				}
				b |= actionBit[a]
			}
			if b == 0 {
				panic("access/catalog.json: tab không có thao tác " + m.Key + "/" + t.Key)
			}
			tabMask[m.Key][t.Key] = b
			modMask[m.Key] |= b
		}
	}
	catOut = buildCatalogOut()
}

// GetCatalog: bản sao danh mục (dùng trong Go: module khác / test).
func GetCatalog() Catalog { return cat }

func buildCatalogOut() *omap.Map {
	acts := make([]any, len(cat.Actions))
	for i, a := range cat.Actions {
		acts[i] = omap.Of("key", a.Key, "label", a.Label)
	}
	mods := make([]any, len(cat.Modules))
	for i, m := range cat.Modules {
		tabs := make([]any, len(m.Tabs))
		for j, t := range m.Tabs {
			as := make([]any, len(t.Actions))
			for k, a := range t.Actions {
				as[k] = a
			}
			tabs[j] = omap.Of("key", t.Key, "label", t.Label, "actions", as)
		}
		mods[i] = omap.Of("key", m.Key, "label", m.Label, "tabs", tabs)
	}
	return omap.Of("actions", acts, "modules", mods)
}

func actionLabel(a string) string {
	for _, x := range cat.Actions {
		if x.Key == a {
			return x.Label
		}
	}
	return a
}

func tabLabel(m *Module, tab string) string {
	for _, t := range m.Tabs {
		if t.Key == tab {
			return t.Label
		}
	}
	return tab
}
