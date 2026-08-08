# MERA KHET + PANEL SAFAI

Do kaam. Pehla naya feature, doosra panel ki safai.
Kram se karo. Har item ke saamne: **HUA / NAHI KIYA / kyun nahi**

---

# BHAAG A -- "MERA KHET" (naya feature)

Kisan khud apna khet polygon se khinche, aur uske hisaab se jawab
mile. Ye **cadastral wali poori samasya hal kar deta hai** -- Bhulekh
ke data ki zaroorat hi nahi, kisan khud batayega. Aur ye apne aap
**ground truth** bhi ban jayega.

**AADHA KAAM PEHLE SE BANA HAI:** `geoai_professional.js` me polygon
khinchne aur kshetrafal naapne ka poora code hai (spherical area,
haversine perimeter, point-in-ring). **Usi ko dobara istemal karo,
naya mat likho.**

---

## A0. RESOLUTION -- ye pehle samjho, warna galat vaada hoga

| Data | Resolution | 2 ha ke khet par |
|---|---|---|
| Sentinel-2 / Dynamic World | **10 m** | ✓ 200 pixel -- kaam karega |
| Sentinel-1 (radar) | **10 m** | ✓ badal me bhi |
| SMAP mitti ki nami | 9 km | ✗ ek pixel = 8,100 ha |
| ERA5-Land mausam | 11 km | ✗ |
| CHIRPS barish | 5.5 km | ✗ |

**Matlab saaf:**
- **Kheti ka kshetra** aur **fasal ki sehat** -- khet-star par ASLI
- **Mausam** aur **nami** -- zile ka aankda, khet ka NAHI

Panel me ye SAAF likha ho, warna kisan samjhega ki nami uske khet
ki hai.

**MEDH 1-2 meter chaudi hoti hai** -- 10 m pixel me dikhegi hi nahi.
"Kheti wala hissa vs baaki" bata sakte hain, **har medh alag NAHI.**
Ye bhi panel me likho.

---

## A1. Kya dikhao -- kisan polygon khinche, phir:

### 1. ZAMEEN KA HISAB   `[khet-star, asli]`
```
Kul kheencha kshetra        2.40 ha
Kheti wala hissa            1.92 ha   [Dynamic World / Sentinel-2]
Baaki (medh, raasta,        0.48 ha
banjar, ped)
```
**Yahi asli chinta thi** -- gaon ki seema me medh, banjar, basti sab
aa jata hai, asli kheti ka hissa nahi milta. Ab hal ho jayega.

### 2. FASAL KI SEHAT   `[khet-star, asli]`
- NDVI abhi
- Pichhle 6 mahine ka graph (Sentinel-2, 10 m)
- Khet ke andar kahan kamzor hai -- chhota naksha
- Mausam pata chalega NDVI ke shikhar se (kharif / rabi / zayad)

### 3. MAUSAM AUR PAANI   `[CHAARON STAR par -- village/block/district/state]`

Ye aankde **har star par dikhao**, jaise climate indices dikhate hain.
Zile tak seemit mat rakho.

| Kya | Srot | Resolution |
|---|---|---|
| Aaj ka mausam, 7-din poorvanuman | NASA POWER | ~50 km |
| Barish (is saal, aurat, vichalan) | CHIRPS | 5.5 km |
| Mitti ki nami | SMAP | 9 km |
| Tapman (max/min) | ERA5-Land | 11 km |

**Chaaron star kaise banao** -- wahi tarika jo climate ke liye tay hua:
```
Village  -> jis grid cell me gaon ka centroid girta hai, uska maan
Block    -> uske gaon ka aggregate + standard deviation
District -> uske block ka aggregate + SD
State    -> uske zilon ka aggregate + SD
```

**Har aggregate ke saath likho:** kitne unit se bana + standard
deviation. Sirf aurat kabhi nahi.

**Gaon-star par ye SAAF likha ho:**
> *"Yah aapke gaon wali 9 km grid cell ka maan hai. Is cell me
> lagbhag N aur gaon hain, sabka maan yahi hoga. Yah aapke khet ka
> apna maap nahi hai."*

`N` (kitne gaon wo cell share karte hain) **ginkar dikhao** -- ye
sabse imaandar tarika hai, aur reviewer ka pehla sawal yahi hoga.

**Khet ke polygon ke liye:** wahi cell ka maan dikhao, isi label ke
saath. Khet 2 ha ka hai aur cell 8,100 ha ka -- ye chhupao mat.

### 4. AAS-PAAS KI TULNA   `[khet-star, sabse upyogi]`
```
Aapke khet ka NDVI      0.62
Gaon ka aurat           0.55
-> "Aapka khet gaon ke aurat se behtar hai"
```
Ye sabse kaam ki cheez hai, kyunki dono ek hi din, ek hi satellite
se hain -- resolution ki dikkat yahan lagti hi nahi.

### 5. SALAH
Model ko upar ka sab data do, phir salah maango.
Har salah ke saath likho **kis aankde par aadharit hai**.
Number model se mat likhwao -- code se daalo (METHODOLOGY §7.1).

---

## A1b. DOWNLOAD -- teen format, do jagah

Download **do jagah** chahiye, aur **teen format** me:

### Jagah 1 -- Location Selector (koi bhi star)
Jab kisan State / District / Block / Village chune, uske paas
download ka button ho -- **usi chuni hui seema ka**.

### Jagah 2 -- Mera Khet (khud kheencha polygon)
Polygon khinchte hi uske bagal me download ka button aaye.

### Teen format

| Format | Kya milega | Kitni der |
|---|---|---|
| **SHP** (zip) | Vector -- QGIS/ArcGIS me khulega | **turant** |
| **PNG** | Naksha ki tasveer | **turant** |
| **GeoTIFF** | Georeferenced raster | **minute lagenge** |

**Saath me GeoJSON aur KML bhi do** -- ye aur bhi aasan hain
(GeoJSON web ke liye, KML Google Earth ke liye). Paanch format ka
ek chhota menu bana do.

### SHP kaise banao
Browser me hi bane -- `shp-write` ya `@mapbox/shp-write` se
GeoJSON -> zip (.shp + .shx + .dbf + .prj). Server ki zaroorat nahi.
- **CRS: EPSG:4326**, `.prj` file zaroor daalo warna GIS me galat
  jagah khulega
- `.dbf` me attribute daalo: naam, code, kshetrafal, aur jo aankde
  panel me dikhe (NDVI, barish, nami) -- saath me unka saal

### PNG kaise banao
Phase 5.3 wala Export-as-PNG pehle se plan me hai -- wahi istemal
karo. Nikli image me legend, scale bar, north arrow, jagah ka poora
naam, source aur tareekh.

### GeoTIFF -- ye alag hai, imaandari se batao
GeoTIFF ka matlab hai satellite raster (NDVI ya cropland mask) us
polygon par clip karke. Wo **GEE se aayega aur async hai** -- minute
lagte hain, turant nahi.

To aisa banao:
1. Kisan "GeoTIFF" dabaye -> "Taiyaar kiya ja raha hai, 2-5 minute"
2. GEE `Export.image.toDrive` / `toCloudStorage` chale
3. Taiyaar hone par link dikhe (page par, ya download ho jaye)
4. **Turant download ka jhootha vaada mat karo**

Agar ye bahut bhaari lage to pehle SHP + PNG + GeoJSON + KML do,
aur GeoTIFF par likho *"jald aa raha hai"*. Chaar format bhi kaafi
hain.

### HAR DOWNLOAD KE SAATH ye file bhi ho (readme.txt zip ke andar)
```
Boundaries: Survey of India (via NWDP), <tareekh>
Climate: ERA5-Land + CHIRPS via Google Earth Engine, <saal>
CRS: EPSG:4326
Resolution: <har layer ka alag>
Indicative, not for legal or cadastral use.
सांकेतिक, कानूनी/भू-अभिलेख उपयोग हेतु नहीं।
```
Ye zaroori hai -- file kisi aur ke paas jayegi to shreya aur
seemaa saath jani chahiye.

### Bada download
Poore rajya ka village layer bada hoga (kuch MB se zyada). Aise me:
- Pehle size dikhao: *"Madhya Pradesh, 55,392 gaon, ~48 MB"*
- Phir puchho, seedha mat bhejo
- Mobile par chetavani do

---

## A2. GROUND TRUTH -- yahi asli fayda

Polygon ke baad kisan se poochho (vaikalpik):
> "Is khet me abhi kaunsi fasal hai?" [dropdown]

Uski anumati se jama karo -- **yahi classifier ka training data
banega**.

DPDP ke niyam wahi jo pehle tay hue:
- Naam, phone, Aadhaar **mat maango**
- Anumati ka checkbox, bina uske save nahi
- Sarvajanik dataset me nirdeshank **3 dashamlav tak gol** (~100 m)
- IP store mat karo
- Har pravishti par random ID
- Status: `unverified` (default) / `verified`

Bhandaran: Cloudflare D1 (free tier) -> GitHub Action roz JSON
banakar HF par bheje, CC-BY licence.

---

## A3. PEHLE NAAPO (kaam shuru mat karo)

1. Ek 2-hectare polygon par Dynamic World se cropland nikalne me
   kitna samay -- **GEE live query, kisan intezaar karega**
2. 10 second se zyada lage to pre-compute ka rasta socho
3. Sentinel-2 ka NDVI us polygon par kitni jaldi aata hai
4. Kitne saaf din milte hain -- kharif me badal se dikkat hogi
5. GEE ka EECU kitna khapta hai prati query (kisan roz poochenge)
6. `shp-write` browser me chalta hai ya nahi, aur ek rajya ka
   village layer SHP me badalne me kitna samay/RAM lagta hai
7. GeoTIFF export (GEE async) me sach me kitne minute lagte hain --
   ek 2-hectare polygon par chalakar naapo

**Naapkar batao, phir banayenge.**

---

# BHAAG B -- PANEL KI SAFAI

Aath khali panel poore portal ko adhoora dikhate hain, jabki asli
kaam (6.5 lakh gaon, 397 zile) bahut bada hai.
**Khali panel se na hona behtar hai.**

## RAKHO aur BANAO (do)

### B1. SOIL MOISTURE -- SMAP (GEE, muft)
Kisan ka sabse aam sawal: *"abhi paani dun ya rukun"*. Iska seedha
jawab.
- Chaaron star par, jaise climate (village / block / district / state)
- **Resolution 9 km** -- ye har jagah likho. Gaon-star par bhi wahi
  9 km ka maan hoga, gaon ka apna nahi.
- Har aggregate ke saath: kitne pixel se bana + standard deviation

### B2. GROUNDWATER -- CGWB / India-WRIS
**Ye sabse zyada value wala hai.**
Humare paas har gaon ka kuan/nalkoop sinchai kshetra **PEHLE SE hai**
(`village_profiles`: `irrigated_wells_tubewells_ha`).

CGWB ka zila-star bhujal star usse jodo -- pata chalega **kaunsa gaon
khatre me hai** (jyada nalkoop sinchai + girta bhujal star = khatra).

**Ye apne aap me research paper layak hai.**

PEHLE jaancho: India-WRIS ka public API/download hai ya nahi.
- Hai to script likho
- Nahi hai to panel me: *"No public API. Source: CGWB India-WRIS.
  Institutional data request required."*
- **Scrape mat karo**

---

## HATAO (teen) -- sidebar se poori tarah

### B3. SATELLITE VIEWER
Basemap switcher yahi kaam kar raha hai -- dohrav hai.

### B4. PANCHAYAT DASHBOARD
Sarpanch ka naam dikhane se kisan ka kya bhala? Koi asli data source
bhi nahi.

### B5. BIODIVERSITY RISK
Koi bharosemand srot nahi, aur kisan ke kaam ka nahi.

**Hatane se pehle:** jaancho ki in teen panel ka koi code/data kahin
aur istemal to nahi ho raha. Phir sidebar, routing aur docs teenon se
hatao.

---

## BAAD ME (do) -- sidebar me rakho, par "coming soon" label ke saath

### B6. FOREST MONITOR
Vindhya me van-aajivika mayne rakhti hai, Hansen/GFC muft hai (GEE).
Par kheti nahi hai, isliye baad me.

### B7. PMFBY
Kisan ko chahiye, par daave ki sthiti ke liye login chahiye. Sirf
yojna ki jankari kam kaam ki.
**Zila-star ka premium/claim aankda milta hai to wo dikhao** --
pmfby.gov.in par public statistics hain ya nahi, jaancho.

---

## WAISE HI RAHNE DO

### B8. CADASTRAL MAP
Sahi tarike se band hai, Bhulekh ka intezaar.
**Ab "Mera Khet" isi ki jagah kaam karega** -- panel me link do:
*"Apna khet khud khinchiye"* -> Mera Khet par le jaye.

---

# NIYAM -- dono bhaag par

- Har aankde ke saath **resolution** likho. 9 km ka data khet-star
  par dikhana bina label ke **galat vaada** hai.
- Number model se mat likhwao -- code se daalo
- Citation code se, model se nahi (METHODOLOGY §7.1)
- Jahan data nahi: *"uplabdh nahi hai"* + kyun
- `docs/REQUIREMENTS_ROADMAP.md` me likho kya hataya aur **KYUN** --
  taaki aage koi dobara na jode

---

# KRAM

1. **B3, B4, B5 hatao** -- sabse aasan, aaj ho jayega
2. **B1 Soil Moisture** -- SMAP, GEE me pehle se hai
3. **B2 Groundwater** -- pehle India-WRIS ki jaanch, phir script
4. **A3 naapo** -- Mera Khet ke chaar number
5. Naap theek nikle to **Mera Khet banao**

Climate, NDVI, crop -- sab chalta rahe.
