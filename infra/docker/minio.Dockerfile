# MinIO (kho file S3 cho chat media) dựng từ mã nguồn: image chính thức minio/minio không còn phát hành miễn phí
# (Docker Hub đã gỡ, quay.io đòi đăng nhập). Dựng từ GỐC repo:
#   docker build -f infra/docker/minio.Dockerfile -t qspro-minio .
# Đổi bản: sửa MINIO_RELEASE (tag RELEASE.* trên github.com/minio/minio) rồi build lại.

# 1) Biên dịch
FROM golang:1.25-alpine AS build
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
RUN apk add --no-cache git
RUN CGO_ENABLED=0 GOFLAGS=-trimpath go install -ldflags="-s -w" github.com/minio/minio@${MINIO_RELEASE}
# mc (MinIO client) cho bước khởi tạo bucket / user / ILM: image minio/mc cũng không còn phát hành
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
RUN CGO_ENABLED=0 GOFLAGS=-trimpath go install -ldflags="-s -w" github.com/minio/mc@${MC_RELEASE}

# 2) Image chạy (server mặc định; chạy mc: docker run --rm --entrypoint mc qspro-minio ...)
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata curl && adduser -D -H minio && mkdir -p /data && chown minio:minio /data
COPY --from=build /go/bin/minio /go/bin/mc /usr/bin/
USER minio
VOLUME ["/data"]
EXPOSE 9000 9001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fs http://127.0.0.1:9000/minio/health/live || exit 1
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
