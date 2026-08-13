# KISAN DASHBOARD -- kisan ke liye alag, poora dashboard

Kisan jab apna khet polygon se khinche, ek **poora naya dashboard**
khule -- patli side-strip nahi. Usme us khet ke hisaab se sab kuch.

Har item ke saamne: **HUA / NAHI KIYA / kyun nahi**

---

## KHULTE HI SWAGAT

```
नमस्कार 🙏 -- nahi, emoji nahi.

"नमस्कार, किसान भाई/बहन — VINDHYA पोर्टल में आपका स्वागत है"

आपका चुना हुआ क्षेत्र: 1.56 हेक्टेयर
गाँव: पनागर · ज़िला: जबलपुर · राज्य: मध्य प्रदेश
```

Jagah **polygon ke centroid se apne aap** nikalo (SoI boundaries se),
kisan ko chunna na pade. Agar wo pehle se selector me chuni hai to
wahi dikhao.

---

## PANEL -- isi kram me, har ek poori chaudai me

### 1. आपकी ज़मीन / Aapki zameen `[khet-star, asli]`
- kul kshetrafal (ha aur bigha dono -- rajya ke hisaab se bigha)
- parimiti
- kheti wala hissa vs medh/banjar (Dynamic World, 10 m)
- **naksha** -- polygon Sentinel-2 (10 m) ya Esri satellite par

### 2. आज का मौसम / Aaj ka mausam `[LIVE]`
- aaj ka tapman, nami, hawa (NASA POWER)
- **7-din ka poorvanuman** -- barish, tapman
- "अगले 3 दिन बारिश की संभावना" jaisa saaf sandesh

### 3. बारिश और सूखा / Barish aur sookha
- is saal ab tak kitni barish, aurat se kitna kam/zyada
- **sookhe ki sambhavna** -- SPI se
- **paani bharne ka khatra** -- Rx1day se
- 2000-2024 ka graph
- SAAF likho: ye ~5.5 km grid ka hai, khet ka nahi

### 4. मिट्टी की नमी / Mitti ki nami
- SMAP, 9 km -- **label lagao ki khet ka nahi**
- kitne gaon wahi cell share karte hain, wo bhi likho

### 5. फ़सल की सेहत / Fasal ki sehat `[khet-star, asli]`
- khet ka NDVI abhi
- 6 mahine ka graph
- **khet ke andar kahan kamzor hai** -- chhota naksha
- **aapke khet ka NDVI vs gaon ka aurat** -- ye sabse kaam ki cheez

### 6. आपके क्षेत्र की मुख्य फ़सलें / Mukhya fasal
- us zile ki kharif/rabi/zayad ki top fasal, kshetrafal ke hisaab se
- crop_stats se, **zila-star ka label** ke saath
- chart me dikhao, tabel me bhi

### 7. कीट और रोग / Keet aur rog
- kisan **fasal chune** dropdown se
- us fasal ke us mausam ke mukhya keet aur rog
- har ek ke saath: pehchan, lakshan, upay (karshan -> jaivik ->
  rasayanik), aur **citation**
- rasayan sirf CIB&RC registered, pratibandhit KABHI nahi

### 8. नुक़सान हुआ? फ़ोटो भेजिए / Nuksan hua? Photo bhejiye
- **"फ़ोटो लें"** button -- mobile ka camera khule
- kisan likhe kya samasya hai
- location apne aap (polygon se)
- bhejne par: *"आपकी जानकारी मिल गई। हमारी टीम देखकर बताएगी।"*
- **jhootha vaada mat karo** -- agar koi team nahi dekh rahi to
  likho "यह शोध डेटासेट में जाएगा" bas

### 9. मंडी भाव / Mandi bhav
- us zile ke aaj ke bhav, top 5 fasal
- AGMARKNET se, tareekh ke saath

### 10. सवाल पूछिए / Sawal poochhiye
- Kisan Sahayak yahin, isi dashboard me
- upar ka SAB data uske prompt me jaye
- jawab me source aur tareekh

---

## NAKSHA

- **Sentinel-2 (10 m)** ya Esri World Imagery -- jo saaf ho
- Google Earth ka link bhi do (kisan usme dekhna chahe to)
- Zoom karne par naksha faate nahi -- proper tile layer, screenshot
  nahi
- Polygon uske upar, saaf rang me

---

## PHOTO SE DATA -- Excel me

Har photo/pravishti ke saath ye jama karo aur **Excel/CSV me nikalo**:

| Column |
|---|
| pravishti ID (random) |
| tareekh, samay |
| latitude, longitude (asli, bheetar) |
| lat/lon (100 m tak gol -- sarvajanik ke liye) |
| rajya, zila, block, gaon (polygon se apne aap) |
| kshetrafal (ha) |
| fasal |
| mausam (kharif/rabi/zayad) |
| samasya ka vivaran |
| photo ka link |
| kisan ka naam **(sirf agar khud de -- KABHI zaroori nahi)** |

**DPDP ke niyam:**
- naam, phone, Aadhaar **kabhi zaroori mat banao**
- anumati ka checkbox, bina uske save nahi
- sarvajanik dataset me naam/phone **kabhi nahi**, nirdeshank
  100 m tak gol
- IP store mat karo
- kisan kahe to uski pravishti hatane ka tarika ho

**Bhandaran:** Cloudflare D1 (`vindhya-ground-truth`,
id `78c47aad-b0a2-481d-a895-45e1e841f56e`)
**Photo:** abhi mat rakho (storage chahiye). Pehle text+location.
Photo baad me, jab jagah tay ho.
**Nikaso:** roz GitHub Action se Excel/CSV + JSON -> HF, CC-BY

---

## DIKHAWAT

- Har section **poori chaudai** me, patli strip me nahi
- Bade akshar -- kisan mobile par padhega, 14px se chhota nahi
- Chart aur table dono -- sirf number nahi
- Har aankde ke neeche: **source, saal, resolution**
- Hindi pehle, English saath me
- Har button 44x44 px se bada
- Mobile par: naksha upar, baaki neeche ek ke baad ek

---

## NIYAM

- **Koi banaya hua aankda nahi.** Data na ho to *"अभी उपलब्ध नहीं"*
  + kyun
- Khet-star aur zila-star ka **farak har jagah saaf** -- 9 km ka
  aankda khet ka bataana galat vaada hai
- Number code se, model se nahi
- Citation retrieved document se, model se nahi
- Jhootha vaada mat karo -- "hamari team batayegi" tab hi likho jab
  sach me koi dekhne wala ho

---

## PEHLE YE NAAPO

1. Ek 2-ha polygon par mera-khet Worker se NDVI + cropland aane me
   kitna samay? Kisan 10 second se zyada nahi rukega.
2. NASA POWER ka 7-din poorvanuman kitni jaldi aata hai
3. Sentinel-2 tile layer se naksha kitna bhaari hai mobile par
4. D1 ke muft tier me kitni pravishti aa sakti hain

**Naapkar batao, phir banao.**

---

## KRAM

1. Poora dashboard ka dhancha (section 1, 2, 3, 4) -- ye data
   pehle se hai
2. Section 5 (NDVI) -- mera-khet Worker se
3. Section 6, 9 (fasal, mandi) -- data pehle se hai
4. Section 10 (Kisan Sahayak) -- Worker pehle se hai
5. Section 7 (keet-rog) -- corpus ke saath
6. Section 8 (photo) -- sabse aakhir me

**1 se shuru karo.**
