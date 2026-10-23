import { useSyncExternalStore } from 'react'

/* Chỗ trống trên băng dự án (PCard) để Bóc tách đưa phần đầu bảng lên bằng portal:
     'totals' = dải Chưa VAT / VAT / Tổng; 'node' = nút ẩn/hiện cột hạng mục + "Hạng mục đã bóc" + nút chọn hạng mục.
   PCard gắn phần tử khi đang ở tab Bóc tách và băng đang mở rộng; SheetHeader thấy có chỗ thì vẽ vào đó,
   không có (băng gập / tab khác) thì vẽ tại chỗ như cũ. Giữ ở cấp module như Mroot.jsx vì 2 component không lồng nhau. */
const els = { totals: null, node: null }
const subs = new Set()
const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }

function setEl(key, node) {
  if (els[key] === node) return
  els[key] = node
  subs.forEach(fn => fn())
}

/* ref callback của PCard: gắn (node) / gỡ (null) */
export const setPcTotalsEl = node => setEl('totals', node)
export const setPcNodeEl = node => setEl('node', node)

export function usePcTotalsEl() {
  return useSyncExternalStore(subscribe, () => els.totals, () => els.totals)
}
export function usePcNodeEl() {
  return useSyncExternalStore(subscribe, () => els.node, () => els.node)
}

/* Mép trái của bảng Bóc tách tính từ mép trái vùng nội dung (px của vùng QS) = bề rộng cột Hạng mục + khe kéo,
   0 khi cột ẩn. BreakdownTab ghi; PCard đặt cụm .qs-pc-node bắt đầu đúng mép này (gióng hàng với bảng bên dưới). */
let alignX = 0
export function setPcAlignX(px) {
  if (alignX === px) return
  alignX = px
  subs.forEach(fn => fn())
}
export function usePcAlignX() {
  return useSyncExternalStore(subscribe, () => alignX, () => alignX)
}
