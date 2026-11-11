# Quy tắc database - bắt buộc khi thêm hoặc sửa bảng

- Áp dụng cho PostgreSQL của QS Pro. Trạng thái: **đang áp dụng** từ 2026-10-12 (schema hiện hành: [schema-hien-hanh.md](schema-hien-hanh.md)).
- Mỗi quy tắc có lý do rút từ [audit.md](audit.md). Muốn làm khác: ghi một mục mới trong `decisions.md` trước khi làm.

## A. Thiết kế bảng

1. **Mỗi bảng một mục đích**, viết được trong một câu. Bảng mới phải có mục trong `data-dictionary.md` trước khi merge.
2. **Mỗi bảng nghiệp vụ có khoá chính ổn định** (`id` bigint identity hoặc uuid). Không dùng tên, email, mã người dùng sửa được làm khoá chính.
3. **Không dùng một bảng cho hai loại thực thể.** Nếu ý nghĩa của cột phụ thuộc giá trị cột "loại" thì đó là hai bảng. *(Bài học: dòng đề xuất ck/tt.)*
4. **Không nhét mã giả vào cột tham chiếu.** Dữ liệu thuộc phạm vi khác thì ở bảng khác. *(Bài học: `'__cty:<id>'` trong mã dự án.)*
5. **Thông số riêng của một ngành sản phẩm** vào bảng thông số của ngành đó, không thêm cột vào `products`. Ngành mới = bảng `product_<ngành>_specs` mới. Sau khi thêm cột vào `products` hoặc bảng thông số phải tạo lại view `product_catalog` trong cùng migration (quy trình: [ket-qua-trien-khai.md](ket-qua-trien-khai.md) mục 7).
6. **Không lưu nhiều giá trị trong một ô** nếu cần lọc, ràng buộc hoặc sửa từng giá trị. Danh sách chỉ để hiển thị thì được, và phải ghi rõ ký tự phân cách trong data dictionary.

## B. Quan hệ

7. **Quan hệ sở hữu phải có khoá ngoại thật**, kèm `ON DELETE` được chọn có lý do: `CASCADE` cho dòng con không có nghĩa khi thiếu cha; `SET NULL` cho tham chiếu tới người thực hiện; `RESTRICT` cho phần còn lại. Không `CASCADE` theo thói quen.
8. **Bảng con không lặp lại `company_id`.** Nó chỉ có khoá ngoại tới bảng cha; công ty của dòng con là công ty của dòng cha. Khai báo `"tenant": {via, parent, key}` cho bảng con trong `backend/internal/platform/database/db-map.json` để lớp dữ liệu xét quyền qua bảng cha. `company_id` chỉ đặt ở bảng gốc của công ty (khoá ngoại trực tiếp tới `companies`) và ở bảng nhật ký / lịch sử phải sống lâu hơn bản ghi gốc.
9. **Tham chiếu mềm phải được khai báo.** Cột trỏ tới bản ghi có thể đã bị xoá (bản chụp, lịch sử) không có khoá ngoại, nhưng chú thích cột phải ghi "soft reference" và lý do.
10. **Không suy ra khoá ngoại từ hậu tố `_id` hay `_code`.** Kiểm tra code và đếm dòng mồ côi trước.
11. **Quan hệ nhiều-nhiều qua bảng trung gian** có unique trên cặp khoá; bảng trung gian chỉ chứa thuộc tính của chính quan hệ đó.

## C. Dữ liệu dư thừa

12. **Phân loại mọi cột lặp lại thông tin** thành: A dữ liệu gốc, B bản chụp tại thời điểm, C dẫn xuất / tổng lưu sẵn, D dư thừa. Ghi loại vào data dictionary.
13. **Bản chụp (B) không bao giờ bị xoá hay "đồng bộ lại" tự động.** Báo giá, đơn mua, lịch sử phải giữ giá trị tại thời điểm tạo.
14. **Cột dẫn xuất (C) phải có nguồn chuẩn và cách kiểm.** Ưu tiên cột `GENERATED`; nếu code phải ghi thì thêm `CHECK` khẳng định công thức. Ghi công thức trong chú thích cột.
15. **Không thêm cột loại D.** Cột chỉ ghi mà không nơi nào đọc là loại D.

## D. Kiểu dữ liệu và tên

16. **Tên:** `snake_case`, tiếng Anh, bảng số nhiều. Khoá công ty luôn là `company_id`. Thời điểm kết thúc bằng `_at`, ngày bằng `_date`, phần trăm bằng `_pct`, boolean bắt đầu bằng `is_` / `has_`. Không đặt `data`, `value`, `type` trần.
17. **Cột mới phải thêm vào `backend/internal/platform/database/db-map.json`** cùng lúc với migration (tên trong code -> tên trong database).
18. **Tiền và số lượng:** `numeric`, không dùng float. **Thời điểm:** `timestamptz`. **Ngày nghiệp vụ:** `date`. **Cờ:** `boolean`, không dùng 0/1.
19. **`jsonb` chỉ cho tài liệu được đọc/ghi nguyên khối**, và cấu trúc của nó phải được mô tả trong data dictionary. Dữ liệu cần truy vấn hoặc tham chiếu từng phần tử thì là bảng.
20. **Không đổi kiểu cột hàng loạt.** Mỗi lần đổi kiểu phải kèm truy vấn chứng minh mọi giá trị hiện có chuyển được.

## E. Ràng buộc

21. **`NOT NULL` cho mọi cột bắt buộc về nghiệp vụ**; cho phép NULL phải có lý do.
22. **Giá trị liệt kê (trạng thái, vai trò) có `CHECK`**, trừ danh sách mà code mở rộng thường xuyên (ngành sản phẩm, khoá dữ liệu dự án). Thêm giá trị mới = migration sửa CHECK, cùng PR với code.
23. **Chỉ thêm ràng buộc khi 100% dòng hiện có thoả**, hoặc sau khi dòng sai đã được xử lý có phê duyệt. Không tắt ràng buộc để nạp dữ liệu.
24. **Phân vai:** kiểm tra đầu vào và thông báo lỗi ở backend; toàn vẹn dữ liệu ở database; quy trình nghiệp vụ ở tầng service; quyền truy cập ở backend.

## F. Multi-tenant

25. **Mỗi bảng mới phải được xếp loại**: tenant-owned, user-owned, dùng chung, hệ thống, hay lịch sử. Bảng thuộc công ty phải được thêm vào `TenantTables` trong `backend/internal/platform/database/postgres.go`: bảng gốc có `company_id`, bảng con khai báo `tenant` (quy tắc 8).
26. **Không tin `company_id` từ client.** Lớp dữ liệu gắn công ty từ phiên đăng nhập.
27. **Mỗi lần dùng `NoScope: true` phải có chú thích lý do** ngay tại dòng gọi, và điều kiện công ty tường minh trong bộ lọc nếu truy vấn chạm dữ liệu tenant.
28. **Mọi thay đổi liên quan tenant phải kèm test cách ly** (A không đọc, không sửa, không xoá được của B; database từ chối liên kết chéo).

## G. Index và hiệu năng

29. **Không tạo index theo cảm tính.** Index mới phải nêu truy vấn nó phục vụ (file:dòng) hoặc ràng buộc nó thực thi.
30. **Mọi tuyên bố "nhanh hơn" phải có số đo trước/sau** bằng `EXPLAIN (ANALYZE, BUFFERS)` trên cùng dữ liệu, ghi vào `query-performance.md`.
31. **Không chạy đo tải hay `EXPLAIN ANALYZE` của lệnh ghi trên production.**

## H. Migration và vận hành

32. **Mọi thay đổi schema là một file trong `infra/db/migrations/`**, đánh số, được Git quản lý. Không sửa schema bằng tay trên bất kỳ môi trường dùng chung nào.
33. **Không sửa file migration đã áp dụng.** Sai thì viết file mới.
34. **Mỗi migration có:** bước kiểm tra điều kiện trước, bước xác minh sau, và ghi rõ quay lui được bằng cách nào (hoặc "chỉ quay lui bằng khôi phục sao lưu").
35. **Thay đổi phá vỡ theo hai bước:** thêm cái mới và chuyển code trước; xoá cái cũ ở một lần phát hành sau.
36. **Không xoá bảng, cột hay dữ liệu dựa trên phỏng đoán.** Cần bằng chứng không còn nơi đọc/ghi (grep toàn repo + truy vết gián tiếp) và bản sao lưu đã thử khôi phục. Dữ liệu sai được cách ly, không xoá.
37. **PR đổi schema phải liệt kê** hàm API và file bị ảnh hưởng, và cập nhật `db-map.json`, `schema.sql`, `data-dictionary.md`, `erd.md` trong cùng PR.
38. **Không đổi nghiệp vụ để schema gọn hơn.** Chỗ nào chuẩn hoá làm đổi hành vi thì ghi vào `decisions.md` và chờ quyết định.
39. **Thao tác ghi nhiều bảng phải nằm trong một transaction.**
40. **Không đưa secret, chuỗi kết nối hay dữ liệu khách hàng vào tài liệu, migration hoặc Git.**

## Bảng đối chiếu với 20 quy tắc tối thiểu của yêu cầu

| Yêu cầu | Quy tắc ở đây |
|---|---|
| 1 Mục đích rõ | 1 |
| 2 Khoá chính | 2 |
| 3 Khoá ngoại | 7, 8, 9, 10 |
| 4 Không trùng lặp | 15 |
| 5 Phân biệt snapshot, cache, tổng hợp | 12, 13, 14 |
| 6 Chuẩn hoá | 3, 4, 5, 6, 11 |
| 7 Không index tuỳ tiện | 29 |
| 8 Kiểu dữ liệu đúng nghiệp vụ | 18, 19, 20 |
| 9 Ràng buộc ở database | 21, 22, 23, 24 |
| 10 Tenant ownership | 25, 26, 27 |
| 11 Migration bằng Git | 32, 33 |
| 12 Không sửa production bằng tay | 32 |
| 13 Xác định API bị ảnh hưởng | 37 |
| 14 Thay đổi breaking có kế hoạch | 35 |
| 15 Tài liệu hoá | 1, 17, 37 |
| 16 Không xoá theo phỏng đoán | 36 |
| 17 Không đổi nghiệp vụ vì schema | 38 |
| 18 Tối ưu phải đo | 30, 31 |
| 19 Migration có xác minh | 34 |
| 20 Thay đổi bảo mật có test cách ly | 28 |
