/* Cache công tác (phần thô) dùng chung cho Phần thô, Danh sách SP (chế độ phần thô) và Nhập dữ liệu.
   Port ctLoad_ / ctReload_ / ctFav_ / ctDuyet_ / ctDelete_ (PUB/phantho.js:644-720) và batKq_ (sanpham.js:367-372).
   Các action chỉ làm phần DỮ LIỆU (gọi API, kiểm kết quả, nạp lại cache) và ném Error khi lỗi;
   toast / hỏi xác nhận do nơi gọi làm (chữ khác nhau tuỳ màn hình, như bản gốc).
   useCongTac() -> {congTac, status, error, ctLoad(quiet, fresh), ctReload(), ctFav(ids,on), ctDuyet(ids,on), ctDelete(ids), ctSave(data), ctUpdate(id,patch), ctHistory(id)} */
import * as api from '../api/qsApi'
import { getState, setState, useQsStore, ctLoad } from './store'
import { qsCan } from './qsAccess'

/* Phân quyền N21: thư viện công tác thuộc QS > Danh sách sản phẩm (thêm từ Nhập dữ liệu theo QS > Nhập dữ liệu > Thêm);
   duyệt công tác giữ quy tắc cũ. Bị chặn -> ném lỗi tiếng Việt (nơi gọi đã báo lỗi) */
const VN = { create: 'Thêm', edit: 'Sửa', delete: 'Xoá' }
function ctGate(action) {
  const tab = action === 'create' && getState().tab === 'import' ? 'import' : 'sanpham'
  if (!qsCan(tab, action)) throw new Error('Bạn chưa được cấp quyền ' + VN[action] + ' ở QS > ' + (tab === 'import' ? 'Nhập dữ liệu' : 'Danh sách sản phẩm'))
}

/* server trả {ok, errors} chứ không ném lỗi -> tự kiểm (batKq_) */
export function batKq_(r, n, viec) {
  if (r && r.errors && r.errors.length) throw new Error(String(r.errors[0].error || ('Không ' + viec + ' được')))
  const ok = Number(r && r.ok) || 0
  const daDung = Number(r && r.daDung) || 0
  if (n > 0 && !ok && !daDung) throw new Error('Máy chủ không ' + viec + ' được dòng nào')
  return ok
}
const arr = ids => (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
const ctReload = () => ctLoad(true, true)

/* Yêu thích: đổi trước cho nhanh tay, lỗi thì trả lại */
async function ctFav(ids, on) {
  ids = arr(ids)
  const set = {}; ids.forEach(id => { set[id] = 1 })
  const flip = v => setState(s => ({ congTac: s.congTac.map(c => (set[c.id] ? { ...c, yeuThich: v } : c)) }))
  flip(!!on)
  try {
    const n = batKq_(await api.ctFav(ids, !!on), ids.length, 'đánh dấu yêu thích')
    if (ids.length > 1) await ctReload()
    return n
  } catch (e) { flip(!on); throw e }
}
async function ctDuyet(ids, on) {
  ids = arr(ids)
  const n = batKq_(await api.ctDuyet(ids, !!on), ids.length, 'đổi trạng thái duyệt')
  await ctReload()
  return n
}
async function ctDelete(ids) {
  ctGate('delete')
  ids = arr(ids)
  const n = batKq_(await api.ctDelete(ids), ids.length, 'xoá')
  await ctReload()
  return n
}
/* Lưu mới 1 hoặc nhiều công tác: trả {ok, rows} của server */
async function ctSave(data) {
  ctGate('create')
  const r = await api.ctSave(data)
  await ctReload()
  return r
}
/* Sửa 1 công tác: thay bản trong cache bằng bản server trả (duyệt luôn bị reset phía server) */
async function ctUpdate(id, patch) {
  ctGate('edit')
  const out = await api.ctUpdate(id, patch)
  if (out) setState(s => ({ congTac: s.congTac.map(c => (c.id === id ? { ...c, ...out } : c)) }))
  return out
}
const ctHistory = id => api.ctHistory(id)

export const congTacActions = { ctLoad, ctReload, ctFav, ctDuyet, ctDelete, ctSave, ctUpdate, ctHistory }

export function useCongTac() {
  const congTac = useQsStore(s => s.congTac)
  const status = useQsStore(s => s.ctStatus)
  const error = useQsStore(s => s.ctError)
  return { congTac, status, error, ...congTacActions }
}

export const congTacNow = () => getState().congTac
