/* Tải tệp thẳng lên kho đối tượng (S3 / MinIO) theo địa chỉ ký sẵn máy chủ chat cấp (POST /chat/media/upload-url).
   Không gửi Bearer token: địa chỉ đã mang chữ ký. Dùng XHR để có tiến độ (upload.onprogress). */

import { ChatApiError } from './chatApi.js'

const IDLE_MS = 60000

/* target {url, method:'PUT', headers} | {url, method:'POST', fields}; blob: File / Blob.
   onProgress(loaded, total); signal: AbortSignal để huỷ.
   Lỗi (ChatApiError.code): 403 -> UPLOAD_EXPIRED, mất mạng -> NETWORK, huỷ -> ABORTED, còn lại -> HTTP_<n> */
export function putObject(target, blob, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!target || !target.url) {
      reject(new ChatApiError('Thiếu địa chỉ tải lên', 0, 'BAD_REQUEST'))
      return
    }
    if (signal && signal.aborted) {
      reject(new ChatApiError('Đã huỷ tải lên', 0, 'ABORTED'))
      return
    }
    const method = String(target.method || 'PUT').toUpperCase()
    const xhr = new XMLHttpRequest()
    let done = false
    /* Canh treo: 60 giây không có tiến độ (kết nối nửa mở qua proxy...) -> huỷ, báo NETWORK để uploadRetry thử lại */
    let idle = 0
    const touch = () => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        finish(reject, new ChatApiError('Tải tệp lên bị treo, thử lại sau', 0, 'NETWORK'))
        try { xhr.abort() } catch (e) { /* đã xong */ }
      }, IDLE_MS)
    }
    const onAbort = () => { try { xhr.abort() } catch (e) { /* đã xong */ } }
    const finish = (fn, v) => {
      if (done) return
      done = true
      clearTimeout(idle)
      if (signal) signal.removeEventListener('abort', onAbort)
      fn(v)
    }
    xhr.open(method, target.url, true)
    let body
    if (method === 'POST') {
      const fd = new FormData()
      const fields = target.fields || {}
      for (const k of Object.keys(fields)) fd.append(k, fields[k])
      fd.append('file', blob)
      body = fd
    } else {
      const h = target.headers || {}
      // Gửi đúng các header đã ký; Content-Length do trình duyệt tự đặt theo blob
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === 'content-length' || k.toLowerCase() === 'host') continue
        xhr.setRequestHeader(k, h[k])
      }
      body = blob
    }
    if (xhr.upload) {
      xhr.upload.onprogress = ev => {
        touch()
        if (!onProgress) return
        const total = ev.lengthComputable ? ev.total : (blob && blob.size) || 0
        try { onProgress(ev.loaded, total) } catch (e) { /* lỗi của người gọi không làm hỏng tải lên */ }
      }
    }
    xhr.onload = () => {
      const st = xhr.status
      if (st >= 200 && st < 300) {
        if (onProgress) { try { onProgress(blob.size || 0, blob.size || 0) } catch (e) { /* bỏ qua */ } }
        finish(resolve, { status: st, etag: xhr.getResponseHeader('ETag') || '' })
      } else if (st === 403) {
        finish(reject, new ChatApiError('Địa chỉ tải lên đã hết hạn', 403, 'UPLOAD_EXPIRED'))
      } else if (st === 0) {
        finish(reject, new ChatApiError('Không kết nối được kho lưu trữ tệp', 0, 'NETWORK'))
      } else {
        finish(reject, new ChatApiError('Tải tệp lên lỗi (HTTP ' + st + ')', st, 'HTTP_' + st))
      }
    }
    xhr.onerror = () => finish(reject, new ChatApiError('Không kết nối được kho lưu trữ tệp', 0, 'NETWORK'))
    xhr.ontimeout = () => finish(reject, new ChatApiError('Tải tệp lên quá lâu, thử lại sau', 0, 'NETWORK'))
    xhr.onabort = () => finish(reject, new ChatApiError('Đã huỷ tải lên', 0, 'ABORTED'))
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    touch()
    try {
      xhr.send(body)
    } catch (e) {
      finish(reject, new ChatApiError('Không kết nối được kho lưu trữ tệp', 0, 'NETWORK'))
    }
  })
}
