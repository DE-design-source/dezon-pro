/* Trạng thái giao diện của tab Danh sách sản phẩm (các trường S._sp* của bản gốc PUB/sanpham.js), giữ ở cấp module
   như S: đổi tab hay rời /qs rồi quay lại vẫn còn trang, dòng đã tick, bộ lọc, cột; riêng ô tìm về rỗng mỗi lần vào tab.
   node = S._spFilters.node: hạng mục đang lọc của bảng. Bản gốc chỉ gán khi hmSet_ được gọi (mọi tab, app.js:1374-1382) hoặc
   chọn ở chính tab này; mở app mà qs_hm trống thì KHÔNG gán (hmInit_ app.js:1450-1455) nên bảng hiện "Tất cả hạng mục"
   dù hmNode = đề mục Bóc tách. "Xóa lọc" trong bảng Bộ lọc cũng bỏ nó (spFltReset). Phần thô (3.1) của products/pt đọc node này.
   Đổi phiên (tài khoản / công ty xem) thì về trạng thái đầu, như bản gốc nạp lại trang. */
import { useSyncExternalStore } from 'react'
import { getState, subscribe } from '../../../state/store'
import { SP_FLT_EMPTY, spPerGet_, lsGet, lsSet } from './spModel'

function init() {
  return {
    node: '', q: '', view: 'all', page: 1, sel: {}, f: SP_FLT_EMPTY(), fltQ: {},
    sort: { k: '', dir: 'asc' }, edit: false,
    per: spPerGet_(),
    btOpen: {}, cbOpen: {},
    perm: null,          // S._spPerm: null = chưa tải (coi như được cả hai, như spCanEdit_)
    colUser: '',         // tài khoản đã áp bộ cột "Của tôi" (csMyApplyAll_ lúc đăng nhập)
    colSc: null,         // khoá hạng mục của bộ cột đang dùng (spColScope_: mã hạng mục | '*')
    colOn: null,         // S._spCols
    colBak: null,        // S._spColsBak: bộ cột thật khi đang bật Edit (Edit bật hết cột nhập được)
    order: null, w: null,  // S._spOrder, S._spW
  }
}
let U = init()
const subs = new Set()
const snap = () => U

let lastKey = getState().key
let lastHm = getState().hmNode, lastFrom = getState().hmFrom
let lastTab = getState().tab
subscribe(() => {
  const s = getState()
  if (s.key !== lastKey) {
    lastKey = s.key; lastHm = s.hmNode; lastFrom = s.hmFrom; lastTab = s.tab
    setU(init())
    return
  }
  if (s.tab !== lastTab) {
    lastTab = s.tab
    // showTab('sanpham') dựng lại #spSearch rỗng (app.js:364, sanpham.js:18); ý định spSearch của ProductList gán lại sau
    if (s.tab === 'sanpham' && U.q) setU({ q: '' })
  }
  if (s.hmNode === lastHm && s.hmFrom === lastFrom) return
  lastHm = s.hmNode; lastFrom = s.hmFrom
  if (s.boot === 'loading') {
    // hmInit_ lúc khởi động: chỉ khi qs_hm có giá trị mới gọi hmSet_ (gán lọc của bảng)
    const luu = lsGet('qs_hm') || ''
    if (luu) setU({ node: luu })
    return
  }
  const patch = { node: s.hmNode || '' }
  // đổi hạng mục từ tab khác khi đang xem tab này: về trang 1, bỏ chọn
  if (s.hmFrom !== 'sp' && s.tab === 'sanpham') { patch.page = 1; patch.sel = {} }
  setU(patch)
})

export function getU() { return U }
export function setU(patch) {
  U = { ...U, ...(typeof patch === 'function' ? patch(U) : patch) }
  subs.forEach(fn => fn())
}
export function useSpUi() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, snap, snap)
}

/* spSetPer: nhớ số SP/trang ở qs_spPer */
export function setPer(v) {
  const n = Number(v)
  lsSet('qs_spPer', String(n))
  setU({ per: n, page: 1 })
}
export const clearSel = () => setU({ sel: {} })
