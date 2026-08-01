# Go-Live Plan: Repository to Public Portal

Status of the codebase after the August 2026 audit: scientifically defensible
for five districts, structurally clean, no synthetic data. It is **not yet a
live portal**. This document lists exactly what is missing.

---

## 1. Why the current hosting will not work in production

`app.py` wraps the dashboard in a Streamlit iframe and fetches 42 MB of
GeoJSON from `raw.githubusercontent.com` at runtime. Three problems:

| Problem | Consequence |
|---|---|
| GitHub raw is not a CDN and rate-limits at roughly 60 requests/hour/IP unauthenticated | Portal breaks under any real traffic |
| 42 MB of boundary GeoJSON per session | 30 to 90 second first load on rural 4G |
| Streamlit Cloud free tier sleeps after inactivity and has a 1 GB memory cap | Cold starts of 30 seconds or more; officials will not wait |

The dashboard is a static single-page application. It does not need Streamlit
at all.

---

## 2. Target architecture

```
Browser
  ├── Static frontend        Cloudflare Pages (free)
  ├── Map geometry           PMTiles on Cloudflare R2 (no tile server needed)
  └── Live data              FastAPI backend on Render/Railway
                               ├── NASA POWER      (weather, keyless)
                               ├── AGMARKNET       (mandi prices, key)
                               ├── CGWB India-WRIS (groundwater)
                               ├── Redis/file cache (12 to 24 h TTL)
                               └── PostgreSQL + PostGIS (village indices)
```

**Why PMTiles.** All-India village boundaries as raw GeoJSON are roughly
8 to 15 GB. Converted to PMTiles with `tippecanoe`, the whole country fits in
a single 2 to 4 GB file served from object storage with HTTP range requests.
No tile server, no per-request compute. This is the single most important
architectural decision for the national rollout.

**Why a backend is unavoidable.** AGMARKNET, CGWB, and Bhulekh APIs either
require keys that cannot be exposed in browser JavaScript, or block
cross-origin browser requests. A thin proxy with caching solves both and
protects you from upstream rate limits.

---

## 3. What you must obtain

### Immediately, free, no waiting

| Item | Where | Time |
|---|---|---|
| Domain name (.in or .org.in) | Any registrar | 1 hour |
| data.gov.in API key (AGMARKNET mandi prices) | data.gov.in registration | Instant |
| NASA POWER access | No key required | None |
| Cloudflare account (Pages + R2) | cloudflare.com | 1 hour |
| Google Earth Engine service account | Non-commercial/research registration | 1 to 3 days |

### Requires application or agreement

| Item | Authority | Realistic time |
|---|---|---|
| MP Bhulekh / Bhu-Naksha cadastral vectors | MP Revenue Department | 1 to 3 months, needs institutional letter |
| CGWB groundwater API access | Central Ground Water Board / India-WRIS | 2 to 6 weeks |
| Soil Health Card bulk data | Department of Agriculture, MP | 1 to 2 months |
| LGD village boundary shapefiles (all India) | Survey of India / Census / state departments | Varies; some available openly |

Requirement 7 of your specification, real parcels drawn on field bunds, is
gated entirely on the Bhulekh agreement. Start that application first because
it has the longest lead time.

---

## 4. Engineering work remaining

| Task | Effort | Priority |
|---|---|---|
| Replace Streamlit host with static Cloudflare Pages deployment | 1 day | Critical |
| Convert boundary layers to PMTiles, migrate map to MapLibre GL | 4 to 6 days | Critical |
| FastAPI backend with caching, key management, health checks | 5 to 7 days | Critical |
| NASA POWER integration (real-time weather, any village) | 2 days | High |
| PostGIS migration of village indices out of a 3.5 MB JSON blob | 3 days | High |
| AGMARKNET mandi module | 3 days | High |
| Metadata panel, legend, scale bar, north arrow (Req. 19 to 21) | 3 days | High |
| Hindi/English string audit and completion (Req. 25) | 2 days | Medium |
| Extend IMD to 1995 for a 30-year normal; run four SSP scenarios | 4 days | Medium |
| Auto PDF report generator (Req. 44) | 4 days | Medium |
| Yield and crop-suitability models with RMSE/R²/SHAP reporting (Req. 16, 34, 37, 42) | 4 to 8 weeks | Later |

Total to a credible public launch covering five districts: roughly **4 to 6
weeks** of focused development. National coverage of state, district, block,
and village boundaries adds 2 to 3 weeks once the source shapefiles are in
hand.

---

## 5. Running cost

| Component | Monthly (INR) |
|---|---|
| Cloudflare Pages (frontend) | 0 |
| Cloudflare R2 (PMTiles, ~10 GB + egress) | 150 to 400 |
| Backend (Render/Railway starter) | 600 to 1,200 |
| PostgreSQL + PostGIS (managed, small) | 400 to 900 |
| Domain (amortized) | 100 |
| **Total** | **₹1,250 to ₹2,600** |

Google Earth Engine is free for research and non-commercial use. Costs rise
only if you move to commercial GEE or heavy imagery processing.

---

## 6. Non-negotiable before public launch

1. **Disclaimer page.** State that indices are derived from 5.5 km gridded
   data, that advisories are informational and not a substitute for KVK or
   extension officer guidance, and that cadastral displays are not legal land
   records.
2. **Data licensing compliance.** IMD, Census, and DiCRA terms must be
   honored and attributed on every layer.
3. **Privacy policy.** Mandatory if you collect any farmer identity or
   location data. Avoid collecting personal data at launch; it changes your
   compliance burden substantially.
4. **Backups.** Automated daily database snapshots with a tested restore.
5. **Uptime monitoring.** A free UptimeRobot check is sufficient initially.
6. **Institutional review.** If NABARD, ICAR, or state government endorsement
   is the goal (Req. 32), have the methodology reviewed before launch rather
   than after.

---

## 7. Recommended sequence

**Week 1.** Register domain, data.gov.in key, GEE service account, Cloudflare.
Submit the Bhulekh application. Deploy the current five-district dashboard as
a static site on Cloudflare Pages. This alone gives a fast, always-on public
URL.

**Week 2.** PMTiles conversion of MP boundaries; migrate to MapLibre GL.
Stand up the FastAPI backend with NASA POWER.

**Week 3.** PostGIS migration; AGMARKNET module; metadata panel, legend,
scale bar, north arrow.

**Week 4.** Hindi/English audit, disclaimer and licensing pages, monitoring
and backups. Soft launch to a limited group of officials and KVK staff.

**Weeks 5 to 8.** Act on soft-launch feedback. Extend to all-India boundaries.
Begin model training only once the underlying real data feeds are stable.

---

## 8. The one thing to avoid

Do not launch AI yield predictions, crop-suitability probabilities, or
confidence scores until models are trained on real data and validated with
reported metrics. Publishing a "92% suitability" figure produced by a formula
rather than a validated model is the same category of error as the synthetic
district data that was just removed, and it would be far more damaging after
a public launch than before one.
