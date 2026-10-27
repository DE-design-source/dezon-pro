#!/usr/bin/env bash
# Triển khai / cập nhật QS Pro trên máy chủ. Chạy mỗi lần muốn đưa code mới lên:
#   bash infra/deploy/deploy.sh             # git pull + build + sao lưu database + migration + khởi động lại
#   bash infra/deploy/deploy.sh --no-pull   # dùng code đang có trên máy, không git pull
# Lỗi ở bước nào thì dừng ở đó; lỗi ở build / sao lưu / migration thì bản cũ vẫn chạy.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
cd "$DEPLOY_DIR"
step() { printf '\n==> %s\n' "$*"; }
env_get() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r' || true; }

PULL=1
for a in "$@"; do
  case "$a" in
    --no-pull) PULL=0 ;;
    *) echo "Tham số không hiểu: $a" >&2; exit 2 ;;
  esac
done

[ -f .env ] || { echo "Chưa có $DEPLOY_DIR/.env - chạy setup-server.sh hoặc: cp .env.example .env" >&2; exit 1; }
DOMAIN="$(env_get DOMAIN)"
[ -n "$DOMAIN" ] || { echo "Chưa điền DOMAIN trong .env" >&2; exit 1; }
[ -n "$(env_get ACME_EMAIL)" ] || { echo "Chưa điền ACME_EMAIL trong .env" >&2; exit 1; }
[ -n "$(env_get POSTGRES_PASSWORD)" ] || { echo "Chưa điền POSTGRES_PASSWORD trong .env" >&2; exit 1; }
[ -n "$(env_get AUTH_SECRET)" ] || { echo "Chưa điền AUTH_SECRET trong .env" >&2; exit 1; }

if [ "$PULL" = 1 ]; then
  step "Lấy code mới (git pull)"
  git -C "$REPO_DIR" pull --ff-only
fi
APP_VERSION="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "Phiên bản: $APP_VERSION ($(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
# Ghi ra file (không export) để mọi lệnh docker compose sau này - kể cả chạy tay - thấy cùng giá trị:
# api nhận mã commit (header x-app-ver); web được tạo lại khi Caddyfile đổi (file gắn đơn lẻ không tự cập nhật).
printf 'RENDER_GIT_COMMIT=%s\n' "$APP_VERSION" > .env.version
printf 'CADDYFILE_SHA=%s\n' "$(sha256sum Caddyfile | cut -c1-16)" > .env.caddy

step "Build image (backend Go + giao diện React) - lần đầu mất vài phút"
docker compose build --pull

if [ -n "$(docker compose ps --status running -q db 2>/dev/null)" ]; then
  step "Sao lưu database trước khi chạy migration"
  bash "$REPO_DIR/infra/scripts/backup-db.sh"
fi

step "Chạy migration bằng image mới (bản cũ vẫn phục vụ trong lúc này)"
if ! docker compose run --rm migrate; then
  echo "LỖI migration - DỪNG, bản đang chạy giữ nguyên. Database đã sao lưu ở bước trước (nếu có dữ liệu)." >&2
  exit 1
fi

step "Khởi động (database -> migration -> backend -> web)"
if ! docker compose up -d --remove-orphans; then
  echo "LỖI khi khởi động. Log gần nhất:" >&2
  docker compose logs --tail 60 migrate api >&2 || true
  exit 1
fi

step "Chờ backend sẵn sàng"
API_ID="$(docker compose ps -q api)"
for i in $(seq 1 30); do
  st="$(docker inspect -f '{{.State.Health.Status}}' "$API_ID" 2>/dev/null || echo unknown)"
  [ "$st" = healthy ] && break
  [ "$i" = 30 ] && { echo "Backend chưa healthy sau 90 giây (trạng thái: $st). Xem: docker compose logs api" >&2; exit 1; }
  sleep 3
done
docker compose logs --tail 20 migrate

step "Kiểm tra web (Caddy)"
sleep 5
WEB_ID="$(docker compose ps -q web)"
if [ "$(docker inspect -f '{{.State.Running}} {{.State.Restarting}}' "$WEB_ID" 2>/dev/null)" != "true false" ]; then
  echo "Container web không chạy được. Log:" >&2
  docker compose logs --tail 30 web >&2 || true
  exit 1
fi

step "Dọn image cũ"
docker image prune -f >/dev/null

docker compose ps
case "$DOMAIN" in http://*|https://*) URL="$DOMAIN" ;; *) URL="https://$DOMAIN" ;; esac
cat <<EOF

XONG. Mở: $URL   (trang QS: $URL/qs)
Lần đầu Caddy cần ~30 giây để xin chứng chỉ HTTPS. Xem log: docker compose logs -f web
EOF
