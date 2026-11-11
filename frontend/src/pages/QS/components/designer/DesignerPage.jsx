import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../../../components/ui/Icon'
import { useQs } from '../../state/QsData'
import { showTab } from '../../state/store'
import { money, qbNorm_, safeUrl_ } from '../../lib/format.js'
import { projectGroups } from '../../lib/dashModel.js'
import * as api from '../../api/qsApi'
import { uploadRaw, mediaUrl } from '../../api/files'
import { qsToast as toast, qsConfirm, qsAsk } from '../common/dialogs'
import SearchSelect from '../common/SearchSelect'
import { importProjectForm, projInfoModal } from '../project/projectActions'
import { MrootPortal } from '../common/Mroot'
import { statCache, loadStats_ } from '../project/projectStats'
import { useNccInfo } from '../supplier/SupplierInfo'
import '../project/gallery.css'
import './designer.css'

/* Hồ sơ nhà thiết kế tạo tay (nút "Tạo hồ sơ"): dữ liệu công ty 'ntkInfo' = [{id, loai: 'kts'|'studio', ten, anh (ảnh đại diện / logo),
   các trường của HS_GROUPS, phongCach[], loaiCT[], phanKhuc[], danhGia (1-5), gioiThieu}] (api.getProjData / setProjData với mã '__cty', như nccInfo) */
let ntkCache = null
function useNtkInfo() {
  const [list, setList] = useState(ntkCache || [])
  useEffect(() => {
    if (ntkCache) return
    api.getProjData('__cty').then(d => { ntkCache = Array.isArray(d && d.ntkInfo) ? d.ntkInfo : []; setList(ntkCache) }, () => {})
  }, [])
  async function save(next) {
    const old = ntkCache || []
    ntkCache = next; setList(next)
    try { await api.setProjData('__cty', 'ntkInfo', next); return true } catch (e) { ntkCache = old; setList(old); toast('Lỗi lưu hồ sơ: ' + ((e && e.message) || e)); return false }
  }
  return { list, save }
}
/* Trường hồ sơ theo nhóm: [khoá, nhãn, gợi ý, kiểu, chỉ cho loại ('kts' | 'studio'; bỏ trống = cả hai)].
   kiểu: text · num · tel · email · url (mở link) · studio (gợi ý danh sách studio) · area (nhiều dòng) */
const HS_GROUPS = [
  ['Thông tin cơ bản', [
    ['chucDanh', 'Chức danh', 'VD: KTS chủ trì, Giám đốc thiết kế', 'text', 'kts'],
    ['studio', 'Thuộc studio / công ty', 'Bỏ trống nếu làm độc lập', 'studio', 'kts'],
    ['namKN', 'Số năm kinh nghiệm', 'VD: 10', 'num', 'kts'],
    ['chungChi', 'Chứng chỉ hành nghề', 'Số chứng chỉ / hạng', 'text', 'kts'],
    ['tenPhapLy', 'Tên pháp lý', 'VD: Công ty TNHH Thiết kế ABC', 'text', 'studio'],
    ['mst', 'Mã số thuế', '', 'text', 'studio'],
    ['namTL', 'Năm thành lập', 'VD: 2015', 'num', 'studio'],
    ['nhanSu', 'Quy mô nhân sự', 'VD: 20 người', 'text', 'studio'],
    ['daiDien', 'Người đại diện / liên hệ chính', '', 'text', 'studio'],
    ['khuVuc', 'Khu vực hoạt động', 'VD: TP.HCM, Hà Nội', 'text'],
  ]],
  ['Liên hệ', [
    ['dienThoai', 'Điện thoại', '', 'tel'], ['zalo', 'Zalo', 'Số Zalo (nếu khác)', 'tel'],
    ['email', 'Email', '', 'email'], ['website', 'Website', 'https://…', 'url'],
    ['diaChi', 'Địa chỉ / văn phòng', '', 'text'],
  ]],
  ['Mạng xã hội & hồ sơ năng lực', [
    ['facebook', 'Facebook', 'Link trang / cá nhân', 'url'], ['instagram', 'Instagram', 'Link Instagram', 'url'],
    ['portfolio', 'Hồ sơ năng lực / Behance', 'Link portfolio, file profile…', 'url'],
  ]],
]
/* Chuyên môn: chọn nhiều bằng chip */
const HS_CHIPS = [
  ['phongCach', 'Phong cách thiết kế', ['Hiện đại', 'Tối giản', 'Tân cổ điển', 'Cổ điển', 'Indochine', 'Japandi', 'Scandinavian', 'Wabi-sabi', 'Nhiệt đới', 'Industrial', 'Luxury']],
  ['loaiCT', 'Loại công trình', ['Nhà phố', 'Biệt thự', 'Căn hộ', 'Penthouse', 'Văn phòng', 'F&B / Nhà hàng', 'Khách sạn / Resort', 'Showroom / Bán lẻ', 'Công trình công cộng']],
  ['phanKhuc', 'Phân khúc', ['Phổ thông', 'Trung cấp', 'Cao cấp', 'Hạng sang']],
]
const href_ = v => safeUrl_(/^https?:/i.test(v) ? v : 'https://' + v)
/* Quá trình làm việc của KTS (như LinkedIn): kinhNghiem = [{id, cty, chucDanh, tu: 'YYYY-MM', den: 'YYYY-MM' | '', hienTai, diaDiem, moTa}].
   Hiển thị mới nhất trước (đang làm đứng đầu, rồi theo tháng bắt đầu giảm dần); thời lượng = tu -> den (hoặc hôm nay nếu đang làm) */
const thang_ = s => { const m = /^(\d{4})-(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 12 + (+m[2]) - 1 : null }
const fmtThang_ = s => { const m = /^(\d{4})-(\d{2})$/.exec(s || ''); return m ? 'T' + (+m[2]) + '/' + m[1] : '' }
const nowThang_ = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth() }
function thoiLuong_(tu, den, hienTai) {
  const a = thang_(tu), b = hienTai ? nowThang_() : thang_(den)
  if (a == null || b == null || b < a) return ''
  const n = b - a + 1, y = Math.floor(n / 12), mo = n % 12
  return [y ? y + ' năm' : '', mo ? mo + ' tháng' : ''].filter(Boolean).join(' ')
}
const knSort_ = arr => (Array.isArray(arr) ? arr : []).slice().sort((x, y) => (y.hienTai ? 1 : 0) - (x.hienTai ? 1 : 0) || (thang_(y.tu) || 0) - (thang_(x.tu) || 0))
/* số năm kinh nghiệm tính từ quá trình làm việc: từ tháng bắt đầu sớm nhất tới hôm nay */
const knNam_ = arr => { const t = (Array.isArray(arr) ? arr : []).map(e => thang_(e.tu)).filter(v => v != null); return t.length ? Math.max(0, Math.floor((nowThang_() - Math.min(...t)) / 12)) : 0 }
const blankHs_ = (loai, ten, website) => ({ loai, ten: ten || '', website: website || '', anh: '', gioiThieu: '', danhGia: 0 })

/* Trang "Đơn vị thiết kế": 2 tab con Kiến trúc sư · Studio. Danh sách gom từ
   - cột Kiến trúc sư / Studio (Công ty) của dự án (mỗi dự án = 1 nhóm bản nháp, lấy giá trị khác rỗng của bản mới nhất)
   - đối tác "Được tin dùng bởi" ở hồ sơ nhà cung cấp (nccInfo.doiTac: loại Kiến trúc sư -> KTS; Công ty / Studio thiết kế -> Studio).
   Trùng tên (không phân biệt hoa thường / dấu) gộp 1. Số liệu dự án (giá trị, nhà cung cấp đã dùng) đọc từ projectStats của bản mới nhất.
   Bấm thẻ = trang chi tiết: Dự án · Nhà cung cấp đã dùng · Thương hiệu tin dùng. */
const s_ = v => String(v == null ? '' : v).trim()
const SUBS = [['kts', 'Kiến trúc sư', 'kienTrucSu', 'user'], ['studio', 'Studio', 'studio', 'building']]
const SUB_LS = 'qs_ntk_sub'
const subGet = () => { try { const v = localStorage.getItem(SUB_LS); return SUBS.some(x => x[0] === v) ? v : 'kts' } catch (e) { return 'kts' } }
const HUES = [212, 196, 168, 28, 262, 340, 145, 18]
const hue_ = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length] }
const ini_ = t => s_(t).replace(/^(KTS|Ks|Kts)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(-2).map(w => w[0]).join('').toUpperCase()
const loaiOf_ = l => (l === 'Kiến trúc sư' ? 'kts' : l === 'Công ty thiết kế' || l === 'Studio thiết kế' ? 'studio' : '')

export default function DesignerPage() {
  const { projects } = useQs()
  const { info } = useNccInfo()
  const HS = useNtkInfo()
  const [form, setForm] = useState(null)        // hộp tạo / sửa hồ sơ: {id?, loai, ten, ...}
  const [sub, setSubSt] = useState(subGet)
  const setSub = v => { setSubSt(v); try { localStorage.setItem(SUB_LS, v) } catch (e) { /* bỏ qua */ } }
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState('')      // khoá (qbNorm_) của nhà thiết kế đang xem
  const [, setStatVer] = useState(0)
  const groups = useMemo(() => projectGroups(projects), [projects])
  useEffect(() => {
    let alive = true
    loadStats_(groups.map(g => g.drafts[g.drafts.length - 1]), () => { if (alive) setStatVer(v => v + 1) })
    return () => { alive = false }
  }, [groups])

  /* Gom theo loại: {kts: Map, studio: Map}; mỗi mục {ten, projs[], brands{tên thương hiệu: 1}} */
  const all = { kts: {}, studio: {} }
  const get = (t, ten) => { const k = qbNorm_(ten); return all[t][k] || (all[t][k] = { key: k, ten, projs: [], brands: {}, link: '', hs: null, members: [] }) }
  // hồ sơ tạo tay đứng đầu: tên hiển thị theo hồ sơ
  HS.list.forEach(h => { if (all[h.loai] && s_(h.ten)) { const o = get(h.loai, s_(h.ten)); o.hs = h; o.ten = s_(h.ten); if (s_(h.website)) o.link = s_(h.website) } })
  groups.forEach(g => {
    SUBS.forEach(([t, , field]) => {
      const v = s_((g.drafts.slice().reverse().find(d => s_(d[field])) || {})[field])
      if (v) get(t, v).projs.push(g)
    })
  })
  /* Quá trình làm việc của KTS: dự án ghi danh ở từng vị trí cộng vào Dự án của KTS (và của studio nếu studio đã có trang);
     KTS ghi studio ở vị trí làm việc / ô Thuộc studio = thành viên của studio đó (tab Kiến trúc sư ở trang studio) */
  const byMa = {}
  groups.forEach(g => g.drafts.forEach(d => { byMa[d.maDA] = g }))
  HS.list.forEach(h => {
    if (h.loai === 'studio' && s_(h.ten)) {   // dự án ghi danh ở hồ sơ studio -> tab Dự án của studio
      const st = all.studio[qbNorm_(s_(h.ten))]
      ;(Array.isArray(h.duAn) ? h.duAn : []).forEach(d => { const g = d.maDA && byMa[d.maDA]; if (g && st.projs.indexOf(g) < 0) st.projs.push(g) })
      return
    }
    if (h.loai !== 'kts' || !s_(h.ten)) return
    const o = all.kts[qbNorm_(s_(h.ten))]
    const seen = {}
    const member = (cty, e) => {
      const st = s_(cty) && all.studio[qbNorm_(s_(cty))]
      if (!st || seen[st.key]) return st
      seen[st.key] = 1
      st.members.push({ key: o.key, ten: o.ten, chucDanh: s_((e && e.chucDanh) || h.chucDanh), hienTai: !e || !!e.hienTai, anh: h.anh || '' })
      return st
    }
    if (s_(h.studio)) member(h.studio, null)
    ;(Array.isArray(h.kinhNghiem) ? h.kinhNghiem : []).forEach(e => {
      const st = member(e.cty, e)
      ;(e.duAn || []).forEach(d => { const g = d.maDA && byMa[d.maDA]; if (g) [o, st].forEach(t => { if (t && t.projs.indexOf(g) < 0) t.projs.push(g) }) })
    })
  })
  Object.keys(info || {}).forEach(brand => {
    ;((info[brand] && info[brand].doiTac) || []).forEach(x => {
      const t = loaiOf_(x.loai)
      if (!t || !s_(x.ten)) return
      const o = get(t, s_(x.ten))
      o.brands[brand] = 1
      if (!o.link && s_(x.link)) o.link = s_(x.link)
    })
  })
  const statOf = g => statCache[g.drafts[g.drafts.length - 1].maDA]
  const sumOf = o => {
    let tong = 0, n = 0
    const ncc = {}
    o.projs.forEach(g => { const st = statOf(g); if (!st) return; n++; tong += st.tong || 0; (st.ncc || []).forEach(b => { ncc[b] = (ncc[b] || 0) + 1 }) })
    return { tong, counted: n, ncc: Object.keys(ncc).sort((a, b) => ncc[b] - ncc[a] || a.localeCompare(b, 'vi')), nccN: ncc }
  }
  const list = t => Object.values(all[t]).sort((a, b) => b.projs.length - a.projs.length || a.ten.localeCompare(b.ten, 'vi'))
  const cnt = { kts: Object.keys(all.kts).length, studio: Object.keys(all.studio).length }

  /* Lưu hồ sơ: trùng tên (không phân biệt hoa thường / dấu) cùng loại với hồ sơ khác thì báo; đổi tên thì trang chi tiết theo tên mới */
  async function saveHs(f) {
    const ten = s_(f.ten)
    if (!ten) { toast('Nhập tên ' + (f.loai === 'kts' ? 'kiến trúc sư' : 'studio')); return }
    if (HS.list.some(h => h.id !== f.id && h.loai === f.loai && qbNorm_(h.ten) === qbNorm_(ten))) { toast('Đã có hồ sơ "' + ten + '"'); return }
    const o = { ...f, ten }
    Object.keys(o).forEach(k => { if (typeof o[k] === 'string') o[k] = s_(o[k]) })
    /* quá trình làm việc: bỏ mục trống; vị trí đang làm điền sẵn Thuộc studio / Chức danh nếu còn trống */
    if (Array.isArray(o.kinhNghiem)) {
      o.kinhNghiem = o.kinhNghiem.filter(e => s_(e.cty) || s_(e.chucDanh))
      const c = o.loai === 'kts' && o.kinhNghiem.find(e => e.hienTai)
      if (c) { if (!o.studio) o.studio = s_(c.cty); if (!o.chucDanh) o.chucDanh = s_(c.chucDanh) }
    }
    const next = f.id ? HS.list.map(h => (h.id === f.id ? o : h)) : [...HS.list, { ...o, id: 'ntk' + Date.now().toString(36), at: new Date().toISOString() }]
    if (!await HS.save(next)) return
    toast((f.id ? 'Đã lưu hồ sơ ' : 'Đã tạo hồ sơ ') + ten)
    setForm(null)
    if (o.loai !== sub) setSub(o.loai)
    setDetail(qbNorm_(ten))
  }
  async function delHs(h) {
    if (!await qsConfirm('Xoá hồ sơ "' + h.ten + '"? (Dự án và đối tác ghi tên này vẫn giữ nguyên)')) return
    if (await HS.save(HS.list.filter(x => x.id !== h.id))) { toast('Đã xoá hồ sơ ' + h.ten); setDetail('') }
  }
  const newHs = () => setForm(blankHs_(sub, q.trim()))
  /* liên kết cho khung Quá trình làm việc: tra studio đã có trang, tạo nhanh trang studio, danh sách dự án QS để ghi danh */
  const studioOf = name => (s_(name) && all.studio[qbNorm_(s_(name))]) || null
  async function quickStudio(name) {
    const ten = s_(name)
    if (!ten || studioOf(ten)) return
    if (await HS.save([...HS.list, { ...blankHs_('studio', ten), id: 'ntk' + Date.now().toString(36), at: new Date().toISOString() }])) toast('Đã tạo trang studio ' + ten)
  }
  const projOpts = groups.map(g => [g.drafts[g.drafts.length - 1].maDA, g.name + (g.khachHang ? ' · ' + g.khachHang : '')])
  /* hàng cho bảng chọn dự án (ProjPicker): mỗi dự án lấy giá trị khác rỗng của bản nháp mới nhất; khu vực = đoạn cuối Địa điểm */
  const projRows = groups.map(g => {
    const ds = g.drafts.slice().reverse()
    const v = k => s_((ds.find(d => s_(d[k])) || {})[k])
    const dc = s_(g.diaChi)
    return { maDA: g.drafts[g.drafts.length - 1].maDA, ten: g.name, kh: s_(g.khachHang), kts: v('kienTrucSu'), studio: v('studio'),
      kv: dc ? s_(dc.split(',').pop()) : '', tt: s_(ds[0].trangThai) || 'Bản nháp', nam: String(ds[0].ngayTao || '').slice(0, 4) }
  })
  const lk = { studioOf, quickStudio, projOpts, projRows, byMa }
  const openNtk = (t, key) => { setSub(t); setDetail(key); const sc = document.querySelector('.qs-scroll'); if (sc) sc.scrollTop = 0 }
  // giá trị Chuyên môn tự tạo ở mọi hồ sơ -> thành lựa chọn chung cho các hồ sơ sau
  const extra = {}
  HS_CHIPS.forEach(([k]) => { extra[k] = [].concat(...HS.list.map(h => (Array.isArray(h[k]) ? h[k] : []))) })
  const dlg = form && <HsDialog f={form} setF={setForm} studios={Object.values(all.studio).map(o => o.ten)} lk={lk} extra={extra} onSave={saveHs} onClose={() => setForm(null)} />

  const cur = detail ? all[sub][detail] : null
  if (cur) {
    return (
      <>
        <DesignerDetail o={cur} sub={sub} sum={sumOf(cur)} statOf={statOf} lk={lk} onOpen={openNtk} onBack={() => setDetail('')}
          onEdit={() => setForm(cur.hs ? { ...cur.hs } : blankHs_(sub, cur.ten, cur.link))}
          onDel={cur.hs ? () => delHs(cur.hs) : null} />
        {dlg}
      </>
    )
  }

  const nq = qbNorm_(q.trim())
  const shown = list(sub).filter(o => !nq || qbNorm_(o.ten).indexOf(nq) >= 0 || o.projs.some(g => qbNorm_(g.name).indexOf(nq) >= 0))
  const subLb = SUBS.find(x => x[0] === sub)[1]
  return (
    <div className="qs-ntk">
      {dlg}
      <div className="qs-pg-head">
        <span className="qs-pg-total" title={shown.length + ' ' + subLb.toLowerCase() + ' đang hiện'}>{shown.length}</span>
        <div className="qs-pg-mod qs-pg-views" role="tablist" aria-label="Loại nhà thiết kế">
          {SUBS.map(([k, lb, , ic]) => (
            <button type="button" key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => { setSub(k); setDetail('') }}>
              <Icon name={ic} size={14} /><span>{lb}</span><small className="qs-ntk-n">[{cnt[k]}]</small>
            </button>
          ))}
        </div>
        <button type="button" className="qs-pg-new" title="Tạo hồ sơ kiến trúc sư hoặc studio" onClick={newHs}><Icon name="plus" size={15} stroke={3} />Tạo hồ sơ</button>
        <div className="qs-pg-search qs-pg-mod">
          <Icon name="search" size={16} />
          <input placeholder={'Tìm ' + subLb.toLowerCase() + ', dự án…'} value={q} onChange={e => setQ(e.target.value)} />
          {q && <button type="button" className="qs-pg-x" title="Xoá" onClick={() => setQ('')}><Icon name="x" size={16} /></button>}
        </div>
      </div>

      {shown.length ? (
        <div className="qs-ntk-grid">
          {shown.map(o => {
            const sm = sumOf(o)
            const brands = Object.keys(o.brands)
            return (
              <button type="button" key={o.key} className="qs-ntk-card" style={{ '--h': hue_(o.ten) }} onClick={() => setDetail(o.key)} title={'Xem ' + o.ten}>
                <div className="hd">
                  <span className="av">{o.hs && o.hs.anh ? <img src={mediaUrl(o.hs.anh)} alt="" /> : (ini_(o.ten) || '?')}</span>
                  <div className="nm"><b>{o.ten}</b><span>{[o.hs && s_(o.hs.chucDanh) ? s_(o.hs.chucDanh) : subLb, o.hs && sub === 'kts' ? s_(o.hs.studio) : '', o.hs ? s_(o.hs.khuVuc) : ''].filter(Boolean).join(' · ')}</span></div>
                </div>
                <hr />
                <div className="meta">
                  <span><b>[{o.projs.length}]</b> dự án</span>
                  <span><b>[{sm.ncc.length}]</b> nhà cung cấp</span>
                </div>
                <div className="val">{sm.tong > 0 ? money(sm.tong) + ' đ' : <i>{o.projs.length ? (sm.counted < o.projs.length ? 'Đang đếm…' : 'Chưa có báo giá') : 'Chưa gắn dự án'}</i>}</div>
                <div className="tags">
                  {sm.ncc.slice(0, 4).map(b => <span key={b}>{b}</span>)}
                  {sm.ncc.length > 4 && <em>+{sm.ncc.length - 4}</em>}
                  {!sm.ncc.length && brands.length > 0 && <em className="tin">Tin dùng: {brands.slice(0, 3).join(', ')}{brands.length > 3 ? '…' : ''}</em>}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="qs-pg-empty">
          {nq ? 'Không có ' + subLb.toLowerCase() + ' khớp tìm kiếm.'
            : <>Chưa có {subLb.toLowerCase()} nào. Bấm <b>Tạo hồ sơ</b>, ghi ô <b>{sub === 'kts' ? 'Kiến trúc sư' : 'Công ty'}</b> ở thông tin dự án, hoặc thêm đối tác ở tab <b>Đối tác</b> của nhà cung cấp.
              <div style={{ marginTop: 14 }}><button type="button" className="qs-pd-btn primary" onClick={newHs}><Icon name="plus" size={14} stroke={3} /> Tạo hồ sơ {subLb.toLowerCase()}</button></div></>}
        </div>
      )}
    </div>
  )
}


/* Hộp tạo / sửa hồ sơ (gần toàn màn hình): cột trái = ảnh đại diện / logo (bấm để tải) + chọn loại + đánh giá;
   cột phải cuộn = tên (bắt buộc) · các nhóm HS_GROUPS (trường theo loại) · Chuyên môn (chip chọn nhiều) · Giới thiệu; chân hộp cố định */
/* Chip "+ Tạo mới" cuối dải Chuyên môn: bấm -> ô nhập ngay tại chỗ; Enter / rời ô = thêm (và chọn luôn), Esc = huỷ */
function ChipMoi({ lb, onAdd }) {
  const [v, setV] = useState(null)   // null = đang là nút
  const xong = luu => { const t = s_(v); if (luu && t) onAdd(t); setV(null) }
  if (v == null) return <button type="button" className="qs-bd-strip-chip qs-colchip qs-ntk-chipmoi" title={'Thêm ' + lb.toLowerCase() + ' mới'} onClick={() => setV('')}><Icon name="plus" size={12} stroke={3} />Tạo mới</button>
  return (
    <input className="qs-ntk-chipin" autoFocus value={v} placeholder={'Tên ' + lb.toLowerCase() + ' mới…'} onChange={e => setV(e.target.value)} onBlur={() => xong(true)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); xong(true) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); xong(false) } }} />
  )
}

function HsDialog({ f, setF, studios, lk, extra, onSave, onClose }) {
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const fileRef = useRef(null)
  const [up, setUp] = useState(false)
  const kts = f.loai === 'kts'
  async function upAnh(file) {
    if (!file) return
    if (!/^image\//.test(file.type)) { toast('Chỉ nhận file ảnh'); return }
    setUp(true)
    try { const r = await uploadRaw(file); if (r && r.url) setF(x => ({ ...x, anh: r.url })) } catch (e) { toast('Tải ảnh lỗi: ' + e.message) }
    setUp(false)
  }
  const togChip = (k, v) => setF(x => { const a = Array.isArray(x[k]) ? x[k] : []; return { ...x, [k]: a.indexOf(v) >= 0 ? a.filter(y => y !== v) : a.concat(v) } })
  const fld = ([k, lb, ph, kieu]) => (
    <label key={k} className={kieu === 'area' ? 'wide' : ''}><span>{lb}</span>
      {kieu === 'area' ? <textarea rows={3} value={f[k] || ''} onChange={set(k)} placeholder={ph} />
        : <input value={f[k] || ''} onChange={set(k)} list={kieu === 'studio' ? 'qs-ntk-studios' : undefined}
          placeholder={k === 'namKN' && knNam_(f.kinhNghiem) ? 'Theo quá trình làm việc: ~' + knNam_(f.kinhNghiem) + ' năm' : ph}
          type={kieu === 'email' ? 'email' : kieu === 'tel' ? 'tel' : 'text'} inputMode={kieu === 'num' ? 'numeric' : undefined} />}
    </label>
  )
  return (
    <MrootPortal>
      <div className="qsc-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <form className="qsc-dlg qs-ntk-dlg" role="dialog" aria-modal="true" onSubmit={e => { e.preventDefault(); onSave(f) }}>
          <div className="qs-ntk-dh">
            <h3>{f.id ? 'Sửa hồ sơ' : 'Tạo hồ sơ nhà thiết kế'}</h3>
            <span>{kts ? 'Kiến trúc sư' : 'Studio / công ty thiết kế'}{s_(f.ten) ? ' · ' + s_(f.ten) : ''}</span>
            <button type="button" className="qsc-x" onClick={onClose}>✕</button>
          </div>
          <div className="qs-ntk-dbody">
            <aside className="qs-ntk-dside">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { upAnh(e.target.files[0]); e.target.value = '' }} />
              <button type="button" className={'qs-ntk-avup' + (kts ? ' round' : '')} style={{ '--h': hue_(f.ten) }} title="Bấm để tải ảnh" onClick={() => fileRef.current && fileRef.current.click()}>
                {f.anh ? <img src={mediaUrl(f.anh)} alt="" /> : <b>{ini_(f.ten) || <Icon name="upload" size={26} />}</b>}
                <span>{up ? 'Đang tải…' : f.anh ? 'Đổi ảnh' : (kts ? 'Ảnh đại diện' : 'Logo studio')}</span>
              </button>
              {f.anh && <button type="button" className="qs-ntk-avx" onClick={() => setF({ ...f, anh: '' })}>Xoá ảnh</button>}
              <div className="qs-ntk-loai" role="radiogroup" aria-label="Loại hồ sơ">
                {SUBS.map(([k, lb, , ic]) => (
                  <button type="button" key={k} role="radio" aria-checked={f.loai === k} className={f.loai === k ? 'on' : ''} onClick={() => setF({ ...f, loai: k })}>
                    <Icon name={ic} size={16} /><b>{lb}</b><span>{k === 'kts' ? 'Cá nhân kiến trúc sư' : 'Studio / công ty thiết kế'}</span>
                  </button>
                ))}
              </div>
              <div className="qs-ntk-rate"><span>Đánh giá hợp tác</span>
                <div>{[1, 2, 3, 4, 5].map(n => (
                  <button type="button" key={n} className={n <= (Number(f.danhGia) || 0) ? 'on' : ''} title={n + ' sao' + (n === Number(f.danhGia) ? ' - bấm lại để bỏ' : '')}
                    onClick={() => setF({ ...f, danhGia: n === Number(f.danhGia) ? 0 : n })}><Icon name="star" size={18} /></button>
                ))}</div>
              </div>
            </aside>
            <div className="qs-ntk-dmain">
              {/* mỗi nhóm là 1 module có viền riêng (.qs-ntk-dmain > section); module đầu = Tên + Thông tin cơ bản */}
              {HS_GROUPS.map(([gt, fs], gi) => {
                const ds = fs.filter(x => !x[4] || x[4] === f.loai)
                return [
                  <section key={gt}>
                    {gi === 0 && (
                      <div className="qs-ntk-fg qs-ntk-ten">
                        <label className="wide big"><span>Tên {kts ? 'kiến trúc sư' : 'studio'} *</span>
                          <input value={f.ten} onChange={set('ten')} autoFocus placeholder={kts ? 'VD: KTS Nguyễn Văn A' : 'VD: Studio ABC'} /></label>
                      </div>
                    )}
                    <h4>{gt}</h4><div className="qs-ntk-fg">{ds.map(fld)}</div>
                  </section>,
                  gi === 0 && kts && <KinhNghiem key="kn" list={f.kinhNghiem} ktsTen={f.ten} lk={lk} onChange={kn => setF(x => ({ ...x, kinhNghiem: kn }))} />,
                  gi === 1 && !kts && (
                    <section key="da"><h4>Dự án</h4>
                      <div className="qs-ntk-fg"><DuAnGhiDanh list={f.duAn} ctyTen={f.ten} lk={lk} nhan="Dự án của studio" onChange={duAn => setF(x => ({ ...x, duAn }))} /></div>
                    </section>
                  ),
                ]
              })}
              <datalist id="qs-ntk-studios">{studios.map(t => <option key={t} value={t} />)}</datalist>
              {/* Chuyên môn: mỗi nhóm chip (Phong cách · Loại công trình · Phân khúc) 1 module */}
              {HS_CHIPS.map(([k, lb, vals]) => {
                const a = Array.isArray(f[k]) ? f[k] : []
                /* lựa chọn = mặc định + giá trị tự tạo ở các hồ sơ khác (extra) + giá trị đã chọn ở hồ sơ này; trùng (không phân biệt hoa thường / dấu) gộp 1 */
                const all = []
                vals.concat((extra && extra[k]) || [], a).forEach(v => { if (s_(v) && !all.some(x => qbNorm_(x) === qbNorm_(v))) all.push(s_(v)) })
                return (
                  <section key={k} className="qs-ntk-chips">
                    <h4>{lb}{a.length > 0 && <em> · {a.length} đã chọn</em>}</h4>
                    {/* chip cùng kiểu chip "Thông tin dự án" của tờ bìa (.qs-bd-strip-chip.qs-colchip, QS.css): bo 5px;
                        chưa chọn = viền xám, đã chọn = nền xám; cuối dải = "+ Tạo mới" */}
                    <div>{all.map(v => {
                      const on = a.indexOf(v) >= 0
                      return <button type="button" key={v} className={'qs-bd-strip-chip qs-colchip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => togChip(k, v)}>{v}</button>
                    })}
                      <ChipMoi lb={lb} onAdd={v => {
                        const co = all.find(x => qbNorm_(x) === qbNorm_(v))
                        if (co) { if (a.indexOf(co) < 0) togChip(k, co); return }
                        setF(x => ({ ...x, [k]: (Array.isArray(x[k]) ? x[k] : []).concat(v) }))
                      }} />
                    </div>
                  </section>
                )
              })}
              <section><h4>Giới thiệu</h4>
                <div className="qs-ntk-fg"><label className="wide"><textarea rows={5} value={f.gioiThieu || ''} onChange={set('gioiThieu')} placeholder="Phong cách thiết kế, công trình tiêu biểu, giải thưởng…" /></label></div>
              </section>
            </div>
          </div>
          <div className="qs-ntk-dfoot">
            <span>* bắt buộc. Các trường khác có thể bổ sung sau.</span>
            <button type="button" className="qsc-btn" onClick={onClose}>Huỷ</button>
            <button type="submit" className="qsc-btn blue" disabled={up}>{f.id ? 'Lưu hồ sơ' : 'Tạo hồ sơ'}</button>
          </div>
        </form>
      </div>
    </MrootPortal>
  )
}

/* Khung "Quá trình làm việc" trong hộp hồ sơ KTS: mỗi mục 1 thẻ sửa tại chỗ (công ty / studio, chức danh, từ - đến tháng hoặc
   "Đang làm ở đây", địa điểm, mô tả) + 2 kiểu ghi danh:
   - Studio: tên khớp trang studio đã có -> báo "Đã ghi danh vào trang studio" (trang chi tiết bấm được); chưa có -> nút tạo nhanh trang studio
   - Dự án: duAn = [{k: 'pro' | 'dezon', maDA?, ten, link?}] - chọn dự án có sẵn trong Dezon Pro (chọn nhiều, gõ để tìm),
     dán link dự án dezon.vn, hoặc tạo dự án mới (thêm vào Danh sách dự án, ghi sẵn Kiến trúc sư = KTS này, Công ty = studio của vị trí)
   lk = {studioOf, quickStudio, projOpts, byMa} từ DesignerPage; ktsTen = tên KTS đang sửa */
function KinhNghiem({ list, ktsTen, lk, onChange }) {
  const arr = Array.isArray(list) ? list : []
  const upd = (id, patch) => onChange(arr.map(e => (e.id === id ? { ...e, ...patch } : e)))
  const add = () => onChange([{ id: 'kn' + Date.now().toString(36), cty: '', chucDanh: '', tu: '', den: '', hienTai: !arr.some(e => e.hienTai), diaDiem: '', moTa: '', duAn: [] }, ...arr])
  return (
    <section className="qs-ntk-kn">
      <div className="qs-ntk-knh"><h4>Quá trình làm việc</h4>
        <span>{arr.length ? arr.length + ' vị trí' + (knNam_(arr) ? ' · ~' + knNam_(arr) + ' năm kinh nghiệm' : '') : 'Các studio / công ty đã và đang làm'}</span>
        <button type="button" className="qsc-btn" onClick={add}><Icon name="plus" size={13} stroke={3} /> Thêm quá trình</button>
      </div>
      {!arr.length && <button type="button" className="qs-ntk-knempty" onClick={add}><Icon name="briefcase" size={18} />Chưa có quá trình làm việc. Bấm để thêm vị trí đầu tiên.</button>}
      {arr.map(e => {
        const tl = thoiLuong_(e.tu, e.den, e.hienTai)
        const st = lk.studioOf(e.cty)
        return (
          <div key={e.id} className={'qs-ntk-kne' + (e.hienTai ? ' cur' : '')}>
            <span className="lg" style={{ '--h': hue_(e.cty) }}>{st && st.hs && st.hs.anh ? <img src={mediaUrl(st.hs.anh)} alt="" /> : (ini_(e.cty) || <Icon name="building" size={16} />)}</span>
            <div className="qs-ntk-fg">
              <div className="lbl"><span>Công ty / studio</span>
                <input list="qs-ntk-studios" value={e.cty} onChange={ev => upd(e.id, { cty: ev.target.value })} placeholder="Gõ để chọn studio đã có trang, hoặc nhập tên mới" />
                {s_(e.cty) && (st
                  ? <span className="qs-ntk-lk ok"><Icon name="check" size={12} stroke={3} /> Đã ghi danh vào trang studio <b>{st.ten}</b></span>
                  : <span className="qs-ntk-lk">Studio chưa có trang · <button type="button" onClick={() => lk.quickStudio(e.cty)}><Icon name="plus" size={11} stroke={3} /> Tạo trang studio "{s_(e.cty)}"</button></span>)}
              </div>
              <label><span>Chức danh</span><input value={e.chucDanh} onChange={ev => upd(e.id, { chucDanh: ev.target.value })} placeholder="VD: KTS chủ trì" /></label>
              <label><span>Từ tháng</span><input type="month" value={e.tu} max={e.den || undefined} onChange={ev => upd(e.id, { tu: ev.target.value })} /></label>
              <div className="lbl"><span>Đến tháng {tl && <em>· {tl}</em>}</span>
                <span className="qs-ntk-den">
                  <input type="month" aria-label="Đến tháng" value={e.hienTai ? '' : e.den} min={e.tu || undefined} disabled={!!e.hienTai} onChange={ev => upd(e.id, { den: ev.target.value })} />
                  <label className="cb"><input type="checkbox" checked={!!e.hienTai} onChange={ev => upd(e.id, { hienTai: ev.target.checked, den: ev.target.checked ? '' : e.den })} /> Đang làm ở đây</label>
                </span>
              </div>
              <label className="wide"><span>Địa điểm</span><input value={e.diaDiem} onChange={ev => upd(e.id, { diaDiem: ev.target.value })} placeholder="VD: TP.HCM" /></label>
              <label className="wide"><span>Mô tả công việc</span><textarea rows={2} value={e.moTa} onChange={ev => upd(e.id, { moTa: ev.target.value })} placeholder="Phụ trách thiết kế nội thất biệt thự, căn hộ cao cấp…" /></label>
              <DuAnGhiDanh list={e.duAn} ktsTen={ktsTen} ctyTen={e.cty} lk={lk} onChange={duAn => upd(e.id, { duAn })} />
            </div>
            <button type="button" className="x" title="Xoá vị trí này" onClick={() => onChange(arr.filter(x => x.id !== e.id))}><Icon name="trash" size={14} /></button>
          </div>
        )
      })}
    </section>
  )
}

/* Ghi danh dự án (1 vị trí làm việc của KTS, hoặc cả studio): thẻ các dự án đã ghi danh + 3 cách thêm (Dự án Dezon Pro · Link dezon.vn · Tạo dự án mới) */
function DuAnGhiDanh({ list, ktsTen, ctyTen, lk, onChange, nhan }) {
  const ds = Array.isArray(list) ? list : []
  const [pick, setPick] = useState(false)
  const [busy, setBusy] = useState(false)
  const proSel = ds.filter(d => d.k === 'pro' && d.maDA).map(d => d.maDA)
  const setPro = mas => {
    const keep = ds.filter(d => d.k !== 'pro' || mas.indexOf(d.maDA) >= 0)
    const them = mas.filter(m => !ds.some(d => d.maDA === m)).map(m => { const o = lk.projOpts.find(x => x[0] === m); return { k: 'pro', maDA: m, ten: o ? o[1].split(' · ')[0] : m } })
    onChange(keep.concat(them))
  }
  async function addDezon() {
    const r = await qsAsk({ title: 'Ghi danh dự án trên dezon.vn', fields: [{ key: 'ten', label: 'Tên dự án', placeholder: 'VD: Verona villa' }, { key: 'link', label: 'Link dự án dezon.vn', type: 'url', placeholder: 'https://dezon.vn/du-an/…' }], ok: 'Ghi danh' })
    if (!r) return
    onChange(ds.concat({ k: 'dezon', ten: r.ten, link: /^https?:/i.test(r.link) ? r.link : 'https://' + r.link }))
  }
  async function addMoi() {
    const ten = await qsAsk({ title: 'Tạo dự án mới & ghi danh', note: 'Dự án được thêm vào Danh sách dự án (không mở thành dự án đang làm), ghi sẵn Kiến trúc sư' + (s_(ktsTen) ? ' = ' + s_(ktsTen) : '') + (s_(ctyTen) ? ', Công ty = ' + s_(ctyTen) : '') + '.', label: 'Tên dự án', placeholder: 'VD: Biệt thự Thảo Điền', ok: 'Tạo & ghi danh' })
    if (!ten) return
    setBusy(true)
    const p = await importProjectForm({ ten, kienTrucSu: s_(ktsTen), studio: s_(ctyTen) })
    setBusy(false)
    if (p && p.maDA) onChange(ds.concat({ k: 'pro', maDA: p.maDA, ten: p.ten || ten }))
  }
  return (
    <div className="lbl wide qs-ntk-da"><span>{nhan || 'Dự án tham gia'} {ds.length > 0 && <em>· {ds.length}</em>}</span>
      {ds.length > 0 && (
        <div className="qs-ntk-dachips">
          {ds.map((d, i) => (
            <span key={(d.maDA || d.link || d.ten) + i} className={'c ' + d.k} title={d.k === 'pro' ? 'Dự án trong Dezon Pro' + (lk.byMa[d.maDA] ? '' : ' (đã xoá?)') : d.link}>
              <Icon name={d.k === 'pro' ? 'folder' : 'link'} size={12} />{d.ten}
              <button type="button" title="Bỏ ghi danh" onClick={() => onChange(ds.filter((x, j) => j !== i))}><Icon name="x" size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="qs-ntk-daadd">
        <button type="button" className={pick ? 'on' : ''} onClick={() => setPick(v => !v)}><Icon name="folder" size={13} /> Dự án có sẵn (Dezon Pro)</button>
        <button type="button" onClick={addDezon}><Icon name="link" size={13} /> Dự án dezon.vn</button>
        <button type="button" disabled={busy} onClick={addMoi}><Icon name="plus" size={13} stroke={3} /> {busy ? 'Đang tạo…' : 'Tạo dự án mới'}</button>
      </div>
      {pick && <ProjPicker rows={lk.projRows} value={proSel} onChange={setPro} ktsTen={ktsTen} ctyTen={ctyTen} onClose={() => setPick(false)} />}
    </div>
  )
}

/* Bảng chọn dự án Dezon Pro để ghi danh: ô tìm (tên dự án, khách hàng, KTS, studio, địa điểm; không phân biệt dấu) +
   lọc nhanh "Của KTS này" / "Của studio này" + lọc KTS · Studio · Khu vực · Năm (ô gõ để tìm) · Trạng thái (chip);
   danh sách dạng bảng có ô đánh dấu (dự án đã chọn đứng đầu), chân: Đã chọn n · Chọn n kết quả · Bỏ chọn · Xong.
   rows = lk.projRows; value = mảng maDA đang chọn; onChange(mảng mới) */
const TT_DS = ['Bản nháp', 'Đang thực hiện', 'Hoàn thành']
function ProjPicker({ rows, value, onChange, ktsTen, ctyTen, onClose }) {
  const [q, setQ] = useState('')
  const [fl, setFl] = useState({ kts: '', studio: '', kv: '', nam: '', tt: '' })
  const setOne = (k, v) => setFl(x => ({ ...x, [k]: v }))
  const sel = Array.isArray(value) ? value : []
  const uniq = k => [...new Set(rows.map(r => r[k]).filter(Boolean))].sort((a, b) => (k === 'nam' ? b.localeCompare(a) : a.localeCompare(b, 'vi')))
  const nq = qbNorm_(q.trim())
  const khop = (a, b) => qbNorm_(a) === qbNorm_(b)
  const hits = rows.filter(r => (!nq || qbNorm_([r.ten, r.kh, r.kts, r.studio, r.kv].join(' ')).indexOf(nq) >= 0)
    && (!fl.kts || khop(r.kts, fl.kts)) && (!fl.studio || khop(r.studio, fl.studio)) && (!fl.kv || khop(r.kv, fl.kv))
    && (!fl.nam || r.nam === fl.nam) && (!fl.tt || r.tt === fl.tt))
    .sort((a, b) => (sel.indexOf(b.maDA) >= 0 ? 1 : 0) - (sel.indexOf(a.maDA) >= 0 ? 1 : 0) || b.nam.localeCompare(a.nam))
  const nFl = Object.keys(fl).filter(k => fl[k]).length + (nq ? 1 : 0)
  const tog = m => onChange(sel.indexOf(m) >= 0 ? sel.filter(x => x !== m) : sel.concat(m))
  const quick = [s_(ktsTen) && ['kts', 'Của KTS này', s_(ktsTen)], s_(ctyTen) && ['studio', 'Của studio này', s_(ctyTen)]].filter(Boolean)
  return (
    <div className="qs-ntk-pp">
      <div className="qs-ntk-pp-top">
        <div className="qs-ntk-pp-q"><Icon name="search" size={14} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tên dự án, khách hàng, KTS, studio, địa điểm…" />
          {q && <button type="button" title="Xoá" onClick={() => setQ('')}><Icon name="x" size={12} /></button>}</div>
        {quick.map(([k, lb, v]) => (
          <button type="button" key={k} className={'qs-ntk-pp-qk' + (khop(fl[k], v) ? ' on' : '')} title={v} onClick={() => setOne(k, khop(fl[k], v) ? '' : v)}>
            <Icon name={k === 'kts' ? 'user' : 'building'} size={13} />{lb}
          </button>
        ))}
      </div>
      <div className="qs-ntk-pp-flt">
        <SearchSelect className="sm" value={fl.kts} options={uniq('kts')} allLabel="Mọi KTS" onChange={v => setOne('kts', v)} />
        <SearchSelect className="sm" value={fl.studio} options={uniq('studio')} allLabel="Mọi studio" onChange={v => setOne('studio', v)} />
        <SearchSelect className="sm" value={fl.kv} options={uniq('kv')} allLabel="Mọi khu vực" onChange={v => setOne('kv', v)} />
        <SearchSelect className="sm" value={fl.nam} options={uniq('nam')} allLabel="Mọi năm" onChange={v => setOne('nam', v)} />
        <div className="qs-ntk-pp-tt" role="radiogroup" aria-label="Trạng thái">
          {[''].concat(TT_DS).map(t => <button type="button" key={t || 'all'} role="radio" aria-checked={fl.tt === t} className={fl.tt === t ? 'on' : ''} onClick={() => setOne('tt', t)}>{t || 'Mọi trạng thái'}</button>)}
        </div>
      </div>
      <div className="qs-ntk-pp-list" role="listbox" aria-multiselectable="true">
        <div className="qs-ntk-pp-row head"><span /><span>Dự án</span><span>Kiến trúc sư</span><span>Studio</span><span>Khu vực</span><span>Năm</span></div>
        {hits.map(r => {
          const on = sel.indexOf(r.maDA) >= 0
          return (
            <button type="button" key={r.maDA} role="option" aria-selected={on} className={'qs-ntk-pp-row' + (on ? ' on' : '')} onClick={() => tog(r.maDA)}>
              <i className="bx">{on && <Icon name="check" size={11} stroke={3} />}</i>
              <span className="nm"><b>{r.ten}</b>{r.kh && <small>{r.kh} · {r.tt}</small>}</span>
              <span className={r.kts ? '' : 'nil'}>{r.kts || '—'}</span>
              <span className={r.studio ? '' : 'nil'}>{r.studio || '—'}</span>
              <span className={r.kv ? '' : 'nil'}>{r.kv || '—'}</span>
              <span>{r.nam || '—'}</span>
            </button>
          )
        })}
        {!hits.length && <div className="qs-ntk-pp-none">Không có dự án khớp bộ lọc.</div>}
      </div>
      <div className="qs-ntk-pp-foot">
        <span>Đã chọn <b>{sel.length}</b> · {hits.length}/{rows.length} dự án</span>
        {nFl > 0 && <button type="button" onClick={() => { setQ(''); setFl({ kts: '', studio: '', kv: '', nam: '', tt: '' }) }}>Bỏ lọc ({nFl})</button>}
        {hits.length > 0 && <button type="button" onClick={() => onChange(sel.concat(hits.map(r => r.maDA).filter(m => sel.indexOf(m) < 0)))}>Chọn {hits.length} kết quả</button>}
        <button type="button" disabled={!sel.length} onClick={() => onChange([])}>Bỏ chọn</button>
        <button type="button" className="ok" onClick={onClose}>Xong</button>
      </div>
    </div>
  )
}

/* Dòng thời gian quá trình làm việc ở tab Hồ sơ (chỉ đọc): tên studio có trang -> bấm mở trang studio; dự án ghi danh -> bấm xem
   (Dezon Pro: hộp Thông tin dự án; dezon.vn: mở link) */
function KnTimeline({ list, lk, onOpen }) {
  const arr = knSort_(list).filter(e => s_(e.cty) || s_(e.chucDanh))
  if (!arr.length) return null
  return (
    <div className="qs-ntk-tl"><h4>Quá trình làm việc</h4>
      {arr.map(e => {
        const tl = thoiLuong_(e.tu, e.den, e.hienTai)
        const ky = [fmtThang_(e.tu), e.hienTai ? 'Hiện tại' : fmtThang_(e.den)].filter(Boolean).join(' – ')
        const st = lk.studioOf(e.cty)
        const ds = Array.isArray(e.duAn) ? e.duAn : []
        return (
          <div key={e.id} className={'it' + (e.hienTai ? ' cur' : '')}>
            <span className="lg" style={{ '--h': hue_(e.cty) }}>{st && st.hs && st.hs.anh ? <img src={mediaUrl(st.hs.anh)} alt="" /> : (ini_(e.cty) || '?')}</span>
            <div>
              <b>{s_(e.chucDanh) || '(chưa ghi chức danh)'}</b>
              <span className="ct">
                {st ? <button type="button" className="stl" title="Mở trang studio" onClick={() => onOpen('studio', st.key)}>{st.ten}</button> : s_(e.cty)}
                {e.hienTai && <i>Đang làm</i>}
              </span>
              {(ky || tl) && <span className="t">{ky}{ky && tl ? ' · ' : ''}{tl}</span>}
              {s_(e.diaDiem) && <span className="t">{s_(e.diaDiem)}</span>}
              {s_(e.moTa) && <p>{s_(e.moTa)}</p>}
              {ds.length > 0 && (
                <div className="qs-ntk-dachips ro">
                  {ds.map((d, i) => (d.k === 'pro'
                    ? <button type="button" key={(d.maDA || '') + i} className="c pro" title="Xem thông tin dự án" onClick={() => projInfoModal(d.maDA)}><Icon name="folder" size={12} />{d.ten}</button>
                    : <a key={(d.link || '') + i} className="c dezon" href={href_(d.link || '')} target="_blank" rel="noopener noreferrer"><Icon name="link" size={12} />{d.ten}</a>))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* Trang chi tiết 1 nhà thiết kế: tab Hồ sơ · Dự án · Nhà cung cấp đã dùng (đếm theo số dự án) · Thương hiệu tin dùng (hồ sơ nhà cung cấp) */
function DesignerDetail({ o, sub, sum, statOf, lk, onOpen, onBack, onEdit, onDel }) {
  const [tab, setTab] = useState(o.hs ? 'hs' : 'pj')
  const brands = Object.keys(o.brands).sort((a, b) => a.localeCompare(b, 'vi'))
  const TABS = [['hs', 'Hồ sơ', 0], sub === 'studio' && ['tv', 'Kiến trúc sư', o.members.length], ['pj', 'Dự án', o.projs.length], ['ncc', 'Nhà cung cấp đã dùng', sum.ncc.length], ['tin', 'Thương hiệu tin dùng', brands.length]].filter(Boolean)
  const link = o.link ? (/^https?:/i.test(o.link) ? o.link : 'https://' + o.link) : ''
  const h = o.hs || {}
  return (
    <div className="qs-pd qs-ntk-d" style={{ '--h': hue_(o.ten) }}>
      <div className="qs-pd-top">
        <button type="button" className="qs-pd-back" onClick={onBack}><Icon name="arrowLeft" size={16} /> Đơn vị thiết kế</button>
      </div>
      <div className="qs-pd-title">
        <span className="qs-ntk-dav">{h.anh ? <img src={mediaUrl(h.anh)} alt="" /> : (ini_(o.ten) || '?')}</span>
        <h1>{o.ten}</h1>
        <span className="qs-ntk-pill">{sub === 'kts' ? 'Kiến trúc sư' : 'Studio'}</span>
        {link && <a className="qs-pd-btn" href={safeUrl_(link)} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14} /> Website</a>}
        <button type="button" className="qs-pd-btn" onClick={onEdit}><Icon name="edit" size={14} /> {o.hs ? 'Sửa hồ sơ' : 'Tạo hồ sơ'}</button>
        {onDel && <button type="button" className="qs-pd-btn" onClick={onDel}><Icon name="trash" size={14} /> Xoá hồ sơ</button>}
        <span className="sum"><b>{o.projs.length}</b> dự án · <b>{sum.ncc.length}</b> nhà cung cấp{sum.tong > 0 ? <> · tổng báo giá <b>{money(sum.tong)} đ</b></> : null}</span>
      </div>
      <div className="qs-pd-tabs" role="tablist">
        {TABS.map(t => <button type="button" role="tab" key={t[0]} aria-selected={tab === t[0]} className={tab === t[0] ? 'on' : ''} onClick={() => setTab(t[0])}>{t[1]}{t[2] ? <small>{t[2]}</small> : null}</button>)}
      </div>
      {tab === 'hs' && (
        <div className="qs-pd-sec">
          {o.hs ? (
            <div className="qs-ntk-hs">
              <div className="tx">
                {s_(h.gioiThieu) ? s_(h.gioiThieu).split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p className="nil">Chưa có giới thiệu.</p>}
                {HS_CHIPS.map(([k, lb]) => (Array.isArray(h[k]) && h[k].length ? (
                  <div key={k} className="qs-ntk-tagrow"><span>{lb}</span><div>{h[k].map(v => <i key={v}>{v}</i>)}</div></div>
                ) : null))}
                {sub === 'kts' && <KnTimeline list={h.kinhNghiem} lk={lk} onOpen={onOpen} />}
                {sub === 'studio' && Array.isArray(h.duAn) && h.duAn.length > 0 && (
                  <div className="qs-ntk-tagrow"><span>Dự án đã ghi danh</span>
                    <div className="qs-ntk-dachips ro">
                      {h.duAn.map((d, i) => (d.k === 'pro'
                        ? <button type="button" key={(d.maDA || '') + i} className="c pro" title="Xem thông tin dự án" onClick={() => projInfoModal(d.maDA)}><Icon name="folder" size={12} />{d.ten}</button>
                        : <a key={(d.link || '') + i} className="c dezon" href={href_(d.link || '')} target="_blank" rel="noopener noreferrer"><Icon name="link" size={12} />{d.ten}</a>))}
                    </div>
                  </div>
                )}
              </div>
              <div className="side">
                {Number(h.danhGia) > 0 && <div className="qs-ntk-stars" title={'Đánh giá hợp tác ' + h.danhGia + '/5'}>{[1, 2, 3, 4, 5].map(n => <Icon key={n} name="star" size={16} className={n <= h.danhGia ? 'on' : ''} />)}</div>}
                {HS_GROUPS.map(([gt, fs]) => {
                  const ds = fs.filter(x => (!x[4] || x[4] === sub) && s_(h[x[0]]))
                  if (!ds.length) return null
                  return (
                    <dl key={gt}><h5>{gt}</h5>
                      {ds.map(([k, lb, , kieu]) => {
                        const v = s_(h[k])
                        return <div key={k}><dt>{lb}</dt><dd>{kieu === 'email' ? <a href={'mailto:' + v}>{v}</a> : kieu === 'url' ? <a href={href_(v)} target="_blank" rel="noopener noreferrer">{v.replace(/^https?:\/\//i, '')}</a> : kieu === 'tel' ? <a href={'tel:' + v.replace(/\s/g, '')}>{v}</a> : v}</dd></div>
                      })}
                    </dl>
                  )
                })}
                {sub === 'kts' && !s_(h.studio) && <dl><div><dt>Thuộc studio</dt><dd className="nil">Độc lập</dd></div></dl>}
              </div>
            </div>
          ) : (
            <div className="qs-pd-empty">Chưa có hồ sơ cho {o.ten}.
              <div style={{ marginTop: 12 }}><button type="button" className="qs-pd-btn primary" onClick={onEdit}><Icon name="plus" size={14} stroke={3} /> Tạo hồ sơ</button></div>
            </div>
          )}
        </div>
      )}
      {tab === 'tv' && (
        <div className="qs-pd-sec">
          {o.members.length ? (
            <div className="qs-ntk-mem">
              {o.members.slice().sort((a, b) => (b.hienTai ? 1 : 0) - (a.hienTai ? 1 : 0) || a.ten.localeCompare(b.ten, 'vi')).map(m => (
                <button type="button" key={m.key} className="qs-ntk-memc" style={{ '--h': hue_(m.ten) }} onClick={() => onOpen('kts', m.key)} title={'Mở hồ sơ ' + m.ten}>
                  <span className="av">{m.anh ? <img src={mediaUrl(m.anh)} alt="" /> : ini_(m.ten)}</span>
                  <b>{m.ten}</b><span>{m.chucDanh || 'Kiến trúc sư'}</span>
                  <i className={m.hienTai ? 'on' : ''}>{m.hienTai ? 'Đang làm' : 'Đã từng làm'}</i>
                </button>
              ))}
            </div>
          ) : <div className="qs-pd-empty">Chưa có kiến trúc sư nào ghi danh vào {o.ten} (ghi ở ô Thuộc studio hoặc Quá trình làm việc trong hồ sơ KTS).</div>}
        </div>
      )}
      {tab === 'pj' && (
        <div className="qs-pd-sec">
          {o.projs.length ? (
            <div className="qs-ntk-pj">
              {o.projs.map(g => {
                const st = statOf(g)
                const d = g.drafts[g.drafts.length - 1]
                return (
                  <button type="button" key={d.maDA} className="qs-ntk-pjc" title="Mở trang Danh sách dự án" onClick={() => showTab('dsduan')}>
                    <b>{g.name}</b>
                    <span>{[g.khachHang, g.diaChi, d.trangThai || 'Bản nháp'].filter(s_).join(' · ')}</span>
                    <span className="v">{st ? (st.n ? money(st.tong) + ' đ · ' + st.n + ' dòng' : 'Chưa có báo giá') : 'Đang đếm…'}</span>
                    {st && st.ncc && st.ncc.length > 0 && <span className="tags">{st.ncc.slice(0, 5).map(b => <i key={b}>{b}</i>)}{st.ncc.length > 5 && <em>+{st.ncc.length - 5}</em>}</span>}
                  </button>
                )
              })}
            </div>
          ) : <div className="qs-pd-empty">Chưa gắn với dự án nào (ghi ở ô {sub === 'kts' ? 'Kiến trúc sư' : 'Công ty'} trong thông tin dự án).</div>}
        </div>
      )}
      {tab === 'ncc' && (
        <div className="qs-pd-sec">
          {sum.ncc.length ? (
            <div className="qs-pd-ncc">
              {sum.ncc.map(b => <button type="button" key={b} className="qs-pd-nccc" title="Mở trang Nhà cung cấp" onClick={() => showTab('dsncc')}><b>{b}</b><span>{sum.nccN[b]} dự án</span></button>)}
            </div>
          ) : <div className="qs-pd-empty">{sum.counted < o.projs.length ? 'Đang đếm…' : 'Các dự án chưa có dòng báo giá.'}</div>}
        </div>
      )}
      {tab === 'tin' && (
        <div className="qs-pd-sec">
          {brands.length ? (
            <div className="qs-pd-ncc">
              {brands.map(b => <button type="button" key={b} className="qs-pd-nccc" title="Mở trang Nhà cung cấp" onClick={() => showTab('dsncc')}><b>{b}</b><span>ghi ở tab Đối tác</span></button>)}
            </div>
          ) : <div className="qs-pd-empty">Chưa nhà cung cấp nào ghi {o.ten} ở tab Đối tác ("Được tin dùng bởi").</div>}
        </div>
      )}
    </div>
  )
}
