package materials

import (
	"context"
	"strconv"
	"strings"

	"qspro-backend/internal/modules/categories"
	"qspro-backend/internal/shared/actor"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
	"qspro-backend/internal/shared/specs"
)

// ImportParse = importParse (S:1031 -> shared.importParse): đọc file nhập hàng loạt, không ghi database.
func (s *Service) ImportParse(_ context.Context, base64, ext, nganh any) (*omap.Map, error) {
	return qscore.ImportParse(base64, ext, nganh)
}

func trimS(v any) string { return jsval.Trim(jsval.S(v)) } // s(v).trim()

func inList(list []string, x string) bool {
	for _, it := range list {
		if it == x {
			return true
		}
	}
	return false
}

// ImportCommit = importCommit (S:1032-1080): lưu từng sản phẩm của file qua saveDbProduct; lỗi từng dòng gom vào errors.
func (s *Service) ImportCommit(ctx context.Context, a *actor.Actor, products any) (*omap.Map, error) {
	inserted, updated := 0, 0
	errs := []any{}
	// products không phải mảng: không có phần tử nào lưu được (chuỗi: từng ký tự đều thiếu tên) -> kết quả như mảng rỗng
	list := jsval.AsArray(products)
	if m := jsval.AsMap(products); m != nil {
		// object có khoá "length": JS lặp i < length và đọc list[i] theo khoá "0", "1"...; phần tử thiếu là undefined -> TypeError
		n := jsval.ToNumber(m.Val("length"))
		for i := 0; float64(i) < n; i++ {
			it := m.Val(strconv.Itoa(i))
			list = append(list, it)
			if jsval.IsNullish(it) {
				break
			}
		}
	}
	for i, it := range list {
		if it == nil {
			return nil, apperr.New("Cannot read properties of null (reading '_raw')")
		}
		if jsval.IsUndefined(it) {
			return nil, apperr.New("Cannot read properties of undefined (reading '_raw')")
		}
		p := jsval.AsMap(it)
		data := omap.New()
		if raw := jsval.AsMap(p.Val("_raw")); raw != nil { // cột từ file (tiêu đề = nhãn DB trong file mẫu)
			omap.Assign(data, raw)
		}
		fill := func(lbl string, v any) {
			if trimS(data.Val(lbl)) == "" && !rong(v) {
				data.Set(lbl, v)
			}
		}
		fill(nhanTen, p.Val("ten"))
		fill(nhanMa, p.Val("ma"))
		fill("DÒNG SẢN PHẨM", p.Val("nhom"))
		fill(nhanHangMuc, p.Val("hangMuc"))
		fill("THƯƠNG HIỆU", p.Val("thuongHieu"))
		fill("NHÀ CUNG CẤP", p.Val("ncc"))
		if qscore.N(p.Val("gia")) > 0 { // giá trống trong file (parse ra 0) thì KHÔNG ghi 0 đè lên giá đang có
			fill("GIÁ BÁN LẺ", p.Val("gia"))
		}
		fill("GHI CHÚ", p.Val("moTa"))
		data.Delete("GIÁ ĐẠI LÝ")                    // cột tự tính (generated)
		data.Set(nhanAnh, jsval.S(p.Val("hinhAnh"))) // ảnh người dùng tải, ghi đè mọi cột ảnh trong file
		// ĐVT / trạng thái mặc định CHỈ dùng khi TẠO MỚI
		macDinh := omap.New()
		if trimS(data.Val("ĐƠN VỊ TÍNH")) == "" {
			macDinh.Set("dvt", jsval.Or(p.Val("dvt"), "Cái"))
		}
		if trimS(data.Val("TRẠNG THÁI")) == "" {
			macDinh.Set("trang_thai", "Đang kinh doanh")
		}
		ten := trimS(data.Val(nhanTen))
		if ten == "" || strings.HasPrefix(ten, specs.VS.VD) { // dòng trống / dòng ví dụ của file mẫu
			continue
		}
		tenLoi := jsval.S(data.Val(nhanTen))
		// Ngành có bộ thông số theo hạng mục -> tự nhận theo hạng mục
		var ngRow string
		if ng := p.Val("_nganh"); ng == "vs" || ng == "son" || ng == "ct" || ng == "dl" {
			ngRow = ng.(string)
		} else {
			ngRow = categories.NganhCua(data.Val(nhanNganh), data.Val(nhanHangMuc))
		}
		if spec := categories.SpecNganh(ngRow); spec != nil {
			// Đóng dấu ngành, chuẩn hoá tên hạng mục và CHỈ giữ thông số thuộc hạng mục đó
			data.Set(nhanNganh, ngRow)
			hm := spec.ChuanHM(data.Val(nhanHangMuc))
			if hm == "" && ngRow == "dl" {
				// Điện lạnh (chỉ bản Go, theo QS Pro): hạng mục ghi chung ("Điện lạnh", "Máy lạnh"...) -> hạng mục con theo tên SP
				hm = specs.DLDoanHM(data.Val(nhanHangMuc), ten)
			}
			if hm == "" {
				errs = append(errs, omap.Of("i", float64(i), "ten", tenLoi, "error",
					`Hạng mục "`+jsval.S(data.Val(nhanHangMuc))+`" không thuộc danh sách: `+strings.Join(spec.HangMuc, ", ")))
				continue
			}
			data.Set(nhanHangMuc, hm)
			cho := append(append([]string{}, spec.Chung...), spec.LabelsOf(hm)...)
			for _, lb := range data.Keys() {
				if !inList(cho, lb) {
					data.Delete(lb)
				}
			}
			thieu := []string{}
			for _, lb := range spec.HMList(hm, "req") {
				if trimS(data.Val(lb)) == "" {
					thieu = append(thieu, spec.MetricLabel(lb))
				}
			}
			if len(thieu) > 0 {
				errs = append(errs, omap.Of("i", float64(i), "ten", tenLoi, "error", hm+" thiếu: "+strings.Join(thieu, ", ")))
				continue
			}
		}
		r, err := s.SaveDbProduct(ctx, a, data, omap.Of("noAudit", true, "macDinh", macDinh))
		if err != nil {
			errs = append(errs, omap.Of("i", float64(i), "ten", tenLoi, "error", err.Error()))
			continue
		}
		if jsval.Truthy(r.Val("updated")) {
			updated++
		} else {
			inserted++
		}
	}
	s.cacheClear()
	detail := "Nhập hàng loạt: thêm " + jsval.ToString(float64(inserted)) + ", cập nhật " + jsval.ToString(float64(updated)) + " sản phẩm"
	if len(errs) > 0 {
		detail += " (" + jsval.ToString(float64(len(errs))) + " lỗi)"
	}
	s.logAudit(ctx, a, "nhap_sp", detail)
	out := omap.Of("inserted", float64(inserted), "updated", float64(updated))
	if len(errs) > 0 {
		out.Set("errors", errs)
	}
	return out, nil
}

// ImportGated = importGated (A:541-545).
func (s *Service) ImportGated(ctx context.Context, a *actor.Actor, products any) (*omap.Map, error) {
	edit, _, _, err := s.SpPerms(ctx, a)
	if err != nil {
		return nil, err
	}
	if !edit {
		return nil, apperr.New("Tài khoản không có quyền nhập sản phẩm")
	}
	return s.ImportCommit(ctx, a, products)
}
