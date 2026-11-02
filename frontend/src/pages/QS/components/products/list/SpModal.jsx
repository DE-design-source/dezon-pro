import { useEffect, useRef, useState } from 'react'
import QsIcon from '../../common/QsIcon'
import ImgViewer from '../../common/ImgViewer'
import ProductThumb from '../../common/ProductThumb'
import { MrootPortal } from '../../common/Mroot'
import { DocRows, safeUrl_ } from '../../common/DocsPopover'
import * as api from '../../../api/qsApi'
import { isAbort } from '../../../api/http'
import { mediaUrl } from '../../../api/files'
import { money } from '../../../lib/format.js'
import { coSpec_, nganhCuaSP_, prodDocs_ } from '../../../lib/productFields.js'
import { pdImgs_, pdKeyItems_, pdSpecBlocks_ } from '../../breakdown/catalog/catalogModel'
import { putCombo } from '../../breakdown/catalog/comboCache'
import { spKey_ } from './spModel'
import { spAddToProject, spAddCombo, spPrivateCopy, spAddToProjects } from './spActions'
import { getState, showTab } from '../../../state/store'
import { qsAsk, getDialogs } from '../../common/dialogs'
import { importProjectForm } from '../../project/projectActions'

/* Modal "Thông tin sản phẩm" của tab Danh sách SP (spModal, PUB/sanpham.js:1827-1848): ảnh + thông số (pdMedia_ / pdSpecs_ /
   pdPriceFoot_, app.js:1076-1282), khối "Sản phẩm đi kèm" ghi vào DỰ ÁN (pdLoadCombo_ / pdComboVe_ / pdCbBoSet_ / pdCbSL_ /
   pdAddCombo_, sanpham.js:1849-1930), ←/→ lật ảnh, Esc đóng (spModalKey_).
   SP kho chung Dezon (spChung, chỉ xem): nút "Tạo bản sao riêng" (M10.1) chép sang công ty mình rồi mở form sửa bản sao.
   Props: product, specs ({VS_SPEC,...} | null), specErr, canEdit, onClose(), onEdit(product). */
export default function SpModal({ product, specs, specErr, canEdit, onClose, onEdit }) {
  const p = product || {}
  const imgs = pdImgs_(p).map(v => mediaUrl(v))
  const [idx, setIdx] = useState(0)
  const [view, setView] = useState('')
  const [bad, setBad] = useState('')
  const [pcBusy, setPcBusy] = useState(false)
  const [multi, setMulti] = useState(false)     // hộp Ghi danh vào nhiều dự án
  const n = imgs.length
  const at = n ? (((idx % n) + n) % n) : 0
  const go = d => { if (n > 1) setIdx(i => (((i + d) % n) + n) % n) }
  const goRef = useRef(go); goRef.current = go
  const viewRef = useRef(view); viewRef.current = view
  const closeRef = useRef(onClose); closeRef.current = onClose

  useEffect(() => {
    const key = e => {
      if (viewRef.current) return                       // đang xem ảnh lớn: ImgViewer lo phím
      const a = document.activeElement, tg = a ? a.tagName : ''
      if (e.key === 'Escape') { closeRef.current(); return }
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); goRef.current(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goRef.current(1) }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  const ng = nganhCuaSP_(p, specs)
  const keyItems = pdKeyItems_(p, specs)
  const blocks = pdSpecBlocks_(p, specs)
  const docs = prodDocs_(p)
  const specMissing = coSpec_(ng) && !specs
  const main = imgs[at]

  async function privateCopy() {
    if (pcBusy) return
    setPcBusy(true)
    let np = null
    try { np = await spPrivateCopy(p) } finally { setPcBusy(false) }
    if (np) { onClose(); onEdit(np) }
  }

  return (
    <MrootPortal>
      <div className="qsc-ov qspl-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qspl-pd" role="dialog" aria-label="Thông tin sản phẩm">
          <div className="qspl-pd-head">
            <h3>Thông tin sản phẩm</h3>
            <span className={`qspl-duyet${p.daDuyet ? ' on' : ''}`}>{p.daDuyet ? 'Đã duyệt' : 'Chưa duyệt'}</span>
            <button type="button" className="qspl-pd-x" title="Đóng" onClick={onClose}>✕</button>
          </div>
          {multi && <MultiProjPop p={p} onClose={() => setMulti(false)} onGallery={() => { setMulti(false); onClose(); showTab('dsduan') }} />}
          <div className="qspl-pdm-grid">
            <div className="qspl-pdm-left">
              <div className="qspl-pd-gal">
                <div className="qspl-pd-imgbox">
                  {main
                    ? <img src={main} alt="" title="Bấm để xem ảnh lớn" style={bad === main ? { visibility: 'hidden' } : null}
                        onError={() => setBad(main)} onClick={() => setView(main)} />
                    : <span className="qspl-pd-noimg"><QsIcon name="image" size={26} /><i>Chưa có ảnh</i></span>}
                  {n > 1 && <button type="button" className="qspl-pd-nav prev" title="Ảnh trước (←)" onClick={() => go(-1)}>‹</button>}
                  {n > 1 && <button type="button" className="qspl-pd-nav next" title="Ảnh sau (→)" onClick={() => go(1)}>›</button>}
                  {n > 1 && <span className="qspl-pd-count">{at + 1}/{n}</span>}
                  {main && <a className="qspl-pd-dl" href={safeUrl_(imgs[0])} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc"><QsIcon name="download" size={14} /></a>}
                </div>
                {n > 1 && (
                  <div className="qspl-pd-thumbs">
                    {imgs.map((v, i) => (
                      <button type="button" key={i} className={`qspl-pd-thumb${i === at ? ' on' : ''}`} title={'Ảnh ' + (i + 1)} onClick={() => setIdx(i)}>
                        <img src={v} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="qspl-pd-code">{p.ma || p.ten}</div>
              {p.ten && <div className="qspl-pd-name">{p.ten}</div>}
              {keyItems.length > 0 && (
                <>
                  <div className="qspl-pd-sec">Key Product Info <i>(Thông tin chính)</i></div>
                  <div className="qspl-pd-keys">
                    {keyItems.map((x, i) => <div key={i} className="qspl-pd-key"><span className="ic"><QsIcon name={x[0]} size={15} /></span><span>{x[1]}</span></div>)}
                  </div>
                </>
              )}
              <div className="qspl-pd-sec">Tài liệu <i>({docs.length} file)</i></div>
              {docs.length
                ? <div className="qspl-pd-docs"><DocRows docs={docs} /></div>
                : <div className="qspl-pd-nodoc">Sản phẩm chưa có tài liệu — thêm ở Nhập dữ liệu hoặc Sửa sản phẩm.</div>}
              <div className="qspl-pd-price"><span>Đơn giá</span><b>{money(p.donGiaBan)} đ</b></div>
            </div>
            <div className="qspl-pdm-right">
              {specMissing && <div className="qspl-note err">{specErr ? 'Không tải được thông số ngành' : 'Đang tải thông số ngành…'}</div>}
              {blocks.map((b, i) => (
                <div key={i} className="qspl-pd-block">
                  <div className="qspl-pd-sec">{b.en}{b.vn ? <> <i>({b.vn})</i></> : null}</div>
                  {b.type === 'bullets'
                    ? <ul className="qspl-pd-list">{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>
                    : b.rows.map((r, j) => (r[0] == null
                      ? <div key={j} className="qspl-pd-kv"><b className="line">{r[1]}</b></div>
                      : <div key={j} className="qspl-pd-kv"><span>{r[0]}</span><b>{r[1]}</b></div>))}
                </div>
              ))}
            </div>
          </div>
          <SpCombo key={spKey_(p)} product={p} />
          <div className="qspl-pd-actions">
            <button type="button" className="qsc-btn" onClick={onClose}>Đóng</button>
            {canEdit && !p.spChung && <button type="button" className="qsc-btn" onClick={() => { onClose(); onEdit(p) }}><QsIcon name="edit" size={14} /> Cập nhật</button>}
            {canEdit && p.spChung && (
              <button type="button" className="qsc-btn qspl-pcopy" disabled={pcBusy} onClick={privateCopy}
                title="Sản phẩm kho chung Dezon chỉ xem — chép thành sản phẩm riêng của công ty bạn để sửa">
                <QsIcon name="copy" size={14} /> {pcBusy ? 'Đang tạo bản sao…' : 'Tạo bản sao riêng'}
              </button>
            )}
            <span className="qspl-multi-wrap">
              <button type="button" className={`qsc-btn${multi ? ' on' : ''}`} title="Chọn nhiều dự án để ghi danh sản phẩm này một lần" onClick={() => setMulti(m => !m)}>
                <QsIcon name="layers" size={14} /> Ghi danh vào nhiều dự án
              </button>
            </span>
            <button type="button" className="qsc-btn blue" onClick={() => spAddToProject(p)}><QsIcon name="plus" size={15} /> Thêm vào dự án</button>
          </div>
        </div>
      </div>
      {view && <ImgViewer src={view} gallery={imgs} onClose={() => setView('')} onIndexChange={i => setIdx(i)} />}
    </MrootPortal>
  )
}

/* Ô số SL / Số bộ: đổi xong (rời ô / Enter) mới tính lại, ô trống giữ số cũ (onchange của bản gốc) */
function NumIn({ value, onCommit, ...rest }) {
  const [d, setD] = useState(String(value))
  useEffect(() => { setD(String(value)) }, [value])
  return (
    <input type="number" min="1" step="1" {...rest} value={d}
      onChange={e => setD(e.target.value)}
      onBlur={() => { if (d !== '') onCommit(d); else setD(String(value)) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

/* Khối "Sản phẩm đi kèm": số bộ (1-999), SL kèm mỗi dòng (1-9999, sửa tạm không lưu), "Thêm combo" vào dự án */
function SpCombo({ product }) {
  const k = spKey_(product)
  const [st, setSt] = useState({ loading: !!k, list: [], error: '' })
  const [bo, setBo] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!k) return undefined
    const ctl = new AbortController()
    api.getCombo(k, ctl.signal).then(list => {
      list = list || []
      putCombo(k, list)        // bản SAO cho thư viện / dòng combo của bảng (S._catCb)
      setSt({ loading: false, list: list.map(x => ({ ...x })), error: '' })
    }, e => {
      if (isAbort(e)) return
      setSt({ loading: false, list: [], error: (e && e.message) || 'lỗi' })
    })
    return () => ctl.abort()
  }, [k])

  if (st.error) return <div className="qspl-note err">Không tải được sản phẩm đi kèm: {st.error}</div>
  const list = st.list
  if (!list.length) return null
  const boN = Math.max(1, Math.min(999, Number(bo) || 1))
  const tong = list.reduce((a, x) => a + (Number(x.donGiaBan) || 0) * (Number(x.comboSL) || 1) * boN, 0)
  const setBoTo = v => setBo(Math.max(1, Math.min(999, Math.round(Number(String(v).replace(',', '.')) || 0) || 1)))
  const setSl = (j, v) => setSt(s => ({
    ...s,
    list: s.list.map((x, i) => (i === j ? { ...x, comboSL: Math.max(1, Math.min(9999, Math.round(Number(String(v).replace(',', '.')) || 0) || 1)) } : x)),
  }))
  async function addAll() {
    if (busy) return
    setBusy(true)
    try { await spAddCombo(product, list, boN) } finally { setBusy(false) }
  }

  return (
    <div className="qspl-pcb">
      <div className="qspl-pcb-h"><span className="t"><QsIcon name="layers" size={14} /> Sản phẩm đi kèm</span><span className="n">{list.length}</span></div>
      <div className="qspl-pcb-list">
        {list.map((x, j) => {
          const sl = Number(x.comboSL) || 1, dg = Number(x.donGiaBan) || 0, slTong = sl * boN
          return (
            <div key={j} className="qspl-pcb-r" title={x.comboNguoc ? 'Liên kết đặt từ phía sản phẩm kia — đi kèm 2 chiều' : undefined}>
              <ProductThumb product={x} size={34} src={x.hinhAnh ? mediaUrl(String(x.hinhAnh).split('\n')[0].trim()) : ''} />
              <div className="qspl-pcb-m">
                <b>{x.ten || ''}{x.comboNguoc && <span className="rev"> ↔</span>}</b>
                <span>{x.ma || ''}{x.ma ? ' · ' : ''}{money(dg)} đ</span>
                {String(x.comboGhiChu || '').trim() && (
                  <span className="qspl-pcb-gc" title="Ghi chú của sản phẩm đi kèm"
                    style={{ color: 'var(--text)', fontStyle: 'italic', whiteSpace: 'normal', wordBreak: 'break-word' }}>Ghi chú: {String(x.comboGhiChu).trim()}</span>
                )}
              </div>
              <div className="qspl-pcb-p">
                <b>{money(dg * slTong)} đ</b>
                <label title="Số lượng đi kèm cho MỖI bộ">SL <NumIn value={sl} onClick={e => e.stopPropagation()} onCommit={v => setSl(j, v)} />
                  {boN > 1 && <em>× {boN} = {slTong}</em>}</label>
              </div>
            </div>
          )
        })}
      </div>
      <div className="qspl-pcb-tot"><span>Tổng {boN > 1 ? boN + ' bộ' : 'combo'}</span><b>{money(tong)} đ</b></div>
      <div className="qspl-pcb-ft">
        <span className="qspl-pcb-bo" title="Số bộ combo cần thêm"><label>Số bộ</label>
          <button type="button" onClick={() => setBoTo(boN - 1)} aria-label="Bớt 1 bộ">−</button>
          <NumIn value={boN} onCommit={setBoTo} />
          <button type="button" onClick={() => setBoTo(boN + 1)} aria-label="Thêm 1 bộ">+</button></span>
        <button type="button" className="qsc-btn blue qspl-pcb-add" disabled={busy} title="Thêm sản phẩm chính và toàn bộ sản phẩm đi kèm vào dự án" onClick={addAll}>
          <QsIcon name="plus" size={14} /> Thêm {boN > 1 ? boN + ' bộ' : 'combo'}
        </button>
      </div>
    </div>
  )
}

/* Bảng "Ghi danh vào nhiều dự án": phủ thân modal. Trái = bộ lọc (tìm, Khách hàng, Khu vực, Trạng thái, Phân khúc, Quy mô —
   chọn nhiều, mỗi nhóm OR, giữa các nhóm AND); phải = danh sách dự án tick nhiều (dự án đang mở đánh dấu); chân = số lượng + Lưu.
   Khu vực = đoạn cuối của địa chỉ (sau dấu phẩy cuối). Dự án chưa có trường Studio / Kiến trúc sư nên chưa lọc được theo đó. */
const kv_ = x => { const a = String(x.diaChi || '').split(',').map(t => t.trim()).filter(Boolean); return a.length ? a[a.length - 1] : '' }
/* Nhóm lọc: [khoá, tên, lấy giá trị, tuỳ chọn {fixed: danh sách giá trị cố định, empty: ghi chú khi chưa có dữ liệu}].
   Nền tảng: Dezon.vn = dự án đã gắn link bài dezon.vn, Dezon Pro = chưa gắn link; "Dự án của tôi" chưa có dữ liệu người tạo.
   Studio / Kiến trúc sư: đọc x.studio / x.kienTrucSu — dự án chưa có 2 trường này (cần thêm vào database + form Thông tin dự án) */
const MP_GROUPS = [
  ['nenTang', 'Nền tảng', x => (String(x.linkDezon || '').trim() ? 'Dezon.vn' : 'Dezon Pro'), { fixed: ['Dezon.vn', 'Dezon Pro', 'Dự án của tôi'] }],
  ['studio', 'Studio', x => String(x.studio || '').trim(), { empty: 'Chưa có dữ liệu Studio trong thông tin dự án' }],
  ['kts', 'Kiến trúc sư', x => String(x.kienTrucSu || '').trim(), { empty: 'Chưa có dữ liệu Kiến trúc sư trong thông tin dự án' }],
  ['khachHang', 'Khách hàng', x => String(x.khachHang || '').trim()],
  ['khuVuc', 'Khu vực', kv_],
  ['trangThai', 'Trạng thái', x => String(x.trangThai || '').trim() || 'Bản nháp'],
  ['phanKhuc', 'Phân khúc', x => String(x.phanKhuc || '').trim()],
  ['quyMo', 'Quy mô', x => String(x.quyMo || '').trim()],
]
export function MultiProjPop({ p, onClose, onGallery }) {
  const projects = getState().projects || []
  const curMa = getState().cur ? getState().cur.maDA : ''
  const [q, setQ] = useState('')
  const [flt, setFlt] = useState({})            // {nhóm: {giá trị: 1}}
  const [pick, setPick] = useState(() => new Set())
  const [onlyPicked, setOnlyPicked] = useState(false)
  /* Thu gọn từng nhóm lọc (nhớ trong máy) */
  const [gFold, setGFoldSt] = useState(() => { try { return JSON.parse(localStorage.getItem('qs_mp_fold') || '{}') || {} } catch (e) { return {} } })
  const togFold = k => setGFoldSt(f => { const n = { ...f, [k]: !f[k] }; try { localStorage.setItem('qs_mp_fold', JSON.stringify(n)) } catch (e) { /* bỏ qua */ } return n })
  const gHead = (k, title, nOn) => (
    <button type="button" className="qspl-mp-gt" aria-expanded={!gFold[k]} title={gFold[k] ? 'Mở rộng' : 'Thu gọn'} onClick={() => togFold(k)}>
      <span>{title}{nOn ? <em>{nOn}</em> : null}</span>
      <span className={'qspl-mp-chev' + (gFold[k] ? ' closed' : '')} aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg></span>
    </button>
  )
  const [sl, setSl] = useState(1)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    // Esc khi đang mở hộp nhập (Ghi danh dự án mới) chỉ đóng hộp nhập
    const key = e => { if (e.key === 'Escape' && !getDialogs().asks.length) onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const qq = q.trim().toLowerCase()
  const passGroup = (x, skip) => MP_GROUPS.every(g => { if (g[0] === skip) return true; const m = flt[g[0]]; return !m || !Object.keys(m).length || !!m[g[2](x)] })
  const passQ = x => !qq || [x.ten, x.khachHang, x.diaChi, x.sdt].some(v => String(v || '').toLowerCase().indexOf(qq) >= 0)
  const shown = projects.filter(x => passQ(x) && passGroup(x) && (!onlyPicked || pick.has(x.maDA)))
  const toggleF = (g, v) => setFlt(f => { const m = { ...(f[g] || {}) }; if (m[v]) delete m[v]; else m[v] = 1; return { ...f, [g]: m } })
  const nFlt = Object.values(flt).reduce((n, m) => n + Object.keys(m || {}).length, 0)
  const toggle = ma => setPick(s0 => { const n = new Set(s0); if (n.has(ma)) n.delete(ma); else n.add(ma); return n })
  const allOn = shown.length > 0 && shown.every(x => pick.has(x.maDA))
  const toggleAll = () => setPick(s0 => { const n = new Set(s0); shown.forEach(x => (allOn ? n.delete(x.maDA) : n.add(x.maDA))); return n })
  async function save() {
    if (!pick.size || busy) return
    setBusy(true)
    try { const r = await spAddToProjects(p, [...pick], sl); if (!r.fail) onClose() } finally { setBusy(false) }
  }
  /* "Ghi danh dự án mới": tạo dự án (chỉ thêm vào danh sách, không đổi dự án đang mở) rồi ghi danh SP này vào đó với Số lượng đang chọn */
  async function newProject() {
    if (busy) return
    const r = await qsAsk({
      title: 'Ghi danh vào dự án mới', note: 'Tạo dự án mới rồi ghi danh "' + (p.ten || '') + '" ×' + sl + ' vào dự án đó.', ok: 'Tạo & ghi danh',
      fields: [
        { key: 'ten', label: 'Tên dự án *', placeholder: 'VD: Nhà phố anh Thành' },
        { key: 'kienTrucSu', label: 'Kiến trúc sư' },
        { key: 'khachHang', label: 'Khách hàng' },
        { key: 'diaChi', label: 'Địa điểm', placeholder: 'Số nhà, đường, quận, tỉnh / thành' },
      ],
    })
    if (!r) return
    setBusy(true)
    try {
      const np = await importProjectForm({ ...r, vat: 0 })
      if (np) { const res = await spAddToProjects(p, [np.maDA], sl); if (!res.fail) onClose() }
    } finally { setBusy(false) }
  }
  return (
    <div className="qspl-mp" ref={ref} role="dialog" aria-label="Ghi danh vào nhiều dự án">
      <div className="qspl-mp-h">
        <b>Ghi danh vào nhiều dự án</b><span className="sub">{p.ten}</span>
        <button type="button" className="qspl-pd-x" title="Đóng (Esc)" onClick={onClose}>✕</button>
      </div>
      <div className="qspl-mp-body">
        <aside className="qspl-mp-flt">
          {onGallery && (
            <button type="button" className="qspl-mp-gal" title="Mở trang Danh sách dự án (dạng lưới thẻ)" onClick={onGallery}>
              <QsIcon name="sliders" size={14} /> Trang danh sách dự án <span aria-hidden="true">↗</span>
            </button>
          )}
          <div className="qspl-mp-mod qspl-mp-top">
          <div className="qspl-mp-fh"><b>Bộ lọc</b>
            {nFlt > 0 && <button type="button" className="qsc-btn qspl-xs" onClick={() => setFlt({})}>Xoá lọc ({nFlt})</button>}
            <button type="button" className="qsc-btn blue qspl-xs qspl-mp-new" disabled={busy} title="Tạo dự án mới rồi ghi danh sản phẩm này vào đó" onClick={newProject}>
              <QsIcon name="plus" size={13} /> Ghi danh dự án mới
            </button>
          </div>
          <input className="qspl-multi-q" placeholder="Tìm tên dự án, khách hàng, địa chỉ…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          </div>
          {MP_GROUPS.map(g => {
            const cnt = {}
            projects.forEach(x => { if (!passQ(x) || !passGroup(x, g[0])) return; const v = g[2](x); if (v) cnt[v] = (cnt[v] || 0) + 1 })
            const opt = g[3] || {}
            const keys = opt.fixed ? opt.fixed.slice() : Object.keys(cnt).sort((a, b) => a.localeCompare(b, 'vi'))
            const m = flt[g[0]] || {}
            Object.keys(m).forEach(v => { if (keys.indexOf(v) < 0) keys.push(v) })
            if (!keys.length && opt.empty) return (
              <div key={g[0]} className={'qspl-mp-grp qspl-mp-mod' + (gFold[g[0]] ? ' folded' : '')}>{gHead(g[0], g[1], 0)}{!gFold[g[0]] && <div className="qspl-mp-empty">{opt.empty}</div>}</div>
            )
            if (!keys.length) return null
            return (
              <div key={g[0]} className={'qspl-mp-grp qspl-mp-mod' + (gFold[g[0]] ? ' folded' : '')}>
                {gHead(g[0], g[1], Object.keys(m).length)}
                {!gFold[g[0]] && <div className="qspl-mp-chips">
                  {keys.map(v => {
                    const off = v === 'Dự án của tôi'
                    return <button type="button" key={v} disabled={off} title={off ? 'Chưa có dữ liệu người tạo dự án' : v} className={`qspl-mp-chip${m[v] ? ' on' : ''}`} onClick={() => toggleF(g[0], v)}>{v}{!off && <small>{cnt[v] || 0}</small>}</button>
                  })}
                </div>}
              </div>
            )
          })}
        </aside>
        <section className="qspl-mp-main">
          <div className="qspl-mp-bar">
            <label className="qspl-multi-all"><input type="checkbox" checked={allOn} onChange={toggleAll} /> Chọn tất cả đang hiện ({shown.length})</label>
            <span style={{ flex: 1 }} />
            <label className="qspl-multi-all"><input type="checkbox" checked={onlyPicked} onChange={e => setOnlyPicked(e.target.checked)} /> Chỉ hiện đã chọn</label>
          </div>
          <div className="qspl-mp-list">
            <div className="qspl-mp-row head"><span /><span>Dự án</span><span>Khách hàng</span><span>Khu vực</span><span>Trạng thái</span></div>
            {shown.map(x => (
              <label key={x.maDA} className={`qspl-mp-row${pick.has(x.maDA) ? ' on' : ''}`}>
                <input type="checkbox" checked={pick.has(x.maDA)} onChange={() => toggle(x.maDA)} />
                <span className="nm">{x.ten}{x.maDA === curMa && <i className="cur">Đang mở</i>}</span>
                <span>{x.khachHang || '—'}</span>
                <span title={x.diaChi || ''}>{kv_(x) || '—'}</span>
                <span>{x.trangThai || 'Bản nháp'}</span>
              </label>
            ))}
            {!shown.length && <div className="qspl-multi-none">Không có dự án khớp bộ lọc.</div>}
          </div>
        </section>
      </div>
      <div className="qspl-mp-f">
        <span className="qspl-mp-n">Đã chọn <b>{pick.size}</b> dự án</span>
        <span style={{ flex: 1 }} />
        <label className="qspl-multi-sl">Số lượng <input type="number" min="1" value={sl} onChange={e => setSl(Math.max(1, Number(e.target.value) || 1))} /></label>
        <button type="button" className="qsc-btn" onClick={onClose}>Huỷ</button>
        <button type="button" className="qsc-btn blue" disabled={!pick.size || busy} onClick={save}>{busy ? 'Đang ghi danh…' : 'Ghi danh dự án' + (pick.size ? ' (' + pick.size + ')' : '')}</button>
      </div>
    </div>
  )
}
