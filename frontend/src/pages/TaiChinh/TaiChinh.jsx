import { useState } from 'react'
import './TaiChinh.css'
import { useTheme } from '../../hooks/useTheme'
import { FIN_CATEGORIES, FIN_PROJECTS, FIN_RANGES } from '../../data/taiChinhData'
import DuAnPanel from './components/DuAnPanel'
import { HanhChinhPanel, NhanSuPanel, KinhDoanhPanel, MarketingPanel } from './components/CategoryPanels'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import { TC_COCAU } from '../../data/pageTabs'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'

export default function TaiChinh() {
  const { theme, toggleTheme } = useTheme()
  const [category, setCategory] = useState('duan')
  const [project, setProject] = useState(FIN_PROJECTS[0])
  // activeRange: nút đang được chọn (null khi dùng khoảng ngày tuỳ chọn); chartRange: khoảng biểu đồ đang hiển thị
  const [activeRange, setActiveRange] = useState('month')
  const [chartRange, setChartRange] = useState('month')
  const [dateFrom, setDateFrom] = useState('2026-09-01')
  const [dateTo, setDateTo] = useState('2026-09-30')

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [pageTab, setPageTab] = useState('main') // main | nhansu
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  const tabHidden = usePageTabsHidden('/tai-chinh')
  useTabFallback(tabHidden, pageTab === 'nhansu' ? TC_COCAU : category, FIN_CATEGORIES.map(c => c.key).concat(TC_COCAU),
    k => { if (k === TC_COCAU) setPageTab('nhansu'); else { setCategory(k); setPageTab('main') } })

  const show = key => ({ display: category === key ? 'flex' : 'none' })

  return (
    <div
      className={`tc-page${aiOpen ? ' tc-ai-open' : ''}${aiResizing ? ' tc-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="tc-header">
        <div className="tc-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
        </div>
        <span className="tc-header-title">Tài chính</span>
        <div className="hdr-tabs" role="tablist">
          {FIN_CATEGORIES.filter(c => tabHidden.indexOf(c.key) < 0).map(c => (
            <div key={c.key} className={`tc-cat${pageTab === 'main' && category === c.key ? ' active' : ''}`} onClick={() => { setCategory(c.key); setPageTab('main') }}>{c.label}</div>
          ))}
          {/* Nhân sự phòng Tài chính - Kế toán (từ HR) — khác danh mục chi phí "Nhân sự" bên cạnh */}
          {tabHidden.indexOf(TC_COCAU) < 0 && <div className={`tc-cat${pageTab === 'nhansu' ? ' active' : ''}`} onClick={() => setPageTab('nhansu')} title="Cơ cấu & nhân sự phòng Tài chính - Kế toán (từ HR)">Cơ cấu phòng ban</div>}
        </div>
        <button className="tc-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>


      <div className="tc-scroll" style={pageTab === 'nhansu' ? { display: 'none' } : undefined}>
        <div className="tc-filter-bar">
          <div className="tc-filter-group">
            <span className="tc-filter-label">Dự án:</span>
            <select className="tc-select" value={project} onChange={e => setProject(e.target.value)}>
              {FIN_PROJECTS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>

          <div className="tc-range-group">
            {FIN_RANGES.map(r => (
              <button
                key={r.key}
                className={`tc-range${activeRange === r.key ? ' active' : ''}`}
                onClick={() => { setActiveRange(r.key); setChartRange(r.key) }}
              >{r.label}</button>
            ))}
          </div>

          <div className="tc-filter-group">
            <span className="tc-filter-label">Tuỳ chọn:</span>
            <input type="date" className="tc-date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActiveRange(null) }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
            <input type="date" className="tc-date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActiveRange(null) }} />
          </div>
        </div>

        {/* Các danh mục luôn được mount (ẩn bằng display), giống bản HTML */}
        <div className="tc-stack" style={{ minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            <div className="tc-stack" style={show('hanhchinh')}><HanhChinhPanel /></div>
            <div className="tc-stack" style={show('nhansu')}><NhanSuPanel /></div>
            <div className="tc-stack" style={show('duan')}><DuAnPanel range={chartRange} /></div>
            <div className="tc-stack" style={show('kinhdoanh')}><KinhDoanhPanel /></div>
            <div className="tc-stack" style={show('marketing')}><MarketingPanel /></div>
          </div>
        </div>
      </div>

      {pageTab === 'nhansu' && (
        <div className="tc-scroll">
          <DeptStaff units={['tckt']} />
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
