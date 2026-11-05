import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './ChamCong.css'
import './hr/hr.css'
import { useTheme } from '../../hooks/useTheme'
import Icon from '../../components/ui/Icon'
import {
  HR_TODAY, EMPTY_EMPLOYEE, syncDepts, syncAttendance, syncSites, syncCompanyName, addDaysIso,
  deptOf, monthlySummary, MONTHS, MOTHER_KEY, PARENT_COMPANY, HOLDING, HOLDING_KEY } from '../../data/hrData'
import { ROLES, DEFAULT_PERMS, SECURITY_SETTINGS, DEFAULT_PAYROLL_CONFIG, REVIEW_PERIOD, COURSES } from '../../data/hrData2'
import EmployeesModule from './hr/EmployeesModule'
import EmployeeForm from './hr/EmployeeForm'
import OrgChart from './hr/OrgChart'
import AttendanceToday from './hr/AttendanceToday'
import ShiftSchedule from './hr/ShiftSchedule'
import LeaveRequests, { reqStatus } from './hr/LeaveRequests'
import MonthlySummary from './hr/MonthlySummary'
import PayrollModule, { calcPay } from './hr/PayrollModule'
import RecruitModule from './hr/RecruitModule'
import PerformanceModule from './hr/PerformanceModule'
import SecurityModule from './hr/SecurityModule'
import { AccessContext, makeScope, NoAccess } from './hr/access'
import { Seg, useToast } from './hr/shared'
import HanhChinhTab from './components/HanhChinhTab'
import Dezbot, { loadAiPanelWidth } from './components/Dezbot'
import WorkGate from '../../components/ui/WorkGate'
import { useWorkSession } from '../../services/workSession'
import * as hrApi from './api'

/* Các phân hệ HR — perm: khoá quyền tương ứng trong ma trận phân quyền */
const MODULES = [
  { key: 'employees', label: 'Hồ sơ nhân sự', short: 'Hồ sơ', icon: 'users', perm: 'employees' },
  { key: 'org', label: 'Sơ đồ tổ chức', short: 'Sơ đồ', icon: 'sitemap' },
  { key: 'attendance', label: 'Chấm công & phép', short: 'Chấm công', icon: 'clock', perm: 'attendance' },
  { key: 'payroll', label: 'Lương & bảo hiểm', short: 'Lương', icon: 'wallet', perm: 'payroll' },
  { key: 'recruit', label: 'Tuyển dụng', icon: 'userPlus', perm: 'recruit' },
  { key: 'performance', label: 'Hiệu suất & đào tạo', short: 'Hiệu suất', icon: 'trending', perm: 'performance' },
  { key: 'security', label: 'Phân quyền & bảo mật', short: 'Phân quyền', icon: 'shield', perm: 'security' },
  { key: 'admin', label: 'Hành chính', icon: 'building' },
]
const ATT_TABS = [
  { value: 'today', label: 'Bảng công hôm nay', icon: 'fingerprint' },
  { value: 'shifts', label: 'Ca & lịch làm việc', icon: 'calendar' },
  { value: 'requests', label: 'Đơn từ & phê duyệt', icon: 'checkCircle' },
  { value: 'monthly', label: 'Tổng hợp công & phép', icon: 'table' },
]

function initialModule() {
  const h = (window.location.hash || '').replace('#', '')
  return MODULES.some(m => m.key === h) ? h : 'employees'
}
const nowLabel = () => HR_TODAY.split('-').reverse().join('/') + ' · ' + new Date().toTimeString().slice(0, 5)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* State lưu trên máy chủ, giữ nguyên giao diện gốc: setter tính state mới, áp ngay trên trang, rồi gửi phần khác biệt
   (sync(cũ, mới)) sau 0,6 giây ngừng thao tác. load(v): dữ liệu từ máy chủ - bỏ qua khi đang có thay đổi chưa gửi. */
function useSynced(initial, sync) {
  const [val, setVal] = useState(initial)
  const r = useRef({ cur: initial, base: initial, t: 0 })
  const syncRef = useRef(sync)
  syncRef.current = sync
  const set = useCallback(upd => {
    const s = r.current
    s.cur = typeof upd === 'function' ? upd(s.cur) : upd
    setVal(s.cur)
    clearTimeout(s.t)
    s.t = setTimeout(() => { const base = s.base; s.base = s.cur; syncRef.current(base, s.cur) }, 600)
  }, [])
  const load = useCallback(v => { const s = r.current; if (s.cur !== s.base) return false; s.cur = s.base = v; setVal(v); return true }, [])
  return [val, set, load, r]
}

/* Dữ liệu HR lưu trên máy chủ (api.js, quyền tab "hr"). Vai trò ở góc phải là mô phỏng giao diện như bản gốc;
   máy chủ kiểm quyền theo tài khoản đăng nhập (admin công ty = System Admin). */
export default function ChamCong() {
  return <WorkGate tab="hr" title="Nhân sự (HR)"><ChamCongPage /></WorkGate>
}

function ChamCongPage() {
  const { theme, toggleTheme } = useTheme()
  const session = useWorkSession()
  const [module, setModule] = useState(initialModule)
  const [attTab, setAttTab] = useState('today')
  const [toastNode, toast] = useToast()
  const [loadState, setLoadState] = useState('loading')

  /* ---------- Ghi máy chủ: các đợt ghi chạy lần lượt. Trong 1 đợt mỗi lệnh độc lập: t(promise) nuốt lỗi (trả undefined)
     để lệnh sau vẫn gửi; có lỗi -> báo rồi tải lại 1 lần từ máy chủ, không lỗi -> after() ---------- */
  const queue = useRef(Promise.resolve())
  const busy = useRef(0) // số đợt ghi đang chờ / đang chạy
  const enqueue = (fn, after) => {
    busy.current++
    queue.current = queue.current.then(async () => {
      const errs = []
      await fn(p => p.then(r => r ?? true, e => { errs.push(e.message || 'Lỗi lưu dữ liệu') }))
      if (errs.length) { toast([...new Set(errs)].join(' · '), 'danger'); reload() } else if (after) await after()
    }).catch(e => { toast(e.message || 'Lỗi lưu dữ liệu', 'danger'); reload() }).finally(() => { busy.current-- })
  }

  const [role, setRole] = useState('hradmin')
  // quyền của tài khoản đăng nhập do máy chủ trả ({role, employeeId, perms}); chỉ System Admin được xem với vai trò khác
  const [me, setMe] = useState(null)
  const sys = !me || me.role === 'sysadmin'
  const [security, setSecurity, loadSecurity] = useSynced({ perms: DEFAULT_PERMS, userRoles: {}, settings: SECURITY_SETTINGS, session: '30 phút', roleUsers: {} },
    (b, c) => enqueue(async t => {
      const body = {}
      if (!same(b.perms, c.perms)) body.perms = { hradmin: c.perms.hradmin, manager: c.perms.manager, employee: c.perms.employee }
      const branches = Object.fromEntries(Object.entries(c.userRoles).filter(([, v]) => v.branches?.length).map(([k, v]) => [k, v.branches]))
      const ui = { settings: Object.fromEntries(Object.entries(c.settings).map(([k, v]) => [k, v.value])), session: c.session, branches, roleUsers: c.roleUsers }
      if (!same(b.settings, c.settings) || b.session !== c.session || !same(b.userRoles, c.userRoles)) Object.assign(body, { ui, maskSalary: c.settings.maskSalary.value })
      if (Object.keys(body).length) await t(hrApi.saveSecurity(body))
      for (const [id, v] of Object.entries(c.userRoles)) if (v.role !== (b.userRoles[id]?.role || 'employee')) await t(hrApi.setUserRole({ empId: Number(id), role: v.role }))
    }))
  const [audit, setAudit] = useState([])

  const [employees, setEmployees] = useState([])
  const [units, setUnits] = useState([])
  const [heads, setHeads] = useState({})
  // Thành viên kiêm nhiệm của HĐQT & các ban (không đổi phòng ban trong hồ sơ)
  // pct: tỉ lệ thời gian/công việc dành cho ban (trừ vào phòng ban chính) · allowance: phụ cấp kiêm nhiệm / tháng
  const [extraMembers, setExtraMembers] = useState({})
  /* Danh sách kiêm nhiệm của 1 nhân sự: [{ unit, pct, title, allowance }] — phòng ban chính giữ phần còn lại (tối thiểu 10%) */
  const concurrentOf = useCallback(empId => units
    .filter(u => (extraMembers[u.key] || []).some(m => m.id === empId))
    .map(u => ({ unit: u, ...(extraMembers[u.key].find(m => m.id === empId)) })), [units, extraMembers])
  syncDepts(units) // danh sách phòng ban dùng chung luôn khớp với cơ cấu đang thiết lập
  syncCompanyName(session.congTy?.ten) // nút công ty mẹ trên sơ đồ mang tên công ty đang đăng nhập
  const [openEmp, setOpenEmp] = useState(null)
  const [form, setForm] = useState({ open: false, emp: null })

  /* Chấm công: { shifts, schedule, today (chấm công hôm nay + nghỉ phép đã duyệt), logs (3 tháng), requests, sites, closedMonths } */
  const [att, setAtt, loadAttState] = useSynced({ shifts: [], schedule: {}, overrides: {}, logs: [], today: [], requests: [], sites: [], closedMonths: {} },
    (b, c) => enqueue(async t => {
      const upserts = [], dels = []
      c.shifts.forEach((s, i) => {
        const old = b.shifts.find(x => x.id === s.id)
        if (old) { if (!same(old, s)) upserts.push(s); return }
        const renamed = b.shifts[i] && !c.shifts.some(x => x.id === b.shifts[i].id) ? b.shifts[i].id : null // đổi mã ca
        upserts.push(renamed ? { ...s, orig: renamed } : s)
      })
      b.shifts.forEach(s => { if (!c.shifts.some(x => x.id === s.id) && !upserts.some(u => u.orig === s.id)) dels.push(s.id) })
      const schedule = Object.fromEntries(Object.entries(c.schedule).filter(([k, row]) => !same(row, b.schedule[k])))
      if (upserts.length || dels.length || Object.keys(schedule).length) await t(hrApi.saveShifts({ shifts: upserts, deleteShifts: dels, schedule }))
      const keys = ['in', 'out', 'source', 'gps', 'dist', 'note']
      const logs = c.today.filter(l => { const o = b.today.find(x => x.empId === l.empId); return !o || keys.some(k => (o[k] ?? null) !== (l[k] ?? null)) })
        .map(l => {
          // tự chấm GPS: chỉ gửi giờ vừa chấm (đã có giờ vào = chấm ra), máy chủ lấy giờ theo đồng hồ của nó
          const o = b.today.find(x => x.empId === l.empId)
          const times = l.source === 'gps' ? (o?.in ? { out: l.out || '' } : { in: l.in || '' }) : { in: l.in || '', out: l.out || '' }
          return { empId: l.empId, date: HR_TODAY, ...times, source: l.source || 'manual', ...(l.source === 'gps' ? { gps: l.gps, dist: l.dist } : {}), ...(l.note != null ? { note: l.note } : {}) }
        })
      if (logs.length) await t(hrApi.saveLogs(logs))
      for (const r of c.requests) {
        const o = b.requests.find(x => x.id === r.id)
        // mọi bước đã rời "đang chờ" (duyệt liền tay nhiều cấp): 1 lệnh / bước, theo thứ tự; lỗi hoặc từ chối thì dừng
        for (let i = o ? o.steps.findIndex(s => s.state === 'active') : -1; i >= 0 && ['done', 'rejected'].includes(r.steps[i]?.state); i++) {
          if (!(await t(hrApi.decideRequest(r.id, r.steps[i].state === 'done', r.steps[i].note || ''))) || r.steps[i].state === 'rejected') break
        }
      }
    }, reloadAtt))
  syncAttendance(att) // monthlySummary (Tổng hợp công, Lương, Chi phí cố định) tính trên dữ liệu đang tải
  syncSites(att.sites)
  const sub = k => upd => setAtt(a => ({ ...a, [k]: typeof upd === 'function' ? upd(a[k]) : upd }))
  const [setShifts, setSchedule, setLogs, setRequests] = useMemo(() => ['shifts', 'schedule', 'today', 'requests'].map(sub), [])
  const locked = useMemo(() => new Set(Object.keys(att.closedMonths || {})), [att.closedMonths])
  const setLocked = upd => {
    const next = typeof upd === 'function' ? upd(locked) : upd
    next.forEach(m => { if (!locked.has(m)) enqueue(() => hrApi.runAction({ month: m, action: 'close' }).then(() => Promise.all([reloadAtt(), reloadPay()]))) })
  }

  /* Lương: { config, adjustments {tháng: {empId: [{id, kind, label, amount}]}}, fixed {unitKey: {fund, items}}, runs {tháng: {status, sent, payslips}} } */
  const [payroll, setPayroll, loadPay] = useSynced({ config: DEFAULT_PAYROLL_CONFIG, adjustments: {}, fixed: {}, runs: {} },
    (b, c) => enqueue(async t => {
      if (!same(b.config, c.config)) await t(hrApi.savePayrollConfig(c.config))
      for (const [k, v] of Object.entries(c.fixed || {})) if (!same(v, b.fixed?.[k])) await t(hrApi.saveBudget({ unit: k, fund: Number(v.fund) || 0, items: v.items || [] }))
      const runs = Object.entries(c.runs).map(([m, run]) => ({ m, run, from: b.runs[m]?.status || 'draft', to: run.status || 'draft' })).filter(x => x.from !== x.to)
      // mở lại (kèm mở chốt công của tháng) trước khi sửa thưởng / phạt
      for (const x of runs) if (x.to === 'draft' || x.from === 'paid') {
        if (await t(hrApi.runAction({ month: x.m, action: 'reopen' }))) { x.from = 'draft'; await t(hrApi.runAction({ month: x.m, action: 'open' })) }
      }
      for (const [m, byEmp] of Object.entries(b.adjustments)) for (const [eid, list] of Object.entries(byEmp)) {
        for (const a of list) if (a.id && !(c.adjustments[m]?.[eid] || []).some(x => x.id === a.id)) await t(hrApi.deleteAdjustment(a.id))
      }
      for (const [m, byEmp] of Object.entries(c.adjustments)) for (const [eid, list] of Object.entries(byEmp)) {
        for (const a of list) if (!a.id) {
          const r = await t(hrApi.addAdjustment({ empId: Number(eid), month: m, kind: a.kind, label: a.label, amount: a.amount }))
          // gắn id vào chính object khoản (dùng chung giữa state đang hiện và các bản đã gửi): đợt sau không gửi lại, xoá được theo id
          if (r?.id) a.id = r.id
        }
      }
      // duyệt / chi trả sau thưởng / phạt; nháp -> đã chi trả liền tay = duyệt (kèm phiếu lương) rồi chi trả
      for (const x of runs) {
        if (x.to === 'draft') continue
        if (x.from === 'draft' && !(await t(hrApi.runAction({ month: x.m, action: 'approve', payslips: payslipsOf(x.m, c) })))) continue
        if (x.to === 'paid') await t(hrApi.runAction({ month: x.m, action: 'pay', sent: x.run.sent || [] }))
      }
    }, () => Promise.all([reloadPay(), reloadAtt()])))
  /* Bản chụp phiếu lương lúc duyệt: kỳ đã duyệt hiển thị đúng số đã duyệt */
  const empRef = useRef(employees)
  empRef.current = employees
  const concRef = useRef(concurrentOf)
  concRef.current = concurrentOf
  const payslipsOf = (m, p) => Object.fromEntries(monthlySummary(empRef.current, m).map(({ emp, ...a }) => {
    const adj = p.adjustments[m]?.[emp.id] || []
    return [emp.id, { att: a, adj, p: calcPay(emp, { emp, ...a }, adj, p.config, concRef.current(emp.id)) }]
  }))

  /* Mã tạm do giao diện cấp (max + 1) -> mã máy chủ trả khi tạo: lệnh phụ thuộc (tin từ JD mới, phỏng vấn / đánh giá ứng viên mới,
     tiến độ KR của mục tiêu mới) gửi bằng mã thật. Xoá khi đã tải lại từ máy chủ và không còn đợt ghi nào chờ. */
  const recIds = useRef({})
  const perfIds = useRef({})
  /* Tuyển dụng: { jobs, jds, candidates, interviews } */
  const [recruit, setRecruit, loadRecruit] = useSynced({ jobs: [], jds: [], candidates: [], interviews: [] },
    (b, c) => enqueue(async t => {
      const has = (list, id) => list.some(x => x.id === id)
      const ids = recIds.current, rid = (k, id) => ids[k + id] ?? id
      for (const jd of c.jds) {
        const o = b.jds.find(x => x.id === jd.id)
        if (!o) { const { id: _i, ...n } = jd; const r = await t(hrApi.saveJd(n)); if (r?.id) ids['jd' + jd.id] = r.id } else if (!same(o, jd)) await t(hrApi.saveJd({ ...jd, id: rid('jd', jd.id) }))
      }
      for (const jd of b.jds) if (!has(c.jds, jd.id)) await t(hrApi.deleteJd(rid('jd', jd.id)))
      for (const j of c.jobs) {
        const o = b.jobs.find(x => x.id === j.id)
        if (!o) { const { id: _i, ...n } = j; const r = await t(hrApi.saveJob({ ...n, jdId: rid('jd', j.jdId) })); if (r?.id) ids['job' + j.id] = r.id } else if (!same(o, j)) await t(hrApi.saveJob({ ...j, id: rid('job', j.id), jdId: rid('jd', j.jdId) }))
      }
      const created = {}
      for (const x of c.candidates) if (!has(b.candidates, x.id)) {
        const r = await t(hrApi.createCandidate({ jobId: rid('job', x.jobId), name: x.name, email: x.email, phone: x.phone, source: x.source, cv: x.cv, exp: x.exp }))
        if (r?.id) { ids['cand' + x.id] = r.id; created[x.id] = true }
      }
      for (const v of c.interviews) if (!has(b.interviews, v.id) && (has(b.candidates, v.candidateId) || created[v.candidateId])) {
        const { id: _i, candidateId, ...interview } = v
        await t(hrApi.updateCandidate(rid('cand', candidateId), { interview }))
      }
      for (const x of c.candidates) {
        const o = created[x.id] ? { reviews: [], stage: 'applied' } : b.candidates.find(y => y.id === x.id)
        if (!o) continue
        for (const r of (x.reviews || []).slice((o.reviews || []).length)) await t(hrApi.updateCandidate(rid('cand', x.id), { review: r }))
        if (x.stage !== o.stage && x.stage !== 'hired') await t(hrApi.updateCandidate(rid('cand', x.id), { stage: x.stage })) // nhận việc: máy chủ đánh dấu khi tạo hồ sơ
      }
    }, reloadTalent))

  /* Hiệu suất: { okrs, reviews (kỳ REVIEW_PERIOD) {empId: ...}, enroll {empId: {mã khoá COURSES: %}} }.
     Khoá học theo danh mục COURSES của giao diện; trên máy chủ khớp theo tên (thiếu thì tạo khi ghi danh). */
  const courseIds = useRef({})
  const [perf, setPerf, loadPerf] = useSynced({ okrs: [], reviews: {}, enroll: {} },
    (b, c) => enqueue(async t => {
      const ids = perfIds.current
      for (const o of c.okrs) {
        let old = b.okrs.find(x => x.id === o.id)
        if (!old) {
          const r = await t(hrApi.createOkr({ period: o.period, title: o.title, owner: o.owner, krs: o.krs.map(k => ({ title: k.title, target: k.target, unit: k.unit, owner: k.owner, inverse: !!k.inverse })) }))
          if (!r?.id) continue
          ids['okr' + o.id] = r.id
          o.krs.forEach((k, i) => { ids['kr' + o.id + ':' + k.id] = i + 1 }) // máy chủ đánh số KR 1..n theo thứ tự gửi
          old = { krs: o.krs.map(k => ({ id: k.id, current: 0 })) }
        }
        for (const k of o.krs) if (old.krs.find(x => x.id === k.id)?.current !== k.current) await t(hrApi.setKr(ids['okr' + o.id] ?? o.id, ids['kr' + o.id + ':' + k.id] ?? k.id, k.current))
      }
      const launch = Object.keys(c.reviews).filter(id => !b.reviews[id] && c.reviews[id].state === 'self').map(Number)
      if (launch.length) await t(hrApi.reviewAction({ period: REVIEW_PERIOD, action: 'launch', empIds: launch }))
      for (const [id, r] of Object.entries(c.reviews)) {
        const from = b.reviews[id]?.state || 'todo'
        if (r.state === 'manager' && from !== 'manager') await t(hrApi.reviewAction({ period: REVIEW_PERIOD, action: 'self', empId: Number(id), scores: r.self, note: r.selfNote || '' }))
        if (r.state === 'done' && from !== 'done') await t(hrApi.reviewAction({ period: REVIEW_PERIOD, action: 'mgr', empId: Number(id), scores: r.mgr, note: r.mgrNote || '' }))
      }
      for (const [eid, m] of Object.entries(c.enroll)) {
        const courses = {}
        for (const [cid, pct] of Object.entries(m)) {
          if (b.enroll[eid]?.[cid] === pct) continue
          if (!courseIds.current[cid]) { const { id: _i, ...tpl } = COURSES.find(x => String(x.id) === cid); const r = await t(hrApi.saveCourse(tpl)); if (!r?.id) continue; courseIds.current[cid] = r.id }
          courses[courseIds.current[cid]] = pct
        }
        if (Object.keys(courses).length) await t(hrApi.enroll(Number(eid), courses))
      }
    }, reloadTalent))

  /* ---------- Tải dữ liệu ---------- */
  function applyHr(st) {
    setEmployees(st.employees || [])
    setUnits(st.units || [])
    setHeads(st.heads || {})
    setExtraMembers(st.members || {})
  }
  // 3 tháng gần nhất (Tổng hợp công, Lương)
  const attRange = [MONTHS[MONTHS.length - 1].key + '-01', addDaysIso(HR_TODAY, 63)]
  /* Chấm công hôm nay + nghỉ phép đã duyệt (hiện "Nghỉ phép" thay vì "Chưa chấm công") */
  function applyAtt(a) {
    const today = a.logs.filter(l => l.date === HR_TODAY).map(l => ({ ...l }))
    a.requests.filter(r => r.type === 'leave' && reqStatus(r) === 'approved' && r.from <= HR_TODAY && HR_TODAY <= r.to).forEach(r => {
      const leave = r.title.split(' — ')[0], l = today.find(x => x.empId === r.empId)
      if (l) l.leave = leave
      else today.push({ empId: r.empId, in: null, out: null, source: null, gps: null, leave })
    })
    loadAttState({ ...a, today, requests: [...a.requests].sort((x, y) => x.id - y.id) }) // như bản gốc: đơn cũ trước
  }
  const reloadAtt = () => hrApi.loadAttendance(...attRange).then(applyAtt)
  const applyPay = pr => loadPay({ ...pr, config: { ...DEFAULT_PAYROLL_CONFIG, ...(pr.config || {}) } })
  const reloadPay = () => hrApi.loadPayroll().then(applyPay)
  function applyTalent(tl) {
    const idle = busy.current <= 1
    if (loadRecruit({ jds: tl.jds, jobs: tl.jobs, candidates: tl.candidates, interviews: tl.interviews }) && idle) recIds.current = {}
    const ids = {}
    COURSES.forEach(c => { const s = tl.courses.find(x => x.title === c.title); if (s) ids[c.id] = s.id })
    courseIds.current = ids
    const back = Object.fromEntries(Object.entries(ids).map(([k, v]) => [String(v), Number(k)]))
    const enroll = Object.fromEntries(Object.entries(tl.enroll).map(([eid, m]) => [eid, Object.fromEntries(Object.entries(m).filter(([cid]) => back[cid]).map(([cid, pct]) => [back[cid], pct]))]))
    if (loadPerf({ okrs: tl.okrs, reviews: tl.reviews[REVIEW_PERIOD] || {}, enroll }) && idle) perfIds.current = {}
  }
  const reloadTalent = () => hrApi.loadTalent().then(applyTalent)
  function applySecurity(sec, emps) {
    const ui = sec.ui || {}
    const userRoles = Object.fromEntries(emps.map(e => [e.id, { role: e.hrRole || 'employee', branches: ui.branches?.[e.id] || [] }]))
    const settings = Object.fromEntries(Object.entries(SECURITY_SETTINGS).map(([k, v]) => [k, { ...v, value: ui.settings?.[k] ?? (k === 'maskSalary' ? sec.maskSalary : v.value) }]))
    loadSecurity({ perms: { sysadmin: DEFAULT_PERMS.sysadmin, ...sec.perms }, userRoles, settings, session: ui.session || '30 phút', roleUsers: ui.roleUsers || {} })
    setAudit(sec.uiAudit || [])
  }
  function reload() {
    // phân hệ mà tài khoản không được xem (máy chủ trả 403) -> để trống
    const opt = p => p.catch(e => (e && e.forbidden ? null : Promise.reject(e)))
    Promise.all([hrApi.load(), opt(hrApi.loadAttendance(...attRange)), opt(hrApi.loadPayroll()), opt(hrApi.loadTalent()), opt(hrApi.loadSecurity())])
      .then(([st, a, pr, tl, sec]) => {
        applyHr(st)
        if (a) applyAtt(a)
        if (pr) applyPay(pr)
        if (tl) applyTalent(tl)
        if (sec) applySecurity(sec, st.employees || [])
        setMe(st.me || null)
        if (st.me?.role && st.me.role !== 'sysadmin') setRole(st.me.role)
        setLoadState('ok')
      }, e => setLoadState(e.message || 'Lỗi tải dữ liệu'))
  }
  useEffect(reload, [])

  /* Lương tháng hiện tại của 1 nhân sự (dùng cho bảng phân bổ trong hồ sơ) */
  const payOf = useCallback(empId => {
    const emp = employees.find(e => e.id === empId)
    const att = emp && monthlySummary([emp], MONTHS[0].key)[0]
    if (!att) return null
    return calcPay(emp, att, payroll.adjustments[MONTHS[0].key]?.[empId] || [], payroll.config, concurrentOf(empId))
  }, [employees, payroll, concurrentOf])

  const [aiOpen, setAiOpen] = useState(false)
  const [aiWidth, setAiWidth] = useState(loadAiPanelWidth)
  const [aiResizing, setAiResizing] = useState(false)

  useEffect(() => { history.replaceState(null, '', '#' + module) }, [module])

  /* ---------- Phân quyền (mô phỏng vai trò như bản gốc) ---------- */
  // người dùng của từng vai trò: đã lưu (roleUsers), hoặc người đầu tiên có vai trò đó
  const roleUser = r => employees.find(e => e.id === security.roleUsers[r]) || employees.find(e => (security.userRoles[e.id]?.role || 'employee') === r && e.status !== 'left') || employees[0]
  const fallbackUser = useMemo(() => ({ ...EMPTY_EMPLOYEE, id: 0, code: '', name: session.me?.hoTen || session.me?.username || 'Tôi', dept: '' }), [session.me])
  const user = (sys ? roleUser(role) : employees.find(e => e.id === me.employeeId)) || fallbackUser
  const writeAudit = entry => {
    setAudit(prev => [entry, ...prev])
    hrApi.addAudit([entry]).catch(() => {})
  }
  const log = useCallback((mod, action, target) => {
    writeAudit({ id: Date.now() + Math.random(), time: nowLabel(), user: user.name, role, module: mod, action, target, ip: '10.0.1.' + (user.id + 20) })
  }, [user, role])
  const access = useMemo(() => {
    const perms = (sys ? security.perms[role] : me.perms) || {}
    const scope = ROLES[role].scope
    return {
      role, user, log,
      can: (mod, action) => (perms[mod] || []).includes(action),
      inScope: makeScope(scope, user),
    }
  }, [security.perms, role, user, log, sys, me])
  const scoped = employees.filter(access.inScope)

  function switchRole(r) {
    if (!sys) return
    setRole(r)
    const u = roleUser(r) || fallbackUser
    setOpenEmp(r === 'employee' ? u.id : null)
    writeAudit({ id: Date.now(), time: nowLabel(), user: u.name, role: r, module: 'auth', action: 'login', target: `Đăng nhập với vai trò ${ROLES[r].label} (2FA: ${security.settings.require2fa.value && ['sysadmin', 'hradmin'].includes(r) ? 'đã xác thực' : 'không yêu cầu'})`, ip: '10.0.1.' + (u.id + 20) })
    toast(`Đang xem với vai trò ${ROLES[r].label} — ${u.name}`)
  }

  const pending = att.requests.filter(r => reqStatus(r) === 'pending' && scoped.some(e => e.id === r.empId)).length

  /* ---------- Ghi hồ sơ / cơ cấu: mỗi lệnh trả lại toàn bộ dữ liệu HR ---------- */
  function save(promise, okMsg, tone) {
    return promise.then(st => { applyHr(st); if (okMsg) toast(okMsg, tone); return st },
      e => { toast(e.message || 'Lỗi lưu dữ liệu', 'danger'); return null })
  }
  const saveOrg = (ops, okMsg, tone) => save(hrApi.saveOrg(ops), okMsg, tone)
  /* Lịch tuần mặc định của nhân sự mới (chỉ các ca công ty đã có) */
  const defaultRow = site => (site === 'Văn phòng HCM' ? ['HC', 'HC', 'HC', 'HC', 'HC', 'HC7', 'off'] : ['CT', 'CT', 'CT', 'CT', 'CT', 'CT', 'off']).map(c => (att.shifts.some(s => s.id === c) ? c : 'off'))
  const setDefaultSchedule = (id, site) => { const row = defaultRow(site); if (row.some(c => c !== 'off')) setSchedule(prev => ({ ...prev, [id]: row })) }

  /* ---------- CRUD hồ sơ ---------- */
  function saveEmployee(data) {
    if (data.id) {
      save(hrApi.updateEmployee(data.id, data), `Đã cập nhật hồ sơ ${data.name}`).then(st => {
        if (!st) return
        log('employees', 'edit', `Hồ sơ ${data.name}`)
        setForm({ open: false, emp: null })
      })
      return
    }
    const rec = {
      ...data,
      contracts: data.contracts.length ? data.contracts : [{ no: `HĐ-${data.code}`, type: data.contractType, start: data.joinDate, end: null, salary: data.salary || 0, status: 'active' }],
      promotions: [{ date: data.joinDate, note: 'Gia nhập — ' + data.position }],
    }
    save(hrApi.createEmployee(rec), `Đã tạo hồ sơ ${data.name}`).then(st => {
      if (!st) return
      setDefaultSchedule(st.id, rec.site)
      setOpenEmp(st.id)
      log('employees', 'create', `Hồ sơ ${data.name} (${data.code})`)
      setForm({ open: false, emp: null })
    })
  }
  function deleteEmployee(emp) {
    const reports = employees.filter(e => e.managerId === emp.id)
    if (!confirm(`Xoá vĩnh viễn hồ sơ ${emp.name}?${reports.length ? `\n${reports.length} nhân sự cấp dưới sẽ được chuyển cho quản lý cấp trên.` : ''}\nNên dùng "Cho nghỉ việc" nếu cần giữ lại lịch sử.`)) return
    save(hrApi.deleteEmployee(emp.id), `Đã xoá hồ sơ ${emp.name}`, 'danger').then(st => {
      if (!st) return
      if (openEmp === emp.id) setOpenEmp(null)
      log('employees', 'delete', `Hồ sơ ${emp.name} (${emp.code})`)
    })
  }
  function offboard(emp) {
    const d = prompt(`Ngày nghỉ việc của ${emp.name} (YYYY-MM-DD):`, HR_TODAY)
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    // máy chủ chuyển cấp dưới cho quản lý cấp trên
    const patch = { status: 'left', leaveDate: d, ...(emp.contracts ? { contracts: emp.contracts.map(c => (c.status === 'active' ? { ...c, status: 'expired', end: c.end || d } : c)) } : {}), ...(emp.promotions ? { promotions: [...emp.promotions, { date: d, note: 'Nghỉ việc' }] } : {}) }
    save(hrApi.updateEmployee(emp.id, patch), `${emp.name} đã được chuyển sang "Đã nghỉ việc"`).then(st => st && log('employees', 'edit', `Cho nghỉ việc ${emp.name} từ ${d}`))
  }
  /* ---------- Thiết lập cơ cấu tổ chức ---------- */
  function saveUnit(data, origKey, headId) {
    const { _orig, headId: _h, ...unit } = data
    saveOrg({ units: [{ ...unit, headId }] }, origKey ? `Đã cập nhật ${unit.label}` : `Đã thêm ${unit.label} vào cơ cấu tổ chức`)
      .then(st => st && log('employees', origKey ? 'edit' : 'create', `Cơ cấu tổ chức: ${origKey ? 'cập nhật' : 'thêm'} đơn vị "${unit.label}"`))
  }
  /* Thêm bộ phận (phòng ban / công ty con) kèm liên kết người đứng đầu:
     lead.mode = concurrent (quản lý kiêm nhiệm) | independent (lãnh đạo độc lập — điều chuyển toàn thời gian) | none
     boards: ban kiểm soát / ban chiến lược của công ty con — thành viên bổ nhiệm từ công ty mẹ (kiêm nhiệm) */
  function createUnit({ unit, lead, boards = [] }) {
    const freePct = id => 90 - concurrentOf(id).reduce((s, c) => s + c.pct, 0)
    const newUnits = [unit]
    const newHeads = {}
    const newExtras = {}
    const skipped = []
    if (lead.mode === 'concurrent' && lead.empId) {
      const pct = Math.min(lead.pct, freePct(lead.empId))
      if (pct <= 0) skipped.push(employees.find(e => e.id === lead.empId)?.name)
      else { newExtras[unit.key] = [{ id: lead.empId, pct, title: lead.title || 'Quản lý kiêm nhiệm', allowance: 0 }]; newHeads[unit.key] = lead.empId }
    }
    if (lead.mode === 'independent' && lead.empId) newHeads[unit.key] = lead.empId
    boards.forEach(b => {
      const key = unit.key + '_' + b.kind
      newUnits.push({ key, label: b.label, name: `${b.label} — ${unit.label}`, type: 'board', parent: unit.key, tone: 'qs', desc: b.desc, appointedFromParent: true })
      newExtras[key] = b.members.map((id, i) => {
        const pct = Math.min(5, freePct(id))
        if (pct <= 0) skipped.push(employees.find(e => e.id === id)?.name)
        return { id, pct: Math.max(0, pct), title: i === 0 ? (b.kind === 'bks' ? 'Trưởng ban kiểm soát' : 'Trưởng ban chiến lược') : (b.kind === 'bks' ? 'Kiểm soát viên' : 'Thành viên'), allowance: 0 }
      }).filter(m => m.pct > 0)
      if (newExtras[key][0]) newHeads[key] = newExtras[key][0].id
    })
    const emps = []
    if (lead.mode === 'independent' && lead.empId) {
      const boss = heads[unit.parent]
      const e = employees.find(x => x.id === lead.empId)
      if (e) emps.push({ id: e.id, dept: unit.key, position: lead.title || e.position, managerId: boss && boss !== e.id ? boss : e.managerId, ...(e.promotions ? { promotions: [...e.promotions, { date: HR_TODAY, note: `Bổ nhiệm ${lead.title || 'lãnh đạo'} — ${unit.name}` }] } : {}) })
    }
    const members = Object.entries(newExtras).flatMap(([k, arr]) => arr.map(m => ({ unit: k, ...m })))
    saveOrg({ units: newUnits.map(u => ({ ...u, headId: newHeads[u.key] ?? null })), employees: emps, members },
      `Đã thêm ${unit.label}` + (skipped.length ? ` — ${skipped.join(', ')} đã kiêm nhiệm tối đa 90%, chưa được gán` : ''), skipped.length ? 'danger' : 'success')
      .then(st => st && log('employees', 'create', `Cơ cấu tổ chức: thêm ${unit.type === 'subsidiary' ? 'công ty con' : 'phòng ban'} "${unit.label}"${boards.length ? ' + ' + boards.map(b => b.label).join(', ') : ''}`))
  }

  /* Kéo thả trên sơ đồ: chuyển đơn vị sang cấp quản lý mới; trưởng đơn vị báo cáo cho trưởng đơn vị mới */
  function moveUnit(key, newParent, isUndo) {
    const unit = units.find(u => u.key === key)
    // newParent: key đơn vị | MOTHER_KEY (trực thuộc công ty mẹ) | null (công ty thành viên độc lập)
    const target = newParent === HOLDING_KEY ? { label: `${HOLDING.name} (tập đoàn)` } : newParent === MOTHER_KEY ? { label: `${PARENT_COMPANY.name} (công ty mẹ)` } : !newParent ? { label: 'độc lập (không trực thuộc công ty mẹ)' } : units.find(u => u.key === newParent)
    if (!unit || !target) return
    const head = heads[key], boss = heads[newParent]
    saveOrg({ units: [{ key, parent: newParent || null }], employees: head && boss && head !== boss ? [{ id: head, managerId: boss }] : [] },
      isUndo ? `Đã hoàn tác: ${unit.label} về lại ${target.label}` : `Đã chuyển ${unit.label} sang ${target.label}`)
      .then(st => st && log('employees', 'edit', `Cơ cấu tổ chức: ${isUndo ? 'hoàn tác — ' : ''}chuyển "${unit.label}" về trực thuộc "${target.label}"`))
  }
  function deleteUnit(unit, memberCount, childCount) {
    if (memberCount || childCount) { toast(`Không thể xoá: ${unit.label} còn ${memberCount} nhân sự, ${childCount} đơn vị trực thuộc`, 'danger'); return }
    if (!confirm(`Xoá đơn vị "${unit.label}" khỏi cơ cấu tổ chức?`)) return
    saveOrg({ deleteUnits: [unit.key] }, `Đã xoá ${unit.label}`, 'danger').then(st => st && log('employees', 'delete', `Cơ cấu tổ chức: xoá đơn vị "${unit.label}"`))
  }

  function assignMembers(unit, ids, mode) {
    const names = ids.map(id => employees.find(e => e.id === id)?.name).filter(Boolean)
    let ops
    if (['board', 'governance'].includes(unit.type) || mode === 'conc') {
      // Mặc định 10% (không vượt quá phần còn lại — phòng ban chính giữ tối thiểu 10%)
      ops = { members: ids.filter(id => !(extraMembers[unit.key] || []).some(m => m.id === id)).map(id => {
        const used = concurrentOf(id).reduce((s, c) => s + c.pct, 0)
        return { unit: unit.key, id, pct: Math.max(0, Math.min(10, 90 - used)), title: 'Thành viên', allowance: 0 }
      }) }
    } else {
      const head = heads[unit.key]
      // Không gán trưởng đơn vị làm quản lý nếu người đó là cấp trên (trực tiếp/gián tiếp) của trưởng đơn vị — tránh vòng lặp
      const reportsTo = (id, boss) => { for (let cur = employees.find(x => x.id === id), n = 0; cur && n < 50; cur = employees.find(x => x.id === cur.managerId), n++) if (cur.managerId === boss) return true; return false }
      ops = { employees: employees.filter(e => ids.includes(e.id)).map(e => ({ id: e.id, dept: unit.key, managerId: head && head !== e.id && !reportsTo(head, e.id) ? head : e.managerId, ...(e.promotions ? { promotions: [...e.promotions, { date: HR_TODAY, note: `Điều chuyển sang ${unit.name}` }] } : {}) })) }
    }
    saveOrg(ops, `Đã thêm ${names.length} nhân sự vào ${unit.label}`).then(st => st && log('employees', 'edit', `${unit.label}: thêm ${names.join(', ')}`))
  }
  function removeExtra(unit, emp) {
    saveOrg({ deleteMembers: [{ unit: unit.key, id: emp.id }] }, `Đã gỡ ${emp.name} khỏi ${unit.label}`).then(st => st && log('employees', 'edit', `${unit.label}: gỡ ${emp.name}`))
  }

  /* Sửa tại chỗ (đang gõ) — ghi máy chủ khi rời ô (commitExtra) */
  function updateExtra(unit, empId, patch) {
    if (patch.pct != null) {
      const others = concurrentOf(empId).filter(c => c.unit.key !== unit.key).reduce((s, c) => s + c.pct, 0)
      const max = 90 - others
      if (patch.pct > max) { toast(`Tổng kiêm nhiệm tối đa 90% — phòng ban chính giữ ít nhất 10% (còn ${max}%)`, 'danger'); patch = { ...patch, pct: Math.max(0, max) } }
    }
    setExtraMembers(prev => ({ ...prev, [unit.key]: (prev[unit.key] || []).map(m => (m.id === empId ? { ...m, ...patch } : m)) }))
  }
  /* Ghi đè danh sách kiêm nhiệm của 1 nhân sự (sửa từ hồ sơ): gỡ khỏi các ban cũ, thêm vào các ban mới */
  function saveConcurrent(emp, list) {
    const desc = list.length ? list.map(c => `${units.find(u => u.key === c.unitKey)?.label} ${c.pct}% (${c.title})`).join(', ') : 'không kiêm nhiệm'
    const old = Object.entries(extraMembers).filter(([, arr]) => arr.some(m => m.id === emp.id)).map(([unit]) => ({ unit, id: emp.id }))
    saveOrg({ deleteMembers: old, members: list.map(c => ({ unit: c.unitKey, id: emp.id, pct: c.pct, title: c.title, allowance: c.allowance })) },
      `Đã cập nhật kiêm nhiệm của ${emp.name}`).then(st => st && log('employees', 'edit', `Phân bổ kiêm nhiệm ${emp.name}: ${desc}`))
  }
  function commitExtra(unit, emp) {
    const m = (extraMembers[unit.key] || []).find(x => x.id === emp.id)
    if (!m) return
    saveOrg({ members: [{ unit: unit.key, id: emp.id, pct: m.pct, title: m.title, allowance: m.allowance }] })
      .then(st => st && log('employees', 'edit', `Kiêm nhiệm ${unit.label} — ${emp.name}: ${m.title}, ${m.pct}%, phụ cấp ${Number(m.allowance || 0).toLocaleString('vi-VN')}đ`))
  }

  /* Ứng viên trúng tuyển → hồ sơ nhân viên thử việc */
  /* Mã NV kế tiếp + quản lý trực tiếp mặc định của một phòng ban (dùng cho bước Nhận việc) */
  const nextEmpCode = () => 'NV' + String(Math.max(0, ...employees.map(e => Number(e.code.slice(2)) || 0)) + 1).padStart(3, '0')
  const defaultManagerOf = dept => employees.find(e => e.id === heads[dept] && e.status !== 'left') || employees.find(e => e.dept === dept && ['Trưởng phòng', 'Giám đốc'].includes(e.level) && e.status !== 'left')
  /* Như bản gốc trả ngay {code}; hồ sơ tạo trên máy chủ (kèm candidateId: máy chủ đánh dấu ứng viên đã nhận việc) */
  function hireCandidate(c, job, opt = {}) {
    const code = opt.code || nextEmpCode()
    job = { ...job, dept: opt.dept || job.dept, title: opt.position || job.title, site: opt.site || job.site }
    const joinDate = opt.joinDate || addDaysIso(MONTHS[0].key + '-01', 31).slice(0, 8) + '01'
    const endProbation = (() => { const d = new Date(joinDate); d.setMonth(d.getMonth() + (opt.probationMonths || 2)); return d.toISOString().slice(0, 10) })()
    const manager = opt.managerId ? employees.find(e => e.id === Number(opt.managerId)) : defaultManagerOf(job.dept)
    const salary = opt.salary || (Number(((job.salary || '').match(/\d+/) || [12])[0]) || 12) * 1000000
    const rec = {
      ...JSON.parse(JSON.stringify(EMPTY_EMPLOYEE)), code, candidateId: c.id, name: c.name, email: c.email, phone: c.phone, dept: job.dept, position: job.title,
      site: job.site, joinDate, status: 'probation', contractType: 'Thử việc', salary, managerId: manager?.id ?? null, level: opt.level || 'Nhân viên',
      contracts: [{ no: `HĐTV-${code}`, type: 'Thử việc', start: joinDate, end: endProbation, salary: Math.round(salary * (opt.probationRate || 85) / 100), status: 'active' }],
      promotions: [{ date: joinDate, note: `Gia nhập — ${job.title} (tuyển dụng từ ${c.source})` }],
      // hồ sơ đầy đủ nhập ở trang Nhận việc (cá nhân, liên hệ, BHXH, thuế, học vấn, giấy tờ đính kèm); CV giữ cùng giấy tờ
      ...(opt.record || {}),
      attachments: [{ name: c.cv }, ...(opt.record?.attachments || [])],
    }
    // xếp hàng trước lệnh ghi tuyển dụng của trang Nhận việc (ứng viên -> đã nhận việc); ứng viên vừa tạo: dùng mã máy chủ
    enqueue(() => save(hrApi.createEmployee({ ...rec, candidateId: recIds.current['cand' + c.id] ?? c.id })).then(st => {
      if (st) {
        setDefaultSchedule(st.id, job.site)
        setPerf(p => ({ ...p, enroll: { ...p.enroll, [st.id]: { 4: 0, ...(job.dept === 'thicong' ? { 1: 0 } : {}) } } }))
      }
      return reloadTalent()
    }))
    log('recruit', 'approve', `Nhận việc ${c.name} → tạo hồ sơ ${code} · ${deptOf(job.dept).name} (thử việc từ ${joinDate.split('-').reverse().join('/')})`)
    toast(`Đã tạo hồ sơ ${code} cho ${c.name} — ${deptOf(job.dept).name} · đã ghi danh khoá hội nhập`)
    return { code }
  }
  const openEmployee = id => { setOpenEmp(id); setModule('employees') }

  const current = MODULES.find(m => m.key === module)
  const allowed = m => !m.perm || access.can(m.perm, 'view')

  /* Hàng phân hệ trên header: tự thu gọn theo chỗ trống thật (không cắt mất tab cuối) */
  const modNavRef = useRef(null)
  const [navFit, setNavFit] = useState(0)
  const [navTick, setNavTick] = useState(0)
  useLayoutEffect(() => {
    const n = modNavRef.current
    if (n && navFit < 3 && n.scrollWidth > n.clientWidth + 1) setNavFit(f => f + 1)
  }, [navFit, navTick])
  useEffect(() => {
    const n = modNavRef.current
    if (!n) return undefined
    let w = 0
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw !== w) { w = cw; setNavFit(0); setNavTick(t => t + 1) } })
    ro.observe(n.parentElement)
    // phông chữ tải xong làm chữ rộng ra → đo lại
    document.fonts?.ready.then(() => { setNavFit(0); setNavTick(t => t + 1) })
    return () => ro.disconnect()
  }, [])

  return (
    <AccessContext.Provider value={access}>
      <div
        className={`cc-page${aiOpen ? ' cc-ai-open' : ''}${aiResizing ? ' cc-ai-resizing' : ''}`}
        style={{ '--ai-panel-width': `${aiWidth}px` }}
      >
        <div className={`cc-header fit-${navFit}`}>
          <div className="cc-header-icon"><Icon name="users" size={16} /></div>
          <span className="cc-header-title">Nhân sự (HR)</span>
          <nav className="hdr-tabs cc-hdr-mods" aria-label="Phân hệ HR" ref={modNavRef}>
            {MODULES.map(m => (
              <button key={m.key} className={`cc-mod${module === m.key ? ' active' : ''}${allowed(m) ? '' : ' locked'}`} onClick={() => setModule(m.key)} title={allowed(m) ? '' : 'Vai trò hiện tại không có quyền'}>
                <Icon name={allowed(m) ? m.icon : 'lock'} size={15} /><span className="cc-mod-full">{m.label}</span><span className="cc-mod-short">{m.short || m.label}</span>
                {m.key === 'attendance' && pending > 0 && access.can('attendance', 'approve') && <span className="cc-mod-badge">{pending}</span>}
              </button>
            ))}
          </nav>
          <label className={`cc-role-switch cc-tone-${ROLES[role].tone}`} title={sys ? `${user.name} — mô phỏng đăng nhập với vai trò khác` : `${user.name} — vai trò HR của tài khoản`}>
            <Icon name="shield" size={14} />
            <span className="cc-role-who">{user.name}</span>
            <select value={role} onChange={e => switchRole(e.target.value)} aria-label="Vai trò" disabled={!sys}>
              {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
          </label>
          <Link to="/cham-cong-mobile" className="cc-mobile-link" title="Giao diện Mobile"><Icon name="smartphone" size={13} />Mobile</Link>
          <button className="cc-theme-toggle" title="Chuyển giao diện sáng/tối" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>

        <div className="cc-body">
          {loadState !== 'ok' ? (
            <div className="cc-card cc-noaccess">
              <b>{loadState === 'loading' ? 'Đang tải dữ liệu HR…' : 'Không tải được dữ liệu HR'}</b>
              {loadState !== 'loading' && <><span>{loadState}</span><button className="cc-btn" onClick={reload}>Thử lại</button></>}
            </div>
          ) : current.perm && !allowed(current) ? <NoAccess /> : <>
            {module === 'employees' && (
              <EmployeesModule
                employees={scoped} openId={openEmp} onOpen={setOpenEmp} concurrentOf={concurrentOf}
                boardUnits={units.filter(u => u.type !== 'exec')} onSaveConcurrent={saveConcurrent} payOf={payOf}
                onAdd={() => setForm({ open: true, emp: null })} onEdit={emp => setForm({ open: true, emp })}
                onDelete={deleteEmployee} onOffboard={offboard}
              />
            )}
            {module === 'org' && <OrgChart employees={employees} units={units} heads={heads} extraMembers={extraMembers} onSaveUnit={saveUnit} onDeleteUnit={deleteUnit} onAssign={assignMembers} onRemoveExtra={removeExtra} onMoveUnit={moveUnit} onCreateUnit={createUnit} onUpdateExtra={updateExtra} onCommitExtra={commitExtra} onOpen={id => { if (access.inScope(employees.find(e => e.id === id))) { setOpenEmp(id); setModule('employees') } else toast('Bạn chỉ xem được hồ sơ trong phạm vi được phân quyền', 'danger') }} />}
            {module === 'attendance' && (
              <div className="cc-stack">
                <Seg value={attTab} onChange={setAttTab} options={ATT_TABS.map(t => (t.value === 'requests' ? { ...t, count: pending || undefined } : t))} />
                {attTab === 'today' && <AttendanceToday employees={scoped} logs={att.today} setLogs={setLogs} shifts={att.shifts} schedule={att.schedule} toast={toast} meId={user.id} />}
                {attTab === 'shifts' && <ShiftSchedule employees={scoped} shifts={att.shifts} setShifts={setShifts} schedule={att.schedule} setSchedule={setSchedule} toast={toast} />}
                {attTab === 'requests' && <LeaveRequests employees={scoped} requests={att.requests} setRequests={setRequests} toast={toast} />}
                {attTab === 'monthly' && <MonthlySummary employees={scoped} toast={toast} locked={locked} setLocked={setLocked} />}
              </div>
            )}
            {module === 'payroll' && <PayrollModule employees={scoped} units={units} concurrentOf={concurrentOf} payroll={payroll} setPayroll={setPayroll} toast={toast} maskDefault={security.settings.maskSalary.value} />}
            {module === 'recruit' && <RecruitModule recruit={recruit} setRecruit={setRecruit} onHire={hireCandidate} toast={toast} nextEmpCode={nextEmpCode} defaultManagerOf={defaultManagerOf} employees={employees} onOpenEmployee={openEmployee} />}
            {module === 'performance' && <PerformanceModule employees={employees} perf={perf} setPerf={setPerf} toast={toast} />}
            {module === 'security' && <SecurityModule employees={employees} security={security} setSecurity={setSecurity} audit={audit} toast={toast} />}
            {module === 'admin' && <div className="cc-legacy"><HanhChinhTab /></div>}
          </>}
        </div>

        <EmployeeForm open={form.open} employee={form.emp} employees={employees} onClose={() => setForm({ open: false, emp: null })} onSave={saveEmployee} />
        {toastNode}

        <Dezbot
          open={aiOpen}
          onToggle={() => setAiOpen(o => !o)}
          onClose={() => setAiOpen(false)}
          onResize={setAiWidth}
          onResizingChange={setAiResizing}
        />
      </div>
    </AccessContext.Provider>
  )
}
