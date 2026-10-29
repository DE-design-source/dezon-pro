/* Hàm thuần cho modal Cập nhật sản phẩm (P6) và Tạo nhanh biến thể (P7). Port nguyên văn PUB/sanpham.js + nhap.js,
   spec ngành là THAM SỐ (specs = {VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC}). Không React, không gọi API ngoài uploadImg_.
   Nguồn: fmtDateTime_ sanpham.js:1988-1993 · btLbl_ 2066-2071 · cbLbl_ 2029-2032 · SP_MAU_CSS / spMauCss_ 2182-2191
   NBT_BM 2203 · spNbtDong_ 2228-2229 · spNhieuBTDan_ 2250-2260 · BT_TRUC 2303-2304 · speField_ 1964-1987 · vsApplyHM_ nhap.js:249-268
   imgSrc1_ nhap.js:350 · downscaleImage_ / readB64_ / uploadImg_ nhap.js:1078-1114, 1232 */
import { API_BASE } from '../../../api/http'
import { mediaUrl } from '../../../api/files'
import * as api from '../../../api/qsApi'
import { coSpec_, specNganh_, nganhCuaSP_ } from '../../../lib/productFields'
import { safeUrl_ } from '../../../lib/format'

export function fmtDateTime_(v){
  if(v==null||v==='') return '—';
  var d=new Date(v); if(isNaN(d.getTime())) return String(v);
  var z=function(n){ return (n<10?'0':'')+n; };
  return z(d.getDate())+'/'+z(d.getMonth()+1)+'/'+d.getFullYear()+' '+z(d.getHours())+':'+z(d.getMinutes());
}

// Ảnh đầu tiên (nhiều ảnh nối bằng xuống dòng) -> URL tuyệt đối tới máy chủ Go
export function imgSrc1_(v){ return mediaUrl(String(v||'').split('\n')[0].trim()); }

// Link tài liệu: đường dẫn tương đối của máy chủ (/media, /files...) phải trỏ về máy chủ Go, không phải Vite
export function docHref_(u){ var s=safeUrl_(u); return (s.charAt(0)==='/'&&s.charAt(1)!=='/')?API_BASE+s:s; }

// Các trục phân biệt biến thể — phải khác ít nhất 1 cái, nếu không sẽ GHI ĐÈ dòng gốc
export const BT_TRUC=[['nhiet_do_mau_k','Nhiệt độ màu'],['cong_suat_w','Công suất'],['goc_chieu_deg','Góc chiếu'],
  ['mau_sac','Màu sắc'],['kich_thuoc','Kích thước']];

export const SP_MAU_CSS=[['trong suot','transparent'],['xanh duong','#1a73e8'],['xanh nuoc bien','#1a73e8'],['xanh la','#34a853'],['xanh luc','#34a853'],
  ['xanh ngoc','#26a69a'],['xanh reu','#5d7b4f'],['xanh','#4285f4'],['trang','#ffffff'],['den','#202124'],['xam','#9aa0a6'],['ghi','#9aa0a6'],
  ['bac','#c0c0c0'],['kem','#f3e5c0'],['be','#e8d5b0'],['vang dong','#d4af37'],['vang','#f2c200'],['cam','#f08a00'],['do','#d93025'],
  ['hong','#f48fb1'],['tim','#8e44ad'],['nau','#8d6e63'],['go','#a1887f'],['dong','#b87333'],['gold','#d4af37']];
export function spMauCss_(ten){
  var t=String(ten||'').trim(), hex=t.match(/#[0-9a-f]{3,6}\b/i); if(hex) return hex[0];
  var k=' '+t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,' ')+' ';   // khớp NGUYÊN TỪ: "đồng" không nhầm "đỏ"
  for(var i=0;i<SP_MAU_CSS.length;i++) if(k.indexOf(' '+SP_MAU_CSS[i][0]+' ')>=0) return SP_MAU_CSS[i][1];
  return '';
}

// Nhãn phụ của 1 biến thể (sơn: mã / màu / bề mặt / dung tích; vệ sinh: màu / kích thước; đèn: công suất, nhiệt độ, góc, màu)
export function btLbl_(x){
  if(x.nganh==='son') return [x.ma, x.mauSac, x.raw&&x.raw.be_mat, x.raw&&x.raw.kich_thuoc].map(function(v){ return String(v==null?'':v).trim(); }).filter(Boolean).join(' · ');
  if(x.nganh==='vs') return [x.mauSac, x.raw&&x.raw.kich_thuoc].map(function(v){ return String(v==null?'':v).trim(); }).filter(Boolean).join(' · ');
  return [x.congSuat,x.nhietDo,x.gocChieu,x.mauSac].map(function(v){ return String(v==null?'':v).trim(); })
    .filter(Boolean).join(' · ');
}
// Nhãn phụ trong gợi ý combo
export function cbLbl_(p, specs){ var ng=nganhCuaSP_(p, specs), SP=coSpec_(ng)?specNganh_(ng, specs):null;
  return SP
    ? [SP.chuanHM(p.hangMuc)||p.hangMuc, p.mauSac].filter(Boolean).join(' · ')
    : [p.congSuat, p.nhietDo].filter(Boolean).join(' · '); }

/* Gợi ý combo (cbSearch_): q rỗng + SP vệ sinh -> gợi ý theo hạng mục hay đi kèm; q có chữ -> tìm, cùng ngành lên trước.
   Trả {show, title, hits}: show=false -> ẩn hộp gợi ý. */
export function cbSuggest_(q, me, curId, combo, products, specs){
  q=String(q||'').trim().toLowerCase();
  var cur=String(curId||''), ng=nganhCuaSP_(me||{}, specs);
  var chon={}; (combo||[]).forEach(function(x){ chon[String(x.recordId)]=1; });
  var ok=function(p){ return String(p.recordId)!==cur && !chon[String(p.recordId)]; };
  var hit, title='';
  if(q.length<1){
    var VS=specs&&specs.VS_SPEC, h=(ng==='vs'&&VS)?VS.hmOf((me||{}).hangMuc):null;
    if(!h||!h.kem.length) return {show:false, title:'', hits:[]};
    hit=(products||[]).filter(function(p){ return ok(p) && nganhCuaSP_(p, specs)==='vs' && h.kem.indexOf(VS.chuanHM(p.hangMuc))>=0; }).slice(0,8);
    if(!hit.length) return {show:false, title:'', hits:[]};
    title='Gợi ý đi kèm: '+h.kem.join(', ');
  } else {
    hit=(products||[]).filter(function(p){
      return ok(p) && ((p.ten||'')+' '+(p.ma||'')+' '+(p.thuongHieu||'')+' '+(p.hangMuc||'')).toLowerCase().indexOf(q)>=0;
    });
    hit.sort(function(a,b){ return (nganhCuaSP_(a, specs)===ng?0:1)-(nganhCuaSP_(b, specs)===ng?0:1); });
    hit=hit.slice(0,8);
  }
  return {show:true, title:title, hits:hit};
}
// Gợi ý biến thể (btSearch_): chỉ khi có chữ, bỏ SP chung
export function btSuggest_(q, curId, btNhom, products){
  q=String(q||'').trim().toLowerCase();
  if(q.length<1) return {show:false, hits:[]};
  var cur=String(curId||'');
  var chon={}; (btNhom||[]).forEach(function(x){ chon[String(x.recordId)]=1; });
  var hit=(products||[]).filter(function(p){
    if(String(p.recordId)===cur || chon[String(p.recordId)] || p.spChung) return false;
    return ((p.ten||'')+' '+(p.ma||'')+' '+(p.thuongHieu||'')).toLowerCase().indexOf(q)>=0;
  }).slice(0,8);
  return {show:true, hits:hit};
}
// Biến thể TỰ ĐỘNG = cùng mã SP, chưa gom tay (btRender_)
export function btCungMa_(p, btNhom, products){
  var gom={}; (btNhom||[]).forEach(function(x){ gom[String(x.recordId)]=1; });
  return (p&&p.ma)?(products||[]).filter(function(x){ return x.ma===p.ma && String(x.recordId)!==String(p.recordId) && !gom[String(x.recordId)]; }):[];
}
export const cbItem_=function(x){ return {recordId:x.recordId, ma:x.ma, ten:x.ten, hinhAnh:x.hinhAnh, donGiaBan:x.donGiaBan, comboSL:x.comboSL||1,
  comboNguoc:!!x.comboNguoc, comboBoSL:x.comboBoSL, comboGhiChu:String(x.comboGhiChu==null?'':x.comboGhiChu)}; };
export const btItem_=function(x){ return {recordId:x.recordId, ma:x.ma, ten:x.ten, hinhAnh:x.hinhAnh, donGiaBan:x.donGiaBan,
  congSuat:x.congSuat, nhietDo:x.nhietDo, gocChieu:x.gocChieu, mauSac:x.mauSac, nganh:x.nganh, raw:x.raw}; };

/* ═══ Trường của modal Sửa (speField_): dùng CHUNG định nghĩa nhóm với form Nhập ═══
   Trả null nếu nhãn không có cột DB; ngược lại {lark,label,type,req,opts,ph,col,vs,init} */
export function speFieldDef_(f, raw, L2C, specs){
  var lark=f[0], label=f[1], type=f[2], req=f[3], opts=f[4]||[], ph=f[5]||label;
  var col=L2C[lark]; if(!col) return null;
  var val=raw[col]==null?'':String(raw[col]);
  if(lark==='LẮP NGUỒN RỜI') val=(val===true||val==='true')?'Có':((val===false||val==='false')?'Không':(val?'Có':''));
  var hmOpts=null;
  if(type==='hm'){
    var VS=specs&&specs.VS_SPEC, hmC=(VS&&VS.chuanHM(val))||val;
    val=hmC; hmOpts=opts.concat(hmC&&opts.indexOf(hmC)<0?[hmC]:[]);
  }
  return {lark:lark, label:label, type:type, req:req, opts:hmOpts||opts, ph:ph, col:col, vs:f[6]==='vs', init:val};
}

/* vsApplyHM_ (nhap.js:249-268) cho modal Sửa (hienHetKhiTrong=1): ô thông số theo hạng mục đang chọn.
   Trả {lark: {on, order, label, star, opts}} cho các ô có data-vs. Bản gốc khi đổi hạng mục trong modal lấy ngành dự phòng
   theo ô Ngành của tab Nhập (impLoai_); ở đây dùng ngành của chính SP đang sửa (cùng kết quả khi tab Nhập đang ở ngành đó). */
export function vsApply_(hmRaw, ng, larks, specs){
  var out={};
  if(!specs||!specs.VS_SPEC||!specs.SON_SPEC||!specs.CT_SPEC||!specs.DL_SPEC) return out;
  var SP=specs.SON_SPEC.chuanHM(hmRaw) ? specs.SON_SPEC : (specs.CT_SPEC.chuanHM(hmRaw) ? specs.CT_SPEC
    : (specs.DL_SPEC.chuanHM(hmRaw) ? specs.DL_SPEC : specNganh_(ng, specs)));
  if(!SP) return out;
  var hm=SP.chuanHM(hmRaw), cho=hm?SP.labelsOf(hm):SP.ALL;
  larks.forEach(function(lb){
    var on=cho.indexOf(lb)>=0, m=SP.METRIC[lb];
    out[lb]={on:on, order:on?String(cho.indexOf(lb)):'', label:m?m[1]:null, star:!!(on&&SP.isReq(hm,lb)), opts:SP.optsOf(hm,lb)||[]};
  });
  return out;
}

/* ═══ Tạo nhanh biến thể ═══ */
export const NBT_BM=['Bề mặt bóng','Bóng mờ','Mờ','Siêu mờ','Siêu bóng','Bán bóng'];
// dòng mới: lấy mặc định từ SP gốc (mã, bề mặt, dung tích) hoặc từ dòng trên cùng (a)
export function spNbtDong_(p, a){ var raw=(p&&p.raw)||{};
  return {ma:a.ma||(p&&p.ma)||'', mau:'', bm:a.bm!=null?a.bm:String(raw.be_mat||''), kt:a.kt!=null?a.kt:String(raw.kich_thuoc||''), gia:''}; }
// dán từ Excel vào ô Mã: 5 cột Mã ⇥ Màu ⇥ Bề mặt ⇥ Dung tích ⇥ Giá · 3 cột Màu ⇥ Dung tích ⇥ Giá · 2 cột Màu ⇥ Giá. null = không phải dán bảng
export function nbtParsePaste_(t, d0){
  t=String(t||''); if(t.indexOf('\n')<0 && t.indexOf('\t')<0) return null;
  return t.split(/\r?\n/).map(function(d){ return d.split('\t').map(function(x){ return String(x||'').trim(); }); })
    .filter(function(c){ return c.some(Boolean); }).map(function(c){
      if(c.length>=5) return {ma:c[0]||d0.ma, mau:c[1], bm:c[2], kt:c[3]||d0.kt, gia:c[4]};
      if(c.length>=3) return {ma:d0.ma, mau:c[0], bm:d0.bm, kt:c[1]||d0.kt, gia:c[2]};
      return {ma:d0.ma, mau:c[0], bm:d0.bm, kt:d0.kt, gia:c[1]||''}; });
}

/* ═══ Ảnh: nén ở client rồi tải lên kho (có thử lại) ═══ */
export function readB64_(f){ return new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){res(String(r.result));}; r.onerror=rej; r.readAsDataURL(f); }); }
export function downscaleImage_(file, maxDim, quality){
  return new Promise(function(resolve){
    try{
      if(!file || !/^image\//.test(file.type||'')){ return readB64_(file).then(resolve,function(){resolve('');}); }
      var url=URL.createObjectURL(file), img=new Image();
      img.onload=function(){
        try{
          var w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
          var scale=Math.min(1,(maxDim||1600)/Math.max(w,h||1));
          var nw=Math.max(1,Math.round(w*scale)), nh=Math.max(1,Math.round(h*scale));
          var c=document.createElement('canvas'); c.width=nw; c.height=nh;
          c.getContext('2d').drawImage(img,0,0,nw,nh);
          URL.revokeObjectURL(url);
          var out=c.toDataURL('image/jpeg', quality||0.82);
          if(out.length>5.5e6){ out=c.toDataURL('image/jpeg',0.6); }
          resolve(out);
        }catch(e){ URL.revokeObjectURL(url); readB64_(file).then(resolve,function(){resolve('');}); }
      };
      img.onerror=function(){ URL.revokeObjectURL(url); resolve('__DECODE_FAIL__'); };   // vd. HEIC iPhone
      img.src=url;
    }catch(e){ resolve('__DECODE_FAIL__'); }
  });
}
// uploadImage có thử lại, backoff tăng dần (rớt mạng / máy chủ khởi động lại)
export async function uploadImg_(dataUrl, name){
  var backoff=[1000,2500,5000,8000], lastErr;
  for(var k=0;k<=backoff.length;k++){
    try{ var r=await api.uploadImage(dataUrl, name||'image.jpg'); var tok=r&&(r.token||r.url); if(tok) return tok; throw new Error('Không nhận được ảnh'); }
    catch(e){ lastErr=e; if(e&&e.name==='QsAuthError') throw e; if(k<backoff.length) await new Promise(function(res){ setTimeout(res,backoff[k]); }); }
  }
  throw lastErr;
}
