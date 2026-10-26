import { useMemo, useRef } from 'react'
import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { cpTong_ } from '../../lib/totals.js'
import { money, safeUrl_ } from '../../lib/format.js'
import { dezonUrl_ } from '../../lib/dashModel.js'
import { useFold, foldToggle_, projCtx_, usePdState, pdRetry_ } from './projectShell'
import { projInfoModal, dezonSet_ } from './projectActions'
import { useQsStore } from '../../state/store'
import { setPcTotalsEl, setPcNodeEl, usePcAlignX } from './pcSlot'
import { useFitLevel } from '../common/useFitLevel'
import './project.css'

/* Băng thông tin dự án #pcard (port PUB/index.html:6643-6661, renderCard app.js:424-447; shot tab-boc.png).
   Một bản duy nhất, QS.jsx đặt trên các panel (ẩn ở dash/admin/sanpham/import/congty). Props: không có.
   Bấm băng = mở hộp Thông tin dự án; gập / mở nhớ ở qs_fold.pcard (chung với nút "Mở rộng bảng" của Bóc tách).
   Dạng gập dùng lại thanh .qs-bd-bar của bản clone. Số tiền chỉ hiện khi đã có projData của bản nháp (usePdState).
   Ở tab Bóc tách, băng mở rộng có chỗ trống .qs-pc-totals: SheetHeader đưa dải Chưa VAT / VAT / Tổng lên đây (pcSlot.js). */
export default function PCard() {
  const { cur, lines, projects, projData, selectProject, status } = useQs()
  const tab = useQsStore(s => s.tab)
  const alignX = usePcAlignX()
  const pd = usePdState(cur, status)
  const folded = useFold('pcard')
  const p = cur || {}
  const pct = Math.max(0, Math.min(100, Number(p.tienDo) || 0))
  // đúng số tab Chi phí: gồm Phần thô, đã trừ CK báo giá (cpTong_ với hm = '')
  const TT = useMemo(() => (cur ? cpTong_(lines || [], '', projCtx_(cur, projData)) : null), [cur, lines, projData])
  /* Băng thiếu chỗ thì gọn dần theo mức data-fit 0..4 (project.css): đo tràn chữ ở các cụm, nút, tên hạng mục */
  const bandRef = useRef(null)
  useFitLevel(bandRef, 4, '.qs-pc-mod, .qs-pc-main, .qs-pc-node, .qs-bd-node-lbl, .qs-bd-category b, .qs-bd-seg button, .qs-bd-cols-label', [folded, tab])

  const openInfo = () => { if (cur) projInfoModal(cur.maDA) }
  const stop = e => e.stopPropagation()
  /* Ô chọn dự án đứng ở đầu băng, thay cho tên dự án (tên đang chọn hiện ngay trong ô) */
  const sel = (
    <select
      className={folded ? 'qs-bd-bar-select qs-pc-sel-title' : 'qs-pc-sel qs-pc-sel-title'}
      title="Đổi dự án đang làm việc"
      onClick={stop}
      value={cur ? cur.maDA : ''}
      onChange={e => selectProject(e.target.value)}
    >
      {projects.length
        ? projects.map(x => <option key={x.maDA} value={x.maDA}>{x.ten}</option>)
        : <option value="">— Chưa có dự án —</option>}
    </select>
  )
  const fold = (
    <button type="button" className={folded ? 'qs-bd-bar-toggle' : 'qs-pc-fold'} title="Thu gọn / mở băng thông tin dự án"
      aria-label="Thu gọn băng dự án" onClick={e => { e.stopPropagation(); foldToggle_('pcard') }}>
      <Icon name={folded ? 'chevronDown' : 'chevronUp'} size={14} />
    </button>
  )
  const dz = cur ? <DezonChip p={cur} cls={folded ? 'qs-bd-bar-link' : 'qs-pc-dz'} /> : null

  if (folded) {
    return (
      <div className="qs-bd-bar qs-pc-folded">
        <span className="qs-pc-proj-f" onClick={stop}>{sel}</span>
        <button type="button" className="qs-pc-edit" title="Sửa thông tin dự án" aria-label="Sửa thông tin dự án" onClick={openInfo}><Icon name="edit" size={13} /></button>
        <span className="qs-bd-bar-status">{p.trangThai || 'Bản nháp'}</span>
        {dz}
        <span style={{ flex: 1 }} />
        <span className="qs-bd-bar-pct">{pct}%</span>
        {fold}
      </div>
    )
  }

  return (
    <div className="qs-pc" ref={bandRef}>
      {/* Bóc tách: khối tên dự án rộng tới mép trái của bảng bên dưới (trừ đệm trái 14 + khe 23 của .qs-pc, project.css) để các module
          Hạng mục đã bóc · kiểu bảng · cột · tiền nằm gọn trong bề ngang của bảng, thẳng mép bảng */}
      <div className={`qs-pc-main${tab === 'boc' ? ' has-node' : ''}`}
        style={tab === 'boc' && alignX ? { '--pc-align': Math.max(170, alignX - 37) + 'px' } : undefined}>
        <div className="qs-pc-top">
          <span className="qs-pc-proj" onClick={stop}>{sel}</span>
          <span className="qs-pc-status">{p.trangThai || 'Bản nháp'}</span>
          <button type="button" className="qs-pc-edit" title="Sửa thông tin dự án" aria-label="Sửa thông tin dự án" onClick={openInfo}><Icon name="edit" size={14} /></button>
        </div>
      </div>
      {tab === 'boc' && <div className="qs-pc-node" ref={setPcNodeEl} onClick={stop} />}
      {/* Module 4 (tiền): Chưa VAT · Tổng (VAT) (Bóc tách đưa vào .qs-pc-totals) · Lợi nhuận · % Lợi nhuận, chung 1 khung */}
      <div className="qs-pc-mod qs-pc-money">
        {tab === 'boc' && <div className="qs-pc-totals" ref={setPcTotalsEl} onClick={stop} />}
        <div className="qs-pc-kpi">
          {TT && (
            <>
              {pd.ready
                ? (
                  <>
                    <div className="qs-pc-k"><span className="kv">{money(TT.net - TT.von)}đ</span><span className="kl">Lợi nhuận</span></div>
                    <div className="qs-pc-k" title="Lợi nhuận / doanh thu chưa VAT (đã trừ chiết khấu báo giá)">
                      <span className="kv">{(Math.round(TT.bien * 10) / 10).toLocaleString('vi-VN')}%</span><span className="kl">% Lợi nhuận</span>
                    </div>
                    {TT.ptErr && <div className="qs-pc-k qs-pc-err" title={TT.ptErr}><span className="kv">!</span><span className="kl">Phần thô lỗi, chưa tính</span></div>}
                  </>
                )
                : (
                  <div className={`qs-pc-k${pd.err ? ' qs-pc-err' : ''}`} title={pd.err || 'Đang tải dữ liệu dự án (Phần thô, chiết khấu báo giá)'}>
                    <span className="kv">{pd.err ? 'Lỗi tải dữ liệu' : 'Đang tải…'}</span>
                    {(pd.err || pd.slow)
                      ? <button type="button" className="qs-pc-retry" onClick={e => { e.stopPropagation(); pdRetry_(cur.maDA) }}>Thử lại</button>
                      : <span className="kl">Lợi nhuận</span>}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
      {fold}
    </div>
  )
}

/* Chip link bài dự án trên dezon.vn (port dezonChip_, PUB/dash.js:12-20): đã gắn -> mở bài; chưa -> bấm để dán link */
export function DezonChip({ p, cls, label = true }) {
  const u = String((p && p.linkDezon) || '').trim()
  if (u) {
    return (
      <a className={`${cls} on`} href={safeUrl_(dezonUrl_(u))} target="_blank" rel="noopener noreferrer"
        title={'Mở bài dự án trên dezon.vn — ' + dezonUrl_(u)} onClick={e => e.stopPropagation()}>
        <Icon name="link" size={label ? 10 : 13} />{label && 'Dezon'}
      </a>
    )
  }
  return (
    <button type="button" className={cls} title="Chưa gắn link bài dự án trên dezon.vn — bấm để dán link"
      onClick={e => { e.stopPropagation(); dezonSet_(p.maDA) }}>
      <Icon name="link" size={label ? 10 : 13} />{label && 'Gắn link'}
    </button>
  )
}
