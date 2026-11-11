package chat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"qspro-backend/internal/platform/logger"
)

// Nghiệp vụ tệp đính kèm (REST /chat/media/..., khoá tệp khi gửi tin, MediaDTO của tin, janitor). Luồng: media.go.
// Không giữ transaction trong lúc làm việc với S3 ở complete: dòng được "giành" bằng status = processing.

// mediaRow: một dòng chat_media.
type mediaRow struct {
	id         int64
	uploader   int64
	typ        string
	mime       string
	size       int64
	sha        string
	fileName   *string
	key        string
	thumbKey   *string
	status     string
	width      *int
	height     *int
	durationMs *int
	waveform   []int16
	blurhash   *string
}

const mediaCols = `id, uploader_id, media_type, mime_type, size_bytes, sha256, file_name, object_key, thumb_key, status,
	width, height, duration_ms, waveform, blurhash`

func scanMedia(row pgx.Row) (*mediaRow, error) {
	r := &mediaRow{}
	if err := row.Scan(&r.id, &r.uploader, &r.typ, &r.mime, &r.size, &r.sha, &r.fileName, &r.key, &r.thumbKey, &r.status,
		&r.width, &r.height, &r.durationMs, &r.waveform, &r.blurhash); err != nil {
		return nil, err
	}
	return r, nil
}

// mediaKeys: mọi object có thể có của một tệp (khoá cuối, ảnh nhỏ, ảnh bìa, khoá tạm + ảnh bìa tạm).
func mediaKeys(final string) []string {
	st := stagingKey(final)
	return []string{final, final + mediaThumbSuffix, final + mediaPosterSuffix, st, st + mediaPosterSuffix}
}

// mediaUsable: route tệp chỉ chạy khi đã bật kho tệp và kho đã sẵn sàng (đã kiểm / tạo bucket).
func (s *Service) mediaUsable() error {
	if s.media == nil {
		return errMediaDisabled
	}
	if !s.media.Ready() {
		return errMediaStarting
	}
	return nil
}

// removeObjects: xoá object, lỗi chỉ ghi log (janitor / ILM dọn lại sau).
func (s *Service) removeObjects(ctx context.Context, keys ...string) {
	if s.media == nil || len(keys) == 0 {
		return
	}
	if err := s.media.Remove(ctx, keys...); err != nil {
		logger.Error("chat", "xoá object tệp chat lỗi:", err.Error())
	}
}

// ───────────── GET /chat/media/config ─────────────

// MediaConfig: giới hạn cho client (client không tự đặt giới hạn). Tắt tệp -> {enabled:false}.
func (s *Service) MediaConfig(_ context.Context, _ int64) (*MediaConfigDTO, error) {
	if s.media == nil {
		return &MediaConfigDTO{Enabled: false}, nil
	}
	return &MediaConfigDTO{
		Enabled:        true,
		MaxBytes:       &MediaMaxBytes{Image: s.mediaMaxImage, Video: s.mediaMaxFile, File: s.mediaMaxFile, Voice: mediaMaxVoiceBytes},
		MaxVoiceMs:     mediaMaxVoiceMs,
		MaxPosterBytes: mediaMaxPosterBytes,
		Mimes:          &MediaMimes{Image: mediaImageMimes, Video: mediaVideoMimes, Voice: mediaVoiceMimes},
		DeniedExt:      mediaDeniedExt,
	}, nil
}

// ───────────── POST /chat/media/upload-url ─────────────

// uploadReq: thân upload-url đã kiểm / chuẩn hoá.
type uploadReq struct {
	kind, mime, sha string
	size            int64
	fileName        *string
	width, height   *int
	durationMs      *int
	waveform        []int16
	poster          *MediaPosterInput
}

// checkUpload: kiểm giới hạn theo loại (design mục 3).
func (s *Service) checkUpload(in MediaUploadInput) (*uploadReq, error) {
	v := &uploadReq{kind: strings.ToLower(strings.TrimSpace(in.Type)), size: in.Size, sha: strings.ToLower(strings.TrimSpace(in.SHA256))}
	switch v.kind {
	case MediaImage, MediaVideo, MediaFile, MediaVoice:
	default:
		return nil, errBad("type phải là image / video / file / voice")
	}
	v.mime = normalizeMime(in.Mime)
	switch {
	case v.kind == MediaFile && v.mime == "" && strings.TrimSpace(in.Mime) == "":
		v.mime = mediaOctetStream
	case v.kind == MediaImage && !kindAllowed(v.kind, v.mime):
		return nil, errMediaImageType
	case !kindAllowed(v.kind, v.mime):
		return nil, errMediaType
	}
	if v.size <= 0 {
		return nil, errBad("size phải là số byte > 0")
	}
	if mx := s.mediaMaxBytes(v.kind); v.size > mx {
		return nil, errMediaTooLarge(mx)
	}
	if !reSHA256.MatchString(v.sha) {
		return nil, errBad("sha256 phải là 64 ký tự hex")
	}
	if v.kind == MediaFile {
		if strings.TrimSpace(in.FileName) == "" {
			return nil, errBad("Thiếu file_name")
		}
		n := sanitizeFileName(in.FileName)
		if deniedFileName(n) {
			return nil, errMediaType
		}
		v.fileName = &n
	}
	switch v.kind {
	case MediaVoice:
		if in.DurationMs == nil || *in.DurationMs <= 0 {
			return nil, errBad("Tin nhắn thoại cần duration_ms > 0")
		}
		if *in.DurationMs > mediaMaxVoiceMs {
			return nil, errBad("Tin nhắn thoại tối đa 10 phút")
		}
		if len(in.Waveform) < 1 || len(in.Waveform) > mediaMaxWaveform {
			return nil, errBad("Tin nhắn thoại cần waveform 1..128 cột")
		}
		v.waveform = make([]int16, len(in.Waveform))
		for i, x := range in.Waveform {
			if x < 0 || x > 255 {
				return nil, errBad("waveform chỉ gồm số 0..255")
			}
			v.waveform[i] = int16(x)
		}
		d := *in.DurationMs
		v.durationMs = &d
	case MediaVideo:
		if in.Width != nil && in.Height != nil && *in.Width > 0 && *in.Height > 0 {
			w, h := min(*in.Width, 100000), min(*in.Height, 100000)
			v.width, v.height = &w, &h
		}
		if in.DurationMs != nil && *in.DurationMs > 0 {
			d := min(*in.DurationMs, 86400000)
			v.durationMs = &d
		}
	}
	if in.Poster != nil {
		if v.kind != MediaVideo {
			return nil, errBad("Chỉ video mới có poster")
		}
		pm := normalizeMime(in.Poster.Mime)
		if pm != "image/jpeg" && pm != "image/webp" {
			return nil, errMediaType
		}
		if in.Poster.Size <= 0 {
			return nil, errBad("poster.size phải là số byte > 0")
		}
		if in.Poster.Size > mediaMaxPosterBytes {
			return nil, errMediaTooLarge(mediaMaxPosterBytes)
		}
		v.poster = &MediaPosterInput{Mime: pm, Size: in.Poster.Size}
	}
	return v, nil
}

// MediaUploadURL: tạo / dùng lại dòng chat_media (chống trùng theo người tải + sha256 + loại) rồi ký PUT tới khoá tạm.
// Đã có tệp ready cùng nội dung -> dedup, không cần tải lên.
func (s *Service) MediaUploadURL(ctx context.Context, uid int64, in MediaUploadInput) (*MediaUploadOutput, error) {
	if err := s.mediaUsable(); err != nil {
		return nil, err
	}
	if !s.uploadLimit.allow(uid) {
		return nil, errRateLimit
	}
	v, err := s.checkUpload(in)
	if err != nil {
		return nil, err
	}
	now := s.now()
	key, err := objectKey(uid, now)
	if err != nil {
		return nil, err
	}
	var (
		row   *mediaRow
		dedup bool
	)
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		row, dedup = nil, false
		r, err := scanMedia(tx.QueryRow(ctx, `insert into chat_media (uploader_id, media_type, mime_type, size_bytes, sha256, file_name,
				object_key, status, width, height, duration_ms, waveform, created_at, updated_at)
			values ($1::bigint, $2, $3, $4::bigint, $5, $6, $7, 'pending', $8::integer, $9::integer, $10::integer, $11::smallint[],
				$12::timestamptz, $12::timestamptz)
			on conflict (uploader_id, sha256, media_type) do nothing returning `+mediaCols,
			uid, v.kind, v.mime, v.size, v.sha, v.fileName, key, v.width, v.height, v.durationMs, v.waveform, now))
		if err == nil {
			// hạn mức 24 giờ: tính cả dòng vừa thêm, cả tệp failed / hết hạn (re-issue không tạo dòng mới nên không tính lại)
			var used int64
			if err := tx.QueryRow(ctx, `select coalesce(sum(size_bytes), 0)::bigint from chat_media where uploader_id = $1 and created_at > $2::timestamptz`,
				uid, now.Add(-24*time.Hour)).Scan(&used); err != nil {
				return err
			}
			if used > s.mediaDaily {
				return errMediaQuota
			}
			row = r
			return nil
		}
		if !noRows(err) {
			return err
		}
		r, err = scanMedia(tx.QueryRow(ctx, `select `+mediaCols+` from chat_media where uploader_id = $1 and sha256 = $2 and media_type = $3 for update`,
			uid, v.sha, v.kind))
		if err != nil {
			return err
		}
		switch r.status {
		case mediaProcessing:
			return errMediaNotReady
		case mediaBlocked:
			return errMediaBlocked
		case mediaReady:
			_, _, found, err := s.media.Stat(ctx, r.key)
			if err != nil {
				return err
			}
			if found {
				if _, err := tx.Exec(ctx, `update chat_media set updated_at = $2::timestamptz where id = $1`, r.id, now); err != nil {
					return err
				}
				row, dedup = r, true
				return nil
			}
		}
		// pending / failed / ready mà mất object: cấp lại URL trên cùng khoá
		if r.size != v.size {
			return errBad("Tệp cùng nội dung đã khai với kích thước khác")
		}
		row, err = scanMedia(tx.QueryRow(ctx, `update chat_media set mime_type = $2, file_name = $3, width = $4::integer, height = $5::integer,
				duration_ms = $6::integer, waveform = $7::smallint[], thumb_key = null, blurhash = null, status = 'pending', updated_at = $8::timestamptz
			where id = $1 returning `+mediaCols,
			r.id, v.mime, v.fileName, v.width, v.height, v.durationMs, v.waveform, now))
		return err
	})
	if isUnique(err, "uq_chat_media_uploader_id_sha256_media_type") {
		return nil, errMediaNotReady
	}
	if err != nil {
		return nil, err
	}
	out := &MediaUploadOutput{MediaID: row.id, Dedup: dedup}
	if dedup {
		out.Media, err = s.buildDTO(ctx, row, strDeref(row.fileName), false)
		return out, err
	}
	staging := stagingKey(row.key)
	if out.Upload, err = s.presignPut(ctx, staging, row.mime, row.size, now); err != nil {
		return nil, err
	}
	if v.poster != nil {
		if out.PosterUpload, err = s.presignPut(ctx, staging+mediaPosterSuffix, v.poster.Mime, v.poster.Size, now); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// presignPut: URL PUT 15 phút; bỏ Content-Length khỏi header trả client (trình duyệt tự đặt theo blob, header cấm).
func (s *Service) presignPut(ctx context.Context, key, ct string, size int64, now time.Time) (*MediaUploadTarget, error) {
	u, hdr, err := s.media.PresignPut(ctx, key, ct, size, mediaUploadURLTTL)
	if err != nil {
		return nil, err
	}
	h := map[string]string{}
	for k, v := range hdr {
		if !strings.EqualFold(k, "Content-Length") {
			h[k] = v
		}
	}
	if len(h) == 0 {
		h["Content-Type"] = ct
	}
	return &MediaUploadTarget{URL: u, Method: http.MethodPut, Headers: h, ExpiresAt: iso(now.Add(mediaUploadURLTTL))}, nil
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ───────────── POST /chat/media/:id/complete ─────────────

// MediaComplete: chép khoá tạm -> khoá cuối, kiểm kích thước / loại / sha256 / virus, làm ảnh nhỏ, chuyển ready.
// Chỉ người tải gọi được. Gọi lại khi đã ready -> trả DTO (idempotent).
func (s *Service) MediaComplete(ctx context.Context, uid, id int64) (*MediaDTO, error) {
	if err := s.mediaUsable(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, mediaCompleteTO)
	defer cancel()
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	r, err := scanMedia(p.QueryRow(ctx, `update chat_media set status = 'processing', updated_at = $3::timestamptz
		where id = $1 and uploader_id = $2 and status = 'pending' returning `+mediaCols, id, uid, s.now()))
	if noRows(err) {
		r, err = scanMedia(p.QueryRow(ctx, `select `+mediaCols+` from chat_media where id = $1 and uploader_id = $2`, id, uid))
		if noRows(err) {
			return nil, errMediaNotFound
		}
		if err != nil {
			return nil, err
		}
		switch r.status {
		case mediaReady:
			return s.buildDTO(ctx, r, strDeref(r.fileName), false)
		case mediaBlocked:
			return nil, errMediaBlocked
		case mediaFailed:
			return nil, errMediaMismatch
		}
		return nil, errMediaNotReady
	}
	if err != nil {
		return nil, err
	}
	return s.processMedia(ctx, r)
}

// processMedia: phần việc của complete trên dòng đã giành (status = processing).
func (s *Service) processMedia(ctx context.Context, r *mediaRow) (*MediaDTO, error) {
	st := s.media
	final, staging := r.key, stagingKey(r.key)
	revert := func(e error) (*MediaDTO, error) { // lỗi tạm thời: trả về pending để client gọi lại complete
		s.setMediaStatus(ctx, r.id, mediaPending)
		return nil, e
	}
	reject := func(status string, e error) (*MediaDTO, error) { // tệp sai / nhiễm: failed / blocked + xoá mọi object
		s.setMediaStatus(ctx, r.id, status)
		s.removeObjects(context.WithoutCancel(ctx), mediaKeys(final)...)
		return nil, e
	}

	// 1. chép khoá tạm -> khoá cuối (khoá cuối đã có = lần trước chép xong rồi lỗi: làm tiếp)
	_, _, found, err := st.Stat(ctx, final)
	if err != nil {
		return revert(err)
	}
	if !found {
		_, _, sf, err := st.Stat(ctx, staging)
		if err != nil {
			return revert(err)
		}
		if !sf {
			return revert(errMediaNotUploaded)
		}
		if err := st.Copy(ctx, staging, final); err != nil {
			return revert(err)
		}
	}
	if r.typ == MediaVideo {
		_, _, pf, err := st.Stat(ctx, staging+mediaPosterSuffix)
		if err != nil {
			return revert(err)
		}
		if pf {
			if err := st.Copy(ctx, staging+mediaPosterSuffix, final+mediaPosterSuffix); err != nil {
				return revert(err)
			}
		}
	}
	s.removeObjects(ctx, staging, staging+mediaPosterSuffix)

	// 2. kích thước
	size, _, found, err := st.Stat(ctx, final)
	if err != nil {
		return revert(err)
	}
	if !found {
		return revert(errMediaNotUploaded)
	}
	if size != r.size {
		return reject(mediaFailed, errMediaMismatch)
	}

	// 3. loại (dò 512 byte đầu); tệp loại file nhận mọi nội dung
	if r.typ != MediaFile {
		head, err := st.ReadPrefix(ctx, final, 512)
		if err != nil {
			return revert(err)
		}
		sniffed := normalizeMime(http.DetectContentType(head))
		if !sniffOK(r.mime, sniffed) {
			return reject(mediaFailed, errMediaType)
		}
		if r.typ == MediaImage {
			r.mime = sniffed
		}
	}

	// 4. sha256 + quét virus, đọc dạng luồng
	rc, err := st.Open(ctx, final)
	if err != nil {
		return revert(err)
	}
	h := sha256.New()
	clean, err := s.scan.Scan(ctx, io.TeeReader(rc, h), size)
	if err == nil {
		_, err = io.Copy(h, rc) // phần bộ quét chưa đọc
	}
	_ = rc.Close()
	if err != nil {
		logger.Error("chat", "quét / băm tệp chat lỗi:", err.Error())
		return revert(errMediaScanDown)
	}
	if hex.EncodeToString(h.Sum(nil)) != r.sha {
		return reject(mediaFailed, errMediaMismatch)
	}
	if !clean {
		return reject(mediaBlocked, errMediaBlocked)
	}

	// 5. ảnh: kích thước thật, ảnh nhỏ, blurhash; video: ảnh bìa của client
	width, height := r.width, r.height
	var thumbKey, blur *string
	switch r.typ {
	case MediaImage:
		select {
		case s.imgSem <- struct{}{}:
		case <-ctx.Done():
			return revert(ctx.Err())
		}
		data, err := st.Get(ctx, final, s.mediaMaxImage)
		var info *imageInfo
		if err == nil {
			info, err = processImage(data)
		}
		<-s.imgSem
		if errors.Is(err, errImageDecode) {
			return reject(mediaFailed, errMediaType)
		}
		if err != nil {
			return revert(err)
		}
		width, height = &info.width, &info.height
		if info.thumb != nil {
			tk := final + mediaThumbSuffix
			if err := st.Put(ctx, tk, info.thumb, "image/jpeg"); err != nil {
				return revert(err)
			}
			thumbKey = &tk
		}
		if info.blurhash != "" {
			blur = &info.blurhash
		}
	case MediaVideo:
		pk := final + mediaPosterSuffix
		if _, _, pf, err := st.Stat(ctx, pk); err != nil {
			return revert(err)
		} else if pf {
			ok := false
			if data, err := st.Get(ctx, pk, mediaMaxPosterBytes); err == nil {
				if jpg, bh, err := posterJPEG(data); err == nil {
					if bytes.Equal(jpg, data) || st.Put(ctx, pk, jpg, "image/jpeg") == nil {
						ok = true
						thumbKey = &pk
						if bh != "" {
							blur = &bh
						}
					}
				}
			}
			if !ok {
				s.removeObjects(ctx, pk)
			}
		}
	}

	// 6. ready
	done, err := scanMedia(s.mustPool().QueryRow(ctx, `update chat_media set status = 'ready', mime_type = $2, width = $3::integer, height = $4::integer,
			thumb_key = $5, blurhash = $6, updated_at = $7::timestamptz
		where id = $1 and status = 'processing' returning `+mediaCols, r.id, r.mime, width, height, thumbKey, blur, s.now()))
	if noRows(err) {
		return nil, errMediaNotReady
	}
	if err != nil {
		return revert(err)
	}
	return s.buildDTO(ctx, done, strDeref(done.fileName), false)
}

// mustPool: pool đã kiểm ở đầu complete (không lỗi được nữa).
func (s *Service) mustPool() querier {
	p, _ := s.pool()
	return p
}

// setMediaStatus: đổi trạng thái dòng đang processing (kể cả khi ctx của request đã hết hạn).
func (s *Service) setMediaStatus(ctx context.Context, id int64, status string) {
	p, err := s.pool()
	if err != nil {
		return
	}
	c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if _, err := p.Exec(c, `update chat_media set status = $2, updated_at = $3::timestamptz where id = $1 and status = 'processing'`,
		id, status, s.now()); err != nil {
		logger.Error("chat", "đổi trạng thái tệp chat lỗi:", err.Error())
	}
}

// ───────────── GET /chat/media/:id ─────────────

// MediaGet: URL đọc cho người tải hoặc thành viên (đang ở trong) hội thoại có tin dùng tệp; không có quyền -> MEDIA_NOT_FOUND.
// download: tải về (attachment). messageID > 0: tên tải về lấy từ chat_messages.file_name của tin đó (nếu người gọi xem được).
func (s *Service) MediaGet(ctx context.Context, uid, id int64, download bool, messageID int64) (*MediaDTO, error) {
	if s.media == nil {
		return nil, errMediaDisabled
	}
	p, err := s.pool()
	if err != nil {
		return nil, err
	}
	// thành viên đang hoạt động, hoặc dòng chỉ đọc của nhóm đã giải tán (left_at = disbanded_at), của hội thoại có tin dùng
	// tệp hoặc nhóm đang dùng tệp làm ảnh nhóm
	r, err := scanMedia(p.QueryRow(ctx, `select `+mediaCols+` from chat_media md where md.id = $1 and (md.uploader_id = $2 or exists (
			select 1 from chat_messages m join chat_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = $2
				join chat_conversations c on c.id = m.conversation_id
			where m.media_id = md.id and (cm.left_at is null or cm.left_at = c.disbanded_at))
		or exists (select 1 from chat_conversations c join chat_conversation_members cm on cm.conversation_id = c.id and cm.user_id = $2
			where c.avatar_media_id = md.id and (cm.left_at is null or cm.left_at = c.disbanded_at)))`, id, uid))
	if noRows(err) {
		return nil, errMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	name := strDeref(r.fileName)
	if messageID > 0 {
		var fn *string
		err := p.QueryRow(ctx, `select m.file_name from chat_messages m join chat_conversation_members cm on cm.conversation_id = m.conversation_id
				and cm.user_id = $3 join chat_conversations c on c.id = m.conversation_id
			where m.id = $1 and m.media_id = $2 and (cm.left_at is null or cm.left_at = c.disbanded_at)`, messageID, id, uid).Scan(&fn)
		if err != nil && !noRows(err) {
			return nil, err
		}
		if fn != nil && *fn != "" {
			name = *fn
		}
	}
	return s.buildDTO(ctx, r, name, download)
}

// ───────────── Dùng khi gửi / đọc tin ─────────────

// lockSendMedia: trong transaction gửi tin - khoá (for share: janitor bỏ qua dòng này) tệp đính kèm, kiểm chủ / trạng
// thái / loại. Trả MediaDTO (FileName = tên của tệp; tin file tự đặt tên riêng).
func (s *Service) lockSendMedia(ctx context.Context, tx pgx.Tx, uid int64, msgType string, ids []int64) (*MediaDTO, error) {
	if s.media == nil {
		return nil, errMediaDisabled
	}
	if len(ids) != 1 || ids[0] <= 0 {
		return nil, errBad("Tin này cần đúng 1 tệp đính kèm")
	}
	r, err := scanMedia(tx.QueryRow(ctx, `select `+mediaCols+` from chat_media where id = $1 for share`, ids[0]))
	if noRows(err) {
		return nil, errMediaNotFound
	}
	if err != nil {
		return nil, err
	}
	if r.uploader != uid {
		return nil, errMediaNotFound
	}
	if r.status != mediaReady {
		return nil, errMediaNotReady
	}
	if r.typ != msgType {
		return nil, errBad("Loại tin không khớp loại tệp đính kèm")
	}
	return s.buildDTO(ctx, r, strDeref(r.fileName), false)
}

// mediaDTOs: MediaDTO (kèm URL đọc) của nhiều tệp một lượt; máy chủ tắt tệp -> DTO không có url / thumb_url.
// FileName = tên của tệp; tin file ghi đè bằng chat_messages.file_name của chính tin.
func (s *Service) mediaDTOs(ctx context.Context, q querier, ids []int64) (map[int64]*MediaDTO, error) {
	out := map[int64]*MediaDTO{}
	uniq := make([]int64, 0, len(ids))
	seen := map[int64]bool{}
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			uniq = append(uniq, id)
		}
	}
	if len(uniq) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `select `+mediaCols+` from chat_media where id = any($1::bigint[])`, uniq)
	if err != nil {
		return nil, err
	}
	var rs []*mediaRow
	for rows.Next() {
		r, err := scanMedia(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		rs = append(rs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, r := range rs {
		d, err := s.buildDTO(ctx, r, strDeref(r.fileName), false)
		if err != nil {
			return nil, err
		}
		out[r.id] = d
	}
	return out, nil
}

// ───────────── MediaDTO + URL ký ─────────────

// buildDTO: DTO của một dòng; URL đọc chỉ khi đã bật kho tệp và tệp ready.
// Ảnh / video / thoại: inline đúng MIME (đã dò); file: luôn application/octet-stream + attachment.
func (s *Service) buildDTO(ctx context.Context, r *mediaRow, name string, download bool) (*MediaDTO, error) {
	d := &MediaDTO{ID: r.id, Type: r.typ, Mime: r.mime, Size: r.size, FileName: name, Width: r.width, Height: r.height,
		DurationMs: r.durationMs, Waveform: r.waveform, Blurhash: strDeref(r.blurhash), Status: r.status, row: r}
	if s.media == nil || r.status != mediaReady {
		return d, nil
	}
	ct, disp := r.mime, "inline"
	if r.typ == MediaFile {
		ct, disp = mediaOctetStream, contentDisposition("attachment", nameOr(name, r))
	} else if download {
		disp = contentDisposition("attachment", nameOr(name, r))
	}
	u, exp, err := s.signedGet(ctx, r.key, ct, disp)
	if err != nil {
		return nil, err
	}
	d.URL = u
	if r.thumbKey != nil {
		tu, texp, err := s.signedGet(ctx, *r.thumbKey, "image/jpeg", "inline")
		if err != nil {
			return nil, err
		}
		d.ThumbURL = tu
		if texp.Before(exp) {
			exp = texp
		}
	}
	d.ExpiresAt = iso(exp)
	return d, nil
}

// nameOr: tên tải về; không có -> <loại>-<id><đuôi theo MIME>.
func nameOr(name string, r *mediaRow) string {
	if name != "" {
		return name
	}
	ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
		"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "audio/webm": ".webm", "audio/ogg": ".ogg",
		"audio/mp4": ".m4a", "audio/aac": ".aac", "audio/mpeg": ".mp3"}[r.mime]
	return fmt.Sprintf("%s-%d%s", r.typ, r.id, ext)
}

// contentDisposition: kiểu + filename (ASCII thay thế) + filename* dạng UTF-8 mã hoá % (RFC 6266 / 5987).
func contentDisposition(kind, name string) string {
	var ascii, pct strings.Builder
	for _, r := range name {
		if r >= 0x20 && r < 0x7f && r != '"' && r != '\\' {
			ascii.WriteRune(r)
		} else {
			ascii.WriteByte('_')
		}
	}
	for _, b := range []byte(name) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.IndexByte("!#$&+-.^_`|~", b) >= 0 {
			pct.WriteByte(b)
		} else {
			fmt.Fprintf(&pct, "%%%02X", b)
		}
	}
	return fmt.Sprintf(`%s; filename="%s"; filename*=UTF-8''%s`, kind, ascii.String(), pct.String())
}

// Cache URL đã ký theo (kho, khoá, loại, disposition, hạn) trong nửa hạn: cùng một chuỗi URL -> cache trình duyệt trúng.
type signedURL struct {
	url    string
	signed time.Time
}

var mediaURLCache = struct {
	sync.Mutex
	m map[string]signedURL
}{m: map[string]signedURL{}}

// signedGet: presigned GET (cache-control private, max-age = hạn); trả URL + lúc hết hạn.
func (s *Service) signedGet(ctx context.Context, key, ct, disp string) (string, time.Time, error) {
	ttl := s.mediaURLTTL
	now := s.now()
	ck := fmt.Sprintf("%p|%s|%s|%s|%d", s.media, key, ct, disp, ttl)
	mediaURLCache.Lock()
	if e, ok := mediaURLCache.m[ck]; ok && now.Sub(e.signed) >= 0 && now.Sub(e.signed) < ttl/2 {
		mediaURLCache.Unlock()
		return e.url, e.signed.Add(ttl), nil
	}
	mediaURLCache.Unlock()
	u, err := s.media.PresignGet(ctx, key, ttl, ct, disp, fmt.Sprintf("private, max-age=%d", int64(ttl/time.Second)))
	if err != nil {
		return "", time.Time{}, err
	}
	mediaURLCache.Lock()
	if len(mediaURLCache.m) > 20000 {
		for k, e := range mediaURLCache.m {
			if now.Sub(e.signed) >= ttl/2 || now.Sub(e.signed) < 0 {
				delete(mediaURLCache.m, k)
			}
		}
		if len(mediaURLCache.m) > 20000 {
			mediaURLCache.m = map[string]signedURL{}
		}
	}
	mediaURLCache.m[ck] = signedURL{url: u, signed: now}
	mediaURLCache.Unlock()
	return u, now.Add(ttl), nil
}

// ───────────── Janitor ─────────────

// janitorOnce: một lượt dọn (mọi mốc thời gian theo s.now()):
//  1. processing quá 10 phút -> pending (complete chết giữa chừng);
//  2. xoá dòng pending / failed tạo quá 24 giờ (tới lúc đó vẫn tính vào hạn mức) và không đổi trong 2 giờ;
//  3. pending / failed không đổi quá 2 giờ -> failed + xoá object (tối đa 200 dòng / lượt);
//  4. xoá tệp ready không tin nào dùng, không đổi quá 24 giờ, cùng object.
//
// Bước 2-4 bỏ qua dòng còn tin dùng (vd ready mất object được cấp lại URL -> pending) và xoá object TRONG lúc giữ khoá dòng:
// upload-url cấp lại URL trên cùng khoá phải chờ tới khi lượt dọn commit, nên lệnh xoá muộn không trúng tệp vừa tải.
// Một bước lỗi không chặn các bước sau. blocked giữ lại để tải lại cùng nội dung vẫn bị chặn.
func (s *Service) janitorOnce(ctx context.Context) error {
	if s.media == nil {
		return nil
	}
	p, err := s.pool()
	if err != nil {
		return err
	}
	now := s.now()
	var errs []error
	if _, err := p.Exec(ctx, `update chat_media set status = 'pending', updated_at = $1::timestamptz
		where status = 'processing' and updated_at < $2::timestamptz`, now, now.Add(-mediaStuckAfter)); err != nil {
		errs = append(errs, err)
	}
	// step: khoá các dòng theo sel (trả id, object_key), lọc lại dòng còn tin dùng bằng câu mới (gửi tin cần khoá for share
	// trên dòng nên không chen được nữa), xoá object rồi chạy act với $1 = id[] + actArgs.
	step := func(act string, actArgs []any, sel string, args ...any) error {
		return s.inTx(ctx, func(tx pgx.Tx) error {
			var ids []int64
			rows, err := tx.Query(ctx, sel, args...)
			if err != nil {
				return err
			}
			for rows.Next() {
				var id int64
				var k string
				if err := rows.Scan(&id, &k); err != nil {
					rows.Close()
					return err
				}
				ids = append(ids, id)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			if len(ids) == 0 {
				return nil
			}
			rows, err = tx.Query(ctx, `select md.id, md.object_key from chat_media md where md.id = any($1::bigint[])
				and not exists (select 1 from chat_messages m where m.media_id = md.id)
				and not exists (select 1 from chat_conversations c where c.avatar_media_id = md.id)`, ids)
			if err != nil {
				return err
			}
			ids = ids[:0]
			var keys []string
			for rows.Next() {
				var id int64
				var k string
				if err := rows.Scan(&id, &k); err != nil {
					rows.Close()
					return err
				}
				ids = append(ids, id)
				keys = append(keys, mediaKeys(k)...)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			if len(ids) == 0 {
				return nil
			}
			for len(keys) > 0 { // xoá theo lô 1000 khoá
				n := min(len(keys), 1000)
				s.removeObjects(ctx, keys[:n]...)
				keys = keys[n:]
			}
			_, err = tx.Exec(ctx, act, append([]any{ids}, actArgs...)...)
			return err
		})
	}
	// tệp còn tin dùng hoặc đang là ảnh nhóm (avatar_media_id, khoá ngoại restrict) không bao giờ bị dọn
	unused := ` and not exists (select 1 from chat_messages m where m.media_id = md.id)
		and not exists (select 1 from chat_conversations c where c.avatar_media_id = md.id)`
	// xoá dòng quá 24 giờ TRƯỚC bước 3 (bước 3 đặt lại updated_at); dòng vừa được cấp lại URL (updated_at < 2 giờ) chưa xoá
	if err := step(`delete from chat_media where id = any($1::bigint[])`, nil,
		`select md.id, md.object_key from chat_media md where md.status in ('pending', 'failed')
			and md.created_at < $1::timestamptz and md.updated_at < $2::timestamptz`+unused+`
			limit 500 for update of md skip locked`, now.Add(-24*time.Hour), now.Add(-2*time.Hour)); err != nil {
		errs = append(errs, err)
	}
	if err := step(`update chat_media set status = 'failed', updated_at = $2::timestamptz where id = any($1::bigint[])`, []any{now},
		`select md.id, md.object_key from chat_media md where md.status in ('pending', 'failed')
			and md.updated_at < $1::timestamptz`+unused+`
			order by md.updated_at limit 200 for update of md skip locked`, now.Add(-2*time.Hour)); err != nil {
		errs = append(errs, err)
	}
	if err := step(`delete from chat_media where id = any($1::bigint[])`, nil,
		`select md.id, md.object_key from chat_media md where md.status = 'ready' and md.updated_at < $1::timestamptz`+unused+`
			limit 200 for update of md skip locked`, now.Add(-24*time.Hour)); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}
