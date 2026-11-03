import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './ChamCong.css'
import './hr/hr.css'
import { useTheme } from '../../hooks/useTheme'
import Icon from '../../components/ui/Icon'
import {
  INITIAL_SHIFTS, initialSchedule, syncAttendance, syncSites, reqStatus, HR_TODAY, addDaysIso, EMPTY_EMPLOYEE,
  INITIAL_ORG_UNITS, syncDepts, syncCompanyName, deptOf, monthlySummary, MONTHS, MOTHER_KEY, PARENT_COMPANY, HOLDING, HOLDING_KEY } from '../../data/hrData'
import {
  ROLES, DEFAULT_PAYROLL_CONFIG,
  REVIEW_PERIOD, COURSES as COURSE_TEMPLATES, LEARNING_PATHS as PATH_TEMPLATES,
} from '../../data/hrData2'
import EmployeesModule from './hr/EmployeesModule'
import EmployeeForm from './hr/EmployeeForm'
import OrgChart from './hr/OrgChart'
import AttendanceToday from './hr/AttendanceToday'
import ShiftSchedule from './hr/ShiftSchedule'
import LeaveRequests from './hr/LeaveRequests'
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
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })

/* Hồ sơ nhân sự, cơ cấu tổ chức, kiêm nhiệm, chấm công & phép, lương, tuyển dụng, hiệu suất & đào tạo lưu trên máy chủ
   (api.js, quyền tab "hr"), kể cả phân quyền theo vai trò HR của tài khoản (máy chủ kiểm quyền + lọc theo phạm vi). */
export default function ChamCong() {
  return <WorkGate tab="hr" title="Nhân sự (HR)"><ChamCongPage /></WorkGate>
}

function ChamCongPage() {
  const { theme, toggleTheme } = useTheme()
  const session = useWorkSession()
  const [module, setModule] = useState(initialModule)
  const [attTab, setAttTab] = useState('today')
  const [toastNode, toast] = useToast()

  // Vai trò / quyền / phạm vi HR của tài khoản đang đăng nhập, do máy chủ tính (GET /hr -> me)
  const [hrMe, setHrMe] = useState({ role: 'employee', scope: 'self', employeeId: null, perms: {}, maskSalary: true })

  const [employees, setEmployees] = useState([])
  const [units, setUnits] = useState([])
  const [heads, setHeads] = useState({})
  // Thành viên kiêm nhiệm của HĐQT & các ban (không đổi phòng ban trong hồ sơ): { unitKey: [{ id, pct, title, allowance }] }
  // pct: tỉ lệ thời gian/công việc dành cho ban (trừ vào phòng ban chính) · allowance: phụ cấp kiêm nhiệm / tháng
  const [extraMembers, setExtraMembers] = useState({})
  const [loadState, setLoadState] = useState('loading')
  /* Danh sách kiêm nhiệm của 1 nhân sự: [{ unit, pct, title, allowance }] — phòng ban chính giữ phần còn lại (tối thiểu 10%) */
  const concurrentOf = useCallback(empId => units
    .filter(u => (extraMembers[u.key] || []).some(m => m.id === empId))
    .map(u => ({ unit: u, ...(extraMembers[u.key].find(m => m.id === empId)) })), [units, extraMembers])
  syncDepts(units) // danh sách phòng ban dùng chung luôn khớp với cơ cấu đang thiết lập
  syncCompanyName(session.congTy?.ten) // nút công ty mẹ trên sơ đồ mang tên công ty thật
  const [openEmp, setOpenEmp] = useState(null)
  const [form, setForm] = useState({ open: false, emp: null })
  // Chấm công & phép từ máy chủ: { shifts, schedule: {empId: [7 mã ca | 'off']}, logs (3 tháng gần nhất), requests }
  const [att, setAtt] = useState({ shifts: [], schedule: {}, overrides: {}, logs: [], requests: [] })
  syncAttendance(att) // monthlySummary (Tổng hợp công, Lương) tính trên dữ liệu đang tải
  syncSites(att.sites || []) // ô chọn nơi làm việc, GPS, phụ cấp công trường
  // Lương từ máy chủ: { config (chưa lưu = mặc định), adjustments {tháng: {empId: [...]}}, runs {tháng: {status, closed, payslips}}, fixed {unitKey: {fund, items}} }
  const [payroll, setPayroll] = useState({ config: DEFAULT_PAYROLL_CONFIG, adjustments: {}, fixed: {}, runs: {} })
  // Tuyển dụng + hiệu suất từ máy chủ (GET /hr/talent); perf.reviewsAll = {kỳ: {empId: đánh giá}}
  const [recruit, setRecruit] = useState({ jobs: [], jds: [], candidates: [], interviews: [] })
  const [perf, setPerf] = useState({ okrs: [], reviewsAll: {}, enroll: {}, courses: [], paths: [] })

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

  /* Dữ liệu từ máy chủ thay state; lịch làm việc mẫu sinh cho người chưa có lịch (chấm công chưa lưu máy chủ) */
  function apply(st) {
    if (st.me) setHrMe(st.me)
    setEmployees(st.employees || [])
    setUnits(st.units || [])
    setHeads(st.heads || {})
    setExtraMembers(st.members || {})
  }
  // 3 tháng gần nhất + 9 tuần tới (lịch riêng từng ngày xếp trước)
  const attRange = [MONTHS[MONTHS.length - 1].key + '-01', addDaysIso(HR_TODAY, 63)]
  const loadAtt = () => hrApi.loadAttendance(...attRange).then(setAtt)
  function reload() {
    setLoadState('loading')
    // phân hệ vai trò không được xem (máy chủ trả 403) -> để trống, không chặn cả trang
    const opt = p => p.catch(e => (e && e.forbidden ? null : Promise.reject(e)))
    Promise.all([hrApi.load(), opt(hrApi.loadAttendance(...attRange)), opt(hrApi.loadPayroll()), opt(hrApi.loadTalent())])
      .then(([st, a, pr, tl]) => {
        apply(st)
        if (a) setAtt(a)
        if (pr) applyPay(pr)
        if (tl) applyTalent(tl)
        setLoadState('ok')
      }, e => setLoadState(e.message || 'Lỗi tải dữ liệu'))
  }
  /* Lệnh ghi chấm công: ghi xong đọc lại dữ liệu chấm công; trả true / false */
  const applyPay = pr => setPayroll({ ...pr, config: { ...DEFAULT_PAYROLL_CONFIG, ...(pr.config || {}) } })
  /* Lệnh ghi lương: ghi xong đọc lại; trả true / false */
  function savePay(promise, okMsg, tone) {
    return promise.then(() => hrApi.loadPayroll().then(applyPay)).then(() => { if (okMsg) toast(okMsg, tone); return true },
      e => { toast(e.message || 'Lỗi lưu dữ liệu', 'danger'); return false })
  }
  /* Ô cấu hình / định phí đổi theo từng phím: cập nhật ngay trên trang, ghi máy chủ sau 0,7 giây ngừng gõ (không đọc lại để khỏi nhảy ô) */
  const typing = useRef({})
  const later = (key, fn) => { clearTimeout(typing.current[key]); typing.current[key] = setTimeout(fn, 700) }
  const quiet = promise => promise.catch(e => toast(e.message || 'Lỗi lưu dữ liệu', 'danger'))
  const pay = {
    addAdj: (empId, month, a) => savePay(hrApi.addAdjustment({ empId, month, ...a })),
    removeAdj: id => savePay(hrApi.deleteAdjustment(id)),
    run: (month, action, payslips, okMsg) => savePay(hrApi.runAction({ month, action, ...(payslips ? { payslips } : {}) }), okMsg),
    setCfg: patch => {
      const config = { ...payroll.config, ...patch }
      setPayroll(p => ({ ...p, config }))
      later('cfg', () => quiet(hrApi.savePayrollConfig(config)))
    },
    setFixed: (key, val) => {
      setPayroll(p => ({ ...p, fixed: { ...p.fixed, [key]: val } }))
      later('fx:' + key, () => quiet(hrApi.saveBudget({ unit: key, fund: Number(val.fund) || 0, items: val.items || [] })))
    },
  }
  const applyTalent = tl => {
    setRecruit({ jds: tl.jds, jobs: tl.jobs, candidates: tl.candidates, interviews: tl.interviews })
    setPerf({ okrs: tl.okrs, reviewsAll: tl.reviews, enroll: tl.enroll, courses: tl.courses, paths: tl.paths })
  }
  /* Lệnh ghi tuyển dụng / hiệu suất: ghi xong đọc lại; trả kết quả của lệnh ({ok, id?}) hoặc null khi lỗi */
  function saveTal(promise, okMsg, tone) {
    return promise.then(r => hrApi.loadTalent().then(applyTalent).then(() => { if (okMsg) toast(okMsg, tone); return r || {} }),
      e => { toast(e.message || 'Lỗi lưu dữ liệu', 'danger'); return null })
  }
  const tal = {
    saveJd: (jd, msg) => saveTal(hrApi.saveJd(jd), msg),
    deleteJd: (id, msg) => saveTal(hrApi.deleteJd(id), msg, 'danger'),
    saveJob: (job, msg) => saveTal(hrApi.saveJob(job), msg),
    addCand: (c, msg) => saveTal(hrApi.createCandidate(c), msg),
    updCand: (id, patch, msg) => saveTal(hrApi.updateCandidate(id, patch), msg),
    createOkr: (o, msg) => saveTal(hrApi.createOkr(o), msg),
    // ô số / thanh trượt: đổi ngay trên trang, ghi máy chủ khi ngừng gõ
    setKr: (oid, krId, current) => {
      setPerf(p => ({ ...p, okrs: p.okrs.map(o => (o.id === oid ? { ...o, krs: o.krs.map(k => (k.id === krId ? { ...k, current } : k)) } : o)) }))
      later('kr:' + oid + ':' + krId, () => quiet(hrApi.setKr(oid, krId, current)))
    },
    review: (r, msg) => saveTal(hrApi.reviewAction({ period: REVIEW_PERIOD, ...r }), msg),
    saveCourse: (c, msg) => saveTal(hrApi.saveCourse(c), msg),
    deleteCourse: (id, msg) => saveTal(hrApi.deleteCourse(id), msg, 'danger'),
    savePath: (p, msg) => saveTal(hrApi.savePath(p), msg),
    deletePath: (id, msg) => saveTal(hrApi.deletePath(id), msg, 'danger'),
    /* Danh mục mẫu (COURSES, LEARNING_PATHS của hrData2): tạo khoá trước, đổi mã mẫu -> id thật rồi tạo lộ trình */
    seedCatalog: async () => {
      const run = async () => {
        const idOf = {}
        for (const { id, ...c } of COURSE_TEMPLATES) idOf[id] = (await hrApi.saveCourse(c)).id
        for (const { id: _p, courses, ...p } of PATH_TEMPLATES) await hrApi.savePath({ ...p, courses: courses.map(c => idOf[c]) })
        return {}
      }
      // lỗi giữa chừng: báo lỗi và vẫn tải lại để thấy phần đã tạo
      return saveTal(run(), `Đã tạo ${COURSE_TEMPLATES.length} khoá học và ${PATH_TEMPLATES.length} lộ trình mẫu`).then(r => r || hrApi.loadTalent().then(applyTalent))
    },
    enroll: (empId, courses, msg) => saveTal(hrApi.enroll(empId, courses), msg),
    setProgress: (empId, courseId, pct) => {
      setPerf(p => ({ ...p, enroll: { ...p.enroll, [empId]: { ...(p.enroll[empId] || {}), [courseId]: pct } } }))
      later('en:' + empId + ':' + courseId, () => quiet(hrApi.enroll(empId, { [courseId]: pct })))
    },
  }
  function saveAtt(promise, okMsg, tone) {
    return promise.then(loadAtt).then(() => { if (okMsg) toast(okMsg, tone); return true },
      e => { toast(e.message || 'Lỗi lưu dữ liệu', 'danger'); return false })
  }
  /* Lịch mẫu cho nhân sự mới, chỉ khi công ty đã có các ca dùng trong lịch mẫu */
  function defaultSchedule(emp) {
    const row = initialSchedule([emp])[emp.id]
    if (row && row.some(c => c !== 'off') && row.every(c => c === 'off' || att.shifts.some(s => s.id === c))) saveAtt(hrApi.saveShifts({ schedule: { [emp.id]: row } }))
  }
  const seedShifts = () => saveAtt(hrApi.saveShifts({ shifts: INITIAL_SHIFTS, schedule: initialSchedule(employees) }), `Đã tạo ${INITIAL_SHIFTS.length} ca mẫu và lịch tuần cho nhân sự`)
  /* Chấm công hôm nay + nghỉ phép đã duyệt (hiện "Nghỉ phép" thay vì "Chưa chấm công") */
  const todayLogs = useMemo(() => {
    const out = att.logs.filter(l => l.date === HR_TODAY)
    att.requests.filter(r => r.type === 'leave' && reqStatus(r) === 'approved' && r.from <= HR_TODAY && HR_TODAY <= r.to && !out.some(l => l.empId === r.empId && l.in))
      .forEach(r => out.push({ empId: r.empId, in: null, out: null, source: null, gps: null, leave: r.title.split(' — ')[0] }))
    return out
  }, [att])
  useEffect(reload, [])

  /* ---------- Phân quyền: máy chủ kiểm quyền và chỉ trả dữ liệu trong phạm vi; giao diện ẩn nút theo hrMe.perms ---------- */
  const me = session.me || {}
  const fallbackUser = useMemo(() => ({ ...EMPTY_EMPLOYEE, id: 0, code: '', name: me.hoTen || me.username || 'Tôi', dept: '' }), [me.hoTen, me.username])
  // hồ sơ gắn với tài khoản; admin công ty chưa gắn hồ sơ -> tên đăng nhập (id 0)
  const user = employees.find(e => e.id === hrMe.employeeId) || fallbackUser
  const role = hrMe.role
  const log = useCallback(() => {}, []) // nhật ký ghi ở máy chủ (audit_logs) khi lệnh thành công
  const access = useMemo(() => {
    const can = (mod, action) => (hrMe.perms[mod] || []).includes(action)
    return {
      role, user, log, can,
      // thao tác cấp công ty (máy chủ: gateAll / needAll) - chỉ phạm vi toàn công ty
      canAll: (mod, action) => can(mod, action) && hrMe.scope === 'all',
      // bước đơn đang chờ: bước quản lý = đúng quản lý ghi trên bước (System Admin làm thay), bước HR = phạm vi toàn công ty
      canDecide: r => {
        const st = r.steps.find(s => s.state === 'active')
        if (!st || !can('attendance', 'approve') || r.empId === user.id) return false
        return st.role === 'Quản lý trực tiếp' ? role === 'sysadmin' || st.empId === user.id : hrMe.scope === 'all'
      },
      inScope: makeScope(hrMe.scope, user),
    }
  }, [hrMe, role, user, log])
  const scoped = employees.filter(access.inScope)

  const pending = att.requests.filter(r => reqStatus(r) === 'pending' && access.canDecide(r)).length

  /* ---------- Ghi lên máy chủ: mỗi lệnh trả lại toàn bộ dữ liệu HR (api.js) ---------- */
  function save(promise, okMsg, tone) {
    return promise.then(st => { apply(st); if (okMsg) toast(okMsg, tone); return st },
      e => { toast(e.message || 'Lỗi lưu dữ liệu', 'danger'); throw e })
  }
  const saveOrg = (ops, okMsg, tone) => save(hrApi.saveOrg(ops), okMsg, tone).catch(() => null)
  /* Kiêm nhiệm hiện có của 1 người -> lệnh gỡ (dùng khi ghi đè danh sách) */
  const membersOf = empId => Object.entries(extraMembers).filter(([, arr]) => arr.some(m => m.id === empId)).map(([unit]) => ({ unit, id: empId }))

  /* ---------- CRUD hồ sơ ---------- */
  function saveEmployee(data) {
    if (data.id) {
      save(hrApi.updateEmployee(data.id, data), `Đã cập nhật hồ sơ ${data.name}`).then(() => {
        log('employees', 'edit', `Hồ sơ ${data.name}`)
        setForm({ open: false, emp: null })
      }, () => {})
      return
    }
    const rec = {
      ...data,
      contracts: data.contracts.length ? data.contracts : [{ no: `HĐ-${data.code}`, type: data.contractType, start: data.joinDate, end: null, salary: data.salary || 0, status: 'active' }],
      promotions: [{ date: data.joinDate, note: 'Gia nhập — ' + data.position }],
    }
    save(hrApi.createEmployee(rec), `Đã tạo hồ sơ ${data.name}`).then(st => {
      defaultSchedule({ ...rec, id: st.id })
      setOpenEmp(st.id)
      log('employees', 'create', `Hồ sơ ${data.name} (${data.code})`)
      setForm({ open: false, emp: null })
    }, () => {})
  }
  function deleteEmployee(emp) {
    const reports = employees.filter(e => e.managerId === emp.id)
    if (!confirm(`Xoá vĩnh viễn hồ sơ ${emp.name}?${reports.length ? `\n${reports.length} nhân sự cấp dưới sẽ được chuyển cho quản lý cấp trên.` : ''}\nNên dùng "Cho nghỉ việc" nếu cần giữ lại lịch sử.`)) return
    save(hrApi.deleteEmployee(emp.id), `Đã xoá hồ sơ ${emp.name}`, 'danger').then(() => {
      if (openEmp === emp.id) setOpenEmp(null)
      log('employees', 'delete', `Hồ sơ ${emp.name} (${emp.code})`)
    }, () => {})
  }
  function offboard(emp) {
    const d = prompt(`Ngày nghỉ việc của ${emp.name} (YYYY-MM-DD):`, today)
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    // máy chủ chuyển cấp dưới cho quản lý cấp trên
    const patch = { status: 'left', leaveDate: d, contracts: (emp.contracts || []).map(c => (c.status === 'active' ? { ...c, status: 'expired', end: c.end || d } : c)), promotions: [...(emp.promotions || []), { date: d, note: 'Nghỉ việc' }] }
    save(hrApi.updateEmployee(emp.id, patch), `${emp.name} đã được chuyển sang "Đã nghỉ việc"`).then(() => log('employees', 'edit', `Cho nghỉ việc ${emp.name} từ ${d}`), () => {})
  }
  /* Cơ cấu mẫu cho công ty chưa có đơn vị nào (bỏ các công ty con minh hoạ của tập đoàn) */
  function seedUnits() {
    const units = INITIAL_ORG_UNITS.filter(u => u.type !== 'subsidiary' && !['__holding', '__mother'].includes(u.parent) && !INITIAL_ORG_UNITS.some(p => p.key === u.parent && p.type === 'subsidiary'))
    saveOrg({ units }, `Đã tạo ${units.length} đơn vị theo cơ cấu mẫu`)
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
      if (e) emps.push({ id: e.id, dept: unit.key, position: lead.title || e.position, managerId: boss && boss !== e.id ? boss : e.managerId, promotions: [...(e.promotions || []), { date: today, note: `Bổ nhiệm ${lead.title || 'lãnh đạo'} — ${unit.name}` }] })
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
      ops = { employees: employees.filter(e => ids.includes(e.id)).map(e => ({ id: e.id, dept: unit.key, managerId: head && head !== e.id && !reportsTo(head, e.id) ? head : e.managerId, promotions: [...(e.promotions || []), { date: today, note: `Điều chuyển sang ${unit.name}` }] })) }
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
    saveOrg({ deleteMembers: membersOf(emp.id), members: list.map(c => ({ unit: c.unitKey, id: emp.id, pct: c.pct, title: c.title, allowance: c.allowance })) },
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
  const nextEmpCode = () => 'NV' + String(Math.max(0, ...employees.map(e => Number(String(e.code).slice(2)) || 0)) + 1).padStart(3, '0')
  const defaultManagerOf = dept => employees.find(e => e.id === heads[dept] && e.status !== 'left') || employees.find(e => e.dept === dept && ['Trưởng phòng', 'Giám đốc'].includes(e.level) && e.status !== 'left')
  /* Trả Promise {id, code}; lỗi thì đã báo toast và ném lại để trang Nhận việc giữ nguyên form */
  async function hireCandidate(c, job, opt = {}) {
    const code = opt.code || nextEmpCode()
    job = { ...job, dept: opt.dept || job.dept, title: opt.position || job.title, site: opt.site || job.site }
    const joinDate = opt.joinDate || today
    const endProbation = (() => { const d = new Date(joinDate); d.setMonth(d.getMonth() + (opt.probationMonths || 2)); return d.toISOString().slice(0, 10) })()
    const manager = opt.managerId ? employees.find(e => e.id === Number(opt.managerId)) : defaultManagerOf(job.dept)
    const salary = opt.salary || (Number(((job.salary || '').match(/\d+/) || [12])[0]) || 12) * 1000000
    const rec = {
      ...JSON.parse(JSON.stringify(EMPTY_EMPLOYEE)), code, candidateId: c.id, // máy chủ đánh dấu ứng viên đã nhận việc cùng transaction name: c.name, email: c.email, phone: c.phone, dept: job.dept, position: job.title,
      site: job.site, joinDate, status: 'probation', contractType: 'Thử việc', salary, managerId: manager?.id ?? null, level: opt.level || 'Nhân viên',
      contracts: [{ no: `HĐTV-${code}`, type: 'Thử việc', start: joinDate, end: endProbation, salary: Math.round(salary * (opt.probationRate || 85) / 100), status: 'active' }],
      promotions: [{ date: joinDate, note: `Gia nhập — ${job.title} (tuyển dụng từ ${c.source})` }],
      attachments: [{ name: c.cv, ...(c.cvUrl ? { url: c.cvUrl } : {}) }],
      // hồ sơ đầy đủ nhập ở trang Nhận việc (cá nhân, liên hệ, BHXH, thuế, học vấn, giấy tờ đính kèm)
      ...(opt.record || {}),
    }
    const st = await save(hrApi.createEmployee(rec), `Đã tạo hồ sơ ${code} cho ${c.name} — ${deptOf(job.dept).name}`)
    const id = st.id
    hrApi.loadTalent().then(applyTalent) // ứng viên đã chuyển sang Nhận việc
    defaultSchedule({ ...rec, id })
    const must = perf.courses.filter(c => c.mandatory) // ghi danh các khoá bắt buộc của công ty
    if (must.length) tal.enroll(id, Object.fromEntries(must.map(c => [c.id, 0])))
    log('recruit', 'approve', `Nhận việc ${c.name} → tạo hồ sơ ${code} · ${deptOf(job.dept).name} (thử việc từ ${joinDate.split('-').reverse().join('/')})`)
    return { id, code }
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
                {m.key === 'attendance' && pending > 0 && <span className="cc-mod-badge">{pending}</span>}
              </button>
            ))}
          </nav>
          <span className={`cc-role-switch cc-tone-${ROLES[role]?.tone || 'muted'}`} title={`${user.name} — vai trò HR (đổi ở Phân quyền & bảo mật)`}>
            <Icon name="shield" size={14} />
            <span className="cc-role-who">{user.name}</span>
            <b>{ROLES[role]?.label || role}</b>
          </span>
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
          ) : !units.length && ['employees', 'org'].includes(module) ? (
            <div className="cc-card cc-noaccess">
              <b>Công ty chưa có cơ cấu tổ chức</b>
              <span>Hồ sơ nhân sự cần phòng ban. Tạo nhanh theo cơ cấu mẫu (HĐQT, CEO, các khối và phòng ban) rồi chỉnh lại ở Sơ đồ tổ chức.</span>
              {access.canAll('employees', 'edit') && <button className="cc-btn" onClick={seedUnits}><Icon name="sitemap" size={14} />Khởi tạo cơ cấu mẫu</button>}
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
                {!att.shifts.length && attTab !== 'requests' && (
                  <div className="cc-card cc-noaccess">
                    <b>Công ty chưa có ca làm việc</b>
                    <span>Bảng công cần ca và lịch tuần. Tạo nhanh 4 ca mẫu (Hành chính, Công trường, Ca sáng, Ca tối) và lịch tuần cho nhân sự hiện có, rồi chỉnh lại ở "Ca & lịch làm việc".</span>
                    {access.canAll('attendance', 'edit') && <button className="cc-btn" onClick={seedShifts}><Icon name="clock" size={14} />Khởi tạo ca & lịch mẫu</button>}
                  </div>
                )}
                {attTab === 'today' && <AttendanceToday employees={scoped} logs={todayLogs} onSaveLogs={(list, msg) => saveAtt(hrApi.saveLogs(list), msg)} shifts={att.shifts} schedule={att.schedule} overrides={att.overrides} toast={toast} meId={hrMe.employeeId} />}
                {attTab === 'shifts' && <ShiftSchedule employees={scoped} shifts={att.shifts} schedule={att.schedule} overrides={att.overrides} sites={att.sites || []} onSave={(ops, msg) => saveAtt(hrApi.saveShifts(ops), msg)} />}
                {attTab === 'requests' && <LeaveRequests employees={scoped} requests={att.requests} toast={toast}
                  onCreate={r => saveAtt(hrApi.createRequest(r), 'Đã tạo đơn')} onDecide={(r, approve, note, msg) => saveAtt(hrApi.decideRequest(r.id, approve, note), msg, approve ? 'success' : 'danger')} />}
                {attTab === 'monthly' && <MonthlySummary employees={scoped} closedMonths={att.closedMonths || {}} onRun={pay.run} />}
              </div>
            )}
            {module === 'payroll' && <PayrollModule employees={scoped} units={units} concurrentOf={concurrentOf} payroll={payroll} pay={pay} maskDefault={hrMe.maskSalary} />}
            {module === 'recruit' && <RecruitModule recruit={recruit} tal={tal} onHire={hireCandidate} toast={toast} nextEmpCode={nextEmpCode} defaultManagerOf={defaultManagerOf} employees={employees} onOpenEmployee={openEmployee} />}
            {module === 'performance' && <PerformanceModule employees={employees} perf={perf} tal={tal} />}
            {module === 'security' && <SecurityModule employees={employees} toast={toast} onReloadHr={() => hrApi.load().then(apply)} />}
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
