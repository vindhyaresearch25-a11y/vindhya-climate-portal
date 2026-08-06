# scripts/crop_yield/

Crop classification & yield estimation pipeline. Read
`docs/CROP_YIELD_METHODOLOGY.md` first — it explains why each stage is
designed the way it is (every choice is cited against real literature) and
which stages are blocked versus real and runnable today.

## Status (2026-08-06)

| Script | Status |
|---|---|
| `config.py` | Real — GEE credential checks (`require_gee()`), ICRISAT fetch config |
| `01_fetch_icrisat_district_yield.py` | **Real, runnable now** — downloads and SHA-256-verifies the public ICRISAT district panel (`docs/DATA_SOURCES.md` has the full provenance row) |
| Cropland masking, crop classification, phenology, MLOps, yield scaling, XAI, Airflow/Docker | Designed in METHODOLOGY.md §3, **not implemented** — blocked on a GEE service account and/or parcel-level ground truth (METHODOLOGY.md §7). Will not be scaffolded further ahead of those, per FINAL_PROMPT Phase F5's "don't show something broken" rule |

## Run the one real script

```bash
cd scripts/crop_yield
python 01_fetch_icrisat_district_yield.py
```

Writes `dashboard/data/crop_yield/icrisat_district_panel.json` (committed)
and caches the verified raw `.xls` alongside it (gitignored, kept locally
for re-parsing without re-downloading).

## To unblock the rest

1. Set `GEE_SERVICE_ACCOUNT_JSON` (path to a service-account key file) and
   `GEE_PROJECT_ID` as env vars. `config.require_gee()` checks for both and
   fails loudly, with this message, if either is missing.
2. Get real parcel-level ground truth (CCE, Digital Crop Survey, or UPAg
   formal access) — see METHODOLOGY.md §4 for what's been checked and what
   the literature recommends as a fallback meanwhile.
