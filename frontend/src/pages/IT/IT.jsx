import { useEffect, useState } from 'react'
import './IT.css'
import { loadReports, subscribeReports, updateReport } from '../../services/itTicketService'
import { useTheme } from '../../hooks/useTheme'
import { TICKETS, ASSETS, ASSET_STATUS, TICKET_GROUPS, PRIO_LABEL, PRIO_COLOR, TICKET_CATEGORIES, IT_STAGES, IT_FLOW_TEMPLATES, categoryOf, buildTicketTasks, statusFromTasks } from '../../data/itData'
import { INITIAL_HR_EMPLOYEES, deptOf } from '../../data/hrData'
import FlowBoard from '../../components/kanban/FlowBoard'

/* Nhân sự & phòng ban cho bảng quy trình (lấy từ HR) */
const BOARD_PEOPLE = INITIAL_HR_EMPLOYEES.filter(e => e.status !== 'left').map(e => ({ name: e.name, role: e.position, dept: deptOf(e.dept).name }))
const BOARD_DEPTS = [...new Set(BOARD_PEOPLE.map(p => p.dept))]
const GROUP = Object.fromEntries(TICKET_GROUPS.map(([k, l, c]) => [k, { label: l, color: c }]))
const CATEGORY = Object.fromEntries(TICKET_CATEGORIES)
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import { IT_TABS } from '../../data/pageTabs'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'
import TicketList from './components/TicketList'
import ReleaseNotes from './components/ReleaseNotes'
import DashSide from './components/DashSide'
import CreateTicketModal from './components/CreateTicketModal'

function StatusBadge({ status }) {
  const [label, color, bg] = status
  return <span className="it-badge" style={{ background: bg, color }}>{label}</span>
}

function Section({ id, icon, title, meta, headers, children }) {
  return (
    <div id={id} className="it-card it-section-card">
      <div className="it-section-head">
        <div className="it-section-icon">{icon}</div>
        <h3>{title}</h3>
        <span style={{ flex: 1 }} />
        <span className="it-section-meta">{meta}</span>
      </div>
      <div className="it-table-wrap">
        <table className="it-table">
          <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export default function IT() {
  const { theme, toggleTheme } = useTheme()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [pageTab, setPageTab] = useState('main') // main | nhansu
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  const tabHidden = usePageTabsHidden('/it')
  useTabFallback(tabHidden, pageTab, IT_TABS.map(t => t.key), setPageTab)
  /* Phiếu "Báo lỗi" gửi từ Dezbot (localStorage) đứng đầu danh sách; phiếu mới tới khi trang đang mở cũng tự thêm vào */
  const [tickets, setTickets] = useState(() => [...loadReports(), ...TICKETS])
  useEffect(() => subscribeReports(() => {
    const reps = loadReports()
    setTickets(prev => {
      const ids = new Set(prev.map(t => t.id))
      const add = reps.filter(r => !ids.has(r.id))
      if (!add.length) return prev
      setNewId(add[0].id)
      return [...add, ...prev]
    })
  }), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [newId, setNewId] = useState(null)
  const [boardId, setBoardId] = useState(null) // yêu cầu đang mở dạng kanban
  const [tasksBy, setTasksBy] = useState({}) // id yêu cầu → công việc trên bảng
  const [stagesBy, setStagesBy] = useState({}) // id yêu cầu → quy trình đã chỉnh
  const boardTicket = tickets.find(t => t.id === boardId)
  const executorsOf = t => t.roles?.find(r => /thực thi/i.test(r.label))?.people || []
  const tasksOf = t => tasksBy[t.id] || buildTicketTasks(t, executorsOf(t))
  const stagesOf = t => stagesBy[t.id] || IT_STAGES
  // Công việc thay đổi → cập nhật trạng thái yêu cầu theo bảng
  function changeTasks(fn) {
    const t = boardTicket
    const next = fn(tasksOf(t))
    setTasksBy(m => ({ ...m, [t.id]: next }))
    const status = statusFromTasks(next, stagesOf(t), t.status)
    if (status !== t.status) setTickets(prev => prev.map(x => (x.id === t.id ? { ...x, status } : x)))
    // phiếu từ "Báo lỗi": báo tiến độ (% công việc xong) + trạng thái về cho người báo
    if (t.reported) {
      const k = Object.fromEntries(stagesOf(t).map(s => [s.key, s]))
      const live = next.filter(x => !k[x.stage]?.closed)
      const progress = live.length ? Math.round(live.filter(x => k[x.stage]?.done).length / live.length * 100) : 0
      updateReport(t.id, { status, progress, received: true })
    }
  }
  /* Mở trang yêu cầu = IT đã tiếp nhận (phiếu Báo lỗi) */
  function openTicket(t) {
    setBoardId(t.id)
    if (t.reported && !t.received) {
      updateReport(t.id, { received: true })
      setTickets(prev => prev.map(x => (x.id === t.id ? { ...x, received: true } : x)))
    }
  }

  function createTicket(data) {
    const id = Math.max(...tickets.map(t => t.id)) + 1
    const today = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    setTickets(prev => [{ id, status: 'moi', date: today, assignee: data.roles.find(r => /thực thi/i.test(r.label))?.people[0] || '', ...data }, ...prev])
    setCreateOpen(false)
    setPageTab('main')
    setNewId(id)
    const notified = [...new Set(data.roles.flatMap(r => r.people))]
    setToast(`Đã tạo yêu cầu #${id}${notified.length ? ` · đã gửi thông báo tới ${notified.join(', ')}` : ''}`)
    setTimeout(() => setToast(null), 3500)
  }

  /* Thao tác nhanh: cuộn tới khối Thiết bị / Ghi chú cập nhật, hoặc sang tab Cơ cấu phòng ban */
  function gotoSection(key) {
    if (key === 'nhansu' || key === 'assets') { setPageTab(key === 'assets' ? 'thietbi' : 'nhansu'); setBoardId(null); return }
    document.getElementById('it-' + key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      className={`it-page${aiOpen ? ' it-ai-open' : ''}${aiResizing ? ' it-ai-resizing' : ''}`}
      style={{ '--ai-panel-width': `${aiWidth}px` }}
    >
      <div className="it-header">
        <div className="it-header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>IT</span>
        <div className="hdr-tabs" role="tablist">
          {IT_TABS.filter(t => tabHidden.indexOf(t.key) < 0).map(t => (
            <button key={t.key} className={`hdr-tab${pageTab === t.key ? ' active' : ''}`} onClick={() => { setPageTab(t.key); setBoardId(null) }}>{t.label}</button>
          ))}
        </div>
        <button className="it-create-btn" onClick={() => setCreateOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Tạo yêu cầu
        </button>
        <button className="it-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      <div className="it-scroll it-scroll-dash" style={pageTab !== 'main' || boardTicket ? { display: 'none' } : undefined}>
        {/* Bảng điều khiển: cột trái thẻ tóm tắt + thao tác nhanh, cột phải danh sách yêu cầu (cùng bố cục Bảng điều khiển QS) */}
        <div className="it-dash">
          <DashSide tickets={tickets} onCreate={() => setCreateOpen(true)} onGoto={gotoSection} />
          <div className="it-content it-dash-main">
          <TicketList tickets={tickets} highlightId={newId} onOpen={openTicket} onCreate={() => setCreateOpen(true)} />
          <div id="it-releases" className="it-content"><ReleaseNotes /></div>
          </div>
        </div>
      </div>

      {/* Thiết bị & tài sản CNTT: module riêng (tab trên thanh tiêu đề), không hiện ở Bảng điều khiển */}
      {pageTab === 'thietbi' && !boardTicket && (
        <div className="it-scroll">
          <Section
            title="Thiết bị & tài sản CNTT"
            meta="Đang theo dõi 186 thiết bị"
            headers={['Thiết bị', 'Loại', 'Người / vị trí sử dụng', 'Trạng thái']}
            icon={<svg {...iconProps}><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>}
          >
            {ASSETS.map(a => (
              <tr key={a.name}>
                <td style={{ fontWeight: 700 }}>{a.name}</td>
                <td>{a.type}</td>
                <td>{a.owner}</td>
                <td><StatusBadge status={ASSET_STATUS[a.status]} /></td>
              </tr>
            ))}
          </Section>
        </div>
      )}

      {pageTab === 'nhansu' && (
        <div className="it-scroll">
          <DeptStaff units={['it']} />
        </div>
      )}

      {boardTicket && (
        <FlowBoard
          open
          variant="page"
          backLabel="Danh sách yêu cầu"
          onClose={() => setBoardId(null)}
          accent="var(--it)"
          kicker={`Yêu cầu hỗ trợ #${boardTicket.id}`}
          title={boardTicket.issue}
          itemNoun="công việc"
          codePrefix={`#${boardTicket.id}`}
          codeSep="."
          stages={stagesOf(boardTicket)}
          onStagesChange={s => setStagesBy(m => ({ ...m, [boardTicket.id]: s }))}
          templates={IT_FLOW_TEMPLATES}
          people={BOARD_PEOPLE}
          depts={BOARD_DEPTS}
          items={tasksOf(boardTicket)}
          onItemsChange={changeTasks}
          meta={[
            { label: 'Trạng thái', value: <><i className="it-meta-dot" style={{ background: GROUP[boardTicket.status]?.color }} />{GROUP[boardTicket.status]?.label}</> },
            { label: 'Người yêu cầu', value: boardTicket.requester },
            { label: 'Mức độ', value: <><i className="it-meta-dot" style={{ background: PRIO_COLOR[boardTicket.priority] }} />{PRIO_LABEL[boardTicket.priority]}</> },
            { label: 'Hạng mục', value: CATEGORY[categoryOf(boardTicket)] },
            { label: 'Ngày tạo', value: boardTicket.date },
            ...(boardTicket.deadline ? [{ label: 'Deadline dự kiến', value: boardTicket.deadline }] : []),
            ...(boardTicket.roles?.length ? boardTicket.roles.map(r => ({ label: r.label, value: r.people.join(', ') })) : [{ label: 'Phụ trách', value: boardTicket.assignee || '—' }]),
          ]}
          info={(boardTicket.desc || boardTicket.images?.length) ? (
            <>
              {boardTicket.desc && <p className="it-board-desc">{boardTicket.desc}</p>}
              {boardTicket.images?.length > 0 && <div className="it-tl-imgs">{boardTicket.images.map(im => <a key={im.url} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={im.name} /></a>)}</div>}
            </>
          ) : null}
        />
      )}
      <CreateTicketModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={createTicket} />
      {toast && <div className="it-toast">{toast}</div>}

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
