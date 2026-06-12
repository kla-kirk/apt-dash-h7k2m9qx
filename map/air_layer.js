/* POLLUTION / INDUSTRIAL-PROXIMITY module — owned by the "air" chat.
   Editable files (map_site/): air_layer.js, air.json (+ pollution_facilities.json, pollution_metadata.json).

   Focus: "Cancer Alley"-type heavy industry — EPA TRI reporters (refineries, chemical/
   petrochemical plants) with 2024 reported release pounds, plus RMP chemical-accident
   facilities and OSM industrial features. EPA FRS registry gap-fill (land developers,
   medical offices, storm-water permits, …) is NOT shown — it was the noise in the old layer.

   Runtime data (air.json, fetched lazily, absent-safe):
     listings["<address>"] = { score:0-100, label, cancer_risk:null, pm25:null,
        nearest_facility_mi, nearest_facility_name, proximity_release_score,
        nearby_facilities:[ {name, distance_mi, releases_lbs, sector, sources} ] }
     facilities = [ {name, lat, lon, kind, sector, releases_lbs|null, sources:[...]} ]   (~532)

   Registers (new shell API):
     • addArea  "Pollution — TRI release heat"  : a leaflet-heat field weighted by 2024 TRI
        release pounds (the heat map).
     • addColorMode "Pollution proximity (TRI)" : tints listing pins by the relative score.
     • section() checkbox "Industrial / chemical / petroleum sites" : the facility markers,
        colored by source and sized by release magnitude.
     • a per-listing popup row (score + nearest emitter + top nearby emitters).

   Score is a RELATIVE TRI-release proximity rank across the compared listings — a screening
   signal, not an absolute concentration or a medical/health prediction. cancer_risk and pm25
   are null because EJScreen was unreachable at build time. */
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
  // pin / label color by score (percentile rank): 0-32 green · 33-65 amber · 66-100 red
  const col = s => s >= 66 ? "#B23B3B" : s >= 33 ? "#C2691C" : "#1E7A34";
  const miFmt = v => v == null ? "" : (v < 10 ? Number(v).toFixed(1) : String(Math.round(v)));
  const lbs = v => Math.round(v).toLocaleString();
  const SRC_ORDER = ["TRI", "RMP", "OSM", "FRS"];
  const srcLabel = s => (s || []).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).join(" + ");
  const EJ = "cancer_risk &amp; pm25 are null — EJScreen was unreachable at build. Relative TRI-release " +
    "proximity screening signal, not an absolute concentration or a medical estimate.";

  // ---------- per-listing popup row ----------
  BRMap.addPopupRow(l => {
    const a = LI[l.address];
    if (!a || a.score == null) return '<div class="row mut">Pollution data unavailable.</div>';
    const c = col(a.score);
    let h = '<div class="row">Pollution proximity: <b style="color:' + c + '">' + esc(a.label) + '</b>'
      + ' <span style="color:#5A6472">(' + Math.round(a.score) + '/100)</span>'
      + (a.nearest_facility_name ? '<br><span style="color:#5A6472">nearest TRI site: ' + esc(a.nearest_facility_name)
        + (a.nearest_facility_mi != null ? ' · ' + miFmt(a.nearest_facility_mi) + ' mi' : '') + '</span>' : '')
      + '</div>';
    const nf = (a.nearby_facilities || []).slice(0, 4);
    if (nf.length) {
      h += '<div class="row" style="font-size:11px">Heaviest TRI emitters nearby:<br>' + nf.map(f => {
        const bits = [esc(f.name), miFmt(f.distance_mi) + " mi"];
        if (f.releases_lbs != null) bits.push(lbs(f.releases_lbs) + " lb");
        return "· " + bits.join(" · ");
      }).join("<br>") + '</div>';
    }
    h += '<div class="row mut" style="font-size:10.5px">' + EJ + '</div>';
    return h;
  }, "env");

  // ---------- color mode: tint pins by relative TRI-proximity score ----------
  if (typeof BRMap.addColorMode === "function") {
    BRMap.addColorMode({
      id: "pollution",
      label: "Pollution proximity (TRI)",
      colorFor: l => { const a = LI[l.address]; return a && a.score != null ? col(a.score) : undefined; },
      legend: '<span class="sw"><i style="background:#1E7A34"></i>Lower</span>'
        + '<span class="sw"><i style="background:#C2691C"></i>Moderate</span>'
        + '<span class="sw"><i style="background:#B23B3B"></i>Higher</span>'
    });
  }

  // ---------- heat map: TRI release pounds (map overlay) ----------
  const emitters = FAC.filter(f => f.releases_lbs != null && f.releases_lbs > 0);
  if (typeof BRMap.addArea === "function" && typeof L.heatLayer === "function" && emitters.length) {
    const lmax = Math.log10(Math.max.apply(null, emitters.map(f => f.releases_lbs)) + 1);
    // LOG-scaled intensity (not sqrt): TRI releases span ~1000x (one plant at 7.1M lb vs a ~19k-lb
    // median), so normalizing each plant by that single mega-emitter left everything else near zero
    // — that was the "all blue / low" artifact. Log lifts the mid/low emitters so real industry reads hot.
    const pts = emitters.map(f => [f.lat, f.lon, Math.max(0.35, Math.log10(f.releases_lbs + 1) / lmax)]);
    // warm severity ramp only — amber → orange → red → deep maroon. No blue/green (blue reads "safe").
    const GRAD = { 0.0: "#ffd24d", 0.3: "#ff9100", 0.55: "#f4511e", 0.75: "#d32f2f", 0.9: "#b71c1c", 1.0: "#6d0000" };
    const GCSS = "linear-gradient(90deg,#ffd24d,#ff9100,#f4511e,#d32f2f,#b71c1c,#6d0000)";
    let heat = null;
    BRMap.addArea({
      id: "pollheat",
      label: "Pollution — TRI release heat",
      activate(ctx) {
        // big radius + low `max` so the field saturates into orange/red, not a faint wash
        if (!heat) heat = L.heatLayer(pts, { radius: 45, blur: 28, max: 1.1, minOpacity: 0.5, gradient: GRAD, pane: BRMap.panes && BRMap.panes.heat });
        heat.addTo(map);
        if (ctx && ctx.legend) ctx.legend(
          '<span class="sw">less</span><span class="bar" style="background:' + GCSS + '"></span><span class="sw">more</span>'
          + '<div class="mut" style="width:100%">2024 TRI release lbs near a point, distance-blurred (log-scaled).</div>');
      },
      deactivate() { if (heat) map.removeLayer(heat); }
    });
  }

  // ---------- exposure-risk rings (research-based; shaded around a clicked plant) ----------
  const RING_PANE = (BRMap.panes && BRMap.panes.areas) || undefined, MI_M = 1609.344;
  // Chronic ambient bands: ambient concentration falls off steeply but isn't a hard edge. Generic
  // screening distances (EPA uses 10 km for "fenceline" communities; ~500x drop within ~2 km; RSEI to 50 km).
  const CHRONIC = [
    { m: 10000, op: 0.05, label: "10 km — EPA fenceline screening extent" },
    { m: 5000, op: 0.09, label: "5 km — elevated chronic zone" },
    { m: 1600, op: 0.16, label: "1.6 km (~1 mi) — fenceline / steep-decay peak" }
  ];
  // Worst-case ACCIDENTAL-release toxic-endpoint radius (miles). Plant-specific from EPA RMP filings
  // where sourced; otherwise a corridor reference for RMP plants (they all file a worst-case scenario).
  // ~25 mi is the documented upper end for the corridor's big toxic-gas plants (phosgene/HF/chlorine).
  const WORSTCASE_EXACT = [{ test: /rubicon/i, mi: 25, note: "phosgene, EPA RMP" }];
  const WORSTCASE_REF_MI = 25;
  function worstCase(f) {
    const ex = WORSTCASE_EXACT.find(w => w.test.test(f.name || ""));
    if (ex) return { mi: ex.mi, exact: true, note: ex.note };
    if ((f.sources || []).includes("RMP")) return { mi: WORSTCASE_REF_MI, exact: false };
    return null;
  }
  const ringsLayer = L.layerGroup();
  function clearRings() { ringsLayer.clearLayers(); if (map.hasLayer(ringsLayer)) map.removeLayer(ringsLayer); }
  function ringEligible(f) { return f && (f.releases_lbs != null || (f.sources || []).includes("RMP")); }
  function drawRings(f) {
    ringsLayer.clearLayers();
    if (!ringEligible(f)) return;
    CHRONIC.forEach(z => L.circle([f.lat, f.lon], { radius: z.m, pane: RING_PANE, interactive: false,
      stroke: true, color: "#b71c1c", weight: 1, opacity: 0.4, fill: true, fillColor: "#e53935", fillOpacity: z.op }).addTo(ringsLayer));
    const wc = worstCase(f);
    if (wc) L.circle([f.lat, f.lon], { radius: wc.mi * MI_M, pane: RING_PANE, interactive: false, fill: false,
      stroke: true, color: "#6d0000", weight: 2, opacity: wc.exact ? 0.9 : 0.55, dashArray: wc.exact ? "8,5" : "2,8" }).addTo(ringsLayer);
    if (!map.hasLayer(ringsLayer)) ringsLayer.addTo(map);
  }
  let ringsOn = true;
  map.on("popupopen", e => { const f = e.popup && e.popup._source && e.popup._source._fac; if (ringsOn && f) drawRings(f); });
  map.on("popupclose", clearRings);

  // ---------- facility markers (industrial only) ----------
  function facStyle(f) {
    if (f.releases_lbs != null) {                  // TRI reporter — red, sized by 2024 release pounds
      const big = f.releases_lbs >= 1e6;
      const r = 4 + 8 * Math.sqrt(Math.min(f.releases_lbs, 7.2e6) / 7.2e6);
      return { color: big ? "#7B1E1E" : "#9B2C2C", fill: big ? "#C0392B" : "#E05353", r: Math.max(4, r) };
    }
    if ((f.sources || []).includes("RMP")) return { color: "#B45309", fill: "#DD6B20", r: 4.5 };  // RMP chemical-accident
    return { color: "#6B7280", fill: "#AEB6BF", r: 3 };                                           // OSM / other industrial
  }
  function facPopup(f) {
    let h = '<div class="pop"><b>⚠ ' + esc(f.name || "Facility") + '</b>';
    const ks = (f.kind && f.sector && f.kind !== f.sector) ? esc(f.kind) + " · " + esc(f.sector) : esc(f.sector || f.kind || "");
    if (ks) h += '<div class="row">' + ks + '</div>';
    if (f.sources && f.sources.length) h += '<div class="row">Sources: ' + esc(srcLabel(f.sources)) + '</div>';
    if (f.releases_lbs != null) h += '<div class="row"><b>2024 TRI releases: ' + lbs(f.releases_lbs) + ' lb</b></div>';
    const wc = worstCase(f);
    if (wc) h += '<div class="row">Worst-case release radius: ~' + wc.mi + ' mi'
      + (wc.exact ? ' <span style="color:#5A6472">(RMP: ' + esc(wc.note) + ')</span>' : ' <span style="color:#5A6472">(corridor reference)</span>') + '</div>';
    h += '<div class="row mut" style="font-size:10.5px">TRI releases are 2024 reported total releases (lb); '
      + 'RMP/OSM identify chemical/industrial sites but do not imply measured emissions.</div>';
    return h + '</div>';
  }
  const facPane = (BRMap.panes && BRMap.panes.facils) || undefined;
  const renderer = L.canvas({ pane: facPane, padding: 0.5 });
  const facLayer = L.layerGroup(FAC.map(f => {
    const st = facStyle(f);
    const m = L.circleMarker([f.lat, f.lon], { renderer, radius: st.r, color: st.color, weight: 1, fillColor: st.fill, fillOpacity: 0.75 })
      .bindPopup(() => facPopup(f));
    m._fac = f;                                     // lets popupopen draw this plant's exposure rings
    return m;
  }));
  const nTRI = FAC.filter(f => f.releases_lbs != null).length;
  const nRMP = FAC.filter(f => f.releases_lbs == null && (f.sources || []).includes("RMP")).length;
  const nOSM = FAC.length - nTRI - nRMP;

  const sec = BRMap.section("air", "Pollution / industrial proximity");
  sec.insertAdjacentHTML("beforeend",
    '<label><input type="checkbox" id="polFac"> Industrial / chemical / petroleum sites</label>' +
    '<div class="legend" style="margin-top:3px">' +
      '<span class="sw"><i style="background:#C0392B"></i>TRI (2024 releases, sized)</span>' +
      '<span class="sw"><i style="background:#DD6B20"></i>RMP</span>' +
      '<span class="sw"><i style="background:#AEB6BF"></i>industrial (OSM)</span></div>' +
    '<div class="mut">' + nTRI + ' TRI emitters · ' + nRMP + ' RMP · ' + nOSM + ' other industrial. ' +
      'EPA FRS registry-only points excluded. ' + EJ + '</div>' +
    '<label style="margin-top:7px"><input type="checkbox" id="polRings" checked> Exposure-risk rings (click a plant)</label>' +
    '<div class="legend" style="margin-top:2px">' +
      '<span class="sw"><i style="background:#e53935"></i>chronic ≤1.6 / 5 / 10 km</span>' +
      '<span class="sw"><i class="sq" style="background:transparent;border:1px dashed #6d0000"></i>worst-case (accidental)</span></div>' +
    '<div class="mut" style="margin-left:18px">Click a plant to shade its zones. Filled = chronic ambient bands ' +
      '(EPA/RSEI screening distances). Dashed = worst-case accidental-release radius — bold-dash where sourced ' +
      '(Rubicon ≈25 mi, phosgene RMP), fine-dash = ~25 mi corridor reference for other RMP plants. ' +
      'Screening reference distances, not a plant-specific dispersion model.</div>');

  const facEl = document.getElementById("polFac");
  if (facEl) facEl.onchange = e => { if (e.target.checked) facLayer.addTo(map); else { map.removeLayer(facLayer); clearRings(); } };
  const ringsEl = document.getElementById("polRings");
  if (ringsEl) ringsEl.onchange = e => { ringsOn = e.target.checked; if (!ringsOn) clearRings(); };
});
