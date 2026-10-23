import { useRef, useState } from 'react'
import Pop, { PopHead } from './Pop'
import Icon from '../../../../../components/ui/Icon'
import { COLSET, csPresetList_, csPresetKeys_, csPresetOn_, csPresetCols_, csMyOn_, csMyApply_, csDangBat_, csQuickLabel_ } from '../../../lib/columns.js'
import {
  applyPreset, applyMine, saveMine, clearMine, myCols, colAll, myPresets, applyCustom, quickId,
  startEdit, cancelEdit, saveEditNew, saveEditOver, myOrder, sortByOrder, commitDock, sameCols, setColsMap, setQuick,
} from './tkCols'
import { getState } from '../../../state/store'

const TK = COLSET.tk

/* Nhãn nút "Chọn nhanh" (csQuickBtn_ PUB/app.js:1733-1740): "Của tôi" / tên bộ đang khớp / tên bộ tự đặt / "Chọn nhanh" */
export function presetLabel(cols) {
  const nhan = csQuickLabel_(TK, cols, myCols()).nhan
  if (nhan !== 'Chọn nhanh') return nhan
  const p = myPresets().find(x => csMyOn_(TK, x.cols, cols))
  return p ? p.name : nhan
}

/* Các bộ (dựng sẵn + tự đặt) theo thứ tự người dùng đã kéo: {id, name, keys, map, custom} */
function presetRows(order) {
  const rows = [
    ...csPresetList_(TK).map(ps => ({ id: 'p:' + ps[0], ps, name: ps[1], keys: csPresetKeys_(TK, ps), map: csPresetCols_(TK, ps[0]), custom: false })),
    ...myPresets().map(p => ({ id: 'u:' + p.name, p, name: p.name, keys: p.cols, map: csMyApply_(TK, p.cols), custom: true })),
  ]
  const ids = sortByOrder(rows.map(r => r.id), order)
  return ids.map(id => rows.find(r => r.id === id))
}

/* Bảng chọn nhanh bộ cột (csPresetPop_ PUB/app.js:1747-1782): popup nhỏ (Xuất báo giá) */
export function PresetPopover({ anchor, cols, onClose }) {
  const me = getState().me
  const mine = myCols()
  const mineOn = csMyOn_(TK, mine, cols)
  const run = fn => () => { fn(); onClose() }
  return (
    <Pop anchor={anchor} width={300} className="qs-tk-preset" onClose={onClose}>
      <PopHead title="Chọn nhanh cột" onClose={onClose} />
      <div className="qs-tk-bgtb">
        {mine && (
          <div className={`qs-tk-bgti tkmine${mineOn ? ' on' : ''}`} onClick={run(applyMine)}>
            <span className="nm"><Icon name="check" size={13} /> Của tôi <i className="qs-tk-mineu">{(me && me.username) || ''}</i></span>
            <span className="cn">{mine.length} cột</span><span className={`rd${mineOn ? ' on' : ''}`} />
          </div>
        )}
        {presetRows().map(r => {
          const on = r.custom ? csMyOn_(TK, r.keys, cols) : csPresetOn_(TK, r.ps, cols)
          return (
            <div key={r.id} className={`qs-tk-bgti${on ? ' on' : ''}`} onClick={run(() => (r.custom ? applyCustom(r.p) : applyPreset(r.ps[0])))}>
              <span className="nm">{r.name}</span><span className="cn">{r.keys.length} cột</span><span className={`rd${on ? ' on' : ''}`} />
            </div>
          )
        })}
      </div>
      <div className="qs-tk-minef">
        <button className="qsc-btn blue" disabled={mineOn} title={mineOn ? 'Bộ cột đang hiện đã là bộ của bạn' : undefined} onClick={run(saveMine)}>
          <Icon name="check" size={13} /> Lưu {csDangBat_(TK, cols).length} cột đang hiện làm mặc định của tôi
        </button>
        {mine && <button className="qsc-btn" onClick={() => { onClose(); clearMine() }}>Xoá bộ của tôi</button>}
        <div className="qs-tk-minen">Lưu theo tài khoản — lần sau đăng nhập (kể cả máy khác) tự hiện đúng các cột này.</div>
      </div>
    </Pop>
  )
}

function Tag({ icon, cls, title, children }) { return <span className={`qs-tk-quicktag${cls ? ' ' + cls : ''}`} title={title}><Icon name={icon} size={11} /> {children}</span> }

/* Nút thao tác của 1 dòng (chỉ hiện ở chế độ sửa): sửa · đặt mặc định · gán nút nhanh · xoá */
function RowActs({ onEdit, defOn, onDefault, quickOn, onQuick, onDelete }) {
  const b = (icon, title, fn, cls = '') => (
    <button type="button" className={`qs-tk-bgact${cls}`} title={title} onClick={e => { e.stopPropagation(); fn() }}><Icon name={icon} size={13} /></button>
  )
  return (
    <span className="qs-tk-bgacts">
      {onEdit && b('edit', 'Sửa các cột của bộ này (mở dải chip)', onEdit)}
      {onDefault && b('check', defOn ? 'Đang là mặc định của tôi' : 'Đặt làm mặc định của tôi', onDefault, defOn ? ' on' : '')}
      {onQuick && b('sliders', quickOn ? 'Bỏ gán khỏi nút nhanh trên thanh công cụ' : 'Gán vào nút nhanh trên thanh công cụ', onQuick, quickOn ? ' on' : '')}
      {onDelete && b('x', 'Xoá bộ cột này', onDelete, ' del')}
    </span>
  )
}

const NO_CHANGE = { order: null, del: new Set(), def: undefined, quick: undefined }

/* Khung dọc "Chọn nhanh cột" bên trái vùng bảng (Bóc tách): bấm 1 bộ để áp, khung không đóng để thử nhiều bộ liền.
   Nút sửa (bút chì): mở dải chip ở chế độ sửa (cùng việc với nút sửa ở dải chip) + bật chế độ sửa của khung:
   kéo sắp xếp, tích chọn / xoá, đặt mặc định, gán nút nhanh — tất cả chỉ ghi nháp, "Lưu" mới ghi, "Hoàn tác" bỏ hết.
   onEdit(opts): mở dải chip ở chế độ sửa; onEndEdit(keep): thoát chế độ sửa của dải chip (keep = giữ cột đang hiện) */
export function PresetDock({ width, cols, onEdit, onEndEdit, onClose }) {
  const me = getState().me
  const [editing, setEditing] = useState(false)
  const [ch, setCh] = useState(NO_CHANGE)            // thay đổi nháp: thứ tự, bộ xoá, mặc định, nút nhanh
  const [picked, setPicked] = useState(() => new Set())   // ô đã tích; 'mine' = bộ "Của tôi"
  const [over, setOver] = useState(null)             // {id, after}: vạch báo chỗ thả
  const dragId = useRef(null)

  const savedMine = myCols()
  const mineGone = ch.del.has('mine')
  const mine = mineGone ? null : savedMine
  /* Gán nút nhanh ghi ngay (nút lên thanh công cụ liền); Hoàn tác trả lại nút nhanh lúc bắt đầu sửa */
  const quick = quickId()
  const quickAtBegin = useRef(undefined)
  const rows = presetRows(ch.order || myOrder()).filter(r => !ch.del.has(r.id))
  const defMap = ch.def !== undefined ? (rows.find(r => r.id === ch.def) || {}).map : (mine ? csMyApply_(TK, mine) : null)
  const ids = rows.map(r => r.id)
  const mineOn = csMyOn_(TK, mine, cols)
  const nChange = (ch.order ? 1 : 0) + ch.del.size + (ch.def !== undefined ? 1 : 0)

  const patch = p => setCh(c => ({ ...c, ...p }))
  const togglePick = id => setPicked(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const stageDel = list => { patch({ del: new Set([...ch.del, ...list]) }); setPicked(new Set()) }
  function reset() { setCh(NO_CHANGE); setPicked(new Set()); setOver(null); setEditing(false) }
  function begin() { if (!editing) { quickAtBegin.current = quickId(); setEditing(true); onEdit() } }
  async function save() {
    const delNames = [...ch.del].filter(id => id.indexOf('u:') === 0).map(id => id.slice(2))
    const defRow = ch.def !== undefined ? presetRows().find(r => r.id === ch.def) : null
    const ok = await commitDock({ delNames, delMine: mineGone, defKeys: defRow ? defRow.keys : undefined, order: ch.order })
    if (!ok) return
    reset(); onEndEdit(true)
  }
  function undo() {
    const q0 = quickAtBegin.current
    if (q0 !== undefined && q0 !== quickId()) setQuick(q0)
    reset(); onEndEdit(false)
  }

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
        <button type="button" className={`qsc-x qs-tk-dockedit${editing ? ' on' : ''}`} title={editing ? 'Đang sửa — Lưu hoặc Hoàn tác ở cuối khung' : 'Sửa: bật / tắt chip, sắp xếp, xoá, đặt mặc định, gán nút nhanh'} onClick={begin}><Icon name="edit" size={13} /></button>
        <button type="button" className="qsc-x" onClick={() => { if (editing) undo(); onClose() }}>✕</button>
      </div>
      <div className="qs-tk-bgtb">
        {mine && (
          <div className={`qs-tk-bgti tkmine${mineOn ? ' on' : ''}`} onClick={editing ? () => togglePick('mine') : applyMine}>
            {check('mine', true)}
            <span className="nm"><Icon name="check" size={13} /> Của tôi <i className="qs-tk-mineu">{(me && me.username) || ''}</i></span>
            {editing && <RowActs onEdit={() => onEdit({ cols: csMyApply_(TK, mine) })} onDelete={() => stageDel(['mine'])} />}
            <span className="cn">{mine.length} cột</span><span className={`rd${mineOn ? ' on' : ''}`} />
          </div>
        )}
        {rows.map(r => {
          const on = r.custom ? csMyOn_(TK, r.keys, cols) : csPresetOn_(TK, r.ps, cols)
          const isDef = !!defMap && sameCols(defMap, r.map)
          const click = editing ? (r.custom ? () => togglePick(r.id) : undefined) : (r.custom ? () => applyCustom(r.p) : () => applyPreset(r.ps[0]))
          return (
            <div key={r.id} className={`qs-tk-bgti${r.custom ? ' tkuser' : ''}${on ? ' on' : ''}${dropCls(r.id)}`} onClick={click} {...dragProps(r.id)}>
              {editing && <span className="qs-tk-grip" title="Kéo để sắp xếp" aria-hidden="true">⋮⋮</span>}
              {check(r.id, r.custom)}
              <span className="nm">
                {r.name}
                {isDef && <Tag icon="check" cls="def" title="Bộ mặc định của tôi (tự áp khi đăng nhập)">Mặc định của tôi</Tag>}
                {quick === r.id && <Tag icon="sliders" title="Gán vào nút nhanh trên thanh công cụ">Nút nhanh</Tag>}
              </span>
              {editing && (
                <RowActs
                  onEdit={() => onEdit(r.custom ? { cols: r.map, name: r.name, from: r.name } : { cols: r.map, name: r.name + ' (của tôi)' })}
                  defOn={isDef} onDefault={() => { if (!isDef) patch({ def: r.id }) }}
                  quickOn={quick === r.id} onQuick={() => setQuick(quick === r.id ? null : r.id)}
                  onDelete={r.custom ? () => stageDel([r.id]) : null} />
              )}
              <span className="cn">{r.keys.length} cột</span><span className={`rd${on ? ' on' : ''}`} />
            </div>
          )
        })}
      </div>
      {editing && (
        <div className="qs-tk-minef">
          <button className="qsc-btn blue" onClick={save}><Icon name="check" size={13} /> Lưu{nChange ? ' (' + nChange + ' thay đổi)' : ''}</button>
          <button className="qsc-btn" onClick={undo}><Icon name="undo" size={13} /> Hoàn tác</button>
          {picked.size > 0 && <button className="qsc-btn qs-tk-delsel" onClick={() => stageDel([...picked])}><Icon name="trash" size={13} /> Xoá {picked.size} bộ đã chọn</button>}
          <div className="qs-tk-minen">Kéo ⋮⋮ để sắp xếp, tích ô vuông để chọn bộ cần xoá (bộ dựng sẵn không xoá được). Gán nút nhanh ghi ngay; các thay đổi khác chỉ ghi khi bấm Lưu. Lưu theo tài khoản.</div>
        </div>
      )}
    </aside>
  )
}

/* Dải chip cột (renderColChips app.js:1791-1803) + "Hiện tất cả" bật / tắt (tkColAll_ 1836)
   + nút sửa: bật / tắt chip (bảng đổi theo ngay) rồi "Tạo mới" (đặt tên) hoặc "Lưu đè" lên bộ cũ; Huỷ trả lại cột cũ.
   editing = S.edit của tkCols (khung "Chọn nhanh cột" cũng mở được chế độ này) */
export function ColsStrip({ columns, cols, editing, onToggle }) {
  const [overAt, setOverAt] = useState(null)   // nút "Lưu đè…" đang mở danh sách bộ
  const allOn = columns.every(c => cols[c.key])
  return (
    <>
      {/* không ghi lại "Cột hiển thị n/N": số đã có ở nút Cột hiển thị trên đầu bảng (SheetHeader) */}
      {columns.map(c => (
        <button key={c.key} className={`qs-bd-strip-chip qs-colchip${cols[c.key] ? ' on' : ''}`} aria-pressed={!!cols[c.key]} onClick={() => onToggle(c.key)}>{c.label}</button>
      ))}
      {/* vạch ngăn + viền xanh: nút thao tác hàng loạt, khác với chip bật / tắt từng cột.
          "Hiện tất cả" bật / tắt: bật = hiện mọi cột; tắt = về bộ mặc định của tôi (chưa đặt thì bộ Mặc định) */}
      <span className="qs-colchip-sep" aria-hidden="true" />
      <button className={`qs-bd-strip-btn qs-colchip-act${allOn ? ' on' : ''}`} aria-pressed={allOn}
        title={allOn ? 'Đang hiện tất cả cột — bấm để về bộ mặc định' : 'Hiện tất cả cột'}
        onClick={() => (allOn ? setColsMap(csMyApply_(TK, myCols())) : colAll(1))}>Hiện tất cả</button>
      {editing ? (
        <>
          <button className="qs-bd-strip-btn qs-colchip-save" title="Lưu các cột đang bật thành bộ mới (đặt tên)" onClick={saveEditNew}><Icon name="plus" size={13} /> Tạo mới</button>
          {editing.from
            ? <button className="qs-bd-strip-btn qs-colchip-save alt" title={'Ghi đè bộ "' + editing.from + '" bằng các cột đang bật'} onClick={() => saveEditOver(editing.from)}><Icon name="check" size={13} /> Lưu đè "{editing.from}"</button>
            : <button className="qs-bd-strip-btn qs-colchip-save alt" title="Ghi đè 1 bộ có sẵn bằng các cột đang bật" onClick={e => setOverAt(overAt ? null : e.currentTarget)}><Icon name="check" size={13} /> Lưu đè… <Icon name="chevronDown" size={13} /></button>}
          <button className="qs-bd-strip-btn qs-colchip-act" onClick={cancelEdit}>Huỷ</button>
          {overAt && (
            <Pop anchor={overAt} width={260} onClose={() => setOverAt(null)}>
              <PopHead title="Lưu đè lên bộ" onClose={() => setOverAt(null)} />
              <div className="qs-tk-bgtb">
                <div className="qs-tk-bgti tkmine" onClick={() => { setOverAt(null); saveEditOver(null) }}>
                  <span className="nm"><Icon name="check" size={13} /> Của tôi</span><span className="cn">mặc định</span>
                </div>
                {myPresets().map(p => (
                  <div key={p.name} className="qs-tk-bgti" onClick={() => { setOverAt(null); saveEditOver(p.name) }}>
                    <span className="nm">{p.name}</span><span className="cn">{p.cols.length} cột</span>
                  </div>
                ))}
                {!myPresets().length && <div className="qs-tk-overnote">Chưa có bộ tự đặt — dùng "Tạo mới". Bộ dựng sẵn (Mặc định, Tối giản…) không ghi đè được.</div>}
              </div>
            </Pop>
          )}
        </>
      ) : (
        <button className="qs-bd-strip-btn qs-colchip-act qs-colchip-edit" title="Sửa bộ cột: bật / tắt chip rồi lưu thành bộ chọn nhanh mới" onClick={() => startEdit()}><Icon name="edit" size={14} /></button>
      )}
    </>
  )
}
