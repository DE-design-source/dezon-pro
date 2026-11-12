import raw from '../../assets/logo/dezon-pro-logo.svg?raw'

/* Logo Dezon Pro lấy thẳng từ assets/logo/dezon-pro-logo.svg (một nguồn duy nhất).
   Chữ DEZON theo màu chữ (currentColor), chữ PRO theo biến --dz-logo-pro (xanh ở nền sáng, trắng ở nền tối). */
const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '')
const wordmark = inner.replace('fill="#000000"', 'fill="currentColor"').replace('fill="#1A44AB"', 'style="fill:var(--dz-logo-pro, #1A44AB)"')
const viewBox = (raw.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 1674 274'
const markPath = (raw.match(/<path[^>]*\/>/) || [''])[0]

/* Chữ "DEZON PRO" đầy đủ. white = cả hai chữ màu trắng (đặt trên nền tối cố định) */
export function DezonWordmark({ height = 20, white = false, style }) {
  return (
    <svg viewBox={viewBox} role="img" aria-label="Dezon Pro"
      style={{ height, width: 'auto', display: 'block', color: white ? '#fff' : undefined, ...(white ? { '--dz-logo-pro': '#fff' } : null), ...style }}
      dangerouslySetInnerHTML={{ __html: wordmark }} />
  )
}

/* Chữ "D" của logo, dùng trong nút tròn / ô vuông (màu theo currentColor) */
export function DezonMark({ size = 16, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="86 116 256 262" aria-hidden="true" fill={color}
      style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: markPath }} />
  )
}
