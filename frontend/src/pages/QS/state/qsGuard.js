/* Ghi dữ liệu QS có kiểm quyền N21 (state/qsAccess.js) trước khi gọi store: bị chặn thì không vẽ lạc quan, không gọi máy chủ.
   - Dòng bóc tách: thêm = create, sửa / đổi chỗ = edit, xoá = delete, theo tab đang mở (lineTab: tab không có thao tác đó -> Bóc tách).
     Bị chặn: báo 1 dòng, trả giá trị "không làm gì" như store (null / 0 / []).
   - Dự án / bản nháp: tạo / nhân bản / xoá theo tab Dự án; sửa thông tin (VAT, tầng, hạng mục tự tạo, tiến độ...) theo tab đang mở
     như dòng, tab không có Sửa -> Dự án. Bị chặn thì ném lỗi tiếng Việt (nơi gọi đã bắt lỗi và báo như lỗi máy chủ). */
import * as S from './store'
import { denyQs, lineTab, qsCan } from './qsAccess'

const lineDeny = action => denyQs(lineTab(action), action)

export const addLine = (prod, soLuong, temp) => (lineDeny('create') ? Promise.resolve(null) : S.addLine(prod, soLuong, temp))
export const addBlankLine = opts => (lineDeny('create') ? Promise.resolve(null) : S.addBlankLine(opts))
export const updateLine = (id, fields) => (lineDeny('edit') ? Promise.resolve(null) : S.updateLine(id, fields))
export const deleteLines = (ids, opts) => (lineDeny('delete') ? Promise.resolve(0) : S.deleteLines(ids, opts))
export const moveLine = (dragId, floor, targetId, before) => (lineDeny('edit') ? Promise.resolve([]) : S.moveLine(dragId, floor, targetId, before))
export const reorderLines = arr => (lineDeny('edit') ? Promise.resolve([]) : S.reorderLines(arr))
/* Hoàn tác / làm lại thêm-xoá dòng: cần cả quyền thêm và xoá */
export function histRunAddDel(e, dir) {
  if (lineDeny('create') || lineDeny('delete')) return Promise.resolve(e)
  return S.histRunAddDel(e, dir)
}

const ACT_VN = { create: 'Thêm', edit: 'Sửa', delete: 'Xoá' }
const TAB_VN = { duan: 'Dự án', boc: 'Bóc tách', chiphi: 'Chi phí', export: 'Xuất báo giá', muahang: 'Mua hàng' }
function projGate(action) {
  const t = action === 'edit' ? lineTab('edit', 'duan') : 'duan'
  if (qsCan(t, action)) return null
  return Promise.reject(new Error('Bạn chưa được cấp quyền ' + ACT_VN[action] + ' ở QS > ' + (TAB_VN[t] || t)))
}
export const createProject = d => projGate('create') || S.createProject(d)
export const updateProject = (maDA, fields) => projGate('edit') || S.updateProject(maDA, fields)
export const deleteProject = maDA => projGate('delete') || S.deleteProject(maDA)
export const duplicateProject = (maDA, opts) => projGate('create') || S.duplicateProject(maDA, opts)
