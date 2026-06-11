/* ENVIRONMENTAL-BURDEN ("air"/pollution) module.
   Data (from export_browser_layers.py, ETL output):
     pollution_scores.json     = { listings:[ { address, overall_environmental_burden_score:0-100|null,
                                     burden_category, confidence_label, subscores:{...} } ] }
     pollution_facilities.json = [ { facility_name, latitude, longitude, distance_mi, parent_company, ... } ]
   Registers:
     • color mode "Environmental burden" — tints listing pins by burden score (when scored)
     • per-listing detail "Nearby industrial sites" — facilities within 5 mi of the selected home,
       drawn in the facilities pane
     • a per-listing burden popup row
   No-ops gracefully if files are absent or the ETL has not been run on the real listings yet. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const S = await BRMap.fetchJSON("pollution_scores.json");
  const F = await BRMap.fetchJSON("pollution_facilities.json");
  const byAddr = {}; let nScored = 0;
  if (S && S.listings) for (const r of S.listings) { byAddr[r.address] = r; if (r.overall_environmental_burden_score != null) nScored++; }
  const col = (s) => (s >= 66 ? "#B23B3B" : s >= 33 ? "#C2691C" : "#1E7A34");

  BRMap.addPopupRow((l) => { const a = byAddr[l.address]; if (!a) return "";
    const sc = a.overall_environmental_burden_score, cat = a.burden_category; if (sc == null && !cat) return "";
    const label = cat || (sc != null ? Math.round(sc) : "—");
    return '<div class="row">Environmental burden: <b style="color:' + col(sc || 0) + '">' + label + "</b>" +
      (sc != null ? " · score " + Math.round(sc) + "/100" : "") + (a.confidence_label ? " · " + a.confidence_label + " confidence" : "") + "</div>"; });

  // color mode (registers even when pending, so the option is discoverable)
  BRMap.addColorMode({ id: "burden", label: "Environmental burden" + (nScored ? "" : " (run ETL)"),
    colorFor: (l) => { const a = byAddr[l.address]; return a && a.overall_environmental_burden_score != null ? col(a.overall_environmental_burden_score) : undefined; },
    legend: '<span class="sw"><i style="background:#1E7A34"></i>Lower</span><span class="sw"><i style="background:#C2691C"></i>Moderate</span><span class="sw"><i style="background:#B23B3B"></i>Higher</span>' });

  // per-listing detail: nearby industrial / TRI facilities
  const fac = Array.isArray(F) ? F.filter((f) => f.latitude != null && f.longitude != null) : [];
  function hav(a, b, c, d) { const R = 3958.7613, r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  let marks = [];
  const clear = () => { marks.forEach((m) => map.removeLayer(m)); marks = []; };
  BRMap.addDetail({ id: "facils", label: "⚠ Nearby industrial sites" + (fac.length ? "" : " (none yet)"), def: false,
    select(l) { clear();
      fac.map((f) => [f, hav(l.lat, l.lon, f.latitude, f.longitude)]).filter(([f, d]) => d <= 5).sort((a, b) => a[1] - b[1]).slice(0, 12)
        .forEach(([f, d]) => { marks.push(L.circleMarker([f.latitude, f.longitude], { pane: BRMap.panes.facils, radius: 5, color: "#9B2C2C", weight: 1, fillColor: "#E53E3E", fillOpacity: 0.6 })
          .bindPopup("⚠ " + (f.facility_name || "facility") + (f.parent_company ? " — " + f.parent_company : "") + " · " + d.toFixed(1) + "mi").addTo(map)); }); },
    clear });
});
