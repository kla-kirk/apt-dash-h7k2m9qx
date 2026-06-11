/* AMENITIES layer module. Data: amenities.json = [[name,type,lat,lon]].
   Per-listing detail: on listing select, draws the nearest of each type within 1.6 mi —
   labels go in the labels pane (above pins, never buried), connector lines in the connect
   pane (below pins). Auto-clears on deselect. Adds a "nearest grocery" popup row. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const AM = await BRMap.fetchJSON("amenities.json"); if (!AM) { console.warn("amenities.json missing"); return; }
  const ICON = { grocery: "🛒", pharmacy: "💊", school: "🏫", park: "🌳", hospital: "🏥", gym: "🏋" };
  function hav(a, b, c, d) { const R = 3958.7613, r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  function nearest(l) { const best = {}; for (const a of AM) { const d = hav(l.lat, l.lon, a[2], a[3]); if (d > 1.6) continue;
    if (!best[a[1]] || d < best[a[1]].d) best[a[1]] = { a, d }; } return best; }

  let marks = [];
  const clear = () => { marks.forEach((m) => map.removeLayer(m)); marks = []; };
  BRMap.addDetail({ id: "amen", label: "🛒 Amenities (nearest)", def: true,
    select(l) { clear();
      Object.values(nearest(l)).forEach((o) => { const a = o.a;
        marks.push(L.marker([a[2], a[3]], { pane: BRMap.panes.labels, interactive: false,
          icon: L.divIcon({ className: "", html: '<div class="amlbl">' + (ICON[a[1]] || "•") + " " + a[0] + " · " + o.d.toFixed(1) + "mi</div>" }) }).addTo(map));
        marks.push(L.polyline([[l.lat, l.lon], [a[2], a[3]]], { pane: BRMap.panes.connect, interactive: false, color: "#2B5797", weight: 1, opacity: 0.5, dashArray: "3,4" }).addTo(map)); }); },
    clear });

  BRMap.addPopupRow((l) => { const g = nearest(l).grocery; return g ? '<div class="row">Nearest grocery: ' + g.a[0] + " (" + g.d.toFixed(1) + "mi)</div>" : ""; });
});
