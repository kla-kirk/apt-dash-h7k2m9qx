/* CRIME layer module.
   Data: crime_points.json = {cats:[[id,label,color,group]], years:[...], pts:[[lat,lon,catIdx,year]]}.
   Registers:
     • color mode "Crime risk" (DEFAULT) — tints listing pins by nearby violent-incident count
     • map overlay "Crime incidents" — clickable discrete incident dots; on click each fetches
       its exact date + street address from the BR open-data API (matched by block coordinate +
       year + offense). Year + category filters, plus an opt-in "Heat density overlay" checkbox
     • per-listing popup rows: violent risk (¼/½/1 mi) + burglary/car-theft (¼ mi)
*/
BRMap.ready(async () => {
  const D = await BRMap.fetchJSON("crime_points.json");
  if (!D) { console.warn("crime_points.json missing"); return; }
  const CATS = D.cats, PTS = D.pts, YEARS = D.years || [], map = BRMap.map;
  const BYCAT = CATS.map(() => []); for (const p of PTS) BYCAT[p[2]].push(p);
  const cidx = {}; CATS.forEach((c, i) => (cidx[c[0]] = i));

  // ---- per-listing scores ----
  function hav(a, b, c, d) { const R = 3958.7613, r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  const SC = {};
  BRMap.listings.forEach((l) => { let v = [0, 0, 0], b = 0, a = 0;
    for (const p of PTS) { if (Math.abs(p[0] - l.lat) > 0.02 || Math.abs(p[1] - l.lon) > 0.02) continue;
      const g = CATS[p[2]][3]; const d = hav(l.lat, l.lon, p[0], p[1]);
      if (g === "violent") { if (d <= 1) v[2]++; if (d <= 0.5) v[1]++; if (d <= 0.25) v[0]++; }
      if (p[2] === cidx.burg && d <= 0.25) b++; if (p[2] === cidx.auto && d <= 0.25) a++; }
    SC[l.id] = { v, b, a }; });
  const VT = [{ t: "Low", m: 3, c: "#1E7A34" }, { t: "Moderate", m: 11, c: "#9A6A00" }, { t: "Elevated", m: 26, c: "#C2691C" }, { t: "High", m: 1e9, c: "#B23B3B" }];
  const vt = (n) => { let i = VT.findIndex((s) => n < s.m); return VT[i < 0 ? 3 : i]; };

  // popup rows for a clicked listing — boxed format ported from the original crime_map.html
  const yl = YEARS.length ? YEARS[0] + "–" + String(YEARS[YEARS.length - 1]).slice(-2) : "";
  BRMap.addPopupRow((l) => {
    const s = SC[l.id]; if (!s) return ""; const t = vt(s.v[1]);
    const box = (n, lab) => '<span style="flex:1;text-align:center;background:' + t.c + '14;border:1px solid ' + t.c + '33;border-radius:6px;padding:3px 2px"><b style="display:block;font-size:14px;line-height:1.15;color:' + t.c + '">' + n + '</b><span style="font-size:9.5px;color:#6B7480">' + lab + '</span></span>';
    return '<div class="row" style="margin-top:3px">Violent crime risk: <span class="badge" style="background:' + t.c + '22;color:' + t.c + '">' + t.t + '</span></div>' +
      '<div class="row" style="display:flex;gap:5px;margin-top:3px">' + box(s.v[0], "within &frac14; mi") + box(s.v[1], "within &frac12; mi") + box(s.v[2], "within 1 mi") + '</div>' +
      '<div class="row" style="font-size:9.5px;color:#6B7480;margin-top:2px">violent incidents' + (yl ? ", " + yl : "") + '</div>' +
      '<div class="row" style="display:flex;gap:5px;margin-top:5px">' +
        '<span style="flex:1;text-align:center;background:#2B6CB014;border:1px solid #2B6CB033;border-radius:6px;padding:3px 2px"><b style="display:block;font-size:14px;line-height:1.15;color:#2B6CB0">' + s.b + '</b><span style="font-size:9.5px;color:#6B7480">burglary &frac14; mi</span></span>' +
        '<span style="flex:1;text-align:center;background:#6B46C114;border:1px solid #6B46C133;border-radius:6px;padding:3px 2px"><b style="display:block;font-size:14px;line-height:1.15;color:#6B46C1">' + s.a + '</b><span style="font-size:9.5px;color:#6B7480">car theft &frac14; mi</span></span>' +
      '</div>' +
      '<div class="row" style="font-size:9.5px;color:#6B7480;margin-top:2px">property incidents' + (yl ? ", " + yl : "") + '</div>'; });

  // ---- DEFAULT color mode: crime risk ----
  BRMap.addColorMode({ id: "crime", label: "Crime risk", def: true,
    colorFor: (l) => { const s = SC[l.id]; return s ? vt(s.v[1]).c : undefined; },
    legend: VT.map((s) => '<span class="sw"><i style="background:' + s.c + '"></i>' + s.t + "</span>").join("") });

  // ---- live incident detail (fetched from the BR open-data API on click) ----
  // crime_points.json carries only lat/lon/cat/year; exact date + street are pulled on demand
  // from data.brla.gov, matched by block coordinate + year + offense (NIBRS) code.
  const NIBRS = { hom: ["09A", "09B", "09C"], agg: ["13A"], rob: ["120"], rape: ["11A", "11B", "11C", "11D"],
    burg: ["220"], theft: ["23A", "23B", "23C", "23D", "23E", "23F", "23G", "23H"], auto: ["240"],
    weap: ["520"], drug: ["35A", "35B"], vand: ["290"], simp: ["13B"], intim: ["13C"], other: [] };
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
  map.on("popupopen", (e) => {
    const m = e.popup && e.popup._source; if (!m || !m._crime || m._loaded) return;
    m._loaded = true;
    fetchDetail(m._crime).then((rows) => { try { m.setPopupContent(detailHtml(m._crime, rows)); } catch (_) {} });
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
    removePts(); removeHeat();
    // optional density surface, drawn beneath the dots
    if (showHeat && typeof L.heatLayer === "function") {
      heat = L.heatLayer(pts.map((p) => [p[0], p[1], 0.7]), { radius: 20, blur: 18, maxZoom: 16, minOpacity: 0.25 }).addTo(map);
    }
    // discrete clickable incidents — the primary view (popup: type + year)
    ptsLayer = L.layerGroup();
    for (const p of pts) {
      const cm = L.circleMarker([p[0], p[1]], { renderer: cv, pane: BRMap.panes.heat, radius: 4, weight: 0.6, color: "#fff", fillColor: CATS[p[2]][2], fillOpacity: 0.85 });
      cm._crime = p; cm._loaded = false;
      cm.bindPopup("<b>" + CATS[p[2]][1] + "</b>" + (p[3] != null ? "<br>" + p[3] : "") + '<br><span style="color:#8a8f98;font-size:11px">loading details…</span>');
      cm.addTo(ptsLayer);
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
      ctx.legend('<span class="sw">Dots = incidents — click one for date &amp; address</span>');
      draw();
    },
    deactivate() { removePts(); removeHeat(); }
  });
});
