/* REVIEW-STATUS module — filter listings by Accepted / Needs review / Rejected.
   - Existing shell listings (the vetted set) default to "accepted".
   - review.json = [{id,address,lat,lon,price,beds,baths,sqft,url}] holds the NEW Zillow imports
     (geocode them first; until review.json exists this just controls the existing pins).
   - Status is SHARED with needs_review.html via localStorage key "nr_status_v1"
     {id: "accepted"|"rejected"|"needs"}. Mark accept/reject from a pin popup.
   Owned by the listings/review chat. */
BRMap.ready(async()=>{
  const LS="nr_status_v1";
  let status={}; try{status=JSON.parse(localStorage.getItem(LS))||{}}catch(e){}
  const save=()=>{try{localStorage.setItem(LS,JSON.stringify(status));}catch(e){}};
  const REV=(await BRMap.fetchJSON("review.json"))||[];
  const COL={accepted:"#1E7A34",needs:"#9A6A00",rejected:"#B23B3B"};
  const lbl=s=>s==="accepted"?"Accepted":s==="rejected"?"Rejected":"Needs review";
  const defFor=id=>(String(id).indexOf("nr")===0)?"needs":"accepted";
  const stOf=id=>status[id]||defFor(id);
  const show={accepted:true,needs:true,rejected:false};   // hide rejected by default

  // pins for the (geocoded) new imports — distinct square markers
  const revPins={};
  function revIcon(id){const c=COL[stOf(id)];
    return L.divIcon({className:"",html:'<div style="width:14px;height:14px;border-radius:3px;background:'+c+';border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4)"></div>',iconSize:[14,14],iconAnchor:[7,7]});}
  function popup(l){const s=stOf(l.id);
    return '<div class="pop"><b>'+l.address+'</b> <span class="badge" style="background:'+COL[s]+'22;color:'+COL[s]+'">'+lbl(s)+'</span>'+
     '<div class="row">'+(l.price?"$"+(+l.price).toLocaleString()+"/mo":"")+(l.beds?" · "+l.beds+"bd":"")+(l.baths?"/"+l.baths+"ba":"")+(l.sqft?" · "+(+l.sqft).toLocaleString()+"sf":"")+'</div>'+
     (l.url?'<div class="row"><a href="'+l.url+'" target="_blank" rel="noopener">Zillow ↗</a></div>':"")+
     '<div class="row"><button onclick="window.__rev(\''+l.id+'\',\'accepted\')">Accept</button> <button onclick="window.__rev(\''+l.id+'\',\'rejected\')">Reject</button></div></div>';}
  REV.forEach(l=>{ if(l.lat==null||l.lon==null) return;
    const m=L.marker([l.lat,l.lon],{icon:revIcon(l.id)}); m.bindPopup(()=>popup(l)); revPins[l.id]=m; });

  function apply(){
    BRMap.listings.forEach(l=>{const m=BRMap.pins[l.id]; if(!m)return; show[stOf(l.id)]?m.addTo(BRMap.map):BRMap.map.removeLayer(m);});
    Object.entries(revPins).forEach(([id,m])=>{ if(show[stOf(id)]){m.setIcon(revIcon(id));m.addTo(BRMap.map);} else BRMap.map.removeLayer(m); });
  }
  window.__rev=(id,v)=>{ status[id]=(status[id]===v?defFor(id):v); save(); apply(); BRMap.map.closePopup(); };

  const sec=BRMap.section("review","Review status");
  function counts(){const c={accepted:0,needs:0,rejected:0}; BRMap.listings.forEach(l=>c[stOf(l.id)]++); REV.forEach(l=>{if(l.lat!=null)c[stOf(l.id)]++;}); return c;}
  function ui(){const c=counts();
    sec.innerHTML='<span class="st">Review status</span>'+
     [["accepted","✓ Accepted","#1E7A34"],["needs","◷ Needs review","#9A6A00"],["rejected","✕ Rejected","#B23B3B"]].map(([k,t,col])=>
       '<label><input type="checkbox" '+(show[k]?"checked":"")+' data-k="'+k+'"><span style="color:'+col+';font-weight:600">'+t+'</span> <span class="mut">('+c[k]+')</span></label>').join("")+
     (REV.length?'':'<div class="mut">New Zillow imports show here once geocoded into review.json.</div>');
    sec.querySelectorAll("input").forEach(cb=>cb.onchange=()=>{show[cb.dataset.k]=cb.checked;apply();ui();});
  }
  ui(); apply();
});
