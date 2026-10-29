import { useState } from 'react'
import './QuanLyThietKe.css'
import { useTheme } from '../../hooks/useTheme'
import { MembersProvider } from './components/ProjectMembers'
import ProjectListTab from './components/ProjectListTab'
import SetupTab from './components/SetupTab'
import GanttTab from './components/GanttTab'
import NhanSuTab from './components/NhanSuTab'
import TaskGameTab from './components/TaskGameTab'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import WorkGate from '../../components/ui/WorkGate'
import { DeliveryProvider } from './delivery'

const MAIN_TABS = [
  { key: 'list', label: 'Danh sách dự án' },
  { key: 'create', label: 'Thiết lập thiết kế' },
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

export default function QuanLyThietKe() {
  return <WorkGate tab="thietke" title="Quản lý thiết kế"><DeliveryProvider kind="design"><QuanLyThietKePage /></DeliveryProvider></WorkGate>
}

function QuanLyThietKePage() {
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
        className={`tk-page${aiOpen ? ' tk-ai-open' : ''}${aiResizing ? ' tk-ai-resizing' : ''}`}
        style={{ '--ai-panel-width': `${aiWidth}px` }}
      >
        <div className="tk-header">
          <div className="tk-header-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          </div>
          <span className="tk-header-title">Quản lý thiết kế</span>
          <div className="hdr-tabs" role="tablist">
            {MAIN_TABS.map(t => (
              <button key={t.key} className={`tk-proj-tab${tab === t.key ? ' active' : ''}`} onClick={() => goToTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <button className="tk-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
            {theme === 'dark'
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
          </button>
        </div>

        {/* Các tab luôn được mount (ẩn bằng display) để giữ trạng thái khi chuyển tab, giống bản HTML */}
        <div className="tk-content">
          <div className="tk-panel" style={panelStyle('tiendo')}>
            <GanttTab active={tab === 'tiendo'} />
          </div>
          <div className="tk-panel-scroll" style={panelStyle('list')}>
            <ProjectListTab onGoto={goToTab} />
          </div>
          <div className="tk-panel-scroll" style={panelStyle('create')}>
            <SetupTab sub={createSub} onSubChange={setCreateSub} onGoto={goToTab} />
          </div>
          <div className="tk-panel-scroll" style={panelStyle('nhiemvu')}>
            <TaskGameTab gtab={gtab} onGtabChange={setGtab} />
          </div>
          <div className="tk-panel-scroll" style={panelStyle('nhansu')}>
            <NhanSuTab />
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
