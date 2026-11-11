import { useEffect, useRef, useState } from 'react'
import './Marketing.css'
import { useTheme } from '../../hooks/useTheme'
import { CATALOG, CAMPAIGNS, MAIN_TABS, M_STEPS } from '../../data/marketingData'
import CampaignsTab from './components/CampaignsTab'
import CampaignDetail from './components/CampaignDetail'
import CatalogTab from './components/CatalogTab'
import QuoteTab from './components/QuoteTab'
import TasksTab from './components/TasksTab'
import AdsSpendTab from './components/AdsSpendTab'
import CampaignModal from './components/CampaignModal'
import CreateTaskModal from './components/CreateTaskModal'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'

const plusIcon = (size, stroke = 'currentColor') => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)

/* Ô nhập đổi tên tab (renameMktTab): tự focus + bôi đen khi xuất hiện */
function TabRenameInput({ value, onChange, onCommit }) {
  const ref = useRef(null)
  useEffect(() => { ref.current.focus(); ref.current.select() }, [])
  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onCommit() }}
      onBlur={onCommit}
      style={{ width: 110, fontSize: 13, fontFamily: 'inherit', border: '1px solid var(--marketing)', borderRadius: 6, padding: '3px 6px', background: 'var(--surface)', color: 'var(--text)' }}
    />
  )
}

export default function Marketing() {
  const { theme, toggleTheme } = useTheme()

  /* ---- Dữ liệu ---- */
  const [catalog, setCatalog] = useState(CATALOG)
  const [campaigns, setCampaigns] = useState(CAMPAIGNS)
  const [steps, setSteps] = useState(M_STEPS)
  const catalogItemCounter = useRef(1)
  const campCounter = useRef(CAMPAIGNS.length + 1)
  const customTabCounter = useRef(1)

  /* ---- Tab chính / panel đang hiển thị ---- */
  const [tabs, setTabs] = useState(MAIN_TABS)            // {id, label, hidden?, custom?, panelName?}
  const [panel, setPanel] = useState('campaigns')        // id tab | 'campaignDetail'
  const [editingTabs, setEditingTabs] = useState(false)
  const [hiddenTabs, setHiddenTabs] = useState([])       // thứ tự ẩn (mktHiddenTabs)
  const [renaming, setRenaming] = useState(null)         // {id, value}
  const [detailId, setDetailId] = useState(null)

  /* ---- Báo giá: chiến dịch đang xem + bộ đếm "dựng lại" (renderQuoteTab) ---- */
  const [quoteCampaignId, setQuoteCampaignId] = useState(CAMPAIGNS.length ? CAMPAIGNS[0].id : null)
  const [quoteRenderKey, setQuoteRenderKey] = useState(0)
  const rerenderQuote = () => setQuoteRenderKey(k => k + 1)

  /* ---- Modal ---- */
  const [campModal, setCampModal] = useState({ open: false, seq: 0 })
  const [taskModal, setTaskModal] = useState({ open: false, seq: 0 })

  /* ---- Dezbot ---- */
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  const tabLabel = id => (tabs.find(t => t.id === id) || { label: id }).label

  /* ===================== Chuyển tab chính ===================== */
  function goToTab(name) { setPanel(name) }

  function handleTabClick(t) {
    if (editingTabs) {
      /* Đang chỉnh sửa menu: bấm vào tab để đổi tên, không chuyển tab */
      if (!renaming || renaming.id !== t.id) setRenaming({ id: t.id, value: t.label })
      return
    }
    goToTab(t.id)
    if (t.id === 'quote') rerenderQuote()
  }
  function commitRename() {
    if (!renaming) return
    const val = renaming.value.trim() || tabLabel(renaming.id)
    setTabs(prev => prev.map(t => (t.id === renaming.id ? { ...t, label: val } : t)))
    setRenaming(null)
  }

  /* ===================== Chỉnh sửa menu (thêm / bớt tab) ===================== */
  function removeTab(tabId) {
    const visible = tabs.filter(t => !t.hidden)
    if (visible.length <= 1) return
    const wasActive = panel === tabId
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, hidden: true } : t)))
    setHiddenTabs(prev => [...prev, tabId])
    if (renaming && renaming.id === tabId) setRenaming(null)
    if (wasActive) {
      const next = visible.find(t => t.id !== tabId)
      if (next) {
        goToTab(next.id)
        if (next.id === 'quote') rerenderQuote()
      }
    }
  }
  function restoreTab(tabId) {
    setTabs(prev => prev.map(t => (t.id === tabId ? { ...t, hidden: false } : t)))
    setHiddenTabs(prev => prev.filter(id => id !== tabId))
  }
  function addTab() {
    const name = (prompt('Tên tab mới:') || '').trim()
    if (!name) return
    const id = 'custom' + (customTabCounter.current++)
    setTabs(prev => [...prev, { id, label: name, custom: true, panelName: name }])
    goToTab(id)
  }

  /* ===================== Danh mục ===================== */
  function addCatalogItem(group) {
    const name = (prompt('Tên hạng mục:') || '').trim()
    if (!name) return
    const unit = (prompt('Đơn vị (VD: tháng, người-tháng, lần, sự kiện):', 'tháng') || 'tháng').trim()
    const priceRaw = prompt('Đơn giá (VNĐ):', '0') || '0'
    const price = parseInt(priceRaw.replace(/[^\d]/g, ''), 10) || 0
    const groupLabel = catalog.find(c => c.group === group).groupLabel
    const id = 'new' + (catalogItemCounter.current++)
    setCatalog(prev => [...prev, { id, group, groupLabel, name, unit, price }])
  }

  /* ===================== Chiến dịch ===================== */
  function openCampaignDetail(id) {
    if (!campaigns.find(c => c.id === id)) return
    setDetailId(id)
    setPanel('campaignDetail')
  }
  function viewQuoteFromDetail() {
    setQuoteCampaignId(detailId)
    goToTab('quote')
    rerenderQuote()
  }
  function saveCampaign(data) {
    const newCamp = { id: 'camp' + (campCounter.current++), ...data }
    setCampaigns(prev => [...prev, newCamp])
    setQuoteCampaignId(newCamp.id)
    setCampModal(m => ({ ...m, open: false }))
    goToTab('quote')
    rerenderQuote()
  }

  /* ===================== Nhiệm vụ ===================== */
  function checkSubtask(stepIdx, subIdx) {
    if (steps[stepIdx].subtasks[subIdx].done) return
    setSteps(prev => {
      const next = prev.map((st, i) => (i === stepIdx
        ? { ...st, subtasks: st.subtasks.map((s, j) => (j === subIdx ? { ...s, done: true } : s)) }
        : st))
      /* Xong hết nhiệm vụ nhỏ → bước hoàn thành và mở khoá bước kế tiếp */
      if (next[stepIdx].subtasks.every(s => s.done)) {
        next[stepIdx] = { ...next[stepIdx], status: 'done' }
        if (next[stepIdx + 1] && next[stepIdx + 1].status === 'locked') {
          next[stepIdx + 1] = { ...next[stepIdx + 1], status: 'current' }
        }
      }
      return next
    })
  }
  function createTask({ stepIdx, text, who, pts }) {
    setSteps(prev => prev.map((st, i) => {
      if (i !== stepIdx) return st
      return { ...st, status: st.status === 'done' ? 'current' : st.status, subtasks: [...st.subtasks, { text, who, pts, done: false }] }
    }))
    setTaskModal(m => ({ ...m, open: false }))
  }

  const detailCamp = campaigns.find(c => c.id === detailId) || null
  const showHiddenChips = hiddenTabs.length > 0 && editingTabs

  return (
    <div
      className={`mk-page${aiOpen ? ' mk-ai-open' : ''}${aiResizing ? ' mk-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      {/* ---------- Header ---------- */}
      <div style={{ height: 64, flex: 'none', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 var(--page-gutter)', boxSizing: 'border-box', background: 'var(--surface)', gap: 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--marketing-tint)', color: 'var(--marketing)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Marketing</span>
        <div className="hdr-tabs plain">
          <div className={`mk-tab-list${editingTabs ? ' editing' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                className={`mk-tab${panel === t.id ? ' active' : ''}`}
                style={t.hidden ? { display: 'none' } : undefined}
                onClick={() => handleTabClick(t)}
              >
                {renaming && renaming.id === t.id
                  ? <TabRenameInput value={renaming.value} onChange={v => setRenaming({ id: t.id, value: v })} onCommit={commitRename} />
                  : t.label}
                <span className="mk-tab-remove" title="Ẩn tab này" onClick={e => { e.stopPropagation(); removeTab(t.id) }}>×</span>
              </button>
            ))}
          </div>
          <span style={{ display: showHiddenChips ? 'flex' : 'none', alignItems: 'center', gap: 6, marginRight: 8 }}>
            {showHiddenChips && hiddenTabs.map(id => (
              <span className="mk-hidden-tab-chip" key={id} onClick={() => restoreTab(id)}>
                {tabLabel(id)}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </span>
            ))}
          </span>
          <button className="mk-tab-add-btn" title="Thêm tab mới" style={{ display: editingTabs ? 'flex' : 'none' }} onClick={addTab}>
            {plusIcon(14)}
          </button>
          <button className={`mk-edit-tabs-btn${editingTabs ? ' active' : ''}`} title="Chỉnh sửa menu — thêm hoặc bớt tab" onClick={() => setEditingTabs(v => !v)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            <span>{editingTabs ? 'Xong' : 'Chỉnh sửa menu'}</span>
          </button>
        </div>
        <button onClick={() => setCampModal(m => ({ open: true, seq: m.seq + 1 }))} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', background: 'var(--marketing)', color: '#fff', padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}>
          {plusIcon(14, '#fff')}
          Tạo chiến dịch
        </button>
        <button title="Chuyển giao diện sáng/tối" onClick={toggleTheme} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {/* ---------- Các panel (đều giữ mount, bật/tắt bằng display như bản HTML) ---------- */}
      <div style={{ flex: 1, padding: 'var(--page-gutter)', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden' }}>
        <CampaignsTab visible={panel === 'campaigns'} catalog={catalog} campaigns={campaigns} onOpenDetail={openCampaignDetail} />
        <CampaignDetail visible={panel === 'campaignDetail'} catalog={catalog} camp={detailCamp} onBack={() => goToTab('campaigns')} onViewQuote={viewQuoteFromDetail} />
        <CatalogTab visible={panel === 'catalog'} catalog={catalog} onAddItem={addCatalogItem} />
        <QuoteTab
          visible={panel === 'quote'}
          catalog={catalog}
          campaigns={campaigns}
          quoteCampaignId={quoteCampaignId}
          renderKey={quoteRenderKey}
          onSelectCampaign={id => { setQuoteCampaignId(id); rerenderQuote() }}
        />
        <TasksTab
          visible={panel === 'tasks'}
          steps={steps}
          onCheckSubtask={checkSubtask}
          onOpenCreateTask={() => setTaskModal(m => ({ open: true, seq: m.seq + 1 }))}
        />
        <div style={{ display: panel === 'staff' ? 'block' : 'none' }}><DeptStaff units={['marketing']} /></div>
        <AdsSpendTab visible={panel === 'ads'} />
        {/* Tab tuỳ chỉnh do người dùng thêm — nội dung giữ tên lúc tạo, kể cả khi tab được đổi tên sau đó */}
        {tabs.filter(t => t.custom).map(t => (
          <div key={t.id} style={{ display: panel === t.id ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 14, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Tab "{t.panelName}" chưa có nội dung — đây là tab tuỳ chỉnh do bạn thêm vào menu.
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Modal ---------- */}
      <CampaignModal
        key={'camp' + campModal.seq}
        open={campModal.open}
        catalog={catalog}
        onClose={() => setCampModal(m => ({ ...m, open: false }))}
        onSave={saveCampaign}
      />
      <CreateTaskModal
        key={'task' + taskModal.seq}
        open={taskModal.open}
        steps={steps}
        onClose={() => setTaskModal(m => ({ ...m, open: false }))}
        onSubmit={createTask}
      />

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
