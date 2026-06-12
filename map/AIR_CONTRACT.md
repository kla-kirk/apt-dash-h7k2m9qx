# Air / pollution layer — coordination contract

Two agents work this layer in parallel: **Codex** (data/ETL) and **Claude** (browser rendering).
We kept clobbering each other by both editing `air_layer.js` and both regenerating `air.json`.
This file is the standing contract — re-read it before touching the air layer.

## Ownership

**Codex owns the DATA (produces locally, does NOT deploy):**
- The ETL pipeline and the contents of **`map_site/air.json`** — listing scores, facility records, and the
  chemical-risk fields (`facility_toxicity_score`, `dominant_chemical`, `dominant_risk_type`,
  `chemical_risk_breakdown`, `risk_radii`, per-chemical scores, `chemical_risk_methodology`).
- **Does NOT edit `map_site/air_layer.js`** and **does NOT push to the repo.** If a new facility
  `source`/field needs to render (marker color, label, ring, etc.), expose it in `air.json` and tell
  Claude to render it — don't wire it into the JS.
- When `air.json` is regenerated, **tell Claude** so Claude can push it.

**Claude owns the RENDERING + all repo deploys:**
- **`map_site/air_layer.js`** — heat map, screening-radius rings, pin color mode, popups, markers, legends.
- **Pushes BOTH `air.json` and `air_layer.js`** to the repo `map/` folder, together, so the data and the
  renderer never drift (that drift is what broke the live map before).
- Does NOT regenerate `air.json`. (`build_air_score.py` and `enrich_chemicals.py` are retired — Codex's
  pipeline now produces the chemical-risk fields directly.)

## Interface — `air.json` schema

Do not rename these fields without telling the other side.

```jsonc
{
  "generated_at_utc": "...", "methodology": "...", "tri_reporting_year": 2024,

  "listings": {
    "<address>": {
      "score": 0,                       // 0-100 | null  (relative pollution-proximity rank)
      "label": "Low|Moderate|High|null",
      "cancer_risk": null, "pm25": null,
      "nearest_facility_mi": 0, "nearest_facility_name": "...",
      "proximity_release_score": 0,
      "nearby_facilities": [ { "name": "...", "distance_mi": 0, "releases_lbs": 0, "sector": "...", "sources": [] } ]
    }
  },

  "facilities": [
    {
      "name": "...", "lat": 0, "lon": 0, "kind": "...", "sector": "...",
      "sources": [],            // TRI, LDEQ, RMP, RCRAInfo, NPDES, ECHO_CAA, OSM, FRS
      "releases_lbs": 0,        // AIR releases (fugitive+stack) — drives the heat map + marker size; null OK
      "default_visible": true,  // optional; Claude renders when default_visible !== false
      "rmp_worstcase_mi": 0,    // optional; a plant's real EPA RMP worst-case toxic-endpoint distance.
                                //   If present, Claude draws it instead of the ~25 mi corridor reference.

      // chemical-risk fields from Codex's pipeline (TRI-linked facilities). Renderer prefers these;
      // the older `chemical_summary{}` block is kept only as a backward-compat fallback.
      "air_lbs": 0, "total_lbs": 0,
      "facility_toxicity_score": 0,                 // 0-100 screening burden
      "dominant_chemical": "...", "dominant_risk_type": "cancer|acute|noncancer|lower",
      "risk_radii": [ { "chemical": "...", "radius_mi": 0, "risk_type": "cancer|noncancer|acute|lower", "basis": "..." } ],
      "chemical_risk_breakdown": { "top_cancer_chemicals": [ {"name":"...","air_lbs":0,"score":0} ],
                                   "top_acute_chemicals": [ ... ], "top_overall_chemicals": [ ... ] },
      "chemicals": [ { "name": "...", "cas": "...", "air_lbs": 0, "total_lbs": 0, "carcinogen": false,
                       "risk_family": "...", "risk_notes": "...", "cancer_potency_score": 0,
                       "noncancer_inhalation_score": 0, "acute_hazard_score": 0, "overall_toxicity_score": 0 } ]
    }
  ]
}
```

Required for Claude's rendering: the `listings` fields above (popup row + pin coloring) and the facility
chemical-risk fields. **`releases_lbs` / `air_lbs` mean AIR releases** (fugitive+stack); the full
cross-media total goes in `total_lbs`. Markers/rings color by `dominant_risk_type` / `risk_type`.

## Deploy protocol (repo `map/` folder)

- **Claude is the sole pusher.** When Codex regenerates `air.json`, it tells Claude, and Claude pushes
  `air.json` **and** `air_layer.js` together so the data and renderer stay in sync. Codex never uploads
  to the repo. (Deploy = manual upload via the GitHub web UI; Pages redeploys ~1 min.)
- This contract file is shared; either side may update it, but flag the change to the other.
