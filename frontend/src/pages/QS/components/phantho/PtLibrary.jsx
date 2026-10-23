import { useState } from 'react'
import QsIcon from '../common/QsIcon'
import { useMroot } from '../common/Mroot'
import Pop, { PopHead } from '../breakdown/sheet/Pop'
import { PT_LOAI_NHOM, ptLoaiNgan, ptSetLoai, usePtLoai } from '../breakdown/sheet/ptLoai'
import { ctSecDeMuc_ } from '../breakdown/catalog/catalogModel'
import { money, ptQty, ptR0 } from '../../lib/format.js'
import { nodeName } from '../../lib/tree.js'
import {
  PT_LOAI, PT_MAU, DT_BO, ptSecsOfLoai_, ptLoaiCount_, ptLibDg_, ptDaCo_, ctOf_, dtCalc_, dtApplied_, dtTien_,
  ptNccList_, ptNccKey_, ptSecItemsNcc_,
} from '../../lib/phantho.js'
import { useQsStore } from '../../state/store'
import { qsToast as toast } from '../common/dialogs'
import { ptInfo_, ptLibCount_ } from './ptModel'
import { usePtUi, setPtUi, ptOvrAll_, ptInfoUser_ } from './ptState'
import { usePtTemplate, usePhanTho } from './ptHooks'
import { ptAddToSec, ptAddFromLib, ptApplyMau, dtSetIn, dtResetIn, dtApply, dtRemove, dtValsOf, ctFavToggle } from './ptActions'
import './phantho.css'

/* Panel trái của Phần thô (port renderPTLibrary / ptMselPop_ / ptSetContractor / ptLibToggle / dtPanel_ / ptLibDragStart_,
   PUB/phantho.js:469-507, 1226-1295, 1623-1651, 2369-2393). 3 phần cắm vào CatalogPanel (1C) qua các prop
   ptCount / ptFilters / ptLib (CatalogPanel.jsx:43-46):
     usePtLibCount()  -> chữ "156 công việc" (#catCount)
     <PtFilters/>     -> các bước ① Hạng mục sản phẩm ② Tên nhà thầu ③ Dự án mẫu + bảng dự toán (#ptFilters)
     <PtLibrary/>     -> thư viện nội dung công việc (#catList)
   Không prop nào; dữ liệu lấy từ store + ptState. */

export function usePtLibCount() {
  const tpl = usePtTemplate()
  const loai = usePtLoai()
  const ncc = usePtUi(s => s.contractor)
  const secs = ptSecsOfLoai_(tpl, loai)
  if (!ncc) return ptLibCount_(secs) + ' công việc'
  return secs.reduce((n, sec) => n + ptSecItemsNcc_(sec, ncc).length, 0) + ' công việc · ' + ncc
}

const OUT_TXT = { kt_chitiet: 'Ra báo giá theo m2 / md / cái', kt_sobo: 'Ra đơn giá theo đơn gói', dt_nhancong: 'Ra báo giá theo m2 / md / cái', dt_vattu: 'Ra báo giá vật tư' }

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
  const congTac = useQsStore(s => s.congTac)
  const It = ({ on, onClick, nm, cn, sub }) => (
    <div className={`qspt-mi${on ? ' on' : ''}`} onClick={onClick}>
      <span className="nm">{nm}{sub ? <i className="qspt-isub">{sub}</i> : null}</span>
      <span className="cn">{cn || ''}</span><span className={`rd${on ? ' on' : ''}`} />
    </div>
  )
  let title = '', body = null
  if (kind === 'loai') {
    title = 'Hạng mục sản phẩm'
    body = PT_LOAI_NHOM.map(g => (
      <div key={g[0]}>
        <div className="qspt-mg">{g[1] + '. ' + g[2]}</div>
        {g[3].map(x => {
          const n = ptLoaiCount_(tpl, x[0])
          return <It key={x[0]} on={lo === x[0]} onClick={() => { onClose(); ptSetLoai(x[0]) }} nm={x[1] + ' ' + x[2]} cn={n ? (n + ' công tác') : 'chưa có'} sub={x[3]} />
        })}
      </div>
    ))
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
  const cur = usePtUi(s => s.contractor)
  const [pop, setPop] = useState(null)
  const nh = PT_LOAI_NHOM.filter(g => g[3].some(x => x[0] === loai))[0] || PT_LOAI_NHOM[0]
  const lx = nh[3].filter(x => x[0] === loai)[0] || nh[3][0]
  const open = (kind, el) => setPop(p => (p && p.kind === kind ? null : { kind, anchor: el }))
  let n = 0
  return (
    <div className="qspt-filters">
      <div className="qspt-flow">
        <Step n={++n} lb="Hạng mục sản phẩm" on onOpen={e => open('loai', e.currentTarget)}>
          <b>{nh[2]}</b> · {ptLoaiNgan(lx[2])}
        </Step>
        <Step n={++n} lb="Tên nhà thầu" on={!!cur} onOpen={e => open('ncc', e.currentTarget)}>
          {cur ? <b>{cur}</b> : 'Chọn nhà thầu'}
        </Step>
        {loai === 'kt_sobo' && (
          <Step n={++n} lb="Dự án mẫu" on={false} onOpen={e => open('mau', e.currentTarget)}>Chọn dự án mẫu → lấy cả bộ đơn giá</Step>
        )}
        <div className="qspt-out"><QsIcon name="check" size={13} /> {OUT_TXT[loai] || ''}</div>
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
  const ncc = usePtUi(s => s.contractor)
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
        const shown = ptSecItemsNcc_(sec0, ncc)
        const sec = ncc ? { ...sec0, items: shown.map(x => x.a) } : sec0
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
