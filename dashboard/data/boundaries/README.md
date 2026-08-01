# Administrative boundaries

Provenance for every boundary layer in this folder. Layers not listed here
must not be displayed, per `CONTRIBUTING.md`.

| Layer | Source | License | Fetch date | Coverage |
|---|---|---|---|---|
| `india_states.geojson` | Census of India 2011 (dissolved from districts) | Open data, attribution required | 2026-08-01 | 36/36 states and UTs |
| `india_districts.geojson` | Census of India 2011 | Open data, attribution required | 2026-08-01 | 760/760 districts |
| `subdistricts.geojson` | India Geodata project (LGD-sourced), https://github.com/yashveeeeeeer/india-geodata | Mixed CC0-1.0 / CC-BY-4.0 | 2026-08-01 | 6,471 sub-districts/tehsils |
| `blocks.geojson` | India Geodata project (LGD-sourced) | Mixed CC0-1.0 / CC-BY-4.0 | 2026-08-01 | 7,146 blocks |
| `villages/<state>.geojson` (27 files) | India Geodata project (LGD-sourced village layer), https://github.com/yashveeeeeeer/india-geodata | Mixed CC0-1.0 / CC-BY-4.0 | 2026-08-01 | 584,615 villages across 27 of India's 36 states/UTs -- see gap below |
| `names/<state>.json`, `names_index.json` | Derived from the village layer above (names/codes only, no geometry) | Same as village layer | 2026-08-01 | Same 27 states/UTs |

## Quality tier

These layers are labelled `"quality":"community-sourced, not government-published"`
in each file's own `metadata` block. That is a deliberately different, lower
tier than the existing 5-district MP village layer
(`dashboard/data/villages_*.geojson`), which comes directly from an official
LGD-coded shapefile and is labelled `"verified"` in
`docs/DATA_SOURCES.md`. Do not merge or relabel these tiers.

## Known gap: 9 states/UTs have no village-level boundary in this layer

Arunachal Pradesh, Himachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland,
Sikkim, Jammu and Kashmir, and Ladakh are **not covered** by the source
village layer. This matches a documented, known limitation of open-source
Indian village boundary data generally (see `docs/NATIONAL_SCALE_RESEARCH.md`
and the SHRUG project's own notes on point-only digitization in forest and
northeastern regions) -- it is a source-data gap, not a processing error on
this repo's side. `names_index.json` marks these states `"status":"pending"`
with the note *"Data pending for this area"*, per `CONTRIBUTING.md`'s
no-fabrication rule: never silently omit an entry, always say why it's
missing.

## Processing

- Source format: GeoJSONL (one GeoJSON Feature per line), downloaded from the
  India Geodata project's GitHub Releases (`admin/villages`,
  `admin/subdistricts`, `admin/blocks` release tags).
- Geometry simplified with Douglas-Peucker at tolerance 0.0005 deg (~55 m),
  matching this repo's existing village-layer convention.
- Coordinates rounded to 5 decimal places (~1 m).
- Villages are split one file per state/UT (`villages/<slug>.geojson`) so
  every file stays under GitHub's 100 MB per-file limit without Git LFS --
  the largest, Uttar Pradesh, is 62.7 MB.
- `names/<slug>.json` and `names_index.json` carry names and LGD codes only
  (no geometry), so the dashboard's location selector doesn't need to fetch
  full polygon geometry just to populate a dropdown; geometry for a given
  state loads only when that state's boundaries are actually shown on the
  map (lazy loading).

## Validation (`tools/validate_boundaries.py`)

Run against the Madhya Pradesh village file, sub-districts, and blocks as a
representative sample (running all 27 village files was out of scope for
this pass -- re-run per state before treating any of them as fully audited):

- **Duplicate LGD ids**: 97 found in the MP village file. Some LGD codes are
  reused across the source data; not corrected here, only reported.
- **Invalid geometry**: 54 self-intersecting polygons in the MP village file.
- **Overlaps**: 5,592 sibling-polygon pairs flagged in the MP village file,
  but 97.7% of them have less than 5% overlap-of-the-smaller-polygon area --
  consistent with harmless simplification slivers (independently simplifying
  two adjacent polygons' shared edge can make them cross very slightly), not
  real duplicate records. A minority (~130 pairs) have far larger overlap,
  including several pairs at or near 100% -- those look like genuine
  duplicate village digitizations and would need manual adjudication before
  this layer could be called "verified" rather than "community-sourced."

None of these issues were silently fixed. They're documented here so a
future pass can decide remediation, per this project's no-fabrication rule.

## Known gap: blank village names in the source (~7.4% nationally)

43,146 of 584,615 village records (7.4%) have an empty/whitespace-only name
in the source data across every property that could carry one
(`vilname11`, `vilnam_soi`). This is a pre-existing upstream data-quality
gap, not introduced by this repo's processing. The dashboard's village
picker (`dashboard/national_selector.js`) filters these out of the dropdown
list rather than showing a blank, unselectable-looking option -- the
geometry and the underlying `village_count` in `names_index.json` still
include them, since the polygon itself is real even where the name is
missing.
