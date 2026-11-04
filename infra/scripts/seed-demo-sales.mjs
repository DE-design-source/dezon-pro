#!/usr/bin/env node
/* Nạp dữ liệu mẫu trang Kinh doanh (bản 8686a37: LEADS trong frontend/src/data/kinhDoanhData.js + lịch sử chăm sóc mẫu
   seedInteractions của CustomerPage.jsx) vào công ty demo qua HTTP API của bản Go.
   Chạy: node infra/scripts/seed-demo-sales.mjs          (API=http://localhost:3100 mặc định)
   Đăng nhập bằng DEMO_LOGIN_USER / DEMO_LOGIN_PASSWORD trong backend/.env.test-login; chỉ chạy với tài khoản 'zz_*'.
   Chạy lại được: xoá hết khách hàng của công ty rồi nạp lại. Ngày mẫu dời theo số ngày giữa hôm nay và OLD_TODAY.
   Khách ở tu-van / dam-phan / thiet-ke tự sinh dự án ở Quản lý thiết kế + Quản lý dự án (bàn giao của máy chủ). */
import { readFileSync } from 'node:fs'
import { LEADS, STAGES } from '../../frontend/src/data/kinhDoanhData.js'

const API = (process.env.API || 'http://localhost:3100').replace(/\/$/, '')
const OLD_TODAY = '2026-09-28' // bản cũ không có hằng TODAY: lấy ngày sau createdAt mới nhất của LEADS (2026-09-27)

const env = Object.fromEntries(readFileSync(new URL('../../backend/.env.test-login', import.meta.url), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#') && s.includes('='))
  .map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]))
const user = env.DEMO_LOGIN_USER || ''
if (!user.startsWith('zz_')) { console.error(`Từ chối: tài khoản "${user}" không bắt đầu bằng zz_`); process.exit(1) }

const DAY = 86400000
const iso = t => new Date(t).toISOString().slice(0, 10)
const utc = d => Date.parse(d + 'T00:00:00Z')
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const shiftDays = Math.round((utc(today) - utc(OLD_TODAY)) / DAY)
const shift = d => iso(utc(d) + shiftDays * DAY)
const addDays = (d, n) => iso(utc(d) + n * DAY)
const fmtTy = v => v.toFixed(1).replace(/\.0$/, '') + ' tỷ'
const WON = ['chot-hd', 'thiet-ke', 'thi-cong']

/* = seedInteractions(l) của CustomerPage.jsx bản 8686a37 (start = createdAt đã dời) */
function seedInteractions(l, start) {
  const by = (l.assignees && l.assignees[0]?.name) || l.creator || 'Nhân viên KD'
  const idx = Math.max(0, STAGES.indexOf(l.stage))
  const steps = [
    { type: 'call', title: 'Cuộc gọi đầu tiên', content: `Khách liên hệ qua hotline, quan tâm ${(l.type || 'công trình').toLowerCase()} khoảng ${fmtTy(l.value)}. Đã giới thiệu năng lực & hẹn gặp.`, outcome: 'good' },
    { type: 'meeting', title: 'Gặp tư vấn tại văn phòng', content: 'Trao đổi nhu cầu, phong cách mong muốn, ngân sách & tiến độ dự kiến. Khách gửi bản vẽ hiện trạng.', outcome: 'good' },
    { type: 'site', title: 'Khảo sát hiện trạng', content: 'Đo đạc hiện trạng, chụp ảnh, ghi nhận vướng mắc về kết cấu & hạ tầng.', outcome: 'neutral' },
    { type: 'quote', title: 'Gửi báo giá thiết kế - khái toán', content: `Báo giá tổng ${fmtTy(l.value)}; khách xin thêm phương án vật liệu tiết kiệm.`, outcome: 'neutral' },
    { type: 'meeting', title: 'Đàm phán điều khoản', content: 'Thống nhất tiến độ thanh toán 30-40-30, khách đề nghị giảm 3%.', outcome: 'neutral' },
    { type: 'meeting', title: 'Ký hợp đồng', content: 'Khách ký hợp đồng, chuyển tạm ứng đợt 1.', outcome: 'good' },
  ]
  const n = l.stage === 'truot-thau' ? 3 : Math.min(steps.length, idx + 1)
  const list = steps.slice(0, n).map((s, i) => ({ date: addDays(start, i * 4), by, ...s }))
  if (l.stage === 'truot-thau') list.push({ date: addDays(start, 14), by, type: 'call', title: 'Khách chọn đơn vị khác', content: 'Khách phản hồi giá cao hơn đối thủ ~8%. Lưu hồ sơ để chăm sóc lại sau 6 tháng.', outcome: 'bad' })
  if (l.notes) list.push({ date: start, by: l.creator || by, type: 'note', title: 'Ghi chú khi tạo khách hàng', content: l.notes, outcome: '' })
  return list
}

let token = ''
async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : null) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok || (data && data.error)) throw new Error(`${method} ${path}: ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data && (data.error || data))}`)
  return data && data.result !== undefined ? data.result : data // { result } như http.js của giao diện
}

const login = await call('POST', '/api/login', { args: [user, env.DEMO_LOGIN_PASSWORD || ''] })
token = (login && login.token) || ''
if (!token) throw new Error('Đăng nhập không trả token')

const old = (await call('GET', '/api/v1/sales/leads')).leads || []
for (const l of old) await call('DELETE', '/api/v1/sales/leads/' + l.id)

/* Ngày chốt rải đều cho biểu đồ "Doanh số theo thời gian": khách chốt sớm nhất -> 4 tháng trước ... khách chốt mới nhất -> hôm nay
   (rơi vào tuần này); ngày 15 của mỗi tháng, không sớm hơn ngày tạo. */
const wonOrder = LEADS.filter(l => WON.includes(l.stage)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
const wonDate = l => {
  const back = wonOrder.length - 1 - wonOrder.indexOf(l)
  if (back === 0) return today
  const [y, m] = today.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - back, 15))
  return [iso(d.getTime()), shift(l.createdAt)].sort()[1]
}

let acts = 0
for (const l of LEADS) {
  const createdAt = shift(l.createdAt)
  const wonAt = WON.includes(l.stage) ? wonDate(l) : undefined
  const saved = await call('POST', '/api/v1/sales/leads', {
    name: l.name, projectType: l.type, valueVnd: Math.round(l.value * 1e9), stage: l.stage, sub: l.sub || '', dept: l.dept,
    creator: l.creator, manager: l.manager, partner: !!l.partner, createdAt, wonAt,
  })
  for (const a of seedInteractions(l, createdAt)) { await call('POST', `/api/v1/sales/leads/${saved.id}/activities`, a); acts++ }
}
console.log(`Xong: xoá ${old.length} khách cũ, nạp ${LEADS.length} khách + ${acts} lần chăm sóc (dời ngày ${shiftDays >= 0 ? '+' : ''}${shiftDays}, ${OLD_TODAY} -> ${today}) vào ${API}`)
