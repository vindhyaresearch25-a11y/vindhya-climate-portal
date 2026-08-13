-- Additive migration for an EXISTING vindhya-ground-truth D1 database
-- (KISAN_DASHBOARD_PROMPT.md section 8, KRAM 6). A fresh database created
-- from the current kisan_upload_schema.sql already has this column -- do
-- not run this against a brand-new database, it is only for upgrading an
-- older one that predates this change:
--
--   wrangler d1 execute vindhya-ground-truth --remote --file=cloudflare/kisan_upload_schema_003_problem.sql
--
-- Adds an optional free-text "what's wrong with this field" description to
-- the SAME submissions table kisan_upload.html and mera_khet.js's ground-
-- truth form already write to -- section 8 ("Nuksan hua? Photo bhejiye")
-- is a THIRD caller of this one endpoint/table, not a new pipeline. Photo
-- storage is explicitly deferred per the spec ("Photo abhi mat rakho...
-- Photo baad me") -- this migration adds only the text field + reuses the
-- existing crop/season/lat/lon/geometry/consent columns, nothing else.
-- NULL for every row written before this migration and for any submission
-- that doesn't set it (kisan_upload.html's and Mera Khet's ordinary crop
-- ground-truth submissions leave it unset, exactly as before).

ALTER TABLE submissions ADD COLUMN problem_description TEXT;
