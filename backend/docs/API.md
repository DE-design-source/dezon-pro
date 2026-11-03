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
| `rpc.SelfAuth` | middleware RIÊNG của module (chat: `requireChat()`), không dùng phiên QS | module tự trả 401 (chat: `{"error":"Phiên chat đã hết, mời đăng nhập lại","code":"CHAT_NOAUTH"}`) |

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
  Route `rpc.SelfAuth`: test chỉ đòi route có thật và KHÔNG trả thân chặn của QS với mọi loại token QS (không token, nhân viên, admin,
  super); gắn nhầm `RequireLogin` cũng bị bắt (`TestSelfAuthGoRoutes`). `reg.Register` (cổng `/api/:fn`) với `SelfAuth` -> panic lúc khởi động.
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
| (nhiều) | `/chat/...` (36 route, kể cả `GET /chat/ws` và 4 route `/chat/media/...`) | `chat*` | `rpc.Public` (3 route đăng nhập) / `rpc.SelfAuth` (33) | chat | Chat MVP + tệp đính kèm: mục "Chat" ngay dưới |

Kinh doanh (`sales`) và dự án triển khai (`delivery`, trang Quản lý thiết kế / Quản lý dự án), migration 0015-0016:
- Route chỉ cần đăng nhập; quyền kiểm trong service như `canTab` của giao diện: super phải gửi `x-view-company` (không thì 400),
  công ty có `tinh_nang` mà thiếu tab -> 403, admin được, nhân viên cần tab trong `perms`: `kinhdoanh` (sales), `thietke` (`kind=design`),
  `thicong` (`kind=construction`). Route theo `:id` dự án kiểm quyền theo `kind` của chính dự án đó.
- Dòng con (`:itemId`) phải thuộc đúng dự án `:id`, không thì 404. Dữ liệu công ty khác: 404 (lớp dữ liệu lọc theo công ty).
- Kéo khách sang giai đoạn `thiet-ke` / `thi-cong` (tạo hoặc sửa) tự tạo dự án `design` / `construction` (1 lần / khách / loại),
  chép tên, khách, liên hệ, loại công trình, mã dự án QS và giá trị (tổng báo giá QS nếu đã gắn), trong cùng transaction với lệnh sửa khách.
- Tiền gửi / trả bằng đồng (`valueVnd`, `contractValueVnd`, `amountVnd`); ngày dạng `yyyy-mm-dd`.

#### Chat (`/api/v1/chat`, module `chat`, migration 0018 - 0023)

Chat MVP theo `backend/CHAT.md`: tài khoản riêng theo số điện thoại HOẶC email (bảng `chat_users`; tài khoản email không có số và ngược
lại, chưa liên kết hai loại), KHÔNG phải phiên QS, không theo công ty (`x-view-company` không có tác dụng). Lý do thiết kế:
`docs/02-ky-thuat/database/decisions.md` D-15, D-16; ảnh / video / tệp / tin thoại (migration 0020, bảng `chat_media`): D-17 và
mục "Tệp đính kèm" bên dưới.
- Khoá JSON `snake_case` như CHAT.md mục 5; phong bì như mọi route REST; mọi response có `Cache-Control: no-store`. Thời điểm là chuỗi
  RFC3339 UTC có mili giây (`2026-10-30T03:04:05.123Z`).
- Thân phải là JSON object (tối đa 1 MB), hỏng / sai kiểu -> 400 `BAD_REQUEST`. Lỗi database -> 500 `{"error":"Lỗi máy chủ","code":"INTERNAL"}`
  (chi tiết chỉ ghi log).

**Token.** Gửi `Authorization: Bearer <access_token>`.

| Token | Dạng | Hạn | Phía máy chủ |
|---|---|---|---|
| access | JWT HS256 `{"sub":"<user id>","did":<device id>,"typ":"chat","iat","exp"}`; chỉ nhận `alg` = HS256 | `CHAT_ACCESS_TTL_MIN` (mặc định 15 phút) | không lưu; ký bằng `CHAT_JWT_SECRET` (trống = suy từ `AUTH_SECRET`) |
| refresh | 32 byte ngẫu nhiên, base64url | `CHAT_REFRESH_TTL_DAYS` (mặc định 30 ngày) | sha256 hex trong `chat_refresh_tokens`, gắn với 1 thiết bị |

- Middleware chat kiểm chữ ký, `typ`, `exp` và thiết bị còn tồn tại (cache 30 giây, bỏ ngay khi đăng xuất / thu hồi); sai -> 401 `CHAT_NOAUTH`.
  Middleware QS bỏ qua token chat (token QS dạng `body.sig`, JWT 3 đoạn không bao giờ khớp, không đọc database); token QS gửi vào route chat -> 401 `CHAT_NOAUTH`.
- Refresh xoay vòng: mỗi lần đổi, token cũ được đánh dấu đã dùng và cặp mới được cấp. Trình lại token đã dùng dưới 30 giây -> 409
  `REFRESH_RACE` (hai tab refresh cùng lúc: đọc lại token đã lưu, không thu hồi); cũ hơn -> xoá thiết bị (mọi token, push token, đóng
  WebSocket bằng `force_logout`) -> 401 `REFRESH_REUSED`. Token lạ / hết hạn -> 401 `REFRESH_INVALID`.

**Route** (đường dẫn tính từ `/api/v1/chat`; `Name` là `operationId` `v1go_<Name>` trong `/api-docs.json`, nhóm `REST - Chat (chỉ bản Go)`):

| Method | Đường dẫn | `Name` | Quyền | Thân / query -> kết quả |
|---|---|---|---|---|
| `POST` | `/auth/otp/request` | `chatOtpRequest` | Public | `{phone}` hoặc `{email}` -> `{phone?, email?, expires_in: 300, resend_after: 60, dev_code?}` (đúng một trong `phone` / `email`, đã chuẩn hoá); `dev_code` chỉ khi `CHAT_OTP_DEV=1`. Có `email` -> gửi mã qua SMTP (chưa đặt `SMTP_HOST` thì ghi log); gửi cả hai -> 400 `BAD_REQUEST` |
| `POST` | `/auth/otp/verify` | `chatOtpVerify` | Public | `{phone \| email, otp, device: {platform, name}, display_name?}` -> `{access_token, refresh_token, expires_in, device_id, user: Me, is_new}`; số / email chưa có tài khoản thì tạo (tên mặc định của tài khoản email = phần trước `@`) |
| `POST` | `/auth/refresh` | `chatRefresh` | Public | `{refresh_token}` -> như verify, không có `is_new` |
| `POST` | `/auth/logout` | `chatLogout` | SelfAuth | xoá thiết bị hiện tại (refresh + push token), đóng WebSocket của thiết bị -> `{}` |
| `GET` / `PATCH` | `/me` | `chatMe` / `chatUpdateMe` | SelfAuth | Me; PATCH `{display_name?, show_read_receipts?}` -> Me |
| `GET` | `/users/search?phone=` hoặc `?email=` | `chatSearchUser` | SelfAuth | `{user: User \| null}` - đúng số / đúng email (đã chuẩn hoá); gửi cả hai -> 400 `BAD_REQUEST` |
| `POST` | `/contacts/match` | `chatMatchContacts` | SelfAuth | `{phones?, phone_hashes?}` (mỗi loại ≤ 1000; hash = sha256 hex của số E.164) -> `{users: [User + matched]}` |
| `GET` | `/friends` | `chatListFriends` | SelfAuth | `{friends: [User]}` sắp theo tên |
| `DELETE` | `/friends/:user_id` | `chatUnfriend` | SelfAuth | huỷ kết bạn (xoá cả hai chiều) -> `{}` |
| `GET` | `/friend-requests` | `chatListFriendRequests` | SelfAuth | `{incoming, outgoing}`, mỗi phần tử = User + `requested_at` |
| `POST` | `/friend-requests` | `chatSendFriendRequest` | SelfAuth | `{user_id}` -> `{status: "pending" \| "accepted"}` (người kia đã mời mình thì thành bạn ngay) |
| `POST` | `/friend-requests/:user_id/accept` | `chatAcceptFriendRequest` | SelfAuth | `{status: "accepted"}` |
| `POST` | `/friend-requests/:user_id/reject` | `chatRejectFriendRequest` | SelfAuth | `{}` |
| `DELETE` | `/friend-requests/:user_id` | `chatCancelFriendRequest` | SelfAuth | rút lời mời mình đã gửi -> `{}` |
| `GET` / `POST` | `/blocks` | `chatListBlocks` / `chatBlockUser` | SelfAuth | `{users: [User]}`; POST `{user_id}` -> `{}` |
| `DELETE` | `/blocks/:user_id` | `chatUnblockUser` | SelfAuth | bỏ chặn -> `{}` |
| `GET` | `/conversations?cursor=&limit=` | `chatListConversations` | SelfAuth | `{conversations: [Conversation], next_cursor, sync_cursor}`; tin mới nhất trước; `limit` 50 (tối đa 100) |
| `POST` | `/conversations` | `chatCreateConversation` | SelfAuth | `{type: "direct", user_id}` (cặp đã có thì trả hội thoại cũ) hoặc `{type: "group", name, member_ids}` (≥ 1 người, đều là bạn bè) -> ConversationDetail |
| `GET` / `PATCH` | `/conversations/:id` | `chatGetConversation` / `chatRenameConversation` | SelfAuth | ConversationDetail (403 nếu không còn là thành viên); PATCH `{name}` (trưởng / phó nhóm) |
| `POST` | `/conversations/:id/members` | `chatAddMembers` | SelfAuth | `{user_ids}`: thành viên bất kỳ thêm bạn bè của mình (nhóm tối đa 1000) -> ConversationDetail |
| `DELETE` | `/conversations/:id/members/:user_id` | `chatRemoveMember` | SelfAuth | chính mình = rời nhóm; người khác: trưởng nhóm xoá mọi người, phó nhóm xoá thành viên thường -> `{}` |
| `PATCH` | `/conversations/:id/members/:user_id` | `chatSetMemberRole` | SelfAuth | `{role: "admin" \| "member"}` (chỉ trưởng nhóm) -> ConversationDetail |
| `PUT` | `/conversations/:id/mute` | `chatMuteConversation` | SelfAuth | `{until: RFC3339 \| "forever" \| null}` -> Conversation |
| `GET` | `/conversations/:id/messages` | `chatListMessages` | SelfAuth | `?before_seq=` hoặc `?after_seq=`, `limit` 50 (tối đa 100) -> `{messages (tăng theo seq), has_more}`; không có cả hai = trang mới nhất |
| `GET` | `/sync?cursor=` | `chatSync` | SelfAuth | `{conversations (kể cả dòng left: true), sync_cursor, truncated}`: dòng đổi từ `cursor` - 10 giây (client gộp idempotent), tối đa 500. Dòng `left: true` chỉ còn dữ liệu của mình: `name` null, `last_message` / `last_message_at` null, `member_count` 0, `last_seq` = `last_delivered_seq` của mình, `updated_at` = lúc rời (client giữ tên đã biết) |
| `GET` | `/push/config` | `chatPushConfig` | SelfAuth | `{enabled, vapid_public_key}` |
| `POST` / `DELETE` | `/devices/push` | `chatSetPushToken` / `chatClearPushToken` | SelfAuth | POST `{push_kind: "webpush", push_token: JSON.stringify(PushSubscription)}` (endpoint https của dịch vụ push đã biết): subscription đó bị gỡ khỏi thiết bị KHÁC của CÙNG người dùng (đăng nhập lại), thiết bị của người dùng khác vẫn giữ (một trình duyệt nhiều tài khoản, mỗi tab một tài khoản, dùng chung một subscription) / DELETE gỡ khỏi thiết bị hiện tại -> `{}` |
| `GET` | `/media/config` | `chatMediaConfig` | SelfAuth | `{enabled, max_bytes: {image, video, file, voice}, max_voice_ms, max_poster_bytes, mimes: {image, video, voice}, denied_ext}`; máy chủ tắt tệp -> chỉ `{enabled: false}`. Client lấy giới hạn ở đây, không tự đặt |
| `POST` | `/media/upload-url` | `chatMediaUploadURL` | SelfAuth | `{type, mime, size, sha256, file_name?, width?, height?, duration_ms?, waveform?, poster?: {mime, size}}` -> `{media_id, dedup, upload?: Target, poster_upload?: Target, media?: Media}`; Target = `{url, method: "PUT", headers: {"Content-Type"}, expires_at}` (15 phút). `dedup: true` = đã có tệp `ready` cùng nội dung của chính mình: không có `upload`, có `media`. 60 lần / phút / người |
| `POST` | `/media/:id/complete` | `chatMediaComplete` | SelfAuth | thân rỗng, chỉ người tải; tối đa 60 giây -> `{media: Media}` (`status: "ready"`); gọi lại khi đã `ready` trả lại đúng kết quả |
| `GET` | `/media/:id?download=0\|1&message_id=` | `chatMediaGet` | SelfAuth | `{media: Media}` kèm URL đọc mới (JSON, không chuyển hướng 302 vì `<img src>` không gửi được Bearer). Người tải hoặc thành viên đang ở trong hội thoại có tin dùng tệp; không có quyền -> 404 `MEDIA_NOT_FOUND`. `download=1` -> URL `attachment`; `message_id` (tin xem được) -> tên tải về = `file_name` của tin đó |
| `GET` | `/ws` | `chatWebSocket` | SelfAuth | nâng cấp WebSocket (bên dưới); gateway chưa bật / đang tắt -> 503 `UNAVAILABLE` |

Object (CHAT.md mục 5; kiểu Go trong `internal/modules/chat/dto.go`):
- **User** `{id, display_name, phone, email, relation, online}`: `phone` chỉ có với chính mình, bạn bè và kết quả tra / đối chiếu đúng số (còn lại null);
  `email` chỉ có với chính mình, bạn bè và kết quả tra đúng email (còn lại null: lời mời, thành viên nhóm, đã chặn...); tra theo email không
  trả `phone` và ngược lại; tài khoản email có `phone` null, tài khoản số có `email` null;
  `online` chỉ đúng với bạn bè và `peer` của chat 1-1 mà người đó đã nhắn ít nhất một tin (không ai chặn ai), còn lại luôn false;
  `relation` = `self | friend | outgoing | incoming | blocked | none` (`blocked` = mình chặn họ; bị họ chặn hiện `none`).
  **Me** = User + `show_read_receipts`, `created_at`.
- **Message** `{id, conversation_id, seq, client_msg_id, sender_id, sender_name, msg_type: "text" | "system" | "image" | "video" | "file" |
  "voice", content, created_at, attachments?}`: `attachments` = `[Media]` (đúng 1 phần tử) chỉ có ở tin image / video / file / voice, tin
  text / system không có khoá này; `content` của tin tệp là chú thích (có thể rỗng, tin thoại luôn rỗng). `last_message` của Conversation
  cũng là Message nên mang `attachments` như vậy.
- **Media** `{id, type: "image" | "video" | "file" | "voice", mime, size, file_name?, width?, height?, duration_ms?, waveform?, blurhash?,
  status: "pending" | "processing" | "ready" | "failed" | "blocked", url?, thumb_url?, expires_at?}` (`MediaDTO`, `dto_media.go`):
  trong tin nhắn `file_name` là tên của CHÍNH tin đó (`chat_messages.file_name`); `url` / `thumb_url` là presigned GET hết hạn lúc
  `expires_at`, chỉ có khi tệp `ready` và máy chủ bật tệp (tắt tệp: tin cũ vẫn liệt kê, không có URL). `waveform` 1..128 số 0..255
  (tin thoại); `thumb_url` = ảnh nhỏ 320 px (ảnh) / ảnh bìa (video), không có khi ảnh gốc đã đủ nhỏ.
- **Conversation** `{id, type, name, peer, member_count, role, last_seq, last_read_seq, last_delivered_seq, unread, last_message, last_message_at,
  muted_until, left, created_at, updated_at}`: `peer` (User) chỉ ở chat 1-1; `unread = max(0, last_seq - last_read_seq)`; `muted_until` vĩnh viễn =
  `"forever"`. **ConversationDetail** = Conversation + `members: [{user_id, display_name, role, last_read_seq, last_delivered_seq, joined_at}]`
  (thành viên đang hoạt động; `last_read_seq` null khi người đó tắt "đã xem" và không phải mình).

Giới hạn: OTP 5 lần / giờ / số hoặc email, 20 lần / giờ / IP (đếm chung số lẫn email), gửi lại sau 60 giây, mã sống 5 phút, xin mã mới thì mã cũ
hết dùng, sai 5 lần (cộng mọi mã của số / email trong 1 giờ) khoá số / email 15 phút; 30 lời mời kết bạn / giờ; 60 lần tra số / email + đối chiếu
danh bạ / phút và 5000 SỐ / email được tra / ngày (mỗi số / hash hợp lệ khác nhau trong `contacts/match` là 1, `users/search` là 1); 30 chat 1-1 MỚI với người chưa là bạn / giờ; 20 tin / giây (các bộ
đếm sau OTP nằm trong bộ nhớ của tiến trình).

**Mã lỗi** (REST: khoá `code`; WebSocket: `data.code` của gói `error`; thông báo tiếng Việt):

| Mã | HTTP | Khi nào |
|---|---|---|
| `BAD_REQUEST` | 400 | thân / tham số sai, tin rỗng / quá 4000 ký tự, thao tác chỉ dành cho nhóm |
| `PHONE_INVALID` | 400 | số điện thoại không chuẩn hoá được |
| `EMAIL_INVALID` | 400 | email không hợp lệ (`Email không hợp lệ`): rỗng sau khi bỏ khoảng trắng, > 254 ký tự, phần trước `@` > 64, có khoảng trắng / ký tự điều khiển / ký tự đặc biệt `"(),:;<>[]` hay dấu gạch ngược (chặn dạng `1<victim@corp.vn>`: net/mail sẽ gửi tới hộp thư khác), dấu chấm ở đầu / cuối / liền nhau ở một trong hai phần, không khớp `x@y.z` |
| `OTP_INVALID` | 400 | sai mã (lần 1-4, đếm cộng dồn mọi mã của số / email trong 1 giờ) |
| `OTP_EXPIRED` | 400 | mã hết hạn hoặc số / email chưa xin mã |
| `OTP_RATE_LIMIT` | 429 | gửi lại trước 60 giây, quá 5 lần / giờ / số hoặc email, hoặc 20 lần / giờ / IP |
| `OTP_LOCKED` | 429 | sai lần thứ 5 (xin mã mới không đếm lại): số / email bị khoá 15 phút (cả xin mã lẫn xác thực) |
| `CHAT_NOAUTH` | 401 | access token thiếu / sai / hết hạn, hoặc thiết bị đã đăng xuất |
| `REFRESH_INVALID` | 401 | refresh token lạ / hết hạn |
| `REFRESH_REUSED` | 401 | token đã xoay hơn 30 giây bị trình lại: thiết bị bị thu hồi |
| `REFRESH_RACE` | 409 | token vừa xoay dưới 30 giây (request song song): đọc lại token đã lưu rồi gọi lại |
| `FORBIDDEN` | 403 | không còn là thành viên, không đủ vai trò, thêm người không phải bạn bè, người kia đã chặn mình (`Không thể gửi lời mời`) |
| `BLOCKED` | 403 | chat 1-1 / gửi tin khi một trong hai bên đã chặn; mời kết bạn người mình đang chặn |
| `NOT_FOUND` | 404 | người dùng / hội thoại không có |
| `RATE_LIMIT` | 429 | vượt 20 tin / giây, 30 lời mời / giờ, 60 lần tra số / email / phút, 5000 số / email được tra / ngày, 30 chat 1-1 mới với người chưa là bạn / giờ |
| `INTERNAL` | 500 | lỗi máy chủ; không gửi được SMS / email mã OTP (`Không gửi được mã xác thực, thử lại sau`) |
| `UNAVAILABLE` | 503 | `GET /chat/ws` khi gateway chưa bật hoặc server đang tắt; route tệp khi kho tệp đang khởi động (`Kho tệp đang khởi động, thử lại sau`) hoặc chưa quét virus được (`Chưa kiểm tra được tệp, thử lại sau`, dòng trả về `pending`) |
| `MEDIA_DISABLED` | 503 | máy chủ chưa bật tệp (`CHAT_S3_ENDPOINT` trống / thiếu khoá): mọi route `/media/...` trừ `config`, và `message.send` tin tệp |
| `MEDIA_TYPE` | 415 | MIME không cho phép theo loại (ảnh HEIC / SVG -> `Loại ảnh này không gửi được, hãy gửi dạng tệp`), đuôi tệp bị chặn, nội dung dò ra khác loại đã khai (lúc `complete`), ảnh bìa không phải JPEG / WebP |
| `MEDIA_TOO_LARGE` | 413 | vượt giới hạn theo loại hoặc ảnh bìa > 512 KB (`Tệp quá lớn (tối đa N MB)`) |
| `MEDIA_QUOTA` | 429 | tổng `size` đã khai trong 24 giờ vượt `CHAT_MEDIA_DAILY_MB` |
| `MEDIA_NOT_FOUND` | 404 | tệp không có / của người khác / không có quyền xem; tin gửi kèm tệp không phải của mình |
| `MEDIA_NOT_UPLOADED` | 409 | `complete` khi chưa PUT xong (không thấy object ở khoá tạm) |
| `MEDIA_MISMATCH` | 422 | kích thước hoặc sha256 của object khác giá trị đã khai: dòng thành `failed` |
| `MEDIA_NOT_READY` | 409 | gửi tin với tệp chưa `ready`; `upload-url` / `complete` khi tệp đang `processing` (gọi lại `complete` sau) |
| `MEDIA_BLOCKED` | 422 | bộ quét báo có mã độc; cùng nội dung tải lại vẫn bị chặn |
| `AUTH_FAILED`, `UNAUTHENTICATED`, `UNKNOWN_TYPE` | - | chỉ trong gói `error` của WebSocket |

**WebSocket** `ws(s)://<máy chủ>/api/v1/chat/ws` (`internal/modules/chat/realtime`). Mỗi gói là `{"type":"...","req_id"?: chuỗi | số,"data":{...}}`;
`req_id` được trả nguyên dạng trong `ack` / `error`. Origin: cùng host với API luôn được, thêm các host của `CORS_ORIGINS` (bỏ scheme).
Khung tối đa 32 KiB; gói của một kết nối xử lý lần lượt; `device_id`, `conversation_id`, `user_ids` nhận cả số lẫn chuỗi số.

Client -> server:

| Gói | `data` | Trả lời |
|---|---|---|
| `auth` (BẮT BUỘC là gói đầu, trong 10 giây) | `{access_token, device_id}` (`device_id` BẮT BUỘC, phải đúng thiết bị của token; thiếu / 0 / khác -> sai) | `auth.ok {user_id, server_time}`; sai (kể cả thiết bị vừa đăng xuất / bị thu hồi) -> `error` `AUTH_FAILED` rồi đóng 4401 |
| `ping` (client gửi mỗi 25 giây) | - | `pong` |
| `message.send` | `{conversation_id, client_msg_id (UUID), msg_type: "text" \| "image" \| "video" \| "file" \| "voice", content, attachments?: [media_id], file_name?}` (luật từng loại: bảng dưới) | `ack {conversation_id, client_msg_id, message_id, seq, created_at, duplicate, attachments?}` hoặc `error`; gửi lại cùng `client_msg_id` -> ack của tin cũ (kể cả `attachments` của tin cũ, dù lần gửi lại kèm tệp khác), `duplicate: true` |
| `message.delivered` / `message.read` | `{conversation_id, seq}` | `ack {conversation_id, delivered_seq, read_seq}`; `seq` bị kẹp về `last_seq`, con trỏ không lùi, đã xem nâng luôn đã nhận |
| `typing.start` / `typing.stop` | `{conversation_id}` | chuyển `typing` cho các thành viên khác; `typing.start` lặp lại dưới 1 giây bị bỏ |
| `presence.subscribe` | `{user_ids: [...]}` (≤ 100, thay tập đang theo dõi) | ngay 1 `presence.update` cho mỗi người được xem (không ai chặn ai, và là bạn bè hoặc chung nhóm hoặc chung chat 1-1 mà người đó đã nhắn ít nhất một tin), sau đó đẩy khi đổi |

`ack` chỉ gửi khi gói có `req_id` (`typing.*`, `presence.subscribe` có `req_id` thì nhận `ack {}`; lỗi của `typing.*` chỉ báo khi có `req_id`).
Chưa xác thực mà gửi gói khác -> `error` `UNAUTHENTICATED` + đóng 4401; JSON hỏng -> `BAD_REQUEST` (trước `auth`: kèm đóng 4401);
loại gói lạ -> `UNKNOWN_TYPE`; gửi `auth` lần hai -> `BAD_REQUEST`.

Luật `message.send` theo `msg_type` (`validateSend`, sai -> `BAD_REQUEST` trừ khi ghi khác):

| `msg_type` | `attachments` | `content` | `file_name` |
|---|---|---|---|
| `text` | phải rỗng | 1..4000 ký tự sau khi bỏ khoảng trắng, không NUL | phải rỗng |
| `image` / `video` | đúng 1 id > 0 | chú thích 0..4000 | phải rỗng |
| `file` | đúng 1 id > 0 | chú thích 0..4000 | tuỳ chọn: làm sạch như `upload-url`, đuôi bị chặn -> `MEDIA_TYPE`; trống = tên lúc tải lên |
| `voice` | đúng 1 id > 0 | phải rỗng | phải rỗng |
| `system` / khác | `BAD_REQUEST` | | |

Sau kiểm thành viên, chống trùng và chặn, tệp được khoá (`for share`) trong cùng transaction gửi tin: máy chủ tắt tệp -> `MEDIA_DISABLED`;
tệp không có / không phải của người gửi -> `MEDIA_NOT_FOUND`; chưa `ready` -> `MEDIA_NOT_READY`; loại tệp khác `msg_type` -> `BAD_REQUEST`.
Một `media_id` dùng được cho nhiều tin (gửi lại cùng ảnh); mỗi tin giữ `file_name` riêng.

Server -> client:

| Gói | `data` | Khi nào |
|---|---|---|
| `auth.ok` | `{user_id, server_time}` | xác thực xong (client gọi `GET /chat/sync` rồi gửi outbox) |
| `pong` | - | trả `ping` |
| `ack` | theo gói gửi lên | gói có `req_id` |
| `error` | `{code, message}` | lỗi của một gói |
| `message.new` | Message (tin tệp kèm `attachments` có URL đọc) | tin mới / tin hệ thống, tới mọi kết nối của thành viên (cả kết nối khác của người gửi; người vừa bị xoá / rời nhóm cũng nhận tin hệ thống); client khử trùng theo `(conversation_id, seq)` |
| `receipt.update` | `{conversation_id, user_id, delivered_seq, read_seq}` | con trỏ của một thành viên tăng; người khác nhận `read_seq: null` khi chủ con trỏ tắt `show_read_receipts`; chat 1-1 đang chặn: chỉ các thiết bị của chính mình nhận |
| `presence.update` | `{user_id, online, last_seen}` | trạng thái online đổi (`last_seen` null khi đang online; offline sau 30 giây không còn kết nối); thôi được xem (chặn, huỷ kết bạn, rời / bị xoá khỏi hội thoại chung cuối cùng) -> 1 gói `{online: false, last_seen: null}` rồi gỡ đăng ký |
| `typing` | `{conversation_id, user_id, is_typing}` | thành viên khác soạn / thôi soạn (chat 1-1 đang chặn: không chuyển, không báo lỗi) |
| `reconnect` | `{}` | server sắp tắt; đóng 1012 ngay sau đó |
| `force_logout` | `{}` | thiết bị đã đăng xuất / bị thu hồi; đóng 4403 ngay sau đó |

Mã đóng kết nối:

| Mã | Khi nào | Client nên |
|---|---|---|
| 4401 | `auth` sai, hoặc gói đầu không phải `auth` / JSON hỏng | refresh token qua REST rồi kết nối lại |
| 4408 | không gửi `auth` trong 10 giây | kết nối lại |
| 4403 | sau `force_logout` | xoá token, về màn đăng nhập |
| 1012 | sau `reconnect` (server khởi động lại) | kết nối lại có backoff |
| không có mã ứng dụng | client chậm (256 gói chờ ghi), không nhận gói nào trong 60 giây, khung quá 32 KiB (thư viện gửi 1009) | kết nối lại rồi `GET /chat/sync` |

Tin được lưu (commit) TRƯỚC khi phân phối. Client phát hiện hở `seq` thì tải `GET /chat/conversations/:id/messages?after_seq=`; sau mỗi `auth.ok`
gọi `GET /chat/sync?cursor=<sync_cursor>`. Push (Web Push, khi đặt đủ `CHAT_VAPID_*`): gửi cho thành viên khác người gửi đang offline và không
tắt thông báo, payload `{title, body, user_id, conversation_id, seq, badge, tag: "conv-<user_id>-<id>", url: "/chat?u=<user_id>#c<id>"}`
(`user_id` = người nhận: một subscription có thể thuộc nhiều tài khoản trong cùng trình duyệt; trang mở từ `url` chuyển tab sang tài khoản đó),
header `Topic: c<user_id>-<id>` (bỏ khi quá 32 ký tự) để hai tài khoản trên một subscription không đè thông báo chờ giao của nhau
(gộp tin cùng hội thoại trong 3 giây; dịch vụ push trả 404 / 410 thì gỡ token của thiết bị). Chỉ gửi tới thiết bị còn phiên (còn refresh
token chưa hết hạn): thiết bị của phiên đã hết / đăng xuất lúc mất mạng vẫn giữ subscription chung của trình duyệt nhưng không nhận push.
`body` của push (tối đa 100 ký tự, `previewBody` trong `media_preview.go`; giao diện dựng cùng chuỗi cho dòng xem trước, thêm "Bạn: "):
text = nội dung; `[Hình ảnh]` / `[Video]` (+ chú thích nếu có); `[Tệp] <file_name của tin>`; `[Tin nhắn thoại] m:ss` (làm tròn lên);
không đọc được tệp / máy chủ tắt tệp -> `[Tệp đính kèm]`.

**Tệp đính kèm** (ảnh / video / tệp / tin thoại, `CHAT.md` mục 12, D-17; code `service_media.go`, kho `platform/objstore`):

Byte của tệp KHÔNG đi qua server Go. Luồng:
1. `GET /media/config` lấy giới hạn. Client nén ảnh (trừ khi chọn "Gửi ảnh gốc"), làm ảnh bìa video (cạnh dài 640 px, ≤ 512 KB), tính
   sha256 cả tệp (`crypto.subtle`, nên trang phải là HTTPS hoặc localhost).
2. `POST /media/upload-url`: kiểm giới hạn + hạn mức, tạo dòng `chat_media` `pending` (hoặc dùng lại dòng cũ), ký PUT tới khoá tạm.
3. Trình duyệt `PUT` thẳng lên MinIO đúng `url` + `headers` (không gửi Bearer). URL ký `Content-Type` và `Content-Length`: khác loại / khác
   số byte -> MinIO trả 403 và không tạo object. Có `poster_upload` thì PUT ảnh bìa như vậy.
4. `POST /media/:id/complete`: server giành dòng (`processing`), chép phía server khoá tạm -> khoá cuối, xoá khoá tạm, rồi trên khoá cuối kiểm
   kích thước, dò loại theo 512 byte đầu (ảnh: `mime` lưu = loại dò được), tính lại sha256 theo luồng + quét virus, ảnh làm ảnh nhỏ JPEG
   320 px + blurhash (ảnh trên 40 triệu điểm ảnh chỉ lưu kích thước), video kiểm ảnh bìa -> `ready`.
5. `message.send` kèm `attachments: [media_id]`; người nhận đọc `url` / `thumb_url` trong Message. URL sắp hết hạn -> `GET /media/:id`.

| Loại | MIME khai được (bỏ tham số, chữ thường) | Giới hạn |
|---|---|---|
| `image` | `image/jpeg`, `image/png`, `image/webp`, `image/gif` (GIF dùng khung đầu cho ảnh nhỏ) | `CHAT_MEDIA_MAX_IMAGE_MB` (mặc định 25) |
| `video` | `video/mp4`, `video/webm`, `video/quicktime`; `width` / `height` / `duration_ms` chỉ là gợi ý | `CHAT_MEDIA_MAX_FILE_MB` (mặc định 100, trần 200) |
| `voice` | `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/aac`, `audio/mpeg` (MP3 phải bắt đầu bằng thẻ ID3); `duration_ms` 1..600000 + `waveform` bắt buộc | 10 MB |
| `file` | mọi MIME hợp lệ (trống = `application/octet-stream`); `file_name` bắt buộc; chặn đuôi `.exe .msi .bat .cmd .com .scr .ps1 .vbs .js .jar` (so chữ thường, bỏ dấu chấm / khoảng trắng cuối: `A.EXE.` cũng bị chặn) | `CHAT_MEDIA_MAX_FILE_MB` |

- `sha256` = 64 ký tự hex của nội dung. `file_name` được làm sạch: bỏ phần trước `/` hoặc `\` cuối cùng, bỏ ký tự điều khiển, cắt khoảng
  trắng / dấu chấm cuối, tối đa 255 ký tự, rỗng -> `tep`. `poster` chỉ cho video (`image/jpeg` / `image/webp`; WebP được đổi sang JPEG).
- Hạn mức: tổng `size` ĐÃ KHAI của mọi dòng (kể cả `failed`) tạo trong 24 giờ ≤ `CHAT_MEDIA_DAILY_MB` (mặc định 2048); `upload-url`
  60 lần / phút / người (`RATE_LIMIT`).
- Chống trùng theo `(người tải, sha256, loại)`: dòng `ready` còn object -> `dedup: true`, cùng `media_id`, không tải lại (tên trong
  request bị bỏ qua, tin mang tên riêng); `pending` / `failed` -> cùng khoá, URL mới (`size` phải khớp, không thì `BAD_REQUEST`);
  `processing` -> `MEDIA_NOT_READY`; `blocked` -> `MEDIA_BLOCKED`. Không chống trùng giữa hai người dùng.
- `complete`: chưa PUT -> `MEDIA_NOT_UPLOADED` (dòng về `pending`, PUT rồi gọi lại); kích thước / sha256 lệch hoặc dò loại sai -> dòng
  `failed`, object bị xoá (`MEDIA_MISMATCH` / `MEDIA_TYPE`); có mã độc -> `blocked`. Không giữ transaction trong lúc làm việc với kho.
- Khoá object: tạm `chat/in/u<uid>/<yyyymm>/<hex32>` (+ `.p.jpg` ảnh bìa; chỉ khoá tạm được ký PUT, ILM xoá sau 1 ngày); cuối
  `chat/m/u<uid>/<yyyymm>/<hex32>`, ảnh nhỏ `<khoá cuối>.t.jpg`, ảnh bìa `<khoá cuối>.p.jpg`. Bucket riêng tư, không có quyền ẩn danh.
- URL đọc: presigned GET sống `CHAT_MEDIA_URL_TTL_MIN` phút (mặc định 60, ép trong 5..720), ký kèm `response-cache-control: private,
  max-age=<hạn>`; image / video / voice `inline` đúng MIME đã dò; `file` LUÔN `application/octet-stream` + `attachment; filename*=UTF-8''...`.
  URL được cache trong tiến trình nửa hạn (chuỗi không đổi -> cache trình duyệt trúng). URL là link mang quyền: người rời nhóm vẫn mở được URL
  đã nhận tới khi hết hạn. Tin `file`: `attachments[].url` ký theo `file_name` của chính tin (tải về đúng tên hiển thị);
  `GET /media/:id?download=1&message_id=<id tin>` cũng trả link `attachment` đúng tên đó (giao diện dùng đường này).
- Dọn tệp (janitor 30 phút / lần): `processing` quá 10 phút -> `pending`; `pending` / `failed` không đổi quá 2 giờ -> `failed` + xoá object
  (≤ 200 dòng / lượt); dòng `pending` / `failed` tạo quá 24 giờ bị xoá (tới lúc đó vẫn tính vào hạn mức); tệp `ready` không tin nào dùng quá
  24 giờ bị xoá cùng object; dòng `blocked` giữ lại. Dòng còn tin dùng không bao giờ bị đánh `failed` / xoá; object xoá trong lúc
  giữ khoá dòng (upload-url cấp lại URL cùng khoá phải chờ); một bước lỗi không chặn các bước sau.
- Máy chủ tắt tệp: `config` -> `{enabled: false}`, route tệp khác + tin tệp -> 503 `MEDIA_DISABLED`; tin tệp cũ vẫn đọc được (không có URL).
  Kho chưa sẵn sàng (đang kiểm / tạo bucket) -> 503 `UNAVAILABLE`. Biến môi trường: `ARCHITECTURE.md` mục 10.4, `backend/README.md`.

**Quản trị nhóm** (migration 0022: @nhắc tên, ảnh + mô tả nhóm, link mời, hàng chờ duyệt, chuyển trưởng nhóm, giải tán, cài đặt quyền;
kiểu Go trong `dto_group.go` + các khoá mới trong `dto.go`, mã lỗi trong `errors.go`). Mọi thứ dưới đây chỉ áp dụng cho nhóm
(`type: "group"`); gọi trên chat 1-1 -> 400 `BAD_REQUEST` `Thao tác này chỉ dành cho nhóm` (như `errNotGroup`).

Route mới / đổi (đường dẫn tính từ `/api/v1/chat`, đều `SelfAuth`, thân JSON object; `:request_id` = id yêu cầu vào nhóm):

| Method | Đường dẫn | `Name` | Ai được | Thân -> kết quả |
|---|---|---|---|---|
| `PATCH` | `/conversations/:id` | `chatRenameConversation` (giữ tên rpc, mở rộng thân) | owner / admin; member khi `admins_only_edit_info` = false | `{name?, description?, avatar_media_id?}` -> ConversationDetail. Khoá vắng = giữ nguyên; `description` `""` / null = xoá; `avatar_media_id` null = xoá ảnh. Không có khoá nào -> 400 `Không có gì để cập nhật` |
| `PATCH` | `/conversations/:id/settings` | `chatUpdateGroupSettings` | owner / admin | `{admins_only_send?, admins_only_edit_info?, admins_only_add_members?}` (boolean) -> ConversationDetail. Không có khoá nào -> 400 `Không có gì để cập nhật` |
| `POST` | `/conversations/:id/owner` | `chatTransferOwnership` | owner | `{user_id}` -> ConversationDetail. Người nhận thành `owner`, trưởng nhóm cũ thành `admin` |
| `POST` | `/conversations/:id/disband` | `chatDisbandGroup` | owner | thân rỗng -> `{}` (ngữ nghĩa: mục "Giải tán" bên dưới) |
| `GET` | `/conversations/:id/invite-link` | `chatGetInviteLink` | mọi thành viên đang hoạt động | -> `{invite_link: InviteLink \| null}` (KHÔNG có `token` / `url_path`); null khi chưa có link hiệu lực hoặc nhóm đã giải tán |
| `POST` | `/conversations/:id/invite-link` | `chatCreateInviteLink` | owner / admin; member khi `admins_only_add_members` = false | `{requires_approval?: bool (mặc định false), expires_in?: số giây 3600..2592000 \| null (null / vắng = không hết hạn)}` -> `{invite_link: InviteLink}` CÓ `token` + `url_path`. Link hiệu lực cũ (nếu có) bị thu hồi trong cùng transaction (= "tạo lại link"); member chỉ tạo lại được khi link hiệu lực là của chính mình (link của người khác -> 403 `Bạn không có quyền thu hồi link này`) |
| `DELETE` | `/conversations/:id/invite-link` | `chatRevokeInviteLink` | owner / admin; member chỉ link do mình tạo | -> `{}`; không có link hiệu lực -> `{}` (idempotent) |
| `GET` | `/invites/:token` | `chatInvitePreview` | mọi tài khoản chat đã đăng nhập | -> InvitePreview |
| `POST` | `/invites/:token/join` | `chatJoinByInvite` | mọi tài khoản chat đã đăng nhập | thân rỗng -> `{status: "joined" \| "pending" \| "already_member", conversation_id: id \| null, request_id: id \| null}`; `conversation_id` có khi `joined` / `already_member`, `request_id` có khi `pending` (đã có yêu cầu chờ -> trả lại yêu cầu đó, không tạo mới) |
| `GET` | `/conversations/:id/join-requests` | `chatListJoinRequests` | owner / admin | -> `{requests: [JoinRequest]}` chỉ yêu cầu `pending`, cũ trước, tối đa 500 |
| `POST` | `/conversations/:id/join-requests/:request_id/approve` | `chatApproveJoinRequest` | owner / admin | -> `{status: "approved"}` |
| `POST` | `/conversations/:id/join-requests/:request_id/reject` | `chatRejectJoinRequest` | owner / admin | -> `{status: "rejected"}` (không có tin hệ thống, người xin không được báo) |

Route cũ đổi hành vi: `POST /conversations/:id/members` (`chatAddMembers`) member bị chặn khi `admins_only_add_members` = true
(403 `Chỉ trưởng / phó nhóm được thêm thành viên`); người được thêm có yêu cầu `pending` -> yêu cầu thành `cancelled`.
`DELETE /conversations/:id/members/:user_id` với `user_id` = mình trên nhóm ĐÃ GIẢI TÁN = gỡ nhóm khỏi danh sách của mình (không tin hệ thống).
`GET /media/:id` (`chatMediaGet`): thêm quyền đọc cho thành viên (đang hoạt động hoặc chỉ đọc sau giải tán) của nhóm có
`avatar_media_id` = id. Janitor tệp (`janitorOnce`) PHẢI bỏ qua tệp đang là `avatar_media_id` của một hội thoại (khoá ngoại `restrict`).

Object mới / khoá mới:
- **Mention** `{user_id, offset, length}` (mục "Định dạng @nhắc tên").
- **Message** thêm `mentions?: [Mention]` (sắp theo `offset`; tin không nhắc ai không có khoá này). `last_message` của Conversation cũng mang `mentions`.
- **Conversation** thêm `description` (chuỗi \| null), `avatar` (Media \| null, ảnh `ready` kèm `url` / `thumb_url`), `settings`
  (`{admins_only_send, admins_only_edit_info, admins_only_add_members}` \| null), `disbanded` (bool), `last_mention_seq` (số, 0 = chưa có),
  `unread_mention` (bool = `last_mention_seq > last_read_seq`). `description` / `avatar` / `settings` = null với chat 1-1 và dòng `left: true`;
  dòng `left: true` có `disbanded: false`, `last_mention_seq: 0`, `unread_mention: false`.
- **ConversationDetail** thêm `pending_join_requests` (số yêu cầu `pending`; chỉ owner / admin thấy số thật, người khác 0).
- **InviteLink** `{id, conversation_id, requires_approval, expires_at (\| null), expired (bool, đã quá expires_at), use_count, created_by,
  created_by_name, created_at, token?, url_path?}`. `token` (43 ký tự base64url = 32 byte ngẫu nhiên) và `url_path` (`/chat/join/<token>`)
  CHỈ có trong kết quả `POST .../invite-link`: server chỉ lưu sha256 hex của token. Giao diện tự lưu token vừa tạo (localStorage
  `chat_invite:<user_id>:<conversation_id>`) để hiện / sao chép lại; không còn token thì chỉ còn nút "Tạo link mới" (thu hồi link cũ).
  Link đầy đủ = `location.origin + url_path`.
- **InvitePreview** `{group: {name, description, avatar, member_count}, requires_approval, expires_at, membership: "none" \| "member" \|
  "pending", conversation_id}`: `conversation_id` chỉ khác null khi `membership = "member"`; không lộ danh sách / id thành viên.
- **JoinRequest** `{id, conversation_id, user: User, created_at}`.

Mặc định cờ của nhóm (cả nhóm cũ sau 0022): `admins_only_send = false`, `admins_only_edit_info = true` (giữ hành vi cũ: chỉ trưởng / phó
nhóm đổi tên), `admins_only_add_members = false`.

**Ma trận quyền** (kiểm ở server - REST và `message.send` - giao diện ẩn / khoá nút theo cùng bảng; `owner` = trưởng nhóm, `admin` =
phó nhóm, `member` = thành viên thường):

| Hành động | owner | admin | member |
|---|---|---|---|
| Gửi tin (`message.send`) | có | có | chỉ khi `admins_only_send` = false (không: 403 `FORBIDDEN` `Chỉ trưởng / phó nhóm được gửi tin trong nhóm này`) |
| `typing.start` / `typing.stop` | có | có | khi `admins_only_send` = true: không chuyển cho ai, không báo lỗi (có `req_id` -> `ack {}`) |
| Đổi tên / ảnh / mô tả | có | có | chỉ khi `admins_only_edit_info` = false (403 `Chỉ trưởng / phó nhóm được đổi thông tin nhóm`) |
| Thêm thành viên, tạo link mời | có | có | chỉ khi `admins_only_add_members` = false (403 `Chỉ trưởng / phó nhóm được thêm thành viên` / `... được tạo link mời`) |
| Xem link mời hiện hành | có | có | có |
| Thu hồi link mời | có | có | chỉ link do mình tạo (403 `Bạn không có quyền thu hồi link này`) |
| Xem / duyệt / từ chối yêu cầu vào nhóm | có | có | không (403 `Chỉ trưởng / phó nhóm được duyệt thành viên`) |
| Đổi cài đặt nhóm | có | có | không (403 `Chỉ trưởng / phó nhóm được đổi cài đặt nhóm`) |
| `@Tất cả` | có | có | không (403 `Chỉ trưởng / phó nhóm được nhắc cả nhóm`) |
| Ghim / bỏ ghim (0021, không đổi) | có | có | không |
| Đặt / bỏ phó nhóm (không đổi) | có | không | không |
| Chuyển trưởng nhóm, giải tán nhóm | có | không | không (403 `Chỉ trưởng nhóm được chuyển quyền trưởng nhóm` / `Chỉ trưởng nhóm được giải tán nhóm`) |
| Xoá thành viên (không đổi) | mọi người | chỉ member | không |

**Định dạng @nhắc tên.** `content` vẫn là văn bản thuần chứa đúng chữ hiển thị (`@Tên` lúc gửi, `@Tất cả` cho cả nhóm); vị trí nằm
riêng trong `mentions`:

```json
{"msg_type": "text", "content": "@Bình @Tất cả họp lúc 9h",
 "mentions": [{"user_id": 12, "offset": 0, "length": 5}, {"user_id": 0, "offset": 6, "length": 7}]}
```

- `offset` / `length` tính theo **đơn vị UTF-16** (đúng chỉ số chuỗi JavaScript, `content.slice(offset, offset + length)`), trên `content`
  ĐÃ cắt khoảng trắng hai đầu. Client PHẢI gửi `content` đã `trim()` và tính offset trên chuỗi đó. Server (Go: đổi sang `[]uint16` bằng
  `utf16.Encode([]rune(content))`) vẫn phòng thủ: sau `strings.TrimSpace` trừ số đơn vị UTF-16 đã cắt ở đầu khỏi mọi `offset`.
- `user_id` = id thành viên, hoặc `0` = `@Tất cả`. Đoạn được đánh dấu gồm `@` + tên, KHÔNG gồm khoảng trắng sau. Chữ trong đoạn là bản chụp
  tên lúc gửi (đổi tên sau không sửa tin cũ); giao diện tô đậm đúng đoạn đó, đoạn có `user_id` = mình hoặc 0 tô nổi hơn.
- Luật kiểm (`message.send`, theo thứ tự; sai -> 400 `BAD_REQUEST` trừ khi ghi khác): chỉ nhóm (`Chỉ nhắc tên được trong nhóm`); không với
  `msg_type: "voice"`; tối đa 50 phần tử (`Tối đa 50 lượt nhắc tên mỗi tin`); mỗi phần tử `user_id >= 0`, `offset >= 0`, `length >= 2`,
  `offset + length <=` độ dài UTF-16 của `content`, ký tự tại `offset` là `@`; server sắp theo `offset`, hai đoạn chồng nhau -> lỗi
  (`Vị trí nhắc tên không hợp lệ`); `user_id = 0` mà người gửi là member -> 403 `FORBIDDEN` `Chỉ trưởng / phó nhóm được nhắc cả nhóm`.
  `user_id > 0` không phải thành viên đang hoạt động hoặc là chính người gửi -> phần tử đó bị BỎ (chữ vẫn giữ trong `content`, không lỗi).
  Sau khi bỏ mà rỗng -> lưu NULL (Message không có `mentions`).
- Lưu `chat_messages.mentions` (jsonb, mảng đã chuẩn hoá). Cùng transaction gửi tin: `last_mention_seq = seq` cho mọi người được nhắc
  (`@Tất cả`: mọi thành viên đang hoạt động trừ người gửi). `ack` của `message.send` thêm `mentions` như đã lưu; gửi trùng trả `mentions`
  của tin gốc.
- Client cập nhật dấu `@` theo thời gian thực: `message.new` có phần tử `user_id` = mình hoặc 0 (và người gửi khác mình) -> `last_mention_seq
  = seq`; `unread_mention` = `last_mention_seq > last_read_seq` (đọc tới tin đó thì tắt). Danh sách hội thoại hiện dấu `@` khi `unread_mention`.
- Ô soạn: gõ `@` mở danh sách thành viên đang hoạt động (trừ mình) lọc theo chữ gõ sau `@` (không dấu, không phân biệt hoa thường); owner /
  admin thấy thêm dòng đầu `@Tất cả`. Chọn -> chèn `@<display_name> ` và ghi vị trí; sửa chữ bên trong một đoạn đã chèn thì bỏ phần tử đó.

**Push** (bổ sung mục Push ở trên): người nhận = thành viên đang hoạt động khác người gửi, không có kết nối WebSocket, và (không tắt thông
báo HOẶC được nhắc - tên riêng hay `@Tất cả`). Người được nhắc nhận `body` = `Nhắc đến bạn: ` + `previewBody(...)` (cắt 100 ký tự như cũ),
`title` như cũ, và KHÔNG bị gộp 3 giây (job push riêng cho nhóm người được nhắc). Người không được nhắc giữ luật cũ.

**Giải tán** (`POST /conversations/:id/disband`, chỉ owner). Chọn GIỮ tin (chỉ đọc), không xoá: xoá hàng loạt tin / ghim / tệp của nhóm
1000 người dưới khoá dòng hội thoại tốn và không lấy lại được, tệp còn tin dùng không được janitor xoá, và người dùng vẫn cần tra lại lịch sử.
Trong MỘT transaction (khoá dòng hội thoại): chèn tin hệ thống `A đã giải tán nhóm` (khi mọi người còn là thành viên) -> `disbanded_at =
clock_timestamp()` -> mọi thành viên đang hoạt động `left_at = disbanded_at` (GIỮ `member_role`), `updated_at` -> thu hồi link hiệu lực
-> yêu cầu `pending` thành `cancelled`. Sau commit: `message.new` của tin hệ thống tới mọi thành viên cũ, rồi `conversation.updated`
(`disbanded: true`) tới họ, bỏ cache thành viên.
- Dòng "chỉ đọc" = `left_at = disbanded_at` (người rời TRƯỚC khi giải tán có `left_at` nhỏ hơn, vẫn là dòng `left` thường). Dòng chỉ đọc: hiện
  trong `GET /conversations` / `/sync` như hội thoại thường (tên, ảnh, tin cuối...) với `disbanded: true`, `left: false`, `member_count: 0`,
  `unread: 0`, `unread_mention: false`, `settings` của lúc giải tán; không tính vào badge push. Đọc được: `GET /conversations/:id` (`members: []`,
  `pending_join_requests: 0`), `/messages`, `/pins`, `GET /media/:id` của tin / ảnh nhóm, `GET .../invite-link` (luôn null).
- Mọi thao tác ghi khác trên nhóm đã giải tán -> 410 `GROUP_DISBANDED` `Nhóm đã bị giải tán`: `message.send`, `message.delivered` /
  `message.read` (client không gửi con trỏ cho nhóm `disbanded`), PATCH thông tin / cài đặt, thêm / xoá người khác / đổi vai trò, chuyển trưởng
  nhóm, giải tán lần nữa, link mời, duyệt yêu cầu, ghim / bỏ ghim, `PUT .../mute`. `typing.*`: bỏ qua im lặng.
  410 chỉ dành cho dòng chỉ đọc; người đã rời / bị xoá trước khi giải tán hoặc đã gỡ nhóm khỏi danh sách nhận 403 `FORBIDDEN` như
  người ngoài (kể cả `message.send` / con trỏ qua WS).
- Gỡ khỏi danh sách: `DELETE /conversations/:id/members/<mình>` -> `left_at = now()` (khác `disbanded_at`), không tin hệ thống -> `{}`;
  sau đó dòng thành `left: true`, `disbanded: false` như rời nhóm thường (hết đọc lịch sử). Giao diện: nút "Xoá khỏi danh sách" thay ô soạn
  tin, dòng chữ `Nhóm đã bị giải tán`.

**Link mời / tham gia.**
- `GET /invites/:token` và `POST /invites/:token/join`: token phải khớp `^[A-Za-z0-9_-]{43}$`, không khớp -> 404 `INVITE_INVALID` (không
  đọc DB); tra theo sha256 hex; không có / đã thu hồi (kể cả do giải tán) -> 404 `INVITE_INVALID` `Link mời không tồn tại hoặc đã bị thu hồi`;
  quá `expires_at` -> 410 `INVITE_EXPIRED` `Link mời đã hết hạn`. Preview 60 lần / phút / người, join 20 lần / giờ / người (`RATE_LIMIT`).
- Join, theo thứ tự sau các kiểm trên (khoá dòng hội thoại): đã là thành viên đang hoạt động -> `already_member`; có quan hệ chặn (hai chiều)
  giữa người xin với trưởng nhóm HOẶC người tạo link -> 403 `BLOCKED` `Bạn không thể tham gia nhóm này`; link `requires_approval` -> tạo
  (hoặc trả lại) yêu cầu `pending`, gửi `join_requests.updated` -> `pending`; nhóm đủ 1000 người -> 409 `GROUP_FULL`
  `Nhóm đã đủ 1000 thành viên`; còn lại vào nhóm như `AddMembers` (vai trò member, con trỏ đã nhận / đã xem = `last_seq`, xoá `muted_until`,
  người đã rời được vào lại) + tin hệ thống + `use_count + 1` -> `joined`. KHÔNG cần là bạn bè của ai.
- Duyệt: yêu cầu không có / không còn `pending` / thuộc nhóm khác -> 404 `NOT_FOUND` `Yêu cầu không còn chờ duyệt`; người xin đã là thành viên
  -> yêu cầu `approved`, không tin hệ thống; kiểm lại chặn như lúc xin vào (chặn phát sinh sau khi xin) -> 403 `BLOCKED`
  `Bạn không thể tham gia nhóm này` (yêu cầu vẫn chờ); nhóm đủ -> 409 `GROUP_FULL`; còn lại vào nhóm như join + tin hệ thống + `use_count + 1` của link
  đã dùng. Duyệt / từ chối gửi `join_requests.updated`. Yêu cầu `pending` vẫn duyệt được sau khi link bị thu hồi.
- Tạo link: 30 lần / giờ / người (`RATE_LIMIT`); `expires_in` ngoài 3600..2592000 -> 400 `expires_in phải từ 3600 đến 2592000 giây`.
  Tạo / thu hồi link KHÔNG sinh tin hệ thống. Tối đa 1 link hiệu lực mỗi nhóm (unique index một phần).

**Gói WebSocket mới / đổi** (server -> client; gửi qua bộ chạy tuần tự theo hội thoại, SAU `message.new` của tin hệ thống cùng thao tác):

| Gói | `data` | Khi nào / tới ai |
|---|---|---|
| `message.send` (client -> server) | thêm `mentions?: [Mention]` | luật ở "Định dạng @nhắc tên"; `ack` thêm `mentions` |
| `conversation.updated` | `{conversation_id, name, description, avatar, settings, disbanded, updated_at}` (giống nhau với mọi người nhận) | đổi tên / ảnh / mô tả, đổi cài đặt, giải tán; tới mọi thành viên đang hoạt động (giải tán: mọi thành viên lúc giải tán). Client ghi đè các khoá này của hội thoại |
| `members.updated` | `{conversation_id, member_count}` | thêm người, xoá / rời, đổi vai trò, chuyển trưởng nhóm, vào qua link, được duyệt; tới thành viên đang hoạt động (sau thay đổi). Client cập nhật `member_count`; đang mở chi tiết / bảng thông tin thì tải lại `GET /conversations/:id` (vai trò của chính mình có thể đã đổi) |
| `join_requests.updated` | `{conversation_id, pending_count}` | có yêu cầu mới, duyệt, từ chối, huỷ (do thêm trực tiếp / giải tán); chỉ tới owner / admin đang hoạt động |

Người được duyệt / vào qua link nhận `message.new` của tin hệ thống như thành viên mới (client chưa biết hội thoại thì tải `GET
/conversations/:id` như với `chatAddMembers`). `/sync` thấy mọi thay đổi trên vì mỗi thao tác đều chèn tin hệ thống (đẩy `updated_at`) hoặc
đổi dòng thành viên. Sau mỗi `auth.ok` + `/sync`, client tải lại ghim (`GET .../pins`) của hội thoại đang mở (gói `pins.updated` có thể đã
lỡ khi mất kết nối).

**Tin hệ thống** (`message_type: "system"`, người gửi = người thao tác; mỗi thay đổi một tin, PATCH đổi nhiều khoá thì theo thứ tự
tên -> ảnh -> mô tả; giá trị như cũ thì không có tin):

| Thao tác | Nội dung |
|---|---|
| Đổi tên (không đổi) | `A đã đổi tên nhóm thành “N”` |
| Đặt / đổi ảnh nhóm | `A đã đổi ảnh đại diện nhóm` |
| Xoá ảnh nhóm | `A đã xoá ảnh đại diện nhóm` |
| Đặt / đổi mô tả | `A đã cập nhật mô tả nhóm` |
| Xoá mô tả | `A đã xoá mô tả nhóm` |
| Bật / tắt `admins_only_send` | `A đã bật chế độ chỉ trưởng / phó nhóm được gửi tin` / `A đã tắt chế độ chỉ trưởng / phó nhóm được gửi tin` |
| Bật / tắt `admins_only_edit_info` | `A đã bật chế độ chỉ trưởng / phó nhóm được đổi thông tin nhóm` / `A đã tắt chế độ ...` (cùng đuôi) |
| Bật / tắt `admins_only_add_members` | `A đã bật chế độ chỉ trưởng / phó nhóm được thêm thành viên` / `A đã tắt chế độ ...` (cùng đuôi) |
| Chuyển trưởng nhóm | `A đã chuyển quyền trưởng nhóm cho B` |
| Giải tán | `A đã giải tán nhóm` |
| Vào qua link (không cần duyệt) | `B đã tham gia nhóm qua link mời` (người gửi = B) |
| Duyệt yêu cầu | `A đã duyệt B vào nhóm` |

**Kiểm đầu vào khác:**
- `description`: cắt khoảng trắng hai đầu, rỗng -> xoá; > 500 ký tự (rune) hoặc có NUL -> 400 `Mô tả nhóm tối đa 500 ký tự`.
- `avatar_media_id`: tệp phải của chính người đổi, `media_type = "image"`, `status = "ready"`: không có / của người khác -> 404 `MEDIA_NOT_FOUND`;
  chưa ready -> 409 `MEDIA_NOT_READY`; không phải ảnh -> 400 `Ảnh nhóm phải là tệp ảnh`; máy chủ tắt tệp (chỉ khi đặt ảnh, xoá ảnh luôn được)
  -> 503 `MEDIA_DISABLED`. Client tải ảnh qua `upload-url` / `complete` (loại `image`, nên cắt vuông ≤ 512 px trước) rồi PATCH.
- `chatTransferOwnership`: `user_id` thiếu / ≤ 0 -> 400 `Thiếu user_id`; là mình -> 400 `Bạn đã là trưởng nhóm`; không phải thành viên
  đang hoạt động -> 404 `NOT_FOUND` `Người này không còn trong nhóm`.

**Mã lỗi mới:**

| Mã | HTTP | Khi nào |
|---|---|---|
| `GROUP_DISBANDED` | 410 | thao tác ghi / `message.send` / con trỏ trên nhóm đã giải tán |
| `GROUP_FULL` | 409 | vào qua link / duyệt khi nhóm đã 1000 thành viên đang hoạt động |
| `INVITE_INVALID` | 404 | token sai dạng / không có / đã thu hồi |
| `INVITE_EXPIRED` | 410 | link quá `expires_at` |

**Giới hạn:** mô tả 500 ký tự; 50 lượt nhắc tên / tin; nhóm 1000 thành viên (kể cả vào qua link); link hết hạn sau 1 giờ..30 ngày hoặc không
hết hạn; tối đa 1 link hiệu lực / nhóm; tạo link 30 lần / giờ, preview 60 lần / phút, join 20 lần / giờ mỗi người; hàng chờ trả tối đa 500.

**Giao diện - đường dẫn tham gia:** `/chat/join/:token` (thêm `<Route path="chat/join/:token" element={<Chat />} />` cạnh route `chat`
trong `frontend/src/App.jsx`; Caddy đã `try_files {path} /index.html`). Trang gọi `GET /invites/:token` bằng tài khoản đang chọn của tab,
hiện ảnh, tên, mô tả, số thành viên và nút `Tham gia nhóm` / `Gửi yêu cầu tham gia` (theo `requires_approval`); `membership: "member"` ->
nút `Mở nhóm`, `"pending"` -> `Đang chờ duyệt`. Chưa đăng nhập chat: giữ token ở sessionStorage `chat_join_token`, qua màn đăng nhập rồi quay
lại. Vào được (`joined` / `already_member`) -> `navigate('/chat#c' + conversation_id, {replace: true})`.

**Giai đoạn 2: trả lời, chuyển tiếp, thu hồi, sửa, reaction, tìm kiếm, đa thiết bị** (migration 0023; kiểu Go trong `dto_phase2.go` + khoá
mới trong `dto.go`, mã lỗi trong `errors.go`, giới hạn là hằng trong `dto_phase2.go`). Thao tác trên tin đi qua REST (lỗi rõ ràng,
idempotent); chỉ `message.send` của WebSocket đổi (thêm `reply_to_message_id`). Mọi thay đổi được đẩy tới MỌI thiết bị của mọi thành
viên đang hoạt động (kể cả các thiết bị khác của người thao tác) qua gói WebSocket mới, và bù được khi mất kết nối qua `/sync` + `changes`.

Route mới / đổi (đường dẫn tính từ `/api/v1/chat`; `:message_id` = id tin (duy nhất toàn hệ thống), `:device_id` = id thiết bị):

| Method | Đường dẫn | `Name` | Quyền | Thân / query -> kết quả |
|---|---|---|---|---|
| `PATCH` | `/messages/:message_id` | `chatEditMessage` | SelfAuth | `{content, mentions?}` -> Message sau khi sửa (có `edited_at`, `reactions`). Luật: "Sửa tin" |
| `POST` | `/messages/:message_id/recall` | `chatRecallMessage` | SelfAuth | thân rỗng -> Message đã thu hồi (`recalled: true`). Đã thu hồi rồi -> trả lại Message đó (idempotent). Luật: "Thu hồi" |
| `POST` | `/messages/:message_id/forward` | `chatForwardMessage` | SelfAuth | `{targets: [{conversation_id, client_msg_id}]}` (1..20, không trùng hội thoại) -> `{results: [{conversation_id, ok, ack?, error?: {code, message}}]}` đúng thứ tự `targets`. Luật: "Chuyển tiếp" |
| `PUT` | `/messages/:message_id/reaction` | `chatSetReaction` | SelfAuth | `{reaction: "like" \| "love" \| "haha" \| "wow" \| "sad" \| "angry"}` -> ReactionSummary của tin (đặt mới hoặc thay reaction cũ của mình; giống cũ -> không đổi gì) |
| `DELETE` | `/messages/:message_id/reaction` | `chatRemoveReaction` | SelfAuth | -> ReactionSummary (chưa thả -> giữ nguyên, idempotent) |
| `GET` | `/messages/:message_id/reactions` | `chatListReactions` | SelfAuth | -> `{message_id, reactions: [{user_id, display_name, reaction, created_at}]}` mới trước (tối đa 1000 = cỡ nhóm) |
| `GET` | `/conversations/:id/messages?around_seq=` | `chatListMessages` (thêm query) | SelfAuth | `around_seq` (+ `limit`, mặc định 50, tối đa 100): tin quanh seq đó -> `{messages, has_more, has_newer}`. Luật: "Nhảy tới tin" |
| `GET` | `/conversations/:id/messages/changes?since=&cursor=&limit=` | `chatMessageChanges` | SelfAuth | tin đã sửa / thu hồi / đổi reaction sau mốc -> `{messages: [Message], next_cursor}`. Luật: "Đồng bộ thay đổi" |
| `GET` | `/conversations/:id/messages/search?q=&cursor=&limit=` | `chatSearchConversationMessages` | SelfAuth | tìm trong một hội thoại -> `{hits: [SearchHit], next_cursor}` |
| `GET` | `/search/messages?q=&cursor=&limit=` | `chatSearchMessages` | SelfAuth | tìm trong mọi hội thoại tôi xem được -> `{hits: [SearchHit], next_cursor}` |
| `GET` | `/devices` | `chatListDevices` | SelfAuth | -> `{devices: [Device]}` (thiết bị hiện tại trước, rồi `last_seen_at` mới trước) |
| `DELETE` | `/devices/:device_id` | `chatRevokeDevice` | SelfAuth | đăng xuất từ xa một thiết bị khác của tôi -> `{}` |
| `POST` | `/devices/logout-others` | `chatRevokeOtherDevices` | SelfAuth | đăng xuất mọi thiết bị khác của tôi -> `{revoked: n}` |
| `POST` | `/auth/qr/start` | `chatQrStart` | Public | `{device: {platform, name}}` -> `{qr_id, code, poll_token, expires_in: 120, poll_interval: 2}` |
| `POST` | `/auth/qr/poll` | `chatQrPoll` | Public | `{qr_id, poll_token}` -> `{status, expires_in, approver?: {display_name} (chỉ khi approved), auth?: AuthResult}` |
| `POST` | `/auth/qr/scan` | `chatQrScan` | SelfAuth | `{code}` -> QRSession (thông tin máy đang chờ, cho màn xác nhận) |
| `POST` | `/auth/qr/approve` | `chatQrApprove` | SelfAuth | `{code}` -> `{status: "approved"}` |
| `POST` | `/auth/qr/reject` | `chatQrReject` | SelfAuth | `{code}` -> `{status: "rejected"}` |

Route cũ đổi hành vi: `POST /auth/otp/verify` ghi thêm `user_agent` (header `User-Agent`, cắt 500 ký tự), `last_ip` (IP request),
`login_method = "otp"` cho thiết bị mới và gửi `devices.updated {reason: "login"}` tới các thiết bị khác của tài khoản; `POST /auth/refresh`
cập nhật `last_ip` (Go: `RefreshFrom(ctx, token, ip)`, `Refresh` = `RefreshFrom(..., "")`); `POST /auth/logout` gửi `devices.updated
{reason: "logout"}` tới các thiết bị còn lại. Tổng route REST chat tăng 17 (bảng trên trừ `chatListMessages`).

Object mới / khoá mới (khoá vắng = false / null; JSON chỉ thêm khoá, không đổi khoá cũ):
- **Message** thêm: `reply_to?: ReplyPreview`, `forwarded?: true`, `edited_at?: thời điểm`, `recalled?: true`, `recalled_by?: user_id`,
  `reactions?: ReactionSummary`. `reactions` CHỈ có ở REST (`messages` mọi chế độ, `changes`, kết quả sửa / thu hồi) và chỉ khi tin có
  ít nhất một reaction; `message.new` không có (tin mới chưa có reaction), `message.updated` không có (giữ reaction đang có).
  Tin đã thu hồi: `content: ""`, không `attachments` / `mentions` / `reply_to` / `edited_at`, `forwarded` false, `recalled: true`,
  `recalled_by`. `last_message` của Conversation mang đủ các khoá trên trừ `reactions` và `reply_to`.
- **ReplyPreview** `{message_id, seq, sender_id, sender_name, msg_type, content, file_name?, recalled}`: dựng lúc đọc từ tin gốc
  (luôn là bản mới nhất: tin gốc sửa thì preview đổi theo); `content` văn bản thuần tối đa 200 ký tự (không mentions; tin tệp = chú thích,
  có thể rỗng), `file_name` chỉ tin `file`; tin gốc đã thu hồi -> `recalled: true`, `content: ""`, không `file_name`.
- **ReactionSummary** `{counts: {"like": 2, "love": 1}, total, mine}`: `counts` chỉ chứa code > 0; `mine` = code của người xem hoặc null.
  Giao diện: like 👍 `Thích`, love ❤️ `Yêu thích`, haha 😆 `Haha`, wow 😮 `Wow`, sad 😢 `Buồn`, angry 😡 `Phẫn nộ`.
- **SearchHit** `{conversation_id, conversation_type, conversation_name, message_id, seq, sender_id, sender_name, msg_type, content,
  file_name?, created_at}`: `conversation_name` = tên nhóm / tên người kia của chat 1-1; `content` đầy đủ (client tự cắt đoạn quanh từ khớp
  và tô đậm bằng cùng luật bỏ dấu); không có `attachments`.
- **Device** `{id, platform, name, user_agent, last_ip, login_method: "otp" | "qr", push, online, current, last_seen_at, created_at}`:
  `online` = thiết bị đang có kết nối WebSocket (gateway cài `OnlineDevices`); `current` = thiết bị của chính request.
- **QRSession** `{qr_id, status, platform, device_name, user_agent, request_ip, created_at, expires_at, expires_in}`.

`message.send` thêm `reply_to_message_id?: id` (0 / vắng = không trả lời): tin phải cùng hội thoại (khác / không có -> 404 `NOT_FOUND`
`Không tìm thấy tin nhắn`), không phải tin hệ thống (400 `Không trả lời được tin hệ thống`), chưa thu hồi (410 `MESSAGE_RECALLED`). Dùng được
với mọi `msg_type`. `ack` thêm `reply_to` (như đã lưu); gửi trùng `client_msg_id` -> `reply_to` của tin cũ. Push của tin trả lời như tin thường.

Gói WebSocket server -> client mới (gửi qua bộ chạy tuần tự theo hội thoại SAU commit, nên đúng thứ tự với `message.new` của cùng hội thoại;
tới mọi kết nối của thành viên đang hoạt động, gồm các thiết bị khác của người thao tác):

| Gói | `data` | Khi nào |
|---|---|---|
| `message.updated` | `{conversation_id, action: "edit" \| "recall", message: Message}` (`message` không có `reactions`) | tin được sửa / thu hồi. Client thay tin theo `(conversation_id, seq)`, giữ `reactions` cũ (recall: xoá); sửa `reply_to` của các tin đang trích tin này (edit: `content`; recall: `recalled: true`, `content: ""`); cập nhật `last_message` nếu trùng id |
| `reactions.updated` | `{conversation_id, message_id, seq, counts, total, user_id, reaction}` (`reaction` null = vừa bỏ) | reaction của một tin đổi. Client thay `counts` / `total`; `user_id` là mình thì `mine = reaction` |
| `devices.updated` | `{reason: "login" \| "logout" \| "revoked", device_id}` | CHỈ tới các kết nối của chính tài khoản: có thiết bị mới đăng nhập (OTP / QR), thiết bị đăng xuất, bị đăng xuất từ xa. Bảng thiết bị đang mở thì tải lại `GET /devices` |
| `force_logout` (không đổi) | `{}` | thiết bị bị đăng xuất từ xa / thu hồi; đóng 4403 ngay sau đó (client đã xử lý: xoá phiên của tài khoản đó) |
| `pins.updated` (không đổi) | | thêm hai trường hợp: tin đang ghim bị thu hồi (bỏ ghim, không tin hệ thống), tin đang ghim được sửa (nội dung mới) |
| `receipt.update` (không đổi) | | đã có: con trỏ đã nhận / đã xem đổi -> gửi cả tới các thiết bị khác của chính mình (đồng bộ chưa đọc giữa điện thoại và máy tính) |

**Ma trận quyền** (kiểm ở server; giao diện ẩn nút theo cùng bảng). "Đang hoạt động" = thành viên chưa rời; nhóm đã giải tán -> 410
`GROUP_DISBANDED` cho mọi thao tác ghi dưới đây (đọc / tìm / xem reaction vẫn được với dòng chỉ đọc); đã rời / không là thành viên -> 403
`FORBIDDEN` `Bạn không còn trong cuộc trò chuyện này`; tin không thuộc hội thoại nào tôi xem được -> 404 `NOT_FOUND` `Không tìm thấy tin nhắn`
(không lộ tin tồn tại).

| Thao tác | Ai được | Điều kiện khác |
|---|---|---|
| Trả lời | ai gửi được tin vào hội thoại (luật `message.send`, gồm `admins_only_send`, chặn) | tin gốc cùng hội thoại, không phải tin hệ thống, chưa thu hồi |
| Sửa | CHỈ người gửi, thành viên đang hoạt động | `msg_type = "text"` (ảnh / video / tệp / thoại / hệ thống -> 400 `Chỉ sửa được tin nhắn văn bản`); trong 24 giờ từ `created_at` (quá -> 403 `MESSAGE_TOO_OLD` `Chỉ sửa được tin nhắn gửi trong vòng 24 giờ`); chưa thu hồi (410); nhóm bật `admins_only_send` mà mình là member -> 403 như gửi tin; chat 1-1 đang chặn -> 403 `BLOCKED` |
| Thu hồi tin của mình | người gửi (mọi vai trò, cả chat 1-1) | trong 24 giờ (quá -> 403 `MESSAGE_TOO_OLD` `Chỉ thu hồi được tin nhắn gửi trong vòng 24 giờ`); thu hồi được cả khi đang bị chặn / `admins_only_send` |
| Thu hồi tin người khác (kiểm duyệt nhóm) | owner: tin của mọi người khác; admin: tin của người có vai trò hiện tại `member` hoặc đã rời nhóm | KHÔNG giới hạn thời gian; chỉ trong nhóm (chat 1-1 -> 403 `Bạn chỉ thu hồi được tin của mình`); admin thu hồi tin của owner / admin khác -> 403 `Bạn không có quyền thu hồi tin này` |
| Chuyển tiếp | người đọc được tin nguồn (thành viên đang hoạt động hoặc dòng chỉ đọc của nhóm đã giải tán) | từng đích theo đúng luật `message.send` của đích |
| Reaction | thành viên đang hoạt động (kể cả member khi nhóm bật `admins_only_send`) | không với tin hệ thống (400 `Không thả cảm xúc cho tin hệ thống`) / tin đã thu hồi (410); chat 1-1 đang chặn -> 403 `BLOCKED` |
| Tìm tin, xem reaction, nhảy tới tin, `changes` | thành viên đang hoạt động hoặc dòng chỉ đọc của nhóm đã giải tán | |

**Sửa tin** (`PATCH /messages/:message_id`): `content` cắt khoảng trắng hai đầu, 1..4000 ký tự, không NUL (sai -> 400 như `message.send`);
`mentions` kiểm lại TOÀN BỘ như `message.send` (offset trên content mới; chỉ nhóm; `@Tất cả` chỉ owner / admin); content và mentions như cũ ->
trả tin, không đổi gì, không gói. Có đổi: ghi `content`, `mentions`, `edited_at = now()`, `updated_at = now()`, `chat_conversations.updated_at
= now()` trong một transaction; người MỚI được nhắc có `last_mention_seq` nâng lên seq của tin (không hạ của người bị bỏ nhắc); KHÔNG push,
KHÔNG tin hệ thống. Sau commit: `message.updated {action: "edit"}`, và `pins.updated` nếu tin đang ghim. Hạn mức: sửa + thu hồi 30 lần / phút /
người (429 `RATE_LIMIT` `Bạn thao tác quá nhanh, thử lại sau`).

**Thu hồi** (`POST /messages/:message_id/recall`): một transaction (khoá dòng hội thoại): `content = ''`, `mentions`, `media_id`, `file_name`
-> null (XOÁ thật, không lấy lại được; tệp không còn tin nào dùng sẽ bị janitor dọn sau 24 giờ), `recalled_at = now()`, `recalled_by`,
`updated_at = now()`, `chat_conversations.updated_at = now()`; xoá reaction của tin; bỏ ghim nếu đang ghim. `edited_at` giữ nguyên trong DB nhưng
không trả ra. Không tin hệ thống, không push; push đang xếp hàng (cửa sổ gộp 3 giây) của tin này bị bỏ (`runPush` kiểm `recalled_at`).
`seq`, con trỏ đã nhận / đã xem, số chưa đọc KHÔNG đổi; `last_mention_seq` không hạ. Tin đã thu hồi không chuyển tiếp / trả lời / sửa /
thả cảm xúc được (410 `MESSAGE_RECALLED`), không ghim được (410), không ra trong tìm kiếm. Sau commit: `message.updated {action: "recall"}`,
`pins.updated` nếu vừa bỏ ghim.

**Chuyển tiếp** (`POST /messages/:message_id/forward`): tin nguồn phải đọc được (404 / 403 như ma trận), không phải tin hệ thống (400
`Không chuyển tiếp được tin hệ thống`), chưa thu hồi (410). `targets` rỗng / > 20 -> 400 `Chọn từ 1 đến 20 cuộc trò chuyện`; trùng
`conversation_id` -> 400 `Mỗi cuộc trò chuyện chỉ chọn một lần`; `client_msg_id` không phải UUID -> 400 (cả request). Mỗi đích là MỘT tin mới
(transaction riêng, lỗi của đích này không chặn đích khác): cùng `msg_type`, `content` (chú thích), `file_name`, `media_id` của tin nguồn
(KHÔNG tải lại tệp: dùng chung object; tệp phải `ready`, máy chủ tắt tệp -> lỗi `MEDIA_DISABLED` ở đích đó), `is_forwarded = true`,
không `mentions`, không `reply_to`. Mỗi đích kiểm như `message.send` (thành viên, giải tán 410, `admins_only_send`, chặn) và tốn 1 lượt
hạn mức gửi tin (20 / giây; hết -> lỗi `RATE_LIMIT` ở các đích còn lại). Gửi lại cùng `client_msg_id` cho cùng đích -> `ack` của tin cũ
(`duplicate: true`). Mỗi tin mới phân phối như tin thường (`message.new` + push, body push như tin thường). Quyền đọc tệp của người nhận có
sẵn (thành viên hội thoại có tin dùng `media_id`). Lỗi của một đích: `{ok: false, error: {code, message}}` cùng mã / câu như REST.

**Nhảy tới tin** (`around_seq`): `around_seq` > 0 (khác -> 400), không dùng cùng `before_seq` / `after_seq` (400 `Chỉ dùng một trong
before_seq / after_seq / around_seq`). Trả tin seq trong khoảng `[S - floor(limit/2), ...]` gồm S (S lớn hơn `last_seq` -> kẹp về `last_seq`),
tăng dần theo seq, tối đa `limit`; `has_more` = còn tin cũ hơn, `has_newer` = còn tin mới hơn (khoá `has_newer` chỉ có ở chế độ này).
Client thay danh sách cục bộ bằng trang này khi S nằm ngoài khoảng đang có (rồi lấp chỗ hở bằng `after_seq` như cũ), cuộn tới S và tô sáng 2 giây.

**Đồng bộ thay đổi** (`GET /conversations/:id/messages/changes`): `since` = `sync_cursor` (mili giây) mà client đã dùng cho lần `/sync`
trước (máy chủ trừ 10 giây chồng lấn như `/sync`), hoặc `cursor` = `next_cursor` của trang trước (`cursor` thắng `since`; thiếu cả hai /
sai dạng -> 400). Trả tin có `updated_at >= mốc`, cũ trước theo `(updated_at, id)`, `limit` mặc định 100, tối đa 200; còn nữa thì
`next_cursor` (chuỗi mờ) khác null. Sau mỗi `auth.ok` + `/sync`: với mỗi hội thoại trong kết quả `/sync` mà client đang giữ tin trong bộ
nhớ, gọi `changes` (lặp theo `next_cursor`) rồi thay các tin đã có theo `seq` (KHÔNG chèn tin chưa có - tránh tạo chỗ hở). Sửa / thu hồi /
reaction đều đẩy `chat_conversations.updated_at` nên `/sync` luôn trả hội thoại đó.

**Xem trước / chữ hiển thị** (giao diện; máy chủ không dựng chữ trừ push):
- Bong bóng: tin thu hồi `Tin nhắn đã bị thu hồi` (`recalled_by` khác `sender_id`: `Tin nhắn đã bị trưởng / phó nhóm thu hồi`); nhãn nhỏ
  `Đã chỉnh sửa` (có `edited_at`), `Đã chuyển tiếp` (có `forwarded`); khung trích dẫn = `sender_name` + `content` (rỗng: nhãn tệp như
  `previewBody` - `[Hình ảnh]`, `[Video]`, `[Tệp] <tên>`, `[Tin nhắn thoại]`) hoặc `Tin nhắn đã bị thu hồi`; bấm khung -> nhảy tới tin gốc.
- Danh sách hội thoại: `last_message` thu hồi -> `Tin nhắn đã bị thu hồi` với tiền tố như cũ (`Bạn: ` / `Lan: `); đã sửa -> nội dung mới.
- Thanh soạn tin: đang trả lời `Đang trả lời <tên>` + đoạn trích + nút huỷ; đang sửa `Chỉnh sửa tin nhắn` + nút huỷ (Esc).
- Menu tin: `Trả lời`, `Chuyển tiếp`, `Sao chép`, `Chỉnh sửa`, `Thu hồi`, `Ghim` / `Bỏ ghim`; hỏi lại trước khi thu hồi:
  `Thu hồi tin nhắn này với mọi người?`.
- Push: không có push cho sửa / thu hồi / reaction.

**Tìm tin** (`GET /search/messages`, `GET /conversations/:id/messages/search`; code `service_search.go`):
- Chuẩn hoá (giống hệt ở SQL `chat_search_fold`, Go `foldVN`, giao diện): chữ thường -> bỏ dấu tổ hợp U+0300..U+036F (chuỗi NFD) -> chữ
  có dấu dựng sẵn về không dấu, `đ` -> `d` -> mọi chuỗi ký tự không phải chữ / số thành một khoảng trắng.
- `q`: tối đa 100 ký tự (quá -> 400 `Từ khoá tối đa 100 ký tự`); sau chuẩn hoá tách theo khoảng trắng, lấy 8 từ đầu; tổng số ký tự các từ
  < 2 -> 400 `Nhập ít nhất 2 ký tự để tìm`. Mỗi từ khớp TIỀN TỐ của một từ trong tin, mọi từ phải có (AND), không phân biệt dấu / hoa
  thường, thứ tự tuỳ ý: `bao gi` khớp `Báo giá`, `nguyen` khớp `NGUYỄN`, `xlsx` khớp tệp `bao_gia.xlsx`. tsquery = `'tu1':* & 'tu2':*`
  với `to_tsquery('simple', ...)`; tài liệu = `to_tsvector('simple', chat_search_fold(content || ' ' || coalesce(file_name, '')))` - đúng
  biểu thức của index GIN `idx_chat_messages_content_file_name` (hằng `searchDocSQL` / `searchFilterSQL`).
- Phạm vi: tin trong hội thoại mà tôi đang hoạt động hoặc là dòng chỉ đọc của nhóm đã giải tán (như `GET .../messages`; đã rời thì không
  tìm được tin cũ); trong một hội thoại: không xem được -> 403. Bỏ tin hệ thống và tin đã thu hồi; khớp nội dung văn bản, chú thích ảnh /
  video / tệp và tên tệp (tin thoại không có chữ).
- Thứ tự: MỚI TRƯỚC (`message_id` giảm dần) - không xếp hạng độ khớp (người dùng chat tìm tin gần đây; phân trang ổn định).
  `limit` mặc định 20, tối đa 50; `cursor` = `next_cursor` của trang trước (chuỗi mờ; sai dạng -> 400); hết thì `next_cursor` null.
- Hạn mức 30 lần tìm / phút / người (429 `RATE_LIMIT` `Bạn tìm kiếm quá nhanh, thử lại sau`).
- Bấm một kết quả -> mở hội thoại + `around_seq` = `seq` của kết quả.

**Đa thiết bị** (`CHAT.md` mục 11):
- `GET /devices`: thiết bị của tôi còn phiên (có refresh token chưa hết hạn, chưa dùng) + thiết bị hiện tại; `push` = có push token.
- `DELETE /devices/:device_id`: thiết bị không phải của tôi / không có -> 404 `NOT_FOUND` `Không tìm thấy thiết bị`; là thiết bị hiện tại
  -> 400 `Dùng Đăng xuất để thoát thiết bị này`. Xoá dòng `chat_devices` (kéo theo refresh token + push token), bỏ cache thiết bị, gateway
  `CloseDevice` -> gói `force_logout` + đóng 4403 mọi kết nối của thiết bị đó (access token còn hạn bị từ chối ngay vì middleware kiểm thiết
  bị còn tồn tại; refresh -> 401 `REFRESH_INVALID`), rồi `devices.updated {reason: "revoked", device_id}` tới các thiết bị còn lại.
- `POST /devices/logout-others`: như trên cho mọi thiết bị khác thiết bị hiện tại -> `{revoked: n}`.
- Đồng bộ giữa thiết bị: `message.new` tới mọi thiết bị của người nhận và các thiết bị khác của người gửi; `receipt.update` tới các thiết bị
  của chính mình; `message.updated` / `reactions.updated` / `pins.updated` / `conversation.updated` tới mọi thiết bị của thành viên; lỡ gói
  khi mất mạng -> `/sync` + `changes` + `after_seq`. Thiết bị mới tải lịch sử từ máy chủ (không đồng bộ máy - máy).

**Đăng nhập bằng QR** (`CHAT.md` mục 11 bước 3; code `service_qrlogin.go`, bảng `chat_qr_login_sessions`):

1. Máy mới (web / desktop, chưa đăng nhập) gọi `POST /auth/qr/start {device: {platform, name}}` -> `{qr_id, code, poll_token, expires_in:
   120, poll_interval: 2}`. `code` = 10 ký tự Crockford base32 (`0-9 A-Z` bỏ `I L O U`, 50 bit ngẫu nhiên, `crypto/rand`), hiển thị
   `ABCDE-FGHJK`; máy chủ chỉ lưu HMAC-SHA256(khoá máy chủ, code). `poll_token` = 32 byte ngẫu nhiên base64url, chỉ máy mới giữ (lưu
   sha256), KHÔNG nằm trong QR. Máy chủ ghi `platform`, `name`, `User-Agent`, IP. Giới hạn 20 phiên / 10 phút / IP (429 `RATE_LIMIT`);
   phiên cũ hơn 24 giờ bị xoá ở lần start kế tiếp. Nội dung QR (giao diện dựng): `<origin>/chat/qr#<code>` - camera thường của điện thoại
   mở thẳng trang xác nhận trên web; mã nằm sau `#` nên không vào log máy chủ.
2. Máy mới hiện QR + mã gõ tay, đếm ngược, poll `POST /auth/qr/poll {qr_id, poll_token}` mỗi 2 giây (nhanh hơn 3 lần / 3 giây / qr_id ->
   429). `qr_id` / `poll_token` sai -> 404 `QR_INVALID`. Kết quả `status`: `pending` (chờ quét), `scanned` (KHÔNG kèm tên người quét - mở link tự gọi scan chưa phải đồng ý; hiện
   `Đã quét. Hãy xác nhận trên điện thoại`), `rejected` (`Đăng nhập đã bị từ chối`), `expired` (quá `expires_at`: `Mã đã hết hạn` +
   nút `Tạo mã mới`), `approved` + `auth` (= kết quả `otp/verify` không có `is_new`) - CHỈ một lần: cùng transaction (khoá dòng phiên) tạo
   `chat_devices` (`login_method = "qr"`, `platform` / `device_name` / `user_agent` / `last_ip` của phiên) + refresh token, chuyển phiên sang
   `consumed`; các lần poll sau -> `consumed` không có `auth`. Máy mới lưu phiên như sau `otp/verify` (`saveSession` + `signIn`).
3. Điện thoại / máy đã đăng nhập: quét QR (camera trong app: `BarcodeDetector`, không có thì thư viện `jsqr`) hoặc mở link, hoặc gõ mã
   (`Quét mã QR đăng nhập` trong menu tài khoản) -> `POST /auth/qr/scan {code}` (chấp nhận chữ thường, gạch nối, khoảng trắng, `O` -> `0`,
   `I` / `L` -> `1`, hoặc cả URL). Sai dạng / không có -> 404 `QR_INVALID`; hết hạn -> 410 `QR_EXPIRED`; đã được người khác quét hoặc đã
   duyệt / từ chối / dùng -> 409 `QR_USED`; người đã quét gọi lại -> trả lại thông tin (idempotent). Thành công: `pending -> scanned`, ghi
   `user_id` = người quét, trả QRSession. Hạn mức 20 lần quét / phút / người, tính cả mã sai (chống dò mã).
4. Màn xác nhận: `Đăng nhập Dezon Chat trên thiết bị mới?` + `device_name`, `platform`, `user_agent`, `request_ip`, giờ tạo + cảnh báo
   `Chỉ xác nhận nếu chính bạn đang đăng nhập trên thiết bị này. Không quét mã do người khác gửi.`; nút `Xác nhận đăng nhập` ->
   `POST /auth/qr/approve {code}`, `Từ chối` -> `POST /auth/qr/reject {code}`. Chỉ người đã quét (cùng `user_id`) duyệt / từ chối được (người
   khác -> 409 `QR_USED`); chưa quét -> 400 `Hãy quét mã trước`; hết hạn -> 410. Duyệt: `scanned -> approved`, `expires_at = greatest(expires_at,
   now() + 60 giây)` để máy mới kịp nhận; duyệt lại -> trả `approved` (idempotent).
5. Máy mới nhận token ở lần poll kế tiếp; máy chủ gửi `devices.updated {reason: "login", device_id}` tới các thiết bị khác của tài khoản.
An toàn: mã sống 2 phút, dùng một lần (khoá dòng + chuyển trạng thái), token chỉ trao cho bên có `poll_token` (người thấy QR không lấy được
phiên), người quét thấy thông tin thiết bị trước khi đồng ý, mọi lần quét / duyệt cần access token của tài khoản sẽ được đăng nhập.

**Mã lỗi mới:**

| Mã | HTTP | Khi nào |
|---|---|---|
| `MESSAGE_RECALLED` | 410 | sửa / trả lời / chuyển tiếp / thả cảm xúc / ghim tin đã thu hồi |
| `MESSAGE_TOO_OLD` | 403 | sửa / thu hồi tin của mình quá 24 giờ |
| `QR_INVALID` | 404 | mã QR sai dạng / không có; `qr_id` / `poll_token` sai |
| `QR_EXPIRED` | 410 | quét / duyệt / từ chối phiên quá `expires_at` |
| `QR_USED` | 409 | phiên đã được người khác quét, hoặc đã duyệt / từ chối / dùng |

**Giới hạn:** sửa / thu hồi tin của mình trong 24 giờ; sửa + thu hồi 30 lần / phút; chuyển tiếp tới 1..20 hội thoại / lần (mỗi đích 1 lượt
của 20 tin / giây); reaction 60 lần / phút; 1 reaction / người / tin, 6 loại; trích dẫn 200 ký tự; tìm 30 lần / phút, `q` 100 ký tự, 8 từ,
trang 20..50; `changes` trang 100..200; QR sống 2 phút (+60 giây sau duyệt), 20 phiên / 10 phút / IP, poll 3 lần / 3 giây, quét 20 lần / phút.
Không làm ở giai đoạn này: "xoá ở phía tôi", sửa chú thích ảnh / tệp, lịch sử các lần sửa, ảnh nhỏ trong khung trích dẫn, push khi có reaction.

**Giao diện - đường dẫn xác nhận QR:** `/chat/qr` (thêm `<Route path="chat/qr" element={<Chat />} />` cạnh `chat/join/:token`); trang
đọc mã sau `#`, chưa đăng nhập chat thì qua cổng đăng nhập rồi quay lại (như link mời), rồi mở màn xác nhận (bước 3-4).

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
