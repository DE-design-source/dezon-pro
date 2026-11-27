import { useEffect } from 'react'

/* Hiện thêm khi kéo gần tới cuối danh sách dài: theo dõi phần tử mốc (ref, đặt sau phần tử cuối đang vẽ) trong vùng cuộn gần nhất,
   mốc cách khung nhìn <= 800px thì gọi onMore. deps đổi (vừa hiện thêm, đổi bộ lọc, mốc vẽ lại) thì gắn lại, mốc còn trong khung
   gọi tiếp. Panel ẩn (display:none) không giao khung nên không tự hiện thêm; deps nên có cờ panel đang hiện để chọn lại vùng cuộn.
   Vùng cuộn = tổ tiên overflow auto/scroll đang thật sự cuộn (nội dung cao hơn khung); không có thì theo khung nhìn trình duyệt. */
function scrollParent_(el) {
  for (let p = el && el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p
  }
  return null
}
export function useMoreOnScroll(ref, onMore, deps) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) onMore() }, { root: scrollParent_(el), rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, deps)   // eslint-disable-line react-hooks/exhaustive-deps
}
