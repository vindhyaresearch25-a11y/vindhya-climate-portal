-- Additive migration for an EXISTING vindhya-ground-truth D1 database
-- (one already created from kisan_upload_schema.sql before
-- MERA_KHET_PROMPT.md BHAAG A). A fresh database created from the current
-- kisan_upload_schema.sql already has this column -- do not run this
-- against a brand-new database, it is only for upgrading an older one.
--
--   wrangler d1 execute vindhya-ground-truth --remote --file=cloudflare/kisan_upload_schema_002_geometry.sql
--
-- Adds the optional farmer-drawn field boundary (Mera Khet, A2) to the
-- SAME submissions table kisan_upload.html already writes to -- no new
-- table, no second upload pipeline. NULL for every row written before
-- this migration and for any future kisan_upload.html point-only
-- submission; only Mera Khet ever populates it.

ALTER TABLE submissions ADD COLUMN geometry_json TEXT;
