import { useSyncExternalStore } from 'react'

/* Trạng thái "AI gợi ý trực tiếp" khi Live, dùng chung giữa khối Live (CdLiveCoach, cột phụ - gọi máy chủ) và
   phần Gợi ý của khối AI (LiveCoachCards trong CdAi, cột chính - hiện các ô gợi ý to cho nhân viên đọc).
   Theo khách: {res, busy, err, auto, ask: fn gợi ý ngay, toggleAuto: fn}; khối Live đóng thì xoá. */

const state = new Map()
const subs = new Set()
const emit = () => subs.forEach(f => f())
const subscribe = f => { subs.add(f); return () => subs.delete(f) }

export function setCoach(leadId, patch) {
  const k = String(leadId)
  state.set(k, { ...(state.get(k) || {}), ...patch })
  emit()
}
export function clearCoach(leadId) {
  if (state.delete(String(leadId))) emit()
}
export function useLiveCoach(leadId) {
  return useSyncExternalStore(subscribe, () => state.get(String(leadId)) || null)
}
