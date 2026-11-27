package projects

// Nhập toàn bộ dự án của website dezon.vn (WordPress, kiểu bài "project") vào Danh sách dự án của công ty đang làm việc.
// Chạy nền (một lượt / công ty): đọc hết danh sách REST, rồi từng dự án đọc trang chi tiết, tạo dự án mới hoặc chỉ điền
// ô còn trống của dự án đã có cùng link dezon.vn (không đè dữ liệu người dùng), ảnh (anhDuAn) chỉ ghi khi dự án chưa có ảnh:
// ảnh bìa + 6 ảnh đầu lưu trên máy chủ (UPLOAD_DIR/dezonvn/<id bài>/<16 hex theo ảnh gốc>.jpg, JPEG 1280 px), ảnh còn lại
// giữ link dezon.vn.
// Thư mục dezonvn/ tải lại được nên không nằm trong bản sao lưu file hằng đêm (infra/scripts/backup-db.sh).

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"qspro-backend/internal/platform/database"
	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/actor"
	"qspro-backend/internal/shared/contracts"
	apperr "qspro-backend/internal/shared/errors"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

// ImageStore: kho file trên đĩa (*storage.Client của platform/storage khớp sẵn) - ghi ảnh, kiểm file đã có, URL công khai.
type ImageStore interface {
	contracts.Uploader
	Open(p string) (*os.File, fs.FileInfo, error)
	PublicURL(p string) string
}

// dezonLister: dự án đã gắn link dezon.vn của công ty đang xem (mọi dòng, không giới hạn 2000 như ListProjects).
type dezonLister interface {
	ListDezonLinked(ctx context.Context) ([]*omap.Map, error)
	DezonSeen(ctx context.Context) ([]string, error)
	SaveDezonSeen(ctx context.Context, links []string, user string, at any) error
}

// dzSeenKey: khoá cai_dat_cong_ty giữ link (đã chuẩn hoá) mọi dự án dezon.vn đã có trong QS ở các lượt nhập trước.
// Lượt sau không tạo lại dự án người dùng đã xoá / đổi link, không điền lại ô người dùng đã xoá trống.
const dzSeenKey = "dezonDaNhap"

func (r *pgRepo) DezonSeen(ctx context.Context) ([]string, error) {
	rows, err := r.db.Select(ctx, "cai_dat_cong_ty", database.SelectOpt{Select: "gia_tri", Filter: database.Eq("khoa", dzSeenKey), Limit: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	var out []string
	for _, x := range jsval.AsArray(rows[0].Val("gia_tri")) {
		if v := jsval.S(x); v != "" {
			out = append(out, v)
		}
	}
	return out, nil
}

func (r *pgRepo) SaveDezonSeen(ctx context.Context, links []string, user string, at any) error {
	arr := make([]any, len(links))
	for i, l := range links {
		arr[i] = l
	}
	loc := database.Eq("khoa", dzSeenKey)
	row := omap.Of("khoa", dzSeenKey, "gia_tri", arr, "cap_nhat", at, "nguoi_sua", user)
	co, err := r.FindCompanySetting(ctx, loc, false)
	if err != nil {
		return err
	}
	if len(co) > 0 {
		return r.UpdateCompanySetting(ctx, loc, row, false)
	}
	return r.InsertCompanySetting(ctx, row, false)
}

// dzRun: trạng thái dùng chung giữa các worker của 1 lượt nhập (khoá mu).
type dzRun struct {
	mu   sync.Mutex
	idx  map[string]string // link đã chuẩn hoá -> ma_da
	prev map[string]bool   // link đã có trong QS ở lượt trước (dzSeenKey, đọc lúc bắt đầu)
	seen map[string]bool   // prev + link có trong QS lúc bắt đầu + dự án lượt này tạo; ghi lại khi xong
}

func (st *dzRun) links() []string {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := make([]string, 0, len(st.seen))
	for k := range st.seen {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

// ListDezonLinked: dòng cũ trước - nhiều bản nháp cùng link thì bản tạo đầu tiên được điền.
func (r *pgRepo) ListDezonLinked(ctx context.Context) ([]*omap.Map, error) {
	return r.db.Select(ctx, "du_an", database.SelectOpt{Select: "*", Filter: "link_dezon=not.is.null", Order: "ngay_tao.asc"})
}

const (
	dzBase        = "https://dezon.vn"
	dzPerPage     = 100
	dzUA          = "QSPro-Dezon-Import/1.0"
	dzJobTimeout  = 3 * time.Hour
	dzListTimeout = 30 * time.Second
	dzPageTimeout = 30 * time.Second
	dzImgTimeout  = 60 * time.Second
	dzListMax     = 16 << 20
	dzPageMax     = 3 << 20
	dzImgMax      = 30 << 20
	dzWorkers     = 3 // số trang / dự án tải cùng lúc
	dzLocalImgs   = 6 // số ảnh (ngoài ảnh bìa) lưu trên máy chủ
	dzRetries     = 2
	dzErrMax      = 50
	dzDir         = "dezonvn"
)

var errDzHost = errors.New("địa chỉ không thuộc dezon.vn")

// dezonImporter: HTTP tới dezon.vn + trạng thái lượt nhập theo công ty.
type dezonImporter struct {
	client    *http.Client
	files     ImageStore
	delay     time.Duration // khoảng cách tối thiểu giữa 2 lần bắt đầu tải (toàn bộ lượt nhập)
	retryWait time.Duration
	pmu       sync.Mutex
	last      time.Time
	mu        sync.Mutex
	jobs      map[string]*dzJob // khoá = công ty
}

func newDezonImporter(files ImageStore) *dezonImporter {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = nil
	return &dezonImporter{files: files, delay: 200 * time.Millisecond, retryWait: time.Second, jobs: map[string]*dzJob{},
		client: &http.Client{Transport: tr, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("chuyển hướng quá nhiều lần")
			}
			if !dzHostOK(req.URL.Hostname()) {
				return errDzHost
			}
			return nil
		}}}
}

// dzJob: trạng thái 1 lượt nhập.
type dzJob struct {
	mu                                                     sync.Mutex
	running, dryRun                                        bool
	limit                                                  int
	total, done, created, updated, skipped, failed, images int
	imagesFailed                                           int
	startedAt, finishedAt, current                         string
	errs                                                   []*omap.Map
}

func (j *dzJob) snapshot() *omap.Map {
	j.mu.Lock()
	defer j.mu.Unlock()
	errs := make([]any, len(j.errs))
	for i, e := range j.errs {
		errs[i] = e
	}
	opt := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	return omap.Of("running", j.running, "dryRun", j.dryRun, "limit", float64(j.limit), "total", float64(j.total),
		"done", float64(j.done), "created", float64(j.created), "updated", float64(j.updated), "skipped", float64(j.skipped),
		"failed", float64(j.failed), "images", float64(j.images), "imagesFailed", float64(j.imagesFailed),
		"startedAt", opt(j.startedAt), "finishedAt", opt(j.finishedAt), "current", j.current, "errors", errs)
}

func (j *dzJob) addErrLocked(title, link, msg string) {
	if len(j.errs) < dzErrMax {
		j.errs = append(j.errs, omap.Of("title", title, "link", link, "error", msg))
	}
}

func (j *dzJob) addErr(title, link, msg string) {
	j.mu.Lock()
	j.addErrLocked(title, link, msg)
	j.mu.Unlock()
}

// dzResult: kết quả 1 dự án.
type dzResult struct {
	status          string // created | updated | skipped
	images, imgFail int
}

func (j *dzJob) record(it dzItem, r dzResult, err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done++
	j.images += r.images
	j.imagesFailed += r.imgFail
	if err != nil {
		j.failed++
		j.addErrLocked(it.Title, it.Link, err.Error())
		return
	}
	switch r.status {
	case "created":
		j.created++
	case "updated":
		j.updated++
	default:
		j.skipped++
	}
}

// dzCompany: công ty của lượt nhập; super chưa chọn công ty (x-view-company) -> 400.
func dzCompany(ctx context.Context) (string, error) {
	cty := tenant.TenantID(ctx)
	if !jsval.Truthy(cty) {
		return "", apperr.BadRequest("Chọn công ty cần nhập (xem như công ty) trước khi nhập dự án từ dezon.vn")
	}
	return jsval.ToString(cty), nil
}

// StartDezonImport: bắt đầu lượt nhập nền cho công ty đang làm việc. limit = số dự án tối đa (0 / thiếu = tất cả),
// dryRun = chỉ đọc và đếm (không ghi database, không tải ảnh). Đang có lượt chạy -> 409.
func (s *Service) StartDezonImport(ctx context.Context, a *actor.Actor, limit, dryRun any) (*omap.Map, error) {
	key, err := dzCompany(ctx)
	if err != nil {
		return nil, err
	}
	n := 0
	if !jsval.IsNullish(limit) && !jsval.StrictEquals(limit, "") {
		f := jsval.ToNumber(limit)
		if math.IsNaN(f) || f < 0 || f != math.Trunc(f) || f > 1e6 {
			return nil, apperr.BadRequest("limit phải là số nguyên không âm (0 = tất cả)")
		}
		n = int(f)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	lister, ok := s.repo.(dezonLister)
	if !s.dzOK || !ok {
		return nil, apperr.New("Máy chủ chưa nối database")
	}
	j := &dzJob{running: true, dryRun: jsval.Truthy(dryRun), limit: n, startedAt: s.now()}
	s.dz.mu.Lock()
	if cu := s.dz.jobs[key]; cu != nil && cu.isRunning() {
		s.dz.mu.Unlock()
		return nil, apperr.E(409, "Đang nhập dự án từ dezon.vn cho công ty này, chờ lượt hiện tại xong rồi chạy lại")
	}
	s.dz.jobs[key] = j
	s.dz.mu.Unlock()
	user := ""
	if a != nil {
		user = a.U
	}
	tc := tenant.From(ctx)
	go s.runDezonImport(tc, user, lister, j)
	return j.snapshot(), nil
}

func (j *dzJob) isRunning() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.running
}

// DezonImportStatus: trạng thái lượt nhập gần nhất của công ty (chưa chạy lần nào -> số 0, running false).
func (s *Service) DezonImportStatus(ctx context.Context) (*omap.Map, error) {
	key, err := dzCompany(ctx)
	if err != nil {
		return nil, err
	}
	s.dz.mu.Lock()
	j := s.dz.jobs[key]
	s.dz.mu.Unlock()
	if j == nil {
		j = &dzJob{}
	}
	return j.snapshot(), nil
}

// runDezonImport: thân lượt nhập (goroutine riêng). Ngữ cảnh mới không dính request, chỉ mang công ty đang làm việc.
func (s *Service) runDezonImport(tc tenant.Ctx, user string, lister dezonLister, j *dzJob) {
	ctx, cancel := context.WithTimeout(tenant.With(context.Background(), tc), dzJobTimeout)
	defer cancel()
	defer func() {
		if p := recover(); p != nil {
			logger.Error("projects", "nhập dezon.vn: lỗi máy chủ:", jsval.Str(p))
			j.addErr("", "", "Lỗi máy chủ khi nhập: "+jsval.Str(p))
		}
		j.mu.Lock()
		j.running, j.current, j.finishedAt = false, "", s.now()
		logger.Infof("projects", "nhập dezon.vn xong (công ty %v, thử %v): %d/%d dự án, tạo %d, bổ sung %d, bỏ qua %d, lỗi %d, ảnh %d",
			tenant.TenantID(ctx), j.dryRun, j.done, j.total, j.created, j.updated, j.skipped, j.failed, j.images)
		j.mu.Unlock()
	}()
	items := s.dz.fetchList(ctx, j)
	j.mu.Lock()
	j.total = len(items)
	j.mu.Unlock()
	if len(items) == 0 {
		return
	}
	rows, err := lister.ListDezonLinked(ctx)
	if err != nil {
		j.addErr("", "", "Không đọc được danh sách dự án QS: "+err.Error())
		return
	}
	prevList, err := lister.DezonSeen(ctx)
	if err != nil {
		j.addErr("", "", "Không đọc được danh sách dự án đã nhập lần trước: "+err.Error())
		return
	}
	st := &dzRun{idx: map[string]string{}, prev: map[string]bool{}, seen: map[string]bool{}}
	for _, l := range prevList {
		if k := normDezonURL(l); k != "" {
			st.prev[k], st.seen[k] = true, true
		}
	}
	for _, r := range rows { // giá trị các ô đọc lại ngay trước khi ghi
		k, ma := normDezonURL(jsval.S(r.Val("link_dezon"))), jsval.S(r.Val("ma_da"))
		if k != "" && ma != "" && st.idx[k] == "" {
			st.idx[k] = ma
		}
		if k != "" {
			st.seen[k] = true
		}
	}
	if !j.dryRun {
		defer func() { // cả khi dừng giữa chừng: dự án đã tạo được thì lượt sau không tạo lại
			sctx, scancel := context.WithTimeout(tenant.With(context.Background(), tc), 30*time.Second)
			defer scancel()
			if err := lister.SaveDezonSeen(sctx, st.links(), user, s.now()); err != nil {
				logger.Error("projects", "nhập dezon.vn: không lưu được danh sách đã nhập:", err.Error())
				j.addErr("", "", "Không lưu được danh sách dự án đã nhập (lượt sau có thể tạo lại dự án đã xoá): "+err.Error())
			}
		}()
	}
	work := make(chan dzItem)
	var wg sync.WaitGroup
	for range dzWorkers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for it := range work {
				if ctx.Err() != nil {
					continue
				}
				j.mu.Lock()
				j.current = it.Title
				j.mu.Unlock()
				r, err := s.dzImportSafe(ctx, user, j.dryRun, it, st)
				j.record(it, r, err)
			}
		}()
	}
	for _, it := range items {
		work <- it
	}
	close(work)
	wg.Wait()
	if err := ctx.Err(); err != nil {
		j.addErr("", "", "Lượt nhập dừng giữa chừng (quá thời gian): "+err.Error())
	}
}

// dzGetSafe: lệnh tải trong goroutine worker - panic thành lỗi, không làm sập máy chủ.
func dzGetSafe(f func() ([]byte, http.Header, error)) (b []byte, h http.Header, err error) {
	defer func() {
		if p := recover(); p != nil {
			b, h, err = nil, nil, fmt.Errorf("lỗi máy chủ: %s", jsval.Str(p))
		}
	}()
	return f()
}

// dzImportSafe: dzImportOne trong goroutine worker - panic (ảnh / trang lỗi lạ) thành lỗi của dự án đó, không làm sập máy chủ.
func (s *Service) dzImportSafe(ctx context.Context, user string, dry bool, it dzItem, st *dzRun) (r dzResult, err error) {
	defer func() {
		if p := recover(); p != nil {
			logger.Error("projects", "nhập dezon.vn: lỗi máy chủ ở", it.Link, jsval.Str(p))
			r, err = dzResult{}, fmt.Errorf("Lỗi máy chủ khi nhập: %s", jsval.Str(p))
		}
	}()
	return s.dzImportOne(ctx, user, dry, it, st)
}

// dzImportOne: 1 dự án - đọc trang chi tiết, tạo / điền ô trống, ảnh khi dự án chưa có ảnh. Dự án có sẵn: dòng du_an và
// anhDuAn đọc lại từ database ngay trước khi tính / ghi (người dùng có thể đã sửa trong lúc lượt nhập chạy).
func (s *Service) dzImportOne(ctx context.Context, user string, dry bool, it dzItem, st *dzRun) (dzResult, error) {
	var r dzResult
	key := normDezonURL(it.Link)
	if u, err := url.Parse(it.Link); key == "" || err != nil || !dzHostOK(u.Hostname()) {
		return r, errors.New("Link dự án không thuộc dezon.vn")
	}
	body, _, err := s.dz.get(ctx, it.Link, dzPageTimeout, dzPageMax)
	if err != nil {
		return r, fmt.Errorf("Không tải được trang dự án: %w", err)
	}
	page := string(body)
	d := parseDzDetail(page, s.dz.moreRooms(ctx, page))
	fields := dzFields(it, d)
	coAnh := it.Thumb != "" || len(d.Gallery) > 0
	st.mu.Lock()
	ma, prev, seen := st.idx[key], st.prev[key], st.seen[key]
	st.mu.Unlock()
	if ma == "" && seen { // đã có trong QS ở lượt trước, người dùng đã xoá / đổi link: không tạo lại
		r.status = "skipped"
		return r, nil
	}
	if ma == "" {
		r.status = "created"
		if dry {
			return r, nil
		}
		p, err := s.dzCreate(ctx, fields)
		if err != nil {
			return r, err
		}
		ma = jsval.S(p.Val("maDA"))
		st.mu.Lock()
		st.idx[key], st.seen[key] = ma, true
		st.mu.Unlock()
	} else {
		fresh, err := s.repo.FindProject(ctx, ma)
		if err != nil {
			return r, apperr.ColErr(err)
		}
		if len(fresh) == 0 { // dự án đã bị xoá trong lúc lượt nhập chạy
			r.status = "skipped"
			return r, nil
		}
		patch := dzFillPatch(fresh[0], fields)
		if prev { // đã nhập / đã có ở lượt trước: ô trống là người dùng xoá, không điền lại
			patch = omap.New()
		}
		anh, err := s.dzAnhHienTai(ctx, ma)
		if err != nil {
			return r, err
		}
		var mat []string // ảnh đã lưu trên máy chủ mà file bị mất (khôi phục bản sao lưu không có dezonvn/)
		var ngoai []int  // ô ảnh bìa / 6 ảnh đầu còn giữ link dezon.vn do lần trước tải về máy chủ hỏng
		if !dzAnhEmpty(anh) {
			mat = s.dz.missingLocal(anh, it.ID)
			ngoai = dzRetrySlots(anh, it.Thumb, d.Gallery)
		}
		// lượt trước: chỉ thêm ảnh khi chưa từng lưu anhDuAn (danh sách rỗng [] = người dùng đã xoá hết ảnh)
		coAnh = coAnh && dzAnhEmpty(anh) && (!prev || anh == nil)
		if patch.Len() == 0 && !coAnh && len(mat) == 0 && len(ngoai) == 0 {
			r.status = "skipped"
			return r, nil
		}
		r.status = "updated"
		if dry {
			return r, nil
		}
		if patch.Len() > 0 {
			if _, err := s.repo.UpdateProject(ctx, ma, patch.Clone().Set("cap_nhat", s.now())); err != nil {
				return r, apperr.ColErr(err)
			}
		}
		if len(mat) > 0 {
			r.images, r.imgFail = s.dz.repair(ctx, it, d.Gallery, mat)
		}
		if len(ngoai) > 0 {
			nOK, nFail, err := s.dzRetryExternal(ctx, user, it, d.Gallery, ma, ngoai)
			r.images, r.imgFail = r.images+nOK, r.imgFail+nFail
			if err != nil {
				return r, err
			}
		}
	}
	if !coAnh {
		return r, nil
	}
	list, nOK, nFail := s.dz.images(ctx, it, d.Gallery)
	r.images, r.imgFail = nOK, nFail
	if len(list) == 0 {
		return r, nil
	}
	// đọc lại ngay trước khi ghi: người dùng đã thêm ảnh trong lúc tải -> không đè
	if anh, err := s.dzAnhHienTai(ctx, ma); err != nil {
		return r, err
	} else if !dzAnhEmpty(anh) {
		return r, nil
	}
	if _, err := s.SetProjData(ctx, &actor.Actor{U: user}, ma, "anhDuAn", list); err != nil {
		return r, fmt.Errorf("Không lưu được ảnh dự án: %w", err)
	}
	return r, nil
}

// dzRetrySlots: vị trí k (ảnh bìa + 6 ảnh đầu) của anhDuAn còn giữ đúng link dezon.vn của ảnh mà lượt nhập trước phải để
// ngoài vì tải về máy chủ hỏng (cùng ảnh gốc với ảnh thứ k của danh sách lưu trên máy chủ). Ô người dùng đã thay không tính.
func dzRetrySlots(anh any, thumb string, gallery []dzImage) []int {
	locals, _ := dzLocals(thumb, gallery)
	arr := jsval.AsArray(anh)
	var out []int
	for k := 0; k < min(len(arr), len(locals)); k++ {
		if dzSlotExternal(arr[k], locals[k]) {
			out = append(out, k)
		}
	}
	return out
}

// dzSlotExternal: phần tử anhDuAn là link dezon.vn của chính ảnh im (bản gốc hoặc bản thu nhỏ).
func dzSlotExternal(x any, im dzImage) bool {
	u, ok := dzUploadURL(dzAnhURL(x))
	return ok && dzImageKey(u) == dzImageKey(im.URL)
}

// dzAnhSetURL: phần tử anhDuAn với URL mới, giữ các khoá khác (phong...).
func dzAnhSetURL(x any, u string) any {
	if m, ok := x.(*omap.Map); ok {
		return m.Clone().Set("url", u)
	}
	return u
}

// dzRetryExternal: tải lại về máy chủ các ô slots; thành công thì đọc lại anhDuAn ngay trước khi ghi và chỉ thay các ô vẫn
// còn giữ link dezon.vn đó (người dùng đã sửa ô nào thì giữ ô đó).
func (s *Service) dzRetryExternal(ctx context.Context, user string, it dzItem, gallery []dzImage, ma string, slots []int) (nOK, nFail int, err error) {
	locals, _ := dzLocals(it.Thumb, gallery)
	repl := map[int]string{}
	for _, k := range slots {
		u, err := s.dz.localImage(ctx, it.ID, locals[k].URL, dzCandidates(locals[k].URL))
		if err != nil {
			nFail++
			logger.Error("projects", "nhập dezon.vn: tải lại ảnh", locals[k].URL, "lỗi:", err.Error())
			continue
		}
		nOK++
		repl[k] = u
	}
	if len(repl) == 0 {
		return nOK, nFail, nil
	}
	cur, err := s.dzAnhHienTai(ctx, ma)
	if err != nil {
		return nOK, nFail, err
	}
	arr := append([]any(nil), jsval.AsArray(cur)...)
	doi := false
	for k, u := range repl {
		if k < len(arr) && dzSlotExternal(arr[k], locals[k]) {
			arr[k], doi = dzAnhSetURL(arr[k], u), true
		}
	}
	if !doi {
		return nOK, nFail, nil
	}
	if _, err := s.SetProjData(ctx, &actor.Actor{U: user}, ma, "anhDuAn", arr); err != nil {
		return nOK, nFail, fmt.Errorf("Không lưu được ảnh dự án: %w", err)
	}
	return nOK, nFail, nil
}

// dzCreate: tạo dự án; mã DA-... trùng (nhiều dự án tạo cùng giây) -> sinh mã khác, thử lại.
func (s *Service) dzCreate(ctx context.Context, fields *omap.Map) (*omap.Map, error) {
	for i := 0; ; i++ {
		p, err := s.CreateProject(ctx, fields)
		if err == nil {
			return p, nil
		}
		if i >= 3 || !strings.Contains(err.Error(), "23505") {
			return nil, err
		}
	}
}

// dzAnhHienTai: giá trị anhDuAn đang lưu của dự án (thiếu -> nil).
func (s *Service) dzAnhHienTai(ctx context.Context, ma string) (any, error) {
	rows, err := s.repo.ListProjDataKV(ctx, ma)
	if err != nil {
		if daDataThieuBang(err) || daDataCamQuyen(err) {
			return nil, nil
		}
		return nil, err
	}
	for _, r := range rows {
		if jsval.StrictEquals(r.Val("khoa"), "anhDuAn") {
			return r.Val("gia_tri"), nil
		}
	}
	return nil, nil
}

// dzSplitCover: ảnh bìa = project_thumb (ảnh cùng gốc trong thư viện thì lấy bản của thư viện, kèm phòng), không có thì
// ảnh đầu của thư viện; phần còn lại = thư viện đã bỏ ảnh trùng ảnh bìa.
func dzSplitCover(thumb string, gallery []dzImage) (dzImage, []dzImage) {
	if t, ok := dzUploadURL(thumb); ok { // mã hoá %XX như URL của thư viện (REST trả project_thumb chưa mã hoá)
		thumb = t
	} else {
		thumb = "" // không phải ảnh trong uploads của dezon.vn: không lưu link lạ, lấy ảnh đầu của thư viện
	}
	if thumb == "" {
		if len(gallery) == 0 {
			return dzImage{}, nil
		}
		return gallery[0], gallery[1:]
	}
	k := dzImageKey(thumb)
	cover := dzImage{URL: thumb}
	rest := make([]dzImage, 0, len(gallery))
	found := false
	for _, g := range gallery {
		if dzImageKey(g.URL) == k {
			if !found {
				cover, found = g, true
			}
			continue
		}
		rest = append(rest, g)
	}
	return cover, rest
}

// dzAnhItem: phần tử anhDuAn - chuỗi URL, hoặc {url, phong} khi biết phòng (như ProjectImages.jsx).
func dzAnhItem(u, phong string) any {
	if phong = strings.TrimSpace(phong); phong != "" {
		return omap.Of("url", u, "phong", phong)
	}
	return u
}

// dzCandidates: URL thử tải theo thứ tự - bản thu nhỏ -WxH thì thử ảnh gốc trước.
func dzCandidates(u string) []string {
	if dzIsVariant(u) {
		return []string{dzOriginal(u), u}
	}
	return []string{u}
}

// dzLocals: ảnh lưu trên máy chủ (0 = ảnh bìa, 1..6) và ảnh giữ link dezon.vn.
func dzLocals(thumb string, gallery []dzImage) (locals, external []dzImage) {
	cover, rest := dzSplitCover(thumb, gallery)
	if cover.URL == "" {
		return nil, nil
	}
	n := min(dzLocalImgs, len(rest))
	return append([]dzImage{cover}, rest[:n]...), rest[n:]
}

// reDzFile: tên file ảnh nhập lưu trên máy chủ (dzFileName).
var reDzFile = regexp.MustCompile(`^[0-9a-f]{16}\.jpg$`)

// dzFileName: tên file theo ảnh gốc (16 hex đầu của sha1(dzImageKey)), không theo vị trí: ảnh trên dezon.vn đổi / đổi thứ tự
// thì thành file khác, không dùng nhầm file cũ. Bản thu nhỏ -WxH / -scaled cùng ảnh gốc -> cùng file.
func dzFileName(src string) string {
	h := sha1.Sum([]byte(dzImageKey(src)))
	return hex.EncodeToString(h[:8]) + ".jpg"
}

// dzPath: đường dẫn trong kho của ảnh src của bài wpID: dezonvn/<wpID>/<16 hex>.jpg.
func dzPath(wpID int64, src string) string {
	return dzDir + "/" + strconv.FormatInt(wpID, 10) + "/" + dzFileName(src)
}

// missingLocal: tên các file dezonvn/<wpID>/<16 hex>.jpg mà anhDuAn đang dùng nhưng không còn trong kho.
func (d *dezonImporter) missingLocal(anh any, wpID int64) []string {
	if d.files == nil {
		return nil
	}
	dir := dzDir + "/" + strconv.FormatInt(wpID, 10)
	pre := d.files.PublicURL(dir) + "/"
	var out []string
	for _, x := range jsval.AsArray(anh) {
		name, ok := strings.CutPrefix(dzAnhURL(x), pre)
		if !ok || !reDzFile.MatchString(name) || slices.Contains(out, name) {
			continue
		}
		if f, _, err := d.files.Open(dir + "/" + name); err == nil {
			f.Close()
			continue
		}
		out = append(out, name)
	}
	return out
}

// repair: tải lại các file bị mất (tìm ảnh nguồn theo tên file trong ảnh bìa + thư viện hiện tại; anhDuAn giữ nguyên).
func (d *dezonImporter) repair(ctx context.Context, it dzItem, gallery []dzImage, names []string) (nOK, nFail int) {
	cover, rest := dzSplitCover(it.Thumb, gallery)
	src := map[string]string{}
	for _, im := range append([]dzImage{cover}, rest...) {
		if n := dzFileName(im.URL); im.URL != "" && src[n] == "" {
			src[n] = im.URL
		}
	}
	for _, name := range names {
		u := src[name]
		if u == "" { // ảnh không còn trên dezon.vn
			nFail++
			continue
		}
		if _, err := d.localImage(ctx, it.ID, u, dzCandidates(u)); err != nil {
			nFail++
			logger.Error("projects", "nhập dezon.vn: tải lại ảnh", u, "lỗi:", err.Error())
			continue
		}
		nOK++
	}
	return nOK, nFail
}

// images dựng anhDuAn: [ảnh bìa, 6 ảnh đầu] lưu trên máy chủ (lỗi thì giữ link dezon.vn), ảnh còn lại giữ link dezon.vn.
func (d *dezonImporter) images(ctx context.Context, it dzItem, gallery []dzImage) (list []any, nOK, nFail int) {
	locals, external := dzLocals(it.Thumb, gallery)
	for _, im := range locals {
		u, err := d.localImage(ctx, it.ID, im.URL, dzCandidates(im.URL))
		if err != nil {
			nFail++
			logger.Error("projects", "nhập dezon.vn: ảnh", im.URL, "lỗi:", err.Error())
			u = im.URL
		} else {
			nOK++
		}
		list = append(list, dzAnhItem(u, im.Phong))
	}
	for _, im := range external {
		list = append(list, dzAnhItem(im.URL, im.Phong))
	}
	return list, nOK, nFail
}

// localImage: ảnh src của bài wpID trong kho (dzPath). Đã có file của đúng ảnh này -> dùng luôn, không tải lại.
func (d *dezonImporter) localImage(ctx context.Context, wpID int64, src string, cands []string) (string, error) {
	if d.files == nil {
		return "", errors.New("máy chủ chưa có kho file")
	}
	p := dzPath(wpID, src)
	if f, st, err := d.files.Open(p); err == nil {
		f.Close()
		if st.Size() > 0 {
			return d.files.PublicURL(p), nil
		}
	}
	var lastErr error
	for _, u := range cands {
		buf, _, err := d.get(ctx, u, dzImgTimeout, dzImgMax)
		if err != nil {
			lastErr = err
			continue
		}
		jpg, err := dzShrinkJPEG(buf)
		if err != nil {
			lastErr = err
			continue
		}
		return d.files.Upload(ctx, jpg, p, "image/jpeg")
	}
	return "", lastErr
}

// dzListURL: 1 trang danh sách REST (thứ tự id tăng dần: bài mới đăng trong lúc nhập không làm xô trang).
func dzListURL(page int) string {
	return dzBase + "/wp-json/wp/v2/project?per_page=" + strconv.Itoa(dzPerPage) + "&page=" + strconv.Itoa(page) +
		"&orderby=id&order=asc&_fields=id,link,title,content,project_thumb,class_list"
}

// fetchList: mọi trang danh sách (trang 1 cho biết số trang, các trang sau tải song song). Trang lỗi ghi vào errors, bỏ qua.
func (d *dezonImporter) fetchList(ctx context.Context, j *dzJob) []dzItem {
	b, h, err := d.get(ctx, dzListURL(1), dzListTimeout, dzListMax)
	var first []dzItem
	if err == nil {
		first, err = parseDzList(b)
	}
	if err != nil {
		j.addErr("", dzListURL(1), "Không đọc được danh sách dự án dezon.vn: "+err.Error())
		return nil
	}
	pages, _ := strconv.Atoi(strings.TrimSpace(h.Get("X-WP-TotalPages")))
	pages = max(pages, 1)
	if j.limit > 0 {
		pages = min(pages, (j.limit+dzPerPage-1)/dzPerPage)
	}
	all := make([][]dzItem, pages)
	all[0] = first
	ch := make(chan int)
	var wg sync.WaitGroup
	for range dzWorkers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range ch {
				b, _, err := dzGetSafe(func() ([]byte, http.Header, error) { return d.get(ctx, dzListURL(p), dzListTimeout, dzListMax) })
				var items []dzItem
				if err == nil {
					items, err = parseDzList(b)
				}
				if err != nil {
					j.addErr("", dzListURL(p), "Không đọc được trang danh sách "+strconv.Itoa(p)+": "+err.Error())
					continue
				}
				all[p-1] = items
			}
		}()
	}
	for p := 2; p <= pages; p++ {
		ch <- p
	}
	close(ch)
	wg.Wait()
	seen := map[int64]bool{}
	var out []dzItem
	for _, items := range all {
		for _, it := range items {
			if it.ID == 0 || seen[it.ID] {
				continue
			}
			seen[it.ID] = true
			out = append(out, it)
		}
	}
	if j.limit > 0 && len(out) > j.limit {
		out = out[:j.limit]
	}
	return out
}

// pace: giữ khoảng cách d.delay giữa các lần bắt đầu tải (không dồn tải lên dezon.vn).
func (d *dezonImporter) pace(ctx context.Context) error {
	d.pmu.Lock()
	next := d.last.Add(d.delay)
	if now := time.Now(); next.Before(now) {
		next = now
	}
	d.last = next
	d.pmu.Unlock()
	return dzSleep(ctx, time.Until(next))
}

func dzSleep(ctx context.Context, w time.Duration) error {
	if w <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(w)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// dzAjaxURL: admin-ajax của WordPress (nút "Xem thêm" phòng của trang dự án: action load_more_rooms).
const dzAjaxURL = dzBase + "/wp-admin/admin-ajax.php"

// dzMoreRounds: số lần bấm "Xem thêm" tối đa / dự án.
const dzMoreRounds = 10

var (
	reDzMoreBtn    = regexp.MustCompile(`(?is)<a\b[^>]*\bid="btn-ajax-load-more"[^>]*>`)
	reDzMorePost   = regexp.MustCompile(`(?i)\bdata-post-id="(\d{1,19})"`)
	reDzMoreOffset = regexp.MustCompile(`(?i)\bdata-offset="(\d{1,6})"`)
)

// moreRooms: HTML các phòng mục Hình ảnh mà trang chỉ hiện sau khi bấm "Xem thêm" (#btn-ajax-load-more data-post-id /
// data-offset): POST admin-ajax action=load_more_rooms&post_id&offset -> {success, data: {html, remaining}}, mỗi lần offset
// +3 như JS của theme, tới khi remaining <= 0 (tối đa dzMoreRounds lần, tổng tối đa dzPageMax byte). Lỗi -> dừng, giữ phần đã có.
func (d *dezonImporter) moreRooms(ctx context.Context, page string) string {
	btn := reDzMoreBtn.FindString(page)
	pm, om := reDzMorePost.FindStringSubmatch(btn), reDzMoreOffset.FindStringSubmatch(btn)
	if pm == nil || om == nil {
		return ""
	}
	off, _ := strconv.Atoi(om[1])
	var out strings.Builder
	for range dzMoreRounds {
		form := url.Values{"action": {"load_more_rooms"}, "post_id": {pm[1]}, "offset": {strconv.Itoa(off)}}.Encode()
		b, _, err := d.post(ctx, dzAjaxURL, form, dzPageTimeout, dzPageMax)
		var res struct {
			Success bool `json:"success"`
			Data    struct {
				HTML      string  `json:"html"`
				Remaining float64 `json:"remaining"`
			} `json:"data"`
		}
		if err == nil {
			err = json.Unmarshal(b, &res)
		}
		if err != nil {
			logger.Error("projects", "nhập dezon.vn: tải thêm phòng của bài", pm[1], "lỗi:", err.Error())
			break
		}
		if !res.Success || strings.TrimSpace(res.Data.HTML) == "" || out.Len()+len(res.Data.HTML) > dzPageMax {
			break
		}
		out.WriteString(res.Data.HTML)
		if res.Data.Remaining <= 0 {
			break
		}
		off += 3
	}
	return out.String()
}

// get: GET 1 địa chỉ của dezon.vn (host khác -> lỗi), tối đa max byte, thử lại 2 lần khi lỗi mạng / quá giờ / HTTP 5xx / 429.
func (d *dezonImporter) get(ctx context.Context, raw string, timeout time.Duration, max int64) ([]byte, http.Header, error) {
	return d.do(ctx, http.MethodGet, raw, "", timeout, max)
}

// post: như get, POST thân form application/x-www-form-urlencoded.
func (d *dezonImporter) post(ctx context.Context, raw, form string, timeout time.Duration, max int64) ([]byte, http.Header, error) {
	return d.do(ctx, http.MethodPost, raw, form, timeout, max)
}

func (d *dezonImporter) do(ctx context.Context, method, raw, form string, timeout time.Duration, max int64) ([]byte, http.Header, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || !dzHostOK(u.Hostname()) {
		return nil, nil, errDzHost
	}
	var lastErr error
	for attempt := 0; attempt <= dzRetries; attempt++ {
		if attempt > 0 {
			if err := dzSleep(ctx, d.retryWait*time.Duration(attempt)); err != nil {
				return nil, nil, err
			}
		}
		if err := d.pace(ctx); err != nil {
			return nil, nil, err
		}
		b, h, err, retry := d.once(ctx, method, u.String(), form, timeout, max)
		if err == nil {
			return b, h, nil
		}
		lastErr = err
		if !retry || ctx.Err() != nil {
			break
		}
	}
	return nil, nil, lastErr
}

func (d *dezonImporter) once(ctx context.Context, method, raw, form string, timeout time.Duration, max int64) ([]byte, http.Header, error, bool) {
	tctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var body io.Reader
	if method == http.MethodPost {
		body = strings.NewReader(form)
	}
	req, err := http.NewRequestWithContext(tctx, method, raw, body)
	if err != nil {
		return nil, nil, err, false
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("User-Agent", dzUA)
	req.Header.Set("Accept", "*/*")
	res, err := d.client.Do(req)
	if err != nil {
		return nil, nil, err, !errors.Is(err, errDzHost)
	}
	defer res.Body.Close()
	if res.StatusCode >= 500 || res.StatusCode == http.StatusTooManyRequests {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
		return nil, nil, fmt.Errorf("HTTP %d", res.StatusCode), true
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, nil, fmt.Errorf("HTTP %d", res.StatusCode), false
	}
	if res.ContentLength > max {
		return nil, nil, errors.New("dữ liệu quá lớn"), false
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, nil, err, true
	}
	if int64(len(b)) > max {
		return nil, nil, errors.New("dữ liệu quá lớn"), false
	}
	return b, res.Header, nil, false
}
