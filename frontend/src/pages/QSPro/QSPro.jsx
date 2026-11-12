import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { NAV_MAIN, NAV_BOTTOM } from '../../data/navigation'
import { useWorkSession } from '../../services/workSession'
import './QSPro.css'
import { DezonMark, DezonWordmark } from '../../components/ui/DezonLogo'

/* Trang QS Pro: nhúng ứng dụng QS Pro (trang ngoài) phủ kín màn hình.
   Giao diện Dezon thu lại thành một nút tròn nổi:
   - rê chuột vào → bung thành thanh điều khiển (QS Pro · tải lại · tab mới · đóng)
   - bấm vào logo → mở menu Dezon (sidebar) để chuyển sang trang khác
   - giữ và kéo logo → di chuyển nút đi chỗ khác */

const QS_PRO_URL = 'https://qs-pro-srgx.onrender.com/'
const POS_KEY = 'siteflow-qspro-dock-pos'
const DOCK = 46 // đường kính nút tròn (px)

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY))
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return p
  } catch { /* bỏ qua */ }
  return null
}

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

function NavIcon({ pathData }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} dangerouslySetInnerHTML={{ __html: pathData }} />
}

const ALL_NAV = [...NAV_MAIN, ...NAV_BOTTOM]
const ROLE_LBL = { super: 'Quản trị hệ thống', admin: 'Quản trị công ty', staff: 'Nhân viên' }
// chữ đầu của từ đầu + từ cuối: "Trần Anh" -> "TA"
const initials = s => { const w = String(s || '').trim().split(/\s+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase() }
/* Bỏ dấu tiếng Việt để gõ "kinh doanh" hay "kinh doanh" không dấu đều tìm ra */
const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

function MenuItem({ item, onPick, index, highlighted, onHover, stagger }) {
  const ref = useRef(null)
  /* Di chuyển bằng phím mũi tên thì cuộn mục đang chọn vào tầm nhìn */
  useEffect(() => { if (highlighted && ref.current) ref.current.scrollIntoView({ block: 'nearest' }) }, [highlighted])
  return (
    <NavLink
      ref={ref} to={item.path} end={item.path === '/'} onClick={onPick} onMouseEnter={onHover}
      style={stagger ? { animationDelay: `${Math.min(index, 14) * 18}ms` } : { animation: 'none' }}
      className={({ isActive }) => 'qsp-nav-item' + (isActive ? ' active' : '') + (highlighted ? ' hl' : '')}
    >
      <NavIcon pathData={item.icon} />
      <span className="qsp-nav-label">{item.label}</span>
      {item.badge ? <span className="qsp-nav-badge">{item.badge}</span> : null}
      {highlighted ? <kbd className="qsp-kbd">↵</kbd> : null}
    </NavLink>
  )
}

export default function QSPro() {
  const navigate = useNavigate()
  const location = useLocation()
  // menu chỉ có các trang tài khoản được cấp quyền (data/navigation.js perm)
  const { me, canPage } = useWorkSession()
  const ALL_PAGES = ALL_NAV.filter(p => canPage(p.perm))
  const name = (me && (me.hoTen || me.username)) || ''
  const [frameKey, setFrameKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  /* null = vị trí mặc định (góc dưới bên trái) */
  const [pos, setPos] = useState(loadPos)
  const [dragging, setDragging] = useState(false)
  /* Ô tìm trang trong menu + mục đang được chọn bằng phím mũi tên */
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const searchRef = useRef(null)
  const results = query.trim() ? ALL_PAGES.filter(p => fold(p.label).includes(fold(query.trim()))) : ALL_PAGES

  function openMenu() { setQuery(''); setHi(ALL_PAGES.findIndex(p => p.path === location.pathname)); setMenuOpen(true) }
  function goTo(item) { setMenuOpen(false); navigate(item.path) }
  function onSearchKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (results.length ? (h + 1) % results.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (results.length ? (h - 1 + results.length) % results.length : 0)) }
    else if (e.key === 'Enter' && results[hi]) { e.preventDefault(); goTo(results[hi]) }
  }
  useEffect(() => { if (menuOpen && searchRef.current) searchRef.current.focus() }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  /* Đóng QS Pro: quay lại trang Dezon đang xem trước đó; mở thẳng /qs-pro thì về trang chủ */
  function closeQs() {
    if (location.key !== 'default') navigate(-1)
    else navigate('/')
  }
  function reload() {
    setLoading(true)
    setFrameKey(k => k + 1)
  }

  /* Nhấn vào logo: nhích chuột quá 4px thì là kéo nút, còn lại là bấm → mở menu.
     Giữ con trỏ (pointer capture) để iframe bên dưới không nuốt sự kiện chuột. */
  function onLogoPointerDown(e) {
    if (e.button !== 0) return
    const btn = e.currentTarget
    const rect = btn.getBoundingClientRect()
    const dx = e.clientX - rect.left
    const dy = e.clientY - rect.top
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    let latest = null
    try { btn.setPointerCapture(e.pointerId) } catch { /* con trỏ không còn hoạt động */ }
    function onMove(ev) {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return
      moved = true
      setDragging(true)
      latest = {
        x: Math.max(8, Math.min(window.innerWidth - DOCK - 8, ev.clientX - dx)),
        y: Math.max(8, Math.min(window.innerHeight - DOCK - 8, ev.clientY - dy)),
      }
      setPos(latest)
    }
    function onUp() {
      btn.removeEventListener('pointermove', onMove)
      btn.removeEventListener('pointerup', onUp)
      btn.removeEventListener('pointercancel', onUp)
      setDragging(false)
      if (!moved) { openMenu(); return }
      if (latest) { try { localStorage.setItem(POS_KEY, JSON.stringify(latest)) } catch { /* bỏ qua */ } }
    }
    btn.addEventListener('pointermove', onMove)
    btn.addEventListener('pointerup', onUp)
    btn.addEventListener('pointercancel', onUp)
  }

  /* Nút nằm ở nửa phải màn hình thì thanh bung sang trái để không tràn ra ngoài */
  const onRight = pos ? pos.x + DOCK / 2 > window.innerWidth / 2 : false
  const dockStyle = !pos ? undefined
    : onRight ? { right: Math.max(8, window.innerWidth - pos.x - DOCK), left: 'auto', top: pos.y, bottom: 'auto' }
      : { left: pos.x, top: pos.y, bottom: 'auto' }

  return (
    <div className="qsp-page">
      <iframe
        key={frameKey}
        className="qsp-frame"
        src={QS_PRO_URL}
        title="QS Pro"
        onLoad={() => setLoading(false)}
        /* Đang kéo nút thì tạm khoá chuột trên iframe */
        style={dragging ? { pointerEvents: 'none' } : undefined}
      />

      {loading && (
        <div className="qsp-loading">
          <span className="qsp-loading-logo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>
          </span>
          <div className="qsp-loading-title">Đang mở QS Pro</div>
          <div className="qsp-loading-bar"><span /></div>
          <div className="qsp-loading-sub">Máy chủ QS Pro có thể mất khoảng một phút để khởi động nếu đã lâu không dùng.</div>
        </div>
      )}

      {/* ---------- Nút nổi: rê chuột để bung thanh điều khiển ---------- */}
      {!menuOpen && (
        <div className={`qsp-dock${onRight ? ' right' : ''}${dragging ? ' dragging' : ''}`} style={dockStyle}>
          <button type="button" className={`qsp-logo${loading ? ' loading' : ''}`} onPointerDown={onLogoPointerDown} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openMenu() }} aria-label="Mở menu Dezon" data-tip="Bấm: mở menu · Giữ kéo: di chuyển">
            <span className="qsp-ring" />
            <DezonMark size={19} />
            <span className={`qsp-status${loading ? ' busy' : ''}`} />
          </button>
          <div className="qsp-dock-more">
            <span className="qsp-app">
              <svg {...icon}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>
              <span className="qsp-app-text">
                <strong>QS Pro</strong>
                <small>{loading ? 'Đang tải…' : 'Đang hoạt động'}</small>
              </span>
            </span>
            <span className="qsp-sep" />
            <button type="button" className="qsp-icon-btn" onClick={reload} aria-label="Tải lại QS Pro" data-tip="Tải lại">
              <svg {...icon}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /></svg>
            </button>
            <a className="qsp-icon-btn" href={QS_PRO_URL} target="_blank" rel="noopener noreferrer" aria-label="Mở QS Pro ở tab mới" data-tip="Mở tab mới">
              <svg {...icon}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
            </a>
            <button type="button" className="qsp-icon-btn close" onClick={closeQs} aria-label="Đóng QS Pro, quay lại Dezon" data-tip="Đóng QS Pro">
              <svg {...icon}><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ---------- Menu Dezon (sidebar) khi bấm vào logo ---------- */}
      {menuOpen && (
        <>
          <div className="qsp-backdrop" onClick={() => setMenuOpen(false)} />
          <aside className="qsp-menu">
            <div className="qsp-menu-head">
              <span className="qsp-menu-brand"><DezonWordmark height={18} white /></span>
              <button type="button" className="qsp-icon-btn" onClick={() => setMenuOpen(false)} title="Đóng menu, tiếp tục dùng QS Pro">
                <svg {...icon}><path d="M15 18l-6-6 6-6" /></svg>
              </button>
            </div>
            <div className="qsp-menu-current">
              <span className="qsp-menu-current-icon">
                <svg {...icon}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></svg>
              </span>
              <span className="qsp-app-text" style={{ flex: 1 }}>
                <strong>QS Pro</strong>
                <small>{loading ? 'Đang tải…' : 'Đang mở'}</small>
              </span>
              <button type="button" className="qsp-icon-btn sm" onClick={() => { setMenuOpen(false); reload() }} title="Tải lại QS Pro">
                <svg {...icon}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /></svg>
              </button>
              <a className="qsp-icon-btn sm" href={QS_PRO_URL} target="_blank" rel="noopener noreferrer" title="Mở QS Pro ở tab mới">
                <svg {...icon}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
              </a>
            </div>
            <div className="qsp-search">
              <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                ref={searchRef} type="text" placeholder="Tìm trang…" value={query}
                onChange={e => { setQuery(e.target.value); setHi(0) }} onKeyDown={onSearchKey}
              />
              <kbd className="qsp-kbd">↑↓</kbd>
            </div>
            <nav className="qsp-menu-nav">
              {results.map((item, i) => (
                <MenuItem
                  key={item.path} item={item} index={i} stagger={!query}
                  highlighted={i === hi} onHover={() => setHi(i)} onPick={() => setMenuOpen(false)}
                />
              ))}
              {!results.length && <div className="qsp-empty">Không có trang nào khớp “{query.trim()}”.</div>}
            </nav>
            <div className="qsp-menu-hint"><kbd className="qsp-kbd">↵</kbd> mở trang <span /> <kbd className="qsp-kbd">Esc</kbd> quay lại QS Pro</div>
            <div className="qsp-menu-user">
              <span className="qsp-menu-avatar">{initials(name)}</span>
              <div>
                <div className="qsp-menu-name">{name}</div>
                <div className="qsp-menu-role">{ROLE_LBL[me && me.role] || 'Nhân viên'}</div>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
