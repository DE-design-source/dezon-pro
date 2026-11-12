import { useCallback, useEffect, useState } from 'react'
import * as L from '../state/chatLogic'
import { unreadTotal } from '../state/chatStore'
import { colorFor, initials } from './shared'
import DevicesPanel from './DevicesPanel'
import QrApprove from './QrApprove'

const displayName = (u, id) => (u && u.display_name) || 'Tài khoản #' + id

/* Tài khoản chat ở đầu danh sách hội thoại: chip avatar của tài khoản (đăng nhập bằng tài khoản Dezon Pro, không đổi /
   thêm tài khoản, không đăng xuất riêng - đăng xuất là đăng xuất Dezon Pro). Bấm mở menu: "Thiết bị đăng nhập"
   (DevicesPanel), "Quét mã QR đăng nhập" (QrApprove: duyệt đăng nhập cho app di động). Bấm ra ngoài / Esc thì đóng. */
export default function AccountSwitcher({ chat }) {
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

  if (chat.auth !== 'ready' || !chat.me) return null
  const cur = chat.me
  const total = unreadTotal(chat)

  return (
    <div className="ch-acct" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className={'ch-acct-chip' + (open ? ' open' : '')}
        title={'Đang dùng: ' + displayName(cur, meId)}
        aria-label={'Tài khoản ' + displayName(cur, meId)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span className="ch-acct-av" style={{ background: colorFor(meId) }}>{initials(displayName(cur, meId))}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="ch-acct-menu" role="menu">
          <div className="ch-acct-title">Đăng nhập bằng tài khoản Dezon Pro</div>
          <div className="ch-acct-row active">
            <span className="ch-acct-av" style={{ background: colorFor(meId) }}>{initials(displayName(cur, meId))}</span>
            <span className="ch-acct-info"><b>{displayName(cur, meId)}</b><span>{L.contactText(cur)}</span></span>
            {total > 0 && <span className="ch-conv-unread">{total > 99 ? '99+' : total}</span>}
          </div>
          <div className="ch-acct-sep" />
          <button type="button" role="menuitem" className="ch-acct-act" onClick={() => { setOpen(false); setPanel('devices') }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="11" rx="2" /><path d="M6 19h6" /><rect x="17" y="8" width="5" height="12" rx="1.2" /></svg>
            Thiết bị đăng nhập
          </button>
          <button type="button" role="menuitem" className="ch-acct-act" onClick={() => { setOpen(false); setPanel('qr') }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></svg>
            Quét mã QR đăng nhập
          </button>
        </div>
      )}
      {panel === 'devices' && <DevicesPanel onClose={closePanel} />}
      {panel === 'qr' && <QrApprove onClose={closePanel} />}
    </div>
  )
}
