import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useTheme } from '../../hooks/useTheme'
import { useSidebar } from '../../hooks/useSidebar'
import { NAV_MAIN, NAV_BOTTOM } from '../../data/navigation'
import SidebarDock from './SidebarDock'
import { useNavHidden } from '../../hooks/useNavHidden'
import { DezonWordmark } from '../ui/DezonLogo'
import { useChatUnreadTotal } from '../../pages/Chat/state/chatStore'
import { useWorkSession } from '../../services/workSession'

function NavIcon({ pathData }) {
  return (
    <svg
      width="17" height="17" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: pathData }}
    />
  )
}

function NavItem({ item, collapsed, badge = item.badge }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}
      style={collapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined}
    >
      <NavIcon pathData={item.icon} />
      {!collapsed && <span className="nav-label" style={{ flex: 1, fontSize: '13px' }}>{item.label}</span>}
      {badge && !collapsed && (
        <span style={{
          background: 'var(--danger, #ff4d4f)', color: '#fff',
          fontSize: '10px', fontWeight: 700,
          padding: '1px 6px', borderRadius: '20px', flex: 'none',
        }}>
          {badge}
        </span>
      )}
      {badge && collapsed && (
        <span style={{
          position: 'absolute', top: 6, right: 6,
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--danger, #ff4d4f)', border: '1.5px solid var(--sb-bg)',
        }} />
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  const { toggleTheme } = useTheme()
  // Lấy các hàm điều khiển từ hook (có hỗ trợ expand nếu hook của bạn có)
  const sidebarControls = useSidebar()
  const { level, cycle, collapse } = sidebarControls
  const expand = sidebarControls.expand || cycle // Sử dụng expand nếu có, không thì cycle về trạng thái mở

  const isCollapsed = level === 'icons'
  const isUltra = level === 'logo'
  const chatUnread = useChatUnreadTotal() // 0 = không hiện số (chưa đăng nhập chat / không có tin chưa đọc)
  // chỉ hiện trang tài khoản được cấp quyền (Cài đặt > Admin) và chưa bị người dùng ẩn ở Cài đặt > Hiển thị; Cài đặt luôn hiện
  const navHidden = useNavHidden()
  const shown = item => navHidden.indexOf(item.path) < 0
  const { canPage } = useWorkSession()
  const navMain = NAV_MAIN.filter(it => canPage(it.perm) && shown(it))
  const navBottom = NAV_BOTTOM.filter(it => canPage(it.perm) && shown(it))

  /* Thu gọn tối đa: sidebar không chiếm chỗ, chỉ còn nút tròn nổi (SidebarDock) để mở menu */
  /* Báo mức thu gọn cho CSS (global.css chừa chỗ cho cụm nổi ở các trang có lề hẹp) */
  useEffect(() => {
    document.documentElement.setAttribute('data-sidebar-level', level)
  }, [level])

  const width = isUltra ? 0 : isCollapsed ? 76 : 232

  return (
    <>
      {/* Màu của sidebar lấy từ các biến --sb-* trong global.css để đổi theo chế độ sáng/tối */}
      <style>{`
        .sidebar-nav-item {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 9px 10px 9px 13px;
          border-radius: 9px;
          color: var(--sb-text);
          text-decoration: none;
          font-weight: 400;
          font-size: 13px;
          position: relative;
          border-left: 3px solid transparent;
          transition: background 0.13s, color 0.13s;
        }
        .sidebar-nav-item:hover {
          background: var(--sb-hover);
          color: var(--sb-strong);
        }
        .sidebar-nav-item.active {
          background: var(--sb-active-bg);
          color: var(--sb-active-text);
          font-weight: 600;
          border-left-color: var(--primary, #2F5DA8);
        }
        .sidebar-divider {
          height: 1px;
          background: var(--sb-border);
          margin: 8px 0;
        }
      `}</style>

      <div
        id="appSidebar"
        className="app-sidebar"
        style={{
          width, flex: 'none', background: 'var(--sb-bg)', color: 'var(--sb-text)',
          display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box', padding: isUltra ? 0 : '20px 10px',
          transition: 'width .18s ease', overflow: 'hidden',
        }}
      >
        {/* Brand & Toggle Buttons */}
        {!isUltra && <div style={{
          display: 'flex',
          flexDirection: (isCollapsed || isUltra) ? 'column' : 'row',
          alignItems: 'center',
          gap: 10,
          padding: isCollapsed || isUltra ? '0 0 16px' : '0 4px 22px',
          justifyContent: isCollapsed || isUltra ? 'center' : 'space-between',
        }}>
          {/* Khi đang mở rộng: Hiện tên và 2 nút thu gọn */}
          {!isCollapsed && !isUltra && (
            <>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--sb-strong)' }}><DezonWordmark height={18} /></span>
              
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={collapse}
                  title="Thu gọn tối đa (chỉ còn logo)"
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    border: '1px solid var(--sb-border)', background: 'transparent',
                    color: 'var(--sb-text)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', flex: 'none',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                  </svg>
                </button>

                <button
                  onClick={cycle}
                  title="Thu gọn menu"
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    border: '1px solid var(--sb-border)', background: 'transparent',
                    color: 'var(--sb-text)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', flex: 'none',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
              </div>
            </>
          )}

          {/* NÚT MỞ RỘNG KHI ĐANG THU GỌN (Hiện ở cả chế độ icons lẫn logo) */}
          {(isCollapsed || isUltra) && (
            <button
              onClick={expand}
              title="Mở rộng sidebar"
              style={{
                width: 26, height: 26, borderRadius: 6,
                border: '1px solid var(--sb-border)', background: 'var(--sb-btn-bg)',
                color: 'var(--sb-strong)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', flex: 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          )}
        </div>}

        {/* Main nav */}
        {!isUltra && (
          // Màn hình thấp (laptop, cỡ chữ lớn): menu tự cuộn thay vì bị cắt mất các mục cuối
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {navMain.map(item => (
              <NavItem key={item.path} item={item} collapsed={isCollapsed}
                badge={item.path === '/chat' ? (chatUnread > 99 ? '99+' : chatUnread || null) : item.badge} />
            ))}

            {navMain.length > 0 && <div className="sidebar-divider" style={{ margin: '10px 0 6px' }} />}

            {navBottom.map(item => (
              <NavItem key={item.path} item={item} collapsed={isCollapsed} />
            ))}
          </nav>
        )}


        {/* User Profile
        {!isUltra && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 6px 0', marginTop: 8, flex: 'none',
            borderTop: '1px solid var(--sb-border)',
            justifyContent: isCollapsed ? 'center' : undefined,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--sb-chip)', color: 'var(--sb-strong)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 600, fontSize: '12.5px', flex: 'none',
            }}>TA</div>
            {!isCollapsed && (
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--sb-strong)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>Trần Anh</div>
                <div style={{ color: 'var(--sb-muted)', fontSize: 11.5, whiteSpace: 'nowrap' }}>Quản lý dự án</div>
              </div>
            )}
          </div>
        )} */}
      </div>

      {isUltra && <SidebarDock onExpand={expand} />}
    </>
  )
}