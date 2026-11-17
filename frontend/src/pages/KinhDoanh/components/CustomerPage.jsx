import { useEffect, useRef, useState } from 'react'
import { STAGES, STAGE_LABEL, DEPT_LABEL } from '../../../data/kinhDoanhData'
import { useKdMap, saveKdOptions } from './ShortlistSelect'
import { fmtTy, stageAccent, lmInitials } from '../utils'
import { mediaUrl } from '../../QS/api/files'
import { MonthCalendar, TimeWheel } from './IosWheel'
import DatePicker from '../../../components/ui/DatePicker'

/* Trang khách hàng riêng: hồ sơ, tiến trình pipeline, lịch sử chăm sóc & chi tiết từng lần tương tác */
export const INTERACTION_TYPES = {
  call: { label: 'Gọi điện', color: 'var(--primary)', icon: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' },
  meeting: { label: 'Gặp mặt', color: 'var(--sales)', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8' },
  site: { label: 'Khảo sát công trình', color: 'var(--finance)', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  zalo: { label: 'Zalo / tin nhắn', color: '#0EA5E9', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  email: { label: 'Email', color: 'var(--qs)', icon: 'M4 4h16v16H4zM22 6l-10 7L2 6' },
  quote: { label: 'Gửi báo giá', color: 'var(--marketing)', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5' },
  note: { label: 'Ghi chú', color: 'var(--text-muted)', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
}
export const OUTCOMES = { good: ['Tích cực', 'var(--success)'], neutral: ['Đang cân nhắc', 'var(--gold)'], bad: ['Chưa hài lòng', 'var(--danger)'] }

const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmtD = iso => (iso ? iso.split('-').reverse().join('/') : '')
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
/* Bảng chi tiết bên phải (nút mở rộng ở Thông tin liên hệ, MarkUp 2026-11-16 16:32): nhớ đóng / mở theo trình duyệt */
const DETAIL_LS = 'kd-cp-detail'
const readDetail = () => { try { return localStorage.getItem(DETAIL_LS) === '1' } catch { return false } }
/* Thu gọn từng mục của cột Chi tiết (MarkUp 2026-11-16 17:05): {tai-lieu|hinh|tep: 1}, nhớ theo trình duyệt */
const FOLD_LS = 'kd-cp-dfold'
const readFold = () => { try { return JSON.parse(localStorage.getItem(FOLD_LS) || '{}') || {} } catch { return {} } }
function DSec({ id, title, fold, onFold, children }) {
  const off = !!fold[id]
  return (
    <div className={'kd-cp-dsec' + (off ? ' folded' : '')}>
      <span role="button" tabIndex={0} aria-expanded={!off} title={off ? 'Mở rộng' : 'Thu gọn'} onClick={() => onFold(id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFold(id) } }}>
        {title}<i className="kd-cp-dfold"><Ic d="m6 9 6 6 6-6" size={14} /></i>
      </span>
      {off ? null : children}
    </div>
  )
}
/* Đặt lịch hẹn với khách (MarkUp 2026-11-16 17:20): kdOptions.appt {mã lead: [{id, date, time, place, content, by}]},
   hiện trong "Lịch chăm sóc sắp tới" cùng các mốc hẹn tiếp của tương tác */
/* Thành viên của 1 lịch hẹn (MarkUp 2026-11-16 17:28): vòng tròn chữ tắt + nút "+" mở ô thêm người
   (gợi ý: người phụ trách / quản lý / người tạo khách hàng, hoặc gõ tên khác). Bấm vòng tròn = bỏ người đó. */
function ApptMembers({ list, people, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const off = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const add = n => { const t = String(n || '').trim(); if (t && list.indexOf(t) < 0) onChange(list.concat([t])); setQ('') }
  const goi = people.filter(p => list.indexOf(p) < 0 && (!q.trim() || p.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0))
  return (
    <span className="kd-cp-up-mem" ref={box}>
      {list.map(n => (
        <button key={n} type="button" className="kd-cp-av sm" title={n + ' - bấm để bỏ khỏi lịch hẹn'}
          onClick={() => { if (window.confirm('Bỏ ' + n + ' khỏi lịch hẹn?')) onChange(list.filter(x => x !== n)) }}>{lmInitials(n)}</button>
      ))}
      <button type="button" className="kd-cp-up-add" title="Thêm thành viên" aria-expanded={open} onClick={() => setOpen(o => !o)}>+</button>
      {open && (
        <div className="kd-cp-up-pop">
          <input autoFocus value={q} placeholder="Gõ tên rồi Enter…" onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(q) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) } }} />
          {goi.map(p => <button key={p} type="button" onClick={() => add(p)}><span className="kd-cp-av sm">{lmInitials(p)}</span>{p}</button>)}
          {!goi.length && !q.trim() && <em>Gõ tên người tham gia</em>}
          {q.trim() && people.indexOf(q.trim()) < 0 && <button type="button" onClick={() => add(q)}>+ Thêm "{q.trim()}"</button>}
        </div>
      )}
    </span>
  )
}
/* init: lịch hẹn đang sửa (null = đặt mới) */
function ApptModal({ onClose, onSave, init }) {
  const [a, setA] = useState(() => (init ? { date: init.date, time: init.time || '09:00', place: init.place || '', content: init.content || '' }
    : { date: new Date().toISOString().slice(0, 10), time: '09:00', place: '', content: '' }))
  const [open, setOpen] = useState('')   // bánh xe đang mở: 'date' | 'time' | ''
  const ok = a.date && (a.place.trim() || a.content.trim())
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const [yy, mm, dd] = a.date.split('-').map(Number)
  const save = () => { if (ok) onSave({ ...(init || {}), id: init ? init.id : 'a' + Date.now(), date: a.date, time: a.time, place: a.place.trim(), content: a.content.trim() }) }
  const toggle = k => setOpen(o => (o === k ? '' : k))
  /* kiểu iOS: thanh đầu Hủy | tiêu đề | Lưu; các dòng gom trong nhóm bo góc; bấm Ngày / Giờ = xổ bánh xe ngay dưới dòng */
  return (
    <div className="kd-appt-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ios-sheet" role="dialog" aria-modal="true" aria-label={init ? 'Sửa lịch hẹn' : 'Đặt lịch hẹn'}>
        <div className="ios-nav">
          <button type="button" className="ios-link" onClick={onClose}>Hủy</button>
          <b>{init ? 'Sửa lịch hẹn' : 'Đặt lịch hẹn'}</b>
          <button type="button" className="ios-link strong" disabled={!ok} onClick={save} title={ok ? '' : 'Nhập địa điểm hoặc nội dung'}>Lưu</button>
        </div>
        <div className="ios-body">
          <div className="ios-group">
            <div className="ios-row" onClick={() => toggle('date')}>
              <span className="ios-ic red"><Ic d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" size={14} /></span>
              <span className="ios-lbl">Ngày</span>
              <button type="button" className={'ios-pill' + (open === 'date' ? ' on' : '')}>{dd} thg {mm}, {yy}</button>
            </div>
            {open === 'date' && <div className="ios-wheel-box"><MonthCalendar value={a.date} onChange={v => setA(x => ({ ...x, date: v }))} /></div>}
            <div className="ios-row" onClick={() => toggle('time')}>
              <span className="ios-ic blue"><Ic d="M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" size={14} /></span>
              <span className="ios-lbl">Giờ</span>
              <button type="button" className={'ios-pill' + (open === 'time' ? ' on' : '')}>{a.time}</button>
            </div>
            {open === 'time' && <div className="ios-wheel-box"><TimeWheel value={a.time} onChange={v => setA(x => ({ ...x, time: v }))} /></div>}
          </div>
          <div className="ios-group">
            <label className="ios-row">
              <span className="ios-ic green"><Ic d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" size={14} /></span>
              <input className="ios-in" value={a.place} placeholder="Địa điểm" onFocus={() => setOpen('')} onChange={e => setA({ ...a, place: e.target.value })} />
            </label>
            <label className="ios-row top">
              <span className="ios-ic gray"><Ic d="M4 6h16M4 12h16M4 18h10" size={14} /></span>
              <textarea className="ios-in" rows={3} value={a.content} placeholder="Nội dung (mục đích buổi hẹn, cần chuẩn bị gì…)" onFocus={() => setOpen('')} onChange={e => setA({ ...a, content: e.target.value })} />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
const FILE_IC = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'

/* Lịch sử mẫu — sinh theo giai đoạn hiện tại của khách hàng */
export function seedInteractions(l) {
  const by = (l.assignees && l.assignees[0]?.name) || l.creator || 'Nhân viên KD'
  const start = l.createdAt || '2026-09-01'
  const idx = Math.max(0, STAGES.indexOf(l.stage))
  const steps = [
    { type: 'call', title: 'Cuộc gọi đầu tiên', content: `Khách liên hệ qua hotline, quan tâm ${(l.type || 'công trình').toLowerCase()} khoảng ${fmtTy(l.value)}. Đã giới thiệu năng lực & hẹn gặp.`, outcome: 'good' },
    { type: 'meeting', title: 'Gặp tư vấn tại văn phòng', content: 'Trao đổi nhu cầu, phong cách mong muốn, ngân sách & tiến độ dự kiến. Khách gửi bản vẽ hiện trạng.', outcome: 'good' },
    { type: 'site', title: 'Khảo sát hiện trạng', content: 'Đo đạc hiện trạng, chụp ảnh, ghi nhận vướng mắc về kết cấu & hạ tầng.', outcome: 'neutral' },
    { type: 'quote', title: 'Gửi báo giá thiết kế - khái toán', content: `Báo giá tổng ${fmtTy(l.value)}; khách xin thêm phương án vật liệu tiết kiệm.`, outcome: 'neutral' },
    { type: 'meeting', title: 'Đàm phán điều khoản', content: 'Thống nhất tiến độ thanh toán 30-40-30, khách đề nghị giảm 3%.', outcome: 'neutral' },
    { type: 'meeting', title: 'Ký hợp đồng', content: 'Khách ký hợp đồng, chuyển tạm ứng đợt 1.', outcome: 'good' },
  ]
  const n = l.stage === 'truot-thau' ? 3 : Math.min(steps.length, idx + 1)
  const list = steps.slice(0, n).map((s, i) => ({ id: `${l.id}-h${i}`, date: addDays(start, i * 4), by, ...s }))
  if (l.stage === 'truot-thau') list.push({ id: `${l.id}-lost`, date: addDays(start, 14), by, type: 'call', title: 'Khách chọn đơn vị khác', content: 'Khách phản hồi giá cao hơn đối thủ ~8%. Lưu hồ sơ để chăm sóc lại sau 6 tháng.', outcome: 'bad' })
  if (l.notes) list.push({ id: `${l.id}-note`, date: start, by: l.creator || by, type: 'note', title: 'Ghi chú khi tạo khách hàng', content: l.notes, outcome: '' })
  return list.sort((a, b) => b.date.localeCompare(a.date))
}

/* Dải giai đoạn: ẩn thanh cuộn mặc định; khi tràn thì hiện nút ‹ › + mờ mép, lăn chuột để cuộn ngang */
function FlowStrip({ stageKey, children }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  const update = () => { const el = ref.current; if (el) setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }) }
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    // đưa giai đoạn hiện tại vào tầm nhìn
    const now = el.querySelector('.now')
    if (now) el.scrollLeft = Math.max(0, now.offsetLeft - el.clientWidth / 2 + now.offsetWidth / 2)
    update()
    const onWheel = e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { e.preventDefault(); el.scrollLeft += e.deltaY } }
    el.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(update); ro.observe(el)
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect() }
  }, [stageKey])
  const step = dir => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.6, behavior: 'smooth' })
  return (
    <div className={`kd-cp-flowwrap${edge.l ? ' fade-l' : ''}${edge.r ? ' fade-r' : ''}`}>
      {edge.l && <button className="kd-cp-flownav l" onClick={() => step(-1)} aria-label="Cuộn trái"><Ic d="m15 18-6-6 6-6" size={14} /></button>}
      <div className="kd-cp-flow" ref={ref} onScroll={update}>{children}</div>
      {edge.r && <button className="kd-cp-flownav r" onClick={() => step(1)} aria-label="Cuộn phải"><Ic d="m9 18 6-6-6-6" size={14} /></button>}
    </div>
  )
}

/* Đánh giá tiềm năng 1-5 sao (lưu chung công ty: kdOptions.rating {mã lead: số sao}); bấm lại đúng số sao đang chọn = bỏ đánh giá.
   small: bản gọn trên thẻ Pipeline (không nhãn chữ, bấm không mở thẻ / không kéo thẻ) */
const RATE_LABEL = ['', 'Rất thấp', 'Thấp', 'Trung bình', 'Cao', 'Rất cao']
export function RatingStars({ id, small }) {
  const map = useKdMap('rating')
  const v = Number(map[id]) || 0
  const [hov, setHov] = useState(0)
  const set = n => { const m = { ...map }; if (n === v) delete m[id]; else m[id] = n; saveKdOptions('rating', m) }
  const show = hov || v
  return (
    <span className={'kd-cp-stars' + (small ? ' sm' : '')} onMouseLeave={() => setHov(0)} title={v ? 'Trạng thái giao tiếp: ' + RATE_LABEL[v] + ' (bấm lại để bỏ)' : 'Đánh giá trạng thái giao tiếp'}
      onClick={small ? e => e.stopPropagation() : undefined} draggable={small ? false : undefined} onDragStart={small ? e => { e.preventDefault(); e.stopPropagation() } : undefined}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={n <= show ? 'on' : ''} onMouseEnter={() => setHov(n)} onClick={() => set(n)} aria-label={n + ' sao'}>
          <svg width={small ? 13 : 16} height={small ? 13 : 16} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
        </button>
      ))}
      {/* chỉ hiện sao, không kèm chữ (MarkUp 2026-11-16 17:00); mức chữ xem ở chú thích khi rê chuột */}
    </span>
  )
}

const Ic = ({ d, size = 15 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>

export default function CustomerPage({ lead: l, interactions, onAddInteraction, onBack, onEdit, onMove, onSetCreated, me }) {
  const [suaNgay, setSuaNgay] = useState(false)   // đang sửa Ngày tạo
  const blank = () => ({ type: 'call', date: new Date().toISOString().slice(0, 10), title: '', content: '', outcome: 'good', next: '', nextNote: '' })
  const [f, setF] = useState(blank)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('all')
  const [detail, setDetailRaw] = useState(readDetail)
  const [fold, setFoldRaw] = useState(readFold)
  const onFold = id => setFoldRaw(m => { const n = { ...m }; if (n[id]) delete n[id]; else n[id] = 1; try { localStorage.setItem(FOLD_LS, JSON.stringify(n)) } catch { /* bỏ qua */ } return n })
  const setDetail = v => { setDetailRaw(v); try { localStorage.setItem(DETAIL_LS, v ? '1' : '0') } catch { /* bỏ qua */ } }
  const geoMap = useKdMap('geo')
  const projNameMap = useKdMap('projName')
  const attachMap = useKdMap('attach')
  const apptMap = useKdMap('appt')
  const [apptOpen, setApptOpen] = useState(false)   // false | true (đặt mới) | {lịch hẹn đang sửa}
  const [upEdit, setUpEdit] = useState(false)       // chế độ sửa của khung Lịch chăm sóc sắp tới (MarkUp 2026-11-16 17:31)
  const timelineMap = useKdMap('timeline')
  // đổi khách khi trang đang mở (bấm thông báo ở chuông): bỏ form / chế độ sửa / hộp lịch hẹn của khách cũ
  useEffect(() => { setAdding(false); setFilter('all'); setUpEdit(false); setApptOpen(false) }, [l?.id])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role=dialog]')) { if (adding) setAdding(false); else onBack() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [adding, onBack])
  if (!l) return null

  const accent = stageAccent(l.stage)
  const geo = geoMap[String(l.id)] || {}
  const tinhThanh = [geo.kv, geo.tinh].filter(Boolean).join(' · ')
  const projName = projNameMap[String(l.id)] || ''
  const att = attachMap[String(l.id)] || {}
  const imgs = att.img || [], docs = att.file || []
  const tl = timelineMap[String(l.id)] || {}
  const list = interactions.filter(x => filter === 'all' || x.type === filter)
  const appts = Array.isArray(apptMap[String(l.id)]) ? apptMap[String(l.id)] : []
  const apptNote = a => [a.time, a.place, a.content].filter(Boolean).join(' · ')
  const upcoming = interactions.filter(x => x.next).map(x => ({ date: x.next, note: x.nextNote || `Theo dõi sau: ${x.title}`, from: x }))
    .concat(appts.map(a => ({ date: a.date, sort: a.date + ' ' + (a.time || ''), note: apptNote(a), appt: a })))
    .sort((a, b) => (a.sort || a.date).localeCompare(b.sort || b.date))
  const saveAppt = a => {
    const list = appts.some(x => x.id === a.id) ? appts.map(x => (x.id === a.id ? a : x)) : appts.concat([{ ...a, by: me || '' }])
    saveKdOptions('appt', { ...apptMap, [String(l.id)]: list }); setApptOpen(false)
  }
  const people = [...new Set([me, l.manager, l.creator, ...(l.assignees || []).map(x => x && x.name)].map(x => String(x || '').trim()).filter(Boolean))]
  const setApptMembers = (id, members) => saveKdOptions('appt', { ...apptMap, [String(l.id)]: appts.map(x => (x.id === id ? { ...x, members } : x)) })
  const delAppt = id => {
    if (!window.confirm('Xoá lịch hẹn này?')) return
    const left = appts.filter(x => x.id !== id); const m = { ...apptMap }
    if (left.length) m[String(l.id)] = left; else delete m[String(l.id)]
    saveKdOptions('appt', m)
  }
  const last = interactions[0]
  const flow = STAGES.filter(s => s !== 'khong-tham-gia' && s !== 'truot-thau' && s !== 'spam')
  const cur = flow.indexOf(l.stage)
  const counts = Object.fromEntries(Object.keys(INTERACTION_TYPES).map(k => [k, interactions.filter(x => x.type === k).length]))
  function save() {
    if (!f.title.trim() && !f.content.trim()) return
    onAddInteraction({ ...f, id: 'i' + Date.now(), by: me, title: f.title.trim() || INTERACTION_TYPES[f.type].label, content: f.content.trim() })
    setF(blank()); setAdding(false)
  }

  return (
    <div className={'kd-cp' + (detail ? ' detail-open' : '')}>
      <div className="kd-cp-head">
        <button className="kd-cp-back" onClick={onBack} title="Quay lại (Esc)"><Ic d="M19 12H5M12 19l-7-7 7-7" />Khách hàng</button>
        <div className="kd-cp-title">
          {/* tiêu đề = tên dự án (chưa có thì tên khách hàng); tên khách hàng ở Thông tin liên hệ (MarkUp 2026-11-16 16:42) */}
          <h2 title={projName ? 'Dự án: ' + projName : l.name}>{projName || l.name}</h2>
          <div><span className="kd-cp-stage" style={{ background: accent ? accent.bg : 'var(--sales-tint)', color: accent ? accent.color : 'var(--sales)' }}>{STAGE_LABEL[l.stage]}</span><span>{l.type} · {fmtTy(l.value)} · {DEPT_LABEL[l.dept]}</span></div>
        </div>
        <span style={{ flex: 1 }} />
        {l.phone && <a className="kd-cp-btn" href={`tel:${l.phone.replace(/\s/g, '')}`}><Ic d={INTERACTION_TYPES.call.icon} size={14} />Gọi</a>}
      </div>

      {/* tiến trình pipeline */}
      <FlowStrip stageKey={l.stage}>
        {flow.map((s, i) => (
          <button key={s} className={`kd-cp-step${i < cur ? ' done' : ''}${i === cur ? ' now' : ''}`} onClick={() => onMove(l.id, s)} title={`Chuyển sang "${STAGE_LABEL[s]}"`}>
            <i>{i < cur ? '✓' : i + 1}</i><span>{STAGE_LABEL[s]}</span>
          </button>
        ))}
        {l.stage === 'truot-thau' && <span className="kd-cp-lost">Đã trượt thầu</span>}
        {l.stage === 'spam' && <span className="kd-cp-lost">Spam</span>}
        {l.stage === 'khong-tham-gia' && <span className="kd-cp-lost">Không tham gia</span>}
      </FlowStrip>

      <div className="kd-cp-body">
        <aside className="kd-cp-side">
          <section>
            <h4>Thông tin liên hệ
              <button type="button" className="kd-cp-edit" title="Sửa thông tin khách hàng" aria-label="Sửa thông tin" onClick={onEdit}>
                <Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={14} />
              </button>
              <button type="button" className={'kd-cp-edit kd-cp-expand' + (detail ? ' on' : '')} aria-expanded={detail} onClick={() => setDetail(!detail)}
                title={detail ? 'Đóng bảng chi tiết' : 'Mở bảng chi tiết bên phải (tài liệu, đính kèm, ghi chú)'}>
                <Ic d={detail ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} size={15} />
              </button>
            </h4>
            <dl>
              <dt>Tên khách hàng</dt><dd>{l.name || '—'}</dd>
              <dt>Điện thoại</dt><dd>{l.phone || '—'}</dd>
              <dt>Email</dt><dd>{l.email || '—'}</dd>
              <dt>Tỉnh thành</dt><dd>{tinhThanh || '—'}</dd>
              <dt>Địa chỉ</dt><dd>{l.address || '—'}</dd>
              <dt>Nguồn</dt><dd>{l.source || '—'}</dd>
              <dt>Trạng thái giao tiếp</dt><dd><RatingStars id={String(l.id)} /></dd>
            </dl>
          </section>
          <section>
            <h4>Dự án quan tâm
              {/* nút sửa ở mọi khung thông tin (MarkUp 2026-11-16 18:08) */}
              <button type="button" className="kd-cp-edit" title="Sửa thông tin khách hàng" aria-label="Sửa dự án quan tâm" onClick={onEdit}>
                <Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={14} />
              </button>
            </h4>
            <dl>
              <dt>Loại dự án</dt><dd>{l.projectType || l.type}</dd>
              <dt>Quy mô</dt><dd>{l.scale || '—'}</dd>
              <dt>Giá trị ước tính</dt><dd className="kd-cp-money">{fmtTy(l.value)}</dd>
              <dt>Khởi công</dt><dd>{tl.start ? fmtD(tl.start) : '—'}</dd>
              <dt>Hoàn công</dt><dd>{tl.end ? fmtD(tl.end) : '—'}</dd>
              <dt>Ngày tạo</dt>
              <dd className="kd-cp-ngay">
                {suaNgay && onSetCreated ? (
                  <>
                    <DatePicker value={l.createdAt || ''} max={todayIso()} ariaLabel="Ngày tạo" onChange={d => { if (d) onSetCreated(d); setSuaNgay(false) }} />
                    <button type="button" className="kd-cp-ngay-x" title="Huỷ" aria-label="Huỷ sửa ngày tạo" onClick={() => setSuaNgay(false)}>×</button>
                  </>
                ) : (
                  <>
                    {fmtD(l.createdAt)}
                    {onSetCreated && (
                      <button type="button" className="kd-cp-ngay-btn" title="Sửa ngày tạo" aria-label="Sửa ngày tạo" onClick={() => setSuaNgay(true)}>
                        <Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={12} />
                      </button>
                    )}
                  </>
                )}
              </dd>
            </dl>
            {l.categories?.length > 0 && <div className="kd-cp-tags">{l.categories.map(c => <span key={c}>{c}</span>)}</div>}
          </section>
          <section>
            <h4>Phụ trách
              {/* nút sửa ở mọi khung thông tin (MarkUp 2026-11-16 18:08) */}
              <button type="button" className="kd-cp-edit" title="Sửa thông tin khách hàng" aria-label="Sửa phụ trách" onClick={onEdit}>
                <Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={14} />
              </button>
            </h4>
            <div className="kd-cp-people">
              {[['Phòng', DEPT_LABEL[l.dept]], ['Khởi tạo', l.creator], ['Quản lý', l.manager], ...(l.assignees || []).map(a => [a.role || 'Phụ trách', a.name])].filter(x => x[1]).map(([r, n], i) => (
                <div key={i}><span className="kd-cp-av sm">{lmInitials(n)}</span><span><b>{n}</b><em>{r}</em></span></div>
              ))}
            </div>
          </section>
          <section>
            <h4>Tổng quan chăm sóc</h4>
            <div className="kd-cp-stats">
              <div><b>{interactions.length}</b><span>lần tương tác</span></div>
              <div><b>{last ? fmtD(last.date) : '—'}</b><span>liên hệ gần nhất</span></div>
            </div>
            <div className="kd-cp-mini">{Object.entries(INTERACTION_TYPES).filter(([k]) => counts[k]).map(([k, t]) => <span key={k} style={{ color: t.color }}><Ic d={t.icon} size={12} />{counts[k]}</span>)}</div>
          </section>
        </aside>

        {/* Cột Chi tiết = cột thứ 2, cạnh cột thông tin (MarkUp 2026-11-16 16:49): mở / đóng bằng nút mở rộng */}
        {detail && (
          <aside className="kd-cp-detail" aria-label="Chi tiết khách hàng">
            <div className="kd-cp-card">
              <div className="kd-cp-detail-h"><h3>Chi tiết</h3>
                <button type="button" className="kd-cp-edit" title="Đóng" onClick={() => setDetail(false)}><Ic d="M18 6 6 18M6 6l12 12" size={14} /></button>
              </div>
              <DSec id="tai-lieu" title="Tài liệu & ghi chú" fold={fold} onFold={onFold}>
                {l.boqFile && <div className="kd-cp-file"><Ic d={FILE_IC} />{l.boqFile}</div>}
                {l.concept && <p className="kd-cp-note"><b>Concept:</b>{l.concept}</p>}
                {l.notes && <p className="kd-cp-note"><b>Ghi chú nội bộ:</b>{l.notes}</p>}
                {!l.boqFile && !l.concept && !l.notes && <em className="kd-cp-dnone">Chưa có BOQ, concept hay ghi chú</em>}
              </DSec>
              <DSec id="hinh" title={'Hình đính kèm' + (imgs.length ? ' (' + imgs.length + ')' : '')} fold={fold} onFold={onFold}>
                {imgs.length ? (
                  <div className="kd-cp-imgs">{imgs.map((it, i) => <a key={i} href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" title={it.name}><img src={mediaUrl(it.url)} alt={it.name} /></a>)}</div>
                ) : <em className="kd-cp-dnone">Chưa có hình</em>}
              </DSec>
              <DSec id="tep" title={'Tệp đính kèm' + (docs.length ? ' (' + docs.length + ')' : '')} fold={fold} onFold={onFold}>
                {docs.length ? docs.map((it, i) => (
                  <a key={i} className="kd-cp-file" href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" title={it.name}><Ic d={FILE_IC} /><span>{it.name}</span></a>
                )) : <em className="kd-cp-dnone">Chưa có tệp</em>}
              </DSec>
              <button type="button" className="kd-cp-btn" onClick={onEdit} style={{ marginTop: 4 }}><Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={13} />Sửa / thêm tài liệu</button>
            </div>
          </aside>
        )}

        <main className="kd-cp-main">
          {upcoming.length > 0 && (
            <div className="kd-cp-card kd-cp-upcoming">
              <div className="kd-cp-up-h"><h3>Lịch chăm sóc sắp tới</h3>
                {/* nút sửa: bật chế độ sửa -> mỗi lịch hẹn có nút bút (mở hộp sửa) và nút xoá */}
                {appts.length > 0 && (
                  <button type="button" className={'kd-cp-edit' + (upEdit ? ' on' : '')} aria-pressed={upEdit}
                    title={upEdit ? 'Xong' : 'Sửa lịch hẹn'} onClick={() => setUpEdit(v => !v)}>
                    <Ic d={upEdit ? 'M20 6 9 17l-5-5' : 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'} size={14} />
                  </button>
                )}
              </div>
              {upcoming.map((u, i) => (
                <div key={i} className={'kd-cp-up' + (u.appt ? ' appt' : '')}><span className="kd-cp-up-date">{fmtD(u.date)}</span>
                  {u.appt && <span className="kd-cp-up-tag">Lịch hẹn</span>}<span>{u.note}</span>
                  {u.appt && <ApptMembers list={u.appt.members || []} people={people} onChange={m => setApptMembers(u.appt.id, m)} />}
                  {u.appt && upEdit && <button type="button" className="kd-cp-up-x ed" title="Sửa lịch hẹn" onClick={() => setApptOpen(u.appt)}><Ic d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" size={13} /></button>}
                  {u.appt && upEdit && <button type="button" className="kd-cp-up-x" title="Xoá lịch hẹn" onClick={() => delAppt(u.appt.id)}>×</button>}
                </div>
              ))}
            </div>
          )}

          {adding && (
            <div className="kd-cp-card kd-cp-form">
              <h3>Ghi nhận tương tác mới</h3>
              <div className="kd-cp-types">
                {Object.entries(INTERACTION_TYPES).map(([k, t]) => (
                  <button key={k} type="button" className={f.type === k ? 'active' : ''} style={{ '--c': t.color }} onClick={() => setF({ ...f, type: k })}><Ic d={t.icon} size={13} />{t.label}</button>
                ))}
              </div>
              <div className="kd-cp-grid">
                <label><span>Ngày</span><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
                <label><span>Tiêu đề</span><input autoFocus value={f.title} placeholder={INTERACTION_TYPES[f.type].label} onChange={e => setF({ ...f, title: e.target.value })} /></label>
                <label className="full"><span>Nội dung trao đổi</span><textarea rows={3} value={f.content} placeholder="Khách hỏi gì, đã tư vấn gì, phản hồi của khách…" onChange={e => setF({ ...f, content: e.target.value })} /></label>
                <div className="full"><span>Kết quả</span>
                  <div className="kd-cp-outcomes">{Object.entries(OUTCOMES).map(([k, [lab, c]]) => <button key={k} type="button" className={f.outcome === k ? 'active' : ''} style={{ '--c': c }} onClick={() => setF({ ...f, outcome: k })}>{lab}</button>)}</div>
                </div>
                <label><span>Hẹn chăm sóc tiếp</span><input type="date" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
                <label><span>Việc cần làm</span><input value={f.nextNote} placeholder="VD: Gửi phương án vật liệu 2" onChange={e => setF({ ...f, nextNote: e.target.value })} /></label>
              </div>
              <div className="kd-cp-form-foot"><button className="kd-cp-btn" onClick={() => setAdding(false)}>Hủy</button><button className="kd-cp-btn primary" disabled={!f.title.trim() && !f.content.trim()} onClick={save}>Lưu tương tác</button></div>
            </div>
          )}

          <div className="kd-cp-card">
            <div className="kd-cp-tl-head">
              <h3>Lịch sử chăm sóc</h3>
              <button className="kd-cp-btn primary" onClick={() => setAdding(true)}><Ic d="M12 5v14M5 12h14" size={14} />Ghi nhận tương tác</button>
              <button className="kd-cp-btn" onClick={() => setApptOpen(true)} title="Hẹn gặp khách: thời gian, địa điểm, nội dung"><Ic d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" size={14} />Đặt lịch hẹn</button>
              <span style={{ flex: 1 }} />
              <div className="kd-cp-filter">
                <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tất cả ({interactions.length})</button>
                {Object.entries(INTERACTION_TYPES).filter(([k]) => counts[k]).map(([k, t]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{t.label} ({counts[k]})</button>)}
              </div>
            </div>
            {list.length === 0 && (
              <div className="kd-cp-empty">
                <span className="ic"><Ic d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" size={22} /></span>
                <b>Chưa có tương tác nào{filter !== 'all' ? ' thuộc loại này' : ''}</b>
                <span>Ghi lại cuộc gọi, tin nhắn, buổi gặp… để cả nhóm theo dõi quá trình chăm sóc khách hàng.</span>
                <button className="kd-cp-btn primary" onClick={() => setAdding(true)}><Ic d="M12 5v14M5 12h14" size={14} />Ghi nhận tương tác đầu tiên</button>
              </div>
            )}
            <ol className="kd-cp-tl">
              {list.map(x => {
                const t = INTERACTION_TYPES[x.type] || INTERACTION_TYPES.note
                const o = OUTCOMES[x.outcome]
                return (
                  <li key={x.id} style={{ '--c': t.color }}>
                    <div className="kd-cp-tl-body">
                      <div className="kd-cp-tl-top"><span className="kd-cp-tl-ic"><Ic d={t.icon} size={13} /></span><b>{x.title}</b><span className="kd-cp-tl-type">{t.label}</span>{o && <em style={{ color: o[1], background: `color-mix(in srgb, ${o[1]} 14%, transparent)` }}>{o[0]}</em>}<span className="kd-cp-tl-date">{fmtD(x.date)}</span></div>
                      {x.content && <p>{x.content}</p>}
                      <div className="kd-cp-tl-by"><span className="kd-cp-av sm">{lmInitials(x.by)}</span>{x.by}{x.next && <span className="kd-cp-tl-next">· Hẹn tiếp {fmtD(x.next)}{x.nextNote ? `: ${x.nextNote}` : ''}</span>}</div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

        </main>
        {apptOpen && <ApptModal key={apptOpen === true ? 'new' : apptOpen.id} init={apptOpen === true ? null : apptOpen} onClose={() => setApptOpen(false)} onSave={saveAppt} />}
      </div>
    </div>
  )
}
