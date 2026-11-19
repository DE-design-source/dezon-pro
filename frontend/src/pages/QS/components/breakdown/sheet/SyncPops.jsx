import { useEffect, useState } from 'react'
import Pop, { PopHead } from './Pop'
import Icon from '../../../../../components/ui/Icon'
import { MrootPortal } from '../../common/Mroot'
import { money, pctIn_ } from '../../../lib/format.js'
import { nodeName } from '../../../lib/tree.js'
import { TK_LN_QUICK } from '../../../lib/columns.js'
import { lnDiff_ } from '../../../lib/bocSync.js'
import { mediaUrl } from '../../../api/files'
import { lineUpdateApply, giaSyncApply } from './bocActions'
import { qsToast as toast } from '../../common/dialogs'
import * as api from '../../../api/qsApi'
import { fmtDateTime_ } from '../../products/edit/editModel'

const img1 = v => mediaUrl(String(v || '').split('\n')[0].trim())

/* "Sản phẩm đã được cập nhật" (lnUpdPop_ PUB/boc.js:1458-1487): so sánh cũ -> mới từng trường, tích phần muốn đưa vào dòng */
export function LineUpdatePop({ anchor, line, products, onClose }) {
  const d = lnDiff_(line, products)
  const [off, setOff] = useState({})
  if (!d) return null
  const ve = (v, kieu) => {
    if (kieu === 'money') return money(v) + ' đ'
    if (kieu === 'pct') return String(Number(v) || 0).replace('.', ',') + '%'
    if (kieu === 'img') return v ? <img className="qs-tk-lnuimg" src={img1(v)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <i>—</i>
    const t = String(v || '').trim()
    return t ? <span className="qs-tk-pre">{t}</span> : <i>—</i>
  }
  function apply() {
    const patch = {}
    d.ds.forEach(x => { if (!off[x.k]) patch[x.k] = x.moi })
    if (!Object.keys(patch).length) { toast('Chưa chọn phần nào để cập nhật'); return }
    onClose()
    lineUpdateApply(line.lineId, patch)
  }
  return (
    <Pop anchor={anchor} width={380} className="qs-tk-lnupd" onClose={onClose}>
      <PopHead title="Sản phẩm đã được cập nhật" onClose={onClose} />
      <div className="qs-tk-lnusub">{(d.p.ten || '') + (d.p.ma ? ' · ' + d.p.ma : '')} — chọn phần muốn đưa vào dòng đang bóc</div>
      <div className="qs-tk-lnub">
        {d.ds.map(x => (
          <label key={x.k} className="qs-tk-lnui">
            <input type="checkbox" checked={!off[x.k]} onChange={e => setOff({ ...off, [x.k]: !e.target.checked })} />
            <div className="qs-tk-lnuc"><div className="qs-tk-lnulb">{x.lb}</div>
              <div className="qs-tk-lnuv"><span className="cu">{ve(x.cu, x.kieu)}</span><span className="ar">→</span><span className="moi">{ve(x.moi, x.kieu)}</span></div></div>
          </label>
        ))}
      </div>
      <div className="qs-tk-lnuf"><button className="qsc-btn" onClick={onClose}>Giữ nguyên</button>
        <button className="qsc-btn blue" onClick={apply}><Icon name="check" size={14} /> Cập nhật dòng này</button></div>
    </Pop>
  )
}

/* "Cập nhật giá theo Danh sách sản phẩm" (giaSyncRun_ … giaSyncApply_ PUB/boc.js:1529-1591). ds = giaLechList_ */
export function PriceSyncModal({ ds, onClose }) {
  const [off, setOff] = useState({})
  const [busy, setBusy] = useState(null)
  const [mo, setMo] = useState(-1)        // dòng đang mở chi tiết
  const [hist, setHist] = useState({})    // maSP -> lịch sử sửa SP (mảng | {err})
  const chon = ds.filter((x, i) => !off[i])
  const xem = (i, ma) => {
    setMo(m => (m === i ? -1 : i))
    if (!ma || hist[ma]) return
    setHist(h => ({ ...h, [ma]: 'loading' }))
    api.getProductHistory(ma).then(r => setHist(h => ({ ...h, [ma]: r || [] })), e => setHist(h => ({ ...h, [ma]: { err: (e && e.message) || 'lỗi' } })))
  }
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && busy === null) onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [busy, onClose])
  async function apply() {
    if (!chon.length) { toast('Chưa chọn dòng nào'); return }
    setBusy(0)
    await giaSyncApply(chon, i => setBusy(i))
    onClose()
  }
  return (
    <MrootPortal>
      <div className="qsc-ov" onMouseDown={e => { if (e.target === e.currentTarget && busy === null) onClose() }}>
        <div className="qsc-dlg qs-tk-gsx" role="dialog">
          <div className="qs-tk-gsxh"><h3>Cập nhật giá theo Danh sách sản phẩm</h3>
            <span className="qs-tk-gsxn">{ds.length} dòng lệch giá</span>
            <button className="qsc-x" onClick={onClose}>✕</button></div>
          <div className="qs-tk-gsxnote"><Icon name="clock" size={14} /><span>Dòng trong bảng là <b>bản chụp giá lúc thêm</b>. Cập nhật sẽ lấy giá vốn mới từ danh mục, <b>giữ nguyên %lợi nhuận</b> của từng dòng nên giá bán tính lại theo đó.</span></div>
          <div className="qs-tk-gsxb">
            {ds.map((x, i) => {
              const phu = [x.l.tang, x.l.khuVuc, x.l.maSP].map(t => String(t || '').trim()).filter(Boolean).join(' · ')
              const ma = String(x.l.maSP || '').trim(), h = hist[ma], p = x.p || {}
              return (
                <div key={x.l.lineId} className={'qs-tk-gsxw' + (mo === i ? ' on' : '')}>
                  <div className="qs-tk-gsxi" title="Bấm để xem nội dung thay đổi, người sửa" onClick={() => xem(i, ma)}>
                    <input type="checkbox" checked={!off[i]} onClick={e => e.stopPropagation()} onChange={e => setOff({ ...off, [i]: !e.target.checked })} />
                    <div className="qs-tk-gsxc"><div className="nm">{x.l.ten || '(không tên)'}</div>{phu && <div className="sub">{phu}</div>}</div>
                    <div className="qs-tk-gsxv">{x.cu !== x.von || x.ck === (Number(x.l.chietKhau) || 0)
                      ? <><span className="cu">{money(x.cu)}</span><span className="ar">→</span><span className="moi">{money(x.von)}</span></>
                      : <><span className="cu">CK {(Number(x.l.chietKhau) || 0)}%</span><span className="ar">→</span><span className="moi">CK {x.ck}%</span></>}</div>
                    <Icon name={mo === i ? 'chevronUp' : 'chevronDown'} size={14} />
                  </div>
                  {mo === i && (
                    <div className="qs-tk-gsxd">
                      <div className="qs-tk-gsxdg">
                        {[['Giá bán lẻ', money(x.cu), money(x.von)], ['CK đại lý', (Number(x.l.chietKhau) || 0) + '%', (Number(x.ck) || 0) + '%']].map(([lb, a, b]) => (a === b
                          ? [<span key={lb}>{lb}</span>, <span key={lb + 1} className="gsx-keep">{a} (không đổi)</span>]
                          : [<span key={lb}>{lb}</span>, <span key={lb + 1}><span className="cu">{a}</span> → <b>{b}</b></span>]))}
                      </div>
                      <div className="qs-tk-gsxds">Giá trong bảng = bản chụp lúc thêm dòng · Danh sách SP sửa cuối bởi <b>{p.nguoiSua || '—'}</b>{p.ngayCapNhat ? ' · ' + fmtDateTime_(p.ngayCapNhat) : ''}</div>
                      <div className="qs-tk-gsxdh">Lịch sử sửa sản phẩm {ma && <i>({ma})</i>}</div>
                      {!ma ? <div className="qs-tk-gsxde">Dòng chưa có mã SP.</div>
                        : h === 'loading' || !h ? <div className="qs-tk-gsxde">Đang tải…</div>
                          : h.err ? <div className="qs-tk-gsxde err">Không tải được lịch sử: {h.err}</div>
                            : !h.length ? <div className="qs-tk-gsxde">Chưa có lịch sử sửa.</div>
                              : h.slice(0, 20).map((r, j) => (
                                <div key={j} className={'qs-tk-gsxdr' + (/GIÁ|CHIẾT KHẤU/i.test(r.field || '') ? ' gia' : '')}>
                                  <div><b>{r.field}</b><span>{(r.by || '?') + ' · ' + fmtDateTime_(r.at)}</span></div>
                                  <div><span className="cu">{r.old || '—'}</span> → <span className="moi">{r.new || '—'}</span></div>
                                </div>
                              ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="qs-tk-gsxf">
            <button className="qsc-btn" onClick={() => setOff({})}>Chọn tất cả</button>
            <button className="qsc-btn" onClick={() => { const o = {}; ds.forEach((x, i) => { o[i] = true }); setOff(o) }}>Bỏ chọn</button>
            <span style={{ flex: 1 }} />
            <button className="qsc-btn" onClick={onClose}>Giữ nguyên</button>
            <button className="qsc-btn blue" disabled={!chon.length || busy !== null} onClick={apply}>
              {busy !== null ? 'Đang cập nhật ' + busy + '/' + chon.length + '…' : <><Icon name="check" size={15} /> Cập nhật {chon.length} dòng</>}
            </button>
          </div>
        </div>
      </div>
    </MrootPortal>
  )
}

/* Chọn nhanh % lợi nhuận ngay tại ô (lnPickPop_ PUB/app.js:2746-2776) */
export function LnPickPop({ anchor, line, onPick, onClose }) {
  const cur = Number(line.lnPct) || 0
  const [v, setV] = useState(TK_LN_QUICK.indexOf(cur) < 0 && cur ? String(cur) : '')
  const set = x => { x = pctIn_(x); if (x == null) { toast('Chưa nhập %'); return } onClose(); onPick(x) }
  return (
    <Pop anchor={anchor} width={208} className="qs-tk-lnpick" onClose={onClose}>
      <div className="qs-tk-lnpickh">Lợi nhuận dự kiến</div>
      <div className="qs-tk-lnpickb">{TK_LN_QUICK.map(x => <button key={x} className={cur === x ? 'on' : ''} onClick={() => set(x)}>{x}%</button>)}</div>
      <div className="qs-tk-lnpickf"><input type="number" step="any" placeholder="% khác" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') set(v) }} />
        <button className="qsc-btn blue" onClick={() => set(v)}>Áp dụng</button></div>
    </Pop>
  )
}

/* "Vừa thêm vào bảng": 10 dòng mới nhất của dự án (qbHistPop_ PUB/boc.js:428-452) */
export function RecentPop({ anchor, lines, onGo, onPlus, onClose }) {
  const ds = (lines || []).slice(-10).reverse()
  return (
    <Pop anchor={anchor} width={330} className="qs-tk-recent" onClose={onClose}>
      <PopHead title="Vừa thêm vào bảng" onClose={onClose} />
      {ds.length ? ds.map(l => (
        <div key={l.lineId} className="qs-tk-qbhr">
          <div className="qs-tk-qbrt" title="Tới dòng này" onClick={() => { onClose(); onGo(l) }}>
            <b>{l.ten || ''}</b><i>{l.nhom + '. ' + nodeName(l.nhom) + (l.khuVuc ? ' · ' + l.khuVuc : '') + ' · SL ' + (l.soLuong || 0)}</i>
          </div>
          <button className="qs-tk-qbplus" title="Thêm 1 số lượng" onClick={() => onPlus(l)}>+1</button>
        </div>
      )) : <div className="qs-tk-qbnone">Bảng chưa có dòng nào.</div>}
    </Pop>
  )
}

/* Khung dọc "Lịch sử" cạnh cột sản phẩm (Bóc tách), cùng kiểu khung "Chọn nhanh cột":
   tab Vừa thêm = 20 dòng mới nhất; tab Thao tác = các bước hoàn tác, bấm để quay về trước bước đó */
export function HistoryDock({ width, tab, onTab, lines, labels, onJump, onGo, onPlus, onClose }) {
  const ds = (lines || []).slice(-20).reverse()
  const ops = (labels || []).map((label, i) => ({ label, i })).reverse()
  return (
    <aside className="qs-card qs-tk-dock qs-tk-hdock" style={width ? { width } : undefined} aria-label="Lịch sử">
      <div className="qs-tkp-h">
        <b>Lịch sử</b>
        <button type="button" className="qsc-x" onClick={onClose}>✕</button>
      </div>
      <div className="qs-tk-htabs">
        <button className={tab === 'recent' ? 'on' : ''} onClick={() => onTab('recent')}><Icon name="clock" size={14} />Vừa thêm vào bảng</button>
        <button className={tab === 'ops' ? 'on' : ''} onClick={() => onTab('ops')}><Icon name="history" size={14} />Thao tác{ops.length ? ' (' + ops.length + ')' : ''}</button>
      </div>
      <div className="qs-tk-bgtb">
        {tab === 'recent' ? (ds.length ? ds.map(l => (
          <div key={l.lineId} className="qs-tk-qbhr">
            <div className="qs-tk-qbrt" title="Tới dòng này" onClick={() => onGo(l)}>
              <b>{l.ten || ''}</b><i>{l.nhom + '. ' + nodeName(l.nhom) + (l.khuVuc ? ' · ' + l.khuVuc : '') + ' · SL ' + (l.soLuong || 0)}</i>
            </div>
            <button className="qs-tk-qbplus" title="Thêm 1 số lượng" onClick={() => onPlus(l)}>+1</button>
          </div>
        )) : <div className="qs-tk-qbnone">Bảng chưa có dòng nào.</div>)
          : (ops.length ? ops.map(({ label, i }) => (
            <div key={i} className="qs-tk-qbhr">
              <div className="qs-tk-qbrt" title="Quay về trước thao tác này" onClick={() => onJump(i)}><b>{i + 1}. {label}</b></div>
            </div>
          )) : <div className="qs-tk-qbnone">Chưa có thao tác nào.</div>)}
      </div>
    </aside>
  )
}
