import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../../components/ui/Icon'
import ProductThumb from './common/ProductThumb'
import PaymentPlan from './purchase/PaymentPlan'
import HmPicker from './purchase/HmPicker'
import ProposalDetail from './purchase/ProposalDetail'
import ProductModal from './purchase/ProductModal'
import AddRowModal from './purchase/AddRowModal'
import { addProdBuild_ } from '../lib/calc'
import ChangeInput from './purchase/ChangeInput'
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
  DX_TEN_, dxStatusCls_,
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
  const groups = mhGroups_(mlines)
  const head = mhHead_(groups, vatPct, sel)
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
    g.items.forEach(l => mutate.updateLine(l.lineId, { giamGiaNcc: p }))
  }
  const setDx = (ids, v) => {
    const p = mhPctIn_(v)
    mhIds_(ids).forEach(id => { const l = lineOf(id); if (l) mutate.updateLine(id, { extra: mhDxExtra_(l, p) }) })
  }
  const setDxAll = (g, v) => {
    const p = mhPctIn_(v)
    g.items.forEach(l => mutate.updateLine(l.lineId, { extra: mhDxExtra_(l, p) }))
  }
  /* Ngày cần đặt hàng / tiến độ hàng của dòng (chỉ bản Go): lưu ở extra.ngayCanDat / extra.tienDo, áp cho mọi vị trí gộp của dòng */
  const setMh = (ids, k, v) => {
    mhIds_(ids).forEach(id => { const l = lineOf(id); if (!l) return; const ex = { ...(l.extra || {}) }; if (v) ex[k] = v; else delete ex[k]; mutate.updateLine(id, { extra: ex }) })
  }
  /* Thêm dòng vào nhóm NCC (chỉ bản Go): chọn SP có sẵn (dòng như thêm từ catalog Bóc tách) hoặc vật tư ngoài danh mục;
     cùng đề mục với nhóm, kèm ngày cần đặt / tiến độ hàng */
  const addRow = async ({ p, ten, dvt, gia, moTa, sl, ngay, td }) => {
    const g = addFor
    const nd = String((g.items[0] && g.items[0].nhom) || hmNode || '3.2')
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
      prod = { ten: String(ten).trim(), ma: '', ncc: g.ncc, thuongHieu: (g.items[0] && g.items[0].thuongHieu) || '', moTa: String(moTa || '').trim(),
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
      const r = await api.sendPurchaseRequest({ ...base(), orders: list.map(g => mhOrderOf(g, vatPct)) })
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
    if (!await confirm(mhDxConfirm_(g))) return
    const key = 'dx:' + g.ncc
    setBusyK(key, true)
    try {
      const r = await api.sendDeXuat(mhDxPayload_(base(), g, vatPct))
      toast('✔ Đã gửi đề xuất chiết khấu ' + ((r && r.ma) || '') + ' tới "' + g.ncc + '"')
      loadDx(ma)
    } catch (e) { toast('Lỗi gửi: ' + e.message) }
    setBusyK(key, false)
  }
  const sendPay = async g => {
    if (!validate()) return
    const r = mhPayPayload_(base(), g, vatPct, payOf(g.ncc))
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

  return (
    <>
      <div className="qs-card qs-ct-bar qs-po-head">
        <span className="qs-ct-title">Hạng mục đã bóc</span>
        <span className="qs-bd-count">[{pad2(n)}]</span>
        <button type="button" className={`qs-bd-category${hmNode ? ' on' : ''}`} title="Chọn hạng mục"
          onClick={e => { const b = e.currentTarget; setHmPop(p => (p ? null : b)) }}>
          <b>{hmLbl}</b>
          <span className="qs-bd-count">[{pad2(n)}]</span>
          <span style={{ flex: 1 }} />
          <span className="qs-bd-acc-plus"><Icon name="plus" size={10} stroke={3} /></span>
        </button>
        <span style={{ flex: 1 }} />
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
      </div>

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
            <SupplierCard key={g.ncc} g={g} gi={gi} vatPct={vatPct} on={mhOn_(sel, g.ncc)} dons={dons}
              onToggle={() => toggleSel(g.ncc)} onProd={l => setProdLine(l)}
              onDisc={setDisc} onDiscAll={v => setDiscAll(g, v)} onDx={setDx} onDxAll={v => setDxAll(g, v)}
              pay={(() => { const tot = mhTot_(g.items, vatPct); return { arr: payView(g.ncc, tot), tot } })()}
              payOpen={!!payOpen[g.ncc]} onPayToggle={() => togglePay(g.ncc)}
              onPaySet={(i, f, v) => { const tot = mhTot_(g.items, vatPct), d = payEdit(g.ncc, tot)[i]; if (!d) return; mhPaySet_(d, f, v, tot); paySave() }}
              onPayAdd={() => { const tot = mhTot_(g.items, vatPct); mhPayAdd_(payEdit(g.ncc, tot), tot); paySave() }}
              onPayDel={i => { const arr = payEdit(g.ncc, mhTot_(g.items, vatPct)); if (arr.length <= 1) { toast('Cần ít nhất 1 đợt'); return } arr.splice(i, 1); paySave() }}
              onPayChia={k => { payAll()[g.ncc] = mhPayChia_(mhTot_(g.items, vatPct), k); paySave() }}
              onPaySend={() => sendPay(g)} busy={busy}
              onSend={() => send(g)} onSendDx={() => sendDx(g)} onMh={setMh} onAddRow={() => setAddFor(g)} />
          ))}
          {!groups.length && (
            <div className="qs-card qs-po-empty">Chưa có sản phẩm trong hạng mục này.<br />Vào tab <b>Bóc tách</b> thêm sản phẩm trước.</div>
          )}
        </div>

        <div className="qs-po-side">
          <div className="qs-card qs-po-box">
            <div className="qs-po-box-head"><Icon name="cart" size={15} /><b>Tổng hợp đơn</b><span className="qs-bd-badge">{pad2(groups.length)}</span></div>
            <div className="qs-po-sum-list">
              {groups.map(g => {
                const on = mhOn_(sel, g.ncc)
                return (
                  <div key={g.ncc} className={`qs-po-sum-row${on ? '' : ' off'}`} onClick={() => toggleSel(g.ncc)}>
                    <span className={`qs-po-check${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} stroke={3} />}</span>
                    <div><b>{g.ncc}</b><small>{g.items.length} SP</small></div>
                    <b>{money(mhTot_(g.items, vatPct))}</b>
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
            <div className="qs-po-grand"><span>Tổng cộng (VAT)</span><b>{money(head.grand)} đ</b></div>
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

/* Thẻ một nhà cung cấp (muahangCard, PUB/muahang.js:34-89) */
function SupplierCard({ g, gi, vatPct, on, dons, onToggle, onProd, onDisc, onDiscAll, onDx, onDxAll, pay, payOpen, onPayToggle,
  onPaySet, onPayAdd, onPayDel, onPayChia, onPaySend, busy, onSend, onSendDx, onMh, onAddRow }) {
  const ncc = g.ncc, items = g.items
  let sub = 0
  const rows = mhGop_(items).map((G, i) => {
    const l = G.l, dg = mhPrice(l), sl = G.sl, ttGoc = sl * dg, daDat = mhDaDat_(dons, ncc, l)
    const pct = mhDisc_(l), ttCK = sl * mhPriceCK_(l)
    sub += ttCK
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
  return (
    <div className={`qs-card qs-po-card${on ? ' on' : ''}`}>
      <div className="qs-po-card-head">
        <span className="qs-po-card-icon"><Icon name="building" size={16} /></span>
        <b>{ncc}</b><span className="qs-bd-badge">{items.length} SP</span>
        <span style={{ flex: 1 }} />
        <b className="qs-po-card-total">{money(tot)} đ</b>
        <button type="button" className={`qs-po-check${on ? ' on' : ''}`} title="Chọn để gửi hàng loạt" onClick={onToggle}>{on && <Icon name="check" size={13} stroke={3} />}</button>
      </div>
      <table className="qs-po-table">
        <thead>
          <tr>
            <th className="c">#</th><th className="c">Ảnh</th><th>Sản phẩm</th><th className="c">ĐVT</th><th className="c">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th>
            <th className="c" title="Mức giảm giá phòng mua hàng đề xuất với nhà cung cấp">Đề xuất giảm (%)<ChangeInput className="qs-po-bulk" type="number" min="0" max="100" placeholder="%" value="" title="Đề xuất % cho tất cả dòng" onCommit={onDxAll} /></th>
            <th className="c" title="Mức giảm giá nhà cung cấp đã chốt">Giảm giá NCC (%)<ChangeInput className="qs-po-bulk" type="number" min="0" max="100" placeholder="%" value="" title="Áp dụng % cho tất cả dòng" onCommit={onDiscAll} /></th>
            <th className="r">Thành tiền sau CK</th>
            <th className="c" title="Ngày cần đặt hàng với nhà cung cấp">Ngày cần đặt</th><th className="c" title="Tiến độ của hàng">Tiến độ hàng</th>
          </tr>
        </thead>
        <tbody>{rows.length ? rows : <tr><td colSpan={12} className="c">—</td></tr>}</tbody>
        <tfoot>
          <tr><td colSpan={12} className="qs-po-addrow"><button type="button" onClick={onAddRow}><Icon name="plus" size={13} /> Thêm dòng</button></td></tr>
          <tr><td colSpan={9} className="r">VAT {vatPct}%</td><td className="r">{money(vat)}</td><td colSpan={2} /></tr>
          <tr className="grand"><td colSpan={9} className="r">Tổng</td><td className="r">{money(tot)}</td><td colSpan={2} /></tr>
        </tfoot>
      </table>
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
