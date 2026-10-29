import { useState } from 'react'
import './DuAn.css'
import { useTheme } from '../../hooks/useTheme'
/* Danh sách, thiết lập, nhân sự, tiến độ dùng chung component với Quản lý thiết kế; dữ liệu theo dự án loại "construction" */
import { MembersProvider } from '../QuanLyThietKe/components/ProjectMembers'
import ProjectListTab from '../QuanLyThietKe/components/ProjectListTab'
import SetupTab from '../QuanLyThietKe/components/SetupTab'
import WorkGate from '../../components/ui/WorkGate'
import { DeliveryProvider } from '../QuanLyThietKe/delivery'
import GanttTab from '../QuanLyThietKe/components/GanttTab'
import '../QuanLyThietKe/QuanLyThietKe.css'
import NhiemVuTab from './components/NhiemVuTab'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'

const MAIN_TABS = [
  { key: 'list', label: 'Danh sách dự án' },
  { key: 'create', label: 'Thiết lập thi công' },
  { key: 'tiendo', label: 'Tiến độ' },
  { key: 'nhiemvu', label: 'Nhiệm vụ' },
  { key: 'nhansu', label: 'Cơ cấu phòng ban' },
]
const VALID_TABS = ['list', 'create', 'tiendo', 'nhiemvu', 'nhansu', 'detail']
const VALID_GTABS = ['overview', 'mission', 'rewards', 'leaderboard']

/* Đọc tab ban đầu từ hash (#tiendo, #detail, #nhiemvu-rewards...) giống bản HTML */
function initialRoute() {
  const hash = (window.location.hash || '').replace('#', '')
  if (hash.startsWith('nhiemvu-')) {
    const gtab = hash.slice('nhiemvu-'.length)
    return { tab: 'nhiemvu', sub: 'setup', gtab: VALID_GTABS.includes(gtab) ? gtab : 'overview' }
  }
  if (hash === 'detail') return { tab: 'create', sub: 'detail', gtab: 'overview' }
  return { tab: VALID_TABS.includes(hash) ? hash : 'list', sub: 'setup', gtab: 'overview' }
}

export default function DuAn() {
  return <WorkGate tab="thicong" title="Quản lý dự án"><DeliveryProvider kind="construction"><DuAnPage /></DeliveryProvider></WorkGate>
}

function DuAnPage() {
  const { theme, toggleTheme } = useTheme()
  const [route] = useState(initialRoute)
  const [tab, setTab] = useState(route.tab)
  const [createSub, setCreateSub] = useState(route.sub)
  const [gtab, setGtab] = useState(route.gtab)

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  function goToTab(name) {
    if (name === 'detail') {
      setTab('create')
      setCreateSub('detail')
      return
    }
    setTab(name)
  }

  const panelStyle = key => ({ display: tab === key ? 'flex' : 'none' })

  return (
    <MembersProvider>
      <div
        className={`da-page${aiOpen ? ' da-ai-open' : ''}${aiResizing ? ' da-ai-resizing' : ''}`}
        style={{ '--ai-panel-width': `${aiWidth}px` }}
      >
        <div className="da-header">
          <div className="da-header-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          </div>
          <span className="da-header-title">Quản lý dự án</span>
          <div className="hdr-tabs" role="tablist">
            {MAIN_TABS.map(t => (
              <button key={t.key} className={`da-proj-tab${tab === t.key ? ' active' : ''}`} onClick={() => goToTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <button className="da-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
            {theme === 'dark'
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
          </button>
        </div>

        {/* Các tab luôn được mount (ẩn bằng display) để giữ trạng thái khi chuyển tab, giống bản HTML */}
        <div className="da-content">
          <div className="da-panel" style={panelStyle('tiendo')}>
            <div className="tk-page tk-embed"><GanttTab active={tab === 'tiendo'} /></div>
          </div>
          <div className="da-panel-scroll" style={panelStyle('list')}>
            <div className="tk-page tk-embed"><ProjectListTab onGoto={goToTab} /></div>
          </div>
          <div className="da-panel-scroll" style={panelStyle('create')}>
            <div className="tk-page tk-embed"><SetupTab sub={createSub} onSubChange={setCreateSub} onGoto={goToTab} /></div>
          </div>
          <div className="da-panel-scroll" style={panelStyle('nhiemvu')}>
            <NhiemVuTab gtab={gtab} onGtabChange={setGtab} />
          </div>
          <div className="da-panel-scroll" style={panelStyle('nhansu')}>
            <DeptStaff units={['cco']} title="Khối thi công (CCO)" />
          </div>
        </div>

        <Dezbot
          open={aiOpen}
          onToggle={() => setAiOpen(o => !o)}
          onClose={() => setAiOpen(false)}
          onResize={setAiWidth}
          onResizingChange={setAiResizing}
        />
      </div>
    </MembersProvider>
  )
}
