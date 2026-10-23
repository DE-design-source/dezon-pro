import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../../../components/ui/Icon'
import QsIcon from '../common/QsIcon'
import ChangeInput from './ChangeInput'
import NodePicker from './NodePicker'
import { useBgFontLink } from './QuotePreview'
import { BIA_MAX, biaMauDs, biaDangChon, biaKhop, biaApDung, biaLuuMoi, biaLuuDe, biaXoa } from './biaMau'
import { PresetDock, ColsStrip } from '../breakdown/sheet/ColsTools'
import { myCols, useTkCols, setColsMap, startEdit, cancelEdit, endEdit } from '../breakdown/sheet/tkCols'
import { setVat } from '../breakdown/sheet/bocActions'
import { COLS, COLSET, csQuickLabel_ } from '../../lib/columns.js'
import { money, tkNum_ } from '../../lib/format.js'
import { currentGroup, draftName_ } from '../../lib/dashModel.js'
import {
  BG_MAU_DS, BG_NOI_BO, bgNoiBoXuat_, bgNoiBoBat_, bgBiaCanh_, bgLines_, bgPTRows_, bgOpt_, bgTong_, computeQuoteLocal, bgGhiChu_, docSoVN_, bgOrg_,
} from '../../lib/quote.js'
import { bgDocCols_, bgBia_, BG_TT_DS, BG_LOGO_MIN, BG_LOGO_MAX, TD_CO_MIN, TD_CO_MAX, docImg_ } from './docModel'
import { bgChu_, bgSoOf_, BG_SO_MIN, BG_SO_MAX, appFontName_, appFontValue_, TT_CO_MIN, TT_CO_MAX, TK_LUI_MAX, khungKeys_, khungW_, KH_W_MIN, KH_W_MAX, BG_HD_NEN, BG_HD_NEN_DS, BG_KIEU_DS, BG_CANH_DS } from './docCss'
import { FONT_CATALOG, FONT_CATEGORIES, isFontAvailable } from '../../../../data/fontCatalog'
import {
  useQuoteUi, setQ, bgSetPer_, bgTogglePerSec_, bgColReset_, bgColTuyBien_,
} from './quoteState'
import { qsToast as toast } from '../common/dialogs'
import { bgChot, bgMauDat, bgNoiBoDat, bgOptSet, bgOptSetMany, bgOrgEdit, bgDotSet, bgDotAdd, bgDotDel } from './quoteActions'

const PER_OPTS = [['0', 'Tự động'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15'], ['18', '18'], ['20', '20'], ['25', '25'], ['30', '30']]

/* Module của cột trái (thay thẻ đánh số bgThe_ PUB/baogia.js:525-527): chỉ tên + tóm tắt; chi tiết mở ở khung bên phải (The / DockCtx) */
/* Khung mở rộng bên phải cột trái (như khung "Chọn nhanh cột" của Bóc tách): nút ở góc module mở module đó thành 1 khung rộng
   cạnh cột trái, đủ chi tiết; module trong cột trái thu lại (đánh dấu đang mở). Mỗi lúc 1 khung. */
const DockCtx = createContext(null)
function The({ id, ten, phu, className = '', children }) {
  const dock = useContext(DockCtx)
  const docked = !!dock && dock.id === id
  /* Cột trái chỉ còn tên chức năng + tóm tắt (bản rút gọn); bấm thẻ / nút vòng tròn > thì chi tiết hiện ở khung bên phải */
  const openDock = ev => { if (ev) ev.stopPropagation(); if (dock) dock.set(docked ? null : { id, ten, phu }) }
  return (
    <section className={`qsq-card qsq-mod folded${docked ? ' docked' : ''}${className ? ' ' + className : ''}`}>
      <header onClick={openDock} title={docked ? 'Đang mở ở khung bên phải — bấm để đóng' : 'Xem chi tiết ở khung bên phải'} aria-expanded={docked}>
        <div><b>{ten}</b>{phu ? <span>{phu}</span> : null}</div>
        <button type="button" className={`qsq-dockbtn${docked ? ' on' : ''}`} onClick={openDock}
          title={docked ? 'Đóng khung bên phải' : 'Mở chi tiết ở khung bên phải'} aria-label="Mở chi tiết">
          <Icon name={docked ? 'x' : 'chevronRightCircle'} size={docked ? 13 : 18} />
        </button>
      </header>
      {docked && dock.el ? createPortal(children, dock.el) : null}
    </section>
  )
}
/* Thông tin công ty dưới logo: "Theo mẫu chung" (Thông tin công ty trên báo giá, dùng cho mọi báo giá — Admin sửa)
   hoặc "Tự nhập" riêng cho báo giá này (bgCfg.ttRieng); chuyển sang Tự nhập lần đầu thì chép sẵn từ mẫu chung */
const TT_O = [['diaChi', 'Địa chỉ'], ['sdt', 'Điện thoại'], ['email', 'Email'], ['web', 'Website'], ['xuong', 'Dòng thêm (xưởng, MST…)']]
function TtCty({ ctx, bia }) {
  const o = ctx.bgOrg || {}; const ct = ctx.congTy || {}
  const mau = { diaChi: o.diaChi || '', sdt: o.sdt || ct.sdt || '', email: o.email || ct.email || '', web: o.web || '', xuong: o.xuong || '' }
  const chung = bgOrg_(ctx.congTy, ctx.bgOrg).lines
  const tuNhap = () => {
    const daCo = Object.keys(bia.ttRieng).length > 0
    const r = {}; TT_O.forEach(([k]) => { if (mau[k]) r[k] = mau[k] })
    bgOptSetMany({ ttKieu: 'rieng', ...(daCo ? {} : { ttRieng: Object.keys(r).length ? r : null }) })
  }
  const datO = (k, v) => {
    const r = { ...bia.ttRieng }; v = String(v || '').trim(); if (v) r[k] = v; else delete r[k]
    bgOptSet('ttRieng', Object.keys(r).length ? r : null)
  }
  return (
    <>
      <div className="qs-qt-mode qsq-seg2" role="radiogroup" aria-label="Nguồn thông tin công ty">
        <button type="button" role="radio" aria-checked={bia.ttKieu === 'chung'} className={bia.ttKieu === 'chung' ? 'on' : ''}
          title="Lấy từ Thông tin công ty trên báo giá (dùng chung mọi báo giá)" onClick={() => bgOptSet('ttKieu', null)}>Theo mẫu chung</button>
        <button type="button" role="radio" aria-checked={bia.ttKieu === 'rieng'} className={bia.ttKieu === 'rieng' ? 'on' : ''}
          title="Tự nhập riêng cho báo giá này" onClick={tuNhap}>Tự nhập</button>
      </div>
      {bia.ttKieu === 'chung' ? (
        <div className="qsq-ttmau">
          {chung.length ? chung.map((d, i) => <div key={i}>{d}</div>) : <i>Mẫu chung chưa có địa chỉ / liên hệ.</i>}
          <button type="button" className="qs-qt-btn" title="Sửa mẫu chung — áp dụng cho mọi báo giá (chỉ Admin)" onClick={bgOrgEdit}>
            <Icon name="building" size={13} />Sửa mẫu chung</button>
        </div>
      ) : TT_O.map(([k, nhan]) => (
        <div key={k} className="qsq-tto">
          <label className="qsq-lb">{nhan}</label>
          <ChangeInput className="qsq-in" value={bia.ttRieng[k] || ''} placeholder={mau[k] || 'Để trống = không in'} onCommit={v => datO(k, v)} />
        </div>
      ))}
    </>
  )
}
/* Thông tin dự án trên bìa (khung Trang bìa): 2 tab con — Thông tin (Mặc định + Mở rộng) · Tuỳ biến; Tuỳ biến tách cột nhãn (TÊN DỰ ÁN…) và cột nội dung (giá trị) */
const TT_GOI = ['Nhân viên phụ trách báo giá', 'Chủ trì thiết kế', 'Kỹ sư dự toán', 'Người duyệt']
function TtKieu({ ten, co, font, mau, mauMac, k, fontNhom }) {
  return (
    <TtPhan id={'tt' + k} ten={ten}>
      <label className="qsq-lb">Cỡ chữ · Font</label>
      <div className="qsq-tdkieu">
        <SoChu v={co} min={TT_CO_MIN} max={TT_CO_MAX} step={0.5} don="px" onSet={n => bgOptSet(k + 'Co', n)} />
        <FontChon nhom={fontNhom} value={font} onSet={v => bgOptSet(k + 'Font', v)} />
      </div>
      <div className="qsq-mau-h"><label className="qsq-lb">Màu chữ</label>
        <ChangeInput type="color" value={mau || mauMac} onCommit={v => bgOptSet(k + 'Mau', v)} />
        {mau && <button type="button" className="qsq-link" onClick={() => bgOptSet(k + 'Mau', null)}>Mặc định</button>}
      </div>
    </TtPhan>
  )
}
/* Thanh kéo số (thả tay mới lưu, như LogoKeo): v0 giá trị đang lưu, hiện số + đơn vị */
function KeoSo({ v0, min, max, step = 1, trai, phai, don, onSet }) {
  const [v, setV] = useState(v0)
  const keo = useRef(false)
  useEffect(() => { if (!keo.current) setV(v0) }, [v0])
  const luu = () => { keo.current = false; if (v !== v0) onSet(v) }
  return (
    <div className="qsq-keo">
      <span>{trai}</span>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={e => { keo.current = true; setV(Number(e.target.value)) }} onPointerUp={luu} onKeyUp={luu} onBlur={luu} />
      <span>{phai}</span>
      <b>{v}{don}</b>
    </div>
  )
}
/* Bộ tuỳ chọn khung dùng chung cho 3 mục (pre: tk = thông tin dự án, tdk = khung tiêu đề, ctk = bảng chi tiết hạng mục) */
function KhungTuy({ pre, chu, coDoc = true, ngangNhan = 'Kẻ dòng (ngang)' }) {
  const k = x => pre + x
  const seg = (key, ds, v) => (
    <div className={'qs-qt-mode qsq-seg' + ds.length} role="radiogroup">
      {ds.map(([x, nhan]) => <button type="button" key={x} role="radio" aria-checked={v === x} className={v === x ? 'on' : ''} onClick={() => bgOptSet(key, x)}>{nhan}</button>)}
    </div>
  )
  /* nét riêng của 1 đường (x = B viền / N ngang / D dọc): độ dày · kiểu · màu */
  const net = x => (
    <>
      {/* độ dày nét: thanh kéo 0,25–4 px (thả tay mới lưu); kiểu nét bên dưới */}
      <KeoSo v0={khungW_(chu[k(x + 'Day')])} min={KH_W_MIN} max={KH_W_MAX} step={0.25} trai="Mảnh" phai="Dày" don="px" onSet={n => bgOptSet(k(x + 'Day'), n)} />
      {seg(k(x + 'Kieu'), BG_KIEU_DS, chu[k(x + 'Kieu')])}
      <div className="qsq-mau-h"><label className="qsq-lb">Màu nét</label>
        <ChangeInput type="color" value={chu[k(x + 'Mau')]} onCommit={v => bgOptSet(k(x + 'Mau'), v)} />
      </div>
    </>
  )
  const lui = (key, nhan) => (
    <>
      <label className="qsq-chk"><input type="checkbox" checked={chu[key] > 0} onChange={e => bgOptSet(key, e.target.checked ? 16 : null)} /> {nhan}</label>
      {chu[key] > 0 && <KeoSo v0={chu[key]} min={2} max={TK_LUI_MAX} trai="Ít" phai="Nhiều" don="px" onSet={n => bgOptSet(key, n)} />}
    </>
  )
  return (
    <>
      {/* Viền (bao quanh + bo góc) · Ngang (kẻ dòng, lùi 2 đầu) · Dọc (kẻ cột, lùi 2 đầu) · Khoảng cách dòng; mỗi đường nét riêng */}
      <div className="qsq-khnhom">
        <b>Viền</b>
        <label className="qsq-chk"><input type="checkbox" checked={chu[k('Bao')]} onChange={e => bgOptSet(k('Bao'), e.target.checked)} /> Viền bao quanh</label>
        <label className="qsq-lb">Bo góc</label>
        <SoChu v={chu[k('Bo')]} min={0} max={20} step={1} don="px (0–20)" onSet={n => bgOptSet(k('Bo'), n)} />
        {chu[k('Bao')] && net('B')}
      </div>
      <div className="qsq-khnhom">
        <b>Ngang</b>
        <label className="qsq-chk"><input type="checkbox" checked={chu[k('Ngang')]} onChange={e => bgOptSet(k('Ngang'), e.target.checked)} /> {ngangNhan}</label>
        {chu[k('Ngang')] && <>{lui(k('Lui'), 'Lùi 2 đầu (không chạm khung trái / phải)')}{net('N')}</>}
      </div>
      {coDoc && (
        <div className="qsq-khnhom">
          <b>Dọc</b>
          <label className="qsq-chk"><input type="checkbox" checked={chu[k('Doc')]} onChange={e => bgOptSet(k('Doc'), e.target.checked)} /> Kẻ cột (dọc)</label>
          {chu[k('Doc')] && <>{lui(k('LuiD'), pre === 'ctk' ? 'Lùi 2 đầu (chỉ dòng đề mục nhỏ: vạch dọc không chạm cạnh ô)' : 'Lùi 2 đầu (không chạm khung trên / dưới)')}{net('D')}</>}
        </div>
      )}
      <div className="qsq-khnhom">
        <b>Khoảng cách dòng</b>
        <SoChu v={chu[k('Cach')]} min={2} max={24} step={1} don="px (2–24)" onSet={n => bgOptSet(k('Cach'), n)} />
      </div>
      {chu[k('Set')] && (
        <button type="button" className="qs-qt-btn qsq-full" onClick={() => bgOptSetMany(Object.fromEntries(khungKeys_(pre).map(x => [x, null])))}>
          <Icon name="undo" size={13} />Khung mặc định</button>
      )}
    </>
  )
}
/* Khung con Mặc định / Mở rộng của tab Thông tin: tiêu đề + nút thu gọn (nhớ theo máy chung với Sub, qs_bg_sub) */
function TtPhan({ id, ten, children }) {
  const [gon, setGon] = useState(() => { try { return !!(JSON.parse(localStorage.getItem('qs_bg_sub') || '{}') || {})[id] } catch (e) { return false } })
  const doi = () => setGon(v => {
    try { const m = JSON.parse(localStorage.getItem('qs_bg_sub') || '{}') || {}; m[id] = !v; localStorage.setItem('qs_bg_sub', JSON.stringify(m)) } catch (e) { /* bỏ qua */ }
    return !v
  })
  return (
    <div className={`qsq-ttphan${gon ? ' gon' : ''}`}>
      <div className="qsq-ttphan-h" onClick={doi} title={gon ? 'Mở rộng' : 'Thu gọn'}>
        <b>{ten}</b>
        <button type="button" className="qsq-subbtn" aria-label={gon ? 'Mở rộng' : 'Thu gọn'} aria-expanded={!gon}>
          <Icon name={gon ? 'chevronDown' : 'chevronUp'} size={14} />
        </button>
      </div>
      {!gon && children}
    </div>
  )
}
function TtDuAn({ bia }) {
  const datThem = n => bgOptSet('ttThem', n.length ? n : null)
  const goi = TT_GOI.filter(k => !bia.ttThem.some(x => x.k === k))
  return (
    <>
      {/* Mặc định: các mục lấy từ hộp Thông tin dự án, bật / tắt bằng chip */}
      <TtPhan id="ttmd" ten="Mặc định">
        <div className="qsq-chipcot">
          {BG_TT_DS.map(([k, nhan]) => {
            const on = bia.hienTT.indexOf(k) >= 0
            return <button type="button" key={k} className={'qs-bd-strip-chip qs-colchip' + (on ? ' on' : '')} aria-pressed={on} title={on ? 'Bấm để ẩn mục này trên tờ bìa' : 'Bấm để hiện'}
              onClick={() => { bgOptSet('hienTT', on ? bia.hienTT.filter(x => x !== k) : BG_TT_DS.map(x => x[0]).filter(x => x === k || bia.hienTT.indexOf(x) >= 0)) }}>{nhan}</button>
          })}
        </div>
        <div className="qsq-ttphan-f">
          <button type="button" className={'qs-bd-strip-btn qs-colchip-act' + (bia.hienTT.length === BG_TT_DS.length ? ' on' : '')}
            onClick={() => bgOptSet('hienTT', bia.hienTT.length === BG_TT_DS.length ? null : BG_TT_DS.map(x => x[0]))}>Hiện tất cả</button>
        </div>
      </TtPhan>
      {/* Mở rộng: dòng tự đặt (nhãn + nội dung), in sau các mục mặc định; mỗi dòng 1 thẻ, thêm nhanh bằng gợi ý */}
      <TtPhan id="ttmr" ten="Mở rộng">
        {bia.ttThem.length ? (
          <div className="qsq-mr">
            {bia.ttThem.map((x, i) => (
              <div key={i} className="qsq-mr-dong">
                <span className="qsq-mr-so">{i + 1}</span>
                <div className="qsq-mr-o">
                  <ChangeInput as="textarea" rows={1} className="qsq-mr-k" value={x.k || ''} placeholder="NHÃN"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                    onCommit={v => datThem(bia.ttThem.map((y, j) => (j === i ? { ...y, k: String(v || '').trim() } : y)))} />
                  <ChangeInput className="qsq-mr-v" value={x.v || ''} placeholder="Nhập nội dung…"
                    onCommit={v => datThem(bia.ttThem.map((y, j) => (j === i ? { ...y, v: String(v || '').trim() } : y)))} />
                </div>
                <button type="button" className="qsq-mr-x" aria-label="Bỏ dòng này" onClick={() => datThem(bia.ttThem.filter((y, j) => j !== i))}><Icon name="x" size={13} /></button>
              </div>
            ))}
          </div>
        ) : null}
        {/* nút thêm nhanh: mỗi nút 1 hàng riêng */}
        <div className="qsq-mr-them">
          {goi.map(k => (
            <button type="button" key={k} className="qs-bd-strip-btn qs-colchip-act" onClick={() => datThem([...bia.ttThem, { k, v: '' }])}>+ {k}</button>
          ))}
          <button type="button" className="qs-bd-strip-btn qs-colchip-act" onClick={() => datThem([...bia.ttThem, { k: 'Mục mới', v: '' }])}>+ Mục khác</button>
        </div>
      </TtPhan>
    </>
  )
}
/* Tuỳ biến (tab chính): chọn vùng trên sơ đồ trang thu nhỏ — Toàn báo giá · Tiêu đề · Thông tin dự án · Bảng hạng mục —
   rồi chỉnh đúng vùng đó: nhóm Chữ (font · cỡ · màu) và nhóm Khung & nét (viền · kẻ ngang / dọc · lùi · khoảng cách dòng).
   Vùng đang chọn nhớ theo máy (qs_bg_tuyvung) */
const TB_VUNG = [
  ['chung', 'Toàn báo giá', 'Màu chủ đạo, font và cỡ chữ chung cho mọi trang.'],
  ['td', 'Tiêu đề', 'Hộp tiêu đề nền màu trên đầu tờ bìa.'],
  ['tt', 'Thông tin dự án', 'Bảng Tên dự án / Khách hàng… trên tờ bìa.'],
  ['ct', 'Bảng hạng mục', 'Bảng chi tiết hạng mục — tờ bìa và các trang tính.'],
]
function TuyBien({ mau, chu, bia, fontNhom }) {
  const [vung, setVungS] = useState(() => { try { return localStorage.getItem('qs_bg_tuyvung') || 'chung' } catch (e) { return 'chung' } })
  const setVung = v => { setVungS(v); try { localStorage.setItem('qs_bg_tuyvung', v) } catch (e) { /* bỏ qua */ } }
  const tt = TB_VUNG.find(x => x[0] === vung) || TB_VUNG[0]
  const nut = (v, cls, children) => (
    <button type="button" className={cls + (vung === v ? ' on' : '')} aria-pressed={vung === v} title={TB_VUNG.find(x => x[0] === v)[1]} onClick={() => setVung(v)}>{children}</button>
  )
  return (
    <>
      {/* sơ đồ trang: bấm vào vùng cần chỉnh */}
      <div className="qsq-tbmap">
        {nut('chung', 'qsq-tbmap-all', <><Icon name="layers" size={14} />Toàn báo giá</>)}
        <div className="qsq-tbmap-pg" aria-label="Sơ đồ trang báo giá">
          {nut('td', 'qsq-tbmap-td', <><i /><i /><i /></>)}
          {nut('tt', 'qsq-tbmap-tt', <><i /><i /><i /><i /></>)}
          {nut('ct', 'qsq-tbmap-ct', <><i className="h" /><i /><i className="sec" /><i /><i /></>)}
        </div>
      </div>
      <div className="qsq-tbvung">
        <b>{tt[1]}</b>
        <span>{tt[2]}</span>
      </div>

      {vung === 'chung' && (
        <>
          <TtPhan id="tbc-mau" ten="Màu chủ đạo">
            <div className="qsq-mau-h"><label className="qsq-lb">Màu tiêu đề &amp; bảng</label><code>{mau.toUpperCase()}</code>
              <ChangeInput type="color" value={mau} title="Chọn màu khác" onCommit={v => bgMauDat(v)} /></div>
            <div className="qsq-mau">
              {BG_MAU_DS.map(c => <button type="button" key={c} className={c === mau ? 'on' : ''} style={{ background: c }} title={c.toUpperCase()} onClick={() => bgMauDat(c)} />)}
            </div>
          </TtPhan>
          <TtPhan id="tbc-chu" ten="Chữ">
            <label className="qsq-lb">Font chữ</label>
            <select className="qsq-in" value={chu.font} style={chu.font ? { fontFamily: chu.font } : undefined}
              title="Font của báo giá (xem trước, In / PDF); mặc định theo font ở Cài đặt ▸ Giao diện" onChange={e => bgOptSet('font', e.target.value || null)}>
              <option value="">Theo cài đặt chung ({appFontName_()})</option>
              {fontNhom.map(([cat, nhan, ds]) => (
                <optgroup key={cat} label={nhan}>
                  {ds.map(x => <option key={x.name} value={x.value || "'Montserrat', sans-serif"}>{x.name}</option>)}
                </optgroup>
              ))}
            </select>
            <label className="qsq-lb">Cỡ chữ</label>
            <CoSo pct={chu.co} onSet={n => bgOptSet('coSo', n)} />
          </TtPhan>
        </>
      )}

      {vung === 'td' && (
        <>
          <TtPhan id="tbtd-chu" ten="Chữ">
            <div className="qsq-khnhom">
              <b>Chữ tiêu đề</b>
              <div className="qsq-tdkieu">
                <SoChu v={bia.tdCo1} min={TD_CO_MIN} max={TD_CO_MAX} step={0.5} don="px" onSet={n => bgOptSet('tdCo1', n)} />
                <FontChon nhom={fontNhom} value={bia.tdFont1} onSet={v => bgOptSet('tdFont1', v)} />
              </div>
            </div>
            <div className="qsq-khnhom">
              <b>Dòng hạng mục</b>
              <div className="qsq-tdkieu">
                <SoChu v={bia.tdCo2} min={TD_CO_MIN} max={TD_CO_MAX} step={0.5} don="px" onSet={n => bgOptSet('tdCo2', n)} />
                <FontChon nhom={fontNhom} value={bia.tdFont2} onSet={v => bgOptSet('tdFont2', v)} />
              </div>
            </div>
            <div className="qsq-khnhom">
              <b>Dòng mã / phiên bản / ngày</b>
              <SoChu v={bia.tdCo3} min={TD_CO_MIN} max={TD_CO_MAX} step={0.5} onSet={n => bgOptSet('tdCo3', n)} />
            </div>
          </TtPhan>
          <TtPhan id="tbtd-khung" ten="Khung & nét">
            <KhungTuy pre="tdk" chu={chu} coDoc={false} ngangNhan="Kẻ ngang giữa các dòng chữ" />
          </TtPhan>
        </>
      )}

      {vung === 'tt' && (
        <>
          <TtPhan id="tbtt-chu" ten="Chữ">
            <TtKieu ten="Nhãn (Tên dự án, Số điện thoại…)" k="ttk" co={chu.ttkCo} font={chu.ttkFont} mau={chu.ttkMau} mauMac="#8a96a5" fontNhom={fontNhom} />
            <TtKieu ten="Nội dung" k="ttv" co={chu.ttvCo} font={chu.ttvFont} mau={chu.ttvMau} mauMac="#1f2937" fontNhom={fontNhom} />
          </TtPhan>
          <TtPhan id="tbtt-khung" ten="Khung & nét">
            <KhungTuy pre="tk" chu={chu} />
          </TtPhan>
        </>
      )}

      {vung === 'ct' && (
        <>
          <TtPhan id="tbct-chu" ten="Chữ">
            <ChiTietTuy chu={chu} fontNhom={fontNhom} phan="chu" />
          </TtPhan>
          <TtPhan id="tbct-khung" ten="Khung & nét">
            <ChiTietTuy chu={chu} fontNhom={fontNhom} phan="vien" />
          </TtPhan>
        </>
      )}
    </>
  )
}
/* Kiểu bảng chi tiết hạng mục (đề mục lớn · viền bảng · nội dung ô): dùng ở "Giao diện báo giá" và khung Tuỳ biến của Trang bìa */
function ChiTietTuy({ chu, fontNhom, phan }) {
  return (
    <>
      {phan !== 'vien' && (<>
      {/* Đề mục lớn: nền / màu chữ / cỡ chữ / font riêng */}
      <div className="qsq-subh">Đề mục lớn</div>
      <div className="qsq-mau-h"><label className="qsq-lb">Màu nền</label><code>{chu.hdNen.toUpperCase()}</code>
        <ChangeInput type="color" value={chu.hdNen} title="Chọn màu nền khác" onCommit={v => bgOptSet('hdNen', v === BG_HD_NEN ? null : v)} /></div>
      <div className="qsq-mau">
        {BG_HD_NEN_DS.map(c => <button type="button" key={c} className={c === chu.hdNen ? 'on' : ''} style={{ background: c }} title={c.toUpperCase()}
          onClick={() => bgOptSet('hdNen', c === BG_HD_NEN ? null : c)} />)}
      </div>
      <label className="qsq-lb">Màu chữ</label>
      <div className="qs-qt-mode qsq-seg2" role="radiogroup" aria-label="Màu chữ đề mục">
        {[['trang', 'Trắng'], ['den', 'Đen']].map(([v, nhan]) => (
          <button type="button" key={v} role="radio" aria-checked={chu.hdChu === v} className={chu.hdChu === v ? 'on' : ''}
            onClick={() => bgOptSet('hdChu', v === 'trang' ? null : v)}>{nhan}</button>
        ))}
      </div>
      <label className="qsq-lb">Cỡ chữ đề mục</label>
      <CoSo pct={chu.hdCo} onSet={n => bgOptSet('hdSo', n)} />
      <label className="qsq-lb">Font đề mục</label>
      <select className="qsq-in" value={chu.hdFont} style={chu.hdFont ? { fontFamily: chu.hdFont } : undefined} onChange={e => bgOptSet('hdFont', e.target.value || null)}>
        <option value="">Như font báo giá</option>
        {fontNhom.map(([cat, nhan, ds]) => (
          <optgroup key={cat} label={nhan}>
            {ds.map(x => <option key={x.name} value={x.value || "'Montserrat', sans-serif"}>{x.name}</option>)}
          </optgroup>
        ))}
      </select>

      </>)}
      {phan !== 'chu' && (<>
      {/* Viền bảng: bộ khung chung (Viền · Ngang · Dọc · Khoảng cách dòng) + tô xen kẽ hàng */}
      <div className="qsq-subh">Viền bảng</div>
      <KhungTuy pre="ctk" chu={chu} />
      <label className="qsq-chk"><input type="checkbox" checked={chu.soLe} onChange={e => bgOptSet('soLe', e.target.checked ? null : false)} /> Tô xen kẽ hàng (sọc nhạt)</label>
      </>)}
      {phan !== 'vien' && (<>
      <div className="qsq-subh">Nội dung ô</div>
      <label className="qsq-lb">Canh dọc</label>
      <div className="qs-qt-mode qsq-seg3" role="radiogroup" aria-label="Canh dọc">
        {BG_CANH_DS.map(([v, nhan]) => (
          <button type="button" key={v} role="radio" aria-checked={chu.canhDoc === v} className={chu.canhDoc === v ? 'on' : ''}
            onClick={() => bgOptSet('canhDoc', v === 'giua' ? null : v)}>{nhan}</button>
        ))}
      </div>
      </>)}
    </>
  )
}
/* Thẻ ở cột trái xổ nội dung ngay trong thẻ (không tự mở khung bên phải): bấm thẻ để xổ / thu;
   inline({ moKhung, dongKhung, docked }) = phần xổ trong thẻ (nút chọn), moKhung() mở khung bên phải với children.
   Dùng cho Logo (Hiện / Ẩn logo) và Trang bìa (chọn nhanh mẫu ①②… ⊕) */
function TheXo({ id, ten, phu, tip, inline, children }) {
  const dock = useContext(DockCtx)
  const docked = !!dock && dock.id === id
  const [mo, setMo] = useState(docked)
  const moKhung = () => { if (dock) dock.set({ id, ten, phu }) }
  const dongKhung = () => { if (docked) dock.set(null) }
  /* tóm tắt trên đầu khung bên phải đổi theo lựa chọn */
  useEffect(() => { if (docked) moKhung() }, [phu])  // eslint-disable-line react-hooks/exhaustive-deps
  const bam = () => { if (mo) dongKhung(); setMo(!mo) }
  return (
    <section className={`qsq-card qsq-mod${mo ? '' : ' folded'}${docked ? ' docked' : ''}`}>
      <header onClick={bam} title={mo ? 'Thu gọn' : tip} aria-expanded={mo}>
        <div><b>{ten}</b>{phu ? <span>{phu}</span> : null}</div>
        <button type="button" className={`qsq-dockbtn${mo ? ' on' : ''}`} onClick={e => { e.stopPropagation(); bam() }} aria-label={mo ? 'Thu gọn' : 'Mở'}>
          <Icon name={mo ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      </header>
      {mo && inline({ moKhung, dongKhung, docked })}
      {docked && dock.el ? createPortal(children, dock.el) : null}
    </section>
  )
}
/* Hàng chọn nhanh mẫu tờ bìa: số trong hình tròn ①②③… (rê chuột xem tên) + ⊕ lưu thành mẫu mới; mẫu đang chọn tô xanh,
   có thay đổi chưa lưu thì thêm chấm cam */
function BiaMauHang({ ctx, coverMau, onChon, onMoi }) {
  const ds = biaMauDs()
  const dang = biaDangChon(ctx.bgCfg, coverMau)
  const doi = dang && !biaKhop(dang, ctx.bgCfg, coverMau)
  return (
    <div className="qsq-biamau" role="radiogroup" aria-label="Mẫu tờ bìa">
      {ds.map((t, i) => {
        const on = dang && dang.id === t.id
        return (
          <button type="button" key={t.id} role="radio" aria-checked={!!on} className={(on ? 'on' : '') + (on && doi ? ' doi' : '')}
            title={t.ten + (t.san ? ' (dựng sẵn)' : '') + (on && doi ? ' — đang có thay đổi chưa lưu' : '')} onClick={() => onChon(t)}>{i + 1}</button>
        )
      })}
      {ds.length < BIA_MAX && <button type="button" className="moi" title="Tạo mẫu tờ bìa mới từ cài đặt đang dùng" onClick={onMoi}><Icon name="plus" size={14} stroke={2.5} /></button>}
    </div>
  )
}
/* Thanh kéo cỡ logo: mặc định ở giữa (46 px), kéo trái nhỏ / phải lớn; xem trước khi kéo, thả tay mới lưu */
function LogoKeo({ px, onSet }) {
  const [v, setV] = useState(px)
  const keo = useRef(false)
  useEffect(() => { if (!keo.current) setV(px) }, [px])
  const luu = () => { keo.current = false; if (v !== px) onSet(v) }
  return (
    <div className="qsq-keo">
      <span>Nhỏ</span>
      <input type="range" min={BG_LOGO_MIN} max={BG_LOGO_MAX} step="1" value={v} title={'Cao ' + v + ' px'}
        onChange={e => { keo.current = true; setV(Number(e.target.value)) }} onPointerUp={luu} onKeyUp={luu} onBlur={luu} />
      <span>Lớn</span>
      <b>{v}px</b>
      {px !== 46 && <button type="button" className="qsq-link" onClick={() => onSet(46)}>Mặc định</button>}
    </div>
  )
}
/* Ô cỡ chữ logo (Logo chữ): số 1–100 px, nút − / + */
function SoChu({ v, onSet, min = 1, max = 100, step = 1, don }) {
  const dat = n => { n = Math.round(Number(n) / step) * step; n = Math.round(n * 10) / 10; if (n >= min && n <= max) onSet(n) }
  return (
    <div className="qsq-so">
      <button type="button" title="Nhỏ hơn" disabled={v <= min} onClick={() => dat(v - step)}><Icon name="minus" size={14} /></button>
      <ChangeInput className="qsq-in" type="number" min={min} max={max} step={step} value={v} title={'Cỡ chữ ' + min + '–' + max} onCommit={dat} />
      <button type="button" title="Lớn hơn" disabled={v >= max} onClick={() => dat(v + step)}><Icon name="plus" size={14} /></button>
      <span>{don || 'px (' + min + '–' + max + ')'}</span>
    </div>
  )
}
/* Ô chọn font (cùng danh sách font của Giao diện báo giá); '' = như font báo giá */
function FontChon({ nhom, value, onSet }) {
  return (
    <select className="qsq-in" value={value} style={value ? { fontFamily: value } : undefined} onChange={e => onSet(e.target.value || null)}>
      <option value="">Như font báo giá</option>
      {nhom.map(([cat, nhan, ds]) => (
        <optgroup key={cat} label={nhan}>
          {ds.map(x => <option key={x.name} value={x.value || "'Montserrat', sans-serif"}>{x.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
/* Thanh kéo giãn chữ logo (-0,1–0,5em: âm = chữ sát vào nhau; mặc định 0,16em): như LogoKeo, thả tay mới lưu */
function GianKeo({ v0, onSet }) {
  const [v, setV] = useState(v0)
  const keo = useRef(false)
  useEffect(() => { if (!keo.current) setV(v0) }, [v0])
  const luu = () => { keo.current = false; if (v !== v0) onSet(v) }
  return (
    <div className="qsq-keo">
      <span>Sát</span>
      <input type="range" min="-0.1" max="0.5" step="0.02" value={v} title={'Giãn ' + v + 'em'}
        onChange={e => { keo.current = true; setV(Number(e.target.value)) }} onPointerUp={luu} onKeyUp={luu} onBlur={luu} />
      <span>Thưa</span>
      {v0 !== 0.16 && <button type="button" className="qsq-link" onClick={() => onSet(0.16)}>Mặc định</button>}
    </div>
  )
}
/* Logo đã lưu ở mục Tạo logo (nút Lưu logo), theo công ty, nhớ trên máy này: qs_bg_logos_<id công ty>, mới nhất đứng đầu */
const LOGO_GAN = 3
const logoKey_ = ct => 'qs_bg_logos_' + ((ct && ct.id) || '')
function logoDaTai_(ct) { try { const v = JSON.parse(localStorage.getItem(logoKey_(ct)) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [] } catch (e) { return [] } }
function logoNho_(ct, src) {
  const ds = [src, ...logoDaTai_(ct).filter(x => x !== src)].slice(0, LOGO_GAN)
  try { localStorage.setItem(logoKey_(ct), JSON.stringify(ds)) } catch (e) { /* bỏ qua: máy hết chỗ lưu */ }
}
/* Vẽ Logo chữ thành ảnh PNG nền trong suốt (chữ cao 96px, giãn chữ vẽ từng ký tự) — chờ font tải xong mới vẽ */
async function veLogoChu_(text, bia, mauMacDinh) {
  const co = 96
  const fam = bia.lcFont || appFontValue_() || "'Montserrat', sans-serif"
  const font = (bia.lcNghieng ? 'italic ' : '') + (bia.lcDam ? 700 : 400) + ' ' + co + 'px ' + fam
  try { await document.fonts.load(font, text) } catch (e) { /* vẽ bằng font dự phòng */ }
  const gian = bia.lcGian * co
  const cv = document.createElement('canvas')
  const g = cv.getContext('2d'); g.font = font
  const chars = Array.from(text)
  const w = chars.reduce((s, ch) => s + g.measureText(ch).width, 0) + gian * Math.max(0, chars.length - 1)
  const pad = Math.round(co * 0.12)
  cv.width = Math.ceil(w) + pad * 2; cv.height = Math.round(co * 1.3)
  g.font = font; g.fillStyle = bia.lcMau || mauMacDinh || '#0f2942'; g.textBaseline = 'middle'
  let x = pad
  chars.forEach(ch => { g.fillText(ch, x, cv.height / 2); x += g.measureText(ch).width + gian })
  return cv.toDataURL('image/png')
}
/* 3 logo gần nhất của chế độ Công ty: logo trong Thông tin công ty (đứng đầu) + logo tải lên gần đây; bấm 1 logo để dùng */
function LogoGanDay({ ctx, chon, onChon }) {
  const org = bgOrg_(ctx.congTy, ctx.bgOrg)
  const ds = [...new Set([org.logo, ctx.congTy && ctx.congTy.logoUrl, ...logoDaTai_(ctx.congTy)].filter(Boolean))].slice(0, LOGO_GAN)
  const dang = chon || org.logo
  if (!ds.length) return <div className="qsq-logos-trong">Chưa có logo — thêm ở Thông tin công ty hoặc tạo ở mục Tạo logo rồi bấm Lưu logo.</div>
  return (
    <div className="qsq-logos" role="radiogroup" aria-label="Logo gần nhất">
      {ds.map(src => (
        <button type="button" key={src} role="radio" aria-checked={dang === src} className={dang === src ? 'on' : ''}
          title={src === org.logo ? 'Logo trong Thông tin công ty' : 'Logo đã lưu ở mục Tạo logo'}
          onClick={() => onChon(src === org.logo ? null : src)}>
          <img src={docImg_(src)} alt="" />
        </button>
      ))}
    </div>
  )
}
/* Ô cỡ chữ dạng SỐ như Bóc tách (− 12 +): pct = cỡ hiện tại theo %, onSet(số 8–20; 12 = mặc định) */
function CoSo({ pct, onSet }) {
  const v = bgSoOf_(pct)
  const dat = n => onSet(Math.min(BG_SO_MAX, Math.max(BG_SO_MIN, Number(n) || 12)))
  return (
    <div className="qsq-so">
      <button type="button" title="Giảm cỡ chữ" disabled={v <= BG_SO_MIN} onClick={() => dat(v - 1)}><Icon name="minus" size={14} /></button>
      <ChangeInput className="qsq-in" type="number" min={BG_SO_MIN} max={BG_SO_MAX} step="0.5" value={v}
        title={'Cỡ chữ ' + BG_SO_MIN + '–' + BG_SO_MAX + ', mặc định 12'} onCommit={dat} />
      <button type="button" title="Tăng cỡ chữ" disabled={v >= BG_SO_MAX} onClick={() => dat(v + 1)}><Icon name="plus" size={14} /></button>
      <span>mặc định 12</span>
    </div>
  )
}
/* Module con trong khung bên phải: tiêu đề đen đậm có gạch chân + nút thu gọn (nhớ theo máy, qs_bg_sub) */
function Sub({ id, t, extra, children }) {
  const [gon, setGon] = useState(() => { try { return !!(JSON.parse(localStorage.getItem('qs_bg_sub') || '{}') || {})[id] } catch (e) { return false } })
  const doi = () => setGon(v => {
    try { const m = JSON.parse(localStorage.getItem('qs_bg_sub') || '{}') || {}; m[id] = !v; localStorage.setItem('qs_bg_sub', JSON.stringify(m)) } catch (e) { /* bỏ qua */ }
    return !v
  })
  return (
    <div className={`qsq-sub${gon ? ' gon' : ''}`}>
      <div className="qsq-subt" onClick={doi} title={gon ? 'Mở rộng' : 'Thu gọn'}>
        <b>{t}</b>{extra}
        <button type="button" className="qsq-subbtn" aria-label={gon ? 'Mở rộng' : 'Thu gọn'} aria-expanded={!gon}>
          <Icon name={gon ? 'chevronDown' : 'chevronUp'} size={14} />
        </button>
      </div>
      {!gon && children}
    </div>
  )
}
/* Font cho báo giá: chữ không chân / có chân (Google) + font có sẵn trên máy (Microsoft / Apple) có đủ dấu tiếng Việt */
const FONT_NHOM = ['sans', 'serif', 'microsoft', 'apple']
/* Công tắc bật / tắt (bgCongTac_ 528-530) */
function CongTac({ on, nhan, tip, onToggle }) {
  return (
    <label className="qsq-sw" title={tip}>
      <span>{nhan}</span><input type="checkbox" checked={on} onChange={e => onToggle(e.target.checked)} /><em />
    </label>
  )
}

/* Khối "Tổng kết & điều khoản" (bgTkPanel_ 1131-1159) đặt trong thẻ 5 */
function TkPanel({ ctx, open, onToggle }) {
  const o = bgOpt_(ctx.bgCfg)
  const q = bgTong_(computeQuoteLocal(false, ctx).subtotal, ctx.bgCfg, ctx.cur && ctx.cur.vat)
  const tongDot = o.dot.reduce((a, d) => a + (Number(d[1]) || 0), 0)
  const ghi = o.ghiChu != null ? o.ghiChu : bgGhiChu_(q, ctx.bgCfg).join('\n')
  return (
    <div>
      <div className="qsq-tk-h" onClick={onToggle}>
        <QsIcon name="money" size={15} /><span style={{ flex: 1 }} />
        <button type="button" className="qs-qt-btn" title="Tên, logo, địa chỉ in trên báo giá" onClick={e => { e.stopPropagation(); bgOrgEdit() }}>
          <Icon name="building" size={14} />Thông tin công ty</button>
        <span className="qsq-tk-car">{open ? '▴' : '▾'}</span>
        <span className="qsq-tk-sum">Tạm tính <b>{money(q.sub)}</b>{q.ck ? <> · CK <b>−{money(q.ck)}</b></> : null} · VAT <b>{money(q.vat)}</b> · Tổng <b className="g">{money(q.total)} đ</b></span>
      </div>
      {open && (
        <div className="qsq-tk-b">
          <div className="qsq-tk-c">
            <label>Chiết khấu tổng đơn</label>
            <div className="qsq-tk-ck">
              <ChangeInput type="text" inputMode="decimal" value={o.ckKieu === 'vnd' ? money(o.ck) : o.ck} onCommit={v => bgOptSet('ck', tkNum_(v))} />
              <select value={o.ckKieu} onChange={e => bgOptSet('ckKieu', e.target.value)}><option value="pct">%</option><option value="vnd">đ</option></select>
            </div>
            <label>Ngày báo giá</label>
            <ChangeInput type="date" value={o.ngay} onCommit={v => bgOptSet('ngay', v)} />
            <label>Hiệu lực (ngày)</label>
            <ChangeInput type="number" min="0" value={o.hieuLuc} onCommit={v => bgOptSet('hieuLuc', Number(v) || 0)} />
            <div className="qsq-tk-chu">{docSoVN_(q.total)}</div>
          </div>
          <div className="qsq-tk-c">
            <label>Tiến độ thanh toán <span className={Math.round(tongDot) === 100 ? 'ok' : 'bad'}>tổng {tongDot}%</span></label>
            {o.dot.map((d, i) => (
              <div key={i} className="qsq-tk-dot">
                <span className="n">{i + 1}</span>
                <ChangeInput value={d[0]} onCommit={v => bgDotSet(i, 0, v)} />
                <ChangeInput className="pc" type="number" min="0" max="100" step="any" value={Number(d[1]) || 0} onCommit={v => bgDotSet(i, 1, v)} /><i>%</i>
                <span className="tien">{money(Math.round(q.total * (Number(d[1]) || 0) / 100))} đ</span>
                <button type="button" className="x" title="Xoá đợt" onClick={() => bgDotDel(i)}>✕</button>
              </div>
            ))}
            <button type="button" className="qs-qt-btn" onClick={bgDotAdd}>＋ Thêm đợt</button>
          </div>
          <div className="qsq-tk-c">
            <label>Ghi chú &amp; điều khoản <small>(mỗi dòng 1 ý — hiệu lực báo giá tự thêm)</small></label>
            <ChangeInput as="textarea" rows={6} value={ghi} onCommit={v => bgOptSet('ghiChu', v)} />
            {o.ghiChu != null && <button type="button" className="qs-qt-btn" onClick={() => bgOptSet('ghiChu', null)}>Dùng ghi chú mặc định</button>}
          </div>
        </div>
      )}
    </div>
  )
}

/* Cột trái của "Xem trước & Xuất" (bgSideHTML_ PUB/baogia.js:539-580): cảnh báo tờ bìa + 5 thẻ + 2 nút xuất cố định.
   m = quoteModel(...) của trạng thái hiện tại · pages = số trang · tk = cột Bóc tách {cols, order} · projects = danh sách dự án
   onExport(fmt) · onHist() mở Lịch sử */
export default function QuoteSide({ m, pages, tk, projects, onExport, onHist }) {
  const q = useQuoteUi()
  const ctx = m.ctx
  const vi = m.ver
  const nHist = m.hist.length
  const soDong = bgLines_(ctx).length + bgPTRows_(ctx)
  let nhap = ''
  try { const gr = currentGroup(projects, ctx.cur); nhap = draftName_(ctx.cur, gr ? gr.idx : 0) } catch (e) { nhap = '' }
  const nCot = bgDocCols_(ctx, m.ui).length
  const mau = m.mau
  const noiBo = bgNoiBoXuat_(ctx.bgCfg)
  const nb = bgNoiBoBat_(tk.cols)
  const canh = bgBiaCanh_(ctx)
  const ql = csQuickLabel_(COLSET.tk, tk.cols, myCols())
  const chu = bgChu_(ctx.bgCfg)
  /* module đang mở ở khung bên phải {id, ten, phu}; nhớ module mở gần nhất theo máy (qs_bg_dock) */
  /* id 'trang' (Nội dung các trang cũ) đã tách thành 'bia' / 'chitiet' -> mở lại thì về Trang bìa */
  const [dockOn, setDockOnS] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('qs_bg_dock') || 'null'); return v && v.id === 'trang' ? { id: 'bia', ten: 'Trang bìa' } : v } catch (e) { return null }
  })
  const setDockOn = v => { setDockOnS(v); try { localStorage.setItem('qs_bg_dock', JSON.stringify(v)) } catch (e) { /* bỏ qua */ } }
  const [dockEl, setDockEl] = useState(null)
  const tkEdit = useTkCols().edit
  const bia = bgBia_(ctx.bgCfg)
  const biaDang = biaDangChon(ctx.bgCfg, q.coverMau)
  const biaDoi = !!biaDang && !biaKhop(biaDang, ctx.bgCfg, q.coverMau)
  const logoKeo = <LogoKeo px={bia.logoPx} onSet={v => bgOptSet('logoPx', v === 46 ? null : v)} />
  const logoTomTat = ({ cty: bia.logoChon ? 'Logo đã lưu' : 'Logo công ty', tao: 'Tạo logo · ' + (bia.taoKieu === 'anh' ? 'Logo ảnh' : 'Logo chữ'), an: 'Ẩn logo' })[bia.logo]
    + (bia.logo === 'an' ? '' : ' · ' + (bia.logo === 'tao' && bia.taoKieu === 'chu' ? 'chữ ' + bia.lcCo : bia.logoPx) + 'px · ' + ({ trai: 'trái', giua: 'giữa', phai: 'phải' })[bia.logoVt])
  useBgFontLink(bia.logo === 'tao' && bia.taoKieu === 'chu' ? bia.lcFont : '', 'qs-bg-font-logo')
  useBgFontLink(bia.tdFont1, 'qs-bg-font-td1')
  useBgFontLink(bia.tdHm ? bia.tdFont2 : '', 'qs-bg-font-td2')
  useBgFontLink(chu.ttkFont, 'qs-bg-font-ttk')
  useBgFontLink(chu.ttvFont, 'qs-bg-font-ttv')
  /* Logo riêng của báo giá: thu ảnh về tối đa 480 x 160 px (PNG) rồi lưu thẳng vào bgCfg.logoAnh */
  function taiLogo(file) {
    if (!file) return
    const rd = new FileReader()
    rd.onload = () => {
      const img = new Image()
      img.onload = () => {
        const k = Math.min(1, 480 / img.width, 160 / img.height)
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        bgOptSet('logoAnh', c.toDataURL('image/png'))
      }
      img.src = rd.result
    }
    rd.readAsDataURL(file)
  }
  /* "Lưu logo": Logo ảnh lưu nguyên ảnh, Logo chữ vẽ thành ảnh PNG; logo lưu vào danh sách gần nhất của mục Công ty,
     chuyển về mục Công ty và dùng ngay logo vừa lưu */
  async function luuLogo() {
    let src = bia.logoAnh
    if (bia.taoKieu === 'chu') {
      try { src = await veLogoChu_(bia.logoChu.trim() || bgOrg_(ctx.congTy, ctx.bgOrg).ten, bia, mau) } catch (e) { src = '' }
    }
    if (!src) { toast('Chưa tạo được logo — kiểm tra lại ảnh / chữ'); return }
    logoNho_(ctx.congTy, src)
    /* Logo chữ thành ảnh cao ~1,3 lần cỡ chữ: đặt Cỡ logo tương ứng để logo giữ đúng cỡ đang thấy */
    const px = bia.taoKieu === 'chu' ? Math.min(BG_LOGO_MAX, Math.max(BG_LOGO_MIN, Math.round(bia.lcCo * 1.3))) : bia.logoPx
    bgOptSetMany({ logo: null, logoChon: src, logoPx: px === 46 ? null : px })
    toast('Đã lưu logo — đang dùng ở mục Công ty')
  }
  const fontNhom = useMemo(() => FONT_NHOM.map(cat => [cat, (FONT_CATEGORIES.find(c => c[0] === cat) || [cat, cat])[1],
    FONT_CATALOG.filter(x => x.cat === cat && isFontAvailable(x))]).filter(g => g[2].length), [])

  return (
    <DockCtx.Provider value={{ id: dockOn && dockOn.id, el: dockEl, set: setDockOn }}>
    <aside className="qsq-side">
      {canh && (
        <div className="qsq-warn"><Icon name="bell" size={15} />
          <span>Tổng tờ bìa <b>{money(canh.bia)} đ</b> khác tổng trang cuối <b>{money(canh.cuoi)} đ</b> (chưa CK/VAT) — vì {canh.ly.join(', ')}. Kiểm tra trước khi gửi khách.</span>
        </div>
      )}

      <The id="ver" ten="Phiên bản báo giá" phu={(nhap || 'Bản nháp') + ' · ' + soDong + ' dòng đã bóc'}>
        <div className="qsq-ma" title="Mã báo giá · phiên bản. Sửa mã ở chế độ Chỉnh sửa (ô Mã báo giá số)"><span>Mã</span><b>{vi.ma}</b><em>v{vi.ver}</em></div>
        <div className="qsq-row2">
          <button type="button" className="qs-qt-btn" disabled={vi.trung}
            title={vi.trung ? 'Nội dung chưa đổi so với bản đã chốt' : 'Lưu nội dung báo giá hiện tại thành 1 phiên bản'}
            onClick={() => bgChot('chot')}><Icon name="check" size={14} />{vi.trung ? 'Đã chốt v' + vi.ver : 'Chốt v' + vi.ver}</button>
          <button type="button" className="qs-qt-btn" title="Xem lại / so sánh các phiên bản đã chốt hoặc đã xuất" onClick={onHist}>
            <Icon name="layers" size={14} />Lịch sử{nHist ? ' (' + nHist + ')' : ''}</button>
        </div>
      </The>

      {/* Logo tờ bìa: module riêng ngay dưới Phiên bản (trước nằm trong Nội dung các trang) */}
      {/* Luồng: bấm thẻ Logo -> 2 nút Hiện / Ẩn logo ngay trong thẻ; Hiện logo mới mở khung bên phải (Chọn logo · Vị trí · Thông tin công ty) */}
      <TheXo id="logo" ten="Logo" phu={logoTomTat} tip="Chọn hiện / ẩn logo" inline={({ moKhung, dongKhung }) => (
        <div className="qs-qt-mode qsq-seg2" role="radiogroup" aria-label="Hiện / ẩn logo">
          <button type="button" role="radio" aria-checked={bia.logo !== 'an'} className={bia.logo !== 'an' ? 'on' : ''}
            title="Hiện logo — mở khung bên phải để chọn / tạo logo"
            onClick={() => { bgOptSetMany({ logoAn: null, ...((ctx.bgCfg || {}).logo === 'an' ? { logo: null } : {}) }); moKhung() }}>Hiện logo</button>
          <button type="button" role="radio" aria-checked={bia.logo === 'an'} className={bia.logo === 'an' ? 'on' : ''}
            title="Không in logo / tên công ty trên cùng tờ bìa" onClick={() => { bgOptSet('logoAn', true); dongKhung() }}>Ẩn logo</button>
        </div>
      )}>
        {bia.logo === 'an' && <div className="qsq-logos-trong">Logo đang ẩn — chọn "Hiện logo" ở thẻ Logo bên trái.</div>}
        {bia.logo !== 'an' && (
        <Sub id="logochon" t="Chọn logo">
          <div className="qs-qt-mode qsq-seg2" role="radiogroup" aria-label="Logo tờ bìa">
            {[['cty', 'Công ty'], ['tao', 'Tạo logo']].map(([v, nhan]) => (
              <button type="button" key={v} role="radio" aria-checked={bia.logo === v} className={bia.logo === v ? 'on' : ''}
                title={{ cty: 'Logo trong Thông tin công ty hoặc logo đã lưu', tao: 'Tự tạo logo cho báo giá: Logo ảnh hoặc Logo chữ' }[v]}
                onClick={() => bgOptSet('logo', v === 'cty' ? null : v)}>{nhan}</button>
            ))}
          </div>
          {bia.logo === 'cty' && <LogoGanDay ctx={ctx} chon={bia.logoChon} onChon={v => bgOptSet('logoChon', v)} />}
          {/* Tạo logo: chọn 1 trong 2 — Logo ảnh (tải ảnh) | Logo chữ (gõ chữ + kiểu chữ); "Lưu logo" đưa logo vào danh sách của mục Công ty */}
          {/* khung con của tab Tạo logo (mũi nhọn chỉ lên tab cha), tab con kiểu gạch chân để không ngang cấp với hàng tab trên */}
          {bia.logo === 'tao' && (
            <div className="qsq-tao">
              <div className="qsq-taotab" role="tablist" aria-label="Kiểu logo tự tạo">
                {[['anh', 'Logo ảnh', 'upload'], ['chu', 'Logo chữ', 'textColor']].map(([v, nhan, ic]) => (
                  <button type="button" key={v} role="tab" aria-selected={bia.taoKieu === v} className={bia.taoKieu === v ? 'on' : ''}
                    onClick={() => bgOptSet('taoKieu', v)}><Icon name={ic} size={13} />{nhan}</button>
                ))}
              </div>
              {bia.taoKieu === 'anh' && (
                <div className="qsq-logoup gon">
                  {bia.logoAnh ? <img src={bia.logoAnh} alt="Logo báo giá" /> : <span>Chưa có ảnh</span>}
                  <label className="qs-qt-btn">
                    <Icon name="upload" size={13} />{bia.logoAnh ? 'Đổi ảnh' : 'Tải ảnh lên'}
                    <input type="file" accept="image/*" hidden onChange={e => { taiLogo(e.target.files && e.target.files[0]); e.target.value = '' }} />
                  </label>
                  {bia.logoAnh && <button type="button" className="qs-qt-btn" onClick={() => bgOptSet('logoAnh', null)}>Xoá</button>}
                </div>
              )}
              {bia.taoKieu === 'chu' && (
                <>
                <label className="qsq-lb">Chữ hiển thị</label>
                <ChangeInput className="qsq-in" value={bia.logoChu} placeholder={bgOrg_(ctx.congTy, ctx.bgOrg).ten} maxLength={60}
                  onCommit={v => bgOptSet('logoChu', String(v || '').trim() || null)} />
                {/* kiểu chữ logo: font · màu · đậm / nghiêng · cỡ chữ (số 1–100) · giãn chữ */}
                <label className="qsq-lb">Font chữ</label>
                <select className="qsq-in" value={bia.lcFont} style={bia.lcFont ? { fontFamily: bia.lcFont } : undefined}
                  onChange={e => bgOptSet('lcFont', e.target.value || null)}>
                  <option value="">Như font báo giá</option>
                  {fontNhom.map(([cat, nhan, ds]) => (
                    <optgroup key={cat} label={nhan}>
                      {ds.map(x => <option key={x.name} value={x.value || "'Montserrat', sans-serif"}>{x.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <div className="qsq-lc">
                  <div className="qsq-mau-h"><label className="qsq-lb">Màu chữ</label>
                    <ChangeInput type="color" value={bia.lcMau || mau} title="Chọn màu chữ logo" onCommit={v => bgOptSet('lcMau', v)} />
                    {bia.lcMau && <button type="button" className="qsq-link" title="Về màu tiêu đề của báo giá" onClick={() => bgOptSet('lcMau', null)}>Mặc định</button>}
                  </div>
                  <div className="qsq-lc-kieu" role="group" aria-label="Kiểu chữ logo">
                    <button type="button" className={bia.lcDam ? 'on' : ''} aria-pressed={bia.lcDam} title="Chữ đậm" onClick={() => bgOptSet('lcDam', bia.lcDam ? false : null)}><b>B</b></button>
                    <button type="button" className={bia.lcNghieng ? 'on' : ''} aria-pressed={bia.lcNghieng} title="Chữ nghiêng" onClick={() => bgOptSet('lcNghieng', bia.lcNghieng ? null : true)}><i>I</i></button>
                  </div>
                </div>
                <label className="qsq-lb">Cỡ chữ</label>
                <SoChu v={bia.lcCo} onSet={n => bgOptSet('lcCo', n)} />
                <label className="qsq-lb">Giãn chữ</label>
                <GianKeo v0={bia.lcGian} onSet={v => bgOptSet('lcGian', v === 0.16 ? null : v)} />
                </>
              )}
              <div className="qsq-luulogo">
                <button type="button" className="qsc-btn blue" disabled={bia.taoKieu === 'anh' && !bia.logoAnh}
                  title={bia.taoKieu === 'anh' && !bia.logoAnh ? 'Tải ảnh lên trước' : 'Lưu logo, dùng ngay — logo đã lưu hiện ở mục Công ty để chọn lại'}
                  onClick={luuLogo}><Icon name="check" size={13} /> Lưu logo</button>
              </div>
            </div>
          )}
        </Sub>
        )}
        {bia.logo !== 'an' && (
          <>
            {/* Cỡ logo: khung riêng cho logo dạng ảnh (Công ty / Logo ảnh); Logo chữ chỉnh bằng ô Cỡ chữ trong Tạo logo */}
            {!(bia.logo === 'tao' && bia.taoKieu === 'chu') && <Sub id="logoco" t="Cỡ logo">{logoKeo}</Sub>}
            <Sub id="logovt" t="Vị trí logo (trên cùng trang)">
              <div className="qs-qt-mode qsq-seg3" role="radiogroup" aria-label="Vị trí logo">
                {[['trai', 'Trái'], ['giua', 'Giữa'], ['phai', 'Phải']].map(([v, nhan]) => (
                  <button type="button" key={v} role="radio" aria-checked={bia.logoVt === v} className={bia.logoVt === v ? 'on' : ''}
                    onClick={() => bgOptSet('logoVt', v === 'trai' ? null : v)}>{nhan}</button>
                ))}
              </div>
            </Sub>
            <Sub id="logott" t="Thông tin công ty">
              <label className="qsq-chk"><input type="checkbox" checked={bia.ttCty} onChange={e => bgOptSet('ttCty', e.target.checked ? null : false)} /> Hiện địa chỉ / liên hệ công ty</label>
              {bia.ttCty && <TtCty ctx={ctx} bia={bia} />}
            </Sub>
          </>
        )}
      </TheXo>

      {/* Trang bìa (trang 1) và Trang chi tiết (trang 2+): 2 mục riêng ở cột trái (trước gộp trong "Nội dung các trang") */}
      {/* Trang bìa: bấm thẻ -> hàng chọn nhanh mẫu ①②… ⊕ ngay trong thẻ; chọn 1 mẫu (hoặc ⊕ tạo mẫu mới) mới mở cài đặt bên phải,
          sửa xong bấm Lưu (ghi đè mẫu tự lưu) hoặc Lưu thành mẫu mới */}
      <TheXo id="bia" ten="Trang bìa" tip="Chọn mẫu tờ bìa"
        phu={'Trang 1 · ' + (biaDang ? biaDang.ten : 'Mẫu') + (biaDoi ? ' (đã sửa)' : '') + ' · ' + bia.hienTT.length + ' mục thông tin'}
        inline={({ moKhung }) => (
          <BiaMauHang ctx={ctx} coverMau={q.coverMau} onChon={t => { biaApDung(t); moKhung() }}
            onMoi={async () => { if (await biaLuuMoi(ctx.bgCfg, q.coverMau)) moKhung() }} />
        )}>
        <Sub id="biamau" t="Mẫu tờ bìa">
          <BiaMauHang ctx={ctx} coverMau={q.coverMau} onChon={biaApDung} onMoi={() => biaLuuMoi(ctx.bgCfg, q.coverMau)} />
          {/* luôn 2 nút; ghi chú (mẫu dựng sẵn / chưa đổi / đã lưu) chỉ hiện khi bấm */}
          <div className="qsq-biaact">
            <button type="button" className="qsc-btn blue" onClick={() => biaLuuDe(biaDang, ctx.bgCfg, q.coverMau)}><Icon name="check" size={13} /> Lưu</button>
            <button type="button" className="qsc-btn" onClick={() => biaLuuMoi(ctx.bgCfg, q.coverMau)}><Icon name="plus" size={13} /> Lưu thành mẫu mới</button>
            {biaDang && !biaDang.san && <button type="button" className="qsc-btn" aria-label={'Xoá mẫu ' + biaDang.ten} onClick={() => biaXoa(biaDang)}><Icon name="trash" size={13} /></button>}
          </div>
        </Sub>
        <Sub id="tieude" t="Khung tiêu đề">
          <label className="qsq-lb">Chữ tiêu đề</label>
          {/* nội dung khung tiêu đề; cỡ chữ / font từng dòng chỉnh ở khung Tuỳ biến */}
          <ChangeInput className="qsq-in" value={bia.tdTen} placeholder="BẢNG ƯỚC TÍNH CHI PHÍ DỰ ÁN" onCommit={v => bgOptSet('tdTen', String(v || '').trim() || null)} />
          <label className="qsq-chk qsq-ngan"><input type="checkbox" checked={bia.tdHm} onChange={e => bgOptSet('tdHm', e.target.checked ? null : false)} /> Dòng hạng mục</label>
          {bia.tdHm && (
            <ChangeInput className="qsq-in" value={bia.tdHmTen} placeholder="HẠNG MỤC: TỔNG HỢP CHI PHÍ"
              title="Chữ của dòng hạng mục (để trống = HẠNG MỤC: TỔNG HỢP CHI PHÍ)" onCommit={v => bgOptSet('tdHmTen', String(v || '').trim() || null)} />
          )}
          <label className="qsq-chk qsq-ngan"><input type="checkbox" checked={bia.tdMaBG} onChange={e => bgOptSet('tdMaBG', e.target.checked)} /> Mã báo giá</label>
          <label className="qsq-chk"><input type="checkbox" checked={bia.tdPB} onChange={e => bgOptSet('tdPB', e.target.checked)} /> Phiên bản</label>
          <label className="qsq-chk"><input type="checkbox" checked={bia.tdNgay} onChange={e => bgOptSet('tdNgay', e.target.checked)} /> Ngày báo giá</label>
        </Sub>
        {/* Thông tin dự án trên bìa: 1 khung, 2 tab con — Thông tin (Mặc định · Mở rộng) · Tuỳ biến (font / màu / cỡ chữ) */}
        <Sub id="thongtin" t="Thông tin dự án" extra={<span className="qsq-subn">{bia.hienTT.length}/{BG_TT_DS.length}</span>}>
          <TtDuAn bia={bia} />
        </Sub>
      </TheXo>

      <The id="chitiet" ten="Trang chi tiết" phu={'Trang 2+ · ' + pages + ' trang' + (q.bgPerSec !== false ? ' · mỗi hạng mục 1 trang' : '')}>
        <Sub id="ctnode" t="Hạng mục in">
          <NodePicker ctx={ctx} />
        </Sub>
        <Sub id="ctpage" t="Phân trang">
        <div className="qsq-row2 lb">
          <div><label className="qsq-lb">Dòng / trang</label>
            <select className="qsq-in" title="Số dòng tối đa trên mỗi trang giấy" value={String(Number(q.bgPer) || 0)} onChange={e => bgSetPer_(e.target.value)}>
              {PER_OPTS.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
            </select></div>
          <div><label className="qsq-lb">Số trang</label><div className="qsq-in ro">{pages} trang</div></div>
        </div>
        <CongTac on={q.bgPerSec !== false} nhan="Mỗi hạng mục một trang mới" tip="Mỗi hạng mục bắt đầu ở một trang mới" onToggle={bgTogglePerSec_} />
        {bgColTuyBien_(q) && (
          <button type="button" className="qs-qt-btn qsq-full" title="Trả rộng và thứ tự cột về mặc định" onClick={bgColReset_}>
            <Icon name="x" size={13} />Đặt lại rộng / thứ tự cột</button>
        )}
        </Sub>
      </The>

      {/* Cột xuất: 3 module riêng — Bộ cột (danh sách bộ, sửa / sắp xếp / xoá / mặc định như Bóc tách) · Bật / tắt từng cột
          (chip + Tạo mới / Lưu đè bộ cột) · Cột nội bộ. Dùng chung bộ cột với bảng Bóc tách */}
      <The id="cot" ten="Cột xuất" phu={'Đang in ' + nCot + ' cột · bộ ' + ql.nhan}>
        <Sub id="bocot" t="Bộ cột">
          <PresetDock cols={tk.cols} onEdit={opts => { setQ({ colMo: true }); startEdit(opts) }}
            onEndEdit={keep => (keep ? endEdit() : cancelEdit())} onClose={() => {}} />
        </Sub>
        <Sub id="chip" t="Bật / tắt từng cột" extra={<span className="qsq-subn">{ql.on}/{ql.total}</span>}>
          <div className="qsq-colstrip">
            <ColsStrip columns={COLS.map(c => ({ key: c[0], label: c[1] }))} cols={tk.cols} editing={tkEdit}
              onToggle={k => { if (k === 'ten') return; setColsMap({ ...tk.cols, [k]: !tk.cols[k] }) }} />
          </div>
        </Sub>
        <Sub id="noibo" t="Cột nội bộ">
          <CongTac on={noiBo} nhan="Xuất kèm cột nội bộ (bản nội bộ)" tip="Giá bán lẻ NCC, CK đại lý, giá đại lý, lợi nhuận… — không gửi khách" onToggle={bgNoiBoDat} />
          <p className={`qsq-note${noiBo ? ' warn' : ''}`}>
            <Icon name="lock" size={12} /> {noiBo
              ? 'ĐANG in kèm cột nội bộ' + (nb.length ? ' (' + nb.map(k => BG_NOI_BO[k]).join(', ') + ')' : '') + ' và giá nhà thầu Phần thô — không gửi bản này cho khách.'
              : 'Cột Giá bán lẻ NCC, CK đại lý, Giá đại lý, % lợi nhuận, Margin, Lợi nhuận (VNĐ) không in trên báo giá gửi khách.'}
          </p>
        </Sub>
      </The>

      {/* Tuỳ biến (tab chính, thay "Giao diện báo giá"): chỉnh toàn bộ báo giá — tờ bìa + trang tính.
          Chung (màu · font · cỡ chữ) · chữ Tiêu đề · Thông tin dự án · Chi tiết hạng mục · khung Bảng (nét cho cả 3 mục) */}
      <The id="gd" ten="Tuỳ biến" phu="Màu · font · cỡ chữ · khung — tờ bìa và trang tính, áp dụng cho cả bản in / PDF.">
        <TuyBien mau={mau} chu={chu} bia={bia} fontNhom={fontNhom} />
      </The>

      <The id="tk" ten="Tổng kết & điều khoản" phu="VAT · chiết khấu · thanh toán · ghi chú" className="tk">
        <div className="qsq-vat"><label className="qsq-lb">VAT của dự án</label>
          <span><ChangeInput className="qsq-in" type="number" step="any" min="0" value={Number(ctx.cur && ctx.cur.vat) || 0}
            title="Dùng chung với Bóc tách / Chi phí" onCommit={v => setVat(v)} /> %</span></div>
        <TkPanel ctx={ctx} open={!!q.tkOpen} onToggle={() => setQ(s => ({ tkOpen: !s.tkOpen }))} />
      </The>

      <div className="qsq-xuat">
        <button type="button" className="qs-qt-btn green" disabled={q.exporting} onClick={() => onExport('xlsx')}>
          <Icon name="download" size={15} />{q.exporting ? 'Đang xuất…' : 'Xuất Excel'}</button>
        <button type="button" className="qs-qt-btn red" onClick={() => onExport('pdf')}><Icon name="download" size={15} />Xuất PDF / In</button>
      </div>
    </aside>
    {dockOn && (
      <section className="qsq-card qsq-dock" aria-label={dockOn.ten}>
        <header className="qsq-dockh">
          <div><b>{dockOn.ten}</b>{dockOn.phu ? <span>{dockOn.phu}</span> : null}</div>
          <button type="button" className="qsc-x" title="Đóng" onClick={() => setDockOn(null)}>✕</button>
        </header>
        <div className="qsq-dockb" ref={setDockEl} />
      </section>
    )}
    </DockCtx.Provider>
  )
}
