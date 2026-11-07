import Icon from '../../../../components/ui/Icon'
import { draftName_ } from '../../lib/dashModel.js'
import { fmtDate } from '../../lib/format.js'
import { pickProject, projInfoModal, removeProject, openProjDlg } from '../project/projectActions'

/* Một bản nháp trong thẻ dự án (port dòng .dh-draft, PUB/dash.js:214-227).
   Bấm biểu tượng hoặc mã = Thông tin dự án; bấm tên = mở bản nháp + sang Bóc tách (như "Dùng");
   đổi tên qua nút bút chì (hộp thoại); nút sửa tên / nhân bản / xoá hiện khi rê chuột.
   Props: draft (Project), index (vị trí trong nhóm), active (đang mở). */
export default function DraftItem({ draft: d, index, active }) {
  const name = draftName_(d, index)
  const meta = `${d.maDA} · ${fmtDate(d.ngayTao)}`
  const info = e => { e.stopPropagation(); projInfoModal(d.maDA) }
  return (
    <div className={`qs-dash-draft${active ? ' active' : ''}`}>
      <button type="button" className="qs-dash-draft-icon qs-dash-draft-info" title="Xem / sửa thông tin" onClick={info}>
        <Icon name="fileText" size={15} />
      </button>
      <div className="qs-dash-draft-txt">
        <div className="qs-dash-draft-name qs-dash-draft-n" title="Mở bản nháp này ở Bóc tách"
          onClick={e => { e.stopPropagation(); pickProject(d.maDA) }}>
          {name}
        </div>
        <div className="qs-dash-draft-meta qs-dash-click" title="Xem / sửa thông tin" onClick={info}>{meta}</div>
      </div>
      {/* nhóm nút sửa tên / nhân bản / xoá: ngay cạnh tên, hiện khi rê chuột vào dòng */}
      <div className="qs-dash-draft-tools">
        <button type="button" className="qs-dash-draft-ic" title="Sửa tên bản nháp" onClick={() => openProjDlg('rename', d.maDA)}><Icon name="edit" size={13} /></button>
        <button type="button" className="qs-dash-draft-ic" title="Nhân bản bản nháp" onClick={() => openProjDlg('dup', d.maDA)}><Icon name="copy" size={13} /></button>
        <button type="button" className="qs-dash-draft-ic del" title="Xoá bản nháp" onClick={() => removeProject(d.maDA)}><Icon name="trash" size={13} /></button>
      </div>
      <div className="qs-dash-draft-acts">
        {active
          ? <span className="qs-dash-using"><Icon name="check" size={13} stroke={2.4} />Đang dùng</span>
          : <button type="button" className="qs-dash-use-btn" title="Mở bóc tách bản này" onClick={() => pickProject(d.maDA)}>Dùng</button>}
      </div>
    </div>
  )
}
