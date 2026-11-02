// Package projects: dự án / bản nháp (du_an), dữ liệu rời của dự án (du_an_data), cài đặt dùng chung công ty
// (cai_dat_cong_ty) và bootstrap. Bản chuyển 1:1 của store_supa.js:223-312, 1014-1028, 1089-1153.
package projects

import (
	"context"
	"math"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

// Deps: Catalog = materials (getProductsCached), Lines = takeoff (getLines). Repo để trống thì dùng DB.
// Users / UserFmt / Notifier / Admins: yêu cầu sửa thông tin dự án (service_edit_requests.go); để trống thì không báo ai.
type Deps struct {
	DB       *database.DB
	Cfg      *config.Config
	Catalog  contracts.CatalogReader
	Lines    contracts.LineReader
	Users    contracts.UserReader
	UserFmt  contracts.UserFormatter
	Notifier contracts.Notifier
	Admins   contracts.AdminLister
	Repo     Repository
}

// Service: nghiệp vụ dự án.
type Service struct {
	repo     Repository
	db       *database.DB // transaction (D-13); nil khi chạy repo giả
	cfg      *config.Config
	catalog  contracts.CatalogReader
	lines    contracts.LineReader
	users    contracts.UserReader
	userFmt  contracts.UserFormatter
	notifier contracts.Notifier
	admins   contracts.AdminLister
	now      func() string  // nowIso()
	genMa    func() string  // genMaDA_()
	random   func() float64 // Math.random()
}

var _ contracts.ProjectReader = (*Service)(nil)

// New tạo service.
func New(d Deps) *Service {
	repo := d.Repo
	if repo == nil {
		repo = NewRepository(d.DB)
	}
	s := &Service{repo: repo, db: d.DB, cfg: d.Cfg, catalog: d.Catalog, lines: d.Lines, users: d.Users, userFmt: d.UserFmt,
		notifier: d.Notifier, admins: d.Admins, now: jsval.NowISO, random: rand.Float64}
	s.genMa = func() string { return genMaDA(time.Now(), s.random()) }
	return s
}

// tx: chạy fn trong transaction (D-13). Repo giả trong test unit không có DB -> chạy thẳng.
func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	return s.db.Tx(ctx, fn)
}

// projToObj (S:227-231): dòng du_an -> object cho client.
func projToObj(r *omap.Map) *omap.Map {
	o := omap.Of("maDA", jsval.S(r.Val("ma_da")), "ngayTao", jsval.S(r.Val("ngay_tao")), "capNhat", jsval.S(r.Val("cap_nhat")))
	for _, p := range projMap {
		if p[0] == "vat" || p[0] == "tienDo" {
			o.Set(p[0], qscore.N(r.Val(p[1])))
		} else {
			o.Set(p[0], jsval.S(r.Val(p[1])))
		}
	}
	return o
}

// GetProjects (S:232-235).
func (s *Service) GetProjects(ctx context.Context) ([]any, error) {
	rows, err := s.repo.ListProjects(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = projToObj(r)
	}
	return out, nil
}

// GetProject (S:236-239): không có -> nil (JSON null).
func (s *Service) GetProject(ctx context.Context, maDA any) (*omap.Map, error) {
	rows, err := s.repo.FindProject(ctx, maDA)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 || rows[0] == nil {
		return nil, nil
	}
	return projToObj(rows[0]), nil
}

const digits36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

// rand36 = Math.random().toString(36).slice(2, 4).toUpperCase(): hai chữ số đầu sau dấu chấm ở hệ 36;
// số có ít chữ số hơn (0, 0.5...) cho chuỗi ngắn hơn như JS. Phần thập phân sinh đúng theo DoubleToRadixCString
// của V8 (dừng khi đủ phân biệt với số kề bên, làm tròn lên có nhớ) nên khớp cả ở sát ranh giới chữ số.
func rand36(value float64) string {
	if !(value > 0 && value < 1) {
		return "" // "0" (hoặc số >= 1, Math.random không sinh ra): slice(2, 4) rỗng
	}
	frac := value
	delta := math.Max(math.SmallestNonzeroFloat64, 0.5*(math.Nextafter(value, 2)-value))
	buf := make([]byte, 0, 64)
	if frac >= delta {
	gen:
		for {
			frac *= 36
			delta *= 36
			d := int(frac)
			buf = append(buf, digits36[d])
			frac -= float64(d)
			if (frac > 0.5 || (frac == 0.5 && d&1 == 1)) && frac+delta > 1 {
				for {
					if len(buf) == 0 {
						return "" // nhớ sang phần nguyên -> "1"
					}
					last := strings.IndexByte(digits36, buf[len(buf)-1])
					buf = buf[:len(buf)-1]
					if last+1 < 36 {
						buf = append(buf, digits36[last+1])
						break gen
					}
				}
			}
			if !(frac >= delta) {
				break
			}
		}
	}
	if len(buf) > 2 {
		buf = buf[:2]
	}
	return string(buf)
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// genMaDA = genMaDA_ (S:240-246): DA-YYYYMMDD-HHMMSS theo giờ Việt Nam + 2 ký tự ngẫu nhiên.
func genMaDA(now time.Time, rnd float64) string {
	d := now.UTC().Add(7 * time.Hour)
	return "DA-" + strconv.Itoa(d.Year()) + pad2(int(d.Month())) + pad2(d.Day()) + "-" +
		pad2(d.Hour()) + pad2(d.Minute()) + pad2(d.Second()) + rand36(rnd)
}

// CreateProject (S:247-256).
func (s *Service) CreateProject(ctx context.Context, data any) (*omap.Map, error) {
	d := jsval.AsMap(data) // data || {}; giá trị không phải object đọc khoá nào cũng ra undefined
	maDA := d.Val("maDA")
	if !jsval.Truthy(maDA) {
		maDA = s.genMa()
	}
	row := omap.Of("ma_da", maDA, "ngay_tao", s.now(), "cap_nhat", s.now())
	for _, p := range projMap {
		v := d.Val(p[0])
		if !jsval.IsNullish(v) && !jsval.StrictEquals(v, "") {
			row.Set(p[1], v)
		}
	}
	if !jsval.Truthy(row.Val("trang_thai")) {
		row.Set("trang_thai", "Bản nháp")
	}
	res, err := s.repo.InsertProject(ctx, row)
	if err != nil {
		return nil, apperr.ColErr(err)
	}
	if len(res) == 0 || res[0] == nil {
		return nil, apperr.New("Cannot read properties of undefined (reading 'ma_da')")
	}
	return projToObj(res[0]), nil
}

// UpdateProject (S:257-265): trả dòng đã sửa; không có dòng nào đổi -> getProject (null khi không tồn tại).
func (s *Service) UpdateProject(ctx context.Context, maDA any, fields any) (*omap.Map, error) {
	patch := omap.Of("cap_nhat", s.now())
	jsval.AsMap(fields).Each(func(k string, v any) {
		if col, ok := projCol[k]; ok {
			patch.Set(col, v)
		} else if col, ok := protoCol(k); ok {
			// khoá trùng tên thuộc tính Object.prototype: Node ghi vào "cột" lạ nên cả lệnh sửa hỏng, không ghi gì
			patch.Set(col, v)
		}
	})
	res, err := s.repo.UpdateProject(ctx, maDA, patch)
	if err != nil {
		return nil, apperr.ColErr(err) // chưa chạy migration -> báo đúng cột còn thiếu
	}
	if len(res) > 0 && res[0] != nil {
		return projToObj(res[0]), nil
	}
	return s.GetProject(ctx, maDA)
}

// DeleteProject (S:266-273): xoá dòng bóc tách, tờ bìa, dữ liệu rời rồi mới tới dự án.
// D-13: 4 lệnh xoá chung 1 transaction -> lỗi giữa chừng không còn cảnh mất dòng bóc tách / tờ bìa mà dự án vẫn còn
// (Node để lại dữ liệu dở). Thành công thì kết quả và dữ liệu như cũ.
// Trong transaction xoá dòng du_an TRƯỚC TIÊN để khoá dự án trước mọi dòng con: nếu xoá con trước rồi mới tới du_an
// thì va với Tx khác vừa chèn dòng con (giữ KEY SHARE trên du_an) rồi xoá dòng con cũ (vd SaveCover) -> deadlock 40P01.
// 3 bảng con đều ON DELETE CASCADE (infra/db/schema.sql) nên 3 lệnh xoá sau thành rỗng; kết quả + dữ liệu cuối y như cũ.
// Không có DB (repo giả, không transaction): giữ đúng thứ tự Node (con trước, du_an sau).
func (s *Service) DeleteProject(ctx context.Context, maDA any) (*omap.Map, error) {
	coTx := s.db != nil
	err := s.tx(ctx, func(ctx context.Context) error {
		if coTx {
			if err := s.repo.DeleteProject(ctx, maDA); err != nil {
				return err
			}
		}
		if err := s.repo.DeleteLines(ctx, maDA); err != nil {
			return err
		}
		if err := s.repo.DeleteCover(ctx, maDA); err != nil {
			return err
		}
		// Node nuốt mọi lỗi ở bước này (chưa có bảng); trong transaction mỗi lệnh có savepoint riêng
		// nên lệnh hỏng ở đây không làm hỏng transaction, lệnh sau vẫn chạy
		_ = s.repo.DeleteProjData(ctx, maDA)
		if coTx {
			return nil
		}
		return s.repo.DeleteProject(ctx, maDA)
	})
	if err != nil {
		return nil, err
	}
	return omap.Of("ok", true), nil
}

// DuplicateProject (S:275-312): chép dự án (mã mới) + dòng bóc tách + tờ bìa + dữ liệu rời.
// D-13: chèn dự án + chép dòng con chung 1 transaction; hỏng giữa chừng -> rollback, không còn bản nháp dở.
func (s *Service) DuplicateProject(ctx context.Context, maDA any, opts any) (*omap.Map, error) {
	o := jsval.AsMap(opts)
	cpBoc := !jsval.StrictEquals(o.Val("boc"), false)
	cpCover := !jsval.StrictEquals(o.Val("cover"), false)
	srcRows, err := s.repo.FindProject(ctx, maDA)
	if err != nil {
		return nil, err
	}
	if len(srcRows) == 0 || srcRows[0] == nil {
		return nil, apperr.New("Không tìm thấy bản nháp nguồn")
	}
	newMa := s.genMa()
	projRow := srcRows[0].Clone()
	projRow.Delete("id")
	projRow.Set("ma_da", newMa).Set("ngay_tao", s.now()).Set("cap_nhat", s.now())
	var ins []*omap.Map
	err = s.tx(ctx, func(ctx context.Context) error {
		var err error
		if ins, err = s.repo.InsertProject(ctx, projRow); err != nil {
			return err
		}
		if err := s.copyChildren(ctx, maDA, newMa, cpBoc, cpCover, o); err != nil {
			if s.db == nil {
				// không có transaction (repo giả): bù trừ như Node - xoá bản nháp dở (lỗi của bước dọn bị nuốt).
				// Có transaction thì rollback đã dọn; KHÔNG xoá theo newMa sau rollback vì có thể trúng
				// bản nháp cùng mã của request khác vừa tạo.
				_, _ = s.DeleteProject(ctx, newMa)
			}
			return err
		}
		if len(ins) == 0 || ins[0] == nil {
			// trong transaction: lỗi này nay rollback cả bản nháp (Node để lại bản nháp đã chép)
			return apperr.New("Cannot read properties of undefined (reading 'ma_da')")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return projToObj(ins[0]), nil
}

// copyChildren: phần thân khối try của duplicateProject (S:286-309).
func (s *Service) copyChildren(ctx context.Context, maDA any, newMa string, cpBoc, cpCover bool, o *omap.Map) error {
	if cpBoc {
		lines, err := s.repo.ListLinesRaw(ctx, maDA)
		if err != nil {
			return err
		}
		if len(lines) > 0 {
			rows := make([]*omap.Map, len(lines))
			for i, r := range lines {
				c := r.Clone()
				c.Delete("id")
				c.Delete("created_at")
				rows[i] = c.Set("ma_du_an", newMa)
			}
			if err := s.repo.InsertLines(ctx, rows); err != nil {
				return err
			}
		}
	}
	if cpCover {
		cover, err := s.repo.ListCoverRaw(ctx, maDA)
		if err != nil {
			return err
		}
		if len(cover) > 0 {
			rows := make([]*omap.Map, len(cover))
			for i, r := range cover {
				c := r.Clone()
				c.Delete("id")
				c.Delete("created_at")
				rows[i] = c.Set("ma_da", newMa)
			}
			if err := s.repo.InsertCover(ctx, rows); err != nil {
				return err
			}
		}
	}
	// KHÔNG chép lịch sử phiên bản báo giá; opts.pt === false thì không chép bảng phần thô
	ds, err := s.repo.ListProjDataRaw(ctx, maDA)
	if err != nil {
		if !daDataThieuBang(err) {
			return err
		}
		ds = nil // chưa có bảng du_an_data -> bỏ qua
	}
	boPT := jsval.StrictEquals(o.Val("pt"), false)
	rows := []*omap.Map{}
	for _, r := range ds {
		khoa := r.Val("khoa")
		if jsval.StrictEquals(khoa, "bgHist") {
			continue
		}
		if boPT && (jsval.StrictEquals(khoa, "phanTho") || jsval.StrictEquals(khoa, "ptVat")) {
			continue
		}
		rows = append(rows, r.Clone().Set("ma_da", newMa).Set("cap_nhat", s.now()))
	}
	if len(rows) > 0 {
		return s.repo.InsertProjDataRows(ctx, rows)
	}
	return nil
}

// Bootstrap (S:1014-1023): dự án + danh mục sản phẩm (bản cache) + dòng bóc tách của maDA.
func (s *Service) Bootstrap(ctx context.Context, maDA any) (*omap.Map, error) {
	// Promise.all: hai việc chạy song song; việc nào hỏng TRƯỚC thì trả lỗi đó NGAY, không chờ việc kia
	// (việc kia vẫn chạy nốt ở nền như Node, kết quả / lỗi của nó bị bỏ).
	type part struct {
		isProducts bool
		list       []any
		err        error
		panicked   any
	}
	ch := make(chan part, 2) // đệm 2: goroutine về sau không bị kẹt khi hàm đã trả về
	// request kết thúc sẽ huỷ ctx; Node không huỷ việc đang chạy nên danh mục vẫn nạp xong vào cache
	bg := context.WithoutCancel(ctx)
	run := func(isProducts bool, fn func(context.Context) ([]any, error)) {
		go func() {
			p := part{isProducts: isProducts}
			// panic ở goroutine con sẽ làm sập cả tiến trình -> bắt lại, ném ở goroutine gọi
			defer func() {
				p.panicked = recover()
				ch <- p
			}()
			p.list, p.err = fn(bg)
		}()
	}
	run(false, s.GetProjects)
	run(true, s.catalog.GetProductsCached)
	var projects, products []any
	for i := 0; i < 2; i++ {
		p := <-ch
		if p.panicked != nil {
			panic(p.panicked)
		}
		if p.err != nil {
			return nil, p.err
		}
		if p.isProducts {
			products = p.list
		} else {
			projects = p.list
		}
	}
	lines := []any{}
	if jsval.Truthy(maDA) {
		if ls, err := s.lines.GetLines(ctx, maDA); err == nil { // lỗi đọc dòng -> []
			lines = ls
		}
	}
	if products == nil {
		products = []any{}
	}
	if lines == nil {
		lines = []any{}
	}
	return omap.Of("projects", projects, "products", products, "lines", lines,
		"catSheets", getCatalogSheetsFrom(products), "sheetCols", []any{}), nil
}

// getCatalogSheetsFrom = getCatalogSheetsFrom_ (S:1024-1028): các nhom khác nhau theo thứ tự xuất hiện.
func getCatalogSheetsFrom(products []any) []any {
	seen := map[string]bool{}
	out := []any{}
	for _, p := range products {
		nhom := jsval.Get(p, "nhom")
		if !jsval.Truthy(nhom) {
			continue
		}
		// seen[p.nhom] của Node tra cả Object.prototype: nhom tên "constructor", "toString"... không bao giờ được thêm
		if k := jsval.ToString(nhom); !seen[k] && !objProtoNames[k] {
			seen[k] = true
			out = append(out, nhom)
		}
	}
	return out
}
