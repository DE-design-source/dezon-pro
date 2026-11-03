/* REST /api/v1/hr (backend/internal/modules/hr). Mọi lệnh ghi trả lại toàn bộ dữ liệu HR của công ty:
   { units, heads: {key: id}, members: {key: [{id, pct, title, allowance}]}, employees } - đúng dạng state của trang. */
import { request, enc } from '../QS/api/http'

export const load = () => request('GET', '/hr')
export const createEmployee = e => request('POST', '/hr/employees', { body: e })
export const updateEmployee = (id, patch) => request('PATCH', '/hr/employees/' + enc(id), { body: patch })
export const deleteEmployee = id => request('DELETE', '/hr/employees/' + enc(id))
/* { units, employees, deleteMembers, members, deleteUnits } - chạy trong 1 transaction (xem hr/org.go) */
export const saveOrg = ops => request('POST', '/hr/org', { body: ops })

/* Chấm công & phép (hr/attendance.go): lệnh ghi trả {ok}, giao diện đọc lại loadAttendance */
export const loadAttendance = (from, to) => request('GET', '/hr/attendance?from=' + enc(from) + '&to=' + enc(to))
/* { shifts: [{id, orig, name, start, end, breakMin, tone, note}], deleteShifts: [mã], schedule: {empId: [7 mã ca | 'off']} } */
export const saveShifts = ops => request('POST', '/hr/shifts', { body: ops })
export const saveLogs = logs => request('POST', '/hr/logs', { body: { logs } })
export const createRequest = r => request('POST', '/hr/requests', { body: r })
export const decideRequest = (id, approve, note) => request('POST', '/hr/requests/' + enc(id) + '/decide', { body: { approve, note } })

/* Lương & bảo hiểm (hr/payroll.go): lệnh ghi trả {ok}, giao diện đọc lại loadPayroll */
export const loadPayroll = () => request('GET', '/hr/payroll')
export const savePayrollConfig = config => request('POST', '/hr/payroll/config', { body: { config } })
export const addAdjustment = a => request('POST', '/hr/payroll/adjustments', { body: a })
export const deleteAdjustment = id => request('DELETE', '/hr/payroll/adjustments/' + enc(id))
/* { month, action: close | open | approve | pay | reopen, payslips? } */
export const runAction = r => request('POST', '/hr/payroll/runs', { body: r })
export const saveBudget = b => request('POST', '/hr/payroll/budgets', { body: b })

/* Tuyển dụng + hiệu suất & đào tạo (hr/talent.go): lệnh ghi trả {ok, id?}, giao diện đọc lại loadTalent */
export const loadTalent = () => request('GET', '/hr/talent')
export const saveJd = jd => request('POST', '/hr/jds', { body: jd })
export const deleteJd = id => request('DELETE', '/hr/jds/' + enc(id))
export const saveJob = job => request('POST', '/hr/jobs', { body: job })
export const createCandidate = c => request('POST', '/hr/candidates', { body: c })
/* { stage?, hiredEmployeeId?, review?: {by, round, scores, note}, interview?: {date, time, round, interviewer, mode, place} } */
export const updateCandidate = (id, patch) => request('PATCH', '/hr/candidates/' + enc(id), { body: patch })
export const createOkr = o => request('POST', '/hr/okrs', { body: o })
export const setKr = (id, krId, current) => request('POST', '/hr/okrs/' + enc(id) + '/kr', { body: { krId, current } })
/* { period, action: launch (empIds) | self | mgr (empId, scores, note) } */
export const reviewAction = r => request('POST', '/hr/reviews', { body: r })
export const enroll = (empId, courses) => request('POST', '/hr/enroll', { body: { empId, courses } })

/* Phân quyền HR (hr/access.go) */
export const loadSecurity = () => request('GET', '/hr/security')
export const saveSecurity = s => request('POST', '/hr/security', { body: s })
/* { empId, role?, userId? ('' = bỏ gắn) } */
export const setUserRole = r => request('POST', '/hr/security/user', { body: r })
export const saveCourse = c => request('POST', '/hr/courses', { body: c })
export const deleteCourse = id => request('DELETE', '/hr/courses/' + enc(id))
export const savePath = p => request('POST', '/hr/paths', { body: p })
export const deletePath = id => request('DELETE', '/hr/paths/' + enc(id))
