import { useLayoutEffect } from 'react'

/* Co giao diện theo chỗ trống THẬT (không đoán mốc px, không phụ thuộc mức thu phóng / cỡ chữ):
   gán data-fit = 0, 1, ... max lên phần tử ref, tăng dần tới khi chính nó và các phần tử con khớp `sel` hết tràn chữ
   (scrollWidth > clientWidth). CSS theo [data-fit="n"] quyết định mỗi mức gọn đi thế nào.
   Đo lại khi phần tử đổi kích thước, nội dung bên trong đổi (kể cả nội dung portal vào) hoặc font nạp xong. */
export function useFitLevel(ref, max, sel, deps = []) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let raf = 0
    const over = () => [el, ...el.querySelectorAll(sel)].some(n => n.offsetParent !== null && n.scrollWidth > n.clientWidth + 1)
    const fit = () => {
      raf = 0
      let n = 0
      el.dataset.fit = '0'
      while (n < max && over()) el.dataset.fit = String(++n)
    }
    const later = () => { if (!raf) raf = requestAnimationFrame(fit) }
    const ro = new ResizeObserver(later)
    ro.observe(el)
    const mo = new MutationObserver(later)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    if (document.fonts) document.fonts.ready.then(later)
    fit()
    return () => { ro.disconnect(); mo.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, deps)   // eslint-disable-line react-hooks/exhaustive-deps
}
