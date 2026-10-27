// Package quotations: tờ bìa khái toán (khai_toan) và xuất báo giá ra Excel.
// Bản chuyển của getCover / buildCoverFromTemplate / getCoverOrInit / saveCover / getQuote (server/store_supa.js)
// và toàn bộ server/export.js.
package quotations

import (
	"context"
	"net/http"
	"strings"

	"qspro-backend/internal/config"
	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/qscore"
)

// Deps: phụ thuộc của module. Lines (takeoff), Projects (projects), Media (files), Files (platform/storage) là interface
// của contracts. Repo và HTTP để trống thì dùng bản mặc định (Postgres qua DB, http.Client chuẩn).
type Deps struct {
	DB       *database.DB
	Cfg      *config.Config
	Lines    contracts.LineReader
	Projects contracts.ProjectReader
	Media    contracts.MediaDownloader
	Files    contracts.FileReader
	Repo     Repository
	HTTP     *http.Client
}

type Service struct {
	db       *database.DB // D-13: mở transaction cho SaveCover; nil (repo giả trong test unit) -> chạy thẳng
	repo     Repository
	lines    contracts.LineReader
	projects contracts.ProjectReader
	media    contracts.MediaDownloader
	files    contracts.FileReader
	http     *http.Client
}

func New(d Deps) *Service {
	s := &Service{db: d.DB, repo: d.Repo, lines: d.Lines, projects: d.Projects, media: d.Media, files: d.Files, http: d.HTTP}
	if s.repo == nil {
		s.repo = newPgRepo(d.DB)
	}
	if s.http == nil {
		s.http = newImageClient()
	}
	return s
}

// GetCover = getCover (S:408-411).
func (s *Service) GetCover(ctx context.Context, maDA any) ([]any, error) {
	rows, err := s.repo.CoverRows(ctx, maDA)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = omap.Of("stt", jsval.S(r.Val("stt")), "hangMuc", jsval.S(r.Val("hang_muc")), "moTa", jsval.S(r.Val("mo_ta")),
			"chiPhi", qscore.N(r.Val("chi_phi")))
	}
	return out, nil
}

// BuildCoverFromTemplate = buildCoverFromTemplate (S:413-424): mẫu tờ bìa, mục LÁ cộng thành tiền mọi dòng bóc tách
// có nhom thuộc mục đó. maDA falsy thì không đọc dòng.
func (s *Service) BuildCoverFromTemplate(ctx context.Context, maDA any) ([]any, error) {
	tmpl := qscore.CoverTemplate
	var lines []any
	if jsval.Truthy(maDA) {
		var err error
		if lines, err = s.lines.GetLines(ctx, maDA); err != nil {
			return nil, err
		}
	}
	isLeaf := func(st string) bool {
		for _, t := range tmpl {
			if t[0] != st && strings.HasPrefix(t[0], st+".") {
				return false
			}
		}
		return true
	}
	out := make([]any, len(tmpl))
	for i, t := range tmpl {
		chiPhi := 0.0
		if isLeaf(t[0]) {
			for _, l := range lines {
				if qscore.InCode(jsval.Get(l, "nhom"), t[0]) {
					chiPhi += qscore.N(jsval.Get(l, "thanhTienBan"))
				}
			}
		}
		out[i] = omap.Of("stt", t[0], "hangMuc", t[1], "moTa", t[2], "chiPhi", jsval.Round(chiPhi))
	}
	return out, nil
}

// GetCoverOrInit = getCoverOrInit (S:425-429): tờ bìa đã lưu, chưa có thì dựng từ mẫu.
func (s *Service) GetCoverOrInit(ctx context.Context, maDA any) ([]any, error) {
	cur, err := s.GetCover(ctx, maDA)
	if err != nil {
		return nil, err
	}
	if len(cur) > 0 {
		return cur, nil
	}
	return s.BuildCoverFromTemplate(ctx, maDA)
}

// tx: chạy fn trong 1 transaction (D-13). Repo giả trong test unit không có DB -> chạy thẳng.
func (s *Service) tx(ctx context.Context, fn func(ctx context.Context) error) error {
	if s.db == nil {
		return fn(ctx)
	}
	return s.db.Tx(ctx, fn)
}

// SaveCover = saveCover (S:430-440). Ghi bản mới TRƯỚC rồi mới xoá bản cũ. D-13: đọc id cũ + chèn + xoá chạy trong 1
// transaction -> lỗi giữa chừng (vd xoá bản cũ hỏng) không để lại cả bản mới lẫn bản cũ; thành công thì y như trước.
// Lỗi trả nguyên (KhongCoCha -> DAMat ánh xạ ngay trong fn). Đọc lại tờ bìa SAU commit.
func (s *Service) SaveCover(ctx context.Context, maDA, rows any) ([]any, error) {
	if err := s.tx(ctx, func(ctx context.Context) error { return s.ghiCover(ctx, maDA, rows) }); err != nil {
		return nil, err
	}
	return s.GetCover(ctx, maDA) // client gán thẳng S.cover = kết quả -> phải là mảng dòng
}

// ghiCover: phần ghi của SaveCover (chạy trong transaction), thứ tự kiểm / lỗi giữ như saveCover.
func (s *Service) ghiCover(ctx context.Context, maDA, rows any) error {
	old, err := s.repo.CoverIDs(ctx, maDA)
	if err != nil {
		return err
	}
	var list []any
	if jsval.Truthy(rows) {
		var ok bool
		if list, ok = rows.([]any); !ok {
			return apperr.New("(rows || []).map is not a function")
		}
	}
	arr := make([]*omap.Map, len(list))
	for i, r := range list {
		if jsval.IsNullish(r) {
			return typeErrRead(r, "stt")
		}
		arr[i] = omap.Of("ma_da", maDA, "stt", jsval.S(prop(r, "stt")), "hang_muc", jsval.S(prop(r, "hangMuc")),
			"mo_ta", jsval.S(prop(r, "moTa")), "chi_phi", qscore.N(prop(r, "chiPhi")), "sort_no", float64(i))
	}
	if len(arr) > 0 {
		if err := s.repo.InsertCover(ctx, arr); err != nil {
			if apperr.KhongCoCha(err) {
				return apperr.New(apperr.DAMat)
			}
			return err
		}
	}
	if len(old) > 0 {
		ids := make([]any, len(old))
		for i, r := range old {
			ids[i] = r.Val("id")
		}
		// Array.join: null / undefined thành rỗng
		return s.repo.RemoveCover(ctx, jsval.ToString(ids))
	}
	return nil
}

// Quote: kết quả của getQuote - {maDA, project, lines, subtotal, vatPct, vat, total}.
type Quote struct {
	MaDA     any       `json:"maDA"`
	Project  *omap.Map `json:"project"`
	Lines    []any     `json:"lines"`
	Subtotal float64   `json:"subtotal"`
	VatPct   float64   `json:"vatPct"`
	Vat      float64   `json:"vat"`
	Total    float64   `json:"total"`
}

// GetQuote = getQuote (S:1006-1013): dự án + dòng bóc tách + tổng. Chỉ exportBaoGia dùng (không phải hàm rpc).
func (s *Service) GetQuote(ctx context.Context, maDA any) (*Quote, error) {
	lines, err := s.lines.GetLines(ctx, maDA)
	if err != nil {
		return nil, err
	}
	proj, err := s.projects.GetProject(ctx, maDA)
	if err != nil {
		return nil, err
	}
	subtotal := 0.0
	for _, l := range lines {
		subtotal += qscore.N(jsval.Get(l, "thanhTienBan"))
	}
	vatPct := 0.0
	if proj != nil {
		vatPct = qscore.N(proj.Val("vat"))
	}
	vat := qscore.Round0(subtotal * vatPct / 100)
	if lines == nil {
		lines = []any{}
	}
	return &Quote{MaDA: maDA, Project: proj, Lines: lines, Subtotal: subtotal, VatPct: vatPct, Vat: vat, Total: subtotal + vat}, nil
}
