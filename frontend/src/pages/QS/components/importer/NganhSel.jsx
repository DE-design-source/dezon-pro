import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQs } from '../../state/QsData'
import { IMP_LOAI, coSpec_, nganhCuaSP_ } from '../../lib/productFields'
import { ptTemplateNew_, dtSync_, dtVals_, ctSyncTemplate_ } from '../../lib/phantho'
import { pad2 } from '../../lib/format'

/* Thư viện công tác phần thô sau khi gộp dữ liệu CSDL (PT_TEMPLATE của bản gốc sau dtSync_ + ctSyncTemplate_).
   Số mục không phụ thuộc số liệu dự toán nên dùng số liệu mặc định của từng bộ. */
export function ptLibrary_(congTac) {
  return ctSyncTemplate_(dtSync_(ptTemplateNew_(), bo => dtVals_(bo, null)), congTac || []).tpl
}
/* spPTAll_().length (PUB/sanpham.js:1342-1355): số công tác trong thư viện */
export function ptLibCount_(tpl) { return tpl.filter(s => !s.an).reduce((a, s) => a + (s.items || []).length, 0) }
/* ctHangMucList_ (PUB/phantho.js:721-726) */
export function ctHangMucList_(tpl, congTac) {
  const m = {}
  tpl.forEach(s => { if (!s.an) m[String(s.t).split('\n')[0]] = 1 })
  ;(congTac || []).forEach(c => { if (c.hangMuc) m[c.hangMuc] = 1 })
  return Object.keys(m).sort((a, b) => a.localeCompare(b, 'vi'))
}

/* Ô chọn NGÀNH HÀNG (port impNganhSel_ / ngPop_ / impNganhDem_, PUB/nhap.js:727-764).
   Props: loai (đang chọn), onPick(v), specs (để đếm SP theo ngành; chưa có thì đếm 0 như lúc chưa nạp). */
export default function NganhSel({ loai, onPick, specs }) {
  const { products, congTac } = useQs()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const dem = useMemo(() => {
    const c = { den: 0, vs: 0, son: 0, ct: 0, dl: 0 }
    ;(products || []).forEach(p => { const ng = nganhCuaSP_(p, specs); if (c[ng] != null) c[ng]++ })
    return c
  }, [products, specs])
  const ptN = useMemo(() => ptLibCount_(ptLibrary_(congTac)), [congTac])
  const count = v => (v === 'pt' ? ptN : dem[coSpec_(v) ? v : 'den'])
  const ten = (IMP_LOAI.filter(x => x[0] === loai)[0] || ['', ''])[1]

  useEffect(() => {
    if (!open) return undefined
    const out = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const key = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [open])

  // Đặt hộp ngay dưới nút, mép trái trùng nút; sát đáy màn hình thì lật lên trên (ngPop_, PUB/nhap.js:755-758)
  useLayoutEffect(() => {
    const pop = popRef.current, b = btnRef.current, w0 = wrapRef.current
    if (!open || !pop || !b || !w0) return
    const r = b.getBoundingClientRect(), o = w0.getBoundingClientRect()
    // .qs-scroll có zoom: toạ độ màn hình chia cho tỉ lệ thu phóng mới ra px của style
    const k = (w0.offsetWidth && o.width / w0.offsetWidth) || 1
    const w = (pop.offsetWidth || 330) * k, h = pop.offsetHeight * k
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6)
    pop.style.top = (top - o.top) / k + 'px'
    pop.style.left = (Math.max(8, Math.min(r.left, window.innerWidth - w - 10)) - o.left) / k + 'px'
  }, [open])

  return (
    <div className="qsi-hm-wrap" ref={wrapRef}>
      <span className="qsi-hm-lbl">Ngành hàng</span>
      <span className="qsi-count">[{pad2(count(loai))}]</span>
      <button ref={btnRef} className="qsi-tree-btn qsi-hm-open qsi-on" title="Chọn ngành hàng" onClick={() => setOpen(o => !o)}>
        <span className="qsi-hm-name">{ten}</span>
        <span className="qsi-cnt">[{pad2(count(loai))}]</span>
      </button>
      {open && (
        <div ref={popRef} className="qsi-fltpop qsi-bgtree qsi-ngpop">
          <div className="qsi-bgt-h"><b>Chọn ngành hàng</b><button className="qsi-colpop-x" onClick={() => setOpen(false)}>✕</button></div>
          <div className="qsi-bgt-b">{IMP_LOAI.map(x => {
            const on = loai === x[0]
            return (
              <div key={x[0]} className={'qsi-bgt-i qsi-lvl1' + (on ? ' qsi-on' : '')} onClick={() => { setOpen(false); onPick(x[0]) }}>
                <span className="qsi-nm">{x[1]}</span>
                <span className="qsi-cn">[{pad2(count(x[0]))}]</span>
                <span className={'qsi-rd' + (on ? ' qsi-on' : '')} />
              </div>
            )
          })}</div>
        </div>
      )}
    </div>
  )
}
