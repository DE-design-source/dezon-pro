import { useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import { forwardMessage, sortedConversations, useChat } from '../state/chatStore'
import { foldVN } from './mentionUtil'
import { ConvAvatar, avatarConv, errText } from './shared'
import './MessageActions.css'

const MAX_TARGETS = 20

/* Lý do không gửi được vào hội thoại (cùng luật message.send ở máy chủ); '' = gửi được */
function blockedReason(c) {
  if (c.type === 'group' && !L.canDo(c.role || 'member', c.settings, 'send')) return 'Chỉ trưởng / phó nhóm được gửi tin'
  if (c.type === 'direct' && c.peer && c.peer.relation === 'blocked') return 'Bạn đã chặn người này'
  return ''
}

/* Hộp "Chuyển tiếp": chọn 1..20 cuộc trò chuyện (tìm theo tên, không dấu), gửi một lần; đích lỗi giữ lại kèm lý do để thử lại */
export default function ForwardDialog({ message, onClose }) {
  const chat = useChat()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [failed, setFailed] = useState({}) // {cid: câu lỗi}
  const [sent, setSent] = useState(0)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const t = foldVN(q).trim()
  const convs = sortedConversations(chat).filter(c => !c.left && !L.isDisbanded(c) && (!t || foldVN(L.convTitle(c)).includes(t)))

  const toggle = id => {
    if (!picked.has(id) && picked.size >= MAX_TARGETS) { setErr('Chọn từ 1 đến 20 cuộc trò chuyện'); return }
    setErr('')
    const n = new Set(picked)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setPicked(n)
  }

  async function submit(e) {
    e.preventDefault()
    if (busy || !picked.size) return
    const cids = Array.from(picked)
    setBusy(true); setErr('')
    try {
      const r = await forwardMessage(message.id, cids)
      const results = (r && r.results) || []
      const bad = {}
      let ok = 0
      for (const x of results) {
        if (x.ok) ok++
        else bad[x.conversation_id] = (x.error && x.error.message) || 'Không gửi được'
      }
      if (!Object.keys(bad).length) { onClose(); return }
      setSent(n => n + ok)
      setFailed(bad)
      setPicked(new Set(Object.keys(bad).map(Number)))
    } catch (x) {
      setErr(errText(x))
    }
    setBusy(false)
  }

  const nFailed = Object.keys(failed).length
  return (
    <div className="ch-ct-modal" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <form className="ch-ct-modal-box ch-dialog ch-fwd" onSubmit={submit}>
        <div className="ch-ct-modal-head">
          <h3>Chuyển tiếp tin nhắn</h3>
          <button type="button" className="ch-ct-x" onClick={onClose} disabled={busy} aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
        <div className="ch-fwd-preview">{L.mediaLabel(message) || '…'}</div>
        {err && <div className="ch-ct-error" role="alert">{err}</div>}
        {nFailed > 0 && (
          <div className="ch-ct-error" role="alert">
            {sent > 0 ? `Đã chuyển tiếp tới ${sent} cuộc trò chuyện. ` : ''}Không gửi được tới {nFailed} cuộc trò chuyện, xem lý do bên dưới.
          </div>
        )}
        <label className="ch-ct-field">
          <span>Gửi tới ({picked.size} / {MAX_TARGETS} đã chọn)</span>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm cuộc trò chuyện theo tên" />
        </label>
        <div className="ch-dialog-list ch-pick-list ch-fwd-list">
          {!convs.length && <div className="ch-ct-empty">{t ? 'Không có cuộc trò chuyện trùng tên.' : 'Chưa có cuộc trò chuyện nào.'}</div>}
          {convs.map(c => {
            const why = blockedReason(c)
            const fail = failed[c.id]
            return (
              <label key={c.id} className={'ch-pick-row ch-fwd-row' + (why ? ' disabled' : '')} title={why || undefined}>
                <input type="checkbox" checked={picked.has(c.id)} disabled={!!why || busy} onChange={() => toggle(c.id)} />
                <ConvAvatar conv={avatarConv(c)} size={30} />
                <span className="ch-fwd-main">
                  <span className="ch-pick-name">{L.convTitle(c)}</span>
                  {(why || fail) && <span className={'ch-fwd-note' + (fail ? ' err' : '')}>{fail || why}</span>}
                </span>
              </label>
            )
          })}
        </div>
        <div className="ch-ct-modal-foot">
          <button type="button" className="ch-ct-btn ghost" onClick={onClose} disabled={busy}>{sent ? 'Đóng' : 'Huỷ'}</button>
          <button className="ch-ct-btn solid" disabled={busy || !picked.size}>{busy ? 'Đang gửi…' : picked.size ? `Chuyển tiếp (${picked.size})` : 'Chuyển tiếp'}</button>
        </div>
      </form>
    </div>
  )
}
