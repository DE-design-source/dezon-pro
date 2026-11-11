import { Fragment, useRef, useState } from 'react'
import Pop, { PopHead } from '../breakdown/sheet/Pop'
import Icon from '../../../../components/ui/Icon'
import { DezonChip } from '../project/PCard'
import { projInfoModal, removeProjectGroup, addDraft, pickProject } from '../project/projectActions'
import { fmtDate, money, qbNorm_ } from '../../lib/format.js'
import DraftItem from './DraftItem'

/* Hai chế độ xem thêm của Danh sách dự án (chế độ "Thẻ" là ProjectCard). Cùng props với ProjectCard:
   group {name, khachHang, sdt, linkDezon, drafts[]}, curMa = mã bản nháp đang mở. Mọi thao tác dùng lại projectActions / DraftItem. */

const subOf_ = g => (g.khachHang || 'Chưa có khách hàng') + (g.sdt ? ' · ' + g.sdt : '')

/* Cột của Dạng thanh: độ rộng (px của vùng QS) kéo đổi được ở hàng tiêu đề, nằm trong biến CSS --w-<key> của .qs-dash-rows.
   Sau các cột này là cột Nhà cung cấp (giãn hết phần còn lại) rồi cột nút */
export const BAR_COLS = [
  { key: 'name', label: 'Dự án', def: 280, min: 120 },
  { key: 'kh', label: 'Khách hàng', def: 200, min: 90 },
  { key: 'pt', label: 'Phụ trách', def: 150, min: 90 },
  { key: 'src', label: 'Nguồn', def: 120, min: 80 },
  { key: 'val', label: 'Giá trị báo giá', def: 170, min: 110 },
  { key: 'date', label: 'Ngày tạo', def: 110, min: 80 },
  { key: 'n', label: 'Bản nháp', def: 90, min: 70 },
]
export const BAR_DENSITY = [['compact', 'Gọn'], ['normal', 'Vừa'], ['wide', 'Rộng']]

/* Hàng tiêu đề Dạng thanh. Kéo mép phải một tiêu đề = đổi độ rộng cột đó; nhấp đúp mép = về độ rộng mặc định.
   Props: widths {key: px}, onResize(key, px) */
export function BarHeader({ widths, onResize }) {
  const drag = useRef(null)
  function down(e, c) {
    e.preventDefault()
    const cell = e.currentTarget.parentElement
    // vùng QS bị zoom: đổi px màn hình -> px CSS theo tỉ lệ bề rộng hiển thị / bề rộng CSS của ô
    const z = (cell.getBoundingClientRect().width / cell.offsetWidth) || 1
    drag.current = { key: c.key, min: c.min, x: e.clientX, w: widths[c.key], z }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e) {
    const d = drag.current
    if (!d) return
    onResize(d.key, Math.min(800, Math.max(d.min, Math.round(d.w + (e.clientX - d.x) / d.z))))
  }
  const up = () => { drag.current = null }
  return (
    <div className="qs-dash-row-main qs-dash-bar-head" role="row">
      <span className="qs-dash-bar-sp" />
      {BAR_COLS.map(c => (
        <Fragment key={c.key}>
          <span className={'qs-dash-bar-th c-' + c.key} role="columnheader">
            {c.label}
            <span className="qs-dash-bar-rz" title="Kéo để đổi độ rộng cột · nhấp đúp: mặc định"
              onPointerDown={e => down(e, c)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onDoubleClick={() => onResize(c.key, c.def)} />
          </span>
          {/* cột Thao tác đứng ngay sau Nguồn (chỗ cột Trạng thái cũ) */}
          {c.key === 'src' && <span className="qs-dash-bar-th c-acts" role="columnheader">Thao tác</span>}
        </Fragment>
      ))}
      <span className="qs-dash-bar-th" role="columnheader">Nhà cung cấp</span>
    </div>
  )
}

/* Dạng thanh: 1 dòng / dự án, chia cột theo BAR_COLS + Nhà cung cấp. Bấm dòng = mở / thu các bản nháp (DraftItem như trong thẻ);
   bấm tên = Thông tin dự án; "Mở" = mở bản nháp mới nhất ở Bóc tách. Dự án chứa bản nháp đang mở thì mở sẵn.
   kd = có khách hàng Kinh doanh gắn (null = chưa biết); st = {n, tong, ncc[]} của bản đang dùng / mới nhất (null = đang đếm) */
/* Ô "Phụ trách": mỗi người 1 ô tròn chữ cái đầu (rê chuột = tên), 1 người thì kèm tên; quản trị có nút "+" mở hộp gõ tìm +
   tích chọn nhiều nhân sự (ghi ngay). ds = [tên đăng nhập]; users = danh sách tài khoản (rỗng khi không phải quản trị) */
const AV_MAU = ['#13406E', '#2E6BC6', '#1f8a5b', '#b7791f', '#6b46c1', '#c05621', '#2c7a7b', '#9b2c2c']
const avChu_ = t => { const p = String(t || '?').trim().split(/\s+/); return ((p.length > 1 ? p[p.length - 1][0] + p[0][0] : p[0].slice(0, 2)) || '?').toUpperCase() }
const avMau_ = t => { let h = 0; String(t || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) | 0 }); return AV_MAU[Math.abs(h) % AV_MAU.length] }
export function PtCell({ ds, users, canEdit, onChange }) {
  const [pop, setPop] = useState(null)
  const [q, setQ] = useState('')
  const ten = u => { const x = users.find(y => String(y.username || '').toLowerCase() === String(u).toLowerCase()); return (x && (x.hoTen || x.username)) || u }
  const tim = qbNorm_(q.trim())
  const hien = users.filter(x => !tim || qbNorm_((x.hoTen || '') + ' ' + (x.username || '')).indexOf(tim) >= 0)
  const doi = u => onChange(ds.some(x => x.toLowerCase() === u.toLowerCase()) ? ds.filter(x => x.toLowerCase() !== u.toLowerCase()) : ds.concat([u]))
  return (
    <div className="qs-dash-row-pt" onClick={e => e.stopPropagation()} title={ds.map(ten).join(', ')}>
      {ds.length ? ds.slice(0, 3).map(u => <span key={u} className="av" style={{ background: avMau_(u) }}>{avChu_(ten(u))}</span>) : <span className="nil">Chưa giao</span>}
      {ds.length > 3 && <em>+{ds.length - 3}</em>}
      {ds.length === 1 && <span className="nm">{ten(ds[0])}</span>}
      {canEdit && (
        <button type="button" className={'add' + (pop ? ' on' : '')} title="Giao nhân sự phụ trách dự án" onClick={e => { const b = e.currentTarget; setQ(''); setPop(p => (p ? null : b)) }}>
          <Icon name="plus" size={12} stroke={2.6} />
        </button>
      )}
      {pop && (
        <Pop anchor={pop} width={270} className="qs-dash-ptpop" onClose={() => setPop(null)}>
          <PopHead title="Nhân sự phụ trách" sub={ds.length ? ds.length + ' người' : ''} onClose={() => setPop(null)} />
          <input className="q" autoFocus value={q} placeholder="Gõ tên nhân sự để tìm…" onChange={e => setQ(e.target.value)} />
          <div className="ds">
            {hien.length ? hien.map(x => {
              const on = ds.some(u => u.toLowerCase() === String(x.username).toLowerCase())
              return (
                <label key={x.username} className={on ? 'on' : ''}>
                  <input type="checkbox" checked={on} onChange={() => doi(x.username)} />
                  <span className="av" style={{ background: avMau_(x.username) }}>{avChu_(x.hoTen || x.username)}</span>
                  <span className="t"><b>{x.hoTen || x.username}</b><i>{x.username}</i></span>
                </label>
              )
            }) : <p>{users.length ? 'Không thấy "' + q + '"' : 'Không tải được danh sách nhân sự'}</p>}
          </div>
        </Pop>
      )}
    </div>
  )
}

const NCC_MAX = 3   // số nhà cung cấp hiện đủ chữ ở cột Nhà cung cấp; dư thì nút +N mở rộng
export function ProjectRow({ group: g, curMa, kd, st, pt, users, canEditPt, onPt }) {
  const key = g.drafts[0].maDA
  const hasCur = g.drafts.some(d => d.maDA === curMa)
  const [open, setOpen] = useState(hasCur)
  const last = g.drafts[g.drafts.length - 1]
  const stop = e => e.stopPropagation()
  const ncc = (st && st.ncc) || []
  const [nccAll, setNccAll] = useState(false)   // hiện đủ nhà cung cấp (mặc định NCC_MAX ô đầu + nút +N)
  return (
    <div className={`qs-dash-row${hasCur ? ' cur' : ''}${open ? ' open' : ''}`}>
      <div className="qs-dash-row-main" onClick={() => setOpen(o => !o)} title={open ? 'Thu gọn bản nháp' : 'Xem các bản nháp'}>
        <span className="qs-dash-row-tg"><Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} /></span>
        <div className="qs-dash-project-icon qs-dash-row-icon"><Icon name="building" size={16} /></div>
        <div className="qs-dash-row-2">
          <span className="qs-dash-project-name qs-dash-click" title={'Xem thông tin dự án — ' + g.name} onClick={e => { stop(e); projInfoModal(key) }}>{g.name}</span>
          <small title={g.diaChi || ''}>{last.maDA}{g.diaChi ? ' · ' + g.diaChi : ''}</small>
        </div>
        <div className="qs-dash-row-2">
          <span className={g.khachHang ? '' : 'nil'}>{g.khachHang || 'Chưa có khách hàng'}</span>
          {g.sdt && <small>{g.sdt}</small>}
        </div>
        <PtCell ds={pt || []} users={users || []} canEdit={!!canEditPt} onChange={onPt || (() => {})} />
        <div className="qs-dash-row-st">{kd != null && <span className={'qs-dash-src-pill ' + (kd ? 'kd' : 'qs')}>{kd ? 'Kinh doanh' : 'Phòng QS'}</span>}</div>
        {/* cột Thao tác ngay sau Nguồn (bỏ cột Trạng thái; bản đang dùng vẫn hiện "Đang dùng" ở dòng bản nháp) */}
        <div className="qs-dash-row-acts">
          {hasCur ? <span className="qs-dash-row-open ph" aria-hidden="true">Mở</span>  /* giữ chỗ để nút link / xoá thẳng cột */
            : <button type="button" className="qs-dash-row-open" title="Mở bản nháp mới nhất ở Bóc tách" onClick={e => { stop(e); pickProject(last.maDA) }}>Mở</button>}
          <DezonChip p={{ linkDezon: g.linkDezon, maDA: key }} cls="qs-dash-link" label={false} />
          <button type="button" className="qs-dash-row-del" title="Xoá cả dự án này (mọi bản nháp)" onClick={e => { stop(e); removeProjectGroup(key) }}>
            <Icon name="trash" size={13} />
          </button>
        </div>
        <div className="qs-dash-row-2 qs-dash-row-val" title={hasCur ? 'Bản nháp đang dùng' : 'Bản nháp mới nhất'}>
          {st ? (st.n ? <><b>{money(st.tong)} đ</b><small>{st.n} dòng sản phẩm</small></> : <span className="nil">Chưa có báo giá</span>) : <span className="nil">Đang đếm…</span>}
        </div>
        <span className="qs-dash-row-date" title="Ngày tạo bản nháp mới nhất">{fmtDate(last.ngayTao)}</span>
        <div className="qs-dash-row-n"><span className="qs-dash-count">{g.drafts.length} bản</span></div>
        <div className={'qs-dash-row-ncc' + (nccAll ? ' all' : '')} title={ncc.join(', ')}>
          {ncc.slice(0, nccAll ? ncc.length : NCC_MAX).map(n => <span key={n}>{n}</span>)}
          {ncc.length > NCC_MAX && (
            <button type="button" className="more" onClick={e => { stop(e); setNccAll(v => !v) }}
              title={nccAll ? 'Thu gọn nhà cung cấp' : 'Xem thêm ' + (ncc.length - NCC_MAX) + ' nhà cung cấp'}>
              {nccAll ? '−' : '+' + (ncc.length - NCC_MAX)}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="qs-dash-project-body qs-dash-row-body">
          {/* bọc từng bản nháp để vẽ đường nối cây cha - con từ biểu tượng dự án xuống từng bản nháp (.qs-dash-tree-i) */}
          {g.drafts.map((d, i) => <div key={d.maDA} className="qs-dash-tree-i"><DraftItem draft={d} index={i} active={d.maDA === curMa} /></div>)}
          {/* "Thêm bản nháp" là 1 nhánh cuối của cây, đồng cấp với các bản nháp: biểu tượng (+) thay biểu tượng tệp */}
          <div className="qs-dash-tree-i">
            <button type="button" className="qs-dash-draft qs-dash-add-row" onClick={() => addDraft(key)}>
              <span className="qs-dash-draft-icon"><Icon name="plus" size={15} stroke={2.4} /></span>
              <span className="qs-dash-draft-name">Thêm bản nháp</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* Biểu tượng: ô vuông nhỏ (biểu tượng + tên + khách hàng), bấm = Thông tin dự án như đầu thẻ.
   Góc biểu tượng ghi số bản nháp; dự án đang mở có viền + chấm xanh. */
export function ProjectTile({ group: g, curMa }) {
  const key = g.drafts[0].maDA
  const hasCur = g.drafts.some(d => d.maDA === curMa)
  return (
    <button type="button" className={`qs-dash-tile${hasCur ? ' cur' : ''}`} onClick={() => projInfoModal(key)}
      title={g.name + '\n' + subOf_(g) + '\n' + g.drafts.length + ' bản nháp' + (hasCur ? ' · đang dùng' : '')}>
      <span className="qs-dash-tile-icon">
        <Icon name="building" size={24} />
        <span className="qs-dash-tile-n">{g.drafts.length}</span>
        {hasCur && <span className="qs-dash-tile-dot" />}
      </span>
      <span className="qs-dash-tile-name">{g.name}</span>
      <span className="qs-dash-tile-sub">{g.khachHang || 'Chưa có khách hàng'}</span>
    </button>
  )
}
