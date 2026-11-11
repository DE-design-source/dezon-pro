/* Xử lý tệp đính kèm phía trình duyệt cho Dezon Chat: phân loại, băm sha256, nén ảnh, poster video, dạng sóng tin thoại.
   Giới hạn / danh sách MIME lấy từ GET /chat/media/config (cfg), không viết cứng ở đây. */

/* Gửi tệp cần crypto.subtle (băm sha256) - chỉ có trên HTTPS / localhost. */
export function mediaSupported() {
  return !!(globalThis.crypto && globalThis.crypto.subtle)
}

/* Ghi âm tin thoại: thêm MediaRecorder + micro (chỉ dùng để ẩn / hiện nút micro) */
export function voiceSupported() {
  return mediaSupported() && typeof window !== 'undefined' && 'MediaRecorder' in window &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
}

/* 'image/jpeg; charset=x' -> 'image/jpeg' */
export function baseMime(m) {
  return String(m || '').split(';')[0].trim().toLowerCase()
}

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

export function extOf(name) {
  const n = String(name || '').toLowerCase().replace(/[.\s]+$/, '')
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i + 1) : ''
}

/* MIME của tệp: file.type, trống thì đoán theo đuôi (một số hệ điều hành không báo kiểu .mov / .webp) */
export function mimeOf(file) {
  const t = baseMime(file && file.type)
  if (t) return t
  return EXT_MIME[extOf(file && file.name)] || 'application/octet-stream'
}

/* Loại gửi của tệp người dùng chọn: 'image' | 'video' | 'file' (tin thoại đi đường ghi âm riêng).
   Ảnh / video ngoài danh sách cfg.mimes (HEIC, SVG, .avi...) gửi dạng tệp. */
export function kindOf(file, cfg) {
  const m = mimeOf(file)
  const mimes = (cfg && cfg.mimes) || {}
  if ((mimes.image || []).includes(m)) return 'image'
  if ((mimes.video || []).includes(m)) return 'video'
  return 'file'
}

/* Đuôi tệp bị chặn (cfg.denied_ext, dạng '.exe' hoặc 'exe') */
export function deniedExt(name, cfg) {
  const e = extOf(name)
  if (!e) return false
  return ((cfg && cfg.denied_ext) || []).some(d => String(d).toLowerCase().replace(/^\./, '') === e)
}

/* Lỗi chặn trước khi gửi ('' = được gửi): đuôi bị chặn, quá dung lượng theo cfg.max_bytes */
export function checkFile(file, kind, cfg) {
  if (!file) return 'Không có tệp'
  if (kind === 'file' && deniedExt(file.name, cfg)) return 'Không gửi được loại tệp này'
  const max = cfg && cfg.max_bytes && cfg.max_bytes[kind]
  if (max > 0 && file.size > max) return 'Tệp quá lớn (tối đa ' + formatBytes(max) + ')'
  if (!(file.size > 0)) return 'Tệp rỗng'
  return ''
}

/* sha256 dạng hex thường của blob */
export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer()
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf))
  let s = ''
  for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0')
  return s
}

/* ---- Ảnh ---- */
const MAX_EDGE = 2048
const PNG_KEEP_BYTES = 1024 * 1024

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function canvasBlob(c, type, quality) {
  if (typeof c.convertToBlob === 'function') return c.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality))
}

async function bitmapOf(src) {
  try {
    return await createImageBitmap(src, { imageOrientation: 'from-image' })
  } catch (e) {
    return createImageBitmap(src)
  }
}

/* Đổi tên tệp sang đuôi .jpg (ảnh đã nén lại) */
function jpgName(name) {
  const n = String(name || 'anh')
  const i = n.lastIndexOf('.')
  return (i > 0 ? n.slice(0, i) : n) + '.jpg'
}

/* Nén ảnh trước khi gửi -> {blob, mime, width, height, name}.
   - original: gửi nguyên tệp (giữ cả EXIF).
   - GIF, PNG <= 1 MB và <= 2048 px: giữ nguyên.
   - Còn lại: xoay theo EXIF, cạnh dài tối đa 2048 px, JPEG q0.85 (mã hoá lại nên bỏ EXIF, kể cả vị trí GPS).
   Trình duyệt không đọc được ảnh -> trả tệp gốc, không có kích thước. */
export async function compressImage(file, { original } = {}) {
  const mime = mimeOf(file)
  const keep = (w, h) => ({ blob: file, mime, width: w, height: h, name: file.name })
  if (typeof createImageBitmap !== 'function') return keep()
  let bmp
  try {
    bmp = await bitmapOf(file)
  } catch (e) {
    return keep()
  }
  try {
    const w = bmp.width
    const h = bmp.height
    const long = Math.max(w, h)
    if (original || mime === 'image/gif') return keep(w, h)
    if (mime === 'image/png' && file.size <= PNG_KEEP_BYTES && long <= MAX_EDGE) return keep(w, h)
    const scale = long > MAX_EDGE ? MAX_EDGE / long : 1
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const c = makeCanvas(tw, th)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff' // ảnh trong suốt sang JPEG: nền trắng thay vì đen
    ctx.fillRect(0, 0, tw, th)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, tw, th)
    const blob = await canvasBlob(c, 'image/jpeg', 0.85)
    if (!blob || !blob.size) return keep(w, h)
    return { blob, mime: 'image/jpeg', width: tw, height: th, name: jpgName(file.name) }
  } catch (e) {
    return keep()
  } finally {
    if (bmp && bmp.close) bmp.close()
  }
}

/* ---- Video ---- */
const POSTER_EDGE = 640
const POSTER_MAX = 512 * 1024

function once(el, ok, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { off(); reject(new Error('timeout')) }, ms)
    const onOk = () => { off(); resolve() }
    const onErr = () => { off(); reject(new Error('media')) }
    const off = () => { clearTimeout(t); el.removeEventListener(ok, onOk); el.removeEventListener('error', onErr) }
    el.addEventListener(ok, onOk)
    el.addEventListener('error', onErr)
  })
}

/* Khung hình đại diện của video -> {poster: Blob JPEG <= 640 px, < 512 KB, width, height, duration_ms}; {} khi trình duyệt
   không giải mã được (vd HEVC .mov trên Chrome) - video vẫn gửi được, chỉ không có poster. width/height là của video. */
export async function videoPoster(file) {
  if (typeof document === 'undefined') return {}
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  try {
    const loaded = once(v, 'loadeddata', 10000)
    v.src = url
    await loaded
    const w = v.videoWidth
    const h = v.videoHeight
    const dur = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0
    if (!(w > 0 && h > 0)) return {}
    const at = Math.min(1, (v.duration || 0) / 2)
    if (at > 0) {
      const seeked = once(v, 'seeked', 5000)
      v.currentTime = at
      await seeked
    }
    const long = Math.max(w, h)
    const scale = long > POSTER_EDGE ? POSTER_EDGE / long : 1
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const c = document.createElement('canvas')
    c.width = tw
    c.height = th
    c.getContext('2d').drawImage(v, 0, 0, tw, th)
    let poster = null
    for (const q of [0.8, 0.65, 0.5, 0.35]) {
      poster = await canvasBlob(c, 'image/jpeg', q)
      if (poster && poster.size <= POSTER_MAX) break
    }
    const out = { width: w, height: h }
    if (dur > 0) out.duration_ms = dur
    if (poster && poster.size > 0 && poster.size <= POSTER_MAX) out.poster = poster
    return out
  } catch (e) {
    return {}
  } finally {
    v.removeAttribute('src')
    try { v.load() } catch (e) { /* bỏ qua */ }
    URL.revokeObjectURL(url)
  }
}

/* ---- Tin thoại ---- */
const VOICE_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/aac', 'audio/mpeg']

/* Định dạng ghi âm trình duyệt hỗ trợ ('' = để MediaRecorder tự chọn). Gửi lên máy chủ dùng baseMime(...) của nó. */
export function pickVoiceMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  for (const m of VOICE_MIMES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch (e) { /* bỏ qua */ }
  }
  return ''
}

/* Dạng sóng của bản ghi: n giá trị 0..255 (đỉnh biên độ từng đoạn, chuẩn hoá theo đỉnh lớn nhất).
   Không giải mã được -> n số 0 (máy chủ vẫn nhận). */
export async function voiceWaveform(blob, n = 64) {
  const count = Math.max(1, Math.min(128, Math.floor(n) || 64))
  const flat = () => new Array(count).fill(0)
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC || !blob) return flat()
  let ctx
  try {
    ctx = new AC()
    const buf = await blob.arrayBuffer()
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject)
      if (p && typeof p.then === 'function') p.then(resolve, reject)
    })
    const data = audio.getChannelData(0)
    if (!data || !data.length) return flat()
    const step = data.length / count
    const peaks = new Array(count)
    let max = 0
    for (let i = 0; i < count; i++) {
      const a = Math.floor(i * step)
      const b = Math.max(a + 1, Math.floor((i + 1) * step))
      let p = 0
      for (let k = a; k < b && k < data.length; k++) {
        const x = Math.abs(data[k])
        if (x > p) p = x
      }
      peaks[i] = p
      if (p > max) max = p
    }
    if (!(max > 0)) return flat()
    return peaks.map(p => Math.max(0, Math.min(255, Math.round((p / max) * 255))))
  } catch (e) {
    return flat()
  } finally {
    if (ctx && typeof ctx.close === 'function') ctx.close().catch(() => {})
  }
}

/* ---- Hiển thị ---- */
/* 1536 -> '1,5 KB' */
export function formatBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return ''
  if (v < 1024) return v + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  const s = x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10)
  return s.replace('.', ',') + ' ' + units[i]
}

/* mili giây -> 'm:ss' (giờ: 'h:mm:ss'), làm tròn lên giây như xem trước '[Tin nhắn thoại] m:ss' của máy chủ */
export function formatDuration(ms) {
  const v = Number(ms)
  if (!Number.isFinite(v) || v <= 0) return '0:00'
  const t = Math.ceil(v / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss
}
