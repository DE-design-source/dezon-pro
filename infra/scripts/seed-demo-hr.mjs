#!/usr/bin/env node
/* Nạp dữ liệu mẫu HR của bản giao diện tĩnh 8686a37 (frontend/src/data/hrData.js, hrData2.js) vào công ty của tài khoản demo
   qua HTTP API của bản Go. Xoá dữ liệu HR cũ của công ty đó trước (POST /hr/reset) nên chạy lại được nhiều lần.
   Mọi ngày dời theo khoảng cách SAMPLE_TODAY (2026-09-23) -> hôm nay; khoá theo tháng (kỳ lương, thưởng / phạt) dời theo số tháng.
   Chạy (Node 18+): API=http://localhost:3100 node infra/scripts/seed-demo-hr.mjs
   Tài khoản: DEMO_LOGIN_USER / DEMO_LOGIN_PASSWORD trong backend/.env.test-login; chỉ nhận tài khoản bắt đầu bằng zz_. */
import { readFileSync } from 'node:fs'
import * as D from '../../frontend/src/data/hrData.js'
import * as D2 from '../../frontend/src/data/hrData2.js'

const API = (process.env.API || 'http://localhost:3100').replace(/\/$/, '')
const env = Object.fromEntries(readFileSync(new URL('../../backend/.env.test-login', import.meta.url), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]))
const USER = env.DEMO_LOGIN_USER, PASS = env.DEMO_LOGIN_PASSWORD
if (!USER || !USER.startsWith('zz_')) { console.error('Từ chối: DEMO_LOGIN_USER phải bắt đầu bằng zz_ (tài khoản thử)'); process.exit(1) }

/* ---------- dời ngày ---------- */
const OLD_PERIODS = ['Q3/2026', 'Q4/2026', 'Năm 2026']
const T0 = D.SAMPLE_TODAY, T1 = D.HR_TODAY
const DAY_OFF = D.daysBetween(T0, T1)
const MONTH_OFF = (Number(T1.slice(0, 4)) - Number(T0.slice(0, 4))) * 12 + Number(T1.slice(5, 7)) - Number(T0.slice(5, 7))
const day = iso => D.addDaysIso(iso, DAY_OFF)
const month = key => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + MONTH_OFF, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const deep = v => (typeof v === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? day(v) : v)
  : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v)
// 'dd/mm/yyyy · HH:MM' và 'dd/mm' trong chữ (năm của dữ liệu mẫu)
const label = s => s.replace(/(\d{2})\/(\d{2})\/(\d{4})/g, (_, d, m, y) => day(`${y}-${m}-${d}`).split('-').reverse().join('/'))
const dm = s => s.replace(/\b(\d{2})\/(\d{2})\b(?!\/)/g, (_, d, m) => day(`${T0.slice(0, 4)}-${m}-${d}`).split('-').reverse().slice(0, 2).join('/'))
const isoAt = lbl => { const [d, m, y, hh, mm] = lbl.match(/\d+/g); return `${y}-${m}-${d}T${hh}:${mm}:00+07:00` }

/* ---------- HTTP ---------- */
let token = ''
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || d.ok === false) throw new Error(`${method} ${path}: ${d.error?.message || d.message || d.error || res.status}`)
  return d.result
}
const hr = (method, path, body) => call(method, '/api/v1/hr' + path, body)

token = (await call('POST', '/api/login', { args: [USER, PASS] })).token
console.log(`Đăng nhập ${USER} · dời ngày ${DAY_OFF} ngày, ${MONTH_OFF} tháng (${T0} -> ${T1})`)
await hr('POST', '/reset', { confirm: 'XOA_DU_LIEU_HR' })

/* ---------- cơ cấu, nhân sự ---------- */
const units = [], done = new Set()
while (units.length < D.INITIAL_ORG_UNITS.length) {
  const next = D.INITIAL_ORG_UNITS.filter(u => !done.has(u.key) && (!u.parent || u.parent.startsWith('__') || done.has(u.parent)))
  if (!next.length) throw new Error('Cơ cấu mẫu có đơn vị mồ côi')
  next.forEach(u => { units.push(u); done.add(u.key) })
}
await hr('POST', '/org', { units })
const ID = {} // id mẫu -> id trên máy chủ
const emps = D.INITIAL_HR_EMPLOYEES.map(deep)
for (const { id, managerId: _m, ...e } of emps) ID[id] = (await hr('POST', '/employees', e)).id
await hr('POST', '/org', {
  units: Object.entries(D.INITIAL_UNIT_HEADS).map(([key, h]) => ({ key, headId: ID[h] })),
  employees: emps.filter(e => e.managerId).map(e => ({ id: ID[e.id], managerId: ID[e.managerId] })),
  members: Object.entries(D.INITIAL_EXTRA_MEMBERS).flatMap(([unit, list]) => list.map(m => ({ ...m, unit, id: ID[m.id] }))),
})
for (const [old, role] of Object.entries(D2.ROLES).map(([k, r]) => [r.userId, k]).concat([[20, 'hradmin']])) await hr('POST', '/security/user', { empId: ID[old], role })
console.log(`Cơ cấu ${units.length} đơn vị, ${emps.length} nhân sự`)

/* ---------- ca, lịch, chấm công, đơn từ ---------- */
D.syncSites(D.SAMPLE_SITES)
const sched = D.initialSchedule(D.INITIAL_HR_EMPLOYEES)
await hr('POST', '/shifts', { sites: D.SAMPLE_SITES, shifts: D.INITIAL_SHIFTS, schedule: Object.fromEntries(Object.entries(sched).map(([k, row]) => [ID[k], row])) })
const shiftOf = Object.fromEntries(D.INITIAL_SHIFTS.map(s => [s.id, s]))
const hm = (t, plus) => { const [h, m] = t.split(':').map(Number); const v = h * 60 + m + plus; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` }
const logs = []
const from = D.MONTHS[D.MONTHS.length - 1].key + '-01'
for (const e of emps.filter(x => x.status !== 'left')) {
  // ngày đã qua: vào sớm 0-8 phút, thỉnh thoảng muộn 12 phút; ra đúng giờ ra ca
  for (let d = e.joinDate > from ? e.joinDate : from, n = 0; d < T1; d = D.addDaysIso(d, 1), n++) {
    const s = shiftOf[sched[e.id]?.[D.weekdayIdx(d)]]
    if (!s) continue
    const late = (e.id * 13 + n) % 17 === 0
    logs.push({ empId: ID[e.id], date: d, in: hm(s.start, late ? 12 : -((e.id * 7 + n) % 9)), out: hm(s.end, (e.id + n) % 6), source: e.site === 'Văn phòng HCM' ? 'machine' : 'import' })
  }
}
D.TODAY_LOGS.filter(l => l.in).forEach(l => logs.push({ empId: ID[l.empId], date: T1, in: l.in, out: l.out || '', source: l.source,
  ...(l.source === 'gps' ? { gps: l.gps, dist: l.dist } : {}), ...(l.note ? { note: l.note } : {}) }))
for (let i = 0; i < logs.length; i += 500) await hr('POST', '/logs', { logs: logs.slice(i, i + 500) })
const now = Date.now()
for (const r of D.INITIAL_HR_REQUESTS) {
  const at = isoAt(label(r.createdAt))
  const created = await hr('POST', '/requests', { empId: ID[r.empId], type: r.type, leaveKind: r.leaveKind, from: day(r.from), to: day(r.to || r.from), days: r.days, hours: r.hours,
    reason: r.reason, title: dm(r.title), createdAt: new Date(Math.min(now, Date.parse(at))).toISOString() })
  for (const [i, st] of r.steps.entries()) {
    if (!['done', 'rejected'].includes(st.state) || i >= created.steps.length) break
    await hr('POST', `/requests/${created.id}/decide`, { approve: st.state === 'done', note: st.note || '' })
  }
}
console.log(`Ca ${D.INITIAL_SHIFTS.length}, ${logs.length} dòng chấm công, ${D.INITIAL_HR_REQUESTS.length} đơn`)

/* ---------- lương: thưởng / phạt trước, rồi duyệt + chi trả các kỳ cũ ---------- */
for (const [m, byEmp] of Object.entries(D2.INITIAL_ADJUSTMENTS)) for (const [eid, list] of Object.entries(byEmp)) {
  for (const a of list) await hr('POST', '/payroll/adjustments', { empId: ID[eid], month: month(m), ...a })
}
for (const [unit, v] of Object.entries(D2.INITIAL_FIXED_COSTS)) await hr('POST', '/payroll/budgets', { unit, fund: v.fund, items: v.items })
for (const m of ['2026-08', '2026-07']) { // bản gốc: 2 tháng trước đã chi trả (bảng tính lại từ chấm công: bản chụp rỗng)
  await hr('POST', '/payroll/runs', { month: month(m), action: 'approve', payslips: {} })
  await hr('POST', '/payroll/runs', { month: month(m), action: 'pay', sent: [] })
}

/* ---------- tuyển dụng ---------- */
const JD = {}, JOB = {}
for (const { id, updated: _u, ...jd } of D2.INITIAL_JDS) JD[id] = (await hr('POST', '/jds', jd)).id
for (const { id, ...j } of D2.INITIAL_JOBS) JOB[id] = (await hr('POST', '/jobs', { ...j, jdId: JD[j.jdId], deadline: day(j.deadline) })).id
for (const c of D2.INITIAL_CANDIDATES) {
  const cid = (await hr('POST', '/candidates', { jobId: JOB[c.jobId], name: c.name, email: c.email, phone: c.phone, source: c.source, cv: c.cv, exp: c.exp, applied: day(c.applied) })).id
  for (const { id: _i, candidateId: _c, ...iv } of D2.INITIAL_INTERVIEWS.filter(v => v.candidateId === c.id)) await hr('PATCH', `/candidates/${cid}`, { interview: { ...iv, date: day(iv.date) } })
  for (const r of c.reviews) await hr('PATCH', `/candidates/${cid}`, { review: { ...r, date: day(r.date) } })
  if (c.stage !== 'applied') await hr('PATCH', `/candidates/${cid}`, { stage: c.stage })
}

/* ---------- hiệu suất & đào tạo ---------- */
const period = p => D2.PERIODS[OLD_PERIODS.indexOf(p)] || p
for (const o of D2.INITIAL_OKRS) {
  const id = (await hr('POST', '/okrs', { period: period(o.period), title: o.title, owner: ID[o.owner], krs: o.krs.map(k => ({ ...k, owner: ID[k.owner] })) })).id
  for (const [i, k] of o.krs.entries()) if (k.current) await hr('POST', `/okrs/${id}/kr`, { krId: i + 1, current: k.current })
}
const R = D2.REVIEW_PERIOD
await hr('POST', '/reviews', { period: R, action: 'launch', empIds: Object.keys(D2.INITIAL_REVIEWS).map(k => ID[k]) })
for (const [eid, r] of Object.entries(D2.INITIAL_REVIEWS)) {
  if (r.self) await hr('POST', '/reviews', { period: R, action: 'self', empId: ID[eid], scores: r.self, note: r.selfNote || '' })
  if (r.mgr) await hr('POST', '/reviews', { period: R, action: 'mgr', empId: ID[eid], scores: r.mgr, note: r.mgrNote || '' })
}
const C = {}
for (const { id, ...c } of D2.COURSES) C[id] = (await hr('POST', '/courses', c)).id
for (const { id: _i, ...p } of D2.LEARNING_PATHS) await hr('POST', '/paths', { ...p, courses: p.courses.map(c => C[c]) })
for (const [eid, m] of Object.entries(D2.INITIAL_ENROLL)) await hr('POST', '/enroll', { empId: ID[eid], courses: Object.fromEntries(Object.entries(m).map(([c, v]) => [C[c], v])) })

/* ---------- phân quyền & nhật ký ---------- */
await hr('POST', '/security', {
  perms: { hradmin: D2.DEFAULT_PERMS.hradmin, manager: D2.DEFAULT_PERMS.manager, employee: D2.DEFAULT_PERMS.employee },
  maskSalary: D2.SECURITY_SETTINGS.maskSalary.value,
  ui: { settings: Object.fromEntries(Object.entries(D2.SECURITY_SETTINGS).map(([k, v]) => [k, v.value])), session: '30 phút', branches: {},
    roleUsers: Object.fromEntries(Object.entries(D2.ROLES).map(([k, r]) => [k, ID[r.userId]])) },
})
// cũ trước, từng lệnh (mỗi dòng 1 thời điểm ghi -> giữ đúng thứ tự)
for (const { id: _i, ...a } of [...D2.INITIAL_AUDIT].reverse()) await hr('POST', '/audit', { entries: [{ ...a, time: label(a.time), target: label(a.target) }] })

/* ---------- kiểm tra đọc lại ---------- */
const [st, at, pr, tl, sec] = await Promise.all([hr('GET', ''), hr('GET', `/attendance?from=${from}&to=${D.addDaysIso(T1, 63)}`), hr('GET', '/payroll'), hr('GET', '/talent'), hr('GET', '/security')])
console.log(JSON.stringify({
  units: st.units.length, employees: st.employees.length, members: Object.values(st.members).flat().length,
  shifts: at.shifts.length, sites: at.sites.length, schedule: Object.keys(at.schedule).length, logs: at.logs.length, todayLogs: at.logs.filter(l => l.date === T1).length, requests: at.requests.length,
  runs: Object.fromEntries(Object.entries(pr.runs).map(([m, r]) => [m, r.status])), adjustments: Object.values(pr.adjustments).flatMap(Object.values).flat().length, budgets: Object.keys(pr.fixed).length,
  jds: tl.jds.length, jobs: tl.jobs.length, candidates: tl.candidates.length, interviews: tl.interviews.length, okrs: tl.okrs.length,
  reviews: Object.keys(tl.reviews[R] || {}).length, courses: tl.courses.length, paths: tl.paths.length, enrolled: Object.keys(tl.enroll).length,
  audit: sec.uiAudit.length, roleUsers: Object.keys(sec.ui.roleUsers || {}).length,
}, null, 1))
