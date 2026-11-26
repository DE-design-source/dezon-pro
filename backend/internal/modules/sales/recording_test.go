package sales

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/gemini"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ---- đồ giả cho hội thoại ghi lại ----

func (f *fakeRepo) ListRecordings(ctx context.Context, leadID float64) ([]*omap.Map, error) {
	return listOf(f.recs, leadID, func(a, b *omap.Map) bool { return jsval.ToNumber(a.Val("id")) > jsval.ToNumber(b.Val("id")) }), nil
}
func (f *fakeRepo) GetRecording(ctx context.Context, id float64) (*omap.Map, error) {
	if r := f.recs[id]; r != nil {
		return r.Clone(), nil
	}
	return nil, nil
}
func (f *fakeRepo) InsertRecording(ctx context.Context, row *omap.Map) (*omap.Map, error) {
	if f.recs == nil {
		f.recs = map[float64]*omap.Map{}
	}
	f.recID++
	r := row.Clone().Set("id", f.recID)
	f.recs[f.recID] = r
	return r.Clone(), nil
}
func (f *fakeRepo) UpdateRecording(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	r := f.recs[id]
	if r == nil {
		return nil, nil
	}
	patch.Each(func(k string, v any) { r.Set(k, v) })
	return r.Clone(), nil
}
func (f *fakeRepo) UpdateRecordingIf(ctx context.Context, id float64, stamp string, patch *omap.Map) (*omap.Map, error) {
	r := f.recs[id]
	if r == nil || jsval.Str(r.Val("trang_thai")) != "processing" || jsval.Str(r.Val("cap_nhat")) != stamp {
		return nil, nil
	}
	return f.UpdateRecording(ctx, id, patch)
}
func (f *fakeRepo) DeleteRecording(ctx context.Context, id float64) (int, error) {
	if f.recs[id] == nil {
		return 0, nil
	}
	delete(f.recs, id)
	return 1, nil
}
func (f *fakeRepo) RecordingAudio(ctx context.Context, leadID float64) ([]string, error) {
	out := []string{}
	for _, r := range f.recs {
		if jsval.ToNumber(r.Val("khach_hang_id")) == leadID && jsval.Str(r.Val("am_thanh")) != "" {
			out = append(out, jsval.Str(r.Val("am_thanh")))
		}
	}
	return out, nil
}
func (f *fakeRepo) UpdateActivity(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error) {
	for _, r := range f.acts {
		if jsval.ToNumber(r.Val("id")) == id {
			patch.Each(func(k string, v any) { r.Set(k, v) })
			return r, nil
		}
	}
	return nil, nil
}

func (f *fakeAI) GenerateJSONParts(ctx context.Context, model, system string, parts []gemini.Part) (string, error) {
	f.system, f.model, f.parts = system, model, parts
	f.calls++
	return f.text, f.err
}

type fakeStore struct{ files map[string][]byte }

func (st *fakeStore) Upload(ctx context.Context, buf []byte, p, ct string) (string, error) {
	st.files[p] = append([]byte(nil), buf...)
	return st.PublicURL(p), nil
}
func (st *fakeStore) ReadURL(u string, max int64) ([]byte, error) {
	b, ok := st.files[strings.TrimPrefix(u, "/files/")]
	if !ok {
		return nil, os.ErrNotExist
	}
	return b, nil
}
func (st *fakeStore) PublicURL(p string) string { return "/files/" + p }
func (st *fakeStore) Remove(p string) error {
	delete(st.files, p)
	return nil
}

// recSvc: service + kho giả; AI nền chạy thẳng (không goroutine).
func recSvc(f *fakeRepo, ai *fakeAI) (*Service, *fakeStore) {
	s := newSvc(f, "")
	st := &fakeStore{files: map[string][]byte{}}
	s.files = st
	if ai != nil {
		s.ai = ai
	}
	s.goAI = func(fn func()) { fn() }
	return s, st
}

func liveOf(xs ...string) []any {
	out := []any{}
	for i := 0; i+1 < len(xs); i += 2 {
		out = append(out, omap.Of("who", xs[i], "t", xs[i+1], "at", float64(i*5)))
	}
	return out
}

// mustRec(t)(kết quả, lỗi): lỗi -> dừng test; kết quả -> *omap.Map.
func mustRec(t *testing.T) func(v any, err error) *omap.Map {
	return func(v any, err error) *omap.Map {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return v.(*omap.Map)
	}
}

// ---- hàm thuần ----

func TestRecLines(t *testing.T) {
	in := []any{
		omap.Of("who", "nv", "t", "  Chào anh  ", "at", 3.4),
		omap.Of("who", "KH", "t", "Dạ chào em", "at", -5.0),
		omap.Of("who", "kh", "t", "   ", "at", 1.0), // rỗng: bỏ
		omap.Of("who", "staff", "t", strings.Repeat("a", 2100), "at", 9999.0),
	}
	got, err := recLines(in, 100, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 {
		t.Fatalf("số câu %d: %s", len(got), js(got))
	}
	a, b, c, d := got[0].(*omap.Map), got[1].(*omap.Map), got[2].(*omap.Map), got[3].(*omap.Map)
	if a.Val("t") != "Chào anh" || a.Val("at") != 3.0 || a.Val("who") != "nv" {
		t.Errorf("câu 1 %s", js(a))
	}
	if b.Val("who") != "kh" || b.Val("at") != 0.0 {
		t.Errorf("câu 2 %s", js(b))
	}
	// câu dài 2100 ký tự: tách 2000 + 100, cùng người nói / mốc giờ, không mất chữ
	if c.Val("who") != "nv" || c.Val("at") != 160.0 || len([]rune(c.Val("t").(string))) != recMaxText {
		t.Errorf("câu 3: who %v at %v len %d", c.Val("who"), c.Val("at"), len([]rune(c.Val("t").(string))))
	}
	if d.Val("who") != "nv" || d.Val("at") != 160.0 || d.Val("t") != strings.Repeat("a", 100) {
		t.Errorf("câu 4: who %v at %v len %d", d.Val("who"), d.Val("at"), len([]rune(d.Val("t").(string))))
	}
	// đủ recMaxLines câu nhưng 1 câu dài phải tách -> vượt giới hạn: strict 400, không strict cắt còn recMaxLines
	full := make([]any, recMaxLines)
	for i := range full {
		full[i] = omap.Of("who", "nv", "t", "x")
	}
	full[0] = omap.Of("who", "nv", "t", strings.Repeat("b", recMaxText+1))
	if _, err := recLines(full, 10, true); status(err) != 400 {
		t.Errorf("tách xong quá nhiều câu: mong 400, được %v", err)
	}
	if got, err := recLines(full, 10, false); err != nil || len(got) != recMaxLines {
		t.Errorf("không strict tách xong: %d câu, %v", len(got), err)
	}
	for name, bad := range map[string]any{
		"không phải mảng": "abc",
		"câu sai dạng":    []any{"x"},
		"người nói sai":   []any{omap.Of("who", "ai", "t", "x")},
		"chữ không chuỗi": []any{omap.Of("who", "nv", "t", 5.0)},
		"quá nhiều câu":   make([]any, recMaxLines+1),
	} {
		if _, err := recLines(bad, 10, true); status(err) != 400 {
			t.Errorf("%s: mong 400, được %v", name, err)
		}
	}
	// không strict: bỏ phần sai, cắt bớt
	many := make([]any, recMaxLines+5)
	for i := range many {
		many[i] = omap.Of("who", "kh", "t", "x")
	}
	many[0] = "sai"
	got, err = recLines(many, 10, false)
	if err != nil || len(got) != recMaxLines-1 {
		t.Errorf("không strict: %d câu, %v", len(got), err)
	}
	if got, _ := recLines(nil, 10, true); len(got) != 0 {
		t.Errorf("nil -> rỗng")
	}
}

func TestRecFormat(t *testing.T) {
	for sec, want := range map[int]string{0: "00:00", 75: "01:15", 6001: "100:01"} {
		if g := mmss(sec); g != want {
			t.Errorf("mmss(%d) = %s, mong %s", sec, g, want)
		}
	}
	for dur, want := range map[int]string{0: recTitle, 30: recTitle + " · dưới 1 phút", 60: recTitle + " · 1 phút", 150: recTitle + " · 3 phút"} {
		if g := recTitleOf(dur); g != want {
			t.Errorf("recTitleOf(%d) = %q", dur, g)
		}
	}
	lines := liveOf("nv", "Chào anh", "kh", "Chào em")
	if g, want := recContent("", lines, "Lan", "Anh Ninh"), "[00:00] Nhân viên (Lan): Chào anh\n[00:10] Khách (Anh Ninh): Chào em"; g != want {
		t.Errorf("nội dung:\n%s", g)
	}
	if g := recContent("Khách cần thiết kế", lines, "", ""); !strings.HasPrefix(g, "Tóm tắt: Khách cần thiết kế\n\n[00:00] Nhân viên: Chào anh\n") {
		t.Errorf("nội dung có tóm tắt:\n%s", g)
	}
	for ct, want := range map[string]string{"audio/webm;codecs=opus": ".webm", "audio/x-wav": ".wav", "AUDIO/MP4": ".m4a", "audio/mpeg": ".mp3", "audio/ogg; codecs=opus": ".ogg"} {
		if _, ext, ok := recAudioType(ct); !ok || ext != want {
			t.Errorf("recAudioType(%q) = %s %v", ct, ext, ok)
		}
	}
	for _, ct := range []string{"", "video/webm", "text/html", "audio/flac"} {
		if _, _, ok := recAudioType(ct); ok {
			t.Errorf("recAudioType(%q) phải từ chối", ct)
		}
	}
}

func TestParseRecAI(t *testing.T) {
	lines, sum, ok := parseRecAI("```json\n{\"lines\":[{\"who\":\"khách\",\"at\":4,\"t\":\" Nhà 3 tầng \"},{\"who\":\"x\",\"t\":\"bỏ\"}],\"summary\":\""+strings.Repeat("s", 700)+"\"}\n```", 10)
	if !ok || len(lines) != 1 || len([]rune(sum)) != recMaxSummary {
		t.Fatalf("ok %v lines %s sum %d", ok, js(lines), len(sum))
	}
	if l := lines[0].(*omap.Map); l.Val("who") != "kh" || l.Val("t") != "Nhà 3 tầng" || l.Val("at") != 4.0 {
		t.Errorf("câu %s", js(l))
	}
	for _, bad := range []string{"", "không phải json", `[]`, `{"lines":[]}`, `{"lines":"x"}`} {
		if _, _, ok := parseRecAI(bad, 10); ok {
			t.Errorf("%q phải lỗi", bad)
		}
	}
}

// ---- service ----

func TestRecordingService(t *testing.T) {
	f := newFake()
	ai := &fakeAI{text: `{"lines":[{"who":"nv","at":0,"t":"Chào anh, em là Lan"},{"who":"kh","at":5,"t":"Chào em, anh cần thiết kế nhà 3 tầng"}],"summary":"Khách cần thiết kế nhà 3 tầng"}`}
	s, st := recSvc(f, ai)
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	audio := []byte("RIFF-giả")
	meta := omap.Of("kind", "meeting", "durationSec", 95.0, "staffName", "Lan", "liveLines", liveOf("nv", "chào anh em là lan", "nv", "chào em anh cần thiết kế nhà"),
		"audioComplete", true)
	r := mustRec(t)(s.CreateRecording(ctx, a, id, RecordingUpload{Meta: meta, Audio: audio, AudioMIME: "audio/webm;codecs=opus"}))

	keys := []string{}
	r.Each(func(k string, _ any) { keys = append(keys, k) })
	if g := strings.Join(keys, ","); g != "id,leadId,kind,title,durationSec,status,engine,model,error,summary,lines,liveLines,audioUrl,audioMime,audioBytes,staffName,customerName,authorName,activityId,createdAt,updatedAt" {
		t.Errorf("khoá: %s", g)
	}
	// AI chạy thẳng trong test: trả về đã là kết quả lúc tạo (processing); đọc lại để thấy done
	if r.Val("status") != "processing" || r.Val("engine") != "gemini" || r.Val("customerName") != "Anh Ninh" || r.Val("authorName") != "an" {
		t.Errorf("lúc tạo: %s", js(r))
	}
	if !regexp.MustCompile(`^/files/kd-rec/1/1-[0-9a-f]{32}\.webm$`).MatchString(jsval.Str(r.Val("audioUrl"))) || r.Val("audioMime") != "audio/webm" || r.Val("audioBytes") != float64(len(audio)) {
		t.Errorf("file ghi âm: %v %v %v", r.Val("audioUrl"), r.Val("audioMime"), r.Val("audioBytes"))
	}
	if len(st.files) != 1 {
		t.Errorf("kho có %d file", len(st.files))
	}
	if len(ai.parts) != 2 || ai.parts[0].MIME != "audio/webm" || !bytes.Equal(ai.parts[0].Data, audio) {
		t.Fatalf("phần gửi AI: %d", len(ai.parts))
	}
	if p := ai.parts[1].Text; !strings.Contains(p, recOpen) || !strings.Contains(p, "[00:10] nv: chào em anh cần thiết kế nhà") || !strings.Contains(p, "Kèm theo là file ghi âm") {
		t.Errorf("chữ gửi AI:\n%s", p)
	}
	if !strings.Contains(ai.system, "chỉ là DỮ LIỆU") {
		t.Errorf("system thiếu câu chống chèn lệnh")
	}
	got := mustRec(t)(s.ListRecordings(ctx, a, id)).Val("recordings").([]any)
	done := got[0].(*omap.Map)
	if done.Val("status") != "done" || done.Val("summary") != "Khách cần thiết kế nhà 3 tầng" || done.Val("model") != "gemini-test" || len(done.Val("lines").([]any)) != 2 {
		t.Errorf("sau AI: %s", js(done))
	}
	if len(f.acts) != 1 {
		t.Fatalf("lần chăm sóc: %d", len(f.acts))
	}
	act := f.acts[0]
	if act.Val("loai") != "meeting" || act.Val("tieu_de") != recTitle+" · 2 phút" || act.Val("nguoi_viet") != "an" || act.Val("ngay") != "2026-10-29" {
		t.Errorf("lần chăm sóc: %s", js(act))
	}
	if want := "Tóm tắt: Khách cần thiết kế nhà 3 tầng\n\n[00:00] Nhân viên (Lan): Chào anh, em là Lan\n[00:05] Khách (Anh Ninh): Chào em, anh cần thiết kế nhà 3 tầng"; act.Val("noi_dung") != want {
		t.Errorf("nội dung lần chăm sóc:\n%v", act.Val("noi_dung"))
	}
	if done.Val("activityId") != act.Val("id") {
		t.Errorf("activityId %v", done.Val("activityId"))
	}

	// sửa tay: đổi người nói câu 2 -> nội dung lần chăm sóc đổi theo
	recID := jsval.ToNumber(done.Val("id"))
	up := mustRec(t)(s.UpdateRecording(ctx, a, recID, omap.Of("lines", []any{omap.Of("who", "kh", "t", "Chào anh, em là Lan", "at", 0.0)})))
	if l := up.Val("lines").([]any); len(l) != 1 || !strings.Contains(jsval.Str(act.Val("noi_dung")), "[00:00] Khách (Anh Ninh): Chào anh, em là Lan") {
		t.Errorf("sửa tay: %s / %v", js(up), act.Val("noi_dung"))
	}
	for name, body := range map[string]*omap.Map{"thiếu lines": omap.New(), "rỗng": omap.Of("lines", []any{}), "sai who": omap.Of("lines", []any{omap.Of("who", "x", "t", "a")})} {
		if _, err := s.UpdateRecording(ctx, a, recID, body); status(err) != 400 {
			t.Errorf("sửa %s: %v", name, err)
		}
	}

	// cờ audioComplete lưu lại: chạy lại vẫn chép theo file ghi âm
	if f.recs[recID].Val("am_thanh_du") != true {
		t.Errorf("am_thanh_du: %v", f.recs[recID].Val("am_thanh_du"))
	}
	ai.parts = nil
	if _, err := s.ReprocessRecording(ctx, a, recID); err != nil {
		t.Fatal(err)
	}
	if len(ai.parts) != 2 || ai.parts[0].MIME != "audio/webm" {
		t.Errorf("chạy lại (ghi âm đủ) phải gửi file ghi âm: %d phần", len(ai.parts))
	}

	// xoá: mất dòng + file, lần chăm sóc giữ nguyên
	if _, err := s.DeleteRecording(ctx, a, recID); err != nil {
		t.Fatal(err)
	}
	if len(st.files) != 0 || len(f.recs) != 0 || len(f.acts) != 1 {
		t.Errorf("sau xoá: file %d dòng %d chăm sóc %d", len(st.files), len(f.recs), len(f.acts))
	}
	if _, err := s.DeleteRecording(ctx, a, recID); status(err) != 404 {
		t.Errorf("xoá lại: %v", err)
	}
	if _, err := s.ListRecordings(ctx, a, 999); status(err) != 404 {
		t.Errorf("khách không có: %v", err)
	}

	// xoá khách hàng: dòng hội thoại xoá theo khoá ngoại, file ghi âm xoá khỏi kho sau khi commit
	other := newLead(t, s, ctx, omap.Of("name", "Chị Hoa"))
	mustRec(t)(s.CreateRecording(ctx, a, other, RecordingUpload{Meta: omap.Of("liveLines", liveOf("nv", "Chào chị")), Audio: audio, AudioMIME: "audio/webm"}))
	mustRec(t)(s.CreateRecording(ctx, a, id, RecordingUpload{Meta: omap.Of("liveLines", liveOf("nv", "Chào anh")), Audio: audio, AudioMIME: "audio/webm"}))
	if len(st.files) != 2 {
		t.Fatalf("kho có %d file", len(st.files))
	}
	if _, err := s.DeleteLead(ctx, a, id); err != nil {
		t.Fatal(err)
	}
	if len(st.files) != 1 {
		t.Errorf("xoá khách: kho còn %d file, mong 1 (file của khách khác)", len(st.files))
	}
	for p := range st.files {
		if !strings.HasPrefix(p, "kd-rec/"+jsval.NumberToString(other)+"/") {
			t.Errorf("xoá nhầm file của khách khác, còn %s", p)
		}
	}
	if _, err := s.DeleteLead(ctx, a, id); status(err) != 404 {
		t.Errorf("xoá lại khách: %v", err)
	}
	if len(st.files) != 1 {
		t.Errorf("xoá khách không có không được xoá file: còn %d", len(st.files))
	}
}

func TestRecordingValidate(t *testing.T) {
	f := newFake()
	s, _ := recSvc(f, nil)
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	ok := liveOf("nv", "Chào anh")
	for name, up := range map[string]RecordingUpload{
		"thiếu meta":           {},
		"không có nội dung":    {Meta: omap.Of("kind", "call")},
		"loại sai":             {Meta: omap.Of("kind", "zalo", "liveLines", ok)},
		"thời lượng âm":        {Meta: omap.Of("durationSec", -1.0, "liveLines", ok)},
		"thời lượng chuỗi":     {Meta: omap.Of("durationSec", "5", "liveLines", ok)},
		"audioComplete sai":    {Meta: omap.Of("liveLines", ok, "audioComplete", "true")},
		"định dạng không nhận": {Meta: omap.Of("liveLines", ok), Audio: []byte("x"), AudioMIME: "video/mp4"},
		"câu sai":              {Meta: omap.Of("liveLines", []any{omap.Of("who", "ai", "t", "x")})},
	} {
		if _, err := s.CreateRecording(ctx, a, id, up); status(err) != 400 {
			t.Errorf("%s: mong 400, được %v", name, err)
		}
	}
	if _, err := s.CreateRecording(ctx, a, id, RecordingUpload{Meta: omap.Of("liveLines", ok), Audio: make([]byte, recMaxAudio+1), AudioMIME: "audio/webm"}); status(err) != 413 {
		t.Errorf("file quá lớn: %v", err)
	}
	if _, err := s.CreateRecording(ctx, a, 999, RecordingUpload{Meta: omap.Of("liveLines", ok)}); status(err) != 404 {
		t.Errorf("khách không có: %v", err)
	}
	if len(f.acts) != 0 || len(f.recs) != 0 {
		t.Errorf("dữ liệu sai không được ghi: %d %d", len(f.acts), len(f.recs))
	}

	// không có AI: xong ngay, lời thoại = bản chép trực tiếp; chạy lại -> 400
	r := mustRec(t)(s.CreateRecording(ctx, a, id, RecordingUpload{Meta: omap.Of("kind", "call", "durationSec", 30.0, "liveLines", ok)}))
	if r.Val("status") != "done" || r.Val("engine") != "live" || len(r.Val("lines").([]any)) != 1 || r.Val("audioUrl") != "" || r.Val("kind") != "call" {
		t.Errorf("không AI: %s", js(r))
	}
	if f.acts[0].Val("tieu_de") != recTitle+" · dưới 1 phút" || f.acts[0].Val("noi_dung") != "[00:00] Nhân viên (an): Chào anh" {
		t.Errorf("lần chăm sóc: %s", js(f.acts[0]))
	}
	if _, err := s.ReprocessRecording(ctx, a, jsval.ToNumber(r.Val("id"))); status(err) != 400 {
		t.Errorf("chạy lại khi không có AI: %v", err)
	}
	// không có kho file mà gửi file ghi âm -> 503
	s.files = nil
	if _, err := s.CreateRecording(ctx, a, id, RecordingUpload{Meta: omap.Of("liveLines", ok), Audio: []byte("x"), AudioMIME: "audio/webm"}); status(err) != 503 {
		t.Errorf("không có kho: %v", err)
	}
}

func TestRecordingAIFlow(t *testing.T) {
	f := newFake()
	ai := &fakeAI{err: errors.New("gemini: HTTP 500: lỗi")}
	s, _ := recSvc(f, ai)
	var held []func()
	s.goAI = func(fn func()) { held = append(held, fn) }
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	live := liveOf("nv", "Chào anh", "kh", "Chào em")

	// ghi âm không đủ + có bản chép: AI chỉ dùng chữ
	r := mustRec(t)(s.CreateRecording(ctx, a, id, RecordingUpload{Meta: omap.Of("durationSec", 20.0, "liveLines", live, "audioComplete", false),
		Audio: []byte("abc"), AudioMIME: "audio/ogg"}))
	recID := jsval.ToNumber(r.Val("id"))
	if _, err := s.UpdateRecording(ctx, a, recID, omap.Of("lines", live)); status(err) != 409 {
		t.Errorf("sửa khi đang xử lý: %v", err)
	}
	if _, err := s.ReprocessRecording(ctx, a, recID); status(err) != 409 {
		t.Errorf("chạy lại khi đang xử lý: %v", err)
	}
	held[0]()
	if len(ai.parts) != 1 || ai.parts[0].Text == "" || !strings.Contains(ai.parts[0].Text, "Không có file ghi âm") {
		t.Errorf("chỉ gửi chữ: %d phần", len(ai.parts))
	}
	got := mustRec(t)(s.repo.GetRecording(ctx, recID))
	if got.Val("trang_thai") != "failed" || !strings.HasPrefix(jsval.Str(got.Val("loi")), "Không gọi được AI") || len(got.Val("cac_cau").([]any)) != 2 {
		t.Errorf("AI lỗi: %s", js(got))
	}
	if f.acts[0].Val("noi_dung") != "[00:00] Nhân viên (an): Chào anh\n[00:10] Khách (Anh Ninh): Chào em" {
		t.Errorf("AI lỗi không đổi lần chăm sóc: %v", f.acts[0].Val("noi_dung"))
	}

	// sửa tay sau lượt lỗi (thành done), rồi chạy lại: ghi âm không đủ (cờ đã lưu) -> vẫn chỉ gửi chữ;
	// kết quả sai định dạng -> failed nhưng GIỮ lời thoại + tóm tắt đang có, không ghi lại lần chăm sóc
	fixedLines := []any{omap.Of("who", "kh", "t", "Sửa tay trước", "at", 0.0)}
	mustRec(t)(s.UpdateRecording(ctx, a, recID, omap.Of("lines", fixedLines)))
	f.recs[recID].Set("tom_tat", "Tóm tắt cũ")
	actBefore := f.acts[0].Val("noi_dung")
	ai.err, ai.text = nil, `{"lines":[]}`
	rp := mustRec(t)(s.ReprocessRecording(ctx, a, recID))
	if rp.Val("status") != "processing" || rp.Val("error") != "" {
		t.Errorf("chạy lại: %s", js(rp))
	}
	held[1]()
	if len(ai.parts) != 1 || !strings.Contains(ai.parts[0].Text, "Không có file ghi âm") {
		t.Errorf("chạy lại (ghi âm không đủ) chỉ gửi chữ: %d phần", len(ai.parts))
	}
	got = mustRec(t)(s.repo.GetRecording(ctx, recID))
	if got.Val("trang_thai") != "failed" || !strings.Contains(jsval.Str(got.Val("loi")), "không đúng định dạng") {
		t.Errorf("sai định dạng: %s", js(got))
	}
	if l := got.Val("cac_cau").([]any); len(l) != 1 || jsval.Str(l[0].(*omap.Map).Val("t")) != "Sửa tay trước" || got.Val("tom_tat") != "Tóm tắt cũ" {
		t.Errorf("AI lỗi đã ghi đè lời thoại / tóm tắt: %s", js(got))
	}
	if f.acts[0].Val("noi_dung") != actBefore {
		t.Errorf("AI lỗi không được ghi lại lần chăm sóc: %v", f.acts[0].Val("noi_dung"))
	}

	// lượt AI treo > 10 phút: được sửa tay (thành done); kết quả AI về muộn không ghi đè
	ai.text = `{"lines":[{"who":"kh","at":0,"t":"AI về muộn"}],"summary":"muộn"}`
	if _, err := s.ReprocessRecording(ctx, a, recID); err != nil {
		t.Fatal(err)
	}
	base := s.now()
	if r := mustRec(t)(s.ListRecordings(ctx, a, id)).Val("recordings").([]any)[0].(*omap.Map); r.Val("status") != "processing" || r.Val("error") != "" {
		t.Errorf("đang xử lý (chưa quá hạn): %s", js(r))
	}
	s.now = func() time.Time { return base.Add(11 * time.Minute) }
	// treo quá hạn: giao diện thấy failed + lời nhắc Thử lại
	if r := mustRec(t)(s.ListRecordings(ctx, a, id)).Val("recordings").([]any)[0].(*omap.Map); r.Val("status") != "failed" ||
		r.Val("error") != "Xử lý quá lâu (máy chủ có thể đã khởi động lại), bấm Thử lại" {
		t.Errorf("treo quá hạn: %s", js(r))
	}
	fixed := mustRec(t)(s.UpdateRecording(ctx, a, recID, omap.Of("lines", []any{omap.Of("who", "nv", "t", "Sửa tay", "at", 0.0)})))
	if fixed.Val("status") != "done" {
		t.Errorf("sửa tay khi treo: %s", js(fixed))
	}
	held[2]()
	if got := mustRec(t)(s.repo.GetRecording(ctx, recID)); got.Val("tom_tat") == "muộn" || jsval.Str(got.Val("cac_cau").([]any)[0].(*omap.Map).Val("t")) != "Sửa tay" {
		t.Errorf("AI về muộn đã ghi đè: %s", js(got))
	}

	// panic trong lượt AI -> failed, không sập
	if _, err := s.ReprocessRecording(ctx, a, recID); err != nil {
		t.Fatal(err)
	}
	s.ai = panicAI{ai}
	held[3]()
	if got := mustRec(t)(s.repo.GetRecording(ctx, recID)); got.Val("trang_thai") != "failed" {
		t.Errorf("panic: %s", js(got))
	}
}

type panicAI struct{ *fakeAI }

func (panicAI) GenerateJSONParts(ctx context.Context, model, system string, parts []gemini.Part) (string, error) {
	panic("hỏng")
}

// ---- handler: đọc multipart ----

func recRequest(t *testing.T, meta string, audio []byte, audioType string) *gin.Context {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if meta != "" {
		_ = mw.WriteField("meta", meta)
	}
	if audio != nil {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="audio"; filename="rec.webm"`)
		h.Set("Content-Type", audioType)
		w, _ := mw.CreatePart(h)
		_, _ = w.Write(audio)
	}
	_ = mw.Close()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/sales/leads/1/recordings", &buf)
	c.Request.Header.Set("Content-Type", mw.FormDataContentType())
	return c
}

func TestReadRecordingForm(t *testing.T) {
	gin.SetMode(gin.TestMode)
	up, err := readRecordingForm(recRequest(t, `{"kind":"call","liveLines":[]}`, []byte("abc"), "audio/webm;codecs=opus"))
	if err != nil {
		t.Fatal(err)
	}
	if up.Meta == nil || up.Meta.Val("kind") != "call" || string(up.Audio) != "abc" || up.AudioMIME != "audio/webm;codecs=opus" {
		t.Errorf("đọc được: %+v", up)
	}
	if _, err := readRecordingForm(recRequest(t, `[1]`, nil, "")); status(err) != 400 {
		t.Errorf("meta không phải object: %v", err)
	}
	if _, err := readRecordingForm(recRequest(t, `{`, nil, "")); status(err) != 400 {
		t.Errorf("meta hỏng: %v", err)
	}
	if _, err := readRecordingForm(recRequest(t, `{}`, make([]byte, recMaxAudio+1), "audio/webm")); status(err) != 413 {
		t.Errorf("file quá lớn: %v", err)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"meta":1}`))
	c.Request.Header.Set("Content-Type", "application/json")
	if _, err := readRecordingForm(c); status(err) != 400 {
		t.Errorf("không phải multipart: %v", err)
	}
}

// ---- database thật (qspro_gotest) ----

// Chạy trên qspro_gotest (TEST_DATABASE_URL, đã migrate 0055), cần 2 công ty có sẵn: hội thoại của công ty này không đọc /
// sửa / xoá được từ công ty khác; ghi kết quả AI có điều kiện (UpdateRecordingIf) chỉ khớp đúng mốc cap_nhat.
func TestRecordingDB(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("chưa đặt TEST_DATABASE_URL")
	}
	if !regexp.MustCompile(`/qspro_gotest(\?|$)`).MatchString(url) {
		t.Fatal("TEST_DATABASE_URL phải trỏ tới database thử qspro_gotest")
	}
	db := database.New(database.Config{URL: url})
	t.Cleanup(db.Close)
	bg := context.Background()
	t.Cleanup(func() {
		if pool, err := db.Pool(); err == nil {
			_, _ = pool.Exec(bg, `delete from sales_leads where customer_name like 'ZZ\_rec\_%'`)
		}
	})
	cts, err := db.Select(bg, "cong_ty", database.SelectOpt{Select: "id", Limit: 2, NoScope: true})
	if err != nil || len(cts) < 2 {
		t.Fatalf("database thử cần ít nhất 2 công ty: %v", err)
	}
	svcOf := func(ct any) (*Service, context.Context) {
		ctx := tenant.With(context.Background(), tenant.Ctx{Role: "admin", CongTyID: ct})
		s := New(Deps{DB: db, Users: fakeUsers{}, UserFmt: fakeUsers{}, Lines: fakeLines{}, Projects: fakeProjects{}})
		s.files = &fakeStore{files: map[string][]byte{}}
		s.goAI = func(fn func()) { fn() }
		return s, ctx
	}
	sa, ctxA := svcOf(cts[0].Val("id"))
	sb, ctxB := svcOf(cts[1].Val("id"))
	// tài khoản super "xem như" công ty: công ty thử có thể chưa bật tính năng Kinh doanh
	_, aA := ctxAs("super", cts[0].Val("id"))
	_, aB := ctxAs("super", cts[1].Val("id"))
	aA.UID, aB.UID = nil, nil

	lb, err := sb.CreateLead(ctxB, aB, omap.Of("name", "ZZ_rec_B"))
	if err != nil {
		t.Fatal(err)
	}
	idB := lb.(*omap.Map).Val("id").(float64)
	r, err := sb.CreateRecording(ctxB, aB, idB, RecordingUpload{Meta: omap.Of("kind", "call", "durationSec", 70.0,
		"liveLines", liveOf("nv", "Chào anh", "kh", "Chào em")), Audio: []byte("abc"), AudioMIME: "audio/webm"})
	if err != nil {
		t.Fatal(err)
	}
	rec := r.(*omap.Map)
	recID := jsval.ToNumber(rec.Val("id"))
	if rec.Val("status") != "done" || rec.Val("engine") != "live" || len(rec.Val("lines").([]any)) != 2 || rec.Val("audioBytes") != 3.0 ||
		jsval.IsNullish(rec.Val("activityId")) || !strings.HasPrefix(jsval.Str(rec.Val("audioUrl")), "/files/kd-rec/") {
		t.Errorf("tạo: %s", js(rec))
	}
	acts, err := sb.ListActivities(ctxB, aB, idB)
	if err != nil || len(acts.([]any)) != 1 || acts.([]any)[0].(*omap.Map).Val("title") != recTitle+" · 1 phút" {
		t.Fatalf("lần chăm sóc: %v %v", js(acts), err)
	}

	// công ty khác: không thấy, không sửa / xoá được
	if _, err := sa.ListRecordings(ctxA, aA, idB); status(err) != 404 {
		t.Errorf("A xem hội thoại của B: %v", err)
	}
	if _, err := sa.UpdateRecording(ctxA, aA, recID, omap.Of("lines", liveOf("kh", "x"))); status(err) != 404 {
		t.Errorf("A sửa hội thoại của B: %v", err)
	}
	if _, err := sa.DeleteRecording(ctxA, aA, recID); status(err) != 404 {
		t.Errorf("A xoá hội thoại của B: %v", err)
	}

	// sửa tay -> nội dung lần chăm sóc đổi theo
	if _, err := sb.UpdateRecording(ctxB, aB, recID, omap.Of("lines", liveOf("kh", "Khách nói"))); err != nil {
		t.Fatal(err)
	}
	acts, _ = sb.ListActivities(ctxB, aB, idB)
	if c := acts.([]any)[0].(*omap.Map).Val("content"); c != "[00:00] Khách (ZZ_rec_B): Khách nói" {
		t.Errorf("nội dung lần chăm sóc sau sửa: %v", c)
	}

	// ghi có điều kiện: đúng mốc + processing mới ghi
	stamp := sb.recStamp()
	if _, err := sb.repo.UpdateRecording(ctxB, recID, omap.Of("trang_thai", "processing", "cap_nhat", stamp)); err != nil {
		t.Fatal(err)
	}
	if out, err := sb.repo.UpdateRecordingIf(ctxB, recID, "2000-01-01T00:00:00Z", omap.Of("tom_tat", "sai")); err != nil || out != nil {
		t.Errorf("mốc sai vẫn ghi: %v %v", out, err)
	}
	if out, err := sb.repo.UpdateRecordingIf(ctxB, recID, stamp, omap.Of("trang_thai", "done", "tom_tat", "đúng")); err != nil || out == nil || out.Val("tom_tat") != "đúng" {
		t.Errorf("mốc đúng không ghi: %v %v", out, err)
	}

	list, err := sb.ListRecordings(ctxB, aB, idB)
	if err != nil || len(list.(*omap.Map).Val("recordings").([]any)) != 1 {
		t.Errorf("danh sách: %v %v", js(list), err)
	}
	if _, err := sb.DeleteRecording(ctxB, aB, recID); err != nil {
		t.Fatal(err)
	}
	acts, _ = sb.ListActivities(ctxB, aB, idB)
	if len(acts.([]any)) != 1 {
		t.Errorf("xoá hội thoại không được xoá lần chăm sóc")
	}

	// cờ audioComplete lưu vào am_thanh_du; xoá khách -> xoá file ghi âm (công ty khác xoá không được, file còn nguyên)
	r, err = sb.CreateRecording(ctxB, aB, idB, RecordingUpload{Meta: omap.Of("liveLines", liveOf("nv", "Chào anh"), "audioComplete", true),
		Audio: []byte("abc"), AudioMIME: "audio/webm"})
	if err != nil {
		t.Fatal(err)
	}
	if row, err := sb.repo.GetRecording(ctxB, jsval.ToNumber(r.(*omap.Map).Val("id"))); err != nil || row == nil || row.Val("am_thanh_du") != true {
		t.Errorf("am_thanh_du: %v %v", js(row), err)
	}
	storeB := sb.files.(*fakeStore)
	if _, err := sa.DeleteLead(ctxA, aA, idB); status(err) != 404 || len(storeB.files) != 1 {
		t.Errorf("A xoá khách của B: %v, file còn %d", err, len(storeB.files))
	}
	if _, err := sb.DeleteLead(ctxB, aB, idB); err != nil {
		t.Fatal(err)
	}
	if len(storeB.files) != 0 {
		t.Errorf("xoá khách còn %d file ghi âm", len(storeB.files))
	}
}
