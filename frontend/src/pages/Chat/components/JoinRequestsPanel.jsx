import { useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import { approveJoinRequest, loadJoinRequests, rejectJoinRequest } from '../state/chatStore'
import { colorFor, errText, initials } from './shared'
import './GroupAdmin.css'

/* Yêu cầu vào nhóm qua link cần duyệt (chỉ owner / admin). Danh sách lấy từ store (chat.joinRequests[cid]); gói
   gói join_requests.updated thì store tự tải lại (đã tải một lần ở đây). Không có yêu cầu nào -> không hiện. */
export default function JoinRequestsPanel({ chat, conv }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const cid = conv.id
  const pending = conv.pending_join_requests || 0

  useEffect(() => {
    loadJoinRequests(cid).catch(e => setErr(errText(e)))
  }, [cid])

  const list = (chat.joinRequests && chat.joinRequests[cid]) || []
  if (!list.length && !pending && !err) return null

  async function act(key, fn) {
    if (busy) return
    setBusy(key); setErr('')
    try { await fn() } catch (e) { setErr(errText(e)); loadJoinRequests(cid).catch(() => {}) }
    setBusy('')
  }

  const now = Date.now()
  return (
    <div className="ch-info-section">
      <div className="ch-sec-title">
        Yêu cầu vào nhóm{(list.length || pending) ? <span className="ch-ga-count">{list.length || pending}</span> : null}
      </div>
      {err && <div className="ch-info-err" role="alert" style={{ marginBottom: 8 }}>{err}</div>}
      {!list.length && pending > 0 && <div className="ch-info-note">Đang tải…</div>}
      {list.map(r => {
        const u = r.user || {}
        const name = u.display_name || 'Người dùng #' + u.id
        return (
          <div key={r.id} className="ch-ga-req-row">
            <span className="ch-m-avatar" style={{ background: colorFor(u.id) }}>{initials(name)}</span>
            <div className="ch-ga-req-info">
              <div className="ch-ga-req-name" title={name}>{name}</div>
              <div className="ch-ga-req-time">{L.listTimeLabel(r.created_at, now)}</div>
            </div>
            <div className="ch-ga-req-btns">
              <button type="button" disabled={!!busy} title={'Từ chối ' + name}
                onClick={() => act('rj' + r.id, () => rejectJoinRequest(cid, r.id))}>Từ chối</button>
              <button type="button" className="ok" disabled={!!busy} title={'Duyệt ' + name + ' vào nhóm'}
                onClick={() => act('ok' + r.id, () => approveJoinRequest(cid, r.id))}>Duyệt</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
