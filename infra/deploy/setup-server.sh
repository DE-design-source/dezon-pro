#!/usr/bin/env bash
# Chuẩn bị máy chủ Ubuntu 22.04 / 24.04 MỚI cho QS Pro. Chạy 1 lần, bằng root, từ thư mục repo đã clone:
#   sudo bash infra/deploy/setup-server.sh
# Làm: cập nhật hệ thống, múi giờ VN, swap 2 GB (nếu chưa có), Docker, tường lửa (chỉ mở SSH/80/443),
#      tự cập nhật bản vá bảo mật, tạo infra/deploy/.env với mật khẩu/khoá ngẫu nhiên, lịch sao lưu database 02:30 hằng ngày.
# Chạy lại nhiều lần không sao: bước nào đã làm thì bỏ qua.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Cần chạy bằng root: sudo bash $0" >&2; exit 1; }
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
step() { printf '\n==> %s\n' "$*"; }

step "Cập nhật hệ thống, cài công cụ cơ bản"
export DEBIAN_FRONTEND=noninteractive
# Giữ file cấu hình nhà cung cấp VPS đã sửa (vd /etc/cloud/cloud.cfg), không dừng lại hỏi
APT_KEEP_CONF=(-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
dpkg --configure -a --force-confdef --force-confold
apt-get update -y
apt-get upgrade -y "${APT_KEEP_CONF[@]}"
apt-get install -y ca-certificates curl git ufw openssl unattended-upgrades fail2ban

step "Múi giờ Asia/Ho_Chi_Minh (giờ chạy lịch sao lưu)"
timedatectl set-timezone Asia/Ho_Chi_Minh || true

step "Swap 2 GB (build Go + React cần RAM; máy 1-2 GB RAM dễ hết bộ nhớ)"
if swapon --show | grep -q .; then
  echo "Đã có swap, bỏ qua."
else
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Cài Docker Engine + Docker Compose"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Đã có $(docker --version), bỏ qua."
else
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

step "Tường lửa: chỉ mở SSH, 80, 443"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status

step "Bật fail2ban (chặn dò mật khẩu SSH) và tự cập nhật bản vá bảo mật"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

step "Tạo $DEPLOY_DIR/.env (nếu chưa có)"
if [ -f "$DEPLOY_DIR/.env" ]; then
  echo "Đã có .env, giữ nguyên."
else
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" "$DEPLOY_DIR/.env"
  sed -i "s/^AUTH_SECRET=.*/AUTH_SECRET=$(openssl rand -hex 32)/" "$DEPLOY_DIR/.env"
  echo "Đã tạo .env với POSTGRES_PASSWORD và AUTH_SECRET ngẫu nhiên."
fi
chmod 600 "$DEPLOY_DIR/.env"

step "Lịch sao lưu database 02:30 hằng ngày (/etc/cron.d/qspro-backup)"
cat > /etc/cron.d/qspro-backup <<EOF
# Sao lưu database QS Pro (tạo bởi infra/deploy/setup-server.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root bash $REPO_DIR/infra/scripts/backup-db.sh >> /var/log/qspro-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/qspro-backup
# cron giữ múi giờ đọc lúc khởi động: phải khởi động lại sau khi đổi múi giờ, nếu không lịch chạy theo giờ UTC
systemctl restart cron || true

step "XONG"
cat <<EOF
Bước tiếp theo:
  1) Sửa cấu hình:        nano $DEPLOY_DIR/.env      (điền DOMAIN, ACME_EMAIL, khoá Lark...)
  2) Kiểm tra DNS:        bản ghi A của tên miền phải trỏ về IP máy chủ này
  3) Triển khai:          bash $DEPLOY_DIR/deploy.sh
EOF
