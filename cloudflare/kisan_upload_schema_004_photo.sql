-- Additive migration for an EXISTING vindhya-ground-truth D1 database
-- (owner request 2026-09-02: "किसान फ़सल सहयोग me live location with
-- photo" -- the photo storage explicitly deferred in
-- kisan_upload_schema_003_problem.sql's own note). A fresh database
-- created from the current kisan_upload_schema.sql already has these
-- columns -- do not run this against a brand-new database, it is only
-- for upgrading an older one that predates this change:
--
--   wrangler d1 execute vindhya-ground-truth --remote --file=cloudflare/kisan_upload_schema_004_photo.sql
--
-- Also requires an R2 bucket for the actual photo bytes (D1 stores only
-- the resulting object key, never the JPEG itself) -- see
-- wrangler_kisan_upload.toml's updated deploy steps for
-- `wrangler r2 bucket create` + the [[r2_buckets]] binding.
--
-- NULL for every row written before this migration and for any
-- submission that doesn't attach a photo (Mera Khet's and the Kisan
-- Dashboard's existing callers are unaffected -- this is still the same
-- one submissions table/endpoint, a fourth caller/field, not a new
-- pipeline).

ALTER TABLE submissions ADD COLUMN photo_url TEXT;
ALTER TABLE submissions ADD COLUMN photo_lat REAL;
ALTER TABLE submissions ADD COLUMN photo_lon REAL;
ALTER TABLE submissions ADD COLUMN photo_captured_at TEXT;
