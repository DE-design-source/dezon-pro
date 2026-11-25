import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getProjData, setProjData } from '../../QS/api/qsApi'

/* Danh sách chọn nhanh của form khách hàng tiềm năng, lưu chung công ty: dữ liệu '__cty' khoá kdOptions {source: [...], manager: [...]}
   (mục người dùng tự thêm, nối sau danh sách mặc định). Nạp 1 lần, giữ ở cấp module để mọi form dùng chung. */
let opts = {}
let loaded = false
const subs = new Set()
const emit = () => subs.forEach(f => f())
let dirty = {}   // khoá đã sửa trong máy trước khi dữ liệu máy chủ về: giữ bản trong máy, không bị ghi đè
let mkKenh = []  // kênh quảng cáo của tab Marketing (dữ liệu công ty 'mkAds'.kenh) - gợi ý thêm cho "Nguồn khách hàng"
function load_() {
  if (loaded) return
  loaded = true
  getProjData('__cty').then(d => {
    const sv = (d && d.kdOptions) || {}
    const mine = {}; Object.keys(dirty).forEach(k => { mine[k] = opts[k] })
    opts = { ...sv, ...mine }
    mkKenh = d && d.mkAds && Array.isArray(d.mkAds.kenh) ? d.mkAds.kenh.map(x => String(x || '').trim()).filter(Boolean) : []
    emit()
  }, () => { loaded = false })
}
export function useKdOptions(key) {
  useEffect(load_, [])
  const o = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => opts, () => opts)
  return Array.isArray(o[key]) ? o[key] : []
}
/* Kênh quảng cáo của tab Marketing (để nối với Nguồn khách hàng) */
export function useMkChannels() {
  useEffect(load_, [])
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => mkKenh, () => mkKenh)
}
/* Khoá dạng object trong kdOptions (vd rating = {mã lead: số sao 1-5}) */
export function useKdMap(key) {
  useEffect(load_, [])
  const o = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => opts, () => opts)
  return o[key] && typeof o[key] === 'object' && !Array.isArray(o[key]) ? o[key] : {}
}
/* Lưu kdOptions KHÔNG ghi đè thay đổi của người / tab khác (MarkUp 2026-11-25: sao đánh giá bị mất):
   kdOptions là 1 tài liệu chung cả công ty; trước đây mỗi lần lưu gửi nguyên bản trong máy (tải 1 lần lúc mở trang) nên
   lưu từ bản cũ làm mất sao / tỉnh / tên dự án... người khác vừa sửa. Giờ: tải bản mới nhất trên máy chủ, chỉ ghép PHẦN VỪA ĐỔI
   (khoá dạng object {mã khách: giá trị} -> từng mục; mảng chuỗi -> thêm / bớt từng phần tử; còn lại thay cả khoá) rồi mới lưu.
   Các lần lưu xếp hàng lần lượt; khoá còn đang chờ lưu giữ bản trong máy để không nhấp nháy. */
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const isFlatList = v => Array.isArray(v) && v.every(x => x == null || typeof x !== 'object')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function mergeKey(cur, before, after) {
  if (isMap(after) && (before == null || isMap(before)) && (cur == null || isMap(cur))) {
    const m = { ...(cur || {}) }, o = before || {}
    Object.keys(after).forEach(e => { if (!same(after[e], o[e])) m[e] = after[e] })
    Object.keys(o).forEach(e => { if (!(e in after)) delete m[e] })
    return m
  }
  if (isFlatList(after) && (before == null || isFlatList(before)) && (cur == null || isFlatList(cur))) {
    const o = before || [], c = cur || []
    const removed = o.filter(x => after.indexOf(x) < 0)
    const added = after.filter(x => o.indexOf(x) < 0)
    return [...c.filter(x => removed.indexOf(x) < 0), ...added.filter(x => c.indexOf(x) < 0)]
  }
  return after
}
let chain = Promise.resolve()
const pending = {}   // khoá -> số lần lưu đang chờ
export function saveKdOptionsMany(patch) {
  const keys = Object.keys(patch)
  const before = {}
  keys.forEach(k => { before[k] = opts[k]; dirty[k] = 1; pending[k] = (pending[k] || 0) + 1 })
  opts = { ...opts, ...patch }
  emit()
  const run = chain.then(async () => {
    try {
      let sv
      try { const d = await getProjData('__cty'); sv = (d && d.kdOptions) || {} } catch { sv = null }
      const base = sv || opts   // không tải được bản mới nhất -> lưu như cũ
      const next = { ...base }
      keys.forEach(k => { next[k] = sv ? mergeKey(sv[k], before[k], patch[k]) : patch[k] })
      await setProjData('__cty', 'kdOptions', next)
      // bản trong máy = bản vừa lưu; khoá còn lần lưu khác đang chờ thì giữ giá trị trong máy
      const keep = {}
      Object.keys(pending).forEach(k => { if (pending[k] > 1 || (pending[k] === 1 && keys.indexOf(k) < 0)) keep[k] = opts[k] })
      opts = { ...next, ...keep }
      emit()
    } catch (e) {
      alert('Không lưu được lên máy chủ: ' + ((e && e.message) || e))
    } finally {
      keys.forEach(k => { pending[k] -= 1; if (pending[k] <= 0) delete pending[k] })
    }
  })
  chain = run.catch(() => {})
  return run
}
export function saveKdOptions(key, list) { return saveKdOptionsMany({ [key]: list }) }
/* Quay lại tab trình duyệt: tải lại kdOptions để thấy thay đổi của người khác (bỏ qua khi còn lần lưu đang chờ) */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !loaded || Object.keys(pending).length) return
    getProjData('__cty').then(d => {
      if (Object.keys(pending).length) return
      opts = (d && d.kdOptions) || {}
      mkKenh = d && d.mkAds && Array.isArray(d.mkAds.kenh) ? d.mkAds.kenh.map(x => String(x || '').trim()).filter(Boolean) : mkKenh
      emit()
    }, () => {})
  })
}

/* Ô chọn có danh sách xổ: bấm ô = xổ danh sách (base = mục mặc định không xoá được, extra = mục tự thêm của công ty);
   ô gõ trên cùng để lọc, Enter = chọn đúng chữ đã gõ (free) hoặc thêm thành mục mới; nút "Sửa danh sách" = thêm / xoá mục tự thêm.
   Props: value, onChange(v), base [], optKey ('source' | 'manager'), free (cho chọn chữ tự gõ), placeholder,
   linked [] + linkedLabel: nhóm gợi ý lấy từ nơi khác (vd kênh Marketing), chọn được nhưng không xoá ở đây.
   Có linked thì danh sách chia 2 chip: [linkedLabel] | Khác (mục mặc định + mục tự thêm).
   items + onAdd(v) + onRemove(v): danh sách mục tự thêm do nơi gọi tự quản (thay kdOptions[optKey]), vd Trang / Thương hiệu theo kênh nguồn. */
export default function ShortlistSelect({ value, onChange, base, optKey, free, placeholder, linked, linkedLabel, items, onAdd, onRemove }) {
  const optExtra = useKdOptions(optKey)
  const extra = items || optExtra
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState(false)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('linked') // có linked: 'linked' | 'own'
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setEdit(false) } }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])
  const own = [...base, ...extra.filter(x => base.indexOf(x) < 0)]
  const link = (linked || []).filter(x => own.indexOf(x) < 0)
  const all = [...own, ...link]
  const qq = q.trim().toLowerCase()
  const hasTabs = link.length > 0
  const cur = !hasTabs || edit ? 'own' : tab
  const shown = cur === 'own' ? own.filter(x => !qq || x.toLowerCase().indexOf(qq) >= 0) : []
  const shownLink = cur === 'linked' ? link.filter(x => !qq || x.toLowerCase().indexOf(qq) >= 0) : []
  const nOwn = own.filter(x => !qq || x.toLowerCase().indexOf(qq) >= 0).length
  const nLink = link.filter(x => !qq || x.toLowerCase().indexOf(qq) >= 0).length
  const pick = v => { onChange(v); setOpen(false); setEdit(false); setQ('') }
  const add = () => {
    const v = q.trim(); if (!v) return
    if (all.indexOf(v) < 0) { if (onAdd) onAdd(v); else saveKdOptions(optKey, [...extra, v]) }
    setQ('')
    if (!edit) pick(v)
  }
  return (
    <div className="kd-sl" ref={box}>
      <button type="button" className={'kd-sl-btn' + (open ? ' on' : '')} onClick={() => { setOpen(o => !o); setQ(''); setTab(value && own.indexOf(value) >= 0 ? 'own' : 'linked') }}>
        <span className={value ? '' : 'ph'}>{value || placeholder || 'Chọn…'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="kd-sl-pop" onClick={e => e.stopPropagation()}>
          <input autoFocus value={q} placeholder={edit ? 'Gõ mục mới rồi Enter để thêm…' : (free ? 'Gõ để tìm hoặc nhập tên khác…' : 'Gõ để tìm hoặc thêm nguồn mới…')}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const hit = all.find(x => x.toLowerCase() === qq); if (!edit && hit) pick(hit); else add() } if (e.key === 'Escape') setOpen(false) }} />
          {hasTabs && !edit && (
            <div className="kd-sl-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={cur === 'linked'} className={cur === 'linked' ? 'on' : ''} onClick={() => setTab('linked')}>{linkedLabel || 'Gợi ý'}<em>{nLink}</em></button>
              <button type="button" role="tab" aria-selected={cur === 'own'} className={cur === 'own' ? 'on' : ''} onClick={() => setTab('own')}>Khác<em>{nOwn}</em></button>
            </div>
          )}
          <div className="kd-sl-list">
            {shown.map(x => {
              const mine = base.indexOf(x) < 0
              return (
                <div key={x} className={'kd-sl-opt' + (x === value ? ' on' : '')} onClick={() => (edit ? null : pick(x))}>
                  <span>{x}</span>
                  {edit && mine && <button type="button" title={'Xoá "' + x + '" khỏi danh sách'} onClick={() => (onRemove ? onRemove(x) : saveKdOptions(optKey, extra.filter(y => y !== x)))}>×</button>}
                  {!edit && x === value && <em>✓</em>}
                </div>
              )
            })}
            {shownLink.map(x => (
              <div key={'l:' + x} className={'kd-sl-opt linked' + (x === value ? ' on' : '')} onClick={() => pick(x)}>
                <span>{x}</span>{x === value && <em>✓</em>}
              </div>
            ))}
            {q.trim() && all.indexOf(q.trim()) < 0 && (
              <div className="kd-sl-opt add" onClick={add}>+ Thêm "{q.trim()}" vào danh sách</div>
            )}
            {!shown.length && !shownLink.length && <div className="kd-sl-none">{q.trim() ? 'Không có mục trùng trong nhóm này' : 'Chưa có mục nào'}</div>}
          </div>
          <div className="kd-sl-foot">
            <button type="button" className={edit ? 'on' : ''} onClick={() => setEdit(v => !v)}>
              {edit ? 'Xong' : '✎ Sửa danh sách'}
            </button>
            {edit && <span>Mục mặc định không xoá được · lưu chung cho cả công ty</span>}
          </div>
        </div>
      )}
    </div>
  )
}
