/* Phần dùng chung của băng dự án / bảng điều khiển / thanh công cụ nhanh (Batch 1A). Không vẽ gì.
   - Gập khối đầu trang (port foldGet_/foldSet_/foldToggle_, PUB/boc.js:1221-1225), khoá qs_fold dùng chung với Bóc tách
     (khoá 'totals' / 'tools' / 'cols' do tab Bóc tách đọc). Ghi qua foldSet_ để mọi nơi đang hiện tự vẽ lại (sự kiện 'qs:fold').
   - Ngữ cảnh tính tổng cpTong_ của dự án đang mở (Phần thô + chiết khấu báo giá, PUB/chiphi.js:414-422, phantho.js:1934-1947). */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getState } from '../../state/store'
import { projDataLoad_ } from '../../state/projData'
import { tuyGop_ } from '../quote/tuyMau'

export const FOLD_KEYS = ['pcard', 'totals', 'tools', 'cols']
const FOLD_EV = 'qs:fold'

function foldRaw_() { try { return localStorage.getItem('qs_fold') || '' } catch (e) { return '' } }
export function foldGet_() {
  try { const v = JSON.parse(foldRaw_() || 'null'); if (v && typeof v === 'object') return v } catch (e) { /* bỏ qua */ }
  return { cols: true }   // mặc định: chip cột gọn 1 dòng (bấm mới bung)
}
export function foldSet_(v) {
  try { localStorage.setItem('qs_fold', JSON.stringify(v)) } catch (e) { /* bỏ qua */ }
  try { window.dispatchEvent(new Event(FOLD_EV)) } catch (e) { /* bỏ qua */ }
}
export function foldToggle_(k) { const v = foldGet_(); v[k] = !v[k]; delete v._all; foldSet_(v) }

function foldSub_(fn) {
  window.addEventListener(FOLD_EV, fn)
  window.addEventListener('storage', fn)
  return () => { window.removeEventListener(FOLD_EV, fn); window.removeEventListener('storage', fn) }
}
/* true khi khối k đang gập; đọc thẳng localStorage nên đổi từ nơi khác (Bóc tách "Mở rộng bảng") cũng thấy */
export function useFold(k) {
  const raw = useSyncExternalStore(foldSub_, foldRaw_, foldRaw_)
  void raw
  return !!foldGet_()[k]
}

/* ctx cho cpTong_ / dashTotals_: VAT dự án, Phần thô + VAT phần thô (mặc định theo VAT dự án), cấu hình báo giá */
export function projCtx_(cur, projData) {
  const pd = projData || {}
  const v = pd.ptVat
  const nv = Number(v)
  return {
    vat: cur ? cur.vat : 0,
    phanTho: Array.isArray(pd.phanTho) ? pd.phanTho : [],
    ptVat: (v != null && v !== '' && isFinite(nv)) ? nv : (Number(cur && cur.vat) || 0),
    bgCfg: tuyGop_(pd.bgCfg),   // khoá Tuỳ biến chưa đặt -> mặc định công ty (quote/tuyMau)
  }
}

/* Esc chỉ đóng hộp TRÊN CÙNG: hộp xác nhận / nhập (.qsc-ov) mở sau đè lên thì để hộp đó xử lý,
   không đóng luôn hộp dự án bên dưới (mất phần đang sửa). el = lớp phủ của hộp gọi. */
export function escOnTop_(el) {
  if (!el) return false
  const all = document.querySelectorAll('.qsc-ov, .qs-modal-backdrop')
  return all[all.length - 1] === el
}

/* Dữ liệu rời của bản nháp đang mở (Phần thô, cấu hình báo giá...): bản gốc chỉ vẽ sau khi projDataLoad_ xong
   (openProject_, PUB/app.js:2337-2341). Ở đây cur + lines có trước, nên chưa tải xong thì KHÔNG hiện số tiền
   (sẽ thiếu Phần thô và chiết khấu báo giá). Lỗi tải: status.pdErr {maDA,msg} nếu store có, hoặc lần "Thử lại" vừa hỏng;
   tải quá 6 s (như lời nhắc của màn hình chờ) thì cũng cho bấm "Thử lại". */
let pdFail = null
const pdSubs = new Set()
function pdFailSet_(v) { pdFail = v; pdSubs.forEach(fn => fn()) }
function pdFailSub_(fn) { pdSubs.add(fn); return () => pdSubs.delete(fn) }
const pdFailGet_ = () => pdFail

export async function pdRetry_(maDA) {
  if (!maDA) return
  pdFailSet_(null)
  await projDataLoad_(maDA)
  const S = getState()
  if (S.cur && S.cur.maDA === maDA && S.pdOk !== maDA) pdFailSet_({ maDA, msg: 'Không tải được dữ liệu dự án (Phần thô, chiết khấu báo giá).' })
}

/* -> {ready, err, slow}: ready = đã có dữ liệu thật của bản nháp đang mở; err = câu lỗi ('' nếu chưa biết lỗi) */
export function usePdState(cur, status) {
  const ma = cur ? cur.maDA : ''
  const ready = !!ma && status.pdOk === ma
  const fail = useSyncExternalStore(pdFailSub_, pdFailGet_, pdFailGet_)
  const se = status.pdErr
  const err = ready || !ma ? ''
    : (se && se.maDA === ma ? String(se.msg || 'Không tải được dữ liệu dự án.') : (fail && fail.maDA === ma ? fail.msg : ''))
  const [slowMa, setSlowMa] = useState('')
  const seq = status.pdSeq
  useEffect(() => {
    setSlowMa('')
    if (!ma || ready) return undefined
    const t = setTimeout(() => setSlowMa(ma), 6000)
    return () => clearTimeout(t)
  }, [ma, ready, seq])
  return { ready, err, slow: !ready && !err && !!ma && slowMa === ma }
}
