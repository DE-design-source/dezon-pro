import { useEffect, useRef, useState } from 'react'
import { PO_PEOPLE, TODAY, avatarColor, initials, parseD, dayDiff, toISO, fmtFull } from '../../../data/quanLyThietKeData'
import { uploadRaw } from '../../QS/api/files'
import { safeUrl_ } from '../../QS/lib/format'
import DatePicker from '../../../components/ui/DatePicker'
import { getProjData } from '../../QS/api/qsApi'

/* Danh sách nhà cung cấp gợi ý: hồ sơ NCC / logo NCC của công ty (dữ liệu '__cty' của QS: nccInfo, nccLogo), tải 1 lần */
let nccCache = null
let nccLoad = null
function useNccNames() {
  const [names, setNames] = useState(nccCache || [])
  useEffect(() => {
    if (nccCache) return undefined
    let live = true
    nccLoad = nccLoad || getProjData('__cty').then(d => {
      const keys = o => (o && typeof o === 'object' ? Object.keys(o) : [])
      nccCache = [...new Set([...keys(d && d.nccInfo), ...keys(d && d.nccLogo)].map(x => String(x).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'))
      return nccCache
    }, () => { nccLoad = null; return [] })
    nccLoad.then(v => { if (live) setNames(v) })
    return () => { live = false }
  }, [])
  return names
}

/* Phiếu chi tiết 1 đơn mua hàng (khung phải của bảng mua hàng): bộ trường như bản Lark.
   Trường fx (công thức) tính từ Start At Site / Lead Time / Bù trừ, chỉ đọc; còn lại sửa tại chỗ, lưu khi rời ô.
   3 chế độ xem: Default (nhãn trái - giá trị phải), Columns (2 cột), Groups (Thông tin chính / Thông tin khác, 2 cột). */
export const PO_VIEWS = [
  { key: 'default', label: 'Default' },
  { key: 'columns', label: 'Columns' },
  { key: 'groups', label: 'Groups' },
]
/* Chế độ xem dùng chung cho bảng mua hàng và Phiếu thông tin mua hàng, nhớ theo trình duyệt */
const PD_VIEW_KEY = 'tk_po_view_v2' // mặc định Groups
const readView = () => { try { const v = localStorage.getItem(PD_VIEW_KEY); return PO_VIEWS.some(x => x.key === v) ? v : 'groups' } catch (e) { return 'groups' } }
export function usePoView() {
  const [view, setView] = useState(readView)
  const pick = v => { setView(v); try { localStorage.setItem(PD_VIEW_KEY, v) } catch (e) { /* bỏ qua */ } }
  return [view, pick]
}
export function PoViewSwitch({ view, onPick }) {
  return (
    <div className="tk-pd-views" role="tablist" aria-label="Chế độ xem">
      {PO_VIEWS.map(v => (
        <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={view === v.key ? 'on' : ''} onClick={() => onPick(v.key)} title={'Chế độ xem ' + v.label}>
          <i className={'pv pv-' + v.key}><b /><b /><b /></i>{v.label}
        </button>
      ))}
    </div>
  )
}
/* Đơn mua hàng mới của 1 công việc: mã PR tiếp theo, bước đầu quy trình, ngày cần hàng = ngày kết thúc công việc */
export function newPoItem(list, stages, me, task) {
  const max = list.reduce((m, it) => Math.max(m, Number(String(it.code || '').replace(/\D/g, '')) || 0), 0)
  const today = toISO(TODAY)
  return {
    id: 'po' + Date.now().toString(36), code: 'PR-' + String(max + 1).padStart(3, '0'), item: 'Đơn mua hàng mới', supplier: '', qty: '', value: 0,
    due: (task && task.end) || today, owner: '', stage: (stages.find(s => !s.closed) || stages[0] || {}).key || 'request',
    createdAt: today, createdBy: me || '', pm: task && task.assignee ? [task.assignee] : [],
  }
}
const GROUP_OPTS = ['Thiết bị vệ sinh', 'Sơn', 'Điện lạnh', 'Chiếu sáng', 'Nội thất', 'Rèm', 'Vật liệu thô', 'Thép', 'Bê tông']
const PAY_OPTS = ['Chưa thanh toán', 'Tạm ứng', 'Thanh toán 1 phần', 'Đã thanh toán']
/* Status: 4 cấp từ bình thường -> khẩn cấp (tự tính theo hạn, chọn tay được qua it.priority) + Hoàn tất / Đã huỷ */
export const PO_LEVELS = [
  { key: 'normal', label: 'Bình thường', tone: 'ok', hint: 'Còn hơn 7 ngày tới hạn' },
  { key: 'watch', label: 'Cần chú ý', tone: 'warn', hint: 'Còn 4 - 7 ngày' },
  { key: 'urgent', label: 'Gấp', tone: 'urg', hint: 'Còn 0 - 3 ngày' },
  { key: 'critical', label: 'Khẩn cấp', tone: 'crit', hint: 'Đã quá hạn' },
]
const STATUS_TONE = { 'Bình thường': 'ok', 'Cần chú ý': 'warn', 'Gấp': 'urg', 'Khẩn cấp': 'crit', 'Hoàn tất': 'done', 'Đã huỷ': 'off' }

const addDays = (iso, n) => { if (!iso) return null; const d = parseD(iso); d.setDate(d.getDate() + n); return toISO(d) }
const fmtD = iso => (iso ? fmtFull(parseD(iso)) : null)
const num = v => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v))

/* Công thức (khớp tooltip ⓘ):
   Order Due Kế Toán = Start At Site - Lead Time + Bù trừ; Mua hàng đặt hàng = Order Due Kế Toán - 7 ngày;
   Pc/Sm/Pm Order = Mua hàng đặt hàng - 3 ngày; From Today = Pc/Sm/Pm Order - hôm nay (ngày, âm = đã quá hạn).
   Status: theo mốc kế tiếp chưa có ngày thực tế (PC -> Thu mua -> Kế toán): < 0 ngày Critical, <= 3 Urgent, <= 7 Warning, còn lại On track. */
export function poCalc(it, stage) {
  const site = it.due || null
  // Ngày kế hoạch sửa tay (planDueKT / planBuy / planPc) thay cho công thức; các mốc trước tính lùi từ mốc đã sửa
  const dueKT = it.planDueKT || (site ? addDays(site, -num(it.leadTime) + num(it.timeOffset)) : null)
  const buy = it.planBuy || (dueKT ? addDays(dueKT, -7) : null)
  const pcOrder = it.planPc || (buy ? addDays(buy, -3) : null)
  const fromToday = pcOrder ? dayDiff(TODAY, parseD(pcOrder)) : null
  let status = null
  let fixed = false
  let auto = null
  if (stage && stage.closed) { status = 'Đã huỷ'; fixed = true }
  else if ((stage && stage.received) || (it.orderActualPc && it.orderActualPurchasing && it.orderActualAccounting)) { status = 'Hoàn tất'; fixed = true }
  else {
    const next = !it.orderActualPc ? pcOrder : !it.orderActualPurchasing ? buy : dueKT
    if (next) {
      const d = dayDiff(TODAY, parseD(next))
      auto = d < 0 ? 'critical' : d <= 3 ? 'urgent' : d <= 7 ? 'watch' : 'normal'
    }
    const lv = PO_LEVELS.find(l => l.key === (it.priority || auto))
    status = lv ? lv.label : null
  }
  return { site, dueKT, buy, pcOrder, fromToday, status, fixed, auto, level: it.priority || auto }
}

const Ic = {
  fx: <span className="fxg">ƒx</span>,
  sel: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8 10 4 4 4-4" /></svg>,
  txt: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 18 8.5 6 13 18M5.7 14h5.6M15 8h6M15 12h6M15 16h4" /></svg>,
  num: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18" /></svg>,
  money: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v12" /></svg>,
  file: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7" /></svg>,
  date: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2" /></svg>,
  user: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  link: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h4a3 3 0 0 1 3 3V14" /></svg>,
  info: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v6M12 7.5v.01" /></svg>,
}

const Empty = () => <span className="tk-pd-empty">—</span>
const Person = ({ name }) => <span className="tk-pd-person"><span className="av" style={{ background: avatarColor(name) }}>{initials(name)}</span>{name}</span>
const normS = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
const IcChev = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>

/* Ô nhập luôn hiện (kiểu trang thông tin QS): Enter / rời ô để lưu, Esc trả lại giá trị cũ */
function Edit({ value, type = 'text', options, placeholder, onSave, suffix, display, renderOpt, strong }) {
  if (options) return <Combo value={value} options={options} placeholder={placeholder} onSave={onSave} display={display} renderOpt={renderOpt} />
  // Ngày: lịch kiểu iOS dùng chung (components/ui/DatePicker) thay cho lịch của trình duyệt
  if (type === 'date') return <DatePicker className="tk-pd-dp" variant="card" value={value || ''} clearable onChange={v => { if (v !== (value || '')) onSave(v) }} />
  const v = value ?? ''
  return (
    <span className={'tk-pd-inw' + (strong ? ' strong' : '')}>
      <input
        key={String(v)} className="tk-pd-in" type={type} defaultValue={v} placeholder={placeholder || '—'}
        onBlur={e => { if (String(e.target.value) !== String(v)) onSave(e.target.value) }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); e.currentTarget.value = v; e.currentTarget.blur() }
        }}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  )
}

/* Ô chọn có tìm kiếm (thay datalist của trình duyệt): chọn trong danh sách hoặc gõ để thêm lựa chọn mới */
/* Giá trị đơn: nhập số tiền VND (tự chấm phần nghìn), dòng dưới đọc thành chữ (1,2 tỷ VND / 250 triệu VND); lưu theo triệu đồng */
const groupVnd = d => String(d || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const nfVi = n => (Math.round(n * 100) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
function vndWords(n) {
  if (!n) return ''
  if (n >= 1e9) return nfVi(n / 1e9) + ' tỷ VND'
  if (n >= 1e6) return nfVi(n / 1e6) + ' triệu VND'
  if (n >= 1e3) return nfVi(n / 1e3) + ' nghìn VND'
  return nfVi(n) + ' VND'
}
function MoneyEdit({ value, onSave, split, label }) {
  const vnd = Math.round((Number(value) || 0) * 1e6)
  const [txt, setTxt] = useState(vnd ? groupVnd(vnd) : '')
  useEffect(() => { setTxt(vnd ? groupVnd(vnd) : '') }, [vnd])
  const cur = Number(txt.replace(/\D/g, '')) || 0
  const commit = () => { if (cur !== vnd) onSave(cur / 1e6) }
  const input = (
    <span className="tk-pd-inw">
      <input
        className="tk-pd-in" inputMode="numeric" placeholder="Nhập số tiền" value={txt}
        onChange={e => setTxt(groupVnd(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setTxt(vnd ? groupVnd(vnd) : ''); setTimeout(() => e.target.blur(), 0) }
        }}
      />
      <em>VND</em>
    </span>
  )
  if (split) {
    return (
      <>
        <div className="tk-pd-row t-money"><span className="tk-pd-label"><span>{label}</span></span><div className="tk-pd-cell tk-pd-money2">{input}</div></div>
        <div className="tk-pd-row t-fx"><span className="tk-pd-label"><span>Giá trị bằng chữ</span></span><div className="tk-pd-cell"><span className={'tk-pd-ro words' + (cur ? '' : ' ph')}>{cur ? vndWords(cur) : 'Tự đọc từ số tiền'}</span></div></div>
      </>
    )
  }
  return (
    <span className="tk-pd-money">
      <span className="tk-pd-inw">
        <input
          className="tk-pd-in" inputMode="numeric" placeholder="Nhập số tiền" value={txt}
          onChange={e => setTxt(groupVnd(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')))}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setTxt(vnd ? groupVnd(vnd) : ''); setTimeout(() => e.target.blur(), 0) }
          }}
        />
        <em>VND</em>
      </span>
      <span className={'w' + (cur ? '' : ' ph')}>{cur ? '= ' + vndWords(cur) : 'Số tiền bằng chữ'}</span>
    </span>
  )
}

/* Khung xổ xuống cố định theo vị trí nút: tự đóng khi bấm ra ngoài, cuộn hoặc đổi cỡ cửa sổ */
// anchor: selector của khối cha để khung xổ rộng bằng khối đó (vd thẻ 1 bước tiến độ), row: hàng mà khung nằm ngay dưới
function usePop(minW = 240, anchor, rowSel) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const qRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    if (qRef.current) qRef.current.focus({ preventScroll: true })
    const t0 = Date.now()
    const inPop = t => t && t.closest && t.closest('.tk-pd-pop')
    const down = e => { if (!(ref.current && ref.current.contains(e.target)) && !inPop(e.target)) setOpen(false) }
    const scroll = e => { if (Date.now() - t0 > 200 && !inPop(e.target)) setOpen(false) }
    const resize = () => setOpen(false)
    document.addEventListener('mousedown', down)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize) }
  }, [open])
  const toggle = () => {
    if (open) { setOpen(false); return }
    const box = (anchor && ref.current.closest(anchor)) || ref.current
    const row = (rowSel && ref.current.closest(rowSel)) || ref.current
    const b = box.getBoundingClientRect()
    const rr = row.getBoundingClientRect()
    const r = { left: b.left, width: b.width, top: rr.top, bottom: rr.bottom }
    const up = window.innerHeight - r.bottom < 280 && r.top > 280
    const w = anchor ? b.width : Math.max(r.width, minW)
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), width: w, top: up ? null : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : null })
    setOpen(true)
  }
  const style = pos ? { left: pos.left, width: pos.width, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined } : undefined
  return { open, setOpen, ref, qRef, toggle, style }
}

function Combo({ value, options, placeholder, onSave, display, renderOpt }) {
  const { open, setOpen, ref, qRef, toggle, style } = usePop()
  const [q, setQ] = useState('')
  const t = q.trim()
  const list = options.filter(o => !t || normS(o).includes(normS(t)))
  const exact = options.find(o => normS(o) === normS(t))
  const pick = v => { setOpen(false); setQ(''); if (v !== (value || '')) onSave(v) }
  return (
    <>
      <button ref={ref} type="button" className={'tk-pd-combo' + (open ? ' on' : '')} onClick={toggle}>
        <span className="v">{value ? (display || value) : <span className="ph">{placeholder || 'Chọn…'}</span>}</span>
        <i className="chev">{IcChev}</i>
      </button>
      {open && style && (
        <div className="tk-pd-pop" style={style}>
          <input
            ref={qRef} placeholder="Tìm hoặc gõ để thêm…" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && t) { e.preventDefault(); pick(exact || (list.length === 1 ? list[0] : t)) }
              if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setOpen(false) }
            }}
          />
          <div className="ls">
            {list.map(o => (
              <button key={o} type="button" className={o === value ? 'on' : ''} onClick={() => pick(o)}>
                <span>{renderOpt ? renderOpt(o) : o}</span>{o === value && <b className="ck">✓</b>}
              </button>
            ))}
            {t && !exact && <button type="button" className="add" onClick={() => pick(t)}>+ Thêm "{t}"</button>}
            {!list.length && !t && <div className="em">Chưa có lựa chọn</div>}
          </div>
          {value && <button type="button" className="clr" onClick={() => pick('')}>Bỏ chọn</button>}
        </div>
      )}
    </>
  )
}

/* Nhiều người phụ trách: avatar / chip + nút (+) mở danh sách nhân sự (tìm theo tên, chức danh, phòng ban; gõ tên mới để thêm) */
export const toList = v => (Array.isArray(v) ? v : v ? [v] : [])
function PeoplePick({ names, onSave, compact }) {
  const { open, setOpen, ref, qRef, toggle, style } = usePop(280, compact ? '.st' : '.tk-pd-cell', compact ? '.who' : null)
  const [q, setQ] = useState('')
  const list = toList(names)
  const t = q.trim()
  const opts = PO_PEOPLE.filter(p => !list.includes(p.name) && (!t || normS(p.name + ' ' + p.role + ' ' + p.dept).includes(normS(t))))
  const known = PO_PEOPLE.some(p => normS(p.name) === normS(t)) || list.some(n => normS(n) === normS(t))
  const add = n => { if (n && !list.includes(n)) onSave([...list, n]); setQ(''); if (qRef.current) qRef.current.focus({ preventScroll: true }) }
  const rm = n => onSave(list.filter(x => x !== n))
  return (
    <div className={'tk-pd-ppl' + (compact ? ' compact' : '')}>
      {list.map(n => (compact
        ? <button key={n} type="button" className="av" title={n + ' - bấm để bỏ'} style={{ background: avatarColor(n) }} onClick={() => rm(n)}>{initials(n)}<i>×</i></button>
        : <span key={n} className="chip"><Person name={n} /><button type="button" onClick={() => rm(n)} title="Bỏ người này">×</button></span>))}
      <button ref={ref} type="button" className={'plus' + (open ? ' on' : '')} onClick={toggle} title="Thêm người phụ trách">+</button>
      {!compact && !list.length && <span className="ph">Chưa có người phụ trách</span>}
      {open && style && (
        <div className="tk-pd-pop" style={style}>
          <input
            ref={qRef} placeholder="Tìm theo tên, chức danh, phòng ban…" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && t) { e.preventDefault(); add(opts.length === 1 ? opts[0].name : t) }
              if (e.key === 'Escape') { e.nativeEvent.stopPropagation(); setOpen(false) }
            }}
          />
          <div className="ls">
            {opts.map(o => (
              <button key={o.name} type="button" onClick={() => add(o.name)}>
                <span className="pp"><Person name={o.name} /><em>{o.role} · {o.dept}</em></span>
              </button>
            ))}
            {t && !known && <button type="button" className="add" onClick={() => add(t)}>+ Thêm "{t}"</button>}
            {!opts.length && !t && <div className="em">Đã thêm hết nhân sự</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* Thang mức độ: bấm 1 cấp để đặt tay, bấm lại / "Tự động" để theo hạn */
function Levels({ c, value, onSave }) {
  if (c.fixed) return <span className="tk-pd-ro"><span className={'tk-pd-pill st-' + STATUS_TONE[c.status]}>{c.status}</span></span>
  return (
    <div className="tk-pd-lv">
      <div className="sc">
        {PO_LEVELS.map(l => (
          <button key={l.key} type="button" className={'lv t-' + l.tone + (c.level === l.key ? ' on' : '') + (c.auto === l.key ? ' auto' : '')}
            title={l.hint + (c.auto === l.key ? ' (theo hạn hiện tại)' : '')} onClick={() => onSave(value === l.key ? '' : l.key)}>
            <i />{l.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* Ngày kế hoạch: mặc định tự tính (ƒx), chọn ngày để sửa tay, "↺" để về công thức */
function PlanDate({ value, override, onSave }) {
  return (
    <span className={'tk-pd-plan' + (override ? ' man' : '')}>
      <Edit type="date" value={value} onSave={v => onSave(v || '')} />
      {override && <button type="button" className="reset" onClick={() => onSave('')} title="Bỏ ngày sửa tay, tính lại theo công thức">↺</button>}
    </span>
  )
}

function Files({ files, onSave }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const list = files || []
  const add = async fl => {
    if (!fl.length) return
    setBusy(true)
    try {
      const up = []
      for (const f of fl) { const r = await uploadRaw(f); up.push({ name: f.name, url: r.url }) }
      onSave([...list, ...up])
    } catch (e) { window.alert('Không tải lên được: ' + (e.message || e)) }
    setBusy(false)
  }
  return (
    <div className="tk-pd-files">
      {list.map((f, i) => (
        <span key={f.url + i} className="tk-pd-file">
          {Ic.file}<a href={safeUrl_(f.url)} target="_blank" rel="noreferrer">{f.name || 'Tệp'}</a>
          <button type="button" onClick={() => onSave(list.filter((_, j) => j !== i))} title="Bỏ tệp">×</button>
        </span>
      ))}
      <button type="button" className="tk-pd-add" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Đang tải…' : '+ Tải tệp lên'}</button>
      <input ref={ref} type="file" multiple hidden onChange={e => { add([...e.target.files]); e.target.value = '' }} />
    </div>
  )
}

/* Trạng thái 1 bước: đã có ngày thực tế -> so với kế hoạch; chưa có -> so với hôm nay */
function stepChip(plan, act) {
  if (!plan) return null
  if (act) { const d = dayDiff(parseD(plan), parseD(act)); return d <= 0 ? ['ok', 'Đúng hạn'] : ['late', 'Trễ ' + d + ' ngày'] }
  const d = dayDiff(TODAY, parseD(plan))
  return d < 0 ? ['over', 'Quá hạn ' + -d + ' ngày'] : d === 0 ? ['soon', 'Hôm nay'] : d <= 7 ? ['soon', 'Còn ' + d + ' ngày'] : ['wait', 'Còn ' + d + ' ngày']
}

export default function PoDetailFields({ item, task, projectName, stage, view, onPatch, suppliers }) {
  const c = poCalc(item, stage)
  const ncc = useNccNames()
  const nccOpts = [...new Set([...ncc, ...(suppliers || []).map(x => String(x || '').trim()).filter(x => x && x !== 'Chưa chọn NCC')])]
  const set = k => v => onPatch({ [k]: v })
  const setNum = k => v => onPatch({ [k]: v === '' ? null : Number(v) })
  const people = PO_PEOPLE.map(p => p.name)
  const pill = (v, cls) => (v ? <span className={'tk-pd-pill ' + (cls || '')}>{v}</span> : null)
  const sel = (k, opts) => <Edit value={item[k]} display={pill(item[k], k === 'workflow' ? 'navy' : '')} options={opts} placeholder="Chọn hoặc gõ…" onSave={set(k)} />
  const person = k => <PeoplePick names={item[k]} onSave={set(k)} />
  const dateEdit = k => <Edit type="date" value={item[k]} onSave={v => onPatch({ [k]: v || '' })} />
  const ro = (v, cls) => <span className={'tk-pd-ro' + (cls ? ' ' + cls : '')}>{v == null || v === '' ? <Empty /> : v}</span>
  const fx = v => ro(v, 'fx')

  const F = {
    fromToday: { label: 'From Today*', ic: 'fx', tip: 'Pc/Sm/Pm Order - hôm nay (ngày). Âm = đã quá hạn.', el: fx(c.fromToday == null ? null : c.fromToday + ' ngày') },
    sample: { label: 'Sample / Mockup / Catalog', ic: 'file', el: <Files files={item.filesSample} onSave={set('filesSample')} /> },
    drawings: { label: 'Drawings/ Documents', ic: 'file', el: <Files files={item.filesDrawings} onSave={set('filesDrawings')} /> },
    status: { label: 'Status*', ic: 'fx', tip: 'Tự tính theo mốc kế tiếp chưa có ngày thực tế (PC -> Thu mua -> Kế toán): còn hơn 7 ngày = Bình thường, 4-7 ngày = Cần chú ý, 0-3 ngày = Gấp, quá hạn = Khẩn cấp. Bấm 1 cấp để đặt tay.', el: <Levels c={c} value={item.priority} onSave={set('priority')} /> },
    productGroup: { label: 'Nhóm sản phẩm', ic: 'sel', el: sel('productGroup', GROUP_OPTS) },
    item: { label: 'Tên sản phẩm', ic: 'txt', el: <Edit value={item.item} strong placeholder="Tên sản phẩm / vật tư" onSave={set('item')} /> },
    supplier: { label: 'Nhà cung cấp', ic: 'sel', el: <Edit value={item.supplier} options={nccOpts} placeholder="Chọn hoặc nhập tên NCC…" onSave={set('supplier')} /> },
    qty: { label: 'Số lượng*', ic: 'num', el: <Edit value={item.qty} placeholder="VD: 24 bộ" onSave={set('qty')} /> },
    value: { label: 'Giá trị đơn hàng', ic: 'money', el: <MoneyEdit value={item.value} onSave={v => onPatch({ value: Math.max(0, v) })} /> },
    filesPm: { label: 'File đính kèm PM', ic: 'file', el: <Files files={item.filesPm} onSave={set('filesPm')} /> },
    filesContract: { label: 'Hợp đồng báo giá nhà thầu/NCC', ic: 'file', el: <Files files={item.filesContract} onSave={set('filesContract')} /> },
    note: { label: 'Ghi chú', ic: 'txt', el: <Edit value={item.note} placeholder="Ghi chú cho đơn" onSave={set('note')} /> },
    payment: { label: 'Thanh toán', ic: 'sel', el: sel('payment', PAY_OPTS) },
    site: { label: 'Start At Site Ngày Lắp Tại Site*', ic: 'date', tip: 'Ngày lắp tại site (= ngày cần hàng của đơn). Các mốc đặt hàng tính lùi từ ngày này.', el: <Edit type="date" value={item.due} onSave={v => v && onPatch({ due: v })} /> },
    timeOffset: { label: 'Bù trừ thời gian', ic: 'num', tip: 'Cộng (+) / trừ (-) số ngày vào Order Due Kế Toán.', el: <Edit type="number" value={item.timeOffset ?? ''} suffix="ngày" onSave={setNum('timeOffset')} /> },
    leadTime: { label: 'Lead Time Thời Gian Nhập Hàng / Sản Xuất', ic: 'num', tip: 'Số ngày NCC cần để sản xuất / nhập hàng trước ngày lắp.', el: <Edit type="number" value={item.leadTime ?? ''} suffix="ngày" onSave={setNum('leadTime')} /> },
    pcOrder: { label: 'Pc/Sm/Pm Order*', ic: 'fx', tip: 'Mua hàng đặt hàng - 3 ngày (sửa tay được).', el: <PlanDate value={c.pcOrder} override={item.planPc} onSave={set('planPc')} /> },
    actPurchasing: { label: 'Order Actual Purchasing', ic: 'date', el: dateEdit('orderActualPurchasing') },
    buy: { label: 'Mua hàng đặt hàng*', ic: 'fx', tip: 'Order Due Kế Toán - 7 ngày (sửa tay được).', el: <PlanDate value={c.buy} override={item.planBuy} onSave={set('planBuy')} /> },
    actAccounting: { label: 'Order Actual Kế Toán', ic: 'date', el: dateEdit('orderActualAccounting') },
    dueKT: { label: 'Order Due Kế Toán*', ic: 'fx', tip: 'Start At Site - Lead Time + Bù trừ thời gian (sửa tay được).', el: <PlanDate value={c.dueKT} override={item.planDueKT} onSave={set('planDueKT')} /> },
    actPc: { label: 'Pc/Sm Order Actual', ic: 'date', el: dateEdit('orderActualPc') },
    pm: { label: 'PM*', ic: 'user', el: person('pm') },
    buyer: { label: 'Thu mua*', ic: 'user', el: person('buyer') },
    accountant: { label: 'Kế toán*', ic: 'user', el: person('accountant') },
    siteManager: { label: 'CHT/GS*', ic: 'user', el: person('siteManager') },
    pc: { label: 'PC*', ic: 'user', el: person('pc') },
    siteReceiver: { label: 'Tiếp nhận tại site', ic: 'user', el: person('siteReceiver') },
    actSite: { label: 'Thực tế lắp tại site', ic: 'date', el: dateEdit('actualAtSite') },
    createdAt: { label: 'Ngày tạo*', ic: 'date', el: dateEdit('createdAt') },
    createdBy: { label: 'Người tạo*', ic: 'user', el: <Edit value={item.createdBy} display={item.createdBy ? <Person name={item.createdBy} /> : null} options={people} renderOpt={n => <Person name={n} />} placeholder="Chọn nhân sự…" onSave={set('createdBy')} /> },
    timeline: { label: 'Timeline', ic: 'link', tip: 'Từ kế hoạch PC / SM / PM đặt hàng (bước 1) tới kế hoạch tiếp nhận tại site (bước 4); số ngày = tổng thời gian.', el: ro(c.pcOrder && item.due ? <span className="tk-pd-tl"><b>{dayDiff(parseD(c.pcOrder), parseD(item.due))} ngày</b><span>{fmtD(c.pcOrder)} → {fmtD(item.due)}</span></span> : null) },
    project: { label: 'Dự án', ic: 'link', tip: 'Tự động lấy theo dự án đang mở (tên dự án + mã dự án QS nếu có).', el: ro(projectName ? <span className="tk-pd-ref">⏳ {projectName}</span> : <span className="tk-pd-empty">Chưa chọn dự án</span>) },
  }
  const ORDER = ['fromToday', 'sample', 'drawings', 'status', 'productGroup', 'item', 'supplier', 'qty', 'value', 'filesPm', 'filesContract', 'note', 'payment',
    'site', 'actSite', 'timeOffset', 'leadTime', 'pcOrder', 'actPurchasing', 'buy', 'actAccounting', 'dueKT', 'actPc', 'pm', 'buyer', 'accountant', 'siteManager', 'pc', 'siteReceiver', 'createdAt', 'createdBy', 'timeline', 'project']
  const row = k => {
    if (k === 'valueSplit') return <MoneyEdit key={k} split label={F.value.label} value={item.value} onSave={v => onPatch({ value: Math.max(0, v) })} />
    const f = F[k]
    return (
      <div key={k} className={'tk-pd-row t-' + f.ic + (k === 'status' ? ' t-status' : '') + (k === 'timeline' ? ' t-tl' : '') + (k === 'note' || k.startsWith('files') ? ' wide' : '')}>
        <span className="tk-pd-label">
          {view === 'default' && <i className="ic">{Ic[f.ic]}</i>}
          <span>{f.label}</span>
          {f.tip && <i className="tip" title={f.tip}>{Ic.info}</i>}
        </span>
        <div className="tk-pd-cell">{f.el}</div>
      </div>
    )
  }

  if (view === 'groups') {
    const fromCls = c.fromToday == null ? '' : c.fromToday < 0 ? ' neg' : c.fromToday <= 7 ? ' warn' : ' pos'
    const steps = [
      { t: 'PC / SM / PM đặt hàng', plan: c.pcOrder, planKey: 'planPc', planLabel: 'Pc/Sm/Pm Order', act: 'orderActualPc', actLabel: 'Pc/Sm Order Actual', who: 'pc', role: 'PC' },
      { t: 'Thu mua đặt hàng', plan: c.buy, planKey: 'planBuy', planLabel: 'Mua hàng đặt hàng', act: 'orderActualPurchasing', actLabel: 'Order Actual Purchasing', who: 'buyer', role: 'Thu mua' },
      { t: 'Kế toán', plan: c.dueKT, planKey: 'planDueKT', planLabel: 'Order Due Kế Toán', act: 'orderActualAccounting', actLabel: 'Order Actual Kế Toán', who: 'accountant', role: 'Kế toán' },
      { t: 'Tiếp nhận tại site', plan: item.due, planLabel: 'Start At Site', site: true, act: 'actualAtSite', actLabel: 'Thực tế lắp tại site', who: 'siteReceiver', role: 'Tiếp nhận tại site' },
    ]
    const card = (title, ic, tone, keys, extra) => (
      <section className={'tk-pd-card g-' + tone}>
        <header><i aria-hidden="true">{Ic[ic]}</i><h3>{title}</h3>{extra}</header>
        <div className="tk-pd-cgrid">{keys.map(row)}</div>
      </section>
    )
    return (
      <div className="tk-pd v-groups">
        {/* Hàng tóm tắt: 1 khung liền, mỗi ô = biểu tượng + nhãn nhỏ + giá trị (ô From Today đổi màu theo hạn) */}
        <div className="tk-pd-sum">
          <div className={'k st t-' + (STATUS_TONE[c.status] || 'none')}><span><i><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22V4M4 4h12l-2 4 2 4H4" /></svg></i>Status</span>{c.status ? <span className={'tk-pd-pill st-' + STATUS_TONE[c.status]}>{c.status}</span> : <b>—</b>}</div>
          <div className="k pay"><span><i><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></svg></i>Thanh toán</span>{sel('payment', PAY_OPTS)}</div>
          <div className={'k ft' + fromCls}><span><i><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></i>From Today</span><b>{c.fromToday == null ? '—' : (c.fromToday > 0 ? '+' : '') + c.fromToday}<em> ngày</em></b></div>
          <div className="k dt"><span><i><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg></i>Pc/Sm/Pm Order</span><b>{fmtD(c.pcOrder) || '—'}</b></div>
          <div className="k dt"><span><i><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg></i>Mua hàng đặt hàng</span><b>{fmtD(c.buy) || '—'}</b></div>
          <div className="k dt"><span><i><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg></i>Order Due Kế Toán</span><b>{fmtD(c.dueKT) || '—'}</b></div>
        </div>

        {card('Thông tin đơn hàng', 'txt', 'main', ['item', 'productGroup', 'supplier', 'qty', 'valueSplit'])}
        {card('Hồ sơ & ghi chú', 'file', 'doc', ['sample', 'drawings', 'filesPm', 'filesContract', 'note'])}

        <section className="tk-pd-card g-flow">
          <header>
            <i aria-hidden="true">{Ic.date}</i><h3>Tiến độ đặt hàng</h3>
            <span className="hint" title="Order Due Kế Toán = Start At Site - Lead Time + Bù trừ · Mua hàng đặt hàng = Order Due Kế Toán - 7 ngày · Pc/Sm/Pm Order = Mua hàng đặt hàng - 3 ngày">{Ic.info}Kế hoạch tính lùi từ ngày lắp tại site</span>
          </header>
          <div className="tk-pd-steps">
            {steps.map((s, i) => {
              const act = s.act ? item[s.act] : null
              const ch = stepChip(s.plan, act)
              return (
                <div key={s.t} className={'st' + (act ? ' done' : '') + (ch ? ' c-' + ch[0] : '')}>
                  <div className="hd">
                    <b className="no">{act ? '✓' : i + 1}</b>
                    <strong>{s.t}</strong>
                    {ch && <em className="chip">{ch[1]}</em>}
                  </div>
                  <div className="kv">
                    <span title={s.planLabel}>Kế hoạch{!s.site && (item[s.planKey] ? <i className="man"> · sửa tay</i> : <i className="fxg"> ƒx</i>)}</span>
                    {s.site ? <Edit type="date" value={item.due} onSave={v => v && onPatch({ due: v })} /> : <PlanDate value={s.plan} override={item[s.planKey]} onSave={set(s.planKey)} />}
                  </div>
                  {s.act && <div className="kv"><span title={s.actLabel}>Thực tế</span><Edit type="date" value={act} onSave={v => onPatch({ [s.act]: v || '' })} /></div>}
                  <div className="who"><span>{s.role}</span><PeoplePick compact names={item[s.who]} onSave={set(s.who)} /></div>
                </div>
              )
            })}
          </div>
          <div className="tk-pd-cgrid">{['leadTime', 'timeOffset', 'fromToday', 'status'].map(row)}</div>
        </section>

        {card('Nhân sự phụ trách', 'user', 'people', ['pm', 'buyer', 'accountant', 'siteManager', 'pc', 'siteReceiver', 'createdBy', 'createdAt', 'project', 'timeline'])}
      </div>
    )
  }
  return <div className={'tk-pd v-' + view}>{view === 'columns' ? <div className="tk-pd-grid">{ORDER.map(row)}</div> : ORDER.map(row)}</div>
}
