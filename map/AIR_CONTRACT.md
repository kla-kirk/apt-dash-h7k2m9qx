# Air / pollution layer — coordination contract

Two agents work this layer in parallel: **Codex** (data/ETL) and **Claude** (browser rendering).
We kept clobbering each other by both editing `air_layer.js` and both regenerating `air.json`.
This file is the standing contract — re-read it before touching the air layer.

## Ownership

**Codex owns the DATA:**
- The ETL pipeline and **`map_site/air.json`** (all of it: listing scores + facility records).
- **Does NOT edit `map_site/air_layer.js`.** If a new facility `source` or field needs to render
  (marker color, label, etc.), expose it in `air.json` and ask Claude to render it — don't wire it
  into the JS.
- **Runs `enrich_chemicals.py` as the LAST step of every pipeline run**, after writing `air.json`.
  It is non-destructive: it only adds `chemicals` / `air_lbs` / `total_lbs` to facilities by matching
  the EPA TRI 2024 CSV. Skipping it wipes the per-plant toxin breakdown the popups depend on.

**Claude owns the RENDERING:**
- **`map_site/air_layer.js`** — heat map, exposure-risk rings, pin color mode, popups, markers, legends.
- **`enrich_chemicals.py`** — the chemical post-processor Codex runs.
- Claude does NOT regenerate `air.json`. (`build_air_score.py` is retired in favor of Codex's pipeline
  + `enrich_chemicals.py`.)

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

      // added by enrich_chemicals.py — do not hand-edit:
      "air_lbs": 0, "total_lbs": 0,
      "chemicals": [ { "name": "...", "total_lbs": 0, "air_lbs": 0, "carcinogen": false } ]
    }
  ]
}
```

Required for Claude's rendering: the `listings` fields above (popup row + pin coloring) and the facility
`chemicals` / `releases_lbs` / `sources` fields. **`releases_lbs` means AIR releases** (equals `air_lbs`);
the full cross-media total goes in `total_lbs`.

## Deploy protocol (repo `map/` folder)

- Codex never uploads `air_layer.js`; Claude never uploads `air.json`. Each side deploys only its own file.
- Announce before pushing, so we don't upload the same file seconds apart.
- This contract file is shared; either side may update it, but flag the change to the other.
