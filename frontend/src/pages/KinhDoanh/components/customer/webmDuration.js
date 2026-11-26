/* Sửa tệp WebM của MediaRecorder: Chrome ghi kiểu phát trực tiếp, không có Segment > Info > Duration nên trình phát không tua được,
   không hiện độ dài. Ghi Duration = số ms đã ghi (sửa giá trị nếu có sẵn mà bằng 0, không có thì chèn ngay sau TimecodeScale).
   Chỉ đọc / sửa phần đầu tệp; đọc không ra cấu trúc mong đợi thì trả nguyên Blob cũ. */
const HEAD = 65536
const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_SEEKHEAD = 0x114d9b74
const ID_INFO = 0x1549a966
const ID_CLUSTER = 0x1f43b675
const ID_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489

// đọc số độ dài thay đổi (vint) tại p; keep = giữ bit đánh dấu (mã phần tử), unknown = kích thước "không rõ" (toàn bit 1)
const vint = (b, p, keep) => {
  if (p >= b.length || !b[p]) return null
  const first = b[p]
  let len = 1
  while (!(first & (0x80 >> (len - 1)))) len++
  if (p + len > b.length) return null
  let v = keep ? first : first & (0xff >> len)
  let ones = v === (0xff >> len)
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i]
    if (b[p + i] !== 0xff) ones = false
  }
  return { len, value: v, unknown: !keep && ones }
}

// phần tử tại p: mã, vị trí ô kích thước, vùng dữ liệu
const elem = (b, p) => {
  const id = vint(b, p, true)
  if (!id) return null
  const sz = vint(b, p + id.len, false)
  if (!sz) return null
  const start = p + id.len + sz.len
  return { id: id.value, idLen: id.len, sizeLen: sz.len, size: sz.value, unknown: sz.unknown, start, end: start + sz.value }
}

// mã hoá kích thước bằng ít nhất minLen byte (nới rộng nếu không đủ chỗ); quá 8 byte -> null
const encSize = (v, minLen) => {
  for (let len = minLen; len <= 8; len++) {
    if (v >= Math.pow(2, 7 * len) - 1) continue
    const out = new Uint8Array(len)
    let x = v
    for (let i = len - 1; i >= 0; i--) { out[i] = x % 256; x = Math.floor(x / 256) }
    out[0] |= 0x80 >> (len - 1)
    return out
  }
  return null
}

const readUint = (b, p, n) => {
  let v = 0
  for (let i = 0; i < n; i++) v = v * 256 + b[p + i]
  return v
}

const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0))
  let p = 0
  for (const x of parts) { out.set(x, p); p += x.length }
  return out
}

// sửa phần đầu tệp b (Uint8Array); trả mảng mới, hoặc null = không sửa (không hiểu cấu trúc / đã có độ dài)
export function patchWebmHead(b, ms) {
  if (!(ms > 0) || !isFinite(ms)) return null
  const head = elem(b, 0)
  if (!head || head.id !== ID_EBML || head.unknown) return null
  const seg = elem(b, head.end)
  if (!seg || seg.id !== ID_SEGMENT) return null
  const segEnd = seg.unknown ? b.length : Math.min(b.length, seg.end)
  let info = null
  let seekHead = false
  for (let q = seg.start; q < segEnd;) {
    const e = elem(b, q)
    if (!e || e.id === ID_CLUSTER) break
    if (e.unknown) return null
    if (e.id === ID_SEEKHEAD) seekHead = true
    if (e.id === ID_INFO) { info = e; break }
    q = e.end
  }
  if (!info || info.end > b.length) return null

  let scale = 1000000
  let durPos = -1
  let durLen = 0
  let afterScale = -1
  for (let r = info.start; r < info.end;) {
    const e = elem(b, r)
    if (!e || e.unknown || e.end > info.end) return null
    if (e.id === ID_SCALE) { scale = readUint(b, e.start, e.size); afterScale = e.end }
    else if (e.id === ID_DURATION) { durPos = e.start; durLen = e.size }
    r = e.end
  }
  if (!(scale > 0)) return null
  const dur = ms * 1e6 / scale

  if (durPos >= 0) {
    if (durLen !== 4 && durLen !== 8) return null
    const out = b.slice()
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    const cur = durLen === 8 ? dv.getFloat64(durPos) : dv.getFloat32(durPos)
    if (cur > 0 && isFinite(cur)) return null
    if (durLen === 8) dv.setFloat64(durPos, dur); else dv.setFloat32(durPos, dur)
    return out
  }

  // chèn thêm byte làm lệch vị trí SeekHead đã ghi sẵn: không sửa
  if (seekHead) return null
  const el = new Uint8Array(11)
  el[0] = 0x44; el[1] = 0x89; el[2] = 0x88
  new DataView(el.buffer).setFloat64(3, dur)
  const at = afterScale >= 0 ? afterScale : info.end
  const infoSize = encSize(info.size + el.length, info.sizeLen)
  if (!infoSize) return null
  const grow = el.length + infoSize.length - info.sizeLen
  const segSizePos = head.end + seg.idLen
  let segSize = b.subarray(segSizePos, seg.start)
  if (!seg.unknown) {
    segSize = encSize(seg.size + grow, seg.sizeLen)
    if (!segSize) return null
  }
  const infoSizePos = info.start - info.sizeLen
  return concat([
    b.subarray(0, segSizePos), segSize, b.subarray(seg.start, infoSizePos), infoSize,
    b.subarray(info.start, at), el, b.subarray(at),
  ])
}

// Blob WebM + số ms đã ghi -> Blob có Duration; lỗi gì cũng trả nguyên Blob cũ
export async function fixWebmDuration(blob, ms) {
  try {
    if (!blob || !blob.size) return blob
    const n = Math.min(blob.size, HEAD)
    const out = patchWebmHead(new Uint8Array(await blob.slice(0, n).arrayBuffer()), ms)
    if (!out) return blob
    return new Blob([out, blob.slice(n)], { type: blob.type })
  } catch {
    return blob
  }
}
