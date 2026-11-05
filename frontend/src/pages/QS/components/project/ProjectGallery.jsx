import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { showTab } from '../../state/store'
import { safeUrl_, money, qbNorm_ } from '../../lib/format.js'
import { mediaUrl } from '../../api/files'
import { dezonUrl_ } from '../../lib/dashModel.js'
import ProjectDetail from './ProjectDetail'
import { statCache, loadStats_ } from './projectStats'
import ProjectCreate from './ProjectCreate'
import './gallery.css'

/* Trang "Danh sách dự án" (tham khảo dezon.vn/du-an): ô tìm lớn, hàng lọc (Nền tảng · Trạng thái · Khu vực · Phân khúc),
   lưới thẻ dự án 3 cột. Bấm thẻ = trang chi tiết dự án (ProjectDetail). Dự án chưa có ảnh bìa nên thẻ dùng nền màu theo tên + chữ cái đầu.
   Khu vực = đoạn cuối của địa chỉ; Nền tảng: Dezon.vn = đã gắn link bài dezon.vn, Dezon Pro = chưa gắn. */
const kv_ = x => { const a = String(x.diaChi || '').split(',').map(t => t.trim()).filter(Boolean); return a.length ? a[a.length - 1] : '' }
const nenTang_ = x => (String(x.linkDezon || '').trim() ? 'Dezon.vn' : 'Dezon Pro')
const GROUPS = [
  ['nenTang', 'Nền tảng', nenTang_],
  ['trangThai', 'Trạng thái', x => String(x.trangThai || '').trim() || 'Bản nháp'],
  ['khuVuc', 'Khu vực', kv_],
  ['phanKhuc', 'Phân khúc', x => String(x.phanKhuc || '').trim()],
  /* Nhà cung cấp = thương hiệu các dòng báo giá của dự án (nhiều giá trị / dự án, đọc từ statCache sau khi đếm) */
  ['ncc', 'Nhà cung cấp', x => (statCache[x.maDA] && statCache[x.maDA].ncc) || [], { multi: true }],
]
/* Chế độ xem (nhớ trong máy): Lưới lớn 3 cột · Lưới nhỏ (thẻ gọn, nhiều cột) · Danh sách (mỗi dự án 1 hàng) */
const PG_VIEWS = [['big', 'Lưới lớn', 'grid'], ['small', 'Lưới nhỏ', 'table'], ['list', 'Danh sách', 'listLines']]
const PGV_LS = 'qs_pg_view'
const pgvGet = () => { try { const v = localStorage.getItem(PGV_LS); return PG_VIEWS.some(x => x[0] === v) ? v : 'big' } catch (e) { return 'big' } }
const HUES = [212, 196, 168, 28, 262, 340, 145, 18]
const hue_ = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length] }
const initials_ = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

export default function ProjectGallery() {
  const { projects, cur, selectProject } = useQs()
  const [q, setQ] = useState('')
  const [flt, setFlt] = useState({})
  const [open, setOpen] = useState('')       // nhóm lọc đang mở danh sách
  const [coBG, setCoBG] = useState(false)    // chip "Dự án có báo giá"
  const [pgv, setPgvSt] = useState(pgvGet)
  const setPgv = v => { setPgvSt(v); try { localStorage.setItem(PGV_LS, v) } catch (e) { /* bỏ qua */ } }
  /* Số cột của lưới (kéo thanh trượt 2-9, mốc 3 · 6 · 9; nhớ trong máy theo từng chế độ lưới). Mặc định: Lưới lớn 4, Lưới nhỏ 6 */
  const COLS_DEF = { big: 4, small: 6 }
  const [cols, setColsSt] = useState(() => { try { return { ...COLS_DEF, ...JSON.parse(localStorage.getItem('qs_pg_cols') || '{}') } } catch (e) { return COLS_DEF } })
  const setCols = n => setColsSt(c => { const x = { ...c, [pgv]: n }; try { localStorage.setItem('qs_pg_cols', JSON.stringify(x)) } catch (e) { /* bỏ qua */ } return x })
  const nCol = cols[pgv] || COLS_DEF[pgv] || 4
  const [statVer, setStatVer] = useState(0)
  useEffect(() => { let alive = true; loadStats_(projects || [], () => { if (alive) setStatVer(v => v + 1) }); return () => { alive = false } }, [projects])
  const statDone = (projects || []).every(x => statCache[x.maDA])
  const nCoBG = (projects || []).filter(x => statCache[x.maDA] && statCache[x.maDA].n > 0).length
  const qq = q.trim().toLowerCase()
  const val_ = (g, x) => { const v = g[2](x); return Array.isArray(v) ? v : (v ? [v] : []) }
  const sel_ = k => Object.keys(flt[k] || {})
  const pass = (x, skip) => GROUPS.every(g => { if (g[0] === skip) return true; const m = flt[g[0]]; if (!m || !Object.keys(m).length) return true; return val_(g, x).some(v => m[v]) })
  const passQ = x => !qq || [x.ten, x.kienTrucSu, x.khachHang, x.diaChi, x.phanKhuc, x.nhuCau, x.quyMo, x.trangThai].some(v => String(v || '').toLowerCase().indexOf(qq) >= 0)
  const shown = useMemo(() => (projects || []).filter(x => passQ(x) && pass(x) && (!coBG || (statCache[x.maDA] && statCache[x.maDA].n > 0))), [projects, qq, flt, coBG, statVer])   // eslint-disable-line react-hooks/exhaustive-deps
  const nFlt = Object.values(flt).reduce((n, m) => n + Object.keys(m || {}).length, 0) + (coBG ? 1 : 0)
  const togVal = (k, v) => setFlt(f => { const m = { ...(f[k] || {}) }; if (m[v]) delete m[v]; else m[v] = 1; return { ...f, [k]: m } })
  const setAll = (k, vals) => setFlt(f => { const m = { ...(f[k] || {}) }; vals.forEach(v => { m[v] = 1 }); return { ...f, [k]: m } })
  const [ddq, setDdq] = useState('')            // ô tìm trong danh sách đang mở
  const ddRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    setDdq('')
    const down = e => { if (ddRef.current && !ddRef.current.contains(e.target)) setOpen('') }
    const key = e => { if (e.key === 'Escape') setOpen('') }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  /* Bấm thẻ = trang chi tiết dự án (ProjectDetail); nút "Mở ở Bóc tách" trong trang chi tiết mới chuyển dự án + tab */
  const [detail, setDetail] = useState('')
  const dp = detail ? (projects || []).find(x => x.maDA === detail) : null
  const showDetail = ma => { setDetail(ma); const sc = document.querySelector('.qs-scroll'); if (sc) sc.scrollTop = 0 }
  async function openProject(x) {
    if (!cur || cur.maDA !== x.maDA) { const ok = await selectProject(x.maDA); if (ok === false) return }
    showTab('boc')
  }
  /* Nút "Nhập dự án" mở trang nhập (ProjectCreate); lưu xong vào thẳng trang chi tiết của dự án vừa nhập */
  const [creating, setCreating] = useState(false)
  if (creating) return <ProjectCreate onBack={() => setCreating(false)} onCreated={p => { setCreating(false); showDetail(p.maDA) }} onOpen={ma => { setCreating(false); showDetail(ma) }} />
  if (dp) return <ProjectDetail p={dp} projects={projects} onBack={() => { delete statCache[detail]; setDetail(''); loadStats_(projects || [], () => setStatVer(v => v + 1)) }} onOpenBoc={openProject} onOpen={x => showDetail(x.maDA)} />
  return (
    <div className="qs-pg">
      <div className="qs-pg-head">
      <span className="qs-pg-total" title={shown.length + ' dự án đang hiện'}>{shown.length}</span>
      <div className="qs-pg-flt qs-pg-mod">
        <button type="button" className={`qs-pg-chip${coBG ? ' on' : ''}`} disabled={!statDone && !coBG} aria-pressed={coBG}
          title={statDone ? 'Chỉ hiện dự án đã có dòng báo giá' : 'Đang đếm dòng báo giá của các dự án…'} onClick={() => setCoBG(v => !v)}>
          {coBG && <Icon name="check" size={14} />}Dự án có báo giá<small>{statDone ? nCoBG : '…'}</small>
        </button>
        {GROUPS.map(g => {
          const cnt = {}
          ;(projects || []).forEach(x => { if (!passQ(x) || !pass(x, g[0])) return; val_(g, x).forEach(v => { cnt[v] = (cnt[v] || 0) + 1 }) })
          const keys = Object.keys(cnt).sort((a, b) => a.localeCompare(b, 'vi'))
          const picked = sel_(g[0])
          picked.forEach(v => { if (keys.indexOf(v) < 0) keys.push(v) })
          if (!keys.length) return null
          const isOpen = open === g[0]
          const dq = qbNorm_(ddq.trim())   // không phân biệt dấu
          const list = isOpen ? keys.filter(k => !dq || qbNorm_(k).indexOf(dq) >= 0) : []
          return (
            <div key={g[0]} className="qs-pg-dd" ref={isOpen ? ddRef : null}>
              <button type="button" className={`qs-pg-ddb${picked.length ? ' on' : ''}`} aria-expanded={isOpen} onClick={() => setOpen(o => (o === g[0] ? '' : g[0]))}>
                {picked.length === 1 ? <><span className="lb">{g[1]}:</span> {picked[0]}</> : picked.length > 1 ? <><span className="lb">{g[1]}:</span> {picked.length} đã chọn</> : g[1]}
                <Icon name="chevronDown" size={14} />
              </button>
              {isOpen && (
                <div className="qs-pg-ddm multi" role="listbox" aria-multiselectable="true">
                  {keys.length > 6 && (
                    <div className="qs-pg-ddq"><Icon name="search" size={14} /><input autoFocus placeholder={'Tìm ' + g[1].toLowerCase() + '…'} value={ddq} onChange={e => setDdq(e.target.value)} /></div>
                  )}
                  <div className="qs-pg-ddl">
                    {list.map(k => (
                      <label key={k} className={`qs-pg-ddi${(flt[g[0]] || {})[k] ? ' on' : ''}`}>
                        <input type="checkbox" checked={!!(flt[g[0]] || {})[k]} onChange={() => togVal(g[0], k)} />
                        <span>{k}</span><small>{cnt[k] || 0}</small>
                      </label>
                    ))}
                    {!list.length && <div className="qs-pg-ddnone">Không có kết quả.</div>}
                  </div>
                  <div className="qs-pg-ddf">
                    <button type="button" onClick={() => setAll(g[0], list)}>Chọn {dq ? 'kết quả' : 'tất cả'} ({list.length})</button>
                    <button type="button" disabled={!picked.length} onClick={() => setFlt(f => ({ ...f, [g[0]]: {} }))}>Bỏ chọn</button>
                    <button type="button" className="ok" onClick={() => setOpen('')}>Xong</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {nFlt > 0 && <button type="button" className="qs-pg-clear" onClick={() => { setFlt({}); setCoBG(false) }}>Xoá lọc ({nFlt})</button>}
      </div>
      <div className="qs-pg-mod qs-pg-views" role="group" aria-label="Chế độ xem">
        {PG_VIEWS.map(v => (
          <button type="button" key={v[0]} className={pgv === v[0] ? 'on' : ''} title={'Xem dạng ' + v[1]} onClick={() => setPgv(v[0])}><Icon name={v[2]} size={15} /><span>{v[1]}</span></button>
        ))}
      </div>
      {pgv !== 'list' && (
        <label className="qs-pg-mod qs-pg-cols" title="Kéo để đổi số cột của lưới">
          <span>Cột</span>
          <input type="range" min="2" max="9" step="1" value={nCol} list="qs-pg-colmarks" onChange={e => setCols(Number(e.target.value))} />
          <datalist id="qs-pg-colmarks"><option value="3" /><option value="6" /><option value="9" /></datalist>
          <b>{nCol}</b>
        </label>
      )}
      <button type="button" className="qs-pg-new" title="Nhập thông tin một dự án vào danh sách" onClick={() => { setCreating(true); const sc = document.querySelector('.qs-scroll'); if (sc) sc.scrollTop = 0 }}><Icon name="plus" size={15} stroke={3} />Nhập dự án</button>
      <div className="qs-pg-search qs-pg-mod">
        <Icon name="search" size={16} />
        <input placeholder="Tìm kiếm dự án, khách hàng, khu vực, phân khúc…" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button type="button" className="qs-pg-x" title="Xoá" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}
      </div>
      </div>
      {shown.length ? (
        <div className={'qs-pg-grid ' + pgv} style={pgv !== 'list' ? { '--cols': nCol } : undefined}>
          {shown.map(x => {
            const link = String(x.linkDezon || '').trim()
            const isCur = cur && cur.maDA === x.maDA
            const st = statCache[x.maDA]
            return (
              <div key={x.maDA} className="qs-pg-card" onClick={() => showDetail(x.maDA)} title={'Xem chi tiết dự án ' + x.ten}>
                <div className="qs-pg-cover" style={{ '--h': hue_(x.ten) }}>
                  {st && st.cover ? <img className="cv" src={mediaUrl(st.cover)} alt="" loading="lazy" /> : <span className="ini">{initials_(x.ten)}</span>}
                  <span className="st">{x.trangThai || 'Bản nháp'}</span>
                  {isCur && <span className="cur">Đang mở</span>}
                  {link && (
                    <a className="dz" href={safeUrl_(dezonUrl_(link))} target="_blank" rel="noopener noreferrer" title="Mở bài dự án trên dezon.vn"
                      onClick={e => e.stopPropagation()}><Icon name="link" size={13} /> Dezon.vn</a>
                  )}
                </div>
                {/* khung thông tin: tên · nhà cung cấp · SKU + tiền (bỏ dòng khách hàng / khu vực cho gọn; xem ở trang chi tiết) */}
                <div className="qs-pg-info">
                <div className="qs-pg-name">{x.ten}</div>
                {/* luôn đủ 3 dòng (tên · [n] nhà cung cấp · [n SKU] tiền) để mọi thẻ cao bằng nhau */}
                <div className="qs-pg-ncc" title={st && st.ncc && st.ncc.length ? 'Nhà cung cấp tham gia: ' + st.ncc.join(', ') : undefined}>
                  <b className="lb" title="Số nhà cung cấp tham gia">[{st ? (st.ncc || []).length : '…'}]</b>
                  {st && st.ncc && st.ncc.length
                    ? <>{st.ncc.slice(0, 4).map(n => <span key={n}>{n}</span>)}{st.ncc.length > 4 && <span className="more">+{st.ncc.length - 4}</span>}</>
                    : <i className="nil">{st ? 'Chưa có nhà cung cấp' : 'Đang đếm…'}</i>}
                </div>
                <div className="qs-pg-bg">
                  <b>[{st ? st.n : '…'} SKU]</b>
                  {st && st.n && st.tong > 0 ? <> · <b>{money(st.tong)} VND</b></> : st ? <i className="nil"> · Chưa có báo giá</i> : null}
                </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : <div className="qs-pg-empty">Không có dự án khớp tìm kiếm / bộ lọc.</div>}
    </div>
  )
}
