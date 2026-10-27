package database

import (
	"context"
	"strings"
	"time"

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// ───────────── db-map.json ─────────────

type pair struct{ k, v string }

type vtenant struct{ via, parent, key string }

type mapEntry struct {
	vi, table string
	columns   []pair // tên Việt -> tên Anh, theo thứ tự trong file
	view      string
	parts     []pair // bảng vệ tinh -> cột khoá
	hasParts  bool
	tenant    *vtenant
}

func pairsOf(m *omap.Map) []pair {
	out := make([]pair, 0, m.Len())
	m.Each(func(k string, v any) { out = append(out, pair{k, jsval.AsString(v)}) })
	return out
}

func parseDBMap(b []byte) []mapEntry {
	v, err := omap.Decode(b)
	if err != nil {
		panic("db-map.json hỏng: " + err.Error())
	}
	root := jsval.AsMap(v)
	out := make([]mapEntry, 0, root.Len())
	root.Each(func(vi string, raw any) {
		m := jsval.AsMap(raw)
		e := mapEntry{vi: vi, table: jsval.AsString(m.Val("table")), columns: pairsOf(jsval.AsMap(m.Val("columns"))), view: jsval.AsString(m.Val("view"))}
		if p := jsval.AsMap(m.Val("parts")); p != nil {
			e.hasParts = true
			e.parts = pairsOf(p)
		}
		if t := jsval.AsMap(m.Val("tenant")); t != nil {
			e.tenant = &vtenant{via: jsval.AsString(t.Val("via")), parent: jsval.AsString(t.Val("parent")), key: jsval.AsString(t.Val("key"))}
		}
		out = append(out, e)
	})
	return out
}

// ───────────── Danh mục bảng / cột thật trong database + đối chiếu tên ─────────────

type part struct {
	table, key string
	cols       []string
}

// table: một bảng theo tên tiếng Việt mà code gọi.
type table struct {
	vi   string            // tên code gọi
	en   string            // bảng (hoặc view nối sẵn) để đọc
	v2e  map[string]string // cột Việt -> cột Anh
	cols []string          // cột theo thứ tự trong database (tên Việt)
	text map[string]bool   // cột kiểu chữ (sắp xếp theo collation)
	vt   *vtenant          // bảng CON: cong_ty_id là cột ảo tra theo dòng cha

	// bảng tách lõi + vệ tinh
	split bool
	core  string
	owner map[string]int // cột Anh -> -1 (bảng lõi) hoặc chỉ số trong parts
	parts []part
}

// ownerOf: -1 = bảng lõi, >= 0 = bảng vệ tinh, -2 = cột chỉ có ở view.
func (t *table) ownerOf(en string) int {
	if o, ok := t.owner[en]; ok {
		return o
	}
	return -2
}

// isVirt: cột ảo cong_ty_id của bảng con - tra công ty của dòng cha.
func (t *table) isVirt(name string) bool { return t.vt != nil && name == "cong_ty_id" }

func (t *table) virt(alias string) string {
	return `(select _tp."company_id" from ` + q(t.vt.parent) + " _tp where _tp." + q(t.vt.key) + " = " + alias + "." + q(t.vt.via) + ")"
}

func q(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

type catLoad struct {
	done chan struct{}
	cat  map[string]*table
	err  error
}

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return -1
}

func (d *DB) loadCatalog(ctx context.Context) (map[string]*table, string, error) {
	p, err := d.Pool()
	if err != nil {
		return nil, "", err
	}
	rows, err := p.Query(ctx, "select table_name::text, column_name::text, data_type::text from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position")
	if err != nil {
		return nil, "", err
	}
	real := map[string][]string{}
	realOrder := []string{}
	isText := map[string]bool{}
	for rows.Next() {
		var tn, cn, dt string
		if err := rows.Scan(&tn, &cn, &dt); err != nil {
			rows.Close()
			return nil, "", err
		}
		if _, ok := real[tn]; !ok {
			realOrder = append(realOrder, tn)
		}
		real[tn] = append(real[tn], cn)
		if dt == "text" || dt == "character varying" {
			isText[tn+"."+cn] = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	// Sắp xếp chữ có dấu theo ngôn ngữ, không phụ thuộc locale lúc tạo database.
	// Database không có collation ICU này thì sắp theo mặc định của database.
	collate := ""
	var one int
	cerr := p.QueryRow(ctx, "select 1 from pg_collation where collname = $1 limit 1", d.cfg.SortCollation).Scan(&one)
	if cerr == nil {
		collate = " collate " + q(d.cfg.SortCollation)
	} else if !isNoRows(cerr) {
		return nil, "", cerr
	}

	cat := map[string]*table{}
	// m.view + m.parts (db-map.json): bảng lõi có các bảng vệ tinh 1-1 (khoá = id của bảng lõi).
	// ĐỌC qua view nối sẵn mọi cột; GHI thì tách cột về đúng bảng (insertSplitSQL / updateSplitSQL / removeSplitSQL).
	add := func(viTable, enTable string, v2eMap []pair, m *mapEntry) {
		if _, ok := real[enTable]; !ok {
			return
		}
		split := false
		if m != nil && m.view != "" && m.hasParts {
			_, split = real[m.view]
		}
		src := enTable
		if split {
			src = m.view
		}
		e2v := map[string]string{}
		for _, c := range v2eMap {
			e2v[c.v] = c.k
		}
		t := &table{vi: viTable, en: src, v2e: map[string]string{}, text: map[string]bool{}}
		for _, en := range real[src] { // cột chưa có trong db-map.json: dùng nguyên tên
			vi := e2v[en]
			if vi == "" {
				vi = en
			}
			t.v2e[vi] = en
			t.cols = append(t.cols, vi)
			if isText[src+"."+en] {
				t.text[vi] = true
			}
		}
		// m.tenant: bảng CON không có cột company_id - công ty của dòng = công ty của dòng cha.
		// Code phía trên vẫn dùng "cong_ty_id" như một cột ảo (lọc / đọc được, ghi thì bỏ qua).
		if m != nil && m.tenant != nil && indexOf(real[enTable], "company_id") < 0 {
			if _, ok := real[m.tenant.parent]; ok {
				t.vt = m.tenant
			}
		}
		if split {
			t.split = true
			t.core = enTable
			t.owner = map[string]int{}
			for _, en := range real[enTable] {
				t.owner[en] = -1
			}
			for _, pt := range m.parts {
				pc, ok := real[pt.k]
				if !ok {
					continue
				}
				cols := []string{}
				for _, c := range pc {
					if c != pt.v {
						cols = append(cols, c)
						t.owner[c] = len(t.parts)
					}
				}
				t.parts = append(t.parts, part{table: pt.k, key: pt.v, cols: cols})
			}
		}
		cat[viTable] = t
	}
	used := map[string]bool{}
	for i := range d.dbmap {
		m := &d.dbmap[i]
		add(m.vi, m.table, m.columns, m)
		used[m.table] = true
		if m.view != "" {
			used[m.view] = true
		}
		for _, pt := range m.parts {
			used[pt.k] = true
		}
	}
	for _, en := range realOrder { // bảng ngoài db-map.json
		if cat[en] == nil && !used[en] {
			add(en, en, nil, nil)
		}
	}
	thieu := []string{}
	for _, m := range d.dbmap {
		if _, ok := real[m.table]; !ok {
			thieu = append(thieu, m.vi)
		}
	}
	d.catMu.Lock()
	warn := len(thieu) > 0 && !d.warned
	if warn {
		d.warned = true
	}
	d.catMu.Unlock()
	if warn {
		logger.Error("db", "Database thiếu bảng của: "+strings.Join(thieu, ", ")+" — có vẻ CHƯA chạy migration. Chạy: npm run migrate (rồi khởi động lại server).")
	}
	return cat, collate, nil
}

func (d *DB) catalog(ctx context.Context, fresh bool) (map[string]*table, error) {
	d.catMu.Lock()
	if d.cat != nil && (!fresh || time.Since(d.catAt) < 3*time.Second) { // vừa nạp xong, không nạp dồn
		c := d.cat
		d.catMu.Unlock()
		return c, nil
	}
	l := d.loading
	if l == nil {
		l = &catLoad{done: make(chan struct{})}
		d.loading = l
		go func() {
			d.catLoads.Add(1)
			cat, collate, err := d.loadCatalog(context.WithoutCancel(ctx))
			d.catMu.Lock()
			if err == nil {
				d.cat, d.collate, d.catAt = cat, collate, time.Now()
			}
			d.loading = nil
			d.catMu.Unlock()
			l.cat, l.err = cat, err
			close(l.done)
		}()
	}
	d.catMu.Unlock()
	// ctx của request là WithoutCancel (như Node: chờ tới khi nạp xong); ctx huỷ được (job, test) thì thôi chờ,
	// lượt nạp vẫn chạy tiếp cho những lời gọi khác.
	select {
	case <-l.done:
		return l.cat, l.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (d *DB) collation() string {
	d.catMu.Lock()
	defer d.catMu.Unlock()
	return d.collate
}

// table: bảng / cột vừa thêm bằng migration lúc server đang chạy - nạp lại danh mục 1 lần rồi mới báo thiếu.
func (d *DB) table(ctx context.Context, method, name string) (*table, error) {
	cat, err := d.catalog(ctx, false)
	if err != nil {
		return nil, err
	}
	t := cat[name]
	if t == nil {
		if cat, err = d.catalog(ctx, true); err != nil {
			return nil, err
		}
		t = cat[name]
	}
	if t == nil {
		return nil, dbError(method, name, 404, "PGRST205", "Could not find the table 'public."+name+"' in the schema cache", "", "")
	}
	return t, nil
}

// ensureCols: có cột chưa biết -> nạp lại danh mục (lỗi nạp lại được trả ra như Node, không nuốt).
func (d *DB) ensureCols(ctx context.Context, t *table, names []string) (*table, error) {
	all := true
	for _, c := range names {
		if t.v2e[c] == "" && !t.isVirt(c) {
			all = false
			break
		}
	}
	if all {
		return t, nil
	}
	cat, err := d.catalog(ctx, true)
	if err != nil {
		return nil, err
	}
	if cat[t.vi] == nil {
		return t, nil
	}
	return cat[t.vi], nil
}

// RefreshCatalog buộc nạp lại danh mục (sau khi chạy migration trong test).
func (d *DB) RefreshCatalog(ctx context.Context) error {
	d.catMu.Lock()
	d.catAt = time.Time{}
	d.catMu.Unlock()
	_, err := d.catalog(ctx, true)
	return err
}
