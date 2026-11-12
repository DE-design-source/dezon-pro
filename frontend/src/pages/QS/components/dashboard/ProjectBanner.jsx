import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { draftName_, ttChuan_ } from '../../lib/dashModel.js'
import { fmtDate } from '../../lib/format.js'
import { projInfoModal } from '../project/projectActions'

/* Dải "ĐANG LÀM VIỆC" của bản nháp đang mở + 4 nút Mở bóc tách / Chi phí / Xuất báo giá / Thông tin
   (port hero của renderDash, PUB/dash.js:160-171). Props: cur (dự án đang mở), idx (vị trí trong nhóm, đặt "Bản nháp N"). */
export default function ProjectBanner({ cur, idx }) {
  const { navigate } = useQs()
  return (
    <div className="qs-dash-banner">
      <span className="qs-dash-banner-eyebrow"><span className="qs-dash-dot" />Đang làm việc</span>
      <span className="qs-dash-banner-title">
        <Icon name="building" size={14} />
        <span title={cur.ten}>{cur.ten}</span>
        <span className="qs-dash-banner-sep">›</span>
        <span>{draftName_(cur, idx)}</span>
      </span>
      <span className="qs-dash-banner-meta">
        <span>{cur.maDA}</span><span>·</span><span>Tạo {fmtDate(cur.ngayTao)}</span><span>·</span>
        <span className="qs-dash-banner-pill">{ttChuan_(cur.trangThai)}</span>
      </span>
      <span className="qs-dash-banner-acts">
        <button type="button" className="qs-dash-act primary" onClick={() => navigate('boc')}><Icon name="layers" size={13} />Mở bóc tách</button>
        <button type="button" className="qs-dash-act" onClick={() => navigate('chiphi')}><Icon name="banknote" size={13} />Chi phí</button>
        <button type="button" className="qs-dash-act" onClick={() => navigate('export')}><Icon name="fileText" size={13} />Xuất báo giá</button>
        <button type="button" className="qs-dash-act" onClick={() => projInfoModal(cur.maDA)}><Icon name="sliders" size={13} />Thông tin</button>
      </span>
    </div>
  )
}
