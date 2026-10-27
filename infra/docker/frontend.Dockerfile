# QS Pro frontend (React + Vite) + Caddy (HTTPS tự động, phục vụ file tĩnh, chuyển tiếp API sang backend Go).
# Dựng từ GỐC repo:
#   docker build -f infra/docker/frontend.Dockerfile --build-arg VITE_API_URL=https://qs.example.vn -t qspro-web .
# VITE_API_URL được nhúng vào JS lúc build: đổi tên miền thì phải build lại image này.
# Caddyfile KHÔNG nằm trong image: docker-compose gắn infra/deploy/Caddyfile vào /etc/caddy/Caddyfile.

# 1) Build giao diện
FROM node:22-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Địa chỉ gốc của API (vd https://qs.example.vn), không có "/" cuối. Trống = trang QS báo "Chưa cấu hình VITE_API_URL".
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || { echo "Thiếu build arg VITE_API_URL" >&2; exit 1; }
RUN npm run build

# 2) Image chạy: Caddy phục vụ dist/
FROM caddy:2.10-alpine
COPY --from=build /src/dist /srv
