/* MUA HÀNG - giá, gộp dòng theo NCC, đơn mua, đề xuất chiết khấu / thanh toán theo đợt. Port nguyên văn PUB/muahang.js.
   S.* thành tham số: vatPct = Number(cur.vat)||0 · hm = hmNode · sel = S._mhSel (map ncc -> false khi bỏ chọn)
   Nguồn: mhPrice..mhIds_ 6-12 · mhGop_ 19-29 · renderMuahang (lọc + gom + dải tổng) 115-140 · mhOn_ 32 · mhOrderOf 150-156
   mhBase 157 · mhValidateInfo 158-163 · mhDx_ / mhDxSum_ 187-188 · dxGiam 189-205 · mhPriceDx_ / mhSendDx 206-226
   mhPay* 227-291, 288-300 (tổng đợt) · mhSendPay 328-348 · DX_TEN_ / dxStatusCls_ 355-357 · mhDaDat_ 482-486 · MH_TT 487 */
import { spNorm_, tkNum_, money } from './format.js'
import { giaDaiLy_ } from './calc.js'
import { nodeName } from './tree.js'

export function mhPrice(l){ return giaDaiLy_(l)||Number(l.donGiaVon)||Number(l.donGiaBan)||0; }
// Giảm giá từ NCC (%) theo dòng -> lưu TRÊN DÒNG (giamGiaNcc)
export function mhDisc_(l){ return Math.max(0,Math.min(100,Number(l.giamGiaNcc)||0)); }
export function mhPriceCK_(l){ return Math.round(mhPrice(l)*(1-mhDisc_(l)/100)); }
export function mhSub_(items){ return items.reduce(function(a,l){ return a+(Number(l.soLuong)||0)*mhPriceCK_(l); },0); }  // tổng = giá SAU chiết khấu
export function mhTot_(items,vatPct){ var s=mhSub_(items); return s+Math.round(s*vatPct/100); }
export function mhIds_(ids){ return String(ids||'').split(',').filter(Boolean); }     // 'a,b,c' = các dòng gốc của 1 dòng đã gộp
// % giảm NCC / % đề xuất nhập vào ô: kẹp 0..100
export function mhPctIn_(v){ return Math.max(0,Math.min(100,Number(v)||0)); }
/* Đề xuất giảm giá (extra.dxGiam) - con số ĐỀ NGHỊ với NCC, tách khỏi giamGiaNcc */
export function mhDx_(l){ return Math.max(0,Math.min(100,Number(l&&l.extra&&l.extra.dxGiam)||0)); }
export function mhDxSum_(items){ return (items||[]).reduce(function(a,l){ return a+mhDx_(l); },0); }
// extra mới của dòng khi đặt đề xuất p% (0 = xoá khoá)
export function mhDxExtra_(l,p){ var ex=Object.assign({}, l.extra||{}); if(p) ex.dxGiam=p; else delete ex.dxGiam; return ex; }
// Đơn giá NẾU nhà cung cấp chấp nhận mức đề xuất
export function mhPriceDx_(l){ return Math.round(mhPrice(l)*(1-mhDx_(l)/100)); }
/* Cùng sản phẩm (mã/tên + ĐVT + giá + mức giảm) nằm ở nhiều tầng / phòng -> 1 DÒNG ĐƠN, cộng số lượng */
export function mhGop_(items){
  var m={}, out=[];
  items.forEach(function(l){
    var k=[spNorm_(l.maSP||l.ten), spNorm_(l.dvt), mhPrice(l), mhDisc_(l), mhDx_(l)].join('|');
    if(!m[k]){ m[k]={l:l, ls:[], sl:0}; out.push(m[k]); }
    m[k].ls.push(l); m[k].sl+=Number(l.soLuong)||0;
  });
  out.forEach(function(g){ g.ids=g.ls.map(function(x){ return x.lineId; }).join(',');
    var vt={}; g.ls.forEach(function(x){ var v=String(x.khuVuc||x.tang||'').trim(); if(v) vt[v]=1; }); g.viTri=Object.keys(vt); });
  return out;
}
export function mhOn_(sel,ncc){ return !(sel&&sel[ncc]===false); }
// Dòng của tab theo hạng mục dùng chung; bỏ dòng đang lưu dở (chưa có id thật)
export function mhLines_(lines,hm){
  var code=hm||'';
  return (lines||[]).filter(function(l){ var c=String(l.nhom||'');
      if(l._pending || String(l.lineId).indexOf('tmp_')===0) return false;
      return !code || c===code || c.indexOf(code+'.')===0; });
}
// Khoá nhà cung cấp của dòng
export function mhNcc_(l){ return String(l.ncc||l.thuongHieu||'Khác').trim()||'Khác'; }
// Gom theo NCC, giữ thứ tự xuất hiện -> [{ncc, items}] (S._mhGroups)
export function mhGroups_(lines){
  var groups={}, order=[];
  lines.forEach(function(l){ var s=mhNcc_(l); if(!groups[s]){groups[s]=[];order.push(s);} groups[s].push(l); });
  return order.map(function(k){ return {ncc:k, items:groups[k]}; });
}
/* Dải số liệu đầu tab: mọi số cùng 1 phạm vi = các NCC ĐANG CHỌN. Tổng cộng (grand) cũng chỉ tính NCC đang chọn. */
/* vatPct: số % chung, hoặc hàm (nhóm NCC) -> % VAT riêng của NCC đó (mhExtra[ncc].vat) */
export function mhHead_(groups,vatPct,sel){
  var vf=typeof vatPct==='function'?vatPct:function(){ return vatPct; };
  var nLines=groups.reduce(function(a,g){ return a+g.items.length; },0);
  var grand=groups.reduce(function(sum,g){ return mhOn_(sel,g.ncc) ? sum+mhTot_(g.items,vf(g)) : sum; },0);
  var chuaCK=groups.reduce(function(a,g){ return mhOn_(sel,g.ncc) ? a+g.items.reduce(function(b,l){ return b+(Number(l.soLuong)||0)*mhPrice(l); },0) : a; },0);
  var sauCK=groups.reduce(function(a,g){ return mhOn_(sel,g.ncc) ? a+mhSub_(g.items) : a; },0);
  var chon=groups.filter(function(g){ return mhOn_(sel,g.ncc); });
  var spChon=chon.reduce(function(a,g){ return a+g.items.length; },0);
  return { nLines:nLines, nNcc:groups.length, nccChon:chon.length, spChon:spChon, chuaCK:chuaCK, sauCK:sauCK,
    vat:groups.reduce(function(a,g){ return mhOn_(sel,g.ncc) ? a+Math.round(mhSub_(g.items)*vf(g)/100) : a; },0), grand:grand };
}
/* PHẦN SỬA TAY THEO NCC (nút Edit trên thẻ NCC, phòng mua hàng) - projData.mhExtra[ncc] = {rows, cols, vals, note}
   rows: hàng thêm tay [{id, ten, dvt, sl, donGia, ghiChu}] -> thành "dòng" giả (_ex) trong nhóm: cộng vào tổng / VAT / kế hoạch
   thanh toán và gửi kèm đơn NCC (ghi chú hàng -> ô khu vực của dòng đơn). cols: cột tự thêm [{id, ten}], vals[khoá dòng][id cột] = chữ
   (gửi kèm đơn: nối vào ô khu vực "Tên cột: giá trị"). note: ghi chú riêng của NCC (nối vào ghi chú đơn khi gửi). */
export function mhExEmpty_(){ return {rows:[], cols:[], vals:{}, note:''}; }
export function mhExOf_(all,ncc){ var e=all&&all[ncc]; return e?Object.assign(mhExEmpty_(), e):mhExEmpty_(); }
// khoá dòng cho giá trị cột tự thêm: hàng thêm tay = x:id, dòng bóc tách = mã/tên + ĐVT (bền khi dòng gộp / tách tầng)
export function mhExKey_(l){ return l._ex ? String(l.lineId) : ('l:'+spNorm_(l.maSP||l.ten)+'|'+spNorm_(l.dvt)); }
export function mhExLine_(r){ var g=tkNum_(r.donGia)||0;
  return {lineId:'x:'+r.id, _ex:true, exId:r.id, maSP:'x:'+r.id, ten:r.ten||'', dvt:r.dvt||'Cái', soLuong:tkNum_(r.sl)||0,
    donGiaVon:g, donGiaBan:g, chietKhau:0, khuVuc:r.ghiChu||'', ghiChuEx:r.ghiChu||'', extra:{}}; }
// nhóm NCC kèm hàng thêm tay (dùng cho thẻ, dải tổng, kế hoạch thanh toán, đơn gửi)
export function mhWithEx_(g,all){ var e=all&&all[g.ncc]; return e&&e.rows&&e.rows.length ? {ncc:g.ncc, items:g.items.concat(e.rows.map(mhExLine_))} : g; }
// bỏ hàng thêm tay (đề xuất chiết khấu chỉ cho dòng bóc tách)
export function mhNoEx_(g){ return {ncc:g.ncc, items:g.items.filter(function(l){ return !l._ex; })}; }
// chữ các cột tự thêm của 1 dòng: "Tên cột: giá trị · ..."
export function mhExColTxt_(ex,l){ var v=(ex&&ex.vals&&ex.vals[mhExKey_(l)])||{};
  return ((ex&&ex.cols)||[]).map(function(c){ var t=String(v[c.id]==null?'':v[c.id]).trim(); return t?(String(c.ten||'Cột').trim()+': '+t):''; }).filter(Boolean).join(' · '); }
// Đơn gửi NCC của 1 nhóm (mhOrderOf); ex = phần sửa tay của NCC (tuỳ chọn) -> cột tự thêm nối vào ô khu vực của dòng
export function mhOrderOf(g,vatPct,ex){
  var sub=g.items.reduce(function(s,l){ return s+(Number(l.soLuong)||0)*mhPriceCK_(l); },0);   // giá SAU chiết khấu
  var vat=Math.round(sub*vatPct/100);
  return { supplier:g.ncc, vatPct:vatPct, vat:vat, total:sub+vat,
    items:mhGop_(g.items).map(function(G){ var l=G.l, kv=[G.viTri.join(', '), mhExColTxt_(ex,l)].filter(Boolean).join(' · '); return {ten:l.ten||'', ma:l._ex?'':(l.maSP||''), thuongHieu:l.thuongHieu||'', khuVuc:kv, hinhAnh:String(l.hinhAnh||'').split('\n')[0], sl:G.sl, dvt:l.dvt||'Cái', donGia:mhPriceCK_(l), donGiaGoc:mhPrice(l), giamGiaPct:mhDisc_(l)}; }) };
}
// Phần chung của payload đơn / đề xuất. info = S._mhInfo {nguoiGui, phongBan, ghiChu}; payload node = hmNode
export function mhBase(cur,hm,info){ var mi=info||{}; return { project:cur&&cur.ten, maDA:cur&&cur.maDA, khachHang:cur&&cur.khachHang, sdt:cur&&cur.sdt, node:hm||'', hangMuc:nodeName(hm||''), nguoiGui:mi.nguoiGui||'', phongBan:mi.phongBan||'', ghiChu:mi.ghiChu||'' }; }
// Kiểm tra trước khi gửi: null = hợp lệ, còn lại {field, msg}
export function mhValidateInfo(info){
  var mi=info||{};
  if(!String(mi.nguoiGui||'').trim()) return {field:'nguoiGui', msg:'Nhập "Người gửi" trước khi gửi đơn'};
  if(!String(mi.phongBan||'').trim()) return {field:'phongBan', msg:'Nhập "Phòng ban" trước khi gửi đơn'};
  return null;
}
// Đơn đã gửi cho NCC còn hiệu lực có chứa sản phẩm l (mhDaDat_); dons = S._mhDon
export function mhDaDat_(dons,ncc,l){
  var t=spNorm_(l.ten), m=spNorm_(l.maSP);
  return (dons||[]).filter(function(d){ return d.ncc===ncc && d.trangThai!=='Từ chối'
    && (d.items||[]).some(function(it){ return spNorm_(it.ten)===t && (!m || !it.ma || spNorm_(it.ma)===m); }); })[0]||null;
}
export const MH_TT={'Chờ duyệt':'cho','Đã duyệt':'duyet','Đã đặt hàng':'dat','Đã nhận hàng':'nhan','Từ chối':'tu'};

/* ═══ ĐỀ XUẤT CHIẾT KHẤU (mhSendDx) - số trong hộp xác nhận + payload POST /proposals ═══ */
export function mhDxSums_(g){
  var sub=g.items.reduce(function(a,l){ return a+(Number(l.soLuong)||0)*mhPriceDx_(l); },0);
  var goc=g.items.reduce(function(a,l){ return a+(Number(l.soLuong)||0)*mhPrice(l); },0);
  return {sub:sub, goc:goc, giam:goc-sub};
}
export function mhDxConfirm_(g){ var s=mhDxSums_(g);
  return 'Gửi đề xuất chiết khấu tới "'+g.ncc+'"?\n\nGiá gốc: '+money(s.goc)+' đ\nSau mức đề xuất: '+money(s.sub)+' đ\nGiảm: '+money(s.goc-s.sub)+' đ'; }
export function mhDxPayload_(base,g,vatPct){
  return Object.assign({}, base, { loai:'ck', supplier:g.ncc, vatPct:vatPct,
    items:g.items.map(function(l){ return {ten:l.ten||'', ma:l.maSP||'', thuongHieu:l.thuongHieu||'',
      khuVuc:l.khuVuc||'', hinhAnh:String(l.hinhAnh||'').split('\n')[0], sl:Number(l.soLuong)||0,
      dvt:l.dvt||'Cái', donGia:mhPriceDx_(l), donGiaGoc:mhPrice(l), giamGiaPct:mhDx_(l)}; }) });
}

/* ═══ ĐỀ XUẤT THANH TOÁN THEO ĐỢT (projData.mhPay = {ncc: [{pct, tien, ngay, gc, tay?}]}) ═══ */
export function mhPayKey_(maDA){ return 'qs_mhtt_'+(maDA||''); }
// Đợt mặc định của NCC chưa có kế hoạch
export function mhPayDefault_(){ return [{pct:100,tien:0,ngay:'',gc:''}]; }
// Số tiền mỗi đợt = % × tổng đơn HIỆN TẠI; đợt gõ tiền tay (tay=1) giữ nguyên. Toàn % và đủ 100% -> đợt cuối gánh phần lẻ.
// SỬA TẠI CHỖ arr như bản gốc.
export function mhPayTinh_(arr,tot){
  var tay=arr.some(function(d){ return d.tay; }), sum=0;
  arr.forEach(function(d){ if(d.tay) return; d.tien=Math.round(tot*(Number(d.pct)||0)/100); });
  var sp=arr.reduce(function(a,d){ return a+(Number(d.pct)||0); },0);
  if(!tay && arr.length && Math.abs(sp-100)<0.05){ arr.slice(0,-1).forEach(function(d){ sum+=d.tien; }); arr[arr.length-1].tien=tot-sum; }
  return arr;
}
// Sửa 1 ô của đợt d (mhPaySet): 'pct' -> tiền theo %, 'tien' -> % theo tiền + đánh dấu tay; khác -> gán thẳng. Sửa tại chỗ d.
export function mhPaySet_(d,f,v,tot){
  if(f==='pct'){ d.pct=Math.max(0,Math.min(100,Number(String(v).replace(',','.'))||0)); d.tien=Math.round(tot*d.pct/100); delete d.tay; }
  else if(f==='tien'){ d.tien=Math.max(0,tkNum_(v)); d.pct=tot?Math.round(d.tien/tot*1000)/10:0; d.tay=1; }
  else d[f]=v;
  return d;
}
// Thêm đợt: phần % còn lại (mhPayAdd)
export function mhPayAdd_(arr,tot){
  var da=arr.reduce(function(a,d){ return a+(Number(d.pct)||0); },0);
  var con=Math.max(0, 100-da);
  arr.push({pct:con, tien:Math.round(tot*con/100), ngay:'', gc:''});
  return arr;
}
// Chia nhanh n đợt (mhPayChia): đợt cuối gánh phần lẻ -> tổng khớp tuyệt đối
export function mhPayChia_(tot,n){
  var arr=[], moi=Math.floor(100/n*10)/10, con=tot;
  for(var i=0;i<n;i++){
    var pct=(i===n-1)?Math.round((100-moi*(n-1))*10)/10:moi;
    var tien=(i===n-1)?con:Math.round(tot*pct/100);
    con-=tien; arr.push({pct:pct, tien:tien, ngay:'', gc:''});
  }
  return arr;
}
// Dòng tổng của kế hoạch: đủ khi lệch <= max(1000 đ, 0,5% tổng đơn)
export function mhPaySum_(arr,tot){
  var sumTien=arr.reduce(function(a,d){ return a+(Number(d.tien)||0); },0);
  var sumPct=arr.reduce(function(a,d){ return a+(Number(d.pct)||0); },0);
  var du=Math.abs(sumTien-tot)<=Math.max(1000, tot*0.005);
  return {sumTien:sumTien, sumPct:sumPct, du:du, thieu:sumTien<tot?tot-sumTien:0, thieuPct:Math.round((100-sumPct)*10)/10, vuot:sumTien>tot?sumTien-tot:0};
}
/* Gửi đề xuất thanh toán (mhSendPay): arr = mhPayTinh_(kế hoạch, tot). Trả {msg} khi không có đợt nào,
   {lech:true, sum, tot} khi cần hỏi lại, payload POST /proposals ở {payload}. */
export function mhPayPayload_(base,g,vatPct,arr0){
  var tot=mhTot_(g.items,vatPct);
  var arr=mhPayTinh_(arr0,tot).filter(function(d){ return (Number(d.tien)||0)>0; });
  if(!arr.length) return {msg:'Chưa nhập đợt thanh toán nào'};
  var sum=arr.reduce(function(a,d){ return a+(Number(d.tien)||0); },0);
  var lech=Math.abs(sum-tot)>Math.max(1000,tot*0.005);
  var payload=Object.assign({}, base, { loai:'tt', supplier:g.ncc, vatPct:vatPct, tongDon:tot,
    dots:arr.map(function(d,i){
      return {dot:i+1, pct:Number(d.pct)||0, tien:Number(d.tien)||0, ngay:d.ngay||'', gc:d.gc||''}; }) });
  return {payload:payload, lech:lech, sum:sum, tot:tot, n:arr.length};
}

export const DX_TEN_={ck:'Đề xuất chiết khấu', tt:'Đề xuất thanh toán'};
export const DX_ICO_={ck:'gauge', tt:'money'};
export function dxStatusCls_(st){ return {'Đã duyệt':'approved','Từ chối':'rejected','Chờ duyệt':'pending'}[st]||'pending'; }
