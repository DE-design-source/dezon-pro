// Sinh cặp khoá VAPID (RFC 8292) cho Web Push của chat. Chạy từ backend/:
//
//	go run ./cmd/vapid
//
// In 1 dòng chú thích + 2 dòng CHAT_VAPID_PUBLIC_KEY / CHAT_VAPID_PRIVATE_KEY để chép vào .env của máy chủ
// (hoặc biến môi trường trên VPS). Cần đặt thêm CHAT_VAPID_SUBJECT (https://<tên miền> hoặc mailto:<email>).
// Sinh MỘT lần rồi giữ cố định: đổi khoá thì mọi đăng ký thông báo cũ của trình duyệt mất hiệu lực.
// Lệnh không đọc .env, không nối database.
package main

import (
	"fmt"
	"os"

	"qspro-backend/internal/platform/webpush"
)

func main() {
	pub, priv, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Không sinh được khoá VAPID:", err)
		os.Exit(1)
	}
	fmt.Println("# Chép 2 dòng dưới vào .env của máy chủ, đặt thêm CHAT_VAPID_SUBJECT=https://<tên miền> (hoặc mailto:<email>); giữ kín CHAT_VAPID_PRIVATE_KEY, đổi khoá thì người dùng phải bật lại thông báo.")
	fmt.Println("CHAT_VAPID_PUBLIC_KEY=" + pub)
	fmt.Println("CHAT_VAPID_PRIVATE_KEY=" + priv)
}
