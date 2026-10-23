import { useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { DezonChip } from '../project/PCard'
import { projInfoModal, removeProjectGroup, addDraft } from '../project/projectActions'
import { fmtDate } from '../../lib/format.js'
import DraftItem from './DraftItem'

/* Hai chế độ xem thêm của Danh sách dự án (chế độ "Thẻ" là ProjectCard). Cùng props với ProjectCard:
   group {name, khachHang, sdt, linkDezon, drafts[]}, curMa = mã bản nháp đang mở. Mọi thao tác dùng lại projectActions / DraftItem. */

const subOf_ = g => (g.khachHang || 'Chưa có khách hàng') + (g.sdt ? ' · ' + g.sdt : '')

/* Cột của Dạng thanh: độ rộng (px của vùng QS) kéo đổi được ở hàng tiêu đề, nằm trong biến CSS --w-<key> của .qs-dash-rows */
export const BAR_COLS = [
  { key: 'name', label: 'Dự án', def: 300, min: 120 },
  { key: 'kh', label: 'Khách hàng', def: 240, min: 90 },
  { key: 'st', label: 'Trạng thái', def: 120, min: 80 },
  { key: 'date', label: 'Ngày tạo', def: 110, min: 80 },
  { key: 'n', label: 'Bản nháp', def: 90, min: 70 },
]
export const BAR_DENSITY = [['compact', 'Gọn'], ['normal', 'Vừa'], ['wide', 'Rộng']]

/* Hàng tiêu đề Dạng thanh. Kéo mép phải một tiêu đề = đổi độ rộng cột đó; nhấp đúp mép = về độ rộng mặc định.
   Props: widths {key: px}, onResize(key, px) */
export function BarHeader({ widths, onResize }) {
  const drag = useRef(null)
  function down(e, c) {
    e.preventDefault()
    const cell = e.currentTarget.parentElement
    // vùng QS bị zoom: đổi px màn hình -> px CSS theo tỉ lệ bề rộng hiển thị / bề rộng CSS của ô
    const z = (cell.getBoundingClientRect().width / cell.offsetWidth) || 1
    drag.current = { key: c.key, min: c.min, x: e.clientX, w: widths[c.key], z }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e) {
    const d = drag.current
    if (!d) return
    onResize(d.key, Math.min(800, Math.max(d.min, Math.round(d.w + (e.clientX - d.x) / d.z))))
  }
  const up = () => { drag.current = null }
  return (
    <div className="qs-dash-row-main qs-dash-bar-head" role="row">
      <span className="qs-dash-bar-sp" />
      {BAR_COLS.map(c => (
        <span key={c.key} className="qs-dash-bar-th" role="columnheader">
          {c.label}
          <span className="qs-dash-bar-rz" title="Kéo để đổi độ rộng cột · nhấp đúp: mặc định"
            onPointerDown={e => down(e, c)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onDoubleClick={() => onResize(c.key, c.def)} />
        </span>
      ))}
    </div>
  )
}

/* Dạng thanh: 1 dòng / dự án, chia cột theo BAR_COLS. Bấm dòng = mở / thu các bản nháp (DraftItem như trong thẻ);
   bấm tên = Thông tin dự án. Dự án chứa bản nháp đang mở thì mở sẵn. */
export function ProjectRow({ group: g, curMa }) {
  const key = g.drafts[0].maDA
  const hasCur = g.drafts.some(d => d.maDA === curMa)
  const [open, setOpen] = useState(hasCur)
  const sub = subOf_(g)
  const last = g.drafts[g.drafts.length - 1]
  const stop = e => e.stopPropagation()
  return (
    <div className={`qs-dash-row${hasCur ? ' cur' : ''}${open ? ' open' : ''}`}>
      <div className="qs-dash-row-main" onClick={() => setOpen(o => !o)} title={open ? 'Thu gọn bản nháp' : 'Xem các bản nháp'}>
        <span className="qs-dash-row-tg"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} /></span>
        <div className="qs-dash-project-icon qs-dash-row-icon"><Icon name="building" size={16} /></div>
        <div className="qs-dash-row-name">
          <span className="qs-dash-project-name qs-dash-click" title={'Xem thông tin dự án — ' + g.name} onClick={e => { stop(e); projInfoModal(key) }}>{g.name}</span>
        </div>
        <div className="qs-dash-project-sub" title={sub}>{sub}</div>
        <div className="qs-dash-row-st">{hasCur && <span className="qs-dash-using"><Icon name="check" size={13} stroke={2.4} />Đang dùng</span>}</div>
        <span className="qs-dash-row-date" title="Ngày tạo bản nháp mới nhất">{fmtDate(last.ngayTao)}</span>
        <div className="qs-dash-row-n"><span className="qs-dash-count">{g.drafts.length} bản</span></div>
        <span />
        <div className="qs-dash-row-acts">
          <DezonChip p={{ linkDezon: g.linkDezon, maDA: key }} cls="qs-dash-link" label={false} />
          <button type="button" className="qs-dash-row-del" title="Xoá cả dự án này (mọi bản nháp)" onClick={e => { stop(e); removeProjectGroup(key) }}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
      {open && (
        <div className="qs-dash-project-body qs-dash-row-body">
          {g.drafts.map((d, i) => <DraftItem key={d.maDA} draft={d} index={i} active={d.maDA === curMa} />)}
          <button type="button" className="qs-dash-add-draft" onClick={() => addDraft(key)}><Icon name="plus" size={14} />Thêm bản nháp</button>
        </div>
      )}
    </div>
  )
}

/* Biểu tượng: ô vuông nhỏ (biểu tượng + tên + khách hàng), bấm = Thông tin dự án như đầu thẻ.
   Góc biểu tượng ghi số bản nháp; dự án đang mở có viền + chấm xanh. */
export function ProjectTile({ group: g, curMa }) {
  const key = g.drafts[0].maDA
  const hasCur = g.drafts.some(d => d.maDA === curMa)
  return (
    <button type="button" className={`qs-dash-tile${hasCur ? ' cur' : ''}`} onClick={() => projInfoModal(key)}
      title={g.name + '\n' + subOf_(g) + '\n' + g.drafts.length + ' bản nháp' + (hasCur ? ' · đang dùng' : '')}>
      <span className="qs-dash-tile-icon">
        <Icon name="building" size={24} />
        <span className="qs-dash-tile-n">{g.drafts.length}</span>
        {hasCur && <span className="qs-dash-tile-dot" />}
      </span>
      <span className="qs-dash-tile-name">{g.name}</span>
      <span className="qs-dash-tile-sub">{g.khachHang || 'Chưa có khách hàng'}</span>
    </button>
  )
}
