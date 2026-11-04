#!/usr/bin/env node
/* Nạp dữ liệu thử tab HR (/cham-cong) cho công ty "Dezon Demo" trên database test, HOÀN TOÀN qua HTTP API của bản Go
   (nạp qua API thật = kiểm luôn API; lỗi API in ra cuối, không lách bằng SQL). Giữ nguyên sơ đồ tổ chức + hồ sơ nhân sự đang có.
   Ngày tính theo hôm nay thật (giờ VN): chấm công từ ngày 1 tháng trước tới hôm nay, kỳ lương tháng trước đã chi trả, tháng này nháp.
   Chạy lại: docker exec -i dezon-pro-db psql -U qspro -d qspro_gotest -v ON_ERROR_STOP=1 < infra/scripts/reset-demo-4tab.sql
             API=http://localhost:3100 node infra/scripts/seed-test-hr.mjs
   Tài khoản: DEMO_LOGIN_USER / DEMO_LOGIN_PASSWORD trong backend/.env.test-login; chỉ nhận tài khoản bắt đầu bằng zz_.
   Đã có dữ liệu HR (ca, chấm công, đơn, lương, tuyển dụng, OKR, khoá học) -> cảnh báo và dừng (không gọi /hr/reset: nó xoá cả sơ đồ tổ chức). */
import { readFileSync } from 'node:fs'
import { syncAttendance, syncDepts, monthlySummary, weekdayIdx, addDaysIso } from '../../frontend/src/data/hrData.js'
import { DEFAULT_PERMS, DEFAULT_PAYROLL_CONFIG, SECURITY_SETTINGS, INITIAL_FIXED_COSTS, PERIODS } from '../../frontend/src/data/hrData2.js'

const API = (process.env.API || 'http://localhost:3100').replace(/\/$/, '')
const env = Object.fromEntries(readFileSync(new URL('../../backend/.env.test-login', import.meta.url), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]))
const USER = env.DEMO_LOGIN_USER, PASS = env.DEMO_LOGIN_PASSWORD
if (!USER || !USER.startsWith('zz_')) { console.error('Từ chối: DEMO_LOGIN_USER phải bắt đầu bằng zz_ (tài khoản thử)'); process.exit(1) }

/* ---------- HTTP: lỗi API ghi lại (endpoint, payload, lỗi) và đi tiếp; bước nền tảng dùng must() ---------- */
let token = ''
const apiErrors = []
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || d.ok === false) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${d.error?.message || d.message || JSON.stringify(d.error || d)}`), { status: res.status })
  return d.result
}
const must = (method, path, body) => call(method, '/api/v1/hr' + path, body)
async function hr(method, path, body) {
  try { return await must(method, path, body) } catch (e) {
    apiErrors.push({ endpoint: `${method} /api/v1/hr${path}`, payload: JSON.stringify(body ?? null).slice(0, 300), error: e.message })
    console.error('  LỖI API:', e.message)
    return null
  }
}

/* ---------- ngày giờ (giờ VN), số ngẫu nhiên có hạt giống ---------- */
const nowVN = new Date(Date.now() + 7 * 3600e3)
const TODAY = nowVN.toISOString().slice(0, 10), NOW_HM = nowVN.toISOString().slice(11, 16)
const [TY, TM] = TODAY.split('-').map(Number)
const ym = (y, m) => { const d = new Date(Date.UTC(y, m - 1, 1)); return d.toISOString().slice(0, 7) }
const THIS_M = ym(TY, TM), LAST_M = ym(TY, TM - 1)
const FROM = LAST_M + '-01'
const day = (m, d) => `${m}-${String(d).padStart(2, '0')}` // ngày d của tháng m
const plus = n => addDaysIso(TODAY, n)
const hm = (t, add) => { const [h, m] = t.split(':').map(Number); const v = h * 60 + m + add; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` }
const atISO = (date, time) => new Date(`${date}T${time}:00+07:00`).toISOString()
let seed = 20261104
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
// ngày làm việc (T2-T6) thứ k của tháng m, tính từ đầu tháng; dùng cho đơn từ để không rơi vào cuối tuần
const workday = (m, k) => { let d = m + '-01', n = 0; for (;; d = addDaysIso(d, 1)) if (weekdayIdx(d) < 5 && ++n === k) return d }
// ngày làm việc gần nhất kể từ hôm nay +n (lùi / tiến tới T2-T6)
const sunday = (m, k) => { let d = m + '-01', n = 0; for (;; d = addDaysIso(d, 1)) if (weekdayIdx(d) === 6 && ++n === k) return d }
const wdFrom = n => { let d = plus(n); while (weekdayIdx(d) > 4) d = addDaysIso(d, n < 0 ? -1 : 1); return d }

/* ---------- đăng nhập, kiểm tra dữ liệu có sẵn ---------- */
token = (await call('POST', '/api/login', { args: [USER, PASS] })).token
const st = await must('GET', '')
const [att0, pay0, tal0] = await Promise.all([must('GET', `/attendance?from=${FROM}&to=${plus(63)}`), must('GET', '/payroll'), must('GET', '/talent')])
const existing = { shifts: att0.shifts.length, logs: att0.logs.length, requests: att0.requests.length, runs: Object.keys(pay0.runs).length,
  adjustments: Object.keys(pay0.adjustments).length, budgets: Object.keys(pay0.fixed).length, jds: tal0.jds.length, okrs: tal0.okrs.length, courses: tal0.courses.length }
if (Object.values(existing).some(Boolean)) {
  console.warn('CẢNH BÁO: công ty đã có dữ liệu HR, dừng để không nạp trùng:', JSON.stringify(existing))
  console.warn('Xoá trước: docker exec -i dezon-pro-db psql -U qspro -d qspro_gotest -v ON_ERROR_STOP=1 < infra/scripts/reset-demo-4tab.sql')
  process.exit(2)
}
const E = Object.fromEntries(st.employees.map(e => [e.id, e]))
const byCode = Object.fromEntries(st.employees.map(e => [e.code, e.id]))
const id = code => { if (!byCode[code]) throw new Error('Không thấy nhân sự ' + code + ' (sơ đồ tổ chức khác dữ liệu mẫu?)'); return byCode[code] }
const active = st.employees.filter(e => e.status !== 'left')
console.log(`Đăng nhập ${USER} · hôm nay ${TODAY} ${NOW_HM} · ${st.units.length} đơn vị, ${st.employees.length} nhân sự (${active.length} đang làm)`)

/* ---------- địa điểm, ca, lịch tuần ---------- */
const sites = att0.sites.some(s => s.name === 'Văn phòng Hà Nội') ? [] : [{ name: 'Văn phòng Hà Nội', lat: 21.0313, lng: 105.7828, radius: 150, isField: false }]
const fieldSite = new Set(att0.sites.filter(s => s.isField).map(s => s.name))
const SHIFTS = [
  { id: 'HC', name: 'Hành chính', start: '08:00', end: '17:00', breakMin: 60, tone: 'primary', note: 'Văn phòng, T2–T6' },
  { id: 'HC7', name: 'Sáng thứ 7', start: '08:00', end: '12:00', breakMin: 0, tone: 'primary', note: 'Văn phòng, thứ 7 làm nửa ngày' },
  { id: 'CT', name: 'Công trường', start: '07:00', end: '16:30', breakMin: 90, tone: 'attendance', note: 'Thi công / xưởng, T2–T7' },
]
const SH = Object.fromEntries(SHIFTS.map(s => [s.id, s]))
// công trường / xưởng / kho: T2-T7 ca CT; văn phòng: T2-T6 HC + sáng thứ 7
const isField = e => fieldSite.has(e.site) || ['thicong', 'xuong'].includes(e.dept)
const schedule = Object.fromEntries(active.map(e => [e.id, isField(e) ? ['CT', 'CT', 'CT', 'CT', 'CT', 'CT', 'off'] : ['HC', 'HC', 'HC', 'HC', 'HC', 'HC7', 'off']]))
await must('POST', '/shifts', { sites, shifts: SHIFTS, schedule })
console.log(`Ca ${SHIFTS.length}, lịch tuần ${Object.keys(schedule).length} người, thêm ${sites.length} địa điểm`)

/* ---------- đơn từ: tạo + duyệt TRƯỚC khi ghi chấm công / chốt công tháng trước ---------- */
// steps: chuỗi quyết định theo thứ tự bước (a = duyệt, r:<ghi chú> = từ chối); thiếu bước = để chờ
const L = LAST_M
const REQS = [
  // nghỉ phép
  { code: 'NV029', type: 'leave', leaveKind: 'annual', from: workday(L, 11), to: addDaysIso(workday(L, 11), 1), days: 2, reason: 'Về quê Quảng Ngãi dự đám cưới em gái', steps: ['a', 'a'] },
  { code: 'NV031', type: 'leave', leaveKind: 'sick', from: workday(L, 6), days: 1, reason: 'Sốt xuất huyết, có giấy khám bệnh viện quận 7', steps: ['a', 'a'] },
  { code: 'NV003', type: 'leave', leaveKind: 'annual', from: workday(L, 16), days: 0.5, reason: 'Nghỉ chiều đi làm thủ tục đổi CCCD', steps: ['a', 'a'] },
  { code: 'NV037', type: 'leave', leaveKind: 'unpaid', from: workday(L, 19), to: addDaysIso(workday(L, 19), 2), days: 3, reason: 'Chăm mẹ phẫu thuật tại BV Chợ Rẫy', steps: ['a', 'a'] },
  { code: 'NV034', type: 'leave', leaveKind: 'annual', from: workday(L, 14), to: addDaysIso(workday(L, 14), 1), days: 2, reason: 'Đi du lịch cùng gia đình',
    steps: ['a', 'r:Đang cao điểm nộp hồ sơ kết cấu căn hộ Vinhomes Grand Park, dời sang tháng sau giúp chị nhé.'] },
  { code: 'NV040', type: 'leave', leaveKind: 'annual', from: wdFrom(-2), days: 1, reason: 'Việc gia đình', steps: ['a', 'a'] },
  { code: 'NV030', type: 'leave', leaveKind: 'annual', from: wdFrom(5), to: addDaysIso(wdFrom(5), 1), days: 2, reason: 'Về Cần Thơ giỗ ông nội', steps: [] },
  { code: 'NV035', type: 'leave', leaveKind: 'annual', from: wdFrom(2), days: 0.5, reason: 'Nghỉ sáng đưa con đi tiêm chủng', steps: ['a'] },
  { code: 'NV032', type: 'leave', leaveKind: 'sick', from: TODAY, days: 1, reason: 'Đau lưng, bác sĩ cho nghỉ 1 ngày', steps: [], createdTime: '06:15' },
  { code: 'NV044', type: 'leave', leaveKind: 'unpaid', from: wdFrom(12), to: addDaysIso(wdFrom(12), 4), days: 5, reason: 'Đi học khoá Google Ads tại Singapore',
    steps: ['r:Tuần đó chạy chiến dịch cuối năm cho khách Decox, đăng ký học đợt tháng 1 nhé.'] },
  { code: 'NV018', type: 'leave', leaveKind: 'annual', from: wdFrom(7), to: addDaysIso(wdFrom(7), 2), days: 3, reason: 'Nghỉ phép năm, đã bàn giao đơn hàng cho anh Tân', steps: ['a'] },
  // đi muộn / về sớm (chỉ quản lý trực tiếp duyệt)
  { code: 'NV006', type: 'late', from: workday(L, 10), reason: 'Kẹt xe cầu Sài Gòn, đến muộn khoảng 30 phút', steps: ['a'], lateMin: 32 },
  { code: 'NV036', type: 'late', from: workday(L, 17), reason: 'Đưa con đi khám, vào làm lúc 9h', steps: ['a'], lateMin: 58 },
  { code: 'NV028', type: 'late', from: workday(L, 22), reason: 'Xe hư dọc đường', steps: ['r:Đi muộn không báo trước lần thứ 3 trong tháng.'], lateMin: 41 },
  { code: 'NV005', type: 'late', from: wdFrom(-1), reason: 'Mưa ngập đường Nguyễn Hữu Cảnh', steps: [], lateMin: 25 },
  // làm thêm giờ
  { code: 'NV015', type: 'ot', from: workday(L, 8), hours: 3, reason: 'Đổ bê tông sàn tầng 5 Tòa A, cần xong trước mưa', steps: ['a', 'a'] },
  { code: 'NV016', type: 'ot', from: sunday(L, 3), hours: 5, reason: 'Chủ nhật lắp dựng khung trần thạch cao sảnh Tòa B theo yêu cầu CĐT', steps: ['a', 'a'], sundayLog: ['07:05', '12:10'] },
  { code: 'NV029', type: 'ot', from: workday(L, 20), hours: 3, reason: 'Hoàn thiện hồ sơ thiết kế thi công căn hộ mẫu Thảo Điền', steps: ['a', 'a'] },
  { code: 'NV048', type: 'ot', from: wdFrom(-2), hours: 2, reason: 'Lắp ráp tủ bếp gấp cho công trình Thảo Điền', steps: ['a'] },
  { code: 'NV031', type: 'ot', from: wdFrom(1), hours: 4, reason: 'Thi công ban đêm khu vực sảnh để không ảnh hưởng cư dân', steps: [] },
]
const leaveDays = {} // empId -> {date: 1 | 0.5} (đơn nghỉ đã duyệt, để không ghi chấm công ngày nghỉ)
const forcedLate = {} // empId -> {date: phút muộn}
const sundayLogs = []
const offToday = new Set() // đơn nghỉ hôm nay (kể cả đang chờ duyệt) -> không chấm công hôm nay
let reqCount = 0
for (const r of REQS) {
  const empId = id(r.code), to = r.to || r.from
  const created = r.createdTime ? atISO(r.from, r.createdTime)
    : atISO(addDaysIso(r.from, r.type === 'late' ? 0 : -ri(2, 6)), r.type === 'late' ? '07:1' + ri(0, 9) : `${String(ri(8, 16)).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}`)
  const body = { empId, type: r.type, from: r.from, to, reason: r.reason, createdAt: new Date(Math.min(Date.now(), Date.parse(created))).toISOString(),
    ...(r.type === 'leave' ? { leaveKind: r.leaveKind, days: r.days } : {}), ...(r.type === 'ot' ? { hours: r.hours } : {}) }
  const req = await hr('POST', '/requests', body)
  if (!req) continue
  reqCount++
  let approved = true
  for (const s of r.steps) {
    const ok = s === 'a'
    if (!(await hr('POST', `/requests/${req.id}/decide`, { approve: ok, note: ok ? '' : s.slice(2) }))) { approved = false; break }
    if (!ok) { approved = false; break }
  }
  approved = approved && r.steps.length === req.steps.length
  if (r.type === 'leave' && approved) for (let d = r.from; d <= to; d = addDaysIso(d, 1)) (leaveDays[empId] ||= {})[d] = r.days === 0.5 ? 0.5 : 1
  if (r.type === 'leave' && r.from <= TODAY && TODAY <= to && !r.steps.some(x => x.startsWith('r:'))) offToday.add(empId)
  if (r.type === 'late') (forcedLate[empId] ||= {})[r.from] = r.lateMin
  if (r.sundayLog) sundayLogs.push({ empId, date: r.from, in: r.sundayLog[0], out: r.sundayLog[1], source: 'import', note: 'Tăng ca Chủ nhật (đơn OT)' })
}
console.log(`Đơn từ ${reqCount}/${REQS.length}`)

/* ---------- chấm công: từ ngày 1 tháng trước tới hôm nay ---------- */
const logs = [...sundayLogs]
const lateCount = {} // empId -> số lần muộn tháng trước (để phạt)
const todayIn = new Set()
for (const e of active) {
  const field = isField(e)
  // vài người hay đi muộn hơn mặt bằng chung
  const lateRate = ['NV006', 'NV050', 'NV036', 'NV005', 'NV032'].includes(e.code) ? 0.2 : 0.06
  for (let d = e.joinDate > FROM ? e.joinDate : FROM; d <= TODAY; d = addDaysIso(d, 1)) {
    const s = SH[schedule[e.id][weekdayIdx(d)]]
    if (!s) continue
    const lv = leaveDays[e.id]?.[d]
    if (lv === 1) continue
    const isToday = d === TODAY
    if (!isToday && !lv && rnd() < 0.015) continue // vắng không phép / quên chấm cả ngày
    if (isToday && (offToday.has(e.id) || rnd() < 0.2)) continue // hôm nay: ~80% đã chấm
    let inT = hm(s.start, -ri(0, 15)), outT = hm(s.end, ri(0, 25)), note
    const fl = forcedLate[e.id]?.[d]
    if (fl) inT = hm(s.start, fl)
    else if (rnd() < lateRate) inT = hm(s.start, ri(6, 40))
    if (lv === 0.5) outT = hm('12:00', ri(0, 8)) // nghỉ nửa ngày chiều
    else if (rnd() < 0.03) { outT = hm(s.end, -ri(15, 60)); note = 'Về sớm (có báo quản lý)' }
    if (inT > hm(s.start, 5) && d.startsWith(LAST_M)) lateCount[e.id] = (lateCount[e.id] || 0) + 1
    if (isToday) {
      if (inT >= NOW_HM) continue
      outT = NOW_HM > outT ? outT : ''
      todayIn.add(e.id)
    }
    const r = rnd()
    const src = field ? (r < 0.55 ? 'gps' : 'import') : (r < 0.03 ? 'manual' : 'machine')
    logs.push({ empId: e.id, date: d, in: inT, out: outT, source: src,
      ...(src === 'gps' ? { gps: rnd() < 0.05 ? 'out' : 'in', dist: ri(8, 220) } : {}),
      ...(src === 'manual' ? { note: 'Quên chấm — HR bổ sung' } : note ? { note } : {}) })
  }
}
for (let i = 0; i < logs.length; i += 1000) await hr('POST', '/logs', { logs: logs.slice(i, i + 1000) })
console.log(`Chấm công ${logs.length} dòng (hôm nay ${todayIn.size}/${active.length} người đã chấm)`)

/* ---------- lương: cấu hình, thưởng / phạt / doanh số, định phí ---------- */
await hr('POST', '/payroll/config', { config: DEFAULT_PAYROLL_CONFIG })
const M = 1e6
const ADJ = {
  [LAST_M]: [
    ['NV015', 'bonus', 'Thưởng tiến độ đổ bê tông Tòa A vượt 3 ngày', 3 * M], ['NV008', 'bonus', 'Thưởng KPI công trường Riverside (0 sự cố ATLĐ)', 5 * M],
    ['NV029', 'bonus', 'Thưởng KPI bàn giao hồ sơ thiết kế đúng hạn', 2.5 * M], ['NV030', 'bonus', 'Thưởng KPI bóc tách khối lượng sai lệch < 2%', 1.5 * M],
    ['NV047', 'bonus', 'Thưởng năng suất xưởng mộc tháng', 2 * M], ['NV004', 'bonus', 'Thưởng KPI video dự án', 1.5 * M],
    ['NV006', 'sales', 'Doanh số HĐ nội thất căn hộ Vinhomes Grand Park S2.05', 680 * M], ['NV006', 'sales', 'Doanh số HĐ nhà phố Thủ Đức', 410 * M],
    ['NV035', 'sales', 'Doanh số HĐ văn phòng Etown Cộng Hoà', 1250 * M], ['NV023', 'sales', 'Doanh số HĐ biệt thự Thảo Điền', 1850 * M],
    ['NV007', 'sales', 'Doanh số HĐ showroom Phú Mỹ Hưng', 2300 * M], ['NV040', 'penalty', 'Không cập nhật đơn hàng sàn đúng hạn', 0.3 * M],
  ],
  [THIS_M]: [
    ['NV006', 'sales', 'Doanh số HĐ căn hộ Masteri An Phú', 520 * M], ['NV035', 'sales', 'Doanh số HĐ cải tạo văn phòng Q1', 380 * M],
    ['NV016', 'bonus', 'Thưởng hoàn thành trần thạch cao sảnh Tòa B', 2 * M], ['NV043', 'bonus', 'Thưởng KPI chiến dịch quảng cáo tháng 10', 3 * M],
  ],
}
// phạt đi muộn tháng trước: từ lần thứ 3, 50.000 đ / lần
for (const [eid, n] of Object.entries(lateCount)) if (n >= 3) ADJ[LAST_M].push([E[eid].code, 'penalty', `Đi muộn ${n} lần trong tháng`, n * 50000])
let adjCount = 0
for (const [month, list] of Object.entries(ADJ)) for (const [code, kind, label, amount] of list) {
  if (await hr('POST', '/payroll/adjustments', { empId: id(code), month, kind, label, amount })) adjCount++
}
const budgets = { ...INITIAL_FIXED_COSTS, xuong: { fund: 85 * M, items: [{ name: 'Thuê nhà xưởng Bình Chánh', amount: 45 * M }, { name: 'Khấu hao máy CNC & cưa bàn trượt', amount: 18 * M }] } }
let budCount = 0
for (const [unit, v] of Object.entries(budgets)) if (st.units.some(u => u.key === unit) && await hr('POST', '/payroll/budgets', { unit, fund: v.fund, items: v.items })) budCount++
console.log(`Thưởng / phạt / doanh số ${adjCount}, định phí ${budCount} đơn vị`)

/* ---------- kỳ lương tháng trước: chốt công -> duyệt (bản chụp phiếu lương như giao diện) -> chi trả ---------- */
// calcPay lấy nguyên văn từ PayrollModule.jsx (các hàm thuần, không JSX) để bản chụp đúng như nút "Duyệt" của giao diện gửi
const src = readFileSync(new URL('../../frontend/src/pages/ChamCong/hr/PayrollModule.jsx', import.meta.url), 'utf8')
const a = src.indexOf('export function progressiveTax'), b = src.indexOf('/* Bảng phân bổ chi tiết')
if (a < 0 || b < a) throw new Error('Không tìm thấy calcPay trong PayrollModule.jsx')
syncDepts(st.units)
const { deptOf } = await import('../../frontend/src/data/hrData.js')
const calcPay = new Function('deptOf', src.slice(a, b).replace(/^export /gm, '') + '\nreturn calcPay')(deptOf)
await hr('POST', '/payroll/runs', { month: LAST_M, action: 'close' })
const [att1, pay1] = await Promise.all([must('GET', `/attendance?from=${ym(TY, TM - 2)}-01&to=${plus(63)}`), must('GET', '/payroll')])
syncAttendance(att1)
const cfg = { ...DEFAULT_PAYROLL_CONFIG, ...(pay1.config || {}) }
const concurrentOf = empId => st.units.filter(u => (st.members[u.key] || []).some(m => m.id === empId)).map(u => ({ unit: u, ...st.members[u.key].find(m => m.id === empId) }))
const payslips = Object.fromEntries(monthlySummary(st.employees, LAST_M).map(({ emp, ...at }) => {
  const adj = pay1.adjustments[LAST_M]?.[emp.id] || []
  return [emp.id, { att: at, adj, p: calcPay(emp, { emp, ...at }, adj, cfg, concurrentOf(emp.id)) }]
}))
if (await hr('POST', '/payroll/runs', { month: LAST_M, action: 'approve', payslips })) {
  await hr('POST', '/payroll/runs', { month: LAST_M, action: 'pay', sent: Object.keys(payslips).map(Number) })
}
const net = Object.values(payslips).reduce((s, x) => s + x.p.net, 0), cost = Object.values(payslips).reduce((s, x) => s + x.p.cost, 0)
console.log(`Kỳ lương ${LAST_M}: ${Object.keys(payslips).length} phiếu, thực nhận ${Math.round(net).toLocaleString('vi-VN')} đ, chi phí công ty ${Math.round(cost).toLocaleString('vi-VN')} đ`)

/* ---------- tuyển dụng ---------- */
const JDS = [
  { key: 'gs', code: 'JD-TC-01', title: 'Kỹ sư giám sát thi công nội thất', dept: 'thicong', level: 'Chuyên viên', salary: '18–25 triệu',
    summary: 'Giám sát thi công hoàn thiện nội thất căn hộ, văn phòng; nghiệm thu khối lượng với chủ đầu tư.',
    duties: ['Giám sát đội thợ thi công trần, vách, sàn, đồ gỗ theo bản vẽ', 'Nghiệm thu nội bộ và nghiệm thu với chủ đầu tư', 'Lập báo cáo tiến độ ngày / tuần', 'Kiểm soát an toàn lao động tại công trường'],
    requirements: ['Tốt nghiệp ĐH Xây dựng / Kiến trúc nội thất', 'Tối thiểu 2 năm giám sát hoàn thiện nội thất', 'Đọc bản vẽ tốt, dùng AutoCAD'],
    benefits: ['Phụ cấp công trường 1,5 triệu / tháng', 'Thưởng tiến độ dự án', 'BHXH đầy đủ, du lịch năm'] },
  { key: 'kts', code: 'JD-TK-01', title: 'Kiến trúc sư nội thất', dept: 'thietke', level: 'Chuyên viên', salary: '20–30 triệu',
    summary: 'Thiết kế concept và triển khai hồ sơ kỹ thuật nội thất nhà ở, văn phòng.',
    duties: ['Làm việc với khách hàng, lên concept & phối cảnh 3D', 'Triển khai hồ sơ bản vẽ thi công nội thất', 'Phối hợp QS bóc tách khối lượng, xưởng sản xuất'],
    requirements: ['3 năm kinh nghiệm thiết kế nội thất', 'Thành thạo SketchUp, V-Ray / Enscape, AutoCAD', 'Có portfolio dự án thực tế'],
    benefits: ['Thưởng theo dự án', 'Đào tạo BIM / Revit', 'Laptop cấu hình cao'] },
  { key: 'kd', code: 'JD-KD-01', title: 'Nhân viên kinh doanh dự án nội thất', dept: 'kdda', level: 'Nhân viên', salary: '12 triệu + 1% doanh số',
    summary: 'Tìm kiếm và chăm sóc khách hàng dự án văn phòng, showroom, căn hộ cao cấp.',
    duties: ['Tìm kiếm khách hàng dự án từ data và giới thiệu', 'Khảo sát, phối hợp thiết kế lập báo giá', 'Đàm phán và chốt hợp đồng'],
    requirements: ['1 năm kinh nghiệm sales nội thất / BĐS / VLXD', 'Giao tiếp tốt, chịu áp lực doanh số'],
    benefits: ['Hoa hồng 1% doanh số', 'Phụ cấp xăng xe, điện thoại'] },
  { key: 'qs', code: 'JD-QS-01', title: 'Kỹ sư QS dự toán', dept: 'qs', level: 'Chuyên viên', salary: '16–22 triệu',
    summary: 'Bóc tách khối lượng, lập dự toán và báo giá thi công nội thất.',
    duties: ['Bóc tách khối lượng từ hồ sơ thiết kế', 'Lập dự toán, báo giá trên QS Pro', 'Theo dõi phát sinh và quyết toán công trình'],
    requirements: ['2 năm kinh nghiệm QS nội thất / xây dựng', 'Thành thạo Excel, đọc bản vẽ'], benefits: ['Thưởng quyết toán', 'BHXH đầy đủ'] },
  { key: 'tho', code: 'JD-XG-01', title: 'Thợ cắt & gia công CNC', dept: 'xuong', level: 'Nhân viên', salary: '9–13 triệu',
    summary: 'Vận hành máy CNC, cưa bàn trượt gia công đồ gỗ công nghiệp.',
    duties: ['Vận hành máy CNC theo file cắt', 'Gia công, dán cạnh ván MDF / MFC', 'Bảo dưỡng máy định kỳ'],
    requirements: ['1 năm kinh nghiệm xưởng mộc', 'Biết đọc bản vẽ chi tiết'], benefits: ['Cơm trưa tại xưởng', 'Tăng ca tính 150%'] },
  { key: 'kt', code: 'JD-KT-01', title: 'Kế toán công trình', dept: 'tckt', level: 'Chuyên viên', salary: '13–16 triệu',
    summary: 'Hạch toán chi phí công trình, đối chiếu công nợ nhà cung cấp và thầu phụ.',
    duties: ['Theo dõi chi phí từng công trình', 'Đối chiếu công nợ NCC, thầu phụ', 'Lập báo cáo lãi lỗ công trình'],
    requirements: ['2 năm kế toán xây dựng / nội thất', 'Thành thạo MISA'], benefits: ['Thưởng tháng 13', 'Làm việc tại văn phòng'] },
]
const JD = {}
for (const { key, ...jd } of JDS) JD[key] = (await hr('POST', '/jds', jd))?.id
const JOBS = [
  { key: 'gs', jd: 'gs', qty: 2, site: 'Riverside — Tòa A', deadline: plus(26), status: 'open', channels: ['TopCV', 'VietnamWorks', 'Giới thiệu nội bộ'], desc: 'Giám sát thi công hoàn thiện nội thất dự án Riverside giai đoạn 2.' },
  { key: 'kts', jd: 'kts', qty: 1, site: 'Văn phòng HCM', deadline: plus(19), status: 'open', channels: ['LinkedIn', 'Website công ty'], desc: 'Thiết kế nội thất căn hộ cao cấp và văn phòng.' },
  { key: 'kd', jd: 'kd', qty: 2, site: 'Văn phòng HCM', deadline: plus(11), status: 'open', channels: ['TopCV', 'Facebook'], desc: 'Mở rộng mảng nội thất văn phòng khu vực Q1, Q3, Phú Nhuận.' },
  { key: 'qs', jd: 'qs', qty: 1, site: 'Văn phòng HCM', deadline: plus(33), status: 'open', channels: ['VietnamWorks', 'LinkedIn'], desc: 'Bổ sung nhân sự QS cho các dự án quý 4.' },
  { key: 'tho', jd: 'tho', qty: 1, site: 'Kho vật tư Bình Chánh', deadline: day(ym(TY, TM - 2), 30), status: 'closed', channels: ['Facebook', 'Giới thiệu nội bộ'], desc: 'Thợ CNC cho xưởng mộc Bình Chánh (đã tuyển đủ).' },
  { key: 'kt', jd: 'kt', qty: 1, site: 'Văn phòng HCM', deadline: plus(40), status: 'paused', channels: ['VietnamWorks'], desc: 'Tạm dừng, chờ duyệt định biên năm sau.' },
]
const JOB = {}
for (const { key, jd, ...j } of JOBS) if (JD[jd]) JOB[key] = (await hr('POST', '/jobs', { ...j, jdId: JD[jd] }))?.id
const rv = (by, round, s, note, date) => ({ by, round, scores: { chuyenmon: s[0], kinhnghiem: s[1], giaotiep: s[2], vanhoa: s[3] }, note, date })
const CANDS = [
  { job: 'gs', name: 'Lê Hoàng Phúc', email: 'phuc.lehoang@gmail.com', phone: '0903 112 334', source: 'TopCV', applied: plus(-16), cv: 'CV_LeHoangPhuc.pdf', exp: '4 năm giám sát hoàn thiện tại Hoà Bình Corp',
    interviews: [{ date: plus(-8), time: '09:00', round: 'Vòng 1 — Chuyên môn', interviewer: 'Nguyễn Đức Anh', mode: 'Trực tiếp', place: 'Phòng họp 2 — VP HCM' },
      { date: plus(2), time: '14:00', round: 'Vòng 2 — Ban giám đốc', interviewer: 'Trần Anh', mode: 'Trực tiếp', place: 'Phòng họp 1 — VP HCM' }],
    reviews: [rv('Nguyễn Đức Anh', 'Vòng 1 — Chuyên môn', [4, 4, 4, 5], 'Nắm chắc quy trình nghiệm thu trần vách, đọc bản vẽ tốt.', plus(-8))], stage: 'interview' },
  { job: 'gs', name: 'Võ Minh Khoa', email: 'khoa.vominh@gmail.com', phone: '0965 221 870', source: 'Giới thiệu nội bộ', applied: plus(-6), cv: 'CV_VoMinhKhoa.pdf', exp: '3 năm giám sát MEP & hoàn thiện', stage: 'screening' },
  { job: 'gs', name: 'Trần Bảo Long', email: 'long.tranbao@gmail.com', phone: '0909 765 004', source: 'VietnamWorks', applied: plus(-21), cv: 'CV_TranBaoLong.pdf', exp: '1 năm hiện trường',
    interviews: [{ date: plus(-13), time: '10:00', round: 'Vòng 1 — Chuyên môn', interviewer: 'Nguyễn Đức Anh', mode: 'Trực tiếp', place: 'Công trường Riverside' }],
    reviews: [rv('Nguyễn Đức Anh', 'Vòng 1 — Chuyên môn', [2, 2, 3, 3], 'Chưa đủ kinh nghiệm hoàn thiện nội thất.', plus(-13))], stage: 'rejected' },
  { job: 'kts', name: 'Phạm Thu Uyên', email: 'uyen.phamthu@gmail.com', phone: '0938 554 221', source: 'LinkedIn', applied: plus(-12), cv: 'Portfolio_PhamThuUyen.pdf', exp: '4 năm KTS nội thất tại studio Q2',
    interviews: [{ date: plus(-5), time: '09:30', round: 'Vòng 1 — Chuyên môn', interviewer: 'Võ Hoàng Nam', mode: 'Trực tiếp', place: 'Phòng họp 2 — VP HCM' }],
    reviews: [rv('Võ Hoàng Nam', 'Vòng 1 — Chuyên môn', [5, 4, 4, 4], 'Portfolio đẹp, concept tốt; cần thêm kinh nghiệm triển khai bản vẽ thi công.', plus(-5)),
      rv('Ngô Mỹ Duyên', 'Vòng 2 — HR', [4, 4, 5, 5], 'Đề xuất offer 24 triệu, nhận việc đầu tháng sau.', plus(-2))], stage: 'offer' },
  { job: 'kts', name: 'Lâm Quốc Việt', email: 'viet.lamquoc@gmail.com', phone: '0905 662 900', source: 'Website công ty', applied: plus(-4), cv: 'CV_LamQuocViet.pdf', exp: '6 năm KTS, có chứng chỉ hành nghề',
    interviews: [{ date: plus(1), time: '10:00', round: 'Vòng 1 — Chuyên môn', interviewer: 'Võ Hoàng Nam', mode: 'Online', place: 'meet.google.com/dezon-kts' }], stage: 'interview' },
  { job: 'kd', name: 'Ngô Bảo Châu', email: 'chau.ngobao@gmail.com', phone: '0977 300 118', source: 'TopCV', applied: plus(-3), cv: 'CV_NgoBaoChau.pdf', exp: '2 năm sales căn hộ', stage: 'applied' },
  { job: 'kd', name: 'Huỳnh Ngọc Mai', email: 'mai.huynhngoc@gmail.com', phone: '0988 140 551', source: 'Facebook', applied: plus(-9), cv: 'CV_HuynhNgocMai.pdf', exp: '1 năm sales vật liệu nội thất',
    interviews: [{ date: plus(3), time: '15:30', round: 'Vòng 1 — HR', interviewer: 'Nguyễn Thanh Mai', mode: 'Online', place: 'meet.google.com/dezon-sales' }], stage: 'interview' },
  { job: 'kd', name: 'Đoàn Minh Tâm', email: 'tam.doanminh@gmail.com', phone: '0917 220 335', source: 'TopCV', applied: plus(-1), cv: 'CV_DoanMinhTam.pdf', exp: 'Mới tốt nghiệp ĐH Kinh tế', stage: 'applied' },
  { job: 'qs', name: 'Nguyễn Hữu Tài', email: 'tai.nguyenhuu@gmail.com', phone: '0932 845 116', source: 'VietnamWorks', applied: plus(-7), cv: 'CV_NguyenHuuTai.pdf', exp: '3 năm QS tại nhà thầu nội thất', stage: 'screening',
    reviews: [rv('Lưu Minh Trí', 'Sàng lọc CV', [4, 3, 3, 4], 'CV phù hợp, mời làm bài test bóc tách.', plus(-4))] },
  { job: 'tho', name: 'Hồ Đình Phong', email: 'phong.hodinh@gmail.com', phone: '0978 552 019', source: 'Giới thiệu nội bộ', applied: day(ym(TY, TM - 2), 2), cv: 'CV_HoDinhPhong.pdf', exp: '2 năm thợ CNC xưởng Bình Dương',
    reviews: [rv('Huỳnh Tấn Phát', 'Vòng 1 — Tay nghề', [4, 3, 3, 4], 'Thao tác máy CNC thành thạo, nhận thử việc.', day(ym(TY, TM - 2), 8))], stage: 'hired', hire: 'NV052' },
]
let candCount = 0
for (const c of CANDS) {
  if (!JOB[c.job]) continue
  const cid = (await hr('POST', '/candidates', { jobId: JOB[c.job], name: c.name, email: c.email, phone: c.phone, source: c.source, cv: c.cv, exp: c.exp, applied: c.applied }))?.id
  if (!cid) continue
  candCount++
  for (const iv of c.interviews || []) await hr('PATCH', `/candidates/${cid}`, { interview: iv })
  for (const r of c.reviews || []) await hr('PATCH', `/candidates/${cid}`, { review: r })
  if (c.stage !== 'applied' && !(c.stage === 'interview' && c.interviews?.length)) await hr('PATCH', `/candidates/${cid}`, { stage: c.stage, ...(c.hire ? { hiredEmployeeId: id(c.hire) } : {}) })
}
console.log(`Tuyển dụng: ${Object.values(JD).filter(Boolean).length} JD, ${Object.values(JOB).filter(Boolean).length} tin, ${candCount} ứng viên`)

/* ---------- hiệu suất: OKR quý hiện tại, đợt đánh giá ---------- */
const P = PERIODS[0]
const OKRS = [
  { owner: 'NV000', title: 'Dezon tăng trưởng doanh thu ký mới quý ' + P, krs: [
    ['Doanh thu ký mới toàn công ty', 35, 'tỷ', 'NV000', 0, 14.2], ['Biên lợi nhuận gộp bình quân', 28, '%', 'NV022', 0, 26.5], ['Công trình bàn giao đúng hạn', 90, '%', 'NV001', 0, 85]] },
  { owner: 'NV008', title: 'Bàn giao hoàn thiện nội thất Riverside GĐ2 đúng tiến độ', krs: [
    ['Hoàn thành trần, vách, sàn tầng 1–8 Tòa A', 100, '%', 'NV015', 0, 46], ['Hoàn thành lắp đặt đồ gỗ Tòa B', 100, '%', 'NV016', 0, 31], ['Sự cố an toàn lao động', 0, 'vụ', 'NV010', 1, 0]] },
  { owner: 'NV023', title: 'Tăng trưởng doanh số khối dân dụng', krs: [
    ['Doanh số ký mới căn hộ & nhà phố', 8, 'tỷ', 'NV023', 0, 3.4], ['Số hợp đồng ký mới', 18, 'HĐ', 'NV006', 0, 7], ['Tỉ lệ chốt từ khảo sát', 35, '%', 'NV006', 0, 29]] },
  { owner: 'NV024', title: 'Chuẩn hoá hồ sơ thiết kế & thư viện vật liệu', krs: [
    ['Dự án mới triển khai trên Revit', 100, '%', 'NV029', 0, 55], ['Sai lệch khối lượng QS so với thiết kế', 3, '%', 'NV030', 1, 3.8], ['Thời gian ra concept trung bình', 5, 'ngày', 'NV024', 1, 6]] },
  { owner: 'NV014', title: 'Nâng chất lượng tuyển dụng & đào tạo', krs: [
    ['Thời gian tuyển dụng trung bình', 30, 'ngày', 'NV033', 1, 33], ['Nhân sự hoàn thành đào tạo bắt buộc', 100, '%', 'NV020', 0, 72]] },
]
let okrCount = 0
for (const o of OKRS) {
  const oid = (await hr('POST', '/okrs', { period: P, title: o.title, owner: id(o.owner), krs: o.krs.map(([title, target, unit, owner, inverse]) => ({ title, target, unit, owner: id(owner), inverse: !!inverse })) }))?.id
  if (!oid) continue
  okrCount++
  for (const [i, k] of o.krs.entries()) if (k[5]) await hr('POST', `/okrs/${oid}/kr`, { krId: i + 1, current: k[5] })
}
const reviewees = active.filter(e => ['thietke', 'qs', 'marketing', 'thicong', 'hcns', 'kddd', 'kdda'].includes(e.dept) && e.managerId && e.status === 'active')
await hr('POST', '/reviews', { period: P, action: 'launch', empIds: reviewees.map(e => e.id) })
const sc = () => ({ kq: ri(3, 5), cm: ri(3, 5), pp: ri(3, 5), kl: ri(3, 5), pt: ri(3, 4) })
const SELF_NOTES = ['Hoàn thành các đầu việc được giao đúng hạn.', 'Chủ động phối hợp với các phòng ban liên quan.', 'Cần cải thiện kỹ năng báo cáo tiến độ.', 'Đã hoàn thành khoá đào tạo bắt buộc.']
const MGR_NOTES = ['Làm việc chăm chỉ, kết quả ổn định.', 'Cần chủ động báo cáo sớm các vướng mắc.', 'Xuất sắc, đề xuất xét tăng lương kỳ tới.', 'Đạt yêu cầu, cần nâng cao chuyên môn.']
let selfDone = 0, mgrDone = 0
for (const [i, e] of reviewees.entries()) {
  if (i % 3 === 2) continue // 1/3 chưa tự đánh giá
  if (!(await hr('POST', '/reviews', { period: P, action: 'self', empId: e.id, scores: sc(), note: SELF_NOTES[i % 4] }))) continue
  selfDone++
  if (i % 3 === 0 && await hr('POST', '/reviews', { period: P, action: 'mgr', empId: e.id, scores: sc(), note: MGR_NOTES[i % 4] })) mgrDone++
}
console.log(`OKR ${okrCount} mục tiêu (${P}), đánh giá ${reviewees.length} người: ${selfDone} đã tự chấm, ${mgrDone} quản lý chấm xong`)

/* ---------- đào tạo ---------- */
const COURSES = [
  { key: 'atld', title: 'An toàn lao động & PCCC công trường', category: 'Bắt buộc', hours: 16, format: 'Trực tiếp', mandatory: true, tone: 'danger' },
  { key: 'vh', title: 'Văn hoá & quy chế Dezon', category: 'Hội nhập', hours: 3, format: 'E-learning', mandatory: true, tone: 'attendance' },
  { key: 'nt', title: 'Quy trình nghiệm thu hoàn thiện nội thất', category: 'Chuyên môn', hours: 6, format: 'E-learning', mandatory: false, tone: 'primary' },
  { key: 'qs', title: 'Bóc tách khối lượng & báo giá trên QS Pro', category: 'Công nghệ', hours: 8, format: 'Blended', mandatory: false, tone: 'qs' },
  { key: 'sk', title: 'SketchUp + Enscape cho thiết kế nội thất', category: 'Công nghệ', hours: 24, format: 'Blended', mandatory: false, tone: 'qs' },
  { key: 'ban', title: 'Tư vấn & chốt hợp đồng nội thất', category: 'Kỹ năng mềm', hours: 8, format: 'Trực tiếp', mandatory: false, tone: 'finance' },
  { key: 'pm', title: 'Quản lý dự án thi công nội thất', category: 'Quản lý', hours: 32, format: 'Blended', mandatory: false, tone: 'success' },
]
const C = {}
for (const { key, ...c } of COURSES) C[key] = (await hr('POST', '/courses', c))?.id
const PATHS = [
  { title: 'Kỹ sư / giám sát công trường mới', for: 'Thi công · 0–6 tháng', courses: ['vh', 'atld', 'nt', 'pm'] },
  { title: 'Nhân viên kinh doanh mới', for: 'Kinh doanh · 0–3 tháng', courses: ['vh', 'ban', 'qs'] },
  { title: 'Thiết kế & QS', for: 'Thiết kế, QS · 0–6 tháng', courses: ['vh', 'sk', 'qs'] },
]
let pathCount = 0
for (const p of PATHS) if (await hr('POST', '/paths', { ...p, courses: p.courses.map(k => C[k]).filter(Boolean) })) pathCount++
const pct = () => [100, 100, 100, 80, 60, 40, 20][ri(0, 6)]
let enrollCount = 0
for (const e of active) {
  const m = { [C.vh]: e.status === 'probation' ? ri(1, 3) * 30 : 100 }
  if (isField(e)) m[C.atld] = e.status === 'probation' ? 40 : pct()
  if (['thicong'].includes(e.dept) && e.level !== 'Nhân viên') m[C.nt] = pct()
  if (['thietke', 'qs'].includes(e.dept)) { m[C.sk] = pct(); m[C.qs] = pct() }
  if (['kddd', 'kdda'].includes(e.dept)) m[C.ban] = pct()
  if (['Trưởng phòng', 'Giám đốc'].includes(e.level) && ['thicong', 'cco', 'coo', 'thietke', 'qs'].includes(e.dept)) m[C.pm] = pct()
  delete m.undefined
  if (Object.keys(m).length && await hr('POST', '/enroll', { empId: e.id, courses: m })) enrollCount++
}
console.log(`Đào tạo: ${Object.values(C).filter(Boolean).length} khoá, ${pathCount} lộ trình, ${enrollCount} người ghi danh`)

/* ---------- phân quyền: ma trận mặc định; Giám đốc / Trưởng phòng / trưởng đơn vị -> manager, HCNS (trưởng phòng, C&B) -> hradmin ---------- */
const heads = new Set(Object.values(st.heads).map(Number))
const wantRole = e => (['NV014', 'NV020'].includes(e.code) ? 'hradmin'
  : e.hrRole === 'sysadmin' ? 'sysadmin'
  : (['Giám đốc', 'Trưởng phòng'].includes(e.level) || heads.has(e.id)) ? 'manager' : e.hrRole || 'employee')
let roleCount = 0
for (const e of active) if (wantRole(e) !== (e.hrRole || 'employee') && await hr('POST', '/security/user', { empId: e.id, role: wantRole(e) })) roleCount++
const roleUsers = { sysadmin: active.find(e => e.hrRole === 'sysadmin')?.id || id('NV017'), hradmin: id('NV014'), manager: id('NV008'), employee: id('NV009') }
await hr('POST', '/security', {
  perms: { hradmin: DEFAULT_PERMS.hradmin, manager: DEFAULT_PERMS.manager, employee: DEFAULT_PERMS.employee },
  maskSalary: SECURITY_SETTINGS.maskSalary.value,
  ui: { settings: Object.fromEntries(Object.entries(SECURITY_SETTINGS).map(([k, v]) => [k, v.value])), session: '30 phút', branches: {}, roleUsers },
})
console.log(`Phân quyền: đổi vai trò ${roleCount} người`)

/* ---------- đọc lại qua API ---------- */
const [s2, at, pr, tl, sec] = await Promise.all([must('GET', ''), must('GET', `/attendance?from=${FROM}&to=${plus(63)}`), must('GET', '/payroll'), must('GET', '/talent'), must('GET', '/security')])
const reqState = r => r.steps.some(x => x.state === 'rejected') ? 'rejected' : r.steps.every(x => x.state === 'done') ? 'approved' : 'pending@' + (r.steps.find(x => x.state === 'active')?.role || '?')
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m }, {})
console.log('\nĐỌC LẠI:', JSON.stringify({
  units: s2.units.length, employees: s2.employees.length, roles: count(s2.employees, e => e.hrRole || 'employee'),
  sites: at.sites.length, shifts: at.shifts.map(s => s.id), schedule: Object.keys(at.schedule).length,
  logs: at.logs.length, logsLastMonth: at.logs.filter(l => l.date.startsWith(LAST_M)).length, logsToday: at.logs.filter(l => l.date === TODAY).length,
  requests: count(at.requests, r => r.type + ':' + reqState(r)), closedMonths: Object.keys(at.closedMonths || {}),
  runs: Object.fromEntries(Object.entries(pr.runs).map(([m, r]) => [m, `${r.status} (${Object.keys(r.payslips || {}).length} phiếu, gửi ${(r.sent || []).length})`])),
  adjustments: Object.fromEntries(Object.entries(pr.adjustments).map(([m, x]) => [m, Object.values(x).flat().length])), budgets: Object.keys(pr.fixed).length, config: !!pr.config,
  jds: tl.jds.length, jobs: count(tl.jobs, j => j.status), candidates: count(tl.candidates, c => c.stage), interviews: tl.interviews.length,
  upcomingInterviews: tl.interviews.filter(i => i.date >= TODAY).length, okrs: tl.okrs.length,
  reviews: count(Object.values(tl.reviews[P] || {}), r => r.state), courses: tl.courses.length, paths: tl.paths.length, enrolled: Object.keys(tl.enroll).length,
  roleUsers: sec.ui?.roleUsers, auditRows: sec.audit?.length,
}, null, 1))
if (apiErrors.length) { console.log(`\n${apiErrors.length} LỖI API:`); apiErrors.forEach(e => console.log(JSON.stringify(e))); process.exit(1) }
console.log('\nKhông có lỗi API.')
