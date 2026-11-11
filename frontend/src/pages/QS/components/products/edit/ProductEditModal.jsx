import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../../api/qsApi'
import { loadSpecs } from '../../../api/specs'
import { isAbort } from '../../../api/http'
import { useQsStore, getState, reloadProducts } from '../../../state/store'
import { fmtDate, spNorm_ } from '../../../lib/format'
import { groupsCuaSP_, groupsOfNganh_, nganhCuaSP_, coSpec_, dbLabelMaps_, specNganh_, IMP_LOAI } from '../../../lib/productFields'
import { MrootPortal } from '../../common/Mroot'
import QsIcon from '../../common/QsIcon'
import { qsToast, qsConfirm, qsAlert, qsAsk } from '../../common/dialogs'
import { clearComboCache } from '../../breakdown/catalog/comboCache'
import ImgUpBlock from './ImgUpBlock'
import DocField from './DocField'
import RelatedBox from './RelatedBox'
import QuickVariantsModal from './QuickVariantsModal'
import { fmtDateTime_, speFieldDef_, vsApply_, BT_TRUC, cbItem_, btItem_ } from './editModel'
import './productEdit.css'

/* Cập nhật sản phẩm #spEditOv (P6, port spEditModal / speField_ / speSnap_ / speCalcDaiLy_ / spEditClose / spEditSave,
   PUB/sanpham.js:1964-1987, 2305-2512) và Tạo nhanh biến thể (P7, QuickVariantsModal).
   Props (cố định từ Batch 0): productKey = recordId (hoặc mã) của SP trong danh mục; onClose(); onSaved(info) sau khi ghi xong
     (đã gọi reloadProducts), info = {kind: 'update' | 'variant' | 'copy' | 'nbt', key, ma, result}.
   mode: 'edit' (mặc định) = Cập nhật sản phẩm · 'variant' = Nhân bản thành biến thể cùng mã (spNhanBan_)
         'copy' = Sao chép thành sản phẩm mới (mã mới) · 'nbt' = chỉ mở "Tạo nhanh biến thể" (spNhieuBT_)
   Prop tuỳ chọn: product (object SP, nếu không thì tìm theo productKey trong danh mục),
     canDuyet (bool; bỏ trống thì tự hỏi /product-permissions, lỗi thì coi như được duyệt, như sanpham.js:325-330). */
/* Lỗi trùng khoá của database (23505 - mã + biến thể đã có) -> câu dễ hiểu; lỗi khác giữ nguyên */
function loiLuu_(e) {
  const m = String((e && e.message) || e)
  if (/23505|duplicate key/i.test(m)) return 'Không lưu được: đã có sản phẩm cùng mã và cùng thông số biến thể (màu sắc, kích thước, công suất, nhiệt độ màu, góc chiếu). Đổi một trong các mục này cho khác.'
  return 'Lỗi lưu: ' + m
}

export default function ProductEditModal({ productKey, mode, onClose, onSaved, product, canDuyet }) {
  const products = useQsStore(s => s.products)
  const md = mode === 'copy' || mode === 'nbt' || mode === 'variant' ? mode : ((mode === true || mode === 1) ? 'variant' : 'edit')
  const p0 = useMemo(() => {
    if (product && typeof product === 'object') return product
    const k = String(productKey == null ? '' : productKey)
    const ds = getState().products || []
    return ds.find(x => String(x.recordId) === k) || ds.find(x => String(x.ma || '').trim().toLowerCase() === k.trim().toLowerCase()) || null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey, product])

  // Không có SP / chưa có mã: báo như bản gốc rồi đóng
  const bad = !p0 ? 'Không tìm thấy "' + String(productKey == null ? '' : productKey) + '" trong danh mục — có thể đã bị xoá'
    : (!p0.ma ? 'Sản phẩm chưa có mã — không cập nhật được' : '')
  useEffect(() => {
    if (!bad) return
    qsToast(bad)
    if (onClose) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bad])
  if (bad) return null

  if (md === 'nbt') {
    return <NbtStandalone p0={p0} onClose={onClose}
      onDone={r => { if (onSaved) onSaved({ kind: 'nbt', key: String(p0.recordId), ma: p0.ma, result: r }) }} />
  }
  return <EditDialog key={String(p0.recordId) + '|' + md} p0={p0} md={md} products={products}
    canDuyetProp={canDuyet} onClose={onClose} onSaved={onSaved} />
}

/* "Tạo nhanh biến thể" mở thẳng từ menu sao chép: cần spec ngành để chép đủ thông số của SP gốc (cột sơn / vệ sinh / công tắc) */
function NbtStandalone({ p0, onClose, onDone }) {
  const [st, setSt] = useState({ specs: null, err: '' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setSt({ specs: null, err: '' })
    loadSpecs().then(specs => { if (live) setSt({ specs, err: '' }) },
      e => { if (live) setSt({ specs: null, err: (e && e.message) || 'Không tải được thông số ngành' }) })
    return () => { live = false }
  }, [retry])
  if (st.specs) return <QuickVariantsModal product={p0} specs={st.specs} onClose={() => onClose && onClose()} onDone={onDone} />
  return (
    <MrootPortal>
      <div className="qsc-ov qspe-ov" onClick={e => { if (e.target === e.currentTarget && onClose) onClose() }}>
        <div className="qspe-dlg qspe-nbt" role="dialog" aria-modal="true">
          <div className="qspe-head"><h3><QsIcon name="layers" size={16} /> Tạo nhanh biến thể</h3>
            <button type="button" className="qspe-x" onClick={() => onClose && onClose()}>✕</button></div>
          {st.err
            ? <div className="qspe-empty err" role="alert">{st.err}{' '}<button type="button" className="qspe-btn ghost sm" onClick={() => setRetry(n => n + 1)}>Thử lại</button></div>
            : <div className="qspe-empty">Đang tải…</div>}
        </div>
      </div>
    </MrootPortal>
  )
}

function cbSnap_(combo) {
  return combo.map(x => x.recordId + 'x' + (x.comboSL || 1) + ':' + (x.comboGhiChu || '')).join(',')
}

function snapOf_(defs, vals, imgs, combo, bt) {
  return defs.map(d => d.col + '=' + (vals[d.col] || '')).join('|')
    + '||img:' + (imgs.main || '') + ',' + (imgs.list || []).join(',')
    + '||cb:' + cbSnap_(combo)
    + '||bt:' + bt.map(x => x.recordId).join(',')
}

function EditDialog({ p0, md, products, canDuyetProp, onClose, onSaved }) {
  const moi = md !== 'edit'
  const copy = md === 'copy'
  const editKey = (p0.recordId != null && p0.recordId !== '') ? String(p0.recordId) : p0.ma   // id dòng = đúng biến thể
  const [me, setMe] = useState(p0)
  const [ld, setLd] = useState({ phase: 'load', err: '' })
  const [data, setData] = useState(null)          // {raw, hist, histErr, specs, groups, L2C, C2L}
  const [vals, setVals] = useState({})
  const [imgs, setImgs] = useState({ main: '', list: [] })
  const [combo, setCombo] = useState([])
  const [bt, setBt] = useState([])
  const [okRel, setOkRel] = useState({ combo: true, bt: true })
  const [tab, setTab] = useState('combo')
  const [perm, setPerm] = useState(canDuyetProp)
  const [saving, setSaving] = useState('')
  const [nbtOpen, setNbtOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const [ngSel, setNgSel] = useState(null)        // ngành người dùng đổi trong modal (null = giữ ngành hiện có của SP)
  const snapRef = useRef(null)
  const cbSnapRef = useRef('')                     // mốc riêng của sản phẩm đi kèm (số lượng + ghi chú)
  const upN = useRef(0)                           // số ảnh / file đang tải lên (Lưu phải đợi)
  const maRef = useRef(null)
  const imgsRef = useRef(imgs)
  imgsRef.current = imgs
  const busy = useMemo(() => ({ add: d => { upN.current = Math.max(0, upN.current + d) } }), [])

  useEffect(() => {
    const ac = new AbortController(), sig = ac.signal
    let live = true
    setLd({ phase: 'load', err: '' })
    const none = e => (isAbort(e) ? null : { __err: e })
    const loi = () => false                        // false = TẢI LỖI (khác với [] = thật sự không có)
    Promise.all([
      api.getDbProduct(editKey, sig).catch(none), api.getProductHistory(p0.ma, sig).catch(none),
      api.getCombo(editKey, sig).catch(loi), api.getBienThe(editKey, sig).catch(loi),
      loadSpecs().catch(e => ({ __err: e })),
      canDuyetProp === undefined ? api.spMyPerms(sig).catch(() => ({ edit: true, duyet: true })) : Promise.resolve(null),
    ]).then(got => {
      if (!live) return
      const cOk = got[2] !== false, bOk = got[3] !== false
      if (!cOk || !bOk) qsToast('Không tải được ' + [cOk ? '' : 'sản phẩm đi kèm', bOk ? '' : 'nhóm biến thể'].filter(Boolean).join(' và ') + ' — phần này sẽ được GIỮ NGUYÊN khi lưu')
      if (canDuyetProp === undefined) setPerm(got[5] ? !!got[5].duyet : true)
      const raw = got[0] && !got[0].__err ? got[0] : null
      if (!raw) {
        const m = got[0] && got[0].__err ? ' (' + got[0].__err.message + ')' : ''
        setLd({ phase: 'err', err: 'Không tải được dữ liệu sản phẩm.' + m }); return
      }
      const specs = got[4] && !got[4].__err ? got[4] : null
      if (!specs) { setLd({ phase: 'err', err: (got[4] && got[4].__err && got[4].__err.message) || 'Không tải được thông số ngành' }); return }
      const hist = got[1] && got[1].__err ? [] : (got[1] || [])
      const histErr = got[1] && got[1].__err ? got[1].__err.message : ''
      const { DB_LABEL2COL_: L2C, SP_COL2LABEL_: C2L } = dbLabelMaps_(specs)
      // ĐẦY ĐỦ trường, chia nhóm y hệt form Nhập dữ liệu
      const groups = groupsCuaSP_(p0, specs).map(gr => ({ g: gr.g, f: gr.f.map(f => speFieldDef_(f, raw, L2C, specs)).filter(Boolean) })).filter(gr => gr.f.length)
      const v0 = {}
      groups.forEach(gr => gr.f.forEach(d => { v0[d.col] = d.init }))
      if (copy) v0.ma_sp = ''                                  // mã mới: mở khoá, để trống
      // tách anh_sp: ảnh đầu = đại diện, còn lại = ảnh chi tiết/mô tả
      const imgsRaw = String(raw.anh_sp || '').split('\n').map(s => s.trim()).filter(Boolean)
      const i0 = { main: imgsRaw[0] || '', list: imgsRaw.slice(1) }
      const c0 = (got[2] || []).map(cbItem_)   // cbItem_ giữ cả ghi chú liên kết (comboGhiChu, M10.2)
      const b0 = (got[3] || []).map(btItem_)
      setData({ raw, hist, histErr, specs, groups, L2C, C2L })
      setVals(v0); setImgs(i0); setCombo(c0); setBt(b0); setOkRel({ combo: cOk, bt: bOk })
      setTab(b0.length && !c0.length ? 'bt' : 'combo')
      cbSnapRef.current = cbSnap_(c0)
      snapRef.current = snapOf_(groups.flatMap(gr => gr.f), v0, i0, c0, b0)   // mốc so sánh -> đóng mà còn thay đổi thì hỏi lại
      setLd({ phase: 'ok', err: '' })
      if (copy) setTimeout(() => { if (maRef.current) maRef.current.focus() }, 50)
    })
    return () => { live = false; ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])

  const defs = useMemo(() => (data ? data.groups.flatMap(gr => gr.f) : []), [data])
  const ng = useMemo(() => ngSel || nganhCuaSP_(me, data && data.specs), [ngSel, me, data])

  /* Đổi NGÀNH HÀNG (SP nhập nhầm ngành, vd đèn vào thiết bị vệ sinh): dựng lại bộ trường theo ngành mới như form Nhập dữ liệu.
     Ô dùng chung (tên, mã, giá, thương hiệu…) giữ giá trị đang sửa; ô riêng của ngành mới lấy theo dữ liệu đang có trong database.
     Hạng mục không thuộc ngành mới thì để trống để chọn lại. Lưu thì đóng dấu NGÀNH HÀNG mới. */
  function doiNganh(n) {
    if (!data || !n || n === ng) return
    const groups = groupsOfNganh_(n, data.specs).map(gr => ({ g: gr.g, f: gr.f.map(f => speFieldDef_(f, data.raw, data.L2C, data.specs)).filter(Boolean) })).filter(gr => gr.f.length)
    setData(d => ({ ...d, groups }))
    setVals(s => {
      const v = { ...s }
      groups.forEach(gr => gr.f.forEach(d => { if (!Object.prototype.hasOwnProperty.call(v, d.col)) v[d.col] = d.init }))
      const SP = coSpec_(n) ? specNganh_(n, data.specs) : null
      if (SP && !SP.chuanHM(v.hang_muc)) v.hang_muc = ''
      return v
    })
    setNgSel(n)
  }
  // Thiết bị vệ sinh / sơn / công tắc: chỉ hiện thông số của hạng mục đang chọn (vsApplyHM_ với hienHetKhiTrong=1)
  const vsSt = useMemo(() => {
    if (!data || !coSpec_(ng)) return {}
    return vsApply_(vals.hang_muc, ng, defs.filter(d => d.vs).map(d => d.lark), data.specs)
  }, [data, ng, defs, vals.hang_muc])

  function setVal(col, v) {
    setVals(s => {
      const n = { ...s, [col]: v }
      // Giá đại lý = Giá bán lẻ × (1 − CK%) — tính lại ngay (speCalcDaiLy_)
      if ((col === 'gia_ban_le' || col === 'ck_dai_ly_pct') && Object.prototype.hasOwnProperty.call(n, 'gia_dai_ly')) {
        const g = Number(n.gia_ban_le) || 0, ck = Number(n.ck_dai_ly_pct) || 0
        n.gia_dai_ly = g ? String(Math.round(g * (1 - ck / 100))) : ''
      }
      return n
    })
  }

  const dirty = () => snapRef.current != null && data && snapOf_(defs, vals, imgs, combo, bt) !== snapRef.current
  async function close(force) {
    if (saving && !force) return
    // Tải file / thêm ảnh xong mà đóng modal là MẤT -> hỏi lại
    if (!force && dirty()) {
      if (!await qsConfirm({ title: 'Thoát mà chưa lưu?',
        note: 'Có thay đổi chưa lưu (kể cả ảnh / file vừa tải lên). Thoát bây giờ là mất những thay đổi đó.',
        ok: 'Thoát, không lưu', huy: 'Ở lại' })) return
    }
    snapRef.current = null
    if (onClose) onClose()
  }

  const isOff = d => d.vs && vsSt[d.lark] && !vsSt[d.lark].on
  const valOf = col => { const d = defs.find(x => x.col === col); return d ? String(vals[col] == null ? '' : vals[col]) : null }

  async function save(luuVaDuyet) {
    if (!data || saving) return
    // Ô có dấu * (bắt buộc chung hoặc bắt buộc theo hạng mục đang chọn) mà trống -> không lưu
    const thieu = defs.filter(d => {
      if (d.type === 'calc' || d.type === 'doc' || isOff(d)) return false
      const st = d.vs ? vsSt[d.lark] : null
      return (st ? st.star : !!d.req) && !String(vals[d.col] == null ? '' : vals[d.col]).trim()
    })
    if (thieu.length) {
      await qsAlert({ title: 'Chưa nhập đủ trường bắt buộc', ok: 'Đã hiểu', nguyHiem: false,
        note: 'Các ô có dấu * sau đang trống — nhập rồi bấm lưu lại:',
        dong: thieu.map(d => (d.vs && vsSt[d.lark] && vsSt[d.lark].label) || d.label) })
      const el = document.querySelector('.qspe-dlg [data-col="' + thieu[0].col + '"]')
      if (el) el.focus()
      return
    }
    const out = {}
    defs.forEach(d => {
      if (d.col === 'gia_dai_ly') return                      // cột tự tính, không gửi
      const lbl = data.C2L[d.col]; if (!lbl) return
      // thông số KHÔNG thuộc hạng mục đang chọn -> xoá, giữ dữ liệu đúng bộ của hạng mục
      out[lbl] = isOff(d) ? '' : String(vals[d.col] == null ? '' : vals[d.col])
    })
    if (ngSel) out['NGÀNH HÀNG'] = ngSel             // đã đổi ngành trong modal -> SP về đúng đề mục của ngành đó
    setSaving('Đang lưu…')
    if (upN.current > 0) {
      setSaving('⏳ Đợi tải ảnh…')
      const t0 = Date.now()
      while (upN.current > 0 && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 250))
    }
    // gộp ảnh: đại diện (đầu) + chi tiết; bỏ preview base64 chưa upload xong
    const cur = imgsRef.current
    out['ẢNH SẢN PHẨM'] = [cur.main].concat(cur.list || []).filter(Boolean).filter(v => v.indexOf('data:') !== 0).join('\n')
    setSaving('Đang lưu…')
    const lai = () => setSaving('')
    const prods = getState().products || []

    // ── SAO CHÉP thành SP MỚI: bắt buộc mã mới, không trùng
    if (copy) {
      const maMoi = String(out['MÃ SẢN PHẨM'] || '').trim()
      const trungMa = maMoi && prods.some(x => spNorm_(x.ma) === spNorm_(maMoi))
      if (!maMoi || trungMa) {
        lai()
        await qsAlert({ title: maMoi ? 'Mã đã có' : 'Chưa nhập mã mới', ok: 'Đã hiểu', nguyHiem: false,
          note: maMoi ? ('Mã "' + maMoi + '" đã có trong danh sách. Sản phẩm mới cần mã KHÁC; muốn thêm màu / kích thước cho mã này thì dùng "Tạo biến thể".')
            : 'Nhập Mã sản phẩm mới (khác mã gốc) rồi bấm Tạo sản phẩm.' })
        if (maRef.current) maRef.current.focus()
        return
      }
      try {
        const rs = await api.saveDbProduct(out)
        await reloadProducts()
        qsToast('Đã tạo sản phẩm mới ' + maMoi + ' (chép từ ' + (p0.ma || '') + ')')
        if (onSaved) onSaved({ kind: 'copy', key: rs && rs.id != null ? String(rs.id) : maMoi, ma: maMoi, result: rs })
        close(true)
      } catch (e) { qsToast('Lỗi tạo sản phẩm: ' + String(e.message || e).slice(0, 110)); lai() }
      return
    }

    // ── NHÂN BẢN: dòng mới cùng mã. Phải khác ít nhất 1 trục biến thể, nếu không máy chủ GHI ĐÈ dòng gốc
    if (moi) {
      const goc = data.raw || {}
      const khac = BT_TRUC.filter(t => { const v = valOf(t[0]); if (v == null) return false; return v.trim() !== String(goc[t[0]] == null ? '' : goc[t[0]]).trim() })
      if (!khac.length) {
        lai()
        await qsAlert({ title: 'Chưa khác gì so với bản gốc', ok: 'Đã hiểu', nguyHiem: false,
          note: 'Biến thể phải khác bản gốc ít nhất một trong các mục sau, nếu không sẽ ghi đè lên chính sản phẩm cũ:',
          dong: BT_TRUC.map(t => t[1]) })
        return
      }
      // Tổ hợp trục vừa nhập đã thuộc về 1 biến thể KHÁC cùng mã -> máy chủ sẽ GHI ĐÈ biến thể đó. Chặn trước.
      const maMoi = String(out['MÃ SẢN PHẨM'] || '').trim(), chuan = v => String(v == null ? '' : v).trim().toLowerCase()
      const dung = prods.filter(x => !x.spChung && x.ma === maMoi && String(x.recordId) !== String(p0.recordId)
        && BT_TRUC.every(t => { const v = valOf(t[0]); return chuan(v != null ? v : goc[t[0]]) === chuan((x.raw || {})[t[0]]) }))[0]
      if (dung) {
        lai()
        await qsAlert({ title: 'Biến thể này đã có', ok: 'Đã hiểu', nguyHiem: false,
          note: 'Mã ' + maMoi + ' đã có một biến thể đúng các thông số này — lưu sẽ ghi đè lên nó. Đổi ít nhất một mục sau cho khác, hoặc mở biến thể đó ra để sửa:',
          dong: BT_TRUC.map(t => t[1] + ': ' + ((valOf(t[0]) || '').trim() || '(trống)')) })
        return
      }
      try {
        const rn = await api.saveDbProduct(out)
        await reloadProducts()
        qsToast(rn && rn.created ? ('Đã tạo biến thể mới — khác ở: ' + khac.map(t => t[1]).join(', '))
          : 'Đã lưu (máy chủ nhận ra biến thể này đã có nên cập nhật lại)')
        if (onSaved) onSaved({ kind: 'variant', key: rn && rn.id != null ? String(rn.id) : maMoi, ma: maMoi, result: rn })
        close(true)
      } catch (e) { qsToast('Lỗi tạo biến thể: ' + String(e.message || e).slice(0, 110)); lai() }
      return
    }

    // Sửa thành đúng mã + thông số biến thể (màu, kích thước, công suất…) của 1 SP KHÁC -> database từ chối (trùng). Báo trước.
    {
      const goc = data.raw || {}, maMoi = String(out['MÃ SẢN PHẨM'] || p0.ma || '').trim(), chuan = v => String(v == null ? '' : v).trim().toLowerCase()
      const dung = prods.filter(x => !x.spChung && x.ma === maMoi && String(x.recordId) !== String(editKey)
        && BT_TRUC.every(t => { const v = valOf(t[0]); return chuan(v != null ? v : goc[t[0]]) === chuan((x.raw || {})[t[0]]) }))[0]
      if (dung) {
        lai()
        await qsAlert({ title: 'Trùng với biến thể khác', ok: 'Đã hiểu', nguyHiem: false,
          note: 'Mã ' + maMoi + ' đã có một biến thể khác đúng các thông số này ("' + (dung.ten || '') + '"). Đổi ít nhất một mục sau cho khác, hoặc mở biến thể kia ra để sửa:',
          dong: BT_TRUC.map(t => t[1] + ': ' + ((valOf(t[0]) != null ? valOf(t[0]) : String(goc[t[0]] == null ? '' : goc[t[0]])).trim() || '(trống)')) })
        return
      }
    }
    try {
      const r = await api.updateDbProductTracked(editKey, out)
      const relLoi = []
      let cbDaLuu = false
      if (okRel.combo) {
        // liên kết ngược (comboNguoc) chỉ xem: ghi chú thuộc sản phẩm kia -> không gửi, tránh chép sang dòng của mình khi đổi số lượng
        try {
          await api.setCombo(editKey, combo.map(x => ({ id: x.recordId, soLuong: x.comboSL, ghiChu: x.comboNguoc ? '' : String(x.comboGhiChu || '').trim() })))
          clearComboCache()
          cbDaLuu = cbSnap_(combo) !== cbSnapRef.current
        }
        catch (e) { relLoi.push('Lưu sản phẩm đi kèm lỗi: ' + String(e.message || e).slice(0, 90)); qsToast(relLoi[relLoi.length - 1]) }
      }
      if (okRel.bt) {
        try { await api.setBienThe(editKey, bt.map(x => ({ id: x.recordId }))) }
        catch (e) { relLoi.push('Lưu nhóm biến thể lỗi: ' + String(e.message || e).slice(0, 90)); qsToast(relLoi[relLoi.length - 1]) }
      }
      // Bấm "Lưu & duyệt" thì PHẢI duyệt, kể cả khi không có trường nào đổi
      let duyetLoi = ''
      if (luuVaDuyet) {
        try {
          const rd = await api.setSpDuyet([String(editKey)], true)
          // ok=0 kèm daDung>0 nghĩa là SP đã ở trạng thái đã duyệt -> KHÔNG phải lỗi
          if (rd && rd.errors && rd.errors.length) duyetLoi = String(rd.errors[0].error || '').slice(0, 120)
          else if (rd && !rd.ok && !rd.daDung) duyetLoi = 'Máy chủ không đổi được trạng thái duyệt'
        } catch (e) { duyetLoi = String(e.message || e).slice(0, 120) }
      }
      if (duyetLoi) {
        await qsAlert({ title: 'Chưa duyệt được sản phẩm', ok: 'Đã hiểu',
          note: (r && r.updated ? ('Đã lưu ' + r.changes + ' trường nhưng bước duyệt lỗi:\n') : 'Không lưu được trạng thái duyệt:\n') + duyetLoi })
      } else {
        // lỗi lưu combo / biến thể ghép vào thông báo cuối để không bị toast sau che mất
        qsToast(((r && r.updated)
          ? ('Đã cập nhật ' + r.changes + ' trường' + (luuVaDuyet ? ' và duyệt' : (r.daDuyet === false ? ' — sản phẩm chuyển về Chưa duyệt' : '')))
          : (luuVaDuyet ? 'Đã duyệt sản phẩm' : (cbDaLuu ? 'Đã lưu sản phẩm đi kèm' : 'Không có trường nào thay đổi')))
          + (cbDaLuu && ((r && r.updated) || luuVaDuyet) ? ' · đã lưu sản phẩm đi kèm' : '') + (relLoi.length ? ' · ' + relLoi.join(' · ') : ''))
      }
      await reloadProducts()
      if (onSaved) onSaved({ kind: 'update', key: editKey, ma: p0.ma, result: r })
      close(true)
    } catch (e) { qsToast(loiLuu_(e)); lai() }
  }

  const title = copy ? 'Sao chép — tạo sản phẩm mới' : (moi ? 'Nhân bản — tạo biến thể mới' : 'Cập nhật sản phẩm')
  const okText = copy ? 'Tạo sản phẩm' : (moi ? 'Tạo biến thể' : 'Lưu cập nhật')
  const hist = data ? data.hist : []

  function field(d) {
    const v = vals[d.col] == null ? '' : String(vals[d.col])
    const st = d.vs ? vsSt[d.lark] : null
    const label = st && st.label ? st.label : d.label
    const star = st ? st.star : !!d.req
    const lab = <label>{label}{star ? <> <span className="qspe-req">*</span></> : null}</label>
    if (d.type === 'doc') {
      return <div className="qspe-f wide qspe-docfield" key={d.col}><label>{d.label}</label>
        <DocField value={v} onChange={x => setVal(d.col, x)} busy={busy} /></div>
    }
    const wrapStyle = st ? { display: st.on ? '' : 'none', order: st.on ? st.order : '' } : undefined
    let inner
    if (d.type === 'hm') {
      inner = (
        <select data-col={d.col} value={v} onChange={async e => {
          const x = e.target.value
          if (x !== '__khac__') { setVal(d.col, x); return }
          // "Khác — tự điền": hạng mục chưa có trong danh sách (vd Remote) - SP vẫn thuộc ngành hiện tại, không có bộ thông số riêng
          const r = await qsAsk({ title: 'Hạng mục khác', label: 'Tên hạng mục', placeholder: 'VD: Remote', value: d.opts.indexOf(v) < 0 ? v : '', ok: 'Dùng hạng mục này' })
          const t = String((r && r.v != null ? r.v : r) || '').trim()
          if (t) setVal(d.col, t)
        }}>
          <option value="">— Chọn hạng mục —</option>
          {d.opts.map(o => <option key={o} value={o}>{o}</option>)}
          {v && d.opts.indexOf(v) < 0 ? <option value={v}>{v} (tự điền)</option> : null}
          <option value="__khac__">＋ Khác — tự điền…</option>
        </select>
      )
    } else if (d.type === 'area') {
      inner = <textarea data-col={d.col} placeholder={d.ph} value={v} onChange={e => setVal(d.col, e.target.value)} />
    } else if (d.type === 'calc') {
      inner = <input data-col={d.col} className="calc" value={v} readOnly placeholder="Tự tính từ giá bán & %CK" />
    } else if (d.type === 'sel') {
      const opts = st ? (st.opts || []) : d.opts
      inner = <>
        <input data-col={d.col} list={'qspe_dl_' + d.col} value={v} placeholder={d.ph} onChange={e => setVal(d.col, e.target.value)} />
        <datalist id={'qspe_dl_' + d.col}>{opts.map(o => <option key={o} value={o} />)}</datalist>
      </>
    } else {
      const isMa = d.lark === 'MÃ SẢN PHẨM'
      inner = <input type={d.type === 'num' ? 'number' : 'text'} data-col={d.col} value={v}
        ref={isMa ? maRef : undefined} readOnly={isMa && !copy}
        placeholder={isMa && copy ? 'Mã mới, VD: ' + (p0.ma || '') + '-2' : d.ph}
        onChange={e => setVal(d.col, e.target.value)} />
    }
    return <div className={'qspe-f' + (d.type === 'area' ? ' wide' : '') + (st && !st.on ? ' qspe-vs-off' : '')} key={d.col}
      data-vs={d.vs ? d.lark : undefined} style={wrapStyle}>{lab}{inner}</div>
  }

  return (
    <MrootPortal>
      <div className="qsc-ov qspe-ov" onClick={e => { if (e.target === e.currentTarget) close() }}>
        <div className="qspe-dlg qspe-edit" role="dialog" aria-modal="true">
          <div className="qspe-head">
            <h3><QsIcon name={moi ? 'plus' : 'edit'} size={16} /> {title}</h3>
            <button type="button" className="qspe-x" onClick={() => close()}>✕</button>
          </div>
          <div className="qspe-2col">
            <div className="qspe-body">
              {ld.phase === 'load' && <div className="qspe-empty">Đang tải…</div>}
              {ld.phase === 'err' && (
                <div className="qspe-empty err" role="alert">{ld.err}{' '}
                  <button type="button" className="qspe-btn ghost sm" onClick={() => setRetry(n => n + 1)}>Thử lại</button></div>
              )}
              {ld.phase === 'ok' && data && <>
                {copy ? (
                  <div className="qspe-note-new"><QsIcon name="bell" size={14} />
                    <span>Đang tạo <b>sản phẩm mới</b> từ <b>{p0.ma || ''}</b> — nhập <b>Mã sản phẩm mới</b> (không trùng mã có sẵn), sửa tên / thông số rồi bấm Tạo sản phẩm.</span></div>
                ) : moi ? (
                  <div className="qspe-note-new"><QsIcon name="bell" size={14} />
                    <span>Đang tạo <b>biến thể mới</b> cho mã <b>{p0.ma || ''}</b> — đổi phần khác biệt ({BT_TRUC.map(t => t[1]).join(' · ')}) rồi bấm Tạo biến thể.</span></div>
                ) : null}
                <div className="qspe-grp qspe-nganh">
                  <div className="qspe-grp-h">Ngành hàng</div>
                  <div className="qspe-fields">
                    <div className="qspe-f"><label>Ngành hàng</label>
                      <select value={ng === 'den' || !coSpec_(ng) ? 'den' : ng} onChange={e => doiNganh(e.target.value)}>
                        {IMP_LOAI.filter(x => x[0] !== 'pt').map(x => <option key={x[0]} value={x[0] === 'sp' ? 'den' : x[0]}>{x[1].split(' · ')[0]}</option>)}
                      </select></div>
                    <div className="qspe-nganh-note">{ngSel
                      ? <>Đã đổi ngành — các ô bên dưới đã chuyển sang bộ trường của ngành này. Chọn lại <b>Hạng mục</b> nếu đang trống, rồi lưu.</>
                      : 'Nhập nhầm ngành? Chọn đúng ngành ở đây, các ô thông số tự chuyển theo ngành đó.'}</div>
                  </div>
                </div>
                <ImgUpBlock imgs={imgs} setImgs={setImgs} busy={busy} />
                {data.groups.map(gr => (
                  <div className="qspe-grp" key={gr.g}>
                    <div className="qspe-grp-h">{gr.g}</div>
                    <div className="qspe-fields">{gr.f.map(field)}</div>
                  </div>
                ))}
                {!moi && (
                  <RelatedBox me={me} products={products} specs={data.specs} combo={combo} setCombo={setCombo}
                    bt={bt} setBt={setBt} tab={tab} setTab={setTab} onQuickVariants={() => setNbtOpen(true)} />
                )}
                <div className="qspe-actions">
                  <button type="button" className="qspe-btn ghost sm" onClick={() => close()}>Huỷ</button>
                  {!moi && perm !== false && (
                    <button type="button" className="qspe-btn ghost sm" disabled={!!saving} onClick={() => save(1)} title="Lưu thay đổi rồi đánh dấu Đã duyệt">
                      <QsIcon name="check" size={14} /> Lưu &amp; duyệt</button>
                  )}
                  <button type="button" className="qspe-btn blue" disabled={!!saving} onClick={() => save()}>
                    {saving || <><QsIcon name="check" size={15} /> {okText}</>}</button>
                </div>
              </>}
            </div>
            <aside className="qspe-side">
              {ld.phase === 'ok' && data && <>
                <div className="qspe-who">
                  <span><QsIcon name="plus" size={13} /> Tạo bởi <b>{p0.nguoiTao || '—'}</b>{p0.ngayTao ? ' · ' + fmtDate(p0.ngayTao) : ''}</span>
                  <span><QsIcon name="edit" size={13} /> Sửa cuối bởi <b>{p0.nguoiSua || '—'}</b>{p0.ngayCapNhat ? ' · ' + fmtDateTime_(p0.ngayCapNhat) : ''}</span>
                  {p0.daDuyet
                    ? <span className="ok"><QsIcon name="check" size={13} /> Duyệt bởi <b>{p0.nguoiDuyet || '—'}</b>{p0.ngayDuyet ? ' · ' + fmtDateTime_(p0.ngayDuyet) : ''}</span>
                    : <span className="warn"><QsIcon name="clock" size={13} /> Chưa duyệt</span>}
                </div>
                <div className="qspe-hist">
                  <div className="qspe-hist-h"><QsIcon name="clock" size={15} /> Lịch sử cập nhật <span className="qspe-hist-n">{hist.length}</span></div>
                  <div className="qspe-hist-list">
                    {data.histErr ? <div className="qspe-empty err" style={{ padding: 14, fontSize: 12.5 }} role="alert">Không tải được lịch sử cập nhật: {data.histErr}</div>
                      : hist.length ? hist.map((h, i) => (
                        <div className="qspe-h" key={i}>
                          <div className="qspe-h-top"><b>{h.field}</b><span className="qspe-h-by"><QsIcon name="clock" size={11} /> {(h.by || '?') + ' · ' + fmtDateTime_(h.at)}</span></div>
                          <div className="qspe-h-diff"><span className="old">{h.old || '—'}</span><span className="arr">→</span><span className="new">{h.new || '—'}</span></div>
                        </div>
                      )) : <div className="qspe-empty" style={{ padding: 14, fontSize: 12.5 }}>Chưa có lịch sử cập nhật.</div>}
                  </div>
                </div>
              </>}
            </aside>
          </div>
        </div>
      </div>
      {nbtOpen && (
        <QuickVariantsModal product={me} specs={data && data.specs} onClose={() => setNbtOpen(false)}
          onDone={r => {
            // form Cập nhật đang mở: cập nhật danh sách nhóm ngay, nếu không bấm "Lưu cập nhật" sẽ ghi đè mất biến thể mới
            if (r && r.nhomBT && r.btNhom) { setMe(m => ({ ...m, nhomBT: r.nhomBT })); setBt(r.btNhom) }
          }} />
      )}
    </MrootPortal>
  )
}
