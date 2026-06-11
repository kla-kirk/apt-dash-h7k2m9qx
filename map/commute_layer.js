/* COMMUTE layer module.
   Data: commute.json = { "<address>": { am, pm, off, miles:{am,pm,off} } } (minutes to LSU)
         commute_routes.geojson = FeatureCollection of LineStrings; properties.address keys the
         listing; GeoJSON [lon,lat] coords are flipped to Leaflet [lat,lon].
   Per-listing detail: on listing select, draws that home's route in the routes pane (below pins)
   + a popup row with off-peak / rush times. Auto-clears on deselect. Destination = LSU campus. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const C = await BRMap.fetchJSON("commute.json"); if (!C) { console.warn("commute.json missing"); return; }
  const RT = {}; const gj = await BRMap.fetchJSON("commute_routes.geojson");
  if (gj && gj.features) for (const f of gj.features) { const a = f.properties && f.properties.address;
    if (a && f.geometry && f.geometry.type === "LineString") RT[a] = f.geometry.coordinates.map((c) => [c[1], c[0]]); }

  let line = null;
  const clear = () => { if (line) { map.removeLayer(line); line = null; } };
  BRMap.addDetail({ id: "commute", label: "🚗 Commute route to LSU", def: true,
    select(l) { clear(); const r = RT[l.address]; if (r && r.length) line = L.polyline(r, { pane: BRMap.panes.routes, color: "#2B5797", weight: 4, opacity: 0.75 }).addTo(map); },
    clear });

  BRMap.addPopupRow((l) => { const c = C[l.address]; if (!c) return "";
    const rush = c.am != null && c.pm != null ? Math.max(c.am, c.pm) : (c.am != null ? c.am : c.pm);
    const mi = c.miles ? (c.miles.off != null ? c.miles.off : c.miles.am) : null;
    return '<div class="row">LSU commute: ' + (c.off != null ? Math.round(c.off) + " min off-peak" : "") +
      (rush != null ? " · <b>" + Math.round(rush) + " min rush</b>" : "") + (mi != null ? " · " + (+mi).toFixed(1) + "mi" : "") + "</div>"; });
});
