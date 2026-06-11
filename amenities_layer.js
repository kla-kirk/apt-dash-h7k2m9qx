/* AMENITIES layer module — owned by the "amenities" chat.
   Data: amenities.json = [[name,type,lat,lon]] (flat array; shape UNCHANGED).
   types: grocery, pharmacy, school, park, hospital, gym.
   Features:
    1) Per-category map toggles — each type is its own toggleable dot layer.
    2) On listing click — draws nearest 1 (or 3) of each type within 1.6 mi,
       labelled with distance + rough walk/drive minutes (dashed connector).
    3) Popup — "Walkable access" score (categories within a 15-min walk) plus a
       compact nearest-per-category row. NOTE: deliberately does NOT call
       BRMap.setPinColor — the crime module tints pins and loads first; tinting
       here would stomp it. */
BRMap.ready(async()=>{
 const AM=await BRMap.fetchJSON("amenities.json"); if(!AM){console.warn("amenities.json missing");return;}
 const map=BRMap.map;
 const TYPES=["grocery","pharmacy","school","park","hospital","gym"];
 const ICON ={grocery:"🛒",pharmacy:"💊",school:"🏫",park:"🌳",hospital:"🏥",gym:"🏋"};
 const LABEL={grocery:"Grocery",pharmacy:"Pharmacy",school:"School",park:"Park",hospital:"Hospital",gym:"Gym"};
 const COLOR={grocery:"#E67E22",pharmacy:"#8E44AD",school:"#2980B9",park:"#27AE60",hospital:"#C0392B",gym:"#16A085"};
 const ONCLICK_R=1.6, SCAN_R=8, WALK_MI=0.75;            // 0.75 mi ≈ 15-min walk @3 mph
 function hav(a,b,c,d){const R=3958.7613,r=Math.PI/180;const x=(c-a)*r,y=(d-b)*r;const h=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
 function wd(mi){return {w:Math.max(1,Math.round(mi*20)), d:Math.max(1,Math.round(mi*3.1))};} // walk 3mph; drive ~25mph w/ 1.3 circuity
 // nearest members of each type within `radius`, sorted ascending by distance
 function nearestList(l,radius){ const by={}; for(const a of AM){const t=a[1]; if(!ICON[t])continue; const d=hav(l.lat,l.lon,a[2],a[3]); if(d>radius)continue; (by[t]=by[t]||[]).push({a,d});}
   for(const k in by) by[k].sort((p,q)=>p.d-q.d); return by; }

 // ---- per-category "show all" map layers ----
 const cv=L.canvas({padding:.5});
 const groups={}, counts={};
 TYPES.forEach(t=>{groups[t]=L.layerGroup(); counts[t]=0;});
 for(const a of AM){ const t=a[1]; if(!groups[t])continue; counts[t]++;
   L.circleMarker([a[2],a[3]],{renderer:cv,radius:4,weight:1,color:"#fff",fillColor:COLOR[t],fillOpacity:.85})
    .bindTooltip(ICON[t]+" "+a[0],{direction:"top"}).addTo(groups[t]); }

 // ---- panel UI ----
 const sec=BRMap.section("amen","Amenities");
 let cats='';
 TYPES.forEach(t=>{ cats+='<label class="sub"><input type="checkbox" class="amcat" data-t="'+t+'"><i style="background:'+COLOR[t]+'"></i>'+ICON[t]+" "+LABEL[t]+' ('+counts[t]+')</label>'; });
 sec.insertAdjacentHTML("beforeend",
   '<label><input type="checkbox" id="amOn" checked> Highlight nearest on click</label>'+
   '<label class="sub">show nearest <select id="amN" style="width:auto;display:inline-block;padding:1px 4px"><option value="1">1</option><option value="3">3</option></select> per type</label>'+
   '<span class="st" style="margin-top:7px">Show all on map</span>'+
   '<label><input type="checkbox" id="amAll"> All categories</label>'+cats);

 let on=true, N=1, marks=[];
 const clearMarks=()=>{marks.forEach(m=>map.removeLayer(m));marks=[];};
 document.getElementById("amOn").onchange=e=>{on=e.target.checked; if(!on)clearMarks();};
 document.getElementById("amN").onchange=e=>{N=+e.target.value;};
 function syncAll(){ document.getElementById("amAll").checked=TYPES.every(t=>document.querySelector('.amcat[data-t="'+t+'"]').checked); }
 document.querySelectorAll(".amcat").forEach(cb=>cb.onchange=function(){ const t=this.dataset.t;
   if(this.checked)groups[t].addTo(map); else map.removeLayer(groups[t]); syncAll(); });
 document.getElementById("amAll").onchange=function(){ const on=this.checked;
   TYPES.forEach(t=>{ const cb=document.querySelector('.amcat[data-t="'+t+'"]'); cb.checked=on;
     if(on)groups[t].addTo(map); else map.removeLayer(groups[t]); }); };

 // ---- on-click highlights ----
 map.on("popupclose",clearMarks);
 BRMap.onListingClick(l=>{ clearMarks(); if(!on)return; const by=nearestList(l,ONCLICK_R);
   for(const t in by){ by[t].slice(0,N).forEach((o,i)=>{ const a=o.a, td=wd(o.d);
     marks.push(L.marker([a[2],a[3]],{icon:L.divIcon({className:"",iconSize:[10,10],
       html:'<div class="amlbl" style="opacity:'+(1-i*0.25)+'">'+ICON[t]+" "+a[0]+" · "+o.d.toFixed(1)+"mi · 🚶"+td.w+" 🚗"+td.d+"m</div>"})}).addTo(map));
     marks.push(L.polyline([[l.lat,l.lon],[a[2],a[3]]],{color:COLOR[t],weight:1,opacity:.55-i*0.15,dashArray:"3,4"}).addTo(map)); }); } });

 // ---- popup: walkable-access score + nearest-per-category ----
 const SCT=[{t:"Limited",m:2,c:"#B23B3B"},{t:"Fair",m:4,c:"#9A6A00"},{t:"Good",m:5,c:"#2E8B57"},{t:"Excellent",m:99,c:"#1E7A34"}];
 const tier=n=>SCT[SCT.findIndex(s=>n<s.m)];
 BRMap.addPopupRow(l=>{ const by=nearestList(l,SCAN_R);
   const near=TYPES.map(t=>({t,o:by[t]&&by[t][0]})).filter(x=>x.o);
   if(!near.length) return "";
   const score=near.filter(x=>x.o.d<=WALK_MI).length, tr=tier(score);
   return '<div class="row">Walkable access: <b style="color:'+tr.c+'">'+tr.t+'</b> ('+score+'/'+TYPES.length+' ≤15-min walk)</div>'+
          '<div class="row" style="font-size:11px">'+near.map(x=>ICON[x.t]+x.o.d.toFixed(1)).join(" · ")+' mi</div>'; });
});
