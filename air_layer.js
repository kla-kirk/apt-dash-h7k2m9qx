/* POLLUTION / INDUSTRIAL-PROXIMITY module — owned by the "air" chat.
   Editable files (map_site/): air_layer.js, air.json, pollution_facilities.json, pollution_metadata.json.

   Runtime data (fetched lazily, all absent-safe — the shell loads fine if these are missing):
     air.json = {
       generated_at_utc, methodology,
       listings: { "<address>": { score:0-100, cancer_risk:null, pm25:null, label,
                    nearest_facility_mi, proximity_release_score,
                    nearby_facilities:[ {name, distance_mi, sources:[...], releases_lbs} ] } },
       facilities: [ {name, lat, lon, kind, sector, releases_lbs, sources:[...]} ]   // ~8,265 sites
     }
     pollution_facilities.json = same `facilities` array (fallback if air.json has none).

   Registers (new shell API), degrading to legacy section() for the toggle:
     • color mode "Pollution / industrial proximity" — tints listing pins by score (single-select).
     • a per-listing popup row — proximity label + nearest-facility distance + top nearby sites.
     • a "Pollution / industrial proximity" section with an "Industrial / chemical / petroleum sites"
       checkbox that draws the facility layer (source-colored, capped for performance).

   This is an INDUSTRIAL-PROXIMITY screening / comparison layer, not a medical-risk estimate.
   EJScreen was attempted during the build but unreachable (DNS), so the air-toxics fields
   `cancer_risk` and `pm25` are null; the UI says so plainly and never implies a health prediction. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const A = await BRMap.fetchJSON("air.json");
  if (!A || !A.listings) return;                                  // no-op gracefully when air.json is absent

  const LI = A.listings;
  let FAC = Array.isArray(A.facilities) ? A.facilities : null;
  if (!FAC || !FAC.length) FAC = (await BRMap.fetchJSON("pollution_facilities.json")) || [];
  FAC = FAC.filter(f => f && f.lat != null && f.lon != null);

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // pin / label color by score: 0-32 green · 33-65 amber · 66-100 red
  const col = s => s >= 66 ? "#B23B3B" : s >= 33 ? "#C2691C" : "#1E7A34";
  const miFmt = v => v == null ? "" : (v < 10 ? Number(v).toFixed(1) : String(Math.round(v)));
  const SRC_ORDER = ["TRI", "RMP", "FRS", "OSM"];
  const srcLabel = s => (s || []).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).join(" + ");

  const EJ_CAVEAT = "EJScreen metrics unavailable: cancer_risk &amp; pm25 are null (EJScreen lookup failed — DNS — " +
    "during build). Industrial-proximity screening / comparison layer, not a medical-risk estimate.";

  // ---------- per-listing popup row ----------
  BRMap.addPopupRow(l => {
    const a = LI[l.address];
    if (!a || a.score == null) return "";
    const c = col(a.score);
    let h = '<div class="row">Pollution proximity: <b style="color:' + c + '">' + esc(a.label || Math.round(a.score)) + '</b>'
      + (a.nearest_facility_mi != null ? ' · nearest facility ' + miFmt(a.nearest_facility_mi) + ' mi' : '') + '</div>';
    const nf = (a.nearby_facilities || []).slice(0, 4);
    if (nf.length) {
      h += '<div class="row" style="font-size:11px">' + nf.map(f => {
        const bits = [esc(f.name)];
        if (f.distance_mi != null) bits.push(miFmt(f.distance_mi) + " mi");
        if (f.releases_lbs != null) bits.push(Math.round(f.releases_lbs).toLocaleString() + " lb");
        if (f.sources && f.sources.length) bits.push(esc(srcLabel(f.sources)));
        return "· " + bits.join(" · ");
      }).join("<br>") + '</div>';
    }
    h += '<div class="row mut" style="font-size:10.5px">' + EJ_CAVEAT + '</div>';
    return h;
  });

  // ---------- color mode: tint pins by pollution-proximity score ----------
  if (typeof BRMap.addColorMode === "function") {
    BRMap.addColorMode({
      id: "pollution",
      label: "Pollution / industrial proximity",
      colorFor: l => { const a = LI[l.address]; return a && a.score != null ? col(a.score) : undefined; },
      legend: '<span class="sw"><i style="background:#1E7A34"></i>Low</span>'
        + '<span class="sw"><i style="background:#C2691C"></i>Moderate</span>'
        + '<span class="sw"><i style="background:#B23B3B"></i>High</span>'
    });
  }

  // ---------- facility layer ----------
  function facStyle(f) {
    if (f.releases_lbs != null) {                 // TRI facility with 2024 reported releases → red / dark red
      const big = f.releases_lbs >= 1e6;
      return { color: big ? "#7B1E1E" : "#9B2C2C", fill: big ? "#B23B3B" : "#E05353", r: big ? 6 : 4.5 };
    }
    if ((f.sources || []).includes("RMP")) return { color: "#B45309", fill: "#DD6B20", r: 4 };   // RMP → orange
    return { color: "#8A93A0", fill: "#AEB6BF", r: 3 };                                           // FRS/OSM-only → muted gray
  }
  function facPopup(f) {
    let h = '<div class="pop"><b>⚠ ' + esc(f.name || "Facility") + '</b>';
    const ks = (f.kind && f.sector && f.kind !== f.sector) ? esc(f.kind) + " · " + esc(f.sector) : esc(f.kind || f.sector || "");
    if (ks) h += '<div class="row">' + ks + '</div>';
    if (f.sources && f.sources.length) h += '<div class="row">Sources: ' + esc(srcLabel(f.sources)) + '</div>';
    if (f.releases_lbs != null) h += '<div class="row">2024 TRI releases: ' + Math.round(f.releases_lbs).toLocaleString() + ' lb</div>';
    h += '<div class="row mut" style="font-size:10.5px">TRI releases are 2024 reported total releases in pounds; '
      + 'OSM/FRS/RMP identify facilities but do not imply measured emissions.</div>';
    return h + '</div>';
  }

  const facPane = (BRMap.panes && BRMap.panes.facils) || undefined;
  const renderer = L.canvas({ pane: facPane, padding: 0.5 });
  const facLayer = L.layerGroup();
  // Always-render "priority" sites (TRI releasers + RMP) so the big chemical/petroleum plants
  // are guaranteed visible; gap-fill FRS/OSM points only within the current view, capped.
  const isPriority = f => f.releases_lbs != null || (f.sources || []).includes("RMP");
  const PRIORITY = FAC.filter(isPriority);
  const OTHERS = FAC.filter(f => !isPriority(f));
  const CAP = 1200;
  function mk(f) {
    const st = facStyle(f);
    return L.circleMarker([f.lat, f.lon], { renderer, radius: st.r, color: st.color, weight: 1, fillColor: st.fill, fillOpacity: 0.75 })
      .bindPopup(() => facPopup(f));
  }
  function redraw() {
    facLayer.clearLayers();
    PRIORITY.forEach(f => mk(f).addTo(facLayer));
    const b = map.getBounds(); let n = 0;
    for (const f of OTHERS) { if (n >= CAP) break; if (b.contains([f.lat, f.lon])) { mk(f).addTo(facLayer); n++; } }
    const cnt = document.getElementById("polCount");
    if (cnt) cnt.textContent = (PRIORITY.length + n).toLocaleString() + " of " + FAC.length.toLocaleString() + " sites shown (priority + in view)";
  }

  const sec = BRMap.section("pollution", "Pollution / industrial proximity");
  sec.insertAdjacentHTML("beforeend",
    '<label><input type="checkbox" id="polFac"> Industrial / chemical / petroleum sites</label>' +
    '<div class="legend" style="margin-top:3px">' +
      '<span class="sw"><i style="background:#B23B3B"></i>TRI (2024 releases)</span>' +
      '<span class="sw"><i style="background:#DD6B20"></i>RMP</span>' +
      '<span class="sw"><i style="background:#AEB6BF"></i>FRS / OSM</span></div>' +
    '<div class="mut" id="polCount"></div>' +
    '<div class="mut" style="font-size:10.5px">' + FAC.length.toLocaleString() + ' sites — OSM: locations/types only; ' +
      'TRI: 2024 reported releases for 85 matched facilities; FRS/RMP: EPA registry. ' + EJ_CAVEAT + '</div>');

  let onMove = null;
  const facEl = document.getElementById("polFac");
  if (facEl) facEl.onchange = e => {
    if (e.target.checked) { redraw(); facLayer.addTo(map); onMove = () => redraw(); map.on("moveend", onMove); }
    else {
      if (onMove) { map.off("moveend", onMove); onMove = null; }
      map.removeLayer(facLayer); facLayer.clearLayers();
      const cnt = document.getElementById("polCount"); if (cnt) cnt.textContent = "";
    }
  };
});
