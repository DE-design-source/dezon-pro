package chat

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"math/big"
	"regexp"
	"time"

	"qspro-backend/internal/platform/logger"
)

// Giới hạn OTP (CHAT.md 6), số điện thoại và email như nhau: mã 6 số sống 5 phút, gửi lại sau 60 giây, tối đa 5 lần / giờ
// / số (email) và 20 lần / giờ / IP (đếm chung cả số lẫn email), sai 5 lần thì khoá số (email) 15 phút.
const (
	otpTTL         = 5 * time.Minute
	otpResend      = 60 * time.Second
	otpPerPhone    = 5 // cũng là giới hạn / email
	otpPerIP       = 20
	otpMaxAttempts = 5
	otpLock        = 15 * time.Minute
	otpKeep        = 24 * time.Hour // dòng cũ hơn thì xoá khi số / email đó xin mã lần sau
)

// newOTP: 6 chữ số ngẫu nhiên (crypto/rand).
func newOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// otpHash = hex(HMAC-SHA256(khoá OTP của server, to + ":" + code)), to = số E.164 hoặc email đã chuẩn hoá; DB chỉ lưu giá trị này.
func otpHash(key []byte, to, code string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(to + ":" + code))
	return hex.EncodeToString(h.Sum(nil))
}

// otpEqual so mã băm không lộ thời gian.
func otpEqual(a, b string) bool { return hmac.Equal([]byte(a), []byte(b)) }

func otpText(code string) string {
	return "Mã xác thực Dezon Chat: " + code + " (hết hạn sau 5 phút)"
}

// otpEmail: tiêu đề + nội dung (chữ thường, HTML) của email gửi mã.
func otpEmail(code string) (subject, text, htmlBody string) {
	c := html.EscapeString(code)
	subject = "Mã xác thực Dezon Chat"
	text = "Mã xác thực Dezon Chat của bạn là: " + code + "\n\n" +
		"Mã hết hạn sau 5 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.\n" +
		"Nếu bạn không yêu cầu mã thì bỏ qua email này.\n"
	htmlBody = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>` + subject + `</title></head>` +
		`<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933">` +
		`<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">` +
		`<p style="margin:0 0 12px;font-size:15px">Mã xác thực Dezon Chat của bạn là:</p>` +
		`<p style="margin:0 0 16px;font-size:30px;font-weight:bold;letter-spacing:6px">` + c + `</p>` +
		`<p style="margin:0 0 8px;font-size:14px">Mã hết hạn sau 5 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.</p>` +
		`<p style="margin:0;font-size:13px;color:#6b7280">Nếu bạn không yêu cầu mã thì bỏ qua email này.</p>` +
		`</div></body></html>`
	return subject, text, htmlBody
}

var reOTPCode = regexp.MustCompile(`\d{6}`)

// logSender: SMS của giai đoạn MVP - ghi mã vào log server (nhà cung cấp SMS thật cần credential, làm sau).
type logSender struct{}

func (logSender) Send(_ context.Context, phone, text string) error {
	code := reOTPCode.FindString(text)
	if code == "" {
		code = text
	}
	logger.Info("chat", "OTP cho "+phone+": "+code)
	return nil
}

// logMailer: email khi chưa đặt SMTP_HOST - ghi mã vào log server như logSender.
type logMailer struct{}

func (logMailer) Send(_ context.Context, to, _, text, _ string) error {
	code := reOTPCode.FindString(text)
	if code == "" {
		code = text
	}
	logger.Info("chat", "OTP email cho "+to+": "+code)
	return nil
}
