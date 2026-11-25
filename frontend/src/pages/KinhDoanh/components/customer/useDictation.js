import { useCallback, useEffect, useRef, useState } from 'react'

/* Ghi âm -> chữ bằng Web Speech API của trình duyệt (Chrome / Edge; tiếng Việt vi-VN).
   onFinal(text): mỗi đoạn câu đã nhận dạng xong; interim: phần đang nói dở (hiện mờ).
   Chrome tự dừng khi im lặng một lúc: đang bật thì tự nghe lại cho tới khi người dùng bấm dừng. */
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

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
  const recRef = useRef(null)
  const wantRef = useRef(false)      // người dùng còn muốn nghe (để tự nghe lại khi Chrome tự dừng)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  const stop = useCallback(() => {
    wantRef.current = false
    setListening(false)
    setInterim('')
    try { recRef.current && recRef.current.stop() } catch { /* bỏ qua */ }
  }, [])

  const start = useCallback(() => {
    if (!SR) { setError('Trình duyệt này chưa hỗ trợ ghi âm thành chữ, hãy dùng Chrome hoặc Edge.'); return }
    setError('')
    let rec = recRef.current
    if (!rec) {
      rec = new SR()
      rec.lang = 'vi-VN'
      rec.continuous = true
      rec.interimResults = true
      rec.onresult = e => {
        let mid = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          const t = r[0] ? r[0].transcript : ''
          if (r.isFinal) { if (t.trim()) finalRef.current(t.trim()) } else mid += t
        }
        setInterim(mid.trim())
      }
      rec.onerror = e => {
        if (e.error === 'no-speech' || e.error === 'aborted') return
        setError(ERR[e.error] || 'Không ghi âm được (' + e.error + ').')
        wantRef.current = false
        setListening(false)
      }
      rec.onend = () => {
        setInterim('')
        if (wantRef.current) { try { rec.start() } catch { wantRef.current = false; setListening(false) } } else setListening(false)
      }
      recRef.current = rec
    }
    wantRef.current = true
    try { rec.start(); setListening(true) } catch { /* đã đang chạy */ setListening(true) }
  }, [])

  const toggle = useCallback(() => (wantRef.current ? stop() : start()), [start, stop])

  // rời khối / đổi khách: tắt micro
  useEffect(() => () => { wantRef.current = false; try { recRef.current && recRef.current.abort() } catch { /* bỏ qua */ } }, [])

  return { supported: !!SR, listening, interim, error, start, stop, toggle, clearError: () => setError('') }
}
