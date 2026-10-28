package specs

import "regexp"

// Hàm riêng của dl-spec.js (Điện lạnh), đúng như bản JS; golden: gen-specs.js ghi các ca dl laChung / doanHM.

var dlChung = regexp.MustCompile(`(dien lanh|dieu hoa|may lanh|thong gio|hvac)`)

// dlDoan = DOAN của dl-spec.js: áp lên bo_dau(tên SP), cụ thể trước, chung sau.
var dlDoan = []struct {
	re *regexp.Regexp
	hm string
}{
	{regexp.MustCompile(`mat na|panel`), "Mặt nạ dàn lạnh"},
	{regexp.MustCompile(`cach nhiet`), "Cách nhiệt ống đồng"},
	{regexp.MustCompile(`thoat nuoc|nuoc ngung`), "Ống thoát nước ngưng"},
	{regexp.MustCompile(`ong dong|dan gas|ong gas`), "Ống đồng dẫn gas"},
	{regexp.MustCompile(`day dien|day nguon|day dieu khien|cap dien`), "Dây điện nguồn & điều khiển"},
	{regexp.MustCompile(`quat`), "Quạt hút / thông gió"},
	{regexp.MustCompile(`ong gio|louver|chu y|cua gio|mieng gio`), "Ống gió & phụ kiện thông gió"},
	{regexp.MustCompile(`gia do|vat tu phu|van chuyen|ty treo`), "Giá đỡ & vật tư phụ điều hoà"},
}

// DLLaChung = DL.laChung(v): hạng mục ghi CHUNG ("Điện lạnh", "Máy lạnh", "Thông gió"...) chứ không phải hạng mục con.
func DLLaChung(v any) bool {
	k := BoDau(v)
	return k != "" && DL.ChuanHM(v) == "" && dlChung.MatchString(k)
}

// DLDoanHM = DL.doanHM(hm, ten): hạng mục chuẩn nếu khớp, không thì đoán theo tên SP, mặc định "Điều hoà không khí".
func DLDoanHM(hm, ten any) string {
	if c := DL.ChuanHM(hm); c != "" {
		return c
	}
	t := BoDau(ten)
	for _, d := range dlDoan {
		if d.re.MatchString(t) {
			return d.hm
		}
	}
	return "Điều hoà không khí"
}
