import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { draftName_ } from '../../lib/dashModel.js'
import { fmtDate } from '../../lib/format.js'
import { pickProject, projInfoModal, removeProject, renameDraftSave, openProjDlg } from '../project/projectActions'

/* Một bản nháp trong thẻ dự án (port dòng .dh-draft, PUB/dash.js:214-227).
   Bấm tên = sửa tên tại chỗ (draftNameEdit_, app.js:2258-2282: Enter / rời ô = lưu, Esc = huỷ); bấm mã = Thông tin dự án;
   "Dùng" = mở bản nháp + sang Bóc tách; nút sửa tên / nhân bản / xoá hiện khi rê chuột.
   Props: draft (Project), index (vị trí trong nhóm), active (đang mở). */
export default function DraftItem({ draft: d, index, active }) {
  const [edit, setEdit] = useState(null)   // null | {w, v}
  const name = draftName_(d, index)
  const meta = `${d.maDA} · ${fmtDate(d.ngayTao)}`
  return (
    <div className={`qs-dash-draft${active ? ' active' : ''}`}>
      <div className="qs-dash-draft-icon"><Icon name="fileText" size={15} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {edit
          ? <NameInput init={name} width={edit.w} maDA={d.maDA} onDone={() => setEdit(null)} />
          : (
            <div className="qs-dash-draft-name qs-dash-draft-n" title="Bấm để đổi tên bản nháp"
              onClick={e => { e.stopPropagation(); setEdit({ w: Math.max(120, e.currentTarget.getBoundingClientRect().width + 24) }) }}>
              {name}
            </div>
          )}
        <div className="qs-dash-draft-meta qs-dash-click" title="Xem / sửa thông tin" onClick={() => projInfoModal(d.maDA)}>{meta}</div>
      </div>
      <div className="qs-dash-draft-acts">
        {active
          ? <span className="qs-dash-using"><Icon name="check" size={13} stroke={2.4} />Đang dùng</span>
          : <button type="button" className="qs-dash-use-btn" title="Mở bóc tách bản này" onClick={() => pickProject(d.maDA)}>Dùng</button>}
        <button type="button" className="qs-dash-draft-ic" title="Sửa tên bản nháp" onClick={() => openProjDlg('rename', d.maDA)}><Icon name="edit" size={13} /></button>
        <button type="button" className="qs-dash-draft-ic" title="Nhân bản bản nháp" onClick={() => openProjDlg('dup', d.maDA)}><Icon name="copy" size={13} /></button>
        <button type="button" className="qs-dash-draft-ic del" title="Xoá bản nháp" onClick={() => removeProject(d.maDA)}><Icon name="trash" size={13} /></button>
      </div>
    </div>
  )
}

function NameInput({ init, width, maDA, onDone }) {
  const [v, setV] = useState(init)
  const ref = useRef(null)
  const done = useRef(false)
  useEffect(() => { if (ref.current) { ref.current.focus(); ref.current.select() } }, [])
  async function luu() {
    if (done.current) return
    done.current = true
    const ten = v.trim()
    if (ten && ten !== init) await renameDraftSave(maDA, ten)
    onDone()
  }
  function huy() { if (done.current) return; done.current = true; onDone() }
  return (
    <input ref={ref} className="qs-dash-draft-in" style={{ width }} value={v}
      onChange={e => setV(e.target.value)}
      onBlur={luu}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); luu() } else if (e.key === 'Escape') { e.preventDefault(); huy() }
      }} />
  )
}
