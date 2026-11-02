package server

import (
	"testing"

	"qspro-backend/internal/config"
)

// chatMail: tắt (SMTP_HOST rỗng / cấu hình sai) phải là interface nil THẬT để chat dùng logMailer, không phải *mailer.Client nil.
func TestChatMail(t *testing.T) {
	if m := chatMail(&config.Config{}); m != nil {
		t.Errorf("SMTP_HOST rỗng: %T, muốn nil", m)
	}
	if m := chatMail(&config.Config{SMTPHost: "smtp.vidu.vn", SMTPPort: 587, SMTPFrom: "không phải địa chỉ"}); m != nil {
		t.Errorf("SMTP_FROM sai: %T, muốn nil", m)
	}
	if m := chatMail(&config.Config{SMTPHost: "smtp.vidu.vn", SMTPPort: 587, SMTPFrom: "Dezon Chat <no-reply@dezon.vn>"}); m == nil {
		t.Error("cấu hình đủ: muốn có client SMTP")
	}
}
