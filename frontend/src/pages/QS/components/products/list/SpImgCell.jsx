import { useState } from 'react'
import QsIcon from '../../common/QsIcon'
import ProductThumb from '../../common/ProductThumb'
import { mediaUrl } from '../../../api/files'
import { qsToast as toast } from '../../common/dialogs'
import { downscaleImage_, uploadImg_ } from '../../importer/imgUpload'
import { spInlineSave } from './spActions'

/* Ô Ảnh ở chế độ sửa nhanh Danh sách SP: tải / dán / copy / xoá hình đại diện ngay trên bảng, không cần mở Cập nhật SP.
   Ảnh SP = trường "ẢNH SẢN PHẨM" (cột anh_sp, nhiều link cách dòng, link đầu = hình đại diện); ảnh chi tiết phía sau giữ nguyên.
   Dán: Ctrl/⌘+V khi ô đang chọn (ảnh trong clipboard hoặc link ảnh), hoặc nút Dán (ảnh vừa Copy ở ô khác). Kéo thả file ảnh vào ô cũng được. */
const E = { lark: 'ẢNH SẢN PHẨM', col: 'anh_sp' }
let daCopy = ''   // link ảnh vừa Copy trong bảng (dùng chung mọi ô)

const ds_ = p => String(p.anhTatCa || p.hinhAnh || '').split('\n').map(x => x.trim()).filter(Boolean)

export default function SpImgCell({ p, ts, onView }) {
  const [busy, setBusy] = useState('')
  const [, setTick] = useState(0)   // vẽ lại nút Dán sau khi Copy
  const list = ds_(p), main = list[0] || ''

  const luu = async moi => {
    const r = await spInlineSave(p, E, moi.join('\n'), list.join('\n'))
    if (r && r.st === 'ok') toast(moi[0] ? 'Đã cập nhật ảnh "' + (p.ten || p.ma || '') + '"' : 'Đã xoá hình đại diện')
  }
  const datMain = url => luu([url].concat(list.slice(1).filter(x => x !== url)))
  const taiFile = async f => {
    if (!f || (f.type && !/^image\//.test(f.type))) { toast('Chỉ nhận file ảnh (JPG / PNG / WEBP)'); return }
    setBusy('Đang tải…')
    try {
      const b = await downscaleImage_(f, 1600, 0.82)
      if (b === '__DECODE_FAIL__' || !b) { toast('Không đọc được ảnh — có thể ảnh iPhone (.HEIC). Đổi sang JPG/PNG.'); return }
      await datMain(await uploadImg_(b, f.name || 'image.jpg'))
    } catch (e) { toast('Tải ảnh lỗi: ' + String((e && e.message) || e).slice(0, 80)) } finally { setBusy('') }
  }
  const chon = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'image/*'
    inp.onchange = () => taiFile(inp.files && inp.files[0])
    inp.click()
  }
  const copy = () => {
    daCopy = main
    setTick(t => t + 1)
    try { navigator.clipboard.writeText(new URL(mediaUrl(main), location.href).href).catch(() => {}) } catch (e) { /* chỉ copy trong bảng */ }
    toast('Đã copy ảnh — bấm Dán ở ô khác (hoặc Ctrl+V)')
  }
  const lien_ = s => (/^https?:\/\/\S+$/i.test(s) || /^\/?(files|media)\//.test(s) ? s : '')
  const dan = async () => {
    if (daCopy) { await datMain(daCopy); return }
    try {   // chưa Copy trong bảng: thử ảnh / link trong clipboard của máy
      const its = await navigator.clipboard.read()
      for (const it of its) {
        const t = it.types.find(x => /^image\//.test(x))
        if (t) { await taiFile(new File([await it.getType(t)], 'paste.png', { type: t })); return }
      }
      const s = lien_((await navigator.clipboard.readText()).trim())
      if (s) { await datMain(s); return }
    } catch (e) { /* trình duyệt chặn đọc clipboard */ }
    toast('Chưa có ảnh để dán — bấm Copy ở ô ảnh khác, hoặc chọn ô rồi nhấn Ctrl+V')
  }
  const onPaste = e => {
    const f = Array.from((e.clipboardData && e.clipboardData.files) || []).find(x => /^image\//.test(x.type))
    if (f) { e.preventDefault(); taiFile(f); return }
    const s = lien_(String((e.clipboardData && e.clipboardData.getData('text')) || '').trim())
    if (s) { e.preventDefault(); datMain(s); return }
    if (daCopy) { e.preventDefault(); datMain(daCopy) }
  }
  const onDrop = e => {
    e.preventDefault(); e.stopPropagation()
    const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []).find(x => /^image\//.test(x.type))
    if (f) taiFile(f)
  }

  return (
    <div className="qspl-imgc" tabIndex={0} title="Chọn ô rồi Ctrl+V để dán ảnh, hoặc kéo thả file ảnh vào"
      onClick={e => e.stopPropagation()} onPaste={onPaste} onDragOver={e => { e.preventDefault(); e.stopPropagation() }} onDrop={onDrop}>
      <ProductThumb product={p} size={ts || 40} src={main ? mediaUrl(main) : ''} className="qspl-th" title={main ? 'Bấm để xem ảnh lớn' : undefined}
        onClick={main && onView ? () => onView(p) : undefined} />
      {busy && <span className="qspl-imgc-busy">{busy}</span>}
      <span className="qspl-imgc-bar">
        <button type="button" title={main ? 'Đổi ảnh (chọn file)' : 'Thêm ảnh (chọn file)'} disabled={!!busy} onClick={chon}><QsIcon name="camera" size={14} /></button>
        <button type="button" title={daCopy ? 'Dán ảnh vừa copy' : 'Dán ảnh từ clipboard'} disabled={!!busy || daCopy === main && !!main} onClick={dan}><QsIcon name="download" size={14} /></button>
        {main && <button type="button" title="Copy ảnh này để dán sang sản phẩm khác" disabled={!!busy} onClick={copy}><QsIcon name="copy" size={14} /></button>}
        {main && <button type="button" className="del" title={list.length > 1 ? 'Xoá hình đại diện (ảnh chi tiết kế tiếp thành đại diện)' : 'Xoá ảnh'} disabled={!!busy} onClick={() => luu(list.slice(1))}><QsIcon name="trash" size={14} /></button>}
      </span>
    </div>
  )
}
