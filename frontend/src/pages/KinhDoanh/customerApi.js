/* API trang khách hàng Kinh doanh dạng dashboard (chấm điểm 6 tiêu chí, lịch hẹn, task, phân tích AI).
   Route chỉ bản Go dưới /api/v1/sales (backend/internal/modules/sales). Dữ liệu lưu database, không mock.
   emitLeadChange / useLeadChange: các khối trên trang báo nhau tải lại (vd "Tạo task" ở khối AI -> Danh sách Task). */
import { useEffect, useRef } from 'react'
import { request, enc } from '../QS/api/http'

const L = id => '/sales/leads/' + enc(id)

/* ---- Chỉ số chính: 6 tiêu chí × 4 câu ----
   -> {checks: {tien: [bool×4], quyetdinh, dat, thoidiem, nhucau, canhtranh},
       criteria: [{key, label, weight, score, lock, status: 'lock'|'ok'|'watch', items: [{text, required, on}]}],
       critScore, dealScore, locks, prevWeek (điểm 7 ngày trước | null), updatedAt, updatedBy} */
export const getScore = id => request('GET', L(id) + '/score')
export const saveScore = (id, checks) => request('PUT', L(id) + '/score', { body: { checks } })

/* ---- Lịch hẹn (Việc tiếp theo) ----
   appointment: {id, date: 'yyyy-mm-dd', start: 'HH:MM', end: 'HH:MM', title, mode, place, goal, members: [string],
                 prep: [{text, done}], status: 'planned'|'done'|'cancelled', by, createdAt} */
export const listAppointments = id => request('GET', L(id) + '/appointments').then(r => (r && r.appointments) || [])
export const addAppointment = (id, a) => request('POST', L(id) + '/appointments', { body: a })
export const updateAppointment = (apptId, patch) => request('PATCH', '/sales/appointments/' + enc(apptId), { body: patch })
export const deleteAppointment = apptId => request('DELETE', '/sales/appointments/' + enc(apptId))

/* ---- Task của khách hàng ----
   task: {id, title, dueDate: 'yyyy-mm-dd'|'', assignees: [{name, username}], note, done, doneAt, source: ''|'ai', by, createdAt} */
export const listTasks = id => request('GET', L(id) + '/tasks').then(r => (r && r.tasks) || [])
export const addTask = (id, t) => request('POST', L(id) + '/tasks', { body: t })
export const updateTask = (taskId, patch) => request('PATCH', '/sales/tasks/' + enc(taskId), { body: patch })
export const deleteTask = taskId => request('DELETE', '/sales/tasks/' + enc(taskId))

/* ---- Phân tích AI (Gemini; chưa có GEMINI_API_KEY / lỗi -> máy chủ tự tính theo quy tắc, engine 'rules') ----
   insight: {engine: 'gemini'|'rules', model, generatedAt, warning,
     actions: {main: {priority, why, title, zalo}, side: [{tag, when, title, why}]},
     strategy: {headline, risks: [string], note, fit: {score, label}, pace: {score, delta}, closeChance: {pct, hint}},
     ideas: [{key, title, desc}],
     roadmap: {anchor: 'yyyy-mm-dd'|null, title, steps: [{date, label, desc, state: 'done'|'now'|'open'|'key'|'end', dashed}]},
     sources: [{kind, date, summary, by}]}
   getInsights -> {insight: insight|null}; generateInsights(id, {extra: [{name, url}]}) -> {insight}
   updateInsight(id, {actions, strategy, ideas, roadmap}, generatedAt) -> {insight} (thêm editedBy, editedAt);
   generatedAt = bản đang sửa, máy chủ trả 409 nếu đã có bản phân tích mới hơn */
export const getInsights = id => request('GET', L(id) + '/insights')
export const generateInsights = (id, body) => request('POST', L(id) + '/insights/generate', { body: body || {} })
export const updateInsight = (id, content, generatedAt) =>
  request('PATCH', L(id) + '/insights', { body: { content, generatedAt: generatedAt == null ? null : generatedAt } })

/* ---- Cấu hình AI (prompt "Đề xuất hành động" theo công ty) ----
   getAiConfig -> {instructions, defaultInstructions, custom, fixedRules, outputShape, aiEnabled, model,
     modelChoice, defaultModel, models: [{id, label, desc}], modelsError,
     updatedAt, updatedBy, canEdit, maxLength, history: [{instructions, model, at, by}]}; saveAiConfig trả về giống GET.
   model: đang dùng thật; modelChoice: công ty đã chọn ('' = mặc định máy chủ defaultModel).
   previewAiPrompt -> {system, prompt} (không gọi AI); testAiPrompt -> {content, engine, model, warning, ms, raw} (không lưu).
   instructions / model null/undefined = dùng bản đang lưu (không gửi khoá); model '' = mặc định máy chủ. */
const AIC = '/sales/ai-config'
const draft = (body, instructions) => (instructions == null ? body : { ...body, instructions })
const withModel = (body, model) => (model == null ? body : { ...body, model: String(model) })
export const getAiConfig = () => request('GET', AIC)
export const saveAiConfig = (instructions, model) =>
  request('PUT', AIC, { body: withModel({ instructions: String(instructions == null ? '' : instructions) }, model) })
export const previewAiPrompt = (leadId, instructions) => request('POST', AIC + '/preview', { body: draft({ leadId: Number(leadId) }, instructions) })
export const testAiPrompt = (leadId, instructions, model) =>
  request('POST', AIC + '/test', { body: withModel(draft({ leadId: Number(leadId) }, instructions), model) })

/* ---- Báo thay đổi giữa các khối của trang ---- part: 'score' | 'appointments' | 'tasks' | 'insights' | 'activities' | 'lead' */
const EV = 'kd:lead-change'
export function emitLeadChange(leadId, part) {
  try { window.dispatchEvent(new CustomEvent(EV, { detail: { leadId: String(leadId), part } })) } catch (e) { /* bỏ qua */ }
}
export function useLeadChange(leadId, parts, cb) {
  const ref = useRef(cb)
  ref.current = cb
  const key = (parts || []).join(',')
  useEffect(() => {
    const want = key ? key.split(',') : null
    const on = e => {
      const d = (e && e.detail) || {}
      if (String(d.leadId) !== String(leadId)) return
      if (want && want.indexOf(d.part) < 0) return
      ref.current(d.part)
    }
    window.addEventListener(EV, on)
    return () => window.removeEventListener(EV, on)
  }, [leadId, key])
}
