# Knowledge base — provenance and copyright rules

This directory is the portal's reference layer: government data-portal
pointers, and open-access research literature relevant to farmer advisory
and district/village planning. It follows the same rule as the rest of this
repository: nothing here is fabricated, and every entry states where it came
from.

## Copyright rule (non-negotiable)

- Only content explicitly tagged open-access/open-license by its source may
  have its full text stored locally (`local_path` set, `full_text_available:
  true`).
- Anything else — a paywalled or unclear-license paper, any year — gets a
  **metadata-only** entry: title, author(s), year, official link, license
  field set to `"unknown"` or the specific restrictive license. The full text
  is never fetched or stored.
- Every entry records `source`, `publish_date` (if known), `fetch_date`, and
  `license`.

## Structure

`index.json` is the manifest consumed by the dashboard chatbot
(`dashboard/knowledge_base_loader.js`) and by `scripts/fetch_knowledge_base.py`.
Each entry:

```json
{
  "id": "unique-slug",
  "category": "research_papers | agriculture_yield | pmkisan | soil | water |
               disaster_risk | infrastructure | land_use | pmfby | kvk_reports",
  "title": "...",
  "authors": "...",
  "year": 2025,
  "source": "DOAJ | data.gov.in | Agmarknet | ... ",
  "source_url": "https://...",
  "license": "CC-BY-4.0 | CC0 | government-open-data-portal | unknown",
  "publish_date": "YYYY or YYYY-MM-DD or null",
  "fetch_date": "YYYY-MM-DD",
  "full_text_available": false,
  "local_path": null,
  "summary": "one or two factual sentences, quoted/paraphrased from the source abstract or portal description — never invented"
}
```

Subfolders (`agriculture_yield/`, `pmkisan/`, `soil/`, `water/`,
`disaster_risk/`, `infrastructure/`, `land_use/`, `pmfby/`,
`research_papers/`, `kvk_reports/`) hold `full_text_available: true` files
only. Most are currently empty — see the per-category status table below.

## Category status (2026-08-01)

| Category | Status | Notes |
|---|---|---|
| research_papers | Seeded (10 entries via DOAJ API) | Metadata + abstract only; DOAJ only indexes fully open-access journals, but article-level license should still be confirmed on the publisher page before treating any single article as redistributable |
| agriculture_yield | Portal pointer only | data.gov.in "Agriculture" sector + Agmarknet; bulk API needs a free data.gov.in API key (registration, not a login-gated dataset) — see `docs/NATIONAL_SCALE_RESEARCH.md` |
| pmkisan | Portal pointer only | data.gov.in PM-KISAN catalogs list beneficiary counts/disbursement by state/district; no confirmed no-key bulk API |
| soil | Portal pointer only | soilhealth.dac.gov.in publishes card statistics dashboards; no confirmed bulk download endpoint |
| water | Portal pointer only | India-WRIS (indiawris.gov.in) exposes a WFS/geoserver interface for CGWB groundwater layers; CWC reservoir/flood data is dashboard-only as far as verified |
| disaster_risk | Portal pointer only | NDMA publishes reports as PDF/publications; no bulk API found |
| infrastructure | Portal pointer only | PMGSY data appears on data.gov.in (Rural Development sector); OMMS portal is dashboard-only as far as verified |
| land_use | Portal pointer only | Bhuvan (ISRO) exposes WMS/WFS for LULC layers; FSI State of Forest Report is biennial PDF |
| pmfby | Seeded (2 entries via DOAJ) + portal pointer | Real DOAJ papers on PMFBY, plus a pointer to the existing MP-only PMFBY data referenced elsewhere in this repo |
| kvk_reports | Empty — manual curation required | No stable public bulk API for ICAR ePubs, Krishikosh, or per-KVK bulletins was found; scraping individual KVK/ICAR sites risks violating their terms of service, so this category is intentionally left for manual review rather than automated |

"Portal pointer only" means `index.json` has one entry per category linking
to the official portal/dataset landing page (title + official link only —
this is citing a public government resource, not redistributing its
content), and no bulk ingestion has run yet.

## Manual curation queue

`kvk_reports` and any `research_papers`/`pmfby` results DOAJ doesn't surface
should be added by hand: verify the license on the publisher's own page,
then add a metadata-only (or, if genuinely open-access, full-text) entry to
`index.json` following the schema above.
