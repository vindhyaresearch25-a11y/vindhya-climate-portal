# LIVE AUDIT -- 4 kaam (2026-08-14)

Maine khud live portal khol kar jaancha (Claude Code ke self-report par
bharosa nahi kiya). Char dikkatein mili. Kram se karo. Har item ke
saamne: **HUA / NAHI KIYA / kyun nahi**

---

# 1. DOHRAV -- sidebar aur neeche ki patti me EK HI cheez das jagah

Sidebar me 19 item, neeche ki patti me 27. Ye das naam **dono jagah**
hain:

| Neeche ki patti | Sidebar |
|---|---|
| Rainfall | Rainfall Monitor |
| Drought | Drought |
| Forest | Forest Monitor |
| PMFBY | PMFBY Insurance |
| Cadastral | Cadastral Map |
| Live Weather | Live Weather |
| Compare | Compare |
| Soil Moisture | Soil Moisture |
| Advisory | Farmer Advisory |
| Mera Khet | Mera Khet |

**Pehle jaancho:** in das jodiyon me se har ek me neeche ki patti wala
tab aur sidebar wala item **sach me alag content dikhate hain ya wahi
cheez dobara khulti hai** -- click karke dono khol kar compare karo,
list banao.

**Faisla (niyam tay karo, dono taraf mat rakho):**
- SIDEBAR = navigation -- kaunsa vishay dekhna hai
- NEECHE KI PATTI = us vishay ke andar alag-alag view/chart
- Ek hi naam **kabhi dono jagah nahi**. Jo sach me duplicate content
  hai use neeche ki patti se hatao, sirf sidebar rehne do.
- Agar kisi jodi me sach me alag content hai, to naam badlo taaki
  confusion na ho (jaise "Drought" aur "Drought" -- naam hi ek jaisa
  hai, ye sabse zyada confusing hai)

---

# 2. "Max zoom 218" -- naksha ke kone me galat likha hai

218 koi zoom star nahi hota (Leaflet me adhiktam 22 hota hai). Kahin
calculation ya string concatenation ki galti hai (`maxNativeZoom` +
kuch aur jud gaya lagta hai). Dhoondo aur theek karo.

---

# 3. GRID LINES -- Bharat ke naksha par safed rekhaayein

Upgrah chitra (satellite) par safed khadi-padi rekhaayein dikh rahi
hain jo nahi honi chahiye. Ye kya hai jaanch karo:
- Kisi CSS grid/border ki galti hai basemap tile container par, YA
- Koi graticule/lat-lon layer galti se ON hai

Jo bhi ho, hatao. Screenshot se confirm karo ki upgrah chitra saaf hai.

---

# 4. KHALI JAGAH -- naksha ke neeche bayen taraf

Bada safed/khali hissa dikh raha hai, kuch load nahi ho raha ya layout
me gap hai. Jaancho kya wahan kuch dikhna chahiye tha (panel load
nahi hua?) ya layout hi galat hai -- dono surat me theek karo.

---

# 5. CLIMATE PANEL SELECT KARNE PAR -- SIDE PANEL saaf aur professional

Sidebar me "Climate" click karne par jo side panel khulta hai wo abhi
professional nahi lag raha. Theek karo:
- Panel khulte hi **saaf structure** ho -- upar heading, phir metric
  card grid (2-3 column), neeche source/resolution/saal line
- Koi overlapping text/card nahi, koi cut-off content nahi
- Card design UI_FIX_PROMPT.md item 6 wale niyam se (radius 8px,
  border 1px, shadow nahi, spacing 4px grid) -- **isi niyam ko har
  panel me consistently lagao**, sirf climate me nahi
- District/village select karne par panel turant naye data se bhare,
  purana data screen par na reh jaye (STANDING ORDERS item 2 -- stale
  data kabhi na dikhe)

**Test:** Jabalpur chuno, screenshot do. Rewa chuno, screenshot do.
Dono me data sahi badla, layout ek jaisa saaf hona chahiye.

---

# 6. NEECHE KA PANEL LAYOUT -- overlapping band karo

Neeche ki patti (bottom panel) me jab bhi koi tab click ho ya data
maanga jaye:
- Chart/table apni jagah me poora fit ho, kisi aur element ke upar
  na chadhe (overlap)
- Loading state ho jab data aa raha ho (khali/tuta hua na dikhe)
- Data na ho to STANDING ORDERS item 6/7 ke mutabik saaf "abhi
  uplabdh nahi" likho -- kabhi khali ya toota hua panel na chhodo
- Chart resize ho window/mobile ke hisaab se, content bahar na nikle

**Ek-ek bottom tab kholkar screenshot do** ki overlap kahin nahi hai.

---

# 7. NEECHE KI TAB-LIST -- scroll wali patli list, bagal khali

Screenshot me dikha: neeche ki tab-list (Rainfall, Temperature,
Drought, Trends, NDVI Trend, 7-Day Forecast, GEE Workflow...) ek
patli column me hai jisme **scroll karna padta hai**, aur uske
**bagal me poori jagah khali (safed) padi hai**. Ye amateur lagta hai.

**Theek karo -- do hisson me:**

### 7a. List ka layout
- Patli scroll-wali column mat rakho. Ya to:
  - Grid/tabular form me saari tab ek saath dikhao (2-3 column ki
    tile grid, icon + naam), taaki scroll na karna pade, YA
  - List column ko chhota rakhna hai to bagal ki khali jagah me
    **default selected tab ka content turant dikhao** (jaise page
    khulte hi "Rainfall" pehle se select ho aur uska chart bagal me
    dikhe) -- kabhi khali safed jagah na chhode
- Har row me icon + naam ke sath ek chhota preview (mini-sparkline
  ya current value) bhi ho sake to aur professional lagega

### 7b. Click/select karne par -- GRAPHICAL, sirf text nahi
Abhi jo dikh raha hai wo simple/samjhaa hua text-jaisa lagta hai. Har
tab select karne par bagal ke panel me **advanced graphical view**
chahiye, jaise:
- Line/area chart -- trend over time (Chart.js already portal me hai,
  isi ko poori tarah istemal karo)
- Bar chart -- saal-dar-saal ya mahine-dar-mahine tulna
- Forecast wali tabs (7-Day Forecast, Trends) me: line chart with
  confidence band ya kam se kam clear upar-neeche trend arrow
- NDVI Trend: time-series chart + chhota naksha (spatial), sirf
  number ki list nahi
- Har chart ke sath: axis label, legend, hover-par-tooltip (exact
  value + tareekh), aur neeche `source · resolution · saal` line
- Chart ke upar ek-line headline insight (jaise "पिछले 10 साल में
  15% ज़्यादा" ) -- lekin ye bhi label-style, lamba paragraph nahi
  (UI_FIX_PROMPT.md item 2 ka niyam yahan bhi lagu hai)

**Maqsad:** kisi bhi tab par click karte hi ek sarkari/professional
analytics-dashboard jaisa graphical panel khule -- chart/graph/trend
pehle, text sabse kam.

**Test:** har tab ek-ek karke click karo, screenshot do -- graph/chart
dikhna chahiye, khali safed jagah kahin nahi honi chahiye.

---

# 8. ZILA CHUNE BINA -- poora page khali, naksha bhi chhota

Screenshot me dikha: "Mandi Prices" tab click kiya, upar tab-grid
theek dikh rahi hai, par neeche sirf ek line "Select a district"
likha hai aur **poora bacha hua page khali safed** hai. Isi tarah
naksha bhi pehle se **chhota** ho gaya hai.

**Theek karo:**
- Zila na chune hone par bhi panel **khali na lage** -- ya to:
  - Poore desh/rajya ka **default/aggregate view** dikhao (jaise
    "rajya-star ka auusat" ya "sabse zyada/kam wale 5 zile" ki chhoti
    tabel/chart), YA
  - Ek **compact, centered** prompt dikhao ("ऊपर से या नक़्शे पर
    ज़िला चुनें") -- chhota card, poora safed page nahi
- **Zila chunne ka shortcut isi panel me ho** -- upar ke Location
  Selector tak wapas jaane ki zaroorat na pade, panel ke andar hi
  ek dropdown/search se zila chun sake
- Naksha ka size **fix rakho** -- tab badalne se ya panel content
  ke hisaab se naksha chhota-bada NA ho. Naksha aur bottom-panel
  dono ka apna fix height/area tay karo (CSS grid/flex se), jisse
  koi bhi tab khulne par doosre hisson ka size na hile

**Test:** bina zila chune "Mandi Prices" khol kar screenshot do (fix
se pehle/baad), phir zila chunkar bhi -- dono me naksha ka size same
rehna chahiye.

---

# 9. TAB-GRID (16 tab, 2 row) -- click par NEECHE PANEL AUTO-BHARE

Bottom tab-grid ab list se grid me badal chuka hai (Rainfall se
Crop Statistics tak, 2 row me 16 tab) -- ye layout theek hai, ise
mat badlo. Lekin **niyam saaf karo:**

- Kisi bhi tab par click karte hi, uske **theek neeche wali poori
  chaudai** turant ek bhara hua panel dikhana chahiye -- chart/graph/
  table jo bhi us tab ke liye sahi ho (item 7b ke graphical niyam
  ke mutabik)
- Ye **automatic** ho -- panel khud expand ho, kisi doosre click ki
  zaroorat na pade
- Zila chuna ho ya na chuna ho, dono surat me neeche khali safed
  jagah **kabhi na bache** -- zila na chune par item 8 wala
  default/compact-prompt state dikhe, khali panel nahi
- Ye niyam **saaron 16 tabs par ek jaisa** lagu ho (Rainfall,
  Temperature, Drought, Trends, NDVI Trend, 7-Day Forecast, GEE
  Workflow, Projection Method, API Hub, Agriculture, Village
  Intelligence, Validation, AOI Polygon, Live Weather, Mandi Prices,
  Crop Statistics) -- kisi ek me bhi khali na chhode

**Test:** in solaah tabs me se har ek par click karke screenshot do --
har baar neeche turant data-bhara panel dikhna chahiye.

---

# 10. FARMER ADVISORY PANEL -- climate metric + Mera Khet fertilizer jodo

Abhi Farmer Advisory side panel me ye dikh raha hai:
- "Climate indices -- Dibang Valley" card (thik hai)
- "Village Cadastral Summary" -- khali: *"Select a village to view
  cadastral aggregates."*
- "Fertilizer & Crop Recommendation" -- khali: *"Select a village to
  view fertilizer demand and recommended crops."*

**Theek karo:**

### 10a. Climate metrics is panel me pehle se dikhein
Jo zila/gaon Location Selector ya Mera Khet se pehle se chuna ja
chuka hai, uska climate summary (rainfall, temperature, drought risk
-- jo climate panel me hai wahi) is Farmer Advisory panel me bhi
turant dikhe, dobara select karne ki zaroorat na pade. Ek panel se
doosre panel me jaate hi selection yaad rahe (STANDING ORDERS item 2
ke mutabik -- ek selection sab jagah update kare).

### 10b. Fertilizer & Crop Recommendation -- Mera Khet se jodo
Ye khali card ab **Mera Khet ke polygon data se bharo**:
- Kisan ne apna khet naapa ho (Mera Khet se) to uska **kshetrafal
  (area)** yahan istemal ho fertilizer ki matra nikalne ke liye
- Fertilizer recommendation **mausam ke hisaab se alag-alag** ho:
  - **Kharif** fasal ke liye
  - **Rabi** fasal ke liye
  - **Zayad/Summer** fasal ke liye
  Teeno alag-alag section me, kisan jo fasal/mausam chune usi ke
  hisaab se sahi doze (N-P-K, kitna kg/ha ya kitna kg uske poore
  khet ke liye) dikhe
- Ye **automatic** ho -- khet naapte hi ya zila/gaon chunte hi ye
  card apne aap bhar jaye, khali message na dikhe (jab tak sach me
  koi data na ho)
- Source ICAR-recommended doze se ho, KISAN_DASHBOARD_PROMPT.md
  section 7 (keet-rog) ke saath isi corpus ko fertilizer-dose ke
  liye bhi istemal karo
- Har recommendation ke neeche: `स्रोत · saal` line

**Test:** Mera Khet se ek khet naapo, Farmer Advisory panel khol kar
dikhao ki climate metric aur fertilizer dono apne aap bhar gaye,
teeno mausam (kharif/rabi/zayad) alag dikh rahe hain.

---

# 11. OVERLAP -- disclaimer box zoom control ke upar chadh raha hai

Screenshot me dikha: "Indicative, not for legal/cadastral use...
Boundaries: Survey of India" wala disclaimer box seedhe **zoom
control (+/-) aur "Max zoom z18" label ke upar chadh gaya hai** --
dono ek doosre ko dhak rahe hain.

**Theek karo:** disclaimer box ki jagah badlo (jaise bottom-left ya
ek chhoti permanent strip me) taaki wo kabhi bhi zoom control,
scale bar, ya kisi aur naksha-control ke upar na aaye, kisi bhi
zoom/pan par.

---

# 12. FARMER ADVISORY -- idle-state text POORA HATAO

Panel khulte hi jo dikhta hai -- "Select a state", "WhatsApp SMS
हिंदी" button, "Boundaries + profiles · all states · IMD indices ·
5 MP districts only" line, "Select a village to view cadastral
aggregates.", "Select a village to view fertilizer demand and
recommended crops." -- **ye poora block hatao.**

Iski jagah item 10 wala niyam lagu karo: jo state/village pehle se
Location Selector ya Mera Khet se chuna ja chuka hai, uska climate
metric aur fertilizer/crop recommendation **seedhe apne aap** dikhe.
Koi khaali prompt text na dikhe -- na "select a state", na "select a
village". Agar sach me kuch selected hi nahi hai, to ek chhota
compact card ("ऊपर से क्षेत्र चुनें") kaafi hai, itna lamba text
block nahi.

`WhatsApp SMS हिंदी` jaisa alag button bhi is jagah se hatao -- agar
ye asli notification/alert feature hai to use apni jagah (jaise
Advisory ke andar ek "अलर्ट पाएं" section) me le jao, yahan idle-state
me nahi.

---

# 13. RISK LEGEND PANEL -- POORA HATAO

"Extreme Risk / High Risk / Moderate Risk / Low Risk" wala legend
panel naksha se **poora hatao** -- disclaimer/zoom-control ke saath
overlap ho raha hai aur alag se panel jagah ghair raha hai.

**Zaroori:** risk-color ka matlab (kaunsa rang kis risk star ko
dikhata hai) kahin **kho na jaye** -- Climate Metrics side panel
(jahan Drought Risk/Heatwave Severity card hain) me hi ek chhoti
`legend-strip` (jaise 4 rang ke chhote dot + naam, ek line me) jod
do, taaki jaankari bani rahe bina naksha par alag floating panel ke.

---

# ACCHA JO MILA -- aise hi rakho

Har climate card ke neeche `Source · resolution · 2000-2024` style
label -- ye sahi hai, isi tarah har jagah rakhna hai (UI_FIX_PROMPT.md
item 5 ke mutabik).

---

# DIKHAO -- kaam ke baad ye screenshot do

1. Sidebar aur neeche-patti ki jo das jodiyan upar likhi hain, unme se
   jinko dobara-content nikla, unka **pehle** (dono khule, duplicate
   dikhte hue) aur **baad** (fix ke baad) ka screenshot
2. Naksha ka kona jahan "Max zoom" likha hai -- fix se pehle aur baad
3. Poora India-view naksha -- grid lines fix se pehle aur baad
4. Naksha ke neeche wali khali jagah -- fix se pehle aur baad
5. Climate panel khula hua -- ek zila chunkar, saaf side panel
6. Neeche ke 3-4 alag tab click karke -- kahin overlap nahi, ye dikhao
7. Tab-list ka naya grid/tabular layout -- khali jagah bhari hui
8. Kam se kam 4 alag tab (Rainfall, Temperature, NDVI Trend, 7-Day
   Forecast) click karke unka graphical chart/graph panel
9. "Mandi Prices" (ya koi bhi tab) bina zila chune -- khali jagah
   fix hone ke baad, aur naksha ka size zila chunne se pehle/baad
   same rehte hue
10. Solaah tabs me se har ek click karke, neeche turant bhara hua
    panel -- ek collage/grid me sab 16 screenshot
11. Farmer Advisory panel -- Mera Khet se naape khet ke saath climate
    metric aur teeno mausam (kharif/rabi/zayad) ka fertilizer card
    bhara hua, idle-state text kahin nahi
12. Disclaimer box zoom control se overlap na kare -- naye jagah ka
    screenshot
13. Risk Legend panel hata hua, uski jagah Climate Metrics panel me
    chhoti legend-strip
14. Ek list: das jodiyon me se kaunsi sach me duplicate thi, kaunsi
    alag content thi (naam ke bawajood)

Har item ke saamne HUA / NAHI KIYA / kyun nahi likhna, screenshot ke
bina "ho gaya" mat likhna.
