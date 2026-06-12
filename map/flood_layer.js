/* FLOOD layer module.
   Data: flood_zones.geojson (FEMA polygons; properties FLD_ZONE, SFHA_TF, ZONE_SUBTY),
         listing_flood.json OPTIONAL {address:{fld_zone,sfha,static_bfe}} for popup rows.
   Registers a single-select map overlay "Flood zones" (shaded polygons in the areas pane,
   below pins) + a per-listing flood-risk popup row. No-ops gracefully if data is absent. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const gj = await BRMap.fetchJSON("flood_zones.geojson");
  const lf = await BRMap.fetchJSON("listing_flood.json");

  const ZC = { AE: "#2B6CB0", A: "#3182CE", AO: "#4299E1", AH: "#4299E1", VE: "#553C9A", V: "#553C9A", X: "#CBD5E0", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD": "#90CDF4" };
  const zcol = (p) => { const z = (p.FLD_ZONE || "").toUpperCase(); if (ZC[z]) return ZC[z]; if (z.indexOf("A") === 0) return "#2B6CB0"; if (z.indexOf("V") === 0) return "#553C9A"; return "#CBD5E0"; };

  // per-listing popup row (independent of the overlay being on)
  function inRing(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) != (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) c = !c; } return c; }
  function pip(lat, lon) { if (!gj) return null; for (const f of gj.features) { const g = f.geometry; if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) if (inRing(lon, lat, poly[0])) return f.properties; } return null; }
  BRMap.addPopupRow((l) => { let z = null, sfha = null;
    if (lf && lf[l.address]) { z = lf[l.address].fld_zone; sfha = lf[l.address].sfha; }
    else { const p = pip(l.lat, l.lon); if (p) { z = p.FLD_ZONE; sfha = p.SFHA_TF; } }
    if (!z) return ""; const hi = sfha === "T" || /^A|^V/.test((z || "").toUpperCase());
    return '<div class="row">Flood zone: <b style="color:' + (hi ? "#B23B3B" : "#1E7A34") + '">' + z + "</b>" + (hi ? " — Special Flood Hazard Area (insurance req.)" : " — minimal risk") + "</div>"; }, "env");

  if (!gj) { return; } // overlay needs the polygons; popup row above still works if pip data exists

  let layer = null;
  BRMap.addArea({ id: "flood", label: "Flood zones",
    activate(ctx) {
      layer = L.geoJSON(gj, { pane: BRMap.panes.areas,
        style: (f) => ({ color: zcol(f.properties), weight: 0.4, fillColor: zcol(f.properties), fillOpacity: f.properties.SFHA_TF === "T" ? 0.45 : 0.18 }),
        onEachFeature: (f, ly) => ly.bindPopup("Flood zone " + (f.properties.FLD_ZONE || "?") + (f.properties.SFHA_TF === "T" ? " (Special Flood Hazard Area)" : "")) }).addTo(map);
      ctx.legend('<span class="sw"><i class="sq" style="background:#2B6CB0"></i>A/AE high</span><span class="sw"><i class="sq" style="background:#553C9A"></i>V coastal</span><span class="sw"><i class="sq" style="background:#CBD5E0"></i>X minimal</span>');
    },
    deactivate() { if (layer) { map.removeLayer(layer); layer = null; } }
  });
});
