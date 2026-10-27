/* Tải file / tải lên / đường dẫn ảnh cho trang QS — các route ngoài /api/v1 của máy chủ Go (rest.go:97-107).
   Các route gốc (/export/*, /upload/file) trả 401 KHÔNG có code NOAUTH -> coi như hết phiên. */
import { API_BASE, authHeaders, noAuth, QsApiError, QsUnreachableError, QsAbortError, QsNotConfiguredError, isAbort } from './http'

function needBase() { if (!API_BASE) throw new QsNotConfiguredError() }

function saveBlob(blob, name) {
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u; a.download = name || 'file'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 4000)
}

function nameFromDisposition(h) {
  if (!h) return ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(h) || /filename="?([^";]+)"?/i.exec(h)
  if (!m) return ''
  try { return decodeURIComponent(m[1]) } catch (e) { return m[1] }
}

/* Port taiFile_ (PUB/app.js:48-54): POST JSON rồi lưu file với tên do NGƯỜI GỌI đặt.
   Content-Disposition chỉ dùng khi không có tên (/export/bang luôn trả "bang.xlsx").
   Trả {rowCount} (X-Row-Count, chỉ có ở /export/san-pham và /export/cong-tac). */
export async function downloadPost(path, body, fileName, signal) {
  needBase()
  let r
  try {
    r = await fetch(API_BASE + path, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body || {}), signal })
  } catch (e) {
    if (isAbort(e)) throw new QsAbortError()
    throw new QsUnreachableError()
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    if (r.status === 401) throw noAuth()
    // /export/cong-tac: bản gốc báo 'Lỗi <status>' (PUB/sanpham.js:1312)
    if (path === '/export/cong-tac') throw new QsApiError('Lỗi ' + r.status, r.status)
    throw new QsApiError(e.error || ('HTTP ' + r.status), r.status)
  }
  const blob = await r.blob()
  saveBlob(blob, fileName || nameFromDisposition(r.headers.get('Content-Disposition')) || 'file.xlsx')
  const rc = r.headers.get('X-Row-Count')
  return { rowCount: rc == null ? null : Number(rc) }
}

/* Port dl() (PUB/baogia.js:926-927): exportBaoGia trả {name, mimeType, base64} */
export function saveBase64(res) {
  if (!res || !res.base64) throw new QsApiError('File xuất rỗng', 0)
  const b = atob(res.base64)
  const a = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i)
  saveBlob(new Blob([a], { type: res.mimeType || 'application/octet-stream' }), res.name)
}

export const DOC_MAX_MB = 50

/* Port upDoc_ (PUB/nhap.js:232-239): gửi NGUYÊN file nhị phân tới /upload/file?name= */
export async function uploadRaw(file, signal) {
  needBase()
  if (file.size > DOC_MAX_MB * 1024 * 1024)
    throw new QsApiError('"' + file.name + '" nặng ' + (file.size / 1048576).toFixed(1) + 'MB — quá giới hạn ' + DOC_MAX_MB + 'MB, hãy dán link', 413)
  const h = authHeaders(false)
  h['Content-Type'] = file.type || 'application/octet-stream'
  let r
  try {
    r = await fetch(API_BASE + '/upload/file?name=' + encodeURIComponent(file.name), { method: 'POST', headers: h, body: file, signal })
  } catch (e) {
    if (isAbort(e)) throw new QsAbortError()
    throw new QsUnreachableError()
  }
  const d = await r.json().catch(() => ({}))
  if (r.status === 401) throw noAuth()
  if (!r.ok || d.error) throw new QsApiError(d.error || ('HTTP ' + r.status + ' (' + (file.size / 1048576).toFixed(1) + 'MB)'), r.status)
  return d
}

/* Port imgUrlOf (PUB/nhap.js:285-292) nhưng trả URL TUYỆT ĐỐI tới máy chủ Go */
export function mediaUrl(v) {
  v = String(v || '').trim()
  if (!v) return ''
  if (/^(data:|blob:)/i.test(v)) return v
  if (v.indexOf('http') === 0) return v
  // đường dẫn trên máy chủ (kho /files/...) -> nối API_BASE, không coi là mã ảnh Lark
  if (v.charAt(0) === '/' && v.charAt(1) !== '/') return API_BASE + v
  return API_BASE + '/media?token=' + encodeURIComponent(v)
}

/* Logo mặc định của bản gốc (PUB/app.js:2510) */
export const logoUrl = () => API_BASE + '/logo.svg'

/* File mẫu nhập (route công khai, tải bằng <a href>) */
const TEMPLATES = {
  vs: '/mau-nhap-thiet-bi-ve-sinh.xlsx',
  ct: '/mau-nhap-cong-tac-o-cam.xlsx',
  son: '/mau-nhap-son-nuoc.xlsx',
  sp: '/mau-nhap-hang-loat.xlsx',
}
export function templateUrl(name, hm) {
  const p = TEMPLATES[name] || (String(name || '').charAt(0) === '/' ? name : '/' + name)
  return API_BASE + p + (hm ? '?hm=' + encodeURIComponent(hm) : '')
}
