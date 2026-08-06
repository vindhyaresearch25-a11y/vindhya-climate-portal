# Security — credentials, scanning, incident notes

FINAL_PROMPT.md Phase 3. This document is the register: which credential
lives where, how it's scanned for, what to do if one leaks. It does not
contain any actual key value, current or historical.

## Where each credential lives

| Credential | Used by | Lives in | Never in |
|---|---|---|---|
| `GEE_SERVICE_ACCOUNT_JSON`, `GEE_PROJECT_ID` | `scripts/08_gee_national_climate.py` and other GEE scripts | Local env var / `~/.zprofile`, pointing at a JSON key file outside the repo | Any tracked file, any commit, any chat message |
| `HF_TOKEN` | `scripts/hf_upload_boundaries.py`, `scripts/crop_yield/*` | Local env var | Same as above |
| `DATA_GOV_API_KEY` | `scripts/fetch_mandi_prices.py`, `scripts/fetch_crop_stats.py` | GitHub Actions repository secret | Tracked files, chat |
| Cloudflare Worker's model API key(s) | `vindhya-gemini-proxy` Worker (Cloudflare-side, not this repo) | Cloudflare Worker secret binding | This repo entirely -- the browser calls the Worker's public URL, never a model API directly |
| Streamlit `GEMINI_API_KEY` | `app.py` (Streamlit-hosted variant only) | Streamlit Cloud Secrets | Tracked files, chat -- GitHub Pages never has this, by design (no backend to hold it) |

## Scanning

- **`tools/pre-commit`** (installed as `.git/hooks/pre-commit`, not itself
  tracked by git -- run `cp tools/pre-commit .git/hooks/pre-commit &&
  chmod +x .git/hooks/pre-commit` after a fresh clone): blocks a commit
  whose staged *additions* match a credential-shaped pattern (`ghp_`,
  `github_pat_`, `AIza`, `hf_`, `sk-`, `sk-ant-`, PEM private key headers,
  or a `"api_key"`/`"token"`/`"secret"`/`"password"` JSON key). Pattern
  match, not a validator -- a false positive is possible, verify by eye
  before `--no-verify`.
- **`.github/workflows/secret-scan.yml`**: the same pattern, run against
  every push's diff on GitHub's servers -- catches anything committed with
  `--no-verify`, from a clone without the hook installed, or pushed by a
  tool that doesn't run local hooks. Fails the build; does not attempt to
  redact anything itself.
- **`.gitignore`**: `.env`, `.env.*`, `*.pem`, `*.key`,
  `service-account*.json`, `gee_key*.json`, `*credentials*.json`,
  `.wrangler/` are excluded so they can't be added by accident even before
  the scans above would catch them.

## Git history scan (2026-08-06, Phase 3.4)

Full history (`git log --all -p`) searched for the same credential
patterns used by the hook/CI job above. **No full credential value was
found in this repo's history.** The only matches are the owner's own
truncated reminder strings already visible in `FINAL_PROMPT.md` and
`NEW_GITHUB_STEPS.md` (`ghp_bzBq...`, `hf_REE...`, `gen-lang-client-
0298941748`) -- prefixes/identifiers written as notes-to-self about what
to rotate, not the underlying secret values, and not something this scan
treats as a leak requiring history rewriting.

Per NIYAM (this repo's rules) and FINAL_PROMPT.md 3.4: **history is never
rewritten** (no `filter-branch`/`filter-repo`/BFG) even if a real key were
found there -- git history is this project's backup for the Hugging
Face-migrated data (see `docs/DATA_SOURCES.md`), and rewriting it to strip
a string would be a much larger, riskier operation than simply rotating
the exposed credential at its source (which invalidates the old value
regardless of where a copy of the string still sits in old history).

**Separately** (not found in *this* repo's history, but documented in
`NEW_GITHUB_STEPS.md` §5 from an earlier audit): the Gemini/GCP identifier
`gen-lang-client-0298941748` is exposed in a *different*, older repo
(`vindhyaclimate`) that predates this one. That repo's recommended
remediation (documented there already): revoke the key in Google Cloud
Console, archive or make the old repo private, update its README to point
here.

## If a credential leaks

1. **Rotate it at the source first** (Google Cloud Console for Gemini/GEE,
   GitHub Settings → Developer settings → Tokens for a PAT, Hugging Face
   Settings → Access Tokens for `HF_TOKEN`, Cloudflare dashboard for a
   Worker secret). Rotating invalidates the old value everywhere it might
   still exist (old commits, chat logs, clipboard history) -- this is the
   actual fix, not removing the string from one place.
2. Update the local env var / GitHub Actions secret / Streamlit secret /
   Worker binding with the new value.
3. Do **not** attempt to scrub the old value from git history --
   see "Git history scan" above for why.
4. If the leaked credential was ever used to push to this repo or another,
   check that repo's recent commits/settings for anything unexpected
   before considering the incident closed.

## Never in chat

Per owner instruction (2026-08-06): credentials are never pasted into a
Claude Code chat session, including in response to a request for one --
if a tool genuinely needs a credential this session doesn't already have
as an environment variable, the owner runs the relevant command in their
own terminal (where the credential already lives) rather than typing the
value into chat.
