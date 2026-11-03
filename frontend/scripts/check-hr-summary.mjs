// Kiểm công thức tổng hợp công & phép (src/data/hrData.js monthlySummary) - chạy: npm run test:hr
import assert from 'node:assert/strict'
import { syncAttendance, monthlySummary, leaveDaysOf } from '../src/data/hrData.js'

const ok = [{ state: 'done' }]
const emp = (id, o) => ({ id, status: 'active', joinDate: '2025-01-01', leaveDate: null, ...o })
const log = (empId, date, inT = '08:00', out = '17:00') => ({ empId, date, in: inT, out })
syncAttendance({
  shifts: [{ id: 'HC', start: '08:00', end: '17:00' }],
  schedule: { 1: ['HC', 'HC', 'HC', 'HC', 'HC', 'off', 'off'], 2: ['HC', 'HC', 'HC', 'HC', 'HC', 'off', 'off'] }, // 3, 4, 5: chưa có lịch -> T2–T6
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

// vào làm 25/11: công chuẩn cả tháng (21 ngày T2–T6) -> lương theo tỉ lệ 4/21
assert.equal(rows[1].std, 21); assert.equal(rows[1].total, 4)
// nửa ngày phép + có giờ vào = 1 công (không đếm 1,5); thứ Bảy ngoài lịch không tính công
assert.equal(rows[2].paidLeave, 0.5); assert.equal(rows[2].worked, 0.5); assert.equal(rows[2].total, 1); assert.equal(rows[2].extra, 1)
// nghỉ việc 10/11: vẫn có trong tháng 11; nghỉ từ 31/10: không có
assert.ok(rows[3]); assert.equal(rows[6], undefined)
// nghỉ phép T2..T7 với lịch T2–T6: tính 5 ngày ở cả phép có lương lẫn phép đã dùng, khớp gợi ý của form
assert.equal(rows[4].paidLeave, 5); assert.equal(rows[4].used, 5); assert.equal(leaveDaysOf(4, '2026-11-09', '2026-11-14'), 5)
// vào làm 15/09/2026: tích luỹ 3 tháng (9, 10, 11) = 3 ngày
assert.equal(rows[5].accrued, 3)
console.log('check-hr-summary: ok')
