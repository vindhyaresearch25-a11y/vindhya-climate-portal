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

# 1. VECTORIZE THEEK KARO (sabse pehle) -- **JAANCHA, THEEK KIYA, DEPLOY BAAKI**

- **Binding confirm:** `wrangler vectorize get` se index confirm hua --
  727 vectors, live. Par `wrangler_kisan_sahayak.toml` me `[[vectorize]]`
  block COMMENTED OUT hi reh gaya tha pehle deploy ke baad -- yahi asli
  root cause tha. **NAHI KIYA tha, ab THEEK KIYA** (uncommented).
  **Deploy abhi BAAKI** -- is session ke `CLOUDFLARE_API_TOKEN` me sirf
  Vectorize-read scope hai, Workers-edit nahi. Aapko khud
  `cd cloudflare && wrangler deploy --config wrangler_kisan_sahayak.toml`
  chalana hoga (ya token ko Workers Scripts:Edit permission do).
- **Log/score dikhaya** -- direct Vectorize query se (Worker bypass
  karke) dono sawal test kiye, full table docs/KISAN_SAHAYAK_RAG.md me.
- **Embedding model match confirm** -- `@cf/baai/bge-base-en-v1.5` dono
  taraf same, verified.
- **Do sawal dobara test:** dono me pehle koi citation nahi aaya --
  do ALAG bug mile aur theek kiye:
  1. `looksLikeManualQuestion()` keyword list me "DSR"/"kheti"/"ratua"
     jaise shabd hi nahi the -- search_manuals kabhi try hi nahi hua.
     **THEEK KIYA** (keyword list badhaya).
  2. Hinglish query (Roman-script Hindi) embedding model (English-only)
     se theek match nahi karta -- English phrasing se turant sahi
     document mila (score 0.80 CRRI DSR bulletin, 0.74 wheat rust
     fungicide passage) par Hinglish se galat/garbled result. **THEEK
     KIYA** (query ko English me translate karke embed karo, m2m100
     model se) -- **par translation step khud live-test NAHI ho paya**
     (Workers AI free-tier rate limit beech me lag gaya). Deploy ke
     baad ek baar dono sawal phir se chalakar confirm karna.
  3. Ek doc (`ICAR Kharif Agro-Advisories 2025`) ka kuch hissa
     garbled Devanagari nikla (legacy font, Kruti-Dev-class problem) --
     **abhi tak fix NAHI kiya**, sirf documented hai
     (docs/KISAN_SAHAYAK_RAG.md), kyunki English query se wo garbled
     hissa top-5 me nahi aaya (fauri khatra kam), par index me pada hai.

**Jab tak deploy nahi hota, upar ka koi bhi fix live nahi hai.**

---

# 2. JAWAB KA DHANCHA -- **THEEK KIYA (code me), deploy ke saath saath live hoga**

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

# 4. GROUNDWATER -- **PEHLE SE HO CHUKA (2026-08-09, d62e579), is list ki galti thi**

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
  **NAHI HUA** -- iske liye live per-polygon GEE query chahiye, jo browser
  se seedhe nahi ho sakta, backend chahiye. `cloudflare/mera_khet_worker.js`
  likha gaya (real GEE service-account OAuth2 flow) par `GEE_BACKEND_URL`
  configure/deploy nahi hua is session me -- panel honest "not yet wired
  up" dikhata hai, koi jhoothi number nahi.
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

# 12. CORPUS BADAO (Vectorize theek hone ke BAAD)

Abhi sirf 6 document. Sabhi fasal chahiye.

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

# 13. ADVISORY PARAT -- 0

Climate + NDVI + crop se vyutpann, chaaron star par.
Ye 3 aur 5 ke baad.

---

# 14. KISAN UPLOAD (ground truth) -- 0

Cloudflare D1 (free) -> GitHub Action -> HF, CC-BY.
Naam/phone/Aadhaar **mat maango**. Anumati ka checkbox.
Sarvajanik me nirdeshank 3 dashamlav tak gol (~100 m).

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
