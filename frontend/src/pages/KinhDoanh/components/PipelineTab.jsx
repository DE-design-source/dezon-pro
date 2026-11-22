import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { STAGES, STAGE_LABEL, DEPT_COLOR, DEPT_SHORT, DEPT_TINT } from '../../../data/kinhDoanhData'
import { fmtTy, stageAccent, sourceColor, noDau, duplicateIndex, phoneNorms } from '../utils'
import { useKdMap, saveKdOptions } from './ShortlistSelect'
import { RatingStars } from './CustomerPage'
import { listStaff } from '../api'

/* Bộ lọc theo đánh giá tiềm năng (sao, kdOptions.rating): nút xổ danh sách, tích chọn nhiều mức 0..5 sao (0 = chưa đánh giá);
   không tích mức nào = tất cả */
const STAR_FLT = [5, 4, 3, 2, 1, 0]
const StarIc = ({ on }) => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ color: on ? '#F5A524' : 'var(--border)' }}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
/* sortOn / onSort: nút ưu tiên sắp xếp 5 sao trước -> 1 sao -> chưa đánh giá (MarkUp 2026-11-16 17:44) */
function StarFilter({ value, onChange, count, sortOn, onSort, iconOnly }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])
  const toggle = n => onChange(value.indexOf(n) >= 0 ? value.filter(x => x !== n) : [...value, n])
  const label = !value.length ? 'Tất cả sao' : value.slice().sort((a, b) => b - a).map(n => (n ? n + '★' : 'Chưa đánh giá')).join(', ')
  return (
    <div className="kd-pl-sdd" ref={box}>
      <button type="button" className={'kd-pl-sbtn' + (iconOnly ? ' ic' : '') + (value.length ? ' on' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open}
        title={'Sao: ' + label} aria-label={'Sao: ' + label}>
        <StarIc on />{!iconOnly && <span>{label}</span>}
        {!iconOnly && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>}
      </button>
      {open && (
        <div className="kd-pl-spop">
          {STAR_FLT.map(n => (
            <label key={n} className={value.indexOf(n) >= 0 ? 'on' : ''}>
              <input type="checkbox" checked={value.indexOf(n) >= 0} onChange={() => toggle(n)} />
              <span className="st">{n ? [1, 2, 3, 4, 5].map(i => <StarIc key={i} on={i <= n} />) : <em>Chưa đánh giá</em>}</span>
              <i>{count(n)}</i>
            </label>
          ))}
          <button type="button" className={'kd-pl-ssort' + (sortOn ? ' on' : '')} aria-pressed={!!sortOn} onClick={() => onSort(!sortOn)}
            title="Xếp khách trong mỗi cột theo số sao: 5 sao trước, chưa đánh giá cuối">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h13M3 12h9M3 18h5M18 4v16M15 17l3 3 3-3" /></svg>
            <span>Ưu tiên 5 sao trước → 1 sao</span>
            <i className="sw" aria-hidden="true" />
          </button>
          <div className="ft">
            <button type="button" onClick={() => onChange([])} disabled={!value.length}>Bỏ lọc</button>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
/* Bộ lọc chọn nhiều (Nguồn, Nhân sự phụ trách - MarkUp 2026-11-16 17:42): cùng kiểu nút + hộp tích của bộ lọc sao, có ô tìm.
   options [{v, label, n}]; value [] = tất cả */
const NONE = '__none__'
function MultiFilter({ icon, allLabel, options, value, onChange, iconOnly }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])
  const toggle = v => onChange(value.indexOf(v) >= 0 ? value.filter(x => x !== v) : [...value, v])
  const lbl = v => (options.find(o => o.v === v) || { label: v }).label
  const label = !value.length ? allLabel : value.map(lbl).join(', ')
  const t = noDau(q)
  const shown = options.filter(o => !t || noDau(o.label).indexOf(t) >= 0)
  return (
    <div className="kd-pl-sdd" ref={box}>
      <button type="button" className={'kd-pl-sbtn' + (iconOnly ? ' ic' : '') + (value.length ? ' on' : '')} onClick={() => { setOpen(o => !o); setQ('') }} aria-expanded={open}
        title={label} aria-label={label}>
        {icon}{!iconOnly && <span>{label}</span>}
        {!iconOnly && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>}
      </button>
      {open && (
        <div className="kd-pl-spop">
          {options.length > 6 && <input className="q" autoFocus value={q} placeholder="Gõ để tìm…" onChange={e => setQ(e.target.value)} />}
          <div className="ls">
            {shown.length ? shown.map(o => (
              <label key={o.v} className={value.indexOf(o.v) >= 0 ? 'on' : ''}>
                <input type="checkbox" checked={value.indexOf(o.v) >= 0} onChange={() => toggle(o.v)} />
                <span className="st nm">{o.v === NONE ? <em>{o.label}</em> : o.label}</span>
                <i>{o.n}</i>
              </label>
            )) : <p className="none">Không thấy "{q}"</p>}
          </div>
          <div className="ft">
            <button type="button" onClick={() => onChange([])} disabled={!value.length}>Bỏ lọc</button>
            <button type="button" className="pri" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
const ADMIN_KD = 'Admin Kinh doanh'
const srcKey = l => String(l.source || '').trim() || NONE
const rawStaffOf = l => [...new Set((l.assignees || []).filter(a => a && a.name && a.role !== ADMIN_KD).map(a => String(a.name).trim()).filter(Boolean))]
function optsOf(list, keysOf, noneLabel) {
  const m = new Map()
  list.forEach(l => { const ks = keysOf(l); (ks.length ? ks : [NONE]).forEach(k => m.set(k, (m.get(k) || 0) + 1)) })
  return [...m.entries()].map(([v, n]) => ({ v, n, label: v === NONE ? noneLabel : v }))
    .sort((a, b) => (a.v === NONE) - (b.v === NONE) || b.n - a.n || a.label.localeCompare(b.label, 'vi'))
}
/* Bộ lọc Giai đoạn / Giá trị (MarkUp 2026-11-16 18:01). Giá trị lead tính bằng tỷ (l.value) */
const VAL_BANDS = [
  ['0', 'Chưa có giá trị', v => !(v > 0)],
  ['lt1', 'Dưới 1 tỷ', v => v > 0 && v < 1],
  ['1-3', '1 - 3 tỷ', v => v >= 1 && v < 3],
  ['3-5', '3 - 5 tỷ', v => v >= 3 && v < 5],
  ['5-10', '5 - 10 tỷ', v => v >= 5 && v < 10],
  ['gt10', 'Từ 10 tỷ', v => v >= 10],
]
const bandOf = l => { const v = Number(l.value) || 0; const b = VAL_BANDS.find(x => x[2](v)); return b ? b[0] : '0' }
import { DeptFilter, TimeFilter } from './Filters'
import LeadCard from './LeadCard'

/* ===================== Tab Pipeline khách hàng (Kanban + Danh sách) ===================== */

/* STT | Lead | Nguồn | Loại dự án | Địa chỉ | Sao | Phòng ban | Giá trị | Giai đoạn | Ngày tạo | Chuyển tới | Sửa */
const LIST_COLS = '36px minmax(0,1.5fr) minmax(0,1fr) minmax(0,.95fr) minmax(0,1.4fr) 92px minmax(0,.75fr) minmax(0,.7fr) minmax(0,1.1fr) 82px minmax(0,1fr) 34px'
/* Cột bấm được để sắp xếp: [khoá, nhãn, chiều mặc định]; khoá null = không sắp xếp */
const LIST_HEAD = [
  [null, 'STT'], ['name', 'Lead khách hàng', 1], ['source', 'Nguồn', 1], ['type', 'Loại dự án', 1], ['addr', 'Địa chỉ', 1],
  ['star', 'Sao', -1], ['dept', 'Phòng ban', 1], ['value', 'Giá trị', -1], ['stage', 'Giai đoạn', 1], ['created', 'Ngày tạo', -1], [null, 'Chuyển tới'], [null, ''],
]
/* Lọc "Phòng KD Dự Án" (MarkUp 2026-11-19): Chủ đầu tư là cột đầu tiên (sau STT), rồi Người phụ trách (= tên khách), Chức vụ,
   Phòng ban phụ trách - đều là người bên CĐT (kdOptions.cdtContact); bỏ cột Phòng ban (KD) vì mọi dòng đều là Dự án */
const LIST_COLS_DA = '36px minmax(0,1.15fr) minmax(0,1.35fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,.95fr) minmax(0,.85fr) minmax(0,1.2fr) 92px minmax(0,.7fr) minmax(0,1.1fr) 82px minmax(0,1fr) 34px'
const LIST_HEAD_DA = [
  [null, 'STT'], ['investor', 'Chủ đầu tư', 1], ['name', 'Người phụ trách', 1], ['cdtRole', 'Chức vụ', 1], ['cdtDept', 'Phòng ban phụ trách', 1],
  ['source', 'Nguồn', 1], ['type', 'Loại dự án', 1], ['addr', 'Địa chỉ', 1],
  ['star', 'Sao', -1], ['value', 'Giá trị', -1], ['stage', 'Giai đoạn', 1], ['created', 'Ngày tạo', -1], [null, 'Chuyển tới'], [null, ''],
]
const cellTxt = { fontSize: 12.5, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }
const cellLine = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const SORT_LS = 'kd-list-sort'
const readSort = () => { try { const v = JSON.parse(localStorage.getItem(SORT_LS) || 'null'); if (v && v.key) return v } catch { /* bỏ qua */ } return { key: 'care', dir: 1 } }
const fmtDay = iso => (iso ? iso.split('-').reverse().join('/') : '')
/* Ô tìm nhanh: tên, SĐT (bỏ dấu cách / chấm), email, địa chỉ, tỉnh, nguồn, tên dự án, người tạo */
function matchQuery(l, q, extra) {
  if (!q) return true
  const t = noDau(q)
  const hay = noDau([l.name, l.email, l.address, l.source, l.projectType, l.creator, l.manager, extra].filter(Boolean).join(' | '))
  if (hay.indexOf(t) >= 0) return true
  /* SĐT: so trên dạng chuẩn đầu 0 (+84 903... = 0903...), gõ 1 phần số cũng ra */
  let dq = q.replace(/\D/g, '')
  if (/^\s*\+?84/.test(q) && dq.length > 3) dq = '0' + dq.slice(2)
  return dq.length >= 3 && phoneNorms(l.phone).some(n => n.indexOf(dq) >= 0)
}
const SortIc = ({ dir }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', opacity: dir ? 1 : 0.35 }}>
    {dir === 1 ? <path d="m6 15 6-6 6 6" /> : dir === -1 ? <path d="m6 9 6 6 6-6" /> : <path d="m7 10 5-5 5 5M7 14l5 5 5-5" />}
  </svg>
)
const viewBtnStyle = active => ({
  border: 'none', cursor: 'pointer', padding: '7px 13px', fontSize: 12.5, fontWeight: 600,
  background: active ? 'var(--sales-tint)' : 'none', color: active ? 'var(--sales)' : 'var(--text-muted)', fontFamily: 'inherit',
})

export default function PipelineTab({ leads: leadsIn, allLeads, dept, onDeptChange, timeFilter, onTimeFilterChange, scrollRef, onMove, onDelete, onOpenDetail, onEdit, onAddAssignee, onRemoveAssignee }) {
  const [view, setView] = useState('kanban')
  /* Tìm nhanh khách hàng (SĐT, tên...) - áp cho cả Kanban và Danh sách */
  const [q, setQ] = useState('')
  const geoMap = useKdMap('geo')
  const projNameMap = useKdMap('projName')
  const tinhOf = l => { const g = geoMap[String(l.id)] || {}; return g.tinh || g.kv || '' }
  const addrOf = l => {
    const a = String(l.address || '').trim(), t = tinhOf(l)
    return a && t && noDau(a).indexOf(noDau(t)) < 0 ? a + ', ' + t : (a || t)
  }
  const investorMap = useKdMap('investor')
  const investorOf = l => String(investorMap[String(l.id)] || '').trim()
  const isDA = dept === 'du-an'
  const LIST_COLS_V = isDA ? LIST_COLS_DA : LIST_COLS
  const LIST_HEAD_V = isDA ? LIST_HEAD_DA : LIST_HEAD
  /* Chức vụ / Phòng ban của người phụ trách bên CĐT */
  const cdtMap = useKdMap('cdtContact')
  const cdtOf = l => { const c = cdtMap[String(l.id)] || {}; return { role: String(c.role || '').trim(), dept: String(c.dept || '').trim() } }
  const qt = q.trim()
  const leadsQ = qt ? leadsIn.filter(l => matchQuery(l, qt, [tinhOf(l), projNameMap[String(l.id)], investorOf(l), cdtOf(l).role, cdtOf(l).dept].filter(Boolean).join(' '))) : leadsIn
  /* Bộ lọc Chủ đầu tư (MarkUp 2026-11-19): chỉ hiện + chỉ áp khi lọc Phòng KD Dự Án */
  const [invF, setInvF] = useState([])
  const invKeys = l => { const v = investorOf(l); return v ? [v] : [] }
  const okInv = l => { if (!isDA || !invF.length) return true; const v = investorOf(l); return invF.indexOf(v || NONE) >= 0 }
  const leadsAll = leadsQ.filter(okInv)
  /* Khách trùng SĐT / email (tính trên toàn bộ khách, không theo bộ lọc) */
  const everyLead = allLeads || leadsIn
  const dupIdx = useMemo(() => duplicateIndex(everyLead), [everyLead])
  /* Sắp xếp danh sách: theo cột (bấm tiêu đề) hoặc "Ưu tiên chăm sóc" = thứ tự kéo thả, lưu chung công ty kdOptions.careOrder {mã lead: hạng} */
  const [sort, setSortRaw] = useState(readSort)
  const setSort = v => { setSortRaw(v); try { localStorage.setItem(SORT_LS, JSON.stringify(v)) } catch { /* bỏ qua */ } }
  const careRank = useKdMap('careOrder')
  const [dragRow, setDragRow] = useState(null)
  const [dropAt, setDropAt] = useState(null) // {id, after}
  const stickyRef = useRef(null)
  const rating = useKdMap('rating')
  const [star, setStar] = useState([])   // các mức sao đang lọc ([] = tất cả)
  const [starSort, setStarSortRaw] = useState(() => { try { return localStorage.getItem('kd-star-sort') === '1' } catch { return false } })
  const setStarSort = v => { setStarSortRaw(v); try { localStorage.setItem('kd-star-sort', v ? '1' : '0') } catch { /* bỏ qua */ } }
  const rateOf = l => Number(rating[String(l.id)]) || 0
  const [srcF, setSrcF] = useState([])     // nguồn đang lọc
  const [staffF, setStaffF] = useState([]) // nhân sự phụ trách đang lọc
  // Lọc nhân sự chỉ gồm tên khớp tài khoản trong database (họ tên hoặc tên đăng nhập, không phân biệt hoa thường);
  // tên gõ tay không có tài khoản thì không hiện, khách chỉ có tên như vậy tính là "Chưa có người phụ trách".
  const [users, setUsers] = useState(null)
  useEffect(() => {
    let off = false
    listStaff().then(list => {
      if (off) return
      const s = new Set()
      ;(list || []).forEach(u => { [u && u.name, u && u.username].forEach(x => { const k = String(x || '').trim().toLowerCase(); if (k) s.add(k) }) })
      setUsers(s)
    }, () => {})
    return () => { off = true }
  }, [])
  const staffOf = l => { const r = rawStaffOf(l); return users ? r.filter(x => users.has(x.toLowerCase())) : r }
  const okSrc = l => !srcF.length || srcF.indexOf(srcKey(l)) >= 0
  const okStaff = l => { if (!staffF.length) return true; const ss = staffOf(l); return ss.length ? ss.some(x => staffF.indexOf(x) >= 0) : staffF.indexOf(NONE) >= 0 }
  const okStar = l => !star.length || star.indexOf(rateOf(l)) >= 0
  /* Lọc theo địa chỉ (tỉnh / thành, MarkUp 2026-11-22): khoá = tỉnh (kdOptions.geo), không có thì khu vực; chưa có -> "Chưa có tỉnh thành" */
  const [addrF, setAddrF] = useState([])
  const addrKey = l => tinhOf(l) || NONE
  const okAddr = l => !addrF.length || addrF.indexOf(addrKey(l)) >= 0
  const [stageF, setStageF] = useState([])
  const [valF, setValF] = useState([])
  const okStage = l => !stageF.length || stageF.indexOf(l.stage) >= 0
  const okVal = l => !valF.length || valF.indexOf(bandOf(l)) >= 0
  const leads0 = leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okStage(l) && okVal(l) && okAddr(l))
  /* ưu tiên sao: 5 -> 1 -> chưa đánh giá; cùng số sao giữ thứ tự cũ (sort ổn định) */
  const leads = starSort ? leads0.slice().sort((a, b) => (rateOf(b) || -1) - (rateOf(a) || -1)) : leads0
  /* Ưu tiên chăm sóc: khách chưa xếp hạng (mới) lên đầu, mới nhất trước; còn lại theo hạng đã kéo thả */
  const careCmp = (a, b) => {
    const ra = careRank[String(a.id)], rb = careRank[String(b.id)]
    const ua = ra == null, ub = rb == null
    if (ua !== ub) return ua ? -1 : 1
    if (!ua) return ra - rb
    return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || Number(b.id) - Number(a.id)
  }
  const sortVal = {
    name: l => noDau(l.name), source: l => noDau(l.source), type: l => noDau(l.projectType), addr: l => noDau(addrOf(l)),
    star: l => rateOf(l) || null, dept: l => l.dept || '', value: l => Number(l.value) || null, stage: l => STAGES.indexOf(l.stage),
    created: l => l.createdAt || '',
    investor: l => noDau(investorOf(l)), cdtRole: l => noDau(cdtOf(l).role), cdtDept: l => noDau(cdtOf(l).dept),
  }
  /* cột đang sắp xếp không có trong bảng hiện tại (vd rời lọc Dự án) -> về Ưu tiên chăm sóc */
  const sortKey = LIST_HEAD_V.some(h => h[0] === sort.key) ? sort.key : 'care'
  const listLeads = leads0.slice().sort((a, b) => {
    /* công tắc "Ưu tiên 5 sao trước" ở bộ lọc sao: áp trước, rồi tới cách sắp xếp đang chọn */
    if (starSort) { const s = (rateOf(b) || -1) - (rateOf(a) || -1); if (s) return s }
    if (sortKey === 'care' || !sortVal[sortKey]) return careCmp(a, b)
    const f = sortVal[sortKey], va = f(a), vb = f(b)
    const ea = va == null || va === '', eb = vb == null || vb === ''
    if (ea || eb) return ea === eb ? careCmp(a, b) : (ea ? 1 : -1)   // ô trống luôn xuống cuối
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'vi')
    return c ? c * sort.dir : careCmp(a, b)
  })
  const careMode = sortKey === 'care'
  const clickHead = (key, def) => setSort(sort.key === key ? { key, dir: -sort.dir } : { key, dir: def })
  /* Thả dòng: đổi thứ tự các dòng đang hiện, giữ chỗ của khách bị ẩn do bộ lọc, rồi lưu hạng mới cho toàn bộ khách */
  function dropRow(targetId, after) {
    const from = dragRow
    setDragRow(null); setDropAt(null)
    if (from == null || String(from) === String(targetId)) return
    const shown = listLeads.map(l => String(l.id)).filter(id => id !== String(from))
    const at = shown.indexOf(String(targetId))
    if (at < 0) return
    shown.splice(after ? at + 1 : at, 0, String(from))
    const set = new Set(shown)
    const global = everyLead.slice().sort(careCmp).map(l => String(l.id))
    let k = 0
    const order = global.map(id => (set.has(id) ? shown[k++] : id))
    const m = {}
    order.forEach((id, i) => { m[id] = i })
    saveKdOptions('careOrder', m)
  }
  /* số đếm của từng bộ lọc tính trên các bộ lọc còn lại */
  const starCnt = n => leadsAll.filter(l => okSrc(l) && okStaff(l) && okStage(l) && okVal(l) && okAddr(l) && rateOf(l) === n).length
  const srcOpts = optsOf(leadsAll.filter(l => okStar(l) && okStaff(l) && okStage(l) && okVal(l) && okAddr(l)), l => [srcKey(l)].filter(k => k !== NONE), 'Chưa có nguồn')
  const staffOpts = optsOf(leadsAll.filter(l => okStar(l) && okSrc(l) && okStage(l) && okVal(l) && okAddr(l)), staffOf, 'Chưa có người phụ trách')
  const forStage = leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okVal(l) && okAddr(l))
  const stageOpts = STAGES.map(st => ({ v: st, label: STAGE_LABEL[st], n: forStage.filter(l => l.stage === st).length }))
  const forVal = leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okStage(l) && okAddr(l))
  const valOpts = VAL_BANDS.map(([v, label]) => ({ v, label, n: forVal.filter(l => bandOf(l) === v).length }))
  const addrOpts = optsOf(leadsAll.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okStage(l) && okVal(l)), l => { const k = tinhOf(l); return k ? [k] : [] }, 'Chưa có tỉnh thành')
  const invOpts = isDA ? optsOf(leadsQ.filter(l => okStar(l) && okSrc(l) && okStaff(l) && okStage(l) && okVal(l) && okAddr(l)), invKeys, 'Chưa có chủ đầu tư') : []
  const [draggingId, setDraggingId] = useState(null)
  const [hoverStage, setHoverStage] = useState(null)
  const [memberOpenFor, setMemberOpenFor] = useState(null)
  const kanbanRef = useRef(null)
  /* Thanh công cụ: 1 hàng (nút có chữ co lại, cắt …); chỉ khi co hết cỡ vẫn tràn mới cho xuống dòng (class wrap) */
  const barRef = useRef(null)
  const fitBar = () => {
    const el = barRef.current
    if (!el) return
    el.classList.remove('wrap')
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add('wrap')
  }
  useLayoutEffect(fitBar)
  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => fitBar())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const trackRef = useRef(null)
  const [hs, setHs] = useState({ ratio: 1, pos: 0 }) // thanh cuộn ngang: tỉ lệ phần nhìn thấy & vị trí (0–1)

  /* Thanh kéo ngang luôn hiện ở đáy màn hình (sticky) — đồng bộ với vị trí cuộn của kanban.
     leads là mảng lọc tạo lại mỗi lần render: phụ thuộc theo danh sách id (leadsKey) và chỉ setHs khi số đổi,
     nếu không effect chạy lại -> setHs object mới -> render -> lặp vô hạn (treo trang, bấm sang trang khác không được) */
  const leadsKey = leads.map(l => l.id).join(',')
  useEffect(() => {
    const k = kanbanRef.current
    if (!k) return undefined
    const upd = () => {
      const max = k.scrollWidth - k.clientWidth
      const ratio = k.scrollWidth ? Math.min(1, k.clientWidth / k.scrollWidth) : 1
      const pos = max > 0 ? k.scrollLeft / max : 0
      // chỉ đổi state khi số đo thật sự đổi: object mới mỗi lần sẽ vẽ lại vô hạn
      setHs(h => (h.ratio === ratio && h.pos === pos ? h : { ratio, pos }))
    }
    upd()
    k.addEventListener('scroll', upd)
    const ro = new ResizeObserver(upd)
    ro.observe(k)
    return () => { k.removeEventListener('scroll', upd); ro.disconnect() }
  }, [view, leadsKey])
  const stepScroll = dir => { const k = kanbanRef.current; if (k) k.scrollBy({ left: dir * Math.max(240, k.clientWidth * 0.6), behavior: 'smooth' }) }
  // Kéo thumb: di chuyển theo tỉ lệ độ rộng nội dung / độ rộng thanh
  function dragThumb(e) {
    e.preventDefault(); e.stopPropagation()
    const k = kanbanRef.current, t = trackRef.current
    if (!k || !t) return
    const startX = e.clientX, start = k.scrollLeft, factor = k.scrollWidth / t.clientWidth
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = ev => { k.scrollLeft = start + (ev.clientX - startX) * factor }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Bấm vào thanh: nhảy tới vị trí đó (thumb canh giữa điểm bấm)
  function jumpTrack(e) {
    const k = kanbanRef.current, t = trackRef.current
    if (!k || !t) return
    const r = t.getBoundingClientRect()
    const frac = (e.clientX - r.left) / r.width - hs.ratio / 2
    k.scrollTo({ left: Math.max(0, frac) * k.scrollWidth, behavior: 'smooth' })
  }

  /* Bấm ra ngoài → đóng popover người phụ trách trên thẻ */
  useEffect(() => {
    const close = () => setMemberOpenFor(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  /* Tự động cuộn khi kéo thẻ lead (trái/phải/lên/xuống) */
  useEffect(() => {
    const kanban = kanbanRef.current
    const scrollWrap = scrollRef.current
    if (!kanban || !scrollWrap) return undefined
    const EDGE = 70, MAX_SPEED = 16
    let dragging = false
    let lastEvent = null
    let rafId = null

    function edgeSpeed(pos, min, max) {
      if (pos < min + EDGE) return -MAX_SPEED * (1 - Math.max(0, pos - min) / EDGE)
      if (pos > max - EDGE) return MAX_SPEED * (1 - Math.max(0, max - pos) / EDGE)
      return 0
    }
    function tick() {
      if (dragging && lastEvent) {
        const kRect = kanban.getBoundingClientRect()
        const sRect = scrollWrap.getBoundingClientRect()
        const hSpeed = edgeSpeed(lastEvent.clientX, kRect.left, kRect.right)
        const vSpeed = edgeSpeed(lastEvent.clientY, sRect.top, sRect.bottom)
        if (hSpeed) kanban.scrollLeft += hSpeed
        if (vSpeed) scrollWrap.scrollTop += vSpeed
        rafId = requestAnimationFrame(tick)
      } else {
        rafId = null
      }
    }
    const onStart = () => { dragging = true }
    const onOver = e => {
      if (!dragging) return
      lastEvent = e
      if (!rafId) rafId = requestAnimationFrame(tick)
    }
    const onStop = () => { dragging = false; lastEvent = null }
    kanban.addEventListener('dragstart', onStart)
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragend', onStop)
    document.addEventListener('drop', onStop)
    return () => {
      kanban.removeEventListener('dragstart', onStart)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragend', onStop)
      document.removeEventListener('drop', onStop)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [scrollRef])

  return (
    <>
      {/* Thanh công cụ (+ tiêu đề cột của Danh sách) cố định khi cuộn lên xuống */}
      <div className="kd-pl-sticky" ref={stickyRef}>
      {/* 1 module xanh đậm (như băng dự án QS): phòng ban · thời gian | Kanban / Danh sách */}
      <div className="kd-pl-bar" ref={barRef}>
        <DeptFilter dept={dept} onChange={onDeptChange} />
        <TimeFilter filter={timeFilter} onChange={onTimeFilterChange} pill iconOnly />
        <StarFilter value={star} onChange={setStar} count={starCnt} sortOn={starSort} onSort={setStarSort} iconOnly />
        <MultiFilter allLabel="Tất cả nguồn" options={srcOpts} value={srcF} onChange={setSrcF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.5V19l4 2v-8.5z" /></svg>} />
        <MultiFilter allLabel="Tất cả nhân sự" options={staffOpts} value={staffF} onChange={setStaffF} iconOnly
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>} />
        <MultiFilter allLabel="Tất cả giai đoạn" options={stageOpts} value={stageF} onChange={setStageF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>} />
        <MultiFilter allLabel="Tất cả giá trị" options={valOpts} value={valF} onChange={setValF} iconOnly
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} />
        <MultiFilter allLabel="Tất cả địa chỉ" options={addrOpts} value={addrF} onChange={setAddrF} iconOnly
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>} />
        {isDA && <MultiFilter allLabel="Tất cả chủ đầu tư" options={invOpts} value={invF} onChange={setInvF}
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" /></svg>} />}
        <span style={{ flex: 1 }} />
        {/* Kanban / Danh sách dời lên hàng trên, ngay trước ô tìm (MarkUp 2026-11-19) */}
        <div className="kd-pl-view" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <button className={view === 'kanban' ? 'active' : undefined} style={viewBtnStyle(view === 'kanban')} onClick={() => setView('kanban')}>Kanban</button>
          <button className={view === 'list' ? 'active' : undefined} style={viewBtnStyle(view === 'list')} onClick={() => setView('list')}>Danh sách</button>
        </div>
        <label className={'kd-pl-search' + (qt ? ' on' : '')} title="Tìm theo tên, SĐT, email, địa chỉ, nguồn, tên dự án">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm khách: tên, SĐT…" aria-label="Tìm khách hàng"
            onKeyDown={e => { if (e.key === 'Escape') setQ('') }} />
          {qt ? <button type="button" onClick={() => setQ('')} title="Xoá tìm kiếm" aria-label="Xoá tìm kiếm">×</button> : null}
        </label>
      </div>
      {view === 'list' && (
        <div className="kd-list-head">
          <div className="kd-list-tools">
            <button type="button" className={'kd-list-care' + (careMode ? ' on' : '')} onClick={() => setSort({ key: 'care', dir: 1 })}
              title="Xếp theo thứ tự ưu tiên chăm sóc: kéo biểu tượng ⠿ ở đầu dòng để đổi thứ tự (lưu chung công ty)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h13M3 12h9M3 18h5M18 4v16M15 17l3 3 3-3" /></svg>
              Ưu tiên chăm sóc
            </button>
            <span className="hint">
              {starSort ? 'Đang bật ưu tiên 5 sao trước (bộ lọc sao). ' : ''}
              {careMode
                ? 'Kéo ⠿ ở đầu dòng để xếp khách cần chăm sóc lên trước. Khách mới (chưa xếp) hiện trên cùng.'
                : 'Đang sắp xếp theo "' + ((LIST_HEAD_V.find(h => h[0] === sortKey) || [])[1] || '') + '" ' + (sort.dir === 1 ? '(tăng dần)' : '(giảm dần)') + ' - bấm tiêu đề cột để đổi.'}
            </span>
            <span className="cnt">{listLeads.length} khách{qt ? ' khớp "' + qt + '"' : ''}</span>
          </div>
          <div className="kd-list-cols" style={{ gridTemplateColumns: LIST_COLS_V }}>
            {LIST_HEAD_V.map(([key, label, def], i) => (key ? (
              <button key={i} type="button" className={sortKey === key ? 'on' : undefined} onClick={() => clickHead(key, def)}
                title={'Sắp xếp theo ' + label.toLowerCase()} aria-sort={sortKey === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <span>{label}</span><SortIc dir={sortKey === key ? sort.dir : 0} />
              </button>
            ) : <span key={i} style={i === 0 ? { textAlign: 'right' } : undefined}>{label}</span>))}
          </div>
        </div>
      )}
      </div>

      {/* ---- Kanban ---- */}
      <div ref={kanbanRef} className="kd-kanban" style={{ display: view === 'kanban' ? 'flex' : 'none', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
        {STAGES.map(stageId => {
          const items = leads.filter(l => l.stage === stageId)
          const total = items.reduce((s, l) => s + l.value, 0)
          const accent = stageAccent(stageId)
          const isLostStage = stageId === 'truot-thau' || stageId === 'spam' || stageId === 'khong-tham-gia'
          const headColor = accent ? accent.color : ''
          return (
            <div
              key={stageId}
              className={`kd-stage-col${hoverStage === stageId ? ' drop-hover' : ''}`}
              style={{ minWidth: 220, '--lane': headColor || 'var(--text-muted)', ...(isLostStage ? { opacity: 0.85 } : null) }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (hoverStage !== stageId) setHoverStage(stageId) }}
              onDragLeave={() => setHoverStage(cur => (cur === stageId ? null : cur))}
              onDrop={e => {
                e.preventDefault()
                setHoverStage(null)
                setDraggingId(null)
                onMove(e.dataTransfer.getData('text/plain'), stageId)
              }}
            >
              {/* đầu làn dạng khối màu đặc (khác thẻ khách hàng nền trắng): chấm màu + TÊN GIAI ĐOẠN, số khách ở ô tròn bên phải, tổng giá trị dòng dưới */}
              <div className={'kd-stage-head kd-sh' + (headColor ? ' tint' : '')} title={STAGE_LABEL[stageId] + ' - ' + items.length + ' khách - ' + fmtTy(total)}>
                <div className="kd-sh-top">
                  <i className="kd-sh-dot" aria-hidden="true" />
                  <span className="kd-sh-l">{STAGE_LABEL[stageId]}</span>
                  <b className="kd-sh-n">{items.length}</b>
                </div>
                <span className="kd-sh-v">{fmtTy(total)}</span>
              </div>
              <div className="kd-stage-body">
                {!items.length && <div className="kd-stage-empty">Kéo thẻ vào đây</div>}
                {items.map(l => (
                  <LeadCard
                    key={l.id} lead={l} projMode={isDA} dups={dupIdx[String(l.id)]}
                    dragging={draggingId === l.id}
                    onDragStart={setDraggingId}
                    onDragEnd={() => setDraggingId(null)}
                    onOpen={onOpenDetail} onDelete={onDelete} onMove={onMove}
                    memberOpen={memberOpenFor === l.id}
                    onToggleMember={id => setMemberOpenFor(cur => (cur === id ? null : id))}
                    onCloseMember={() => setMemberOpenFor(null)}
                    onAddAssignee={onAddAssignee} onRemoveAssignee={onRemoveAssignee}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {view === 'kanban' && hs.ratio < 0.995 && (
        <div className="kd-hscroll" role="group" aria-label="Cuộn ngang các giai đoạn">
          <button type="button" onClick={() => stepScroll(-1)} disabled={hs.pos <= 0.002} title="Sang trái" aria-label="Cuộn sang trái">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          {/* thanh trượt mảnh: rãnh xám + con trượt màu kinh doanh (dày lên khi rê / kéo) */}
          <div className="kd-hscroll-track kd-hs-slim" ref={trackRef} onPointerDown={jumpTrack}>
            <div className="kd-hscroll-thumb" style={{ width: hs.ratio * 100 + '%', left: hs.pos * (1 - hs.ratio) * 100 + '%' }} onPointerDown={dragThumb} title="Kéo để xem các giai đoạn" />
          </div>
          <button type="button" onClick={() => stepScroll(1)} disabled={hs.pos >= 0.998} title="Sang phải" aria-label="Cuộn sang phải">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      )}

      {/* ---- Danh sách ---- */}
      <div className="kd-list-body" style={{ display: view === 'list' ? 'block' : 'none' }}>
        {!listLeads.length && <div className="kd-list-empty">{qt ? 'Không có khách nào khớp "' + qt + '"' : 'Không có khách hàng'}</div>}
        {listLeads.map((l, i) => {
          const a = stageAccent(l.stage)
          const sc = sourceColor(l.source)
          const addr = addrOf(l)
          const dups = dupIdx[String(l.id)]
          const dropCls = dropAt && String(dropAt.id) === String(l.id) ? (dropAt.after ? ' drop-after' : ' drop-before') : ''
          return (
            /* bấm dòng = mở trang chi tiết khách hàng; ô chọn giai đoạn và nút sửa không mở. Chế độ Ưu tiên chăm sóc: kéo dòng để đổi thứ tự */
            <div key={l.id} className={'kd-list-row' + dropCls + (String(dragRow) === String(l.id) ? ' dragging' : '')} role="button" tabIndex={0} title="Xem chi tiết khách hàng"
              draggable={careMode}
              onDragStart={careMode ? e => { e.dataTransfer.setData('text/x-kd-row', String(l.id)); e.dataTransfer.effectAllowed = 'move'; setDragRow(l.id) } : undefined}
              onDragEnd={careMode ? () => { setDragRow(null); setDropAt(null) } : undefined}
              onDragOver={careMode && dragRow != null ? e => {
                e.preventDefault(); e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2
                if (!dropAt || String(dropAt.id) !== String(l.id) || dropAt.after !== after) setDropAt({ id: l.id, after })
              } : undefined}
              onDrop={careMode && dragRow != null ? e => { e.preventDefault(); dropRow(l.id, dropAt ? dropAt.after : false) } : undefined}
              onClick={() => onOpenDetail && onOpenDetail(l.id)}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpenDetail && onOpenDetail(l.id) } }}
              style={{ display: 'grid', gridTemplateColumns: LIST_COLS_V, gap: 10, alignItems: 'center', padding: '10px 4px', cursor: careMode ? 'grab' : 'pointer', ...(i < listLeads.length - 1 ? { borderBottom: '1px solid var(--border)' } : null) }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                {careMode ? <i className="kd-list-grip" title="Kéo để đổi thứ tự ưu tiên" aria-hidden="true">⠿</i> : null}{i + 1}
              </span>
              {isDA && (() => {
                const inv = investorOf(l)
                return <span title={inv} style={{ ...cellTxt, fontWeight: inv ? 600 : 400 }}>{inv ? <span style={cellLine}>{inv}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
              })()}
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <b title={l.name} style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</b>
                  {dups && dups.length ? (
                    <span className="kd-dup-tag" title={'Trùng SĐT/email với: ' + dups.map(d => d.name + (d.source ? ' (' + d.source + ')' : '')).join(', ')}>⚠ Trùng {dups.length}</span>
                  ) : null}
                </span>
                {l.phone ? <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.phone}</span> : null}
              </span>
              {isDA && (() => {
                const c = cdtOf(l)
                const cell = v => <span title={v} style={cellTxt}><span style={{ ...cellLine, color: v ? 'var(--text)' : 'var(--text-muted)' }}>{v || '—'}</span></span>
                return <>{cell(c.role)}{cell(c.dept)}</>
              })()}
              <span style={{ minWidth: 0 }}>
                {l.source ? (
                  <span title={l.source} style={{ display: 'inline-block', maxWidth: '100%', boxSizing: 'border-box', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle', ...(sc ? { color: sc.color, background: sc.bg, border: '1px solid ' + sc.border } : { color: 'var(--text)', background: 'var(--surface-alt)' }) }}>{l.source}</span>
                ) : <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>—</span>}
              </span>
              <span title={l.type} style={{ fontSize: 12.5, color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.type}</span>
              <span title={addr} style={{ fontSize: 12.5, fontWeight: addr ? 600 : 400, color: addr ? 'var(--text)' : 'var(--text-muted)', minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.35 }}>{addr || '—'}</span>
              <span style={{ minWidth: 0 }}><RatingStars id={String(l.id)} small /></span>
              {!isDA && <span style={{ padding: '3px 9px', borderRadius: 999, background: DEPT_TINT[l.dept], color: DEPT_COLOR[l.dept], fontSize: 10.5, fontWeight: 600, justifySelf: 'start' }}>{DEPT_SHORT[l.dept]}</span>}
              <span className="mono" style={{ fontSize: 12.5, color: 'var(--sales)', fontWeight: 700 }}>{fmtTy(l.value)}</span>
              <span style={{ padding: '3px 9px', borderRadius: 999, background: a ? a.bg : 'var(--sales-tint)', color: a ? a.color : 'var(--sales)', fontSize: 11, fontWeight: 600, justifySelf: 'start' }}>{STAGE_LABEL[l.stage]}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDay(l.createdAt) || '—'}</span>
              <select
                value={l.stage} onChange={e => onMove(l.id, e.target.value)} onClick={e => e.stopPropagation()}
                style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 11, padding: '5px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit' }}
              >
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
              <button type="button" className="kd-list-edit" title="Sửa thông tin khách hàng" aria-label={'Sửa ' + l.name}
                onClick={e => { e.stopPropagation(); onEdit && onEdit(l.id) }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
