# Contributing

## Ground rules

1. **No synthetic data.** Every value displayed by the dashboard must be
   traceable to a verifiable source (IMD, MODIS/DiCRA, CMIP6, government
   databases). Pull requests introducing generated, jittered, or placeholder
   records will not be merged.
2. **Provenance required.** Any new dataset must ship with a `metadata` block:
   source, spatial resolution, CRS, processing steps, and `last_updated`.
3. **Reproducibility.** Pipeline scripts must run from `scripts/` with paths
   supplied via environment variables (see `.env.example`), never hardcoded.
4. **No secrets in code.** API keys go in environment variables or Streamlit
   secrets.

## Workflow

- Fork, create a feature branch, run `python -m pytest tests/`, open a PR.
- Keep pipeline steps numbered and idempotent.
- Update `docs/METHODOLOGY.md` when index definitions change.
