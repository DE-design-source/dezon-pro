package sales

import (
	"context"
	"strings"

	"qspro-backend/internal/platform/logger"
	"qspro-backend/internal/shared/contracts"
	"qspro-backend/internal/shared/jsval"
	"qspro-backend/internal/shared/omap"
	"qspro-backend/internal/shared/tenant"
)

var _ contracts.UserRenameListener = (*Service)(nil)

// renamer: quy tắc đổi tên người đã lưu dạng chữ khi tài khoản username đổi họ tên oldName -> newName.
//   - mục có username: chỉ mục của đúng tài khoản đó đổi name (mục của tài khoản khác giữ nguyên dù trùng tên);
//   - mục / chuỗi chỉ có tên: tên (trim, không phân biệt hoa thường) = tên cũ -> tên mới, mục object gắn thêm username
//     để lần sau khớp theo tài khoản. byName = false (tên cũ rỗng hoặc trùng tài khoản khác trong công ty) -> không đổi.
type renamer struct {
	username, oldName, newName string
	byName                     bool
}

func (r renamer) nameHit(s string) bool {
	return r.byName && strings.EqualFold(jsval.Trim(s), r.oldName)
}

// text: cột chữ (quan_ly, nguoi_tao_ten).
func (r renamer) text(v any) (any, bool) {
	s, ok := v.(string)
	if !ok || !r.nameHit(s) || s == r.newName {
		return v, false
	}
	return r.newName, true
}

// list: mảng người [{name, username?, role?, dept?, since?}] hoặc [tên]; giữ thứ tự và các khoá khác, chỉ thay phần tử đổi.
func (r renamer) list(v any) ([]any, bool) {
	arr, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out, changed := make([]any, len(arr)), false
	for i, x := range arr {
		out[i] = x
		switch m := x.(type) {
		case string:
			if r.nameHit(m) && m != r.newName {
				out[i], changed = r.newName, true
			}
		case *omap.Map:
			name, _ := m.Val("name").(string)
			if u := str(m, "username"); u != "" {
				if u == r.username && name != r.newName {
					out[i], changed = m.Clone().Set("name", r.newName), true
				}
			} else if r.nameHit(name) {
				n := m.Clone().Set("name", r.newName)
				if r.username != "" {
					n.Set("username", r.username)
				}
				out[i], changed = n, true
			}
		}
	}
	return out, changed
}

// renameKind: 1 bảng chứa tên người - đọc (ids rỗng = mọi dòng, có ids = khoá các dòng đó), tính patch, ghi.
type renameKind struct {
	read  func(ctx context.Context, ids []float64) ([]*omap.Map, error)
	patch func(row *omap.Map) *omap.Map
	write func(ctx context.Context, id float64, patch *omap.Map) (*omap.Map, error)
}

// UserRenamed (contracts.UserRenameListener, gọi từ users sau khi đổi họ tên): trong ĐÚNG công ty companyID đổi tên người
// phụ trách khách (phu_trach), quản lý (quan_ly), người khởi tạo (nguoi_tao_ten), người làm task (kd_nhiem_vu_kh.phu_trach),
// người tham gia lịch hẹn (kd_lich_hen.thanh_vien) theo quy tắc của renamer. Chỉ ghi dòng thật sự đổi, trong 1 transaction.
// Tài khoản chưa có họ tên thì tên cũ đang hiện = username.
func (s *Service) UserRenamed(ctx context.Context, companyID any, username, oldName, newName string) error {
	username, oldName, newName = jsval.Trim(username), jsval.Trim(oldName), jsval.Trim(newName)
	if !jsval.Truthy(companyID) || newName == "" || (username == "" && oldName == "") {
		return nil
	}
	if oldName == "" {
		oldName = username
	}
	if oldName == newName {
		return nil
	}
	// ngữ cảnh của công ty tài khoản (không phải của người sửa): mọi bảng ở đây thuộc TenantTables nên chỉ đọc / ghi công ty đó
	ctx = tenant.With(ctx, tenant.Ctx{UID: tenant.UID(ctx), Role: "super", CongTyID: companyID, ViewAs: companyID})
	r := renamer{username: username, oldName: oldName, newName: newName, byName: true}
	accs, err := s.repo.Accounts(ctx)
	if err != nil {
		return err
	}
	for _, acc := range accs {
		u := jsval.Trim(jsval.Str(acc.Val("username")))
		if u == username {
			continue
		}
		if strings.EqualFold(jsval.Trim(jsval.StrOr(acc.Val("ho_ten"), "")), oldName) || strings.EqualFold(u, oldName) {
			r.byName = false
			logger.Info("sales", "đổi tên", username, ": tên cũ", oldName, "trùng tài khoản", u, "- chỉ đổi mục có tên đăng nhập")
			break
		}
	}
	leadPatch := func(l *omap.Map) *omap.Map {
		p := omap.New()
		if v, ok := r.list(l.Val("phu_trach")); ok {
			p.Set("phu_trach", v)
		}
		for _, k := range []string{"quan_ly", "nguoi_tao_ten"} {
			if v, ok := r.text(l.Val(k)); ok {
				p.Set(k, v)
			}
		}
		return p
	}
	listPatch := func(col string) func(*omap.Map) *omap.Map {
		return func(m *omap.Map) *omap.Map {
			p := omap.New()
			if v, ok := r.list(m.Val(col)); ok {
				p.Set(col, v)
			}
			return p
		}
	}
	kinds := []renameKind{
		{s.repo.LeadPeople, leadPatch, s.repo.UpdateLead},
		{s.repo.TaskPeople, listPatch("phu_trach"), s.repo.UpdateTask},
		{s.repo.AppointmentPeople, listPatch("thanh_vien"), s.repo.UpdateAppointment},
	}
	// lượt 1 (không khoá): tìm dòng cần đổi. Lượt 2 (1 transaction): khoá đúng các dòng đó, đọc lại giá trị mới nhất,
	// tính lại rồi ghi -> người khác lưu cùng lúc không bị ghi đè bằng bản cũ; dòng không liên quan không bị khoá.
	cand := make([][]float64, len(kinds))
	found := false
	for i, k := range kinds {
		rows, err := k.read(ctx, nil)
		if err != nil {
			return err
		}
		for _, row := range rows {
			if k.patch(row).Len() > 0 {
				cand[i] = append(cand[i], jsval.ToNumber(row.Val("id")))
			}
		}
		found = found || len(cand[i]) > 0
	}
	if !found {
		return nil
	}
	n := make([]int, len(kinds))
	err = s.tx(ctx, func(ctx context.Context) error {
		for i, k := range kinds {
			if len(cand[i]) == 0 {
				continue
			}
			rows, err := k.read(ctx, cand[i])
			if err != nil {
				return err
			}
			for _, row := range rows {
				p := k.patch(row)
				if p.Len() == 0 {
					continue
				}
				if _, err := k.write(ctx, jsval.ToNumber(row.Val("id")), p); err != nil {
					return err
				}
				n[i]++
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	nLead, nTask, nAppt := n[0], n[1], n[2]
	if nLead+nTask+nAppt > 0 {
		logger.Info("sales", "đổi tên", username, oldName, "->", newName, ": khách", nLead, "task", nTask, "lịch hẹn", nAppt)
	}
	return nil
}
