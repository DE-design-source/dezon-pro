package materials

import (
	"regexp"

	"qspro-backend/internal/modules/categories"
	"qspro-backend/internal/shared/omap"
)

// dbNum = DB_NUM (S:446-448): nhãn ép kiểu số khi lưu. CHỈ gồm cột thật sự là numeric trong database.
var dbNum = map[string]bool{
	"QUANG THÔNG (lm)": true,
	"CHIỀU CAO (mm)":   true, "ĐƯỜNG KÍNH (mm)": true, "HIỆU SUẤT PHÁT QUANG (lm/W)": true, "DÒNG RA TỐI ĐA (mA)": true,
	"BẢO HÀNH (năm)": true, "GIÁ BÁN LẺ": true, "CHIẾT KHẤU ĐẠI LÝ (%)": true, "GIÁ BÁN BỘ NGUỒN": true,
}

// DocMaxMB = DOC_MAX_MB (S:978): giới hạn 1 file tài liệu (bản Node: 50). Phải bằng middleware.DocMaxMB
// và DOC_MAX_MB của giao diện (frontend/src/pages/QS/api/files.js).
const DocMaxMB = 300

// docExt = DOC_EXT (S:977). Đuôi đã qua toLowerCase nên không cần cờ i.
var docExt = regexp.MustCompile(`^(pdf|png|jpe?g|webp|gif|dwg|dxf|skp|zip|rar|7z|docx?|xlsx?|pptx?)$`)

const (
	nhanTen     = "TÊN SẢN PHẨM"
	nhanMa      = "MÃ SẢN PHẨM"
	nhanLapRoi  = "LẮP NGUỒN RỜI"
	nhanHangMuc = "HẠNG MỤC"
	nhanNganh   = "NGÀNH HÀNG"
	nhanAnh     = "ẢNH SẢN PHẨM"

	loiKhoChung = "Sản phẩm thuộc kho chung của Dezon — không sửa/xoá được. Hãy tạo bản sao riêng cho công ty bạn."
	anDanh      = "ẩn danh"
)

// rawCols = _rawCols (S:143-146): cột của mọi nhãn trong DB_LABEL2COL (không khử trùng), bỏ anh_sp.
var rawCols []string

// rawShape: bộ khoá của khối raw (rawCols đã bỏ cột lặp, giữ vị trí lần đầu - đúng thứ tự khoá mà gán lần lượt cho ra).
// Mọi sản phẩm dùng chung bộ khoá này nên mỗi khối raw chỉ tốn một mảng giá trị.
var rawShape *omap.Shape

func init() {
	seen := map[string]bool{}
	var uniq []string
	for _, lc := range categories.DBLabel2Col {
		if lc.Col != "anh_sp" {
			rawCols = append(rawCols, lc.Col)
			if !seen[lc.Col] {
				seen[lc.Col] = true
				uniq = append(uniq, lc.Col)
			}
		}
	}
	rawShape = omap.NewShape(uniq...)
}

// change: một trường đổi giá trị (phần tử của changes bên Node: {field, old, new}).
type change struct {
	field, old, new string
}
