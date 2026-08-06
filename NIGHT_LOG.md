# Night Log

Per FINAL_PROMPT.md Phase 8.7: after every state's climate run (and, here,
every major measurement pass), record time/size/coverage/what was missed.
Real numbers only -- nothing in this file is estimated without being
labelled as an estimate.

## 2026-08-06 — Phase 4 measurements (crop_yield, MP village-level GEE benchmark, PMTiles)

**4.1 crop_yield positional-array encoding**, real district-panel file
(`dashboard/data/crop_yield/icrisat_district_panel.json`, 12,803 rows):

| Form | Raw | Gzip |
|---|---|---|
| Current (nested dict) | 19.37 MB | 2.65 MB |
| Positional-array | 8.28 MB | 1.96 MB |
| Reduction | 57.3% | 26.1% |

**4.2 MP village-level climate, real GEE benchmark** (Bhopal district, 522
real village polygons, `ee.Image.reduceRegions()` batched approach,
ERA5-Land tmax):

- 1-day batch, 522 villages: 4.8 s, 331 KB raw `getInfo()` payload
- 8-day batch, 522 villages: 5.7 s, 2.78 MB raw payload
- **366-day batch in one call: FAILED -- "Collection query aborted after
  accumulating over 5000 elements"** (hard GEE `getInfo()` limit; confirms
  batching by ~8-9 days is required, not optional, for a collection this
  size)
- Extrapolated (real per-batch rate x batch count, not a completed run):
  one district (522 villages), 25 years, 3 variables (tmax/tmin/precip)
  serial ≈ **5.47 hours**
  - MP (~54,903 villages) serial ≈ **570 hours ≈ 23.7 days**
  - National (654,285 villages) serial ≈ **6,791 hours ≈ 283 days**
- Per-visitor cost for the *output* (not the compute) is small regardless
  of the above -- see the Bhopal climate positional-array test earlier the
  same day: ~121 bytes/village raw, ~18.5 bytes/village gzip. The blocker
  is compute time, not payload size.
- **EECU cost: not measured.** GEE's per-call EECU accounting is only
  exposed for asynchronous `Export.*` tasks via the Earth Engine
  Task/quota dashboard, not for a synchronous `getInfo()` call like this
  benchmark's. Reporting this as "not measured," not guessing a number.
- **Conclusion, not yet acted on:** the current per-village, all-25-years,
  synchronous approach does not scale to state or national coverage
  within a reasonable timeframe. Options identified, none implemented
  yet: (a) async `Export.table.toDrive` batch tasks running server-side,
  potentially parallel; (b) fewer indices per village (a subset of the 19
  computed today); (c) accept the current district-level-only village
  granularity and treat this as a future scaling project. Owner has not
  yet chosen between these as of this log entry.

**4.3 PMTiles, national village boundary layer** (606.1 MB source
GeoJSON, `tippecanoe` v2.79.0):

| Build | Result |
|---|---|
| `-zg` (auto maxzoom, wrong for village use) | maxzoom 9, 97.8 MB -- **not usable**, over-simplified for village display |
| `-Z0 -z14` (matches this repo's village-only->z12 lazy-load rule) | maxzoom 14, **796.8 MB -- 31.5% LARGER than source** |
| Real single-village extract (z12-14, ~3km bbox, `pmtiles extract`) | **4 tiles, 931 bytes** |

Conclusion: PMTiles total storage is a net loss for polygon boundary data
at this zoom depth (more zoom levels = more stored copies), but per-visitor
transfer for viewing one village is dramatically smaller than today's
architecture (a multi-MB per-district GeoJSON file). Not converted into
production output -- measurement only, per owner instruction ("naapo,
faisla mat lo").

## Ongoing (not this entry) -- `scripts/08_gee_national_climate.py --resume`

District-level (not village-level) national climate run has been
progressing continuously across sessions (started Sun 10 PM, still
running as of this log entry) via `--resume`, no `--states` filter. Real
progress recorded in `dashboard/data/climate_manifest.json` (213/733
districts as of the last manifest rebuild this session) rather than
duplicated here -- that file is the single source of truth for this
count, per its own header comment.
