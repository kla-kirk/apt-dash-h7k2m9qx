/* POLLUTION / INDUSTRIAL-PROXIMITY module — owned by the "air" chat.
   Editable files (map_site/): air_layer.js, air.json (+ pollution_facilities.json, pollution_metadata.json).

   Focus: "Cancer Alley"-type toxic/high-risk screening — TRI air releases, LDEQ ERIC
   air emissions, AirToxScreen/AirData context, RMP hazardous-chemical sites, and major
   industrial discharge/compliance context. FRS-only / OSM-only records are hidden by
   default because they are often administrative registry noise.

   Runtime data (air.json, fetched lazily, absent-safe):
     listings["<address>"] = { score:0-100, label, cancer_risk, pm25,
        nearest_facility_mi, nearest_facility_name, proximity_release_score,
        ldeq_air_emissions_score, nearby_facilities:[...] }
     facilities = [ {name, lat, lon, kind, sector, releases_lbs|null,
        ldeq_air_emissions_tpy|null, tiers:[...], default_visible:boolean} ]

   Registers (new shell API):
     • addArea  "Pollution — TRI release heat"  : a leaflet-heat field weighted by 2024 TRI
        release pounds (the heat map).
     • addColorMode "Pollution burden" : tints listing pins by the relative score.
     • section() checkbox "Industrial / chemical / petroleum sites" : the facility markers,
        colored by source and sized by release magnitude.
     • a per-listing popup row (score + nearest emitter + top nearby emitters).

   Score is a relative screening signal, not an absolute concentration, cancer probability,
   diagnosis, or personal medical-risk prediction. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const A = await BRMap.fetchJSON("air.json");
  if (!A || !A.listings) return;                                  // no-op gracefully when air.json is absent

  const LI = A.listings;
  let FAC = Array.isArray(A.facilities) ? A.facilities : null;
  if (!FAC || !FAC.length) FAC = (await BRMap.fetchJSON("pollution_facilities.json")) || [];
  const FAC_ALL = FAC.filter(f => f && f.lat != null && f.lon != null);
  FAC = FAC_ALL.filter(f => f.default_visible !== false);
  const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const FACBYNAME = {};
  FAC_ALL.forEach(f => { const k = normName(f.name); if (k && !(k in FACBYNAME)) FACBYNAME[k] = f; });

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // pin / label color by score (percentile rank): 0-32 green · 33-65 amber · 66-100 red
  const col = s => s >= 66 ? "#B23B3B" : s >= 33 ? "#C2691C" : "#1E7A34";
  const miFmt = v => v == null ? "" : (v < 10 ? Number(v).toFixed(1) : String(Math.round(v)));
  const lbs = v => Math.round(v).toLocaleString();
  const SRC_ORDER = ["TRI", "LDEQ", "RMP", "RCRAInfo", "NPDES", "ECHO_CAA", "OSM", "FRS"];
  const srcLabel = s => (s || []).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b)).join(" + ");
  const SCREEN_NOTE = "Screening burden layer using AirToxScreen, EPA AirData, TRI air releases, " +
    "LDEQ ERIC air emissions, RMP, and major industrial context. Not a cancer probability, " +
    "diagnosis, or personal medical-risk estimate.";

  // ---------- per-listing popup row ----------
  BRMap.addPopupRow(l => {
    const a = LI[l.address];
    if (!a || a.score == null) return '<div class="row mut">Pollution data unavailable.</div>';
    const c = col(a.score);
    let h = '<div class="row">Pollution proximity: <b style="color:' + c + '">' + esc(a.label) + '</b>'
      + ' <span style="color:#5A6472">(' + Math.round(a.score) + '/100)</span>'
      + (a.nearest_facility_name ? '<br><span style="color:#5A6472">nearest high-signal site: ' + esc(a.nearest_facility_name)
        + (a.nearest_facility_mi != null ? ' · ' + miFmt(a.nearest_facility_mi) + ' mi' : '') + '</span>' : '')
      + '</div>';
    const nf = (a.nearby_facilities || []).slice(0, 4);
    if (nf.length) {
      h += '<div class="row" style="font-size:11px">High-signal sources nearby:<br>' + nf.map(f => {
        const bits = [esc(f.name), miFmt(f.distance_mi) + " mi"];
        if (f.releases_lbs != null) bits.push("TRI air " + lbs(f.releases_lbs) + " lb");
        if (f.ldeq_air_emissions_tpy != null) bits.push("LDEQ " + Number(f.ldeq_air_emissions_tpy).toLocaleString() + " tpy");
        if (f.npdes_dmr_pounds != null) bits.push("DMR " + lbs(f.npdes_dmr_pounds) + " lb");
        const full = FACBYNAME[normName(f.name)];                              // match to full facility record
        if (full && (full.dominant_risk_type || full.dominant_chemical)) {
          let dx = full.dominant_chemical ? esc(full.dominant_chemical) : "";
          if (full.dominant_risk_type) dx += " (" + esc(full.dominant_risk_type) + ")";
          if (full.facility_toxicity_score != null) dx += " · tox " + Math.round(full.facility_toxicity_score);
          bits.push(dx.trim());
        }
        return "· " + bits.join(" · ");
      }).join("<br>") + '</div>';
    }
    return h;
  }, "env");

  // ---------- color mode: tint pins by relative TRI-proximity score ----------
  if (typeof BRMap.addColorMode === "function") {
    BRMap.addColorMode({
      id: "pollution",
      label: "Pollution burden",
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
    const pts = emitters.map(f => [f.lat, f.lon, Math.max(0.1, Math.log10(f.releases_lbs + 1) / lmax)]);
    // warm severity ramp only — amber → orange → red → deep maroon. No blue/green (blue reads "safe").
    const GRAD = { 0.0: "#ffd24d", 0.3: "#ff9100", 0.55: "#f4511e", 0.75: "#d32f2f", 0.9: "#b71c1c", 1.0: "#6d0000" };
    const GCSS = "linear-gradient(90deg,#ffd24d,#ff9100,#f4511e,#d32f2f,#b71c1c,#6d0000)";
    let heat = null;
    BRMap.addArea({
      id: "pollheat",
      label: "Pollution — TRI release heat",
      activate(ctx) {
        // tuned for CONTRAST: tighter radius + higher `max` so dense plant clusters read deep red while
        // isolated plants stay amber/orange — instead of one saturated blob. (heat radius is in pixels,
        // so it still spreads at very low zoom.)
        if (!heat) heat = L.heatLayer(pts, { radius: 26, blur: 16, max: 2.2, minOpacity: 0.28, gradient: GRAD, pane: BRMap.panes && BRMap.panes.heat });
        heat.addTo(map);
        if (ctx && ctx.legend) ctx.legend(
          '<span class="sw">less</span><span class="bar" style="background:' + GCSS + '"></span><span class="sw">more</span>'
          + '<div class="mut" style="width:100%">Density of 2024 TRI emitters, weighted by release lbs (log-scaled) — source density, not measured concentration.</div>');
      },
      deactivate() { if (heat) map.removeLayer(heat); }
    });
  }

  // ---------- screening-radius rings (Codex facility.risk_radii[]; chemical_summary fallback) ----------
  // NOT a dispersion model. Colored by risk_type: purple = cancer-potency weighted, amber = chronic
  // noncancer inhalation, dashed red = acute hazard, gray = lower/unclassified. Radii come straight
  // from air.json — never invented client-side.
  const RING_PANE = (BRMap.panes && BRMap.panes.areas) || undefined, MI_M = 1609.344;
  const RISK_RING = {
    cancer:    { color: "#6a1b9a", fill: "#ab47bc", fillOpacity: 0.15, weight: 2, dash: null },
    noncancer: { color: "#e65100", fill: "#fb8c00", fillOpacity: 0.10, weight: 1.5, dash: null },
    acute:     { color: "#b71c1c", fill: null, fillOpacity: 0, weight: 2, dash: "7,5" },
    lower:     { color: "#9aa3ad", fill: "#cfd5dc", fillOpacity: 0.06, weight: 1, dash: "2,6" }
  };
  const KIND_TO_RISK = { chronic_cancer: "cancer", chronic_noncancer: "noncancer", acute_accident: "acute" };
  function riskRadii(f) {
    if (Array.isArray(f.risk_radii) && f.risk_radii.length) return f.risk_radii;
    const sr = f.chemical_summary && f.chemical_summary.screening_radii;       // fallback to older schema
    return Array.isArray(sr) ? sr.map(r => ({ chemical: r.chemical, radius_mi: r.radius_mi, risk_type: KIND_TO_RISK[r.kind] || "lower" })) : [];
  }
  const ringsLayer = L.layerGroup();
  function clearRings() { ringsLayer.clearLayers(); if (map.hasLayer(ringsLayer)) map.removeLayer(ringsLayer); }
  function drawRings(f) {
    ringsLayer.clearLayers();
    const radii = riskRadii(f).slice().sort((a, b) => (b.radius_mi || 0) - (a.radius_mi || 0)); // largest first
    radii.forEach(rd => {
      const st = RISK_RING[rd.risk_type] || RISK_RING.lower; if (!rd.radius_mi) return;
      L.circle([f.lat, f.lon], { radius: rd.radius_mi * MI_M, pane: RING_PANE, interactive: false,
        stroke: true, color: st.color, weight: st.weight, opacity: 0.85,
        fill: !!st.fill, fillColor: st.fill || st.color, fillOpacity: st.fillOpacity, dashArray: st.dash || null }).addTo(ringsLayer);
    });
    if (radii.length && !map.hasLayer(ringsLayer)) ringsLayer.addTo(map);
  }
  let ringsOn = true;
  map.on("popupopen", e => { const f = e.popup && e.popup._source && e.popup._source._fac; if (ringsOn && f) drawRings(f); });
  map.on("popupclose", clearRings);

  // ---------- facility markers: size by air pounds, color by dominant toxic-air risk type ----------
  const RISK_MARK = {
    cancer:    { color: "#6a1b9a", fill: "#ab47bc" },
    acute:     { color: "#b71c1c", fill: "#ef5350" },
    noncancer: { color: "#e65100", fill: "#fb8c00" },
    lower:     { color: "#6B7280", fill: "#AEB6BF" }
  };
  function facStyle(f) {
    let r;
    if (f.releases_lbs != null) r = Math.max(4, 4 + 8 * Math.sqrt(Math.min(f.releases_lbs, 7.2e6) / 7.2e6));
    else r = (f.sources || []).includes("RMP") ? 4.5 : 3;
    const rm = f.dominant_risk_type && RISK_MARK[f.dominant_risk_type];        // chemical-classified TRI plants
    if (rm) return { color: rm.color, fill: rm.fill, r };
    if (f.releases_lbs != null) { const big = f.releases_lbs >= 1e6; return { color: big ? "#7B1E1E" : "#9B2C2C", fill: big ? "#C0392B" : "#E05353", r }; }
    if ((f.sources || []).includes("RMP")) return { color: "#B45309", fill: "#DD6B20", r };       // RMP context
    return { color: "#6B7280", fill: "#AEB6BF", r };                                              // OSM / other context
  }
  const RISK_LABEL = { cancer: "cancer-potency weighted", acute: "acute hazard", noncancer: "chronic noncancer", lower: "lower / unclassified" };
  const RISK_BG = { cancer: "#6a1b9a", acute: "#b71c1c", noncancer: "#e65100", lower: "#6B7280" };
  const riskBadge = rt => rt ? '<span class="badge" style="background:' + (RISK_BG[rt] || "#6B7280") + ';color:#fff;margin-left:4px">' + esc(RISK_LABEL[rt] || rt) + '</span>' : "";
  const brkLine = c => '· ' + esc(c.name) + ' <span style="color:#5A6472">— ' + (c.air_lbs != null ? lbs(c.air_lbs) + ' lb air' : '')
    + (c.score != null ? ' · score ' + c.score : '') + '</span>';
  function chemLine(c) {
    const parts = [];
    if (c.air_lbs != null) parts.push(lbs(c.air_lbs) + " lb air");
    if (c.total_lbs != null && c.air_lbs != null && c.total_lbs > c.air_lbs) parts.push(lbs(c.total_lbs) + " total");
    if (c.risk_family) parts.push(esc(c.risk_family));
    const sc = [];                                   // compact cancer / noncancer / acute scores
    if (c.cancer_potency_score != null) sc.push("C" + c.cancer_potency_score);
    if (c.noncancer_inhalation_score != null) sc.push("N" + c.noncancer_inhalation_score);
    if (c.acute_hazard_score != null) sc.push("A" + c.acute_hazard_score);
    let s = '· ' + esc(c.name) + ' <span style="color:#5A6472">— ' + parts.join(" · ") + (sc.length ? " · " + sc.join(" ") : "") + '</span>';
    if (c.risk_notes) s += '<br><span class="mut" style="font-size:10px;margin-left:8px">' + esc(c.risk_notes) + '</span>';
    return s;
  }
  function facPopup(f) {
    let h = '<div class="pop"><b>⚠ ' + esc(f.name || "Facility") + '</b>';
    const ks = (f.kind && f.sector && f.kind !== f.sector) ? esc(f.kind) + " · " + esc(f.sector) : esc(f.sector || f.kind || "");
    if (ks) h += '<div class="row">' + ks + '</div>';
    if (f.sources && f.sources.length) h += '<div class="row">Sources: ' + esc(srcLabel(f.sources)) + '</div>';
    const airv = f.air_lbs != null ? f.air_lbs : f.releases_lbs;
    if (airv != null) h += '<div class="row"><b>2024 TRI air releases: ' + lbs(airv) + ' lb</b>'
      + (f.total_lbs != null && f.total_lbs > airv ? ' <span style="color:#5A6472">· total ' + lbs(f.total_lbs) + ' lb</span>' : '') + '</div>';
    if (f.ldeq_air_emissions_tpy != null) h += '<div class="row">LDEQ ERIC air emissions: ' + Number(f.ldeq_air_emissions_tpy).toLocaleString() + ' tpy</div>';
    if (f.npdes_dmr_pounds != null) h += '<div class="row">NPDES/DMR discharge context: ' + lbs(f.npdes_dmr_pounds) + ' lb</div>';

    const brk = f.chemical_risk_breakdown;
    if (f.facility_toxicity_score != null || brk) {
      h += '<div class="row" style="margin-top:4px"><b>Toxic-air screening:</b> '
        + (f.facility_toxicity_score != null ? '<b>' + Math.round(f.facility_toxicity_score) + '</b>/100' : '')
        + riskBadge(f.dominant_risk_type) + '</div>';
      if (f.dominant_chemical) h += '<div class="row" style="font-size:11px;color:#5A6472">dominant: ' + esc(f.dominant_chemical) + '</div>';
      const tc = (brk && brk.top_cancer_chemicals) || [];
      if (tc.length) h += '<div class="row" style="font-size:11px"><span style="color:#6a1b9a;font-weight:700">Cancer-potency weighted:</span><br>'
        + tc.slice(0, 4).map(brkLine).join('<br>') + '</div>';
      const ta = (brk && brk.top_acute_chemicals) || [];
      if (ta.length) h += '<div class="row" style="font-size:11px"><span style="color:#b71c1c;font-weight:700">Acute / respiratory hazards:</span><br>'
        + ta.slice(0, 4).map(brkLine).join('<br>') + '</div>';
      const byAir = (f.chemicals || []).slice().sort((a, b) => (b.air_lbs || 0) - (a.air_lbs || 0)).slice(0, 4);
      if (byAir.length) h += '<div class="row" style="font-size:11px"><span style="color:#5A6472;font-weight:700">Largest air releases:</span><br>'
        + byAir.map(chemLine).join('<br>') + '</div>';
    } else if (f.chemical_summary) {
      const s = f.chemical_summary;
      const cd = (s.top_cancer_drivers || []).filter(d => (d.cancer_weight || 0) > 0);
      h += '<div class="row" style="margin-top:4px"><b>Chemical burden</b></div>';
      if (cd.length) h += '<div class="row" style="font-size:11px"><span style="color:#6a1b9a;font-weight:700">Cancer-relevant:</span><br>'
        + cd.map(d => '· ' + esc(d.name) + ' <span style="color:#5A6472">— ' + lbs(d.air_lbs) + ' lb air</span>').join('<br>') + '</div>';
      const am = s.top_air_mass_drivers || [];
      if (am.length) h += '<div class="row" style="font-size:11px"><span style="color:#5A6472;font-weight:700">Top by air mass:</span><br>'
        + am.map(d => '· ' + esc(d.name) + ' <span style="color:#5A6472">— ' + lbs(d.air_lbs) + ' lb</span>').join('<br>') + '</div>';
    } else if (Array.isArray(f.chemicals) && f.chemicals.length) {
      h += '<div class="row" style="font-size:11px"><b>Top chemicals (2024 TRI):</b><br>'
        + f.chemicals.slice(0, 5).map(c => '· ' + esc(c.name) + ' — ' + lbs(c.total_lbs) + ' lb').join('<br>') + '</div>';
    }
    return h + '</div>';
  }
  const facPane = (BRMap.panes && BRMap.panes.facils) || undefined;
  const renderer = L.canvas({ pane: facPane, padding: 0.5 });
  const facLayer = L.layerGroup(FAC.map(f => {
    const st = facStyle(f);
    const m = L.circleMarker([f.lat, f.lon], { renderer, radius: st.r, color: st.color, weight: 1, fillColor: st.fill, fillOpacity: 0.75 })
      .bindPopup(() => facPopup(f));
    m._fac = f;                                     // lets popupopen draw this plant's exposure rings
    m._baseR = st.r;                                // base radius; grows with zoom (see sizeFacilities)
    return m;
  }));
  // facility dots grow as you zoom in so they're easy to see and click
  const facBonus = () => Math.max(0, Math.min(10, (map.getZoom() - 12) * 1.8));
  const sizeFacilities = () => facLayer.eachLayer(m => { if (m.setRadius && m._baseR != null) m.setRadius(m._baseR + facBonus()); });
  map.on("zoomend", () => { if (map.hasLayer(facLayer)) sizeFacilities(); });
  const nTRI = FAC.filter(f => f.releases_lbs != null).length;
  const nLDEQ = FAC.filter(f => f.ldeq_air_emissions_tpy != null).length;
  const nRMP = FAC.filter(f => f.releases_lbs == null && (f.sources || []).includes("RMP")).length;
  const nNPDES = FAC.filter(f => (f.sources || []).includes("NPDES")).length;
  const nOSM = FAC.filter(f => f.releases_lbs == null && !(f.sources || []).includes("RMP") && (f.sources || []).includes("OSM")).length;
  const nHiddenContext = FAC_ALL.length - FAC.length;

  const sec = BRMap.section("air", "Pollution / industrial proximity");
  sec.insertAdjacentHTML("beforeend",
    '<label><input type="checkbox" id="polFac"> Industrial / chemical / petroleum sites</label>' +
    '<div class="legend" style="margin-top:3px"><span class="sw" style="width:100%;color:#333;font-weight:700">Toxic-air screening type (sized by air lbs)</span>' +
      '<span class="sw"><i style="background:#ab47bc"></i>cancer-potency</span>' +
      '<span class="sw"><i style="background:#ef5350"></i>acute hazard</span>' +
      '<span class="sw"><i style="background:#fb8c00"></i>noncancer</span>' +
      '<span class="sw"><i style="background:#AEB6BF"></i>lower / context</span></div>' +
    '<div class="mut">' + nTRI + ' TRI · ' + nLDEQ + ' LDEQ · ' + nRMP + ' RMP · ' + nNPDES + ' NPDES · '
      + nOSM + ' OSM-matched (' + nHiddenContext + ' more hidden by default).</div>' +
    '<label style="margin-top:7px"><input type="checkbox" id="polRings" checked> Screening-radius rings (click a plant)</label>' +
    '<div class="mut" style="margin-left:18px">From each plant\'s reported chemicals: purple = cancer-potency · amber = chronic noncancer · dashed red = acute hazard.</div>');

  const facEl = document.getElementById("polFac");
  if (facEl) facEl.onchange = e => { if (e.target.checked) { facLayer.addTo(map); sizeFacilities(); } else { map.removeLayer(facLayer); clearRings(); } };
  const ringsEl = document.getElementById("polRings");
  if (ringsEl) ringsEl.onchange = e => { ringsOn = e.target.checked; if (!ringsOn) clearRings(); };
});
