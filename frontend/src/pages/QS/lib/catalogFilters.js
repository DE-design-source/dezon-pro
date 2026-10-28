/* Bộ lọc danh mục sản phẩm (panel trái tab Bóc tách) - port nguyên văn PUB/app.js. Không đọc spec ở cấp module.
   st = trạng thái lọc, đúng tên trường S của bản gốc:
     { products, lines, projects, node, fNhomSet, fVs, fWatt, fKelvin, fAngle, fIP, fCRI, fVolt, fBrand, fFav, fCombo,
       demucKw, inProjKeys (S._inProjKeys), inProjMa (S._inProjMa), onlyProject,
       q (ô #catQ), min, max (chuỗi ô #fMin / #fMax) }
   specs = {VS_SPEC, SON_SPEC, CT_SPEC, DL_SPEC}.
   Nguồn: WATTS/KELVINS/ANGLES 288-290 · parseWatt..ctColor 464-473 · chipGroup (giá trị) 476-484 · prodNhom_..hmucOptions 525-532
   VS_FLT_NODE..vsFltMatch_ 541-562 · renderVsFilters_ (mô hình) 572-614 · renderFilters (thương hiệu) 621-623 · comboChips_ / favChips_ 645-664
   spVarKey_ / spNum1_ / spGroupVariants_ 666-683 · filteredProducts 693-728 · pickInProj (khoá) 775 · setDemucFilter 787-788
   activeFilterCount 822-831 · catActiveChips_ (thẻ) 841-868 · activeFiltCount_ 886-898 · FLT_REG / vsFltSecs_ / FLT_DEN / FLT_CHUNG /
   fltSecs_ / fltDefShow_ / fltShowMap_ / fltHien_ 913-946 · fltActiveN_ 965-971 · catVarGroups_ / spTenDay_ / catVarLbl_ 2633-2663 */
import { money, spNorm_ } from './format.js'
import { nodeName } from './tree.js'
import { nganhCuaSP_, coSpec_, specNganh_ } from './productFields.js'

export const WATTS=['3W','5W','7W','9W','11W','12W','15W','17W','20W','25W'];
export const KELVINS=[['2700K','#f0a500'],['3000K','#f08a00'],['4000K','#f2c200'],['5000K','#3b82f6']];
export const ANGLES=['8°','12°','20°','22°','30°','38°','40°','50°','60°','12x60°','40x70°','30x60°','20x60°','35x70°','50x70°','50x80°','30x70°','50° Asymmetrical','10x30°'];

export function parseWatt(nm){ var m=/(\d+(?:\.\d+)?)\s*w\b/i.exec(nm||''); return m?m[1]+'W':''; }
export function parseKelvin(nm){ var m=/(\d{4})\s*k\b/i.exec(nm||''); return m?m[1]+'K':''; }
// tách chuỗi "3000K, 4000K" -> ['3000K','4000K']
export function splitVals(s){ return String(s||'').split(',').map(function(x){return x.trim();}).filter(Boolean); }
// gom các giá trị THẬT (không trùng) của 1 cột spec trên toàn bộ sản phẩm
export function distinctSpec(products, field){ var set={}; (products||[]).forEach(function(p){ splitVals(p[field]).forEach(function(v){ set[v]=1; }); }); return Object.keys(set); }
// sắp theo số trong chuỗi (7W<12W, IP20<IP44, 220V<240V)
export function cmpNum(a,b){ var na=parseFloat(String(a).replace(/[^0-9.]/g,''))||0, nb=parseFloat(String(b).replace(/[^0-9.]/g,''))||0; return na-nb; }
// màu chấm theo nhiệt độ màu
export function ctColor(k){ var n=parseInt(k,10)||0; if(n<=2700)return '#f0a500'; if(n<=3000)return '#f08a00'; if(n<=4000)return '#f2c200'; if(n<=5000)return '#dbe6f0'; return '#3b82f6'; }
/* Giá trị chip của 1 nhóm lọc đèn (chipGroup): bỏ giá trị rỗng kiểu "0K" / "0W", xếp theo số; badge trên tiêu đề */
export function chipGroupVals_(products, field, stateMap){
  var all=distinctSpec(products, field).filter(function(v){ return !/^0+([.,]0+)?\s*[a-z°]*$/i.test(String(v).trim()); }).sort(cmpNum);
  var selN=all.filter(function(v){return (stateMap||{})[v];}).length;
  return {all:all, selN:selN, badge: selN ? ('· '+selN+' đã chọn') : (all.length ? ('· '+all.length) : '')};
}
// Nhóm của SP: dùng field Nhóm, nếu rỗng thì lấy "Danh mục: X" trong mô tả
export function prodNhom_(p){ if(p&&p.nhom) return p.nhom; var m=/Danh m[uụ]c\s*[:：]\s*([^\n]+)/i.exec((p&&p.moTa)||''); return m?m[1].trim():''; }
export function nhomOptions(products){ var s={}; (products||[]).forEach(function(p){ var n=prodNhom_(p); if(n) s[n]=(s[n]||0)+1; }); return s; }
// Hạng mục SP (cột "Hạng mục"); vệ sinh / sơn / công tắc: chuẩn hoá tên theo spec
export function prodHmuc_(p, specs){ var h=(p&&p.hangMuc)||'';
  var ng=nganhCuaSP_(p, specs);
  var SP=coSpec_(ng)&&specNganh_(ng, specs);
  return (h && SP && SP.chuanHM(h)) || h; }
export function hmucOptions(products, node, specs){ var s={}, ngF=vsFltNganh_(node);   // đề mục có spec riêng: chỉ liệt kê hạng mục của ngành đó
  (products||[]).forEach(function(p){ if(ngF&&nganhCuaSP_(p, specs)!==ngF) return; var n=prodHmuc_(p, specs); if(n) s[n]=(s[n]||0)+1; }); return s; }

/* Đề mục có bộ thông số riêng: 3.2.5 vệ sinh · 3.2.2 sơn nước · 3.2.6.2 công tắc - ổ cắm · 3.2.7 điện lạnh */
export const VS_FLT_NODE={'3.2.5':'vs','3.2.2':'son','3.2.6.2':'ct','3.2.7':'dl'};
export function vsFltNganh_(node){ return VS_FLT_NODE[node]||''; }
export function vsFltOn_(node){ return !!vsFltNganh_(node); }
export function vsFltSpec_(node, specs){ return specNganh_(vsFltNganh_(node)||'vs', specs); }
function selKeys_(m){ return Object.keys(m||{}).filter(function(k){ return m[k]; }); }
// hạng mục đang lọc (chỉ khi chọn đúng 1)
export function vsFltHM_(fNhomSet, node, specs){
  var sel=selKeys_(fNhomSet), SP=vsFltSpec_(node, specs);
  return (sel.length===1&&SP)?SP.chuanHM(sel[0]):'';
}
export function vsFltKeys_(fNhomSet, node, specs){
  var SP=vsFltSpec_(node, specs), hm=vsFltHM_(fNhomSet, node, specs);
  if(!hm) return (vsFltNganh_(node)==='son')?['BỀ MẶT HOÀN THIỆN','KÍCH THƯỚC']:((vsFltNganh_(node)==='ct')?['LOẠI CẤU KIỆN','MÀU SẮC','KIỂU LẮP ĐẶT']:((vsFltNganh_(node)==='dl')?['LOẠI MÁY','CHẾ ĐỘ VẬN HÀNH','CÔNG NGHỆ MÁY NÉN','MÔI CHẤT LẠNH (GAS)']:['MÀU SẮC','KIỂU LẮP ĐẶT']));
  return SP.labelsOf(hm).filter(function(lb){ return SP.METRIC[lb][2]==='sel'; });
}
export function vsProds_(products, node, specs){ var ng=vsFltNganh_(node)||'vs'; return (products||[]).filter(function(p){ return nganhCuaSP_(p, specs)===ng; }); }
export function vsFltCount_(fVs){ var n=0, f=fVs||{}; Object.keys(f).forEach(function(c){ if(Object.keys(f[c]).some(function(v){ return f[c][v]; })) n++; }); return n; }
export function vsFltMatch_(p, fVs){
  var f=fVs||{};
  return Object.keys(f).every(function(col){
    var want=Object.keys(f[col]).filter(function(v){ return f[col][v]; }); if(!want.length) return true;
    return splitVals((p.raw||{})[col]).some(function(v){ return want.indexOf(v)>=0; });
  });
}
/* Mô hình khối lọc theo ngành (phần tính của renderVsFilters_). Trả null khi đề mục không có spec.
   Spec ngành chưa tải / tải lỗi -> {fVs (giữ nguyên), sections:[], note:false, noSpec:true}: người gọi hiện "Không tải được thông số ngành".
   fVs trả về = fVs đã bỏ lọc của thông số không còn áp dụng (bản gốc xoá tại chỗ S.fVs) -> người gọi ghi lại.
   sections: [{key, title, chips:[{c, v, n, on}], selN}] - key 'hm' cho Hạng mục, còn lại là cột DB (fltHien_('vs_'+key)). */
export function vsFilterModel_(st, specs){
  if(!vsFltOn_(st.node)) return null;
  var fVs=Object.assign({}, st.fVs||{}), fNhomSet=st.fNhomSet||{};
  var SPEC=vsFltSpec_(st.node, specs);
  if(!SPEC) return {fVs:fVs, sections:[], note:false, noSpec:true};
  var keys=vsFltKeys_(fNhomSet, st.node, specs), cols=keys.map(function(lb){ return SPEC.METRIC[lb][0]; });
  Object.keys(fVs).forEach(function(c){ if(cols.indexOf(c)<0) delete fVs[c]; });
  var ps=vsProds_(st.products, st.node, specs), hmSel=selKeys_(fNhomSet);
  var trongHM=hmSel.length?ps.filter(function(p){ return hmSel.indexOf(prodHmuc_(p, specs))>=0; }):ps;
  // Hạng mục: đếm theo dữ liệu, xếp theo thứ tự khai báo
  var demHM={}; ps.forEach(function(p){ var h=prodHmuc_(p, specs); if(h) demHM[h]=(demHM[h]||0)+1; });
  var hmList=SPEC.HANG_MUC.filter(function(h){ return demHM[h]; })
    .concat(Object.keys(demHM).filter(function(h){ return SPEC.HANG_MUC.indexOf(h)<0; }));
  var sections=[{key:'hm', title:'Hạng mục', chips:hmList.map(function(h){ return {c:'__hm', v:h, n:demHM[h], on:!!fNhomSet[h]}; }), selN:hmSel.length}];
  var hmCur=vsFltHM_(fNhomSet, st.node, specs);
  keys.forEach(function(lb){
    var col=SPEC.METRIC[lb][0], dem={};
    trongHM.forEach(function(p){ splitVals((p.raw||{})[col]).forEach(function(v){ dem[v]=(dem[v]||0)+1; }); });
    var thuTu=SPEC.optsOf(hmCur,lb);
    var vals=Object.keys(dem).sort(function(a,b){ var ia=thuTu.indexOf(a), ib=thuTu.indexOf(b);
      return ((ia<0?999:ia)-(ib<0?999:ib)) || a.localeCompare(b,'vi'); });
    if(!vals.length) return;                                    // thông số chưa có dữ liệu -> không hiện khối rỗng
    var o=fVs[col]||{};
    sections.push({key:col, title:SPEC.METRIC[lb][1], chips:vals.map(function(v){ return {c:col, v:v, n:dem[v], on:!!o[v]}; }),
      selN:Object.keys(o).filter(function(v){ return o[v]; }).length});
  });
  return {fVs:fVs, sections:sections, note:!hmCur};
}
// Bấm 1 chip lọc theo ngành (vsFltPick_): trả {fNhomSet, fVs} mới
export function vsFltPick_(st, col, v){
  var fNhomSet=Object.assign({}, st.fNhomSet||{}), fVs=Object.assign({}, st.fVs||{});
  if(col==='__hm'){ if(fNhomSet[v]) delete fNhomSet[v]; else fNhomSet[v]=1; }
  else { var o=fVs[col]=Object.assign({}, fVs[col]||{}); if(o[v]) delete o[v]; else o[v]=1; }
  return {fNhomSet:fNhomSet, fVs:fVs};
}
// Danh sách thương hiệu của ô chọn (renderFilters)
export function brandOptions(products){ var br={}; (products||[]).forEach(function(p){ if(p.thuongHieu) br[p.thuongHieu]=1; }); return Object.keys(br).sort(); }
// Chip Combo: SP có / không có sản phẩm đi kèm
export function comboCounts_(products){ var co=0, khong=0; (products||[]).forEach(function(p){ if(p.comboN>0) co++; else khong++; }); return {co:co, khong:khong}; }
export function favCount_(products){ return (products||[]).filter(function(p){ return p.yeuThich; }).length; }

/* ═══ GOM BIẾN THỂ VỀ CẠNH NHAU ═══ nhóm do người dùng tự đặt (nhomBT) đứng trước, chưa gom thì theo MÃ SP */
export function spVarKey_(p){ return spNorm_(p.nhomBT||'')||spNorm_(p.ma||'')||spNorm_(p.ten||''); }
export function spNum1_(v){ var m=String(v==null?'':v).match(/-?\d+(?:[.,]\d+)?/); return m?parseFloat(m[0].replace(',','.')):-1; }
export function spGroupVariants_(list){
  var order=[], bag={};
  list.forEach(function(p){ var k=spVarKey_(p); if(!bag[k]){ bag[k]=[]; order.push(k); } bag[k].push(p); });
  var out=[];
  order.forEach(function(k){
    var g=bag[k];
    if(g.length>1) g.sort(function(x,y){
      return (spNum1_(x.congSuat)-spNum1_(y.congSuat))
          || (spNum1_(x.nhietDo)-spNum1_(y.nhietDo))
          || (spNum1_(x.gocChieu)-spNum1_(y.gocChieu))
          || String(x.mauSac||'').localeCompare(String(y.mauSac||''),'vi');
    });
    out=out.concat(g);
  });
  return out;
}
// Thẻ đầu tiên đại diện cả nhóm biến thể: [{i, key, kids:[chỉ số]}]
export function catVarGroups_(list){
  var out=[], seen={};
  list.forEach(function(p,i){
    var k=spVarKey_(p); if(!k){ out.push({i:i,key:'',kids:[]}); return; }
    if(seen[k]!=null){ out[seen[k]].kids.push(i); return; }
    seen[k]=out.length; out.push({i:i,key:k,kids:[]});
  });
  return out;
}
// Tên hiển thị ở thư viện: TÊN - MÀU SẮC - KÍCH THƯỚC (phần đã có trong tên thì không lặp)
export function spTenDay_(p){
  if(!p) return '';
  var ten=String(p.ten||'').trim(), low=spNorm_(ten);
  var kt=String(p.kichThuocVS||(p.raw&&p.raw.kich_thuoc)||'').trim();
  return [ten].concat([String(p.mauSac||'').trim(), kt].filter(function(v){ return v && low.indexOf(spNorm_(v))<0; })).join(' - ');
}
// nhãn ngắn cho biến thể: phần thông số khác nhau
export function catVarLbl_(x){
  return [x.congSuat,x.nhietDo,x.gocChieu,x.mauSac].map(function(v){ return String(v==null?'':v).trim(); })
    .filter(Boolean).join(' · ');
}
// "Đèn trong dự án": khoá SP đã dùng trong các dòng của 1 dự án (pickInProj)
export function inProjKeys_(lines){ var keys={}; (lines||[]).forEach(function(l){ var k=String(l.maSP||l.ten||'').toLowerCase().trim(); if(k) keys[k]=1; }); return keys; }
// lọc danh mục theo đề mục đang chọn ở cây (setDemucFilter)
export function demucOf_(code){ var nm=nodeName(code)||''; return {demucKw: code==='X'?'':nm, demucCode: code==='X'?'':code}; }

export function filteredProducts(st, specs){
  var q=String(st.q||'').toLowerCase().trim();
  var mn=Number(st.min)||0, mx=Number(st.max)||0;
  var watts=selKeys_(st.fWatt), kels=selKeys_(st.fKelvin), angs=selKeys_(st.fAngle);
  var ips=selKeys_(st.fIP), cris=selKeys_(st.fCRI), volts=selKeys_(st.fVolt);
  var hmucSel=selKeys_(st.fNhomSet);
  var dk=(st.demucKw||'').toLowerCase().trim();
  var isVS=vsFltOn_(st.node);
  var usedKeys=null;
  if(st.inProjKeys){ usedKeys=st.inProjKeys; }                 // đã chọn 1 dự án cụ thể ở "Đèn trong dự án"
  else if(st.onlyProject){ usedKeys=inProjKeys_(st.lines); }
  return spGroupVariants_((st.products||[]).filter(function(p){
    if(st.fFav && !p.yeuThich) return false;                    // chỉ hiện SP đã lưu yêu thích
    if(st.fCombo==='co'    && !(p.comboN>0)) return false;      // chỉ SP có sản phẩm đi kèm
    if(st.fCombo==='khong' &&  (p.comboN>0)) return false;      // chỉ SP đứng riêng
    if(hmucSel.length && hmucSel.indexOf(prodHmuc_(p, specs))<0) return false;
    if(usedKeys){ var uk=String(p.ma||p.ten||'').toLowerCase().trim(); if(!usedKeys[uk]) return false; }
    if(st.fBrand && p.thuongHieu!==st.fBrand) return false;
    if(q && (p.ten+' '+p.ma+' '+p.thuongHieu+' '+(p.ncc||'')+' '+(p.nhom||'')).toLowerCase().indexOf(q)<0) return false;
    if(dk){ var muc=String(p.muc||'').toLowerCase().trim(); if(muc.indexOf(dk)<0) return false; }   // lọc theo cột "Mục"
    var pr=Number(p.donGiaBan)||0; if(mn&&pr<mn) return false; if(mx&&pr>mx) return false;
    if(isVS) return vsFltMatch_(p, st.fVs);   // đề mục có spec: lọc theo thông số ngành, KHÔNG áp bộ lọc đèn còn sót
    if(watts.length){ var pw=splitVals(p.congSuat); if(!pw.some(function(x){return watts.indexOf(x)>=0;})) return false; }
    if(kels.length){ var pk=splitVals(p.nhietDo); if(!pk.some(function(x){return kels.indexOf(x)>=0;})) return false; }
    if(angs.length){ var pa=splitVals(p.gocChieu); if(!pa.some(function(x){return angs.indexOf(x)>=0;})) return false; }
    if(ips.length){ var pi=splitVals(p.capBaoVe); if(!pi.some(function(x){return ips.indexOf(x)>=0;})) return false; }
    if(cris.length){ var pc=splitVals(p.cri); if(!pc.some(function(x){return cris.indexOf(x)>=0;})) return false; }
    if(volts.length){ var pvv=splitVals(p.dienAp); if(!pvv.some(function(x){return volts.indexOf(x)>=0;})) return false; }
    return true;
  }));
}

/* Đếm bộ lọc đang bật - badge nút "Bộ lọc nâng cao" (activeFilterCount) */
export function activeFilterCount(st){
  var n=vsFltOn_(st.node)?vsFltCount_(st.fVs):0;
  if(!vsFltOn_(st.node)) ['fWatt','fKelvin','fAngle','fIP','fCRI','fVolt'].forEach(function(k){
    var m=st[k]||{}; if(Object.keys(m).some(function(x){return m[x];})) n++;
  });
  if(st.fBrand) n++;
  if((+st.min)||(+st.max)) n++;
  return n;
}
/* Đếm bộ lọc đang bật - badge nút "Bộ lọc" (activeFiltCount_) */
export function activeFiltCount_(st){
  var n=0;
  if(vsFltOn_(st.node)) n+=vsFltCount_(st.fVs);
  else ['fWatt','fKelvin','fAngle','fIP','fCRI','fVolt'].forEach(function(k){ if(Object.keys(st[k]||{}).some(function(x){return st[k][x];})) n++; });
  if(st.fBrand) n++;
  if(st.fCombo) n++;
  if(st.fFav) n++;
  if(st.min||st.max) n++;
  if(Object.keys(st.fNhomSet||{}).some(function(k){return st.fNhomSet[k];})) n++;
  if(st.inProjMa) n++;
  return n;
}
/* Thẻ "đang lọc" dưới ô Đề mục (catActiveChips_): [{lb, val, clear}] ; clear = khoá để bỏ lọc
   ('nhom' | 'inproj' | 'brand' | 'fav' | 'combo' | 'gia' | 'fWatt'... | 'vs:<cột>'). Phần thô (3.1) không có thẻ.
   SP_COL2LABEL_ lấy từ productFields.dbLabelMaps_(specs). */
export function catActiveTags_(st, specs, SP_COL2LABEL_){
  if(st.node==='3.1') return [];
  var out=[];
  function tag(lb,val,clear){ out.push({lb:lb, val:val, clear:clear}); }
  var nhom=selKeys_(st.fNhomSet);
  if(nhom.length) tag('Hạng mục', nhom.length>1?(nhom.length+' mục'):nhom[0], 'nhom');
  if(st.inProjMa){ var pp=(st.projects||[]).filter(function(x){ return x.maDA===st.inProjMa; })[0];
    tag('Trong dự án', pp?(pp.ten||pp.maDA):st.inProjMa, 'inproj'); }
  if(vsFltOn_(st.node)){
    Object.keys(st.fVs||{}).forEach(function(col){ var v=Object.keys(st.fVs[col]).filter(function(x){ return st.fVs[col][x]; });
      var SP=vsFltSpec_(st.node, specs), VS=specs&&specs.VS_SPEC, lb=(SP_COL2LABEL_||{})[col];
      var m=(SP&&SP.METRIC[lb])||(VS&&VS.METRIC[lb]);
      if(v.length) tag(m?m[1]:col, v.length>2?(v.length+' giá trị'):v.join(', '), 'vs:'+col); });
  } else
  [['fWatt','Công suất'],['fKelvin','Nhiệt độ'],['fAngle','Góc chiếu'],['fCRI','CRI'],['fIP','IP'],['fVolt','Điện áp']]
    .forEach(function(x){ var v=selKeys_(st[x[0]]); if(v.length) tag(x[1], v.length>2?(v.length+' giá trị'):v.join(', '), x[0]); });
  if(st.fBrand) tag('Thương hiệu', st.fBrand, 'brand');
  if(st.fFav) tag('Lọc', 'Yêu thích', 'fav');
  if(st.fCombo) tag('Lọc', 'Có combo', 'combo');
  if(st.min||st.max)
    tag('Khoảng giá', (st.min?money(st.min):'0')+' – '+(st.max?money(st.max):'∞'), 'gia');
  return out;
}

/* ═══ BẢNG "BỘ LỌC": khối nào hiện trên panel ═══ */
export const FLT_REG=[['watt','Công suất'],['kelvin','Nhiệt độ màu'],['angle','Góc chiếu sáng'],
  ['yeuthich','Yêu thích'],['combo','Combo'],['brand','Thương hiệu'],['price','Khoảng giá']];
export const FLT_DEN=[['watt','Công suất'],['kelvin','Nhiệt độ màu'],['angle','Góc chiếu sáng']];
export const FLT_CHUNG=[['yeuthich','Yêu thích'],['combo','Combo'],['brand','Thương hiệu'],['price','Khoảng giá']];
// Ngành có spec: khối lọc ĐỘNG theo hạng mục
export function vsFltSecs_(st, specs){
  if(!vsFltOn_(st.node)) return [];
  var SP=vsFltSpec_(st.node, specs), out=[['vs_hm','Hạng mục']];
  vsFltKeys_(st.fNhomSet, st.node, specs).forEach(function(lb){ var m=SP&&SP.METRIC[lb]; if(m) out.push(['vs_'+m[0], m[1]]); });
  return out;
}
// đúng những khối ÁP DỤNG cho ngành đang chọn (thứ tự = thứ tự trên panel)
export function fltSecs_(st, specs){ return (vsFltOn_(st.node)?vsFltSecs_(st, specs):FLT_DEN).concat(FLT_CHUNG); }
// Mặc định: khối thông số của ngành đang chọn + Công suất / Nhiệt độ = HIỆN; 4 khối chung = ẩn
export function fltDefShow_(k){ return (k==='watt'||k==='kelvin'||String(k).indexOf('vs_')===0); }
/* Map hiện/ẩn (qs_fltshow). Lần đầu: lấy lại cài đặt cũ qs_pinflt / qs_fltoff (đã JSON.parse; null nếu không có) */
export function fltShowMapInit_(fltshow, pinflt, fltoff){
  var m=fltshow;
  if(!m||typeof m!=='object'){
    m={};
    if(Array.isArray(pinflt)) FLT_REG.forEach(function(f){ m[f[0]]=pinflt.indexOf(f[0])>=0; });
    if(Array.isArray(fltoff)) fltoff.forEach(function(k){ m[k]=false; });
  }
  return m;
}
export function fltHien_(m,k){ m=m||{}; return (k in m)?!!m[k]:fltDefShow_(k); }
// Khối đèn có hiện trên panel không (fltApplyPins_: khối của đèn không áp dụng cho ngành khác)
export function fltPinned_(m,k,node){ var denOnly={watt:1,kelvin:1,angle:1}; return (denOnly[k]&&vsFltOn_(node)) ? false : fltHien_(m,k); }
// số lọc đang bật của 1 khối (fltActiveN_ + nhánh vs_ của fltNamesRender_)
export function fltActiveN_(k, st){
  function n(o){ return Object.keys(o||{}).filter(function(x){ return o[x]; }).length; }
  if(k==='vs_hm') return n(st.fNhomSet);
  if(String(k).indexOf('vs_')===0){ var col=k.slice(3); return n((st.fVs||{})[col]); }
  if(k==='watt') return n(st.fWatt); if(k==='kelvin') return n(st.fKelvin); if(k==='angle') return n(st.fAngle);
  if(k==='yeuthich') return st.fFav?1:0; if(k==='combo') return st.fCombo?1:0; if(k==='brand') return st.fBrand?1:0;
  if(k==='price'){ return (st.min||st.max)?1:0; }
  return 0;
}
