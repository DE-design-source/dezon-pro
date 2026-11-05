/* CSS tài liệu báo giá - QS_DOC_CSS của bản gốc (PUB/baogia.js:590-694) chép nguyên văn, rồi:
     - đổi tên class qua docClass_ (.qs-page -> .qsd-pg, .qs-doc -> .qsd-doc, qx-/qp-/qc-/qd/qsum/qpager/qpg -> qsd-...) [F1];
     - màu chủ đạo thay 5 sắc navy như bgDocCss_ (696);
     - trên màn hình: mọi selector có tiền tố vùng xem trước (scopeCss), thẻ <style> nằm trong component, không vào document.head;
     - bản in (printDoc 699-715): CSS riêng trong cửa sổ in. */
import { docClass_ } from './docModel'
import { BG_MAU_DS } from '../../lib/quote.js'
import { FONT_CATALOG, findFont } from '../../../../data/fontCatalog'

const QS_DOC_CSS = ''
+ '.qs-doc{display:flex;justify-content:center;margin:16px 0 4px;overflow-x:auto;padding-bottom:6px}'
+ '.qs-page{width:1123px;min-height:794px;background:#fff;border:1px solid #e6e9ee;border-radius:10px;box-shadow:0 8px 30px rgba(20,40,80,.10);padding:54px 60px 48px;box-sizing:border-box;position:relative;font-family:Arial,Helvetica,sans-serif;color:#1f2937}'
+ '.qp-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9aa4b2;border-bottom:1px solid #eef1f4;padding-bottom:9px;margin-bottom:28px}'
+ '.qp-proj{font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.4px}'
+ '.qp-foot{position:absolute;left:60px;right:60px;bottom:22px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:10px;color:#aab3c0;padding-top:8px}'
+ '.qp-foot .qp-mid{flex:1;text-align:center;color:#6b7280;font-weight:600;letter-spacing:.02em}'
+ '.qp-title{font-size:19px;font-weight:800;letter-spacing:.5px;text-align:center;margin:4px 0 24px;color:#1f2937}'
+ '.qp-title.sm{font-size:15px;margin:2px 0 16px;text-align:left;color:#0f2942}'
+ '.qc-cover{text-align:center;margin:2px 0 20px}'
+ '.qc-title{font-size:22px;font-weight:800;letter-spacing:.6px;color:#0f2942}'
+ '.qc-sub{font-size:12.5px;font-style:italic;color:#64748b;margin-top:3px}'
+ '.qc-code{font-size:12px;color:#475569;margin-top:8px}'
+ '.qc-info{width:100%;border-collapse:collapse;margin-top:16px;text-align:left;table-layout:fixed}'
+ '.qc-info td{border:1px solid #dfe4ea;padding:8px 10px;font-size:12px;vertical-align:middle}'
+ '.qc-info td.k{background:#f4f6f9;color:#5b6b7b;font-weight:600;width:20%}'
+ '.qc-info td.v{color:#1f2937;font-weight:600;width:30%}'
+ '.qsum-card{border:1px solid #ececec;border-radius:12px;padding:12px 26px}'
+ '.qx-img{width:100%;height:auto;max-height:240px;object-fit:contain;display:block;margin:0 auto;background:#fff}'
+ '.qx-ma{display:block;font-size:8px;color:#9aa3af;font-weight:400;margin-top:1px}'
+ '.qx-cover td.hm{font-weight:700}'
+ '.qx-tbl.qx-cover tr.lv1 td{font-weight:700;background:#7c7c7c;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
+ '.qx-tbl:not(.qx-totbox) tbody tr:nth-child(even of :not(.sec):not(.lv1):not(.qx-h)) td{background:#f1f3f6;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
+ '.qx-cover tr.lv3 td:first-child{padding-left:14px}'
+ '.qsum{width:100%;border-collapse:collapse}'
+ '.qsum td{padding:9px 2px;vertical-align:baseline}'
+ '.qsum .amt{width:150px;color:#374151;font-variant-numeric:tabular-nums}'
+ '.qsum .pct{width:78px;text-align:right;color:#374151}'
+ '.qsum tr.lv1 td{font-weight:700;font-size:14px;border-top:1px solid #ededed}'
+ '.qsum tr.lv1:first-child td{border-top:none}'
+ '.qsum tr.lv2 td{font-weight:400;font-size:12.5px;color:#6b7280}'
+ '.qsum tr.lv2 .nm{padding-left:22px}'
+ '.qsum tr.qsum-tot td{border-top:2px solid #222;font-weight:800;font-size:14px;padding-top:12px}'
+ '.qd{width:100%;border-collapse:collapse;font-size:12px}'
+ '.qd-h th{background:#0f2942;color:#fff;font-weight:600;padding:9px 8px;text-align:left;font-size:11px;letter-spacing:.3px}'
+ '.qd-h th.num{text-align:right}'
+ '.qd td{padding:8px;border-bottom:1px solid #eef1f4;vertical-align:top}'
+ '.qd td.num{text-align:right;font-variant-numeric:tabular-nums}'
+ '.qd td.ct{text-align:center;color:#64748b}'
+ '.qd .qd-sec td{background:#f1f5f9;font-weight:700;color:#0f2942;padding:7px 8px}'
+ '.qd-br{color:#94a3b8;font-weight:400;font-size:11px}'
+ '.qd-desc{color:#94a3b8;font-size:10.5px;margin-top:2px;line-height:1.35}'
+ '.qd-sum td{font-size:13px;padding:10px 8px}'
+ '.qd-sum .qd-grand td{border-top:2px solid #0f2942;font-weight:800;font-size:15px;color:#0f2942}'
+ '.qpager{display:flex;gap:8px;justify-content:center;align-items:center;margin:14px 0 30px}'
+ '.qpg{min-width:34px;height:34px;padding:0 8px;border:1px solid #e2e8f0;background:#fff;border-radius:8px;font-weight:600;color:#475569;cursor:pointer;font-size:14px}'
+ '.qpg:hover{border-color:#c3ccd8}'
+ '.qpg.on{background:#111827;color:#fff;border-color:#111827}'
+ '.qpg-ell{color:#94a3b8;padding:0 2px}'
+ '.qx-page{padding:34px 38px 42px}'
+ '.qx-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:4px}'
+ '.qx-brand{font-size:26px;font-weight:700;letter-spacing:.16em;color:#0f2942;line-height:1}'
+ '.qx-org{font-size:9.5px;color:#5b6b7b;line-height:1.65;margin-top:8px;letter-spacing:.01em}'
+ '.qx-titlebox{background:#12314f;color:#fff;text-align:center;padding:13px 22px;min-width:280px}'
+ '.qx-titlebox .t1{font-size:12.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}'
+ '.qx-titlebox .t2{font-size:11px;font-weight:500;margin-top:5px;letter-spacing:.04em;color:#c7d6e6}'
+ '.qx-info{width:100%;border-collapse:collapse;margin:20px 0 0;table-layout:fixed;border-top:1px solid #dbe1e9;border-bottom:1px solid #dbe1e9}'
+ '.qx-info td{padding:8px 12px;font-size:10.5px;vertical-align:top;border-bottom:1px solid #eef1f5}' + '.qx-info tr:last-child td{border-bottom:none}'
+ '.qx-info td.k{font-weight:600;color:#8a96a5;width:16%;font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding-top:10px}'
+ '.qx-info td.v{color:#1f2937;width:34%;font-weight:500}'
+ '.qx-secttl{font-size:10.5px;font-weight:600;color:#12233a;letter-spacing:.12em;text-transform:uppercase;margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid #dbe1e9}'
+ '.qx-tbl{width:100%;border-collapse:collapse;font-size:10.5px}'
+ '.qx-tbl th{background:#12314f;color:#fff;font-weight:600;padding:9px 8px;text-align:left;font-size:9px;vertical-align:middle;border-right:1px solid #ffffff1f;text-transform:uppercase;letter-spacing:.05em;line-height:1.25}'
+ '.qx-tbl th.num{text-align:right}.qx-tbl th.ct{text-align:center}'
+ '.qx-tbl th:last-child{border-right:none}'
+ '.qx-tbl td{padding:8px;border-right:1px solid #e6eaef;border-bottom:1px solid #eef1f5;vertical-align:top;line-height:1.45}'
+ '.qx-tbl td:last-child{border-right:none}'
+ '.qx-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}'
+ '.qx-tbl td.ct{text-align:center}'
+ '.qx-tbl td.it{font-style:italic;color:#7c7c7c}'
+ '.qx-tbl tr.sec td{background:#7c7c7c;font-weight:700;color:#fff;letter-spacing:.02em;border-top:1px solid #7c7c7c;border-bottom:1px solid #7c7c7c;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
+ '.qx-desc{color:#6b7280;font-size:9.5px;line-height:1.35;margin-top:2px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;line-clamp:5;overflow:hidden}'
+ '.qx-totbox{margin-top:0}' + '.qx-tbl tr.sec .bchu{font-weight:500;font-size:.92em;opacity:.9}.qx-tbl tr.sec .bchu i{font-weight:400}' + '.qx-biatong{margin-top:14px}.qx-biatong:first-child{margin-top:0}'
/* tổng của 1 hạng mục ở đầu trang (bên phải tiêu đề hạng mục) */
+ '.qx-secttl{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.qx-hmtong{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;text-transform:none;letter-spacing:0;font-weight:500}'
+ '.qx-hmtong span{border:1px solid #dbe1e9;border-radius:6px;padding:3px 9px;font-size:9.5px;color:#5b6b7b;white-space:nowrap;font-variant-numeric:tabular-nums}.qx-hmtong b{color:#12233a;font-weight:700;margin-left:3px}'
+ '.qx-hmtong span.g{background:#12314f;border-color:#12314f;color:#c7d6e6;-webkit-print-color-adjust:exact;print-color-adjust:exact}.qx-hmtong span.g b{color:#fff}'
+ '.qx-tongnhe tr.grand td{font-weight:700;font-size:11.5px;color:#12233a;background:#f7f9fb}.qx-tongnhe .chu{padding:7px 12px;border-top:1px solid #eef1f4;font-size:10.5px;color:#12233a}.qx-tongnhe .chu i{color:#6b7785}'
+ '.qx-totbox td{background:#12314f;color:#fff;padding:9px 12px;font-size:11.5px;font-weight:600;border-right:none;border-bottom:1px solid #ffffff1a;font-variant-numeric:tabular-nums}' + '.qx-totbox tr:last-child td{background:#0e2740;font-size:12.5px;font-weight:700}'
+ '.qx-totbox td.lbl{text-align:right;letter-spacing:.06em;text-transform:uppercase;font-size:10px;font-weight:500;color:#c7d6e6}'
+ '.qx-notes{background:#f7f9fb;border:1px solid #e6eaef;padding:12px 16px;margin-top:18px;font-size:10px;color:#7c7c7c;line-height:1.6}'
+ '.qx-notes .h{font-weight:600;margin-bottom:5px;color:#12233a;letter-spacing:.05em;text-transform:uppercase;font-size:9px}'
+ '.qx-notes ol{margin:0;padding-left:20px}.qx-notes li{margin:3px 0}'
+ '.qx-sign{display:flex;margin-top:18px;border:1px solid #e6eaef}'
+ '.qx-tbl{table-layout:fixed}'
+ '.qx-tbl th,.qx-tbl td{overflow-wrap:anywhere;word-break:break-word}'
+ '.qx-tbl th{overflow-wrap:normal;word-break:normal;hyphens:none}'
+ '.qx-tbl td.num{white-space:nowrap;overflow-wrap:normal;word-break:normal}'
+ '.qx-tbl th{position:relative}'
+ '.qx-tbl.qx-dense{font-size:9.5px}.qx-tbl.qx-dense th{font-size:8px;padding:7px 5px}.qx-tbl.qx-dense td{padding:6px 5px}'
+ '.qx-tbl.qx-dense2{font-size:8.5px}.qx-tbl.qx-dense2 th{font-size:7.5px;padding:6px 3px;letter-spacing:0}.qx-tbl.qx-dense2 td{padding:5px 3px}'
/* hàng tiêu đề cột bảng chi tiết / phần thô cao bằng nhau ở mọi trang = đúng 3 dòng chữ (balanceCols_ giữ tiêu đề <= 3 dòng) + đệm trên dưới */
+ '.qx-tbl:not(.qx-cover) tr.qx-h th{box-sizing:border-box;height:calc(3.75em + 18px)}'
/* nền cả hàng tiêu đề / đề mục lớn = nền ô: khi phóng to / thu nhỏ, mép các ô lệch nửa điểm ảnh lộ khe sáng như vạch dọc dù đã tắt Kẻ cột */
+ '.qx-tbl tr.qx-h{background:#12314f;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
/* khối tổng tờ bìa: dòng tổng (tg1) theo màu đề mục lớn; chiết khấu / VAT (tg2) nền nhạt; tổng gồm VAT (tg3) màu chủ đạo */
+ '.qx-tbl tr.sec.tg2 td{background:#eef1f5;color:#12233a;border-color:#eef1f5}.qx-tbl tr.sec.tg2{background:#eef1f5}'
+ '.qx-tbl tr.sec.tg3 td{background:#12314f;color:#fff;border-color:#12314f}.qx-tbl tr.sec.tg3{background:#12314f}'
/* 3 dòng khối tổng cao bằng nhau = đủ 2 dòng chữ + chút dư (bằng chữ ở dòng cuối có thể xuống 2 dòng) + đệm trên dưới */
+ '.qx-tbl tr.sec.tg1 td,.qx-tbl tr.sec.tg2 td,.qx-tbl tr.sec.tg3 td{box-sizing:border-box;height:calc(3em + 16px)}'
+ '.qx-tbl.qx-dense:not(.qx-cover) tr.qx-h th{height:calc(3.75em + 14px)}.qx-tbl.qx-dense2:not(.qx-cover) tr.qx-h th{height:calc(3.75em + 12px)}'
+ '.qx-tbl th[draggable]{cursor:grab}.qx-tbl th[draggable]:active{cursor:grabbing}'
+ '.qxrsz{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:2}'
+ '.qxrsz:hover{background:#ffffff55}'
+ '@media print{.qxrsz{display:none}}'
+ '.qx-sign .col{flex:1}.qx-sign .col + .col{border-left:1px solid #d9dee5}.qx-sign .ghi{text-align:center;font-size:9px;font-style:italic;color:#8a96a5;padding-top:6px}'
+ '.qx-sign .hd{background:#f7f9fb;font-weight:600;font-size:10px;padding:9px;color:#12233a;text-align:center;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #e6eaef}'
+ '.qx-sign .sp{height:90px}'
+ '.qx-sign .nm{text-align:center;font-size:10.5px;font-weight:600;color:#12233a;padding:0 8px 10px;min-height:22px}'
+ '.qx-logo{max-height:46px;max-width:190px;object-fit:contain;display:block;margin-bottom:6px}'
+ '.qx-brand.sm{font-size:15px;letter-spacing:.06em}'
+ '.qx-head.rong{flex-direction:column;align-items:stretch;gap:12px}.qx-head.rong .qx-titlebox{flex:none;padding:16px 26px}'
+ '.qx-titlebox .t3{font-size:10px;margin-top:7px;color:#c7d6e6;letter-spacing:.02em}.qx-titlebox .t3 b{color:#fff}'
+ '.qx-totbox tr.grand td{background:#0b2438;font-size:12.5px;font-weight:700}.qx-totbox tr.grand td.lbl{color:#fff;font-size:10.5px}'
+ '.qx-bangchu{border:1px solid #e6eaef;border-top:none;padding:8px 12px;font-size:10.5px;color:#12233a;background:#fbfcfd}'
+ '.qx-bangchu i{color:#6b7785}'
+ '.qx-dot{margin-top:14px;border:1px solid #e6eaef}'
+ '.qx-dot .h{background:#f7f9fb;padding:7px 12px;font-size:9px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#12233a}'
+ '.qx-dot table{width:100%;border-collapse:collapse;font-size:10.5px}'
+ '.qx-dot th{font-size:9px;font-weight:600;color:#6b7785;text-align:left;padding:6px 12px;border-top:1px solid #eef1f4}'
+ '.qx-dot td{padding:6px 12px;border-top:1px solid #eef1f4;color:#1f2d3d}'
+ '.qx-dot .num{text-align:right;font-variant-numeric:tabular-nums}'

/* Đổi tên class trong phần selector (phần khai báo không có ".chữ" nên regex không đụng tới) */
function renameCss_(css) {
  return css.replace(/\.([a-zA-Z][\w-]*)/g, (m, tok) => '.' + docClass_(tok))
}
const DOC_CSS = renameCss_(QS_DOC_CSS)

/* bgDocCss_: CSS theo MÀU chủ đạo (thẻ "Giao diện báo giá"), dùng cho cả màn hình lẫn bản in */
/* ---------- Font & cỡ chữ của báo giá (bgCfg.font, bgCfg.co; thẻ "Giao diện báo giá") ----------
   font: '' = theo font của Cài đặt chung (biến --app-font, mặc định Montserrat); khác = giá trị CSS của FONT_CATALOG.
   co: % cỡ chữ (90 / 100 / 110 / 120), nhân mọi font-size của tài liệu (màn hình + bản in). */
export const BG_CO_DS = [[90, 'Nhỏ'], [100, 'Vừa'], [110, 'Lớn'], [120, 'Rất lớn']]
/* Cỡ chữ theo SỐ (coSo / hdSo, 8–20, mặc định 12 = 100%); bản cũ lưu co / hdCo theo % (Nhỏ / Vừa / Lớn / Rất lớn) */
export const BG_SO_MIN = 8
export const BG_SO_MAX = 20
const bgSo_ = v => v != null && v !== '' && Number(v) >= BG_SO_MIN && Number(v) <= BG_SO_MAX
export function bgSoOf_(pct) { return Math.round(pct / 100 * 12 * 2) / 2 }
export const TT_CO_MIN = 6
export const TT_CO_MAX = 30
const fontOk_ = v => (/^[A-Za-z0-9 ,'-]{1,80}$/.test(v || '') ? v : '')
const mauOk_ = v => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '')
function ttKieu_(c) {
  const tk = (bgSo_(c.ttSo) ? Number(c.ttSo) : 12) / 12
  const co = (v, px) => (Number(v) >= TT_CO_MIN && Number(v) <= TT_CO_MAX ? Number(v) : Math.round(px * tk * 10) / 10)
  return {
    ttkCo: co(c.ttkCo, 12), ttkFont: fontOk_(c.ttkFont), ttkMau: mauOk_(c.ttkMau),
    ttvCo: co(c.ttvCo, 12), ttvFont: fontOk_(c.ttvFont), ttvMau: mauOk_(c.ttvMau),
  }
}
/* Khung của 1 mục (tiền tố pre): Bao (viền bao) + Bo (bo góc) · Ngang / Doc (kẻ ngang / dọc) + Lui / LuiD (lùi 2 đầu)
   · nét riêng B / N / D (Day · Kieu · Mau) · Cach (khoảng cách dòng). Khoá cũ không chữ B/N/D (pre+Day / Kieu / Mau) và tdkVien làm mặc định */
const KH_SUF = ['Bao', 'Bo', 'Ngang', 'Doc', 'Day', 'Kieu', 'Mau', 'Cach', 'Lui', 'LuiD', 'BDay', 'BKieu', 'BMau', 'NDay', 'NKieu', 'NMau', 'DDay', 'DKieu', 'DMau', 'Vien']
export const khungKeys_ = pre => KH_SUF.map(x => pre + x)
export const TK_KHUNG_KEYS = khungKeys_('tk')
export const TK_LUI_MAX = 80
export const TK_MAU_MAC = '#dbe1e9'
const KH_DAY = ['manh', 'vua', 'day']
export const KH_W_MIN = 0.25
export const KH_W_MAX = 4
/* độ dày nét (px) từ giá trị lưu: số px hoặc manh / vua / day */
export const khungW_ = v => (typeof v === 'number' ? v : { manh: 1, vua: 1.5, day: 2 }[v] || 1)
const KH_KIEU = ['lien', 'dut', 'cham']
function khung_(c, pre, mac) {
  const g = x => c[pre + x]
  const so = (v, a, b, m) => (v != null && v !== '' && Number(v) >= a && Number(v) <= b ? Number(v) : m)
  const o = {
    [pre + 'Set']: KH_SUF.some(x => g(x) != null),
    [pre + 'Bao']: g('Bao') != null ? g('Bao') === true : (g('Vien') != null ? g('Vien') === true : mac.bao),
    [pre + 'Bo']: so(g('Bo'), 0, 20, 0),
    [pre + 'Ngang']: g('Ngang') != null ? g('Ngang') !== false : mac.ngang,
    [pre + 'Doc']: g('Doc') != null ? g('Doc') === true : mac.doc,
    [pre + 'Cach']: so(g('Cach'), 2, 24, mac.cach),
    [pre + 'Lui']: so(g('Lui'), 0, TK_LUI_MAX, 0), [pre + 'LuiD']: so(g('LuiD'), 0, TK_LUI_MAX, 0),
  }
  ;['B', 'N', 'D'].forEach(x => {
    /* độ dày: số px (thanh kéo, 0,25–4) hoặc tên cũ manh / vua / day */
    const dayOk = v => KH_DAY.indexOf(v) >= 0 || (typeof v === 'number' && v >= KH_W_MIN && v <= KH_W_MAX)
    o[pre + x + 'Day'] = dayOk(g(x + 'Day')) ? g(x + 'Day') : (dayOk(g('Day')) ? g('Day') : mac.day)
    o[pre + x + 'Kieu'] = KH_KIEU.indexOf(g(x + 'Kieu')) >= 0 ? g(x + 'Kieu') : (KH_KIEU.indexOf(g('Kieu')) >= 0 ? g('Kieu') : mac.kieu)
    o[pre + x + 'Mau'] = mauOk_(g(x + 'Mau')) || mauOk_(g('Mau')) || mac['mau' + x]
  })
  return o
}
/* nét CSS của 1 đường (x = B / N / D) */
export function khungNet_(chu, pre, x) {
  return khungW_(chu[pre + x + 'Day']) + 'px ' + ({ lien: 'solid', dut: 'dashed', cham: 'dotted' }[chu[pre + x + 'Kieu']] || 'solid') + ' ' + chu[pre + x + 'Mau']
}
function ctMac_(c) {
  const luoi = ['du', 'ngang', 'doc', 'khong'].indexOf(c.vLuoi) >= 0 ? c.vLuoi : 'du'
  const mau = /^#[0-9a-f]{6}$/i.test(c.vMau || '') ? c.vMau : BG_VIEN_MAU
  return {
    bao: c.vNgoai !== false, ngang: luoi === 'du' || luoi === 'ngang', doc: luoi === 'du' || luoi === 'doc', cach: 8,
    day: KH_DAY.indexOf(c.vDay) >= 0 ? c.vDay : 'manh', kieu: KH_KIEU.indexOf(c.vKieu) >= 0 ? c.vKieu : 'lien',
    mauB: mau === BG_VIEN_MAU ? '#cfd6de' : mau, mauN: mau, mauD: mau,
  }
}
const hex_ = v => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '')
export function bgChu_(bgCfg) {
  const c = bgCfg || {}
  const co = Number(c.co)
  const hdCo = Number(c.hdCo)
  return {
    font: String(c.font || ''), co: bgSo_(c.coSo) ? Number(c.coSo) / 12 * 100 : (BG_CO_DS.some(x => x[0] === co) ? co : 100),
    /* Đề mục lớn (dòng mục 1, 2, 3… của tờ bìa + dòng mục của bảng chi tiết): nền, màu chữ, cỡ chữ (% so với chữ bảng), font */
    hdNen: /^#[0-9a-f]{6}$/i.test(c.hdNen || '') ? c.hdNen : BG_HD_NEN, hdChu: c.hdChu === 'den' ? 'den' : 'trang',
    /* Bảng thông tin dự án trên tờ bìa: cỡ chữ theo số (ttSo, mặc định 12) + font riêng (ttFont, '' = như font báo giá) */
    ttSo: bgSo_(c.ttSo) ? Number(c.ttSo) : 12, ttFont: String(c.ttFont || ''),
    /* Tuỳ biến riêng cột nhãn (ttk*) và cột nội dung (ttv*): cỡ chữ px, font, màu; chưa đặt thì theo ttSo / ttFont / màu mặc định */
    ...ttKieu_(c),
    /* Khung bảng thông tin dự án: tkBao (viền bao), tkBo (bo góc px), tkNgang / tkDoc (kẻ dòng / kẻ cột), tkDay / tkKieu / tkMau (nét), tkCach (khoảng cách dòng px) */
    ...khung_(c, 'tk', { bao: false, ngang: true, doc: false, cach: 8, day: 'manh', kieu: 'lien', mauB: TK_MAU_MAC, mauN: TK_MAU_MAC, mauD: TK_MAU_MAC }),
    /* Khung tiêu đề (hộp nền màu): viền + bo góc, kẻ ngang giữa các dòng chữ */
    ...khung_(c, 'tdk', { bao: false, ngang: false, doc: false, cach: 6, day: 'manh', kieu: 'lien', mauB: '#0b2438', mauN: '#c7d6e6', mauD: '#c7d6e6' }),
    /* Khung bảng chi tiết hạng mục: chưa đặt thì theo Viền bảng cũ (vNgoai / vLuoi / vDay / vKieu / vMau) */
    ...khung_(c, 'ctk', ctMac_(c)),
    hdCo: bgSo_(c.hdSo) ? Number(c.hdSo) / 12 * 100 : (BG_CO_DS.some(x => x[0] === hdCo) ? hdCo : 100), hdFont: String(c.hdFont || ''),
    /* Tiêu đề cột (hàng đầu bảng hạng mục tờ bìa + bảng chi tiết): nền ('' = theo màu chủ đạo), màu chữ, cỡ chữ (cotSo, mặc định 12 = 100%), font */
    cotNen: /^#[0-9a-f]{6}$/i.test(c.cotNen || '') ? c.cotNen : '', cotChu: c.cotChu === 'den' ? 'den' : 'trang',
    cotCo: bgSo_(c.cotSo) ? Number(c.cotSo) / 12 * 100 : 100, cotFont: String(c.cotFont || ''),
    /* Khối tổng tờ bìa: nền 3 kiểu dòng (tgNen1 tổng · tgNen2 chiết khấu / VAT · tgNen3 tổng gồm VAT; '' = mặc định), cỡ chữ, font */
    tgNen1: /^#[0-9a-f]{6}$/i.test(c.tgNen1 || '') ? c.tgNen1 : '', tgNen2: /^#[0-9a-f]{6}$/i.test(c.tgNen2 || '') ? c.tgNen2 : '',
    tgNen3: /^#[0-9a-f]{6}$/i.test(c.tgNen3 || '') ? c.tgNen3 : '', tgCo: bgSo_(c.tgSo) ? Number(c.tgSo) / 12 * 100 : 100, tgFont: String(c.tgFont || ''),
    /* Trang bìa sau (tiến độ thanh toán · tổng giá trị · ghi chú · ô ký): nền + chữ tiêu đề khối, màu viền, nền dòng Thành tiền sau thuế
       ('' = mặc định), cỡ chữ (tsSo, mặc định 12 = 100%), font */
    tsNen: hex_(c.tsNen), tsChu: hex_(c.tsChu), tsVien: hex_(c.tsVien), tsTong: hex_(c.tsTong),
    tsCo: bgSo_(c.tsSo) ? Number(c.tsSo) / 12 * 100 : 100, tsFont: String(c.tsFont || ''),
    /* Viền bảng: vNgoai = viền bao ngoài (mặc định bật); vLuoi = lưới bên trong: 'du' (ngang + dọc) | 'ngang' | 'doc' | 'khong' */
    vNgoai: c.vNgoai !== false, vLuoi: ['du', 'ngang', 'doc', 'khong'].indexOf(c.vLuoi) >= 0 ? c.vLuoi : 'du',
    /* thêm: độ dày lưới, kiểu nét, màu nét, viền ngoài đậm, sọc xen kẽ (mặc định bật), canh dọc nội dung ô (mặc định giữa) */
    vDay: ['manh', 'vua', 'day'].indexOf(c.vDay) >= 0 ? c.vDay : 'manh', vKieu: ['lien', 'dut', 'cham'].indexOf(c.vKieu) >= 0 ? c.vKieu : 'lien',
    vMau: /^#[0-9a-f]{6}$/i.test(c.vMau || '') ? c.vMau : BG_VIEN_MAU, vNgoaiDam: !!c.vNgoaiDam, soLe: c.soLe !== false,
    canhDoc: ['tren', 'giua', 'duoi'].indexOf(c.canhDoc) >= 0 ? c.canhDoc : 'giua',
  }
}
export const BG_HD_NEN = '#7c7c7c'
export const BG_HD_NEN_DS = ['#7c7c7c', '#4b5563', '#1f2937', '#e5e7eb', '#dbeafe', '#fef3c7']
export const BG_COT_NEN_DS = ['#12314f', '#1f2937', '#4b5563', '#7c7c7c', '#e5e7eb', '#dbeafe']
export const BG_TS_NEN_DS = ['#f7f9fb', '#eef2f7', '#e8f0fa', '#fef7e6', '#12314f', '#1f2937']
export const BG_TS_CHU_DS = ['#12233a', '#1f2937', '#1b436f', '#7c7c7c', '#ffffff']
export const BG_TS_VIEN_DS = ['#e6eaef', '#cfd6de', '#9aa3af', '#1b436f', '#1f2937']
export const BG_TG_NEN_DS = ['#12314f', '#1b436f', '#1f2937', '#7c7c7c', '#eef1f5', '#dbeafe', '#fef3c7']
/* chữ trắng trên nền tối, chữ đậm trên nền sáng (độ sáng tương đối) */
export function chuTuongPhan_(hex) {
  const n = parseInt(String(hex || '').slice(1), 16); if (isNaN(n)) return '#fff'
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#12233a' : '#fff'
}
export const BG_LUOI_DS = [['du', 'Đầy đủ'], ['ngang', 'Ngang'], ['doc', 'Dọc'], ['khong', 'Không']]
export const BG_VIEN_MAU = '#e6eaef'
export const BG_VIEN_MAU_DS = ['#e6eaef', '#cfd6de', '#9aa3af', '#4b5563', '#000000']
export const BG_DAY_DS = [['manh', 'Mảnh'], ['vua', 'Vừa'], ['day', 'Dày']]
export const BG_KIEU_DS = [['lien', 'Liền'], ['dut', 'Đứt'], ['cham', 'Chấm']]
export const BG_CANH_DS = [['tren', 'Trên'], ['giua', 'Giữa'], ['duoi', 'Dưới']]
/* CSS tuỳ chỉnh đề mục + viền bảng (viết bằng tên class gốc, renameCss_ đổi như DOC_CSS) */
function bgTuyCss_(chu) {
  if (!chu) return ''
  const hd = '.qx-tbl.qx-cover tr.lv1 td,.qx-tbl tr.sec td'
  const fc = chu.hdChu === 'den' ? '#1f2937' : '#fff'
  let css = hd + '{background:' + chu.hdNen + ';color:' + fc + ';border-color:' + chu.hdNen + ';font-size:' + Math.round(10.5 * chu.hdCo) / 100 + 'px'
    + (chu.hdFont ? ';font-family:' + famCss_(chu.hdFont) : '') + '}'
    + '.qx-tbl.qx-cover tr.lv1,.qx-tbl tr.sec{background:' + chu.hdNen + ';-webkit-print-color-adjust:exact;print-color-adjust:exact}'
  /* tiêu đề cột: chỉ ghi phần đã đặt; cỡ chữ nhân theo cỡ gốc của từng độ dày bảng (9 / 8 / 7.5px) */
  const th = '.qx-tbl tr.qx-h th'
  let cot = ''
  if (chu.cotNen) cot += 'background:' + chu.cotNen + ';'
  if (chu.cotChu === 'den') cot += 'color:#1f2937;border-right-color:#0000001a;'
  if (chu.cotFont) cot += 'font-family:' + famCss_(chu.cotFont) + ';'
  if (cot) css += th + '{' + cot + '}'
  if (chu.cotNen) css += '.qx-tbl tr.qx-h{background:' + chu.cotNen + '}'
  ;[1, 2, 3].forEach(function (i) {
    const n = chu['tgNen' + i]
    if (n) css += '.qx-tbl tr.sec.tg' + i + ' td{background:' + n + ';color:' + chuTuongPhan_(n) + ';border-color:' + n + '}.qx-tbl tr.sec.tg' + i + '{background:' + n + '}'
  })
  /* trang bìa sau: chỉ ghi phần đã đặt */
  // ghi chú: chỉ dải tiêu đề nhận nền (thân ghi chú giữ nền nhạt cho dễ đọc)
  if (chu.tsNen) css += '.qx-dot .h,.qx-notes .h,.qx-sign .hd{background:' + chu.tsNen + ';-webkit-print-color-adjust:exact;print-color-adjust:exact}.qx-notes .h{margin:-12px -16px 8px;padding:8px 16px}'
  if (chu.tsChu) css += '.qx-dot .h,.qx-notes .h,.qx-sign .hd,.qx-sign .nm{color:' + chu.tsChu + '}'
  if (chu.tsVien) css += '.qx-dot,.qx-notes,.qx-sign,.qx-sign .hd{border-color:' + chu.tsVien + '}.qx-dot th,.qx-dot td,.qx-tongnhe .chu{border-top-color:' + chu.tsVien + '}.qx-sign .col + .col{border-left-color:' + chu.tsVien + '}'
  if (chu.tsTong) css += '.qx-tongnhe tr.grand td{background:' + chu.tsTong + ';color:' + chuTuongPhan_(chu.tsTong) + ';-webkit-print-color-adjust:exact;print-color-adjust:exact}'
  if (chu.tsFont) css += '.qx-dot,.qx-notes,.qx-sign{font-family:' + famCss_(chu.tsFont) + '}'
  if (chu.tsCo !== 100) {
    const k = chu.tsCo / 100; const r = n => Math.round(n * k * 10) / 10 + 'px'
    css += '.qx-dot table{font-size:' + r(10.5) + '}.qx-dot .h,.qx-dot th,.qx-notes .h{font-size:' + r(9) + '}.qx-notes{font-size:' + r(10) + '}'
      + '.qx-sign .hd{font-size:' + r(10) + '}.qx-sign .nm,.qx-tongnhe .chu{font-size:' + r(10.5) + '}.qx-tongnhe tr.grand td{font-size:' + r(11.5) + '}'
  }
  if (chu.tgCo !== 100 || chu.tgFont) {
    css += '.qx-tbl tr.sec.tg1 td,.qx-tbl tr.sec.tg2 td,.qx-tbl tr.sec.tg3 td{' + (chu.tgCo !== 100 ? 'font-size:' + Math.round(10.5 * chu.tgCo) / 100 + 'px;' : '')
      + (chu.tgFont ? 'font-family:' + famCss_(chu.tgFont) : '') + '}'
  }
  if (chu.cotCo !== 100) {
    const k = chu.cotCo / 100
    css += th + '{font-size:' + Math.round(9 * k * 10) / 10 + 'px}.qx-tbl.qx-dense tr.qx-h th{font-size:' + Math.round(8 * k * 10) / 10 + 'px}'
      + '.qx-tbl.qx-dense2 tr.qx-h th{font-size:' + Math.round(7.5 * k * 10) / 10 + 'px}'
  }
  const tk = (chu.ttSo || 12) / 12
  css += '.qx-info td{font-size:' + Math.round(10.5 * tk * 10) / 10 + 'px' + (chu.ttFont ? ';font-family:' + famCss_(chu.ttFont) : '') + '}'
    + '.qx-info td.k{font-size:' + chu.ttkCo + 'px' + (chu.ttkFont ? ';font-family:' + famCss_(chu.ttkFont) : '') + (chu.ttkMau ? ';color:' + chu.ttkMau : '') + '}'
    + '.qx-info td.v{font-size:' + chu.ttvCo + 'px' + (chu.ttvFont ? ';font-family:' + famCss_(chu.ttvFont) : '') + (chu.ttvMau ? ';color:' + chu.ttvMau : '') + '}'
  if (chu.tdkSet) {
    css += '.qx-titlebox{border-radius:' + chu.tdkBo + 'px' + (chu.tdkBao ? ';border:' + khungNet_(chu, 'tdk', 'B') : '') + '}'
    if (chu.tdkNgang) css += '.qx-titlebox .t2,.qx-titlebox .t3{border-top:' + khungNet_(chu, 'tdk', 'N') + ';margin:' + chu.tdkCach + 'px ' + chu.tdkLui + 'px 0;padding-top:' + chu.tdkCach + 'px}'
  }
  if (chu.tkSet) {
    const net = x => khungNet_(chu, 'tk', x)
    const bnet = net('B')
    css += '.qx-info{border-collapse:separate;border-spacing:0;padding:' + chu.tkLuiD + 'px ' + chu.tkLui + 'px;'
      + (chu.tkBao ? 'border:' + bnet + ';border-radius:' + chu.tkBo + 'px' : 'border:0;border-top:' + bnet + ';border-bottom:' + bnet + ';border-radius:0') + '}'
      + '.qx-info td{padding-top:' + chu.tkCach + 'px;padding-bottom:' + chu.tkCach + 'px;border-bottom:' + (chu.tkNgang ? net('N') : '0') + ';border-right:' + (chu.tkDoc ? net('D') : '0') + '}'
      + '.qx-info td.k{padding-top:' + (chu.tkCach + 2) + 'px}'
      + (chu.tkLui ? '.qx-info td:first-child{padding-left:' + Math.max(0, 12 - chu.tkLui) + 'px}.qx-info td:last-child{padding-right:' + Math.max(0, 12 - chu.tkLui) + 'px}' : '')
      + '.qx-info tr:last-child td{border-bottom:0}.qx-info td:last-child{border-right:0}'
  }
  const w = { manh: 1, vua: 1.5, day: 2 }[chu.vDay] || 1
  const kieu = { lien: 'solid', dut: 'dashed', cham: 'dotted' }[chu.vKieu] || 'solid'
  const net = w + 'px ' + kieu + ' ' + chu.vMau
  const ngoaiMau = chu.vMau === BG_VIEN_MAU ? '#cfd6de' : chu.vMau
  css += '.qx-tbl{border:' + (chu.vNgoai ? (chu.vNgoaiDam ? w + 1 : w) + 'px solid ' + ngoaiMau : 'none') + '}'
  css += '.qx-tbl td{border-right:' + (chu.vLuoi === 'du' || chu.vLuoi === 'doc' ? net : 'none') + ';border-bottom:' + (chu.vLuoi === 'du' || chu.vLuoi === 'ngang' ? net : 'none') + '}'
  if (chu.vLuoi === 'ngang' || chu.vLuoi === 'khong') css += '.qx-tbl th{border-right:none}'
  css += '.qx-tbl td:last-child{border-right:none}'
  css += '.qx-tbl td{vertical-align:' + ({ tren: 'top', giua: 'middle', duoi: 'bottom' }[chu.canhDoc] || 'middle') + '}'
  if (chu.ctkSet) {
    const r = chu.ctkBo + 'px'
    /* lề trong 2 bên (ctkLui = lùi 2 đầu của kẻ ngang) chỉ khi đang kẻ dòng; tắt kẻ dòng thì viền bao ôm sát bảng, không hở */
    css += '.qx-tbl{border-collapse:separate;border-spacing:0;padding:0 ' + (chu.ctkNgang ? chu.ctkLui : 0) + 'px;border:' + (chu.ctkBao ? khungNet_(chu, 'ctk', 'B') : 'none') + ';border-radius:' + r + '}'
      + '.qx-tbl td{padding-top:' + chu.ctkCach + 'px;padding-bottom:' + chu.ctkCach + 'px;border-bottom:' + (chu.ctkNgang ? khungNet_(chu, 'ctk', 'N') : 'none') + ';border-right:' + (chu.ctkDoc ? khungNet_(chu, 'ctk', 'D') : 'none') + '}'
      /* hàng tiêu đề cột theo cùng bộ khung: vạch dọc giữa các ô (nét / độ dày / màu của Dọc, không lùi 2 đầu), khoảng cách dòng = đệm trên dưới;
         chiều cao hàng tiêu đề vẫn bằng nhau ở mọi trang (3 dòng chữ + đệm) */
      + '.qx-tbl th{border-right:' + (chu.ctkDoc ? khungNet_(chu, 'ctk', 'D') : 'none') + '}'
      + '.qx-tbl tr.qx-h th{padding-top:' + chu.ctkCach + 'px;padding-bottom:' + chu.ctkCach + 'px}'
      + '.qx-tbl tr.sec.tg1 td,.qx-tbl tr.sec.tg2 td,.qx-tbl tr.sec.tg3 td{height:calc(3em + ' + chu.ctkCach * 2 + 'px)}'
      + '.qx-tbl:not(.qx-cover) tr.qx-h th,.qx-tbl.qx-dense:not(.qx-cover) tr.qx-h th,.qx-tbl.qx-dense2:not(.qx-cover) tr.qx-h th{height:calc(3.75em + ' + chu.ctkCach * 2 + 'px)}'
      + '.qx-tbl tr:last-child td{border-bottom:none}.qx-tbl td:last-child,.qx-tbl th:last-child{border-right:none}'
      + '.qx-tbl tr:first-child th:first-child{border-top-left-radius:' + r + '}.qx-tbl tr:first-child th:last-child{border-top-right-radius:' + r + '}'
    /* Lùi 2 đầu của kẻ dọc áp cho dòng đề mục nhỏ + hàng tiêu đề cột: vạch dọc trong từng ô ngắn lại (không chạm cạnh trên / dưới ô),
       vẽ bằng ảnh nền thay cho border-right; dòng đề mục lớn (.sec / .lv1) giữ nguyên */
    if (chu.ctkDoc && chu.ctkLuiD) {
      const w = khungW_(chu.ctkDDay)
      const m = chu.ctkDMau
      const img = chu.ctkDKieu === 'dut' ? 'repeating-linear-gradient(to bottom,' + m + ' 0 4px,transparent 4px 7px)'
        : chu.ctkDKieu === 'cham' ? 'repeating-linear-gradient(to bottom,' + m + ' 0 ' + w + 'px,transparent ' + w + 'px ' + (w * 2.5) + 'px)'
          : 'linear-gradient(' + m + ',' + m + ')'
      css += '.qx-tbl tbody tr:not(.sec):not(.lv1):not(.qx-h) td:not(:last-child){border-right:none;background-image:' + img
        + ';background-size:' + w + 'px calc(100% - ' + chu.ctkLuiD * 2 + 'px);background-position:right center;background-repeat:no-repeat;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      // hàng tiêu đề cột cũng lùi 2 đầu: vạch vẽ đè lên nền tiêu đề (chỉ đổi ảnh nền, giữ màu nền)
      css += '.qx-tbl tr.qx-h th:not(:last-child){border-right:none;background-image:' + img
        + ';background-size:' + w + 'px calc(100% - ' + chu.ctkLuiD * 2 + 'px);background-position:right center;background-repeat:no-repeat;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    }
  }
  if (!chu.soLe) css += '.qx-tbl:not(.qx-totbox) tbody tr:nth-child(even of :not(.sec):not(.lv1):not(.qx-h)) td{background:transparent}'
  return renameCss_(css)
}
/* font của Cài đặt chung: giá trị --app-font ThemeContext gán lên <html> ('' = Montserrat) */
export function appFontValue_() {
  try { return (document.documentElement.style.getPropertyValue('--app-font') || '').trim() } catch (e) { return '' }
}
export function appFontName_() { const f = findFont(appFontValue_()); return f ? f.name : 'Montserrat' }
function famCss_(font) { return (font || appFontValue_() || "'Montserrat'") + ', Arial, Helvetica, sans-serif' }
/* link Google Fonts cho font đang dùng (Montserrat / font Google), null với font có sẵn trên máy */
export function bgFontHref_(font) {
  const v = font || appFontValue_()
  const f = FONT_CATALOG.find(x => x.value === v) || (v ? null : FONT_CATALOG[0])
  if (!f || !(f.google || f.name === 'Montserrat')) return null
  return 'https://fonts.googleapis.com/css?family=' + f.name.replace(/ /g, '+') + ':400,600,700,800&subset=vietnamese&display=swap'
}

export function bgDocCss_(mau, chu) {
  let css = !mau || mau === BG_MAU_DS[0] ? DOC_CSS : DOC_CSS.replace(/#0f2942|#12233a|#12314f|#0e2740|#0b2438/gi, mau)
  css += bgTuyCss_(chu)
  css = css.replace(/font-family:Arial,Helvetica,sans-serif/g, 'font-family:' + famCss_(chu && chu.font))
  const co = chu ? Number(chu.co) || 100 : 100
  if (co !== 100) css = css.replace(/font-size:(\d+(?:\.\d+)?)px/g, (x, n) => 'font-size:' + Math.round(Number(n) * co) / 100 + 'px')
  return css
}

/* Gắn tiền tố vùng cho mọi selector (kể cả trong @media) - CSS tài liệu chỉ áp trong vùng xem trước */
export function scopeCss(css, scope) {
  let out = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const sel = css.slice(i, open).trim()
    if (sel.charAt(0) === '@') {
      let depth = 1; let j = open + 1
      while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
      out += sel + '{' + scopeCss(css.slice(open + 1, j - 1), scope) + '}'
      i = j
      continue
    }
    const close = css.indexOf('}', open)
    out += sel.split(',').map(s => scope + ' ' + s.trim()).join(',') + css.slice(open, close + 1)
    i = close + 1
  }
  return out
}

/* CSS trang xem trước: bỏ khối @media (chỉ có @media print ẩn tay kéo cột, bản in đã tự ẩn trong printCss_) để không thêm
   @media print nào vào trang SiteFlow, rồi gắn tiền tố vùng xem trước */
export function docScreenCss(mau, scope, chu) {
  return scopeCss(bgDocCss_(mau, chu).replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), scope)
}

/* Cân đối cột của 1 bảng chi tiết (.qsd-qx-tbl), chạy mỗi lần vẽ trang (bản xem trước + cửa sổ in), chỉ đổi bề rộng hiển thị
   (colgroup) của lần vẽ đó - không ghi vào bề rộng đã lưu:
   - Cột NGẮN (STT, ô số / căn giữa như giá, số lượng, %, đơn vị tính, hình ảnh, trạng thái): bề rộng = đúng mức cần, nới hoặc thu -
     tiêu đề không cắt giữa chữ, xếp tối đa 2 dòng (tiêu đề <= 3 chữ, vd ĐƠN VỊ / TÍNH) hoặc 3 dòng (dài hơn, vd CHIẾT KHẤU CHO / KHÁCH
     HÀNG / (%)); số nằm trên 1 dòng.
   - Cột NỘI DUNG (tên, thông tin chính, thông số, thương hiệu, ghi chú…): nhận phần còn lại, giữ tỉ lệ bề rộng hiện có giữa chúng
     (kéo tay / Dàn trang tối ưu vẫn có tác dụng), không hẹp hơn chữ dài nhất và tiêu đề <= 3 dòng. Nội dung dài tự giới hạn 5 dòng (.qx-desc). */
const COT_NGAN_ = { dvt: 1, hinhAnh: 1, soLuong: 1, trangThai: 1, ckKhach: 1, chietKhau: 1, lnPct: 1, markup: 1, margin: 1 }
export function balanceCols_(tb, win) {
  const cols = [].slice.call(tb.querySelectorAll('colgroup col'))
  const head = tb.querySelector('tr.qsd-qx-h') || tb.querySelector('tr')
  if (!cols.length || !head) return
  const ths = [].slice.call(head.children)
  if (ths.length !== cols.length) return
  const W = tb.clientWidth
  if (!(W > 0)) return
  const cv = win.document.createElement('canvas').getContext('2d')
  const doW = (el, text) => {
    const cs = win.getComputedStyle(el)
    cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily
    return cv.measureText(text).width + (parseFloat(cs.letterSpacing) || 0) * text.length
  }
  const pad = el => { const cs = win.getComputedStyle(el); return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + 2 }
  /* bề rộng nhỏ nhất để tiêu đề xếp <= L dòng, không cắt giữa chữ (xếp chữ tham lam, chia đôi tìm bề rộng) */
  const headW = (th, L) => {
    const tu = String(th.textContent || '').trim().toUpperCase().split(/\s+/).filter(Boolean)
    if (!tu.length) return pad(th)
    const ww = tu.map(x => doW(th, x)); const sp = doW(th, ' ')
    const dong = w => { let n = 1, cur = 0; ww.forEach(x => { if (cur && cur + sp + x > w) { n++; cur = x } else cur = cur ? cur + sp + x : x }); return n }
    let lo = Math.max(...ww), hi = ww.reduce((a, x) => a + x, 0) + sp * ww.length
    if (dong(lo) > L) { for (let i = 0; i < 14 && hi - lo > 0.5; i++) { const mid = (lo + hi) / 2; if (dong(mid) <= L) hi = mid; else lo = mid } lo = hi }
    return lo + pad(th)
  }
  const nChu = th => String(th.textContent || '').trim().split(/\s+/).filter(Boolean).length
  const ngan = []; const can = []; const san = []
  ths.forEach((th, i) => {
    const k = th.getAttribute('data-k') || ''
    ngan[i] = i === 0 || !k || th.classList.contains('num') || th.classList.contains('ct') || !!COT_NGAN_[k]
    can[i] = ngan[i] ? headW(th, nChu(th) <= 3 ? 2 : 3) : headW(th, 3)
    san[i] = can[i]
    if (k === 'hinhAnh') can[i] = Math.max(can[i], 56)
  })
  // nội dung: ô ngắn = chữ trên 1 dòng; ô nội dung = chữ dài nhất (không cắt giữa chữ)
  ;[].slice.call(tb.querySelectorAll('tr')).forEach(tr => {
    if (tr === head || tr.children.length !== ths.length) return
    ;[].slice.call(tr.children).forEach((td, i) => {
      const t = String(td.textContent || '').trim()
      if (!t) return
      if (ngan[i]) can[i] = Math.max(can[i], doW(td, t) + pad(td))
      else san[i] = Math.max(san[i], Math.min(Math.max(...t.split(/\s+/).map(x => doW(td, x))), 140) + pad(td))
    })
  })
  const now = cols.map(c => c.getBoundingClientRect().width || 0)
  const tong = now.reduce((a, b) => a + b, 0) || W
  const px = now.map(w => w / tong * W)
  const moi = px.slice()
  let conLai = W
  ths.forEach((th, i) => { if (ngan[i]) { moi[i] = can[i]; conLai -= can[i] } })
  const nd = ths.map((th, i) => i).filter(i => !ngan[i])
  if (nd.length) {
    const cu = nd.reduce((a, i) => a + px[i], 0) || 1
    nd.forEach(i => { moi[i] = Math.max(san[i], conLai * px[i] / cu) })
  }
  const tm = moi.reduce((a, b) => a + b, 0)
  cols.forEach((c, i) => { c.style.width = (moi[i] / tm * 100).toFixed(3) + '%' })
}

/* Giữ đúng khung A4 ngang cho mỗi trang (.qsd-pg): trang cao cố định; phần nội dung (trừ chân trang .qsd-qp-foot) cao hơn chỗ trống
   thì thu nhỏ đều cả khối (bọc .qsd-fit, transform scale + bù bề rộng; không dùng zoom vì trình duyệt tính % bề rộng khác nhau) cho vừa đúng 1 tờ - bản xem trước không còn cao quá khổ, bản in không tràn
   sang tờ thứ 2. root = khung chứa các trang (.qsd-doc, ở trang SiteFlow hoặc cửa sổ in); pageH = chiều cao trang (px, 794 = A4 ngang
   ở bề rộng 1123px); null = để CSS quyết định (cửa sổ in: 209mm). Gọi lại sau mỗi lần vẽ trang / tải font.
   Trả mảng tỉ lệ tự vừa của từng trang (để tính tỉ lệ chung). */
export function fitA4_(root, pageH, opt) {
  if (!root) return []
  opt = opt || {}
  const d = root.ownerDocument; const win = d.defaultView
  /* lượt 1: mỗi trang chuẩn bị (bọc .qsd-fit, cố định cao, cân cột) + tìm tỉ lệ LỚN NHẤT còn vừa (1 = không cần thu nhỏ) */
  const ds = [].slice.call(root.querySelectorAll('.qsd-pg')).map(function (pg) {
    let w = null
    for (let i = 0; i < pg.children.length; i++) if (pg.children[i].classList.contains('qsd-fit')) w = pg.children[i]
    if (!w) {
      w = d.createElement('div'); w.className = 'qsd-fit'
      ;[].slice.call(pg.childNodes).forEach(function (c) { if (!(c.classList && c.classList.contains('qsd-qp-foot'))) w.appendChild(c) })
      pg.insertBefore(w, pg.firstChild)
    }
    // flow-root: chặn lề trên / dưới của tiêu đề, bảng tràn ra ngoài khối đo (đo thiếu -> đè chân trang)
    w.style.transform = ''; w.style.transformOrigin = ''; w.style.width = ''; w.style.display = 'flow-root'
    if (pageH) { pg.style.height = pageH + 'px'; pg.style.overflow = 'hidden' }
    ;[].slice.call(w.querySelectorAll('table.qsd-qx-tbl:not(.qsd-qx-cover)')).forEach(tb => { try { balanceCols_(tb, win) } catch (e) { /* đo lỗi: giữ bề rộng cũ */ } })
    const cs = win.getComputedStyle(pg)
    /* chỗ trống = từ đệm trên tới mép trên chân trang (cách 8px), không tới hết đệm dưới: chân trang nằm một phần trong đệm dưới */
    let day = pg.clientHeight - (parseFloat(cs.paddingBottom) || 0)
    const foot = pg.querySelector('.qsd-qp-foot')
    if (foot && foot.offsetTop > 0) day = Math.min(day, foot.offsetTop - 8)
    const avail = day - (parseFloat(cs.paddingTop) || 0)
    const h = w.offsetHeight
    let f = 1
    if (avail > 0 && h > avail + 1) {
      /* bề rộng bố cục = khung / f, thu nhỏ f lần từ góc trái trên -> nhìn rộng đúng khung. Bố cục rộng hơn thì chữ xuống dòng ít hơn,
         nội dung thấp đi, nên tìm f LỚN NHẤT còn vừa (chia đôi 9 lần) thay vì lấy thẳng chỗ trống / chiều cao ban đầu (thu nhỏ quá tay) */
      const cao = x => { w.style.width = (100 / x) + '%'; return w.offsetHeight * x }
      let lo = Math.max(0.35, avail / h), hi = 1
      if (cao(lo) > avail + 1) hi = lo
      for (let i = 0; i < 9 && hi - lo > 0.005; i++) { const mid = (lo + hi) / 2; if (cao(mid) <= avail + 1) lo = mid; else hi = mid }
      f = lo
      w.style.width = ''
    }
    return { w: w, f: f }
  })
  /* lượt 2: tỉ lệ áp cho từng trang. opt.dongNhat: MỌI trang (kể cả tờ bìa) dùng CHUNG tỉ lệ nhỏ nhất -> cùng cỡ chữ toàn báo giá.
     opt.f: tỉ lệ chung đã tính sẵn (bản xem trước chỉ vẽ 1 trang) - không lớn hơn tỉ lệ tự vừa của trang */
  let chung = null
  if (opt.dongNhat) ds.forEach(x => { if (chung == null || x.f < chung) chung = x.f })
  ds.forEach(x => {
    let f = x.f
    if (opt.f != null) f = Math.min(f, opt.f)
    else if (chung != null) f = Math.min(f, chung)
    if (f < 0.999) { x.w.style.width = (100 / f) + '%'; x.w.style.transformOrigin = '0 0'; x.w.style.transform = 'scale(' + f + ')' }
  })
  return ds.map(x => x.f)
}

/* printDoc: CSS của cửa sổ in (A4 ngang, bỏ khung, mỗi trang 1 tờ, ẩn tay kéo cột) */
export function printCss_(css) {
  return css
    + '@page{size:A4 landscape;margin:0}'
    + 'body{margin:0;background:#fff}'
    + '.qsd-doc{margin:0;display:block}'
    + '.qsd-pg{border:none;border-radius:0;box-shadow:none;margin:0 auto;page-break-after:always;width:297mm;min-height:209mm;height:209mm;overflow:hidden;padding:16mm 15mm 18mm}'
    + '.qsd-pg:last-child{page-break-after:auto}'
    + '.qsd-qp-foot{left:15mm;right:15mm;bottom:8mm}'
    + '.qsd-qxrsz{display:none}'
}
