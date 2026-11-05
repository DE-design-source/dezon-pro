/* XUẤT BÁO GIÁ - tổng, tờ bìa, diện tích, màu, phiên bản. Port nguyên văn PUB/baogia.js; S.* thành tham số ctx:
     ctx = { cur, lines, cover, bgCfg, bgNodes, phanTho, ptVat, congTy, bgOrg }
       cur = dự án đang mở · lines = S.lines · cover = S.cover · bgCfg = projData.bgCfg · bgNodes = S.bgNodes (map mã -> 1)
       phanTho / ptVat = bảng Phần thô + VAT của nó (projData) · congTy = S.congTy · bgOrg = projData.bgOrg
   Nguồn: computeQuoteLocal 8-16 · cover* 17-29, 53-58 · AREA_TEMPLATE / areaCompute_ 64-104 · fmtM2_ 105 · bgPTOn_/bgPTSecs_ 448-466
   BG_DOC_W 316-320 · BG_MAU_DS / bgMau_ / bgMauDat_ 531-537 · BG_KEYMAP 875 · bgSelCodes_ / bgNodeCnt_ / bgLines_ / bgNodeLabel_ 932-952
   bgPerSec_ 1012 · BG_NOI_BO 1016 · bgBiaCanh_ 1021-1029 · bgOrg_ 1040-1046 · BG_DOT_MAC / bgOpt_ 1047-1054 · coverAutoOf_ / coverLeafVal_ 1057-1062
   bgSub_ / bgTong_ 1072-1077 · fmtVN_ 1078 · docSoVN_ 1080-1094 · bgGhiChu_ 1095-1101 · bgHist_ / bgMa_ / BG_SNAP_F / bgSnap_ / bgXep_ / bgSnapKey_ /
   bgVerInfo_ / bgChot_ 1179-1215 · BG_LYDO 1217 */
import { tkNum_, ptN } from './format.js'
import { ttBan_ } from './calc.js'
import { nodeName } from './tree.js'
import { ptSecTotals, ptComputeAll } from './phantho.js'

/* ===== PHẠM VI XUẤT ===== */
// Phần thô đếm theo bảng ước tính riêng của nó (không nằm trong lines)
export function bgNodeCnt_(code, ctx){
  if(code==='3.1') return (ctx.phanTho||[]).reduce(function(a,se){ return a+((se.items||[]).length); },0);
  return (ctx.lines||[]).filter(function(l){ return l.nhom===code||String(l.nhom||'').indexOf(code+'.')===0; }).length;
}
// chỉ tính hạng mục ĐÃ BÓC của dự án đang mở
export function bgSelCodes_(ctx){ var o=ctx.bgNodes||{}; return Object.keys(o).filter(function(k){ return o[k] && bgNodeCnt_(k,ctx)>0; }); }
// Các dòng sẽ lên báo giá (không tích gì = lấy tất cả)
export function bgLines_(ctx){
  var sel=bgSelCodes_(ctx); if(!sel.length) return (ctx.lines||[]).slice();
  return (ctx.lines||[]).filter(function(l){ var c=String(l.nhom||'');
    return sel.some(function(nd){ return c===nd || c.indexOf(nd+'.')===0; }); });
}
export function bgNodeLabel_(ctx){
  var sel=bgSelCodes_(ctx);
  if(!sel.length) return 'TỔNG HỢP CHI PHÍ';
  if(sel.length===1) return nodeName(sel[0])||sel[0];
  return sel.length+' HẠNG MỤC';
}
export function bgPTOn_(ctx){
  var sel=bgSelCodes_(ctx);
  if(!sel.length) return true;                       // không tích gì = xuất tất cả
  return sel.some(function(c){ c=String(c); return c==='3.1' || c.indexOf('3.1.')===0 || '3.1'.indexOf(c+'.')===0; });
}
// Ghi chú: như bản gốc, ptSecTotals gán it._kl / _tt / _ttnt lên dòng của ctx.phanTho
export function bgPTSecs_(ctx){
  if(!bgPTOn_(ctx)||!ctx.cur) return [];
  return (ctx.phanTho||[]).map(function(sec){
    var st=ptSecTotals(sec);
    return { ten:String(sec.t||'Hạng mục').split('\n')[0], tt:st.tt,
      items:(sec.items||[]).map(function(it){
        return { n:String(it.n||'').split('\n')[0]||String(it.n||''), dvt:it.dvt||'', kl:it._kl,
          dg:ptN(it.dg), tt:it._tt, dgnt:ptN(it.dgnt), ttnt:it._ttnt, gc:it.gc||'' };
      }) };
  }).filter(function(x){ return x.items.length; });
}
export function bgPTRows_(ctx){ return bgPTSecs_(ctx).reduce(function(a,s){ return a+s.items.length; },0); }
/* Tổng của tab Xuất báo giá - cộng ĐÚNG phạm vi đang xuất (hạng mục đã tích) + phần thô */
export function computeQuoteLocal(toanDuAn, ctx){
  var ds=toanDuAn?(ctx.lines||[]):bgLines_(ctx);
  var sub=0; ds.forEach(function(l){ sub+=ttBan_(l); });
  var ptErr;
  // Như bản gốc: Phần thô lỗi thì tính 0; thêm ptErr (chỉ khi lỗi) để người gọi báo cho người dùng
  if(!toanDuAn){ try{ bgPTSecs_(ctx).forEach(function(x){ sub+=Number(x.tt)||0; }); }catch(e){ ptErr=String((e&&e.message)||e); } }
  var vatPct=Number(ctx.cur&&ctx.cur.vat)||0, vat=Math.round(sub*vatPct/100);
  var r={subtotal:sub,vatPct:vatPct,vat:vat,total:sub+vat};
  if(ptErr) r.ptErr=ptErr;
  return r;
}

/* ===== TỜ BÌA ===== */
export function coverDepth(s){ return String(s).split('.').length; }
export function coverSortFn(a,b){ function k(s){return String(s).split('.').map(function(x){return parseInt(x,10)||0;});} var ka=k(a.stt),kb=k(b.stt),n=Math.max(ka.length,kb.length); for(var i=0;i<n;i++){var d=(ka[i]||0)-(kb[i]||0); if(d)return d;} return 0; }
export function coverHasChild(cover, stt){ return (cover||[]).some(function(c){ return c.stt!==stt && String(c.stt).indexOf(stt+'.')===0; }); }
// Mục đã ẩn khỏi tờ bìa (bgCfg.an = {stt: 1}): ẩn 1 mục thì ẩn cả các mục con của nó (khớp bản Excel, quotations/service_export.go)
export function bgAn_(bgCfg){ return (bgCfg||{}).an||{}; }
export function bgHidden(stt, bgCfg){ var an=bgAn_(bgCfg), p=String(stt).split('.'); for(var i=1;i<=p.length;i++){ if(an[p.slice(0,i).join('.')]) return true; } return false; }
/* Đánh số lại liên tục các mục đang hiện (bgCfg.soLai, mặc định bật): mục lớn hiện đầu tiên = 1, mục con = 1.1, 1.2…
   rows = mục đang hiện, đã sắp (coverSortFn). Trả {stt gốc: số in}; mục có tổ tiên không nằm trong rows thì đánh theo tổ tiên gần nhất có mặt.
   Cùng thuật toán với coverSoLai (quotations/service_export_opts.go) cho file Excel */
export function bgSoLaiOn_(bgCfg){ return (bgCfg||{}).soLai!==false; }
export function coverSoLai_(rows){ var disp={}, cnt={};
  (rows||[]).forEach(function(c){ var p=String(c.stt).split('.'), pk='';
    for(var i=p.length-1;i>=1;i--){ var a=p.slice(0,i).join('.'); if(Object.prototype.hasOwnProperty.call(disp,a)){ pk=disp[a]; break; } }
    cnt[pk]=(cnt[pk]||0)+1; disp[c.stt]=(pk?pk+'.':'')+cnt[pk]; });
  return disp; }
// bgToggle: map 'an' mới -> bgCfg.an
export function bgToggleAn_(bgCfg, stt){ var a=Object.assign({},bgAn_(bgCfg)); if(a[stt]) delete a[stt]; else a[stt]=1; return a; }
// Giá trị 1 mục LÁ: có dòng bóc tách thuộc mục -> tự cộng (Phần thô cho 3.1 / 3)
export function coverAutoOf_(stt, ctx){ var n=0, t=0;
  (ctx.lines||[]).forEach(function(l){ var c=String(l.nhom||'').trim(); if(c===stt||c.indexOf(stt+'.')===0){ n++; t+=ttBan_(l); } });
  var ptErr;
  if(stt==='3.1'||stt==='3'){ try{ var g=ptComputeAll(ctx.phanTho||[], ctx.ptVat).grand; if(g){ n++; t+=g; } }catch(e){ ptErr=String((e&&e.message)||e); } }
  var r={n:n, tien:Math.round(t)}; if(ptErr) r.ptErr=ptErr;
  return r; }
export function coverLeafVal_(c, ctx){ var a=coverAutoOf_(c.stt, ctx); return (a.n && !bgOpt_(ctx.bgCfg).tay[c.stt]) ? a.tien : (Number(c.chiPhi)||0); }
// bgCfg.tay mới khi bật / tắt "sửa tay" của 1 mục
export function coverTayMap_(bgCfg, stt, on){ var t=Object.assign({},bgOpt_(bgCfg).tay); if(on) t[stt]=1; else delete t[stt]; return t; }
// nhãn cạnh ô chi phí ở chế độ Chỉnh sửa: '' | 'tay' | 'auto'
export function coverTag_(c, ctx){ var a=coverAutoOf_(c.stt, ctx); if(!a.n) return {loai:'', n:0, tien:0};
  return {loai: bgOpt_(ctx.bgCfg).tay[c.stt] ? 'tay' : 'auto', n:a.n, tien:a.tien}; }
export function coverCosts(ctx){
  var cover=ctx.cover||[], cost={};
  cover.forEach(function(c){
    if(coverHasChild(cover, c.stt)){ var s=0; cover.forEach(function(d){ if(d.stt!==c.stt && String(d.stt).indexOf(c.stt+'.')===0 && !coverHasChild(cover, d.stt) && !bgHidden(d.stt, ctx.bgCfg)) s+=coverLeafVal_(d, ctx); }); cost[c.stt]=s; }
    else cost[c.stt]=coverLeafVal_(c, ctx);
  });
  var total=0; cover.forEach(function(c){ if(coverDepth(c.stt)===1 && !bgHidden(c.stt, ctx.bgCfg)) total+=cost[c.stt]; });
  return {cost:cost,total:total};
}
// Sửa 1 ô tờ bìa (coverEdit, phần giá trị): chiPhi đọc số kiểu VN (kèm bật "sửa tay"), stt chỉ giữ số và dấu chấm
export function coverEditVal_(field, value){
  if(field==='chiPhi') return tkNum_(value);
  if(field==='stt') return String(value).replace(/[^\d.]/g,'');
  return value;
}
export function coverAddBig_(cover){ var n=(cover||[]).filter(function(c){return coverDepth(c.stt)===1;}).reduce(function(m,c){ return Math.max(m,parseInt(c.stt,10)||0); },0)+1; return {stt:String(n),hangMuc:'Mục mới',moTa:'',chiPhi:0}; }
export function coverAddSmall_(cover){
  var secs=(cover||[]).filter(function(c){return coverDepth(c.stt)===1;}).sort(coverSortFn);
  var last=secs[secs.length-1], stt='1.1';
  if(last){ var kids=(cover||[]).filter(function(c){return c.stt!==last.stt && String(c.stt).indexOf(last.stt+'.')===0 && coverDepth(c.stt)===2;}); stt=last.stt+'.'+(kids.reduce(function(m,c){ return Math.max(m,parseInt(String(c.stt).split('.')[1],10)||0); },0)+1); }
  return {stt:stt,hangMuc:'Mục nhỏ',moTa:'',chiPhi:0};
}

/* ===== BẢNG TÍNH HỆ SỐ DIỆN TÍCH (tab 0.NHẬP THÔNG TIN) - d = projData.area ===== */
export const AREA_TEMPLATE=[
  {k:'khu_dat',   label:'Diện tích khu đất (tính đơn giá xây thô)', hs:0,   usage:false},
  {k:'xay_dung',  label:'Diện tích xây dựng (trệt)',                hs:1,   usage:true},
  {k:'tang_lau',  label:'Tầng lầu',                                 hs:1,   usage:true},
  {k:'tang_lung', label:'Tầng lửng',                                hs:1,   usage:true},
  {k:'tang_thuong',label:'Tầng thượng',                            hs:1,   usage:true},
  {k:'ban_ham',   label:'Bán hầm (sâu 1.0–1.3m)',                  hs:1.5, usage:false},
  {k:'tang_ham',  label:'Tầng hầm (sâu ≥2.0m)',                    hs:2,   usage:false},
  {k:'mai_bt',    label:'Mái (bê tông)',                            hs:0.7, usage:false},
  {k:'mai_ngoi',  label:'Mái (ngói)',                               hs:0.5, usage:false}
];
// areaSet_: d mới sau khi gõ 1 ô (count / dai / rong), số đọc kiểu VN
export function areaSetVal_(d,k,field,val){ d=Object.assign({},d||{}); d[k]=Object.assign({},d[k]||{}); d[k][field]=tkNum_(val); return d; }
export function areaCompute_(d){ d=d||{}; var rows=[], dtBG=0, dtSD=0, groundArea=0;
  AREA_TEMPLATE.forEach(function(t){ var r=d[t.k]||{}; var cnt=Number(r.count)||0, dai=Number(r.dai)||0, rong=Number(r.rong)||0;
    var dt=dai*rong, tong=dt*cnt, bao=tong*t.hs, usg=t.usage?tong:0;
    if(t.k==='khu_dat') groundArea=dt;   // để tính đơn giá xây thô
    dtBG+=bao; dtSD+=usg;
    rows.push({t:t, cnt:cnt, dai:dai, rong:rong, dt:dt, tong:tong, bao:bao, usg:usg});
  });
  return {rows:rows, dtBaoGia:Math.round(dtBG*100)/100, dtSuDung:Math.round(dtSD*100)/100, groundArea:groundArea};
}
// areaApply_: trường PATCH dự án
export function areaApplyFields_(c){ return { dtBaoGia:String(c.dtBaoGia||''), tongDT:String(c.dtSuDung||'') }; }
export function fmtM2_(n){ n=Math.round((Number(n)||0)*100)/100; return String(n).replace('.',','); }
/* M6.1 - GIẢ ĐỊNH, chờ chủ sản phẩm xác nhận (QT-11 không định nghĩa): đơn giá phần thô / m² đất = chi phí mục 3.1 trên tờ bìa
   ÷ diện tích khu đất (areaCompute_().groundArea = dài × rộng của khu_dat). Chỉ hiển thị ở thẻ bảng tính diện tích.
   Diện tích ≤ 0, chi phí âm hoặc không phải số -> 0 (giao diện hiện '—'). */
export function donGiaPhanTho_(cost31, groundArea){ var a=Number(groundArea), c=Number(cost31||0); return isFinite(a) && a>0 && isFinite(c) && c>=0 ? Math.round(c/a) : 0; }

/* ===== MÀU CHỦ ĐẠO (bgCfg.mau) ===== */
export const BG_MAU_DS=['#0f2942','#2563eb','#0d9488','#16a34a','#b7791f','#dc2626','#7c3aed','#1f2937'];
export function bgMau_(bgCfg){ var m=String((bgCfg||{}).mau||'').trim(); return /^#[0-9a-f]{6}$/i.test(m)?m.toLowerCase():BG_MAU_DS[0]; }
// độ sáng màu (công thức của bgMauDat_)
export function bgMauSang_(m){ var h=String(m||'').replace('#',''); return (parseInt(h.slice(0,2),16)*299+parseInt(h.slice(2,4),16)*587+parseInt(h.slice(4,6),16)*114)/1000; }
// chọn màu: quá nhạt (> 150) -> {msg}; hợp lệ -> {value} (null = màu mặc định, xoá khoá)
export function bgMauDat_(m){
  if(bgMauSang_(m)>150) return {msg:'Màu này quá nhạt — tiêu đề chữ trắng sẽ khó đọc. Chọn màu đậm hơn.'};
  return {value: m===BG_MAU_DS[0]?null:m};
}

/* ===== TỔNG KẾT & ĐIỀU KHOẢN ===== */
export function bgOrg_(congTy, bgOrg){
  var ct=congTy||{}, o=bgOrg||{};
  var sdt=o.sdt||ct.sdt||'', email=o.email||ct.email||'';
  var lienHe=[sdt?('ĐT: '+sdt):'', email?('Email: '+email):''].filter(Boolean).join('   ');
  return { ten:o.ten||ct.ten||'Công ty', logo:o.logo||ct.logoUrl||'',
    lines:[o.diaChi, lienHe, o.xuong, o.web?('Website: '+o.web):''].filter(function(x){ return String(x||'').trim(); }) };
}
export const BG_DOT_MAC=[['Tạm ứng khi ký hợp đồng',50],['Khi giao hàng / thi công',40],['Nghiệm thu, bàn giao',10]];
// now: Date dùng cho ngày mặc định (YYYY-MM-DD theo giờ máy)
export function bgOpt_(bgCfg, now){
  var c=bgCfg||{};
  return { ck:Math.max(0,Number(c.ck)||0), ckKieu:c.ckKieu==='vnd'?'vnd':'pct',
    ngay:c.ngay||(now||new Date()).toLocaleDateString('sv-SE'),
    hieuLuc:c.hieuLuc==null?30:Math.max(0,Number(c.hieuLuc)||0),
    dot:Array.isArray(c.dot)?c.dot:BG_DOT_MAC, ghiChu:c.ghiChu==null?null:String(c.ghiChu), tay:c.tay||{} };
}
// bgOptSet_: bgCfg mới (v null = xoá khoá)
export function bgOptSet_(bgCfg,k,v){ var c=Object.assign({},bgCfg||{}); if(v==null) delete c[k]; else c[k]=v; return c; }
// Cộng chưa VAT của báo giá đang xuất: dòng thuộc hạng mục đã chọn + Phần thô (nếu đang xuất)
export function bgSub_(ctx){ return bgLines_(ctx).reduce(function(a,l){ return a+ttBan_(l); },0)+bgPTSecs_(ctx).reduce(function(a,sec){ return a+(Number(sec.tt)||0); },0); }
/* VAT theo hạng mục (projData.vatHm = {mã hạng mục: %}, đặt ở Bóc tách): mã chưa đặt thì xét mã cha (3.2.7 -> 3.2 -> 3),
   vẫn chưa có thì VAT dự án; Phần thô (3.1) chưa đặt thì theo VAT Phần thô */
export function vatOf_(ctx, code){
  var m=(ctx&&ctx.vatHm)||{}, p=String(code||'').split('.');
  for(var i=p.length;i>0;i--){ var k=p.slice(0,i).join('.'); if(m[k]!=null&&m[k]!==''&&isFinite(Number(m[k]))) return Number(m[k]); }
  if(String(code)==='3.1'&&ctx&&ctx.ptVat!=null) return Number(ctx.ptVat)||0;
  return Number(ctx&&ctx.cur&&ctx.cur.vat)||0;
}
/* Phần tiền chưa VAT của phạm vi đang xuất, mỗi phần kèm % VAT: [{tt, vp}] (dòng theo hạng mục + Phần thô) */
export function bgVatParts_(ctx){
  var by={}, ds=[];
  bgLines_(ctx).forEach(function(l){ var k=(l.nhom||'').trim(); by[k]=(by[k]||0)+ttBan_(l); });
  Object.keys(by).forEach(function(k){ ds.push({tt:by[k], vp:vatOf_(ctx,k)}); });
  try{ var pt=bgPTSecs_(ctx).reduce(function(a,s){ return a+(Number(s.tt)||0); },0); if(pt) ds.push({tt:pt, vp:vatOf_(ctx,'3.1')}); }catch(e){ /* Phần thô lỗi: 0 như computeQuoteLocal */ }
  return ds;
}
/* Tổng: tạm tính -> chiết khấu tổng -> VAT. vat = % chung (cur.vat); parts = [{tt, vp}] khi VAT khác nhau theo hạng mục:
   VAT = Σ phần × (sau chiết khấu / tạm tính) × % của phần. vatPct = % chung nếu mọi phần cùng %, khác nhau thì null;
   vatNhan = chữ in cạnh "VAT": "(theo VAT hạng mục)" khi có parts, không thì "10%" */
export function bgTong_(sub, bgCfg, vat, parts){
  var o=bgOpt_(bgCfg), ck=o.ckKieu==='vnd'?Math.min(sub,o.ck):Math.round(sub*Math.min(100,o.ck)/100);
  var sau=sub-ck, vp=Number(vat)||0, vatAmt=Math.round(sau*vp/100), vatPct=vp, vatDs=[vp];
  var ps=(parts||[]).filter(function(x){ return Number(x.tt); }), tong=ps.reduce(function(a,x){ return a+Number(x.tt); },0);
  if(ps.length&&tong){
    var hs=sau/tong; vatAmt=Math.round(ps.reduce(function(a,x){ return a+Number(x.tt)*hs*(Number(x.vp)||0)/100; },0));
    vatDs=ps.map(function(x){ return Number(x.vp)||0; }).filter(function(v,i,a){ return a.indexOf(v)===i; }).sort(function(a,b){ return a-b; });
    vatPct=vatDs.length===1?vatDs[0]:null;
  }
  // tính theo từng hạng mục -> nhãn không ghi 1 con số % mà ghi rõ cách tính
  var vatNhan=ps.length&&tong?'(theo VAT hạng mục)':vatDs.map(function(v){ return v+'%'; }).join(' · ');
  return {sub:sub, ck:ck, ckPct:sub?ck/sub*100:0, sau:sau, vatPct:vatPct, vatDs:vatDs, vatNhan:vatNhan, vat:vatAmt, total:sau+vatAmt};
}
export function fmtVN_(iso){ var d=new Date(iso); if(isNaN(d)) return String(iso||''); return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear(); }
// Đọc số tiền thành chữ: 239769720 -> "Hai trăm ba mươi chín triệu bảy trăm sáu mươi chín nghìn bảy trăm hai mươi đồng"
export function docSoVN_(n){
  n=Math.round(Math.abs(Number(n)||0)); if(!n) return 'Không đồng';
  var CS=['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'], DV=['','nghìn','triệu','tỷ','nghìn tỷ','triệu tỷ'];
  function ba(x,du){ var tr=Math.floor(x/100), ch=Math.floor(x%100/10), d=x%10, o=[];
    if(du||tr) o.push(CS[tr]+' trăm');
    if(ch>1){ o.push(CS[ch]+' mươi'); if(d===1) o.push('mốt'); else if(d===5) o.push('lăm'); else if(d) o.push(CS[d]); }
    else if(ch===1){ o.push('mười'); if(d===5) o.push('lăm'); else if(d) o.push(CS[d]); }
    else if(d){ o.push((du||tr)?'lẻ '+CS[d]:CS[d]); }
    return o.join(' '); }
  var g=[]; while(n>0){ g.push(n%1000); n=Math.floor(n/1000); }
  var out=[];
  for(var i=g.length-1;i>=0;i--){ if(!g[i]) continue; out.push(ba(g[i], i<g.length-1)+(DV[i]?' '+DV[i]:'')); }
  var t=out.join(' ');
  return t.charAt(0).toUpperCase()+t.slice(1)+' đồng';
}
export function bgGhiChu_(q, bgCfg){
  var o=bgOpt_(bgCfg);
  if(o.ghiChu!=null) return o.ghiChu.split('\n').map(function(x){ return x.trim(); }).filter(Boolean);
  return ['Khối lượng trên là tạm tính, khối lượng quyết toán theo thực tế thi công.',
    'Giá trên chưa bao gồm nhân công hoàn thiện.',
    q.vatPct==null?('Đơn giá chưa gồm VAT; thuế VAT theo từng hạng mục ('+(q.vatDs||[]).map(function(v){ return v+'%'; }).join(' · ')+') đã tính ở phần tổng.')
      :q.vatPct?('Đơn giá chưa gồm VAT; thuế VAT '+q.vatPct+'% đã tính ở phần tổng.'):'Giá trên chưa bao gồm thuế VAT.'];
}
/* Nội dung khối tổng kết của trang cuối (bgTongKetHTML_ 1102-1123, phần chữ / số): dùng CHUNG cho bản xem trước và
   opts.tongKet của file Excel (M8.1) để hai bên luôn cùng chữ, cùng số. q = bgTong_(...) · me = người đang đăng nhập.
   dot[i].soTien = Math.round(q.total * pct / 100) như bản gốc; ghiChu đã gồm câu hiệu lực. */
export function bgTongKetData_(q, bgCfg, me, now){
  var o=bgOpt_(bgCfg, now);
  var dot=(o.dot||[]).filter(function(d){ return d && String(d[0]||'').trim(); }).map(function(d){
    var pct=Number(d[1])||0; return {noiDung:d[0], pct:pct, soTien:Math.round(q.total*pct/100)}; });
  var het=new Date(o.ngay); het.setDate(het.getDate()+o.hieuLuc);
  var ghi=bgGhiChu_(q, bgCfg).concat(o.hieuLuc?['Báo giá có hiệu lực '+o.hieuLuc+' ngày kể từ ngày '+fmtVN_(o.ngay)+' (đến hết ngày '+fmtVN_(het)+').']:[]);
  return {ngay:fmtVN_(o.ngay), hieuLuc:o.hieuLuc, dot:dot, ghiChu:ghi, nguoi:(me&&(me.hoTen||me.username))||''};
}
// Tờ bìa cộng TOÀN dự án; trang cuối chỉ cộng phần đang xuất -> cảnh báo khi lệch >= 1000 đ. null = không cảnh báo.
export function bgBiaCanh_(ctx){
  if(!(ctx.cover||[]).length) return null;
  var bia=coverCosts(ctx).total, cuoi=bgSub_(ctx); if(Math.abs(bia-cuoi)<1000) return null;
  var ly=[]; if(bgSelCodes_(ctx).length) ly.push('trang 2+ chỉ xuất '+bgSelCodes_(ctx).length+' hạng mục đã chọn');
  if(!bgPTOn_(ctx) && (ctx.phanTho||[]).length) ly.push('không xuất Phần thô');
  ly.push('hoặc tờ bìa có số sửa tay');
  return {bia:bia, cuoi:cuoi, ly:ly};
}

/* ===== CỘT TÀI LIỆU ===== */
export const BG_DOC_W={ khuVuc:64, maBanVe:56, nganh:70, maSP:66, ten:150, thuongHieu:64,
  ncc:64, moTa:150, kichThuoc:82, hinhAnh:52, dvt:34, soLuong:40, giaNCC:66,
  chietKhau:44, giaDaiLy:66, lnPct:44, donGia:70, ckKhach:44, donGiaCK:70,
  markup:46, margin:46, lnVnd:66, thanhTien:84, trangThai:60, ghiChu:70,
  n:200, kl:56, dg:76, tt:88, dgnt:76, ttnt:88, gc:110 };   // cột bảng Phần thô
export function bgDocW_(k, bgColW){ return Math.max(22, Number((bgColW||{})[k])||BG_DOC_W[k]||64); }
export const BG_KEYMAP={donGia:'donGia', donGiaCK:'donGiaCK', thanhTien:'thanhTien', giaNCC:'giaNCC'};
// Cột nội bộ (giá vốn, CK đại lý, lợi nhuận) - mặc định không in (bgCfg.noiBo)
export const BG_NOI_BO={giaNCC:'Giá bán lẻ NCC', chietKhau:'CK đại lý', giaDaiLy:'Giá đại lý', lnPct:'% lợi nhuận', markup:'Markup', margin:'Margin', lnVnd:'Lợi nhuận (VND)'};
export function bgNoiBoXuat_(bgCfg){ return !!((bgCfg||{}).noiBo); }
export function bgNoiBoBat_(cols){ return Object.keys(BG_NOI_BO).filter(function(k){ return cols&&cols[k]; }); }
// mỗi hạng mục 1 trang (S.bgPerSec, mặc định bật)
export function bgPerSec_(bgPerSec){ return bgPerSec!==false; }

/* ===== MÃ BÁO GIÁ + PHIÊN BẢN (projData.bgHist) ===== */
export function bgHist_(projData){ var h=projData&&projData.bgHist; return Array.isArray(h)?h:[]; }
export function bgMa_(cur){ var p=cur||{}; return String(p.maBaoGia||'').trim()||('BG-'+String(p.maDA||'').replace(/^DA-/,'')); }
export const BG_SNAP_F=['lineId','nhom','tang','khuVuc','maBanVe','maSP','ten','thuongHieu','ncc','moTa','kichThuoc','hinhAnh','dvt',
  'soLuong','donGiaVon','chietKhau','lnPct','donGiaBan','ckKhach','trangThai','ghiChu','extra'];
/* Bản chụp nội dung báo giá. gd = giao diện lúc chụp, ĐÚNG khoá bản gốc:
     { cols:S.cols, ord:S.colOrder, bgOrd:S.bgColOrder, w:S.bgColW, bia:S.coverMau, sec:bgPerSec_(), per:Number(S.bgPer)||0, org:projData.bgOrg||null } */
export function bgSnap_(ctx, gd){
  var cc=coverCosts(ctx);
  return { lines:(ctx.lines||[]).map(function(l){ var o={}; BG_SNAP_F.forEach(function(k){ if(l[k]!=null&&l[k]!=='') o[k]=l[k]; }); return o; }),
    cover:(ctx.cover||[]).map(function(c){ return {stt:c.stt, hangMuc:c.hangMuc, moTa:c.moTa, chiPhi:coverHasChild(ctx.cover, c.stt)?0:cc.cost[c.stt]}; }),
    opt:Object.assign({},ctx.bgCfg||{}), nodes:bgSelCodes_(ctx),
    pt:JSON.parse(JSON.stringify(ctx.phanTho||[])),   // BẢN SAO: sửa Phần thô sau khi chốt không làm đổi bản đã chốt
    proj:{vat:ctx.cur.vat, khachHang:ctx.cur.khachHang, ten:ctx.cur.ten},
    // bản gốc chụp BẢN SAO cols / colOrder / bgColOrder / bgColW: đổi giao diện sau khi chốt không làm đổi bản đã chốt
    gd:gd?Object.assign({},gd,{ cols:Object.assign({},gd.cols), ord:(gd.ord||[]).slice(), bgOrd:(gd.bgOrd||[]).slice(),
      w:Object.assign({},gd.w||{}), per:Number(gd.per)||0, org:gd.org||null }):gd };
}
export function bgXep_(v){ if(Array.isArray(v)) return v.map(bgXep_); if(v&&typeof v==='object'){ var o={}; Object.keys(v).sort().forEach(function(k){ if(v[k]!=null) o[k]=bgXep_(v[k]); }); return o; } return v; }
export function bgSnapKey_(sn){ return JSON.stringify(bgXep_([sn.lines,sn.cover,sn.opt,sn.nodes,sn.proj,sn.pt,sn.gd||null])); }
// verXem = phiên bản cũ đang xem lại (S._bgVerXem) hoặc null; snapKey = bgSnapKey_(bgSnap_(...)) hiện tại
export function bgVerInfo_(hist, cur, snapKey, verXem){
  if(verXem) return {ma:verXem.ma, ver:verXem.ver, nhan:'v'+verXem.ver+' (đã chốt)', trung:true};
  var h=hist||[], last=h[h.length-1], ma=bgMa_(cur);
  if(last && last.key===snapKey) return {ma:ma, ver:last.ver, nhan:'v'+last.ver+' (đã chốt)', trung:true};
  return {ma:ma, ver:(last?last.ver:0)+1, nhan:'v'+((last?last.ver:0)+1)+(last?' (bản nháp)':''), trung:false};
}
/* Chốt phiên bản (bgChot_). lyDo: 'chot' | 'pdf' | 'excel'. Trùng nội dung bản cuối -> {v:last, hist:null, trung:true} (không lưu).
   Mới -> {v, hist} : hist = mảng ghi vào projData 'bgHist' (giữ 20 bản; chỉ 10 bản mới nhất còn bản chụp đầy đủ).
   q = bgTong_(computeQuoteLocal(false, ctx).subtotal, bgCfg, cur.vat) · by = me.hoTen || me.username */
export function bgChot_(hist, sn, cur, q, lyDo, by, now){
  var key=bgSnapKey_(sn), h=hist||[], last=h[h.length-1];
  if(last && last.key===key) return {v:last, hist:null, trung:true};
  var v={ ver:(last?last.ver:0)+1, ma:bgMa_(cur), at:(now||new Date()).toISOString(), by:by||'', lyDo:lyDo||'chot',
    tong:q.total, sub:q.sub, n:sn.lines.length, key:key, snap:sn };
  var moi=h.concat([v]).slice(-20).map(function(x,i,arr){ return i<arr.length-10 && x.snap ? Object.assign({},x,{snap:null}) : x; });
  return {v:v, hist:moi, trung:false};
}
export const BG_LYDO={chot:'Chốt tay', pdf:'Xuất PDF / In', excel:'Xuất Excel'};
