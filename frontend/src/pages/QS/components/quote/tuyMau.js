import { useEffect, useState } from 'react'
import * as api from '../../api/qsApi'
import { qsToast as toast } from '../common/dialogs'

/* Mẫu Tuỳ biến của công ty (dữ liệu công ty 'bgTuy' = {macDinh: bộ | null, nhanh: [bộ | null, bộ | null, bộ | null]}, api.getProjData /
   setProjData với mã '__cty'). 1 "bộ" = giá trị các khoá TUY_KEYS của bgCfg (màu, font, cỡ chữ, khung, viền bảng, chữ tiêu đề).
   - macDinh: mặc định của công ty - bản nháp chưa tự đặt khoá nào thì dùng giá trị này (tuyGop_, gộp ở projCtx_), chưa có thì theo mặc định gốc.
   - nhanh: các ô lưu nhanh (1)(2)(3)… (tối thiểu 3 ô, tối đa NHANH_MAX) để áp 1 bấm cho bản nháp đang mở; bộ có thể kèm tên tự đặt (_ten). */
/* hậu tố khoá khung = KH_SUF của docCss (chép lại, không import docCss để projectShell -> tuyMau không vòng import lúc nạp) */
const KH_SUF_ = ['Bao', 'Bo', 'Ngang', 'Doc', 'Day', 'Kieu', 'Mau', 'Cach', 'Lui', 'LuiD', 'BDay', 'BKieu', 'BMau', 'NDay', 'NKieu', 'NMau', 'DDay', 'DKieu', 'DMau', 'Vien']
const khungKeys_ = pre => KH_SUF_.map(x => pre + x)
export const TUY_KEYS = ['mau', 'font', 'co', 'coSo', 'hdNen', 'hdChu', 'hdCo', 'hdSo', 'hdFont', 'ttSo', 'ttFont',
  'ttkCo', 'ttkFont', 'ttkMau', 'ttvCo', 'ttvFont', 'ttvMau', 'tdSo', 'tdCo1', 'tdCo2', 'tdCo3', 'tdFont1', 'tdFont2',
  'vNgoai', 'vLuoi', 'vDay', 'vKieu', 'vMau', 'vNgoaiDam', 'soLe', 'canhDoc', 'cotNen', 'cotChu', 'cotSo', 'cotFont', 'tgNen1', 'tgNen2', 'tgNen3', 'tgSo', 'tgFont', 'tsNen', 'tsChu', 'tsVien', 'tsTong', 'tsSo', 'tsFont',
  ...khungKeys_('tk'), ...khungKeys_('tdk'), ...khungKeys_('ctk')]

let cache = null              // {macDinh, nhanh[3]} sau khi tải
const subs = new Set()
const phat = () => subs.forEach(f => f(cache))
export const NHANH_MAX = 9
const chuan_ = d => {
  const ds = d && Array.isArray(d.nhanh) ? d.nhanh.slice(0, NHANH_MAX) : []
  const n = Math.max(3, ds.length)
  return { macDinh: d && d.macDinh && typeof d.macDinh === 'object' ? d.macDinh : null,
    nhanh: Array.from({ length: n }, (x, i) => (ds[i] && typeof ds[i] === 'object' ? ds[i] : null)) }
}

export function tuyNap() {
  if (cache) return Promise.resolve(cache)
  return api.getProjData('__cty').then(d => { cache = chuan_(d && d.bgTuy); phat(); return cache }, () => { cache = chuan_(null); phat(); return cache })
}
export function useTuyMau() {
  const [v, setV] = useState(cache)
  useEffect(() => { subs.add(setV); tuyNap(); return () => { subs.delete(setV) } }, [])
  return v || chuan_(null)
}
async function luu_(next) {
  const old = cache
  cache = next; phat()
  try { await api.setProjData('__cty', 'bgTuy', next); return true } catch (e) { cache = old; phat(); toast('Lỗi lưu mẫu tuỳ biến: ' + ((e && e.message) || e)); return false }
}

/* bộ hiện tại của 1 bgCfg (chỉ khoá đã đặt) */
export function tuyChup_(bgCfg) {
  const c = bgCfg || {}; const o = {}
  TUY_KEYS.forEach(k => { if (c[k] != null) o[k] = c[k] })
  return o
}
/* bgCfg dùng để vẽ: khoá Tuỳ biến bản nháp chưa đặt thì lấy mặc định công ty */
/* khoá bgCfg RIÊNG của từng bản nháp - không đưa vào mặc định hệ thống: mục ẩn trên bìa (theo hạng mục của dự án), chiết khấu, ngày báo giá,
   số sửa tay trên bìa, dòng thông tin thêm (giá trị theo dự án), mẫu bìa đang chọn */
export const MD_RIENG = ['an', 'ck', 'ngay', 'tay', 'ttThem', 'biaMau']
export function tuyGop_(bgCfg) {
  const md = cache && cache.macDinh
  if (!md) return bgCfg
  const c = { ...(bgCfg || {}) }
  // mọi khoá đã có trong mặc định (Tuỳ biến + cài đặt khác khi "Lưu làm mặc định hệ thống"), trừ khoá riêng của bản nháp
  Object.keys(md).forEach(k => { if (MD_RIENG.indexOf(k) < 0 && c[k] == null && md[k] != null) c[k] = md[k] })
  return c
}
/* Lưu TOÀN BỘ cài đặt Xuất báo giá đang thấy (tờ bìa, logo, trang chi tiết, cột riêng hạng mục, tuỳ biến, tổng kết, chữ ký...) làm mặc định
   hệ thống (công ty): bản nháp chưa tự đặt khoá nào thì dùng giá trị này. bgCfgDangThay = bgCfg đã gộp mặc định cũ */
export function tuyLuuToanBo(bgCfgDangThay) {
  const c = bgCfgDangThay || {}; const md = {}
  Object.keys(c).forEach(k => { if (MD_RIENG.indexOf(k) < 0 && c[k] != null) md[k] = c[k] })
  return luu_({ ...(cache || chuan_(null)), macDinh: md })
}
/* patch bgOptSetMany để áp 1 bộ: khoá có trong bộ = giá trị đó, khoá còn lại = null (về mặc định công ty / gốc) */
export function tuyPatch_(bo) {
  const m = {}
  TUY_KEYS.forEach(k => { m[k] = bo && bo[k] != null ? bo[k] : null })
  return m
}
/* "Lưu làm mặc định" của Tuỳ biến: chỉ thay phần khoá Tuỳ biến, giữ các khoá khác đã lưu bằng "Lưu làm mặc định hệ thống" */
export const tuyLuuMacDinh = bo => {
  const c = cache || chuan_(null); const md = { ...(c.macDinh || {}) }
  TUY_KEYS.forEach(k => { delete md[k] })
  return luu_({ ...c, macDinh: { ...md, ...bo } })
}
export const tuyLuuNhanh = (i, bo) => { const c = cache || chuan_(null); const n = c.nhanh.slice(); n[i] = bo; return luu_({ ...c, nhanh: n }) }
