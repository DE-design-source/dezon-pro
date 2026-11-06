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

// otpEmail: tiêu đề + nội dung (chữ thường, HTML) của email gửi mã. HTML dựng bằng bảng + style nội dòng
// (Gmail / Outlook bỏ <style> và flex); màu chính #2F5DA8 trùng --primary của trang Chat.
func otpEmail(code string) (subject, text, htmlBody string) {
	c := html.EscapeString(code)
	subject = "Mã xác thực Dezon Chat"
	text = "Mã xác thực Dezon Chat của bạn là: " + code + "\n\n" +
		"Mã hết hạn sau 5 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.\n" +
		"Nếu bạn không yêu cầu mã thì bỏ qua email này.\n"
	htmlBody = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1"><title>` + subject + `</title></head>` +
		`<body style="margin:0;padding:0;background:#eef1f6;font-family:'Segoe UI',Roboto,Arial,Helvetica,sans-serif;color:#1f2933">` +
		`<div style="display:none;max-height:0;overflow:hidden;opacity:0">Mã đăng nhập Dezon Chat, hết hạn sau 5 phút.</div>` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6">` +
		`<tr><td align="center" style="padding:32px 16px">` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">` +
		// đầu thư
		`<tr><td style="background:#2F5DA8;border-radius:14px 14px 0 0;padding:22px 32px">` +
		`<span style="display:inline-block;background:#ffffff;color:#2F5DA8;font-weight:800;font-size:15px;letter-spacing:1px;` +
		`border-radius:8px;padding:6px 10px;vertical-align:middle">DEZ</span>` +
		`<span style="color:#ffffff;font-size:18px;font-weight:600;vertical-align:middle;padding-left:10px">Dezon Chat</span>` +
		`</td></tr>` +
		// thân thư
		`<tr><td style="background:#ffffff;padding:32px 32px 8px">` +
		`<p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111827">Xác thực đăng nhập</p>` +
		`<p style="margin:0 0 22px;font-size:15px;line-height:22px;color:#4b5563">Mã xác thực Dezon Chat của bạn là:</p>` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
		`<td align="center" style="background:#E8EEFB;border:1px dashed #9bb3e0;border-radius:12px;padding:20px 12px">` +
		`<span style="font-family:Consolas,'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:10px;color:#2F5DA8">` +
		c + `</span></td></tr></table>` +
		`<p style="margin:22px 0 0;font-size:14px;line-height:21px;color:#374151">` +
		`Mã hết hạn sau 5 phút. Vui lòng không chia sẻ mã này với bất kỳ ai.</p>` +
		`</td></tr>` +
		// lưu ý
		`<tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:16px 32px 28px">` +
		`<p style="margin:0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;line-height:20px;color:#6b7280">` +
		`Nếu bạn không yêu cầu mã thì bỏ qua email này. Dezon không bao giờ hỏi mã xác thực của bạn qua điện thoại hay tin nhắn.</p>` +
		`</td></tr>` +
		// chân thư
		`<tr><td align="center" style="padding:18px 16px 0;font-size:12px;line-height:18px;color:#9ca3af">` +
		`Email tự động từ Dezon Chat, vui lòng không trả lời.<br>` +
		`<a href="https://dezon.tech" style="color:#6b7280;text-decoration:none">dezon.tech</a></td></tr>` +
		`</table></td></tr></table></body></html>`
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
