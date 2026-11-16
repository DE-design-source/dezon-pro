import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { notifCount, notifList, notifRead, notifReadAll } from '../../QS/api/qsApi'
import { isAbort } from '../../QS/api/http'

/* Chuông thông báo ở trang Kinh doanh (cùng nguồn với chuông QS: GET /notifications, bảng notifications).
   Số chưa đọc hỏi lại mỗi 30 s. Bấm thông báo -> đánh dấu đã đọc:
     kd_assign (được giao phụ trách khách hàng, refId = id khách) -> mở trang khách hàng (onOpenLead)
     loại khác (mua hàng, sản phẩm...) -> sang trang QS
   Props: onOpenLead(id) */
const POLL_MS = 30000

const fmtAt = v => {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export default function KdNotifBell({ onOpenLead }) {
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
    const refId = n.refId != null ? String(n.refId) : ''
    if (/^kd_/.test(n.kind || '')) { if (refId) onOpenLead(refId) } else navigate('/qs')
  }
  function markAll() {
    notifReadAll().then(() => { refresh(); setSeq(s => s + 1) }, e => alert('Lỗi: ' + e.message))
  }

  return (
    <div className="kd-nb" ref={box}>
      <button type="button" className="kd-nb-btn" title="Thông báo" onClick={() => setOpen(o => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="kd-nb-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="kd-nb-dd">
          <div className="kd-nb-hd"><b>Thông báo</b><button type="button" onClick={markAll}>Đánh dấu đã đọc</button></div>
          <div className="kd-nb-list">
            {list.st === 'loading' ? <div className="kd-nb-empty">Đang tải…</div>
              : list.st === 'error' ? <div className="kd-nb-empty">Lỗi: {list.err}</div>
                : !list.items.length ? <div className="kd-nb-empty">Chưa có thông báo</div>
                  : list.items.map(n => (
                    <button type="button" key={n.id} className={'kd-nb-item' + (n.read ? '' : ' unread')} onClick={() => click(n)}>
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
