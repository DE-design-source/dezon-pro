import { useEffect, useRef, useState } from 'react'
import { deleteScheduled, listScheduled, updateScheduled } from '../api/chatApi'
import { errText } from './shared'
import MacDateTime from './MacDateTime'
import './Scheduled.css'

/* Hẹn giờ gửi tin (MarkUp 2026-11-16 18:57): máy chủ giữ tin và tự gửi đúng giờ (kể cả khi người gửi đã tắt máy).
   SchedulePicker: nút đồng hồ cạnh nút Gửi -> hộp chọn giờ nhanh / tự chọn ngày giờ.
   ScheduledBar: thanh "n tin đã hẹn giờ" trên khung soạn -> danh sách tin chờ gửi, đổi giờ / huỷ. */
const pad = n => String(n).padStart(2, '0')
const localIso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
export function fmtWhen(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const today = new Date(); const tm = new Date(); tm.setDate(today.getDate() + 1)
  const same = (a, b) => a.toDateString() === b.toDateString()
  const day = same(d, today) ? 'Hôm nay' : same(d, tm) ? 'Ngày mai' : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · ' + day
}
function quick() {
  const now = new Date()
  const inH = new Date(now.getTime() + 60 * 60000); inH.setSeconds(0, 0)
  const tonight = new Date(now); tonight.setHours(20, 0, 0, 0)
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1); tmr.setHours(8, 0, 0, 0)
  const mon = new Date(now); mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); mon.setHours(8, 0, 0, 0)
  const list = [['Sau 1 giờ', inH]]
  if (tonight.getTime() - now.getTime() > 5 * 60000) list.push(['Tối nay 20:00', tonight])
  list.push(['Sáng mai 08:00', tmr], ['Thứ Hai 08:00', mon])
  return list
}

/* disabled: chưa có chữ / đang sửa / đang đính kèm. onPick(isoUtc) -> Promise (lỗi = hiện trong hộp) */
export function SchedulePicker({ disabled, onPick, note = 'Máy chủ tự gửi đúng giờ, kể cả khi bạn đã tắt máy.' }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true) }
  }, [open])
  const go = async d => {
    if (!d || isNaN(d)) { setErr('Chọn ngày giờ hợp lệ'); return }
    if (d.getTime() < Date.now() + 60000) { setErr('Giờ hẹn phải sau thời điểm hiện tại ít nhất 1 phút'); return }
    setBusy(true); setErr('')
    try { await onPick(d.toISOString()); setOpen(false); setCustom('') } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const min = localIso(new Date(Date.now() + 2 * 60000))
  const defCustom = (() => { const d = new Date(Date.now() + 60 * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return localIso(d) })()
  return (
    <div className="ch-sch" ref={box}>
      <button type="button" className="ch-sch-btn" title={disabled ? 'Nhập nội dung rồi hẹn giờ gửi' : 'Hẹn giờ gửi'} aria-label="Hẹn giờ gửi" aria-expanded={open}
        disabled={disabled} onClick={() => { setErr(''); setOpen(o => !o) }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6M12 2v3" /></svg>
      </button>
      {open && (
        <div className="ch-sch-pop" role="dialog" aria-label="Hẹn giờ gửi">
          <b className="ch-sch-h">Hẹn giờ gửi</b>
          {quick().map(([lb, d]) => (
            <button key={lb} type="button" className="ch-sch-opt" disabled={busy} onClick={() => go(d)}>
              <span>{lb}</span><em>{fmtWhen(d.toISOString())}</em>
            </button>
          ))}
          <div className="ch-sch-custom">
            <MacDateTime value={custom || defCustom} onChange={setCustom} min={min} ariaLabel="Tự chọn ngày giờ" />
            <button type="button" className="ch-sch-go" disabled={busy} onClick={() => go(new Date(custom || defCustom))}>Hẹn</button>
          </div>
          {err && <div className="ch-sch-err">{err}</div>}
          <div className="ch-sch-note">{note}</div>
        </div>
      )}
    </div>
  )
}

/* SiteFlow Bot (#bot) không có máy chủ chat: tin hẹn giờ lưu trên máy này (localStorage), gửi khi đến giờ mà trang Chat
   đang mở (mở lại trang sau giờ hẹn thì gửi ngay). Cùng giao diện list / update / remove với API máy chủ */
const BOT_LS = 'ch-bot-scheduled'
const botRead = () => { try { const v = JSON.parse(localStorage.getItem(BOT_LS) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
const botWrite = v => { try { localStorage.setItem(BOT_LS, JSON.stringify(v)) } catch { /* bỏ qua */ } }
export const botScheduled = {
  list: () => Promise.resolve({ items: botRead().sort((a, b) => a.send_at.localeCompare(b.send_at)) }),
  create: (content, sendAt) => { const it = { id: 'b' + Date.now(), content, send_at: sendAt, status: 'pending' }; botWrite(botRead().concat([it])); return Promise.resolve(it) },
  update: (id, patch) => { botWrite(botRead().map(x => (x.id === id ? { ...x, ...patch } : x))); return Promise.resolve({ ok: true }) },
  remove: id => { botWrite(botRead().filter(x => x.id !== id)); return Promise.resolve({ ok: true }) },
  /* lấy ra các tin đã đến giờ (xoá khỏi danh sách) */
  takeDue: () => { const now = Date.now(); const all = botRead(); const due = all.filter(x => Date.parse(x.send_at) <= now); if (due.length) botWrite(all.filter(x => Date.parse(x.send_at) > now)); return due },
}
const serverApi = { list: listScheduled, update: updateScheduled, remove: deleteScheduled }

/* cid: hội thoại; seq: tăng sau mỗi lần hẹn mới để tải lại; api: mặc định máy chủ chat, bot dùng botScheduled */
export function ScheduledBar({ cid, seq, api = serverApi }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [editId, setEditId] = useState(null)
  const [editAt, setEditAt] = useState('')
  const load = () => api.list(cid).then(r => setItems((r && r.items) || []), () => setItems([]))
  useEffect(() => { setOpen(false); setEditId(null); load() }, [cid, seq]) // eslint-disable-line react-hooks/exhaustive-deps
  // tin đến giờ thì máy chủ gửi và bỏ khỏi danh sách: tải lại mỗi phút khi còn tin chờ
  useEffect(() => {
    if (!items.length) return undefined
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [items.length, cid]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null
  const cancel = it => {
    if (!window.confirm('Huỷ tin hẹn giờ này?')) return
    api.remove(it.id).then(load, e => setErr(errText(e)))
  }
  const saveAt = it => {
    const d = new Date(editAt)
    if (isNaN(d) || d.getTime() < Date.now() + 60000) { setErr('Giờ hẹn phải sau thời điểm hiện tại ít nhất 1 phút'); return }
    api.update(it.id, { send_at: d.toISOString() }).then(() => { setEditId(null); setErr(''); load() }, e => setErr(errText(e)))
  }
  return (
    <div className={'ch-schbar' + (open ? ' open' : '')}>
      <button type="button" className="ch-schbar-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>
        <span><b>{items.length}</b> tin đã hẹn giờ · gần nhất {fmtWhen(items[0].send_at)}</span>
        <i aria-hidden="true">{open ? '▴' : '▾'}</i>
      </button>
      {open && (
        <div className="ch-schbar-list">
          {items.map(it => (
            <div key={it.id} className="ch-schbar-it">
              <div className="ch-schbar-txt">
                <em>{fmtWhen(it.send_at)}</em>
                <span title={it.content}>{it.content}</span>
              </div>
              {editId === it.id ? (
                <span className="ch-schbar-edit">
                  <MacDateTime value={editAt} onChange={setEditAt} min={localIso(new Date(Date.now() + 2 * 60000))} ariaLabel="Giờ hẹn mới" />
                  <button type="button" onClick={() => saveAt(it)}>Lưu</button>
                  <button type="button" onClick={() => setEditId(null)}>Thôi</button>
                </span>
              ) : (
                <span className="ch-schbar-act">
                  <button type="button" onClick={() => { setErr(''); setEditId(it.id); setEditAt(localIso(new Date(it.send_at))) }}>Đổi giờ</button>
                  <button type="button" className="x" onClick={() => cancel(it)}>Huỷ</button>
                </span>
              )}
            </div>
          ))}
          {err && <div className="ch-sch-err">{err}</div>}
        </div>
      )}
    </div>
  )
}
