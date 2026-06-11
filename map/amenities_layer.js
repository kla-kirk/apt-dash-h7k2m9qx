/* AMENITIES layer module — owned by the "amenities" chat. Data: amenities.json = [[name,type,lat,lon]].
   Per-listing detail (BRMap.addDetail): on listing select, draws the nearest of each type within 1.6 mi as
   bold color-coded CIRCLE markers + bold name labels (pane-labels, above pins) joined to the home by a
   same-colored connector (pane-connect, below pins). Click an amenity → its own detail card (name, category,
   distance, approx walk/drive, Directions link). The card is a Leaflet *tooltip*, and amenity clicks
   stopPropagation, so opening one does NOT trip the shell's popupclose→deselect (which would wipe the markers).
   Also keeps a compact "nearby amenities" list in the shared listing popup. Auto-clears on deselect. */
BRMap.ready(async () => {
  const map = BRMap.map;
  const AM = await BRMap.fetchJSON("amenities.json"); if (!AM) { console.warn("amenities.json missing"); return; }

  const ICON  = { grocery: "🛒", pharmacy: "💊", school: "🏫", park: "🌳", hospital: "🏥", gym: "🏋" };
  const LABEL = { grocery: "Grocery", pharmacy: "Pharmacy", school: "School", park: "Park", hospital: "Hospital", gym: "Gym" };
  const COLOR = { grocery: "#E2701E", pharmacy: "#7E57C2", school: "#2D7FD6", park: "#2E9E4F", hospital: "#D5392F", gym: "#119B86" };
  const ORDER = ["grocery", "pharmacy", "school", "park", "hospital", "gym"];
  const RADIUS = 1.6;

  document.head.insertAdjacentHTML("beforeend", `<style>
  .am-mk{display:flex;flex-direction:column;align-items:center;pointer-events:none}
  .am-circle{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;color:#fff;border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45);pointer-events:auto;cursor:pointer}
  .am-name{margin-top:3px;font-size:12.5px;font-weight:700;line-height:1.25;background:rgba(255,255,255,.96);border:1px solid #B9C0CC;border-radius:6px;padding:0 6px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.25);pointer-events:auto;cursor:pointer}
  .leaflet-tooltip.am-card{pointer-events:auto;background:#fff;border:1px solid #C7CDD6;border-radius:10px;box-shadow:0 3px 14px rgba(16,24,40,.24);padding:10px 12px;width:210px;white-space:normal;font:inherit;color:#1F2733;opacity:1}
  .leaflet-tooltip.am-card:before{display:none}
  .am-card .amc-hd{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .am-card .amc-ic{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex:none}
  .am-card .amc-nm{font-size:13.5px;font-weight:700;line-height:1.15}
  .am-card .amc-meta{font-size:11.5px;color:#5A6472;margin-bottom:3px}
  .am-card .amc-times{font-size:12.5px;margin:3px 0 6px}
  .am-card .amc-times .ap{color:#9AA1AC;font-size:11px}
  .am-card .amc-link{font-size:12.5px;color:#2B5797;text-decoration:none;font-weight:600}
  .am-pop{margin-top:5px;padding-top:4px;border-top:1px solid #EEF1F5}
  .am-pop .amp-h{font-weight:700;color:#3A434F;font-size:10.5px;letter-spacing:.3px;text-transform:uppercase;margin-bottom:2px}
  .am-pop .amp-row{display:flex;align-items:center;gap:6px;font-size:12px;color:#28303A;padding:1px 0}
  .am-pop .amp-row .amp-nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .am-pop .amp-row .amp-d{color:#6B7280;font-size:11px;white-space:nowrap}
  </style>`);

  function hav(a, b, c, d) { const R = 3958.7613, r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
  function wd(mi) { return { w: Math.max(1, Math.round(mi * 20)), d: Math.max(1, Math.round(mi * 3.1)) }; } // 3mph walk; ~25mph drive w/ circuity
  function nearest(l) { const best = {}; for (const a of AM) { const t = a[1]; if (!COLOR[t]) continue;
    const d = hav(l.lat, l.lon, a[2], a[3]); if (d > RADIUS) continue; if (!best[t] || d < best[t].d) best[t] = { a, d }; } return best; }

  let marks = [], card = null, cardKey = null;
  function hideCard() { if (card) { map.removeLayer(card); card = null; cardKey = null; } }
  function cardHtml(a, d, l) { const t = a[1], td = wd(d);
    const dir = "https://www.google.com/maps/dir/?api=1&origin=" + l.lat + "," + l.lon + "&destination=" + a[2] + "," + a[3];
    return '<div class="amc-hd"><span class="amc-ic" style="background:' + COLOR[t] + '">' + ICON[t] + '</span><span class="amc-nm">' + a[0] + '</span></div>'
      + '<div class="amc-meta">' + LABEL[t] + ' · ' + d.toFixed(1) + ' mi from this listing</div>'
      + '<div class="amc-times">🚶 ' + td.w + ' min · 🚗 ' + td.d + ' min <span class="ap">(approx)</span></div>'
      + '<a class="amc-link" href="' + dir + '" target="_blank" rel="noopener">Directions ↗</a>'; }
  function showCard(a, d, l) { const key = a[0] + "@" + a[2] + "," + a[3];
    if (cardKey === key) { hideCard(); return; }
    hideCard();
    card = L.tooltip({ permanent: true, interactive: true, direction: "top", offset: [0, -20], className: "am-card", opacity: 1 })
      .setLatLng([a[2], a[3]]).setContent(cardHtml(a, d, l)).addTo(map);
    cardKey = key;
    const el = card.getElement(); if (el) L.DomEvent.on(el, "click dblclick mousedown", L.DomEvent.stopPropagation); }

  const clear = () => { marks.forEach((m) => map.removeLayer(m)); marks = []; hideCard(); };

  BRMap.addDetail({ id: "amen", label: "🛒 Amenities (nearest)", def: true,
    select(l) { clear();
      Object.values(nearest(l)).forEach((o) => { const a = o.a, t = a[1];
        marks.push(L.polyline([[l.lat, l.lon], [a[2], a[3]]],
          { pane: BRMap.panes.connect, interactive: false, color: COLOR[t], weight: 3, opacity: 0.85 }).addTo(map));
        const html = '<div class="am-mk"><div class="am-circle" style="background:' + COLOR[t] + '">' + ICON[t]
          + '</div><div class="am-name" style="color:' + COLOR[t] + '">' + a[0] + '</div></div>';
        const mk = L.marker([a[2], a[3]], { pane: BRMap.panes.labels, interactive: false,
          icon: L.divIcon({ className: "", html, iconSize: [150, 56], iconAnchor: [75, 16] }) }).addTo(map);
        const el = mk.getElement();
        if (el) { el.style.pointerEvents = "none";
          el.addEventListener("click", (ev) => { ev.stopPropagation(); showCard(a, o.d, l); }); }
        marks.push(mk); }); },
    clear });

  BRMap.addPopupRow((l) => { const n = nearest(l);
    const rows = ORDER.filter((t) => n[t]).map((t) =>
      '<div class="amp-row"><span>' + ICON[t] + '</span><span class="amp-nm">' + n[t].a[0] + '</span><span class="amp-d">' + n[t].d.toFixed(1) + 'mi</span></div>').join("");
    return rows ? '<div class="am-pop"><div class="amp-h">Nearby amenities</div>' + rows + '</div>' : ""; });
});
