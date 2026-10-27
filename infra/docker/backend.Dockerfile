# QS Pro backend (Go). Dựng từ GỐC repo (image cần cả migration ở infra/db/migrations):
#   docker build -f infra/docker/backend.Dockerfile -t qspro-backend .
# BuildKit tự đọc infra/docker/backend.Dockerfile.dockerignore (đặt cạnh file này): chỉ gửi phần image cần,
# không gửi .env, .git, node_modules, kết quả test.
# Không cần app Node / public/: spec ngành, logo, file mẫu nhập hàng loạt đã nhúng sẵn trong binary (go:embed).

# 1) Biên dịch
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
# chỉ cmd/ và internal/ (đúng phần .dockerignore mở lại; file nhúng go:embed nằm trong internal/)
COPY backend/cmd ./cmd
COPY backend/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/qspro-api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/qspro-migrate ./cmd/migrate

# 2) Image chạy
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H app
WORKDIR /app
COPY --from=build /out/qspro-api /out/qspro-migrate /app/
# migration: nguồn duy nhất infra/db/migrations; qspro-migrate đọc qua MIGRATIONS_DIR
COPY infra/db/migrations /app/migrations
# NODE_ENV=production: /api-docs và /api-docs.json TẮT mặc định (như bản Node trên production); bật bằng SWAGGER_DOCS=1
ENV PORT=3000 MIGRATIONS_DIR=/app/migrations NODE_ENV=production UPLOAD_DIR=/app/uploads
# Kho ảnh / tài liệu (UPLOAD_DIR). Tạo sẵn và giao cho user app: volume có tên gắn vào lần đầu sẽ nhận đúng chủ sở hữu này.
RUN mkdir -p /app/uploads && chown app:app /app/uploads
USER app
EXPOSE 3000
CMD ["/app/qspro-api"]
