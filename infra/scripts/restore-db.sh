#!/usr/bin/env bash
# Nạp dữ liệu vào QS Pro trong Docker (infra/deploy), THAY THẾ TOÀN BỘ dữ liệu hiện có.
#   bash infra/scripts/restore-db.sh <file.dump | file.sql> [qspro-files-....tar.gz] [thư mục qspro-media] [--yes]
#   bash infra/scripts/restore-db.sh <qspro-files-....tar.gz | thư mục qspro-media> [--yes]   # chỉ kho file / tệp chat, không đụng database
# Dùng khi: chuyển dữ liệu từ máy khác lên máy chủ (file pg_dump), hoặc quay lại một bản sao lưu.
# Các bước: sao lưu hiện tại (database + kho file) -> dừng backend -> xoá và tạo lại database -> nạp file
#           -> (nếu có file .tar.gz) xoá sạch rồi bung lại kho ảnh / tài liệu (volume uploads)
#           -> (nếu có thư mục qspro-media) chép tệp chat vào bucket MinIO (chỉ thêm, không xoá tệp đang có)
#           -> chạy migration còn thiếu -> bật lại backend.
# File .dump = pg_dump -Fc (custom); file .sql = pg_dump dạng chữ. Chủ sở hữu / quyền trong file được bỏ qua.
# File .tar.gz = bản sao lưu kho file do backup-db.sh tạo (qspro-files-<thời điểm>.tar.gz).
# Thư mục qspro-media = bản chép tệp chat do backup-db.sh tạo (<BACKUP_DIR>/qspro-media), dùng chung cho mọi bản .dump.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../deploy" && pwd)"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
step() { printf '\n==> %s\n' "$*"; }
abs() { echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
USAGE="Cách dùng: bash $0 <file.dump|file.sql> [qspro-files-....tar.gz] [thư mục qspro-media] [--yes]   hoặc   bash $0 <qspro-files-....tar.gz | thư mục qspro-media> [--yes]"

FILE=""; FILES_TAR=""; MEDIA_DIR=""; YES=0; MODE=""
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    -*) echo "Tham số không hiểu: $a" >&2; exit 2 ;;
    *.dump) [ -z "$FILE" ] || { echo "$USAGE" >&2; exit 2; }; FILE="$a"; MODE=dump ;;
    *.sql) [ -z "$FILE" ] || { echo "$USAGE" >&2; exit 2; }; FILE="$a"; MODE=sql ;;
    *.tar.gz|*.tgz) [ -z "$FILES_TAR" ] || { echo "$USAGE" >&2; exit 2; }; FILES_TAR="$a" ;;
    *) if [ -d "$a" ]; then
         [ -z "$MEDIA_DIR" ] || { echo "$USAGE" >&2; exit 2; }; MEDIA_DIR="$(abs "$a")"
       else
         echo "Chỉ nhận file .dump (pg_dump -Fc), .sql, .tar.gz (kho file) hoặc thư mục qspro-media (tệp chat): $a" >&2; exit 2
       fi ;;
  esac
done
[ -n "$FILE$FILES_TAR$MEDIA_DIR" ] || { echo "$USAGE" >&2; exit 2; }
if [ -n "$FILE" ]; then
  [ -s "$FILE" ] || { echo "Không thấy file (hoặc file rỗng): $FILE" >&2; exit 1; }
  FILE="$(abs "$FILE")"
fi
if [ -n "$FILES_TAR" ]; then
  [ -s "$FILES_TAR" ] || { echo "Không thấy file (hoặc file rỗng): $FILES_TAR" >&2; exit 1; }
  FILES_TAR="$(abs "$FILES_TAR")"
  tar -tzf "$FILES_TAR" >/dev/null \
    || { echo "File không phải bản nén tar.gz hợp lệ. Chưa thay đổi gì." >&2; exit 1; }
fi

cd "$DEPLOY_DIR"
if [ "$YES" != 1 ]; then
  [ -z "$FILE" ] || { echo "CẢNH BÁO: toàn bộ dữ liệu hiện tại trong database sẽ bị thay bằng nội dung của:"; echo "  $FILE"; }
  [ -z "$FILES_TAR" ] || { echo "CẢNH BÁO: toàn bộ ảnh / tài liệu hiện tại (volume uploads) sẽ bị XOÁ và thay bằng nội dung của:"; echo "  $FILES_TAR"; }
  [ -z "$MEDIA_DIR" ] || { echo "Tệp chat trong thư mục sau sẽ được chép vào MinIO (chỉ thêm / ghi đè tệp trùng khoá, không xoá):"; echo "  $MEDIA_DIR"; }
  read -r -p "Gõ YES để tiếp tục: " ans
  [ "$ans" = YES ] || { echo "Đã huỷ."; exit 1; }
fi

step "Bật database"
docker compose up -d --wait db

if [ "$MODE" = dump ]; then
  step "Kiểm tra file trước khi đụng tới dữ liệu"
  docker compose exec -T db pg_restore --list < "$FILE" >/dev/null \
    || { echo "File không phải bản pg_dump -Fc hợp lệ. Chưa thay đổi gì." >&2; exit 1; }
fi

TABLES="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'"' | tr -d '\r')"
BACKUP_FILE=""; BACKUP_FILES_TAR=""
if [ "${TABLES:-0}" != 0 ] || [ -n "$FILES_TAR" ]; then
  step "Sao lưu database + kho file hiện tại trước khi thay"
  BACKUP_LOG="$(bash "$SCRIPTS_DIR/backup-db.sh" | tee /dev/stderr)"
  BACKUP_FILE="$(printf '%s\n' "$BACKUP_LOG" | sed -n 's/.*Đã sao lưu: \(.*\.dump\) (.*/\1/p' | tail -n 1)"
  BACKUP_FILES_TAR="$(printf '%s\n' "$BACKUP_LOG" | sed -n 's/.*Đã sao lưu file: \(.*\.tar\.gz\) (.*/\1/p' | tail -n 1)"
fi
# lệnh quay lại đúng phần đã thay (database và/hoặc kho file)
UNDO=""
[ -z "$FILE" ] || [ -z "$BACKUP_FILE" ] || UNDO="$BACKUP_FILE"
[ -z "$FILES_TAR" ] || [ -z "$BACKUP_FILES_TAR" ] || UNDO="${UNDO:+$UNDO }$BACKUP_FILES_TAR"

on_fail() {
  echo >&2
  echo "LỖI: nạp dữ liệu KHÔNG thành công. Backend đang TẮT (trang web báo 502)." >&2
  if [ -n "$UNDO" ]; then
    echo "Quay lại dữ liệu trước đó:  bash $SCRIPTS_DIR/restore-db.sh $UNDO --yes" >&2
  else
    echo "Dữ liệu trước đó trống. Sửa file rồi chạy lại lệnh này." >&2
  fi
}
trap on_fail ERR

step "Dừng backend"
docker compose stop api

if [ -n "$FILE" ]; then
  step "Xoá và tạo lại database trống"
  docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

  step "Nạp dữ liệu từ $FILE"
  if [ "$MODE" = dump ]; then
    docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' < "$FILE"
  else
    # bỏ lệnh gán chủ sở hữu / phân quyền: role của máy nguồn không có ở đây
    sed -E '/^ALTER .* OWNER TO /d; /^(GRANT|REVOKE) /d; /^ALTER DEFAULT PRIVILEGES /d' "$FILE" \
      | docker compose exec -T db sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null
  fi
fi

if [ -n "$FILES_TAR" ]; then
  step "Thay kho file (volume uploads) bằng $FILES_TAR"
  # container tạm từ image api (user app, chủ của /app/uploads), không đụng db / migrate
  docker compose run --rm --no-deps -T --entrypoint sh api -c 'find /app/uploads -mindepth 1 -delete && tar -C /app/uploads -xzf -' < "$FILES_TAR"
fi

if [ -n "$MEDIA_DIR" ]; then
  step "Chép tệp chat từ $MEDIA_DIR vào MinIO"
  # bật minio + tạo bucket / user ứng dụng (minio-init chạy lại được), rồi chép bằng mc trong container tạm
  docker compose up -d --wait minio
  docker compose run --rm -T minio-init
  docker compose run --rm --no-deps -T --user 0 -v "$MEDIA_DIR:/backup:ro" --entrypoint sh minio-init -c '
    set -e
    export MC_CONFIG_DIR=/tmp/.mc
    mc alias set q http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror -q --overwrite /backup "q/$CHAT_S3_BUCKET" >/dev/null'
fi

step "Chạy migration còn thiếu và bật lại backend"
trap - ERR
if ! docker compose up -d; then
  docker compose logs --tail 60 migrate api >&2 || true
  echo "LỖI: đã nạp dữ liệu nhưng migration / backend không chạy được (xem log ở trên). Backend đang TẮT." >&2
  [ -z "$UNDO" ] || echo "Quay lại dữ liệu trước đó:  bash $SCRIPTS_DIR/restore-db.sh $UNDO --yes" >&2
  exit 1
fi
docker compose logs --tail 20 migrate
echo
echo "XONG. Đã nạp: ${FILE:+$FILE }${FILES_TAR:+$FILES_TAR }${MEDIA_DIR}"
