/* Bản đệm dữ liệu khởi động của QS trong IndexedDB (dự án + danh mục SP + dòng bóc tách của dự án đang mở), để lần sau
   mở /qs (kể cả sau F5 / tab mới) vẽ ngay từ bản đệm rồi tải bản mới ở nền (store.js boot()).
   Chỉ giữ 1 bản, gắn với phiên + công ty "xem như" (băm token|viewAs, không lưu token thô); quá 7 ngày bỏ.
   Đăng xuất / hết phiên thì xoá (clearSession, qs:noauth). Mọi lỗi IndexedDB (trình duyệt chặn, ẩn danh...) coi như không có đệm. */
const DB = 'qs-cache'
const STORE = 'kv'
const ID = 'boot'
const MAX_AGE = 7 * 24 * 3600 * 1000

/* FNV-1a 32 bit, đủ để phân biệt phiên; không dùng để bảo mật */
export function cacheKey(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16)
}

let dbp = null
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('no indexedDB')); return }
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(STORE)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    }).catch(e => { dbp = null; throw e })
  }
  return dbp
}

function run(mode, fn) {
  return db().then(d => new Promise(res => {
    try {
      const tx = d.transaction(STORE, mode)
      const q = fn(tx.objectStore(STORE))
      tx.oncomplete = () => res(q && 'result' in q ? q.result : undefined)
      tx.onerror = tx.onabort = () => res(undefined)
    } catch (e) { res(undefined) }
  })).catch(() => undefined)
}

/* -> {k, savedAt, projects, products, cur, lines} hoặc null (không có / khác phiên / quá cũ) */
export async function cacheGet(k) {
  // IndexedDB treo / chậm bất thường thì coi như không có đệm (không để /qs kẹt chờ)
  const v = await Promise.race([run('readonly', s => s.get(ID)), new Promise(res => setTimeout(() => res(undefined), 1500))])
  if (!v || v.k !== k || !(Date.now() - v.savedAt < MAX_AGE) || !Array.isArray(v.projects) || !Array.isArray(v.products)) return null
  return v
}

/* data = {projects, products, cur: mã dự án, lines}; ghi khi trình duyệt rảnh (bản sao 9 MB không chặn lúc vẽ).
   valid(): lúc ghi phiên còn đúng không (đăng xuất / đổi công ty giữa chừng thì bỏ, không ghi sau cacheClear) */
let epoch = 0   // tăng mỗi lần cacheClear: bản ghi đang chờ lúc rảnh của phiên trước không được ghi lại sau khi xoá
export function cachePut(k, data, valid) {
  const e = epoch
  const go = () => { if (e === epoch && (!valid || valid())) run('readwrite', s => s.put({ k, savedAt: Date.now(), ...data }, ID)) }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 })
  else setTimeout(go, 500)
}

export function cacheClear() { epoch++; return run('readwrite', s => s.delete(ID)) }
