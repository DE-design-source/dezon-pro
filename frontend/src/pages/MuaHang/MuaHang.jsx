import { useState } from 'react'
import { Link } from 'react-router-dom'
import './MuaHang.css'
import { useTheme } from '../../hooks/useTheme'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import WorkGate from '../../components/ui/WorkGate'
import { MH_TABS } from '../../data/pageTabs'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'
import PurchaseDashboard from './components/PurchaseDashboard'

export default function MuaHang() {
  const { theme, toggleTheme } = useTheme()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [pageTab, setPageTab] = useState('main') // main | nhansu
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  const tabHidden = usePageTabsHidden('/mua-hang')
  useTabFallback(tabHidden, pageTab, MH_TABS.map(t => t.key), setPageTab)

  return (
    <div
      className={`mh-page${aiOpen ? ' mh-ai-open' : ''}${aiResizing ? ' mh-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="mh-header">
        <div className="mh-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Mua hàng</span>
        <div className="hdr-tabs" role="tablist">
          {MH_TABS.filter(t => tabHidden.indexOf(t.key) < 0).map(t => (
            <button key={t.key} className={`hdr-tab${pageTab === t.key ? ' active' : ''}`} onClick={() => setPageTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <Link to="/qs" className="mh-qs-link">Xem bóc tách tại QS ›</Link>
        <button className="mh-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {/* Tổng quan: gom thông tin mua hàng của QS, Quản lý thiết kế, Quản lý dự án (cần đăng nhập; quyền từng nguồn xét trong api.js) */}
      <div className="mh-scroll mh-scroll-dash" style={pageTab === 'nhansu' ? { display: 'none' } : undefined}>
        <WorkGate title="Mua hàng">
          <PurchaseDashboard />
        </WorkGate>
      </div>

      {pageTab === 'nhansu' && (
        <div className="mh-scroll">
          <DeptStaff units={['muahang']} />
        </div>
      )}

      <Dezbot
        open={aiOpen}
        onToggle={() => setAiOpen(o => !o)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />
    </div>
  )
}
