package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// b64url = b64url (A:18): base64url không đệm.
func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// sign = sign_ (A:19): HMAC-SHA256 của thân token.
func (s *Service) sign(data string) string {
	h := hmac.New(sha256.New, []byte(s.secret))
	h.Write([]byte(data))
	return b64url(h.Sum(nil))
}

// makeToken = makeToken (A:20-24). u là dòng thô users. Thứ tự khoá uid, u, r, ct, exp như object literal của Node.
// Token KHÔNG có sid: SessionActor từ chối (chỉ dùng cho test đối chiếu golden Node).
func (s *Service) makeToken(u *omap.Map) string { return s.makeTokenSid(u, "") }

// makeTokenSid: như makeToken, thêm khoá "sid" (id phiên user_sessions, M1.2) ở cuối khi sid khác rỗng.
func (s *Service) makeTokenSid(u *omap.Map, sid string) string {
	payload := omap.Of("uid", u.Val("id"), "u", u.Val("username"), "r", u.Val("role"),
		"ct", jsval.Or(u.Val("cong_ty_id"), nil), "exp", s.now()+s.ttlMs)
	if sid != "" {
		payload.Set("sid", sid)
	}
	js, _ := omap.Marshal(payload)
	body := b64url(js)
	return body + "." + s.sign(body)
}

// nodeBase64 = Buffer.from(str, "base64"): bỏ qua ký tự lạ, nhận cả bảng chữ url-safe, dừng ở dấu "=".
func nodeBase64(str string) []byte {
	out := make([]byte, 0, len(str)*3/4)
	var acc uint32
	bits := 0
	for i := 0; i < len(str); i++ {
		c := str[i]
		var v uint32
		switch {
		case c >= 'A' && c <= 'Z':
			v = uint32(c - 'A')
		case c >= 'a' && c <= 'z':
			v = uint32(c-'a') + 26
		case c >= '0' && c <= '9':
			v = uint32(c-'0') + 52
		case c == '+' || c == '-':
			v = 62
		case c == '/' || c == '_':
			v = 63
		case c == '=':
			return out
		default:
			continue
		}
		acc = acc<<6 | v
		if bits += 6; bits >= 8 {
			bits -= 8
			out = append(out, byte(acc>>uint(bits)))
		}
	}
	return out
}

// VerifyToken = verifyToken (A:25-34): chữ ký đúng và chưa hết hạn -> payload {uid, u, r, ct, exp, sid}; sai -> nil.
func (s *Service) VerifyToken(token string) *omap.Map {
	if token == "" || !strings.Contains(token, ".") {
		return nil
	}
	parts := strings.Split(token, ".") // phần thứ 3 trở đi bị bỏ qua như destructuring của Node
	body, sig := parts[0], parts[1]
	if s.sign(body) != sig {
		return nil
	}
	v, err := omap.Decode(nodeBase64(body))
	if err != nil {
		return nil
	}
	p, ok := v.(*omap.Map) // giá trị không phải object: p.exp là undefined -> null
	if !ok || p == nil {
		return nil
	}
	exp := p.Val("exp")
	if !jsval.Truthy(exp) || jsval.ToNumber(exp) < s.now() {
		return nil
	}
	return p
}
