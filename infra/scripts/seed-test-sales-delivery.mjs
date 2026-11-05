#!/usr/bin/env node
/* Nạp dữ liệu thử "như thật" cho 3 tab Kinh doanh (/kinh-doanh), Quản lý thiết kế (kind design), Quản lý dự án
   (kind construction) của công ty thử "Dezon Demo" - CHỈ qua HTTP API của bản Go (nạp qua API thật = phép thử API).
   Người phụ trách / thành viên lấy từ nhân sự HR thật của công ty (GET /api/v1/hr). Ngày tính theo hôm nay.
   Chạy (database thử qspro_gotest, server Go ở :3100):
     docker exec -i dezon-pro-db psql -U qspro -d qspro_gotest -v ON_ERROR_STOP=1 < infra/scripts/reset-demo-4tab.sql
     node infra/scripts/seed-test-sales-delivery.mjs        (API=http://localhost:3100 mặc định)
   Đăng nhập bằng DEMO_LOGIN_USER / DEMO_LOGIN_PASSWORD trong backend/.env.test-login; chỉ chạy với tài khoản 'zz_*'.
   Dừng nếu công ty đã có khách hàng / dự án (chạy file reset ở trên trước). Lỗi API được ghi lại, chạy tiếp, in cuối. */
import { readFileSync } from 'node:fs'

const API = (process.env.API || 'http://localhost:3100').replace(/\/$/, '')
const env = Object.fromEntries(readFileSync(new URL('../../backend/.env.test-login', import.meta.url), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#') && s.includes('='))
  .map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]))
const user = env.DEMO_LOGIN_USER || ''
if (!user.startsWith('zz_')) { console.error(`Từ chối: tài khoản "${user}" không bắt đầu bằng zz_`); process.exit(1) }

/* ---------- ngày ---------- */
const DAY = 86400000
const pad = n => String(n).padStart(2, '0')
const now = new Date()
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const utc = s => Date.parse(s + 'T00:00:00Z')
const iso = t => new Date(t).toISOString().slice(0, 10)
const D = n => iso(utc(TODAY) + n * DAY)
const add = (s, n) => iso(utc(s) + n * DAY)
const diff = (a, b) => Math.round((utc(b) - utc(a)) / DAY)

/* ---------- HTTP: lỗi ghi vào errors, trả null (chạy tiếp để thấy hết lỗi) ---------- */
let token = ''
const errors = []
const checks = []
async function raw(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : null) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  const err = !res.ok || (data && data.error) ? `${res.status} ${typeof data === 'string' ? data : JSON.stringify(data && (data.error || data))}` : ''
  return { err, data: data && data.result !== undefined ? data.result : data }
}
async function call(method, path, body) {
  const r = await raw(method, path, body)
  if (r.err) {
    errors.push({ method, path, body: body === undefined ? '' : JSON.stringify(body).slice(0, 300), error: r.err })
    console.error(`  LỖI ${method} ${path}: ${r.err}`)
    return null
  }
  return r.data
}
const check = (ok, msg) => { checks.push({ ok: !!ok, msg }); if (!ok) console.error('  KIỂM TRA SAI: ' + msg) }
const V1 = '/api/v1'

const login = await raw('POST', '/api/login', { args: [user, env.DEMO_LOGIN_PASSWORD || ''] })
token = (login.data && login.data.token) || ''
if (!token) { console.error('Đăng nhập không được: ' + login.err); process.exit(1) }

const leads0 = (await call('GET', V1 + '/sales/leads'))?.leads || []
const proj0 = []
for (const k of ['design', 'construction']) proj0.push(...((await call('GET', `${V1}/delivery/projects?kind=${k}`))?.projects || []))
if (process.argv.includes('--clean')) {
  // xoá qua API (không đụng HR như reset-demo-4tab.sql): xoá khách trước (dự án gắn khách bị xoá / bỏ liên kết), rồi dự án còn lại
  for (const l of leads0) await call('DELETE', `${V1}/sales/leads/${l.id}`)
  let n = 0
  for (const k of ['design', 'construction']) {
    for (const p of (await call('GET', `${V1}/delivery/projects?kind=${k}`))?.projects || []) if (await call('DELETE', `${V1}/delivery/projects/${p.id}`)) n++
  }
  console.log(`--clean: xoá ${leads0.length} khách hàng, ${n} dự án còn lại${errors.length ? `, ${errors.length} lỗi` : ''}`)
  process.exit(errors.length ? 1 : 0)
}
if (leads0.length || proj0.length) {
  console.warn(`Dừng: công ty đã có ${leads0.length} khách hàng, ${proj0.length} dự án. Chạy infra/scripts/reset-demo-4tab.sql trước.`)
  process.exit(2)
}

/* ---------- nhân sự HR thật ---------- */
const hr = await call('GET', V1 + '/hr')
if (!hr || !hr.employees) { console.error('Không đọc được nhân sự HR'); process.exit(1) }
const emps = hr.employees.filter(e => e.status !== 'left')
const byDept = d => emps.filter(e => e.dept === d).map(e => e.name)
const nameOf = id => (emps.find(e => e.id === id) || {}).name
const head = d => nameOf((hr.heads || {})[d]) || byDept(d)[0] || 'Chưa phân công'
const byPos = (d, re) => (emps.find(e => e.dept === d && re.test(e.position || '')) || {}).name || head(d)
const P = {
  kdddHead: head('kddd'), kdddStaff: byDept('kddd').filter(n => n !== head('kddd'))[0] || head('kddd'),
  kddaHead: head('kdda'), kddaStaff: byDept('kdda').filter(n => n !== head('kdda'))[0] || head('kdda'),
  tpTK: head('thietke'), kts: byPos('thietke', /Kiến trúc sư/i), ksKC: byPos('thietke', /kết cấu/i),
  cco: head('cco'), coo: head('coo'), chiHuy: byPos('thicong', /Chỉ huy/i), giamSat: byPos('thicong', /giám sát công trường/i),
  atld: byPos('thicong', /an toàn/i), doiA: byPos('thicong', /thi công A/i), doiB: byPos('thicong', /thi công B/i),
  tpQS: head('qs'), ksQS: byPos('qs', /Kỹ sư/i), tpMua: head('muahang'), cungUng: byPos('muahang', /cung ứng/i),
  ktt: head('tckt'), ktCT: byPos('tckt', /công trình/i), phoTC: byPos('tckt', /Phó/i), xuong: head('xuong'),
}

/* ===================================================== KINH DOANH ===================================================== */
const DD = 'dan-dung', DA = 'du-an'
const sales = dept => (dept === DD ? [P.kdddStaff, P.kdddHead] : [P.kddaStaff, P.kddaHead])
/* c = createdAt (ngày so với hôm nay), w = wonAt, s = người KD chính (0 = nhân viên, 1 = trưởng phòng) */
const LEADS = [
  { name: 'Anh Nguyễn Minh Khang', phone: '0903 418 225', email: 'khang.nguyenminh@gmail.com', address: '28/7 Đường số 9, P. Linh Tây, TP. Thủ Đức', dept: DD, stage: 'tiep-can', projectType: 'Nhà phố', scale: '5x20m, 1 trệt 2 lầu', value: 1.8, source: 'Website', c: -2, categories: ['Thiết kế kiến trúc', 'Thi công trọn gói (chìa khóa trao tay)'], concept: 'Hiện đại, tối giản', issue: 'đất trống, mới có sổ hồng' },
  { name: 'Chị Trần Lan Anh', phone: '0938 562 107', email: 'lananh.tran87@gmail.com', address: '15 Nguyễn Hữu Thọ, X. Nhơn Đức, H. Nhà Bè', dept: DD, stage: 'tiep-can', projectType: 'Biệt thự', scale: '320m² sàn, 3 tầng, có hồ bơi', value: 5.2, source: 'Giới thiệu', c: -6, s: 1, categories: ['Thiết kế kiến trúc', 'Thiết kế nội thất', 'Thiết kế cảnh quan'], concept: 'Nhiệt đới hiện đại', issue: 'nền đất yếu gần sông', notes: 'Khách do anh Phú (biệt thự Nam Viên) giới thiệu, ưu tiên chăm sóc.' },
  { name: 'Công ty CP Dược phẩm Ánh Dương', phone: '028 3862 4410', email: 'hanhchinh@anhduongpharma.vn', address: 'Tầng 12, 285 Cách Mạng Tháng 8, P.12, Q.10', dept: DA, stage: 'tiep-can', projectType: 'Văn phòng', scale: '450m², 60 chỗ ngồi', value: 2.6, source: 'Sự kiện', c: -9, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Văn phòng xanh, mở', issue: 'mặt bằng thô của toà nhà' },
  { name: 'Chị Lê Bích Ngọc', phone: '0909 731 584', email: 'bichngoc.le@yahoo.com', address: '42 Đường số 12, KDC Thảo Điền, P. Thảo Điền, TP. Thủ Đức', dept: DD, stage: 'tu-van', projectType: 'Biệt thự', scale: 'song lập 3 tầng, 280m² sàn', value: 6.0, source: 'Giới thiệu', c: -21, s: 1, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Indochine pha hiện đại', issue: 'trần tầng 2 bị thấm, cần xử lý trước khi làm nội thất', designer: true,
    handoff: { status: 'pending-handoff', dept: 'Thiết kế', requestedAt: D(2) + 'T09:30', assignee: P.kts } },
  { name: 'Anh Phạm Hoàng Long', phone: '0977 205 316', email: 'hoanglong.pham@gmail.com', address: '118/4 Phan Huy Ích, P.15, Q. Gò Vấp', dept: DD, stage: 'tu-van', projectType: 'Nhà phố', scale: '4,5x18m, 1 trệt 3 lầu, sân thượng', value: 2.3, source: 'Mạng xã hội', c: -15, categories: ['Thiết kế kiến trúc', 'Thi công phần thô', 'Thi công phần hoàn thiện cơ bản'], concept: 'Hiện đại, nhiều ánh sáng', issue: 'nhà cũ cần tháo dỡ, hẻm xe tải nhỏ vào được', designer: true },
  { name: 'Công ty TNHH Minh Phát Logistics', phone: '028 3811 9076', email: 'admin@minhphatlogistics.vn', address: 'Lô C4, KCN Tân Bình, P. Tây Thạnh, Q. Tân Phú', dept: DA, stage: 'tu-van', projectType: 'Văn phòng', scale: 'văn phòng điều hành 600m²', value: 4.8, source: 'Website', c: -32, categories: ['Thiết kế nội thất', 'Thi công nội thất', 'Cung cấp đồ rời'], concept: 'Công nghiệp (industrial)', issue: 'trần nhà xưởng cao 7m, cần làm sàn mezzanine', designer: true },
  { name: 'Chị Đặng Minh Thư', phone: '0918 640 293', email: 'minhthu.dang@gmail.com', address: 'Căn L5-2306, Vinhomes Central Park, 208 Nguyễn Hữu Cảnh, Bình Thạnh', dept: DD, stage: 'bao-gia', projectType: 'Căn hộ', scale: '3PN, 128m²', value: 1.2, source: 'Giới thiệu', c: -38, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Japandi', issue: 'căn bàn giao cơ bản, muốn đổi vị trí bếp',
    handoff: { status: 'self-quoted', dept: 'QS', requestedAt: null, assignee: null }, viaTuVan: true },
  { name: 'Công ty CP Thời trang Elise Việt', phone: '028 3910 5528', email: 'project@elisevn.com', address: '168 Hai Bà Trưng, P. Đa Kao, Q.1', dept: DA, stage: 'bao-gia', projectType: 'Showroom', scale: '2 tầng, 380m²', value: 3.4, source: 'Sự kiện', c: -45, s: 1, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Sang trọng, tông kem - vàng đồng', issue: 'mặt tiền kính cũ phải thay toàn bộ',
    handoff: { status: 'pending-qs', dept: 'QS', requestedAt: D(1) + 'T14:00', assignee: P.tpQS } },
  { name: 'Nhà hàng Hải Sản Biển Đông', phone: '0908 115 672', email: 'biendong.seafood@gmail.com', address: '25 Tôn Dật Tiên, P. Tân Phong, Q.7', dept: DA, stage: 'dam-phan', projectType: 'Nhà hàng', scale: '2 tầng, 520m², 220 chỗ', value: 3.9, source: 'Giới thiệu', c: -58, partner: true, categories: ['Thiết kế nội thất', 'Thi công nội thất', 'Cung cấp đồ rời'], concept: 'Biển, gỗ tự nhiên - xanh navy', issue: 'bếp cần hệ hút khói công nghiệp và bẫy mỡ' },
  { name: 'Chị Võ Hải Yến', phone: '0933 287 914', email: 'haiyen.vo@gmail.com', address: '9 Đường số 2, KDC Phú Xuân, X. Phước Kiển, H. Nhà Bè', dept: DD, stage: 'dam-phan', projectType: 'Biệt thự', scale: 'ven sông 3 tầng, 410m² sàn', value: 7.2, source: 'Giới thiệu', c: -70, s: 1, categories: ['Thiết kế kiến trúc', 'Thiết kế nội thất', 'Thi công trọn gói (chìa khóa trao tay)'], concept: 'Tân cổ điển tối giản', issue: 'kè bờ sông chưa có, cần khảo sát địa chất' },
  { name: 'Anh Lý Phúc Nguyên', phone: '0986 432 108', email: 'phucnguyen.ly@gmail.com', address: '76 Lũy Bán Bích, P. Tân Thới Hòa, Q. Tân Phú', dept: DD, stage: 'chot-hd', projectType: 'Nhà phố', scale: '5x22m, 1 trệt 3 lầu', value: 2.4, source: 'Website', c: -52, w: -26, categories: ['Thiết kế kiến trúc', 'Thi công trọn gói (chìa khóa trao tay)'], concept: 'Hiện đại, mặt tiền lam gỗ', issue: 'nhà cũ 2 tầng cần xin phép phá dỡ' },
  { name: 'Công ty CP Đầu tư Hưng Thịnh Land', phone: '028 3622 7781', email: 'duan@hungthinhland.vn', address: '35 Song Hành, P. An Phú, TP. Thủ Đức', dept: DA, stage: 'chot-hd', projectType: 'Showroom', scale: 'sales gallery 300m²', value: 2.9, source: 'Sự kiện', c: -40, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Hiện đại, điểm nhấn LED', issue: 'nhà tiền chế, thi công gấp trong 45 ngày', viaDamPhan: true },
  { name: 'Anh Trương Văn Sơn', phone: '0912 803 456', email: 'son.truongvan@gmail.com', address: '214/9 Nguyễn Đình Chiểu, P. Võ Thị Sáu, Q.3', dept: DD, stage: 'bao-gia-thi-cong', projectType: 'Nhà phố', scale: 'cải tạo 4x16m, 3 tầng', value: 1.6, source: 'Giới thiệu', c: -80, categories: ['Thi công phần hoàn thiện cơ bản', 'Thi công nội thất'], concept: 'Giữ khung cũ, làm mới nội thất', issue: 'tường giáp ranh nứt, cần gia cố',
    handoff: { status: 'pending-qs', dept: 'QS', requestedAt: D(3) + 'T10:00', assignee: P.ksQS } },
  { name: 'Chuỗi cà phê Mộc Lam', phone: '0907 650 381', email: 'moclam.coffee@gmail.com', address: '102 Phan Xích Long, P.2, Q. Phú Nhuận', dept: DA, stage: 'bao-gia-thi-cong', projectType: 'Nhà hàng', scale: 'quán cà phê 2 tầng, 260m²', value: 1.1, source: 'Mạng xã hội', c: -64, categories: ['Thi công nội thất', 'Cung cấp đồ rời'], concept: 'Mộc, gạch thẻ, nhiều cây xanh', issue: 'cần thi công đêm vì mặt bằng đang kinh doanh',
    handoff: { status: 'self-quoted', dept: 'QS', requestedAt: null, assignee: null } },
  { name: 'Chị Nguyễn Ngọc Diễm', phone: '0939 174 625', email: 'ngocdiem.ng@gmail.com', address: '57 Nguyễn Văn Đậu, P.6, Q. Bình Thạnh', dept: DD, stage: 'thiet-ke', sub: 'concept', projectType: 'Nhà phố', scale: '6x20m, 1 trệt 2 lầu, tum', value: 2.6, source: 'Website', c: -95, w: -62, categories: ['Thiết kế kiến trúc', 'Thiết kế nội thất'], concept: 'Scandinavian', issue: 'lộ giới mở rộng 1,5m phía trước' },
  { name: 'Anh Hồ Bảo Long', phone: '0903 925 418', email: 'baolong.ho@gmail.com', address: 'Lô B7, KDC Lucasta Khang Điền, P. Phú Hữu, TP. Thủ Đức', dept: DD, stage: 'thiet-ke', sub: 'review', projectType: 'Biệt thự', scale: 'đơn lập 4 tầng, 520m² sàn', value: 5.4, source: 'Giới thiệu', c: -120, w: -95, s: 1, partner: true, categories: ['Thiết kế kiến trúc', 'Thiết kế nội thất', 'Thiết kế cảnh quan'], concept: 'Hiện đại sang trọng, đá & gỗ óc chó', issue: 'cần thang máy gia đình và hầm để xe' },
  { name: 'Công ty CP Công nghệ Sao Việt', phone: '028 3948 2205', email: 'office@saovietcorp.vn', address: 'Tầng 8, Etown 2, 364 Cộng Hòa, P.13, Q. Tân Bình', dept: DA, stage: 'thiet-ke', sub: 'drafting', projectType: 'Văn phòng', scale: '900m², 120 chỗ ngồi', value: 4.5, source: 'Website', c: -75, w: -2, categories: ['Thiết kế nội thất', 'Thi công nội thất', 'Cung cấp đồ rời'], concept: 'Văn phòng công nghệ, khu pantry mở', issue: 'phải theo quy định thi công của toà nhà (chỉ làm ồn sau 18h)' },
  { name: 'Anh Lâm Quang Huy', phone: '0976 318 042', email: 'quanghuy.lam@gmail.com', address: 'Lô B12, KDC Bình Chánh, X. Bình Hưng, H. Bình Chánh', dept: DD, stage: 'thi-cong', sub: 'structure', projectType: 'Nhà phố', scale: '5x20m, 1 trệt 3 lầu', value: 2.1, source: 'Website', c: -178, w: -148, categories: ['Thiết kế kiến trúc', 'Thi công trọn gói (chìa khóa trao tay)'], concept: 'Hiện đại', issue: 'nền đất ruộng cũ, phải ép cọc' },
  { name: 'Công ty TNHH Vận tải Đông Á', phone: '028 3930 6618', email: 'admin@dongatransport.vn', address: '45 Võ Văn Tần, P. Võ Thị Sáu, Q.3', dept: DA, stage: 'thi-cong', sub: 'finishing', projectType: 'Văn phòng', scale: 'văn phòng cho thuê 1.200m², 3 sàn', value: 8.6, source: 'Giới thiệu', c: -170, w: -124, s: 1, partner: true, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Văn phòng hạng B+, trung tính', issue: 'toà nhà 1998, hệ PCCC phải làm lại theo QCVN 06' },
  { name: 'Anh Trịnh Gia Phú', phone: '0908 667 129', email: 'giaphu.trinh@gmail.com', address: 'Biệt thự Nam Viên, Đ. Nguyễn Đức Cảnh, P. Tân Phong, Q.7', dept: DD, stage: 'thi-cong', sub: 'finishing', projectType: 'Biệt thự', scale: '4 tầng, 680m² sàn', value: 11.8, source: 'Giới thiệu', c: -165, w: -110, s: 1, categories: ['Thiết kế nội thất', 'Thi công nội thất', 'Cung cấp đồ rời'], concept: 'Tân cổ điển, đá marble', issue: 'cải tạo trên biệt thự hiện hữu, giữ kết cấu' },
  { name: 'Anh Đỗ Trọng Tấn', phone: '0965 210 847', email: 'trongtan.do@gmail.com', address: '33 Đường số 6, P. Bình Trị Đông B, Q. Bình Tân', dept: DD, stage: 'truot-thau', projectType: 'Nhà phố', scale: '4x20m, 1 trệt 2 lầu', value: 2.7, source: 'Mạng xã hội', c: -50, categories: ['Thi công phần thô', 'Thi công phần hoàn thiện cơ bản'], concept: 'Hiện đại', issue: 'chủ nhà muốn tự mua vật tư', lostReason: 'Khách chọn nhà thầu khác giá thấp hơn khoảng 9%.' },
  { name: 'Công ty CP BĐS Phúc Khang Home', phone: '028 3514 8830', email: 'marketing@phuckhanghome.vn', address: '88 Mai Chí Thọ, P. An Lợi Đông, TP. Thủ Đức', dept: DA, stage: 'truot-thau', projectType: 'Showroom', scale: 'nhà mẫu và sales gallery 250m²', value: 1.9, source: 'Sự kiện', c: -100, categories: ['Thiết kế nội thất', 'Thi công nội thất'], concept: 'Hiện đại', issue: 'tiến độ chỉ 30 ngày', lostReason: 'Chủ đầu tư dời dự án sang quý 2/2027, tạm dừng mời thầu.' },
]
const WON = new Set(['chot-hd', 'thiet-ke', 'thi-cong'])
const SYNC = new Set(['tu-van', 'dam-phan', 'thiet-ke'])
const tyText = v => String(v).replace('.', ',') + ' tỷ'

/* Lịch sử chăm sóc theo giai đoạn: 2-6 lần, ngày rải từ ngày tạo tới ngày chốt / hôm nay; lần cuối có hẹn tiếp nếu còn theo */
function activities(l, i) {
  const by = sales(l.dept)[l.s || 0]
  const typ = (l.projectType + ' ' + l.scale).toLowerCase()
  const fee = Math.max(45, Math.round(l.value * 1000 * 0.035 / 5) * 5)
  const S = {
    call: { type: 'call', title: l.source === 'Giới thiệu' ? 'Gọi làm quen khách được giới thiệu' : `Gọi lại khách để lại thông tin (${l.source})`, content: `Khách cần ${typ}, ngân sách khoảng ${tyText(l.value)}. Đã giới thiệu năng lực, hẹn gửi hồ sơ công trình mẫu.`, outcome: 'good' },
    zalo: { type: 'zalo', title: 'Gửi hồ sơ năng lực qua Zalo', content: `Gửi 3 công trình ${l.projectType.toLowerCase()} tương tự. Khách thích phong cách ${l.concept.toLowerCase()}.`, outcome: i % 3 ? 'good' : 'neutral' },
    site: { type: 'site', title: 'Khảo sát hiện trạng', content: `Đo đạc, chụp ảnh tại ${l.address.split(',')[0]}. Ghi nhận: ${l.issue}.`, outcome: 'neutral' },
    concept: { type: 'meeting', title: 'Tư vấn concept tại văn phòng', content: `KTS ${P.kts} trình bày moodboard ${l.concept.toLowerCase()}; khách đồng ý hướng thiết kế, xin thêm 1 phương án mặt bằng.`, outcome: 'good' },
    quote: { type: 'quote', title: 'Gửi báo giá thiết kế & khái toán', content: `Phí thiết kế ${fee} triệu, khái toán thi công ${tyText(l.value)}. Khách hỏi thêm phương án vật liệu tiết kiệm.`, outcome: 'neutral' },
    quoteTC: { type: 'quote', title: 'Gửi báo giá thi công chi tiết', content: `Báo giá thi công ${tyText(l.value)} theo BOQ của phòng QS, hiệu lực 30 ngày.`, outcome: 'neutral' },
    email: { type: 'email', title: 'Gửi dự thảo hợp đồng', content: 'Gửi dự thảo hợp đồng và tiến độ thanh toán 4 đợt 30-30-30-10 để khách xem trước.', outcome: 'neutral' },
    deal: { type: 'meeting', title: 'Đàm phán điều khoản', content: `Khách đề nghị giảm ${2 + (i % 3)}% và bảo hành nội thất 24 tháng; đã trình ${sales(l.dept)[1]} duyệt mức giảm.`, outcome: 'neutral' },
    sign: { type: 'meeting', title: 'Ký hợp đồng', content: `Ký hợp đồng ${tyText(l.value)}, khách chuyển tạm ứng đợt 1. Chuẩn bị phiếu bàn giao cho phòng Thiết kế / Thi công.`, outcome: 'good' },
    handover: { type: 'note', title: 'Bàn giao hồ sơ cho đội thi công', content: `Đã bàn giao hồ sơ, BOQ và liên hệ khách cho ${P.chiHuy}.`, outcome: 'good' },
    lost: { type: 'call', title: 'Khách báo không chọn Dezon', content: (l.lostReason || '') + ' Lưu hồ sơ, hẹn chăm sóc lại sau 6 tháng.', outcome: 'bad' },
  }
  const plan = {
    'tiep-can': ['call', 'zalo'], 'tu-van': ['call', 'zalo', 'site', 'concept'], 'bao-gia': ['call', 'site', 'concept', 'quote'],
    'dam-phan': ['call', 'site', 'concept', 'quote', 'deal'], 'chot-hd': ['call', 'site', 'quote', 'deal', 'email', 'sign'],
    'bao-gia-thi-cong': ['call', 'site', 'concept', 'quoteTC'], 'thiet-ke': ['call', 'site', 'concept', 'quote', 'deal', 'sign'],
    'thi-cong': ['call', 'site', 'quote', 'deal', 'sign', 'handover'], 'truot-thau': ['call', 'site', 'quoteTC', 'lost'],
  }[l.stage]
  if (l.stage === 'tu-van' && i % 2) plan.splice(1, 1) // biến thể: bỏ bước Zalo
  const start = D(l.c), end = l.w != null ? D(l.w) : (l.stage === 'truot-thau' ? D(Math.min(-3, l.c + 40)) : TODAY)
  const span = Math.max(0, diff(start, end))
  const list = plan.map((k, j) => ({ ...S[k], by, date: add(start, plan.length > 1 ? Math.round(j * span / (plan.length - 1)) : 0) }))
  if (l.handover && list.length) list[list.length - 1].date = end
  const last = list[list.length - 1]
  const followUp = {
    'tiep-can': 'Hẹn khảo sát hiện trạng', 'tu-van': 'Trình concept lần 2', 'bao-gia': 'Gọi chốt báo giá', 'dam-phan': 'Gặp chốt điều khoản hợp đồng',
    'bao-gia-thi-cong': 'Gọi xác nhận báo giá thi công', 'chot-hd': 'Họp kick-off với phòng Thiết kế', 'thiet-ke': 'Lấy ý kiến khách về hồ sơ thiết kế',
    'thi-cong': 'Ghé công trình cùng khách', 'truot-thau': 'Chăm sóc lại khách',
  }[l.stage]
  last.next = l.stage === 'truot-thau' ? add(end, 180) : D(2 + (i % 6))
  last.nextNote = followUp
  if (l.notes) list.unshift({ type: 'note', title: 'Ghi chú khi tạo khách hàng', content: l.notes, outcome: '', date: start, by: sales(l.dept)[1] })
  return list.slice(-6)
}

console.log(`Nạp vào ${API}, hôm nay ${TODAY}`)
const leadIds = {}
let actCount = 0
for (let i = 0; i < LEADS.length; i++) {
  const l = LEADS[i]
  const [staff, mgr] = sales(l.dept)
  const assignees = [{ name: sales(l.dept)[l.s || 0], role: 'Kinh doanh' }]
  if (l.designer || l.stage === 'thiet-ke') assignees.push({ name: P.kts, role: 'Thiết kế - Tư vấn' })
  if (l.stage === 'thi-cong') assignees.push({ name: P.chiHuy, role: 'Thi công - Tiếp nhận dự án' })
  if (l.stage === 'bao-gia-thi-cong' || l.stage === 'dam-phan') assignees.push({ name: P.tpQS, role: 'QS - Điều phối báo giá' })
  // test luồng giai đoạn: tạo ở giai đoạn trước rồi kéo sang giai đoạn thật (xem phần kiểm tra bên dưới)
  const firstStage = l.viaTuVan ? 'tu-van' : l.viaDamPhan ? 'dam-phan' : l.stage
  const body = {
    name: l.name, phone: l.phone, email: l.email, address: l.address, source: l.source, dept: l.dept, stage: firstStage, sub: l.sub || '',
    projectType: l.projectType, scale: l.scale, valueVnd: Math.round(l.value * 1e9), partner: !!l.partner, categories: l.categories,
    concept: l.concept, notes: l.notes || '', creator: staff, manager: mgr, assignees, createdAt: D(l.c),
  }
  if (WON.has(firstStage) && l.w != null) body.wonAt = D(l.w)
  if (l.handoff) body.handoff = l.handoff
  const saved = await call('POST', V1 + '/sales/leads', body)
  if (!saved) continue
  leadIds[i] = saved.id
  check(saved.createdAt === D(l.c), `lead ${l.name}: createdAt ${saved.createdAt} = ${D(l.c)}`)
  if (WON.has(firstStage) && l.w != null) check(saved.wonAt === D(l.w), `lead ${l.name}: wonAt ${saved.wonAt} = ${D(l.w)}`)
  check(saved.valueVnd === Math.round(l.value * 1e9), `lead ${l.name}: valueVnd lưu đúng giá trị ước tính`)
  for (const a of activities(l, i)) if (await call('POST', `${V1}/sales/leads/${saved.id}/activities`, a)) actCount++
}
console.log(`Kinh doanh: ${Object.keys(leadIds).length}/${LEADS.length} khách, ${actCount} lần chăm sóc`)

/* ---------- kiểm tra quy tắc bàn giao (EnsureFromLead / DetachFromLead) ---------- */
async function listAll() {
  const out = {}
  for (const k of ['design', 'construction']) out[k] = (await call('GET', `${V1}/delivery/projects?kind=${k}`))?.projects || []
  return out
}
let all = await listAll()
for (let i = 0; i < LEADS.length; i++) {
  const l = LEADS[i], id = leadIds[i]
  if (!id) continue
  const firstStage = l.viaTuVan ? 'tu-van' : l.viaDamPhan ? 'dam-phan' : l.stage
  for (const k of ['design', 'construction']) {
    const ps = all[k].filter(p => p.leadId === id)
    if (SYNC.has(firstStage)) {
      check(ps.length === 1, `${l.name}: ${firstStage} -> đúng 1 dự án ${k} (có ${ps.length})`)
      if (ps[0]) check(ps[0].contractValueVnd === Math.round(l.value * 1e9), `${l.name}: dự án ${k} giá trị = giá trị ước tính (${ps[0].contractValueVnd})`)
    } else check(ps.length === 0, `${l.name}: ${firstStage} -> không có dự án ${k} (có ${ps.length})`)
  }
}
// Chị Minh Thư: tu-van -> bao-gia, dự án còn nguyên -> phải bị xoá
const iThu = LEADS.findIndex(l => l.viaTuVan)
if (leadIds[iThu]) {
  await call('PATCH', `${V1}/sales/leads/${leadIds[iThu]}`, { stage: 'bao-gia' })
  const a2 = await listAll()
  check(!a2.design.concat(a2.construction).some(p => p.leadId === leadIds[iThu]), 'Rời tu-van khi dự án còn nguyên -> dự án bị xoá')
}
// Hưng Thịnh Land: dam-phan, đội thiết kế đã thêm thành viên -> chot-hd: dự án thiết kế ẩn (giữ), dự án thi công (nguyên) xoá
const iHT = LEADS.findIndex(l => l.viaDamPhan)
let hiddenDesignId = null
if (leadIds[iHT]) {
  const dz = all.design.find(p => p.leadId === leadIds[iHT])
  if (dz) {
    hiddenDesignId = dz.id
    await call('POST', `${V1}/delivery/projects/${dz.id}/members`, { name: P.kts, role: 'KTS tư vấn', dept: 'concept' })
  }
  const up = await call('PATCH', `${V1}/sales/leads/${leadIds[iHT]}`, { stage: 'chot-hd' })
  if (up) check(up.wonAt === TODAY, `Kéo sang chot-hd -> wonAt = hôm nay (${up.wonAt})`)
  const a3 = await listAll()
  check(!a3.design.some(p => p.leadId === leadIds[iHT]), 'Rời dam-phan -> dự án thiết kế đã sửa bị ẩn khỏi danh sách')
  check(!a3.construction.some(p => p.leadId === leadIds[iHT]), 'Rời dam-phan -> dự án thi công còn nguyên bị xoá/ẩn')
  if (hiddenDesignId) {
    const g = await raw('GET', `${V1}/delivery/projects/${hiddenDesignId}`)
    check(!g.err && g.data && g.data.members && g.data.members.length === 1, `Dự án ẩn vẫn còn dữ liệu (GET chi tiết: ${g.err || 'ok'})`)
  }
}
all = await listAll()

/* ===================================================== DỰ ÁN ===================================================== */
const CORE_BUY = 'Mua hàng & cung ứng', CORE_FIN = 'Tài chính — dòng tiền'
const r5 = x => Math.round(x / 5) * 5
/* tiến độ theo hôm nay: xong trước hôm nay = 100 (trừ việc trễ: late = % đang dừng), chưa tới = 0, đang làm = tỉ lệ */
function prog(start, end, late) {
  if (end < TODAY) return late != null ? late : 100
  if (start > TODAY) return 0
  return Math.min(95, Math.max(5, r5((diff(start, TODAY) + 1) / (diff(start, end) + 1) * 100)))
}
const STD_FLOW = () => [
  { key: 'request', label: 'Gửi yêu cầu mua hàng', color: 'var(--notstarted)', depts: ['Ban chỉ huy công trường'], owners: [P.chiHuy] },
  { key: 'purchasing', label: 'Mua hàng', color: 'var(--accent)', depts: ['Phòng Mua hàng'], owners: [P.tpMua] },
  { key: 'approval', label: 'Quản lý duyệt', color: 'var(--progress)', depts: ['Ban giám đốc'], owners: [P.coo] },
  { key: 'accounting', label: 'Kế toán', color: '#8b6fd6', depts: ['Kế toán'], owners: [P.ktt] },
  { key: 'received', label: 'Nhận hàng', color: '#2a9bb0', depts: ['Kho công trường'], owners: [P.giamSat], received: true },
  { key: 'complete', label: 'Đủ hồ sơ', color: 'var(--done)', depts: ['Phòng Mua hàng'], owners: [P.cungUng], received: true },
  { key: 'cancelled', label: 'Hủy', color: 'var(--overdue)', depts: [], owners: [], closed: true },
]
const QUICK_FLOW = () => [
  { key: 'request', label: 'Gửi yêu cầu', color: 'var(--notstarted)', depts: ['Ban chỉ huy công trường'], owners: [P.chiHuy] },
  { key: 'purchasing', label: 'Mua hàng', color: 'var(--accent)', depts: ['Phòng Mua hàng'], owners: [P.cungUng] },
  { key: 'received', label: 'Nhận hàng', color: '#2a9bb0', depts: ['Kho công trường'], owners: [P.giamSat], received: true },
  { key: 'complete', label: 'Đủ hồ sơ', color: 'var(--done)', depts: ['Phòng Mua hàng'], owners: [P.cungUng], received: true },
  { key: 'cancelled', label: 'Hủy', color: 'var(--overdue)', depts: [], owners: [], closed: true },
]
const TENDER_FLOW = () => [
  { key: 'request', label: 'Gửi yêu cầu', color: 'var(--notstarted)', depts: ['Ban chỉ huy công trường'], owners: [P.chiHuy] },
  { key: 'quote', label: 'Lấy báo giá NCC', color: 'var(--accent)', depts: ['Phòng Mua hàng'], owners: [P.cungUng] },
  { key: 'compare', label: 'So sánh & đề xuất', color: '#d9822b', depts: ['QS'], owners: [P.tpQS] },
  { key: 'approval', label: 'Quản lý duyệt', color: 'var(--progress)', depts: ['Ban giám đốc'], owners: [P.coo] },
  { key: 'contract', label: 'Ký hợp đồng', color: '#c2185b', depts: ['Phòng Mua hàng'], owners: [P.tpMua] },
  { key: 'accounting', label: 'Kế toán tạm ứng', color: '#8b6fd6', depts: ['Kế toán'], owners: [P.ktt] },
  { key: 'received', label: 'Nhận hàng', color: '#2a9bb0', depts: ['Kho công trường'], owners: [P.giamSat], received: true },
  { key: 'complete', label: 'Đủ hồ sơ', color: 'var(--done)', depts: ['Phòng Mua hàng'], owners: [P.cungUng], received: true },
  { key: 'cancelled', label: 'Hủy', color: 'var(--overdue)', depts: [], owners: [], closed: true },
]
/* bước của đơn theo ngày cần hàng so với hôm nay */
function stageFor(flow, due) {
  const keys = flow.filter(s => !s.closed).map(s => s.key), d = diff(TODAY, due)
  if (d < -10) return keys[keys.length - 1]
  if (d < 0) return keys[keys.length - 2]
  if (d < 7) return keys[Math.floor(keys.length / 2)]
  if (d < 20) return keys[1]
  return keys[0]
}
let poSeq = 1100

/* Dựng 1 dự án: setup (PATCH), thành viên, thầu phụ, đề mục + công việc, mua hàng, thu/chi, bình luận.
   spec.s0 = ngày bắt đầu dự án; ngày công việc tính theo s0 + offset (ngày) * spec.k (hệ số co giãn). */
async function build(pid, spec) {
  const base = `${V1}/delivery/projects/${pid}`
  if (spec.setup) await call('PATCH', base, spec.setup)
  for (const m of spec.members || []) await call('POST', base + '/members', m)
  for (const s of spec.subs || []) await call('POST', base + '/subcontractors', s)
  const det = await call('GET', base)
  const core = {}
  for (const ph of det?.phases || []) core[ph.name] = ph.id
  const k = spec.k || 1, at = o => add(spec.s0, Math.round(o * k))
  const taskIds = {}
  for (let i = 0; i < (spec.phases || []).length; i++) {
    const src = spec.phases[i]
    const ph = await call('POST', base + '/phases', { name: src.name, sortOrder: i, members: src.members || [] })
    if (!ph) continue
    for (let j = 0; j < src.tasks.length; j++) {
      const [name, off, dur, o = {}] = src.tasks[j]
      const start = at(off), end = o.ms ? start : at(off + dur)
      const t = await call('POST', base + '/tasks', {
        phaseId: ph.id, name, start, end, progress: o.ms ? (start <= TODAY ? 100 : 0) : prog(start, end, o.late),
        critical: !!o.crit, milestone: !!o.ms, desc: o.desc || '', depts: o.depts || [], owners: o.owners || [], sortOrder: j,
      })
      if (t) taskIds[name] = t.id
    }
  }
  if (core[CORE_BUY] && spec.coreMembers) await call('PATCH', `${base}/phases/${core[CORE_BUY]}`, { name: CORE_BUY, members: spec.coreMembers.buy })
  if (core[CORE_FIN] && spec.coreMembers) await call('PATCH', `${base}/phases/${core[CORE_FIN]}`, { name: CORE_FIN, members: spec.coreMembers.fin })
  for (let j = 0; j < (spec.buy || []).length; j++) {
    const b = spec.buy[j]
    const start = at(b.off), end = at(b.off + b.dur), flow = b.flow ? b.flow() : null, fl = flow || STD_FLOW()
    const items = b.items.map(([item, supplier, qty, value, dueOff, extra = {}], n) => {
      const due = at(dueOff)
      return { id: `po-${pid}-${j}-${n}`, code: (stageFor(fl, due) === fl[0].key ? 'PR-' : 'PO-') + poSeq++, item, supplier, qty, value, due,
        owner: b.owner, stage: extra.cancel ? 'cancelled' : stageFor(fl, due), assignees: [b.owner], dept: 'Phòng Mua hàng' }
    })
    const t = await call('POST', base + '/tasks', {
      phaseId: core[CORE_BUY], name: b.name, start, end, progress: prog(start, end, b.late), critical: !!b.crit, sortOrder: j,
      owners: [b.owner], depts: ['Phòng Mua hàng'], purchaseItems: items, ...(flow ? { purchaseFlow: flow } : null),
    })
    if (t) taskIds[b.name] = t.id
  }
  for (let j = 0; j < (spec.fin || []).length; j++) {
    const [name, type, planOff, slip, amountVnd] = spec.fin[j]
    const plan = at(planOff), real = add(plan, slip)
    await call('POST', base + '/tasks', {
      phaseId: core[CORE_FIN], name, start: real, end: real, milestone: true, progress: real <= TODAY ? 100 : 0, finType: type,
      planStart: plan, amountVnd, confirmed: real <= TODAY, sortOrder: j, owners: [type === 'thu' ? P.ktt : P.phoTC], depts: ['Kế toán'],
    })
  }
  for (const [task, who, text] of spec.comments || []) {
    if (taskIds[task]) await call('POST', `${base}/tasks/${taskIds[task]}/comments`, { who, text })
    else errors.push({ method: 'SCRIPT', path: base, body: task, error: 'Không tìm thấy công việc để bình luận' })
  }
}

/* ---------- mẫu tiến độ (offset ngày tính từ ngày bắt đầu dự án) ---------- */
const own = (...xs) => ({ owners: xs })
function designPhases(o = {}) {
  return [
    { name: 'Khảo sát & tiếp nhận yêu cầu', members: [{ name: P.kts, role: 'KTS chủ trì' }], tasks: [
      ['Khảo sát hiện trạng & đo đạc', 0, 3, { ...own(P.kts), depts: ['Thiết kế'] }],
      ['Lập nhiệm vụ thiết kế', 3, 4, { ...own(P.kts) }],
      ['Ký hợp đồng thiết kế', 7, 0, { ms: true, ...own(P.tpTK) }],
    ] },
    { name: 'Thiết kế concept', members: [{ name: P.kts, role: 'KTS chủ trì' }, { name: P.tpTK, role: 'Duyệt thiết kế' }], tasks: [
      ['Moodboard & định hướng phong cách', 8, 5, { ...own(P.kts), crit: true }],
      ['Mặt bằng bố trí công năng (2 phương án)', 10, 7, { ...own(P.kts), crit: true, late: o.lateConcept }],
      ['Trình bày concept với chủ đầu tư', 18, 0, { ms: true, ...own(P.kts, P.tpTK) }],
    ] },
    { name: 'Diễn họa 3D', members: [{ name: P.kts, role: 'KTS 3D' }], tasks: [
      ['Dựng 3D phòng khách, bếp, ăn', 19, 8, { ...own(P.kts), crit: true }],
      ['Dựng 3D phòng ngủ, WC', 23, 8, { ...own(P.kts), late: o.late3d }],
      ['Chỉnh sửa 3D theo góp ý khách', 32, 5, { ...own(P.kts) }],
    ] },
    { name: 'Hồ sơ kỹ thuật thi công 2D', members: [{ name: P.ksKC, role: 'KS kết cấu' }, { name: P.ksQS, role: 'QS' }], tasks: [
      ['Bản vẽ bố trí, mặt bằng, mặt cắt', 38, 9, { ...own(P.kts), crit: true }],
      ['Bản vẽ điện, nước, trần đèn', 42, 8, { ...own(P.ksKC), depts: ['Thiết kế'] }],
      ['Bản vẽ chi tiết đồ gỗ nội thất', 46, 10, { ...own(P.kts), depts: ['Xưởng sản xuất'] }],
      ['Bóc khối lượng & dự toán', 54, 6, { ...own(P.ksQS), depts: ['QS'] }],
    ] },
    { name: 'Duyệt & bàn giao hồ sơ', members: [{ name: P.tpTK, role: 'Trưởng phòng Thiết kế' }], tasks: [
      ['Kiểm tra hồ sơ nội bộ', 60, 2, { ...own(P.tpTK) }],
      ['Bàn giao hồ sơ thiết kế', 63, 0, { ms: true, ...own(P.tpTK), crit: true }],
    ] },
  ]
}
const designFin = fee => [
  ['Thu phí thiết kế đợt 1 (50%)', 'thu', 7, 1, Math.round(fee * 0.5)],
  ['Thu phí thiết kế đợt 2 (30%) sau duyệt concept', 'thu', 19, 3, Math.round(fee * 0.3)],
  ['Chi thuê diễn họa 3D bên ngoài', 'chi', 30, 0, Math.round(fee * 0.12)],
  ['Thu phí thiết kế đợt cuối (20%)', 'thu', 64, 2, Math.round(fee * 0.2)],
]
const designBuy = () => [{ name: 'Mẫu vật liệu & in ấn hồ sơ', off: 20, dur: 40, owner: P.cungUng, flow: QUICK_FLOW, items: [
  ['Mẫu gỗ, đá, vải trình khách', 'An Cường, Đá Phú Tài', '1 bộ', 6, 22],
  ['In hồ sơ thiết kế A3 (3 bộ)', 'In ấn Sài Gòn Xanh', '3 bộ', 4, 62],
] }]
function buildPhases(o = {}) {
  return [
    { name: 'Chuẩn bị & khởi công', members: [{ name: P.chiHuy, role: 'Chỉ huy trưởng' }, { name: P.atld, role: 'An toàn lao động' }], tasks: [
      ['Xin phép xây dựng & thông báo khởi công', 0, 12, { ...own(P.chiHuy), crit: true }],
      ['Dọn dẹp, định vị tim mốc', 12, 3, { ...own(P.doiA) }],
      ['Khởi công', 15, 0, { ms: true, ...own(P.chiHuy) }],
    ] },
    { name: 'Thi công phần thô', members: [{ name: P.chiHuy, role: 'Chỉ huy trưởng' }, { name: P.doiA, role: 'Đội thi công A' }, { name: P.giamSat, role: 'KS giám sát' }], tasks: [
      ['Ép cọc & thi công móng', 15, 14, { ...own(P.doiA), crit: true }],
      [`Kết cấu khung tầng trệt - lầu ${o.mid || 1}`, 29, 20, { ...own(P.doiA), crit: true }],
      [`Kết cấu lầu ${(o.mid || 1) + 1} - mái`, 49, 22, { ...own(P.doiB), crit: true, late: o.lateStruct }],
      ['Xây tô tường bao che', 60, 20, { ...own(P.doiB) }],
      ['Cất nóc', 71, 0, { ms: true, ...own(P.chiHuy) }],
    ] },
    { name: 'Cơ điện (MEP)', members: [{ name: P.giamSat, role: 'KS giám sát MEP' }], tasks: [
      ['Đi ống điện nước âm tường, âm sàn', 66, 18, { ...own(P.giamSat), depts: ['Thầu phụ cơ điện'] }],
      ['Lắp tủ điện, thiết bị điện & vệ sinh', 104, 8, { ...own(P.giamSat) }],
    ] },
    { name: 'Hoàn thiện', members: [{ name: P.doiB, role: 'Đội hoàn thiện' }], tasks: [
      ['Cán nền, ốp lát gạch', 82, 14, { ...own(P.doiB), crit: true }],
      ['Trần thạch cao', 88, 10, { ...own(P.doiB) }],
      ['Lắp cửa nhôm kính, lan can', 94, 8, { ...own(P.giamSat), depts: ['Thầu phụ nhôm kính'] }],
      ['Sơn bả hoàn thiện', 98, 12, { ...own(P.doiB), crit: true }],
    ] },
    { name: 'Nội thất & bàn giao', members: [{ name: P.xuong, role: 'Xưởng mộc' }, { name: P.giamSat, role: 'KS giám sát' }], tasks: [
      ['Sản xuất & lắp đặt nội thất gỗ', 100, 16, { ...own(P.xuong), depts: ['Xưởng sản xuất'] }],
      ['Vệ sinh công nghiệp', 117, 3, { ...own(P.doiB) }],
      ['Nghiệm thu & bàn giao nhà', 121, 0, { ms: true, ...own(P.chiHuy, P.cco), crit: true }],
    ] },
  ]
}
function fitoutPhases(o = {}) {
  return [
    { name: 'Tiếp nhận mặt bằng & tháo dỡ', members: [{ name: P.chiHuy, role: 'Chỉ huy trưởng' }], tasks: [
      ['Làm hồ sơ thi công với BQL toà nhà', 0, 7, { ...own(P.chiHuy), crit: true }],
      ['Tháo dỡ trần, vách cũ & vận chuyển xà bần', 7, 6, { ...own(P.doiA) }],
      ['Bắt đầu thi công', 7, 0, { ms: true, ...own(P.chiHuy) }],
    ] },
    { name: 'Vách ngăn & trần', members: [{ name: P.doiA, role: 'Đội thi công A' }], tasks: [
      ['Dựng khung vách thạch cao, vách kính', 13, 12, { ...own(P.doiA), crit: true }],
      ['Trần thạch cao & trần nan gỗ', 20, 14, { ...own(P.doiA), late: o.lateCeil }],
    ] },
    { name: 'Cơ điện, PCCC & điều hoà', members: [{ name: P.giamSat, role: 'KS giám sát MEP' }], tasks: [
      ['Đi lại hệ điện, mạng, camera', 13, 18, { ...own(P.giamSat), depts: ['Thầu phụ cơ điện'], crit: true }],
      ['Hệ PCCC sprinkler & báo cháy', 18, 20, { ...own(P.giamSat), depts: ['Thầu phụ PCCC'], late: o.latePCCC, crit: true }],
      ['Lắp điều hoà âm trần', 30, 10, { ...own(P.giamSat) }],
    ] },
    { name: 'Hoàn thiện & nội thất', members: [{ name: P.doiB, role: 'Đội hoàn thiện' }, { name: P.xuong, role: 'Xưởng mộc' }], tasks: [
      ['Sơn, dán phim kính, thảm sàn', 36, 10, { ...own(P.doiB) }],
      ['Lắp nội thất gỗ & bàn ghế rời', 40, 12, { ...own(P.xuong), depts: ['Xưởng sản xuất'], crit: true }],
    ] },
    { name: 'Nghiệm thu & bàn giao', members: [{ name: P.cco, role: 'Giám đốc thi công' }], tasks: [
      ['Nghiệm thu PCCC với cơ quan chức năng', 52, 5, { ...own(P.giamSat), crit: true }],
      ['Bàn giao đưa vào sử dụng', 58, 0, { ms: true, ...own(P.cco) }],
    ] },
  ]
}
const buildFin = v => [
  ['Thu tạm ứng đợt 1 (30% hợp đồng)', 'thu', 0, 2, Math.round(v * 0.3)],
  ['Chi tạm ứng thầu phụ cơ điện', 'chi', 60, 0, Math.round(v * 0.08)],
  ['Thu đợt 2 (30%) sau cất nóc', 'thu', 72, 4, Math.round(v * 0.3)],
  ['Chi mua vật tư hoàn thiện', 'chi', 84, 0, Math.round(v * 0.12)],
  ['Thu đợt 3 (30%) sau hoàn thiện', 'thu', 112, 3, Math.round(v * 0.3)],
  ['Thu đợt cuối (10%) & bàn giao', 'thu', 122, 5, Math.round(v * 0.1)],
]
const fitFin = v => [
  ['Thu tạm ứng đợt 1 (40%)', 'thu', 0, 1, Math.round(v * 0.4)],
  ['Chi tạm ứng thầu phụ PCCC', 'chi', 16, 0, Math.round(v * 0.07)],
  ['Thu đợt 2 (40%) sau nghiệm thu phần vách trần', 'thu', 35, 3, Math.round(v * 0.4)],
  ['Chi thanh toán nội thất rời', 'chi', 42, 0, Math.round(v * 0.15)],
  ['Thu đợt cuối (20%)', 'thu', 60, 7, Math.round(v * 0.2)],
]
const coreMembers = () => ({ buy: [{ name: P.tpMua, role: 'Trưởng phòng mua hàng' }, { name: P.cungUng, role: 'Điều phối cung ứng' }],
  fin: [{ name: P.ktt, role: 'Kế toán trưởng' }, { name: P.ktCT, role: 'Kế toán công trình' }] })
const M = (name, role, dept) => ({ name, role, dept })
const designTeam = () => [M(P.tpTK, 'PM thiết kế', 'chu-tri'), M(P.kts, 'KTS chủ trì', 'concept'), M(P.kts, 'KTS 3D', '3d'), M(P.ksKC, 'KS kết cấu', '2d'), M(P.ksQS, 'QS dự toán', 'qs')]
const buildTeam = () => [M(P.cco, 'PM dự án', 'general'), M(P.chiHuy, 'Chỉ huy trưởng', 'qldth'), M(P.giamSat, 'KS giám sát', 'qldth'), M(P.ksQS, 'QS', 'qs'), M(P.ktCT, 'Kế toán công trình', 'tai-chinh')]
const SUB = {
  me: (v, st = 'active') => ({ name: 'Công ty TNHH Cơ điện Phúc An', scope: 'Điện, nước, điều hoà', contact: 'Anh Hùng', phone: '0909 456 789', valueVnd: v, status: st }),
  nhom: (v, st = 'active') => ({ name: 'Công ty CP Nhôm kính Sài Gòn Window', scope: 'Cửa nhôm Xingfa, vách kính cường lực', contact: 'Chị Lan', phone: '0918 223 344', valueVnd: v, status: st }),
  pccc: (v, st = 'active') => ({ name: 'Công ty PCCC An Toàn Việt', scope: 'Sprinkler, báo cháy, hồ sơ nghiệm thu PCCC', contact: 'Anh Khoa', phone: '0912 556 880', valueVnd: v, status: st }),
  da: (v, st = 'pending') => ({ name: 'Đá hoa cương Phú Tài', scope: 'Cung cấp & ốp lát đá marble', contact: 'Anh Tài', phone: '0903 771 552', valueVnd: v, status: st }),
  render: (v, st = 'active') => ({ name: 'Studio diễn họa Ánh Sáng 3D', scope: 'Render 3D phối cảnh nội thất', contact: 'Anh Duy', phone: '0937 664 120', valueVnd: v, status: st }),
  diachat: (v, st = 'done') => ({ name: 'Công ty Khảo sát địa chất Nam Long', scope: 'Khoan khảo sát địa chất 3 hố', contact: 'Anh Phong', phone: '0908 330 917', valueVnd: v, status: st }),
}
const buyBuild = () => [
  { name: 'Vật tư phần thô (thép, xi măng, bê tông)', off: 10, dur: 55, owner: P.cungUng, crit: true, items: [
    ['Thép CB300 Φ10-Φ22', 'Thép Hòa Phát', '9,5 tấn', 165, 14], ['Xi măng PCB40', 'Xi măng Hà Tiên', '420 bao', 38, 16],
    ['Bê tông thương phẩm M250', 'Bê tông Lê Phan', '68 m³', 95, 28], ['Gạch ống 8x18', 'Gạch Tuynel Bình Dương', '42.000 viên', 58, 55],
  ] },
  { name: 'Thiết bị điện & vệ sinh', off: 70, dur: 35, owner: P.tpMua, flow: QUICK_FLOW, items: [
    ['Dây cáp điện Cadivi', 'Cadivi', '1.800 m', 42, 72], ['Thiết bị vệ sinh TOTO (5 WC)', 'TOTO Việt Nam', '5 bộ', 96, 100, {}], ['Đèn LED âm trần', 'Rạng Đông', '120 bộ', 26, 98, { cancel: true }],
  ] },
  { name: 'Gạch ốp lát, sơn & nội thất rời', off: 78, dur: 40, owner: P.cungUng, flow: TENDER_FLOW, items: [
    ['Gạch ốp lát 60x60 & 30x60', 'Viglacera', '420 m²', 118, 84], ['Sơn nội ngoại thất', 'Dulux', '360 L', 46, 96], ['Sofa, bàn ăn, giường', 'Nội thất Hòa Phát', '1 lô', 185, 112],
  ] },
]
const buyFit = () => [
  { name: 'Vật tư vách trần & điện', off: 5, dur: 25, owner: P.cungUng, crit: true, items: [
    ['Khung xương & tấm thạch cao Vĩnh Tường', 'Vĩnh Tường', '1.150 m²', 210, 11], ['Kính cường lực 10 ly', 'Kính Hải Long', '180 m²', 135, 18], ['Cáp điện, ống luồn, ổ cắm', 'Cadivi, Panasonic', '1 lô', 160, 15],
  ] },
  { name: 'Thiết bị PCCC & điều hoà', off: 12, dur: 25, owner: P.tpMua, flow: TENDER_FLOW, items: [
    ['Đầu phun sprinkler & ống thép', 'Tyco qua An Toàn Việt', '520 đầu', 240, 22], ['Điều hoà âm trần Daikin 5HP', 'Daikin Việt Nam', '14 bộ', 588, 30],
  ] },
  { name: 'Bàn ghế văn phòng & thảm', off: 30, dur: 18, owner: P.cungUng, flow: QUICK_FLOW, items: [
    ['Bàn làm việc cụm 6 chỗ', 'Nội thất Fami', '20 cụm', 360, 40], ['Ghế xoay lưới', 'Nội thất Fami', '130 chiếc', 195, 42], ['Thảm tấm Interface', 'Interface VN', '640 m²', 150, 38],
  ] },
]

/* dự án thi công chưa khởi công: chỉ có giai đoạn chuẩn bị (offset âm = trước ngày khởi công) + mốc thu tạm ứng */
const prep = (name, v) => ({ phases: [{ name: 'Chuẩn bị thi công', members: [{ name: P.ksQS, role: 'QS' }, { name: P.chiHuy, role: 'Chỉ huy trưởng' }], tasks: [
  ['Bóc khối lượng & dự toán chi tiết', -30, 12, { ...own(P.ksQS), depts: ['QS'], crit: true }],
  ['Lập tiến độ tổng & biện pháp thi công', -18, 8, { ...own(P.chiHuy) }],
  ['Chọn thầu phụ cơ điện, nhôm kính', -14, 10, { ...own(P.tpMua), depts: ['Phòng Mua hàng'] }],
  [name || 'Khởi công', 0, 0, { ms: true, ...own(P.chiHuy), crit: true }]] }],
  fin: [['Thu tạm ứng thi công đợt 1 (30%)', 'thu', 0, 0, Math.round(v * 0.3)]] })
/* ---------- dự án từ Kinh doanh: điền thêm dữ liệu ---------- */
const leadProject = (i, kind) => all[kind].find(p => p.leadId === leadIds[i])
const L = name => LEADS.findIndex(l => l.name === name)
const vnd = i => Math.round(LEADS[i].value * 1e9)
const fee = i => Math.max(45e6, Math.round(LEADS[i].value * 1e9 * 0.035 / 5e6) * 5e6)
const filled = []
async function fillLead(name, kind, spec) {
  const p = leadProject(L(name), kind)
  if (!p) { errors.push({ method: 'SCRIPT', path: kind, body: name, error: 'Không có dự án tự tạo từ khách' }); return }
  await build(p.id, spec)
  filled.push(p.id)
}
// thiet-ke: đang thiết kế đầy đủ; dự án thi công tương ứng mới ở dạng nháp
await fillLead('Chị Nguyễn Ngọc Diễm', 'design', { s0: D(-60), k: 1.1, setup: { status: 'thiet-ke', startDate: D(-60), handoverDate: D(10), approvedBudgetVnd: fee(L('Chị Nguyễn Ngọc Diễm')), contact: 'Chị Ngọc Diễm', note: 'Khách muốn giữ cây khế trước nhà; ưu tiên phòng thờ tầng tum.' },
  members: designTeam(), phases: designPhases({ late3d: 70 }), fin: designFin(fee(L('Chị Nguyễn Ngọc Diễm'))), buy: designBuy(), coreMembers: coreMembers(),
  comments: [['Dựng 3D phòng ngủ, WC', P.tpTK, 'Phòng ngủ master đang trễ, cần chốt màu gỗ với khách trong tuần này.'], ['Dựng 3D phòng ngủ, WC', P.kts, `Dạ em hẹn chị Diễm ngày ${D(2).split('-').reverse().slice(0, 2).join('/')} xem bản sửa ạ.`]] })
await fillLead('Chị Nguyễn Ngọc Diễm', 'construction', { s0: D(25), setup: { status: 'nhap', startDate: D(25), handoverDate: D(150), note: 'Chờ hồ sơ thiết kế, dự kiến khởi công sau Tết Dương lịch.' }, members: [M(P.cco, 'PM dự án', 'general'), M(P.ksQS, 'QS', 'qs')], ...prep('Khởi công', vnd(L('Chị Nguyễn Ngọc Diễm'))) })
await fillLead('Anh Hồ Bảo Long', 'design', { s0: D(-92), k: 1.4, setup: { status: 'thiet-ke', startDate: D(-92), handoverDate: D(-2), approvedBudgetVnd: fee(L('Anh Hồ Bảo Long')), contact: 'Anh Bảo Long', note: 'Đối tác kiến trúc Studio K2 làm phần cảnh quan; Dezon làm kiến trúc + nội thất.' },
  members: [...designTeam(), M(P.kdddHead, 'Kinh doanh phụ trách', 'kinh-doanh')], subs: [SUB.render(68e6, 'done'), SUB.diachat(24e6)], phases: designPhases({ lateConcept: undefined }), fin: designFin(fee(L('Anh Hồ Bảo Long'))), buy: designBuy(), coreMembers: coreMembers(),
  comments: [['Bàn giao hồ sơ thiết kế', P.tpTK, 'Hồ sơ đã gửi khách duyệt, chờ phản hồi về thang máy (Fuji hay Mitsubishi).']] })
await fillLead('Anh Hồ Bảo Long', 'construction', { s0: D(20), setup: { status: 'nhap', startDate: D(20), handoverDate: D(260), approvedBudgetVnd: Math.round(vnd(L('Anh Hồ Bảo Long')) * 0.92), note: 'Dự toán sơ bộ, chờ khách duyệt hồ sơ thiết kế.' },
  members: buildTeam(), phases: [{ name: 'Chuẩn bị thi công', members: [{ name: P.chiHuy, role: 'Chỉ huy trưởng' }], tasks: [
    ['Lập dự toán chi tiết & tiến độ tổng', -10, 14, { ...own(P.ksQS), crit: true }], ['Xin phép xây dựng', 0, 30, { ...own(P.chiHuy), crit: true }]] }],
  fin: [['Thu tạm ứng thi công đợt 1 (30%)', 'thu', 20, 0, Math.round(vnd(L('Anh Hồ Bảo Long')) * 0.3)]] })
await fillLead('Công ty CP Công nghệ Sao Việt', 'design', { s0: D(-40), k: 0.9, setup: { status: 'thiet-ke', startDate: D(-40), handoverDate: D(20), approvedBudgetVnd: fee(L('Công ty CP Công nghệ Sao Việt')), contact: 'Chị Hoàng Thu Trang (Admin)', note: 'Theo guideline thi công của Etown; cần duyệt bản vẽ với BQL toà nhà.' },
  members: designTeam(), subs: [SUB.render(45e6)], phases: designPhases({}), fin: designFin(fee(L('Công ty CP Công nghệ Sao Việt'))), coreMembers: coreMembers() })
await fillLead('Công ty CP Công nghệ Sao Việt', 'construction', { s0: D(28), setup: { status: 'nhap', startDate: D(28), handoverDate: D(90), note: 'Thi công ngoài giờ (sau 18h và cuối tuần).' }, members: [M(P.cco, 'PM dự án', 'general'), M(P.giamSat, 'KS giám sát', 'qldth')], ...prep('Nhận mặt bằng từ BQL toà nhà', vnd(L('Công ty CP Công nghệ Sao Việt'))) })
// tu-van: mới concept; dự án thi công để trống (Chị Bích Ngọc) / có thành viên
await fillLead('Chị Lê Bích Ngọc', 'design', { s0: D(-12), setup: { status: 'thiet-ke', startDate: D(-12), contact: 'Chị Bích Ngọc' }, members: [M(P.kts, 'KTS tư vấn', 'concept')],
  phases: [{ name: 'Tư vấn & concept sơ bộ', members: [{ name: P.kts, role: 'KTS tư vấn' }], tasks: [
    ['Khảo sát hiện trạng', 0, 2, own(P.kts)], ['Moodboard Indochine 2 phương án', 4, 9, { ...own(P.kts), crit: true }], ['Hẹn trình concept', 14, 0, { ms: true, ...own(P.kts) }]] }] })
await fillLead('Anh Phạm Hoàng Long', 'design', { s0: D(-8), setup: { status: 'thiet-ke', startDate: D(-8) }, members: [M(P.kts, 'KTS tư vấn', 'concept'), M(P.ksKC, 'KS kết cấu', '2d')],
  phases: [{ name: 'Tư vấn & concept sơ bộ', members: [{ name: P.kts, role: 'KTS tư vấn' }], tasks: [
    ['Khảo sát nhà cũ & hẻm vào', 0, 1, own(P.kts)], ['Phương án mặt bằng 4 tầng', 3, 10, { ...own(P.kts), crit: true }]] }] })
await fillLead('Anh Phạm Hoàng Long', 'construction', { s0: D(40), setup: { startDate: D(40), note: 'Khái toán phá dỡ + xây mới, chờ khách chốt thiết kế.' }, members: [M(P.ksQS, 'QS khái toán', 'qs')], ...prep('Phá dỡ nhà cũ', vnd(L('Anh Phạm Hoàng Long'))) })
await fillLead('Công ty TNHH Minh Phát Logistics', 'design', { s0: D(-20), setup: { status: 'thiet-ke', startDate: D(-20), contact: 'Anh Đoàn Văn Phát (Giám đốc)' }, members: [M(P.tpTK, 'PM thiết kế', 'chu-tri'), M(P.kts, 'KTS tư vấn', 'concept')],
  phases: [{ name: 'Tư vấn & concept sơ bộ', members: [], tasks: [
    ['Khảo sát nhà xưởng, đo cao độ', 0, 2, own(P.kts)], ['Phương án mezzanine & bố trí 80 chỗ', 3, 12, { ...own(P.kts), crit: true, late: 80 }], ['Trình concept lần 1', 16, 0, { ms: true, ...own(P.tpTK) }]] }],
  comments: [['Phương án mezzanine & bố trí 80 chỗ', P.tpTK, `Khách đổi yêu cầu từ 60 lên 80 chỗ, @${P.kts} cập nhật lại mặt bằng giúp anh.`]] })
// dam-phan: đang đàm phán, có dự toán
await fillLead('Nhà hàng Hải Sản Biển Đông', 'design', { s0: D(-30), setup: { status: 'thiet-ke', startDate: D(-30), contact: 'Anh Tư (chủ nhà hàng)', note: 'Đối tác: bếp công nghiệp do Inox Hải Minh cung cấp.' }, members: [M(P.kts, 'KTS chủ trì', 'concept'), M(P.ksQS, 'QS dự toán', 'qs')],
  phases: designPhases({ lateConcept: 85 }).slice(0, 2) })
await fillLead('Nhà hàng Hải Sản Biển Đông', 'construction', { s0: D(15), setup: { startDate: D(15), handoverDate: D(75), approvedBudgetVnd: Math.round(vnd(L('Nhà hàng Hải Sản Biển Đông')) * 0.9), note: 'Đang đàm phán: khách muốn khai trương trước Tết.' }, members: [M(P.tpQS, 'QS chủ trì dự toán', 'qs')], ...prep('Khởi công', vnd(L('Nhà hàng Hải Sản Biển Đông'))) })
await fillLead('Chị Võ Hải Yến', 'design', { s0: D(-45), k: 1.2, setup: { status: 'thiet-ke', startDate: D(-45), handoverDate: D(35), contact: 'Chị Hải Yến' }, members: designTeam(), subs: [SUB.diachat(28e6)],
  phases: designPhases({}).slice(0, 3), fin: designFin(fee(L('Chị Võ Hải Yến'))).slice(0, 2) })
await fillLead('Chị Võ Hải Yến', 'construction', { s0: D(60), setup: { startDate: D(60), approvedBudgetVnd: Math.round(vnd(L('Chị Võ Hải Yến')) * 0.93) }, members: [M(P.cco, 'PM dự án', 'general'), M(P.tpQS, 'QS', 'qs')], subs: [SUB.diachat(28e6, 'pending')], ...prep('Khởi công', vnd(L('Chị Võ Hải Yến'))) })
// 'Chị Lê Bích Ngọc' construction + 'Công ty TNHH Minh Phát Logistics' construction: để nguyên (chỉ 2 đề mục cốt lõi) - test trạng thái trống

/* ---------- dự án tạo tay ---------- */
async function newProject(kind, body, spec) {
  const p = await call('POST', V1 + '/delivery/projects', { kind, ...body })
  if (p && spec) await build(p.id, spec)
  return p
}
const created = []
const vB12 = 2.1e9, vDA = 8.6e9, vNV = 11.8e9
created.push(await newProject('construction', { name: 'Nhà phố Lô B12 — KDC Bình Chánh', client: 'Anh Lâm Quang Huy', contact: 'Anh Quang Huy', phone: '0976 318 042', email: 'quanghuy.lam@gmail.com',
  address: 'Lô B12, KDC Bình Chánh, X. Bình Hưng, H. Bình Chánh', projectType: 'Nhà phố', status: 'dang-lam', barColor: 'var(--game)' },
  { s0: D(-82), setup: { startDate: D(-82), handoverDate: D(40), contractValueVnd: vB12, approvedBudgetVnd: 1.86e9, note: 'Nhà 1 trệt 3 lầu, ép cọc BTCT 250x250. Đang đổ sàn lầu 3.' },
    members: buildTeam(), subs: [SUB.me(185e6), SUB.nhom(96e6, 'pending')], phases: buildPhases({ mid: 2, lateStruct: 75 }), buy: buyBuild(), fin: buildFin(vB12), coreMembers: coreMembers(),
    comments: [[`Kết cấu lầu 3 - mái`, P.chiHuy, 'Mưa 3 ngày liền, sàn lầu 3 chậm 5 ngày. Đề nghị tăng ca chủ nhật.'], [`Kết cấu lầu 3 - mái`, P.doiB, 'Đội B tăng thêm 4 thợ từ thứ 2, dự kiến đổ sàn cuối tuần sau.'],
      ['Vật tư phần thô (thép, xi măng, bê tông)', P.cungUng, 'Thép đợt 2 Hòa Phát giao trễ 2 ngày, đã báo công trường.']] }))
created.push(await newProject('construction', { name: 'Văn phòng cho thuê Đông Á — 45 Võ Văn Tần, Q.3', client: 'Công ty TNHH Vận tải Đông Á', contact: 'Ông Phạm Đông Á', phone: '028 3930 6618', email: 'admin@dongatransport.vn',
  address: '45 Võ Văn Tần, P. Võ Thị Sáu, Q.3', projectType: 'Văn phòng', status: 'dang-lam' },
  { s0: D(-44), k: 1.0, setup: { startDate: D(-44), handoverDate: D(16), contractValueVnd: vDA, approvedBudgetVnd: 7.65e9, note: '3 sàn x 400m². Hệ PCCC làm mới theo QCVN 06:2022.' },
    members: [...buildTeam(), M(P.atld, 'An toàn lao động', 'qldth')], subs: [SUB.me(1.25e9), SUB.pccc(640e6), SUB.nhom(410e6, 'done')], phases: fitoutPhases({ latePCCC: 70, lateCeil: 90 }), buy: buyFit(), fin: fitFin(vDA), coreMembers: coreMembers(),
    comments: [['Hệ PCCC sprinkler & báo cháy', P.giamSat, 'Sàn 2 chưa thử áp xong, thầu PCCC thiếu người. Đã gửi văn bản nhắc tiến độ.'], ['Hệ PCCC sprinkler & báo cháy', P.cco, 'Họp với An Toàn Việt sáng mai 8h tại công trường.']] }))
created.push(await newProject('construction', { name: 'Biệt thự Nam Viên — Phú Mỹ Hưng, Q.7', client: 'Anh Trịnh Gia Phú', contact: 'Anh Gia Phú', phone: '0908 667 129', email: 'giaphu.trinh@gmail.com',
  address: 'Biệt thự Nam Viên, Đ. Nguyễn Đức Cảnh, P. Tân Phong, Q.7', projectType: 'Biệt thự', status: 'dang-lam', barColor: 'var(--finance)' },
  { s0: D(-60), k: 1.5, setup: { startDate: D(-60), handoverDate: D(45), contractValueVnd: vNV, approvedBudgetVnd: 10.4e9, note: 'Cải tạo nội thất tân cổ điển, giữ kết cấu. Đá marble nhập Ý.' },
    members: [...buildTeam(), M(P.kts, 'KTS giám sát tác giả', 'chu-tri')], subs: [SUB.da(1.6e9), SUB.me(720e6), SUB.nhom(380e6)], phases: fitoutPhases({ lateCeil: 80 }),
    buy: [...buyFit().slice(0, 1), { name: 'Đá marble & thiết bị vệ sinh cao cấp', off: 15, dur: 40, owner: P.tpMua, flow: TENDER_FLOW, crit: true, items: [
      ['Đá marble Carrara ốp sàn', 'Đá hoa cương Phú Tài', '310 m²', 1240, 32], ['Thiết bị vệ sinh Duravit (6 WC)', 'Duravit qua Hafele', '6 bộ', 420, 40], ['Đèn chùm pha lê', 'Đèn Kim Lộc', '4 bộ', 260, 44]] }],
    fin: fitFin(vNV), coreMembers: coreMembers(),
    comments: [['Đá marble & thiết bị vệ sinh cao cấp', P.tpMua, 'Đá Carrara về cảng Cát Lái ngày ' + D(5).split('-').reverse().join('/') + ', đã đặt xe cẩu.']] }))
created.push(await newProject('construction', { name: 'Căn hộ Sunrise City V2-1803 — cải tạo nội thất', client: 'Chị Phan Thuỳ Linh', contact: 'Chị Thuỳ Linh', phone: '0935 118 470', email: 'thuylinh.phan@gmail.com',
  address: 'V2-1803 Sunrise City, 23 Nguyễn Hữu Thọ, P. Tân Hưng, Q.7', projectType: 'Căn hộ', status: 'hoan-tat', barColor: 'var(--success)' },
  { s0: D(-115), k: 0.9, setup: { startDate: D(-115), handoverDate: D(-60), contractValueVnd: 780e6, approvedBudgetVnd: 690e6, note: 'Đã bàn giao, đang trong thời gian bảo hành 12 tháng.' },
    members: [M(P.cco, 'PM dự án', 'general'), M(P.giamSat, 'KS giám sát', 'qldth'), M(P.ktCT, 'Kế toán công trình', 'tai-chinh')], subs: [SUB.me(65e6, 'done')],
    phases: fitoutPhases({}).filter((_, i) => i !== 2), fin: fitFin(780e6), buy: buyFit().slice(2), coreMembers: coreMembers() }))
created.push(await newProject('design', { name: 'Căn hộ Masteri Thảo Điền T3-2408 — nội thất', client: 'Chị Ngô Thanh Hà', contact: 'Chị Thanh Hà', phone: '0904 552 873', email: 'thanhha.ngo@gmail.com',
  address: 'T3-2408 Masteri Thảo Điền, 159 Xa lộ Hà Nội, P. Thảo Điền, TP. Thủ Đức', projectType: 'Căn hộ', status: 'thiet-ke' },
  { s0: D(-58), k: 0.95, setup: { startDate: D(-58), handoverDate: D(4), contractValueVnd: 85e6, approvedBudgetVnd: 85e6, note: 'Căn 2PN 74m², phong cách Japandi, khách đã duyệt 3D.' },
    members: designTeam().slice(0, 3), phases: designPhases({}), fin: designFin(85e6), coreMembers: coreMembers(),
    comments: [['Bản vẽ chi tiết đồ gỗ nội thất', P.xuong, 'Xưởng đề nghị đổi tủ áo sang cánh lùa để tiết kiệm diện tích.']] }))
created.push(await newProject('design', { name: 'Showroom nội thất Mộc Gia — 312 Nguyễn Thị Minh Khai', client: 'Công ty TNHH Nội thất Mộc Gia', contact: 'Anh Trần Mộc', phone: '028 3832 7741', email: 'info@mocgia.vn',
  address: '312 Nguyễn Thị Minh Khai, P. Võ Thị Sáu, Q.3', projectType: 'Showroom', status: 'thiet-ke', barColor: 'var(--qs)' },
  { s0: D(-25), k: 1.1, setup: { startDate: D(-25), handoverDate: D(45), contractValueVnd: 160e6, approvedBudgetVnd: 150e6, note: 'Showroom 3 tầng, cần lối trưng bày theo bộ sưu tập.' },
    members: designTeam(), subs: [SUB.render(38e6)], phases: designPhases({ lateConcept: 90 }), fin: designFin(160e6), buy: designBuy(), coreMembers: coreMembers() }))
created.push(await newProject('design', { name: 'Phòng khám Nha khoa Kim Smile — Q.10', client: 'Công ty TNHH Nha khoa Kim Smile', contact: 'BS. Lê Kim Hoàng', phone: '0283 865 9902', email: 'kimsmile.dental@gmail.com',
  address: '506 Ba Tháng Hai, P.14, Q.10', projectType: 'Văn phòng', status: 'hoan-tat', barColor: 'var(--success)' },
  { s0: D(-140), k: 0.9, setup: { startDate: D(-140), handoverDate: D(-80), contractValueVnd: 70e6, approvedBudgetVnd: 70e6, note: 'Đã bàn giao hồ sơ; khách tự thuê thi công.' },
    members: designTeam().slice(0, 2), phases: designPhases({}), fin: designFin(70e6), coreMembers: coreMembers() }))
created.push(await newProject('design', { name: 'Nhà hàng Lẩu Nấm Rừng Xanh — Q.1', client: 'Anh Võ Minh Trung', phone: '0919 274 360', projectType: 'Nhà hàng', status: 'nhap' })) // để trống
console.log(`Dự án tạo tay: ${created.filter(Boolean).length}/8`)

/* ---------- kiểm tra luật trên dữ liệu tạm (xoá sau khi thử) ---------- */
// 1) đề mục cốt lõi: không xoá / đổi tên được; không được có 2 đề mục cùng tên cốt lõi
const tmp = await call('POST', V1 + '/delivery/projects', { kind: 'construction', name: 'ZZ thử luật đề mục (tạm)' })
if (tmp) {
  const tb = `${V1}/delivery/projects/${tmp.id}`
  const d = await call('GET', tb)
  const names = (d?.phases || []).map(p => p.name)
  check(names.length === 2 && names.includes(CORE_BUY) && names.includes(CORE_FIN), `Dự án mới có sẵn 2 đề mục cốt lõi (${names.join(', ')})`)
  const fin = (d?.phases || []).find(p => p.name === CORE_FIN)
  if (fin) {
    const del = await raw('DELETE', `${tb}/phases/${fin.id}`)
    check(del.err.startsWith('400'), `Xoá đề mục cốt lõi bị chặn (${del.err || 'KHÔNG bị chặn'})`)
    const ren = await raw('PATCH', `${tb}/phases/${fin.id}`, { name: 'Dòng tiền' })
    check(ren.err.startsWith('400'), `Đổi tên đề mục cốt lõi bị chặn (${ren.err || 'KHÔNG bị chặn'})`)
    const mem = await raw('PATCH', `${tb}/phases/${fin.id}`, { name: CORE_FIN, members: [{ name: P.ktt, role: 'Kế toán trưởng' }] })
    check(!mem.err, `Sửa người phụ trách đề mục cốt lõi (gửi kèm đúng tên) được (${mem.err || 'ok'})`)
  }
  const dup = await raw('POST', `${tb}/phases`, { name: CORE_BUY, sortOrder: 9 })
  check(!!dup.err, `POST /phases tên "${CORE_BUY}" bị chặn (${dup.err || 'KHÔNG bị chặn -> 2 đề mục cùng tên'})`)
  if (!dup.err && dup.data) {
    const del2 = await raw('DELETE', `${tb}/phases/${dup.data.id}`)
    check(!del2.err, `Xoá được đề mục trùng tên vừa tạo (${del2.err || 'ok'})`)
  }
  const norm = await call('POST', `${tb}/phases`, { name: 'Giai đoạn thường', sortOrder: 1 })
  if (norm) {
    const ren2 = await raw('PATCH', `${tb}/phases/${norm.id}`, { name: CORE_FIN })
    check(!!ren2.err, `Đổi tên đề mục thường thành "${CORE_FIN}" bị chặn (${ren2.err || 'KHÔNG bị chặn -> 2 đề mục cùng tên'})`)
  }
  check(!!(await call('DELETE', tb)), 'Xoá dự án tạm (cả đề mục trùng tên kẹt bên trong)')
}
// 2) vòng đời khách <-> dự án: tu-van tạo 2 dự án; sửa dự án thiết kế; rời giai đoạn -> ẩn / xoá; quay lại -> hiện lại, giữ dữ liệu;
//    xoá khách -> dự án đã sửa bỏ liên kết và hiện như dự án tạo tay
const tl = await call('POST', V1 + '/sales/leads', { name: 'ZZ Khách thử vòng đời (tạm)', stage: 'tu-van', dept: DD, projectType: 'Nhà phố', valueVnd: 1.5e9 })
if (tl) {
  let a = await listAll()
  const dz = a.design.find(p => p.leadId === tl.id), cz = a.construction.find(p => p.leadId === tl.id)
  check(dz && cz && dz.contractValueVnd === 1.5e9, 'Khách vào tu-van -> có dự án thiết kế + thi công, giá trị = giá trị ước tính')
  if (dz) await call('POST', `${V1}/delivery/projects/${dz.id}/members`, { name: P.kts, role: 'KTS tư vấn', dept: 'concept' })
  await call('PATCH', `${V1}/sales/leads/${tl.id}`, { stage: 'bao-gia' })
  a = await listAll()
  check(!a.design.some(p => p.leadId === tl.id) && !a.construction.some(p => p.leadId === tl.id), 'Rời tu-van -> cả 2 dự án biến khỏi danh sách')
  if (cz) check((await raw('GET', `${V1}/delivery/projects/${cz.id}`)).err.startsWith('404'), 'Dự án thi công còn nguyên đã bị xoá (GET -> 404)')
  await call('PATCH', `${V1}/sales/leads/${tl.id}`, { stage: 'dam-phan', valueVnd: 2e9 })
  a = await listAll()
  const dz2 = a.design.find(p => p.leadId === tl.id), cz2 = a.construction.find(p => p.leadId === tl.id)
  check(dz2 && dz2.id === dz?.id && dz2.members.length === 1, 'Vào lại dam-phan -> dự án thiết kế cũ hiện lại, còn thành viên')
  check(dz2 && dz2.contractValueVnd === 1.5e9, `Hiện lại không ghi đè giá trị (${dz2?.contractValueVnd})`)
  check(cz2 && cz2.contractValueVnd === 2e9, `Dự án thi công tạo mới theo giá trị ước tính mới (${cz2?.contractValueVnd})`)
  await call('PATCH', `${V1}/sales/leads/${tl.id}`, { name: 'ZZ Khách thử vòng đời (đổi tên)' })
  a = await listAll()
  check((a.design.find(p => p.id === dz?.id) || {}).client === 'ZZ Khách thử vòng đời (đổi tên)', 'Đổi tên khách -> tên khách ở dự án đổi theo')
  await call('DELETE', `${V1}/sales/leads/${tl.id}`)
  a = await listAll()
  const orphan = a.design.find(p => p.id === dz?.id)
  check(orphan && !orphan.leadId, 'Xoá khách -> dự án thiết kế đã sửa còn lại, bỏ liên kết')
  check(!a.construction.some(p => p.id === cz2?.id), 'Xoá khách -> dự án thi công còn nguyên bị xoá')
  if (orphan) await call('DELETE', `${V1}/delivery/projects/${orphan.id}`)
}

/* ===================================================== ĐỌC LẠI & TỔNG KẾT ===================================================== */
const finalLeads = (await call('GET', V1 + '/sales/leads'))?.leads || []
const byStage = {}
let acts = 0
const wonMonths = {}
for (const l of finalLeads) {
  byStage[l.stage] = (byStage[l.stage] || 0) + 1
  acts += ((await call('GET', `${V1}/sales/leads/${l.id}/activities`)) || []).length
  if (l.wonAt) wonMonths[l.wonAt.slice(0, 7)] = (wonMonths[l.wonAt.slice(0, 7)] || 0) + 1
}
const fa = await listAll()
const tot = {}
for (const kind of ['design', 'construction']) {
  const t = tot[kind] = { projects: fa[kind].length, fromLead: 0, phases: 0, tasks: 0, subs: 0, members: 0, po: 0, comments: 0, flows: 0, fin: 0, empty: 0 }
  for (const p of fa[kind]) {
    if (p.leadId) t.fromLead++
    const d = await call('GET', `${V1}/delivery/projects/${p.id}`)
    if (!d) continue
    const names = d.phases.map(x => x.name)
    for (const c of [CORE_BUY, CORE_FIN]) check(names.filter(n => n === c).length === 1, `${kind} #${p.id} "${p.name}": đúng 1 đề mục "${c}" (có ${names.filter(n => n === c).length})`)
    const tasks = d.phases.flatMap(x => x.tasks)
    t.phases += d.phases.length; t.tasks += tasks.length; t.subs += d.subcontractors.length; t.members += d.members.length
    t.po += tasks.reduce((s, x) => s + (x.purchaseItems || []).length, 0); t.flows += tasks.filter(x => x.purchaseFlow).length
    t.fin += tasks.filter(x => x.finType).length
    t.comments += Object.values(d.comments || {}).reduce((s, x) => s + x.length, 0)
    if (!tasks.length) t.empty++
  }
}
for (const l of finalLeads) {
  if (!SYNC.has(l.stage)) continue
  for (const kind of ['design', 'construction']) check(fa[kind].filter(p => p.leadId === l.id).length === 1, `${l.name} (${l.stage}) có đúng 1 dự án ${kind} ở danh sách`)
}

console.log('\n===== TỔNG KẾT =====')
console.log(`Khách hàng: ${finalLeads.length} (${Object.entries(byStage).map(([k, v]) => k + ' ' + v).join(', ')})`)
console.log(`Lần chăm sóc: ${acts}; chốt theo tháng: ${Object.entries(wonMonths).sort().map(([k, v]) => k + ':' + v).join(' ')}`)
for (const [k, t] of Object.entries(tot)) console.log(`${k}: ${t.projects} dự án (${t.fromLead} từ Kinh doanh, ${t.empty} chưa có công việc), ${t.phases} đề mục, ${t.tasks} công việc (${t.fin} mốc thu/chi), ${t.subs} thầu phụ, ${t.members} thành viên, ${t.po} đơn mua hàng, ${t.flows} quy trình mua riêng, ${t.comments} bình luận`)
const bad = checks.filter(c => !c.ok)
console.log(`Kiểm tra: ${checks.length - bad.length}/${checks.length} đúng`)
for (const c of bad) console.log('  SAI: ' + c.msg)
console.log(`Lỗi API: ${errors.length}`)
for (const e of errors) console.log(`  ${e.method} ${e.path} -> ${e.error}\n    body: ${e.body}`)
process.exit(errors.length || bad.length ? 1 : 0)
