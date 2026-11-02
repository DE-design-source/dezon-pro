import { useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { uploadRaw, mediaUrl } from '../../api/files'
import { qsToast as toast, qsConfirm } from '../common/dialogs'

/* Ảnh công trình của dự án (dữ liệu phụ khoá 'anhDuAn' = mảng URL, ảnh đầu = ảnh bìa).
   HeroSlider: ảnh lớn đầu trang chi tiết như dezon.vn (‹ › + chấm); chưa có ảnh -> ô "Thêm hình ảnh dự án".
   ImageManager: tab Hình ảnh — ô kéo thả / bấm để tải ảnh, lưới ảnh có nút đặt làm ảnh bìa / xoá.
   onSave(list) ghi lên máy chủ (ProjectDetail gọi api.setProjData). */
export function HeroSlider({ list, onAdd, onView }) {
  const [i, setI] = useState(0)
  if (!list.length) {
    return (
      <button type="button" className="qs-pd-hero empty" onClick={onAdd}>
        <span className="ic"><Icon name="upload" size={30} /></span>
        <b>Chưa có hình ảnh dự án</b>
        <span>Bấm để thêm ảnh công trình (ảnh đầu tiên là ảnh bìa)</span>
      </button>
    )
  }
  const k = Math.min(i, list.length - 1)
  const go = d => setI((k + d + list.length) % list.length)
  return (
    <div className="qs-pd-hero slider">
      <button type="button" className="qs-pd-slide" onClick={() => onView(mediaUrl(list[k]))} title="Bấm để xem ảnh lớn"><img src={mediaUrl(list[k])} alt="" /></button>
      {list.length > 1 && (
        <>
          <button type="button" className="qs-pd-nav l" aria-label="Ảnh trước" onClick={() => go(-1)}><Icon name="chevronRight" size={22} /></button>
          <button type="button" className="qs-pd-nav r" aria-label="Ảnh sau" onClick={() => go(1)}><Icon name="chevronRight" size={22} /></button>
          <div className="qs-pd-dots">{list.map((u, j) => <button type="button" key={u + j} className={j === k ? 'on' : ''} aria-label={'Ảnh ' + (j + 1)} onClick={() => setI(j)} />)}</div>
        </>
      )}
    </div>
  )
}

export function ImageManager({ list, onSave, onView, inputRef }) {
  const [busy, setBusy] = useState(0)
  const [over, setOver] = useState(false)
  const own = useRef(null)
  const inp = inputRef || own
  async function addFiles(files) {
    const imgs = [...files].filter(f => /^image\//.test(f.type))
    if (!imgs.length) { toast('Chỉ nhận file ảnh (jpg, png, webp…)'); return }
    setBusy(imgs.length)
    const added = []
    for (const f of imgs) {
      try { const r = await uploadRaw(f); if (r && r.url) added.push(r.url) } catch (e) { toast('Tải "' + f.name + '" lỗi: ' + e.message) }
      setBusy(n => n - 1)
    }
    if (added.length) { await onSave([...list, ...added]); toast('Đã thêm ' + added.length + ' ảnh dự án') }
  }
  async function del(u) {
    if (!await qsConfirm('Xoá ảnh này khỏi dự án?')) return
    onSave(list.filter(x => x !== u))
  }
  const cover = u => onSave([u, ...list.filter(x => x !== u)])
  return (
    <div className="qs-pim">
      <input ref={inp} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <div className={`qs-pim-drop${over ? ' over' : ''}`} onClick={() => inp.current && inp.current.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}>
        <Icon name="upload" size={26} />
        <b>{busy ? 'Đang tải lên ' + busy + ' ảnh…' : 'Kéo thả ảnh vào đây hoặc bấm để chọn ảnh'}</b>
        <span>Ảnh công trình / phối cảnh / hiện trạng của dự án. Ảnh đầu tiên là ảnh bìa ở Danh sách dự án.</span>
      </div>
      {list.length > 0 && (
        <div className="qs-pim-grid">
          {list.map((u, j) => (
            <div key={u + j} className="qs-pim-it">
              <button type="button" className="img" onClick={() => onView(mediaUrl(u))}><img src={mediaUrl(u)} alt="" loading="lazy" /></button>
              {j === 0 ? <span className="cover">Ảnh bìa</span>
                : <button type="button" className="act cv" title="Đặt làm ảnh bìa" onClick={() => cover(u)}><Icon name="star" size={14} /></button>}
              <button type="button" className="act del" title="Xoá ảnh" onClick={() => del(u)}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
