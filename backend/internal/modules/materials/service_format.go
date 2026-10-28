package materials

import (
	"strings"

	"qspro-backend/internal/modules/categories"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
	"qspro-backend/internal/shared/specs"
)

// endsWithFold = new RegExp(unit + '$', 'i').test(t). Đơn vị chỉ là W, K, mm, °: cờ i của JS (không cờ u)
// chỉ gộp chữ ASCII hoa / thường (ký hiệu Kelvin U+212A không khớp K).
func endsWithFold(t, unit string) bool {
	if len(t) < len(unit) {
		return false
	}
	tail := t[len(t)-len(unit):]
	for i := 0; i < len(unit); i++ {
		a, b := tail[i], unit[i]
		if a >= 'A' && a <= 'Z' {
			a += 'a' - 'A'
		}
		if b >= 'A' && b <= 'Z' {
			b += 'a' - 'A'
		}
		if a != b {
			return false
		}
	}
	return true
}

// firstImg (S:30): dòng không rỗng đầu tiên của trường ảnh nhiều dòng.
func firstImg(v any) string {
	for _, x := range strings.Split(jsval.S(v), "\n") {
		if x = jsval.Trim(x); x != "" {
			return x
		}
	}
	return ""
}

// fmtUnit (S:31): thêm đơn vị nếu người dùng chưa gõ.
func fmtUnit(v any, unit string) string {
	if jsval.IsNullish(v) || v == "" {
		return ""
	}
	t := jsval.ToString(v)
	if endsWithFold(t, unit) {
		return t
	}
	return t + unit
}

// fmtList (S:32): danh sách cách nhau dấu phẩy, thêm đơn vị cho từng phần tử.
func fmtList(v any, unit string) string {
	out := []string{}
	for _, x := range strings.Split(jsval.S(v), ",") {
		if x = jsval.Trim(x); x == "" {
			continue
		}
		if !endsWithFold(x, unit) {
			x += unit
		}
		out = append(out, x)
	}
	return strings.Join(out, ", ")
}

// fmtCutout = fmtCutout_ (S:35-40): lỗ khoét nhập tự do, chỉ thêm Ø / mm khi người dùng chưa gõ.
func fmtCutout(v any) string {
	t := jsval.Trim(jsval.S(v))
	if t == "" {
		return ""
	}
	onlyNum := true // /^[\d.,]+$/
	for i := 0; i < len(t); i++ {
		if c := t[i]; (c < '0' || c > '9') && c != '.' && c != ',' {
			onlyNum = false
			break
		}
	}
	if onlyNum {
		return "Ø" + t + "mm"
	}
	if !endsWithFold(t, "mm") {
		t += "mm"
	}
	return t
}

// Khoảng trắng \s của biểu thức chính quy JS.
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func joinTruthy(parts []string, sep string) string { // arr.filter(Boolean).join(sep)
	out := parts[:0:0]
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}

func splitLines(s string) []string { // s.split(/\r?\n/)
	parts := strings.Split(s, "\n")
	for i := 0; i < len(parts)-1; i++ {
		parts[i] = strings.TrimSuffix(parts[i], "\r")
	}
	return parts
}

// suffixIf = v ? (pre + v + suf) : "".
func suffixIf(v any, pre, suf string) string {
	if !jsval.Truthy(v) {
		return ""
	}
	return pre + jsval.ToString(v) + suf
}

// prodToObj (S:43-140): dòng db_san_pham -> object gửi client. Thứ tự khoá theo đúng object literal của Node.
func prodToObj(r *omap.Map) *omap.Map {
	s, n, v := jsval.S, qscore.N, r.Val
	congSuat, nhietDo, gocChieu := fmtUnit(v("cong_suat_w"), "W"), fmtList(v("nhiet_do_mau_k"), "K"), fmtList(v("goc_chieu_deg"), "°")
	cri, chip, chipTen, dong := s(v("cri")), s(v("loai_chip_led")), s(v("ten_chip_led")), s(v("dong_sp"))
	qt := suffixIf(v("quang_thong_lm"), "", "lm")
	chipTxt := joinTruthy([]string{chipTen, chip}, " · ")
	chatLieu, chieuCao := s(v("chat_lieu")), fmtUnit(v("chieu_cao_mm"), "mm")
	duongKinh, gocNghieng := suffixIf(v("duong_kinh_mm"), "Ø", "mm"), fmtList(v("goc_nghieng_deg"), "°")
	ghiChu := s(v("ghi_chu"))
	themGhiChu := func(moTa string) string {
		if ghiChu == "" {
			return moTa
		}
		if moTa != "" {
			moTa += "\n"
		}
		return moTa + ghiChu
	}
	// "Thông tin chính" = gộp thông số cốt lõi
	ttc := []string{}
	if dong != "" {
		ttc = append(ttc, "Dòng SP: "+dong)
	}
	if chipTxt != "" {
		t := "Chip LED: " + chipTxt
		if cri != "" {
			t += ", CRI " + cri
		}
		ttc = append(ttc, t)
	} else if cri != "" {
		ttc = append(ttc, "CRI: "+cri)
	}
	if congSuat != "" {
		ttc = append(ttc, "Công suất: "+congSuat)
	}
	if nhietDo != "" {
		ttc = append(ttc, "Nhiệt độ màu: "+nhietDo)
	}
	if gocChieu != "" {
		ttc = append(ttc, "Góc chiếu: "+gocChieu)
	}
	if qt != "" {
		ttc = append(ttc, "Quang thông: "+qt)
	}
	moTa := themGhiChu(strings.Join(ttc, "\n"))
	// "Thông số thiết kế"
	tsk := []string{}
	if chatLieu != "" {
		tsk = append(tsk, "Chất liệu: "+chatLieu)
	}
	if chieuCao != "" {
		tsk = append(tsk, "Chiều cao: "+chieuCao)
	}
	if duongKinh != "" {
		tsk = append(tsk, "Đường kính: "+duongKinh)
	}
	if gocNghieng != "" {
		tsk = append(tsk, "Góc nghiêng: "+gocNghieng)
	}
	if dong != "" {
		tsk = append(tsk, "Dòng SP: "+dong)
	}
	size := ""
	if jsval.Truthy(v("duong_kinh_mm")) && jsval.Truthy(v("chieu_cao_mm")) {
		size = "Ø" + jsval.ToString(v("duong_kinh_mm")) + "×H" + jsval.ToString(v("chieu_cao_mm")) + "mm"
	} else if jsval.Truthy(v("duong_kinh_mm")) {
		size = "Ø" + jsval.ToString(v("duong_kinh_mm")) + "mm"
	}
	thongSoTK := strings.Join(tsk, "\n")
	if thongSoTK == "" {
		thongSoTK = size
	}

	nganh := categories.NganhCua(v("nganh"), v("hang_muc"))
	bh := suffixIf(v("bao_hanh_nam"), "", " năm")
	if spec := categories.SpecNganh(nganh); spec != nil {
		// Mỗi hạng mục có bộ thông số riêng: chinh -> THÔNG TIN CHÍNH, tk -> THÔNG SỐ THIẾT KẾ.
		// Hạng mục lạ / chưa chọn -> in mọi thông số có giá trị.
		h := spec.HmOf(v("hang_muc"))
		line := func(lb string) string {
			if val := s(v(spec.MetricCol(lb))); val != "" {
				return spec.MetricLabel(lb) + ": " + val
			}
			return ""
		}
		lines := func(lbs []string) []string {
			out := []string{}
			for _, lb := range lbs {
				if t := line(lb); t != "" {
					out = append(out, t)
				}
			}
			return out
		}
		chinh, tk := spec.ChinhAll, spec.TkAll
		if h != nil {
			chinh, tk = specs.Strs(h.Val("chinh")), specs.Strs(h.Val("tk"))
		}
		hangMuc := s(v("hang_muc"))
		chuan := spec.ChuanHM(v("hang_muc"))
		a := lines(chinh)
		if dong != "" {
			a = append(a, "Dòng SP: "+dong)
		}
		if hangMuc != "" {
			a = append(a, "Hạng mục: "+jsval.ToString(jsval.Or(chuan, hangMuc)))
		}
		if bh != "" {
			a = append(a, "Bảo hành: "+bh)
		}
		moTa = themGhiChu(strings.Join(a, "\n"))
		thongSoTK = strings.Join(lines(tk), "\n")
		if (nganh == "ct" || nganh == "dl") && h != nil {
			// Công tắc - ổ cắm (S:86-94) / Điện lạnh (chỉ bản Go): hai cột theo nhóm ttc / tsk của hạng mục
			get := func(c string) any { return v(c) }
			ghep := func(ds []string) string {
				out := []string{}
				for _, lb := range ds {
					if d := spec.Dong(lb, get); d != nil {
						out = append(out, d[0]+": "+d[1])
					}
				}
				return joinTruthy(out, "\n")
			}
			moTa = ghep(specs.Strs(jsval.GetPath(h, "nhom", "ttc")))
			thongSoTK = ghep(specs.Strs(jsval.GetPath(h, "nhom", "tsk")))
		}
		if nganh == "son" {
			// Sơn nước (S:95-106): THÔNG TIN CHÍNH = Màu sắc, thông số chính (trừ kích thước), dòng SP, hạng mục, kích thước
			const kt = "KÍCH THƯỚC"
			b := []string{}
			coKT := false
			for _, lb := range chinh {
				if lb == kt {
					coKT = true
					continue
				}
				if t := line(lb); t != "" {
					b = append(b, t)
				}
			}
			if mau := jsval.Trim(s(v("mau_sac"))); mau != "" {
				b = append([]string{"Màu sắc: " + mau}, b...)
			}
			b = append(b, "Dòng sản phẩm: "+jsval.ToString(jsval.Or(dong, chuan, hangMuc)))
			b = append(b, "Hạng mục: "+spec.Muc)
			if coKT && line(kt) != "" {
				b = append(b, line(kt))
			}
			moTa = strings.Join(b, "\n")
			tn := []string{}
			for _, x := range splitLines(s(v("tinh_nang"))) {
				// x.replace(/^[•\-*\s]+/, '').trim()
				x = strings.TrimLeftFunc(x, func(c rune) bool { return c == '•' || c == '-' || c == '*' || isJSSpace(c) })
				if x = jsval.Trim(x); x != "" {
					tn = append(tn, x)
				}
			}
			thongSoTK = strings.Join(tn, "\n")
		}
	}
	lapNguonRoi := ""
	if jsval.Truthy(v("lap_nguon_roi")) {
		lapNguonRoi = "Có"
	}
	// chừa chỗ cho yeuThich, comboN, spChung mà getProducts gắn thêm
	return omap.OfCap(3,
		"ma", s(v("ma_sp")), "ten", s(v("ten_sp")), "dongSanPham", dong, "hangMuc", s(v("hang_muc")),
		"nhom", jsval.Or(s(v("nhom_sp")), dong),
		"nganh", nganh,
		"muc", categories.Muc(nganh),
		"kichThuocVS", s(v("kich_thuoc")), "heThongXa", s(v("he_thong_xa")), "luongNuocXa", s(v("luong_nuoc_xa")),
		"thietKe", s(v("thiet_ke")), "tamXa", s(v("tam_xa")), "apLucNuoc", s(v("ap_luc_nuoc")),
		"luuY", s(v("luu_y")), "tinhNang", s(v("tinh_nang")),
		"thuongHieu", s(v("thuong_hieu")), "ncc", s(v("nha_cung_cap")),
		"congSuat", congSuat, "nhietDo", nhietDo, "gocChieu", gocChieu,
		"mauSac", s(v("mau_sac")), "chatLieu", chatLieu,
		"chieuCao", chieuCao, "duongKinh", duongKinh,
		"gocNghieng", gocNghieng, "loKhoet", fmtCutout(v("cutout_mm")),
		"capBaoVe", s(v("chi_so_ip")), "cri", cri, "hieuSuat", suffixIf(v("hieu_suat_lm_w"), "", " lm/W"),
		"ugr", s(v("ugr")), "sdcm", s(v("sdcm")), "coi", s(v("coi")), "tuoiTho", s(v("tuoi_tho")), "chipLed", chip, "tenChip", chipTen,
		"quangThong", qt, "baoHanh", bh,
		"tenBoNguon", s(v("ten_bo_nguon")), "maBoNguon", s(v("ma_bo_nguon")), "hangBoNguon", s(v("hang_bo_nguon")),
		"viTriNguon", s(v("vi_tri_lap_nguon")), "tuongThich", s(v("dieu_khien")), "dongRa", suffixIf(v("dong_ra_max_ma"), "", "mA"),
		"lapNguonRoi", lapNguonRoi, "capBaoVeDien", s(v("class_rating")), "linkDatasheet", s(v("link_datasheet")),
		"thongSoFile", s(v("thong_so_file")), "huongDanLapDat", s(v("huong_dan_lap_dat")), "fileBanVe", s(v("file_ban_ve")),
		"kichThuoc", thongSoTK, "size", size,
		"dvt", jsval.Or(s(v("dvt")), "Cái"), "hinhAnh", firstImg(v("anh_sp")), "anhTatCa", s(v("anh_sp")), "moTa", moTa,
		"giaBanLe", n(v("gia_ban_le")), "ckDaiLy", n(v("ck_dai_ly_pct")),
		"donGiaVon", n(v("gia_dai_ly")), "donGiaBan", n(v("gia_dai_ly")), "lnPct", 0.0, "recordId", v("id"), "ngayCapNhat", s(v("ngay_cap_nhat")),
		"daDuyet", v("da_duyet") == true, "nguoiDuyet", s(v("nguoi_duyet")), "ngayDuyet", s(v("ngay_duyet")),
		"nguoiTao", s(v("nguoi_tao")), "ngayTao", s(v("ngay_tao")), "nguoiSua", s(v("nguoi_sua")),
		"nhomBT", s(v("nhom_bt")),
		"raw", rawColsOf(r),
	)
}

// rawColsOf = rawCols_ (S:144-153): giá trị gốc của mọi trường trong form Nhập, dạng chuỗi.
func rawColsOf(r *omap.Map) *omap.Map {
	// giá trị chỉ phụ thuộc tên cột nên cột lặp trong rawCols gán lại đúng giá trị cũ: duyệt bộ khoá đã khử trùng là đủ
	vals := make([]any, rawShape.Len())
	for i, c := range rawShape.Keys() {
		val := r.Val(c)
		switch {
		case c == "lap_nguon_roi":
			if jsval.Truthy(val) {
				vals[i] = "Có"
			} else {
				vals[i] = ""
			}
		case jsval.IsNullish(val):
			vals[i] = ""
		default:
			vals[i] = jsval.ToString(val)
		}
	}
	return rawShape.Map(vals)
}
