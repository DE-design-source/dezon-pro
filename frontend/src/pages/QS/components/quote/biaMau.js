/* Mẫu tờ bìa báo giá: chọn nhanh bằng số ①②③… (thẻ Trang bìa), ⊕ = lưu cài đặt đang dùng thành mẫu mới.
   Mẫu = bố cục tờ bìa (Mẫu 1 / Mẫu 2) + cài đặt Khung tiêu đề / Thông tin dự án trên bìa (các khoá BIA_KEYS của bgCfg).
   2 mẫu dựng sẵn (1 = Mẫu 1, 2 = Mẫu 2, cài đặt mặc định) + mẫu tự lưu theo tài khoản: users.ui_prefs.bgBiaMau
   = [{id, ten, mau, cfg}], dự phòng localStorage qs_biamau_<user>. Mẫu đang dùng ghi ở bgCfg.biaMau (id). */
import { getState, setState } from '../../state/store'
import * as api from '../../api/qsApi'
import { qsToast as toast, qsAsk, qsConfirm } from '../common/dialogs'
import { setCoverMau } from './quoteState'
import { bgOptSetMany } from './quoteActions'
import { khungKeys_ } from './docCss'

export const BIA_KEYS = ['tdTen', 'tdHm', 'tdHmTen', 'tdMa', 'tdMaBG', 'tdPB', 'tdNgay', 'tdSo', 'tdCo1', 'tdCo2', 'tdCo3', 'tdFont1', 'tdFont2', 'hienTT', 'anTT', 'ttThem', 'ttSo', 'ttFont', 'ttkCo', 'ttkFont', 'ttkMau', 'ttvCo', 'ttvFont', 'ttvMau', ...khungKeys_('tk'), ...khungKeys_('tdk')]
export const BIA_MAX = 8   // tổng số mẫu (2 dựng sẵn + tối đa 6 mẫu tự lưu)
const BIA_SAN = [{ id: 's1', ten: 'Mẫu 1', mau: 'm1', cfg: {}, san: true }, { id: 's2', ten: 'Mẫu 2', mau: 'm2', cfg: {}, san: true }]

const userOf = me => String((me && me.username) || '').toLowerCase()
const lsKey = me => 'qs_biamau_' + userOf(me)
function myMau(me = getState().me) {
  let v = me && me.uiPrefs && me.uiPrefs.bgBiaMau
  if (!Array.isArray(v)) { try { v = JSON.parse(localStorage.getItem(lsKey(me)) || 'null') } catch (e) { v = null } }
  return Array.isArray(v) ? v.filter(x => x && x.id && x.ten && x.cfg && typeof x.cfg === 'object') : []
}
/* Danh sách mẫu theo thứ tự số: dựng sẵn trước, mẫu tự lưu sau */
export function biaMauDs() { return [...BIA_SAN, ...myMau().map(x => ({ ...x, mau: x.mau === 'm1' ? 'm1' : 'm2', san: false }))] }

/* Ảnh chụp cài đặt tờ bìa đang dùng (chỉ khoá có giá trị) */
export function biaChup(bgCfg, coverMau) {
  const c = bgCfg || {}; const cfg = {}
  BIA_KEYS.forEach(k => { if (c[k] != null) cfg[k] = c[k] })
  return { mau: coverMau === 'm1' ? 'm1' : 'm2', cfg }
}
const ky = t => JSON.stringify([t.mau, BIA_KEYS.map(k => (t.cfg[k] === undefined ? null : t.cfg[k]))])
/* Cài đặt đang dùng có khớp mẫu t không (khớp = không có thay đổi chưa lưu) */
export function biaKhop(t, bgCfg, coverMau) { return !!t && ky(t) === ky(biaChup(bgCfg, coverMau)) }
/* Mẫu đang chọn: theo bgCfg.biaMau, chưa chọn thì mẫu dựng sẵn ứng với bố cục đang dùng */
export function biaDangChon(bgCfg, coverMau) {
  const ds = biaMauDs(); const id = (bgCfg || {}).biaMau
  return ds.find(x => x.id === id) || ds.find(x => x.san && x.mau === (coverMau === 'm1' ? 'm1' : 'm2'))
}

export function biaApDung(t) {
  const m = { biaMau: t.id }
  BIA_KEYS.forEach(k => { m[k] = t.cfg[k] === undefined ? null : t.cfg[k] })
  bgOptSetMany(m)
  setCoverMau(t.mau)
}

async function ghi(list) {
  const me = getState().me
  try { localStorage.setItem(lsKey(me), JSON.stringify(list)) } catch (e) { /* bỏ qua */ }
  try {
    const r = await api.setMyPref('bgBiaMau', list.length ? list : null)
    const cur = getState().me
    if (cur) setState({ me: { ...cur, uiPrefs: (r && r.uiPrefs) || { ...(cur.uiPrefs || {}), bgBiaMau: list } } })
    return true
  } catch (e) { toast('Đã lưu mẫu trên máy này. Lưu theo tài khoản lỗi: ' + e.message); return false }
}

/* ⊕ / "Lưu thành mẫu mới": hỏi tên, lưu cài đặt đang dùng thành mẫu mới rồi chọn mẫu đó */
export async function biaLuuMoi(bgCfg, coverMau) {
  const list = myMau()
  if (BIA_SAN.length + list.length >= BIA_MAX) { toast('Tối đa ' + BIA_MAX + ' mẫu tờ bìa — xoá bớt mẫu tự lưu'); return null }
  const so = BIA_SAN.length + list.length + 1
  const ten = await qsAsk({ title: 'Lưu thành mẫu tờ bìa mới', label: 'Tên mẫu (hiện khi rê chuột vào số ' + so + ')', value: 'Mẫu ' + so, confirmText: 'Lưu' })
  if (!ten) return null
  const t = { id: 'u' + Date.now().toString(36), ten: String(ten).trim().slice(0, 39) || 'Mẫu ' + so, ...biaChup(bgCfg, coverMau) }
  await ghi([...list, t])
  bgOptSetMany({ biaMau: t.id })
  toast('Đã lưu mẫu tờ bìa số ' + so + ' "' + t.ten + '"')
  return t
}
/* "Lưu": ghi đè mẫu tự lưu đang chọn bằng cài đặt đang dùng; mẫu dựng sẵn / chưa đổi gì thì chỉ báo (ghi chú hiện khi bấm) */
export async function biaLuuDe(t, bgCfg, coverMau) {
  if (!t) return
  if (t.san) { toast('"' + t.ten + '" là mẫu dựng sẵn, không ghi đè được — bấm "Lưu thành mẫu mới"'); return }
  if (biaKhop(t, bgCfg, coverMau)) { toast('Mẫu "' + t.ten + '" chưa có thay đổi'); return }
  const list = myMau().map(x => (x.id === t.id ? { ...x, ...biaChup(bgCfg, coverMau) } : x))
  if (await ghi(list)) toast('Đã lưu mẫu "' + t.ten + '"')
  bgOptSetMany({ biaMau: t.id })   // vẽ lại thẻ (hết dấu "đã sửa")
}
export async function biaXoa(t) {
  if (!t || t.san) return
  if (!await qsConfirm('Xoá mẫu tờ bìa "' + t.ten + '"? Báo giá đang dùng mẫu này giữ nguyên cài đặt hiện tại.')) return
  await ghi(myMau().filter(x => x.id !== t.id))
  bgOptSetMany({ biaMau: null })
  toast('Đã xoá mẫu "' + t.ten + '"')
}
