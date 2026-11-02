import { useEffect, useRef, useState } from 'react'
import { MAX_CONTENT, runeLength } from '../state/chatLogic'

/* Khung soạn tin (giai đoạn MVP: chỉ văn bản) — Enter gửi, Shift+Enter xuống dòng, tối đa 4.000 ký tự.
   Nội dung đang soạn giữ theo từng hội thoại (initialText / onDraft); onTyping báo "đang soạn tin". */
export default function Composer({ initialText = '', onSend, onDraft, onTyping, onBlur, disabled, placeholder }) {
  const [text, setText] = useState(initialText)
  const taRef = useRef(null)

  /* Ô nhập tự giãn theo nội dung, tối đa 120px */
  function fit(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }
  useEffect(() => { fit(taRef.current) }, [])

  function change(v) {
    setText(v)
    if (onDraft) onDraft(v)
    if (onTyping) onTyping(v)
  }

  function send() {
    const t = text.trim()
    if (!t || disabled) return
    if (runeLength(t) > MAX_CONTENT) return
    if (onSend(t) === false) return
    setText('')
    if (onDraft) onDraft('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const len = runeLength(text)
  const over = len > MAX_CONTENT

  return (
    <div className="ch-composer">
      <div className="ch-composer-row">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={placeholder || 'Nhập tin nhắn... (Enter để gửi)'}
          title="Enter để gửi, Shift+Enter để xuống dòng"
          value={text}
          disabled={disabled}
          onChange={e => { change(e.target.value); fit(e.target) }}
          onBlur={() => { if (onBlur) onBlur() }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
        />
        <button className="ch-send-btn" title="Gửi" disabled={disabled || !text.trim() || over} onClick={send}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>
      {len > MAX_CONTENT - 500 && (
        <div className={'ch-composer-count' + (over ? ' over' : '')}>{len.toLocaleString('vi-VN')} / {MAX_CONTENT.toLocaleString('vi-VN')} ký tự{over ? ' — quá dài, hãy rút gọn' : ''}</div>
      )}
    </div>
  )
}
