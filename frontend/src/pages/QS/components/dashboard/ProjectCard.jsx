import Icon from '../../../../components/ui/Icon'
import { DezonChip } from '../project/PCard'
import { projInfoModal, removeProjectGroup, addDraft } from '../project/projectActions'
import DraftItem from './DraftItem'
import { useQsCan } from '../../state/qsAccess'

/* Thẻ 1 dự án (nhóm bản nháp cùng tên) (port dashProjCard_, PUB/dash.js:213-234).
   Bấm đầu thẻ = Thông tin dự án; chip Dezon; thùng rác = xoá cả dự án; "Thêm bản nháp".
   Props: group {name, khachHang, sdt, linkDezon, drafts[]}, curMa = mã bản nháp đang mở. */
export default function ProjectCard({ group: g, curMa }) {
  const key = g.drafts[0].maDA
  const qsCan = useQsCan()   // N21: QS > Dự án > Thêm / Xoá
  const sub = (g.khachHang || 'Chưa có khách hàng') + (g.sdt ? ' · ' + g.sdt : '')
  return (
    <div className="qs-dash-project">
      <div className="qs-dash-project-head qs-dash-click" onClick={() => projInfoModal(key)} title="Xem thông tin dự án">
        <div className="qs-dash-project-icon"><Icon name="building" size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="qs-dash-project-name" title={g.name}>{g.name}</div>
          <div className="qs-dash-project-sub" title={sub}>{sub}</div>
        </div>
        <DezonChip p={{ linkDezon: g.linkDezon, maDA: key }} cls="qs-dash-link" label={false} />
        <span className="qs-dash-count">{g.drafts.length} bản</span>
      </div>
      {qsCan('duan', 'delete') && <button type="button" className="qs-dash-trash" title="Xoá cả dự án này (mọi bản nháp)" onClick={() => removeProjectGroup(key)}>
        <Icon name="trash" size={13} />
      </button>}
      <div className="qs-dash-project-body">
        {g.drafts.map((d, i) => <DraftItem key={d.maDA} draft={d} index={i} active={d.maDA === curMa} groupMas={g.drafts.map(x => x.maDA)} />)}
        {qsCan('duan', 'create') && <button type="button" className="qs-dash-add-draft" onClick={() => addDraft(key)}><Icon name="plus" size={14} />Thêm bản nháp</button>}
      </div>
    </div>
  )
}
