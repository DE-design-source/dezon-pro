import { useSyncExternalStore } from 'react'

/* Chỗ trống trên hàng "Hạng mục đã bóc" (PageHead) để thanh công cụ nhanh (QuickBar) đưa ô tìm kiếm + nút Xuất báo giá vào
   bằng portal. Khoá theo tab ('chiphi', 'duan'): ô tìm ở chỗ '<tab>'; 'pc:<tab>' / 'pcm:<tab>' = chỗ trên băng dự án (PCard).
   Tab không có chỗ (Mua hàng) thì QuickBar vẽ tại chỗ như cũ. Giữ ở cấp module như pcSlot.js vì 2 component không lồng nhau. */
const els = {}
const subs = new Set()
const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }

/* ref callback của PageHead: gắn (node) / gỡ (null) */
export function setQbSlotEl(key, node) {
  if ((els[key] || null) === node) return
  els[key] = node
  subs.forEach(fn => fn())
}
export function useQbSlotEl(key) {
  return useSyncExternalStore(subscribe, () => els[key] || null, () => els[key] || null)
}

/* Chữ đang gõ trong ô tìm của QuickBar, theo tab ('chiphi', 'duan'): Chi phí / Dự án dùng luôn chữ này để lọc dòng của bảng
   (gộp 2 ô tìm làm 1 - ô "Tìm tên · mã · thương hiệu · phòng" cũ đã bỏ) */
const qs = {}
export function setQbQuery(tab, v) {
  if ((qs[tab] || '') === v) return
  qs[tab] = v
  subs.forEach(fn => fn())
}
export function useQbQuery(tab) {
  return useSyncExternalStore(subscribe, () => qs[tab] || '', () => qs[tab] || '')
}
