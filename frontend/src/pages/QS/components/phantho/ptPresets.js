/* Bộ cột của bảng Phần thô (đề mục 3.1), cùng cách làm tkCols của Bóc tách:
   bộ "Của tôi" users.ui_prefs.ptCols (dự phòng qs_ptcols_<user>) · bộ tự đặt tên ptPresets = [{name, cols}] (dự phòng qs_ptpresets_<user>)
   · thứ tự bộ trong khung "Chọn nhanh cột" ptOrder = [id] (dự phòng qs_ptorder_<user>); id = "p:<id bộ dựng sẵn>" | "u:<tên>".
   Chế độ sửa: ptUi.colEdit = {orig, name, from}. Cột đang hiện nằm ở ptUi.cols (ptState). */
import * as api from '../../api/qsApi'
import { getState, setState } from '../../state/store'
import { qsToast, qsConfirm, qsAsk } from '../common/dialogs'
import { ptUi, setPtUi } from './ptState'
import { PT_COLS, PT_PRESETS, ptPresetCols_ } from './ptModel'

const KEYS = PT_COLS.map(c => c[0])
const PRESET_MAX = 20
function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }
function lsArr(k) { try { const v = JSON.parse(lsGet(k) || 'null'); return Array.isArray(v) ? v : null } catch (e) { return null } }
const meNow = () => getState().me || null
const userOf = me => String((me && me.username) || '').toLowerCase()
const prefOf = (me, k) => (me && me.uiPrefs ? me.uiPrefs[k] : undefined)
const bump = () => setPtUi(s => ({ prefVer: (s.prefVer || 0) + 1 }))

export const ptOnKeys = m => KEYS.filter(k => (m || {})[k])
export function ptSameMap(a, b) { return KEYS.every(k => !!(a || {})[k] === !!(b || {})[k]) }

function setMePrefs(uiPrefs) { const me = getState().me; if (me) setState({ me: { ...me, uiPrefs: uiPrefs || {} } }) }
/* Ghi 1 khoá ui_prefs: máy này trước (lsKey), rồi tài khoản; value null = xoá */
async function writePref(prefKey, lsKey, value) {
  const me = meNow()
  lsSet(lsKey, value == null ? null : JSON.stringify(value))
  try {
    const r = await api.setMyPref(prefKey, value)
    const up = { ...((me && me.uiPrefs) || {}) }; if (value == null) delete up[prefKey]; else up[prefKey] = value
    setMePrefs((r && r.uiPrefs) || up)
    return true
  } catch (e) { qsToast('Đã lưu trên máy này. Lưu theo tài khoản lỗi: ' + e.message); return false } finally { bump() }
}

/* Bộ "Của tôi" */
const mineKey = me => 'qs_ptcols_' + userOf(me)
export function ptMyCols(me = meNow()) {
  let v = prefOf(me, 'ptCols')
  if (!Array.isArray(v)) v = lsArr(mineKey(me))
  if (!Array.isArray(v)) return null
  v = v.filter(k => KEYS.indexOf(k) >= 0)
  return v.length ? v : null
}
export async function ptSaveMine(keys) {
  const me = meNow()
  if (!Array.isArray(keys)) keys = ptOnKeys(ptUi().cols)
  if (await writePref('ptCols', mineKey(me), keys)) qsToast('Đã lưu ' + keys.length + ' cột làm mặc định của tài khoản ' + ((me && me.username) || ''))
}
async function dropMine() { await writePref('ptCols', mineKey(meNow()), null) }
export async function ptClearMine() {
  if (!await qsConfirm('Xoá bộ cột "Của tôi" của bảng Phần thô? Lần sau sẽ hiện tất cả cột.')) return
  await dropMine()
  qsToast('Đã xoá bộ cột của tôi')
}
export function ptApplyMine() { const v = ptMyCols(); if (v) setPtUi({ cols: ptPresetCols_(v) }) }
/* Áp bộ "Của tôi" 1 lần cho mỗi tài khoản (như Bóc tách tự áp bộ mặc định khi đăng nhập) */
let appliedFor = null
export function ptApplyMineOnce() {
  const u = userOf(meNow())
  if (!u || appliedFor === u) return
  appliedFor = u
  ptApplyMine()
}

/* Bộ tự đặt tên */
const presetsKey = me => 'qs_ptpresets_' + userOf(me)
export function ptMyPresets(me = meNow()) {
  let v = prefOf(me, 'ptPresets')
  if (!Array.isArray(v)) v = lsArr(presetsKey(me))
  if (!Array.isArray(v)) return []
  return v.filter(p => p && typeof p.name === 'string' && Array.isArray(p.cols))
    .map(p => ({ name: p.name, cols: p.cols.filter(k => KEYS.indexOf(k) >= 0) }))
}
const writePresets = list => writePref('ptPresets', presetsKey(meNow()), list.length ? list : null)
export function ptApplyCustom(p) { setPtUi({ cols: ptPresetCols_(p.cols) }) }
/* Lưu map cột m thành bộ tên name (trùng tên thì ghi đè) rồi áp luôn; from = tên bộ đang sửa (đổi tên thì bỏ bộ cũ) */
async function savePreset(name, m, from = null) {
  name = String(name || '').trim().slice(0, 39)
  if (!name) return false
  const cols = ptOnKeys(m)
  const same = x => x.toLowerCase() === name.toLowerCase()
  const list = ptMyPresets().filter(p => !same(p.name) && p.name !== from)
  if (list.length >= PRESET_MAX) { qsToast('Tối đa ' + PRESET_MAX + ' bộ cột — xoá bớt ở "Chọn nhanh cột"'); return false }
  list.push({ name, cols })
  setPtUi({ cols: ptPresetCols_(cols) })
  if (await writePresets(list)) qsToast('Đã lưu bộ cột "' + name + '" (' + cols.length + ' cột) — chọn lại ở "Chọn nhanh cột"')
  if (from && from !== name && ptMyOrder().indexOf('u:' + from) >= 0) await ptSaveOrder(ptMyOrder().map(x => (x === 'u:' + from ? 'u:' + name : x)))
  return true
}

/* Thứ tự bộ trong khung "Chọn nhanh cột" */
const orderKey = me => 'qs_ptorder_' + userOf(me)
export function ptMyOrder(me = meNow()) {
  let v = prefOf(me, 'ptOrder')
  if (!Array.isArray(v)) v = lsArr(orderKey(me))
  return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
}
export const ptSaveOrder = ids => writePref('ptOrder', orderKey(meNow()), ids)

/* Các bộ (dựng sẵn + tự đặt) theo thứ tự đã kéo: {id, name, keys, map, custom, p} */
export function ptPresetRows(order = ptMyOrder()) {
  const rows = [
    ...PT_PRESETS.map(ps => { const map = ptPresetCols_(ps[2]); return { id: 'p:' + ps[0], name: ps[1], keys: ptOnKeys(map), map, custom: false } }),
    ...ptMyPresets().map(p => { const map = ptPresetCols_(p.cols); return { id: 'u:' + p.name, p, name: p.name, keys: ptOnKeys(map), map, custom: true } }),
  ]
  const at = id => { const i = order.indexOf(id); return i < 0 ? order.length + rows.findIndex(r => r.id === id) : i }
  return rows.slice().sort((a, b) => at(a.id) - at(b.id))
}

/* Chế độ sửa (nút sửa ở dải chip và ở khung "Chọn nhanh cột") */
export function ptStartEdit(opts = {}) {
  const s = ptUi()
  const orig = s.colEdit ? s.colEdit.orig : { ...s.cols }
  setPtUi({ colEdit: { orig, name: opts.name || '', from: opts.from || null }, cols: opts.cols ? { ...opts.cols } : s.cols })
}
export function ptEndEdit() { if (ptUi().colEdit) setPtUi({ colEdit: null }) }
export function ptCancelEdit() { const s = ptUi(); if (s.colEdit) setPtUi({ cols: s.colEdit.orig, colEdit: null }) }
export async function ptSaveEditNew() {
  const s = ptUi(); if (!s.colEdit) return
  const name = await qsAsk({ title: 'Tạo bộ cột mới', label: 'Tên bộ cột (' + ptOnKeys(s.cols).length + ' cột đang hiện)', value: s.colEdit.from ? '' : s.colEdit.name, placeholder: 'VD: Báo giá rút gọn', confirmText: 'Tạo' })
  if (!name) return
  const nm = String(name).trim().toLowerCase()
  const dup = ptMyPresets().find(p => p.name.toLowerCase() === nm)
  if (dup && !await qsConfirm('Đã có bộ cột "' + dup.name + '". Ghi đè bộ đó?')) return
  if (await savePreset(name, ptUi().cols)) setPtUi({ colEdit: null })
}
/* Lưu đè: name = tên bộ tự đặt, null = bộ "Của tôi" */
export async function ptSaveEditOver(name) {
  const s = ptUi(); if (!s.colEdit) return
  if (name === null) { await ptSaveMine(ptOnKeys(s.cols)); setPtUi({ colEdit: null }); return }
  if (await savePreset(name, s.cols, name)) setPtUi({ colEdit: null })
}

/* Lưu một lượt thay đổi của chế độ sửa khung "Chọn nhanh cột": {delNames, delMine, defKeys, order}; có xoá thì hỏi lại */
export async function ptCommitDock(ch) {
  const delNames = ch.delNames || []
  const n = delNames.length + (ch.delMine ? 1 : 0)
  if (n) {
    const ds = [...(ch.delMine ? ['Của tôi'] : []), ...delNames].map(x => '"' + x + '"').join(', ')
    if (!await qsConfirm('Lưu thay đổi và xoá ' + n + ' bộ cột: ' + ds + '?')) return false
  }
  if (delNames.length) await writePresets(ptMyPresets().filter(p => delNames.indexOf(p.name) < 0))
  if (ch.delMine) await dropMine()
  if (ch.defKeys) await ptSaveMine(ch.defKeys)
  if (ch.order) await ptSaveOrder(ch.order.filter(id => delNames.every(x => id !== 'u:' + x)))
  qsToast('Đã lưu thay đổi bộ cột')
  return true
}
