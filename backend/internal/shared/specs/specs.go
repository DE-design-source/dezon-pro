// Package specs là bản chuyển của js/vs-spec.js, js/son-spec.js, js/ct-spec.js (trước đây ở public/ của app Node):
// bộ thông số theo từng hạng mục của ngành Thiết bị vệ sinh (VS), Sơn nước (SON), Công tắc - ổ cắm (CT).
//
// DỮ LIỆU không viết tay ở đây: js/*-spec.js là nguồn duy nhất (nhúng nguyên văn, giao diện tải qua
// /vs-spec.js, /son-spec.js, /ct-spec.js - xem source.go). scripts/gen-specs.js xuất mọi
// giá trị export không phải hàm ra data/{vs,son,ct}.json, gói này nhúng (go:embed) và giải mã thành
// JS value model (*omap.Map giữ thứ tự khoá). Sửa spec xong phải chạy lại:
//
//	node backend/scripts/gen-specs.js
//
// HÀM được chuyển tay, đối chiếu với Node bằng testdata/golden.json (cũng do gen-specs.js sinh).
//
// Bảng tên JS -> Go (X là VS, SON hoặc CT; bên Go là specs.VS, specs.SON, specs.CT kiểu *Spec):
//
//	X.METRIC          X.Metric    *omap.Map  nhãn -> [cột DB, nhãn hiển thị, kiểu, gợi ý]
//	X.METRIC[lb][0]   X.MetricCol(lb)     (không có nhãn -> "")
//	X.METRIC[lb][1]   X.MetricLabel(lb)
//	X.METRIC[lb][2]   X.MetricKind(lb)    "text" | "sel" | "area"
//	X.METRIC[lb][3]   X.MetricHint(lb)
//	X.HM              X.HM        *omap.Map  hạng mục -> {kem, chinh, tk, req, opt, mau, ...}
//	X.HM[hm]          X.HMGet(hm)         (tên CHÍNH XÁC, không chuẩn hoá; không có -> nil)
//	X.HM[hm].req      X.HMList(hm, "req") (cũng dùng cho "chinh", "tk", "kem", "dong")
//	X.HM[hm].mau      X.HMGet(hm).Val("mau")
//	X.HM[hm].opt[lb]  specs.Strs(jsval.GetPath(X.HMGet(hm), "opt", lb))
//	X.HANG_MUC        X.HangMuc   []string
//	X.ALL             X.All       []string
//	X.CHUNG           X.Chung     []string
//	X.CHINH_ALL       X.ChinhAll  []string
//	X.TK_ALL          X.TkAll     []string
//	X.VD              X.VD        string
//	SON.MUC, CT.MUC   X.Muc       string   (VS không có -> "")
//	SON.TEN_TK        SON.TenTk   string   (spec khác -> "")
//	CT.OPT            CT.Opt      *omap.Map (spec khác -> nil)
//	X.gom(k)          X.Gom(k)
//	X.chuanHM(v)      X.ChuanHM(v)
//	X.hmOf(v)         X.HmOf(v)           (null -> nil)
//	X.labelsOf(v)     X.LabelsOf(v)
//	X.optsOf(v, lb)   X.OptsOf(v, lb)
//	X.isReq(v, lb)    X.IsReq(v, lb)
//	VS.nganhOf(n, hm) specs.NganhOf(n, hm)
//	CT.dong(lb, get)  specs.Dong(lb, get)  (null -> nil, ngược lại [nhãn, giá trị])
//	bo_dau(s)         specs.BoDau(v)       (hàm nội bộ của cả 3 spec, mã giống hệt nhau)
//
// Mọi giá trị trong Spec là dữ liệu dùng chung: KHÔNG sửa tại chỗ (muốn sửa thì Clone / omap.DeepClone
// trước, như Node dùng Object.assign({}, X.HM[h].mau, ...)).
//
// Khác JS: sau khi qua JSON, các object dùng chung tham chiếu bên JS (CT.HM[x].opt === CT.OPT,
// HM[x].nhom là cùng một object OC / CT) trở thành bản sao rời - nội dung giống nhau, không so con trỏ.
package specs

import (
	_ "embed"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"

	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
)

//go:embed data/vs.json
var vsJSON []byte

//go:embed data/son.json
var sonJSON []byte

//go:embed data/ct.json
var ctJSON []byte

//go:embed data/dl.json
var dlJSON []byte

// Spec: toàn bộ export của một file *-spec.js.
type Spec struct {
	Name string    // "vs" | "son" | "ct" | "dl"
	Data *omap.Map // mọi export không phải hàm, đúng thứ tự khoá của object api

	Metric   *omap.Map
	HM       *omap.Map
	HangMuc  []string
	All      []string
	Chung    []string
	ChinhAll []string
	TkAll    []string
	Opt      *omap.Map
	Muc      string
	TenTk    string
	VD       string

	hmKey map[string]string // bo_dau(tên hạng mục) -> tên chuẩn
}

var (
	VS  = load("vs", vsJSON)
	SON = load("son", sonJSON)
	CT  = load("ct", ctJSON)
	DL  = load("dl", dlJSON)
)

func load(name string, raw []byte) *Spec {
	v, err := omap.Decode(raw)
	if err != nil {
		panic("specs: data/" + name + ".json hỏng: " + err.Error())
	}
	d := jsval.AsMap(v)
	if d == nil || jsval.AsMap(d.Val("HM")) == nil || jsval.AsMap(d.Val("METRIC")) == nil {
		panic("specs: data/" + name + ".json thiếu HM / METRIC - chạy lại scripts/gen-specs.js")
	}
	s := &Spec{
		Name: name, Data: d,
		Metric: jsval.AsMap(d.Val("METRIC")), HM: jsval.AsMap(d.Val("HM")),
		HangMuc: Strs(d.Val("HANG_MUC")), All: Strs(d.Val("ALL")), Chung: Strs(d.Val("CHUNG")),
		ChinhAll: Strs(d.Val("CHINH_ALL")), TkAll: Strs(d.Val("TK_ALL")),
		Opt: jsval.AsMap(d.Val("OPT")),
		Muc: jsval.AsString(d.Val("MUC")), TenTk: jsval.AsString(d.Val("TEN_TK")), VD: jsval.AsString(d.Val("VD")),
		hmKey: map[string]string{},
	}
	for _, hm := range s.HangMuc {
		k := BoDau(hm)
		if _, dup := s.hmKey[k]; !dup { // JS duyệt từ đầu, khớp đầu tiên thắng
			s.hmKey[k] = hm
		}
	}
	return s
}

// Strs đổi mảng JS ([]any) thành []string, chỉ lấy phần tử là chuỗi. Không phải mảng -> slice rỗng (không nil).
func Strs(v any) []string {
	arr := jsval.AsArray(v)
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// Bộ \s của biểu thức chính quy JS (rộng hơn \s của Go).
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// BoDau = bo_dau(s): bỏ dấu, đ -> d, chữ thường, gộp khoảng trắng, cắt hai đầu.
func BoDau(v any) string {
	s := norm.NFD.String(jsval.Str(v))
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r >= 0x300 && r <= 0x36f:
		case r == 'đ':
			b.WriteByte('d')
		case r == 'Đ':
			b.WriteByte('D')
		default:
			b.WriteRune(r)
		}
	}
	// cases.Lower theo đúng thuật toán Unicode đầy đủ như toLowerCase (sigma cuối từ...); strings.ToLower thì không
	s = cases.Lower(language.Und).String(b.String())
	b.Reset()
	space := false
	for _, r := range s {
		if isJSSpace(r) {
			space = true
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(r)
	}
	if space {
		b.WriteByte(' ')
	}
	return jsval.Trim(b.String())
}

// ChuanHM = chuanHM(v): hạng mục người dùng gõ -> tên chuẩn; không khớp -> "".
func (s *Spec) ChuanHM(v any) string {
	k := BoDau(v)
	if k == "" {
		return ""
	}
	return s.hmKey[k]
}

// HMGet = HM[name] với tên chính xác; không có -> nil.
func (s *Spec) HMGet(name string) *omap.Map { return jsval.AsMap(s.HM.Val(name)) }

// HMList = HM[name][key] cho các khối là mảng nhãn ("chinh", "tk", "req", "kem", "dong").
func (s *Spec) HMList(name, key string) []string { return Strs(s.HMGet(name).Val(key)) }

// HmOf = hmOf(v): object của hạng mục sau khi chuẩn hoá tên; không khớp -> nil.
func (s *Spec) HmOf(v any) *omap.Map {
	hm := s.ChuanHM(v)
	if hm == "" {
		return nil
	}
	return s.HMGet(hm)
}

// LabelsOf = labelsOf(v): nhãn thông số của 1 hạng mục (chinh + tk); không khớp hạng mục -> tất cả. Luôn là slice mới.
func (s *Spec) LabelsOf(v any) []string {
	h := s.HmOf(v)
	if h == nil {
		return append([]string{}, s.All...)
	}
	return append(Strs(h.Val("chinh")), Strs(h.Val("tk"))...)
}

// Gom = gom(k): hợp các nhãn của khối k qua mọi hạng mục, đúng thứ tự khai báo, không trùng.
// k không phải khối dạng mảng: JS ném TypeError, ở đây trả slice rỗng.
func (s *Spec) Gom(k string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, hm := range s.HangMuc {
		for _, lb := range s.HMList(hm, k) {
			if !seen[lb] {
				seen[lb] = true
				out = append(out, lb)
			}
		}
	}
	return out
}

// OptsOf = optsOf(v, lb): danh sách chọn của nhãn lb trong hạng mục v; không có -> slice rỗng.
// Riêng CT: không khớp hạng mục thì lấy theo CT.OPT.
func (s *Spec) OptsOf(v, lb any) []string {
	key := jsval.ToString(lb)
	if h := s.HmOf(v); h != nil {
		if o := jsval.Get(h.Val("opt"), key); jsval.Truthy(o) {
			return Strs(o)
		}
	}
	if s.Opt != nil {
		if o := s.Opt.Val(key); jsval.Truthy(o) {
			return Strs(o)
		}
	}
	return []string{}
}

// IsReq = isReq(v, lb): nhãn lb có bắt buộc với hạng mục v không.
func (s *Spec) IsReq(v, lb any) bool {
	want, ok := lb.(string)
	if !ok {
		return false
	}
	h := s.HmOf(v)
	if h == nil {
		return false
	}
	for _, x := range jsval.AsArray(h.Val("req")) {
		if x == want {
			return true
		}
	}
	return false
}

func (s *Spec) metricAt(lb string, i int) string {
	m := jsval.AsArray(s.Metric.Val(lb))
	if i >= len(m) {
		return ""
	}
	return jsval.AsString(m[i])
}

// MetricCol = METRIC[lb][0]: cột DB của nhãn; không có nhãn -> "".
func (s *Spec) MetricCol(lb string) string { return s.metricAt(lb, 0) }

// MetricLabel = METRIC[lb][1]: nhãn hiển thị.
func (s *Spec) MetricLabel(lb string) string { return s.metricAt(lb, 1) }

// MetricKind = METRIC[lb][2]: "text" | "sel" | "area".
func (s *Spec) MetricKind(lb string) string { return s.metricAt(lb, 2) }

// MetricHint = METRIC[lb][3]: gợi ý nhập.
func (s *Spec) MetricHint(lb string) string { return s.metricAt(lb, 3) }

// NganhOf = VS.nganhOf(nganh, hangMuc): ngành đã đánh dấu thì giữ; chưa đánh dấu -> "vs" nếu hạng mục
// là hạng mục vệ sinh, còn lại "den".
func NganhOf(nganh, hangMuc any) string {
	if n := jsval.Trim(jsval.Str(nganh)); n != "" {
		return n
	}
	if VS.ChuanHM(hangMuc) != "" {
		return "vs"
	}
	return "den"
}

// Dong = CT.dong(lb, get): 1 dòng [nhãn, giá trị] cho bảng / panel; không có giá trị -> nil.
// get(col) trả giá trị thô của cột DB. "@BH" = bảo hành, "@KT" = kích thước mặt R x C x D.
func Dong(lb string, get func(col string) any) []string { return CT.Dong(lb, get) }

// Dong = <spec>.dong(lb, get) của CT / DL. "@KT" chỉ CT có (DL tra METRIC nên trả nil).
func (s *Spec) Dong(lb string, get func(col string) any) []string {
	if lb == "@KT" && s != CT {
		lb = "\x00" // không phải nhãn METRIC -> nil như DL.dong
	}
	switch lb {
	case "@BH":
		bh := jsval.Trim(jsval.StrOr(get("bao_hanh_nam"), ""))
		if bh != "" && bh != "0" {
			return []string{"Bảo hành", bh + " năm"}
		}
		return nil
	case "@KT":
		kt := make([]string, 3)
		some := false
		for i, c := range []string{"rong_mm", "cao_mm", "sau_mm"} {
			kt[i] = jsval.Trim(jsval.Str(get(c)))
			if kt[i] != "" {
				some = true
			} else {
				kt[i] = "—"
			}
		}
		if !some {
			return nil
		}
		return []string{"Kích thước mặt (R x C x D)", strings.Join(kt, " x ") + " mm"}
	}
	m := jsval.AsArray(s.Metric.Val(lb))
	if len(m) < 2 {
		return nil
	}
	v := jsval.Trim(jsval.Str(get(jsval.AsString(m[0]))))
	if v == "" {
		return nil
	}
	return []string{jsval.AsString(m[1]), v}
}
