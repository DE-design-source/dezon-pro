# Quyết định thiết kế database

> **Cập nhật 2026-10-12:** đề xuất này ĐÃ được triển khai trên database local `qspro_en2`, có điều chỉnh. Cấu trúc đang chạy: [schema-hien-hanh.md](schema-hien-hanh.md). Những gì đã làm và khác gì so với bản dưới đây: [ket-qua-trien-khai.md](ket-qua-trien-khai.md). Nội dung bên dưới là bản đề xuất gốc, giữ lại để tra lý do.

- Trạng thái: **ĐÃ TRIỂN KHAI** trên `qspro_en2` (2026-10-12), trừ bước xoá cột của D-09. D-13 (transaction) đã làm trên backend Go ngày 2026-10-15 (xem mục D-13). D-04 được làm theo hướng mạnh hơn: bỏ hẳn `company_id` ở 7 bảng con thay vì khoá ngoại kép. Chi tiết: [ket-qua-trien-khai.md](ket-qua-trien-khai.md).
- Mỗi quyết định ghi: bối cảnh có bằng chứng, các phương án đã cân nhắc, đề xuất, tác động tới code.
- Bằng chứng chi tiết: [audit.md](audit.md), [database-dependencies.md](database-dependencies.md).

## Tóm tắt

| Mã | Quyết định | Đề xuất | Đợt | Cần người duyệt chọn |
|---|---|---|---|---|
| D-01 | Ngôn ngữ đặt tên trong database | Giữ tiếng Anh | - | **Có** (mâu thuẫn với file quy ước) |
| D-02 | `products.dealer_price` | Khôi phục cột tự tính | 0 | Không (sửa lỗi) |
| D-03 | Dữ liệu cấp công ty trong `project_data_entries` | Tách bảng `company_settings` | 1 | Không |
| D-04 | Khoá ngoại và dòng mồ côi | Thêm FK sau khi xử lý dữ liệu; FK kép theo công ty | 1 | **Có** (cách xử lý từng nhóm dòng) |
| D-05 | Username duy nhất | `UNIQUE (lower(username))` | 1 | **Có** (giữ tài khoản nào) |
| D-06 | Bảng `products` 141 cột | Tách thông số theo ngành thành bảng 1-1 | 2 | **Có** (chọn A hoặc B) |
| D-07 | Cột dẫn xuất và tổng lưu sẵn | Giữ cột, thêm CHECK công thức | 1 | Không |
| D-08 | Danh sách nối chuỗi (`features`, `permissions`...) | Không đổi trong đợt này | - | Không |
| D-09 | Cột không còn dùng | Loại bỏ theo 2 bước, bước xoá ở đợt 3 | 3 | **Có** (duyệt danh sách) |
| D-10 | Những thứ KHÔNG làm | Không tách bảng dự án, không đổi sang id số, không tách JSON | - | Không |
| D-11 | `purchase_proposal_items` đa hình | Tách 2 bảng | 2 | Không |
| D-12 | Lớp tương thích và công cụ migration | Giữ `supa.js` + `db-map.json`; migration SQL đánh số | 1 | Không |
| D-13 | Transaction cho thao tác nhiều bước | Thêm ở đợt 2 | 2 | Không |
| D-14 | Vị trí tài liệu | `docs/02-ky-thuat/database/` | - | Không |
| D-15 | Chat MVP (2026-10-30): danh tính riêng, SQL thô, chỉ PostgreSQL | Bảng `chat_*` không theo công ty; SQL qua `DB.Pool()`; chưa dùng Redis / Cassandra / Kafka | - | Không (đã chốt) |
| D-16 | Chat đăng nhập bằng email (2026-11-02) | Danh tính = số HOẶC email, tài khoản riêng, chưa liên kết; OTP email qua SMTP | - | Không (đã chốt) |

---

## D-01. Ngôn ngữ đặt tên trong database

- **Bối cảnh:** ngày 2026-10-07 database đã được đổi sang tên tiếng Anh theo yêu cầu, và app local đang chạy trên đó qua `db-map.json`. Nhưng `.claude/rules/code/naming-conventions.md` (thêm ngày 2026-10-12) ghi: tên bảng, cột là tiếng Việt không dấu, "giữ nguyên, không dịch sang tiếng Anh".
- **Phương án:** (A) giữ tiếng Anh trong database, code giữ tiếng Việt, ánh xạ qua `db-map.json`; (B) quay lại tên tiếng Việt trong database, bỏ lớp ánh xạ tên.
- **Đề xuất: A**, và sửa file quy ước cho khớp. Lý do: đã triển khai và kiểm thử; đổi lại không mang thêm giá trị. Nhược điểm phải chấp nhận: developer phải tra `db-map.json` khi viết SQL tay.
- **Tác động:** không. Nếu chọn B: sinh lại schema theo tên cũ, `db-map.json` chỉ còn phần ánh xạ cấu trúc.

## D-02. `products.dealer_price` phải là cột tự tính

- **Bối cảnh:** Supabase khai báo `gia_dai_ly` là `GENERATED ALWAYS AS (round(coalesce(gia_ban_le,0) * (1 - coalesce(ck_dai_ly_pct,0)/100.0))) STORED` (`db/schema.sql:46`). Code không bao giờ ghi cột này. Bản `qspro_en` làm mất thuộc tính generated.
- **Đề xuất:** khôi phục đúng biểu thức gốc. Đây là sửa lỗi, không phải thay đổi thiết kế. Lớp `supa.js` phải bỏ qua cột generated khi ghi (hiện code không ghi nên chưa cần).
- **Kiểm chứng:** 0/1.093 dòng hiện lệch công thức, nên chuyển đổi không làm đổi giá trị nào.

## D-03. Tách dữ liệu cấp công ty khỏi `project_data_entries`

- **Bối cảnh:** cột `project_code` chứa cả mã dự án lẫn mã giả `'__cty:<company_id>'` (khoá `ptInfo`, `bgOrg`). Vì thế không đặt được khoá ngoại tới `projects`, và xoá dự án phải tự dọn bằng code.
- **Phương án:** (A) giữ nguyên; (B) bảng mới `company_settings (company_id, setting_key, setting_value jsonb, updated_at, updated_by)`, chuyển các dòng `__cty:*` sang; `project_data_entries` chỉ còn dữ liệu dự án và có FK thật.
- **Đề xuất: B.**
- **Tác động code:** chỉ `getProjData` và `setProjData` trong `server/store_supa.js` (đọc/ghi 2 khoá cấp công ty sang bảng mới). Client không đổi: vẫn gửi `ma='__cty'` và nhận một object gộp. Dữ liệu hiện tại: 0 dòng `__cty:*`, nên không có gì phải chuyển.

## D-04. Khoá ngoại và xử lý dòng mồ côi

**Nguyên tắc**

1. Quan hệ sở hữu (con không có nghĩa khi thiếu cha): FK cứng, `ON DELETE CASCADE`.
2. Tham chiếu tới người thực hiện: FK, `ON DELETE SET NULL`, giữ cột tên đã chép.
3. Bản chụp lịch sử (mã SP trên dòng báo giá, dòng mua hàng, lịch sử): **không FK**, ghi rõ là tham chiếu mềm.
4. Quan hệ nội bộ một công ty: FK kép `(company_id, khoá)`.
5. Không xoá dữ liệu để tạo được ràng buộc. Dòng sai được chuyển sang schema `quarantine` (giữ nguyên nội dung + lý do), chỉ sau khi được duyệt.

**Từng quan hệ**

| Quan hệ | Hiện tại | Đề xuất | Dòng vướng | Cách xử lý đề xuất |
|---|---|---|---:|---|
| `quotation_lines` -> `projects` | Không FK | FK kép `(company_id, project_code)`, CASCADE | 3 mồ côi + 17 lệch công ty | 3 dòng thử (mã `<maDA>`, `DA-20260818-033604`): cách ly. 17 dòng: gán `company_id` theo dự án cha |
| `cost_estimate_lines`, `project_data_entries` -> `projects` | FK đơn / không FK | FK kép, CASCADE | 0 | - |
| `purchase_order_items` -> `purchase_orders` | FK đơn | FK kép, CASCADE | 0 | - |
| `purchase_proposal_items` -> `purchase_proposals` | FK đơn | FK kép, CASCADE | 0 | - |
| `product_combos.product_id` -> `products` | FK đơn | FK kép `(company_id, product_id)`, CASCADE | 0 | - |
| `product_combos.companion_product_id`, `favorite_products.product_id` -> `products` | FK đơn / không FK | FK **đơn** theo `id`, CASCADE (được phép trỏ sang sản phẩm Dezon) | 4 yêu thích mồ côi | Cách ly 4 dòng |
| `purchase_orders.project_code`, `purchase_proposals.project_code` | Không FK | **Không FK**: đơn tồn tại sau khi xoá dự án, dựa vào `project_name` đã chép | 55 + 2 | Giữ nguyên |
| `*.product_code` trên dòng báo giá, dòng mua hàng, lịch sử | Không FK | **Không FK**: bản chụp; mã SP không duy nhất | 366 + 113 + 4 | Giữ nguyên |
| `purchase_orders.requester_id`, `delete_requests.requester_id` -> `users` | Không FK | FK, SET NULL | 1 + 1 | Đặt 2 giá trị về NULL (tên người gửi vẫn còn) |
| `notifications.user_id` -> `users` | Không FK | FK, CASCADE | 2 | Cách ly 2 thông báo không ai đọc được |
| `audit_logs.user_id` -> `users` | Không FK | **Không FK**: nhật ký phải sống lâu hơn tài khoản; đã có `username` chép sẵn | 13 | Giữ nguyên |
| `audit_logs.company_id` -> `companies` | Không FK | **Không FK**: nhật ký hệ thống và dòng "đã xoá công ty" | 3 | Giữ nguyên |
| `work_item_histories.work_item_id` -> `work_items` | Không FK | **Không FK**: dòng "XOÁ CÔNG TÁC" được ghi sau khi xoá | 0 | Giữ nguyên |

**Cần người duyệt xác nhận:** (1) 17 dòng bóc tách và 4 đơn mua lệch công ty gán theo dự án cha; (2) 5 dự án, 144 sản phẩm và các dòng khác không thuộc công ty nào (do super admin tạo khi chưa chọn công ty) giữ nguyên hay gán về Dezon; (3) đồng ý cách ly 3 + 4 + 2 dòng nêu trên.

`company_id` giữ cho phép NULL: xem [tenant-security.md](tenant-security.md) mục 5.1.

## D-05. Username duy nhất toàn hệ thống

- **Bối cảnh:** code kiểm tra trùng trên toàn hệ thống (`auth.js:336`) nhưng không nguyên tử; index hiện là `(company_id, username)`, NULL không đụng nhau. Đang có `tuannguyen` hai lần (một thuộc Dezon, một không công ty; cả hai chưa từng đăng nhập).
- **Đề xuất:** `UNIQUE (lower(username))`; giữ thêm index `(company_id, username)` cho truy vấn theo công ty.
- **Cần người duyệt:** tài khoản `tuannguyen` không công ty: đổi tên hay cách ly. Không tự xử lý.

## D-06. Bảng `products` 141 cột

- **Bối cảnh:** một bảng chứa thông số của 4 ngành. Cột chỉ thuộc một ngành: đèn 26, vệ sinh 20, sơn 17, công tắc - ổ cắm 37; 44 cột chưa có dữ liệu. Mỗi ngành mới thêm 20-40 cột vào bảng lõi. Mỗi lần nạp danh mục trả 3,4 MB JSON vì `SELECT *`.
- **Ràng buộc phải giữ:** unique index biến thể dùng `color_temperature_k, power_w, beam_angle_deg, color, size` nên 5 cột này phải ở bảng lõi. `getDbProduct` và `prodToObj().raw` lộ tên cột ra client.

| Phương án | Mô tả | Ưu | Nhược |
|---|---|---|---|
| A - giữ nguyên | Một bảng rộng | Không rủi ro; đúng 3NF về hình thức (thuộc tính của sản phẩm) | Bảng lõi tiếp tục phình; ngành mới phải `ALTER` bảng lõi |
| B - tách bảng 1-1 theo ngành | `products` (lõi + cột dùng chung + 5 trục biến thể) và `product_lighting_specs`, `product_sanitary_specs`, `product_paint_specs`, `product_switch_socket_specs` (khoá chính = `product_id`) | Ngành mới = bảng mới, không đụng bảng lõi; mỗi bảng có nghĩa rõ | Lớp `supa.js` phải đọc qua view nối và tách cột khi ghi; rủi ro cao nhất trong toàn bộ đề xuất |
| C - JSONB | Một cột `specs jsonb` | Linh hoạt | Mất kiểu và tên cột; đi ngược yêu cầu "không lạm dụng JSONB"; form và file mẫu đang dựa vào tên cột |

- **Đề xuất: B, làm ở đợt 2, tách khỏi đợt 1.** Client và `store_supa.js` không đổi: view `product_catalog` trả đủ 141 cột như cũ; `supa.js` tách cột theo bảng khi ghi, trong một transaction.
- **Điều kiện nghiệm thu:** 1.093 dòng x 141 cột đọc qua lớp mới giống hệt trước khi tách; toàn bộ luồng tạo/sửa/nhập hàng loạt/duyệt/xoá qua.
- **Nếu chọn A:** bỏ đợt 2 phần sản phẩm; các quyết định khác không phụ thuộc.

## D-07. Cột dẫn xuất và tổng lưu sẵn

- **Bối cảnh:** `quotation_lines.dealer_price, unit_price, amount` được server tính (`calc_`) rồi lưu, và được đọc lại để lập báo giá, tờ bìa. Tổng đơn mua do client tính và lưu một lần. Dữ liệu hiện khớp công thức 100%.
- **Phương án:** (A) đổi thành cột `GENERATED`; (B) giữ cột thường, thêm `CHECK` khẳng định công thức.
- **Đề xuất: B.** Lý do: code đang ghi các cột này; cột generated sẽ từ chối lệnh ghi và buộc sửa đường ghi. CHECK bảo vệ cùng bất biến mà không đổi đường ghi. Làm tròn của JavaScript và PostgreSQL chỉ khác nhau với số âm; giá và số lượng đã có CHECK không âm.
- **CHECK đề xuất** (chỉ thêm khi 100% dòng hiện có thoả):
  - `quotation_lines`: `amount = round(quantity * unit_price)`; `dealer_price = round(retail_price * (1 - dealer_discount_pct/100))`; `unit_price = round(selling_price * (1 - customer_discount_pct/100))`.
  - `purchase_orders`: `total_amount = subtotal_before_vat + vat_amount`.
- `selling_price` là giá trị gốc (không suy ngược được từ `profit_pct` đã làm tròn): giữ nguyên.

## D-08. Danh sách nối chuỗi

- **Bối cảnh:** `companies.features`, `users.permissions` (dấu phẩy); `projects.custom_groups`, `custom_floors` (dấu `|`); `products.image_urls` (xuống dòng).
- **Đề xuất: không đổi trong đợt này.** Server chỉ đọc 2 khoá quyền bằng cách tách chuỗi; không truy vấn nào lọc theo từng phần tử. Chuẩn hoá thành bảng con hoặc `text[]` buộc sửa cả mapper và form mà chưa có tính năng nào cần.
- **Ghi nhận:** khi server bắt đầu kiểm module theo gói (điểm T6), chuyển `features` và `permissions` sang `text[]` kèm CHECK danh sách khoá hợp lệ.

## D-09. Cột không còn dùng

- **Danh sách** (bằng chứng ở audit mục 4.4): `quotation_lines.zone`, `line_no`, `markup_pct`, `margin_pct`, `profit_amount`, `is_manual_entry`, `is_saved_to_catalog`; `favorite_products.product_code`.
- **Đưa ra khỏi danh sách (2026-10-15):** `delete_requests.note` - migration 0010 dùng lại làm lý do xoá do người gửi nhập (M15.2, chú thích cột đã đổi); `product_combos.note` - giao diện React ghi và hiện ghi chú sản phẩm đi kèm (M10.2), migration 0013 đổi chú thích cột (bỏ `DEPRECATED`); `companies.last_reminder_date`, `reminder_milestone` - nhắc gia hạn trong ứng dụng (M17.3, giả định chờ chủ sản phẩm xác nhận) dùng lại, migration 0012 đổi chú thích cột (bỏ `DEPRECATED`, không CHECK).
- **Đề xuất, 2 bước:**
  1. Đợt 1: đánh dấu `DEPRECATED` trong chú thích cột; không đổi gì khác.
  2. Đợt 3 (sau ít nhất một chu kỳ phát hành ổn định): `supa.js` bỏ qua các cột này khi ghi, rồi mới `DROP COLUMN`, sau khi đã sao lưu.
- Không xoá cột chỉ vì "chưa có dữ liệu": 8 cột của `projects` và 8 cột của `work_items` đang trống nhưng có ô nhập trên giao diện.

## D-10. Những thay đổi cố ý KHÔNG làm

| Ý tưởng | Lý do không làm |
|---|---|
| Tách bảng "dự án" khỏi "bản nháp" | Gom nhóm theo tên là hành vi hiện tại của giao diện (đổi tên một bản nháp là chuyển nhóm). Thêm bảng cha sẽ đổi hành vi này |
| Đổi tham chiếu từ mã chữ sang id số (`project_id`, `order_id`) | Mã bất biến, duy nhất toàn hệ thống, và là định danh công khai (thông báo, Lark, localStorage). Đổi sang id không thêm toàn vẹn mà buộc sửa mọi bộ lọc |
| Tách JSON trong `project_data_entries` thành bảng (`phanTho`, `bgHist`, `mhPay`, `btFmt`) | Client đọc/ghi nguyên khối và thao tác mảng tại chỗ (`phantho.js` 2.467 dòng). Tách bảng là viết lại các màn hình này. Chưa tính năng nào cần truy vấn bên trong. Thay vào đó: mô tả cấu trúc trong data dictionary |
| Đổi `company_id` thành `NOT NULL` | Super admin chưa chọn công ty đang ghi NULL; chặn lại là đổi hành vi |
| Bật RLS | Xem [tenant-security.md](tenant-security.md) mục 5.3 |
| Đổi chuỗi trạng thái sang mã | Chuỗi được so sánh ở cả server và client |
| Thêm `updated_at` + trigger cho mọi bảng | Không tính năng nào dùng; trigger là logic ẩn |

## D-11. Tách `purchase_proposal_items`

- **Bối cảnh:** một bảng cho hai loại dòng không liên quan (dòng sản phẩm của phiếu chiết khấu; đợt của phiếu thanh toán). Bảng đang có 0 dòng.
- **Đề xuất:** `proposal_discount_items` (mã SP, tên, số lượng, giá gốc, % chiết khấu, giá đề xuất, thành tiền...) và `proposal_payment_installments` (số thứ tự, % đợt, số tiền, ngày dự kiến, ghi chú).
- **Tác động code:** `saveDeXuat`, `dxItem_`, hai chỗ đọc dòng trong `store_supa.js` / `auth.js`. Đối tượng trả về client giữ nguyên.
- Làm bây giờ không phải chuyển dữ liệu; để sau sẽ phải.

## D-12. Lớp tương thích và công cụ migration

- **Lớp tương thích:** giữ `server/supa.js` + `server/db-map.json` làm nơi duy nhất biết cấu trúc database. Đợt 2 mở rộng `db-map.json` để khai báo "cột X nằm ở bảng vệ tinh Y".
- **Migration:** repo chưa có công cụ. Đề xuất không thêm phụ thuộc mới:
  - Thư mục `infra/db/migrations/NNNN_ten.sql`, chạy theo thứ tự số.
  - Bảng `schema_migrations (version, name, applied_at, checksum)`.
  - Script `infra/scripts/migrate.js` (dùng `pg` sẵn có): chạy file chưa áp dụng, mỗi file một transaction, từ chối nếu checksum của file đã áp dụng bị đổi.
  - `infra/db/schema.sql` tiếp tục là bản chụp, sinh lại sau mỗi migration.
- **Phương án khác đã cân nhắc:** `node-pg-migrate` (thêm phụ thuộc và cú pháp riêng; chưa cần ở quy mô này).

## D-13. Transaction cho thao tác nhiều bước

- **Bối cảnh:** tạo đơn + dòng, đề xuất + dòng, xoá dự án, nhân bản dự án, lưu tờ bìa, xoá công ty đều là nhiều truy vấn rời, tự bù khi lỗi và có chỗ nuốt lỗi.
- **Đề xuất:** thêm `supa.tx(fn)` (một kết nối, `BEGIN ... COMMIT`), bọc 6 thao tác trên. Kết quả khi thành công không đổi; khi lỗi thì không còn dữ liệu dở dang.
- Làm ở đợt 2 vì cũng cần cho việc ghi sản phẩm vào nhiều bảng (D-06).
- **Đã làm (2026-10-15, backend Go; app Node đã gỡ):** `database.DB.Tx(ctx, fn)` + `AfterCommit` + `InTx` (`backend/internal/platform/database/tx.go`). Mỗi lệnh trong transaction chạy dưới savepoint riêng nên các chỗ cố ý nuốt lỗi chạy như cũ. Đã bọc: lưu đơn mua hàng (mỗi đơn 1 transaction), lưu đề xuất, xoá dự án, nhân bản dự án, lưu tờ bìa, tạo công ty (công ty + tài khoản chủ), xoá công ty, `SetCombo` / `SetBienThe` / `DeleteDbProduct`. Khi thành công kết quả, dữ liệu ghi và golden giữ nguyên; nhật ký, thông báo, Lark, xoá cache chạy sau commit. Chi tiết từng hàm và các hàm cố ý không bọc: `backend/docs/ARCHITECTURE.md` mục 3.5 "Transaction". Chưa làm: gộp cả lần gửi nhiều đơn mua hàng vào 1 transaction (cần đổi `DEFAULT now()` sang `clock_timestamp()`, vì mọi dòng trong 1 transaction cùng mốc giờ).

## D-14. Vị trí tài liệu

Yêu cầu ghi `docs/database/*.md`; quy tắc bắt buộc của repo (`.claude/rules/docs/docs-placement.md`) yêu cầu tài liệu kỹ thuật nằm ở `docs/02-ky-thuat/`, tên file kebab-case. Đã đặt ở `docs/02-ky-thuat/database/`. Bảng đối chiếu tên file: [docs/README.md](../../README.md).

## D-15. Chat MVP: danh tính riêng, SQL thô qua `Pool()`, chỉ PostgreSQL (2026-10-30)

- **Bối cảnh:** Chat MVP (`backend/CHAT.md`, roadmap N8) đăng nhập bằng số điện thoại + OTP và dùng chung giữa mọi công ty (như Zalo).
  CHAT.md mục 4 thiết kế PostgreSQL (người dùng, nhóm) + Cassandra / ScyllaDB (tin nhắn) + Redis (online, `seq`, đang soạn, OTP), nhưng ghi
  "Giai đoạn đầu có thể dùng PostgreSQL cho tất cả, giữ nguyên cấu trúc bên dưới để sau này tách ra"; mục 16 (Lộ trình) đặt MVP là
  "WebSocket một gateway", còn tách gateway, Kafka, Cassandra để "khi có tăng trưởng". Production (VPS dezon.tech) chỉ có PostgreSQL, không có Redis.
- **Quyết định 1 - danh tính riêng:** bảng `chat_users` (khoá nghiệp vụ = số điện thoại E.164), KHÔNG dùng `users` của QS, KHÔNG có
  `company_id`, không vào `TenantTables` (quy tắc 25: user-owned, không theo công ty; `chat_otp_codes` là bảng hệ thống). Token riêng: access
  JWT HS256 15 phút (`typ = "chat"`, `did` = thiết bị) + refresh token mờ 30 ngày lưu sha256, xoay vòng, phát hiện dùng lại. Phiên QS và token
  chat không dùng lẫn được. Phương án bị loại: gắn chat vào `users` - tài khoản QS thuộc một công ty, đăng nhập bằng tên + mật khẩu, người
  ngoài công ty (khách, thầu phụ) không có tài khoản.
- **Quyết định 2 - SQL thô qua `database.DB.Pool()`:** lớp `database.DB` kiểu PostgREST không diễn đạt được `UPDATE ... SET last_seq = last_seq + 1
  RETURNING` (cấp `seq` nguyên tử dưới khoá dòng), `GREATEST(...)` cho con trỏ đã nhận / đã xem, upsert `ON CONFLICT`, `SELECT ... FOR UPDATE`,
  khoá `pg_advisory_xact_lock` theo số điện thoại / cặp người dùng và các câu nối của danh sách hội thoại; bảng chat cũng không cần lọc công ty.
  Module chat viết SQL tên tiếng Anh, transaction riêng (`pgx.BeginFunc`), ép kiểu tham số tường minh (pool chạy simple protocol). Ngoại lệ
  này ghi ở `backend/docs/ARCHITECTURE.md` mục 10.4; `db-map.json` vẫn có 9 mục `chat_*` (quy tắc 17), không có khoá `tenant`.
- **Quyết định 3 - PostgreSQL thay Redis / Cassandra / Kafka ở MVP:**

  | Thành phần của CHAT.md | MVP dùng |
  |---|---|
  | Bảng `messages` trên Cassandra | `chat_messages`, cùng khoá đọc `(conversation_id, seq)` |
  | `message_dedup` (TTL 1 ngày) | unique `(conversation_id, sender_id, client_msg_id)`, không TTL |
  | Redis `seq:{conversation_id}` (`INCR`) | `chat_conversations.last_seq` + `UPDATE ... RETURNING` trong transaction gửi |
  | Redis `otp:{phone}` (TTL 5 phút) | `chat_otp_codes` (lưu HMAC; giới hạn gửi đếm bằng số dòng trong 1 giờ) |
  | Redis `conn`, `presence`, `typing`, `members` | bộ nhớ của gateway `realtime.Hub` + cache thành viên 30 giây trong service |
  | Kafka (phân phối theo thứ tự) | bộ chạy tuần tự trong tiến trình `Hub.Submit(conversation_id, job)` (cùng khoá = cùng worker) |

  Tin được commit TRƯỚC khi phân phối; tiến trình chết giữa hai bước thì client bù bằng phát hiện hở `seq` + `GET /chat/sync`.
- **Giới hạn chấp nhận:** chỉ một tiến trình server (gateway trong bộ nhớ, chưa chia tải ngang); khởi động lại thì mọi WebSocket nối lại.
  Khi cần nhiều gateway: làm theo CHAT.md mục 16 bước 4 (tách gateway, Redis cho presence / định tuyến, Kafka, Cassandra); khoá
  `(conversation_id, seq)` giữ nguyên nên dữ liệu chuyển được.
- **Tác động code:** `infra/db/migrations/0018_chat.sql`, `backend/internal/modules/chat` (+ gói con `realtime`), `backend/internal/platform/webpush`,
  quyền mới `rpc.SelfAuth`. Không đổi bảng, hàm hay route nào của QS.

## D-16. Chat đăng nhập / tìm bạn bằng email (2026-11-02)

- **Bối cảnh:** D-15 lấy số điện thoại làm danh tính chat, nhưng SMS thật chưa có (mã ghi log, roadmap N8.1) và nhiều người (khách, đối tác)
  quen dùng email công ty hơn.
- **Quyết định:** danh tính `chat_users` = số điện thoại HOẶC email (migration 0019: `phone` thôi NOT NULL, thêm `email` unique, CHECK có ít nhất
  một). Tài khoản tạo bằng email không có số và ngược lại; cùng một người dùng số và email là HAI tài khoản riêng, CHƯA liên kết / gộp (để sau).
  Email chuẩn hoá trước khi ghi / tra: bỏ khoảng trắng hai đầu, chữ thường toàn bộ, không bỏ dấu chấm / `+tag` (Go `chat/email.go`
  `NormalizeEmail` và JS `chatLogic.normalizeEmail` cho cùng kết quả; CHECK `ck_chat_users_email` chặn chữ hoa ở tầng DB).
- **OTP email cùng giới hạn với SMS:** cùng bảng `chat_otp_codes` (cột `phone` HOẶC `email`), mã 6 số sống 5 phút, gửi lại sau 60 giây,
  5 mã / giờ / email, 20 mã / giờ / IP đếm chung cả số lẫn email, sai 5 lần khoá 15 phút; khoá advisory `otp:email:<email>`.
- **Gửi mail:** SMTP thư viện chuẩn (`backend/internal/platform/mailer`, biến `SMTP_HOST`, `SMTP_PORT` mặc định 587, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `SMTP_FROM`). Chưa đặt `SMTP_HOST` thì mã OTP email ghi vào log server (giống SMS).
- **Lộ thông tin:** email chỉ trả cho chính mình, bạn bè và kết quả tra đúng email; tra theo email không lộ số và ngược lại.
- **Phương án bị loại:** liên kết email vào tài khoản số ngay đợt này - cần luồng xác minh cả hai đích và gộp dữ liệu hai tài khoản đã có.
