import { useState } from 'react'
import './RD.css'
import { useTheme } from '../../hooks/useTheme'
import { PROJECTS, STAGE_LABEL, IDEAS, IDEA_STATUS, isActiveProject, initialsOf } from '../../data/rdData'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import { RD_TABS } from '../../data/pageTabs'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'

function Kpi({ label, value, valueColor, children }) {
  return (
    <div className="rd-card rd-kpi-card">
      <div className="rd-kpi-label">{label}</div>
      <div className="rd-kpi-num" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      {children}
    </div>
  )
}

function SectionHead({ icon, title, meta }) {
  return (
    <div className="rd-section-head">
      <div className="rd-section-icon">{icon}</div>
      <h3>{title}</h3>
      <span style={{ flex: 1 }} />
      <span className="rd-section-meta">{meta}</span>
    </div>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const BULB_PATHS = (
  <>
    <path d="M9 18h6" /><path d="M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.05V17h6v-.25c0-.85.4-1.55 1-2.05A7 7 0 0 0 12 2z" />
  </>
)

export default function RD() {
  const { theme, toggleTheme } = useTheme()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [pageTab, setPageTab] = useState('main') // main | nhansu
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  const tabHidden = usePageTabsHidden('/rd')
  useTabFallback(tabHidden, pageTab, RD_TABS.map(t => t.key), setPageTab)

  const activeProjects = PROJECTS.filter(isActiveProject).length

  return (
    <div
      className={`rd-page${aiOpen ? ' rd-ai-open' : ''}${aiResizing ? ' rd-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="rd-header">
        <div className="rd-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{BULB_PATHS}</svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>R&amp;D</span>
        <div className="hdr-tabs" role="tablist">
          {RD_TABS.filter(t => tabHidden.indexOf(t.key) < 0).map(t => (
            <button key={t.key} className={`hdr-tab${pageTab === t.key ? ' active' : ''}`} onClick={() => setPageTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <button className="rd-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      <div className="rd-scroll" style={pageTab === 'nhansu' ? { display: 'none' } : undefined}>
        <div className="rd-content">
          <div className="rd-kpi-grid">
            <Kpi label="Dự án R&D đang triển khai" value={activeProjects}>
              <div className="rd-kpi-sub">Vật liệu, quy trình &amp; công nghệ</div>
            </Kpi>
            <Kpi label="Sáng kiến đã áp dụng" value="11" valueColor="var(--success)">
              <div className="rd-kpi-sub">Trong 12 tháng gần nhất</div>
            </Kpi>
            <Kpi label="Ngân sách R&D đã dùng" value="62%">
              <div className="rd-badge" style={{ background: 'var(--rd-tint)', color: 'var(--rd)' }}>2.4 tỷ / 3.9 tỷ năm 2026</div>
            </Kpi>
            <Kpi label="Bằng sáng chế / tiêu chuẩn đang theo đuổi" value="3">
              <div className="rd-badge" style={{ background: 'var(--warn-tint)', color: 'var(--warn)' }}>Đang thẩm định</div>
            </Kpi>
          </div>

          <div className="rd-card rd-section-card">
            <SectionHead
              title="Dự án nghiên cứu"
              meta={`${PROJECTS.length} dự án đang theo dõi`}
              icon={<svg {...iconProps}><path d="M10 2v6.5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5V2" /><path d="M8.5 2h7" /><path d="M7 15h10" /></svg>}
            />
            <div className="rd-table-wrap">
              <table className="rd-table">
                <thead><tr><th>Tên dự án</th><th>Người phụ trách</th><th>Giai đoạn</th><th>Tiến độ</th></tr></thead>
                <tbody>
                  {PROJECTS.map(p => {
                    const [label, color] = STAGE_LABEL[p.stage]
                    return (
                      <tr key={p.name}>
                        <td style={{ fontWeight: 700 }}>{p.name}</td>
                        <td>{p.owner}</td>
                        <td><span style={{ color, fontWeight: 600 }}>{label}</span></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="rd-progress-track"><div className="rd-progress-fill" style={{ width: `${p.progress}%` }} /></div>
                            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{p.progress}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rd-card rd-section-card rd-pad-full">
            <SectionHead
              title="Ý tưởng & đề xuất"
              meta={`${IDEAS.length} đề xuất gần đây`}
              icon={<svg {...iconProps}>{BULB_PATHS}</svg>}
            />
            <div className="rd-idea-list">
              {IDEAS.map(idea => {
                const [label, color, bg] = IDEA_STATUS[idea.status]
                return (
                  <div key={idea.author} className="rd-card rd-idea-card">
                    <div className="rd-idea-avatar">{initialsOf(idea.author)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{idea.author}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{idea.text}</div>
                    </div>
                    <span className="rd-badge" style={{ background: bg, color }}>{label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {pageTab === 'nhansu' && (
        <div className="rd-scroll">
          <DeptStaff units={['rnd']} />
        </div>
      )}

      <Dezbot
        open={aiOpen}
        onOpen={() => setAiOpen(true)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />
    </div>
  )
}
