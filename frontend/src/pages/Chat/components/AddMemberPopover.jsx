import { useEffect, useState } from 'react'
import { addMembers, loadFriends } from '../state/chatStore'
import { colorFor, errText, initials } from './shared'

/* Popover "Thêm người vào nhóm" — openAddMemberPopover() trong chat.html.
   Bản thật: chọn trong danh sách bạn bè (máy chủ chỉ cho thêm bạn bè của người thêm), chưa ở trong nhóm.
   Bấm ra ngoài thì đóng (xử lý ở Chat.jsx). */
export default function AddMemberPopover({ conv, chat, onClose }) {
  const [picked, setPicked] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { loadFriends().catch(e => setErr(errText(e))) }, [])

  const inGroup = new Set((chat.members[conv.id] || []).map(m => m.user_id))
  const t = q.trim().toLowerCase()
  const friends = (chat.friends || []).filter(f => !inGroup.has(f.id) && (!t || f.display_name.toLowerCase().includes(t)))
  const toggle = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function add() {
    if (!picked.size || busy) { if (!picked.size) setErr('Chọn ít nhất một người'); return }
    setBusy(true); setErr('')
    try {
      await addMembers(conv.id, Array.from(picked))
      onClose()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="ch-pjm-popover" onClick={e => e.stopPropagation()}>
      <div className="ch-pjm-title">Thêm bạn bè vào nhóm</div>
      <input type="text" placeholder="Tìm theo tên" value={q} onChange={e => setQ(e.target.value)} />
      <div className="ch-pick-list">
        {chat.friends === null && <div className="ch-pjm-hint">Đang tải danh sách bạn bè…</div>}
        {chat.friends !== null && !friends.length && <div className="ch-pjm-hint">Không còn bạn bè nào để thêm. Kết bạn ở mục Danh bạ.</div>}
        {friends.map(f => (
          <label key={f.id} className="ch-pick-row">
            <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
            <span className="ch-m-avatar" style={{ background: colorFor(f.id) }}>{initials(f.display_name)}</span>
            <span className="ch-pick-name">{f.display_name}</span>
          </label>
        ))}
      </div>
      {err && <div className="ch-pjm-hint" style={{ color: 'var(--danger)' }}>{err}</div>}
      <div className="ch-pjm-actions">
        <button type="button" className="ch-pjm-btn" onClick={onClose}>Đóng</button>
        <button type="button" className="ch-pjm-btn primary" disabled={busy || !picked.size} onClick={add}>{busy ? 'Đang thêm…' : `Thêm${picked.size ? ' (' + picked.size + ')' : ''}`}</button>
      </div>
    </div>
  )
}
