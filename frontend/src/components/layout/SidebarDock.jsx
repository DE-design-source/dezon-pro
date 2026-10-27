import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { NAV_MAIN, NAV_BOTTOM } from '../../data/navigation'

const SIZE = 44 // đường kính nút tròn
const MARGIN = 6 // khoảng cách tối thiểu tới mép màn hình
const POS_KEY = 'siteflow-dock-pos'
const clamp = p => ({
  x: Math.min(Math.max(MARGIN, p.x), window.innerWidth - SIZE - MARGIN),
  y: Math.min(Math.max(MARGIN, p.y), window.innerHeight - SIZE - MARGIN),
})

/* Vị trí đã lưu, chưa có thì đặt giữa mép trên (vùng thường trống của thanh tiêu đề trang) */
function initialPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY))
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return clamp(p)
  } catch { /* bỏ qua */ }
  return clamp({ x: window.innerWidth / 2 - SIZE / 2, y: 10 })
}

function ItemIcon({ pathData, size = 18 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: pathData }}
    />
  )
}

const actIcon = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

/*
 * Sidebar khi thu gọn tối đa: một nút tròn nổi, kéo đi được.
 *  - Rê chuột vào: nở thành thanh hiện trang đang mở + các nút tải lại / mở rộng sidebar / đóng.
 *  - Bấm vào: mở lại sidebar đầy đủ (chiếm chỗ bên trái như bình thường).
 */
export default function SidebarDock({ onExpand }) {
  const [pos, setPos] = useState(initialPos)
  const [dragging, setDragging] = useState(false)
  const [pillOff, setPillOff] = useState(false) // đã bấm X: ẩn thanh cho tới khi chuột rời nút
  const drag = useRef(null)
  const { pathname } = useLocation()

  /* Đổi cỡ cửa sổ: giữ nút trong màn hình */
  useEffect(() => {
    const onResize = () => setPos(p => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* Kéo nút để đổi chỗ; nhả ra mà chưa kéo quá vài pixel thì tính là bấm (mở sidebar) */
  function onPointerDown(e) {
    if (e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* con trỏ không còn hợp lệ */ }
    drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, moved: false }
  }
  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px, dy = e.clientY - d.py
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return
    d.moved = true
    setDragging(true)
    setPos(clamp({ x: d.x + dx, y: d.y + dy }))
  }
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      setDragging(false)
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* bỏ qua */ }
    } else onExpand()
  }

  const all = [...NAV_MAIN, ...NAV_BOTTOM]
  const current = all.find(i => (i.path === '/' ? pathname === '/' : pathname === i.path || pathname.startsWith(i.path + '/')))

  /* Nút nằm nửa phải màn hình thì thanh nở sang trái để không tràn ra ngoài */
  const toLeft = pos.x + SIZE / 2 > window.innerWidth / 2
  const place = toLeft
    ? { top: pos.y - 4, right: window.innerWidth - pos.x - SIZE - 4 }
    : { top: pos.y - 4, left: pos.x - 4 }

  return (
    <div
      className={`sidebar-dock${toLeft ? ' left' : ''}${dragging ? ' dragging' : ''}${pillOff ? ' pill-off' : ''}`}
      style={place}
      onMouseLeave={() => setPillOff(false)}
    >
      <button
        type="button" className="sidebar-dock-logo" title="Mở sidebar (kéo để đổi chỗ)"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      >
        {/* Logo của app, giống logo ở đầu sidebar */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z" />
          <circle cx="12" cy="9" r="2.3" />
        </svg>
      </button>
      <div className="sidebar-dock-pill">
        <span className="sidebar-dock-page">{current ? <ItemIcon pathData={current.icon} size={16} /> : null}</span>
        <span className="sidebar-dock-title"><b>{current ? current.label : 'SiteFlow'}</b><small>Đang hoạt động</small></span>
        <button type="button" className="sidebar-dock-act" title="Tải lại trang" onClick={() => window.location.reload()}>
          <svg {...actIcon}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /></svg>
        </button>
        <button type="button" className="sidebar-dock-act" title="Mở rộng sidebar" onClick={onExpand}>
          <svg {...actIcon}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
        </button>
        <button type="button" className="sidebar-dock-act" title="Đóng" onClick={() => setPillOff(true)}>
          <svg {...actIcon}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </div>
  )
}
