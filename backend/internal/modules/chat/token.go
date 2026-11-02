package chat

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Access token: JWT HS256 {"sub":"<user id>","did":<device id>,"typ":"chat","iat","exp"} (CHAT.md 6, 15).
// Chỉ nhận đúng alg HS256 (chặn "none" / RS256 / HS512...), chữ ký so bằng hmac.Equal.

var jwtHeader = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

type accessClaims struct {
	Sub string `json:"sub"`
	Did int64  `json:"did"`
	Typ string `json:"typ"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

var errToken = errors.New("access token không hợp lệ")

// maxTokenLen: token dài bất thường thì từ chối trước khi giải mã.
const maxTokenLen = 2048

func jwtSign(key []byte, signingInput string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(signingInput))
	return h.Sum(nil)
}

// signAccess cấp access token cho thiết bị did của uid, hạn ttl tính từ now.
func signAccess(key []byte, uid, did int64, now time.Time, ttl time.Duration) string {
	c := accessClaims{Sub: strconv.FormatInt(uid, 10), Did: did, Typ: "chat", Iat: now.Unix(), Exp: now.Add(ttl).Unix()}
	b, _ := json.Marshal(c)
	in := jwtHeader + "." + base64.RawURLEncoding.EncodeToString(b)
	return in + "." + base64.RawURLEncoding.EncodeToString(jwtSign(key, in))
}

// parseAccess kiểm chữ ký, alg, typ, hạn; trả user id + device id.
func parseAccess(key []byte, tok string, now time.Time) (uid, did int64, err error) {
	if tok == "" || len(tok) > maxTokenLen {
		return 0, 0, errToken
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return 0, 0, errToken
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, 0, errToken
	}
	var h struct {
		Alg string `json:"alg"`
	}
	if json.Unmarshal(hb, &h) != nil || h.Alg != "HS256" {
		return 0, 0, errToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, jwtSign(key, parts[0]+"."+parts[1])) {
		return 0, 0, errToken
	}
	pb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, 0, errToken
	}
	var c accessClaims
	dec := json.NewDecoder(bytes.NewReader(pb))
	if dec.Decode(&c) != nil || c.Typ != "chat" || c.Exp <= now.Unix() || c.Did <= 0 {
		return 0, 0, errToken
	}
	uid, err = strconv.ParseInt(c.Sub, 10, 64)
	if err != nil || uid <= 0 {
		return 0, 0, errToken
	}
	return uid, c.Did, nil
}

// newRefreshToken: 32 byte ngẫu nhiên base64url (token đưa client) + sha256 hex (lưu trong DB).
func newRefreshToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, hashToken(raw), nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
