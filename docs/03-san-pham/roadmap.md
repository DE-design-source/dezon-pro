# Roadmap QS Pro

> **Cập nhật:** 2026-11-11 · **Phiên bản mới nhất:** 1.0.0 (số cuối của `package.json` trước khi gỡ app Node; chưa có changelog)
>
> **Backlog từ 2026-10-15:** mục 2.1 làm trên server Go (`backend/`) + module QS React (`frontend/src/pages/QS`). Mục "cần chốt nghiệp vụ" được
> chọn phương án hợp lý nhất từ mã + quy trình QT, giả định ghi ngay trong dòng của mục đó (chủ sản phẩm có thể đổi).
>
> **Ký hiệu:** ✅ xong · 🟡 một phần · ⬜ chưa làm · 🔑 cần credential · 🏗 subsystem lớn
>
> **Nguồn của bản đầu tiên này:** dựng từ mã nguồn và 18 quy trình nghiệp vụ `docs/03-san-pham/flows/QT-*.md` ngày 2026-10-07 (thư mục này KHÔNG có
> trên nhánh hiện tại, chỉ còn trong git ở commit `727f800`: `git show 727f800:docs/03-san-pham/flows/<file>`; các mã QT-xx / Q-xx dưới đây trỏ tới đó).
> Trạng thái của bản đầu được xác định bằng **đọc mã nguồn, chưa chạy thử ứng dụng** — ✅ ở đây nghĩa là "có trong mã nguồn".
> Từ 2026-10-15 mã nguồn là server Go (`backend/`) + module QS React (`frontend/src/pages/QS`); các mục M*.x / N3 ghi ngày 2026-10-15 đã chạy thử trên
> hai phần này (database thử `qspro_gotest`). Tính năng ở mục 5 mà bản Go + React không có được ghi rõ ngay trong dòng và đưa lại vào mục 2.
> Backlog (mục 2) chỉ gồm tính năng mà mã nguồn / cơ sở dữ liệu / giao diện đã bắt đầu hoặc đã hứa nhưng chưa làm xong.
> Lỗi, thiếu kiểm tra quyền và câu hỏi thiết kế KHÔNG nằm ở đây — xem mục 14 của từng quy trình (227 câu hỏi mở).

---

## 1. Tổng quan tiến độ

### App User

| Module | Tên | Trạng thái | Còn lại |
|---|---|---|---|
| [M1](#xong-1) | Đăng nhập & phiên | ✅ | - |
| [M2](#xong-2) | Bảng điều khiển | 🟡 | [M2.1](#m2-1) |
| [M3](#xong-3) | Dự án | ✅ | - |
| [M4](#xong-4) | Bóc tách | ✅ | - |
| [M5](#xong-5) | Phần thô & công tác | ✅ | - |
| [M6](#xong-6) | Tờ bìa (khái toán) | ✅ | - |
| [M7](#xong-7) | Chi phí | ✅ | - |
| [M8](#xong-8) | Xuất báo giá | 🟡 | [M8.4](#m8-4), [M8.5](#m8-5) |
| [M9](#xong-9) | Mua hàng & đề xuất | 🟡 | [M9.2](#m9-2), [M9.3](#m9-3) |
| [M10](#xong-10) | Danh sách sản phẩm | 🟡 | [M10.3](#m10-3), [M10.4](#m10-4), [M10.5](#m10-5) |
| [M11](#xong-11) | Nhập dữ liệu | 🟡 | [M11.x](#m11-x) |
| [M12](#xong-12) | Tệp & ảnh | ✅ | - |
| [M13](#xong-13) | Thông báo | ✅ | - |

### App Admin

| Module | Tên | Trạng thái | Còn lại |
|---|---|---|---|
| [M14](#xong-14) | Tài khoản & phân quyền | 🟡 | [M14.2](#m14-2) |
| [M15](#xong-15) | Duyệt yêu cầu (xoá sản phẩm, mua hàng, đề xuất) | ✅ | - |
| [M16](#xong-16) | Nhật ký hoạt động | ✅ | - |
| [M17](#xong-17) | Công ty (quản trị hệ thống) | ✅ | - |
| [M18](#xong-18) | Báo cáo nhập sản phẩm qua Lark | ✅ | - |

### Tính năng mới (N)

| Mã | Tính năng | Trạng thái | Còn lại |
|---|---|---|---|
| [N1](#xong-n1) | Database PostgreSQL trực tiếp, tên bảng / cột tiếng Anh | 🟡 | [N1](#n1): thử tay trên trình duyệt, chuyển production |
| [N2](#xong-n2) | Server Go + Gin (`backend/`) | 🟡 | [N2](#n2): bật Lark, so vi sai phần còn mở |
| [N3](#xong-n3) | Tích hợp QS vào frontend React SiteFlow (`frontend/`) với API Go | ✅ | - |
| [N4](#xong-n4) | Kho file trên ổ đĩa máy chủ (`/files`) | ✅ | - |
| [N7](#xong-n7) | Ngành Điện lạnh (đề mục 3.2.7): thông số theo hạng mục, nhập liệu, file mẫu, bộ lọc | 🟡 | [N7](#n7): triển khai lên dezon.tech |
| [N9](#xong-n9) | HR (`/cham-cong`) chạy dữ liệu thật: hồ sơ nhân sự, sơ đồ tổ chức, kiêm nhiệm, chấm công & phép, lương & bảo hiểm, tuyển dụng, hiệu suất & đào tạo (API Go + PostgreSQL) | 🟡 | [N9](#n9): email / tích hợp bên ngoài, triển khai |
| [N10](#n10) | Trang Danh sách dự án (lưới thẻ) | 🟡 | [N10](#n10): chạy migration 0036 - 0039, thử trên app, ảnh bìa |
| [N11](#n11) | Trang Nhà cung cấp | 🟡 | [N11](#n11): thử trên app |
| [N12](#n12) | Trang Nhà thiết kế (Kiến trúc sư / Studio) | 🟡 | [N12](#n12): thử trên app |
| [N13](#xong-n13) | Ngành Gạch ốp lát (đề mục 3.2.4 "Ốp lát") theo file "gạch edit.xlsx": thông số theo hạng mục, nhập liệu, file mẫu, bộ lọc, hiển thị | 🟡 | [N13](#n13): triển khai lên dezon.tech, nhập dữ liệu thật |
| [N6](#xong-n6) | Kinh doanh, Quản lý thiết kế, Quản lý dự án chạy dữ liệu thật (API Go + PostgreSQL), liên kết với nhau | 🟡 | [N6](#n6): thử trên dữ liệu thật, phần còn dữ liệu mẫu |
| [N8](#xong-n8) | Chat realtime MVP: đăng nhập số điện thoại + OTP, danh bạ, kết bạn, chat 1-1 / nhóm, đã gửi / đã nhận / đã xem, online, đang soạn tin, push | 🟡 | [N8](#n8): thấy thông báo push trên Chrome thường, người dùng thử, triển khai production; [N8.1](#n8-1) SMS thật, [N8.2](#n8-2) FCM / APNs, [N8.3](#n8-3) giai đoạn 2-3 (giai đoạn 2 đã code: tệp, trả lời / chuyển tiếp / thu hồi / sửa, reaction, tìm kiếm, đa thiết bị + QR - còn thử trên trình duyệt; còn gọi, E2E), [N8.4](#n8-4) đăng nhập / kết bạn bằng email, [N8.5](#n8-5) chat nhóm nâng cao (đã code, còn thử trên trình duyệt) |

---

## 2. Backlog

### 2.1 Làm được ngay

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| <a id="m14-2"></a>M14.2 | Đăng nhập một lần cho cả web (màn đăng nhập chung ở mọi trang, bỏ khung đăng nhập riêng của QS / Kinh doanh / Thiết kế / Dự án / HR, đồng bộ đăng xuất giữa các tab) + phân quyền từng trang trên sidebar (form Thêm / Sửa tài khoản có nhóm "QS Pro" và "Các trang"; nhân viên chỉ thấy trang được tick, gõ thẳng đường dẫn bị chặn; admin / super thấy hết; Cài đặt luôn hiện) + Chat dùng tài khoản Dezon Pro (`POST /api/v1/chat/auth/dezon`, bỏ OTP / QR / đa tài khoản ở giao diện, cần quyền "chat", tự kết bạn đồng nghiệp cùng công ty, refresh kiểm lại quyền; migration 0045, 0046). Đã code + build + test Go (có DB thử), còn thử trên app thật | Toàn hệ thống | 🟡 |
| <a id="m8-4"></a>M8.4 | Xuất báo giá - dàn trang A4 ngang: mọi trang cùng cỡ chữ gốc (chia trang theo chiều cao dòng đo thật thay vì thu nhỏ chữ), khối tổng ở cuối bảng hạng mục tờ bìa (1 module: tổng · chiết khấu · VAT · tổng gồm VAT + bằng chữ; Tuỳ biến > Khối tổng: nền 3 kiểu dòng, cỡ chữ, font), tờ bìa dài tự sang trang "(tiếp)", Tuỳ biến tiêu đề cột (nền, màu chữ, cỡ, font) + khung & nét áp cả hàng tiêu đề, Lưu làm mặc định / ô nhanh (1)(2)(3) áp được lên bản xem trước, VAT theo hạng mục (ô VAT ở đầu bảng Bóc tách, projData vatHm; báo giá cộng VAT theo % từng hạng mục, đầu trang mỗi hạng mục có Chưa VAT · VAT · Thành tiền (VAT); Excel: tờ bìa thêm VAT + Tổng gồm VAT, sheet hạng mục thêm VAT + Thành tiền (VAT)), tiến độ thanh toán + ghi chú + ô ký thành trang bìa sau (trang cuối riêng), thanh sheet ở chân vùng xem (mỗi phần / hạng mục 1 thẻ kèm khoảng trang, bấm nhảy tới trang đầu), mức 100% = trang rộng đúng khung xem. Đã code + build + thử dữ liệu giả, còn thử trên app thật; Excel chưa theo bố cục tờ bìa / trang bìa sau mới; Phần thô vẫn chia theo số dòng | User | 🟡 |
| <a id="m10-3"></a>M10.3 | Danh sách sản phẩm: chọn chế độ xem Bảng · Lưới thẻ · Danh sách (nhớ trong máy, `qs_splayout`; dạng thẻ có ảnh, giá, duyệt, yêu thích, thêm vào dự án, chọn nhiều) + tiêu đề bảng đồng bộ kiểu Bóc tách (IN HOA, căn giữa, xuống dòng, nút phễu mở menu sắp xếp / ẩn cột) + thanh công cụ / hàng chọn cột / bảng tách thành module riêng, thanh công cụ 1 dòng tự gọn khi hẹp (Yêu thích chỉ biểu tượng, "Tất cả" không lặp tên hạng mục). Đã code + build (`SpCards.jsx`, `list.css`), còn thử trên app thật | User | 🟡 |
| <a id="m10-5"></a>M10.5 | Modal Thông tin sản phẩm: nút "Ghi danh vào nhiều dự án" (tìm + tick nhiều dự án, số lượng, Lưu; trùng SP thì cộng số lượng, không thì thêm vào Chưa phân tầng). Đã code + build, còn thử trên app thật | User | 🟡 |
| <a id="m11-x"></a>M11.x | Nhập dữ liệu: panel Sản phẩm vừa nhập sang cột trái (rộng như cột trái các tab) + dashboard "Ghi nhận dữ liệu nhập" (kỳ Hôm nay / Tuần / Tháng / Quý / Năm / Tuỳ chọn, lọc Người nhập / Người duyệt / Thương hiệu, KPI, biểu đồ cột, top người nhập). Đã code + build, còn thử trên app thật | User | 🟡 |
| <a id="m10-4"></a>M10.4 | Danh sách sản phẩm: bộ cột theo hạng mục - dải chip / "Hiện tất cả cột" chỉ có cột của ngành trong hạng mục (Thiết bị điện = đèn + công tắc; hạng mục chưa có bộ thông số như Thạch cao, Cửa chỉ còn 25 cột chung thay vì 135; lọc "Hạng mục SP" = 1 loại có bộ thông số riêng như Bồn cầu, Lavabo, Ổ cắm thì chỉ còn thông số của loại đó); mỗi hạng mục nhớ cột đang hiện riêng (`qs_spcolcfg.byNode`, hạng mục chưa lưu thì dùng bộ theo ngành như cũ); bộ cột tự đặt tên và nút nhanh (1)(2) chỉ hiện ở hạng mục lúc tạo (bộ / nút cũ chưa gắn hạng mục chuyển về "Tất cả hạng mục"); bộ "Của tôi" vẫn theo tài khoản, dùng chung; khung "Chọn nhanh cột" bỏ bộ "Hiện tất cả cột" (trùng nút Hiện tất cả ở dải chip). Đã code + build (`ProductList.jsx`, `spModel.js`), còn thử trên app thật | User | 🟡 |
| <a id="m9-2"></a>M9.2 | Mua hàng: nút Edit trên thẻ nhà cung cấp (phòng mua hàng) - thêm hàng tay (tên · ĐVT · SL · đơn giá · ghi chú; cộng vào tổng / VAT / kế hoạch thanh toán và gửi kèm đơn NCC, ghi chú dòng nằm ở ô khu vực của dòng đơn), thêm / đổi tên / xoá cột tự đặt (giá trị từng dòng gửi kèm đơn ở ô khu vực), ghi chú riêng cho NCC (nối vào ghi chú đơn). Lưu ở projData `mhExtra` (thêm khoá vào danh sách cho phép của server Go). Đề xuất chiết khấu không gồm hàng thêm tay. Đã code + build + thử phép tính đơn, còn thử trên app thật | User | 🟡 |
| <a id="m2-1"></a>M2.1 | Danh sách dự án (Bảng điều khiển, dạng thanh): cột "Phụ trách" - nhân sự phụ trách từng dự án (ô tròn chữ cái đầu, 1 người kèm tên); quản trị bấm "+" gõ tìm + tích chọn nhiều nhân sự, ghi ngay vào dữ liệu công ty `__cty` khoá `daPhuTrach` (thêm khoá vào danh sách cho phép của server Go), người khác chỉ xem. Trang Thông tin dự án: cột trái "Báo cáo" - Nhân sự dự án 3 vai trò (Quản lý = cột Phụ trách · Người điều phối · Người thực hiện; `daPhuTrach[mã] = {ql, dp, th}`, bản cũ dạng mảng = Quản lý) + Báo cáo dự án (trạng thái, tiến độ, ngày tạo, số bản nháp, KTS, dòng SP, giá trị báo giá, lợi nhuận, NCC). Đã code + build + test Go, còn thử trên app thật; chưa lọc "Dự án của tôi" theo cột này | User | 🟡 |
| <a id="m8-5"></a>M8.5 | Xuất báo giá - khổ in A4 / A3 × ngang / dọc (`bgCfg.kho`, cột trái trên nút xuất): trang xem trước, chia trang theo chiều cao, thu phóng Vừa khung và cửa sổ in / PDF theo khổ. Đã code + build, còn thử trên app thật; file Excel chưa đổi khổ giấy | User | 🟡 |
| <a id="m9-3"></a>M9.3 | Mua hàng: VAT riêng từng nhà cung cấp (chân bảng NCC: Tổng (chưa VAT) · VAT (%) ô nhập + nút xổ 10 / 8 / 5 / 0% + về VAT dự án · Tổng (VAT); lưu `mhExtra[ncc].vat`, chưa đặt = VAT dự án), tổng / kế hoạch thanh toán / đơn + đề xuất gửi NCC theo VAT riêng. Đã code + build, còn thử trên app thật | User | 🟡 |

### 2.2 Tính năng mới

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| <a id="n8"></a>N8 | Chat realtime MVP (đăng nhập số điện thoại + OTP, danh bạ, kết bạn, chat 1-1 / nhóm, đã gửi / đã nhận / đã xem, online, đang soạn tin, push): đã code ở máy phát triển 2026-10-30 - migration 0018 (9 bảng `chat_*`, tài khoản chat riêng, không theo công ty), module Go `chat` (REST `/api/v1/chat/...` + WebSocket `/api/v1/chat/ws`, quyền `rpc.SelfAuth`), Web Push VAPID (`platform/webpush`), trang Chat React nối máy chủ thật (giữ Dezbot / SiteFlow Bot); đã thử ở máy phát triển (xem [mục 5](#xong-n8)). Còn lại: thấy thông báo push hiện lên trên Chrome thường (headless chỉ kiểm được tới FCM nhận gói, 201), người dùng thử, production: đã lên dezon.tech 2026-11-05 (migration 0018-0023) nhưng TẮT tệp chat (`CHAT_S3_ENDPOINT=` trống) vì chưa có bản ghi DNS `s3.dezon.tech`; còn bật tệp chat, kiểm WebSocket qua Caddy, `/chat-sw.js`. Tài liệu: `backend/docs/API.md` mục 2.1 "Chat", `docs/02-ky-thuat/database/decisions.md` D-15 | Toàn hệ thống | 🟡 |
| <a id="n8-4"></a>N8.4 | Chat ([N8](#n8)): đăng nhập / thêm tài khoản bằng email (mã OTP 6 số gửi qua email, SMTP `SMTP_*`; chưa cấu hình thì mã ghi vào log) bên cạnh số điện thoại; tìm người dùng và gửi lời mời kết bạn bằng email. Tài khoản email là tài khoản riêng (chưa liên kết với tài khoản số điện thoại). Đã code + test API ở máy phát triển 2026-11-02 (xem [mục 5](#xong-n8)); còn thử giao diện trên trình duyệt, cấu hình SMTP thật (mailer mới có AUTH PLAIN), chạy migration 0019 ở database dev / production | Toàn hệ thống | 🟡 |
| <a id="n8-5"></a>N8.5 | Chat nhóm nâng cao ([N8](#n8), `backend/CHAT.md` mục 9): "Đã xem bởi N người" + danh sách đã xem / đã nhận, ghim tin nhắn (tối đa 5, migration 0021) đã code 2026-11-02; @nhắc tên, ảnh đại diện + mô tả nhóm, link mời vào nhóm (có duyệt), quyền quản trị (chuyển trưởng nhóm, giải tán, chỉ quản trị được nhắn / sửa thông tin / thêm người) đã code 2026-11-03 (migration 0022, xem [mục 5](#xong-n8)). Còn lại: thử giao diện trên trình duyệt; `data-dictionary.md` / `erd.md` cho 0021-0022; route ghim tin trong bảng `API.md` | Toàn hệ thống | 🟡 |
| <a id="n9"></a>N9 | HR: còn gửi phiếu lương qua email / chuyển khoản lương, gửi thư mời phỏng vấn, tự đăng tin lên kênh tuyển dụng (cần SMTP / tài khoản kênh 🔑); 2FA, SSO, giới hạn IP; tích hợp máy chấm công (cần API thiết bị 🔑); đã triển khai lên dezon.tech 2026-11-05 (migration 0024-0035; nhánh `src_N` đã có 0018-0023 của Chat nên HR đánh số từ 0024) | User | 🟡 |
| <a id="n12"></a>N12 | Trang "Nhà thiết kế" (nút trên thanh đầu QS, trước Nhà cung cấp; quyền = tab Dự án): 2 tab con Kiến trúc sư / Studio, gom từ cột Kiến trúc sư / Công ty của dự án + đối tác ở tab Đối tác của nhà cung cấp; thẻ: số dự án, nhà cung cấp đã dùng, tổng báo giá; chi tiết: Hồ sơ / Dự án / Nhà cung cấp đã dùng / Thương hiệu tin dùng; nút "Tạo hồ sơ" (hộp gần toàn màn hình: ảnh / logo, Kiến trúc sư / Studio, thông tin cơ bản theo loại, liên hệ, mạng xã hội, quan hệ hợp tác + đánh giá sao, chuyên môn dạng chip, giới thiệu; KTS có "Quá trình làm việc" kiểu LinkedIn - lưu dữ liệu công ty `ntkInfo`), sửa / xoá hồ sơ ở trang chi tiết. Đã code + build, còn thử trên app thật | User | 🟡 |
| <a id="n11"></a>N11 | Trang "Nhà cung cấp" (nút trên thanh đầu QS): nhà cung cấp = thương hiệu trong danh mục; lưới / danh sách thẻ (ảnh ghép sản phẩm, ngành hàng, số sản phẩm, khoảng giá, số dự án đang dùng), lọc ngành hàng, tìm; trang chi tiết tab Sản phẩm (lọc hạng mục) / Dự án đang dùng / Nhà phân phối / Giới thiệu / Đối tác ("Được tin dùng bởi" KTS, studio…; gợi ý từ KTS + studio của dự án đang dùng) / Catalogue (kéo thả file / cả thư mục, chọn file, chụp ảnh, dán Ctrl+V file / ảnh / link, dán link nhận biết Google Drive / OneDrive / Dropbox / flipbook, lấy từ tài liệu kỹ thuật của sản phẩm cùng thương hiệu; hàng đợi tải lên, lọc theo loại) - hồ sơ lưu dữ liệu công ty `nccInfo`. Đã code + build, còn thử trên app thật | User | 🟡 |
| <a id="n10"></a>N10 | Trang "Danh sách dự án" dạng lưới thẻ (tham khảo dezon.vn/du-an): ô tìm, lọc Nền tảng / Trạng thái / Khu vực / Phân khúc, chip "Dự án có báo giá"; bấm thẻ mở trang chi tiết dự án (ảnh ghép từ ảnh sản phẩm, bảng thông tin, tab Thông tin / Hình ảnh (ảnh gom theo phòng, mỗi phòng 1 dải ảnh cuộn ngang như dezon.vn; ảnh lưu `{url, phong}` trong `anhDuAn`; thêm ảnh bằng chọn ảnh / chọn thư mục (thư mục con = phòng) / kéo thả file, thư mục / Ctrl+V / dán link / ảnh sản phẩm trong dự án / chụp ảnh) / Sản phẩm / Nhà cung cấp / Dự án liên quan, nút Mở ở Bóc tách); liên kết từ bảng Ghi danh nhiều dự án (có nút "Ghi danh dự án mới": tạo dự án rồi ghi danh SP vào đó); nút "Nhập dự án" mở trang nhập đủ trường (chỉ thêm vào danh sách, không mở thành dự án đang làm), ô đầu là Kiến trúc sư (migration 0036 `projects.architect`): gợi ý dự án KTS đã tham gia, trùng KTS + tên thì chuyển về dự án đã có; khối BOQ (tải file PDF / Excel đính vào dự án, hoặc "Tạo BOQ từ Dezon Pro" = tạo dự án ở Bảng điều khiển rồi chuyển sang đó); trang chi tiết có nút Sửa thông tin / Yêu cầu sửa - sửa tại chỗ ngay trên bảng Thông tin của trang chi tiết (cùng các mục, thêm Studio = migration 0038 `projects.studio`; tab Thông tin = thẻ Thông tin cơ bản kiểu dezon.vn - Dự án, Công ty, Địa điểm, Nhóm thiết kế, Kiến trúc sư, Nhiếp ảnh gia, Nhà thầu thi công, Năm hoàn thiện (migration 0039) - + Thông tin nâng cao thu gọn) (migration 0037 `project_edit_requests`): admin / tài khoản có quyền `da_duyet` lưu thẳng, người khác gửi phiếu chờ duyệt (báo người duyệt, Duyệt & áp dụng / Từ chối ngay trên trang chi tiết). Đã code + build + test Go, còn: chạy migration 0036 - 0039, sinh lại schema.sql, thử trên app thật, ảnh bìa dự án, trường người tạo dự án (cần migration) | User | 🟡 |
| <a id="n13"></a>N13 | Gạch ốp lát: còn triển khai lên VPS dezon.tech (migration 0043) và nhập dữ liệu gạch thật | User | 🟡 |
| <a id="n7"></a>N7 | Điện lạnh: còn triển khai lên VPS dezon.tech (migration 0017) và thử nhập dữ liệu thật | User | 🟡 |
| <a id="n6"></a>N6 | Kinh doanh / Quản lý thiết kế / Quản lý dự án: còn lại người dùng thử trên dữ liệu thật ở dezon.tech; Kinh doanh (2026-11-09, đã code + build, còn thử trên app thật): form "Thêm khách hàng tiềm năng" mở thành trang đầy đủ, Người khởi tạo = tài khoản đang đăng nhập, Quản lý mặc định = trưởng phòng ban (dữ liệu HR mẫu), "Nhân sự phụ trách" + "Admin Kinh doanh" (lưu trong phu_trach vai trò Admin Kinh doanh), Nguồn / Quản lý là danh sách xổ tự thêm mục (`__cty` khoá `kdOptions`); Tổng quan có bộ lọc nguồn + thẻ "Nguồn khách hàng"; trang khách hàng: băng xanh 1 dòng, cột trái kiểu QS, thanh giai đoạn dạng bước; giai đoạn mới "Nhân sự KD phụ trách" (`giao-ns`, migration 0040, lead mới chưa có nhân sự phụ trách vào thẳng giai đoạn này); nhiệm vụ & điểm thưởng, phiếu bàn giao qua Chat, Dezbot, quy trình bước mua hàng (chỉ trong phiên) vẫn là dữ liệu mẫu; thử giao diện bản 8686a37 chạy dữ liệu thật trên trình duyệt | User | 🟡 |
### 2.3 Cần credential 🔑

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| <a id="n8-1"></a>N8.1 | Chat ([N8](#n8)): nhà cung cấp SMS thật cho mã OTP (cài interface `chat.SMSSender`; hiện `logSender` chỉ ghi mã vào log server nên server thật chưa đăng nhập chat được nếu không xem log) | Toàn hệ thống | ⬜ |
| <a id="n8-2"></a>N8.2 | Chat ([N8](#n8)): push FCM / APNs cho app mobile (cột `chat_devices.push_kind` đã nhận `fcm` / `apns`, API hiện chỉ nhận `webpush`) | Toàn hệ thống | ⬜ |

### 2.4 Subsystem lớn 🏗

| Mã | Tính năng | App | Trạng thái |
|---|---|---|---|
| <a id="n8-3"></a>N8.3 | Chat giai đoạn 2-3 ([N8](#n8), `backend/CHAT.md` mục 1 và 16): ảnh / video / tệp / tin nhắn thoại đã code 2026-11-02 (MinIO + presigned URL, `CHAT.md` mục 12, xem [mục 5](#xong-n8), quyết định D-17); trả lời / chuyển tiếp / thu hồi / sửa tin, reaction, tìm tin không dấu, đa thiết bị (danh sách thiết bị, đăng xuất từ xa, đăng nhập web bằng QR) đã code 2026-11-03 (migration 0023, xem [mục 5](#xong-n8)). Còn lại: thử giao diện giai đoạn 2 trên trình duyệt (camera quét QR, panel tìm tin, menu tin); `data-dictionary.md` / `erd.md` / `decisions.md` cho 0023; gọi thoại / video, mã hoá đầu cuối (E2E); với media: CDN, lưu trữ lạnh sau 90 ngày, nén / chuyển mã video, quét virus thật (ClamAV), tệp trên 200 MB (multipart), triển khai production (MinIO, `CHAT_S3_*`, migration 0020) | Toàn hệ thống | 🟡 |
| <a id="n1"></a>N1 | Refactor database sang PostgreSQL trực tiếp (`DATABASE_URL`, backend Go dùng `pgx`): đã triển khai trên database local `qspro_en2`; mọi tab QS đã chạy thử tự động trên trình duyệt (React + Go, database thử `qspro_gotest`, xem [N3](#xong-n3)); 2026-10-24 đã nạp `qspro_en2` lên PostgreSQL của VPS CloudFly (xem [N2](#n2)); còn người dùng thử tay trên dữ liệu thật, xoá 8 cột `DEPRECATED` (D-09; `delete_requests.note`, `product_combos.note`, `companies.last_reminder_date` / `reminder_milestone` đã ra khỏi danh sách ngày 2026-10-15 vì M15.2 / M10.2 / M17.3 dùng lại; migration 0010 / 0012 / 0013 đổi chú thích cột) - xem `docs/02-ky-thuat/database/ket-qua-trien-khai.md` mục 8 | Toàn hệ thống | 🟡 |
| <a id="n2"></a>N2 | Server Go + Gin (`backend/`, đã commit ở `5fa5d52` / `033c421`): đã chuyển mã; cấu hình deploy VPS đã có (`infra/deploy/`: Docker Compose + Caddy HTTPS phục vụ React và chuyển tiếp route Go cùng tên miền, PostgreSQL 17, script sao lưu / khôi phục / tạo super; hướng dẫn `docs/04-van-hanh/trien-khai-vps-cloudfly.md`), đã chạy thử trọn bộ trên máy 2026-10-22; 2026-10-24 đã chạy trên VPS CloudFly bằng IP (`http://222.255.184.134/qs`, mã chép thẳng từ máy phát triển, chưa qua GitHub) và nạp dữ liệu `qspro_en2` + 1430 file, mở cổng 80/443 ở Cloud Firewall của CloudFly, vào được từ Internet; tối 2026-10-24 chuyển sang `https://dezon.tech` (chứng chỉ Let's Encrypt, `www` và `http` chuyển về); còn bật Lark (`REPORT_JOB` và webhook đang tắt / giả), so vi sai job báo cáo và các nhánh chỉ chạy khi database thiếu cột - xem `backend/docs/ARCHITECTURE.md` mục "Việc còn mở" | Toàn hệ thống | 🟡 |

---

## 3. Ưu tiên tiếp theo

> Thứ tự dưới đây là **gợi ý của Claude, chưa được duyệt** — xếp theo "chỉ còn thiếu nối giao diện" trước, "cần quyết định nghiệp vụ" sau.

1. Hai hạng mục lớn ở mục 2.4: [N2](#n2) (bật Lark trên VPS CloudFly theo `docs/04-van-hanh/trien-khai-vps-cloudfly.md`) và [N1](#n1) (người dùng thử trên dữ liệu thật, xoá cột D-09)
2. Chủ sản phẩm xác nhận các GIẢ ĐỊNH đã ghi trong mục 5 (gần nhất: M1.2, M6.1, M10.1, M17.3)

---

## 4. Cách thêm tính năng

- Việc thuộc module có sẵn → mục 2.1, mã `M<số module>.<số thứ tự>` (số kế tiếp trong module đó), anchor `m<module>-<số>`.
- Tính năng mới ngoài các module trên → mục 2.2, mã N tiếp theo (`hiện tại: N14`), anchor `n<số>`; dùng xong thì tăng số ở đây.
- Cần tài khoản / khoá bên thứ ba → mục 2.3. Hạng mục lớn cần làm riêng một đợt → mục 2.4.
- Quy tắc cập nhật đầy đủ: `.claude/rules/docs/roadmap-sync.md`.

---

## 5. Đã xong

### App User

<a id="xong-1"></a>
#### M1 - Đăng nhập & phiên

- Đăng nhập bằng tên đăng nhập hoặc email cùng mật khẩu
- Tự vào thẳng ứng dụng khi trình duyệt còn phiên hợp lệ
- Phiên làm việc 7 ngày, một tài khoản dùng được nhiều máy cùng lúc
- Chặn đăng nhập khi tài khoản bị khoá, chưa thuộc công ty, công ty tạm khoá hoặc hết hạn
- Kiểm tra lại tài khoản và công ty ở mỗi thao tác, mất phiên trong tối đa 30 giây khi bị khoá
- Tự mã hoá mật khẩu đang lưu dạng chữ thường ở lần đăng nhập đầu
- Hiện tên, vai trò, công ty; đổi logo và tên trang theo công ty
- Ẩn các tab không được cấp, tự chuyển sang tab đầu tiên được phép
- Tự đổi mật khẩu (phải nhập đúng mật khẩu hiện tại)
- Lưu và xoá bộ cột "Của tôi" theo tài khoản, giữ khi sang máy khác
- Lưu các bảng cột đặt tên của Bóc tách theo tài khoản
- Dải nhắc "Đã có bản cập nhật mới" với nút Tải lại ở module QS React (M1.1): server Go gửi header `x-app-ver` trên mọi response `/api/v1` (kể cả 401 / 403 / 404 không có route), cùng giá trị với cổng `/api/:fn`; React thấy giá trị khác lần đầu thì hiện dải, bấm "Tải lại" để nạp bản mới; giao diện tối có nền dải sáng hơn để không lẫn vào thanh trên
- Đăng xuất làm phiên hết hiệu lực ngay ở máy chủ (M1.2): bảng phiên đăng nhập (migration 0014 `user_sessions`), token mang id phiên; đăng xuất chỉ thu hồi phiên đó, máy khác của cùng tài khoản vẫn dùng tiếp; tự đổi mật khẩu đóng các phiên khác; admin đặt lại mật khẩu thu hồi mọi phiên của tài khoản đó (tự đặt cho mình thì giữ phiên đang dùng); giao diện bị thu hồi phiên thì về màn đăng nhập với "Phiên đã hết, mời đăng nhập lại.". GIẢ ĐỊNH (chủ sản phẩm có thể đổi): token cấp trước 0014 (không có id phiên) bị từ chối, người dùng đăng nhập lại một lần; khoá tài khoản không xoá phiên (mở khoá thì token cũ dùng tiếp); chạy nhiều tiến trình server thì tiến trình khác còn nhận token đã thu hồi tối đa 30 giây (cache phiên). Database chưa chạy 0014 -> 500 báo đích danh bảng thiếu
- Ghi nhật ký đăng nhập, đăng nhập sai, đăng xuất, đổi mật khẩu

<a id="xong-2"></a>
#### M2 - Bảng điều khiển

- Thẻ "Đang làm việc" cho bản nháp đang mở
- 5 ô số liệu: số dòng, giá vốn, giá bán chưa VAT, tổng thanh toán gồm VAT, lợi nhuận và biên
- Biểu đồ giá trị theo nhóm hạng mục
- Danh sách dự án gom các bản nháp cùng tên thành một thẻ
- Ô tìm kiếm dự án
- Tự mở bản nháp đầu danh sách khi vào ứng dụng
- Nút "Dùng" để chuyển sang bản nháp khác
- Đổi tên bản nháp ngay trên Bảng điều khiển
- Chip gắn / bỏ link Dezon của dự án
- Mở hộp "Thông tin dự án" từ thẻ dự án

<a id="xong-3"></a>
#### M3 - Dự án

- Tạo dự án mới (tên, khách hàng, số điện thoại, địa chỉ, link Dezon, VAT)
- Thêm bản nháp mới cho một dự án
- Mở bản nháp và nạp dòng bóc tách cùng dữ liệu rời
- Sửa thông tin chung, áp cho mọi bản nháp của dự án
- Sửa thông tin riêng từng bản nháp (trạng thái, VAT, mã báo giá, quy mô, diện tích, ghi chú...)
- Cập nhật phần trăm tiến độ
- Nhân bản bản nháp, chọn phần sao chép (Bóc tách, Xuất báo giá, Phần thô)
- Xoá một bản nháp
- Xoá cả dự án
- Tự lưu dữ liệu rời của bản nháp lên máy chủ
- Tự đưa bản lưu cũ trên trình duyệt lên máy chủ
- Mỗi công ty chỉ thấy dự án của mình
- Ô chọn dự án và thẻ dự án phía trên các màn hình
- Lối mở "Thông tin dự án" (M3.1, QT-09 Q-12): hộp Thông tin dự án (cùng nội dung trang `v-project` cũ, không dựng trang riêng) mở từ thẻ dự án ở Bóc tách, Chi phí, Xuất báo giá, Mua hàng, Dự án và từ banner, thẻ dự án, dòng bản nháp ở Bảng điều khiển; kiểm bằng admin + nhân viên 2026-10-15

<a id="xong-4"></a>
#### M4 - Bóc tách

- Chọn đề mục trong cây hạng mục, lọc bảng theo đề mục
- Thêm tầng / phòng và đặt tầng đang thêm
- Thêm sản phẩm từ danh mục (bấm dấu cộng hoặc kéo thả), tự cộng dồn số lượng khi trùng
- Thêm dòng trống để tự nhập
- Chọn sản phẩm cho dòng hoặc tạo sản phẩm mới vào danh mục
- Sửa ô trực tiếp, tự tính giá đại lý, đơn giá, thành tiền
- Gõ Markup, Margin hoặc Lợi nhuận (VND) để tính ngược giá bán
- Sửa hàng loạt: chuyển tầng, đặt lợi nhuận, sửa cột
- Sao chép, nhân bản, xoá nhiều dòng
- Kéo thả đổi vị trí dòng và thứ tự tầng, đổi tên tầng
- Sắp xếp và lọc theo cột
- Cập nhật dòng lệch so với danh mục (từng dòng hoặc cả bản nháp)
- Chế độ Bảng tính và Bảng thường
- Hạng mục tự tạo trong cây

<a id="xong-5"></a>
#### M5 - Phần thô & công tác

- Nhập công tác bằng form (tên, hạng mục, đơn vị tính, giá, ảnh, ghi chú, thông số) với giá bán lẻ / chiết khấu / giá đại lý tự tính qua lại
- Danh sách chờ trên trình duyệt: sửa, xoá rồi lưu hàng loạt vào cơ sở dữ liệu, dòng lỗi ở lại kèm lý do
- Tuỳ chọn thêm luôn công tác vừa lưu vào bảng khái toán của dự án đang chọn
- Danh mục công tác ở 3.1 Phần thô: thẻ lọc Tất cả / Chưa duyệt / Đã duyệt / Yêu thích, tìm kiếm và bộ lọc
- Sửa công tác trong cửa sổ cập nhật, sửa nhanh từng ô trên bảng và sửa hàng loạt một trường
- Duyệt / bỏ duyệt công tác (từng dòng hoặc nhiều dòng); sửa nội dung tự đưa về Chưa duyệt
- Đánh dấu yêu thích dùng chung cho cả công ty
- Xoá một hoặc nhiều công tác
- Xem lịch sử thay đổi của từng công tác (200 dòng mới nhất)
- Tải danh sách công tác ra Excel (toàn bộ đang lọc hoặc các dòng đã chọn)
- Thư viện công tác trong tab Bóc tách theo 4 loại báo giá; thêm vào bảng Phần thô bằng dấu cộng, kéo thả, cả nhóm, một dự án mẫu có sẵn, bộ dự toán
- Bảng Phần thô tự tính khối lượng, thành tiền, lợi nhuận, VAT và tổng theo hạng mục
- Bảng Phần thô tự lưu theo dự án lên máy chủ
- Công tác có phân loại đề mục hiện thêm ở đề mục hoàn thiện 3.2.x và thêm được vào bảng bóc tách
- Nhập công tác từ file (M5.1): Nhập dữ liệu > Phần thô có "Tải file mẫu" (`/mau-nhap-cong-tac.xlsx`, byte = bản cuối trong git) và "Chọn file Excel/CSV"; máy chủ Go đọc file (`POST /api/v1/work-items/import/parse`, không ghi gì) rồi đưa vào danh sách chờ, lưu bằng đường lưu công tác sẵn có; dòng lỗi ở lại kèm "Dòng N: lý do" (đúng số dòng trong file), chỉ lưu được sau khi sửa trong form (Loại báo giá / Cách tính đọc không được thì để trống, bắt chọn lại); dòng "Ghi chú:" của file mẫu bị bỏ; file hỏng báo lỗi tiếng Việt. Giả định: cột "Thứ tự" tuỳ chọn; thiếu Hạng mục là lỗi như form nhập tay; số đọc kiểu VN như form ("450.000" = 450000), số âm / chữ là lỗi; tối đa 2000 công tác mỗi file
- Lọc thư viện theo nhà thầu (M5.2): ô "Tên nhà thầu" ở thư viện 3.1 = 4 nhà thầu cũ (H77, Decox, TTP, Unicons) ∪ nhà thầu có trong công tác của công ty, kèm số công tác theo loại báo giá đang chọn; chọn một nhà thầu thì thư viện chỉ còn công tác của nhà thầu đó (không phân biệt hoa thường / khoảng trắng), nhóm trống ghi "Nhà thầu X chưa có đơn giá cho mục này"; gợi ý ô Nhà thầu ở form nhập và hộp Cập nhật dùng cùng danh sách. Giả định: mỗi công tác gắn 1 nhà thầu với đơn giá riêng; chọn nhà thầu chỉ LỌC, không đổi giá dòng đã có trong bảng; công tác dựng sẵn (không thuộc dữ liệu công ty) không có nhà thầu nên bị ẩn khi chọn nhà thầu
- Ô "Thứ tự" của công tác (M5.3) ở form Nhập dữ liệu > Phần thô, hộp Cập nhật công tác và cột sửa nhanh ở Danh sách SP 3.1 (số nguyên ≥ 0, chỉ công tác của công ty); thư viện sắp theo loại báo giá rồi Thứ tự như máy chủ, đổi Thứ tự thấy ngay không cần tải lại; nhóm đứng theo công tác có thứ tự nhỏ nhất. Lưu ý: sửa Thứ tự cũng đưa công tác về Chưa duyệt như mọi lần sửa

<a id="xong-6"></a>
#### M6 - Tờ bìa (khái toán)

- Tự dựng tờ bìa 26 mục từ mẫu chuẩn khi bản nháp chưa có tờ bìa
- Tự cộng tiền từng mục nhỏ từ các dòng bóc tách cùng mã hạng mục
- Cộng thêm bảng Phần thô vào mục 3.1
- Mục cha tự bằng tổng mục con, tổng tờ bìa và tỷ trọng % từng mục
- Sửa tay ô chi phí (lưu ngay) kèm nhãn "tự động" / "sửa tay"
- Bỏ sửa tay từng mục hoặc "Lấy lại số từ bóc tách" cho cả tờ bìa
- Sửa số thứ tự, tên, mô tả; thêm mục lớn / mục nhỏ; xoá mục (xoá mục và sửa tên mục lớn chỉ có ở Mẫu 2)
- Ẩn / hiện mục lớn trên tờ bìa, lưu theo bản nháp
- Sửa thông tin đầu tờ bìa (mã báo giá, khách hàng, quy mô, diện tích, nhu cầu, phân khúc)
- Nạp lại mẫu chuẩn và Lưu tờ bìa
- Hai kiểu trình bày Mẫu 1 / Mẫu 2, nhớ trên máy
- Bảng tính diện tích theo hệ số và nút "Áp vào tờ bìa"
- Tự lưu số đang hiện vào tờ bìa trước khi xuất Excel
- Đơn giá phần thô / m² đất (M6.1): khối "Bảng tính diện tích (hệ số)" ở Xuất báo giá > Chỉnh sửa có dòng chỉ đọc "Đơn giá phần thô / m² đất" = chi phí mục 3.1 trên tờ bìa ÷ diện tích khu đất (Dài × Rộng), kèm dòng ghi chú công thức. GIẢ ĐỊNH chờ chủ sản phẩm xác nhận: chỉ hiển thị (không lưu, không vào bản xem trước / Excel); diện tích 0, tờ bìa chưa có 3.1 hoặc 3.1 âm thì hiện "—"

<a id="xong-7"></a>
#### M7 - Chi phí

- Dải tổng đầu trang: vốn, giá bán, lợi nhuận, biên, VAT, tổng thanh toán
- Lọc theo hạng mục dùng chung cho mọi màn hình
- Cộng Phần thô và trừ chiết khấu báo giá khi xem tất cả hạng mục
- Thẻ Tổng quan chi phí kèm biểu đồ theo hạng mục và theo nhà cung cấp
- Tìm kiếm và chip cảnh báo: đang lỗ, biên thấp, chưa có giá bán, chưa có giá vốn
- Gom theo hạng mục / tầng / nhà cung cấp, có tổng từng nhóm
- Sắp xếp theo cột, bật tắt 14 cột hiển thị
- Sửa giá và số lượng ngay trong bảng, ghi thẳng vào dòng bóc tách
- Đặt nhanh lợi nhuận % cho nhiều dòng
- Đặt biên lợi nhuận mục tiêu để tính lại giá bán
- Biên tối thiểu theo bản nháp, tô vàng dòng biên thấp
- Sửa VAT của bản nháp
- So sánh các bản nháp của cùng dự án
- Xuất Excel đúng bảng đang xem; gợi ý khi hạng mục đang lọc trống

<a id="xong-8"></a>
#### M8 - Xuất báo giá

- Xem trước báo giá nhiều trang: trang 1 tờ bìa, từ trang 2 bảng chi tiết
- Chọn hạng mục đã bóc để đưa vào báo giá
- Chọn cột xuất, dùng chung với bảng Bóc tách
- Mặc định ẩn cột nội bộ, có lựa chọn "Xuất kèm (bản nội bộ)"
- Chỉnh trình bày: mỗi phần 1 trang, số dòng mỗi trang, mức phóng, kéo đổi thứ tự / độ rộng cột
- Tổng kết & điều khoản: chiết khấu tổng, ngày báo giá, hiệu lực, tiến độ thanh toán, ghi chú
- Thông tin công ty (tên, logo, địa chỉ, liên hệ) trên bản xem trước và bản in
- Xuất Excel nhiều trang tính: Tờ bìa, Tổng cộng, 3.2 Phần hoàn thiện, 3.1 Phần thô, chi tiết theo nhóm
- Nhúng ảnh sản phẩm vào file Excel (bỏ qua ảnh webp / gif / svg và ảnh trên 5 MB)
- Cảnh báo dòng đang dùng giá cũ trước khi xuất Excel
- Xuất PDF / In khổ A4 ngang qua trình duyệt
- Tự chốt phiên bản khi xuất, chốt tay, lịch sử phiên bản, xem lại và so sánh
- Cảnh báo khi tổng tờ bìa khác tổng trang cuối
- Nút xuất Excel ở các tab khác, tải danh sách sản phẩm và file mẫu nhập liệu
- Excel báo giá theo thông tin công ty, tiến độ thanh toán và ghi chú như bản xem trước (M8.1): tờ bìa có tên + địa chỉ / liên hệ công ty (logo nhúng nếu là ảnh PNG / JPG tải được), sheet "Tổng cộng" có Ngày báo giá · Hiệu lực, TIẾN ĐỘ THANH TOÁN (Đợt i: nội dung | số tiền | tỷ lệ %), GHI CHÚ & ĐIỀU KHOẢN, Người lập; không còn ghi cứng tên một công ty. Giả định: chữ / số lấy nguyên từ bản xem trước (máy chủ không tính lại), bố cục Excel của khối tổng kết là của bản Go; logo best-effort (logo mặc định `/logo.svg` là SVG nên không nhúng)
- Excel theo Mẫu 1 / Mẫu 2 của tờ bìa và thứ tự / độ rộng cột đã kéo ở bản xem trước (M8.2): Mẫu 1 có cột NỘI DUNG, ô NO / HẠNG MỤC gộp theo mục lớn, mục có con in đậm "(gồm các mục dưới)". Giả định: Mẫu 2 = bố cục Excel cũ; độ rộng chỉ áp cho cột người dùng đã kéo (cột khác giữ bề rộng cũ)
- Ô "Hiện trạng" của dự án (M8.3, cột `projects.current_condition`, migration 0011): nhập ở hộp Thông tin dự án và đầu tờ bìa (nhiều dòng), in ở bản xem trước và Excel (giữ xuống dòng). Giả định: chỉ ghi khi người dùng đổi ô này; Excel chỉ in khi giao diện gửi thông tin trình bày (React luôn gửi)

<a id="xong-9"></a>
#### M9 - Mua hàng & đề xuất

- Xem sản phẩm bóc tách của dự án gom theo nhà cung cấp, có VAT và tổng tiền
- Nhập giảm giá nhà cung cấp theo từng dòng hoặc cho cả nhà cung cấp
- Chọn / bỏ chọn nhà cung cấp và gửi một hoặc nhiều đơn cùng lúc
- Bắt buộc nhập Người gửi và Phòng ban trước khi gửi
- Mỗi nhà cung cấp thành một đơn riêng ở trạng thái Chờ duyệt
- Báo admin trong ứng dụng và gửi thẻ yêu cầu mua hàng vào nhóm Lark
- Danh sách Đơn đã gửi theo dự án, có nút tải lại
- Đánh dấu Đã đặt hàng rồi Đã nhận hàng cho đơn đã duyệt
- Tải Excel của từng đơn
- Cảnh báo sản phẩm đã nằm trong đơn trước đó
- Lập đề xuất chiết khấu theo từng dòng và gửi phiếu
- Lập đề xuất thanh toán theo đợt (chia nhanh 2 / 3 / 4 đợt, lưu nháp) và gửi phiếu
- Danh sách và chi tiết Phiếu đề xuất đã gửi của dự án
- Người gửi nhận thông báo khi đơn hoặc phiếu được duyệt / từ chối
- Kết quả gửi Lark của đơn mua hàng (M9.1): máy chủ ghi "ok" / "loi" sau khi gửi thẻ Lark; chi tiết đơn có dòng "Kết quả gửi Lark" (Đã gửi / Lỗi gửi Lark / Chưa rõ), tab Mua hàng có chip "Lark: ..." ở từng đơn đã gửi, gửi đơn mà Lark lỗi thì hiện cảnh báo "Đã lưu đơn nhưng gửi Lark thất bại". Giả định: các đơn "ok" tạo trước bản này là giá trị mặc định lúc lưu, không phải xác nhận đã tới Lark (hiện là "Đã gửi")

<a id="xong-10"></a>
#### M10 - Danh sách sản phẩm

- Xem danh mục theo bốn khung nhìn: Tất cả, Chưa duyệt, Đã duyệt, Yêu thích
- Sửa sản phẩm trong hộp Cập nhật, kèm lịch sử thay đổi từng trường
- Sửa nhanh ngay trên bảng và hoàn tác (Ctrl+Z, tối đa 50 bước)
- Sửa hàng loạt một trường cho nhiều sản phẩm
- Duyệt / bỏ duyệt từng sản phẩm, cả nhóm biến thể hoặc hàng loạt
- Lưu & duyệt trong một lần bấm
- Sản phẩm đã duyệt tự về Chưa duyệt khi bị sửa ở Danh sách sản phẩm (cập nhật đè qua Nhập dữ liệu thì không)
- Khai báo sản phẩm đi kèm (combo) hai chiều, có số lượng
- Gom biến thể khác mã thành nhóm; tự nhận biến thể cùng mã
- Tạo biến thể, tạo nhanh nhiều biến thể, sao chép thành sản phẩm mới
- Đánh dấu yêu thích từng sản phẩm hoặc hàng loạt
- Xem kho chung Dezon ở chế độ chỉ xem (khi công ty được bật)
- Tải danh sách sản phẩm ra Excel (theo dòng đã chọn hoặc theo bộ lọc)
- Nhân viên gửi yêu cầu xoá; admin xoá trực tiếp một hoặc nhiều sản phẩm
- Ghi chú cho từng sản phẩm đi kèm (M10.2): ô "Ghi chú" ở form Cập nhật sản phẩm cho liên kết do chính sản phẩm đặt; liên kết ngược (hai chiều) chỉ xem, kèm "Sửa ghi chú ở sản phẩm kia"; hiện "Ghi chú: …" ở hộp xem sản phẩm, dòng mở rộng của Danh sách sản phẩm, thẻ đi kèm ở thư viện Bóc tách và hộp chi tiết sản phẩm Bóc tách; lưu lại form (đổi số lượng) giữ nguyên ghi chú
- Tạo bản sao riêng từ sản phẩm kho chung Dezon (M10.1): nút "Tạo bản sao riêng" ở hộp xem sản phẩm và cột thao tác của dòng "Kho Dezon"; hỏi lại rồi chép sang công ty mình (Chưa duyệt; không chép combo, biến thể, yêu thích), tải lại danh mục và mở form Cập nhật của bản sao. Trùng mã + trục biến thể -> "Công ty bạn đã có sản phẩm mã X" (tìm được đúng 1 bản riêng thì mở form của bản đó). Bản riêng chỉ che dòng kho chung trùng đủ khoá kiểm trùng, kể cả kích thước (chép sơn 15L không làm mất 1L / 5L). GIẢ ĐỊNH: `SpPerms` cho MỌI nhân viên quyền sửa nên máy chủ lặp lại phép thử `canTab('sanpham')` của giao diện: công ty có danh sách tính năng thiếu "sanpham" thì không ai chép được; nhân viên cần tab "sanpham"; admin chỉ xét tính năng công ty; quản trị hệ thống được hết. Đây là điều kiện riêng của bản Go, các đường tạo / nhập / sửa sản phẩm khác không xét tab hay tính năng

<a id="xong-11"></a>
#### M11 - Nhập dữ liệu

- Chọn ngành hàng: Thiết bị đèn, Thiết bị vệ sinh, Sơn nước
- Form nhập theo ngành, thông số hiện theo hạng mục
- Thêm ảnh bằng chọn file, kéo-thả, dán Ctrl+V hoặc dán link
- Tải tài liệu hoặc dán link tài liệu cho sản phẩm
- Giá đại lý tự tính từ giá bán lẻ và % chiết khấu
- Chọn sản phẩm đi kèm ngay lúc nhập
- Nhập biến thể: tự nhân tổ hợp thành nhiều sản phẩm
- Danh sách chờ lưu: thêm, sửa, bỏ trước khi ghi vào danh mục
- Tải file mẫu theo ngành (sơn nước theo hạng mục)
- Đọc file Excel/CSV, tự dò cột và tự nhận ngành
- Bảng xem trước: sửa ô, gắn ảnh từng dòng, đánh dấu ô thiếu
- Cảnh báo trùng trước khi lưu, cho chọn cập nhật đè hoặc xem lại
- Lưu vào danh mục kèm ghi danh vào dự án; dòng lỗi ở lại kèm lý do
- Lưu một dòng bóc tách thành sản phẩm mới trong danh mục

<a id="xong-12"></a>
#### M12 - Tệp & ảnh

- Tải ảnh sản phẩm: chọn file, kéo-thả, dán Ctrl+V
- Tự thu nhỏ và nén ảnh trước khi tải
- Tự thử lại khi tải ảnh lỗi mạng
- Dán link ảnh có sẵn thay cho tải lên
- Hình đại diện một ảnh, hình chi tiết nhiều ảnh
- Tải tài liệu sản phẩm (PDF, bản vẽ, file nén, Word, Excel), tối đa 50MB mỗi file
- Dán link tài liệu thay cho tải file
- Bốn ô tài liệu: tài liệu kỹ thuật, thông số, hướng dẫn cài đặt, bản vẽ
- Tải ảnh cho công tác phần thô
- Tải logo công ty
- Chờ ảnh tải xong (tối đa 15-20 giây) rồi mới lưu sản phẩm
- Hiển thị ảnh cũ lưu trên Lark

<a id="xong-13"></a>
#### M13 - Thông báo

- Chuông thông báo với số chưa đọc, tự đếm lại mỗi 30 giây
- Danh sách 30 thông báo mới nhất, làm nổi thông báo chưa đọc
- Bấm thông báo để đánh dấu đã đọc
- Nút "Đánh dấu đã đọc" cho toàn bộ thông báo
- Báo admin công ty khi có yêu cầu xoá sản phẩm
- Báo admin công ty khi có đơn mua hàng mới
- Báo admin công ty khi có đề xuất mua hàng mới
- Báo người gửi khi yêu cầu được duyệt hoặc bị từ chối
- Thông báo đơn mua hàng dẫn admin tới đúng chi tiết đơn, nhân viên tới tab Mua hàng
- Thông báo yêu cầu xoá dẫn admin tới đúng yêu cầu và nháy sáng
- Gửi thẻ vào nhóm Lark khi có đơn mua hàng hoặc đề xuất
- Báo cáo sản phẩm nhập mới gửi Lark tự động thứ 4 và thứ 7 lúc 8 giờ sáng
- Bấm thông báo về phiếu đề xuất mở đúng phiếu (M13.1): admin mở chi tiết phiếu ở tab Admin; người gửi mở chi tiết phiếu ở tab Mua hàng (kể cả khi chưa mở dự án, qua `GET /api/v1/my-proposals/:code` - chỉ phiếu của chính mình) và không thấy nút Duyệt / Từ chối; icon riêng cho thông báo đề xuất

### App Admin

<a id="xong-14"></a>
#### M14 - Tài khoản & phân quyền

- Danh sách tài khoản của công ty: vai trò, quyền, trạng thái, đăng nhập gần nhất
- Thêm tài khoản với tên đăng nhập, họ tên, phòng ban, mật khẩu
- Chọn vai trò Nhân viên hoặc Quản trị công ty
- Cấp quyền vào từng mục (8 mục), có Chọn tất cả / Bỏ hết
- Ba mức quyền trong Danh sách sản phẩm: không giới hạn, chỉ sửa, sửa và duyệt
- Sửa họ tên, phòng ban, vai trò, quyền của tài khoản (⚠ lưu biểu mẫu trên tài khoản quản trị hệ thống sẽ hạ vai trò xuống nhân viên - QT-03 Q-01)
- Đặt lại mật khẩu cho người khác
- Khoá và mở khoá tài khoản, người bị khoá mất phiên ngay
- Xoá tài khoản có xác nhận, không tự xoá được chính mình
- Luôn giữ ít nhất một admin đang hoạt động cho mỗi công ty
- Chặn tạo tài khoản khi công ty đã đủ số người dùng của gói
- Tên đăng nhập duy nhất trong toàn hệ thống
- Cài đặt > Tài khoản (giao diện React) hiện tài khoản Dezon Pro đang đăng nhập thay dữ liệu mẫu; tự sửa họ tên / email (`PATCH /api/v1/auth/me`, kiểm email như admin sửa), đổi mật khẩu, đăng xuất; tên đăng nhập / phòng ban / vai trò / công ty chỉ xem (2026-11-11)
- Quản trị hệ thống chọn công ty, chuyển công ty và gán công ty cho tài khoản chưa có
- Ghi nhật ký tạo, sửa, khoá, mở, đặt lại mật khẩu, xoá tài khoản
- Sửa email tài khoản ở hộp Sửa tài khoản tab Admin (M14.1): lưu chữ thường, để trống = xoá, báo "Email không hợp lệ" khi sai dạng; không trùng tài khoản khác trong CÙNG công ty (khác công ty được phép, đăng nhập tự chọn đúng tài khoản); email cũ sai dạng vẫn sửa được các mục khác; đăng nhập được bằng email mới. Giả định: đường tạo tài khoản giữ như cũ (kiểm dạng ở giao diện); email có `*`, `%`, `\` lưu được nhưng không dùng để đăng nhập (có cảnh báo)

<a id="xong-15"></a>
#### M15 - Duyệt yêu cầu (xoá sản phẩm, mua hàng, đề xuất)

- Ô thống kê Đơn mua hàng chờ duyệt và Đề xuất chờ duyệt (đếm trong 200 đơn / phiếu mới nhất)
- Danh sách Yêu cầu mua hàng của công ty kèm số chờ duyệt
- Xem chi tiết đơn mua hàng: sản phẩm, tạm tính, VAT, tổng thanh toán
- Duyệt hoặc từ chối đơn mua hàng (từ chối có hỏi xác nhận)
- Chặn xử lý lại đơn đã được duyệt / từ chối
- Danh sách Đề xuất mua hàng (chiết khấu, thanh toán) của công ty
- Xem chi tiết phiếu đề xuất chiết khấu và thanh toán theo đợt
- Duyệt hoặc từ chối phiếu đề xuất, lưu người duyệt và ngày duyệt
- Báo lại người gửi trong ứng dụng khi duyệt / từ chối
- Ghi nhật ký hoạt động khi duyệt / từ chối
- Bấm thông báo đơn mua hàng mở thẳng chi tiết đơn
- Chỉ admin công ty và quản trị hệ thống được duyệt
- Admin nhận thông báo trên chuông khi có yêu cầu xoá mới
- Bấm thông báo mở thẳng đúng yêu cầu ở tab Admin
- Danh sách yêu cầu xoá kèm người gửi, sản phẩm, thời điểm, trạng thái
- Ô đếm số yêu cầu đang chờ duyệt
- Duyệt & xoá: xoá đúng các sản phẩm trong yêu cầu
- Từ chối yêu cầu (hỏi lý do, tuỳ chọn; Huỷ = không từ chối)
- Mỗi yêu cầu chỉ xử lý được một lần
- Báo kết quả cho người gửi (đã xoá X/N hoặc bị từ chối)
- Hiện người xử lý
- Yêu cầu chỉ hiện trong công ty của người gửi
- Người duyệt / ngày duyệt đơn mua hàng (M15.1, migration 0009): ghi lúc duyệt / từ chối; hiện ở chi tiết đơn, thẻ đơn ở tab Admin ("Xử lý bởi ... · ngày") và danh sách đơn đã gửi ở tab Mua hàng ("Duyệt bởi" / "Từ chối bởi")
- Lý do xoá và lý do từ chối yêu cầu xoá sản phẩm (M15.2, migration 0010): nhân viên gửi yêu cầu được hỏi lý do (tuỳ chọn; Huỷ = không gửi), Admin từ chối được hỏi lý do; thẻ yêu cầu hiện "Lý do" và "Lý do từ chối", cả hai nối vào thông báo; tối đa 500 ký tự (kiểm ở giao diện và máy chủ, quá dài thì hộp mở lại giữ nội dung đã gõ)

<a id="xong-16"></a>
#### M16 - Nhật ký hoạt động

- Tự ghi nhật ký cho các thao tác quan trọng: ai làm, hành động, chi tiết, thời gian, công ty
- Thẻ "Nhật ký hoạt động" ở tab Admin với 120 dòng mới nhất
- Admin công ty chỉ thấy nhật ký của công ty mình
- Quản trị hệ thống thấy toàn hệ thống hoặc theo công ty đang xem
- Ghi nhật ký đăng nhập, tài khoản, công ty
- Ghi nhật ký sản phẩm, công tác, mua hàng, đề xuất, yêu cầu xoá
- Tự ghi lỗi giao diện trên máy người dùng vào nhật ký (kèm tên tab)
- Ghi nhật ký báo cáo tự động gửi Lark
- Ghi nhật ký lỗi không làm hỏng thao tác chính

<a id="xong-17"></a>
#### M17 - Công ty (quản trị hệ thống)

- Danh sách công ty dạng thẻ kèm bốn ô thống kê
- Tạo công ty với tên, mã, email, điện thoại, logo
- Tải logo lên hoặc dùng đường dẫn ảnh
- Đặt số người dùng tối đa, hạn dùng, trạng thái, ghi chú (chưa bỏ được hạn dùng đã đặt)
- Bật/tắt từng tính năng (8 mục) cho công ty
- Cho công ty dùng danh sách sản phẩm của Dezon
- Tạo kèm tài khoản quản trị khi tạo công ty (⚠ tên đăng nhập sai dạng thì công ty vẫn được tạo mà không có quản trị - QT-02 Q-03)
- Sửa thông tin, gia hạn, tạm khoá và mở lại công ty
- Công ty tạm khoá hoặc hết hạn thì người dùng bị chặn
- Xem danh sách người dùng của một công ty và thêm tài khoản
- "Xem dữ liệu" như một công ty và thoát chế độ xem
- Xoá công ty cùng toàn bộ dữ liệu, phải gõ đúng mã xác nhận
- Ghi nhật ký tạo, sửa, xoá công ty
- Thẻ "Thông tin công ty" ở tab Admin (M17.1): admin sửa tên, logo, email, điện thoại, màu chính của công ty mình, áp ngay (thanh trên đổi màu, không tải lại); quản trị hệ thống sửa khi đang xem một công ty (không đổi công ty đang dùng của chính mình); ô "Hạn dùng" chỉ xem ("Không giới hạn", "Còn N ngày · dd/mm/yyyy", "Hết hạn dd/mm/yyyy", "Đến dd/mm/yyyy")
- Ô chọn màu chính (bảng màu + mã hex + Mặc định) ở thẻ trên và tab Thông tin của hộp Tạo / Sửa công ty (M17.2); máy chủ chỉ nhận trống, `#RGB` hoặc `#RRGGBB`, báo "Màu chính phải dạng #RRGGBB"
- Nhắc gia hạn trong ứng dụng (M17.3): admin đang hoạt động nhận thông báo "Công ty sắp hết hạn sử dụng" ở các mốc còn 30/14/7/3/1/0 ngày (mỗi mốc 1 lần) và thấy dải nhắc đầu trang khi còn ≤ 30 ngày (ẩn trong ngày được; bấm thông báo mở tab Admin và hiện lại dải); job nền 8h05 giờ VN mỗi ngày + gửi bù khi khởi động, chung công tắc `REPORT_JOB`; quản trị hệ thống "Chạy thử" / "Gửi nhắc ngay" ở thẻ "Nhắc gia hạn công ty" tab Công ty. Chống trùng bằng UPDATE có điều kiện (an toàn nhiều tiến trình); không gửi được thì trả mốc; route chỉ gửi thật khi `dryRun=false`. GIẢ ĐỊNH (bản Lark đã gỡ ở 42af44d; chủ sản phẩm có thể huỷ): chỉ trong ứng dụng, không Lark, không email; giá trị mốc cũ ngoài tập coi như chưa nhắc; đổi hạn dùng thì xoá mốc. Migration 0012 chỉ đổi chú thích 2 cột

<a id="xong-18"></a>
#### M18 - Báo cáo nhập sản phẩm qua Lark

- Tự gửi báo cáo lúc 8 giờ sáng thứ Tư và thứ Bảy (giờ Việt Nam)
- Gửi bù khi máy chủ khởi động lại trong ngày gửi
- Chống gửi trùng trong cùng một ngày
- Kỳ báo cáo tính từ lần gửi theo lịch liền trước
- Mỗi công ty một thẻ Lark "Sản phẩm nhập mới"
- Thống kê số sản phẩm, nhà cung cấp, người nhập
- Bảng theo ngành hàng
- Bảng theo người nhập và ngày, kèm phòng ban
- Cảnh báo số sản phẩm chưa ghi nhận người nhập
- Gom sản phẩm chưa gắn công ty vào thẻ riêng
- Ghi nhật ký hoạt động sau khi gửi
- Dùng đường Lark riêng cho báo cáo, chưa đặt thì dùng chung với mua hàng
- Thẻ "Báo cáo sản phẩm nhập mới (Lark)" ở tab Công ty, chỉ quản trị hệ thống (M18.1): chọn Từ ngày (tính từ 0h giờ Việt Nam) hoặc để trống = kỳ hiện tại; Chạy thử xem số sản phẩm theo từng công ty và theo người nhập; Gửi ngay có hỏi lại; kết quả Đã gửi / Lỗi gửi Lark từng công ty (chi tiết lỗi chỉ ở log máy chủ). Lần gửi tay thành công tính là lần gửi của hôm nay (lịch 8h cùng ngày bỏ qua; có cảnh báo trên thẻ)

### Tính năng mới (N)

<a id="xong-n1"></a>
#### N1 - Database PostgreSQL trực tiếp

- Server đọc / ghi PostgreSQL trực tiếp qua `DATABASE_URL`; ảnh / tài liệu nằm trên ổ đĩa máy chủ (xem [N4](#xong-n4))
- Tên bảng / cột trong database sang tiếng Anh, `db-map.json` ánh xạ hai chiều với tên trong code (`backend/internal/platform/database/db-map.json`)
- Tách bảng sản phẩm thành bảng lõi + 4 bảng thông số theo ngành; cấu hình cấp công ty sang bảng `company_settings`; phiếu đề xuất tách 2 bảng dòng
- Bảng con bỏ cột công ty, lấy công ty qua bảng cha; thêm khoá ngoại và CHECK công thức
- Migration đánh số trong `infra/db/migrations/`, chạy bằng `go run ./cmd/migrate` (trong `backend/`)
- Dữ liệu sai chuyển sang schema `quarantine`, không xoá hẳn
- Test `npm run test:db` (61 đạt) và `npm run test:api` (96 đạt) trên database local `qspro_en2` (2026-10-12, app Node trước khi gỡ)
- Transaction cho thao tác nhiều bước (D-13, bản Go, 2026-10-15): lưu đơn mua hàng (mỗi đơn), lưu đề xuất, xoá / nhân bản dự án, lưu tờ bìa, tạo / xoá công ty, ghi combo / biến thể / xoá sản phẩm; lỗi giữa chừng không còn dữ liệu dở dang, thành công giữ nguyên kết quả. Gộp cả lần gửi nhiều đơn vào 1 transaction chưa làm (cần `clock_timestamp()`) - chi tiết `backend/docs/ARCHITECTURE.md` mục 3.5
- 🟡 phần còn lại ở 2.4

<a id="xong-n2"></a>
#### N2 - Server Go + Gin

- Bản chuyển `server/` sang Go + Gin trong `backend/`, chạy độc lập; app Node (`server/`, `public/`) đã gỡ khỏi repo, file tĩnh cần cho React (thông số ngành, logo, file mẫu) nhúng trong binary Go
- Giữ `POST /api/<tênHàm>`, thêm REST dưới `/api/v1`
- Migration (`go run ./cmd/migrate`) và chạy bằng Docker
- Cấu hình triển khai VPS `infra/deploy/` (Docker Compose + Caddy + PostgreSQL 17, sao lưu hằng ngày), chạy thử trọn bộ trên máy 2026-10-22
- Chạy trên VPS CloudFly (2026-10-24): Ubuntu 24.04, `setup-server.sh` + `deploy.sh --no-pull` (mã chép từ máy phát triển), chạy bằng IP `http://222.255.184.134` (`DOMAIN=http://<IP>`, `PUBLIC_URL`), nạp `qspro_en2` + kho file bằng `restore-db.sh`; kiểm từ Internet sau khi mở cổng 80/443 ở Cloud Firewall: `/healthz`, `/qs`, ảnh `/files` trả 200, trang đăng nhập QS hiện, giao diện gọi được API. Tối cùng ngày chuyển sang tên miền `https://dezon.tech/qs`: `DOMAIN=dezon.tech`, `WWW_DOMAIN=www.dezon.tech` (Caddy trả 301 về tên miền chính), chứng chỉ Let's Encrypt; kiểm từ Internet: `/healthz`, `/qs`, ảnh `/files` trả 200, `http://` trả 308 sang `https://`. `setup-server.sh` giữ file cấu hình nhà cung cấp khi nâng cấp gói (trước đó dừng ở câu hỏi `cloud.cfg` của cloud-init)
- 🟡 phần còn lại ở 2.4

<a id="xong-n3"></a>
#### N3 - Tích hợp QS vào frontend React SiteFlow

- Module QS của frontend React (`frontend/src/pages/QS`, bản clone giao diện cũ) dùng dữ liệu thật qua REST `/api/v1` của server Go; đăng nhập riêng cho QS, bỏ toàn bộ dữ liệu giả
- Bổ sung phần bản clone còn thiếu: nhập dữ liệu, sửa sản phẩm (combo, biến thể, lịch sử), phần thô, quản trị tài khoản, công ty, thông báo
- Server Go tự phục vụ thông số ngành (`*-spec.js`), logo, file mẫu nhập hàng loạt và file mẫu công tác `/mau-nhap-cong-tac.xlsx` (nhúng trong binary, byte = bản cuối trong git), không cần thư mục file tĩnh riêng; kiểm lại 2026-10-15 với `STATIC_DIR` trống
- Chạy React với server Go: đặt `CORS_ORIGINS` của server Go đúng origin của frontend (cấu hình chạy, không phải phần mã còn thiếu; deploy production thuộc [N2](#n2))
- Backlog mục 2.1 (2026-10-15, 3 đợt) làm trên server Go + module QS React, mục 2.1 nay trống; mỗi việc ghi ở module của nó trong mục 5 (mã M). Kiểm tích hợp sau đợt 3: Go build / vet / gofmt / test toàn bộ đạt trên `qspro_gotest` (migration tới 0013), mọi tab QS chạy với admin / staff / super không lỗi trang
- Kiểm thử 2026-10-15: build OK, 62.658 golden test công thức đạt (chạy lại sau backlog: 62.658 đạt / 0 khác; 2 ca thư viện công tác "giả", "mẫu+giả" nay đưa danh sách theo thứ tự máy chủ trả vì M5.3 sắp lại công tác ở máy), so từng tab với bản gốc không thiếu số tiền nào (admin, staff, super), file Excel báo giá trùng bản gốc, 20 trang SiteFlow khác không đổi pixel nào, chạy được không có thư mục file tĩnh riêng (cả bản Docker)

<a id="xong-n4"></a>
#### N4 - Kho file trên ổ đĩa máy chủ

- Ảnh / tài liệu tải lên ghi vào thư mục `UPLOAD_DIR` trên máy chạy backend (mặc định `uploads`; Docker: `/app/uploads`, volume `uploads`), đường dẫn lưu trong database là `/files/<đường dẫn>`; backend Go phục vụ `GET/HEAD /files/...` không cần đăng nhập; Caddy chuyển `/files/*` sang backend; đường dẫn Lark cũ vẫn qua `/media`
- Mã backend Go (2026-10-24): `platform/storage` ghi file qua `os.Root` (chặn đường dẫn thoát khỏi thư mục), `/files` trả 404 khi thiếu file, không liệt kê thư mục, file SVG kèm CSP sandbox; xuất Excel đọc ảnh / logo `/files/...` thẳng từ đĩa; giao diện React thêm `VITE_API_URL` trước `/files/...`; bỏ hết biến và mã kho file cũ. Kiểm: Go build / vet / gofmt / test đạt; chạy thử bộ Docker trên máy: 170 ảnh `/files` trên trang Bóc tách hiện đủ, 0 ảnh lỗi
- File cũ chuyển một lần (2026-10-24, ngoài repo, không có lệnh `migrate-files`): tải 1430 file về, đổi đường dẫn trong bản sao `qspro_en2` thành `/files/...`, nạp lên VPS bằng `restore-db.sh <dump> <kho-file.tar.gz>`
- Sao lưu hằng ngày gồm cả kho file (`qspro-files-<thời điểm>.tar.gz`), `restore-db.sh` khôi phục được database và/hoặc kho file; gỡ script đồng bộ dữ liệu từ hệ thống cũ (`infra/scripts/`)

<a id="xong-n5"></a>
#### N5 - Bố cục mới trang QS

- Thanh xanh trên cùng (`components/project/QsBar.jsx`) thay thanh tab + băng dự án: dự án ▾ (thông tin khách hàng, sửa, tìm / đổi dự án, tạo dự án), trạng thái bản nháp ▾, Chưa VAT / VAT (sửa được) / Tổng của hạng mục đang bóc (tab Bóc tách) + Bán / LN của dự án (các tab của dự án; thanh hẹp thì ẩn dần), ô tìm sản phẩm (lọc danh mục Bóc tách; ở Danh sách SP lọc bảng sản phẩm), Chế độ xem ▾ (mọi tab theo quyền), vòng tròn tài khoản (thông báo, sáng / tối, đổi mật khẩu, đăng xuất) (2026-10-22)
- Bóc tách: cột trái 3 thẻ (tiêu đề + Bộ lọc · Hạng mục sản phẩm / Đèn trong dự án · danh sách SP; Phần thô 3.1 thêm thẻ bộ lọc riêng), đầu bảng 1 thanh mỏng (hạng mục, nút Tầng / phòng + Hạng mục - bỏ dòng đáy của bảng, kiểu bảng, bộ cột; tổng tiền chuyển lên thanh xanh), bảng tính chiếm phần còn lại
- Bảng "Bộ lọc" cạnh cột trái (cùng chỗ panel Thông tin sản phẩm, thay hộp Bộ lọc + ô xổ): mỗi nút mở đúng phần của nó (nút Bộ lọc -> các khối lọc Công suất … Khoảng giá, các khối này không còn ở cột trái; ô Hạng mục sản phẩm -> danh sách hạng mục; ô Đèn / Thiết bị trong dự án -> danh sách dự án); Xoá lọc / Bỏ chọn, Esc để đóng (2026-10-22)
- Mở Dezbot: trang co lại và các bố cục hẹp bật theo bề rộng thật của trang (`@container qs`), khung chat không đổ bóng; bấm nút tròn sidebar mở hẳn sidebar
- Kiểm 2026-10-22 trên trình duyệt với API giả (Playwright, không đụng database): bố cục khớp bản phác ở 1536px, mở Dezbot không tràn, giao diện tối, Phần thô 3.1, các menu thả xuống; `vite build` đạt
- Phần còn lại (sắp lại các tab khác theo cột thẻ trái, thử trên dữ liệu thật) bỏ khỏi backlog theo yêu cầu người dùng (2026-10-24)

<a id="xong-n6"></a>
#### N6 - Kinh doanh, Quản lý thiết kế, Quản lý dự án chạy dữ liệu thật

- Migration 0015 (`sales_leads`, `sales_lead_activities`) và 0016 (`delivery_projects` + thành viên, thầu phụ, đề mục, công việc, bình luận); module Go `sales`, `delivery` (REST chỉ bản Go `/api/v1/sales/...`, `/api/v1/delivery/...`)
- Kinh doanh: khách hàng, kéo-thả giai đoạn, bảng con Thiết kế / Thi công, người phụ trách, lịch sử chăm sóc lưu trên máy chủ; gắn dự án QS (giá trị lấy theo tổng báo giá); Tổng quan tính từ dữ liệu thật (doanh số theo ngày chốt)
- Khách gửi tới phòng nào thì chỉ có dự án ở trang phòng đó (2026-11-11, migration 0044): phiếu bàn giao gửi Phòng Thiết kế -> Quản lý thiết kế, Phòng Thi công -> Quản lý dự án; chưa có phiếu (hoặc gửi QS) thì cột Dự án (Thiết kế) / (Thi công) vào trang của cột, Tư vấn / Đàm phán chưa vào trang nào (tạo / cập nhật tên, khách, giá trị ước tính; rời trang hoặc xoá khách thì gỡ, dự án đã có dữ liệu chỉ ẩn / bỏ liên kết; cùng transaction) - 🟡 đã kiểm bằng test + dữ liệu local, chưa thử kéo thẻ trên giao diện
- Quản lý thiết kế / Quản lý dự án dùng chung component: danh sách dự án, thiết lập chung, nhân sự, thầu phụ, tiến độ Gantt (đề mục, công việc, mốc thu chi, kéo giãn, khung mẫu dời về hôm nay), bình luận; "hôm nay" là ngày thật
- 2026-11-04: giao diện 2 trang trả về đúng bản 8686a37 (component riêng của Quản lý dự án, chọn dự án "Chung cư Riverside / Giai đoạn 2", chip lọc giai đoạn, kanban mua hàng, KPI), chỉ thay dữ liệu mẫu bằng API; migration 0032 (trạng thái "Thiết kế", tiến độ nhập tay + màu thanh ở danh sách, sơ đồ tổ chức theo dự án, đơn mua hàng của công việc); `infra/scripts/seed-demo-delivery.mjs` nạp dữ liệu mẫu bản cũ vào công ty demo - 🟡 chưa thử trên trình duyệt
- 2026-11-10: Tiến độ - bấm công việc "Mua hàng & cung ứng" mở "Phiếu thông tin mua hàng" ở khung phải (timeline vẫn hiện); phiếu chi tiết đơn mua hàng theo bộ trường Lark (From Today, Status, Pc/Sm/Pm Order, Mua hàng đặt hàng, Order Due Kế Toán tính lùi từ Start At Site / Lead Time / Bù trừ; ngày thực tế, PM / Thu mua / Kế toán / CHT/GS / PC, tệp đính kèm, Thanh toán), 3 chế độ xem Default / Columns / Groups - 🟡 chưa thử trên dữ liệu thật
- 2026-11-10: Marketing ↔ Kinh doanh - "Nguồn khách hàng" có 2 chip (Marketing = kênh quảng cáo `mkAds.kenh` | Khác); "+ thêm kênh" ở bảng chi tiêu gợi ý từ Nguồn khách hàng; thẻ "Hiệu quả kênh: chi tiêu ↔ khách hàng tiềm năng" (chi tiêu, số lead, chi phí / lead, đã chốt, tỉ lệ chốt, giá trị cơ hội theo kỳ đang xem) - 🟡 chưa thử trên dữ liệu thật
- Quyền tab mới `kinhdoanh`, `thietke`, `thicong` (admin cấp cho nhân viên; tính năng công ty), kiểm ở máy chủ; đăng nhập dùng chung token với QS
- Test Go: quyền, kiểm dữ liệu vào, cách ly công ty trên PostgreSQL thật (`TestCachLyCongTyDB`, `TestDuAnTrienKhaiDB`); thử trên trình duyệt ở máy phát triển 2026-10-28
- Triển khai VPS dezon.tech 2026-10-28 (`deploy.sh --no-pull`, sao lưu `qspro-20261028-105708.dump` trước migration 0015-0016); kiểm từ Internet: `/healthz`, `/kinh-doanh`, `/quan-ly-thiet-ke`, `/du-an` trả 200, API mới trả 401 khi chưa đăng nhập, dữ liệu cũ giữ nguyên (3 công ty, 32 dự án)
- 🟡 phần còn lại ở 2.2

<a id="xong-n13"></a>
#### N13 - Ngành Gạch ốp lát (đề mục 3.2.4)

- `gach-spec.js` (chỉ bản Go): 4 hạng mục Gạch lát nền / ốp tường / ngoài trời / trang trí - Mosaic, chung 8 thông số theo file "gạch edit.xlsx": Kích thước*, Bề mặt, Xương gạch, Màu sắc / Vân, Độ dày, Độ hút nước, Chống trơn, Quy cách đóng hộp; hạng mục ghi chung "Gạch", "Ốp lát" vẫn nhận là ngành gạch (`specs.GachLaChung`)
- Bảng bóc tách: THÔNG TIN CHÍNH = Bề mặt · Xương gạch · Màu sắc / Vân · Dòng SP · Hạng mục · Bảo hành (cột M); THÔNG SỐ THIẾT KẾ = Kích thước · Độ dày · Độ hút nước · Chống trơn · Quy cách đóng hộp (cột O)
- Bảng `product_tile_specs` (4 cột riêng) + view `product_catalog` 183 cột (migration 0043, số 0032 trên nhánh feat/hr); Kích thước / Bề mặt / Độ dày / Màu sắc dùng chung cột có sẵn; file mẫu `GET /api/v1/product-templates/gach`
- Giao diện: ngành "Gạch ốp lát · sản phẩm" ở Nhập dữ liệu (form, biến thể theo kích thước / màu, nút tải file mẫu), bộ lọc Bóc tách 3.2.4, bộ cột Danh sách SP, panel thông tin SP, modal Mua hàng
- Thử trên máy phát triển 2026-11-10 (database thử): nhập 1 SP gạch qua form, giá đại lý tự tính, lưu đúng bảng tách; file mẫu tải về đúng cột
- 🟡 phần còn lại ở 2.2

<a id="xong-n9"></a>
#### N9 - HR chạy dữ liệu thật (lát 1: hồ sơ + sơ đồ tổ chức; lát 2: chấm công & phép; lát 3: lương & bảo hiểm; lát 4: tuyển dụng, hiệu suất & đào tạo; lát 5: phân quyền thật + bổ sung)

- Migration 0024 (`hr_org_units`, `hr_employees`, `hr_unit_members`); khoá ngoại ghép `(…, company_id)` giữ phòng ban, quản lý, trưởng đơn vị trong cùng công ty; module Go `hr` (REST chỉ bản Go `/api/v1/hr`)
- Hồ sơ nhân sự: thêm, sửa, cho nghỉ việc (cấp dưới tự chuyển cho quản lý cấp trên), xoá; chi tiết hồ sơ (học vấn, hợp đồng, BHXH, thuế, giấy tờ...) lưu nguyên khối
- Sơ đồ tổ chức: thêm / sửa / xoá / kéo đơn vị, trưởng đơn vị, kiêm nhiệm (tổng tối đa 90%), công ty con kèm ban kiểm soát / ban chiến lược - mỗi lần thiết lập là 1 transaction; nút "Khởi tạo cơ cấu mẫu" cho công ty chưa có đơn vị
- Nhận việc từ Tuyển dụng tạo hồ sơ thật trên máy chủ
- Chấm công & phép (migration 0025: `hr_shifts`, `hr_work_patterns`, `hr_attendance_logs`, `hr_requests`): ca làm việc, lịch tuần lặp lại, nút "Khởi tạo ca & lịch mẫu"; bảng công hôm nay (ngày thật) với import CSV và HR bổ sung giờ; đơn nghỉ / đi muộn / OT tạo ngay trong HR, duyệt theo quản lý trực tiếp -> Nhân sự; Tổng hợp công & phép (và số công dùng ở Lương) tính từ lịch, chấm công, đơn đã duyệt thay công thức mẫu
- Lương & bảo hiểm (migration 0026: `hr_payroll_settings`, `hr_pay_adjustments`, `hr_payroll_runs`, `hr_unit_budgets`): cấu hình công thức (lưu sau khi ngừng gõ), thưởng / phạt / doanh số, chốt công (khoá ghi chấm công tháng đó), duyệt bảng lương lưu bản chụp phiếu lương, đánh dấu chi trả, mở lại; định phí theo đơn vị
- Tuyển dụng + hiệu suất & đào tạo (migration 0027: `hr_job_descriptions`, `hr_job_openings`, `hr_candidates`, `hr_objectives`, `hr_performance_reviews`, `hr_course_enrollments`): thư viện JD (tin dùng JD đổi tên theo, JD đang dùng không xoá được), tin tuyển dụng, ứng viên kéo-thả giai đoạn, đánh giá và lịch phỏng vấn, nhận việc gắn hồ sơ nhân sự; mục tiêu OKR theo kỳ (quý hiện tại / quý sau / năm, theo ngày thật), cập nhật tiến độ KR, đợt đánh giá tự đánh giá -> quản lý, ghi danh và tiến độ khoá học
- Phân quyền thật (migration 0028-0029): gắn tài khoản đăng nhập với hồ sơ + vai trò HR (System Admin / HR Admin / Trưởng phòng / Nhân viên), ma trận quyền theo công ty, máy chủ kiểm quyền mọi lệnh và lọc dữ liệu theo phạm vi (ẩn lương khi không có quyền), nhật ký HR vào `audit_logs`; chấm công GPS "của bạn" chạy khi đã gắn hồ sơ. Rà soát 2026-11-03 (4 reviewer độc lập) và sửa: lương chia theo ngày làm, người nghỉ việc còn ở tháng cuối, chặn NaN, đếm công / phép thống nhất, nhận việc nguyên khối, không lộ / không ghi đè số tiền khi không có quyền xem lương, tuyển dụng theo phòng, GPS theo giờ máy chủ, khoá tháng đã chốt, duyệt đúng người từng bước, nghỉ việc gỡ chức / kiêm nhiệm, nút theo đúng phạm vi, kỳ đánh giá các quý trước, tên công ty thật trên sơ đồ, dự báo chi phí theo tháng thật, giấy tờ nhận việc tải lên kho file, địa điểm làm việc + toạ độ GPS theo công ty (migration 0030) Bổ sung: CV ứng viên tải lên kho file, danh mục khoá học / lộ trình lưu máy chủ (sửa được, có danh mục mẫu), lịch làm việc riêng từng ngày (chế độ "Tuần cụ thể")
- Quyền tab mới `hr` (admin cấp cho nhân viên; tính năng công ty), kiểm ở máy chủ; đăng nhập dùng chung token với QS
- Test Go trên PostgreSQL thật: quyền, cơ cấu + hồ sơ, cách ly công ty (`TestCachLyCongTyDB`); thử trên trình duyệt ở máy phát triển 2026-10-30 (database thử): khởi tạo cơ cấu mẫu, tạo hồ sơ, thêm đơn vị kèm trưởng đơn vị, tải lại trang; 2026-10-31: khởi tạo ca & lịch mẫu, tạo + duyệt đơn nghỉ, Tổng hợp công ra đúng số; 2026-11-03: thêm thưởng, duyệt bảng lương tháng 10 (bản chụp + tự chốt công), sửa cấu hình lương; thêm JD, đăng tin, thêm ứng viên, mở đợt đánh giá Q4/2026; gắn tài khoản với hồ sơ, khởi tạo danh mục khoá học mẫu
- 🟡 phần còn lại ở 2.2

<a id="xong-n7"></a>
#### N7 - Ngành Điện lạnh (đề mục 3.2.7)

- Chuyển từ QS Pro (commit ea787b6) sang bản Go + React: `dl-spec.js` (9 hạng mục: Điều hoà không khí 4 khối thông số; vật tư / phụ kiện / thông gió: Quy cách · Xuất xứ), golden `gen-specs.js` gồm cả `laChung` / `doanHM` / `dong`
- Tự nhận ngành theo hạng mục (cả hạng mục ghi chung "Điện lạnh", "Máy lạnh"...) và đoán hạng mục con theo tên SP khi lưu / nhập file (`specs.DLDoanHM`)
- Bảng `product_hvac_specs` + view `product_catalog` 179 cột (migration 0017); file mẫu `GET /api/v1/product-templates/dien-lanh`
- Giao diện: ngành "Điện lạnh · sản phẩm" ở Nhập dữ liệu (form 4 khối, nút tải file mẫu), bộ lọc Bóc tách 3.2.7, bộ cột Danh sách SP, panel thông tin SP, modal Mua hàng
- Thử trên máy phát triển 2026-10-28: lưu SP qua API (hạng mục "Điện lạnh" + tên "Ống đồng dẫn gas" tự thành hạng mục Ống đồng dẫn gas), đề mục 3.2.7 hiện SP, panel chi tiết, form nhập
- 🟡 phần còn lại ở 2.2

<a id="xong-n8"></a>
#### N8 - Chat realtime MVP (theo `backend/CHAT.md` giai đoạn MVP)

- Migration 0018: 9 bảng `chat_*` (tài khoản chat riêng theo số điện thoại, không theo công ty); module Go `chat` (REST `/api/v1/chat/...`, quyền `rpc.SelfAuth`), gateway WebSocket `chat/realtime` (1 gateway trong bộ nhớ), Web Push VAPID `platform/webpush` + `go run ./cmd/vapid`
- Đăng ký / đăng nhập số điện thoại + OTP (giới hạn gửi theo số và IP, sai 5 lần khoá 15 phút; chưa có SMS thật - mã ghi vào log), access token 15 phút + refresh token xoay vòng, phát hiện dùng lại
- Danh bạ: tìm theo số, đồng bộ danh bạ (số hoặc hash SHA-256), lời mời kết bạn, chặn; chat 1-1 và nhóm (vai trò, thêm / xoá / rời, đổi tên, tin hệ thống), tắt thông báo
- Đã gửi / đã nhận / đã xem (con trỏ seq, tuỳ chọn ẩn "đã xem"), online / truy cập lần cuối, đang soạn tin, đồng bộ sau khi mất mạng + outbox, push khi người nhận offline
- Trang Chat React nối máy chủ thật (giữ Dezbot, SiteFlow Bot), huy hiệu sidebar = tổng chưa đọc thật
- Thử trên máy phát triển 2026-10-30 (database `qspro_chattest`): test Go gói chat / realtime / webpush / server đạt cả `-race`; E2E `backend/tests/chat-e2e/chat-e2e.js` 299/299 với server Go thật; 3 người dùng trên trình duyệt (Playwright) qua các luồng chính; review 4 mảng, 32 lỗi đã xác nhận đều đã sửa
- Nhiều tài khoản trong một trình duyệt (mỗi tab một tài khoản): kho `chat_accounts` + tài khoản của tab (sessionStorage), bộ chọn tài khoản (thêm / đổi / đăng xuất từng tài khoản), làm mới token theo từng tài khoản, tự chuyển phiên kiểu cũ vào kho, push dùng chung một subscription (gói có `user_id`, bấm thông báo thì tab đổi đúng tài khoản); thử trên máy phát triển 2026-10-30 (3 tab cùng cửa sổ, Playwright + push thật qua FCM)
- Đăng nhập / thêm tài khoản bằng email + OTP qua email, tìm và kết bạn bằng email ([N8.4](#n8-4)): migration 0019 (`chat_users.email`, `chat_otp_codes.email`, `phone` thành nullable), gửi thư SMTP `platform/mailer` (`SMTP_*`, chưa đặt thì mã ghi vào log), cùng giới hạn OTP với số; email chỉ hiện với chính mình, bạn bè và người tra đúng email; thử trên máy phát triển 2026-11-02 (database `qspro_chattest`): test Go đạt, smoke API email 20/20, `chat-e2e.js` 286/286, chuẩn hoá email Go / JS khớp 1094/1094 ca - 🟡 phần còn lại ở 2.2
- Gửi ảnh / video / tệp / tin nhắn thoại ([N8.3](#n8-3), `backend/CHAT.md` mục 12, D-17): migration 0020 (bảng `chat_media`, cột `chat_messages.media_id` / `file_name`), gói `platform/objstore` (MinIO, presigned PUT vào khoá tạm `chat/in/` rồi server chép sang `chat/m/`, presigned GET 60 phút), `POST /chat/media/upload-url` + `/chat/media/:id/complete` (kiểm kích thước / loại / sha256, ảnh thu nhỏ 320 px), chống trùng theo từng người tải, giới hạn mặc định 100 MB (trần 200 MB), dọn tệp treo / không dùng; giao diện chọn tệp, xem ảnh lớn, phát video / tin thoại, ghi âm; đã code ở máy phát triển 2026-11-02 (database `qspro_chattest`, MinIO local `qspro-minio`); kiểm thử: test Go của chat / objstore / server / config đạt (MinIO thật), `chat-e2e.js` 332 đạt / 0 lỗi (bước s16 đạt 33/33), `npm run build` đạt; CHƯA thử giao diện trên trình duyệt và CHƯA triển khai VPS (`S3_DOMAIN`, HTTPS) - 🟡 phần còn lại ở 2.4
- Chat nhóm: "Đã xem bởi N người" + hộp danh sách đã xem / đã nhận (chỉ frontend, cập nhật trực tiếp theo `receipt.update`, ẩn người tắt chia sẻ đã xem); ghim tin nhắn ([N8.5](#n8-5)): migration 0021 (`chat_pinned_messages`), `GET/POST /chat/conversations/:id/pins`, `DELETE .../pins/:message_id`, sự kiện WS `pins.updated`, trưởng / phó nhóm ghim (chat 1-1: cả hai), tối đa 5, tin hệ thống "đã ghim một tin nhắn", thanh tin ghim đầu hội thoại; đã code 2026-11-02, test Go chat đạt (`TestPinsDB`), `chat-e2e.js` 332 đạt / 0 lỗi, `npm run build` đạt; CHƯA thử trên trình duyệt - 🟡 phần còn lại ở 2.2
- Chat nhóm quản trị ([N8.5](#n8-5)): migration 0022 (`chat_conversations.description` / `avatar_media_id` / 3 cờ quyền / `disbanded_at`, `chat_messages.mentions`, `chat_conversation_members.last_mention_seq`, bảng `chat_group_invite_links` (chỉ lưu sha256 token) và `chat_group_join_requests`); @nhắc tên (gợi ý khi gõ @, `@Tất cả` chỉ trưởng / phó nhóm, push cả khi tắt thông báo, dấu @ ở danh sách hội thoại); ảnh đại diện + mô tả nhóm (ảnh qua MinIO); link mời `/chat/join/<token>` (hạn dùng, chế độ cần duyệt, hàng chờ duyệt); chuyển trưởng nhóm, giải tán (lịch sử giữ lại chỉ đọc, mọi thao tác ghi trả 410 `GROUP_DISBANDED`), cờ chỉ quản trị được nhắn / sửa thông tin / thêm người; danh sách ghim tải lại sau khi kết nối lại; đã code 2026-11-03, test Go chat / server / platform đạt (213 test), `chat-e2e.js` 526 đạt / 0 lỗi (s17-s20 mới), `npm run build` đạt; CHƯA thử trên trình duyệt - 🟡 phần còn lại ở 2.2
- Chat giai đoạn 2 ([N8.3](#n8-3), `backend/docs/API.md` mục "Giai đoạn 2"): migration 0023 (`chat_messages.reply_to_message_id` / `is_forwarded` / `edited_at` / `recalled_at` / `recalled_by` / `updated_at`, bảng `chat_message_reactions` và `chat_qr_login_sessions`, hàm bỏ dấu `chat_search_fold` + index GIN tìm tin, `chat_devices.user_agent` / `last_ip` / `login_method`); trả lời (khung trích dẫn, nhảy tới tin gốc), chuyển tiếp tới 1-20 hội thoại (dùng lại tệp), thu hồi (24 giờ; trưởng / phó nhóm thu hồi tin người khác, xoá hẳn nội dung), sửa tin văn bản (24 giờ), reaction 6 loại, tìm tin không dấu trong một / mọi hội thoại + nhảy tới tin (`around_seq`), đồng bộ thay đổi giữa thiết bị (`message.updated`, `reactions.updated`, `GET .../messages/changes`), danh sách thiết bị + đăng xuất từ xa (`devices.updated`), đăng nhập web bằng QR (poll, mã 2 phút dùng một lần); 17 route REST mới; đã code 2026-11-03, test Go chat / realtime / server / platform đạt, `chat-e2e.js` 679 đạt / 0 lỗi (s21-s23 mới), `npm run build` đạt; CHƯA thử trên trình duyệt - 🟡 phần còn lại ở 2.4
- 🟡 phần còn lại ở 2.2

