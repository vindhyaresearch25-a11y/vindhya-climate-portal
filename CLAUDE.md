# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

VINDHYA Climate Portal — village/district-level heatwave, drought, and
extreme-precipitation analytics for five Madhya Pradesh districts (Bhopal,
Indore, Jabalpur, Rewa, Sidhi), built from IMD 0.05° gridded daily data
(2000–2024), UNDP DiCRA NDVI, and a CMIP6 (NEX-GDDP, SSP2-4.5) workflow for
2040 projections. Ships as a static dashboard (`dashboard/`) plus a Streamlit
wrapper (`app.py`) for hosted deployment.

## The one rule that overrides everything else

**No synthetic data, ever.** Every value the dashboard displays must trace to
a verifiable source (IMD, MODIS/DiCRA, CMIP6, government databases). This is
not a style preference — a prior version of this repo shipped 50 fabricated
districts and procedurally-generated cadastral owner names indistinguishably
from real data, and the 2026-08 cleanup (see `docs/METHODOLOGY.md` revision
note and `docs/DATA_SOURCES.md`) ripped all of it out. Consequences for how
you work here:

- Never add `np.random`, `random.uniform/choice/randint`, or any other
  generator to `scripts/` — CI (`.github/workflows/verify-data.yml`) greps
  for this and fails the build if found.
- Any new dataset/JSON file needs a `metadata` block (source, resolution,
  CRS, processing, `last_updated`) — CI checks every `dashboard/data/*.json`
  for one, and `docs/DATA_SOURCES.md` is the provenance register that must
  be kept in sync.
- If a real value isn't available, leave it absent/labeled "indicative"
  rather than approximating it. `forecast_2040.json` is a deterministic OLS
  trend on real history, explicitly labeled indicative — CMIP6 model output
  is the only thing allowed to claim to be a projection.
- Prefer widening `docs/METHODOLOGY.md` §7/§"Standing limitations" over
  quietly smoothing over a data gap.

## Commands

```bash
pip install -r requirements.txt

# Pipeline (run from scripts/; needs real IMD NetCDF + village shapefile —
# see env vars below, no sample data is bundled)
cd scripts
python 01_extract_village_timeseries.py      # IMD daily -> per-village parquet
python 02_compute_indices.py                 # heatwave / SPI / ETCCDI per village-year
python 03_build_chart_data.py                # chart JSON
python 04_build_dashboard_json.py            # -> dashboard/data/mp_climate_data.json
# CMIP6 2040 projections: paste scripts/05_gee_cmip6_2040.js into the GEE code
# editor, export the CSV, then: python 06_convert_gee_export.py
# DiCRA NDVI + trend forecast: python 07_build_dicra_forecast.py
```

Windows one-shot: `scripts\run_all.bat` (steps 01–04 only).

```bash
python -m pytest tests/                      # all tests
python -m pytest tests/test_indices.py::test_spi_standard_normal_properties  # single test

cd dashboard && python -m http.server 8000    # serve the static dashboard locally
# Do NOT open dashboard/index.html via file:// — fetch() of the JSON/GeoJSON
# data is blocked by same-origin policy; it must be served over http(s).

streamlit run app.py                          # Streamlit-hosted variant

./push.sh "commit message"                    # git add -A, commit, push (GitHub Pages)
```

Pipeline input paths are env-driven, not hardcoded (`IMD_TMAX_DIR`,
`IMD_TMIN_DIR`, `IMD_PRECIP_DIR`, `MP_VILLAGE_SHAPEFILE`, `GEE_PROJECT_ID` —
see `scripts/config.py`). There is no `.env.example` currently checked in
despite the README referencing one; set these directly or add one.

## Architecture

### Pipeline (`scripts/`) — numbered, run in order, each stage writes to the next

`config.py` is the single source of truth for paths, district centroids,
index thresholds (heatwave, SPI, ETCCDI base period), and the CMIP6 model
list — read it before touching any script's numeric constants.
`common.py` opens one IMD yearly NetCDF (`open_yearly`), auto-detecting the
variable/lat/lon/time names across several naming conventions IMD has used
historically, and box-samples a lat/lon window (`sample_district_box`).

Flow: `01_extract_village_timeseries.py` (NetCDF → per-village daily
parquet) → `02_compute_indices.py` (daily → per-village-year indices;
`02_finish.py` is a small district-rollup helper run after it) →
`03_build_chart_data.py` (indices → chart-ready JSON) →
`04_build_dashboard_json.py` (assembles the payload the dashboard fetches,
`dashboard/data/mp_climate_data.json`). The CMIP6 branch is separate:
`05_gee_cmip6_2040.js` runs *inside* the Google Earth Engine code editor (not
locally — it's JS pasted into GEE, not a Node script), its CSV export is
converted by `06_convert_gee_export.py`. `07_build_dicra_forecast.py`
produces both the DiCRA NDVI JSON and the OLS trend forecast.

Test note: `tests/test_indices.py` imports `02_compute_indices.py` via
`importlib.import_module("02_compute_indices")` (not `import
compute_indices`) because the module name starts with a digit and isn't a
valid Python identifier for a normal import — follow that pattern for any
new tests against numbered scripts.

`tools/` holds one-off inspection/debug scripts (shapefile checks, NaN
fixes) — not part of the reproducible pipeline, safe to ignore unless
debugging a specific data issue.

### Frontend (`dashboard/`) — static, no build step

`dashboard/index.html` is a single large page (Leaflet for the map, Chart.js
for charts, Turf.js for geometry ops, all via CDN `<script>` tags) with a
long inline `<script>` block (map init, district/village selection, UI
wiring, `MP_DISTRICTS` centroid table that must match `scripts/config.py`
`DISTRICTS`) plus four external loader scripts tagged on at the bottom, each
owning one data layer:

- `mp_climate_loader.js` — fetches `data/mp_climate_data.json`, drives the
  main climate charts/panels (`DATA_URL` constant at its top).
- `dicra_ndvi_loader.js` — NDVI charts from `data/dicra_ndvi.json`.
- `cadastral_loader.js` — stub; disabled pending official MP Bhulekh /
  Revenue Dept. cadastral records (do not re-enable with placeholder data).
- `india_boundaries_loader.js` — all-India state/district overlay layers.
- `geoai_professional.js` — AOI polygon analysis / other map tooling, wired
  up separately from the four data loaders above.

Root-level `index.html` is just a meta-refresh redirect into `dashboard/`.

### Streamlit host (`app.py`)

Not a separate app — it re-serves the same static dashboard inside an
iframe via `st.components.v1.html()`. At runtime it: inlines the four loader
JS files directly into the HTML (so their `fetch()` URLs are reachable for
string-patching), then rewrites every local data/GeoJSON path to point at
`raw.githubusercontent.com/.../main/dashboard/...` (`_URL_PATCHES` +
the `'data/villages_'` dynamic-path rewrite), injects `GEMINI_API_KEY` from
Streamlit secrets in place of the `const GEMINI_KEY = ''` placeholder in the
inline script, and base64-inlines `logo.jpeg`. If you add a new fetch() call
or hardcoded data path in the dashboard JS, you generally need a matching
patch here or it will 404 on the Streamlit deployment (it still works
correctly when served locally via `http.server`, since that reads local
files directly).

### CI (`.github/workflows/verify-data.yml`)

Runs weekly + on push to itself/`fetch_verify_sources.py` + manually. In
order: validates `dashboard/data/*.json` (allowed district set, metadata
presence, physically-plausible index ranges, GeoJSON structure) → greps
`scripts/` for random-generation calls and fails if any are found → runs
`pytest tests/` → runs `scripts/fetch_verify_sources.py` to cross-check
published data against upstream authoritative sources (`continue-on-error:
true` — an unreachable upstream mirror must never fail the build, since the
already-published data is validated independently above) → commits
`docs/data_manifest.json` if the provenance manifest changed.

## Docs worth reading before non-trivial changes

- `docs/METHODOLOGY.md` — exact index definitions (IMD heatwave criteria,
  McKee SPI with the zero-inflated gamma correction, ETCCDI extremes), the
  district risk-classification scoring, and a `## 7. Limitations` section
  that should be extended rather than silently invalidated by future work.
- `docs/DATA_SOURCES.md` — the provenance register; any new served file
  needs a row here.
- `CONTRIBUTING.md` — the ground rules this file expands on.
