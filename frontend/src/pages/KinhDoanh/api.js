/* REST /api/v1/sales (backend/internal/modules/sales). Máy chủ lưu giá trị bằng đồng (valueVnd) và trả quote = tổng báo giá QS
   khi đã gắn dự án; giao diện làm việc với value (tỷ) và type (loại công trình + quy mô) như dữ liệu mẫu cũ. */
import { request, enc } from '../QS/api/http'
import { getProjects } from '../QS/api/qsApi'

export function fromServer(l) {
  const vnd = l.quote ? l.quote.ban : l.valueVnd
  return {
    ...l,
    value: (Number(vnd) || 0) / 1e9,
    type: l.scale ? `${l.projectType || 'Chưa xác định'} (${l.scale})` : (l.projectType || 'Chưa xác định'),
  }
}

/* Khoá giao diện -> thân request (bỏ khoá chỉ để hiển thị) */
export function toServer(d) {
  const out = { ...d }
  if ('value' in out) { out.valueVnd = Math.round((Number(out.value) || 0) * 1e9); delete out.value }
  for (const k of ['id', 'type', 'quote', 'createdAt', 'wonAt', 'updatedAt']) delete out[k]
  return out
}

export const listLeads = () => request('GET', '/sales/leads').then(r => (r.leads || []).map(fromServer))
export const createLead = d => request('POST', '/sales/leads', { body: toServer(d) }).then(fromServer)
export const updateLead = (id, d) => request('PATCH', '/sales/leads/' + enc(id), { body: toServer(d) }).then(fromServer)
export const deleteLead = id => request('DELETE', '/sales/leads/' + enc(id))
export const listActivities = id => request('GET', '/sales/leads/' + enc(id) + '/activities')
export const addActivity = (id, a) => request('POST', '/sales/leads/' + enc(id) + '/activities', { body: a })
export const listQsProjects = () => getProjects()
