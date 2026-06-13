/* ============================================================================
   SHARED LISTING-FILTER PREDICATE LIBRARY  —  BRFilters
   ----------------------------------------------------------------------------
   ONE source of truth for "does this listing match the active filters?", used
   IDENTICALLY by the dashboard table and the Leaflet map so the two surfaces
   can never disagree. Pure: no DOM, no fetch, no globals beyond `BRFilters`.
   Loads in the browser (window.BRFilters) and in Node (module.exports).

   PRIME DIRECTIVE — never hide a good listing:
     * Default = everything passes (EMPTY criteria below).
     * A listing is hidden ONLY when it DEFINITELY fails an active criterion.
     * Missing / blank / unparseable data for a filtered field => that filter
       PASSES the listing (we never drop a winner on unknown data).
     * Ranges are inclusive at both ends (>= min, <= max).

   The filter set is single-threshold by design (per Keegan): every numeric
   filter is a single MIN except commute, which is a single MAX. Price is a
   MIN. Listing TYPE (rent/sale) and REVIEW STATUS (accepted/needs/rejected)
   are intentionally NOT handled here — each surface already owns those
   (dashboard: mode + reviewFilter; map: review_layer.js "status" predicate) —
   so this library composes with them via AND instead of fighting them.
   ============================================================================ */
(function (root) {
  "use strict";

  // ---- low-level parsing (the SINGLE definition both surfaces share) --------
  function n(v) {                                  // tolerant number parse -> number | null
    if (v === 0) return 0;
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var f = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isFinite(f) ? f : null;
  }
  function posNum(v) {                             // min/threshold inputs: only > 0 is "active"
    var f = n(v);
    return (f != null && f > 0) ? f : null;
  }
  function parseYear(v) {                          // "1950" | "2025" | "<1925" | "" -> number | null
    if (v == null) return null;
    var m = String(v).match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }
  function parseFurnished(v) {                     // -> true (furnished) | false (definitely not) | null (unknown)
    if (v == null) return null;
    var s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (/^(no|none|unfurnished|not furnished)$/.test(s)) return false;
    if (/(furnish|fully|yes|some)/.test(s)) return true;
    return null;
  }
  function parsePets(v) {                          // petFees string -> true | false (definitely no pets) | null
    if (v == null) return null;
    var s = String(v).trim().toLowerCase();
    if (!s || /none listed|not listed|unknown|n\/a/.test(s)) return null;
    if (/(no pets|pets? not allowed|no animals|not pet[- ]?friendly)/.test(s)) return false;
    if (/(pet|dog|cat|friendly|deposit|allowed)/.test(s)) return true;
    return null;
  }
  function parseLease(v) {                         // 12 | "6 (or 12+)" | null -> number | null (months)
    return n(v);                                   // first number = the minimum commitment
  }
  function numHi(v) {                              // beds/baths/sqft: range "1–2"/"736–1,212" -> HIGH end
    if (v == null || v === "") return null;        //   (max a community offers; min-filter-safe: no false negatives)
    if (typeof v === "number") return isFinite(v) ? v : null;
    var parts = String(v).split(/\s*(?:[‒-―−\-]|to)\s*/i);
    var nums = []; for (var i = 0; i < parts.length; i++) { var x = n(parts[i]); if (x != null) nums.push(x); }
    return nums.length ? Math.max.apply(null, nums) : null;
  }

  // ---- normalize a raw listing (dashboard SEED row OR map listing) ----------
  //   Both surfaces call THIS, so identical fields -> identical normalized view.
  //   `commuteAm` is supplied separately (it's keyed externally by address).
  function normListing(raw, commuteAm) {
    raw = raw || {};
    var sizeRaw = (raw.size != null && raw.size !== "") ? raw.size : raw.sqft;
    var text = [raw.address, raw.neighborhood, raw.likes, raw.dislikes]
      .filter(function (x) { return x; }).join(" || ").toLowerCase();
    return {
      id: raw.id,
      type: (raw.type === "sale") ? "sale" : "rent",
      status: raw.status || "active",
      price: n(raw.price),
      beds: numHi(raw.beds),
      baths: numHi(raw.baths),
      size: numHi(sizeRaw),
      year: parseYear(raw.yearBuilt),
      furnished: parseFurnished(raw.furnished),
      pets: parsePets(raw.petFees),
      lease: parseLease(raw.minLease),
      neighborhood: String(raw.neighborhood || ""),
      commuteAm: (commuteAm != null ? n(commuteAm) : null),
      text: text
    };
  }

  // ---- default criteria: EVERYTHING passes ---------------------------------
  var EMPTY = {
    minPriceRent: null, minPriceSale: null,
    minBeds: null, minBaths: null, minSize: null, minYear: null,
    furnishedOnly: false, petsOnly: false, maxLease: null,
    neighborhoods: [], keyword: "", maxCommute: null, excludeOff: false
  };

  // ---- normalize raw UI criteria into clean typed criteria -----------------
  function clean(raw) {
    raw = raw || {};
    return {
      minPriceRent: posNum(raw.minPriceRent),
      minPriceSale: posNum(raw.minPriceSale),
      minBeds: posNum(raw.minBeds),
      minBaths: posNum(raw.minBaths),
      minSize: posNum(raw.minSize),
      minYear: posNum(raw.minYear),
      furnishedOnly: !!raw.furnishedOnly,
      petsOnly: !!raw.petsOnly,
      maxLease: posNum(raw.maxLease),
      neighborhoods: Array.isArray(raw.neighborhoods)
        ? raw.neighborhoods.filter(function (x) { return x != null && x !== ""; }) : [],
      keyword: String(raw.keyword == null ? "" : raw.keyword).trim().toLowerCase(),
      maxCommute: posNum(raw.maxCommute),
      excludeOff: !!raw.excludeOff
    };
  }

  function isActive(raw) {                          // any filter engaged?
    var c = clean(raw);
    return c.minPriceRent != null || c.minPriceSale != null || c.minBeds != null ||
      c.minBaths != null || c.minSize != null || c.minYear != null || c.furnishedOnly ||
      c.petsOnly || c.maxLease != null || (c.neighborhoods && c.neighborhoods.length > 0) ||
      !!c.keyword || c.maxCommute != null || c.excludeOff;
  }

  // ---- THE predicate. L = normListing(...) output; raw = UI criteria -------
  function passes(L, raw) {
    var c = clean(raw);
    // Price — MIN, in the listing's own units (rent $/mo vs sale $k tracked separately)
    var minP = (L.type === "sale") ? c.minPriceSale : c.minPriceRent;
    if (minP != null && L.price != null && L.price < minP) return false;
    // Beds / Baths / Sqft / Year — MIN, inclusive; unknown passes
    if (c.minBeds != null && L.beds != null && L.beds < c.minBeds) return false;
    if (c.minBaths != null && L.baths != null && L.baths < c.minBaths) return false;
    if (c.minSize != null && L.size != null && L.size < c.minSize) return false;
    if (c.minYear != null && L.year != null && L.year < c.minYear) return false;
    // Rental toggles — hide ONLY when the field is DEFINITELY adverse
    if (c.furnishedOnly && L.furnished === false) return false;
    if (c.petsOnly && L.pets === false) return false;
    // Max lease length willing to accept — listing's min commitment must be <= cap
    if (c.maxLease != null && L.lease != null && L.lease > c.maxLease) return false;
    // Neighborhood multi-select — unknown neighborhood passes
    if (c.neighborhoods.length && L.neighborhood &&
      c.neighborhoods.indexOf(L.neighborhood) < 0) return false;
    // Keyword — substring over address/neighborhood/likes/dislikes
    if (c.keyword && L.text && L.text.indexOf(c.keyword) < 0) return false;
    // Max commute (minutes, AM rush to LSU) — unknown commute passes
    if (c.maxCommute != null && L.commuteAm != null && L.commuteAm > c.maxCommute) return false;
    // Exclude off-market (opt-in; default keeps them visible)
    if (c.excludeOff && L.status === "off") return false;
    return true;
  }

  // ---- applied-filter chips (shared labels so both surfaces read the same) --
  function fmt(x) { return (x != null && x.toLocaleString) ? x.toLocaleString() : String(x); }
  function chips(raw) {
    var c = clean(raw), out = [];
    if (c.minPriceRent != null) out.push({ key: "minPriceRent", label: "Rent ≥ $" + fmt(c.minPriceRent) + "/mo" });
    if (c.minPriceSale != null) out.push({ key: "minPriceSale", label: "Buy ≥ $" + c.minPriceSale + "k" });
    if (c.minBeds != null) out.push({ key: "minBeds", label: c.minBeds + "+ bd" });
    if (c.minBaths != null) out.push({ key: "minBaths", label: c.minBaths + "+ ba" });
    if (c.minSize != null) out.push({ key: "minSize", label: "≥ " + fmt(c.minSize) + " sqft" });
    if (c.minYear != null) out.push({ key: "minYear", label: "Built ≥ " + c.minYear });
    if (c.furnishedOnly) out.push({ key: "furnishedOnly", label: "Furnished" });
    if (c.petsOnly) out.push({ key: "petsOnly", label: "Pets allowed" });
    if (c.maxLease != null) out.push({ key: "maxLease", label: "Lease ≤ " + c.maxLease + " mo" });
    (c.neighborhoods || []).forEach(function (nb) { out.push({ key: "nb:" + nb, label: nb }); });
    if (c.keyword) out.push({ key: "keyword", label: "“" + c.keyword + "”" });
    if (c.maxCommute != null) out.push({ key: "maxCommute", label: "≤ " + c.maxCommute + " min to LSU" });
    if (c.excludeOff) out.push({ key: "excludeOff", label: "Hide off-market" });
    return out;
  }

  // ---- remove one chip: return a fresh raw criteria with that key reset -----
  function without(raw, key) {
    var c = clean(raw);
    if (key && key.indexOf("nb:") === 0) {
      var nb = key.slice(3);
      c.neighborhoods = (c.neighborhoods || []).filter(function (x) { return x !== nb; });
    } else if (key === "keyword") { c.keyword = ""; }
    else if (key === "furnishedOnly" || key === "petsOnly" || key === "excludeOff") { c[key] = false; }
    else if (key in c) { c[key] = null; }
    return c;
  }

  // ---- shared persistence + cross-surface sync ------------------------------
  //   Dashboard and /map/ are same-origin, so this localStorage key syncs them
  //   automatically AND remembers settings across visits. subscribe() also fires
  //   on the cross-tab `storage` event so an open map updates when the dashboard
  //   changes a filter (and vice-versa).
  var KEY = "brfilters.v1";
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function load() {
    var s = ls(); if (!s) return Object.assign({}, EMPTY);
    try { var raw = JSON.parse(s.getItem(KEY) || "null"); return Object.assign({}, EMPTY, raw || {}); }
    catch (e) { return Object.assign({}, EMPTY); }
  }
  function save(raw) {
    var s = ls(); if (!s) return;
    try { s.setItem(KEY, JSON.stringify(clean(raw))); } catch (e) {}
  }
  function subscribe(fn) {                          // fn(newRawCriteria) on cross-tab change
    if (!root.addEventListener) return function () {};
    var h = function (ev) { if (ev && ev.key === KEY) { try { fn(load()); } catch (e) {} } };
    root.addEventListener("storage", h);
    return function () { try { root.removeEventListener("storage", h); } catch (e) {} };
  }

  var BRFilters = {
    EMPTY: EMPTY, KEY: KEY,
    // parsing (exposed for tests / surface adapters)
    n: n, numHi: numHi, posNum: posNum, parseYear: parseYear, parseFurnished: parseFurnished,
    parsePets: parsePets, parseLease: parseLease,
    normListing: normListing,
    clean: clean, isActive: isActive, passes: passes,
    chips: chips, without: without,
    // persistence/sync
    load: load, save: save, subscribe: subscribe
  };

  root.BRFilters = BRFilters;
  if (typeof module !== "undefined" && module.exports) module.exports = BRFilters;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
