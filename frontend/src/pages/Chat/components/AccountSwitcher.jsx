import { useCallback, useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import { signOut, switchAccount, unreadTotal, unsentCount } from '../state/chatStore'
import { colorFor, initials } from './shared'
import DevicesPanel from './DevicesPanel'
import QrApprove from './QrApprove'
import { markSelfSignOut } from './qrUtil'

/* Hỏi trước khi đăng xuất tài khoản của tab (Danh bạ ▸ Đăng xuất, bộ chọn tài khoản ▸ Đăng xuất tài khoản này).
   Còn tin chưa gửi (cả của tab khác cùng tài khoản) thì báo sẽ huỷ; còn tài khoản khác thì nói rõ chúng vẫn đăng nhập. */
export function confirmSignOut(chat) {
  const n = unsentCount()
  const meId = chat && chat.me ? chat.me.id : null
  const others = ((chat && chat.accounts) || []).some(a => a.id !== meId)
  const msg = n
    ? `Còn ${n} tin chưa gửi được. Đăng xuất sẽ huỷ các tin này. Vẫn đăng xuất?`
    : others
      ? 'Đăng xuất tài khoản này khỏi trình duyệt? Các tài khoản khác vẫn đăng nhập.'
      : 'Đăng xuất Dezon Chat trên trình duyệt này?'
  if (!window.confirm(msg)) return
  markSelfSignOut(meId || (chat && chat.accountId)) // cổng không báo "bị đăng xuất từ xa" cho lần tự đăng xuất này
  signOut()
}

const displayName = (u, id) => (u && u.display_name) || 'Tài khoản #' + id

/* Bộ chọn tài khoản ở đầu danh sách hội thoại (mỗi tab một tài khoản): chip avatar của tài khoản đang dùng; bấm mở menu
   các tài khoản đã đăng nhập trên trình duyệt này, "Thêm tài khoản", "Đăng xuất tài khoản này". Đổi tài khoản chỉ đổi
   tab này. Bấm ra ngoài / Esc thì đóng. Tài khoản đang dùng có thêm "Thiết bị đăng nhập" (DevicesPanel) và
   "Quét mã QR đăng nhập" (QrApprove: duyệt đăng nhập cho máy mới). */
export default function AccountSwitcher({ chat, onAdd }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState('') // '' | devices | qr
  const closePanel = useCallback(() => setPanel(''), [])
  const meId = chat.me ? chat.me.id : null

  /* Đổi tài khoản / bị đăng xuất khi đang mở bảng thiết bị / quét QR: đóng (bảng thuộc tài khoản cũ) */
  useEffect(() => { setPanel('') }, [meId])

  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey) }
  }, [open])

  const accounts = chat.accounts || []
  const activeId = chat.me ? chat.me.id : chat.accountId
  if (chat.auth === 'unconfigured' || (!accounts.length && !chat.me)) return null
  const entry = accounts.find(a => a.id === activeId)
  const cur = chat.me || (entry && entry.user) || null
  const total = unreadTotal(chat)

  return (
    <div className="ch-acct" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className={'ch-acct-chip' + (open ? ' open' : '')}
        title={activeId ? 'Đang dùng: ' + displayName(cur, activeId) + ' · Đổi tài khoản' : 'Chọn tài khoản'}
        aria-label={activeId ? 'Tài khoản ' + displayName(cur, activeId) + ', đổi tài khoản' : 'Chọn tài khoản'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {activeId
          ? <span className="ch-acct-av" style={{ background: colorFor(activeId) }}>{initials(displayName(cur, activeId))}</span>
          : <span className="ch-acct-av empty">?</span>}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="ch-acct-menu" role="menu">
          <div className="ch-acct-title">Tài khoản trên trình duyệt này</div>
          {accounts.map(a => {
            const on = a.id === activeId
            const u = on && chat.me ? chat.me : a.user
            return (
              <button
                key={a.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={'ch-acct-row' + (on ? ' active' : '')}
                onClick={() => { setOpen(false); if (!on) switchAccount(a.id) }}
              >
                <span className="ch-acct-av" style={{ background: colorFor(a.id) }}>{initials(displayName(u, a.id))}</span>
                <span className="ch-acct-info"><b>{displayName(u, a.id)}</b><span>{L.contactText(u)}</span></span>
                {on && total > 0 && <span className="ch-conv-unread">{total > 99 ? '99+' : total}</span>}
                {on && (
                  <svg className="ch-acct-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Đang dùng"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                )}
              </button>
            )
          })}
          <div className="ch-acct-sep" />
          <button type="button" role="menuitem" className="ch-acct-act" onClick={() => { setOpen(false); onAdd() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 10-4.4" /><path d="M18 14v6M15 17h6" /></svg>
            Thêm tài khoản
          </button>
          {chat.me && chat.auth === 'ready' && (
            <>
              <button type="button" role="menuitem" className="ch-acct-act" onClick={() => { setOpen(false); setPanel('devices') }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="11" rx="2" /><path d="M6 19h6" /><rect x="17" y="8" width="5" height="12" rx="1.2" /></svg>
                Thiết bị đăng nhập
              </button>
              <button type="button" role="menuitem" className="ch-acct-act" onClick={() => { setOpen(false); setPanel('qr') }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></svg>
                Quét mã QR đăng nhập
              </button>
            </>
          )}
          {activeId && entry && (
            <button type="button" role="menuitem" className="ch-acct-act danger" onClick={() => { setOpen(false); confirmSignOut(chat) }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              Đăng xuất tài khoản này
            </button>
          )}
        </div>
      )}
      {panel === 'devices' && <DevicesPanel onClose={closePanel} />}
      {panel === 'qr' && <QrApprove onClose={closePanel} />}
    </div>
  )
}
