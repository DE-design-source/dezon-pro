import { useEffect } from 'react'

/* Hàng tab nằm trên header (.hdr-tabs) ở mọi trang: nếu thiếu chỗ thì tự thu gọn dần
   (fit-1: khoảng cách hẹp · fit-2: thêm chữ nhỏ), vẫn thiếu thì cho cuộn ngang + mờ mép phải
   và cuộn tab đang chọn vào tầm nhìn. HR có cơ chế riêng (.cc-hdr-mods) nên bỏ qua. */
const over = el => el.scrollWidth > el.clientWidth + 1

function fit(el) {
  el.classList.remove('fit-1', 'fit-2', 'overflow')
  if (over(el)) el.classList.add('fit-1')
  if (over(el)) { el.classList.remove('fit-1'); el.classList.add('fit-2') }
  if (over(el)) {
    el.classList.add('overflow')
    const active = el.querySelector('.active')
    if (active) {
      const a = active.getBoundingClientRect(), r = el.getBoundingClientRect()
      if (a.right > r.right || a.left < r.left) el.scrollLeft += a.left - r.left - 24
    }
  }
}

export default function useHeaderTabsFit() {
  useEffect(() => {
    let raf = 0
    const run = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => document.querySelectorAll('.hdr-tabs:not(.cc-hdr-mods)').forEach(fit))
    }
    run()
    window.addEventListener('resize', run)
    document.fonts?.ready.then(run)
    // trang / tab thay đổi (đổi route, đổi tab, nhãn tab đổi) → đo lại
    const mo = new MutationObserver(muts => { if (muts.some(m => m.type === 'childList' || (m.attributeName === 'class' && m.target.closest?.('.hdr-tabs') && !m.target.classList.contains('hdr-tabs')))) run() })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    // thu gọn / mở sidebar: cửa sổ giữ nguyên cỡ nhưng vùng nội dung rộng / hẹp lại → đo lại theo bề rộng sidebar
    const sb = document.getElementById('appSidebar')
    const ro = sb && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null
    if (ro) ro.observe(sb)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', run); mo.disconnect(); if (ro) ro.disconnect() }
  }, [])
}
