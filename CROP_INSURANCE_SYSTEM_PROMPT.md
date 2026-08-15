# SMART CROP INSURANCE & AI-BASED CROP LOSS ASSESSMENT -- pilot (Simrol, Indore)

Ye `CROP_INSURANCE_DEMO_PROMPT.md` (chhota demo draft) ko **replace**
karta hai -- wahi maqsad (Simrol, Indore ke liye pehle ek pilot, phir
pasand aane par poora desh) lekin poora architecture ab 8 modules me,
jaisa neeche hai. Purani file ko `docs/` ya history me rehne do,
naya kaam is file se chalao.

Har item ke saamne: **HUA / NAHI KIYA / kyun nahi**

---

## STATUS LOG (2026-08-15)

**Module 1 (GIS Land Parcel): HUA (v1).** `dashboard/crop_insurance_pilot/index.html`
+ `dashboard/data/crop_insurance_pilot/simrol_boundary.geojson`. Built and
live-tested in a real browser (Chrome, via localhost, screenshot-verified
-- not just "should work"):
- Simrol's **real** village boundary extracted from the same Survey of
  India/NWDP village layer this portal already uses nationally (fetched
  live from the Hugging Face-hosted `boundaries/soi/villages/
  madhya_pradesh/indore.geojson`, feature matched on `village_name ==
  "Simrol"`, vil_lgd 476504, block Mhow, district Indore) -- not
  hand-drawn, not approximated.
- Real Census fields carried in that same SoI/NWDP feature shown as-is:
  population 9,856, households 1,956 -- not separately fetched/estimated.
- Demo parcel grid (168 target cells, deterministic bbox subdivision
  clipped to the real village polygon via Turf.js `intersect` -- no
  `Math.random()` anywhere) -- clicking a parcel opens a Farmer Dashboard
  card with a synthetic `MP-IND-MHW-NNNNN` id (real block code MHW for
  Mhow, not the illustrative "BAR" from rule #2) and a placeholder
  `किसान-उदाहरण-N` name.
- Sticky DEMO banner (rule #2), disclaimer text (rule #4) present verbatim
  on every parcel dashboard.
- Known limitation, disclosed in-page: each demo parcel is ~15-20 ha, not
  individual-farm-sized (~0.5-2 ha real holdings) -- a finer grid would
  need ~1,500+ cells for realistic sizing, impractical for a client-side
  demo; noted in the code comment, not hidden.
- NOT done: this page is not yet linked from the main dashboard
  (`dashboard/index.html`) nav -- that file is under active edit by
  another concurrent session (`AUDIT_FIX_PROMPT.md`), so a nav-link edit
  was deliberately deferred to avoid a collision; reachable directly via
  `dashboard/crop_insurance_pilot/index.html` for now.

## STATUS LOG UPDATE (2026-08-15, same session, owner said "GO AHEAD ALL")

**Modules 2-8: HUA (v1), all built into the same `dashboard/crop_insurance_pilot/index.html`
page as a tab strip below the Module 1 map, all driven off the same parcel
selection. Live-tested end to end in a real browser (Chrome via localhost,
screenshot-verified every module, console checked clean) -- one real
syntax bug found and fixed mid-build (an unescaped apostrophe inside a
template literal broke the entire script's parse, so NOTHING rendered
until fixed -- caught by actually opening the page, not by assuming the
code was fine).**

- **Module 2 (Registry + Land-Use):** deterministic land-use split
  (Crop/Orchard/House/Trees/Water/Fallow) summing exactly to the real
  Module-1 parcel area; one parcel (idx 3) deliberately broken by 30% on
  its Crop figure so the Data-Quality-Warning path is provably real, not
  just written and never triggered -- confirmed the non-broken parcel
  shows "Classified area matches Parcel Area" correctly. Crop/season/
  variety/seed-type/dates/irrigation demo fields; ~1-in-11 parcels get a
  multi-crop polygon split note.
- **Module 3 (CCE & Yield):** historical yield chart is **real** DES data
  (Indore district, 2000-2023, the crop actually grown on the selected
  parcel) with a linear-trend 2024-2026 extension rendered as a visibly
  dashed segment, same "indicative" convention as this repo's existing
  `forecast_2040.json`. Yield Prediction Engine formula shown in full
  (Historical Avg x Seed Factor x real Weather Factor x NDVI Factor) --
  no black-box number. Found and fixed a real UX bug mid-testing: when
  predicted yield exceeds historical (a real possible outcome of the
  formula), the metric now correctly relabels to "Potential Gain" instead
  of showing a confusing negative "Potential Loss %".
- **Module 4 (Weather Events):** real threshold checks against this
  portal's own Indore `annual_trends` (heatwave days, extreme-rain days,
  Rx1day, SPI-12) -- live-tested result for the real latest year (2024)
  correctly returned "No extreme event flagged / Low", not a fabricated
  event. Explicitly kept as a separate layer from crop damage per the
  spec's own rule -- the panel says so in its own text.
- **Module 5 (Evidence App):** live-tested the full flow -- file picker,
  note field, "Report Crop Damage" button triggers real
  `navigator.geolocation`; when permission was denied/unavailable in this
  headless test, the honest fallback path fired correctly (parcel
  centroid used, explicitly labeled as a fallback, not presented as a
  real GPS fix) and the real `turf.booleanPointInPolygon` GPS-match check
  correctly badged the submitted evidence.
- **Module 6 (AI Image Damage Detection):** feasibility assessed and
  written out in full per rule 5 -- **conclusion: not buildable as a real
  model in this environment.** Free pre-trained models exist for
  single-leaf disease classification (PlantVillage-trained, Hugging
  Face) but none do the multi-category pixel-level damage segmentation
  this module actually needs; that would require a labeled Indian
  field-damage dataset (doesn't exist ready-made) and a real training
  pipeline -- realistic estimate is weeks, not a same-session task. Built
  an honest upload-and-mockup UI instead; clicking "Analyze" runs no
  model and shows zero numbers, exactly per rule 3.
- **Module 7 (Satellite Verification):** real, live Google Earth Engine
  call via the same Worker endpoint Mera Khet already uses
  (`vindhya-mera-khet.vindhyaresearch25.workers.dev/analyze`) --
  independently curl-verified this session to return genuine NDVI/
  cropland-fraction/Sentinel-1 wetness data for a real Simrol coordinate.
  In-browser testing from `localhost` correctly hit the Worker's CORS
  policy (verified via `curl -X OPTIONS` with an `Origin` header: the
  Worker only allows `https://vindhyaresearch25-a11y.github.io`, not
  localhost) -- the honest-degrade path fired exactly as designed. **Not
  fully live-verified end-to-end yet** -- needs a test from the real
  deployed origin to confirm the success path renders correctly, only the
  failure/degrade path was exercised this session.
- **Module 8 (Insurance Decision Support):** synthesizes 2/3/4/5/7's real
  outputs -- damage area and production-loss are real subtraction/
  multiplication from Module 3's yield numbers, not separately invented.
  Mandi price for Indore is honestly reported as unavailable (AGMARKNET
  upstream 429, see `dashboard/data/mandi_prices.json`'s own "note"
  field) -- economic loss shown in quintals only, no rupee figure
  invented in its place. Insurance layer (Sum Insured/Threshold Yield)
  honestly shown as "not available -- needs real PMFBY notification
  data" rather than a placeholder number. Confidence score is a real
  completeness-ratio formula (shown in the UI), not a model output.
  **Fraud detection is real rule-based code, live-tested and confirmed
  working**: two seeded demo evidence entries share a deliberately
  duplicated photo hash, and the panel correctly flagged both --
  exactly the DIKHAO #10 ask, not a hypothetical claim. Village dashboard
  is Simrol-only (132 demo parcels, 1741 ha), not district-wide, per the
  pilot's explicit scope rule. Event-to-Claim Timeline and Farmer Digital
  Record render with real timestamps/honest gap notes.

**Known gaps, stated plainly:**
- Module 7's live-success rendering path is unverified from localhost
  (CORS) -- verify once this page is actually deployed to
  vindhyaresearch25-a11y.github.io.
- Module 3's CCE record is a single synthetic entry per parcel, not a
  real D1-backed CCE database -- "naya schema (D1 me)" from the spec's
  Build Order was scoped down to client-side demo data this session;
  actual D1 deployment needs Workers-edit credentials this session
  didn't have (same limitation already documented for the Kisan Sahayak
  Worker deploy).
- Not linked into `dashboard/index.html`'s nav yet -- that file is under
  active concurrent edit by another session this same run (confirmed via
  `git diff --stat`, 38 lines added not authored by this session) --
  deliberately left alone to avoid a collision, same reasoning as
  Module 1's status note above.

---

# ZAROORI NIYAM -- sab modules par lagu, sabse pehle padho

1. **Pilot scope: sirf Simrol, Indore.** Poore desh ka architecture
   sochkar banao (hierarchy: Farmer -> Parcel -> Village -> Panchayat
   -> Block -> District -> State), lekin abhi data/build sirf ek
   gaon ke liye.
2. **Synthetic ID/naam -- saaf DEMO lebel ke saath.** ID format
   `MP-IND-BAR-000124` jaisa theek hai, lekin har jagah upar ek
   sticky banner: `⚠️ PILOT/DEMO -- Simrol, Indore | उदाहरण डेटा,
   वास्तविक अभिलेख नहीं`. Farmer naam bhi placeholder
   (`किसान-उदाहरण-1`) -- asli-lagne wala Bharatiya naam kabhi
   generate mat karo (CLAUDE.md "no synthetic data" niyam, is
   project me pehle ye galti ho chuki hai).
3. **AI/ML output kabhi bhi random/fabricated na ho.** Confidence
   score, damage %, fraud-risk flag -- in sabka koi asli (chhota hi
   sahi) calculation/heuristic hona chahiye, code me dikhna chahiye.
   Agar asli model/data abhi nahi hai to wahan **"Model abhi nahi
   bana -- conceptual mockup"** saaf likho, koi bhi number ghadO mat.
4. **Har prediction/claim ke saath disclaimer** (user ne khud likha,
   ye rakhna zaroori hai):
   `AI-based Potential Claim Estimate -- Final settlement subject to
   applicable insurance rules, authorised CCE/field verification and
   insurer/government assessment.`
5. **Feasibility pehle naapo, phir banao** (Mera Khet/GEE pattern jo
   is project me pehle se hai) -- khaaskar Module 5-8 (evidence app,
   AI image damage detection, satellite fusion, fraud detection) ke
   liye pehle bताo: kya banana mumkin hai is waqt (kitna data/compute/
   time chahiye), kya nahi -- phir scope tay karo.

---

# BUILD ORDER (aasan se mushkil, jo pehle se hai wahi pehle reuse karo)

**Phase 1 -- jo infra pehle se hai, seedhe reuse karo:**
- Module 1 (GIS Parcel) -- Simrol boundary pehle se hai (SoI)
- Module 4 (Weather Event Engine) -- ERA5-Land/CHIRPS pehle se hai
- Module 3 ka Yield history hissa -- crop_stats (DES) data pehle se
  hai zila-star par, gaon-star ke liye demo-interpolate karo (saaf
  label ke saath)
- NDVI/NDWI/EVI -- Mera Khet ke GEE Worker se pehle se milta hai

**Phase 2 -- naya banana hai, lekin seedha:**
- Module 2 (Farmer & Crop Registry) -- demo data structure
- Module 3 ka CCE database -- naya schema (D1 me), demo entries
- Crop-wise polygon split (item 4) -- Sentinel-2/Dynamic World se

**Phase 3 -- naapo pehle, phir faisla lo:**
- Module 5 (Farmer Evidence App -- photo/video/GPS/time upload)
- Module 6 (AI Image Damage Detection -- segmentation model) --
  **ye sabse bada kaam hai**, pehle bताo: koi pre-trained crop-damage
  model GEE/HuggingFace par muft milta hai ya train karna padega
- Module 7 (Satellite + Weather + Photo fusion, evidence-consistency
  score)
- Module 8 (Insurance Decision Support, fraud/anomaly detection)

**1 se shuru karo, har phase khatam hone par batao, phir aage badho.**

---

# MODULE 1 -- GIS Land Parcel

- Har khet: synthetic ID (`MP-IND-BAR-000124` format), kisan naam
  (placeholder), gaon/block/zila, lat/lon, kul bhoomi, parcel
  polygon, swamitva/sanchalan prakar, sinchai sthiti
- Simrol boundary ke andar demo-parcel polygons (grid ya random-
  shape, "भू-आकार अनुमानित" label ke saath)
- Map par polygon dikhe, click par poora Farmer Dashboard khule

---

# MODULE 2 -- Farmer & Crop Registry + Land-Use Mapping

- Parcel select karne par land-use breakdown table (Crop, Orchard,
  House, Trees/Woodland, Water, Fallow/Barren -- area + %)
- **Validation zaroori:** sabhi classified area ka yog = Parcel Area.
  Mismatch par "Data Quality Warning" dikhao (chhupao mat)
- Season (Kharif/Rabi/Zayad), crop, variety, seed type (Hybrid/
  Improved/Traditional), sowing/harvest date, irrigation
- Ek parcel me multiple crop ho to alag-alag **crop polygon** banao
  (Parcel Polygon -> Crop Polygon 1/2/3), taaki baad me crop-wise
  loss nikal sake

---

# MODULE 3 -- CCE & Yield Intelligence

- CCE record: ID, location, crop, variety, seed type, plot area,
  harvest weight, moisture, yield, date
- Historical yield (2022-2026) per crop/parcel
- **Seed/variety intelligence:** yield sirf seed-naam se tay na ho --
  Seed + CCE + Soil + Weather + Management + Historical Yield +
  Satellite indicators sabko jodkar nikalo, formula saaf dikhao
- Yield Prediction Engine: Expected Yield, Predicted Current Yield,
  Potential Yield Loss (q/ha aur %) -- calculation transparent ho,
  black-box na ho

---

# MODULE 4 -- Weather & Extreme Event Engine

- Heavy/Extreme Rainfall, Hailstorm, Flood, Waterlogging, Heatwave,
  Cold Wave, Frost, Strong Wind, Drought, Lightning -- ERA5-Land/
  CHIRPS se detect
- **Weather event aur crop damage alag layers me rakho** -- "extreme
  rainfall detect hua" ka matlab automatic "crop damaged" nahi.
  Evidence-verification (Module 10) ke baad hi damage confirm ho

---

# MODULE 5 -- Farmer Evidence App

- "Report Crop Damage" button -- photo, video, location, time submit
- System automatically parcel se match kare (GPS se)

---

# MODULE 6 -- Evidence Verification + AI Damage Assessment

### Verification (evidence status: 🟢 Consistent / 🟡 Requires
Verification / 🔴 Inconsistent)
- Location match, time match (event ke aas-paas), weather match
  (us waqt sach me extreme event hua tha?), image integrity
  (manipulated/duplicate/purani?), previous-evidence check (yahi
  photo pehle kisi aur claim me?)

### AI Image Damage Detection
- Image -> crop region -> damaged region segmentation
- Categories: leaf/stem damage, lodging, broken plants, fruit/pod/
  flower damage, waterlogging, hail injury, disease, pest
- Healthy / Mild / Moderate / Severe segmentation
- **Feasibility pehle batao** (Build Order Phase 3) -- agar abhi
  train nahi kar sakte to conceptual mockup saaf likho

---

# MODULE 7 -- Satellite & Multi-Source Verification

- NDVI, NDWI, EVI, LST -- ghatna se pehle vs baad (jaise NDVI 0.72
  -> 0.41 = "Significant vegetation-condition decline detected")
- Ye akela final proof na maano -- Module 5 photo + Module 4 weather +
  ye satellite + Module 3 CCE, **char independent evidence jodo**
- "Multi-source evidence consistency = High/Moderate/Low" score,
  calculation dikhao

---

# MODULE 8 -- Insurance Decision Support

### Damage area
Total crop area, affected area/%, severity-wise breakdown (Healthy/
Mild/Moderate/Severe area)

### Economic loss
Expected Production - Predicted Production = Production Loss;
Production Loss x Economic Value = Estimated Economic Loss
(market price aur insurance valuation **alag-alag** rakho)

### Insurance layer
Insured Crop/Area, Sum Insured, Threshold Yield, Expected/Assessed
Yield, Yield Loss, Damage Event, Evidence Score, **Potential Claim**
-- har jagah item "ZAROORI NIYAM #4" wala disclaimer

### Explainable AI
Har result ke saath "kyun" -- jaise "Estimated Yield Reduction: 34%"
+ factor-wise impact (Extreme rainfall: High, Waterlogging: Moderate,
NDVI decline: High, CCE evidence: Strong, Seed type: Positive)

### Confidence score
Yield/Damage/Evidence confidence %, + High/Moderate/Low label --
weak data par system overconfident na ho

### Fraud & Anomaly Detection
Same photo multiple claims, purani photo, galat GPS, weather
mismatch, abnormal yield/claim frequency, neighbouring-parcel
inconsistency, image manipulation -> Risk Flag (🟢/🟡/🔴)

### District-level dashboard
Aaj ki ghatna: affected districts/blocks/parcels/crop-area, map par
severity-wise color -- **Simrol pilot me ye ek-gaon-star par dikhao**,
poore-zile ka data nahi hai abhi

### Event-to-Claim Timeline
Har claim ke liye ek time-stamped timeline (event detect -> photo
upload -> GPS verify -> weather match -> AI damage -> satellite
verify -> assessment -> CCE/field verify -> final) -- adhikari ke
saamne saaf dikhe

### Farmer Digital Record
Har (demo) kisan ka saal-dar-saal profile (crop, yield, weather,
insurance/claim) -- long-term risk-profiling ke liye

---

# DIKHAO

1. Simrol boundary ke andar demo-parcel grid, ek parcel click karke
   poora Farmer Dashboard
2. Land-use breakdown table + validation warning (jaan-boojh kar
   mismatch bana kar dikhao ki warning aata hai)
3. Crop-wise alag polygon (2-3 fasal wale ek demo parcel par)
4. CCE + historical yield chart (2022-2026)
5. Hybrid vs Traditional seed ka yield-range farak
6. Ek demo weather-event + evidence-upload + verification status
   (🟢/🟡/🔴) ka poora flow
7. NDVI before/after wala satellite verification card
8. Economic loss calculation + insurance claim card (disclaimer
   text ke saath)
9. Explainable-AI factor breakdown + confidence score
10. Fraud-risk flag ka ek example
11. District/village dashboard (Simrol-star par)
12. Event-to-Claim timeline, poora
13. Sticky DEMO banner + `DEMO-`/`किसान-उदाहरण-N` naming -- confirm
    koi bhi asli-lagne wala data nahi bana

Har item ke saamne HUA / NAHI KIYA / kyun nahi, aur jahan "abhi mumkin
nahi" ho wahan **kyun nahi aur kitna kaam/time chahiye** likho.
