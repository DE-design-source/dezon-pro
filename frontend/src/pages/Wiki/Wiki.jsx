import { useRef, useState } from 'react'
import './Wiki.css'
import { useTheme } from '../../hooks/useTheme'
import { WIKI } from '../../data/wikiData'
import WikiTree from './components/WikiTree'
import ArticleView from './components/ArticleView'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import { useAccess } from '../../services/accessService'

export default function Wiki() {
  const { can } = useAccess()
  const { theme, toggleTheme } = useTheme()
  const [slug, setSlug] = useState('intro')
  const [search, setSearch] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const contentRef = useRef(null)
  const headingEls = useRef({})

  const page = WIKI[slug]
  /* Mục lục: các tiêu đề h2/h3 của trang; null với biểu mẫu (ẩn khối "Trong trang này") */
  const toc = page.isForm ? null : page.blocks.filter(b => b.t === 'h2' || b.t === 'h3')

  /* renderPage: bỏ qua slug không tồn tại */
  function renderPage(next) {
    if (!WIKI[next]) return
    setSlug(next)
  }

  /* Bấm mục trong cây: đổi trang và cuộn cột nội dung lên đầu */
  function selectFromTree(next) {
    renderPage(next)
    if (contentRef.current) contentRef.current.scrollTop = 0
  }

  function scrollToHeading(id) {
    headingEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const headingRef = id => el => { if (el) headingEls.current[id] = el; else delete headingEls.current[id] }

  // phân quyền 3 cấp (N21, module wiki, tab main)
  if (!can('wiki', 'main')) {
    return <div className="wk-page"><div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Tài khoản chưa được cấp quyền xem Wiki. Nhờ quản trị viên cấp quyền.</div></div>
  }

  return (
    <div
      className={`wk-page${aiOpen ? ' wk-ai-open' : ''}${aiResizing ? ' wk-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="wk-header">
        <div className="wk-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Wiki công ty</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sổ tay, nội quy &amp; quy trình nội bộ — áp dụng toàn công ty</span>
        <span style={{ flex: 1 }} />
        <div className="wk-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="text" placeholder="Tìm trong Wiki..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="wk-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      <div className="wk-main">
        <WikiTree
          activeSlug={slug}
          searchTerm={search}
          toc={toc}
          onSelect={selectFromTree}
          onTocClick={scrollToHeading}
        />
        <ArticleView
          page={page}
          contentRef={contentRef}
          headingRef={headingRef}
          onPageLink={renderPage}
        />
      </div>

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
