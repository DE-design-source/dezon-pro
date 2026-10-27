/* Mô hình thuần của tab Danh sách sản phẩm (không React, không fetch) - port PUB/sanpham.js:160-1130, 1508-1666.
   Biến toàn cục S._sp* của bản gốc thành tham số; spec ngành truyền vào (specs = {VS_SPEC, SON_SPEC, CT_SPEC} hoặc null). */
import { money, tkNum_, spNorm_ } from '../../../lib/format.js'
import { TREE, spNodeCodeOf_ } from '../../../lib/tree.js'
import {
  DB_FLAT, flat_, dbGroupsVs, dbGroupsSon, dbGroupsCt, coSpec_, dbLabelMaps_,
  COL2PROP, SP_NUMCOL, SP_CTCOL, SP_SFX, SP_MONEY, SP_SKIP, SP_COLLBL,
} from '../../../lib/productFields.js'
import { splitVals, spVarKey_, spGroupVariants_ } from '../../../lib/catalogFilters.js'

export { COL2PROP, SP_ALWAYS, SP_MONEY } from '../../../lib/productFields.js'

/* ---------- localStorage (mọi lần đọc / ghi trong try/catch) ---------- */
export function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
export function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch (e) { /* bỏ qua */ } }
export function lsJson(k, def) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v } catch (e) { return def } }

/* sanpham.js:356 / 1476 */
export const spKey_ = p => String((p && (p.recordId || p.ma)) || '')
/* sanpham.js:81 */
export const spPanelHidden_ = () => lsGet('qs_spPanelHide') === '1'
/* qs_fold.cols của boc.js:1221-1223: mặc định gập hàng chip cột */
export function foldCols_() { const v = lsJson('qs_fold', null); return v && typeof v === 'object' ? !!v.cols : true }
export function foldColsToggle_() {
  const v = lsJson('qs_fold', null); const o = v && typeof v === 'object' ? v : { cols: true }
  o.cols = !o.cols; delete o._all; lsSet('qs_fold', JSON.stringify(o)); return o.cols
}

/* ---------- Ngành đang xem + bộ cột (sanpham.js:202-268) ---------- */
export function spNganhCur_(node) {
  const nd = node || ''
  if (nd === '3.2.5') return 'vs'
  if (nd === '3.2.2') return 'son'
  if (nd === '3.2.6.2') return 'ct'
  if (nd === '3.2.6' || nd === '3.2.6.1') return 'den'
  return ''
}
export const spPTMode_ = node => String(node || '') === '3.1'
function flats_(specs) {
  const s = specs || {}
  return {
    vs: s.VS_SPEC ? flat_(dbGroupsVs(s.VS_SPEC)) : [],
    son: s.SON_SPEC ? flat_(dbGroupsSon(s.SON_SPEC)) : [],
    ct: s.CT_SPEC ? flat_(dbGroupsCt(s.CT_SPEC)) : [],
  }
}
export function spColFlat_(ng, specs) {
  const F = flats_(specs)
  if (ng === 'vs') return F.vs
  if (ng === 'son') return F.son
  if (ng === 'ct') return F.ct
  if (ng === 'den') return DB_FLAT
  return DB_FLAT.concat(F.vs).concat(F.son).concat(F.ct)
}
/* Ngành nằm trong 1 hạng mục: hạng mục ngành -> ngành đó; Thiết bị điện (3.2.6) -> đèn + công tắc; Tất cả / 3 / 3.2 -> mọi ngành;
   hạng mục chưa có bộ thông số (Thạch cao, Cửa…) -> rỗng */
const SP_NG_NODE = [['3.2.6.1', 'den'], ['3.2.5', 'vs'], ['3.2.2', 'son'], ['3.2.6.2', 'ct']]
export function spHmNgs_(node) {
  const nd = String(node || '')
  return SP_NG_NODE.filter(x => !nd || x[0] === nd || x[0].indexOf(nd + '.') === 0).map(x => x[1])
}
/* Lọc "Hạng mục SP" (hm) trùng 1 loại của ngành trong hạng mục: ngành đó + thông số của loại (HM[loại].chinh + tk; null = mọi thông số,
   như loại đèn) */
const SPEC_OF = { vs: 'VS_SPEC', son: 'SON_SPEC', ct: 'CT_SPEC' }
function spLoai_(ngs, specs, hm) {
  const n = spNorm_(hm)
  if (!n) return null
  for (const g of ngs) {
    if (g === 'den') {
      const hmDen = (DB_FLAT.find(f => f[0] === 'HẠNG MỤC') || [])[4] || []
      if (hmDen.some(x => spNorm_(x) === n)) return { g, keep: null }
      continue
    }
    const S = specs && specs[SPEC_OF[g]]
    const h = S && (S.HANG_MUC || []).find(x => spNorm_(x) === n)
    if (h && S.HM && S.HM[h]) return { g, keep: [].concat(S.HM[h].chinh || [], S.HM[h].tk || []) }
  }
  return null
}
/* Trường của hạng mục: gộp các ngành bên trong; không có ngành thì chỉ trường chung (có ở mọi ngành đã tải thông số).
   Đang lọc 1 loại sản phẩm (hm) có bộ thông số riêng: trường chung + thông số của loại đó (trường thông số mang dấu 'vs' ở f[6]) */
export function spColFlatHm_(node, specs, hm) {
  const ngs = spHmNgs_(node)
  const loai = spLoai_(ngs, specs, hm)
  if (loai) return spColFlat_(loai.g, specs).filter(f => !loai.keep || f[6] !== 'vs' || loai.keep.indexOf(f[0]) >= 0)
  if (ngs.length) return [].concat(...ngs.map(g => spColFlat_(g, specs)))
  const F = flats_(specs), ds = [F.vs, F.son, F.ct].filter(l => l.length)
  return DB_FLAT.filter(f => ds.every(l => l.some(x => x[0] === f[0])))
}
/* Cột = {k, label, cls, kind, e}. kind: stt|thumb|ten|duyet|sku|gen|giaDaiLy|nguoiTao|ngayTao|nguoiSua.
   e (cột nhập được) = {lark, col, sfx, num, money}. node = hạng mục ('' = mọi cột), hm = lọc "Hạng mục SP" (loại sản phẩm) */
export function spAllCols_(node, specs, hm) {
  const L2C = dbLabelMaps_(specs).DB_LABEL2COL_
  const head = [
    { k: 'stt', label: 'STT', cls: 'ct', kind: 'stt' },
    { k: 'thumb', label: 'Ảnh', cls: 'thumbcol', kind: 'thumb' },
    { k: 'ten', label: 'Sản phẩm', cls: 'sp-name', kind: 'ten', e: { lark: 'TÊN SẢN PHẨM', col: 'ten_sp', sfx: '' } },
    { k: 'duyet', label: 'Trạng thái', cls: 'ct', kind: 'duyet' },
    { k: 'sku', label: 'Số SKU', cls: 'ct', kind: 'sku' },
  ]
  const tail = [
    { k: 'giaDaiLy', label: 'Giá đại lý', cls: 'num sp-price', kind: 'giaDaiLy' },
    { k: 'nguoiTao', label: 'Người tạo', cls: '', kind: 'nguoiTao' },
    { k: 'ngayTao', label: 'Ngày tạo', cls: 'ct', kind: 'ngayTao' },
    { k: 'nguoiSua', label: 'Người sửa cuối', cls: '', kind: 'nguoiSua' },
  ]
  const gen = [], daCo = {}
  spColFlatHm_(node, specs, hm).forEach(f => {
    if (daCo[f[0]]) return; daCo[f[0]] = 1
    const lark = f[0]; if (SP_SKIP[lark]) return
    const col = L2C[lark]; if (!col) return
    const e = { lark, col, sfx: SP_SFX[col] || '', num: !!SP_NUMCOL[col], money: !!SP_MONEY[col] }
    const cls = SP_NUMCOL[col] ? 'num' : (SP_CTCOL[col] ? 'ct' : '')
    gen.push({ k: col, label: SP_COLLBL[col] || f[1], cls, kind: 'gen', e })
  })
  return head.concat(gen).concat(tail)
}

/* ---------- Giá trị ô (sanpham.js:181-187) ---------- */
export function spColVal_(p, col) {
  const prop = COL2PROP[col]
  const v = (prop && p[prop] != null && p[prop] !== '') ? p[prop] : (p.raw || {})[col]
  return v == null ? '' : String(v)
}
export function spEditRaw_(p, col) { const r = p.raw || {}; return r[col] != null ? String(r[col]) : spColVal_(p, col) }

/* Số SKU = số SP cùng mã (sanpham.js:191-197); skuMap dựng 1 lần cho mỗi danh mục */
export function spSkuMap_(products) {
  const m = {}
  ;(products || []).forEach(x => { const k = String(x.ma || '').trim().toLowerCase(); if (k) m[k] = (m[k] || 0) + 1 })
  return m
}
export function spSkuCount_(map, p) { const k = String(p.ma || '').trim().toLowerCase(); return k ? (map[k] || 1) : 1 }

/* ---------- Đơn vị hiển thị (sanpham.js:270-273, 602-614) ---------- */
function spUnitRe_(u) { return new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
export function spAddUnit_(v, u) {
  const t = String(v == null ? '' : v).trim(); if (!u || !t) return t; const re = spUnitRe_(u)
  return t.split(',').map(x => { x = x.trim(); return x ? (re.test(x) ? x : x + u) : '' }).filter(Boolean).join(', ')
}
const SP_DISPUNIT = { cong_suat_w: 'W', nhiet_do_mau_k: 'K', goc_chieu_deg: '°', goc_nghieng_deg: '°' }
/* Bản sao SP sau khi sửa 1 ô (spPatchLocal_ - bản gốc sửa tại chỗ, ở đây trả object mới) */
export function spPatchLocal_(p0, lark, col, v) {
  const p = { ...p0 }
  if (col) { p.raw = { ...(p0.raw || {}) }; p.raw[col] = v }
  const prop = COL2PROP[col]
  if (prop) p[prop] = SP_DISPUNIT[col] ? spAddUnit_(v, SP_DISPUNIT[col]) : v
  if (col === 'ten_sp') p.ten = v
  else if (col === 'ma_sp') p.ma = v
  else if (col === 'gia_ban_le') p.giaBanLe = tkNum_(v)
  else if (col === 'ck_dai_ly_pct') p.ckDaiLy = tkNum_(v)
  // GIÁ ĐẠI LÝ là cột generated trong DB: round(giá bán lẻ × (1 − CK/100))
  p.donGiaBan = Math.round((Number(p.giaBanLe) || 0) * (1 - (Number(p.ckDaiLy) || 0) / 100))
  p.donGiaVon = p.donGiaBan
  return p
}

/* sanpham.js:1988-1993 */
export function fmtDateTime_(v) {
  if (v == null || v === '') return '—'
  const d = new Date(v); if (isNaN(d.getTime())) return String(v)
  const z = n => (n < 10 ? '0' : '') + n
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + z(d.getHours()) + ':' + z(d.getMinutes())
}

/* ---------- Bộ cột hiện / thứ tự / độ rộng (sanpham.js:711-767) ---------- */
export const SP_DEFW = { stt: 52, thumb: 56, ten: 215, duyet: 124, sku: 78, giaDaiLy: 122, nguoiTao: 126, ngayTao: 104, nguoiSua: 130, gia_ban_bo_nguon: 130,
  thuong_hieu: 126, nha_cung_cap: 170, hang_muc: 130, dong_sp: 130, nhom_sp: 130,
  gia_ban_le: 118, ck_dai_ly_pct: 106, cong_suat_w: 96, nhiet_do_mau_k: 112, goc_chieu_deg: 96,
  goc_nghieng_deg: 106, mau_sac: 106, chat_lieu: 126, chieu_cao_mm: 98, duong_kinh_mm: 104,
  quang_thong_lm: 110, chi_so_ip: 98, cri: 88, hieu_suat_lm_w: 126, ugr: 80, sdcm: 80, coi: 80,
  tuoi_tho: 104, ten_chip_led: 126, loai_chip_led: 110, lap_nguon_roi: 108, ten_bo_nguon: 134,
  ma_bo_nguon: 120, hang_bo_nguon: 134, vi_tri_lap_nguon: 134, dieu_khien: 140,
  dong_ra_max_ma: 116, cutout_mm: 134, class_rating: 116, bao_hanh_nam: 104, dvt: 88,
  trang_thai: 126, link_datasheet: 112, ghi_chu: 170 }
export const spColW_ = (w, k) => (w && w[k]) || SP_DEFW[k] || 124
export function spColsDefault_(ng) {
  const b = { thumb: 1, ten: 1, duyet: 1, sku: 1, thuong_hieu: 1, hang_muc: 1, giaDaiLy: 1 }
  if (ng === 'vs') { b.kich_thuoc = 1; b.mau_sac = 1; b.kieu_lap_dat = 1; b.he_thong_xa = 1; return b }
  if (ng === 'ct') { b.thanh_phan = 1; b.mau_sac = 1; b.dong_dm_a = 1; b.kieu_lap_dat = 1; return b }
  if (ng === 'son') { b.mau_sac = 1; b.be_mat = 1; b.do_phu = 1; b.kich_thuoc = 1; return b }
  b.cong_suat_w = 1; b.nhiet_do_mau_k = 1; b.cri = 1; b.goc_chieu_deg = 1; return b
}
/* Ngành của BỘ CỘT: '' (chưa lọc) và ngành lạ dùng bộ cột đèn (spColsSync_) */
export const spColsNg_ = ng => (coSpec_(ng) ? ng : 'den')
const ON_KEY = { vs: 'onVs', son: 'onSon', ct: 'onCt' }
/* Khoá hạng mục của bộ cột: mã hạng mục, '*' = Tất cả hạng mục. Cột đang hiện, bộ tự đặt tên, nút nhanh đều tách theo khoá này */
export const spColScope_ = node => String(node || '') || '*'
/* sc: cột đã lưu của hạng mục (byNode); hạng mục chưa lưu lần nào thì dùng bộ theo ngành như trước */
export function spColsLoad_(ngCols, sc) {
  const j = lsJson('qs_spcolcfg', {}) || {}
  const theoHm = sc && j.byNode && j.byNode[sc]
  if (theoHm && Object.keys(theoHm).length) return theoHm
  const luu = j[ON_KEY[ngCols] || 'on']
  return (luu && Object.keys(luu).length) ? luu : spColsDefault_(ngCols)
}
export function spCfgLoad_() { const j = lsJson('qs_spcolcfg', {}) || {}; return { order: j.order || null, w: j.w || {} } }
/* spSaveCols_: on = bộ cột THẬT của người dùng (đang Edit thì là bản lưu trước khi bật hết); có sc thì lưu riêng cho hạng mục đó */
export function spCfgSave_(order, w, ngCols, on, sc) {
  const j = lsJson('qs_spcolcfg', {}) || {}
  j.order = order; j.w = w || {}
  if (sc) j.byNode = { ...(j.byNode || {}), [sc]: on || {} }
  else j[ON_KEY[ngCols] || 'on'] = on || {}
  lsSet('qs_spcolcfg', JSON.stringify(j))
}
/* Nút nhanh (1)(2) theo hạng mục: {[khoá hạng mục]: [id, id]}; bản cũ lưu 1 mảng chung -> coi như của "Tất cả hạng mục" */
export function spQuickLoad_(key) {
  const v = lsJson(key, null)
  return Array.isArray(v) ? { '*': v } : (v && typeof v === 'object' ? v : {})
}
/* spOrder_: thứ tự đã lưu + cột mới (stt lên đầu, cột khác nối cuối), bỏ cột không còn */
export function spOrder_(saved, cols) {
  const all = cols.map(c => c.k)
  const o = (saved || all).slice()
  const co = {}; o.forEach(k => { co[k] = 1 })
  all.forEach(k => { if (!co[k]) { if (k === 'stt') o.unshift(k); else o.push(k) } })
  return o.filter(k => all.indexOf(k) >= 0)
}
export const spColOn_ = (on, k) => (k === 'ten' || k === 'stt') ? true : !!(on && on[k])
export function spColList_(cols, order) { const by = {}; cols.forEach(c => { by[c.k] = c }); return order.map(k => by[k]).filter(Boolean) }
export function spVisCols_(cols, order, on) { return spColList_(cols, order).filter(c => spColOn_(on, c.k)) }
export const SP_COL_CB = ['thumb', 'duyet', 'thuong_hieu', 'giaDaiLy']
/* COLSET.sp (app.js:1660-1666): keys = cột trừ stt/ten, mặc định theo ngành */
export function spColset_(list, ngCols) {
  return {
    ten: 'Danh sách SP', pref: 'spCols', luon: 'ten',
    keys: () => list.map(c => c.k).filter(k => k !== 'stt' && k !== 'ten'),
    macdinh: () => Object.keys(spColsDefault_(ngCols)).filter(k => k !== 'ten'),
  }
}
export function spMoveCol_(order, from, to, before) {
  const o = order.slice(), fi = o.indexOf(from); if (fi < 0) return o
  o.splice(fi, 1); let ti = o.indexOf(to); if (ti < 0) ti = o.length
  o.splice(before ? ti : ti + 1, 0, from)
  return o
}

/* ---------- Phân trang (sanpham.js:672-688) ---------- */
export const SP_PER = [25, 50, 100, 200, 0]
export function spPerGet_() { const v = lsGet('qs_spPer'); return (v === null || v === '') ? 50 : Number(v) }
export function spPageNums_(cur, pages) {
  const out = [], add = x => { if (out[out.length - 1] !== x) out.push(x) }
  add(1)
  for (let i = cur - 2; i <= cur + 2; i++) if (i > 1 && i < pages) { if (i > 2 && out[out.length - 1] === 1 && i - 1 > 1) add('…'); add(i) }
  if (pages > 1) { if (out[out.length - 1] !== '…' && out[out.length - 1] < pages - 1) add('…'); add(pages) }
  return out
}

/* ---------- Hạng mục + lọc (sanpham.js:960-1058, 1508-1535) ---------- */
export function spNodeCount_(products, code) {
  if (!code) return (products || []).length
  return (products || []).filter(p => { const c = spNodeCodeOf_(p); return c === code || c.indexOf(code + '.') === 0 }).length
}
export const SP_TREE = TREE.filter(t => t[0] !== 'X')
export function spScopeProducts_(products, node) {
  if (!node) return products || []
  return (products || []).filter(p => { const c = spNodeCodeOf_(p); return c === node || c.indexOf(node + '.') === 0 })
}
export function spOptList_(scope, field) {
  const m = {}; scope.forEach(p => { if (p[field]) m[spNorm_(p[field])] = p[field] })
  return Object.keys(m).sort((a, b) => m[a].localeCompare(m[b], 'vi')).map(k => m[k])
}
export function spSingleVals_(scope, field) { const m = {}; scope.forEach(p => { if (p[field]) m[p[field]] = (m[p[field]] || 0) + 1 }); return m }
export function spSpecOpts_(scope, field) { const m = {}; scope.forEach(p => { splitVals(p[field]).forEach(v => { m[v] = (m[v] || 0) + 1 }) }); return m }
export const actKeys_ = o => Object.keys(o || {}).filter(k => o[k])
export const SP_FLT_EMPTY = () => ({ watt: {}, kelvin: {}, angle: {}, cri: {}, brands: {}, nccs: {} })
export function spFltCount_(f) {
  f = f || {}; let n = 0; if (f.min) n++; if (f.max) n++
  ;['watt', 'kelvin', 'angle', 'cri', 'brands', 'nccs'].forEach(g => { n += actKeys_(f[g]).length })
  return n
}
export const spAnyFilter_ = f => !!(f.brand || f.hangMuc || f.dong || spFltCount_(f))

/* Sắp theo cột: tăng -> giảm -> bỏ (spSort, spSapXep_) */
export function spSortNext_(sort, k) {
  if (sort.k !== k) return { k, dir: 'asc' }
  if (sort.dir === 'asc') return { k, dir: 'desc' }
  return { k: '', dir: 'asc' }
}
export function spSapXep_(list, sort, cols) {
  const k = sort.k; if (!k) return list
  const def = cols.filter(c => c.k === k)[0], col = def && def.e && def.e.col, d = sort.dir === 'desc' ? -1 : 1
  function v(p) {
    let x = (col && p.raw && p.raw[col] != null) ? p.raw[col] : p[k]; if (k === 'giaDaiLy') x = p.giaDaiLy != null ? p.giaDaiLy : p.donGiaBan
    if (typeof x === 'number') return x; const n = String(x == null ? '' : x).trim(); return /^-?[\d.,]+$/.test(n) ? tkNum_(n) : n
  }
  return list.slice().sort((a, b) => {
    const x = v(a), y = v(b)
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * d
    if (x === '') return 1; if (y === '') return -1
    return String(x).localeCompare(String(y), 'vi', { numeric: true }) * d
  })
}
/* spDataList_ (nhánh sản phẩm) */
export function spDataList_(products, q, f, view, sort, cols) {
  q = String(q || '').toLowerCase().trim(); f = f || {}
  const watts = actKeys_(f.watt), kels = actKeys_(f.kelvin), angs = actKeys_(f.angle), cris = actKeys_(f.cri)
  const mn = Number(f.min) || 0, mx = Number(f.max) || 0
  const bk = actKeys_(f.brands), nk = actKeys_(f.nccs)
  const list = (products || []).filter(p => {
    if (q && (p.ten + ' ' + p.ma + ' ' + p.thuongHieu + ' ' + p.ncc).toLowerCase().indexOf(q) < 0) return false
    if (f.node) { const c = spNodeCodeOf_(p); if (!(c === f.node || c.indexOf(f.node + '.') === 0)) return false }
    if (f.dong && spNorm_(p.nhom) !== spNorm_(f.dong)) return false
    if (view === 'fav' && !p.yeuThich) return false
    if (view === 'chua' && p.daDuyet) return false
    if (view === 'da' && !p.daDuyet) return false
    if (f.brand && spNorm_(p.thuongHieu) !== spNorm_(f.brand)) return false
    if (bk.length && bk.indexOf(String(p.thuongHieu || '')) < 0) return false
    if (nk.length && nk.indexOf(String(p.ncc || '')) < 0) return false
    if (f.hangMuc && spNorm_(p.hangMuc) !== spNorm_(f.hangMuc)) return false
    const pr = Number(p.donGiaBan) || 0; if (mn && pr < mn) return false; if (mx && pr > mx) return false
    if (watts.length) { const pw = splitVals(p.congSuat); if (!pw.some(x => watts.indexOf(x) >= 0)) return false }
    if (kels.length) { const pk = splitVals(p.nhietDo); if (!pk.some(x => kels.indexOf(x) >= 0)) return false }
    if (angs.length) { const pa = splitVals(p.gocChieu); if (!pa.some(x => angs.indexOf(x) >= 0)) return false }
    if (cris.length) { const pc = splitVals(p.cri); if (!pc.some(x => cris.indexOf(x) >= 0)) return false }
    return true
  })
  return spGroupVariants_(spSapXep_(list, sort, cols))
}
/* spVarGroups2_: mỗi nhóm biến thể = 1 dòng đại diện + các dòng con */
export function spVarGroups2_(list) {
  const out = [], at = {}
  ;(list || []).forEach(p => {
    const k = spVarKey_(p)
    if (k && at[k] != null) { out[at[k]].kids.push(p); return }
    if (k) at[k] = out.length
    out.push({ key: k, head: p, kids: [] })
  })
  return out
}
export function spNhomBienThe_(products, p) {
  const k = spVarKey_(p); if (!k) return [p]
  const ds = (products || []).filter(x => spVarKey_(x) === k)
  return ds.length ? ds : [p]
}

/* Dòng của trang hiện tại (phần giữa của spFilter): mỗi dòng {p, m:{k:''|'cb'|'note'|'sum', no, sl, t, n, tong}, kid, bt}
   bt = {key, n, mo, mau} cho dòng đại diện có biến thể. cbOpen/cbData theo catCbKey_ = spKey_;
   cbData[k] = mảng SP đi kèm | undefined (đang tải) | {err} (tải lỗi). */
export function spPageRows_(groups, page, per, btOpen, cbOpen, cbData) {
  const pages = per ? Math.max(1, Math.ceil(groups.length / per)) : 1
  const cur = Math.min(Math.max(1, page || 1), pages)
  const pageG = per ? groups.slice((cur - 1) * per, cur * per) : groups
  const no0 = per ? (cur - 1) * per : 0
  const base = []
  pageG.forEach((g, gi) => {
    const n = g.kids.length + 1, mo = !!btOpen[g.key], so = String(no0 + gi + 1)
    base.push({ p: g.head, no: so, kid: false, bt: n > 1 ? { key: g.key, n, mo, mau: spMauNhom_([g.head].concat(g.kids)) } : null })
    if (mo) g.kids.forEach((x, ki) => base.push({ p: x, no: so + '.' + (ki + 1), kid: true, bt: null }))
  })
  const rows = []
  base.forEach(b => {
    rows.push({ p: b.p, m: { k: '', no: b.no }, kid: b.kid, bt: b.bt })
    const ck = spKey_(b.p)
    if (!cbOpen[ck]) return
    const ds = cbData[ck]
    if (!ds) { rows.push({ p: b.p, m: { k: 'note', t: 'Đang tải sản phẩm đi kèm…' } }); return }
    // bản gốc coi lỗi như "không có" ([]); ở đây báo rõ lỗi
    if (ds.err) { rows.push({ p: b.p, m: { k: 'note', t: 'Không tải được sản phẩm đi kèm: ' + ds.err } }); return }
    if (!ds.length) { rows.push({ p: b.p, m: { k: 'note', t: 'Không có sản phẩm đi kèm.' } }); return }
    let tong = 0
    ds.forEach((x, ci) => {
      const sl = Number(x.comboSL) || 1
      tong += (Number(x.donGiaBan) || 0) * sl
      rows.push({ p: x, m: { k: 'cb', sl, no: b.no + '.' + (ci + 1) }, kid: false, bt: null })
    })
    rows.push({ p: b.p, m: { k: 'sum', n: ds.length, tong } })
  })
  return { rows, pages, cur }
}
/* spSelProds_: SP đã tick VÀ đang khớp lọc (dòng trang + toàn bộ danh sách lọc), bỏ trùng */
export function spSelProds_(sel, rows, full) {
  const out = [], seen = {}
  rows.map(r => r.p).concat(full || []).forEach(p => {
    const k = spKey_(p); if (!sel[k] || seen[k]) return
    seen[k] = 1; out.push(p)
  })
  return out
}

/* ---------- Biến thể màu (sanpham.js:2181-2200) ---------- */
const SP_MAU_CSS = [['trong suot', 'transparent'], ['xanh duong', '#1a73e8'], ['xanh nuoc bien', '#1a73e8'], ['xanh la', '#34a853'], ['xanh luc', '#34a853'],
  ['xanh ngoc', '#26a69a'], ['xanh reu', '#5d7b4f'], ['xanh', '#4285f4'], ['trang', '#ffffff'], ['den', '#202124'], ['xam', '#9aa0a6'], ['ghi', '#9aa0a6'],
  ['bac', '#c0c0c0'], ['kem', '#f3e5c0'], ['be', '#e8d5b0'], ['vang dong', '#d4af37'], ['vang', '#f2c200'], ['cam', '#f08a00'], ['do', '#d93025'],
  ['hong', '#f48fb1'], ['tim', '#8e44ad'], ['nau', '#8d6e63'], ['go', '#a1887f'], ['dong', '#b87333'], ['gold', '#d4af37']]
export function spMauCss_(ten) {
  const t = String(ten || '').trim(), hex = t.match(/#[0-9a-f]{3,6}\b/i); if (hex) return hex[0]
  const k = ' ' + t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ') + ' '
  for (let i = 0; i < SP_MAU_CSS.length; i++) if (k.indexOf(' ' + SP_MAU_CSS[i][0] + ' ') >= 0) return SP_MAU_CSS[i][1]
  return ''
}
export function spMauNhom_(list) {
  const seen = {}, out = []
  list.forEach(p => { const m = String(p.mauSac || '').trim(); if (m && !seen[spNorm_(m)]) { seen[spNorm_(m)] = 1; out.push(m) } })
  return out
}

/* ---------- Sửa hàng loạt: danh sách trường (sanpham.js:1674-1688) ---------- */
const SP_BULK_TOP = ['CHIẾT KHẤU ĐẠI LÝ (%)', 'GIÁ BÁN LẺ', 'THƯƠNG HIỆU', 'NHÀ CUNG CẤP', 'HẠNG MỤC',
  'DÒNG SẢN PHẨM', 'BẢO HÀNH (năm)', 'TRẠNG THÁI', 'ĐƠN VỊ TÍNH']
const SP_BULK_BO = { 'TÊN SẢN PHẨM': 1, 'MÃ SẢN PHẨM': 1, 'GIÁ ĐẠI LÝ': 1, 'ẢNH SẢN PHẨM': 1 }
export function spBulkFields_(ng, specs) {
  const L2C = dbLabelMaps_(specs).DB_LABEL2COL_
  const nhan = {}; spColFlat_(ng, specs).forEach(f => { if (!nhan[f[0]]) nhan[f[0]] = f[1] })
  const out = []
  SP_BULK_TOP.forEach(lb => { if (!SP_BULK_BO[lb]) out.push([lb, nhan[lb] || lb]) })
  Object.keys(nhan).forEach(lb => {
    if (SP_BULK_BO[lb] || SP_BULK_TOP.indexOf(lb) >= 0) return
    if (!L2C[lb]) return
    out.push([lb, nhan[lb]])
  })
  return out
}
export const spLabel2Col_ = (specs, lark) => dbLabelMaps_(specs).DB_LABEL2COL_[lark] || ''

/* Tiền hiển thị trong ô nhập (930000 -> 930.000) */
export const spMoneyShow_ = v => (v === '' ? '' : money(v))
