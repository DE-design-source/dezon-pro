import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { FLOOR_PRESETS, ROOM_PRESETS } from '../../lib/columns.js'

const MODES = {
  floor: { label: 'Thêm tầng', icon: 'layers', presets: FLOOR_PRESETS, placeholder: 'Tên tầng khác...', hint: 'Bấm chip để thêm nhanh · thêm được nhiều tầng liên tiếp.' },
  room: { label: 'Thêm phòng', icon: 'building', presets: ROOM_PRESETS, placeholder: 'Tên phòng khác...', hint: 'Bấm chip để thêm nhanh · thêm được nhiều phòng liên tiếp.\nPhòng cũng là một khối trong bảng — kéo dòng vào như tầng.' },
}

/* Nút "Thêm tầng / phòng" kèm hộp chọn nhanh (openAddFloor / addFloorPopInner_ PUB/boc.js:168-191).
   existing: tên các khối đã có trong bảng (chip đánh dấu ✓). Như bản gốc mọi chip / tên gõ đều gọi onAdd:
   tầng đã có thì bên gọi (addFloorName) chuyển sang "đang thêm" và báo. openKey (tuỳ chọn): đổi giá trị = mở hộp
   (mục "Thêm tầng / phòng" của menu chuột phải Bảng tính). */
export default function GroupAdder({ existing, onAdd, openKey }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('floor')
  const [text, setText] = useState('')
  const boxRef = useRef(null)
  const m = MODES[mode]
  useEffect(() => { if (openKey) setOpen(true) }, [openKey])

  /* Bấm ra ngoài hoặc nhấn Esc thì đóng hộp */
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  function addCustom() {
    const name = text.trim().toUpperCase()
    if (!name) return
    onAdd(name)
    setText('')
  }

  return (
    <div className="qs-bd-adder" ref={boxRef}>
      {open && (
        <div className="qs-bd-adder-pop">
          <div className="qs-bd-adder-tabs">
            {Object.entries(MODES).map(([key, v]) => (
              <button key={key} className={mode === key ? 'on' : ''} onClick={() => setMode(key)}><Icon name={v.icon} size={14} />{v.label}</button>
            ))}
          </div>
          <div className="qs-bd-adder-chips">
            {m.presets.map(name => {
              const has = existing.has(name)
              return (
                <button key={name} className={`qs-bd-adder-chip${has ? ' has' : ''}`} title={has ? 'Đã có trong bảng' : 'Thêm vào bảng'} onClick={() => onAdd(name)}>
                  <Icon name={has ? 'check' : 'plus'} size={12} stroke={2.4} />{name}
                </button>
              )
            })}
          </div>
          <div className="qs-bd-adder-custom">
            <input autoFocus value={text} placeholder={m.placeholder} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCustom() }} />
            <button onClick={addCustom}><Icon name="plus" size={14} />Thêm</button>
          </div>
          <p className="qs-bd-adder-hint">{m.hint}</p>
        </div>
      )}
      <button className={`qs-bd-add-group${open ? ' on' : ''}`} title="Thêm tầng / phòng" onClick={() => setOpen(o => !o)}><Icon name="plusCircle" size={16} />Tầng / phòng</button>
    </div>
  )
}
