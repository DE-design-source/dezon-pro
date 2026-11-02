import { useState } from 'react'
import * as L from '../state/chatLogic'
import {
  acceptFriend, blockUser, cancelFriendRequest, removeMember, renameGroup, sendFriendRequest, setMemberRole, setMute, unblockUser,
} from '../state/chatStore'
import { IconSvg, avatarConv, colorFor, errText, initials } from './shared'
import AddMemberPopover from './AddMemberPopover'

const MUTE_OPTIONS = [
  { label: 'Trong 1 giờ', ms: 3600e3 },
  { label: 'Trong 8 giờ', ms: 8 * 3600e3 },
  { label: 'Trong 24 giờ', ms: 24 * 3600e3 },
  { label: 'Đến khi bật lại', forever: true },
]

const ico = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

/* Cột thông tin hội thoại bên phải — renderInfo() trong chat.html.
   Hội thoại cục bộ SiteFlow Bot: chỉ phần đầu (như bản cũ). Hội thoại thật: thành viên + vai trò, thêm / xoá / rời nhóm,
   đổi tên, đặt / bỏ quản trị viên (trưởng nhóm), tắt thông báo, kết bạn / chặn (chat 1-1). */
export default function InfoPanel({ chat, conv, memberPopOpen, onToggleMemberPop, onCloseMemberPop, onLeft }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [muteOpen, setMuteOpen] = useState(false)

  if (conv.local) {
    return (
      <div className="ch-info-panel">
        <div className="ch-info-hero">
          <div className="ch-avatar-lg" style={{ background: conv.color }}><IconSvg kind="bot" /></div>
          <div className="ch-name">{conv.name}</div>
          <div className="ch-sub">{conv.sub}</div>
        </div>
      </div>
    )
  }

  const me = chat.me
  const c = conv
  const members = chat.members[c.id] || []
  const myRole = c.role || ((members.find(m => m.user_id === me.id) || {}).role) || 'member'
  const peer = c.type === 'direct' ? c.peer : null
  const pres = peer ? chat.presence[peer.id] : null
  const online = peer && chat.net === 'online' ? (pres ? pres.online : !!peer.online) : false
  const now = Date.now()
  const muted = L.isMuted(c.muted_until, now)
  const av = avatarConv(c, online)

  async function act(key, fn, after) {
    if (busy) return
    setBusy(key); setErr('')
    try { await fn(); if (after) after() } catch (e) { setErr(errText(e)) }
    setBusy('')
  }

  const sub = c.type === 'group'
    ? (c.left ? '' : `${c.member_count || members.length} thành viên`)
    : online ? 'Đang hoạt động' : (pres && pres.last_seen ? L.lastSeenLabel(pres.last_seen, now) : '')

  const muteBlock = !c.left && (
    <div className="ch-info-section">
      <div className="ch-sec-title">Thông báo</div>
      {muted ? (
        <>
          <div className="ch-info-note">{L.muteLabel(c.muted_until, now)}</div>
          <button type="button" className="ch-info-btn" disabled={!!busy} onClick={() => act('mute', () => setMute(c.id, null))}>Bật lại thông báo</button>
        </>
      ) : muteOpen ? (
        <div className="ch-info-actions">
          {MUTE_OPTIONS.map(o => (
            <button key={o.label} type="button" className="ch-info-btn" disabled={!!busy}
              onClick={() => act('mute', () => setMute(c.id, o.forever ? 'forever' : new Date(Date.now() + o.ms).toISOString()), () => setMuteOpen(false))}>
              {o.label}
            </button>
          ))}
          <button type="button" className="ch-info-btn ghost" onClick={() => setMuteOpen(false)}>Huỷ</button>
        </div>
      ) : (
        <button type="button" className="ch-info-btn" onClick={() => setMuteOpen(true)}>Tắt thông báo</button>
      )}
    </div>
  )

  let body = null
  if (c.type === 'direct' && peer) {
    const rel = peer.relation
    body = (
      <>
        {peer.phone && (
          <div className="ch-info-section">
            <div className="ch-sec-title">Số điện thoại</div>
            <div className="ch-info-note">{L.formatPhone(peer.phone)}</div>
          </div>
        )}
        {peer.email && (
          <div className="ch-info-section">
            <div className="ch-sec-title">Email</div>
            <div className="ch-info-note">{peer.email}</div>
          </div>
        )}
        {muteBlock}
        <div className="ch-info-section">
          <div className="ch-sec-title">Bạn bè</div>
          <div className="ch-info-actions">
            {rel === 'friend' && <div className="ch-info-note">Hai bạn đã là bạn bè</div>}
            {rel === 'none' && <button type="button" className="ch-info-btn" disabled={!!busy} onClick={() => act('fr', () => sendFriendRequest(peer.id))}>Gửi lời mời kết bạn</button>}
            {rel === 'outgoing' && <button type="button" className="ch-info-btn" disabled={!!busy} onClick={() => act('fr', () => cancelFriendRequest(peer.id))}>Huỷ lời mời kết bạn</button>}
            {rel === 'incoming' && <button type="button" className="ch-info-btn" disabled={!!busy} onClick={() => act('fr', () => acceptFriend(peer.id))}>Chấp nhận lời mời kết bạn</button>}
            {rel === 'blocked'
              ? <button type="button" className="ch-info-btn" disabled={!!busy} onClick={() => act('block', () => unblockUser(peer.id))}>Bỏ chặn</button>
              : <button type="button" className="ch-info-btn danger" disabled={!!busy}
                  onClick={() => { if (window.confirm(`Chặn ${peer.display_name}? Hai bên sẽ không nhắn tin được cho nhau.`)) act('block', () => blockUser(peer.id)) }}>
                  Chặn người này
                </button>}
          </div>
        </div>
      </>
    )
  } else if (c.type === 'group') {
    const sorted = members.slice().sort((a, b) => {
      const r = { owner: 0, admin: 1, member: 2 }
      return (r[a.role] - r[b.role]) || String(a.display_name).localeCompare(String(b.display_name), 'vi')
    })
    body = (
      <>
        {/* Đã rời / bị xoá: không còn xem được danh sách thành viên (danh sách cũ không còn đúng) */}
        {c.left && <div className="ch-info-section"><div className="ch-info-note">Bạn không còn là thành viên của nhóm này.</div></div>}
        {!c.left && <div className="ch-info-section">
          <div className="ch-sec-title-row">
            <div className="ch-sec-title">Thành viên ({members.length || c.member_count || 0})</div>
            {!c.left && (
              <button type="button" className="ch-pjm-add-btn" title="Thêm người vào nhóm" onClick={e => { e.stopPropagation(); onToggleMemberPop() }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            )}
            {memberPopOpen && <AddMemberPopover conv={c} chat={chat} onClose={onCloseMemberPop} />}
          </div>
          {!members.length && <div className="ch-info-note">Đang tải thành viên…</div>}
          {sorted.map(m => {
            const self = m.user_id === me.id
            const canRole = !c.left && L.canSetRole(myRole, m.role) && !self
            const canRemove = !c.left && !self && L.canRemoveMember(myRole, m.role, false)
            return (
              <div key={m.user_id} className="ch-member-row">
                <span className="ch-m-avatar" style={{ background: colorFor(m.user_id) }}>{initials(m.display_name)}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="ch-m-name">{m.display_name}{self ? ' (bạn)' : ''}</span><br />
                  <span className="ch-m-role">{L.ROLE_LABEL[m.role] || m.role}</span>
                </span>
                <span className="ch-member-actions">
                  {canRole && (
                    <button type="button" className="ch-msg-action-btn" disabled={!!busy}
                      title={m.role === 'admin' ? 'Bỏ quyền quản trị' : 'Đặt làm quản trị viên'}
                      onClick={() => act('role' + m.user_id, () => setMemberRole(c.id, m.user_id, m.role === 'admin' ? 'member' : 'admin'))}>
                      <svg {...ico} fill={m.role === 'admin' ? 'currentColor' : 'none'}><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /></svg>
                    </button>
                  )}
                  {canRemove && (
                    <button type="button" className="ch-msg-action-btn" disabled={!!busy} title="Xoá khỏi nhóm"
                      onClick={() => { if (window.confirm(`Xoá ${m.display_name} khỏi nhóm?`)) act('rm' + m.user_id, () => removeMember(c.id, m.user_id)) }}>
                      <svg {...ico}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>}
        {!c.left && L.canRename(myRole) && (
          <div className="ch-info-section">
            <div className="ch-sec-title">Tên nhóm</div>
            {renaming === null ? (
              <button type="button" className="ch-info-btn" onClick={() => setRenaming(c.name || '')}>Đổi tên nhóm</button>
            ) : (
              <form className="ch-info-rename" onSubmit={e => {
                e.preventDefault()
                const n = renaming.trim()
                if (!n || n.length > L.MAX_GROUP_NAME) { setErr('Tên nhóm từ 1 đến 100 ký tự'); return }
                act('rename', () => renameGroup(c.id, n), () => setRenaming(null))
              }}>
                <input autoFocus maxLength={L.MAX_GROUP_NAME} value={renaming} onChange={e => setRenaming(e.target.value)} />
                <div className="ch-pjm-actions">
                  <button type="button" className="ch-pjm-btn" onClick={() => setRenaming(null)}>Huỷ</button>
                  <button className="ch-pjm-btn primary" disabled={!!busy}>Lưu</button>
                </div>
              </form>
            )}
          </div>
        )}
        {muteBlock}
        {!c.left && (
          <div className="ch-info-section">
            <button type="button" className="ch-info-btn danger" disabled={!!busy}
              onClick={() => {
                const owner = myRole === 'owner' ? ' Bạn là trưởng nhóm, quyền trưởng nhóm sẽ chuyển cho quản trị viên / thành viên vào sớm nhất.' : ''
                if (window.confirm('Rời nhóm "' + L.convTitle(c) + '"?' + owner)) act('leave', () => removeMember(c.id, me.id), onLeft)
              }}>
              Rời nhóm
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="ch-info-panel">
      <div className="ch-info-hero">
        <div className={'ch-avatar-lg' + (av.type === 'dm' ? ' round' : '')} style={{ background: av.color }}>
          {av.type === 'dm' ? initials(av.name) : <IconSvg kind="group" />}
        </div>
        <div className="ch-name">{L.convTitle(c)}</div>
        {sub && <div className="ch-sub">{sub}</div>}
      </div>
      {err && <div className="ch-info-err" role="alert">{err}</div>}
      {c.left && <div className="ch-info-note">Bạn không còn là thành viên của cuộc trò chuyện này.</div>}
      {body}
    </div>
  )
}
