package projects

// Nhập dự án từ dezon.vn (WordPress, kiểu bài "project"): hàm thuần đọc danh sách REST, trang chi tiết HTML,
// chuẩn hoá link / địa chỉ, dựng trường dự án QS. Nghiệp vụ chạy nền ở service_dezonvn.go, ảnh ở dezonvn_image.go.

import (
	"encoding/json"
	"html"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

// dzItem: 1 bài "project" của REST /wp-json/wp/v2/project.
type dzItem struct {
	ID      int64
	Link    string
	Title   string // đã giải mã thực thể HTML
	Content string // HTML giới thiệu
	Thumb   string // ảnh bìa (có thể là bản thu nhỏ -WxH), "" khi không có
	Classes []string
}

// dzImage: 1 ảnh của dự án trên dezon.vn; Phong = tên phòng (mục Hình ảnh), "" = ảnh của dải trượt đầu trang.
type dzImage struct {
	URL   string
	Phong string
}

// dzDetail: phần đọc được từ trang chi tiết.
type dzDetail struct {
	Info      map[string]string // nhãn IN HOA (bỏ dấu ":") -> giá trị chữ
	Province  string            // ĐỊA ĐIỂM: link /khu-vuc/
	Country   string            // ĐỊA ĐIỂM: link /quoc-gia/
	Category  string            // breadcrumb cuối ("Khách Sạn")
	Gallery   []dzImage         // dải trượt rồi mục Hình ảnh, đã bỏ trùng (ưu tiên ảnh gốc)
	Suppliers []dzSupplier      // mục "Nhà cung cấp" (id="dz-sec-suppliers"), theo thứ tự trên trang, bỏ trùng tên
}

// dzSupplier: 1 thẻ nhà cung cấp của dự án trên dezon.vn (link trang nhà cung cấp trên *.dezon.vn, mô tả ngắn).
type dzSupplier struct{ Ten, Link, MoTa string }

const dzMaxSuppliers = 40

var (
	reDzSupCard = regexp.MustCompile(`(?is)(<a\b[^>]*\bclass="dz-proj-supcard"[^>]*>)(.*?)</a>`)
	reDzHref    = regexp.MustCompile(`(?i)\bhref="([^"]*)"`)
	reDzSupName = regexp.MustCompile(`(?is)<span[^>]*\bclass="dz-proj-supname"[^>]*>(.*?)</span>`)
	reDzSupDesc = regexp.MustCompile(`(?is)<span[^>]*\bclass="dz-proj-supdesc"[^>]*>(.*?)</span>`)
)

// dzSuppliers: thẻ nhà cung cấp trong mục id="dz-sec-suppliers" (tới mục dz-sec- kế tiếp / khối slider ẩn / <style>).
// Link chỉ giữ khi là http(s) trên dezon.vn hoặc tên miền con (shop.dezon.vn), khác thì để trống.
func dzSuppliers(page string) []dzSupplier {
	const mark = `id="dz-sec-suppliers"`
	seg := dzCut(page, mark)
	if seg == "" {
		return nil
	}
	seg = seg[len(mark):]
	seg = seg[:dzFirst(seg, `id="dz-sec-`, `project_suppliers_container`, `<style`, "related_projects")]
	var out []dzSupplier
	seen := map[string]bool{}
	for _, m := range reDzSupCard.FindAllStringSubmatch(seg, -1) {
		n := reDzSupName.FindStringSubmatch(m[2])
		if n == nil {
			continue
		}
		ten := dzText(n[1])
		k := strings.ToLower(ten)
		if ten == "" || seen[k] {
			continue
		}
		seen[k] = true
		sp := dzSupplier{Ten: ten}
		if h := reDzHref.FindStringSubmatch(m[1]); h != nil {
			sp.Link = dzSiteLink(html.UnescapeString(h[1]))
		}
		if d := reDzSupDesc.FindStringSubmatch(m[2]); d != nil {
			sp.MoTa = dzText(d[1])
		}
		out = append(out, sp)
		if len(out) >= dzMaxSuppliers {
			break
		}
	}
	return out
}

// dzSiteLink: link http(s) tới dezon.vn / *.dezon.vn (giữ nguyên), khác -> "".
func dzSiteLink(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	h := strings.ToLower(u.Hostname())
	if h != "dezon.vn" && !strings.HasSuffix(h, ".dezon.vn") {
		return ""
	}
	return u.String()
}

// dzNccValue: giá trị khoá nccDezon của dự án - [{ten, link, moTa}] (bỏ khoá rỗng).
func dzNccValue(list []dzSupplier) []any {
	out := make([]any, 0, len(list))
	for _, s := range list {
		o := omap.Of("ten", s.Ten)
		if s.Link != "" {
			o.Set("link", s.Link)
		}
		if s.MoTa != "" {
			o.Set("moTa", s.MoTa)
		}
		out = append(out, o)
	}
	return out
}

// parseDzList: mảng JSON của REST. class_list có thể là mảng hoặc object {số: tên}; project_thumb chuỗi / null / false.
func parseDzList(b []byte) ([]dzItem, error) {
	var raw []struct {
		ID    int64  `json:"id"`
		Link  string `json:"link"`
		Title struct {
			Rendered string `json:"rendered"`
		} `json:"title"`
		Content struct {
			Rendered string `json:"rendered"`
		} `json:"content"`
		Thumb     json.RawMessage `json:"project_thumb"`
		ClassList json.RawMessage `json:"class_list"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	out := make([]dzItem, 0, len(raw))
	for _, r := range raw {
		it := dzItem{ID: r.ID, Link: strings.TrimSpace(r.Link), Title: dzText(r.Title.Rendered), Content: r.Content.Rendered}
		var th string
		if json.Unmarshal(r.Thumb, &th) == nil {
			it.Thumb = strings.TrimSpace(th)
		}
		var arr []string
		if json.Unmarshal(r.ClassList, &arr) == nil {
			it.Classes = arr
		} else {
			var m map[string]string
			if json.Unmarshal(r.ClassList, &m) == nil {
				for _, v := range m {
					it.Classes = append(it.Classes, v)
				}
			}
		}
		out = append(out, it)
	}
	return out, nil
}

var (
	reDzTag      = regexp.MustCompile(`(?s)<[^>]*>`)
	reDzScript   = regexp.MustCompile(`(?is)<(script|style|noscript)\b.*?</(script|style|noscript)>`)
	reDzBr       = regexp.MustCompile(`(?i)<br\s*/?>`)
	reDzBlockEnd = regexp.MustCompile(`(?i)</(p|div|li|h[1-6]|tr|blockquote)>`)
	reDzSpaces   = regexp.MustCompile(`[ \t\f\v]+`)
	reDzNewlines = regexp.MustCompile(`\n{2,}`)
	reDzInfoRow  = regexp.MustCompile(`(?is)<td[^>]*class="[^"]*\bfw-bold\b[^"]*"[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>`)
	// mẫu trang cũ (table.jtable trong project_content): ô nhãn không có fw-bold, chữ nhãn kết thúc bằng ":"
	reDzInfoRowOld = regexp.MustCompile(`(?is)<td[^>]*>\s*([^<]{2,60}?:)\s*</td>\s*<td[^>]*>(.*?)</td>`)
	reDzLink       = regexp.MustCompile(`(?is)<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>(.*?)</a>`)
	reDzCrumb      = regexp.MustCompile(`(?is)class="[^"]*\bbreadcrumb_last\b[^"]*"[^>]*>(.*?)</span>`)
	reDzAttr       = regexp.MustCompile(`(?i)\s(?:data-src|data-lazy-src|data-original|src|href)\s*=\s*["']([^"']+)["']`)
	reDzRoomH3     = regexp.MustCompile(`(?is)<h3\b[^>]*\bsection-label\b[^>]*>(.*?)</h3>`)
	reDzSize       = regexp.MustCompile(`(?i)-\d{2,5}x\d{2,5}(\.[a-z0-9]+)$`)
	reDzScaled     = regexp.MustCompile(`(?i)-scaled(\.[a-z0-9]+)$`)
	reDzImgPath    = regexp.MustCompile(`(?i)^/wp-content/uploads/.+\.(jpe?g|png|webp|gif)$`)
)

// dzNBSP: dấu cách không ngắt (&nbsp;).
const dzNBSP = string(rune(0xA0))

// dzText: HTML ngắn -> chữ 1 dòng (bỏ thẻ, giải mã thực thể, gộp khoảng trắng, NFC).
func dzText(s string) string {
	s = reDzTag.ReplaceAllString(reDzBr.ReplaceAllString(s, " "), "")
	s = strings.ReplaceAll(html.UnescapeString(s), dzNBSP, " ")
	return norm.NFC.String(strings.Join(strings.Fields(s), " "))
}

// dzIntro: HTML giới thiệu -> chữ, mỗi đoạn / dòng xuống dòng 1 lần, cắt còn tối đa max ký tự.
func dzIntro(s string, max int) string {
	s = reDzScript.ReplaceAllString(s, "")
	s = reDzBr.ReplaceAllString(s, "\n")
	s = reDzBlockEnd.ReplaceAllString(s, "\n")
	s = reDzTag.ReplaceAllString(s, "")
	s = strings.ReplaceAll(html.UnescapeString(s), dzNBSP, " ")
	s = strings.ReplaceAll(s, "\r", "")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSpace(reDzSpaces.ReplaceAllString(l, " "))
	}
	s = strings.TrimSpace(reDzNewlines.ReplaceAllString(strings.Join(lines, "\n"), "\n"))
	s = norm.NFC.String(s)
	if utf8.RuneCountInString(s) > max {
		s = strings.TrimSpace(string([]rune(s)[:max]))
	}
	return s
}

// dzLabel: nhãn của bảng thông tin -> IN HOA, bỏ dấu ":" cuối.
func dzLabel(s string) string {
	return strings.ToUpper(strings.TrimSpace(strings.TrimRight(dzText(s), ": ")))
}

// parseDzDetail đọc trang chi tiết dự án của dezon.vn; moreRooms = HTML các phòng tải thêm qua "Xem thêm" (load_more_rooms).
func parseDzDetail(page, moreRooms string) dzDetail {
	d := dzDetail{Info: map[string]string{}}
	rows := reDzInfoRow.FindAllStringSubmatch(page, -1)
	if len(rows) == 0 {
		rows = reDzInfoRowOld.FindAllStringSubmatch(dzCut(page, `class="project_content`, "related_projects"), -1)
	}
	for _, m := range rows {
		lb := dzLabel(m[1])
		if lb == "" {
			continue
		}
		if _, co := d.Info[lb]; !co {
			d.Info[lb] = dzText(m[2])
		}
		if lb == "ĐỊA ĐIỂM" {
			for _, a := range reDzLink.FindAllStringSubmatch(m[2], -1) {
				href := html.UnescapeString(a[1])
				switch {
				case strings.Contains(href, "/khu-vuc/") && d.Province == "":
					d.Province = dzText(a[2])
				case strings.Contains(href, "/quoc-gia/") && d.Country == "":
					d.Country = dzText(a[2])
				}
			}
		}
	}
	if m := reDzCrumb.FindStringSubmatch(page); m != nil {
		// nhiều danh mục: <a>Nhà Phố</a><span>, </span><a>Văn Phòng</a> -> lấy danh mục đầu
		if a := reDzLink.FindStringSubmatch(m[1]); a != nil {
			d.Category = dzText(a[2])
		} else {
			d.Category = strings.TrimRight(dzText(m[1]), ", ")
		}
	}
	d.Gallery = dzGallery(page, moreRooms)
	d.Suppliers = dzSuppliers(page)
	return d
}

// dzCut: đoạn từ chỗ có start tới mốc end đầu tiên sau đó (thiếu mốc -> hết trang); không có start -> "".
func dzCut(page, start string, ends ...string) string {
	st := strings.Index(page, start)
	if st < 0 {
		return ""
	}
	seg := page[st:]
	return seg[:dzFirst(seg, ends...)]
}

// dzFirst: vị trí sớm nhất của một trong các mốc trong s (không có mốc nào -> len(s)).
func dzFirst(s string, marks ...string) int {
	end := len(s)
	for _, m := range marks {
		if i := strings.Index(s, m); i >= 0 && i < end {
			end = i
		}
	}
	return end
}

// dzGallery: ảnh của dải trượt đầu trang (từ <h1> tới khối project_info / project_content / mục dz-sec- / dự án liên quan)
// rồi ảnh mục Hình ảnh (id="dz-sec-rooms", tới mục dz-sec- kế tiếp hoặc dự án liên quan, cộng more = phòng tải thêm;
// tên phòng = <h3 class="section-label">). Chỉ nhận ảnh trong /wp-content/uploads/ của dezon.vn; ảnh của khối
// related_projects (dự án khác) không bao giờ được lấy.
func dzGallery(page, more string) []dzImage {
	g := &dzGal{idx: map[string]int{}}
	if h1 := strings.Index(page, "<h1"); h1 >= 0 {
		seg := page[h1:]
		g.addAll(seg[:dzFirst(seg, `class="project_info`, `class="project_content`, `id="dz-sec-`, "related_projects")], "")
	}
	const roomsID = `id="dz-sec-rooms"`
	rooms := ""
	if st := strings.Index(page, roomsID); st >= 0 {
		rooms = page[st+len(roomsID):]
		rooms = rooms[:dzFirst(rooms, `id="dz-sec-`, "related_projects")]
	}
	if rooms += more; rooms != "" {
		hs := reDzRoomH3.FindAllStringSubmatchIndex(rooms, -1)
		if len(hs) == 0 {
			g.addAll(rooms, "")
		} else {
			g.addAll(rooms[:hs[0][0]], "")
			for i, h := range hs {
				end := len(rooms)
				if i+1 < len(hs) {
					end = hs[i+1][0]
				}
				g.addAll(rooms[h[1]:end], dzText(rooms[h[2]:h[3]]))
			}
		}
	}
	return g.list
}

// dzGal: danh sách ảnh theo thứ tự xuất hiện, bỏ trùng theo khoá ảnh gốc.
type dzGal struct {
	list []dzImage
	idx  map[string]int
}

func (g *dzGal) addAll(seg, phong string) {
	for _, m := range reDzAttr.FindAllStringSubmatch(seg, -1) {
		if u, ok := dzUploadURL(html.UnescapeString(m[1])); ok {
			g.add(u, phong)
		}
	}
}

func (g *dzGal) add(u, phong string) {
	k := dzImageKey(u)
	if i, co := g.idx[k]; co {
		if dzIsVariant(g.list[i].URL) && !dzIsVariant(u) {
			g.list[i].URL = u
		}
		if g.list[i].Phong == "" {
			g.list[i].Phong = phong
		}
		return
	}
	g.idx[k] = len(g.list)
	g.list = append(g.list, dzImage{URL: u, Phong: phong})
}

// dzUploadURL: URL ảnh trong /wp-content/uploads/ của dezon.vn (bỏ ?query / #...); khác -> false.
func dzUploadURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !dzHostOK(u.Hostname()) || u.User != nil {
		return "", false
	}
	if !reDzImgPath.MatchString(u.Path) {
		return "", false
	}
	u.RawQuery, u.Fragment = "", ""
	return u.String(), true
}

// dzHostOK: chỉ tải từ dezon.vn / www.dezon.vn.
func dzHostOK(host string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	return h == "dezon.vn" || h == "www.dezon.vn"
}

// dzImageKey: khoá so trùng ảnh - bỏ hậu tố kích thước của WordPress (-1024x576) rồi hậu tố "-scaled" (ảnh lớn WordPress
// thu lại; bản -WxH của nó đặt theo tên gốc không có -scaled) trước đuôi file, bỏ www, chữ thường.
func dzImageKey(u string) string {
	k := strings.ToLower(u)
	if i := strings.IndexAny(k, "?#"); i >= 0 {
		k = k[:i]
	}
	k = strings.Replace(strings.Replace(k, "://www.", "://", 1), "http://", "https://", 1)
	return reDzScaled.ReplaceAllString(reDzSize.ReplaceAllString(k, "$1"), "$1")
}

// dzIsVariant: URL là bản thu nhỏ -WxH của WordPress.
func dzIsVariant(u string) bool { return reDzSize.MatchString(u) }

// dzOriginal: URL ảnh gốc của bản thu nhỏ (bỏ -WxH), giữ nguyên chữ hoa / thường.
func dzOriginal(u string) string {
	loc := reDzSize.FindStringSubmatchIndex(u)
	if loc == nil {
		return u
	}
	return u[:loc[0]] + u[loc[2]:loc[3]]
}

// normDezonURL: khoá so link dự án dezon.vn - bỏ scheme, www, ?query, #..., dấu "/" cuối; giải mã %XX; chữ thường.
// Thiếu scheme (người dán "dezon.vn/du-an/x") vẫn nhận. Rỗng -> "".
func normDezonURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + strings.TrimLeft(s, "/")
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return strings.ToLower(strings.TrimRight(s, "/"))
	}
	host := strings.TrimPrefix(strings.ToLower(strings.TrimSuffix(u.Hostname(), ".")), "www.")
	p := u.Path
	if dec, err := url.PathUnescape(p); err == nil {
		p = dec
	}
	return host + strings.ToLower(strings.TrimRight(p, "/"))
}

// dzVietNam: tên quốc gia là Việt Nam (mọi cách viết thường gặp).
func dzVietNam(s string) bool {
	k := strings.ToLower(strings.Join(strings.Fields(s), ""))
	switch k {
	case "việtnam", "vietnam", "vn":
		return true
	}
	return false
}

// dzAddress: địa chỉ ghi vào QS sao cho Khu vực (đoạn cuối sau dấu phẩy) là tỉnh / thành của dự án Việt Nam.
// Việt Nam (hoặc không rõ quốc gia): "<tỉnh>"; chỉ có quốc gia Việt Nam: "Việt Nam". Nước ngoài: "<tỉnh>, <nước>" hoặc "<nước>".
// province / country trống thì tách từ chữ của ô ĐỊA ĐIỂM (đoạn cuối = nước khi có từ 2 đoạn trở lên).
func dzAddress(province, country, text string) string {
	province, country = strings.TrimSpace(province), strings.TrimSpace(country)
	if province == "" && country == "" {
		var parts []string
		for _, p := range strings.Split(text, ",") {
			if p = strings.TrimSpace(p); p != "" {
				parts = append(parts, p)
			}
		}
		switch {
		case len(parts) == 0:
			return ""
		case len(parts) == 1:
			country = parts[0]
		default:
			country = parts[len(parts)-1]
			province = strings.Join(parts[:len(parts)-1], ", ")
		}
	}
	if country == "" || dzVietNam(country) {
		if province != "" {
			return province
		}
		if country != "" {
			return country
		}
		return ""
	}
	if province != "" {
		return province + ", " + country
	}
	return country
}

// dzHumanize: "thuong-mai-van-phong" -> "Thuong mai van phong" (dự phòng khi trang không có breadcrumb).
func dzHumanize(slug string) string {
	s := strings.Join(strings.Fields(strings.ReplaceAll(slug, "-", " ")), " ")
	if s == "" {
		return ""
	}
	r, n := utf8.DecodeRuneInString(s)
	return strings.ToUpper(string(r)) + s[n:]
}

// dzCategory: phân khúc = breadcrumb cuối; thiếu (hoặc chỉ là "Dự án" / tên dự án) -> project_category-* đầu tiên của class_list.
func dzCategory(crumb, title string, classes []string) string {
	c := strings.TrimSpace(crumb)
	if c != "" && !strings.EqualFold(c, "Dự án") && !strings.EqualFold(c, strings.TrimSpace(title)) {
		return c
	}
	for _, cl := range classes {
		if slug, ok := strings.CutPrefix(cl, "project_category-"); ok {
			return dzHumanize(slug)
		}
	}
	return ""
}

// dzInfoKeys: nhãn bảng thông tin dezon.vn -> khoá dự án QS (projMap).
var dzInfoKeys = [][2]string{
	{"DIỆN TÍCH", "tongDT"}, {"KIẾN TRÚC SƯ", "kienTrucSu"}, {"KIẾN TRÚC SƯ CHỦ TRÌ", "kienTrucSu"},
	{"NHÀ THẦU THI CÔNG", "nhaThauThiCong"}, {"NHÀ THẦU", "nhaThauThiCong"},
	{"CÔNG TY", "studio"}, {"NĂM HOÀN THIỆN", "namHoanThien"}, {"NHÓM THIẾT KẾ", "nhomThietKe"},
	{"NHIẾP ẢNH GIA", "nhiepAnhGia"}, {"NHIẾP ẢNH", "nhiepAnhGia"},
}

// dzIntroMax: số ký tự tối đa của phần giới thiệu ghi vào ghi chú.
const dzIntroMax = 4000

// dzFields: khoá dự án QS (như thân createProject) dựng từ bài REST + trang chi tiết; bỏ giá trị rỗng. khachHang để trống.
func dzFields(it dzItem, d dzDetail) *omap.Map {
	f := omap.New()
	put := func(k, v string) {
		if v = strings.TrimSpace(v); v != "" && !f.Has(k) {
			f.Set(k, v)
		}
	}
	put("ten", it.Title)
	put("linkDezon", it.Link)
	put("nenTang", "Dezon.vn")
	put("trangThai", "Hoàn thành")
	put("phanKhuc", dzCategory(d.Category, it.Title, it.Classes))
	put("diaChi", dzAddress(d.Province, d.Country, d.Info["ĐỊA ĐIỂM"]))
	for _, p := range dzInfoKeys {
		put(p[1], d.Info[p[0]])
	}
	put("ghiChu", dzIntro(it.Content, dzIntroMax))
	return f
}

// dzEmpty: ô của dự án QS chưa có giá trị.
func dzEmpty(v any) bool { return jsval.IsNullish(v) || jsval.Trim(jsval.S(v)) == "" }

// dzFillPatch: các cột (tên trong code) của dòng du_an đang trống mà dữ liệu dezon.vn có -> patch; không đè dữ liệu người dùng.
func dzFillPatch(row, fields *omap.Map) *omap.Map {
	patch := omap.New()
	fields.Each(func(k string, v any) {
		col, ok := projCol[k]
		if ok && dzEmpty(row.Val(col)) && !dzEmpty(v) {
			patch.Set(col, v)
		}
	})
	return patch
}

// dzAnhEmpty: giá trị anhDuAn đang lưu chưa có ảnh (null / thiếu / mảng rỗng). Giá trị lạ không phải mảng coi như đã có.
func dzAnhEmpty(v any) bool {
	if jsval.IsNullish(v) {
		return true
	}
	a, ok := v.([]any)
	return ok && len(a) == 0
}

// dzAnhURL: URL của 1 phần tử anhDuAn (chuỗi, hoặc {url, phong}).
func dzAnhURL(x any) string {
	if m, ok := x.(*omap.Map); ok {
		return jsval.S(m.Val("url"))
	}
	if s, ok := x.(string); ok {
		return s
	}
	return ""
}
