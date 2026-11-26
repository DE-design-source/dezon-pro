import { useCallback, useEffect, useRef, useState } from 'react'
import { fixWebmDuration } from './webmDuration'

/* Ghi âm micro thành 1 file (MediaRecorder) để máy chủ / AI nghe lại, chạy song song với nhận giọng (useDictation, không dùng chung luồng).
   Mỗi lần dùng chỉ 1 bản ghi: start() -> pause() / resume() -> stop() trả Blob (đoạn đã ghi). Đã stop thì start() không ghi nối
   (file âm thanh không nối được), discard() bỏ hẳn rồi mới ghi lại. Gần 20 MB thì tự dừng ghi, giữ phần đã ghi (notice báo).
   Rời khối (unmount) / discard: tắt micro, bỏ dữ liệu. Đoạn âm thanh giữ trong bộ nhớ, mỗi giây 1 đoạn. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
const CAP = 19500000      // byte
const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined
const SUPPORTED = !!(MR && typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)

const pickType = () => {
  if (!MR || typeof MR.isTypeSupported !== 'function') return ''
  for (const t of TYPES) { try { if (MR.isTypeSupported(t)) return t } catch { /* bỏ qua */ } }
  return ''
}
const errText = e => {
  const n = e && e.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Trình duyệt đang chặn micro nên không ghi âm được: bấm biểu tượng ổ khoá trên thanh địa chỉ, cho phép Micro rồi thử lại.'
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Không tìm thấy micro trên máy nên không ghi âm được.'
  if (n === 'NotReadableError' || n === 'AbortError') return 'Micro đang bận (ứng dụng khác đang giữ) nên không ghi âm được.'
  return 'Không ghi âm được' + (n ? ' (' + n + ')' : '') + '.'
}

export default function useAudioRecorder() {
  const [recording, setRecording] = useState(false)   // đang có bản ghi chạy (kể cả lúc tạm dừng)
  const [paused, setPaused] = useState(false)
  const [ended, setEnded] = useState(false)           // bản ghi đã kết thúc (stop, chạm giới hạn, micro bị ngắt)
  const [capped, setCapped] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [bytes, setBytes] = useState(0)
  const s = useRef({ rec: null, stream: null, chunks: [], size: 0, mime: '', starting: null, wantPause: false,
    stopping: null, resolveStop: null, blob: null, fixing: null, ended: false, capped: false, gen: 0, alive: true,
    ms: 0, runAt: 0 }).current

  // cộng thời gian ghi thật (bỏ các quãng tạm dừng) để ghi Duration vào tệp WebM
  const tick = () => {
    if (s.runAt) { s.ms += Date.now() - s.runAt; s.runAt = 0 }
  }

  const release = () => {
    const st = s.stream
    s.stream = null
    if (st) st.getTracks().forEach(t => { try { t.stop() } catch { /* bỏ qua */ } })
  }

  // MediaRecorder đã dừng (do stop(), chạm giới hạn, hoặc micro bị rút / tắt): gom Blob, tắt micro
  const onStopped = rec => {
    if (s.rec !== rec) return
    s.rec = null
    release()
    tick()
    const raw = s.chunks.length ? new Blob(s.chunks, { type: s.mime || 'audio/webm' }) : null
    s.blob = raw
    s.ended = true
    const res = s.resolveStop
    s.resolveStop = null
    s.stopping = null
    if (s.alive) {
      setRecording(false); setPaused(false); setEnded(true)
      if (!res && !s.capped) setError('Ghi âm bị ngắt giữa chừng (micro bị rút hoặc bị tắt). Phần đã ghi vẫn được giữ.')
    }
    // WebM của Chrome không có độ dài: sửa Duration trước khi trả Blob (stop() gọi trong lúc sửa thì chờ s.fixing)
    if (raw && /^audio\/webm/i.test(s.mime) && s.ms > 0) {
      const gen = s.gen
      const fixing = fixWebmDuration(raw, s.ms).then(b => {
        if (gen !== s.gen) return null
        s.blob = b
        if (s.fixing === fixing) s.fixing = null
        return b
      })
      s.fixing = fixing
      if (res) fixing.then(res)
      return
    }
    if (res) res(s.blob)
  }

  const drop = () => {
    s.gen++
    s.wantPause = false
    const rec = s.rec
    s.rec = null
    if (rec) {
      rec.ondataavailable = null; rec.onstop = null; rec.onerror = null
      try { if (rec.state !== 'inactive') rec.stop() } catch { /* bỏ qua */ }
    }
    release()
    const res = s.resolveStop
    s.resolveStop = null
    s.stopping = null
    s.chunks = []; s.size = 0; s.blob = null; s.fixing = null; s.ended = false; s.capped = false; s.ms = 0; s.runAt = 0
    if (res) res(null)
  }

  const start = useCallback(() => {
    if (!SUPPORTED) { setError('Trình duyệt này không hỗ trợ ghi âm.'); return Promise.resolve() }
    if (s.starting) { s.wantPause = false; return s.starting }
    if (s.rec) {
      if (s.rec.state === 'paused') { try { s.rec.resume(); s.runAt = Date.now() } catch { /* bỏ qua */ } setPaused(false) }
      return Promise.resolve()
    }
    if (s.ended) return Promise.resolve()
    const gen = ++s.gen
    s.wantPause = false
    setError('')
    const p = (async () => {
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      } catch (e) {
        if (gen === s.gen && s.alive) setError(errText(e))
        return
      }
      if (gen !== s.gen || !s.alive) { stream.getTracks().forEach(t => { try { t.stop() } catch { /* bỏ qua */ } }); return }
      s.stream = stream
      const type = pickType()
      let rec
      try {
        rec = new MR(stream, type ? { mimeType: type, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 })
      } catch (e) { release(); setError(errText(e)); return }
      s.chunks = []; s.size = 0; s.blob = null; s.fixing = null; s.capped = false; s.ms = 0; s.runAt = 0
      rec.ondataavailable = e => {
        if (s.rec !== rec || !e.data || !e.data.size) return
        s.chunks.push(e.data)
        s.size += e.data.size
        if (s.alive) setBytes(s.size)
        if (s.size >= CAP && !s.capped && rec.state !== 'inactive') {
          s.capped = true
          if (s.alive) {
            setCapped(true)
            setNotice('Bản ghi âm đã gần 20 MB nên đã dừng ghi âm, phần đã ghi vẫn được giữ. Chữ vẫn ghi tiếp bình thường.')
          }
          try { rec.stop() } catch { onStopped(rec) }
        }
      }
      rec.onstop = () => onStopped(rec)
      rec.onerror = ev => {
        if (s.rec !== rec || !s.alive) return
        const n = ev && ev.error && ev.error.name
        setError('Ghi âm gặp lỗi' + (n ? ' (' + n + ')' : '') + '.')
      }
      s.rec = rec
      try { rec.start(1000) } catch (e) { s.rec = null; release(); setError(errText(e)); return }
      s.runAt = Date.now()
      s.mime = rec.mimeType || type || 'audio/webm'
      setBytes(0); setCapped(false); setNotice(''); setEnded(false); setRecording(true)
      if (s.wantPause) { try { rec.pause(); tick() } catch { /* bỏ qua */ } setPaused(true) } else setPaused(false)
    })()
    s.starting = p
    p.finally(() => { if (s.starting === p) s.starting = null })
    return p
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => {
    if (s.starting) { s.wantPause = true; return }
    const rec = s.rec
    if (rec && rec.state === 'recording') { try { rec.pause(); tick() } catch { /* bỏ qua */ } setPaused(true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resume = useCallback(() => {
    if (s.starting) { s.wantPause = false; return }
    const rec = s.rec
    if (rec && rec.state === 'paused') { try { rec.resume(); s.runAt = Date.now() } catch { /* bỏ qua */ } setPaused(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // dừng hẳn, trả Blob đã ghi (null = chưa ghi được gì); gọi lại sau khi đã dừng thì trả Blob cũ
  const stop = useCallback(async () => {
    if (s.starting) { try { await s.starting } catch { /* bỏ qua */ } }
    const rec = s.rec
    if (!rec) return s.fixing || s.blob
    if (!s.stopping) {
      s.stopping = new Promise(res => {
        s.resolveStop = res
        setTimeout(() => onStopped(rec), 4000)    // trình duyệt không báo stop: vẫn trả phần đã có
        try { if (rec.state === 'inactive') onStopped(rec); else rec.stop() } catch { onStopped(rec) }
      })
    }
    return s.stopping
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const discard = useCallback(() => {
    drop()
    setRecording(false); setPaused(false); setEnded(false); setCapped(false); setBytes(0); setNotice(''); setError('')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // StrictMode gắn khối 2 lần: lần gỡ giả cũng bỏ bản ghi, lần gắn lại bật cờ sống
  useEffect(() => {
    s.alive = true
    return () => { s.alive = false; drop() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { supported: SUPPORTED, recording, paused, ended, capped, error, notice, bytes, start, pause, resume, stop, discard }
}
