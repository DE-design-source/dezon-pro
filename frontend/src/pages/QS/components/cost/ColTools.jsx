import { useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import Pop, { PopHead } from '../breakdown/sheet/Pop'
import { COLSET, csPresetList_, csPresetKeys_, csPresetOn_, csMyOn_, csMyApply_, csDangBat_, csQuickLabel_, cpLabel_ } from '../../lib/columns.js'
import { getState } from '../../state/store'
import { applyPreset, applyMine, saveMine, clearMine, myCols, colAll, toggleCol, setColsMap } from './cpCols'

/* Hàng "Cột hiển thị" của Chi phí / Dự án (pgColFrame_ PUB/chiphi.js:50-60, cpColBar_ / daColBar_ dash.js:235-248):
   nút gập chip cột (qs_fold.cols) + nút "Chọn nhanh" (csQuickBtn_ app.js:1733-1740) chung 1 khung, như Bóc tách
   ("Hiện tất cả" nằm cuối dải chip, ColChips).
   Props: t ('cp' | 'da'), cols (map cột đang bật), foldCols (bool), onFoldCols(), presetOpen, onPreset(ev),
   bar (đặt trên băng dự án: nút bộ cột chỉ còn biểu tượng, tên bộ + số cột ở chú thích như Bóc tách) */
export function ColFrame({ t, cols, foldCols, onFoldCols, presetOpen, onPreset, bar }) {
  const tab = COLSET[t]
  const q = csQuickLabel_(tab, cols, myCols(t))
  return (
    <>
      {/* Cột hiển thị + chọn nhanh bộ cột chung 1 khung (.qs-colmod) */}
      <span className="qs-colmod" role="group" aria-label="Cột hiển thị">
        <button className={`qs-bd-cols-label${foldCols ? '' : ' on'}`} title="Ẩn / hiện các chip cột" onClick={onFoldCols}>
          Cột hiển thị <span>{q.on}/{q.total}</span><Icon name={foldCols ? 'chevronDown' : 'chevronUp'} size={15} />
        </button>
        <button className={`qs-bd-preset${presetOpen ? ' on' : ''}${bar ? ' icon-only' : ''}`} onClick={onPreset}
          title={bar ? 'Chọn nhanh bộ cột — đang dùng: ' + q.nhan + ' ' + q.on + '/' + q.total : 'Bật cả một bộ cột theo mục đích / bộ cột của tôi'}>
          <Icon name="sliders" size={bar ? 15 : 13} />{!bar && <>{q.nhan} {q.on}/{q.total}<span className="qs-bd-caret" /></>}
        </button>
      </span>
    </>
  )
}

/* Dải chip cột - cùng dáng dải chip của Bóc tách (breakdown/sheet/ColsTools ColsStrip): chip vuông chữ hoa (.qs-colchip),
   vạch ngăn, "Hiện tất cả" bật / tắt (tắt = về bộ của tôi, chưa có thì Mặc định).
   Trả về các phần tử rời: người gọi bọc trong .qs-bd-strip (dải trên bảng: thêm .qs-bd-colmod + nút đóng) */
export function ColChips({ t, cols }) {
  const keys = COLSET[t].keys()
  const allOn = keys.every(k => cols[k])
  return (
    <>
      {keys.map(k => (
        <button key={k} className={`qs-bd-strip-chip qs-colchip${cols[k] ? ' on' : ''}`} aria-pressed={!!cols[k]} onClick={() => toggleCol(t, k)}>{cpLabel_(k)}</button>
      ))}
      <span className="qs-colchip-sep" aria-hidden="true" />
      <button className={`qs-bd-strip-btn qs-colchip-act${allOn ? ' on' : ''}`} aria-pressed={allOn}
        title={allOn ? 'Đang hiện tất cả cột — bấm để về bộ mặc định' : 'Hiện tất cả cột'}
        onClick={() => (allOn ? setColsMap(t, csMyApply_(COLSET[t], myCols(t))) : colAll(t, 1))}>Hiện tất cả</button>
    </>
  )
}

/* Module dải chip cột (khung riêng trên khối công cụ, như Bóc tách); onClose = đóng cả dải + khung Chọn nhanh cột */
export function ColChipsModule({ t, cols, onClose }) {
  return (
    <div className="qs-bd-strip qs-bd-colmod qs-cp-colmod">
      <ColChips t={t} cols={cols} />
      <span style={{ flex: 1 }} />
      <button className="qs-bd-strip-close" title="Đóng" onClick={onClose}><Icon name="x" size={15} /></button>
    </div>
  )
}

/* Danh sách bộ cột + nút lưu "của tôi" (csPresetPop_ PUB/app.js:1747-1782) cho bảng t; done() chạy sau mỗi thao tác
   (hộp nổi: đóng; khung dọc: giữ mở để thử nhiều bộ liền) */
function PresetBody({ t, cols, done, foot = true }) {
  const tab = COLSET[t]
  const me = getState().me
  const mine = myCols(t)
  const mineOn = csMyOn_(tab, mine, cols)
  const dem = csDangBat_(tab, cols).length
  const run = fn => () => { fn(); done() }
  return (
    <>
      <div className="qs-tk-bgtb">
        {mine && (
          <div className={`qs-tk-bgti tkmine${mineOn ? ' on' : ''}`} onClick={run(() => applyMine(t))}>
            <span className="nm"><Icon name="check" size={13} /> Của tôi <i className="qs-tk-mineu">{(me && me.username) || ''}</i></span>
            <span className="cn">{mine.length} cột</span><span className={`rd${mineOn ? ' on' : ''}`} />
          </div>
        )}
        {csPresetList_(tab).map(ps => {
          const on = csPresetOn_(tab, ps, cols)
          return (
            <div key={ps[0]} className={`qs-tk-bgti${on ? ' on' : ''}`} onClick={run(() => applyPreset(t, ps[0], ps[1]))}>
              <span className="nm">{ps[1]}</span><span className="cn">{csPresetKeys_(tab, ps).length} cột</span><span className={`rd${on ? ' on' : ''}`} />
            </div>
          )
        })}
      </div>
      {foot && <div className="qs-tk-minef">
        <button className="qsc-btn blue" disabled={mineOn} title={mineOn ? 'Bộ cột đang hiện đã là bộ của bạn' : undefined} onClick={run(() => saveMine(t))}>
          <Icon name="check" size={13} /> Lưu {dem} cột đang hiện làm mặc định của tôi
        </button>
        {mine && <button className="qsc-btn" onClick={() => { done(); clearMine(t) }}>Xoá bộ của tôi</button>}
        <div className="qs-tk-minen">Lưu theo tài khoản — lần sau đăng nhập (kể cả máy khác) tự hiện đúng các cột này.</div>
      </div>}
    </>
  )
}

/* Bảng chọn nhanh bộ cột dạng hộp nổi (băng dự án đang gập) */
export function PresetPop({ t, anchor, cols, onClose }) {
  return (
    <Pop anchor={anchor} width={300} className="qs-tk-preset" onClose={onClose}>
      <PopHead title="Chọn nhanh cột" onClose={onClose} />
      <PresetBody t={t} cols={cols} done={onClose} />
    </Pop>
  )
}

/* Khung dọc "Chọn nhanh cột" bên trái vùng bảng (nút bộ cột trên băng dự án), cùng dáng khung của Bóc tách:
   bấm 1 bộ để áp, khung không đóng; nút bút chì = chế độ sửa: mở dải chip + hiện phần lưu / xoá bộ "Của tôi" ở cuối khung.
   onEdit(): mở dải chip cột */
export function PresetDock({ t, cols, onEdit, onClose }) {
  const [editing, setEditing] = useState(false)
  return (
    <aside className={`qs-card qs-tk-dock qs-cp-dock${editing ? ' editing' : ''}`} aria-label="Chọn nhanh cột">
      <div className="qs-tkp-h">
        <b>{editing ? 'Sửa bộ cột' : 'Chọn nhanh cột'}</b>
        <button type="button" className={`qsc-x qs-tk-dockedit${editing ? ' on' : ''}`}
          title={editing ? 'Thoát chế độ sửa' : 'Sửa: bật / tắt chip rồi lưu làm bộ cột của tôi'}
          onClick={() => { if (!editing && onEdit) onEdit(); setEditing(!editing) }}><Icon name="edit" size={13} /></button>
        <button type="button" className="qsc-x" onClick={onClose}>✕</button>
      </div>
      <PresetBody t={t} cols={cols} done={() => {}} foot={editing} />
    </aside>
  )
}
