import { useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import { createGroup, loadFriends, searchByContact, startDirect } from '../state/chatStore'
import { colorFor, errText, initials } from './shared'

const RELATION_TEXT = { friend: 'Bạn bè', outgoing: 'Đã gửi lời mời kết bạn', incoming: 'Đã gửi lời mời cho bạn', none: 'Chưa kết bạn', self: 'Bạn', blocked: 'Đã chặn' }

/* Hộp "Tin nhắn mới": nhắn 1-1 (chọn bạn bè hoặc tìm theo số điện thoại / email) / tạo nhóm (tên + chọn bạn bè).
   onOpened(id) -> Chat.jsx mở hội thoại vừa tạo / vừa tìm thấy. */
export default function NewChatDialog({ chat, initialTab = 'direct', onClose, onOpened }) {
  const [tab, setTab] = useState(initialTab)
  const [q, setQ] = useState('')
  const [found, setFound] = useState(undefined) // undefined: chưa tìm; null: không thấy; User
  const [name, setName] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { loadFriends().catch(e => setErr(errText(e))) }, [])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const t = q.trim().toLowerCase()
  const friends = (chat.friends || []).filter(f => !t || f.display_name.toLowerCase().includes(t) || (f.phone && (f.phone.includes(t) || L.formatPhone(f.phone).replace(/\s/g, '').includes(t.replace(/\s/g, ''))))
    || (f.email && String(f.email).toLowerCase().includes(t)))
  const isEmail = L.looksLikeEmail(q)
  const target = isEmail ? L.normalizeEmail(q) : L.normalizePhone(q) // '' khi sai định dạng

  async function open(userId) {
    if (busy) return
    setBusy(true); setErr('')
    try { onOpened(await startDirect(userId)) } catch (e) { setErr(errText(e)); setBusy(false) }
  }

  async function search(e) {
    if (e) e.preventDefault()
    if (busy || !target) return
    setBusy(true); setErr('')
    try { setFound(await searchByContact(q)) } catch (x) { setErr(errText(x)) }
    setBusy(false)
  }

  async function create(e) {
    e.preventDefault()
    if (busy) return
    const n = name.trim()
    if (!n || n.length > L.MAX_GROUP_NAME) { setErr('Tên nhóm từ 1 đến 100 ký tự'); return }
    if (!picked.size) { setErr('Chọn ít nhất một người bạn'); return }
    setBusy(true); setErr('')
    try { onOpened(await createGroup(n, Array.from(picked))) } catch (x) { setErr(errText(x)); setBusy(false) }
  }

  const toggle = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const userRow = (u, onClick, right) => (
    <div key={u.id} className="ch-ct-row" onClick={onClick}>
      <span className="ch-ct-av" style={{ width: 36, height: 36, background: colorFor(u.id), fontSize: 12 }}>{initials(u.display_name)}</span>
      <div className="ch-ct-main"><b>{u.display_name}</b><span>{L.contactText(u) || RELATION_TEXT[u.relation] || ''}</span></div>
      {right}
    </div>
  )

  return (
    <div className="ch-ct-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ch-ct-modal-box ch-dialog">
        <div className="ch-ct-modal-head">
          <h3>Tin nhắn mới</h3>
          <button className="ch-ct-x" onClick={onClose} aria-label="Đóng"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>
        <div className="ch-conv-tabs">
          <button className={tab === 'direct' ? 'active' : undefined} onClick={() => { setTab('direct'); setErr('') }}>Nhắn tin 1-1</button>
          <button className={tab === 'group' ? 'active' : undefined} onClick={() => { setTab('group'); setErr('') }}>Tạo nhóm</button>
        </div>
        {err && <div className="ch-ct-error" role="alert">{err}</div>}

        {tab === 'direct' ? (
          <>
            <form className="ch-dialog-search" onSubmit={search}>
              <label className="ch-ct-field" style={{ flex: 1 }}>
                <span>Tìm bạn bè hoặc nhập số điện thoại / email</span>
                <input autoFocus value={q} onChange={e => { setQ(e.target.value); setFound(undefined) }} placeholder="Tên bạn bè / 0901 234 567 / ten@congty.vn" />
              </label>
              <button className="ch-ct-btn" disabled={busy || !target}>Tìm</button>
            </form>
            <div className="ch-dialog-list">
              {found === null && <div className="ch-ct-empty">{isEmail ? `Không tìm thấy ai dùng email ${target} trên Dezon Chat.` : `Không tìm thấy ai dùng số ${L.formatPhone(target)} trên Dezon Chat.`}</div>}
              {found && found.relation !== 'self' && userRow(found, () => open(found.id), <button className="ch-ct-msg" disabled={busy}>Nhắn tin</button>)}
              {found && found.relation === 'self' && <div className="ch-ct-empty">Đây là tài khoản của bạn.</div>}
              {chat.friends === null && <div className="ch-ct-empty">Đang tải bạn bè…</div>}
              {chat.friends !== null && !friends.length && !found && <div className="ch-ct-empty">{t ? 'Không có bạn bè trùng tên. Nhập đủ số điện thoại hoặc email rồi bấm "Tìm".' : 'Chưa có bạn bè. Nhập số điện thoại hoặc email để tìm người dùng Dezon Chat.'}</div>}
              {friends.map(f => userRow(f, () => open(f.id), <button className="ch-ct-msg" disabled={busy}>Nhắn tin</button>))}
            </div>
          </>
        ) : (
          <form onSubmit={create} className="ch-dialog-form">
            <label className="ch-ct-field"><span>Tên nhóm *</span><input autoFocus maxLength={L.MAX_GROUP_NAME} value={name} onChange={e => setName(e.target.value)} placeholder="Vd. Dự án Riverside" /></label>
            <label className="ch-ct-field"><span>Thêm bạn bè ({picked.size} đã chọn)</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm theo tên" /></label>
            <div className="ch-dialog-list ch-pick-list">
              {chat.friends === null && <div className="ch-ct-empty">Đang tải bạn bè…</div>}
              {chat.friends !== null && !friends.length && <div className="ch-ct-empty">Chỉ thêm được bạn bè vào nhóm. Kết bạn ở mục Danh bạ ▸ Thêm bạn.</div>}
              {friends.map(f => (
                <label key={f.id} className="ch-pick-row">
                  <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
                  <span className="ch-m-avatar" style={{ background: colorFor(f.id) }}>{initials(f.display_name)}</span>
                  <span className="ch-pick-name">{f.display_name}</span>
                </label>
              ))}
            </div>
            <div className="ch-ct-modal-foot">
              <button type="button" className="ch-ct-btn ghost" onClick={onClose}>Huỷ</button>
              <button className="ch-ct-btn solid" disabled={busy || !name.trim() || !picked.size}>{busy ? 'Đang tạo…' : 'Tạo nhóm'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
