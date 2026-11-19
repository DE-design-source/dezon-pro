/* Dòng bóc tách so với sản phẩm trong danh mục - port nguyên văn PUB/boc.js:1403-1443 (spMaMap_, spOfLine_, LN_SYNC_F, lnDiff_)
   và 1509-1526 (giaSpCuaDong_, giaLechList_). S.products / S.lines của bản gốc thành tham số. Không React, không fetch. */
import { spNorm_ } from './format.js'
import { giaDongTuSP_ } from './calc.js'

var _spMaMap=null, _spMaMapSrc=null;
export function spMaMap_(products){
  if(_spMaMap && _spMaMapSrc===products) return _spMaMap;
  var m={}; (products||[]).forEach(function(p){
    var k=String(p.ma||'').trim().toLowerCase(); if(!k) return;
    (m[k]=m[k]||[]).push(p);
  });
  _spMaMap=m; _spMaMapSrc=products; return m;
}
export function spOfLine_(l, products){
  var ds=spMaMap_(products)[String((l&&l.maSP)||'').trim().toLowerCase()];
  if(!ds||!ds.length) return null;
  if(ds.length===1) return ds[0];
  var ten=spNorm_(l.ten||'');
  return ds.filter(function(p){ return spNorm_(p.ten||'')===ten; })[0] || ds[0];
}
/* Trường so sánh giữa dòng và sản phẩm trong danh mục: [khoá dòng, nhãn, lấy từ SP, kiểu] */
export var LN_SYNC_F=[
  ['donGiaVon','Giá bán lẻ (niêm yết)', function(p,ps){ return Math.round(giaDongTuSP_(p,ps).donGiaVon); }, 'money'],
  ['chietKhau','CK đại lý (%)', function(p,ps){ return giaDongTuSP_(p,ps).chietKhau; }, 'pct'],
  ['ten','Tên sản phẩm', function(p){ return String(p.ten||''); }, 'text'],
  ['thuongHieu','Thương hiệu', function(p){ return String(p.thuongHieu||''); }, 'text'],
  ['ncc','Nhà cung cấp', function(p){ return String(p.ncc||''); }, 'text'],
  ['moTa','Thông tin chính', function(p){ return String(p.moTa||''); }, 'text'],
  ['kichThuoc','Thông số thiết kế', function(p){ return String(p.kichThuoc||''); }, 'text'],
  ['dvt','Đơn vị tính', function(p){ return String(p.dvt||''); }, 'text'],
  ['hinhAnh','Hình ảnh', function(p){ return String(p.hinhAnh||''); }, 'img']
];
export function lnDiff_(l, products){
  var p=spOfLine_(l, products); if(!p) return null;
  var ds=[];
  LN_SYNC_F.forEach(function(f){
    var moi=f[2](p, products);
    var cu=(f[3]==='money')?Math.round(Number(l[f[0]])||0):(f[3]==='pct'?(Number(l[f[0]])||0):String(l[f[0]]==null?'':l[f[0]]));
    if(f[3]==='money'){ if(!moi || cu===moi) return; }
    else if(f[3]==='pct'){ if(cu===moi) return; }
    else { if(String(cu).trim()===String(moi).trim()) return; if(!String(moi).trim()) return; }  // SP để trống thì không ghi đè
    ds.push({k:f[0], lb:f[1], cu:cu, moi:moi, kieu:f[3]});
  });
  return ds.length?{p:p, ds:ds}:null;
}
// Có thay đổi GIÁ VỐN không (tooltip của chip ⟳, boc.js:1446-1448)
export function lnDiffTip_(d){
  if(!d) return '';
  var coGia=d.ds.some(function(x){ return x.k==='donGiaVon'; });
  return (coGia?'GIÁ VỐN đã đổi trong danh mục':'Thông tin sản phẩm đã đổi trong danh mục')
    +' ('+d.ds.map(function(x){ return x.lb; }).join(', ')+') — bấm để xem và cập nhật dòng này';
}
export function giaSpCuaDong_(l, products){
  var ma=String(l.maSP||'').trim().toLowerCase(); if(!ma) return null;
  var ds=(products||[]).filter(function(p){ return String(p.ma||'').trim().toLowerCase()===ma; });
  if(!ds.length) return null;
  if(ds.length>1){                                   // nhiều biến thể cùng mã -> khớp thêm theo tên
    var ten=spNorm_(l.ten||'');
    ds = ds.filter(function(p){ return spNorm_(p.ten||'')===ten; }).concat(ds);
  }
  var g=giaDongTuSP_(ds[0], products), von=Math.round(g.donGiaVon);
  return von?{p:ds[0], von:von, ck:g.chietKhau}:null;
}
export function giaLechList_(lines, products){
  return (lines||[]).map(function(l){
    var g=giaSpCuaDong_(l, products); if(!g) return null;
    if(Math.round(Number(l.donGiaVon)||0)===g.von && (Number(l.chietKhau)||0)===g.ck) return null;
    return {l:l, von:g.von, ck:g.ck, cu:Math.round(Number(l.donGiaVon)||0), p:g.p};
  }).filter(Boolean);
}
