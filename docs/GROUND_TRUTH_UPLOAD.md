# Farmer ground-truth crop upload — design record

CROP_DATA_PROMPT.md Bhaag B. Status: **prototype code written, not
deployed.** Nothing here has run against real data yet — deployment
needs the owner's own Cloudflare login (wrangler), per this repo's
standing rule against asking for credentials in chat.

## Answers to "Bhaag B se pehle ye batao" (2026-08-07)

1. **Cloudflare D1 free tier — no credit card required.** Confirmed via
   Cloudflare's own pricing docs: the Workers Free plan includes D1 for
   prototyping at no cost, with daily limits of **5 million rows read,
   100,000 rows written, 5 GB storage** (resets 00:00 UTC; exceeding it
   blocks further queries until the next day rather than charging
   anything). A third-party aggregator site quoted different numbers (150M
   read / 3M written) — trusting Cloudflare's own docs over that, and
   noting the discrepancy rather than picking one silently. At this
   form's realistic submission volume (a few hundred/day at most in an
   early rollout), the free tier is not a binding constraint either way.
2. **Writing from a Worker to D1 is simple** — `env.DB.prepare(sql).bind(...).run()`,
   a stable, well-documented binding API. No separate driver, no
   connection pooling to manage (D1 handles that). This repo's existing
   chatbot Worker (`vindhya-gemini-proxy`) is architecturally the same
   shape (Worker + secret binding), just without a database — so this adds
   one new binding pattern to a stack that already exists, not a new stack.
3. **Prototype build time:** the code (Worker, D1 schema, HTML form,
   export script, GitHub Action) is written in this session — call it
   "one working session" for the code itself. What it does *not* include
   is deployment time, which depends on the owner: `wrangler d1 create` +
   `wrangler deploy` + setting 4 repo secrets is normally a
   15-30 minute manual task for someone already logged into `wrangler`
   (confirmed logged in per this repo's earlier sessions), done once.

## What was built (not deployed)

| File | Purpose |
|---|---|
| `cloudflare/kisan_upload_schema.sql` | D1 table: `submissions` — no name/phone/Aadhaar column (B1); `ip_hash`+`ip_hash_day` instead of a raw IP (B3); `status` defaults `unverified` (B4) |
| `cloudflare/kisan_upload_worker.js` | Validates crop/season/India-bbox/consent, rate-limits 20/IP/day via a same-day salted SHA-256 hash (never the IP itself), inserts into D1 |
| `cloudflare/wrangler_kisan_upload.toml` | Deploy config — placeholder `database_id`, needs the owner's `wrangler d1 create` output pasted in |
| `dashboard/kisan_upload.html` | The farmer-facing form: bilingual (Hindi primary / English secondary) consent text (B2, verbatim from CROP_DATA_PROMPT.md), crop dropdown sourced from `data/crop_list.json` (the real 59 crops in `crop_stats.json`, not a separately typed list), browser geolocation, optional area, submit disabled until consent is checked |
| `scripts/build_crop_list.py` | Generates `dashboard/data/crop_list.json` from `crop_stats.json`'s own crop labels |
| `scripts/export_ground_truth.py` | D1 → resolve village/block/district via point-in-polygon (not yet wired to a real boundary fetch — see the script's own NOTE, nothing to resolve against until real submissions exist) → round to 3 decimals → `data/ground_truth/<state>/<district>.json` |
| `.github/workflows/ground-truth-export.yml` | Daily cron, needs `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`/`D1_DATABASE_ID` repo secrets (none set yet) |

## To actually go live (owner-run, not in chat)

```bash
cd cloudflare
wrangler d1 create vindhya-ground-truth
# paste the printed database_id into wrangler_kisan_upload.toml
wrangler d1 execute vindhya-ground-truth --remote --file=kisan_upload_schema.sql
wrangler secret put RATE_LIMIT_SALT --config wrangler_kisan_upload.toml
wrangler deploy --config wrangler_kisan_upload.toml
```
Then: paste the deployed Worker URL into `dashboard/kisan_upload.html`'s
`SUBMIT_URL`, add a link to it from the main dashboard nav, and add
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` (scoped to D1:Read) /
`D1_DATABASE_ID` as GitHub Actions repo secrets.

## Still open (B5, B7 — depend on real submissions existing)

- **B5 (map display):** village-panel "N farmer entries from this
  village" and the map dots — not built yet, correctly depends on there
  being real (rounded) submissions to plot; wiring this against zero rows
  would just be a permanent empty state.
- **B7 (METHODOLOGY.md entry):** point count, verified/unverified split,
  train/validation split, and the crowdsourcing-bias limitation (farmers
  with phone access are systematically overrepresented) all need real
  numbers to write honestly — a placeholder count would be exactly the
  kind of fabricated-looking data this repo's standing rule forbids.
  Revisit once the Worker is deployed and has real submissions.
- `scripts/export_ground_truth.py`'s point-in-polygon resolver is a real,
  correct implementation shape but its boundary-fetch wiring is a
  documented TODO rather than guessed at with zero rows to test against.
