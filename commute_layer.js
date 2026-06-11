/* COMMUTE layer module — owned by the "commute" chat.
   Editable files (map_site/): commute_layer.js, commute.json, commute_routes.geojson.
   Runtime data (fetched lazily, all absent-safe):
     commute.json = { "<address>": { am:Number, pm:Number, off:Number,
                      miles:{ am:Number, pm:Number, off:Number } } }
                    Times are real Mapbox traffic-aware drive times to LSU main campus:
                    am = depart 08:00 (driving-traffic), pm = depart 17:00, off = free-flow.
     commute_routes.geojson = FeatureCollection of AM-rush route LineStrings to LSU
                              (feature.properties = {address, am}).
   Provides: per-listing popup row with AM/PM/off-peak drive time + miles; a toggleable
   "commute bands" halo overlay (its own circleMarker layer — never recolors shared pins,
   so no clash with the crime module's setPinColor); a mode selector (AM/PM/off) that drives
   the halo coloring + the emphasized popup time; and the AM route drawn on listing click.
   No-ops gracefully when any data file is missing.
   Uses only the BRMap plugin API (ready/fetchJSON/section/addPopupRow/onListingClick/map/listings). */
BRMap.ready(async () => {
  const C = await BRMap.fetchJSON("commute.json");
  const G = await BRMap.fetchJSON("commute_routes.geojson");
  const sec = BRMap.section("commute", "Commute → LSU");

  if (!C) { sec.insertAdjacentHTML("beforeend",
    '<div class="mut">commute.json not uploaded yet.</div>'); return; }

  const modeMeta = { am: "AM rush", pm: "PM rush", off: "off-peak" };

  // ---------- color bands (minutes). Green→red; halos are opt-in so they won't
  // normally overlap the flood ring colors. ----------
  const BANDS = [
    { max: 10,       c: "#2F855A", label: "≤10" },
    { max: 15,       c: "#D69E2E", label: "11–15" },
    { max: 20,       c: "#DD6B20", label: "16–20" },
    { max: Infinity, c: "#C53030", label: ">20" }
  ];
  const bandOf = mins => BANDS.find(b => mins <= b.max);

  // route lookup by address
  const routes = {};
  if (G && Array.isArray(G.features))
    G.features.forEach(f => { const a = f && f.properties && f.properties.address; if (a) routes[a] = f; });

  let line = null, drawOn = true, mode = "am", current = null;
  const halos = L.layerGroup();
  let halosOn = false;

  // ---------- UI ----------
  sec.insertAdjacentHTML("beforeend",
    '<label><input type="checkbox" id="cmRoute" checked> 🛣 Draw AM route on click</label>' +
    '<label><input type="checkbox" id="cmHalo"> ◉ Color listings by commute</label>' +
    '<div class="sub">' +
      '<label><input type="radio" name="cmMode" value="am" checked> AM rush (8am)</label>' +
      '<label><input type="radio" name="cmMode" value="pm"> PM rush (5pm)</label>' +
      '<label><input type="radio" name="cmMode" value="off"> Off-peak</label>' +
    '</div>' +
    '<div class="mut" style="margin-top:5px">Drive time: ' +
      BANDS.map(b => '<i style="background:' + b.c + '"></i>' + b.label).join(" ") + ' min</div>' +
    '<div class="mut">Times = Mapbox traffic-aware drive to LSU.</div>');

  // ---------- halo overlay (own layer; no setPinColor) ----------
  function buildHalos() {
    halos.clearLayers();
    BRMap.listings.forEach(l => {
      const c = C[l.address]; if (!c) return;
      const mins = c[mode]; if (mins == null) return;
      const b = bandOf(mins);
      L.circleMarker([l.lat, l.lon], { radius: 13, color: b.c, weight: 2, opacity: 0.9,
        fillColor: b.c, fillOpacity: 0.22, interactive: false }).addTo(halos);
    });
  }

  document.getElementById("cmRoute").onchange = e => {
    drawOn = e.target.checked;
    if (!drawOn && line) { BRMap.map.removeLayer(line); line = null; }
  };
  document.getElementById("cmHalo").onchange = e => {
    halosOn = e.target.checked;
    if (halosOn) { buildHalos(); halos.addTo(BRMap.map); }
    else BRMap.map.removeLayer(halos);
  };
  document.querySelectorAll('input[name="cmMode"]').forEach(el => {
    el.onchange = e => { mode = e.target.value; if (halosOn) buildHalos(); refreshPopup(); };
  });

  BRMap.map.on("popupclose", () => { if (line) { BRMap.map.removeLayer(line); line = null; } });

  function refreshPopup() {
    if (!current) return;
    const pin = BRMap.pins[current.id];
    if (pin && pin.isPopupOpen && pin.isPopupOpen() && typeof basePopup === "function")
      pin.setPopupContent(basePopup(current));
  }

  // ---------- route on click (AM route only — that's all the geojson holds) ----------
  BRMap.onListingClick(l => {
    current = l;
    if (line) { BRMap.map.removeLayer(line); line = null; }
    const f = routes[l.address];
    if (!drawOn || !f) return;
    line = L.geoJSON(f, { style: { color: "#2B5797", weight: 4, opacity: 0.7 } }).addTo(BRMap.map);
  });

  // ---------- per-listing popup row ----------
  BRMap.addPopupRow(l => {
    const c = C[l.address]; if (!c) return "";
    const mins = c[mode];
    const mi = c.miles && c.miles[mode];
    const b = mins != null ? bandOf(mins) : null;
    const head = '<div class="row">→ LSU (' + modeMeta[mode] + '): ' +
      (mins != null ? '<b style="color:' + b.c + '">' + Math.round(mins) + ' min</b>' : '<b>—</b>') +
      (mi != null ? ' <span class="mut">· ' + mi.toFixed(1) + ' mi</span>' : '') + '</div>';
    const all = '<div class="row mut">AM ' + c.am + ' · PM ' + c.pm + ' · off ' + c.off + ' min</div>';
    return head + all;
  });
});
