import { useEffect, useState } from 'react'
import { loadDevices, revokeDevice, revokeOtherDevices, useChat } from '../state/chatStore'
import { dateTimeLabel, deviceSeenLabel, loginMethodLabel, platformLabel, sortDevices } from './qrUtil'
import './Device.css'

/* Thiết bị đăng nhập của tài khoản (API.md "Đa thiết bị"): danh sách GET /devices (thiết bị này trước), đăng xuất từ xa
   một thiết bị (DELETE /devices/:id -> thiết bị đó nhận force_logout) hoặc mọi thiết bị khác. Danh sách tự tải lại khi
   có devices.updated (store). */

function PlatformIcon({ platform }) {
  if (platform === 'android' || platform === 'ios') {
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
}

export default function DevicesPanel({ onClose }) {
  const chat = useChat()
  const [busy, setBusy] = useState(0) // id thiết bị đang đăng xuất; -1 = mọi thiết bị khác
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => { loadDevices().catch(() => {}) }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const st = chat.devices || { list: null, loading: false, error: '' }
  const list = sortDevices(st.list)
  const others = list.filter(d => !d.current)

  async function revokeOne(d) {
    if (busy) return
    const name = d.name || platformLabel(d.platform)
    if (!window.confirm(`Đăng xuất thiết bị "${name}"? Thiết bị đó sẽ phải đăng nhập lại.`)) return
    setBusy(d.id); setErr(''); setNote('')
    try {
      await revokeDevice(d.id)
      setNote(`Đã đăng xuất ${name}`)
    } catch (e) {
      setErr((e && e.message) || 'Không đăng xuất được thiết bị, thử lại sau')
    }
    setBusy(0)
  }

  async function revokeAll() {
    if (busy || !others.length) return
    if (!window.confirm(`Đăng xuất ${others.length} thiết bị khác? Chỉ thiết bị này còn đăng nhập.`)) return
    setBusy(-1); setErr(''); setNote('')
    try {
      const r = await revokeOtherDevices()
      const n = r && Number.isFinite(Number(r.revoked)) ? Number(r.revoked) : others.length
      setNote(n ? `Đã đăng xuất ${n} thiết bị khác` : 'Không còn thiết bị nào khác')
    } catch (e) {
      setErr((e && e.message) || 'Không đăng xuất được, thử lại sau')
    }
    setBusy(0)
  }

  let content
  if (st.list === null) {
    content = st.error
      ? <div className="ch-gate-err" role="alert">{st.error} <button type="button" className="ch-gate-link" onClick={() => loadDevices().catch(() => {})}>Thử lại</button></div>
      : <div className="ch-dev-empty">Đang tải danh sách thiết bị…</div>
  } else if (!list.length) {
    content = <div className="ch-dev-empty">Không có thiết bị nào</div>
  } else {
    content = (
      <div className="ch-dev-list">
        {list.map(d => (
          <div key={d.id} className={'ch-dev-row' + (d.current ? ' current' : '')}>
            <span className="ch-dev-ic"><PlatformIcon platform={d.platform} />{d.online && <i className="ch-dev-dot" aria-label="Đang trực tuyến" />}</span>
            <div className="ch-dev-main">
              <div className="ch-dev-name">
                <b>{d.name || platformLabel(d.platform)}</b>
                {d.current && <span className="ch-dev-badge">Thiết bị này</span>}
              </div>
              <div className="ch-dev-sub">{[platformLabel(d.platform), deviceSeenLabel(d, now)].filter(Boolean).join(' · ')}</div>
              {d.user_agent && <div className="ch-dev-ua" title={d.user_agent}>{d.user_agent}</div>}
              <div className="ch-dev-sub">
                {[loginMethodLabel(d.login_method), d.created_at ? 'lúc ' + dateTimeLabel(d.created_at) : '', d.last_ip ? 'IP ' + d.last_ip : '', d.push ? 'Nhận thông báo' : ''].filter(Boolean).join(' · ')}
              </div>
            </div>
            {!d.current && (
              <button type="button" className="ch-ct-btn ghost ch-dev-out" disabled={!!busy} onClick={() => revokeOne(d)}>
                {busy === d.id ? 'Đang đăng xuất…' : 'Đăng xuất'}
              </button>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="ch-ct-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ch-ct-modal-box ch-dialog ch-dev-modal" role="dialog" aria-modal="true" aria-label="Thiết bị đăng nhập">
        <div className="ch-ct-modal-head">
          <h3>Thiết bị đăng nhập</h3>
          <button type="button" className="ch-ct-x" onClick={onClose} aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
        <div className="ch-gate-text">Các thiết bị đang đăng nhập tài khoản{chat.me ? <> <b>{chat.me.display_name}</b></> : null}. Thấy thiết bị lạ thì đăng xuất ngay.</div>
        {err && <div className="ch-gate-err" role="alert">{err}</div>}
        {note && <div className="ch-gate-hint" role="status">{note}</div>}
        {content}
        {st.list && st.loading && <div className="ch-gate-muted ch-dev-loading">Đang cập nhật…</div>}
        {st.list && !st.loading && st.error && <div className="ch-gate-hint">{st.error}</div>}
        {others.length > 0 && (
          <button type="button" className="ch-ct-btn ch-dev-all" disabled={!!busy} onClick={revokeAll}>
            {busy === -1 ? 'Đang đăng xuất…' : 'Đăng xuất mọi thiết bị khác'}
          </button>
        )}
      </div>
    </div>
  )
}
