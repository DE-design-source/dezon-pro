package webpush

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"
)

// jwtTTL: hạn của JWT VAPID tính từ lúc gửi (RFC 8292 cho tối đa 24 giờ).
const jwtTTL = 12 * time.Hour

// jwtHeader: header JWS cố định, đúng thứ tự khoá như ví dụ RFC 8292 mục 2.4.
const jwtHeader = `{"typ":"JWT","alg":"ES256"}`

// vapidToken ký JWT VAPID (RFC 8292 mục 2): ES256, chữ ký thô r || s 64 byte (RFC 7518 mục 3.4, không phải ASN.1).
func (c *Client) vapidToken(aud string) (string, error) {
	claims, err := json.Marshal(struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}{aud, c.now().Add(jwtTTL).Unix(), c.subject})
	if err != nil {
		return "", fmt.Errorf("webpush: không tạo được JWT: %w", err)
	}
	unsigned := b64([]byte(jwtHeader)) + "." + b64(claims)
	digest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, c.priv, digest[:])
	if err != nil {
		return "", fmt.Errorf("webpush: không ký được JWT: %w", err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return unsigned + "." + b64(sig), nil
}
