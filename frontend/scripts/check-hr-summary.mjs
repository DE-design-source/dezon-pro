// Kiểm công thức tổng hợp công & phép (src/data/hrData.js monthlySummary) - chạy: npm run test:hr
import assert from 'node:assert/strict'
import { syncAttendance, monthlySummary, leaveDaysOf } from '../src/data/hrData.js'

const ok = [{ state: 'done' }]
const emp = (id, o) => ({ id, status: 'active', joinDate: '2025-01-01', leaveDate: null, ...o })
const log = (empId, date, inT = '08:00', out = '17:00') => ({ empId, date, in: inT, out })
syncAttendance({
  shifts: [{ id: 'HC', start: '08:00', end: '17:00' }],
  schedule: { 1: ['HC', 'HC', 'HC', 'HC', 'HC', 'off', 'off'], 2: ['HC', 'HC', 'HC', 'HC', 'HC', 'off', 'off'] }, // 3, 4, 5: chưa có lịch -> T2–T7 (thứ 7 nửa ngày)
  overrides: {},
  logs: [
    log(1, '2026-11-25'), log(1, '2026-11-26'), log(1, '2026-11-27'), log(1, '2026-11-30'),
    log(2, '2026-11-02', '08:00', '12:00'), log(2, '2026-11-07'), // nửa ngày phép + có giờ vào; làm thứ Bảy (ngoài lịch)
  ],
  requests: [
    { empId: 2, type: 'leave', leaveKind: 'annual', from: '2026-11-02', to: '2026-11-02', days: 0.5, steps: ok },
    { empId: 4, type: 'leave', leaveKind: 'annual', from: '2026-11-09', to: '2026-11-14', days: 6, steps: ok }, // T2..T7
  ],
})
const rows = Object.fromEntries(monthlySummary([
  emp(1, { joinDate: '2026-11-25' }), emp(2), emp(3, { status: 'left', leaveDate: '2026-11-10' }),
  emp(4), emp(5, { joinDate: '2026-09-15' }), emp(6, { status: 'left', leaveDate: '2026-10-31' }),
], '2026-11').map(r => [r.emp.id, r]))

// công chuẩn chung: T2–T6 = 1, T7 = 0,5, CN nghỉ (11/2026: 21 + 4 x 0,5 = 23); vào làm 25/11: chỉ đếm từ ngày vào
// (25, 26, 27, 30 + nửa ngày T7 28 = 4,5) -> 4/4,5
assert.equal(rows[2].std, 23); assert.equal(rows[1].std, 4.5); assert.equal(rows[1].total, 4)
// nửa ngày phép + có giờ vào = 1 công (không đếm 1,5); thứ Bảy ngoài lịch không tính công
assert.equal(rows[2].paidLeave, 0.5); assert.equal(rows[2].worked, 0.5); assert.equal(rows[2].total, 1); assert.equal(rows[2].extra, 1)
// người đã nghỉ việc không có trong bảng tổng hợp (như bản gốc)
assert.equal(rows[3], undefined); assert.equal(rows[6], undefined)
// nghỉ phép T2..T7, chưa có lịch (coi như T2–T7, thứ 7 nửa ngày): 5,5 ngày ở cả phép có lương lẫn phép đã dùng, khớp gợi ý của form
assert.equal(rows[4].paidLeave, 5.5); assert.equal(rows[4].used, 5.5); assert.equal(leaveDaysOf(4, '2026-11-09', '2026-11-14'), 5.5)
// phép cộng dồn theo tháng trong năm (như bản gốc): tháng 11 = 12/12 x 11 = 11 ngày, kể cả người vào làm giữa năm
assert.equal(rows[5].accrued, 11)
// thứ 7 nửa ngày: có ca + giờ vào = 0,5 công; phép thứ 7 = 0,5
syncAttendance({ shifts: [{ id: 'HC', start: '08:00', end: '17:00' }, { id: 'HC7', start: '08:00', end: '12:00' }],
  schedule: { 7: ['HC', 'HC', 'HC', 'HC', 'HC', 'HC7', 'off'] }, overrides: {}, logs: [log(7, '2026-11-07', '08:00', '12:00')],
  requests: [{ empId: 7, type: 'leave', leaveKind: 'annual', from: '2026-11-13', to: '2026-11-14', days: 1.5, steps: ok }] })
const sat = monthlySummary([emp(7)], '2026-11')[0]
assert.equal(sat.worked, 0.5); assert.equal(sat.paidLeave, 1.5); assert.equal(sat.early, 0); assert.equal(leaveDaysOf(7, '2026-11-13', '2026-11-14'), 1.5)
console.log('check-hr-summary: ok')
