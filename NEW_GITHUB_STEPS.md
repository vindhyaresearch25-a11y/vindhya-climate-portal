# नया GitHub Repository बनाकर Live करना — पूरा Step-by-Step

आपके पास 2 रास्ते हैं:

- **रास्ता A — GitHub Desktop** (आसान, कोई command नहीं, token की ज़रूरत नहीं) ← **सुझाया गया**
- **रास्ता B — PowerShell commands** (अगर आपको command line आती है)

दोनों का नतीजा एक ही है। कोई एक चुनें।

---

# चरण 0 — तैयारी (दोनों के लिए)

## 0.1 ZIP extract करें

`vindhyaclimate-restructured.zip` को Downloads में extract करें।
अंदर `vindhyaclimate` फ़ोल्डर मिलेगा। उसके अंदर `app.py`, `README.md`,
`dashboard`, `scripts` दिखने चाहिए।

> ध्यान दें: फ़ोल्डर के अंदर फिर से `vindhyaclimate` फ़ोल्डर न हो। अगर ऐसा है
> तो अंदर वाला फ़ोल्डर ही इस्तेमाल करें।

## 0.2 नया repository बनाएँ (GitHub वेबसाइट पर)

1. खोलें: **https://github.com/new**
2. भरें:
   - **Repository name:** `vindhya-climate-portal`
   - **Description:** `Village-level climate intelligence portal for Madhya Pradesh`
   - **Public** चुनें ← ज़रूरी है, वरना GitHub Pages मुफ़्त में नहीं चलेगा
   - **"Add a README file" पर टिक न करें** ← बहुत ज़रूरी, वरना push में error आएगा
   - बाक़ी सब खाली छोड़ दें
3. हरा बटन **Create repository** दबाएँ
4. अगले पेज पर जो URL दिखे उसे कहीं नोट कर लें, जैसे:
   `https://github.com/vindhyaresearch25-a11y/vindhya-climate-portal`

---

# रास्ता A — GitHub Desktop (आसान)

## A.1 GitHub Desktop इंस्टॉल करें

1. खोलें: **https://desktop.github.com**
2. **Download for Windows** दबाएँ, इंस्टॉल करें
3. खोलकर **Sign in to GitHub.com** दबाएँ और अपने account से login करें

## A.2 Repository को कंप्यूटर पर लाएँ (Clone)

1. GitHub Desktop में: **File** → **Clone repository**
2. **GitHub.com** tab में अपना नया `vindhya-climate-portal` चुनें
3. **Local path** नोट कर लें (जैसे `C:\Users\आपका-नाम\Documents\GitHub\vindhya-climate-portal`)
4. **Clone** दबाएँ

## A.3 फ़ाइलें कॉपी करें

1. Downloads वाले `vindhyaclimate` फ़ोल्डर को खोलें
2. **Ctrl + A** दबाकर सब कुछ चुनें, **Ctrl + C** करें
3. Step A.2 वाले Local path फ़ोल्डर में जाएँ
4. **Ctrl + V** दबाकर पेस्ट करें

## A.4 GitHub पर चढ़ाएँ (Push)

1. GitHub Desktop में वापस जाएँ — बाईं तरफ़ सैकड़ों फ़ाइलें दिखेंगी
2. नीचे बाएँ **Summary** बॉक्स में लिखें:
   `Initial commit: MP climate portal, verified data only`
3. **Commit to main** दबाएँ
4. ऊपर **Push origin** दबाएँ
5. **5 से 10 मिनट रुकें** — 45 MB चढ़ रहा है, धैर्य रखें

अब **चरण 3** पर जाएँ।

---

# रास्ता B — PowerShell (Command Line)

## B.1 Git की पहचान सेट करें (सिर्फ़ पहली बार)

```powershell
& "C:\Program Files\Git\bin\git.exe" config --global user.name "Vinod Sahu"
& "C:\Program Files\Git\bin\git.exe" config --global user.email "vinodsahu084@gmail.com"
```

## B.2 फ़ोल्डर में जाएँ

```powershell
cd "C:\Users\<आपका-नाम>\Downloads\vindhyaclimate"
dir
```

`dir` में `app.py` और `dashboard` दिखने चाहिए। नहीं दिख रहे तो गलत फ़ोल्डर में हैं।

## B.3 Repository शुरू करें और commit करें

```powershell
$git = "C:\Program Files\Git\bin\git.exe"

& $git init
& $git branch -M main
& $git add -A
& $git status
```

`git status` में **ज़रूर जाँचें** कि ये दिख रहे हैं:

- `dashboard/data/mp_climate_data.json`
- `dashboard/data/boundaries/india_states.geojson`
- `dashboard/mp_districts.geojson`

अगर दिख रहे हैं तो आगे बढ़ें:

```powershell
& $git commit -m "Initial commit: MP climate portal, verified data only"
```

## B.4 GitHub से जोड़ें और push करें

अपना असली repository URL डालें:

```powershell
& $git remote add origin https://github.com/vindhyaresearch25-a11y/vindhya-climate-portal.git
& $git push -u origin main
```

## B.5 अगर password माँगे

GitHub अब password नहीं लेता, **Personal Access Token** लेता है:

1. खोलें: **https://github.com/settings/tokens**
2. **Generate new token** → **Generate new token (classic)**
3. **Note:** `vindhya-portal`
4. **Expiration:** 90 days
5. **repo** वाले checkbox पर टिक करें ← यही ज़रूरी है
6. नीचे **Generate token** दबाएँ
7. जो लंबा code (`ghp_...`) दिखे उसे **तुरंत कॉपी करें** — दोबारा नहीं दिखेगा
8. PowerShell में जब **Password** माँगे तो यही token पेस्ट करें
   (Username में अपना GitHub username डालें)

---

# चरण 3 — Website लाइव करें (GitHub Pages)

1. खोलें: `https://github.com/vindhyaresearch25-a11y/vindhya-climate-portal`
2. ऊपर **Settings** दबाएँ
3. बाईं तरफ़ नीचे **Pages** दबाएँ
4. **Source:** `Deploy from a branch` चुनें
5. **Branch:** `main` चुनें, बगल में `/ (root)` चुनें
6. **Save** दबाएँ
7. **2 से 3 मिनट रुकें**

आपका पोर्टल यहाँ लाइव होगा:

```
https://vindhyaresearch25-a11y.github.io/vindhya-climate-portal/dashboard/
```

> आख़िरी `/dashboard/` लिखना **ज़रूरी** है। बिना उसके 404 आएगा।

---

# चरण 4 — जाँच करें

खोलकर देखें:

- [ ] नक्शा (satellite map) खुल रहा है
- [ ] ऊपर दाईं तरफ़ **INDIA BOUNDARIES** बॉक्स है — State और District checkbox दबाकर देखें, पूरे भारत की सीमाएँ दिखनी चाहिए
- [ ] District dropdown में 5 ज़िले हैं: Bhopal, Indore, Jabalpur, Rewa, Sidhi
- [ ] कोई ज़िला चुनने पर नीचे के चार्ट भर रहे हैं
- [ ] Village dropdown भर रहा है

कुछ काम न करे तो ब्राउज़र में **F12** दबाएँ → **Console** tab → वहाँ लाल रंग
में जो error लिखी हो, वह मुझे बताएँ।

---

# आम गलतियाँ और हल

| समस्या | कारण | हल |
|---|---|---|
| `push` पर "rejected — fetch first" | repo बनाते समय README पर टिक कर दिया था | `& $git pull origin main --allow-unrelated-histories` फिर दोबारा push |
| `remote origin already exists` | पहले भी कोशिश की थी | `& $git remote remove origin` फिर B.4 दोबारा |
| Pages पर 404 | URL में `/dashboard/` नहीं लगाया | पूरा URL इस्तेमाल करें |
| नक्शा खुला पर चार्ट खाली | data फ़ाइलें push नहीं हुईं | GitHub पर `dashboard/data/` फ़ोल्डर खोलकर देखें कि फ़ाइलें हैं |
| Pages का विकल्प नहीं दिख रहा | repo Private है | Settings → General → नीचे **Change visibility** → Public |
| Push बहुत धीमा | 45 MB चढ़ रहा है | 5 से 10 मिनट सामान्य है, रोकें नहीं |

---

# चरण 5 — पुराने repo का क्या करें

पुराना `vindhyaclimate` repo अभी भी मौजूद है और उसमें दो समस्याएँ हैं:

1. **Synthetic डेटा** — 50 नकली ज़िले, नकली गाँव, नकली खसरा मालिकों के नाम
2. **खुली API key** — `gen-lang-client-0298941748` सार्वजनिक पड़ी है

सुझाव:

1. Google Cloud Console में जाकर उस पुरानी key को **तुरंत revoke करें**
2. पुराने repo को **Settings → General → नीचे → Archive** करें, या Private कर दें
3. उसका README बदलकर लिख दें: "इस repo का डेटा वापस ले लिया गया है, नया
   पोर्टल यहाँ है: <नया URL>"

पुराने repo को अभी delete न करें — commit history कभी काम आ सकती है।

---

# लाइव होने के बाद अगला काम

1. `data.gov.in` पर register करके AGMARKNET की मुफ़्त API key लें
2. **MP Bhulekh / भू-नक्शा के लिए आवेदन आज ही भेजें** — इसमें 1 से 3 महीने
   लगते हैं, इसलिए सबसे पहले भेजना ज़रूरी है
3. NASA POWER जोड़ें — बिना key के किसी भी गाँव का real-time मौसम मिलेगा

विस्तार से `docs/GO_LIVE_PLAN.md` और `docs/REQUIREMENTS_ROADMAP.md` देखें।
