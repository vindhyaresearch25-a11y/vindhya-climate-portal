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

# 3. NDVI -- 8 / 733 (sabse peeche)

- Raftaar batao: ek zile me kitna samay, poore desh me kitna
- MODIS (250 m, 2000 se) ya Sentinel-2 (10 m, 2017 se) -- kaunsa
- Chaaron star par aggregate, har ek ke saath kitne unit + SD
- Chalao

---

# 4. GROUNDWATER -- 0

**Ye sabse zyada value wala hai.**
Humare paas har gaon ka `irrigated_wells_tubewells_ha` PEHLE SE hai.
CGWB ka bhujal star usse jodo -> pata chalega kaunsa gaon khatre me.

- PEHLE jaancho: India-WRIS ka public API/download hai ya nahi
- Hai to script, nahi to panel me:
  *"No public API. Source: CGWB India-WRIS. Institutional data
  request required."*
- **Scrape mat karo**

---

# 5. SOIL MOISTURE -- 23 se aage

- SMAP (GEE, muft), chaaron star par
- **Resolution 9 km har jagah likho** -- gaon-star par bhi wahi
  9 km ka maan hoga, gaon ka apna nahi
- Har aggregate: kitne pixel + SD

---

# 6. IMD -- pehle NAAPO, phir faisla

Abhi 726 zile ERA5-Land+CHIRPS se hain, sirf 5 IMD se.
IMD ka kachcha NetCDF is machine par nahi hai (2 Aug ko jaancha gaya).

Jaancho aur batao:
1. `imdlib` chalta hai? (`pip install imdlib`, phir
   `imd.get_data('tmax', 2020, 2020, fn_format='yearwise')`)
   Error aaye to poora message. Chale to: ek saal ka size, samay.
2. Na chale to imdpune.gov.in se manual download ka rasta
3. IMD ka asli resolution -- rain aur temp dono ka. **Agar temp
   1 degree (~111 km) ka hai to wo ERA5-Land (11 km) se MOTA hai** --
   us surat me IMD har jagah behtar NAHI hoga
4. Colab me chalana behtar ya yahin
   (`notebooks/vindhya_national_climate.ipynb` pehle se hai)

**In chaar jawab ke baad tay hoga:** IMD sab jagah lagayein, ya
sirf validation ke liye rakhein.
Jo bhi ho, ERA5/CHIRPS aur IMD **ALAG** rahenge -- kabhi mila kar nahi.

---

# 7. VALIDATION -- 5 / 733

CHIRPS aur ERA5-Land ko IMD ki jaanch ke liye, badle me nahi.
Har zile: dono ka maan, correlation, bias, RMSE.
`data/validation/<state>/<district>.json`, alag panel.

Sahitya kehta hai bias jagah ke hisaab se badalta hai (Paschimi
Ghat par zyada, andaruni bhaag me kam) -- isliye ye zaroori hai,
research paper ke liye bhi.

---

# 8. PANEL KI SAFAI

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

# 9. UI ka bacha kaam

- `data-target` 2 jagah -- count-up animation hatao
- Inline `style=""` 69 -- CSS variables me
- Landing background -- do slide (kisan khet me, precision farming),
  photo saaf, licence saaf (PIB/ICAR/Unsplash/apni). Google se
  uthai photo KABHI nahi.

---

# 10. MERA KHET (naya feature)

`MERA_KHET_PROMPT.md` me poora likha hai. Sankshep me:

- `geoai_professional.js` dobara istemal karo, naya mat likho
- Kisan polygon khinche -> kheti wala hissa alag dikhe
  (Dynamic World / Sentinel-2, 10 m)
- Mausam/nami zile ka -- **label lagao ki khet ka nahi**
- Sabse upyogi: *"aapke khet ka NDVI 0.62, gaon ka aurat 0.55"*
- Ground truth: *"is khet me kaunsi fasal hai?"* -> D1 -> HF

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
