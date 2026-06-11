/* CRIME layer module.
   Data: crime_points.json = {cats:[[id,label,color,group]], years:[...], pts:[[lat,lon,catIdx,year]]}.
   Registers:
     • color mode "Crime risk" (DEFAULT) — tints listing pins by nearby violent-incident count
     • map overlay "Crime density" — a heat surface (falls back to dots) with year + category
       filters and an opt-in "individual incidents" toggle, drawn in the heat pane
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

  BRMap.addPopupRow((l) => { const s = SC[l.id]; if (!s) return ""; const t = vt(s.v[1]);
    return '<div class="row">Violent risk: <b style="color:' + t.c + '">' + t.t + "</b> · ¼mi " + s.v[0] + " · ½mi " + s.v[1] + " · 1mi " + s.v[2] + "</div>" +
           '<div class="row">Burglary ¼mi <b>' + s.b + "</b> · Car theft ¼mi <b>" + s.a + "</b></div>"; });

  // ---- DEFAULT color mode: crime risk ----
  BRMap.addColorMode({ id: "crime", label: "Crime risk", def: true,
    colorFor: (l) => { const s = SC[l.id]; return s ? vt(s.v[1]).c : undefined; },
    legend: VT.map((s) => '<span class="sw"><i style="background:' + s.c + '"></i>' + s.t + "</span>").join("") });

  // ---- map overlay: crime density ----
  const enabled = CATS.map((c) => c[3] === "violent"); let selYear = "all"; let showDots = false;
  let heat = null, dots = null;
  const filtered = () => { const out = []; for (let ci = 0; ci < CATS.length; ci++) { if (!enabled[ci]) continue;
    for (const p of BYCAT[ci]) { if (selYear !== "all" && p[3] !== selYear) continue; out.push(p); } } return out; };
  const removeHeat = () => { if (heat) { map.removeLayer(heat); heat = null; } };
  const removeDots = () => { if (dots) { map.removeLayer(dots); dots = null; } };
  function draw() {
    const pts = filtered();
    removeHeat(); removeDots();
    if (typeof L.heatLayer === "function") {
      heat = L.heatLayer(pts.map((p) => [p[0], p[1], 0.7]), { radius: 20, blur: 18, maxZoom: 16, minOpacity: 0.25 }).addTo(map);
    } else { showDots = true; } // no heat plugin -> always show dots
    if (showDots) {
      const cv = L.canvas({ padding: 0.5, pane: BRMap.panes.heat }); dots = L.layerGroup();
      for (const p of pts) L.circleMarker([p[0], p[1]], { renderer: cv, radius: 3, stroke: false, fillColor: CATS[p[2]][2], fillOpacity: 0.55, pane: BRMap.panes.heat }).addTo(dots);
      dots.addTo(map);
    }
    const c = document.getElementById("crimeCount"); if (c) c.textContent = pts.length.toLocaleString() + " incidents";
  }

  BRMap.addArea({ id: "crime", label: "Crime density",
    activate(ctx) {
      ctx.controls.innerHTML =
        '<select id="crimeYr"></select><div class="mut" id="crimeCount" style="margin:3px 0"></div>' +
        '<div id="crimeVio"></div><div id="crimePro"></div>' +
        '<label class="sub"><input type="checkbox" id="crimeDots"> Show individual incidents</label>';
      const ys = document.getElementById("crimeYr");
      ys.innerHTML = '<option value="all">All years</option>' + YEARS.map((y) => '<option value="' + y + '">' + y + "</option>").join("");
      ys.onchange = (e) => { selYear = e.target.value === "all" ? "all" : +e.target.value; draw(); };
      document.getElementById("crimeDots").onchange = (e) => { showDots = e.target.checked; draw(); };
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
      ctx.legend('<span class="sw">Fewer</span><span class="bar"></span><span class="sw">More incidents</span>');
      draw();
    },
    deactivate() { removeHeat(); removeDots(); }
  });
});
