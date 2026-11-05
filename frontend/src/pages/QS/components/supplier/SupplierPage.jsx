import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import ProductThumb from '../common/ProductThumb'
import { useQs } from '../../state/QsData'
import { showTab } from '../../state/store'
import { mediaUrl, uploadRaw } from '../../api/files'
import * as api from '../../api/qsApi'
import { qsToast as toast, qsConfirm } from '../common/dialogs'
import { money, qbNorm_ } from '../../lib/format.js'
import { spNodeCodeOf_, nodeName } from '../../lib/tree.js'
import { statCache, loadStats_ } from '../project/projectStats'
import '../project/gallery.css'
import '../products/list/list.css'
import './supplier.css'
import { MultiProjPop } from '../products/list/SpModal'
import { MrootPortal } from '../common/Mroot'
import { spAddToProject } from '../products/list/spActions'
import { useNccInfo, IntroTab, PartnerTab, CatalogueTab } from './SupplierInfo'

/* Trang "Nhà cung cấp" (cùng kiểu trang Danh sách dự án): nhà cung cấp = thương hiệu trong danh mục sản phẩm
   (khớp chip "Nhà cung cấp" của Danh sách dự án). Thẻ: ảnh ghép 4 sản phẩm, ngành hàng, số sản phẩm, khoảng giá, số dự án đang dùng.
   Bấm thẻ = trang chi tiết: tab Sản phẩm (lọc hạng mục) · Dự án đang dùng · Nhà phân phối (cột NCC của sản phẩm)
   · Giới thiệu · Đối tác · Catalogue (hồ sơ nhập tay, SupplierInfo.jsx).
   Số dự án đang dùng đọc từ projectStats (đếm dòng báo giá từng dự án, dùng chung với Danh sách dự án). */
const img1 = v => (v ? mediaUrl(String(v).split('\n')[0].trim()) : '')
const s_ = v => String(v == null ? '' : v).trim()
/* Chế độ xem: Lưới lớn (ảnh 2x2) · Lưới nhỏ (1 ảnh) · Logo (chỉ tên + số liệu) · Danh sách (1 hàng / nhà cung cấp) */
const VIEWS = [['grid', 'Lưới lớn', 'grid'], ['small', 'Lưới nhỏ', 'table'], ['logo', 'Thẻ gọn', 'tag'], ['list', 'Danh sách', 'listLines']]
const COLS_DEF = { grid: 5, small: 7, logo: 6 }
const V_LS = 'qs_sup_view'
const vGet = () => { try { const v = localStorage.getItem(V_LS); return VIEWS.some(x => x[0] === v) ? v : 'grid' } catch (e) { return 'grid' } }
const HUES = [212, 196, 168, 28, 262, 340, 145, 18]
const hue_ = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length] }

/* Logo nhà cung cấp: dữ liệu công ty 'nccLogo' = {thương hiệu: URL ảnh} (api.getProjData / setProjData với mã '__cty').
   Có logo -> phần ảnh của thẻ là logo; chưa có -> ảnh ghép 4 sản phẩm tiêu biểu + nút "Thêm logo" khi rê chuột */
let logoCache = null
function useLogos() {
  const [logos, setLogos] = useState(logoCache || {})
  useEffect(() => {
    if (logoCache) return
    api.getProjData('__cty').then(d => { logoCache = (d && d.nccLogo && typeof d.nccLogo === 'object') ? d.nccLogo : {}; setLogos(logoCache) }, () => {})
  }, [])
  async function save(next) {
    const old = logoCache || {}
    logoCache = next; setLogos(next)
    try { await api.setProjData('__cty', 'nccLogo', next) } catch (e) { logoCache = old; setLogos(old); toast('Lỗi lưu logo: ' + ((e && e.message) || e)) }
  }
  async function upload(ten, file) {
    if (!file) return
    if (!/^image\//.test(file.type)) { toast('Chỉ nhận file ảnh (png, jpg, svg, webp…)'); return }
    try { const r = await uploadRaw(file); if (r && r.url) { await save({ ...(logoCache || {}), [ten]: r.url }); toast('Đã lưu logo ' + ten) } } catch (e) { toast('Tải logo lỗi: ' + e.message) }
  }
  async function remove(ten) {
    if (!await qsConfirm('Xoá logo của ' + ten + '?')) return
    const n = { ...(logoCache || {}) }; delete n[ten]; save(n)
  }
  return { logos, upload, remove }
}
function LogoPick({ onFile, children, className, title }) {
  const ref = useRef(null)
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={e => { onFile(e.target.files[0]); e.target.value = '' }} />
      <button type="button" className={className} title={title} onClick={e => { e.stopPropagation(); ref.current && ref.current.click() }}>{children}</button>
    </>
  )
}

export default function SupplierPage() {
  const L = useLogos()
  const { products, projects } = useQs()
  const [q, setQ] = useState('')
  const [nganhF, setNganhF] = useState({})
  const [open, setOpen] = useState(false)
  const [ddq, setDdq] = useState('')            // ô tìm trong danh sách Ngành hàng
  const [view, setViewSt] = useState(vGet)
  const setView = v => { setViewSt(v); try { localStorage.setItem(V_LS, v) } catch (e) { /* bỏ qua */ } }
  const [detail, setDetail] = useState('')
  const [cols, setColsSt] = useState(() => { try { return { ...COLS_DEF, ...JSON.parse(localStorage.getItem('qs_sup_cols') || '{}') } } catch (e) { return COLS_DEF } })
  const setCols = n => setColsSt(c => { const x = { ...c, [view]: n }; try { localStorage.setItem('qs_sup_cols', JSON.stringify(x)) } catch (e) { /* bỏ qua */ } return x })
  const nCol = cols[view] || COLS_DEF[view] || 5
  const [statVer, setStatVer] = useState(0)
  const ddRef = useRef(null)
  useEffect(() => { let alive = true; loadStats_(projects || [], () => { if (alive) setStatVer(v => v + 1) }); return () => { alive = false } }, [projects])
  useEffect(() => {
    if (!open) return undefined
    const down = e => { if (ddRef.current && !ddRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  /* Gom sản phẩm theo thương hiệu */
  const sups = useMemo(() => {
    const m = {}
    ;(products || []).forEach(p => {
      const k = s_(p.thuongHieu); if (!k) return
      const o = m[k] || (m[k] = { ten: k, sp: [], nganh: {}, hm: {}, dist: {}, min: Infinity, max: 0 })
      o.sp.push(p)
      /* ngành hàng = hạng mục của sản phẩm trên cây hạng mục (cùng tên với trang Danh sách sản phẩm, vd 3.2.6.1 Thiết bị đèn) */
      const ng = spNodeCodeOf_(p); if (ng) o.nganh[ng] = (o.nganh[ng] || 0) + 1
      const hm = s_(p.hangMuc); if (hm) o.hm[hm] = (o.hm[hm] || 0) + 1
      const d = s_(p.ncc); if (d) o.dist[d] = (o.dist[d] || 0) + 1
      const g = Number(p.donGiaBan) || 0; if (g > 0) { o.min = Math.min(o.min, g); o.max = Math.max(o.max, g) }
    })
    return Object.values(m).sort((a, b) => b.sp.length - a.sp.length || a.ten.localeCompare(b.ten, 'vi'))
  }, [products])
  /* Dự án đang dùng từng thương hiệu (theo dòng báo giá) */
  const projOf = useMemo(() => {
    const m = {}
    ;(projects || []).forEach(x => { const st = statCache[x.maDA]; ((st && st.ncc) || []).forEach(n => { (m[n] = m[n] || []).push(x) }) })
    return m
  }, [projects, statVer])
  const statDone = (projects || []).every(x => statCache[x.maDA])

  const qq = q.trim().toLowerCase()
  const nSel = Object.keys(nganhF)
  const shown = sups.filter(o => (!qq || o.ten.toLowerCase().indexOf(qq) >= 0 || Object.keys(o.dist).some(d => d.toLowerCase().indexOf(qq) >= 0))
    && (!nSel.length || nSel.some(n => o.nganh[n])))
  const nganhCnt = {}
  sups.forEach(o => Object.keys(o.nganh).forEach(n => { nganhCnt[n] = (nganhCnt[n] || 0) + 1 }))

  const ds = detail ? sups.find(o => o.ten === detail) : null
  if (ds) return <SupplierDetail o={ds} projs={projOf[ds.ten] || []} statDone={statDone} onBack={() => setDetail('')} L={L} />

  return (
    <div className="qs-sup">
      <div className="qs-pg-head">
        <div className="qs-pg-mod qs-pg-flt">
          <div className="qs-pg-dd" ref={ddRef}>
            <button type="button" className={`qs-pg-ddb${nSel.length ? ' on' : ''}`} onClick={() => setOpen(v => !v)}>
              {nSel.length === 1 ? <><span className="lb">Ngành hàng:</span> {nodeName(nSel[0])}</> : nSel.length ? <><span className="lb">Ngành hàng:</span> {nSel.length} đã chọn</> : 'Ngành hàng'}
              <Icon name="chevronDown" size={14} />
            </button>
            {open && (
              <div className="qs-pg-ddm multi">
                <div className="qs-pg-ddq"><Icon name="search" size={14} /><input autoFocus placeholder="Tìm ngành hàng…" value={ddq} onChange={e => setDdq(e.target.value)} /></div>
                <div className="qs-pg-ddl">
                  {Object.keys(nganhCnt).sort().filter(n => !ddq.trim() || qbNorm_(n + ' ' + nodeName(n)).indexOf(qbNorm_(ddq.trim())) >= 0).map(n => (
                    <label key={n} className={`qs-pg-ddi${nganhF[n] ? ' on' : ''}`}>
                      <input type="checkbox" checked={!!nganhF[n]} onChange={() => setNganhF(f => { const x = { ...f }; if (x[n]) delete x[n]; else x[n] = 1; return x })} />
                      <span title={n + '. ' + nodeName(n)}>{nodeName(n)}</span><small>{nganhCnt[n]}</small>
                    </label>
                  ))}
                </div>
                <div className="qs-pg-ddf">
                  <button type="button" disabled={!nSel.length} onClick={() => setNganhF({})}>Bỏ chọn</button>
                  <button type="button" className="ok" onClick={() => setOpen(false)}>Xong</button>
                </div>
              </div>
            )}
          </div>
          {nSel.length > 0 && <button type="button" className="qs-pg-clear" onClick={() => setNganhF({})}>Xoá lọc ({nSel.length})</button>}
        </div>
        <div className="qs-pg-mod qs-pg-views" role="group" aria-label="Chế độ xem">
          {VIEWS.map(v => <button type="button" key={v[0]} className={view === v[0] ? 'on' : ''} onClick={() => setView(v[0])}><Icon name={v[2]} size={15} /><span>{v[1]}</span></button>)}
        </div>
        {view !== 'list' && (
          <label className="qs-pg-mod qs-pg-cols" title="Kéo để đổi số cột">
            <span>Cột</span>
            <input type="range" min="2" max="10" step="1" value={nCol} onChange={e => setCols(Number(e.target.value))} />
            <b>{nCol}</b>
          </label>
        )}
        <span className="qs-pg-n">{shown.length} nhà cung cấp</span>
        <div className="qs-pg-search qs-pg-mod">
          <Icon name="search" size={16} />
          <input placeholder="Tìm nhà cung cấp, nhà phân phối…" value={q} onChange={e => setQ(e.target.value)} />
          {q && <button type="button" className="qs-pg-x" title="Xoá" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}
        </div>
      </div>

      {shown.length ? (
        <div className={'qs-sup-grid ' + view} style={view !== 'list' ? { '--cols': nCol } : undefined}>
          {shown.map(o => {
            const all = [...new Set(o.sp.map(p => img1(p.hinhAnh)).filter(Boolean))]
            const imgs = all.slice(0, 3)
            const pj = projOf[o.ten] || []
            const ngs = Object.keys(o.nganh).sort((a, b) => o.nganh[b] - o.nganh[a])
            const logo = L.logos[o.ten]
            return (
              <div key={o.ten} className="qs-sup-card" style={{ '--h': hue_(o.ten) }} onClick={() => setDetail(o.ten)} title={'Xem nhà cung cấp ' + o.ten}>
                {/* Module 1: logo thương hiệu (chưa có -> chữ viết tắt + nút Thêm logo) */}
                {view !== 'logo' && (
                  <div className={'qs-sup-m1' + (logo ? '' : ' none')}>
                    {logo ? <img src={mediaUrl(logo)} alt={'Logo ' + o.ten} loading="lazy" /> : <b className="ini">{o.ten.slice(0, 2).toUpperCase()}</b>}
                    <LogoPick className="qs-sup-logobtn" title={logo ? 'Đổi logo' : 'Thêm logo'} onFile={f => L.upload(o.ten, f)}><Icon name={logo ? 'edit' : 'upload'} size={13} /><span>{logo ? 'Đổi logo' : 'Thêm logo'}</span></LogoPick>
                  </div>
                )}
                {/* Module 2: 3 hình ảnh sản phẩm tiêu biểu (thiếu ảnh -> ô trống) */}
                {(view === 'grid' || view === 'list') && (
                  <div className="qs-sup-m2">
                    {[0, 1, 2].map(j => <span key={j} className={imgs[j] ? '' : 'emp'}>{imgs[j] ? <img src={imgs[j]} alt="" loading="lazy" /> : null}</span>)}
                  </div>
                )}
                {/* Module 3: thông tin (tên, gạch ngang, ngành hàng, số liệu, giá) */}
                <div className="qs-sup-body">
                  <div className="qs-sup-name">{view === 'logo' && logo && <img className="mini" src={mediaUrl(logo)} alt="" />}{o.ten}</div>
                  <hr className="qs-sup-hr" />
                  <div className="qs-sup-tags">{ngs.length ? ngs.map(n => <span key={n} title={n + '. ' + nodeName(n)}>{nodeName(n)}</span>) : <i>Chưa rõ ngành hàng</i>}</div>
                  <div className="qs-sup-meta"><span><b>[{o.sp.length}]</b> sản phẩm</span><span><b>[{statDone ? pj.length : '…'}]</b> dự án</span></div>
                  <div className="qs-sup-price">{o.max > 0 ? (o.min === o.max ? money(o.min) + ' đ' : money(o.min) + ' – ' + money(o.max) + ' đ') : 'Chưa có giá'}</div>
                </div>
              </div>
            )
          })}
        </div>
      ) : <div className="qs-pg-empty">Không có nhà cung cấp khớp tìm kiếm / bộ lọc.</div>}
    </div>
  )
}

/* Trang chi tiết 1 nhà cung cấp */
/* Chế độ xem tab Sản phẩm của nhà cung cấp (nhớ trong máy): Lưới lớn · Lưới nhỏ · Bảng · Danh sách */
const SPD_VIEWS = [['grid', 'Lưới lớn', 'grid'], ['small', 'Lưới nhỏ', 'table'], ['table', 'Bảng', 'sliders'], ['list', 'Danh sách', 'listLines']]
const spdGet = () => { try { const v = localStorage.getItem('qs_sup_spview'); return SPD_VIEWS.some(x => x[0] === v) ? v : 'grid' } catch (e) { return 'grid' } }
/* 2 nút trên mỗi sản phẩm: "Thêm vào bóc tách" (dự án đang mở; đã có trong dự án -> "Đang có", bấm vẫn cộng số lượng)
   · "Ghi danh vào dự án" (bảng chọn nhiều dự án, dùng lại MultiProjPop của modal Thông tin sản phẩm) */
function SpActs({ p, cur, has, onMulti, compact }) {
  return (
    <div className={'qs-sup-acts' + (compact ? ' compact' : '')} onClick={e => e.stopPropagation()}>
      <button type="button" className={'add' + (has ? ' has' : '')} disabled={!cur}
        title={!cur ? 'Chưa mở dự án nào — chọn dự án ở Bóc tách' : (has ? 'Đã có trong "' + cur.ten + '" — bấm để cộng thêm số lượng' : 'Thêm vào bóc tách của "' + cur.ten + '"')}
        onClick={() => spAddToProject(p)}>
        <Icon name={has ? 'check' : 'plus'} size={13} /><span>{has ? 'Đang có' : 'Thêm vào bóc tách'}</span>
      </button>
      <button type="button" className="multi" title="Ghi danh vào nhiều dự án" onClick={() => onMulti(p)}><Icon name="layers" size={13} /><span>Ghi danh vào dự án</span></button>
    </div>
  )
}
function SupplierDetail({ o, projs, statDone, onBack, L }) {
  const { cur, lines } = useQs()
  const [multiP, setMultiP] = useState(null)
  const inCur = useMemo(() => {
    const m = {}
    if (cur) (lines || []).forEach(l => { if (l.maSP) m['m:' + l.maSP] = 1; if (l.ten) m['t:' + l.ten] = 1 })
    return m
  }, [cur, lines])
  const has = p => !!(cur && ((p.ma && inCur['m:' + p.ma]) || inCur['t:' + p.ten]))
  const acts = (p, compact) => <SpActs p={p} cur={cur} has={has(p)} onMulti={setMultiP} compact={compact} />
  const [spv, setSpvSt] = useState(spdGet)
  const setSpv = v => { setSpvSt(v); try { localStorage.setItem('qs_sup_spview', v) } catch (e) { /* bỏ qua */ } }
  const [tab, setTab] = useState('sp')
  const [hm, setHm] = useState('')
  const hms = Object.keys(o.hm).sort((a, b) => o.hm[b] - o.hm[a])
  const sp = hm ? o.sp.filter(p => s_(p.hangMuc) === hm) : o.sp
  const dists = Object.keys(o.dist).sort((a, b) => o.dist[b] - o.dist[a])
  const NI = useNccInfo()
  const hs = NI.info[o.ten] || {}
  const saveHs = part => NI.patch(o.ten, part)
  const TABS = [['sp', 'Sản phẩm', o.sp.length], ['pj', 'Dự án đang dùng', projs.length], ['dist', 'Nhà phân phối', dists.length],
    ['intro', 'Giới thiệu', 0], ['partner', 'Đối tác', (hs.doiTac || []).length], ['cat', 'Catalogue', (hs.catalogue || []).length]]
  return (
    <div className="qs-pd">
      {multiP && (
        <MrootPortal>
          <div className="qsc-ov qspl-ov" onMouseDown={e => { if (e.target === e.currentTarget) setMultiP(null) }}>
            <div className="qspl-pd qs-sup-mpbox"><MultiProjPop p={multiP} onClose={() => setMultiP(null)} /></div>
          </div>
        </MrootPortal>
      )}
      <div className="qs-pd-top">
        <button type="button" className="qs-pd-back" onClick={onBack}><Icon name="arrowLeft" size={16} /> Nhà cung cấp</button>
      </div>
      <div className="qs-pd-title">
        <div className="qs-sup-dlogo">
          {L.logos[o.ten] ? <img src={mediaUrl(L.logos[o.ten])} alt={'Logo ' + o.ten} /> : <span>{o.ten.slice(0, 2).toUpperCase()}</span>}
        </div>
        <h1>{o.ten}</h1>
        <LogoPick className="qs-pd-btn" onFile={f => L.upload(o.ten, f)}><Icon name="upload" size={14} /> {L.logos[o.ten] ? 'Đổi logo' : 'Thêm logo'}</LogoPick>
        {L.logos[o.ten] && <button type="button" className="qs-pd-btn" onClick={() => L.remove(o.ten)}><Icon name="x" size={14} /> Xoá logo</button>}
        <span className="sum"><b>{o.sp.length}</b> sản phẩm · <b>{statDone ? projs.length : '…'}</b> dự án đang dùng{o.max > 0 ? <> · giá {money(o.min)} – {money(o.max)} đ</> : null}</span>
      </div>
      <div className="qs-pd-tabs" role="tablist">
        {TABS.map(t => <button type="button" role="tab" key={t[0]} aria-selected={tab === t[0]} className={tab === t[0] ? 'on' : ''} onClick={() => setTab(t[0])}>{t[1]}{t[2] ? <small>{t[2]}</small> : null}</button>)}
      </div>
      {tab === 'sp' && (
        <div className="qs-pd-sec">
          <div className="qs-pd-spbar">
            {hms.length > 1 ? (
              <div className="qs-pd-nganh">
                <button type="button" className={!hm ? 'on' : ''} onClick={() => setHm('')}>Tất cả<small>{o.sp.length}</small></button>
                {hms.map(h => <button type="button" key={h} className={hm === h ? 'on' : ''} onClick={() => setHm(h)}>{h}<small>{o.hm[h]}</small></button>)}
              </div>
            ) : <span />}
            <div className="qs-pd-spv" role="group" aria-label="Chế độ xem sản phẩm">
              {SPD_VIEWS.map(v => <button type="button" key={v[0]} className={spv === v[0] ? 'on' : ''} title={'Xem dạng ' + v[1]} onClick={() => setSpv(v[0])}><Icon name={v[2]} size={15} /><span>{v[1]}</span></button>)}
            </div>
          </div>
          {spv === 'table' ? (
            <div className="qs-pd-sp">
              <div className="qs-pd-sprow head qs-sup-sprow"><span>Ảnh</span><span>Sản phẩm</span><span>Mã</span><span>Hạng mục</span><span>Trạng thái</span><span className="r">Giá</span><span /></div>
              {sp.map(p => (
                <div key={p.recordId || p.ma} className="qs-pd-sprow qs-sup-sprow">
                  <ProductThumb product={p} size={44} src={img1(p.hinhAnh)} />
                  <span className="nm" title={p.ten}>{p.ten}</span>
                  <span>{p.ma || '—'}</span>
                  <span>{p.hangMuc || '—'}</span>
                  <span>{p.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span>
                  <span className="r b">{money(p.donGiaBan)} đ</span>
                  {acts(p, true)}
                </div>
              ))}
            </div>
          ) : spv === 'list' ? (
            <div className="qs-sup-splist">
              {sp.map(p => (
                <div key={p.recordId || p.ma} className="qs-sup-spli">
                  <span className="im"><ProductThumb product={p} size={96} src={img1(p.hinhAnh)} /></span>
                  <div className="tx"><b title={p.ten}>{p.ten}</b><span>{[p.ma, p.hangMuc, p.ncc].filter(v => s_(v)).join(' · ')}</span><span>{p.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span></div>
                  <b className="tt">{money(p.donGiaBan)} đ</b>
                  {acts(p)}
                </div>
              ))}
            </div>
          ) : (
          <div className={'qs-pd-spgrid' + (spv === 'small' ? ' small' : '')}>
            {sp.map(p => (
              <div key={p.recordId || p.ma} className="qs-pd-spcard">
                <div className="img"><ProductThumb product={p} size={150} src={img1(p.hinhAnh)} /></div>
                <b title={p.ten}>{p.ten}</b>
                <span className="br">{[p.ma, p.hangMuc].filter(v => s_(v)).join(' · ')}</span>
                <div className="ft"><span>{p.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span><b className="tt">{money(p.donGiaBan)} đ</b></div>
                {acts(p, spv === 'small')}
              </div>
            ))}
          </div>
          )}
        </div>
      )}
      {tab === 'pj' && (
        <div className="qs-pd-sec">
          {projs.length ? (
            <div className="qs-pd-rel">
              {projs.map(x => (
                <button type="button" key={x.maDA} className="qs-pd-relc" title="Mở trang Danh sách dự án" onClick={() => showTab('dsduan')}>
                  <b>{x.ten}</b><span>{[x.khachHang, x.trangThai || 'Bản nháp'].filter(v => s_(v)).join(' · ')}</span>
                </button>
              ))}
            </div>
          ) : <div className="qs-pd-empty">{statDone ? 'Chưa có dự án nào dùng sản phẩm của nhà cung cấp này.' : 'Đang đếm…'}</div>}
        </div>
      )}
      {tab === 'dist' && (
        <div className="qs-pd-sec">
          {dists.length ? (
            <div className="qs-pd-ncc">
              {dists.map(d => <div key={d} className="qs-pd-nccc"><b>{d}</b><span>{o.dist[d]} sản phẩm</span></div>)}
            </div>
          ) : <div className="qs-pd-empty">Sản phẩm chưa ghi nhà phân phối.</div>}
        </div>
      )}
      {tab === 'intro' && <div className="qs-pd-sec"><IntroTab key={o.ten} ten={o.ten} d={hs} onSave={saveHs} /></div>}
      {tab === 'partner' && <div className="qs-pd-sec"><PartnerTab ten={o.ten} d={hs} onSave={saveHs} projs={projs} /></div>}
      {tab === 'cat' && <div className="qs-pd-sec"><CatalogueTab key={o.ten} ten={o.ten} d={hs} onSave={saveHs} sp={o.sp} /></div>}
    </div>
  )
}
