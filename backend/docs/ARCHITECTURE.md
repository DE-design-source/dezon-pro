# QS Pro backend (Go + Gin) - Kiến trúc và HỢP ĐỒNG VIẾT MODULE

Backend này là bản chuyển 1:1 của `server/` (Node + Express). Mã Node là CHUẨN GỐC: cùng đầu vào thì
cùng JSON trả về (kể cả thứ tự khoá), cùng thông báo lỗi tiếng Việt, cùng tác động lên database.
Giao diện cũ `public/` (đã gỡ khỏi repo cùng app Node) gọi `POST /api/<tênHàm>` với thân `{"args":[...]}`; cổng này giữ nguyên.
Giao diện React (`frontend/src/pages/QS`) dùng REST `/api/v1` và tải file nhúng trong binary (mục 10.4): hiện dùng 3 file
`*-spec.js`, `/logo.svg`, `/mau-nhap-hang-loat.xlsx` và `/mau-nhap-cong-tac.xlsx` (nút "Tải file mẫu" ở Nhập dữ liệu > Phần thô, M5.1).
Ngoài ra bản Go mở thêm REST dưới `/api/v1`, dùng chung service.

Module Go: `qspro-backend` - Go 1.25. Thư viện đã có sẵn trong `go.mod` (không cần sửa): gin, pgx/v5,
excelize/v2, golang.org/x/crypto (bcrypt, scrypt), golang.org/x/text (norm, collate, language, cases), golang.org/x/net,
go-redis/v9, swaggo/files/v2 (Swagger UI nhúng).
File `.env` đọc bằng `config.LoadDotenv` - bản chuyển của gói dotenv 16 của Node (không dùng godotenv, vì hai bên đọc `#`, `$`, `\` khác nhau).

## 1. Sơ đồ thư mục

```
cmd/api/main.go                  điểm khởi chạy server
cmd/migrate/main.go              chạy migration (bản chuyển của infra/scripts/migrate.js)
internal/config/                 biến môi trường, đọc file .env
internal/server/server.go        gin engine, khớp route kiểu Express, tắt êm
internal/server/static.go        phục vụ file tĩnh TUỲ CHỌN (STATIC_DIR, /vendor)
internal/server/uploads.go       phục vụ kho file tải lên: GET / HEAD /files/<path>, công khai
internal/server/assets.go        file nhúng go:embed ở gốc (AssetModule; logo.svg trong internal/server/assets/)
internal/server/routes.go        NƠI DUY NHẤT nối các module (khối "MODULE WIRING")
internal/server/rest.go          bảng RestRoutes (hàm rpc -> route REST) và RootRoutes (route lẻ)
internal/server/swagger.go       /api-docs.json và Swagger UI (bản chuyển của server/swagger.js)
internal/server/apidocs/         mô tả API nhúng (api-docs.json, meta.json; chép từ bản Node, đóng băng)
internal/server/rpc/             cổng tương thích POST /api/:fn + Registry
internal/middleware/             auth, tenant, rbac, cors, rate_limit, body (đọc thân JSON)
internal/platform/database/      tầng dữ liệu = server/supa.js (Select / Insert / Update / Remove) + db-map.json
internal/platform/storage/       kho file trên đĩa (UPLOAD_DIR), URL công khai /files/<path> (thay uploadToStorage)
internal/platform/redis|logger/  Redis tuỳ chọn, log kiểu "[tag] nội dung"
internal/platform/deps.go        import giữ chỗ để go.mod có sẵn thư viện cho các module
internal/shared/omap/            object JSON có thứ tự khoá (JS value model)
internal/shared/jsval/           ép kiểu / định dạng giống hệt JavaScript
internal/shared/tenant|actor/    ngữ cảnh công ty, người thao tác
internal/shared/response|errors|validator/
internal/shared/contracts/       interface gọi chéo giữa các module (mục 11)
internal/shared/qscore/          số của store, đọc CSV / xlsx, importParse (= server/shared.js)
internal/shared/specs/           thông số theo ngành: js/*-spec.js là nguồn (nhúng, phục vụ ở /vs-spec.js...), data/ sinh bằng scripts/gen-specs.js
internal/shared/httpx/           gọi HTTP ra ngoài như fetch của Node (OneShot: không tự gửi lại GET khi kết nối bị đóng)
internal/modules/<module>/       nghiệp vụ (mỗi module 1 gói)
internal/modules/users/userstest/  đồ nghề test đối chiếu Node <-> Go của users và auth (chỉ file test import)
internal/jobs/                   job nền
scripts/                         gen-specs.js (sinh internal/shared/specs/data từ *-spec.js)
tests/fixtures/                  dữ liệu đối chiếu tầng dữ liệu, registry, swagger (đóng băng) + jsref.js
tests/integration/               test Go trên server đã nối đủ module (server_test.go)
tests/e2e/                       test-api-go.js (E2E trên server Go đang chạy)
docs/                            ARCHITECTURE, API, DATABASE, PORTING_MAP (bảng đối chiếu hàm Node -> module Go, bảng làm việc lúc chuyển mã)
```

Ngoài `backend/` (thư mục `infra/` ở gốc repo): `infra/db/migrations/` (NNNN_ten.sql, dùng chung với bản Node), `infra/db/schema.sql`,
`infra/docker/backend.Dockerfile` + `backend.Dockerfile.dockerignore` (BuildKit tự đọc file ignore đặt cạnh Dockerfile).

## 2. Luật trung thành (bắt buộc)

1. **JS value model.** Giá trị động chỉ gồm: `nil` (null), `bool`, `float64`, `string`, `[]any`, `*omap.Map`,
   và `jsval.Undefined`. Mọi số là `float64`. Không dùng `map[string]any` cho dữ liệu trả về client (mất thứ tự khoá).
2. **Thứ tự khoá.** Object trả về phải có khoá theo đúng thứ tự object literal bên Node: dùng `omap.Of("a", x, "b", y)`
   hoặc struct có tag `json` khai báo theo đúng thứ tự đó. `omap.Map` tự xếp khoá dạng chỉ số ("0", "12") lên trước
   theo thứ tự tăng như JS.
3. **Ép kiểu qua `jsval`.** Không tự viết `strconv.Atoi`, `fmt.Sprint`, `math.Round`... cho dữ liệu nghiệp vụ.
   `Number(x)` -> `jsval.ToNumber`, `String(x)` -> `jsval.ToString`, `x || y` -> `jsval.Or`, `Math.round` -> `jsval.Round`...
4. **Thông báo lỗi** tiếng Việt có dấu, giống Node từng byte: `apperr.New("Chưa chọn sản phẩm hợp lệ")`.
5. **JSON ra client** chỉ qua `response` (hoặc trả giá trị cho cổng rpc). Không dùng `c.JSON` của gin (nó escape HTML,
   định dạng số khác JS).
6. **Chú thích** tiếng Việt có dấu, ngắn, chỉ khi lý do không hiển nhiên. Không dùng gạch dài hay nháy cong.
   Lưu ý: gofmt đổi hai dấu nháy đơn liền nhau trong chú thích doc thành nháy cong - tránh viết `''` trong chú thích.
7. **Không import gói module khác** (xem mục 6 và 11). Ngoại lệ duy nhất: `categories` là gói dữ liệu thuần, `materials` và
   `reports` import trực tiếp. Không sửa `go.mod`, không chạy `go mod tidy`.

## 3. API nền tảng (chữ ký chính xác)

Các chữ ký liệt kê dưới đây đúng với mã nguồn nhưng KHÔNG đầy đủ với `omap`, `jsval`, `database`, `middleware`, `server`: mỗi gói đó còn
hàm xuất khác (ví dụ `omap.SyntaxError`, `jsval.URIError`). Cần hàm chưa có ở đây thì đọc mã nguồn của gói.

### 3.1 `qspro-backend/internal/shared/omap`

```go
var Undefined any                         // undefined của JS
func IsUndefined(v any) bool
type Map struct{ ... }                    // con trỏ nil ĐỌC được (như object rỗng), ghi thì panic
func New() *Map
func Of(kv ...any) *Map                   // omap.Of("id", 1.0, "ten", "A")
func (m *Map) Get(k string) (any, bool)
func (m *Map) Val(k string) any           // không có khoá -> Undefined (như obj.k)
func (m *Map) Has(k string) bool
func (m *Map) Set(k string, v any) *Map   // khoá đã có giữ nguyên vị trí; trả m để gọi nối
func (m *Map) Delete(k string)
func (m *Map) Len() int
func (m *Map) Keys() []string             // thứ tự Object.keys()
func (m *Map) Values() []any
func (m *Map) Each(fn func(k string, v any))
func (m *Map) Clone() *Map                // sao chép NÔNG = Object.assign({}, m)
func Assign(dst *Map, srcs ...*Map) *Map  // Object.assign(dst, a, b)
func DeepClone(v any) any                 // JSON.parse(JSON.stringify(v))
func Marshal(v any) ([]byte, error)       // = JSON.stringify
func MarshalString(v any) (string, error)
func AppendJSON(dst []byte, v any) ([]byte, error)
func Decode(b []byte) (any, error)        // = JSON.parse -> JS value model
func DecodeString(s string) (any, error)
func DecodeRows(b []byte) ([]*Map, error)
func FormatNumber(f float64) string       // String(number)
```

`Marshal`: `Undefined` trong object bị bỏ, trong mảng thành `null`; `NaN` / `Infinity` thành `null`; không escape `<>&`.
Struct / map / slice có kiểu của Go được duyệt bằng reflect (`reflect.go`); struct có tag `json` (tên, `-`, `omitempty`, `omitzero`,
struct nhúng) dùng được ở mọi chỗ: trường ghi theo thứ tự khai báo, trường mang `Undefined` bị bỏ, float `NaN` / `Infinity` thành `null`,
`time.Time` ra dạng `toISOString` (`2026-10-13T01:02:03.000Z`, luôn UTC), map Go xếp khoá tăng dần.
`Decode` thay byte không phải UTF-8 bằng U+FFFD theo cách của Node trước khi đọc, nên chuỗi nhận về luôn là UTF-8 hợp lệ.
Hai hàm phụ được xuất: `func ISOTime(t time.Time) string`, `func ToValidUTF8(b []byte) []byte`.
`*Map` cài `json.Marshaler` / `json.Unmarshaler`.

### 3.2 `qspro-backend/internal/shared/jsval`

```go
var Undefined                                  // = omap.Undefined
func IsUndefined(v any) bool
func IsNullish(v any) bool                     // v == null
func TypeOf(v any) string                      // typeof
func IsString / IsNumber / IsBool / IsArray / IsObject (v any) bool
func ToNumber(v any) float64                   // Number(v)
func Num0(v any) float64                       // Number(v) || 0
func NumOr(v any, def float64) float64         // Number(v) || def
func ToString(v any) string                    // String(v)
func NumberToString(f float64) string
func Str(v any) string                         // String(v ?? "")
func StrOr(v any, def string) string           // String(v || def)
func AsString(v any) string                    // v nếu là string, ngược lại ""
func Truthy(v any) bool                        // !!v
func Or(vals ...any) any                       // a || b || c
func And(vals ...any) any                      // a && b
func Coalesce(vals ...any) any                 // a ?? b
func StrictEquals(a, b any) bool               // ===
func LooseEquals(a, b any) bool                // ==
func ParseFloat(v any) float64
func ParseInt(v any, radix int) float64        // radix 0 = không truyền
func Round(x float64) float64                  // Math.round
func RoundTo(x float64, d int) float64         // Math.round(x * 10^d) / 10^d
func ToFixed(x float64, digits int) string
func FormatVN(x float64) string                // x.toLocaleString('vi-VN')
func FormatVNFrac(x float64, minFrac, maxFrac int) string
func FormatEN(x float64) string                // 'en-US'
func FormatLocale(x float64, minFrac, maxFrac int, group, dec string) string
func ToISOString(t time.Time) string           // date.toISOString()
func NowMs() float64                           // Date.now()
func FromMs(ms float64) time.Time              // new Date(ms)
func EncodeURIComponent(v any) string
func DecodeURIComponent(s string) (string, error)
func Trim / TrimStart / TrimEnd (s string) string   // khoảng trắng theo JS
func Len16(s string) int                       // s.length (đơn vị UTF-16)
func Slice(s string, start int, end ...int) string
func Substring(s string, start int, end ...int) string
func AsMap(v any) *omap.Map                    // không phải object -> nil (đọc trên nil an toàn)
func AsArray(v any) []any
func Get(v any, key string) any                // v[key]
func GetPath(v any, keys ...string) any        // v?.a?.b
func Rows(rows []*omap.Map) []any              // để đặt danh sách dòng vào object trả về
```

Giá trị mong đợi trong test của `jsval` lấy từ node thật (`tests/fixtures/jsref.js`).

### 3.3 `qspro-backend/internal/shared/tenant` (= `server/tenant.js`)

```go
type Ctx struct { UID any; Role string; CongTyID any; ViewAs any }
func With(ctx context.Context, c Ctx) context.Context   // tenant.run(ctx, fn)
func From(ctx context.Context) Ctx                      // tenant.ctx()
func TenantID(ctx context.Context) any                  // viewAs || congTyId || nil
func IsSuper(ctx) bool;  func IsAdmin(ctx) bool;  func UID(ctx) any;  func Scoped(ctx) bool
```

Mọi hàm service nhận `ctx context.Context` làm tham số đầu và truyền nguyên xuống database.
`tenant.run({ role: 'super' }, fn)` bên Node -> `ctx = tenant.With(ctx, tenant.Ctx{Role: "super"})`.
Id trong database thật là UUID (users, cong_ty) hoặc số (bảng khác) - vì vậy các trường id để kiểu `any`.

### 3.4 `qspro-backend/internal/shared/actor`

```go
type Actor struct {
    UID any     `json:"uid"`
    U   string  `json:"u"`     // username
    R   string  `json:"r"`     // role
    CT  any     `json:"ct"`    // cong_ty_id hoặc nil
    Exp float64 `json:"exp"`
    SID string  `json:"-"`     // id phiên (user_sessions.id) từ khoá "sid" của token - M1.2; không ra JSON / Map()
}
func (a *Actor) IsAdmin() bool;  func (a *Actor) IsSuper() bool   // an toàn với nil
func (a *Actor) Map() *omap.Map;  func FromMap(m *omap.Map) *Actor
func Set(c *gin.Context, a *Actor);  func FromGin(c *gin.Context) *Actor
func With(ctx, a) context.Context;   func From(ctx) *Actor
```

### 3.5 `qspro-backend/internal/platform/database` (= `server/supa.js`)

```go
type Config struct { URL string; PoolMax int; SortCollation string }
type SelectOpt struct { Select, Filter, Order string; Limit int; NoScope bool }
type Opt struct { NoScope bool }
type Error struct { Msg, Code string; Status int }    // "DB <METHOD> <bảng> -> <status> {json}"
func New(cfg Config) *DB
func (d *DB) Ok() bool
func (d *DB) Select(ctx, table string, opt ...SelectOpt) ([]*omap.Map, error)
func (d *DB) Insert(ctx, table string, rows []*omap.Map, opt ...Opt) ([]*omap.Map, error)
func (d *DB) InsertOne(ctx, table string, row *omap.Map, opt ...Opt) ([]*omap.Map, error)
func (d *DB) Update(ctx, table, filter string, patch *omap.Map, opt ...Opt) ([]*omap.Map, error)
func (d *DB) Remove(ctx, table, filter string, opt ...Opt) ([]*omap.Map, error)
func (d *DB) Pool() (*pgxpool.Pool, error)            // truy vấn thô hiếm gặp; pool chạy simple protocol
func (d *DB) RefreshCatalog(ctx) error
func (d *DB) Close()
func Eq(col string, val any) string                   // supa.eq
func CodeOf(err error) string                         // e.code  ("23505", "42703", "PGRST204"...)
func StatusOf(err error) int                          // e.status
var TenantTables map[string]bool
```

- Tên bảng / cột là tên tiếng Việt như mã Node gọi (`du_an`, `ma_da`...); chuỗi lọc PostgREST giữ nguyên.
- Dòng trả về là `*omap.Map`: số -> `float64`, boolean -> `bool`, timestamptz -> chuỗi `...+00:00`, jsonb -> `*omap.Map` / `[]any`.
- Ngữ cảnh công ty lấy từ `ctx`; `noScope: true` -> `database.Opt{NoScope: true}` / `SelectOpt{NoScope: true}`.
- Khoá có giá trị `jsval.Undefined` trong dòng ghi: cột vẫn được liệt kê nhưng giá trị bị bỏ khỏi JSON (thành NULL) - đúng như Node.
- Chỗ Node viết `/42703|PGRST204/.test(e.message)` hoặc `e.code === '23505'` -> `strings.Contains(err.Error(), ...)` / `database.CodeOf(err)`.
- Đã đối chiếu với `server/supa.js` bằng 110 ca (xem mục 9).

#### Transaction (D-13, `tx.go`)

```go
func (d *DB) Tx(ctx, fn func(ctx context.Context) error) error // commit khi fn trả nil; rollback khi lỗi / panic
func (d *DB) AfterCommit(ctx, f func(ctx context.Context))     // chạy f sau khi transaction ngoài cùng commit
func (d *DB) InTx(ctx) bool
```

- `Tx` đặt transaction vào `ctx`. Mọi `Select / Insert / Update / Remove` của CÙNG `*DB` nhận `ctx` đó (hoặc ctx con, kể cả
  ctx đã đổi `tenant.With`) tự chạy trong transaction -> repository KHÔNG đổi chữ ký. Lọc công ty, dịch tên, dạng lỗi
  `DB <METHOD> <bảng> -> ...` giữ nguyên; bảng tách (`db_san_pham`) khoá dòng lõi dưới 1 savepoint của transaction.
- fn trả lỗi -> rollback, trả NGUYÊN lỗi đó (không bọc). fn panic -> rollback rồi panic lại.
  Lồng `Tx` trong `Tx` -> savepoint: Tx trong hỏng chỉ huỷ phần của nó, Tx ngoài quyết định cuối cùng.
- Mỗi lệnh trong transaction chạy dưới savepoint riêng (gửi chung 1 gói với lệnh): lệnh hỏng mà code nuốt lỗi
  (`_ = s.repo.X(...)`, thử cột mới rồi lùi khi 42703 / PGRST204) KHÔNG làm hỏng transaction - hành vi như khi chưa bọc.
- Việc phụ cố ý nuốt lỗi và mọi lời gọi mạng (Lark, Storage, xoá cache, thông báo, audit) đặt SAU `Tx` hoặc trong
  `d.AfterCommit(ctx, ...)` - không gọi mạng khi đang giữ transaction. Ngoài transaction, `AfterCommit` chạy f ngay.
- Không chạy goroutine dùng ctx của fn (lệnh bị xếp hàng trên 1 kết nối; ctx của Tx đã kết thúc -> lỗi `tx is closed`,
  không lặng lẽ ghi ra ngoài). `Pool()` là pool thô, truy vấn qua nó KHÔNG nằm trong transaction.
- Service giữ `*database.DB` để gọi `Tx`; repo giả trong test unit không có DB -> helper trong service:
  `if s.db == nil { return fn(ctx) }; return s.db.Tx(ctx, fn)`.
- Ví dụ:

```go
err := s.db.Tx(ctx, func(ctx context.Context) error {
	if err := s.repo.InsertOrder(ctx, don); err != nil {
		return err
	}
	return s.repo.InsertOrderItems(ctx, dong) // hỏng -> đơn ở trên cũng không còn
})
if err != nil {
	return nil, err
}
s.auditor.Audit(ctx, a, "...", "...", nil) // việc phụ: sau commit
```

- Kế hoạch bọc từng hàm service theo module: `C:/demo/qs-fe-work/D13-PLAN.md`. Test: `tx_test.go`, `tx_catalog_test.go`
  (cần `TEST_DATABASE_URL`).
- Lỗi cột / bảng (42703 / 42P01) trong transaction: `staleCatalog` nạp lại danh mục CHẠY NỀN, không chờ (transaction đang giữ 1 kết
  nối; chờ kết nối thứ 2 thì nhiều Tx cùng gặp lỗi có thể làm cạn pool và chờ nhau mãi). Ngoài transaction vẫn chờ nạp xong như cũ.
- `DEFAULT now()` (`created_at`, `sent_at`, `changed_at`...) lấy giờ BẮT ĐẦU transaction: mọi dòng chèn trong 1 Tx trùng mốc giờ.
  Đừng gộp vào 1 Tx các lệnh chèn mà kết quả đọc lại sắp theo cột giờ (`order=<cột giờ>.desc`) - thứ tự sẽ đảo so với khi chưa bọc.
  Muốn gộp thì cần migration đổi sang `clock_timestamp()` (chưa làm).

Đã bọc (D-13, xong 2026-10-15). Mỗi service có trường `db *database.DB` + helper `s.tx` (db nil -> chạy thẳng fn cho repo giả).
Khi thành công: kết quả, dữ liệu ghi, golden giữ nguyên; chỉ khác khi lỗi giữa chừng (không còn dữ liệu dở dang).
Việc phụ (audit, lịch sử, thông báo, Lark, xoá cache) đặt SAU `s.tx`, không dùng `AfterCommit`.

| Module | Hàm | Trong 1 transaction | Sau commit / ngoài transaction |
|---|---|---|---|
| purchasing | `SavePurchaseOrder` | MỖI đơn: phiếu + dòng hàng (1 Tx / đơn) | bù trừ xoá các đơn đã commit trước đơn hỏng (nuốt lỗi, như Node). Cả lần gửi CHƯA nguyên tử giữa các đơn (lý do `DEFAULT now()` ở trên) |
| purchasing | `SaveDeXuat` | phiếu đề xuất + dòng chiết khấu + đợt thanh toán | bỏ bù trừ `DeleteProposal` (repo bỏ hàm này) |
| projects | `DeleteProject` | xoá `du_an` TRƯỚC (khoá dòng cha), rồi 3 lệnh xoá con (rỗng nhờ `ON DELETE CASCADE`; `DeleteProjData` vẫn nuốt lỗi, savepoint riêng). Repo giả (`db == nil`) giữ thứ tự Node | - |
| projects | `DuplicateProject` | chèn dự án + `copyChildren` + kiểm `len(ins)==0` | bù trừ `DeleteProject(newMa)` chỉ còn khi `db == nil` |
| quotations | `SaveCover` (rpc `saveCover`, `PUT /projects/:id/cover`) | đọc id cũ + chèn + xoá bản cũ (`ghiCover`) | `GetCover` đọc lại |
| companies | `CreateCongTy` | `InsertCongTy` + `AdminCreateUser` (audit `create_user` bên trong rollback theo) | audit `create_company` |
| companies | `DeleteCongTy` | vòng `RemoveTenantRows` (lỗi từng bảng bỏ qua như Node) + `RemoveCongTy` | audit |
| materials | `SetCombo`, `SetBienThe` | phần ghi (`ghiCombo`, `ghiBienThe`) | lịch sử, audit, `cacheClear` |
| materials | `DeleteDbProduct` | xoá SP + 3 lệnh dọn liên kết (nuốt lỗi như Node) | lịch sử, audit, `cacheClear` (dời ra sau commit: trong Tx thì cache có thể nạp lại dữ liệu cũ) |

- Deadlock `40P01`: KHÔNG tự chạy lại fn. Ở READ COMMITTED lần chạy lại có thể đọc trước khi bên thắng commit rồi ghi đè thay đổi của
  bên kia; muốn chạy lại đúng thì nền tảng cần đọc có khoá (`SELECT ... FOR UPDATE`, chưa có) và fn phải đọc có khoá mọi dữ liệu nó dựa
  vào. materials `s.tx` đổi 40P01 ở Tx ngoài cùng thành lỗi tiếng Việt `loiTranhChap` (đã rollback sạch, dữ liệu = chỉ bên thắng;
  `TestTxSetBienTheDeadlock`); đang trong Tx ngoài thì trả nguyên 40P01 cho Tx ngoài quyết.
- Thứ tự khoá: trong Tx, khi xoá theo bản ghi cha thì khoá / xoá dòng cha TRƯỚC dòng con. Xoá con trước rồi mới tới cha sẽ va với Tx
  khác vừa chèn dòng con (giữ `KEY SHARE` trên cha) rồi xoá dòng con cũ -> deadlock (`projects.DeleteProject` với `SaveCover`,
  `TestTxDeadlockDB`). Viết thêm hàm bọc Tx mới thì tự kiểm thứ tự này.
- Cố ý KHÔNG bọc (thành công từng phần là hành vi hiện có, bọc sẽ đổi kết quả khi thành công): `ImportCommit`, `ResolveDeleteRequest`,
  `SetSpDuyet`, `SetYeuThich`, `SaveDbProduct`, `UpdateDbProductTracked`, `CopySharedProduct`, `RequestDeleteProducts`, `UpdateCongTy`,
  `nhacGiaHan`, `CreateCongTyUser`, `SetProjData`, `CreateProject`, `UpdateProject`, `ExportBaoGia`, `SendPurchaseRequest`, `SendDeXuat`,
  `ResolvePurchaseRequest`, `ResolveDeXuat`, `SetPurchaseStatus` (thông báo, Lark, `ghiKetQuaGui`, `ghiNguoiDuyet`, audit vẫn sau khi lưu).
- `users.AdminSetPassword` và `auth.ChangePassword` KHÔNG bọc: đổi mật khẩu rồi thu hồi phiên; thu hồi lỗi thì trả lỗi (mật khẩu đã đổi,
  làm lại thì thu hồi lại). Bọc phải dời bước bỏ cache phiên thứ 2 (`closeOtherSessions`) ra sau commit, không thì một request đọc
  "phiên còn dòng" trước commit ghi lại cache dương 30 giây - chưa đáng đổi cho trường hợp hiếm này.
- Test rollback (lỗi tiêm giữa chừng -> database không đổi, chạy trên `qspro_gotest`): `purchasing/service_tx_test.go`
  (`TestSaveTxRollback`), `projects/tx_db_test.go` (`TestTxRollbackDB`), `quotations/service_tx_test.go` (`TestSaveCoverTxRollback`),
  `companies/tx_db_test.go` (`TestTxCongTyDB`), `materials/service_tx_test.go` (`TestTx*`). Khác Node có chủ ý trong golden: mục 10.4.
- Người viết test thử đột biến: sao lưu file vào `C:/demo/qs-fe-work/scripts/<nhãn>/` hoặc dùng `go test -overlay`, KHÔNG dùng thư mục
  scratchpad chung (sự cố 2026-10-15: hai agent cùng ghi `service.go.bak`, `purchasing/service.go` bị đè bằng mã quotations).

### 3.6 `storage`, `logger`, `config`

```go
// internal/platform/storage   - kho file trên đĩa: <UPLOAD_DIR>/<path>, URL công khai /files/<path>
const DefaultDir = "uploads";  const Prefix = "/files/"
func New(dir string) *Client                          // rỗng -> DefaultDir (tương đối với thư mục chạy); thư mục tạo ở lần ghi đầu
func (s *Client) Upload(ctx, buf []byte, path, contentType string) (string, error)   // ghi đè nếu trùng tên, trả /files/<path>
func (s *Client) PublicURL(path string) string;  Dir() string
func (s *Client) Open(path string) (*os.File, fs.FileInfo, error)   // sai đường dẫn / thư mục / không có -> fs.ErrNotExist
func (s *Client) ReadURL(url string, max int64) ([]byte, error)     // đọc file theo URL /files/..., tối đa max byte
func ValidPath(p string) bool;  func PathOf(url string) (path string, ok bool)

// internal/platform/logger   - console.error('[api] x lỗi:', msg) -> logger.Error("api", "x lỗi:", msg)
func Info(tag string, args ...any);  func Error(tag string, args ...any)
func Infof(tag, format string, a ...any);  func Errorf(tag, format string, a ...any)
func New(out, errw io.Writer) *slog.Logger;  func L() *slog.Logger;  func SetDefault(l *slog.Logger)

// internal/platform/redis
type Client = goredis.Client
func New(url string) (*Client, error)

// internal/config
type Config struct { Port int; DatabaseURL string; DBPoolMax int; DBSortCollation, AuthSecret,
    LarkDomain, LarkAppID, LarkAppSecret, PurchaseWebhook, ReportWebhook,
    AppVer, SwaggerDocs, NodeEnv,
    StaticDir, VendorDir string; CORSOrigins []string; RateLimit float64; RedisURL string; Debug bool;
    ReportJob bool; UploadDir string; TrustedProxies []string }
func LoadDotenv(files ...string)   // mặc định .env rồi ../.env; đọc như dotenv 16 của Node; không đè biến đã đặt; DOTENV=0 -> không đọc file nào
func Load() *Config
```

Module đọc cấu hình qua `Deps.Cfg`, KHÔNG gọi `os.Getenv` trực tiếp (`REPORT_JOB` = `Cfg.ReportJob`, `TRUSTED_PROXIES` = `Cfg.TrustedProxies`).
Ngoại lệ: `DOTENV` được đọc trong `LoadDotenv` (trước khi có `Config`); `cmd/migrate` tự đọc `DATABASE_URL`.
Biến `TEST_DATABASE_URL`, `*_OUT`... chỉ file test đọc.

Kho file (`storage`): mọi đọc / ghi đi qua `os.Root` nên không leo ra ngoài `UPLOAD_DIR`, kể cả qua symlink. Đường dẫn hợp lệ (`ValidPath`):
các đoạn cách nhau `/`, không rỗng, không bắt đầu bằng dấu chấm, không có `\` / `:` / NUL, không phải tên thiết bị của Windows.
`Upload` ghi ra file tạm cùng thư mục rồi đổi tên (người đọc không thấy file ghi dở); `contentType` không được lưu.
`internal/server/uploads.go` phục vụ GET / HEAD `/files/<path>` công khai (middleware đứng trước mọi route, không tra phiên):
không có file, thư mục, đường dẫn sai -> 404; có Range, `Last-Modified` / 304; Content-Type theo đuôi file (bảng `uploadTypes`,
ngoài bảng -> `application/octet-stream`), `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400`; SVG kèm CSP `sandbox`.
URL `/files/...` là tương đối nên quotations đọc ảnh thẳng từ đĩa (`FileReader`), không tải qua HTTP.

### 3.7 `response`, `errors`, `validator`

```go
// internal/shared/response
func OK(c *gin.Context, result any)                           // {"ok":true,"result":...}
func Fail(c *gin.Context, status int, msg string, code ...string)   // {"error":...[,"code":...]} + Abort
func Error(c *gin.Context, err error)                         // mã HTTP từ AppError, lỗi thường -> 500
func Result(c *gin.Context, result any, err error)            // gọn: lỗi -> Error, không lỗi -> OK
func JSON(c *gin.Context, status int, v any)
func HTMLError(c *gin.Context, status int, msg string)        // trang lỗi kiểu Express
func NoCache(r *http.Request) bool                            // client gửi Cache-Control có no-cache -> không trả 304

// internal/shared/errors  (import: apperr "qspro-backend/internal/shared/errors")
type AppError struct { Status int; Msg, Code string }
func E(status int, msg string, code ...string) *AppError
func New(msg string) error                                    // throw new Error(msg)
func Errorf(format string, a ...any) error
func BadRequest / Forbidden / NotFound (msg string) *AppError
func Message(err error) string                                // e.message || "Lỗi máy chủ"
func Status(err error) (int, string)
func Is(err, target error) bool;  func As(err error, target any) bool

// internal/shared/validator
func Body(c) (*omap.Map, error);  func Param(c, name) (string, error);  func ParamNum(c, name) (float64, error)
func Query(c, name) any;  func QueryNum(c, name, def) float64;  func QueryBool(c, name) bool
func Require(m *omap.Map, keys ...string) error
```

Cổng `/api/:fn` LUÔN trả 500 + `{"error": message}` cho mọi lỗi của handler (đúng như Node), bất kể `AppError.Status`.
Service cứ trả `apperr.New(...)`; chỉ dùng `apperr.E(4xx, ...)` khi muốn route REST trả mã khác 500.

### 3.8 `qspro-backend/internal/server/rpc` - cổng `/api/:fn`

```go
type Perm uint8
const ( Login Perm = 0; Public; Admin; Super )         // kết hợp: rpc.Admin|rpc.Super
type Handler func(ctx context.Context, a *actor.Actor, args Args) (any, error)
type Args []any
func (a Args) Len() int;  Has(i int) bool
func (a Args) Arg(i int) any          // thiếu -> nil
func (a Args) ArgU(i int) any         // thiếu -> jsval.Undefined (khi Node phân biệt undefined / null)
func (a Args) Str(i int) string       // String(x ?? "")
func (a Args) Num(i int) float64      // Number(x); thiếu -> NaN
func (a Args) Map(i int) *omap.Map;  Arr(i int) []any;  Bool(i int) bool
func NewRegistry() *Registry
func (r *Registry) Register(name string, perm Perm, h Handler)   // trùng tên -> panic lúc khởi động
func (r *Registry) Has(name string) bool;  PermOf(name) (Perm, bool);  Names() []string
// route REST chỉ bản Go (không phải hàm rpc: Has / PermOf / Names không thấy)
type GoField struct { Name, In, Type, Desc string; Required bool }       // In: path | query | body
type GoRoute struct { Name, Method, Path string; Perm Perm; Tag, Summary string; Fields []GoField }
func (r *Registry) RegisterGoRoute(g GoRoute)   // trùng Name / Method+Path / tên hàm rpc -> panic lúc khởi động
func (r *Registry) GoRoutes() []GoRoute          // theo thứ tự đăng ký
func (r *Registry) Call(ctx, name string, a *actor.Actor, args ...any) (any, error)
func (r *Registry) Handle(sessions middleware.SessionResolver, appVer string) gin.HandlerFunc
```

Bảng quyền lấy từ `server/index.js`: hàm trong `PUBLIC_FNS` -> `rpc.Public`; trong `ADMIN_FNS` -> `rpc.Admin`;
trong `SUPER_FNS` -> `rpc.Super`; trong cả hai -> `rpc.Admin|rpc.Super`; còn lại -> `rpc.Login`.
Hàm thuộc `ACTOR_FNS` nhận actor làm tham số đầu bên Node -> handler truyền `a` vào service; hàm khác bỏ qua `a`.
Handler trả `nil` hoặc `jsval.Undefined` -> client nhận `"result": null`.
`ctx` của handler đã có ngữ cảnh công ty và KHÔNG bị huỷ khi client ngắt kết nối (Node cũng chạy hết handler).

### 3.9 `qspro-backend/internal/middleware`

```go
type SessionResolver interface { SessionActor(ctx context.Context, token string) (*actor.Actor, error) }
type SessionHolder struct{ ... };  func NewSessionHolder() *SessionHolder;  func (h *SessionHolder) Set(r SessionResolver)
func BearerToken(r *http.Request) string
func ActorOf(c *gin.Context, s SessionResolver) *actor.Actor      // actorOf_ của Node; SessionStoreError -> 500 + c.Abort()
type SessionStoreError struct{ Msg string }                       // kho phiên hỏng (thiếu bảng user_sessions) - M1.2
func Auth(s SessionResolver) gin.HandlerFunc                      // gắn actor vào gin.Context, không chặn
func RequestContext(r *http.Request, a *actor.Actor) context.Context
func Tenant() gin.HandlerFunc                                     // c.Request.Context() mang tenant + actor
func RequireLogin() / RequireAdmin() / RequireSuper() / RequireAdminSuper() gin.HandlerFunc
func Deny(a *actor.Actor, needAdmin, needSuper bool) (status int, msg, code string)
func JSONBody(limit int64) gin.HandlerFunc;  func Body(c) any;  func BodyMap(c) *omap.Map   // req.body
func DrainBody() gin.HandlerFunc   // đọc bỏ thân chưa đọc sau khi trả lời (như Node) - thân quá 30 MB vẫn nhận được trang 413
func CORS(origins []string) gin.HandlerFunc;  func RateLimit(rps float64, rdb *redis.Client) gin.HandlerFunc
func ViewCompany(r *http.Request) string                          // header x-view-company
const JSONBodyLimit = 30 << 20                                    // express.json({ limit: '30mb' })
const MsgRateLimited = "Quá nhiều yêu cầu, vui lòng thử lại sau"   // 429, chỉ bản Go có
```

Thông báo: 401 `{"error":"Chưa đăng nhập","code":"NOAUTH"}`, 403 `Không có quyền (chỉ Admin)`, 403 `Chỉ quản trị hệ thống`.
Module auth cài `SessionResolver` (bản chuyển của `auth.sessionActor`) và phần nối gọi `d.Sessions.Set(authSvc)`.

**Phiên lưu phía máy chủ (M1.2, migration 0014, bảng code `phien_dang_nhap` = `user_sessions`).** `login` mở 1 dòng phiên và ký
token có thêm khoá `sid` (cuối payload). `SessionActor`: token đúng chữ ký, chưa hết hạn, có `sid` dạng uuid -> cache theo `sid`
(30 giây, mục cache nhớ `uid` để `ForgetSession(uid)` bỏ mọi phiên của tài khoản) -> đọc tài khoản -> công ty -> phiên còn dòng và
`het_han` > bây giờ. Thứ tự tài khoản TRƯỚC phiên để golden Node (uid hỏng -> lỗi database 22P02) giữ nguyên. Token không có `sid`
(phát trước 0014) bị từ chối không đọc database. `logout` xoá dòng của `actor.SID`; `changePassword` xoá mọi phiên khác của tài
khoản (actor không có SID - chỉ có ở lời gọi nội bộ / test - thì không xoá); `users.AdminSetPassword` gọi
`SessionInvalidator.RevokeUserSessions(uid, keep)` xoá mọi phiên của tài khoản (keep = phiên của admin khi tự đặt lại cho mình).
Thu hồi ghi `sid` vào danh sách `revoked` 60 giây để request đang đọc database song song không ghi lại cache dương; thu hồi theo
tài khoản đánh dấu cả các `sid` có trong cache (trước lệnh xoá) lẫn các `sid` database vừa xoá (`DELETE ... RETURNING`, sau lệnh
xoá) nên phiên chưa có trong cache cũng không lọt. Cache khoá theo `sid` được dọn mục quá 30 giây (`sweepCache`, tối đa 1 lần /
30 giây) để không phình theo số lần đăng nhập. Chỉ module auth chạm bảng phiên (test `TestPhienChiTruyCapQuaAuth`): bảng
không nằm trong `TenantTables` nên lớp dữ liệu không có lọc công ty dự phòng. Mọi truy vấn bảng phiên `NoScope` (chưa biết công ty, như đăng
nhập; bảng không có `company_id`). Thiếu bảng (PGRST205 / 42P01) -> `middleware.SessionStoreError` với thông báo đích danh:
`ActorOf` trả 500 + thông báo và dừng request (cổng `/api/:fn` kiểm `c.IsAborted()`), `login` trả cùng thông báo; không thành 401.
Khoá tài khoản KHÔNG xoá phiên (mở khoá lại thì token cũ dùng tiếp, golden `s_staff_unlocked_immediately`).

### 3.10 `qspro-backend/internal/server`

```go
type Deps struct { Cfg *config.Config; DB *database.DB; Storage *storage.Client; Redis *redis.Client;
                   Reg *rpc.Registry; Sessions *middleware.SessionHolder }
type Module interface { RegisterRPC(reg *rpc.Registry); RegisterRoutes(v1 *gin.RouterGroup) }
type RootModule interface { RegisterRoot(root *gin.RouterGroup) }   // route lẻ: /export/..., /upload/file, /media
func New(d *Deps) *Server;  func (s *Server) Engine() *gin.Engine;  func (s *Server) Run(ctx) error
func (s *Server) OnShutdown(fn func(context.Context))
func (s *Server) Deps() *Deps;  func (s *Server) Reports() contracts.ReportRunner;  func (s *Server) Expiry() contracts.ExpiryReminder;  func (s *Server) SwaggerOn() bool
type RestRoute struct { Fn, Method, Path string };  var RestRoutes []RestRoute;  var RootRoutes [][2]string   // rest.go
```

Khớp route như Express 4: `HEAD` dùng handler của `GET`; phần cố định của đường dẫn không phân biệt hoa thường và cho phép thừa
một dấu `/` cuối (`/API/getProjects/` = `/api/getProjects`, giá trị tham số giữ nguyên); tham số được giải mã phần trăm
(`/api/a%2Fb` -> `a/b`). Module chỉ đăng ký route `GET`, không đăng ký thêm `HEAD`.

### 3.11 `qspro-backend/internal/shared/qscore` - số của store

```go
func ToNumber(v any) float64     // shared.toNumber_: đọc số kiểu VN
func N(v any) float64            // n() của store_supa.js: null / "" / NaN / Infinity -> 0, còn lại như ToNumber
func Round0(v any) float64       // round0_ của store_supa.js = Math.round(n(v))  <- nghiệp vụ dùng hàm này
func Round0Num(n any) float64    // round0_ của shared.js = Math.round(Number(n) || 0)  (chỉ importParse dùng)
const LIM = 20000
func ChamTran[T any](rows []T, limit int, ten string) []T   // chamTran_: cảnh báo khi chạm giới hạn dòng (limit <= 0 = LIM)

// phần còn lại của server/shared.js
type SupplierGroup struct{ ... }
var S32Suppliers []SupplierGroup          // S32_SUPPLIERS
func S32SuppliersOf(stt string) [][2]string
func S32SuppliersValue() *omap.Map        // dạng object trả cho client
var S32Subs []string                      // S32_SUBS: "3.2.1" .. "3.2.8"
var CoverTemplate [][3]string             // COVER_TEMPLATE
func InCode(nhom, stt any) bool           // inCode
func Normalize(v any) string              // normalize_
func CoverComputed(cover []any) *omap.Map // coverComputed_
func ImportParse(base64Data, ext, nganh any) (*omap.Map, error)   // importParse

// sheetrows.go - chỉ bản Go (M5.1, route POST /api/v1/work-items/import/parse của estimates)
type SheetRow struct{ Dong int; Cells []any }   // Dong = số dòng thật trong file (tính cả dòng trống xen giữa)
func SheetRows(buf []byte, ext string) ([]SheetRow, error)   // sheet đầu; xlsx qua readXLSX của importParse, CSV giữ chuỗi gốc của ô
func DecodeBase64(s string) []byte        // bộ giải base64 của importParse
```

`csv.go` và `xlsx.go` không xuất hàm nào: bộ đọc CSV / xlsx (kể cả `importCell_`) chỉ được gọi qua `ImportParse` và `SheetRows`.
`SheetRows` không thêm thư viện: xlsx lấy `Dong` từ `<row r>` của sheet đầu (không đối chiếu được số dòng với `readXLSX` thì đánh số
liên tiếp 1..n); CSV đếm cả dòng trống và ô xuống dòng trong ngoặc kép, ô giữ nguyên chuỗi (không đổi sang số).

### 3.12 `qspro-backend/internal/shared/specs` - thông số theo ngành (nguồn: `js/*-spec.js`, trước đây `public/*-spec.js`)

```go
type Spec struct { Name string; Data, Metric, HM, Opt *omap.Map; HangMuc, All, Chung, ChinhAll, TkAll []string; Muc, TenTk, VD string }
var VS, SON, CT *Spec                     // nhúng từ data/{vs,son,ct}.json (sinh bằng scripts/gen-specs.js)
func Strs(v any) []string
func BoDau(v any) string
func NganhOf(nganh, hangMuc any) string
func Dong(lb string, get func(col string) any) []string
func (s *Spec) ChuanHM(v any) string
func (s *Spec) HMGet(name string) *omap.Map
func (s *Spec) HMList(name, key string) []string
func (s *Spec) HmOf(v any) *omap.Map
func (s *Spec) LabelsOf(v any) []string
func (s *Spec) Gom(k string) []string
func (s *Spec) OptsOf(v, lb any) []string
func (s *Spec) IsReq(v, lb any) bool
func (s *Spec) MetricCol(lb string) string    // cùng dạng: MetricLabel, MetricKind, MetricHint
```

## 4. Vai trò từng file trong một module

`internal/modules/<module>/`

| File | Nội dung |
|---|---|
| `service.go` | `type Deps struct{...}`, `type Service struct{...}`, `func New(d Deps) *Service`, và nghiệp vụ chuyển 1:1 từ Node. Tên phương thức = tên hàm Node viết PascalCase (`getProjects` -> `GetProjects`, `calc_` -> `calc`). Giữ thứ tự thao tác, thứ tự gọi database và thông báo lỗi. |
| `repository.go` | `type Repository interface{...}`: những gì service cần từ kho dữ liệu. |
| `postgres.go` | Cài `Repository` bằng `*database.DB` (đọc / ghi, đổi dòng DB <-> object như repository / mapper của Node). |
| `model.go` | Kiểu dữ liệu nghiệp vụ cố định (nếu có). Dữ liệu động dùng `*omap.Map`. |
| `dto.go` | Struct request / response cho REST (trường khai báo đúng thứ tự khoá JSON). |
| `handler.go` | `RegisterRPC(reg *rpc.Registry)`, `RegisterRoutes(v1 *gin.RouterGroup)`, tuỳ chọn `RegisterRoot(root *gin.RouterGroup)`, và các handler gin của REST. Không chứa nghiệp vụ. |
| `service_test.go` | Test đơn vị với repository giả + test tích hợp (bỏ qua khi thiếu `TEST_DATABASE_URL`). |

Module nhỏ có thể gộp repository vào service (gọi thẳng `*database.DB`) nếu tách ra chỉ thêm lớp vỏ;
nhưng `handler.go` và `service.go` luôn tách.

Ba module không đủ bộ file trên, có chủ ý:

| Module | Thiếu | Lý do |
|---|---|---|
| `categories` | `repository.go`, `postgres.go`, `dto.go` | không đọc database, không có REST: chỉ dữ liệu ngành + 3 route file mẫu |
| `files` | `repository.go`, `postgres.go`, `dto.go` | không đọc database: chỉ gọi Lark cho `/media` |
| `system` | chỉ có `handler.go` + `service.go` | khuôn tối thiểu, không có nghiệp vụ |

`categories` và `files` mỗi gói có một bản `express.go` giống nhau (mô phỏng cách Express đọc query / trả file); sửa bên này phải sửa bên kia.

Khuôn tối thiểu: xem `internal/modules/system`.

## 5. REST `/api/v1`

- Group `v1` đã có `middleware.Auth` + `middleware.Tenant`: handler lấy `c.Request.Context()` (đã có tenant + actor)
  và `actor.FromGin(c)`; chặn quyền bằng `middleware.RequireLogin()` / `RequireAdmin()` / `RequireSuper()` trên từng route / group.
- Đường dẫn: `/api/v1/<tài-nguyên>` số nhiều, tiếng Anh, kebab-case. `GET` đọc, `POST` tạo / thao tác, `PATCH /:id` sửa một phần,
  `PUT` ghi đè một giá trị, `DELETE /:id` xoá theo quy tắc nghiệp vụ của hàm Node tương ứng. Mỗi hàm rpc có đúng một route;
  ngoài 80 route đó chỉ có route "chỉ bản Go" đã khai bằng `reg.RegisterGoRoute` (mục 10.4, `docs/API.md` mục 2.1;
  ví dụ không có `GET /projects/:id`).
- Bảng route CHUẨN là `RestRoutes` trong `internal/server/rest.go` (bản để đọc: `docs/API.md`). Tham số đường dẫn ứng với các
  tham số đầu của hàm rpc theo thứ tự; phần còn lại lấy từ query string (`GET`) hoặc thân JSON theo tên tham số.
- Phong bì giống cổng rpc: thành công `{"ok":true,"result":...}`, lỗi `{"error":"...","code":"..."}`.
- Handler REST chỉ đọc tham số rồi gọi ĐÚNG phương thức service mà hàm rpc gọi (không viết lại nghiệp vụ):

```go
func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
    g := v1.Group("/projects", middleware.RequireLogin())
    g.GET("", func(c *gin.Context) { r, err := s.GetProjects(c.Request.Context()); response.Result(c, r, err) })
    g.PATCH("/:id", func(c *gin.Context) {
        body, err := validator.Body(c)
        if err != nil { response.Error(c, err); return }
        r, err := s.UpdateProject(c.Request.Context(), c.Param("id"), body)
        response.Result(c, r, err)
    })
}
```

## 6. Gọi chéo giữa các module

Gói module KHÔNG import gói module khác (tránh vòng lặp import; ngoại lệ: gói dữ liệu thuần `categories`). Interface gọi chéo
khai báo MỘT LẦN trong `internal/shared/contracts` (mục 11); module dùng đặt kiểu trường `Deps` bằng interface ở đó, module chủ cài
bằng phương thức của `*Service`; phần nối trong `internal/server/routes.go` truyền service của module chủ vào.

```go
// internal/shared/contracts/contracts.go
type Notifier interface {
    Notify(ctx context.Context, userID any, kind, title, body string, refID any)   // không trả lỗi
}

// internal/modules/purchasing/service.go
type Deps struct { DB *database.DB; Cfg *config.Config; PurchaseNotifier contracts.PurchaseNotifier; Notifier contracts.Notifier;
                   Users contracts.UserReader; Auditor contracts.Auditor; ... }

// internal/server/routes.go (khối MODULE WIRING)
notifSvc := notifications.New(notifications.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, Auditor: usersSvc})
purchSvc := purchasing.New(purchasing.Deps{DB: d.DB, Cfg: d.Cfg, PurchaseNotifier: notifSvc, Notifier: notifSvc,
    Users: usersSvc, Auditor: usersSvc})
```

Hai module cần nhau: tạo cả hai trước, rồi gắn phụ thuộc sau bằng setter, cũng trong khối MODULE WIRING (chỉ có hai setter
trên `*users.Service`, xem mục 11.2).
Kiểu trao đổi giữa module là kiểu của nền tảng (`*omap.Map`, `*actor.Actor`, kiểu cơ bản), không phải kiểu riêng của module.

## 7. Ví dụ chuyển một hàm từ đầu đến cuối

Node (`server/auth.js`):

```js
async function notifList(actor, limit) {
  const rows = await supa.select('notifications', { filter: supa.eq('user_id', actor.uid), order: 'created_at.desc', limit: Math.min(Number(limit) || 30, 100) });
  return rows.map(function (n) { return { id: n.id, kind: n.kind, title: n.title, body: n.body, refId: n.ref_id, read: n.is_read !== false ? n.is_read === true : false, at: n.created_at }; });
}
async function notifRead(actor, id) { await supa.update('notifications', supa.eq('id', id) + '&' + supa.eq('user_id', actor.uid), { is_read: true }); return { ok: true }; }
```
`index.js`: cả hai nằm trong `ACTOR_FNS`, không nằm trong `ADMIN_FNS` / `SUPER_FNS` -> `rpc.Login`, nhận actor.

Go - `service.go`:

```go
func (s *Service) NotifList(ctx context.Context, a *actor.Actor, limit any) ([]any, error) {
    rows, err := s.db.Select(ctx, "notifications", database.SelectOpt{
        Filter: database.Eq("user_id", a.UID), Order: "created_at.desc",
        Limit:  int(math.Min(jsval.NumOr(limit, 30), 100)),
    })
    if err != nil {
        return nil, err
    }
    out := make([]any, len(rows))             // mảng rỗng phải ra [] chứ không phải null
    for i, n := range rows {
        out[i] = omap.Of("id", n.Val("id"), "kind", n.Val("kind"), "title", n.Val("title"), "body", n.Val("body"),
            "refId", n.Val("ref_id"), "read", n.Val("is_read") == true, "at", n.Val("created_at"))
    }
    return out, nil
}

func (s *Service) NotifRead(ctx context.Context, a *actor.Actor, id any) (*omap.Map, error) {
    if _, err := s.db.Update(ctx, "notifications", database.Eq("id", id)+"&"+database.Eq("user_id", a.UID),
        omap.Of("is_read", true)); err != nil {
        return nil, err
    }
    return omap.Of("ok", true), nil
}
```

Ghi chú của ví dụ: `n.ref_id` của cột có trong SELECT không bao giờ undefined nên `n.Val("ref_id")` đủ; nếu khoá có thể
vắng mặt và Node đưa `undefined` vào object thì kết quả là khoá bị bỏ - `Val` trả `Undefined` nên `Marshal` cũng bỏ, vẫn khớp.
`n.is_read !== false ? n.is_read === true : false` rút gọn đúng thành `== true`.

Go - `handler.go`:

```go
func (s *Service) RegisterRPC(reg *rpc.Registry) {
    reg.Register("notifList", rpc.Login, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
        return s.NotifList(ctx, a, args.ArgU(0))
    })
    reg.Register("notifRead", rpc.Login, func(ctx context.Context, a *actor.Actor, args rpc.Args) (any, error) {
        return s.NotifRead(ctx, a, args.ArgU(0))
    })
}

func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
    g := v1.Group("/notifications", middleware.RequireLogin())
    g.GET("", func(c *gin.Context) {
        r, err := s.NotifList(c.Request.Context(), actor.FromGin(c), validator.Query(c, "limit"))
        response.Result(c, r, err)
    })
    g.POST("/:id/read", func(c *gin.Context) {
        r, err := s.NotifRead(c.Request.Context(), actor.FromGin(c), c.Param("id"))
        response.Result(c, r, err)
    })
}
```

Cẩn thận: `return rows, nil` với `rows` là slice nil có kiểu (`[]any(nil)`) được ghi thành `[]`; nhưng `var x *omap.Map = nil`
ghi thành `null`. Muốn trả mảng rỗng luôn tạo bằng `make` / `[]any{}`.

## 8. Bảng thành ngữ JS -> Go

| JavaScript | Go |
|---|---|
| `Object.assign({}, a, b)` | `omap.Assign(a.Clone(), b)` |
| `Object.assign(a, b)` | `omap.Assign(a, b)` |
| `{ x: 1, y: v }` | `omap.Of("x", 1.0, "y", v)` |
| `o.k` / `o[k]` | `o.Val("k")` (thiếu -> `Undefined`) |
| `o.k = v` / `delete o.k` | `o.Set("k", v)` / `o.Delete("k")` |
| `Object.keys(o)` / `for (k in o)` | `o.Keys()` / `o.Each(func(k string, v any) {...})` |
| `'k' in o`, `o.hasOwnProperty('k')` | `o.Has("k")` |
| `a && a.b && a.b.c` | `jsval.GetPath(a, "b", "c")` |
| `x \|\| y` | `jsval.Or(x, y)` |
| `x ?? y` | `jsval.Coalesce(x, y)` |
| `Number(x) \|\| 0` | `jsval.Num0(x)` |
| `Number(x) \|\| 30` | `jsval.NumOr(x, 30)` |
| `String(x \|\| '')` | `jsval.StrOr(x, "")` |
| `String(x == null ? '' : x)` | `jsval.Str(x)` |
| `String(x).trim()` | `jsval.Trim(jsval.ToString(x))` (không dùng `strings.TrimSpace`) |
| `!!x`, `if (x)` | `jsval.Truthy(x)` |
| `x === y` / `x == y` | `jsval.StrictEquals(x, y)` / `jsval.LooseEquals(x, y)` |
| `typeof x === 'string'` | `jsval.IsString(x)` |
| `Array.isArray(x) ? x : []` | `jsval.AsArray(x)` (nil dùng như mảng rỗng khi duyệt) |
| `arr.map(f)` | `out := make([]any, len(arr)); for i, v := range arr { out[i] = f(v) }` |
| `arr.filter(f)` | `out := []any{}; for _, v := range arr { if f(v) { out = append(out, v) } }` |
| `arr.sort(cmp)` | `sort.SliceStable(...)` (sort của JS ổn định) |
| `arr.join(', ')` | `strings.Join(...)`; phần tử null / undefined thành rỗng: `jsval.ToString([]any{...})` cho dấu phẩy |
| `s.length`, `s.slice(a, b)` | `jsval.Len16(s)`, `jsval.Slice(s, a, b)` (đơn vị UTF-16) |
| `Math.round(x)` | `jsval.Round(x)` (không dùng `math.Round`) |
| `Math.round(x * 100) / 100` | `jsval.RoundTo(x, 2)` |
| `x.toFixed(2)` | `jsval.ToFixed(x, 2)` |
| `n.toLocaleString('vi-VN')` | `jsval.FormatVN(n)` |
| `parseFloat(s)`, `parseInt(s, 10)` | `jsval.ParseFloat(s)`, `jsval.ParseInt(s, 10)` |
| `isNaN(x)` | `f := jsval.ToNumber(x); f != f` |
| `JSON.stringify(v)` / `JSON.parse(s)` | `omap.MarshalString(v)` / `omap.DecodeString(s)` |
| `try { JSON.parse(s) } catch (e) { return [] }` | `v, err := omap.DecodeString(s); if err != nil { return []any{} }` |
| `Date.now()` | `jsval.NowMs()` |
| `new Date().toISOString()` | `jsval.ToISOString(time.Now())` |
| `new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)` | `jsval.ToISOString(time.Now().Add(7 * time.Hour))[:10]` |
| `encodeURIComponent(x)` | `jsval.EncodeURIComponent(x)` |
| `/re/.test(s)`, `s.replace(/re/g, r)` | `regexp.MustCompile` khai báo ở cấp gói. RE2 không có lookahead / backreference; `[\s\S]` -> `(?s).`; `\s` `\w` `\d` của Go chỉ ASCII (JS `\s` gồm cả khoảng trắng Unicode); `$1` trong chuỗi thay thế viết `${1}` |
| `s.normalize('NFD').replace(/[̀-ͯ]/g, '')` | `norm.NFD.String(s)` rồi bỏ các rune `unicode.Mn` trong khoảng U+0300..U+036F |
| `a.localeCompare(b, 'vi')` | `collate.New(language.Vietnamese).CompareString(a, b)` |
| `throw new Error('msg')` | `return nil, apperr.New("msg")` |
| `try { await f() } catch (e) { /* bỏ qua */ }` | `_, _ = f(ctx)` kèm chú thích lý do bỏ qua |
| `try {...} catch (e) { console.error('[x] lỗi:', e.message) }` | `if err != nil { logger.Error("x", "lỗi:", err.Error()) }` |
| `if (/42703\|PGRST204/.test(e.message))` | `if c := database.CodeOf(err); c == "42703" \|\| c == "PGRST204"` (hoặc so chuỗi `err.Error()` nếu Node so chuỗi) |
| `await Promise.all([a(), b()])` | gọi tuần tự theo đúng thứ tự (kết quả như nhau, tác động lên DB có thứ tự xác định) |
| `f().catch(function () {})` (không chờ) | `go func() { _ = f(context.WithoutCancel(ctx)) }()` |
| `tenant.run({ role: 'super' }, fn)` | `fn(tenant.With(ctx, tenant.Ctx{Role: "super"}))` |
| `function f(a, b = 5)` | handler dùng `args.ArgU(1)`; trong service: `if jsval.IsUndefined(b) { b = 5.0 }` |
| `Buffer.from(s, 'base64')` | `base64.StdEncoding.DecodeString` (Node bỏ qua ký tự lạ và thiếu padding: lọc trước khi giải mã) |

## 9. Kiểm thử và đối chiếu

- Chạy trong container (máy không cài Go): `docker exec qspro-go go build ./...`, `go vet ./...`, `go test -count=1 -p 1 ./...`
  (`-p 1` vì các gói dùng chung `qspro_gotest`; `./...` gồm cả `tests/integration`). Lệnh đầy đủ và hạ tầng thử: `backend/README.md` mục Kiểm thử.
- Test đơn vị: repository giả cài interface trong `repository.go`; giá trị mong đợi của phép ép kiểu / định dạng lấy bằng `node -e`.
- Test tích hợp: đọc `TEST_DATABASE_URL`, `t.Skip` khi rỗng; chỉ dùng database thử (`qspro_gotest`); tự dọn dữ liệu mình tạo.
- Đối chiếu tầng dữ liệu với golden Node (đã chạy với bản Node, 110 ca, 0 khác):
  `DIFF_GOLDEN=/repo/backend/tests/fixtures/db-diff-golden.txt go test ./internal/platform/database/ -run TestDiffGolden`
  (`DIFF_OUT=<đường dẫn>.txt ... -run TestDiffDump` ghi kết quả bản Go để xem). Đường dẫn trong `DIFF_OUT` / `DIFF_GOLDEN` phải TUYỆT ĐỐI
  (`go test` đứng ở thư mục của gói, đường dẫn tương đối báo `no such file or directory`). Cả hai cần `TEST_DATABASE_URL`;
  `TestDiffGolden` chỉ khớp trên database vừa đặt lại về seed.
- Công cụ đối chiếu chạy cùng app Node (bộ so vi sai `tests/e2e/diff`, `smoke.js`, `http-diff.sh`, `check-node-sync.sh`,
  `db-diff-node.js`, `db-diff-compare.js`, các `gen*.js` / `noderef.js` trong `testdata/`) đã chuyển khỏi repo ngày 2026-10-15
  (bản sao: `C:/demo/qs-unused-backup-2026-10-15/`, hoặc `git show 83d264e:<đường dẫn>`). Các kết quả đã ghi trong tài liệu này là của
  những lượt chạy trước đó.

## 10. Khác biệt so với server Node

Mọi khác biệt đã biết giữa hai bản nằm ở đây. Ngoài danh sách này, khác với Node là lỗi phải sửa.
Bộ so vi sai `tests/e2e/diff` (nay đã gỡ) chỉ chấp nhận một khác biệt khi nó có trong mục này.

### 10.1 Lớp HTTP và JSON (có chủ ý)

- Không gửi header `X-Powered-By: Express`.
- Thân JSON hỏng: trả trang 400 dạng production của Express (không kèm stack), kể cả khi `NODE_ENV` khác `production`.
  Tương tự cho trang 400 / 415 của `/upload/file` khi `Content-Encoding` hỏng hoặc lạ. Ảnh hưởng: chỉ nội dung trang lỗi.
- Thân JSON lồng sâu quá 2000 tầng: 400 (Node đọc được). Thân mã hoá UTF-16 thật: 400 (Node đọc được).
- Panic trong handler rpc -> 500 với nội dung panic (Node trả message của exception). Panic ngoài cổng rpc -> trang HTML 500 kiểu Express.
- `/media#x?token=a` (dấu `#` đứng trước `?`, chỉ client thô gửi được): Node khớp route, Go trả 404.
- REST `/api/v1`: tham số query luôn là chuỗi (`GET /bootstrap?maDA=0` = rpc `bootstrap("0")`); response có header `x-app-ver` như cổng rpc (M1.1).
- Chuỗi Go không giữ được surrogate lẻ. Escape surrogate lẻ trong thân JSON (`"\ud83d"`) thành U+FFFD ngay khi đọc thân:
  Go GHI được dòng chứa U+FFFD, còn Node gửi `\ud83d` xuống Postgres và bị từ chối (22P02 - `audit` nuốt lỗi, nơi khác trả 500).
  Cơ chế đã kiểm chứng trên Postgres (`'{"a":"\ud83d"}'::json` -> 22P02); chưa chạy đối chiếu qua từng hàm.
  Riêng `logClientError` cắt đôi emoji đã làm như Node (không ghi audit); dòng log console của Go hiện U+FFFD thay cho surrogate lẻ.
- `database.SelectOpt.Limit` là `int`: nơi gọi tự đổi `Number(limit)` của JS (0 = không giới hạn; JS `limit: 0.5` cho 0 dòng).
  `notifList` với limit ngoài khoảng (`<= -2^63`, `-Infinity`) trả đúng lỗi của Node (22003 / 42703) nhưng KHÔNG gửi truy vấn,
  nên cũng không nạp lại danh mục cột như Node làm khi gặp 42703. Ảnh hưởng: không có với client.

### 10.2 Tên trùng thuộc tính của `Object.prototype`

KHÔNG tái hiện (bản Go coi là tên lạ bình thường: 404 / lỗi cột / chuỗi thường):

- tên hàm rpc `/api/toString`, `/api/constructor`...; bộ lọc `ten=constructor.1`; cột tên `constructor`;
  ô CSV `constructor` / `__proto__`; `optsOf(hm, 'toString')`; nhãn cột trùng tên prototype trong materials.

CÓ tái hiện (vì đổi kết quả trả về hoặc dữ liệu ghi xuống; mỗi mục có test hồi quy sinh từ Node):

| Module | Hành vi | Test |
|---|---|---|
| users | `adminUpdateUser` với khoá riêng `hasOwnProperty` -> `fields.hasOwnProperty is not a function` | ca `upd_hasown_key*` |
| purchasing | payload có khoá riêng `__proto__` là object: chỉ bù các khoá còn thiếu (`assignPayload`) | `TestSendGolden` |
| reports | `tenNganh` với tên prototype -> `function Object() { [native code] }`, `[object Object]`... | `TestBaoCaoNhapSPFlow` |
| quotations | dòng tờ bìa có `stt` / `tang` / `nhom` trùng tên prototype; sheet `Constructor 2`; lỗi `richText` khi ô là hàm | `cases.json` + `golden.txt` |

### 10.3 Theo module

File Excel và XML:

- File .xlsx hỏng khi nhập: bản Go từ chối XML không đúng dạng ở các phần NÓ ĐỌC (workbook, rels, sharedStrings, styles, sheet) với thông báo
  riêng, không phải của saxes; các phần khác (drawing, table, docProps...) không đọc nên lỗi trong đó không bị phát hiện.
- quotations (`/export/bang`, `exportBaoGia`): ô có giá trị là object kiểu ô của ExcelJS (`{formula}`, `{text,hyperlink}`, `{richText}`,
  `{error}`, `{sharedString}`) được ghi thành chuỗi JSON, không thành kiểu ô tương ứng. Giao diện hiện tại không gửi được giá trị như vậy.
  (estimates đã ghi đúng các kiểu ô này.)
- estimates (`/export/cong-tac`): U+FFFE / U+FFFF trong chuỗi thành U+FFFD (file của Node cho đầu vào đó chính ExcelJS cũng không đọc lại được).
- XML thô của file xuất / file mẫu khác ExcelJS ở chi tiết không đổi nội dung ô: `spans` của dòng, thứ tự thuộc tính, thứ tự entry trong zip,
  `font.scheme`, vùng autoFilter dạng tuyệt đối (estimates). So ô bằng ExcelJS (`xlsx-parity.js`, `compare.js`) cho kết quả giống.

Gọi HTTP ra ngoài (Lark, webhook, tải ảnh):

- files (`/media`): gửi `Accept-Encoding: gzip` (Node: `gzip, deflate`, thêm `br` với https). Ký tự điều khiển trong token Lark: cả hai lỗi,
  nhưng Go trả lỗi thô của net/http thay cho `fetch failed`. Thân trả token: byte không phải UTF-8 không được thay bằng U+FFFD, câu báo lỗi
  JSON là của Go. `LARK_DOMAIN` có đoạn `.` / `..` hoặc host viết hoa không được chuẩn hoá. Ảnh hưởng: chỉ câu lỗi trong các ca hiếm này.
- quotations (tải ảnh cho Excel): ảnh trả `Content-Encoding: br` bị bỏ (không có bộ giải brotli; Go không xin `br`). Path bắt đầu `//`
  có ký tự Go buộc mã hoá lại (`|`, `^`, `%` lẻ) được mã hoá theo luật của Go. `Location` khi chuyển hướng do Go phân tích; nếu chỉ có query
  (`?a=1`) sau một URL dùng `Opaque` thì mất host, ảnh bị bỏ. Thứ tự / kiểu chữ header khác, không gửi `connection: keep-alive` tường minh.
- purchasing (webhook): bỏ tối đa 2 BOM đầu thân trả về như Node 22.14 (bản Node khác có thể bỏ số khác). Huỷ context hoặc hết 300 giây cũng
  ghi log `fetch failed`.
- reports (webhook báo cáo): header mặc định của Go (`User-Agent: Go-http-client/1.1`, không có `accept`, `accept-language`, `sec-fetch-mode`).
  Log khi webhook lỗi giữ nguyên nhân dial / TLS thay cho `fetch failed`. Ảnh hưởng: chỉ dòng log.

Chữ và thời gian:

- reports, companies: `jsLower` dùng bảng Unicode của Go; luật sigma cuối từ dùng tập Case_Ignorable xấp xỉ. companies đã bù 27 chữ của
  Unicode 16 mà Go chưa có (quotations cũng đã bù, có test so với bảng của Node 22.14). Ký tự hiếm có thể ra chữ thường khác V8.
- auth (`login`), users (`adminCreateUser`): `toLowerCase` của tên đăng nhập dùng bảng của Go, thiếu 27 cặp chữ Unicode 16. Ảnh hưởng (theo đọc mã,
  chưa chạy): tên như vậy bị luật `^[a-z0-9._-]{3,}$` từ chối khi tạo ở cả hai bản; khi đăng nhập chỉ khác nếu tên đã lưu chứa các chữ đó.
- reports: `tuVN` không có múi giờ dựa vào tzdata của Go (V8 dùng ICU); giống nhau ở 6 múi đã thử, có thể lệch ở luật lịch sử.

Đồng thời và tắt server:

- projects `bootstrap`: khi cả hai việc cùng lỗi, lỗi trả về là lỗi tới trước (như `Promise.all`), nhưng Go chạy hai goroutine nên
  thứ tự khi sát nút không cố định (Node luôn gọi `getProjects()` trước).
- jobs: khi tắt, `Stop` để lượt gửi đang chạy xong và ghi dòng audit. Node chết giữa chừng thì thẻ đã gửi mà chưa có audit, lần khởi động sau gửi lại.

materials:

- `qsName` (tên file của `/upload/file`) xấp xỉ bộ phân tích `qs`: dạng object `name[...]` lẫn với dạng chuỗi / mảng ra `[object Object]`
  (Node có thể ra `a,[object Object]`); `name[][]` ra `[object Object]` (Node ra mảng lồng); mảng quá 1000 phần tử không đổi thành object.
  Ảnh hưởng: chỉ tên file lưu khi client cố ý gửi query dạng lạ.

### 10.4 Chỉ bản Go có

- REST `/api/v1` (80 route) và 80 thao tác REST thêm vào `/api-docs.json`.
- Route REST "chỉ bản Go" (tính năng làm sau khi gỡ Node, không có hàm `/api/:fn`): module khai `reg.RegisterGoRoute` + route gin
  (mục 12.1); `/api-docs.json` có thêm thao tác nhóm `REST - <Tag> (chỉ bản Go)`, `operationId` `v1go_<Name>`,
  và một câu nối sau đoạn "Mỗi hàm RPC" của `info.description` (chỉ khi có ít nhất một route như vậy).
- Khoá / cột "chỉ bản Go" (cột database mới sau migration 0008, khoá kết quả mới). Golden do Node sinh không có các khoá này; test bỏ chúng
  bằng `internal/shared/goonly` trước khi so (mục 12.1). Danh sách hiện tại (tên trong code; steward bổ sung khi đơn vị báo thêm).
  Mỗi khoá CHỈ là "chỉ bản Go" trong phạm vi ghi ở cột 2; ngoài phạm vi đó, cùng tên khoá có thể là khoá Node có thật:

  | Khoá | Phạm vi (chỉ bỏ ở đây) | Cột (code -> DB) | Ý nghĩa |
  |---|---|---|---|
  | `nguoi_duyet` | dòng `don_mua_hang` | `purchase_orders.resolver_name` | người đổi trạng thái đơn mua hàng |
  | `ngay_duyet` | dòng `don_mua_hang` | `purchase_orders.resolved_at` | lúc đổi trạng thái |
  | `nguoiDuyet`, `ngayDuyet` | kết quả đơn mua hàng (`getPurchaseOrder`, `GET /api/v1/purchase-orders/:code`) | hai cột trên | như trên, phía client (khoá có từ Node, nay có giá trị - M15.1) |
  | `nguoiDuyet`, `ngayDuyet`, `ketQuaGui` | từng đơn của `getPurchaseOrders` (`GET /api/v1/projects/:id/purchase-orders`), nối CUỐI object | `resolver_name`, `resolved_at`, `send_result` | người / lúc duyệt, kết quả gửi Lark (chuỗi, `""` khi null) - M15.1, M9.1 |
  | `kenhGui`, `ketQuaGui` | `getPurchaseOrder` (`GET /api/v1/purchase-orders/:code`), nối CUỐI | `send_channel`, `send_result` | kênh gửi, kết quả gửi Lark - M9.1 |
  | `resolver`, `resolvedAt` | từng đơn của `listPurchaseRequests` (`GET /api/v1/purchase-orders`), nối CUỐI | `resolver_name`, `resolved_at` | giá trị cột nguyên dạng, null khi chưa duyệt - M15.1 |
  | `ket_qua_gui` | dòng `don_mua_hang` | `purchase_orders.send_result` | Go ghi `ok` / `loi` sau khi gửi thẻ Lark (lệnh riêng, M9.1); test khẳng định rồi đặt lại giá trị lúc lưu như Node |
  | `resolution_note` | dòng `delete_requests` | `delete_requests.resolution_note` | lý do từ chối yêu cầu xoá |
  | `lyDo`, `lyDoTuChoi` | từng dòng của `listDeleteRequests` (`GET /api/v1/product-delete-requests`), nối CUỐI | `note`, `resolution_note` | lý do gửi / lý do từ chối, giá trị cột nguyên dạng - M15.2 |
  | `hien_trang` | dòng `du_an` | `projects.current_condition` | hiện trạng dự án |
  | `sid` | payload token (`login.token`, `$verifyToken`, `$makeToken` trong `auth/service_test.go`) | `user_sessions.id` | id phiên (M1.2); `userstest.Norm` bỏ khoá này khi giải token, `auth/service_test.go` bỏ ở `$verifyToken`; `$makeToken` mở phiên thật (uid không mở được -> sid giả) |
  | `hienTrang` | object dự án (`getProjects`, `getProject`, `createProject`, `updateProject`, `duplicateProject`, `bootstrap.projects`, REST `/projects*`), nối CUỐI sau `linkDezon` | `projects.current_condition` | như trên, phía client (M8.3); `projects/service_test.go` `goOnlyResultKeys` kiểm rỗng rồi mới bỏ |

  Cách test giữ golden của đợt 2: `purchasing/service_db_test.go` khẳng định đơn đã resolve có `nguoi_duyet` = người thao tác + có
  `ngay_duyet` (đơn khác chỉ `StripNull`), `ket_qua_gui` = `ok` khi `res.lark` / `loi` khi không, và khẳng định các khoá kết quả mới của 3 hàm
  đọc rồi mới bỏ; `materials/diff_test.go` `goOnlyKeys` = `lyDo`, `lyDoTuChoi` (`StripNull`, kịch bản không gửi lý do). Test riêng không golden:
  `purchasing/service_goonly_test.go`, `materials/service_lydo_test.go`, `projects/hientrang_test.go`, `quotations/export_opts_test.go`,
  `estimates/service_import_test.go`, `qscore/sheetrows_test.go`, `auth/service_test.go` (`TestPhienDangNhap`),
  `middleware/auth_session_test.go`, `server/rpc/session_test.go`. Không fixture / testdata nào bị sửa.

  CẢNH BÁO: `nguoi_duyet` / `ngay_duyet` (và `nguoiDuyet` / `ngayDuyet`) cũng là cột / khoá Node có thật của `db_san_pham`
  (`products.approved_by/approved_at`), `de_xuat` (`purchase_proposals.resolver_name/resolved_at`) và `cong_tac`
  (`work_items.approved_by/approved_at`), cùng kết quả của sản phẩm, đề xuất, công tác. `goonly.Strip` bỏ khoá ở MỌI cấp lồng, nên
  KHÔNG gọi nó với các khoá này trên dữ liệu chứa sản phẩm / đề xuất / công tác: chỉ gọi trên đúng phần thuộc phạm vi
  (vd `purchasing/service_db_test.go`: chỉ `heads` của đơn mua hàng, không bỏ ở `proposals`), nếu không golden duyệt của các bảng đó
  bị che lỗi mà không ai thấy.

  Helper `internal/shared/goonly` (chỉ dùng trong test):
  - `Strip(v, keys...)`: bỏ khoá ở mọi cấp lồng, bất kể giá trị.
  - `StripNull(v, keys...)`: chỉ bỏ khoá khi giá trị là null (nil hoặc `omap.Undefined`); khoá có giá trị được giữ nên phép so golden báo
    khác (bắt bản Go ghi sai chỗ). ĐÃ CHỌN: `purchasing/service_db_test.go` (dòng `don_mua_hang`) và `projects/service_test.go` (kết quả)
    dùng `StripNull`, không dùng `Strip`. M15.1 (đợt 2) đã làm đúng cách này: `goCheck` khẳng định `resolver_name` / `resolved_at` ở bước
    duyệt / từ chối (người thao tác + có thời điểm) rồi mới bỏ khoá; mọi bước khác vẫn `StripNull` - không che bằng `Strip`.
  - `StripWrites(log, keys...)`: bỏ khoá khỏi payload từng lệnh ghi. Cả lệnh bị bỏ CHỈ khi một PAYLOAD (object con trực tiếp của lệnh,
    hoặc object là phần tử trực tiếp của mảng con trực tiếp) chỉ còn khoá Go; object lồng sâu hơn (vd giá trị cột JSON) bị bỏ hết khoá
    thì chỉ thành `{}` và lệnh được giữ.
  - `StripFailingRow(s, map[bảng DB]số cột mới)`: bỏ tối đa n giá trị `null` ở cuối "Failing row contains (...)" của bảng đó (cột
    `ADD COLUMN` đứng cuối dòng); giá trị khác null được giữ.
- Khác Node do D-13 (transaction, mục 3.5): chỉ khi lỗi giữa chừng, bản Go rollback còn Node để lại dữ liệu dở. Golden đóng băng không sửa;
  ngoại lệ khai trong mã test, kiểm đúng bước và đúng phần khác:
  - `materials/diff_test.go` `d13KhacNode`: bước 86 (dòng `sp_combo`) sau bước 80 `setCombo(p1, [id không tồn tại])` - Node mất liên kết
    ngược p3->p1, Go còn. Test kiểm đúng bước + bỏ đúng 1 dòng; thiếu dòng thì báo lỗi.
  - Hành vi khi lỗi (không có trong golden): `createCongTy` lỗi tạo tài khoản chủ -> công ty KHÔNG còn (Node để lại công ty mồ côi);
    `deleteCongTy` lỗi -> dữ liệu các bảng không bị xoá (Node xoá dở); `saveCover` lỗi -> không còn tờ bìa nhân đôi bản cũ + bản mới;
    bước lưu của `sendPurchaseRequest` / `sendDeXuat` lỗi -> không còn phiếu thiếu dòng; `duplicateProject` lỗi -> không còn bản nhân dở.
    Chi tiết ở `API.md` mục 1 "Lỗi giữa chừng (D-13)".
- Tham số / ghi mới trên hàm rpc cũ của đợt 2 (chỉ bản Go; chi tiết ở `API.md` mục 2.1):
  - `requestDeleteProducts` tham số cuối `lyDo` (rpc args[1]) -> `delete_requests.note` trong cùng lệnh chèn khi khác rỗng;
    `resolveDeleteRequest` tham số cuối `lyDo` (rpc args[2], chỉ khi từ chối) -> `resolution_note` bằng lệnh RIÊNG sau lệnh giành quyền
    (lỗi chỉ ghi log). Trim; > 500 ký tự Unicode -> `Lý do tối đa 500 ký tự`; lý do nối ": <lyDo>" vào thông báo.
  - `resolvePurchaseRequest`: sau khi đổi trạng thái, lệnh RIÊNG ghi `nguoi_duyet` (ho_ten || username) + `ngay_duyet` (ISO); lỗi chỉ ghi log.
  - `sendPurchaseRequest`: sau khi gửi thẻ Lark, lệnh RIÊNG ghi `ket_qua_gui` = `ok` (lark = true) / `loi` cho mọi mã vừa lưu; lỗi chỉ ghi log.
    GIẢ ĐỊNH M9.1: dòng `ok` có sẵn trước bản này là giá trị mặc định lúc lưu (`strOr(ketQua,'ok')` cũ), không phải xác nhận đã tới Lark.
  - `exportBaoGia` tham số thứ 9 `opts` (REST: khoá thân `opts`) - M8.1 / M8.2 / M8.3; không có `opts` -> file giống từng byte như trước
    (`TestExportKhongOptsGiuNguyenByte`). Mã: `quotations/service_export_opts.go`.
  - `updateProject` ghi `hien_trang` chỉ khi client gửi khoá `hienTrang` (kể cả rỗng); `createProject` ghi khi khác rỗng. Database chưa chạy
    0011 -> lỗi 42703 báo đích danh cột (`apperr.ColErr`).
- Tham số / kiểm tra mới trên hàm rpc cũ (chỉ bản Go, M14.1 / M17.2):
  - `adminUpdateUser` / `PATCH /api/v1/users/:id` nhận khoá `email` (Node bỏ qua email khi sửa). Email gửi lên trùng email đang lưu
    (so sau trim + chữ thường ở cả hai phía) = không đổi: không kiểm dạng, không ghi (giữ nguyên văn bản cũ, kể cả email sai dạng do
    đường tạo lưu nguyên văn); nếu super đồng thời chuyển công ty thì chỉ kiểm trùng ở công ty mới. Email đổi: trim + chữ thường; rỗng /
    null = xoá (ghi ""); không khớp `/^[^\s@]+@[^\s@]+$/` -> `Email không hợp lệ`; trùng tài khoản KHÁC trong cùng công ty (công ty sau
    khi sửa, không phân biệt hoa thường) -> `Email đã dùng cho tài khoản khác trong công ty`. Trùng giữa hai công ty được phép (đăng nhập
    chọn theo `loginScore`). Repo `users.Repository.UserByEmailInCompanyExcept` (ilike đã thoát `\ % _`, `*` -> `_`, so lại đúng chữ ở Go;
    test `users/postgres_email_db_test.go`). `adminCreateUser` KHÔNG đổi (lưu email nguyên văn như Node; React tự kiểm dạng, gửi trim +
    chữ thường).
  - Email chứa `*`, `%` hoặc `\` lưu được (khớp dạng) nhưng không dùng để đăng nhập được: đăng nhập bằng email chặn các ký tự này
    (`reWildcard` của auth, như Node). React `UserModal` cảnh báo; đăng nhập bằng tên đăng nhập.
  - `createCongTy` / `updateCongTy`: `mauChinh` (khác null / undefined) phải là `""`, `#RGB` hoặc `#RRGGBB` (giữ nguyên chữ), khác ->
    `Màu chính phải dạng #RRGGBB` (Node nhận mọi chuỗi). Kiểm `String(v)` với MỌI kiểu (số, boolean, mảng...). Lỗi quyền vẫn báo TRƯỚC lỗi
    màu. `createCongTy` vẫn KHÔNG lưu `mau_chinh` (như Node, golden s04 trả `""`): React `CongTyForm` lưu màu bằng `updateCongTy` ngay sau
    khi tạo.
  - Khác biệt đã biết với kịch bản so vi sai (bộ so đã gỡ): `tests/e2e/diff/scenarios/area1/04-companies.js:89` gửi `updateCongTy
    {mauChinh: 0}` bằng admin A; Node lưu `"0"` (200), Go trả 500 `Màu chính phải dạng #RRGGBB`. Hai bước #1655 [rpc] và #1656 [rest]
    của `.out/report.txt` sẽ khác Node: khác biệt có chủ ý của M17.2.
  - `PUT /api/v1/projects/:id/cover` (REST, KHÔNG phải rpc `saveCover`): dòng có `chiPhi` < 0 -> 400
    `Chi phí dự kiến không được âm (mục <stt>).` (`(dòng <n>)` khi thiếu stt), không ghi gì. Lỗi được đổi SAU `SaveCover` (lỗi ràng buộc
    `ck_cost_estimate_lines_cost` -> 400) nên thứ tự kiểm giống rpc (dự án mất / khác công ty báo trước). Mã: `quotations/dto.go`
    `doiLoiChiPhiAm`, gọi ở route PUT cover của `handler.go`. rpc `saveCover` giữ lỗi ràng buộc DB (500) như Node vì golden `save-neg` đóng
    băng. Ngoại lệ REST khác kết quả rpc, ghi cả ở `API.md` (luật chung + mục 2.1).
- Đợt 3 của backlog (M10.1, M17.3; chi tiết route ở `API.md` mục 2.1). Không có cột mới, không có khoá kết quả mới trên hàm rpc cũ, không
  đổi fixture / golden (`TestRestRoutes` chỉ thêm đường dẫn mới vào danh sách route chỉ bản Go):
  - Route `POST /api/v1/products/:key/private-copy` (`copySharedProduct`, materials, `service_private_copy.go`): bản sao riêng Chưa duyệt
    của SP kho chung Dezon. Quyền làm lại `canTab('sanpham')` của giao diện ở máy chủ (GIẢ ĐỊNH M10.1: `SpPerms` cho mọi nhân viên quyền sửa,
    nên route xét thêm tính năng công ty + tab `sanpham`; các hàm `...Gated` cũ không xét). Lỗi unique (23505) khi chèn -> cùng câu trùng mã.
    Test: `TestCopySharedProduct`, `TestCopySharedProductNhanh`, `TestCopySharedProductRoute`, `TestCopySharedProductDB` (có database).
  - KHÁC NODE - danh mục: `getProducts` của Node ẩn dòng kho chung khi công ty có SP riêng trùng `ma|congSuat|nhietDo|gocChieu|mauSac`,
    nên một SP riêng che MỌI biến thể kích thước cùng mã (chép sơn 2IN1 15L làm mất 1L / 5L). Bản Go (`ghepKhoChung`, `biDe`,
    `coTrucKichThuoc` trong `service_catalog.go`) so thêm `kich_thuoc` khi dòng kho chung có trục này (ngành vs / son, hoặc có `kich_thuoc`;
    ngành trống suy từ hạng mục như `SaveDbProduct`) - đúng khoá kiểm trùng của bản sao riêng. Test `TestGhepKhoChungKichThuoc`.
    Golden `getProducts` không đổi (dữ liệu golden không có SP riêng trùng mã kho chung khác kích thước).
  - Route `POST /api/v1/companies/expiry-reminders` (`nhacGiaHan`, companies, `expiry.go`, chỉ super): nhắc gia hạn trong ứng dụng (M17.3,
    tính năng chỉ bản Go; bản Node gửi Lark ở 7e0804d đã gỡ ở 42af44d; bản này không Lark, không email). Chỉ gửi thật khi `dryRun === false`.
  - Job nền thứ 2 trong `internal/jobs` (`worker.go` `runNhac`): gọi `NhacGiaHan` lúc 8h05 giờ VN MỖI NGÀY; 70 giây sau khởi động gửi bù nếu
    hôm nay đã qua 8h05. Chung công tắc `REPORT_JOB` (=0 tắt CẢ HAI job). `jobs.Deps.Expiry contracts.ExpiryReminder`, `cmd/api/main.go`
    truyền `srv.Expiry()`.
  - Chống gửi trùng bằng cột `companies.reminder_milestone` (`nhac_moc`, mỗi mốc 30/14/7/3/1/0 một lần; giá trị ngoài tập coi như null),
    không dùng audit: GIÀNH mốc trước bằng một UPDATE có điều kiện
    (`id=eq.X&or=(nhac_moc.is.null,nhac_moc.not.in.(0,1,3,7,14,30),nhac_moc.gt.<mốc>)`), chỉ gửi khi UPDATE trả về dòng. Hai tiến trình trên
    cùng database chỉ một bên gửi (Postgres khoá dòng và xét lại điều kiện); mutex trong tiến trình vẫn giữ. Không chèn được thông báo nào ->
    trả lại `nhac_moc` / `nhac_lan_cuoi` cũ (chỉ khi dòng vẫn đúng mốc + ngày vừa giành).
  - companies chèn thẳng bảng `notifications` (`repo.ChenThongBao`, cùng dạng dòng với `notifications.Notify`, trong phạm vi công ty của ctx)
    để biết lỗi chèn (`contracts.Notifier.Notify` nuốt lỗi). `companies.Deps` chỉ thêm `Admins contracts.AdminLister` (notifications cài),
    không có `Notifier`.
  - `updateCongTy`: patch có `han_dung` thì đọc `cong_ty` trước update (lỗi đọc bỏ qua); super đổi sang ngày khác -> lệnh RIÊNG đặt
    `nhac_moc` = `nhac_lan_cuoi` = NULL (chỉ khi đang khác null; lỗi chỉ ghi log). Kết quả / nhật ký không đổi, golden companies qua nguyên vẹn.
  - Test: `companies/expiry_test.go` (`TestNhacGiaHanLoiChen`, `TestNhacGiaHanHaiTienTrinh`; `TestNhacGiaHanDB` nối `AdminLister` THẬT của
    notifications - import chỉ trong test - và chạy 2 Service song song trên `qspro_gotest`), `jobs/worker_test.go`. Khoá golden mới: không có.
  - Migration 0012 (chú thích 2 cột nhắc gia hạn, bỏ `DEPRECATED`) và 0013 (chú thích `product_combos.note` - M10.2, `purchase_orders.send_result`
    - M9.1) chỉ đổi COMMENT; code không phụ thuộc hai migration này.
- Biến `REPORT_JOB` (tắt job báo cáo và job nhắc gia hạn), `STATIC_DIR`, `VENDOR_DIR`, `CORS_ORIGINS`, `RATE_LIMIT_RPS`, `TRUSTED_PROXIES`, `REDIS_URL`, `DEBUG`,
  `DB_POOL_MAX`, `DB_SORT_COLLATION`, `DOTENV`, `UPLOAD_DIR` (kho file trên đĩa, mục 3.6). CORS, giới hạn tần suất, Redis mặc định tắt.
- `TRUSTED_PROXIES` mặc định không tin proxy nào: đứng sau reverse proxy mà không đặt thì mọi client chung một giới hạn tần suất.
  Ảnh hưởng: không có khi `RATE_LIMIT_RPS` tắt (mặc định).
- Đọc `backend/.env` trước rồi mới tới `../.env` của bản Node; `DOTENV=0` trong môi trường thì không đọc file nào (mặc định: đọc cả hai).
- Tắt êm: chờ request đang chạy tối đa 15 giây, dừng job nền, đóng pool database.
- File nhúng (go:embed) thay cho `public/`: `/vs-spec.js`, `/son-spec.js`, `/ct-spec.js` (module categories phục vụ, nguồn
  `internal/shared/specs/js/`), `/mau-nhap-hang-loat.xlsx` (categories, `assets/`), `/mau-nhap-cong-tac.xlsx` (estimates, `assets/`),
  `/logo.svg` (server, `internal/server/assets/`).
  Module khai file nhúng qua interface tuỳ chọn `AssetModule { Assets() map[string][]byte }` (như `RootModule`); server phục vụ
  bằng middleware đứng TRƯỚC `STATIC_DIR`, cùng Content-Type / Cache-Control như `express.static` cũ; ETag theo nội dung, không có
  `Last-Modified`. Không thuộc `RootRoutes` (đây là file tĩnh, không phải route của `server/index.js`).
  Đường dẫn thô có `.` / `..` / `//` được chuẩn hoá như `send` (`/x/../vs-spec.js` -> 200); leo khỏi gốc (`/../vs-spec.js`) Node trả 403,
  Go rơi xuống 404. Git không được đổi xuống dòng của file nhúng: `backend/.gitattributes` đặt `-text` (giữ đúng mã blob khi `core.autocrlf=true`).
- `STATIC_DIR` mặc định TRỐNG (Node: luôn `public/`): không đặt thì không phục vụ giao diện cũ và `/vendor`, không log gì.
  Đặt rồi mà thiếu `STATIC_DIR/index.html` hoặc thư mục dist của thư viện giao diện thì lúc khởi động ghi log `thiếu <đường dẫn> ...`.
- Thời hạn HTTP: `ReadTimeout` 300 giây đóng kết nối (Node `requestTimeout` trả 408); kết nối keep-alive rỗi sống 120 giây (Node 5 giây),
  không gửi header `Keep-Alive`. Ảnh hưởng: chỉ request gửi lâu hơn 300 giây và thời gian sống của kết nối rỗi.
- Swagger UI: trang nhúng của `swaggo/files` nên thân và ETag của `/api-docs/` khác Node; `/api-docs/swagger-ui-init.js`, `/index.html`,
  `/swagger-initializer.js` trả trang của Go. Mã HTTP, `Content-Type`, `Location` giống Node với mọi phương thức và đường dẫn con.
- `response.OK` dùng lại bộ đệm mã hoá (pool; không giữ bộ đệm trên 64 MB) và `omap.Map` dùng chung tập khoá giữa các dòng của một kết quả:
  không đổi byte nào của thân trả về. Không được xoá khoá của map ngay trong hàm gọi lại của `Each` của chính nó.
- `cmd/migrate` có thêm cờ `--dir`.

### 10.5 Chưa kiểm chứng bằng chạy thật, hoặc không tới được

Không tới được từ client hiện tại (ghi lại để người sửa sau biết):

- `contracts.MediaDownloader.MediaDownload` nhận token dạng chuỗi; Express có thể đưa `req.query.token` dạng mảng / object, handler `files` tự đổi.
- `NotifyDeXuatAdmins` nhận `dx *omap.Map`: không truyền được chuỗi / số, nil không phân biệt null với undefined. Nơi gọi luôn truyền object.
- `actor.u || actor.username` (Node `auth.js:63`, `store_supa.js:590, 1412`): Go `Actor` không có `username`. Mọi actor của Node đến từ payload
  token hoặc literal có `u`, nên nhánh dự phòng không tới được.
- materials: TypeError của V8 khi `_raw` là chuỗi / mảng, ba chỗ đổi vị trí tham số tương thích ngược
  (S:506, S:563, S:1033) không đi qua được cổng rpc.
- Các nhánh chỉ chạy khi database thiếu cột / bảng (chưa chạy migration): đã chuyển theo mã Node và có test thuần, không có bước so vi sai
  vì cả hai database thử đều đủ cột.

Chưa chạy đối chiếu với Node:

- companies: sigma cuối từ đứng cạnh một trong 27 chữ Unicode 16.
- purchasing: `PURCHASE_WEBHOOK` không phân tích được ghi `Failed to parse URL from <url>` (câu của Node chưa được chạy lại; tập URL bị từ chối
  của Go và WHATWG không trùng nhau); câu log của Node khi quá hạn chờ header; byte không phải UTF-8 trong thân webhook trả về.
- quotations: thân gzip có rác sau phần nén (Go bỏ ảnh); line có khoá riêng tên `__proto__`; header `accept-encoding` của Node với https.
- Đồng thời: 10 lệnh `saveDbProduct` cùng mã chạy song song cho 1 lệnh 200 và 9 lệnh 500 (`23505`), database còn đúng 1 dòng. Cùng kiểu
  kiểm-rồi-chèn như Node `store_supa.js:535-551`; chưa đo Node dưới cùng tải.
- Bộ nhớ khi đọc danh mục đồng thời (seed: 949 sản phẩm, thân `getProducts` 4,38 MB), đo trên server thật sau khi sửa bộ đệm mã hoá
  (`response.OK`, `omap`) ngày 2026-10-14: 50 `getProducts` + 50 `bootstrap` song song: Go 0,93 GB (VmHWM), Node 0,99 GB (peak working set);
  100 + 100: Go 1,67 GB, Node 1,73 GB. Trước khi sửa: Go 2,48 GB / 5,26 GB. Mỗi request vẫn cấp phát khoảng 6 lần cỡ thân (bộ đệm pgx, chuỗi
  JSON, bản sao `[]byte` trong `platform/database`). `GetProductsCached` không gộp các lượt nạp cache nguội, giống Node.

### 10.6 Kết quả không xác định ở CẢ HAI bản (không phải khác biệt Node - Go)

Cùng một câu truy vấn, database được quyền trả kết quả khác nhau giữa hai lần chạy; hai database thử vì thế có thể lệch nhau dù mã giống nhau:

- `getProjData` đọc không có ORDER BY: thứ tự khoá của object trả về theo thứ tự dòng database đưa ra (tập khoá giống nhau).
- Sắp theo cột thời gian khi nhiều dòng trùng thời điểm: thứ tự các dòng trùng không cố định (tập dòng giống nhau).
- `limit 1` không có ORDER BY khi nhiều dòng cùng khớp: `saveDbProduct` của super chưa chọn công ty với mã có ở nhiều công ty
  (`store_supa.js:535`, Go `materials/service_write.go`) và `findSpAny_` theo mã dùng chung (`store_supa.js:757`, Go `materials/service_approve.go`).
  Dòng được chọn tuỳ vị trí vật lý của dòng trong bảng; đã thấy hai bản chọn hai id khác nhau rồi đổi chỗ cho nhau ở lượt chạy sau.
  Ảnh hưởng: super không chọn công ty sửa một mã có ở nhiều dòng thì dòng nào được sửa là ngẫu nhiên, ở cả hai bản. Kịch bản so vi sai
  (`area3/01`, `area3/02`, `area3/04`) chỉ gửi đầu vào khớp đúng 1 dòng (`area3/01` có bước kiểm khẳng định điều đó); hai lượt chạy từ seed
  cho cùng kết quả.
- Thông báo cho admin (`getAdmins_`, `server/auth.js:450`; Go `notifications` cùng câu truy vấn) đọc admin không ORDER BY: trong một sự kiện,
  admin nào nhận id thông báo nào tuỳ thứ tự dòng của bảng `users`. Tập người nhận và nội dung giống nhau. Ảnh hưởng: không có với client.

Luật của bộ so vi sai cho các điểm trên (đều ghi "khác có chủ ý" trong báo cáo, không làm lượt chạy đỏ):

- `orderOnly` (`lib/harness.js`): 15 hàm trả danh sách xếp theo cột thời gian; chấp nhận thứ tự khác khi cùng tập phần tử và mỗi bên đúng thứ tự
  theo database của nó.
- `unorderedKeys`: `getProjData` cùng tập khoá, cùng giá trị.
- `lib/dbdiff.js`, bảng `notifications`: trong nhóm dòng liền nhau giống hệt nhau trừ id / user_id / created_at, xếp lại user_id rồi mới so.
- Môi trường: job báo cáo tự động của Node không tắt được bằng biến môi trường (Go chạy `REPORT_JOB=0`), nên `run.ps1` chèn vào CẢ HAI database
  một dòng `audit_logs` hành động `bao_cao_nhap_sp` của hôm nay; Node thấy "hôm nay đã gửi" (`server/index.js:554`) và không gửi.
  Hệ quả: job báo cáo chưa được so đầu-cuối (xem "Việc còn mở").

Phạm vi so: mã HTTP của bước REST phải bằng mã của rpc (không nới); thời điểm created / modified của file xlsx không so (giờ xuất), `wb.creator` có so;
ảnh trong xlsx so theo vị trí neo + sha1 nội dung.

## 11. Contracts - interface gọi chéo dùng chung

Gói `qspro-backend/internal/shared/contracts` (file `contracts.go`) khai báo MỌI interface gọi chéo giữa các module.
Module dùng import `contracts` và đặt kiểu trường
`Deps` bằng interface ở đó; module chủ cài bằng phương thức của `*Service` với chữ ký đúng từng chữ. Gói chỉ import
`omap`, `actor` và thư viện chuẩn; giá trị trao đổi theo JS value model (object `*omap.Map`, mảng `[]any`).
Ngữ nghĩa chi tiết (nuốt lỗi, null, thứ tự khoá) nằm trong chú thích của từng interface.

| Interface | Phương thức | Chủ | Hàm Node | Module dùng |
|---|---|---|---|---|
| `Auditor` | `Audit(ctx, a, action, detail string, congTyID any)` | users | audit A:59-69, logAudit_ S:587-594 | auth, companies, notifications, materials, estimates, purchasing |
| `UserReader` | `GetByID(ctx, id any) (*omap.Map, error)` | users | getUserById A:212-215 | auth, materials, notifications, purchasing |
| `UserFormatter` | `UserOut(row *omap.Map) *omap.Map`, `PermsArr(v any) []any` | users | userOut A:73-77, permsArr_ A:72 | auth, companies, materials (PermsArr) |
| `UserCreator` | `AdminCreateUser(ctx, a, data *omap.Map) (*omap.Map, error)` | users | adminCreateUser A:319-362 | companies |
| `SessionInvalidator` | `ForgetSession(uid any)`, `RevokeUserSessions(ctx, uid any, keep string) error` (M1.2) | auth | forgetSession_ A:39 + thu hồi phiên | users |
| `middleware.SessionResolver` | `SessionActor(ctx, token string) (*actor.Actor, error)` | auth | sessionActor A:43-56 | middleware, server (đã có ở mục 3.9, không nằm trong `contracts`) |
| `CompanyReader` | `GetCongTy(ctx, id any) (*omap.Map, error)`, `HetHan(ct *omap.Map) bool` | companies | getCongTy A:107-111, hetHan_ A:42 | auth, users |
| `Notifier` | `Notify(ctx, userID any, kind, title, body string, refID any)` | notifications | notify_ A:451-454 | materials, purchasing |
| `AdminLister` | `ActiveAdmins(ctx) ([]any, error)` | notifications | getAdmins_ A:450 | materials, companies (nhắc gia hạn) |
| `PurchaseNotifier` | `NotifyPurchaseAdmins(ctx, a, orders []any) error`, `NotifyDeXuatAdmins(ctx, a, dx *omap.Map) error`, `DeXuatTen(loai string) string` | notifications | A:605-616, A:670-680, DX_TEN A:669 | purchasing |
| `ProductPerms` | `SpPerms(ctx, a) (edit, duyet, admin bool, err error)` | materials | spPerms_ A:517-526 | takeoff, estimates |
| `ProductSaver` | `SaveDbProduct(ctx, a, data, opts *omap.Map) (*omap.Map, error)` | materials | saveDbProduct S:503-560 | takeoff |
| `CatalogReader` | `GetProductsCached(ctx) ([]any, error)` | materials | getProductsCached S:209-213 | projects (bootstrap) |
| `ProductLister` | `GetProducts(ctx) ([]any, error)` | materials | getProducts S:177-200 | xuất Excel sản phẩm (I:654; hiện nằm trong chính materials - chỉ cần nối nếu phần xuất tách sang module khác) |
| `LineReader` | `GetLines(ctx, maDA any) ([]any, error)` | takeoff | getLines S:331-334 | projects (bootstrap), quotations |
| `ProjectReader` | `GetProject(ctx, maDA any) (*omap.Map, error)` | projects | getProject S:236-239 | quotations |
| `MediaDownloader` | `MediaDownload(ctx, fileToken string) (buf []byte, contentType string, err error)` | files | lark.mediaDownload lark.js:25-32 | quotations (fetchImage X:333) |
| `Uploader` | `Upload(ctx, buf []byte, path, contentType string) (url string, err error)` | platform/storage (`*storage.Client`, ghi vào `UPLOAD_DIR`, trả `/files/<path>`) | uploadToStorage supa.js:461-469 | materials |
| `FileReader` | `ReadURL(url string, max int64) ([]byte, error)` | platform/storage (`*storage.Client`) | không có (chỉ bản Go: đọc file `/files/...` từ đĩa) | quotations (fetchImage) |
| `ReportRunner` | `BaoCaoNhapSP(ctx, a, opts *omap.Map) (*omap.Map, error)`, `DaGuiHomNay(ctx) bool` | reports | I:451-552, I:554-564 | jobs |
| `ExpiryReminder` (file `expiry.go`) | `NhacGiaHan(ctx, dryRun bool) (*omap.Map, error)` | companies | không có (chỉ bản Go, M17.3) | jobs |

`a` là `*actor.Actor`, `ctx` là `context.Context`. `categories` là gói dữ liệu thuần, được `materials` và `reports` import trực tiếp
(không qua interface) - ngoại lệ duy nhất của luật 2.7.

Khác với PORTING_MAP mục C (để mọi chữ ký chỉ dùng kiểu của JS value model): `PermsArr` trả `[]any` (không phải `[]string`),
`ActiveAdmins` trả `[]any` gồm `*omap.Map` (không phải `[]*omap.Map`); `DeXuatTen` đã gồm giá trị mặc định `"đề xuất"`.

### 11.1 Thêm vào gói dùng chung

```go
// internal/shared/errors
const HDMig = `Hãy chạy "npm run migrate" rồi khởi động lại server.`   // HD_MIG  S:474
const DAMat = "Bản nháp không còn tồn tại ..."                          // DA_MAT  S:1105
func ColErr(err error) error      // colErr_ S:479-486: lỗi thiếu cột -> lỗi hướng dẫn; lỗi khác trả NGUYÊN err; nil -> nil
func ColSQL() []string            // Object.keys(COL_SQL) S:475-478 (19 cột cố định + cột METRIC của VS, SON, CT)
func KhongCoCha(err error) bool   // khongCoCha_ S:1104: /\b23503\b/ trên err.Error()

// internal/shared/jsval
func S(v any) string              // s() S:28 = Str
func NowISO() string              // nowIso() S:29
```

`throw colErr_(e)` -> `return nil, apperr.ColErr(err)`;
`if (khongCoCha_(e)) throw new Error(DA_MAT)` -> `if apperr.KhongCoCha(err) { return nil, apperr.New(apperr.DAMat) }`.
Giá trị mong đợi của test lấy từ mã Node thật: `node internal/shared/errors/testdata/gen.js > internal/shared/errors/testdata/colerr.json`.

### 11.2 Thứ tự nối trong `internal/server/routes.go`

Đồ thị Node có vòng `auth <-> users <-> companies`. Cắt vòng bằng ĐÚNG HAI setter trên `*users.Service`; mọi phụ thuộc
khác đi qua `Deps` lúc `New` (không có `SetDeps(d Deps)` gộp, không có setter nào khác):

```go
func (s *Service) SetCompanyReader(c contracts.CompanyReader)            // users <- companies  (A:340)
func (s *Service) SetSessionInvalidator(si contracts.SessionInvalidator)  // users <- auth       (A:407, 422, 431)
```

Hai trường tương ứng KHÔNG nằm trong `users.Deps`. Gọi cả hai trong khối MODULE WIRING, trước khi server nhận request
(không cần khoá). Thứ tự dựng:

| # | Module | Nhận qua `Deps` (ngoài `DB`, `Cfg`) |
|---|---|---|
| 1 | users | không có; sau đó `SetCompanyReader(companies)`, `SetSessionInvalidator(auth)` |
| 2 | notifications | users: `UserReader`, `Auditor` (dựng trước companies từ M17.3) |
| 3 | companies | users: `UserCreator`, `UserFormatter`, `Auditor`; notifications: `AdminLister` (`Admins`, M17.3) |
| 4 | auth | users: `UserReader`, `UserFormatter`, `Auditor`; companies: `CompanyReader`. Rồi `d.Sessions.Set(authSvc)` |
| 5 | categories | `Deps` rỗng (`categories.New(categories.Deps{})`); được dựng vì có 3 route lẻ file mẫu; `materials` / `reports` import trực tiếp |
| 6 | files | không có (chỉ `Cfg`) |
| 7 | materials | users: `Auditor`, `UserReader`, `UserFormatter`; notifications: `Notifier`, `AdminLister`; `Uploader` = `d.Storage` |
| 8 | takeoff | materials: `ProductPerms`, `ProductSaver` |
| 9 | projects | materials: `CatalogReader`; takeoff: `LineReader` |
| 10 | quotations | takeoff: `LineReader`; projects: `ProjectReader`; files: `MediaDownloader`; `FileReader` = `d.Storage` |
| 11 | estimates | materials: `ProductPerms`; users: `Auditor` |
| 12 | purchasing | notifications: `PurchaseNotifier`, `Notifier`; users: `UserReader`, `Auditor` |
| 13 | reports | không có (đọc database trực tiếp, import `categories`) |
| 14 | jobs | reports: `ReportRunner`; companies: `ExpiryReminder` (qua `Server.Reports()` / `Server.Expiry()` trong `cmd/api/main.go`) |

Thứ tự dựng đổi ở M17.3 (notifications lên trước companies); thứ tự trả về của `modules()` không đổi.

```go
usersSvc := users.New(users.Deps{DB: d.DB, Cfg: d.Cfg})
notifSvc := notifications.New(notifications.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, Auditor: usersSvc})
compSvc := companies.New(companies.Deps{DB: d.DB, Cfg: d.Cfg, UserCreator: usersSvc, UserFormatter: usersSvc, Auditor: usersSvc,
    Admins: notifSvc})
authSvc := auth.New(auth.Deps{DB: d.DB, Cfg: d.Cfg, Users: usersSvc, UserFormatter: usersSvc, Auditor: usersSvc, Companies: compSvc})
usersSvc.SetCompanyReader(compSvc)
usersSvc.SetSessionInvalidator(authSvc)
d.Sessions.Set(authSvc)
```

Tên trường `Deps` do từng module tự đặt (ví dụ trên chỉ minh hoạ); KIỂU của trường phải là interface trong `contracts`.
Một `*Service` có thể cài nhiều interface (users cài `Auditor`, `UserReader`, `UserFormatter`, `UserCreator`).

## 12. Nối module, tài liệu API và kiểm tra tích hợp

- `internal/server/routes.go` (khối MODULE WIRING) dựng `system` rồi 15 module nghiệp vụ theo đúng thứ tự mục 11.2 (13 module chuyển từ Node + `delivery`, `sales` chỉ bản Go); `Server.Reports()` trả module reports,
  `Server.Expiry()` trả phần nhắc gia hạn của companies, cho `cmd/api/main.go` bật job nền (`jobs.Start`: báo cáo + nhắc gia hạn, tắt cả hai
  bằng `REPORT_JOB=0`, dừng qua `srv.OnShutdown`).
- `internal/server/rest.go`: bảng `RestRoutes` (80 hàm rpc -> route REST) và `RootRoutes` (9 route lẻ). Hai bảng này ĐÓNG BĂNG cùng 80 hàm
  của Node; route mới là route chỉ bản Go do module tự khai (dưới đây).
- `internal/server/swagger.go`: bản chuyển của `server/swagger.js`. `GET /api-docs.json` = spec của Node (80 path `/api/<fn>` + 9 route lẻ,
  giống từng byte) cộng 80 thao tác REST `/api/v1` (nhóm `REST - ...`), thao tác của route chỉ bản Go (`reg.GoRoutes()`, nhóm
  `REST - <Tag> (chỉ bản Go)`) và đoạn cuối `info.description`. `GET /api-docs/` là Swagger UI
  nhúng sẵn (`github.com/swaggo/files/v2`, không gọi CDN). Bật / tắt như Node: `SWAGGER_DOCS=0` tắt, `NODE_ENV=production` cần `SWAGGER_DOCS=1`.
  Image Docker đặt sẵn `NODE_ENV=production` nên trong image tài liệu API mặc định TẮT.
- Mô tả API nhúng trong `internal/server/apidocs/`, `tests/fixtures/registry.json` và `swagger-node.json` trước đây được sinh từ bản Node
  (`sync-api-docs.js`, `gen-registry.js`, `gen-swagger.js`, đã gỡ cùng app Node, tới commit `83d264e`). Nay các file này
  ĐÓNG BĂNG, không sinh lại, không sửa tay (mục 12.1); tài liệu route mới sinh từ `GoRoute`.
- Test trong `internal/server/wiring_test.go` (không cần database): `TestRegistryParity` (tên + quyền = REGISTRY / *_FNS của Node),
  `TestRootRoutes`, `TestRestRoutes` (đủ 80 route, route ngoài bảng phải là route chỉ bản Go đã khai, chặn quyền như cổng rpc / theo `Perm`;
  route chỉ bản Go: token đủ quyền không bị middleware chặn),
  `TestGoRoutes` (module giả chỉ có trong test: khai + gắn 3 route chỉ bản Go, có trong tài liệu, chặn quyền; module khai sai bị bắt),
  `TestSwaggerSpecNode` (phần Node giống từng byte; số thao tác REST = 80 + số route chỉ bản Go), `TestSwaggerEnabled`.
  `internal/server/rpc/rpc_test.go`: `TestRegisterGoRoute` (thứ tự, bản sao, panic khi trùng tên / route / tham số, field `path` không có trong `Path`, `Path` có `*`).
- Test có database dùng chung `qspro_gotest`: chạy `go test -race -count=1 -p 1 ./...` để các gói không chạy song song trên cùng database
  (chạy song song thỉnh thoảng lệch vì gói này thấy dòng tạm của gói kia).

### 12.1 Tính năng mới sau khi gỡ Node (luật ARCH, GOLDEN, migrate)

App Node đã gỡ khỏi repo (commit cuối còn Node: `83d264e`): mọi fixture / golden do Node sinh KHÔNG sinh lại được.

**ARCH - tính năng mới:**

- KHÔNG thêm hàm `/api/:fn` (registry giữ đúng 80 hàm, `TestRegistryParity`), KHÔNG thêm dòng vào `RestRoutes` / `RootRoutes`.
- Tính năng mới là route REST "chỉ bản Go": module khai `reg.RegisterGoRoute(rpc.GoRoute{...})` trong `RegisterRPC` và gắn route gin
  cùng method + đường dẫn trong `RegisterRoutes`, middleware khớp `Perm` (`RequireLogin` / `RequireAdmin` / `RequireSuper` /
  `RequireAdminSuper`; `Public` không gắn). Cách viết: `docs/API.md` mục 2.1. Tài liệu `/api-docs.json` tự sinh từ `GoRoute`.
- File tĩnh mới mà giao diện tải ở gốc: module cài `AssetModule` (`Assets() map[string][]byte`, nhúng bằng `go:embed`), như
  `categories` và `estimates`.
- Hàm rpc cũ chỉ được: thêm tham số TUỲ CHỌN ở CUỐI `args`; nối khoá MỚI vào CUỐI object kết quả. Không đổi tên, quyền, thứ tự tham số,
  kiểu kết quả, thông báo lỗi của nhánh cũ.
- KHÔNG sửa tay fixture của Node: `tests/fixtures/registry.json`, `swagger-node.json`, `internal/server/apidocs/*`, `tests/e2e/**`,
  mọi `testdata/*` do Node sinh. Chỉ sửa MÃ test.

**GOLDEN - giữ golden Node đúng khi bản Go có thêm cột / khoá:**

- Cột mới chỉ ghi khi có giá trị (client gửi khoá / có dữ liệu), và ghi bằng một lệnh RIÊNG sau lệnh chính - nhờ vậy log ghi của các ca
  golden (không gửi khoá mới) giữ nguyên.
- Dòng đọc database và kết quả trả về vẫn có thể có khoá mới: mỗi gói test khai `goOnlyKeys` (danh sách khoá chỉ bản Go của gói, lấy từ
  bảng ở mục 10.4) và gọi `goonly.StripNull(v, goOnlyKeys...)` (ưu tiên: chỉ bỏ khoá null, khoá có giá trị vẫn bị so) hoặc
  `goonly.Strip(v, goOnlyKeys...)` trên kết quả / dòng đọc, `goonly.StripWrites(log, goOnlyKeys...)` trên log ghi
  (payload - cấp 1, hoặc phần tử mảng cấp 1 - chỉ còn khoá Go thì bỏ cả lệnh) TRƯỚC khi so với golden. Chỉ gọi trên phần dữ liệu thuộc PHẠM VI của khoá (cột 2 bảng 10.4):
  `Strip` bỏ khoá ở mọi cấp lồng, nên gọi trên dữ liệu lẫn bảng khác (vd `nguoi_duyet` của sản phẩm / đề xuất / công tác) sẽ che ca vỡ thật.
  Không che ca vỡ vì lý do khác.
- Thêm khoá chỉ bản Go: ghi vào bảng mục 10.4 (qua steward) cùng lúc với migration / thay đổi kết quả.
- `tests/e2e/diff` (so Go với Node chạy thật) đã gỡ khỏi repo ngày 2026-10-15 vì không chạy được khi không có Node.

**Migrate trước khi chạy bản mới:**

- Server Go KHÔNG tự migrate. Thứ tự triển khai: `go run ./cmd/migrate --url=<database đích>` (từ `backend/`) -> khởi động bản server mới.
  Server đang chạy từ trước khi migrate phải khởi động lại để nạp lại danh mục cột.
- Lệnh ghi cột mới (lệnh riêng, ở trên) gặp `42703` (cột chưa có - database chưa migrate) thì ghi log và bỏ qua: thao tác chính
  (vd đổi trạng thái đơn, duyệt yêu cầu) vẫn thành công.

## Việc còn mở

Đã biết, chưa làm (khác biệt đã chấp nhận nằm ở mục 10, không lặp lại ở đây):

- Nguồn gốc file seed `/tmp/qspro_seed.sql` (trong container `qspro-postgres`) CHƯA RÕ; bản sao bền đã có ở `infra/export/qspro_seed.sql`
  (cùng md5), chưa có script sinh.
- Job báo cáo tự động (Node `server/index.js:554-594`, Go `internal/jobs`) chưa có bước so vi sai đầu-cuối: chỉ chạy thứ 4 / thứ 7 sau 8h00 và
  không có cách kích hoạt; cần đồng hồ tiêm vào được ở phía Node. Bộ so vi sai hiện chặn job của Node (mục 10.6).
- Nhánh chỉ chạy khi database THIẾU CỘT (`nguoi_tao`, `nguoi_sua`, `nhom_bt`, `da_duyet`, `dung_sp_dezon`, `ui_prefs`, `phong_ban`, `perms`,
  `colErr_` của projects) chưa có bước so vi sai: cần một database dựng không có các migration đó. Nhánh thiếu BẢNG đã có (`area3/08`).
- Giới hạn chưa chạm tới trong bộ so vi sai: `getProjects` 2000 dòng, `getProjData` 50 khoá mỗi nguồn, đếm user quá 1000 của `adminCreateUser`,
  cảnh báo danh mục 20000 dòng (`store_supa.js:161`). Không tìm được đầu vào tới được: rollback giữa chừng của `duplicateProject`
  (`store_supa.js:307, 310`), nuốt lỗi tra email khi đăng nhập (`auth.js:88`).
- Đồng thời: 10 `saveDbProduct` cùng mã chưa đo phía Node; không có bước so vi sai vì sequence bị tiêu khác nhau ở hai bên.
- Bộ so vi sai: mốc thời gian dạng tiếng Việt (`RE_TSVN`) chỉ được che, không so giá trị; so tập (`orderOnly`, `unorderedKeys`) không so giá trị
  mốc thời gian; số chữ số phần lẻ của mốc dạng Postgres không so; bước bị gửi lại phía Node (lỗi socket) được ghi trong `report.json` nhưng không
  đổi mã thoát. REST với thân không dùng được (mảng, thiếu Content-Type, không có thân) chỉ được kiểm "trả JSON, không panic" vì `API.md`
  chưa định nghĩa kết quả từng route.
- Mã lặp: `files/express.go` và `categories/express.go` là hai bản giống nhau; `etagOf` còn chép ở materials / estimates / quotations handler.
- Bảng chữ hoa / thường của `categories/template.go`, `materials/service_upload.go`, `reports` (`jsLower`) chưa đối chiếu 27 cặp Unicode 16.
- Bộ nhớ khi đọc danh mục: mỗi request vẫn cấp phát khoảng 6 lần cỡ thân (mục 10.5); chưa có cache byte đã mã hoá.
- Truy vấn database và lúc nạp danh mục cột không có hạn thời gian (giống Node); thêm hạn sẽ sinh lỗi mà Node không có.
- Các mục "so vi sai" ở trên ghi lại giới hạn của bộ so vi sai Node <-> Go đã gỡ; không còn công cụ trong repo để làm tiếp.
- Đã gỡ khỏi repo ngày 2026-10-15 (chỉ chạy được cùng app Node): `scripts/{check-node-sync.sh,sync-api-docs.js,http-diff.sh,sync-test-sequences.sh}`,
  `tests/integration/smoke.js`, `tests/e2e/{diff/,diff-db.js,diff-dump.js}`, `tests/fixtures/{gen-registry,gen-swagger,db-diff-node,db-diff-compare}.js`,
  các `gen*.js` / `noderef.js` / `compare.js` / `xlsx-*.js` trong `internal/**/testdata/` và `users/userstest/diff-node.js`, cùng bản sao
  `backend/migrations/`. Bản sao để khôi phục: `C:/demo/qs-unused-backup-2026-10-15/` (`MANIFEST.txt`). Dữ liệu mong đợi đã sinh vẫn trong
  repo nên `go test` không bị ảnh hưởng. Còn giữ: `scripts/gen-specs.js`, `tests/e2e/test-api-go.js` (cần gói `pg`, `bcryptjs` cài riêng,
  xem `backend/README.md`), `tests/fixtures/jsref.js`, `quotations/testdata/gen-case.js`.
- `docs/README.md` ở gốc repo chưa nhắc tới `backend/` (`README.md` gốc đã có bảng thư mục trỏ tới `backend/README.md`; `render.yaml` đã gỡ
  cùng app Node; ngoài phạm vi sửa của `backend/`; đề xuất 1 dòng mục lục trong `docs/README.md` trỏ tới `backend/README.md`).
- `docs/PORTING_MAP.md` vẫn là bảng làm việc tiếng Anh (đã ghi rõ ở đầu file).
