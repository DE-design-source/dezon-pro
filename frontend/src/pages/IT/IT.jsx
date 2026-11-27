import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import './IT.css'
import { useTheme } from '../../hooks/useTheme'
import { TICKET_GROUPS, PRIO_LABEL, PRIO_COLOR, TICKET_CATEGORIES, IT_STAGES, IT_FLOW_TEMPLATES, categoryOf, statusFromTasks } from '../../data/itData'
import { listTickets, createTicket as apiCreateTicket, updateTicket, listStaff, fileToDataUrl, rolesToServer } from './api'
import { mediaUrl } from '../QS/api/files'
import FlowBoard from '../../components/kanban/FlowBoard'
import NotifBell from '../../components/ui/NotifBell'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import { IT_TABS } from '../../data/pageTabs'
import { usePageTabsHidden, useTabFallback } from '../../hooks/usePageTabs'
import { useAccess } from '../../services/accessService'
import TicketList from './components/TicketList'
import DashSide from './components/DashSide'
import CreateTicketModal from './components/CreateTicketModal'
import AssetsTab from './components/AssetsTab'

const GROUP = Object.fromEntries(TICKET_GROUPS.map(([k, l, c]) => [k, { label: l, color: c }]))
const CATEGORY = Object.fromEntries(TICKET_CATEGORIES)
const POLL_MS = 30000 // hỏi lại danh sách (phiếu Báo lỗi mới, thay đổi của người khác)
const SAVE_DELAY = 400 // gộp các lần sửa bảng liên tiếp thành 1 lệnh gửi
const errMsg = e => (e && e.message) || 'Lỗi không xác định'
/* Bảng xử lý bắt đầu trống: IT tự thêm công việc (không còn dựng sẵn công việc mẫu theo hạng mục, 2026-11-16) */
const tasksOf = t => t.tasks || []
const stagesOf = t => t.stages || IT_STAGES
/* % công việc xong (không tính việc đã hủy) */
function progressOf(tasks, stages) {
  const k = Object.fromEntries(stages.map(s => [s.key, s]))
  const live = tasks.filter(x => !k[x.stage]?.closed)
  return live.length ? Math.round(live.filter(x => k[x.stage]?.done).length / live.length * 100) : 0
}
/* Tài khoản -> người trên bảng xử lý (FlowBoard: name, role, dept) */
const roleLabel = e => (e.role === 'admin' ? 'Quản trị' : e.role === 'super' ? 'Quản trị hệ thống' : e.role === 'subadmin' ? 'Admin' : e.it ? 'Phòng IT' : 'Nhân viên')

export default function IT() {
  const { theme, toggleTheme } = useTheme()
  const [params, setParams] = useSearchParams()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)
  const [pageTab, setPageTab] = useState('main') // main | thietbi | nhansu
  // tab ẩn ở Cài đặt > Hiển thị; tab đang mở bị ẩn thì sang tab hiện đầu tiên
  // + tab không được xem theo phân quyền 3 cấp (N21, module it)
  const { can } = useAccess()
  const hiddenPref = usePageTabsHidden('/it')
  const noViewKey = IT_TABS.filter(t => !can('it', t.key)).map(t => t.key).join(',')
  const tabHidden = useMemo(() => (noViewKey ? hiddenPref.concat(noViewKey.split(',')) : hiddenPref), [hiddenPref, noViewKey])
  useTabFallback(tabHidden, pageTab, IT_TABS.map(t => t.key), setPageTab)
  const noTab = IT_TABS.every(t => !can('it', t.key))

  const [tickets, setTicketsState] = useState([])
  const ticketsRef = useRef([])
  const setTickets = useCallback(next => {
    const v = typeof next === 'function' ? next(ticketsRef.current) : next
    ticketsRef.current = v
    setTicketsState(v)
  }, [])
  const [canManageSrv, setCanManage] = useState(false)
  const canManage = canManageSrv && can('it', 'main', 'edit') // máy chủ (phòng IT) + N21 Sửa ở Bảng điều khiển
  const canCreate = can('it', 'main', 'create')
  const [load, setLoad] = useState({ state: 'loading', error: '' }) // loading | ready | error
  const [staff, setStaff] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [newId, setNewId] = useState(null)
  const [boardId, setBoardId] = useState(null) // yêu cầu đang mở dạng kanban
  const [boardRev, setBoardRev] = useState(0) // tăng để dựng lại bảng (trả quy trình về như cũ)
  const pending = useRef({}) // id -> {patch, prev, timer}: lệnh sửa chờ gửi
  const inflight = useRef({}) // id -> số lệnh đang gửi
  const loaded = useRef(false)

  const showToast = useCallback((msg, ms = 3500) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  /* Tải danh sách; yêu cầu đang chờ / đang lưu giữ bản trên máy để không bị bản cũ của máy chủ đè */
  const reload = useCallback(async (initial = false) => {
    if (initial) setLoad({ state: 'loading', error: '' })
    try {
      const r = await listTickets()
      const local = Object.fromEntries(ticketsRef.current.map(t => [t.id, t]))
      const merged = r.tickets.map(t => ((pending.current[t.id] || inflight.current[t.id]) && local[t.id] ? local[t.id] : t))
      if (loaded.current) {
        const added = merged.filter(t => !local[t.id])
        if (added.length) setNewId(added[0].id)
      }
      loaded.current = true
      setTickets(merged)
      setCanManage(r.canManage)
      setLoad({ state: 'ready', error: '' })
    } catch (e) {
      if (initial || !loaded.current) setLoad({ state: 'error', error: errMsg(e) })
    }
  }, [setTickets])

  useEffect(() => {
    reload(true)
    listStaff().then(setStaff).catch(() => setStaff([]))
    const tick = () => { if (!document.hidden && loaded.current) reload() }
    const iv = setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    return () => { clearInterval(iv); window.removeEventListener('focus', tick) }
  }, [reload])
  // rời trang: gửi nốt các lệnh đang chờ
  useEffect(() => () => { Object.keys(pending.current).forEach(id => flushRef.current?.(id)) }, [])

  const boardPeople = staff.map(e => ({ name: e.name, role: roleLabel(e), dept: e.department || 'Khác' }))
  const boardDepts = [...new Set(boardPeople.map(p => p.dept))]
  const boardTicket = tickets.find(t => t.id === boardId)

  const patchLocal = (id, patch) => setTickets(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)))

  /* Gửi lệnh sửa đang chờ của 1 yêu cầu. Lỗi: báo + trả yêu cầu về như trước đợt sửa */
  const flush = useCallback(id => {
    const p = pending.current[id]
    if (!p) return
    clearTimeout(p.timer)
    delete pending.current[id]
    inflight.current[id] = (inflight.current[id] || 0) + 1
    updateTicket(id, p.patch)
      .then(t => {
        inflight.current[id]--
        if (!pending.current[id] && !inflight.current[id]) setTickets(prev => prev.map(x => (x.id === t.id ? t : x)))
      })
      .catch(e => {
        inflight.current[id]--
        const q = pending.current[id]
        if (q) { clearTimeout(q.timer); delete pending.current[id] }
        setTickets(prev => prev.map(x => (x.id === p.prev.id ? p.prev : x)))
        setBoardRev(n => n + 1)
        showToast('Không lưu được thay đổi: ' + errMsg(e), 5000)
      })
  }, [setTickets, showToast])
  const flushRef = useRef(flush)
  flushRef.current = flush

  function queueSave(t, patch) {
    const p = pending.current[t.id] || { patch: {}, prev: t }
    clearTimeout(p.timer)
    p.patch = { ...p.patch, ...patch }
    p.timer = setTimeout(() => flush(t.id), SAVE_DELAY)
    pending.current[t.id] = p
  }

  const readOnly = () => { showToast(canManageSrv ? 'Tài khoản chưa được cấp quyền sửa yêu cầu IT' : 'Chỉ phòng IT cập nhật được tiến độ'); setBoardRev(n => n + 1) }

  // Công việc thay đổi -> trạng thái + tiến độ yêu cầu theo bảng; giao diện đổi ngay, gửi máy chủ sau SAVE_DELAY
  function changeTasks(fn) {
    if (!canManage) { readOnly(); return }
    const t = ticketsRef.current.find(x => x.id === boardId)
    if (!t) return
    const stages = stagesOf(t)
    const tasks = fn(tasksOf(t))
    const status = statusFromTasks(tasks, stages, t.status)
    const progress = progressOf(tasks, stages)
    patchLocal(t.id, { tasks, status, progress })
    queueSave(t, { tasks, status, progress })
  }
  function changeStages(stages) {
    if (!canManage) { readOnly(); return }
    const t = ticketsRef.current.find(x => x.id === boardId)
    if (!t) return
    const tasks = tasksOf(t)
    const status = statusFromTasks(tasks, stages, t.status)
    const patch = status !== t.status ? { stages, status, progress: progressOf(tasks, stages) } : { stages }
    patchLocal(t.id, patch)
    queueSave(t, patch)
  }

  /* Mở trang yêu cầu = IT đã tiếp nhận */
  const openTicket = useCallback(t => {
    setBoardId(t.id)
    setPageTab('main')
    if (canManage && !t.received) {
      patchLocal(t.id, { received: true })
      updateTicket(t.id, { received: true }).catch(() => patchLocal(t.id, { received: false }))
    }
  }, [canManage]) // eslint-disable-line react-hooks/exhaustive-deps

  /* /it?ticket=<id> (từ thông báo): mở yêu cầu khi danh sách đã tải, rồi xoá tham số */
  const ticketParam = params.get('ticket')
  useEffect(() => {
    if (!ticketParam || load.state !== 'ready') return
    const t = ticketsRef.current.find(x => String(x.id) === ticketParam)
    if (t) openTicket(t)
    else showToast(`Không tìm thấy yêu cầu #${ticketParam} hoặc bạn không có quyền xem`)
    setParams(p => { const n = new URLSearchParams(p); n.delete('ticket'); return n }, { replace: true })
  }, [ticketParam, load.state, openTicket, setParams, showToast])

  /* Thông báo it_* trên chuông: mở yêu cầu ngay trên trang, không điều hướng */
  function onNotif(n) {
    if (!/^it_/.test((n && n.kind) || '') || n.refId == null) return false
    const t = ticketsRef.current.find(x => String(x.id) === String(n.refId))
    if (t) { openTicket(t); return true }
    reload().then(() => {
      const u = ticketsRef.current.find(x => String(x.id) === String(n.refId))
      if (u) openTicket(u)
      else showToast(`Không tìm thấy yêu cầu #${n.refId}`)
    })
    return true
  }

  async function createTicket(data) {
    const images = await Promise.all(data.images.map(async im => ({ name: im.name, data: await fileToDataUrl(im.file) })))
    const t = await apiCreateTicket({
      title: data.issue, desc: data.desc, priority: data.priority, category: data.category,
      deadline: data.deadline || '', requester: data.requester, requesterUsername: data.requesterUsername,
      roles: rolesToServer(data.roles), images, source: 'manual',
    })
    data.images.forEach(im => { try { URL.revokeObjectURL(im.url) } catch { /* bỏ qua */ } })
    setTickets(prev => [t, ...prev.filter(x => x.id !== t.id)])
    setCreateOpen(false)
    setPageTab('main')
    setBoardId(null)
    setNewId(t.id)
    const notified = [...new Set(data.roles.flatMap(r => r.people))]
    showToast(`Đã tạo yêu cầu #${t.id}${notified.length ? ` · đã gửi thông báo tới ${notified.join(', ')}` : ''}`)
  }

  /* Thao tác nhanh: sang tab Thiết bị / Cơ cấu phòng ban */
  function gotoSection(key) {
    setPageTab(key === 'assets' ? 'thietbi' : 'nhansu'); setBoardId(null)
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
        <NotifBell onOpen={onNotif} />
        <button className="it-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {noTab && <div className="it-scroll"><div className="it-state">Tài khoản chưa được cấp quyền xem trang IT. Nhờ quản trị viên cấp quyền.</div></div>}
      <div className="it-scroll it-scroll-dash" style={pageTab !== 'main' || !can('it', 'main') || boardTicket ? { display: 'none' } : undefined}>
        {load.state === 'loading' && <div className="it-state">Đang tải danh sách yêu cầu…</div>}
        {load.state === 'error' && (
          <div className="it-state err">
            <span>Không tải được danh sách yêu cầu: {load.error}</span>
            <button onClick={() => reload(true)}>Thử lại</button>
          </div>
        )}
        {/* Bảng điều khiển: cột trái thẻ tóm tắt + thao tác nhanh, cột phải danh sách yêu cầu (cùng bố cục Bảng điều khiển QS) */}
        {load.state === 'ready' && (
          <div className="it-dash">
            <DashSide tickets={tickets} onCreate={canCreate ? () => setCreateOpen(true) : undefined} onGoto={gotoSection} tabs={IT_TABS.map(t => t.key).filter(k => can('it', k))} />
            <div className="it-content it-dash-main">
              <TicketList tickets={tickets} title={canManageSrv ? 'Danh sách yêu cầu' : 'Yêu cầu của tôi'} highlightId={newId} onOpen={openTicket} onCreate={canCreate ? () => setCreateOpen(true) : undefined} />
            </div>
          </div>
        )}
      </div>

      {/* Thiết bị & tài sản CNTT: module riêng (tab trên thanh tiêu đề), không hiện ở Bảng điều khiển */}
      {pageTab === 'thietbi' && can('it', 'thietbi') && !boardTicket && (
        <div className="it-scroll">
          <AssetsTab canManage={canManageSrv} canCreate={can('it', 'thietbi', 'create')} canEdit={can('it', 'thietbi', 'edit')} canDelete={can('it', 'thietbi', 'delete')} />
        </div>
      )}

      {pageTab === 'nhansu' && can('it', 'nhansu') && (
        <div className="it-scroll">
          <DeptStaff units={['it']} />
        </div>
      )}

      {boardTicket && can('it', 'main') && (
        <FlowBoard
          key={boardTicket.id + ':' + boardRev}
          open
          variant="page"
          backLabel="Danh sách yêu cầu"
          onClose={() => setBoardId(null)}
          accent="var(--it)"
          kicker={`Yêu cầu hỗ trợ #${boardTicket.id}${canManage ? '' : ' · chỉ xem'}`}
          title={boardTicket.issue}
          itemNoun="công việc"
          codePrefix={`#${boardTicket.id}`}
          codeSep="."
          stages={stagesOf(boardTicket)}
          onStagesChange={changeStages}
          templates={IT_FLOW_TEMPLATES}
          people={boardPeople}
          depts={boardDepts}
          items={tasksOf(boardTicket)}
          onItemsChange={changeTasks}
          meta={[
            { label: 'Trạng thái', value: <><i className="it-meta-dot" style={{ background: GROUP[boardTicket.status]?.color }} />{GROUP[boardTicket.status]?.label}</> },
            { label: 'Tiến độ', value: `${Math.round(boardTicket.progress || 0)}%` },
            { label: 'Người yêu cầu', value: boardTicket.requester },
            { label: 'Mức độ', value: <><i className="it-meta-dot" style={{ background: PRIO_COLOR[boardTicket.priority] }} />{PRIO_LABEL[boardTicket.priority]}</> },
            { label: 'Hạng mục', value: CATEGORY[categoryOf(boardTicket)] },
            { label: 'Ngày tạo', value: boardTicket.date },
            ...(boardTicket.deadline ? [{ label: 'Deadline dự kiến', value: boardTicket.deadline }] : []),
            ...(boardTicket.page ? [{ label: 'Trang báo lỗi', value: boardTicket.page }] : []),
            ...(boardTicket.roles?.length ? boardTicket.roles.map(r => ({ label: r.label, value: r.people.join(', ') })) : [{ label: 'Phụ trách', value: boardTicket.assignee || '—' }]),
          ]}
          info={(boardTicket.desc || boardTicket.images?.length) ? (
            <div className="it-board-info">
              {/* phiếu Báo lỗi cũ có dòng "Trang: ... · gửi từ Dezbot" ghép vào mô tả: đã có ô "Trang báo lỗi" ở hàng thông tin nên bỏ */}
              {boardTicket.desc && <p className="it-board-desc">{boardTicket.reported ? boardTicket.desc.replace(/\n*Trang: [^\n]*· gửi từ Dezbot\s*$/, '') : boardTicket.desc}</p>}
              {boardTicket.images?.length > 0 && <div className="it-board-imgs">{boardTicket.images.map(im => <a key={im.url} href={mediaUrl(im.url)} target="_blank" rel="noreferrer" title={im.name}><img src={mediaUrl(im.url)} alt={im.name} /></a>)}</div>}
            </div>
          ) : null}
        />
      )}
      <CreateTicketModal open={createOpen} staff={staff} onClose={() => setCreateOpen(false)} onCreate={createTicket} />
      {toast && <div className="it-toast">{toast}</div>}

      <Dezbot
        open={aiOpen}
        tickets={tickets}
        canManage={canManage}
        onOpen={() => setAiOpen(true)}
        onClose={() => setAiOpen(false)}
        onResize={setAiWidth}
        onResizingChange={setAiResizing}
      />
    </div>
  )
}
