import { useEffect, useRef, useState } from 'react'
import { loadReactions, useChat } from '../state/chatStore'
import { countByCode, reactionEmoji, reactionEntries, reactionLabel } from './reactionUtil'
import { colorFor, errText, initials } from './shared'
import './Reaction.css'

/* Hộp "Cảm xúc": ai đã thả gì (GET /messages/:id/reactions, mới trước), lọc theo từng loại.
   reactions (tuỳ chọn) = ReactionSummary đang hiện của tin: đổi (reactions.updated) thì tải lại danh sách */
export default function ReactionUsersDialog({ messageId, onClose, reactions }) {
  const chat = useChat()
  const meId = chat.me ? chat.me.id : null
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')
  const [retry, setRetry] = useState(0)
  const loaded = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && closeRef.current) closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* khoá thay đổi của tóm tắt: tổng + từng loại (không tính `mine`, danh sách giống nhau với mọi người xem) */
  const sig = reactions ? reactions.total + '|' + reactionEntries(reactions.counts).map(r => r.code + r.count).join(',') : ''

  useEffect(() => {
    let alive = true
    const run = () => {
      setLoading(true)
      loadReactions(messageId)
        .then(r => { if (!alive) return; setList((r && r.reactions) || []); setError(''); loaded.current = true })
        .catch(e => { if (alive) setError(errText(e)) })
        .finally(() => { if (alive) setLoading(false) })
    }
    /* lần đầu tải ngay; các lần sau (cảm xúc đổi liên tục) gom lại */
    const t = setTimeout(run, loaded.current ? 400 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [messageId, sig, retry])

  const counts = countByCode(list)
  const tabs = reactionEntries(counts)
  const active = tab !== 'all' && !counts[tab] ? 'all' : tab
  const rows = (list || []).filter(r => active === 'all' || r.reaction === active)

  return (
    <div className="ch-ct-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ch-ct-modal-box ch-dialog ch-react-dlg" role="dialog" aria-label="Cảm xúc">
        <div className="ch-ct-modal-head">
          <h3>Cảm xúc</h3>
          <button className="ch-ct-x" onClick={onClose} aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
        {list && list.length > 0 && (
          <div className="ch-react-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={active === 'all'} className={active === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
              Tất cả {list.length}
            </button>
            {tabs.map(t => (
              <button key={t.code} type="button" role="tab" aria-selected={active === t.code} title={t.label}
                className={active === t.code ? 'active' : ''} onClick={() => setTab(t.code)}>
                <span aria-hidden="true">{t.emoji}</span> {t.count}
              </button>
            ))}
          </div>
        )}
        <div className="ch-react-list">
          {error && !list && (
            <div className="ch-react-empty">
              <div className="ch-ct-error">{error}</div>
              <button type="button" className="ch-react-retry" onClick={() => setRetry(n => n + 1)}>Thử lại</button>
            </div>
          )}
          {!list && !error && loading && <div className="ch-react-empty">Đang tải...</div>}
          {list && !rows.length && <div className="ch-react-empty">Chưa có ai thả cảm xúc</div>}
          {rows.map(r => (
            <div key={r.user_id} className="ch-ct-row ch-react-row">
              <span className="ch-ct-av" style={{ width: 32, height: 32, background: colorFor(r.user_id), fontSize: 11 }}>{initials(r.display_name)}</span>
              <div className="ch-ct-main"><b>{r.display_name}{r.user_id === meId ? ' (bạn)' : ''}</b></div>
              <span className="ch-react-row-emoji" aria-label={reactionLabel(r.reaction)} title={reactionLabel(r.reaction)}>{reactionEmoji(r.reaction)}</span>
            </div>
          ))}
        </div>
        {error && list && <div className="ch-ct-error">{error}</div>}
      </div>
    </div>
  )
}
