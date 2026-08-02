Jo abhi chal raha hai (landing page ke teen-tier stats) use PEHLE poora
karo. Uske baad ye poori suchi, kram se, upar se neeche. Beech me mat
poochho -- sirf asli gadbad par ruko. Har item ke saamne likho:
HUA / NAHI HUA / kyun nahi.

════════════════════════════════════════════════════════
PHASE 1 -- SACH (sabse zaroori, pehle yahi)
════════════════════════════════════════════════════════

1.1  LANDING KE AANKDE -- teen alag section, teeno alag label ke saath
     BOUNDARY COVERAGE (poora desh, ready)
       36 States/UTs, 733 Districts, 6,312 Blocks, 654,285 Villages
       Label: "Administrative boundaries -- Survey of India"
     OBSERVED CLIMATE (abhi kam zile)
       "N of 733 districts with IMD climate indices", 2000-2024
       Label: "IMD observed climate indices -- national run in progress"
       2025 abhi repo me NAHI hai. IMD ka 2025 NetCDF maujood hai to
       jodo, warna 2024 hi rakho -- anuman se saal mat badhao.
     PROJECTED CLIMATE (2050 tak)
       Label: "CMIP6 projection -- NOT observed data"
       Alag rang, alag label. Observed ke saath kabhi mila kar nahi.
       Model ensemble, SSP scenario (SSP2-4.5 aur SSP5-8.5 dono),
       baseline period aur uncertainty range hamesha saath dikhao.
       Akela number kabhi nahi -- hamesha range ke saath.
     Har aankda ASLI FILE SE GINO, code me kabhi likho mat.
     "N of 733" national run ke saath apne aap badhna chahiye.

1.2  COUNT-UP ANIMATION HATAO
     Abhi landing par gintee ki animation lagi hai. Pehle 5 second tak
     page GALAT number dikhata hai (1 District, 130,857 villages,
     5 years, 1 source). Koi screenshot le le to galat aankda uske paas
     chala jayega. Pehle frame se asli number dikhao.
     Header ka ghoomta "alerts" ticker bhi hatao -- adhoora shabd
     ("lerts") dikh raha tha.

1.2b TURANT THEEK KARO (2026-08-03 ko live code me mile)
     - "Verified Sources" ka div DO BAAR hai -- ek bina id ke
       (data-target="6"), doosra id="hero-stat-sources" ke saath.
       Page par do baar dikhega. Duplicate hatao, id wala rakho.
     - data-target="25" aur data-target="6" -- yahi count-up
       animation ka tarika hai. Attribute aur animation dono hatao.
     - "Years of Record" bhi file se gino (climate JSON me jitne saal
       hain), HTML me 25 mat likho.

1.3  GADHE HUE AANKDE HATAO
     "AI accuracy 94.2%" abhi bhi code me hai.
     Dashboard ka "Data Coverage: 5 districts" -- file se gino.
     Header ka "ERA5" -- wo source DATA_SOURCES.md me hai hi nahi.

1.4  PANEL AUDIT -- har panel, har layer ek-ek karke
     Data kis file se aa raha, wo file kis asli source se bani, panel
     ke label se match karta ya nahi, satellite data sach me GEE se
     aaya ya hardcode. Mismatch theek karo, jo trace na ho hatao.
     Table me report do: panel, file, asli source, verdict.

1.5  GOVERNMENT SOURCE SE MILAAN
     Climate -> IMD (MoES)            Mandi -> AGMARKNET/data.gov.in
     Crop -> MoA&FW                   Soil -> SHC, NBSS&LUP, ICAR
     Groundwater -> CGWB, India-WRIS  Boundaries -> Survey of India, LGD
     Census -> Census of India        Forest -> FSI
     Satellite -> Bhuvan/NRSC, GEE
     Farak mile to farak LIKHO. Sab GitHub me commit karo -- har file
     ke saath source, date, licence, checksum -- taaki repo khud data
     source ki tarah kaam kare.

1.6  MISSING DATA KA NIYAM
     Jahan data nahi: "Climate data not yet available for <naam>".
     Paas wale gaon/zile ka maan KABHI nahi. Khali dash bhi nahi.

════════════════════════════════════════════════════════
PHASE 2 -- DIKHAWAT (professional, attractive)
════════════════════════════════════════════════════════
Benchmark: Global Forest Watch, Copernicus Climate Data Store, NASA
Earthdata, Bhuvan. Sundar bhi, vaigyanik bhi. Neon/gradient wala
dashboard-template look NAHI. LAYOUT aur panel ki jagah WAHI rahegi.

2.1  AI KA DIKHAWA POORI TARAH HATAO
     Tab title "AI-Powered", "AI Advisory", "AI chatbot",
     "AI Forecasting" -- sab. Kaam ka naam do, tool ka nahi.

2.2  EMOJI
     45 emoji abhi bhi code me hain -- SAB hatao.
     Lucide ka ek hi set, 16/20px, stroke 1.5, currentColor.
     Rocket, brain, satellite, cartoon tractor -- ye khilaune jaise
     hain, hatao.

2.3  FONT -- ek family, SELF-HOSTED (CDN nahi)
     Inter ya IBM Plex Sans. Abhi system default hai, Windows par
     bilkul alag dikhega.
     Desktop scale: 11/13/15/20/28/36 px
     Mobile scale:  12/14/16/20/24/28 px
     Abhi 28 alag font-size hain -- 6 ka scale banao.
     Number ke liye tabular figures. Heading 600 weight,
     letter-spacing 0. ALL-CAPS sirf chhote label par.
     Subtitle aur button se bhaari letter-spacing hatao.

2.4  RANG -- CSS variables me, ek hi jagah
     Background #0F1621  Panel #18212E  Border #2A3646
     Text #E8EDF4  Text gaun #94A3B4  Accent #2D8F5C
     Khatra ke rang sirf data ke liye:
       extreme #B02418  high #D9822B  moderate #E0B84C  low #3E9C5A
     Gradient, neon, glow, chamakdaar shadow -- sab hatao.
     Contrast WCAG AA (4.5:1) se kam kabhi nahi.

2.5  SPACING -- 4px grid: 4/8/12/16/24/32/48. Iske bahar kuch nahi.

2.6  CSS -- 199 inline style="" abhi bhi hain. Sab variables me lao.
     Ek jagah badlo, poore portal me badle.

2.7  CARD -- sab ek shakal ke: radius 6px, border 1px, shadow nahi
     label (chhota, gaun) -> VALUE (bada, tabular) + unit -> trend
     -> "Source: IMD, 2024-08"

2.8  CHART -- Chart.js ka default look hatao
     Halki horizontal grid, vertical grid nahi. Line 2px, point sirf
     hover par. Axis par unit. Neeche source aur date.

2.9  HEADER -- portal ka naam + SoI/IMD ka shreya, breadcrumb,
     "Last updated" EK jagah. Abhi do ghadi chal rahi hain.

2.10 OVERLAP THEEK KARO (dashboard par)
     - North arrow "Location Selector" ke akshar dhak raha hai
     - Scale bar Risk Legend ke upar
     - Chatbot bubble "Data sources" button ke upar
     - Map ke neeche bayen taraf ka bada khali safed hissa

2.11 STATE -- teeno banao
     loading (skeleton, khali panel nahi) -- abhi 5 second safed page
     empty ("Is jagah ka data abhi nahi hai" + kyun)
     error (kya hua + retry button)
     Dashboard khulte hi har card "Select a district" -- iske bajaye
     poore desh ka summary dikhao.
     Jo sidebar item kaam nahi karte (Soil Moisture, Groundwater) --
     "coming soon" batao ya hatao. Toota hua mat dikhao.

2.12 LANDING BACKGROUND -- DO SLIDE, bas do
     Hatao: bikhre hare bindu (particles), halki grid line, abhi wali
     dhundhli photo. Ye teeno "AI ne banaya" wala look dete hain.
     Do slide, 8 second par badle, halka fade (zoom/slide animation
     nahi):
       Slide 1 -- asli Indian kisan khet me
       Slide 2 -- precision farming / drone-satellite se khet, ya
                  Bharat ka satellite map + SoI boundaries
     Har slide par: poori chaudai object-fit cover, upar gehra scrim
     linear-gradient(rgba(15,22,33,0.55), rgba(15,22,33,0.85)),
     neeche dayen kone me "Photo: <source>, <licence>".
     Text safed (#FFFFFF), teal nahi.
     PHOTO KAHAN SE -- licence saaf ho:
       PIB Photo Gallery (pib.gov.in), ICAR gallery, Unsplash/Pexels,
       ya apni kheenchi field photo (sabse accha).
       Google image search se uthai photo KABHI nahi -- sarkari portal
       par kanooni dikkat hai.
     Photo 1920px, WebP, 300KB se kam.
     Neeche do chhote dot. Hover/touch par rotate ruke.
     "reduced motion" wale browser me rotate band, sirf pehli slide.
     Slider 5 nahi, DO hi.

2.13 DHANCHA -- sab beech me hai, brochure jaisa lagta hai.
     Grid par lao: heading bayen, aankde ek row me separator ke saath,
     button ek jagah.

2.14 SARKARI PEHCHAN -- abhi poori tarah gayab hai
     Neeche patti me:
       "Boundaries: Survey of India | Climate: India Meteorological
        Department | Projections: NEX-GDDP-CMIP6 | Market: AGMARKNET,
        data.gov.in"
       "Last updated: <asli date, file se>"
       "Indicative, not for legal or cadastral use"
     Yahi portal ko sarkari star deta hai, animation nahi.

════════════════════════════════════════════════════════
PHASE 3 -- LAPTOP + TABLET + MOBILE
════════════════════════════════════════════════════════

DESKTOP (1024px+)
  Sidebar khula 220px, map beech me, metrics dayen, card 2-3 column.
  Map control ek hi shakal ke panel me, overlap nahi.

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
  Chatbot chhota kone ka button, box nahi
  Neeche sticky bar: chuni jagah ka naam + "Change"
  Text 14px se chhota nahi
  Horizontal scroll KABHI nahi -- 320px par bhi nahi

════════════════════════════════════════════════════════
PHASE 4 -- BASEMAP + IMAGE EXPORT
════════════════════════════════════════════════════════

4.1  BASEMAP SWITCHER (map ke kone me) -- paanch, aur koi nahi
     Satellite (Esri World Imagery), Street (OSM), Terrain
     (OpenTopoMap), Light (Carto Positron), Dark (Carto Dark Matter).
     Har ek ka attribution dikhe.

4.2  BOUNDARY KA RANG APNE AAP BADLE -- sabse zaroori hissa
     Gehre basemap (Satellite/Dark/Terrain) -- abhi wali casing:
       kaala underlay weight+3 opacity 0.6, upar chamakdaar line
       State #FF9500 w4, District #00E5FF w3, Block #FF3DFF w2.5,
       Village #C6FF00 w2
     Halke basemap (Street/Light) -- ULAT karo:
       safed underlay, upar gehri line
       State #B45309 w4, District #0E7490 w3, Block #A21CAF w2.5,
       Village #4D7C0F w2
     Basemap badalte hi rang apne aap badle. Har basemap par khud
     screenshot lekar dikhao ki chaaron star saaf dikh rahe hain.

4.3  EXPORT AS PNG
     Map ke kone me "Export image". Nikli image me ho:
     basemap + saari dikhti boundary, legend, scale bar, north arrow,
     chuni jagah ka poora naam (India > State > District > Block >
     Village), "Source: Survey of India, IMD" + tareekh, portal ka naam.
     Kam se kam 2000px chaudai (2x/3x) -- research paper ke layak.
     "Copy to clipboard" bhi. Mobile par gallery me save ho.

════════════════════════════════════════════════════════
PHASE 5 -- MULTI-SELECT COMPARE (sirf sidebar me)
════════════════════════════════════════════════════════
Mukhya Location Selector par KOI asar nahi. Bilkul alag feature.

  Sidebar me item "Compare".
  Ek star chuno (State/District/Block/Village), phir us star ki 2 se 6
  jagah chuno -- search ke saath (733 zile me dhoondhna aasan ho).
  Har jagah ka apna rang, wahi rang table aur chart me bhi.

  MAP: saari chuni jagah ek saath highlight, apne rang me, label ke
  saath. Map apne aap zoom ho ki sab dikh jayein. Kisi par click ->
  uske number dikhein.

  TABLE (FAOSTAT / UNDP HDR jaisa): row = jagah, column = index
    Heatwave days, SPI, Rainfall, Rx1day, NDVI, Population,
    Net area sown, Irrigated area
    Har column par sort. Sabse ooncha/neecha halka highlight.
    Data na ho to "Data not available" -- khali ya zero nahi, aur
    aurat me mat gino. Har column ke neeche source aur saal.
    Saal ka slider (2000-2024), table saath me badle.

  CHART: grouped bar (saal ke hisaab se) + line chart (samay ke hisaab
  se, har jagah ki apni line apne rang me).

  NIKALO: table -> CSV/XLSX, chart -> PNG, map -> PNG.
  Har file me source, tareekh, "Survey of India / IMD" ka shreya.

  MOBILE: table ko horizontal scroll me mat daalo -- har jagah ka ek
  card, ek ke neeche ek. Mobile par 3 se zyada jagah nahi.

════════════════════════════════════════════════════════
PHASE 6 -- KISAN SAHAYAK (chatbot)
════════════════════════════════════════════════════════

6.1  NAAM
     "AI chatbot" hatao. Naam: "किसान सहायक / Kisan Sahayak"
     Icon: robot NAHI. Lucide "message-circle" ya "sprout", 20px,
     stroke 1.5, accent rang.

6.2  PEHLA POPUP (pehli baar kholne par)
     Sheersh: "नमस्ते, मैं किसान सहायक हूँ" /
              "Namaste, I am Kisan Sahayak"
     Ek line: "अपने गाँव की खेती, मौसम, फ़सल या मंडी भाव से जुड़ा कोई भी
              सवाल पूछिए।" / "Ask anything about your village --
              weather, crops, soil, irrigation or mandi prices."
     Chaar chip (dabate hi sawal jaye) -- hardcode NAHI, chuni jagah
     aur mausam ke hisaab se banao:
       "इस साल बारिश कैसी रही?"
       "मेरे गाँव में कौन सी फ़सल ठीक रहेगी?"
       "आज मंडी में भाव क्या है?"
       "सूखे का ख़तरा कितना है?"
     Sabse neeche: "जवाब IMD, Survey of India और AGMARKNET के असली
     आँकड़ों से। जहाँ आँकड़ा नहीं है, वहाँ साफ़ बता दिया जाएगा।"
     Popup ek hi baar dikhe (localStorage), phir chhota button.
     Mobile par neeche se aaye, poori screen na dhake.

6.3  JAWAB KA NIYAM
     - Chuni hui jagah ke hisaab se -- state, district, block, village
       chaaron star ka data fetch kare
     - Fasal ke hisaab se
     - Har jawab ke saath source aur tareekh
     - Data na ho to "इस जगह का आँकड़ा अभी उपलब्ध नहीं है" -- paas wale
       gaon ka maan KABHI nahi
     - Jis bhasha me sawal, usi me jawab (Hindi/English)
     - Saral bhasha -- kisan ke liye, vaigyanik ke liye nahi

6.4  RESEARCH PAPERS SE JAWAB -- in free API se jodo:
     OpenAlex, Semantic Scholar, CORE, CrossRef, DOAJ, PubMed/PMC,
     FAO AGRIS, ICAR KRISHI
     Kisan koi bhi agriculture sawal poochhe -- fasal, keet, mitti,
     paani, mausam, bazaar -- jawab in papers se bhi mile, saath me
     title, lekhak, saal, link.
     Sci-Hub kabhi nahi -- pirated hai, sarkari portal par kanooni
     khatra hai.

════════════════════════════════════════════════════════
PHASE 7 -- METHODOLOGY (research papers padho, phir likho)
════════════════════════════════════════════════════════
Free API: OpenAlex, Semantic Scholar, CrossRef, CORE, NASA ADS.

Vishay (peer-reviewed, high-impact only):
  - NEX-GDDP-CMIP6 downscaling (NASA) -- dataset ka apna paper
  - Bias correction: quantile mapping / delta change -- India ke
    monsoon ke liye kaunsa theek hai
  - ETCCDI extreme indices ki manak paribhasha
  - SPI ki ganana aur zero-inflated gamma sudhaar
  - IMD gridded data ki validation studies
  - Heatwave definition -- IMD ka aur international ka farak
  - IPCC AR6 WG1 Ch.11 (extremes) -- projection dikhane ka tarika
  - Village-level downscaling ki seemaa

Patrikaayein: Nature Climate Change, Journal of Climate, Climate
Dynamics, ERL, IJoC, Theoretical and Applied Climatology, Current
Science, MAUSAM (IMD), Copernicus open journals (ESD, HESS, NHESS).

Likho aur commit karo:
  docs/references/           -- har paper ki BibTeX + PDF link
  docs/METHODOLOGY_REVIEW.md -- har method ke liye: kaunsa tarika
    chuna, KYUN, kis paper ke aadhar par, uski seemaa, aur kis paper
    ne alag raay di

Agar padhne ke baad pata chale ki hamari mojooda method (SPI, ETCCDI,
heatwave) me kuch galat ya purana hai -- RUKO aur batao. Chupchap mat
badlo, aur galat jaan kar chalne bhi mat do.

════════════════════════════════════════════════════════
PHASE 8 -- STORAGE (national run se PEHLE)
════════════════════════════════════════════════════════

8.1  NAAPO (upload se pehle, asli number do, anuman nahi)
     a. dashboard/data/ ka kul size, har sub-folder alag
     b. sabse badi 10 files aur size
     c. gzip ke baad ka size (Pages gzip bhejta hai -- asli transfer)
     d. ek visitor jo EK gaon dekhta hai wo kitna MB kheenchta hai

8.2  ALAG PUBLIC REPO
     "vindhya-climate-data" banao, Pages chalu karo. Sirf data, koi
     code nahi. Structure: states/ districts/ blocks/ villages/
     metadata/ indexes/

8.3  EK FILE SE TEST -- aage mat badho jab tak paas na ho
     Ek chhoti test.geojson upload karo, portal se sirf usi ko fetch
     karo. Verify karke SCREENSHOT do: HTTPS, CORS, Pages 200,
     browser fetch(), map render.
     Fail ho to RUKO. Paas ho to bina poochhe aage.

8.4  EK HI BASE URL
     config/data_config.json me sirf:
       { "DATA_BASE_URL":
         "https://vindhyaresearch25-a11y.github.io/vindhya-climate-data/" }
     Har loader yahi padhega. URL kahin aur hardcode NAHI.
     Kal R2 par jaana pade to ek line badle, 50 nahi.

8.5  FILE SIZE -- Git LFS KABHI nahi (Pages LFS serve hi nahi karta).
     Har file 100 MB se kam, badi ho to apne aap split.

8.6  METADATA -- har dataset me: source, version, crs, resolution,
     created, updated, license, checksum, data_quality

8.7  DOCUMENTATION -- docs/DATA_SOURCES.md me har dataset ka source,
     download date, licence, CRS, update frequency, kis repo me hai

8.8  BANDWIDTH -- Pages ki asli seemaa 100 GB/mahina hai, storage nahi
     Agar 8.1(d) ka jawab 20 MB prati visitor se zyada aaye, to PMTiles
     ka vikalp naapkar batao (visitor sirf dikhta hissa kheenchta hai,
     poora desh nahi). Kaam rokna mat, aage chalte raho.

8.9  AAGE KA RASTA -- data itna bada ho jaye ki Pages theek se na de
     paye, to Pages ko storage ki tarah istemal BAND karo. Cloudflare
     R2 / GCS / S3 par jao, wahi DATA_BASE_URL abstraction rakhte hue.
     Portal ka code ek line se zyada nahi badalna chahiye.
     Faisla mat lo -- naapo, vikalp do, poochho.

════════════════════════════════════════════════════════
PHASE 9 -- POORE DESH KA IMD (sabse aakhir me, ~25 ghante)
════════════════════════════════════════════════════════
Saare 36 State/UT, 733 District, saare Block, saare Village.

Shuru karne se PEHLE: scripts/config.py ke env path par asli IMD
NetCDF (2000-2024) maujood hai ya nahi jaancho. Nahi hai to RUKO aur
batao kya chahiye. Koi maan anuman se mat bharo.

CHAARON STAR
  Village  -> apne IMD pixel se (docs/METHODOLOGY.md wali methodology)
  Block    -> uske gaon ka aggregate
  District -> uske block ka aggregate
  State    -> uske zilon ka aggregate
  Har aggregate ke saath: kitne units se bana + standard deviation.
  Sirf mean mat dikhao.

ARCHITECTURE
  Rajya-dar-rajya streaming, resume-able, progress file me likho.
  Output: data/climate/<state>/<district>.json -- ek badi file kabhi
  nahi. Har file me poora metadata block.

KRAM
  Pehle poora Madhya Pradesh (~1.8 ghante). Poora hote hi NIGHT_LOG.md
  me likho: asli samay, kul size, GEE ka EECU kharch, aur 733 zilon ka
  SUDHRA HUA anuman. Phir BINA POOCHHE baaki 35 rajya.

NIYAM
  - Jis gaon ka IMD pixel na mile -> "data not available". Paas wale
    gaon ka maan KABHI nahi.
  - Har rajya ke baad commit + push.
  - Har 10 zile par progress.
  - EECU quota ya storage seemaa paas aaye to RUKO aur vikalp do.
  - NIGHT_LOG.md me har rajya: samay, size, gaon ki sankhya, kya chhoota.

════════════════════════════════════════════════════════
NIYAM -- sab par lagu
════════════════════════════════════════════════════════
- Layout aur panel ki jagah WAHI rahegi
- Koi banaya hua aankda nahi -- har number asli file se gina jayega
- Observed aur projected kabhi mila kar mat dikhao
- Har phase ke baad commit + push
- Har item ke saamne likho: HUA / NAHI KIYA / kyun nahi

════════════════════════════════════════════════════════
AAKHIR ME -- LIVE site par KHUD khol kar screenshot do
════════════════════════════════════════════════════════
  - Landing (dono slide)
  - Dashboard: paanchon basemap par
  - Chaudai: 1512px, 820px, 390px, 320px
  - Simrol (Mhow, Indore) -- pin peele polygon ke ANDAR
  - Kisi doosre rajya ka gaon (Tamil Nadu ya Assam)
  - Compare table (4 zile)
  - Export ki hui PNG
  - Kisan Sahayak ka popup
Sab par pehle-baad dono.
