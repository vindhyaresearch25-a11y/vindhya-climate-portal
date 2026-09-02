# VINDHYA -- JO BAAKI HAI (2026-08-10)

Kram se karo, upar se neeche. Har item ke saamne:
**HUA / NAHI KIYA / kyun nahi**

---

## HO CHUKA -- dobara mat karo

| | |
|---|---|
| Climate | **731 / 733** zile (5 IMD + 726 GEE), sab 36 rajya |
| Crop statistics | 747 zile, 2000-2023, 3.7 lakh record |
| Boundaries | 6,54,285 gaon, chaaron star, HF par |
| Village profiles | 6,49,719 gaon |
| Soil moisture | 23 (shuru) |
| Horticulture | 28 |
| Mandi prices | 733, roz |
| Kisan Sahayak | Worker + 70B + citation filter (§7.1) |
| Manual corpus | 727 chunk, 6 document |
| Storage | 802 MB -> 51 MB, Hugging Face |
| Security | pre-commit hook + CI + push protection |
| UI | emoji 0, AI branding 0, basemap, compare, PNG export |

---

# 1. VECTORIZE THEEK KARO -- **POORA HUA, LIVE VERIFIED**

Aapne deploy kar diya (`VECTORIZE_INDEX` + `AI` binding dono live).
**Dono benchmark sawal live production endpoint par dobara test kiye,
ab real citation aata hai:**
- "gehun me peela ratua kaise roken" -> Source: Package of Practices for
  Crops of Punjab -- Rabi 2025-26, p.84-86, 2025 (+ 4 aur)
- "DSR ki kheti kaise karein" -> Source: ICAR Kharif Agro-Advisories for
  Farmers 2025, p.5-6, 2025 (+ 4 aur)

Teeno bug fix confirm live: keyword list badhaya, Hinglish->English
translation (m2m100) kaam kar raha hai, corpus bhi expand kiya (item 12
dekho). ICAR doc ka garbled Devanagari hissa abhi bhi index me hai par
retrieval me nahi aa raha (documented gap, docs/KISAN_SAHAYAK_RAG.md).

---

# 2. JAWAB KA DHANCHA -- **HUA, LIVE**

- Char-hisse ka saancha ab sirf rog/keet-diagnosis sawal par hai;
  general practice sawal (jaise DSR sowing) ke liye alag, free-form
  instruction di gayi system prompt me. **HUA.**
- Jagah wali line -- ab prompt kehta hai "sirf tab likho jab sawal
  jagah ka ho ya usse fayda ho", forced nahi. **HUA** (prompt-level;
  model 100% follow karega ye guarantee nahi, jaisa citation policy
  ke liye bhi teen-parat approach hai -- yahan abhi ek hi parat hai).
- Number garble (`.21 mm`) -- do parat: (a) prompt me explicit
  instruction leading-zero rakhne ko, (b) code-level regex safety net
  (`fixNumberGarbling()`) jo streamed text me `.NN` ko `0.NN` me fix
  karta hai chahe model bhool jaye. **HUA**, par abhi bhi model hi
  number likhta hai (full §7.1-style code-injection -- placeholder
  token har number ke liye -- nahi kiya, bada refactor hai).

---

# 3. NDVI -- 8 / 733 (sabse peeche) -- **CHALU HAI (background watchdog)**

- **Raftaar:** naapa live (Sikkim benchmark) -- cold-start district ~5.7
  min (GEE compute warm-up), phir steady-state ~40-45s/zila, kabhi-kabhi
  GEE 90s timeout par retry (auto-resume se safe). Poore desh (733 zile)
  ka anuman ~8-12 ghante continuous run, exact nahi bata sakte (GEE load
  variable hai).
- **MODIS chuna** (250 m, 2000-2024) -- already scripts/10_gee_national_ndvi.py
  me decided tha (Sentinel-2 sirf 2015 se, zyada compute), naya faisla
  nahi liya, existing decision confirm ki.
- Chaaron star aggregate + SD -- pehle se code me hai
  (`10_gee_national_ndvi.py`'s reduceRegion pixel-count+stdDev).
- **Chalao** -- watchdog launch kiya (`run_gee_national_watchdog.py
  --script 10_gee_national_ndvi.py`), generalized watchdog script taaki
  wahi 08's crash-resume logic NDVI/soil-moisture dono ke liye reuse ho.
  Chal raha hai is waqt.

---

# 4. GROUNDWATER -- **RESOLVED 2026-08-19 -- asli CGWB source mil gaya**

Ye PENDING.md khud d62e579 ke EK DIN BAAD likha gaya tha bina asli repo
state check kiye -- "0" likhna galat tha. Agent se dobara verify karaya
(2026-08-12): `dashboard/index.html` + `mp_climate_loader.js` me pehle se
real `irrigated_wells_tubewells_ha` (SoI village profiles se, live-summed,
village-count ke saath) + honest gap message "No public API. Source: CGWB
India-WRIS. Institutional data request required." dono maujood hain.
Independently curl/WebFetch se re-confirm kiya: indiawris.gov.in Angular
shell hai (koi JSON API nahi), gwdata.cgwb.gov.in maintenance mode me tha
(form-driven tool hai, API nahi, scrape nahi kiya), cgwb.gov.in sirf PDF
report deta hai, data.gov.in par CGWB groundwater-level resource_id nahi
mila. `docs/REQUIREMENTS_ROADMAP.md` me missing status-row bhi add kar
diya (d62e579 ne DATA_SOURCES.md update kiya tha par ROADMAP.md nahi).

**UPDATE 2026-08-19:** upar ki 4 check (india-wris, gwdata.cgwb, cgwb.gov.in
PDF, data.gov.in) sab sahi the, par ek real source miss ho gaya tha --
**nwdp.nwic.gov.in** (National Water Data Portal), yehi portal jo village
boundary ke liye pehle se trusted hai (standing order #3). Iska dataset
"Ground Water Level (Manual - Quarterly), CGWB" 95 CSV files deta hai, no
login, no API key -- direct curl se mil gaya. Har row ka apna `District LGD
Code` hai, jo is project ke apne `district_lgd` (districts_index.json) se
match karta hai -- naam-matching ki zaroorat hi nahi, AGMARKNET wali
spelling-mismatch problem yahan hai hi nahi.

Built: `scripts/16_fetch_groundwater.py`, `dashboard/groundwater_loader.js`,
naya bottom-panel tab + Climate Metrics card + `agri-gw-level` field sab
real data se update hote hain jahan coverage hai. Pehla national fetch run
(2026-08-19): 33/36 states/UTs covered (Mizoram, Sikkim, Ladakh NWDP par
bilkul nahi hain, confirmed absent, honest gap wahi rahega), 0 fetch
failures, 1,393,429 real CSV rows, **626/733 districts real station data
ke saath, 94 aur districts honest zero-station record ke saath (state
covered hai par us district me monitoring station nahi)**, 36,360 stations
total. Exact/live numbers `dashboard/data/groundwater/manifest.json` me
hain (regenerated by the pipeline, yahan hardcode nahi kiya). Docs update:
`docs/DATA_SOURCES.md` aur `docs/REQUIREMENTS_ROADMAP.md` dono me full
detail add kiya, purani history delete nahi ki.

---

# 5. SOIL MOISTURE -- **HUA -- 733/733 zile POORA, sab 36 rajya/UT**

Watchdog run khud khatam hua (do laagatar khali pass = kuch bacha nahi).
9 km resolution har file me, pixel count + SD METHODOLOGY §8.2 ke mutabik.
Pushed.

---

# 6. IMD -- NAAPA, faisla ke liye jawab mil gaye

1. **`imdlib` CHALTA HAI** -- `pip install imdlib` seedhe kaam kiya, is
   machine par. `imd.get_data('tmax', 2020, 2020, fn_format='yearwise')`
   **1.8 second me SUCCESS**, 1.3 MB (ek saal, ek variable). Rain bhi
   turant chala. Poore 2000-2024 x 3 variable (tmax/tmin/rain) ~75
   download, chand minute me poora ho jayega -- Colab ki zaroorat nahi,
   yahin ho sakta hai.
2. (upar se moot ho gaya -- imdlib seedhe chal gaya)
3. **ASLI RESOLUTION NAAPA, aur ye zaroori nikla:**
   - **Temp (tmax/tmin): 1.0° x 1.0° (~111 km)** -- confirm kiya xarray
     grid se (`lat spacing: 1.0`, `lon spacing: 1.0`)
   - **Rain: 0.25° x 0.25° (~28 km)**
   - **Ye ERA5-Land (~9-11 km) se KAAFI MOTA hai temperature ke liye**
     (111 km vs 11 km, ~10x) -- exactly jo ashanka thi, sach nikli.
   - **IMPORTANT MISMATCH mila:** `docs/METHODOLOGY.md` aur
     `docs/DATA_SOURCES.md` dono kehte hain 5 MP zilon wali IMD data
     "0.05° (~5.5 km)" hai -- par imdlib (IMD Pune ki apni public
     distribution) se seedhe naapa temp resolution 1° hai, 20x mota.
     Ho sakta hai un 5 zilon ki ORIGINAL raw NetCDF file (jo is machine
     par abhi nahi hai) sach me alag/finer product ho -- verify nahi ho
     saka bina un files ke. **RUKA, chupchap docs badla nahi** (Phase
     10 ka niyam) -- ye aapko batana zaroori tha, khud faisla lo.
4. Colab ki zaroorat nahi -- yahin chal gaya.

**Faisla (upar ki naap se seedha nikalta hai):** IMD ko poore desh me
nationalize NAHI karna chahiye -- 111 km grid ERA5-Land ke 11 km se kaafi
peeche hai. IMD sirf jahan already hai (5 MP zile) wahi rahe, validation
ke liye istemal ho (item 7), poore desh ke liye ERA5-Land/CHIRPS hi sahi
faisla bana rahega. **Aapki confirmation chahiye is faisle par**, aur
0.05°-vs-1° mismatch wali baat par bhi.

---

# 7. VALIDATION -- 5 / 733

CHIRPS aur ERA5-Land ko IMD ki jaanch ke liye, badle me nahi.
Har zile: dono ka maan, correlation, bias, RMSE.
`data/validation/<state>/<district>.json`, alag panel.

Sahitya kehta hai bias jagah ke hisaab se badalta hai (Paschimi
Ghat par zyada, andaruni bhaag me kam) -- isliye ye zaroori hai,
research paper ke liye bhi.

---

# 8. PANEL KI SAFAI -- **zyadatar pehle se HUA, baaki agent me chalu**

Verify kiya (2026-08-12): Satellite Viewer/Panchayat/Biodiversity Risk
hatana + `docs/REQUIREMENTS_ROADMAP.md` me reason likhna **pehle se HO
CHUKA** tha (2026-08-09 ki commit). Forest Monitor "SOON" badge aur PMFBY
honest-empty-state bhi pehle se sahi hain. **Diu/Lakshadweep ka "grid cell
se chhota hai" message -- ab THEEK KIYA** (pehle generic "Not available"
tha, ab specific reason). Ek background agent panel-cleanup final-verify
+ inline-style cleanup (item 9) dono kar raha hai, worktree me isolated.

**Hatao (teen):**
- Satellite Viewer -- basemap switcher yahi kaam kar raha hai
- Panchayat Dashboard -- koi asli data source nahi
- Biodiversity Risk -- koi bharosemand srot nahi

Hatane se pehle jaancho ki inka code/data kahin aur istemal to nahi.
`docs/REQUIREMENTS_ROADMAP.md` me likho kya hataya aur **kyun**.

**"Coming soon" label ke saath rakho (do):**
- Forest Monitor (Hansen/GFC, GEE me muft)
- PMFBY (zila-star ka premium/claim aankda mile to dikhao)

**Diu aur Lakshadweep** -- panel me likho *"grid cell se chhote hain,
isliye aankda nahi"*. Khali mat chhodo.

---

# 9. UI ka bacha kaam -- **data-target HUA, style/landing agent me chalu**

- `data-target` -- **verify kiya, 0 live occurrence hai** (sirf 2
  explanatory comment bache jo removal explain karte hain -- galat
  count tha, asli kaam pehle hi ho chuka tha).
- Inline `style=""` 69 index.html me -- **HUA.** 67/69 ko 65 CSS utility
  class me convert kiya (agent), 2 jaanbujh kar chhode (ek functional
  dependency -- `#app` ka display:none JS launch-detection me use hota
  hai, class me move karne se behavior badal jata; ek genuinely dynamic
  per-item legend color). Merged, pushed, pytest 8/8, live render
  pixel-identical verify kiya (agent ne browser me check kiya).
- **IMPORTANT naya gap mila jo list me nahi tha:** index.html ke bahar,
  10 naye loader `.js` file (Compare, Soil Moisture, Live Weather,
  Mandi, Crop Stats, GeoAI, etc. -- Phase 2.2 ke BAAD bane) collectively
  ~390 aur inline style le aaye hain jo kabhi CSS-variable system me
  convert nahi hue. Ye is turn ke agent ke scope se BAHAR hai (bada
  alag kaam), sirf record kar raha hoon taaki bhoole nahi.
- Landing background -- verify kiya, **pehle se HO CHUKA** (2 licensed
  Unsplash slide, 8s fade, credit line -- 2026-08-07 ki commit ne khud
  confirm kiya tha).

---

# 10. MERA KHET (naya feature) -- **HUA (mostly), ek real gap baaki**

`dashboard/mera_khet.js` (804 lines) live hai, sidebar me nav item,
Cadastral panel se link ("Apna khet khud khinchiye"). `geoai_professional.js`
ka area/perimeter code reuse kiya, naya nahi likha.

- Polygon draw -> area/perimeter: **HUA**
- Kheti wala hissa (cropland fraction, Dynamic World/Sentinel-2 10m):
  **AB HUA (2026-09 update)** -- `GEE_BACKEND_URL` since configured/deployed
  (vindhya-mera-khet.vindhyaresearch25.workers.dev/analyze verified live,
  real ndvi + cropland_fraction + field_wetness_index_relative returned).
  Owner report investigated this session: on `http://localhost:8010` (a
  non-whitelisted local port) the browser blocked the request with a CORS
  preflight failure, which LOOKED identical to "backend not deployed" in
  the panel (both show the same honest not-available message, by design --
  never a fake number either way) -- confirmed via curl that the worker
  itself, and the request from an ALLOWED_ORIGINS entry
  (`http://localhost:8000`, and the real production
  `https://vindhyaresearch25-a11y.github.io`), both work end-to-end. Not a
  code bug; this note was simply stale. If a genuine CORS gap is ever found
  against the real production origin, add it to
  `cloudflare/mera_khet_worker.js`'s `ALLOWED_ORIGINS` set (line ~107).
- Mausam/nami -- **HUA**, district-tier (soil_moisture/climate files se),
  "yah aapke khet ka apna maap nahi" label ke saath, jaisa maanga tha
- Ground truth (fasal poochna) -- **HUA**, existing D1 pipeline reuse
  kiya (naya pipeline nahi banaya), geometry column add kiya
- Download: GeoJSON/KML/SHP (single-polygon) -- **HUA**. GeoTIFF -- nahi
  (jaisa A3 benchmark ne pehle hi bataya tha, storage quota issue)

**Pehle naapo:** 2-ha polygon par Dynamic World me kitna samay,
Sentinel-2 NDVI kitni jaldi, EECU kitna.

---

# 11. DOWNLOAD -- paanch format

Do jagah: Location Selector (koi bhi star) aur Mera Khet ka polygon.

| Format | Kitni der |
|---|---|
| SHP (zip, EPSG:4326 + .prj) | turant |
| GeoJSON | turant |
| KML | turant |
| PNG | turant |
| GeoTIFF (GEE async) | **minute lagenge** |

- `shp-write` browser me
- Har zip me `readme.txt`: source, CRS, resolution, *"Indicative,
  not for legal or cadastral use"*
- GeoTIFF: turant ka jhootha vaada mat karo. Rate limit 5/din/IP,
  cache, zila-star ka mat do

---

# 12. CORPUS BADAO -- **PEHLA ROUND HUA (8 mukhya fasal), ab SABHI fasal ke liye agent chalu**

Pehla round: 6 -> 13 document, 727 -> 926 vector, live verify kiya (item 1
me detail). 2 real bug mile+theek kiye (socket.timeout crash, 5x-character
duplication jo original corpus me pehle se chhupa hua tha). 1984 wala
gehun manual hataya (banned pesticide the usme).

**Ab poore CROP_LIST.json ke 59 fasal ke liye** ("sabhi jitne bhi crop
hain un sabka cultivation crop wise dalo") -- agla agent chalu kiya,
same niyam (2015-2025, sirf muft/khula srot, license check, ResearchGate/
Sci-Hub kabhi nahi).

**Fasal:** anaj, dalhan, tilhan, nakadi, sabzi, phal, masale, chara
**Har fasal ke liye:** kism, bijai, beej dar, khad, sinchai,
**keet**, **rog**, khar-patwar, katai

**Srot -- sirf muft aur khula, 2015-2025:**
ICAR institute bulletin, Krishi Vishwavidyalaya ke POP, KVK salah,
rajya krishi/udyaniki vibhag manual, IMD agromet, OpenAlex, CORE,
DOAJ, PMC, FAO AGRIS, ICAR KRISHI

**ResearchGate se MAT lo** -- zyadatar paper bina anumati chadhe hain.
Sci-Hub bhi nahi. Sirf publisher ka open-access PDF ya .gov.in/.ac.in

**Niyam:**
- Saal 2015-2025. Abhi corpus me **1984 ka gehun manual** hai --
  41 saal purana, usme kai keetnashak ab pratibandhit honge.
  Uspar chetavani lagao ya hatao.
- Licence dekho -- bikta hai to mat lo, suchi me likho kyun chhoda
- Hindi aur English dono
- Har chunk: naam, link, saal, prakashak, fasal

**Kram:** pehle 8 mukhya fasal (gehun, dhan, soyabean, chana, sarson,
kapas, makka, aloo), keet-rog par zor. Phir baaki.

**Naapo:** Vectorize ke muft tier me kitne vector, hum kitne bhar
denge. Seemaa paas aaye to RUKO.

---

# 13. ADVISORY PARAT -- **DISTRICT TIER BANA, block/village/state baaki**

`scripts/15_build_advisory.py` + `dashboard/advisory_loader.js`
(2026-08-12): climate (heatwave_risk, drought_risk) + NDVI jahaan hai
(vegetation_stress) + soil moisture jahaan hai (irrigation_need) se 4
rule-based flags, per district (731/733 -- climate hi mandatory minimum
hai). AI/ML model NAHI hai, koi confidence % nahi -- har flag apne asli
number ko cite karta hai (`docs/METHODOLOGY.md` Sec 9).

State tier client-side ban gaya (per-flag-level count distribution, mean
nahi -- categorical data ka mean nahi hota). Block/village tier abhi
DOCUMENTED NEXT STEP hai, jaldi mein shaky nahi banaya -- climate/NDVI
pipeline ke paas khud koi sub-district output hi nahi hai abhi (soil
moisture ke paas hai, baaki ke paas nahi), METHODOLOGY.md Sec 9's "Tier
scope" note dekho.

NDVI coverage abhi kam hai (58/731 vegetation_stress -- background GEE run
chal raha hai, jaise-jaise woh badhega, ye script phir se chalane par
apne-aap badh jayega, kuch alag se karne ki zaroorat nahi).

---

# 14. KISAN UPLOAD (ground truth) -- **pehle se BANA hai, sirf deploy baaki**

`cloudflare/kisan_upload_worker.js` + `wrangler_kisan_upload.toml` +
`dashboard/kisan_upload.html` (188 lines, form) + D1 schema + daily
export script -- sab bane hue hain. Naam/phone/Aadhaar nahi maangte,
anumati checkbox hai, 3-dashamlav rounding hai. **NAHI HUA sirf:
deploy** (`database_id` abhi placeholder hai) -- yahi teesra item hai jo
aapke apne Cloudflare login se hona hai, Vectorize aur Mera Khet GEE
backend ki tarah.

**Aapko teen deploy karne hain (sab `cd cloudflare` se):**
1. `wrangler deploy --config wrangler_kisan_sahayak.toml` (item 1 --
   Kisan Sahayak citations)
2. `wrangler d1 create vindhya-ground-truth` + schema + `wrangler deploy
   --config wrangler_kisan_upload.toml` (ye item -- ground truth upload)
3. Mera Khet ka GEE backend (`GEE_BACKEND_URL` set karna, item 10 me
   detail hai) -- ye teesra thoda bada hai, baad me bhi ho sakta hai

---

# 15. METHODOLOGY AUDIT (2026-09-02) -- HUA, aur jo naya mila

Owner ka kehna: "sab data/mean value validated hon, scientific statistical
analysis ho, actual values dikhein, Data Sources update karo, jo ruka hai
poora karo."

## Jo VERIFY hua (code doc se milta hai, kuch nahi badla)

- IMD heatwave criteria, McKee SPI (zero-inflated gamma, q/2 convention),
  ETCCDI fixed 2000-2014 base -- `02_compute_indices.py` doc ke mutabik hai
- `classify_risk()` ordinal sum METHODOLOGY Sec 6 se bilkul milta hai, aur
  poore repo me sirf EK jagah hai (client-side duplicate nahi hai)
- `08_gee_national_climate.py` sach me `02_compute_indices.py` ke asli
  function importlib se import karta hai (METHODOLOGY Sec 7 #9 ka apna daava)
- `forecast_2040.json` asli OLS + residual-derived 95% band hai, INDICATIVE
  label ke saath
- CGWB groundwater trend asli OLS slope hai (>=4 point, +/-0.02 m/yr dead
  band) -- ab threshold tooltip me bhi likha hai
- DES crop stats, mandi table, horticulture -- koi chhupa hua "enhancement"
  nahi mila (mandi CHART ka ek issue tha, neeche dekho)

## Jo THEEK kiya (5 fabrication + 2 statistical defect)

1. `MP_DISTRICTS` me hardcoded risk/drought/heat/ndvi literal -- asli
   computed value se match hi nahi karte the (risk "low" vs likha
   "moderate"/"extreme"). Hataya.
2. SPI se NDVI banane wala invented formula (`spi_12*0.1+0.45`). Hataya.
3. Chat ka `rain=1100, heat=38` fallback jo "(IMD-derived)" likh ke dikhta
   tha. Ab null, aur honest gap message.
4. `GW STRESS 62%` -- invented coefficients (droughtPct*1.1 +10 -15). Ab
   asli CGWB trend par bhejta hai. RECHARGE bhi vaise hi hataya.
5. Pilot ka `ai_confidence_pct = rng.uniform(86,95)` -- pura random tha aur
   ek decision rule bhi chala raha tha. Ab teen real weighted term.
6. CMIP6 ka `max_summer_tmax`/`rx1day_mm` window-maximum the, aur window
   alag lambai ke hain (10 saal future vs 15 saal baseline) -- delta me
   systematic bias tha (Bhopal delta_rx1day -189.9mm!). Ab per-year maxima
   ka mean.
7. CMIP6 ka "HEATWAVE DAYS/YR" asal me Tmax>=40 ka hot-day count tha, aur
   observed IMD heatwave index ke bilkul bagal me wahi label leke baitha
   tha (0.4 vs ~38). Ab `hot_days_tmax_ge40_per_yr` + "HOT DAYS/YR".

## CMIP6 -- ab EK method, poore desh ke liye

05b (centroid ke aas-paas 5km buffer, 5 MP zile) aur 09 (asli SoI district
polygon, 733 zile) dono ek hi panel bhar rahe the. Dono ke number paas-paas
hain (hot days 0.5-3.6 d/yr, peak Tmax 0.3C ke andar), to ye sudhaar hai,
virodh nahi. **Polygon wala (09) ab authoritative hai sabhi 733 ke liye**,
un 5 MP zilon ke liye bhi. `future_2040` mp_climate_data.json me
`superseded_by` flag ke saath raha, delete nahi kiya.

## CI ka bada gap band kiya

metadata check `dashboard/data/*.json` par tha -- NON-recursive. 5,200 me se
sirf 10 file dekhta tha, aur sirf key ki maujoodgi (khali `{}` bhi pass ho
jata tha). Ab recursive, paanchon key check karta hai, aur
`dashboard/data/**` par trigger bhi hota hai.
`scripts/backfill_data_metadata.py` ne sabhi 5,200 file compliant kar di --
zyadatar sirf alias tha (crs/method/generator pehle se maujood the).

---

# 16. FERTILIZER CARD (AUDIT_FIX_PROMPT item 10b) -- **HUA, LIVE VERIFIED**

Pichhle audit agent ne chhod diya tha ("needs an ICAR dose corpus").
Ab bana. Corpus ki samasya ka hal: **source se, banake nahi.**

- Dose: `dashboard/data/fertilizer_doses.json` (12 fasal, 22 row) --
  "Crop Production Guide - Agriculture 2020" (Directorate of Agriculture,
  Chennai + TNAU) se page-by-page utara gaya, asli 460-page PDF fetch karke.
  Har row par **asli printed page number** hai.
- Mausam: hardcode NAHI. Us zile ke apne DES record se (`season` field),
  latest reported year. Summer -> Zayad, "Whole Year" ka apna block.
- Kshetrafal: Mera Khet ka asli naapa hua area (`window._meraKhetLastField`).
  Naapa nahi to sirf per-hectare -- maan liya gaya khet size invented number
  hota.
- Jis fasal ka cited dose nahi mila: naam leke "Dose not available for: ..."
  likha jata hai. Doosri fasal se udhaar NAHI.

Live verify (Indore, DES 2022-23): Kharif me Soybean 2,44,719 ha 20:40:20
(p.175), Maize 135:62.5:50 aur hybrid 250:75:75 (p.105); Rabi me Wheat
2,09,917 ha 80:40:40 (p.123); Zayad me Groundnut. Area scaling: 20:40:20 x
1.25 ha = 25:50:25 (arithmetic check pass).

**IMANDAARI ki baat jo card khud likhta hai:** ye TAMIL NADU ke liye jaari
blanket dose hain, national ICAR figure nahi -- doosre rajya ke apne POP
alag hain; aur blanket dose sirf tab hai jab soil test na ho, soil test
hamesha upar hai.

**Agla kadam (nahi kiya, jaanbujh kar):** MP/Punjab/Rajasthan ke apne POP
se aur crop add karna. Har naya row usi tarah page-cited hona chahiye --
yaad se likha number is file me KABHI mat daalo.

---

# 17. JO ABHI BHI BAAKI HAI (record kiya, kiya nahi)

1. **Village Report sirf English me hai.** `village_report.js` me `t()` aur
   `isHindi()` define hain par kabhi call nahi hote -- ~20 section, saare
   "Data not available" message, table header sab English. Baaki har loader
   bilingual hai. Alag se kaam hai, chhota nahi.
2. **~390 inline style** un 10 naye loader .js file me jo Phase 2.2 ke baad
   bane (item 9 me pehle se likha tha, abhi bhi khula).
3. **Compare ka mobile card `cell.note` gira deta hai** -- desktop par
   village-count hover me aata hai, mobile par kisi bhi raaste se nahi
   dikhta. Aggregate ka N mobile par gayab.
4. **NDVI coverage** aur **soil moisture/advisory** ka rishta -- NDVI badhne
   par `15_build_advisory.py` dobara chalana hai (item 13 me likha hai).
5. **IMD resolution mismatch (item 6 upar)** -- abhi bhi aapke faisle ka
   intezaar. METHODOLOGY/DATA_SOURCES "0.05 deg (~5.5 km)" kehte hain, par
   imdlib se naapa temp grid 1 deg nikla. Chupchap NAHI badla.

---

# NIYAM -- sab par

- Koi banaya hua aankda nahi
- Number code se, model se nahi
- Citation retrieved document se, model se nahi
- Observed / projected / validation -- teeno ALAG
- Jahan data nahi: *"uplabdh nahi"* + kyun
- Git history KABHI rewrite mat karo
- Sarkari dashboard scrape mat karo
- Har phase ke baad commit + push

---

# KRAM

1. **Vectorize theek karo** (1, 2)
2. **NDVI chalao** (3)
3. **Groundwater jaancho** (4)
4. Soil moisture aage badhao (5)
5. IMD naapo (6), validation (7)
6. Panel safai (8), UI (9)
7. Mera Khet (10), download (11)
8. Corpus (12), advisory (13), upload (14)

**1 se shuru karo.**
