# QS Pro backend (Go + Gin) - Kiến trúc và HỢP ĐỒNG VIẾT MODULE

Hợp đồng API của 80 hàm gốc ĐÓNG BĂNG: cùng đầu vào thì cùng JSON trả về (kể cả thứ tự khoá), cùng thông báo lỗi tiếng Việt,
cùng tác động lên database. Golden đóng băng trong repo kiểm hợp đồng này (mục 12.1).
Cổng `POST /api/<tênHàm>` (thân `{"args":[...]}`) giữ cho client cũ. REST `/api/v1` dùng chung service với cổng đó.
Giao diện React (`frontend/src/pages/QS`) dùng REST `/api/v1` và tải file nhúng trong binary (mục 10.4): 4 file
`*-spec.js`, `/logo.svg`, `/mau-nhap-hang-loat.xlsx` và `/mau-nhap-cong-tac.xlsx` (nút "Tải file mẫu" ở Nhập dữ liệu > Phần thô, M5.1).

Module Go: `qspro-backend` - Go 1.25. Thư viện đã có sẵn trong `go.mod` (không cần sửa): gin, pgx/v5,
excelize/v2, golang.org/x/crypto (bcrypt, scrypt), golang.org/x/text (norm, collate, language, cases), golang.org/x/net,
go-redis/v9, swaggo/files/v2 (Swagger UI nhúng), github.com/coder/websocket v1.8 (WebSocket của chat, thêm cùng Chat MVP),
github.com/minio/minio-go/v7 v7.3.0 (kho tệp chat, `platform/objstore`; v7.4 trở lên cần Go 1.26), golang.org/x/image (WebP + co ảnh nhỏ của tệp chat).
File `.env` đọc bằng `config.LoadDotenv`, theo cú pháp của gói dotenv 16 (npm); không dùng godotenv vì nó đọc `#`, `$`, `\` khác.

## 1. Sơ đồ thư mục

```
cmd/api/main.go                  điểm khởi chạy server
cmd/migrate/main.go              chạy migration - lệnh migrate duy nhất
cmd/vapid/main.go                in cặp khoá VAPID (CHAT_VAPID_PUBLIC_KEY / CHAT_VAPID_PRIVATE_KEY) cho Web Push của chat
internal/config/                 biến môi trường, đọc file .env
internal/server/server.go        gin engine, khớp route (mục 3.10), tắt êm
internal/server/static.go        phục vụ file tĩnh TUỲ CHỌN (STATIC_DIR, /vendor)
internal/server/uploads.go       phục vụ kho file tải lên: GET / HEAD /files/<path>, công khai
internal/server/assets.go        file nhúng go:embed ở gốc (AssetModule; logo.svg trong internal/server/assets/)
internal/server/routes.go        NƠI DUY NHẤT nối các module (khối "MODULE WIRING")
internal/server/rest.go          bảng RestRoutes (hàm rpc -> route REST) và RootRoutes (route lẻ)
internal/server/swagger.go       /api-docs.json và Swagger UI
internal/server/apidocs/         mô tả API nhúng (api-docs.json, meta.json; đóng băng)
internal/server/rpc/             cổng tương thích POST /api/:fn + Registry
internal/middleware/             auth, tenant, rbac, cors, rate_limit, body (đọc thân JSON)
internal/platform/database/      tầng dữ liệu (Select / Insert / Update / Remove, chuỗi lọc kiểu PostgREST) + db-map.json
internal/platform/storage/       kho file trên đĩa (UPLOAD_DIR), URL công khai /files/<path>
internal/platform/redis|logger/  Redis tuỳ chọn, log kiểu "[tag] nội dung"
internal/platform/webpush/       gửi Web Push: mã hoá RFC 8291 (aes128gcm) + VAPID RFC 8292, chỉ thư viện chuẩn (chat dùng)
internal/platform/mailer/        gửi email qua SMTP (STARTTLS / TLS cổng 465, AUTH PLAIN), chỉ thư viện chuẩn (mã OTP email của chat)
internal/platform/objstore/      kho tệp chat trên MinIO / S3 (minio-go v7): ký PUT / GET, chép, đọc luồng; CHAT_S3_* trống = tắt tệp
internal/platform/deps.go        import giữ chỗ để go.mod có sẵn thư viện cho các module
internal/shared/omap/            object JSON có thứ tự khoá (JS value model)
internal/shared/jsval/           ép kiểu / định dạng giống hệt JavaScript
internal/shared/tenant|actor/    ngữ cảnh công ty, người thao tác
internal/shared/response|errors|validator/
internal/shared/contracts/       interface gọi chéo giữa các module (mục 11)
internal/shared/qscore/          đọc số kiểu VN, tờ bìa, NCC 3.2, đọc CSV / xlsx, importParse
internal/shared/specs/           thông số theo ngành: js/*-spec.js là nguồn (nhúng, phục vụ ở /vs-spec.js...), data/ sinh bằng scripts/gen-specs.js
internal/shared/httpx/           gọi HTTP ra ngoài (OneShot: không tự gửi lại GET khi kết nối bị đóng)
internal/modules/<module>/       nghiệp vụ (mỗi module 1 gói)
internal/modules/chat/realtime/  gateway WebSocket của chat: 1 tiến trình, trạng thái trong bộ nhớ (kết nối, online, đang soạn,
                                 bộ chạy tuần tự Submit thay Kafka); api.go = hợp đồng Backend với gói chat
internal/modules/users/userstest/  đồ nghề test golden của users và auth (chỉ file test import)
internal/jobs/                   job nền
scripts/                         gen-specs.js (sinh internal/shared/specs/data từ *-spec.js)
tests/fixtures/                  dữ liệu đối chiếu tầng dữ liệu, registry, swagger (đóng băng) + jsref.js
tests/integration/               test Go trên server đã nối đủ module (server_test.go)
tests/e2e/                       test-api-go.js (E2E trên server Go đang chạy)
docs/                            ARCHITECTURE, API, DATABASE
```

Ngoài `backend/` (thư mục `infra/` ở gốc repo): `infra/db/migrations/` (NNNN_ten.sql, nguồn migration duy nhất), `infra/db/schema.sql`,
`infra/docker/backend.Dockerfile` + `backend.Dockerfile.dockerignore` (BuildKit tự đọc file ignore đặt cạnh Dockerfile).

## 2. Luật viết mã (bắt buộc)

1. **JS value model.** Giá trị động chỉ gồm: `nil` (null), `bool`, `float64`, `string`, `[]any`, `*omap.Map`,
   và `jsval.Undefined`. Mọi số là `float64`. Không dùng `map[string]any` cho dữ liệu trả về client (mất thứ tự khoá).
2. **Thứ tự khoá.** Object trả về phải có khoá theo đúng thứ tự của hợp đồng API (golden kiểm): dùng `omap.Of("a", x, "b", y)`
   hoặc struct có tag `json` khai báo theo đúng thứ tự đó. `omap.Map` tự xếp khoá dạng chỉ số ("0", "12") lên trước
   theo thứ tự tăng như JS.
3. **Ép kiểu qua `jsval`.** Không tự viết `strconv.Atoi`, `fmt.Sprint`, `math.Round`... cho dữ liệu nghiệp vụ.
   `Number(x)` -> `jsval.ToNumber`, `String(x)` -> `jsval.ToString`, `x || y` -> `jsval.Or`, `Math.round` -> `jsval.Round`...
4. **Thông báo lỗi** tiếng Việt có dấu, giữ nguyên từng byte (golden kiểm): `apperr.New("Chưa chọn sản phẩm hợp lệ")`.
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
`Decode` thay byte không phải UTF-8 bằng U+FFFD trước khi đọc, nên chuỗi nhận về luôn là UTF-8 hợp lệ.
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

Giá trị mong đợi trong test của `jsval` là đầu ra của `tests/fixtures/jsref.js` chạy bằng Node.js (ngữ nghĩa JavaScript chuẩn).

### 3.3 `qspro-backend/internal/shared/tenant`

```go
type Ctx struct { UID any; Role string; CongTyID any; ViewAs any }
func With(ctx context.Context, c Ctx) context.Context   // gắn ngữ cảnh công ty
func From(ctx context.Context) Ctx                      // đọc ngữ cảnh công ty
func TenantID(ctx context.Context) any                  // viewAs || congTyId || nil
func IsSuper(ctx) bool;  func IsAdmin(ctx) bool;  func UID(ctx) any;  func Scoped(ctx) bool
```

Mọi hàm service nhận `ctx context.Context` làm tham số đầu và truyền nguyên xuống database.
Chạy một đoạn với quyền super (không lọc công ty): `ctx = tenant.With(ctx, tenant.Ctx{Role: "super"})`.
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

### 3.5 `qspro-backend/internal/platform/database`

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
func Eq(col string, val any) string                   // "col=eq.<giá trị mã hoá>"
func CodeOf(err error) string                         // mã lỗi  ("23505", "42703", "PGRST204"...)
func StatusOf(err error) int                          // HTTP status của lỗi
var TenantTables map[string]bool
```

- Tên bảng / cột là tên tiếng Việt trong code (`du_an`, `ma_da`...), `db-map.json` dịch sang tên tiếng Anh; chuỗi lọc kiểu PostgREST.
- Dòng trả về là `*omap.Map`: số -> `float64`, boolean -> `bool`, timestamptz -> chuỗi `...+00:00`, jsonb -> `*omap.Map` / `[]any`.
- Ngữ cảnh công ty lấy từ `ctx`; bỏ lọc công ty: `database.Opt{NoScope: true}` / `SelectOpt{NoScope: true}`.
- Khoá có giá trị `jsval.Undefined` trong dòng ghi: cột vẫn được liệt kê nhưng giá trị bị bỏ khỏi JSON (thành NULL).
- Nhận biết lỗi theo mã: `database.CodeOf(err)` (`23505`, `42703`, `PGRST204`...) hoặc `strings.Contains(err.Error(), ...)`.
- Golden tầng dữ liệu: 110 ca (xem mục 9).

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
| purchasing | `SavePurchaseOrder` | MỖI đơn: phiếu + dòng hàng (1 Tx / đơn) | bù trừ xoá các đơn đã commit trước đơn hỏng (nuốt lỗi). Cả lần gửi CHƯA nguyên tử giữa các đơn (lý do `DEFAULT now()` ở trên) |
| purchasing | `SaveDeXuat` | phiếu đề xuất + dòng chiết khấu + đợt thanh toán | bỏ bù trừ `DeleteProposal` (repo bỏ hàm này) |
| projects | `DeleteProject` | xoá `du_an` TRƯỚC (khoá dòng cha), rồi 3 lệnh xoá con (rỗng nhờ `ON DELETE CASCADE`; `DeleteProjData` vẫn nuốt lỗi, savepoint riêng). Repo giả (`db == nil`) giữ thứ tự xoá cũ | - |
| projects | `DuplicateProject` | chèn dự án + `copyChildren` + kiểm `len(ins)==0` | bù trừ `DeleteProject(newMa)` chỉ còn khi `db == nil` |
| quotations | `SaveCover` (rpc `saveCover`, `PUT /projects/:id/cover`) | đọc id cũ + chèn + xoá bản cũ (`ghiCover`) | `GetCover` đọc lại |
| companies | `CreateCongTy` | `InsertCongTy` + `AdminCreateUser` (audit `create_user` bên trong rollback theo) | audit `create_company` |
| companies | `DeleteCongTy` | vòng `RemoveTenantRows` (lỗi từng bảng bỏ qua) + `RemoveCongTy` | audit |
| materials | `SetCombo`, `SetBienThe` | phần ghi (`ghiCombo`, `ghiBienThe`) | lịch sử, audit, `cacheClear` |
| materials | `DeleteDbProduct` | xoá SP + 3 lệnh dọn liên kết (nuốt lỗi) | lịch sử, audit, `cacheClear` (dời ra sau commit: trong Tx thì cache có thể nạp lại dữ liệu cũ) |

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
  `companies/tx_db_test.go` (`TestTxCongTyDB`), `materials/service_tx_test.go` (`TestTx*`). Ngoại lệ golden do D-13: mục 10.4.
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
func LoadDotenv(files ...string)   // mặc định .env rồi ../.env; cú pháp dotenv 16; không đè biến đã đặt; DOTENV=0 -> không đọc file nào
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
func HTMLError(c *gin.Context, status int, msg string)        // trang lỗi HTML
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

Cổng `/api/:fn` LUÔN trả 500 + `{"error": message}` cho mọi lỗi của handler, bất kể `AppError.Status`.
Service cứ trả `apperr.New(...)`; chỉ dùng `apperr.E(4xx, ...)` khi muốn route REST trả mã khác 500.

### 3.8 `qspro-backend/internal/server/rpc` - cổng `/api/:fn`

```go
type Perm uint8
const ( Login Perm = 0; Public; Admin; Super; SelfAuth )   // kết hợp: rpc.Admin|rpc.Super; SelfAuth chỉ cho GoRoute
type Handler func(ctx context.Context, a *actor.Actor, args Args) (any, error)
type Args []any
func (a Args) Len() int;  Has(i int) bool
func (a Args) Arg(i int) any          // thiếu -> nil
func (a Args) ArgU(i int) any         // thiếu -> jsval.Undefined (khi cần phân biệt thiếu tham số với null)
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

Quyền của 80 hàm đóng băng trong `tests/fixtures/registry.json` (`TestRegistryParity`): `rpc.Public` (không cần đăng nhập),
`rpc.Admin`, `rpc.Super`, `rpc.Admin|rpc.Super`, còn lại `rpc.Login`. Mọi handler nhận actor `a`; service không cần thì handler bỏ qua `a`.
Handler trả `nil` hoặc `jsval.Undefined` -> client nhận `"result": null`.
`ctx` của handler đã có ngữ cảnh công ty và KHÔNG bị huỷ khi client ngắt kết nối (handler luôn chạy hết).

`rpc.SelfAuth` (Chat MVP): route chỉ bản Go mà module TỰ xác thực bằng token riêng (chat: access token JWT của tài khoản chat,
middleware `requireChat()` của module trả 401 `CHAT_NOAUTH`), không dùng phiên QS. Middleware phân quyền của QS không bao giờ chặn route
này; `Register` (cổng `/api/:fn`) gặp `SelfAuth` thì panic lúc khởi động. Tài liệu `/api-docs.json` ghi quyền "Phiên chat riêng" và
response 401 `CHAT_NOAUTH`. Test: `rpc/selfauth_test.go`, `TestSelfAuthGoRoutes` (mục 12).

### 3.9 `qspro-backend/internal/middleware`

```go
type SessionResolver interface { SessionActor(ctx context.Context, token string) (*actor.Actor, error) }
type SessionHolder struct{ ... };  func NewSessionHolder() *SessionHolder;  func (h *SessionHolder) Set(r SessionResolver)
func BearerToken(r *http.Request) string
func ActorOf(c *gin.Context, s SessionResolver) *actor.Actor      // actor của request; SessionStoreError -> 500 + c.Abort()
type SessionStoreError struct{ Msg string }                       // kho phiên hỏng (thiếu bảng user_sessions) - M1.2
func Auth(s SessionResolver) gin.HandlerFunc                      // gắn actor vào gin.Context, không chặn
func RequestContext(r *http.Request, a *actor.Actor) context.Context
func Tenant() gin.HandlerFunc                                     // c.Request.Context() mang tenant + actor
func RequireLogin() / RequireAdmin() / RequireSuper() / RequireAdminSuper() gin.HandlerFunc
func Deny(a *actor.Actor, needAdmin, needSuper bool) (status int, msg, code string)
func JSONBody(limit int64) gin.HandlerFunc;  func Body(c) any;  func BodyMap(c) *omap.Map   // req.body
func DrainBody() gin.HandlerFunc   // đọc bỏ thân chưa đọc sau khi trả lời - thân quá 30 MB vẫn nhận được trang 413
func CORS(origins []string) gin.HandlerFunc;  func RateLimit(rps float64, rdb *redis.Client) gin.HandlerFunc
func ViewCompany(r *http.Request) string                          // header x-view-company
const JSONBodyLimit = 30 << 20                                    // 30 MB
const MsgRateLimited = "Quá nhiều yêu cầu, vui lòng thử lại sau"   // 429
```

Thông báo: 401 `{"error":"Chưa đăng nhập","code":"NOAUTH"}`, 403 `Không có quyền (chỉ Admin)`, 403 `Chỉ quản trị hệ thống`.
Module auth cài `SessionResolver` và phần nối gọi `d.Sessions.Set(authSvc)`.

**Phiên lưu phía máy chủ (M1.2, migration 0014, bảng code `phien_dang_nhap` = `user_sessions`).** `login` mở 1 dòng phiên và ký
token có thêm khoá `sid` (cuối payload). `SessionActor`: token đúng chữ ký, chưa hết hạn, có `sid` dạng uuid -> cache theo `sid`
(30 giây, mục cache nhớ `uid` để `ForgetSession(uid)` bỏ mọi phiên của tài khoản) -> đọc tài khoản -> công ty -> phiên còn dòng và
`het_han` > bây giờ. Thứ tự tài khoản TRƯỚC phiên để golden (uid hỏng -> lỗi database 22P02) giữ nguyên. Token không có `sid`
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
func (s *Server) OnShutdownFirst(fn func(context.Context))   // chạy TRƯỚC http.Server.Shutdown (tối đa 5 giây): gateway WebSocket chat
func (s *Server) Deps() *Deps;  func (s *Server) Reports() contracts.ReportRunner;  func (s *Server) Expiry() contracts.ExpiryReminder;  func (s *Server) SwaggerOn() bool
type RestRoute struct { Fn, Method, Path string };  var RestRoutes []RestRoute;  var RootRoutes [][2]string   // rest.go
```

Khớp route: `HEAD` dùng handler của `GET`; phần cố định của đường dẫn không phân biệt hoa thường và cho phép thừa
một dấu `/` cuối (`/API/getProjects/` = `/api/getProjects`, giá trị tham số giữ nguyên); tham số được giải mã phần trăm
(`/api/a%2Fb` -> `a/b`). Module chỉ đăng ký route `GET`, không đăng ký thêm `HEAD`.

### 3.11 `qspro-backend/internal/shared/qscore` - đọc số, tờ bìa, nhập hàng loạt

```go
func ToNumber(v any) float64     // đọc số người dùng gõ (kiểu VN)
func N(v any) float64            // null / "" / NaN / Infinity -> 0, còn lại như ToNumber
func Round0(v any) float64       // Math.round(N(v))  <- nghiệp vụ dùng hàm này
func Round0Num(n any) float64    // Math.round(Number(n) || 0)  (chỉ importParse dùng)
const LIM = 20000
func ChamTran[T any](rows []T, limit int, ten string) []T   // cảnh báo khi chạm giới hạn dòng (limit <= 0 = LIM)

// tờ bìa, NCC 3.2, nhập hàng loạt
type SupplierGroup struct{ ... }
var S32Suppliers []SupplierGroup          // nhà cung cấp mục 3.2
func S32SuppliersOf(stt string) [][2]string
func S32SuppliersValue() *omap.Map        // dạng object trả cho client
var S32Subs []string                      // "3.2.1" .. "3.2.8"
var CoverTemplate [][3]string             // mẫu tờ bìa
func InCode(nhom, stt any) bool
func Normalize(v any) string
func CoverComputed(cover []any) *omap.Map
func ImportParse(base64Data, ext, nganh any) (*omap.Map, error)   // đọc file nhập hàng loạt

// sheetrows.go (M5.1, route POST /api/v1/work-items/import/parse của estimates)
type SheetRow struct{ Dong int; Cells []any }   // Dong = số dòng thật trong file (tính cả dòng trống xen giữa)
func SheetRows(buf []byte, ext string) ([]SheetRow, error)   // sheet đầu; xlsx qua readXLSX của importParse, CSV giữ chuỗi gốc của ô
func DecodeBase64(s string) []byte        // bộ giải base64 của importParse
```

`csv.go` và `xlsx.go` không xuất hàm nào: bộ đọc CSV / xlsx chỉ được gọi qua `ImportParse` và `SheetRows`.
`SheetRows` không thêm thư viện: xlsx lấy `Dong` từ `<row r>` của sheet đầu (không đối chiếu được số dòng với `readXLSX` thì đánh số
liên tiếp 1..n); CSV đếm cả dòng trống và ô xuống dòng trong ngoặc kép, ô giữ nguyên chuỗi (không đổi sang số).

### 3.12 `qspro-backend/internal/shared/specs` - thông số theo ngành (nguồn: `js/*-spec.js`)

```go
type Spec struct { Name string; Data, Metric, HM, Opt *omap.Map; HangMuc, All, Chung, ChinhAll, TkAll []string; Muc, TenTk, VD string }
var VS, SON, CT, DL *Spec                 // nhúng từ data/{vs,son,ct,dl}.json (sinh bằng scripts/gen-specs.js)
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
| `service.go` | `type Deps struct{...}`, `type Service struct{...}`, `func New(d Deps) *Service`, và nghiệp vụ. Tên phương thức = tên hàm rpc viết PascalCase (`getProjects` -> `GetProjects`). Hàm thuộc hợp đồng đóng băng giữ thứ tự thao tác, thứ tự gọi database và thông báo lỗi (golden kiểm). |
| `repository.go` | `type Repository interface{...}`: những gì service cần từ kho dữ liệu. |
| `postgres.go` | Cài `Repository` bằng `*database.DB` (đọc / ghi, đổi dòng DB <-> object). |
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

`categories` và `files` mỗi gói có một bản `express.go` giống nhau (đọc query / trả file); sửa bên này phải sửa bên kia.

Khuôn tối thiểu: xem `internal/modules/system`.

## 5. REST `/api/v1`

- Group `v1` đã có `middleware.Auth` + `middleware.Tenant`: handler lấy `c.Request.Context()` (đã có tenant + actor)
  và `actor.FromGin(c)`; chặn quyền bằng `middleware.RequireLogin()` / `RequireAdmin()` / `RequireSuper()` trên từng route / group.
- Đường dẫn: `/api/v1/<tài-nguyên>` số nhiều, tiếng Anh, kebab-case. `GET` đọc, `POST` tạo / thao tác, `PATCH /:id` sửa một phần,
  `PUT` ghi đè một giá trị, `DELETE /:id` xoá theo quy tắc nghiệp vụ của hàm rpc tương ứng. Mỗi hàm rpc có đúng một route;
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

## 7. Ví dụ một hàm từ đầu đến cuối

Hai hàm `notifList` / `notifRead` (quyền `rpc.Login`, dùng actor): danh sách thông báo của người đang đăng nhập
(mới nhất trước, `limit` mặc định 30, tối đa 100) và đánh dấu một thông báo đã đọc.

`service.go`:

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

Ghi chú của ví dụ: cột có trong SELECT luôn có mặt nên `n.Val("ref_id")` đủ; khoá có thể vắng mặt thì `Val` trả `Undefined`
và `Marshal` bỏ khoá đó khỏi JSON. `read` là `true` chỉ khi cột `is_read` đúng bằng `true`.

`handler.go`:

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

## 8. Bảng hàm trợ giúp theo ngữ nghĩa JavaScript

`jsval` / `omap` tái hiện ngữ nghĩa JavaScript mà hợp đồng API dựa vào; bảng dưới chọn hàm Go theo ngữ nghĩa cần có.

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
| `if (/42703\|PGRST204/.test(e.message))` | `if c := database.CodeOf(err); c == "42703" \|\| c == "PGRST204"` (hoặc so chuỗi `err.Error()`) |
| `await Promise.all([a(), b()])` | gọi tuần tự theo đúng thứ tự (kết quả như nhau, tác động lên DB có thứ tự xác định) |
| `f().catch(function () {})` (không chờ) | `go func() { _ = f(context.WithoutCancel(ctx)) }()` |
| `function f(a, b = 5)` | handler dùng `args.ArgU(1)`; trong service: `if jsval.IsUndefined(b) { b = 5.0 }` |
| `Buffer.from(s, 'base64')` | `qscore.DecodeBase64` (bỏ qua ký tự lạ, chấp nhận thiếu padding); `base64.StdEncoding.DecodeString` báo lỗi với các đầu vào đó |

## 9. Kiểm thử

- Chạy trong container (máy không cài Go): `docker exec qspro-go go build ./...`, `go vet ./...`, `go test -count=1 -p 1 ./...`
  (`-p 1` vì các gói dùng chung `qspro_gotest`; `./...` gồm cả `tests/integration`). Lệnh đầy đủ và hạ tầng thử: `backend/README.md` mục Kiểm thử.
- Test đơn vị: repository giả cài interface trong `repository.go`; giá trị mong đợi của phép ép kiểu / định dạng lấy bằng `node -e`.
- Test tích hợp: đọc `TEST_DATABASE_URL`, `t.Skip` khi rỗng; chỉ dùng database thử (`qspro_gotest`); tự dọn dữ liệu mình tạo.
- So tầng dữ liệu với golden (110 ca):
  `DIFF_GOLDEN=/repo/backend/tests/fixtures/db-diff-golden.txt go test ./internal/platform/database/ -run TestDiffGolden`
  (`DIFF_OUT=<đường dẫn>.txt ... -run TestDiffDump` ghi kết quả hiện tại để xem). Đường dẫn trong `DIFF_OUT` / `DIFF_GOLDEN` phải TUYỆT ĐỐI
  (`go test` đứng ở thư mục của gói, đường dẫn tương đối báo `no such file or directory`). Cả hai cần `TEST_DATABASE_URL`;
  `TestDiffGolden` chỉ khớp trên database vừa đặt lại về seed.

## 10. Hành vi riêng và phần mở rộng

Hành vi không hiển nhiên của lớp HTTP / JSON, giới hạn đã biết, và phần mở rộng thêm sau 80 hàm gốc.

### 10.1 Lớp HTTP và JSON

- Không gửi header `X-Powered-By`.
- Thân JSON hỏng: trang 400 dạng HTML, không kèm stack, bất kể `NODE_ENV`. Tương tự cho trang 400 / 415 của `/upload/file` khi
  `Content-Encoding` hỏng hoặc lạ.
- Thân JSON lồng sâu quá 2000 tầng: 400. Thân mã hoá UTF-16: 400.
- Panic trong handler rpc -> 500 với nội dung panic. Panic ngoài cổng rpc -> trang HTML 500.
- `/media#x?token=a` (dấu `#` đứng trước `?`, chỉ client thô gửi được): 404.
- REST `/api/v1`: tham số query luôn là chuỗi (`GET /bootstrap?maDA=0` = rpc `bootstrap("0")`); response có header `x-app-ver` như cổng rpc (M1.1).
- Chuỗi Go không giữ được surrogate lẻ: escape surrogate lẻ trong thân JSON (`"\ud83d"`) thành U+FFFD ngay khi đọc thân, nên dòng
  chứa U+FFFD được ghi xuống database bình thường. `logClientError` cắt đôi emoji (không ghi audit); dòng log console hiện U+FFFD thay cho surrogate lẻ.
- `database.SelectOpt.Limit` là `int`: nơi gọi tự đổi giá trị số (0 = không giới hạn). `notifList` với limit ngoài khoảng (`<= -2^63`,
  `-Infinity`) trả lỗi 22003 / 42703 mà KHÔNG gửi truy vấn, nên không nạp lại danh mục cột. Ảnh hưởng: không có với client.
- Thời hạn HTTP: `ReadTimeout` 300 giây đóng kết nối; kết nối keep-alive rỗi sống 120 giây, không gửi header `Keep-Alive`.
- Swagger UI: trang nhúng của `swaggo/files`; `/api-docs/swagger-ui-init.js`, `/index.html`, `/swagger-initializer.js` trả trang của gói này.
- `response.OK` dùng lại bộ đệm mã hoá (pool; không giữ bộ đệm trên 64 MB) và `omap.Map` dùng chung tập khoá giữa các dòng của một kết quả:
  không đổi byte nào của thân trả về. Không được xoá khoá của map ngay trong hàm gọi lại của `Each` của chính nó.

### 10.2 Tên trùng thuộc tính của `Object.prototype`

Mặc định là tên lạ bình thường (404 / lỗi cột / chuỗi thường):

- tên hàm rpc `/api/toString`, `/api/constructor`...; bộ lọc `ten=constructor.1`; cột tên `constructor`;
  ô CSV `constructor` / `__proto__`; `optsOf(hm, 'toString')`; nhãn cột trùng tên prototype trong materials.

Ngoại lệ giữ hành vi JavaScript (vì đổi kết quả trả về hoặc dữ liệu ghi xuống; mỗi mục có test hồi quy theo golden):

| Module | Hành vi | Test |
|---|---|---|
| users | `adminUpdateUser` với khoá riêng `hasOwnProperty` -> `fields.hasOwnProperty is not a function` | ca `upd_hasown_key*` |
| purchasing | payload có khoá riêng `__proto__` là object: chỉ bù các khoá còn thiếu (`assignPayload`) | `TestSendGolden` |
| reports | `tenNganh` với tên prototype -> `function Object() { [native code] }`, `[object Object]`... | `TestBaoCaoNhapSPFlow` |
| quotations | dòng tờ bìa có `stt` / `tang` / `nhom` trùng tên prototype; sheet `Constructor 2`; lỗi `richText` khi ô là hàm | `cases.json` + `golden.txt` |

### 10.3 Giới hạn đã biết theo module

File Excel và XML:

- File .xlsx hỏng khi nhập: từ chối XML không đúng dạng ở các phần được đọc (workbook, rels, sharedStrings, styles, sheet) với thông báo
  riêng; các phần khác (drawing, table, docProps...) không đọc nên lỗi trong đó không bị phát hiện.
- quotations (`/export/bang`, `exportBaoGia`): ô có giá trị là object kiểu ô của ExcelJS (`{formula}`, `{text,hyperlink}`, `{richText}`,
  `{error}`, `{sharedString}`) được ghi thành chuỗi JSON, không thành kiểu ô tương ứng. Giao diện hiện tại không gửi được giá trị như vậy.
  (estimates đã ghi đúng các kiểu ô này.)
- estimates (`/export/cong-tac`): U+FFFE / U+FFFF trong chuỗi thành U+FFFD.

Gọi HTTP ra ngoài (Lark, webhook, tải ảnh):

- files (`/media`): gửi `Accept-Encoding: gzip`. Ký tự điều khiển trong token Lark: trả lỗi thô của net/http. Thân trả token: byte không
  phải UTF-8 không được thay bằng U+FFFD. `LARK_DOMAIN` có đoạn `.` / `..` hoặc host viết hoa không được chuẩn hoá. Ảnh hưởng: chỉ câu lỗi
  trong các ca hiếm này.
- quotations (tải ảnh cho Excel): ảnh trả `Content-Encoding: br` bị bỏ (không có bộ giải brotli, không xin `br`). Path bắt đầu `//`
  có ký tự phải mã hoá lại (`|`, `^`, `%` lẻ) được mã hoá theo luật của Go. Khi chuyển hướng mà `Location` chỉ có query (`?a=1`) sau một
  URL dùng `Opaque` thì mất host, ảnh bị bỏ.
- purchasing (webhook): bỏ tối đa 2 BOM đầu thân trả về. Huỷ context hoặc hết 300 giây cũng ghi log `fetch failed`.
- reports (webhook báo cáo): header mặc định của Go (`User-Agent: Go-http-client/1.1`, không có `accept`, `accept-language`, `sec-fetch-mode`).
  Log khi webhook lỗi giữ nguyên nhân dial / TLS. Ảnh hưởng: chỉ dòng log.

Chữ và thời gian:

- reports, companies: `jsLower` dùng bảng Unicode của Go; luật sigma cuối từ dùng tập Case_Ignorable xấp xỉ. companies và quotations đã bù
  27 chữ của Unicode 16 mà Go chưa có. Ký tự hiếm có thể ra chữ thường khác `toLowerCase` của JavaScript.
- auth (`login`), users (`adminCreateUser`): chữ thường của tên đăng nhập dùng bảng của Go, thiếu 27 cặp chữ Unicode 16. Ảnh hưởng (theo
  đọc mã, chưa chạy): tên như vậy bị luật `^[a-z0-9._-]{3,}$` từ chối khi tạo; khi đăng nhập chỉ ảnh hưởng nếu tên đã lưu chứa các chữ đó.
- reports: `tuVN` không có múi giờ dựa vào tzdata của Go; có thể lệch ở luật giờ lịch sử.

Đồng thời và tắt server:

- projects `bootstrap`: khi cả hai việc cùng lỗi, lỗi trả về là lỗi tới trước; hai việc chạy trên hai goroutine nên thứ tự khi sát nút
  không cố định.
- jobs: khi tắt, `Stop` để lượt gửi đang chạy xong và ghi dòng audit.

materials:

- `qsName` (tên file của `/upload/file`) phân tích query xấp xỉ: dạng object `name[...]` lẫn với dạng chuỗi / mảng ra `[object Object]`;
  `name[][]` ra `[object Object]`; mảng quá 1000 phần tử không đổi thành object. Ảnh hưởng: chỉ tên file lưu khi client cố ý gửi query dạng lạ.

### 10.4 Phần mở rộng sau 80 hàm gốc

- REST `/api/v1` (80 route) và 80 thao tác REST thêm vào `/api-docs.json`.
- Route REST "chỉ bản Go" (`rpc.GoRoute`, tính năng mới, không có hàm `/api/:fn`): module khai `reg.RegisterGoRoute` + route gin
  (mục 12.1); `/api-docs.json` có thêm thao tác nhóm `REST - <Tag> (chỉ bản Go)`, `operationId` `v1go_<Name>`,
  và một câu nối sau đoạn "Mỗi hàm RPC" của `info.description` (chỉ khi có ít nhất một route như vậy).
- Khoá / cột mới (cột database mới sau migration 0008, khoá kết quả mới). Golden đóng băng không có các khoá này; test bỏ chúng
  bằng `internal/shared/goonly` trước khi so (mục 12.1). Danh sách hiện tại (tên trong code; steward bổ sung khi đơn vị báo thêm).
  Mỗi khoá CHỈ là khoá mới trong phạm vi ghi ở cột 2; ngoài phạm vi đó, cùng tên khoá có thể là khoá gốc có thật:

  | Khoá | Phạm vi (chỉ bỏ ở đây) | Cột (code -> DB) | Ý nghĩa |
  |---|---|---|---|
  | `nguoi_duyet` | dòng `don_mua_hang` | `purchase_orders.resolver_name` | người đổi trạng thái đơn mua hàng |
  | `ngay_duyet` | dòng `don_mua_hang` | `purchase_orders.resolved_at` | lúc đổi trạng thái |
  | `nguoiDuyet`, `ngayDuyet` | kết quả đơn mua hàng (`getPurchaseOrder`, `GET /api/v1/purchase-orders/:code`) | hai cột trên | như trên, phía client (khoá có sẵn trong hợp đồng gốc, nay có giá trị - M15.1) |
  | `nguoiDuyet`, `ngayDuyet`, `ketQuaGui` | từng đơn của `getPurchaseOrders` (`GET /api/v1/projects/:id/purchase-orders`), nối CUỐI object | `resolver_name`, `resolved_at`, `send_result` | người / lúc duyệt, kết quả gửi Lark (chuỗi, `""` khi null) - M15.1, M9.1 |
  | `kenhGui`, `ketQuaGui` | `getPurchaseOrder` (`GET /api/v1/purchase-orders/:code`), nối CUỐI | `send_channel`, `send_result` | kênh gửi, kết quả gửi Lark - M9.1 |
  | `resolver`, `resolvedAt` | từng đơn của `listPurchaseRequests` (`GET /api/v1/purchase-orders`), nối CUỐI | `resolver_name`, `resolved_at` | giá trị cột nguyên dạng, null khi chưa duyệt - M15.1 |
  | `ket_qua_gui` | dòng `don_mua_hang` | `purchase_orders.send_result` | Go ghi `ok` / `loi` sau khi gửi thẻ Lark (lệnh riêng, M9.1); test khẳng định rồi đặt lại giá trị lúc lưu trước khi so golden |
  | `resolution_note` | dòng `delete_requests` | `delete_requests.resolution_note` | lý do từ chối yêu cầu xoá |
  | 38 cột Điện lạnh (`loai_may` ... `quy_cach_vt`, mọi nhãn của `specs.DL`) | khối `raw` của mọi sản phẩm (`prodToObj`, `getProducts`, catalog) | `db_san_pham` -> `product_hvac_specs` (migration 0017) | thông số ngành Điện lạnh; golden không có nên test bỏ khi rỗng: `goonly.StripEmpty` (`materials` `stripDL`) |
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

  CẢNH BÁO: `nguoi_duyet` / `ngay_duyet` (và `nguoiDuyet` / `ngayDuyet`) cũng là cột / khoá gốc có thật của `db_san_pham`
  (`products.approved_by/approved_at`), `de_xuat` (`purchase_proposals.resolver_name/resolved_at`) và `cong_tac`
  (`work_items.approved_by/approved_at`), cùng kết quả của sản phẩm, đề xuất, công tác. `goonly.Strip` bỏ khoá ở MỌI cấp lồng, nên
  KHÔNG gọi nó với các khoá này trên dữ liệu chứa sản phẩm / đề xuất / công tác: chỉ gọi trên đúng phần thuộc phạm vi
  (vd `purchasing/service_db_test.go`: chỉ `heads` của đơn mua hàng, không bỏ ở `proposals`), nếu không golden duyệt của các bảng đó
  bị che lỗi mà không ai thấy.

  Helper `internal/shared/goonly` (chỉ dùng trong test):
  - `Strip(v, keys...)`: bỏ khoá ở mọi cấp lồng, bất kể giá trị.
  - `StripNull(v, keys...)`: chỉ bỏ khoá khi giá trị là null (nil hoặc `omap.Undefined`); khoá có giá trị được giữ nên phép so golden báo
    khác (bắt lỗi ghi sai chỗ). ĐÃ CHỌN: `purchasing/service_db_test.go` (dòng `don_mua_hang`) và `projects/service_test.go` (kết quả)
    dùng `StripNull`, không dùng `Strip`. M15.1 (đợt 2) đã làm đúng cách này: `goCheck` khẳng định `resolver_name` / `resolved_at` ở bước
    duyệt / từ chối (người thao tác + có thời điểm) rồi mới bỏ khoá; mọi bước khác vẫn `StripNull` - không che bằng `Strip`.
  - `StripWrites(log, keys...)`: bỏ khoá khỏi payload từng lệnh ghi. Cả lệnh bị bỏ CHỈ khi một PAYLOAD (object con trực tiếp của lệnh,
    hoặc object là phần tử trực tiếp của mảng con trực tiếp) chỉ còn khoá Go; object lồng sâu hơn (vd giá trị cột JSON) bị bỏ hết khoá
    thì chỉ thành `{}` và lệnh được giữ.
  - `StripFailingRow(s, map[bảng DB]số cột mới)`: bỏ tối đa n giá trị `null` ở cuối "Failing row contains (...)" của bảng đó (cột
    `ADD COLUMN` đứng cuối dòng); giá trị khác null được giữ.
- Ngoại lệ golden do D-13 (transaction, mục 3.5): chỉ khi lỗi giữa chừng, thao tác rollback, còn golden ghi lại dữ liệu dở. Golden đóng băng không sửa;
  ngoại lệ khai trong mã test, kiểm đúng bước và đúng phần khác:
  - `materials/diff_test.go` `d13KhacNode`: bước 86 (dòng `sp_combo`) sau bước 80 `setCombo(p1, [id không tồn tại])` - golden mất liên kết
    ngược p3->p1, nay còn. Test kiểm đúng bước + bỏ đúng 1 dòng; thiếu dòng thì báo lỗi.
  - Hành vi khi lỗi (không có trong golden): `createCongTy` lỗi tạo tài khoản chủ -> công ty KHÔNG còn;
    `deleteCongTy` lỗi -> dữ liệu các bảng không bị xoá dở; `saveCover` lỗi -> không còn tờ bìa nhân đôi bản cũ + bản mới;
    bước lưu của `sendPurchaseRequest` / `sendDeXuat` lỗi -> không còn phiếu thiếu dòng; `duplicateProject` lỗi -> không còn bản nhân dở.
    Chi tiết ở `API.md` mục 1 "Lỗi giữa chừng (D-13)".
- Tham số / ghi mới trên hàm rpc cũ của đợt 2 (chi tiết ở `API.md` mục 2.1):
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
- Tham số / kiểm tra mới trên hàm rpc cũ (M14.1 / M17.2):
  - `adminUpdateUser` / `PATCH /api/v1/users/:id` nhận khoá `email` (trước M14.1 bị bỏ qua khi sửa). Email gửi lên trùng email đang lưu
    (so sau trim + chữ thường ở cả hai phía) = không đổi: không kiểm dạng, không ghi (giữ nguyên văn bản cũ, kể cả email sai dạng do
    đường tạo lưu nguyên văn); nếu super đồng thời chuyển công ty thì chỉ kiểm trùng ở công ty mới. Email đổi: trim + chữ thường; rỗng /
    null = xoá (ghi ""); không khớp `/^[^\s@]+@[^\s@]+$/` -> `Email không hợp lệ`; trùng tài khoản KHÁC trong cùng công ty (công ty sau
    khi sửa, không phân biệt hoa thường) -> `Email đã dùng cho tài khoản khác trong công ty`. Trùng giữa hai công ty được phép (đăng nhập
    chọn theo `loginScore`). Repo `users.Repository.UserByEmailInCompanyExcept` (ilike đã thoát `\ % _`, `*` -> `_`, so lại đúng chữ ở Go;
    test `users/postgres_email_db_test.go`). `adminCreateUser` KHÔNG đổi (lưu email nguyên văn; React tự kiểm dạng, gửi trim +
    chữ thường).
  - Email chứa `*`, `%` hoặc `\` lưu được (khớp dạng) nhưng không dùng để đăng nhập được: đăng nhập bằng email chặn các ký tự này
    (`reWildcard` của auth). React `UserModal` cảnh báo; đăng nhập bằng tên đăng nhập.
  - `createCongTy` / `updateCongTy`: `mauChinh` (khác null / undefined) phải là `""`, `#RGB` hoặc `#RRGGBB` (giữ nguyên chữ), khác ->
    `Màu chính phải dạng #RRGGBB`. Kiểm `String(v)` với MỌI kiểu (số, boolean, mảng...). Lỗi quyền vẫn báo TRƯỚC lỗi
    màu. `createCongTy` vẫn KHÔNG lưu `mau_chinh` (golden s04 trả `""`): React `CongTyForm` lưu màu bằng `updateCongTy` ngay sau
    khi tạo.
  - Vì vậy `updateCongTy {mauChinh: 0}` trả 500 `Màu chính phải dạng #RRGGBB` (M17.2).
  - `PUT /api/v1/projects/:id/cover` (REST, KHÔNG phải rpc `saveCover`): dòng có `chiPhi` < 0 -> 400
    `Chi phí dự kiến không được âm (mục <stt>).` (`(dòng <n>)` khi thiếu stt), không ghi gì. Lỗi được đổi SAU `SaveCover` (lỗi ràng buộc
    `ck_cost_estimate_lines_cost` -> 400) nên thứ tự kiểm giống rpc (dự án mất / khác công ty báo trước). Mã: `quotations/dto.go`
    `doiLoiChiPhiAm`, gọi ở route PUT cover của `handler.go`. rpc `saveCover` giữ lỗi ràng buộc DB (500) vì golden `save-neg` đóng
    băng. Ngoại lệ REST khác kết quả rpc, ghi cả ở `API.md` (luật chung + mục 2.1).
- Đợt 3 của backlog (M10.1, M17.3; chi tiết route ở `API.md` mục 2.1). Không có cột mới, không có khoá kết quả mới trên hàm rpc cũ, không
  đổi fixture / golden (`TestRestRoutes` chỉ thêm đường dẫn mới vào danh sách route chỉ bản Go):
  - Route `POST /api/v1/products/:key/private-copy` (`copySharedProduct`, materials, `service_private_copy.go`): bản sao riêng Chưa duyệt
    của SP kho chung Dezon. Quyền làm lại `canTab('sanpham')` của giao diện ở máy chủ (GIẢ ĐỊNH M10.1: `SpPerms` cho mọi nhân viên quyền sửa,
    nên route xét thêm tính năng công ty + tab `sanpham`; các hàm `...Gated` cũ không xét). Lỗi unique (23505) khi chèn -> cùng câu trùng mã.
    Test: `TestCopySharedProduct`, `TestCopySharedProductNhanh`, `TestCopySharedProductRoute`, `TestCopySharedProductDB` (có database).
  - Danh mục: `getProducts` ẩn dòng kho chung khi công ty có SP riêng trùng `ma|congSuat|nhietDo|gocChieu|mauSac`, và so thêm
    `kich_thuoc` khi dòng kho chung có trục này (`ghepKhoChung`, `biDe`, `coTrucKichThuoc` trong `service_catalog.go`; ngành vs / son, hoặc có
    `kich_thuoc`; ngành trống suy từ hạng mục như `SaveDbProduct`) - đúng khoá kiểm trùng của bản sao riêng, nên chép sơn 2IN1 15L không làm
    mất 1L / 5L. Test `TestGhepKhoChungKichThuoc`.
    Golden `getProducts` không đổi (dữ liệu golden không có SP riêng trùng mã kho chung khác kích thước).
  - Route `POST /api/v1/companies/expiry-reminders` (`nhacGiaHan`, companies, `expiry.go`, chỉ super): nhắc gia hạn trong ứng dụng (M17.3;
    không gửi Lark, không email). Chỉ gửi thật khi `dryRun === false`.
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
- Chat MVP (module `chat` + gói con `realtime`, `platform/webpush`, `platform/mailer`, `platform/objstore`, migration 0018, 0019, 0020; route
  ở `API.md` mục 2.1 "Chat"; quyết định `docs/02-ky-thuat/database/decisions.md` D-15, D-16, D-17). Tính năng mới, không có hàm `/api/:fn`, không đụng golden / fixture nào:
  - Tài khoản chat riêng (`chat_users`, danh tính = số điện thoại HOẶC email + OTP; hai loại là tài khoản riêng, chưa liên kết), KHÔNG phải
    `users` của QS, không theo công ty. Token riêng của
    module (access JWT HS256 + refresh xoay vòng) nên route dùng quyền mới `rpc.SelfAuth` (mục 3.8); 3 route đăng nhập là `rpc.Public`.
  - NGOẠI LỆ của luật "mọi đọc / ghi qua tầng dữ liệu `database.DB`": module chat viết SQL thô qua `database.DB.Pool()` (pgx), tên bảng / cột
    TIẾNG ANH, transaction riêng (`pgx.BeginFunc`), khoá `pg_advisory_xact_lock`, `SELECT ... FOR UPDATE`. Lý do: lớp kiểu PostgREST không
    diễn đạt được `UPDATE ... SET last_seq = last_seq + 1 RETURNING` (cấp `seq` nguyên tử), `GREATEST(...)`, upsert `ON CONFLICT` và các câu
    nối của danh sách hội thoại; bảng chat không thuộc công ty nên không cần lọc tenant. Pool chạy simple protocol: mọi tham số mảng /
    thời điểm / boolean ép kiểu tường minh trong SQL (`$1::bigint[]`...). `db-map.json` vẫn có 10 mục `chat_*` (quy tắc database 17), không
    khai `tenant`, không vào `TenantTables`. Module khác KHÔNG được bắt chước: dùng `database.DB` như mục 3.5.
  - Gateway WebSocket MỘT tiến trình (`realtime.Hub`, CHAT.md mục 16 "MVP: WebSocket một gateway"): kết nối, online, đang soạn trong bộ nhớ;
    phân phối tin qua `Hub.Submit(conversation_id, job)` (cùng khoá = cùng worker, giữ thứ tự) thay Kafka; tin commit trước rồi mới phân phối.
    Chưa chia tải ngang được: chạy nhiều tiến trình thì người ở hai tiến trình không thấy nhau realtime.
  - Gin 1.11 từ chối `Hijack` sau `WriteHeaderNow` (thư viện websocket gọi hàm này): `realtime/hijack.go` bọc ResponseWriter, lùi xuống writer
    của net/http và xoá deadline của kết nối (`ReadTimeout` 300 giây của http.Server). Chỉ gắn WebSocket qua `Hub.ServeHTTP`, không gọi
    `websocket.Accept` trên `c.Writer` ở chỗ khác.
  - Tắt server: `OnShutdownFirst(chatHub.Drain)` gửi `reconnect`, đóng 1012 (tối đa 5 giây, vì `http.Server.Shutdown` không theo dõi kết nối
    đã hijack), rồi `http.Server.Shutdown`; `OnShutdown(chatSvc.Shutdown)` mới dừng bộ chạy phân phối của hub (`Hub.Shutdown`: tin hệ thống
    của request REST đang dở vẫn phân phối + xếp push) rồi worker push sau cùng.
  - Web Push: `platform/webpush` chỉ dùng thư viện chuẩn (crypto/ecdh, ecdsa, hkdf, aes-gcm); bật khi đặt đủ 3 biến `CHAT_VAPID_*`
    (`chatPush` trong `routes.go`; thiếu / khoá sai -> tắt push, 1 dòng log). SMS: `logSender` ghi mã OTP vào log (chưa có nhà cung cấp SMS).
    Email: `platform/mailer` (SMTP, chỉ thư viện chuẩn) bật khi đặt `SMTP_HOST` (`chatMail` trong `routes.go`; chưa đặt / cấu hình sai ->
    `logMailer` ghi mã OTP email vào log, 1 dòng log lúc khởi động).
  - Tệp đính kèm (ảnh / video / tệp / tin thoại, `CHAT.md` mục 12, API ở `API.md` "Tệp đính kèm"): byte không đi qua server Go. Trình duyệt
    PUT thẳng lên MinIO bằng presigned URL (ký `Content-Type` + `Content-Length`, khoá tạm `chat/in/...`), rồi `POST /chat/media/:id/complete`
    chạy ĐỒNG BỘ trong request (tối đa 60 giây, thay media worker + sự kiện bucket): giành dòng `chat_media` bằng `status = processing` (không
    giữ transaction), chép phía server sang khoá cuối `chat/m/...`, kiểm kích thước / dò loại / sha256 theo luồng / quét virus (`MediaScanner`,
    mặc định `logScanner` coi là sạch), ảnh nhỏ 320 px + blurhash (`media_image.go`, `blurhash.go`; tối đa 2 ảnh giải mã cùng lúc). Không ghi
    tệp tạm ra đĩa; không dùng `platform/storage` (`UPLOAD_DIR`). Đọc bằng presigned GET (mặc định 60 phút, cache URL trong tiến trình nửa hạn).
  - Interface `chat.MediaStore` / `chat.MediaScanner` (`media.go`) chỉ dùng kiểu nguyên thuỷ nên `objstore` không import `chat`;
    `var _ chat.MediaStore = (*objstore.Client)(nil)` trong `routes.go` là phép kiểm lúc biên dịch. `objstore` có hai client minio-go:
    `internal` (`CHAT_S3_ENDPOINT`) đọc / ghi / chép / xoá, `signer` (`CHAT_S3_PUBLIC_URL`) chỉ ký URL, offline vì đã đặt region (SigV4 buộc
    host: trình duyệt phải gọi đúng host đó). `objstore.New` không gọi mạng; `Start` kiểm / tạo bucket trong goroutine (backoff 1 -> 60 giây),
    xong mới `Ready()`; trước đó route tệp trả 503 `UNAVAILABLE`.
  - `chatMedia` trong `routes.go` (cạnh `chatPush` / `chatMail`): `CHAT_S3_ENDPOINT` trống -> nil, 1 dòng log `tệp chat tắt: ...`; thiếu
    `CHAT_S3_ACCESS_KEY` / `CHAT_S3_SECRET_KEY` hoặc `New` lỗi -> nil + log lỗi. Nil = tắt tệp: route tệp + tin tệp trả 503 `MEDIA_DISABLED`,
    `GET /chat/media/config` trả `{enabled: false}`, tin tệp cũ vẫn liệt kê (không có URL). Có kho thì `s.OnShutdown` huỷ context của `Start`.
  - Janitor (`janitorOnce` trong `service_media.go`, 30 phút / lần, chỉ chạy khi có kho tệp; `Shutdown` đóng `mediaQuit` và chờ cùng worker
    push): `processing` quá 10 phút -> `pending`; `pending` / `failed` không đổi quá 2 giờ -> `failed` + xoá object; xoá dòng `pending` /
    `failed` tạo quá 24 giờ và tệp `ready` không tin nào dùng quá 24 giờ; `blocked` giữ lại. Khoá tạm `chat/in/` còn có ILM 1 ngày
    (`infra/deploy/minio-init.sh`). Gửi tin khoá tệp `for share` nên janitor (`for update skip locked`) bỏ qua tệp đang được gửi.
  - MinIO chạy cạnh app (`infra/deploy/docker-compose.yml` dịch vụ `minio` + `minio-init`, image tự build `infra/docker/minio.Dockerfile`),
    Caddy phục vụ `{$S3_DOMAIN}`; sao lưu bucket bằng `mc mirror` trong `infra/scripts/backup-db.sh` (runbook `docs/04-van-hanh/trien-khai-vps-cloudfly.md`).
  - Test: `go test ./internal/modules/chat/...` (test database cần `TEST_DATABASE_URL` trỏ database đã chạy 0020; phần tệp dùng kho giả trong
    `helpers_db_test.go`), `./internal/platform/objstore` (MinIO thật khi đặt `TEST_S3_ENDPOINT` / `TEST_S3_ACCESS_KEY` / `TEST_S3_SECRET_KEY`,
    không thì bỏ qua), `./internal/platform/webpush` (vector RFC 8291 phụ lục A), `-race` cho `realtime` (mục Kiểm thử của `backend/README.md`);
    `backend/tests/chat-e2e/chat-e2e.js` bước `s16` (tự bỏ qua khi máy chủ tắt tệp).
- Biến `REPORT_JOB` (tắt job báo cáo và job nhắc gia hạn), `STATIC_DIR`, `VENDOR_DIR`, `CORS_ORIGINS`, `RATE_LIMIT_RPS`, `TRUSTED_PROXIES`, `REDIS_URL`, `DEBUG`,
  `DB_POOL_MAX`, `DB_SORT_COLLATION`, `DOTENV`, `UPLOAD_DIR` (kho file trên đĩa, mục 3.6), `CHAT_JWT_SECRET`, `CHAT_ACCESS_TTL_MIN`,
  `CHAT_REFRESH_TTL_DAYS`, `CHAT_OTP_DEV`, `CHAT_VAPID_PUBLIC_KEY` / `CHAT_VAPID_PRIVATE_KEY` / `CHAT_VAPID_SUBJECT`, `SMTP_HOST` / `SMTP_PORT` /
  `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM`, `CHAT_S3_ENDPOINT` (trống = tắt tệp chat) / `CHAT_S3_PUBLIC_URL` (mặc định = endpoint) /
  `CHAT_S3_ACCESS_KEY` / `CHAT_S3_SECRET_KEY` / `CHAT_S3_BUCKET` (`chat-media`) / `CHAT_S3_REGION` (`us-east-1`), `CHAT_MEDIA_MAX_IMAGE_MB` (25),
  `CHAT_MEDIA_MAX_FILE_MB` (100, trên 200 ép về 200), `CHAT_MEDIA_DAILY_MB` (2048), `CHAT_MEDIA_URL_TTL_MIN` (60, ép 5..720) (chat, `backend/README.md`).
  CORS, giới hạn tần suất, Redis mặc định tắt; `CORS_ORIGINS` cũng là danh sách origin được mở WebSocket chat (bỏ scheme).
- `TRUSTED_PROXIES` mặc định không tin proxy nào: đứng sau reverse proxy mà không đặt thì mọi client chung một giới hạn tần suất.
  Ảnh hưởng: không có khi `RATE_LIMIT_RPS` tắt (mặc định).
- Đọc `backend/.env` trước rồi mới tới `../.env` ở gốc repo; `DOTENV=0` trong môi trường thì không đọc file nào (mặc định: đọc cả hai).
- Tắt êm: gateway chat báo `reconnect` + đóng WebSocket (tối đa 5 giây), chờ request đang chạy (tổng tối đa 15 giây), dừng job nền và
  worker push chat, đóng pool database.
- File nhúng (go:embed): `/vs-spec.js`, `/son-spec.js`, `/ct-spec.js`, `/dl-spec.js` (module categories phục vụ, nguồn
  `internal/shared/specs/js/`), `/mau-nhap-hang-loat.xlsx` (categories, `assets/`), `/mau-nhap-cong-tac.xlsx` (estimates, `assets/`),
  `/logo.svg` (server, `internal/server/assets/`).
  Module khai file nhúng qua interface tuỳ chọn `AssetModule { Assets() map[string][]byte }` (như `RootModule`); server phục vụ
  bằng middleware đứng TRƯỚC `STATIC_DIR`, Content-Type / Cache-Control theo bảng ở `backend/README.md`; ETag theo nội dung, không có
  `Last-Modified`. Không thuộc `RootRoutes` (đây là file tĩnh).
  Đường dẫn thô có `.` / `..` / `//` được chuẩn hoá (`/x/../vs-spec.js` -> 200); leo khỏi gốc (`/../vs-spec.js`) -> 404. Git không được đổi xuống dòng của file nhúng: `backend/.gitattributes` đặt `-text` (giữ đúng mã blob khi `core.autocrlf=true`).
- `STATIC_DIR` mặc định TRỐNG: không đặt thì không phục vụ giao diện cũ và `/vendor`, không log gì.
  Đặt rồi mà thiếu `STATIC_DIR/index.html` hoặc thư mục dist của thư viện giao diện thì lúc khởi động ghi log `thiếu <đường dẫn> ...`.

### 10.5 Chưa kiểm chứng bằng chạy thật, hoặc không tới được

Không tới được từ client hiện tại (ghi lại để người sửa sau biết):

- `contracts.MediaDownloader.MediaDownload` nhận token dạng chuỗi; query `token` dạng mảng / object do handler `files` tự đổi.
- `NotifyDeXuatAdmins` nhận `dx *omap.Map`: không truyền được chuỗi / số, nil không phân biệt null với undefined. Nơi gọi luôn truyền object.
- Các nhánh chỉ chạy khi database thiếu cột / bảng (chưa chạy migration): có test thuần, chưa chạy trên database thiếu migration.

Chưa chạy thử:

- companies: sigma cuối từ đứng cạnh một trong 27 chữ Unicode 16.
- quotations: thân gzip có rác sau phần nén (ảnh bị bỏ); line có khoá riêng tên `__proto__`.

Đo được:

- Đồng thời: 10 lệnh `saveDbProduct` cùng mã chạy song song cho 1 lệnh 200 và 9 lệnh 500 (`23505`), database còn đúng 1 dòng
  (kiểm-rồi-chèn, unique index chặn bản trùng).
- Bộ nhớ khi đọc danh mục đồng thời (seed: 949 sản phẩm, thân `getProducts` 4,38 MB), đo trên server thật sau khi sửa bộ đệm mã hoá
  (`response.OK`, `omap`) ngày 2026-10-14: 50 `getProducts` + 50 `bootstrap` song song: 0,93 GB (VmHWM); 100 + 100: 1,67 GB.
  Trước khi sửa: 2,48 GB / 5,26 GB. Mỗi request vẫn cấp phát khoảng 6 lần cỡ thân (bộ đệm pgx, chuỗi JSON, bản sao `[]byte` trong
  `platform/database`). `GetProductsCached` không gộp các lượt nạp cache nguội.

### 10.6 Kết quả không xác định

Cùng một câu truy vấn, database được quyền trả kết quả khác nhau giữa hai lần chạy:

- `getProjData` đọc không có ORDER BY: thứ tự khoá của object trả về theo thứ tự dòng database đưa ra (tập khoá giống nhau).
- Sắp theo cột thời gian khi nhiều dòng trùng thời điểm: thứ tự các dòng trùng không cố định (tập dòng giống nhau).
- `limit 1` không có ORDER BY khi nhiều dòng cùng khớp: `saveDbProduct` của super chưa chọn công ty với mã có ở nhiều công ty
  (`materials/service_write.go`) và tra sản phẩm theo mã dùng chung (`materials/service_approve.go`). Dòng được chọn tuỳ vị trí vật lý
  của dòng trong bảng. Ảnh hưởng: super không chọn công ty sửa một mã có ở nhiều dòng thì dòng nào được sửa là ngẫu nhiên.
- Thông báo cho admin (module `notifications`) đọc admin không ORDER BY: trong một sự kiện, admin nào nhận id thông báo nào tuỳ thứ tự
  dòng của bảng `users`. Tập người nhận và nội dung giống nhau. Ảnh hưởng: không có với client.

## 11. Contracts - interface gọi chéo dùng chung

Gói `qspro-backend/internal/shared/contracts` (file `contracts.go`) khai báo MỌI interface gọi chéo giữa các module.
Module dùng import `contracts` và đặt kiểu trường
`Deps` bằng interface ở đó; module chủ cài bằng phương thức của `*Service` với chữ ký đúng từng chữ. Gói chỉ import
`omap`, `actor` và thư viện chuẩn; giá trị trao đổi theo JS value model (object `*omap.Map`, mảng `[]any`).
Ngữ nghĩa chi tiết (nuốt lỗi, null, thứ tự khoá) nằm trong chú thích của từng interface.

| Interface | Phương thức | Chủ | Module dùng |
|---|---|---|---|
| `Auditor` | `Audit(ctx, a, action, detail string, congTyID any)` | users | auth, companies, notifications, materials, estimates, purchasing |
| `UserReader` | `GetByID(ctx, id any) (*omap.Map, error)` | users | auth, materials, notifications, purchasing |
| `UserFormatter` | `UserOut(row *omap.Map) *omap.Map`, `PermsArr(v any) []any` | users | auth, companies, materials (PermsArr) |
| `UserCreator` | `AdminCreateUser(ctx, a, data *omap.Map) (*omap.Map, error)` | users | companies |
| `SessionInvalidator` | `ForgetSession(uid any)`, `RevokeUserSessions(ctx, uid any, keep string) error` (M1.2) | auth | users |
| `middleware.SessionResolver` | `SessionActor(ctx, token string) (*actor.Actor, error)` | auth | middleware, server (đã có ở mục 3.9, không nằm trong `contracts`) |
| `CompanyReader` | `GetCongTy(ctx, id any) (*omap.Map, error)`, `HetHan(ct *omap.Map) bool` | companies | auth, users |
| `Notifier` | `Notify(ctx, userID any, kind, title, body string, refID any)` | notifications | materials, purchasing |
| `AdminLister` | `ActiveAdmins(ctx) ([]any, error)` | notifications | materials, companies (nhắc gia hạn) |
| `PurchaseNotifier` | `NotifyPurchaseAdmins(ctx, a, orders []any) error`, `NotifyDeXuatAdmins(ctx, a, dx *omap.Map) error`, `DeXuatTen(loai string) string` | notifications | purchasing |
| `ProductPerms` | `SpPerms(ctx, a) (edit, duyet, admin bool, err error)` | materials | takeoff, estimates |
| `ProductSaver` | `SaveDbProduct(ctx, a, data, opts *omap.Map) (*omap.Map, error)` | materials | takeoff |
| `CatalogReader` | `GetProductsCached(ctx) ([]any, error)` | materials | projects (bootstrap) |
| `ProductLister` | `GetProducts(ctx) ([]any, error)` | materials | xuất Excel sản phẩm (hiện nằm trong chính materials - chỉ cần nối nếu phần xuất tách sang module khác) |
| `LineReader` | `GetLines(ctx, maDA any) ([]any, error)` | takeoff | projects (bootstrap), quotations |
| `ProjectReader` | `GetProject(ctx, maDA any) (*omap.Map, error)` | projects | quotations |
| `MediaDownloader` | `MediaDownload(ctx, fileToken string) (buf []byte, contentType string, err error)` | files | quotations (fetchImage) |
| `Uploader` | `Upload(ctx, buf []byte, path, contentType string) (url string, err error)` | platform/storage (`*storage.Client`, ghi vào `UPLOAD_DIR`, trả `/files/<path>`) | materials |
| `FileReader` | `ReadURL(url string, max int64) ([]byte, error)` | platform/storage (`*storage.Client`) | quotations (fetchImage) |
| `ReportRunner` | `BaoCaoNhapSP(ctx, a, opts *omap.Map) (*omap.Map, error)`, `DaGuiHomNay(ctx) bool` | reports | jobs |
| `ExpiryReminder` (file `expiry.go`) | `NhacGiaHan(ctx, dryRun bool) (*omap.Map, error)` | companies | jobs |

`a` là `*actor.Actor`, `ctx` là `context.Context`. `categories` là gói dữ liệu thuần, được `materials` và `reports` import trực tiếp
(không qua interface) - ngoại lệ duy nhất của luật 2.7.

Để mọi chữ ký chỉ dùng kiểu của JS value model: `PermsArr` trả `[]any` (không phải `[]string`),
`ActiveAdmins` trả `[]any` gồm `*omap.Map` (không phải `[]*omap.Map`); `DeXuatTen` đã gồm giá trị mặc định `"đề xuất"`.

### 11.1 Thêm vào gói dùng chung

```go
// internal/shared/errors
const HDMig = `Hãy chạy "npm run migrate" rồi khởi động lại server.`   // hướng dẫn khi thiếu cột / bảng (hằng đóng băng)
const DAMat = "Bản nháp không còn tồn tại ..."                          // dòng cha không còn / khác công ty
func ColErr(err error) error      // lỗi thiếu cột -> lỗi hướng dẫn; lỗi khác trả NGUYÊN err; nil -> nil
func ColSQL() []string            // các cột thêm sau (19 cột cố định + cột METRIC của các spec ngành)
func KhongCoCha(err error) bool   // err.Error() có mã 23503 (khoá ngoại)

// internal/shared/jsval
func S(v any) string              // = Str
func NowISO() string              // = ToISOString(time.Now())
```

Cách dùng: `return nil, apperr.ColErr(err)`; `if apperr.KhongCoCha(err) { return nil, apperr.New(apperr.DAMat) }`.
Các thông báo thiếu bảng / cột (`HDMig` và chuỗi tương tự trong module, cả `platform/database/catalog.go`) còn ghi `npm run migrate`:
lệnh này không tồn tại, nhưng chuỗi đóng băng theo golden. Lệnh migrate thật là `go run ./cmd/migrate` (từ `backend/`, mục 12.1).
`internal/shared/errors/testdata/colerr.json` là dữ liệu đóng băng: không sinh lại được, không sửa tay (mục 12.1).

### 11.2 Thứ tự nối trong `internal/server/routes.go`

Đồ thị phụ thuộc có vòng `auth <-> users <-> companies`. Cắt vòng bằng ĐÚNG HAI setter trên `*users.Service`; mọi phụ thuộc
khác đi qua `Deps` lúc `New` (không có `SetDeps(d Deps)` gộp, không có setter nào khác):

```go
func (s *Service) SetCompanyReader(c contracts.CompanyReader)            // users <- companies
func (s *Service) SetSessionInvalidator(si contracts.SessionInvalidator)  // users <- auth
```

Hai trường tương ứng KHÔNG nằm trong `users.Deps`. Gọi cả hai trong khối MODULE WIRING, trước khi server nhận request
(không cần khoá). Ngoại lệ không phải giữa hai module: `chatSvc.SetGateway(chatHub)` cắt vòng giữa chat và gateway WebSocket của chính nó
(hub cần `Backend` = `chatSvc`, `chatSvc` đẩy tin qua hub). Thứ tự dựng:

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
| 15 | chat (dựng sau `delivery`, `sales`; đứng cuối danh sách `modules()`) | không có module nào; `Push` = `*webpush.Client` khi đủ `CHAT_VAPID_*` (`chatPush`), nil = tắt push; `SMS` nil = `logSender`; `Mail` = `*mailer.Client` khi đặt `SMTP_HOST` (`chatMail`), nil = `logMailer`; `Media` = `*objstore.Client` khi đặt `CHAT_S3_ENDPOINT` + khoá (`chatMedia`, đăng ký `s.OnShutdown` huỷ `Start`), nil = tắt tệp; `Scan` nil = `logScanner`. Rồi `chatHub := realtime.NewHub(realtime.Options{Backend: chatSvc, OriginPatterns: wsOrigins(CORS_ORIGINS)})`, `chatSvc.SetGateway(chatHub)`, `s.OnShutdownFirst(chatHub.Drain)`, `s.OnShutdown(chatSvc.Shutdown)` |

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

- `internal/server/routes.go` (khối MODULE WIRING) dựng `system` rồi 17 module nghiệp vụ theo đúng thứ tự mục 11.2 (chat kèm gateway `realtime.Hub`); `Server.Reports()` trả module reports,
  `Server.Expiry()` trả phần nhắc gia hạn của companies, cho `cmd/api/main.go` bật job nền (`jobs.Start`: báo cáo + nhắc gia hạn, tắt cả hai
  bằng `REPORT_JOB=0`, dừng qua `srv.OnShutdown`).
- `internal/server/rest.go`: bảng `RestRoutes` (80 hàm rpc -> route REST) và `RootRoutes` (9 route lẻ). Hai bảng này ĐÓNG BĂNG cùng 80 hàm
  rpc; route mới là route chỉ bản Go do module tự khai (dưới đây).
- `internal/server/swagger.go`: `GET /api-docs.json` = phần cố định (80 path `/api/<fn>` + 9 route lẻ, giống từng byte fixture
  `tests/fixtures/swagger-node.json`) cộng 80 thao tác REST `/api/v1` (nhóm `REST - ...`), thao tác của route chỉ bản Go (`reg.GoRoutes()`, nhóm
  `REST - <Tag> (chỉ bản Go)`) và đoạn cuối `info.description`. `GET /api-docs/` là Swagger UI
  nhúng sẵn (`github.com/swaggo/files/v2`, không gọi CDN). Bật / tắt: `SWAGGER_DOCS=0` tắt, `NODE_ENV=production` cần `SWAGGER_DOCS=1`.
  Image Docker đặt sẵn `NODE_ENV=production` nên trong image tài liệu API mặc định TẮT.
- Mô tả API nhúng trong `internal/server/apidocs/`, `tests/fixtures/registry.json` và `swagger-node.json` ĐÓNG BĂNG: không sinh lại
  (script sinh không còn trong repo), không sửa tay (mục 12.1); tài liệu route mới sinh từ `GoRoute`.
- Test trong `internal/server/wiring_test.go` (không cần database): `TestRegistryParity` (tên + quyền = `tests/fixtures/registry.json`),
  `TestRootRoutes`, `TestRestRoutes` (đủ 80 route, route ngoài bảng phải là route chỉ bản Go đã khai, chặn quyền như cổng rpc / theo `Perm`;
  route chỉ bản Go: token đủ quyền không bị middleware chặn),
  `TestGoRoutes` (module giả chỉ có trong test: khai + gắn 3 route chỉ bản Go, có trong tài liệu, chặn quyền; module khai sai bị bắt),
  `TestSelfAuthGoRoutes` (route `rpc.SelfAuth` không bị middleware QS chặn với mọi token QS; gắn nhầm `RequireLogin` bị bắt; tài liệu có 401 riêng),
  `TestSwaggerSpecNode` (phần cố định giống từng byte `swagger-node.json`; số thao tác REST = 80 + số route chỉ bản Go), `TestSwaggerEnabled`.
  `internal/server/rpc/rpc_test.go`: `TestRegisterGoRoute` (thứ tự, bản sao, panic khi trùng tên / route / tham số, field `path` không có trong `Path`, `Path` có `*`).
- Test có database dùng chung `qspro_gotest`: chạy `go test -race -count=1 -p 1 ./...` để các gói không chạy song song trên cùng database
  (chạy song song thỉnh thoảng lệch vì gói này thấy dòng tạm của gói kia).

### 12.1 Luật cho tính năng mới (ARCH, GOLDEN, migrate)

Mọi fixture / golden trong repo là dữ liệu đóng băng: KHÔNG sinh lại được (script sinh không còn trong repo).

**ARCH - tính năng mới:**

- KHÔNG thêm hàm `/api/:fn` (registry giữ đúng 80 hàm, `TestRegistryParity`), KHÔNG thêm dòng vào `RestRoutes` / `RootRoutes`.
- Tính năng mới là route REST "chỉ bản Go": module khai `reg.RegisterGoRoute(rpc.GoRoute{...})` trong `RegisterRPC` và gắn route gin
  cùng method + đường dẫn trong `RegisterRoutes`, middleware khớp `Perm` (`RequireLogin` / `RequireAdmin` / `RequireSuper` /
  `RequireAdminSuper`; `Public` không gắn; `SelfAuth` gắn middleware xác thực riêng của module, vd chat). Cách viết: `docs/API.md` mục 2.1.
  Tài liệu `/api-docs.json` tự sinh từ `GoRoute`.
- File tĩnh mới mà giao diện tải ở gốc: module cài `AssetModule` (`Assets() map[string][]byte`, nhúng bằng `go:embed`), như
  `categories` và `estimates`.
- Hàm rpc cũ chỉ được: thêm tham số TUỲ CHỌN ở CUỐI `args`; nối khoá MỚI vào CUỐI object kết quả. Không đổi tên, quyền, thứ tự tham số,
  kiểu kết quả, thông báo lỗi của nhánh cũ.
- KHÔNG sửa tay fixture / golden: `tests/fixtures/registry.json`, `swagger-node.json`, `internal/server/apidocs/*`, `tests/e2e/**`,
  mọi `testdata/*` đóng băng. Chỉ sửa MÃ test. Ngoại lệ: dữ liệu sinh bằng `scripts/gen-specs.js` (specs) và
  `quotations/testdata/gen-case.js` được sinh lại bằng chính script đó.

**GOLDEN - giữ golden đúng khi có thêm cột / khoá:**

- Cột mới chỉ ghi khi có giá trị (client gửi khoá / có dữ liệu), và ghi bằng một lệnh RIÊNG sau lệnh chính - nhờ vậy log ghi của các ca
  golden (không gửi khoá mới) giữ nguyên.
- Dòng đọc database và kết quả trả về vẫn có thể có khoá mới: mỗi gói test khai `goOnlyKeys` (danh sách khoá mới của gói, lấy từ
  bảng ở mục 10.4) và gọi `goonly.StripNull(v, goOnlyKeys...)` (ưu tiên: chỉ bỏ khoá null, khoá có giá trị vẫn bị so) hoặc
  `goonly.Strip(v, goOnlyKeys...)` trên kết quả / dòng đọc, `goonly.StripWrites(log, goOnlyKeys...)` trên log ghi
  (payload - cấp 1, hoặc phần tử mảng cấp 1 - chỉ còn khoá mới thì bỏ cả lệnh) TRƯỚC khi so với golden. Chỉ gọi trên phần dữ liệu thuộc PHẠM VI của khoá (cột 2 bảng 10.4):
  `Strip` bỏ khoá ở mọi cấp lồng, nên gọi trên dữ liệu lẫn bảng khác (vd `nguoi_duyet` của sản phẩm / đề xuất / công tác) sẽ che ca vỡ thật.
  Không che ca vỡ vì lý do khác.
- Thêm khoá mới: ghi vào bảng mục 10.4 (qua steward) cùng lúc với migration / thay đổi kết quả.

**Migrate trước khi chạy bản mới:**

- Server KHÔNG tự migrate. Thứ tự triển khai: `go run ./cmd/migrate --url=<database đích>` (từ `backend/`) -> khởi động bản server mới.
  Server đang chạy từ trước khi migrate phải khởi động lại để nạp lại danh mục cột.
- Lệnh ghi cột mới (lệnh riêng, ở trên) gặp `42703` (cột chưa có - database chưa migrate) thì ghi log và bỏ qua: thao tác chính
  (vd đổi trạng thái đơn, duyệt yêu cầu) vẫn thành công.

## Việc còn mở

Đã biết, chưa làm (hành vi đã chấp nhận nằm ở mục 10, không lặp lại ở đây):

- Nguồn gốc file seed `/tmp/qspro_seed.sql` (trong container `qspro-postgres`) CHƯA RÕ; bản sao bền đã có ở `infra/export/qspro_seed.sql`
  (cùng md5), chưa có script sinh.
- Job báo cáo tự động (`internal/jobs`) chưa có test đầu-cuối: chỉ chạy thứ 4 / thứ 7 sau 8h00 và chưa có đồng hồ tiêm vào được.
- Nhánh chỉ chạy khi database THIẾU CỘT (`nguoi_tao`, `nguoi_sua`, `nhom_bt`, `da_duyet`, `dung_sp_dezon`, `ui_prefs`, `phong_ban`, `perms`,
  lỗi thiếu cột của projects) chỉ có test thuần: cần một database dựng không có các migration đó.
- Giới hạn chưa có test chạm tới: `getProjects` 2000 dòng, `getProjData` 50 khoá mỗi nguồn, đếm user quá 1000 của `adminCreateUser`,
  cảnh báo danh mục 20000 dòng (`qscore.LIM`). Chưa tìm được đầu vào tới được: rollback giữa chừng của `duplicateProject`,
  nuốt lỗi tra email khi đăng nhập.
- Mã lặp: `files/express.go` và `categories/express.go` là hai bản giống nhau; `etagOf` còn chép ở materials / estimates / quotations handler.
- Bảng chữ hoa / thường của `categories/template.go`, `materials/service_upload.go`, `reports` (`jsLower`) chưa đối chiếu 27 cặp Unicode 16.
- Bộ nhớ khi đọc danh mục: mỗi request vẫn cấp phát khoảng 6 lần cỡ thân (mục 10.5); chưa có cache byte đã mã hoá.
- Truy vấn database và lúc nạp danh mục cột không có hạn thời gian; thêm hạn sẽ sinh lỗi mới mà hợp đồng đóng băng chưa có.
