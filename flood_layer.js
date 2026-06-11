/* FLOOD layer module — owned by the "flood" chat.
   Editable files (map_site/): flood_layer.js, flood_zones.geojson, listing_flood.json.
   Runtime data (fetched lazily, all absent-safe):
     flood_zones.geojson : FeatureCollection of FEMA NFHL flood polygons. feature.properties:
                           FLD_ZONE ("AE","A","AO","AH","VE","X",...), SFHA_TF ("T"/"F"),
                           ZONE_SUBTY, STATIC_BFE.
     listing_flood.json  : {address:{fld_zone,sfha,static_bfe,subtype,risk,score}} per listing.
     flood_2016.geojson  : OPTIONAL USGS Aug-2016 inundation extent (historical overlay).
   Provides: per-listing flood-risk popup row (tier + zone note + score), a toggleable
   shaded zone overlay, a toggleable ring-highlight of High/Highest listings (its own
   layer — never recolors shared pins, so no clash with the crime module), and a stubbed
   2016-flood overlay toggle. No-ops gracefully when any data file is missing.
   Uses only the BRMap plugin API (ready/fetchJSON/section/addPopupRow/map/listings). */
BRMap.ready(async () => {
  const sec = BRMap.section("flood", "Flood");

  // ---------- risk model ----------
  // Tier colors are RISK colors (green->red->purple); zone-shading colors below follow
  // FEMA's blue/purple water cartography, kept deliberately distinct from risk colors.
  const TIER = {
    Highest:  { c: "#6B46C1", s: 100 },
    High:     { c: "#C53030", s: 80  },
    Moderate: { c: "#2B6CB0", s: 45  },
    Low:      { c: "#2F855A", s: 15  },
    Unknown:  { c: "#A0AEC0", s: null }
  };
  const isShadedX = t => /0\.2 ?PCT|0\.2%|SHADED/i.test(t || "");
  function tierOf(zone, subty, sfha) {
    const z = (zone || "").toUpperCase().trim();
    if (/^V/.test(z)) return "Highest";
    if (/^A/.test(z) || sfha === true || sfha === "T") return "High";
    if (z === "X" && isShadedX(subty)) return "Moderate";
    if (z === "X") return "Low";
    return "Unknown";
  }
  function zoneNote(z, subty, tier) {
    z = (z || "").toUpperCase();
    if (tier === "Highest") return "Zone " + z + " — coastal high-velocity (insurance req.)";
    if (tier === "High")    return "Zone " + z + " — Special Flood Hazard Area (insurance req.)";
    if (tier === "Moderate") return "Zone X — 0.2% annual chance (shaded / 500-yr)";
    if (tier === "Low")     return /LEVEE/i.test(subty || "") ? "Zone X — reduced risk behind levee"
                                                              : "Zone X — minimal hazard";
    return "Zone " + (z || "?") + " — undetermined";
  }

  // ---------- data (absent-safe) ----------
  const gj = await BRMap.fetchJSON("flood_zones.geojson");
  const lf = await BRMap.fetchJSON("listing_flood.json");

  // point-in-polygon (only used when listing_flood.json is absent)
  function inRing(x, y, ring) { let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    } return c; }
  function pip(lat, lon) { if (!gj) return null;
    for (const f of gj.features) { const g = f.geometry; if (!g) continue;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) { if (inRing(lon, lat, poly[0])) return f.properties; } }
    return null; }

  // resolve a listing -> {z,subty,sfha,bfe,tier} or null.
  // DYNAMIC: prefers the listing_flood.json cache, but any listing NOT in the cache
  // (e.g. newly added to listings.json) is resolved live via point-in-polygon against
  // flood_zones.geojson. So new listings need no flood-code or cache changes — add them
  // to the Sheet/listings.json, redeploy, reload, and they pick up a tier automatically.
  function resolve(l) {
    let z = null, subty = null, sfha = null, bfe = null;
    if (lf && lf[l.address]) { const r = lf[l.address]; z = r.fld_zone; subty = r.subtype; sfha = r.sfha; bfe = r.static_bfe; }
    else { const p = pip(l.lat, l.lon); if (p) { z = p.FLD_ZONE; subty = p.ZONE_SUBTY; sfha = p.SFHA_TF; bfe = p.STATIC_BFE; } }
    if (z == null) return null;
    return { z, subty, sfha, bfe, tier: tierOf(z, subty, sfha) };
  }

  // ---------- per-listing popup row ----------
  BRMap.addPopupRow(l => {
    const r = resolve(l); if (!r) return "";
    const t = TIER[r.tier];
    const bfe = (r.bfe != null && r.bfe !== -9999) ? " · BFE " + r.bfe + " ft" : "";
    const sc  = (t.s != null) ? ' <span style="color:#5A6472">(score ' + t.s + ')</span>' : "";
    return '<div class="row">Flood risk: <b style="color:' + t.c + '">' + r.tier + '</b>' + sc +
           '<br><span style="color:#5A6472">' + zoneNote(r.z, r.subty, r.tier) + bfe + '</span></div>';
  });

  // ---------- shaded zone overlay (needs flood_zones.geojson) ----------
  const ZC = { AE:"#2B6CB0", A:"#3182CE", AO:"#4299E1", AH:"#4299E1", AR:"#3182CE", A99:"#3182CE", VE:"#553C9A", V:"#553C9A", X:"#CBD5E0" };
  function zcol(p) { const z = (p.FLD_ZONE || "").toUpperCase();
    if (z === "X" && isShadedX(p.ZONE_SUBTY)) return "#90CDF4";
    if (ZC[z]) return ZC[z];
    if (z[0] === "V") return "#553C9A";
    if (z[0] === "A") return "#2B6CB0";
    return "#CBD5E0"; }
  let zoneLayer = null;
  if (gj) {
    zoneLayer = L.geoJSON(gj, {
      style: f => ({ color: zcol(f.properties), weight: 0.4, fillColor: zcol(f.properties),
                     fillOpacity: (f.properties.SFHA_TF === "T") ? 0.45 : 0.18 }),
      onEachFeature: (f, ly) => ly.bindPopup("Flood zone " + (f.properties.FLD_ZONE || "?") +
        (f.properties.SFHA_TF === "T" ? " (Special Flood Hazard Area)" : ""))
    });
  }

  // ---------- ring-highlight of High/Highest listings (own layer; no setPinColor) ----------
  const rings = L.layerGroup();
  BRMap.listings.forEach(l => { const r = resolve(l); if (!r) return;
    if (r.tier === "High" || r.tier === "Highest") {
      L.circleMarker([l.lat, l.lon], { radius: 20, color: TIER[r.tier].c, weight: 3,
        opacity: 0.9, fill: false, interactive: false }).addTo(rings); } });

  // ---------- elevation-relief overlay (toggleable hillshade; complements the
  // shell's "Topographic (elevation)" base option, but works over ANY base) ----------
  const hill = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    { opacity: 0.5, maxZoom: 19, attribution: "Hillshade &copy; Esri" });

  // ---------- UI ----------
  const zoneDis = gj ? "" : ' disabled title="flood_zones.geojson not uploaded yet"';
  sec.insertAdjacentHTML("beforeend",
    '<label><input type="checkbox" id="flZone"' + zoneDis + '> 🌊 Flood-zone shading' + (gj ? "" : ' <span class="mut">(pending)</span>') + '</label>' +
    '<label><input type="checkbox" id="flRing"> ◎ Ring high-risk listings</label>' +
    '<label><input type="checkbox" id="flHill"> ⛰ Elevation shading</label>' +
    '<label><input type="checkbox" id="fl2016"> 〜 2016 flood extent</label>' +
    '<div class="mut" style="margin-top:5px">Risk: ' +
      '<i style="background:' + TIER.Highest.c + '"></i>Highest ' +
      '<i style="background:' + TIER.High.c + '"></i>High ' +
      '<i style="background:' + TIER.Moderate.c + '"></i>Mod ' +
      '<i style="background:' + TIER.Low.c + '"></i>Low</div>' +
    '<div class="mut">Zones: <i style="background:#2B6CB0"></i>A/AE ' +
      '<i style="background:#553C9A"></i>V <i style="background:#90CDF4"></i>shaded-X ' +
      '<i style="background:#CBD5E0"></i>X</div>');

  const elZone = document.getElementById("flZone");
  if (elZone) elZone.onchange = e => { if (!zoneLayer) return;
    e.target.checked ? zoneLayer.addTo(BRMap.map) : BRMap.map.removeLayer(zoneLayer); };

  document.getElementById("flRing").onchange = e => {
    e.target.checked ? rings.addTo(BRMap.map) : BRMap.map.removeLayer(rings); };

  document.getElementById("flHill").onchange = e => {
    e.target.checked ? hill.addTo(BRMap.map) : BRMap.map.removeLayer(hill); };

  // 2016 historical overlay — lazy-loaded; data deferred (lowest priority)
  let l2016 = null, tried2016 = false;
  document.getElementById("fl2016").onchange = async e => {
    if (e.target.checked) {
      if (!tried2016) { tried2016 = true;
        const g = await BRMap.fetchJSON("flood_2016.geojson");
        if (g) l2016 = L.geoJSON(g, { style: { color: "#1D4ED8", weight: 0.5, fillColor: "#1D4ED8", fillOpacity: 0.30 } }); }
      if (l2016) l2016.addTo(BRMap.map);
      else { e.target.checked = false;
        if (!sec.querySelector("#fl2016note"))
          sec.insertAdjacentHTML("beforeend", '<div class="mut" id="fl2016note">2016 inundation layer not uploaded yet.</div>'); }
    } else if (l2016) { BRMap.map.removeLayer(l2016); }
  };
});
