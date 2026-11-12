/* Bảng điều khiển - gom bản nháp theo dự án, tìm dự án, link Dezon. Port nguyên văn:
   projectGroups dash.js:40-51 · projGroupOf_ 70-77 · dashProjCards_ (lọc tìm) 205-207 · dezonHost_ / dezonUrl_ 6-7
   dezonSet_ (chuẩn hoá link) 26-28 · currentGroup app.js:2107-2113 · draftName_ 2115 */

// Gom bản nháp theo Dự án (cùng tên dự án = cùng 1 dự án); bản nháp xếp theo ngày tạo
export function projectGroups(projects){
  var groups={}, order=[];
  (projects||[]).forEach(function(p){
    var key=String(p.ten||'(Chưa đặt tên)').trim().toLowerCase();
    if(!groups[key]){ groups[key]={name:p.ten||'(Chưa đặt tên)', khachHang:p.khachHang, diaChi:p.diaChi, sdt:p.sdt, drafts:[]}; order.push(key); }
    var g=groups[key]; g.drafts.push(p);
    if(p.khachHang) g.khachHang=p.khachHang; if(p.diaChi) g.diaChi=p.diaChi; if(p.sdt) g.sdt=p.sdt;
    if(p.linkDezon) g.linkDezon=p.linkDezon;
  });
  order.forEach(function(k){ groups[k].drafts.sort(function(a,b){ return String(a.ngayTao||'').localeCompare(String(b.ngayTao||'')); }); });
  return order.map(function(k){ return groups[k]; });
}
/* Trạng thái dự án (cột trang_thai của từng bản nháp). Giá trị cũ: "Bản nháp" = Đang báo giá, "Hoàn thành" = Đã thực hiện.
   Trạng thái của DỰ ÁN = mức cao nhất trong các bản nháp (có bản đã thực hiện -> Đã thực hiện; có bản đang làm -> Đang thực hiện). */
export var TT_DU_AN=['Đang báo giá','Đang thực hiện','Đã thực hiện'];
export function ttChuan_(v){ v=String(v||'').trim(); if(v==='Hoàn thành') return 'Đã thực hiện'; return TT_DU_AN.indexOf(v)>=0?v:'Đang báo giá'; }
export function groupStatus_(g){ var r=0; (g.drafts||[]).forEach(function(d){ r=Math.max(r, TT_DU_AN.indexOf(ttChuan_(d.trangThai))); }); return TT_DU_AN[r]; }
// Năm của dự án = năm tạo bản nháp đầu tiên ('' nếu không có ngày)
export function groupYear_(g){ var d=(g.drafts&&g.drafts[0]&&g.drafts[0].ngayTao)||''; var m=/^(\d{4})/.exec(String(d)); return m?m[1]:''; }
// Tìm dự án (nhóm bản nháp) theo MÃ của một bản nháp bất kỳ trong nhóm
export function projGroupOf_(projects,key){
  key=String(key||''); if(!key) return null;
  var gs=projectGroups(projects);
  for(var i=0;i<gs.length;i++){
    for(var j=0;j<gs[i].drafts.length;j++) if(String(gs[i].drafts[j].maDA)===key) return gs[i];
  }
  return null;
}
// Ô tìm dự án (tên dự án, khách hàng, SĐT)
export function dashSearch_(groups,q){
  q=String(q||'').toLowerCase().trim();
  return q?groups.filter(function(g){ return (g.name+' '+(g.khachHang||'')+' '+(g.sdt||'')).toLowerCase().indexOf(q)>=0; }):groups;
}
// Nhóm bản nháp của dự án đang mở: {name, drafts, idx}
export function currentGroup(projects,cur){
  if(!cur) return null;
  var key=String(cur.ten||'').trim().toLowerCase();
  var drafts=(projects||[]).filter(function(p){ return String(p.ten||'').trim().toLowerCase()===key; })
    .sort(function(a,b){ return String(a.ngayTao||'').localeCompare(String(b.ngayTao||'')); });
  return {name:cur.ten, drafts:drafts, idx:drafts.findIndex(function(d){return d.maDA===cur.maDA;})};
}
// tên bản nháp: dùng tên tuỳ chỉnh nếu có, ngược lại "Bản nháp N"
export function draftName_(d,i){ return String(d.tenBanNhap||'').trim() || ('Bản nháp '+(i+1)); }
// payload tạo bản nháp mới cho nhóm (addDraft)
export function addDraftPayload_(g){ return {ten:g.name, khachHang:g.khachHang, sdt:g.sdt, diaChi:g.diaChi, vat:0}; }

/* Link bài dự án trên dezon.vn */
export function dezonHost_(u){ try{ return new URL(u).hostname; }catch(e){ return ''; } }
export function dezonUrl_(u){ u=String(u||'').trim(); return /^https?:\/\//i.test(u)?u:('https://'+u); }
// Chuẩn hoá link người dán: thêm https:// nếu thiếu; lạ = không thuộc dezon.vn (bản gốc hỏi lại trước khi lưu)
export function dezonLinkIn_(v){
  v=String(v==null?'':v).trim();
  if(v && !/^https?:\/\//i.test(v)) v='https://'+v;
  return {v:v, la: !!v && !/(^|\.)dezon\.vn$/i.test(dezonHost_(v))};
}
