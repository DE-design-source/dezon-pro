import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { uploadRaw, mediaUrl } from '../../QS/api/files'

/* Ô đính kèm của form khách hàng (bước Nâng cao, MarkUp 2026-11-16 16:20): bấm, kéo thả hoặc dán (Ctrl+V) nhiều tệp, tải ngay lên kho tệp
   máy chủ (/upload/file, giới hạn 50MB / tệp, đuôi theo DOC_EXT của máy chủ), giữ danh sách {name, url}.
   kind 'img' = Hình đính kèm (ảnh, hiện ảnh nhỏ) | 'file' = Tệp đính kèm (các định dạng khác: PDF, CAD, nén, Office).
   Nhận cả ảnh kéo từ trang web khác (chỉ có URL / HTML <img src>, kể cả data: URL): tải ảnh về rồi tải lên như tệp thường.
   Props: kind, label, items [{name, url}], onChange(items), onBusy(số tệp đang tải lên). Ref: add(files) - LeadModal chuyển tệp dán ở cấp bước Nâng cao vào đây */
const ACCEPT = {
  img: '.png,.jpg,.jpeg,.webp,.gif',
  file: '.pdf,.dwg,.dxf,.skp,.zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.ppt,.pptx',
}
const HINT = { img: 'PNG, JPG, WEBP, GIF', file: 'PDF, DWG/DXF, SKP, ZIP/RAR/7Z, Word, Excel, PowerPoint' }
const okExt = (kind, name) => ACCEPT[kind].split(',').indexOf('.' + String(name).split('.').pop().toLowerCase()) >= 0
/* Đuôi theo kiểu MIME cho tệp không tên / không đuôi (ảnh dán, ảnh kéo từ web) */
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'application/x-7z-compressed': '7z',
  'application/vnd.rar': 'rar', 'application/x-rar-compressed': 'rar',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}
const stamp_ = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) }
/* Ảnh chụp màn hình dán vào thường tên "image.png" / không tên: đặt lại 'anh-<thời gian>.<đuôi theo mime>' */
function named_(f, i) {
  const ext = MIME_EXT[String(f.type || '').toLowerCase()]
  const generic = !f.name || f.name.indexOf('.') < 0 || /^image\.(png|jpe?g|gif|webp)$/i.test(f.name)
  if (!ext || !generic) return f
  const base = (String(f.type).indexOf('image/') === 0 ? 'anh-' : 'tep-') + stamp_() + (i ? '-' + (i + 1) : '')
  return new File([f], base + '.' + ext, { type: f.type })
}
/* Tệp trong clipboard / dataTransfer (items kind 'file' hoặc files) */
export function filesOf(dt) {
  if (!dt) return []
  const out = []
  if (dt.items && dt.items.length) Array.from(dt.items).forEach(it => { if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f) } })
  if (!out.length && dt.files && dt.files.length) out.push(...Array.from(dt.files))
  return out
}
/* URL ảnh khi kéo từ trang web khác (không có tệp): ưu tiên <img src> trong text/html, rồi text/uri-list, rồi text/plain */
function droppedUrl_(dt) {
  const html = dt.getData('text/html') || ''
  const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)
  if (m) return m[1].replace(/&amp;/g, '&')
  const uri = (dt.getData('text/uri-list') || '').split(/\r?\n/).map(s => s.trim()).find(s => s && s[0] !== '#')
  if (uri) return uri
  const t = (dt.getData('text/plain') || '').trim()
  return /^(https?:|data:)/i.test(t) ? t : ''
}
const isTextTarget_ = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const hasFiles_ = dt => !!dt && Array.from(dt.types || []).indexOf('Files') >= 0
const CORS_ERR = 'Trang nguồn chặn tải ảnh trực tiếp - bấm chuột phải ảnh > Sao chép hình ảnh rồi dán (Ctrl+V) vào đây'

const AttachBox = forwardRef(function AttachBox({ kind, label, items, onChange, onBusy }, ref) {
  const inp = useRef(null)
  const zoneRef = useRef(null)
  const hoverRef = useRef(false)
  const dragDepth = useRef(0)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const list = items || []
  /* add() chạy bất đồng bộ: giữ danh sách mới nhất để nhiều lần tải liên tiếp không ghi đè nhau */
  const listRef = useRef(list)
  listRef.current = list

  async function add(files) {
    const fs = Array.from(files || []).map(named_)
    if (!fs.length) return
    setErr('')
    const bad = fs.filter(f => !okExt(kind, f.name))
    if (bad.length) setErr('Bỏ qua ' + bad.map(f => f.name).join(', ') + ' (chỉ nhận ' + HINT[kind] + ')')
    const good = fs.filter(f => okExt(kind, f.name))
    setBusy(n => n + good.length)
    const got = []
    for (const f of good) {
      try {
        const r = await uploadRaw(f)
        if (r && r.url) got.push({ name: f.name, url: r.url })
      } catch (e) {
        setErr('Không tải được "' + f.name + '": ' + ((e && e.message) || e))
      } finally { setBusy(n => n - 1) }
    }
    if (got.length) onChange([...listRef.current, ...got])
  }
  useImperativeHandle(ref, () => ({ add }))
  /* Báo số tệp đang tải lên cho LeadModal (chặn lưu khi còn tệp chưa tải xong) */
  useEffect(() => { if (onBusy) onBusy(busy) }, [busy]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Ảnh kéo từ trang web khác: tải về (fetch) -> File -> tải lên như tệp thường; trang nguồn chặn CORS thì báo cách dán.
     Lúc đang tải về cũng tính là đang tải lên (busy): hiện "Đang tải lên" và LeadModal chặn lưu cho tới khi xong */
  async function addUrl(url) {
    setErr('')
    setBusy(n => n + 1)
    let file = null
    try {
      let blob
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error('HTTP ' + res.status)
        blob = await res.blob()
      } catch {
        setErr(CORS_ERR)
        return
      }
      const type = String(blob.type || '').toLowerCase().split(';')[0]
      let name = ''
      if (!/^data:/i.test(url)) {
        try { name = decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop() || '') } catch { name = '' }
      }
      if (!name || !okExt(kind, name)) {
        const ext = MIME_EXT[type]
        if (!ext) { setErr('Không nhận dạng được tệp kéo vào (chỉ nhận ' + HINT[kind] + ')'); return }
        name = (type.indexOf('image/') === 0 ? 'anh-' : 'tep-') + stamp_() + '.' + ext
      }
      file = new File([blob], name, { type })
    } finally {
      setBusy(n => n - 1)
    }
    // cùng lượt với setBusy(-1) ở trên (add tăng busy ngay, trước await đầu tiên) -> không có khoảnh khắc busy = 0
    if (file) add([file])
  }

  /* Dán (Ctrl+V) khi ô đang focus, hoặc chuột đang rê trên ô (không phải đang gõ trong ô chữ khác).
     Nghe ở pha capture của document để chạy trước bộ nghe cấp bước Nâng cao của LeadModal (bên đó bỏ qua khi defaultPrevented) */
  useEffect(() => {
    const onPaste = e => {
      const zone = zoneRef.current
      if (!zone || !zone.offsetParent) return
      const focused = zone.contains(document.activeElement)
      if (!focused && !(hoverRef.current && !isTextTarget_(e.target))) return
      const fs = filesOf(e.clipboardData).map(named_)
      // không tệp nào hợp ô này (vd dán ảnh khi đang ở ô Tệp): để LeadModal chuyển sang đúng ô
      if (!fs.some(f => okExt(kind, f.name))) return
      e.preventDefault()
      add(fs)
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  })

  const remove = i => onChange(list.filter((_, j) => j !== i))

  return (
    <div className="kd-field" style={{ minWidth: 0 }}>
      <label>{label}{list.length ? ' (' + list.length + ')' : ''}</label>
      <div
        ref={zoneRef}
        role="button" tabIndex={0} title="Bấm, kéo thả hoặc dán (Ctrl+V)"
        onClick={() => inp.current && inp.current.click()}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && inp.current) { e.preventDefault(); inp.current.click() } }}
        onMouseEnter={() => { hoverRef.current = true }}
        onMouseLeave={() => { hoverRef.current = false }}
        /* Bộ đếm dragenter / dragleave: rê qua phần tử con (ảnh nhỏ, dòng tệp) không làm nháy viền */
        onDragEnter={e => { e.preventDefault(); dragDepth.current += 1; setOver(true) }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setOver(false) }}
        onDrop={e => {
          e.preventDefault(); dragDepth.current = 0; setOver(false)
          const dt = e.dataTransfer
          const fs = filesOf(dt)
          if (fs.length) { add(fs); return }
          const url = droppedUrl_(dt)
          if (url) addUrl(url)
          else if (!hasFiles_(dt)) setErr('Không có tệp / ảnh nào trong nội dung kéo vào')
        }}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, minHeight: 74, boxSizing: 'border-box', padding: 8, borderRadius: 10, cursor: 'pointer',
          border: '1.5px dashed ' + (over ? 'var(--primary)' : 'var(--border)'), background: over ? 'var(--primary-tint)' : 'var(--surface-alt)',
        }}
      >
        {list.length ? (
          kind === 'img' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {list.map((it, i) => (
                <div key={it.url + i} title={it.name} style={{ position: 'relative', width: 46, height: 46, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <a href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} draggable={false}>
                    <img src={mediaUrl(it.url)} alt={it.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </a>
                  <XBtn onClick={() => remove(i)} style={{ position: 'absolute', top: 1, right: 1 }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {list.map((it, i) => (
                <div key={it.url + i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, minWidth: 0 }}>
                  <span style={{ flex: 'none' }}>📎</span>
                  <a href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={it.name}
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{it.name}</a>
                  <XBtn onClick={() => remove(i)} />
                </div>
              ))}
            </div>
          )
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: list.length ? 'none' : 1, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flex: 'none' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          {busy > 0 ? 'Đang tải lên ' + busy + ' tệp…' : (list.length ? 'Thêm: bấm, kéo thả hoặc dán (Ctrl+V)' : 'Bấm, kéo thả hoặc dán (Ctrl+V) · ' + HINT[kind])}
        </div>
      </div>
      {err ? <i style={{ fontSize: 11, color: 'var(--danger)', fontStyle: 'normal' }}>{err}</i> : null}
      <input ref={inp} type="file" multiple accept={ACCEPT[kind]} style={{ display: 'none' }} onChange={e => { add(e.target.files); e.target.value = '' }} />
    </div>
  )
})
export default AttachBox

function XBtn({ onClick, style }) {
  return (
    <button type="button" title="Bỏ" onClick={e => { e.stopPropagation(); onClick() }}
      style={{ width: 16, height: 16, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 8, background: 'rgba(15,23,42,.6)', color: '#fff', fontSize: 10, lineHeight: 1, cursor: 'pointer', ...style }}>✕</button>
  )
}
