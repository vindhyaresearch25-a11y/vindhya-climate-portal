# Changelog

Notable changes to the VINDHYA Climate Portal. Dates are in `YYYY-MM-DD`.

## 2026-08-01

### Fixed

- **CI: "Verify authoritative data sources" workflow failing on every run.**
  The "Run unit tests" step installed only `numpy pandas scipy pytest`, but
  `tests/test_indices.py` imports `scripts/02_compute_indices.py`, which
  requires `tqdm` at module load time — every run failed with
  `ModuleNotFoundError: No module named 'tqdm'`. The step now installs the
  full `requirements.txt` instead of a hand-maintained subset, so it can't
  drift out of sync with the project's actual dependencies again.
- **Removed all fabricated/simulated metrics from the live dashboard.**
  Several code paths computed numbers that were never sourced from IMD,
  DiCRA, or any other registered dataset, and displayed them indistinguishably
  from real data: an "AI/ML Forecasting Engine" panel claiming six ML models
  (LSTM, XGBoost, CNN, ...) that do not exist anywhere in this codebase (no
  ML library is even a project dependency); an "AI Accuracy" stat fixed at
  94.2%; NDVI values computed from a fabricated `spi_12 * 0.1 + 0.5` formula
  instead of real NDVI; a groundwater depth literally derived from
  `charCodeAt(0)` of the district name; and an Ecology panel (forest cover,
  biodiversity risk, carbon stock) computed entirely from the fabricated
  NDVI. All of these now show the real IMD/DiCRA-derived value where one
  exists, or an explicit "Not available" state — never an invented number.
  See `dashboard/mp_climate_loader.js` and `dashboard/index.html`.
- **Static default UI content matched the same pattern.** Before any
  district was selected, the metric cards and the AI Farmer Advisory panel
  showed hardcoded placeholder values (e.g. a "HEATWAVE ALERT — Indore, Dhar,
  Barwani" that named districts this dashboard doesn't have data for). These
  now show neutral "Select a district" placeholders instead of numbers that
  look real.
- **Chatbot system prompt no longer contains fabricated "active alerts."**
  A hardcoded line ("heatwave in Indore/Dhar/Barwani... drought watch in
  Bundelkhand...") was fed to the Gemini model as if it were live ground
  truth. The prompt now only includes real data blocks and instructs the
  model to say explicitly when information isn't available rather than
  estimate it.
- **Sidebar logo was being cropped.** `object-fit:cover` on a non-square
  logo image inside a fixed 36x36px box clipped its sides; changed to
  `object-fit:contain`.
- **Landing page was two sequential full-screen steps** (a name/organisation
  form, then a separate role-selection page) before reaching the dashboard.
  Merged into one screen: role selection now lives on the same card as the
  entry form, and submitting either goes straight to the dashboard.

### Added

- Background image slideshow and rotating bilingual (Hindi/English) tagline
  and quote lines on the entry screen.
- `dashboard/data/knowledge_base/` — a manifest-driven reference layer
  (government portal pointers plus a small set of real open-access research
  papers fetched via the DOAJ API) for the farmer-advisory chatbot, with a
  documented copyright rule: only confirmed open-access content gets its
  full text stored, everything else is metadata-only.
- `scripts/fetch_knowledge_base.py` and
  `.github/workflows/annual-data-refresh.yml` — an annual (1 April) job that
  refreshes the knowledge base from DOAJ and opens a pull request with any
  new entries, rather than committing directly to `main`.
- `tools/validate_boundaries.py` — a reusable geometry/duplicate/overlap
  checker for any future administrative boundary layer, ahead of a possible
  national (all-India) boundary expansion.
- `docs/NATIONAL_SCALE_RESEARCH.md` — research findings on open-source
  administrative-boundary coverage (state/district/block/village) and the
  public-data-access status of nine national data categories (agriculture,
  PM-KISAN, soil, water, disaster risk, infrastructure, land use, PMFBY,
  and reference literature).

### Changed

- `scripts/fetch_verify_sources.py`'s `download()` now retries a failed
  network request up to 3 times (fixed 3-second backoff) before giving up on
  that source, instead of failing on the first transient error.

### Security

- Verified no API key, token, or other secret is hardcoded anywhere in the
  repository; the Gemini API key remains injected at deploy time from
  Streamlit secrets, and `.env` stays untracked and gitignored.
