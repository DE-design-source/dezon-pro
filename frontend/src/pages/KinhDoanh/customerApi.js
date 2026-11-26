/* API trang khách hàng Kinh doanh dạng dashboard (chấm điểm 6 tiêu chí, lịch hẹn, task, phân tích AI).
   Route chỉ bản Go dưới /api/v1/sales (backend/internal/modules/sales). Dữ liệu lưu database, không mock.
   emitLeadChange / useLeadChange: các khối trên trang báo nhau tải lại (vd "Tạo task" ở khối AI -> Danh sách Task). */
import { useEffect, useRef } from 'react'
import { request, enc, API_BASE, authHeaders, noAuth, noteAppVer, isAbort,
  QsApiError, QsAbortError, QsUnreachableError, QsNotConfiguredError } from '../QS/api/http'

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
/* Hỏi AI về khách / nhờ sửa phân tích (không lưu hội thoại): messages [{role: 'user'|'ai', text}] (tin cuối của user, tối đa 20)
   -> {reply, proposal: null | {section: 'actions'|'strategy'|'ideas'|'roadmap', summary, content: {actions, strategy, ideas, roadmap}, generatedAt, editedAt}, engine, model}
   (generatedAt / editedAt: bản phân tích mà đề xuất dựa vào, editedAt null = chưa sửa tay) */
/* AI đọc ảnh sổ đỏ đã tải lên (không lưu): url '/files/...' -> {docType, area (m²), width, length (m), shapeNote, plotNo, mapSheet, purpose, address, note, model} */
export const readLandCert = url => request('POST', '/sales/land-cert/read', { body: { url: String(url || '') } })
export const chatInsight = (id, messages, generatedAt) =>
  request('POST', L(id) + '/insights/chat', { body: generatedAt == null ? { messages } : { messages, generatedAt } })

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

/* ---- Gợi ý trực tiếp khi Live (AI đọc hội thoại gần nhất + dữ liệu khách + kiến thức bán hàng; không lưu) ----
   liveSuggest -> {stage, insight, answers: [{q, a}], ask: [string], missing: [string], engine, model, at}
   (429 = gọi quá nhanh, 503 = chưa cấu hình Gemini). Kiến thức bán hàng (bảng giá, gói dịch vụ, câu trả lời mẫu) theo công ty:
   getLiveKnowledge / saveLiveKnowledge -> {text, updatedAt, updatedBy, canEdit, maxLength, aiEnabled} (lưu: chỉ quản trị). */
export const liveSuggest = (id, lines, elapsedSec, signal) =>
  request('POST', L(id) + '/live-suggest', { body: { lines, elapsedSec: Math.max(0, Math.floor(Number(elapsedSec) || 0)) }, signal, noLog: true })
export const getLiveKnowledge = () => request('GET', '/sales/live-knowledge')
export const saveLiveKnowledge = text => request('PUT', '/sales/live-knowledge', { body: { text: String(text == null ? '' : text) } })

/* ---- Hội thoại đã ghi (khối Live ghi âm + chữ; máy chủ nhờ Gemini tách giọng Nhân viên / Khách ở nền) ----
   rec: {id, leadId, kind: 'meeting'|'call', title, durationSec, status: 'processing'|'done'|'failed', engine: 'gemini'|'live',
     model, error, summary, lines: [{who: 'nv'|'kh', t, at (giây)}], liveLines, audioUrl ('' | '/files/...'), audioMime, audioBytes,
     staffName, customerName, authorName, activityId, createdAt, updatedAt}
   createRecording(leadId, {audio: Blob|null, meta: {kind, durationSec, staffName, customerName, liveLines, audioComplete}}) -> rec
   (multipart: "meta" = chuỗi JSON, "audio" = file ghi âm, tối đa 20 MB). Máy chủ tạo luôn 1 mục Cập nhật chăm sóc. */
const AUDIO_EXT = [[/webm/, 'webm'], [/ogg|opus/, 'ogg'], [/mp4|m4a|aac/, 'm4a'], [/mpeg|mp3/, 'mp3'], [/wav/, 'wav']]
const audioName = type => {
  const t = String(type || '').toLowerCase()
  const hit = AUDIO_EXT.find(([re]) => re.test(t))
  return 'live.' + (hit ? hit[1] : 'webm')
}
/* Gửi multipart/form-data tới /api/v1 (request() của http.js chỉ gửi JSON): cùng token / công ty "xem như" / xử lý lỗi */
async function requestForm(method, path, fd, signal) {
  if (!API_BASE) throw new QsNotConfiguredError()
  let res
  try {
    // không đặt Content-Type: trình duyệt tự thêm boundary của multipart
    res = await fetch(API_BASE + '/api/v1' + path, { method, headers: authHeaders(false), body: fd, signal })
  } catch (e) {
    if (isAbort(e) || (signal && signal.aborted)) throw new QsAbortError()
    throw new QsUnreachableError()
  }
  noteAppVer(res.headers.get('x-app-ver'))
  let d = null
  try { d = await res.json() } catch (e) {
    if (isAbort(e) || (signal && signal.aborted)) throw new QsAbortError()
  }
  if (d && d.code === 'NOAUTH') throw noAuth()
  let err = null
  if (!d || typeof d !== 'object') err = new QsApiError(res.status === 413 ? 'File ghi âm quá lớn' : 'HTTP ' + res.status, res.status)
  else if (d.error) err = new QsApiError(String(d.error), res.status)
  else if (!res.ok) err = new QsApiError('HTTP ' + res.status, res.status)
  if (err) { err.src = method + ' ' + path; throw err }
  return d.result === undefined ? null : d.result
}
const R = id => '/sales/recordings/' + enc(id)
export const listRecordings = id => request('GET', L(id) + '/recordings').then(r => (r && r.recordings) || [])
export function createRecording(leadId, { audio, meta } = {}, signal) {
  const fd = new FormData()
  fd.append('meta', JSON.stringify(meta || {}))
  if (audio && audio.size) fd.append('audio', audio, audio.name || audioName(audio.type))
  return requestForm('POST', L(leadId) + '/recordings', fd, signal)
}
export const updateRecording = (recId, { lines }) => request('PATCH', R(recId), { body: { lines: lines || [] } })
export const reprocessRecording = recId => request('POST', R(recId) + '/reprocess', { body: {} })
export const deleteRecording = recId => request('DELETE', R(recId))

/* ---- Báo thay đổi giữa các khối của trang ---- part: 'score' | 'appointments' | 'tasks' | 'insights' | 'activities' | 'recordings' | 'lead' */
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
