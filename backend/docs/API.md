# API

Hai lối vào dùng chung một tầng service: cổng tương thích `POST /api/<tênHàm>` và REST `/api/v1`.

## 1. Cổng tương thích: `POST /api/<tênHàm>`

Giao diện cũ `public/` của app Node (đã gỡ khỏi repo) dùng lối này. Hành vi giữ đúng như `server/index.js`.

Request:

```
POST /api/getLines
Authorization: Bearer <token>          (hoặc "token" trong thân JSON, cạnh "args")
x-view-company: <id công ty>           (chỉ có tác dụng với super)
Content-Type: application/json

{"args": ["DA-001"]}
```

- `args` là mảng tham số theo đúng thứ tự của hàm Node (không tính actor).
- Token ở header được ưu tiên hơn `token` trong thân.

Response (luôn kèm header `x-app-ver`):

| Trường hợp | Mã | Thân |
|---|---|---|
| Thành công | 200 | `{"ok":true,"result":<giá trị>}` (hàm không trả gì -> `null`) |
| Tên hàm không có | 404 | `{"error":"Không hỗ trợ hàm: <tên>"}` |
| Chưa đăng nhập / token sai / tài khoản bị khoá / phiên đã đăng xuất hoặc bị thu hồi (M1.2) | 401 | `{"error":"Chưa đăng nhập","code":"NOAUTH"}` |
| Database chưa chạy migration 0014 (thiếu bảng phiên) và request có token | 500 | `{"error":"Cơ sở dữ liệu chưa có bảng \"user_sessions\" (phiên đăng nhập, migration 0014). Hãy chạy \"go run ./cmd/migrate\" rồi khởi động lại server."}` |
| Hàm chỉ Admin | 403 | `{"error":"Không có quyền (chỉ Admin)"}` |
| Hàm chỉ quản trị hệ thống | 403 | `{"error":"Chỉ quản trị hệ thống"}` |
| Hàm báo lỗi | 500 | `{"error":"<thông báo>"}` (không có thông báo -> `Lỗi máy chủ`) |
| Thân JSON hỏng | 400 | trang lỗi HTML kiểu Express (`Bad Request`) |
| Thân JSON quá 30 MB | 413 | trang lỗi HTML (`Payload Too Large`) |

Cổng này LUÔN trả 500 cho lỗi của hàm, kể cả khi service trả lỗi có mã 4xx.

### Phiên đăng nhập (M1.2)

Áp dụng như nhau cho `/api/<fn>`, `/api/v1` và route lẻ cần đăng nhập (`/export/*`, `/upload/file`).

- `login` mở một phiên (1 dòng bảng `user_sessions`, migration 0014) và trả token có thêm khoá `sid` (id phiên) trong payload.
  Token vẫn sống 7 ngày; phiên hết hạn cùng lúc.
- Mỗi request: token đúng chữ ký + chưa hết hạn + tài khoản / công ty còn mở + **phiên còn dòng và chưa quá hạn**. Kết quả giữ
  30 giây trong bộ nhớ của tiến trình (như trước), nhưng đăng xuất / đổi mật khẩu / admin đặt lại mật khẩu bỏ cache ngay trên
  tiến trình xử lý.
- `logout` xoá đúng phiên của token đang gửi: request kế tiếp bằng token đó -> 401 `NOAUTH`. Phiên ở máy / trình duyệt
  khác của cùng tài khoản vẫn chạy.
- `changePassword` thu hồi mọi phiên KHÁC của tài khoản; phiên đang dùng giữ nguyên.
- Khoá tài khoản / đổi vai trò / đổi công ty / xoá tài khoản: có hiệu lực ngay như trước (bỏ cache). Khoá KHÔNG xoá phiên:
  mở khoá lại thì token cũ dùng tiếp (giữ hành vi bản Node). Xoá tài khoản xoá luôn phiên (khoá ngoại `ON DELETE CASCADE`).
- Admin đặt lại mật khẩu (`adminSetPassword`, `PUT /users/:id/password`) thu hồi MỌI phiên của tài khoản đó (mật khẩu cũ có thể
  đã lộ: khoá -> đặt lại mật khẩu -> mở khoá thì token kẻ gian đang giữ không dùng tiếp được). Admin tự đặt lại cho chính mình
  thì giữ phiên đang dùng, các phiên khác bị thu hồi.
- Token phát trước 0014 (không có `sid`) bị từ chối: 401 `NOAUTH`, người dùng đăng nhập lại một lần sau khi nâng cấp.
- Chạy nhiều tiến trình server: tiến trình khác có thể còn nhận token đã đăng xuất tối đa 30 giây (cache cục bộ).
- Database chưa chạy 0014: đăng nhập và mọi request có token trả 500 kèm thông báo đích danh ở bảng trên (không phải 401 mù mờ).
  Phải chạy `go run ./cmd/migrate` TRƯỚC khi chạy bản server có M1.2.

### Lỗi giữa chừng (D-13)

Áp dụng như nhau cho `/api/<fn>` và route REST tương ứng. Khi thành công: kết quả và dữ liệu ghi giữ nguyên như trước. Khi lỗi:
lỗi trả về giữ nguyên, nhưng phần đã ghi của thao tác được huỷ (transaction), không còn dữ liệu dở dang.

- `sendPurchaseRequest` (bước lưu): mỗi đơn (phiếu + dòng hàng) ghi trọn hoặc không; đơn đã lưu trước đơn hỏng được xoá bù như cũ (lỗi xoá bị bỏ qua).
  Cả lần gửi nhiều đơn chưa nguyên tử: lệnh xoá bù hỏng thì các đơn trước vẫn còn, nhưng không còn phiếu thiếu dòng hàng.
- `sendDeXuat` (bước lưu): phiếu + dòng chiết khấu + đợt thanh toán ghi trọn hoặc không.
- `deleteProject`: 4 lệnh xoá ghi trọn hoặc không (lỗi xoá dữ liệu phụ của dự án vẫn bị bỏ qua như cũ).
- `duplicateProject`: lỗi -> không còn dự án bản sao dở.
- `saveCover`, `PUT /api/v1/projects/:id/cover`: lỗi -> tờ bìa giữ nguyên bản cũ (không còn cảnh bản cũ + bản mới cùng lúc).
- `createCongTy`: tạo tài khoản chủ lỗi -> công ty cũng không được tạo (bản Node để lại công ty mồ côi).
- `deleteCongTy`: lỗi -> dữ liệu các bảng của công ty không bị xoá dở (lỗi xoá từng bảng vẫn bị bỏ qua như cũ).
- `setCombo`, `setBienThe`, `deleteDbProduct`: phần ghi trọn hoặc không; lịch sử, nhật ký, xoá cache chạy sau khi lưu xong.
  Hai lời gọi `setBienThe` / `setCombo` cùng lúc gặp deadlock: 1 bên lưu, bên kia nhận lỗi "Có người khác đang sửa cùng các sản phẩm này..."
  (không thay đổi gì, máy chủ không tự chạy lại).

### Quyền của từng hàm (theo `server/index.js`)

- Không cần đăng nhập: `login`.
- Chỉ super: `listCongTy`, `createCongTy`, `deleteCongTy`, `listCongTyUsers`, `createCongTyUser`, `baoCaoNhapSP`.
- Chỉ admin (super cũng được): `adminListUsers`, `adminCreateUser`, `adminUpdateUser`, `adminSetPassword`, `adminSetActive`,
  `adminDeleteUser`, `getAuditLog`, `listDeleteRequests`, `resolveDeleteRequest`, `listPurchaseRequests`, `getPurchaseOrder`,
  `resolvePurchaseRequest`, `listDeXuat`, `getDeXuat`, `resolveDeXuat`, `deleteDbProduct`, `updateCongTy`.
- Còn lại: chỉ cần đăng nhập.

Danh sách hàm đang đăng ký trên server đang chạy: `Registry.Names()` (xem `internal/server/rpc`).
Tham số của từng hàm: `docs/PORTING_MAP.md` mục A, hoặc `GET /api-docs.json`.

## 2. REST: `/api/v1`

Chỉ bản Go có. Cùng cách xác thực (`Authorization: Bearer <token>`, `x-view-company`), cùng phong bì:

- thành công: `{"ok":true,"result":...}`
- lỗi: `{"error":"...","code":"..."}`; mã HTTP lấy từ lỗi của service (4xx nếu service đặt), lỗi thường là 500
- chưa đăng nhập 401 `{"error":"Chưa đăng nhập","code":"NOAUTH"}`; sai quyền 403 như cổng rpc
- mọi response REST (kể cả 401 / 403 và 404 khi đường dẫn `/api/v1/...` không có route) có header `x-app-ver`, cùng giá trị với cổng `/api/:fn` (`RENDER_GIT_COMMIT`, không đặt thì là thời điểm khởi động);
  giao diện React QS so giá trị này để nhắc "Đã có bản cập nhật mới" (M1.1). Khi bật `CORS_ORIGINS`, header nằm trong `Access-Control-Expose-Headers`

Mỗi route gọi đúng phương thức service mà hàm rpc tương ứng gọi, nên kết quả và quy tắc nghiệp vụ giống nhau.
Ngoại lệ: `PUT /projects/:id/cover` đổi lỗi chi phí âm thành 400 tiếng Việt (mục 2.1); rpc `saveCover` vẫn trả lỗi ràng buộc DB (500) như Node.

Quy ước truyền tham số:

- Tham số đường dẫn (`:id`, `:key`, `:code`, `:khoa`) ứng với các tham số ĐẦU của hàm rpc, theo thứ tự.
- Tham số còn lại: `GET` lấy từ query string, phương thức khác lấy từ thân JSON theo tên tham số
  (tên tham số từng hàm: `docs/PORTING_MAP.md` mục A; hàm nhận nguyên một object thì thân JSON chính là object đó).
- Phương thức dùng: `GET` đọc, `POST` tạo / thao tác, `PATCH` sửa một phần, `PUT` ghi đè một giá trị, `DELETE` xoá.

Bảng route đầy đủ (80 route, sinh từ `RestRoutes` trong `internal/server/rest.go`; quyền lấy từ `tests/fixtures/registry.json`).
Quyền `admin` nghĩa là admin hoặc super. Test `TestRestRoutes` buộc bảng trong `rest.go` khớp với route thật.

| Phương thức | Đường dẫn (sau `/api/v1`) | Hàm rpc | Quyền |
|---|---|---|---|
| `GET` | `/audit-log` | `getAuditLog` | admin |
| `POST` | `/auth/change-password` | `changePassword` | đăng nhập |
| `POST` | `/auth/login` | `login` | không cần đăng nhập |
| `POST` | `/auth/logout` | `logout` | đăng nhập |
| `GET` | `/auth/me` | `me` | đăng nhập |
| `PUT` | `/auth/me/prefs/:key` | `setMyPref` | đăng nhập |
| `GET` | `/bootstrap` | `bootstrap` | đăng nhập |
| `POST` | `/client-errors` | `logClientError` | đăng nhập |
| `GET` | `/companies` | `listCongTy` | super |
| `POST` | `/companies` | `createCongTy` | super |
| `DELETE` | `/companies/:id` | `deleteCongTy` | super |
| `PATCH` | `/companies/:id` | `updateCongTy` | admin |
| `GET` | `/companies/:id/users` | `listCongTyUsers` | super |
| `POST` | `/companies/:id/users` | `createCongTyUser` | super |
| `DELETE` | `/lines/:id` | `deleteLine` | đăng nhập |
| `PATCH` | `/lines/:id` | `updateLine` | đăng nhập |
| `POST` | `/lines/save-as-product` | `saveLineAsProduct` | đăng nhập |
| `GET` | `/notifications` | `notifList` | đăng nhập |
| `POST` | `/notifications/:id/read` | `notifRead` | đăng nhập |
| `POST` | `/notifications/read-all` | `notifReadAll` | đăng nhập |
| `GET` | `/notifications/unread-count` | `notifCount` | đăng nhập |
| `POST` | `/product-approvals` | `setSpDuyet` | đăng nhập |
| `GET` | `/product-delete-requests` | `listDeleteRequests` | admin |
| `POST` | `/product-delete-requests` | `requestDeleteProducts` | đăng nhập |
| `POST` | `/product-delete-requests/:id/resolve` | `resolveDeleteRequest` | admin |
| `POST` | `/product-favorites` | `setYeuThich` | đăng nhập |
| `POST` | `/product-imports/commit` | `importCommit` | đăng nhập |
| `POST` | `/product-imports/parse` | `importParse` | đăng nhập |
| `GET` | `/product-permissions` | `spMyPerms` | đăng nhập |
| `GET` | `/products` | `getProducts` | đăng nhập |
| `POST` | `/products` | `saveDbProduct` | đăng nhập |
| `DELETE` | `/products/:key` | `deleteDbProduct` | admin |
| `GET` | `/products/:key` | `getDbProduct` | đăng nhập |
| `PATCH` | `/products/:key` | `updateDbProductTracked` | đăng nhập |
| `GET` | `/products/:key/combo` | `getCombo` | đăng nhập |
| `PUT` | `/products/:key/combo` | `setCombo` | đăng nhập |
| `GET` | `/products/:key/history` | `getProductHistory` | đăng nhập |
| `GET` | `/products/:key/variants` | `getBienThe` | đăng nhập |
| `PUT` | `/products/:key/variants` | `setBienThe` | đăng nhập |
| `GET` | `/projects` | `getProjects` | đăng nhập |
| `POST` | `/projects` | `createProject` | đăng nhập |
| `DELETE` | `/projects/:id` | `deleteProject` | đăng nhập |
| `PATCH` | `/projects/:id` | `updateProject` | đăng nhập |
| `GET` | `/projects/:id/cover` | `getCoverOrInit` | đăng nhập |
| `PUT` | `/projects/:id/cover` | `saveCover` | đăng nhập |
| `GET` | `/projects/:id/cover/template` | `buildCoverFromTemplate` | đăng nhập |
| `GET` | `/projects/:id/data` | `getProjData` | đăng nhập |
| `PUT` | `/projects/:id/data/:khoa` | `setProjData` | đăng nhập |
| `POST` | `/projects/:id/duplicate` | `duplicateProject` | đăng nhập |
| `GET` | `/projects/:id/lines` | `getLines` | đăng nhập |
| `POST` | `/projects/:id/lines` | `addLine` | đăng nhập |
| `POST` | `/projects/:id/lines/blank` | `addBlankLine` | đăng nhập |
| `GET` | `/projects/:id/proposals` | `getDeXuatList` | đăng nhập |
| `GET` | `/projects/:id/purchase-orders` | `getPurchaseOrders` | đăng nhập |
| `POST` | `/projects/:id/quotation/export` | `exportBaoGia` | đăng nhập |
| `GET` | `/proposals` | `listDeXuat` | admin |
| `POST` | `/proposals` | `sendDeXuat` | đăng nhập |
| `GET` | `/proposals/:code` | `getDeXuat` | admin |
| `POST` | `/proposals/:code/resolve` | `resolveDeXuat` | admin |
| `GET` | `/purchase-orders` | `listPurchaseRequests` | admin |
| `POST` | `/purchase-orders` | `sendPurchaseRequest` | đăng nhập |
| `GET` | `/purchase-orders/:code` | `getPurchaseOrder` | admin |
| `POST` | `/purchase-orders/:code/resolve` | `resolvePurchaseRequest` | admin |
| `PATCH` | `/purchase-orders/:code/status` | `setPurchaseStatus` | đăng nhập |
| `POST` | `/reports/new-products` | `baoCaoNhapSP` | super |
| `POST` | `/uploads/files-base64` | `uploadFile` | đăng nhập |
| `POST` | `/uploads/images` | `uploadImage` | đăng nhập |
| `GET` | `/users` | `adminListUsers` | admin |
| `POST` | `/users` | `adminCreateUser` | admin |
| `DELETE` | `/users/:id` | `adminDeleteUser` | admin |
| `PATCH` | `/users/:id` | `adminUpdateUser` | admin |
| `PUT` | `/users/:id/active` | `adminSetActive` | admin |
| `PUT` | `/users/:id/password` | `adminSetPassword` | admin |
| `GET` | `/work-items` | `ctList` | đăng nhập |
| `POST` | `/work-items` | `ctSave` | đăng nhập |
| `PATCH` | `/work-items/:id` | `ctUpdate` | đăng nhập |
| `GET` | `/work-items/:id/history` | `ctHistory` | đăng nhập |
| `POST` | `/work-items/approval` | `ctDuyet` | đăng nhập |
| `POST` | `/work-items/delete` | `ctDelete` | đăng nhập |
| `POST` | `/work-items/favorites` | `ctFav` | đăng nhập |

Không có route `GET /projects/:id` (chi tiết một dự án): dùng `GET /bootstrap?maDA=` hoặc các route con của dự án.

### 2.1 REST chỉ bản Go

Từ khi gỡ app Node, tính năng mới KHÔNG thêm hàm `POST /api/<tênHàm>` (cổng rpc giữ đúng 80 hàm của Node, test
`TestRegistryParity` so với `tests/fixtures/registry.json`) và KHÔNG thêm dòng vào bảng `RestRoutes`. Tính năng mới là route REST
"chỉ bản Go" dưới `/api/v1`, do chính module khai ở hai chỗ:

1. Trong `RegisterRPC`: `reg.RegisterGoRoute(rpc.GoRoute{...})` - tên, method, đường dẫn, quyền, nhóm tài liệu, tham số.
   Trùng `Name`, trùng `Method + Path`, hoặc `Name` trùng một hàm rpc -> panic lúc khởi động.
2. Trong `RegisterRoutes`: route gin CÙNG method + đường dẫn, với middleware khớp `Perm`:

| `Perm` | Middleware | Chặn |
|---|---|---|
| `rpc.Login` | `middleware.RequireLogin()` | 401 `{"error":"Chưa đăng nhập","code":"NOAUTH"}` |
| `rpc.Admin` | `middleware.RequireAdmin()` | 401 như trên; nhân viên 403 `{"error":"Không có quyền (chỉ Admin)"}` |
| `rpc.Super` | `middleware.RequireSuper()` | 401 như trên; nhân viên / admin 403 `{"error":"Chỉ quản trị hệ thống"}` |
| `rpc.Admin\|rpc.Super` | `middleware.RequireAdminSuper()` | như `Admin` rồi `Super` |
| `rpc.Public` | (không gắn) | không chặn |

```go
// internal/modules/<tên>/handler.go
func (s *Service) RegisterRPC(reg *rpc.Registry) {
    // ... các reg.Register(...) cũ giữ nguyên ...
    reg.RegisterGoRoute(rpc.GoRoute{
        Name: "copySharedProduct", Method: "POST", Path: "/products/:key/private-copy", Perm: rpc.Login,
        Tag: "Sản phẩm", Summary: "Tạo bản sao riêng của sản phẩm kho chung Dezon cho công ty mình -> {ok, id, ma, ten}",
        Fields: []rpc.GoField{
            {Name: "key", In: "path", Type: "string", Required: true, Desc: "id dòng của sản phẩm trong kho chung Dezon"},
        },
    })
}

func (s *Service) RegisterRoutes(v1 *gin.RouterGroup) {
    v1.POST("/products/:key/private-copy", middleware.RequireLogin(), func(c *gin.Context) {
        r, err := s.CopySharedProduct(c.Request.Context(), actor.FromGin(c), c.Param("key"))
        response.Result(c, r, err)
    })
}
```

(Rút gọn từ route M10.1 thật, `internal/modules/materials/handler.go`: module gắn route trên nhóm `/products` của nó.)

- `GoField.In`: `path` | `query` | `body` (body = một khoá của thân JSON object); `Type` là kiểu OpenAPI, bỏ trống được.
  Tham số đường dẫn không khai trong `Fields` vẫn được ghi vào tài liệu (kiểu `string`); field `In: "path"` luôn bắt buộc
  (`Required` bỏ qua). `RegisterGoRoute` panic khi: field `path` không có `:ten` tương ứng trong `Path`, trùng cặp (`In`, `Name`),
  `Path` có đoạn `*` / `:` không tên / tham số trùng.
- Phong bì như mọi route REST: `{"ok":true,"result":...}` / `{"error":"...","code":"..."}` (dùng `response.Result` / `response.Fail`).
- Tài liệu `/api-docs.json` tự có thao tác của route: nhóm `REST - <Tag> (chỉ bản Go)` (`Tag` trống -> `Khác`),
  `operationId` = `v1go_<Name>`. Không sửa `internal/server/apidocs/*` (dữ liệu của Node, đóng băng).
- Test `TestRestRoutes` coi route `/api/v1` ngoài bảng `RestRoutes` là hợp lệ khi đã khai bằng `RegisterGoRoute`, và kiểm 401 / 403 theo `Perm`
  (người không đủ quyền bị chặn đúng thân; người đủ quyền KHÔNG bị middleware chặn - gắn middleware chặt hơn `Perm` cũng hỏng test);
  route gắn mà không khai, hoặc khai mà không gắn, đều làm test hỏng. Ca đủ quyền chạy handler thật với request đã huỷ context
  và server không có database: handler không được ghi gì ngoài database / dịch vụ ngoài khi đó.
- Hàm rpc cũ (80 hàm) chỉ được thêm tham số TUỲ CHỌN ở CUỐI `args`, hoặc nối khoá MỚI vào CUỐI object kết quả; không đổi tên, quyền,
  thứ tự tham số, kiểu kết quả của hàm cũ.
- Cột database mới: chạy `go run ./cmd/migrate` TRƯỚC khi chạy bản server mới (server không tự migrate). Lệnh ghi cột mới là lệnh RIÊNG,
  chạy sau lệnh chính; gặp lỗi `42703` (database chưa migrate) thì ghi log và bỏ qua, không làm hỏng thao tác chính.

Route chỉ bản Go hiện có (danh sách đầy đủ luôn ở `/api-docs.json`, nhóm `(chỉ bản Go)`):

| Method | Đường dẫn | `Name` | `Perm` | Module | Ý nghĩa |
|---|---|---|---|---|---|
| `GET` | `/my-proposals/:code` | `getMyDeXuat` | `rpc.Login` | purchasing | Chi tiết phiếu đề xuất của chính mình (M13.1) |
| `POST` | `/work-items/import/parse` | `ctImportParse` | `rpc.Login` | estimates | Đọc file nhập công tác -> `{rows, loi}` (M5.1) |
| `POST` | `/products/:key/private-copy` | `copySharedProduct` | `rpc.Login` | materials | Tạo bản sao riêng từ sản phẩm kho chung Dezon (M10.1) |
| `POST` | `/companies/expiry-reminders` | `nhacGiaHan` | `rpc.Super` | companies | Nhắc gia hạn công ty trong ứng dụng: chạy thử / gửi tay (M17.3) |
| `GET` | `/product-templates/dien-lanh` | `mauNhapDienLanh` | `rpc.Public` | categories | File mẫu nhập hàng loạt ngành Điện lạnh (`?hm=` hạng mục); route gốc `/mau-nhap-*.xlsx` đóng băng theo bản Node nên ngành mới đi dưới `/api/v1` |
| `GET` | `/sales/leads` | `kdListLeads` | `rpc.Login` | sales | Danh sách khách hàng Kinh doanh, kèm `quote` = tổng báo giá QS nếu đã gắn dự án |
| `POST` | `/sales/leads` | `kdCreateLead` | `rpc.Login` | sales | Thêm khách hàng |
| `PATCH` | `/sales/leads/:id` | `kdUpdateLead` | `rpc.Login` | sales | Sửa 1 phần (kéo-thả giai đoạn, bảng con, người phụ trách, form) |
| `DELETE` | `/sales/leads/:id` | `kdDeleteLead` | `rpc.Login` | sales | Xoá khách hàng + lịch sử chăm sóc |
| `GET` | `/sales/leads/:id/activities` | `kdListActivities` | `rpc.Login` | sales | Lịch sử chăm sóc |
| `POST` | `/sales/leads/:id/activities` | `kdAddActivity` | `rpc.Login` | sales | Ghi 1 lần chăm sóc |
| `GET` | `/delivery/projects` | `tkListProjects` | `rpc.Login` | delivery | Dự án theo `?kind=design|construction`, kèm `progress`, `taskCount`, `members` |
| `POST` | `/delivery/projects` | `tkCreateProject` | `rpc.Login` | delivery | Tạo dự án bằng tay |
| `GET` | `/delivery/projects/:id` | `tkGetProject` | `rpc.Login` | delivery | Chi tiết: thành viên, thầu phụ, giai đoạn + công việc, bình luận theo công việc |
| `PATCH` | `/delivery/projects/:id` | `tkUpdateProject` | `rpc.Login` | delivery | Sửa thông tin dự án |
| `DELETE` | `/delivery/projects/:id` | `tkDeleteProject` | `rpc.Login` | delivery | Xoá dự án + mọi dữ liệu con |
| `POST / DELETE` | `/delivery/projects/:id/members[/:itemId]` | `tkAddMember / tkRemoveMember` | `rpc.Login` | delivery | Thành viên |
| `POST / PATCH / DELETE` | `/delivery/projects/:id/subcontractors[/:itemId]` | `tkAddSubcontractor / tkUpdateSubcontractor / tkRemoveSubcontractor` | `rpc.Login` | delivery | Thầu phụ |
| `POST / PATCH / DELETE` | `/delivery/projects/:id/phases[/:itemId]` | `tkAddPhase / tkUpdatePhase / tkRemovePhase` | `rpc.Login` | delivery | Đề mục tiến độ (xoá kéo theo công việc) |
| `POST / PATCH / DELETE` | `/delivery/projects/:id/tasks[/:itemId]` | `tkAddTask / tkUpdateTask / tkRemoveTask` | `rpc.Login` | delivery | Công việc / cột mốc / mốc thu chi |
| `POST` | `/delivery/projects/:id/tasks/:itemId/comments` | `tkAddComment` | `rpc.Login` | delivery | Bình luận công việc |

Kinh doanh (`sales`) và dự án triển khai (`delivery`, trang Quản lý thiết kế / Quản lý dự án), migration 0015-0016:
- Route chỉ cần đăng nhập; quyền kiểm trong service như `canTab` của giao diện: super phải gửi `x-view-company` (không thì 400),
  công ty có `tinh_nang` mà thiếu tab -> 403, admin được, nhân viên cần tab trong `perms`: `kinhdoanh` (sales), `thietke` (`kind=design`),
  `thicong` (`kind=construction`). Route theo `:id` dự án kiểm quyền theo `kind` của chính dự án đó.
- Dòng con (`:itemId`) phải thuộc đúng dự án `:id`, không thì 404. Dữ liệu công ty khác: 404 (lớp dữ liệu lọc theo công ty).
- Kéo khách sang giai đoạn `thiet-ke` / `thi-cong` (tạo hoặc sửa) tự tạo dự án `design` / `construction` (1 lần / khách / loại),
  chép tên, khách, liên hệ, loại công trình, mã dự án QS và giá trị (tổng báo giá QS nếu đã gắn), trong cùng transaction với lệnh sửa khách.
- Tiền gửi / trả bằng đồng (`valueVnd`, `contractValueVnd`, `amountVnd`); ngày dạng `yyyy-mm-dd`.

`GET /my-proposals/:code` (tag "Mua hàng"):
- admin / super: như `GET /proposals/:code` (`getDeXuat`) - mọi phiếu của công ty; không có -> `Không tìm thấy đề xuất`.
- người khác: chỉ phiếu có `requester_id` = uid của phiên; không có HOẶC của người khác -> `Không tìm thấy phiếu` (cùng một câu, không lộ
  phiếu của người khác có tồn tại). Lỗi nghiệp vụ trả HTTP 500 như mọi lỗi `apperr` khác, không phải 404.
- Kết quả = đúng object của `getDeXuat` (đầu phiếu + `items`). `GET /proposals/:code` vẫn chỉ Admin (nhân viên 403).

`POST /work-items/import/parse` (tag "Công tác"): quyền như `ctSave` (`spPerms.edit`, không có -> `Tài khoản không có quyền thêm dữ liệu`,
HTTP 500 như `ctSave`). Thân `{base64: string (bắt buộc), ext: "xlsx" | "csv" (mặc định xlsx)}` -> `{rows: [...], loi: [{dong, msg, ten, row}]}`.
Máy chủ KHÔNG ghi gì; lưu vẫn qua `POST /work-items` (`ctSave`).
- Chỉ đọc sheet đầu (`qscore.SheetRows`, cùng bộ đọc với `importParse`). Dòng tiêu đề tìm trong 15 dòng đầu, so không phân biệt hoa thường
  và khoảng trắng (chuẩn hoá NFC). 16 cột của file mẫu `/mau-nhap-cong-tac.xlsx`: Nội dung công việc->`ten`, Hạng mục->`hangMuc`,
  Số hạng mục->`maNhom`, Loại báo giá->`loai`, Cách tính->`mode`, ĐVT->`dvt`, Khối lượng->`kl`, Diện tích->`dt`, Hệ số->`hs`,
  Nhà thầu->`ncc`, Giá bán lẻ->`dg`, Đơn giá nhà thầu->`dgnt`, Ghi chú->`gc`, Thông số kỹ thuật->`thongSo`, Phạm vi ứng dụng->`phamVi`,
  Ảnh->`hinhAnh`. Cột "Thứ tự"->`thuTu` tuỳ chọn (file mẫu không có): số nguyên ≥ 0, sai thì vào `loi`.
- Loại báo giá: Khái toán chi tiết / Khái toán sơ bộ / Dự toán · Nhân công / Dự toán · Vật tư; Cách tính: Khối lượng × đơn giá /
  Diện tích × hệ số / Chỉ tính khối lượng / Chỉ liệt kê. Hai cột này cũng nhận thẳng mã (`kt_chitiet`, `item`...). Ô trống ->
  `kt_chitiet` / `item`. Nhãn lạ -> `loi`, trường đó để trống trong `row`.
- Bỏ qua: dòng không có tên, dòng có cột A bắt đầu "Ghi chú:" mà các ô khác trống (dòng 5 của file mẫu). Thiếu Hạng mục -> `loi`.
  Tối đa 2000 công tác; quá số đó thêm 1 `loi` không kèm `row`.
- Số (`kl`, `dt`, `hs`, `dg`, `dgnt`): ô số của xlsx giữ nguyên; chuỗi (mọi ô CSV, ô chữ xlsx) đọc kiểu VN như form (`qscore.N`):
  `"450.000"` = 450000, `"1.234,5"` = 1234.5; bỏ khoảng trắng và đuôi đ / ₫ / vnđ / vnd; `1.2E+03` đọc như số JS; ô trống -> `""`.
  Chữ khác -> `"<Tiêu đề cột> 'abc' không phải số"`; số âm -> `"<Tiêu đề cột> '-5' không được âm"` (ràng buộc `ck_work_items_* >= 0`); ô sai
  để `""` trong `row`.
- `dong` = số dòng thật trong file, tính cả dòng trống xen giữa (xlsx: `<row r>` của sheet đầu; CSV: đếm cả dòng trống và ô xuống dòng
  trong ngoặc kép).
- Lỗi file trả HTTP 400: `Chưa có nội dung file`, `Không tìm thấy dòng tiêu đề có cột 'Nội dung công việc' - hãy dùng file mẫu`,
  `File không có sheet dữ liệu`, `Không đọc được file Excel (.xlsx) - file hỏng hoặc không phải .xlsx. ...`, `Không đọc được file CSV - ...`.

`POST /products/:key/private-copy` (tag "Sản phẩm", `materials/service_private_copy.go` `CopySharedProduct`). Thân: không có (bỏ qua).
Kết quả `{ok: true, id, ma, ten}` (`id` = id dòng mới). Lỗi nghiệp vụ trả HTTP 500 `{error}` như mọi lỗi `apperr.New` của module.
- `:key` = id dòng (toàn chữ số) của sản phẩm trong kho chung Dezon (`recordId` của dòng `spChung` trong `GET /products`). Mã SP không dùng
  làm khoá (nhiều biến thể cùng mã); khoá không phải số -> `Không tìm thấy sản phẩm trong kho chung`.
- Quyền = `canTab('sanpham')` của giao diện, làm lại ở máy chủ (GIẢ ĐỊNH M10.1): super được; công ty có danh sách tính năng (`tinh_nang`)
  mà thiếu `sanpham` -> không ai được (kể cả admin); admin được; nhân viên cần `SpPerms.edit` VÀ tab `sanpham` trong perms. Không đủ ->
  `Tài khoản không có quyền thêm dữ liệu`. Điều kiện này chỉ có ở route này: `createProductGated` / `importGated` / `updateProductGated`
  không xét tab hay tính năng.
- Công ty hiện hành không bật `dung_sp_dezon` / chính là Dezon / super không xem công ty nào -> `Công ty chưa được dùng kho chung Dezon`.
- Đọc `db_san_pham` (noScope) `id=:key` và `cong_ty_id` = id Dezon; không có -> `Không tìm thấy sản phẩm trong kho chung`.
- Dòng mới chép mọi cột có giá trị TRỪ `id`, `cong_ty_id`, `da_duyet`, `nguoi_duyet`, `ngay_duyet`, `nguoi_tao`, `ngay_tao`, `nguoi_sua`,
  `ngay_cap_nhat`, `nhom_bt`, `gia_dai_ly` (cột sinh); công ty = công ty hiện hành, `da_duyet` mặc định false (Chưa duyệt), `nguoi_tao` /
  `ngay_tao` = người chép (như `SaveDbProduct`, cùng nhánh thiếu cột). Không chép combo, biến thể (`nhom_bt`), yêu thích.
- Trùng mã SP + trục biến thể (`nhiet_do_mau_k`, `cong_suat_w`, `goc_chieu_deg`, `mau_sac`, thêm `kich_thuoc` khi ngành vs / son hoặc có
  `kich_thuoc`; ngành trống thì suy từ hạng mục như `SaveDbProduct`; `''` = null) trong công ty hiện hành -> `Công ty bạn đã có sản phẩm mã <mã>`,
  không ghi gì. Hai yêu cầu cùng qua phép kiểm thì lần chèn sau vấp unique index (23505) và trả đúng câu đó. SP kho chung không có mã thì
  không kiểm trùng.
- Ghi thêm: lịch sử `db_san_pham_history` trường `SAO CHÉP TỪ KHO DEZON` (`<tên> (từ SP #<key> kho Dezon) (bởi <user>)`); nhật ký
  `sao_chep_sp_dezon`; xoá cache danh mục. Sau đó `GET /products` của công ty trả bản riêng và ẩn dòng kho chung trùng ĐỦ khoá kiểm trùng ở
  trên (khác Node, `ARCHITECTURE.md` mục 10.4). Bản sao sửa / xoá / duyệt như sản phẩm thường.

`POST /companies/expiry-reminders` (tag "Công ty", `companies/expiry.go`; không có hàm `/api/:fn` tương ứng, parity 80 hàm giữ nguyên):
- Thân `{dryRun?: boolean}`. CHỈ gửi thật khi `dryRun === false` (boolean); thiếu `dryRun`, thân rỗng / `{}` / không phải object, hay
  giá trị khác (vd chuỗi `"false"`) = CHẠY THỬ: không gửi, không ghi gì.
- Quét mọi công ty `active` khác false có `han_dung` trong [hôm nay, hôm nay + 30] (giờ VN), không giới hạn số dòng.
- Kết quả `{dryRun, ngay: "YYYY-MM-DD" (giờ VN), soCongTy (số công ty tới mốc chưa nhắc), soThongBao (số thông báo đã gửi),
  ds: [{id, ten, hanDung, conLai, moc, mocCu, soAdmin, canGui, daGui, loi?}]}`, `ds` sắp theo `conLai` tăng dần. `mocCu` null khi chưa nhắc
  hoặc giá trị cũ ngoài tập {30,14,7,3,1,0}. `loi` có thể là `Không gửi được thông báo: ...` (mốc đã được trả lại, lần sau gửi lại),
  `Chỉ gửi được k/n admin: ...` (giữ mốc), `Không ghi được mốc, chưa gửi: ...`, `Không đọc được danh sách admin`.
- Thông báo kind `expiry_notice` cho mỗi admin đang hoạt động (role admin, active) của công ty: tiêu đề `Công ty sắp hết hạn sử dụng`
  (ngày 0: `Công ty hết hạn hôm nay`), thân `Gói của <tên> hết hạn ngày dd/mm/yyyy (còn N ngày). Liên hệ quản trị hệ thống để gia hạn.`,
  `refId` = id công ty. Nhật ký `audit_log` action `nhac_gia_han` (công ty = công ty được nhắc).
- Job nền gọi cùng hàm lúc 8h05 giờ VN mỗi ngày (`ARCHITECTURE.md` mục 10.4).

Tham số / kiểm tra mới trên route cũ (chỉ bản Go; chi tiết ở `ARCHITECTURE.md` mục 10.4):

- `PATCH /users/:id` (`adminUpdateUser`): khoá thân `email` (tuỳ chọn). Trùng email đang lưu (trim + chữ thường) = không đổi, không ghi.
  Đổi: trim + chữ thường; `""` / null = xoá; sai dạng -> `Email không hợp lệ`; trùng tài khoản khác cùng công ty ->
  `Email đã dùng cho tài khoản khác trong công ty`. `POST /users` (`adminCreateUser`) không đổi.
- `POST /companies`, `PATCH /companies/:id` (`createCongTy`, `updateCongTy`): `mauChinh` khác null phải là `""`, `#RGB` hoặc `#RRGGBB`,
  khác -> `Màu chính phải dạng #RRGGBB`. `createCongTy` không lưu màu (như Node): lưu bằng `updateCongTy` sau khi tạo.
- `PATCH /companies/:id` (`updateCongTy`), M17.3: patch có `hanDung` thì đọc `cong_ty` trước khi update (lỗi đọc bỏ qua); super đổi `hanDung`
  sang ngày khác thì một lệnh RIÊNG đặt `nhac_moc` = `nhac_lan_cuoi` = NULL (chỉ khi đang khác null; lỗi chỉ ghi log). Kết quả trả về và
  nhật ký không đổi.
- `POST /product-delete-requests` (`requestDeleteProducts`): khoá thân `lyDo` (rpc args[1]), tuỳ chọn. Trim; rỗng / thiếu / không phải chuỗi
  = không ghi gì (lệnh chèn y như Node). Có chữ: ghi `delete_requests.note` trong CÙNG lệnh chèn và nối `": <lyDo>"` vào thông báo gửi admin.
  > 500 ký tự (đếm theo ký tự Unicode) -> `Lý do tối đa 500 ký tự`.
- `POST /product-delete-requests/:id/resolve` (`resolveDeleteRequest`): khoá thân `lyDo` (rpc args[2]), tuỳ chọn, chỉ dùng khi
  `approve = false`. Có chữ: lệnh RIÊNG (sau lệnh giành quyền) ghi `resolution_note`, lỗi lệnh này (vd 42703 khi chưa chạy 0010) chỉ ghi
  log; nối `": <lyDo>"` vào thông báo `delete_rejected`. Kiểm độ dài như trên, TRƯỚC khi giành quyền.
- `GET /product-delete-requests` (`listDeleteRequests`): mỗi dòng nối cuối `lyDo` (cột `note`), `lyDoTuChoi` (cột `resolution_note`).
- `POST /purchase-orders/:code/resolve` (`resolvePurchaseRequest`): sau khi đổi trạng thái thành công, lệnh RIÊNG ghi `nguoi_duyet`
  (ho_ten || username của người duyệt; không đọc được tài khoản -> username của phiên) + `ngay_duyet` (ISO). Lỗi chỉ ghi log
  `[mua hàng] ghi người duyệt lỗi: ...`, việc duyệt vẫn trả `{ok:true}`.
- `POST /purchase-orders` (`sendPurchaseRequest`): sau khi gửi thẻ Lark, lệnh RIÊNG ghi `ket_qua_gui` = `"ok"` (lark = true) / `"loi"`
  (webhook lỗi, không có URL, thẻ không dựng được) cho MỌI mã vừa lưu (đè `"pending"` mặc định hoặc `ketQua` client gửi). Lỗi chỉ ghi log
  `[mua hàng] ghi kết quả gửi Lark lỗi: ...`. Kết quả trả về không đổi.
- Khoá kết quả mới (nối CUỐI object): `getPurchaseOrders` (`GET /projects/:id/purchase-orders`) `nguoiDuyet`, `ngayDuyet`, `ketQuaGui`
  (chuỗi, `""` khi null); `getPurchaseOrder` (`GET /purchase-orders/:code`) `kenhGui`, `ketQuaGui`; `listPurchaseRequests`
  (`GET /purchase-orders`) `resolver`, `resolvedAt` (nguyên dạng, null khi chưa duyệt).
- `POST /projects/:id/quotation/export` (`exportBaoGia`): khoá thân `opts` (tuỳ chọn; rpc: tham số thứ 9, 8 tham số cũ giữ nguyên thứ tự):
  `{coverMau: 'm1'|'m2', org: {ten, logo, lines: [string]}, tongKet: {ngay: 'dd/mm/yyyy', hieuLuc: số ngày, dot: [{noiDung, pct, soTien}],
  ghiChu: [string], nguoi}}`. Client dựng mọi chữ / số bằng đúng hàm của bản xem trước (`bgOrg_`, `bgTongKetData_` trong `lib/quote.js`);
  máy chủ chỉ in, không tính lại. Có `opts`: tờ bìa có tên + dòng địa chỉ / liên hệ công ty (logo nhúng nếu tải được PNG/JPG qua http(s)
  hoặc `/media?token=`; SVG, địa chỉ nội bộ, `data:` -> bỏ, không lỗi), dòng "Hiện trạng" (nhiều dòng giữ xuống dòng), Mẫu 1 khi
  `coverMau='m1'` (6 cột NO | HẠNG MỤC | NỘI DUNG | CHI PHÍ DỰ KIẾN | TỶ TRỌNG | MÔ TẢ, ô NO / HẠNG MỤC gộp dọc theo mục lớn);
  `cols[i].w` (px) -> bề rộng cột sheet chi tiết (px/7); sheet "Tổng cộng" thêm "Ngày báo giá · Hiệu lực", TIẾN ĐỘ THANH TOÁN, GHI CHÚ &
  ĐIỀU KHOẢN, Người lập. Giới hạn: chuỗi ≤ 500 ký tự, ≤ 10 dòng công ty, ≤ 20 đợt, ≤ 30 ghi chú, w ≤ 2000 px. Không có `opts` (thiếu / null /
  không phải object): file giống TỪNG BYTE như trước (`w` trong `cols` bị bỏ qua như Node).
- `PUT /projects/:id/cover` (`saveCover`): dòng có `chiPhi` < 0 -> HTTP 400 `Chi phí dự kiến không được âm (mục <stt>).`
  (`(dòng <n>)` khi thiếu stt), không ghi gì. Chỉ route REST; rpc `saveCover` giữ lỗi ràng buộc của DB như Node (golden `save-neg`).
  Đổi lỗi SAU khi gọi `saveCover` (lỗi ràng buộc `ck_cost_estimate_lines_cost` -> 400) nên thứ tự kiểm giống rpc: dự án không tồn tại /
  khác công ty vẫn báo `Bản nháp không còn tồn tại...` trước, kể cả khi có chi phí âm.
- Object dự án (`getProjects`, `getProject`, `createProject`, `updateProject`, `duplicateProject`, `bootstrap.projects`, REST `/projects*`):
  nối cuối khoá `hienTrang` (cột `projects.current_condition`, migration 0011). `updateProject` chỉ ghi khi client gửi khoá `hienTrang`
  (kể cả rỗng); `createProject` ghi khi khác rỗng.

Tài liệu Swagger của 80 route cũ là dữ liệu Node đóng băng nên KHÔNG ghi các khoá mới này.

## 3. Route khác

Route lẻ của nghiệp vụ (giữ nguyên đường dẫn của bản Node, bảng `RootRoutes` trong `rest.go`):

| Route | Đăng nhập | Ý nghĩa |
|---|---|---|
| `GET /media?token=` | không | tải ảnh cũ từ Lark |
| `POST /export/cong-tac` | có | xuất Excel công tác (header `X-Row-Count`) |
| `POST /export/san-pham` | có | xuất Excel sản phẩm (header `X-Row-Count`) |
| `POST /export/bang` | có | xuất Excel một bảng bất kỳ |
| `POST /upload/file` | có | tải file lên kho (tối đa 50 MB) |
| `GET /mau-nhap-thiet-bi-ve-sinh.xlsx` | không | file mẫu nhập thiết bị vệ sinh |
| `GET /mau-nhap-cong-tac-o-cam.xlsx` | không | file mẫu nhập công tắc - ổ cắm |
| `GET /mau-nhap-son-nuoc.xlsx` | không | file mẫu nhập sơn nước |
| `GET /healthz` | không | `{"ok":true}` |

Route lẻ cần đăng nhập nhận token ở header hoặc `token` trong thân; thiếu thì trả 401 `{"error":"Chưa đăng nhập"}` (không có `code`).
Token đã đăng xuất / bị thu hồi cũng 401 như vậy (kiểm phiên như mục 1, M1.2).

Tài liệu API (Swagger), bật / tắt như bản Node: `SWAGGER_DOCS=0` tắt; `NODE_ENV=production` thì cần `SWAGGER_DOCS=1` mới bật.
Image Docker đặt sẵn `NODE_ENV=production`, nên trong image các route dưới đây trả 404 cho tới khi đặt `SWAGGER_DOCS=1`.
| Route | Ý nghĩa |
|---|---|
| `GET /api-docs.json` | spec OpenAPI: phần của Node (80 path `/api/<fn>` + 9 route lẻ) cộng 80 thao tác REST `/api/v1` và thao tác của các route chỉ bản Go (mục 2.1) |
| `/api-docs` | chuyển hướng 301 sang `/api-docs/` |
| `/api-docs/*` | Swagger UI nhúng sẵn (không gọi CDN); `*/package.json` trả 404 `Not Found` |

`/api-docs` và mọi đường dẫn con trả lời MỌI phương thức và không phân biệt hoa thường, như `app.use('/api-docs', ...)` của bản Node.

Giao diện:

| Route | Ý nghĩa |
|---|---|
| `GET /vs-spec.js`, `/son-spec.js`, `/ct-spec.js` | spec ngành (UMD) nhúng trong binary, `application/javascript; charset=UTF-8`, `Cache-Control: no-cache`; không cần đăng nhập |
| `GET /logo.svg` | logo mặc định nhúng trong binary, `image/svg+xml`, `Cache-Control: public, max-age=0` |
| `GET /mau-nhap-hang-loat.xlsx` | file mẫu nhập hàng loạt sản phẩm nhúng trong binary, `Cache-Control: public, max-age=0` |
| `GET /mau-nhap-cong-tac.xlsx` | file mẫu nhập công tác (Phần thô) nhúng trong binary (module estimates), `Cache-Control: public, max-age=0` |
| `GET /` và file trong `STATIC_DIR` | TUỲ CHỌN (chỉ khi đặt `STATIC_DIR`): giao diện cũ (HTML / JS / CSS luôn `Cache-Control: no-cache`) |
| `GET /vendor/jspreadsheet/*`, `/vendor/formula/*`, `/vendor/jsuites/*` | TUỲ CHỌN (chỉ khi đặt `STATIC_DIR`): thư viện bảng tính lấy từ `VENDOR_DIR`, cache 7 ngày |

File nhúng trả như `express.static` trước đây: GET / HEAD, `Accept-Ranges: bytes`, ETag yếu theo nội dung (gửi lại `If-None-Match` -> 304), không có `Last-Modified`.

## 4. Lỗi chung cho mọi route

| Trường hợp | Mã | Thân |
|---|---|---|
| Đường dẫn không có (kể cả dưới `/api/v1`) hoặc sai phương thức | 404 | trang HTML kiểu Express: `Cannot <METHOD> <đường dẫn>` |
| Thân JSON quá 30 MB gửi tới `/upload/file` | 413 | JSON `{"error":"File quá lớn (tối đa 50MB) — hãy dán link thay vì tải lên."}` (giống bản Node từng byte) |
| Thân JSON quá 30 MB gửi tới route khác | 413 | trang HTML `Payload Too Large` |
| `Content-Encoding` hoặc charset không hỗ trợ | 415 | trang HTML `Unsupported Media Type` |
| Vượt giới hạn tần suất (chỉ khi đặt `RATE_LIMIT_RPS` > 0) | 429 | `{"error":"Quá nhiều yêu cầu, vui lòng thử lại sau"}` + header `Retry-After: 1` |
| Panic ngoài cổng rpc | 500 | trang HTML `Internal Server Error` |

Khớp đường dẫn như Express 4: `HEAD` dùng handler của `GET`; phần cố định không phân biệt hoa thường; cho phép thừa một dấu `/` cuối.
