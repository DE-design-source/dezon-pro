// Package database: tầng truy cập dữ liệu PostgreSQL - bản chuyển 1:1 của server/supa.js.
//
// Giữ NGUYÊN giao diện kiểu REST cũ (Select / Insert / Update / Remove / Eq,
// chuỗi lọc kiểu PostgREST "cot=eq.x&cot2=in.(1,2)"). Database dùng tên bảng / cột TIẾNG ANH,
// code vẫn gọi tên tiếng Việt cũ; db-map.json là bảng đối chiếu: tầng này dịch tên khi gửi
// truy vấn và dịch ngược khi trả kết quả.
//
// Kết quả do chính Postgres dựng thành JSON rồi đọc về []*omap.Map nên kiểu dữ liệu và thứ tự
// khoá y hệt bản Node (số là float64, timestamptz là chuỗi ISO, jsonb là *omap.Map / []any).
package database

import (
	"context"
	_ "embed"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

//go:embed db-map.json
var dbMapJSON []byte

// TenantTables: các bảng thuộc về 1 CÔNG TY -> mọi truy vấn tự động lọc theo công ty đang đăng nhập.
// Làm ở tầng này để KHÔNG SÓT chỗ nào (an toàn hơn nhớ thêm filter ở từng hàm).
var TenantTables = map[string]bool{
	"du_an": true, "db_bao_gia": true, "khai_toan": true, "db_san_pham": true, "db_san_pham_history": true,
	"don_mua_hang": true, "chi_tiet_mua_hang": true, "notifications": true, "delete_requests": true,
	"audit_log": true, "users": true, "sp_combo": true, "sp_yeu_thich": true, "cong_tac": true,
	"de_xuat": true, "chi_tiet_de_xuat_ck": true, "chi_tiet_de_xuat_tt": true, "cong_tac_history": true,
	"du_an_data": true, "cai_dat_cong_ty": true,
}

// Config: cấu hình kết nối.
type Config struct {
	URL           string // DATABASE_URL
	PoolMax       int    // DB_POOL_MAX (<= 0 -> 10)
	SortCollation string // DB_SORT_COLLATION ("" -> en-US-x-icu)
}

// SelectOpt: tuỳ chọn của Select - {select, filter, order, limit, noScope} bên Node.
type SelectOpt struct {
	Select  string // "cot1,cot2" hoặc "" / "*" = mọi cột
	Filter  string // chuỗi PostgREST, vd "ma_du_an=eq.X&id=in.(1,2)"
	Order   string // "cot.desc,cot2.asc.nullslast"
	Limit   int    // 0 = không giới hạn
	NoScope bool   // true = KHÔNG tự lọc theo công ty
}

// Opt: tuỳ chọn của Insert / Update / Remove.
type Opt struct {
	NoScope bool
}

// Error: lỗi database, giữ dạng thông báo của PostgREST vì code phía trên nhận biết lỗi theo mã / chuỗi:
// "DB <METHOD> <bảng> -> <status> {json}".
type Error struct {
	Msg    string
	Code   string // mã Postgres (23505, 42703...) hoặc PGRST...
	Status int
}

func (e *Error) Error() string { return e.Msg }

// CodeOf trả mã lỗi database của err ("" nếu không phải lỗi database) - thay cho e.code bên Node.
func CodeOf(err error) string {
	var de *Error
	if errors.As(err, &de) {
		return de.Code
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

// StatusOf trả e.status (0 nếu không có).
func StatusOf(err error) int {
	var de *Error
	if errors.As(err, &de) {
		return de.Status
	}
	return 0
}

func dbError(method, table string, status int, code, message, detail, hint string) *Error {
	body := omap.Of("code", code, "details", nullIfEmpty(detail), "hint", nullIfEmpty(hint), "message", message)
	js, _ := omap.MarshalString(body)
	return &Error{Msg: "DB " + method + " " + table + " -> " + strconv.Itoa(status) + " " + js, Code: code, Status: status}
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// wrapPg: lỗi của Postgres -> dạng PostgREST; lỗi đã bọc / lỗi mạng giữ nguyên.
func wrapPg(method, table string, err error) error {
	var de *Error
	if errors.As(err, &de) {
		return err
	}
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || pe.Code == "" {
		// Node bọc mọi lỗi có .code, kể cả lỗi socket (ECONNREFUSED...) -> 400
		if code := netCode(err); code != "" {
			return dbError(method, table, 400, code, err.Error(), "", "")
		}
		return err
	}
	st := 400
	switch {
	case strings.HasPrefix(pe.Code, "23"):
		st = 409
	case pe.Code == "42501":
		st = 401
	case pe.Code == "42P01":
		st = 404
	}
	return dbError(method, table, st, pe.Code, pe.Message, pe.Detail, pe.Hint)
}

// netCode: mã lỗi kiểu Node (err.code) của lỗi mạng; "" nếu không phải lỗi mạng.
func netCode(err error) string {
	var dns *net.DNSError
	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return "ECONNREFUSED"
	case errors.Is(err, syscall.ECONNRESET):
		return "ECONNRESET"
	case errors.Is(err, syscall.EPIPE):
		return "EPIPE"
	case errors.Is(err, syscall.ETIMEDOUT):
		return "ETIMEDOUT"
	case errors.As(err, &dns):
		return "ENOTFOUND"
	}
	return ""
}

// nulParam: tham số chữ có byte 0. Node gửi tham số riêng (extended protocol) nên Postgres báo 22021;
// ở đây tham số được ghép vào câu lệnh (simple protocol), phải tự chặn để ra đúng lỗi đó.
func nulParam(method, table string, lists ...[]any) error {
	var has func(v any) bool
	has = func(v any) bool {
		switch x := v.(type) {
		case string:
			return strings.IndexByte(x, 0) >= 0
		case []string:
			for _, s := range x {
				if strings.IndexByte(s, 0) >= 0 {
					return true
				}
			}
		case []any:
			for _, it := range x {
				if has(it) {
					return true
				}
			}
		}
		return false
	}
	for _, l := range lists {
		if has(l) {
			return dbError(method, table, 400, "22021", `invalid byte sequence for encoding "UTF8": 0x00`, "", "")
		}
	}
	return nil
}

// DB: một kết nối (pool) tới PostgreSQL + danh mục bảng / cột đã nạp.
type DB struct {
	cfg Config

	poolMu sync.Mutex
	pool   *pgxpool.Pool

	catMu    sync.Mutex
	cat      map[string]*table
	catAt    time.Time
	loading  *catLoad
	collate  string
	warned   bool
	catLoads atomic.Int64 // số lần đã nạp danh mục (test đếm)

	dbmap []mapEntry
}

// New tạo DB; CHƯA kết nối (kết nối ở truy vấn đầu tiên, như pool() của Node).
func New(cfg Config) *DB {
	if cfg.PoolMax <= 0 {
		cfg.PoolMax = 10
	}
	if cfg.SortCollation == "" {
		cfg.SortCollation = "en-US-x-icu"
	}
	return &DB{cfg: cfg, dbmap: parseDBMap(dbMapJSON)}
}

// Ok: đã cấu hình DATABASE_URL chưa.
func (d *DB) Ok() bool { return d.cfg.URL != "" }

// Pool trả pool pgx cho các truy vấn thô hiếm gặp. Lưu ý pool chạy ở chế độ simple protocol.
func (d *DB) Pool() (*pgxpool.Pool, error) {
	d.poolMu.Lock()
	defer d.poolMu.Unlock()
	if d.cfg.URL == "" {
		return nil, errors.New("Chưa cấu hình DATABASE_URL (chuỗi kết nối PostgreSQL) trong file .env")
	}
	if d.pool != nil {
		return d.pool, nil
	}
	pc, err := pgxpool.ParseConfig(d.cfg.URL)
	if err != nil {
		return nil, err
	}
	pc.MaxConns = int32(d.cfg.PoolMax)
	// timezone=UTC để timestamptz trả ra dạng ...+00:00 như trước
	pc.ConnConfig.RuntimeParams["timezone"] = "UTC"
	// Tham số gửi dạng chữ, để Postgres tự suy kiểu theo cột (đúng cách thư viện pg của Node làm).
	pc.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	p, err := pgxpool.NewWithConfig(context.Background(), pc)
	if err != nil {
		return nil, err
	}
	d.pool = p
	return p, nil
}

// Close đóng pool.
func (d *DB) Close() {
	d.poolMu.Lock()
	p := d.pool
	d.pool = nil
	d.poolMu.Unlock()
	if p != nil {
		p.Close()
	}
}

// ───────────── Ngữ cảnh công ty ─────────────

// assertTenant: người đăng nhập KHÔNG phải super mà không có công ty (token cũ / tài khoản bị gỡ công ty)
// -> chặn, KHÔNG được rơi về "xem toàn hệ thống".
func assertTenant(ctx context.Context) error {
	role := tenant.From(ctx).Role
	if role != "" && role != "super" && !tenant.Scoped(ctx) {
		return errors.New("Tài khoản chưa gắn với công ty nào")
	}
	return nil
}

func tenantFilter(ctx context.Context, tbl string, noScope bool) (string, error) {
	if noScope || !TenantTables[tbl] {
		return "", nil
	}
	if err := assertTenant(ctx); err != nil {
		return "", err
	}
	if !tenant.Scoped(ctx) { // login / super admin xem toàn hệ thống
		return "", nil
	}
	return "cong_ty_id=eq." + jsval.EncodeURIComponent(tenant.TenantID(ctx)), nil
}

func withScope(ctx context.Context, tbl, filter string, noScope bool) (string, error) {
	t, err := tenantFilter(ctx, tbl, noScope)
	if err != nil {
		return "", err
	}
	if t == "" {
		return filter, nil
	}
	if filter != "" {
		return filter + "&" + t, nil
	}
	return t, nil
}

// Eq: escape giá trị cho filter eq. - col + "=eq." + encodeURIComponent(val).
func Eq(col string, val any) string { return col + "=eq." + jsval.EncodeURIComponent(val) }

// ───────────── Chạy truy vấn ─────────────

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func queryJ(ctx context.Context, q querier, sql string, params []any) ([]*omap.Map, error) {
	var j *string
	if err := q.QueryRow(ctx, sql, params...).Scan(&j); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return []*omap.Map{}, nil
		}
		return nil, err
	}
	return decodeJ(j)
}

func decodeJ(j *string) ([]*omap.Map, error) {
	if j == nil || *j == "" {
		return []*omap.Map{}, nil
	}
	return omap.DecodeRows([]byte(*j))
}

// staleCatalog: cột / bảng không còn như danh mục đang nhớ (vừa chạy migration)
// -> nạp lại để lệnh gọi SAU dùng danh mục mới.
func (d *DB) staleCatalog(ctx context.Context, err error) {
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || (pe.Code != "42703" && pe.Code != "42P01") {
		return
	}
	d.catMu.Lock()
	old := time.Since(d.catAt) > 3*time.Second
	d.catMu.Unlock()
	if !old {
		return
	}
	if d.InTx(ctx) {
		// đang giữ 1 kết nối của transaction: nạp nền, không chờ kết nối thứ 2 (pool cạn -> mọi Tx cùng chờ nhau).
		// Lệnh sau trong cùng Tx dùng danh mục đang nhớ như các lệnh không yêu cầu nạp mới.
		go func() { _, _ = d.catalog(context.WithoutCancel(ctx), true) }()
		return
	}
	_, _ = d.catalog(ctx, true)
}

func (d *DB) run(ctx context.Context, method string, t *table, sql string, params []any) ([]*omap.Map, error) {
	st := txOf(ctx, d)
	var p *pgxpool.Pool
	if st == nil {
		var err error
		if p, err = d.Pool(); err != nil {
			return nil, err
		}
	}
	if err := nulParam(method, t.vi, params); err != nil {
		return nil, err
	}
	var out []*omap.Map
	var err error
	if st != nil { // đang trong d.Tx: chạy trên transaction đó
		out, err = st.query(ctx, sql, params)
	} else {
		out, err = queryJ(ctx, p, sql, params)
	}
	if err != nil {
		d.staleCatalog(ctx, err)
		return nil, wrapPg(method, t.vi, err)
	}
	return out, nil
}

// runLocked: ghi bảng tách - khoá các dòng lõi trước rồi mới chạy lệnh ghi, trong 1 transaction. Nhờ vậy hai lệnh
// ghi cùng lúc lên một sản phẩm xếp hàng (không đụng khoá chính bảng vệ tinh) và điều kiện lọc được xét lại
// sau khi chờ khoá - đúng như một câu UPDATE / DELETE đơn trên một bảng.
func (d *DB) runLocked(ctx context.Context, method string, t *table, lockWhere string, lockParams []any, sql string, params []any) ([]*omap.Map, error) {
	lockSQL := "select 1 from " + q(t.core) + ` c where c."id" in (select _t."id" from ` + q(t.en) + " _t" + lockWhere + `) order by c."id" for update of c`
	if st := txOf(ctx, d); st != nil { // đang trong d.Tx: khoá + ghi dưới 1 savepoint của transaction đó
		if err := nulParam(method, t.vi, lockParams, params); err != nil {
			return nil, err
		}
		out, err := st.locked(ctx, lockSQL, lockParams, sql, params)
		if err != nil {
			d.staleCatalog(ctx, err)
			return nil, wrapPg(method, t.vi, err)
		}
		return out, nil
	}
	p, err := d.Pool()
	if err != nil {
		return nil, err
	}
	if err := nulParam(method, t.vi, lockParams, params); err != nil {
		return nil, err
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return nil, wrapPg(method, t.vi, err)
	}
	fail := func(err error) ([]*omap.Map, error) {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		d.staleCatalog(ctx, err)
		return nil, wrapPg(method, t.vi, err)
	}
	if _, err := tx.Exec(ctx, lockSQL, lockParams...); err != nil {
		return fail(err)
	}
	out, err := queryJ(ctx, tx, sql, params)
	if err != nil {
		return fail(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fail(err)
	}
	return out, nil
}

// ───────────── SELECT / INSERT / UPDATE / DELETE ─────────────

const jagg = "select coalesce(json_agg(x), '[]'::json)::text as j from "

func splitNames(s string) []string {
	out := []string{}
	for _, x := range strings.Split(s, ",") {
		if x = jsval.Trim(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

// Select: đọc bảng. Bảng thuộc công ty tự thêm điều kiện cong_ty_id (trừ khi NoScope).
func (d *DB) Select(ctx context.Context, tbl string, opt ...SelectOpt) (rows []*omap.Map, err error) {
	var o SelectOpt
	if len(opt) > 0 {
		o = opt[0]
	}
	t, err := d.table(ctx, "GET", tbl)
	if err != nil {
		return nil, err
	}
	selCols := []string{}
	if o.Select != "" && o.Select != "*" {
		selCols = splitNames(o.Select)
	}
	if t, err = d.ensureCols(ctx, t, selCols); err != nil {
		return nil, err
	}
	filter, err := withScope(ctx, tbl, o.Filter, o.NoScope)
	if err != nil {
		return nil, err
	}
	defer catch(&err)
	params := []any{}
	where := makeWhere("GET", t, filter, &params)
	// thêm id làm khoá phụ để thứ tự ổn định khi cột sắp xếp trùng giá trị
	order := o.Order
	if order != "" && t.v2e["id"] != "" && !reHasID.MatchString(order) {
		order += ",id.asc"
	}
	sql := jagg + "(select " + outList("GET", t, o.Select, "_t") + " from " + q(t.en) + " _t" + where + makeOrder("GET", t, order, d.collation())
	if o.Limit != 0 {
		sql += " limit " + strconv.Itoa(o.Limit)
	}
	sql += ") x"
	return d.run(ctx, "GET", t, sql, params)
}

func hasNoScope(opt []Opt) bool { return len(opt) > 0 && opt[0].NoScope }

// InsertOne: chèn 1 dòng (supa.insert(table, row)).
func (d *DB) InsertOne(ctx context.Context, tbl string, row *omap.Map, opt ...Opt) ([]*omap.Map, error) {
	return d.Insert(ctx, tbl, []*omap.Map{row}, opt...)
}

// Insert: chèn nhiều dòng, trả các dòng đã chèn. Bảng thuộc công ty tự gắn cong_ty_id cho dòng chưa có.
func (d *DB) Insert(ctx context.Context, tbl string, arr []*omap.Map, opt ...Opt) (rows []*omap.Map, err error) {
	if len(arr) == 0 {
		return []*omap.Map{}, nil
	}
	noScope := hasNoScope(opt)
	t, err := d.table(ctx, "POST", tbl)
	if err != nil {
		return nil, err
	}
	scoped := TenantTables[tbl] && !noScope && tenant.Scoped(ctx)
	// Tự gắn công ty cho dòng mới (nếu bảng thuộc công ty và đang có ngữ cảnh)
	if TenantTables[tbl] && !noScope {
		if err := assertTenant(ctx); err != nil {
			return nil, err
		}
	}
	if scoped && t.vt == nil {
		ct := tenant.TenantID(ctx)
		next := make([]*omap.Map, len(arr))
		for i, r := range arr {
			if jsval.Truthy(r.Val("cong_ty_id")) {
				next[i] = r
			} else {
				next[i] = r.Clone().Set("cong_ty_id", ct)
			}
		}
		arr = next
	}
	keys := []string{}
	seen := map[string]bool{}
	for _, r := range arr {
		for _, k := range r.Keys() {
			if !seen[k] && !t.isVirt(k) {
				seen[k] = true
				keys = append(keys, k)
			}
		}
	}
	if t, err = d.ensureCols(ctx, t, keys); err != nil {
		return nil, err
	}
	defer catch(&err)
	body := make([]any, len(arr))
	for i, r := range arr {
		body[i] = toEn("POST", t, r)
	}
	bodyJSON, err := omap.MarshalString(body)
	if err != nil {
		return nil, err
	}
	if t.split {
		keysEn := make([]string, len(keys))
		for i, k := range keys {
			keysEn[i] = t.v2e[k]
		}
		return d.run(ctx, "POST", t, insertSplitSQL(t, keysEn), []any{bodyJSON})
	}
	colNames := make([]string, len(keys))
	for i, k := range keys {
		colNames[i] = q(t.v2e[k])
	}
	cols := strings.Join(colNames, ", ")
	// json_populate_recordset: Postgres tự ép kiểu từng giá trị theo kiểu cột (đúng cách PostgREST làm).
	// Chỉ ghi các cột có trong dữ liệu gửi lên -> cột còn lại nhận giá trị mặc định.
	if len(keys) == 0 { // dòng rỗng {}: mọi cột lấy mặc định
		out := []*omap.Map{}
		for range arr {
			r, err := d.run(ctx, "POST", t, "with w as (insert into "+q(t.en)+" default values returning *) "+
				jagg+"(select "+outList("POST", t, "*", "w")+" from w) x", nil)
			if err != nil {
				return nil, err
			}
			out = append(out, r...)
		}
		return out, nil
	}
	if t.vt != nil && scoped {
		// Bảng con: dòng cha phải thuộc công ty đang đăng nhập. Có dòng nào không thoả thì KHÔNG chèn dòng nào.
		sqlV := "with src as (select * from json_populate_recordset(null::" + q(t.en) + ", $1::json)), " +
			"w as (insert into " + q(t.en) + " (" + cols + ") select " + cols + " from src where not exists (select 1 from src s where not exists " +
			"(select 1 from " + q(t.vt.parent) + " p where p." + q(t.vt.key) + " = s." + q(t.vt.via) + ` and p."company_id" = $2)) returning *) ` +
			jagg + "(select " + outList("POST", t, "*", "w") + " from w) x"
		out, err := d.run(ctx, "POST", t, sqlV, []any{bodyJSON, jsval.ToString(tenant.TenantID(ctx))})
		if err != nil {
			return nil, err
		}
		if len(out) != len(body) {
			return nil, dbError("POST", tbl, 409, "23503", `insert or update on table "`+t.en+`" violates foreign key constraint: parent row in "`+
				t.vt.parent+`" not found for the current company`, "", "")
		}
		return out, nil
	}
	sql := "with w as (insert into " + q(t.en) + " (" + cols + ") select " + cols + " from json_populate_recordset(null::" + q(t.en) + ", $1::json) returning *) " +
		jagg + "(select " + outList("POST", t, "*", "w") + " from w) x"
	return d.run(ctx, "POST", t, sql, []any{bodyJSON})
}

// Update: sửa các dòng khớp filter, trả các dòng sau khi sửa. Từ chối khi không có điều kiện lọc.
func (d *DB) Update(ctx context.Context, tbl, filter string, patch *omap.Map, opt ...Opt) (rows []*omap.Map, err error) {
	noScope := hasNoScope(opt)
	t, err := d.table(ctx, "PATCH", tbl)
	if err != nil {
		return nil, err
	}
	keys := []string{}
	for _, k := range patch.Keys() {
		if !t.isVirt(k) {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return []*omap.Map{}, nil
	}
	if t, err = d.ensureCols(ctx, t, keys); err != nil {
		return nil, err
	}
	defer catch(&err)
	bodyJSON, err := omap.MarshalString(toEn("PATCH", t, patch))
	if err != nil {
		return nil, err
	}
	scopedFilter, err := withScope(ctx, tbl, filter, noScope)
	if err != nil {
		return nil, err
	}
	params := []any{bodyJSON}
	where := makeWhere("PATCH", t, scopedFilter, &params)
	if where == "" {
		return nil, dbError("PATCH", tbl, 400, "PGRST100", "Từ chối UPDATE không có điều kiện lọc", "", "")
	}
	keysEn := make([]string, len(keys))
	for i, k := range keys {
		keysEn[i] = t.v2e[k]
	}
	if t.split {
		lp := []any{}
		lw := makeWhere("PATCH", t, scopedFilter, &lp)
		return d.runLocked(ctx, "PATCH", t, lw, lp, updateSplitSQL(t, keysEn, where), params)
	}
	sets := make([]string, len(keysEn))
	for i, k := range keysEn {
		sets[i] = q(k) + " = _p." + q(k)
	}
	sql := "with w as (update " + q(t.en) + " _t set " + strings.Join(sets, ", ") +
		" from json_populate_record(null::" + q(t.en) + ", $1::json) _p" + where + " returning _t.*) " +
		jagg + "(select " + outList("PATCH", t, "*", "w") + " from w) x"
	return d.run(ctx, "PATCH", t, sql, params)
}

// Remove: xoá các dòng khớp filter, trả các dòng đã xoá. Từ chối khi không có điều kiện lọc.
func (d *DB) Remove(ctx context.Context, tbl, filter string, opt ...Opt) (rows []*omap.Map, err error) {
	t, err := d.table(ctx, "DELETE", tbl)
	if err != nil {
		return nil, err
	}
	scopedFilter, err := withScope(ctx, tbl, filter, hasNoScope(opt))
	if err != nil {
		return nil, err
	}
	defer catch(&err)
	params := []any{}
	where := makeWhere("DELETE", t, scopedFilter, &params)
	if where == "" {
		return nil, dbError("DELETE", tbl, 400, "PGRST100", "Từ chối DELETE không có điều kiện lọc", "", "")
	}
	if t.split {
		return d.runLocked(ctx, "DELETE", t, where, params, removeSplitSQL(t, where), params)
	}
	sql := "with w as (delete from " + q(t.en) + " _t" + where + " returning _t.*) " +
		jagg + "(select " + outList("DELETE", t, "*", "w") + " from w) x"
	return d.run(ctx, "DELETE", t, sql, params)
}

// catch đổi panic(*Error) của các hàm dựng SQL thành giá trị lỗi trả về.
func catch(err *error) {
	if r := recover(); r != nil {
		if e, ok := r.(*Error); ok {
			*err = e
			return
		}
		panic(r)
	}
}
