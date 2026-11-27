package projects

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"qspro-backend/internal/platform/storage"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ───────────── hàm thuần ─────────────

func TestParseDzList(t *testing.T) {
	b := []byte(`[{"id":54418,"slug":"kap-villa","link":"https:\/\/dezon.vn\/du-an\/kap-villa\/","title":{"rendered":"KA&#038;P Villa &#8211; Đà Lạt"},
		"content":{"rendered":"<p>Giới thiệu</p>"},"class_list":["post-54418","project_category-biet-thu","project_nation-viet-nam"],
		"project_thumb":"https:\/\/dezon.vn\/wp-content\/uploads\/2026\/11\/a-720x401.jpg"},
		{"id":2,"link":"https://dezon.vn/du-an/b/","title":{"rendered":"B"},"content":{"rendered":""},"class_list":{"0":"project_category-can-ho"},"project_thumb":null},
		{"id":3,"link":"https://dezon.vn/du-an/c/","title":{"rendered":"C"},"content":{"rendered":""},"class_list":[],"project_thumb":false}]`)
	got, err := parseDzList(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("số bài: %d", len(got))
	}
	if got[0].ID != 54418 || got[0].Title != "KA&P Villa – Đà Lạt" || got[0].Link != "https://dezon.vn/du-an/kap-villa/" ||
		got[0].Thumb != "https://dezon.vn/wp-content/uploads/2026/11/a-720x401.jpg" || len(got[0].Classes) != 3 {
		t.Errorf("bài 1: %+v", got[0])
	}
	if got[1].Thumb != "" || !reflect.DeepEqual(got[1].Classes, []string{"project_category-can-ho"}) {
		t.Errorf("bài 2 (thumb null, class_list object): %+v", got[1])
	}
	if got[2].Thumb != "" {
		t.Errorf("thumb false phải thành rỗng: %q", got[2].Thumb)
	}
	if _, err := parseDzList([]byte(`{"code":"rest_invalid"}`)); err == nil {
		t.Error("JSON không phải mảng phải lỗi")
	}
}

const dzU = "https://dezon.vn/wp-content/uploads/2026/11/"

// trang mẫu theo cấu trúc trang dự án dezon.vn: breadcrumb, h1, dải trượt, bảng thông tin, mục Hình ảnh, mục sau.
func dzPage(info, slider, rooms string) string {
	return `<html><body><div id="jbreadcrumb"><div class="breadcrumb-container"><span><span><a href="https://dezon.vn/">Trang Chủ</a></span>
<i class="fa fa-angle-right"></i> <span><a href="https://dezon.vn/du-an/">Dự án</a></span> <i class="fa fa-angle-right"></i>
<span class="breadcrumb_last" aria-current="page"><a href="https://dezon.vn/tp/thuong-mai/">Thương Mại &amp; Văn Phòng</a></span></span></div></div>
<img src="` + dzU + `logo-header.png" alt="">
<h1 class="fs-64 fw-medium mb-4">Dự án mẫu</h1><div class="slider_wrapper"><div class="project_slider">` + slider + `</div>
<img data-src="https://dezon.vn/wp-content/themes/decox/assets/images/dropdown.svg" class="lazyload"></div>
<div class="project_info mb-5 pb-5"><table class="table" id="dz-sec-info"><tbody>` + info + `</tbody></table></div>
<div class="project-rooms-wrapper position-relative" id="dz-sec-rooms"><div id="project-rooms-list">` + rooms + `</div></div>
<div id="dz-sec-suppliers"><img src="` + dzU + `logo-ncc.png"></div></body></html>`
}

func TestParseDzDetail(t *testing.T) {
	info := `<tr><td width="35%" class="fw-bold">DỰ ÁN:</td><td class="fw-medium">Văn phòng Danieli</td></tr>
<tr><td class="fw-bold">DIỆN TÍCH:</td><td class="fw-medium">3199m2</td></tr>
<tr><td class="fw-bold">ĐỊA ĐIỂM:</td><td class="cl-blue"><a href="https://dezon.vn/khu-vuc/tp-ho-chi-minh/">TP. Hồ Chí Minh</a>, <a href="https://dezon.vn/quoc-gia/viet-nam/">Việt Nam</a></td></tr>
<tr><td class="fw-bold">NHÀ THẦU THI CÔNG:</td><td class="fw-medium"><a href="https://dezon.vn/nha-thau/ricons/">Ricons &amp; Partners</a></td></tr>
<tr><td width="35%" class="fw-bold">CÔNG TY:</td><td class="cl-blue"><a href="https://dezon.vn/studio/mas/">MAS Architecture</a></td></tr>
<tr><td class="fw-bold">NĂM HOÀN THIỆN:</td><td class="cl-blue"><a href="https://dezon.vn/du-an/?nam_hoan_thien=2012">2012</a></td></tr>`
	slider := `<div class="item"><figure><button data-fav-img="` + dzU + `s1-1024x602.jpg"></button>
<a href="` + dzU + `s1-1024x602.jpg" data-fancybox="g"> <img src="` + dzU + `s1.jpg" class="img-fluid skip-lazy"></a></figure></div>
<div class="item"><a href="` + dzU + `s2-1024x679.png"><img src="data:image/svg+xml;base64,AAA" data-src="` + dzU + `s2.png?ver=3" class="lazyload"></a>
<noscript><img src="` + dzU + `s2.png"></noscript></div>
<div class="item"><a href="` + dzU + `s3-768x512.jpg"><img src="` + dzU + `s3-768x512.jpg"></a></div>
<div class="item"><img src="https://cdn.khac.vn/wp-content/uploads/x.jpg"></div>`
	rooms := `<div class="project-room-section" id="room-phong-khach"><h3 class="section-label mb-0"> <a href="https://dezon.vn/phong/phong-khach/"> Phòng khách </a></h3>
<div class="raw-gallery-source"><div class="gallery-source-item"><a href="` + dzU + `r1.jpg"><img class="skip-lazy" src="` + dzU + `r1-1024x683.jpg"></a></div>
<div class="gallery-source-item"><a href="` + dzU + `s1.jpg"><img src="` + dzU + `s1-1024x602.jpg"></a></div></div></div>
<div class="project-room-section" id="room-phong-bep"><h3 class="section-label mb-0"><a href="https://dezon.vn/phong/phong-bep/">Phòng bếp</a></h3>
<div class="gallery-source-item"><a href="` + dzU + `r2.webp"><img src="` + dzU + `r2-683x1024.webp"></a></div>
<div class="gallery-source-item"><a href="` + dzU + `s3.jpg"><img src="` + dzU + `s3-683x1024.jpg"></a></div></div>`
	d := parseDzDetail(dzPage(info, slider, rooms), "")
	wantInfo := map[string]string{"DỰ ÁN": "Văn phòng Danieli", "DIỆN TÍCH": "3199m2", "ĐỊA ĐIỂM": "TP. Hồ Chí Minh, Việt Nam",
		"NHÀ THẦU THI CÔNG": "Ricons & Partners", "CÔNG TY": "MAS Architecture", "NĂM HOÀN THIỆN": "2012"}
	if !reflect.DeepEqual(d.Info, wantInfo) {
		t.Errorf("Info:\n got %v\nwant %v", d.Info, wantInfo)
	}
	if d.Province != "TP. Hồ Chí Minh" || d.Country != "Việt Nam" {
		t.Errorf("địa điểm: %q / %q", d.Province, d.Country)
	}
	if d.Category != "Thương Mại & Văn Phòng" {
		t.Errorf("breadcrumb: %q", d.Category)
	}
	want := []dzImage{
		{dzU + "s1.jpg", "Phòng khách"}, {dzU + "s2.png", ""}, {dzU + "s3.jpg", "Phòng bếp"},
		{dzU + "r1.jpg", "Phòng khách"}, {dzU + "r2.webp", "Phòng bếp"},
	}
	if !reflect.DeepEqual(d.Gallery, want) {
		t.Errorf("Gallery:\n got %+v\nwant %+v", d.Gallery, want)
	}

	// thiếu nhãn, không breadcrumb, không mục Hình ảnh
	d2 := parseDzDetail(`<h1>X</h1><div class="project_slider"><img src="`+dzU+`only.jpg"></div><div class="project_info">
<table><tr><td class="fw-bold">ĐỊA ĐIỂM:</td><td><a href="https://dezon.vn/quoc-gia/viet-nam/">Việt Nam</a></td></tr></table></div>`, "")
	if d2.Category != "" || d2.Province != "" || d2.Country != "Việt Nam" || len(d2.Info) != 1 || d2.Info["DIỆN TÍCH"] != "" {
		t.Errorf("trang thiếu nhãn: %+v", d2)
	}
	if !reflect.DeepEqual(d2.Gallery, []dzImage{{dzU + "only.jpg", ""}}) {
		t.Errorf("trang thiếu mục Hình ảnh: %+v", d2.Gallery)
	}
}

// breadcrumb nhiều danh mục: lấy danh mục đầu, không dấu phẩy cuối; breadcrumb chữ thường (không link) vẫn đọc.
func TestParseDzCrumbMulti(t *testing.T) {
	d := parseDzDetail(`<span class="breadcrumb_last" aria-current="page"><a href="https://dezon.vn/tp/nha-pho/">Nhà Phố</a><span>, </span>`+
		`<a href="https://dezon.vn/tp/van-phong/">Văn Phòng</a></span></span></div><h1>X</h1>`, "")
	if d.Category != "Nhà Phố" {
		t.Errorf("nhiều danh mục: %q", d.Category)
	}
	if d := parseDzDetail(`<span class="breadcrumb_last">Khách Sạn</span></span>`, ""); d.Category != "Khách Sạn" {
		t.Errorf("breadcrumb chữ: %q", d.Category)
	}
}

// mẫu trang cũ: bảng jtable trong project_content không có fw-bold, nhãn "KIẾN TRÚC SƯ CHỦ TRÌ"; thư viện không lấy ảnh
// của khối dự án liên quan.
func TestParseDzDetailOldTemplate(t *testing.T) {
	page := `<span class="breadcrumb_last"><a href="https://dezon.vn/tp/nha-pho/">Nhà Phố</a></span></span>
<h1 class="fs-64">H House</h1><div class="project_slider"><a href="` + dzU + `h2.jpg"><img src="` + dzU + `h2-1024x682.jpg"></a>
<img data-src="` + dzU + `h5-1024x683.jpg"></div><div class="project_content"><div class="row"><div class="col-lg-6">
<table class="table table-borderless fs-18 jtable"><tbody><tr><td>DỰ ÁN:</td><td> H House &#8211; Nhà ở</td></tr><tr><td>DIỆN TÍCH:</td><td>392.5m2</td></tr>
<tr><td>ĐỊA ĐIỂM:</td><td><a href="https://dezon.vn/khu-vuc/tp-ho-chi-minh/">TP. Hồ Chí Minh</a>, <a href="https://dezon.vn/quoc-gia/viet-nam/">Việt Nam</a>.</td></tr>
<tr><td>KIẾN TRÚC SƯ CHỦ TRÌ:</td><td>Phạm Huy Hiệu</td><tr></tbody></table></div><div class="col-lg-6"><table class="jtable"><tbody>
<tr><td>CÔNG TY:</td><td><a href="https://dezon.vn/studio/3a-design/">3A Design</a></td></tr></tbody></table></div></div>
<div class="project_editor_content"><p>Giới thiệu</p></div></div>
<div class="related_projects_wrapper"><table><tr><td>KHÁC:</td><td>x</td></tr></table><img src="` + dzU + `du-an-khac-720x581.jpg"></div>
<div id="dz-sec-suppliers"><img src="` + dzU + `ncc.png"></div>`
	d := parseDzDetail(page, "")
	want := map[string]string{"DỰ ÁN": "H House – Nhà ở", "DIỆN TÍCH": "392.5m2", "ĐỊA ĐIỂM": "TP. Hồ Chí Minh, Việt Nam.",
		"KIẾN TRÚC SƯ CHỦ TRÌ": "Phạm Huy Hiệu", "CÔNG TY": "3A Design"}
	if !reflect.DeepEqual(d.Info, want) {
		t.Errorf("Info:\n got %v\nwant %v", d.Info, want)
	}
	if d.Province != "TP. Hồ Chí Minh" || d.Country != "Việt Nam" || d.Category != "Nhà Phố" {
		t.Errorf("địa điểm / danh mục: %+v", d)
	}
	if g := []dzImage{{dzU + "h2.jpg", ""}, {dzU + "h5-1024x683.jpg", ""}}; !reflect.DeepEqual(d.Gallery, g) {
		t.Errorf("Gallery:\n got %+v\nwant %+v", d.Gallery, g)
	}
	f := dzFields(dzItem{Title: "H House"}, d)
	if f.Val("kienTrucSu") != "Phạm Huy Hiệu" || f.Val("tongDT") != "392.5m2" || f.Val("studio") != "3A Design" || f.Val("diaChi") != "TP. Hồ Chí Minh" {
		t.Errorf("dzFields mẫu cũ: %v", f)
	}
	// có cả nhãn KIẾN TRÚC SƯ thì nhãn đó thắng
	d.Info["KIẾN TRÚC SƯ"] = "KTS chính"
	if f := dzFields(dzItem{Title: "H"}, d); f.Val("kienTrucSu") != "KTS chính" {
		t.Errorf("thứ tự nhãn: %v", f.Val("kienTrucSu"))
	}
	// mẫu mới, không có mục Hình ảnh: dải trượt dừng trước khối dự án liên quan
	d = parseDzDetail(`<h1>X</h1><div class="project_slider"><img src="`+dzU+`a.jpg"></div><div class="related_projects_wrapper"><img src="`+dzU+`khac.jpg"></div>`, "")
	if !reflect.DeepEqual(d.Gallery, []dzImage{{dzU + "a.jpg", ""}}) {
		t.Errorf("dải trượt lấn sang dự án liên quan: %+v", d.Gallery)
	}
	// mục Hình ảnh dừng trước dự án liên quan; phòng tải thêm (load_more_rooms) nối vào cuối
	more := `<div class="project-room-section ajax-loaded-room"><h3 class="section-label mb-0"><a href="https://dezon.vn/phong/ngoai-that/">Ngoại thất</a></h3>
<a href="` + dzU + `n1.jpg"><img src="` + dzU + `n1.jpg"></a></div>`
	d = parseDzDetail(`<h1>X</h1><div class="project_info"></div><div id="dz-sec-rooms"><div class="project-room-section"><h3 class="section-label">Phòng khách</h3>`+
		`<img src="`+dzU+`r1.jpg"></div><div class="related_projects"><img src="`+dzU+`khac.jpg"></div></div>`, more)
	if g := []dzImage{{dzU + "r1.jpg", "Phòng khách"}, {dzU + "n1.jpg", "Ngoại thất"}}; !reflect.DeepEqual(d.Gallery, g) {
		t.Errorf("mục Hình ảnh:\n got %+v\nwant %+v", d.Gallery, g)
	}
}

// ảnh -scaled của WordPress và bản -WxH của nó (đặt theo tên gốc) là 1 ảnh; giữ bản -scaled.
func TestDzGalleryScaled(t *testing.T) {
	d := parseDzDetail(`<h1>X</h1><div class="project_slider"><a href="`+dzU+`26-1024x683.jpg"><img src="`+dzU+`26-scaled.jpg"></a>`+
		`<img src="`+dzU+`24-1024x683.jpg"><a href="`+dzU+`24-scaled.jpg"></a><img src="`+dzU+`17-1-3-scaled.jpg"></div><div class="project_info">`, "")
	want := []dzImage{{dzU + "26-scaled.jpg", ""}, {dzU + "24-scaled.jpg", ""}, {dzU + "17-1-3-scaled.jpg", ""}}
	if !reflect.DeepEqual(d.Gallery, want) {
		t.Errorf("Gallery:\n got %+v\nwant %+v", d.Gallery, want)
	}
	if dzImageKey(dzU+"x-scaled-1.webp") == dzImageKey(dzU+"x.webp") {
		t.Error("-scaled không ở cuối tên giữ nguyên")
	}
}

// project_thumb của REST chưa mã hoá %XX: vẫn trùng ảnh thư viện (đã mã hoá), ảnh bìa dùng bản của thư viện.
func TestDzSplitCoverEncoding(t *testing.T) {
	raw := dzU + "Bathroom-3-©-Frederik-scaled-1.webp"
	g := parseDzDetail(`<h1>X</h1><div class="project_slider"><img src="`+dzU+`a.jpg"><a href="`+dzU+`Bathroom-3-%C2%A9-Frederik-scaled-1.webp">`+
		`<img src="`+dzU+`MW-archstudio%E2%80%93Working-Space-1.jpg"></a></div><div class="project_info">`, "").Gallery
	if len(g) != 3 {
		t.Fatalf("Gallery: %+v", g)
	}
	c, rest := dzSplitCover(raw, g)
	if c.URL != dzU+"Bathroom-3-%C2%A9-Frederik-scaled-1.webp" || len(rest) != 2 {
		t.Errorf("bìa ©: %+v %+v", c, rest)
	}
	c, rest = dzSplitCover(dzU+"MW-archstudio–Working-Space-1.jpg", g)
	if c.URL != dzU+"MW-archstudio%E2%80%93Working-Space-1.jpg" || len(rest) != 2 {
		t.Errorf("bìa –: %+v %+v", c, rest)
	}
	if c, _ := dzSplitCover(dzU+"riêng.jpg", g); c.URL != dzU+"ri%C3%AAng.jpg" {
		t.Errorf("bìa riêng phải mã hoá như thư viện: %q", c.URL)
	}
}

// tên file ảnh theo ảnh gốc: bản thu nhỏ / -scaled cùng file, ảnh khác thì file khác.
func TestDzFileName(t *testing.T) {
	a := dzFileName(dzU + "a.jpg")
	if !reDzFile.MatchString(a) || a != dzFileName(dzU+"a-1024x683.jpg") || a != dzFileName("https://www.dezon.vn/wp-content/uploads/2026/11/A.JPG") {
		t.Errorf("cùng ảnh gốc phải cùng tên: %s", a)
	}
	if dzFileName(dzU+"a-scaled.jpg") != dzFileName(dzU+"a-768x512.jpg") || a == dzFileName(dzU+"b.jpg") {
		t.Error("-scaled / ảnh khác")
	}
	if p := dzPath(101, dzU+"a.jpg"); p != "dezonvn/101/"+a {
		t.Errorf("dzPath: %s", p)
	}
}

func TestDzAddress(t *testing.T) {
	cases := []struct{ prov, country, text, want string }{
		{"An Giang", "Việt Nam", "", "An Giang"},
		{"TP. Hồ Chí Minh", "", "", "TP. Hồ Chí Minh"},
		{"", "Việt Nam", "", "Việt Nam"},
		{"Bali", "Indonesia", "", "Bali, Indonesia"},
		{"", "Nhật Bản", "", "Nhật Bản"},
		{"", "viet nam", "", "viet nam"},
		{"", "", "Đà Nẵng, Việt Nam", "Đà Nẵng"},
		{"", "", "Tokyo, Nhật Bản", "Tokyo, Nhật Bản"},
		{"", "", "Singapore", "Singapore"},
		{"", "", "  ", ""},
	}
	for _, c := range cases {
		if got := dzAddress(c.prov, c.country, c.text); got != c.want {
			t.Errorf("dzAddress(%q, %q, %q) = %q, mong %q", c.prov, c.country, c.text, got, c.want)
		}
	}
}

func TestNormDezonURL(t *testing.T) {
	same := []string{"https://dezon.vn/du-an/g-loft/", "http://www.dezon.vn/du-an/g-loft", "HTTPS://DEZON.VN/du-an/G-Loft/?utm=1#x",
		"dezon.vn/du-an/g-loft", " https://dezon.vn/du-an/g%2Dloft/ "}
	for _, u := range same {
		if got := normDezonURL(u); got != "dezon.vn/du-an/g-loft" {
			t.Errorf("normDezonURL(%q) = %q", u, got)
		}
	}
	if normDezonURL("") != "" || normDezonURL("https://dezon.vn/du-an/khac/") == normDezonURL("https://dezon.vn/du-an/g-loft/") {
		t.Error("link rỗng / khác dự án")
	}
}

func TestDzImageKey(t *testing.T) {
	if dzImageKey(dzU+"a-1024x576.png") != dzImageKey(dzU+"a.png") || dzImageKey("https://www.dezon.vn/x/A-300X200.JPG?v=1") != "https://dezon.vn/x/a.jpg" {
		t.Error("khoá ảnh phải bỏ hậu tố kích thước")
	}
	if dzImageKey(dzU+"a-1.png") == dzImageKey(dzU+"a.png") {
		t.Error("hậu tố không phải kích thước giữ nguyên")
	}
	if got := dzOriginal(dzU + "x-scaled-1-720x401.jpg"); got != dzU+"x-scaled-1.jpg" {
		t.Errorf("dzOriginal: %q", got)
	}
	if !reflect.DeepEqual(dzCandidates(dzU+"a.png"), []string{dzU + "a.png"}) ||
		!reflect.DeepEqual(dzCandidates(dzU+"a-720x400.png"), []string{dzU + "a.png", dzU + "a-720x400.png"}) {
		t.Error("dzCandidates")
	}
}

func TestDzIntroCategory(t *testing.T) {
	if got := dzText("A&nbsp;&nbsp;<b>B</b>,<br>C &#038; D"); got != "A B, C & D" {
		t.Errorf("dzText: %q", got)
	}
	in := "<p>Đoạn 1 &#8211; giới thiệu<br />\nDòng 2 &amp; tiếp</p>\n<p>  Đoạn   2  </p><script>alert(1)</script>"
	if got := dzIntro(in, 4000); got != "Đoạn 1 – giới thiệu\nDòng 2 & tiếp\nĐoạn 2" {
		t.Errorf("dzIntro: %q", got)
	}
	if got := dzIntro("<p>"+strings.Repeat("ă", 50)+"</p>", 10); got != strings.Repeat("ă", 10) {
		t.Errorf("cắt theo ký tự: %q", got)
	}
	cls := []string{"post-1", "project_category-khach-san", "project_category-nha-o"}
	for _, c := range []struct{ crumb, title, want string }{
		{"Khách Sạn", "X", "Khách Sạn"}, {"", "X", "Khach san"}, {"Dự án", "X", "Khach san"}, {"X", "X", "Khach san"},
	} {
		if got := dzCategory(c.crumb, c.title, cls); got != c.want {
			t.Errorf("dzCategory(%q): %q, mong %q", c.crumb, got, c.want)
		}
	}
	if dzCategory("", "X", nil) != "" {
		t.Error("không có gì -> rỗng")
	}
}

func TestDzFieldsFillPatch(t *testing.T) {
	it := dzItem{ID: 1, Link: "https://dezon.vn/du-an/a/", Title: "A", Content: "<p>Giới thiệu</p>", Classes: []string{"project_category-can-ho"}}
	d := dzDetail{Info: map[string]string{"DIỆN TÍCH": "7m2", "KIẾN TRÚC SƯ": "KTS B", "CÔNG TY": "Studio C", "NĂM HOÀN THIỆN": "2020",
		"NHÀ THẦU THI CÔNG": "Thầu D", "ĐỊA ĐIỂM": "An Giang, Việt Nam"}, Province: "An Giang", Country: "Việt Nam", Category: "Căn Hộ"}
	f := dzFields(it, d)
	want := `{"ten":"A","linkDezon":"https://dezon.vn/du-an/a/","nenTang":"Dezon.vn","trangThai":"Hoàn thành","phanKhuc":"Căn Hộ",` +
		`"diaChi":"An Giang","tongDT":"7m2","kienTrucSu":"KTS B","nhaThauThiCong":"Thầu D","studio":"Studio C","namHoanThien":"2020","ghiChu":"Giới thiệu"}`
	if got, _ := omap.MarshalString(f); got != want {
		t.Errorf("dzFields:\n got %s\nwant %s", got, want)
	}
	row := omap.Of("ma_da", "DA-1", "ten_du_an", "Tên người dùng", "khach_hang", "Khách", "dia_chi", "  ", "kien_truc_su", nil,
		"trang_thai", "Bản nháp", "link_dezon", "dezon.vn/du-an/a", "studio", "Studio riêng")
	p := dzFillPatch(row, f)
	wantP := `{"nen_tang":"Dezon.vn","phan_khuc":"Căn Hộ","dia_chi":"An Giang","tong_dt":"7m2","kien_truc_su":"KTS B",` +
		`"nha_thau_thi_cong":"Thầu D","nam_hoan_thien":"2020","ghi_chu":"Giới thiệu"}`
	if got, _ := omap.MarshalString(p); got != wantP {
		t.Errorf("dzFillPatch (không đè ten / trang_thai / studio / link):\n got %s\nwant %s", got, wantP)
	}
	if dzAnhEmpty([]any{"x"}) || !dzAnhEmpty(nil) || !dzAnhEmpty([]any{}) || !dzAnhEmpty(omap.Undefined) || dzAnhEmpty("lạ") {
		t.Error("dzAnhEmpty")
	}
}

func TestDzSplitCover(t *testing.T) {
	g := []dzImage{{dzU + "a.jpg", ""}, {dzU + "b.jpg", "Phòng khách"}, {dzU + "c.jpg", ""}}
	c, rest := dzSplitCover(dzU+"b-720x400.jpg", g)
	if c != (dzImage{dzU + "b.jpg", "Phòng khách"}) || len(rest) != 2 || rest[0].URL != dzU+"a.jpg" || rest[1].URL != dzU+"c.jpg" {
		t.Errorf("bìa có trong thư viện: %+v %+v", c, rest)
	}
	c, rest = dzSplitCover(dzU+"z.jpg", g)
	if c.URL != dzU+"z.jpg" || len(rest) != 3 {
		t.Errorf("bìa riêng: %+v %+v", c, rest)
	}
	c, rest = dzSplitCover("", g)
	if c.URL != dzU+"a.jpg" || len(rest) != 2 {
		t.Errorf("không có bìa: %+v %+v", c, rest)
	}
	if c, rest = dzSplitCover("", nil); c.URL != "" || rest != nil {
		t.Error("không có ảnh")
	}
}

func dzPNG(t testing.TB, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y += 7 {
		for x := 0; x < w; x += 7 {
			img.Set(x, y, color.NRGBA{uint8(x), uint8(y), 90, 255})
		}
	}
	var b bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestDzShrinkJPEG(t *testing.T) {
	out, err := dzShrinkJPEG(dzPNG(t, 3000, 2000))
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil || format != "jpeg" || cfg.Width != 1280 || cfg.Height != 853 {
		t.Fatalf("ảnh ra: %v %s %dx%d", err, format, cfg.Width, cfg.Height)
	}
	// ảnh nhỏ: không phóng to; ảnh dọc
	out, err = dzShrinkJPEG(dzPNG(t, 600, 900))
	if err != nil {
		t.Fatal(err)
	}
	if cfg, _, _ := image.DecodeConfig(bytes.NewReader(out)); cfg.Width != 600 || cfg.Height != 900 {
		t.Errorf("ảnh nhỏ bị đổi cỡ: %dx%d", cfg.Width, cfg.Height)
	}
	var jb bytes.Buffer
	_ = jpeg.Encode(&jb, image.NewRGBA(image.Rect(0, 0, 900, 2000)), nil)
	if out, err = dzShrinkJPEG(jb.Bytes()); err != nil {
		t.Fatal(err)
	}
	if cfg, _, _ := image.DecodeConfig(bytes.NewReader(out)); cfg.Width != 576 || cfg.Height != 1280 {
		t.Errorf("JPEG dọc: %dx%d", cfg.Width, cfg.Height)
	}
	if _, err := dzShrinkJPEG([]byte("không phải ảnh")); err == nil {
		t.Error("dữ liệu lạ phải lỗi")
	}
}

func TestDzGetHost(t *testing.T) {
	d := newDezonImporter(nil)
	d.delay = 0
	for _, u := range []string{"https://evil.vn/x", "https://dezon.vn.evil.vn/x", "ftp://dezon.vn/x", "https://user@dezon.vn/x", "://"} {
		if _, _, err := d.get(context.Background(), u, time.Second, 10); err != errDzHost {
			t.Errorf("%s: %v", u, err)
		}
	}
}

// ───────────── cả lượt nhập (HTTP giả, repo trong bộ nhớ, kho file thật trong thư mục tạm) ─────────────

type dzFakeHTTP struct {
	mu    sync.Mutex
	pages map[string]string // URL (POST: "URL?thân form") -> thân
	hdr   map[string]http.Header
	hits  map[string]int
	fail  map[string]int // URL -> số lần đầu trả 503
	onHit func(u string) // gọi trước khi trả lời (giả người dùng sửa dữ liệu trong lúc lượt nhập chạy)
}

func dzNewFake() *dzFakeHTTP {
	return &dzFakeHTTP{pages: map[string]string{}, hdr: map[string]http.Header{}, hits: map[string]int{}, fail: map[string]int{}}
}

func (f *dzFakeHTTP) RoundTrip(r *http.Request) (*http.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u := r.URL.String()
	if r.Method == http.MethodPost {
		b, _ := io.ReadAll(r.Body)
		if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			return nil, io.ErrUnexpectedEOF
		}
		u += "?" + string(b)
	}
	f.hits[u]++
	if r.Header.Get("User-Agent") != dzUA {
		return nil, io.ErrUnexpectedEOF
	}
	if f.onHit != nil {
		f.onHit(u)
	}
	if f.fail[u] > 0 {
		f.fail[u]--
		return &http.Response{StatusCode: 503, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
	}
	body, ok := f.pages[u]
	if !ok {
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
	}
	h := f.hdr[u]
	if h == nil {
		h = http.Header{}
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: h, ContentLength: int64(len(body)), Request: r}, nil
}

func (f *dzFakeHTTP) imageHits() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for u, c := range f.hits {
		if strings.Contains(u, "/wp-content/uploads/") {
			n += c
		}
	}
	return n
}

// dzMemRepo: các lệnh repo mà lượt nhập dùng, an toàn khi chạy song song. Lệnh khác -> panic (Repository nil).
type dzMemRepo struct {
	Repository
	mu        sync.Mutex
	projects  []*omap.Map
	data      map[string]map[string]any // ma_da -> khoa -> gia_tri
	updates   []*omap.Map
	seen      []string           // dzSeenKey
	afterList func(r *dzMemRepo) // gọi (đang giữ mu) sau khi lượt nhập đã đọc danh sách lúc bắt đầu
}

func (r *dzMemRepo) DezonSeen(context.Context) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.seen...), nil
}
func (r *dzMemRepo) SaveDezonSeen(_ context.Context, links []string, _ string, _ any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seen = append([]string(nil), links...)
	return nil
}

func (r *dzMemRepo) ListDezonLinked(context.Context) ([]*omap.Map, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*omap.Map
	for _, p := range r.projects {
		if !jsval.IsNullish(p.Val("link_dezon")) {
			out = append(out, p.Clone())
		}
	}
	if r.afterList != nil {
		r.afterList(r)
	}
	return out, nil
}
func (r *dzMemRepo) FindProject(_ context.Context, maDA any) ([]*omap.Map, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range r.projects {
		if jsval.StrictEquals(p.Val("ma_da"), maDA) {
			return []*omap.Map{p.Clone()}, nil
		}
	}
	return nil, nil
}
func (r *dzMemRepo) InsertProject(_ context.Context, row *omap.Map) ([]*omap.Map, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.projects = append(r.projects, row.Clone())
	return []*omap.Map{row.Clone()}, nil
}
func (r *dzMemRepo) UpdateProject(_ context.Context, maDA any, patch *omap.Map) ([]*omap.Map, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.updates = append(r.updates, patch.Clone().Set("@ma", maDA))
	for _, p := range r.projects {
		if jsval.StrictEquals(p.Val("ma_da"), maDA) {
			patch.Each(func(k string, v any) { p.Set(k, v) })
			return []*omap.Map{p.Clone()}, nil
		}
	}
	return nil, nil
}
func (r *dzMemRepo) ListProjDataKV(_ context.Context, maDA string) ([]*omap.Map, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*omap.Map
	for k, v := range r.data[maDA] {
		out = append(out, omap.Of("khoa", k, "gia_tri", v))
	}
	return out, nil
}
func (r *dzMemRepo) FindProjData(_ context.Context, maDA, khoa string) ([]*omap.Map, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.data[maDA][khoa]; ok {
		return []*omap.Map{omap.Of("ma_da", maDA)}, nil
	}
	return nil, nil
}
func (r *dzMemRepo) setData(row *omap.Map) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	ma := jsval.S(row.Val("ma_da"))
	if r.data[ma] == nil {
		r.data[ma] = map[string]any{}
	}
	r.data[ma][jsval.S(row.Val("khoa"))] = row.Val("gia_tri")
	return nil
}
func (r *dzMemRepo) UpdateProjData(_ context.Context, _, _ string, row *omap.Map) error {
	return r.setData(row)
}
func (r *dzMemRepo) InsertProjData(_ context.Context, row *omap.Map) error { return r.setData(row) }

func dzWait(t *testing.T, s *Service, ctx context.Context) *omap.Map {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		st, err := s.DezonImportStatus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if st.Val("running") == false {
			return st
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("lượt nhập không xong")
	return nil
}

func TestDezonImportJob(t *testing.T) {
	png := string(dzPNG(t, 200, 120))
	fh := &dzFakeHTTP{pages: map[string]string{}, hdr: map[string]http.Header{}, hits: map[string]int{}, fail: map[string]int{}}
	list := `[{"id":101,"link":"https://dezon.vn/du-an/a/","title":{"rendered":"A &amp; B"},"content":{"rendered":"<p>Giới thiệu A</p>"},
		"class_list":["project_category-khach-san"],"project_thumb":"` + dzU + `cover-720x400.png"},
		{"id":102,"link":"https://dezon.vn/du-an/b/","title":{"rendered":"B"},"content":{"rendered":""},"class_list":[],"project_thumb":null},
		{"id":103,"link":"https://evil.vn/du-an/c/","title":{"rendered":"C"},"content":{"rendered":""},"class_list":[],"project_thumb":null}]`
	fh.pages[dzListURL(1)] = list
	fh.hdr[dzListURL(1)] = http.Header{"X-Wp-Totalpages": {"1"}, "X-Wp-Total": {"3"}}
	fh.fail[dzListURL(1)] = 1 // lỗi 503 lần đầu -> thử lại
	var rooms strings.Builder
	rooms.WriteString(`<div class="project-room-section"><h3 class="section-label">Phòng khách</h3>`)
	for i := 1; i <= 8; i++ {
		u := dzU + "g" + string(rune('0'+i)) + ".png"
		rooms.WriteString(`<a href="` + u + `"><img src="` + strings.TrimSuffix(u, ".png") + `-1024x683.png"></a>`)
		fh.pages[u] = png
	}
	rooms.WriteString(`</div>`)
	fh.pages["https://dezon.vn/du-an/a/"] = dzPage(`<tr><td class="fw-bold">DIỆN TÍCH:</td><td>120m2</td></tr>`,
		`<img src="`+dzU+`cover.png">`, rooms.String())
	fh.pages[dzU+"cover.png"] = png
	fh.pages["https://dezon.vn/du-an/b/"] = dzPage(`<tr><td class="fw-bold">KIẾN TRÚC SƯ:</td><td>KTS B</td></tr>
<tr><td class="fw-bold">ĐỊA ĐIỂM:</td><td><a href="https://dezon.vn/khu-vuc/an-giang/">An Giang</a>, <a href="https://dezon.vn/quoc-gia/viet-nam/">Việt Nam</a></td></tr>`,
		`<img src="`+dzU+`b1.png">`, "")
	fh.pages[dzU+"b1.png"] = png

	repo := &dzMemRepo{data: map[string]map[string]any{}, projects: []*omap.Map{
		omap.Of("ma_da", "DA-B", "ten_du_an", "Tên người dùng", "link_dezon", "http://www.dezon.vn/du-an/b", "trang_thai", "Đang thực hiện"),
		omap.Of("ma_da", "DA-X", "ten_du_an", "Không link", "link_dezon", nil),
	}}
	files := storage.New(t.TempDir())
	s := New(Deps{Repo: repo, Files: files})
	s.dz.client = &http.Client{Transport: fh}
	s.dz.delay, s.dz.retryWait = 0, time.Millisecond
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: 1.0, Role: "admin", CongTyID: "c1"})
	a := &actor.Actor{U: "admin1", R: "admin"}

	// chạy thử: không ghi, không tải ảnh
	if _, err := s.StartDezonImport(ctx, a, nil, true); err != nil {
		t.Fatal(err)
	}
	st := dzWait(t, s, ctx)
	if got, _ := omap.MarshalString(omap.Of("t", st.Val("total"), "c", st.Val("created"), "u", st.Val("updated"), "f", st.Val("failed"))); got != `{"t":3,"c":1,"u":1,"f":1}` {
		t.Errorf("chạy thử: %s", got)
	}
	if len(repo.projects) != 2 || len(repo.updates) != 0 || fh.imageHits() != 0 {
		t.Fatalf("chạy thử đã ghi / tải ảnh: %d dự án, %d sửa, %d ảnh", len(repo.projects), len(repo.updates), fh.imageHits())
	}

	if _, err := s.StartDezonImport(ctx, a, 0.0, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	got, _ := omap.MarshalString(st)
	if !strings.Contains(got, `"total":3,"done":3,"created":1,"updated":1,"skipped":0,"failed":1,"images":8,"imagesFailed":0`) ||
		!strings.Contains(got, `Link dự án không thuộc dezon.vn`) {
		t.Fatalf("lượt nhập: %s", got)
	}
	if len(repo.projects) != 3 {
		t.Fatalf("phải tạo 1 dự án: %d", len(repo.projects))
	}
	np := repo.projects[2]
	for k, v := range map[string]string{"ten_du_an": "A & B", "link_dezon": "https://dezon.vn/du-an/a/", "nen_tang": "Dezon.vn",
		"trang_thai": "Hoàn thành", "phan_khuc": "Thương Mại & Văn Phòng", "tong_dt": "120m2", "ghi_chu": "Giới thiệu A"} {
		if jsval.S(np.Val(k)) != v {
			t.Errorf("dự án mới %s = %v, mong %q", k, np.Val(k), v)
		}
	}
	if np.Has("khach_hang") {
		t.Error("khachHang phải để trống")
	}
	b := repo.projects[0]
	if b.Val("ten_du_an") != "Tên người dùng" || b.Val("trang_thai") != "Đang thực hiện" || b.Val("kien_truc_su") != "KTS B" ||
		b.Val("dia_chi") != "An Giang" || b.Val("nen_tang") != "Dezon.vn" {
		t.Errorf("dự án có sẵn: chỉ điền ô trống: %v", b)
	}
	anh := jsval.AsArray(repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"])
	if len(anh) != 9 {
		t.Fatalf("anhDuAn của dự án mới: %d ảnh %v", len(anh), anh)
	}
	// ảnh lưu trên máy chủ: 0 = bìa (cover.png), 1..6 = g1..g6; tên file theo ảnh gốc
	src := func(i int) string {
		if i == 0 {
			return dzU + "cover.png"
		}
		return dzU + "g" + string(rune('0'+i)) + ".png"
	}
	for i, x := range anh {
		u := dzAnhURL(x)
		if i < 7 && u != "/files/"+dzPath(101, src(i)) {
			t.Errorf("ảnh %d phải lưu trên máy chủ: %v", i, x)
		}
		if i >= 7 && u != dzU+"g"+string(rune('0'+i))+".png" {
			t.Errorf("ảnh %d giữ link dezon.vn: %v", i, x)
		}
	}
	if dzAnhURL(anh[1]) == "" || jsval.Get(anh[1], "phong") != "Phòng khách" {
		t.Errorf("ảnh thư viện kèm phòng: %v", anh[1])
	}
	if fh.hits[dzU+"cover-720x400.png"] != 0 || fh.hits[dzU+"cover.png"] != 1 {
		t.Error("ảnh bìa phải tải bản gốc")
	}
	for i := 0; i < 7; i++ {
		f, st, err := files.Open(dzPath(101, src(i)))
		if err != nil {
			t.Fatalf("thiếu file ảnh %d: %v", i, err)
		}
		f.Close()
		if st.Size() == 0 {
			t.Errorf("file ảnh %d rỗng", i)
		}
	}
	if bAnh := jsval.AsArray(repo.data["DA-B"]["anhDuAn"]); len(bAnh) != 1 || dzAnhURL(bAnh[0]) != "/files/"+dzPath(102, dzU+"b1.png") {
		t.Errorf("anhDuAn dự án có sẵn: %v", bAnh)
	}

	// chạy lại: không trùng dự án, không tải lại ảnh, không đè gì
	hits := fh.imageHits()
	nUpd := len(repo.updates)
	if _, err := s.StartDezonImport(ctx, a, nil, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	if st.Val("skipped") != 2.0 || st.Val("created") != 0.0 || len(repo.projects) != 3 || fh.imageHits() != hits || len(repo.updates) != nUpd {
		t.Errorf("chạy lại: %v, %d dự án, ảnh %d -> %d", st, len(repo.projects), hits, fh.imageHits())
	}

	// lượt trước đã nhập: người dùng xoá hết ảnh ([]) / xoá trống ô -> không thêm lại
	if len(repo.seen) != 2 || repo.seen[0] != normDezonURL("https://dezon.vn/du-an/a/") {
		t.Fatalf("danh sách đã nhập: %v", repo.seen)
	}
	repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"] = []any{}
	repo.projects[0].Set("kien_truc_su", nil)
	hits, nUpd = fh.imageHits(), len(repo.updates)
	if _, err := s.StartDezonImport(ctx, a, nil, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	if st.Val("skipped") != 2.0 || fh.imageHits() != hits || len(repo.updates) != nUpd ||
		len(jsval.AsArray(repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"])) != 0 || repo.projects[0].Val("kien_truc_su") != nil {
		t.Errorf("không được điền lại ô / ảnh người dùng đã xoá: %v", st)
	}

	// anhDuAn chưa từng lưu (lượt trước tải ảnh hỏng hết) -> file đã có dùng lại, không tải
	delete(repo.data[jsval.S(np.Val("ma_da"))], "anhDuAn")
	if _, err := s.StartDezonImport(ctx, a, 1.0, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	if st.Val("total") != 1.0 || st.Val("updated") != 1.0 || st.Val("images") != 7.0 || fh.imageHits() != hits {
		t.Errorf("dùng lại file đã có: %v, ảnh %d -> %d", st, hits, fh.imageHits())
	}
	if len(jsval.AsArray(repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"])) != 9 {
		t.Error("anhDuAn phải được ghi lại")
	}

	// khôi phục bản sao lưu không có dezonvn/: file mất -> tải lại đúng đường dẫn, anhDuAn giữ nguyên
	if err := files.Remove(dzPath(101, src(3))); err != nil {
		t.Fatal(err)
	}
	truoc := omap.DeepClone(repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"])
	g3 := fh.hits[dzU+"g3.png"]
	if _, err := s.StartDezonImport(ctx, a, 1.0, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	if st.Val("updated") != 1.0 || st.Val("images") != 1.0 || fh.imageHits() != hits+1 || fh.hits[dzU+"g3.png"] != g3+1 {
		t.Errorf("tải lại ảnh mất: %v, ảnh %d -> %d", st, hits, fh.imageHits())
	}
	if f, _, err := files.Open(dzPath(101, src(3))); err != nil {
		t.Error("ảnh 3 chưa được tải lại")
	} else {
		f.Close()
	}
	if j1, j2 := dzJSON(truoc), dzJSON(repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"]); j1 != j2 {
		t.Error("tải lại ảnh không được ghi lại anhDuAn")
	}

	// thư viện trên dezon.vn đổi (g1 thay bằng g9) rồi anhDuAn bị xoá: không dùng nhầm file cũ của vị trí 1 mà tải g9
	g9 := dzU + "g9.png"
	fh.mu.Lock()
	fh.pages[g9] = png
	fh.pages["https://dezon.vn/du-an/a/"] = strings.Replace(fh.pages["https://dezon.vn/du-an/a/"], dzU+"g1", dzU+"g9", -1)
	fh.mu.Unlock()
	delete(repo.data[jsval.S(np.Val("ma_da"))], "anhDuAn")
	hits = fh.imageHits()
	if _, err := s.StartDezonImport(ctx, a, 1.0, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	anh = jsval.AsArray(repo.data[jsval.S(np.Val("ma_da"))]["anhDuAn"])
	if st.Val("images") != 7.0 || fh.hits[g9] != 1 || fh.imageHits() != hits+1 || len(anh) != 9 ||
		dzAnhURL(anh[1]) != "/files/"+dzPath(101, g9) || dzAnhURL(anh[2]) != "/files/"+dzPath(101, src(2)) {
		t.Errorf("thư viện đổi: %v, ảnh %d -> %d, anhDuAn %v", st, hits, fh.imageHits(), anh)
	}

	// người dùng xoá dự án đã nhập -> lượt sau không tạo lại
	repo.mu.Lock()
	repo.projects = repo.projects[:2]
	repo.mu.Unlock()
	if _, err := s.StartDezonImport(ctx, a, nil, false); err != nil {
		t.Fatal(err)
	}
	st = dzWait(t, s, ctx)
	if st.Val("created") != 0.0 || len(repo.projects) != 2 || len(repo.seen) != 2 {
		t.Errorf("tạo lại dự án đã xoá: %v, %d dự án, đã nhập %v", st, len(repo.projects), repo.seen)
	}
}

// dự án có sẵn: người dùng sửa ô / thêm ảnh trong lúc lượt nhập chạy -> lượt nhập không đè (đọc lại trước khi ghi).
func TestDezonImportFreshRow(t *testing.T) {
	png := string(dzPNG(t, 60, 40))
	fh := dzNewFake()
	fh.pages[dzListURL(1)] = `[{"id":301,"link":"https://dezon.vn/du-an/f/","title":{"rendered":"F"},"content":{"rendered":"<p>Giới thiệu F</p>"},"class_list":[],"project_thumb":null}]`
	fh.pages["https://dezon.vn/du-an/f/"] = dzPage(`<tr><td class="fw-bold">KIẾN TRÚC SƯ:</td><td>KTS dezon</td></tr>
<tr><td class="fw-bold">DIỆN TÍCH:</td><td>80m2</td></tr>`, `<img src="`+dzU+`f1.png">`, "")
	fh.pages[dzU+"f1.png"] = png
	repo := &dzMemRepo{data: map[string]map[string]any{}, projects: []*omap.Map{
		omap.Of("ma_da", "DA-F", "ten_du_an", "F", "link_dezon", "https://dezon.vn/du-an/f/", "kien_truc_su", nil, "ghi_chu", ""),
	}}
	repo.afterList = func(r *dzMemRepo) { // người dùng điền sau khi lượt nhập đã đọc danh sách
		r.projects[0].Set("kien_truc_su", "KTS người dùng").Set("ghi_chu", "Ghi chú người dùng")
	}
	fh.onHit = func(u string) { // người dùng thêm ảnh trong lúc lượt nhập tải ảnh
		if u == dzU+"f1.png" {
			_ = repo.setData(omap.Of("ma_da", "DA-F", "khoa", "anhDuAn", "gia_tri", []any{"/files/uploads/cua-toi.jpg"}))
		}
	}
	s := New(Deps{Repo: repo, Files: storage.New(t.TempDir())})
	s.dz.client = &http.Client{Transport: fh}
	s.dz.delay, s.dz.retryWait = 0, time.Millisecond
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: 1.0, Role: "admin", CongTyID: "c1"})
	if _, err := s.StartDezonImport(ctx, &actor.Actor{U: "admin1"}, nil, false); err != nil {
		t.Fatal(err)
	}
	st := dzWait(t, s, ctx)
	if st.Val("updated") != 1.0 || st.Val("failed") != 0.0 {
		t.Fatalf("lượt nhập: %v", st)
	}
	p := repo.projects[0]
	if p.Val("kien_truc_su") != "KTS người dùng" || p.Val("ghi_chu") != "Ghi chú người dùng" || p.Val("tong_dt") != "80m2" {
		t.Errorf("đè dữ liệu người dùng sửa trong lúc chạy: %v", p)
	}
	if len(repo.updates) != 1 || repo.updates[0].Has("kien_truc_su") || repo.updates[0].Has("ghi_chu") {
		t.Errorf("patch: %v", repo.updates)
	}
	if got := dzJSON(repo.data["DA-F"]["anhDuAn"]); got != `["/files/uploads/cua-toi.jpg"]` {
		t.Errorf("đè ảnh người dùng thêm trong lúc chạy: %s", got)
	}
}

// ảnh bìa / 6 ảnh đầu tải hỏng ở lần trước (anhDuAn giữ link dezon.vn) -> chạy lại tải lại và chỉ thay đúng ô đó;
// ô người dùng đã thay giữ nguyên. Phòng sau nút "Xem thêm" tải qua admin-ajax load_more_rooms.
func TestDezonImportRetryExternal(t *testing.T) {
	png := string(dzPNG(t, 60, 40))
	fh := dzNewFake()
	fh.pages[dzListURL(1)] = `[{"id":201,"link":"https://dezon.vn/du-an/r/","title":{"rendered":"R"},"content":{"rendered":""},"class_list":[],"project_thumb":null}]`
	rooms := `<div class="project-room-section"><h3 class="section-label">Phòng khách</h3><img src="` + dzU + `p3.png"></div>
<div id="load-more-rooms-container"><a href="javascript:void(0);" id="btn-ajax-load-more"
 class="btn" data-post-id="201" data-offset="4" data-loading-text="Đang tải..."> Xem thêm </a></div>`
	fh.pages["https://dezon.vn/du-an/r/"] = dzPage("", `<img src="`+dzU+`p1.png"><img src="`+dzU+`p2-1024x683.png">`, rooms)
	ajax := func(off string) string { return dzAjaxURL + "?action=load_more_rooms&offset=" + off + "&post_id=201" }
	fh.pages[ajax("4")] = `{"success":true,"data":{"html":"<div class=\"project-room-section\"><h3 class=\"section-label\">Phòng bếp<\/h3><img src=\"` +
		dzU + `p4.png\"><\/div>","remaining":1}}`
	fh.pages[ajax("7")] = `{"success":true,"data":{"html":"<div class=\"project-room-section\"><h3 class=\"section-label\">Ngoại thất<\/h3><img src=\"` +
		dzU + `p5.png\"><\/div>","remaining":0}}`
	for _, n := range []string{"p1", "p2", "p3", "p4", "p5"} {
		fh.pages[dzU+n+".png"] = png
	}
	fh.fail[dzU+"p2.png"], fh.fail[dzU+"p2-1024x683.png"] = 3, 3 // hỏng cả ảnh gốc lẫn bản thu nhỏ
	fh.fail[dzU+"p3.png"] = 3
	repo := &dzMemRepo{data: map[string]map[string]any{}}
	files := storage.New(t.TempDir())
	s := New(Deps{Repo: repo, Files: files})
	s.dz.client = &http.Client{Transport: fh}
	s.dz.delay, s.dz.retryWait = 0, time.Millisecond
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: 1.0, Role: "admin", CongTyID: "c1"})
	a := &actor.Actor{U: "admin1"}
	run := func() *omap.Map {
		t.Helper()
		if _, err := s.StartDezonImport(ctx, a, nil, false); err != nil {
			t.Fatal(err)
		}
		return dzWait(t, s, ctx)
	}
	st := run()
	if st.Val("created") != 1.0 || st.Val("images") != 3.0 || st.Val("imagesFailed") != 2.0 {
		t.Fatalf("lần 1: %v", st)
	}
	ma := jsval.S(repo.projects[0].Val("ma_da"))
	got := dzJSON(repo.data[ma]["anhDuAn"])
	want := `["/files/` + dzPath(201, dzU+"p1.png") + `","` + dzU + `p2-1024x683.png",{"url":"` + dzU + `p3.png","phong":"Phòng khách"},` +
		`{"url":"/files/` + dzPath(201, dzU+"p4.png") + `","phong":"Phòng bếp"},{"url":"/files/` + dzPath(201, dzU+"p5.png") + `","phong":"Ngoại thất"}]`
	if got != want {
		t.Fatalf("anhDuAn lần 1 (kèm phòng tải thêm):\n got %s\nwant %s", got, want)
	}
	if fh.hits[ajax("4")] != 1 || fh.hits[ajax("7")] != 1 {
		t.Errorf("load_more_rooms: %v", fh.hits)
	}
	// người dùng thay ô 2 (p3) bằng ảnh của mình
	arr := append([]any(nil), jsval.AsArray(repo.data[ma]["anhDuAn"])...)
	arr[2] = omap.Of("url", "/files/uploads/cua-toi.jpg", "phong", "Phòng khách")
	repo.data[ma]["anhDuAn"] = arr
	p3 := fh.hits[dzU+"p3.png"]
	st = run()
	if st.Val("updated") != 1.0 || st.Val("images") != 1.0 || st.Val("imagesFailed") != 0.0 || fh.hits[dzU+"p3.png"] != p3 {
		t.Errorf("lần 2: %v", st)
	}
	got = dzJSON(repo.data[ma]["anhDuAn"])
	want = `["/files/` + dzPath(201, dzU+"p1.png") + `","/files/` + dzPath(201, dzU+"p2.png") + `",{"url":"/files/uploads/cua-toi.jpg","phong":"Phòng khách"},` +
		`{"url":"/files/` + dzPath(201, dzU+"p4.png") + `","phong":"Phòng bếp"},{"url":"/files/` + dzPath(201, dzU+"p5.png") + `","phong":"Ngoại thất"}]`
	if got != want {
		t.Errorf("anhDuAn lần 2:\n got %s\nwant %s", got, want)
	}
	// lần 3: không còn gì để làm
	if st = run(); st.Val("skipped") != 1.0 || st.Val("images") != 0.0 {
		t.Errorf("lần 3: %v", st)
	}
}

func TestDezonImportGuards(t *testing.T) {
	s := New(Deps{Repo: &dzMemRepo{data: map[string]map[string]any{}}})
	gate := make(chan struct{})
	s.dz.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		<-gate
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: r}, nil
	})}
	s.dz.delay, s.dz.retryWait = 0, time.Millisecond
	super := tenant.With(context.Background(), tenant.Ctx{Role: "super"})
	if _, err := s.StartDezonImport(super, nil, nil, false); err == nil || !strings.Contains(err.Error(), "Chọn công ty") {
		t.Errorf("super chưa chọn công ty: %v", err)
	}
	if _, err := s.DezonImportStatus(super); err == nil {
		t.Error("trạng thái: super chưa chọn công ty phải lỗi")
	}
	ctx := tenant.With(context.Background(), tenant.Ctx{Role: "super", ViewAs: "c9"})
	for _, l := range []any{-1.0, 1.5, "abc"} {
		if _, err := s.StartDezonImport(ctx, nil, l, false); err == nil {
			t.Errorf("limit %v phải lỗi", l)
		}
	}
	st, err := s.DezonImportStatus(ctx)
	if err != nil || st.Val("running") != false || st.Val("startedAt") != nil {
		t.Fatalf("chưa chạy: %v %v", st, err)
	}
	if _, err := s.StartDezonImport(ctx, nil, nil, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartDezonImport(ctx, nil, nil, false); err == nil || !strings.Contains(err.Error(), "Đang nhập") {
		t.Errorf("chạy trùng phải 409: %v", err)
	}
	close(gate)
	st = dzWait(t, s, ctx)
	if !strings.Contains(jsval.Str(jsval.Get(jsval.AsArray(st.Val("errors"))[0], "error")), "HTTP 404") {
		t.Errorf("lỗi danh sách: %v", st)
	}
	// không có database
	if _, err := New(Deps{}).StartDezonImport(ctx, nil, nil, false); err == nil || !strings.Contains(err.Error(), "database") {
		t.Errorf("không database: %v", err)
	}
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := s.StartDezonImport(cctx, nil, nil, false); err == nil {
		t.Error("request đã huỷ không được chạy")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func dzJSON(v any) string { s, _ := omap.MarshalString(v); return s }

const dzSupSec = `<div id="dz-sec-suppliers"><h2>Nhà cung cấp</h2><div class="dz-proj-supscroll">
 <a class="dz-proj-supcard" href="https://shop.dezon.vn/nha-cung-cap/dulux-2/" target="_blank"> <span class="dz-proj-supname">Dulux</span>
 <span class="dz-proj-supdesc">AkzoNobel là công ty &amp; sơn…</span> </a>
 <a class="dz-proj-supcard" href="https://evil.vn/x"><span class="dz-proj-supname">Việt An</span></a>
 <a class="dz-proj-supcard" href="https://shop.dezon.vn/nha-cung-cap/dulux-3/"><span class="dz-proj-supname">DULUX</span></a>
</div></div><div id="project_suppliers_container"><a class="dz-proj-supcard" href="https://shop.dezon.vn/a/"><span class="dz-proj-supname">Ẩn</span></a></div>
<div id="dz-sec-contractor"><a class="dz-proj-supcard"><span class="dz-proj-supname">Không phải NCC</span></a></div>`

func TestDzSuppliers(t *testing.T) {
	got := dzSuppliers(`<html>` + dzSupSec + `</html>`)
	want := []dzSupplier{{Ten: "Dulux", Link: "https://shop.dezon.vn/nha-cung-cap/dulux-2/", MoTa: "AkzoNobel là công ty & sơn…"}, {Ten: "Việt An"}}
	if len(got) != len(want) {
		t.Fatalf("dzSuppliers: %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("thẻ %d: %+v, mong %+v", i, got[i], want[i])
		}
	}
	if s := dzSuppliers(`<div id="dz-sec-rooms"></div>`); s != nil {
		t.Errorf("trang không có mục Nhà cung cấp: %+v", s)
	}
	if got := dzJSON(dzNccValue(want)); got != `[{"ten":"Dulux","link":"https://shop.dezon.vn/nha-cung-cap/dulux-2/","moTa":"AkzoNobel là công ty & sơn…"},{"ten":"Việt An"}]` {
		t.Errorf("dzNccValue: %s", got)
	}
}

// nhà cung cấp của dự án trên dezon.vn -> khoá nccDezon: dự án mới / đã nhập lần trước mà chưa có khoá thì ghi;
// người dùng đã xoá ([]) hoặc đã có thì giữ nguyên.
func TestDezonImportSuppliers(t *testing.T) {
	fh := dzNewFake()
	fh.pages[dzListURL(1)] = `[{"id":401,"link":"https://dezon.vn/du-an/s/","title":{"rendered":"S"},"content":{"rendered":""},"class_list":[],"project_thumb":null},
		{"id":402,"link":"https://dezon.vn/du-an/t/","title":{"rendered":"T"},"content":{"rendered":""},"class_list":[],"project_thumb":null},
		{"id":403,"link":"https://dezon.vn/du-an/u/","title":{"rendered":"U"},"content":{"rendered":""},"class_list":[],"project_thumb":null}]`
	for _, k := range []string{"s", "t", "u"} {
		fh.pages["https://dezon.vn/du-an/"+k+"/"] = strings.Replace(dzPage("", "", ""), `<div id="dz-sec-suppliers"><img src="`+dzU+`logo-ncc.png"></div>`, dzSupSec, 1)
	}
	repo := &dzMemRepo{data: map[string]map[string]any{"DA-T": {"nccDezon": []any{}}}, projects: []*omap.Map{
		omap.Of("ma_da", "DA-T", "ten_du_an", "T", "link_dezon", "https://dezon.vn/du-an/t/"),
		omap.Of("ma_da", "DA-U", "ten_du_an", "U", "link_dezon", "https://dezon.vn/du-an/u/"),
	}, seen: []string{normDezonURL("https://dezon.vn/du-an/t/"), normDezonURL("https://dezon.vn/du-an/u/")}}
	s := New(Deps{Repo: repo, Files: storage.New(t.TempDir())})
	s.dz.client = &http.Client{Transport: fh}
	s.dz.delay, s.dz.retryWait = 0, time.Millisecond
	ctx := tenant.With(context.Background(), tenant.Ctx{UID: 1.0, Role: "admin", CongTyID: "c1"})
	if _, err := s.StartDezonImport(ctx, &actor.Actor{U: "admin1"}, nil, false); err != nil {
		t.Fatal(err)
	}
	st := dzWait(t, s, ctx)
	if st.Val("created") != 1.0 || st.Val("updated") != 1.0 || st.Val("skipped") != 1.0 || st.Val("failed") != 0.0 {
		t.Fatalf("lượt nhập: %v", st)
	}
	ncc := `[{"ten":"Dulux","link":"https://shop.dezon.vn/nha-cung-cap/dulux-2/","moTa":"AkzoNobel là công ty & sơn…"},{"ten":"Việt An"}]`
	newMa := jsval.S(repo.projects[2].Val("ma_da"))
	if got := dzJSON(repo.data[newMa]["nccDezon"]); got != ncc {
		t.Errorf("dự án mới: %s", got)
	}
	if got := dzJSON(repo.data["DA-U"]["nccDezon"]); got != ncc {
		t.Errorf("dự án đã nhập lần trước, chưa có nccDezon: %s", got)
	}
	if got := dzJSON(repo.data["DA-T"]["nccDezon"]); got != `[]` {
		t.Errorf("người dùng đã xoá nhà cung cấp: %s", got)
	}
}
