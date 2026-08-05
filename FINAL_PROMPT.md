# VINDHYA -- baaki ka poora kaam (2026-08-03)

Kram se, upar se neeche. Beech me mat poochho -- sirf asli gadbad par
ruko. Har item ke saamne likho: HUA / NAHI KIYA / kyun nahi.

## JO HO CHUKA HAI (dobara mat karo)
emoji hatao, 94.2 hatao, Inter self-host, teen map overlap, do ghadi,
government footer, chart panel ka empty state, light theme wapas,
landing ka frosted panel aur do stat box, Kisan Sahayak ka naam,
marker fix, teen-tier landing stats.

════════════════════════════════════════════════════════
PHASE A -- ABHI BAAKI, TURANT
════════════════════════════════════════════════════════

A1. AI ka naam abhi bhi 4 jagah hai
    "AI-Powered" x2 (tab title me bhi), "AI Advisory", "AI chatbot".
    Sab hatao. Kaam ka naam do, tool ka nahi.

A2. data-target 13 jagah hai -- count-up animation abhi bhi chal
    rahi hai. Pehle kuch second galat number dikhta hai. Attribute
    aur animation dono hatao. Pehle frame se asli number.

A3. inline style="" 191 jagah hai. CSS variables me lao --
    rang, spacing, font-size, radius, border. Ek jagah badlo,
    poore portal me badle.

A4. Font-size abhi bhi bikhre hue hain. 6 ka scale banao:
    desktop 11/13/15/20/28/36, mobile 12/14/16/20/24/28.
    Number ke liye tabular figures. Heading 600, letter-spacing 0.

A5. Dashboard khulne me bahut samay leta hai -- 30 second tak kuch
    render nahi hua tha. Kya block kar raha hai dhoondho. Har fetch
    par 30s timeout aur graceful fallback ho. Page kabhi na hange.

A6. Number ka format ek jaisa karo -- "6,312" aur "6,54,285" do
    alag tarike hain. Poore portal me ek hi.

════════════════════════════════════════════════════════
PHASE B -- LAPTOP + TABLET + MOBILE
════════════════════════════════════════════════════════

DESKTOP (1024px+)
  Sidebar khula 220px, map beech me, metrics dayen, card 2-3 column.

TABLET (768-1024px)
  Sidebar sirf icon (56px), hover par naam. Metrics map ke neeche.
  Card 2 column.

MOBILE (768px se neeche) -- kisan yahi dekhega, ASLI screen yahi hai
  Sidebar chhup jaye, hamburger drawer se khule
  Location Selector sabse upar, poori chaudai
  Map uske neeche, screen ki 45% oonchai
  Metrics 1 column, uske neeche chart ek ke baad ek
  Har button/dropdown kam se kam 44x44px, native picker chale
  Map: pinch-zoom chale, do ungli se hi ghume (galti se scroll nahi)
  North arrow aur scale bar hatao, legend collapsible
  Chatbot chhota kone ka button
  Neeche sticky bar: chuni jagah ka naam + "Change"
  Text 14px se chhota nahi
  Horizontal scroll KABHI nahi -- 320px par bhi nahi

════════════════════════════════════════════════════════
PHASE C -- BASEMAP + IMAGE EXPORT
════════════════════════════════════════════════════════

C1. BASEMAP SWITCHER (map ke kone me) -- paanch, aur koi nahi
    Satellite (Esri World Imagery), Street (OSM), Terrain
    (OpenTopoMap), Light (Carto Positron), Dark (Carto Dark Matter).
    Har ek ka attribution dikhe.

C2. BOUNDARY KA RANG APNE AAP BADLE -- sabse zaroori hissa
    Gehre basemap (Satellite/Dark/Terrain) -- casing:
      kaala underlay weight+3 opacity 0.6, upar chamakdaar line
      State #FF9500 w4, District #00E5FF w3, Block #FF3DFF w2.5,
      Village #C6FF00 w2
    Halke basemap (Street/Light) -- ULAT karo:
      safed underlay, upar gehri line
      State #B45309 w4, District #0E7490 w3, Block #A21CAF w2.5,
      Village #4D7C0F w2
    Basemap badalte hi rang apne aap badle. Har basemap par khud
    screenshot lekar dikhao ki chaaron star saaf dikh rahe hain.

C3. EXPORT AS PNG
    Map ke kone me "Export image". Nikli image me ho: basemap +
    saari dikhti boundary, legend, scale bar, north arrow, chuni
    jagah ka poora naam (India > State > District > Block > Village),
    "Source: Survey of India, IMD" + tareekh, portal ka naam.
    Kam se kam 2000px chaudai (2x/3x) -- research paper ke layak.
    "Copy to clipboard" bhi. Mobile par gallery me save ho.

════════════════════════════════════════════════════════
PHASE D -- MULTI-SELECT COMPARE (sirf sidebar me)
════════════════════════════════════════════════════════
Mukhya Location Selector par KOI asar nahi. Bilkul alag feature.

  Sidebar me item "Compare".
  Ek star chuno (State/District/Block/Village), phir us star ki 2 se
  6 jagah chuno -- search ke saath (733 zile me dhoondhna aasan ho).
  Har jagah ka apna rang, wahi rang table aur chart me bhi.

  MAP: saari chuni jagah ek saath highlight, apne rang me, label ke
  saath. Map apne aap zoom ho ki sab dikh jayein.

  TABLE (FAOSTAT / UNDP HDR jaisa): row = jagah, column = index
    Heatwave days, SPI, Rainfall, Rx1day, NDVI, Population,
    Net area sown, Irrigated area
    Har column par sort. Sabse ooncha/neecha halka highlight.
    Data na ho to "Data not available" -- khali ya zero nahi, aur
    aurat me mat gino. Har column ke neeche source aur saal.
    Saal ka slider (2000-2024), table saath me badle.

  CHART: grouped bar (saal ke hisaab se) + line chart (samay ke
  hisaab se, har jagah ki apni line apne rang me).

  NIKALO: table -> CSV/XLSX, chart -> PNG, map -> PNG.
  Har file me source, tareekh, "Survey of India / IMD" ka shreya.

  MOBILE: table ko horizontal scroll me mat daalo -- har jagah ka ek
  card, ek ke neeche ek. Mobile par 3 se zyada jagah nahi.

════════════════════════════════════════════════════════
PHASE E -- KISAN SAHAYAK (chatbot ka baaki hissa)
════════════════════════════════════════════════════════
Naam ho chuka hai. Ab ye:

E1. PEHLA POPUP (pehli baar kholne par)
    Sheersh: "नमस्ते, मैं किसान सहायक हूँ" /
             "Namaste, I am Kisan Sahayak"
    Ek line: "अपने गाँव की खेती, मौसम, फ़सल या मंडी भाव से जुड़ा
             कोई भी सवाल पूछिए।"
    Chaar chip (dabate hi sawal jaye) -- hardcode NAHI, chuni jagah
    aur mausam ke hisaab se banao:
      "इस साल बारिश कैसी रही?"
      "मेरे गाँव में कौन सी फ़सल ठीक रहेगी?"
      "आज मंडी में भाव क्या है?"
      "सूखे का ख़तरा कितना है?"
    Neeche: "जवाब IMD, Survey of India और AGMARKNET के असली आँकड़ों
    से। जहाँ आँकड़ा नहीं है, वहाँ साफ़ बता दिया जाएगा।"
    Popup ek hi baar (localStorage), phir chhota button.
    Mobile par neeche se aaye, poori screen na dhake.

E2. JAWAB KA NIYAM
    - Chuni hui jagah ke hisaab se -- chaaron star ka data fetch kare
    - Fasal ke hisaab se
    - Har jawab ke saath source aur tareekh
    - Data na ho to "इस जगह का आँकड़ा अभी उपलब्ध नहीं है" -- paas
      wale gaon ka maan KABHI nahi
    - Jis bhasha me sawal, usi me jawab
    - Saral bhasha -- kisan ke liye, vaigyanik ke liye nahi

E3. RESEARCH PAPERS -- in free API se jodo:
    OpenAlex, Semantic Scholar, CORE, CrossRef, DOAJ, PubMed/PMC,
    FAO AGRIS, ICAR KRISHI
    Kisan koi bhi agriculture sawal poochhe -- fasal, keet, mitti,
    paani, mausam, bazaar -- jawab in papers se bhi mile, saath me
    title, lekhak, saal, link.
    Sci-Hub kabhi nahi -- pirated hai, kanooni khatra hai.

════════════════════════════════════════════════════════
PHASE F -- DATA FATCH KARTE RAHO (saath-saath chalta rahe)
════════════════════════════════════════════════════════
Ye UI ke kaam ke SAATH chalta rahe, ruk kar nahi.

F1. CLIMATE -- abhi 145 district JSON bane hain, 733 me se
    08_gee_national_climate.py rajya-dar-rajya chalate raho,
    --resume ke saath. Har rajya ke baad commit + push.
    Har 10 zile par progress batao.
    NIGHT_LOG.md me har rajya: samay, size, zile, gaon, kya chhoota.
    Jis gaon ka pixel na mile -> "data not available". Paas wale
    gaon ka maan KABHI nahi.
    Har file me metadata: source (ERA5-Land/CHIRPS via GEE, IMD
    NAHI), method, baseline, count, date.
    GEE ka EECU quota khatam hone lage to RUKO aur batao.

F2. CHAARON STAR PAR AGGREGATE
    Village -> Block -> District -> State
    Har aggregate ke saath: kitne units se bana + standard deviation.
    Sirf mean mat dikhao.

F3. VALIDATION -- CHIRPS aur ERA5 ko IMD ki JAANCH ke liye
    Har zile ke liye: dono ka maan, correlation, bias.
    Alag file: data/validation/<state>/<district>.json
    Portal me alag panel. Observed, projected aur validation --
    teeno ALAG, kabhi mila kar nahi.

F4. GOVERNMENT SOURCE SE MILAAN
    Climate -> IMD (MoES)            Mandi -> AGMARKNET/data.gov.in
    Crop -> MoA&FW                   Soil -> SHC, NBSS&LUP, ICAR
    Groundwater -> CGWB, India-WRIS  Boundaries -> Survey of India, LGD
    Census -> Census of India        Forest -> FSI
    Satellite -> Bhuvan/NRSC, GEE
    Farak mile to farak LIKHO. docs/DATA_SOURCES.md me har file ka
    source, date, licence, CRS, update frequency, checksum.

F5. SIDEBAR ke jo item kaam nahi karte (Soil Moisture, Groundwater)
    -- unhe asli data se jodo, ya "coming soon" batao. Toota hua
    mat dikhao.

════════════════════════════════════════════════════════
PHASE G -- METHODOLOGY (research papers)
════════════════════════════════════════════════════════
Free API: OpenAlex, Semantic Scholar, CrossRef, CORE, NASA ADS.

Vishay (peer-reviewed, high-impact only):
  - NEX-GDDP-CMIP6 downscaling (NASA) -- dataset ka apna paper
  - Bias correction: quantile mapping / delta change -- India ke
    monsoon ke liye kaunsa theek hai
  - ETCCDI extreme indices ki manak paribhasha
  - SPI ki ganana aur zero-inflated gamma sudhaar
  - ERA5-Land aur CHIRPS ki India ke liye validation studies
  - Heatwave definition -- IMD ka aur international ka farak
  - IPCC AR6 WG1 Ch.11 (extremes) -- projection dikhane ka tarika
  - Village-level downscaling ki seemaa

Patrikaayein: Nature Climate Change, Journal of Climate, Climate
Dynamics, ERL, IJoC, Theoretical and Applied Climatology, Current
Science, MAUSAM (IMD), Copernicus open journals (ESD, HESS, NHESS).

Likho aur commit karo:
  docs/references/           -- har paper ki BibTeX + PDF link
  docs/METHODOLOGY_REVIEW.md -- har method ke liye: kaunsa tarika
    chuna, KYUN, kis paper ke aadhar par, uski seemaa, kis paper ne
    alag raay di

Agar pata chale ki hamari mojooda method me kuch galat ya purana
hai -- RUKO aur batao. Chupchap mat badlo, aur galat jaan kar
chalne bhi mat do.

════════════════════════════════════════════════════════
PHASE H -- STORAGE (jab data bada ho jaye)
════════════════════════════════════════════════════════

H1. NAAPO -- asli number do, anuman nahi
    a. dashboard/data/ ka kul size, har sub-folder alag
    b. sabse badi 10 files
    c. gzip ke baad ka size (Pages gzip bhejta hai)
    d. ek visitor jo EK gaon dekhta hai wo kitna MB kheenchta hai

H2. Agar H1(d) 20 MB se zyada aaye -> PMTiles ka vikalp naapkar
    batao. Kaam rokna mat.

H3. Agar repo 1 GB ke paas pahunche:
    "vindhya-climate-data" PUBLIC repo banao, Pages chalu karo.
    Sirf data, koi code nahi.
    PEHLE ek chhoti test.geojson se CORS/fetch test karo aur
    screenshot do. Paas ho tabhi baaki bhejo.
    config/data_config.json me ek hi DATA_BASE_URL. Har loader wahi
    padhega, URL kahin aur hardcode nahi.
    Git LFS KABHI nahi. Har file 100 MB se kam.

H4. Pages ki bandwidth 100 GB/mahina hai. Paar hone lage to RUKO
    aur Cloudflare R2 / GCS / S3 ka vikalp do -- wahi
    DATA_BASE_URL abstraction rakhte hue.

════════════════════════════════════════════════════════
NIYAM -- sab par lagu
════════════════════════════════════════════════════════
- Layout aur panel ki jagah WAHI rahegi
- Portal LIGHT hai aur light hi rahega
- Koi banaya hua aankda nahi -- har number asli file se gina jayega
- Observed, projected aur validation kabhi mila kar mat dikhao
- Jahan data nahi: "data not available" + kyun
- Har phase ke baad commit + push
- Har item ke saamne: HUA / NAHI KIYA / kyun nahi

════════════════════════════════════════════════════════
AAKHIR ME -- LIVE site par KHUD khol kar screenshot do
════════════════════════════════════════════════════════
  - Landing (dono slide), photo saaf dikhti hui
  - Dashboard: paanchon basemap par
  - Chaudai: 1512px, 820px, 390px, 320px
  - Simrol (Mhow, Indore) -- pin peele polygon ke ANDAR
  - Kisi doosre rajya ka gaon (Tamil Nadu ya Assam)
  - Compare table (4 zile)
  - Export ki hui PNG
  - Kisan Sahayak ka popup
