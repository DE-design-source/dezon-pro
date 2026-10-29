import { useEffect, useRef, useState } from 'react'
import './KinhDoanh.css'
import { useTheme } from '../../hooks/useTheme'
import {
  SALES_TABS, HANDOFF_CONFIG, KD_STEPS, KD_WALLET_INITIAL, DEPT_LABEL,
  DESIGN_STAGES, DESIGN_LABEL, DESIGN_COLOR, CONSTRUCTION_STAGES, CONSTRUCTION_LABEL, CONSTRUCTION_COLOR,
} from '../../data/kinhDoanhData'
import { fmtTy, matchesTimeFilter } from './utils'
import { addKdRequest } from '../../services/kdRequestService'
import OverviewTab from './components/OverviewTab'
import PipelineTab from './components/PipelineTab'
import SubBoard from './components/SubBoard'
import TasksTab from './components/TasksTab'
import LeadModal from './components/LeadModal'
import CustomerPage from './components/CustomerPage'
import HandoffModal from './components/HandoffModal'
import TaskModal from './components/TaskModal'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import WorkGate from '../../components/ui/WorkGate'
import { useWorkSession } from '../../services/workSession'
import * as kdApi from './api'

const hintStyle = { fontSize: 11.5, color: 'var(--text-muted)' }

export default function KinhDoanh() {
  return <WorkGate tab="kinhdoanh" title="Kinh doanh"><KinhDoanhPage /></WorkGate>
}

const sameId = (a, b) => String(a) === String(b)

function KinhDoanhPage() {
  const { theme, toggleTheme } = useTheme()
  const { me } = useWorkSession()
  const meName = (me && (me.hoTen || me.username)) || ''
  const [tab, setTab] = useState('overview')

  /* ---------- Dữ liệu pipeline ---------- */
  const [leads, setLeads] = useState([])
  const [loadState, setLoadState] = useState('loading') // loading | ok | lỗi (chuỗi)
  const [dept, setDept] = useState('all')
  const [timeFilter, setTimeFilter] = useState({ time: 'all', from: '', to: '' })

  /* ---------- Modal ---------- */
  const [leadModal, setLeadModal] = useState({ open: false, id: null, seq: 0 })
  const [detail, setDetail] = useState({ open: false, id: null })
  const [interactions, setInteractions] = useState({}) // id khách hàng → lịch sử chăm sóc (tải khi mở trang khách hàng)
  const [handoff, setHandoff] = useState({ open: false, leadId: null, stageKey: null, seq: 0 })
  const [taskModal, setTaskModal] = useState({ open: false, seq: 0 })

  /* ---------- Nhiệm vụ & điểm thưởng ---------- */
  const [steps, setSteps] = useState(() => KD_STEPS.map(s => ({ ...s, subtasks: s.subtasks.map(x => ({ ...x })) })))
  const [wallet, setWallet] = useState(KD_WALLET_INITIAL)

  /* ---------- Dezbot ---------- */
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  const scrollRef = useRef(null)

  function reload() {
    setLoadState('loading')
    kdApi.listLeads().then(ls => { setLeads(ls); setLoadState('ok') }, e => setLoadState(e.message || 'Lỗi tải dữ liệu'))
  }
  useEffect(reload, [])

  /* Mở trang khách hàng -> tải lịch sử chăm sóc thật */
  useEffect(() => {
    if (!detail.open || !detail.id || interactions[detail.id]) return
    kdApi.listActivities(detail.id).then(list => setInteractions(m => ({ ...m, [detail.id]: list })), e => alert('Lỗi tải lịch sử chăm sóc: ' + e.message))
  }, [detail.open, detail.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredLeads = leads.filter(l => (dept === 'all' || l.dept === dept) && matchesTimeFilter(l, timeFilter))
  const replaceLead = saved => setLeads(prev => prev.map(l => (sameId(l.id, saved.id) ? saved : l)))
  /* Sửa 1 phần: cập nhật giao diện ngay, gửi máy chủ; lỗi thì trả lại như cũ và báo */
  function patchLead(id, changes) {
    const old = leads.find(l => sameId(l.id, id))
    if (!old) return Promise.resolve(null)
    setLeads(prev => prev.map(l => (sameId(l.id, id) ? { ...l, ...changes } : l)))
    return kdApi.updateLead(old.id, changes).then(saved => { replaceLead(saved); return saved }, e => {
      replaceLead(old)
      alert('Không lưu được: ' + e.message)
      return null
    })
  }

  /* ---------- Chuyển giai đoạn (moveLead) ---------- */
  function moveLead(id, newStage) {
    const lead = leads.find(l => sameId(l.id, id))
    if (!lead || lead.stage === newStage) return
    /* Sang thiet-ke / thi-cong: máy chủ tự tạo dự án ở Quản lý thiết kế / Quản lý dự án */
    patchLead(lead.id, { stage: newStage })
    const cfg = HANDOFF_CONFIG[newStage]
    /* Cột nào có cấu hình phiếu thì kéo thẻ vào (từ bất kỳ cột nào) đều hiện phiếu */
    if (cfg) setHandoff(h => ({ open: true, leadId: lead.id, stageKey: newStage, seq: h.seq + 1 }))
  }

  function deleteLead(id) {
    const lead = leads.find(l => sameId(l.id, id))
    if (!lead) return
    if (!window.confirm('Xoá khách hàng "' + lead.name + '" và toàn bộ lịch sử chăm sóc? Hành động này không thể hoàn tác.')) return
    kdApi.deleteLead(lead.id).then(() => {
      setLeads(prev => prev.filter(l => !sameId(l.id, lead.id)))
    }, e => alert('Không xoá được: ' + e.message))
  }

  /* ---------- Modal thêm / sửa lead ---------- */
  const openLeadModal = id => setLeadModal(m => ({ open: true, id: id || null, seq: m.seq + 1 }))
  const closeLeadModal = () => setLeadModal(m => ({ ...m, open: false }))
  async function saveLead(data) {
    const editing = leadModal.id ? leads.find(l => sameId(l.id, leadModal.id)) : null
    try {
      const saved = editing ? await kdApi.updateLead(editing.id, data) : await kdApi.createLead(data)
      setLeads(prev => (editing ? prev.map(l => (sameId(l.id, saved.id) ? saved : l)) : [saved, ...prev]))
      closeLeadModal()
    } catch (e) {
      alert('Không lưu được: ' + e.message)
    }
  }

  /* ---------- Người phụ trách trên thẻ kanban ---------- */
  const assigneesOf = id => (leads.find(l => sameId(l.id, id)) || {}).assignees || []
  const addAssignee = (id, person) => patchLead(id, { assignees: [...assigneesOf(id), person] })
  const removeAssignee = (id, idx) => patchLead(id, { assignees: assigneesOf(id).filter((_, i) => i !== idx) })

  /* ---------- Phiếu bàn giao / yêu cầu báo giá ---------- */
  const closeHandoff = () => setHandoff(h => ({ ...h, open: false, leadId: null, stageKey: h.stageKey }))
  function sendHandoff(dt, assigneeName, pickedDept) {
    const cfg = HANDOFF_CONFIG[handoff.stageKey]
    if (!handoff.leadId || !cfg) return
    /* Phiếu cho chọn phòng nhận (deptOptions) thì dùng phòng đã chọn */
    const dept = pickedDept || cfg.dept
    const role = cfg.role.replace('{dept}', dept)
    /* Gửi phiếu sang Chat (SiteFlow Bot) để phòng nhận xác nhận → điều phối → duyệt */
    const lead = leads.find(l => sameId(l.id, handoff.leadId))
    if (lead) {
      addKdRequest({
        leadId: lead.id, leadName: lead.name, leadInfo: `${lead.type} · ${fmtTy(lead.value)}`,
        stageKey: handoff.stageKey, title: cfg.title, dept, role,
        sender: meName, senderDept: DEPT_LABEL[lead.dept] || '',
        requestedAt: dt || null, suggestedAssignee: assigneeName || null,
      })
      patchLead(lead.id, {
        handoff: { status: cfg.pendingStatus, dept, requestedAt: dt || null, assignee: assigneeName || null },
        ...(assigneeName ? { assignees: [...(lead.assignees || []), { name: assigneeName, role }] } : null),
      })
    }
    closeHandoff()
  }
  function selfQuote() {
    const cfg = HANDOFF_CONFIG[handoff.stageKey]
    if (!handoff.leadId || !cfg || !cfg.selfStatus) return
    patchLead(handoff.leadId, { handoff: { status: cfg.selfStatus, dept: cfg.dept, requestedAt: null, assignee: null } })
    closeHandoff()
  }

  /* ---------- Bảng con Thiết kế / Thi công ---------- */
  const setLeadSub = (id, sub) => patchLead(id, { sub })
  function addSubCard(name, parentStage, sub) {
    kdApi.createLead({ name, stage: parentStage, sub, dept: 'dan-dung', creator: meName, manager: meName })
      .then(saved => setLeads(prev => [saved, ...prev]), e => alert('Không thêm được: ' + e.message))
  }

  /* ---------- Nhiệm vụ ---------- */
  function checkSubtask(stepIdx, subIdx) {
    setSteps(prev => {
      if (prev[stepIdx].subtasks[subIdx].done) return prev
      const next = prev.map(s => ({ ...s, subtasks: s.subtasks.map(x => ({ ...x })) }))
      const step = next[stepIdx]
      step.subtasks[subIdx].done = true
      if (step.subtasks.every(s => s.done)) {
        step.status = 'done'
        if (next[stepIdx + 1] && next[stepIdx + 1].status === 'locked') next[stepIdx + 1].status = 'current'
      }
      return next
    })
  }
  function createTask({ stepIdx, text, who, pts }) {
    setSteps(prev => prev.map((s, i) => (i !== stepIdx ? s : {
      ...s,
      subtasks: [...s.subtasks, { text, who, pts, done: false }],
      status: s.status === 'done' ? 'current' : s.status,
    })))
    setTaskModal(m => ({ ...m, open: false }))
  }
  function redeem(cost) {
    if (cost > wallet) return
    setWallet(wallet - cost)
  }

  const panel = (name, gap) => ({ display: tab === name ? 'flex' : 'none', flexDirection: 'column', gap })
  const editingLead = leadModal.id ? leads.find(l => sameId(l.id, leadModal.id)) || null : null
  const detailLead = detail.id ? leads.find(l => sameId(l.id, detail.id)) || null : null
  const handoffLead = handoff.leadId ? leads.find(l => sameId(l.id, handoff.leadId)) || null : null
  function addInteraction(lead, x) {
    kdApi.addActivity(lead.id, x).then(saved => setInteractions(m => ({
      ...m, [lead.id]: [saved, ...(m[lead.id] || [])].sort((a, b) => b.date.localeCompare(a.date)),
    })), e => alert('Không lưu được lịch sử chăm sóc: ' + e.message))
  }

  return (
    <div
      className={`kd-page${aiOpen ? ' kd-ai-open' : ''}${aiResizing ? ' kd-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      {/* ---------- Header ---------- */}
      <div style={{ height: 64, flex: 'none', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 var(--page-gutter)', boxSizing: 'border-box', background: 'var(--surface)', gap: 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--sales-tint)', color: 'var(--sales)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>Kinh doanh</span>
        <div className="hdr-tabs" role="tablist">
          {SALES_TABS.map(([key, label]) => (
            <button key={key} className={`kd-sales-tab${tab === key && !detail.open ? ' active' : ''}`} onClick={() => { setTab(key); setDetail(d => ({ ...d, open: false })) }}>{label}</button>
          ))}
        </div>
        <button onClick={() => openLeadModal(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', background: 'var(--sales)', color: '#fff', padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Thêm khách hàng tiềm năng
        </button>
        <button title="Chuyển giao diện sáng/tối" onClick={toggleTheme} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {/* Các tab luôn được mount (ẩn bằng display) để giữ trạng thái đang chọn, giống bản HTML */}
      <div ref={scrollRef} style={{ flex: 1, padding: 'var(--page-gutter)', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden' }}>
        {loadState !== 'ok' && (
          <div style={{ ...hintStyle, padding: '10px 12px', marginBottom: 12, borderRadius: 9, background: 'var(--surface-alt)', display: 'flex', gap: 10, alignItems: 'center' }}>
            {loadState === 'loading' ? 'Đang tải khách hàng…' : <>Lỗi tải dữ liệu: {loadState} <button onClick={reload} style={{ border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', padding: '3px 9px' }}>Thử lại</button></>}
          </div>
        )}
        {detail.open && detailLead && (
          <CustomerPage
            lead={detailLead}
            me={meName}
            interactions={interactions[detailLead.id] || []}
            onAddInteraction={x => addInteraction(detailLead, x)}
            onBack={() => setDetail(d => ({ ...d, open: false }))}
            onEdit={() => openLeadModal(detailLead.id)}
            onMove={moveLead}
          />
        )}
        <div style={detail.open && detailLead ? { display: 'none' } : { display: 'contents' }}>

        {/* ================= TAB: TỔNG QUAN ================= */}
        <div style={panel('overview', 16)}>
          <OverviewTab allLeads={leads} leads={filteredLeads} dept={dept} onDeptChange={setDept} timeFilter={timeFilter} onTimeFilterChange={setTimeFilter} />
        </div>

        {/* ================= TAB: PIPELINE ================= */}
        <div style={panel('pipeline', 14)}>
          <PipelineTab
            leads={filteredLeads} dept={dept} onDeptChange={setDept} timeFilter={timeFilter} onTimeFilterChange={setTimeFilter}
            scrollRef={scrollRef} onMove={moveLead} onDelete={deleteLead}
            onOpenDetail={id => setDetail({ open: true, id })}
            onAddAssignee={addAssignee} onRemoveAssignee={removeAssignee}
          />
        </div>

        {/* ================= TAB: DỰ ÁN (THIẾT KẾ) ================= */}
        <div style={panel('design-board', 14)}>
          <div style={hintStyle}>Bảng Kanban kiểu Lark Base — kéo thả thẻ giữa các cột, hoặc bấm "+ Thêm thẻ" ở cuối mỗi cột để tạo nhanh.</div>
          <SubBoard leads={leads} parentStage="thiet-ke" subStages={DESIGN_STAGES} subLabel={DESIGN_LABEL} subColor={DESIGN_COLOR} onSetSub={setLeadSub} onAddCard={addSubCard} />
        </div>

        {/* ================= TAB: DỰ ÁN (THI CÔNG) ================= */}
        <div style={panel('construction-board', 14)}>
          <div style={hintStyle}>Bảng Kanban kiểu Lark Task — kéo thả thẻ giữa các cột, hoặc bấm "+ Thêm thẻ" ở cuối mỗi cột để tạo nhanh.</div>
          <SubBoard leads={leads} parentStage="thi-cong" subStages={CONSTRUCTION_STAGES} subLabel={CONSTRUCTION_LABEL} subColor={CONSTRUCTION_COLOR} onSetSub={setLeadSub} onAddCard={addSubCard} />
        </div>

        {/* ================= TAB: NHIỆM VỤ & ĐIỂM THƯỞNG ================= */}
        <div style={panel('tasks', 16)}>
          <TasksTab steps={steps} onCheckSubtask={checkSubtask} wallet={wallet} onRedeem={redeem} onOpenCreateTask={() => setTaskModal(m => ({ open: true, seq: m.seq + 1 }))} />
        </div>

        {/* ================= TAB: NHÂN SỰ (từ HR) ================= */}
        <div style={panel('nhansu', 16)}>
          <DeptStaff units={['kddd', 'kdda']} title="Kinh doanh" />
        </div>
        </div>
      </div>

      {/* ---------- Modal (render bên trong .kd-page để dùng chung biến màu) ---------- */}
      <LeadModal key={`lead-${leadModal.seq}`} open={leadModal.open} lead={editingLead} me={meName} onClose={closeLeadModal} onSave={saveLead} />
      <HandoffModal key={`handoff-${handoff.seq}`} open={handoff.open} lead={handoffLead} stageKey={handoff.stageKey} onClose={closeHandoff} onSend={sendHandoff} onSelf={selfQuote} />
      <TaskModal key={`task-${taskModal.seq}`} open={taskModal.open} steps={steps} onClose={() => setTaskModal(m => ({ ...m, open: false }))} onSubmit={createTask} />

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
