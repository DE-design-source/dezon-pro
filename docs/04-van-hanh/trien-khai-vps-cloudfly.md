# Triển khai QS Pro lên VPS CloudFly

> Cập nhật: 2026-10-22. Áp dụng cho bản **backend Go + frontend React + PostgreSQL** (cấu hình ở `infra/deploy/`).
> Đã chạy thử trọn bộ trên máy phát triển: dựng database trống, migration, đăng nhập qua trình duyệt, sao lưu, khôi phục, cập nhật lại.
> Phần kho file trên máy chủ (volume `uploads`, `/files`, sao lưu / khôi phục kho file) thêm ngày 2026-10-22, chưa chạy thử trên VPS.

Tài liệu này viết cho người **chưa từng triển khai máy chủ**: làm lần lượt từ Bước 1 đến Bước 9, chép nguyên lệnh, chỉ thay phần trong `<...>`.

---

## 0. Hệ thống sau khi triển khai

```
                Internet (người dùng mở https://<tên miền>)
                                 │  cổng 80 / 443
┌────────────────────────────────▼──────────────────────────── VPS CloudFly (Ubuntu) ─┐
│  web  (Caddy)   - tự xin & gia hạn chứng chỉ HTTPS (Let's Encrypt)                    │
│                 - phục vụ giao diện React (đã build sẵn trong image)                 │
│                 - chuyển /api, /export, /upload, /files, /media, file mẫu... sang api│
│        │                                                                             │
│  api  (Go)      - backend QS Pro, cổng 3000, KHÔNG mở ra Internet                    │
│                 - kho ảnh / tài liệu: volume uploads (/app/uploads), qua /files      │
│        │                                                                             │
│  db   (PostgreSQL 17) - dữ liệu, chỉ mở cho chính máy chủ (127.0.0.1:5432)            │
│  migrate        - chạy migration mỗi lần deploy rồi tự tắt                            │
│                                                                                      │
│  /opt/qspro          mã nguồn (git clone)                                            │
│  /opt/qspro-backups  bản sao lưu database + kho file (tự động 02:30, giữ 14 ngày)     │
└──────────────────────────────────────────────────────────────────────────────────────┘
   Bên ngoài chỉ còn: Lark (webhook, ảnh cũ).
```

Tất cả chạy bằng **Docker Compose**: một lệnh `bash infra/deploy/deploy.sh` là build và khởi động toàn bộ.

| File | Việc |
|---|---|
| `infra/deploy/docker-compose.yml` | Khai báo 4 dịch vụ ở trên |
| `infra/deploy/Caddyfile` | HTTPS + chia đường dẫn giữa giao diện và backend |
| `infra/deploy/.env.example` | Mẫu cấu hình (tên miền, mật khẩu, khoá...) |
| `infra/deploy/setup-server.sh` | Chuẩn bị máy chủ mới (chạy 1 lần) |
| `infra/deploy/deploy.sh` | Triển khai / cập nhật (chạy mỗi lần có code mới) |
| `infra/scripts/backup-db.sh` | Sao lưu database + kho ảnh / tài liệu (volume `uploads`) |
| `infra/scripts/restore-db.sh` | Nạp dữ liệu / khôi phục bản sao lưu (database và/hoặc kho file) |
| `infra/scripts/create-super.sh` | Tạo tài khoản quản trị cao nhất (super) |
| `infra/docker/frontend.Dockerfile` | Build giao diện React vào image Caddy |
| `infra/docker/backend.Dockerfile` | Build backend Go (có sẵn từ trước) |

---

## 1. Chuẩn bị

| Cần có | Lấy ở đâu |
|---|---|
| IP máy chủ + mật khẩu `root` | Email / trang quản lý VPS của CloudFly |
| Tên miền (vd `qs.dezon.vn` hoặc `dezon-qs.vn`) | Trang quản lý tên miền CloudFly |
| Quyền vào repo GitHub `DE-design-source/dezon-pro` | Tài khoản GitHub có quyền admin repo (để thêm deploy key) |
| `LARK_APP_ID`, `LARK_APP_SECRET` (hiện ảnh cũ trên Lark) | Trang Environment của service `qs-pro` trên Render, hoặc Lark Developer Console |
| (Tuỳ chọn) `AUTH_SECRET` của server cũ | Render. Chỉ cần nếu muốn người dùng không phải đăng nhập lại - thường không cần |

**Cấu hình VPS khuyến nghị:** Ubuntu 22.04 hoặc 24.04, tối thiểu 2 vCPU / 2 GB RAM / 30 GB SSD.
VPS 1 GB RAM vẫn chạy được (script tự thêm 2 GB swap) nhưng lần build đầu sẽ chậm.

**Code phải có trên GitHub.** Máy chủ lấy code bằng `git clone` / `git pull`, nên mọi thay đổi phải được **push** trước.
Trên máy tính của bạn (PowerShell, trong thư mục repo):

```powershell
git status                     # phải sạch, không còn file chưa commit
git push origin <nhánh>        # vd: git push origin main  (nhánh đang làm hiện tại: src_N)
```

Trong tài liệu này `<nhánh>` là nhánh bạn muốn chạy trên production. Nên gộp vào `main` rồi deploy `main`.

---

## Bước 1. Trỏ tên miền về máy chủ

Vào trang quản lý DNS của tên miền trên CloudFly, thêm bản ghi:

| Loại | Tên (Host) | Giá trị | TTL |
|---|---|---|---|
| A | `@` (tên miền chính) **hoặc** tên subdomain, vd `qs` | `<IP máy chủ>` | 300 |

Kiểm tra từ máy tính (đợi 5-30 phút sau khi thêm):

```powershell
nslookup <tên miền>
```

Kết quả phải ra đúng IP máy chủ. **Chưa ra đúng IP thì chưa làm Bước 7** (Caddy sẽ không xin được chứng chỉ HTTPS).

> Nếu trang quản lý VPS của CloudFly có **Firewall / Security group**: mở cổng 22, 80, 443 (TCP) và 443 (UDP).

---

## Bước 2. Đăng nhập vào máy chủ (SSH)

Trên Windows mở **PowerShell**:

```powershell
ssh root@<IP máy chủ>
```

- Lần đầu hỏi `Are you sure you want to continue connecting` → gõ `yes`.
- Nhập mật khẩu root (gõ không hiện ký tự, gõ xong Enter).
- Thấy dấu nhắc kiểu `root@xxx:~#` là đã vào được. **Từ đây mọi lệnh gõ trên máy chủ.**

Đổi mật khẩu root mặc định ngay:

```bash
passwd
```

---

## Bước 3. Cho máy chủ quyền đọc repo GitHub (deploy key)

Repo là private nên máy chủ cần một khoá riêng, chỉ đọc:

```bash
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -C "qspro-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Chép toàn bộ dòng in ra (bắt đầu bằng `ssh-ed25519 ...`), rồi trên GitHub:
repo **dezon-pro → Settings → Deploy keys → Add deploy key** → Title `qspro-server` → dán vào Key → **KHÔNG** tick "Allow write access" → Add key.

Kiểm tra:

```bash
ssh -T git@github.com        # gõ yes nếu được hỏi; thấy "successfully authenticated" là được
```

---

## Bước 4. Tải mã nguồn về máy chủ

```bash
git clone -b <nhánh> git@github.com:DE-design-source/dezon-pro.git /opt/qspro
cd /opt/qspro
```

**Không dùng GitHub (cách đang dùng trên VPS `222.255.184.134` từ 2026-10-24):** đóng gói mã trên máy tính rồi chép lên, bỏ qua Bước 3.
Trên máy tính (Git Bash, gốc repo):

```bash
git ls-files -co --exclude-standard | while IFS= read -r f; do [ -f "$f" ] && echo "$f"; done | grep -v '^\.playwright-mcp/' > /tmp/filelist.txt
tar -czf /tmp/qspro-src.tar.gz -T /tmp/filelist.txt     # không gồm .env, node_modules, infra/export (đã gitignore)
scp /tmp/qspro-src.tar.gz root@<IP máy chủ>:/root/
```

Trên máy chủ: `mkdir -p /opt/qspro && tar -xzf /root/qspro-src.tar.gz -C /opt/qspro`, rồi tạo commit cục bộ để mã phiên bản (header `x-app-ver`)
đổi sau mỗi lần cập nhật: `cd /opt/qspro && git init -q; git add -A && git -c user.name=qspro-deploy -c user.email=deploy@localhost commit -qm "deploy"`.
Cách này luôn chạy `deploy.sh --no-pull` (máy chủ không có remote để `git pull`). Cập nhật lần sau: chép gói mới, bung đè vào `/opt/qspro`
(không xoá `infra/deploy/.env`), commit lại, `bash infra/deploy/deploy.sh --no-pull`.

---

## Bước 5. Chuẩn bị máy chủ (chạy 1 lần)

```bash
bash /opt/qspro/infra/deploy/setup-server.sh
```

Script tự làm (mất 3-10 phút):

- cập nhật Ubuntu, đặt múi giờ Việt Nam, thêm 2 GB swap;
- cài Docker + Docker Compose;
- bật tường lửa, chỉ mở SSH / 80 / 443; bật fail2ban chặn dò mật khẩu SSH; tự cài bản vá bảo mật;
- tạo file cấu hình `infra/deploy/.env` với **mật khẩu database và `AUTH_SECRET` ngẫu nhiên**;
- đặt lịch sao lưu database lúc 02:30 mỗi ngày.

Chạy lại script nhiều lần không sao (bước nào xong rồi thì bỏ qua, không ghi đè `.env`).

---

## Bước 6. Điền cấu hình

```bash
nano /opt/qspro/infra/deploy/.env
```

(Di chuyển bằng phím mũi tên; lưu: `Ctrl+O` rồi `Enter`; thoát: `Ctrl+X`.)

| Biến | Điền | Ghi chú |
|---|---|---|
| `DOMAIN` | `qs.dezon.vn` | **Bắt buộc.** Không có `https://`, không có `/` cuối |
| `WWW_DOMAIN` | `www.dezon.tech` hoặc để trống | Tuỳ chọn. Địa chỉ phụ, mọi request chuyển hẳn (301) về `DOMAIN`. Cần bản ghi A riêng trỏ về máy chủ |
| `ACME_EMAIL` | email của bạn | **Bắt buộc.** Let's Encrypt gửi cảnh báo chứng chỉ vào đây |
| `POSTGRES_PASSWORD` | (đã sinh sẵn) | Giữ nguyên. Cần khi nối pgAdmin |
| `AUTH_SECRET` | (đã sinh sẵn) | Giữ nguyên. Đổi = mọi người bị đăng xuất |
| `PURCHASE_WEBHOOK`, `REPORT_WEBHOOK` | để trống | Trống = gửi vào group Lark đang dùng (webhook ghi sẵn trong code) |
| `REPORT_JOB` | để trống, hoặc `0` | Trống = BẬT báo cáo Lark 8h thứ 4 / thứ 7. **Đặt `0` nếu server cũ trên Render còn chạy**, để group không nhận 2 báo cáo |
| `LARK_APP_ID`, `LARK_APP_SECRET` | lấy từ Render | Thiếu thì ảnh cũ lưu trên Lark không hiện |

Kho ảnh / tài liệu không cần cấu hình: file nằm trong volume Docker `uploads` trên chính máy chủ (backend đọc qua `UPLOAD_DIR=/app/uploads`,
đặt sẵn trong `docker-compose.yml`), người dùng tải về qua `https://<tên miền>/files/...`.

**Chưa có tên miền - chạy tạm bằng IP (HTTP, chưa mã hoá):** điền

```
DOMAIN=http://<IP máy chủ>
PUBLIC_URL=http://<IP máy chủ>
ACME_EMAIL=<email bất kỳ, chưa dùng tới>
```

Trang chạy ở `http://<IP máy chủ>/qs`. Mật khẩu đăng nhập đi qua mạng không mã hoá, nên chỉ dùng tạm. Có tên miền thì làm Bước 1, đổi `DOMAIN`
thành tên miền, xoá dòng `PUBLIC_URL`, điền `ACME_EMAIL` thật, rồi `bash deploy.sh --no-pull`. Ở trang **Cloud Firewall** của CloudFly phải có rule vào
(inbound) cho HTTP 80 (và HTTPS 443 khi có tên miền), nếu không trình duyệt không vào được dù mọi thứ trong máy chủ đã chạy.

---

## Bước 7. Triển khai

```bash
bash /opt/qspro/infra/deploy/deploy.sh
```

Lần đầu mất 5-15 phút (build backend Go và giao diện React). Script làm lần lượt:
git pull → build image → sao lưu database (nếu đã có) → migration → khởi động backend → kiểm tra backend và web.
Lỗi ở build, sao lưu hoặc migration thì script dừng và **bản đang chạy giữ nguyên**, người dùng không bị gián đoạn.

Thành công khi cuối màn hình có:

```
XONG. Mở: https://<tên miền>   (trang QS: https://<tên miền>/qs)
```

Lần đầu khởi động database **trống**: bảng được tạo tự động (từ `infra/db/schema.sql`), chưa có tài khoản nào. Làm Bước 8.

---

## Bước 8. Đưa dữ liệu vào

Chọn **một** trong hai cách.

### Cách A - Bắt đầu với database trống

Tạo tài khoản quản trị cao nhất (super):

```bash
bash /opt/qspro/infra/scripts/create-super.sh admin "Quản trị hệ thống"
```

Nhập mật khẩu 2 lần (không hiện trên màn hình, tối thiểu 8 ký tự). Sau đó đăng nhập `https://<tên miền>/qs`
bằng `admin`, vào **Công ty** để tạo công ty và tài khoản cho người dùng.

### Cách B - Chuyển dữ liệu từ PostgreSQL trên máy tính của bạn

Dữ liệu đang xem bằng pgAdmin trên máy tính (container Docker `qspro-postgres`, database `qspro_en2` - xem `DATABASE_URL`
trong `backend/.env`) được chuyển lên như sau.

**1) Xuất dữ liệu trên máy tính** - chọn một trong hai:

- *Bằng pgAdmin:* chuột phải vào database (vd `qspro_en2`) → **Backup...** → Format: **Custom** → Filename: `qspro.dump` → Backup.
  (pgAdmin phải dùng `pg_dump` bản 17 trở lên; báo lỗi "server version mismatch" thì dùng cách dưới.)
- *Bằng lệnh (PowerShell):* thay `<user>` bằng tên user trong `DATABASE_URL` của `backend/.env`:

  ```powershell
  docker exec qspro-postgres pg_dump -U <user> -d qspro_en2 -Fc -f /tmp/qspro.dump
  docker cp qspro-postgres:/tmp/qspro.dump .\qspro.dump
  ```

  Không dùng `pg_dump ... > file` trong PowerShell: PowerShell làm hỏng file nhị phân khi chuyển hướng `>`.

**2) Chép file lên máy chủ** (PowerShell, trên máy tính):

```powershell
scp .\qspro.dump root@<IP máy chủ>:/root/qspro.dump
```

Dữ liệu có kèm bản nén kho file (`qspro-files-*.tar.gz`) thì chép luôn: `scp .\qspro-files-<...>.tar.gz root@<IP máy chủ>:/root/`.

**3) Nạp trên máy chủ:**

```bash
bash /opt/qspro/infra/scripts/restore-db.sh /root/qspro.dump
```

Có bản nén kho file (`qspro-files-*.tar.gz`: mỗi file nằm đúng đường dẫn sau `/files/`, vd URL `/files/abc/anh.png` ứng với
`abc/anh.png` trong bản nén) thì đưa nó làm tham số thứ hai. Script sao lưu kho file hiện có, xoá sạch rồi bung lại kho ảnh /
tài liệu (volume `uploads`) từ bản nén:

```bash
bash /opt/qspro/infra/scripts/restore-db.sh /root/qspro.dump /root/qspro-files-<...>.tar.gz
```

Gõ `YES` khi được hỏi. Script: kiểm tra file → sao lưu database hiện có → dừng backend → xoá và tạo lại database → nạp file →
chạy migration còn thiếu (vd `0014_user_sessions`) → bật lại backend. Nạp lỗi thì script in sẵn lệnh để quay lại dữ liệu cũ. Nạp xong, xoá file (có dữ liệu khách hàng):

```bash
rm -f /root/qspro.dump /root/qspro-files-*.tar.gz
```

Đăng nhập bằng tài khoản có sẵn trong dữ liệu. Quên mật khẩu super → chạy `create-super.sh <tên super>` để đặt lại.

> **Dữ liệu mới nhất ở đâu?** `qspro_en2` là bản chụp ngày 2026-10-12 / 15 (xem `docs/02-ky-thuat/database/ket-qua-trien-khai.md`).
> Dữ liệu người dùng nhập trên app cũ (Render) sau thời điểm đó KHÔNG có trong `qspro_en2`: cần lấy bản dữ liệu mới hơn trước khi chuyển.
> Lúc chuyển hẳn: khoá ghi app cũ, chuyển dữ liệu, rồi tắt Render.

---

## Bước 9. Kiểm tra sau khi triển khai

| Kiểm tra | Cách | Đúng khi |
|---|---|---|
| HTTPS | Mở `https://<tên miền>` | Có ổ khoá, không cảnh báo |
| Giao diện QS | Mở `https://<tên miền>/qs`, bấm F5 | Không báo 404, không báo "Chưa cấu hình VITE_API_URL" |
| Đăng nhập | Đăng nhập tài khoản super / tài khoản thật | Vào được, thấy danh sách dự án |
| Backend | `curl https://<tên miền>/healthz` trên máy chủ | `{"ok":true}` |
| Ảnh sản phẩm | Mở một sản phẩm có ảnh | Ảnh hiện (đường dẫn `/files/...`, ảnh rất cũ qua `/media` từ Lark) |
| Tải ảnh / tài liệu | Sửa một sản phẩm, tải ảnh mới lên rồi mở lại | Ảnh mới hiện; `docker compose exec api ls /app/uploads/sp` có file vừa tải |
| Xuất Excel | Xuất báo giá một dự án | Tải được file `.xlsx` |
| Trạng thái | `cd /opt/qspro/infra/deploy && docker compose ps` | `api` và `db` là `healthy`, `web` là `Up` |
| Sao lưu | `bash /opt/qspro/infra/scripts/backup-db.sh` | In `Đã sao lưu: /opt/qspro-backups/....dump` và `Đã sao lưu file: /opt/qspro-backups/qspro-files-....tar.gz` |

---

## Xem database bằng pgAdmin (từ máy tính)

Database KHÔNG mở ra Internet. pgAdmin nối qua **SSH tunnel** (đi nhờ kết nối SSH):

pgAdmin → **Register → Server...**

| Tab | Trường | Giá trị |
|---|---|---|
| General | Name | `QS Pro production` |
| Connection | Host name/address | `127.0.0.1` |
| | Port | `5432` |
| | Maintenance database | `qspro` |
| | Username | `qspro` |
| | Password | giá trị `POSTGRES_PASSWORD` trong `/opt/qspro/infra/deploy/.env` (xem: `grep POSTGRES_PASSWORD /opt/qspro/infra/deploy/.env`) |
| SSH Tunnel | Use SSH tunneling | Bật |
| | Tunnel host | `<IP máy chủ>` |
| | Tunnel port | `22` |
| | Username | `root` |
| | Authentication | Password (mật khẩu root) hoặc Identity file |

> Đây là database **production**: sửa / xoá trực tiếp ở pgAdmin là sửa dữ liệu thật của khách hàng. Sao lưu trước khi sửa tay.

---

## Vận hành hằng ngày

Mọi lệnh dưới đây chạy trên máy chủ, trong thư mục `/opt/qspro/infra/deploy`:

```bash
cd /opt/qspro/infra/deploy
```

| Việc | Lệnh |
|---|---|
| **Đưa code mới lên** (sau khi đã `git push` từ máy tính) | `bash deploy.sh` |
| Xem trạng thái | `docker compose ps` |
| Xem log backend (Ctrl+C để thoát) | `docker compose logs -f api` |
| Xem log HTTPS / web | `docker compose logs -f web` |
| Xem log migration lần gần nhất | `docker compose logs migrate` |
| Khởi động lại backend | `docker compose restart api` |
| Sửa `.env` xong, áp dụng | `bash deploy.sh --no-pull` |
| Sửa `Caddyfile` xong, áp dụng | `docker compose restart web` |
| Tắt toàn bộ | `docker compose down` (database và kho file vẫn giữ) |
| Bật lại | `docker compose up -d` |
| Sao lưu ngay (database + kho file) | `bash ../scripts/backup-db.sh` |
| Danh sách bản sao lưu | `ls -lh /opt/qspro-backups` (`qspro-<thời điểm>.dump` = database, `qspro-files-<thời điểm>.tar.gz` = ảnh / tài liệu) |
| Khôi phục database + kho file | `bash ../scripts/restore-db.sh /opt/qspro-backups/qspro-<thời điểm>.dump /opt/qspro-backups/qspro-files-<thời điểm>.tar.gz` |
| Khôi phục chỉ database / chỉ kho file | `bash ../scripts/restore-db.sh <file>.dump` / `bash ../scripts/restore-db.sh <file>.tar.gz` |
| Dung lượng kho file | `docker compose exec api du -sh /app/uploads` |
| Log sao lưu tự động | `tail /var/log/qspro-backup.log` |
| Dung lượng đĩa | `df -h /` và `docker system df` |

**Chép bản sao lưu về máy tính** (nên làm hằng tuần - mất máy chủ là mất luôn bản sao lưu trên đó). PowerShell trên máy tính:

```powershell
scp root@<IP máy chủ>:/opt/qspro-backups/<tên file>.dump .
scp root@<IP máy chủ>:/opt/qspro-backups/qspro-files-<thời điểm>.tar.gz .
```

**Tuyệt đối không chạy** `docker compose down -v`: cờ `-v` xoá volume = **xoá toàn bộ database, toàn bộ ảnh / tài liệu đã tải lên**
(volume `uploads`) và chứng chỉ HTTPS.

---

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Trình duyệt báo lỗi chứng chỉ / không vào được HTTPS | DNS chưa trỏ đúng IP; cổng 80/443 bị chặn | `nslookup <tên miền>`; mở cổng ở firewall CloudFly; xem `docker compose logs web` (tìm `challenge failed`); sửa xong `docker compose restart web` |
| `502 Bad Gateway` | Backend không chạy | `docker compose ps`, `docker compose logs --tail 100 api` |
| `deploy.sh` dừng ở bước migration | Migration lỗi trên dữ liệu hiện có | `docker compose logs migrate`; database đã được sao lưu ngay trước đó trong `/opt/qspro-backups` |
| Trang QS báo "Chưa cấu hình VITE_API_URL" | Build giao diện khi `DOMAIN` trống | Điền `DOMAIN` rồi `bash deploy.sh --no-pull` |
| Đổi tên miền | Địa chỉ API được nhúng vào giao diện lúc build | Sửa `DOMAIN` trong `.env`, trỏ DNS, rồi `bash deploy.sh --no-pull` |
| Build bị `Killed` / hết bộ nhớ | VPS ít RAM | Kiểm tra swap `free -h`; chạy lại `setup-server.sh` |
| `git pull` báo `Permission denied (publickey)` | Thiếu deploy key | Làm lại Bước 3 |
| `git pull` báo không fast-forward được | Có người sửa file trực tiếp trên máy chủ | `git -C /opt/qspro status`; KHÔNG sửa code trên máy chủ, chỉ sửa `.env` |
| Upload file lớn báo lỗi | Giới hạn của backend: JSON 30 MB, tài liệu 50 MB | Giảm dung lượng file |
| Group Lark nhận 2 báo cáo | Server cũ (Render) vẫn chạy | Tắt service trên Render, hoặc đặt `REPORT_JOB=0` ở một bên |
| Ảnh cũ (Lark) không hiện | Thiếu `LARK_APP_ID` / `LARK_APP_SECRET` | Điền vào `.env`, `bash deploy.sh --no-pull` |
| Ảnh `/files/...` không hiện (trả trang React hoặc 404) | `Caddyfile` thiếu `/files/*`, hoặc file không có trong volume `uploads` (nạp dữ liệu mà không kèm bản nén kho file, volume bị xoá) | Kiểm tra dòng `@backend` trong `Caddyfile`; `docker compose exec api ls /app/uploads`; khôi phục kho file từ bản `qspro-files-*.tar.gz` |
| Tải ảnh lên báo lỗi ghi file | Đĩa đầy, hoặc `/app/uploads` không thuộc user `app` | `df -h /`; `docker compose exec api ls -ld /app/uploads` (chủ phải là `app`) |

---

## Lưu ý

- **Bảo mật:** file `.env` chứa mật khẩu database và khoá ký token, chỉ root đọc được. Không gửi file này qua chat / email, không commit.
- **Server cũ trên Render:** sau khi người dùng chuyển hẳn sang tên miền mới, tắt service `qs-pro` trên Render.
- **Trang `/qs-pro` của giao diện React** vẫn nhúng app cũ trên Render (`frontend/src/pages/QSPro/QSPro.jsx`, `QS_PRO_URL`). Tắt Render thì trang này trống;
  module QS dùng thật là trang `/qs`.
- **Các trang khác của giao diện SiteFlow** (Chat, Marketing, HR, Tài chính...) đang là dữ liệu mẫu trong `frontend/src/data`, chưa nối backend.
- **Ảnh / tài liệu** lưu trong volume Docker `uploads` trên máy chủ, phục vụ ở `/files/...`. Sao lưu tự động đã gồm kho file;
  vẫn nên chép bản `qspro-files-*.tar.gz` về máy tính định kỳ.
- **Thêm route gốc mới ở backend** (ngoài `/api`, `/export`, `/upload`, `/files`, `/media`) → thêm đường dẫn vào dòng `@backend` trong `infra/deploy/Caddyfile`, nếu không route đó trả về trang React.
- **Cập nhật hệ điều hành:** bản vá bảo mật tự cài. Thỉnh thoảng `apt-get upgrade` và khởi động lại máy chủ (`reboot`); các container tự bật lại.

---

## Chạy thử trên máy tính trước khi đưa lên (tuỳ chọn)

Cần Docker Desktop. Trong Git Bash, tại gốc repo:

```bash
cd infra/deploy
cp .env.example .env
# sửa .env: DOMAIN=http://localhost  ACME_EMAIL=test@example.com  POSTGRES_PASSWORD=test123  AUTH_SECRET=test
#           HTTP_PORT=8080  HTTPS_PORT=8443  PUBLIC_URL=http://localhost:8080  DB_LOCAL_PORT=55432
#           REPORT_JOB=0  PURCHASE_WEBHOOK=http://127.0.0.1:9/x  REPORT_WEBHOOK=http://127.0.0.1:9/x
#           BACKUP_DIR=./backups
export COMPOSE_PROJECT_NAME=qspro-localtest
bash deploy.sh --no-pull
printf 'matkhau123\nmatkhau123\n' | bash ../scripts/create-super.sh admin
# mở http://localhost:8080/qs ; dọn dẹp: docker compose down -v ; rm .env .env.version .env.caddy
```

Bộ biến `REPORT_JOB=0` và webhook giả là **bắt buộc** khi chạy thử: để trống thì tin nhắn đi vào group Lark thật.
File tải lên khi chạy thử nằm trong volume `qspro-localtest_uploads`, bị xoá cùng lệnh dọn dẹp `down -v`.
