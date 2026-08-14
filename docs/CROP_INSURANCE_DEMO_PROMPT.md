# CROP INSURANCE -- DEMO MODEL (sirf Simrol, Indore ke liye)

Ye ek **concept-demo** hai, poore desh ke liye nahi. Maqsad: ek gaon
(Simrol, Indore, MP) ke liye dikhana ki crop-cutting-experiment (CCE)
se fasal-nuksan ki value kaise nikalti hai, taaki idea pasand aane
par baad me poore desh ke liye asli model bane.

**ZAROORI NIYAM -- CLAUDE.md ke "no synthetic data, ever" niyam se
iska sambandh:** ye section **DEMO hai, isliye chalta hai**, lekin
sirf tab jab wo har jagah saaf DEMO dikhe. Asli data jaisa dikhna ya
asli record se confuse hona **bilkul mana hai** -- pehle iss project
me exactly ye galti (fabricated cadastral owner names, asli jaisi)
ho chuki hai aur clean-up karna pada tha. Dobara na ho.

Har item ke saamne: **HUA / NAHI KIYA / kyun nahi**

---

# 1. DEMO LABEL -- har screen par, chhupa na ho

- Section khulte hi upar ek **static banner**:
  `⚠️ DEMO MODEL -- Simrol, Indore | उदाहरण डेटा, असली रिकॉर्ड नहीं |
  NOT FOR ACTUAL INSURANCE CLAIMS`
- Ye banner **scroll karne par bhi upar chipka rahe** (sticky)
- Har land-parcel number ke aage `DEMO-` prefix ho, jaise
  `DEMO-SIMROL-014` -- kabhi bhi asli Bhulekh/Bhu-Naksha jaisi
  format-string na ho jo asli record se milta-julta lage
- Kisan ka naam bhi placeholder jaisa ho: `किसान-उदाहरण-1`,
  `किसान-उदाहरण-2` -- kabhi koi bhi asli-lagne wala Bharatiya naam
  (jaise "रामलाल शर्मा") generate mat karo, ye asli identity se
  confuse ho sakta hai

---

# 2. GAON KI SEEMA -- Simrol, Indore, asli boundary se

- Simrol gaon ki asli seema (Survey of India boundary, jo pehle se
  portal me hai) istemal karo -- seema asli, andar ka data DEMO
- Us seema ke andar **automatic max land-parcel polygon** banao --
  yaani gaon ke area ko chhote-chhote demo-parcel me baato (grid ya
  random-shape polygon, DEMO ke liye theek hai, asli cadastral survey
  nahi hai isliye clearly likho: "भू-आकार अनुमानित, वास्तविक नक्शा
  नहीं")
- User kisi bhi ek parcel par click kare to wahi chuna jaye

---

# 3. PARCEL SELECT KARNE PAR -- area ka poora breakdown

Chune hue parcel ka:
- **Kul kshetrafal** (ha/bigha)
- Andar ka breakdown (DEMO estimate, Dynamic World/Sentinel-2 land-
  cover class se agar mumkin ho, warna clearly "अनुमानित" likho):
  - Ghar/aawasiya area
  - Bagicha (orchard/garden)
  - Ped-paudhe/awood (tree cover)
  - Medh/boundary area
  - **Total cropped area** (jo fasal ke liye istemal ho raha hai)

---

# 4. FASAL CHUNAV -- Kharif / Rabi

- Dropdown: **Kharif** ya **Rabi** (Zayad bhi agar mumkin ho)
- Fasal chunte hi us mausam ki demo-fasal (jaise Kharif me soyabean/
  makka, Rabi me gehun/chana -- Simrol/Indore ilaake ki asal me ugti
  fasal, crop_stats data se pehle se pata hai) dikhe

---

# 5. YIELD PREDICTION -- CCE methodology se

- **Crop Cutting Experiment (CCE)** ke tareeke se yield anumaan
  dikhao -- ek chhota panel jisme:
  - Sample plot yield (kg/ha) -- demo value, formula/methodology
    saath me likhi ho (kitne sample plot, kaunsa area unit)
  - **Beej ke prakar ke hisaab se value alag** -- Hybrid seed vs
    Desi/traditional seed, dono ka alag yield-anumaan aur alag
    market-value multiplier (isse dikhega ki hybrid fasal ka
    nuksan-value zyada kyun hota hai)
- **Nuksan ki value** = (normal expected yield - actual/demo yield) x
  market rate (mandi price data se, jo pehle se portal me hai) x
  total cropped area -- formula screen par saaf dikhe, black-box
  na ho

---

# 6. NIYAM -- ye kabhi mat karo

- Kisi bhi tarah ka "submit claim" ya "insurance apply" button
  **mat banao** -- ye sirf dikhane ke liye hai
- Ye demo data kabhi bhi asli dataset (D1, HF export, crop_stats)
  me **na jaaye** -- alag, isolated demo-only storage/state me rahe
- Koi bhi asli farmer ka naam/phone/land-record is section me
  **kabhi na aaye**

---

# DIKHAO

1. Sticky DEMO banner poore scroll me dikhta hua
2. Simrol boundary ke andar demo-parcel grid
3. Ek parcel select karke area-breakdown (ghar/bagicha/awood/medh/
   cropped)
4. Kharif aur Rabi dono chunkar CCE-based yield aur nuksan-value,
   hybrid vs desi seed ka farak dikhate hue
5. `DEMO-` prefix wale parcel number aur `किसान-उदाहरण-N` naam --
   confirm karo ki koi bhi asli-lagne wala naam/number nahi bana

Har item ke saamne HUA / NAHI KIYA / kyun nahi, screenshot ke saath.
