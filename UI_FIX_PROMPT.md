# UI + KHET-STAR KI NAMI -- chhe kaam

Kram se karo. Har item ke saamne: **HUA / NAHI KIYA / kyun nahi**

---

# 1. ZOOM PAR NAKSHA GAYAB

30 m ke zoom par poora naksha slaty ho jata hai, aur *"Map data not
yet available"* baar-baar poore naksha par likha aata hai. Esri
World Imagery har jagah us zoom tak jaati hi nahi.

**Theek karo:**
- Har basemap ki asli `maxNativeZoom` tay karo (Esri, OSM,
  OpenTopoMap, Carto -- alag-alag hai)
- Us seemaa ke aage **Google Satellite ya Sentinel-2 par apne aap
  switch** karo -- kisan ko khali screen na dikhe
- `maxNativeZoom` set karke tiles ko stretch hone do (dhundhli
  dikhengi, par khali nahi)
- *"Map data not yet available"* **poore naksha par baar-baar mat
  likho** -- ek chhoti patti kone me, ek baar:
  `"इस ज़ूम पर उपग्रह चित्र उपलब्ध नहीं · Zoom out करें"`
- Zoom control par max seemaa dikhao

**Test:** Panagar par 30 m tak zoom karke screenshot do -- naksha
dikhna chahiye, slaty nahi.

---

# 2. PANEL KA TEXT -- corporate style

Har panel ka vivaran lamba aur AI-jaisa hai.

**Abhi:**
> "यह आपके गाँव वाली ~9 किमी ग्रिड सेल का माप है। इस सेल में लगभग
> 48 और गाँव हैं, सबका मान यही होगा। यह आपके खेत का अपना माप नहीं है।"

**Karo:**
> `स्रोत: SMAP, 9 किमी ग्रिड · 48 गाँव साझा · खेत-स्तर नहीं`

**Niyam -- HAR panel par, sirf soil moisture par nahi:**
- Ek line, zyada se zyada do
- **VAAKYA nahi, LABEL likho** -- sarkari dashboard ki tarah
- Lamba vivaran `i` icon ke tooltip me, panel me nahi
- "यह", "आपके", "होगा", "सकता है" -- samjhane wale shabd hatao
- Separator `·` (bullet nahi, comma nahi)
- Har card ke neeche ek hi line: `स्रोत · resolution · saal`

Ek-ek panel kholkar poori suchi banao ki kahan-kahan lamba text hai,
phir sab theek karo.

---

# 3. HINDI / ENGLISH TOGGLE

Upar ka हिंदी button dabane par **SAB nahi badalta**.

**Theek karo:**
- HAR panel, label, button, error message, tooltip, sidebar ka naam,
  dropdown ka option, chart ka axis -- **sab ek i18n dictionary se**
- Koi text HTML me **hardcode na ho**
- Toggle dabate hi poora portal **turant** badle (page reload nahi)
- Chuni bhasha yaad rahe (`localStorage`)
- Tareekh bhasha ke hisaab se (Hindi me "12 अगस्त 2026")
- Number dono me `1.56` hi -- Hindi me `1,56` nahi

**Ek-ek panel kholkar jaancho aur SUCHI DO** ki kaunsa text nahi
badla. Suchi ke bina "ho gaya" mat likhna.

---

# 4. KHET-STAR KI NAMI

Abhi sirf SMAP 9 km hai -- 8,100 ha ka aurat, khet ka nahi.

### 4a. SMAP/Sentinel-1 disaggregated (SPL2SMAP_S) -- 1-3 km
NASA ka apna product, **muft**, asli m³/m³.

**Pehle jaancho:** GEE catalog me hai? Bharat ko dhakta hai? Kitna
purana data? Mil jaye to gaon-star ke liye jodo -- 9 km se 9 guna
behtar.

### 4b. Sentinel-1 backscatter -- 10 m, KHET-STAR

Ye **m³/m³ NAHI de sakta** -- fasal aur zameen ki khurdurapan bhi
backscatter par asar dalte hain. Lekin **saapeksh tulna** de sakta
hai, aur kisan ke liye wahi kaam ki hai:

> "आपका खेत गाँव के औसत से 12% सूखा है"

**Naam "मिट्टी की नमी" MAT rakho.** Rakho:
```
खेत की नमी सूचकांक (सापेक्ष)
Field wetness index (relative)
```
Saath me ek line:
```
m³/m³ माप नहीं · गाँव के औसत से तुलना · Sentinel-1 VV/VH, 10 मी
```

Wahi tarika jo NDVI par lagaya -- **tulna sahi rehti hai chahe
nirapeksh maan na ho**.

**m³/m³ ka jhootha vaada KABHI mat karo** -- 10 m par mumkin hi nahi.

**Naapo:** ek 2-ha polygon par Sentinel-1 se kitna samay, aur kitne
saaf pass milte hain (revisit 6-12 din).

---

# 5. HAR AANKDE KE SAATH -- teen cheez, hamesha

```
स्रोत · resolution · saal
```

Jahan resolution jagah se mota hai, wahan ek shabd aur:
`खेत-स्तर नहीं` / `not field-level`

Ye niyam poore portal par -- climate, NDVI, soil moisture, crop,
mandi, sab.

---

# 6. DIKHAWAT -- ek jaisa

- Card: radius 8px, border 1px `#D8DEE7`, safed background,
  padding 16px, **shadow nahi**
- Andar: chhota label (11px, `#5A6A7A`) -> BADA MAAN (28px,
  weight 600, tabular figures) + unit -> trend (13px) ->
  `स्रोत · res · saal` (11px, gaun)
- Rang sirf jahan matlab ho. Bina matlab ke rang kabhi nahi.
- Spacing 4px grid: 4/8/12/16/24/32/48
- Section ke beech 32px
- Mobile par 14px se chhota text kabhi nahi

---

# AAKHIR ME

LIVE site par khud kholkar screenshot do:
- **Hindi me** poora dashboard, scroll karke
- **English me** wahi
- Panagar par **30 m zoom** -- naksha dikhta hua
- Khet ki nami sucha॑nk wala card

Har item ke saamne HUA / NAHI KIYA / kyun nahi.
