/* REVIEW-STATUS module — filter the listing pins by type (For rent / For sale) and review status
   (Accepted / To review / Rejected), and surface accept/reject + a status badge in the detail panel.

   SYNC: accept/reject now flows through BRSync — the SAME event-sourced store the dashboard uses
   (see SYNC_DESIGN.md). There is no longer a separate "nr_status_v1" localStorage mirror or a
   "syncpatch" POST; both were sources of drift. The map is a first-class read/write client of the
   op-log: a rejection here reaches the server and the dashboard (and Jamie) exactly like a dashboard
   edit, and remote edits flow back here live via BRSync.onChange.

   Review STATE is stored on the shared `reviewState` field in dashboard vocabulary
   ("accepted" | "review" | "rejected"). The map UI keeps its own label "needs" = "To review".
   Owned by the listings/review chat. */
BRMap.ready(() => {
  const PROXY_URL = "https://script.google.com/macros/s/AKfycbw55gSdiRxyNK2AKoeCLTtcLQhVW2rHBTIk0kInsbY2NMnOUN8QFpfsJM9RMHh4ekfdgA/exec";

  // ---- shared BRSync instance (one per page; reused if another layer already made it) ----
  function makeSync() {
    if (window.__brsync) return window.__brsync;
    if (typeof BRSyncCore === "undefined") return null;           // sync_client.js not loaded -> degrade gracefully
    let user = null; try { user = localStorage.getItem("brsync.user.v1"); } catch (e) {}
    if (user !== "keegan" && user !== "jamie") {
      try { user = (prompt("Who is using this map? Type  keegan  or  jamie:", "") || "").trim().toLowerCase(); } catch (e) {}
      if (user !== "keegan" && user !== "jamie") user = "keegan";
      try { localStorage.setItem("brsync.user.v1", user); } catch (e) {}
    }
    const build = (typeof window !== "undefined" && window.__BRSYNC_BUILD__) || "map-dev";
    const s = BRSyncCore.createBRSync({ user, proxyUrl: PROXY_URL, buildId: build, storage: BRSyncCore.lsStorage(), net: BRSyncCore.fetchNet(PROXY_URL) });
    window.__brsync = s;
    // ONE-TIME migration BEFORE the first sync: if the map opens first after cutover, this captures
    // this browser's saved map decisions (nr_status_v1) AND any dashboard decisions (br_listings_v2)
    // into the op-log so they are never lost. Shared flag with the dashboard -> runs at most once.
    try { const n = s.migrateOnce(); if (n) console.log("BRSync migration (map): emitted " + n + " ops from existing local data"); } catch (e) {}
    s.init({ pollMs: 8000 });
    window.addEventListener("online", () => { try { s.flush(); } catch (e) {} });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { try { s.flush(); } catch (e) {} } });
    return s;
  }
  const sync = makeSync();

  // ---- vocab: dashboard reviewState <-> map status ----
  const m2d = { accepted: "accepted", needs: "review", rejected: "rejected" };   // map UI -> stored
  const d2m = { accepted: "accepted", review: "needs", rejected: "rejected" };    // stored -> map UI
  const COL = { accepted: "#1E7A34", needs: "#9A6A00", rejected: "#B23B3B" };
  const lbl = s => s === "accepted" ? "Accepted" : s === "rejected" ? "Rejected" : "To review";
  const isRev = l => !!(l && (l._review || String(l.id).indexOf("nr") === 0));
  const defFor = id => (String(id).indexOf("nr") === 0) ? "needs" : "accepted";
  function stOf(id) {                                              // current map-vocab status from the folded op-log
    const rs = sync ? (sync.stateFor(id).reviewState) : null;
    return rs && d2m[rs] ? d2m[rs] : defFor(id);
  }

  // ---- listing type (rent/sale): vetted carry .type; review imports are rentals ----
  const TYPE = {};
  (BRMap.listings || []).forEach(l => { TYPE[l.id] = (l.type === "sale") ? "sale" : "rent"; });
  const typeOf = id => TYPE[id] || "rent";

  const typeOn = { rent: true, sale: true };
  const show = { rent: { accepted: true, needs: false, rejected: false },
                 sale: { accepted: true, needs: false, rejected: false } };
  const visible = id => typeOn[typeOf(id)] && show[typeOf(id)][stOf(id)];

  function apply() {
    if (typeof BRMap.setFilter === "function") { BRMap.setFilter("status", l => visible(l.id)); return; }
    (BRMap.listings || []).forEach(l => { const m = BRMap.pins[l.id]; if (!m) return;
      visible(l.id) ? m.addTo(BRMap.map) : BRMap.map.removeLayer(m); });
  }

  // ---- set status -> emit an op on the shared `reviewState` field (toggles back to default) ----
  function setStatus(id, v) {
    const next = (stOf(id) === v) ? defFor(id) : v;               // tap again to clear -> default
    if (sync) sync.edit(id, "reviewState", m2d[next]);           // dashboard vocab on the wire
    apply();
    if (BRMap._selected && BRMap._selected.id === id) BRMap.refreshDetail();
    ui();
  }
  window.__rev = (id, v) => setStatus(id, v);                     // back-compat for needs_review.html

  // ---- accept/reject + status badge inside the shared detail panel ----
  BRMap.onDetailRender((l, host) => {
    if (!isRev(l)) return;
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

  // live-sync: when ops arrive (this user elsewhere, or Jamie), refresh pins + panel + counts.
  if (sync) sync.onChange(() => { apply(); ui(); if (BRMap._selected) BRMap.refreshDetail(); });
});
