/* Dữ liệu dự án triển khai (REST /api/v1/delivery, backend/internal/modules/delivery) dùng chung cho
   Quản lý thiết kế (kind "design") và Quản lý dự án (kind "construction"). Giao diện giữ nguyên bản 8686a37 (dữ liệu mẫu);
   file này thay các hằng mẫu / localStorage / state cục bộ của bản đó bằng dữ liệu máy chủ.
   <DeliveryProvider kind> giữ danh sách dự án, dự án đang chọn + chi tiết của nó; mỗi lệnh ghi xong nạp lại chi tiết
   và danh sách (tiến độ, nhân sự) để mọi tab cùng thấy dữ liệu mới. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { request, enc } from '../QS/api/http'
import { useWorkSession } from '../../services/workSession'
import { ORG_ICON } from '../../data/quanLyThietKeData'

const P = id => '/delivery/projects/' + enc(id)

/* Công việc máy chủ -> dạng giao diện Gantt cũ (assignee, amount hiển thị, amountValue tính bằng triệu) */
export function taskToUI(t) {
  const tr = t.amountVnd == null ? null : t.amountVnd / 1e6
  return {
    ...t,
    assignee: (t.owners && t.owners[0]) || (t.depts && t.depts[0]) || '',
    finType: t.finType || undefined,
    amountValue: tr,
    amount: tr == null ? '' : (tr >= 1000 ? (tr / 1000).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' tỷ' : Math.round(tr) + ' triệu'),
  }
}
export function taskToServer(t) {
  const out = {}
  for (const k of ['name', 'phaseId', 'start', 'end', 'progress', 'critical', 'milestone', 'desc', 'depts', 'owners', 'planStart', 'confirmed', 'sortOrder', 'purchaseItems', 'purchaseFlow']) if (k in t) out[k] = t[k]
  if ('finType' in t) out.finType = t.finType || ''
  if ('amountValue' in t) out.amountVnd = t.amountValue == null ? null : Math.round(Number(t.amountValue) * 1e6)
  return out
}

/* Thứ tự như bản cũ: dự án tạo ở trang (cũ trước) rồi tới dự án đồng bộ từ Kinh doanh */
const byId = (a, b) => Number(a.id) - Number(b.id)
const ordered = ps => [...ps.filter(p => !p.leadId).sort(byId), ...ps.filter(p => p.leadId).sort(byId)]

const Ctx = createContext(null)
const curKey = kind => 'siteflow-delivery-current-' + kind
function readCur(kind) { try { return localStorage.getItem(curKey(kind)) || '' } catch { return '' } }
function writeCur(kind, id) { try { localStorage.setItem(curKey(kind), String(id || '')) } catch { /* bỏ qua */ } }

export function DeliveryProvider({ kind, children }) {
  const { me } = useWorkSession()
  const [projects, setProjects] = useState([])
  const [currentId, setCurrentId] = useState(() => readCur(kind))
  const [detail, setDetail] = useState(null)

  const loadList = useCallback(() => request('GET', '/delivery/projects', { query: { kind } }).then(r => {
    const ps = ordered(r.projects || [])
    setProjects(ps)
    setCurrentId(cur => (ps.some(p => String(p.id) === String(cur)) ? cur : (ps[0] ? String(ps[0].id) : '')))
    return ps
  }, e => { alert('Không tải được danh sách dự án: ' + e.message); return [] }), [kind])

  const loadDetail = useCallback(id => {
    if (!id) { setDetail(null); return Promise.resolve(null) }
    return request('GET', P(id)).then(d => {
      const comments = {}
      Object.entries(d.comments || {}).forEach(([tid, list]) => {
        comments[tid] = list.map(c => ({ ...c, time: new Date(c.createdAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) }))
      })
      const v = { ...d, comments, phases: d.phases.map(p => ({ ...p, tasks: p.tasks.map(taskToUI) })) }
      setDetail(v)
      return v
    }, e => { alert('Không tải được dự án: ' + e.message); return null })
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { writeCur(kind, currentId); loadDetail(currentId) }, [kind, currentId, loadDetail])

  /* Gửi 1 lệnh ghi; xong nạp lại chi tiết + danh sách. Lỗi -> báo, trả null */
  async function run(method, path, body) {
    try {
      const r = await request(method, path, body === undefined ? {} : { body })
      await Promise.all([loadDetail(currentId), loadList()])
      return r || true
    } catch (e) {
      alert('Không lưu được: ' + e.message)
      return null
    }
  }
  const meName = (me && (me.hoTen || me.username)) || ''
  const id = currentId
  /* Chi tiết chỉ dùng khi đúng dự án đang chọn (lúc đổi dự án, chi tiết cũ còn trong state tới khi tải xong) */
  const det = detail && String(detail.project.id) === String(currentId) ? detail : null
  const row = projects.find(p => String(p.id) === String(currentId)) || null

  const value = {
    kind, meName, projects, currentId, detail: det,
    current: row && det ? { ...row, ...det.project } : row,
    select: pid => setCurrentId(String(pid || '')),
    updateProject: patch => run('PATCH', P(id), patch),
    addMember: (pid, m) => run('POST', P(pid) + '/members', m),
    removeMember: (pid, memberId) => run('DELETE', P(pid) + '/members/' + enc(memberId)),
    addSubcontractor: s => run('POST', P(id) + '/subcontractors', s),
    addPhase: ph => run('POST', P(id) + '/phases', ph),
    updatePhase: (pid, ph) => run('PATCH', P(id) + '/phases/' + enc(pid), ph),
    deletePhase: pid => run('DELETE', P(id) + '/phases/' + enc(pid)),
    addTask: t => run('POST', P(id) + '/tasks', taskToServer(t)),
    updateTask: (tid, t) => run('PATCH', P(id) + '/tasks/' + enc(tid), taskToServer(t)),
    deleteTask: tid => run('DELETE', P(id) + '/tasks/' + enc(tid)),
    addComment: (tid, text) => run('POST', P(id) + '/tasks/' + enc(tid) + '/comments', { text, who: meName }),
    /* Nhiều lệnh liền nhau (áp mẫu tiến độ): không nạp lại sau từng lệnh */
    batch: async fn => {
      try { await fn((method, path, body) => request(method, P(id) + path, body === undefined ? {} : { body })) } catch (e) { alert('Lỗi: ' + e.message) }
      await Promise.all([loadDetail(currentId), loadList()])
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useDelivery = () => useContext(Ctx)

/* ---------- Dự án máy chủ -> dạng dữ liệu mẫu cũ (PROJECT_ROWS, PROJECT_SHORTLIST, DETAIL_PROJECT_DATA) ---------- */
/* status máy chủ -> [nhãn, nền, màu chữ, màu chi tiết (DETAIL_STATUS_COLORS)] như bản cũ */
const STATUS = {
  'dang-lam': ['Đang thi công', 'var(--primary-tint)', 'var(--primary)', 'primary'],
  'thiet-ke': ['Thiết kế', 'var(--qs-tint)', 'var(--qs)', 'primary'],
  nhap: ['Bản nháp', 'var(--surface-alt)', 'var(--text-muted)', 'muted'],
  'hoan-tat': ['Hoàn tất', 'var(--success-tint)', 'var(--success)', 'success'],
  'tam-dung': ['Tạm dừng', 'var(--surface-alt)', 'var(--text-muted)', 'muted'],
}
const statusOf = p => STATUS[p.status] || STATUS.nhap
const ty = vnd => Number(vnd || 0) / 1e9
const budgetOf = p => (p.leadId ? `${ty(p.contractValueVnd).toFixed(1).replace(/\.0$/, '')} tỷ` : `${ty(p.contractValueVnd).toFixed(2)} tỷ${p.status === 'nhap' ? ' (dự kiến)' : ''}`)

/* Hàng của danh sách dự án: dự án của trang trước (BASE_ROWS cũ), dự án từ Kinh doanh sau (loadSyncedProjects cũ) */
export function projectRows(projects) {
  const base = projects.filter(p => !p.leadId)
  return projects.map(p => {
    const [status, statusBg, statusColor] = statusOf(p)
    const r = { id: p.id, name: p.name, client: p.client, type: p.projectType, budget: budgetOf(p), progress: p.progress || 0, status, statusBg, statusColor }
    if (p.leadId) return { ...r, type: '', typeLabel: '—', barColor: p.barColor || 'var(--primary)', goto: 'create', synced: true }
    const i = base.indexOf(p)
    return { ...r, budgetMuted: p.status === 'nhap', barColor: p.barColor || (r.progress >= 100 ? 'var(--success)' : 'var(--primary)'), goto: 'detail', borderBottom: i < base.length - 1 }
  })
}
/* "Tổng ngân sách quản lý": dự án của trang (dự án từ Kinh doanh còn là giá trị ước tính, bản cũ cũng không cộng) */
export const sumBudget = projects => `${projects.filter(p => !p.leadId).reduce((s, p) => s + ty(p.contractValueVnd), 0).toFixed(1).replace(/\.0$/, '')} tỷ`
/* Dòng chọn dự án ở Tiến độ: "Chung cư · Đang thi công" */
export const projectSub = p => `${p.projectType || '—'} · ${statusOf(p)[0]}`

/* Thẻ đầu trang Sơ đồ tổ chức */
export function detailOf(p, members) {
  if (!p) return { name: '', status: '', statusColor: 'muted', client: '—', contact: '—', phone: '—', email: '—', budget: '—', hasData: true, value: '0', progress: 0, taskCount: 0, pm: '—' }
  const [status, , , statusColor] = statusOf(p)
  return {
    name: p.name, status, statusColor, hasData: true,
    client: p.client || '—', contact: p.contact || '—', phone: p.phone || '—', email: p.email || '—', budget: budgetOf(p),
    value: ty(p.contractValueVnd).toFixed(1).replace(/\.0$/, ''), progress: p.progress || 0, taskCount: p.taskCount || 0,
    pm: ((members || []).find(m => /^PM\b/.test(m.role || '')) || {}).name || '—',
  }
}

/* ---------- Thiết lập chung: ô nhập dạng chữ như bản cũ (dd/mm/yyyy, 8.500.000.000) <-> máy chủ (yyyy-mm-dd, số đồng) ---------- */
const isoToVN = s => (s ? s.split('-').reverse().join('/') : '')
const moneyText = v => (v ? Number(v).toLocaleString('vi-VN') : '')
export const EMPTY_SETUP = { startDate: '', handoverDate: '', contractValue: '', approvedBudget: '', note: '' }
export const setupFormOf = p => (p ? {
  startDate: isoToVN(p.startDate), handoverDate: isoToVN(p.handoverDate),
  contractValue: moneyText(p.contractValueVnd), approvedBudget: moneyText(p.approvedBudgetVnd), note: p.note || '',
} : EMPTY_SETUP)
/* Trả patch gửi máy chủ, hoặc chuỗi lỗi */
export function setupPatchOf(f) {
  const date = s => {
    if (!s.trim()) return ''
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
  }
  const startDate = date(f.startDate)
  const handoverDate = date(f.handoverDate)
  if (startDate === null || handoverDate === null) return 'Ngày không hợp lệ, nhập theo dạng dd/mm/yyyy.'
  const money = s => Number(String(s).replace(/\D/g, '')) || 0
  return { startDate, handoverDate, contractValueVnd: money(f.contractValue), approvedBudgetVnd: money(f.approvedBudget), note: f.note }
}
export const subValueText = v => (v ? moneyText(v) : '—')
export const parseMoney = s => Number(String(s).replace(/\D/g, '')) || 0

/* ---------- Sơ đồ tổ chức: máy chủ lưu tên khoá icon (ORG_ICON), giao diện dùng SVG ---------- */
const iconKey = html => Object.keys(ORG_ICON).find(k => ORG_ICON[k] === html) || 'dept'
export const orgToServer = (parallel, children) => ({
  parallel: parallel.map(x => ({ ...x, icon: iconKey(x.icon) })),
  children: children.map(x => ({ ...x, icon: iconKey(x.icon) })),
})
export function orgFromServer(oc, fallbackParallel, fallbackChildren) {
  if (!oc) return { parallel: fallbackParallel, children: fallbackChildren }
  const row = list => (list || []).map(x => ({ ...x, icon: ORG_ICON[x.icon] || ORG_ICON.dept, caption: x.caption || undefined }))
  return { parallel: row(oc.parallel), children: row(oc.children) }
}

/* Dựng tiến độ mẫu (INITIAL_PHASES + đơn mua hàng mẫu) vào dự án qua API; ngày dời offset ngày.
   Dùng cho "Khởi tạo… > Dùng tiến độ mẫu" và giống infra/scripts/seed-demo-delivery.mjs */
/* 2 đề mục mọi dự án luôn có (máy chủ tạo cùng dự án, không xoá / đổi tên được) */
export const CORE_PHASES = ['Mua hàng & cung ứng', 'Tài chính — dòng tiền']

/* core: {tên đề mục cốt lõi: id} đã có trong dự án -> công việc mẫu gộp vào đó thay vì tạo đề mục mới */
export async function createSamplePhases(call, { INITIAL_PHASES, INITIAL_PURCHASE_ITEMS, offset, parseD, toISO, core = {} }) {
  const shift = s => { if (!s) return ''; const d = parseD(s); d.setDate(d.getDate() + offset); return toISO(d) }
  for (let i = 0; i < INITIAL_PHASES.length; i++) {
    const src = INITIAL_PHASES[i]
    const ph = core[src.name] ? { id: core[src.name] } : await call('POST', '/phases', { name: src.name, sortOrder: i, members: src.members || [] })
    for (let k = 0; k < src.tasks.length; k++) {
      const s = src.tasks[k]
      await call('POST', '/tasks', {
        phaseId: ph.id, name: s.name, start: shift(s.start), end: shift(s.end), progress: s.progress || 0, critical: !!s.critical, milestone: !!s.milestone,
        desc: s.desc || '', depts: s.depts || [], owners: s.owners || (s.assignee ? [s.assignee] : []), sortOrder: k,
        finType: s.finType || '', planStart: shift(s.planStart), amountVnd: s.amountValue != null ? Math.round(s.amountValue * 1e6) : null,
        confirmed: s.confirmed !== false,
        purchaseItems: (INITIAL_PURCHASE_ITEMS[s.id] || []).map(it => ({ ...it, due: shift(it.due) })),
      })
    }
  }
}
