/**
 * mera_khet_worker.js -- Cloudflare Worker for Mera Khet's live per-field
 * satellite query (MERA_KHET_PROMPT.md A1 sections 1-2: cropland fraction
 * + NDVI, real Sentinel-2/Dynamic World, 10 m).
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
 * WHAT THIS FILE DOES (verified, not guessed -- see below for how)
 *   - CORS allowlist + request validation (same conventions as
 *     kisan_sahayak_worker.js / kisan_upload_worker.js: corsHeaders(),
 *     jsonResponse(), a timeout wrapper).
 *   - Polygon validation: 3-500 vertices, every vertex inside India's
 *     bbox (same bbox as kisan_upload_worker.js), and an area cap (see
 *     MAX_AREA_HA below) so nobody can point this at a whole district and
 *     run up Earth Engine compute cost meant for a single field.
 *   - getGeeAccessToken(): a real Google service-account OAuth2 flow (JWT
 *     assertion, RS256-signed via Web Crypto's crypto.subtle, exchanged at
 *     https://oauth2.googleapis.com/token for a bearer token), scope
 *     'https://www.googleapis.com/auth/earthengine.readonly'.
 *   - buildDwExpression() / buildNdviExpression(): call Earth Engine's
 *     REST API directly -- `POST https://earthengine.googleapis.com/v1/
 *     projects/{project}/value:compute` with body `{expression: <graph>}`
 *     -- no separate GEE_BACKEND_URL service, per the task's preferred
 *     option (a). This Worker alone performs the Earth Engine compute.
 *
 * HOW THE EXPRESSION GRAPH WAS OBTAINED (the hard part this header
 * originally flagged as unsafe to hand-roll -- it was NOT hand-rolled):
 *   1. In Python, using the real, already-proven `earthengine-api`
 *      library (the same one scripts/08_gee_national_climate.py and
 *      scripts/14_mera_khet_benchmark.py use against this project's own
 *      service account), the exact ee.Image computations below were
 *      built: Dynamic World V1 mode-composite over a date window,
 *      `.select('label')`, `reduceRegion(frequencyHistogram, ..., scale=10,
 *      bestEffort=True)`; and Sentinel-2 SR Harmonized, cloud-filtered
 *      (<20% CLOUDY_PIXEL_PERCENTAGE), most-recent-first, NDVI via
 *      normalizedDifference(['B8','B4']), `reduceRegion(mean, ...,
 *      scale=10, bestEffort=True)` -- the SAME computations
 *      14_mera_khet_benchmark.py already benchmarked as fast/working.
 *   2. `ee.serializer.encode(the_object, for_cloud_api=True)` -- Earth
 *      Engine's OWN client library serializing its own expression graph,
 *      never hand-written JSON -- produced the real JSON below. Tested
 *      with both a closed ring (repeated first/last point) and an OPEN
 *      ring (mera_khet.js's actual on-wire shape, pts.slice(), no
 *      duplicate closing vertex) -- confirmed identical computed results
 *      either way, and confirmed the encoder collapses an open ring's
 *      coordinates into ONE literal `constantValue` array (no per-point
 *      node/valueReference dedup to replicate), which is what
 *      buildDwExpression/buildNdviExpression below hardcode -- the ONLY
 *      variable part of the whole graph is that one coordinates array.
 *   3. Inspected `ee.data.computeValue()`'s own source
 *      (site-packages/ee/data.py) to confirm the exact REST contract:
 *      `POST /v1/projects/{project}/value:compute`, body
 *      `{"expression": <serialized graph>}`, bearer token with scope
 *      `earthengine.readonly` (not the client's broader default scope --
 *      tested explicitly with the readonly-only scope to match what
 *      getGeeAccessToken() below actually requests).
 *   4. VERIFIED side-by-side: built these exact hardcoded templates,
 *      substituted three different real polygons (4, 6, and 8 vertices,
 *      three different districts: Bhopal square from the A3 benchmark,
 *      an Indore hexagon, a Rewa octagon), called the raw REST endpoint
 *      with a readonly-scope token for each, and compared byte-for-byte
 *      against `ee.data.computeValue()` run independently in Python for
 *      the same polygons. All three matched exactly (DW histogram and
 *      NDVI mean, no tolerance needed -- literal equality). The templates
 *      below are copied verbatim from that verified output; only the
 *      coordinates and date-window values are substituted at request time.
 *
 * WHAT'S HONEST FAILURE, NOT FABRICATION, if it happens live:
 *   - Missing GEE_SERVICE_ACCOUNT_EMAIL/KEY/PROJECT_ID secrets/vars -> 501,
 *     `{available:false, reason:'gee_credentials_not_configured', ...}`.
 *   - OAuth token exchange fails -> 502 `gee_auth_failed`.
 *   - Either Earth Engine call errors, times out, or returns no matching
 *     imagery (e.g. no cloud-free Sentinel-2 scene in the window, or a
 *     polygon too small for a 10 m pixel to register in reduceRegion) ->
 *     that ONE field (ndvi or cropland_fraction) comes back `null` with
 *     an `..._error` string explaining why, never a guessed number. Only
 *     if BOTH fail does the whole response become `available:false`.
 *
 * NOT DONE, scoped out deliberately (see MERA_KHET_PROMPT.md A1.2):
 *   - 6-month NDVI time-series graph -- needs repeated computation across
 *     ~6 monthly composites (6x the Earth Engine calls, plus a decision on
 *     compositing/cloud-gap handling per month), not just one point-in-time
 *     value. Left as a clearly-scoped next step, not rushed in unverified.
 *
 * DEPLOY:
 *   cd cloudflare
 *   wrangler secret put GEE_SERVICE_ACCOUNT_EMAIL --config wrangler_mera_khet.toml
 *   wrangler secret put GEE_SERVICE_ACCOUNT_KEY --config wrangler_mera_khet.toml
 *     # the "private_key" field of the service account's JSON key, PEM format
 *   wrangler deploy --config wrangler_mera_khet.toml
 *     # GEE_PROJECT_ID is a plain (non-secret) var, set in wrangler_mera_khet.toml
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
// only crypto API available in the Workers runtime). The JWT construction
// and token-endpoint contract are Google's stable, documented ones. The
// 'earthengine.readonly' scope requested below was verified sufficient
// for the value:compute REST call this Worker makes (tested directly
// against a real Earth Engine service account with a token minted for
// exactly this scope, not the earthengine-api Python client's broader
// default scope set) -- see the file header, point 3.
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
// Earth Engine expression-graph templates -- copied verbatim from
// ee.serializer.encode(..., for_cloud_api=True) output (see file header,
// points 1-2), for the exact two computations 14_mera_khet_benchmark.py
// benchmarked: Dynamic World mode-composite cropland label
// (frequencyHistogram over the polygon) and Sentinel-2 NDVI (mean over
// the polygon, most recent cloud-free scene). The ONLY variable part in
// each is the geometry's `coordinates` constantValue (node "1") and the
// date-window strings -- everything else, including node numbering
// ("0"/"1"/"2"), is exactly what the real serializer produced and what
// was verified against a live value:compute call. Do not "clean up" the
// node numbering or structure without re-verifying against a live GEE
// project -- this is not hand-rolled JSON, it is a template.
// ---------------------------------------------------------------------
function ringToPolygonNode(ring) {
  return {
    functionInvocationValue: {
      functionName: 'GeometryConstructors.Polygon',
      arguments: {
        coordinates: { constantValue: [ring] }, // ring: [[lon,lat],...], open or closed, EE accepts either (verified)
        evenOdd: { constantValue: true },
      },
    },
  };
}

// Dynamic World V1 class "label" band: 0 water, 1 trees, 2 grass,
// 3 flooded_vegetation, 4 crops, 5 shrub_and_scrub, 6 built, 7 bare,
// 8 snow_and_ice -- Google's own published Dynamic World class schema
// (https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1),
// not something inferred from this repo's own data.
const DW_CROPLAND_CLASS = '4';

function buildDwExpression(ring, startDate, endDate) {
  return {
    result: '0',
    values: {
      '1': ringToPolygonNode(ring),
      '2': { functionInvocationValue: { functionName: 'Image.select', arguments: {
        bandSelectors: { constantValue: ['label'] },
        input: { argumentReference: '_MAPPING_VAR_0_0' },
      } } },
      '0': { functionInvocationValue: { functionName: 'Image.reduceRegion', arguments: {
        bestEffort: { constantValue: true },
        geometry: { valueReference: '1' },
        image: { functionInvocationValue: { functionName: 'reduce.mode', arguments: {
          collection: { functionInvocationValue: { functionName: 'Collection.map', arguments: {
            baseAlgorithm: { functionDefinitionValue: { argumentNames: ['_MAPPING_VAR_0_0'], body: '2' } },
            collection: { functionInvocationValue: { functionName: 'Collection.filter', arguments: {
              collection: { functionInvocationValue: { functionName: 'Collection.filter', arguments: {
                collection: { functionInvocationValue: { functionName: 'ImageCollection.load', arguments: {
                  id: { constantValue: 'GOOGLE/DYNAMICWORLD/V1' },
                } } },
                filter: { functionInvocationValue: { functionName: 'Filter.intersects', arguments: {
                  leftField: { constantValue: '.all' },
                  rightValue: { functionInvocationValue: { functionName: 'Feature', arguments: {
                    geometry: { valueReference: '1' },
                  } } } } } },
              } } },
              filter: { functionInvocationValue: { functionName: 'Filter.dateRangeContains', arguments: {
                leftValue: { functionInvocationValue: { functionName: 'DateRange', arguments: {
                  end: { constantValue: endDate }, start: { constantValue: startDate },
                } } },
                rightField: { constantValue: 'system:time_start' },
              } } },
            } } },
          } } },
        } } },
        reducer: { functionInvocationValue: { functionName: 'Reducer.frequencyHistogram', arguments: {} } },
        scale: { constantValue: 10 },
      } } },
    },
  };
}

function buildNdviExpression(ring, startDate, endDate) {
  return {
    result: '0',
    values: {
      '1': ringToPolygonNode(ring),
      '2': { constantValue: 'system:time_start' },
      '0': { functionInvocationValue: { functionName: 'Image.reduceRegion', arguments: {
        bestEffort: { constantValue: true },
        geometry: { valueReference: '1' },
        image: { functionInvocationValue: { functionName: 'Image.rename', arguments: {
          input: { functionInvocationValue: { functionName: 'Image.normalizedDifference', arguments: {
            bandNames: { constantValue: ['B8', 'B4'] },
            input: { functionInvocationValue: { functionName: 'Collection.first', arguments: {
              collection: { functionInvocationValue: { functionName: 'Collection.limit', arguments: {
                ascending: { constantValue: false },
                collection: { functionInvocationValue: { functionName: 'Collection.filter', arguments: {
                  collection: { functionInvocationValue: { functionName: 'Collection.filter', arguments: {
                    collection: { functionInvocationValue: { functionName: 'Collection.filter', arguments: {
                      collection: { functionInvocationValue: { functionName: 'ImageCollection.load', arguments: {
                        id: { constantValue: 'COPERNICUS/S2_SR_HARMONIZED' },
                      } } },
                      filter: { functionInvocationValue: { functionName: 'Filter.intersects', arguments: {
                        leftField: { constantValue: '.all' },
                        rightValue: { functionInvocationValue: { functionName: 'Feature', arguments: {
                          geometry: { valueReference: '1' },
                        } } } } } },
                    } } },
                    filter: { functionInvocationValue: { functionName: 'Filter.dateRangeContains', arguments: {
                      leftValue: { functionInvocationValue: { functionName: 'DateRange', arguments: {
                        end: { constantValue: endDate }, start: { constantValue: startDate },
                      } } },
                      rightField: { valueReference: '2' },
                    } } },
                  } } },
                  filter: { functionInvocationValue: { functionName: 'Filter.lessThan', arguments: {
                    leftField: { constantValue: 'CLOUDY_PIXEL_PERCENTAGE' },
                    rightValue: { constantValue: 20 },
                  } } },
                } } },
                key: { valueReference: '2' },
              } } },
            } } },
          } } },
          names: { constantValue: ['ndvi'] },
        } } },
        reducer: { functionInvocationValue: { functionName: 'Reducer.mean', arguments: {} } },
        scale: { constantValue: 10 },
      } } },
    },
  };
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function monthsAgoIso(n) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return isoDate(d);
}

// Dynamic World: a wide window for a stable mode-composite (a single
// recent scene can be noisy pixel-to-pixel); Sentinel-2 NDVI: a narrower
// window so the "most recent cloud-free scene" is actually recent. Same
// window widths 14_mera_khet_benchmark.py used (19 months / 6 months),
// computed relative to "now" instead of hardcoded past dates so this
// stays correct as time passes.
const DW_WINDOW_MONTHS = 19;
const S2_WINDOW_MONTHS = 6;

async function eeCompute(expression, token, projectId) {
  const url = 'https://earthengine.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/value:compute';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ expression }),
  });
  let data = null;
  try { data = await resp.json(); } catch { /* fall through, resp.ok check below reports it */ }
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + resp.status);
    throw new Error(msg);
  }
  return data ? data.result : undefined;
}

function croplandFractionFromHistogram(hist) {
  if (!hist || typeof hist !== 'object') return null;
  let total = 0;
  for (const k of Object.keys(hist)) total += Number(hist[k]) || 0;
  if (!(total > 0)) return null;
  const cropPixels = Number(hist[DW_CROPLAND_CLASS]) || 0;
  return cropPixels / total;
}

const GEE_COMPUTE_TIMEOUT_MS = 20000;
const TIMEOUT_SENTINEL = { __timeout: true };

// ---------------------------------------------------------------------
// /analyze -- validates the polygon, then calls Earth Engine's REST API
// directly (see file header for how the expression graphs below were
// obtained and verified). NEVER invents a cropland/NDVI number: any
// failure surfaces as available:false or a null field with an
// explanatory *_error string, never a plausible-looking guess.
// ---------------------------------------------------------------------
async function handleAnalyze(request, env) {
  const origin = request.headers.get('Origin') || '';
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ available: false, error: 'invalid_json' }, 400, origin); }

  const ring = body.ring;
  const err = validateRing(ring);
  if (err) return jsonResponse({ available: false, error: err }, 400, origin);

  const projectId = env.GEE_PROJECT_ID;
  if (!env.GEE_SERVICE_ACCOUNT_EMAIL || !env.GEE_SERVICE_ACCOUNT_KEY || !projectId) {
    return jsonResponse({
      available: false,
      reason: 'gee_credentials_not_configured',
      message_hi: 'उपग्रह विश्लेषण के लिए सर्वर पर GEE क्रेडेंशियल अभी सेट नहीं हैं -- कोई अंदाजा नहीं दिखाया जाएगा।',
      message_en: 'GEE credentials are not configured on the server yet -- no estimate will ever be shown in its place.',
    }, 501, origin);
  }

  const token = await getGeeAccessToken(env);
  if (!token) {
    return jsonResponse({ available: false, reason: 'gee_auth_failed', message_en: 'Could not authenticate to Earth Engine.' }, 502, origin);
  }

  const dwStart = monthsAgoIso(DW_WINDOW_MONTHS), dwEnd = isoDate(new Date());
  const s2Start = monthsAgoIso(S2_WINDOW_MONTHS), s2End = isoDate(new Date());
  const dwExpr = buildDwExpression(ring, dwStart, dwEnd);
  const ndviExpr = buildNdviExpression(ring, s2Start, s2End);

  const [dwOutcome, ndviOutcome] = await Promise.allSettled([
    withTimeout(eeCompute(dwExpr, token, projectId), GEE_COMPUTE_TIMEOUT_MS, TIMEOUT_SENTINEL),
    withTimeout(eeCompute(ndviExpr, token, projectId), GEE_COMPUTE_TIMEOUT_MS, TIMEOUT_SENTINEL),
  ]);

  let croplandFraction = null, croplandError = null;
  if (dwOutcome.status === 'fulfilled' && dwOutcome.value && dwOutcome.value !== TIMEOUT_SENTINEL) {
    croplandFraction = croplandFractionFromHistogram(dwOutcome.value.label);
    if (croplandFraction === null) croplandError = 'no_dynamic_world_pixels_in_polygon';
  } else if (dwOutcome.status === 'fulfilled' && dwOutcome.value === TIMEOUT_SENTINEL) {
    croplandError = 'gee_timeout';
  } else {
    croplandError = String((dwOutcome.reason && dwOutcome.reason.message) || dwOutcome.reason || 'gee_error');
  }

  let ndviVal = null, ndviError = null;
  if (ndviOutcome.status === 'fulfilled' && ndviOutcome.value && ndviOutcome.value !== TIMEOUT_SENTINEL && ndviOutcome.value.ndvi != null) {
    ndviVal = ndviOutcome.value.ndvi;
  } else if (ndviOutcome.status === 'fulfilled' && ndviOutcome.value === TIMEOUT_SENTINEL) {
    ndviError = 'gee_timeout';
  } else if (ndviOutcome.status === 'fulfilled') {
    ndviError = 'no_cloud_free_sentinel2_scene_in_window'; // e.g. collection.first() on an empty filtered collection
  } else {
    ndviError = String((ndviOutcome.reason && ndviOutcome.reason.message) || ndviOutcome.reason || 'gee_error');
  }

  if (ndviVal === null && croplandFraction === null) {
    return jsonResponse({
      available: false, reason: 'gee_compute_failed', ndvi_error: ndviError, cropland_error: croplandError,
      message_en: 'Both the NDVI and cropland Earth Engine queries failed for this field -- no estimate shown.',
    }, 502, origin);
  }

  const resp = {
    available: true,
    ndvi: ndviVal,
    cropland_fraction: croplandFraction,
    source: 'Google Earth Engine, live per-field query: Sentinel-2 SR Harmonized NDVI (10 m, most recent cloud-free scene, ' + s2Start + ' to ' + s2End + ') + Dynamic World V1 cropland classification (10 m, mode composite, ' + dwStart + ' to ' + dwEnd + ')',
  };
  if (ndviError) resp.ndvi_error = ndviError;
  if (croplandError) resp.cropland_error = croplandError;
  return jsonResponse(resp, 200, origin);
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
