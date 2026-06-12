/* POLLUTION module — owned by the "air" chat.
   Editable files (map_site/): air_layer.js, air.json (+ pollution_facilities.json, pollution_metadata.json).

   Focus: "Cancer Alley"-type toxic-air screening — TRI air releases, LDEQ ERIC air emissions,
   AirToxScreen/AirData context, RMP hazardous-chemical sites, modeled dispersion footprints.
   FRS-only / OSM-only records ("no emission data") are hidden by default.

   Registers (shell API):
     • addArea "Pollution"  : a single map overlay. When selected it shows the industrial/chemical
        plant dots and exposes its nested controls (emissions heat map, dispersion-footprint plumes
        with cancer-level selector, "sites with no emission data"). Plant popups show a calm,
        summary-first chemical breakdown; footprints draw on popup open.
     • addColorMode "Pollution burden" : tints listing pins by the relative proximity score.
     • a per-listing popup row (plain-language proximity + nearby sites with their specific risk).

   The score is a relative screening signal, not a measured concentration or personal health estimate.
   Plume footprints are MODELED wind-rose Gaussian contours from reported releases + chemical
   toxicity thresholds — not measured plumes. Data (polygons, radii, scores) comes from air.json. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const A = await BRMap.fetchJSON("air.json");
  if (!A || !A.listings) return;                                  // no-op gracefully when air.json is absent

  const LI = A.listings;
  let FAC = Array.isArray(A.facilities) ? A.facilities : null;
  if (!FAC || !FAC.length) FAC = (await BRMap.fetchJSON("pollution_facilities.json")) || [];
  const FAC_ALL = FAC.filter(f => f && f.lat != null && f.lon != null);
  const FAC_VIS = FAC_ALL.filter(f => f.default_visible !== false);
  const FAC_HID = FAC_ALL.filter(f => f.default_visible === false);
  const normName = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const FACBYNAME = {};
  FAC_ALL.forEach(f => { const k = normName(f.name); if (k && !(k in FACBYNAME)) FACBYNAME[k] = f; });

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const col = s => s >= 66 ? "#C0392B" : s >= 33 ? "#CC7A1C" : "#2E7D46";   // listing proximity score
  const miFmt = v => v == null ? "" : (v < 10 ? Number(v).toFixed(1) : String(Math.round(v)));
  const lbs = v => Math.round(v).toLocaleString();
  const tpy = v => v >= 1 ? Math.round(v).toLocaleString() : "<1";

  // ---- plain-language source labels (replaces raw acronym dumps) ----
  const SRCLBL = { TRI: "EPA toxic-release inventory (TRI)", LDEQ: "Louisiana air emissions (LDEQ)",
    RMP: "hazardous-chemical accident plan (RMP)", RCRAInfo: "hazardous-waste records (RCRA)",
    NPDES: "industrial water discharge (NPDES)", ECHO_CAA: "Clean Air Act compliance",
    FRS: "EPA facility registry (FRS)", OSM: "OpenStreetMap" };
  const SRC_ORDER = ["TRI", "LDEQ", "RMP", "RCRAInfo", "NPDES", "ECHO_CAA", "OSM", "FRS"];
  const srcPlain = s => (s || []).slice().sort((a, b) => SRC_ORDER.indexOf(a) - SRC_ORDER.indexOf(b))
    .map(x => SRCLBL[x] || x).join(" · ");
  // LDEQ-ID-only facilities have no business name in the data; label them clearly.
  const prettyFac = n => { const m = /^LDEQ Facility (\d+)$/.exec(String(n || "")); return m ? "Louisiana air-emissions site (LDEQ #" + m[1] + ")" : esc(n); };

  // ---- calm risk palette (muted) ----
  const RISK = { cancer: { c: "#7B3FA0", bg: "#7B3FA01F", tx: "#5E2C7C" }, acute: { c: "#C0392B", bg: "#C0392B1F", tx: "#8E2A20" },
    noncancer: { c: "#CC7A1C", bg: "#CC7A1C24", tx: "#8A5212" }, lower: { c: "#8A93A0", bg: "#8A93A01F", tx: "#566070" } };
  const rc = rt => (RISK[rt] || RISK.lower).c;

  // ---- inject popup styles once (air- prefixed, scoped under .pop, no collision with shell) ----
  if (!document.getElementById("airpopcss")) {
    document.head.insertAdjacentHTML("beforeend", '<style id="airpopcss">' + [
      '.pop .air-name{font-size:14px;font-weight:700}',
      '.pop .air-sub{color:#566070;font-size:12px;margin-top:2px}',
      '.pop .air-src{color:#7C8694;font-size:11px;margin-top:3px}',
      '.pop .air-score{display:flex;align-items:center;gap:11px;margin-top:10px}',
      '.pop .air-score b.n{font-size:27px;font-weight:800;line-height:1;letter-spacing:-1px}',
      '.pop .air-score b.n small{font-size:12px;font-weight:600;color:#7C8694}',
      '.pop .air-score .m{flex:1}',
      '.pop .air-score .lbl{font-size:11px;color:#566070;font-weight:600}',
      '.pop .air-gauge{height:7px;border-radius:5px;background:#ECEFF3;margin-top:5px;overflow:hidden}',
      '.pop .air-gauge>i{display:block;height:100%;border-radius:5px}',
      '.pop .air-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}',
      '.pop .air-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;border-radius:20px;padding:2px 9px}',
      '.pop .air-badge i{width:7px;height:7px;border-radius:50%;border:none}',
      '.pop .air-head{margin-top:9px;font-size:12px;line-height:1.5;color:#26303B}',
      '.pop .air-rel{margin-top:7px;font-size:12px;color:#3A434F}',
      '.pop .air-drv{margin-top:11px;border-top:1px solid #EEF1F5;padding-top:9px}',
      '.pop .air-drv .hd{font-size:10.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#3A434F;margin-bottom:6px}',
      '.pop .air-row{display:grid;grid-template-columns:10px 1fr auto;align-items:center;gap:8px;margin:6px 0}',
      '.pop .air-row .dot{width:9px;height:9px;border-radius:50%;justify-self:center}',
      '.pop .air-row .nm{font-size:12px;font-weight:600;color:#26303B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pop .air-row .bar{height:6px;border-radius:4px;background:#ECEFF3;margin-top:3px;overflow:hidden}',
      '.pop .air-row .bar>i{display:block;height:100%;border-radius:4px}',
      '.pop .air-row .rt{font-size:11px;color:#566070;text-align:right;white-space:nowrap}',
      '.pop .air-row .rt b{color:#26303B;font-size:12px}',
      '.pop .air-cl{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:8px 0;align-items:baseline}',
      '.pop .air-cl .nm{font-size:12px;font-weight:600;color:#26303B;display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
      '.pop .air-cl .meta{font-size:11px;color:#566070;text-align:right;white-space:nowrap}',
      '.pop .air-cl .meta b{color:#26303B}',
      '.pop .air-cl .bw{grid-column:1/3;height:5px;border-radius:3px;background:#ECEFF3;overflow:hidden;margin-top:1px}',
      '.pop .air-cl .bw>i{display:block;height:100%;border-radius:3px}',
      '.pop .air-cl .nt{grid-column:1/3;font-size:10px;color:#7C8694;margin-top:1px}',
      '.pop .air-gsub{font-size:10px;color:#7C8694;font-weight:600;margin:-2px 0 5px}',
      '.pop .air-tag{font-size:9.5px;font-weight:700;border-radius:5px;padding:1px 6px}',
      '.pop details.grp>summary .ct{font-size:9.5px;font-weight:700;color:#fff;border-radius:10px;padding:0 6px;min-width:15px;text-align:center}',
      '.pop details.grp>summary .chev{margin-left:auto}',
      '.pop .air-i{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid #C7CDD6;color:#7A828D;font-size:9px;font-weight:700;cursor:help;position:relative;vertical-align:middle}',
      '.pop .air-i .tip{position:absolute;bottom:140%;left:50%;transform:translateX(-50%);background:#262C36;color:#fff;font-size:10px;font-weight:500;line-height:1.45;border-radius:7px;padding:6px 9px;width:182px;text-align:left;opacity:0;visibility:hidden;transition:opacity .12s;z-index:30;box-shadow:0 4px 14px rgba(0,0,0,.28);pointer-events:none}',
      '.pop .air-i:hover .tip{opacity:1;visibility:visible}',
      '.pop .air-i .tip .k{color:#AEB6BF}',
      '.pop .air-about{font-size:10px;color:#7C8694;line-height:1.5;margin-top:6px}',
      '.pop .air-fp .ttl{font-weight:700;font-size:11px}',
      '.pop .air-nb{padding:6px 0;border-bottom:1px solid #EEF1F5;cursor:pointer}',
      '.pop .air-nb:last-child{border-bottom:none}',
      '.pop .air-nb .top{display:flex;align-items:center;gap:7px;font-size:12px}',
      '.pop .air-nb .top i{width:8px;height:8px;border-radius:50%;border:none;flex:none}',
      '.pop .air-nb .top .nm{flex:1;font-weight:600;color:#26303B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.pop .air-nb .top .d{color:#566070;font-size:11px;white-space:nowrap}',
      '.pop .air-nb .risk{font-size:10px;color:#566070;margin-left:15px;margin-top:1px;line-height:1.35}'
    ].join("") + '</style>');
  }

  // chemical lookup helpers
  const chemByName = f => { const m = {}; (f.chemicals || []).forEach(c => { if (c.name) m[normName(c.name)] = c; }); return m; };
  function carcTagFor(c) {
    if (!c) return "";
    const k = c.carc_class || (c.carcinogen ? "known" : "");
    if (k === "known") return '<span class="air-tag" style="background:' + RISK.cancer.bg + ';color:' + RISK.cancer.tx + '">known carcinogen</span>';
    if (k === "suspected" || k === "probable") return '<span class="air-tag" style="background:#7B3FA014;color:#6F5C80">suspected carcinogen</span>';
    return "";
  }
  function chemTip(c) {
    if (!c) return "";
    const parts = [];
    if (c.cancer_potency_score != null) parts.push("cancer-potency <b>" + c.cancer_potency_score + "</b>");
    if (c.noncancer_inhalation_score != null) parts.push("chronic-noncancer <b>" + c.noncancer_inhalation_score + "</b>");
    if (c.acute_hazard_score != null) parts.push("acute <b>" + c.acute_hazard_score + "</b>");
    if (!parts.length) return "";
    return '<span class="air-i">i<span class="tip"><span class="k">Relative scores 0–100 (higher = more hazardous per pound)</span><br>'
      + parts.join(" · ") + (c.category ? '<br><span class="k">EPA category:</span> ' + esc(c.category) : "") + '</span></span>';
  }

  // ---------- per-listing popup row (plain language + nearby sites with their specific risk) ----------
  BRMap.addPopupRow(l => {
    const a = LI[l.address];
    if (!a || a.score == null) return '<div class="row mut">Pollution data unavailable.</div>';
    const c = col(a.score);
    let h = '<div class="row"><b style="color:' + c + '">' + esc(a.label) + ' pollution proximity</b>'
      + ' <span style="color:#566070">· score ' + Math.round(a.score) + '/100</span></div>'
      + '<div class="air-gauge" style="margin:4px 0 6px"><i style="width:' + Math.round(a.score) + '%;background:' + c + '"></i></div>';
    if (a.nearest_facility_name) h += '<div class="row" style="font-size:11.5px;color:#566070">Nearest industrial site: <b style="color:#26303B">'
      + prettyFac(a.nearest_facility_name) + '</b>' + (a.nearest_facility_mi != null ? ' · ' + miFmt(a.nearest_facility_mi) + ' mi' : '') + '</div>';
    const nf = (a.nearby_facilities || []).slice(0, 5);
    if (nf.length) {
      h += '<div class="row" style="font-size:11px"><span style="color:#566070;font-weight:600">Nearby industrial &amp; emission sites:</span>'
        + nf.map(f => {
          const full = FACBYNAME[normName(f.name)] || {};
          const rt = full.dominant_risk_type || "lower";
          const bits = [];
          if (full.dominant_chemical) { let dx = esc(full.dominant_chemical); if (full.dominant_risk_type) dx += " · " + esc(full.dominant_risk_type); if (full.facility_toxicity_score != null) dx += " · hazard " + Math.round(full.facility_toxicity_score); bits.push(dx); }
          else if (f.releases_lbs != null) bits.push("Toxic air " + lbs(f.releases_lbs) + " lb (chemicals not itemized)");
          else if (f.ldeq_air_emissions_tpy != null) bits.push("Air emissions " + tpy(f.ldeq_air_emissions_tpy) + " tons/yr");
          else if (f.npdes_dmr_pounds != null) bits.push("Industrial water discharge " + lbs(f.npdes_dmr_pounds) + " lb");
          else if ((f.sources || []).includes("RMP")) bits.push("Hazardous-chemical accident-risk plan");
          else bits.push(srcPlain(f.sources) || "registry site");
          return '<div class="air-nb"><div class="top"><i style="background:' + rc(rt) + '"></i><span class="nm">' + prettyFac(f.name)
            + '</span><span class="d">' + miFmt(f.distance_mi) + ' mi</span></div><div class="risk">' + bits.join("") + '</div></div>';
        }).join("") + '</div>';
    }
    return h;
  }, "env");

  // ---------- at-a-glance summary chip (listing panel) ----------
  if (typeof BRMap.addSummaryChip === "function") {
    BRMap.addSummaryChip(l => { const a = LI[l.address]; return (a && a.score != null) ? { label: "Pollution", value: a.label, color: col(a.score) } : null; });
  }

  // ---------- color mode: tint pins by relative proximity score ----------
  if (typeof BRMap.addColorMode === "function") {
    BRMap.addColorMode({
      id: "pollution", label: "Pollution burden",
      colorFor: l => { const a = LI[l.address]; return a && a.score != null ? col(a.score) : undefined; },
      legend: '<span class="sw"><i style="background:#2E7D46"></i>Lower</span>'
        + '<span class="sw"><i style="background:#CC7A1C"></i>Moderate</span>'
        + '<span class="sw"><i style="background:#C0392B"></i>Higher</span>'
    });
  }

  // ---------- emissions heat layer (release pounds) — toggled inside the Pollution overlay ----------
  const emitters = FAC_VIS.filter(f => f.releases_lbs != null && f.releases_lbs > 0);
  let heat = null;
  const heatAvailable = typeof L.heatLayer === "function" && emitters.length;
  if (heatAvailable) {
    const lmax = Math.log10(Math.max.apply(null, emitters.map(f => f.releases_lbs)) + 1);
    const pts = emitters.map(f => [f.lat, f.lon, Math.max(0.1, Math.log10(f.releases_lbs + 1) / lmax)]);
    const GRAD = { 0.0: "#ffd24d", 0.3: "#ff9100", 0.55: "#f4511e", 0.75: "#d32f2f", 0.9: "#b71c1c", 1.0: "#6d0000" };
    heat = L.heatLayer(pts, { radius: 26, blur: 16, max: 2.2, minOpacity: 0.28, gradient: GRAD, pane: BRMap.panes && BRMap.panes.heat });
  }

  // ---------- dispersion footprints (PRESERVED from the air-quality plume work) ----------
  // Modeled wind-rose Gaussian footprints (risk_footprints[]) from reported releases + per-chemical
  // toxicity thresholds. Drawn on facility-popup open as polygons; circular risk_radii[] fallback.
  // Cancer footprints honor the selected plume level (1e-6 / 1e-5 / 1e-4). Not measured plumes.
  const FP_PANE = (BRMap.panes && BRMap.panes.areas) || undefined, MI_M = 1609.344;
  const FP_STYLE = {
    cancer:    { color: "#7B3FA0", fill: "#ab47bc", fillOpacity: 0.14, weight: 2, dash: null },
    noncancer: { color: "#CC7A1C", fill: "#fb8c00", fillOpacity: 0.11, weight: 1.5, dash: null },
    acute:     { color: "#C0392B", fill: "#ef5350", fillOpacity: 0.08, weight: 2, dash: "7,5" },
    lower:     { color: "#9aa3ad", fill: "#cfd5dc", fillOpacity: 0.06, weight: 1, dash: "2,6" }
  };
  const fpStyle = rt => FP_STYLE[rt] || FP_STYLE.lower;
  const CANCER_LEVELS = ["1e-6", "1e-5", "1e-4"];
  const CANCER_LEVEL_LABEL = { "1e-6": "1 in 1M", "1e-5": "10 in 1M", "1e-4": "100 in 1M" };
  const NONCANCER_LEVELS = ["HQ1", "HQ10", "HQ100"];
  const NONCANCER_LEVEL_LABEL = { HQ1: "HQ 1", HQ10: "HQ 10", HQ100: "HQ 100" };
  // fill intensity by band_index: 0 = outer / least-severe (faint) … 2 = inner / most-severe (strong)
  const BAND_FILL = { 0: 0.08, 1: 0.16, 2: 0.28 };
  const HAS_NONCANCER_FP = FAC_ALL.some(f => (f.risk_footprints || []).some(fp => fp.risk_type === "noncancer"));
  const WIND_SRC = (A.chemical_risk_methodology && A.chemical_risk_methodology.wind_rose_source) || "";
  const WIND_IS_FALLBACK = /fallback/i.test(WIND_SRC);
  let selCancer = "1e-5";
  let selNoncancer = "HQ1";
  let openMarker = null;
  // a footprint is "active" when its level matches the current selection for its risk_type
  function levelMatch(fp) {
    if (fp.risk_type === "cancer") return fp.level === selCancer;
    if (fp.risk_type === "noncancer") return fp.level == null || fp.level === selNoncancer;
    return true;   // acute / other: no level filter — drawn whenever the band is present
  }
  // outer bands (band_index 0) render fainter than inner bands (higher index); never hardcode distance
  function fillFor(fp, st) {
    return (fp.band_index != null && BAND_FILL[fp.band_index] != null) ? BAND_FILL[fp.band_index] : st.fillOpacity;
  }
  const KIND_TO_RISK = { chronic_cancer: "cancer", chronic_noncancer: "noncancer", acute_accident: "acute" };
  function footprintsFor(f) { return Array.isArray(f.risk_footprints) && f.risk_footprints.length ? f.risk_footprints : null; }
  function fallbackRadii(f) {
    if (Array.isArray(f.risk_radii) && f.risk_radii.length) return f.risk_radii;
    const sr = f.chemical_summary && f.chemical_summary.screening_radii;
    return Array.isArray(sr) ? sr.map(r => ({ chemical: r.chemical, radius_mi: r.radius_mi, risk_type: KIND_TO_RISK[r.kind] || "lower" })) : [];
  }
  const fpLayer = L.layerGroup();
  function clearFootprints() { fpLayer.clearLayers(); if (map.hasLayer(fpLayer)) map.removeLayer(fpLayer); }
  function drawFootprints(f) {
    fpLayer.clearLayers();
    const fps = footprintsFor(f);
    if (fps) {
      fps.filter(levelMatch)
        .slice().sort((a, b) => (b.peak_mi || 0) - (a.peak_mi || 0)).forEach(fp => {
        if (!fp.geometry) return;
        const st = fpStyle(fp.risk_type);
        const fillOpacity = fillFor(fp, st);
        L.geoJSON(fp.geometry, { pane: FP_PANE, interactive: false,
          style: { stroke: true, color: st.color, weight: st.weight, opacity: 0.85, fill: true, fillColor: st.fill, fillOpacity, dashArray: st.dash || null } }).addTo(fpLayer);
      });
    } else {
      fallbackRadii(f).slice().sort((a, b) => (b.radius_mi || 0) - (a.radius_mi || 0)).forEach(rd => {
        if (!rd.radius_mi) return;
        const st = fpStyle(rd.risk_type);
        L.circle([f.lat, f.lon], { radius: rd.radius_mi * MI_M, pane: FP_PANE, interactive: false,
          stroke: true, color: st.color, weight: st.weight, opacity: 0.85, fill: true, fillColor: st.fill, fillOpacity: st.fillOpacity, dashArray: st.dash || null }).addTo(fpLayer);
      });
    }
    if (fpLayer.getLayers().length && !map.hasLayer(fpLayer)) fpLayer.addTo(map);
  }
  let footprintsOn = true;
  // facility footprints are driven by the fixed left panel (openFacPanel / closeFacPanel), not Leaflet popups,
  // so the popup never covers the plumes it describes.

  // footprint detail block for the facility popup (cancer level honors selCancer)
  const thrFmt = v => { const n = Number(v); return n >= 0.01 ? n.toPrecision(3).replace(/\.?0+$/, "") : n.toExponential(2); };
  function footprintRows(f) {
    const fps = footprintsFor(f);
    if (fps) {
      const shown = fps.filter(levelMatch)
        .slice().sort((a, b) => (b.peak_mi || 0) - (a.peak_mi || 0));
      if (!shown.length) return "";
      return '<div class="row air-fp" style="font-size:11px"><span class="ttl">On the map now:</span><br>'
        + shown.map(fp => {
          const bits = [esc(fp.chemical), esc(fp.risk_type)];
          if (fp.risk_type === "cancer" && CANCER_LEVEL_LABEL[fp.level]) bits.push(CANCER_LEVEL_LABEL[fp.level]);
          else if (fp.risk_type === "noncancer" && NONCANCER_LEVEL_LABEL[fp.level]) bits.push(NONCANCER_LEVEL_LABEL[fp.level]);
          else if (fp.level) bits.push(esc(fp.level));
          if (fp.peak_mi != null) bits.push("reaches " + Number(fp.peak_mi).toFixed(2) + " mi");
          if (fp.downwind_bearing_deg != null) bits.push("downwind " + Math.round(fp.downwind_bearing_deg) + "°");
          let s = '· ' + bits.join(" · ");
          const sub = [];
          if (fp.threshold_ug_m3 != null) sub.push("threshold " + thrFmt(fp.threshold_ug_m3) + " µg/m³");
          if (fp.averaging) sub.push(esc(fp.averaging) + " wind-rose Gaussian contour");
          else if (fp.source_model) sub.push(esc(fp.source_model));
          if (fp.basis) sub.push(esc(fp.basis));
          if (sub.length) s += '<br><span class="mut" style="font-size:10px;margin-left:8px">' + sub.join(" · ") + '</span>';
          return s;
        }).join("<br>") + '</div>';
    }
    const radii = fallbackRadii(f);
    if (radii.length) {
      return '<div class="row air-fp" style="font-size:11px"><span class="ttl">On the map now (estimated reach circles):</span><br>'
        + radii.slice().sort((a, b) => (b.radius_mi || 0) - (a.radius_mi || 0)).map(rd =>
          '· ' + esc(rd.chemical) + ' · ' + esc(rd.risk_type) + ' · ' + miFmt(rd.radius_mi) + ' mi').join("<br>") + '</div>';
    }
    return "";
  }

  // ---------- facility markers: size by air pounds, color by dominant risk type ----------
  const RISK_MARK = { cancer: { color: "#7B3FA0", fill: "#ab47bc" }, acute: { color: "#C0392B", fill: "#ef5350" },
    noncancer: { color: "#CC7A1C", fill: "#fb8c00" }, lower: { color: "#6B7280", fill: "#AEB6BF" } };
  function facStyle(f) {
    let r;
    if (f.releases_lbs != null) r = Math.max(4, 4 + 8 * Math.sqrt(Math.min(f.releases_lbs, 7.2e6) / 7.2e6));
    else r = (f.sources || []).includes("RMP") ? 4.5 : 3;
    const rm = f.dominant_risk_type && RISK_MARK[f.dominant_risk_type];
    if (rm) return { color: rm.color, fill: rm.fill, r };
    if (f.releases_lbs != null) { const big = f.releases_lbs >= 1e6; return { color: big ? "#7B1E1E" : "#9B2C2C", fill: big ? "#C0392B" : "#E05353", r }; }
    if ((f.sources || []).includes("RMP")) return { color: "#B45309", fill: "#DD6B20", r };
    return { color: "#6B7280", fill: "#AEB6BF", r };
  }

  // ---------- redesigned facility popup (summary-first, progressive disclosure) ----------
  function badgesFor(f) {
    const ch = f.chemicals || [];
    const out = [];
    if (ch.some(c => (c.carc_class === "known") || (c.carcinogen && !c.carc_class)))
      out.push('<span class="air-badge" style="background:' + RISK.cancer.bg + ';color:' + RISK.cancer.tx + '"><i style="background:' + RISK.cancer.c + '"></i>known carcinogen</span>');
    if (ch.some(c => (c.category === "acute_toxic_gas" || c.category === "acid_gas_or_irritant") && (c.acute_hazard_score || 0) >= 75))
      out.push('<span class="air-badge" style="background:' + RISK.acute.bg + ';color:' + RISK.acute.tx + '"><i style="background:' + RISK.acute.c + '"></i>acute toxic gas / irritant</span>');
    if (ch.some(c => (c.noncancer_inhalation_score || 0) >= 80))
      out.push('<span class="air-badge" style="background:' + RISK.noncancer.bg + ';color:' + RISK.noncancer.tx + '"><i style="background:' + RISK.noncancer.c + '"></i>respiratory irritant</span>');
    return out.slice(0, 3).join("");
  }
  function headlineFor(f) {
    const ch = f.chemicals || [];
    const carc = ch.filter(c => c.carc_class === "known" || c.carc_class === "suspected" || c.carcinogen)
      .sort((a, b) => (b.cancer_potency_score || 0) - (a.cancer_potency_score || 0) || (b.air_lbs || 0) - (a.air_lbs || 0));
    const acuteGas = ch.some(c => (c.category === "acute_toxic_gas" || c.category === "acid_gas_or_irritant") && (c.acute_hazard_score || 0) >= 70);
    if (carc.length) {
      const names = carc.slice(0, 2).map(c => esc(c.name));
      const allKnown = carc.slice(0, 2).every(c => c.carc_class === "known" || (c.carcinogen && !c.carc_class));
      const note = allKnown ? "known carcinogens" : "carcinogens";
      let s = "The score is highest here because of <b>" + names.join("</b> and <b>") + "</b> (" + note + ")";
      s += acuteGas ? ", plus acid-gas and respiratory releases." : ".";
      return s;
    }
    if (f.dominant_chemical) return "The score reflects mostly <b>" + esc(f.dominant_chemical) + "</b>"
      + (acuteGas ? " and other acid-gas / respiratory releases." : ".");
    return "Relative pollution-source proximity for this plant.";
  }
  function driverRow(d, f, lookup) {
    const c = lookup[normName(d.name)];
    const rt = (c && c.dominant_risk_type) || (c && c.risk_family && /carcin/i.test(c.risk_family) ? "cancer" : "lower");
    const color = rc(rt);
    const w = Math.max(4, Math.min(100, d.score != null ? d.score : 4));
    return '<div class="air-row"><span class="dot" style="background:' + color + '"></span>'
      + '<div style="min-width:0"><div class="nm">' + esc(d.name) + ' ' + chemTip(c) + '</div>'
      + '<div class="bar"><i style="width:' + w + '%;background:' + color + '"></i></div></div>'
      + '<div class="rt"><b>' + (d.score != null ? d.score : "") + '</b><br>' + (d.air_lbs != null ? lbs(d.air_lbs) + " lb" : "") + '</div></div>';
  }
  function chemRowOf(d, scaleBy, lookup, maxAir) {
    const c = lookup[normName(d.name)] || {};
    const rt = c.dominant_risk_type || "lower";
    const color = rc(rt);
    const air = d.air_lbs != null ? d.air_lbs : c.air_lbs;
    const score = d.score != null ? d.score : c.overall_toxicity_score;
    const w = scaleBy === "air" ? Math.max(4, (Math.log10((air || 0) + 1) / Math.log10((maxAir || 1) + 1)) * 100) : Math.max(4, Math.min(100, score || 4));
    return '<div class="air-cl"><div class="nm">' + esc(d.name) + ' ' + carcTagFor(c) + chemTip(c) + '</div>'
      + '<div class="meta">' + (air != null ? '<b>' + lbs(air) + '</b> lb air' : '') + (score != null ? ' · ' + score : '') + '</div>'
      + '<div class="bw"><i style="width:' + w + '%;background:' + color + '"></i></div>'
      + (c.risk_family ? '<div class="nt">' + esc(c.risk_family) + '</div>' : '') + '</div>';
  }
  function grp(label, sub, color, rowsHtml, count) {
    return '<details class="grp"><summary><span style="color:' + color + '">' + label + '</span>'
      + (count != null ? '<span class="ct" style="background:' + color + '">' + count + '</span>' : '')
      + '<span class="chev">▸</span></summary><div class="grp-body">'
      + (sub ? '<div class="air-gsub">' + sub + '</div>' : '') + rowsHtml + '</div></details>';
  }
  function facPopup(f) {
    const lookup = chemByName(f);
    const sc = f.facility_toxicity_score;
    const domc = rc(f.dominant_risk_type);
    let h = '<div class="pop"><b class="air-name">⚠ ' + prettyFac(f.name || "Facility") + '</b>';
    const ks = (f.kind && f.sector && f.kind !== f.sector) ? esc(f.kind) + " · " + esc(f.sector) : esc(f.sector || f.kind || "");
    if (ks) h += '<div class="air-sub">' + ks + '</div>';
    if (f.sources && f.sources.length) h += '<div class="air-src">Listed in: ' + srcPlain(f.sources) + '</div>';

    if (sc != null) {
      h += '<div class="air-score"><b class="n" style="color:' + domc + '">' + Math.round(sc) + '<small>/100</small></b>'
        + '<div class="m"><div class="lbl">toxic-air hazard score</div><div class="air-gauge"><i style="width:' + Math.round(sc) + '%;background:' + domc + '"></i></div></div></div>';
      const bdg = badgesFor(f); if (bdg) h += '<div class="air-badges">' + bdg + '</div>';
      h += '<div class="air-head">' + headlineFor(f) + '</div>';
    }
    const airv = f.air_lbs != null ? f.air_lbs : f.releases_lbs;
    if (airv != null) {
      const relTip = '<span class="air-i">i<span class="tip">Self-reported to the EPA Toxics Release Inventory (TRI). “Air” = fugitive leaks + smokestack. The larger figure also counts releases to water and land.</span></span>';
      h += '<div class="air-rel">Reported toxic-air releases, 2024: <b>' + lbs(airv) + ' lb</b> ' + relTip
        + (f.total_lbs != null && f.total_lbs > airv ? ' <span style="color:#7C8694">· incl. water &amp; land ' + lbs(f.total_lbs) + ' lb</span>' : '') + '</div>';
    }
    if (f.ldeq_air_emissions_tpy != null) h += '<div class="air-rel" style="margin-top:4px">Louisiana air emissions: ' + tpy(f.ldeq_air_emissions_tpy) + ' tons/yr</div>';

    const brk = f.chemical_risk_breakdown;
    if (brk && brk.top_overall_chemicals && brk.top_overall_chemicals.length) {
      h += '<div class="air-drv"><div class="hd">Top contributors to the score</div>'
        + brk.top_overall_chemicals.slice(0, 3).map(d => driverRow(d, f, lookup)).join("") + '</div>';
    }
    if (brk) {
      const maxAir = Math.max.apply(null, (f.chemicals || []).map(c => c.air_lbs || 0).concat([1]));
      const tc = brk.top_cancer_chemicals || [];
      if (tc.length) h += grp("Cancer-risk drivers", "Carcinogens, ranked by toxicity × amount released — not just pounds.", RISK.cancer.c,
        tc.slice(0, 6).map(d => chemRowOf(d, "score", lookup, maxAir)).join(""), tc.length);
      const ta = brk.top_acute_chemicals || [];
      if (ta.length) h += grp("Acute &amp; respiratory hazards", "Irritant / toxic-gas releases, ranked by acute hazard.", RISK.acute.c,
        ta.slice(0, 6).map(d => chemRowOf(d, "score", lookup, maxAir)).join(""), ta.length);
      const byAir = (f.chemicals || []).slice().sort((a, b) => (b.air_lbs || 0) - (a.air_lbs || 0)).filter(c => c.air_lbs);
      if (byAir.length) h += grp("Largest air releases", "Ranked by reported pounds of air release.", "#566070",
        byAir.slice(0, 6).map(c => chemRowOf(c, "air", lookup, maxAir)).join(""), byAir.length);
    } else if (Array.isArray(f.chemicals) && f.chemicals.length) {
      const byAir = f.chemicals.slice().sort((a, b) => (b.air_lbs || b.total_lbs || 0) - (a.air_lbs || a.total_lbs || 0));
      const maxAir = Math.max.apply(null, f.chemicals.map(c => c.air_lbs || c.total_lbs || 0).concat([1]));
      h += grp("Chemicals reported", "From the 2024 TRI filing.", "#566070",
        byAir.slice(0, 6).map(c => chemRowOf({ name: c.name, air_lbs: c.air_lbs != null ? c.air_lbs : c.total_lbs }, "air", chemByName(f), maxAir)).join(""), byAir.length);
    }

    // About this score — methodology + the modeled-plume footprint detail (honors cancer level) + calm note
    const fpRows = footprintRows(f);
    h += '<details class="grp"><summary><span>About this score &amp; the plumes</span><span class="chev">▸</span></summary><div class="grp-body" style="font-size:11px;color:#566070;line-height:1.5">'
      + 'The shaded shapes are <b>modeled</b> wind-rose Gaussian plume estimates from this plant’s reported releases and each chemical’s toxicity threshold — cancer (purple), chronic / respiratory (amber), and acute (dashed red). They are estimates of reach, not measured plumes.'
      + (fpRows ? '<div style="margin-top:6px">' + fpRows + '</div>' : '')
      + '<div class="air-about">A relative ranking of the pollution sources near you, built from EPA and Louisiana air-emissions data — not a personal health estimate.</div>'
      + '</div></details>';
    return h + '</div>';
  }

  // ---- fixed left-side facility panel (so the popup never covers the plumes it describes) ----
  if (!document.getElementById("facInfoCss")) {
    document.head.insertAdjacentHTML("beforeend", '<style id="facInfoCss">'
      + '#facInfo{position:absolute;top:54px;left:50px;z-index:1001;background:#fff;border:1px solid #E2E7EF;border-radius:10px;box-shadow:0 2px 12px rgba(16,24,40,.20);font-size:12.5px;width:340px;max-width:calc(100vw - 70px);max-height:calc(100% - 70px);overflow:auto;padding:12px 14px;display:none}'
      + '#facInfo .facinfo-x{position:absolute;top:5px;right:7px;border:none;background:transparent;font-size:19px;line-height:1;color:#8A93A0;cursor:pointer;padding:2px 5px;border-radius:6px;z-index:2}'
      + '#facInfo .facinfo-x:hover{background:#F0F2F5;color:#333}'
      + '#facInfo .pop{padding-right:16px}'
      + '@media(max-width:640px){#facInfo{left:8px;width:calc(100vw - 16px)}}'
      + '</style>');
  }
  let facInfo = document.getElementById("facInfo");
  if (!facInfo) { facInfo = document.createElement("div"); facInfo.id = "facInfo"; document.body.appendChild(facInfo); }
  function renderFacPanel(f) {
    facInfo.innerHTML = '<button class="facinfo-x" title="Close" aria-label="Close">×</button>' + facPopup(f);
    const x = facInfo.querySelector(".facinfo-x"); if (x) x.onclick = closeFacPanel;
  }
  function openFacPanel(f, m) {
    openMarker = m;
    if (typeof BRMap.closeDetail === "function") { try { BRMap.closeDetail(); } catch (e) {} }   // one left panel at a time
    renderFacPanel(f);
    facInfo.style.display = "block"; facInfo.scrollTop = 0;
    if (footprintsOn) drawFootprints(f);
  }
  function closeFacPanel() {
    facInfo.style.display = "none"; facInfo.innerHTML = "";
    openMarker = null; clearFootprints();
  }
  if (typeof BRMap.onListingClick === "function") BRMap.onListingClick(() => closeFacPanel());   // clicking a listing closes the facility panel
  document.addEventListener("keydown", e => { if (e.key === "Escape" && facInfo.style.display === "block") closeFacPanel(); });

  // air.json geocodes many DISTINCT facilities to one shared coordinate (e.g. Dow + TSRC + Olin all at
  // the same lat/lon). Fan co-located markers out into a small ring so each is individually clickable
  // instead of stacking into one un-clickable blob. (Real fix is better geocoding upstream in air.json.)
  function spreadPositions(list) {
    const groups = {};
    list.forEach(f => { const k = f.lat.toFixed(5) + "," + f.lon.toFixed(5); (groups[k] = groups[k] || []).push(f); });
    const pos = new Map();
    Object.values(groups).forEach(g => {
      if (g.length < 2) { pos.set(g[0], [g[0].lat, g[0].lon]); return; }
      const R = 0.0004;                                 // ~44 m fan radius
      g.forEach((f, i) => { const a = (2 * Math.PI * i) / g.length; pos.set(f, [f.lat + R * Math.cos(a), f.lon + R * Math.sin(a)]); });
    });
    return pos;
  }
  const FAC_POS = spreadPositions(FAC_VIS.concat(FAC_HID));

  // build marker layers (visible default set + hidden "no emission data" set)
  const facPane = (BRMap.panes && BRMap.panes.facils) || undefined;
  const renderer = L.canvas({ pane: facPane, padding: 0.5 });
  function buildLayer(list) {
    return L.layerGroup(list.map(f => {
      const st = facStyle(f);
      const m = L.circleMarker(FAC_POS.get(f) || [f.lat, f.lon], { renderer, radius: st.r, color: st.color, weight: 1, fillColor: st.fill, fillOpacity: 0.75 });
      m._fac = f; m._baseR = st.r;
      m.on("click", () => openFacPanel(f, m));   // opens the fixed left panel (not a Leaflet popup) so plumes stay visible
      return m;
    }));
  }
  const facLayer = buildLayer(FAC_VIS);
  const facHidLayer = buildLayer(FAC_HID);
  const facBonus = () => Math.max(0, Math.min(10, (map.getZoom() - 12) * 1.8));
  function sizeFacilities() {
    [facLayer, facHidLayer].forEach(lg => { if (map.hasLayer(lg)) lg.eachLayer(m => { if (m.setRadius && m._baseR != null) m.setRadius(m._baseR + facBonus()); }); });
  }
  map.on("zoomend", sizeFacilities);

  // ---------- single "Pollution" map overlay with nested controls ----------
  let pollOn = false, heatOn = false, showHidden = false;
  function setHeat(on) { if (!heat) return; heatOn = on; if (on && pollOn) heat.addTo(map); else map.removeLayer(heat); }
  function setHidden(on) { showHidden = on; if (on && pollOn) { facHidLayer.addTo(map); sizeFacilities(); } else map.removeLayer(facHidLayer); }

  if (typeof BRMap.addArea === "function") {
    BRMap.addArea({
      id: "pollution", label: "Pollution",
      activate(ctx) {
        pollOn = true;
        facLayer.addTo(map); sizeFacilities();
        if (heatOn && heat) heat.addTo(map);
        if (showHidden) { facHidLayer.addTo(map); sizeFacilities(); }
        const segBtns = CANCER_LEVELS.map((lv, i) => '<button type="button" data-lv="' + lv + '" style="border:none;' + (i ? 'border-left:1px solid #d6cae0;' : '')
          + 'padding:3px 9px;font:inherit;font-size:11px;cursor:pointer;background:' + (lv === selCancer ? '#7B3FA0' : '#fff') + ';color:' + (lv === selCancer ? '#fff' : '#444') + '">' + CANCER_LEVEL_LABEL[lv] + '</button>').join("");
        const ncBtns = NONCANCER_LEVELS.map((lv, i) => '<button type="button" data-lv="' + lv + '" style="border:none;' + (i ? 'border-left:1px solid #e4cba6;' : '')
          + 'padding:3px 9px;font:inherit;font-size:11px;cursor:pointer;background:' + (lv === selNoncancer ? '#CC7A1C' : '#fff') + ';color:' + (lv === selNoncancer ? '#fff' : '#444') + '">' + NONCANCER_LEVEL_LABEL[lv] + '</button>').join("");
        const windNote = WIND_SRC
          ? ('Wind rose: ' + (WIND_IS_FALLBACK ? 'documented Baton Rouge fallback (station-specific NOAA KBTR ingest not yet run).' : esc(WIND_SRC)))
          : '';
        ctx.controls.innerHTML =
          '<div class="legend"><span class="sw"><i style="background:#7B3FA0"></i>Mainly carcinogens</span>'
            + '<span class="sw"><i style="background:#C0392B"></i>Acute toxic gas</span>'
            + '<span class="sw"><i style="background:#CC7A1C"></i>Chronic / respiratory</span>'
            + '<span class="sw"><i style="background:#AEB6BF"></i>Lower / unclassified</span></div>'
          + '<div class="mut">Larger dots = more released.</div>'
          + (heat ? '<label style="margin-top:6px"><input type="checkbox" id="polHeat"' + (heatOn ? " checked" : "") + '> Emissions heat map</label>' : '')
          + '<label style="margin-top:4px"><input type="checkbox" id="polFp"' + (footprintsOn ? " checked" : "") + '> Dispersion-plume footprints <span class="mut" style="margin:0">(click a plant)</span></label>'
          + '<div class="sub" style="margin-top:3px"><span class="mut" style="font-weight:700;color:#3A434F">Cancer plume level</span>'
            + '<div id="polCancerSeg" style="display:flex;margin-top:3px;border:1px solid #d6cae0;border-radius:7px;overflow:hidden;width:fit-content">' + segBtns + '</div>'
            + '<div class="mut">Modeled added lifetime cancer risk at that contour: 1 in 1M = one extra cancer case per 1,000,000 continuously exposed people; 10 in 1M = ten per 1,000,000; 100 in 1M = one hundred per 1,000,000.</div></div>'
          + (HAS_NONCANCER_FP ? '<div class="sub" style="margin-top:5px"><span class="mut" style="font-weight:700;color:#3A434F">Chronic / respiratory level</span>'
            + '<div id="polNoncancerSeg" style="display:flex;margin-top:3px;border:1px solid #e4cba6;border-radius:7px;overflow:hidden;width:fit-content">' + ncBtns + '</div>'
            + '<div class="mut">Hazard-quotient contours: HQ 1 = modeled concentration at the chronic reference level; HQ 10 and HQ 100 are 10× and 100× that level.</div></div>' : '')
          + (windNote ? '<div class="mut" style="margin-top:5px">' + windNote + '</div>' : '')
          + '<label style="margin-top:6px"><input type="checkbox" id="polHidden"' + (showHidden ? " checked" : "") + '> Sites with no emission data</label>';

        const heatEl = ctx.controls.querySelector("#polHeat");
        if (heatEl) heatEl.onchange = e => setHeat(e.target.checked);
        const fpEl = ctx.controls.querySelector("#polFp");
        if (fpEl) fpEl.onchange = e => { footprintsOn = e.target.checked; if (!footprintsOn) clearFootprints(); else if (openMarker && openMarker._fac) drawFootprints(openMarker._fac); };
        const hidEl = ctx.controls.querySelector("#polHidden");
        if (hidEl) hidEl.onchange = e => setHidden(e.target.checked);
        const seg = ctx.controls.querySelector("#polCancerSeg");
        if (seg) seg.querySelectorAll("button").forEach(btn => btn.onclick = () => {
          selCancer = btn.dataset.lv;
          seg.querySelectorAll("button").forEach(b => { const on = b.dataset.lv === selCancer; b.style.background = on ? "#7B3FA0" : "#fff"; b.style.color = on ? "#fff" : "#444"; });
          if (openMarker && openMarker._fac) { if (footprintsOn) drawFootprints(openMarker._fac); renderFacPanel(openMarker._fac); }
        });
        const ncSeg = ctx.controls.querySelector("#polNoncancerSeg");
        if (ncSeg) ncSeg.querySelectorAll("button").forEach(btn => btn.onclick = () => {
          selNoncancer = btn.dataset.lv;
          ncSeg.querySelectorAll("button").forEach(b => { const on = b.dataset.lv === selNoncancer; b.style.background = on ? "#CC7A1C" : "#fff"; b.style.color = on ? "#fff" : "#444"; });
          if (openMarker && openMarker._fac) { if (footprintsOn) drawFootprints(openMarker._fac); renderFacPanel(openMarker._fac); }
        });
      },
      deactivate() {
        pollOn = false;
        map.removeLayer(facLayer); map.removeLayer(facHidLayer);
        if (heat) map.removeLayer(heat);
        closeFacPanel();
      }
    });
  }
});
