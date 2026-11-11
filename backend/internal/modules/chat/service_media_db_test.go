package chat

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"strings"
	"sync"
	"testing"
	"time"
)

// Test có database của phần tệp đính kèm (cần migration 0020, kho tệp giả fakeMediaStore).

func shaHex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func randBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

// keyOfURL: khoá object trong URL của kho giả (http://fake/<khoá>?...).
func keyOfURL(t *testing.T, u string) string {
	t.Helper()
	if !strings.HasPrefix(u, "http://fake/") {
		t.Fatalf("URL lạ: %s", u)
	}
	k := strings.TrimPrefix(u, "http://fake/")
	if i := strings.IndexByte(k, '?'); i >= 0 {
		k = k[:i]
	}
	return k
}

func (e *env) uploadURL(u *tu, in MediaUploadInput) *MediaUploadOutput {
	e.t.Helper()
	out, err := e.s.MediaUploadURL(context.Background(), u.id, in)
	if err != nil {
		e.t.Fatalf("upload-url %+v: %v", in, err)
	}
	return out
}

// putAndComplete: xin URL, "PUT" byte lên khoá tạm của kho giả, complete. Trả DTO.
func (e *env) putAndComplete(u *tu, in MediaUploadInput, body []byte) *MediaDTO {
	e.t.Helper()
	out := e.uploadURL(u, in)
	if out.Upload == nil {
		e.t.Fatalf("không có upload: %+v", out)
	}
	e.media.putObject(keyOfURL(e.t, out.Upload.URL), body)
	md, err := e.s.MediaComplete(context.Background(), u.id, out.MediaID)
	if err != nil {
		e.t.Fatalf("complete: %v", err)
	}
	return md
}

func imageIn(body []byte, mime string) MediaUploadInput {
	return MediaUploadInput{Type: MediaImage, Mime: mime, Size: int64(len(body)), SHA256: shaHex(body)}
}

func fileIn(body []byte, name string) MediaUploadInput {
	return MediaUploadInput{Type: MediaFile, Mime: "application/pdf", Size: int64(len(body)), SHA256: shaHex(body), FileName: name}
}

// mediaState: trạng thái + các khoá của dòng chat_media.
type mediaState struct {
	status, mime, key string
	fileName          *string
	thumbKey          *string
	blurhash          *string
	width, height     *int
	updatedAt         time.Time
}

func (e *env) mediaRow(id int64) *mediaState {
	e.t.Helper()
	m := &mediaState{}
	if err := e.pool.QueryRow(context.Background(), `select status, mime_type, object_key, file_name, thumb_key, blurhash, width, height, updated_at
		from chat_media where id = $1`, id).Scan(&m.status, &m.mime, &m.key, &m.fileName, &m.thumbKey, &m.blurhash, &m.width, &m.height, &m.updatedAt); err != nil {
		e.t.Fatalf("đọc chat_media %d: %v", id, err)
	}
	return m
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
}

// mediaMsg: chèn thẳng một tin dùng tệp (gói MSG lo đường gửi thật qua SendMessage).
func (e *env) mediaMsg(conv int64, sender *tu, mediaID int64, typ string, fileName *string) int64 {
	e.t.Helper()
	var id int64
	if err := e.pool.QueryRow(context.Background(), `with c as (
			update chat_conversations set last_seq = last_seq + 1, last_message_at = clock_timestamp() where id = $1 returning id, last_seq, last_message_at)
		insert into chat_messages (conversation_id, seq, client_msg_id, sender_id, message_type, content, media_id, file_name, created_at)
		select c.id, c.last_seq, gen_random_uuid(), $2, $3, '', $4, $5, c.last_message_at from c returning id`,
		conv, sender.id, typ, mediaID, fileName).Scan(&id); err != nil {
		e.t.Fatalf("chèn tin tệp: %v", err)
	}
	return id
}

// recStore: ghi lại tham số PresignPut.
type recStore struct {
	*fakeMediaStore
	mu   sync.Mutex
	puts []recPut
}

type recPut struct {
	key, ct string
	size    int64
	ttl     time.Duration
}

func (r *recStore) PresignPut(ctx context.Context, key, ct string, size int64, ttl time.Duration) (string, map[string]string, error) {
	r.mu.Lock()
	r.puts = append(r.puts, recPut{key, ct, size, ttl})
	r.mu.Unlock()
	return r.fakeMediaStore.PresignPut(ctx, key, ct, size, ttl)
}

func TestMediaUploadURLDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	rec := &recStore{fakeMediaStore: e.media}
	e.s.media = rec
	lan := e.user("Lan")
	body := pngBytes(64, 32)
	out := e.uploadURL(lan, imageIn(body, "image/png; charset=x"))
	if out.MediaID <= 0 || out.Dedup || out.Upload == nil || out.Upload.Method != "PUT" || out.Media != nil || out.PosterUpload != nil {
		t.Fatalf("upload-url: %+v", out)
	}
	row := e.mediaRow(out.MediaID)
	if row.status != mediaPending || !strings.HasPrefix(row.key, "chat/m/u"+itoa(lan.id)+"/") || row.mime != "image/png" {
		t.Fatalf("dòng mới: %+v", row)
	}
	staging := keyOfURL(t, out.Upload.URL)
	if staging != stagingKey(row.key) || !strings.HasPrefix(staging, "chat/in/") {
		t.Errorf("URL phải ở khoá tạm: %s / %s", staging, row.key)
	}
	if len(rec.puts) != 1 || rec.puts[0] != (recPut{staging, "image/png", int64(len(body)), 15 * time.Minute}) {
		t.Errorf("PresignPut phải ký Content-Type + Content-Length: %+v", rec.puts)
	}
	if out.Upload.Headers["Content-Type"] != "image/png" || out.Upload.Headers["Content-Length"] != "" {
		t.Errorf("header trả client: %v", out.Upload.Headers)
	}
	if out.Upload.ExpiresAt != iso(e.clk.now().Add(15*time.Minute)) {
		t.Errorf("expires_at: %s", out.Upload.ExpiresAt)
	}
	// video có poster: hai URL, poster ở <khoá tạm>.p.jpg
	vb := fixture(t, "video.mp4")
	out = e.uploadURL(lan, MediaUploadInput{Type: MediaVideo, Mime: "video/mp4", Size: int64(len(vb)), SHA256: shaHex(vb),
		Poster: &MediaPosterInput{Mime: "image/jpeg", Size: 1000}})
	if out.PosterUpload == nil || keyOfURL(t, out.PosterUpload.URL) != keyOfURL(t, out.Upload.URL)+".p.jpg" ||
		out.PosterUpload.Headers["Content-Type"] != "image/jpeg" {
		t.Errorf("poster: %+v", out.PosterUpload)
	}
}

func TestMediaDedupDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")
	body := pngBytes(40, 20)
	md := e.putAndComplete(lan, imageIn(body, "image/png"), body)
	e.clk.add(time.Minute)
	out := e.uploadURL(lan, imageIn(body, "image/png"))
	if !out.Dedup || out.MediaID != md.ID || out.Upload != nil || out.Media == nil || out.Media.URL == "" || out.Media.Status != mediaReady {
		t.Fatalf("dedup sau ready: %+v", out)
	}
	if r := e.mediaRow(md.ID); r.updatedAt.Sub(e.clk.now()).Abs() > time.Microsecond {
		t.Errorf("updated_at chưa đổi: %v / %v", r.updatedAt, e.clk.now())
	}
	// pending: cùng id, URL mới, cập nhật mime / tên
	doc := randBytes(300)
	first := e.uploadURL(lan, fileIn(doc, "a.pdf"))
	in := fileIn(doc, "b.pdf")
	in.Mime = "text/plain"
	again := e.uploadURL(lan, in)
	if again.MediaID != first.MediaID || again.Dedup || again.Upload == nil {
		t.Fatalf("dedup pending: %+v / %+v", first, again)
	}
	if r := e.mediaRow(first.MediaID); r.mime != "text/plain" || r.fileName == nil || *r.fileName != "b.pdf" {
		t.Errorf("pending cấp lại: %+v", r)
	}
	// cùng hash khác kích thước
	in.Size++
	_, err := e.s.MediaUploadURL(ctx, lan.id, in)
	wantCode(t, "khác kích thước", err, CodeBadRequest)
	// người khác cùng nội dung: dòng mới
	other := e.uploadURL(binh, imageIn(body, "image/png"))
	if other.MediaID == md.ID || other.Dedup {
		t.Errorf("người khác dùng chung tệp: %+v", other)
	}
	// blocked
	e.exec(`update chat_media set status = 'blocked' where id = $1`, other.MediaID)
	_, err = e.s.MediaUploadURL(ctx, binh.id, imageIn(body, "image/png"))
	wantCode(t, "blocked", err, CodeMediaBlocked)
	// processing
	e.exec(`update chat_media set status = 'processing' where id = $1`, first.MediaID)
	_, err = e.s.MediaUploadURL(ctx, lan.id, fileIn(doc, "a.pdf"))
	wantCode(t, "processing", err, CodeMediaNotReady)
	// ready nhưng mất object: cấp lại URL
	e.media.Remove(ctx, e.mediaRow(md.ID).key)
	if out := e.uploadURL(lan, imageIn(body, "image/png")); out.Dedup || out.MediaID != md.ID || out.Upload == nil {
		t.Errorf("ready mất object: %+v", out)
	}
	// hai yêu cầu giống nhau cùng lúc: một id, không lỗi
	same := randBytes(500)
	var wg sync.WaitGroup
	ids := make([]int64, 4)
	errs := make([]error, 4)
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			o, err := e.s.MediaUploadURL(ctx, lan.id, fileIn(same, "c.pdf"))
			errs[i] = err
			if o != nil {
				ids[i] = o.MediaID
			}
		}(i)
	}
	wg.Wait()
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] || ids[0] == 0 {
			t.Fatalf("đồng thời: %v %v", ids, errs)
		}
	}
}

func TestMediaLimitsDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan := e.user("Lan")
	_, err := e.s.MediaUploadURL(ctx, lan.id, MediaUploadInput{Type: MediaImage, Mime: "image/png", Size: 26 << 20, SHA256: shaHex([]byte("x"))})
	wantCode(t, "ảnh 26 MB", err, CodeMediaTooLarge)
	d := 1000
	_, err = e.s.MediaUploadURL(ctx, lan.id, MediaUploadInput{Type: MediaVoice, Mime: "audio/webm", Size: 11 << 20, SHA256: shaHex([]byte("x")), DurationMs: &d, Waveform: []int{1}})
	wantCode(t, "thoại 11 MB", err, CodeMediaTooLarge)
	_, err = e.s.MediaUploadURL(ctx, lan.id, MediaUploadInput{Type: MediaVoice, Mime: "audio/webm", Size: 100, SHA256: shaHex([]byte("x")), Waveform: []int{1}})
	wantCode(t, "thoại thiếu thời lượng", err, CodeBadRequest)
	// hạn mức 24 giờ: tính cả tệp failed
	e.s.mediaDaily = 1000
	a := e.uploadURL(lan, fileIn(randBytes(600), "a.pdf"))
	e.exec(`update chat_media set status = 'failed' where id = $1`, a.MediaID)
	_, err = e.s.MediaUploadURL(ctx, lan.id, fileIn(randBytes(600), "b.pdf"))
	wantCode(t, "hạn mức", err, CodeMediaQuota)
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_media where uploader_id = $1`, lan.id).Scan(&n)
	if n != 1 {
		t.Errorf("vượt hạn mức không được để lại dòng: %d", n)
	}
	// quá 24 giờ thì không còn tính
	e.clk.add(25 * time.Hour)
	e.uploadURL(lan, fileIn(randBytes(600), "c.pdf"))
	// kho đang khởi động
	e.media.mu.Lock()
	e.media.notReady = true
	e.media.mu.Unlock()
	_, err = e.s.MediaUploadURL(ctx, lan.id, fileIn(randBytes(10), "d.pdf"))
	wantCode(t, "kho chưa sẵn sàng", err, CodeUnavailable)
	_, err = e.s.MediaComplete(ctx, lan.id, a.MediaID)
	wantCode(t, "complete khi kho chưa sẵn sàng", err, CodeUnavailable)
}

func TestMediaUploadRateLimitDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	lan := e.user("Lan")
	var err error
	for i := 0; i < 61 && err == nil; i++ {
		_, err = e.s.MediaUploadURL(context.Background(), lan.id, MediaUploadInput{Type: "sticker"})
		if i < 60 {
			wantCode(t, "loại sai", err, CodeBadRequest)
			err = nil
		}
	}
	wantCode(t, "61 lần / phút", err, CodeRateLimit)
}

func TestMediaCompleteDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")

	// chưa PUT: MEDIA_NOT_UPLOADED, về pending
	body := pngBytes(30, 30)
	out := e.uploadURL(lan, imageIn(body, "image/png"))
	_, err := e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "chưa tải lên", err, CodeMediaNotUploaded)
	if r := e.mediaRow(out.MediaID); r.status != mediaPending {
		t.Errorf("phải về pending: %s", r.status)
	}
	// người khác
	_, err = e.s.MediaComplete(ctx, binh.id, out.MediaID)
	wantCode(t, "tệp của người khác", err, CodeMediaNotFound)
	_, err = e.s.MediaComplete(ctx, lan.id, 1<<50)
	wantCode(t, "không có", err, CodeMediaNotFound)

	// sai kích thước: failed, xoá object
	bad := pngBytes(32, 30)
	in := imageIn(bad, "image/png")
	in.Size = int64(len(bad)) + 1
	out = e.uploadURL(lan, in)
	e.media.putObject(keyOfURL(t, out.Upload.URL), bad)
	_, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "sai kích thước", err, CodeMediaMismatch)
	r := e.mediaRow(out.MediaID)
	if r.status != mediaFailed || e.media.has(r.key) || e.media.has(stagingKey(r.key)) {
		t.Errorf("sai kích thước: %+v, còn object %v %v", r, e.media.has(r.key), e.media.has(stagingKey(r.key)))
	}
	_, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "complete lại tệp failed", err, CodeMediaMismatch)

	// sai sha256
	body2 := pngBytes(31, 30)
	in = imageIn(body2, "image/png")
	in.SHA256 = shaHex([]byte("nội dung khác"))
	in.Size = int64(len(body2))
	out = e.uploadURL(lan, in)
	e.media.putObject(keyOfURL(t, out.Upload.URL), body2)
	_, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "sai sha256", err, CodeMediaMismatch)

	// HTML giả JPEG
	html := fixture(t, "html-as.jpg")
	out = e.uploadURL(lan, imageIn(html, "image/jpeg"))
	e.media.putObject(keyOfURL(t, out.Upload.URL), html)
	_, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "HTML giả ảnh", err, CodeMediaType)
	if r := e.mediaRow(out.MediaID); r.status != mediaFailed || e.media.has(r.key) {
		t.Errorf("HTML giả ảnh: %+v", r)
	}

	// khai PNG nhưng là JPEG: ready, mime theo kết quả dò
	jb := jpegBytes(50, 40)
	md := e.putAndComplete(lan, imageIn(jb, "image/png"), jb)
	if md.Status != mediaReady || md.Mime != "image/jpeg" || *md.Width != 50 || *md.Height != 40 || md.ThumbURL != "" || md.Blurhash == "" {
		t.Errorf("JPEG khai PNG: %+v", md)
	}

	// PNG thật 1000x500
	pb := pngBytes(1000, 500)
	out = e.uploadURL(lan, imageIn(pb, "image/png"))
	staging := keyOfURL(t, out.Upload.URL)
	e.media.putObject(staging, pb)
	md, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	if err != nil {
		t.Fatal(err)
	}
	r = e.mediaRow(md.ID)
	if md.Status != mediaReady || *md.Width != 1000 || *md.Height != 500 || len(md.Blurhash) != 28 || md.URL == "" || md.ThumbURL == "" ||
		md.ExpiresAt != iso(e.clk.now().Add(time.Hour)) {
		t.Fatalf("PNG 1000x500: %+v", md)
	}
	if e.media.has(staging) || !e.media.has(r.key) || r.thumbKey == nil || *r.thumbKey != r.key+".t.jpg" {
		t.Errorf("object sau complete: tạm %v, cuối %v, ảnh nhỏ %v", e.media.has(staging), e.media.has(r.key), r.thumbKey)
	}
	tb, _ := e.media.Get(ctx, *r.thumbKey, 1<<20)
	if c, f, err := image.DecodeConfig(bytes.NewReader(tb)); err != nil || f != "jpeg" || c.Width != 320 || c.Height != 160 {
		t.Errorf("ảnh nhỏ: %+v %s %v", c, f, err)
	}
	if keyOfURL(t, md.URL) != r.key || !strings.Contains(md.URL, "response-content-disposition=inline") ||
		!strings.Contains(md.URL, "response-content-type=image%2Fpng") || !strings.Contains(md.URL, "max-age%3D3600") {
		t.Errorf("URL đọc: %s", md.URL)
	}
	// complete lần 2: trả lại DTO (idempotent), URL giữ nguyên (cache)
	md2, err := e.s.MediaComplete(ctx, lan.id, md.ID)
	if err != nil || md2.ID != md.ID || md2.Status != mediaReady || md2.URL != md.URL {
		t.Errorf("complete lần 2: %+v %v", md2, err)
	}
	// đang processing (lần gọi khác đang chạy)
	vb := fixture(t, "video.mp4")
	out = e.uploadURL(lan, MediaUploadInput{Type: MediaVideo, Mime: "video/mp4", Size: int64(len(vb)), SHA256: shaHex(vb), Poster: &MediaPosterInput{Mime: "image/jpeg", Size: 100}})
	e.exec(`update chat_media set status = 'processing' where id = $1`, out.MediaID)
	_, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "đang processing", err, CodeMediaNotReady)
	e.exec(`update chat_media set status = 'pending' where id = $1`, out.MediaID)

	// video + poster
	poster := jpegBytes(64, 36)
	e.media.putObject(keyOfURL(t, out.Upload.URL), vb)
	e.media.putObject(keyOfURL(t, out.PosterUpload.URL), poster)
	md, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	if err != nil {
		t.Fatal(err)
	}
	r = e.mediaRow(md.ID)
	if md.ThumbURL == "" || md.Blurhash == "" || r.thumbKey == nil || *r.thumbKey != r.key+".p.jpg" || e.media.has(stagingKey(r.key)+".p.jpg") {
		t.Errorf("video + poster: %+v %+v", md, r)
	}
	// video, poster hỏng: bỏ poster
	vb2 := append(append([]byte{}, vb...), 1, 2, 3)
	out = e.uploadURL(lan, MediaUploadInput{Type: MediaVideo, Mime: "video/mp4", Size: int64(len(vb2)), SHA256: shaHex(vb2), Poster: &MediaPosterInput{Mime: "image/jpeg", Size: 5}})
	e.media.putObject(keyOfURL(t, out.Upload.URL), vb2)
	e.media.putObject(keyOfURL(t, out.PosterUpload.URL), []byte("hỏng"))
	md, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	if r := e.mediaRow(out.MediaID); err != nil || md.ThumbURL != "" || r.thumbKey != nil || e.media.has(r.key+".p.jpg") {
		t.Errorf("poster hỏng: %+v %v", md, err)
	}

	// đã chép xong rồi chết (khoá cuối có, khoá tạm không): làm tiếp được
	fb := randBytes(1234)
	out = e.uploadURL(lan, fileIn(fb, "hợp đồng.pdf"))
	e.media.putObject(e.mediaRow(out.MediaID).key, fb)
	md, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	if err != nil || md.Status != mediaReady || md.FileName != "hợp đồng.pdf" ||
		!strings.Contains(md.URL, "response-content-type=application%2Foctet-stream") || !strings.Contains(md.URL, "attachment") {
		t.Errorf("làm tiếp sau khi chép: %+v %v", md, err)
	}
	// thoại
	ogg := fixture(t, "firefox-audio.ogg")
	dur := 12345
	md = e.putAndComplete(lan, MediaUploadInput{Type: MediaVoice, Mime: "audio/ogg;codecs=opus", Size: int64(len(ogg)), SHA256: shaHex(ogg),
		DurationMs: &dur, Waveform: []int{0, 10, 255}}, ogg)
	if md.Mime != "audio/ogg" || *md.DurationMs != 12345 || len(md.Waveform) != 3 || md.Waveform[2] != 255 {
		t.Errorf("thoại: %+v", md)
	}
}

func TestMediaCompleteInfectedDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true, scanInfected: true})
	ctx := context.Background()
	lan := e.user("Lan")
	vb := fixture(t, "video.mp4")
	out := e.uploadURL(lan, MediaUploadInput{Type: MediaVideo, Mime: "video/mp4", Size: int64(len(vb)), SHA256: shaHex(vb), Poster: &MediaPosterInput{Mime: "image/jpeg", Size: 10}})
	e.media.putObject(keyOfURL(t, out.Upload.URL), vb)
	e.media.putObject(keyOfURL(t, out.PosterUpload.URL), jpegBytes(10, 10))
	_, err := e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "nhiễm virus", err, CodeMediaBlocked)
	r := e.mediaRow(out.MediaID)
	if r.status != mediaBlocked {
		t.Errorf("trạng thái: %s", r.status)
	}
	for _, k := range mediaKeys(r.key) {
		if e.media.has(k) {
			t.Errorf("còn object %s", k)
		}
	}
	_, err = e.s.MediaComplete(ctx, lan.id, out.MediaID)
	wantCode(t, "complete lại tệp bị chặn", err, CodeMediaBlocked)
	_, err = e.s.MediaUploadURL(ctx, lan.id, MediaUploadInput{Type: MediaVideo, Mime: "video/mp4", Size: int64(len(vb)), SHA256: shaHex(vb)})
	wantCode(t, "tải lại tệp bị chặn", err, CodeMediaBlocked)
}

func TestMediaGetDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan, binh, chi := e.user("Lan"), e.user("Bình"), e.user("Chi")
	e.friends(lan, binh)
	g, err := e.s.CreateGroup(ctx, lan.id, "Công trình A", []int64{binh.id})
	if err != nil {
		t.Fatal(err)
	}
	fid := e.readyMedia(lan.id, MediaFile)
	img := e.readyMedia(lan.id, MediaImage)
	// người tải đọc được trước khi gửi
	md, err := e.s.MediaGet(ctx, lan.id, fid, false, 0)
	if err != nil || md.FileName != "tai-lieu.pdf" || !strings.Contains(md.URL, "response-content-type=application%2Foctet-stream") ||
		!strings.Contains(md.URL, "attachment") {
		t.Fatalf("người tải: %+v %v", md, err)
	}
	_, err = e.s.MediaGet(ctx, binh.id, fid, false, 0)
	wantCode(t, "chưa gửi", err, CodeMediaNotFound)
	name := "b.pdf"
	mid := e.mediaMsg(g.ID, lan, fid, MediaFile, &name)
	e.mediaMsg(g.ID, lan, img, MediaImage, nil)
	// thành viên đọc được sau khi gửi; tên tải về theo tin
	md, err = e.s.MediaGet(ctx, binh.id, fid, true, mid)
	if err != nil || md.FileName != "b.pdf" || !strings.Contains(md.URL, "b.pdf") {
		t.Fatalf("thành viên: %+v %v", md, err)
	}
	md, err = e.s.MediaGet(ctx, binh.id, img, false, 0)
	if err != nil || !strings.Contains(md.URL, "disposition=inline") || !strings.Contains(md.URL, "response-content-type=image%2Fpng") {
		t.Fatalf("ảnh inline: %+v %v", md, err)
	}
	md, err = e.s.MediaGet(ctx, binh.id, img, true, 0)
	if err != nil || !strings.Contains(md.URL, "attachment") || !strings.Contains(md.URL, "image-"+itoa(img)+".png") {
		t.Fatalf("ảnh tải về: %+v %v", md, err)
	}
	_, err = e.s.MediaGet(ctx, chi.id, img, false, 0)
	wantCode(t, "người ngoài", err, CodeMediaNotFound)
	// message_id của tin người gọi không xem được: dùng tên của tệp
	if md, err = e.s.MediaGet(ctx, lan.id, fid, true, 1<<50); err != nil || md.FileName != "tai-lieu.pdf" {
		t.Errorf("message_id lạ: %+v %v", md, err)
	}
	if err := e.s.RemoveMember(ctx, binh.id, g.ID, binh.id); err != nil {
		t.Fatal(err)
	}
	_, err = e.s.MediaGet(ctx, binh.id, img, false, 0)
	wantCode(t, "đã rời nhóm", err, CodeMediaNotFound)
	// mediaDTOs một lượt
	m, err := e.s.mediaDTOs(ctx, e.pool, []int64{fid, img, fid, 1 << 50})
	if err != nil || len(m) != 2 || m[fid].URL == "" || m[img].Type != MediaImage {
		t.Errorf("mediaDTOs: %v %v", m, err)
	}
	// tắt tệp: DTO vẫn có, không có URL
	e.s.media = nil
	m, err = e.s.mediaDTOs(ctx, e.pool, []int64{img})
	if err != nil || len(m) != 1 || m[img].URL != "" || m[img].Status != mediaReady {
		t.Errorf("mediaDTOs khi tắt tệp: %v %v", m, err)
	}
}

func TestLockSendMediaDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")
	img := e.readyMedia(lan.id, MediaImage)
	voice := e.readyMedia(lan.id, MediaVoice)
	pending := e.uploadURL(lan, fileIn(randBytes(20), "x.pdf")).MediaID
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	md, err := e.s.lockSendMedia(ctx, tx, lan.id, MediaImage, []int64{img})
	if err != nil || md.ID != img || md.URL == "" {
		t.Fatalf("khoá ảnh: %+v %v", md, err)
	}
	if md, err = e.s.lockSendMedia(ctx, tx, lan.id, MediaVoice, []int64{voice}); err != nil || *md.DurationMs != 12000 || len(md.Waveform) != 4 {
		t.Fatalf("khoá thoại: %+v %v", md, err)
	}
	for _, c := range []struct {
		uid  int64
		typ  string
		ids  []int64
		code string
	}{
		{binh.id, MediaImage, []int64{img}, CodeMediaNotFound},
		{lan.id, MediaImage, []int64{1 << 50}, CodeMediaNotFound},
		{lan.id, MediaFile, []int64{pending}, CodeMediaNotReady},
		{lan.id, MediaVideo, []int64{img}, CodeBadRequest},
		{lan.id, MediaImage, []int64{img, voice}, CodeBadRequest},
		{lan.id, MediaImage, nil, CodeBadRequest},
	} {
		_, err := e.s.lockSendMedia(ctx, tx, c.uid, c.typ, c.ids)
		wantCode(t, "lockSendMedia", err, c.code)
	}
}

func TestMediaJanitorDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	ctx := context.Background()
	lan, binh := e.user("Lan"), e.user("Bình")
	e.friends(lan, binh)
	g, err := e.s.CreateGroup(ctx, lan.id, "Nhóm dọn", []int64{binh.id})
	if err != nil {
		t.Fatal(err)
	}
	now := e.clk.now()
	stuck := e.uploadURL(lan, fileIn(randBytes(10), "a.pdf")).MediaID
	e.exec(`update chat_media set status = 'processing', updated_at = $2::timestamptz where id = $1`, stuck, now.Add(-11*time.Minute))
	fresh := e.uploadURL(lan, fileIn(randBytes(11), "fresh.pdf")).MediaID
	oldOut := e.uploadURL(lan, fileIn(randBytes(12), "b.pdf"))
	old := oldOut.MediaID
	e.media.putObject(keyOfURL(t, oldOut.Upload.URL), randBytes(12))
	e.exec(`update chat_media set updated_at = $2::timestamptz where id = $1`, old, now.Add(-3*time.Hour))
	used := e.readyMedia(lan.id, MediaImage)
	e.mediaMsg(g.ID, lan, used, MediaImage, nil)
	unused := e.readyMedia(lan.id, MediaFile)
	recent := e.readyMedia(lan.id, MediaVoice)
	blocked := e.readyMedia(lan.id, MediaVideo)
	e.exec(`update chat_media set status = 'blocked' where id = $1`, blocked)
	e.exec(`update chat_media set updated_at = $2::timestamptz, created_at = $2::timestamptz where id = any($1::bigint[])`,
		[]int64{used, unused, blocked}, now.Add(-25*time.Hour))
	unusedKey := e.mediaRow(unused).key

	if err := e.s.janitorOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if r := e.mediaRow(stuck); r.status != mediaPending {
		t.Errorf("processing treo: %s", r.status)
	}
	if r := e.mediaRow(fresh); r.status != mediaPending {
		t.Errorf("pending mới: %s", r.status)
	}
	r := e.mediaRow(old)
	if r.status != mediaFailed || e.media.has(stagingKey(r.key)) {
		t.Errorf("pending cũ: %s, còn khoá tạm %v", r.status, e.media.has(stagingKey(r.key)))
	}
	if e.mediaRow(used).status != mediaReady || e.mediaRow(recent).status != mediaReady || e.mediaRow(blocked).status != mediaBlocked {
		t.Error("tệp đang dùng / mới / bị chặn phải giữ")
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_media where id = $1`, unused).Scan(&n)
	if n != 0 || e.media.has(unusedKey) {
		t.Errorf("tệp ready không ai dùng quá 24 giờ phải xoá: %d %v", n, e.media.has(unusedKey))
	}
	// 24 giờ sau khi tạo: dòng failed / pending bị xoá
	e.exec(`update chat_media set created_at = $2::timestamptz, updated_at = $2::timestamptz where id = $1`, old, now.Add(-25*time.Hour))
	// dòng còn tin dùng bị đặt lại pending (mất object) quá 24 giờ: bỏ qua, không làm hỏng cả lượt dọn (FK RESTRICT)
	refd := e.readyMedia(lan.id, MediaImage)
	e.mediaMsg(g.ID, lan, refd, MediaImage, nil)
	e.exec(`update chat_media set status = 'pending', created_at = $2::timestamptz, updated_at = $2::timestamptz where id = $1`, refd, now.Add(-25*time.Hour))
	if err := e.s.janitorOnce(ctx); err != nil {
		t.Fatal(err)
	}
	_ = e.pool.QueryRow(ctx, `select count(*) from chat_media where id = $1`, old).Scan(&n)
	if n != 0 {
		t.Error("dòng failed quá 24 giờ phải xoá")
	}
	if e.mediaRow(used).status != mediaReady || e.mediaRow(fresh).status != mediaPending {
		t.Error("lượt 2 không được đụng tệp đang dùng / mới")
	}
	if e.mediaRow(refd).status != mediaPending {
		t.Error("dòng pending còn tin dùng phải giữ nguyên")
	}
}

// Route REST /chat/media/... qua gin: thân sai -> BAD_REQUEST, luồng upload-url -> complete -> get.
func TestMediaHandlersDB(t *testing.T) {
	e := newEnv(t, envOpt{media: true})
	r := engineFor(e.s)
	lan := e.user("Lan")
	w := call(r, "GET", "/api/v1/chat/media/config", lan.token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"enabled":true,"max_bytes":{"image":26214400,"video":104857600,"file":104857600,"voice":10485760}`) ||
		!strings.Contains(w.Body.String(), `"denied_ext":[".exe"`) {
		t.Fatalf("config: %d %s", w.Code, w.Body.String())
	}
	body := pngBytes(20, 10)
	w = call(r, "POST", "/api/v1/chat/media/upload-url", lan.token, `{"type":"image","mime":"image/png","size":`+itoa(int64(len(body)))+`,"sha256":"`+shaHex(body)+`"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"dedup":false,"upload":{"url":"http://fake/chat/in/`) {
		t.Fatalf("upload-url: %d %s", w.Code, w.Body.String())
	}
	var id int64
	_ = e.pool.QueryRow(context.Background(), `select id from chat_media where uploader_id = $1`, lan.id).Scan(&id)
	e.media.putObject(stagingKey(e.mediaRow(id).key), body)
	w = call(r, "POST", "/api/v1/chat/media/"+itoa(id)+"/complete", lan.token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `{"ok":true,"result":{"media":{"id":`+itoa(id)+`,"type":"image","mime":"image/png"`) {
		t.Fatalf("complete: %d %s", w.Code, w.Body.String())
	}
	w = call(r, "GET", "/api/v1/chat/media/"+itoa(id)+"?download=1", lan.token, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"ready","url":"http://fake/`) || !strings.Contains(w.Body.String(), "attachment") {
		t.Fatalf("get: %d %s", w.Code, w.Body.String())
	}
	for _, c := range []struct{ method, path, body, code string }{
		{"POST", "/api/v1/chat/media/upload-url", `{"type":"image","mime":"image/heic","size":1,"sha256":"` + shaHex(body) + `"}`, `"code":"MEDIA_TYPE"`},
		{"POST", "/api/v1/chat/media/upload-url", `{"type":1}`, `"code":"BAD_REQUEST"`},
		{"POST", "/api/v1/chat/media/x/complete", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/media/" + itoa(id) + "?download=2", "", `"code":"BAD_REQUEST"`},
		{"GET", "/api/v1/chat/media/" + itoa(1<<50), "", `"code":"MEDIA_NOT_FOUND"`},
	} {
		if w := call(r, c.method, c.path, lan.token, c.body); !strings.Contains(w.Body.String(), c.code) {
			t.Errorf("%s %s: %d %s", c.method, c.path, w.Code, w.Body.String())
		}
	}
	if w := call(r, "GET", "/api/v1/chat/media/"+itoa(1<<50), lan.token, ""); w.Code != 404 {
		t.Errorf("MEDIA_NOT_FOUND phải là 404: %d", w.Code)
	}
}
