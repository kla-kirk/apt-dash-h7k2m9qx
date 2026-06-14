/* REVIEW-STATUS module — filter the listing pins by type (For rent / For sale) and
   review status (Accepted / To review / Rejected), and surface accept/reject + a status
   badge inside the shared detail panel.

   As of the "first-class" wiring, the 102 review imports (review.json, id "nr…") are loaded
   into BRMap.listings by the shell (index.html) and drawn as ordinary 🏠 pins, so every
   per-listing layer (crime / flood / commute / amenities / air) attaches to them exactly as
   it does for the vetted set. This module therefore NO LONGER creates its own markers — it
   only (a) controls pin visibility by status, and (b) injects accept/reject controls + a status
   badge into the shared detail panel. Pin COLOR is owned entirely by the shell's color modes
   (default $/sqft, Crime, Pollution), so review status is conveyed via the filter + panel badge,
   not by tinting pins.

   - Vetted shell listings (ids r…) default to "accepted" and carry a rent/sale `type`.
   - Review imports (ids nr…, l._review) default to "needs" (to review) and are rentals.
   - Status is SHARED with needs_review.html via localStorage "nr_status_v1"
     {id:"accepted"|"rejected"|"needs"}.
   Owned by the listings/review chat. */
BRMap.ready(() => {
  const LS = "nr_status_v1";
  let status = {}; try { status = JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) {}
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(status)); } catch (e) {} };

  // ---- push accept/reject to the shared Google Sheet so it syncs server-wide (not just this browser) ----
  const PROXY_URL = "https://script.google.com/macros/s/AKfycbw55gSdiRxyNK2AKoeCLTtcLQhVW2rHBTIk0kInsbY2NMnOUN8QFpfsJM9RMHh4ekfdgA/exec";
  const _revOf = s => s === "needs" ? "review" : s;   // map vocab -> dashboard/server vocab
  function pushRev(id, s) {
    if (!PROXY_URL) return;
    try {
      fetch(PROXY_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "syncpatch", id: id, reviewState: _revOf(s), updatedAt: Date.now() }) });
    } catch (e) {}
  }

  const COL = { accepted: "#1E7A34", needs: "#9A6A00", rejected: "#B23B3B" };
  const lbl = s => s === "accepted" ? "Accepted" : s === "rejected" ? "Rejected" : "To review";
  const isRev = l => !!(l && (l._review || String(l.id).indexOf("nr") === 0));
  const defFor = id => (String(id).indexOf("nr") === 0) ? "needs" : "accepted";
  const stOf = id => status[id] || defFor(id);

  // ---- listing type (rent/sale): vetted carry .type; review imports are rentals ----
  const TYPE = {};
  (BRMap.listings || []).forEach(l => { TYPE[l.id] = (l.type === "sale") ? "sale" : "rent"; });
  const typeOf = id => TYPE[id] || "rent";

  // visibility = type master on AND that type's status box on.
  // Default: Accepted on; To-review + Rejected off.
  const typeOn = { rent: true, sale: true };
  const show = { rent: { accepted: true, needs: false, rejected: false },
                 sale: { accepted: true, needs: false, rejected: false } };
  const visible = id => typeOn[typeOf(id)] && show[typeOf(id)][stOf(id)];

  // ---- pin visibility (routed through the shell's shared filter system when present,
  //      so the sqft/beds/baths filter and this status filter compose instead of fighting) ----
  function apply() {
    if (typeof BRMap.setFilter === "function") { BRMap.setFilter("status", l => visible(l.id)); return; }
    (BRMap.listings || []).forEach(l => { const m = BRMap.pins[l.id]; if (!m) return;
      visible(l.id) ? m.addTo(BRMap.map) : BRMap.map.removeLayer(m); });
  }

  // ---- set status, persist, refresh pins + panel ----
  function setStatus(id, v) {
    status[id] = (status[id] === v ? defFor(id) : v); save();
    pushRev(id, status[id]);                         // sync to the shared sheet, not just localStorage
    apply();
    if (BRMap._selected && BRMap._selected.id === id) BRMap.refreshDetail();
    ui();
  }
  window.__rev = (id, v) => setStatus(id, v);   // back-compat for needs_review.html

  // ---- accept/reject + status badge inside the shared detail panel ----
  BRMap.onDetailRender((l, host) => {
    if (!isRev(l)) return;                         // only review imports are reviewable
    const s = stOf(l.id);
    const pop = host.querySelector(".pop") || host;
    const box = document.createElement("div");
    box.className = "row"; box.style.marginTop = "8px";
    box.innerHTML =
      '<span class="badge" style="background:' + COL[s] + '22;color:' + COL[s] + '">' + lbl(s) + '</span>' +
      '<div style="margin-top:6px;display:flex;gap:6px">' +
        '<button type="button" data-rev="accepted" style="flex:1;padding:4px 8px;border:1px solid #1E7A34;border-radius:6px;background:' +
          (s === "accepted" ? "#1E7A34;color:#fff" : "#fff;color:#1E7A34") + ';cursor:pointer">✓ Accept</button>' +
        '<button type="button" data-rev="rejected" style="flex:1;padding:4px 8px;border:1px solid #B23B3B;border-radius:6px;background:' +
          (s === "rejected" ? "#B23B3B;color:#fff" : "#fff;color:#B23B3B") + ';cursor:pointer">✕ Reject</button>' +
      '</div>';
    box.querySelectorAll("button[data-rev]").forEach(btn =>
      btn.addEventListener("click", () => setStatus(l.id, btn.getAttribute("data-rev"))));
    pop.appendChild(box);
  });

  // ---- filter UI ("Show listing pins") ----
  const sec = BRMap.section("review", "Show listing pins");
  function counts() {
    const c = { rent: { accepted: 0, needs: 0, rejected: 0, all: 0 }, sale: { accepted: 0, needs: 0, rejected: 0, all: 0 } };
    (BRMap.listings || []).forEach(l => { const t = typeOf(l.id); c[t][stOf(l.id)]++; c[t].all++; });
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
      + '<div style="margin-top:5px">' + group("sale", "For sale") + '</div>';
    sec.querySelectorAll("input").forEach(cb => cb.onchange = () => {
      const t = cb.dataset.type;
      if (cb.dataset.k) show[t][cb.dataset.k] = cb.checked;
      else typeOn[t] = cb.checked;
      apply();
    });
  }

  ui(); apply();

  // live-sync when the dashboard (another tab, same origin) changes accept/reject status
  window.addEventListener("storage", e => {
    if (e.key !== LS) return;
    try { status = JSON.parse(localStorage.getItem(LS)) || {}; } catch (_) {}
    apply(); ui(); if (BRMap._selected) BRMap.refreshDetail();
  });
});
