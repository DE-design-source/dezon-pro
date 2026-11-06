import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './importer.css'
import { useQs } from '../../state/QsData'
import { loadSpecs, specsNow } from '../../api/specs'
import NganhSel, { ptLibrary_, ctHangMucList_ } from './NganhSel'
import ProductForm from './ProductForm'
import RecentPanel from './RecentPanel'
import ImportStats from './ImportStats'
import ImportPt from './pt/index'
import { useImp, impGet } from './importStore'
import { impSetLoai_ } from './importActions'

/* Tab Nhập dữ liệu (port renderImport / impStatBar / renderImportPT_ phần thanh số liệu, PUB/nhap.js:460-470, 808-870, 896-905).
   Props: {} (cố định từ Batch 0). Form, danh sách chờ và danh sách vừa nhập ở importStore: rời tab / rời /qs vẫn còn;
   hiện lại tab không vẽ lại form (PUB/app.js:359-360). Ngành "Xây dựng · công tác phần thô": thanh số liệu vẽ ở đây (để luôn đổi
   được ngành), phần form + danh sách chờ công tác là importer/pt/index.jsx (Batch 3B). */
function Stat({ label, val }) {
  return <div className="qsi-stat"><div className="qsi-stat-v">{val}</div><div className="qsi-stat-l">{label}</div></div>
}

export default function ImportTab() {
  const { congTac } = useQs()
  const loai = useImp(s => s.loai)
  const [specs, setSpecs] = useState(specsNow)
  const [specErr, setSpecErr] = useState('')
  const [specTry, setSpecTry] = useState(0)
  const rootRef = useRef(null)
  const [kpi, setKpi] = useState(null)   // số tổng theo kỳ của "Ghi nhận dữ liệu nhập" (ImportStats báo lên)
  const [fly, setFly] = useState(null)   // khung mở sang phải cột trái: 'chart' (biểu đồ lớn) / 'recent' (Sản phẩm vừa nhập) - mỗi lúc 1 khung

  useEffect(() => {
    if (specs) return undefined
    let on = true
    setSpecErr('')
    loadSpecs().then(s => { if (on) setSpecs(s) }, e => { if (on) setSpecErr(e.message || String(e)) })
    return () => { on = false }
  }, [specs, specTry])

  // Còn sản phẩm / công tác chưa lưu vào Database -> trình duyệt hỏi trước khi rời trang (nhap.js:584-586)
  useEffect(() => {
    const h = e => {
      const st = impGet()
      if ((st.pending || []).length || st.ctPendingN) { e.preventDefault(); e.returnValue = 'Còn dữ liệu chưa lưu vào Database'; return e.returnValue }
      return undefined
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const pt = useMemo(() => {
    if (loai !== 'pt') return null
    const ds = congTac || []
    return { n: ds.length, chuaDuyet: ds.filter(c => !c.daDuyet).length, hm: ctHangMucList_(ptLibrary_(ds), ds).length }
  }, [loai, congTac])
  const sel = <NganhSel loai={loai} specs={specs} onPick={v => impSetLoai_(v, specs)} />
  const toTop = () => {
    const el = rootRef.current; if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const f = layRef.current && layRef.current.lastElementChild; if (f && f.scrollTo) f.scrollTo({ top: 0, behavior: 'smooth' })
  }
  /* 3 cột (cột trái · khung mở rộng · form) cao vừa khít phần còn lại của khung cuộn trang, mỗi cột tự có thanh kéo.
     Đo theo đơn vị trong khung cuộn (đã tính zoom của .qs-page) và đo lại khi đổi cỡ cửa sổ. */
  const layRef = useRef(null)
  useLayoutEffect(() => {
    const el = layRef.current; if (!el) return undefined
    const fit = () => {
      const cont = el.closest('.qs-scroll'); if (!cont) return
      const cr = cont.getBoundingClientRect(), z = cr.height / (cont.clientHeight || 1) || 1
      const top = el.getBoundingClientRect().top + cont.scrollTop * z   // mép trên khi khung cuộn ở đầu (px màn hình)
      const h = Math.floor((Math.min(cr.bottom, window.innerHeight) - top) / z - 12)   // đáy = đáy khung cuộn, không quá đáy cửa sổ
      el.style.setProperty('--qsi-h', Math.max(420, h) + 'px')
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [loai])

  return (
    <div className="qsi-root" ref={rootRef}>
      {pt ? (
        <>
          <div className="qsi-statbar">{sel}<Stat label="Công tác trong CSDL" val={pt.n} /><Stat label="Chờ duyệt" val={pt.chuaDuyet} /><Stat label="Hạng mục" val={pt.hm} /></div>
          <ImportPt />
        </>
      ) : (
        <>
          <div className="qsi-statbar">{sel}
            {/* dữ liệu báo cáo theo kỳ + bộ lọc đang chọn ở cột trái */}
            {kpi && <>
              <div className="qsi-stat qsi-stat-per"><div className="qsi-stat-v">{kpi.perTx}</div><div className="qsi-stat-l">{kpi.rangeTx}</div></div>
              <Stat label="SKU đã nhập" val={kpi.n} />
              <Stat label="Đã duyệt" val={kpi.nDuyet} />
              <Stat label="Chưa duyệt" val={kpi.n - kpi.nDuyet} />
              <Stat label="Thương hiệu" val={kpi.nBrand} />
            </>}
          </div>
          <div className="qsi-layout" ref={layRef}>
            {/* panel "Sản phẩm vừa nhập" bên trái, rộng bằng cột trái của các tab khác (Bóc tách / Danh sách SP: 440px, màn <= 1280px: 340px) */}
            <div className="qsi-left">
              <ImportStats onKpi={setKpi} open={fly === 'chart'} onOpen={b => setFly(b ? 'chart' : null)} />
              <RecentPanel specs={specs} onEditOpen={toTop} open={fly === 'recent'} onOpen={b => setFly(b ? 'recent' : null)} />
            </div>
            <ProductForm specs={specs} specErr={specErr} onRetrySpecs={() => setSpecTry(t => t + 1)} />
          </div>
        </>
      )}
    </div>
  )
}
