import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { qbNorm_ } from '../../lib/format.js'
import './common.css'

/* Ô chọn gõ để tìm, dùng chung cho mọi bộ lọc dạng chọn 1 trong QS (thay <select>): bấm / gõ mở danh sách lọc theo chữ
   (không phân biệt hoa thường / dấu: "aura" ra "Aura Lighting"); ↑ ↓ chọn, Enter lấy (đang gõ thì lấy kết quả khớp đầu), Esc đóng.
   Props:
     value      giá trị đang chọn ('' = tất cả)
     options    mảng chuỗi hoặc [giá trị, nhãn]
     onChange(v)
     allLabel   nhãn dòng đầu = bỏ lọc (vd "Tất cả thương hiệu"); null = không có dòng này
     inline     danh sách nằm trong luồng (đẩy nội dung xuống) - dùng trong popup tự cuộn, tránh bị cắt
     multi      chọn nhiều: value = mảng giá trị, onChange(mảng mới); mỗi dòng có ô đánh dấu, danh sách giữ mở,
                chân danh sách: Đã chọn n · Chọn n kết quả (khi đang gõ) · Bỏ chọn · Xong
     className  thêm cho khung */
export default function SearchSelect({ value, options, onChange, allLabel = 'Tất cả', inline, className, multi }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const box = useRef(null)
  const inp = useRef(null)
  const listRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const down = e => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  const opts = (options || []).map(o => (Array.isArray(o) ? o : [o, o]))
  const lbOf = v => { const o = opts.find(x => x[0] === v); return o ? o[1] : v }
  const sel = multi ? (Array.isArray(value) ? value : []) : []
  const isOn = v => (multi ? (v ? sel.indexOf(v) >= 0 : !sel.length) : v === value)
  const nq = qbNorm_(q.trim())
  const hits = nq ? opts.filter(o => qbNorm_(o[1]).indexOf(nq) >= 0) : opts
  const rows = (allLabel != null ? [['', allLabel]] : []).concat(hits)
  const cur = Math.min(Math.max(hi, 0), rows.length - 1)
  useEffect(() => {   // giữ dòng đang sáng trong khung khi dùng phím mũi tên
    const el = listRef.current && listRef.current.children[cur]
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [cur, open])
  const close = () => { setOpen(false); setQ(''); if (inp.current) inp.current.blur() }
  /* chọn 1: lấy rồi đóng. chọn nhiều: bấm = bật / tắt, danh sách giữ mở (giữ cả chữ đang tìm); dòng "Tất cả" = bỏ hết */
  const pick = v => {
    if (!multi) { onChange(v); close(); return }
    onChange(!v ? [] : (sel.indexOf(v) >= 0 ? sel.filter(x => x !== v) : sel.concat(v)))
  }
  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); setHi(Math.min(rows.length - 1, cur + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, cur - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && rows[cur]) pick(rows[cur][0]) }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setQ('') }
  }
  const has = multi ? sel.length > 0 : !!value
  const shownLb = multi
    ? (sel.length ? (sel.length <= 2 ? sel.map(lbOf).join(', ') : lbOf(sel[0]) + ', ' + lbOf(sel[1]) + ' +' + (sel.length - 2)) : '')
    : (value ? lbOf(value) : '')
  return (
    <div className={'qsc-ss' + (open ? ' open' : '') + (inline ? ' inline' : '') + (has ? ' has' : '') + (multi ? ' multi' : '') + (className ? ' ' + className : '')} ref={box}>
      <div className="qsc-ss-in" onMouseDown={e => { if (e.target !== inp.current) { e.preventDefault(); if (inp.current) inp.current.focus() } }}>
        <Icon name="search" size={13} />
        <input ref={inp} value={open ? q : shownLb} placeholder={open && multi && sel.length ? 'Gõ để tìm thêm…' : (shownLb || ((allLabel || 'Chọn') + ' - gõ để tìm'))}
          onFocus={() => { setOpen(true); setHi(0) }} onChange={e => { setQ(e.target.value); setOpen(true); setHi(e.target.value.trim() && allLabel != null ? 1 : 0) }} onKeyDown={key} />
        {multi && sel.length > 0 && <b className="cnt" title={sel.map(lbOf).join(', ')}>{sel.length}</b>}
        {has && !open && allLabel != null
          ? <button type="button" className="clr" title="Bỏ chọn" onMouseDown={e => e.stopPropagation()} onClick={() => (multi ? onChange([]) : pick(''))}><Icon name="x" size={12} /></button>
          : <Icon name="chevronDown" size={13} />}
      </div>
      {open && (
        <div className="qsc-ss-pop">
          <div className="qsc-ss-list" role="listbox" aria-multiselectable={multi || undefined} ref={listRef}>
            {rows.map(([v, lb], i) => {
              const on = isOn(v)
              return (
                <button key={v || '__all'} type="button" role="option" aria-selected={on}
                  className={(i === cur ? 'hi' : '') + (on ? ' on' : '') + (v ? '' : ' all')}
                  onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(v)}>
                  {multi && <i className="bx" aria-hidden="true">{on && <Icon name="check" size={11} />}</i>}
                  <span>{lb}</span>{!multi && on && <Icon name="check" size={12} />}
                </button>
              )
            })}
            {!hits.length && <div className="none">Không có kết quả khớp "{q.trim()}"</div>}
          </div>
          {multi && (
            <div className="qsc-ss-foot">
              <span>Đã chọn <b>{sel.length}</b></span>
              {nq && hits.length > 0 && <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => onChange(sel.concat(hits.map(h => h[0]).filter(v => sel.indexOf(v) < 0)))}>Chọn {hits.length} kết quả</button>}
              <button type="button" disabled={!sel.length} onMouseDown={e => e.preventDefault()} onClick={() => onChange([])}>Bỏ chọn</button>
              <button type="button" className="ok" onMouseDown={e => e.preventDefault()} onClick={close}>Xong</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
