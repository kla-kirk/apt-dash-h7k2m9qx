/* COMMUTE / ROUTES layer module — owned by the "commute" chat.
   Editable files (map_site/): commute_layer.js, commute.json, commute_routes.geojson, amenity_routes.geojson.
   Data (all fetched lazily, absent-safe):
     commute.json          { "<address>": { am, pm, off, miles:{am,pm,off} } }  minutes to LSU.
     commute_routes.geojson FeatureCollection of LSU route LineStrings.
                            NEW shape  props {address,time:"am"|"pm"|"off",alt:0|1|2,dur_min,dist_mi}
                            LEGACY      props {address,am}  (single primary route) — still supported.
     amenity_routes.geojson FeatureCollection of home->nearest-amenity routes (driving + walking).
                            props {address,amenity,type,mode:"driving"|"walking",dur_min,dist_mi}
                            Absent until the route pull (fetch_routes.py) is run — degrades silently.
   On listing select: draws a Google/Apple-Maps-style commute route to LSU (white casing + colored
   line, rounded, grey alternates behind) for the chosen time of day, and fits the view to it.
   A "Route options" panel picks time of day (AM/PM/off), toggles alternates, and sets amenity-route
   travel mode (driving default / walking). Each nearby amenity gets a clickable "route" chip in the
   listing popup that draws ONE street-following home<->amenity route at a time.
   Also exposes window.BRCommute.{drawAmenityRoute,clearAmenityRoute,setAmenityMode} so the amenities
   module can later trigger the same route from its own map markers (no edit needed here).
   Uses only the BRMap plugin API + the global basePopup()/pinIcon helpers. */
BRMap.ready(async () => {
  const map = BRMap.map, RPANE = BRMap.panes.routes;
  const LSU = [30.4127, -91.1772]; // [lat,lon]
  const C = await BRMap.fetchJSON("commute.json") || {};
  const flip = (c) => [c[1], c[0]];

  // ---------- LSU routes: addr -> { am:{primary,alts[]}, pm:{...}, off:{...} } ----------
  const LR = {};
  const ensure = (a) => (LR[a] || (LR[a] = { am: node(), pm: node(), off: node() }));
  function node() { return { primary: null, alts: [], dur: null, dist: null }; }
  const lsuGj = await BRMap.fetchJSON("commute_routes.geojson");
  if (lsuGj && Array.isArray(lsuGj.features)) for (const f of lsuGj.features) {
    const p = f.properties || {}, g = f.geometry; if (!p.address || !g || g.type !== "LineString") continue;
    const coords = g.coordinates.map(flip), e = ensure(p.address);
    if (p.time && e[p.time]) {
      const slot = e[p.time];
      if ((p.alt || 0) === 0) { slot.primary = coords; slot.dur = p.dur_min; slot.dist = p.dist_mi; }
      else slot.alts.push(coords);
    } else { // legacy single route -> use as primary everywhere it's missing
      ["am", "pm", "off"].forEach((t) => { if (!e[t].primary) e[t].primary = coords; });
    }
  }
  function lsuFor(addr, t) { const e = LR[addr]; if (!e) return null;
    const prim = e[t].primary || e.am.primary || e.pm.primary || e.off.primary;
    if (!prim) return null;
    const alts = e[t].alts.length ? e[t].alts : [];
    return { primary: prim, alts, dur: e[t].dur, dist: e[t].dist }; }

  // ---------- amenity routes: addr -> name -> {type, driving:{coords,dur,dist}, walking:{...}} ----------
  const AR = {};
  const arGj = await BRMap.fetchJSON("amenity_routes.geojson");
  if (arGj && Array.isArray(arGj.features)) for (const f of arGj.features) {
    const p = f.properties || {}, g = f.geometry; if (!p.address || !p.amenity || !g || g.type !== "LineString") continue;
    (AR[p.address] || (AR[p.address] = {}));
    const rec = AR[p.address][p.amenity] || (AR[p.address][p.amenity] = { type: p.type });
    rec[p.mode] = { coords: g.coordinates.map(flip), dur: p.dur_min, dist: p.dist_mi };
  }
  const hasAR = Object.keys(AR).length > 0;

  const TYPE_ORDER = ["grocery", "pharmacy", "school", "park", "hospital", "gym"];
  const ICON = { grocery: "🛒", pharmacy: "💊", school: "🏫", park: "🌳", hospital: "🏥", gym: "🏋" };

  // ---------- styling ----------
  const BLUE = "#1A73E8", GREEN = "#0F9D58", GREY = "#9AA6B2", CASE = "#FFFFFF";
  function casedLine(coords, { color, w, casing = true, dotted = false, opacity = 1 }) {
    const out = [];
    if (casing) out.push(L.polyline(coords, { pane: RPANE, color: CASE, weight: w + 3.5, opacity: 0.95, lineJoin: "round", lineCap: "round", interactive: false }));
    out.push(L.polyline(coords, { pane: RPANE, color, weight: w, opacity, lineJoin: "round", lineCap: "round", interactive: false, dashArray: dotted ? "1 9" : null }));
    return out;
  }
  function fit(coords) { try { map.fitBounds(L.latLngBounds(coords), { padding: [60, 60], maxZoom: 15 }); } catch (e) {} }

  // ---------- state ----------
  let timeMode = "am", showAlts = true, amMode = "driving";
  let current = null, lsuOn = true, amOn = true;
  let lsuLayers = [], amLayers = [], lsuDot = null, curAm = null;

  const clearLSU = () => { lsuLayers.forEach((l) => map.removeLayer(l)); lsuLayers = []; if (lsuDot) { map.removeLayer(lsuDot); lsuDot = null; } };
  const clearAm = () => { amLayers.forEach((l) => map.removeLayer(l)); amLayers = []; curAm = null; };

  function drawLSU(l) {
    clearLSU(); if (!l) return; const r = lsuFor(l.address, timeMode); if (!r) return;
    if (showAlts) r.alts.forEach((a) => casedLine(a, { color: GREY, w: 4, opacity: 0.85 }).forEach((ln) => { ln.addTo(map); lsuLayers.push(ln); }));
    casedLine(r.primary, { color: BLUE, w: 5.5 }).forEach((ln) => { ln.addTo(map); lsuLayers.push(ln); });
    lsuDot = L.circleMarker(LSU, { pane: RPANE, radius: 6, color: "#fff", weight: 2, fillColor: BLUE, fillOpacity: 1 })
      .bindTooltip("🎓 LSU" + (r.dur != null ? " · " + Math.round(r.dur) + " min" : ""), { permanent: true, direction: "top", offset: [0, -8], className: "lsu-lbl" }).addTo(map); lsuLayers.push(lsuDot);
    fit(r.primary);
  }

  function drawAmenity(addr, name) {
    clearAm(); const rec = AR[addr] && AR[addr][name]; if (!rec) return false;
    const seg = rec[amMode] || rec.driving || rec.walking; if (!seg) return false;
    const walking = (rec[amMode] ? amMode : (rec.driving ? "driving" : "walking")) === "walking";
    casedLine(seg.coords, { color: walking ? GREEN : BLUE, w: 5, dotted: walking }).forEach((ln) => { ln.addTo(map); amLayers.push(ln); });
    curAm = { addr, name }; fit(seg.coords); return true;
  }

  // ---------- panel: Route options ----------
  const sec = BRMap.section("commute_opts", "Route options");
  sec.insertAdjacentHTML("beforeend",
    '<div class="mut" style="margin:0 0 3px">Commute time of day</div>' +
    '<div class="sub">' +
      '<label><input type="radio" name="cmTime" value="am" checked> AM rush (8am)</label>' +
      '<label><input type="radio" name="cmTime" value="pm"> PM rush (5pm)</label>' +
      '<label><input type="radio" name="cmTime" value="off"> Off-peak</label>' +
    '</div>' +
    '<label><input type="checkbox" id="cmAlts" checked> Show alternate routes</label>' +
    '<div class="mut" style="margin:5px 0 3px">Amenity route mode</div>' +
    '<div class="sub">' +
      '<label><input type="radio" name="cmAmMode" value="driving" checked> 🚗 Driving</label>' +
      '<label><input type="radio" name="cmAmMode" value="walking"> 🚶 Walking</label>' +
    '</div>' +
    (hasAR ? '<div class="mut">Click an amenity chip in a listing popup to route to it.</div>'
           : '<div class="mut">Amenity routes pending — run the route pull.</div>'));
  sec.querySelectorAll('input[name="cmTime"]').forEach((r) => r.onchange = (e) => { timeMode = e.target.value; if (lsuOn) drawLSU(current); refreshPopup(); });
  sec.querySelector("#cmAlts").onchange = (e) => { showAlts = e.target.checked; if (lsuOn) drawLSU(current); };
  sec.querySelectorAll('input[name="cmAmMode"]').forEach((r) => r.onchange = (e) => { amMode = e.target.value; if (curAm) drawAmenity(curAm.addr, curAm.name); });

  // ---------- details (toggles + auto-clear on deselect) ----------
  // The shell only invokes select() when a detail is enabled, so draw unconditionally here.
  BRMap.addDetail({ id: "commute", label: "🚗 Commute route to LSU", def: true,
    select(l) { current = l; drawLSU(l); }, clear() { clearLSU(); } });
  BRMap.addDetail({ id: "amroute", label: "🧭 Amenity route (click a chip)", def: true,
    select(l) { current = l; }, clear() { clearAm(); } });
  // track on/off by reading the checkboxes the shell created
  const cb = (id) => document.getElementById("det_" + id);
  function syncFlags() { const a = cb("commute"), b = cb("amroute"); if (a) lsuOn = a.checked; if (b) amOn = b.checked; }
  ["commute", "amroute"].forEach((id) => { const el = cb(id); if (el) el.addEventListener("change", () => { syncFlags(); if (!lsuOn) clearLSU(); if (!amOn) clearAm(); }); });
  syncFlags();

  function refreshPopup() { if (current && BRMap.refreshDetail) BRMap.refreshDetail(); }

  // ---------- popup rows ----------
  const TMETA = { am: "AM rush", pm: "PM rush", off: "off-peak" };
  BRMap.addPopupRow((l) => { const c = C[l.address]; if (!c) return "";
    const v = c[timeMode], mi = c.miles && (c.miles[timeMode] != null ? c.miles[timeMode] : c.miles.off);
    return '<div class="row">→ LSU (' + TMETA[timeMode] + '): ' + (v != null ? "<b>" + Math.round(v) + " min</b>" : "—") +
      (mi != null ? ' <span class="mut">· ' + (+mi).toFixed(1) + " mi</span>" : "") + "</div>" +
      '<div class="row mut">AM ' + c.am + " · PM " + c.pm + " · off " + c.off + " min</div>"; }, "commute");

  // amenity route chips (only when we actually have route data for this listing)
  const REG = {};
  BRMap.addPopupRow((l) => { const recs = AR[l.address]; if (!recs) return "";
    const items = TYPE_ORDER.map((t) => { const name = Object.keys(recs).find((n) => recs[n].type === t); return name ? { t, name } : null; }).filter(Boolean);
    if (!items.length) return "";
    const chips = items.map(({ t, name }) => { const id = l.id + "__" + t; REG[id] = { addr: l.address, name };
      const seg = recs[name][amMode] || recs[name].driving || recs[name].walking;
      const mins = seg ? Math.round(seg.dur) : null;
      return '<button class="cm-chip" data-id="' + id + '" title="Route to ' + name.replace(/"/g, "&quot;") + '">' +
        (ICON[t] || "•") + " " + (mins != null ? mins + "m" : "route") + "</button>"; }).join("");
    return '<div class="row" style="margin-top:4px"><span class="mut">Route to nearby:</span><div class="cm-chips">' + chips + "</div></div>"; }, "commute");

  // chip styles + delegated click
  document.head.insertAdjacentHTML("beforeend",
    "<style>.cm-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}" +
    ".cm-chip{font:inherit;font-size:11px;line-height:1;padding:3px 7px;border:1px solid #C7CDD6;border-radius:12px;background:#fff;color:#2B5797;cursor:pointer}" +
    ".cm-chip:hover{background:#EEF3FB;border-color:#2B5797}" +
    ".leaflet-tooltip.lsu-lbl{background:#1A73E8;color:#fff;border:1px solid #fff;border-radius:6px;font-size:11px;font-weight:700;padding:1px 7px;box-shadow:0 1px 3px rgba(0,0,0,.4)}.leaflet-tooltip.lsu-lbl:before{display:none}</style>");
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".cm-chip"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); if (!amOn) return; const r = REG[b.dataset.id]; if (r) drawAmenity(r.addr, r.name); }, true);

  // ---------- public hook for the amenities module ----------
  window.BRCommute = {
    drawAmenityRoute(addr, name) { return drawAmenity(addr, name); },
    clearAmenityRoute() { clearAm(); },
    setAmenityMode(m) { if (m === "driving" || m === "walking") { amMode = m; const rb = sec.querySelector('input[name="cmAmMode"][value="' + m + '"]'); if (rb) rb.checked = true; if (curAm) drawAmenity(curAm.addr, curAm.name); } },
    hasRoutes: hasAR,
  };
});
