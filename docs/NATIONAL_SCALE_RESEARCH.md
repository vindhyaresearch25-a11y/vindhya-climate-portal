# National-scale upgrade — research findings (2026-08-01)

Research-only document. No boundary or dataset listed here has been
downloaded and merged into `dashboard/data/` unless explicitly stated —
merging real geometry/records into the shipped dataset is a separate,
future step that must go through `tools/validate_boundaries.py` and the
provenance rules in `CONTRIBUTING.md` / `docs/DATA_SOURCES.md` first.

## 1. Administrative boundaries — open-source coverage by level

| Level | Status | Best source(s) found | Notes |
|---|---|---|---|
| State | **Complete** | Census of India 2011 (already in this repo, `dashboard/data/boundaries/india_states.geojson`) | 36 states/UTs, already shipped. |
| District | **Complete** | Census 2011 (already shipped); corroborated by [datameet/maps](https://github.com/datameet/maps) and [geoBoundaries](https://github.com/wmgeolab/geoBoundaries) ADM2 | Multiple independent open sources agree; safe to treat as reliable. |
| Block / Tehsil (sub-district) | **Partial — needs validation before "verified"** | [datameet/maps](https://github.com/datameet/maps/blob/master/Districts/README.md) taluk/tehsil layer (sourced from Bhuvan Geoserver + GeoCommons, by its own README last refreshed some years ago); [geoBoundaries ADM3](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM3/geoBoundaries-IND-ADM3.geojson) (global standardized, CC-BY-4.0) | Only MP has this in the current repo (`mp_tehsils.geojson`, `mp_blocks.geojson`). Neither open candidate has a confirmed recent revalidation against LGD's current sub-district list — run `tools/validate_boundaries.py` and a name/code join against LGD (see §2) before shipping as "verified". |
| Village / Gram Panchayat | **Partial, community-sourced — not government-published** | [India Geodata project](https://yashveeeeeeer.github.io/india-geodata/) (claims all-India village + gram panchayat + habitation coverage, LGD/SoI/Bhuvan/eGramSwaraj-sourced, CC0/CC-BY mixed); [SHRUG v2.1](https://docs.devdatalab.org/SHRUG-Construction-Details/shrug-open-source-polygons/) (649,618 village/town polygons, 2011 Census-aligned, documented ~0-2 km positional error, Thiessen-polygon substitutes for point-only forest/NE locations, academic citation required); [ramSeraph/indian_admin_boundaries](https://github.com/ramSeraph/indian_admin_boundaries) (panchayat/village, community-maintained, 41 stars); [datameet/indian_village_boundaries](https://github.com/datameet/indian_village_boundaries) (explicitly partial, only some states digitized) | Only 5 MP districts have village polygons in this repo today (LGD-coded, directly government-shapefile-sourced — that layer stays "verified"). Any new all-India village layer sourced from the above must be labelled a distinct, lower quality tier ("community-sourced") in `docs/DATA_SOURCES.md`, not merged into the same "verified" tier as the existing 5-district layer, until cross-checked against an official source. |

### On the sources suggested during this session

- **LGD — Local Government Directory** (<https://lgdirectory.gov.in/>, bulk CSV at `/downloadDirectory.do`, also mirrored on [data.gov.in](https://www.data.gov.in/catalog/local-government-directory-lgd) and [planemad/india-local-government-directory](https://github.com/planemad/india-local-government-directory)): confirmed reachable, no login required for district-wise reports. **This is a names/codes directory, not a boundary source** — it gives the authoritative state→district→sub-district→village hierarchy and LGD codes, which is exactly the join key the geometry sources above need, but it does not itself publish polygons.
- **eGramSwaraj** (<https://egramswaraj.gov.in/>): confirmed reachable. Ministry of Panchayati Raj portal for Gram Panchayat Development Plans and panchayat-level scheme/works data, keyed to LGD codes. Cited by the India Geodata project as one of its panchayat-boundary input sources, but eGramSwaraj's own public interface is governance/planning data, not a direct boundary download.
- **NWDP / National Water Informatics Centre — Geological Survey of India org page** (<https://nwdp.nwic.gov.in/organization/geological-survey-of-india>): confirmed reachable. This is a hydrogeological/water-resource dataset catalog (GSI's contributions to the National Water Data Portal), not a village/state boundary source — relevant to the **water** category in §3, not to §1.

### Duplicate/overlap validation

`tools/validate_boundaries.py` (added this session) checks any candidate
polygon layer for: invalid/self-intersecting geometry, duplicate id-field
values, duplicate/near-duplicate geometries, sibling-polygon overlaps above
a configurable area threshold, and (optionally) a parent-coverage sum check
against a district/state polygon. It only reports — it never repairs or
drops a feature automatically, per this project's no-fabrication rule.
Usage is documented in the script's docstring.

## 2. National data sources — status by category

| # | Category | Source(s) checked | No-login API/bulk? | Admin level | Status |
|---|---|---|---|---|---|
| 1 | Agriculture yield/crop | [data.gov.in agriculture sector](https://www.data.gov.in/sector/agriculture), [Agmarknet](https://agmarknet.gov.in/) | data.gov.in's OGD API needs a **free API key** (self-service registration, not a login-gated dataset); CSV download via the website does not require a key. Agmarknet has a public price-search page; no confirmed no-key bulk API. | State/district (data.gov.in), market/mandi (Agmarknet) | Portal pointer registered in knowledge base; bulk ingestion needs a data.gov.in API key, which was not available in this environment. |
| 2 | PM-KISAN | [data.gov.in PM-KISAN catalogs](https://www.data.gov.in/search?title=PM-KISAN), pmkisan.gov.in | Same data.gov.in API-key caveat as above. pmkisan.gov.in itself is an individual-beneficiary lookup, not a bulk source. | State/district | Portal pointer registered. |
| 3 | Soil health/type | [soilhealth.dac.gov.in](https://soilhealth.dac.gov.in/) | Publishes dashboards; no confirmed bulk-download endpoint found. | State/district/block | Portal pointer registered. |
| 4 | Socio-economic/Census | [censusindia.gov.in](https://censusindia.gov.in/) | Static table downloads (many no-login); no standard bulk API. | All levels (varies by table) | Not yet registered — same caveat as soil: manual table download, not scriptable without per-table work. |
| 5 | Water resources | [India-WRIS](https://indiawris.gov.in/wris/#/groundWater) (CGWB), [CWC WRIS](https://cwc.gov.in/en/water-resources-information-system-wris) | India-WRIS exposes a WFS/geoserver interface for unclassified CGWB data (programmatic, no login stated). CWC's own portal: no confirmed bulk API. | Station/district | Portal pointers registered; India-WRIS WFS endpoint not yet integrated (would need a dedicated fetch script, out of scope for this session). |
| 6 | Disaster risk history | [NDMA](https://ndma.gov.in/) | Publications/reports as PDF; no unified bulk API for historical records found. | State/district (varies by report) | Portal pointer registered. |
| 7 | Infrastructure (PMGSY etc.) | [data.gov.in PMGSY datasets](https://www.data.gov.in/search?title=PMGSY) | Same data.gov.in API-key caveat. OMMS (omms.nic.in) project-monitoring portal: dashboard-only as far as verified. | State/district | Portal pointer registered. |
| 8 | Land use/forest cover | [Bhuvan](https://bhuvan-app1.nrsc.gov.in/gwis/) (ISRO), [FSI](https://fsi.nic.in/) | Bhuvan exposes WMS/WFS for some thematic layers without login, others need registration (verify per layer). FSI's State of Forest Report is a biennial PDF; geospatial layers go through Bhuvan. | District (FSI biennial report), varies (Bhuvan layers) | Portal pointers registered. **The dashboard's Ecology panel previously fabricated forest-cover/biodiversity/carbon numbers with no real source at all — that has been removed this session (see integrity-fix commit); this row is the honest replacement path.** |
| 9 | PMFBY (all-India) | Existing MP-only reference in this repo; [data.gov.in](https://www.data.gov.in/) likely hosts PMFBY claim/enrollment data (not yet located with a confirmed no-login bulk endpoint) | Not yet confirmed | State/district | 2 real open-access research papers registered in the knowledge base (see §3); no all-India operational PMFBY dataset ingested yet. |

## 3. Reference library (Part B)

`dashboard/data/knowledge_base/` now holds 37 entries (10 manually seeded +
17 auto-fetched this session via the DOAJ open-access search API, "wheat
yield", "PMFBY", "soil health", "groundwater", "drought", "land use" queries
across the 9 categories above where a reasonable query existed). All 37 are
metadata-only (title/author/year/link/license/abstract) — no full text has
been downloaded, per the copyright rule in
`dashboard/data/knowledge_base/README.md`.

**kvk_reports is empty and intentionally not automated.** No stable public
bulk API for ICAR ePubs, Krishikosh, or per-district KVK bulletins was
found; scraping those sites individually risks violating their terms of
service. That category is a manual-curation queue: verify the license on
each document's own publisher page before adding a metadata (or, if
genuinely open-access, full-text) entry.

## 4. What's automated vs. what needs a human

**Automated and tested this session:**
- `scripts/fetch_knowledge_base.py` — real DOAJ API calls, idempotent (re-running adds no duplicates), non-fatal per-source failure handling.
- `.github/workflows/annual-data-refresh.yml` — runs the above on a 1 April cron (+ manual trigger), opens a **pull request** (not a direct push) so new entries get human review.
- `tools/validate_boundaries.py` — geometry/duplicate/overlap checker for any future boundary layer.

**Needs a human before it can be automated further:**
- A data.gov.in API key, to unlock categories 1, 2 and 7 above (agriculture yield, PM-KISAN, PMGSY).
- A decision on which community village-boundary source (India Geodata / SHRUG / ramSeraph) to adopt for all-India village coverage, and at what quality-tier label — this is a data-provenance decision, not a scripting one.
- Manual curation of `kvk_reports` and any ICAR/Krishikosh material, one document at a time, per the copyright rule.
