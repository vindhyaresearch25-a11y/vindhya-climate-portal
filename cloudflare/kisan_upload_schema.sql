-- Ground-truth crop upload -- D1 schema (CROP_DATA_PROMPT.md Bhaag B).
-- Run once against a NEW D1 database:
--   wrangler d1 execute vindhya-ground-truth --file=cloudflare/kisan_upload_schema.sql
--
-- If a database from this schema already exists (deployed before
-- MERA_KHET_PROMPT.md BHAAG A), instead run the additive migration once:
--   wrangler d1 execute vindhya-ground-truth --remote --file=cloudflare/kisan_upload_schema_002_geometry.sql
--
-- Design notes (see docs/GROUND_TRUTH_UPLOAD.md for the full B1-B7 write-up):
--  * No name/phone/Aadhaar column -- B1 explicitly excludes them.
--  * lat/lon here are the REAL submitted coordinates (needed so the model
--    can actually use the point) -- the public export
--    (scripts/export_ground_truth.py) rounds to 3 decimals (~100m) before
--    it ever leaves D1 for the public HF dataset. This table is the
--    private/internal copy, not itself published.
--  * ip_hash is a per-day SALTED SHA-256 of the submitter's IP, not the IP
--    itself (B3: "IP address store mat karo") -- used only to enforce the
--    20-submissions/IP/day rate limit (B4), and only ever compared, never
--    reversed or exported.
--  * village/block/district/state are resolved later, offline, by
--    scripts/export_ground_truth.py doing a real point-in-polygon test
--    against the Survey of India boundary files -- not asked of the
--    farmer (B4: "kisan ko chunna na pade").
--  * geometry_json (added MERA_KHET_PROMPT.md BHAAG A2): optional farmer-
--    drawn field boundary ring, from Mera Khet (dashboard/mera_khet.js),
--    as a JSON array of [lon,lat] pairs already rounded to 3 decimals
--    (~100m) client-side before it ever reaches this table -- same
--    privacy rule as lat/lon, applied to every vertex, not just the
--    centroid. NULL for kisan_upload.html's plain point-only submissions
--    (unaffected, still the only required geometry). This is the SAME
--    submissions table/endpoint as before -- Mera Khet does not get its
--    own upload pipeline, it is a second caller of this one.

CREATE TABLE IF NOT EXISTS submissions (
  id            TEXT PRIMARY KEY,   -- random UUID, no personal meaning
  created_at    TEXT NOT NULL,      -- ISO 8601 UTC
  crop          TEXT NOT NULL,
  season        TEXT NOT NULL CHECK (season IN ('kharif', 'rabi', 'zayad')),
  lat           REAL NOT NULL CHECK (lat BETWEEN 6.0 AND 38.0),   -- India bbox
  lon           REAL NOT NULL CHECK (lon BETWEEN 68.0 AND 98.0),
  area_ha       REAL,               -- optional, B1
  geometry_json TEXT,               -- optional, Mera Khet only -- see note above
  status        TEXT NOT NULL DEFAULT 'unverified'
                CHECK (status IN ('unverified', 'verified')),     -- B4
  ip_hash       TEXT NOT NULL,      -- salted SHA-256, day-bucketed; see above
  ip_hash_day   TEXT NOT NULL,      -- the UTC date the hash was salted for, for the rate-limit query
  exported_at   TEXT                -- set by export_ground_truth.py once this row has left D1 for the public dataset
);

CREATE INDEX IF NOT EXISTS idx_submissions_ratelimit ON submissions (ip_hash, ip_hash_day);
CREATE INDEX IF NOT EXISTS idx_submissions_exported ON submissions (exported_at);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at);
