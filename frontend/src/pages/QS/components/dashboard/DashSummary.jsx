import Icon from '../../../../components/ui/Icon'
import { money } from '../../lib/format.js'

/* Cột trái Bảng điều khiển: 2 thẻ cộng theo bộ lọc của Danh sách dự án (kiểu thẻ "Gross margin" + "Last 12 weeks").
   A = số đã cộng {n, von, ban, total, ln, bien, vats, groups:[{key, name, value}], done, fail, ready}; nDa = số dự án; label = nhãn bộ lọc.
   Thẻ 1 "Biên lợi nhuận": số % lớn -> chip lợi nhuận -> thanh Giá vốn (gạch chéo) | Lợi nhuận -> 4 dòng số.
   Thẻ 2 "Giá trị theo nhóm": mỗi nhóm 1 dòng tên + số tiền, dưới là thanh ngang (dài theo nhóm lớn nhất, nhóm lớn nhất tô đặc,
   còn lại gạch chéo) + % trên tổng. Tên dài xuống dòng, không bị cắt.
   Số tiền ở các dòng không kèm "đ" (gọn cột); phạm vi lọc nằm dòng riêng dưới tiêu đề để không bị cắt. */
const f1 = x => (Math.round(x * 10) / 10).toLocaleString('vi-VN') + '%'

export default function DashSummary({ A, nDa, label }) {
  const ok = A.ready
  const neg = ok && A.ln < 0
  const vat = A.vats.size === 1 ? 'gồm VAT ' + [...A.vats][0] + '%' : 'gồm VAT'
  const vonPct = ok && A.ban > 0 ? Math.min(100, Math.max(0, A.von / A.ban * 100)) : 0
  const sum = A.groups.reduce((t, g) => t + g.value, 0) || 1
  const max = A.groups.reduce((m, g) => Math.max(m, g.value), 0) || 1
  const num = (x, cls) => (ok ? <b className={cls} title={money(x) + ' đ'}>{money(x)}</b> : <span className="qs-sum-sk" />)
  const pct = x => (x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)) + '%'
  const scope = <span className="qs-sm-sub scope" title="Số liệu cộng theo bộ lọc của Danh sách dự án; mỗi dự án tính bản đang mở hoặc bản nháp mới nhất"><Icon name="filter" size={11} />{nDa} dự án · {label || 'Tất cả'}</span>

  return (
    <>
      <section className="qs-card qs-sm" aria-label="Biên lợi nhuận theo bộ lọc">
        <div className="qs-sm-h"><h3>Biên lợi nhuận</h3>{scope}</div>
        {!ok && <div className="qs-sum-load"><i style={{ width: (nDa ? (A.done + A.fail) / nDa * 100 : 100) + '%' }} />Đang tính {A.done + A.fail}/{nDa} dự án…</div>}
        {ok && A.fail > 0 && <div className="qs-sum-warn"><Icon name="alert" size={13} />{A.fail} dự án chưa tải được, chưa cộng vào tổng</div>}

        <div className="qs-sm-hero">
          {ok ? <b className={'qs-sm-big' + (neg ? ' neg' : '')}>{f1(A.bien)}</b> : <span className="qs-sum-sk qs-sm-bigsk" />}
          {ok && (
            <div className="qs-sm-chiprow">
              <span className={'qs-sm-chip' + (neg ? ' neg' : '')}><i aria-hidden="true">{neg ? '▼' : '▲'}</i>{money(A.ln)} đ</span>
            </div>
          )}
          {/* 1 module có viền mờ: câu giải thích + thanh Giá vốn | Lợi nhuận + chú thích */}
          <div className="qs-sm-split">
            <span className="qs-sm-cap">{neg ? 'Lỗ' : 'Lợi nhuận'} trên giá bán chưa VAT</span>
            <div className={'qs-sm-bar' + (neg ? ' neg' : '')} aria-hidden="true">
              <i className="von" style={{ width: vonPct + '%' }} />
              {!neg && <i className="ln" style={{ width: (100 - vonPct) + '%' }} />}
            </div>
            <div className="qs-sm-barl"><span>Giá vốn {ok ? f1(vonPct) : ''}</span><span className={neg ? 'neg' : 'pos'}>Lợi nhuận {ok ? f1(A.bien) : ''}</span></div>
          </div>
        </div>

        <dl className="qs-sm-rows">
          <div><dt>Tổng thanh toán <em>{vat}</em></dt><dd>{num(A.total)}</dd></div>
          <div><dt>Giá bán <em>chưa VAT</em></dt><dd>{num(A.ban)}</dd></div>
          <div><dt>Giá vốn</dt><dd>{num(A.von)}</dd></div>
          <div><dt>Dòng sản phẩm</dt><dd>{ok ? <b>{A.n.toLocaleString('vi-VN')}</b> : <span className="qs-sum-sk" />}</dd></div>
        </dl>
      </section>

      <section className="qs-card qs-sm" aria-label="Giá trị theo nhóm">
        <div className="qs-sm-h"><h3>Giá trị theo nhóm</h3>{ok && A.groups.length > 0 && <span className="qs-sm-sub">{A.groups.length} nhóm</span>}</div>
        <div className="qs-sm-grp">
          {!ok && [0, 1, 2].map(i => <div key={i} className="qs-sm-g"><span className="qs-sum-sk w" /></div>)}
          {ok && !A.groups.length && <div className="qs-sum-empty">Chưa có hạng mục nào trong các dự án đang lọc.</div>}
          {ok && A.groups.map(g => (
            <div key={g.key} className="qs-sm-g" title={(g.name || g.key) + ': ' + money(g.value) + ' đ (' + pct(g.value / sum) + ')'}>
              <div className="t"><span className="nm">{g.name || g.key}</span><b>{money(g.value)}</b></div>
              <div className="tr">
                <span className="track"><i className={g.value === max ? 'top' : ''} style={{ width: Math.max(1.5, g.value / max * 100) + '%' }} /></span>
                <span className="pc">{pct(g.value / sum)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
