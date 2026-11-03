import { useEffect, useRef, useState } from 'react'
import { pickVoiceMime } from '../state/chatMedia'
import { mmss } from './MediaBubble'

const MIN_MS = 1000
const MAX_MS = 5 * 60000

/* Ghi tin nhắn thoại: MediaRecorder + đồng hồ + thanh mức âm (AnalyserNode).
   Tự dừng khi đủ maxMs (tối đa 5 phút); bản ghi dưới 1 giây bị bỏ.
   onSend(blob, {duration_ms, mime}); onCancel(lý do?) */
export default function VoiceRecorder({ maxMs = MAX_MS, onSend, onCancel }) {
  const limit = Math.min(MAX_MS, Math.max(MIN_MS, Number(maxMs) || MAX_MS))
  const [state, setState] = useState('starting') // starting | recording | stopped | error
  const [elapsed, setElapsed] = useState(0)
  const [err, setErr] = useState('')
  const levelRef = useRef(null)
  const r = useRef({ rec: null, stream: null, ctx: null, raf: 0, timer: 0, chunks: [], t0: 0, dur: 0, mime: '', after: null, blob: null })

  function cleanup() {
    const x = r.current
    if (x.raf) cancelAnimationFrame(x.raf)
    if (x.timer) clearInterval(x.timer)
    x.raf = 0
    x.timer = 0
    if (x.stream) x.stream.getTracks().forEach(t => t.stop())
    x.stream = null
    if (x.ctx) x.ctx.close().catch(() => {})
    x.ctx = null
  }

  /* Dừng ghi; after(blob) chạy khi MediaRecorder trả xong dữ liệu. Tự dừng ở giới hạn (không có after) không xoá after
     của nút gửi đang chờ; gọi lại lúc đang chờ onstop chỉ đổi after. */
  function stop(after) {
    const x = r.current
    if (after) x.after = after
    if (x.timer) { clearInterval(x.timer); x.timer = 0 }
    if (x.rec && x.rec.state !== 'inactive') {
      x.dur = performance.now() - x.t0
      x.stopping = true
      x.rec.stop()
    } else if (after && !x.stopping) {
      x.after = null
      after(x.blob)
    }
  }

  useEffect(() => {
    let dead = false
    const x = r.current
    async function start() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Trình duyệt không hỗ trợ ghi âm')
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (dead) { stream.getTracks().forEach(t => t.stop()); return }
        x.stream = stream
        const mime = pickVoiceMime() || ''
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
        x.rec = rec
        x.mime = rec.mimeType || mime
        x.chunks = []
        rec.ondataavailable = e => { if (e.data && e.data.size) x.chunks.push(e.data) }
        rec.onstop = () => {
          x.stopping = false
          x.blob = new Blob(x.chunks, { type: x.mime || 'audio/webm' })
          cleanup()
          if (!dead) setState('stopped')
          const fn = x.after
          x.after = null
          if (fn) fn(x.blob)
        }
        /* Thanh mức âm: cập nhật thẳng style, không render lại component */
        try {
          const AC = window.AudioContext || window.webkitAudioContext
          if (AC) {
            const ctx = new AC()
            x.ctx = ctx
            const an = ctx.createAnalyser()
            an.fftSize = 512
            ctx.createMediaStreamSource(stream).connect(an)
            const buf = new Uint8Array(an.fftSize)
            const tick = () => {
              an.getByteTimeDomainData(buf)
              let sum = 0
              for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
              const lv = Math.min(1, Math.sqrt(sum / buf.length) * 3)
              if (levelRef.current) levelRef.current.style.transform = `scaleX(${0.04 + lv * 0.96})`
              x.raf = requestAnimationFrame(tick)
            }
            x.raf = requestAnimationFrame(tick)
          }
        } catch {
          /* không có thanh mức âm vẫn ghi được */
        }
        rec.start(250)
        x.t0 = performance.now()
        setState('recording')
        x.timer = setInterval(() => {
          const ms = performance.now() - x.t0
          setElapsed(ms)
          if (ms >= limit) stop()
        }, 200)
      } catch (e) {
        cleanup()
        if (dead) return
        setErr(e && e.name === 'NotAllowedError' ? 'Chưa cho phép dùng micro' : (e && e.message) || 'Không dùng được micro')
        setState('error')
      }
    }
    start()
    return () => {
      dead = true
      x.after = null
      if (x.rec && x.rec.state !== 'inactive') { try { x.rec.stop() } catch { /* đã dừng */ } }
      cleanup()
    }
  }, [limit])

  function send() {
    stop(blob => {
      const dur = Math.min(limit, Math.round(r.current.dur))
      if (!blob || !blob.size || dur < MIN_MS) { onCancel('Tin thoại quá ngắn (dưới 1 giây)'); return }
      onSend(blob, { duration_ms: dur, mime: String(blob.type || r.current.mime || 'audio/webm').split(';')[0] })
    })
  }

  function cancel() { stop(() => onCancel()) }

  if (state === 'error') {
    return (
      <div className="ch-voice-rec error">
        <span className="ch-voice-rec-err">{err}</span>
        <button type="button" className="ch-voice-rec-btn" onClick={() => onCancel()}>Đóng</button>
      </div>
    )
  }
  const shown = state === 'stopped' ? Math.min(limit, r.current.dur) : elapsed
  return (
    <div className="ch-voice-rec">
      <button type="button" className="ch-voice-rec-btn cancel" title="Huỷ ghi âm" onClick={cancel}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
      </button>
      <span className={'ch-voice-rec-dot' + (state === 'recording' ? ' on' : '')} />
      <span className="ch-voice-rec-time">{mmss(shown)} / {mmss(limit)}</span>
      <span className="ch-voice-rec-meter"><span ref={levelRef} /></span>
      {state === 'stopped' && <span className="ch-voice-rec-note">Đã dừng ghi</span>}
      <button type="button" className="ch-send-btn" title="Gửi tin thoại" disabled={state === 'starting'} onClick={send}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
      </button>
    </div>
  )
}
