/* PHẦN THÔ (đề mục 3.1) - hằng số + công thức, port nguyên văn PUB/phantho.js.
   Nguồn: PT_TEMPLATE 14-201 (+PT_SOBO 213-288) · PT_MAU 207-212 · PT_ROMAN 289 · PT_LOAI 302-307 · ptSecsOfLoai_/ptLoaiCount_ 318-319
   DT_BO 326-367 · dtKey_..dtTien_ 368-453 · PT_CONTRACTORS 511 · ctOf_ 518 · ctSecOf_ / ctItemArr_ / ctSyncTemplate_ 611-641 · ptOvr* / ptBase_ / ptVal_ /
   ptCanEditF_ / ptMakeItem_ / ptDaCo_ / ptLibDg_ 1169-1225 · ptSecLoai_/ptFindSec_/ptNewSec_ 1655-1661 · ptEnsure (giá trị) 1934-1951
   ptHs_ / ptAutoKL_ / ptSecTotals / ptComputeAll 1957-1983 · ptMround_ / ptDgTuLn_ / ptLnTuDg_ / ptEdit 2008-2031 · ptLoaiGop_ sanpham.js:1334
   Khác bản gốc: S.phanTho / S.ptVat / S._ptOvr / PT_TEMPLATE toàn cục thành tham số; KHÔNG chạy dtSync_ lúc nạp module. */
import { ptN, ptR0, ptR2, ptR4_, ptQty, ptMoneyN_ } from './format.js'

export function ptLoaiGop_(v){ return String(v||'kt_chitiet'); }
export function ptSecLoai_(x){ return (x&&x.loai)||'kt_chitiet'; }
// Bộ mẫu MỚI cho 1 phiên làm việc (bản gốc: PT_TEMPLATE=PT_TEMPLATE.concat(PT_SOBO), rồi dtSync_ thêm các nhóm dự toán)
export function ptTemplateNew_(){ return JSON.parse(JSON.stringify(PT_TEMPLATE_GOC.concat(PT_SOBO))); }
export function ptSecsOfLoai_(tpl,v){ v=ptLoaiGop_(v); return tpl.filter(function(s){ return !s.an && ptLoaiGop_(s.loai)===v; }); }
export function ptLoaiCount_(tpl,v){ return ptSecsOfLoai_(tpl,v).reduce(function(a,s){ return a+s.items.length; },0); }

/* ═══ DỰ TOÁN THEO ĐỊNH MỨC ═══ */
export function dtKey_(maDA,id){ return 'qs_dt_'+(maDA||'')+'_'+id; }   // theo dự án
// Số liệu đầu vào: mặc định của bộ, ghi đè bằng bản đã lưu (saved = JSON đã parse của localStorage dtKey_)
export function dtVals_(bo,saved){
  var v={}; bo.inputs.forEach(function(a){ v[a[0]]=a[3]; });
  if(saved&&typeof saved==='object') Object.keys(saved).forEach(function(k){ if(v[k]!==undefined) v[k]=ptN(saved[k]); });
  return v;
}
// Đọc 1 ô nhập (dtSetIn): ô tiền theo ptMoneyN_, ô số theo ptN
export function dtInVal_(bo,k,val){ var def=bo.inputs.filter(function(a){ return a[0]===k; })[0]; return def&&def[4]?ptMoneyN_(val):ptN(val); }
// tính toàn bộ khối lượng của 1 bộ dự toán
export function dtCalc_(bo,v){
  var dm=v.dai?(v.sl*v.dai/100):0;                       // khối lượng theo đơn vị định mức (100m)
  return {v:v, dm:dm, kl:bo.kl.map(function(a){ return {t:a[0],ct:a[1],r:a[2](v),dvt:a[3]}; })};
}
/* sinh 2 nhóm (Nhân công & máy / Vật tư) cho mỗi bộ vào tpl - GIỮ NGUYÊN object để index thư viện không đổi.
   valsOf(bo) -> số liệu đầu vào của bộ (dtVals_) */
export function dtSync_(tpl,valsOf){
  DT_BO.forEach(function(bo,bi){
    var c=dtCalc_(bo,valsOf(bo)), v=c.v;
    var nc=[], vt=[];
    bo.hp.forEach(function(a){
      var kl=ptR4_(a[3]*c.dm);
      nc.push([a[1]+'\n('+a[0]+' · '+ptQty(a[3])+' '+a[2]+'/'+bo.dinhMuc+')', a[2], kl, a[4], a[5], a[4]]);
    });
    bo.ct.forEach(function(a){
      nc.push([a[1]+'\n('+a[0]+')', a[2], ptR4_(a[3](v)), a[4], a[5], a[4]]);
    });
    bo.vt.forEach(function(a){
      vt.push([a[0], a[1], ptR4_(a[2](v)), ptR0(a[3](v)), a[4], ptR0(a[3](v))]);
    });
    dtPut_(tpl,bo,'dt_nhancong','NHÂN CÔNG & MÁY THI CÔNG — '+bo.ten.toUpperCase(), bi+1, nc);
    dtPut_(tpl,bo,'dt_vattu',   'VẬT TƯ — '+bo.ten.toUpperCase(),                   bi+1, vt);
  });
  return tpl;
}
export function dtPut_(tpl,bo,loai,ten,r,items){
  var sec=tpl.filter(function(s){ return s.dtId===bo.id && s.loai===loai; })[0];
  if(!sec){ sec={r:String(r),t:ten,loai:loai,mode:'item',note:bo.nguon,up:0,dtId:bo.id,items:[]}; tpl.push(sec); }
  sec.t=ten; sec.note=bo.nguon; sec.items=items;
}
// số liệu đầu vào đổi -> cập nhật KHỐI LƯỢNG các dòng đã thêm vào bảng (sửa tại chỗ phanTho); trả số dòng đã đổi (>0 thì lưu)
export function dtApplyToTable_(tpl,phanTho){
  if(!Array.isArray(phanTho)) return 0; var n=0;
  tpl.filter(function(s){ return s.dtId; }).forEach(function(tsec){
    var sec=phanTho.filter(function(s){ return s.t===tsec.t; })[0]; if(!sec) return;
    tsec.items.forEach(function(a){
      sec.items.forEach(function(it){ if(String(it.n||'')===String(a[0])){ it.kl=a[2]; n++; } });
    });
  });
  return n;
}
export function dtSecs_(tpl,bo){ return tpl.filter(function(s){ return s.dtId===bo.id; }); }
export function dtApplied_(tpl,bo,phanTho){
  if(!Array.isArray(phanTho)) return false;
  return dtSecs_(tpl,bo).every(function(t){ return phanTho.some(function(s){ return s.t===t.t; }); });
}
// tiền của bộ: [nhân công & máy, vật tư, tổng trực tiếp]
export function dtTien_(tpl,bo){
  var nc=0, vt=0;
  dtSecs_(tpl,bo).forEach(function(t){
    var s=t.items.reduce(function(a,x){ return a+ptR0(ptN(x[2])*ptN(x[3])); },0);
    if(t.loai==='dt_vattu') vt+=s; else nc+=s;
  });
  return {nc:nc, vt:vt, tong:nc+vt};
}

/* ═══ CÔNG TÁC CSDL + GIÁ SỬA TAY (qs_ptovr) ═══ ovr = map đã JSON.parse của localStorage qs_ptovr */
export function ctOf_(a){ return (a && a.ct) || null; }
export function ctSecOf_(sec){ return !!(sec && sec.db); }
// Công tác CSDL -> 1 dòng của thư viện mẫu (mảng như PT_TEMPLATE, kèm a.ct = bản ghi gốc)
export function ctItemArr_(c){
  var a;
  if(c.mode==='item') a=[c.ten, c.dvt, (c.kl===''||c.kl==null)?1:c.kl, c.dg, c.gc, c.dgnt];
  else if(c.mode==='area'||c.mode==='area0') a=[c.ten, c.dvt, c.dt===''?0:c.dt, c.hs===''?1:c.hs, c.gc];
  else a=[c.ten, c.dvt, c.gc];
  a.ct=c; return a;
}
/* Gom công tác CSDL (congTac = kết quả ctList) thành các hạng mục, nối vào bộ mẫu tpl.
   Loại báo giá nào ĐÃ có trong CSDL thì bản dựng sẵn của loại đó bị ẩn (sc.an) để mỗi công tác chỉ hiện MỘT lần.
   Khác bản gốc: PT_TEMPLATE / S.congTac thành tham số; trả {tpl: mảng mẫu MỚI (bản gốc gán lại PT_TEMPLATE), dbLoai (S._ptDbLoai)}.
   Như bản gốc, cờ 'an' được gán lên chính các hạng mục dựng sẵn của tpl truyền vào. */
export function ctSyncTemplate_(tpl, congTac){
  var out=(tpl||[]).filter(function(s){ return !s.db; });
  var list=ctSortThuTu_(congTac), secs={}, order=[];
  list.forEach(function(c){
    var loai=c.loai||'kt_chitiet', t=c.hangMuc||'CHƯA PHÂN NHÓM';
    var dm=String(c.deMuc||'').trim(), k=loai+'|'+t+'|'+dm;   // khác đề mục = nhóm khác (mỗi nhóm 1 đề mục)
    if(!secs[k]){ secs[k]={r:c.maNhom||'', t:t, loai:loai, mode:c.mode||'item', db:true, up:0, deMuc:dm, items:[]}; order.push(k); }
    var sec=secs[k];
    if(!sec.r && c.maNhom) sec.r=c.maNhom;
    if(sec.mode==='area' && !sec.up && c.dg) sec.up=c.dg;      // đơn giá chung của nhóm
    sec.items.push(ctItemArr_(c));
  });
  order.forEach(function(k){ out.push(secs[k]); });
  var dbLoai={}; list.forEach(function(c){ dbLoai[c.loai||'kt_chitiet']=1; });
  out.forEach(function(sc){ sc.an = !sc.db && !!dbLoai[ptSecLoai_(sc)]; });
  return {tpl:out, dbLoai:dbLoai};
}
export function ptOvrKey_(sec,a){ return [ptSecLoai_(sec),String(sec.t).split('\n')[0],String(a[0]).split('\n')[0],String(a[1]||'')].join('|'); }
export function ptOvrOf_(ovr,sec,a){ return (ovr||{})[ptOvrKey_(sec,a)]||null; }
// sửa TẠI CHỖ ovr như bản gốc; người gọi tự lưu localStorage qs_ptovr
export function ptOvrSet_(ovr,sec,a,f,v){
  var U=ovr, k=ptOvrKey_(sec,a), o=U[k]||{};
  if(v===''||v==null) delete o[f]; else o[f]=v;
  if(Object.keys(o).length) U[k]=o; else delete U[k];
  return U;
}
export function ptOvrDaSua_(ovr,sec,a){ return ctOf_(a)?false:!!ptOvrOf_(ovr,sec,a); }
// Giá trị gốc của 1 trường theo kiểu hạng mục
export function ptBase_(sec,a,f){
  var c=ctOf_(a);
  if(c){ var v=c[f]; if(f==='dg'&&sec.mode==='area'&&!v) v=Number(sec.up)||0; return (v==null?'':v); }
  if(f==='dvt') return a[1]||'';
  if(sec.mode==='item'){ if(f==='kl') return Number(a[2])||0; if(f==='dg') return Number(a[3])||0; if(f==='gc') return a[4]||''; if(f==='dgnt') return Number(a[5])||0; return ''; }
  if(sec.mode==='area'||sec.mode==='area0'){ if(f==='dt') return Number(a[2])||0; if(f==='hs') return Number(a[3])||0; if(f==='gc') return a[4]||'';
    if(f==='dg') return (sec.mode==='area')?(Number(sec.up)||0):0; return ''; }
  if(f==='gc') return a[2]||'';
  return '';
}
// Giá trị đang dùng (đã áp phần sửa của người dùng)
export function ptVal_(sec,a,f,ovr){
  if(ctOf_(a)) return ptBase_(sec,a,f);
  var o=ptOvrOf_(ovr,sec,a);
  if(o && o[f]!=null && o[f]!=='') return (['kl','dt','hs','dg','dgnt'].indexOf(f)>=0)?(Number(o[f])||0):o[f];
  return ptBase_(sec,a,f);
}
// Trường nào sửa được ở hạng mục này (đơn giá của nhóm 'area' là giá chung -> không sửa lẻ)
export function ptCanEditF_(sec,f){
  if(ctSecOf_(sec)){
    if(f==='dvt'||f==='gc') return true;
    if(sec.mode==='item') return ['kl','dt','hs','dg','dgnt'].indexOf(f)>=0;
    if(sec.mode==='area'||sec.mode==='area0') return ['dt','hs','dg'].indexOf(f)>=0;
    return false;
  }
  if(f==='dvt'||f==='gc') return true;
  if(sec.mode==='item') return ['kl','dt','hs','dg','dgnt'].indexOf(f)>=0;
  if(sec.mode==='area'||sec.mode==='area0') return ['dt','hs'].indexOf(f)>=0;
  return false;
}
// Dựng 1 dòng item để thêm vào bảng khái toán - luôn lấy giá ĐANG dùng
export function ptMakeItem_(sec,a,ovr){
  if(sec.mode==='item') return {n:a[0],dvt:ptVal_(sec,a,'dvt',ovr),kl:ptVal_(sec,a,'kl',ovr),dg:ptVal_(sec,a,'dg',ovr),gc:ptVal_(sec,a,'gc',ovr),dgnt:ptVal_(sec,a,'dgnt',ovr)};
  if(sec.mode==='area'||sec.mode==='area0') return {n:a[0],dvt:ptVal_(sec,a,'dvt',ovr),dt:ptVal_(sec,a,'dt',ovr),hs:ptVal_(sec,a,'hs',ovr),gc:ptVal_(sec,a,'gc',ovr)};
  return {n:a[0],dvt:ptVal_(sec,a,'dvt',ovr),gc:ptVal_(sec,a,'gc',ovr)};
}
// công tác đã có trong bảng của dự án đang mở chưa (so theo tên + đúng hạng mục/loại)
export function ptDaCo_(sec,a,phanTho){
  var ten=String(a[0]);
  var s=(phanTho||[]).filter(function(x){ return x.t===sec.t && ptSecLoai_(x)===ptSecLoai_(sec); })[0];
  return !!(s && (s.items||[]).some(function(it){ return String(it.n||'')===ten; }));
}
export function ptLibDg_(sec,a,ovr){ if(sec.mode==='item') return ptVal_(sec,a,'dg',ovr); if(sec.mode==='area') return Number(sec.up)||0; return 0; }
export function ptFindSec_(phanTho,tsec){
  return (phanTho||[]).filter(function(s){ return s.t===tsec.t && ptSecLoai_(s)===ptSecLoai_(tsec); })[0];
}
export function ptNewSec_(tsec){
  return {t:tsec.t,mode:tsec.mode,loai:ptSecLoai_(tsec),note:tsec.note||'',up:tsec.up||0,items:[]};
}
/* Thêm cả nhóm mẫu tsec vào bảng (phần dữ liệu của ptAddToSec_): sửa tại chỗ phanTho, trả số dòng đã thêm */
export function ptAddToSec_(phanTho,tsec,ovr){
  var sec=ptFindSec_(phanTho,tsec);
  if(!sec){ sec=ptNewSec_(tsec); phanTho.push(sec); }
  var added=0;
  tsec.items.forEach(function(a){
    var ten=String(a[0]);
    if(sec.items.some(function(x){ return String(x.n||'')===ten; })) return;   // bỏ qua dòng đã có
    sec.items.push(ptMakeItem_(tsec,a,ovr)); added++;
  });
  return added;
}
/* Bảng + VAT của dự án khi mở (ptEnsure): ưu tiên bản trên server (projData), không có thì bản dự phòng trong máy.
   localPhanTho = JSON.parse(localStorage 'pt_<maDA>'), localVat = localStorage 'pt_<maDA>_vat' */
export function ptKey(maDA){ return 'pt_'+(maDA||'x'); }
export function ptEnsureVals_(projData,cur,localPhanTho,localVat){
  var saved=(projData&&projData.phanTho);
  if(!Array.isArray(saved)) saved=localPhanTho;
  var phanTho = Array.isArray(saved) ? saved : [];
  var v=(projData&&projData.ptVat);
  if(v==null||v==='') v=localVat;
  var nv=Number(v);
  // VAT phần thô mặc định LẤY THEO VAT CỦA DỰ ÁN
  var ptVat = (v!=null&&v!==''&&isFinite(nv))?nv:(Number(cur&&cur.vat)||0);
  return {phanTho:phanTho, ptVat:ptVat};
}

/* ═══ TỔNG BẢNG PHẦN THÔ ═══
   mode: 'item' -> TT = KL × ĐG · 'area' -> KL = DT × HS, TT mục = ΣKL × up · 'area0' / 'none' -> "Chưa bao gồm" (TT = 0)
   Ghi chú: như bản gốc, ptSecTotals GÁN it._kl / it._tt / it._ttnt lên từng dòng. */
export function ptHs_(it){ var v=it&&it.hs; return (v===''||v==null)?1:ptN(v); }
export function ptAutoKL_(it){ return ptN(it&&it.dt)>0; }
export function ptSecTotals(sec){
  var sumKL=0, tt=0, ttnt=0;
  sec.items.forEach(function(it){
    var kl;
    if(sec.mode==='area'||sec.mode==='area0'){ kl=ptR2(ptN(it.dt)*ptHs_(it)); }
    else if(ptAutoKL_(it)){ kl=ptR2(ptN(it.dt)*ptHs_(it)); }    // dòng item: có diện tích -> khối lượng tự tính
    else { kl=ptN(it.kl); }
    it._kl=kl; sumKL+=kl;
    if(sec.mode==='item'){ it._tt=ptR0(kl*ptN(it.dg)); tt+=it._tt; it._ttnt=ptR0(kl*ptN(it.dgnt)); ttnt+=it._ttnt; }
    else { it._tt=null; it._ttnt=null; }
  });
  if(sec.mode==='area'){ tt=ptR0(sumKL*ptN(sec.up)); ttnt=0; }
  else if(sec.mode==='area0'||sec.mode==='none'){ tt=0; ttnt=0; }
  return {sumKL:sumKL,tt:tt,ttnt:ttnt};
}
export function ptComputeAll(phanTho,ptVat){
  var sections=[],grand=0,contractor=0;
  (phanTho||[]).forEach(function(sec){ var s=ptSecTotals(sec); sections.push(s); grand+=s.tt; contractor+=s.ttnt; });
  var profit=grand-contractor;
  var vatPct=ptN(ptVat);
  var vat=ptR0(grand*vatPct/100);
  return {sections:sections,grand:grand,contractor:contractor,profit:profit,
    vatPct:vatPct,vat:vat,afterTax:grand+vat,profitPct:grand?(profit/grand*100):0};
}
/* ═══ CÔNG THỨC GIÁ (sheet "mai coi công thức ở đây" của file báo giá) ═══
   Đơn giá bán O = MROUND(J/(1−M), 1000) (M = %LN trên GIÁ BÁN) · %LN/giá bán M = L/P */
export function ptMround_(v,b){ b=b||1000; return Math.round((Number(v)||0)/b)*b; }
export function ptDgTuLn_(dgnt,lnPct){
  dgnt=ptN(dgnt); var m=ptN(lnPct)/100;
  if(!dgnt) return 0;
  if(m>=1) m=0.99;                       // chặn chia cho 0
  return ptMround_(dgnt/(1-m),1000);
}
export function ptLnTuDg_(dgnt,dg){ dg=ptN(dg); return dg?((dg-ptN(dgnt))/dg*100):0; }
/* Sửa 1 ô của bảng (phần dữ liệu của ptEdit): sửa TẠI CHỖ phanTho; ii<0 = sửa thuộc tính của mục (vd up).
   Trả true nếu đã sửa (người gọi tự lưu projData phanTho/ptVat + vẽ lại). */
export function ptEdit(phanTho,si,ii,f,val){
  var sec=(phanTho||[])[si]; if(!sec) return false;
  var numF={dt:1,hs:1,kl:1,dg:1,dgnt:1,up:1,lnPct:1}, moneyF={dg:1,dgnt:1,up:1};
  var v = moneyF[f]?ptMoneyN_(val):(numF[f]?ptN(val):val);
  if(ii<0){ sec[f]=v; }
  else {
    var it=sec.items[ii]; if(!it) return false;
    it[f]=v;
    // dòng item có DT+HS -> khối lượng bám theo tích 2 ô (bỏ trống 1 ô là trả lại nhập tay)
    if((f==='dt'||f==='hs') && sec.mode==='item'){ if(ptAutoKL_(it)) it.kl=ptR2(ptN(it.dt)*ptHs_(it)); }
    // giữ 3 đại lượng luôn khớp nhau: giá vốn ↔ %LN ↔ giá bán
    if(f==='lnPct')      it.dg=ptDgTuLn_(it.dgnt,v);
    else if(f==='dg')    it.lnPct=ptR2(ptLnTuDg_(it.dgnt,v));
    else if(f==='dgnt'){ if(ptN(it.lnPct)) it.dg=ptDgTuLn_(v,it.lnPct); else it.lnPct=ptR2(ptLnTuDg_(v,it.dg)); }
  }
  return true;
}
// VAT phần thô (ptSetVat): số hợp lệ, không thì 0
export function ptVatIn_(val){ var n=ptN(val); return isFinite(n)?n:0; }

/* ═══ HẰNG SỐ (nguyên văn) ═══ */
// Thư viện khái toán chi tiết (15 nhóm / 156 công tác); PT_SOBO nối sau trong ptTemplateNew_
export const PT_TEMPLATE_GOC=[
  {r:"I",t:"CÔNG TÁC CHUẨN BỊ",loai:'kt_chitiet',mode:'item',items:[
    ["Xin phép xây dựng","gói",1,0,"Phụ thuộc vào quy mô, vị trí xây dựng",0],
    ["Định vị ranh đất","điểm",1,1200000,"Dịch vụ",1200000],
    ["Xin cấp đồng hồ điện","gói",1,10000000,"Dịch vụ",10000000],
    ["Xin cấp đồng hồ nước","gói",1,5000000,"Dịch vụ",5000000],
    ["Tháo dỡ, múc móng nhà cũ, hút hầm phân","gói",1,0,"",0],
    ["Hàng rào tạm","m",1,80000,"Hàng rào tole phẳng",80000],
    ["Cổng công trình","cái",1,3000000,"Cửa cổng sắt ốp tole, xếp trượt",3000000],
    ["Nhà vệ sinh tạm","cái",1,18000000,"Nhà vệ sinh di động + bồn cầu + vòi nước",18000000],
    ["Tủ điện tạm","cái",1,1500000,"Tủ điện, MCB chống giật, ổ cắm",1500000],
    ["Khoan khảo sát địa chất","m",1,350000,"Đất cấp I-II-III, độ sâu hố khoan 30-40m, bao gồm thí nghiệm xuyên tiêu chuẩn SPT Không bao gồm thí nghiệm 9 chỉ tiêu cơ lý đất và thí nghiệm nén 3 trục",350000]
  ]},
  {r:"II",t:"Ép cọc",loai:'kt_chitiet',mode:'item',items:[
    ["Ép cọc BTCT 250x250, m300, tải 70T","m",1,260000,"",260000],
    ["Nhân công ép cọc BTCT tải 70T","m",1,70000,"Đơn giá cho trên 20m/tim cọc (tùy địa chất khu vực)",70000],
    ["Nhân công ép cọc BTCT","tim",1,1200000,"Đơn giá cho dưới 20m/tim cọc (tùy địa chất khu vực)",1200000],
    ["Vận chuyển cọc trong hẻm nhỏ, hoặc hẻm cấm tải","m",1,40000,"Tăng bo, đẩy tay vào công trình (tùy thuộc vào chiều dài tuyến đường)",40000],
    ["Ép cọc ly tâm A300, PHC, tải 100T","m",1,360000,"",360000],
    ["Nhân công ép cọc ly tâm","m",1,80000,"Đơn giá cho trên 20m/tim cọc (tùy địa chất khu vực)",80000],
    ["Nhân công ép cọc ly tâm","tim",1,1300000,"Đơn giá cho dưới 20m/tim cọc (tùy địa chất khu vực)",1300000]
  ]},
  {r:"III",t:"Biện pháp thi công hầm",loai:'kt_chitiet',mode:'item',items:[
    ["Ép cừ C200, cừ dài 4,5m (1 hệ shoring)","m",1,2800000,"Khối lượng tính theo chu vi hầm",2800000],
    ["Đào đất hầm","m3",1,0,"Nằm trong đơn giá thi công thô, không tính riêng",0],
    ["Cọc vây biện pháp D300 (cọc khoan nhồi)","m",1,480000,"Thi công trong trường hợp không ép cừ C, khoan cọc theo chu vi hầm",480000],
    ["Vận chuyển bùn đất đi đổ","m3",1,180000,"Bùn đất trong quá trình khoan cọc nhồi",180000]
  ]},
  {r:"IV",t:"Đơn giá xây dựng thô",loai:'kt_chitiet',mode:'item',items:[
    ["Xây dựng thô","m2",1,3050000,"Nhà phố chiều ngang 4m - 6m, hoàn thiện 2 mặt trước sau, đường trên 3m",3050000],
    ["Xây dựng thô","m2",1,3150000,"Nhà phố chiều ngang 6m - 8m, hoàn thiện 2 mặt trước sau, đường trên 3m",3150000],
    ["Xây dựng thô","m2",1,3200000,"Nhà phố chiều ngang 4m - 6m, hoàn thiện 3 - 4 mặt, đường trên 3m",3200000],
    ["Xây dựng thô","m2",1,3350000,"Nhà phố chiều ngang 6m - 8m, hoàn thiện 3- 4 mặt, đường trên 3m",3350000],
    ["Xây dựng trong hẻm nhỏ","m2",1,450000,"Hẻm nhỏ 2m - 2,5m, vận chuyển bằng xe ba gác hoặc hẻm cấm tải",450000],
    ["Nhân công hoàn thiện","m2",1,450000,"",450000]
  ]},
  {r:"V",t:"Đơn giá MEP âm",loai:'kt_chitiet',mode:'item',items:[
    ["Thi công MEP phần âm","m2",1,450000,"Không bao gồm hệ thống camera, điện lạnh, mạng Lan văn phòng, chống sét, đấu nối hệ thống thoát nước ra cống chung",450000],
    ["Nhân công hoàn thiện MEP","m2",1,200000,"Nhân công lắp đặt thiết bị điện, đèn chiếu sáng, thiết bị nước, thiết bị vệ sinh",200000]
  ]},
  {r:"VI",t:"Hệ số tính diện tích",loai:'kt_chitiet',mode:'area',up:3050000,items:[
    ["Móng đơn + đà kiềng","m2",0,0.3,""],
    ["Móng cọc + giằng móng","m2",0,0.5,""],
    ["Móng băng 1 phương","m2",0,0.5,""],
    ["Móng băng 2 phương","m2",0,0.7,""],
    ["Móng bè","m2",0,1,""],
    ["Hố pit thang máy","m2",0,1,""],
    ["Hầm sâu 1 - 1,3m tính từ vỉa hè","m2",0,1.5,""],
    ["Hầm sâu 1.3m - 1,7m tính từ vỉa hè","m2",0,1.7,""],
    ["Hầm sâu 1.7m - 2m tính từ vỉa hè","m2",0,2,""],
    ["Hầm sâu 2m - 2,5m tính từ vỉa hè","m2",0,2.5,""],
    ["Tầng 1","m2",0,1,""],
    ["Sân trước, sân sau","m2",0,0.5,""],
    ["Sân vườn","m2",0,0.5,""],
    ["Tầng lửng","m2",0,1,"Diện tích không tính ô thông tầng lửng"],
    ["Ô thông tầng lửng","m2",0,0.5,"Tính 0,5 do xung quanh ô thông tầng vẫn phải đổ dầm, xây tường, trát tường"],
    ["Tầng 2 ... (bao gồm ban công)","m2",0,1,""],
    ["Sân thượng có mái che","m2",0,1,""],
    ["Sân thượng không mái che","m2",0,0.5,""],
    ["Mái Tole","m2",0,0.3,"Tính theo diện tích mặt nghiêng"],
    ["Mái BTCT","m2",0,0.5,""],
    ["Mái ngói kèo sắt (hệ xà gồ, ngói lợp)","m2",0,0.7,"Tính theo diện tích mặt nghiêng"],
    ["Mái BTCT dán ngói","m2",0,1,"Tính theo diện tích mặt nghiêng"]
  ]},
  {r:"VII",t:"Xây tường, trát tường",loai:'kt_chitiet',mode:'item',items:[
    ["Tường xây 100mm, tường gạch ống, vữa xây M75","m2",1,310000,"",310000],
    ["Tường xây 200mm, tường gạch ống 5 lớp câu gạch đinh, vữa xây M75","m2",1,590000,"",590000],
    ["Đà lanh tô cửa đi 1 cánh (tường 100)","cái",1,300000,"Đà lanh tô đúc sẵn 1100mm",300000],
    ["Nẹp V góc tường, cạnh tường","md",1,30000,"Nẹp nhựa",30000],
    ["Đóng lưới thép đường điện, giáp mí bê tông - gạch","m",1,22000,"Lưới mắt cáo",22000],
    ["Trát tường ngoài vữa xi măng M75","m2",1,160000,"",160000],
    ["Trát tường trong vữa xi măng M75","m2",1,150000,"",150000],
    ["Trát cạnh tường / má cửa, bề rộng tường 100, vữa xi măng M75","m",1,76000,"",76000],
    ["Trát cạnh tường / má cửa, bề rộng tường 200, vữa xi măng M75","m",1,120000,"",120000]
  ]},
  {r:"VIII",t:"Chống thấm, cán nền",loai:'kt_chitiet',mode:'item',items:[
    ["Cán nền 3-5cm, vữa xi măng M75","m2",1,135000,"",135000],
    ["Chống thấm sàn, tường","m2",1,225000,"Chống thấm SIKA topseal 109 / Kova CT11A quét 2 lớp",225000]
  ]},
  {r:"IX",t:"Ốp lát gạch",loai:'kt_chitiet',mode:'item',items:[
    ["Nhân công lát gạch","m2",1,150000,"Gạch 300x600, 600x600",150000],
    ["Nhân công lát gạch","m2",1,180000,"Gạch 600x1200, 800x800, 900x900",180000],
    ["Nhân công ốp gạch","m2",1,160000,"Gạch 300x600, 600x600",160000],
    ["Nhân công ốp gạch","m2",1,190000,"Gạch 600x1200, 800x800, 900x900",190000],
    ["Keo dán gạch ngoại thất","m2",1,100000,"Webertai gres / Đơn giá vật tư",100000],
    ["Keo dán gạch nội thất","m2",1,70000,"Webertai vis, Webertai fix / Đơn giá vật tư",70000],
    ["Chà ron gạch khổ lớn","m2",1,120000,"Keo ron epoxy 2 thành phần Cetex / Saveto",120000],
    ["Chà ron gạch khổ nhỏ","m2",1,230000,"Keo ron epoxy 2 thành phần Cetex / Saveto",230000]
  ]},
  {r:"X",t:"Thạch cao",loai:'kt_chitiet',mode:'item',items:[
    ["Trần thạch cao khung chìm","m2",1,165000,"Khung xương Vĩnh Tường M29 ,tấm thạch cao Gyproc 9mm",165000],
    ["Trần thạch cao khung chìm chống ẩm","m2",1,175000,"Khung xương Vĩnh Tường M29 ,tấm thạch cao Gyproc 9mm chống ẩm",175000],
    ["Trần thạch cao khung chìm","m2",1,190000,"Khung xương Vĩnh Tường Tika ,tấm thạch cao Gyproc 9mm",190000],
    ["Trần thạch cao khung chìm chống ẩm","m2",1,200000,"Khung xương Vĩnh Tường Tika ,tấm thạch cao Gyproc 9mm chống ẩm",200000],
    ["Trần thạch cao khung chìm","m2",1,230000,"Khung xương Vĩnh Tường Alpha ,tấm thạch cao Gyproc 9mm",230000],
    ["Trần thạch cao khung chìm chống ẩm","m2",1,240000,"Khung xương Vĩnh Tường Alpha ,tấm thạch cao Gyproc 9mm chống ẩm",240000],
    ["Trần thạch cao khung chìm","m2",1,315000,"Khung xương Vĩnh Tường Basi ,tấm thạch cao Gyproc 9mm",315000],
    ["Trần thạch cao khung chìm chống ẩm","m2",1,325000,"Khung xương Vĩnh Tường Basi ,tấm thạch cao Gyproc 9mm chống ẩm",325000],
    ["Thanh shadowline","md",1,75000,"",75000],
    ["Vách thạch cao 1 mặt","m2",1,220000,"Xương U Vĩnh Tường ,tấm thạch cao Gyproc 9mm ốp 1 mặt",220000],
    ["Vách thạch cao 2 mặt","m2",1,320000,"Xương U Vĩnh Tường ,tấm thạch cao Gyproc 9mm ốp 2 mặt",320000],
    ["Vách thạch cao 2 mặt cách âm","m2",1,410000,"Xương U Vĩnh Tường ,tấm thạch cao Gyproc 9mm ốp 2 mặt, bông thủy tinh cách âm, cách nhiệt",410000],
    ["Nắp thăm trần 450x450","cái",1,350000,"Vĩnh Tường",350000],
    ["Nắp thăm trần 600x600","cái",1,450000,"Vĩnh Tường",450000]
  ]},
  {r:"XI",t:"Sơn nước",loai:'kt_chitiet',mode:'item',items:[
    ["Bả matit ngoại thất, bả 2 lớp","m2",1,50000,"Dulux / Jotun ngoại thất",50000],
    ["Bả matit nội thất, bả 2 lớp","m2",1,40000,"Dulux / Jotun nội thất",40000],
    ["Sơn ngoại thất, 1 lớp lót 2 lớp phủ","m2",1,90000,"Dulux weathershield / Jotun Jotashield",90000],
    ["Sơn nội thất, 1 lớp lót 2 lớp phủ","m2",1,80000,"Dulux easyclean / Jotun essence",80000],
    ["Sơn hiệu ứng","m2",1,350000,"Pukaco / Conpa",350000],
    ["Sơn giả đá","m2",1,500000,"Kova / Hòa Bình",500000]
  ]},
  {r:"XII",t:"Đá",loai:'kt_chitiet',mode:'item',items:[
    ["Đá nung kết 12mm","m2",1,4000000,"Vasta khổ lớn chuẩn Châu Âu",4000000],
    ["Đá nung kết 9mm","m2",1,1600000,"Vasta",1600000],
    ["Đá granite 16mm -20mm","m2",1,1700000,"Đen kim sa / đen Ấn Độ",1700000],
    ["Đá marble trắng Ý","m2",1,0,"",0],
    ["Đá marble đen tia chớp","m2",1,0,"",0],
    ["Đá marble Cream Marfil","m2",1,0,"",0],
    ["Đá marble Emperador","m2",1,0,"",0],
    ["Đá xuyên sáng Onyx","m2",1,0,"Bán theo tấm - tùy nhà cung cấp",0],
    ["Đá Vicostone 20mm","m2",1,3250000,"Vicostone nhóm P",3250000],
    ["Đá Vicostone 20mm","m2",1,4800000,"Vicostone nhóm A",4800000],
    ["Đá Vicostone 20mm","m2",1,6000000,"Vicostone nhóm B",6000000],
    ["Đá Vicostone 20mm","m2",1,7700000,"Vicostone nhóm C",7700000],
    ["Đá Vicostone 20mm","m2",1,9400000,"Vicostone nhóm D",9400000],
    ["Đá Vicostone 20mm","m2",1,11100000,"Vicostone nhóm E",11100000],
    ["Đá ngạch cửa rộng 100","m2",1,350000,"Đen kim sa / đen Ấn Độ",350000],
    ["Đá ngạch cửa rộng 200","m2",1,500000,"Đen kim sa / đen Ấn Độ",500000]
  ]},
  {r:"XIII",t:"Sàn gỗ",loai:'kt_chitiet',mode:'item',items:[
    ["Sàn gỗ công nghiệp 8mm","m2",1,395000,"An Cường, cốt gỗ HDF, lớp foam 3mm",395000],
    ["Sàn gỗ công nghiệp 12mm lát thẳng","m2",1,475000,"An Cường, cốt gỗ HDF, lớp foam 3mm",475000],
    ["Sàn gỗ công nghiệp 12mm xương cá","m2",1,505000,"An Cường, cốt gỗ HDF, lớp foam 3mm",505000],
    ["Sàn gỗ kỹ thuật 15mm","m2",1,1100000,"Bề mặt gỗ tự nhiên, lớp lõi Plywood/HDF",1100000],
    ["Sàn gỗ tự nhiên 15mm","m2",1,1255000,"Gỗ sồi",1255000],
    ["Sàn gỗ tự nhiên 15mm","m2",1,1505000,"Walnut",1505000],
    ["Sàn gỗ biến tính 26mm","m2",1,2430000,"Themor thông, bao gồm khung xương sắt",2430000],
    ["Sàn gỗ biến tính 20mm","m2",1,3230000,"Themor tần bì, bao gồm khung xương sắt",3230000],
    ["Len gỗ tự nhiên","m",1,250000,"",250000],
    ["Len nhựa","m",1,75000,"",75000],
    ["Nẹp nhôm kết thúc","m",1,80000,"",80000]
  ]},
  {r:"XIV",t:"Nhôm, kính, sắt",loai:'kt_chitiet',mode:'item',items:[
    ["Xingfa Việt Nam","",1,0,"",0],
    ["Cửa đi / cửa sổ mở quay","m2",1,2100000,"Nhôm Xingfa Việt Nam hệ 55 dày1.4ly, kính trắng 08mm cường lực, phụ kiện Kinlong loại 1",2100000],
    ["Cửa đi / cửa sổ lùa","m2",1,1900000,"Nhôm Xingfa Việt Nam hệ 55 dày 1.4ly, kính trắng 08mm cường lực, phụ kiện Kinlong loại 1",1900000],
    ["Cửa sổ bật","m2",1,1950000,"Nhôm Xingfa Việt Nam hệ 55 dày 1.4ly, kính trắng 08mm cường lực, phụ kiện Kinlong loại 1",1950000],
    ["Vách kính cố định","m2",1,1200000,"Nhôm Xingfa Việt Nam hệ 55 dày 1.4ly, kính trắng 08mm cường lực",1200000],
    ["Xingfa Quảng Đông hệ 55","",1,0,"",0],
    ["Cửa đi / cửa sổ mở quay","m2",1,2600000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2,0ly, kính trắng 10mm cường lực, phụ kiện Kinlong chính hãng",2600000],
    ["Cửa đi / cửa sổ lùa","m2",1,2400000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2.0ly, kính trắng 10mm cường lực, phụ kiện Kinlong chính hãng",2400000],
    ["Cửa sổ bật","m2",1,2500000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2,0ly, kính trắng 10mm cường lực, phụ kiện Kinlong chính hãng",2500000],
    ["Vách kính cố định","m2",1,1500000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 1.4ly, kính trắng 10mm cường lực",1500000],
    ["Xingfa Quảng Đông hệ 93","",1,0,"",0],
    ["Cửa đi / cửa sổ mở quay","m2",1,2800000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2,0ly, kính trắng 10mm cường lực, phụ kiện Kinlong chính hãng",2800000],
    ["Cửa đi / cửa sổ lùa","m2",1,2600000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2.0ly, kính trắng 10mm cường lực, phụ kiện Kinlong chính hãng",2600000],
    ["Cửa sổ bật","m2",1,2700000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2,0ly, kính trắng 10mm cường lực, phụ kiện Kinlong chính hãng",2700000],
    ["Vách kính cố định","m2",1,1700000,"Nhôm Xingfa Việt Nam Quảng Đông hệ 55 dày 2,0ly, kính trắng 10mm cường lực",1700000],
    ["Vách kính tắm","",1,0,"",0],
    ["Vách kính WC","m2",1,800000,"Kính trắng 10mm cường lực, vách kính thẳng",800000],
    ["Vách kính WC","m2",1,1200000,"Kính màu 10mm cường lực, vách kính thẳng",1200000],
    ["Vách kính WC","m2",1,1800000,"Kính sọc 10mm cường lực, vách kính thẳng",1800000],
    ["Bộ phụ kiện vách kính tắm (bản lề, tay nắm, kẹp kính)","bộ",1,2400000,"VVP chính hãng",2400000],
    ["Bộ phụ kiện vách kính tắm (bản lề, tay nắm, kẹp kính)","bộ",1,3800000,"Hafele chính hãng",3800000],
    ["Bộ phụ kiện cửa kính (bản lề sàn 150kg, kẹp kính, khóa sàn)","bộ",1,3900000,"VVP chính hãng",3900000],
    ["Bộ phụ kiện cửa kính (bản lề sàn 150kg, kẹp kính, khóa sàn)","bộ",1,5500000,"Hafele chính hãng",5500000],
    ["Lan can cầu thang / ban công","",1,0,"",0],
    ["Lan can kính bắt hông (cầu thang)","m",1,850000,"Kính trắng 10mm cường lực, vách kính thẳng, không tay vịn",850000],
    ["Lan can kính bắt hông (cầu thang)","m",1,1300000,"Kính dán an toàn 2 lớp 10,38mm, vách kính thẳng, không tay vịn",1300000],
    ["Lan can kính âm (chôn ray U)","m",1,1200000,"Kính màu 10mm cường lực, vách kính thẳng, không tay vịn",1200000],
    ["Lan can kính âm (chôn ray U)","m",1,1750000,"Kính dán an toàn 2 lớp 10,38mm, vách kính thẳng, không tay vịn",1750000],
    ["Lan can sắt đơn giản","m",1,1200000,"Cây đứng sắt hộp / sắt la, tay vịn sắt sắt hộp / sắt la, sơn 2 thành phần",1200000],
    ["Lan can sắt cổ điển","m",1,0,"Tùy theo thiết kế",0],
    ["Tay vịn gỗ sơn Pu","m",1,550000,"Gỗ thông / gỗ sồi",550000],
    ["Tay vịn nhôm vuông 20x20","m",1,380000,"",380000]
  ]},
  {r:"XV",t:"Cửa cuốn",loai:'kt_chitiet',mode:'item',items:[
    ["Cửa cuốn trượt trần overhead","m2",1,4300000,"Austdoor",4300000],
    ["Cửa cuốn khe thoáng","m2",1,2550000,"Austdoor S7",2550000],
    ["Cửa cuốn khe thoáng","m2",1,1980000,"Mitadoor X50R",1980000],
    ["Motor cửa cuốn 300kg","cái",1,9200000,"Austdoor AH300A",9200000],
    ["Motor cửa cuốn 300kg","cái",1,5500000,"YH Đài Loan",5500000],
    ["Bình lưu điện","cái",1,4375000,"Austdoor E1000",4375000],
    ["Bình lưu điện","cái",1,4000000,"YH Power Y1000",4000000]
  ]}
];
export const PT_MAU=[{
  id:'bg_building_2026',
  ten:'Tòa nhà văn phòng 981m² — 1 bán hầm, 5 tầng, sân thượng, mái',
  mo:'Metropole Thủ Thiêm · đất trống, xây mới · phong cách hiện đại',
  tong:8881778400
}];
export const PT_SOBO=[
  {r:"I",t:"CÔNG TÁC CHUẨN BỊ",loai:'kt_sobo',mode:'none',note:'Nhóm này thường do chủ đầu tư tự làm — báo giá mẫu để "chưa bao gồm"',items:[
    ["Xin phép xây dựng","gói","Chưa bao gồm"],
    ["Đập phá, tháo dỡ nhà hiện trạng","gói","Chưa bao gồm"],
    ["Khoan khảo sát địa chất","gói","Chưa bao gồm"],
    ["Cắm mốc định vị ranh xây dựng","gói","Chưa bao gồm"],
    ["Xin cấp đồng hồ điện, nước","gói","Chưa bao gồm"]
  ]},
  {r:"II",t:"CÔNG TÁC ÉP CỌC",loai:'kt_sobo',mode:'item',items:[
    ["Giàn tải, máy ép cọc Pmax 90T","gói",1,28000000,"Huy động, dựng và tháo giàn ép",28000000],
    ["Nhân công ép cọc PHC D300 lực ép P(max) 90 tấn","tim",56,2250000,"Số tim cọc tạm tính",2250000],
    ["Cọc ly tâm D300 PHC lực ép P(max) 90 tấn","md",1120,414000,"56 tim × 20m/tim — số tim, số m tạm tính",414000]
  ]},
  {r:"III",t:"BIỆN PHÁP THI CÔNG HẦM",loai:'kt_sobo',mode:'item',items:[
    ["Ép cừ C200 chu vi hầm, cừ C dài 4,5m","md",62,4436000,"Khối lượng theo chu vi hầm",4436000],
    ["Hệ Shoring","hệ",1,30000000,"",30000000],
    ["Đào đất, vận chuyển đi đổ","m3",388.65,185000,"",185000]
  ]},
  {r:"IV",t:"THI CÔNG XÂY THÔ",loai:'kt_sobo',mode:'area',up:4200000,
   note:'Không bao gồm nhân công hoàn thiện, MEP âm tường, bể PCCC. Đơn giá tính trên khối lượng quy đổi (diện tích × hệ số)',items:[
    ["Móng (diện tích bao ngoài toàn bộ móng, dầm móng)","m2",278.00,0.5,""],
    ["Hầm + ram dốc","m2",178.56,1.7,""],
    ["Tầng 1","m2",156.00,1.0,""],
    ["Sân vườn ngoài trời","m2",104.39,0.5,""],
    ["Tầng 2-4 (bao gồm ban công)","m2",178.78,3.0,"Hệ số 3 = 3 tầng giống nhau"],
    ["Tầng 5 (bao gồm ban công)","m2",185.92,1.0,""],
    ["Tầng thượng có mái che","m2",50.63,1.0,""],
    ["Tầng thượng không mái che","m2",82.37,0.5,""],
    ["Mái bê tông cốt thép","m2",50.63,0.5,""],
    ["Tum thang máy","m2",5.17,0.5,""]
  ]},
  {r:"V",t:"HỆ THỐNG MEP (điện · cấp thoát nước · data)",loai:'kt_sobo',mode:'area',up:750000,
   note:'Không bao gồm nhân công lắp đặt và thiết bị đầu cuối',items:[
    ["Hầm","m2",178.56,1.0,""],
    ["Tầng 1 (bao gồm diện tích sân vườn)","m2",260.39,1.0,""],
    ["Tầng 2-4","m2",178.78,3.0,""],
    ["Tầng 5","m2",185.92,1.0,""],
    ["Sân thượng","m2",133.00,1.0,""],
    ["Mái","m2",50.63,0.5,""]
  ]},
  {r:"VI",t:"CHỐNG THẤM",loai:'kt_sobo',mode:'area0',note:'Chưa bao gồm trong báo giá mẫu — có khối lượng để chốt đơn giá sau',items:[
    ["Hầm (sàn + vách hầm + hố pit)","m2",250.01,1.0,"Chưa bao gồm"],
    ["Nhà vệ sinh","m2",83.97,1.0,"Chưa bao gồm"],
    ["Ban công tầng 2-5","m2",195.67,1.0,"Chưa bao gồm"],
    ["Sân thượng ngoài trời","m2",121.85,1.0,"Chưa bao gồm"],
    ["Mái","m2",70.75,1.0,"Chưa bao gồm"]
  ]},
  {r:"VII",t:"HỆ THỐNG PCCC",loai:'kt_sobo',mode:'none',note:'Chưa bao gồm — báo giá riêng theo hồ sơ thẩm duyệt PCCC',items:[
    ["Bể chứa nước PCCC theo quy định","gói","Chưa bao gồm"],
    ["Hệ thống báo cháy","gói","Chưa bao gồm"],
    ["Hệ thống chữa cháy","gói","Chưa bao gồm"],
    ["Hệ thống thoát hiểm và hỗ trợ","gói","Chưa bao gồm"]
  ]},
  {r:"VIII",t:"CHI PHÍ KHÁC",loai:'kt_sobo',mode:'item',items:[
    ["Dọn dẹp mặt bằng","gói",1,30000000,"Phát quang cây cỏ, thu gom xà bần, rác thải hiện trạng, san đất tạo mặt bằng",30000000],
    ["Phun thuốc chống mối","gói",1,63690000,"Cho tầng hầm và tầng 1",63690000],
    ["Bao che công trình (giàn giáo, lưới, bạt…)","gói",1,140000000,"",140000000],
    ["Hàng rào bao quanh công trình, cổng công trình","gói",1,75000000,"",75000000],
    ["Camera quan sát công trình","cái",3,1200000,"",1200000],
    ["Mạng internet trong quá trình thi công","tháng",6,350000,"",350000],
    ["Nhà vệ sinh di động","cái",1,20000000,"",20000000],
    ["Thùng rác","cái",1,900000,"",900000],
    ["Thiết bị PCCC (bình chữa cháy 4kg)","cái",8,600000,"",600000],
    ["Vệ sinh công trình hằng ngày (xây dựng thô)","gói",1,45000000,"",45000000],
    ["Vận chuyển xà bần, rác thải trong quá trình thi công","tháng",6,7500000,"",7500000],
    ["Văn phòng tạm tại công trình trong quá trình thi công","tháng",6,8000000,"",8000000],
    ["Công tác an toàn lao động","gói",1,28000000,"Nội quy, biển báo, đồ bảo hộ, lan can chắn, lưới hứng các khu vực mép sàn",28000000],
    ["Chi phí thẩm tra biện pháp thi công hầm","gói",1,20000000,"Theo quy định",20000000],
    ["Chi phí thanh tra xây dựng kiểm tra trong quá trình thi công phần thô","gói",5,5000000,"",5000000],
    ["Chi phí trắc đạc","tầng",8,7000000,"",7000000],
    ["Chi phí điện nước thi công 6 tháng (phần thô)","gói",6,3500000,"",3500000],
    ["Chi phí thang vận","gói",1,0,"Chưa bao gồm",0],
    ["Đấu nối hệ thống thoát nước thải vào cống chung","gói",1,0,"Chưa bao gồm",0]
  ]}
];
export const PT_ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI'];
export const PT_LOAI=[
  ['kt_chitiet','Khái toán chi tiết','Khái toán','Chọn nhà thầu → ra báo giá theo m2 / md / cái'],
  ['kt_sobo',   'Khái toán sơ bộ',   'Khái toán','Chọn nhà thầu → chọn dự án mẫu → ra đơn giá trọn gói'],
  ['dt_nhancong','Dự toán · Nhân công','Dự toán','Nhập số liệu đầu vào → tính khối lượng → nhân công và ca máy theo định mức'],
  ['dt_vattu',   'Dự toán · Vật tư',  'Dự toán','Nhập số liệu đầu vào → khối lượng vật tư × đơn giá nhà cung cấp']
];
export const DT_BO=[{
  id:'ep_coc_d300',
  ten:'Ép cọc ly tâm PHC/PC D300 — máy ép robot 860T',
  nguon:'Định mức 12/2021/TT-BXD · mã AC.26300 / AC.29400 / AC.21500',
  dinhMuc:'100m',
  ghiChu:'Định mức đóng/ép tính cho đoạn cọc ngập đất; đoạn không ngập đất × 0,75 · ép cọc xiên × 1,22. '
        +'Chưa gồm: đào phá đầu cọc, thí nghiệm nén tĩnh/PDA, vận chuyển cọc ngoài phạm vi.',
  inputs:[
    ['dk',   'Đường kính cọc',            'mm',    300,     0],
    ['sl',   'Số lượng cọc',              'cây',   56,      0],
    ['dai',  'Chiều dài mỗi cọc',         'm',     18,      0],
    ['doan', 'Số đoạn cọc / 1 cọc',       'đoạn',  2,       0],
    ['dgcoc','Đơn giá cọc (nguyên cây)',  'đ/cọc', 4050000, 1],
    ['khoan','Chiều dài khoan dẫn',       'm',     0,       0]
  ],
  // [nhãn, công thức (chữ), hàm tính, đvt]
  kl:[
    ['Tổng chiều dài cọc ép',        'Số cọc × Chiều dài mỗi cọc',    function(v){ return v.sl*v.dai; },        'm'],
    ['Tổng số đoạn cọc',             'Số cọc × Số đoạn/cọc',          function(v){ return v.sl*v.doan; },       'đoạn'],
    ['Số mối nối cọc (hàn)',         'Số cọc × (Số đoạn/cọc − 1)',    function(v){ return v.sl*(v.doan-1); },   'mối nối'],
    ['Khối lượng ép cọc theo định mức','Tổng chiều dài ÷ 100',        function(v){ return v.sl*v.dai/100; },    '100m'],
    ['Chi phí vật liệu cọc',         'Số cọc × Đơn giá cọc',          function(v){ return v.sl*v.dgcoc; },      'đồng']
  ],
  // NHÂN CÔNG & MÁY: hao phí cho 1 đơn vị định mức (100m) × khối lượng định mức
  hp:[
    ['AC.26300','Nhân công ép cọc (bậc 3,5/7)',                'công', 5.5,  350000,  'Hao phí 5,5 công/100m'],
    ['AC.26300','Máy ép cọc robot thủy lực tự hành 860T',      'ca',   0.97, 9000000, 'Hao phí 0,97 ca/100m'],
    ['AC.26300','Cần cẩu 50T (phục vụ cẩu, dựng cọc)',         'ca',   0.24, 4500000, 'Hao phí 0,24 ca/100m']
  ],
  // CÔNG TÁC khác tính theo khối lượng riêng (đơn giá tự nhập theo hợp đồng)
  ct:[
    ['AC.29400','Nối cọc ống BTCT (hàn nối các đoạn cọc)','mối nối', function(v){ return v.sl*(v.doan-1); }, 0, 'Chỉ tính khi cọc > 1 đoạn — đơn giá theo báo giá nhà thầu'],
    ['AC.21500','Khoan dẫn phục vụ ép cọc (máy khoan xoay)','m',     function(v){ return v.khoan; },         0, 'Chỉ khi thiết kế/biện pháp thi công yêu cầu khoan dẫn']
  ],
  // VẬT TƯ: đơn giá quy về đơn vị đo
  vt:[
    ['Cọc bê tông ly tâm PHC/PC D300 (thân cọc, chưa gồm mũ + đệm đầu cọc)','m',
      function(v){ return v.sl*v.dai; },
      function(v){ return v.dai?(v.dgcoc/v.dai):0; },
      'Giá cọc theo báo giá nhà cung cấp thực tế']
  ]
}];
/* Dezon = nhà thầu mặc định (đơn giá của công ty): công tác không ghi nhà thầu tính là của Dezon */
export const PT_NCC_MAC_DINH='Dezon';
export const PT_CONTRACTORS=['Dezon','H77','Decox','TTP','Unicons'];

/* ===== Thứ tự + nhà thầu của công tác CSDL (roadmap M5.2, M5.3 - không có trong bản gốc) ===== */
/* Sắp công tác như máy chủ (ctList: loai, thu_tu, ngay_tao) nhưng làm lại ở máy: sửa Thứ tự xong (cache chỉ thay 1 dòng)
   thư viện đổi chỗ ngay mà không cần tải lại. Cùng loại + thứ tự thì giữ thứ tự máy chủ trả. Nhóm của thư viện đứng theo
   công tác đầu tiên của nó trong cùng loại. */
export function ctSortThuTu_(congTac){
  var lo=function(c){ return String(c.loai||''); };
  return (congTac||[]).map(function(c,i){ return [c,i]; })
    .sort(function(x,y){
      var a=lo(x[0]), b=lo(y[0]);
      if(a!==b) return a<b?-1:1;
      return ((Number(x[0].thuTu)||0)-(Number(y[0].thuTu)||0)) || (x[1]-y[1]);
    })
    .map(function(x){ return x[0]; });
}
/* Ô Thứ tự: '' = không đổi / không đặt; còn lại phải là số nguyên không âm (ràng buộc cột sort_order). Trả '' | số | null (sai) */
export function ctThuTuIn_(v){
  var t=String(v==null?'':v).trim();
  if(t==='') return '';
  return /^[0-9]+$/.test(t) && Number(t)<=2147483647 ? Number(t) : null;
}
/* Khoá so khớp nhà thầu: cắt khoảng trắng, không phân biệt hoa thường */
export function ptNccKey_(v){ return String(v==null?'':v).trim().toLowerCase(); }
/* Danh sách nhà thầu của ô "Tên nhà thầu" = ncc khác rỗng của công tác công ty ∪ PT_CONTRACTORS (tên của Dezon, giữ như bản gốc).
   Trả [{ten, n}] - n = số công tác của nhà thầu đó trong loại báo giá loai (bỏ trống loai = mọi loại). PT_CONTRACTORS đứng đầu theo
   thứ tự cũ, nhà thầu khác xếp theo tên; trùng (không phân biệt hoa thường) thì giữ cách viết gặp trước. */
export function ptNccList_(congTac,loai){
  var by={}, out=[], them=[];
  PT_CONTRACTORS.forEach(function(t){ var k=ptNccKey_(t); if(!by[k]){ by[k]={ten:t,n:0}; out.push(by[k]); } });
  (congTac||[]).forEach(function(c){
    var t=String(c.ncc||'').trim(), k=ptNccKey_(t); if(!k) return;
    if(!by[k]){ by[k]={ten:t,n:0}; them.push(by[k]); }
    if(!loai || ptLoaiGop_(c.loai)===ptLoaiGop_(loai)) by[k].n++;
  });
  them.sort(function(a,b){ return a.ten.localeCompare(b.ten,'vi'); });
  return out.concat(them);
}
/* Các dòng của 1 nhóm thư viện hiện với nhà thầu đang chọn: [{a, ii}] giữ chỉ số gốc ii (panel chi tiết dùng {si, ii}).
   Không chọn nhà thầu = mọi dòng; có chọn = chỉ công tác CSDL có ncc trùng (dòng dựng sẵn không có nhà thầu nên bị ẩn). */
export function ptSecItemsNcc_(sec,ncc){
  var k=ptNccKey_(ncc);
  return (sec.items||[]).map(function(a,ii){ return {a:a,ii:ii}; }).filter(function(x){
    if(!k) return true;
    var c=ctOf_(x.a);
    if(k===ptNccKey_(PT_NCC_MAC_DINH)) return !c || !ptNccKey_(c.ncc) || ptNccKey_(c.ncc)===k;   // Dezon: cả dòng không ghi nhà thầu
    return !!c && ptNccKey_(c.ncc)===k;
  });
}
