import { useEffect, useRef, useState } from 'react'
import { readLandCert } from '../customerApi'

/* Ô Diện tích đất / Dài / Rộng cạnh "Ảnh sổ đỏ / giấy tờ đất" (form khách hàng, LeadModal). Có ảnh sổ đỏ mới tải lên thì
   AI (Gemini, POST /sales/land-cert/read) đọc ảnh, điền các ô người dùng chưa tự sửa; người dùng kiểm tra lại rồi Lưu.
   Giá trị lưu ở kdOptions.land {mã khách: {area, dai, rong, plotNo, mapSheet, purpose, shapeNote, src: 'ai' | 'tay'}} (số đo theo m / m²).
   Props: soItems [{name, url}] (ảnh sổ đỏ), value (land), onChange(land). */

const num = s => { const n = Number(String(s == null ? '' : s).replace(/\s/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
export const fmtM = n => (n == null || n === '' ? '' : String(n).replace('.', ','))
const FIELDS = [['area', 'Diện tích đất (m²)', 'vd 85,9'], ['dai', 'Dài (m)', 'vd 18,46'], ['rong', 'Rộng (m)', 'vd 4,7']]

export default function LandCertFields({ soItems, value, onChange }) {
  const v = value || {}
  const [txt, setTxt] = useState(() => ({ area: fmtM(v.area), dai: fmtM(v.dai), rong: fmtM(v.rong) }))
  const [st, setSt] = useState(null)      // {busy} | {ok: kết quả AI} | {err}
  const touched = useRef({})              // ô người dùng đã tự gõ: AI không ghi đè
  const seen = useRef(null)               // url ảnh sổ đỏ đã biết (lần đầu = ảnh có sẵn, không tự đọc lại)
  const vRef = useRef(v)
  vRef.current = v
  const seq = useRef(0)

  // dữ liệu tải xong sau khi mở form sửa: điền lại nếu chưa gõ gì
  useEffect(() => {
    if (Object.keys(touched.current).length) return
    setTxt({ area: fmtM(v.area), dai: fmtM(v.dai), rong: fmtM(v.rong) })
  }, [v.area, v.dai, v.rong])

  const read = url => {
    const n = ++seq.current
    setSt({ busy: true })
    readLandCert(url).then(r => {
      if (n !== seq.current) return
      setSt({ ok: r })
      const cur = vRef.current || {}
      const next = { ...cur }
      const fill = { area: r.area, dai: r.length, rong: r.width }
      const t = {}
      for (const k of ['area', 'dai', 'rong']) {
        if (fill[k] != null && !touched.current[k]) { next[k] = fill[k]; t[k] = fmtM(fill[k]) }
      }
      for (const k of ['plotNo', 'mapSheet', 'purpose', 'shapeNote']) if (r[k]) next[k] = r[k]
      next.src = 'ai'
      setTxt(x => ({ ...x, ...t }))
      onChange(next)
    }, e => { if (n === seq.current) setSt({ err: (e && e.message) || 'Không đọc được ảnh sổ đỏ' }) })
  }

  // ảnh sổ đỏ mới tải lên -> đọc ảnh mới nhất
  const urls = (soItems || []).map(x => x && x.url).filter(Boolean)
  const key = urls.join('|')
  useEffect(() => {
    if (seen.current === null) { seen.current = urls; return }
    const fresh = urls.filter(u => seen.current.indexOf(u) < 0)
    seen.current = urls
    if (fresh.length) read(fresh[fresh.length - 1])
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, s) => {
    touched.current[k] = true
    setTxt(x => ({ ...x, [k]: s }))
    onChange({ ...(vRef.current || {}), [k]: num(s), src: 'tay' })
  }
  const r = st && st.ok
  return (
    <div className="kd-land">
      <div className="kd-land-g">
        {FIELDS.map(([k, label, ph]) => (
          <div key={k} className="kd-field">
            <label>{label}</label>
            <input type="text" inputMode="decimal" placeholder={ph} value={txt[k]} onChange={e => set(k, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="kd-land-st" aria-live="polite">
        {st && st.busy ? <span className="busy">AI đang đọc ảnh sổ đỏ…</span>
          : st && st.err ? <span className="err">{st.err}</span>
            : r ? (
              <span>
                <b>AI đọc từ sổ đỏ</b>{r.docType ? ' (' + r.docType + ')' : ''}:{' '}
                {[r.area != null ? fmtM(r.area) + ' m²' : '', r.length != null && r.width != null ? fmtM(r.length) + ' × ' + fmtM(r.width) + ' m' : '',
                  r.plotNo ? 'thửa ' + r.plotNo : '', r.mapSheet ? 'tờ ' + r.mapSheet : '', r.purpose || ''].filter(Boolean).join(' · ') || 'không thấy số đo'}
                {r.shapeNote ? '. ' + r.shapeNote : ''}{r.note ? '. ' + r.note : ''} - kiểm tra lại trước khi lưu.
              </span>
            ) : <span>Tải ảnh sổ đỏ lên, AI tự đọc diện tích và dài × rộng (hoặc gõ tay).</span>}
        {urls.length > 0 && !(st && st.busy) && (
          <button type="button" onClick={() => read(urls[urls.length - 1])}>Đọc lại từ sổ đỏ</button>
        )}
      </div>
    </div>
  )
}
