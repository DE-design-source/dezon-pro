/* Quy đổi gạch ở bảng Bóc tách: khổ gạch -> m²/viên, quy cách hộp "2 viên/hộp – 1.44 m²/hộp",
   diện tích + % hao hụt -> số hộp chẵn, m² mua thực, số viên; đổi đơn vị tính m² / Hộp / Viên kèm đổi đơn giá. */
const num = s => Number(String(s).replace(',', '.')) || 0

// m² của 1 viên từ "600 x 1200 (mm)" / "60x120 cm" / "30x60"
export function gachM2Vien_(kt) {
  const s = String(kt || ''), m = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i.exec(s)
  if (!m) return 0
  let a = num(m[1]), b = num(m[2])
  // ponytail: không ghi đơn vị mà cả 2 cạnh <= 200 thì coi là cm (60x120), còn lại là mm
  if (/cm/i.test(s) || (!/mm/i.test(s) && a <= 200 && b <= 200)) { a *= 10; b *= 10 }
  return a * b / 1e6
}

export function gachHop_(s) {
  s = String(s || '')
  const v = /(\d+(?:[.,]\d+)?)\s*(?:viên|vỉ|tấm)\s*\/\s*(?:hộp|thùng)/i.exec(s)
  const m = /(\d+(?:[.,]\d+)?)\s*m(?:²|2)\s*\/\s*(?:hộp|thùng)/i.exec(s)
  return { vh: v ? num(v[1]) : 0, mh: m ? num(m[1]) : 0 }
}

export const GACH_DV = ['m²', 'Hộp', 'Viên']
export function gachDv_(dvt) {
  const d = String(dvt || '').toLowerCase()
  return /hộp|thùng/.test(d) ? 'Hộp' : /viên|vỉ|tấm/.test(d) ? 'Viên' : /m2|m²|mét vuông/.test(d) ? 'm²' : ''
}

// dt: m² cần ốp/lát, hh: % hao hụt, vh: viên/hộp, mh: m²/hộp (thiếu thì = vh × m²/viên)
export function gachTinh_({ dt, hh, kt, vh, mh }) {
  const mv = gachM2Vien_(kt)
  const can = (Number(dt) || 0) * (1 + (Number(hh) || 0) / 100)
  const m2h = Number(mh) || (Number(vh) && mv ? Number(vh) * mv : 0)
  const hop = m2h ? Math.ceil(can / m2h - 1e-9) : 0
  const mua = hop ? hop * m2h : can
  const vien = hop && Number(vh) ? hop * Number(vh) : (mv ? Math.ceil(mua / mv - 1e-9) : 0)
  return { mv, can, m2h, hop, mua, vien }
}

// số lượng ghi vào dòng theo đơn vị (0 = không tính được)
export function gachSL_(r, dv) {
  return dv === 'Hộp' ? r.hop : dv === 'Viên' ? r.vien : Math.round(r.mua * 100) / 100
}

// hệ số đổi giá: giá / đơn vị `sang` = giá / đơn vị `tu` × hệ số (0 = không đổi được)
export function gachHeSo_(tu, sang, r) {
  const m2 = { 'm²': 1, 'Hộp': r.m2h, 'Viên': r.mv }
  return m2[tu] && m2[sang] ? m2[sang] / m2[tu] : 0
}

// dòng Bóc tách là gạch: đã quy đổi, nằm ở hạng mục 3.2.4 Ốp lát, hoặc hạng mục / tên SP có chữ gạch / mosaic
export function laGach_(l) {
  return !!(l && ((l.extra && l.extra.gach) || /^3\.2\.4(\.|$)/.test(String(l.nhom || '')) || /gạch|mosaic/i.test(String(l.loai || '') + ' ' + String(l.ten || ''))))
}
