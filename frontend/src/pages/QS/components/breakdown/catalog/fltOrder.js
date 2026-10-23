import { useSyncExternalStore } from 'react'

/* Module của bảng Bộ lọc: các khối lọc gom theo nhóm (mỗi nhóm một khung riêng, FilterSections / FilterPopover).
   Thứ tự module kéo thả được (tay nắm ⋮⋮ ở đầu module), dùng chung cho hàng chip bật/tắt và danh sách module.
   Nhớ theo máy ở localStorage qs_flt_order3 = [id module...]. (qs_flt_order / qs_flt_order2 cũ xếp theo từng khối, đã bỏ.) */
export const FLT_MODS = [
  { id: 'vs', title: 'Thông số ngành', has: k => String(k).indexOf('vs_') === 0 },
  { id: 'brandprice', title: 'Thương hiệu & giá', has: k => k === 'brand' || k === 'price' },
  { id: 'den', title: 'Thông số kỹ thuật', has: k => k === 'watt' || k === 'kelvin' || k === 'angle' },
  { id: 'combo', title: 'Combo', has: k => k === 'combo' },
  { id: 'fav', title: 'Yêu thích', has: k => k === 'yeuthich' },
]
export const modOf = k => { const m = FLT_MODS.find(x => x.has(k)); return m ? m.id : 'other' }
export const modTitle = id => { const m = FLT_MODS.find(x => x.id === id); return m ? m.title : '' }

const LS = 'qs_flt_order3'
const DEFAULT_ORDER = ['chips', 'tags', 'scope', 'vs', 'brandprice', 'den', 'combo', 'fav']   // chips / tags / scope: module đầu bảng (CatalogPanel)
function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || 'null')
    return Array.isArray(v) && v.length ? v.map(String) : DEFAULT_ORDER.slice()
  } catch (e) { return DEFAULT_ORDER.slice() }
}
let order = read()
const subs = new Set()
const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }

export function useFltOrder() {
  return useSyncExternalStore(subscribe, () => order, () => order)
}

/* Xếp ids theo thứ tự đã lưu: các id đã có thứ tự đổi chỗ cho nhau trong đúng các ô của chúng,
   id chưa từng có thứ tự giữ nguyên vị trí mặc định */
export function sortFlt(ids, ord = order) {
  const slots = []
  ids.forEach((k, i) => { if (ord.indexOf(k) >= 0) slots.push(i) })
  const known = slots.map(i => ids[i]).sort((a, b) => ord.indexOf(a) - ord.indexOf(b))
  const out = ids.slice()
  slots.forEach((i, j) => { out[i] = known[j] })
  return out
}

/* Khoá khối lọc -> xếp theo thứ tự module, giữ thứ tự khối trong cùng module */
export function sortByMods(keys, ord = order) {
  const mods = []
  keys.forEach(k => { const m = modOf(k); if (mods.indexOf(m) < 0) mods.push(m) })
  const out = []
  sortFlt(mods, ord).forEach(m => keys.forEach(k => { if (modOf(k) === m) out.push(k) }))
  return out
}

/* Đưa module drag tới trước / sau module target trong danh sách ids đang hiện, rồi lưu (giữ thứ tự của id không hiện) */
export function moveFlt(ids, drag, target, after) {
  if (!drag || !target || drag === target) return
  const list = sortFlt(ids).filter(k => k !== drag)
  let j = list.indexOf(target)
  if (j < 0) return
  if (after) j++
  list.splice(j, 0, drag)
  order = list.concat(order.filter(k => list.indexOf(k) < 0))
  try { localStorage.setItem(LS, JSON.stringify(order)) } catch (e) { /* bỏ qua */ }
  subs.forEach(fn => fn())
}

/* Thu gọn / mở từng module (nút ⌃ / ⌄ ở đầu module, ModHead), nhớ theo máy ở localStorage qs_flt_modfold = {id: true khi thu gọn} */
const FOLD_LS = 'qs_flt_modfold'
let fold = (() => { try { const v = JSON.parse(localStorage.getItem(FOLD_LS) || '{}'); return v && typeof v === 'object' ? v : {} } catch (e) { return {} } })()
export function useModFold() {
  return useSyncExternalStore(subscribe, () => fold, () => fold)
}
export function toggleModFold(id) {
  fold = { ...fold, [id]: !fold[id] }
  try { localStorage.setItem(FOLD_LS, JSON.stringify(fold)) } catch (e) { /* bỏ qua */ }
  subs.forEach(fn => fn())
}
