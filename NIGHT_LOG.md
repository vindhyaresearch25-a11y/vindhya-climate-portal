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

## 2026-08-08 -- Phase 8.4 (national NDVI) + Phase 8.6 (CHIRPS/ERA5-Land validation)

Both tasks shared the project's GEE quota with the already-running
`08_gee_national_climate.py --resume` background job (started earlier the
same day, still progressing Jharkhand as of this entry) -- neither task's
timings below are isolated-quota numbers; real wall-clock under real
contention, reported honestly rather than re-run in isolation to get a
cleaner (but less representative) number.

**8.4 NDVI, `scripts/10_gee_national_ndvi.py`** (MODIS MOD13Q1 v061 via GEE,
per-year district-mean NDVI, 2000-2024):

- `--stage validate` (Bhopal, 1 year): 4.5s -- extrapolated 1 district x 25
  years ~= 112s, full country (~728 remaining districts) x 25 years ~= 22.7
  hours.
- **Real run, Tripura (8 districts, `--resume`), 2026-08-08:**

| District | Time | Years | Mean NDVI |
|---|---|---|---|
| Dhalai | 76.5s | 25/25 | 0.6987 |
| North Tripura | 57.5s | 25/25 | 0.6962 |
| South Tripura | 79.3s | 25/25 | 0.6639 |
| West Tripura | 43.3s | 25/25 | 0.6299 |
| Khowai | 51.6s | 25/25 | 0.6747 |
| Sepahijala | 50.1s | 25/25 | 0.6394 |
| Gomati | 82.9s | 25/25 | 0.6755 |
| Unakoti | 144.0s | 25/25 | 0.6663 |

Total 585.2s (9.75 min) for 8 districts, 73.2s/district average (under
shared quota -- the isolated `validate` benchmark alone predicted 112s/
district, so real throughput was actually *better* than the isolated
extrapolation, likely because MOD13Q1's per-year composite is a single
lighter `reduceRegion` call versus the climate pipeline's per-day loop).
All 8 districts wrote real 25/25-year series, nothing skipped. Extrapolated
at this real rate: ~680 remaining non-MP, non-Tripura districts x 73.2s
~= **13.8 hours** for full national NDVI coverage -- **not attempted this
session**, per Phase 8.7 ("ek rajya baaki sab ke liye ruko aur batao").
`scripts/build_ndvi_manifest.py` run afterward: 51 DiCRA (MP) + 8 GEE
(Tripura) = 59/733 districts with real NDVI.

**8.6 Validation, `scripts/11_build_validation.py`** (CHIRPS/ERA5-Land vs
IMD, Bhopal/Indore/Jabalpur/Rewa/Sidhi, real Pearson r/bias/RMSE):

- `--stage validate` (Bhopal, 1 year): 5.9s -- extrapolated 5 districts x 25
  years ~= 12.3 min in isolation. The real run took **2065.4s (34.4 min)**
  for 5 districts (see per-district times below) -- ~2.8x the isolated
  estimate, entirely attributable to sharing GEE quota with the concurrent
  `08_gee_national_climate.py --resume` job (confirmed still active
  throughout via its own heartbeat file), not any error or retry in this
  script. Recorded honestly rather than re-run in isolation for a cleaner
  number.

| District | Time | Rainfall (CHIRPS vs IMD) | Heatwave days (ERA5-Land vs IMD) |
|---|---|---|---|
| Bhopal | 439.5s | r=0.927, bias +70.0 mm/yr, RMSE 134.1 mm | r=0.852, bias +0.60 d/yr, RMSE 1.48 d |
| Indore | 391.0s | r=0.832, bias -4.0 mm/yr, RMSE 155.3 mm | r=0.783, bias +0.28 d/yr, RMSE 1.18 d |
| Jabalpur | 606.8s | r=0.795, bias -29.5 mm/yr, RMSE 161.4 mm | r=0.888, bias +0.48 d/yr, RMSE 1.47 d |
| Rewa | 336.8s | r=0.736, bias +74.8 mm/yr, RMSE 154.1 mm | r=0.666, bias +0.68 d/yr, RMSE 2.91 d |
| Sidhi | 291.3s | r=0.710, bias +136.5 mm/yr, RMSE 191.3 mm | r=0.818, bias +0.44 d/yr, RMSE 1.89 d |

All 5/5 districts, n=25 years both fields, every district. Rainfall
correlation is uniformly strong (r=0.71-0.93); heatwave-day correlation is
also consistently positive and mostly strong (r=0.67-0.89) despite the
field being a sparse near-zero count in most years, which is real signal,
not noise. Full detail (years_compared lists, both means) in
`dashboard/data/validation/madhya_pradesh/*.json`.

No GEE EECU quota error surfaced during either run -- both completed
(NDVI: 8/8 Tripura, validation: 5/5 MP) purely slowly under shared quota
contention, never blocked or erroring out.
