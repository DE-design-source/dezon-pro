#!/usr/bin/env bash
# Tạo (hoặc đặt lại mật khẩu cho) tài khoản SUPER - quản trị toàn hệ thống, không thuộc công ty nào.
#   bash infra/scripts/create-super.sh <tên đăng nhập> ["Họ tên"]
# Dùng khi database mới trống (chưa có ai đăng nhập được) hoặc quên mật khẩu super.
# Mật khẩu được hỏi khi chạy (không hiện trên màn hình) và lưu dạng băm bcrypt.
# Đăng nhập xong vào giao diện để tạo công ty và tài khoản cho người dùng.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" && pwd)"
cd "$DEPLOY_DIR"

USERNAME="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
FULLNAME="${2:-Quản trị hệ thống}"
[ -n "$USERNAME" ] || { echo "Cách dùng: bash $0 <tên đăng nhập> [\"Họ tên\"]" >&2; exit 2; }

IFS= read -r -s -p "Mật khẩu cho $USERNAME (tối thiểu 8 ký tự): " PW1; echo
IFS= read -r -s -p "Nhập lại mật khẩu: " PW2; echo
[ "$PW1" = "$PW2" ] || { echo "Hai lần nhập không khớp." >&2; exit 1; }
[ "${#PW1}" -ge 8 ] || { echo "Mật khẩu quá ngắn." >&2; exit 1; }

# Băm bcrypt bằng caddy có sẵn trong container web (mật khẩu đi qua stdin, không lộ trên dòng lệnh)
HASH="$(printf '%s\n%s\n' "$PW1" "$PW1" | docker compose exec -T web caddy hash-password 2>/dev/null | tr -d '\r' | tail -n 1)"
case "$HASH" in
  '$2'[aby]'$'*) ;;
  *) echo "Không băm được mật khẩu (container web có đang chạy không? docker compose ps)" >&2; exit 1 ;;
esac

# Tên đã có: chỉ đặt lại mật khẩu nếu đó là tài khoản super (không biến tài khoản thường thành super)
ID="$(docker compose exec -T db sh -c 'psql -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v u="$1" -v n="$2" -v h="$3"' sh "$USERNAME" "$FULLNAME" "$HASH" <<'SQL'
insert into users (username, full_name, password_hash, role, is_active, company_id)
values (:'u', :'n', :'h', 'super', true, null)
on conflict ((lower(username))) do update
  set password_hash = excluded.password_hash, is_active = true
  where users.role = 'super'
returning id;
SQL
)"
ID="$(printf '%s' "$ID" | tr -d '\r[:space:]')"
[ -n "$ID" ] || { echo "Tên đăng nhập '$USERNAME' đã thuộc một tài khoản KHÔNG phải super - chọn tên khác." >&2; exit 1; }
echo "Đã tạo / đặt lại mật khẩu tài khoản super: $USERNAME"
