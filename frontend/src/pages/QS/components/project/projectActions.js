/* Thao tác trên dự án / bản nháp dùng chung cho Bảng điều khiển, băng dự án (#pcard) và hộp Thông tin dự án.
   Port: pickProject / removeProject / projInfoModal / renameDraft / rnSave_ / draftNameEdit_ / addDraftForCur /
   saveProjectShared / saveDraftInfo / saveProgress (PUB/app.js:2160-2349) · doCreate (app.js:450-462) ·
   dezonSet_ / addDraft / removeProjectGroup / dupDo_ (PUB/dash.js:21-39, 92-112, 129-140).
   Hộp thoại riêng của phần này (Thông tin dự án, Nhân bản, Đổi tên, Tạo dự án) mở qua openProjDlg(); <ProjectDialogs/> vẽ. */
import { useSyncExternalStore } from 'react'
import * as api from '../../api/qsApi'
import { uploadRaw } from '../../api/files'
import {
  getState, selectProject, showTab, reloadProjects, createProject, updateProject, deleteProject, duplicateProject,
} from '../../state/store'
import { qsToast as toast, qsConfirm, qsAsk } from '../common/dialogs'
import { projectGroups, projGroupOf_, currentGroup, addDraftPayload_, dezonHost_, dezonUrl_ } from '../../lib/dashModel.js'

/* ---------- Hộp thoại của phần dự án: {kind: 'info'|'dup'|'rename'|'create', maDA} hoặc null ---------- */
let dlg = null
const subs = new Set()
function emit(v) { dlg = v; subs.forEach(fn => fn()) }
export function openProjDlg(kind, maDA) { emit({ kind, maDA: maDA || '', id: Date.now() }) }
export function closeProjDlg(kind) { if (dlg && (!kind || dlg.kind === kind)) emit(null) }
export function useProjDlg() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => dlg, () => dlg)
}

const errMsg = e => (e && e.message) || String(e)
const isAuth = e => e && e.name === 'QsAuthError'

/* Nút "Dùng": mở bản nháp rồi sang Bóc tách */
export async function pickProject(maDA) {
  if (!(await selectProject(maDA))) return
  showTab('boc')
}

/* Popup Thông tin dự án: mở bản nháp đó trước (như projInfoModal) */
export async function projInfoModal(maDA) {
  if (!(await selectProject(maDA))) return
  openProjDlg('info', maDA)
}

/* Chip link bài dự án trên dezon.vn */
export async function dezonSet_(maDA) {
  maDA = String(maDA || '')
  const S = getState()
  const p = (S.projects || []).filter(x => x.maDA === maDA)[0] || ((S.cur && S.cur.maDA === maDA) ? S.cur : null)
  if (!p) { toast('Không tìm thấy dự án'); return }
  let v = await qsAsk({
    title: 'Link bài dự án trên dezon.vn', label: 'Dán link (để trống = bỏ link)', required: false,
    value: p.linkDezon || 'https://dezon.vn/', placeholder: 'https://dezon.vn/du-an/…', ok: 'Lưu link',
  })
  if (v == null) return
  v = String(v && v.v != null ? v.v : v).trim()
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v
  if (v && !/(^|\.)dezon\.vn$/i.test(dezonHost_(v)) && !(await qsConfirm('Link này không thuộc dezon.vn:\n' + v + '\n\nVẫn lưu?'))) return
  try {
    await updateProject(maDA, { linkDezon: v })
    toast(v ? 'Đã gắn link Dezon cho dự án' : 'Đã bỏ link Dezon')
  } catch (e) { if (!isAuth(e)) toast('Lỗi lưu link: ' + errMsg(e)) }
}

/* Thêm 1 bản nháp cho dự án có bản nháp mã key (nút "Thêm bản nháp" trên thẻ dự án) */
export async function addDraft(key) {
  const g = projGroupOf_(getState().projects, key)
  if (!g) { toast('Không tìm thấy dự án này — bấm F5 tải lại trang'); return }
  try {
    await createProject(addDraftPayload_(g))
    toast('Đã thêm bản nháp mới cho "' + g.name + '"')
  } catch (e) { if (!isAuth(e)) toast('Lỗi thêm bản nháp: ' + errMsg(e)) }
}

/* Thêm bản nháp cho dự án đang mở (trong hộp Thông tin dự án) */
export async function addDraftForCur() {
  const S = getState()
  const gr = currentGroup(S.projects, S.cur); if (!gr) return
  try {
    await createProject({ ten: gr.name, khachHang: S.cur.khachHang, sdt: S.cur.sdt, diaChi: S.cur.diaChi, vat: Number(S.cur.vat) || 0 })
    toast('Đã thêm bản nháp mới')
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)) }
}

/* Xoá 1 bản nháp */
export async function removeProject(maDA) {
  if (!(await qsConfirm('Xoá bản nháp này?'))) return
  try { await deleteProject(maDA) } catch (e) { if (!isAuth(e)) toast('Lỗi xoá bản nháp: ' + errMsg(e)); return }
  closeProjDlg()
  toast('Đã xoá bản nháp')
}

/* Xoá NHANH cả dự án (mọi bản nháp): nút thùng rác ở góc thẻ dự án */
export async function removeProjectGroup(key) {
  const g = projGroupOf_(getState().projects, key)
  if (!g) { toast('Không tìm thấy dự án này — bấm F5 tải lại trang'); return }
  const n = g.drafts.length
  if (!(await qsConfirm('Xoá cả dự án "' + g.name + '" cùng ' + n + ' bản nháp?\n\nToàn bộ hạng mục đã bóc trong các bản nháp này sẽ mất và KHÔNG khôi phục được.'))) return
  const loi = []
  for (let i = 0; i < g.drafts.length; i++) {
    try { await api.deleteProject(g.drafts[i].maDA) } catch (e) {
      if (isAuth(e)) return
      loi.push(g.drafts[i].maDA + ': ' + errMsg(e))
    }
  }
  closeProjDlg()
  await reloadProjects()   // bản đang mở bị xoá -> mở dự án đầu danh sách (như projReload_)
  toast(loi.length ? ('Xoá xong ' + (n - loi.length) + '/' + n + ' bản — lỗi: ' + loi[0]) : ('Đã xoá dự án "' + g.name + '" (' + n + ' bản nháp)'))
}

/* Đổi tên bản nháp (hộp Đổi tên: tên trống = bỏ tên tuỳ chỉnh) -> true nếu đã lưu */
export async function renameDraftSave(maDA, name) {
  try {
    await updateProject(maDA, { tenBanNhap: name })
    toast('Đã đổi tên bản nháp')
    return true
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return false }
}

/* Nhân bản bản nháp; mở luôn bản mới. Ném lỗi để hộp Nhân bản bật lại nút */
export async function duplicateDraft(maDA, opts) {
  await duplicateProject(maDA, opts)
  toast('Đã nhân bản (' + ((getState().lines || []).length) + ' hạng mục)')
}

/* Hộp "Tạo dự án mới": form {name, client, phone, address, link, vat} -> true nếu đã tạo */
export async function createFromForm(form) {
  const ten = String(form.name || '').trim()
  if (!ten) { toast('Nhập tên dự án'); return false }
  const link = String(form.link || '').trim()
  try {
    await createProject({
      ten, khachHang: form.client || '', sdt: form.phone || '', diaChi: form.address || '',
      linkDezon: link ? dezonUrl_(link) : '', vat: Number(form.vat) || 0,
    })
    toast('Đã tạo bản nháp')
    return true
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return false }
}

/* Hỏi form "Tạo dự án mới" (#mCreate, doCreate app.js:450-461) rồi tạo + mở luôn dự án. Trả Project, huỷ / lỗi -> null.
   Dùng ở ô chọn dự án của Danh sách sản phẩm (ProjPanel) và khối Ghi danh vào dự án của Nhập dữ liệu. */
export async function askCreateProject() {
  const r = await qsAsk({
    title: 'Tạo dự án mới', ok: 'Lưu dự án', required: false,   // chỉ Tên bắt buộc, kiểm ngay dưới
    fields: [
      { key: 'ten', label: 'Tên dự án *', placeholder: 'VD: Nhà phố anh Thành' },
      { key: 'khachHang', label: 'Khách hàng' },
      { key: 'sdt', label: 'Số điện thoại' },
      { key: 'diaChi', label: 'Địa chỉ' },
      { key: 'linkDezon', label: 'Link dự án trên Dezon (tuỳ chọn)', placeholder: 'https://dezon.vn/…' },
      { key: 'vat', label: 'VAT (%)', type: 'number', value: '0' },
    ],
  })
  if (!r) return null
  const ten = String(r.ten || '').trim()
  if (!ten) { toast('Nhập tên dự án'); return null }
  try {
    const link = String(r.linkDezon || '').trim()
    const p = await createProject({ ten, khachHang: r.khachHang || '', sdt: r.sdt || '', diaChi: r.diaChi || '',
      linkDezon: link ? dezonUrl_(link) : '', vat: Number(r.vat) || 0 })
    toast('Đã tạo bản nháp')
    return p
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return null }
}

/* Trang "Nhập dự án" (Danh sách dự án): đủ trường như trang chi tiết -> dự án vừa nhập, null nếu lỗi / thiếu tên.
   Khác "Tạo dự án" của Bảng điều khiển: chỉ thêm vào danh sách, KHÔNG mở thành dự án đang làm (cur giữ nguyên).
   opts.open (nút "Tạo BOQ từ Dezon Pro"): tạo như Bảng điều khiển - mở luôn thành dự án đang làm */
const formFields_ = f => {
  const t = k => String(f[k] || '').trim()
  const link = t('linkDezon')
  return {
    ten: t('ten'), kienTrucSu: t('kienTrucSu'), studio: t('studio'),
    nhomThietKe: t('nhomThietKe'), nhiepAnhGia: t('nhiepAnhGia'), nhaThauThiCong: t('nhaThauThiCong'), namHoanThien: t('namHoanThien'),
    khachHang: t('khachHang'), sdt: t('sdt'), diaChi: t('diaChi'), linkDezon: link ? dezonUrl_(link) : '',
    phanKhuc: t('phanKhuc'), quyMo: t('quyMo'), tongDT: t('tongDT'), dtBaoGia: t('dtBaoGia'), maBaoGia: t('maBaoGia'),
    trangThai: t('trangThai'), tienDo: Number(f.tienDo) || 0, vat: Number(f.vat) || 0,
    nhuCau: t('nhuCau'), hienTrang: t('hienTrang'), ghiChu: t('ghiChu'),
  }
}
export async function importProjectForm(f, opts) {
  const d = formFields_(f)
  if (!d.ten) { toast('Nhập tên dự án'); return null }
  try {
    let p
    if (opts && opts.open) p = await createProject(d)
    else { p = await api.createProject(d); await reloadProjects() }
    toast((opts && opts.open ? 'Đã tạo dự án "' : 'Đã nhập dự án "') + d.ten + '"')
    return p
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return null }
}

/* Đính file BOQ (PDF / Excel) vào dữ liệu 'boqFiles' của dự án vừa tạo (cùng dạng tab BOQ của trang chi tiết) */
export async function attachBoqFiles(maDA, files) {
  const added = []
  for (const x of files) {
    try { const r = await uploadRaw(x); if (r && r.url) added.push({ url: r.url, name: x.name, at: new Date().toISOString() }) } catch (e) { toast('Tải "' + x.name + '" lỗi: ' + errMsg(e)) }
  }
  if (!added.length) return
  try { await api.setProjData(maDA, 'boqFiles', added); toast('Đã đính ' + added.length + ' file BOQ') } catch (e) { if (!isAuth(e)) toast('Lỗi lưu file BOQ: ' + errMsg(e)) }
}

/* Trang chi tiết "Sửa thông tin" (migration 0037): người duyệt lưu thẳng, người khác gửi yêu cầu chờ duyệt.
   -> kết quả của máy chủ ({applied, project} | {pending, id}) hoặc null nếu lỗi / không đổi gì */
export async function editProjectForm(p, f, lyDo) {
  const d = formFields_(f)
  if (!d.ten) { toast('Nhập tên dự án'); return null }
  try {
    const r = await api.requestProjectEdit(p.maDA, d, lyDo)
    if (r && r.applied) { await reloadProjects(); toast('Đã lưu thông tin dự án') }
    else toast('Đã gửi yêu cầu sửa - chờ Admin / người có quyền duyệt')
    return r || {}
  } catch (e) { if (!isAuth(e)) toast(errMsg(e)); return null }
}

/* Duyệt / từ chối 1 phiếu yêu cầu sửa; duyệt xong tải lại danh sách dự án để trang chi tiết hiện thông tin mới */
export async function resolveProjectEdit(id, approve, lyDo) {
  try {
    await api.resolveProjectEditRequest(id, approve, lyDo)
    if (approve) await reloadProjects()
    toast(approve ? 'Đã duyệt - thông tin dự án đã cập nhật' : 'Đã từ chối yêu cầu sửa')
    return true
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return false }
}

/* Lưu thông tin dự án -> áp cho MỌI bản nháp cùng nhóm. kienTrucSu (cột chỉ bản Go, migration 0036) chỉ gửi khi khác giá trị
   đang có, như hienTrang ở saveDraftInfo */
export async function saveProjectShared(f) {
  const shared = { ten: f.ten, khachHang: f.khachHang, sdt: f.sdt, diaChi: f.diaChi, linkDezon: String(f.linkDezon || '').trim() }
  const cu0 = getState().cur
  if (f.kienTrucSu != null && String(f.kienTrucSu).trim() !== String((cu0 && cu0.kienTrucSu) || '')) shared.kienTrucSu = String(f.kienTrucSu).trim()
  if (shared.linkDezon && !/^https?:\/\//i.test(shared.linkDezon)) shared.linkDezon = 'https://' + shared.linkDezon
  if (shared.linkDezon && !/(^|\.)dezon\.vn$/i.test(dezonHost_(shared.linkDezon))
    && !(await qsConfirm('Link này không thuộc dezon.vn:\n' + shared.linkDezon + '\n\nVẫn lưu?'))) return false
  const S = getState()
  if (!shared.linkDezon && !(S.cur && S.cur.linkDezon)) delete shared.linkDezon   // không đụng cột khi không có link
  const gr = currentGroup(S.projects, S.cur); if (!gr) return false
  try {
    for (let i = 0; i < gr.drafts.length; i++) await updateProject(gr.drafts[i].maDA, shared)
    toast('Đã lưu thông tin dự án (' + gr.drafts.length + ' bản nháp)')
    return true
  } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return false }
}

/* Lưu thông tin của riêng bản nháp đang mở. hienTrang (M8.3, cột chỉ bản Go) chỉ gửi khi khác giá trị đang có (cu = dự án
   lúc mở form): máy chủ chỉ ghi cột này khi có khoá, nên lưu bản nháp không đụng tới nó khi người dùng không sửa. */
export async function saveDraftInfo(f, cu) {
  const S = getState(); if (!S.cur) return false
  const data = {
    tenBanNhap: f.tenBanNhap, trangThai: f.trangThai, vat: Number(f.vat) || 0, maBaoGia: f.maBaoGia, quyMo: f.quyMo,
    tongDT: f.tongDT, dtBaoGia: f.dtBaoGia, nhuCau: f.nhuCau, phanKhuc: f.phanKhuc, ghiChu: f.ghiChu,
  }
  if (f.hienTrang != null && String(f.hienTrang) !== String((cu && cu.hienTrang) || '')) data.hienTrang = String(f.hienTrang)
  try { await updateProject(S.cur.maDA, data); toast('Đã lưu bản nháp'); return true } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)); return false }
}

export async function saveProgress(v) {
  const S = getState(); if (!S.cur) return
  v = Number(v) || 0
  try { await updateProject(S.cur.maDA, { tienDo: v }); toast('Đã cập nhật tiến độ ' + v + '%') } catch (e) { if (!isAuth(e)) toast('Lỗi: ' + errMsg(e)) }
}

/* Nhóm bản nháp chứa maDA + vị trí của nó (đặt tên "Bản nháp N") */
export function draftIndexOf_(projects, maDA) {
  const gr = projectGroups(projects).filter(g => g.drafts.some(d => d.maDA === maDA))[0]
  return gr ? gr.drafts.findIndex(d => d.maDA === maDA) : 0
}
