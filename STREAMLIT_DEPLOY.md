# Streamlit Cloud — Deployment Guide

## Step 1: Commit & Push latest code to GitHub

```powershell
# PowerShell (Run कहीं से भी कर सकते हैं)
& "C:\Program Files\Git\bin\git.exe" add -A
& "C:\Program Files\Git\bin\git.exe" commit -m "fix: srcdoc + GitHub raw URLs for Streamlit deploy"
& "C:\Program Files\Git\bin\git.exe" push
```

> अगर GitHub username/password माँगे, तो अपने GitHub credentials डालें

---

## Step 2: Streamlit Cloud पर deploy करें

1. **Browser में खोलें:** 👉 https://share.streamlit.io

2. **GitHub से Sign In** करें
   - "Sign in with GitHub" बटन दबाएँ
   - अपने GitHub account से login करें

3. **"New app"** बटन दबाएँ (top-right)

4. **Deploy from existing repo** चुनें:
   - **Repository:** `vindhyaresearch25-a11y/vindhyaclimate`
   - **Branch:** `main`
   - **Main file path:** `app.py`
   - **"Deploy"** बटन दबाएँ

5. **इंतज़ार करें ~2-5 मिनट** — Streamlit Cloud:
   - ✅ Code को install करेगा (`streamlit` dependency)
   - ✅ `app.py` को run करेगा
   - ✅ Live URL देगा: `https://vindhyaclimate-xxxxx.streamlit.app`

---

## Step 3: Verify

Deploy होने के बाद अपने browser में app URL खोलें:

```
https://vindhyaclimate-hc46ttvuf6f8ped7pgy34g.streamlit.app/
```

- Dashboard दिखना चाहिए — Google Satellite base map के साथ
- District select करके climate metrics, tabs, सब check करें
- अगर कुछ गलती हो, तो Streamlit Cloud पर **"Manage app"** → **"Logs"** में देखें

---

## Auto-redeploy (भविष्य के लिए)

GitHub पर push करते ही Streamlit Cloud auto-redeploy हो जाता है। बस:

```powershell
& "C:\Program Files\Git\bin\git.exe" add -A
& "C:\Program Files\Git\bin\git.exe" commit -m "आपका message"
& "C:\Program Files\Git\bin\git.exe" push
```

> **Note:** `push` के बाद ~30-60 सेकंड में Streamlit Cloud auto-deploy शुरू हो जाता है।
