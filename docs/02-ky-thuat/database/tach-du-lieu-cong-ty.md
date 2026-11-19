# Tách dữ liệu theo công ty (multi-tenant) - thiết kế database

Cách database và tầng dữ liệu bảo đảm công ty này không thấy, không sửa được dữ liệu công ty khác, lấy QS làm ví dụ. Đọc từ code và `infra/db/schema.sql` ngày 2026-11-18. Phần quyền người dùng xem [phan-quyen.md](../kien-truc/phan-quyen.md). Ví dụ từng câu SQL: [luong-truy-van-theo-cong-ty.md](luong-truy-van-theo-cong-ty.md).

## 1. Tóm tắt

- **Một database dùng chung cho mọi công ty.** Không có database hay schema riêng cho từng công ty.
- **Bảng cha có cột `company_id`** (khoá ngoại tới `companies`, `ON DELETE CASCADE`).
- **Bảng con không có `company_id`.** Công ty của dòng con lấy theo dòng cha (dòng bóc tách lấy theo dự án).
- **Việc lọc làm ở tầng dữ liệu của backend** (`backend/internal/platform/database`), không ở từng màn hình. Mọi truy vấn vào bảng có trong `TenantTables` tự thêm điều kiện công ty.
- **Database KHÔNG bật Row Level Security.** Lớp bảo vệ nằm ở code Go. Truy cập thẳng database (psql, script, SQL thô qua `DB.Pool()`) không bị lọc.

## 2. Ba lớp cấu thành

```mermaid
flowchart TB
    subgraph Code["Code Go (tên tiếng Việt)"]
        S["Service module<br/>vd projects, takeoff, materials"]
        R["Repository<br/>db.Select('du_an', ...)"]
    end
    subgraph DL["Tầng dữ liệu: backend/internal/platform/database"]
        MAP["db-map.json<br/>tên Việt -> tên Anh,<br/>khoá tenant của bảng con"]
        TT["TenantTables (postgres.go)<br/>61 bảng theo công ty"]
        SC["withScope / tenantFilter<br/>thêm cong_ty_id = TenantID"]
        VC["Cột ảo cong_ty_id của bảng con<br/>tra company_id của dòng cha"]
    end
    CTX["Ngữ cảnh request<br/>TenantID = công ty đang làm việc"]
    PG[("PostgreSQL<br/>tên bảng / cột tiếng Anh")]
    S --> R --> SC
    CTX --> SC
    MAP --> SC
    TT --> SC
    SC --> VC --> PG
    SC --> PG
```

| Thành phần | Vai trò | File |
|---|---|---|
| `TenantID` | Công ty đang làm việc: Super đã chọn "Xem như công ty" thì là công ty đó, người khác là công ty của mình | `backend/internal/shared/tenant/tenant.go:36-45` |
| `TenantTables` | Danh sách bảng (tên trong code) phải lọc theo công ty | `backend/internal/platform/database/postgres.go:38-51` |
| `db-map.json` | Dịch tên bảng / cột; bảng con khai `tenant: {via, parent, key}` để biết dòng cha | `backend/internal/platform/database/db-map.json` |
| `withScope` | Thêm `cong_ty_id=eq.<TenantID>` vào điều kiện của Select / Update / Remove | `postgres.go:276-301` |
| Cột ảo | Bảng con: `cong_ty_id` được dịch thành truy vấn con lấy `company_id` của dòng cha | `backend/internal/platform/database/catalog.go:87-91`, `:183-189` |

## 3. Các bảng của QS

### Sơ đồ quan hệ

```mermaid
erDiagram
    companies ||--o{ users : "company_id"
    companies ||--o{ projects : "company_id"
    companies ||--o{ products : "company_id"
    companies ||--o{ work_items : "company_id"
    companies ||--o{ purchase_orders : "company_id"
    companies ||--o{ purchase_proposals : "company_id"
    companies ||--o{ company_settings : "company_id (NULL = mặc định)"
    companies ||--o{ favorite_products : "company_id"
    projects ||--o{ quotation_lines : "project_code"
    projects ||--o{ cost_estimate_lines : "project_code"
    projects ||--o{ project_data_entries : "project_code"
    products ||--o{ product_combos : "product_id"
    products ||--o{ favorite_products : "product_id"
    products ||--o| product_specs : "product_id (6 bảng thông số ngành)"
    purchase_orders ||--o{ purchase_order_items : "order_code"
    purchase_proposals ||--o{ proposal_discount_items : "proposal_code"
    purchase_proposals ||--o{ proposal_payment_installments : "proposal_code"
```

### Bảng cha (có `company_id`)

| Tên trong code | Bảng trong DB | Nội dung | Khoá / index liên quan công ty |
|---|---|---|---|
| `du_an` | `projects` | Dự án | `fk_projects_company_id`; `idx_projects_company_id_created_at`; `project_code` duy nhất toàn hệ thống |
| `db_san_pham` | `products` (+ view `product_catalog`) | Sản phẩm của công ty | Duy nhất theo (`company_id`, `product_code`, ...) |
| `db_san_pham_history` | `product_histories` | Lịch sử sửa sản phẩm | `company_id` |
| `sp_yeu_thich` | `favorite_products` | Sản phẩm yêu thích | Duy nhất (`company_id`, `product_id`) |
| `cong_tac` / `cong_tac_history` | `work_items` / `work_item_histories` | Công tác dự toán và lịch sử | `idx_work_items_company_id_...` |
| `don_mua_hang` | `purchase_orders` | Đơn mua hàng | `order_code` duy nhất; index (`company_id`, `sent_at`) |
| `de_xuat` | `purchase_proposals` | Đề xuất mua hàng | `proposal_code` duy nhất; index (`company_id`, `sent_at`) |
| `cai_dat_cong_ty` | `company_settings` | Cài đặt chung của công ty (mẫu báo giá, chi phí, Marketing `mkAds`, Kinh doanh `kdOptions`...) | Duy nhất (`company_id`, `setting_key`) với `NULLS NOT DISTINCT` |
| `yeu_cau_sua_du_an` | `project_edit_requests` | Yêu cầu sửa dự án | `company_id` |
| `delete_requests`, `notifications`, `audit_log` | cùng tên (`audit_logs`) | Yêu cầu xoá, thông báo, nhật ký | `company_id` |
| `users` | `users` | Tài khoản | `company_id`; tên đăng nhập duy nhất toàn hệ thống |

### Bảng con (không có `company_id`, lấy theo dòng cha)

| Tên trong code | Bảng trong DB | Dòng cha (`tenant` trong db-map) |
|---|---|---|
| `db_bao_gia` | `quotation_lines` (dòng bóc tách) | `projects` qua `project_code` |
| `khai_toan` | `cost_estimate_lines` (tờ bìa) | `projects` qua `project_code` |
| `du_an_data` | `project_data_entries` (dữ liệu riêng từng dự án) | `projects` qua `project_code` |
| `sp_combo` | `product_combos` | `products` qua `product_id` |
| `chi_tiet_mua_hang` | `purchase_order_items` | `purchase_orders` qua `order_code` |
| `chi_tiet_de_xuat_ck`, `chi_tiet_de_xuat_tt` | `proposal_discount_items`, `proposal_payment_installments` | `purchase_proposals` qua `proposal_code` |

Mọi bảng con có khoá ngoại tới bảng cha với `ON DELETE CASCADE`: xoá dự án thì dòng bóc tách, tờ bìa, dữ liệu dự án mất theo.

Bảng không theo công ty: `companies` (chính danh sách công ty) và `system_settings` (`cai_dat_he_thong`, cài đặt mặc định toàn hệ thống do Super quản lý).

## 4. Luồng đọc

### Bảng cha: đọc danh sách dự án

```mermaid
sequenceDiagram
    participant A as Người dùng công ty A
    participant S as Service projects
    participant D as Tầng dữ liệu
    participant P as PostgreSQL
    A->>S: GET /api/v1/projects
    S->>D: Select("du_an", {})
    D->>D: du_an có trong TenantTables<br/>TenantID = A
    D->>P: select ... from projects where company_id = 'A'
    P-->>A: chỉ dự án của A
```

### Bảng con: đọc dòng bóc tách của một dự án

```mermaid
sequenceDiagram
    participant B as Người dùng công ty B
    participant D as Tầng dữ liệu
    participant P as PostgreSQL
    B->>D: Select("db_bao_gia", "ma_du_an=eq.DA-cua-A")
    D->>D: thêm cong_ty_id=eq.B<br/>cong_ty_id là cột ảo của bảng con
    D->>P: select ... from quotation_lines s<br/>where s.project_code = 'DA-cua-A'<br/>and (select company_id from projects<br/>where project_code = s.project_code) = 'B'
    P-->>B: 0 dòng (dự án thuộc A)
```

Biết mã dự án của công ty khác cũng không đọc được: điều kiện công ty luôn đi kèm.

## 5. Luồng ghi

```mermaid
flowchart TD
    I[Insert vào bảng X] --> T{X thuộc TenantTables?}
    T -->|không| N["Ghi bình thường<br/>(bảng không theo công ty)"]
    T -->|có| AT{"Người ghi không phải super<br/>mà không có công ty?"}
    AT -->|có| E1["Lỗi: Tài khoản chưa gắn với công ty nào"]
    AT -->|không| K{X là bảng cha hay bảng con?}
    K -->|bảng cha| P["Tự gắn company_id = TenantID<br/>cho dòng chưa có"]
    K -->|bảng con| C{"Mọi dòng mới có dòng cha<br/>thuộc công ty đang làm việc?"}
    C -->|có| OK[Ghi]
    C -->|"có 1 dòng không"| E2["Không ghi dòng nào<br/>lỗi 409: parent row not found for the current company"]
    P --> OK
```

- Bảng cha: `postgres.go:491-509`. Dòng đã có `company_id` thì giữ nguyên.
- Bảng con: một câu lệnh duy nhất, chỉ chèn khi mọi dòng có cha cùng công ty (`postgres.go:558-570`). Công ty B không thể chèn dòng bóc tách vào dự án của A.
- Sửa và xoá đi qua `withScope` như đọc: điều kiện công ty được thêm vào `where`, nên dòng của công ty khác không bị đụng tới.

## 6. Trường hợp đặc biệt

| Trường hợp | Cách làm | File |
|---|---|---|
| Super chưa chọn công ty | `TenantID` rỗng: không lọc, thấy toàn hệ thống | `shared/tenant/tenant.go:64-68` |
| Bỏ lọc có chủ đích (`NoScope: true`) | Chỉ dùng cho truy cập xuyên công ty thật sự: đăng nhập, phiên, Super quản lý công ty và tài khoản, báo cáo của Super, đọc gói tính năng của công ty | `modules/auth`, `companies`, `users`, `reports` (`postgres.go`) |
| Kho sản phẩm chung của Dezon | Công ty có `has_dezon_catalog_access` được đọc thêm sản phẩm có `company_id` = Dezon, chỉ đọc | `modules/materials/service_catalog.go:72-84` |
| Cài đặt công ty `__cty` | Dữ liệu dùng chung của công ty (vd `mkAds`, `kdOptions`) lưu trong `company_settings` theo `company_id`; Super chưa chọn công ty đọc dòng `company_id IS NULL` | `modules/projects/service_data.go`, `projects/postgres.go:84-95` |
| Sản phẩm nhiều ngành | Đọc qua view `product_catalog`; ghi tách vào `products` + 6 bảng `product_*_specs` (khoá `product_id`, công ty theo `products`) | `db-map.json` (`view`, `parts`) |
| Chat | Module `chat` viết SQL thô qua `DB.Pool()`; bảng `chat_*` không đi qua cơ chế lọc này | `backend/internal/modules/chat` |
| Xoá công ty | Khoá ngoại `company_id ... ON DELETE CASCADE` + thứ tự xoá bảng trong `tenantTablesOrder` | `modules/companies` |

## 7. Ràng buộc khi thêm bảng mới

1. Bảng theo công ty: có cột `company_id uuid` + khoá ngoại tới `companies(id) ON DELETE CASCADE` + index bắt đầu bằng `company_id`.
2. Thêm tên bảng (tên trong code) vào `TenantTables` (`postgres.go`). Quên bước này thì dữ liệu lộ sang công ty khác.
3. Bảng con không có `company_id`: khai `tenant: {via, parent, key}` trong `db-map.json` và cũng thêm vào `TenantTables`.
4. Thêm cặp tên `"ten_trong_code": "name_in_db"` vào `db-map.json`.
5. Thêm bảng vào thứ tự xoá khi xoá công ty (`tenantTablesOrder`, module `companies`).
6. Không dùng `NoScope` hay SQL thô cho dữ liệu của một công ty.

Quy tắc đầy đủ: [database-rules.md](database-rules.md).

## 8. Giới hạn của thiết kế

- **Không có Row Level Security trong PostgreSQL.** Mọi bảo vệ nằm ở code Go; một chỗ quên `TenantTables`, dùng sai `NoScope` hoặc SQL thô là lộ dữ liệu.
- **Mã dự án, mã đơn mua, mã đề xuất là duy nhất toàn hệ thống** (không phải theo công ty). Không gây lộ dữ liệu, nhưng hai công ty không dùng trùng một mã được.
- **Tên đăng nhập duy nhất toàn hệ thống.**
- **Bảng con tra công ty qua truy vấn con tới dòng cha.** Đúng nhưng tốn hơn lọc thẳng; cần index trên khoá nối (`project_code`, `product_id`...).
