/* REVIEW-STATUS module — filter listing pins by type (For rent / For sale) and review status
   (Accepted / To review / Rejected).
   - Existing shell listings (the vetted set) default to "accepted" and carry a rent/sale `type`.
   - review.json = [{id,address,lat,lon,price,beds,baths,sqft,url}] holds the NEW Zillow imports
     (apartment listings → treated as rentals); they default to "needs" (to review).
   - Status is SHARED with needs_review.html via localStorage key "nr_status_v1"
     {id: "accepted"|"rejected"|"needs"}. Mark accept/reject from a pin popup.
   Owned by the listings/review chat. */
BRMap.ready(async () => {
  const LS = "nr_status_v1";
  let status = {}; try { status = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(status)); } catch (e) {} };
  const REV = (await BRMap.fetchJSON("review.json")) || [];
  const COL = { accepted: "#1E7A34", needs: "#9A6A00", rejected: "#B23B3B" };
  const lbl = s => s === "accepted" ? "Accepted" : s === "rejected" ? "Rejected" : "Needs review";
  const defFor = id => (String(id).indexOf("nr") === 0) ? "needs" : "accepted";
  const stOf = id => status[id] || defFor(id);

  // ---- listing type (rent/sale): vetted listings carry .type; review imports are rentals ----
  const TYPE = {};
  (BRMap.listings || []).forEach(l => { TYPE[l.id] = (l.type === "sale") ? "sale" : "rent"; });
  REV.forEach(l => { TYPE[l.id] = "rent"; });
  const typeOf = id => TYPE[id] || "rent";

  // visibility = type master on AND that type's status box on. Rejected hidden by default.
  const typeOn = { rent: true, sale: true };
  const show = { rent: { accepted: true, needs: true, rejected: false }, sale: { accepted: true, needs: true, rejected: false } };
  const visible = id => typeOn[typeOf(id)] && show[typeOf(id)][stOf(id)];

  // pins for the (geocoded) new imports — distinct square markers
  const revPins = {};
  function revIcon(id) { const c = COL[stOf(id)];
    return L.divIcon({ className: "", html: '<div style="width:14px;height:14px;border-radius:3px;background:' + c + ';border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }); }
  function popup(l) { const s = stOf(l.id);
    return '<div class="pop"><b>' + l.address + '</b> <span class="badge" style="background:' + COL[s] + '22;color:' + COL[s] + '">' + lbl(s) + '</span>' +
      '<div class="row">' + (l.price ? "$" + (+l.price).toLocaleString() + "/mo" : "") + (l.beds ? " · " + l.beds + "bd" : "") + (l.baths ? "/" + l.baths + "ba" : "") + (l.sqft ? " · " + (+l.sqft).toLocaleString() + "sf" : "") + '</div>' +
      (l.url ? '<div class="row"><a href="' + l.url + '" target="_blank" rel="noopener">Zillow ↗</a></div>' : "") +
      '<div class="row"><button onclick="window.__rev(\'' + l.id + '\',\'accepted\')">Accept</button> <button onclick="window.__rev(\'' + l.id + '\',\'rejected\')">Reject</button></div></div>'; }
  REV.forEach(l => { if (l.lat == null || l.lon == null) return;
    const m = L.marker([l.lat, l.lon], { icon: revIcon(l.id) }); m.bindPopup(() => popup(l)); revPins[l.id] = m; });

  function apply() {
    (BRMap.listings || []).forEach(l => { const m = BRMap.pins[l.id]; if (!m) return; visible(l.id) ? m.addTo(BRMap.map) : BRMap.map.removeLayer(m); });
    Object.entries(revPins).forEach(([id, m]) => { if (visible(id)) { m.setIcon(revIcon(id)); m.addTo(BRMap.map); } else BRMap.map.removeLayer(m); });
  }
  window.__rev = (id, v) => { status[id] = (status[id] === v ? defFor(id) : v); save(); apply(); BRMap.map.closePopup(); };

  const sec = BRMap.section("review", "Show listing pins");
  function counts() {
    const c = { rent: { accepted: 0, needs: 0, rejected: 0, all: 0 }, sale: { accepted: 0, needs: 0, rejected: 0, all: 0 } };
    const tally = id => { const t = typeOf(id); c[t][stOf(id)]++; c[t].all++; };
    (BRMap.listings || []).forEach(l => tally(l.id));
    REV.forEach(l => { if (l.lat != null) tally(l.id); });
    return c;
  }
  const STATUSES = [["accepted", "✓ Accepted", COL.accepted], ["needs", "◷ To review", COL.needs], ["rejected", "✕ Rejected", COL.rejected]];
  function ui() {
    const c = counts();
    const group = (type, label) =>
      '<label style="font-weight:700"><input type="checkbox" data-type="' + type + '"' + (typeOn[type] ? " checked" : "") + '> ' + label
        + ' <span class="mut" style="margin:0">(' + c[type].all + ')</span></label>'
      + '<div style="margin-left:18px">' + STATUSES.map(([k, t, col]) =>
        '<label><input type="checkbox" data-type="' + type + '" data-k="' + k + '"' + (show[type][k] ? " checked" : "")
          + '><span style="color:' + col + ';font-weight:600">' + t + '</span> <span class="mut" style="margin:0">(' + c[type][k] + ')</span></label>').join("") + '</div>';
    sec.innerHTML = '<span class="st">Show listing pins</span>'
      + group("rent", "For rent")
      + '<div style="margin-top:5px">' + group("sale", "For sale") + '</div>'
      + (REV.length ? "" : '<div class="mut">New Zillow imports show here once geocoded into review.json.</div>');
    sec.querySelectorAll("input").forEach(cb => cb.onchange = () => {
      const t = cb.dataset.type;
      if (cb.dataset.k) show[t][cb.dataset.k] = cb.checked;
      else typeOn[t] = cb.checked;
      apply(); ui();
    });
  }
  ui(); apply();
});
