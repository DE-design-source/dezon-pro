/* Một hàm cho mỗi tên RPC của bản gốc, giữ đúng thứ tự tham số (api('updateLine', id, f) -> qsApi.updateLine(id, f)),
   ánh xạ sang REST /api/v1 (backend/internal/server/rest.go:13-94, survey-api 2.1-2.11).
   Tham số cuối (tuỳ chọn) của mọi hàm là AbortSignal.
   Cờ approve/on luôn gửi tường minh: server hiểu "thiếu" khác nhau tuỳ endpoint (thiếu = true ở duyệt/yêu thích,
   = false ở các endpoint resolve). Khoá sản phẩm: truyền recordId nếu có (chuỗi toàn số = id dòng). */
import { request, enc } from './http'

const get = (path, query, signal) => request('GET', path, { query, signal })
const post = (path, body, signal) => request('POST', path, { body: body === undefined ? {} : body, signal })
const put = (path, body, signal) => request('PUT', path, { body: body === undefined ? {} : body, signal })
const patch = (path, body, signal) => request('PATCH', path, { body: body === undefined ? {} : body, signal })
const del = (path, signal) => request('DELETE', path, { signal })
const yes = v => v !== false
const truthy = v => !!v
/* Lý do tuỳ chọn (chỉ bản Go, M15.2): chỉ gửi khoá lyDo khi có chữ */
const withLyDo = (body, lyDo) => (String(lyDo == null ? '' : lyDo).trim() ? { ...body, lyDo: String(lyDo).trim() } : body)

/* ---- Auth / phiên ---- */
export const login = (username, password, signal) => post('/auth/login', { username, password }, signal)
export const me = signal => get('/auth/me', null, signal)
export const logout = signal => post('/auth/logout', {}, signal)
export const changePassword = (oldPw, newPw, signal) => post('/auth/change-password', { oldPw, newPw }, signal)
/* Tự sửa hồ sơ (chỉ bản Go): fields = {hoTen?, email?} -> tài khoản sau khi sửa */
export const updateMe = (fields, signal) => patch('/auth/me', fields, signal)
export const setMyPref = (key, value, signal) => put('/auth/me/prefs/' + enc(key), { value: value === undefined ? null : value }, signal)
export const logClientError = (info, signal) => post('/client-errors', info || {}, signal)

/* ---- Thông báo ---- */
export const notifCount = signal => get('/notifications/unread-count', null, signal)
export const notifList = (n, signal) => get('/notifications', { limit: n }, signal)
export const notifRead = (id, signal) => post('/notifications/' + enc(id) + '/read', {}, signal)
export const notifReadAll = signal => post('/notifications/read-all', {}, signal)

/* ---- Dự án / dữ liệu dự án ---- */
export const bootstrap = (maDA, signal) => get('/bootstrap', maDA ? { maDA } : null, signal)
export const getProjects = signal => get('/projects', null, signal)
export const createProject = (d, signal) => post('/projects', d || {}, signal)
export const updateProject = (maDA, fields, signal) => patch('/projects/' + enc(maDA), fields || {}, signal)
export const deleteProject = (maDA, signal) => del('/projects/' + enc(maDA), signal)
export const duplicateProject = (maDA, opts, signal) => post('/projects/' + enc(maDA) + '/duplicate', opts || {}, signal)
export const getProjData = (maDA, signal) => get('/projects/' + enc(maDA) + '/data', null, signal)
export const setProjData = (maDA, khoa, giaTri, signal) =>
  put('/projects/' + enc(maDA) + '/data/' + enc(khoa), { giaTri: giaTri === undefined ? null : giaTri }, signal)
/* Yêu cầu sửa thông tin dự án (chỉ bản Go, migration 0037): người duyệt -> {applied, project}; người khác -> {pending, id} */
export const requestProjectEdit = (maDA, fields, lyDo, signal) =>
  post('/projects/' + enc(maDA) + '/edit-requests', withLyDo({ fields: fields || {} }, lyDo), signal)
/* -> {canApprove, items[{id, maDA, tenDA, requester, changes, oldValues, status, lyDo, at, resolver, resolvedAt, lyDoTuChoi}]} */
export const listProjectEditRequests = (maDA, status, signal) =>
  get('/project-edit-requests', { ...(maDA ? { maDA } : {}), ...(status ? { status } : {}) }, signal)
export const resolveProjectEditRequest = (id, approve, lyDo, signal) =>
  post('/project-edit-requests/' + enc(id) + '/resolve', withLyDo({ approve: truthy(approve) }, lyDo), signal)

/* ---- Dòng bóc tách ---- */
export const getLines = (maDA, signal) => get('/projects/' + enc(maDA) + '/lines', null, signal)
export const addLine = (maDA, product, soLuong, signal) => post('/projects/' + enc(maDA) + '/lines', { product: product || {}, soLuong }, signal)
export const addBlankLine = (maDA, opts, signal) => post('/projects/' + enc(maDA) + '/lines/blank', opts || {}, signal)
export const updateLine = (id, fields, signal) => patch('/lines/' + enc(id), fields || {}, signal)
export const deleteLine = (id, signal) => del('/lines/' + enc(id), signal)
export const saveLineAsProduct = (line, signal) => post('/lines/save-as-product', line || {}, signal)

/* ---- Sản phẩm ---- */
export const getProducts = signal => get('/products', null, signal)
export const getDbProduct = (key, signal) => get('/products/' + enc(key), null, signal)
export const updateDbProductTracked = (key, data, signal) => patch('/products/' + enc(key), data || {}, signal)
export const saveDbProduct = (data, signal) => post('/products', data || {}, signal)
export const deleteDbProduct = (key, signal) => del('/products/' + enc(key), signal)
export const getCombo = (key, signal) => get('/products/' + enc(key) + '/combo', null, signal)
export const setCombo = (key, items, signal) => put('/products/' + enc(key) + '/combo', { items: items || [] }, signal)
export const getBienThe = (key, signal) => get('/products/' + enc(key) + '/variants', null, signal)
export const setBienThe = (key, ids, signal) => put('/products/' + enc(key) + '/variants', { ids: ids || [] }, signal)
export const getProductHistory = (maSP, signal) => get('/products/' + enc(maSP) + '/history', null, signal)
export const setSpDuyet = (keys, approve, signal) => post('/product-approvals', { keys: keys || [], approve: yes(approve) }, signal)
export const setYeuThich = (keys, on, signal) => post('/product-favorites', { keys: keys || [], on: yes(on) }, signal)
export const spMyPerms = signal => get('/product-permissions', null, signal)
export const requestDeleteProducts = (items, lyDo, signal) => post('/product-delete-requests', withLyDo({ items: items || [] }, lyDo), signal)
export const uploadImage = (base64, fileName, signal) => post('/uploads/images', { base64, fileName }, signal)
export const uploadFile = (base64, fileName, signal) => post('/uploads/files-base64', { base64, fileName }, signal)
export const importParse = (base64, ext, nganh, signal) => post('/product-imports/parse', { base64, ext, nganh }, signal)
export const importCommit = (products, signal) => post('/product-imports/commit', { products: products || [] }, signal)
/* Route chỉ bản Go (M10.1): bản sao riêng của SP kho chung Dezon (key = recordId) -> {ok, id, ma, ten} */
export const privateCopyProduct = (key, signal) => post('/products/' + enc(key) + '/private-copy', {}, signal)

/* ---- Công tác (phần thô) ---- */
export const ctList = signal => get('/work-items', null, signal)
export const ctSave = (data, signal) => post('/work-items', data, signal)
export const ctUpdate = (id, p, signal) => patch('/work-items/' + enc(id), p || {}, signal)
export const ctHistory = (id, signal) => get('/work-items/' + enc(id) + '/history', null, signal)
export const ctFav = (ids, on, signal) => post('/work-items/favorites', { ids, on: yes(on) }, signal)
export const ctDuyet = (ids, approve, signal) => post('/work-items/approval', { ids, approve: yes(approve) }, signal)
export const ctDelete = (ids, signal) => post('/work-items/delete', { ids }, signal)

/* ---- Báo giá / tờ bìa ---- */
export const getCoverOrInit = (maDA, signal) => get('/projects/' + enc(maDA) + '/cover', null, signal)
export const buildCoverFromTemplate = (maDA, signal) => get('/projects/' + enc(maDA) + '/cover/template', null, signal)
export const saveCover = (maDA, rows, signal) => put('/projects/' + enc(maDA) + '/cover', { rows: rows || [] }, signal)
/* Trả {name, mimeType, base64} trong envelope (không phải tải file nhị phân) */
export const exportBaoGia = (maDA, cols, format, nodes, phanTho, anMuc, tong, org, signal) =>
  post('/projects/' + enc(maDA) + '/quotation/export', { cols, format, nodes, phanTho, anMuc, tong, org }, signal)

/* ---- Mua hàng / đề xuất ---- */
export const sendPurchaseRequest = (order, signal) => post('/purchase-orders', order || {}, signal)
export const getPurchaseOrders = (maDA, signal) => get('/projects/' + enc(maDA) + '/purchase-orders', null, signal)
export const setPurchaseStatus = (code, status, signal) => patch('/purchase-orders/' + enc(code) + '/status', { status }, signal)
export const sendDeXuat = (dx, signal) => post('/proposals', dx || {}, signal)
export const getDeXuatList = (maDA, signal) => get('/projects/' + enc(maDA) + '/proposals', null, signal)
export const getDeXuat = (ma, signal) => get('/proposals/' + enc(ma), null, signal)
/* Route chỉ bản Go (M13.1): phiếu của chính mình; admin / super: mọi phiếu của công ty */
export const getMyDeXuat = (code, signal) => get('/my-proposals/' + enc(code), null, signal)
export const listDeXuat = (loai, signal) => get('/proposals', loai ? { loai } : null, signal)
export const resolveDeXuat = (ma, approve, signal) => post('/proposals/' + enc(ma) + '/resolve', { approve: truthy(approve) }, signal)

/* ---- Admin ---- */
export const adminListUsers = signal => get('/users', null, signal)
export const adminCreateUser = (data, signal) => post('/users', data || {}, signal)
export const adminUpdateUser = (id, fields, signal) => patch('/users/' + enc(id), fields || {}, signal)
export const adminSetPassword = (id, newPassword, signal) => put('/users/' + enc(id) + '/password', { newPassword }, signal)
export const adminSetActive = (id, active, signal) => put('/users/' + enc(id) + '/active', { active: truthy(active) }, signal)
export const adminDeleteUser = (id, signal) => del('/users/' + enc(id), signal)
export const getAuditLog = (n, signal) => get('/audit-log', { limit: n }, signal)
export const listDeleteRequests = signal => get('/product-delete-requests', null, signal)
export const resolveDeleteRequest = (id, approve, lyDo, signal) =>
  post('/product-delete-requests/' + enc(id) + '/resolve', withLyDo({ approve: truthy(approve) }, approve ? '' : lyDo), signal)
export const listPurchaseRequests = signal => get('/purchase-orders', null, signal)
export const getPurchaseOrder = (code, signal) => get('/purchase-orders/' + enc(code), null, signal)
export const resolvePurchaseRequest = (code, approve, signal) => post('/purchase-orders/' + enc(code) + '/resolve', { approve: truthy(approve) }, signal)

/* ---- Công ty (super) ---- */
export const listCongTy = signal => get('/companies', null, signal)
export const createCongTy = (d, signal) => post('/companies', d || {}, signal)
export const updateCongTy = (id, d, signal) => patch('/companies/' + enc(id), d || {}, signal)
export const deleteCongTy = (id, signal) => del('/companies/' + enc(id), signal)
export const listCongTyUsers = (id, signal) => get('/companies/' + enc(id) + '/users', null, signal)
export const createCongTyUser = (id, d, signal) => post('/companies/' + enc(id) + '/users', d || {}, signal)

/* ---- Báo cáo (super) ---- */
export const baoCaoNhapSP = (opts, signal) => post('/reports/new-products', opts || {}, signal)
