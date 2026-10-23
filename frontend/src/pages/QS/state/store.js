/* Store cấp module của trang QS (D11): nằm NGOÀI cây React nên rời /qs rồi quay lại không phải nạp lại 4,4 MB bootstrap.
   Khoá theo token + công ty "xem như": đổi khoá -> xoá dữ liệu (giữ dự án / hạng mục đang chọn để mở lại nếu còn).
   Đọc bằng useQsStore(selector) (useSyncExternalStore). Mọi thay đổi tạo object state mới.
   Port: boot() PUB/app.js:293-308 · authStart_/doLogin_/authLogout_ 2449-2474, 8-11 · canTab 2482-2503 ·
   hmGet_/hmSet_/hmInit_ 1358-1455 · openProject_ 2331-2341 · projReload_ dash.js:60-69 · syncProj app.js:2104 ·
   editLine 1988-2012 · addProdObj boc.js:291-342 (phần optimistic) · delLine/tkBulkDel_ boc.js:822-828, 1131-1143 ·
   tkMoveLine_ boc.js:803-820 · thông báo 2595-2599. */
import { useSyncExternalStore } from 'react'
import * as api from '../api/qsApi'
import {
  apiConfigured, readToken, writeToken, readViewAs, writeViewAs, isAbort, setErrorTab, ping,
} from '../api/http'
import { qsToast, qsConfirm, qsCloseDialogs } from '../components/common/dialogs'
import { recalcLine_ } from '../lib/calc.js'
import { projDataLoad_, projDataFlush_, projDataReset_, projDataSet_ } from './projData'
import { qbRecentPush_ } from './useRecentNodes'

export const DEFAULT_NODE = '3.2.6.1'
export const PERM_TABS = [['dash', 'Bảng điều khiển'], ['boc', 'Bóc tách'], ['chiphi', 'Chi phí'], ['export', 'Xuất báo giá'],
  ['muahang', 'Mua hàng'], ['duan', 'Dự án'], ['sanpham', 'Danh sách sản phẩm'], ['import', 'Nhập dữ liệu']]
const HIST_LIMIT = 100

function readLs(k) { try { return localStorage.getItem(k) || '' } catch (e) { return '' } }
function writeLs(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch (e) { /* bỏ qua */ } }
function readSs(k) { try { return sessionStorage.getItem(k) || '' } catch (e) { return '' } }
function writeSs(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k) } catch (e) { /* bỏ qua */ } }

const dataInit = () => ({
  boot: 'idle', bootStep: '', bootError: '', bootErrorKind: '',
  projects: [], products: [], cur: null, lines: [],
  selFloor: null,   // S.selFloor: tầng đang chọn ở Bóc tách (null = chưa chọn); Bóc tách ghi, Danh sách SP đọc (requests/2-fixer-2C.txt)
  projData: {}, pdOk: null, pdErr: null, pdSeq: 0,
  congTac: [], ctStatus: 'idle', ctError: '',
  notifUnread: 0,
  hist: {}, histVer: 0,
})

let S = {
  key: '',
  auth: 'init',          // init | unconfigured | checking | login | unreachable | ready
  loginMsg: '',
  me: null, congTy: null, viewAs: readViewAs(),
  node: DEFAULT_NODE, hmNode: '', hmFrom: '',
  tab: 'boc', visSeq: {}, intents: {},
  ...dataInit(),
}
const subs = new Set()

export function getState() { return S }
export function setState(patch) {
  S = { ...S, ...(typeof patch === 'function' ? patch(S) : patch) }
  subs.forEach(fn => fn())
}
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
const ident = s => s
export function useQsStore(selector = ident) {
  return useSyncExternalStore(subscribe, () => selector(S), () => selector(S))
}

export const toast = msg => qsToast(msg)

/* Công ty của phiên vừa được sửa (thẻ Thông tin công ty, M17.1): chỉ thay S.congTy -> màu / logo / tên đổi ngay, không tải lại.
   Chỉ gọi khi me.congTyId === id của công ty vừa lưu: super đang xem công ty khác thì không được đổi S.congTy. */
export function setCongTyLocal(r) {
  if (r && typeof r === 'object' && r.id) setState({ congTy: r })
}

/* ---------- Quyền (port canTab / firstAllowedTab_ / ctHasFeature_) ---------- */
export function ctHasFeature_(tab, me, congTy) {
  me = me || {}
  if (me.role === 'super') return true
  if (!congTy) return true
  const f = congTy.tinhNang || []
  if (!f.length) return true
  return f.indexOf(tab) >= 0
}
export function isAdminRole_(me) { const r = (me || {}).role; return r === 'admin' || r === 'super' }
export function canTab(tab, me = S.me, congTy = S.congTy) {
  me = me || {}
  if (tab === 'congty') return me.role === 'super'
  if (tab === 'admin') return me.role === 'admin' || me.role === 'super'
  if (!ctHasFeature_(tab, me, congTy)) return false
  if (me.role === 'admin' || me.role === 'super') return true
  return (me.perms || []).indexOf(tab) >= 0
}
export function firstAllowedTab_(me = S.me, congTy = S.congTy) {
  if (isAdminRole_(me)) return 'boc'
  for (let i = 0; i < PERM_TABS.length; i++) if (canTab(PERM_TABS[i][0], me, congTy)) return PERM_TABS[i][0]
  return null
}

/* ---------- Gắn / tháo khi trang /qs mount (StrictMode: tháo rồi gắn lại ngay -> không huỷ gì) ---------- */
let ctl = new AbortController()
let detachTimer = null
let mounted = 0
export const signal = () => ctl.signal

export function attach() {
  mounted++
  setErrorTab(S.tab)
  if (detachTimer) { clearTimeout(detachTimer); detachTimer = null }
  if (ctl.signal.aborted) ctl = new AbortController()
  startSession()
  if (S.auth === 'ready') {
    startNotifPoll()
    if (S.boot === 'idle') boot()   // lần trước rời /qs giữa lúc đang nạp (đã huỷ) -> nạp lại
  }
}
export function detach() {
  mounted = Math.max(0, mounted - 1)
  if (mounted) return
  if (detachTimer) clearTimeout(detachTimer)
  detachTimer = setTimeout(() => {
    detachTimer = null
    if (mounted) return
    stopNotifPoll()
    projDataFlush_()
    ctl.abort()
    qsCloseDialogs()
  }, 0)
}

/* ---------- Phiên ---------- */
const keyNow = () => readToken() + '|' + readViewAs()

/* Đổi tài khoản / công ty xem: bỏ dữ liệu cũ, giữ mã dự án + hạng mục để mở lại nếu vẫn còn */
function resetForKey(keepCur) {
  const k = keyNow()
  if (S.key === k) return
  const curMa = keepCur && S.cur ? S.cur.maDA : ''
  projDataReset_()
  bootPromise = null
  editSeq = {}
  setState({ key: k, ...dataInit(), cur: curMa ? { maDA: curMa } : null })
}

let sessionPromise = null
export function startSession() {
  if (sessionPromise) return sessionPromise
  if (!apiConfigured()) { setState({ auth: 'unconfigured' }); return Promise.resolve() }
  if (S.auth === 'ready' && S.key === keyNow()) { return (sessionPromise = Promise.resolve().then(() => boot())) }
  const t = readToken()
  if (!t) {
    // chưa đăng nhập: thăm dò máy chủ trước, máy chủ không tới được thì hiện thẻ "Không kết nối được" (1.6)
    setState({ auth: 'checking' })
    sessionPromise = ping(ctl.signal).then(() => {
      sessionPromise = null
      setState({ auth: 'login', loginMsg: S.loginMsg || '' })
    }, e => {
      sessionPromise = null
      if (isAbort(e)) { setState({ auth: 'init' }); return }
      setState({ auth: 'unreachable', bootError: e.message })
    })
    return sessionPromise
  }
  setState({ auth: 'checking', bootStep: 'Đang xác thực tài khoản…' })
  sessionPromise = api.me(ctl.signal).then(u => {
    resetForKey(true)
    setState({ me: u, congTy: u.congTy || null, auth: 'ready', loginMsg: '', viewAs: readViewAs() })
    if (!canTab(S.tab)) { const f = firstAllowedTab_(); if (f) setState({ tab: f }) }
    startNotifPoll()
    return boot()
  }, e => {
    sessionPromise = null
    if (isAbort(e)) { setState({ auth: 'init' }); return }
    if (e && e.name === 'QsUnreachableError') { setState({ auth: 'unreachable', bootError: e.message }); return }
    writeToken('')
    setState({ auth: 'login' })
  })
  return sessionPromise
}
export function retrySession() { sessionPromise = null; return startSession() }

/* Port doLogin_: trả Promise; lỗi ném ra để màn đăng nhập hiện chữ của máy chủ */
export async function login(user, pw) {
  user = String(user || '').trim(); pw = String(pw || '')
  if (!user || !pw) throw new Error('Nhập tên đăng nhập và mật khẩu')
  const r = await api.login(user, pw)
  writeToken(r.token)
  sessionPromise = Promise.resolve()
  resetForKey(true)
  setState({ me: r.user, congTy: r.congTy || null, auth: 'ready', loginMsg: '', viewAs: readViewAs() })
  if (!canTab(S.tab)) { const f = firstAllowedTab_(); if (f) setState({ tab: f }) }
  startNotifPoll()
  boot()
  return r
}

/* Port authLogout_: báo server (thu hồi phiên phía máy chủ, M1.2) rồi xoá token; không tải lại trang */
export async function logout() {
  await projDataFlush_()   // gửi hết hàng đợi khi token còn (sau đó mới xoá token)
  try { await api.logout() } catch (e) { /* phiên đã hết thì thôi */ }
  stopNotifPoll()
  writeToken(''); writeViewAs(''); writeSs('qs_cur', '')
  try { localStorage.removeItem('qs_user') } catch (e) { /* bỏ qua */ }
  projDataReset_()
  bootPromise = null; sessionPromise = null; editSeq = {}
  qsCloseDialogs()
  setState({ key: '', ...dataInit(), me: null, congTy: null, viewAs: '', auth: 'login', loginMsg: '' })
}

export async function changePassword(oldPw, newPw) {
  return api.changePassword(oldPw, newPw)
}

/* NOAUTH ở bất kỳ request nào (http.js phát 'qs:noauth') -> màn đăng nhập với lời nhắc hết phiên.
   Dữ liệu giữ nguyên; đăng nhập lại thì boot lại và giữ dự án / hạng mục nếu còn. */
if (typeof window !== 'undefined' && !window.__qsNoauthBound) {
  window.__qsNoauthBound = true
  window.addEventListener('qs:noauth', e => {
    if (S.auth === 'login') return
    stopNotifPoll()
    sessionPromise = null; bootPromise = null
    setState({ auth: 'login', loginMsg: (e.detail && e.detail.message) || 'Phiên đã hết, mời đăng nhập lại.' })
  })
}

/* Super "xem như" 1 công ty (PUB/congty.js:73-87) */
export async function setViewAs(id) {
  id = id || ''
  await projDataFlush_()   // hàng đợi phải đi với công ty CŨ: header x-view-company đọc lúc gửi
  writeViewAs(id)
  toast(id ? 'Đang xem dữ liệu công ty đã chọn' : 'Đã thoát chế độ xem')
  resetForKey(true)
  setState({ viewAs: id })
  return boot().catch(e => toast('Lỗi tải dữ liệu công ty: ' + e.message))
}

/* ---------- Boot (port boot()) ---------- */
let bootPromise = null
export function boot(force) {
  if (bootPromise && !force) return bootPromise
  const sig = ctl.signal
  const myKey = S.key
  bootPromise = (async () => {
    setState({ boot: 'loading', bootStep: 'Đang tải dự án & danh mục sản phẩm…', bootError: '', bootErrorKind: '' })
    const remembered = (S.cur && S.cur.maDA) || readSs('qs_cur') || null
    const b = await api.bootstrap(remembered, sig)
    if (S.key !== myKey) return
    const projects = (b && b.projects) || []
    let cur = remembered ? projects.filter(p => p.maDA === remembered)[0] : null
    cur = cur || projects[0] || null
    setState({ projects, products: (b && b.products) || [] })
    if (cur) setState({ bootStep: 'Đang tải bảng bóc tách “' + (cur.ten || cur.maDA) + '”…' })
    const lines = cur ? ((await api.getLines(cur.maDA, sig)) || []) : []
    if (S.key !== myKey) return
    setState({ cur, lines })
    writeSs('qs_cur', cur ? cur.maDA : '')
    if (cur) await projDataLoad_(cur.maDA)
    setState({ bootStep: 'Đang dựng giao diện…' })
    hmInit_()
    setState({ boot: 'ready', bootStep: '' })
    bumpVisible(S.tab)
    ctLoad(true)
  })().catch(e => {
    bootPromise = null
    if (isAbort(e)) { setState({ boot: 'idle' }); return }
    if (e && e.name === 'QsAuthError') return
    setState({ boot: 'error', bootError: e.message, bootErrorKind: e.name === 'QsUnreachableError' ? 'unreachable' : 'error' })
  })
  return bootPromise
}
export function retryBoot() { bootPromise = null; return boot(true) }

/* ---------- Hạng mục: node (Bóc tách) và hmNode (lọc dùng chung, '' = tất cả, nhớ ở qs_hm) ---------- */
export function hmGet_() { return S.hmNode || '' }
/* from: 'sp' | 'bg' | 'init' | ... (tab gọi) — tab Xuất báo giá / Danh sách SP đọc hmFrom để làm đúng như hmSet_ */
export function setHmNode(code, from) {
  code = String(code || '')
  if (code) qbRecentPush_(code)
  writeLs('qs_hm', code)
  const patch = { hmNode: code, hmFrom: from || '' }
  if (code && S.node !== code) patch.node = code
  setState(patch)
}
/* Chọn đề mục trên cây Bóc tách (PUB/app.js:1592) */
export function setNode(code) {
  code = String(code || '') || DEFAULT_NODE
  qbRecentPush_(code)
  setState({ node: code })
}
function hmInit_() {
  const luu = readLs('qs_hm')
  setState({ hmNode: luu || S.node || '' })
  if (luu) setHmNode(luu, 'init')
}

/* ---------- Tab đang mở / số lần hiện (re-fetch rule) / ý định điều hướng ---------- */
export function bumpVisible(tab) {
  setState(s => ({ visSeq: { ...s.visSeq, [tab]: (s.visSeq[tab] || 0) + 1 } }))
}
export function showTab(tab, intent) {
  if (S.me && !canTab(tab)) {
    const f = firstAllowedTab_()
    if (!f) { toast('Tài khoản chưa được cấp quyền vào phần nào'); return }
    tab = f
  }
  setErrorTab(tab)
  const patch = { tab }
  if (intent !== undefined) patch.intents = { ...S.intents, [tab]: intent }
  setState(patch)
  bumpVisible(tab)
}
/* Ghi ý định cho 1 tab mà không mở tab đó (tab nằm ở trang khác, vd Admin / Công ty ở Cài đặt) */
export function setIntent(tab, intent) {
  setState({ intents: { ...S.intents, [tab]: intent } })
}
export function consumeIntent(tab) {
  const v = S.intents[tab]
  if (v === undefined) return undefined
  const intents = { ...S.intents }; delete intents[tab]
  setState({ intents })
  return v
}

/* ---------- Dự án ---------- */
let openSeq = 0
/* Port openProject_: chỉ lần bấm CUỐI được áp; tải dòng xong mới gán cur + lines cùng lúc */
export async function selectProject(maDA) {
  const p = S.projects.filter(x => x.maDA === maDA)[0]
  if (!p) return false
  const seq = ++openSeq
  let lines
  try { lines = (await api.getLines(maDA, ctl.signal)) || [] } catch (e) {
    if (seq === openSeq && !isAbort(e)) toast('Không tải được dự án: ' + e.message)
    return false
  }
  if (seq !== openSeq) return false
  setState({ cur: p, lines })
  writeSs('qs_cur', maDA)
  await projDataLoad_(maDA)
  if (seq === openSeq) bumpVisible(S.tab)
  return seq === openSeq
}

export function syncProj(p) {
  if (!p) return
  setState(s => ({
    cur: s.cur && s.cur.maDA === p.maDA ? p : s.cur,
    projects: s.projects.map(x => (x.maDA === p.maDA ? p : x)),
  }))
}

/* Port projReload_ (dash.js:60-69) */
export async function reloadProjects() {
  let projects = S.projects
  try { projects = (await api.getProjects(ctl.signal)) || [] } catch (e) { if (!isAbort(e)) toast('Lỗi tải danh sách dự án: ' + e.message); return }
  let cur = S.cur ? projects.filter(p => p.maDA === S.cur.maDA)[0] : null
  cur = cur || projects[0] || null
  const changed = (cur ? cur.maDA : null) !== (S.cur ? S.cur.maDA : null)
  let lines = []
  try { lines = cur ? ((await api.getLines(cur.maDA, ctl.signal)) || []) : [] } catch (e) { lines = [] }
  setState({ projects, cur, lines })
  writeSs('qs_cur', cur ? cur.maDA : '')
  if ((cur ? cur.maDA : null) !== (S.pdOk || null) || changed) await projDataLoad_(cur ? cur.maDA : null)
  bumpVisible(S.tab)
}

export async function reloadProducts() {
  try { setState({ products: (await api.getProducts(ctl.signal)) || [] }) } catch (e) { if (!isAbort(e) && !(e && e.name === 'QsAuthError')) toast('Lỗi tải danh mục sản phẩm: ' + e.message) }
}
export async function reloadLines() {
  const ma = S.cur && S.cur.maDA
  if (!ma) return
  try {
    const ls = (await api.getLines(ma, ctl.signal)) || []
    if (S.cur && S.cur.maDA === ma) setState({ lines: ls })
  } catch (e) { if (!isAbort(e)) toast('Lỗi tải bảng bóc tách: ' + e.message) }
}

export async function createProject(d) {
  const p = await api.createProject(d)
  try { setState({ projects: (await api.getProjects()) || [] }) } catch (e) { setState(s => ({ projects: [p, ...s.projects] })) }
  await selectProject(p.maDA)
  return p
}
export async function updateProject(maDA, fields) {
  const p = await api.updateProject(maDA, fields)
  if (p) syncProj(p)
  return p
}
export async function deleteProject(maDA) {
  await api.deleteProject(maDA)
  /* Không gán cur = null trước (bảng điều khiển sẽ nháy "Chưa chọn bản nháp"): reloadProjects tự bỏ bản đã xoá.
     Chỉ khi tải lại danh sách hỏng mà cur vẫn là bản đã xoá thì mới bỏ chọn, như removeProject (PUB/app.js:2347) */
  await reloadProjects()
  if (S.cur && S.cur.maDA === maDA) { setState({ cur: null, lines: [] }); writeSs('qs_cur', ''); await projDataLoad_(null) }
}
/* Như dupDo_ (PUB/dash.js:133-135): mở luôn dự án vừa nhân bản */
export async function duplicateProject(maDA, opts) {
  const p = await api.duplicateProject(maDA, opts)
  try { setState({ projects: (await api.getProjects(ctl.signal)) || [] }) } catch (e) { setState(s => ({ projects: [p, ...s.projects] })) }
  await selectProject(p.maDA)
  return p
}

/* ---------- Dòng bóc tách (optimistic như bản gốc) ---------- */
let tmpN = 0
export const newTmpId = () => 'tmp_' + (++tmpN)
export const isTmp = id => String(id || '').indexOf('tmp_') === 0
let editSeq = {}
const tmpQ = {}        // sửa trên dòng tạm, gửi khi có id thật
const pendingDel = {}  // dòng tạm bị xoá khi đang chờ server
const setLines = fn => setState(s => ({ lines: fn(s.lines) }))
const lineOf = id => S.lines.filter(l => l.lineId === id)[0]
export const lineOf_ = lineOf

async function resyncLines(ma) {
  try {
    const ls = await api.getLines(ma)
    if (ls && S.cur && S.cur.maDA === ma) setState({ lines: ls })
  } catch (e) { /* bỏ qua */ }
}

/* Port editLine: cập nhật + vẽ NGAY (recalcLine_), server chạy nền; chỉ phản hồi của lần sửa mới nhất được áp.
   Dòng tạm (tmp_) -> gom vào _q, gửi khi có id thật. Server trả null = dòng đã bị xoá nơi khác. */
export function updateLine(id, fields) {
  const l = lineOf(id)
  if (l) {
    const n = { ...l, ...fields }
    recalcLine_(n, fields)
    setLines(ls => ls.map(x => (x.lineId === id ? n : x)))
  }
  if (isTmp(id)) { tmpQ[id] = { ...(tmpQ[id] || {}), ...fields }; return Promise.resolve(null) }
  const seq = editSeq[id] = (editSeq[id] || 0) + 1
  const ma = S.cur && S.cur.maDA
  return api.updateLine(id, fields).then(u => {
    if (u) {
      if (editSeq[id] !== seq) return u
      setLines(ls => ls.map(x => (x.lineId === id ? u : x)))
      return u
    }
    setLines(ls => ls.filter(x => x.lineId !== id))
    dropHistoryFor([id])
    toast('Dòng này không còn tồn tại (đã bị xoá) — đã cập nhật lại bảng')
    return null
  }).catch(e => {
    if (e && e.name === 'QsAuthError') return null
    toast('Lỗi sửa: ' + e.message + ' — đã nạp lại số đang lưu')
    if (ma) resyncLines(ma)
    return null
  })
}

/* Thêm dòng (phần optimistic của addProdObj). prod = payload server, temp = dòng tạm hiện ngay (tuỳ chọn,
   lineId 'tmp_n' — lib/calc addProdBuild_ dựng sẵn cả hai). Trả Line thật, hoặc null nếu lỗi. */
export function addLine(prod, soLuong, temp) {
  if (!S.cur) { toast('Chưa chọn dự án — bấm Tạo dự án +'); return Promise.resolve(null) }
  const maDA = S.cur.maDA
  const tid = temp ? (temp.lineId && isTmp(temp.lineId) ? temp.lineId : newTmpId()) : null
  if (temp) setLines(ls => [...ls, { ...temp, lineId: tid, _pending: true }])
  return api.addLine(maDA, prod, soLuong).then(l => {
    const q = tid ? tmpQ[tid] : null
    if (tid) delete tmpQ[tid]
    if (tid && pendingDel[tid]) { delete pendingDel[tid]; api.deleteLine(l.lineId).catch(() => {}); return null }
    if (!S.cur || S.cur.maDA !== maDA) {
      if (q) api.updateLine(l.lineId, q).catch(() => {})
      return l
    }
    setLines(ls => (tid && ls.some(x => x.lineId === tid) ? ls.map(x => (x.lineId === tid ? l : x)) : [...ls, l]))
    if (q) updateLine(l.lineId, q)
    histAdd_(maDA, l.lineId)
    return l
  }).catch(e => {
    if (tid) { delete tmpQ[tid]; delete pendingDel[tid]; setLines(ls => ls.filter(x => x.lineId !== tid)) }
    if (!(e && e.name === 'QsAuthError')) toast('Lỗi thêm: ' + e.message)
    return null
  })
}

export async function addBlankLine(opts) {
  if (!S.cur) { toast('Chưa chọn dự án'); return null }
  const maDA = S.cur.maDA
  try {
    const l = await api.addBlankLine(maDA, opts || {})
    if (S.cur && S.cur.maDA === maDA) setLines(ls => [...ls, l])
    return l
  } catch (e) { if (!(e && e.name === 'QsAuthError')) toast('Lỗi: ' + e.message); return null }
}

/* Xoá dòng: 1 dòng không hỏi (delLine); nhiều dòng hỏi lại (tkBulkDel_), mỗi đợt 5 request; ghi lịch sử để hoàn tác (histDel_).
   Dòng tạm: đánh dấu _del (addLine xoá khi có id thật). Trả số dòng đã xoá. */
export async function deleteLines(ids, opts = {}) {
  ids = (ids || []).filter(Boolean)
  if (!ids.length) return 0
  const tam = ids.filter(isTmp)
  const real = ids.filter(id => !isTmp(id))
  const ask = opts.confirm !== undefined ? opts.confirm : ids.length > 1
  if (ask) {
    if (tam.length) toast(tam.length + ' dòng vừa thêm đang lưu — chưa xoá các dòng đó, thử lại sau 1–2 giây')
    if (!real.length) return 0
    if (!(await qsConfirm('Xoá ' + real.length + ' dòng đã chọn? Hoàn tác được bằng Ctrl+Z.'))) return 0
  } else if (tam.length) {
    tam.forEach(id => { pendingDel[id] = 1 })
    setLines(ls => ls.filter(l => tam.indexOf(l.lineId) < 0))
  }
  let loi = 0
  let loiMsg = ''
  const xong = {}
  const snaps = real.map(id => S.lines.find(l => l.lineId === id)).filter(Boolean).map(l => ({ ...l }))
  const maDel = S.cur && S.cur.maDA
  for (let i = 0; i < real.length; i += 5) {
    await Promise.all(real.slice(i, i + 5).map(id => api.deleteLine(id).then(() => { xong[id] = 1 }, e => { loi++; if (!loiMsg) loiMsg = (e && e.message) || String(e) })))
  }
  setLines(ls => ls.filter(l => !xong[l.lineId]))
  if (!histMute) dropHistoryFor(Object.keys(xong))
  histDel_(maDel, snaps.filter(l => xong[l.lineId]))
  const n =Object.keys(xong).length + (ask ? 0 : tam.length)
  if (ask) toast('Đã xoá ' + (real.length - loi) + ' dòng' + (loi ? (' · ' + loi + ' lỗi') : ''))
  else if (loi) toast('Lỗi xoá: ' + loiMsg + (loi > 1 ? ' (' + loi + ' dòng)' : ''))
  else toast('Đã xoá')
  return n
}

/* Port tkMoveLine_: chuyển 1 dòng tới trước/sau targetId (hoặc cuối tầng floor), đánh lại STT 1..n CẢ DỰ ÁN,
   PATCH {stt,tang} cho mọi dòng đổi. Trả danh sách thay đổi [{lineId, old:{stt,tang}, new:{stt,tang}}]. */
export async function moveLine(dragId, floor, targetId, before) {
  const arr = S.lines.slice()
  const di = arr.findIndex(l => l.lineId === dragId)
  if (di < 0) return []
  if (isTmp(dragId)) { toast('Dòng vừa thêm đang lưu — thử lại sau 1–2 giây'); return [] }
  if (floor === 'CHƯA PHÂN TẦNG') floor = ''
  if (targetId === dragId) return []
  const oldOf = {}
  arr.forEach(l => { oldOf[l.lineId] = { stt: l.stt, tang: l.tang || '' } })
  const dragged = { ...arr[di], tang: floor }
  arr.splice(di, 1)
  let idx
  if (targetId) { const ti = arr.findIndex(l => l.lineId === targetId); idx = ti < 0 ? arr.length : (before ? ti : ti + 1) }
  else { let last = -1; arr.forEach((l, i) => { if ((l.tang || '') === floor) last = i }); idx = last >= 0 ? last + 1 : arr.length }
  arr.splice(idx, 0, dragged)
  return applyOrder_(arr, oldOf)
}

/* Áp thứ tự mới cho toàn bộ dòng của dự án (arr = mảng Line theo thứ tự mới, tang đã gán) */
export async function reorderLines(arr) {
  const oldOf = {}
  S.lines.forEach(l => { oldOf[l.lineId] = { stt: l.stt, tang: l.tang || '' } })
  return applyOrder_(arr.slice(), oldOf)
}
async function applyOrder_(arr, oldOf) {
  const changed = []
  const next = arr.map((l, i) => {
    const o = oldOf[l.lineId] || {}
    // so với STT / tầng ĐANG LƯU (oldOf), không so với l.stt: hoàn tác đổi chỗ truyền vào l.stt cũ
    if ((o.stt !== i + 1 || (o.tang || '') !== (l.tang || '')) && !isTmp(l.lineId))
      changed.push({ lineId: l.lineId, old: { stt: o.stt, tang: o.tang || '' }, new: { stt: i + 1, tang: l.tang || '' } })
    return l.stt === i + 1 ? l : { ...l, stt: i + 1 }
  })
  setState({ lines: next })
  try { await Promise.all(changed.map(c => api.updateLine(c.lineId, { stt: c.new.stt, tang: c.new.tang }))) }
  catch (e) { if (!(e && e.name === 'QsAuthError')) toast('Lỗi lưu thứ tự: ' + (e.message || e)) }
  return changed
}

/* ---------- Lịch sử hoàn tác theo dự án (D12): chỉ vá trường + đổi chỗ ---------- */
export function histOf(maDA) { return S.hist[maDA] || { past: [], future: [] } }
export function setHist(maDA, h) {
  setState(s => ({ hist: { ...s.hist, [maDA]: { past: h.past.slice(-HIST_LIMIT), future: h.future } }, histVer: s.histVer + 1 }))
}
/* Bỏ mọi bước có nhắc tới dòng đã xoá */
export function dropHistoryFor(ids) {
  if (!ids || !ids.length) return
  const gone = {}; ids.forEach(id => { gone[id] = 1 })
  const ref = e => (e.patches || []).some(p => gone[p.lineId]) || (e.moves || []).some(m => gone[m.lineId]) || (e.added || []).some(id => gone[id])
  const hist = {}
  Object.keys(S.hist).forEach(k => {
    const h = S.hist[k]
    hist[k] = { past: h.past.filter(e => !ref(e)), future: h.future.filter(e => !ref(e)) }
  })
  setState(s => ({ hist, histVer: s.histVer + 1 }))
}

/* Hoàn tác thêm / xoá dòng: bước lịch sử {label, patches:[], moves:[], added:[id] | removed:[bản chụp dòng]}.
   histMute_ = đang chạy hoàn tác / làm lại -> không ghi thêm bước. Thêm nhiều dòng liền nhau (< 1,5 giây, vd. combo) gộp 1 bước */
let histMute = 0
let lastAddAt = 0
function histAdd_(maDA, id) {
  if (histMute || !maDA || !id) return
  const h = histOf(maDA); const past = h.past.slice(); const last = past[past.length - 1]
  const now = Date.now()
  if (last && last.added && now - lastAddAt < 1500) past[past.length - 1] = { ...last, added: last.added.concat(id), label: 'Thêm ' + (last.added.length + 1) + ' dòng' }
  else past.push({ label: 'Thêm dòng', patches: [], moves: [], added: [id] })
  lastAddAt = now
  setHist(maDA, { past, future: [] })
}
function histDel_(maDA, snaps) {
  if (histMute || !maDA || !snaps.length) return
  const h = histOf(maDA)
  setHist(maDA, { past: [...h.past, { label: snaps.length > 1 ? 'Xoá ' + snaps.length + ' dòng' : 'Xoá dòng', patches: [], moves: [], removed: snaps }], future: [] })
}
/* đổi mã dòng cũ -> mới trong MỌI bước lịch sử (dòng được thêm lại sau hoàn tác xoá có mã mới) */
function histRemap_(map) {
  const f = id => map[id] || id
  const fix = e => ({ ...e,
    patches: (e.patches || []).map(p => ({ ...p, lineId: f(p.lineId) })),
    moves: (e.moves || []).map(m => ({ ...m, lineId: f(m.lineId) })),
    added: e.added && e.added.map(f),
    removed: e.removed && e.removed.map(l => ({ ...l, lineId: f(l.lineId) })) })
  const hist = {}
  Object.keys(S.hist).forEach(k => { const h = S.hist[k]; hist[k] = { past: h.past.map(fix), future: h.future.map(fix) } })
  setState(s => ({ hist, histVer: s.histVer + 1 }))
}
/* thêm lại các dòng đã chụp, đặt lại đúng tầng + thứ tự cũ; trả bản chụp mang mã mới */
async function restoreLines_(snaps) {
  const map = {}; const out = []
  for (const sn of snaps) {
    const prod = { ...sn, ma: sn.maSP }
    delete prod.lineId; delete prod.recordId; delete prod.fmt; delete prod._pending
    const l = await addLine(prod, Number(sn.soLuong) || 0)
    if (!l) continue
    map[sn.lineId] = l.lineId
    if (sn.fmt) updateLine(l.lineId, { fmt: sn.fmt })
    out.push({ ...sn, lineId: l.lineId })
  }
  const want = {}; out.forEach(sn => { want[sn.lineId] = sn })
  const arr = S.lines.map((l, i) => ({ l: want[l.lineId] ? { ...l, tang: want[l.lineId].tang || '', stt: want[l.lineId].stt } : l, i, w: want[l.lineId] ? 0 : 1 }))
    .sort((a, b) => ((Number(a.l.stt) || 0) - (Number(b.l.stt) || 0)) || (a.w - b.w) || (a.i - b.i)).map(x => x.l)
  if (out.length) await reorderLines(arr)
  histRemap_(map)
  return out
}
/* Bước lịch sử cho thao tác HIỂN THỊ (độ rộng / thứ tự / ẩn hiện cột, chiều cao hàng…): view = {undo(), redo()} chạy lại
   trạng thái trước / sau. Ghi vào lịch sử của dự án đang mở để Hoàn tác / Làm lại dùng chung một hàng với sửa dữ liệu */
export function histPushView(label, undo, redo) {
  if (histMute || !S.cur) return
  const ma = S.cur.maDA
  const h = histOf(ma)
  setHist(ma, { past: [...h.past, { label, patches: [], moves: [], view: { undo, redo } }], future: [] })
}

/* Hoàn tác / làm lại 1 bước thêm / xoá dòng (useLinesSheet.step gọi); trả bước đã cập nhật (mã dòng mới, bản chụp) */
export async function histRunAddDel(e, dir) {
  histMute++
  try {
    const delNow = (e.added && dir === 'undo') || (e.removed && dir === 'redo')
    if (delNow) {
      const ids = e.added || e.removed.map(l => l.lineId)
      const snaps = ids.map(id => S.lines.find(l => l.lineId === id)).filter(Boolean).map(l => ({ ...l }))
      await deleteLines(ids, { confirm: false })
      return e.added ? { ...e, snaps } : e
    }
    const snaps = e.added ? (e.snaps || []) : e.removed
    const out = await restoreLines_(snaps)
    return e.added ? { ...e, added: out.map(l => l.lineId), snaps: null } : { ...e, removed: out }
  } finally { histMute-- }
}

/* ---------- Công tác (cache dùng chung, PUB/phantho.js:644-660) ---------- */
let ctPromise = null, ctSeq = 0
/* fresh = gọi sau khi ghi: lần tải đang chạy có thể đã gửi TRƯỚC lần ghi nên luôn gửi yêu cầu mới (ctLoad_ bản gốc luôn tải lại);
   chỉ kết quả của lần gửi mới nhất được ghi vào store, lần cũ trả về lần mới nhất */
export function ctLoad(quiet, fresh) {
  if (ctPromise && !fresh) return ctPromise
  const my = ++ctSeq
  const stale = () => my !== ctSeq
  setState({ ctStatus: 'loading' })
  const p = api.ctList(ctl.signal).then(list => {
    if (stale()) return ctPromise || S.congTac
    setState({ congTac: list || [], ctStatus: 'ready', ctError: '' })
    return S.congTac
  }, e => {
    if (stale()) return ctPromise || S.congTac
    if (!isAbort(e)) {
      setState({ ctStatus: 'error', ctError: e.message })
      if (!quiet) toast('Không tải được công tác: ' + e.message)
    } else setState({ ctStatus: 'idle' })
    return S.congTac
  }).finally(() => { if (ctPromise === p) ctPromise = null })
  ctPromise = p
  return p
}

/* ---------- Thông báo: 1 interval trong store, dừng khi rời /qs ---------- */
let notifTimer = null
export async function refreshNotifCount() {
  if (!S.me) return
  try { const c = await api.notifCount(); setState({ notifUnread: (c && c.unread) || 0 }) } catch (e) { /* như bản gốc: im lặng */ }
}
export function startNotifPoll() {
  if (!mounted || S.auth !== 'ready' || notifTimer) return
  refreshNotifCount()
  notifTimer = setInterval(refreshNotifCount, 30000)
}
export function stopNotifPoll() { if (notifTimer) { clearInterval(notifTimer); notifTimer = null } }

/* Chỉ ở dev: cho kiểm thử (Playwright) đọc store và gọi vài action; bản build không có */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__qsStore = { getState: () => S, selectProject, setProjData: projDataSet_, setViewAs, setHmNode, setNode, reloadProjects,
    addLine, updateLine, deleteLines, moveLine, reloadLines, duplicateProject, deleteProject, logout }
}
