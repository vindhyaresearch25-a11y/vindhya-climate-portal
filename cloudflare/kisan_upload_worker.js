/**
 * kisan_upload_worker.js -- Cloudflare Worker for the farmer ground-truth
 * crop upload (CROP_DATA_PROMPT.md Bhaag B). NOT deployed by this repo's
 * own tooling -- deploy it yourself:
 *
 *   cd cloudflare
 *   wrangler d1 create vindhya-ground-truth
 *   # paste the returned database_id into wrangler_kisan_upload.toml
 *   wrangler d1 execute vindhya-ground-truth --remote --file=kisan_upload_schema.sql
 *   wrangler secret put RATE_LIMIT_SALT --config wrangler_kisan_upload.toml
 *   wrangler deploy --config wrangler_kisan_upload.toml
 *
 * Then put the Worker's *.workers.dev (or custom) URL into
 * dashboard/kisan_upload.html's SUBMIT_URL constant.
 *
 * What this Worker does NOT do: it never stores a name, phone number,
 * Aadhaar, or raw IP address (B1/B3). The only thing derived from the
 * request's IP is a same-day salted SHA-256 hash, used solely to enforce
 * the 20-submissions/IP/day rate limit (B4) -- it is never exported,
 * never reversible without RATE_LIMIT_SALT (a Worker secret, never
 * checked in), and a new day's hash for the same IP looks nothing like
 * the previous day's.
 */

const ALLOWED_ORIGIN = 'https://vindhyaresearch25-a11y.github.io';
const DAILY_LIMIT_PER_IP = 20;
// India's real bounding box (generous -- includes Andaman & Nicobar,
// Lakshadweep) -- anything outside this is rejected outright per B4
// ("Nirdeshank Bharat ke andar hone chahiye, warna reject").
const INDIA_BBOX = { latMin: 6.0, latMax: 38.0, lonMin: 68.0, lonMax: 98.0 };
const VALID_SEASONS = new Set(['kharif', 'rabi', 'zayad']);

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin === ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  return headers;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function handleSubmit(request, env) {
  const origin = request.headers.get('Origin') || '';
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, origin);
  }

  const crop = String(body.crop || '').trim();
  const season = String(body.season || '').trim().toLowerCase();
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const areaHa = body.area_ha != null && body.area_ha !== '' ? Number(body.area_ha) : null;
  const consent = body.consent === true;

  if (!consent) return json({ ok: false, error: 'consent_required' }, 400, origin);
  if (!crop || crop.length > 80) return json({ ok: false, error: 'invalid_crop' }, 400, origin);
  if (!VALID_SEASONS.has(season)) return json({ ok: false, error: 'invalid_season' }, 400, origin);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: 'invalid_location' }, 400, origin);
  if (lat < INDIA_BBOX.latMin || lat > INDIA_BBOX.latMax || lon < INDIA_BBOX.lonMin || lon > INDIA_BBOX.lonMax) {
    return json({ ok: false, error: 'location_outside_india' }, 400, origin);
  }
  if (areaHa != null && (!Number.isFinite(areaHa) || areaHa < 0 || areaHa > 10000)) {
    return json({ ok: false, error: 'invalid_area' }, 400, origin);
  }

  // Rate limit: a same-day salted hash of the connecting IP, never the IP
  // itself (B3/B4). RATE_LIMIT_SALT is a Worker secret (wrangler secret
  // put), never checked into this repo.
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const today = new Date().toISOString().slice(0, 10); // UTC date
  const ipHash = await sha256Hex(`${ip}|${today}|${env.RATE_LIMIT_SALT}`);

  const countRow = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND ip_hash_day = ?')
    .bind(ipHash, today)
    .first();
  if ((countRow?.n || 0) >= DAILY_LIMIT_PER_IP) {
    return json({ ok: false, error: 'rate_limited' }, 429, origin);
  }

  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO submissions (id, created_at, crop, season, lat, lon, area_ha, status, ip_hash, ip_hash_day)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?)`
    )
    .bind(id, new Date().toISOString(), crop, season, lat, lon, areaHa, ipHash, today)
    .run();

  return json({ ok: true, id }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/submit') {
      return handleSubmit(request, env);
    }
    return json({ ok: false, error: 'not_found' }, 404, origin);
  },
};
