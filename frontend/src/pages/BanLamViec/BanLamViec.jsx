import { useRef, useState } from 'react'
import './BanLamViec.css'
import { useTheme } from '../../hooks/useTheme'
import { INITIAL_TASKS, INITIAL_REQUESTS, ME, TODAY_LABEL, requestStatus } from '../../data/banLamViecData'
import OverviewTab from './components/OverviewTab'
import DonTuTab from './components/DonTuTab'
import AddTaskModal from './components/AddTaskModal'
import DonTuModal from './components/DonTuModal'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import Icon from '../../components/ui/Icon'
import { useAccess } from '../../services/accessService'

export default function BanLamViec() {
  const { can } = useAccess()
  const { theme, toggleTheme } = useTheme()
  const [tab, setTab] = useState('tongquan')
  const [tasks, setTasks] = useState(INITIAL_TASKS)
  const [requests, setRequests] = useState(INITIAL_REQUESTS)
  const seq = useRef(100)

  const [taskModalOpen, setTaskModalOpen] = useState(false)
  // Loại đơn đang chọn được giữ lại sau khi đóng modal (giống currentDonTuType)
  const [donTuType, setDonTuType] = useState(null)
  const [donTuOpen, setDonTuOpen] = useState(false)
  const [openRequestId, setOpenRequestId] = useState(null)

  const [editing, setEditing] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  /* ---------- Thao tác dữ liệu ---------- */
  function toggleTask(id) {
    if (!can('banlamviec', 'main', 'edit')) return
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t))
  }
  function addTask(data) {
    setTasks(prev => [{ id: ++seq.current, done: false, ...data }, ...prev])
  }
  function addRequest(data) {
    const id = ++seq.current
    setRequests(prev => [{ id, ...data }, ...prev])
    // Gửi xong → mở luôn trang chi tiết đơn để thấy luồng duyệt
    setTab('dontu')
    setOpenRequestId(id)
  }
  function cancelRequest(id) {
    setRequests(prev => prev.map(r => (r.id === id ? { ...r, cancelled: true } : r)))
  }
  function pickDonTuType(type) {
    setDonTuType(type)
    setDonTuOpen(true)
  }

  const openTasks = tasks.filter(t => !t.done).length
  const pendingRequests = requests.filter(r => requestStatus(r) === 'pending').length

  const panel = key => `blv-panel${tab === key ? ' active' : ''}`
  // phân quyền 3 cấp (N21, module banlamviec, tab main)
  const canCreate = can('banlamviec', 'main', 'create')
  if (!can('banlamviec', 'main')) {
    return <div className="blv-page"><div className="blv-body"><div className="blv-empty"><span>Tài khoản chưa được cấp quyền xem Bàn làm việc. Nhờ quản trị viên cấp quyền.</span></div></div></div>
  }

  return (
    <div
      className={`blv-page${aiOpen ? ' blv-ai-open' : ''}${aiResizing ? ' blv-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="blv-header">
        <div className="blv-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="13" rx="2.5" /><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" /><path d="M2 13h20" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Bàn làm việc của tôi</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nhiệm vụ, chấm công &amp; ngày phép cá nhân</span>
        <span style={{ flex: 1 }} />
        <button className="blv-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      <div className="blv-body">
        {/* Lời chào + chuyển tab + hành động */}
        <div className="blv-hero">
          <div className="blv-hero-text">
            <h2>Chào buổi sáng, {ME.name}</h2>
            <p>{TODAY_LABEL} · Bạn còn <b>{openTasks} việc</b> cần làm{pendingRequests ? <> và <b>{pendingRequests} đơn</b> đang chờ duyệt</> : null}</p>
          </div>
          <div className="blv-hero-actions">
            <div className="blv-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'tongquan'} className={tab === 'tongquan' ? 'active' : ''} onClick={() => setTab('tongquan')}>Tổng quan</button>
              <button role="tab" aria-selected={tab === 'dontu'} className={tab === 'dontu' ? 'active' : ''} onClick={() => { setTab('dontu'); setEditing(false); setOpenRequestId(null) }}>
                Đơn từ{pendingRequests > 0 && <span className="blv-tab-badge">{pendingRequests}</span>}
              </button>
            </div>
            {tab === 'tongquan' && (editing ? (
              <>
                <button className="blv-btn ghost" onClick={() => setResetSignal(n => n + 1)}>Đặt lại</button>
                <button className="blv-btn" onClick={() => setEditing(false)}><Icon name="check" size={14} stroke={2.6} />Xong</button>
              </>
            ) : (
              <button className="blv-btn ghost" onClick={() => setEditing(true)} title="Kéo thả, đổi kích thước các widget"><Icon name="grid" size={14} />Tùy chỉnh bố cục</button>
            ))}
          </div>
        </div>

        {editing && tab === 'tongquan' && (
          <div className="blv-edit-hint">
            <Icon name="grid" size={14} />
            Kéo widget để đổi chỗ · kéo các tay nắm ở mép/góc để đổi kích thước · nhấp đúp tay nắm để về kích thước mặc định
          </div>
        )}

        {/* Các tab luôn được mount (ẩn bằng class .active) để giữ vị trí cuộn */}
        <div className={panel('tongquan')}>
          <OverviewTab
            tasks={tasks} onToggleTask={toggleTask} onAddTask={canCreate ? () => setTaskModalOpen(true) : null}
            onRequestLeave={canCreate ? () => { setTab('dontu'); pickDonTuType('xinphep') } : null}
            editing={editing} resetSignal={resetSignal}
          />
        </div>
        <div className={panel('dontu')}>
          <DonTuTab requests={requests} onPickType={canCreate ? pickDonTuType : null} onCancelRequest={can('banlamviec', 'main', 'delete') ? cancelRequest : null} openId={openRequestId} onOpen={setOpenRequestId} />
        </div>
      </div>

      <AddTaskModal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} onAdd={addTask} />
      <DonTuModal open={donTuOpen} type={donTuType} onClose={() => setDonTuOpen(false)} onSubmit={addRequest} />

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
