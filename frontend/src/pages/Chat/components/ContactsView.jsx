import { useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import {
  acceptFriend, blockUser, cancelFriendRequest, disablePush, enablePush, loadBlocks, loadFriends, loadRequests, matchContacts,
  rejectFriend, searchByContact, sendFriendRequest, sortedConversations, startDirect, unblockUser, unfriend, updateMe,
} from '../state/chatStore'
import { SearchIcon, colorFor, errText, initials } from './shared'

/* Icon nét 2 (24x24) cho menu danh bạ */
const I = {
  friends: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-1a7 7 0 0 1 14 0v1" /><path d="M16 3.13a4 4 0 0 1 0 7.75M22 21v-1a6 6 0 0 0-4-5.6" /></>,
  newc: <><circle cx="10" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 9-5.2" /><path d="M18 14v6M15 17h6" /></>,
  plus: <><circle cx="10" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 10-4.4" /><path d="M18 14v6M15 17h6" /></>,
  sync: <><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" /><path d="M21 3v5h-5" /></>,
  groups: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0" /><circle cx="17" cy="9" r="2.5" /><path d="M17.5 14.5A5 5 0 0 1 22 19" /></>,
  block: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="9" cy="11" r="2.5" /><path d="M5.5 16a3.5 3.5 0 0 1 7 0M15 10h4M15 14h3" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></>,
}
const Ic = ({ n, size = 18, fill }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{I[n]}</svg>

const MENU = [
  { key: 'friends', label: 'Bạn bè', icon: 'friends', tone: '#0E8A82' },
  { key: 'requests', label: 'Lời mời kết bạn', icon: 'newc', tone: '#2F5DA8' },
  { key: 'add', label: 'Thêm bạn', icon: 'plus', tone: '#7658C2' },
  { key: 'sync', label: 'Đồng bộ danh bạ', icon: 'sync', tone: '#E08A1E' },
  { key: 'groups', label: 'Nhóm của tôi', icon: 'groups', tone: '#1E8E5A' },
  { key: 'blocked', label: 'Đã chặn', icon: 'block', tone: '#C0392B' },
  { key: 'card', label: 'Thẻ của tôi', icon: 'card', tone: '#E0632E' },
]
const Avatar = ({ id, name, size = 40 }) => <span className="ch-ct-av" style={{ width: size, height: size, background: colorFor(id), fontSize: Math.round(size * 0.34) }}>{initials(name)}</span>

const fmtDate = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('vi-VN') }

/* Màn Danh bạ (bố cục kiểu Lark): bạn bè, lời mời, thêm bạn theo số điện thoại hoặc email, đồng bộ danh bạ, nhóm, đã chặn, thẻ của tôi */
export default function ContactsView({ chat, onOpenConv, onNewGroup, onBack }) {
  const [section, setSection] = useState('friends')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [rel, setRel] = useState({}) // quan hệ vừa đổi của kết quả tìm / đồng bộ (userId -> relation)
  const [addQ, setAddQ] = useState('') // ô "Thêm bạn": số điện thoại hoặc email
  const [found, setFound] = useState(undefined)
  const [syncText, setSyncText] = useState('')
  const [syncRes, setSyncRes] = useState(null)

  useEffect(() => { loadRequests().catch(() => {}) }, [])
  useEffect(() => {
    setErr('')
    const f = section === 'friends' ? loadFriends : section === 'requests' ? loadRequests : section === 'blocked' ? loadBlocks : null
    if (f) f().catch(e => setErr(errText(e)))
  }, [section])

  const me = chat.me
  const t = q.trim().toLowerCase()
  const match = u => !t || String(u.display_name || '').toLowerCase().includes(t) || (u.phone && L.formatPhone(u.phone).replace(/\s/g, '').includes(t.replace(/\s/g, '')))
    || (u.email && String(u.email).toLowerCase().includes(t))
  const incoming = (chat.requests && chat.requests.incoming) || []
  const outgoing = (chat.requests && chat.requests.outgoing) || []

  async function run(key, fn, after) {
    if (busyKey) return
    setBusyKey(key); setErr('')
    try { const r = await fn(); if (after) after(r) } catch (e) { setErr(errText(e)) }
    setBusyKey('')
  }
  const message = u => run('msg' + u.id, () => startDirect(u.id), id => onOpenConv(id))
  const relOf = u => rel[u.id] || u.relation
  const setRelOf = (id, r) => setRel(m => ({ ...m, [id]: r }))

  /* Nút theo quan hệ: bạn bè / lời mời đến / lời mời đi / đã chặn / người lạ / chính mình */
  function Actions({ u }) {
    const r = relOf(u)
    const b = !!busyKey
    const msgBtn = <button className="ch-ct-msg" disabled={b} onClick={e => { e.stopPropagation(); message(u) }}><Ic n="chat" size={13} />Nhắn tin</button>
    if (r === 'self') return <span className="ch-ct-me">Bạn</span>
    if (r === 'friend') {
      return (
        <div className="ch-ct-actions">
          <button className="ch-ct-btn ghost" disabled={b} onClick={e => { e.stopPropagation(); if (window.confirm(`Xoá ${u.display_name} khỏi danh sách bạn bè?`)) run('uf' + u.id, () => unfriend(u.id), () => setRelOf(u.id, 'none')) }}>Xoá bạn</button>
          <button className="ch-ct-btn ghost" disabled={b} onClick={e => { e.stopPropagation(); if (window.confirm(`Chặn ${u.display_name}?`)) run('bl' + u.id, () => blockUser(u.id), () => setRelOf(u.id, 'blocked')) }}>Chặn</button>
          {msgBtn}
        </div>
      )
    }
    if (r === 'incoming') {
      return (
        <div className="ch-ct-actions show">
          <button className="ch-ct-btn ghost" disabled={b} onClick={e => { e.stopPropagation(); run('rj' + u.id, () => rejectFriend(u.id), () => setRelOf(u.id, 'none')) }}>Từ chối</button>
          <button className="ch-ct-btn solid" disabled={b} onClick={e => { e.stopPropagation(); run('ac' + u.id, () => acceptFriend(u.id), () => setRelOf(u.id, 'friend')) }}>Chấp nhận</button>
        </div>
      )
    }
    if (r === 'outgoing') {
      return (
        <div className="ch-ct-actions show">
          <span className="ch-ct-status">Đã gửi lời mời</span>
          <button className="ch-ct-btn ghost" disabled={b} onClick={e => { e.stopPropagation(); run('cc' + u.id, () => cancelFriendRequest(u.id), () => setRelOf(u.id, 'none')) }}>Huỷ lời mời</button>
          {msgBtn}
        </div>
      )
    }
    if (r === 'blocked') {
      return (
        <div className="ch-ct-actions show">
          <button className="ch-ct-btn ghost" disabled={b} onClick={e => { e.stopPropagation(); run('ub' + u.id, () => unblockUser(u.id), () => setRelOf(u.id, 'none')) }}>Bỏ chặn</button>
        </div>
      )
    }
    return (
      <div className="ch-ct-actions show">
        {msgBtn}
        <button className="ch-ct-btn solid" disabled={b} onClick={e => { e.stopPropagation(); run('fr' + u.id, () => sendFriendRequest(u.id), res => setRelOf(u.id, res && res.status === 'accepted' ? 'friend' : 'outgoing')) }}>Kết bạn</button>
      </div>
    )
  }

  const UserRow = ({ u, sub, sub2 }) => (
    <div className="ch-ct-row" onClick={() => relOf(u) !== 'self' && relOf(u) !== 'blocked' && message(u)}>
      <Avatar id={u.id} name={u.display_name} />
      <div className="ch-ct-main"><b>{u.display_name}</b>{sub && <span>{sub}</span>}{sub2 && <span>{sub2}</span>}</div>
      <Actions u={u} />
    </div>
  )
  const empty = text => <div className="ch-ct-empty">{text}</div>
  const loading = empty('Đang tải…')

  let title = (MENU.find(m => m.key === section) || {}).label
  let action = null
  let body = null

  if (section === 'friends') {
    action = <button className="ch-ct-btn" onClick={() => setSection('add')}><Ic n="plus" size={15} />Thêm bạn</button>
    if (chat.friends === null) body = loading
    else {
      const list = chat.friends.filter(match)
      body = list.length ? list.map(u => <UserRow key={u.id} u={u} sub={L.contactText(u)} />) : empty(t ? 'Không tìm thấy bạn bè' : 'Chưa có bạn bè. Vào "Thêm bạn" để tìm theo số điện thoại hoặc email.')
    }
  } else if (section === 'requests') {
    if (chat.requests === null) body = loading
    else {
      const inc = incoming.filter(match)
      const out = outgoing.filter(match)
      body = (
        <>
          <div className="ch-ct-group-title">Lời mời đến ({inc.length})</div>
          {inc.length ? inc.map(u => <UserRow key={'i' + u.id} u={{ ...u, relation: u.relation || 'incoming' }} sub={u.requested_at ? 'Gửi ngày ' + fmtDate(u.requested_at) : ''} />) : empty('Không có lời mời nào')}
          <div className="ch-ct-group-title">Lời mời đã gửi ({out.length})</div>
          {out.length ? out.map(u => <UserRow key={'o' + u.id} u={{ ...u, relation: u.relation || 'outgoing' }} sub={u.requested_at ? 'Gửi ngày ' + fmtDate(u.requested_at) : ''} />) : empty('Chưa gửi lời mời nào')}
        </>
      )
    }
  } else if (section === 'add') {
    const isEmail = L.looksLikeEmail(addQ)
    const norm = isEmail ? L.normalizeEmail(addQ) : L.normalizePhone(addQ) // '' khi sai định dạng
    body = (
      <div className="ch-ct-pad">
        <form className="ch-dialog-search" onSubmit={e => {
          e.preventDefault()
          if (!norm) { setErr(isEmail ? 'Email không hợp lệ' : 'Số điện thoại không hợp lệ'); return }
          run('search', () => searchByContact(addQ), u => setFound(u))
        }}>
          <label className="ch-ct-field" style={{ flex: 1 }}><span>Số điện thoại hoặc email</span><input autoFocus type="text" value={addQ} onChange={e => { setAddQ(e.target.value); setFound(undefined) }} placeholder="Vd. 0901 234 567 hoặc ten@congty.vn" /></label>
          <button className="ch-ct-btn solid" disabled={!!busyKey || !addQ.trim()}>Tìm</button>
        </form>
        {found === null && empty(isEmail ? `Chưa có ai dùng email ${norm || addQ.trim()} trên Dezon Chat.` : `Chưa có ai dùng số ${L.formatPhone(norm) || addQ} trên Dezon Chat.`)}
        {found && <UserRow u={found} sub={L.contactText(found) || (isEmail ? norm : L.formatPhone(norm))} />}
      </div>
    )
  } else if (section === 'sync') {
    const res = syncRes
    body = (
      <div className="ch-ct-pad">
        <label className="ch-ct-field">
          <span>Dán danh sách số điện thoại (mỗi dòng một số, hoặc cách nhau bằng dấu phẩy)</span>
          <textarea className="ch-ct-textarea" rows={6} value={syncText} onChange={e => setSyncText(e.target.value)} placeholder={'0901 234 567\n0912 345 678'} />
        </label>
        <div className="ch-ct-row-actions">
          <button className="ch-ct-btn solid" disabled={!!busyKey || !syncText.trim()} onClick={() => run('sync', () => matchContacts(syncText), r => setSyncRes(r))}>Tìm bạn bè đang dùng Dezon Chat</button>
        </div>
        {res && (
          <>
            <p className="ch-ct-hint">
              Đã kiểm tra {res.valid.length} số{res.invalid.length ? `, bỏ qua ${res.invalid.length} số không hợp lệ` : ''}. Tìm thấy {res.users.length} người dùng.
              {res.hashed ? ' Số điện thoại được băm SHA-256 ngay trên máy trước khi gửi.' : ''}
            </p>
            {res.users.filter(match).map(u => <UserRow key={u.id} u={u} sub={u.input || (u.phone ? L.formatPhone(u.phone) : '')} />)}
          </>
        )}
      </div>
    )
  } else if (section === 'groups') {
    action = <button className="ch-ct-btn" onClick={onNewGroup}><Ic n="groups" size={15} />Tạo nhóm</button>
    const list = sortedConversations(chat).filter(c => c.type === 'group' && (!t || String(c.name || '').toLowerCase().includes(t)))
    body = list.length ? list.map(c => (
      <div key={c.id} className="ch-ct-row" onClick={() => onOpenConv(c.id)}>
        <span className="ch-ct-av sq" style={{ background: colorFor(c.id) }}><Ic n="groups" size={18} /></span>
        <div className="ch-ct-main"><b>{c.name}</b><span>{c.member_count} thành viên · {L.ROLE_LABEL[c.role] || ''}</span></div>
        <button className="ch-ct-msg" onClick={e => { e.stopPropagation(); onOpenConv(c.id) }}><Ic n="chat" size={13} />Mở nhóm</button>
      </div>
    )) : empty('Chưa có nhóm nào')
  } else if (section === 'blocked') {
    if (chat.blocks === null) body = loading
    else {
      const list = chat.blocks.filter(match)
      body = list.length ? list.map(u => <UserRow key={u.id} u={{ ...u, relation: 'blocked' }} />) : empty('Bạn chưa chặn ai')
    }
  } else if (section === 'card') {
    body = <MyCard chat={chat} />
  }

  return (
    <div className="ch-ct">
      <aside className="ch-ct-nav">
        <div className="ch-ct-title">
          {onBack && <button className="ch-ct-tomsg" onClick={onBack} title="Quay lại tin nhắn" aria-label="Quay lại tin nhắn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg></button>}
          <h2>Danh bạ</h2>
        </div>
        <div className="ch-search-box" style={{ margin: '4px 0 10px' }}><SearchIcon /><input type="text" placeholder="Tìm theo tên, số điện thoại, email..." value={q} onChange={e => setQ(e.target.value)} /></div>
        <button className={`ch-ct-org${section === 'card' ? ' active' : ''}`} onClick={() => setSection('card')}>
          <span className="ch-ct-orgav" style={{ background: colorFor(me.id) }}>{initials(me.display_name)}</span>{me.display_name}
        </button>
        {MENU.map(m => (
          <button key={m.key} className={`ch-ct-item${section === m.key ? ' active' : ''}`} onClick={() => setSection(m.key)}>
            <span className="ch-ct-ico" style={{ color: m.tone }}><Ic n={m.icon} /></span>
            <span className="ch-ct-label">{m.label}</span>
            {m.key === 'requests' && incoming.length > 0 && <span className="ch-ct-badge">{incoming.length}</span>}
          </button>
        ))}
      </aside>

      <section className="ch-ct-panel">
        <header className="ch-ct-head">
          <h3>{title}</h3>
          <span className="ch-ct-grow" />
          {action}
        </header>
        {err && <div className="ch-ct-error" role="alert">{err}</div>}
        <div className="ch-ct-list">{body}</div>
      </section>
    </div>
  )
}

/* Thẻ của tôi: tên hiển thị (lấy từ tài khoản Dezon Pro, máy chủ đồng bộ mỗi lần đăng nhập nên không sửa ở đây), số điện
   thoại / email, "cho người khác biết tôi đã xem", thông báo đẩy. Đăng xuất là đăng xuất Dezon Pro. */
function MyCard({ chat }) {
  const me = chat.me
  const push = chat.push
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function save(patch, ok) {
    if (busy) return
    setBusy(true); setMsg('')
    try { await updateMe(patch); setMsg(ok) } catch (e) { setMsg(errText(e)) }
    setBusy(false)
  }

  let pushPart
  if (!push.supported) pushPart = <span className="ch-ct-hint">Trình duyệt này không hỗ trợ thông báo đẩy.</span>
  else if (!push.enabled) pushPart = <span className="ch-ct-hint">Máy chủ chưa bật thông báo đẩy.</span>
  else if (push.subscribed) {
    pushPart = (
      <>
        <span className="ch-ct-hint">Đã bật thông báo trên trình duyệt này.</span>
        <button className="ch-ct-btn ghost" disabled={push.busy} onClick={() => disablePush({ optOut: true })}>Tắt thông báo</button>
      </>
    )
  } else if (push.permission === 'denied') pushPart = <span className="ch-ct-hint">Bạn đã chặn thông báo của trang này. Mở cài đặt trang trong trình duyệt để cho phép lại.</span>
  else pushPart = <button className="ch-ct-btn solid" disabled={push.busy} onClick={() => enablePush()}>{push.busy ? 'Đang bật…' : 'Bật thông báo tin nhắn mới'}</button>

  return (
    <div className="ch-ct-cardwrap">
      <div className="ch-ct-card">
        <div className="ch-ct-card-top">
          <Avatar id={me.id} name={me.display_name} size={64} />
          <div><b>{me.display_name}</b><span>Đăng nhập bằng tài khoản Dezon Pro</span>{me.created_at && <span>Tham gia {fmtDate(me.created_at)}</span>}</div>
        </div>
        {me.phone && <div className="ch-ct-card-line"><Ic n="phone" size={15} />{L.formatPhone(me.phone)}</div>}
        {me.email && <div className="ch-ct-card-line"><Ic n="mail" size={15} />{me.email}</div>}
        <div className="ch-ct-hint">Tên hiển thị lấy theo họ tên của tài khoản Dezon Pro (đổi ở Cài đặt &gt; Tài khoản).</div>
        <label className="ch-ct-toggle">
          <input type="checkbox" checked={me.show_read_receipts !== false} disabled={busy}
            onChange={e => save({ show_read_receipts: e.target.checked }, e.target.checked ? 'Người khác sẽ thấy bạn đã xem' : 'Đã tắt báo "đã xem"')} />
          <span>Cho người khác biết tôi đã xem tin nhắn</span>
        </label>
        <div className="ch-ct-card-push">{pushPart}</div>
        {(msg || push.error) && <div className="ch-ct-hint">{msg || push.error}</div>}
      </div>
    </div>
  )
}
