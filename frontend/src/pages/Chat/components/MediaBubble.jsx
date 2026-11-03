import { useEffect, useRef, useState } from 'react'
import { mediaGet } from '../api/chatApi'
import { decodeBlurhash } from '../state/blurhash'
import { formatBytes } from '../state/chatMedia'
import { cancelUpload, refreshMedia } from '../state/chatStore'
import { FileIcon } from './shared'

/* Bubble ảnh / video / tệp / tin thoại (giai đoạn 2, CHAT.md mục 12).
   Ảnh và video luôn có khung cố định (tối đa 280x320) để cuộn không giật khi ảnh tải xong. */

const BOX_W = 280
const BOX_H = 320

export function boxSize(w, h) {
  if (!w || !h) return { width: 240, height: 180 }
  const s = Math.min(BOX_W / w, BOX_H / h, 1)
  return { width: Math.max(80, Math.round(w * s)), height: Math.max(60, Math.round(h * s)) }
}

/* m:ss, làm tròn lên như phần xem trước của máy chủ */
export function mmss(ms) {
  const t = Math.max(0, Math.ceil((Number(ms) || 0) / 1000))
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')
}

const expired = md => !!(md && md.expires_at && Date.parse(md.expires_at) - Date.now() < 5000)

/* Xin link mới trước khi link ký hết hạn: lúc còn 20% thời gian (tối đa 5 phút, tối thiểu 5 giây) nên hạn ngắn không gọi
   lại ngay khi vừa hiện. el: phần tử cần theo dõi — chỉ hẹn giờ khi nó đang (gần) hiện trên màn hình, để mở hội thoại dài
   không bắn N yêu cầu cùng lúc; bỏ el (undefined, vd Lightbox) = luôn theo dõi. Phần tử khuất dựa vào onError. */
export function useFreshMedia(md, el) {
  const id = md && md.id
  const exp = md && md.expires_at
  const always = el === undefined
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (always || !el) return undefined
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined }
    const io = new IntersectionObserver(es => setSeen(es.some(e => e.isIntersecting)), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [el, always])
  const on = always || seen
  useEffect(() => {
    if (!id || !exp || !on) return undefined
    const total = Date.parse(exp) - Date.now()
    const left = total - Math.min(5 * 60000, Math.max(5000, total * 0.2))
    if (left <= 0) { refreshMedia(id); return undefined }
    const t = setTimeout(() => refreshMedia(id), Math.min(left, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [id, exp, on])
}

/* src của <video> / <audio>: link mới (sau refresh) chỉ thay khi phần tử đang dừng / lỗi — đổi src lúc đang phát sẽ nạp lại
   và dừng phát. Thay xong thì quay lại đúng vị trí đang nghe / xem. key: đổi tệp (vd chuyển ảnh trong Lightbox) -> dùng ngay. */
export function useHeldSrc(url, ref, key) {
  const [held, setHeld] = useState({ key, src: url })
  const cur = held.key === key ? held.src : url
  useEffect(() => {
    if (held.key !== key) { setHeld({ key, src: url }); return undefined }
    if (url === held.src) return undefined
    const el = ref.current
    const swap = () => {
      const t = el && !el.error && !el.ended ? el.currentTime : 0
      setHeld({ key, src: url })
      if (el && t > 0) el.addEventListener('loadedmetadata', () => { try { el.currentTime = t } catch { /* bỏ qua */ } }, { once: true })
    }
    if (!el || el.paused || el.ended || el.error) { swap(); return undefined }
    el.addEventListener('pause', swap, { once: true })
    return () => el.removeEventListener('pause', swap)
  }, [url, key, held, ref])
  return cur
}

/* Lỗi tải ảnh / video: link hết hạn thì xin link mới, còn hạn thì báo hỏng (không lặp vô hạn) */
function onMediaError(md, setBroken) {
  if (expired(md)) refreshMedia(md.id)
  else setBroken(true)
}

/* Tải tệp về: xin link "attachment" (đúng tên tệp của tin nhắn) rồi mở link đó */
export async function downloadMedia(md, messageId) {
  const r = await mediaGet(md.id, { download: true, messageId })
  const got = r && r.media ? r.media : r
  if (!got || !got.url) throw new Error('Không tải được tệp')
  const a = document.createElement('a')
  a.href = got.url
  a.rel = 'noopener'
  if (got.file_name || md.file_name) a.download = got.file_name || md.file_name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/* Ảnh mờ dựng từ blurhash, nằm dưới ảnh thật cho tới khi ảnh tải xong */
export function BlurCanvas({ hash }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!hash || !cv) return
    try {
      const px = decodeBlurhash(hash, 32, 32)
      if (!px) return
      const ctx = cv.getContext('2d')
      const img = ctx.createImageData(32, 32)
      img.data.set(px)
      ctx.putImageData(img, 0, 0)
    } catch {
      /* blurhash hỏng: để nền xám */
    }
  }, [hash])
  return <canvas ref={ref} width={32} height={32} className="ch-media-blur" aria-hidden="true" />
}

/* Vòng tiến độ tải lên (progress 0..1; nếu store gửi 0..100 cũng hiểu) */
export function ProgressRing({ progress, size = 44 }) {
  let p = Number(progress) || 0
  if (p > 1) p = p / 100
  p = Math.min(1, Math.max(0, p))
  const r = size / 2 - 3
  const c = 2 * Math.PI * r
  return (
    <svg className="ch-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="ch-ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ch-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

const PHASE_TEXT = { prepare: 'Đang chuẩn bị…', url: 'Đang tải lên…', put: 'Đang tải lên', complete: 'Đang xử lý…', done: 'Đang gửi…' }

function phaseLabel(p, up) {
  if (p.status === 'failed') return 'Chưa gửi được'
  if (p.status === 'sending') return 'Đang gửi…'
  const ph = (up && up.phase) || p.phase || 'prepare'
  if (ph === 'put') {
    let v = Number(up && up.progress) || 0
    if (v <= 1) v *= 100
    return 'Đang tải lên ' + Math.round(v) + '%'
  }
  return PHASE_TEXT[ph] || 'Đang tải lên…'
}

function CloseIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
}

function PlayIcon({ playing }) {
  return playing
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
}

/* Sóng âm của tin thoại: phần đã nghe tô đậm */
function Waveform({ data, ratio }) {
  const bars = data && data.length ? data : Array.from({ length: 32 }, () => 40)
  const n = bars.length
  const W = 140
  const H = 26
  const step = W / n
  const bw = Math.max(1.2, step * 0.6)
  return (
    <svg className="ch-voice-wave" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {bars.map((v, i) => {
        const h = Math.max(2, (Math.min(255, Math.max(0, v)) / 255) * H)
        return <rect key={i} x={i * step} y={(H - h) / 2} width={bw} height={h} rx={bw / 2} className={i / n < ratio ? 'on' : ''} />
      })}
    </svg>
  )
}

function VoicePlayer({ md }) {
  const ref = useRef(null)
  const [box, setBox] = useState(null)
  useFreshMedia(md, box)
  const src = useHeldSrc(md.url, ref, md.id)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [broken, setBroken] = useState(false)
  const dur = Number(md.duration_ms) || 0
  function toggle() {
    const a = ref.current
    if (!a) return
    if (a.paused) a.play().catch(() => onMediaError(md, setBroken))
    else a.pause()
  }
  const ratio = dur ? Math.min(1, (pos * 1000) / dur) : 0
  return (
    <div className="ch-voice" ref={setBox}>
      <button type="button" className="ch-voice-play" title={playing ? 'Tạm dừng' : 'Nghe'} disabled={broken || !md.url} onClick={toggle}><PlayIcon playing={playing} /></button>
      <Waveform data={md.waveform} ratio={ratio} />
      <span className="ch-voice-time">{broken ? 'Không phát được' : mmss(playing || pos ? pos * 1000 : dur)}</span>
      {md.url && (
        <audio
          ref={ref}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setPos(0) }}
          onTimeUpdate={e => setPos(e.currentTarget.currentTime)}
          onError={() => onMediaError(md, setBroken)}
        />
      )}
    </div>
  )
}

function FileChip({ md, name, messageId, sub }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function open() {
    if (busy || !md) return
    setBusy(true)
    setErr('')
    try {
      await downloadMedia(md, messageId)
    } catch (e) {
      setErr((e && e.message) || 'Không tải được tệp')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className="ch-file-chip ch-file-btn" title={md ? 'Tải về' : undefined} onClick={open} disabled={!md}>
      <span className="ch-f-icon"><FileIcon size={15} /></span>
      <span className="ch-f-body">
        <span className="ch-f-name">{name || 'Tệp'}</span>
        <span className="ch-f-size">{err || sub || (md ? formatBytes(md.size) : '')}{busy ? ' · Đang mở…' : ''}</span>
      </span>
    </button>
  )
}

function ImageBox({ md, onOpen }) {
  const [box, setBox] = useState(null)
  useFreshMedia(md, box)
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const src = md.thumb_url || md.url
  useEffect(() => { setBroken(false) }, [src])
  return (
    <button type="button" ref={setBox} className="ch-media-box" style={boxSize(md.width, md.height)} onClick={onOpen} title="Xem ảnh">
      <BlurCanvas hash={md.blurhash} />
      {src && !broken && <img src={src} alt="" loading="lazy" decoding="async" className={loaded ? 'on' : ''} onLoad={() => setLoaded(true)} onError={() => onMediaError(md, setBroken)} />}
      {broken && <span className="ch-media-note">Không tải được ảnh</span>}
    </button>
  )
}

function VideoBox({ md, messageId, onOpen }) {
  const [broken, setBroken] = useState(false)
  const [box, setBox] = useState(null)
  const ref = useRef(null)
  useFreshMedia(md, box)
  const src = useHeldSrc(md.url, ref, md.id)
  useEffect(() => { setBroken(false) }, [md.url])
  if (broken) return <FileChip md={md} name={md.file_name || 'Video'} messageId={messageId} sub="Không phát được, tải về" />
  return (
    <div className="ch-media-box video" ref={setBox} style={boxSize(md.width, md.height)}>
      <BlurCanvas hash={md.blurhash} />
      {md.url && <video ref={ref} src={src} poster={md.thumb_url || undefined} preload="metadata" controls playsInline onError={() => onMediaError(md, setBroken)} />}
      {onOpen && <button type="button" className="ch-media-expand" title="Xem lớn" onClick={onOpen}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></button>}
    </div>
  )
}

/* Tin đang tải lên / chờ gửi: ảnh xem trước cục bộ, vòng tiến độ, nút huỷ */
function PendingMedia({ p, up }) {
  const md = p.media || {}
  const type = p.msg_type
  const preview = up && up.previewUrl
  const uploading = p.status === 'uploading'
  const label = phaseLabel(p, up)
  const ring = uploading && (
    <span className="ch-media-progress">
      <ProgressRing progress={up && up.progress} />
      <button type="button" className="ch-media-cancel" title="Huỷ gửi" onClick={e => { e.stopPropagation(); cancelUpload(p.client_msg_id) }}><CloseIcon /></button>
    </span>
  )
  if (type === 'image' || type === 'video') {
    return (
      <div className="ch-media-box pending" style={boxSize(md.width, md.height)}>
        {preview && type === 'image' && <img src={preview} alt="" className="on" />}
        {type === 'video' && up && up.posterUrl && <img src={up.posterUrl} alt="" className="on" />}
        {type === 'video' && !(up && up.posterUrl) && preview && <video src={preview} muted preload="metadata" playsInline />}
        {ring}
        <span className="ch-media-phase">{label}</span>
      </div>
    )
  }
  const name = type === 'voice' ? 'Tin nhắn thoại ' + mmss(md.duration_ms) : (p.file_name || 'Tệp')
  return (
    <div className="ch-file-chip ch-file-pending">
      <span className="ch-f-icon">{uploading ? <ProgressRing progress={up && up.progress} size={30} /> : <FileIcon size={15} />}</span>
      <span className="ch-f-body">
        <span className="ch-f-name">{name}</span>
        <span className="ch-f-size">{md.size ? formatBytes(md.size) + ' · ' : ''}{label}</span>
      </span>
      {uploading && <button type="button" className="ch-media-cancel small" title="Huỷ gửi" onClick={() => cancelUpload(p.client_msg_id)}><CloseIcon size={12} /></button>}
    </div>
  )
}

/* msg: tin đã có trên máy chủ (msg_type, attachments:[MediaDTO], file_name);
   pending: mục outbox chờ gửi (msg_type, media, file_name, status); upload: chat.uploads[client_msg_id] */
export default function MediaBubble({ msg, pending, upload, onOpen }) {
  const md = msg && msg.attachments && msg.attachments[0]
  if (pending) {
    const type = pending.msg_type
    const framed = type === 'file' || type === 'voice'
    return framed ? <div className="ch-bubble ch-media-frame">{<PendingMedia p={pending} up={upload} />}</div> : <PendingMedia p={pending} up={upload} />
  }
  const type = msg.msg_type
  if (!md) return <div className="ch-bubble ch-media-frame ch-media-missing">[Tệp đính kèm]</div>
  if (md.status && md.status !== 'ready') return <div className="ch-bubble ch-media-frame ch-media-missing">Tệp không còn khả dụng</div>
  if (type === 'image') return <ImageBox md={md} onOpen={onOpen} />
  if (type === 'video') return <VideoBox md={md} messageId={msg.id} onOpen={onOpen} />
  if (type === 'voice') return <div className="ch-bubble ch-media-frame"><VoicePlayer md={md} /></div>
  return <div className="ch-bubble ch-media-frame"><FileChip md={md} name={msg.file_name || md.file_name} messageId={msg.id} /></div>
}
