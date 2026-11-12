import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import StatusView from '../common/StatusView'
import Pop, { PopHead } from '../breakdown/sheet/Pop'
import { getState } from '../../state/store'
import { useQs } from '../../state/QsData'
import { usePdState, pdRetry_, foldToggle_ } from '../project/projectShell'
import { usePhanTho, usePtTemplate } from './ptHooks'
import { usePtUi, setPtUi } from './ptState'
import { PT_COLS, ptPresetCols_ } from './ptModel'
import {
  ptOnKeys, ptSameMap, ptMyCols, ptSaveMine, ptClearMine, ptApplyMine, ptApplyMineOnce, ptMyPresets, ptApplyCustom,
  ptMyOrder, ptPresetRows, ptStartEdit, ptEndEdit, ptCancelEdit, ptSaveEditNew, ptSaveEditOver, ptCommitDock,
} from './ptPresets'
import PtSheet from './PtSheet'
import './phantho.css'

/* Đề mục 3.1 Phần thô trong tab Bóc tách (port renderPhanTho / renderPTLibrary / ptShowDetail_, PUB/phantho.js).
   Props: tools (tuỳ chọn: nút "Vừa thêm" + "Cập nhật giá" của BreakdownTab, như dải công cụ tkToolsSync_ boc.js:1643-1645
   vẫn hiện ở 3.1). Bên phải: bảng ước tính PtSheet (Bảng tính; Bảng thường = PtSheet plain, theo qs_bt_mode như
   btCheDo_ bangtinh.js:10). Thư viện công tác + các bước chọn + panel thông tin công tác là các component riêng
   (PtLibrary.jsx, PtDetail.jsx) do BreakdownTab cắm vào CatalogPanel (prop ptCount / ptFilters / ptLib) và cạnh cột phải.
   Bố cục đồng bộ với tab Thiết bị đèn: dải chip cột là module riêng (PtColsModule, BreakdownTab đặt trên khối công cụ),
   bảng trống cũng vẽ bằng PtSheet (lời nhắc thay lưới như tkSheetTrong_).
   usePtTotals() -> {count, grand, vatPct, vat, afterTax} cho dòng tổng ở đầu bảng (ptTotalsBar_ 2331-2338, tkCount 2287). */

/* Dải chip cột Phần thô: cùng dáng / cùng việc ColsStrip của Bóc tách: chip bật / tắt, "Hiện tất cả" bật / tắt
   (tắt = về bộ của tôi), nút sửa -> "Tạo mới" / "Lưu đè" / "Huỷ". Đóng = gập fold 'cols' (huỷ phần đang sửa) */
export function PtColsModule() {
  const ui = usePtUi()
  const [overAt, setOverAt] = useState(null)   // nút "Lưu đè…" đang mở danh sách bộ
  useEffect(() => () => ptCancelEdit(), [])    // gập dải / rời 3.1 khi đang sửa = huỷ
  const editing = ui.colEdit
  const allOn = PT_COLS.every(c => ui.cols[c[0]])
  const mine = ptMyCols()
  const soLoc = Object.keys(ui.filter || {}).length
  const presets = ptMyPresets()
  return (
    <div className="qs-bd-strip qs-bd-colmod">
      {PT_COLS.map(c => (
        <button key={c[0]} className={`qs-bd-strip-chip qs-colchip${ui.cols[c[0]] ? ' on' : ''}`} aria-pressed={!!ui.cols[c[0]]}
          onClick={() => setPtUi(s => ({ cols: { ...s.cols, [c[0]]: !s.cols[c[0]] } }))}>{c[1]}</button>
      ))}
      <span className="qs-colchip-sep" aria-hidden="true" />
      <button className={`qs-bd-strip-btn qs-colchip-act${allOn ? ' on' : ''}`} aria-pressed={allOn} disabled={allOn && !mine}
        title={allOn ? (mine ? 'Đang hiện tất cả cột — bấm để về bộ của tôi' : 'Đang hiện tất cả cột') : 'Hiện tất cả cột'}
        onClick={() => (allOn ? ptApplyMine() : setPtUi({ cols: ptPresetCols_(null) }))}>Hiện tất cả</button>
      {editing ? (
        <>
          <button className="qs-bd-strip-btn qs-colchip-save" title="Lưu các cột đang bật thành bộ mới (đặt tên)" onClick={ptSaveEditNew}><Icon name="plus" size={13} /> Tạo mới</button>
          {editing.from
            ? <button className="qs-bd-strip-btn qs-colchip-save alt" title={'Ghi đè bộ "' + editing.from + '" bằng các cột đang bật'} onClick={() => ptSaveEditOver(editing.from)}><Icon name="check" size={13} /> Lưu đè "{editing.from}"</button>
            : <button className="qs-bd-strip-btn qs-colchip-save alt" title="Ghi đè 1 bộ có sẵn bằng các cột đang bật" onClick={e => setOverAt(overAt ? null : e.currentTarget)}><Icon name="check" size={13} /> Lưu đè… <Icon name="chevronDown" size={13} /></button>}
          <button className="qs-bd-strip-btn qs-colchip-act" onClick={ptCancelEdit}>Huỷ</button>
          {overAt && (
            <Pop anchor={overAt} width={260} onClose={() => setOverAt(null)}>
              <PopHead title="Lưu đè lên bộ" onClose={() => setOverAt(null)} />
              <div className="qs-tk-bgtb">
                <div className="qs-tk-bgti tkmine" onClick={() => { setOverAt(null); ptSaveEditOver(null) }}>
                  <span className="nm"><Icon name="check" size={13} /> Của tôi</span><span className="cn">mặc định</span>
                </div>
                {presets.map(p => (
                  <div key={p.name} className="qs-tk-bgti" onClick={() => { setOverAt(null); ptSaveEditOver(p.name) }}>
                    <span className="nm">{p.name}</span><span className="cn">{p.cols.length} cột</span>
                  </div>
                ))}
                {!presets.length && <div className="qs-tk-overnote">Chưa có bộ tự đặt — dùng "Tạo mới". Bộ dựng sẵn (Nhà thầu, Tối giản…) không ghi đè được.</div>}
              </div>
            </Pop>
          )}
        </>
      ) : (
        <button className="qs-bd-strip-btn qs-colchip-act qs-colchip-edit" title="Sửa bộ cột: bật / tắt chip rồi lưu thành bộ chọn nhanh mới" onClick={() => ptStartEdit()}><Icon name="edit" size={14} /></button>
      )}
      {soLoc > 0 && <button className="qs-bd-strip-btn qs-colchip-act on" title="Bỏ mọi bộ lọc cột" onClick={() => setPtUi({ filter: {} })}>Đang lọc {soLoc} cột ✕</button>}
      <span style={{ flex: 1 }} />
      <button className="qs-bd-strip-close" title={editing ? 'Đóng (huỷ phần đang sửa)' : 'Đóng'} onClick={() => { ptCancelEdit(); foldToggle_('cols') }}><Icon name="x" size={15} /></button>
    </div>
  )
}

function Tag({ icon, cls, title, children }) { return <span className={`qs-tk-quicktag${cls ? ' ' + cls : ''}`} title={title}><Icon name={icon} size={11} /> {children}</span> }

/* Nút thao tác của 1 dòng (chỉ hiện ở chế độ sửa): sửa · đặt mặc định · xoá */
function RowActs({ onEdit, defOn, onDefault, onDelete }) {
  const b = (icon, title, fn, cls = '') => (
    <button type="button" className={`qs-tk-bgact${cls}`} title={title} onClick={e => { e.stopPropagation(); fn() }}><Icon name={icon} size={13} /></button>
  )
  return (
    <span className="qs-tk-bgacts">
      {onEdit && b('edit', 'Sửa các cột của bộ này (mở dải chip)', onEdit)}
      {onDefault && b('check', defOn ? 'Đang là mặc định của tôi' : 'Đặt làm mặc định của tôi', onDefault, defOn ? ' on' : '')}
      {onDelete && b('x', 'Xoá bộ cột này', onDelete, ' del')}
    </span>
  )
}

const NO_CHANGE = { order: null, del: new Set(), def: undefined }

/* Khung dọc "Chọn nhanh cột" của Phần thô, cùng việc PresetDock của Bóc tách: bấm 1 bộ để áp, khung không đóng.
   Nút sửa (bút chì): bật chế độ sửa của dải chip + của khung: kéo sắp xếp, tích chọn / xoá, đặt mặc định;
   chỉ ghi nháp, "Lưu" mới ghi, "Hoàn tác" bỏ hết. Lưu theo tài khoản (ptPresets.js). Mở / đóng cùng dải chip (fold 'cols') */
export function PtPresetDock({ width, onClose }) {
  const ui = usePtUi()
  const me = getState().me
  const [editing, setEditing] = useState(false)
  const [ch, setCh] = useState(NO_CHANGE)
  const [picked, setPicked] = useState(() => new Set())   // ô đã tích; 'mine' = bộ "Của tôi"
  const [over, setOver] = useState(null)                  // {id, after}: vạch báo chỗ thả
  const dragId = useRef(null)

  const savedMine = ptMyCols()
  const mineGone = ch.del.has('mine')
  const mine = mineGone ? null : savedMine
  const mineMap = mine ? ptPresetCols_(mine) : null
  const mineOn = !!mineMap && ptSameMap(mineMap, ui.cols)
  const rows = ptPresetRows(ch.order || ptMyOrder()).filter(r => !ch.del.has(r.id))
  const defMap = ch.def !== undefined ? (rows.find(r => r.id === ch.def) || {}).map : mineMap
  const ids = rows.map(r => r.id)
  const nChange = (ch.order ? 1 : 0) + ch.del.size + (ch.def !== undefined ? 1 : 0)

  const patch = p => setCh(c => ({ ...c, ...p }))
  const togglePick = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const stageDel = list => { patch({ del: new Set([...ch.del, ...list]) }); setPicked(new Set()) }
  function reset() { setCh(NO_CHANGE); setPicked(new Set()); setOver(null); setEditing(false) }
  function begin() { if (!editing) { setEditing(true); ptStartEdit() } }
  async function save() {
    const delNames = [...ch.del].filter(id => id.indexOf('u:') === 0).map(id => id.slice(2))
    const defRow = ch.def !== undefined ? ptPresetRows().find(r => r.id === ch.def) : null
    const ok = await ptCommitDock({ delNames, delMine: mineGone, defKeys: defRow ? defRow.keys : undefined, order: ch.order })
    if (!ok) return
    reset(); ptEndEdit()
  }
  function undo() { reset(); ptCancelEdit() }

  function onDrop(e, id) {
    e.preventDefault()
    const from = dragId.current; dragId.current = null; setOver(null)
    if (!from || from === id) return
    const o = ids.filter(x => x !== from)
    o.splice(o.indexOf(id) + (over && over.after ? 1 : 0), 0, from)
    patch({ order: o })
  }
  const dragProps = id => (editing ? {
    draggable: true,
    onDragStart: e => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id) } catch (er) { /* bỏ qua */ } },
    onDragOver: e => { e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); const after = e.clientY > b.top + b.height / 2; if (!over || over.id !== id || over.after !== after) setOver({ id, after }) },
    onDragEnd: () => { dragId.current = null; setOver(null) },
    onDrop: e => onDrop(e, id),
  } : {})
  const dropCls = id => (over && over.id === id ? (over.after ? ' drop-after' : ' drop-before') : '')
  const check = (id, can) => editing && (
    <input type="checkbox" className="qs-tk-bgchk" disabled={!can} checked={picked.has(id)} title={can ? 'Chọn để xoá' : 'Bộ dựng sẵn không xoá được'}
      onClick={e => e.stopPropagation()} onChange={() => togglePick(id)} />
  )

  return (
    <aside className={`qs-card qs-tk-dock${editing ? ' editing' : ''}`} style={width ? { width } : undefined} aria-label="Chọn nhanh cột">
      <div className="qs-tkp-h">
        <b>{editing ? 'Sửa bộ cột' : 'Chọn nhanh cột'}</b>
        <button type="button" className={`qsc-x qs-tk-dockedit${editing ? ' on' : ''}`} title={editing ? 'Đang sửa — Lưu hoặc Hoàn tác ở cuối khung' : 'Sửa: bật / tắt chip, sắp xếp, xoá, đặt mặc định'} onClick={begin}><Icon name="edit" size={13} /></button>
        <button type="button" className="qsc-x" onClick={() => { if (editing) undo(); onClose() }}>✕</button>
      </div>
      <div className="qs-tk-bgtb">
        {mine && (
          <div className={`qs-tk-bgti tkmine${mineOn ? ' on' : ''}`} onClick={editing ? () => togglePick('mine') : ptApplyMine}>
            {check('mine', true)}
            <span className="nm"><Icon name="check" size={13} /> Của tôi <i className="qs-tk-mineu">{(me && me.username) || ''}</i></span>
            {editing && <RowActs onEdit={() => ptStartEdit({ cols: mineMap })} onDelete={() => stageDel(['mine'])} />}
            <span className="cn">{mine.length} cột</span><span className={`rd${mineOn ? ' on' : ''}`} />
          </div>
        )}
        {rows.map(r => {
          const on = ptSameMap(r.map, ui.cols)
          const isDef = !!defMap && ptSameMap(defMap, r.map)
          const click = editing ? (r.custom ? () => togglePick(r.id) : undefined) : (r.custom ? () => ptApplyCustom(r.p) : () => setPtUi({ cols: { ...r.map } }))
          return (
            <div key={r.id} className={`qs-tk-bgti${r.custom ? ' tkuser' : ''}${on ? ' on' : ''}${dropCls(r.id)}`} onClick={click} {...dragProps(r.id)}>
              {editing && <span className="qs-tk-grip" title="Kéo để sắp xếp" aria-hidden="true">⋮⋮</span>}
              {check(r.id, r.custom)}
              <span className="nm">
                {r.name}
                {isDef && <Tag icon="check" cls="def" title="Bộ mặc định của tôi (tự áp khi mở Phần thô)">Mặc định của tôi</Tag>}
              </span>
              {editing && (
                <RowActs
                  onEdit={() => ptStartEdit(r.custom ? { cols: r.map, name: r.name, from: r.name } : { cols: r.map, name: r.name + ' (của tôi)' })}
                  defOn={isDef} onDefault={() => { if (!isDef) patch({ def: r.id }) }}
                  onDelete={r.custom ? () => stageDel([r.id]) : null} />
              )}
              <span className="cn">{r.keys.length} cột</span><span className={`rd${on ? ' on' : ''}`} />
            </div>
          )
        })}
      </div>
      {editing ? (
        <div className="qs-tk-minef">
          <button className="qsc-btn blue" onClick={save}><Icon name="check" size={13} /> Lưu{nChange ? ' (' + nChange + ' thay đổi)' : ''}</button>
          <button className="qsc-btn" onClick={undo}><Icon name="undo" size={13} /> Hoàn tác</button>
          {picked.size > 0 && <button className="qsc-btn qs-tk-delsel" onClick={() => stageDel([...picked])}><Icon name="trash" size={13} /> Xoá {picked.size} bộ đã chọn</button>}
          <div className="qs-tk-minen">Kéo ⋮⋮ để sắp xếp, tích ô vuông để chọn bộ cần xoá (bộ dựng sẵn không xoá được). Bật / tắt chip ở dải trên rồi "Tạo mới" hoặc "Lưu đè". Các thay đổi chỉ ghi khi bấm Lưu. Lưu theo tài khoản.</div>
        </div>
      ) : (
        <div className="qs-tk-minef">
          <button className="qsc-btn blue" disabled={mineOn} title={mineOn ? 'Bộ cột đang hiện đã là bộ của bạn' : undefined} onClick={() => ptSaveMine()}>
            <Icon name="check" size={13} /> Lưu {ptOnKeys(ui.cols).length} cột đang hiện làm bộ của tôi
          </button>
          {mine && <button className="qsc-btn" onClick={ptClearMine}>Xoá bộ của tôi</button>}
        </div>
      )}
    </aside>
  )
}

export function usePtTotals() {
  const d = usePhanTho()
  const c = d.comp || { grand: 0, vatPct: 0, vat: 0, afterTax: 0 }
  const count = d.phanTho.reduce((s, se) => s + ((se.items || []).length), 0)
  return { count, grand: c.grand, vatPct: c.vatPct, vat: c.vat, afterTax: c.afterTax }
}

function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }

export default function PhanThoPanel({ tools, toolsSlot } = {}) {
  const qs = useQs()
  const { cur, status } = qs
  const visible = qs.panelVisible('boc')
  const data = usePhanTho()
  const tpl = usePtTemplate()
  const pd = usePdState(cur, status)
  const view = lsGet('qs_bt_mode') === 'cu' ? 'plain' : 'sheet'

  // Đổi dự án: bỏ chọn dòng / công tác đang mở của dự án cũ
  const ma = cur ? cur.maDA : ''
  useEffect(() => { setPtUi({ sel: {}, anchor: null, newRow: null, frzRows: 0 }) }, [ma])
  // Lần đầu mở Phần thô của 1 tài khoản: áp bộ cột "Của tôi" (mặc định của tôi) nếu đã lưu
  const uname = (getState().me || {}).username
  useEffect(() => { ptApplyMineOnce() }, [uname])

  let main
  if (!cur) main = <div className="qspt-nocur">Chưa chọn dự án.</div>
  else if (data.err) main = <StatusView kind="error" title="Không đọc được bảng Phần thô" message={data.err} />
  else if (!pd.ready) {
    main = pd.err
      ? <StatusView kind="error" title="Không tải được dữ liệu dự án" message={pd.err} onRetry={() => pdRetry_(cur.maDA)} />
      : <StatusView kind="loading" message="Đang tải bảng Phần thô…" />
  } else main = <PtSheet data={data} tpl={tpl} visible={visible} tools={tools} toolsSlot={toolsSlot} plain={view === 'plain'} />
  // có bảng: khung ngoài trong suốt, PtSheet tự là thẻ .qs-bd-sheet như tab Thiết bị đèn (không lồng thẻ trong thẻ)
  const bare = !!cur && !data.err && pd.ready

  return (
    <div className={`qspt-card${bare ? ' bare' : ' qs-card'}`} data-pt-view={view}>
      {main}
    </div>
  )
}
