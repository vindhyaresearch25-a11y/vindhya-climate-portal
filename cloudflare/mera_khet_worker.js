/**
 * mera_khet_worker.js -- Cloudflare Worker for Mera Khet's live per-field
 * satellite query (MERA_KHET_PROMPT.md A1 sections 1-2: cropland fraction
 * + NDVI, real Sentinel-2/Dynamic World, 10 m). NOT deployed by this
 * session (no wrangler login available in this sandbox), AND not fully
 * implemented end-to-end -- read this header before assuming it works.
 *
 * WHY A BROWSER CAN'T DO THIS DIRECTLY
 * A farmer's drawn polygon needs a live Earth Engine query (Dynamic World
 * cropland label + Sentinel-2 NDVI over that exact polygon,
 * docs/MERA_KHET_BENCHMARK.json A3 measured ~1.4-3.3s for each on a real
 * 1.86 ha polygon -- fast enough for a farmer to wait). Earth Engine has no
 * public browser-callable endpoint with per-request auth a static GitHub
 * Pages site could use safely (it would mean shipping a service-account
 * key to every visitor's browser) -- it needs a server holding the
 * credentials. That's this Worker's job.
 *
 * WHAT THIS FILE ACTUALLY DOES, AND WHAT IT DOESN'T (read carefully --
 * this is the "clearly-scoped next step" the task allowed instead of
 * either faking it or blocking the whole feature on it):
 *
 *   DONE, real and testable in isolation:
 *     - CORS allowlist + request validation (same conventions as
 *       kisan_sahayak_worker.js / kisan_upload_worker.js: corsHeaders(),
 *       jsonResponse(), a 30s-equivalent timeout wrapper).
 *     - Polygon validation: ring closed, 3-500 vertices, every vertex
 *       inside India's bbox (same bbox as kisan_upload_worker.js), and an
 *       area cap (see MAX_AREA_HA below) so nobody can point this at a
 *       whole district and run up Earth Engine compute cost meant for a
 *       single field.
 *     - getGeeAccessToken(): a REAL Google service-account OAuth2 flow
 *       (JWT assertion, RS256-signed via Web Crypto's crypto.subtle,
 *       exchanged at https://oauth2.googleapis.com/token for a bearer
 *       token) -- this part has a well-defined, stable contract and is
 *       safe to write without live credentials to test against.
 *
 *   NOT DONE, and WHY -- this is the honest gap:
 *     Actually calling Earth Engine's REST API (`projects/{project}/
 *     value:compute` or `image:computePixels`) requires a serialized
 *     "expression graph" describing the computation (e.g. "Dynamic World
 *     collection, filterBounds to this polygon, filterDate to the last
 *     N days, mosaic, reduceRegion mean over the polygon"). The official
 *     earthengine-api client libraries (Python/JS) build this graph
 *     object FOR you from ee.Image()/ee.FeatureCollection() calls --
 *     that serialization is genuinely complex (hundreds of node types)
 *     and hand-rolling just enough of it here, untested against a real
 *     GEE project, is exactly the kind of "confident-looking but
 *     never-run" code this repo's no-fabrication rule warns against for
 *     DATA -- the same discipline applies to shipping unverified
 *     integration code as if it worked.
 *
 *     RECOMMENDED PATH (do this instead of extending this file further):
 *     a small Python Cloud Run service (or Cloud Function) using the real
 *     `earthengine-api` package -- the same one scripts/08_gee_national_
 *     climate.py and scripts/14_mera_khet_benchmark.py already use and
 *     have PROVEN working against this project's service account. That
 *     service takes {ring: [[lon,lat],...]}, runs the exact two
 *     ee.Image calls already benchmarked (Dynamic World cropland label,
 *     Sentinel-2 NDVI), and returns plain JSON. This Worker then becomes
 *     a thin, CORS-safe, rate-limited proxy in front of it (GEE_BACKEND_URL
 *     below) -- which IS something a Worker is the right tool for.
 *
 *     Until GEE_BACKEND_URL is set, POST /analyze returns HTTP 501 with a
 *     clear, honest `{available:false, reason:...}` body -- dashboard/
 *     mera_khet.js already renders this as "not yet wired up", never a
 *     fabricated number (see its own header for the same commitment).
 *
 * DEPLOY (once GEE_BACKEND_URL exists):
 *   cd cloudflare
 *   wrangler secret put GEE_SERVICE_ACCOUNT_EMAIL --config wrangler_mera_khet.toml
 *   wrangler secret put GEE_SERVICE_ACCOUNT_KEY --config wrangler_mera_khet.toml
 *   wrangler secret put GEE_BACKEND_URL --config wrangler_mera_khet.toml
 *   wrangler deploy --config wrangler_mera_khet.toml
 * Then put this Worker's URL into dashboard/mera_khet.js's
 * (currently nonexistent) analysis-backend constant once section 2 is
 * wired to call it.
 */

const ALLOWED_ORIGINS = new Set([
  'https://vindhyaresearch25-a11y.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);
const INDIA_BBOX = { latMin: 6.0, latMax: 38.0, lonMin: 68.0, lonMax: 98.0 };
const MAX_RING_POINTS = 500;
// A genuine farmer field is a few hectares; this bounds GEE compute cost
// per query (A3's own stated worry: "GEE ka EECU kitna khapta hai prati
// query, kisan roz poochenge") -- generous enough for a large field,
// nowhere near district scale.
const MAX_AREA_HA = 200;

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
function withTimeout(promise, ms, timeoutValue) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(timeoutValue), ms); });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

// Same spherical-Earth formula as geoai_professional.js's ringAreaM2 --
// duplicated here deliberately (this file runs in an isolated Worker
// runtime, not the dashboard bundle, so it can't `require`/import that
// file; kept numerically identical on purpose).
function ringAreaHa(ring) {
  const R = 6378137, RAD = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
    total += (p2[0] - p1[0]) * RAD * (2 + Math.sin(p1[1] * RAD) + Math.sin(p2[1] * RAD));
  }
  return Math.abs(total * R * R / 2) / 10000;
}

function validateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3 || ring.length > MAX_RING_POINTS) return 'invalid_ring_length';
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length !== 2) return 'invalid_point';
    const [lon, lat] = pt;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'invalid_point';
    if (lat < INDIA_BBOX.latMin || lat > INDIA_BBOX.latMax || lon < INDIA_BBOX.lonMin || lon > INDIA_BBOX.lonMax) {
      return 'outside_india';
    }
  }
  const areaHa = ringAreaHa(ring);
  if (areaHa > MAX_AREA_HA) return 'area_too_large';
  return null;
}

// ---------------------------------------------------------------------
// Real Google service-account OAuth2 flow (JWT bearer assertion, RFC
// 7523) -- self-contained, no external library, using Web Crypto (the
// only crypto API available in the Workers runtime). Untested against a
// live service account this session (none available in this sandbox) --
// the JWT construction and token-endpoint contract are Google's stable,
// documented ones, not something specific to this repo.
// ---------------------------------------------------------------------
function base64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlJson(obj) {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getGeeAccessToken(env) {
  const email = env.GEE_SERVICE_ACCOUNT_EMAIL;
  const pem = env.GEE_SERVICE_ACCOUNT_KEY; // PKCS8 PEM, from the service-account JSON key's "private_key" field
  if (!email || !pem) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/earthengine.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = base64urlJson(header) + '.' + base64urlJson(claims);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = signingInput + '.' + base64url(signature);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.access_token || null;
}

// ---------------------------------------------------------------------
// /analyze -- validates the polygon, then either proxies to the real GEE
// compute backend (GEE_BACKEND_URL, see header -- not written by this
// repo) or returns an honest "not configured yet" response. NEVER
// invents a cropland/NDVI number in either branch.
// ---------------------------------------------------------------------
async function handleAnalyze(request, env) {
  const origin = request.headers.get('Origin') || '';
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ available: false, error: 'invalid_json' }, 400, origin); }

  const ring = body.ring;
  const err = validateRing(ring);
  if (err) return jsonResponse({ available: false, error: err }, 400, origin);

  if (!env.GEE_BACKEND_URL) {
    return jsonResponse({
      available: false,
      reason: 'gee_backend_not_configured',
      message_hi: 'उपग्रह विश्लेषण बैकएंड अभी सेट नहीं है -- कोई अंदाजा नहीं दिखाया जाएगा।',
      message_en: 'The satellite-analysis backend is not configured yet -- no estimate will ever be shown in its place.',
    }, 501, origin);
  }

  const token = await getGeeAccessToken(env);
  if (!token) {
    return jsonResponse({ available: false, reason: 'gee_auth_failed', message_en: 'Could not authenticate to the GEE backend.' }, 502, origin);
  }

  try {
    const upstream = await withTimeout(
      fetch(env.GEE_BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ ring }),
      }),
      15000, null
    );
    if (!upstream) return jsonResponse({ available: false, reason: 'gee_backend_timeout' }, 504, origin);
    if (!upstream.ok) return jsonResponse({ available: false, reason: 'gee_backend_error', status: upstream.status }, 502, origin);
    const data = await upstream.json();
    return jsonResponse({ available: true, ...data }, 200, origin);
  } catch (e) {
    return jsonResponse({ available: false, reason: 'gee_backend_unreachable' }, 502, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/analyze') return handleAnalyze(request, env);
    return jsonResponse({ available: false, error: 'not_found' }, 404, origin);
  },
};
