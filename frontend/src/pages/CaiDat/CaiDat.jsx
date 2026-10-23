import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import './CaiDat.css'
import { useTheme } from '../../hooks/useTheme'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { SETTINGS_DEFAULTS } from '../../data/caiDatData'
import { panelStyle, SettingsContext } from './components/shared'
import AccountTab from './components/AccountTab'
import GeneralTab from './components/GeneralTab'
import AppearanceTab from './components/AppearanceTab'
import PrivacyTab from './components/PrivacyTab'
import EfficiencyTab from './components/EfficiencyTab'
import NotifyTab from './components/NotifyTab'
import ShortcutsTab from './components/ShortcutsTab'
import CalendarTab from './components/CalendarTab'
import TasksTab from './components/TasksTab'
import WorkspaceTab from './components/WorkspaceTab'
import RewardsTab from './components/RewardsTab'
import SecurityTab from './components/SecurityTab'
import PermissionsTab from './components/PermissionsTab'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import { QsDataProvider } from '../QS/state/QsData'
import QsSettingsPanels, { QS_SETTINGS, useQsSettingsTabs } from '../QS/QsSettingsPanels'

const tabIcon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

/* Các tab cài đặt (data-tab trong HTML) */
const TABS = [
  { key: 'account', label: 'Tài khoản', Panel: AccountTab, icon: <svg {...tabIcon}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
  { key: 'general', label: 'Chung', Panel: GeneralTab, icon: <svg {...tabIcon}><path d="M4 6h3M11 6h9M4 12h9M17 12h3M4 18h2M10 18h10" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></svg> },
  { key: 'appearance', label: 'Giao diện', Panel: AppearanceTab, icon: <svg {...tabIcon}><circle cx="12" cy="12" r="10" /><path d="M12 2a7 7 0 0 0 0 14 7 7 0 0 1 0 6" /></svg> },
  { key: 'privacy', label: 'Quyền riêng tư', Panel: PrivacyTab, icon: <svg {...tabIcon}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg> },
  { key: 'efficiency', label: 'Hiệu suất', Panel: EfficiencyTab, icon: <svg {...tabIcon}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg> },
  { key: 'notify', label: 'Thông báo', Panel: NotifyTab, icon: <svg {...tabIcon}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg> },
  { key: 'shortcuts', label: 'Phím tắt', Panel: ShortcutsTab, icon: <svg {...tabIcon}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg> },
  { key: 'calendar', label: 'Lịch', Panel: CalendarTab, icon: <svg {...tabIcon}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg> },
  { key: 'tasks', label: 'Nhiệm vụ', Panel: TasksTab, icon: <svg {...tabIcon}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg> },
  { key: 'workspace', label: 'Workspace', Panel: WorkspaceTab, icon: <svg {...tabIcon}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg> },
  { key: 'rewards', label: 'Đổi thưởng', Panel: RewardsTab, icon: <svg {...tabIcon}><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg> },
  { key: 'security', label: 'Bảo mật', Panel: SecurityTab, icon: <svg {...tabIcon}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg> },
  { key: 'permissions', label: 'Phân quyền', Panel: PermissionsTab, icon: <svg {...tabIcon}><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> },
]

/* Mục của QS Pro (Công ty / Admin, chuyển từ thanh tab của /qs): chỉ hiện với tài khoản QS có quyền */
const QS_ICONS = {
  'qs-congty': <svg {...tabIcon}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></svg>,
  'qs-admin': <svg {...tabIcon}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>,
}

export default function CaiDat() {
  return (
    <QsDataProvider>
      <CaiDatRoot />
    </QsDataProvider>
  )
}

function CaiDatRoot() {
  const { theme, toggleTheme } = useTheme()
  const [params, setParams] = useSearchParams()
  const [activeTab, setTab] = useState(() => params.get('tab') || 'account')
  const setActiveTab = key => { setTab(key); if (params.get('tab')) setParams({}, { replace: true }) }
  const qsTabs = useQsSettingsTabs()
  const isQs = QS_SETTINGS.some(t => t.key === activeTab)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [saved, setSaved] = useLocalStorage('siteflow-settings', {})
  const settings = { s: { ...SETTINGS_DEFAULTS, ...saved }, update: patch => setSaved(prev => ({ ...prev, ...patch })) }

  return (
    <div
      className={`cd-page${aiOpen ? ' cd-ai-open' : ''}${aiResizing ? ' cd-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      {/* Header — giữ style inline như HTML để theme Liquid Glass (div[style*="height: 64px"]) vẫn áp dụng */}
      <div style={{ height: 64, flex: 'none', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 var(--page-gutter)', boxSizing: 'border-box', background: 'var(--surface)', gap: 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--primary-tint)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Cài đặt</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tài khoản, giao diện, thông báo &amp; workspace</span>
        <span style={{ flex: 1 }} />
        <button title="Chuyển giao diện sáng/tối" onClick={toggleTheme} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: 'var(--page-gutter)', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden', display: 'flex', gap: 24 }}>
        {/* Menu cài đặt bên trái */}
        <div style={{ width: 190, flex: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map(t => (
            <button key={t.key} className={`cd-settings-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.icon}
              {t.label}
            </button>
          ))}
          {qsTabs.length > 0 && (
            <div style={{ margin: '14px 14px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>QS Pro</div>
          )}
          {qsTabs.map(t => (
            <button key={t.key} className={`cd-settings-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {QS_ICONS[t.key]}
              {t.label}
            </button>
          ))}
        </div>

        {/* Các panel — luôn mount (ẩn bằng display) để giữ giá trị đã nhập khi đổi tab, giống HTML.
            Mục QS (Công ty / Admin) rộng như trong /qs nên bỏ giới hạn 900px */}
        <div style={{ flex: 1, minWidth: 0, maxWidth: isQs ? 'none' : 900 }}>
          <SettingsContext.Provider value={settings}>
            {TABS.map(({ key, Panel }) => (
              <div key={key} className="cd-settings-panel" style={{ ...panelStyle, display: activeTab === key ? 'flex' : 'none' }}>
                <Panel />
              </div>
            ))}
          </SettingsContext.Provider>
          <QsSettingsPanels active={activeTab} />
        </div>
      </div>

      <Dezbot
        open={aiOpen}
        onToggle={() => setAiOpen(v => !v)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />
    </div>
  )
}
