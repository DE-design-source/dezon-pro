#!/usr/bin/env bash
# Sao lưu QS Pro đang chạy trong Docker (infra/deploy):
#   - database ra file .dump (pg_dump định dạng custom): qspro-<thời điểm>.dump
#   - kho ảnh / tài liệu (volume uploads, /app/uploads trong api) ra file nén: qspro-files-<thời điểm>.tar.gz
#   - tệp chat (bucket MinIO) chép thêm vào thư mục qspro-media/ (mc mirror, không có bản theo thời điểm)
#   bash infra/scripts/backup-db.sh
# Lưu ở BACKUP_DIR (mặc định /opt/qspro-backups), xoá bản cũ hơn BACKUP_KEEP_DAYS ngày (mặc định 14).
# setup-server.sh đặt lịch chạy 02:30 hằng ngày; deploy.sh gọi trước mỗi lần migration.
# Khôi phục: bash infra/scripts/restore-db.sh <file.dump> [qspro-files-....tar.gz] [<BACKUP_DIR>/qspro-media]
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" && pwd)"
cd "$DEPLOY_DIR"
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r' || true; }

BACKUP_DIR="$(env_get BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/opt/qspro-backups}"
KEEP_DAYS="$(env_get BACKUP_KEEP_DAYS)"; KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/qspro-$TS.dump"
FILES_OUT="$BACKUP_DIR/qspro-files-$TS.tar.gz"
trap 'rm -f "$OUT.tmp" "$FILES_OUT.tmp"' EXIT   # lỗi giữa chừng thì không để lại file dở
# pg_dump chạy trong container db, dùng user/database của chính container
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT.tmp"
[ -s "$OUT.tmp" ] || { rm -f "$OUT.tmp"; echo "$(date '+%F %T') LỖI: bản sao lưu rỗng" >&2; exit 1; }
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
echo "$(date '+%F %T') Đã sao lưu: $OUT ($(du -h "$OUT" | cut -f1))"

# Kho file: container tạm từ image api (--no-deps: không đụng db / migrate), đọc volume uploads.
# Chạy được cả khi api đang chạy lẫn đang tắt (lúc restore-db.sh đã dừng backend).
docker compose run --rm --no-deps -T --entrypoint tar api -C /app/uploads -czf - . > "$FILES_OUT.tmp"
[ -s "$FILES_OUT.tmp" ] || { rm -f "$FILES_OUT.tmp"; echo "$(date '+%F %T') LỖI: bản sao lưu file rỗng" >&2; exit 1; }
mv "$FILES_OUT.tmp" "$FILES_OUT"
chmod 600 "$FILES_OUT"
echo "$(date '+%F %T') Đã sao lưu file: $FILES_OUT ($(du -h "$FILES_OUT" | cut -f1))"

# Tệp chat (MinIO): chép thêm (mc mirror) vào 1 thư mục cố định $BACKUP_DIR/qspro-media/, không xoá gì ở đích.
# Tệp chat không bao giờ bị ghi đè (mỗi tệp 1 khoá ngẫu nhiên) nên thư mục này chứa đủ tệp cho MỌI bản .dump còn giữ;
# tệp đã bị dọn trên MinIO vẫn còn ở đây (thừa vô hại). Bỏ chat/in/ (tệp tạm đang tải lên).
# MinIO chưa chạy (vd lần deploy đầu có MinIO) thì bỏ qua bước này.
MEDIA_DIR="$BACKUP_DIR/qspro-media"
if [ -n "$(docker compose ps --status running -q minio 2>/dev/null)" ]; then
  mkdir -p "$MEDIA_DIR"
  chmod 700 "$MEDIA_DIR"
  # container tạm từ image minio-init (có mc + biến MINIO_ROOT_* / CHAT_S3_BUCKET), chạy root để ghi vào $BACKUP_DIR
  docker compose run --rm --no-deps -T --user 0 -v "$MEDIA_DIR:/backup" --entrypoint sh minio-init -c '
    set -e
    export MC_CONFIG_DIR=/tmp/.mc
    mc alias set q http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror -q --exclude "chat/in/*" "q/$CHAT_S3_BUCKET" /backup >/dev/null'
  echo "$(date '+%F %T') Đã sao lưu tệp chat: $MEDIA_DIR ($(du -sh "$MEDIA_DIR" | cut -f1))"
else
  echo "$(date '+%F %T') Bỏ qua sao lưu tệp chat: MinIO chưa chạy"
fi

find "$BACKUP_DIR" -maxdepth 1 \( -name 'qspro-*.dump' -o -name 'qspro-*.dump.tmp' \
  -o -name 'qspro-files-*.tar.gz' -o -name 'qspro-files-*.tar.gz.tmp' \) -mtime +"$KEEP_DAYS" -print -delete
