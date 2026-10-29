/* Sinh dữ liệu + bộ đối chiếu cho gói Go internal/shared/specs từ internal/shared/specs/js/{vs,son,ct,dl}-spec.js.
   Các file JS đó (UMD, nhúng vào binary và phục vụ ở /vs-spec.js, /son-spec.js, /ct-spec.js, /dl-spec.js) là nguồn DUY NHẤT
   của thông số ngành: sửa spec xong phải chạy lại file này.
     node backend/scripts/gen-specs.js
   Ghi:
     internal/shared/specs/data/{vs,son,ct,dl}.json    mọi giá trị export không phải hàm (giữ thứ tự khoá)
     internal/shared/specs/testdata/golden.json     kết quả của mọi hàm export trên bộ đầu vào rộng
     internal/shared/specs/testdata/sources.json    sha256 của các file JS (test Go báo khi sửa JS mà quên chạy lại)
   Không đụng database. */
'use strict';
const fs = require('fs');
const path = require('path');

const crypto = require('crypto');

const OUT = path.join(__dirname, '..', 'internal', 'shared', 'specs');
const JS = path.join(OUT, 'js');
const SPECS = { vs: require(path.join(JS, 'vs-spec.js')), son: require(path.join(JS, 'son-spec.js')), ct: require(path.join(JS, 'ct-spec.js')),
  dl: require(path.join(JS, 'dl-spec.js')) };
const TEN = Object.keys(SPECS);

fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'testdata'), { recursive: true });

// ---- 1. Dữ liệu ----
TEN.forEach(function (ten) {
  const api = SPECS[ten], data = {};
  Object.keys(api).forEach(function (k) { if (typeof api[k] !== 'function') data[k] = api[k]; });
  // 1 dòng, đúng bằng JSON.stringify: test Go ghi lại và so từng byte để chắc thứ tự khoá không đổi
  fs.writeFileSync(path.join(OUT, 'data', ten + '.json'), JSON.stringify(data) + '\n');
});

// ---- 2. bo_dau không được export: lấy thẳng từ mã nguồn (mọi file phải giống nhau) ----
const RE_BO_DAU = /function bo_dau\(s\) \{[\s\S]*?\n  \}/;
const src = TEN.map(function (ten) {
  const m = RE_BO_DAU.exec(fs.readFileSync(path.join(JS, ten + '-spec.js'), 'utf8'));
  if (!m) throw new Error('Không tìm thấy bo_dau trong ' + ten + '-spec.js');
  return m[0];
});
if (src.some(function (x) { return x !== src[0]; })) throw new Error('bo_dau của các spec khác nhau - phải tách hàm Go theo từng spec');
const bo_dau = new Function(src[0] + '; return bo_dau;')();

// ---- 3. Bộ đầu vào ----
function uniq(ds) {
  const seen = new Set(), out = [];
  ds.forEach(function (x) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
  return out;
}
const NAMES = uniq([].concat(SPECS.vs.HANG_MUC, SPECS.son.HANG_MUC, SPECS.ct.HANG_MUC, SPECS.dl.HANG_MUC));
function bienThe(n) {
  return [n, n.toUpperCase(), n.toLowerCase(), bo_dau(n), bo_dau(n).toUpperCase(), '  ' + n + '  ', n.replace(/ /g, '   '),
    n.replace(/ /g, ' '), n.replace(/ /g, '\t\n'), n.replace(/ /g, '　'), '﻿' + n + ' ', n.normalize('NFD'),
    n + '.', n.replace(/ /g, ''), n.slice(0, -1), [n]];
}
const EDGE = ['', ' ', '\t\n', null, 0, 1, 123, -1.5, 0.1, 1e21, true, false, [], {}, [null], ['Bồn cầu', 'x'], { a: 1 },
  'İstanbul', 'ΣΑΣ', 'ΟΔΟΣ ', 'Σ', 'ß', 'ǅ', 'Å', 'Ⅻ', 'ＡＢＣ', 'Đ', 'đĐ', 'ð', 'Sơn  Lót', 'son lot', 'SON LOT', 'bon cau',
  'lavabo', 'LAVABO', 'o cam dien', 'Khác', 'abc', '😀', 'á', 'ö̀', '̀', 'ǰ', 'ŉ', 'ﬁ', 'null', 'undefined',
  'Ổ CẮM TÍN HIỆU (TV / LAN / TEL / HDMI)', 'dung moi & phu gia', 'Dimmer/điều tốc quạt'];
const INPUTS = uniq([].concat.apply([], NAMES.map(bienThe)).concat(EDGE));
const LABELS_ALL = uniq([].concat(SPECS.vs.ALL, SPECS.son.ALL, SPECS.ct.ALL, SPECS.dl.ALL));
const LB_EDGE = ['', 'xyz', 'màu sắc', ' MÀU SẮC', '@BH', '@KT', null, 5, true];

const rows = [];
function ghi(spec, fn, args, out) { rows.push([spec, fn, args, out === undefined ? null : out]); }

INPUTS.forEach(function (v) { ghi('', 'boDau', [v], bo_dau(v)); });

TEN.forEach(function (ten) {
  const S = SPECS[ten];
  INPUTS.forEach(function (v) {
    ghi(ten, 'chuanHM', [v], S.chuanHM(v));
    const h = S.hmOf(v);
    if (h !== null) {
      const name = S.HANG_MUC.filter(function (x) { return S.HM[x] === h; })[0];
      if (!name) throw new Error('hmOf trả object lạ');
      ghi(ten, 'hmOf', [v], { $hm: name });
    } else ghi(ten, 'hmOf', [v], null);
    // không khớp hạng mục -> bản sao của ALL: ghi dấu '$ALL' cho file gọn
    const lbs = S.labelsOf(v);
    ghi(ten, 'labelsOf', [v], JSON.stringify(lbs) === JSON.stringify(S.ALL) ? '$ALL' : lbs);
  });
  ['chinh', 'tk', 'req', 'kem'].concat(ten === 'ct' || ten === 'dl' ? ['dong'] : []).forEach(function (k) { ghi(ten, 'gom', [k], S.gom(k)); });

  // optsOf / isReq: mọi hạng mục của spec (+ vài biến thể, giá trị lạ) x mọi nhãn của mọi spec
  const vs2 = uniq(S.HANG_MUC.concat(S.HANG_MUC.slice(0, 3).map(function (n) { return bo_dau(n).toUpperCase(); }),
    ['', null, 'abc', 0, NAMES[0], NAMES[NAMES.length - 1]]));
  const lbs = uniq(LABELS_ALL.concat(LB_EDGE));
  vs2.forEach(function (v) {
    lbs.forEach(function (lb) {
      ghi(ten, 'optsOf', [v, lb], S.optsOf(v, lb));
      ghi(ten, 'isReq', [v, lb], S.isReq(v, lb));
    });
  });

  // truy cập dữ liệu mà server dùng trực tiếp: METRIC[lb][i], HM[hm][khối]
  S.ALL.forEach(function (lb) { ghi(ten, 'metric', [lb], S.METRIC[lb]); });
  ghi(ten, 'metric', ['xyz'], null);
  S.HANG_MUC.forEach(function (hm) {
    ['chinh', 'tk', 'req', 'kem'].forEach(function (k) { ghi(ten, 'hmList', [hm, k], S.HM[hm][k]); });
  });
});

// VS.nganhOf
const NGANH = ['', null, ' ', 'vs', ' den ', 'son', 'ct', 'dl', 0, 5, false, true, [], 'VS'];
const HM_NGANH = uniq(SPECS.vs.HANG_MUC.slice(0, 3).concat(['bon cau', ' LAVABO ', SPECS.son.HANG_MUC[0], SPECS.ct.HANG_MUC[0], SPECS.dl.HANG_MUC[0], '', null, 'abc', 0]));
NGANH.forEach(function (n) { HM_NGANH.forEach(function (hm) { ghi('vs', 'nganhOf', [n, hm], SPECS.vs.nganhOf(n, hm)); }); });

// CT.dong
const CT = SPECS.ct;
function moiCot(f) { const r = {}; CT.ALL.forEach(function (lb) { r[CT.METRIC[lb][0]] = f(CT.METRIC[lb][0]); }); r.bao_hanh_nam = f('bao_hanh_nam'); return r; }
const DONG_ROWS = [{}, { bao_hanh_nam: 2 }, { bao_hanh_nam: '2' }, { bao_hanh_nam: 0 }, { bao_hanh_nam: '0' }, { bao_hanh_nam: ' 0 ' },
  { bao_hanh_nam: ' 3 ' }, { bao_hanh_nam: null }, { bao_hanh_nam: '' }, { bao_hanh_nam: '   ' }, { bao_hanh_nam: 1.5 }, { bao_hanh_nam: true },
  { bao_hanh_nam: false }, { bao_hanh_nam: '00' }, { rong_mm: 86, cao_mm: 86, sau_mm: 9 }, { rong_mm: '86' }, { cao_mm: ' 86 ' }, { sau_mm: 0 },
  { rong_mm: null, cao_mm: '', sau_mm: '  ' }, { rong_mm: false }, { rong_mm: '86', sau_mm: '9.5' },
  moiCot(function (c) { return 'v_' + c; }), moiCot(function () { return '  x  '; }), moiCot(function () { return null; }),
  moiCot(function () { return 0; }), moiCot(function () { return 16.5; }), moiCot(function () { return ''; }), moiCot(function () { return ' '; })];
const DONG_LB = CT.ALL.concat(['@BH', '@KT', '@bh', '', 'xyz', 'TÂM XẢ', 'ĐỘ PHỦ']);
DONG_ROWS.forEach(function (r) {
  DONG_LB.forEach(function (lb) { ghi('ct', 'dong', [lb, r], CT.dong(lb, function (c) { return r[c]; })); });
});

// DL.dong (không có @KT) + DL.laChung / DL.doanHM (hạng mục ghi chung -> hạng mục con theo tên SP)
const DL = SPECS.dl;
function moiCotDl(f) { const r = {}; DL.ALL.forEach(function (lb) { r[DL.METRIC[lb][0]] = f(DL.METRIC[lb][0]); }); r.bao_hanh_nam = f('bao_hanh_nam'); return r; }
const DL_ROWS = DONG_ROWS.slice(0, 14).concat([moiCotDl(function (c) { return 'v_' + c; }), moiCotDl(function () { return '  x  '; }),
  moiCotDl(function () { return null; }), moiCotDl(function () { return 0; }), moiCotDl(function () { return ''; })]);
const DL_LB = DL.ALL.concat(['@BH', '@KT', '@bh', '', 'xyz', 'LOẠI CẤU KIỆN']);
DL_ROWS.forEach(function (r) {
  DL_LB.forEach(function (lb) { ghi('dl', 'dong', [lb, r], DL.dong(lb, function (c) { return r[c]; })); });
});
const DL_HM = uniq(INPUTS.concat(['Điện lạnh', 'ĐIỆN LẠNH', 'dien lanh', 'Điều hoà', 'Máy lạnh', 'Thông gió', 'HVAC', 'hệ thống điều hoà',
  'Thiết bị điện lạnh', 'Điều hoà không khí', 'Quạt', 'thông gió nhà tắm', 'Điều hòa']));
DL_HM.forEach(function (v) { ghi('dl', 'laChung', [v], DL.laChung(v)); });
const DL_TEN = ['', null, 'Mặt nạ dàn lạnh Cassette', 'PANEL BC', 'Cách nhiệt ống gas', 'Ống thoát nước ngưng D27', 'nước ngưng',
  'Ống đồng Ø9.5', 'dẫn gas', 'ỐNG GAS', 'Dây điện nguồn 3x2.5', 'cáp điện', 'Dây điều khiển', 'Quạt hút WC', 'quạt thông gió',
  'Ống gió mềm', 'Louver nhôm', 'chữ Y ống gió', 'Cửa gió', 'miệng gió', 'Giá đỡ dàn nóng', 'vật tư phụ', 'vận chuyển', 'ty treo',
  'Máy lạnh treo tường', 'Daikin FTKF25', 'mặt nạ ống đồng', 'quạt ống gió', 0, 'ống đồng cách nhiệt'];
['', 'Điện lạnh', 'Máy lạnh', 'Ống đồng dẫn gas', 'mat na dan lanh', 'xyz', null].forEach(function (hm) {
  DL_TEN.forEach(function (ten) { ghi('dl', 'doanHM', [hm, ten], DL.doanHM(hm, ten)); });
});

fs.writeFileSync(path.join(OUT, 'testdata', 'golden.json'), '[\n' + rows.map(function (r) { return JSON.stringify(r); }).join(',\n') + '\n]\n');
console.log('specs: ghi data/{' + TEN.join(',') + '}.json + testdata/golden.json (' + rows.length + ' ca, ' + INPUTS.length + ' đầu vào)');

// ---- 4. Dấu vân tay của nguồn: specs_test.go so với file JS đang nhúng ----
const sources = {};
TEN.forEach(function (ten) {
  sources[ten + '-spec.js'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(JS, ten + '-spec.js'))).digest('hex');
});
fs.writeFileSync(path.join(OUT, 'testdata', 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
