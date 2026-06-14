/* LISTING FILTER module (map) — the full Zillow-style filter set, sharing ONE
   predicate library (listing_filters.js → window.BRFilters) with the dashboard
   so the two surfaces can never disagree about whether a listing matches.

   The controls live in their OWN dedicated popup (a "Filters" button toggles a
   separate panel) so they don't crowd the layers overlay panel.

   - Registers a single composite predicate via BRMap.setFilter("listingFilters", …)
     so it COMPOSES (AND) with review_layer.js's "status" predicate.
   - Criteria are SHARED + PERSISTED with the dashboard via localStorage
     ("brfilters.v1"); BRFilters.subscribe live-syncs changes across open tabs.
   - Per-listing attributes the map's listings.json/review.json lack are gap-filled
     from filter_meta.json (authoritative mirror of the dashboard's values);
     commute minutes come from commute.json. Blanks stay blank → unknown-data
     listings always PASS (never dropped).
   - "Hidden" bin: filtered-out pins are removed by default; a toggle reveals them
     greyed (parallels the dashboard's Hidden tab). */
BRMap.ready(function () {
  if (typeof BRMap.setFilter !== "function") return;
  if (typeof BRFilters === "undefined") { console.warn("[filter_layer] listing_filters.js not loaded"); return; }

  var Ls = BRMap.listings || [];
  var crit = BRFilters.load();
  var showHidden = false;
  var open = false; try { open = localStorage.getItem("brfilters.panelOpen") === "1"; } catch (e) {}
  var META = {}, COMMUTE = {}, NORM = {};

  // ---- one-time style injection (the popup, chips, dim class, inputs) ----
  if (!document.getElementById("flt-style")) {
    var st = document.createElement("style"); st.id = "flt-style";
    st.textContent = [
      ".pin-ico.flt-hidden{opacity:.32;filter:grayscale(100%)}",
      // the verbose top-left hint is redundant now — reclaim the space for the Filters button
      ".hdr{display:none}",
      "#fltToggle{position:absolute;z-index:1001;top:10px;left:50px;display:flex;align-items:center;gap:7px;background:#fff;border:1px solid #E2E7EF;border-radius:10px;box-shadow:0 2px 10px rgba(16,24,40,.18);padding:8px 12px;font-family:inherit;font-size:13px;font-weight:700;color:#26303B;cursor:pointer}",
      "#fltToggle:hover{background:#F7F9FC}",
      "#fltToggle.on{background:#2563EB;color:#fff;border-color:#2563EB}",
      "#fltToggle .badge2{background:#2563EB;color:#fff;border-radius:999px;font-size:11px;font-weight:700;padding:0 6px;min-width:18px;text-align:center}",
      "#fltToggle.on .badge2{background:rgba(255,255,255,.28)}",
      "#fltToggle .badge2:empty{display:none}",
      "#fltPanel{position:absolute;z-index:1001;top:50px;left:50px;width:300px;max-height:calc(100% - 70px);overflow:auto;background:#fff;border:1px solid #E2E7EF;border-radius:10px;box-shadow:0 6px 24px rgba(16,24,40,.24);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12.5px;display:none}",
      "#fltPanel.open{display:block}",
      "#fltHead{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;font-weight:700;font-size:13px;background:#F7F9FC;border-bottom:1px solid #EEF1F5;border-radius:10px 10px 0 0;position:sticky;top:0}",
      "#fltClose{border:none;background:transparent;font-size:19px;line-height:1;color:#8A93A0;cursor:pointer;padding:0 5px;border-radius:6px}",
      "#fltClose:hover{background:#EEF1F5;color:#333}",
      "#fltBody{padding:10px 12px}",
      "#fltBody .st{font-weight:700;display:block;margin-bottom:5px}",
      "#fltBody label{display:flex;align-items:center;gap:6px;margin:3px 0;cursor:pointer;line-height:1.3}",
      "#fltBody .mut{color:#5A6472;font-size:11px;margin-top:2px}",
      "#fltBody .frow{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0}",
      "#fltBody input[type=number],#fltBody input[type=search],#fltBody select{padding:6px;border:1px solid #D9DEE6;border-radius:7px;font:inherit;width:100%}",
      "#fltBody .half{flex:1;min-width:0}",
      "#fltBody .nbbox{max-height:120px;overflow:auto;border:1px solid #EEF1F5;border-radius:7px;padding:4px 6px;margin-top:3px}",
      "#fltBody .nbbox label{font-weight:400;margin:2px 0}",
      "#fltBody .fchips{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}",
      "#fltBody .fchip{display:inline-flex;align-items:center;gap:4px;background:#EEF4FF;color:#1D4ED8;border:1px solid #D6E2FB;border-radius:999px;padding:1px 5px 1px 9px;font-size:11px;font-weight:600}",
      "#fltBody .fchip b{cursor:pointer;font-weight:700}",
      "#fltBody .fcount{font-size:11.5px;color:#3A434F;margin-top:8px;font-weight:600}",
      "#fltBody .fcount .hid{color:#9A6A00}",
      "#fltBody a.flink{color:#2563EB;cursor:pointer}",
      "#fltBody hr{border:none;border-top:1px solid #EEF1F5;margin:9px 0}",
      "@media(max-width:640px){#fltPanel{width:74vw}}"
    ].join("");
    document.head.appendChild(st);
  }

  // ---- normalize each listing (gap-fill from filter_meta + commute am) ----
  function normFor(l) {
    var meta = META[l.id] || META[l.address] || {};
    var raw = Object.assign({}, l, meta);            // filter_meta is authoritative (mirrors the dashboard)
    return BRFilters.normListing(raw, (COMMUTE[l.address] || {}).am);
  }
  function rebuildNorm() { NORM = {}; Ls.forEach(function (l) { NORM[l.id] = normFor(l); }); }
  function pass(l) { return BRFilters.passes(NORM[l.id] || normFor(l), crit); }
  function predicate(l) { return showHidden ? true : pass(l); }

  function applyDim() {
    Ls.forEach(function (l) {
      var m = BRMap.pins[l.id]; if (!m || !m._icon) return;
      m._icon.classList.toggle("flt-hidden", showHidden && !pass(l));
    });
  }
  if (!BRMap._fltWrapVis) {
    BRMap._fltWrapVis = true;
    var origVis = BRMap.applyVisibility.bind(BRMap);
    BRMap.applyVisibility = function () { origVis(); try { applyDim(); } catch (e) {} };
  }

  // ---- dedicated Filters popup (its own panel; NOT in the layers overlay) ----
  var toggleBtn = document.createElement("button");
  toggleBtn.id = "fltToggle"; toggleBtn.type = "button";
  toggleBtn.innerHTML = '<span>⚲ Filters</span><span class="badge2" id="fltBadge"></span>';
  document.body.appendChild(toggleBtn);
  var panel = document.createElement("div"); panel.id = "fltPanel";
  panel.innerHTML = '<div id="fltHead"><span>Filter listings</span><button id="fltClose" type="button" title="Close" aria-label="Close">×</button></div><div id="fltBody"></div>';
  document.body.appendChild(panel);
  var BODY = panel.querySelector("#fltBody");
  var $ = function (id) { return BODY.querySelector("#" + id); };

  function applyOpen() {
    panel.classList.toggle("open", open);
    toggleBtn.classList.toggle("on", open);
    try { localStorage.setItem("brfilters.panelOpen", open ? "1" : "0"); } catch (e) {}
  }
  function setOpen(v) {
    open = v;
    if (open) { try { BRMap.closeDetail && BRMap.closeDetail(); } catch (e) {} }  // don't stack over the listing panel
    applyOpen();
  }
  toggleBtn.onclick = function () { setOpen(!open); };
  panel.querySelector("#fltClose").onclick = function () { setOpen(false); };
  // selecting a listing closes the filter popup so the two never overlap
  if (typeof BRMap.onListingClick === "function") BRMap.onListingClick(function () { if (open) setOpen(false); });

  // ---- controls ----
  var nbs = (function () { var s = {}; Ls.forEach(function (l) { if (l.neighborhood) s[l.neighborhood] = 1; }); return Object.keys(s).sort(); })();
  function v(x) { return (x == null ? "" : x); }
  function bedOpts(id, cur, max, suf, any) {
    var h = '<select id="' + id + '" class="half"><option value="">' + any + "</option>";
    for (var nn = 1; nn <= max; nn++) h += '<option value="' + nn + '"' + (+cur === nn ? " selected" : "") + ">" + nn + suf + "</option>";
    return h + "</select>";
  }
  var COMMUTE_OPTS = [10, 15, 20, 25, 30, 45];
  function commuteSel(cur) {
    cur = BRFilters.clean({ maxCommute: cur }).maxCommute; var opts = COMMUTE_OPTS.slice();
    if (cur != null && opts.indexOf(cur) < 0) { opts.push(cur); opts.sort(function (a, b) { return a - b; }); }
    var h = '<select id="f_cm"><option value="">Commute: any</option>';
    opts.forEach(function (m) { h += '<option value="' + m + '"' + (cur === m ? " selected" : "") + ">≤ " + m + " min to LSU</option>"; });
    return h + "</select>";
  }

  function ui() {
    var nbSel = crit.neighborhoods || [];
    BODY.innerHTML =
      '<div class="frow"><input type="search" id="f_q" placeholder="Search address, area, notes…" value="' + esc(crit.keyword || "") + '"></div>' +
      '<div class="frow"><input type="number" id="f_pr" class="half" min="0" placeholder="Min rent $/mo" value="' + esc(v(crit.minPriceRent)) + '">' +
        '<input type="number" id="f_ps" class="half" min="0" placeholder="Min buy $k" value="' + esc(v(crit.minPriceSale)) + '"></div>' +
      '<div class="frow">' + bedOpts("f_bd", crit.minBeds, 5, "+ bd", "Beds: any") + bedOpts("f_ba", crit.minBaths, 4, "+ ba", "Baths: any") + '</div>' +
      '<div class="frow"><input type="number" id="f_sq" class="half" min="0" placeholder="Min sqft" value="' + esc(v(crit.minSize)) + '">' +
        '<input type="number" id="f_yr" class="half" min="0" placeholder="Built ≥ yr" value="' + esc(v(crit.minYear)) + '"></div>' +
      '<div class="mut" style="margin-top:6px">Commute to LSU (AM rush)</div>' +
      '<div class="frow">' + commuteSel(crit.maxCommute) + '</div>' +
      '<div class="frow"><input type="number" id="f_ls" class="half" min="0" placeholder="Max lease mo" value="' + esc(v(crit.maxLease)) + '"></div>' +
      '<label><input type="checkbox" id="f_fu"' + (crit.furnishedOnly ? " checked" : "") + "> Furnished</label>" +
      '<label><input type="checkbox" id="f_pt"' + (crit.petsOnly ? " checked" : "") + "> Pets allowed</label>" +
      '<label><input type="checkbox" id="f_off"' + (crit.excludeOff ? " checked" : "") + "> Hide off-market</label>" +
      '<div class="mut" style="margin-top:6px">Neighborhoods' + (nbSel.length ? " (" + nbSel.length + ")" : "") + "</div>" +
      '<div class="nbbox" id="f_nb">' + nbs.map(function (nb) {
        return '<label><input type="checkbox" value="' + esc(nb) + '"' + (nbSel.indexOf(nb) >= 0 ? " checked" : "") + "> " + esc(nb) + "</label>";
      }).join("") + "</div>" +
      '<div class="fcount" id="f_cnt"></div>' +
      '<div class="fchips" id="f_chips"></div>' +
      "<hr>" +
      '<label><input type="checkbox" id="f_sh"' + (showHidden ? " checked" : "") + "> Show hidden pins (greyed)</label>" +
      '<div style="margin-top:4px"><a class="flink" id="f_reset">Reset filters</a></div>';

    var chg = function (id, key) { var el = $(id); if (el) el.oninput = function (e) { crit[key] = e.target.value; commit(); }; };
    chg("f_q", "keyword"); chg("f_pr", "minPriceRent"); chg("f_ps", "minPriceSale");
    chg("f_sq", "minSize"); chg("f_yr", "minYear"); chg("f_ls", "maxLease");
    $("f_cm").onchange = function (e) { crit.maxCommute = e.target.value; commit(); };
    $("f_bd").onchange = function (e) { crit.minBeds = e.target.value; commit(); };
    $("f_ba").onchange = function (e) { crit.minBaths = e.target.value; commit(); };
    $("f_fu").onchange = function (e) { crit.furnishedOnly = e.target.checked; commit(); };
    $("f_pt").onchange = function (e) { crit.petsOnly = e.target.checked; commit(); };
    $("f_off").onchange = function (e) { crit.excludeOff = e.target.checked; commit(); };
    BODY.querySelectorAll("#f_nb input[type=checkbox]").forEach(function (cb) {
      cb.onchange = function () { var s = {}; (crit.neighborhoods || []).forEach(function (x) { s[x] = 1; });
        if (cb.checked) s[cb.value] = 1; else delete s[cb.value]; crit.neighborhoods = Object.keys(s); commit(); };
    });
    $("f_sh").onchange = function (e) { showHidden = e.target.checked; BRMap.setFilter("listingFilters", predicate); count(); };
    $("f_reset").onclick = function (ev) { ev.preventDefault(); crit = BRFilters.clean({}); commit(true); };
    chips(); count(); badge();
  }

  function commit(full) {
    crit = BRFilters.clean(crit);
    BRFilters.save(crit);
    rebuildNorm();
    BRMap.setFilter("listingFilters", predicate);    // → applyVisibility → applyDim
    if (full) ui(); else { chips(); count(); badge(); }
  }
  function badge() { var b = document.getElementById("fltBadge"); if (b) { var n = BRFilters.chips(crit).length; b.textContent = n ? n : ""; } }
  function chips() {
    var host = $("f_chips"); if (!host) return; var cs = BRFilters.chips(crit);
    host.innerHTML = cs.map(function (ch) {
      return '<span class="fchip">' + esc(ch.label) + ' <b data-k="' + esc(ch.key) + '" title="Remove">✕</b></span>';
    }).join("") + (cs.length ? ' <a class="flink" id="f_clr">Clear all</a>' : "");
    host.querySelectorAll("b[data-k]").forEach(function (b) {
      b.onclick = function () { crit = BRFilters.without(crit, b.getAttribute("data-k")); commit(true); };
    });
    var clr = $("f_clr"); if (clr) clr.onclick = function () { crit = BRFilters.clean({}); commit(true); };
  }
  function count() {
    var el = $("f_cnt"); if (!el) return;
    var visible = Ls.filter(function (l) { return BRMap.passesFilters(l); }).length;
    var failing = Ls.filter(function (l) { return !pass(l); }).length;
    el.innerHTML = visible + " of " + Ls.length + " pins shown" +
      (failing ? ' · <span class="hid">' + failing + " hidden by filters</span>" : "");
  }

  ui(); applyOpen();
  BRMap.setFilter("listingFilters", predicate);

  // ---- load companion data, then refresh ----
  Promise.all([BRMap.fetchJSON("filter_meta.json"), BRMap.fetchJSON("commute.json")]).then(function (res) {
    META = res[0] || {}; COMMUTE = res[1] || {};
    rebuildNorm();
    BRMap.setFilter("listingFilters", predicate);
    count();
  });

  // ---- cross-surface live sync (dashboard ⇄ map, other tabs) ----
  BRFilters.subscribe(function (c) { crit = BRFilters.clean(c); rebuildNorm(); BRMap.setFilter("listingFilters", predicate); ui(); });

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
});
