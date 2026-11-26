import { useCallback, useEffect, useRef, useState } from 'react'

/* Ghi âm -> chữ bằng Web Speech API của trình duyệt (Chrome / Edge; tiếng Việt vi-VN).
   onFinal(text): mỗi đoạn câu đã nhận dạng xong; interim: phần đang nói dở (hiện mờ).
   Chrome tự dừng khi im lặng một lúc: đang bật thì tự nghe lại cho tới khi người dùng bấm dừng.
   Mỗi lần nghe (kể cả tự nghe lại) dùng 1 đối tượng nhận giọng MỚI: Chrome nhận start() lại trên đối tượng vừa abort()
   (vd React StrictMode gắn khối 2 lần) thì vẫn báo đang nghe, có tiếng nhưng không trả chữ nào. Sự kiện của đối tượng cũ bị bỏ qua.
   Chrome chỉ cho 1 phiên nhận giọng trên trang: bật micro ở khối này thì micro khối khác (Live, Hỏi AI, form chăm sóc)
   tự tắt hẳn, không tự nghe lại giành micro qua lại.
   stop(): dừng, câu đang nói dở vẫn được trả về (onFinal) sau đó; abort(): dừng và bỏ câu đang nói dở.
   takePending(): lấy ngay câu đang nói dở của phiên vừa stop() mà trình duyệt chưa trả (rồi phiên đó không trả câu nào nữa). */
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
let active = null    // phiên đang giữ micro

const ERR = {
  'not-allowed': 'Trình duyệt đang chặn micro: bấm biểu tượng ổ khoá trên thanh địa chỉ, cho phép Micro rồi thử lại.',
  'service-not-allowed': 'Trình duyệt chặn dịch vụ nhận giọng nói: cho phép micro rồi thử lại.',
  'audio-capture': 'Không tìm thấy micro trên máy.',
  network: 'Mất kết nối tới dịch vụ nhận giọng nói, kiểm tra mạng rồi thử lại.',
  'language-not-supported': 'Trình duyệt chưa hỗ trợ nhận giọng nói tiếng Việt.',
}

export default function useDictation(onFinal) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  // tình trạng micro từ lúc bấm nghe (để báo người dùng micro có tiếng / có nhận ra chữ không): since = mốc bấm nghe,
  // audio = micro đã mở, sound = đã nghe thấy tiếng, soundAt = lúc nghe thấy tiếng đầu tiên, text = đã nhận ra chữ
  const [heard, setHeard] = useState({ since: 0, audio: false, sound: false, soundAt: 0, text: false })
  const mark = k => setHeard(h => (h[k] ? h : { ...h, [k]: true, ...(k === 'sound' ? { soundAt: Date.now() } : null) }))
  const recRef = useRef(null)
  const stoppedRef = useRef(null)    // phiên vừa stop(), còn chờ câu cuối
  const wantRef = useRef(false)      // người dùng còn muốn nghe (để tự nghe lại khi Chrome tự dừng)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal
  const token = useRef({}).current

  // bỏ đối tượng đang dùng: tách khỏi hook trước rồi mới dừng (sự kiện muộn của nó không còn tác dụng)
  const drop = how => {
    const rec = recRef.current
    recRef.current = null
    if (!rec) return
    if (how === 'stop') {
      // stop: vẫn nhận câu cuối đang nói dở; Chrome kết thúc mà không chốt câu đó thì lấy phần đang hiện làm câu
      stoppedRef.current = rec
      rec.onend = () => {
        if (stoppedRef.current === rec) stoppedRef.current = null
        if (rec.pend) { finalRef.current(rec.pend); rec.pend = '' }
      }
      rec.onerror = () => {}
    } else {
      rec.onresult = null; rec.onend = null; rec.onerror = null; rec.onaudiostart = null; rec.onsoundstart = null
    }
    try { rec[how]() } catch { /* bỏ qua */ }
  }
  token.halt = () => { wantRef.current = false; setListening(false); setInterim(''); drop('abort') }

  const listen = useCallback(() => {
    const rec = new SR()
    rec.lang = 'vi-VN'
    rec.continuous = true
    rec.interimResults = true
    rec.onaudiostart = () => { if (recRef.current === rec) mark('audio') }
    rec.onsoundstart = () => { if (recRef.current === rec) mark('sound') }
    rec.onresult = e => {
      mark('text')
      let mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0] ? r[0].transcript : ''
        if (r.isFinal) { if (t.trim()) finalRef.current(t.trim()) } else mid += t
      }
      rec.pend = mid.trim()
      if (recRef.current === rec) setInterim(rec.pend)
    }
    rec.onerror = e => {
      if (recRef.current !== rec || e.error === 'no-speech' || e.error === 'aborted') return
      setError(ERR[e.error] || 'Không ghi âm được (' + e.error + ').')
      wantRef.current = false
      setListening(false)
    }
    rec.onend = () => {
      if (recRef.current !== rec) return
      recRef.current = null
      // Chrome tự kết thúc lượt nghe (nói liền lâu, mạng chập chờn) mà không chốt câu đang hiện: giữ phần đó làm câu
      if (rec.pend) { finalRef.current(rec.pend); rec.pend = '' }
      setInterim('')
      if (wantRef.current && active === token) listen()
      else setListening(false)
    }
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { recRef.current = null; wantRef.current = false; setListening(false) }
  }, [token])

  const end = useCallback(how => {
    wantRef.current = false
    setListening(false)
    setInterim('')
    if (active === token) active = null
    drop(how)
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  const stop = useCallback(() => end('stop'), [end])
  const abort = useCallback(() => end('abort'), [end])

  const start = useCallback(() => {
    if (!SR) { setError('Trình duyệt này chưa hỗ trợ ghi âm thành chữ, hãy dùng Chrome hoặc Edge.'); return }
    setError('')
    if (!wantRef.current) setHeard({ since: Date.now(), audio: false, sound: false, soundAt: 0, text: false })
    if (active && active !== token) active.halt()
    active = token
    wantRef.current = true
    if (!recRef.current) listen()
    else setListening(true)
  }, [token, listen])

  const toggle = useCallback(() => (wantRef.current ? stop() : start()), [start, stop])

  // câu cuối đã về (onresult chốt / onend) thì pend đã rỗng -> trả '' (không trùng)
  const takePending = useCallback(() => {
    const r = stoppedRef.current
    stoppedRef.current = null
    if (!r) return ''
    const p = String(r.pend || '').trim()
    r.pend = ''
    r.onresult = null; r.onend = null; r.onerror = null
    return p
  }, [])

  // rời khối / đổi khách: tắt micro
  useEffect(() => () => {
    wantRef.current = false
    if (active === token) active = null
    drop('abort')
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  return { supported: !!SR, listening, interim, error, heard, start, stop, abort, toggle, takePending, clearError: () => setError('') }
}
