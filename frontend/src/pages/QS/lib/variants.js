/* Biến thể sản phẩm dạng bảng (VariantTable): MỖI DÒNG = 1 biến thể {id, v:{nhãn trục: giá trị}, ma, gia, anh}.
   Dùng chung cho Nhập dữ liệu (tdSave_) và Tạo nhanh biến thể (Danh sách SP). */
const BM_GY = ['Men bóng (Glossy)', 'Men mờ (Matt)', 'Bóng kiếng (Polished)', 'Bán bóng (Semi-polished)', 'Siêu bóng', 'Sần (Structured)']
let seq = 0
export const varRow_ = (a = {}) => ({ id: 'v' + (++seq) + Date.now().toString(36), v: { ...(a.v || {}) }, ma: a.ma || '', gia: '', anh: '' })

/* Trục biến thể theo ngành; ds = gợi ý (danh sách chọn của spec theo hạng mục) */
export function varCols_(ng, SPEC, hm) {
  const ds = lb => (SPEC && SPEC.METRIC && SPEC.METRIC[lb] ? SPEC.optsOf(hm || '', lb) : [])
  const c = (lb, ten, ph) => ({ lb, ten, ph, ds: ds(lb) })
  const mau = c('MÀU SẮC', 'Màu sắc', 'VD: Trắng')
  if (ng === 'gach') return [c('KÍCH THƯỚC', 'Kích thước', 'VD: 600 x 1200 (mm)'), { ...c('BỀ MẶT HOÀN THIỆN', 'Bề mặt', 'VD: Men bóng'), ds: ds('BỀ MẶT HOÀN THIỆN').length ? ds('BỀ MẶT HOÀN THIỆN') : BM_GY }, mau]
  if (ng === 'son') return [mau, c('BỀ MẶT HOÀN THIỆN', 'Bề mặt', 'VD: Mờ'), c('KÍCH THƯỚC', 'Dung tích', 'VD: 5L')]
  if (ng === 'vs') return [mau, c('BỀ MẶT HOÀN THIỆN', 'Bề mặt', 'VD: Bóng'), c('KÍCH THƯỚC', 'Kích thước', 'VD: L580 x W380')]
  if (ng === 'ct' || ng === 'dl') return [mau]
  return [c('NHIỆT ĐỘ MÀU (K)', 'Nhiệt độ màu (K)', 'VD: 3000'), c('CÔNG SUẤT (W)', 'Công suất (W)', 'VD: 9'), c('GÓC CHIẾU (°)', 'Góc chiếu (°)', 'VD: 36'), mau]
}
/* Dòng có nội dung (trục / mã / giá / ảnh) */
export const varRowCo_ = r => !!(r && (Object.keys(r.v || {}).some(k => String(r.v[k] || '').trim()) || String(r.ma || '').trim() || String(r.gia || '').trim() || r.anh))
/* Nhãn biến thể: giá trị các trục nối bằng · */
export const varRowLb_ = (r, cols) => cols.map(c => String((r.v || {})[c.lb] || '').trim()).filter(Boolean).join(' · ')
