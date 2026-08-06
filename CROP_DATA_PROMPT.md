# CROP DATA -- poore desh ka, 2000 se ab tak

Do kaam. Pehla data ka, doosra kisan-upload ka.
Kram se karo. Har item ke saamne likho: **HUA / NAHI KIYA / kyun nahi**

---

# BHAAG A -- CROP DATA, 2000 SE AAJ TAK

## Abhi kya hai
`crop_stats.json` me sirf **5 zile** (Bhopal, Indore, Jabalpur, Rewa,
Sidhi) aur **1997-2013** tak. 733 zile chahiye, 2000 se aaj tak.

## Srot (ye DATA PORTAL hain, dashboard nahi -- inka maksad data
baantna hi hai, phir bhi har ek ki terms padhkar batana)

| Srot | Link |
|---|---|
| UPAg -- All India APY | https://upag.gov.in/dash-reports/allindiaapy |
| UPAg -- Progressive crop area sown | https://upag.gov.in/dash-reports/progressivecropareasown |
| DES crops APY report | https://data.desagri.gov.in/website/crops-apy-report-web |
| data.gov.in (jo abhi istemal ho raha) | resource 35be999b-0208-4354-b557-f6ca9a5355de |
| Har rajya ka **Krishi Vibhag** annual report | PDF |
| Har rajya ka **Udyaniki (Horticulture)** vibhag annual report | PDF |
| Agricultural Statistics at a Glance | desagri.gov.in, PDF |

---

## CHARAN 1 -- PEHLE DEKHO, KHEENCHO NAHI

Teeno portal par jaakar batao:
- Official download/export button hai? (CSV, XLSX, JSON)
- Public API endpoint hai? **Network tab dekho** -- portal khud kis
  API se data laata hai, wahi seedha istemal ho sakta hai
- Terms of use kya kehti hain -- bulk download allowed hai?
- Data kis star tak: rajya, zila, ya block?
- **Kaunse saal se kaunse saal tak?**
- Kaunsi fasal shamil hain?
- **Zayad/summer season hai ya sirf Kharif/Rabi/Whole Year?**

Table me report do. **Kuch download mat karo abhi, sirf dekho.**

---

## CHARAN 2 -- SAAL-WAR LAO: 2000 se aaj tak, ek bhi saal chhode bina

Sarkari website saal-war prakashit karti hain, isliye saal-dar-saal
chalo:
```
2000-01, 2001-02, 2002-03 ... 2023-24, 2024-25, 2025-26 (agrim)
```

**Har saal ke liye, isi kram me:**

1. Pehle **CSV/XLSX** dhoondho -- UPAg aur data.desagri.gov.in par
   download button hota hai. Sabse saaf yahi hai.
2. Na mile to **PDF** lo (annual report, Agricultural Statistics at a
   Glance, advance estimates).
3. Dono na milein to us saal ko **GAP suchi** me daalo aur AGE BADHO.
   Ruko mat, aur purane saal se bharo bhi mat.

**Har saal ke saath darj karo:**
```
saal | srot | URL | format (CSV/XLSX/PDF) | page number (agar PDF)
| kis din utara | zila-star ya rajya-star | antim ya agrim anuman
```

Ye `docs/CROP_DATA_COVERAGE.md` me table ke roop me rakho, taaki saaf
dikhe kaunsa saal kahan se aaya aur kaunsa nahi mila.

---

## CHARAN 3 -- FORMAT KE HISAB SE

**CSV / XLSX**
- Column ke naam saal-dar-saal badalte hain (`Area` / `AREA` /
  `area_ha` / `Area (Ha)`) -- ek mapping table banao
- Unit bhi badalta hai (hectare vs '000 hectare) -- har saal jaancho,
  maan mat lo

**PDF**
- `pdfplumber` ya `camelot` se table nikalo
- **Har table ka total PDF ke apne total se milao.** Na mile to us
  table ko `"extraction_verified": false` flag karo -- chupchap mat
  rakho
- Jo table bilkul na nikle use CHHOD DO aur GAP suchi me likho.
  Aadha-adhoora data mat bharo

---

## CHARAN 4 -- RAJYA KE ANNUAL REPORT (PDF)

36 rajya x (krishi + udyaniki) = **72 srot**. Bada kaam hai.

**Pehle DO rajya par karke dikhao** (Madhya Pradesh aur ek doosra),
phir baaki.

`scripts/extract_state_reports.py` banao.

`docs/STATE_REPORTS.md` me har rajya ka record:
```
rajya | vibhag | report ka saal | PDF link | mila/nahi |
kaunse saal | kaunsi fasal | kya chhoota
```

---

## CHARAN 5 -- TEENON SROT AAPAS ME MILAO

UPAg, DES aur rajya ke report ke aankde **ALAG honge** -- ye normal
hai (advance vs final, alag revision). **Farak LIKHO, chhupao mat.**

`data/crop_stats_comparison.json` -- har zila-fasal-saal ke liye:
UPAg kya kehta hai, DES kya, rajya ka report kya, aur kitna farak.

Portal me **DES ko MUKHYA** chuno (sabse aadhikarik) aur baaki ko
"cross-check" ki tarah dikhao. **Kabhi mila kar mat dikhao.**

---

## CHARAN 6 -- HORTICULTURE ALAG RAKHO

Sabziyan, phal, masale -- ye APY report me nahi hote, alag udyaniki
report me hote hain.

Alag panel:
```
Field crops   : DES / UPAg, <saal>
Horticulture  : State Horticulture Department, <saal>
```

Dono ko jodkar "total crop area" **mat banao** -- galat hoga.

---

## CHARAN 7 -- DO CHEEZEIN JO AKSAR GADBAD KARTI HAIN

**Naye zile bante rehte hain.** 2000 me MP me 45 zile the, ab 55 hain.
Naam se milane par wo chhoot jayenge.
- **LGD code se milao** jahan mile
- Naam badla ho to mapping table banao (`docs/DISTRICT_NAME_MAP.md`)
- Purana zila tootkar do bana ho to ye LIKHO, aankda baant mat do

**Naye saal ke aankde badalte hain.** 2025-26 ka "advance estimate"
baad me sanshodhit hoga.
- Har record me: `"estimate_type": "final" | "advance"`
- Panel me dikhao: `2025-26 (advance estimate, may be revised)`

---

## AAKHIR ME BATAO

- Kitne saal mile (2000 se ab tak me se)
- Kitne CSV/XLSX se, kitne PDF se
- Kitne saal nahi mile aur **kyun**
- Zila-star kitne saal ka, rajya-star kitne ka
- Zayad/summer kis saal se milta hai (ya milta hi nahi)
- Kitne zile aaye (733 me se)

**Pehle DO saal karke dikhao** -- 2000-01 (sabse purana) aur 2024-25
(sabse naya). Ek purana ek naya. Theek nikle to baaki saal.

---

# BHAAG B -- KISAN UPLOAD (ground truth ikattha karna)

Maksad: satellite classifier ko sikhane ke liye asli bindu chahiye.
Kisan khud batayein ki unke khet me kaunsi fasal hai. Bhuvan/NRSC bhi
crowdsourcing se yahi karta hai.

**Dhancha -- jo pehle se hai usi se:**
```
Browser -> Cloudflare Worker -> Cloudflare D1 (SQLite, free tier)
GitHub Action roz D1 se JSON banakar HF par bhejega
```
Koi naya kharcha nahi, koi card nahi.

## B1. Form me kya poochho (kam se kam)
- Fasal ka naam (dropdown -- crop_stats ki 59 fasal + "anya")
- Mausam (kharif / rabi / zayad)
- **Live location** (browser geolocation, kisan ki anumati se)
- Khet ka lagbhag kshetrafal (vaikalpik)
- Photo -- **abhi band rakho**, storage baad me

**NAAM, PHONE, AADHAAR -- ye MAT maango.** Zaroorat nahi hai. Kisan
khud dena chahe to vaikalpik, aur kabhi sarvajanik mat karo.

## B2. Anumati (DPDP Act 2023)
Form ke upar Hindi aur English me:
```
आपका स्थान और फ़सल की जानकारी उपग्रह मॉडल को बेहतर बनाने के लिए
इस्तेमाल होगी। आपका नाम या फ़ोन नहीं माँगा जा रहा। यह जानकारी
सार्वजनिक शोध डेटासेट में जाएगी, पर आपकी पहचान के बिना।
```
Ek checkbox -- bina uske submit na ho.
Ek line: "Aap kabhi bhi apni pravishti hatane ke liye kah sakte hain"
+ sampark ka tarika.

## B3. Gopniyata
- Bheetar theek nirdeshank rakho (model ke liye zaroori)
- **Sarvajanik dataset me 3 dashamlav tak gol karo** (~100 m) -- khet
  pehchana na jaye
- IP address **store mat karo** (sirf rate limit ke liye memory me)
- Har pravishti par random ID, koi vyaktigat pehchan nahi

## B4. Gunvatta
- Rate limit: ek IP se 20 pravishti prati din
- Nirdeshank Bharat ke andar hone chahiye, warna reject
- Us jagah ka village/block/district **apne aap** nikalo (SoI
  boundaries se) -- kisan ko chunna na pade
- Status: `unverified` (default) / `verified`
- Model me sirf `verified` ya bahut se milte-julte `unverified` --
  ye METHODOLOGY me likho

## B5. Dikhao
- Naksha par jama hue bindu (gol kiye hue nirdeshank)
- Gaon ke panel me: "Is gaon se N kisan pravishtiyan"
- Kul ginti dashboard par
- Kisan ko dhanyavaad, aur batao uski pravishti kis kaam aayegi

## B6. Nikalo
GitHub Action roz D1 se JSON banaye:
```
data/ground_truth/<state>/<district>.json  -> HF par
```
Sarvajanik, CC-BY licence, taaki doosre shodhkarta bhi istemal kar
sakein. Paper me ye achhi baat hogi.

## B7. METHODOLOGY.md me likho
- Kitne bindu jama hue, kitne verified
- Training aur validation me kaise baante
- Crowdsourced data ki seemaa (bias -- jo kisan phone istemal karte
  hain wahi bhejenge)

## Bhaag B se pehle ye batao
- Cloudflare D1 free tier me hai ya **card maangta hai**
- Worker se D1 me likhna kitna aasan hai
- Ek chhota prototype form banane me kitna samay

---

# NIYAM -- dono bhaag par lagu

- **Portal SCRAPE mat karo** jab tak official export na ho. Pehle
  download/API dhoondho, phir terms padho. Terms mana karein to panel
  me likho: *"No bulk export; institutional request required"*
- Server par bojh mat daalo -- request ke beech ruko. Ye rajya sarkar
  ka server hai.
- Har aankde ka **source, saal, page number** darj ho
- PDF se nikala data `"extraction_verified": false` ke saath, jab tak
  total match na ho
- Jo saal na mile use **KHALI chhodo** -- purane saal se bharo mat
- Zayad kisi srot me na ho to likho *"not reported in source"* --
  banao mat
- Har naye dataset ki row `docs/DATA_SOURCES.md` me
- **Koi banaya hua aankda nahi**

---

# ABHI SHURU KARO

**Aaj, ye teen -- sabse aasan:**
1. `fetch_crop_stats.py` **poora chalao** (733 zile aane chahiye,
   abhi 5 hain). Kitne aaye, kitne fail, kyun -- table me batao.
2. `village_profiles` ka krishi data gaon ke panel me dikhao --
   `land_net_area_sown_ha`, `irrigated_area_total_ha`,
   `land_unirrigated_ha`, `irrigated_canals_ha`,
   `irrigated_wells_tubewells_ha`, `irrigated_tanks_lakes_ha`,
   `land_fallow_current_ha`. **6,49,719 gaon ke liye pehle se hai.**
3. Charan 1 -- teeno portal dekho aur table me batao kya mila.
   Kuch download mat karo.

In teen ke nateeje ke baad aage badhenge.
