import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { notifCount, notifList, notifRead, notifReadAll } from '../../pages/QS/api/qsApi'
import { isAbort } from '../../pages/QS/api/http'
import './NotifBell.css'

/* Chuông thông báo dùng chung cho header các trang (cùng nguồn với chuông QS: GET /notifications, bảng notifications).
   Số chưa đọc hỏi lại mỗi 30 s; mở chuông -> tải 30 thông báo mới nhất.
   Bấm thông báo -> đánh dấu đã đọc, gọi onOpen(n) (n = {id, kind, title, body, refId, read, at});
   onOpen trả true = trang đã tự xử lý, ngược lại điều hướng mặc định:
     kd_* -> /kinh-doanh?lead=<refId>   it_* -> /it?ticket=<refId>   loại khác -> /qs
   Màu nhấn: biến CSS --nb-accent / --nb-accent-tint (mặc định --primary / --primary-tint). */
const POLL_MS = 30000

const fmtAt = v => {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

function notifPath(n) {
  const kind = (n && n.kind) || ''
  const refId = n && n.refId != null ? String(n.refId) : ''
  if (/^kd_/.test(kind)) return refId ? '/kinh-doanh?lead=' + encodeURIComponent(refId) : '/kinh-doanh'
  if (/^it_/.test(kind)) return refId ? '/it?ticket=' + encodeURIComponent(refId) : '/it'
  return '/qs'
}

export default function NotifBell({ onOpen }) {
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [list, setList] = useState({ st: 'loading', items: [], err: '' })
  const [seq, setSeq] = useState(0)
  const box = useRef(null)

  const refresh = () => notifCount().then(c => setUnread((c && c.unread) || 0), () => {})
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const ac = new AbortController()
    setList(l => ({ ...l, st: 'loading', err: '' }))
    notifList(30, ac.signal).then(ns => setList({ st: 'ready', items: ns || [], err: '' }),
      e => { if (!isAbort(e)) setList({ st: 'error', items: [], err: e.message }) })
    return () => ac.abort()
  }, [open, seq])

  function click(n) {
    setOpen(false)
    if (!n.read) notifRead(n.id).then(refresh, () => {})
    if (onOpen && onOpen(n) === true) return
    navigate(notifPath(n))
  }
  function markAll() {
    notifReadAll().then(() => { refresh(); setSeq(s => s + 1) }, e => alert('Lỗi: ' + e.message))
  }

  return (
    <div className="nb" ref={box}>
      <button type="button" className="nb-btn" title="Thông báo" onClick={() => setOpen(o => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="nb-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="nb-dd">
          <div className="nb-hd"><b>Thông báo</b><button type="button" onClick={markAll}>Đánh dấu đã đọc</button></div>
          <div className="nb-list">
            {list.st === 'loading' ? <div className="nb-empty">Đang tải…</div>
              : list.st === 'error' ? <div className="nb-empty">Lỗi: {list.err}</div>
                : !list.items.length ? <div className="nb-empty">Chưa có thông báo</div>
                  : list.items.map(n => (
                    <button type="button" key={n.id} className={'nb-item' + (n.read ? '' : ' unread')} onClick={() => click(n)}>
                      <b>{n.title || ''}</b>
                      {n.body ? <span>{n.body}</span> : null}
                      <i>{fmtAt(n.at)}</i>
                    </button>
                  ))}
          </div>
        </div>
      )}
    </div>
  )
}
