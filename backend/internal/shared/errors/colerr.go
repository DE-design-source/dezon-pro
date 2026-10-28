package errors

import (
	"regexp"
	"strings"

	"qspro-backend/internal/shared/specs"
)

// HDMig = HD_MIG (store_supa.js:474).
const HDMig = `Hãy chạy "npm run migrate" rồi khởi động lại server.`

// DAMat = DA_MAT (store_supa.js:1105).
const DAMat = "Bản nháp không còn tồn tại hoặc không thuộc công ty đang xem — hãy tải lại trang."

// colSQL = Object.keys(COL_SQL) (store_supa.js:475-478). Thứ tự quan trọng: ColErr báo cột ĐẦU TIÊN khớp.
var colSQL = buildColSQL()

func buildColSQL() []string {
	out := []string{"ten_chip_led", "gia_ban_bo_nguon", "da_duyet", "nguoi_duyet", "ngay_duyet", "nganh", "kich_thuoc",
		"he_thong_xa", "luong_nuoc_xa", "thiet_ke", "tam_xa", "ap_luc_nuoc", "luu_y", "tinh_nang", "nhom_bt", "link_dezon",
		"thong_so_file", "huong_dan_lap_dat", "file_ban_ve"}
	seen := make(map[string]bool, len(out))
	for _, c := range out {
		seen[c] = true
	}
	for _, sp := range []*specs.Spec{specs.VS, specs.SON, specs.CT, specs.DL} { // DL chỉ bản Go, nối cuối
		for _, lb := range sp.Metric.Keys() {
			// gán lại khoá đã có không đổi vị trí của nó trong object JS
			if c := sp.MetricCol(lb); !seen[c] {
				seen[c] = true
				out = append(out, c)
			}
		}
	}
	return out
}

// ColSQL trả bản sao danh sách cột của COL_SQL theo đúng thứ tự khoá bên Node.
func ColSQL() []string { return append([]string(nil), colSQL...) }

var (
	reColErr     = regexp.MustCompile(`(?i)(column|schema cache)`)
	reKhongCoCha = regexp.MustCompile(`\b23503\b`)
)

// ColErr = colErr_ (store_supa.js:479-486): lỗi thiếu cột -> lỗi hướng dẫn chạy migration; lỗi khác trả NGUYÊN err.
// Dùng: return nil, apperr.ColErr(err)  (throw colErr_(e)).
func ColErr(err error) error {
	if err == nil {
		return nil
	}
	m := err.Error()
	if !reColErr.MatchString(m) {
		return err
	}
	for _, col := range colSQL {
		if strings.Contains(m, col) {
			return New(`Cơ sở dữ liệu chưa có cột "` + col + `". ` + HDMig)
		}
	}
	return err
}

// KhongCoCha = khongCoCha_ (store_supa.js:1104): lỗi khoá ngoại 23503 (dòng cha không còn / khác công ty).
func KhongCoCha(err error) bool {
	return err != nil && reKhongCoCha.MatchString(err.Error())
}
