/* LISTING FILTER module (map) — the full Zillow-style filter set, sharing ONE
   predicate library (listing_filters.js → window.BRFilters) with the dashboard
   so the two surfaces can never disagree about whether a listing matches.

   - Registers a single composite predicate via BRMap.setFilter("listingFilters", …)
     so it COMPOSES (AND) with review_layer.js's "status" predicate.
   - Criteria are SHARED + PERSISTED with the dashboard through localStorage
     ("brfilters.v1"); BRFilters.subscribe live-syncs changes across open tabs.
   - Per-listing attributes the map's listings.json/review.json lack
     (yearBuilt/furnished/petFees/minLease/notes) are gap-filled from
     filter_meta.json; commute minutes come from commute.json — both real data,
     blanks stay blank so unknown-data listings always PASS (never dropped).
   - "Hidden" bin: filtered-out pins are removed by default, but a toggle reveals
     them greyed (parallels the dashboard's Hidden tab) so nothing ever silently
     disappears. */
BRMap.ready(function () {
  if (typeof BRMap.setFilter !== "function") return;          // shell without the shared filter system
  if (typeof BRFilters === "undefined") { console.warn("[filter_layer] listing_filters.js not loaded"); return; }

  var Ls = BRMap.listings || [];
  var crit = BRFilters.load();        // shared, persisted criteria
  var showHidden = false;             // map "Hidden" bin: reveal filtered-out pins greyed
  var META = {}, COMMUTE = {}, NORM = {};

  // ---- one-time style injection (chips, dim class, compact inputs) ----
  if (!document.getElementById("flt-style")) {
    var st = document.createElement("style"); st.id = "flt-style";
    st.textContent =
      ".pin-ico.flt-hidden{opacity:.32;filter:grayscale(100%)}" +
      "#secFilter .frow{display:flex;gap:6px;flex-wrap:wrap;margin:3px 0}" +
      "#secFilter input[type=number],#secFilter input[type=search]{padding:5px;border:1px solid #D9DEE6;border-radius:7px;font:inherit;width:100%}" +
      "#secFilter .half{flex:1;min-width:0}" +
      "#secFilter .nbbox{max-height:118px;overflow:auto;border:1px solid #EEF1F5;border-radius:7px;padding:4px 6px;margin-top:3px}" +
      "#secFilter .nbbox label{font-weight:400;margin:2px 0}" +
      "#secFilter .fchips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}" +
      "#secFilter .fchip{display:inline-flex;align-items:center;gap:4px;background:#EEF4FF;color:#1D4ED8;border:1px solid #D6E2FB;border-radius:999px;padding:1px 5px 1px 8px;font-size:10.5px;font-weight:600}" +
      "#secFilter .fchip b{cursor:pointer;font-weight:700}" +
      "#secFilter .fcount{font-size:11px;color:#3A434F;margin-top:6px;font-weight:600}" +
      "#secFilter .fcount .hid{color:#9A6A00}" +
      "#secFilter a.flink{color:#2563EB;cursor:pointer}";
    document.head.appendChild(st);
  }

  // ---- normalize each listing (gap-fill from filter_meta + commute am) ----
  function normFor(l) {
    var meta = META[l.id] || META[l.address] || {};
    var raw = Object.assign({}, l, meta);             // filter_meta is authoritative (mirrors the dashboard's enriched values)
    var cm = COMMUTE[l.address] || {};
    return BRFilters.normListing(raw, cm.am);
  }
  function rebuildNorm() { NORM = {}; Ls.forEach(function (l) { NORM[l.id] = normFor(l); }); }
  function pass(l) { return BRFilters.passes(NORM[l.id] || normFor(l), crit); }
  function predicate(l) { return showHidden ? true : pass(l); }   // when showing hidden, keep all (we dim instead)

  // ---- dim filtered-out pins when the Hidden bin is revealed ----
  function applyDim() {
    Ls.forEach(function (l) {
      var m = BRMap.pins[l.id]; if (!m || !m._icon) return;
      m._icon.classList.toggle("flt-hidden", showHidden && !pass(l));
    });
  }
  if (!BRMap._fltWrapVis) {                        // re-dim after every visibility pass
    BRMap._fltWrapVis = true;
    var origVis = BRMap.applyVisibility.bind(BRMap);
    BRMap.applyVisibility = function () { origVis(); try { applyDim(); } catch (e) {} };
  }

  function recompute() { rebuildNorm(); BRMap.setFilter("listingFilters", predicate); ui(); }

  // ---- UI ----
  var sec = BRMap.section("filter", "Filter listings"); sec.id = "secFilter";
  var nbs = (function () { var s = {}; Ls.forEach(function (l) { if (l.neighborhood) s[l.neighborhood] = 1; }); return Object.keys(s).sort(); })();
  var $ = function (id) { return sec.querySelector("#" + id); };
  function v(x) { return (x == null ? "" : x); }
  function bedOpts(id, cur, max, suf, any) {
    var h = '<select id="' + id + '" class="half"><option value="">' + any + "</option>";
    for (var nn = 1; nn <= max; nn++) h += '<option value="' + nn + '"' + (+cur === nn ? " selected" : "") + ">" + nn + suf + "</option>";
    return h + "</select>";
  }

  function ui() {
    var nbSel = crit.neighborhoods || [];
    sec.innerHTML =
      '<span class="st">Filter listings</span>' +
      '<div class="frow"><input type="search" id="f_q" placeholder="Search address, area, notes…" value="' + esc(crit.keyword || "") + '"></div>' +
      '<div class="frow"><input type="number" id="f_pr" class="half" min="0" placeholder="Min rent $/mo" value="' + esc(v(crit.minPriceRent)) + '">' +
        '<input type="number" id="f_ps" class="half" min="0" placeholder="Min buy $k" value="' + esc(v(crit.minPriceSale)) + '"></div>' +
      '<div class="frow">' + bedOpts("f_bd", crit.minBeds, 5, "+ bd", "Beds: any") + bedOpts("f_ba", crit.minBaths, 4, "+ ba", "Baths: any") + '</div>' +
      '<div class="frow"><input type="number" id="f_sq" class="half" min="0" placeholder="Min sqft" value="' + esc(v(crit.minSize)) + '">' +
        '<input type="number" id="f_yr" class="half" min="0" placeholder="Built ≥ yr" value="' + esc(v(crit.minYear)) + '"></div>' +
      '<div class="frow"><input type="number" id="f_cm" min="0" placeholder="Max min → LSU (AM rush)" value="' + esc(v(crit.maxCommute)) + '"></div>' +
      '<div class="frow"><input type="number" id="f_ls" class="half" min="0" placeholder="Max lease mo" value="' + esc(v(crit.maxLease)) + '"></div>' +
      '<label><input type="checkbox" id="f_fu"' + (crit.furnishedOnly ? " checked" : "") + "> Furnished</label>" +
      '<label><input type="checkbox" id="f_pt"' + (crit.petsOnly ? " checked" : "") + "> Pets allowed</label>" +
      '<label><input type="checkbox" id="f_off"' + (crit.excludeOff ? " checked" : "") + "> Hide off-market</label>" +
      '<div class="mut" style="margin-top:5px">Neighborhoods' + (nbSel.length ? " (" + nbSel.length + ")" : "") + "</div>" +
      '<div class="nbbox" id="f_nb">' + nbs.map(function (nb) {
        return '<label><input type="checkbox" value="' + esc(nb) + '"' + (nbSel.indexOf(nb) >= 0 ? " checked" : "") + "> " + esc(nb) + "</label>";
      }).join("") + "</div>" +
      '<div class="fcount" id="f_cnt"></div>' +
      '<div class="fchips" id="f_chips"></div>' +
      '<label style="margin-top:6px"><input type="checkbox" id="f_sh"' + (showHidden ? " checked" : "") + "> Show hidden pins (greyed)</label>" +
      '<div style="margin-top:5px"><a class="flink" id="f_reset">Reset filters</a></div>';

    var changeNum = function (id, key) { var el = $(id); if (el) el.oninput = function (e) { crit[key] = e.target.value; commit(); }; };
    changeNum("f_q", "keyword"); changeNum("f_pr", "minPriceRent"); changeNum("f_ps", "minPriceSale");
    changeNum("f_sq", "minSize"); changeNum("f_yr", "minYear"); changeNum("f_cm", "maxCommute"); changeNum("f_ls", "maxLease");
    $("f_bd").onchange = function (e) { crit.minBeds = e.target.value; commit(); };
    $("f_ba").onchange = function (e) { crit.minBaths = e.target.value; commit(); };
    $("f_fu").onchange = function (e) { crit.furnishedOnly = e.target.checked; commit(); };
    $("f_pt").onchange = function (e) { crit.petsOnly = e.target.checked; commit(); };
    $("f_off").onchange = function (e) { crit.excludeOff = e.target.checked; commit(); };
    sec.querySelectorAll("#f_nb input[type=checkbox]").forEach(function (cb) {
      cb.onchange = function () { var s = {}; (crit.neighborhoods || []).forEach(function (x) { s[x] = 1; });
        if (cb.checked) s[cb.value] = 1; else delete s[cb.value]; crit.neighborhoods = Object.keys(s); commit(); };
    });
    $("f_sh").onchange = function (e) { showHidden = e.target.checked; BRMap.setFilter("listingFilters", predicate); count(); };
    $("f_reset").onclick = function (ev) { ev.preventDefault(); crit = BRFilters.clean({}); commit(true); };
    chips(); count();
  }

  // commit a criteria change: persist+sync, recompute predicate, refresh chips+count
  function commit(full) {
    crit = BRFilters.clean(crit);
    BRFilters.save(crit);
    rebuildNorm();
    BRMap.setFilter("listingFilters", predicate);   // → applyVisibility → applyDim
    if (full) ui(); else { chips(); count(); }
  }
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

  // ---- load companion data, then activate ----
  Promise.all([BRMap.fetchJSON("filter_meta.json"), BRMap.fetchJSON("commute.json")]).then(function (res) {
    META = res[0] || {}; COMMUTE = res[1] || {};
    rebuildNorm();
    BRMap.setFilter("listingFilters", predicate);
    ui();
  });

  // ---- cross-surface live sync (dashboard ⇄ map, other tabs) ----
  BRFilters.subscribe(function (c) { crit = BRFilters.clean(c); rebuildNorm(); BRMap.setFilter("listingFilters", predicate); ui(); });

  // tiny HTML escaper (shell doesn't expose one)
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
});
