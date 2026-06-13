/* LISTING FILTER module — filter listing pins by square footage, bedrooms, bathrooms,
   to narrow down which places to accept right on the map.

   Registers a predicate with the shell's shared visibility system (BRMap.setFilter),
   so it COMPOSES with review_layer.js's status filter: a pin shows only if it passes
   BOTH the status filter (Accepted/To review/Rejected) AND these sqft/beds/baths limits.
   Listings with unknown sqft/beds/baths are kept visible (can't exclude on missing data). */
BRMap.ready(() => {
  if (typeof BRMap.setFilter !== "function") return;      // shell without the shared filter system

  const Ls = BRMap.listings || [];
  const sizes = Ls.map(l => l.size).filter(v => typeof v === "number" && v > 0);
  const LO0 = sizes.length ? Math.floor(Math.min.apply(null, sizes) / 100) * 100 : 0;
  const HI0 = sizes.length ? Math.ceil(Math.max.apply(null, sizes) / 100) * 100 : 5000;
  const STEP = 50;
  let lo = LO0, hi = HI0, minBeds = 0, minBaths = 0;

  function pass(l) {
    const s = l.size;
    if (typeof s === "number" && s > 0 && (s < lo || s > hi)) return false;
    if (minBeds && typeof l.beds === "number" && l.beds < minBeds) return false;
    if (minBaths && typeof l.baths === "number" && l.baths < minBaths) return false;
    return true;
  }

  const opts = (cur, max, plus) => {
    let h = '<option value="0"' + (cur === 0 ? " selected" : "") + ">Any</option>";
    for (let n = 1; n <= max; n++) h += '<option value="' + n + '"' + (cur === n ? " selected" : "") + ">" + n + (plus ? "+" : "") + "</option>";
    return h;
  };

  const sec = BRMap.section("filter", "Filter listings");
  const $ = id => sec.querySelector("#" + id);

  function updateCount() {
    const el = $("fl_cnt"); if (!el) return;
    const n = Ls.filter(l => BRMap.passesFilters(l)).length;
    el.textContent = n + " of " + Ls.length + " shown";
  }

  function render() {
    sec.innerHTML =
      '<span class="st">Filter listings</span>'
      + '<label style="display:block;font-weight:600">Square feet: <span id="fl_sz">' + lo + "–" + hi + '</span></label>'
      + '<div class="mut" style="margin:3px 0 0">min</div>'
      + '<input type="range" id="fl_lo" min="' + LO0 + '" max="' + HI0 + '" step="' + STEP + '" value="' + lo + '" style="width:100%">'
      + '<div class="mut" style="margin:1px 0 0">max</div>'
      + '<input type="range" id="fl_hi" min="' + LO0 + '" max="' + HI0 + '" step="' + STEP + '" value="' + hi + '" style="width:100%">'
      + '<label style="display:block;margin-top:7px">Beds (min) <select id="fl_bd">' + opts(minBeds, 5, true) + "</select></label>"
      + '<label style="display:block;margin-top:5px">Baths (min) <select id="fl_ba">' + opts(minBaths, 4, true) + "</select></label>"
      + '<div style="margin-top:7px"><a href="#" id="fl_reset">Reset filters</a> · <span class="mut" id="fl_cnt" style="margin:0"></span></div>';

    $("fl_lo").oninput = e => { lo = +e.target.value; if (lo > hi) { hi = lo; $("fl_hi").value = hi; } $("fl_sz").textContent = lo + "–" + hi; changed(); };
    $("fl_hi").oninput = e => { hi = +e.target.value; if (hi < lo) { lo = hi; $("fl_lo").value = lo; } $("fl_sz").textContent = lo + "–" + hi; changed(); };
    $("fl_bd").onchange = e => { minBeds = +e.target.value; changed(); };
    $("fl_ba").onchange = e => { minBaths = +e.target.value; changed(); };
    $("fl_reset").onclick = ev => { ev.preventDefault(); lo = LO0; hi = HI0; minBeds = 0; minBaths = 0; render(); BRMap.applyVisibility(); };
    updateCount();
  }
  function changed() { BRMap.applyVisibility(); updateCount(); }

  BRMap.setFilter("size", pass);     // register predicate (also applies visibility)
  render();
});
