/* Dữ liệu dự án triển khai (REST /api/v1/delivery, backend/internal/modules/delivery) dùng chung cho
   Quản lý thiết kế (kind "design") và Quản lý dự án (kind "construction").
   <DeliveryProvider kind> giữ danh sách dự án, dự án đang chọn + chi tiết của nó; mỗi lệnh ghi xong nạp lại chi tiết
   và danh sách (tiến độ, nhân sự) để mọi tab cùng thấy dữ liệu mới. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { request, enc } from '../QS/api/http'
import { useWorkSession } from '../../services/workSession'

const P = id => '/delivery/projects/' + enc(id)

/* Công việc máy chủ -> dạng giao diện Gantt cũ (assignee, amount hiển thị, amountValue tính bằng triệu) */
export function taskToUI(t) {
  const tr = t.amountVnd == null ? null : t.amountVnd / 1e6
  return {
    ...t,
    assignee: (t.owners && t.owners[0]) || (t.depts && t.depts[0]) || '',
    finType: t.finType || undefined,
    amountValue: tr,
    amount: tr == null ? '' : (tr >= 1000 ? (tr / 1000).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' tỷ' : Math.round(tr) + ' tr'),
  }
}
export function taskToServer(t) {
  const out = {}
  for (const k of ['name', 'phaseId', 'start', 'end', 'progress', 'critical', 'milestone', 'desc', 'depts', 'owners', 'planStart', 'confirmed']) if (k in t) out[k] = t[k]
  if ('finType' in t) out.finType = t.finType || ''
  if ('amountValue' in t) out.amountVnd = t.amountValue == null ? null : Math.round(Number(t.amountValue) * 1e6)
  return out
}

const Ctx = createContext(null)
const curKey = kind => 'siteflow-delivery-current-' + kind
function readCur(kind) { try { return localStorage.getItem(curKey(kind)) || '' } catch { return '' } }
function writeCur(kind, id) { try { localStorage.setItem(curKey(kind), String(id || '')) } catch { /* bỏ qua */ } }

export function DeliveryProvider({ kind, children }) {
  const { me } = useWorkSession()
  const [projects, setProjects] = useState([])
  const [listState, setListState] = useState('loading')
  const [currentId, setCurrentId] = useState(() => readCur(kind))
  const [detail, setDetail] = useState(null)

  const loadList = useCallback(() => request('GET', '/delivery/projects', { query: { kind } }).then(r => {
    const ps = r.projects || []
    setProjects(ps)
    setListState('ok')
    setCurrentId(cur => (ps.some(p => String(p.id) === String(cur)) ? cur : (ps[0] ? String(ps[0].id) : '')))
    return ps
  }, e => { setListState(e.message || 'Lỗi tải dữ liệu'); return [] }), [kind])

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
      return r
    } catch (e) {
      alert('Không lưu được: ' + e.message)
      return null
    }
  }
  const meName = (me && (me.hoTen || me.username)) || ''
  const id = currentId

  const value = {
    kind, meName, projects, listState, currentId, detail,
    current: detail && String(detail.project.id) === String(currentId) ? detail.project : (projects.find(p => String(p.id) === String(currentId)) || null),
    select: pid => setCurrentId(String(pid || '')),
    reload: () => Promise.all([loadList(), loadDetail(currentId)]),
    createProject: async data => {
      try {
        const p = await request('POST', '/delivery/projects', { body: { kind, ...data } })
        await loadList()
        setCurrentId(String(p.id))
        return p
      } catch (e) { alert('Không tạo được dự án: ' + e.message); return null }
    },
    updateProject: patch => run('PATCH', P(id), patch),
    deleteProject: pid => run('DELETE', P(pid)),
    addMember: (pid, m) => request('POST', P(pid) + '/members', { body: m }).then(() => Promise.all([loadList(), loadDetail(currentId)]), e => alert('Không thêm được: ' + e.message)),
    removeMember: (pid, memberId) => request('DELETE', P(pid) + '/members/' + enc(memberId)).then(() => Promise.all([loadList(), loadDetail(currentId)]), e => alert('Không xoá được: ' + e.message)),
    addSubcontractor: s => run('POST', P(id) + '/subcontractors', s),
    updateSubcontractor: (sid, s) => run('PATCH', P(id) + '/subcontractors/' + enc(sid), s),
    removeSubcontractor: sid => run('DELETE', P(id) + '/subcontractors/' + enc(sid)),
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

export const STATUS_OPTIONS = [['nhap', 'Bản nháp'], ['dang-lam', 'Đang thực hiện'], ['tam-dung', 'Tạm dừng'], ['hoan-tat', 'Hoàn tất']]
export const STATUS_STYLE = {
  nhap: ['var(--surface-alt)', 'var(--text-muted)'], 'dang-lam': ['var(--primary-tint)', 'var(--primary)'],
  'tam-dung': ['var(--gold-tint, var(--qs-tint))', 'var(--gold, var(--qs))'], 'hoan-tat': ['var(--success-tint)', 'var(--success)'],
}
export const fmtTy = vnd => (Number(vnd || 0) / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' tỷ'
