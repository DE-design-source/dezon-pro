import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import './KinhDoanh.css'
import { useTheme } from '../../hooks/useTheme'
import {
  SALES_TABS, SALES_ADMIN_TABS, HANDOFF_CONFIG, KD_STEPS, KD_WALLET_INITIAL, DEPT_LABEL,
  DESIGN_STAGES, DESIGN_LABEL, DESIGN_COLOR, CONSTRUCTION_STAGES, CONSTRUCTION_LABEL, CONSTRUCTION_COLOR, STAGE_LABEL,
} from '../../data/kinhDoanhData'
import { fmtTy, matchesTimeFilter, phoneKeys, phoneNorms, emailKeys } from './utils'
import { addKdRequest } from '../../services/kdRequestService'
import OverviewTab from './components/OverviewTab'
import PipelineTab from './components/PipelineTab'
import SubBoard from './components/SubBoard'
import TasksTab from './components/TasksTab'
import AiConfigTab from './components/AiConfigTab'
import LeadModal from './components/LeadModal'
import StaffRequestModal from './components/StaffRequestModal'
import ConfirmDelete from './components/ConfirmDelete'
import { useKdMap, saveKdOptionsMany } from './components/ShortlistSelect'
import CustomerDashboard from './components/customer/CustomerDashboard'
import { useLeadChange } from './customerApi'
import NotifBell from '../../components/ui/NotifBell'
import HandoffModal from './components/HandoffModal'
import TaskModal from './components/TaskModal'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import DeptStaff from '../../components/hr/DeptStaff'
import WorkGate from '../../components/ui/WorkGate'
import { usePageTabsHidden } from '../../hooks/usePageTabs'
import { useWorkSession } from '../../services/workSession'
import * as kdApi from './api'

const hintStyle = { fontSize: 11.5, color: 'var(--text-muted)' }

export default function KinhDoanh() {
  return <WorkGate tab="kinhdoanh" title="Kinh doanh"><KinhDoanhPage /></WorkGate>
}

const sameId = (a, b) => String(a) === String(b)

/* Giữ vị trí khi rời trang Kinh doanh (menu trái sang Chat, QS...) rồi quay lại: tab, khách đang mở, phòng ban, thời gian,
   vị trí cuộn dọc - lưu theo tab trình duyệt (sessionStorage). Trạng thái Pipeline (bộ lọc, cuộn ngang) lưu ở PipelineTab */
const NAV_KEY = 'kd-nav-state'
const readNav = () => { try { const v = JSON.parse(sessionStorage.getItem(NAV_KEY) || 'null'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
const writeNav = v => { try { sessionStorage.setItem(NAV_KEY, JSON.stringify(v)) } catch { /* bỏ qua */ } }

function KinhDoanhPage() {
  const { theme, toggleTheme } = useTheme()
  const { me } = useWorkSession()
  const meName = (me && (me.hoTen || me.username)) || ''
  const [nav0] = useState(readNav)
  const [tab, setTab] = useState(() => (typeof nav0.tab === 'string' && nav0.tab) || 'overview')
  // tab ẩn ở Cài đặt > Hiển thị + tab chỉ cho quản trị; tab đang mở không được hiện thì sang tab hiện đầu tiên
  // (không còn tab nào hiện -> về 'overview', không nhảy qua lại giữa 2 tab)
  const tabHidden = usePageTabsHidden('/kinh-doanh')
  const isManager = !!me && (me.role === 'admin' || me.role === 'super')
  const visibleTabs = SALES_TABS.filter(t => tabHidden.indexOf(t[0]) < 0 && (isManager || SALES_ADMIN_TABS.indexOf(t[0]) < 0))
  useEffect(() => {
    if (visibleTabs.some(t => t[0] === tab)) return
    const next = visibleTabs.length ? visibleTabs[0][0] : 'overview'
    if (next !== tab) setTab(next)
  }, [isManager, tab, tabHidden]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Tab Cấu hình AI chỉ tải khi mở lần đầu, sau đó giữ mount để không mất bản nháp khi đổi tab */
  const [aicMounted, setAicMounted] = useState(false)
  useEffect(() => { if (tab === 'ai-config') setAicMounted(true) }, [tab])

  /* ---------- Dữ liệu pipeline ---------- */
  const [leads, setLeads] = useState([])
  const [dept, setDept] = useState(() => (typeof nav0.dept === 'string' && nav0.dept) || 'all')
  const [timeFilter, setTimeFilter] = useState(() => {
    const t = nav0.timeFilter
    return t && typeof t === 'object' && typeof t.time === 'string' ? { time: t.time, from: String(t.from || ''), to: String(t.to || '') } : { time: 'all', from: '', to: '' }
  })

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

  const [leadsLoaded, setLeadsLoaded] = useState(false)
  useEffect(() => { kdApi.listLeads().then(ls => { setLeads(ls); setLeadsLoaded(true) }, e => { restoreScroll.current = null; alert('Lỗi tải khách hàng: ' + e.message) }) }, [])

  /* Mở thẳng 1 khách hàng: /kinh-doanh?lead=<id> (bấm thông báo "được giao phụ trách" ở chuông QS / chuông trang này) */
  const [params, setParams] = useSearchParams()
  /* Link riêng của khách: /kinh-doanh/<mã khách> (thanh địa chỉ luôn hiện link của khách đang mở để sao chép gửi nhân viên);
     ?lead=<id> cũ (thông báo) vẫn nhận. linkDone: đã xử lý link lúc vào trang (trước đó không ghi đè đường dẫn) */
  const { leadId: pathLead } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const leadParam = params.get('lead') || pathLead || null
  const linkDone = useRef(!(params.get('lead') || pathLead))

  /* Khôi phục khách đang mở lần trước (sau khi tải xong danh sách); URL ?lead= được ưu tiên; khách đã xoá -> ở lại danh sách.
     Chưa khôi phục xong thì vẫn giữ mã khách trong trạng thái lưu (restoreLead) */
  const restoreLead = useRef(nav0.lead != null && nav0.lead !== '' ? String(nav0.lead) : null)
  const restoreScroll = useRef(nav0.scroll && typeof nav0.scroll === 'object' ? nav0.scroll : null)
  const scrollPos = useRef(restoreScroll.current)
  const scrollWait = useRef(false)
  useEffect(() => {
    if (!leadsLoaded || restoreLead.current == null) return
    const id = restoreLead.current
    restoreLead.current = null
    if (leadParam || detail.open || leadModal.open) { restoreScroll.current = null; return }
    const l = leads.find(x => sameId(x.id, id))
    if (l) { setDetail({ open: true, id: l.id }); scrollWait.current = true }
    else restoreScroll.current = null
  }, [leadsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leadParam || !leadsLoaded) return
    // đường dẫn đã khớp khách đang mở (vd vừa tự ghi link khi mở khách) -> không làm gì
    if (detail.open && sameId(detail.id, leadParam) && !params.get('lead')) { linkDone.current = true; return }
    if (leads.some(l => sameId(l.id, leadParam))) setDetail({ open: true, id: leads.find(l => sameId(l.id, leadParam)).id })
    else { alert('Không tìm thấy khách hàng (có thể đã bị xoá hoặc thuộc công ty khác)'); navigate('/kinh-doanh', { replace: true }) }
    linkDone.current = true
    if (params.get('lead')) setParams(p => { p.delete('lead'); return p }, { replace: true })
  }, [leadParam, leadsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Đồng bộ thanh địa chỉ với khách đang mở: mở khách -> /kinh-doanh/<id>, quay lại danh sách -> /kinh-doanh */
  useEffect(() => {
    if (!linkDone.current) return
    const want = detail.open && detail.id != null ? '/kinh-doanh/' + encodeURIComponent(String(detail.id)) : '/kinh-doanh'
    if (location.pathname !== want) navigate(want + location.search, { replace: true })
  }, [detail.open, detail.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const openLeadById = id => {
    const l = leads.find(x => sameId(x.id, id))
    if (l) setDetail({ open: true, id: l.id })
    else kdApi.listLeads().then(ls => { setLeads(ls); const m = ls.find(x => sameId(x.id, id)); if (m) setDetail({ open: true, id: m.id }); else alert('Không tìm thấy khách hàng (có thể đã bị xoá)') }, e => alert('Lỗi tải khách hàng: ' + e.message))
  }
  // chuông thông báo: kd_* (refId = id khách) mở khách ngay tại trang; loại khác để NotifBell điều hướng mặc định
  const openNotif = n => {
    if (!/^kd_/.test(n.kind || '')) return false
    if (n.refId != null && n.refId !== '') openLeadById(String(n.refId))
    return true
  }

  /* Tải lịch sử chăm sóc của 1 khách. actSeq: chỉ nhận lần tải mới nhất, lần ghi mới (addInteraction) cũng bỏ lần tải đang dở;
     actPending: lần tải đang dở ({id}), để addInteraction biết mà tải lại sau khi ghi */
  const actSeq = useRef(0)
  const actPending = useRef(null)
  const loadActs = (id, onErr) => {
    const n = ++actSeq.current
    const p = { id }
    actPending.current = p
    kdApi.listActivities(id).then(list => {
      if (n === actSeq.current) setInteractions(m => ({ ...m, [id]: list }))
    }, e => {
      if (onErr && n === actSeq.current) onErr(e)
    }).finally(() => { if (actPending.current === p) actPending.current = null })
  }
  /* Mở trang khách hàng -> tải lịch sử chăm sóc thật; đã có trong bộ nhớ thì vẫn hiện bản cũ và tải lại ngầm
     (AI tách giọng xong lúc trang đóng có thể đã sửa mục chăm sóc trên máy chủ) */
  useEffect(() => {
    if (!detail.open || !detail.id) return
    if (interactions[detail.id]) loadActs(detail.id)
    else loadActs(detail.id, e => alert('Lỗi tải lịch sử chăm sóc: ' + e.message))
  }, [detail.open, detail.id]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Khối khác báo lịch sử chăm sóc đổi (Live lưu hội thoại, AI tách giọng xong) -> tải lại từ máy chủ; lỗi thì giữ danh sách đang có */
  useLeadChange(detail.open ? detail.id : '', ['activities'], () => loadActs(detail.id))

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

  /* Sửa ngày tạo (nút bút chì cạnh "Ngày tạo" ở trang khách hàng) */
  function setCreatedAt(id, day) {
    const old = leads.find(l => sameId(l.id, id))
    if (!old || !day || day === old.createdAt) return
    setLeads(prev => prev.map(l => (sameId(l.id, id) ? { ...l, createdAt: day } : l)))
    kdApi.setLeadCreatedAt(old.id, day).then(replaceLead, e => { replaceLead(old); alert('Không lưu được ngày tạo: ' + e.message) })
  }

  /* ---------- Chuyển giai đoạn (moveLead) ---------- */
  const geoMap = useKdMap('geo')
  const projNameMap = useKdMap('projName')   // Tên dự án (MarkUp 2026-11-16 16:17)
  const investorMap = useKdMap('investor')   // Chủ đầu tư (MarkUp 2026-11-19)
  const cdtMap = useKdMap('cdtContact')      // Chức vụ / Phòng ban của người phụ trách bên CĐT (MarkUp 2026-11-19)
  const attachMap = useKdMap('attach')       // Hình / tệp đính kèm (MarkUp 2026-11-16 16:20)
  const timelineMap = useKdMap('timeline')   // Thời gian khởi công / hoàn công (MarkUp 2026-11-16 16:48)
  const landMap = useKdMap('land')           // Thông số đất đọc từ sổ đỏ / gõ tay {area, dai, rong, plotNo, mapSheet, purpose, shapeNote, src}
  /* Kéo thẻ vào "Nhân sự KD phụ trách": hiện phiếu yêu cầu nhân sự trước, xác nhận mới chuyển giai đoạn */
  const [staffReq, setStaffReq] = useState({ open: false, leadId: null, seq: 0 })
  /* final = {list: người phụ trách sau khi giao / gỡ, removed: người bị gỡ} (StaffRequestModal) */
  function confirmStaffReq(newAssignees, note, final) {
    const lead = leads.find(l => sameId(l.id, staffReq.leadId))
    setStaffReq(r => ({ ...r, open: false }))
    if (!lead) return
    const removed = (final && final.removed) || []
    const changed = newAssignees.length > 0 || removed.length > 0
    const list = final && final.list ? final.list : [...(lead.assignees || []), ...newAssignees]
    patchLead(lead.id, { stage: 'giao-ns', ...(changed ? { assignees: list } : null) })
    const ten = newAssignees.map(a => a.name).join(', ')
    const go = removed.map(a => a.name).join(', ')
    if (note || ten || go) {
      const d = new Date(); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      addInteraction(lead, { type: 'note', date: iso, by: meName, title: 'Yêu cầu nhân sự KD phụ trách', content: [ten ? 'Giao: ' + ten : '', go ? 'Gỡ: ' + go : '', note].filter(Boolean).join('\n'), outcome: 'good', next: '', nextNote: '' })
    }
  }
  function moveLead(id, newStage) {
    const lead = leads.find(l => sameId(l.id, id))
    if (!lead || lead.stage === newStage) return
    if (newStage === 'giao-ns') { setStaffReq(r => ({ open: true, leadId: lead.id, seq: r.seq + 1 })); return }
    /* Máy chủ tạo / ẩn dự án theo phòng nhận (sales deliveryKinds): cột Dự án (Thiết kế) / (Thi công) -> trang của cột,
       phiếu gửi Phòng Thiết kế / Thi công -> trang phòng đó; giai đoạn khác: gỡ */
    patchLead(lead.id, { stage: newStage })
    const cfg = HANDOFF_CONFIG[newStage]
    /* Cột nào có cấu hình phiếu thì kéo thẻ vào (từ bất kỳ cột nào) đều hiện phiếu */
    if (cfg) setHandoff(h => ({ open: true, leadId: lead.id, stageKey: newStage, seq: h.seq + 1 }))
  }

  /* Xoá khách hàng: hộp xác nhận ở giữa màn hình (ConfirmDelete) thay window.confirm */
  const [delId, setDelId] = useState(null)
  const delLead = delId != null ? leads.find(l => sameId(l.id, delId)) : null
  function deleteLead(id) {
    if (leads.find(l => sameId(l.id, id))) setDelId(id)
  }
  function doDelete() {
    const lead = delLead
    setDelId(null)
    if (!lead) return
    kdApi.deleteLead(lead.id).then(() => {
      setLeads(prev => prev.filter(l => !sameId(l.id, lead.id)))
    }, e => alert('Không xoá được: ' + e.message))
  }

  /* ---------- Modal thêm / sửa lead ---------- */
  const openLeadModal = id => { setLeadModal(m => ({ open: true, id: id || null, seq: m.seq + 1 })); if (scrollRef.current) scrollRef.current.scrollTop = 0 }
  const closeLeadModal = () => setLeadModal(m => ({ ...m, open: false }))
  async function saveLead(input) {
    const { _geo: geo, _projName: projName, _investor: investor, _cdt: cdt, _attach: attach, _timeline: timeline, _land: land, ...data } = input   // Khu vực / Tỉnh-TP, Tên dự án: lưu riêng kdOptions.geo / .projName (máy chủ chưa có cột)
    const editing = leadModal.id ? leads.find(l => sameId(l.id, leadModal.id)) : null
    try {
      const saved = editing ? await kdApi.updateLead(editing.id, data) : await kdApi.createLead(data)
      const patch = {}
      if (geo) {
        const m = { ...geoMap }
        const gv = { ...geo }
        const link = String(gv.map || '').trim()
        if (link) gv.map = link; else delete gv.map   // map: link Google Maps công trình, chỉ lưu khi có
        const fb = String(gv.fb || '').trim()
        if (fb) gv.fb = fb; else delete gv.fb   // fb: link Facebook của khách, chỉ lưu khi có
        if (gv.kv || gv.tinh || gv.xa || gv.map || gv.fb) m[String(saved.id)] = gv; else delete m[String(saved.id)]   // geo: {kv, tinh, xa?, map?, fb?} (xa = Phường / Xã)
        patch.geo = m
      }
      if (projName !== undefined && (projName || projNameMap[String(saved.id)])) {
        const m = { ...projNameMap }
        if (projName) m[String(saved.id)] = projName; else delete m[String(saved.id)]
        patch.projName = m
      }
      if (investor !== undefined && (investor || investorMap[String(saved.id)])) {
        const m = { ...investorMap }
        if (investor) m[String(saved.id)] = investor; else delete m[String(saved.id)]
        patch.investor = m
      }
      if (cdt) {
        const has = cdt.role || cdt.dept
        if (has || cdtMap[String(saved.id)]) {
          const m = { ...cdtMap }
          if (has) m[String(saved.id)] = { role: cdt.role || '', dept: cdt.dept || '' }; else delete m[String(saved.id)]
          patch.cdtContact = m
        }
      }
      if (attach) {
        const has = (attach.img && attach.img.length) || (attach.file && attach.file.length) || (attach.so && attach.so.length)
        if (has || attachMap[String(saved.id)]) {
          const m = { ...attachMap }
          if (has) m[String(saved.id)] = { img: attach.img || [], file: attach.file || [], ...(attach.so && attach.so.length ? { so: attach.so } : null) }; else delete m[String(saved.id)]
          patch.attach = m
        }
      }
      if (land) {
        const clean = {}
        for (const k of ['area', 'dai', 'rong']) if (Number(land[k]) > 0) clean[k] = Number(land[k])
        for (const k of ['plotNo', 'mapSheet', 'purpose', 'shapeNote']) if (land[k]) clean[k] = String(land[k])
        const has = clean.area || clean.dai || clean.rong
        if (has && land.src) clean.src = land.src
        if (has || landMap[String(saved.id)]) {
          const m = { ...landMap }
          if (has) m[String(saved.id)] = clean; else delete m[String(saved.id)]
          patch.land = m
        }
      }
      if (timeline) {
        const has = timeline.start || timeline.end
        if (has || timelineMap[String(saved.id)]) {
          const m = { ...timelineMap }
          if (has) m[String(saved.id)] = { start: timeline.start || '', end: timeline.end || '' }; else delete m[String(saved.id)]
          patch.timeline = m
        }
      }
      if (Object.keys(patch).length) saveKdOptionsMany(patch)
      setLeads(prev => (editing ? prev.map(l => (sameId(l.id, saved.id) ? saved : l)) : [...prev, saved]))
      closeLeadModal()
    } catch (e) {
      throw e   // LeadModal hiện lỗi màu đỏ ngay trên form và chỉ ô sai
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
        /* stage: phiếu gửi từ giai đoạn nào - máy chủ chỉ theo phòng nhận khi khách còn ở đúng giai đoạn đó */
        handoff: { status: cfg.pendingStatus, dept, requestedAt: dt || null, assignee: assigneeName || null, stage: handoff.stageKey },
        ...(assigneeName ? { assignees: [...(lead.assignees || []), { name: assigneeName, role }] } : null),
      })
    }
    closeHandoff()
  }
  function selfQuote() {
    const cfg = HANDOFF_CONFIG[handoff.stageKey]
    if (!handoff.leadId || !cfg || !cfg.selfStatus) return
    patchLead(handoff.leadId, { handoff: { status: cfg.selfStatus, dept: cfg.dept, requestedAt: null, assignee: null, stage: handoff.stageKey } })
    closeHandoff()
  }

  /* ---------- Bảng con Thiết kế / Thi công ---------- */
  const setLeadSub = (id, sub) => patchLead(id, { sub })
  function addSubCard(name, parentStage, sub) {
    kdApi.createLead({ name, stage: parentStage, sub, dept: 'dan-dung', creator: meName, manager: meName })
      .then(saved => setLeads(prev => [...prev, saved]), e => alert('Không thêm được: ' + e.message))
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

  /* ---------- Lưu / khôi phục vị trí (sessionStorage 'kd-nav-state') ---------- */
  /* navCtx: nơi đang xem để gắn với vị trí cuộn dọc (form thêm / sửa khách không lưu) */
  const navCtx = leadModal.open ? null : detail.open && detailLead ? 'lead:' + detailLead.id : 'tab:' + tab
  const navSave = useRef(null)
  navSave.current = () => writeNav({
    tab, dept, timeFilter,
    lead: detail.open && detail.id != null ? detail.id : restoreLead.current,
    scroll: scrollPos.current,
  })
  const navTimer = useRef(null)
  const saveNavSoon = () => { clearTimeout(navTimer.current); navTimer.current = setTimeout(() => navSave.current(), 200) }
  useEffect(() => () => { clearTimeout(navTimer.current); navSave.current() }, [])
  /* Cuộn dọc về chỗ cũ khi đã về đúng nơi đang xem lần trước (thử lại vài lần trong lúc nội dung còn đang tải) */
  useEffect(() => {
    const want = restoreScroll.current
    if (!want || !leadsLoaded || restoreLead.current != null) return undefined
    if (scrollWait.current) {
      if (!(detail.open && detailLead)) return undefined   // vừa mở lại khách, chờ lượt vẽ trang khách
      scrollWait.current = false
    }
    restoreScroll.current = null
    if (want.ctx !== navCtx || !(Number(want.top) > 0)) return undefined
    const el = scrollRef.current
    if (!el) return undefined
    let n = 0, tm = null, raf = 0, stop = false
    const cancel = () => { stop = true }
    const go = () => {
      if (stop || !scrollRef.current) return
      scrollRef.current.scrollTop = Number(want.top)
      if (Math.abs(scrollRef.current.scrollTop - Number(want.top)) > 2 && n++ < 8) tm = setTimeout(go, 150)
    }
    raf = requestAnimationFrame(go)
    el.addEventListener('wheel', cancel, { passive: true })
    el.addEventListener('touchstart', cancel, { passive: true })
    el.addEventListener('pointerdown', cancel)
    return () => {
      cancelAnimationFrame(raf); clearTimeout(tm)
      el.removeEventListener('wheel', cancel); el.removeEventListener('touchstart', cancel); el.removeEventListener('pointerdown', cancel)
    }
  }, [leadsLoaded, navCtx]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restoreScroll.current && navCtx && scrollRef.current) scrollPos.current = { ctx: navCtx, top: scrollRef.current.scrollTop }
    navSave.current()
  }, [tab, dept, timeFilter, detail.open, detail.id, navCtx])
  const onPageScroll = e => {
    if (!navCtx || restoreScroll.current) return
    scrollPos.current = { ctx: navCtx, top: e.currentTarget.scrollTop }
    saveNavSoon()
  }

  /* trả Promise<boolean>: true = đã lưu (khối Live chỉ xoá bản ghi dở khi lưu được) */
  function addInteraction(lead, x) {
    return kdApi.addActivity(lead.id, x).then(saved => {
      const p = actPending.current // lần tải đang dở bị bỏ dưới đây -> tải lại sau khi thêm, không mất thay đổi phía máy chủ
      actSeq.current++
      setInteractions(m => ({
        ...m, [lead.id]: [saved, ...(m[lead.id] || [])].sort((a, b) => b.date.localeCompare(a.date)),
      }))
      if (p) loadActs(p.id)
      return true
    }, e => { alert('Không lưu được lịch sử chăm sóc: ' + e.message); return false })
  }
  /* Form thêm mới báo trùng > "Gộp vào khách này": bổ sung SĐT / email chưa có vào khách cũ, điền các ô khách cũ còn trống
     (địa chỉ, concept, loại dự án, quy mô, giá trị, nguồn, hạng mục; Tỉnh / Tên dự án / Thời gian / đính kèm ở kdOptions),
     ghi lịch sử chăm sóc "Khách liên hệ lại" đủ mọi thông tin đã nhập rồi mở trang khách cũ */
  function mergeIntoLead(id, info) {
    const lead = leads.find(l => sameId(l.id, id))
    if (!lead) return
    if (!window.confirm('Gộp thông tin vừa nhập vào khách ' + (lead.name || '') + '? SĐT/email mới được thêm vào, thông tin còn trống được điền, phần còn lại ghi vào lịch sử chăm sóc.')) return
    const key = String(lead.id)
    const changes = {}
    /* So từng số / từng email riêng: "0903260987 0912345678" có 1 số đã biết thì vẫn thêm số còn lại */
    const seenP = phoneKeys(lead.phone)
    const newPhones = []
    phoneNorms(info.phone).forEach(n => {
      const k = n.slice(-9)
      if (seenP.indexOf(k) < 0) { newPhones.push(n); seenP.push(k) }
    })
    if (newPhones.length) changes.phone = [lead.phone, ...newPhones].filter(Boolean).join(', ')
    const oldE = emailKeys(lead.email)
    const newEmails = emailKeys(info.email).filter(x => oldE.indexOf(x) < 0)
    if (newEmails.length) changes.email = [lead.email, ...newEmails].filter(Boolean).join(', ')
    /* Chỉ điền ô khách cũ còn trống */
    const empty = v => !String(v == null ? '' : v).trim()
    if (info.address && empty(lead.address)) changes.address = info.address
    if (info.concept && empty(lead.concept)) changes.concept = info.concept
    if (info.source && empty(lead.source)) changes.source = info.source
    if (info.value > 0 && !(Number(lead.value) > 0)) changes.value = info.value
    if (info.categories && info.categories.length && !(lead.categories && lead.categories.length)) changes.categories = info.categories
    const fillType = info.projectType && empty(lead.projectType)
    const fillScale = info.scale && empty(lead.scale)
    if (fillType) changes.projectType = info.projectType
    if (fillScale) changes.scale = info.scale
    if (fillType || fillScale) {
      const t = changes.projectType || lead.projectType || 'Chưa xác định'
      const s = changes.scale || lead.scale || ''
      changes.type = s ? `${t} (${s})` : t
    }
    if (Object.keys(changes).length) patchLead(lead.id, changes)
    /* Tỉnh / Tên dự án / Thời gian / đính kèm: lưu chung kdOptions như saveLead */
    const opt = {}
    const g = info.geo || {}
    const g0 = geoMap[key] || {}
    const gMap = String(g.map || '').trim()
    let ng = null
    if ((g.kv || g.tinh || g.xa) && !g0.kv && !g0.tinh && !g0.xa) ng = { ...g0, kv: g.kv || '', tinh: g.tinh || '', ...(g.xa ? { xa: g.xa } : null) }
    if (gMap && !String(g0.map || '').trim()) ng = { ...(ng || g0), map: gMap }   // link Google Maps: mang theo khi khách đích chưa có
    const gFb = String(g.fb || '').trim()
    if (gFb && !String(g0.fb || '').trim()) ng = { ...(ng || g0), fb: gFb }   // link Facebook: như link Google Maps
    if (ng) opt.geo = { ...geoMap, [key]: ng }
    if (info.projName && !projNameMap[key]) opt.projName = { ...projNameMap, [key]: info.projName }
    const t = info.timeline || {}
    const t0 = timelineMap[key] || {}
    if ((t.start && !t0.start) || (t.end && !t0.end)) opt.timeline = { ...timelineMap, [key]: { start: t0.start || t.start || '', end: t0.end || t.end || '' } }
    const a = info.attach || {}
    const a0 = attachMap[key] || {}
    const addTo = (old, more) => { const urls = (old || []).map(x => x.url); return [...(old || []), ...(more || []).filter(x => x && x.url && urls.indexOf(x.url) < 0 && urls.push(x.url))] }
    const img = addTo(a0.img, a.img)
    const file = addTo(a0.file, a.file)
    const so = addTo(a0.so, a.so)
    const ld = info.land || {}
    if ((Number(ld.area) > 0 || Number(ld.dai) > 0 || Number(ld.rong) > 0) && !landMap[key]) opt.land = { ...landMap, [key]: ld }   // thông số đất: mang theo khi khách đích chưa có
    if (img.length !== (a0.img || []).length || file.length !== (a0.file || []).length || so.length !== (a0.so || []).length) opt.attach = { ...attachMap, [key]: { ...a0, img, file, ...(so.length ? { so } : null) } }
    if (Object.keys(opt).length) saveKdOptionsMany(opt)
    const d = new Date(); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    const ddmm = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(s || '') }
    const names = l => (l || []).map(x => x && x.name).filter(Boolean).join(', ')
    const x = {
      type: 'note', date: iso, by: meName, title: 'Khách liên hệ lại' + (info.source ? ' - nguồn ' + info.source : ''),
      content: [
        info.name ? 'Tên: ' + info.name : '',
        info.phone ? 'SĐT: ' + info.phone : '',
        info.email ? 'Email: ' + info.email : '',
        info.source ? 'Nguồn: ' + info.source : '',
        info.address ? 'Địa chỉ: ' + info.address : '',
        g.tinh || g.kv || g.xa ? 'Tỉnh: ' + [g.xa, g.tinh, g.kv].filter(Boolean).join(' - ') : '',
        gMap ? 'Google Maps: ' + gMap : '',
        gFb ? 'Facebook: ' + gFb : '',
        info.projName ? 'Tên dự án: ' + info.projName : '',
        info.projectType ? 'Loại dự án: ' + info.projectType : '',
        info.scale ? 'Quy mô: ' + info.scale : '',
        info.value > 0 ? 'Giá trị: ' + fmtTy(info.value) : '',
        info.categories && info.categories.length ? 'Hạng mục: ' + info.categories.join(', ') : '',
        t.start || t.end ? 'Thời gian: ' + [t.start ? 'khởi công ' + ddmm(t.start) : '', t.end ? 'hoàn công ' + ddmm(t.end) : ''].filter(Boolean).join(', ') : '',
        info.concept ? 'Concept: ' + info.concept : '',
        info.notes ? 'Ghi chú: ' + info.notes : '',
        names(a.img) ? 'Hình đính kèm: ' + names(a.img) : '',
        names(a.file) ? 'Tệp đính kèm: ' + names(a.file) : '',
        names(a.so) ? 'Ảnh sổ đỏ: ' + names(a.so) : '',
      ].filter(Boolean).join('\n'),
      outcome: 'good', next: '', nextNote: '',
    }
    /* Lịch sử chưa tải: addInteraction sẽ chỉ giữ 1 dòng mới (trang khách thấy đã có thì không tải lại) -> ghi xong tải lại cả danh sách */
    if (interactions[lead.id]) addInteraction(lead, x)
    else kdApi.addActivity(lead.id, x).then(() => kdApi.listActivities(lead.id)).then(list => setInteractions(m => ({ ...m, [lead.id]: list })), e => alert('Không lưu được lịch sử chăm sóc: ' + e.message))
    closeLeadModal()
    setDetail({ open: true, id: lead.id })
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
          {visibleTabs.map(([key, label]) => (
            <button key={key} className={`kd-sales-tab${tab === key && !detail.open ? ' active' : ''}`} onClick={() => { setTab(key); setDetail(d => ({ ...d, open: false })) }}>{label}</button>
          ))}
        </div>
        <button onClick={() => openLeadModal(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', background: 'var(--sales)', color: '#fff', padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Thêm khách hàng tiềm năng
        </button>
        <NotifBell onOpen={openNotif} />
        <button title="Chuyển giao diện sáng/tối" onClick={toggleTheme} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface-alt)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>}
        </button>
      </div>

      {/* Các tab luôn được mount (ẩn bằng display) để giữ trạng thái đang chọn, giống bản HTML */}
      <div ref={scrollRef} onScroll={onPageScroll} style={{ flex: 1, padding: 'var(--page-gutter)', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden' }}>
        {/* Thêm / sửa khách hàng tiềm năng: trang đầy đủ thay chỗ nội dung tab (không còn hộp nổi) */}
        <LeadModal key={`lead-${leadModal.seq}`} open={leadModal.open} lead={editingLead} me={meName} leads={leads} onClose={closeLeadModal} onSave={saveLead}
          onOpenLead={id => { closeLeadModal(); setDetail({ open: true, id }) }} onMergeInto={mergeIntoLead} />
        <div style={leadModal.open ? { display: 'none' } : { display: 'contents' }}>
        {detail.open && detailLead && (
          <CustomerDashboard
            lead={detailLead}
            me={meName}
            interactions={interactions[detailLead.id] || []}
            onAddInteraction={x => addInteraction(detailLead, x)}
            onBack={() => setDetail(d => ({ ...d, open: false }))}
            onEdit={() => openLeadModal(detailLead.id)}
            onMove={moveLead}
            onSetCreated={d => setCreatedAt(detailLead.id, d)}
            onPatch={changes => patchLead(detailLead.id, changes)}
            onOpenNotif={openNotif}
          />
        )}
        <div style={detail.open && detailLead ? { display: 'none' } : { display: 'contents' }}>

        {/* ================= TAB: TỔNG QUAN ================= */}
        <div style={panel('overview', 16)}>
          <OverviewTab allLeads={leads} leads={filteredLeads} dept={dept} onDeptChange={setDept} timeFilter={timeFilter} onTimeFilterChange={setTimeFilter} />
        </div>

        {/* ================= TAB: PIPELINE ================= */}
        <div className="kd-pl-panel" style={panel('pipeline', 14)}>
          <PipelineTab
            leads={filteredLeads} allLeads={leads} dept={dept} onDeptChange={setDept} timeFilter={timeFilter} onTimeFilterChange={setTimeFilter}
            scrollRef={scrollRef} onMove={moveLead} onDelete={deleteLead}
            onOpenDetail={id => setDetail({ open: true, id })}
            onEdit={id => openLeadModal(id)}
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

        {/* ================= TAB: CẤU HÌNH AI (admin / super) ================= */}
        {isManager && (
          <div style={panel('ai-config', 16)}>
            {aicMounted && <AiConfigTab leads={leads} />}
          </div>
        )}
        </div>
        </div>
      </div>

      {/* ---------- Modal (render bên trong .kd-page để dùng chung biến màu) ---------- */}
      <StaffRequestModal key={`srq-${staffReq.seq}`} open={staffReq.open} lead={staffReq.leadId ? leads.find(l => sameId(l.id, staffReq.leadId)) : null}
        onClose={() => setStaffReq(r => ({ ...r, open: false }))} onConfirm={confirmStaffReq} />
      <ConfirmDelete open={!!delLead} name={delLead ? delLead.name : ''} detail={delLead ? [delLead.type, STAGE_LABEL[delLead.stage]].filter(Boolean).join(' · ') : ''}
        onCancel={() => setDelId(null)} onConfirm={doDelete} />
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
