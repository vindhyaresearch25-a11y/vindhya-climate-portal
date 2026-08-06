# VINDHYA -- MASTER PLAN (2026-08-06, Phase 1 poora hone ke baad)

Poore desh ka, teenon parat, chaaron star par:
**Climate Risk + Satellite NDVI + Agricultural Advisory**
36 States/UTs · 733 Districts · 6,312 Blocks/Tehsils · 6,54,285 Villages

Kram se karo, upar se neeche. Beech me mat poochho -- sirf asli gadbad
par ruko. Har item ke saamne likho: **HUA / NAHI KIYA / kyun nahi**

**Sab tum karo.** Main sirf wahi karunga jo tum nahi kar sakte (browser
me click, key revoke) -- aur uske liye ek-ek click alag batana. Command
mujhe dekar mat baithna, khud chalao.

---

## AAJ KI ASLI STHITI (naapi hui)

| | |
|---|---|
| Project shuru | 1 Aug 2026, 6 din |
| Boundaries | 36 rajya, 733 zile, 6,312 block, **6,54,285 gaon** -- POORA |
| Village profiles | 6,49,719 gaon, 46 column -- POORA |
| Climate indices | **208 / 733 zile** (28%) |
| Mandi prices | 733 zile, roz apne aap |
| Crop statistics | 733 zile, mahine me |
| **Working tree** | **51 MB / 1 GB** (802 MB se ghata) |
| Storage | Hugging Face -- 1510/1510 file, byte-for-byte verified |
| Git history | 413 MB, **chhedi nahi gayi** -- yahi backup hai |
| Chatbot | Cloudflare Worker + Workers AI (Llama 3.2 3B) |
| Push protection | GitHub par chalu |

**Backup wapas lane ka tarika, agar HF kabhi na chale:**
```bash
git checkout 7b330fa -- dashboard/data/boundaries dashboard/data/village_profiles
```

---

## PHASE 1 -- STORAGE ✓ POORA HO CHUKA

Hugging Face par shift ho gaya. Ginti aur bytes dono verified
(1510/1510 file, 784,203,871 bytes). History chhedi nahi gayi.
`config/data_config.json` me ek hi `DATA_BASE_URL`.

**Dobara mat karo.**

---

# PHASE 2 -- BACHE HUE UI KAAM (ab yahi karo)

2.1 **`data-target` 12 jagah hai** -- count-up animation abhi bhi chalti
    hai. Pehle kuch second galat number dikhta hai; koi screenshot le
    le to galat aankda uske paas chala jayega. Attribute aur animation
    dono hatao. Pehle frame se asli number.

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

# PHASE 3 -- SECURITY (chhota hai, Phase 2 ke saath kar lo)

3.1 **Pre-commit hook** (`.git/hooks/pre-commit`) jo koi bhi key jaisa
    string mile to commit ROK de:
```
ghp_  github_pat_  AIza  hf_  sk-  sk-ant-  -----BEGIN
"api_key"  "apiKey"  "token"  "secret"  "password"
```

3.2 **CI me secret-scan job** -- har push par repo me key pattern
    dhoondhe, mile to build FAIL kare.

3.3 `.gitignore` majboot: `.env .env.* *.pem *.key`
    `service-account*.json gee_key*.json *credentials*.json .wrangler/`

3.4 Poori git history me key dhoondho aur batao -- kis file, kis line,
    kis commit me. **Chupchap mat hatao**, history hi backup hai.

3.5 `docs/SECURITY.md` -- konsi key kahan rehti hai, kaise rotate karni
    hai, leak ho jaye to kya karna. **Key ka maan kabhi nahi.**

**Malik ko khud karna hai (teen key khuli hain):**
- Gemini key delete (gen-lang-client-0298941748)
- GitHub PAT delete (ghp_bzBq...)
- Hugging Face token delete aur naya banao (hf_REE... chat me aa chuka)

---

# PHASE 4 -- NAAPO (Phase 2 ke baad, faisla mat lo)

4.1 **crop_yield 47 MB hai** -- ab working tree ki sabse badi cheez.
    Positional-array encoding se kitna ghatta hai? Asli number batao.

4.2 **Village-level climate, ek rajya (Madhya Pradesh)** chalakar batao:
    - kitne gaon, kitna MB, kitna samay
    - 6,54,285 gaon ka sudhra anuman
    - **ek visitor jo EK gaon dekhta hai kitna MB kheenchta hai**
    - GEE ka EECU kitna khapa

    **In chaar jawab ke baad hi poore desh ka village-level.**

4.3 **PMTiles** -- HF par `accept-ranges: bytes` hai, to ye ab mumkin
    hai. Boundaries ko PMTiles me badalne se kul size kitna ghatta hai,
    aur prati visitor kitna MB. Dono naapo.

4.4 Prati visitor 20 MB se zyada nikle to RUKO aur batao.

---

# PHASE 5 -- BASEMAP + EXPORT

5.1 **Basemap switcher** -- paanch, aur koi nahi:
    Satellite (Esri World Imagery), Street (OSM), Terrain (OpenTopoMap),
    Light (Carto Positron), Dark (Carto Dark Matter).
    Har ek ka attribution dikhe.

5.2 **Boundary ka rang apne aap badle** -- sabse zaroori hissa

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

5.3 **Export as PNG** -- map ke kone me button. Nikli image me ho:
    basemap + saari dikhti boundary, legend, scale bar, north arrow,
    chuni jagah ka poora naam (India > State > District > Block >
    Village), source + tareekh, portal ka naam.
    Kam se kam 2000px chaudai -- research paper ke layak.
    "Copy to clipboard" bhi. Mobile par gallery me save ho.

---

# PHASE 6 -- MULTI-SELECT COMPARE (sirf sidebar me)

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

# PHASE 7 -- KISAN SAHAYAK

Naam ho chuka. Worker chal raha hai:
```
POST https://vindhya-gemini-proxy.vindhyaresearch25.workers.dev
{"prompt": "<ek string>"} -> {"text": "...", "source": "..."}
```
Workers AI (Llama 3.2 3B), chhe model ki fallback suchi.
Key sirf Worker ke secret me -- browser me KABHI nahi.

7.1 **Pehla popup** (pehli baar kholne par)
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

7.2 **Jawab ka niyam**
- Prompt me PEHLE asli aankde daalo, phir sawal
- Chuni jagah ke chaaron star ka data fetch karo
- Fasal ke hisaab se
- Model ko saaf likho: *"Sirf diye gaye aankdon se jawab do. Koi number
  khud mat banao. Jahan aankda na ho, kaho ki uplabdh nahi hai. Saral
  bhasha, kisan ke liye."*
- Har jawab ke neeche source aur tareekh
- Data na ho: "इस जगह का आँकड़ा अभी उपलब्ध नहीं है"
- Jis bhasha me sawal, usi me jawab

7.3 **Research papers** -- in FREE API se jodo:
    OpenAlex, Semantic Scholar, CORE, CrossRef, DOAJ, PubMed/PMC,
    FAO AGRIS, ICAR KRISHI
    Har jawab ke saath title, lekhak, saal, link.
    **Sci-Hub kabhi nahi** -- pirated hai, kanooni khatra.

---

# PHASE 8 -- DATA, POORE DESH KA

8.1 **File ka dhancha** -- ek badi file KABHI nahi:
```
climate|ndvi|advisory/
    state/<state>.json
    district/<state>/<district>.json
    block/<state>/<district>.json
    village/<state>/<district>/<block>.json
```
Village file **BLOCK-war**. Gaon-war KABHI nahi -- HF ki rate limit
(3000 request prati 5 minute) takrayegi.

8.2 **Chaaron star ka hisab**
    Village -> apne pixel se (`docs/METHODOLOGY.md` wali methodology)
    Block -> uske gaon ka aggregate
    District -> uske block ka aggregate
    State -> uske zilon ka aggregate
    Har aggregate ke saath: **kitne units se bana + standard deviation**.
    Sirf mean KABHI nahi.

8.3 **Climate** -- 208/733 zile ho chuke, 525 baaki. District-level
    chalta rahe. Village-level Phase 4 ki naap ke baad.

8.4 **NDVI** -- abhi sirf 52 MP zile (DiCRA). MODIS/Sentinel-2 (GEE) se
    poore desh me, chaaron star par.

8.5 **Advisory** -- upar ke dono se vyutpann, chaaron star par.

8.6 **Validation** -- CHIRPS aur ERA5 ko IMD ki JAANCH ke liye, badle me
    nahi. Har zile ke liye: dono ka maan, correlation, bias.
    `data/validation/<state>/<district>.json`, alag panel.
    Research paper me ye majboot baat mani jaati hai.

8.7 **Niyam**
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

# PHASE 9 -- 20 PANEL KA SOURCE AUDIT

| Panel | Source | Abhi |
|---|---|---|
| Climate Risk Atlas / Heat Waves / Extreme Precip / Drought | apne computed indices | 208 zile |
| Rainfall Monitor | CHIRPS (GEE) | 208 zile |
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
WMS/WFS. Terms mana karein to panel me wahi likho.

**Har panel me dikhe:** source ka naam + link, data ki tareekh, spatial
unit + resolution, "Last updated", method ka link.

**Report:** table -- panel | source | API hai? | INTEGRATED /
NO PUBLIC API / PENDING | kya chahiye aage badhne ke liye

---

# PHASE 10 -- METHODOLOGY (research papers)

Free API: OpenAlex, Semantic Scholar, CrossRef, CORE, NASA ADS.

**Vishay** (peer-reviewed, high-impact only):
- NEX-GDDP-CMIP6 downscaling (NASA) -- dataset ka apna paper
- Bias correction: quantile mapping / delta change -- India ke monsoon
  ke liye kaunsa theek hai
- ETCCDI extreme indices ki manak paribhasha
- SPI ki ganana aur zero-inflated gamma sudhaar
- **ERA5-Land aur CHIRPS ki India ke liye validation studies**
  (sabse zaroori -- hum yahi data istemal kar rahe hain)
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

# NIYAM -- sab par lagu

- **Koi banaya hua aankda nahi.** Har number asli file se gina jayega
- **Layout aur panel ki jagah wahi rahegi**
- **Portal LIGHT hai aur light hi rahega**
- Observed / projected / validation -- teeno ALAG, kabhi mila kar nahi
- Jahan data nahi: "data not available" + KYUN. Paas wale unit ka maan
  KABHI nahi
- **Git history KABHI mat rewrite karo** (filter-branch/filter-repo/BFG)
  -- wahi 752 MB ka backup hai
- Har phase ke baad commit + push
- Har item ke saamne: HUA / NAHI KIYA / kyun nahi
- Working tree 1 GB ya HF 10 GB paas aaye to RUKO aur vikalp do
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

**Phase 2 se shuru karo.** (Phase 1 poora ho chuka hai.)
