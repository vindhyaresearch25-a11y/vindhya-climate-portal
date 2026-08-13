# Field-scale soil moisture investigation (KHET-STAR KI NAMI, 2026-08-13)

Owner's ask: the current `dashboard/data/soil_moisture/<state>/<district>.json`
(`scripts/13_gee_national_soil_moisture.py`) is real NASA SMAP L4 data but at
~9 km resolution -- far coarser than a single farmer's field. Investigate two
real options for field-scale (or field-comparable) soil moisture for Mera
Khet, in this order.

## 4a. SMAP/Sentinel-1 disaggregated product (SPL2SMAP_S) -- REJECTED, verified

A prior session had already concluded "not usable in GEE" but made no
commits, so this was independently re-verified from scratch rather than
trusted.

**Verification method** (live queries against this project's real GEE
service-account credentials, `GEE_SERVICE_ACCOUNT_JSON`/`GEE_PROJECT_ID` from
`scripts/config.py`, 2026-08-13):

1. `ee.ImageCollection("NASA/SMAP/SPL2SMAP_S/003")` and `.../002` (the two
   plausible version guesses) both raise
   `EEException: ImageCollection asset ... not found (does not exist or
   caller does not have access)`.
2. **Authoritative check**: `ee.data.listAssets({"parent":
   "projects/earthengine-public/assets/NASA/SMAP"})` -- this asks Earth
   Engine directly for every real child asset under the `NASA/SMAP` folder
   in the public catalog, not a guessed ID. Real result:
   ```
   NASA/SMAP/SPL3SMP_E   FOLDER
   NASA/SMAP/SPL4SMGP    FOLDER
   ```
   Only these two SMAP collections exist in GEE's public catalog. No
   `SPL2SMAP_S`, no `SPL3SMP` (the plain L3, also checked and also not
   found).
3. GEE's own catalog webpage for the asset,
   `https://developers.google.com/earth-engine/datasets/catalog/NASA_SMAP_SPL2SMAP_S_003`,
   returns HTTP 404.
4. Cross-checked against the product's own home at NSIDC
   (`https://nsidc.org/data/spl2smap_s/versions/3`, fetched 2026-08-13): the
   SPL2SMAP_S product itself is real (NASA/JPL, SMAP L2 Radiometer/Radar,
   disaggregated using Sentinel-1 backscatter) but:
   - **Never was ingested into GEE at all** -- independent of the
     resolution question, GEE simply does not carry this collection.
   - **Native resolution, per NSIDC's own page**: resampled to a **3 km**
     EASE-Grid for the validated product; a 1 km variant exists but NSIDC's
     own page says it "has not [undergone validation] and should be used
     with caution." So even where it exists, "1-3 km" is optimistic for the
     validated data -- 3 km is the real, validated number.
   - **Currently discontinued**: NSIDC's page carries a standing alert --
     "Due to end of operations for Sentinel-1A input data, SPL2SMAP_S
     forward processing was paused on 01 July 2026. The mission is
     currently working to migrate production to use Sentinel-1C/1D input
     data." As of this investigation (2026-08-13) there is no new data
     being produced, on top of it never having reached GEE.
   - Coverage was global between 60N/60S (India included) while active,
     historical data 31 March 2015 to the July 2026 pause.

**Conclusion**: 4a is conclusively not usable, for two independent reasons
that each alone would be disqualifying -- (1) the collection was never
ingested into Earth Engine's public catalog (confirmed via the authoritative
`ee.data.listAssets()` folder listing, not a guessed asset ID), and (2) even
at its origin (NSIDC/NASA), the product is currently paused/discontinued as
of July 2026 pending a Sentinel-1C/1D migration. This independently confirms
the prior session's uncommitted claim -- not just trusting it. No script was
built for 4a; there is nothing to benchmark since there is no queryable
asset.

Moved to 4b per the task's fallback plan.

## 4b. Sentinel-1 backscatter relative wetness index -- see `cloudflare/mera_khet_worker.js`

Implemented as a new capability in the same Worker that already serves
NDVI/cropland for Mera Khet, following its exact verified-serialization
pattern (`ee.serializer.encode(..., for_cloud_api=True)`, never hand-written
REST JSON -- see that file's header). Field name is deliberately
`field_wetness_index_relative`, never `soil_moisture`, because a
backscatter-vs-backscatter ratio between two areas in the identical
satellite pass is a real, honest relative comparison, but is NOT invertible
to an absolute m3/m3 value without ancillary data this repo does not have.
See `cloudflare/mera_khet_worker.js`'s header for the full method, and
`docs/MERA_KHET_BENCHMARK.json` / `docs/DATA_SOURCES.md` for the measured
benchmark numbers.
