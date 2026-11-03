/* Giải mã blurhash (https://blurha.sh) - ảnh mờ giữ chỗ trong lúc tải ảnh / poster video. Máy chủ mã hoá 4x3 thành phần. */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'
const IDX = {}
for (let i = 0; i < CHARS.length; i++) IDX[CHARS[i]] = i

function decode83(s) {
  let v = 0
  for (let i = 0; i < s.length; i++) {
    const d = IDX[s[i]]
    if (d === undefined) return NaN
    v = v * 83 + d
  }
  return v
}

function sRGBToLinear(v) {
  const x = v / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function linearToSRGB(v) {
  const x = Math.max(0, Math.min(1, v))
  return x <= 0.0031308 ? Math.round(x * 12.92 * 255 + 0.5) : Math.round((1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255 + 0.5)
}

const signPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e)

/* Kiểm chuỗi blurhash hợp lệ (độ dài khớp số thành phần, đúng bảng ký tự) */
export function validBlurhash(hash) {
  if (typeof hash !== 'string' || hash.length < 6) return false
  const size = decode83(hash[0])
  if (!Number.isFinite(size)) return false
  const nx = (size % 9) + 1
  const ny = Math.floor(size / 9) + 1
  if (hash.length !== 4 + 2 * nx * ny) return false
  for (let i = 0; i < hash.length; i++) if (IDX[hash[i]] === undefined) return false
  return true
}

/* -> Uint8ClampedArray RGBA (width*height*4) hoặc null khi chuỗi hỏng. punch > 1 làm màu đậm hơn. */
export function decodeBlurhash(hash, width = 32, height = 32, punch = 1) {
  if (!validBlurhash(hash) || !(width > 0) || !(height > 0)) return null
  const size = decode83(hash[0])
  const nx = (size % 9) + 1
  const ny = Math.floor(size / 9) + 1
  const maxValue = ((decode83(hash[1]) + 1) / 166) * (punch || 1)
  const colors = new Array(nx * ny)
  const dc = decode83(hash.substring(2, 6))
  colors[0] = [sRGBToLinear(dc >> 16), sRGBToLinear((dc >> 8) & 255), sRGBToLinear(dc & 255)]
  for (let i = 1; i < colors.length; i++) {
    const v = decode83(hash.substring(4 + i * 2, 6 + i * 2))
    const qr = Math.floor(v / (19 * 19))
    const qg = Math.floor(v / 19) % 19
    const qb = v % 19
    colors[i] = [signPow((qr - 9) / 9, 2) * maxValue, signPow((qg - 9) / 9, 2) * maxValue, signPow((qb - 9) / 9, 2) * maxValue]
  }
  const px = new Uint8ClampedArray(width * height * 4)
  const cosX = new Float64Array(width * nx)
  const cosY = new Float64Array(height * ny)
  for (let x = 0; x < width; x++) for (let i = 0; i < nx; i++) cosX[x * nx + i] = Math.cos((Math.PI * x * i) / width)
  for (let y = 0; y < height; y++) for (let j = 0; j < ny; j++) cosY[y * ny + j] = Math.cos((Math.PI * y * j) / height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0
      for (let j = 0; j < ny; j++) {
        const cy = cosY[y * ny + j]
        for (let i = 0; i < nx; i++) {
          const basis = cosX[x * nx + i] * cy
          const c = colors[i + j * nx]
          r += c[0] * basis
          g += c[1] * basis
          b += c[2] * basis
        }
      }
      const o = 4 * (x + y * width)
      px[o] = linearToSRGB(r)
      px[o + 1] = linearToSRGB(g)
      px[o + 2] = linearToSRGB(b)
      px[o + 3] = 255
    }
  }
  return px
}

/* Blurhash -> data URL PNG nhỏ để làm nền <img> / CSS (cần DOM); '' khi chuỗi hỏng hoặc không có canvas */
const urlCache = new Map()
export function blurhashToDataURL(hash, width = 32, height = 32) {
  const key = hash + '|' + width + 'x' + height
  if (urlCache.has(key)) return urlCache.get(key)
  let out = ''
  try {
    const px = decodeBlurhash(hash, width, height)
    if (px && typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const ctx = c.getContext('2d')
      if (ctx) {
        const img = ctx.createImageData(width, height)
        img.data.set(px)
        ctx.putImageData(img, 0, 0)
        out = c.toDataURL('image/png')
      }
    }
  } catch (e) {
    out = ''
  }
  if (urlCache.size > 300) urlCache.clear()
  urlCache.set(key, out)
  return out
}
