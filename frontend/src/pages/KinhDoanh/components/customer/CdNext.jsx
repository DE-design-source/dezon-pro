import { useCallback, useEffect, useRef, useState } from 'react'
import { listAppointments, addAppointment, updateAppointment, deleteAppointment, emitLeadChange, useLeadChange } from '../../customerApi'
import { useKdMap, saveKdOptions } from '../ShortlistSelect'
import { MonthCalendar, TimeWheel } from '../IosWheel'
import { lmInitials } from '../../utils'
import { Ic, IC_EDIT, IC_X, IC_PLUS, IC_CAL, pad2, todayIso, fmtD, daysBetween, weekdayOf, peopleOf, isSystemEntry } from './CdCare'
import './care.css'
import './side2.css'

/* Thu gọn / mở rộng thẻ (nhớ theo trình duyệt, mặc định thu gọn để cột 2 không dài hơn hẳn cột Hồ sơ) */
function useFoldPref(key) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1' } catch (e) { return false } })
  const toggle = () => setOpen(v => { const n = !v; try { localStorage.setItem(key, n ? '1' : '0') } catch (e) { /* bỏ qua */ } return n })
  return [open, toggle]
}
const FOLD_D = { open: 'M18 15l-6-6-6 6', closed: 'M6 9l6 6 6-6' }
function FoldBtn({ open, onClick, light }) {
  return (
    <button type="button" className={'cd-fold-btn' + (light ? ' light' : '')} aria-expanded={open} title={open ? 'Thu gọn' : 'Mở rộng'} onClick={onClick}>
      {open ? 'Thu gọn' : 'Mở rộng'}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={open ? FOLD_D.open : FOLD_D.closed} /></svg>
    </button>
  )
}

/* Khối "Việc tiếp theo": lịch hẹn sớm nhất còn hiệu lực (đếm ngược, người tham gia, địa điểm, mục tiêu, checklist chuẩn bị,
   Dời lịch, Nhắc khách qua Zalo) + các lịch hẹn khác + mốc "Hẹn tiếp" của lịch sử chăm sóc. Lịch hẹn lưu database (/sales/leads/:id/appointments).
   Lịch hẹn cũ trong kdOptions.appt (bản trước) được chuyển vào database 1 lần rồi xoá khỏi kdOptions. */

export const MODES = ['Họp trực tiếp', 'Tại công trình', 'Gọi video', 'Gọi điện']
const MODE_KEY = { offline: 'Họp trực tiếp', 'truc-tiep': 'Họp trực tiếp', site: 'Tại công trình', 'cong-trinh': 'Tại công trình', online: 'Gọi video', video: 'Gọi video', call: 'Gọi điện', phone: 'Gọi điện' }
const modeLabel = m => MODE_KEY[m] || m || ''
/* cộng n phút; quá 23:59 (sang ngày hôm sau) -> '' = không đặt giờ kết thúc */
const addMin = (hhmm, n) => {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number)
  const t = (h || 0) * 60 + (m || 0) + n
  if (t > 23 * 60 + 59) return ''
  return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60)
}
const sortKey = a => String(a.date || '') + ' ' + String(a.start || '')
const IC_PIN = 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
const IC_CLOCK = 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'
const IC_TXT = 'M4 6h16M4 12h16M4 18h10'
const IC_CHECK = 'M20 6 9 17l-5-5'

/* lịch hẹn cũ (kdOptions.appt: {id, date, time, place, content, by, members}) -> lịch hẹn database */
function fromLegacy(a) {
  const content = String(a.content || '').trim()
  const first = content.split('\n')[0].trim()
  const start = /^\d{2}:\d{2}$/.test(a.time || '') ? a.time : '09:00'
  return {
    date: a.date, start, end: addMin(start, 60),
    title: first ? (first.length > 80 ? first.slice(0, 77).trimEnd() + '…' : first) : (a.place ? 'Hẹn gặp tại ' + a.place : 'Lịch hẹn'),
    mode: '', place: String(a.place || '').trim(), goal: content,
    members: Array.isArray(a.members) ? a.members : [], prep: [], status: 'planned', by: String(a.by || '').trim(),
  }
}
const migrating = new Set()   // mã khách đang chuyển lịch hẹn cũ (tránh chạy 2 lần cùng lúc)

/* Thành viên của 1 lịch hẹn: vòng tròn chữ tắt + "+" mở ô thêm người (gợi ý: người liên quan, hoặc gõ tên khác).
   Bấm vòng tròn = bỏ người đó. */
export function ApptMembers({ list, people, onChange, dark }) {
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
    <span className={'cd-cmem' + (dark ? ' dark' : '')} ref={box}>
      {list.map(n => (
        <button key={n} type="button" className="cd-cav" title={n + ' - bấm để bỏ khỏi lịch hẹn'}
          onClick={() => { if (window.confirm('Bỏ ' + n + ' khỏi lịch hẹn?')) onChange(list.filter(x => x !== n)) }}>{lmInitials(n)}</button>
      ))}
      <button type="button" className="cd-cmem-add" title="Thêm thành viên" aria-label="Thêm thành viên" aria-expanded={open} onClick={() => setOpen(o => !o)}>+</button>
      {open && (
        <div className="cd-cmem-pop">
          <input autoFocus value={q} placeholder="Gõ tên rồi Enter…" onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(q) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) } }} />
          {goi.map(p => <button key={p} type="button" onClick={() => add(p)}><span className="cd-cav">{lmInitials(p)}</span>{p}</button>)}
          {!goi.length && !q.trim() && <em>Gõ tên người tham gia</em>}
          {q.trim() && people.indexOf(q.trim()) < 0 && <button type="button" onClick={() => add(q)}>+ Thêm "{q.trim()}"</button>}
        </div>
      )}
    </span>
  )
}

/* Hộp đặt / dời lịch hẹn kiểu iOS (dùng lại lớp .ios-* của KinhDoanh.css). init = lịch đang sửa (null = đặt mới);
   seed = giá trị gợi ý cho lịch mới; focus = 'date' để mở sẵn lịch tháng (Dời lịch) */
function ApptSheet({ init, seed, focus, people, me, onClose, onSave }) {
  const [a, setA] = useState(() => {
    const s = init || seed || {}
    const start = s.start || '09:00'
    return {
      date: s.date || todayIso(), start, end: s.end || addMin(start, 60), title: s.title || '', mode: modeLabel(s.mode) || (init ? '' : MODES[0]),
      place: s.place || '', goal: s.goal || '', members: Array.isArray(s.members) ? s.members : (me ? [me] : []),
    }
  })
  const [open, setOpen] = useState(focus || '')
  const [busy, setBusy] = useState(false)
  const badEnd = !!a.end && a.end <= a.start
  const ok = a.date && (a.title.trim() || a.place.trim() || a.goal.trim()) && !badEnd
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const [yy, mm, dd] = a.date.split('-').map(Number)
  const toggle = k => setOpen(o => (o === k ? '' : k))
  const save = async () => {
    if (!ok || busy) return
    setBusy(true)
    try {
      await onSave({ date: a.date, start: a.start, end: a.end, title: a.title.trim() || 'Lịch hẹn', mode: a.mode, place: a.place.trim(), goal: a.goal.trim(), members: a.members })
    } finally { setBusy(false) }
  }
  const setStart = v => setA(x => ({ ...x, start: v, end: !x.end || x.end <= v ? addMin(v, 60) : x.end }))
  const ttl = init ? 'Dời / sửa lịch hẹn' : 'Đặt lịch hẹn'
  return (
    <div className="kd-appt-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ios-sheet" role="dialog" aria-modal="true" aria-label={ttl}>
        <div className="ios-nav">
          <button type="button" className="ios-link" onClick={onClose}>Hủy</button>
          <b>{ttl}</b>
          <button type="button" className="ios-link strong" disabled={!ok || busy} onClick={save}
            title={ok ? '' : (badEnd ? 'Giờ kết thúc phải sau giờ bắt đầu' : 'Nhập tiêu đề, địa điểm hoặc mục tiêu')}>Lưu</button>
        </div>
        <div className="ios-body">
          <div className="ios-group">
            <label className="ios-row">
              <span className="ios-ic gray"><Ic d={IC_TXT} size={14} /></span>
              <input className="ios-in" autoFocus={!focus} value={a.title} placeholder="Tiêu đề (VD: Trình bày concept 3D)" onFocus={() => setOpen('')} onChange={e => setA({ ...a, title: e.target.value })} />
            </label>
          </div>
          <div className="ios-group">
            <div className="ios-row" onClick={() => toggle('date')}>
              <span className="ios-ic red"><Ic d={IC_CAL} size={14} /></span>
              <span className="ios-lbl">Ngày</span>
              <button type="button" className={'ios-pill' + (open === 'date' ? ' on' : '')}>{weekdayOf(a.date)}, {dd} thg {mm}, {yy}</button>
            </div>
            {open === 'date' && <div className="ios-wheel-box"><MonthCalendar value={a.date} onChange={v => setA(x => ({ ...x, date: v }))} /></div>}
            <div className="ios-row" onClick={() => toggle('start')}>
              <span className="ios-ic blue"><Ic d={IC_CLOCK} size={14} /></span>
              <span className="ios-lbl">Bắt đầu</span>
              <button type="button" className={'ios-pill' + (open === 'start' ? ' on' : '')}>{a.start}</button>
            </div>
            {open === 'start' && <div className="ios-wheel-box"><TimeWheel value={a.start} onChange={setStart} /></div>}
            <div className="ios-row" onClick={() => toggle('end')}>
              <span className="ios-ic blue"><Ic d={IC_CLOCK} size={14} /></span>
              <span className="ios-lbl">Kết thúc</span>
              <button type="button" className={'ios-pill' + (open === 'end' ? ' on' : '')}>{a.end || '—'}</button>
            </div>
            {open === 'end' && <div className="ios-wheel-box"><TimeWheel value={a.end || addMin(a.start, 60) || '23:59'} onChange={v => setA(x => ({ ...x, end: v }))} /></div>}
            {badEnd && <div className="ios-row cd-sheet-err" role="alert">Giờ kết thúc ({a.end}) phải sau giờ bắt đầu ({a.start}) - chỉnh lại giờ để Lưu được</div>}
          </div>
          <div className="ios-group">
            <div className="ios-row cd-sheet-modes">
              {MODES.map(m => (
                <button key={m} type="button" className={a.mode === m ? 'on' : ''} aria-pressed={a.mode === m} onClick={() => setA(x => ({ ...x, mode: x.mode === m ? '' : m }))}>{m}</button>
              ))}
            </div>
            <label className="ios-row">
              <span className="ios-ic green"><Ic d={IC_PIN} size={14} /></span>
              <input className="ios-in" value={a.place} placeholder="Địa điểm" onFocus={() => setOpen('')} onChange={e => setA({ ...a, place: e.target.value })} />
            </label>
            <label className="ios-row top">
              <span className="ios-ic gray"><Ic d={IC_CHECK} size={14} /></span>
              <textarea className="ios-in" rows={2} value={a.goal} placeholder="Mục tiêu (VD: Chốt hợp đồng thiết kế)" onFocus={() => setOpen('')} onChange={e => setA({ ...a, goal: e.target.value })} />
            </label>
            <div className="ios-row cd-sheet-mem">
              <span className="ios-lbl">Tham gia</span>
              <ApptMembers list={a.members} people={people} onChange={m => setA(x => ({ ...x, members: m }))} />
            </div>
          </div>
          {!ok && !badEnd && <div className="cd-sheet-err">Nhập tiêu đề, địa điểm hoặc mục tiêu để Lưu được</div>}
        </div>
      </div>
    </div>
  )
}

const firstPhone = s => { const m = String(s || '').match(/\+?\d[\d\s.-]{7,}\d/); return m ? m[0].replace(/[^\d+]/g, '').replace(/^\+84/, '0') : '' }

export default function CdNext({ lead, me, interactions, people }) {
  const leadId = lead ? lead.id : ''
  const key = String(leadId)
  const [appts, setAppts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [sheet, setSheet] = useState(null)      // {init, seed, focus}
  const [prepText, setPrepText] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [open, toggle] = useFoldPref('kd-cd-next-open')
  // Menu "⋯" trên dải xanh: Dời lịch, Nhắc khách qua Zalo, Đã xong, Huỷ lịch, Xoá (thân thẻ chỉ còn nút "+ Tạo lịch mới")
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menu) return undefined
    const off = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false) }
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(false) } }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true) }
  }, [menu])
  const [copied, setCopied] = useState(false)
  const apptMap = useKdMap('appt')
  const mapRef = useRef(apptMap)
  mapRef.current = apptMap
  const legacy = Array.isArray(apptMap[key]) ? apptMap[key] : []

  const load = useCallback(() => {
    if (!leadId) return Promise.resolve()
    return listAppointments(leadId).then(list => { setAppts(Array.isArray(list) ? list : []); setErr(''); setLoaded(true) },
      e => { setErr('Lỗi tải lịch hẹn: ' + ((e && e.message) || e)); setLoaded(true) })
  }, [leadId])
  useEffect(() => { setAppts([]); setLoaded(false); setSheet(null); setShowPast(false); setPrepText(''); load() }, [load])
  // báo khối khác sau khi chính khối này ghi: bỏ qua sự kiện của mình (đã tự tải lại), tránh GET 2 lần
  const selfEmit = useRef(false)
  const emitSelf = id => { selfEmit.current = true; try { emitLeadChange(id, 'appointments') } finally { selfEmit.current = false } }
  useLeadChange(leadId, ['appointments'], () => { if (!selfEmit.current) load() })
  // nút "Đặt lịch hẹn" ở khối khác của trang: window 'kd:open-appt' {leadId}
  useEffect(() => {
    const on = e => { const d = (e && e.detail) || {}; if (String(d.leadId) === key) setSheet({ init: null, seed: d.seed || null }) }
    window.addEventListener('kd:open-appt', on)
    return () => window.removeEventListener('kd:open-appt', on)
  }, [key])

  // chuyển lịch hẹn cũ của kdOptions vào database: từng mục, bỏ qua mục đã có (cùng ngày + giờ + tiêu đề), xong thì xoá khỏi kdOptions.
  // Mục lỗi (try/catch riêng) giữ lại trong kdOptions, các mục sau vẫn chuyển tiếp; lần mở sau thử lại mục lỗi.
  useEffect(() => {
    if (!loaded || err || !legacy.length || migrating.has(key)) return
    migrating.add(key)
    let cancelled = false
    ;(async () => {
      const done = []
      let added = 0
      try {
        for (const old of legacy) {
          if (!old || !/^\d{4}-\d{2}-\d{2}$/.test(old.date || '')) { done.push(old && old.id); continue }
          try {
            const a = fromLegacy(old)
            const dup = appts.some(x => x.date === a.date && x.start === a.start && String(x.title || '') === a.title)
            if (!dup) { await addAppointment(leadId, a); added++ }
            done.push(old.id)
          } catch (e) { /* mục này lỗi: giữ lại, chuyển tiếp mục sau */ }
        }
        if (done.length) {
          const m = { ...mapRef.current }
          const left = (Array.isArray(m[key]) ? m[key] : []).filter(x => !x || done.indexOf(x.id) < 0)
          if (left.length) m[key] = left; else delete m[key]
          await saveKdOptions('appt', m)
        }
      } catch (e) { /* lưu kdOptions lỗi: lần mở sau chạy lại, mục trùng tự bỏ qua */ }
      if (added && !cancelled) { await load(); emitSelf(leadId) }
      migrating.delete(key)
    })()
    return () => { cancelled = true }
  }, [loaded, err, legacy.length, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lead) return null
  const ppl = peopleOf(lead, me, people)
  const today = todayIso()
  const planned = appts.filter(a => (a.status || 'planned') === 'planned').sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  const upcoming = planned.filter(a => String(a.date) >= today)
  const overdue = planned.filter(a => String(a.date) < today)
  const past = appts.filter(a => a.status === 'done' || a.status === 'cancelled').sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  const next = upcoming[0] || overdue[overdue.length - 1] || null
  const nextLate = !!next && String(next.date) < today
  const others = upcoming.slice(1)
  const overdueRest = overdue.filter(a => a !== next)
  // mốc "Hẹn chăm sóc tiếp" ghi ở lịch sử chăm sóc: chưa tới hạn + quá hạn (quá hạn bỏ qua mốc đã có tương tác từ ngày hẹn trở đi)
  const acts = (interactions || []).filter(x => x && !isSystemEntry(x))
  const toFollow = x => ({ date: String(x.next).slice(0, 10), note: x.nextNote || 'Theo dõi sau: ' + x.title, from: x })
  const follow = acts.filter(x => x.next && String(x.next).slice(0, 10) >= today).map(toFollow).sort((a, b) => a.date.localeCompare(b.date))
  const followLate = acts.filter(x => x.next && String(x.next).slice(0, 10) < today).map(toFollow)
    .filter(f => !acts.some(y => y !== f.from && y.date && String(y.date).slice(0, 10) >= f.date))
    .sort((a, b) => a.date.localeCompare(b.date))

  const fail = e => { alert('Không lưu được lịch hẹn: ' + ((e && e.message) || e)); load() }
  const after = () => { emitSelf(leadId); return load() }
  const patch = (a, p) => {
    setAppts(list => list.map(x => (x.id === a.id ? { ...x, ...p } : x)))
    return updateAppointment(a.id, p).then(after, fail)
  }
  const saveSheet = async v => {
    try {
      if (sheet && sheet.init) await updateAppointment(sheet.init.id, v)
      else await addAppointment(leadId, { ...v, prep: [], status: 'planned' })
      setSheet(null); await after()
    } catch (e) { alert('Không lưu được lịch hẹn: ' + ((e && e.message) || e)) }
  }
  const del = a => { if (window.confirm('Xoá lịch hẹn này?')) deleteAppointment(a.id).then(after, fail) }
  const setStatus = (a, status) => {
    if (status === 'cancelled' && !window.confirm('Huỷ lịch hẹn "' + (a.title || 'Lịch hẹn') + '"?')) return
    patch(a, { status })
  }
  const prep = next && Array.isArray(next.prep) ? next.prep : []
  const togglePrep = i => patch(next, { prep: prep.map((p, j) => (j === i ? { ...p, done: !p.done } : p)) })
  const addPrep = () => { const t = prepText.trim(); if (!t || !next) return; setPrepText(''); patch(next, { prep: prep.concat([{ text: t, done: false }]) }) }
  const delPrep = i => patch(next, { prep: prep.filter((_, j) => j !== i) })

  const phone = firstPhone(lead.phone)
  const remindText = a => {
    const ten = String(lead.name || '').trim()
    const gio = [a.start, a.end].filter(Boolean).join(' - ')
    return 'Chào anh/chị' + (ten ? ' ' + ten : '') + ', em xin phép nhắc lịch hẹn' + (a.title ? ' "' + a.title + '"' : '')
      + (gio ? ' lúc ' + gio : '') + ' ' + weekdayOf(a.date) + ', ngày ' + fmtD(a.date)
      + (a.place ? ' tại ' + a.place : '') + '. Anh/chị xác nhận giúp em nhé. Em cảm ơn!' + (me ? '\n' + me : '')
  }
  const zalo = async a => {
    const txt = remindText(a)
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch (e) { window.prompt('Chép tin nhắc khách:', txt) }
    if (phone) window.open('https://zalo.me/' + phone, '_blank', 'noopener,noreferrer')
  }

  const countdown = a => { const n = daysBetween(today, a.date); return n < 0 ? 'Quá hạn ' + (-n) + ' ngày' : n === 0 ? 'Hôm nay' : n === 1 ? 'Ngày mai' : 'Còn ' + n + ' ngày' }
  // ô ngày của dòng lịch: số ngày lớn + "TH <tháng>"
  const dayBox = iso => (
    <span className="cd-next-rd"><b>{String(iso || '').slice(8, 10) || '--'}</b><em>TH {Number(String(iso || '').slice(5, 7)) || ''}</em></span>
  )
  const row = (a, tag) => (
    <li key={a.id} className={'cd-next-row' + (tag ? ' ' + tag[1] : '')} title={fmtD(a.date)}>
      {dayBox(a.date)}
      <span className="cd-next-rt">
        <b>{a.title || 'Lịch hẹn'}</b>
        <em>{[weekdayOf(a.date), a.start, modeLabel(a.mode), a.place, (a.members || []).join(', ')].filter(Boolean).join(' · ')}</em>
      </span>
      {tag && <span className="cd-next-tag">{tag[0]}</span>}
      <span className="cd-next-ra">
        {(a.status || 'planned') === 'planned' && <button type="button" title="Đánh dấu đã xong" aria-label="Đánh dấu đã xong" onClick={() => setStatus(a, 'done')}><Ic d={IC_CHECK} size={13} /></button>}
        {(a.status || 'planned') !== 'planned' && <button type="button" title="Mở lại lịch hẹn" aria-label="Mở lại lịch hẹn" onClick={() => patch(a, { status: 'planned' })}><Ic d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" size={13} /></button>}
        <button type="button" title="Dời / sửa lịch hẹn" aria-label="Dời / sửa lịch hẹn" onClick={() => setSheet({ init: a })}><Ic d={IC_EDIT} size={13} /></button>
        <button type="button" title="Xoá lịch hẹn" aria-label="Xoá lịch hẹn" onClick={() => del(a)}><Ic d={IC_X} size={13} /></button>
      </span>
    </li>
  )
  const followRow = (f, i, late) => (
    <li key={(late ? 'fl' : 'f') + i} className={'cd-next-row follow' + (late ? ' late' : '')} title={fmtD(f.date)}>
      {dayBox(f.date)}
      <span className="cd-next-rt"><b>{f.note}</b><em>{weekdayOf(f.date)} · Hẹn chăm sóc tiếp{f.from.by ? ' · ' + f.from.by : ''}</em></span>
      <span className="cd-next-tag">{late ? 'Quá hạn' : 'Hẹn tiếp'}</span>
      <span className="cd-next-ra">
        <button type="button" title="Đặt thành lịch hẹn" aria-label="Đặt thành lịch hẹn"
          onClick={() => setSheet({ init: null, seed: { date: late ? today : f.date, title: f.from.nextNote || f.from.title } })}><Ic d={IC_CAL} size={13} /></button>
      </span>
    </li>
  )
  const hasList = others.length || overdueRest.length || follow.length || followLate.length
  const listCount = others.length + overdueRest.length + follow.length + followLate.length

  return (
    <section className="cd-cc cd-next" aria-label="Việc tiếp theo">
      <div className="cd-next-h">
        <div className="cd-next-top">
          <h3 className="cd-cc-t">Việc tiếp theo</h3>
          <span className="cd-cflex" />
          {next && <span className={'cd-next-cd' + (nextLate ? ' late' : '')}>{countdown(next)}</span>}
          <FoldBtn open={open} onClick={toggle} light />
          {next && (
            <span className="cd-next-menu" ref={menuRef}>
              <button type="button" className="cd-next-new" title="Thao tác lịch hẹn" aria-label="Thao tác lịch hẹn" aria-expanded={menu} onClick={() => setMenu(v => !v)}>⋯</button>
              {menu && (
                <span className="cd-next-pop" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setSheet({ init: next, focus: 'date' }) }}>Dời lịch / sửa lịch</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); zalo(next) }}
                    title={(phone ? 'Mở Zalo ' + phone + ' và ' : 'Khách chưa có số điện thoại - chỉ ') + 'chép sẵn tin nhắc lịch hẹn'}>{copied ? 'Đã chép tin nhắc' : 'Nhắc khách qua Zalo'}</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setStatus(next, 'done') }}>Đánh dấu đã xong</button>
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); setStatus(next, 'cancelled') }}>Huỷ lịch</button>
                  <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); del(next) }}>Xoá lịch</button>
                  {next.by && <em>Đặt bởi {next.by}</em>}
                </span>
              )}
            </span>
          )}
        </div>
        {next ? (
          <div className="cd-next-main">
            <div className="cd-cdate">
              <span>TH {Number(String(next.date).slice(5, 7))}</span>
              <b>{Number(String(next.date).slice(8, 10))}</b>
              <em>{weekdayOf(next.date)}</em>
            </div>
            <div className="cd-next-info">
              <span className="cd-next-title">{next.title || 'Lịch hẹn'}</span>
              <div className="cd-next-when">
                <span className="cd-next-time">{next.start}{next.end ? ' – ' + next.end : ''}</span>
                {modeLabel(next.mode) && <span className="cd-next-mode">{modeLabel(next.mode)}</span>}
              </div>
              {/* thu gọn: tóm tắt người tham gia · địa điểm · mục tiêu ngay trên dải xanh (mở rộng thì xem đủ ở thân thẻ) */}
              {!open && (() => {
                const meta = [(next.members || []).join(', '), next.place, next.goal ? 'Mục tiêu: ' + String(next.goal).split('\n')[0] : ''].filter(Boolean).join(' · ')
                return meta ? <span className="cd-next-meta" title={meta}>{meta}</span> : null
              })()}
            </div>
          </div>
        ) : (
          <div className="cd-next-none">
            {!loaded ? 'Đang tải lịch hẹn…' : err || 'Chưa có lịch hẹn sắp tới với khách hàng này.'}
            {loaded && <button type="button" className="cd-cbtn-or" onClick={() => setSheet({ init: null })}><Ic d={IC_CAL} size={13} />Đặt lịch hẹn</button>}
          </div>
        )}
      </div>

      {next && !open && (
        <div className="cd-next-b cd-next-b-fold">
          {hasList ? <button type="button" className="cd-next-past" onClick={toggle}>Xem {listCount} lịch khác{overdueRest.length + followLate.length ? ' (' + (overdueRest.length + followLate.length) + ' quá hạn)' : ''}</button> : null}
          <button type="button" className="cd-cbtn-or cd-next-add" onClick={() => setSheet({ init: null })}><Ic d={IC_CAL} size={14} />+ Tạo lịch mới</button>
        </div>
      )}

      {next && open && (
        <div className="cd-next-b">
          <div className="cd-next-grid">
            <div className="cd-ckv">
              <span>Tham gia</span>
              <span className="cd-next-mem">
                <b>{(next.members || []).join(', ') || '—'}</b>
                <ApptMembers list={next.members || []} people={ppl} onChange={m => patch(next, { members: m })} />
              </span>
            </div>
            <div className="cd-ckv"><span>Địa điểm</span><b>{next.place || '—'}</b></div>
            <div className="cd-ckv full"><span>Mục tiêu</span><b className="pre">{next.goal || '—'}</b></div>
          </div>
          <div className="cd-chr" />
          <div className="cd-prep">
            <span className="cd-prep-t">Chuẩn bị</span>
            {prep.map((p, i) => (
              <div key={i} className={'cd-prep-i' + (p.done ? ' on' : '')}>
                <button type="button" className="cd-cchk" role="checkbox" aria-checked={!!p.done} onClick={() => togglePrep(i)}>{p.done ? '✓' : ''}</button>
                <span onClick={() => togglePrep(i)}>{p.text}</span>
                <button type="button" className="cd-prep-x" title="Bỏ mục chuẩn bị" aria-label="Bỏ mục chuẩn bị" onClick={() => delPrep(i)}><Ic d={IC_X} size={12} /></button>
              </div>
            ))}
            <input className="cd-prep-in" value={prepText} placeholder="+ Thêm việc cần chuẩn bị (Enter)" aria-label="Thêm việc cần chuẩn bị"
              onChange={e => setPrepText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addPrep() } }} />
          </div>
          <button type="button" className="cd-cbtn-or cd-next-add" onClick={() => setSheet({ init: null })}><Ic d={IC_CAL} size={14} />+ Tạo lịch mới</button>
        </div>
      )}

      {open && (hasList || past.length > 0) && (
        <div className="cd-next-more">
          {hasList ? (
            <>
              <span className="cd-next-sub">Lịch khác</span>
              <ul className="cd-next-list">
                {overdueRest.map(a => row(a, ['Quá hạn', 'late']))}
                {followLate.map((f, i) => followRow(f, i, true))}
                {others.map(a => row(a, null))}
                {follow.map((f, i) => followRow(f, i, false))}
              </ul>
            </>
          ) : null}
          {past.length > 0 && (
            <>
              <button type="button" className="cd-next-past" aria-expanded={showPast} onClick={() => setShowPast(v => !v)}>
                {showPast ? 'Ẩn lịch đã xong / huỷ' : 'Lịch đã xong / huỷ (' + past.length + ')'}
              </button>
              {showPast && <ul className="cd-next-list past">{past.map(a => row(a, a.status === 'done' ? ['Đã xong', 'ok'] : ['Đã huỷ', 'off']))}</ul>}
            </>
          )}
        </div>
      )}

      {sheet && (
        <ApptSheet key={sheet.init ? sheet.init.id : 'new'} init={sheet.init} seed={sheet.seed} focus={sheet.focus} people={ppl} me={me}
          onClose={() => setSheet(null)} onSave={saveSheet} />
      )}
    </section>
  )
}
