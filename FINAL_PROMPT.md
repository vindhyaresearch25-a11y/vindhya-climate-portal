# VINDHYA -- MASTER PLAN (2026-08-06)

Poore desh ka, teenon parat, chaaron star par:
**Climate Risk + Satellite NDVI + Agricultural Advisory**
36 States/UTs · 733 Districts · 6,312 Blocks/Tehsils · 6,54,285 Villages

Kram se karo, upar se neeche. Beech me mat poochho -- sirf asli gadbad
par ruko. Har item ke saamne likho: **HUA / NAHI KIYA / kyun nahi**

**Sab tum karo.** Main sirf wahi karunga jo tum nahi kar sakte (browser
me click, key revoke) -- aur uske liye ek-ek click alag batana.

---

## AAJ KI ASLI STHITI (naapi hui, anuman nahi)

| | |
|---|---|
| Project shuru | 1 Aug 2026, 63 commit, 6 din |
| Boundaries | 36 rajya, 733 zile, 6,312 block, 6,54,285 gaon -- **POORA** |
| Village profiles | 6,49,719 gaon, 46 column -- **POORA** |
| Climate indices | **196 / 733 zile** (27%) |
| Mandi prices | 733 zile, roz apne aap |
| Crop statistics | 733 zile, mahine me |
| Repo data | **802 MB / 1 GB** -- 80% bhar chuka |
| Chatbot | Cloudflare Worker chalu, Workers AI (Llama 3.2 3B) |
| Storage | Hugging Face verify ho chuka -- CORS aur Range dono |

---

# PHASE 1 -- STORAGE (turant, warna baaki ruk jayega)

Repo 802 MB par hai, seemaa 1 GB. Village-level computation ka nateeja
rakhne ki jagah nahi bachegi. Isliye yahi pehle.

**Hugging Face taiyaar hai:**
```
Repo  : vindhyaresearch/vindhya-climate  (dataset, public)
Base  : https://huggingface.co/datasets/vindhyaresearch/vindhya-climate/resolve/main/
Token : HF_TOKEN environment me hai -- chat me KABHI mat maango
CORS  : verified, exact origin allow hai
Range : accept-ranges: bytes -- PMTiles yahan CHALEGA
Limit : 3000 request prati 5 minute -- isliye block-war files
```

1.1 `config/data_config.json` banao:
```json
{ "DATA_BASE_URL": "https://huggingface.co/datasets/vindhyaresearch/vindhya-climate/resolve/main/" }
```
Har loader yahi padhega. URL kahin aur hardcode NAHI.

1.2 `boundaries/` (650 MB) HF par bhejo, phir `village_profiles/`
    (102 MB). `huggingface_hub` ka `upload_folder` use karo.
    Har rajya ke baad progress batao.

1.3 HF wali files se portal **chalta hua SCREENSHOT** do -- map par
    boundary render hoti hui, chaaron star par.
    **Tab tak repo se purani files MAT hatao.**

1.4 Chalti hui dikh jaye tabhi repo se hatao. Repo ~50 MB reh jayega.

1.5 **File ka dhancha** -- ek badi file KABHI nahi:
```
climate|ndvi|advisory/
    state/<state>.json
    district/<state>/<district>.json
    block/<state>/<district>.json
    village/<state>/<district>/<block>.json
```
Village file **BLOCK-war**. Gaon-war KABHI nahi -- rate limit takrayegi.

1.6 **PMTiles ab mumkin hai.** Naapo: boundaries ko PMTiles me badalne se
    kul size kitna ghatta hai, aur ek visitor jo EK gaon dekhta hai kitna
    MB kheenchta hai. **Asli number batao, faisla mat lo.**

1.7 **Data chhota karo** -- positional-array encoding ka prototype banao,
    jaisa `village_profiles` me kiya tha (665 MB -> 102 MB, 6.5 guna kam).
    Ek zile ka climate data dono roop me likho, asli size ka farak batao.
    Padhne me kitna dhima hua, wo bhi.

1.8 `docs/DATA_SOURCES.md` me likho konsa data ab HF par hai aur kyun.

1.9 Git LFS KABHI nahi. Har file 100 MB se kam.

---

# PHASE 2 -- BACHE HUE UI KAAM

2.1 **`data-target` 12 jagah hai** -- count-up animation abhi bhi chalti
    hai. Pehle kuch second galat number dikhta hai. Koi screenshot le le
    to galat aankda uske paas chala jayega. Attribute aur animation dono
    hatao. Pehle frame se asli number.

2.2 **Inline `style=""` 192 bache** -- CSS variables me lao.
    Rang, spacing, font-size, radius, border. Ek jagah badlo, poore
    portal me badle.

2.3 **"AI chatbot" shabd 1 jagah bacha hai** -- hatao.

2.4 **Rang -- LIGHT hi rahega**
```
--bg #FFFFFF · --bg-soft #F5F7FA · --border #D8DEE7
--text #1A2332 · --text-muted #5A6A7A · --accent #2D8F5C
```
Khatra ke rang sirf DATA ke liye:
extreme #B02418 · high #D9822B · moderate #E0B84C · low #3E9C5A
Gradient, neon, glow -- kabhi nahi.

2.5 **Spacing** 4px grid: 4/8/12/16/24/32/48. Iske bahar kuch nahi.

2.6 **Card** ek shakal ke: radius 6px, border 1px, shadow nahi.
    label (chhota, gaun) -> VALUE (bada, tabular) + unit -> trend
    -> "Source: <naam>, <date>"

2.7 **Chart** -- Chart.js ka default look hatao. Halki horizontal grid,
    vertical nahi. Line 2px, point sirf hover par. Axis par unit.
    Neeche source aur date.

2.8 **State** teeno: loading (skeleton), empty ("Is jagah ka aankda abhi
    uplabdh nahi hai" + kyun), error (kya hua + retry button).

2.9 **Landing background** -- do slide, 8 second par halka fade:
    Slide 1 asli Indian kisan khet me, Slide 2 precision farming /
    satellite se khet. Photo poori chaudai, opacity 1, scrim sirf text
    ke peechhe. Licence saaf: PIB / ICAR / Unsplash / apni photo.
    Google se uthai photo KABHI nahi. Har photo par credit.

2.10 **Sarkari pehchaan** neeche patti me:
```
Boundaries: Survey of India | Climate: ERA5-Land + CHIRPS via GEE
| Projections: NEX-GDDP-CMIP6 | Market: AGMARKNET, data.gov.in
Last updated: <asli date, file se>
Indicative, not for legal or cadastral use
```

---

# PHASE 3 -- BASEMAP + EXPORT

3.1 **Basemap switcher** -- paanch, aur koi nahi:
    Satellite (Esri World Imagery), Street (OSM), Terrain (OpenTopoMap),
    Light (Carto Positron), Dark (Carto Dark Matter).
    Har ek ka attribution dikhe.

3.2 **Boundary ka rang apne aap badle** -- sabse zaroori hissa

    Gehre basemap (Satellite/Dark/Terrain) -- casing:
    kaala underlay weight+3 opacity 0.6, upar chamakdaar line
    State #FF9500 w4 · District #00E5FF w3 · Block #FF3DFF w2.5
    · Village #C6FF00 w2

    Halke basemap (Street/Light) -- ULAT karo:
    safed underlay, upar gehri line
    State #B45309 w4 · District #0E7490 w3 · Block #A21CAF w2.5
    · Village #4D7C0F w2

    Har basemap par khud screenshot lekar dikhao ki chaaron star saaf
    dikh rahe hain.

3.3 **Export as PNG** -- map ke kone me button. Nikli image me ho:
    basemap + saari dikhti boundary, legend, scale bar, north arrow,
    chuni jagah ka poora naam (India > State > District > Block >
    Village), source + tareekh, portal ka naam.
    Kam se kam 2000px chaudai -- research paper ke layak.
    "Copy to clipboard" bhi. Mobile par gallery me save ho.

---

# PHASE 4 -- MULTI-SELECT COMPARE (sirf sidebar me)

Mukhya Location Selector par KOI asar nahi. Bilkul alag feature.

- Sidebar me item "Compare"
- Ek star chuno (State/District/Block/Village), phir 2 se 6 jagah,
  search ke saath (733 zile me dhoondhna aasan ho)
- Har jagah ka apna rang -- wahi rang map, table, chart teenon me
- **Map:** sab ek saath highlight, label ke saath, apne aap zoom
- **Table** (FAOSTAT / UNDP HDR jaisa): row = jagah, column = index
  Heatwave days, SPI, Rainfall, Rx1day, NDVI, Population,
  Net area sown, Irrigated area
  Har column par sort. Sabse ooncha/neecha halka highlight.
  Data na ho to "Data not available" -- khali ya zero nahi, aur aurat
  me mat gino. Har column ke neeche source aur saal.
  Saal ka slider (2000-2024), table saath me badle.
- **Chart:** grouped bar (saal ke hisaab se) + line chart (samay ke
  hisaab se, har jagah ki apni line apne rang me)
- **Nikalo:** table -> CSV/XLSX, chart -> PNG, map -> PNG.
  Har file me source, tareekh, shreya.
- **Mobile:** table ko horizontal scroll me mat daalo -- har jagah ka
  ek card, ek ke neeche ek. 3 se zyada jagah nahi.

---

# PHASE 5 -- KISAN SAHAYAK

Naam ho chuka. Worker chal raha hai:
```
POST https://vindhya-gemini-proxy.vindhyaresearch25.workers.dev
{"prompt": "<ek string>"} -> {"text": "...", "source": "..."}
```
Workers AI (Llama 3.2 3B), chhe model ki fallback suchi.
Gemini ka quota khatam. Key sirf Worker ke secret me -- browser me KABHI
nahi.

5.1 **Pehla popup** (pehli baar kholne par)
```
"नमस्ते, मैं किसान सहायक हूँ" / "Namaste, I am Kisan Sahayak"
"अपने गाँव की खेती, मौसम, फ़सल या मंडी भाव से जुड़ा कोई भी सवाल पूछिए।"
```
Chaar chip -- hardcode NAHI, chuni jagah aur mausam ke hisaab se:
"इस साल बारिश कैसी रही?" · "मेरे गाँव में कौन सी फ़सल ठीक रहेगी?"
· "आज मंडी में भाव क्या है?" · "सूखे का ख़तरा कितना है?"

Neeche: "जवाब असली सरकारी आँकड़ों से। जहाँ आँकड़ा नहीं है, वहाँ साफ़ बता
दिया जाएगा।"

Ek hi baar dikhe (localStorage), phir chhota button.
Mobile par neeche se aaye, poori screen na dhake.

5.2 **Jawab ka niyam**
- Prompt me PEHLE asli aankde daalo, phir sawal
- Chuni jagah ke chaaron star ka data fetch karo
- Fasal ke hisaab se
- Model ko saaf likho: *"Sirf diye gaye aankdon se jawab do. Koi number
  khud mat banao. Jahan aankda na ho, kaho ki uplabdh nahi hai. Saral
  bhasha, kisan ke liye."*
- Har jawab ke neeche source aur tareekh
- Data na ho: "इस जगह का आँकड़ा अभी उपलब्ध नहीं है"
- Jis bhasha me sawal, usi me jawab

5.3 **Research papers** -- in FREE API se jodo:
    OpenAlex, Semantic Scholar, CORE, CrossRef, DOAJ, PubMed/PMC,
    FAO AGRIS, ICAR KRISHI
    Har jawab ke saath title, lekhak, saal, link.
    **Sci-Hub kabhi nahi** -- pirated hai, sarkari portal par kanooni
    khatra.

---

# PHASE 6 -- DATA, POORE DESH KA (saath-saath chalta rahe)

6.1 **Chaaron star ka hisab**
    Village -> apne pixel se (`docs/METHODOLOGY.md` wali methodology)
    Block -> uske gaon ka aggregate
    District -> uske block ka aggregate
    State -> uske zilon ka aggregate
    Har aggregate ke saath: **kitne units se bana + standard deviation**.
    Sirf mean KABHI nahi.

6.2 **Climate** -- 196/733 zile ho chuke, 537 baaki.
    District-level chalta rahe (sirf 3 MB, koi dikkat nahi).
    Village-level Phase 1 ke BAAD.

6.3 **NDVI** -- abhi sirf 52 MP zile (DiCRA). MODIS/Sentinel-2 (GEE) se
    poore desh me, chaaron star par.

6.4 **Advisory** -- upar ke dono se vyutpann, chaaron star par.

6.5 **EK RAJYA CHALAKAR NAAPO** -- poore desh se pehle
    Madhya Pradesh, village-level, teenon parat. Phir ASLI batao:
    - kitne gaon, kitna MB, kitna samay
    - 6,54,285 gaon ka sudhra anuman
    - ek visitor jo EK gaon dekhta hai kitna MB kheenchta hai
    - GEE ka EECU kitna khapa

    **In chaar jawab ke baad hi baaki 35 rajya.**

6.6 **Validation** -- CHIRPS aur ERA5 ko IMD ki JAANCH ke liye, badle me
    nahi. Har zile ke liye: dono ka maan, correlation, bias.
    `data/validation/<state>/<district>.json`, alag panel.
    Research paper me ye majboot baat mani jaati hai.

6.7 **Niyam**
- Jis gaon ka pixel na mile -> "data not available".
  Paas wale gaon ka maan KABHI nahi.
- Observed (ERA5/CHIRPS), projected (CMIP6) aur validation -- teeno
  ALAG, kabhi mila kar nahi
- Har file me metadata: source, method, baseline, unit count, date,
  checksum
- Har rajya ke baad upload + `NIGHT_LOG.md`: samay, size, gaon, kya
  chhoota
- GEE ka EECU quota paas aaye to RUKO aur batao

---

# PHASE 7 -- 20 PANEL KA SOURCE AUDIT

| Panel | Source | Abhi |
|---|---|---|
| Climate Risk Atlas / Heat Waves / Extreme Precip / Drought | apne computed indices | 196 zile |
| Rainfall Monitor | CHIRPS (GEE) | 196 zile |
| NDVI Analytics | MODIS/Sentinel-2 (GEE) + UNDP DiCRA | 52 MP zile |
| Crop Health | Sentinel-2 EVI/NDVI (GEE) | nahi |
| Soil Moisture | SMAP (GEE) | **khali** |
| Forest Monitor | FSI ISFR + Hansen/GFC (GEE) | nahi |
| Satellite Viewer | GEE + Bhuvan (ISRO) WMS | nahi |
| Live Weather | NASA POWER (free, no key) | nahi |
| Groundwater | CGWB / India-WRIS | **khali** |
| Village Profile | SoI attribute table | **HO CHUKA** |
| Mandi Prices | AGMARKNET via data.gov.in | **HO CHUKA** |
| Crop Statistics | data.gov.in MoA&FW | **HO CHUKA** |
| Panchayat Dashboard | LGD + eGramSwaraj | nahi |
| PMFBY Insurance | pmfby.gov.in | nahi |
| Trend Forecast | apne data par OLS, "indicative" label | hai |
| Biodiversity Risk | ENVIS / India Biodiversity Portal | nahi |
| Cadastral Map | MP Bhulekh -- band hai, band rahe | band |

**Har panel ke liye:**
1. Public API hai ya nahi -- pehle data.gov.in, phir uski apni site
2. API hai -> jodo (script + GitHub Actions schedule + metadata)
3. API nahi, bulk CSV/PDF hai -> utaro aur convert karo
4. Kuch bhi machine-readable nahi -> panel me SAAF likho:
   *"No public API. Source: <naam>, <link>. Institutional data request
   required."* Khali ya toota mat chhodo.

**Scraping ka niyam:** sarkari dashboard scrape MAT karo. Sirf wahi lo
jo publisher ne machine-readable diya ho -- API, CSV, bulk download,
WMS/WFS. Terms mana karein to panel me wahi likho. Ye e-NAM aur
e-CHARAK par pehle tay ho chuka hai -- wahi niyam sab par.

**Har panel me dikhe:** source ka naam + link, data ki tareekh, spatial
unit + resolution, "Last updated", method ka link.

**Report:** table -- panel | source | API hai? | INTEGRATED /
NO PUBLIC API / PENDING | kya chahiye aage badhne ke liye

---

# PHASE 8 -- METHODOLOGY (research papers)

Free API: OpenAlex, Semantic Scholar, CrossRef, CORE, NASA ADS.

**Vishay** (peer-reviewed, high-impact only):
- NEX-GDDP-CMIP6 downscaling (NASA) -- dataset ka apna paper
- Bias correction: quantile mapping / delta change -- India ke monsoon
  ke liye kaunsa theek hai
- ETCCDI extreme indices ki manak paribhasha
- SPI ki ganana aur zero-inflated gamma sudhaar
- **ERA5-Land aur CHIRPS ki India ke liye validation studies**
  (ye sabse zaroori -- hum yahi data istemal kar rahe hain)
- Heatwave definition -- IMD ka aur international ka farak
- IPCC AR6 WG1 Ch.11 (extremes) -- projection dikhane ka tarika
- Village-level downscaling ki seemaa

**Patrikaayein:** Nature Climate Change, Journal of Climate, Climate
Dynamics, ERL, IJoC, Theoretical and Applied Climatology, Current
Science, MAUSAM (IMD), Copernicus open journals (ESD, HESS, NHESS)

**Likho aur commit karo:**
- `docs/references/` -- har paper ki BibTeX + PDF link
- `docs/METHODOLOGY_REVIEW.md` -- har method ke liye: kaunsa tarika
  chuna, KYUN, kis paper ke aadhar par, uski seemaa, kis paper ne alag
  raay di

Agar pata chale ki mojooda method me kuch galat ya purana hai -- **RUKO
aur batao**. Chupchap mat badlo, aur galat jaan kar chalne bhi mat do.

---

# PHASE 9 -- SECURITY

9.1 Repo aur **POORI git history** me key dhoondho:
```
ghp_  github_pat_  AIza  hf_  sk-  sk-ant-  -----BEGIN
"api_key"  "apiKey"  "token"  "secret"  "password"
```
Jo mile uski file, line, commit batao. **Chupchap mat hatao** --
history se hatane par sabko dobara clone karna padta hai.

9.2 `.gitignore` majboot: `.env .env.* *.pem *.key`
    `service-account*.json gee_key*.json *credentials*.json .wrangler/`
    Aur pre-commit hook jo key jaisa string mile to commit roke.

9.3 CI me secret scanning job -- mile to build FAIL.

9.4 GEE key `~/.gee/service-account.json` repo me kabhi na jaye.

9.5 `docs/SECURITY.md` -- konsi key kahan rehti hai, kaise rotate karni
    hai, leak ho jaye to kya karna. **Key ka maan kabhi nahi**, sirf
    jagah aur tarika.

**Malik ko khud karna hai (teen key ab tak khuli hain):**
- Purani Gemini key delete (gen-lang-client-0298941748)
- Purana GitHub PAT delete (ghp_bzBq...)
- Hugging Face token delete aur naya banao (hf_REE... chat me aa chuka)
- GitHub -> Settings -> Code security -> Secret scanning aur Push
  protection dono ON

---

# NIYAM -- sab par lagu

- **Koi banaya hua aankda nahi.** Har number asli file se gina jayega
- **Layout aur panel ki jagah wahi rahegi**
- **Portal LIGHT hai aur light hi rahega**
- Observed / projected / validation -- teeno ALAG, kabhi mila kar nahi
- Jahan data nahi: "data not available" + KYUN. Paas wale unit ka maan
  KABHI nahi
- Har phase ke baad commit + push
- Har item ke saamne: HUA / NAHI KIYA / kyun nahi
- Repo 1 GB paas aaye to RUKO aur vikalp do -- khud faisla mat lo
- Sarkari dashboard scrape MAT karo
- Key chat me KABHI mat maango

---

# AAKHIR ME -- LIVE site par KHUD khol kar screenshot do

- Landing (dono slide), photo saaf dikhti hui
- Dashboard: paanchon basemap par
- Chaudai: 1512px, 820px, 390px, 320px
- Simrol (Mhow, Indore) -- pin peele polygon ke ANDAR
- Kisi doosre rajya ka gaon (Tamil Nadu ya Assam)
- Compare table (4 zile)
- Export ki hui PNG
- Kisan Sahayak ka popup aur ek asli jawab

**Phase 1 se shuru karo.**
