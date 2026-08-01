# Administrative boundaries

Provenance for every boundary layer in this folder. Layers not listed here
must not be displayed, per `CONTRIBUTING.md`.

| Layer | Source | License | Fetch date | Coverage |
|---|---|---|---|---|
| `india_states.geojson` | Census of India 2011 (dissolved from districts) | Open data, attribution required | 2026-08-01 | 36/36 states and UTs |
| `india_districts.geojson` | Census of India 2011 | Open data, attribution required | 2026-08-01 | 760/760 districts |
| `subdistricts.geojson` | India Geodata project (LGD-sourced), https://github.com/yashveeeeeeer/india-geodata | Mixed CC0-1.0 / CC-BY-4.0 | 2026-08-01 | 6,471 sub-districts/tehsils |
| `blocks.geojson` | India Geodata project (LGD-sourced) | Mixed CC0-1.0 / CC-BY-4.0 | 2026-08-01 | 7,146 blocks |
| `villages/<state>.geojson` (36 files) | **Survey of India**, hosted via the National Water Data Portal (NWDP), NWIC, Ministry of Jal Shakti — https://nwdp.nwic.gov.in/dataset/village-boundary. See "Source and a naming caveat" below. | Public, no login required, as published on NWDP | 2026-08-01 | 654,285 villages across all 36 states/UTs |
| `names/<state>.json`, `names_index.json` | Derived from the village layer above (names/codes only, no geometry) | Same as village layer | 2026-08-01 | Same 36 states/UTs |

## Source and a naming caveat

`villages/<state>.geojson` was rebuilt on 2026-08-01 from Survey of India
village boundaries (`scripts/fetch_soi_villages.py` builds the manifest,
`scripts/build_soi_village_layer.py` downloads, reprojects, simplifies and
trims each state). This **replaces** the previous India Geodata
(community-sourced) village layer entirely — see "Superseded source" below
for what was there before.

The NWDP portal's own breadcrumb tags this dataset's "Data Producer" as
**Geological Survey of India**, not Survey of India — this was checked
directly against the portal's raw HTML, not assumed from the `vb_soi_`
filename prefix, because GSI does geological/mineral mapping, not village
cartography, and the mismatch looked wrong. It resolves in Survey of India's
favour: every downloaded feature carries its own `src_agency` attribute
reading `"Survey of India (SOI)"`, so GSI is who uploaded the dataset to
NWDP, not the surveying authority. Each `villages/<state>.geojson`'s
`metadata.hosted_via` field records both facts.

## Quality tier

Every file's `metadata` block reads `"quality": "verified-official --
Survey of India source, see docs/DATA_SOURCES.md"`. This supersedes the
former `"community-sourced, not government-published"` tier for all 36
states — the source itself changed, not just a label. It now matches the
tier of the existing 5-district MP village layer
(`dashboard/data/villages_*.geojson`), which comes from a different
official LGD-coded shapefile and is separately labelled `"verified"` in
`docs/DATA_SOURCES.md` — the two files are not merged, they just now share
a quality tier.

## Gap closed: 9 states/UTs that previously had no village boundary

Arunachal Pradesh, Himachal Pradesh, Jammu and Kashmir, Ladakh, Manipur,
Meghalaya, Mizoram, Nagaland, and Sikkim had **no** village-level boundary
in the old India Geodata layer (`names_index.json` marked them
`"status":"pending"`). The Survey of India source covers all of them; this
gap is now closed for all 36 states/UTs.

## Processing

- Source format: GeoJSON, one Feature per village, ~73 attribute columns,
  downloaded per-state as a zip from NWDP (`vb_soi_<state>_geojson.zip`).
- Source CRS: `EPSG:7755` (WGS 84 / India NSF LCC, a Lambert Conformal
  Conic projection), reprojected to `EPSG:4326` for the dashboard.
- Column names are **not** byte-identical across every state's export (some
  carry a trailing `\n` inherited from the original shapefile field name,
  Andhra Pradesh renames `subdistric` to `subdistrict`) —
  `build_soi_village_layer.py`'s `resolve_columns()` matches by candidate
  name after stripping/lowercasing rather than assuming a fixed name, the
  same auto-detect pattern `scripts/config.py` already uses for IMD NetCDF
  variable names.
- Attributes trimmed from 73 source columns to 11: `vil_lgd`,
  `village_name`, `district_name`, `subdistrict_name`, `block_name`,
  `gp_name`, `state_name`, `dist_lgd`, `state_lgd`, plus two new ones this
  source adds that the old layer didn't have — `population`, `households`.
- Geometry simplified with Douglas-Peucker at tolerance 0.0005 deg (~55 m),
  matching this repo's existing village-layer convention, coordinates
  rounded to 5 decimal places (~1 m). Simplification runs per-feature with a
  fallback chain (plain simplify → `buffer(0)` self-intersection fix then
  simplify → original geometry kept verbatim) because GEOS's simplifier can
  raise a `TopologyException` on a self-intersecting source polygon; a
  fallback is never fabricated geometry, only ever the feature's own
  original shape. Only 1 feature nationally needed the final fallback.
- Villages are split one file per state/UT (`villages/<slug>.geojson`) so
  every file stays under GitHub's 100 MB per-file limit without Git LFS —
  the largest, Uttar Pradesh, is 87.2 MB.
- `names/<slug>.json` and `names_index.json` carry names and LGD codes only
  (no geometry), so the dashboard's location selector doesn't need to fetch
  full polygon geometry just to populate a dropdown; geometry for a given
  state loads only when that state's boundaries are actually shown on the
  map (lazy loading, unchanged from before).

## Known quirks in the source (not corrected, per this repo's no-fabrication rule)

- **`vlcode` sentinel**: 4,803 features nationally carry `vlcode` (→
  `vil_lgd`) `= 999999`, a sentinel the source uses for unnamed or
  reserve-forest parcels rather than a real LGD id. Left as-is.
- **Self-intersecting source geometry**: 192 features nationally have an
  invalid (self-intersecting) polygon before any processing here. Left
  as-is; see "Processing" above for how simplification handles them without
  fabricating a repaired shape.
- **Duplicate `vil_lgd`**: 269 non-sentinel duplicate occurrences nationally
  (i.e. the same real LGD code appears on more than one feature). Not
  deduplicated — reported here for a future pass to adjudicate.

None of these issues were silently fixed. They're documented here so a
future pass can decide remediation.

## Village names: no blank-name gap in this source

Unlike the previous India Geodata layer (see "Superseded source" below),
0 of 654,285 village records have a blank/whitespace-only `village_name` in
this Survey of India source. `dashboard/national_selector.js`'s
blank-name filter in the village picker is now effectively a no-op for this
layer, but is left in place since it's harmless and guards against any
future data source that does have the gap.

## Superseded source (for history — no longer used)

Before 2026-08-01, `villages/<state>.geojson` (27 of 36 states) came from
the India Geodata project (LGD-sourced, community-maintained,
https://github.com/yashveeeeeeer/india-geodata), licensed CC0-1.0/CC-BY-4.0,
labelled `"community-sourced, not government-published"`. It covered
584,615 villages, had a 7.4% blank-village-name rate, and had no coverage at
all for the 9 states/UTs listed above. It's recorded here, not deleted from
this document's history, per this repo's no-fabrication/no-silent-omission
rule — the old files themselves are no longer present in the repo, replaced
in place by the Survey of India versions.

## Validation (`tools/validate_boundaries.py`)

The validation numbers below predate the 2026-08-01 Survey of India rebuild
and describe the **old, superseded** India Geodata layer — re-run this tool
against the new files before citing a number here as current:

- **Duplicate LGD ids**: 97 found in the (old) MP village file.
- **Invalid geometry**: 54 self-intersecting polygons in the (old) MP village
  file.
- **Overlaps**: 5,592 sibling-polygon pairs flagged in the (old) MP village
  file, 97.7% under 5% overlap (simplification slivers), ~130 pairs with
  much larger overlap looking like genuine duplicate digitizations.

The Survey of India replacement has its own, separately-measured quirks —
see "Known quirks in the source" above — which are not directly comparable
to these old numbers (different source, different digitization).
