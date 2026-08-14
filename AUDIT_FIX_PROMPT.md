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
9. Ek list: das jodiyon me se kaunsi sach me duplicate thi, kaunsi
   alag content thi (naam ke bawajood)

Har item ke saamne HUA / NAHI KIYA / kyun nahi likhna, screenshot ke
bina "ho gaya" mat likhna.
