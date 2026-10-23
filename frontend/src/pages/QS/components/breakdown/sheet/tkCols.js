/* Cột của bảng Bóc tách (S.cols / S.colOrder / S.colW của bản gốc), giữ ở cấp module để rời /qs rồi quay lại vẫn còn.
   Port: initCols / saveCols PUB/app.js:270-276 (qs_colcfg {order, w}) · COLSET.tk + csMy* 1638-1731 (bộ "Của tôi" lưu
   users.ui_prefs.tkCols qua setMyPref, dự phòng localStorage qs_tkcols_<user>) · toggleCol 1841 · tkColAll_ 1836 ·
   ctxHideCol / ctxShowAllCols boc.js:59-66 · moveCol boc.js:656.
   Cột đang hiện tự lưu theo tài khoản (users.ui_prefs.tkLastCols, dự phòng qs_tklast_<user>) mỗi lần đổi;
   đăng nhập (đổi tài khoản) thì mở lại đúng các cột đó, chưa có thì bộ "Của tôi" hoặc Mặc định. */
import { useSyncExternalStore } from 'react'
import { COLS, COLSET, TK_COL_CB, TK_PRESETS, initColOrder, csMyCols_, csMyApply_, csPresetCols_, csMyKey_, colAll_, csDangBat_ } from '../../../lib/columns.js'
import { getState, setState, histPushView } from '../../../state/store'
import * as api from '../../../api/qsApi'
import { qsToast, qsConfirm, qsAsk } from '../../common/dialogs'

const TK = COLSET.tk
function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }
function readCfg() { try { return JSON.parse(lsGet('qs_colcfg') || '{}') || {} } catch (e) { return {} } }

let S = null
const subs = new Set()
const emit = () => subs.forEach(fn => fn())
/* Đổi cột hiện / thứ tự / bề rộng -> ghi 1 bước Hoàn tác (histPushView). opts.live = đang kéo (chưa ghi, nhớ trạng thái lúc bắt đầu kéo) */
let dragBase = null
const snapCols = () => ({ cols: S.cols, order: S.order, w: S.w })
function set(patch, opts = {}) {
  const before = S ? snapCols() : null
  S = { ...S, ...patch }; emit()
  queueLast()
  if (!('cols' in patch || 'order' in patch || 'w' in patch)) return
  if (opts.live) { if (!dragBase) dragBase = before; return }
  const base = dragBase || before; dragBase = null
  if (!base) return
  const after = snapCols()
  if (base.cols === after.cols && base.order === after.order && base.w === after.w) return
  const go = st => () => { S = { ...S, ...st }; emit(); saveCfg(); queueLast() }
  histPushView(opts.label || 'Đổi cột hiển thị', go(base), go(after))
}

function meNow() { return getState().me || null }
function userOf(me) { return String((me && me.username) || '').toLowerCase() }
function localMine(me) { try { return JSON.parse(lsGet(csMyKey_('tk', userOf(me))) || 'null') } catch (e) { return null } }
export function myCols(me = meNow()) { return csMyCols_(TK, me && me.uiPrefs, localMine(me)) }

/* Cột đang hiện lần trước (tự lưu): server trước, máy này sau */
const LAST_PREF = 'tkLastCols'
function lastKey(me) { return 'qs_tklast_' + userOf(me) }
function lastCols(me) {
  let v = me && me.uiPrefs && me.uiPrefs[LAST_PREF]
  if (!Array.isArray(v)) { try { v = JSON.parse(lsGet(lastKey(me)) || 'null') } catch (e) { v = null } }
  if (!Array.isArray(v)) return null
  const ks = TK.keys()
  v = v.filter(k => ks.indexOf(k) >= 0)
  return v.length ? v : null
}

function init() {
  const me = meNow()
  const cfg = readCfg()
  S = { user: userOf(me), cols: csMyApply_(TK, lastCols(me) || myCols(me)), order: initColOrder(cfg), w: cfg.w || {} }
  lastSent = csDangBat_(TK, S.cols).join('|')
}

/* Tự lưu cột đang hiện (gom các lần bấm liền nhau); đang ở chế độ sửa bộ cột thì chờ lưu / huỷ xong mới ghi */
let lastSent = null
let lastTimer = null
function queueLast() {
  if (!S || S.edit) return
  clearTimeout(lastTimer)
  lastTimer = setTimeout(saveLast, 600)
}
async function saveLast() {
  const me = meNow()
  if (!S || S.edit || !me || S.user !== userOf(me)) return
  const keys = csDangBat_(TK, S.cols)
  const sig = keys.join('|')
  if (sig === lastSent) return
  lastSent = sig
  lsSet(lastKey(me), JSON.stringify(keys))
  try {
    const r = await api.setMyPref(LAST_PREF, keys)
    const cur = getState().me
    if (cur && userOf(cur) === userOf(me)) setMePrefs((r && r.uiPrefs) || { ...(cur.uiPrefs || {}), [LAST_PREF]: keys })
  } catch (e) { lastSent = null; qsToast('Đã lưu cột hiển thị trên máy này. Lưu theo tài khoản lỗi: ' + e.message) }
}
/* Đổi tài khoản -> áp lại bộ cột của tài khoản mới (csMyApplyAll_ lúc đăng nhập) */
function current() {
  if (!S) init()
  const u = userOf(meNow())
  if (u && S.user !== u) init()
  return S
}
function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
export function useTkCols() {
  return useSyncExternalStore(subscribe, current, current)
}
export const getTkCols = current

function saveCfg() { const s = current(); lsSet('qs_colcfg', JSON.stringify({ order: s.order, w: s.w })) }

export function toggleCol(k) {
  const s = current()
  const cols = { ...s.cols, [k]: !s.cols[k] }
  set({ cols })
}
export function setColsMap(m) { set({ cols: { ...m } }) }
export function applyPreset(id) {
  const m = csPresetCols_(TK, id); if (!m) return
  set({ cols: m })
}
export function colAll(on) {
  const m = colAll_(TK.keys(), TK_COL_CB, on)
  set({ cols: m })
  saveCfg()
}
export function hideCol(key) {
  if (key === 'ten') { qsToast('Không thể ẩn cột Tên sản phẩm'); return }
  set({ cols: { ...current().cols, [key]: false } })
  const lbl = (COLS.filter(c => c[0] === key)[0] || [key, key])[1]
  qsToast('Đã ẩn cột "' + lbl + '" — bật lại ở hàng chip phía trên')
}
export function showAllCols() {
  const m = {}; COLS.forEach(c => { m[c[0]] = true })
  set({ cols: m })
  qsToast('Đã hiện lại tất cả cột')
}
export function moveCol(from, to, before) {
  const o = current().order.slice(); const fi = o.indexOf(from); if (fi < 0) return
  o.splice(fi, 1); let ti = o.indexOf(to); if (ti < 0) ti = o.length
  o.splice(before ? ti : ti + 1, 0, from)
  set({ order: o }); saveCfg()
}
/* save = false: đang kéo (vẽ lại ngay), chỉ ghi qs_colcfg khi thả chuột như btKeoCot_ */
export function setColW(k, w, save = true) { set({ w: { ...current().w, [k]: w } }, { live: !save, label: 'Đổi độ rộng cột' }); if (save) saveCfg() }

/* Bộ "Của tôi" */
export function applyMine() {
  const v = myCols(); if (!v) return
  set({ cols: csMyApply_(TK, v) })
  qsToast('Đã bật bộ cột của tôi')
}
function setMePrefs(uiPrefs) {
  const me = getState().me
  if (me) setState({ me: { ...me, uiPrefs: uiPrefs || {} } })
}
/* keys: danh sách cột muốn lưu (đặt mặc định từ 1 dòng của "Chọn nhanh cột"); thiếu thì lấy cột đang hiện */
export async function saveMine(keys) {
  const me = meNow()
  if (!Array.isArray(keys)) keys = csDangBat_(TK, current().cols)
  lsSet(csMyKey_('tk', userOf(me)), JSON.stringify(keys))
  try {
    const r = await api.setMyPref(TK.pref, keys)
    const up = {}; up[TK.pref] = keys
    setMePrefs((r && r.uiPrefs) || { ...((me && me.uiPrefs) || {}), ...up })
    qsToast('Đã lưu ' + keys.length + ' cột làm mặc định của tài khoản ' + ((me && me.username) || ''))
  } catch (e) { qsToast('Đã lưu trên máy này. Lưu theo tài khoản lỗi: ' + e.message) }
  emit()
}
/* Bộ cột tự đặt tên (nút sửa ở dải chip): users.ui_prefs.tkPresets = [{name, cols}], dự phòng localStorage qs_tkpresets_<user> */
const PRESET_MAX = 20
function presetsKey(me) { return 'qs_tkpresets_' + userOf(me) }
export function myPresets(me = meNow()) {
  let v = me && me.uiPrefs && me.uiPrefs.tkPresets
  if (!Array.isArray(v)) { try { v = JSON.parse(lsGet(presetsKey(me)) || 'null') } catch (e) { v = null } }
  if (!Array.isArray(v)) return []
  const ks = TK.keys()
  return v.filter(p => p && typeof p.name === 'string' && Array.isArray(p.cols))
    .map(p => ({ name: p.name, cols: p.cols.filter(k => ks.indexOf(k) >= 0) }))
}
async function writePresets(list) {
  const me = meNow()
  lsSet(presetsKey(me), list.length ? JSON.stringify(list) : null)
  try {
    const r = await api.setMyPref('tkPresets', list.length ? list : null)
    setMePrefs((r && r.uiPrefs) || { ...((me && me.uiPrefs) || {}), tkPresets: list })
    return true
  } catch (e) { qsToast('Đã lưu trên máy này. Lưu theo tài khoản lỗi: ' + e.message); return false } finally { set({}) }
}
export function applyCustom(p) { set({ cols: csMyApply_(TK, p.cols) }) }
/* Lưu map cột m thành bộ tên name (trùng tên thì ghi đè), rồi áp luôn bộ đó.
   from: tên bộ tự đặt đang sửa -> đổi tên thì bỏ bộ cũ, nút nhanh đang gán bộ cũ chuyển sang tên mới */
export async function savePreset(name, m, from = null) {
  name = String(name || '').trim().slice(0, 39)
  if (!name) return false
  const cols = csDangBat_(TK, m)
  const same = x => x.toLowerCase() === name.toLowerCase()
  const list = myPresets().filter(p => !same(p.name) && p.name !== from)
  if (list.length >= PRESET_MAX) { qsToast('Tối đa ' + PRESET_MAX + ' bộ cột — xoá bớt ở "Chọn nhanh cột"'); return false }
  list.push({ name, cols })
  set({ cols: csMyApply_(TK, cols) })
  if (await writePresets(list)) qsToast('Đã lưu bộ cột "' + name + '" (' + cols.length + ' cột) — chọn lại ở "Chọn nhanh cột"')
  if (from && from !== name && quickId() === 'u:' + from) await setQuick('u:' + name)
  if (from && from !== name && myOrder().indexOf('u:' + from) >= 0) await saveOrder(myOrder().map(x => (x === 'u:' + from ? 'u:' + name : x)), true)
  return true
}

/* Chế độ sửa bộ cột (dùng chung cho nút sửa ở dải chip và ở khung "Chọn nhanh cột"):
   S.edit = {orig: cột trước khi sửa, name: tên gợi ý, from: tên bộ tự đặt đang sửa | null} */
export function startEdit(opts = {}) {
  const s = current()
  const orig = s.edit ? s.edit.orig : { ...s.cols }
  set({ edit: { orig, name: opts.name || '', from: opts.from || null }, cols: opts.cols ? { ...opts.cols } : s.cols })
}
/* Thoát chế độ sửa, giữ nguyên cột đang hiện */
export function endEdit() { if (current().edit) set({ edit: null }) }
export function cancelEdit() {
  const s = current(); if (!s.edit) return
  set({ cols: s.edit.orig, edit: null })
}
/* Tạo mới: hỏi tên, trùng tên bộ tự đặt có sẵn thì hỏi lại trước khi ghi đè */
export async function saveEditNew() {
  const s = current(); if (!s.edit) return
  const name = await qsAsk({ title: 'Tạo bộ cột mới', label: 'Tên bộ cột (' + csDangBat_(TK, s.cols).length + ' cột đang hiện)', value: s.edit.from ? '' : s.edit.name, placeholder: 'VD: Báo giá rút gọn', confirmText: 'Tạo' })
  if (!name) return
  const nm = String(name).trim().toLowerCase()
  const dup = myPresets().find(p => p.name.toLowerCase() === nm)
  if (dup && !await qsConfirm('Đã có bộ cột "' + dup.name + '". Ghi đè bộ đó?')) return
  if (await savePreset(name, current().cols)) set({ edit: null })
}
/* Lưu đè lên bộ có sẵn: name = tên bộ tự đặt, null = bộ "Của tôi" */
export async function saveEditOver(name) {
  const s = current(); if (!s.edit) return
  if (name === null) { await saveMine(csDangBat_(TK, s.cols)); set({ edit: null }); return }
  if (await savePreset(name, s.cols, name)) set({ edit: null })
}

/* Nút nhanh trên thanh công cụ (vị trí số 2): gán 1 bộ cột, lưu users.ui_prefs.tkQuick = "p:<id>" | "u:<tên>",
   dự phòng localStorage qs_tkquick_<user>. Bấm lần 1: áp bộ; bấm lại khi đang khớp: trả về cột trước đó. */
function quickKey(me) { return 'qs_tkquick_' + userOf(me) }
export function quickId(me = meNow()) {
  const v = me && me.uiPrefs && me.uiPrefs.tkQuick
  if (typeof v === 'string') return v
  return lsGet(quickKey(me)) || null
}
export function quickPreset() {
  const id = quickId(); if (!id) return null
  if (id.indexOf('p:') === 0) {
    const ps = TK_PRESETS.filter(x => x[0] === id.slice(2))[0]
    return ps ? { id, name: ps[1], cols: csPresetCols_(TK, ps[0]) } : null
  }
  const p = myPresets().find(x => 'u:' + x.name === id)
  return p ? { id, name: p.name, cols: csMyApply_(TK, p.cols) } : null
}
export function sameCols(a, b) { return TK.keys().every(k => !!(a || {})[k] === !!(b || {})[k]) }
export async function setQuick(id) {
  const me = meNow()
  lsSet(quickKey(me), id)
  try {
    const r = await api.setMyPref('tkQuick', id)
    const up = { ...((me && me.uiPrefs) || {}) }; if (id) up.tkQuick = id; else delete up.tkQuick
    setMePrefs((r && r.uiPrefs) || up)
  } catch (e) { qsToast('Đã lưu trên máy này. Lưu theo tài khoản lỗi: ' + e.message) }
  set({})
}
let quickPrev = null
export function toggleQuick() {
  const q = quickPreset()
  if (!q) { qsToast('Chưa gán bộ cột cho nút này — rê chuột vào 1 bộ ở "Chọn nhanh cột" rồi bấm nút gán'); return }
  const cur = current().cols
  if (sameCols(cur, q.cols)) {
    set({ cols: quickPrev && !sameCols(quickPrev, q.cols) ? quickPrev : csMyApply_(TK, myCols()) })
    quickPrev = null
    return
  }
  quickPrev = { ...cur }
  set({ cols: { ...q.cols } })
}

/* Thứ tự các bộ trong khung "Chọn nhanh cột" (kéo thả khi đang sửa): users.ui_prefs.tkOrder = [id], dự phòng qs_tkorder_<user>.
   id = "p:<id bộ dựng sẵn>" | "u:<tên bộ tự đặt>"; bộ chưa có trong danh sách nối cuối theo thứ tự gốc */
function orderKey(me) { return 'qs_tkorder_' + userOf(me) }
export function myOrder(me = meNow()) {
  let v = me && me.uiPrefs && me.uiPrefs.tkOrder
  if (!Array.isArray(v)) { try { v = JSON.parse(lsGet(orderKey(me)) || 'null') } catch (e) { v = null } }
  return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
}
export function sortByOrder(ids, order = myOrder()) {
  const at = id => { const i = order.indexOf(id); return i < 0 ? order.length + ids.indexOf(id) : i }
  return ids.slice().sort((a, b) => at(a) - at(b))
}
export async function saveOrder(ids, silent = false) {
  const me = meNow()
  lsSet(orderKey(me), JSON.stringify(ids))
  try {
    const r = await api.setMyPref('tkOrder', ids)
    setMePrefs((r && r.uiPrefs) || { ...((me && me.uiPrefs) || {}), tkOrder: ids })
    if (!silent) qsToast('Đã lưu thứ tự bộ cột')
  } catch (e) { qsToast('Đã lưu trên máy này. Lưu theo tài khoản lỗi: ' + e.message) }
  set({})
}

async function dropMine() {
  const me = meNow()
  lsSet(csMyKey_('tk', userOf(me)), null)
  try { const r = await api.setMyPref(TK.pref, null); setMePrefs((r && r.uiPrefs) || {}) } catch (e) {
    if (me && me.uiPrefs) { const up = { ...me.uiPrefs }; delete up[TK.pref]; setMePrefs(up) }
  }
  emit()
}
export async function clearMine() {
  if (!await qsConfirm('Xoá bộ cột "Của tôi" của bảng ' + TK.ten + '? Lần sau đăng nhập sẽ dùng bộ Mặc định.')) return
  await dropMine()
  qsToast('Đã xoá bộ cột của tôi')
}
/* Lưu một lượt các thay đổi đã làm ở chế độ sửa của khung "Chọn nhanh cột":
   ch = {delNames: [tên bộ tự đặt], delMine, defKeys: [cột] | undefined, quick: id | null | undefined, order: [id] | null}.
   Có xoá thì hỏi lại 1 lần; trả false nếu người dùng thôi */
export async function commitDock(ch) {
  const delNames = ch.delNames || []
  const n = delNames.length + (ch.delMine ? 1 : 0)
  if (n) {
    const ds = [...(ch.delMine ? ['Của tôi'] : []), ...delNames].map(x => '"' + x + '"').join(', ')
    if (!await qsConfirm('Lưu thay đổi và xoá ' + n + ' bộ cột: ' + ds + '?')) return false
  }
  if (delNames.length) await writePresets(myPresets().filter(p => delNames.indexOf(p.name) < 0))
  if (ch.delMine) await dropMine()
  if (ch.defKeys) await saveMine(ch.defKeys)
  let q = ch.quick
  if (q === undefined && delNames.some(x => quickId() === 'u:' + x)) q = null
  if (q !== undefined && q !== quickId()) await setQuick(q)
  if (ch.order) await saveOrder(ch.order.filter(id => delNames.every(x => id !== 'u:' + x)), true)
  qsToast('Đã lưu thay đổi bộ cột')
  return true
}


/* Bỏ bề rộng tự đặt của các cột keys (về bề rộng tự cân theo khung / tiêu đề) — dùng cho "Xem tối ưu" */
export function resetColW(keys) {
  const w = { ...current().w }
  let doi = false
  keys.forEach(k => { if (k in w) { delete w[k]; doi = true } })
  if (!doi) return
  set({ w }, { label: 'Xem tối ưu — cân bề rộng cột' }); saveCfg()
}
