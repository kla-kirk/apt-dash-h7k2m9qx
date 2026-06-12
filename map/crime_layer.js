/* CRIME layer module.
   Data: crime_points.json = {cats:[[id,label,color,group]], years:[...], pts:[[lat,lon,catIdx,year]]}.
   Registers:
     • color mode "Crime risk" (DEFAULT) — tints listing pins by the PER-YEAR-AVERAGE violent count
     • map overlay "Crime incidents" — clickable discrete incident dots; on click each fetches its
       exact date + street address from the BR open-data API (matched by block coord + year + offense).
       Year + category filters, plus an opt-in "Heat density overlay" checkbox
     • per-listing popup: violent (¼/½/1mi) + burglary/car-theft (¼mi), toggleable between
       per-year AVERAGE, PAST 12 MONTHS (live API), and ALL-YEARS TOTAL. Risk score = avg/yr.
*/
BRMap.ready(async () => {
  const D = await BRMap.fetchJSON("crime_points.json");
  if (!D) { console.warn("crime_points.json missing"); return; }
  const CATS = D.cats, PTS = D.pts, YEARS = D.years || [], map = BRMap.map;
  const BYCAT = CATS.map(() => []); for (const p of PTS) BYCAT[p[2]].push(p);
  const cidx = {}; CATS.forEach((c, i) => (cidx[c[0]] = i));

  document.head.insertAdjacentHTML("beforeend", `<style>
  .cwin{margin-top:4px}
  .cwin-tabs{display:flex;gap:4px;margin-bottom:4px}
  .cwin-tabs button{flex:1;font:inherit;font-size:10.5px;font-weight:600;color:#5A6472;background:#fff;border:1px solid #D9DEE6;border-radius:6px;padding:2px 0;cursor:pointer}
  .cwin-tabs button.on{background:#2B5797;border-color:#2B5797;color:#fff}
  .cwin-cap{font-size:9.5px;color:#6B7480;margin-top:2px}
  </style>`);

  function hav(a, b, c, d) { const R = 3958.7613, r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

  // ---- per-listing scores: total over all years + average over full years ----
  // The latest year is treated as partial (year-to-date) and excluded from the average.
  const curYear = new Date().getFullYear();
  const fullYears = YEARS.filter((y) => y < curYear);
  const fullSet = new Set(fullYears.length ? fullYears : YEARS);
  const nFull = fullSet.size || 1;
  const yl = YEARS.length ? YEARS[0] + "–" + String(YEARS[YEARS.length - 1]).slice(-2) : "";
  const avgSpan = fullYears.length ? (fullYears[0] + "–" + String(fullYears[fullYears.length - 1]).slice(-2)) : yl;

  const SC = {};
  BRMap.listings.forEach((l) => {
    const total = { v: [0, 0, 0], b: 0, a: 0 }, full = { v: [0, 0, 0], b: 0, a: 0 };
    for (const p of PTS) {
      if (Math.abs(p[0] - l.lat) > 0.02 || Math.abs(p[1] - l.lon) > 0.02) continue;
      const g = CATS[p[2]][3], d = hav(l.lat, l.lon, p[0], p[1]), fy = fullSet.has(p[3]);
      if (g === "violent") {
        if (d <= 1) { total.v[2]++; if (fy) full.v[2]++; }
        if (d <= 0.5) { total.v[1]++; if (fy) full.v[1]++; }
        if (d <= 0.25) { total.v[0]++; if (fy) full.v[0]++; }
      }
      if (p[2] === cidx.burg && d <= 0.25) { total.b++; if (fy) full.b++; }
      if (p[2] === cidx.auto && d <= 0.25) { total.a++; if (fy) full.a++; }
    }
    const avg = { v: [full.v[0] / nFull, full.v[1] / nFull, full.v[2] / nFull], b: full.b / nFull, a: full.a / nFull };
    SC[l.id] = { total, avg };
  });

  // risk tiers calibrated to a TYPICAL YEAR's ½-mile violent count
  const VT = [{ t: "Low", m: 5, c: "#1E7A34" }, { t: "Moderate", m: 15, c: "#9A6A00" }, { t: "Elevated", m: 35, c: "#C2691C" }, { t: "High", m: 1e9, c: "#B23B3B" }];
  const vt = (n) => { let i = VT.findIndex((s) => n < s.m); return VT[i < 0 ? 3 : i]; };

  // ---- popup box rendering (shared by all three windows) ----
  const fmtN = (n, isAvg) => isAvg ? (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)) : String(Math.round(n));
  function boxesHtml(d, col, isAvg) {
    const vb = (n, lab) => '<span style="flex:1;text-align:center;background:' + col + '14;border:1px solid ' + col + '33;border-radius:6px;padding:3px 2px"><b style="display:block;font-size:14px;line-height:1.15;color:' + col + '">' + fmtN(n, isAvg) + '</b><span style="font-size:9.5px;color:#6B7480">' + lab + '</span></span>';
    const pb = (n, c2, lab) => '<span style="flex:1;text-align:center;background:' + c2 + '14;border:1px solid ' + c2 + '33;border-radius:6px;padding:3px 2px"><b style="display:block;font-size:14px;line-height:1.15;color:' + c2 + '">' + fmtN(n, isAvg) + '</b><span style="font-size:9.5px;color:#6B7480">' + lab + '</span></span>';
    return '<div style="display:flex;gap:5px">' + vb(d.v[0], "violent &frac14;mi") + vb(d.v[1], "violent &frac12;mi") + vb(d.v[2], "violent 1mi") + '</div>' +
      '<div style="display:flex;gap:5px;margin-top:5px">' + pb(d.b, "#2B6CB0", "burglary &frac14;mi") + pb(d.a, "#6B46C1", "car theft &frac14;mi") + '</div>';
  }
  const capFor = (w) => w === "avg" ? "per-year average · " + avgSpan : w === "twelve" ? "past 12 months" : "total · " + yl;

  BRMap.addPopupRow((l) => {
    const s = SC[l.id]; if (!s) return ""; const t = vt(s.avg.v[1]);
    return '<div class="row" style="margin-top:4px">Violent crime risk: <span class="badge" style="background:' + t.c + '22;color:' + t.c + '">' + t.t + '</span></div>' +
      '<div class="cwin" data-lid="' + l.id + '">' +
        '<div class="cwin-tabs"><button type="button" data-w="avg" class="on">Avg/yr</button><button type="button" data-w="twelve">Past 12 mo</button><button type="button" data-w="total">Total</button></div>' +
        '<div class="cwin-body">' + boxesHtml(s.avg, t.c, true) + '</div>' +
        '<div class="cwin-cap">' + capFor("avg") + '</div>' +
      '</div>'; }, "crime");

  // ---- DEFAULT color mode: crime risk (by per-year average) ----
  BRMap.addColorMode({ id: "crime", label: "Crime risk", def: true,
    colorFor: (l) => { const s = SC[l.id]; return s ? vt(s.avg.v[1]).c : undefined; },
    legend: VT.map((s) => '<span class="sw"><i style="background:' + s.c + '"></i>' + s.t + "</span>").join("") });

  // ---- live incident detail + past-12-months counts (BR open-data API) ----
  const NIBRS = { hom: ["09A", "09B", "09C"], agg: ["13A"], rob: ["120"], rape: ["11A", "11B", "11C", "11D"],
    burg: ["220"], theft: ["23A", "23B", "23C", "23D", "23E", "23F", "23G", "23H"], auto: ["240"],
    weap: ["520"], drug: ["35A", "35B"], vand: ["290"], simp: ["13B"], intim: ["13C"], other: [] };
  const VIOLENT_NIBRS = new Set(["09A", "09B", "09C", "13A", "120", "11A", "11B", "11C", "11D"]);
  const API = "https://data.brla.gov/resource/pbin-pcm7.json";
  const tc = (s) => (s || "").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  const fmtDate = (s) => { if (!s) return ""; const d = new Date(s);
    return isNaN(d) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); };
  function detailURL(p, useCodes) {
    const lat = p[0], lon = p[1], yr = p[3], e = 0.0003;
    let w = "latitude between " + (lat - e).toFixed(5) + " and " + (lat + e).toFixed(5) +
            " and longitude between " + (lon - e).toFixed(5) + " and " + (lon + e).toFixed(5);
    if (yr) w += " and date_extract_y(charge_date)=" + yr;
    const codes = NIBRS[CATS[p[2]][0]] || [];
    if (useCodes && codes.length) w += " and nibrs_code in(" + codes.map((c) => "'" + c + "'").join(",") + ")";
    return API + "?$select=charge_date,street,neighborhood,postal_code,offense_description&$order=charge_date desc&$limit=6&$where=" + encodeURIComponent(w);
  }
  async function fetchDetail(p) {
    const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    let rows = await get(detailURL(p, true));
    if (!rows.length) rows = await get(detailURL(p, false));
    return rows;
  }
  function detailHtml(p, rows) {
    const cat = CATS[p[2]][1];
    if (!rows || !rows.length)
      return "<b>" + cat + "</b><br>" + (p[3] || "") + '<br><span style="color:#8a8f98;font-size:11px">exact record not found</span>';
    const r = rows[0];
    const loc = r.street ? tc(r.street) : (r.neighborhood ? tc(r.neighborhood) : "");
    const hood = r.street && r.neighborhood ? " · " + tc(r.neighborhood) : "";
    let h = "<b>" + tc(r.offense_description || cat) + "</b><br>" + fmtDate(r.charge_date);
    if (loc) h += "<br>" + loc + hood + (r.postal_code ? " " + r.postal_code : "");
    if (rows.length > 1) h += '<br><span style="color:#8a8f98;font-size:11px">+' + (rows.length - 1) + " more at this block</span>";
    return h;
  }
  // rolling past-12-months counts for a listing, bucketed client-side from a single bbox query
  function fetch12mo(l) {
    const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), e = 0.02;
    const w = "latitude between " + (l.lat - e).toFixed(4) + " and " + (l.lat + e).toFixed(4) +
              " and longitude between " + (l.lon - e).toFixed(4) + " and " + (l.lon + e).toFixed(4) +
              " and charge_date > '" + cutoff + "'";
    const url = API + "?$select=latitude,longitude,nibrs_code&$limit=8000&$where=" + encodeURIComponent(w);
    return fetch(url).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((rows) => {
      const d = { v: [0, 0, 0], b: 0, a: 0 };
      for (const r of rows) { const la = +r.latitude, lo = +r.longitude; if (!la || !lo) continue;
        const dist = hav(l.lat, l.lon, la, lo), code = r.nibrs_code;
        if (VIOLENT_NIBRS.has(code)) { if (dist <= 1) d.v[2]++; if (dist <= 0.5) d.v[1]++; if (dist <= 0.25) d.v[0]++; }
        if (code === "220" && dist <= 0.25) d.b++; if (code === "240" && dist <= 0.25) d.a++; }
      return d;
    });
  }

  // ---- crime dot interaction ----
  // Dots are non-interactive canvas points; ONE map-level handler opens the nearest incident's
  // detail. This makes dots under listing pins / amenity markers, or several stacked on the same
  // block centroid, all reachable — a precise canvas hit is no longer required.
  let currentFiltered = [], overlayActive = false, dotPop = null;
  function openDotDetail(p) {
    dotPop = L.popup({ autoPan: true, autoPanPadding: [28, 28] }).setLatLng([p[0], p[1]])
      .setContent("<b>" + CATS[p[2]][1] + "</b>" + (p[3] != null ? "<br>" + p[3] : "") + '<br><span style="color:#8a8f98;font-size:11px">loading details…</span>')
      .openOn(map);
    const target = dotPop;
    fetchDetail(p).then((rows) => { try { target.setContent(detailHtml(p, rows)); } catch (_) {} });
  }
  const HIT = 14; // px
  map.on("click", (e) => {
    if (!overlayActive || !currentFiltered.length) return;
    const cp = e.containerPoint, ll = e.latlng;
    // ignore clicks on a listing pin's footprint — let the listing detail handle those
    for (const id in BRMap.pins) { const m = BRMap.pins[id]; if (!m || !m.getLatLng) continue;
      const pp = map.latLngToContainerPoint(m.getLatLng());
      if (Math.abs(cp.x - pp.x) <= 14 && cp.y <= pp.y + 4 && cp.y >= pp.y - 36) return; }
    const c2 = map.containerPointToLatLng(L.point(cp.x + HIT, cp.y + HIT));
    const dLat = Math.abs(c2.lat - ll.lat) + 1e-9, dLon = Math.abs(c2.lng - ll.lng) + 1e-9;
    let best = null, bestPx = Infinity;
    for (const p of currentFiltered) {
      if (Math.abs(p[0] - ll.lat) > dLat || Math.abs(p[1] - ll.lng) > dLon) continue;
      const pp = map.latLngToContainerPoint([p[0], p[1]]);
      const dx = pp.x - cp.x, dy = pp.y - cp.y, px = Math.sqrt(dx * dx + dy * dy);
      if (px < bestPx) { bestPx = px; best = p; }
    }
    if (best && bestPx <= HIT) openDotDetail(best);
  });

  // listing detail panel → wire the avg / 12-mo / total toggle (migrated from popupopen)
  if (BRMap.onDetailRender) BRMap.onDetailRender((l, root) => {
    const cwin = root.querySelector(".cwin"); if (!cwin) return;
    const lid = cwin.getAttribute("data-lid"), s = SC[lid]; if (!s) return;
    const t = vt(s.avg.v[1]);
    const body = cwin.querySelector(".cwin-body"), cap = cwin.querySelector(".cwin-cap");
    let cur = "avg";
    function render(w) {
      cur = w;
      cwin.querySelectorAll(".cwin-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.w === w));
      if (w === "twelve") {
        if (s._twelve) { body.innerHTML = boxesHtml(s._twelve, t.c, false); cap.textContent = capFor("twelve"); }
        else { body.innerHTML = '<div class="mut" style="padding:6px 2px">loading past 12 months…</div>'; cap.textContent = "";
          fetch12mo(l).then((d) => { s._twelve = d; if (cur === "twelve") { body.innerHTML = boxesHtml(d, t.c, false); cap.textContent = capFor("twelve"); } }); }
      } else { body.innerHTML = boxesHtml(w === "total" ? s.total : s.avg, t.c, w === "avg"); cap.textContent = capFor(w); }
    }
    cwin.querySelectorAll(".cwin-tabs button").forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); render(b.dataset.w); });
  });

  // ---- map overlay: crime incidents (clickable dots primary; heat density optional) ----
  const enabled = CATS.map((c) => c[3] === "violent"); let selYear = "all"; let showHeat = false;
  let ptsLayer = null, heat = null;
  const cv = L.canvas({ padding: 0.5, pane: BRMap.panes.heat });
  const filtered = () => { const out = []; for (let ci = 0; ci < CATS.length; ci++) { if (!enabled[ci]) continue;
    for (const p of BYCAT[ci]) { if (selYear !== "all" && p[3] !== selYear) continue; out.push(p); } } return out; };
  const removePts = () => { if (ptsLayer) { map.removeLayer(ptsLayer); ptsLayer = null; } };
  const removeHeat = () => { if (heat) { map.removeLayer(heat); heat = null; } };
  function draw() {
    const pts = filtered();
    currentFiltered = pts;
    removePts(); removeHeat();
    if (showHeat && typeof L.heatLayer === "function") {
      heat = L.heatLayer(pts.map((p) => [p[0], p[1], 0.7]), { radius: 20, blur: 18, maxZoom: 16, minOpacity: 0.25 }).addTo(map);
    }
    ptsLayer = L.layerGroup();
    for (const p of pts) {
      L.circleMarker([p[0], p[1]], { renderer: cv, pane: BRMap.panes.heat, radius: 4, weight: 0.6, color: "#fff", fillColor: CATS[p[2]][2], fillOpacity: 0.85, interactive: false }).addTo(ptsLayer);
    }
    ptsLayer.addTo(map);
    const c = document.getElementById("crimeCount"); if (c) c.textContent = pts.length.toLocaleString() + " incidents";
  }

  BRMap.addArea({ id: "crime", label: "Crime incidents",
    activate(ctx) {
      ctx.controls.innerHTML =
        '<select id="crimeYr"></select><div class="mut" id="crimeCount" style="margin:3px 0"></div>' +
        '<div id="crimeVio"></div><div id="crimePro"></div>' +
        '<label class="sub"><input type="checkbox" id="crimeHeat"> Heat density overlay</label>';
      const ys = document.getElementById("crimeYr");
      ys.innerHTML = '<option value="all">All years</option>' + YEARS.map((y) => '<option value="' + y + '">' + y + "</option>").join("");
      ys.onchange = (e) => { selYear = e.target.value === "all" ? "all" : +e.target.value; draw(); };
      document.getElementById("crimeHeat").onchange = (e) => { showHeat = e.target.checked; draw(); };
      function buildGroup(group, elId, title, defOn) {
        const idxs = CATS.map((c, i) => [c, i]).filter((x) => x[0][3] === group);
        let h = '<label><input type="checkbox" id="m_' + group + '" ' + (defOn ? "checked" : "") + "><b>" + title + "</b></label>";
        h += idxs.map(([c, i]) => '<label class="sub"><input type="checkbox" class="ccat" data-i="' + i + '" ' + (enabled[i] ? "checked" : "") + '><i style="background:' + c[2] + '"></i>' + c[1] + "</label>").join("");
        document.getElementById(elId).innerHTML = h;
        document.getElementById("m_" + group).onchange = function () { idxs.forEach(([c, i]) => (enabled[i] = this.checked));
          document.querySelectorAll("#" + elId + " .ccat").forEach((cb) => (cb.checked = this.checked)); draw(); };
      }
      buildGroup("violent", "crimeVio", "All violent", true);
      buildGroup("property", "crimePro", "All non-violent", false);
      ctx.controls.querySelectorAll(".ccat").forEach((cb) => (cb.onchange = function () { enabled[+this.dataset.i] = this.checked;
        ["violent", "property"].forEach((g) => { const ix = CATS.map((c, i) => [c, i]).filter((x) => x[0][3] === g);
          const mg = document.getElementById("m_" + g); if (mg) mg.checked = ix.every(([c, i]) => enabled[i]); }); draw(); }));
      ctx.legend('<span class="sw">Dots = incidents — click near one for date &amp; address</span>');
      overlayActive = true; draw();
    },
    deactivate() { overlayActive = false; currentFiltered = []; removePts(); removeHeat(); }
  });
});
