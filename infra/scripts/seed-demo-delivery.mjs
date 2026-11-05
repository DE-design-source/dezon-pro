#!/usr/bin/env node
/* Nạp dữ liệu mẫu Quản lý thiết kế (kind design) + Quản lý dự án (kind construction) của bản 8686a37 vào công ty demo
   qua HTTP API của bản Go: PROJECT_ROWS + DETAIL_PROJECT_DATA (dự án), INITIAL_PROJECT_MEMBERS (nhân sự), và cho dự án có dữ liệu
   (Chung cư Riverside): INITIAL_PHASES (đề mục, công việc, mốc, thu/chi), INITIAL_PURCHASE_ITEMS (kanban mua hàng),
   INITIAL_COMMENTS, INITIAL_SUBCONTRACTORS, địa chỉ của Thiết lập chung. Hai trang bản cũ dùng cùng một bộ mẫu
   (duAnData.js chép quanLyThietKeData.js) nên cả 2 kind nạp từ frontend/src/data/quanLyThietKeData.js.
   Chạy: node infra/scripts/seed-demo-delivery.mjs          (API=http://localhost:3100 mặc định)
   Đăng nhập bằng DEMO_LOGIN_USER / DEMO_LOGIN_PASSWORD trong backend/.env.test-login; chỉ chạy với tài khoản 'zz_*'.
   Chạy lại được: xoá các dự án KHÔNG gắn khách hàng Kinh doanh của công ty rồi nạp lại; dự án gắn khách hàng
   (do seed-demo-sales.mjs tạo qua bàn giao) giữ nguyên. Ngày mẫu dời theo số ngày giữa hôm nay và SAMPLE_TODAY (21/09/2026). */
import { readFileSync } from 'node:fs'
import {
  SAMPLE_TODAY, PROJECT_ROWS, DETAIL_PROJECT_DATA, INITIAL_PROJECT_MEMBERS, INITIAL_PHASES, INITIAL_PURCHASE_ITEMS,
  INITIAL_COMMENTS, INITIAL_SUBCONTRACTORS, parseD, toISO, dayDiff,
} from '../../frontend/src/data/quanLyThietKeData.js'

const API = (process.env.API || 'http://localhost:3100').replace(/\/$/, '')
const RIVERSIDE_ADDRESS = '123 Nguyễn Hữu Cảnh, P.22, Bình Thạnh, TP.HCM' // DEFAULT_SETUP_INFO của SetupTab.jsx bản cũ
const STATUS = { 'Đang thi công': 'dang-lam', 'Thiết kế': 'thiet-ke', 'Bản nháp': 'nhap', 'Hoàn tất': 'hoan-tat' }

const env = Object.fromEntries(readFileSync(new URL('../../backend/.env.test-login', import.meta.url), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#') && s.includes('='))
  .map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]))
const user = env.DEMO_LOGIN_USER || ''
if (!user.startsWith('zz_')) { console.error(`Từ chối: tài khoản "${user}" không bắt đầu bằng zz_`); process.exit(1) }

const today = new Date(); today.setHours(0, 0, 0, 0)
const offset = dayDiff(SAMPLE_TODAY, today)
const shift = s => { if (!s) return ''; const d = parseD(s); d.setDate(d.getDate() + offset); return toISO(d) }
const dash = s => (s && s !== '—' ? s : '')

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
  return data && data.result !== undefined ? data.result : data
}

const login = await call('POST', '/api/login', { args: [user, env.DEMO_LOGIN_PASSWORD || ''] })
token = (login && login.token) || ''
if (!token) throw new Error('Đăng nhập không trả token')

/* = createSamplePhases của frontend/src/pages/QuanLyThietKe/delivery.jsx ("Khởi tạo… > Dùng tiến độ mẫu"); trả map id mẫu -> id máy chủ */
async function samplePhases(pid) {
  const ids = {}
  for (let i = 0; i < INITIAL_PHASES.length; i++) {
    const src = INITIAL_PHASES[i]
    const ph = await call('POST', `/api/v1/delivery/projects/${pid}/phases`, { name: src.name, sortOrder: i, members: src.members || [] })
    for (let k = 0; k < src.tasks.length; k++) {
      const s = src.tasks[k]
      const t = await call('POST', `/api/v1/delivery/projects/${pid}/tasks`, {
        phaseId: ph.id, name: s.name, start: shift(s.start), end: shift(s.end), progress: s.progress || 0, critical: !!s.critical, milestone: !!s.milestone,
        desc: s.desc || '', depts: s.depts || [], owners: s.owners || (s.assignee ? [s.assignee] : []), sortOrder: k,
        finType: s.finType || '', planStart: shift(s.planStart), amountVnd: s.amountValue != null ? Math.round(s.amountValue * 1e6) : null,
        confirmed: s.confirmed !== false,
        purchaseItems: (INITIAL_PURCHASE_ITEMS[s.id] || []).map(it => ({ ...it, due: shift(it.due) })),
      })
      ids[s.id] = t.id
    }
  }
  return ids
}

const out = []
for (const kind of ['design', 'construction']) {
  const old = (await call('GET', `/api/v1/delivery/projects?kind=${kind}`)).projects || []
  const drop = old.filter(p => !p.leadId)
  for (const p of drop) await call('DELETE', `/api/v1/delivery/projects/${p.id}`)
  let tasks = 0
  for (const r of PROJECT_ROWS) {
    const d = DETAIL_PROJECT_DATA[r.name] || {}
    const p = await call('POST', '/api/v1/delivery/projects', {
      kind, name: r.name, client: r.client, projectType: r.type, status: STATUS[r.status] || 'nhap',
      contractValueVnd: Math.round(parseFloat(r.budget) * 1e9), progress: r.progress, barColor: r.barColor || '',
      contact: dash(d.contact), phone: dash(d.phone), email: dash(d.email), address: d.hasData ? RIVERSIDE_ADDRESS : '',
    })
    for (const m of INITIAL_PROJECT_MEMBERS[r.name] || []) await call('POST', `/api/v1/delivery/projects/${p.id}/members`, m)
    if (!d.hasData) continue
    const ids = await samplePhases(p.id)
    tasks += Object.keys(ids).length
    for (const [tid, list] of Object.entries(INITIAL_COMMENTS)) {
      for (const c of list) await call('POST', `/api/v1/delivery/projects/${p.id}/tasks/${ids[tid]}/comments`, { who: c.who, text: c.text })
    }
    // giao diện hiện thầu phụ mới nhất lên đầu (như bản cũ chèn lên đầu) -> nạp ngược để giữ đúng thứ tự mẫu
    for (const s of [...INITIAL_SUBCONTRACTORS].reverse()) {
      await call('POST', `/api/v1/delivery/projects/${p.id}/subcontractors`, {
        name: s.name, scope: s.scope, contact: s.contact, phone: s.phone, valueVnd: Number(s.value.replace(/\D/g, '')) || 0, status: s.status,
      })
    }
  }
  out.push(`${kind}: xoá ${drop.length} dự án cũ, giữ ${old.length - drop.length} dự án từ Kinh doanh, nạp ${PROJECT_ROWS.length} dự án + ${tasks} công việc`)
}
console.log(`Xong (${API}, dời ngày ${offset >= 0 ? '+' : ''}${offset}, ${toISO(SAMPLE_TODAY)} -> ${toISO(today)}):\n  ` + out.join('\n  '))
