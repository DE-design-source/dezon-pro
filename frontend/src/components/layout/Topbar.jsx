
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../../hooks/useTheme'
import { useSidebar } from '../../hooks/useSidebar'
import NotificationBell from './NotificationBell'
import { useWorkSession } from '../../services/workSession'

const ROLE_LBL = { super: 'Quản trị hệ thống', admin: 'Quản trị công ty', staff: 'Nhân viên' }
// chữ đầu của từ đầu + từ cuối: "Trần Anh" -> "TA"
const initials = s => { const w = String(s || '').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase() }
const menuItem = { display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13, color: 'var(--text)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }

/* Nút tài khoản (tài khoản Dezon Pro đang đăng nhập): bấm mở menu Tài khoản / Đăng xuất */
function UserMenu() {
  const { me, congTy, logout } = useWorkSession()
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!me) return null
  const name = me.hoTen || me.username || ''
  const cty = (congTy && congTy.ten) || (me.role === 'super' ? 'Toàn hệ thống' : '')
  return (
    <div ref={box} style={{ position: 'relative', flex: 'none' }}>
      <button type="button" onClick={() => setOpen(o => !o)} title={name} aria-haspopup="menu" aria-expanded={open} style={{
        width: 36, height: 36, borderRadius: '50%', border: 'none',
        background: 'var(--primary-tint)', color: 'var(--primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
      }}>{initials(name)}</button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 200, minWidth: 220, maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(15,30,60,.16)', overflow: 'hidden', padding: '4px 0',
        }}>
          <div style={{ padding: '10px 14px 9px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{[ROLE_LBL[me.role] || 'Nhân viên', cty].filter(Boolean).join(' · ')}</div>
          </div>
          <Link role="menuitem" to="/cai-dat?tab=account" style={menuItem} onClick={() => setOpen(false)}>Tài khoản</Link>
          <button role="menuitem" type="button" style={{ ...menuItem, color: 'var(--danger)' }} onClick={() => { setOpen(false); logout() }}>Đăng xuất</button>
        </div>
      )}
    </div>
  )
}

export default function Topbar({ title, subtitle, icon, children }) {
  const { theme, toggleTheme } = useTheme()
  const { level, cycle } = useSidebar()
  const [searchValue, setSearchValue] = useState('')

  return (
    <div className="app-topbar" style={{
      height: 64, borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      padding: '0 var(--page-gutter)', gap: 14,
      flex: 'none', background: 'var(--surface)',
    }}>

      {icon && (
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--primary-tint)', color: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
        }}>
          {icon}
        </div>
      )}

      {/* Tiêu đề & Subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0, lineHeight: 1.2 }}>{title}</h1>}
        {subtitle && <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0 }}>{subtitle}</p>}
      </div>

      {children}

      {/* 1. Thanh tìm kiếm (Tìm công việc, hồ sơ...) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--surface-alt)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '0 14px',
        height: 38,
        width: 250,
        gap: 9,
      }}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Tìm công việc, hồ sơ..."
          style={{
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: '13px',
            color: 'var(--text)',
            width: '100%',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* 2. Chuông thông báo (mở bảng thông báo) */}
      <NotificationBell color="currentColor" />

      {/* 3. Theme toggle */}
      <button
        onClick={toggleTheme}
        title="Đổi giao diện sáng/tối"
        style={{
          width: 36, height: 36, borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--surface-alt)',
          color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', flex: 'none',
        }}
      >
        {theme === 'dark'
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
        }
      </button>

      {/* 4. Tài khoản đang đăng nhập */}
      <UserMenu />
    </div>
  )
}