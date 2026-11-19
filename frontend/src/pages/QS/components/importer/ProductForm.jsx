import { useMemo, useRef, useState } from 'react'
import QsIcon from '../common/QsIcon'
import StatusView from '../common/StatusView'
import { useQs } from '../../state/QsData'
import { useQsStore } from '../../state/store'
import { coSpec_, nganhCuaSP_ } from '../../lib/productFields'
import { money } from '../../lib/format'
import { mediaUrl } from '../../api/files'
import ImgUpBlock from './ImgUpBlock'
import DocField from './DocField'
import BulkImport from './BulkImport'
import DbCard from './DbCard'
import '../products/list/list.css'
import { useImp, impForm } from './importStore'
import GhiPicker from './GhiPicker'
import { impGroups_, vsApply_, dbCalcDaiLy_, tdSave_ } from './importLogic'
import VariantTable from '../common/VariantTable'
import { varCols_ } from '../../lib/variants'
import { pendingEditCancel_, impCbAdd_, impCbDel_, impCbSL_, impCbSearch_, cbLbl_ } from './importActions'

/* Cột trái tab Nhập dữ liệu (port renderImport / dbInput / dbCard_ / vsApplyHM_ / impCbRender_ / varPreview_, PUB/nhap.js:151-164,
   259-284, 455-459, 767-870). Giá trị form nằm ở importStore (giữ khi rời tab). Props: specs (null khi chưa nạp), specErr, onRetrySpecs. */
const DB_GICON = { 'Tài liệu': 'doc', 'Thông tin cơ bản': 'tag', 'Thông tin giá bán': 'money', 'Key Product Info (Thông tin chính)': 'bulb',
  'Thông số thiết kế': 'ruler', 'Performance Specifications (Thông số hiệu suất)': 'gauge', 'Driver (Nguồn LED / Chấn lưu)': 'plug',
  'Installation Specifications (Thông số lắp đặt)': 'wrench', 'Thương mại': 'sliders' }

const Star = () => <> <span className="qsi-req">*</span></>

/* Một ô theo kiểu trường của bản gốc: text / num / calc / area / doc / hm / sel. f = [cột Lark, nhãn, kiểu, bắt buộc, lựa chọn, gợi ý, 'vs'] */
/* Thương hiệu / Nhà cung cấp: gợi ý từ giá trị đã có trong danh mục; gõ khác hoa / thường / dấu cách so với 1 giá trị đã có
   thì tự đổi về đúng chính tả đó khi rời ô (đồng bộ chính tả); chưa có thì giữ nguyên = tạo mới. */
const GOI_Y = { 'THƯƠNG HIỆU': 'thuongHieu', 'NHÀ CUNG CẤP': 'ncc' }
const khoaTen_ = v => String(v || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
function DbField({ f, idx, vals, vs, goiY, maCo }) {
  const lark = f[0], label = f[1], type = f[2], opts = f[4] || [], ph = f[5] || label
  const val = vals[lark] == null ? '' : vals[lark]
  const set = v => impForm(F => ({ vals: { ...F.vals, [lark]: typeof v === 'function' ? v(F.vals[lark] || '') : v } }))
  const isVs = f[6] === 'vs'
  const req = isVs ? (vs.SPEC && vs.hm && vs.SPEC.isReq(vs.hm, lark)) : f[3]
  let inner
  if (type === 'calc') inner = <input className="qsi-calc" type="number" placeholder="Tự tính từ giá bán & %CK" readOnly value={dbCalcDaiLy_(vals)} />
  else if (type === 'area') inner = <textarea placeholder={label} style={{ minHeight: 54 }} value={val} onChange={e => set(e.target.value)} />
  else if (type === 'doc') inner = <DocField value={val} onChange={set} />
  else if (type === 'hm') {
    // "Khác — tự điền": hạng mục chưa có trong danh sách (vd Remote máy lạnh) -> gõ tên; SP vẫn thuộc ngành đang nhập
    const tuDien = val !== '' && opts.indexOf(val) < 0
    inner = (
      <>
        <select value={tuDien || vals.__hmKhac ? '__khac__' : val} onChange={e => {
          const v = e.target.value
          if (v === '__khac__') impForm(F => ({ vals: { ...F.vals, __hmKhac: 1, [lark]: opts.indexOf(F.vals[lark] || '') >= 0 ? '' : (F.vals[lark] || '') } }))
          else impForm(F => ({ vals: { ...F.vals, __hmKhac: 0, [lark]: v } }))
        }}>
          <option value="">— Chọn hạng mục —</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
          <option value="__khac__">＋ Khác — tự điền…</option>
        </select>
        {(tuDien || vals.__hmKhac) ? <input className="qsi-hm-khac" autoFocus={!val} placeholder="Gõ tên hạng mục, vd: Remote" value={val} onChange={e => set(e.target.value)} /> : null}
      </>
    )
  } else if (type === 'sel') {
    // ô thông số theo hạng mục: danh sách chọn đổi theo hạng mục (vsApplyHM_)
    const list = isVs ? (vs.SPEC && vs.hm ? vs.SPEC.optsOf(vs.hm, lark) : []) : opts
    inner = (
      <>
        <input list={'qsi-dl-' + idx} placeholder={isVs ? (ph || label) : label} value={val} onChange={e => set(e.target.value)} />
        <datalist id={'qsi-dl-' + idx}>{list.map(o => <option key={o} value={o} />)}</datalist>
      </>
    )
  } else if (goiY && goiY[lark]) {
    // ds = gợi ý hiện ra (Thương hiệu: chỉ của ngành đang chọn); all = mọi giá trị đã có (đồng bộ chính tả, báo "Mới")
    const { ds, all } = goiY[lark], k = khoaTen_(val), co = k && all.some(x => khoaTen_(x) === k && x === val.trim())
    inner = (
      <>
        <input list={'qsi-gy-' + idx} placeholder={ph} value={val} onChange={e => set(e.target.value)}
          onBlur={() => { const m = all.filter(x => khoaTen_(x) === khoaTen_(val))[0]; if (m && m !== val) set(m) }} />
        <datalist id={'qsi-gy-' + idx}>{ds.map(o => <option key={o} value={o} />)}</datalist>
        {val.trim() && !co && !all.some(x => khoaTen_(x) === k) ? <small className="qsi-gy-new">Mới — chưa có trong danh mục, sẽ tạo thêm</small> : null}
      </>
    )
  } else if (lark === 'MÃ SẢN PHẨM' && maCo) {
    // báo đỏ mã đã có trong Database; trùng cả NCC = dữ liệu trùng
    const co = maCo[khoaTen_(val)] || [], nccK = khoaTen_(vals['NHÀ CUNG CẤP'])
    const cungNcc = co.filter(p => khoaTen_(p.ncc) === nccK)
    inner = (
      <>
        <input className={co.length ? 'qsi-trung' : ''} placeholder={ph} value={val} onChange={e => set(e.target.value)} />
        {co.length ? <small className="qsi-trung-m">{cungNcc.length ? 'Trùng mã + NCC: ' : 'Mã đã có: '}
          {(cungNcc.length ? cungNcc : co).slice(0, 2).map(p => '"' + p.ten + '"' + (p.ncc ? ' (' + p.ncc + ')' : '')).join(', ')}
          {co.length > 2 ? ' và ' + (co.length - 2) + ' SP khác' : ''}</small> : null}
      </>
    )
  } else inner = <input type={type === 'num' ? 'number' : 'text'} placeholder={ph} value={val} onChange={e => set(e.target.value)} />
  return (
    <div className={'qsi-field' + (type === 'doc' ? ' qsi-docfield' : '')}>
      <label>{isVs && vs.SPEC ? vs.SPEC.METRIC[lark][1] : label}{req ? <Star /> : null}</label>
      {inner}
    </div>
  )
}

function ComboCard({ form, loai, specs }) {
  const { products } = useQs()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ds = form.combo || []
  const sug = open ? impCbSearch_(q, loai, form.vals['HẠNG MỤC'], ds, products, specs) : null
  return (
    <DbCard title="Sản phẩm đi kèm (combo)" ic="layers" note="Chọn các sản phẩm luôn bán / lắp cùng sản phẩm này (VD bồn cầu + nắp rửa + vòi xịt). Lưu cùng lúc khi bấm Thêm sản phẩm.">
      <div className="qsi-cb-find">
        <input placeholder="Tìm theo tên, mã hoặc thương hiệu…" autoComplete="off" value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {sug && (
          <div className="qsi-cb-sug-box">
            {sug.hit.length ? (
              <>
                {sug.tieuDe && <div className="qsi-cb-sug-h">{sug.tieuDe}</div>}
                {sug.hit.map(p => {
                  const lbl = cbLbl_(p, specs), im = String(p.hinhAnh || '').split('\n')[0].trim()
                  return (
                    <button key={p.recordId} className="qsi-cb-sug" onMouseDown={e => e.preventDefault()}
                      onClick={() => { if (impCbAdd_(p)) setQ('') }}>
                      {im ? <img src={mediaUrl(im)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="qsi-cb-img" />}
                      <span className="qsi-cb-sug-nm">{p.ten || ''}<i>{(p.ma || '') + (lbl ? ' · ' + lbl : '') + (p.donGiaBan ? ' · ' + money(p.donGiaBan) + 'đ' : '')}</i></span>
                    </button>
                  )
                })}
              </>
            ) : <div className="qsi-cb-empty">Không tìm thấy sản phẩm khớp.</div>}
          </div>
        )}
      </div>
      <div className="qsi-cb-list">{ds.length ? ds.map((x, i) => {
        const im = String(x.hinhAnh || '').split('\n')[0].trim()
        return (
          <div className="qsi-cb-item" key={String(x.recordId)}>
            {im ? <img className="qsi-cb-img" src={mediaUrl(im)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="qsi-cb-img" />}
            <div className="qsi-cb-info"><div className="qsi-cb-nm" title={x.ten || ''}>{x.ten || ''}</div>
              <div className="qsi-cb-sub">{(x.ma || '') + (x.donGiaBan ? ' · ' + money(x.donGiaBan) + 'đ' : '')}</div></div>
            <label className="qsi-cb-sl" title="Số lượng đi kèm cho mỗi sản phẩm chính">×<input type="number" min="1" step="1" value={Number(x.comboSL) || 1} onChange={e => impCbSL_(i, e.target.value)} /></label>
            <button className="qsi-cb-del" title="Bỏ khỏi combo" onClick={() => impCbDel_(i)}><QsIcon name="x" size={14} /></button>
          </div>
        )
      }) : (
        <div className="qsi-cb-empty">Chưa chọn sản phẩm đi kèm — gõ tên / mã ở ô trên{loai === 'vs' ? ', hoặc bấm vào ô để xem gợi ý theo hạng mục' : ''}.</div>
      )}</div>
    </DbCard>
  )
}

/* Biến thể: bảng mỗi dòng 1 biến thể (VariantTable) - trục theo ngành, Mã / Giá / Ảnh riêng; ô trống = theo giá trị chung ở trên */
function VarCard({ form, loai, vs }) {
  const cols = varCols_(loai, vs && vs.SPEC, vs && vs.hm)
  return (
    <DbCard title="Biến thể (tuỳ chọn)" ic="sliders" note="Mỗi dòng = 1 sản phẩm (cùng tên, thông số chung ở trên). Ô để trống dùng giá trị chung; mỗi biến thể có Mã, Giá, Ảnh riêng.">
      <VariantTable cols={cols} rows={form.varRows || []} onChange={fn => impForm(F => ({ varRows: fn(F.varRows || []) }))}
        maGoc={form.vals['MÃ SẢN PHẨM'] || ''} giaGoc={form.vals['GIÁ BÁN LẺ'] || ''} />
    </DbCard>
  )
}

function GhiCard({ form, projSelRef }) {
  return (
    <DbCard title="Ghi danh vào dự án" ic="building" note="Tuỳ chọn — đưa sản phẩm này vào một hoặc nhiều dự án ngay sau khi lưu vào Database.">
      <GhiPicker g={form.ghi} projSelRef={projSelRef} put={fn => impForm(F => ({ ghi: fn(F.ghi) }))} />
    </DbCard>
  )
}

export default function ProductForm({ specs, specErr, onRetrySpecs }) {
  const form = useImp(s => s.form)
  const { products: dsSP } = useQs()
  const loai = useImp(s => s.loai)
  /* danh sách Thương hiệu / NCC đã có (không trùng theo chữ thường), xếp theo chữ cái. Thương hiệu chỉ GỢI Ý của ngành đang chọn
     (SP cùng ngành, nganhCuaSP_); ngành chưa có SP nào thì gợi ý tất cả. Gõ thương hiệu mới vẫn được. */
  const goiY = useMemo(() => {
    const o = {}
    const ds_ = arr => { const m = {}; arr.forEach(p => { const v = String(p || '').trim(); if (v && !m[khoaTen_(v)]) m[khoaTen_(v)] = v }); return Object.values(m).sort((a, b) => a.localeCompare(b, 'vi')) }
    const cungNganh = loai && loai !== 'pt' ? (dsSP || []).filter(p => nganhCuaSP_(p, specs) === (loai === 'sp' ? 'den' : loai)) : []   // 'sp' = ngành đèn
    Object.keys(GOI_Y).forEach(lb => {
      const all = ds_((dsSP || []).map(p => p[GOI_Y[lb]]))
      const rieng = lb === 'THƯƠNG HIỆU' ? ds_(cungNganh.map(p => p[GOI_Y[lb]])) : []
      o[lb] = { all, ds: rieng.length ? rieng : all }
    })
    return o
  }, [dsSP, loai, specs])
  const maCo = useMemo(() => {
    const m = {}
    ;(dsSP || []).forEach(p => { const k = khoaTen_(p.ma); if (k) (m[k] = m[k] || []).push(p) })
    return m
  }, [dsSP])
  const pendEdit = useImp(s => s.pendEdit)
  const onTab = useQsStore(s => s.tab) === 'import'
  const [btn, setBtnSt] = useState({ dis: false, text: '' })
  const projSelRef = useRef(null)
  const rootRef = useRef(null)
  const groups = impGroups_(loai, specs)
  const thieuSpec = coSpec_(loai) && !specs
  const vs = coSpec_(loai) && specs ? vsApply_(form.vals['HẠNG MỤC'] || '', loai, specs) : { SPEC: null, hm: '', cho: [] }
  const acc = {
    main: form.imgMain, list: form.imgList,
    put: fn => impForm(F => { const r = fn({ main: F.imgMain, list: F.imgList }); return { imgMain: r.main, imgList: r.list } }),
  }
  const setBtn = (dis, text) => setBtnSt({ dis, text })
  const save = async () => {
    const r = await tdSave_(specs, setBtn)
    if (r === 'focusProj' && projSelRef.current) projSelRef.current.focus()
  }
  let idx = 0
  return (
    <div className="qsi-dbwrap" ref={rootRef}>
      <ImgUpBlock key={form.seq} acc={acc} active={onTab} />
      {thieuSpec && (
        <div className="qsi-dbcard"><div className="qsi-dbcard-b">
          {/* StatusView đã in tiêu đề "Không tải được thông số ngành": chỉ truyền phần còn lại (tên file) để khỏi lặp chữ */}
          {specErr ? <StatusView kind="specsMissing" message={specErr.replace(/^Không tải được thông số ngành\s*\(?([^)]*)\)?$/, '$1')} onRetry={onRetrySpecs} /> : <StatusView kind="loading" />}
        </div></div>
      )}
      {groups.map(gr => {
        const base = idx; idx += gr.f.length
        let fs = gr.f.map((f, k) => [f, base + k])
        if (gr.vs) fs = fs.filter(x => vs.cho.indexOf(x[0][0]) >= 0).sort((a, b) => vs.cho.indexOf(a[0][0]) - vs.cho.indexOf(b[0][0]))
        return (
          <DbCard key={gr.g} title={gr.g} ic={DB_GICON[gr.g] || 'doc'} note={gr.note}>
            {gr.vs && !vs.hm ? <div className="qsi-vs-empty qsi-dbnote">{String(form.vals['HẠNG MỤC'] || '').trim()
              ? <>Hạng mục tự điền <b>{form.vals['HẠNG MỤC']}</b> chưa có bộ thông số riêng — ghi thông số vào <b>Tính năng</b> / <b>Ghi chú</b>.</>
              : <>Chọn <b>Hạng mục</b> ở phần Thông tin cơ bản để hiện đúng thông số của hạng mục đó.</>}</div> : null}
            <div className="qsi-dbgrid">{fs.map(([f, i]) => <DbField key={f[0]} f={f} idx={i} vals={form.vals} vs={vs} goiY={goiY} maCo={maCo} />)}</div>
          </DbCard>
        )
      })}
      <ComboCard form={form} loai={loai} specs={specs} />
      <VarCard form={form} loai={loai} vs={vs} />
      <GhiCard form={form} projSelRef={projSelRef} />
      {pendEdit ? (
        <div className="qsi-savebar">
          <div className="qsi-pe-note"><QsIcon name="edit" size={14} /> Đang sửa 1 sản phẩm trong danh sách chờ — chỉnh xong bấm <b>Cập nhật</b></div>
          <button className="qsi-btn qsi-blue qsi-block" disabled={btn.dis || thieuSpec} onClick={save}>{btn.text || <><QsIcon name="check" size={15} /> Cập nhật vào danh sách chờ</>}</button>
          <button className="qsi-btn qsi-sm" onClick={pendingEditCancel_}>Huỷ sửa</button>
        </div>
      ) : (
        <div className="qsi-savebar">
          <button className="qsi-btn qsi-blue qsi-block" disabled={btn.dis || thieuSpec} onClick={save}>{btn.text || 'Đưa vào danh sách chờ'}</button>
          <button className="qsi-btn qsi-sm" onClick={pendingEditCancel_}>Xoá form</button>
        </div>
      )}
      <BulkImport specs={specs} loai={loai} hmVal={form.vals['HẠNG MỤC'] || ''} />
    </div>
  )
}
