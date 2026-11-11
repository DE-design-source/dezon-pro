import { useMemo, useRef, useState } from 'react'
import QsIcon from '../common/QsIcon'
import StatusView from '../common/StatusView'
import { useQs } from '../../state/QsData'
import { useQsStore } from '../../state/store'
import { coSpec_ } from '../../lib/productFields'
import { money } from '../../lib/format'
import { mediaUrl } from '../../api/files'
import ImgUpBlock from './ImgUpBlock'
import DocField from './DocField'
import BulkImport from './BulkImport'
import DbCard from './DbCard'
import '../products/list/list.css'
import { useImp, impForm } from './importStore'
import GhiPicker from './GhiPicker'
import { impGroups_, vsApply_, dbCalcDaiLy_, tdSave_, varCombos_, btLabel_ } from './importLogic'
import { upFilesSeq_, pickFiles_ } from './imgUpload'
import { pendingEditCancel_, impCbAdd_, impCbDel_, impCbSL_, impCbSearch_, cbLbl_, varPreview_ } from './importActions'

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
    const ds = goiY[lark], k = khoaTen_(val), co = k && ds.some(x => khoaTen_(x) === k && x === val.trim())
    inner = (
      <>
        <input list={'qsi-gy-' + idx} placeholder={ph} value={val} onChange={e => set(e.target.value)}
          onBlur={() => { const m = ds.filter(x => khoaTen_(x) === khoaTen_(val))[0]; if (m && m !== val) set(m) }} />
        <datalist id={'qsi-gy-' + idx}>{ds.map(o => <option key={o} value={o} />)}</datalist>
        {val.trim() && !co && !ds.some(x => khoaTen_(x) === k) ? <small className="qsi-gy-new">Mới — chưa có trong danh mục, sẽ tạo thêm</small> : null}
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

function VarCard({ form, loai }) {
  const v = form.vars
  const inp = (key, label, ph) => (
    <div className="qsi-field"><label>{label}</label>
      <input placeholder={ph} value={v[key] || ''} onChange={e => impForm(F => ({ vars: { ...F.vars, [key]: e.target.value } }))} /></div>
  )
  // chỉ xem trước các ô đang hiện theo ngành
  const shown = { varKelvin: '', varWatt: '', varAngle: '', varColor: v.varColor, varSize: '' }
  if (loai === 'son' || loai === 'vs' || loai === 'gach') shown.varSize = v.varSize
  else if (loai !== 'ct' && loai !== 'dl') { shown.varKelvin = v.varKelvin; shown.varWatt = v.varWatt; shown.varAngle = v.varAngle }
  const pv = varPreview_(shown)
  return (
    <DbCard title="Nhập biến thể (tuỳ chọn)" ic="sliders" note="Nhập nhiều giá trị cách nhau bằng dấu phẩy — hệ thống tạo 1 sản phẩm cho MỖI tổ hợp (cùng mã SP, khác thông số).">
      <div className="qsi-dbgrid">
        {/* Ba trục nhiệt độ / công suất / góc chỉ có nghĩa với ĐÈN */}
        {loai === 'ct' || loai === 'dl' ? null : loai === 'son' ? inp('varSize', 'Quy cách (dung tích)', 'VD: 1L, 5L, 18L')
          : loai === 'vs' ? inp('varSize', 'Kích thước', 'VD: L580 x W380, L620 x W390')
            : loai === 'gach' ? inp('varSize', 'Kích thước', 'VD: 600 x 600 (mm), 600 x 1200 (mm)')
            : <>{inp('varKelvin', 'Nhiệt độ màu (K)', 'VD: 3000, 4000, 6500')}{inp('varWatt', 'Công suất (W)', 'VD: 7, 9, 12')}{inp('varAngle', 'Góc chiếu (°)', 'VD: 24, 36, 60')}</>}
        {inp('varColor', 'Màu sắc', 'VD: Đen, Trắng, Vàng')}
      </div>
      {pv ? (
        <div className="qsi-var-note qsi-on">
          <div className="qsi-var-math">{pv.parts.map((p, i) => <span key={i}>{i ? <> <b>×</b> </> : null}{p}</span>)} <b>=</b> <span className="qsi-var-total">{pv.total} sản phẩm</span></div>
          <div className="qsi-var-list">{pv.chips.map((c, i) => <span className="qsi-var-chip" key={i}>{c}</span>)}{pv.more ? <i> … +{pv.more} nữa</i> : null}</div>
        </div>
      ) : <div className="qsi-var-note">Bỏ trống = chỉ tạo 1 sản phẩm theo thông số đã nhập ở trên.</div>}
      <VarImgs labels={pv ? varCombos_(shown).map(btLabel_) : []} imgs={form.varImg || {}} meta={form.varMeta || {}}
        maGoc={form.vals['MÃ SẢN PHẨM'] || ''} giaGoc={form.vals['GIÁ BÁN LẺ'] || ''} />
    </DbCard>
  )
}

/* Bảng biến thể: mỗi tổ hợp 1 dòng Ảnh · Mã SP · Giá bán lẻ (form.varImg / form.varMeta theo nhãn biến thể).
   Khi Đưa vào danh sách chờ (tdSave_): ảnh thành hình đại diện của SP biến thể; mã / giá để trống thì theo mã / giá chung ở trên.
   ponytail: hiện tối đa 60 dòng; nhiều hơn thì cần lọc theo trục (vd chỉ theo màu) */
const VAR_IMG_MAX = 60
function VarImgs({ labels, imgs, meta, maGoc, giaGoc }) {
  const acc = lb => ({
    main: imgs[lb] || '', list: [],
    put: fn => impForm(F => { const v = F.varImg || {}, nx = fn({ main: v[lb] || '', list: [] }); return { varImg: { ...v, [lb]: nx.main } } }),
  })
  const setMeta = (lb, k, val) => impForm(F => { const m = F.varMeta || {}; return { varMeta: { ...m, [lb]: { ...(m[lb] || {}), [k]: val } } } })
  const drop = (e, lb) => {
    e.preventDefault()
    const fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []).filter(f => !f.type || /^image\//.test(f.type))
    if (fs.length) upFilesSeq_('main', fs.slice(0, 1), acc(lb))
  }
  const addUrl = lb => {
    const u = window.prompt('Dán link ảnh cho biến thể "' + lb + '"')
    if (u && u.trim()) acc(lb).put(s => ({ ...s, main: u.trim() }))
  }
  const ds = labels.slice(0, VAR_IMG_MAX)
  if (!labels.length) return (
    <div className="qsi-varimg">
      <div className="qsi-varimg-h"><b>Biến thể</b> <span>(tuỳ chọn) — nhập giá trị biến thể ở các ô trên (VD Màu sắc: Đen, Trắng), mỗi biến thể sẽ có 1 dòng để nhập Ảnh · Mã sản phẩm · Giá riêng.</span></div>
    </div>
  )
  return (
    <div className="qsi-varimg">
      <div className="qsi-varimg-h"><b>Biến thể ({labels.length})</b> <span>— mỗi dòng 1 sản phẩm. Ảnh, Mã, Giá để trống thì dùng ảnh / mã / giá chung ở trên.</span></div>
      <div className="qsi-vartbl">
        <div className="qsi-vartbl-r qsi-vartbl-h"><span>Ảnh</span><span>Biến thể</span><span>Mã sản phẩm</span><span>Giá bán lẻ (đ)</span></div>
        {ds.map(lb => {
          const v = imgs[lb] || '', m = meta[lb] || {}
          return (
            <div className="qsi-vartbl-r" key={lb}>
              <div className="qsi-varimg-cell">
                <div className={'qsi-upzone qsi-varimg-box' + (v ? ' qsi-has' : '')} tabIndex={0} title={v ? 'Bấm để đổi ảnh' : 'Bấm hoặc kéo ảnh vào'}
                  onClick={() => pickFiles_(false, 'image/*', fs => upFilesSeq_('main', fs, acc(lb)))}
                  onDragOver={e => e.preventDefault()} onDrop={e => drop(e, lb)}>
                  {v ? <img src={mediaUrl(v)} alt="" /> : <QsIcon name="camera" size={16} />}
                  {v ? <button className="qsi-upx" title="Bỏ ảnh" onClick={e => { e.stopPropagation(); acc(lb).put(s => ({ ...s, main: '' })) }}>✕</button> : null}
                </div>
                <button type="button" className="qsi-varimg-link" onClick={() => addUrl(lb)}>Dán link</button>
              </div>
              <div className="qsi-vartbl-lb" title={lb}>{lb}</div>
              <input value={m.ma || ''} placeholder={maGoc || 'Mã riêng (tuỳ chọn)'} onChange={e => setMeta(lb, 'ma', e.target.value)} />
              <input className="num" inputMode="numeric" value={m.gia || ''} placeholder={giaGoc ? money(giaGoc) : 'Giá riêng (tuỳ chọn)'} onChange={e => setMeta(lb, 'gia', e.target.value)} />
            </div>
          )
        })}
        {labels.length > VAR_IMG_MAX ? <i className="qsi-varimg-more">… +{labels.length - VAR_IMG_MAX} biến thể nữa dùng ảnh / mã / giá chung</i> : null}
      </div>
    </div>
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
  // danh sách Thương hiệu / NCC đã có (không trùng theo chữ thường), xếp theo chữ cái
  const goiY = useMemo(() => {
    const o = {}
    Object.keys(GOI_Y).forEach(lb => {
      const m = {}
      ;(dsSP || []).forEach(p => { const v = String(p[GOI_Y[lb]] || '').trim(); if (v && !m[khoaTen_(v)]) m[khoaTen_(v)] = v })
      o[lb] = Object.values(m).sort((a, b) => a.localeCompare(b, 'vi'))
    })
    return o
  }, [dsSP])
  const maCo = useMemo(() => {
    const m = {}
    ;(dsSP || []).forEach(p => { const k = khoaTen_(p.ma); if (k) (m[k] = m[k] || []).push(p) })
    return m
  }, [dsSP])
  const loai = useImp(s => s.loai)
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
      <VarCard form={form} loai={loai} />
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
