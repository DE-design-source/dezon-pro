/* Thông số theo ngành (UMD PUB/vs-spec.js, son-spec.js, ct-spec.js + dl-spec.js của ngành Điện lạnh) do máy chủ Go phục vụ tĩnh (D6).
   Nạp 1 lần bằng <script> (UMD gán window.VS_SPEC / SON_SPEC / CT_SPEC / DL_SPEC khi không có module).
   loadSpecs() -> Promise<{VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC}>; lỗi -> reject (UI hiện "Không tải được thông số ngành").
   Lỗi thì lần gọi sau thử lại. */
import { API_BASE, QsNotConfiguredError } from './http'

const FILES = [['vs-spec.js', 'VS_SPEC'], ['son-spec.js', 'SON_SPEC'], ['ct-spec.js', 'CT_SPEC'], ['dl-spec.js', 'DL_SPEC']]
let pending = null

function loadOne(file, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName])
  return new Promise((resolve, reject) => {
    const src = API_BASE + '/' + file
    let s = document.querySelector('script[data-qs-spec="' + file + '"]')
    if (s && s.dataset.failed) { s.remove(); s = null }
    if (!s) {
      s = document.createElement('script')
      s.src = src
      s.async = true
      s.dataset.qsSpec = file
      document.head.appendChild(s)
    }
    // thẻ đã nạp xong từ lần trước: 'load' không phát lại -> trả kết quả ngay, không treo
    if (s.dataset.loaded) {
      if (window[globalName]) resolve(window[globalName])
      else { s.dataset.failed = '1'; reject(new Error('Không tải được thông số ngành (' + file + ')')) }
      return
    }
    s.addEventListener('load', () => {
      s.dataset.loaded = '1'
      if (window[globalName]) resolve(window[globalName])
      else { s.dataset.failed = '1'; reject(new Error('Không tải được thông số ngành (' + file + ')')) }
    })
    s.addEventListener('error', () => { s.dataset.failed = '1'; reject(new Error('Không tải được thông số ngành (' + file + ')')) })
  })
}

export function loadSpecs() {
  if (!API_BASE) return Promise.reject(new QsNotConfiguredError())
  if (!pending) {
    pending = Promise.all(FILES.map(([f, g]) => loadOne(f, g)))
      .then(([VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC]) => ({ VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC }))
      .catch(e => { pending = null; throw e })
  }
  return pending
}

/* Đã nạp xong chưa (đồng bộ, cho render): null nếu chưa */
export function specsNow() {
  const { VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC } = window
  return VS_SPEC && SON_SPEC && CT_SPEC && DL_SPEC ? { VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC } : null
}
