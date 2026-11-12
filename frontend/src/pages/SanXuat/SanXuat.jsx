import { useState } from 'react'
import './SanXuat.css'
import { useTheme } from '../../hooks/useTheme'
import { SX_TABS, INITIAL_ORDERS, INITIAL_MATERIALS, ME } from '../../data/sanXuatData'
import OverviewTab from './components/OverviewTab'
import OrdersTab from './components/OrdersTab'
import KanbanTab from './components/KanbanTab'
import MaterialsTab from './components/MaterialsTab'
import { WorkersTab, EquipmentTab } from './components/ResourceTabs'
import CreateOrderModal from './components/CreateOrderModal'
import StockModal from './components/StockModal'
import DetailModal from './components/DetailModal'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'

export default function SanXuat() {
  const { theme, toggleTheme } = useTheme()
  const [tab, setTab] = useState('tongquan')
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  const tabHidden = usePageTabsHidden('/san-xuat')
  useTabFallback(tabHidden, tab, SX_TABS.map(t => t.key), setTab)
  const [orders, setOrders] = useState(INITIAL_ORDERS)
  const [orderSeq, setOrderSeq] = useState(7)
  const [materials, setMaterials] = useState(INITIAL_MATERIALS)

  const [createOpen, setCreateOpen] = useState(false)
  const [stockMode, setStockMode] = useState(null)
  const [detail, setDetail] = useState({ code: null, open: false })

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  /* ---------- Thao tác dữ liệu ---------- */
  function createOrder(data) {
    const next = orderSeq + 1
    setOrderSeq(next)
    setOrders(prev => [{ code: 'SX-' + String(next).padStart(3, '0'), stage: 'doVe', progress: 0, late: false, comments: [], ...data }, ...prev])
    setCreateOpen(false)
  }
  function moveOrder(code, stageKey) {
    setOrders(prev => prev.map(o => {
      if (o.code !== code || o.stage === stageKey) return o
      return stageKey === 'hoanThanh' ? { ...o, stage: stageKey, progress: 100, late: false } : { ...o, stage: stageKey }
    }))
  }
  function addComment(code, text) {
    setOrders(prev => prev.map(o => o.code === code ? { ...o, comments: [...o.comments, { author: ME, text, time: 'Vừa xong' }] } : o))
  }
  function adjustStock(idx, delta) {
    setMaterials(prev => prev.map((m, i) => i === idx ? { ...m, qty: m.qty + delta } : m))
    setStockMode(null)
  }

  const panel = key => `sx-panel${tab === key ? ' active' : ''}`
  const detailOrder = orders.find(o => o.code === detail.code) || null

  return (
    <div
      className={`sx-page${aiOpen ? ' sx-ai-open' : ''}${aiResizing ? ' sx-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="sx-header">
        <div className="sx-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Sản xuất</span>
        <div className="hdr-tabs" role="tablist">
          {SX_TABS.filter(t => tabHidden.indexOf(t.key) < 0).map(t => (
            <button key={t.key} className={`sx-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
        <button className="sx-add-btn" onClick={() => setCreateOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Tạo đơn sản xuất
        </button>
        <button className="sx-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {/* Các tab luôn được mount (ẩn bằng class .active) để giữ bộ lọc đang chọn, giống bản HTML */}
      <div className="sx-scroll">
        <div className={panel('tongquan')}><OverviewTab orders={orders} /></div>
        <div className={panel('donsx')}><OrdersTab orders={orders} /></div>
        <div className={panel('quytrinh')} style={{ minHeight: 0 }}>
          <KanbanTab orders={orders} onMoveOrder={moveOrder} onOpenOrder={code => setDetail({ code, open: true })} />
        </div>
        <div className={panel('khovattu')}><MaterialsTab materials={materials} onStock={setStockMode} /></div>
        <div className={panel('nhancong')}><WorkersTab /></div>
        <div className={panel('maymoc')}><EquipmentTab /></div>
        <div className={panel('nhansu')}><DeptStaff units={['xuong']} /></div>
      </div>

      <CreateOrderModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createOrder} />
      <StockModal mode={stockMode} materials={materials} onClose={() => setStockMode(null)} onSubmit={adjustStock} />
      <DetailModal order={detailOrder} open={detail.open} onClose={() => setDetail(d => ({ ...d, open: false }))} onComment={addComment} />

      <Dezbot
        open={aiOpen}
        onOpen={() => setAiOpen(true)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
        data={{ orders, materials }}
      />
    </div>
  )
}
