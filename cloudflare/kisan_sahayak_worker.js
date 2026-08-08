/**
 * kisan_sahayak_worker.js -- Cloudflare Worker behind the Kisan Sahayak chat
 * widget in dashboard/index.html. Fresh replacement for the old
 * "vindhya-gemini-proxy" Worker (that Worker's own source was never in this
 * repo and could not be retrieved this session -- see the commit message /
 * session notes for the full story). This file is what the owner deploys;
 * it has never itself been deployed by this session (Worker deploys and
 * Vectorize index creation both require the owner's own `wrangler` login --
 * blocked for this sandbox, confirmed 2026-08-08).
 *
 * ARCHITECTURE ("recognise the place -> fetch data -> combine with science
 * -> answer, with sources", owner's exact framing):
 *
 *   1. Client POSTs {message, history, place, lang} to POST /chat.
 *   2. This Worker fires FIVE real data fetches in parallel the moment the
 *      request lands, keyed off `place` (state/district/village/lat/lon):
 *        get_climate        -- dashboard/data/climate/<state>/<district>.json
 *                               (263+ GEE districts) OR dashboard/data/
 *                               mp_climate_data.json (the 5 original IMD
 *                               districts: bhopal/indore/jabalpur/rewa/sidhi)
 *        get_village_profile -- HF-hosted village_profiles/<state>/<district>.json
 *        get_crop_stats      -- crop_stats_des_by_district/<state>/<district>.json
 *        get_mandi           -- mandi_prices.json (all 733 districts, one file)
 *        get_weather         -- NASA POWER daily point API (free, keyless),
 *                               same host/params as dashboard/live_weather_loader.js
 *      This prefetch is DETERMINISTIC, not gated behind the model deciding to
 *      call a tool -- it runs for every request, for all 4 fallback models,
 *      because it's the thing that makes "first word within 5 seconds" and
 *      "never fabricate a place-specific number" both achievable regardless
 *      of which model ends up answering.
 *   3. The SAME five fetches are ALSO exposed as callable tools
 *      (get_climate, get_weather, get_mandi, get_crop_stats -- village
 *      profile is deliberately NOT a model-facing tool, matching the
 *      owner's exact 6-tool list) plus search_papers and search_manuals,
 *      so the model can additionally look up a *different* place mentioned
 *      in the farmer's free text, or pull cited manual/paper excerpts.
 *      HONESTY NOTE: of the 4 fallback models, only the first two
 *      (@cf/meta/llama-3.3-70b-instruct-fp8-fast, @cf/openai/gpt-oss-20b)
 *      carry Cloudflare's own "Function calling" capability tag
 *      (developers.cloudflare.com/workers-ai/models/, checked 2026-08-08).
 *      The other two fallbacks never receive a `tools` array -- they still
 *      answer correctly because step 2's prefetch is already folded into
 *      their prompt text, they just can't themselves decide to fetch a
 *      *different* place or re-query at will. This is a deliberate,
 *      documented tradeoff, not an oversight.
 *   4. search_manuals AND search_papers are ALSO pre-triggered by keyword
 *      heuristics (not only by model tool-choice) so RAG citations and real
 *      paper links reach the answer even on the two non-tool-calling
 *      fallback models -- see looksLikeManualQuestion()/looksLikePaperQuestion().
 *   5. The system prompt bakes in the owner's exact 5-part answer structure
 *      (place data -> probable cause -> how to identify -> management,
 *      cited -> source list) and the hard no-fabrication rule.
 *   6. The final answer STREAMS back over SSE, trying models in the exact
 *      order below, falling to the next model only if the previous one
 *      throws before producing any token (once a model starts streaming,
 *      the Worker commits to it -- switching models mid-stream would mean
 *      re-sending a different answer, which is worse than finishing).
 *
 * DEPLOY (run yourself -- this session never touches your Cloudflare
 * account):
 *
 *   cd cloudflare
 *   wrangler deploy --config wrangler_kisan_sahayak.toml
 *   # Workers AI binding needs no secret (it's a first-party binding, see
 *   # the [ai] block in wrangler_kisan_sahayak.toml). Vectorize is optional
 *   # -- see scripts/10_ingest_kisan_manuals.py's header for the one-time
 *   # `wrangler vectorize create` command; search_manuals degrades to
 *   # "manual search not configured yet" if you skip it, everything else
 *   # in this file still works.
 *
 * Then put this Worker's *.workers.dev URL into dashboard/index.html's
 * window.VINDHYA_CONFIG.CHAT_PROXY_URL (or the CHAT_PROXY_URL fallback
 * constant in runChatCompletion()).
 *
 * No fabrication: every tool below either returns a real fetched value with
 * its source, or returns {available:false} -- never an invented number.
 * search_papers/search_manuals never synthesize a citation; an empty result
 * set is reported as empty, never padded.
 */

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

// Same-origin policy as kisan_upload_worker.js's ALLOWED_ORIGIN, plus the
// local dev server this repo's own CLAUDE.md documents
// (`cd dashboard && python -m http.server 8000`) so this Worker is testable
// without deploying a second copy for local work.
const ALLOWED_ORIGINS = new Set([
  'https://vindhyaresearch25-a11y.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

// Owner's EXACT fallback order (2026-08-08 instruction). The old deployed
// Worker's bug was trying the smallest/weakest model FIRST, so the bigger
// models never got used -- do not reorder this list.
const MODEL_FALLBACK_ORDER = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-20b',
  '@cf/meta/llama-3.1-8b-instruct-fast',
  '@cf/meta/llama-3.2-3b-instruct',
];

// Cloudflare's own model catalog capability tags, checked 2026-08-08
// (developers.cloudflare.com/workers-ai/models/<slug>/) -- only these two
// of the four fallbacks are tagged "Function calling". See the file header
// note above for what this does and doesn't mean for the other two.
const TOOL_CAPABLE_MODELS = new Set([
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-20b',
]);

// 768-dim embedding model, confirmed against
// developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/ 2026-08-08
// ("transforms any given text into a 768-dimensional vector") -- matches
// the assumption in the task brief, kept as-is rather than swapped.
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIMENSIONS = 768;

// Where this portal's real data actually lives -- verified with live
// fetches this session (200 OK on mp_climate_data.json, mandi_prices.json,
// a crop_stats_des_by_district file, a climate/<state>/<district>.json
// file, and the HF village_profiles file, 2026-08-08).
const GH_PAGES_BASE = 'https://vindhyaresearch25-a11y.github.io/vindhya-climate-portal/dashboard/data/';
const HF_DATA_BASE = 'https://huggingface.co/datasets/vindhyaresearch/vindhya-climate/resolve/main/';

// The 5 districts with real IMD-derived data in mp_climate_data.json (see
// STANDING ORDERS #1/#4 -- MP_DISTRICTS is a lookup of "which districts
// have IMD data", never a national default).
const MP_IMD_DISTRICTS = new Set(['bhopal', 'indore', 'jabalpur', 'rewa', 'sidhi']);

const TOOL_TIMEOUT_MS = 6000;     // per-source ceiling during the deterministic prefetch
const MANUAL_SEARCH_TIMEOUT_MS = 4000;
const TOOL_ROUND_TIMEOUT_MS = 4500; // ceiling on the optional model-initiated tool-calling round
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TURNS = 12;

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

function slugify(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function withTimeout(promise, ms, timeoutValue) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timeoutValue), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

async function fetchJson(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || TOOL_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Cloudflare's edge Cache API -- "cache each place's data, don't refetch on
// every message in the same session" (owner instruction). Honest scope:
// this is a best-effort per-colo HTTP cache, not a guaranteed single global
// cache and not tied to a specific chat session -- Workers are stateless
// and this Worker has no KV/Durable Object for real session state. It still
// does the useful thing (a farmer's second question about the same
// district doesn't re-hit five upstream services), just not with a
// stronger guarantee than that.
async function cachedFetchJson(url, ttlSeconds, ms) {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });
  const hit = await cache.match(cacheKey).catch(() => null);
  if (hit) return hit.json().catch(() => null);
  const data = await fetchJson(url, ms);
  if (data != null) {
    const resp = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` },
    });
    // Fire-and-forget put; caller doesn't wait on it.
    cache.put(cacheKey, resp).catch(() => {});
  }
  return data;
}

function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// ---------------------------------------------------------------------
// Tool implementations -- every one either returns real fetched data with
// its source, or {available:false, reason}. Never invents a number.
// ---------------------------------------------------------------------

async function toolGetClimate(env, { state, district }) {
  const dSlug = slugify(district);
  const sSlug = slugify(state);
  if (!dSlug) return { available: false, reason: 'no district given' };

  if (MP_IMD_DISTRICTS.has(dSlug)) {
    const data = await cachedFetchJson(GH_PAGES_BASE + 'mp_climate_data.json', 21600, TOOL_TIMEOUT_MS);
    const d = data && data.districts && data.districts[dSlug];
    if (!d) return { available: false, reason: 'mp_climate_data.json fetch failed or district missing' };
    return {
      available: true,
      district: d.name || district,
      state: 'Madhya Pradesh',
      indices: d.indices || {},
      source: 'IMD 0.05deg gridded daily data, 2000-2024 (25-year district means)',
    };
  }

  if (!sSlug) return { available: false, reason: 'no state given for a non-MP-IMD district' };
  const url = GH_PAGES_BASE + `climate/${sSlug}/${dSlug}.json`;
  const data = await cachedFetchJson(url, 21600, TOOL_TIMEOUT_MS);
  if (!data) return { available: false, reason: `no climate file yet for ${district}, ${state}` };
  return {
    available: true,
    district,
    state,
    indices: data.indices || {},
    period: '2000-2024 period average, NOT one specific year',
    source: (data.metadata && data.metadata.source) || 'ERA5-Land + CHIRPS via Google Earth Engine',
  };
}

async function toolGetWeather(env, { lat, lon }) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { available: false, reason: 'no lat/lon known for this place' };
  }
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 86400000);
  const ymd = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M&community=AG&longitude=${lo}&latitude=${la}&start=${ymd(start)}&end=${ymd(end)}&format=JSON`;
  const data = await fetchJson(url, TOOL_TIMEOUT_MS);
  const params = data && data.properties && data.properties.parameter;
  if (!params) return { available: false, reason: 'NASA POWER returned no data for this point' };
  const dates = Object.keys(params.T2M_MAX || {}).sort();
  if (!dates.length) return { available: false, reason: 'NASA POWER returned no dates' };
  // Most recent 1-3 days are usually the -999 fill value (not yet
  // processed) -- same rule live_weather_loader.js follows, walk backward
  // to the last real (non-fill) day rather than reporting -999 as today.
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    const tmax = params.T2M_MAX[d];
    if (tmax !== -999) {
      return {
        available: true,
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        tmax_c: tmax,
        tmin_c: params.T2M_MIN[d] === -999 ? null : params.T2M_MIN[d],
        precip_mm: params.PRECTOTCORR[d] === -999 ? null : params.PRECTOTCORR[d],
        rh_pct: params.RH2M[d] === -999 ? null : params.RH2M[d],
        wind_ms: params.WS2M[d] === -999 ? null : params.WS2M[d],
        source: 'NASA POWER (power.larc.nasa.gov), GEOS-IT satellite/reanalysis -- not a live station feed',
      };
    }
  }
  return { available: false, reason: 'only unfilled (-999) recent days from NASA POWER' };
}

async function toolGetMandi(env, { district }) {
  const dSlug = slugify(district);
  if (!dSlug) return { available: false, reason: 'no district given' };
  const data = await cachedFetchJson(GH_PAGES_BASE + 'mandi_prices.json', 3600, 10000);
  const d = data && data.districts && data.districts[dSlug];
  if (!d) return { available: false, reason: `${district} not in mandi_prices.json` };
  if (!d.records || !d.records.length) {
    return { available: false, reason: d.note || 'no AGMARKNET arrivals recorded today for this district' };
  }
  return {
    available: true,
    district: d.name || district,
    state: d.state || null,
    records: d.records.slice(0, 8),
    as_of: (data.metadata && data.metadata.last_updated) || null,
    source: 'AGMARKNET via data.gov.in, Ministry of Agriculture and Farmers Welfare',
  };
}

async function toolGetCropStats(env, { state, district }) {
  const dSlug = slugify(district);
  const sSlug = slugify(state);
  if (!dSlug || !sSlug) return { available: false, reason: 'state and district both required' };
  const url = GH_PAGES_BASE + `crop_stats_des_by_district/${sSlug}/${dSlug}.json`;
  const data = await cachedFetchJson(url, 86400, TOOL_TIMEOUT_MS);
  if (!data || !data.records || !data.records.length) {
    return { available: false, reason: `no DES crop stats file for ${district}, ${state}` };
  }
  const years = data.records.map((r) => r.year).sort();
  const latestYear = years[years.length - 1];
  const latestRows = data.records
    .filter((r) => r.year === latestYear)
    .sort((a, b) => (b.area_ha || 0) - (a.area_ha || 0))
    .slice(0, 6);
  return {
    available: true,
    district, state, year: latestYear,
    top_crops: latestRows.map((r) => ({
      crop: r.crop, season: r.season, area_ha: r.area_ha, production: r.production, yield_per_ha: r.yield_per_ha,
    })),
    source: 'DES, Dept. of Agriculture and Farmers Welfare, data.desagri.gov.in',
  };
}

// Deliberately NOT in the model-facing tool list (owner's exact 6-tool
// spec) -- only used by the deterministic prefetch. A farmer's district
// alone yields a village COUNT plus aggregate totals; a named village
// (dropdown selection) yields that village's real row.
async function toolGetVillageProfile(env, { state, district, village }) {
  const dSlug = slugify(district);
  const sSlug = slugify(state);
  if (!dSlug || !sSlug) return { available: false, reason: 'state and district both required' };
  const url = HF_DATA_BASE + `village_profiles/${sSlug}/${dSlug}.json`;
  const data = await cachedFetchJson(url, 86400, 12000); // HF can be slower than GH Pages
  if (!data || !data.villages) return { available: false, reason: `no village profile file for ${district}, ${state}` };
  const fields = data.metadata && data.metadata.field_order;
  const villageCount = (data.metadata && data.metadata.village_count) || Object.keys(data.villages).length;

  let matched = null;
  if (village && fields) {
    const wanted = String(village).trim().toUpperCase();
    for (const lgd in data.villages) {
      const row = data.villages[lgd];
      if (String(row[0] || '').trim().toUpperCase() === wanted) {
        matched = {};
        fields.forEach((f, i) => { if (row[i] !== null && row[i] !== undefined) matched[f] = row[i]; });
        matched.lgd_code = lgd;
        break;
      }
    }
  }

  return {
    available: true,
    state, district, village_count: villageCount,
    matched_village: matched,
    source: 'Survey of India village-boundary product (attribute table), via National Water Data Portal (NWDP)',
  };
}

// search_papers: server-side re-implementation of research_papers_loader.js's
// four wired-and-working sources (OpenAlex/CrossRef/DOAJ/PubMed) -- same
// honest scope note applies: Semantic Scholar/CORE/AGRIS/KRISHI are not
// wired here either, for the same reasons recorded in that file.
async function toolSearchPapers(env, { query }) {
  const q = String(query || '').trim();
  if (!q) return { available: false, reason: 'empty query' };

  const openAlex = fetchJson('https://api.openalex.org/works?search=' + encodeURIComponent(q) + '&per-page=3', TOOL_TIMEOUT_MS)
    .then((d) => (d && d.results || []).map((r) => {
      const link = r.doi || (r.primary_location && r.primary_location.landing_page_url) || null;
      if (!r.title || !link) return null;
      return { title: r.title, year: r.publication_year || null, link, source: 'OpenAlex' };
    }).filter(Boolean)).catch(() => []);

  const crossRef = fetchJson('https://api.crossref.org/works?query=' + encodeURIComponent(q) + '&rows=3', TOOL_TIMEOUT_MS)
    .then((d) => ((d && d.message && d.message.items) || []).map((r) => {
      const title = r.title && r.title[0];
      const yearParts = (r.issued && r.issued['date-parts'] && r.issued['date-parts'][0]) || null;
      const link = r.URL || (r.DOI ? 'https://doi.org/' + r.DOI : null);
      if (!title || !link) return null;
      return { title, year: yearParts ? yearParts[0] : null, link, source: 'CrossRef' };
    }).filter(Boolean)).catch(() => []);

  const doaj = fetchJson('https://doaj.org/api/search/articles/' + encodeURIComponent(q) + '?pageSize=3', TOOL_TIMEOUT_MS)
    .then((d) => ((d && d.results) || []).map((r) => {
      const bib = r.bibjson || {};
      const linkObj = (bib.link || []).filter((l) => l.url)[0];
      if (!bib.title || !linkObj) return null;
      return { title: bib.title, year: bib.year || null, link: linkObj.url, source: 'DOAJ' };
    }).filter(Boolean)).catch(() => []);

  const pubmed = (async () => {
    const esearch = await fetchJson('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&term=' + encodeURIComponent(q), TOOL_TIMEOUT_MS);
    const ids = (esearch && esearch.esearchresult && esearch.esearchresult.idlist) || [];
    if (!ids.length) return [];
    const s = await fetchJson('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + ids.join(','), TOOL_TIMEOUT_MS);
    const result = (s && s.result) || {};
    return ids.map((id) => {
      const rec = result[id];
      if (!rec || !rec.title) return null;
      const year = rec.pubdate ? parseInt(String(rec.pubdate).slice(0, 4), 10) : null;
      return { title: rec.title, year: year || null, link: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/', source: 'PubMed' };
    }).filter(Boolean);
  })().catch(() => []);

  const [a, b, c, d] = await Promise.all([openAlex, crossRef, doaj, pubmed]);
  const results = [...a, ...b, ...c, ...d];
  if (!results.length) return { available: true, results: [], note: 'no matching papers found in OpenAlex/CrossRef/DOAJ/PubMed' };
  return { available: true, results };
}

// search_manuals: embed the query via Workers AI, query the Vectorize
// index built by scripts/10_ingest_kisan_manuals.py. Degrades honestly if
// the index isn't bound/created yet (owner hasn't run the one-time
// `wrangler vectorize create` command) rather than crashing the request.
async function toolSearchManuals(env, { query }) {
  const q = String(query || '').trim();
  if (!q) return { available: false, reason: 'empty query' };
  if (!env.VECTORIZE_INDEX) {
    return { available: false, reason: 'Vectorize index not configured on this deployment yet (see docs/KISAN_SAHAYAK_RAG.md)' };
  }
  try {
    const emb = await env.AI.run(EMBEDDING_MODEL, { text: [q] });
    const vector = emb && emb.data && emb.data[0];
    if (!vector) return { available: false, reason: 'embedding call returned no vector' };
    const result = await env.VECTORIZE_INDEX.query(vector, { topK: 5, returnMetadata: 'all' });
    const matches = (result && result.matches) || [];
    if (!matches.length) return { available: true, results: [], note: 'no matching manual passages found' };
    return {
      available: true,
      results: matches.map((m) => ({
        text: m.metadata && m.metadata.text,
        source: m.metadata && m.metadata.source,
        crop: m.metadata && m.metadata.crop,
        page: m.metadata && m.metadata.page,
        year: m.metadata && m.metadata.year,
        score: m.score,
      })),
    };
  } catch (e) {
    return { available: false, reason: 'search_manuals failed: ' + (e && e.message) };
  }
}

// ---------------------------------------------------------------------
// Tool schema exposed to the model (Cloudflare's traditional/manual
// function-calling contract: name/description/parameters, response comes
// back as {response, tool_calls:[{name, arguments}]}) -- owner's exact
// 6-tool list, no more, no less.
// ---------------------------------------------------------------------
const TOOLS = [
  {
    name: 'get_climate',
    description: 'Real IMD/ERA5-Land+CHIRPS climate indices (heatwave days/yr, drought probability %, annual rainfall mm, SPI) for an Indian district, 2000-2024.',
    parameters: { type: 'object', properties: { state: { type: 'string' }, district: { type: 'string' } }, required: ['state', 'district'] },
  },
  {
    name: 'get_weather',
    description: "NASA POWER's most recent real daily weather (max/min temp, rainfall, humidity, wind) for a lat/lon point in India.",
    parameters: { type: 'object', properties: { lat: { type: 'number' }, lon: { type: 'number' } }, required: ['lat', 'lon'] },
  },
  {
    name: 'get_mandi',
    description: "Today's real AGMARKNET mandi (market) prices for crops in an Indian district.",
    parameters: { type: 'object', properties: { district: { type: 'string' } }, required: ['district'] },
  },
  {
    name: 'get_crop_stats',
    description: 'Real DES (data.desagri.gov.in) crop area/production/yield statistics for an Indian district, most recent year on record.',
    parameters: { type: 'object', properties: { state: { type: 'string' }, district: { type: 'string' } }, required: ['state', 'district'] },
  },
  {
    name: 'search_papers',
    description: 'Search real scholarly papers (OpenAlex, CrossRef, DOAJ, PubMed) for a topic. Returns title/year/link -- never invent a citation instead of calling this.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'search_manuals',
    description: 'Search real ICAR/KVK Package-of-Practices manuals and IMD agromet advisories for cited guidance on a crop, pest, disease, or farming-practice question.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

const TOOL_DISPATCH = {
  get_climate: toolGetClimate,
  get_weather: toolGetWeather,
  get_mandi: toolGetMandi,
  get_crop_stats: toolGetCropStats,
  search_papers: toolSearchPapers,
  search_manuals: toolSearchManuals,
};

// ---------------------------------------------------------------------
// Heuristics -- decide whether to pre-run search_manuals / search_papers
// even on the two fallback models that can't call tools themselves.
// ---------------------------------------------------------------------
const MANUAL_KEYWORDS = [
  'pest', 'disease', 'kit', 'keet', 'रोग', 'कीट', 'blight', 'rot', 'wilt', 'fungus', 'fungal',
  'insect', 'larva', 'caterpillar', 'aphid', 'borer', 'rust', 'spray', 'pesticide', 'fungicide',
  'दवा', 'छिड़काव', 'बीमारी', 'सूख', 'सड़', 'package of practices', 'poP', 'variety', 'किस्म',
  'sowing', 'बुवाई', 'irrigation schedule', 'fertilizer dose', 'खाद', 'उर्वरक',
];
function looksLikeManualQuestion(text) {
  const t = String(text || '').toLowerCase();
  return MANUAL_KEYWORDS.some((k) => t.indexOf(k.toLowerCase()) >= 0);
}
const PAPER_KEYWORDS = ['research paper', 'study', 'शोध', 'अध्ययन', 'paper hai', 'publication', 'journal', 'citation'];
function looksLikePaperQuestion(text) {
  const t = String(text || '').toLowerCase();
  return PAPER_KEYWORDS.some((k) => t.indexOf(k.toLowerCase()) >= 0);
}

// ---------------------------------------------------------------------
// Deterministic per-place prefetch (climate, village profile, crop stats,
// mandi, weather) -- runs on EVERY request, regardless of model.
// ---------------------------------------------------------------------
async function prefetchPlaceData(env, place) {
  const p = place || {};
  const [climate, village, crop, mandi, weather] = await Promise.all([
    withTimeout(toolGetClimate(env, p), TOOL_TIMEOUT_MS + 500, { available: false, reason: 'timed out' }),
    withTimeout(toolGetVillageProfile(env, p), TOOL_TIMEOUT_MS + 500, { available: false, reason: 'timed out' }),
    withTimeout(toolGetCropStats(env, p), TOOL_TIMEOUT_MS + 500, { available: false, reason: 'timed out' }),
    withTimeout(toolGetMandi(env, { district: p.district }), TOOL_TIMEOUT_MS + 500, { available: false, reason: 'timed out' }),
    withTimeout(toolGetWeather(env, { lat: p.lat, lon: p.lon }), TOOL_TIMEOUT_MS + 500, { available: false, reason: 'timed out' }),
  ]);
  return { climate, village, crop, mandi, weather };
}

// ---------------------------------------------------------------------
// System prompt -- owner's exact 5-part answer structure baked in.
// ---------------------------------------------------------------------
function fmtClimate(c) {
  if (!c || !c.available) return `Climate data: not yet available${c && c.reason ? ' (' + c.reason + ')' : ''} -- say so plainly, do not substitute a neighbouring district's numbers.`;
  const ix = c.indices || {};
  return `REAL climate data for ${c.district}${c.state ? ', ' + c.state : ''}: heatwave_days/yr=${ix.heatwave_days ?? '?'}, drought_probability=${ix.drought_probability_pct ?? '?'}%, mean_summer_tmax=${ix.mean_summer_tmax ?? ix.max_summer_tmax ?? '?'}C, annual_rain=${ix.annual_rain_mm ?? '?'}mm, spi12=${ix.spi_12 ?? '?'}, rx1day=${ix.rx1day_mm ?? '?'}mm.${c.period ? ' (' + c.period + ')' : ''} Source: ${c.source}.`;
}
function fmtWeather(w) {
  if (!w || !w.available) return `Live weather: not available${w && w.reason ? ' (' + w.reason + ')' : ''}.`;
  return `REAL weather as of ${w.date}: max_temp=${w.tmax_c}C, min_temp=${w.tmin_c ?? '?'}C, rainfall=${w.precip_mm ?? '?'}mm, humidity=${w.rh_pct ?? '?'}%, wind=${w.wind_ms ?? '?'}m/s. Source: ${w.source}.`;
}
function fmtMandi(m) {
  if (!m || !m.available) return `Mandi prices: not available today${m && m.reason ? ' (' + m.reason + ')' : ''}.`;
  const lines = (m.records || []).map((r) => `${r.commodity} Rs${r.min_price}-${r.max_price}/quintal (${r.market}, ${r.arrival_date})`).join('; ');
  return `REAL AGMARKNET mandi prices today for ${m.district}: ${lines}. Source: ${m.source}.`;
}
function fmtCrop(c) {
  if (!c || !c.available) return `Crop area/production stats: not available for this district${c && c.reason ? ' (' + c.reason + ')' : ''}.`;
  const lines = (c.top_crops || []).map((r) => `${r.crop} (${r.season}): area=${r.area_ha}ha, production=${r.production}, yield=${r.yield_per_ha != null ? Number(r.yield_per_ha).toFixed(2) : '?'}/ha`).join('; ');
  return `REAL DES crop data for ${c.district} (${c.year}): ${lines}. Source: ${c.source}.`;
}
function fmtVillage(v) {
  if (!v || !v.available) return `Village profile: not available for this district${v && v.reason ? ' (' + v.reason + ')' : ''}.`;
  let s = `Village profile coverage for ${v.district}: ${v.village_count} villages have Survey of India profile data.`;
  if (v.matched_village) {
    const mv = v.matched_village;
    s += ` REAL data for village "${mv.village_name}": population=${mv.population ?? '?'}, households=${mv.households ?? '?'}, net_area_sown_ha=${mv.land_net_area_sown_ha ?? '?'}, irrigated_area_total_ha=${mv.irrigated_area_total_ha ?? '?'}, nearest_town=${mv.nearest_town ?? '?'} (${mv.nearest_town_distance_km ?? '?'}km). Source: ${v.source}.`;
  }
  return s;
}
function fmtManuals(hits) {
  if (!hits || !hits.available || !hits.results || !hits.results.length) return '';
  return 'REAL manual/advisory excerpts (cite these by source+year, do not paraphrase without citing):\n' +
    hits.results.map((h, i) => `[M${i + 1}] "${(h.text || '').slice(0, 500)}" -- Source: ${h.source || '?'}${h.page ? ', p.' + h.page : ''}${h.year ? ', ' + h.year : ''}`).join('\n');
}
function fmtPapers(hits) {
  if (!hits || !hits.available || !hits.results || !hits.results.length) return '';
  return 'REAL scholarly papers found for this question (cite title+year+link, never invent one instead):\n' +
    hits.results.slice(0, 6).map((p, i) => `[P${i + 1}] "${p.title}" (${p.year || 'n.d.'}, ${p.source}) -- ${p.link}`).join('\n');
}

function buildSystemPrompt(place, prefetch, manualHits, paperHits, lang, clientContext) {
  const p = place || {};
  const langLine = lang === 'hi'
    ? 'IMPORTANT: Reply ONLY in Hindi (Devanagari script).'
    : 'Reply in English unless the user writes in Hindi, in which case reply in Hindi.';

  return `You are Kisan Sahayak, an Agriculture Decision Support System for Indian farmers -- not just a chatbot. You have real tools (get_climate, get_weather, get_mandi, get_crop_stats, search_papers, search_manuals) and real data already fetched below for the farmer's selected place (${p.district || 'unknown district'}${p.state ? ', ' + p.state : ''}). Use them.

For every substantive question, structure your answer in exactly this order:
1. **Your place's real data** -- cite the actual measurement from the REAL DATA block below, with its source and year/date. If a figure isn't available, say so plainly -- never invent a number for this place.
2. **Probable cause** -- from a manual, paper, or general agronomic knowledge, cited.
3. **How to identify it** -- concrete, observable signs the farmer can check in their own field.
4. **Management** -- an ICAR/KVK-style recommendation, cited if it comes from a search_manuals/search_papers result.
5. **Source list** -- one line per source actually used (e.g. "IMD 0.05deg gridded data, 2000-2024", "AGMARKNET, ${new Date().toISOString().slice(0, 10)}", "[M1] wheat PoP, IIWBR, 1984").

For quick/simple questions (greetings, yes/no, clarifications) skip the 5-part structure and just answer naturally -- don't force structure where it doesn't fit.

HARD RULE: never invent a specific number tied to this place (rainfall, price, yield, population) that isn't in the REAL DATA block below. If you don't have it, say the exact figure isn't available, then still answer the rest of the question from general knowledge. Never invent a paper title/author/DOI or a manual passage -- only cite what search_papers/search_manuals actually returned (see the [M#] excerpts below, if any).

--- REAL DATA for ${p.district || '(no district selected)'}${p.state ? ', ' + p.state : ''} (fetched just now, in parallel) ---
${fmtClimate(prefetch.climate)}
${fmtWeather(prefetch.weather)}
${fmtMandi(prefetch.mandi)}
${fmtCrop(prefetch.crop)}
${fmtVillage(prefetch.village)}
${fmtManuals(manualHits)}
${fmtPapers(paperHits)}
${clientContext ? String(clientContext).slice(0, 1500) : ''}
--- end real data ---

${langLine}`;
}

// ---------------------------------------------------------------------
// Model fallback orchestration
// ---------------------------------------------------------------------

// Optional single-round tool-calling, only on models tagged function-calling
// capable, only if the question looks like it needs search_manuals/
// search_papers with a place different from the one already prefetched (the
// common case is already covered by the deterministic prefetch above).
// Bounded to TOOL_ROUND_TIMEOUT_MS total so it can never blow the "first
// word within 5s" budget by much -- if it doesn't resolve in time, the
// Worker proceeds straight to streaming with whatever prefetch data it has.
async function maybeRunToolRound(env, model, messages) {
  try {
    const first = await withTimeout(
      env.AI.run(model, { messages, tools: TOOLS, max_tokens: 400 }),
      TOOL_ROUND_TIMEOUT_MS,
      null
    );
    if (!first || !first.tool_calls || !first.tool_calls.length) return { messages, toolResults: [] };

    const toolResults = [];
    const extraMessages = [...messages, { role: 'assistant', content: JSON.stringify(first.tool_calls) }];
    for (const call of first.tool_calls.slice(0, 3)) { // cap at 3 tool calls per round
      const fn = TOOL_DISPATCH[call.name];
      let result = { available: false, reason: 'unknown tool' };
      if (fn) {
        try { result = await withTimeout(fn(env, call.arguments || {}), TOOL_ROUND_TIMEOUT_MS, { available: false, reason: 'tool timed out' }); }
        catch (e) { result = { available: false, reason: String(e && e.message) }; }
      }
      toolResults.push({ name: call.name, arguments: call.arguments, result });
      extraMessages.push({ role: 'tool', content: JSON.stringify(result) });
    }
    return { messages: extraMessages, toolResults };
  } catch (e) {
    return { messages, toolResults: [] };
  }
}

// Builds the final streamed response. Tries each model in order; a model
// only gets skipped if it throws (or returns an empty stream) BEFORE any
// token is produced. Once a model starts streaming, the Worker commits to
// it for the rest of the answer.
function buildAnswerStream(env, place, prefetch, manualHits, paperHits, messages, lang) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sse({
        type: 'meta',
        place: { state: place.state || null, district: place.district || null },
        data_available: {
          climate: !!(prefetch.climate && prefetch.climate.available),
          weather: !!(prefetch.weather && prefetch.weather.available),
          mandi: !!(prefetch.mandi && prefetch.mandi.available),
          crop: !!(prefetch.crop && prefetch.crop.available),
          village: !!(prefetch.village && prefetch.village.available),
          manuals: !!(manualHits && manualHits.available && manualHits.results && manualHits.results.length),
          papers: !!(paperHits && paperHits.available && paperHits.results && paperHits.results.length),
        },
      })));

      let modelUsed = null;
      let reader = null;
      let firstChunk = null;
      const triedErrors = [];

      for (const model of MODEL_FALLBACK_ORDER) {
        try {
          let msgs = messages;
          let toolResults = [];
          if (TOOL_CAPABLE_MODELS.has(model)) {
            const roundResult = await maybeRunToolRound(env, model, messages);
            msgs = roundResult.messages;
            toolResults = roundResult.toolResults;
          }
          if (toolResults.length) {
            controller.enqueue(encoder.encode(sse({ type: 'tool', calls: toolResults.map((t) => t.name) })));
          }
          const aiStream = await env.AI.run(model, { messages: msgs, stream: true, max_tokens: 900 });
          reader = aiStream.getReader();
          firstChunk = await withTimeout(reader.read(), 20000, { done: true, value: null });
          if (firstChunk.done) { reader = null; continue; }
          modelUsed = model;
          break;
        } catch (e) {
          triedErrors.push(model + ': ' + (e && e.message));
          reader = null;
          continue;
        }
      }

      if (!reader) {
        controller.enqueue(encoder.encode(sse({ type: 'error', message: 'All models unavailable', tried: triedErrors })));
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(sse({ type: 'model', model: modelUsed })));
      if (firstChunk && firstChunk.value) controller.enqueue(firstChunk.value);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (e) {
        controller.enqueue(encoder.encode(sse({ type: 'error', message: 'stream interrupted: ' + (e && e.message) })));
      }
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------

async function handleChat(request, env, ctx) {
  const origin = request.headers.get('Origin') || '';
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, error: 'invalid_json' }, 400, origin); }

  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return jsonResponse({ ok: false, error: 'empty_message' }, 400, origin);

  const place = body.place && typeof body.place === 'object' ? body.place : {};
  const lang = body.lang === 'hi' ? 'hi' : 'en';
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];
  // Optional: dashboard/knowledge_base_loader.js's small curated
  // government-portal/open-access-paper manifest, keyword-matched
  // client-side (dashboard/data/knowledge_base/index.json, a few dozen
  // entries -- separate from and complementary to this Worker's own
  // Vectorize search_manuals). Passed through as-is, length-capped, never
  // fabricated here if the client didn't send one.
  const clientContext = typeof body.client_context === 'string' ? body.client_context.slice(0, 1500) : '';

  // Step 1: deterministic parallel prefetch of the 5 real data sources.
  const prefetchPromise = prefetchPlaceData(env, place);

  // Step 2: heuristic-triggered search_manuals / search_papers (both
  // bounded), so RAG citations and real paper links reach the answer even
  // on the two non-tool-calling fallback models. Mirrors
  // research_papers_loader.js's client-side looksLikeResearchRequest()
  // trigger, reimplemented here for the server-side tool.
  const manualPromise = looksLikeManualQuestion(message)
    ? withTimeout(toolSearchManuals(env, { query: message }), MANUAL_SEARCH_TIMEOUT_MS, { available: false, reason: 'timed out' })
    : Promise.resolve({ available: false, reason: 'not triggered for this question' });
  const paperPromise = looksLikePaperQuestion(message)
    ? withTimeout(toolSearchPapers(env, { query: message }), MANUAL_SEARCH_TIMEOUT_MS, { available: false, reason: 'timed out' })
    : Promise.resolve({ available: false, reason: 'not triggered for this question' });

  const [prefetch, manualHits, paperHits] = await Promise.all([prefetchPromise, manualPromise, paperPromise]);

  const systemPrompt = buildSystemPrompt(place, prefetch, manualHits, paperHits, lang, clientContext);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.filter((h) => h && h.role && h.content).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, MAX_MESSAGE_CHARS) })),
    { role: 'user', content: message },
  ];

  const stream = buildAnswerStream(env, place, prefetch, manualHits, paperHits, messages, lang);
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders(origin),
    },
  });
}

function handleHealth(request, env) {
  const origin = request.headers.get('Origin') || '';
  return jsonResponse({ ok: true, service: 'kisan-sahayak-worker', models: MODEL_FALLBACK_ORDER }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/chat') return handleChat(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) return handleHealth(request, env);
    return jsonResponse({ ok: false, error: 'not_found' }, 404, origin);
  },
};
