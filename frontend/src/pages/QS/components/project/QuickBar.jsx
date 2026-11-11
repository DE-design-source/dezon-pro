import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { useRecentNodes, QB_RECENT_N } from '../../state/useRecentNodes'
import { TREE, nodeName, nodeCount, customGroups, inNode_ } from '../../lib/tree.js'
import { qbNorm_ } from '../../lib/format.js'
import { useQbSlotEl, useQbQuery, setQbQuery } from './qbSlot'
import './project.css'

/* Thanh công cụ nhanh #qbar (port qbRender_ / qbRecentSync_ / qbRightSync_ / qbResults_ / qbSearch_ / qbKey_ / qbPick_,
   PUB/boc.js:1365-1627, 343-420; qbGoNode_ / qbGotoRow_ app.js:1570-1586). QS.jsx đặt 1 bản trên tab boc/chiphi/duan/muahang.
   Props: tab = 'boc' | 'chiphi' | 'duan' | 'muahang'.
   - Bản gốc ẩn thanh này ở Bóc tách (PUB/index.html:6470 `body:has(#v-boc.on) #qbar{display:none}`) -> tab 'boc' không vẽ gì;
     vì vậy kết quả "Sản phẩm / Công tác - thêm vào ..." (chỉ có khi thanh ở Bóc tách) không bao giờ xuất hiện.
   - Chip hạng mục: Bóc tách đổi `node`, tab khác đổi `hmNode` dùng chung (setHmNode cũng ghi qs_hm + hạng mục gần đây).
   - "Tới dòng": tìm phần tử dòng trong panel đang hiện theo [data-qs-line|data-row|data-id = lineId] rồi cuộn tới + nháy sáng.
   - Gợi ý phím Ctrl/⌘ K giữ như bản gốc, nhưng không bắt phím (bản gốc chỉ bắt ở Bóc tách, nơi thanh bị ẩn).
   - Chi phí / Dự án: chỉ ô tìm kiếm vẽ vào hàng "Hạng mục đã bóc" (PageHead, qbSlot.js); không vẽ thanh chip hạng mục gần đây
     (trùng nút chọn hạng mục) và nút Xuất báo giá (đã có tab Xuất báo giá). */
const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')

export default function QuickBar({ tab }) {
  if (tab === 'boc') return null
  return <QuickBarIn tab={tab} />
}

function QuickBarIn({ tab }) {
  const { cur, lines, node, hmNode, setNode, setHmNode, navigate } = useQs()
  const recent = useRecentNodes()
  // chữ tìm dùng chung với bảng của tab (Chi phí / Dự án lọc dòng theo chữ này, qbSlot useQbQuery)
  const q = useQbQuery(tab)
  const setQ = v => setQbQuery(tab, v)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const inRef = useRef(null)
  const boxRef = useRef(null)
  const mouse = useRef({ prev: '', cur: '' })
  const onBoc = tab === 'boc'
  const curCode = onBoc ? node : hmNode

  /* qbRecentSync_: chỉ mã có trong cây hoặc hạng mục tự tạo của dự án; hạng mục đang chọn luôn có chip */
  const chips = useMemo(() => {
    const cg = customGroups(cur)
    const v = recent.filter(c => TREE.some(t => t[0] === c) || cg.indexOf(c) >= 0)
    if (curCode && v.indexOf(curCode) < 0) v.unshift(curCode)
    return v.slice(0, QB_RECENT_N)
  }, [recent, cur, curCode])

  /* qbResults_ (phần dùng được khi thanh không ở Bóc tách: dòng trong bảng + hạng mục) */
  const results = useMemo(() => {
    const n = qbNorm_(q).trim(); if (!n) return []
    const ws = n.split(/\s+/)
    const hit = t => { t = qbNorm_(t); return ws.every(w => t.indexOf(w) >= 0) }
    const out = []
    ;(lines || []).forEach(l => {
      if (hit([l.ten, l.maSP, l.thuongHieu, l.khuVuc].join(' ')))
        out.push({ g: 'Trong bảng bóc tách', t: l.ten, s: [l.nhom + '. ' + nodeName(l.nhom), l.khuVuc, 'SL ' + (l.soLuong || 0)].filter(Boolean).join(' · '), k: 'line', id: l.lineId })
    })
    TREE.forEach(t => {
      if (t[0] !== 'X' && hit(t[0] + ' ' + t[1])) out.push({ g: 'Hạng mục', t: t[0] + '. ' + t[1], s: (nodeCount(lines, t[0]) || 0) + ' dòng', k: 'node', id: t[0] })
    })
    const dem = {}
    return out.filter(r => { dem[r.g] = (dem[r.g] || 0) + 1; return dem[r.g] <= (r.k === 'node' ? 4 : 6) })
  }, [q, lines])

  useEffect(() => { setSel(0) }, [q])

  /* Bấm ra ngoài thì đóng danh sách. Không bắt Ctrl/⌘+K: bản gốc chỉ bắt khi đang ở Bóc tách (PUB/boc.js:422-426),
     nơi thanh này bị ẩn. */
  useEffect(() => {
    const onDown = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onMove = e => { mouse.current.prev = mouse.current.cur; mouse.current.cur = e.clientX + ',' + e.clientY }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mousemove', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mousemove', onMove, true)
    }
  }, [])

  function goNode(code) {
    if (onBoc) { if (code !== node) { setNode(code); setHmNode(code, 'boc') } return }
    if (code === hmNode) return
    setHmNode(code)
  }
  function gotoRow(id) {
    const l = (lines || []).filter(x => String(x.lineId) === String(id))[0]
    if (l && hmNode && !inNode_(l, hmNode)) setHmNode('')   // dòng ngoài hạng mục đang xem -> xem tất cả
    setTimeout(() => {
      const v = CSS.escape(String(id))
      const els = Array.prototype.slice.call(document.querySelectorAll(`.qs-page [data-qs-line="${v}"], .qs-page [data-row="${v}"], .qs-page tr[data-id="${v}"]`))
      const tr = els.filter(el => el.offsetParent !== null)[0]
      if (!tr) return
      tr.scrollIntoView({ behavior: 'smooth', block: 'center' })
      tr.classList.remove('qs-qb-flash'); void tr.offsetWidth; tr.classList.add('qs-qb-flash')
      setTimeout(() => tr.classList.remove('qs-qb-flash'), 1800)
    }, 80)
  }
  function pick(i) {
    const r = results[i]; if (!r) return
    setOpen(false)
    if (r.k === 'line') { if (inRef.current) inRef.current.blur(); gotoRow(r.id); return }
    if (r.k === 'node') { setQ(''); if (inRef.current) inRef.current.blur(); goNode(r.id) }
  }
  function onKeyDown(e) {
    const k = e.key
    if (k === 'Escape') { setOpen(false); e.target.blur(); return }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); if (!results.length) return
      const i = (sel + (k === 'ArrowDown' ? 1 : -1) + results.length) % results.length
      setSel(i)
      const el = boxRef.current && boxRef.current.querySelector(`.qs-qb-r[data-i="${i}"]`)
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
      return
    }
    if (k === 'Enter') { e.preventDefault(); if (results.length) pick(sel) }
  }

  const shown = open && q.trim()
  // chỗ ở hàng công cụ của bảng (Chi phí, 'tools:<tab>') ưu tiên hơn chỗ ở hàng "Hạng mục đã bóc" ('<tab>')
  const toolSlot = useQbSlotEl('tools:' + tab)
  const headSlot = useQbSlotEl(tab)
  const slot = toolSlot || headSlot
  let g = ''
  const find = (
      <div className="qs-ct-search wide qs-qb-find" ref={boxRef}>
        <Icon name="search" size={15} />
        <input
          ref={inRef} value={q} autoComplete="off" spellCheck={false}
          placeholder="Tìm sản phẩm, công tác, dòng trong bảng, hạng mục…"
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {q ? <button type="button" className="qs-cp-x" title="Xoá tìm kiếm" onMouseDown={e => e.preventDefault()} onClick={() => setQ('')}>✕</button>
          : <kbd>{MAC ? '⌘' : 'Ctrl'} K</kbd>}
        {shown && (
          <div className="qs-qb-pop">
            {results.length ? results.map((r, i) => {
              const h = r.g !== g ? <div className="qs-qb-g">{r.g}</div> : null
              g = r.g
              return (
                <div key={r.k + r.id}>
                  {h}
                  <div className={`qs-qb-r${i === sel ? ' on' : ''}`} data-i={i}
                    onMouseDown={e => { e.preventDefault(); pick(i) }}
                    onMouseMove={() => { if (mouse.current.prev !== mouse.current.cur) setSel(i) }}>
                    <span className="qs-qb-ri"><Icon name={r.k === 'line' ? 'listLines' : 'layers'} size={14} /></span>
                    <span className="qs-qb-rt"><b>{r.t}</b><i>{r.s}</i></span>
                    <span className="qs-qb-ra">{r.k === 'line' ? 'Tới dòng' : 'Chuyển'}</span>
                  </div>
                </div>
              )
            }) : <div className="qs-qb-none">Không tìm thấy “{q}”</div>}
          </div>
        )}
      </div>
  )
  const exp = (
      <button type="button" className="qs-ct-btn" title="Sang tab Xuất báo giá" onClick={() => navigate('export')}>
        <Icon name="download" size={14} />Xuất báo giá
      </button>
  )
  // có chỗ trên hàng "Hạng mục đã bóc": chỉ đưa ô tìm vào đó; bỏ thanh chip hạng mục gần đây (trùng nút chọn hạng mục) và nút Xuất báo giá
  if (slot) return createPortal(find, slot)
  return (
    <div className="qs-card qs-ct-top qs-qb">
      <span className="qs-ct-top-icon" title="Hạng mục gần đây — bấm để chuyển"><Icon name="history" size={15} /></span>
      <div className="qs-ct-cats">
        {chips.length ? chips.map(c => {
          const n = nodeCount(lines, c)
          return (
            <button key={c} type="button" className={`qs-ct-cat-chip${c === curCode ? ' on' : ''}`} title={c + '. ' + nodeName(c)} onClick={() => goNode(c)}>
              <small>{c}</small>{nodeName(c)}{n ? <span>{n}</span> : null}
            </button>
          )
        }) : <span className="qs-qb-empty">Chưa có hạng mục gần đây</span>}
      </div>
      <span style={{ flex: 1 }} />
      {find}
      {exp}
    </div>
  )
}
