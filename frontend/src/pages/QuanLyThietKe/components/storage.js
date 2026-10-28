/* Tiện ích đọc/ghi localStorage cho trang Quản lý thiết kế — giữ nguyên các key của bản React cũ */
export const ORG_CHILDREN_STORAGE_KEY = 'siteflow-project-org-children'
export const ORG_PARALLEL_STORAGE_KEY = 'siteflow-project-org-parallel'

/* Đọc mảng đã lưu; lỗi / sai kiểu → fallback (mặc định theo bản HTML) */
export function readStoredArray(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return Array.isArray(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* localStorage không khả dụng */ }
}

/* Chuẩn hoá danh sách bộ phận của sơ đồ tổ chức: bỏ phần tử hỏng, bù field thiếu để không vỡ giao diện */
export function readStoredOrgRow(key, fallback, fallbackIcon) {
  const arr = readStoredArray(key, null)
  if (!arr) return fallback
  return arr
    .filter(x => x && typeof x === 'object' && typeof x.label === 'string')
    .map((x, i) => ({
      ...x,
      dept: typeof x.dept === 'string' ? x.dept : `custom-restored-${i}`,
      color: typeof x.color === 'string' ? x.color : 'primary',
      icon: typeof x.icon === 'string' ? x.icon : fallbackIcon,
    }))
}
