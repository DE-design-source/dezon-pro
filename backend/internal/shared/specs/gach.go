package specs

import "regexp"

// Hàm riêng của gach-spec.js (Gạch ốp lát); golden: gen-specs.js ghi các ca gach laChung.

var gachChung = regexp.MustCompile(`(^| )(gach|op lat)( |$)`)

// GachLaChung = GACH.laChung(v): hạng mục ghi CHUNG ("Gạch", "Ốp lát", "Sàn gạch"...) chứ không phải hạng mục con.
func GachLaChung(v any) bool {
	k := BoDau(v)
	return k != "" && GACH.ChuanHM(v) == "" && gachChung.MatchString(k)
}
