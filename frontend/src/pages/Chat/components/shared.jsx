/* Phần dùng chung của trang Chat: initials(), iconSvg(), convAvatarHTML() trong chat.html */
import { useState } from 'react'
import { COLORS } from '../../../data/chatData'

export function initials(name) {
  /* bỏ ký tự không phải chữ / số ở đầu từ: "Châu Lê (QS)" -> CQ, không phải "C(" */
  const parts = String(name || '').trim().split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/* Màu avatar cố định theo id người dùng / hội thoại */
const PALETTE = [COLORS.blue, COLORS.teal, COLORS.amber, COLORS.purple, COLORS.green, COLORS.pink]
export function colorFor(id) {
  const n = Math.abs(Number(id) || 0)
  return PALETTE[n % PALETTE.length]
}

/* iconSvg(kind) — icon trắng 19px của nhóm / bot */
export function IconSvg({ kind }) {
  const p = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (kind === 'building') return <svg {...p}><path d="M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18" /><path d="M6 12h12M6 8h12M6 16h12" /><path d="M10 22v-4h4v4" /></svg>
  if (kind === 'hardhat') return <svg {...p}><path d="M3 18h18" /><path d="M5 18a7 7 0 0 1 14 0" /><path d="M12 8v3" /><path d="M9 4h6" /></svg>
  if (kind === 'bot') return <svg {...p}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 8V4" /><circle cx="9" cy="14" r="1.2" fill="#fff" stroke="none" /><circle cx="15" cy="14" r="1.2" fill="#fff" stroke="none" /></svg>
  if (kind === 'group') return <svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0" /><circle cx="17" cy="9" r="2.5" /><path d="M17.5 14.5A5 5 0 0 1 22 19" /></svg>
  return null
}

/* convAvatarHTML(c, size) — extraClass dùng cho đầu thread ("conv-avatar t-avatar").
   conv: {type: 'dm' | 'group' | 'bot', name, color, icon, online, avatar?} */
export function ConvAvatar({ conv, size = 42, extraClass = '' }) {
  const [broken, setBroken] = useState('')
  const style = { width: size, height: size, background: conv.color }
  const cls = 'ch-conv-avatar' + (extraClass ? ' ' + extraClass : '')
  if (conv.type === 'dm') {
    return (
      <div className={cls + ' round'} style={style}>
        {initials(conv.name)}
        {conv.online && <span className="ch-dot-online" />}
      </div>
    )
  }
  /* nhóm có ảnh (ready): ảnh thu nhỏ, lỗi tải thì quay về icon nhóm */
  const a = conv.type === 'group' ? conv.avatar : null
  const src = a ? (a.thumb_url || a.url || '') : ''
  if (src && broken !== src) {
    return (
      <div className={cls} style={{ ...style, overflow: 'hidden' }}>
        <img src={src} alt="" onError={() => setBroken(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    )
  }
  return <div className={cls} style={style}><IconSvg kind={conv.type === 'bot' ? 'bot' : conv.icon} /></div>
}

/* Hội thoại máy chủ -> dạng ConvAvatar cần (1-1 tròn có chấm online, nhóm vuông icon nhóm) */
export function avatarConv(c, online) {
  if (c.type === 'direct') {
    const peer = c.peer || {}
    return { type: 'dm', name: peer.display_name || c.name || '', color: colorFor(peer.id || c.id), online: !!online }
  }
  return { type: 'group', name: c.name || '', color: colorFor(c.id), icon: 'group', avatar: c.avatar || null }
}

/* Đường path của icon ghim (dùng ở danh sách hội thoại, bubble, thanh ghim) */
export const PIN_PATH = 'M12 2a1 1 0 0 1 1 1v7l3 4v2H8v-2l3-4V3a1 1 0 0 1 1-1z'

/* Icon tệp (file-chip, attach preview, info panel) */
export function FileIcon({ size }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
}

/* Icon nhóm người (nút Danh bạ, nút thêm người vào nhóm) */
export function UsersIcon({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}

/* Icon kính lúp của ô tìm kiếm */
export function SearchIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
}

/* Trạng thái tin của mình: đang gửi (đồng hồ), đã gửi (✓), đã nhận (✓✓), đã xem (✓✓ màu chính) */
const STATUS_TITLE = { sending: 'Đang gửi', sent: 'Đã gửi', delivered: 'Đã nhận', seen: 'Đã xem' }
export function StatusIcon({ status }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  let body
  if (status === 'sending') body = <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>
  else if (status === 'sent') body = <path d="M5 12.5l4.5 4.5L19 7.5" />
  else body = <><path d="M2.5 12.5L7 17l9.5-9.5" /><path d="M11.5 16l1 1L22 7.5" /></>
  return <span className={'ch-msg-status ' + status} title={STATUS_TITLE[status] || ''} aria-label={STATUS_TITLE[status] || ''}><svg {...p}>{body}</svg></span>
}

/* Thông báo lỗi ngắn trong các thao tác (kết bạn, đổi tên nhóm...) */
export const errText = e => (e && e.message) || 'Có lỗi, thử lại sau'
