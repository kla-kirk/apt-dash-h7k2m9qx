/* AMENITIES layer module — owned by the "amenities" chat. Data: amenities.json = [[name,type,lat,lon]].
   On listing select, draws the nearest of each type as bold color-coded CIRCLE markers + name labels
   (pane-labels) joined to the home by a dotted same-colored connector (pane-connect). MULTIPLE closest
   per type: grocery top-3, park top-2, all others nearest-1 (NCFG). The nearest is full-size; further
   options are smaller/lighter ("alt").
   CLICK an amenity (its map circle OR its row in the listing #info panel) → FOCUS mode: hides every other
   amenity, keeps just that one, and draws the REAL street route to it (precomputed by the commute module
   via window.BRCommute.drawAmenityRoute). Click the same amenity again, pick another, or use the card's
   "Show all nearby" link to exit focus. If a further option has no precomputed route yet, focus still
   isolates it and the card's "Directions" link gives the real route (commute regenerates the rest from
   amenity_route_targets.json). The card is a Leaflet tooltip (not a popup); its clicks stopPropagation so
   the listing stays selected. Panel rows are built via addPopupRow and wired through BRMap.onDetailRender. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const AM = await BRMap.fetchJSON("amenities.json"); if (!AM) { console.warn("amenities.json missing"); return; }

  const ICON  = { grocery: "🛒", pharmacy: "💊", school: "🏫", park: "🌳", hospital: "🏥", gym: "🏋" };
  const LABEL = { grocery: "Grocery", pharmacy: "Pharmacy", school: "School", park: "Park", hospital: "Hospital", gym: "Gym" };
  const COLOR = { grocery: "#E2701E", pharmacy: "#7E57C2", school: "#2D7FD6", park: "#2E9E4F", hospital: "#D5392F", gym: "#119B86" };
  const ORDER = ["grocery", "pharmacy", "school", "park", "hospital", "gym"];
  const NCFG  = { grocery: { n: 3, r: 2.5 }, park: { n: 2, r: 2.5 } };
  const cfg = (t) => NCFG[t] || { n: 1, r: 1.6 };

  document.head.insertAdjacentHTML("beforeend", `<style>
  .am-mk{display:flex;flex-direction:column;align-items:center;pointer-events:none}
  .am-circle{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45);pointer-events:auto;cursor:pointer}
  .am-circle.s2{width:25px;height:25px;font-size:13px;border-width:2px;opacity:.92}
  .am-name{margin-top:3px;font-size:12.5px;font-weight:700;line-height:1.25;background:rgba(255,255,255,.96);border:1px solid #B9C0CC;border-radius:6px;padding:0 6px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.25);pointer-events:auto;cursor:pointer}
  .am-name.s2{font-size:11px;font-weight:600;opacity:.95}
  .leaflet-tooltip.am-card{pointer-events:auto;background:#fff;border:1px solid #C7CDD6;border-radius:10px;box-shadow:0 3px 14px rgba(16,24,40,.24);padding:10px 12px;width:210px;white-space:normal;font:inherit;color:#1F2733;opacity:1}
  .leaflet-tooltip.am-card:before{display:none}
  .am-card .amc-hd{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .am-card .amc-ic{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex:none}
  .am-card .amc-nm{font-size:13.5px;font-weight:700;line-height:1.15}
  .am-card .amc-meta{font-size:11.5px;color:#5A6472;margin-bottom:3px}
  .am-card .amc-times{font-size:12.5px;margin:3px 0 6px}
  .am-card .amc-times .ap{color:#9AA1AC;font-size:11px}
  .am-card .amc-link{font-size:12.5px;color:#2B5797;text-decoration:none;font-weight:600}
  .am-card .amc-back{display:block;margin-top:7px;padding-top:6px;border-top:1px solid #EEF1F5;font-size:11.5px;color:#5A6472;cursor:pointer}
  .am-card .amc-back:hover{color:#2B5797}
  .am-pop{margin-top:5px;padding-top:4px;border-top:1px solid #EEF1F5}
  .am-pop .amp-h{font-weight:700;color:#3A434F;font-size:10.5px;letter-spacing:.3px;text-transform:uppercase;margin-bottom:2px}
  .am-pop .amp-row{display:flex;align-items:center;gap:6px;font-size:12px;color:#28303A;padding:2px 4px;margin:0 -4px;border-radius:5px;cursor:pointer}
  .am-pop .amp-row.alt{color:#5A6472}
  .am-pop .amp-row:hover{background:#EFF4FA}
  .am-pop .amp-row .amp-ic{width:15px;text-align:center;flex:none}
  .am-pop .amp-row .amp-nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .am-pop .amp-row .amp-d{color:#6B7280;font-size:11px;white-space:nowrap}
  .am-pop .amp-row .amp-go{color:#9AA1AC;font-size:13px;font-weight:700;margin-left:1px}
  </style>`);

  function hav(a, b, c, d) { const R = 3958.7613, r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  function wd(mi) { return { w: Math.max(1, Math.round(mi * 20)), d: Math.max(1, Math.round(mi * 3.1)) }; }
  function nearestByType(l) { const by = {};
    for (const a of AM) { const t = a[1]; if (!COLOR[t]) continue; const d = hav(l.lat, l.lon, a[2], a[3]); if (d > cfg(t).r) continue; (by[t] = by[t] || []).push({ a, d }); }
    for (const t in by) { by[t].sort((p, q) => p.d - q.d); by[t] = by[t].slice(0, cfg(t).n); }
    return by; }
  const keyOf = (a) => a[0] + "@" + a[2] + "," + a[3];

  let items = [], card = null, focusedKey = null;
  function hideCard() { if (card) { map.removeLayer(card); card = null; } }
  function clearRoute() { try { if (window.BRCommute && BRCommute.clearAmenityRoute) BRCommute.clearAmenityRoute(); } catch (e) {} }
  function cardHtml(a, d, l) { const t = a[1], td = wd(d);
    const dir = "https://www.google.com/maps/dir/?api=1&origin=" + l.lat + "," + l.lon + "&destination=" + a[2] + "," + a[3];
    return '<div class="amc-hd"><span class="amc-ic" style="background:' + COLOR[t] + '">' + ICON[t] + '</span><span class="amc-nm">' + a[0] + '</span></div>'
      + '<div class="amc-meta">' + LABEL[t] + ' · ' + d.toFixed(1) + ' mi from this listing</div>'
      + '<div class="amc-times">🚶 ' + td.w + ' min · 🚗 ' + td.d + ' min <span class="ap">(approx)</span></div>'
      + '<a class="amc-link" href="' + dir + '" target="_blank" rel="noopener">Directions ↗</a>'
      + '<a class="amc-back">↩ Show all nearby</a>'; }
  function revealCard(ll) { try {
    const mc = map.getContainer(), mr = mc.getBoundingClientRect();
    const el = card && card.getElement(); if (!el) return;
    const cr = el.getBoundingClientRect();
    const pop = document.getElementById("info"); const pr = (pop && pop.style.display !== "none") ? pop.getBoundingClientRect() : null;
    const offscreen = cr.left < mr.left + 8 || cr.right > mr.right - 8 || cr.top < mr.top + 8 || cr.bottom > mr.bottom - 8;
    const underPanel = pr && !(cr.right < pr.left || cr.left > pr.right || cr.bottom < pr.top || cr.top > pr.bottom);
    if (!offscreen && !underPanel) return;
    const size = map.getSize(), cp = map.latLngToContainerPoint(ll);
    const want = L.point(Math.max(size.x * 0.6, 360), size.y * 0.5);
    map.panBy(cp.subtract(want), { animate: true });
  } catch (e) {} }
  function showCard(a, d, l) { hideCard();
    card = L.tooltip({ permanent: true, interactive: true, direction: "top", offset: [0, -20], className: "am-card", opacity: 1 })
      .setLatLng([a[2], a[3]]).setContent(cardHtml(a, d, l)).addTo(map);
    const el = card.getElement();
    if (el) { L.DomEvent.on(el, "click dblclick mousedown", L.DomEvent.stopPropagation);
      const back = el.querySelector(".amc-back"); if (back) back.addEventListener("click", (ev) => { ev.preventDefault(); unfocus(); }); }
    setTimeout(() => revealCard(L.latLng(a[2], a[3])), 30); }

  function showAll() { items.forEach((it) => { if (!map.hasLayer(it.mk)) it.mk.addTo(map); if (!map.hasLayer(it.line)) it.line.addTo(map); }); }
  function unfocus() { focusedKey = null; hideCard(); clearRoute(); showAll(); }
  // FOCUS: hide every other amenity, keep the selected marker, draw its real street route
  function focusAmenity(a, d, l) { const key = keyOf(a);
    if (focusedKey === key) { unfocus(); return; }
    focusedKey = key;
    items.forEach((it) => { const sel = it.key === key;
      if (map.hasLayer(it.line)) map.removeLayer(it.line);          // connectors hidden in focus mode
      if (sel) { if (!map.hasLayer(it.mk)) it.mk.addTo(map); }
      else if (map.hasLayer(it.mk)) map.removeLayer(it.mk); });
    showCard(a, d, l); clearRoute();
    try { if (window.BRCommute && BRCommute.drawAmenityRoute) BRCommute.drawAmenityRoute(l.address, a[0]); } catch (e) {} }

  const clear = () => { items.forEach((it) => { map.removeLayer(it.line); map.removeLayer(it.mk); }); items = []; hideCard(); clearRoute(); focusedKey = null; };

  BRMap.addDetail({ id: "amen", label: "🛒 Amenities (nearest)", def: true,
    select(l) { clear(); const by = nearestByType(l);
      ORDER.forEach((t) => { const arr = by[t]; if (!arr) return;
        arr.forEach((o, i) => { const a = o.a, alt = i > 0;
          const line = L.polyline([[l.lat, l.lon], [a[2], a[3]]],
            { pane: BRMap.panes.connect, interactive: false, color: COLOR[t], weight: alt ? 2 : 3, opacity: alt ? 0.55 : 0.85, dashArray: "2,5" }).addTo(map);
          const html = '<div class="am-mk"><div class="am-circle' + (alt ? " s2" : "") + '" style="background:' + COLOR[t] + '">' + ICON[t]
            + '</div><div class="am-name' + (alt ? " s2" : "") + '" style="color:' + COLOR[t] + '">' + a[0] + '</div></div>';
          const mk = L.marker([a[2], a[3]], { pane: BRMap.panes.labels, interactive: false,
            icon: L.divIcon({ className: "", html, iconSize: [160, 56], iconAnchor: [80, 16] }) }).addTo(map);
          const el = mk.getElement();
          if (el) { el.style.pointerEvents = "none";
            el.addEventListener("click", (ev) => { ev.stopPropagation(); focusAmenity(a, o.d, l); }); }
          items.push({ a, d: o.d, line, mk, key: keyOf(a) }); }); }); },
    clear });

  BRMap.addPopupRow((l) => { const by = nearestByType(l); let rows = "";
    ORDER.forEach((t) => { const arr = by[t]; if (!arr) return;
      arr.forEach((o, i) => { rows += '<div class="amp-row' + (i ? " alt" : "") + '" data-t="' + t + '" data-i="' + i + '">'
        + '<span class="amp-ic">' + (i ? "" : ICON[t]) + '</span><span class="amp-nm">' + o.a[0] + '</span>'
        + '<span class="amp-d">' + o.d.toFixed(1) + 'mi</span><span class="amp-go">›</span></div>'; }); });
    return rows ? '<div class="am-pop"><div class="amp-h">Nearby amenities</div>' + rows + '</div>' : ""; });

  // make the listing-panel amenity rows clickable: focus that amenity (migrated from popupopen)
  if (BRMap.onDetailRender) BRMap.onDetailRender((l, root) => { const by = nearestByType(l);
    root.querySelectorAll(".am-pop .amp-row").forEach((row) => {
      const arr = by[row.getAttribute("data-t")]; const o = arr && arr[+row.getAttribute("data-i")]; if (!o) return;
      L.DomEvent.on(row, "click", (ev) => { L.DomEvent.stop(ev); focusAmenity(o.a, o.d, l); });
    });
  });
});
