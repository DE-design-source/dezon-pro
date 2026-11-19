import { useEffect, useSyncExternalStore } from 'react'
import * as api from '../../api/qsApi'
import { qsToast } from '../common/dialogs'

/* Bản chính của dự án (MarkUp 2026-11-19): mỗi dự án (nhóm bản nháp cùng tên) chọn 1 bản nháp làm bản chính.
   Dữ liệu công ty '__cty' khoá daBanChinh {mã bản nháp: 1}; khoá theo mã bản nháp (không theo bản đầu như daPhuTrach)
   để xoá / đổi tên bản nháp khác không làm mất lựa chọn. Giữ ở cấp module như ptStore.js để mọi dạng xem khớp nhau. */
let map = {}
let loaded = false
const subs = new Set()
const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }
const emit = m => { map = m; subs.forEach(fn => fn()) }

function load_() {
  if (loaded) return
  loaded = true
  api.getProjData('__cty').then(d => emit((d && d.daBanChinh && typeof d.daBanChinh === 'object') ? d.daBanChinh : {}), () => { loaded = false })
}

/* -> {mã bản nháp: 1} */
export function useMainDrafts() {
  useEffect(load_, [])
  return useSyncExternalStore(subscribe, () => map, () => map)
}

/* Đặt maDA làm bản chính của nhóm (groupMas = mã mọi bản nháp trong dự án); bấm lại bản đang là chính = bỏ chọn */
export async function setMainDraft(maDA, groupMas) {
  const old = map
  const n = { ...map }
  const was = !!n[maDA]
  groupMas.forEach(m => { delete n[m] })
  if (!was) n[maDA] = 1
  emit(n)
  try { await api.setProjData('__cty', 'daBanChinh', n) } catch (e) { emit(old); qsToast('Lỗi lưu bản chính: ' + ((e && e.message) || e)) }
}
