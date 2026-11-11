#!/bin/sh
# Khởi tạo MinIO cho tệp chat (ảnh / video / tệp / thoại). docker-compose chạy 1 lần (service minio-init) mỗi lần
# khởi động; mọi bước đều chạy lại được (idempotent), nên deploy lại nhiều lần không sao.
#   - bucket riêng tư CHAT_S3_BUCKET (không bao giờ có policy ẩn danh)
#   - user ứng dụng CHAT_S3_ACCESS_KEY (KHÔNG dùng user root cho backend), chỉ được đọc / ghi / xoá trong bucket này
#   - ILM: xoá object tạm chat/in/ sau 1 ngày (tải lên dở / không gọi complete)
# Chạy tay trên máy (mạng qspro-net):
#   docker run --rm --network qspro-net -v "$PWD/infra/deploy/minio-init.sh:/init.sh:ro" --entrypoint sh \
#     -e MINIO_URL=http://qspro-minio:9000 -e MINIO_ROOT_USER=... -e MINIO_ROOT_PASSWORD=... \
#     -e CHAT_S3_ACCESS_KEY=... -e CHAT_S3_SECRET_KEY=... qspro-minio /init.sh
set -eu

MINIO_URL="${MINIO_URL:-http://minio:9000}"
BUCKET="${CHAT_S3_BUCKET:-chat-media}"
POLICY="${CHAT_S3_POLICY:-qspro-chat-media}"
: "${MINIO_ROOT_USER:?Thiếu MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?Thiếu MINIO_ROOT_PASSWORD}"
: "${CHAT_S3_ACCESS_KEY:?Thiếu CHAT_S3_ACCESS_KEY}"
: "${CHAT_S3_SECRET_KEY:?Thiếu CHAT_S3_SECRET_KEY}"
[ "$CHAT_S3_ACCESS_KEY" != "$MINIO_ROOT_USER" ] || { echo "CHAT_S3_ACCESS_KEY phải khác MINIO_ROOT_USER" >&2; exit 1; }
[ "${#CHAT_S3_SECRET_KEY}" -ge 8 ] || { echo "CHAT_S3_SECRET_KEY cần tối thiểu 8 ký tự" >&2; exit 1; }

# image chạy bằng user không có thư mục home: cấu hình mc để ở /tmp
export MC_CONFIG_DIR=/tmp/.mc
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# minio đã healthy (depends_on) nhưng vẫn chờ thêm phòng khi vừa khởi động lại
i=0
until mc alias set q "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 30 ] || { echo "Không nối được MinIO ở $MINIO_URL" >&2; mc alias set q "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; exit 1; }
  sleep 2
done

echo "==> bucket $BUCKET"
mc mb --ignore-existing "q/$BUCKET"
# bucket riêng tư: gỡ mọi policy ẩn danh (nếu ai đó lỡ bật)
mc anonymous set none "q/$BUCKET" >/dev/null

echo "==> user ứng dụng $CHAT_S3_ACCESS_KEY + policy $POLICY"
cat > "$TMP/policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:ListBucket"], "Resource": ["arn:aws:s3:::$BUCKET"]},
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": ["arn:aws:s3:::$BUCKET/*"]}
  ]
}
EOF
# user add = tạo mới hoặc đổi mật khẩu; policy create = tạo mới hoặc ghi đè nội dung
mc admin user add q "$CHAT_S3_ACCESS_KEY" "$CHAT_S3_SECRET_KEY" >/dev/null
mc admin policy create q "$POLICY" "$TMP/policy.json" >/dev/null
if mc admin user info q "$CHAT_S3_ACCESS_KEY" | grep -q "$POLICY"; then
  echo "policy đã gắn sẵn"
else
  mc admin policy attach q "$POLICY" --user "$CHAT_S3_ACCESS_KEY"
fi

echo "==> ILM: xoá chat/in/ sau 1 ngày"
if mc ilm rule ls "q/$BUCKET" --json 2>/dev/null | grep -q '"chat/in/"'; then
  echo "quy tắc ILM đã có"
else
  mc ilm rule add --prefix chat/in/ --expire-days 1 "q/$BUCKET"
fi

echo "XONG: MinIO sẵn sàng cho tệp chat (bucket $BUCKET)"
