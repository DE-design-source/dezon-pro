/* REST /api/v1/it (backend/internal/modules/it). Yêu cầu hỗ trợ + thiết bị + tài khoản để chọn người.
   Ticket từ máy chủ đã theo khoá của giao diện (itData.js): {id, issue, desc, priority, category, status, deadline (yyyy-mm-dd | ''),
   requester, requesterUsername, roles: [{label, people: [{name, username}]}], images: [{name, url}], stages (null = IT_STAGES),
   tasks (null = chưa có công việc nào, bảng bắt đầu trống), source ('manual' | 'report'), reported, page, received, progress,
   mine, date (dd/mm/yyyy), createdAt, updatedAt}.
   fromServer thêm: assignee (người thực thi đầu tiên, như bản mẫu), roles[].people chuyển thành mảng tên (people) + giữ users. */
import { request, enc } from '../QS/api/http'

const execOf = roles => {
  const r = (roles || []).find(x => /thực thi/i.test(x.label)) || (roles || [])[0]
  return r && r.people && r.people[0] ? r.people[0].name : ''
}

// dd/mm/yyyy <-> yyyy-mm-dd
export const isoToVn = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : '')
export const vnToIso = v => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : '' }

/* Ticket máy chủ -> ticket của giao diện. roles: people là mảng TÊN (FlowBoard / bảng chi tiết dùng tên),
   peopleUsers giữ [{name, username}] để gửi lại khi sửa. deadline đổi sang dd/mm/yyyy như bản mẫu. */
export function fromServer(t) {
  const roles = (t.roles || []).map(r => ({ label: r.label, people: (r.people || []).map(p => p.name), peopleUsers: r.people || [] }))
  return { ...t, roles, deadline: isoToVn(t.deadline), assignee: execOf(t.roles) }
}

/* roles của giao diện -> thân request: ưu tiên peopleUsers ({name, username}); chỉ có tên thì gửi tên */
export function rolesToServer(roles) {
  return (roles || []).map(r => ({ label: r.label, people: r.peopleUsers && r.peopleUsers.length ? r.peopleUsers : (r.people || []).map(n => (typeof n === 'string' ? { name: n } : n)) }))
}

/* {tickets: [...], canManage} - canManage = có quyền IT (xem tất cả, mở bảng xử lý, quản lý thiết bị) */
export const listTickets = () => request('GET', '/it/tickets').then(r => ({ tickets: (r.tickets || []).map(fromServer), canManage: !!r.canManage }))
/* Yêu cầu tôi đã gửi (hộp Báo lỗi > Đã gửi) */
export const listMyTickets = () => request('GET', '/it/tickets', { query: { mine: 1 } }).then(r => (r.tickets || []).map(fromServer))
/* body: {title, desc, priority, category, deadline: 'yyyy-mm-dd', requester, requesterUsername, roles: [{label, people: [{name, username}]}],
   images: [{name, data: dataURL} | {name, url}], source: 'manual' | 'report', page} */
export const createTicket = body => request('POST', '/it/tickets', { body }).then(fromServer)
/* patch: bất kỳ khoá nào ở trên + status, tasks, stages, progress, received */
export const updateTicket = (id, patch) => request('PATCH', '/it/tickets/' + enc(id), { body: patch }).then(fromServer)
export const deleteTicket = id => request('DELETE', '/it/tickets/' + enc(id))

/* [{username, name, department, role, it}] - tài khoản đang hoạt động của công ty, người có quyền IT trước */
export const listStaff = () => request('GET', '/it/staff').then(r => r.staff || [])

/* Thiết bị: {id, name, type, owner, status: active | maintenance | broken, note} */
export const listAssets = () => request('GET', '/it/assets').then(r => r.assets || [])
export const createAsset = body => request('POST', '/it/assets', { body })
export const updateAsset = (id, patch) => request('PATCH', '/it/assets/' + enc(id), { body: patch })
export const deleteAsset = id => request('DELETE', '/it/assets/' + enc(id))

/* File ảnh (File / Blob) -> data URL để gửi trong images: [{name, data}] */
export const fileToDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file) })
