import { useEffect, useLayoutEffect, useState } from 'react'
import PoDetailFields, { newPoItem } from './PoDetailFields'
import { PO_STAGES, STATUS_LABEL, avatarColor, initials, fmtFull, statusOf, fmtMillion, parseD } from '../../../data/quanLyThietKeData'

/* "Phiếu thông tin mua hàng": khung bên phải màn hình khi bấm 1 công việc của giai đoạn Mua hàng & cung ứng trên Tiến độ
   (timeline vẫn hiện bên trái). Gồm: thông tin công việc (thời gian, phụ trách, trạng thái, tiến độ), tóm tắt đơn mua hàng
   (số đơn, tổng giá trị, số đơn theo từng bước quy trình) và danh sách đơn (mã, vật tư, NCC, SL, giá trị, hạn, bước).
   "Mở bảng mua hàng" = trang kanban đầy đủ (PurchaseBoard) để chuyển bước / sửa đơn. Esc / ✕ để đóng.
   Bấm 1 đơn (hoặc "+ Thêm đơn mua hàng") -> phiếu chi tiết đơn ngay trong khung (3 chế độ xem), "← Danh sách đơn" để quay lại.
   Props: task, items (đơn mua hàng của công việc), open, projectName, meName, onClose(), onOpenBoard(), onUpdateItems(taskId, fn) */
const assigneesOf = it => it.assignees || (it.owner ? [it.owner] : [])

export default function PurchaseInfoPanel({ task, items, open, projectName, meName, onClose, onOpenBoard, onUpdateItems }) {
  // Đơn đang xem: 'auto' = mở thẳng phiếu chi tiết (đơn đầu tiên, chưa có đơn thì phiếu nháp), null = danh sách, còn lại = id đơn
  const [selId, setSelId] = useState('auto')
  const [draft, setDraft] = useState(null) // phiếu nháp khi công việc chưa có đơn: chỉ lưu khi sửa ô đầu tiên
  const view = 'groups' // phiếu trong khung chỉ dùng chế độ Groups (bỏ Default / Columns)
  // Vị trí khung: nằm dưới thanh tiêu đề trang (tiêu đề phiếu cao bằng thanh đó); xem phiếu chi tiết thì mở nguyên vùng nội dung
  // dưới thanh tiêu đề (mép trái = mép trái thanh tiêu đề trang, chừa sidebar ứng dụng)
  const [geo, setGeo] = useState({ left: null, top: null, headH: null })
  const taskId = task && task.id
  useEffect(() => { setSelId('auto'); setDraft(null) }, [taskId, open])
  useEffect(() => {
    if (!open) return undefined
    const k = e => { if (e.key !== 'Escape') return; if (selId) setSelId(null); else onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose, selId])
  const list = items || []
  const stages = (task && task.purchaseFlow && task.purchaseFlow.length && task.purchaseFlow) || PO_STAGES
  const stageOf = k => stages.find(s => s.key === k) || stages[0] || {}
  const total = list.reduce((t, it) => t + (Number(it.value) || 0), 0)
  const done = list.filter(it => stageOf(it.stage).received).length
  const st = task ? statusOf(task) : 'notstarted'
  const draftItem = task && (draft || newPoItem(list, stages, meName, task))
  const sel = !task || selId === null ? null
    : selId === 'auto' ? (list[0] || draftItem)
      : list.find(it => it.id === selId) || (draftItem && draftItem.id === selId ? draftItem : null)
  const isDraft = !!sel && !list.some(it => it.id === sel.id)
  const wide = open && !!sel
  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const hd = document.querySelector('.da-header, .tk-header')
      const r = hd && hd.getBoundingClientRect()
      const x = wide && r ? r.left : null
      setGeo({ left: x != null && window.innerWidth - x >= 600 ? Math.round(x) : null, top: r ? Math.max(0, Math.round(r.bottom)) : null, headH: r ? Math.round(r.height) : null })
    }
    place()
    window.addEventListener('resize', place)
    // Thu gọn / mở sidebar không đổi cỡ cửa sổ nhưng đổi bề rộng thanh tiêu đề -> đo lại theo từng khung hình chuyển động
    const hd = document.querySelector('.da-header, .tk-header')
    const ro = hd && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (ro) ro.observe(hd)
    return () => { window.removeEventListener('resize', place); if (ro) ro.disconnect() }
  }, [open, wide])
  const panelStyle = {
    ...(geo.left != null ? { width: 'auto', left: geo.left } : null),
    ...(geo.top != null ? { top: geo.top } : null),
    ...(geo.headH ? { '--pi-head-h': geo.headH + 'px' } : null),
  }
  if (isDraft && !draft) setDraft(draftItem)
  const patch = p => {
    if (isDraft) { onUpdateItems(task.id, l => [...(l || []), { ...sel, ...p }]); setSelId(sel.id); setDraft(null); return }
    onUpdateItems(task.id, l => l.map(it => (it.id === sel.id ? { ...it, ...p } : it)))
  }
  function addItem() {
    const it = newPoItem(list, stages, meName, task)
    onUpdateItems(task.id, l => [...(l || []), it])
    setSelId(it.id)
  }
  function removeItem() {
    if (!window.confirm('Xoá đơn ' + sel.code + ' - ' + sel.item + '?')) return
    const id = sel.id
    setSelId(null)
    onUpdateItems(task.id, l => l.filter(x => x.id !== id))
  }
  return (
    <aside className={`tk-pi${open ? ' open' : ''}${sel ? ' detail v-' + view : ''}`} style={panelStyle} aria-hidden={!open} aria-label="Phiếu thông tin mua hàng">
      <div className="tk-pi-head">
        <span className="ic" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
        </span>
        {task && sel ? (
          // Phiếu chi tiết: 1 dòng = tên công việc · PHIẾU THÔNG TIN MUA HÀNG · mã đơn
          <div className="tt one tk-pi-mod">
            <b className="no" title={task.name}>{task.name}</b>
            <span>Phiếu thông tin mua hàng</span>
            <code>{sel.code}{isDraft && <em> · nháp</em>}</code>
          </div>
        ) : (
          <div className="tt">
            <span>Phiếu thông tin mua hàng</span>
            <b>{task ? task.name : '—'}</b>
          </div>
        )}
        {task && sel && (
          // Xem phiếu chi tiết: các nút điều khiển nằm trên thanh tiêu đề
          <div className="tk-pi-hact">
            <div className="tk-pi-dbar">
              <button type="button" className="back tk-pi-mod" onClick={() => setSelId(null)} title="Quay lại danh sách đơn (Esc)">← Danh sách đơn</button>
              <span className="stg tk-pi-mod" style={{ '--c': stageOf(sel.stage).color }}>
                <i />
                <select value={sel.stage} onChange={e => patch({ stage: e.target.value })} title="Bước quy trình">
                  {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </span>
            </div>
            <button type="button" className="hb pri" onClick={onOpenBoard}>Mở bảng mua hàng</button>
            {!isDraft && <button type="button" className="hb del ic" onClick={removeItem} title="Xoá đơn" aria-label="Xoá đơn"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg></button>}
          </div>
        )}
        {task && sel
          ? <button type="button" className="x back" onClick={onClose} title="Quay lại trang tiến độ" aria-label="Quay lại trang tiến độ"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg></button>
          : <button type="button" className="x" onClick={onClose} title="Đóng (Esc)" aria-label="Đóng">×</button>}
      </div>

      {task && sel && (
        <div className="tk-pi-body">
          <PoDetailFields item={sel} task={task} projectName={projectName} stage={stageOf(sel.stage)} view={view} onPatch={patch} suppliers={list.map(it => it.supplier)} />
        </div>
      )}

      {task && !sel && (
        <div className="tk-pi-body">
          <section className="tk-pi-sec">
            <h4>Công việc</h4>
            <dl>
              <dt>Thời gian</dt><dd>{task.start ? fmtFull(parseD(task.start)) : '—'} → {task.end ? fmtFull(parseD(task.end)) : '—'}</dd>
              <dt>Phụ trách</dt><dd>{task.assignee ? <><span className="av" style={{ background: avatarColor(task.assignee) }}>{initials(task.assignee)}</span>{task.assignee}</> : '—'}</dd>
              <dt>Trạng thái</dt><dd><span className={`tk-pi-st st-${st}`}>{STATUS_LABEL[st]}</span></dd>
              <dt>Tiến độ</dt><dd><span className="pg"><i style={{ width: Math.max(0, Math.min(100, task.progress || 0)) + '%' }} /></span>{task.progress || 0}%</dd>
            </dl>
          </section>

          <section className="tk-pi-sec">
            <h4>Tóm tắt đơn mua hàng</h4>
            <div className="tk-pi-kpi">
              <div><b>{list.length}</b><span>Đơn mua hàng</span></div>
              <div><b>{fmtMillion(total)}</b><span>Tổng giá trị</span></div>
              <div><b>{done}/{list.length}</b><span>Đã nhận hàng</span></div>
            </div>
            <div className="tk-pi-steps">
              {stages.map(s => {
                const n = list.filter(it => it.stage === s.key).length
                return <span key={s.key} className={n ? '' : 'zero'} style={{ '--c': s.color }} title={s.label + ': ' + n + ' đơn'}><i />{s.label}<em>{n}</em></span>
              })}
            </div>
          </section>

          <section className="tk-pi-sec">
            <h4>Danh sách đơn <em>{list.length}</em><button type="button" className="tk-pi-add" onClick={addItem}>+ Thêm đơn mua hàng</button></h4>
            {!list.length && <button type="button" className="tk-pi-empty" onClick={addItem}>Chưa có đơn mua hàng nào cho công việc này.<b>+ Thêm đơn mua hàng</b></button>}
            <div className="tk-pi-list">
              {list.map(it => {
                const s = stageOf(it.stage)
                const who = assigneesOf(it)
                return (
                  <div key={it.id} className="tk-pi-po" style={{ '--c': s.color }} role="button" tabIndex={0} title="Xem phiếu chi tiết đơn"
                    onClick={() => setSelId(it.id)} onKeyDown={e => { if (e.key === 'Enter') setSelId(it.id) }}>
                    <div className="r1"><b>{it.item || it.code || 'Đơn mua hàng'}</b><span className="v">{fmtMillion(Number(it.value) || 0)}</span></div>
                    <div className="r2">
                      {it.code && <span className="code">{it.code}</span>}
                      {it.supplier && <span>{it.supplier}</span>}
                      {it.qty && <span>{it.qty}</span>}
                      {it.due && <span>Hạn {fmtFull(parseD(it.due))}</span>}
                    </div>
                    <div className="r3">
                      <span className="stg"><i />{s.label || '—'}</span>
                      <span className="who">{who.slice(0, 3).map(n => <span key={n} className="av" title={n} style={{ background: avatarColor(n) }}>{initials(n)}</span>)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {!sel && <div className="tk-pi-foot">
        <button type="button" onClick={onClose}>Đóng</button>
        <button type="button" className="pri" onClick={onOpenBoard} disabled={!task}>Mở bảng mua hàng</button>
      </div>}
    </aside>
  )
}
