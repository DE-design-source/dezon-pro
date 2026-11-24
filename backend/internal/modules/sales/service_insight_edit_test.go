package sales

import (
	"strings"
	"testing"
	"time"

	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

func TestUpdateInsight(t *testing.T) {
	f := newFake()
	s := newSvc(f, "")
	ctx, a := ctxAs("admin", "ct-1")
	id := newLead(t, s, ctx, omap.Of("name", "Anh Ninh"))
	mainOf := func(title string) *omap.Map {
		return omap.Of("actions", omap.Of("main", omap.Of("title", title, "why", "Vì sao: x", "zalo", "Dạ em chào anh"), "side", []any{}))
	}

	if _, err := s.UpdateInsight(ctx, a, id, omap.Of("content", mainOf("x"))); status(err) != 404 || apperr.Message(err) != "Chưa có bản phân tích để sửa" {
		t.Errorf("chưa có phân tích phải 404: %v", err)
	}
	if _, err := s.UpdateInsight(ctx, a, 999, omap.Of("content", mainOf("x"))); status(err) != 404 {
		t.Errorf("khách không có phải 404: %v", err)
	}
	g, err := s.GenerateInsights(ctx, a, id, omap.Of("start", "2027-02-15"))
	if err != nil {
		t.Fatal(err)
	}
	before := g.(*omap.Map).Val("insight").(*omap.Map)
	gen := before.Val("generatedAt")
	if before.Val("editedBy") != "" || before.Val("editedAt") != nil {
		t.Errorf("bản chưa sửa: %s", js(before))
	}

	for _, bad := range []any{nil, "x", []any{}, 1.0} {
		if _, err := s.UpdateInsight(ctx, a, id, omap.Of("content", bad)); status(err) != 400 {
			t.Errorf("content %v phải 400: %v", bad, err)
		}
	}
	for _, c := range []*omap.Map{omap.New(), mainOf("   "), omap.Of("actions", omap.Of("main", omap.Of("title", nil)))} {
		if _, err := s.UpdateInsight(ctx, a, id, omap.Of("content", c)); status(err) != 400 || apperr.Message(err) != "Hành động chính không được để trống" {
			t.Errorf("thiếu hành động chính phải 400: %s %v", js(c), err)
		}
	}
	if _, err := s.UpdateInsight(ctx, a, id, omap.Of("content", mainOf("x"), "generatedAt", "2020-01-01T00:00:00Z")); status(err) != 409 ||
		apperr.Message(err) != "Đã có bản phân tích mới hơn, tải lại rồi sửa" {
		t.Errorf("generatedAt lệch phải 409: %v", err)
	}

	// sửa thành công: ghi đè đúng dòng, giữ engine / model / generatedAt / nguồn, thêm editedBy / editedAt
	s.now = func() time.Time { return time.Date(2026, 10, 28, 21, 0, 0, 0, time.UTC) }
	long := strings.Repeat("á", 400)
	c := mainOf(long)
	c.Set("strategy", omap.Of("headline", "Deal sửa tay", "risks", []any{"Rủi ro 1", "", 3.0}))
	c.Set("ideas", []any{omap.Of("title", "Hỏi ngân sách", "desc", "d"), omap.Of("title", "")})
	c.Set("roadmap", omap.Of("title", "Lộ trình sửa", "anchor", "2027-03-01", "steps", []any{
		omap.Of("date", "2027-01-05", "label", "Ký HĐ", "desc", "mốc", "state", "key", "dashed", true),
		omap.Of("date", "05/01", "label", "Hồ sơ", "state", "bay"),
		omap.Of("label", "")}))
	r, err := s.UpdateInsight(ctx, a, id, omap.Of("content", c, "generatedAt", gen))
	if err != nil {
		t.Fatal(err)
	}
	in := r.(*omap.Map).Val("insight").(*omap.Map)
	keys := []string{}
	in.Each(func(k string, _ any) { keys = append(keys, k) })
	if strings.Join(keys, ",") != "engine,model,generatedAt,warning,editedBy,editedAt,actions,strategy,ideas,roadmap,sources" {
		t.Errorf("thứ tự khoá %v", keys)
	}
	if in.Val("engine") != before.Val("engine") || in.Val("model") != before.Val("model") || in.Val("generatedAt") != gen ||
		in.Val("warning") != before.Val("warning") || js(in.Val("sources")) != js(before.Val("sources")) {
		t.Errorf("phải giữ thông tin bản gốc: %s", js(in))
	}
	if in.Val("editedBy") != "an" || in.Val("editedAt") != "2026-10-28T21:00:00Z" || len(f.insights) != 1 {
		t.Errorf("editedBy / editedAt: %s (%d dòng)", js(in), len(f.insights))
	}
	main := in.Val("actions").(*omap.Map).Val("main").(*omap.Map)
	if jsval.Str(main.Val("title")) != strings.Repeat("á", 300) || main.Val("priority") != before.Val("actions").(*omap.Map).Val("main").(*omap.Map).Val("priority") {
		t.Errorf("main phải cắt 300 ký tự, priority thiếu giữ nguyên: %s", js(main))
	}
	st, bst := in.Val("strategy").(*omap.Map), before.Val("strategy").(*omap.Map)
	if st.Val("headline") != "Deal sửa tay" || js(st.Val("risks")) != `["Rủi ro 1"]` || js(st.Val("fit")) != js(bst.Val("fit")) || st.Val("note") != bst.Val("note") {
		t.Errorf("strategy %s", js(st))
	}
	if js(in.Val("ideas")) != `[{"key":"y1","title":"Hỏi ngân sách","desc":"d"}]` {
		t.Errorf("ideas %s", js(in.Val("ideas")))
	}
	if js(in.Val("roadmap")) != `{"anchor":"2027-03-01","title":"Lộ trình sửa","steps":[{"date":"2027-01-05","label":"Ký HĐ","desc":"mốc","state":"key","dashed":true},`+
		`{"date":"","label":"Hồ sơ","desc":"","state":"open","dashed":false}]}` {
		t.Errorf("roadmap %s", js(in.Val("roadmap")))
	}
	row := f.insights[0]
	if nd := row.Val("noi_dung").(*omap.Map); nd.Val("editedBy") != "an" || row.Val("ngay_tao") != gen || row.Val("cong_cu") != "rules" {
		t.Errorf("dòng đã lưu %s", js(row))
	}
	if g, _ := s.GetInsights(ctx, a, id); g.(*omap.Map).Val("insight").(*omap.Map).Val("editedBy") != "an" {
		t.Errorf("GET phải trả bản đã sửa: %s", js(g))
	}

	// thiếu phần nào giữ nguyên phần đó; roadmap gửi thiếu steps -> giữ mốc hiện tại, nhận title mới; anchor null -> bỏ
	r, err = s.UpdateInsight(ctx, a, id, omap.Of("content", omap.Of("actions", omap.Of("main", omap.Of("title", "Gọi lại")),
		"roadmap", omap.Of("title", "Lộ trình 2", "anchor", nil))))
	if err != nil {
		t.Fatal(err)
	}
	in = r.(*omap.Map).Val("insight").(*omap.Map)
	if js(in.Val("strategy").(*omap.Map).Val("risks")) != `["Rủi ro 1"]` || len(in.Val("ideas").([]any)) != 1 {
		t.Errorf("phần thiếu phải giữ nguyên: %s", js(in))
	}
	rm := in.Val("roadmap").(*omap.Map)
	if rm.Val("anchor") != nil || rm.Val("title") != "Lộ trình 2" || len(rm.Val("steps").([]any)) != 2 {
		t.Errorf("roadmap thiếu steps %s", js(rm))
	}

	// xoá hết risks / ideas / steps -> lưu rỗng (không lấy lại bản cũ)
	c = mainOf("Gọi lại")
	c.Set("strategy", omap.Of("risks", []any{}))
	c.Set("ideas", []any{})
	c.Set("roadmap", omap.Of("steps", []any{}))
	r, err = s.UpdateInsight(ctx, a, id, omap.Of("content", c))
	if err != nil {
		t.Fatal(err)
	}
	in = r.(*omap.Map).Val("insight").(*omap.Map)
	if js(in.Val("strategy").(*omap.Map).Val("risks")) != `[]` || js(in.Val("ideas")) != `[]` ||
		js(in.Val("roadmap")) != `{"anchor":null,"title":"Lộ trình 2","steps":[]}` || in.Val("strategy").(*omap.Map).Val("headline") != "Deal sửa tay" {
		t.Errorf("xoá hết phải lưu rỗng: %s", js(in))
	}
	// risks chỉ có chuỗi rỗng = xoá hết
	c = mainOf("Gọi lại")
	c.Set("strategy", omap.Of("risks", []any{" "}))
	if r, err = s.UpdateInsight(ctx, a, id, omap.Of("content", c)); err != nil || js(r.(*omap.Map).Val("insight").(*omap.Map).Val("strategy").(*omap.Map).Val("risks")) != `[]` {
		t.Errorf("risks rỗng: %s %v", js(r), err)
	}

	// có bản mới hơn -> sửa theo generatedAt cũ bị 409, không đụng bản cũ
	s.now = func() time.Time { return time.Date(2026, 10, 28, 22, 0, 0, 0, time.UTC) }
	if _, err := s.GenerateInsights(ctx, a, id, omap.New()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateInsight(ctx, a, id, omap.Of("content", mainOf("x"), "generatedAt", gen)); status(err) != 409 {
		t.Errorf("bản cũ phải 409: %v", err)
	}
	if len(f.insights) != 2 || f.insights[1].Val("noi_dung").(*omap.Map).Has("editedBy") {
		t.Errorf("bản mới không được sửa: %d dòng", len(f.insights))
	}
}

func TestSameTime(t *testing.T) {
	if !sameTime("2026-10-28T20:00:00Z", "2026-10-29T03:00:00+07:00") || !sameTime("2026-10-28T20:00:00.000Z", "2026-10-28T20:00:00Z") ||
		sameTime("2026-10-28T20:00:00Z", "2026-10-28T20:00:01Z") || sameTime("x", "y") || !sameTime("x", "x") {
		t.Error("sameTime")
	}
}
