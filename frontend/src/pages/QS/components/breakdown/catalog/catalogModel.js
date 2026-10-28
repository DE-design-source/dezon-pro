/* Phần tính (không React, không fetch) của panel danh mục + panel chi tiết SP ở tab Bóc tách.
   Port nguyên văn bản gốc; S.* và spec toàn cục thành tham số. Nguồn:
   catCbKey_ boc.js:1656 · ccSpecTxt_ boc.js:1679-1682 · spSpecs_ sanpham.js:1130-1139 · SP_MAU_CSS / spMauCss_ / spMauNhom_ sanpham.js:2182-2193
   specRows_ / pdSection_ / pdMedia_ (phần dữ liệu) / pdSpecs_ / pdSpecsVS_ / pdSpecsSon_ / pdSpecsCT_ / pdBullets_ app.js:1076-1228
   (+ pdSpecsDL_ của ngành Điện lạnh, QS Pro ea787b6)
   CT_DEMUC_RULES / ctDeMucOf_ / ctSecDeMuc_ / ctSecsOfNode_ / ctAddToBoc_ (phần dựng SP) / renderCtLib_ (dấu "đã thêm") phantho.js:524-610
   PT_LOAI_NGAN / ptLoaiLabel_ / ptLoaiNgan_ sanpham.js:1326-1328 */
import { parseWatt, parseKelvin } from '../../../lib/catalogFilters.js'
import { nganhCuaSP_, specNganh_, vsChip_, vsNhom_, vsVal_ } from '../../../lib/productFields.js'
import { PT_LOAI, ptLoaiGop_, ctSyncTemplate_, ctOf_, ptLibDg_ } from '../../../lib/phantho.js'

// khoá 1 SP trong danh mục (recordId, dự phòng mã) - dùng cho combo, yêu thích, kéo thả
export function catCbKey_(p){ return String((p&&(p.recordId||p.ma))||''); }

export function ccSpecTxt_(x){
  return [x.congSuat,x.nhietDo,x.cri?('CRI '+x.cri):'',x.gocChieu].map(function(v){ return String(v==null?'':v).trim(); })
    .filter(Boolean).join(' · ');
}
/* Chip thông số nhanh trên thẻ (spSpecs_): [{t, k}] - k = chip nhấn màu. Rỗng = bản gốc hiện "—" (thẻ danh mục thì bỏ hẳn) */
export function spSpecs_(p, specs){ var out=[];
  if(nganhCuaSP_(p, specs)==='vs'){
    vsChip_(p, specs).forEach(function(x,k){ out.push({t:x[1], k:k===2}); });
    return out;
  }
  if(p.congSuat) out.push({t:p.congSuat, k:false});
  if(p.nhietDo) out.push({t:p.nhietDo, k:true});
  if(p.cri) out.push({t:'CRI '+p.cri, k:false});
  if(p.gocChieu) out.push({t:p.gocChieu, k:false});
  return out; }

/* Chấm màu của nhóm biến thể */
export const SP_MAU_CSS=[['trong suot','transparent'],['xanh duong','#1a73e8'],['xanh nuoc bien','#1a73e8'],['xanh la','#34a853'],['xanh luc','#34a853'],
  ['xanh ngoc','#26a69a'],['xanh reu','#5d7b4f'],['xanh','#4285f4'],['trang','#ffffff'],['den','#202124'],['xam','#9aa0a6'],['ghi','#9aa0a6'],
  ['bac','#c0c0c0'],['kem','#f3e5c0'],['be','#e8d5b0'],['vang dong','#d4af37'],['vang','#f2c200'],['cam','#f08a00'],['do','#d93025'],
  ['hong','#f48fb1'],['tim','#8e44ad'],['nau','#8d6e63'],['go','#a1887f'],['dong','#b87333'],['gold','#d4af37']];
export function spMauCss_(ten){
  var t=String(ten||'').trim(), hex=t.match(/#[0-9a-f]{3,6}\b/i); if(hex) return hex[0];
  var k=' '+t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ')+' ';
  for(var i=0;i<SP_MAU_CSS.length;i++) if(k.indexOf(' '+SP_MAU_CSS[i][0]+' ')>=0) return SP_MAU_CSS[i][1];
  return '';
}
/* Màu (không trùng) của cả nhóm biến thể, như renderCatalog truyền cho spMauDots_ (app.js:1065-1066).
   Trả [] khi < 2 màu (spMauDots_ không vẽ gì) */
export function catVarMau_(list){
  var mau=list.map(function(x){ return String(x.mauSac||'').trim(); }).filter(function(m,j,a){ return m && a.indexOf(m)===j; });
  return mau.length<2?[]:mau;
}

/* ═══ PANEL CHI TIẾT SP ═══ */
// Dòng "Nhãn: giá trị" trong mô tả: [[nhãn, giá trị]] hoặc [null, cả dòng]
export function specRows_(text){
  return String(text||'').split(/\r?\n|;|·/).map(function(s){return s.trim();}).filter(Boolean).map(function(line){
    var m=line.match(/^([^:：]{2,32})[:：]\s*(.+)$/);
    if(m) return [m[1].trim(), m[2].trim()];
    return [null, line];
  });
}
export function pdBullets_(text){
  return String(text||'').split(/\r?\n/).map(function(x){ return x.replace(/^[•\-\*\s]+/,'').trim(); }).filter(Boolean);
}
// 1 nhóm thông số: chỉ giữ dòng có giá trị; tiêu đề "English|Tiếng Việt". null = cả nhóm ẩn
function sec_(title, rows){
  var body=rows.filter(function(r){return r[1]!=null && r[1]!=='';});
  if(!body.length) return null;
  var t=String(title).split('|');
  return {type:'sec', en:t[0], vn:t[1]||'', rows:body};
}
function bullets_(en, vn, text){ return String(text||'').trim() ? {type:'bullets', en:en, vn:vn, items:pdBullets_(text)} : null; }
// Ảnh của SP (gallery): giá trị gốc, người gọi đổi sang URL bằng mediaUrl
export function pdImgs_(p){ return String(p.anhTatCa||p.hinhAnh||'').split('\n').map(function(s){return s.trim();}).filter(Boolean); }
/* Key Product Info (pdMedia_): [[icon, chữ]]; sơn / công tắc / điện lạnh không có khối này (do pdSpecsSon_ / pdSpecsCT_ / pdSpecsDL_ vẽ) */
export function pdKeyItems_(p, specs){
  var ng=nganhCuaSP_(p, specs);
  if(ng==='son'||ng==='ct'||ng==='dl') return [];
  if(ng==='vs') return vsChip_(p, specs).map(function(x){ return [x[0], x[1]]; });
  var cong=p.congSuat||parseWatt(p.ten), nd=p.nhietDo||parseKelvin(p.ten);
  return [
    ['power', cong + (p.dongRa?(' ('+p.dongRa+(/mA/i.test(p.dongRa)?'':'mA')+')'):'')],
    ['temp', nd + (p.quangThong?(' ('+p.quangThong+(/lm/i.test(p.quangThong)?'':'lm')+')'):'')],
    ['color', p.mauSac],
    ['angle', p.gocChieu]
  ].filter(function(x){ return x[1] && String(x[1]).trim(); });
}
/* Các khối thông số (pdSpecs_) theo đúng thứ tự bản gốc:
   [{type:'sec', en, vn, rows:[[k,v]]} | {type:'bullets', en, vn, items} | {type:'raw', en, vn, rows:[[k|null, v]]}] */
export function pdSpecBlocks_(p, specs){
  var ng=nganhCuaSP_(p, specs), out;
  if(ng==='vs') out=pdSpecsVS_(p, specs);
  else if(ng==='son') out=pdSpecsSon_(p, specs);
  else if(ng==='ct') out=pdSpecsCT_(p, specs);
  else if(ng==='dl') out=pdSpecsDL_(p, specs);
  else {
    out=[sec_('Design Specifications|Thông số thiết kế',[
        ['Chất liệu',p.chatLieu],['Chiều cao',p.chieuCao],['Đường kính',p.duongKinh],
        ['Góc nghiêng / góc chỉnh hướng',p.gocNghieng],['Dòng sản phẩm',p.dongSanPham||p.nhom]]),
      sec_('Performance Specifications|Thông số hiệu suất',[
        ['Quang thông',p.quangThong],['Chỉ số IP (Chống bụi, nước)',p.capBaoVe],['CRI',p.cri],
        ['Hiệu suất phát quang (Efficacy)',p.hieuSuat],['Chỉ số gây chói mắt (UGR)',p.ugr],
        ['Tuổi thọ đèn',p.tuoiTho],['Loại chip LED',p.chipLed],
        ['Độ đồng nhất màu sắc (SDCM)',p.sdcm],['Chỉ số ngộ độc Cyanosis (COI Compliance)',p.coi],
        ['Thời gian bảo hành',p.baoHanh]]),
      sec_('Driver|Nguồn LED / Chấn lưu',[
        ['Bộ nguồn',p.tenBoNguon],['Mã sản phẩm',p.maBoNguon],['Hãng bộ nguồn',p.hangBoNguon],
        ['Vị trí lắp đặt bộ nguồn',p.viTriNguon],['Tương thích điều khiển (Control Type)',p.tuongThich],
        ['Cường độ dòng điện đầu ra tối đa',p.dongRa]]),
      sec_('Installation Specifications|Thông số lắp đặt',[
        ['Lắp đặt bộ nguồn rời',p.lapNguonRoi],['Kích thước lỗ khoét trần (Cutout Size)',p.loKhoet],
        ['Cấp bảo vệ an toàn điện (Class Rating)',p.capBaoVeDien]])];
    if(p.moTa && !p.chatLieu && !p.quangThong) out.push({type:'raw', en:'Thông số kỹ thuật', vn:'mô tả', rows:specRows_(p.moTa)});
  }
  return out.filter(Boolean);
}
// ngành có spec nhưng spec chưa tải: không có khối nào (người gọi báo "Không tải được thông số ngành")
function pdSpecsVS_(p, specs){
  var SP=specNganh_('vs', specs); if(!SP) return [];
  var g=vsNhom_(p, specs), rows=function(ds){ return ds.map(function(lb){ return [SP.METRIC[lb][1], vsVal_(p,lb,specs)]; }); };
  return [sec_('Product Overview|Tổng quan sản phẩm',
      rows(g.chinh).concat([['Dòng sản phẩm',p.dongSanPham||p.nhom],['Hạng mục',SP.chuanHM(p.hangMuc)||p.hangMuc],['Thời gian bảo hành',p.baoHanh]])),
    sec_('Design Specifications|Thông số thiết kế', rows(g.tk)),
    bullets_('Features','Tính năng',p.tinhNang)];
}
function pdSpecsSon_(p, specs){
  var SON=specNganh_('son', specs); if(!SON) return [];
  var g=vsNhom_(p, specs), rows=function(ds){ return ds.map(function(lb){ return [SON.METRIC[lb][1], vsVal_(p,lb,specs)]; }); };
  return [sec_('Key Product Info|Thông tin chính',
      rows(g.chinh).concat([['Dòng sản phẩm',p.dongSanPham||SON.chuanHM(p.hangMuc)||p.hangMuc],['Hạng mục',SON.MUC]])),
    bullets_('Tính năng sản phẩm','',p.tinhNang),
    sec_(SON.TEN_TK, rows(g.tk))];
}
/* Điện lạnh: 4 khối theo DL_SPEC.KHOI (Thông tin chính · Hiệu suất · Kết nối · Lắp đặt); vật tư / phụ kiện chỉ có khối đầu
   (Quy cách · Xuất xứ) - sec_ tự bỏ khối rỗng */
function pdSpecsDL_(p, specs){
  var DL=specNganh_('dl', specs); if(!DL) return [];
  var h=DL.hmOf(p.hangMuc), raw=p.raw||{}, M=h?h.nhom:{chinh:DL.CHINH_ALL,hs:[],ket:[],lap:DL.TK_ALL};
  function rows(ds){ return ds.map(function(lb){ return DL.dong(lb, function(c){ return raw[c]; })||['','']; }); }
  var chung=[['Dòng sản phẩm',p.dongSanPham||p.nhom],['Hạng mục',DL.chuanHM(p.hangMuc)||p.hangMuc],['Thời gian bảo hành',p.baoHanh]];
  return DL.KHOI.map(function(k,i){ return sec_(k[1], rows(M[k[0]]).concat(i===0?chung:[])); })
    .concat([bullets_('Features','Tính năng',p.tinhNang)]);
}
function pdSpecsCT_(p, specs){
  var CT=specNganh_('ct', specs); if(!CT) return [];
  var h=CT.hmOf(p.hangMuc), raw=p.raw||{};
  function rows(ds){ return ds.map(function(lb){ return CT.dong(lb, function(c){ return raw[c]; })||['','']; }); }
  var tinhNang=bullets_('Features','Tính năng',p.tinhNang);
  var chung=[['Dòng sản phẩm',p.dongSanPham||p.nhom],['Hạng mục',CT.chuanHM(p.hangMuc)||p.hangMuc],['Thời gian bảo hành',p.baoHanh]];
  if(!h){ var g=vsNhom_(p, specs); return [sec_('Key Product Info|Thông tin chính', rows(g.chinh).concat(chung)), sec_('Design Specifications|Thông số thiết kế', rows(g.tk)), tinhNang]; }
  var M=h.nhom;
  return [sec_('Key Product Info|Thông tin chính', rows(M.chinh).concat(chung)),
    sec_('Electrical Specifications|Thông số điện & an toàn', rows(M.dien)),
    sec_((h.loai==='oc'?'USB / Signal / Smart|':'Smart & Control|')+M.tenTm, rows(M.tm)),
    sec_('Installation Specifications|Thông số lắp đặt', rows(['KIỂU LẮP ĐẶT','SỐ MODULE CHIẾM (ô)','@KT','LOẠI ĐẾ TƯƠNG THÍCH','ĐỘ SÂU HỘP ÂM TỐI THIỂU (mm)','TIẾT DIỆN DÂY TỐI ĐA (mm²)'])),
    tinhNang];
}

/* ═══ CÔNG TÁC CỦA ĐỀ MỤC (thư viện công tác trong panel trái, đề mục khác Phần thô) ═══ */
export const CT_DEMUC_RULES=[
  [/thach cao/,'3.2.1'],
  [/son nuoc|\bson\b/,'3.2.2'],
  [/xay tuong|trat tuong|xay to/,'3.2.3'],
  [/op lat|\bda\b|san go/,'3.2.4'],
  [/nhom|kinh|\bsat\b|cua cuon|\bcua\b/,'3.2.8']
];
export function ctDeMucOf_(hangMuc){
  var t=String(hangMuc||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
  for(var i=0;i<CT_DEMUC_RULES.length;i++) if(CT_DEMUC_RULES[i][0].test(t)) return CT_DEMUC_RULES[i][1];
  return '';
}
export function ctSecDeMuc_(sec){
  if(!sec) return '';
  var v=String(sec.deMuc||'').trim();
  if(v==='0') return '';
  if(v) return v;
  return ctDeMucOf_(String(sec.t||'').split('\n')[0]);
}
/* Các nhóm công tác (trong CSDL) thuộc đề mục node (kể cả chọn cấp con). Chỉ nhóm CSDL (sec.db) nên chỉ cần ctSyncTemplate_ trên congTac */
export function ctSecsOfNode_(node, congTac){
  node=String(node||''); if(!node || node==='3.1') return [];
  return ctSyncTemplate_([], congTac).tpl.filter(function(sec){
    if(!sec.db || !(sec.items||[]).length) return false;
    var dm=ctSecDeMuc_(sec); if(!dm) return false;
    return node===dm || node.indexOf(dm+'.')===0;
  });
}
// đơn giá hiển thị của 1 công tác trong thư viện (công tác CSDL không có giá sửa tay)
export function ctLibDg_(sec,a){ return ptLibDg_(sec,a,{}); }
// đã có trong bảng bóc tách của đề mục đang chọn chưa
export function ctDa_(lines, node, a){
  var ten=String(a[0]).split('\n')[0];
  return (lines||[]).some(function(l){ return l.nhom===node && l.ten===ten; });
}
// SP tạm dựng từ 1 công tác để thêm vào bảng (phần dữ liệu của ctAddToBoc_)
export function ctProdOf_(sec,a){
  var c=ctOf_(a)||{}, dg=Number(c.dg)||ctLibDg_(sec,a)||0, von=Number(c.dgnt)||dg;
  var anh=String(c.hinhAnh||'').split('\n')[0];
  return { ten:String(a[0]).split('\n')[0], ma:'', thuongHieu:'', ncc:c.ncc||'', moTa:String(c.gc||c.thongSo||'').trim(),
    kichThuoc:'', dvt:a[1]||c.dvt||'', hinhAnh:anh, donGiaVon:von, donGiaBan:dg, nhom:String(sec.t).split('\n')[0] };
}
export const PT_LOAI_NGAN={kt_chitiet:'KT chi tiết',kt_sobo:'KT sơ bộ',dt_nhancong:'DT · Nhân công',dt_vattu:'DT · Vật tư'};
export function ptLoaiLabel_(v){ var m=PT_LOAI.filter(function(x){ return x[0]===ptLoaiGop_(v); })[0]; return m?m[1]:v; }
export function ptLoaiNgan_(v){ return PT_LOAI_NGAN[v]||ptLoaiLabel_(v); }

/* Lọc danh sách trong ô chọn (filterPop): khớp chuỗi thường */
export function popMatch_(text, q){ q=String(q||'').toLowerCase().trim(); return !q || String(text||'').toLowerCase().indexOf(q)>=0; }
