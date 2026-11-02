package webpush

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	recordSize = 4096 // rs trong header aes128gcm
	saltLen    = 16
	tagLen     = 16 // thẻ xác thực AES-GCM
	headerLen  = saltLen + 4 + 1 + 65
	// maxPayload: RFC 8291 mục 4 - rs phải LỚN HƠN payload + 1 byte phân cách (0x02) + 16 byte tag,
	// nên với rs = 4096 payload tối đa 4096 - 16 - 1 - 1 = 4078 byte.
	maxPayload = recordSize - tagLen - 1 - 1
)

var errPayloadTooLarge = fmt.Errorf("webpush: nội dung thông báo vượt %d byte", maxPayload)

// encrypt mã hoá payload cho 1 subscription theo RFC 8291: 1 record aes128gcm, không đệm thêm.
// Kết quả = header 86 byte (salt 16 || rs 4 byte big-endian || idlen 1 || keyid = khoá công khai tạm 65 byte)
// || bản mã (payload || 0x02) + tag 16 byte.
// asPriv (khoá ECDH tạm của máy chủ) và salt do bên gọi truyền vào để test tái tạo đúng ví dụ RFC 8291 phụ lục A;
// Send luôn dùng giá trị ngẫu nhiên mới cho mỗi tin.
func encrypt(payload []byte, uaPub *ecdh.PublicKey, authSecret []byte, asPriv *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(payload) > maxPayload {
		return nil, errPayloadTooLarge
	}
	if len(salt) != saltLen {
		return nil, errors.New("webpush: salt phải dài 16 byte")
	}
	secret, err := asPriv.ECDH(uaPub)
	if err != nil {
		return nil, fmt.Errorf("webpush: ECDH lỗi: %w", err)
	}
	asPub := asPriv.PublicKey().Bytes()
	cek, nonce, err := deriveKeys(secret, authSecret, uaPub.Bytes(), asPub, salt)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, fmt.Errorf("webpush: AES lỗi: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("webpush: AES-GCM lỗi: %w", err)
	}
	plain := make([]byte, len(payload)+1)
	copy(plain, payload)
	plain[len(payload)] = 0x02 // phân cách của record cuối, không đệm thêm

	out := make([]byte, 0, headerLen+len(plain)+tagLen)
	out = append(out, salt...)
	out = binary.BigEndian.AppendUint32(out, recordSize)
	out = append(out, byte(len(asPub)))
	out = append(out, asPub...)
	return gcm.Seal(out, nonce, plain, nil), nil
}

// deriveKeys: khoá nội dung CEK (16 byte) và NONCE (12 byte) theo RFC 8291 mục 3.3-3.4.
//
//	IKM   = HKDF(salt = auth_secret, IKM = ecdh_secret, info = "WebPush: info" || 0x00 || ua_public || as_public, L = 32)
//	CEK   = HKDF(salt, IKM, "Content-Encoding: aes128gcm" || 0x00, 16)
//	NONCE = HKDF(salt, IKM, "Content-Encoding: nonce" || 0x00, 12)
//
// Chỉ 1 record (số thứ tự 0) nên NONCE không cần XOR với số thứ tự.
func deriveKeys(ecdhSecret, authSecret, uaPub, asPub, salt []byte) (cek, nonce []byte, err error) {
	keyInfo := "WebPush: info\x00" + string(uaPub) + string(asPub)
	ikm, err := hkdf.Key(sha256.New, ecdhSecret, authSecret, keyInfo, 32)
	if err != nil {
		return nil, nil, fmt.Errorf("webpush: HKDF lỗi: %w", err)
	}
	if cek, err = hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16); err != nil {
		return nil, nil, fmt.Errorf("webpush: HKDF lỗi: %w", err)
	}
	if nonce, err = hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12); err != nil {
		return nil, nil, fmt.Errorf("webpush: HKDF lỗi: %w", err)
	}
	return cek, nonce, nil
}
