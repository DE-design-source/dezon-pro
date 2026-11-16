import { useRef, useState } from 'react'
import { uploadRaw, mediaUrl } from '../../QS/api/files'

/* Ô đính kèm của form khách hàng (bước Nâng cao, MarkUp 2026-11-16 16:20): bấm hoặc kéo thả nhiều tệp, tải ngay lên kho tệp
   máy chủ (/upload/file, giới hạn 50MB / tệp, đuôi theo DOC_EXT của máy chủ), giữ danh sách {name, url}.
   kind 'img' = Hình đính kèm (ảnh, hiện ảnh nhỏ) | 'file' = Tệp đính kèm (các định dạng khác: PDF, CAD, nén, Office).
   Props: kind, label, items [{name, url}], onChange(items) */
const ACCEPT = {
  img: '.png,.jpg,.jpeg,.webp,.gif',
  file: '.pdf,.dwg,.dxf,.skp,.zip,.rar,.7z,.doc,.docx,.xls,.xlsx,.ppt,.pptx',
}
const HINT = { img: 'PNG, JPG, WEBP, GIF', file: 'PDF, DWG/DXF, SKP, ZIP/RAR/7Z, Word, Excel, PowerPoint' }
const okExt = (kind, name) => ACCEPT[kind].split(',').indexOf('.' + String(name).split('.').pop().toLowerCase()) >= 0

export default function AttachBox({ kind, label, items, onChange }) {
  const inp = useRef(null)
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const list = items || []

  async function add(files) {
    const fs = Array.from(files || [])
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
    if (got.length) onChange([...list, ...got])
  }
  const remove = i => onChange(list.filter((_, j) => j !== i))

  return (
    <div className="kd-field" style={{ minWidth: 0 }}>
      <label>{label}{list.length ? ' (' + list.length + ')' : ''}</label>
      <div
        role="button" tabIndex={0}
        onClick={() => inp.current && inp.current.click()}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && inp.current) { e.preventDefault(); inp.current.click() } }}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
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
                  <a href={mediaUrl(it.url)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                    <img src={mediaUrl(it.url)} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
          {busy > 0 ? 'Đang tải lên ' + busy + ' tệp…' : (list.length ? 'Thêm tệp' : 'Bấm hoặc kéo thả · ' + HINT[kind])}
        </div>
      </div>
      {err ? <i style={{ fontSize: 11, color: 'var(--danger)', fontStyle: 'normal' }}>{err}</i> : null}
      <input ref={inp} type="file" multiple accept={ACCEPT[kind]} style={{ display: 'none' }} onChange={e => { add(e.target.files); e.target.value = '' }} />
    </div>
  )
}

function XBtn({ onClick, style }) {
  return (
    <button type="button" title="Bỏ" onClick={e => { e.stopPropagation(); onClick() }}
      style={{ width: 16, height: 16, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 8, background: 'rgba(15,23,42,.6)', color: '#fff', fontSize: 10, lineHeight: 1, cursor: 'pointer', ...style }}>✕</button>
  )
}
