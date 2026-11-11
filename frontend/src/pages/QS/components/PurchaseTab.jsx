import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQbSlotEl } from './project/qbSlot'
import Icon from '../../../components/ui/Icon'
import ProductThumb from './common/ProductThumb'
import PaymentPlan from './purchase/PaymentPlan'
import HmPicker from './purchase/HmPicker'
import ProposalDetail from './purchase/ProposalDetail'
import ProductModal from './purchase/ProductModal'
import AddRowModal from './purchase/AddRowModal'
import { addProdBuild_ } from '../lib/calc'
import ChangeInput from './purchase/ChangeInput'
import Pop from './breakdown/sheet/Pop'
import { MH_MEMO, mhMemoSet, useMhMemo, fmtDateTime_, imgSrc1_, foldGet_, foldToggle_, payLsGet_, payLsSet_ } from './purchase/purchaseUi'
import './purchase/purchase.css'
import { useQs } from '../state/QsData'
import { refreshNotifCount } from '../state/store'
import { useQsSession } from '../session/QsSession'
import { qsAlert } from './common/dialogs'
import { larkLbl_, larkCls_ } from './admin/adminUtil'
import * as api from '../api/qsApi'
import { isAbort } from '../api/http'
import { downloadPost } from '../api/files'
import { money, pad2, fmtDate, spNorm_ } from '../lib/format'
import { nodeName } from '../lib/tree'
import {
  mhPrice, mhDisc_, mhPriceCK_, mhTot_, mhIds_, mhPctIn_, mhDx_, mhDxSum_, mhDxExtra_, mhGop_, mhOn_,
  mhLines_, mhGroups_, mhHead_, mhOrderOf, mhBase, mhValidateInfo, mhDaDat_, MH_TT,
  mhDxConfirm_, mhDxPayload_, mhPayKey_, mhPayDefault_, mhPayTinh_, mhPaySet_, mhPayAdd_, mhPayChia_, mhPayPayload_,
  DX_TEN_, dxStatusCls_, mhExOf_, mhExKey_, mhWithEx_, mhNoEx_,
} from '../lib/purchase'

/* Tab "Mua hàng" (port PUB/muahang.js): dòng bóc tách của hạng mục dùng chung (hmNode, '' = tất cả) gom theo nhà cung cấp
   (ncc || thuongHieu || 'Khác'), cùng sản phẩm ở nhiều tầng gộp 1 dòng đơn. % giảm NCC lưu trên dòng (giamGiaNcc),
   % đề xuất lưu ở extra.dxGiam, kế hoạch thanh toán ở projData.mhPay. Gửi đơn / đề xuất qua API; đơn và phiếu đã gửi
   tải lại khi đổi dự án và bằng nút tải lại. Mọi công thức ở lib/purchase.js.
   Ý định điều hướng (từ thông báo de_xuat*, M13.1): {dxDetail: ma} mở chi tiết phiếu - kể cả khi chưa mở dự án nào. */
const TAB = 'muahang'
// Tiến độ hàng của dòng (extra.tienDo); '' = chưa đặt
const MH_TIEN_DO = ['', 'Đã đặt', 'Đang sản xuất', 'Đang giao', 'Đã nhận đủ', 'Giao thiếu']
const loadState = () => ({ ma: null, list: [], loading: false, err: '' })

export default function PurchaseTab() {
  const {
    cur, lines, products, projData, setProjData, hmNode, setHmNode, mutate, toast, confirm, ask, navigate, panelVisible, status,
    visibleSeq, consumeIntent,
  } = useQs()
  const { isAdmin } = useQsSession()
  const ma = cur ? cur.maDA : ''
  const visible = panelVisible(TAB)
  const visN = visibleSeq(TAB)

  const { info, sel, payOpen } = useMhMemo()
  const [need, setNeed] = useState({})
  const [, setPayTick] = useState(0)
  const [busy, setBusy] = useState({})
  const [don, setDon] = useState(loadState)
  const [dx, setDxSt] = useState(loadState)
  const [hmPop, setHmPop] = useState(null)
  const [dxOpen, setDxOpen] = useState(null)
  const [prodLine, setProdLine] = useState(null)
  const [addFor, setAddFor] = useState(null)
  const [foldTot, setFoldTot] = useState(() => !!foldGet_().totals)
  const refs = { nguoiGui: useRef(null), phongBan: useRef(null) }
  const maRef = useRef(ma)
  maRef.current = ma

  const setInfo = (k, v) => {
    mhMemoSet('info', { ...MH_MEMO.info, [k]: v })
    if (v && v.trim && v.trim()) setNeed(n => ({ ...n, [k]: false }))
  }
  const setBusyK = (k, on) => setBusy(b => ({ ...b, [k]: on }))

  /* ---------- Đơn đã gửi / phiếu đề xuất của dự án (mhLoadDon_ / mhLoadDx_) ---------- */
  const loadDon = useCallback(async (m, signal) => {
    if (!m) return
    setDon(s => ({ ...s, loading: true, err: '' }))
    try {
      const list = (await api.getPurchaseOrders(m, signal)) || []
      if (maRef.current !== m) return
      setDon({ ma: m, list, loading: false, err: '' })
    } catch (e) {
      if (isAbort(e)) { setDon(s => ({ ...s, loading: false })); return }
      if (maRef.current !== m) return
      setDon({ ma: null, list: [], loading: false, err: e.message })
    }
  }, [])
  const loadDx = useCallback(async (m, signal) => {
    if (!m) return
    setDxSt(s => ({ ...s, loading: true, err: '' }))
    try {
      const list = (await api.getDeXuatList(m, signal)) || []
      if (maRef.current !== m) return
      setDxSt({ ma: m, list, loading: false, err: '' })
    } catch (e) {
      if (isAbort(e)) { setDxSt(s => ({ ...s, loading: false })); return }
      if (maRef.current !== m) return
      setDxSt({ ma: null, list: [], loading: false, err: e.message })
    }
  }, [])
  /* Như renderMuahang: chỉ tải khi tab đang hiện và chưa có dữ liệu của dự án đang mở */
  const donMa = don.ma, dxMa = dx.ma
  useEffect(() => {
    if (!visible || !ma) return undefined
    const ctl = new AbortController()
    if (dxMa !== ma) loadDx(ma, ctl.signal)
    if (donMa !== ma) loadDon(ma, ctl.signal)
    return () => ctl.abort()
    // donMa/dxMa chỉ để biết đã tải chưa; không chạy lại khi tải xong
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ma, loadDon, loadDx])

  /* Ý định từ thông báo: mở chi tiết phiếu (đọc lại mỗi lần tab được hiện) */
  useEffect(() => {
    if (!visible) return
    const it = consumeIntent(TAB)
    if (it && it.dxDetail) setDxOpen(String(it.dxDetail))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, visN])

  /* dxResolve (muahang.js:383-391): từ tab Mua hàng thì tải lại phiếu của dự án */
  const dxResolve = async (m, approve) => {
    if (!approve && !await confirm('Từ chối phiếu ' + m + '?')) return
    try {
      await api.resolveDeXuat(m, approve)
      toast(approve ? ('Đã duyệt phiếu ' + m) : ('Đã từ chối phiếu ' + m))
      loadDx(ma)
      refreshNotifCount()
    } catch (e) { toast('Lỗi: ' + e.message) }
  }

  /* ---------- Kế hoạch thanh toán (mhPayAll_ / mhPayOf_ / mhPaySave_) ---------- */
  const payRef = useRef({ key: null, data: {} })
  const moneyEl = useQbSlotEl('pcm:muahang')   // chỗ trên khung tiền của băng dự án (PCard) cho dải số liệu
  const payAll = () => {
    const key = ma + '|' + status.pdSeq
    if (payRef.current.key !== key) {
      let d = (projData && projData.mhPay) || null
      if (!d) d = payLsGet_(mhPayKey_(ma))
      payRef.current = { key, data: JSON.parse(JSON.stringify(d || {})) }
    }
    return payRef.current.data
  }
  const payOf = ncc => { const a = payAll(); if (!a[ncc]) a[ncc] = mhPayDefault_(); return a[ncc] }
  /* Để vẽ: tính trên bản sao. Panel luôn được mount (kể cả khi ẩn) nên không sửa dữ liệu thật lúc vẽ như bản gốc;
     thao tác sửa thì tính lại trên dữ liệu thật trước (payEdit) rồi mới lưu. */
  const payView = (ncc, tot) => mhPayTinh_(JSON.parse(JSON.stringify(payAll()[ncc] || mhPayDefault_())), tot)
  const payEdit = (ncc, tot) => mhPayTinh_(payOf(ncc), tot)
  const paySave = () => { const a = payAll(); setProjData('mhPay', a); payLsSet_(mhPayKey_(ma), a); setPayTick(t => t + 1) }

  if (!cur) {
    return (
      <>
        <div className="qs-card qs-po-empty">Chưa chọn dự án.</div>
        {dxOpen && <ProposalDetail ma={dxOpen} list={[]} isAdmin={isAdmin} onClose={() => setDxOpen(null)} onResolve={dxResolve} />}
      </>
    )
  }

  const mlines = mhLines_(lines, hmNode)
  const vatPct = Number(cur.vat) || 0
  /* phần sửa tay theo NCC (nút Edit trên thẻ): hàng thêm tay nằm trong nhóm -> tính vào tổng / thanh toán / đơn gửi */
  const mhEx = (projData && projData.mhExtra) || {}
  const exSave = (ncc, patch) => setProjData('mhExtra', { ...mhEx, [ncc]: { ...mhExOf_(mhEx, ncc), ...patch } })
  const groups = mhGroups_(mlines).map(g => mhWithEx_(g, mhEx))
  /* VAT riêng từng NCC (mhExtra[ncc].vat, ô VAT trên thẻ NCC); chưa đặt thì theo VAT dự án */
  const vatOf = g => { const v = mhExOf_(mhEx, g.ncc).vat; return v != null && v !== '' ? Number(v) || 0 : vatPct }
  const head = mhHead_(groups, vatOf, sel)
  /* dải số liệu trên băng dự án: NCC đang chọn · Sản phẩm · Trước giảm · Sau giảm NCC · VAT (ô nhập %) · Tổng */
  const barStats = [
    { k: 'NCC đang chọn', v: pad2(head.nccChon) + (head.nccChon < head.nNcc ? '/' + pad2(head.nNcc) : '') },
    { k: 'Sản phẩm', v: pad2(head.spChon) + (head.spChon < head.nLines ? '/' + pad2(head.nLines) : '') },
    { k: 'Trước giảm', v: money(head.chuaCK) },
    { k: 'Sau giảm NCC', v: money(head.sauCK) },
    { k: 'VAT', v: <span className="qs-pc-vat"><ChangeInput className="qs-bd-vatin" type="number" step="any" min="0" value={vatPct} title="Thuế VAT (%)" onCommit={v => setVat(v)} />%<em>{money(head.vat)}</em></span> },   // setVat khai báo phía dưới: gọi muộn
    { k: 'Tổng', v: money(head.grand), tone: 'total' },
  ]
  const dons = don.ma === ma ? don.list : []
  const dxs = dx.ma === ma ? dx.list : []
  const lineOf = id => lines.filter(x => x.lineId === id)[0]

  const toggleSel = ncc => {
    mhMemoSet('sel', { ...MH_MEMO.sel, [ncc]: !(MH_MEMO.sel[ncc] !== false) })
  }
  const togglePay = ncc => {
    const o = { ...MH_MEMO.payOpen }
    if (o[ncc]) delete o[ncc]; else o[ncc] = 1
    mhMemoSet('payOpen', o)
  }

  /* ---------- Sửa % trên dòng (mhSetDisc / mhSetDiscAll / mhSetDx / mhSetDxAll) ---------- */
  const setDisc = (ids, v) => {
    const p = mhPctIn_(v)
    mhIds_(ids).forEach(id => { if (lineOf(id)) mutate.updateLine(id, { giamGiaNcc: p }) })
  }
  const setDiscAll = (g, v) => {
    const p = mhPctIn_(v)
    g.items.filter(l => !l._ex).forEach(l => mutate.updateLine(l.lineId, { giamGiaNcc: p }))
  }
  const setDx = (ids, v) => {
    const p = mhPctIn_(v)
    mhIds_(ids).forEach(id => { const l = lineOf(id); if (l) mutate.updateLine(id, { extra: mhDxExtra_(l, p) }) })
  }
  const setDxAll = (g, v) => {
    const p = mhPctIn_(v)
    g.items.filter(l => !l._ex).forEach(l => mutate.updateLine(l.lineId, { extra: mhDxExtra_(l, p) }))
  }
  /* Ngày cần đặt hàng / tiến độ hàng của dòng (chỉ bản Go): lưu ở extra.ngayCanDat / extra.tienDo, áp cho mọi vị trí gộp của dòng */
  const setMh = (ids, k, v) => {
    mhIds_(ids).forEach(id => { const l = lineOf(id); if (!l) return; const ex = { ...(l.extra || {}) }; if (v) ex[k] = v; else delete ex[k]; mutate.updateLine(id, { extra: ex }) })
  }
  /* Thêm dòng vào nhóm NCC (chỉ bản Go): chọn SP có sẵn (dòng như thêm từ catalog Bóc tách) hoặc vật tư ngoài danh mục;
     cùng đề mục với nhóm, kèm ngày cần đặt / tiến độ hàng */
  const addRow = async ({ p, ten, dvt, gia, moTa, sl, ngay, td }) => {
    const g = addFor, l0 = g.items.find(x => !x._ex) || {}
    const nd = String(l0.nhom || hmNode || '3.2')
    const n = Math.max(1, Math.round(Number(sl) || 1))
    const ex = { themTuMuaHang: 1 }
    if (ngay) ex.ngayCanDat = ngay
    if (td) ex.tienDo = td
    let prod
    if (p) {
      prod = addProdBuild_(p, products, nd, '', n, '', nd, '').prod
      prod.extra = { ...prod.extra, ...ex }
    } else {
      const v = Number(gia) || 0
      prod = { ten: String(ten).trim(), ma: '', ncc: g.ncc, thuongHieu: l0.thuongHieu || '', moTa: String(moTa || '').trim(),
        kichThuoc: '', dvt: String(dvt || '').trim() || 'Cái', hinhAnh: '', donGiaVon: v, donGiaBan: v,
        nhom: nd, hangMuc: nodeName(nd), loai: nodeName(nd), tang: '', extra: ex }
    }
    const l = await mutate.addLine(prod, n)
    if (!l) return
    setAddFor(null)
    toast('Đã thêm "' + prod.ten + '"' + (prod.ncc && prod.ncc !== g.ncc ? ' vào nhóm ' + prod.ncc : '') + ' (cũng hiện ở Bóc tách)')
  }

  /* VAT của dự án (pgSetVat_ -> setVat, PUB/app.js:1950-1958): VAT phần thô đi theo */
  const setVat = async v => {
    v = Number(v) || 0
    mutate.syncProj({ ...cur, vat: v })
    setProjData('ptVat', v)
    try { await mutate.updateProject(cur.maDA, { vat: v }) } catch (e) {
      toast('Chưa lưu được VAT của dự án: ' + String((e && e.message) || e || '').slice(0, 80))
    }
  }

  /* ---------- Gửi ---------- */
  const validate = () => {
    const r = mhValidateInfo(info)
    if (!r) return true
    toast(r.msg)
    setNeed(n => ({ ...n, [r.field]: true }))
    const el = refs[r.field].current
    if (el) el.focus()
    return false
  }
  const base = () => mhBase(cur, hmNode, info)
  const sendOrders = async (list, key, okMsg) => {
    setBusyK(key, true)
    try {
      // ghi chú riêng từng NCC (nút Edit) nối vào ghi chú đơn
      const b = base(), notes = list.map(g => String(mhExOf_(mhEx, g.ncc).note || '').trim() ? (list.length > 1 ? g.ncc + ': ' : '') + mhExOf_(mhEx, g.ncc).note.trim() : '').filter(Boolean)
      const r = await api.sendPurchaseRequest({ ...b, ghiChu: [b.ghiChu, ...notes].filter(Boolean).join('\n'), orders: list.map(g => mhOrderOf(g, vatOf(g), mhEx[g.ncc])) })
      loadDon(ma)
      // M9.1: đơn đã lưu (Admin vẫn thấy để duyệt) nhưng thẻ Lark không tới được
      if (r && r.lark === false) {
        qsAlert({ title: 'Đã lưu đơn nhưng gửi Lark thất bại', nguyHiem: false,
          note: 'Đơn nằm trong "Đơn đã gửi" (Lark: Lỗi gửi Lark) và Admin vẫn thấy để duyệt. Báo nhà cung cấp / Admin qua kênh khác nếu cần.' })
      } else toast(okMsg)
    } catch (e) { toast('Lỗi gửi: ' + e.message) }
    setBusyK(key, false)
  }
  const send = g => {
    if (!validate()) return
    sendOrders([g], 'send:' + g.ncc, '✔ Đã gửi yêu cầu mua hàng tới "' + g.ncc + '"')
  }
  const sendBulk = () => {
    const chon = groups.filter(g => mhOn_(sel, g.ncc))
    if (!chon.length) { toast('Chưa chọn nhà cung cấp nào'); return }
    if (!validate()) return
    sendOrders(chon, 'bulk', '✔ Đã gửi yêu cầu hàng loạt tới ' + chon.length + ' nhà cung cấp')
  }
  const sendDx = async g => {
    if (!validate()) return
    g = mhNoEx_(g)   // đề xuất chiết khấu chỉ cho dòng bóc tách, không gồm hàng thêm tay
    if (!await confirm(mhDxConfirm_(g))) return
    const key = 'dx:' + g.ncc
    setBusyK(key, true)
    try {
      const r = await api.sendDeXuat(mhDxPayload_(base(), g, vatOf(g)))
      toast('✔ Đã gửi đề xuất chiết khấu ' + ((r && r.ma) || '') + ' tới "' + g.ncc + '"')
      loadDx(ma)
    } catch (e) { toast('Lỗi gửi: ' + e.message) }
    setBusyK(key, false)
  }
  const sendPay = async g => {
    if (!validate()) return
    const r = mhPayPayload_(base(), g, vatOf(g), payOf(g.ncc))
    if (r.msg) { toast(r.msg); return }
    if (r.lech && !await confirm('Tổng đề xuất (' + money(r.sum) + ' đ) chưa khớp giá trị đơn (' + money(r.tot) + ' đ). Vẫn gửi?')) return
    const key = 'pay:' + g.ncc
    setBusyK(key, true)
    try {
      const k = await api.sendDeXuat(r.payload)
      toast('✔ Đã gửi đề xuất thanh toán ' + r.n + ' đợt ' + ((k && k.ma) || '') + ' tới "' + g.ncc + '"')
      loadDx(ma)
    } catch (e) { toast('Lỗi gửi: ' + e.message) }
    setBusyK(key, false)
  }

  /* ---------- Đơn đã gửi: chuyển bước / Excel (mhDonBuoc_ / mhDonXls_) ---------- */
  const donBuoc = async (d, st) => {
    if (!await confirm('Chuyển đơn ' + d.maDon + ' (' + d.ncc + ') sang "' + st + '"?')) return
    const key = 'buoc:' + d.maDon
    setBusyK(key, true)
    try {
      await api.setPurchaseStatus(d.maDon, st)
      toast('Đơn ' + d.maDon + ': ' + st)
      await loadDon(ma)
    } catch (e) { toast('Lỗi: ' + e.message) }
    setBusyK(key, false)
  }
  const donXls = async d => {
    const key = 'xls:' + d.maDon
    setBusyK(key, true)
    try {
      await downloadPost('/export/bang', {
        ten: 'ĐƠN MUA HÀNG ' + d.maDon + ' — ' + d.ncc + ' — ' + (cur.ten || ''), sheet: 'Don mua hang',
        cols: [{ label: 'STT' }, { label: 'Mã SP' }, { label: 'Tên sản phẩm' }, { label: 'Thương hiệu' }, { label: 'Vị trí' }, { label: 'ĐVT' }, { label: 'SL', num: true }, { label: 'Đơn giá', num: true }, { label: 'Thành tiền', num: true }],
        rows: (d.items || []).map((it, k) => ({ cells: [k + 1, it.ma, it.ten, it.thuongHieu, it.khuVuc, it.dvt, it.sl, it.donGia, it.thanhTien || it.sl * it.donGia] })),
        tong: [['Trước VAT', d.tongTruocVat], ['VAT ' + d.vatPct + '%', d.vat], ['Tổng cộng', d.tongCong]],
      }, (d.maDon || 'don-mua-hang') + '.xlsx')
    } catch (e) { toast('Lỗi xuất Excel: ' + e.message) }
    setBusyK(key, false)
  }

  /* ---------- Vẽ ---------- */
  const hmLbl = hmNode ? (hmNode + '.' + (nodeName(hmNode) || hmNode)) : 'Tất cả hạng mục'
  const n = mlines.length

  const lacNote = (() => {   // hmLacNote_ (chiphi.js:219-230)
    if (!hmNode || n || hmNode === '3.1' || !lines.length) return null
    const dem = {}
    lines.forEach(l => { const c = String(l.nhom || '') || '(chưa rõ)'; dem[c] = (dem[c] || 0) + 1 })
    const ds = Object.keys(dem).sort((a, b) => dem[b] - dem[a])
    const ten = c => nodeName(c) || c
    return (
      <div className="qs-po-note">
        <Icon name="layers" size={15} />
        <span>Dự án đang có <b>{lines.length} sản phẩm</b> nhưng không dòng nào thuộc <b>{hmNode + '.' + ten(hmNode)}</b>. Sản phẩm đang nằm ở: {ds.slice(0, 4).map((c, i) => <span key={c}>{i ? ' · ' : ''}<b>{ten(c)}</b> ({dem[c]})</span>)}.</span>
        {ds.slice(0, 2).map(c => <button type="button" key={c} className="qs-qt-btn" onClick={() => setHmNode(c)}>Xem {ten(c)}</button>)}
        <button type="button" className="qs-qt-btn" onClick={() => setHmNode('')}>Tất cả hạng mục</button>
      </div>
    )
  })()

  /* "Hạng mục đã bóc" + nút chọn hạng mục: băng dự án mở rộng (số liệu đã lên băng) thì thành thẻ đầu cột trái, không thì ở hàng đầu như cũ */
  const catBtn = (
    <button type="button" className={`qs-bd-category${hmNode ? ' on' : ''}`} title="Chọn hạng mục"
      onClick={e => { const b = e.currentTarget; setHmPop(p => (p ? null : b)) }}>
      <b>{hmLbl}</b>
      <span className="qs-bd-count">[{pad2(n)}]</span>
      <span style={{ flex: 1 }} />
      <span className="qs-bd-acc-plus"><Icon name="plus" size={10} stroke={3} /></span>
    </button>
  )
  return (
    <>
      {/* băng mở rộng: hàng đầu chỉ còn gắn dải số liệu lên băng (portal), không vẽ thẻ */}
      {moneyEl && createPortal(
        <div className="qs-bd-totals">
          {barStats.map(s => <span key={s.k} className={'qs-bd-tg' + (s.tone ? ' ' + s.tone : '')}><span className="qs-bd-tl"><span className="qs-bd-muted">{s.k}</span></span><b>{s.v}</b></span>)}
        </div>, moneyEl)}
      {!moneyEl && <div className="qs-card qs-ct-bar qs-po-head">
        <span className="qs-ct-title">Hạng mục đã bóc</span>
        <span className="qs-bd-count">[{pad2(n)}]</span>
        {catBtn}
        <span style={{ flex: 1 }} />
        {/* băng dự án mở rộng có chỗ ('pcm:muahang'): dải số liệu lên khung tiền của băng; không thì ở hàng này như cũ */}
        {!foldTot && (
          <div className="qs-po-stats">
            <span className="qs-po-stat"><i>NCC đang chọn</i><b>{pad2(head.nccChon) + (head.nccChon < head.nNcc ? '/' + pad2(head.nNcc) : '')}</b></span>
            <span className="qs-po-stat"><i>Sản phẩm</i><b>{pad2(head.spChon) + (head.spChon < head.nLines ? '/' + pad2(head.nLines) : '')}</b></span>
            <span className="qs-po-stat"><i>Trước giảm</i><b>{money(head.chuaCK)} đ</b></span>
            <span className="qs-po-stat"><i>Sau giảm NCC</i><b>{money(head.sauCK)} đ</b></span>
            <span className="qs-po-stat">
              <i>VAT <ChangeInput className="qs-po-vat" type="number" step="any" min="0" value={vatPct} title="Thuế VAT (%)" onCommit={setVat} />%</i>
              <b>{money(head.vat)} đ</b>
            </span>
            <span className="qs-po-stat grand"><i>Tổng</i><b>{money(head.grand)} đ</b></span>
          </div>
        )}
        <button type="button" className={`qs-bd-round-btn accent${foldTot ? ' on' : ''}`} title={(foldTot ? 'Mở lại ' : 'Thu gọn ') + 'dải tổng tiền'}
          onClick={() => setFoldTot(!!foldToggle_('totals').totals)}><Icon name="chevronDown" size={14} /></button>
      </div>}

      {hmNode === '3.1' && (
        <div className="qs-po-note">
          <Icon name="layers" size={15} />
          <span><b>Hạng mục Phần thô</b> có bảng ước tính riêng — tab này chỉ tính sản phẩm, KHÔNG gồm Phần thô, còn bảng chi tiết từng công tác nằm ở Bóc tách. Xem và sửa ở tab <b>Bóc tách</b>, hoặc chọn hạng mục khác ở ô bên trên.</span>
          <button type="button" className="qs-qt-btn" onClick={() => navigate('boc')}>Mở Bóc tách</button>
        </div>
      )}
      {lacNote}

      <div className="qs-po-main">
        <div className="qs-po-list">
          {groups.map((g, gi) => (
            <SupplierCard key={g.ncc} g={g} gi={gi} vatPct={vatOf(g)} projVat={vatPct}
              onVat={v => exSave(g.ncc, { vat: v === '' || v == null ? null : mhPctIn_(v) })} on={mhOn_(sel, g.ncc)} dons={dons}
              onToggle={() => toggleSel(g.ncc)} onProd={l => setProdLine(l)}
              onDisc={setDisc} onDiscAll={v => setDiscAll(g, v)} onDx={setDx} onDxAll={v => setDxAll(g, v)}
              pay={(() => { const tot = mhTot_(g.items, vatOf(g)); return { arr: payView(g.ncc, tot), tot } })()}
              payOpen={!!payOpen[g.ncc]} onPayToggle={() => togglePay(g.ncc)}
              onPaySet={(i, f, v) => { const tot = mhTot_(g.items, vatOf(g)), d = payEdit(g.ncc, tot)[i]; if (!d) return; mhPaySet_(d, f, v, tot); paySave() }}
              onPayAdd={() => { const tot = mhTot_(g.items, vatOf(g)); mhPayAdd_(payEdit(g.ncc, tot), tot); paySave() }}
              onPayDel={i => { const arr = payEdit(g.ncc, mhTot_(g.items, vatOf(g))); if (arr.length <= 1) { toast('Cần ít nhất 1 đợt'); return } arr.splice(i, 1); paySave() }}
              onPayChia={k => { payAll()[g.ncc] = mhPayChia_(mhTot_(g.items, vatOf(g)), k); paySave() }}
              onPaySend={() => sendPay(g)} busy={busy}
              onSend={() => send(g)} onSendDx={() => sendDx(g)} onMh={setMh} onAddRow={() => setAddFor(g)}
              ex={mhExOf_(mhEx, g.ncc)} onEx={p => exSave(g.ncc, p)} />
          ))}
          {!groups.length && (
            <div className="qs-card qs-po-empty">Chưa có sản phẩm trong hạng mục này.<br />Vào tab <b>Bóc tách</b> thêm sản phẩm trước.</div>
          )}
        </div>

        <div className="qs-po-side">
          {moneyEl && (
            <div className="qs-card qs-po-box qs-po-hmbox">
              <div className="qs-po-box-head"><Icon name="layers" size={15} /><b>Hạng mục đã bóc</b><span className="qs-bd-badge">{pad2(n)}</span></div>
              <div className="qs-po-hmrow">{catBtn}</div>
            </div>
          )}
          <div className="qs-card qs-po-box">
            <div className="qs-po-box-head"><Icon name="cart" size={15} /><b>Tổng hợp đơn</b><span className="qs-bd-badge">{pad2(groups.length)}</span></div>
            <div className="qs-po-sum-list">
              {groups.map(g => {
                const on = mhOn_(sel, g.ncc)
                return (
                  <div key={g.ncc} className={`qs-po-sum-row${on ? '' : ' off'}`} onClick={() => toggleSel(g.ncc)}>
                    <span className={`qs-po-check${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} stroke={3} />}</span>
                    <div><b>{g.ncc}</b><small>{g.items.length} SP</small></div>
                    <b>{money(mhTot_(g.items, vatOf(g)))}</b>
                  </div>
                )
              })}
              {!groups.length && <p className="qs-po-none dashed">Chưa có nhà cung cấp.</p>}
            </div>
            <div className="qs-po-form">
              <label><span>Người gửi <i>*</i></span><input ref={refs.nguoiGui} className={need.nguoiGui ? 'invalid' : ''} value={info.nguoiGui || ''} onChange={e => setInfo('nguoiGui', e.target.value)} placeholder="Tên người gửi" /></label>
              <label><span>Phòng ban <i>*</i></span><input ref={refs.phongBan} className={need.phongBan ? 'invalid' : ''} value={info.phongBan || ''} onChange={e => setInfo('phongBan', e.target.value)} placeholder="VD: Mua hàng / Kỹ thuật" /></label>
              <label><span>Ghi chú</span><textarea rows={2} value={info.ghiChu || ''} onChange={e => setInfo('ghiChu', e.target.value)} placeholder="Ghi chú cho đơn…" /></label>
            </div>
            <div className="qs-po-grand"><span>Tổng cộng (VAT)</span><b>{money(head.grand)}</b></div>
            <button type="button" className="qs-po-send wide" disabled={!groups.length || !!busy.bulk} onClick={sendBulk}>
              <Icon name="cart" size={14} />{busy.bulk ? 'Đang gửi…' : 'Gửi ' + head.nccChon + ' đơn đã chọn'}
            </button>
          </div>

          <div className="qs-card qs-po-box">
            <div className="qs-po-box-head">
              <Icon name="cart" size={15} /><b>Đơn đã gửi</b><span className="qs-bd-badge">{pad2(dons.length)}</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="qs-po-fold" title="Tải lại trạng thái đơn" disabled={don.loading} onClick={() => loadDon(ma)}><Icon name="history" size={12} /></button>
            </div>
            {don.ma !== ma
              ? <LoadMsg st={don} onRetry={() => loadDon(ma)} />
              : dons.map(d => {
                const buoc = d.trangThai === 'Đã duyệt' ? 'Đã đặt hàng' : (d.trangThai === 'Đã đặt hàng' ? 'Đã nhận hàng' : '')
                return (
                  <div key={d.maDon} className="qs-po-order">
                    <div><b>{d.maDon}</b><span className={`qs-po-tt ${MH_TT[d.trangThai] || ''}`}>{d.trangThai || ''}</span></div>
                    <small>{d.ncc} · {(d.items || []).length} SP · {money(d.tongCong)} đ{d.ngayGui ? ' · ' + fmtDate(d.ngayGui) : ''}</small>
                    <div className="qs-po-order-meta">
                      <span className={`qs-po-lark ${larkCls_(d.ketQuaGui)}`} title="Kết quả gửi thẻ Lark">Lark: {larkLbl_(d.ketQuaGui)}</span>
                      {d.nguoiDuyet ? <span className="qs-po-duyet">{(d.trangThai === 'Từ chối' ? 'Từ chối bởi ' : 'Duyệt bởi ') + d.nguoiDuyet + (d.ngayDuyet ? ' · ' + fmtDateTime_(d.ngayDuyet) : '')}</span> : null}
                    </div>
                    <div className="qs-po-order-act">
                      {buoc && <button type="button" className="qs-qt-btn" disabled={!!busy['buoc:' + d.maDon]} onClick={() => donBuoc(d, buoc)}><Icon name="check" size={12} />{buoc}</button>}
                      <button type="button" className="qs-qt-btn" disabled={!!busy['xls:' + d.maDon]} onClick={() => donXls(d)}><Icon name="download" size={12} />Excel</button>
                    </div>
                  </div>
                )
              })}
            {don.ma === ma && !dons.length && <p className="qs-po-none dashed">Chưa gửi đơn nào cho dự án này.</p>}
          </div>

          <div className="qs-card qs-po-box">
            <div className="qs-po-box-head"><Icon name="gauge" size={15} /><b>Phiếu đề xuất đã gửi</b><span className="qs-bd-badge">{pad2(dxs.length)}</span></div>
            {dx.ma !== ma
              ? <LoadMsg st={dx} onRetry={() => loadDx(ma)} />
              : dxs.length
                ? (
                  <div className="qs-po-dxlist">
                    {dxs.map(r => {
                      const scls = dxStatusCls_(r.status)
                      return (
                        <div key={r.ma} className={`qs-po-dxrow ${scls}`} title="Xem chi tiết phiếu" onClick={() => setDxOpen(r.ma)}>
                          <span className="qs-po-dxrow-ic"><Icon name={r.loai === 'tt' ? 'banknote' : 'gauge'} size={14} /></span>
                          <div className="qs-po-dxrow-m">
                            <div className="qs-po-dxrow-t">{(DX_TEN_[r.loai] || 'Đề xuất') + ' · ' + (r.supplier || '—')}</div>
                            <div className="qs-po-dxrow-s">{r.ma + ' · ' + fmtDateTime_(r.at)}</div>
                          </div>
                          <div className="qs-po-dxrow-r"><b>{money(r.loai === 'tt' ? r.tongDeXuat : r.tienGiam)}</b><span className={`qs-po-badge ${scls}`}>{r.status || ''}</span></div>
                        </div>
                      )
                    })}
                  </div>
                )
                : <p className="qs-po-none dashed">Chưa gửi đề xuất nào cho dự án này.</p>}
          </div>
        </div>
      </div>

      {hmPop && (
        <HmPicker anchor={hmPop} cur={hmNode} lines={lines} onClose={() => setHmPop(null)}
          onPick={code => { setHmPop(null); setHmNode(code) }} />
      )}
      {dxOpen && <ProposalDetail ma={dxOpen} list={dxs} isAdmin={isAdmin} onClose={() => setDxOpen(null)} onResolve={dxResolve} />}
      {prodLine && (
        <ProductModal line={lineOf(prodLine.lineId) || prodLine} products={products} onClose={() => setProdLine(null)}
          onOpenBoc={() => { setProdLine(null); navigate('boc') }} />
      )}
      {addFor && <AddRowModal g={addFor} products={products} tienDo={MH_TIEN_DO} onAdd={addRow} onClose={() => setAddFor(null)} />}
    </>
  )
}

function LoadMsg({ st, onRetry }) {
  if (st.err) {
    return (
      <div className="qs-po-loadmsg err">Lỗi tải: {st.err}
        <button type="button" className="qs-qt-btn" onClick={onRetry}>Thử lại</button>
      </div>
    )
  }
  return <p className="qs-po-loadmsg">Đang tải…</p>
}

/* Ô "Nhập %" trong danh sách xổ VAT: ô chữ có trạng thái riêng (gõ thấy ngay), chỉ nhận số 0..100 (dấu phẩy = dấu chấm);
   Enter hoặc nút ✓ = áp dụng; Esc do Pop đóng danh sách */
function VatSelfInput({ onPick }) {
  const [v, setV] = useState('')
  const ok = () => { const n = Number(String(v).replace(',', '.').trim()); if (String(v).trim() === '' || !isFinite(n) || n < 0 || n > 100) return; onPick(n) }
  return (
    <>
      <input type="text" inputMode="decimal" autoFocus value={v} placeholder="Nhập %" title="Gõ % VAT rồi Enter"
        onChange={e => setV(e.target.value.replace(/[^d.,]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ok() } }} />
      <button type="button" className="ok" title="Áp dụng" disabled={!String(v).trim()} onClick={ok}><Icon name="check" size={12} /></button>
    </>
  )
}

/* Thẻ một nhà cung cấp (muahangCard, PUB/muahang.js:34-89).
   Nút Edit (phòng mua hàng): bật chế độ sửa thẻ - thêm hàng tay (tên · ĐVT · SL · đơn giá · ghi chú; cộng vào tổng + gửi kèm đơn),
   thêm / đổi tên / xoá cột tự đặt (nhập chữ từng dòng; gửi kèm đơn trong ô khu vực), ghi chú riêng cho NCC. Lưu ở projData.mhExtra[ncc] (ex / onEx). */
function SupplierCard({ g, gi, vatPct, projVat, onVat, on, dons, onToggle, onProd, onDisc, onDiscAll, onDx, onDxAll, pay, payOpen, onPayToggle,
  onPaySet, onPayAdd, onPayDel, onPayChia, onPaySend, busy, onSend, onSendDx, ex, onEx, onMh, onAddRow }) {
  const ncc = g.ncc, items = g.items
  const [edit, setEdit] = useState(false)
  const [vatPop, setVatPop] = useState(null)   // danh sách xổ % VAT (10 / 8 / 5 / 0)
  const cols = ex.cols || [], nCol = cols.length
  const exRows = ex.rows || []
  const setRow = (id, f, v) => onEx({ rows: exRows.map(r => (r.id === id ? { ...r, [f]: v } : r)) })
  const delRow = id => onEx({ rows: exRows.filter(r => r.id !== id) })
  const addRow = () => onEx({ rows: exRows.concat([{ id: Date.now().toString(36), ten: '', dvt: 'Cái', sl: 1, donGia: 0, ghiChu: '' }]) })
  const addCol = () => onEx({ cols: cols.concat([{ id: Date.now().toString(36), ten: 'Cột ' + (nCol + 1) }]) })
  const setCol = (id, ten) => onEx({ cols: cols.map(c => (c.id === id ? { ...c, ten } : c)) })
  const delCol = id => {
    const vals = {}
    Object.keys(ex.vals || {}).forEach(k => { const v = { ...ex.vals[k] }; delete v[id]; vals[k] = v })
    onEx({ cols: cols.filter(c => c.id !== id), vals })
  }
  const setVal = (l, cid, v) => { const k = mhExKey_(l); onEx({ vals: { ...(ex.vals || {}), [k]: { ...((ex.vals || {})[k] || {}), [cid]: v } } }) }
  const valOf = (l, cid) => (((ex.vals || {})[mhExKey_(l)] || {})[cid]) || ''
  let sub = 0
  const rows = mhGop_(items).map((G, i) => {
    const l = G.l, dg = mhPrice(l), sl = G.sl, ttGoc = sl * dg, daDat = l._ex ? null : mhDaDat_(dons, ncc, l)
    const pct = mhDisc_(l), ttCK = sl * mhPriceCK_(l)
    sub += ttCK
    const colCells = cols.map(c => (
      <td key={c.id} className="qs-po-xc">{edit
        ? <ChangeInput className="qs-po-xin" value={valOf(l, c.id)} placeholder="…" onCommit={v => setVal(l, c.id, v)} />
        : (valOf(l, c.id) || <span className="qs-po-xdash">—</span>)}</td>
    ))
    if (l._ex) {
      /* hàng thêm tay: Edit = sửa tại chỗ; thường = hiện như dòng đơn + nhãn "Thêm tay" */
      const r = exRows.find(x => x.id === l.exId) || {}
      return (
        <tr key={l.lineId} className="qs-po-xrow">
          <td className="c no">{(gi + 1) + '.' + (i + 1)}</td>
          <td className="c"><span className="qs-po-xico" title="Hàng thêm tay"><Icon name="edit" size={14} /></span></td>
          <td className="prod">
            {edit ? (
              <div className="qs-po-xedit">
                <ChangeInput className="qs-po-xin name" value={r.ten || ''} placeholder="Tên hàng (vd. Phí vận chuyển, phụ kiện…)" onCommit={v => setRow(r.id, 'ten', v)} />
                <ChangeInput className="qs-po-xin" value={r.ghiChu || ''} placeholder="Ghi chú cho dòng này" onCommit={v => setRow(r.id, 'ghiChu', v)} />
                <button type="button" className="qs-po-xdel" title="Xoá hàng này" onClick={() => delRow(r.id)}><Icon name="trash" size={13} /> Xoá hàng</button>
              </div>
            ) : (
              <>
                <span className="qs-po-name static">{l.ten || <i>(chưa đặt tên)</i>}<span className="qs-po-xtag">Thêm tay</span></span>
                {l.ghiChuEx && <p>{l.ghiChuEx}</p>}
              </>
            )}
          </td>
          {colCells}
          <td className="c unit">{edit ? <ChangeInput className="qs-po-xin c" value={r.dvt || ''} onCommit={v => setRow(r.id, 'dvt', v)} /> : (l.dvt || 'Cái')}</td>
          <td className="c">{edit ? <ChangeInput className="qs-po-xin c" type="number" min="0" value={String(r.sl == null ? '' : r.sl)} onCommit={v => setRow(r.id, 'sl', v)} /> : <b>{String(sl)}</b>}</td>
          <td className="r">{edit ? <ChangeInput className="qs-po-xin r" value={String(r.donGia == null ? '' : r.donGia)} placeholder="0" onCommit={v => setRow(r.id, 'donGia', v)} /> : money(dg)}</td>
          <td className="r"><b>{money(ttGoc)}</b></td>
          <td className="c qs-po-xdash">—</td>
          <td className="c qs-po-xdash">—</td>
          <td className="r after">{money(ttCK)}</td>
          <td className="c qs-po-xdash">—</td>
          <td className="c qs-po-xdash">—</td>
        </tr>
      )
    }
    const mo = String(l.moTa || '').trim(), kt = String(l.kichThuoc || '').trim()
    // mô tả và kích thước hay lặp nhau -> chỉ nối phần thật sự mới
    const spec = (mo + (kt && spNorm_(mo).indexOf(spNorm_(kt)) < 0 ? (mo ? ' · ' : '') + kt : '')).replace(/\s+/g, ' ').trim()
    const sub2 = [G.viTri.length > 1 ? (G.viTri.length + ' vị trí: ' + G.viTri.join(', ')) : (G.viTri[0] || ''), l.thuongHieu]
      .map(x => String(x || '').trim()).filter(Boolean).join(' · ')
    const src = String(l.hinhAnh || '').split('\n')[0] ? imgSrc1_(l.hinhAnh) : ''
    return (
      <tr key={G.ids}>
        <td className="c no">{(gi + 1) + '.' + (i + 1)}</td>
        <td className="c"><ProductThumb className="qs-po-thumb-img" product={l} size={36} src={src} /></td>
        <td className="prod">
          <button type="button" className="qs-po-name" title="Bấm để xem thông tin sản phẩm" onClick={() => onProd(l)}>{l.ten || ''}<Icon name="eye" size={12} /></button>
          {sub2 && <small>{sub2}</small>}
          {daDat && <span className="qs-po-dadat" title="Sản phẩm này đã nằm trong đơn đã gửi — kiểm tra trước khi gửi lại để khỏi đặt trùng"><Icon name="cart" size={11} /> Đã có trong đơn {daDat.maDon} · {daDat.trangThai}</span>}
          {spec && <p>{spec}</p>}
        </td>
        {colCells}
        <td className="c unit">{l.dvt || 'Cái'}</td>
        <td className="c"><b>{String(sl)}</b></td>
        <td className={`r${dg ? '' : ' zero'}`}>{money(dg)}</td>
        <td className="r"><b>{money(ttGoc)}</b></td>
        <td className="c"><label className="qs-po-pct propose" title="Mức giảm giá phòng mua hàng đề xuất với nhà cung cấp"><ChangeInput type="number" min="0" max="100" placeholder="0" value={mhDx_(l) || ''} onCommit={v => onDx(G.ids, v)} />%</label></td>
        <td className="c"><label className="qs-po-pct"><ChangeInput type="number" min="0" max="100" placeholder="0" value={pct || ''} onCommit={v => onDisc(G.ids, v)} />%</label></td>
        <td className="r after">{money(ttCK)}</td>
        <td className="c"><input type="date" className="qs-po-date" title="Ngày cần đặt hàng" value={(l.extra && l.extra.ngayCanDat) || ''} onChange={e => onMh(G.ids, 'ngayCanDat', e.target.value)} /></td>
        <td className="c"><select className={'qs-po-td t' + MH_TIEN_DO.indexOf((l.extra && l.extra.tienDo) || '')} title="Tiến độ hàng" value={(l.extra && l.extra.tienDo) || ''} onChange={e => onMh(G.ids, 'tienDo', e.target.value)}>
          <option value="">— Chưa đặt —</option>{MH_TIEN_DO.slice(1).map(x => <option key={x} value={x}>{x}</option>)}</select></td>
      </tr>
    )
  })
  const vat = Math.round(sub * vatPct / 100), tot = sub + vat
  const nAll = 12 + nCol   // + 2 cột Ngày cần đặt / Tiến độ hàng
  const realN = items.filter(l => !l._ex).length
  return (
    <div className={`qs-card qs-po-card${on ? ' on' : ''}${edit ? ' editing' : ''}`}>
      <div className="qs-po-card-head">
        <span className="qs-po-card-icon"><Icon name="building" size={16} /></span>
        <b>{ncc}</b><span className="qs-bd-badge">{realN} SP{exRows.length ? ' + ' + exRows.length + ' thêm tay' : ''}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={`qs-po-editbtn${edit ? ' on' : ''}`} title={edit ? 'Xong — thoát chế độ sửa' : 'Sửa thẻ: thêm hàng, cột, ghi chú cho nhà cung cấp này'}
          onClick={() => setEdit(v => !v)}><Icon name={edit ? 'check' : 'edit'} size={14} />{edit ? 'Xong' : 'Edit'}</button>
        <b className="qs-po-card-total">{money(tot)}</b>
        <button type="button" className={`qs-po-check${on ? ' on' : ''}`} title="Chọn để gửi hàng loạt" onClick={onToggle}>{on && <Icon name="check" size={13} stroke={3} />}</button>
      </div>
      <table className="qs-po-table">
        <thead>
          <tr>
            <th className="c">#</th><th className="c">Ảnh</th><th>Sản phẩm</th>
            {cols.map(c => (
              <th key={c.id} className="qs-po-xth">{edit
                ? <span className="qs-po-xthin"><ChangeInput className="qs-po-xin th" value={c.ten || ''} onCommit={v => setCol(c.id, v)} /><button type="button" title="Xoá cột này" onClick={() => delCol(c.id)}>✕</button></span>
                : c.ten}</th>
            ))}
            <th className="c">ĐVT</th><th className="c">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th>
            <th className="c" title="Mức giảm giá phòng mua hàng đề xuất với nhà cung cấp">Đề xuất giảm (%)<ChangeInput className="qs-po-bulk" type="number" min="0" max="100" placeholder="%" value="" title="Đề xuất % cho tất cả dòng" onCommit={onDxAll} /></th>
            <th className="c" title="Mức giảm giá nhà cung cấp đã chốt">Giảm giá NCC (%)<ChangeInput className="qs-po-bulk" type="number" min="0" max="100" placeholder="%" value="" title="Áp dụng % cho tất cả dòng" onCommit={onDiscAll} /></th>
            <th className="r">Thành tiền sau CK</th>
            <th className="c" title="Ngày cần đặt hàng với nhà cung cấp">Ngày cần đặt</th><th className="c" title="Tiến độ của hàng">Tiến độ hàng</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows : <tr><td colSpan={nAll} className="c">—</td></tr>}
          {edit && (
            <tr className="qs-po-xadd"><td colSpan={nAll}>
              <button type="button" onClick={addRow}><Icon name="plus" size={14} /> Thêm hàng</button>
              <button type="button" onClick={addCol}><Icon name="plus" size={14} /> Thêm cột</button>
              <span className="qs-po-xhint">Hàng thêm tay cộng vào tổng và gửi kèm đơn NCC; cột tự thêm gửi kèm ở phần ghi chú từng dòng.</span>
            </td></tr>
          )}
        </tbody>
        <tfoot>
          <tr><td colSpan={nAll} className="qs-po-addrow"><button type="button" onClick={onAddRow}><Icon name="plus" size={13} /> Thêm dòng</button></td></tr>
          <tr><td colSpan={nAll - 3} className="r">Tổng (chưa VAT)</td><td className="r">{money(sub)}</td><td colSpan={2} /></tr>
          {/* VAT riêng của NCC: ô tự nhập % + nút ▾ xổ danh sách 10 / 8 / 5 / 0%; chưa đặt = theo VAT dự án */}
          <tr className="vat">
            <td colSpan={nAll - 3} className="r">
              <span className="qs-po-vatpick">
                <span>VAT (%)</span>
                {/* bấm cả ô = xổ danh sách ngay bên dưới, thẳng mép trái ô: trên cùng là ô trống chỉ để gõ số (Enter để áp) + 10 / 8 / 5 / 0% (số căn giữa) */}
                <button type="button" className={'qs-po-vatin trig' + (vatPop ? ' on' : '')} title="Chọn % VAT của nhà cung cấp này"
                  onClick={e => { const el = e.currentTarget; setVatPop(x => (x ? null : el)) }}>
                  <b>{vatPct}</b>%<Icon name="chevronDown" size={12} />
                </button>
                {vatPop && (
                  <Pop anchor={vatPop} matchAnchor className="qs-po-vatpop" onClose={() => setVatPop(null)}>
                    <label className="qs-po-vatself" onMouseDown={e => e.stopPropagation()}>
                      <VatSelfInput onPick={v => { onVat(v); setVatPop(null) }} />
                    </label>
                    {[10, 8, 5, 0].map(v => (
                      <button key={v} type="button" className={vatPct === v ? 'on' : ''} onClick={() => { onVat(v); setVatPop(null) }}>
                        {v}%{vatPct === v && <Icon name="check" size={12} className="ck" />}
                      </button>
                    ))}
                  </Pop>
                )}
                {ex.vat != null && ex.vat !== '' && Number(ex.vat) !== projVat && (
                  <button type="button" className="ve" title={'Về VAT dự án (' + projVat + '%)'} onClick={() => onVat('')}>↺ {projVat}%</button>
                )}
              </span>
            </td>
            <td className="r">{money(vat)}</td><td colSpan={2} />
          </tr>
          <tr className="grand"><td colSpan={nAll - 3} className="r">Tổng (VAT)</td><td className="r">{money(tot)}</td><td colSpan={2} /></tr>
        </tfoot>
      </table>
      {(edit || ex.note) && (
        <div className="qs-po-xnote">
          <span><Icon name="edit" size={13} /> Ghi chú cho NCC</span>
          {edit
            ? <ChangeInput textarea rows={2} value={ex.note || ''} placeholder="Ghi chú riêng cho nhà cung cấp này (gửi kèm đơn)…" onCommit={v => onEx({ note: v })} />
            : <p>{ex.note}</p>}
        </div>
      )}
      <PaymentPlan arr={pay.arr} tot={pay.tot} open={payOpen} busy={!!busy['pay:' + ncc]} onToggle={onPayToggle}
        onSet={onPaySet} onAdd={onPayAdd} onDel={onPayDel} onChia={onPayChia} onSend={onPaySend} />
      <div className="qs-po-card-foot">
        {mhDxSum_(items) > 0 && (
          <button type="button" className="qs-po-amber" disabled={!!busy['dx:' + ncc]} title="Gửi mức chiết khấu phòng mua hàng đề xuất cho nhà cung cấp" onClick={onSendDx}>
            <Icon name="gauge" size={15} />{busy['dx:' + ncc] ? 'Đang gửi…' : 'Gửi yêu cầu chiết khấu đề xuất'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="qs-po-send" disabled={!!busy['send:' + ncc]} onClick={onSend}><Icon name="cart" size={14} />{busy['send:' + ncc] ? 'Đang gửi…' : 'Gửi mua hàng NCC này'}</button>
      </div>
    </div>
  )
}
