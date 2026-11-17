// QS Pro backend (Go + Gin) - điểm khởi chạy.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"qspro-backend/internal/config"
	"qspro-backend/internal/jobs"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/platform/redis"
	"qspro-backend/internal/server"
)

func main() {
	config.LoadDotenv() // backend/.env rồi ../.env; không đè biến môi trường đã đặt; DOTENV=0 thì không đọc
	cfg := config.Load()

	rdb, err := redis.New(cfg.RedisURL)
	if err != nil {
		logger.Error("redis", "không kết nối được, chạy không có Redis:", err.Error())
	}

	srv := server.New(&server.Deps{Cfg: cfg, Redis: rdb})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// ═══ JOB NỀN: báo cáo nhập SP tự động + nhắc gia hạn công ty trong ứng dụng (M17.3); REPORT_JOB=0 thì không bật ═══
	worker := jobs.Start(ctx, jobs.Deps{Reports: srv.Reports(), Expiry: srv.Expiry(), Cfg: cfg})
	srv.OnShutdown(worker.Stop)
	// worker gửi tin hẹn giờ của chat (mỗi 15 giây; không phụ thuộc REPORT_JOB), dừng trong chat Shutdown khi server tắt
	srv.StartChatScheduler()

	if err := srv.Run(ctx); err != nil {
		logger.Error("server", err.Error())
		os.Exit(1)
	}
}
