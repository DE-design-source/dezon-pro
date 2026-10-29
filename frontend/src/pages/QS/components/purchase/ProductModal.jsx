import { useEffect, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import QsIcon from '../common/QsIcon'
import ImgViewer from '../common/ImgViewer'
import StatusView from '../common/StatusView'
import { MrootPortal } from '../common/Mroot'
import * as api from '../../api/qsApi'
import { isAbort } from '../../api/http'
import { mediaUrl } from '../../api/files'
import { loadSpecs, specsNow } from '../../api/specs'
import { money, ptQty, spNorm_, safeUrl_ } from '../../lib/format'
import { parseWatt, parseKelvin } from '../../lib/catalogFilters'
import { nganhCuaSP_, vsNhom_, vsVal_, vsChip_ } from '../../lib/productFields'
import { mhPrice, mhDx_, mhDisc_, mhPriceCK_ } from '../../lib/purchase'
import { imgSrc1_ } from './purchaseUi'

/* Mua hàng: bấm vào dòng sản phẩm để xem thông tin (port mhFindProd_ / mhProdModal_, PUB/muahang.js:526-565).
   Phần ảnh + thông số là bản port pdMedia_ / pdSpecs_ / pdSection_ / specRows_ / pdBullets_ (PUB/app.js:1076-1229),
   khối "Sản phẩm đi kèm" là pdLoadCombo_ / pdComboVe_ / pdCbSL_ (PUB/sanpham.js:1849-1905) khi không có nút "Thêm combo".
   Props: line (dòng bóc tách), products (danh mục), onClose(), onOpenBoc(). */

export function mhFindProd_(l, products) {
  const ma = spNorm_(l.maSP || ''), ten = spNorm_(l.ten || '')
  let p = null
  if (ma) p = (products || []).filter(x => spNorm_(x.ma || '') === ma)[0]
  if (!p && ten) p = (products || []).filter(x => spNorm_(x.ten || '') === ten)[0]
  return p || { ten: l.ten, ma: l.maSP, thuongHieu: l.thuongHieu, ncc: l.ncc, moTa: l.moTa,
    kichThuoc: l.kichThuoc, hinhAnh: l.hinhAnh, dvt: l.dvt, donGiaBan: l.donGiaBan, donGiaVon: l.donGiaVon }
}

/* pdSection_: chỉ hiện dòng có giá trị; cả nhóm ẩn nếu rỗng hết. title dạng "English|Tiếng Việt" */
function Section({ title, rows }) {
  const body = rows.filter(r => r && r[1] != null && r[1] !== '')
  if (!body.length) return null
  const t = String(title).split('|')
  return (
    <div className="qs-po-pd-block">
      <div className="qs-po-pd-sec">{t[0]}{t[1] ? <> <i>({t[1]})</i></> : null}</div>
      {body.map((r, i) => <div key={i} className="qs-po-spec"><span className="k">{r[0]}</span><span className="v">{r[1]}</span></div>)}
    </div>
  )
}
function SpecRows({ text }) {
  return String(text || '').split(/\r?\n|;|·/).map(s => s.trim()).filter(Boolean).map((line, i) => {
    const m = line.match(/^([^:：]{2,32})[:：]\s*(.+)$/)
    if (m) return <div key={i} className="qs-po-spec"><span className="k">{m[1].trim()}</span><span className="v">{m[2].trim()}</span></div>
    return <div key={i} className="qs-po-spec"><span className="v free">{line}</span></div>
  })
}
function Bullets({ text }) {
  const ds = String(text || '').split(/\r?\n/).map(x => x.replace(/^[•\-*\s]+/, '').trim()).filter(Boolean)
  return <div className="qs-po-pd-bullets">{ds.map((x, i) => <div key={i} className="qs-po-pd-bl">{x}</div>)}</div>
}
function Features({ p, title }) {
  if (!String(p.tinhNang || '').trim()) return null
  return <div className="qs-po-pd-block"><div className="qs-po-pd-sec">{title}</div><Bullets text={p.tinhNang} /></div>
}

/* pdSpecs_ theo ngành */
function Specs({ p, specs, ng }) {
  if (ng === 'vs') {
    const VS = specs.VS_SPEC, g = vsNhom_(p, specs)
    const rows = ds => ds.map(lb => [VS.METRIC[lb][1], vsVal_(p, lb, specs)])
    return (
      <>
        <Section title="Product Overview|Tổng quan sản phẩm"
          rows={rows(g.chinh).concat([['Dòng sản phẩm', p.dongSanPham || p.nhom], ['Hạng mục', VS.chuanHM(p.hangMuc) || p.hangMuc], ['Thời gian bảo hành', p.baoHanh]])} />
        <Section title="Design Specifications|Thông số thiết kế" rows={rows(g.tk)} />
        <Features p={p} title={<>Features <i>(Tính năng)</i></>} />
      </>
    )
  }
  if (ng === 'son') {
    const SON = specs.SON_SPEC, g = vsNhom_(p, specs)
    const rows = ds => ds.map(lb => [SON.METRIC[lb][1], vsVal_(p, lb, specs)])
    return (
      <>
        <Section title="Key Product Info|Thông tin chính"
          rows={rows(g.chinh).concat([['Dòng sản phẩm', p.dongSanPham || SON.chuanHM(p.hangMuc) || p.hangMuc], ['Hạng mục', SON.MUC]])} />
        <Features p={p} title="Tính năng sản phẩm" />
        <Section title={SON.TEN_TK} rows={rows(g.tk)} />
      </>
    )
  }
  if (ng === 'dl') {
    const DL = specs.DL_SPEC, h = DL.hmOf(p.hangMuc), raw = p.raw || {}
    const M = h ? h.nhom : { chinh: DL.CHINH_ALL, hs: [], ket: [], lap: DL.TK_ALL }
    const rows = ds => ds.map(lb => DL.dong(lb, c => raw[c]) || ['', ''])
    const chung = [['Dòng sản phẩm', p.dongSanPham || p.nhom], ['Hạng mục', DL.chuanHM(p.hangMuc) || p.hangMuc], ['Thời gian bảo hành', p.baoHanh]]
    return (
      <>
        {DL.KHOI.map((k, i) => <Section key={k[0]} title={k[1]} rows={rows(M[k[0]]).concat(i === 0 ? chung : [])} />)}
        <Features p={p} title={<>Features <i>(Tính năng)</i></>} />
      </>
    )
  }
  if (ng === 'ct') {
    const CT = specs.CT_SPEC, h = CT.hmOf(p.hangMuc), raw = p.raw || {}
    const rows = ds => ds.map(lb => CT.dong(lb, c => raw[c]) || ['', ''])
    const chung = [['Dòng sản phẩm', p.dongSanPham || p.nhom], ['Hạng mục', CT.chuanHM(p.hangMuc) || p.hangMuc], ['Thời gian bảo hành', p.baoHanh]]
    const tn = <Features p={p} title={<>Features <i>(Tính năng)</i></>} />
    if (!h) {
      const g = vsNhom_(p, specs)
      return <><Section title="Key Product Info|Thông tin chính" rows={rows(g.chinh).concat(chung)} /><Section title="Design Specifications|Thông số thiết kế" rows={rows(g.tk)} />{tn}</>
    }
    const M = h.nhom
    return (
      <>
        <Section title="Key Product Info|Thông tin chính" rows={rows(M.chinh).concat(chung)} />
        <Section title="Electrical Specifications|Thông số điện & an toàn" rows={rows(M.dien)} />
        <Section title={(h.loai === 'oc' ? 'USB / Signal / Smart|' : 'Smart & Control|') + M.tenTm} rows={rows(M.tm)} />
        <Section title="Installation Specifications|Thông số lắp đặt" rows={rows(['KIỂU LẮP ĐẶT', 'SỐ MODULE CHIẾM (ô)', '@KT', 'LOẠI ĐẾ TƯƠNG THÍCH', 'ĐỘ SÂU HỘP ÂM TỐI THIỂU (mm)', 'TIẾT DIỆN DÂY TỐI ĐA (mm²)'])} />
        {tn}
      </>
    )
  }
  return (
    <>
      <Section title="Design Specifications|Thông số thiết kế" rows={[
        ['Chất liệu', p.chatLieu], ['Chiều cao', p.chieuCao], ['Đường kính', p.duongKinh],
        ['Góc nghiêng / góc chỉnh hướng', p.gocNghieng], ['Dòng sản phẩm', p.dongSanPham || p.nhom]]} />
      <Section title="Performance Specifications|Thông số hiệu suất" rows={[
        ['Quang thông', p.quangThong], ['Chỉ số IP (Chống bụi, nước)', p.capBaoVe], ['CRI', p.cri],
        ['Hiệu suất phát quang (Efficacy)', p.hieuSuat], ['Chỉ số gây chói mắt (UGR)', p.ugr],
        ['Tuổi thọ đèn', p.tuoiTho], ['Loại chip LED', p.chipLed],
        ['Độ đồng nhất màu sắc (SDCM)', p.sdcm], ['Chỉ số ngộ độc Cyanosis (COI Compliance)', p.coi],
        ['Thời gian bảo hành', p.baoHanh]]} />
      <Section title="Driver|Nguồn LED / Chấn lưu" rows={[
        ['Bộ nguồn', p.tenBoNguon], ['Mã sản phẩm', p.maBoNguon], ['Hãng bộ nguồn', p.hangBoNguon],
        ['Vị trí lắp đặt bộ nguồn', p.viTriNguon], ['Tương thích điều khiển (Control Type)', p.tuongThich],
        ['Cường độ dòng điện đầu ra tối đa', p.dongRa]]} />
      <Section title="Installation Specifications|Thông số lắp đặt" rows={[
        ['Lắp đặt bộ nguồn rời', p.lapNguonRoi], ['Kích thước lỗ khoét trần (Cutout Size)', p.loKhoet],
        ['Cấp bảo vệ an toàn điện (Class Rating)', p.capBaoVeDien]]} />
      {p.moTa && !p.chatLieu && !p.quangThong
        ? <div className="qs-po-pd-block"><div className="qs-po-pd-sec">Thông số kỹ thuật <i>(mô tả)</i></div><SpecRows text={p.moTa} /></div>
        : null}
    </>
  )
}

/* pdMedia_: gallery + mã + tên + Key Product Info */
function Media({ p, specs, ng, idx, setIdx, onZoom }) {
  let keyItems
  if (ng === 'son' || ng === 'ct' || ng === 'dl') keyItems = []
  else if (ng === 'vs') keyItems = vsChip_(p, specs)
  else {
    const cong = p.congSuat || parseWatt(p.ten), nd = p.nhietDo || parseKelvin(p.ten)
    keyItems = [
      ['power', cong + (p.dongRa ? (' (' + p.dongRa + (/mA/i.test(p.dongRa) ? '' : 'mA') + ')') : '')],
      ['temp', nd + (p.quangThong ? (' (' + p.quangThong + (/lm/i.test(p.quangThong) ? '' : 'lm') + ')') : '')],
      ['color', p.mauSac],
      ['angle', p.gocChieu],
    ].filter(x => x[1] && String(x[1]).trim())
  }
  const imgs = String(p.anhTatCa || p.hinhAnh || '').split('\n').map(s => s.trim()).filter(Boolean).map(mediaUrl)
  const i = imgs.length ? ((idx % imgs.length) + imgs.length) % imgs.length : 0
  const [bad, setBad] = useState('')
  return (
    <>
      <div className="qs-po-pd-gal">
        <div className="qs-po-pd-imgbox">
          {imgs[0]
            ? <img src={imgs[i]} alt="" title="Bấm để xem ảnh lớn" style={bad === imgs[i] ? { visibility: 'hidden' } : null}
                onError={() => setBad(imgs[i])} onClick={() => onZoom(imgs[i], imgs)} />
            : <span className="qs-po-pd-noimg"><QsIcon name="image" size={26} /><i>Chưa có ảnh</i></span>}
          {imgs.length > 1 && (
            <>
              <button type="button" className="qs-po-pd-nav prev" title="Ảnh trước (←)" onClick={e => { e.stopPropagation(); setIdx(i - 1) }}><QsIcon name="left" size={18} /></button>
              <button type="button" className="qs-po-pd-nav next" title="Ảnh sau (→)" onClick={e => { e.stopPropagation(); setIdx(i + 1) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
              <span className="qs-po-pd-count">{(i + 1) + '/' + imgs.length}</span>
            </>
          )}
          {imgs[0] && <a className="qs-po-pd-imgdl" href={safeUrl_(imgs[0])} target="_blank" rel="noopener" title="Mở ảnh gốc"><QsIcon name="download" size={14} /></a>}
        </div>
        {imgs.length > 1 && (
          <div className="qs-po-pd-thumbs">
            {imgs.map((v, k) => (
              <button type="button" key={k} className={`qs-po-pd-thumb${k === i ? ' on' : ''}`} title={'Ảnh ' + (k + 1)} onClick={() => setIdx(k)}>
                <img src={v} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="qs-po-pd-code">{p.ma || p.ten}</div>
      {p.ten ? <div className="qs-po-pd-name">{p.ten}</div> : null}
      {keyItems.length > 0 && (
        <div className="qs-po-pd-block">
          <div className="qs-po-pd-sec">Key Product Info <i>(Thông tin chính)</i></div>
          <div className="qs-po-pd-keys">
            {keyItems.map((x, k) => <div key={k} className="qs-po-pd-key"><span className="ic"><QsIcon name={x[0]} size={15} /></span><span>{x[1]}</span></div>)}
          </div>
        </div>
      )}
    </>
  )
}

/* Khối "Sản phẩm đi kèm" (chỉ xem + sửa SL tạm, không có nút Thêm combo vì mở từ Mua hàng) */
function Combo({ p }) {
  const key = p.recordId || p.ma
  const [st, setSt] = useState(() => (key ? { loading: true, list: [] } : { list: [] }))
  useEffect(() => {
    if (!key) return undefined
    const ctl = new AbortController()
    api.getCombo(String(key), ctl.signal)
      .then(list => setSt({ list: (list || []).map(x => ({ ...x })) }))
      .catch(e => { if (!isAbort(e)) setSt({ list: [], err: e.message }) })
    return () => ctl.abort()
  }, [key])
  if (st.err != null) return <div className="qs-po-pcb-err">Không tải được sản phẩm đi kèm: {st.err}</div>
  const list = st.list
  if (!list.length) return null
  const bo = 1
  const tong = list.reduce((a, x) => a + (Number(x.donGiaBan) || 0) * (Number(x.comboSL) || 1) * bo, 0)
  const setSL = (k, v) => {
    const sl = Math.round(Number(String(v).replace(',', '.')) || 0)
    setSt(s => ({ ...s, list: s.list.map((x, j) => (j === k ? { ...x, comboSL: Math.max(1, Math.min(9999, sl || 1)) } : x)) }))
  }
  return (
    <div className="qs-po-pcb">
      <div className="qs-po-pcb-h"><span className="qs-po-pcb-t"><QsIcon name="layers" size={14} /> Sản phẩm đi kèm</span><span className="qs-po-pcb-n">{list.length}</span></div>
      <div className="qs-po-pcb-list">
        {list.map((x, k) => {
          const sl = Number(x.comboSL) || 1, dg = Number(x.donGiaBan) || 0, slTong = sl * bo
          return (
            <div key={k} className="qs-po-pcb-r" title={x.comboNguoc ? 'Liên kết đặt từ phía sản phẩm kia — đi kèm 2 chiều' : undefined}>
              {x.hinhAnh ? <img className="qs-po-pcb-th" src={imgSrc1_(x.hinhAnh)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="qs-po-pcb-th" />}
              <div className="qs-po-pcb-m"><b>{x.ten || ''}{x.comboNguoc ? <> <span className="qs-po-pcb-rev">↔</span></> : null}</b>
                <span>{(x.ma || '') + (x.ma ? ' · ' : '') + money(dg) + ' đ'}</span></div>
              <div className="qs-po-pcb-p"><b>{money(dg * slTong)} đ</b>
                <label className="qs-po-pcb-q" title="Số lượng đi kèm cho MỖI bộ">SL <input type="number" min="1" step="1" defaultValue={sl} key={sl} onBlur={e => setSL(k, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>
              </div>
            </div>
          )
        })}
      </div>
      <div className="qs-po-pcb-tot"><span>Tổng combo</span><b>{money(tong)} đ</b></div>
    </div>
  )
}

export default function ProductModal({ line, products, onClose, onOpenBoc }) {
  const l = line
  const p = mhFindProd_(l, products)
  const [specs, setSpecs] = useState(specsNow)
  const [specErr, setSpecErr] = useState('')
  const [idx, setIdx] = useState(0)
  const [zoom, setZoom] = useState(null)
  const zoomRef = useRef(null)
  zoomRef.current = zoom

  useEffect(() => {
    if (specs) return
    let live = true
    loadSpecs().then(s => { if (live) setSpecs(s) }).catch(e => { if (live) setSpecErr(e.message || 'Không tải được thông số ngành') })
    return () => { live = false }
  }, [specs])

  /* ←/→ lật ảnh, Esc đóng (spModalKey_); đang xem ảnh lớn thì để ImgViewer xử lý */
  useEffect(() => {
    const k = e => {
      if (zoomRef.current) return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setIdx(i => i - 1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setIdx(i => i + 1) }
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])

  const sl = Number(l.soLuong) || 0, dg = mhPrice(l), pctDx = mhDx_(l), pctCK = mhDisc_(l)
  const ng = specs ? nganhCuaSP_(p, specs) : (specErr ? 'den' : nganhCuaSP_(p, null))
  const cho = !specs && !specErr && ng !== 'den'   // chưa biết ngành (đợi spec) -> chưa vẽ thông số
  const o = (k, v, cls) => <div className={`qs-po-pm-i${cls ? ' ' + cls : ''}`}><span>{k}</span><b>{v}</b></div>

  return (
    <MrootPortal>
      <div className="qsc-ov" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="qsc-dlg qs-po-pm" role="dialog" aria-modal="true">
          <div className="qs-po-dlg-h">
            <h3>Thông tin sản phẩm</h3>
            <span className="qs-po-pm-ncc"><Icon name="building" size={13} /> {l.ncc || l.thuongHieu || ''}</span>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button>
          </div>
          <div className="qs-po-pm-grid">
            <div className="qs-po-pm-left">
              {cho ? null : <Media p={p} specs={specs} ng={ng} idx={idx} setIdx={setIdx} onZoom={(src, gal) => setZoom({ src, gal })} />}
            </div>
            <div className="qs-po-pm-right">
              {specErr ? <StatusView kind="specsMissing" message={specErr.replace(/^Không tải được thông số ngành\s*\(?([^)]*)\)?$/, '$1')} /> : null}
              {cho ? <div className="qs-po-dx-empty">Đang tải…</div> : <Specs p={p} specs={specs} ng={ng} />}
              <div className="qs-po-pm-box">
                <div className="qs-po-pd-sec">Trong đơn mua hàng này</div>
                {o('Số lượng', ptQty(sl) + ' ' + (l.dvt || 'Cái'))}
                {o('Đơn giá mua', money(dg) + ' đ')}
                {pctDx ? o('Đề xuất giảm', pctDx + '%', 'dx') : null}
                {pctCK ? o('Giảm giá NCC đã chốt', pctCK + '%') : null}
                {o('Thành tiền sau CK', money(sl * mhPriceCK_(l)) + ' đ', 'tot')}
              </div>
            </div>
          </div>
          <Combo p={p} />
          <div className="qs-po-pm-actions">
            <button type="button" className="qsc-btn" onClick={onClose}>Đóng</button>
            <button type="button" className="qsc-btn blue" onClick={onOpenBoc}><Icon name="layers" size={14} /> Mở bảng bóc tách</button>
          </div>
        </div>
      </div>
      {zoom && <ImgViewer src={zoom.src} gallery={zoom.gal} onClose={() => setZoom(null)} onIndexChange={k => setIdx(k)} />}
    </MrootPortal>
  )
}
