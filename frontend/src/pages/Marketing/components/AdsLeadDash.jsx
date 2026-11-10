import { useEffect, useState } from 'react'
import { listLeads } from '../../KinhDoanh/api'
import { STAGE_LABEL } from '../../../data/kinhDoanhData'
import DatePicker from '../../../components/ui/DatePicker'

/* Hiệu quả kênh quảng cáo: ghép chi tiêu theo kênh (bảng nhập chi tiêu của tab này) với khách hàng tiềm năng tiếp nhận ở tab
   Kinh doanh (lead có "Nguồn khách hàng" = tên kênh). Có bộ lọc thời gian riêng và 3 chế độ xem:
   - Tổng quan: 5 ô tổng + bảng theo kênh (chi tiêu, lead, chi phí / lead, đã chốt, tỉ lệ chốt, giá trị cơ hội); lead nguồn khác gộp 1 dòng
   - Biểu đồ: chi tiêu / lead / chi phí mỗi lead / tỉ lệ chốt theo kênh (mỗi biểu đồ 1 số đo) + lead và chi tiêu theo ngày
   - Từng page: chọn 1 kênh -> số tổng, từng ngày (chi tiêu, lead) và danh sách lead của kênh
   Props: data {kenh, ngay: [{d, v: [số theo kênh]}]}, kenh [tên kênh được xem], visible, access (khối người được xem, chỉ quản trị) */
const WON = ['chot-hd', 'bao-gia-thi-cong', 'thiet-ke', 'thi-cong']
const VIEWS = [['tong', 'Tổng quan'], ['bieudo', 'Biểu đồ'], ['page', 'Từng page']]
const KY = [['homnay', 'Hôm nay'], ['thang', 'Tháng này'], ['truoc', 'Tháng trước'], ['7n', '7 ngày'], ['30n', '30 ngày'], ['tuy', 'Tuỳ chọn'], ['tat', 'Mọi lúc']]
const vnd = n => (Math.round(Number(n) || 0)).toLocaleString('vi-VN')
const gon = n => {
  n = Number(n) || 0
  if (n >= 1e9) return (Math.round(n / 1e7) / 100).toLocaleString('vi-VN') + ' tỷ'
  if (n >= 1e6) return (Math.round(n / 1e4) / 100).toLocaleString('vi-VN') + ' tr'
  return vnd(n)
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')
const pad = n => String(n).padStart(2, '0')
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const addD = (s, n) => { const [y, m, d] = s.split('-').map(Number); return iso(new Date(y, m - 1, d + n)) }
const dm = s => s.slice(8, 10) + '/' + s.slice(5, 7)
const ten = s => String(s || '').trim().toLowerCase()

function range(ky, tuy) {
  const now = new Date()
  const today = iso(now)
  if (ky === 'homnay') return { tu: today, den: today, nhan: 'Hôm nay ' + dm(today) + '/' + today.slice(0, 4) }
  if (ky === 'thang') return { tu: iso(new Date(now.getFullYear(), now.getMonth(), 1)), den: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)), nhan: 'Tháng ' + (now.getMonth() + 1) + '/' + now.getFullYear() }
  if (ky === 'truoc') { const a = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { tu: iso(a), den: iso(new Date(a.getFullYear(), a.getMonth() + 1, 0)), nhan: 'Tháng ' + (a.getMonth() + 1) + '/' + a.getFullYear() } }
  if (ky === '7n') return { tu: addD(today, -6), den: today, nhan: '7 ngày qua' }
  if (ky === '30n') return { tu: addD(today, -29), den: today, nhan: '30 ngày qua' }
  if (ky === 'tuy') return tuy.tu && tuy.den && tuy.tu <= tuy.den ? { tu: tuy.tu, den: tuy.den, nhan: dm(tuy.tu) + ' – ' + dm(tuy.den) + '/' + tuy.den.slice(0, 4) } : { tu: null, den: null, nhan: 'Chọn khoảng ngày', chua: true }
  return { tu: null, den: null, nhan: 'Mọi lúc' }
}

/* Biểu đồ thanh ngang: 1 số đo / biểu đồ; best = thanh được nhấn mạnh */
function Bars({ title, rows, fmt, best, note }) {
  const max = Math.max(1, ...rows.map(r => r.v || 0))
  return (
    <div className="mk-ld-chart">
      <div className="ct"><b>{title}</b>{note && <span>{note}</span>}</div>
      {rows.map(r => (
        <div key={r.k} className={'br' + (best && best === r.k ? ' best' : '') + (r.v ? '' : ' zero')} title={r.k + ': ' + (r.v ? fmt(r.v) : '—')}>
          <span className="lb">{r.k}</span>
          <span className="tr"><i style={{ width: ((r.v || 0) / max) * 100 + '%' }} /></span>
          <span className="vl">{r.v ? fmt(r.v) : '—'}</span>
        </div>
      ))}
    </div>
  )
}

/* Cột theo ngày (số lead hoặc chi tiêu), hover = số của ngày */
function Days({ title, days, get, fmt, note }) {
  const max = Math.max(1, ...days.map(get))
  return (
    <div className="mk-ld-chart days">
      <div className="ct"><b>{title}</b>{note && <span>{note}</span>}</div>
      <div className="cols">
        {days.map(d => {
          const v = get(d)
          return (
            <div key={d.d} className={'col' + (v ? '' : ' zero')} title={dm(d.d) + ': ' + (v ? fmt(v) : '0')}>
              <i style={{ height: (v / max) * 100 + '%' }} />
            </div>
          )
        })}
      </div>
      <div className="ax"><span>{days.length ? dm(days[0].d) : ''}</span><span>{days.length ? dm(days[days.length - 1].d) : ''}</span></div>
    </div>
  )
}

let cache = null
export default function AdsLeadDash({ data, kenh, visible, access }) {
  const [leads, setLeads] = useState(cache)
  const [loi, setLoi] = useState('')
  const [view, setView] = useState('tong')
  const [ky, setKy] = useState('thang')
  const [tuy, setTuy] = useState({ tu: '', den: '' })
  const [page, setPage] = useState('')
  useEffect(() => {
    if (!visible) return undefined
    let live = true
    listLeads().then(ls => { cache = ls; if (live) { setLeads(ls); setLoi('') } }, e => { if (live) setLoi((e && e.message) || 'Không tải được khách hàng tiềm năng') })
    return () => { live = false }
  }, [visible])

  const r = range(ky, tuy)
  const inR = d => d && (!r.tu || d >= r.tu) && (!r.den || d <= r.den)
  const ds = (leads || []).filter(l => inR(String(l.createdAt || '').slice(0, 10)))
  const kSet = new Set(kenh.map(ten))
  const ngay = (data.ngay || []).filter(x => inR(x.d))
  const chiK = k => { const i = data.kenh.indexOf(k); return i < 0 ? 0 : ngay.reduce((a, x) => a + (Number(x.v[i]) || 0), 0) }
  const sum = list => ({
    lead: list.length,
    won: list.filter(l => WON.indexOf(l.stage) >= 0).length,
    val: list.reduce((a, l) => a + (Number(l.valueVnd) || 0), 0),
  })
  const rows = kenh.map(k => ({ k, chi: chiK(k), list: ds.filter(l => ten(l.source) === ten(k)) })).map(x => ({ ...x, ...sum(x.list) }))
  const khac = sum(ds.filter(l => !kSet.has(ten(l.source))))
  const t = rows.reduce((a, x) => ({ chi: a.chi + x.chi, lead: a.lead + x.lead, won: a.won + x.won, val: a.val + x.val }), { chi: 0, lead: 0, won: 0, val: 0 })
  const maxLead = Math.max(1, ...rows.map(x => x.lead))
  const cpl = x => (x.lead && x.chi ? x.chi / x.lead : 0)
  const best = rows.filter(x => cpl(x)).sort((a, b) => cpl(a) - cpl(b))[0]

  /* các ngày của kỳ (Mọi lúc: từ ngày sớm nhất có số / có lead, tối đa 120 ngày gần nhất) */
  const days = (() => {
    let tu = r.tu
    let den = r.den
    if (!tu || !den) {
      const all = [...(data.ngay || []).map(x => x.d), ...(leads || []).map(l => String(l.createdAt || '').slice(0, 10)).filter(Boolean)].sort()
      if (!all.length) return []
      den = all[all.length - 1]; tu = all[0]
      if (addD(den, -119) > tu) tu = addD(den, -119)
    }
    const out = []
    for (let d = tu, n = 0; d <= den && n < 400; d = addD(d, 1), n++) out.push(d)
    return out
  })()
  const dayRows = (pick, list) => days.map(d => {
    const x = (data.ngay || []).find(y => y.d === d)
    const i = pick ? data.kenh.indexOf(pick) : -1
    const chi = !x ? 0 : pick ? (i < 0 ? 0 : Number(x.v[i]) || 0) : kenh.reduce((a, k) => { const j = data.kenh.indexOf(k); return a + (j < 0 ? 0 : Number(x.v[j]) || 0) }, 0)
    return { d, chi, lead: list.filter(l => String(l.createdAt || '').slice(0, 10) === d).length }
  })

  const pg = page && kenh.indexOf(page) >= 0 ? page : (rows.slice().sort((a, b) => b.chi - a.chi || b.lead - a.lead)[0] || {}).k || ''
  const pr = rows.find(x => x.k === pg)

  return (
    <div className="mk-ads-card mk-ld">
      <div className="mk-ads-h mk-ld-h">
        <span className="mk-ads-ht">
          <span className="ic" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></svg>
          </span>
          <b>Hiệu quả kênh: chi tiêu ↔ khách hàng tiềm năng</b>
        </span>
        <div className="mk-ld-seg" role="tablist" aria-label="Chế độ xem">
          {VIEWS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <div className="mk-ld-ky">
          <div className="mk-ld-seg sm" role="tablist" aria-label="Thời gian">
            {KY.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={ky === k} className={ky === k ? 'on' : ''} onClick={() => setKy(k)}>{l}</button>)}
          </div>
          {ky === 'tuy' && (
            <span className="tuy">
              <DatePicker value={tuy.tu} onChange={v => setTuy(x => ({ ...x, tu: v }))} max={tuy.den || undefined} ariaLabel="Từ ngày" />
              <span>→</span>
              <DatePicker value={tuy.den} onChange={v => setTuy(x => ({ ...x, den: v }))} min={tuy.tu || undefined} ariaLabel="Đến ngày" />
            </span>
          )}
        </div>
        {access}
      </div>

      {loi && <div className="mk-ld-err">Chưa xem được số lead: {loi}. Cần quyền tab Kinh doanh.</div>}
      {!loi && r.chua && <div className="mk-ld-hint">Chọn ngày bắt đầu và ngày kết thúc để xem.</div>}
      {!loi && !r.chua && (
        <>
          <div className="mk-ld-kpi">
            <div><span>Chi tiêu quảng cáo · {r.nhan}</span><b>{gon(t.chi)}</b><em>{vnd(t.chi)} đ</em></div>
            <div><span>Lead từ kênh quảng cáo</span><b>{leads ? t.lead : '…'}</b><em>{khac.lead ? '+ ' + khac.lead + ' lead nguồn khác' : 'trong kỳ'}</em></div>
            <div><span>Chi phí / lead</span><b>{t.lead ? gon(t.chi / t.lead) : '—'}</b><em>{best ? 'Rẻ nhất: ' + best.k : 'chưa đủ số liệu'}</em></div>
            <div><span>Đã chốt</span><b>{t.won}</b><em>Tỉ lệ chốt {pct(t.won, t.lead)}</em></div>
            <div><span>Giá trị cơ hội</span><b>{gon(t.val)}</b><em>{t.chi ? 'Gấp ' + (Math.round((t.val / t.chi) * 10) / 10).toLocaleString('vi-VN') + ' lần chi tiêu' : '—'}</em></div>
          </div>

          {view === 'tong' && (
            <div className="mk-ld-wrap">
              <table className="mk-ld-t">
                <thead>
                  <tr><th>Kênh (page)</th><th className="n">Chi tiêu</th><th>Lead</th><th className="n">Chi phí / lead</th><th className="n">Đã chốt</th><th className="n">Tỉ lệ chốt</th><th className="n">Giá trị cơ hội</th></tr>
                </thead>
                <tbody>
                  {rows.map(x => (
                    <tr key={x.k} className={(x.chi || x.lead ? '' : 'mute') + ' click'} onClick={() => { setPage(x.k); setView('page') }} title="Bấm để xem chi tiết page này">
                      <td className="k">{x.k}</td>
                      <td className="n">{x.chi ? vnd(x.chi) : '—'}</td>
                      <td className="bar"><div><span className="b"><i style={{ width: (x.lead / maxLead) * 100 + '%' }} /></span><b>{x.lead}</b></div></td>
                      <td className={'n' + (best && best.k === x.k ? ' best' : '')}>{cpl(x) ? vnd(cpl(x)) : '—'}</td>
                      <td className="n">{x.won || '—'}</td>
                      <td className="n">{pct(x.won, x.lead)}</td>
                      <td className="n">{x.val ? gon(x.val) : '—'}</td>
                    </tr>
                  ))}
                  {khac.lead > 0 && (
                    <tr className="other">
                      <td className="k">Nguồn khác <em>(Zalo, Hotline, giới thiệu…)</em></td>
                      <td className="n">—</td>
                      <td className="bar"><div><span className="b"><i style={{ width: Math.min(100, (khac.lead / maxLead) * 100) + '%' }} /></span><b>{khac.lead}</b></div></td>
                      <td className="n">—</td>
                      <td className="n">{khac.won || '—'}</td>
                      <td className="n">{pct(khac.won, khac.lead)}</td>
                      <td className="n">{khac.val ? gon(khac.val) : '—'}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr><td>Tổng kênh quảng cáo</td><td className="n">{vnd(t.chi)}</td><td className="bar"><div><b>{t.lead}</b></div></td><td className="n">{t.lead ? vnd(t.chi / t.lead) : '—'}</td><td className="n">{t.won}</td><td className="n">{pct(t.won, t.lead)}</td><td className="n">{gon(t.val)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}

          {view === 'bieudo' && (
            <div className="mk-ld-charts">
              <Bars title="Chi tiêu theo kênh" note="đ" rows={rows.map(x => ({ k: x.k, v: x.chi }))} fmt={gon} />
              <Bars title="Lead theo kênh" note="lead" rows={rows.map(x => ({ k: x.k, v: x.lead }))} fmt={v => String(v)} />
              <Bars title="Chi phí mỗi lead" note="thấp hơn là tốt" rows={rows.map(x => ({ k: x.k, v: cpl(x) }))} fmt={gon} best={best && best.k} />
              <Bars title="Tỉ lệ chốt" note="% lead đã chốt" rows={rows.map(x => ({ k: x.k, v: x.lead ? (x.won / x.lead) * 100 : 0 }))} fmt={v => Math.round(v) + '%'} />
              <Days title="Lead theo ngày" note={r.nhan} days={dayRows(null, ds.filter(l => kSet.has(ten(l.source))))} get={d => d.lead} fmt={v => v + ' lead'} />
              <Days title="Chi tiêu theo ngày" note={r.nhan} days={dayRows(null, [])} get={d => d.chi} fmt={v => vnd(v) + ' đ'} />
            </div>
          )}

          {view === 'page' && (
            <div className="mk-ld-page">
              <div className="mk-ld-pages">
                {rows.map(x => (
                  <button key={x.k} type="button" className={x.k === pg ? 'on' : ''} onClick={() => setPage(x.k)}>
                    <b>{x.k}</b><span>{x.lead} lead · {x.chi ? gon(x.chi) : '0'}</span>
                  </button>
                ))}
              </div>
              {pr && (
                <div className="mk-ld-pd">
                  <div className="mk-ld-kpi sm">
                    <div><span>Chi tiêu</span><b>{gon(pr.chi)}</b><em>{vnd(pr.chi)} đ</em></div>
                    <div><span>Lead</span><b>{pr.lead}</b><em>{pct(pr.lead, t.lead + khac.lead)} tổng lead</em></div>
                    <div><span>Chi phí / lead</span><b>{cpl(pr) ? gon(cpl(pr)) : '—'}</b><em>{t.lead ? 'TB các kênh ' + gon(t.chi / t.lead) : '—'}</em></div>
                    <div><span>Đã chốt</span><b>{pr.won}</b><em>Tỉ lệ chốt {pct(pr.won, pr.lead)}</em></div>
                    <div><span>Giá trị cơ hội</span><b>{gon(pr.val)}</b><em>{pr.chi ? 'Gấp ' + (Math.round((pr.val / pr.chi) * 10) / 10).toLocaleString('vi-VN') + ' lần chi tiêu' : '—'}</em></div>
                  </div>
                  <div className="mk-ld-charts two">
                    <Days title={'Chi tiêu theo ngày · ' + pr.k} note={r.nhan} days={dayRows(pr.k, [])} get={d => d.chi} fmt={v => vnd(v) + ' đ'} />
                    <Days title={'Lead theo ngày · ' + pr.k} note={r.nhan} days={dayRows(pr.k, pr.list)} get={d => d.lead} fmt={v => v + ' lead'} />
                  </div>
                  <div className="mk-ld-leads">
                    <div className="ct"><b>Khách hàng tiềm năng từ {pr.k}</b><span>{pr.list.length} lead</span></div>
                    {pr.list.length ? (
                      <table className="mk-ld-t">
                        <thead><tr><th>Ngày</th><th>Khách hàng</th><th>Giai đoạn</th><th className="n">Giá trị ước tính</th></tr></thead>
                        <tbody>
                          {pr.list.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(l => (
                            <tr key={l.id}>
                              <td>{dm(String(l.createdAt || '').slice(0, 10))}</td>
                              <td className="k">{l.name || '—'}</td>
                              <td><span className={'mk-ld-stg' + (WON.indexOf(l.stage) >= 0 ? ' won' : '')}>{STAGE_LABEL[l.stage] || l.stage || '—'}</span></td>
                              <td className="n">{Number(l.valueVnd) ? gon(l.valueVnd) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <div className="mk-ld-hint">Chưa có lead nào chọn nguồn "{pr.k}" trong kỳ này.</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {!rows.some(x => x.lead) && leads && view !== 'page' && <div className="mk-ld-hint">Chưa có lead nào trùng tên kênh trong kỳ. Ở tab Kinh doanh, chọn "Nguồn khách hàng" trong nhóm Marketing để lead được tính vào kênh.</div>}
        </>
      )}
    </div>
  )
}
