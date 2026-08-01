# Deployment

The dashboard is a **static site** — HTML, CSS, JS, plus one JSON file. No server-side code, no database, no Python runtime needed at runtime. Three good free options:

## Option 1 — GitHub Pages (recommended, takes ~5 minutes)

```bash
# from your project root
git init
git add dashboard/
git commit -m "MP Climate dashboard"
git branch -M main
git remote add origin https://github.com/<you>/mp-climate.git
git push -u origin main
```

Then on GitHub:
1. Settings → Pages → Source = `main` branch, `/dashboard` folder → Save
2. Wait 60 seconds → site is at `https://<you>.github.io/mp-climate/`

## Option 2 — Netlify (one click)

1. Sign in at https://app.netlify.com
2. "Add new site" → "Deploy manually"
3. Drag-drop the `dashboard/` folder
4. Done. You get a `https://<random-name>.netlify.app` URL.

To get a custom path, use Netlify CLI:
```bash
npm i -g netlify-cli
cd dashboard
netlify deploy --prod
```

## Option 3 — Vercel

```bash
npm i -g vercel
cd dashboard
vercel --prod
```

## Option 4 — quick local test

```bash
cd dashboard
python -m http.server 8000
# open http://localhost:8000 in browser
```

**Don't double-click `index.html` to open it via `file://`** — `fetch('data/mp_climate_data.json')` will be blocked by the browser's same-origin policy. Always serve over `http://` or `https://`.

## Sharing this with reviewers

Once deployed, your submission URL is the live site. Include in your submission:
- Live dashboard URL
- GitHub repo URL (this project)
- The PDF/document write-up using `docs/METHODOLOGY.md` as the spine

## Updating data later

The dashboard reloads `data/mp_climate_data.json` on every page load. After re-running the Python pipeline (e.g. to add new years or pull updated CMIP6), just:

1. Push the new `dashboard/data/mp_climate_data.json` to git, or
2. Re-deploy the dashboard folder on Netlify/Vercel

The HTML and JS never need to change.

## File-size note

`mp_climate_data.json` for 5 districts × 25 years is ~50 KB. Easily fits any free static host. If you scale to all 55 MP districts at the village level, you'd want to split by district into separate JSON files and lazy-load them — but that's not needed here.
