import { useEffect, useRef, useState } from 'react'
import { refreshMedia } from '../state/chatStore'
import { downloadMedia, useFreshMedia, useHeldSrc } from './MediaBubble'

/* Xem ảnh / video cỡ lớn: Esc đóng, mũi tên trái / phải chuyển, nút tải về.
   items: [{key, media: MediaDTO, messageId, type}] theo thứ tự trong hội thoại */
export default function Lightbox({ items, index, onIndex, onClose }) {
  const it = items[index]
  const md = it && it.media
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useFreshMedia(md)
  const vref = useRef(null)
  const vsrc = useHeldSrc(md && md.url, vref, it && it.key)

  useEffect(() => {
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, items.length, onIndex, onClose])

  useEffect(() => { setErr('') }, [index])

  if (!it || !md) return null

  async function download() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await downloadMedia(md, it.messageId)
    } catch (e) {
      setErr((e && e.message) || 'Không tải được tệp')
    } finally {
      setBusy(false)
    }
  }

  /* Lỗi hiển thị: link sắp / đã hết hạn thì xin link mới */
  function onError() {
    if (md.expires_at && Date.parse(md.expires_at) - Date.now() < 5000) refreshMedia(md.id)
    else setErr(it.type === 'video' ? 'Không phát được video này, hãy tải về' : 'Không tải được ảnh')
  }

  return (
    <div className="ch-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ch-lb-bar" onClick={e => e.stopPropagation()}>
        <span className="ch-lb-count">{index + 1} / {items.length}</span>
        {err && <span className="ch-lb-err">{err}</span>}
        <button type="button" className="ch-lb-btn" title="Tải về" disabled={busy} onClick={download}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
        </button>
        <button type="button" className="ch-lb-btn" title="Đóng (Esc)" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {index > 0 && (
        <button type="button" className="ch-lb-nav prev" title="Trước" onClick={e => { e.stopPropagation(); onIndex(index - 1) }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      <div className="ch-lb-stage" onClick={e => e.stopPropagation()}>
        {it.type === 'video'
          ? <video key={it.key} ref={vref} src={vsrc} poster={md.thumb_url || undefined} controls autoPlay playsInline onError={onError} />
          : <img key={it.key} src={md.url} alt="" onError={onError} />}
      </div>
      {index < items.length - 1 && (
        <button type="button" className="ch-lb-nav next" title="Sau" onClick={e => { e.stopPropagation(); onIndex(index + 1) }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      )}
    </div>
  )
}
