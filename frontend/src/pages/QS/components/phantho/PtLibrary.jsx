import { useState, useRef } from 'react'
import QsIcon from '../common/QsIcon'
import { useMroot } from '../common/Mroot'
import Pop, { PopHead } from '../breakdown/sheet/Pop'
import { PT_LOAI_NHOM, ptLoaiNgan, ptSetLoai, usePtLoai } from '../breakdown/sheet/ptLoai'
import { ctSecDeMuc_ } from '../breakdown/catalog/catalogModel'
import { money, ptQty, ptR0 } from '../../lib/format.js'
import { nodeName } from '../../lib/tree.js'
import {
  PT_LOAI, PT_MAU, DT_BO, ptSecsOfLoai_, ptLoaiCount_, ptLibDg_, ptDaCo_, ctOf_, dtCalc_, dtApplied_, dtTien_,
  ptNccList_, ptNccKey_, ptSecItemsNcc_, PT_NCC_MAC_DINH,
} from '../../lib/phantho.js'
import { useQsStore } from '../../state/store'
import { qsToast as toast } from '../common/dialogs'
import { ptInfo_, ptLibCount_ } from './ptModel'
import { usePtUi, setPtUi, ptOvrAll_, ptInfoUser_ } from './ptState'
import { usePtTemplate, usePhanTho } from './ptHooks'
import FilterPopover from '../breakdown/FilterPopover'
import { ptAddToSec, ptAddFromLib, ptApplyMau, dtSetIn, dtResetIn, dtApply, dtRemove, dtValsOf, ctFavToggle } from './ptActions'
import './phantho.css'

/* Panel trái của Phần thô (port renderPTLibrary / ptMselPop_ / ptSetContractor / ptLibToggle / dtPanel_ / ptLibDragStart_,
   PUB/phantho.js:469-507, 1226-1295, 1623-1651, 2369-2393). 3 phần cắm vào CatalogPanel (1C) qua các prop
   ptCount / ptFilters / ptLib (CatalogPanel.jsx:43-46):
     usePtLibCount()  -> chữ "156 công việc" (#catCount)
     <PtFilters/>     -> các bước ① Hạng mục sản phẩm ② Tên nhà thầu ③ Dự án mẫu + bảng dự toán (#ptFilters)
     <PtLibrary/>     -> thư viện nội dung công việc (#catList)
   Không prop nào; dữ liệu lấy từ store + ptState. */

/* 2.2 Vật tư: bước ② là "Hạng mục vật tư" (thay Tên nhà thầu). Nhận theo từ khoá trong tên công tác / tên nhóm (không dấu).
   'khac' = vật tư không thuộc hạng mục nào ở trên. */
export const VT_HANG_MUC = [
  ['thep', 'Thép', ['thep', 'sat thep', 'coupler']],
  ['ximang', 'Xi măng', ['xi mang']],
  ['gach', 'Gạch', ['gach']],
  ['copha', 'Cốp pha', ['cop pha', 'coppha', 'copha', 'van khuon']],
  ['chongtham', 'Vật tư chống thấm', ['chong tham']],
  ['betong', 'Bê tông', ['be tong']],
  ['catda', 'Cát, đá', ['cat vang', 'cat den', 'cat xay', 'cat be tong', 'cat san lap', 'da 1x2', 'da 2x4', 'da 4x6', 'da mi', 'cat, da', 'cat da']],
  ['coc', 'Cọc', ['coc ']],
  ['khac', 'Vật tư khác', []],
]
const khongDau_ = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
const vtCuaIt_ = (sec, a) => {
  const t = ' ' + khongDau_(String(a[0]) + ' ' + String(sec.t || '')) + ' '
  const hit = VT_HANG_MUC.find(c => c[2].some(k => t.indexOf(k) >= 0))
  return hit ? hit[0] : 'khac'
}
/* Lọc công tác của 1 nhóm: nhà thầu (Khái toán / Nhân công) hoặc hạng mục vật tư (2.2 Vật tư) */
export function ptSecItemsLoc_(sec, loai, ncc, vtCat, favOnly) {
  const ds = loai === 'dt_vattu'
    ? (sec.items || []).map((a, ii) => ({ a, ii })).filter(x => !vtCat || vtCuaIt_(sec, x.a) === vtCat)
    : ptSecItemsNcc_(sec, ncc)
  return favOnly ? ds.filter(x => { const c = ctOf_(x.a); return !!(c && c.yeuThich) }) : ds
}
export function vtCatCount_(secs, cat) { return secs.reduce((n, sec) => n + (sec.items || []).filter(a => vtCuaIt_(sec, a) === cat).length, 0) }

export function usePtLibCount() {
  const tpl = usePtTemplate()
  const loai = usePtLoai()
  const ncc0 = usePtUi(s => s.contractor)
  const vtCat = usePtUi(s => s.vtCat)
  const favOnly = usePtUi(s => s.favOnly)
  const secs = ptSecsOfLoai_(tpl, loai)
  const vt = loai === 'dt_vattu'
  if (favOnly) return secs.reduce((n, sec) => n + ptSecItemsLoc_(sec, loai, vt ? '' : ncc0, vtCat, true).length, 0) + ' công việc · yêu thích'
  const ncc = vt ? '' : ncc0
  if (vt && vtCat) return secs.reduce((n, sec) => n + ptSecItemsLoc_(sec, loai, '', vtCat).length, 0) + ' công việc · ' + ((VT_HANG_MUC.find(c => c[0] === vtCat) || [])[1] || '')
  if (!ncc) return ptLibCount_(secs) + ' công việc'
  return secs.reduce((n, sec) => n + ptSecItemsNcc_(sec, ncc).length, 0) + ' công việc · ' + ncc
}


function Step({ n, lb, on, onOpen, children, refEl }) {
  return (
    <div className="qspt-step">
      <span className="qspt-sn">{n}</span>
      <div className="qspt-sb">
        <div className="qspt-sl">{lb}</div>
        <div ref={refEl} className={`qspt-msel${on ? ' active' : ''}`} onClick={onOpen}>
          <span className="qspt-mlabel">{children}</span>
          <span className="qspt-mplus"><QsIcon name="pluscircle" size={17} /></span>
        </div>
      </div>
    </div>
  )
}

/* Ô chọn ở panel trái: loại báo giá · nhà thầu · dự án mẫu (ptMselPop_) */
function MselPop({ kind, anchor, onClose }) {
  const tpl = usePtTemplate()
  const lo = usePtLoai()
  const cur = usePtUi(s => s.contractor)
  const getVtCat_ = () => vtCatSt
  const vtCatSt = usePtUi(s => s.vtCat)
  const congTac = useQsStore(s => s.congTac)
  const It = ({ on, onClick, nm, cn, sub }) => (
    <div className={`qspt-mi${on ? ' on' : ''}`} onClick={onClick}>
      <span className="nm">{nm}{sub ? <i className="qspt-isub">{sub}</i> : null}</span>
      <span className="cn">{cn || ''}</span><span className={`rd${on ? ' on' : ''}`} />
    </div>
  )
  let title = '', body = null
  if (kind === 'loai') {
    const nhom = PT_LOAI_NHOM.find(g => lo.indexOf(g[0] + '_') === 0) || PT_LOAI_NHOM[0]
    title = 'Hạng mục sản phẩm · ' + nhom[2]
    body = [nhom].map(g => (
      <div key={g[0]}>
        <div className="qspt-mg">{g[1] + '. ' + g[2]}</div>
        {g[3].map(x => {
          const n = ptLoaiCount_(tpl, x[0])
          return <It key={x[0]} on={lo === x[0]} onClick={() => { onClose(); ptSetLoai(x[0]) }} nm={x[1] + ' ' + x[2]} cn={n ? (n + ' công tác') : 'chưa có'} sub={x[3]} />
        })}
      </div>
    ))
  } else if (kind === 'vt') {
    title = 'Hạng mục vật tư'
    const vtCur = getVtCat_()
    const secs = ptSecsOfLoai_(tpl, lo)
    const pick = v => { onClose(); setPtUi({ vtCat: v || '' }) }
    body = (
      <>
        <It on={!vtCur} onClick={() => pick('')} nm="Tất cả vật tư" cn={secs.reduce((n, s) => n + (s.items || []).length, 0) + ' công tác'} />
        {VT_HANG_MUC.map(c => {
          const n = vtCatCount_(secs, c[0])
          return <It key={c[0]} on={vtCur === c[0]} onClick={() => pick(c[0])} nm={c[1]} cn={n ? (n + ' công tác') : 'chưa có'} />
        })}
        <p className="qspt-hint">Chọn hạng mục thì thư viện chỉ hiện vật tư thuộc hạng mục đó (nhận theo tên công tác). Giá các dòng đã có trong bảng không đổi.</p>
      </>
    )
  } else if (kind === 'ncc') {
    title = 'Tên nhà thầu'
    const pick = v => { onClose(); setPtUi({ contractor: v || '' }); toast(v ? ('Thư viện chỉ hiện công tác của nhà thầu: ' + v) : 'Bỏ chọn nhà thầu - thư viện hiện mọi công tác') }
    body = (
      <>
        <It on={!cur} onClick={() => pick('')} nm="Tất cả nhà thầu" />
        {ptNccList_(congTac, lo).map(c => (
          <It key={ptNccKey_(c.ten)} on={ptNccKey_(cur) === ptNccKey_(c.ten)} onClick={() => pick(c.ten)} nm={c.ten} cn={c.n ? (c.n + ' công tác') : 'chưa có'} />
        ))}
        <p className="qspt-hint">Chọn nhà thầu thì thư viện chỉ hiện công tác có đúng nhà thầu đó (cột Nhà thầu của công tác). Giá các dòng đã có trong bảng không đổi.</p>
      </>
    )
  } else {
    title = 'Dự án mẫu'
    body = (
      <>
        {PT_MAU.map(m => <It key={m.id} on={false} onClick={() => { onClose(); ptApplyMau(m, tpl) }} nm={m.ten} sub={m.mo || ''} />)}
        <p className="qspt-hint">Chọn 1 mẫu để đưa cả bộ hạng mục vào bảng → ra đơn giá trọn gói; sửa diện tích · hệ số · đơn giá theo dự án đang làm.</p>
      </>
    )
  }
  const w = anchor && anchor.offsetWidth ? Math.max(260, anchor.offsetWidth) : 260
  return (
    <Pop anchor={anchor} width={w} className="qspt-msp" onClose={onClose}>
      <PopHead title={title} />
      <div className="qspt-mb">{body}</div>
    </Pop>
  )
}

/* Khối "Bộ dự toán" (dtPanel_): số liệu đầu vào -> khối lượng -> chi phí trực tiếp */
function DtPanel() {
  const tpl = usePtTemplate()
  const { phanTho, maDA } = usePhanTho()
  usePtUi(s => s.dtVer)
  return DT_BO.map(bo => {
    const c = dtCalc_(bo, dtValsOf(maDA, bo)), v = c.v, on = dtApplied_(tpl, bo, phanTho), t = dtTien_(tpl, bo)
    return (
      <div key={bo.id} className={`qspt-dt${on ? ' on' : ''}`}>
        <div className="qspt-dt-hd">
          <span className="qspt-dt-tag">Bộ dự toán</span>
          {on && <span className="qspt-dt-on">✓ đang dùng</span>}
          <b>{bo.ten}</b>
          <span className="qspt-dt-src">{bo.nguon}</span>
          <button className="qspt-dt-rs" title="Trả số liệu đầu vào về mặc định" onClick={() => dtResetIn(bo)}>Mặc định</button>
        </div>
        <div className="qspt-dt-act">
          {on
            ? <button className="qspt-dt-btn off" onClick={() => dtRemove(bo, tpl)}>Gỡ khỏi bảng</button>
            : <button className="qspt-dt-btn" onClick={() => dtApply(bo, tpl)}><QsIcon name="plus" size={14} /> Dùng bộ dự toán này</button>}
          <span className="qspt-dt-actn">Đưa cả nhân công · máy · vật tư vào bảng trong 1 lần</span>
        </div>
        <div className="qspt-dt-sec">I. Số liệu đầu vào</div>
        <div className="qspt-dt-ins">
          {bo.inputs.map(a => {
            const val = v[a[0]]
            const shown = a[4] ? (val ? money(val) : '') : (val === '' || val == null ? '' : String(val))
            const commit = e => { if (e.target.value !== shown) dtSetIn(bo, a[0], e.target.value) }
            return (
              <label key={a[0] + '|' + shown} className="qspt-dt-fld">
                <span className="qspt-dt-lb">{a[1]}</span>
                {a[4]
                  ? <input className="qspt-dt-in" type="text" inputMode="numeric" defaultValue={shown} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                  : <input className="qspt-dt-in" type="number" step="any" defaultValue={shown} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />}
                <span className="qspt-dt-dv">{a[2]}</span>
              </label>
            )
          })}
        </div>
        <div className="qspt-dt-sec">II. Khối lượng tính toán</div>
        <table className="qspt-dt-kl">
          <thead><tr><th>Nội dung · công thức</th><th className="n">Kết quả</th><th>ĐVT</th></tr></thead>
          <tbody>
            {c.kl.map((k, i) => (
              <tr key={i}>
                <td><span className="qspt-dt-knm">{k.t}</span><span className="qspt-dt-ct">{k.ct}</span></td>
                <td className="n b">{k.dvt === 'đồng' ? money(ptR0(k.r)) : ptQty(k.r)}</td>
                <td className="qspt-dt-dvt">{k.dvt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="qspt-dt-sec">III. Chi phí trực tiếp</div>
        <div className="qspt-dt-sum">
          <div className="qspt-dt-srow"><span>Nhân công &amp; máy thi công</span><b>{money(t.nc)}</b></div>
          <div className="qspt-dt-srow"><span>Vật tư</span><b>{money(t.vt)}</b></div>
          <div className="qspt-dt-srow tot"><span>Tổng chi phí trực tiếp</span><b>{money(t.tong)}</b></div>
        </div>
        <p className="qspt-dt-note">{bo.ghiChu}</p>
      </div>
    )
  })
}

/* Các bước chọn (#ptFilters): ① Hạng mục sản phẩm → ② Tên nhà thầu → ③ Dự án mẫu (chỉ Khái toán sơ bộ) + kết quả */
export function PtFilters() {
  const loai = usePtLoai()
  const tpl = usePtTemplate()
  const cur = usePtUi(s => s.contractor)
  const [pop, setPop] = useState(null)
  const vtCat = usePtUi(s => s.vtCat)
  const nccRef = useRef(null) // ô ② Tên nhà thầu / Hạng mục vật tư
  const nh = PT_LOAI_NHOM.filter(g => g[3].some(x => x[0] === loai))[0] || PT_LOAI_NHOM[0]
  const lx = nh[3].filter(x => x[0] === loai)[0] || nh[3][0]
  const open = (kind, el) => setPop(p => (p && p.kind === kind ? null : { kind, anchor: el }))
  let n = 0
  return (
    <div className="qspt-filters qs-bd-pop-anchor">
      <div className="qspt-flow">
        {/* ① Hạng mục sản phẩm: 2 chip loại của nhóm đang chọn ở đầu cột (Khái toán: Chi tiết | Sơ bộ · Dự toán: Nhân công | Vật tư) */}
        <div className="qspt-step">
          <span className="qspt-sn">{++n}</span>
          <div className="qspt-sb">
            <div className="qspt-sl">Hạng mục sản phẩm</div>
            <div className="qspt-lchips" role="tablist" aria-label={'Loại ' + nh[2]}>
              {nh[3].map(x => {
                const c = ptLoaiCount_(tpl, x[0])
                return (
                  <button key={x[0]} type="button" role="tab" aria-selected={x[0] === lx[0]} className={x[0] === lx[0] ? 'on' : ''} title={x[1] + ' ' + x[2] + ' - ' + x[3]} onClick={() => { ptSetLoai(x[0]); setPop(null); setPtUi({ sidePop: 'filter' }) }}>
                    {x[0] === 'kt_sobo' ? 'Theo m2' : ptLoaiNgan(x[2])}{c ? <em>{c}</em> : null}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        {loai === 'dt_vattu' ? (
          <Step n={++n} lb="Hạng mục vật tư" on={!!vtCat} refEl={nccRef} onOpen={() => setPtUi(s => ({ sidePop: s.sidePop === 'filter' ? null : 'filter' }))}>
            {vtCat ? <b>{(VT_HANG_MUC.find(c => c[0] === vtCat) || [])[1]}</b> : 'Chọn hạng mục vật tư (thép, xi măng, gạch...)'}
          </Step>
        ) : (
          <Step n={++n} lb="Tên nhà thầu" on={!!cur} refEl={nccRef} onOpen={() => setPtUi(s => ({ sidePop: s.sidePop === 'filter' ? null : 'filter' }))}>
            {cur ? <b>{cur}</b> : 'Chọn nhà thầu'}
          </Step>
        )}
        {loai === 'kt_sobo' && (
          <Step n={++n} lb="Dự án mẫu" on={false} onOpen={() => setPtUi(s => ({ sidePop: s.sidePop === 'mau' ? null : 'mau' }))}>Chọn dự án mẫu → lấy cả bộ đơn giá</Step>
        )}
      </div>
      {loai.indexOf('dt_') === 0 && <DtPanel />}
      {pop && <MselPop kind={pop.kind} anchor={pop.anchor} onClose={() => setPop(null)} />}
    </div>
  )
}

/* Thẻ ma khi kéo 1 công tác (drag-ghost dùng chung mẫu với bên Thiết bị đèn) */
function ghost(root, ten, sub) {
  const g = document.createElement('div')
  g.className = 'qspt-ghost'
  const nm = document.createElement('span'); nm.className = 'qspt-ghost-nm'; nm.textContent = ten
  const pr = document.createElement('span'); pr.className = 'qspt-ghost-pr'; pr.textContent = sub
  const ad = document.createElement('span'); ad.className = 'qspt-ghost-add'; ad.textContent = '＋ Thả vào bảng'
  const b = document.createElement('span'); b.className = 'qspt-ghost-b'; b.appendChild(nm); b.appendChild(pr)
  g.appendChild(b); g.appendChild(ad)
  ;(root || document.body).appendChild(g)
  return g
}

/* Thư viện nội dung công việc (#catList) */
export function PtLibrary() {
  const tpl = usePtTemplate()
  const loai = usePtLoai()
  const { phanTho } = usePhanTho()
  const projData = useQsStore(s => s.projData)
  const ctStatus = useQsStore(s => s.ctStatus)
  const ctError = useQsStore(s => s.ctError)
  const libCol = usePtUi(s => s.libCol)
  const detail = usePtUi(s => s.detail)
  const ncc0 = usePtUi(s => s.contractor)
  const vtCat = usePtUi(s => s.vtCat)
  const favOnly = usePtUi(s => s.favOnly)
  const ncc = loai === 'dt_vattu' ? '' : ncc0 // 2.2 Vật tư lọc theo hạng mục vật tư, không theo nhà thầu
  const [dragK, setDragK] = useState('')
  const mroot = useMroot()
  const secs = ptSecsOfLoai_(tpl, loai)
  const meta = PT_LOAI.filter(x => x[0] === loai)[0] || PT_LOAI[0]
  const ovr = ptOvrAll_()
  const infoU = ptInfoUser_(projData)

  if (ctStatus === 'error' && !secs.length) {
    return <div className="qspt-libempty err"><QsIcon name="layers" size={22} /><b>Không tải được công tác</b><span>{ctError}</span></div>
  }
  if (!secs.length) {
    return (
      <div className="qspt-libempty">
        <QsIcon name="layers" size={22} />
        <b>Chưa có bảng giá cho "{meta[1]}"</b>
        <span>Gửi file Excel bảng giá của mục này để nạp vào thư viện, hoặc chọn loại khác ở ô trên.</span>
      </div>
    )
  }
  function dragStart(e, sec, a, k) {
    if (e.target.closest('button')) { e.preventDefault(); return }
    setPtUi({ libDrag: { tsec: sec, a } })
    try {
      e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'ptlib')
      const dvt = a[1] || '', dg = Number(ptLibDg_(sec, a, ovr)) || 0
      const g = ghost(mroot, String(a[0]).split('\n')[0], dvt + (dg ? (' · ' + money(dg) + ' đ') : ''))
      e.dataTransfer.setDragImage(g, 24, 28)
      setTimeout(() => g.remove(), 0)
    } catch (x) { /* bỏ qua */ }
    setDragK(k)
  }
  function dragEnd() { setPtUi({ libDrag: null }); setDragK('') }
  return (
    <div className="qspt-lib">
      {loai.indexOf('dt_') === 0 && (
        <p className="qspt-dthint">Danh sách dưới đây là các công tác <b>trong bộ dự toán</b> — chỉ dùng khi cần thêm lẻ một dòng bị xoá.</p>
      )}
      {secs.map(sec0 => {
        const si = tpl.indexOf(sec0)
        const col = !!libCol[si]
        // M5.2: có chọn nhà thầu thì nhóm chỉ còn công tác của nhà thầu đó (bản sao nông, dùng cả cho nút thêm cả nhóm)
        const shown = ptSecItemsLoc_(sec0, loai, ncc, vtCat, favOnly)
        const loc = !!(ncc || (loai === 'dt_vattu' && vtCat) || favOnly)
        const sec = loc ? { ...sec0, items: shown.map(x => x.a) } : sec0
        const nDaCo = sec.items.filter(a => ptDaCo_(sec, a, phanTho)).length
        const dm = ctSecDeMuc_(sec)
        return (
          <div key={si} className="qspt-lsec">
            <div className="qspt-sh" onClick={() => setPtUi(s => ({ libCol: { ...s.libCol, [si]: !s.libCol[si] } }))}>
              <span className="qspt-caret">{col ? '▸' : '▾'}</span>
              <span className="qspt-shtt">{sec.r}. {String(sec.t).split('\n')[0]}</span>
              {dm && <span className="qspt-shdm" title={'Nhóm này còn hiện ở đề mục ' + dm + ' ' + nodeName(dm) + ' khi bóc tách'}>{dm}</span>}
              <span className={`qspt-shn${nDaCo ? ' on' : ''}`} title={nDaCo ? ('Đã thêm ' + nDaCo + '/' + sec.items.length + ' công tác') : (sec.items.length + ' công tác')}>
                {nDaCo ? (nDaCo + '/' + sec.items.length) : sec.items.length}
              </span>
              {sec.items.length > 0 && <button className="qspt-secadd" title={ncc ? ('Thêm cả nhóm (công tác của ' + ncc + ') vào bảng') : 'Thêm cả nhóm vào bảng'} onClick={e => { e.stopPropagation(); ptAddToSec(sec) }}><QsIcon name="plus" size={14} /></button>}
            </div>
            {!col && loai === 'dt_vattu' && vtCat && !shown.length && (
              <div className="qspt-nccempty">Nhóm này không có vật tư "{(VT_HANG_MUC.find(c => c[0] === vtCat) || [])[1]}"</div>
            )}
            {!col && ncc && !shown.length && (
              <div className="qspt-nccempty">Nhà thầu {ncc} chưa có đơn giá cho mục này</div>
            )}
            {!col && shown.length > 0 && (
              <div className="qspt-items">
                {shown.map(({ a, ii }) => {
                  const dg = ptLibDg_(sec, a, ovr)
                  const on = !!(detail && detail.si === si && detail.ii === ii)
                  const inf = ptInfo_(infoU, String(a[0]))
                  const coTL = !!(inf.anh || inf.ts || inf.pv || inf.tl || inf.model)
                  const da = ptDaCo_(sec, a, phanTho)
                  const gc = (sec.mode === 'none') ? (a[2] || '') : (a[4] || '')
                  const ctr = ctOf_(a)
                  const k = si + ':' + ii
                  return (
                    <div key={ii} className={`qspt-it${on ? ' on' : ''}${da ? ' da' : ''}${dragK === k ? ' dragging' : ''}`}
                      title="Bấm để xem thông tin công tác · kéo để thả vào bảng" draggable
                      onDragStart={e => dragStart(e, sec, a, k)} onDragEnd={dragEnd}
                      onClick={() => setPtUi({ detail: { si, ii }, infoEdit: false })}>
                      <div className="qspt-it-nm" title={String(a[0]).replace(/\n/g, ' ') + (gc ? (' — ' + gc) : '')}>
                        {String(a[0]).split('\n')[0]}
                        {coTL && <span className="qspt-it-info" title="Đã có ảnh / thông số kỹ thuật"><QsIcon name="doc" size={11} /></span>}
                      </div>
                      <div className="qspt-it-meta">
                        <span className="qspt-it-dvt">{a[1] || ''}</span>
                        <span className="qspt-it-dg">{dg ? (money(dg) + ' đ') : '—'}</span>
                        {da && <span className="qspt-it-da" title="Công tác này đã có trong bảng">✓ đã thêm</span>}
                      </div>
                      <div className="qspt-it-act">
                        {ctr && (
                          <button className={`qspt-it-fav${ctr.yeuThich ? ' on' : ''}`} title={ctr.yeuThich ? 'Bỏ khỏi công tác yêu thích' : 'Thêm vào công tác yêu thích'}
                            onClick={e => { e.stopPropagation(); ctFavToggle(ctr) }}><QsIcon name="star" size={13} /></button>
                        )}
                        <button className="qspt-it-add" title="Thêm vào bảng ước tính" onClick={e => { e.stopPropagation(); ptAddFromLib(sec, a) }}><QsIcon name="plus" size={14} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* Khung bên phải cột thư viện Phần thô (như "Bộ lọc" / "Sản phẩm yêu thích" của các đề mục khác):
   kind 'filter' = lọc theo nhà thầu (hoặc hạng mục vật tư ở 2.2 Vật tư) + chỉ công tác yêu thích; kind 'fav' = danh sách công tác yêu thích */
export function PtSidePop({ kind, onClose, anchorRef }) {
  const tpl = usePtTemplate()
  const lo = usePtLoai()
  const ui = usePtUi()
  const congTac = useQsStore(s => s.congTac)
  const secs = ptSecsOfLoai_(tpl, lo)
  const ovr = ptOvrAll_()
  const vt = lo === 'dt_vattu'
  const Chip = ({ on, onClick, nm, cn }) => (
    <button type="button" className={'qspt-fpchip' + (on ? ' on' : '')} onClick={onClick}><span>{nm}</span>{cn != null && <em>{cn}</em>}</button>
  )
  if (kind === 'mau') return <PtMauPop tpl={tpl} onClose={onClose} anchorRef={anchorRef} />
  if (kind === 'fav') {
    const favs = []
    secs.forEach(sec => (sec.items || []).forEach(a => { const c = ctOf_(a); if (c && c.yeuThich) favs.push({ sec, a, c }) }))
    return (
      <FilterPopover title={'Công tác yêu thích · ' + favs.length} anchorRef={anchorRef} onClose={onClose}
        foot={<>
          <button className={'qs-modal-btn' + (ui.favOnly ? ' primary' : '')} onClick={() => setPtUi(st => ({ favOnly: !st.favOnly }))}>{ui.favOnly ? 'Đang chỉ hiện yêu thích ✓' : 'Chỉ hiện yêu thích trong thư viện'}</button>
          <button className="qs-modal-btn primary" onClick={onClose}>Đóng</button>
        </>}>
        {favs.length ? (
          <div className="qspt-fplist">
            {favs.map(({ sec, a, c }, i) => {
              const dg = Number(ptLibDg_(sec, a, ovr)) || 0
              return (
                <div key={i} className="qspt-fpit">
                  <div className="nm">{String(a[0]).split('\n')[0]}<span>{String(sec.t || '').split('\n')[0]}</span></div>
                  <div className="mt"><i>{a[1] || ''}</i><b>{dg ? money(dg) + ' đ' : '—'}</b></div>
                  <button type="button" className="fav on" title="Bỏ khỏi công tác yêu thích" onClick={() => ctFavToggle(c)}><QsIcon name="star" size={13} /></button>
                  <button type="button" className="add" title="Thêm vào bảng ước tính" onClick={() => ptAddFromLib(sec, a)}><QsIcon name="plus" size={14} /></button>
                </div>
              )
            })}
          </div>
        ) : <div className="qspt-fpempty">Chưa có công tác yêu thích trong loại này. Bấm ☆ trên thẻ công tác ở thư viện để đánh dấu.</div>}
      </FilterPopover>
    )
  }
  const all = secs.reduce((n, sec) => n + (sec.items || []).length, 0)
  const favN = secs.reduce((n, sec) => n + (sec.items || []).filter(a => { const c = ctOf_(a); return !!(c && c.yeuThich) }).length, 0)
  const nhom = PT_LOAI_NHOM.find(g => g[3].some(x => x[0] === lo)) || PT_LOAI_NHOM[0]
  const lx = nhom[3].find(x => x[0] === lo) || nhom[3][0]
  return (
    <FilterPopover title={nhom[2] + ' · ' + (lo === 'kt_sobo' ? 'Theo m2' : ptLoaiNgan(lx[2]))} anchorRef={anchorRef} onClose={onClose}
      foot={<>
        <button className="qs-modal-btn" onClick={() => setPtUi({ contractor: '', vtCat: '', favOnly: false })}>Xoá lọc</button>
        <button className="qs-modal-btn primary" onClick={onClose}>Xong</button>
      </>}>
      <div className="qspt-fpsec">
        <div className="hd">{vt ? 'Hạng mục vật tư' : 'Tên nhà thầu'}</div>
        <div className="grid">
          {vt ? (
            <>
              <Chip on={!ui.vtCat} onClick={() => setPtUi({ vtCat: '' })} nm="Tất cả vật tư" cn={all} />
              {VT_HANG_MUC.map(c => <Chip key={c[0]} on={ui.vtCat === c[0]} onClick={() => setPtUi({ vtCat: ui.vtCat === c[0] ? '' : c[0] })} nm={c[1]} cn={vtCatCount_(secs, c[0])} />)}
            </>
          ) : (
            <>
              {(() => {
                // Dezon (mặc định) đứng đầu, rồi Tất cả nhà thầu, rồi các nhà thầu khác; số = công tác trong thư viện của loại đang chọn
                const ds = ptNccList_(congTac, lo)
                const md = ds.find(c => ptNccKey_(c.ten) === ptNccKey_(PT_NCC_MAC_DINH)) || { ten: PT_NCC_MAC_DINH }
                const dem = ten => secs.reduce((n, sec) => n + ptSecItemsNcc_(sec, ten).length, 0)
                const chip = (c, nm) => <Chip key={ptNccKey_(c.ten)} on={ptNccKey_(ui.contractor) === ptNccKey_(c.ten)} onClick={() => setPtUi({ contractor: ptNccKey_(ui.contractor) === ptNccKey_(c.ten) ? '' : c.ten })} nm={nm || c.ten} cn={dem(c.ten)} />
                return (
                  <>
                    {chip(md, md.ten + ' · mặc định')}
                    <Chip on={!ui.contractor} onClick={() => setPtUi({ contractor: '' })} nm="Tất cả nhà thầu" cn={all} />
                    {ds.filter(c => ptNccKey_(c.ten) !== ptNccKey_(PT_NCC_MAC_DINH)).map(c => chip(c))}
                  </>
                )
              })()}
            </>
          )}
        </div>
      </div>
      {lo === 'kt_sobo' && (
        <div className="qspt-fpsec">
          <div className="hd">Dự án mẫu <span className="sub">lấy cả bộ đơn giá trọn gói</span></div>
          <button type="button" className="qspt-fpmore" onClick={() => setPtUi({ sidePop: 'mau' })}>
            <span>Xem danh sách dự án mẫu</span><em>{PT_MAU.length}</em><b>→</b>
          </button>
        </div>
      )}
      <div className="qspt-fpsec">
        <div className="hd">Hiển thị</div>
        <div className="grid">
          <Chip on={!ui.favOnly} onClick={() => setPtUi({ favOnly: false })} nm="Mọi công tác" cn={all} />
          <Chip on={ui.favOnly} onClick={() => setPtUi({ favOnly: true })} nm="Chỉ công tác yêu thích" cn={favN} />
        </div>
      </div>
    </FilterPopover>
  )
}

/* Khung "Dự án mẫu" (Khái toán · Theo m2): danh sách dự án mẫu, bấm 1 mẫu = đưa cả bộ đơn giá trọn gói vào bảng (ptApplyMau) */
function PtMauPop({ tpl, onClose, anchorRef }) {
  const [q, setQ] = useState('')
  const k = khongDau_(q.trim())
  const ds = PT_MAU.filter(m => !k || khongDau_(m.ten + ' ' + (m.mo || '')).indexOf(k) >= 0)
  return (
    <FilterPopover title={'Danh sách dự án mẫu · ' + PT_MAU.length} anchorRef={anchorRef} onClose={onClose}
      foot={<>
        <button className="qs-modal-btn" onClick={() => setPtUi({ sidePop: 'filter' })}>← Bộ lọc</button>
        <button className="qs-modal-btn primary" onClick={onClose}>Đóng</button>
      </>}>
      <div className="qspt-mauwrap">
        <input className="qspt-mauq" value={q} placeholder="Tìm dự án mẫu theo tên, địa điểm…" onChange={e => setQ(e.target.value)} />
        {ds.length ? ds.map(m => (
          <div key={m.id} className="qspt-maucard">
            <div className="tt"><b>{m.ten}</b>{m.mo ? <span>{m.mo}</span> : null}</div>
            <div className="ft">
              {m.tong ? <span className="tg">Tổng tham khảo <b>{money(m.tong)} đ</b></span> : <span />}
              <button type="button" className="qs-modal-btn primary" onClick={() => { onClose(); ptApplyMau(m, tpl) }}>Dùng mẫu này</button>
            </div>
          </div>
        )) : <div className="qspt-fpempty">Không có dự án mẫu khớp "{q}".</div>}
        <p className="qspt-hint">Dùng mẫu: đưa cả bộ hạng mục vào bảng để ra đơn giá trọn gói; sau đó sửa diện tích · hệ số · đơn giá theo dự án đang làm. Hạng mục đang có vẫn giữ nguyên.</p>
      </div>
    </FilterPopover>
  )
}
