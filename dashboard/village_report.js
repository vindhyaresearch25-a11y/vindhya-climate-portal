/*
 * village_report.js — VINDHYA CLIMATE INTELLIGENCE
 * "Village Profile & Agricultural Intelligence Report"
 *
 * Owns the sidebar's "Village Profile" item (#pane-village). Replaces the
 * old bare VILLAGE INTELLIGENCE placeholder with a full, A4-government-
 * report-shaped module: a Country -> State -> District -> Block/Tehsil ->
 * Gram Panchayat -> Village selector, a 20-section on-screen report, and
 * (phases 2/3) PDF / Excel / Print exports of exactly the same content.
 *
 * ---------------------------------------------------------------------
 * THE ONE RULE (CLAUDE.md, repeated three times in the owner's own spec):
 * NO FABRICATED DATA, ANYWHERE. Every number below is read straight out
 * of a real published file in dashboard/data/ (or the Survey of India
 * village layer on Hugging Face). Where a subject area has no real source
 * in this project, its section still gets its heading and number -- and
 * says "Data not available for the selected location/period", with the
 * specific reason. That honest gap IS the correct output, not a bug. No
 * estimate, no interpolation, no neighbouring unit's number substituted,
 * no composite "score" invented (see Executive Summary's own note).
 * ---------------------------------------------------------------------
 *
 * WHAT IS REAL, AND AT WHICH ADMIN LEVEL (verified by reading the actual
 * files, 2026-09, not assumed):
 *
 *   Village level (real, national, ~6.5 lakh villages)
 *     - Survey of India village boundary + 48-column attribute profile
 *       (village_profiles/<state>/<district>.json): households,
 *       population, male/female, geographical area, 20 drinking-water
 *       fields, drainage, 10 land-use classes (ha), 6 irrigation-source
 *       classes (ha), nearest town + distance.
 *     - NASA SMAP L4 soil moisture, village tier: the real 9 km cell
 *       nearest the village centroid (soil_moisture/<state>/<district>
 *       .json .villages) -- a real reading, at 9 km resolution, honestly
 *       labelled as a cell value rather than a village-resolved product.
 *
 *   Block/Tehsil level (real)
 *     - SMAP block tier (mean +/- sd of that block's villages' cells).
 *     - CGWB groundwater monitoring stations carry their own real
 *       block/tehsil/village names, so a block's own stations are a
 *       genuine block-level reading, not a district average.
 *
 *   District level (real; shown at deeper levels ONLY with an explicit
 *   "district-level, no <level>-specific source" badge)
 *     - Climate indices, ERA5-Land+CHIRPS via GEE, 2000-2024 (726 dists)
 *     - MODIS MOD13Q1 NDVI annual series, 2000-2024 (733)
 *     - CGWB groundwater district aggregate (721)
 *     - DES crop area/production/yield, 2000-01..2022-23 (747)
 *     - AGMARKNET daily mandi prices (733 districts carried; most are
 *       empty on any given day -- that is reported honestly, not filled)
 *     - Rule-based advisory flags (732), derived from the above only
 *
 *   State level (real)
 *     - Horticulture area/production/yield (28 of 36 states individually
 *       reported; the other 8 are folded into the source's own "OTHERS")
 *
 *   NO REAL SOURCE ANYWHERE IN THIS PROJECT (verified by searching
 *   dashboard/data/, scripts/ and docs/DATA_SOURCES.md) -- these render
 *   as honest, reasoned gaps:
 *     - Soil type / pH / NPK / micronutrients (Soil Health Card)
 *     - Pest & disease incidence
 *     - Fertilizer & input application
 *     - Government scheme enrollment (PM-KISAN, PMFBY, SHC, ...)
 *     - Remote-sensing indices beyond NDVI (EVI, NDMI, LST, drought
 *       stress index) as separate layers
 *     - Census socio-economic detail beyond the SoI 48 columns
 *       (literacy, worker classification, amenities, connectivity)
 *     - Livestock, farmer categories, landholding-size distribution
 *
 * GRAM PANCHAYAT: the Survey of India village layer carries a real
 * gp_name attribute per village. It is populated in some states (Punjab
 * 907/927 villages in Ludhiana, Kerala 98/234 in Thrissur) and blank in
 * others (Madhya Pradesh: 0/1138 in Dewas). So the GP step is offered
 * ONLY where the source actually fills it, built from those real values.
 * There is no SoI Gram Panchayat BOUNDARY product, so a GP selection
 * draws its member villages' own real polygons and states plainly that
 * this is their combined extent, not an official GP boundary. Where
 * gp_name is blank the GP dropdown says so and the cascade goes straight
 * from Block to Village. A real GP-tier boundary/statistics dataset is a
 * separate national data-acquisition task -- see the final report.
 *
 * DELIBERATELY ZERO EDITS TO national_selector.js: another agent has
 * uncommitted work in that file. This module therefore reads the master
 * selector's own <select> elements (and drives them by setting .value +
 * dispatching a real 'change' event, which fires their inline onchange
 * handlers exactly as a user click does), watches #pane-village's class
 * with a MutationObserver for activation, and polls the master selects
 * for changes made via the map. The only global it consumes is
 * window.getCurrentSelectionBounds(), already exported there.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Data locations. Only boundaries/ and village_profiles/ live on the
  // Hugging Face mirror (resolveDataUrl rewrites those two); everything
  // else is served from this repo, same as every other loader here.
  // ---------------------------------------------------------------------
  var SRC = {
    climate:   'data/climate/',
    ndvi:      'data/ndvi/',
    soil:      'data/soil_moisture/',
    gw:        'data/groundwater/',
    crop:      'data/crop_stats_des_by_district/',
    advisory:  'data/advisory/',
    hort:      'data/horticulture_stats/',
    mandi:     'data/mandi_prices.json'
  };
  var FETCH_TIMEOUT_MS = 30000;

  // url -> {status:'ok',data} | {status:'missing'} ; errors are never
  // cached, so a transient network blip retries on the next render
  // instead of being frozen into a permanent "not available".
  var _cache = {};
  var _inflight = {};
  var _charts = [];        // live Chart.js instances, destroyed on re-render
  var _sections = null;    // last built section model (PDF/Excel read this)
  var _ctx = null;         // last rendered context
  var _showToc = false;
  var _rendered = false;
  var _lastSig = '';
  var _lastOptsSig = '';

  function el(id) { return document.getElementById(id); }
  function slugify(s) {
    return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }

  // ONLY boundaries/ and village_profiles/ were moved to the Hugging Face
  // mirror (config/data_config.json). resolveDataUrl() itself will happily
  // rewrite ANY 'data/...' path to that mirror, where everything else 404s
  // -- which is exactly why every other loader in this dashboard fetches
  // its own files as plain relative paths and never calls it. Same rule
  // here, applied by prefix rather than by remembering per call site.
  var HF_HOSTED = /^data\/(boundaries|village_profiles)\//;
  function resolve(url) {
    if (!HF_HOSTED.test(url)) return url;
    return (typeof resolveDataUrl === 'function') ? resolveDataUrl(url) : url;
  }

  function getJson(url) {
    if (_cache[url]) return Promise.resolve(_cache[url]);
    if (_inflight[url]) return _inflight[url];
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;
    var p = fetch(resolve(url), controller ? { signal: controller.signal } : {})
      .then(function (r) {
        if (r.status === 404) { var m = { status: 'missing' }; _cache[url] = m; return m; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function (j) { var o = { status: 'ok', data: j }; _cache[url] = o; return o; });
      })
      .catch(function (e) { return { status: 'error', message: e && e.message ? e.message : String(e) }; })
      .then(function (res) { if (timer) clearTimeout(timer); delete _inflight[url]; return res; });
    _inflight[url] = p;
    return p;
  }

  // ---------------------------------------------------------------------
  // Formatting. Owner's section 3: numbers right-aligned, text left,
  // thousands separators, consistent decimals, units in the header.
  // ---------------------------------------------------------------------
  var DASH = '—';
  function fmt(v, type, dec) {
    if (v === null || v === undefined || v === '') return DASH;
    if (type === 'num') {
      var n = Number(v);
      if (!isFinite(n)) return DASH;
      return n.toLocaleString('en-IN', {
        minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0
      });
    }
    return String(v);
  }
  function has(v) { return v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !isFinite(v)); }

  // A table cell is either a bare value, or {v: value, dec: n} when that one
  // row needs its own precision (a population is an integer; a mean household
  // size is 2 dp; an SPI index is 3 dp -- all in the same "Value" column).
  function cellValue(cell) {
    return (cell && typeof cell === 'object' && !Array.isArray(cell) && 'v' in cell) ? cell.v : cell;
  }
  function cellDec(cell, col) {
    if (cell && typeof cell === 'object' && !Array.isArray(cell) && cell.dec !== undefined) return cell.dec;
    return (col && col.dec !== undefined) ? col.dec : 2;
  }

  // ---------------------------------------------------------------------
  // Section model. ONE structure, three renderers (HTML / PDF / Excel) --
  // so an export can never contain a richer or different set of numbers
  // than the screen shows. Block types: 'kpi' | 'table' | 'chart' | 'note'.
  // available:false renders the honest gap sentence instead of blocks.
  // ---------------------------------------------------------------------
  function section(n, title, opts) {
    opts = opts || {};
    return {
      n: n, title: title, icon: opts.icon || 'fa-circle-info',
      level: opts.level || '', source: opts.source || '',
      available: !!opts.available, naReason: opts.naReason || '',
      blocks: opts.blocks || []
    };
  }
  function tableBlock(cols, rows, caption) {
    return { type: 'table', cols: cols, rows: rows, caption: caption || '' };
  }
  function kpiBlock(items) { return { type: 'kpi', items: items }; }
  function chartBlock(id, config, caption) {
    return { type: 'chart', id: id, config: config, caption: caption || '' };
  }
  function noteBlock(text) { return { type: 'note', text: text }; }

  // Level badge wording -- follows state_aggregate_loader.js /
  // climateLevelSuffix()'s established honesty convention: never let a
  // district number sit on a village page without saying so.
  function levelBadge(dataLevel, selLevel) {
    var order = ['state', 'district', 'block', 'gp', 'village'];
    var di = order.indexOf(dataLevel), si = order.indexOf(selLevel);
    var nice = { state: 'State', district: 'District', block: 'Block/Tehsil', gp: 'Gram Panchayat', village: 'Village' };
    if (di === si) return { cls: 'exact', text: nice[dataLevel] + '-level (real reading for this ' + nice[dataLevel].toLowerCase() + ')' };
    if (di < si) return { cls: 'coarse', text: nice[dataLevel] + '-level figure — no ' + nice[selLevel].toLowerCase() + '-specific source exists' };
    return { cls: 'exact', text: nice[dataLevel] + '-level' };
  }

  // =====================================================================
  // CONTEXT: read the master selector (single source of truth, kept in
  // sync with the map by national_selector.js) + this module's own GP pick.
  // =====================================================================
  var _gpChoice = '';
  function readContext() {
    var s = el('stateSelect'), d = el('districtSelect'), b = el('blockSelect'), v = el('villageSelect');
    var ctx = {
      stateName: (s && s.value) || null,
      districtName: (d && d.value) || null,
      blockName: (b && b.value) || null,
      villageLgd: (v && v.value) || null,
      villageName: null,
      gpName: _gpChoice || null
    };
    if (v && v.value && v.selectedIndex >= 0) {
      var opt = v.options[v.selectedIndex];
      ctx.villageName = opt ? opt.textContent : null;
    }
    ctx.stateSlug = ctx.stateName ? slugify(ctx.stateName) : null;
    ctx.districtSlug = ctx.districtName ? slugify(ctx.districtName) : null;
    ctx.level = ctx.villageLgd ? 'village' : (ctx.gpName ? 'gp' : (ctx.blockName ? 'block' : (ctx.districtName ? 'district' : (ctx.stateName ? 'state' : null))));
    return ctx;
  }
  function ctxSignature(c) {
    return [c.stateName, c.districtName, c.blockName, c.gpName, c.villageLgd].join('|');
  }
  // The master dropdowns fill in ASYNCHRONOUSLY -- picking a state leaves
  // #districtSelect empty for as long as the (large) districts layer takes
  // to arrive, and picking a district likewise for blocks/villages. The
  // selected VALUES do not change when that happens, so watching only
  // ctxSignature left this module's own mirrored dropdowns permanently
  // empty (caught live). Option counts are therefore tracked separately,
  // and a change in them rebuilds just the selector -- never the whole
  // report, which would re-run every fetch for an unchanged location.
  function optsSignature() {
    return ['stateSelect', 'districtSelect', 'blockSelect', 'villageSelect'].map(function (id) {
      var e = el(id);
      return e ? e.options.length : 0;
    }).join(',');
  }

  function rebuildSelectorOnly() {
    var host = document.querySelector('.vr-selector');
    if (!host) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = renderSelector(readContext());
    host.parentNode.replaceChild(tmp.firstChild, host);
    wireSelector();
  }

  // =====================================================================
  // DATA LOADING -- fetch-on-select, cached, only what the current level
  // actually needs (owner's section 29: never eagerly fetch everything).
  // =====================================================================
  function loadAll(ctx) {
    var jobs = {};
    var sslug = ctx.stateSlug, dslug = ctx.districtSlug;
    if (sslug) jobs.hort = getJson(SRC.hort + sslug + '.json');
    if (sslug && dslug) {
      jobs.climate  = getJson(SRC.climate + sslug + '/' + dslug + '.json');
      jobs.ndvi     = getJson(SRC.ndvi + sslug + '/' + dslug + '.json');
      jobs.soil     = getJson(SRC.soil + sslug + '/' + dslug + '.json');
      jobs.gw       = getJson(SRC.gw + sslug + '/' + dslug + '.json');
      jobs.crop     = getJson(SRC.crop + sslug + '/' + dslug + '.json');
      jobs.advisory = getJson(SRC.advisory + sslug + '/' + dslug + '.json');
      jobs.mandi    = getJson(SRC.mandi);
      jobs.villages = getJson('data/boundaries/' + 'soi/villages/' + sslug + '/' + dslug + '.geojson');
      // Village attribute profile only matters once a village is picked --
      // but it is also what the GP list is cross-checked against, so it is
      // loaded from the district level down (one ~190 KB file, cached).
      jobs.profiles = getJson('data/' + 'village_profiles/' + sslug + '/' + dslug + '.json');
    }
    var keys = Object.keys(jobs);
    return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (vals) {
      var out = {};
      keys.forEach(function (k, i) { out[k] = vals[i]; });
      return out;
    });
  }

  function ok(r) { return r && r.status === 'ok' && r.data; }
  function gapReason(r, what, where) {
    if (!r) return what + ' is not fetched at this admin level. ' + (where || '');
    if (r.status === 'missing') return 'This location has no ' + what + ' file published yet (the source itself does not cover it). ' + (where || '');
    if (r.status === 'error') return 'Could not reach the ' + what + ' file just now (' + r.message + '). Nothing is shown rather than a stale or guessed value — reopen this tab to retry.';
    return what + ' is not available. ' + (where || '');
  }

  // Pull the selected village's own SoI feature + profile row.
  // -------------------------------------------------------------------
  // "Impossible zero" guard. The Survey of India attribute table stores
  // SOME unrecorded fields as 0 rather than leaving them blank. Kantaphod
  // (LGD 250870, Dewas) is a real example: population 10,405 and 1,999
  // households, but population_male = 0, population_female = 0 and
  // geographical_area_ha = 0. Printing those as "0" would state something
  // false -- that a village of ten thousand people contains no women and
  // occupies no land -- which is exactly the kind of fabricated-looking
  // number this project forbids.
  //
  // So a zero is reported as "not recorded" ONLY where it is physically
  // impossible given another real value in the SAME row. This is
  // deliberately narrow: a genuine 0 stays 0 everywhere else (0 ha of
  // forest, or no handpump, is real, common and meaningful). Nothing is
  // substituted for the suppressed field -- it becomes an explicit gap.
  var IMPOSSIBLE_ZERO = {
    population_male:      function (v) { return has(v.population) && Number(v.population) > 0; },
    population_female:    function (v) { return has(v.population) && Number(v.population) > 0; },
    geographical_area_ha: function () { return true; },
    households:           function (v) { return has(v.population) && Number(v.population) > 0; },
    population:           function (v) { return has(v.households) && Number(v.households) > 0; }
  };
  function scrubImpossibleZeros(v) {
    var dropped = [];
    Object.keys(IMPOSSIBLE_ZERO).forEach(function (f) {
      if (v[f] !== null && v[f] !== undefined && Number(v[f]) === 0 && IMPOSSIBLE_ZERO[f](v)) {
        v[f] = null;
        dropped.push(f.replace(/_/g, ' '));
      }
    });
    return dropped;
  }

  function villageRecord(ctx, D) {
    var out = { feature: null, profile: null, fields: null };
    if (!ctx.villageLgd) return out;
    if (ok(D.villages)) {
      var f = D.villages.data.features.filter(function (x) {
        return x.properties && String(x.properties.vil_lgd) === String(ctx.villageLgd);
      })[0];
      out.feature = f || null;
    }
    if (ok(D.profiles) && D.profiles.data.metadata && D.profiles.data.metadata.field_order) {
      var order = D.profiles.data.metadata.field_order;
      var row = D.profiles.data.villages[String(ctx.villageLgd)];
      if (row) {
        var v = {};
        for (var i = 0; i < order.length; i++) v[order[i]] = (row[i] === undefined ? null : row[i]);
        out.droppedZeros = scrubImpossibleZeros(v);
        out.profile = v;
        out.fields = order;
      }
    }
    return out;
  }

  // =====================================================================
  // SECTION BUILDERS
  // =====================================================================
  function buildSections(ctx, D) {
    var S = [];
    var vr = villageRecord(ctx, D);
    var vp = vr.profile;
    var lvl = ctx.level;

    // ---- 1. Location identification -----------------------------------
    (function () {
      // LGD codes: prefer the selected village's own SoI row (it carries
      // state/dist/sdcode together); otherwise fall back to whatever the
      // currently-drawn boundary feature really has. Never invented.
      var selNow = (typeof window.getCurrentSelectionBounds === 'function') ? window.getCurrentSelectionBounds() : null;
      var drawnProps = (selNow && selNow.feature && selNow.feature.features && selNow.feature.features[0])
        ? selNow.feature.features[0].properties
        : ((selNow && selNow.feature && selNow.feature.properties) ? selNow.feature.properties : {});
      var vprops = vr.feature ? vr.feature.properties : {};
      function lgd(keys) {
        for (var i = 0; i < keys.length; i++) {
          if (has(vprops[keys[i]])) return String(vprops[keys[i]]);
          if (has(drawnProps[keys[i]])) return String(drawnProps[keys[i]]);
        }
        return DASH;
      }
      var rows = [];
      rows.push(['Country', 'India', '—']);
      if (ctx.stateName) rows.push(['State/UT', ctx.stateName, lgd(['state_lgd', 'stcode'])]);
      if (ctx.districtName) rows.push(['District', ctx.districtName, lgd(['dist_lgd', 'dtcode'])]);
      if (ctx.blockName) rows.push(['Block/Tehsil', ctx.blockName, lgd(['sdcode', 'block_lgd'])]);
      if (ctx.gpName) rows.push(['Gram Panchayat', ctx.gpName, 'not issued in this layer']);
      if (ctx.villageName) rows.push(['Village', ctx.villageName, String(ctx.villageLgd)]);

      var geoRows = [];
      var sel = selNow;
      if (sel && sel.feature && typeof turf !== 'undefined') {
        try {
          var pt = turf.pointOnFeature(sel.feature);
          geoRows.push(['Representative point (inside the polygon)', pt.geometry.coordinates[1].toFixed(5) + '° N, ' + pt.geometry.coordinates[0].toFixed(5) + '° E']);
        } catch (e) { /* left out rather than approximated */ }
        try {
          var a = turf.area(sel.feature) / 10000;
          geoRows.push(['Polygon area (computed from the drawn Survey of India boundary)', fmt(a, 'num', 1) + ' ha']);
        } catch (e) { /* ditto */ }
        geoRows.push(['Boundary level currently drawn', sel.level]);
      }
      if (has(vp && vp.geographical_area_ha)) {
        geoRows.push(['Geographical area (as recorded in the SoI attribute table)', fmt(vp.geographical_area_ha, 'num', 0) + ' ha']);
      }
      var blocks = [tableBlock(
        [{ label: 'Administrative level', align: 'left' }, { label: 'Name', align: 'left' }, { label: 'LGD code', align: 'left' }],
        rows, 'Administrative hierarchy of the current selection'
      )];
      if (geoRows.length) {
        blocks.push(tableBlock([{ label: 'Geometry', align: 'left' }, { label: 'Value', align: 'left' }], geoRows,
          'Geometry, computed live from the drawn boundary'));
      }
      blocks.push(noteBlock('Elevation is not shown: this project carries no elevation raster, and an elevation figure ' +
        'cannot be derived from the boundary alone.'));
      S.push(section(1, 'Location Identification & Administrative Hierarchy', {
        icon: 'fa-location-dot', available: !!ctx.stateName,
        naReason: 'Select at least a State to identify a location.',
        level: lvl ? levelBadge(lvl, lvl).text : '',
        source: 'Survey of India village/sub-district/district/state boundary products, via National Water Data Portal (NWDP), NWIC, Ministry of Jal Shakti · fetched 2026-08-02',
        blocks: blocks
      }));
    })();

    // ---- 2. Village basic profile -------------------------------------
    (function () {
      if (!vp) {
        S.push(section(2, 'Village Basic Profile', {
          icon: 'fa-house', available: false,
          naReason: ctx.villageLgd
            ? 'Data not available for the selected location. ' + gapReason(D.profiles, 'Survey of India village attribute record', 'The village boundary and name are still real — this specific village\'s attribute row was dropped upstream (e.g. an unreadable LGD code).')
            : 'Data not available for the selected location. This section is village-specific: select a Village to populate it. Population/household figures are published per village only, and are never rolled up from or down to another level here.',
          source: 'Survey of India village-boundary attribute table, via NWDP'
        }));
        return;
      }
      var rows = [
        ['Village name', vp.village_name],
        ['LGD code', String(ctx.villageLgd)],
        ['Block/Tehsil', ctx.blockName || DASH],
        ['District', ctx.districtName || DASH],
        ['State/UT', ctx.stateName || DASH]
      ];
      if (ctx.gpName) rows.push(['Gram Panchayat (as recorded in the SoI village row)', ctx.gpName]);
      if (has(vp.nearest_town)) rows.push(['Nearest town', vp.nearest_town + (has(vp.nearest_town_distance_km) ? ' (' + vp.nearest_town_distance_km + ' km)' : '')]);
      if (has(vp.has_pin_code)) rows.push(['PIN code assigned', vp.has_pin_code === 1 ? 'Yes' : 'No']);

      var demo = [];
      if (has(vp.population)) demo.push(['Total population', { v: vp.population, dec: 0 }, 'persons']);
      if (has(vp.population_male)) demo.push(['Male population', { v: vp.population_male, dec: 0 }, 'persons']);
      if (has(vp.population_female)) demo.push(['Female population', { v: vp.population_female, dec: 0 }, 'persons']);
      if (has(vp.households)) demo.push(['Households', { v: vp.households, dec: 0 }, 'households']);
      if (has(vp.avg_household_size)) demo.push(['Average household size', { v: vp.avg_household_size, dec: 2 }, 'persons/household']);
      if (has(vp.geographical_area_ha)) demo.push(['Geographical area', { v: vp.geographical_area_ha, dec: 0 }, 'hectares']);
      // Sex ratio is arithmetic on two real published numbers, not a new
      // datum -- shown only when BOTH are present, and labelled as derived.
      if (has(vp.population_male) && has(vp.population_female) && Number(vp.population_male) > 0) {
        demo.push(['Sex ratio (derived: females per 1,000 males)', { v: Math.round(Number(vp.population_female) * 1000 / Number(vp.population_male)), dec: 0 }, 'per 1,000 males']);
      }

      var kpis = [];
      if (has(vp.population)) kpis.push({ label: 'POPULATION', value: fmt(vp.population, 'num', 0), color: 'var(--green)' });
      if (has(vp.households)) kpis.push({ label: 'HOUSEHOLDS', value: fmt(vp.households, 'num', 0), color: 'var(--cyan)' });
      if (has(vp.geographical_area_ha)) kpis.push({ label: 'AREA (ha)', value: fmt(vp.geographical_area_ha, 'num', 0), color: 'var(--teal)' });
      if (has(vp.avg_household_size)) kpis.push({ label: 'AVG HH SIZE', value: String(vp.avg_household_size), color: 'var(--yellow)' });

      S.push(section(2, 'Village Basic Profile', {
        icon: 'fa-house', available: true, level: levelBadge('village', lvl).text,
        source: 'Survey of India village-boundary attribute table, via National Water Data Portal (NWDP) · fetched 2026-08-02',
        blocks: [
          kpiBlock(kpis),
          tableBlock([{ label: 'Identification', align: 'left' }, { label: 'Value', align: 'left' }], rows),
          tableBlock([{ label: 'Demographic indicator', align: 'left' }, { label: 'Value', align: 'right', type: 'num' }, { label: 'Unit', align: 'left' }], demo,
            'Demographics as published in the source; a field the source left blank is omitted, never shown as 0.')
        ].concat(vr.droppedZeros && vr.droppedZeros.length ? [noteBlock(
          'Not recorded for this village: ' + vr.droppedZeros.join(', ') + '. The Survey of India row stores ' +
          'these as 0, which cannot be true alongside the non-zero figures above (a village of ' +
          fmt(vp.population, 'num', 0) + ' people has both men and women, and occupies land). They are reported as ' +
          'unrecorded rather than as zero, and nothing is estimated in their place.')] : [])
      }));
    })();

    // ---- 3. Land use --------------------------------------------------
    (function () {
      var LAND = [
        ['Net area sown', 'land_net_area_sown_ha'],
        ['Current fallow', 'land_fallow_current_ha'],
        ['Other fallow', 'land_fallow_other_ha'],
        ['Culturable waste', 'land_culturable_waste_ha'],
        ['Permanent pastures & grazing land', 'land_pastures_ha'],
        ['Forest', 'land_forest_ha'],
        ['Barren & uncultivable', 'land_barren_uncultivable_ha'],
        ['Land put to non-agricultural use', 'land_non_agricultural_ha'],
        ['Miscellaneous tree crops & groves', 'land_miscellaneous_ha']
      ];
      var rows = [], total = 0, anyVal = false;
      if (vp) {
        LAND.forEach(function (p) {
          if (has(vp[p[1]])) { rows.push([p[0], vp[p[1]]]); total += Number(vp[p[1]]); anyVal = true; }
        });
      }
      if (!anyVal) {
        S.push(section(3, 'Land Use & Agricultural Land', {
          icon: 'fa-wheat-awn', available: false,
          naReason: ctx.villageLgd
            ? 'Data not available for the selected location. The Survey of India attribute table left every land-use column blank for this village; no value is estimated from the district or from neighbouring villages.'
            : 'Data not available for the selected location. Land-use classes are published per village in the Survey of India attribute table — select a Village to populate this section.',
          source: 'Survey of India village-boundary attribute table, via NWDP'
        }));
        return;
      }
      // Percent-of-total is arithmetic on the rows themselves, labelled.
      var rows2 = rows.map(function (r) {
        return [r[0], r[1], total > 0 ? (Number(r[1]) * 100 / total) : null];
      });
      rows2.push(['Total of the classes above (derived)', total, 100]);
      var cropIntensityNote = 'Cropping intensity is NOT shown: it requires gross cropped area (area sown more than once), ' +
        'which this source does not publish. It is deliberately left absent rather than approximated from net area sown.';
      S.push(section(3, 'Land Use & Agricultural Land', {
        icon: 'fa-wheat-awn', available: true, level: levelBadge('village', lvl).text,
        source: 'Survey of India village-boundary attribute table, via NWDP · fetched 2026-08-02',
        blocks: [
          tableBlock([
            { label: 'Land-use class', align: 'left' },
            { label: 'Area (ha)', align: 'right', type: 'num', dec: 0 },
            { label: 'Share of listed total (%)', align: 'right', type: 'num', dec: 1 }
          ], rows2),
          chartBlock('vrChartLand', {
            type: 'bar',
            data: {
              labels: rows.map(function (r) { return r[0]; }),
              datasets: [{ label: 'Area (ha)', data: rows.map(function (r) { return Number(r[1]); }), backgroundColor: '#2d8f5c' }]
            },
            options: mergeOpts({ plugins: { legend: { display: false } } })
          }, 'Land-use classes, hectares — Survey of India village attribute table'),
          noteBlock(cropIntensityNote),
          noteBlock('Landholding-size distribution (marginal/small/medium/large) is not available: no Agriculture Census ' +
            'landholding table is integrated in this project.')
        ]
      }));
    })();

    // ---- 4. Irrigation ------------------------------------------------
    (function () {
      var IRR = [
        ['Canals', 'irrigated_canals_ha'],
        ['Wells / tubewells', 'irrigated_wells_tubewells_ha'],
        ['Tanks / lakes', 'irrigated_tanks_lakes_ha'],
        ['Waterfall', 'irrigated_waterfall_ha'],
        ['Other sources', 'irrigated_other_ha']
      ];
      var rows = [], any = false;
      if (vp) {
        if (has(vp.irrigated_area_total_ha)) { rows.push(['Total irrigated area', vp.irrigated_area_total_ha]); any = true; }
        if (has(vp.land_unirrigated_ha)) { rows.push(['Unirrigated area', vp.land_unirrigated_ha]); any = true; }
        IRR.forEach(function (p) { if (has(vp[p[1]])) { rows.push(['  of which ' + p[0], vp[p[1]]]); any = true; } });
      }
      if (!any) {
        S.push(section(4, 'Irrigation', {
          icon: 'fa-faucet-drip', available: false,
          naReason: ctx.villageLgd
            ? 'Data not available for the selected location. The Survey of India attribute table left every irrigation column blank for this village.'
            : 'Data not available for the selected location. Irrigation source areas are published per village — select a Village to populate this section.',
          source: 'Survey of India village-boundary attribute table, via NWDP'
        }));
        return;
      }
      var pct = null;
      if (has(vp.irrigated_area_total_ha) && has(vp.land_net_area_sown_ha) && Number(vp.land_net_area_sown_ha) > 0) {
        pct = Number(vp.irrigated_area_total_ha) * 100 / Number(vp.land_net_area_sown_ha);
      }
      var blocks = [tableBlock([{ label: 'Irrigation', align: 'left' }, { label: 'Area (ha)', align: 'right', type: 'num', dec: 0 }], rows)];
      if (pct !== null) {
        blocks.push(kpiBlock([{ label: 'IRRIGATED SHARE OF NET SOWN AREA (derived)', value: fmt(pct, 'num', 1) + ' %', color: 'var(--cyan)' }]));
      }
      S.push(section(4, 'Irrigation', {
        icon: 'fa-faucet-drip', available: true, level: levelBadge('village', lvl).text,
        source: 'Survey of India village-boundary attribute table, via NWDP · fetched 2026-08-02',
        blocks: blocks
      }));
    })();

    // ---- 5. Drinking water & drainage ---------------------------------
    (function () {
      var WATER = [
        ['Treated tap water', 'water_tapwater_treated', null, null],
        ['Untreated tap water', 'water_tapwater_untreated', null, null],
        ['Covered well', 'water_covered_well', 'water_covered_well_year_round', 'water_covered_well_summer'],
        ['Uncovered well', 'water_uncovered_well', 'water_uncovered_well_year_round', 'water_uncovered_well_summer'],
        ['Handpump', 'water_handpump', 'water_handpump_year_round', 'water_handpump_summer'],
        ['Tubewell / borehole', 'water_tubewell_borehole', 'water_tubewell_year_round', 'water_tubewell_summer'],
        ['Spring', 'water_spring', 'water_spring_year_round', 'water_spring_summer'],
        ['River / canal', 'water_river_canal', null, null],
        ['Tank / pond / lake', 'water_tank_pond_lake', null, null],
        ['Other source', 'water_other_source', null, null]
      ];
      if (!vp) {
        S.push(section(5, 'Drinking Water Sources & Drainage', {
          icon: 'fa-droplet', available: false,
          naReason: 'Data not available for the selected location. Drinking-water availability is published per village in the Survey of India attribute table — select a Village to populate this section.',
          source: 'Survey of India village-boundary attribute table, via NWDP'
        }));
        return;
      }
      function yn(v) { return v === 1 ? 'Yes' : (v === 0 ? 'No' : DASH); }
      var rows = [], any = false;
      WATER.forEach(function (w) {
        if (!has(vp[w[1]])) return;
        any = true;
        rows.push([w[0], yn(vp[w[1]]), w[2] ? yn(vp[w[2]]) : DASH, w[3] ? yn(vp[w[3]]) : DASH]);
      });
      var drain = [];
      if (has(vp.drainage_closed)) drain.push(['Closed drainage', yn(vp.drainage_closed)]);
      if (has(vp.drainage_open)) drain.push(['Open drainage', yn(vp.drainage_open)]);
      if (!any && !drain.length) {
        S.push(section(5, 'Drinking Water Sources & Drainage', {
          icon: 'fa-droplet', available: false,
          naReason: 'Data not available for the selected location. Every drinking-water and drainage column was left blank for this village in the source.',
          source: 'Survey of India village-boundary attribute table, via NWDP'
        }));
        return;
      }
      var blocks = [];
      if (any) blocks.push(tableBlock([
        { label: 'Drinking water source', align: 'left' }, { label: 'Available', align: 'left' },
        { label: 'Year-round', align: 'left' }, { label: 'In summer', align: 'left' }
      ], rows, 'A blank (—) means the source did not record that column, not "No".'));
      if (drain.length) blocks.push(tableBlock([{ label: 'Drainage', align: 'left' }, { label: 'Present', align: 'left' }], drain));
      S.push(section(5, 'Drinking Water Sources & Drainage', {
        icon: 'fa-droplet', available: true, level: levelBadge('village', lvl).text,
        source: 'Survey of India village-boundary attribute table, via NWDP · fetched 2026-08-02',
        blocks: blocks
      }));
    })();

    // ---- 6/7. Crop profile + season -----------------------------------
    var cropData = ok(D.crop) ? D.crop.data : null;
    (function () {
      if (!cropData || !cropData.records || !cropData.records.length) {
        var reason = ctx.districtName
          ? 'Data not available for the selected location. ' + gapReason(D.crop, 'DES district crop statistics',
              'DES publishes crop area/production by district; this district has no file (its name may not match the DES district list, or the state is not covered).')
          : 'Data not available for the selected location. Crop area/production/yield is published by district — select a District to populate this section.';
        S.push(section(6, 'Crop Profile — Area, Production & Yield', {
          icon: 'fa-seedling', available: false, naReason: reason,
          source: 'Directorate of Economics and Statistics (DES), Dept. of Agriculture and Farmers Welfare, data.desagri.gov.in'
        }));
        S.push(section(7, 'Crop Season Analysis (Kharif / Rabi / Summer)', {
          icon: 'fa-calendar-days', available: false, naReason: reason,
          source: 'Directorate of Economics and Statistics (DES), data.desagri.gov.in'
        }));
        return;
      }
      var recs = cropData.records;
      var meta = cropData.metadata || {};
      var years = recs.map(function (r) { return r.year; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
      var latest = years[years.length - 1];
      var latestRecs = recs.filter(function (r) { return r.year === latest; })
        .sort(function (a, b) { return (b.area_ha || 0) - (a.area_ha || 0); });

      var rows = latestRecs.map(function (r) {
        return [r.crop, r.season, r.area_ha, r.production, r.yield_per_ha, r.unit || ''];
      });
      var totalArea = latestRecs.reduce(function (s, r) { return s + (Number(r.area_ha) || 0); }, 0);

      // Historical: total sown area by year (sum of the real per-crop rows)
      var byYear = {};
      recs.forEach(function (r) {
        if (!has(r.area_ha)) return;
        byYear[r.year] = (byYear[r.year] || 0) + Number(r.area_ha);
      });
      var yrLabels = Object.keys(byYear).sort();

      // Top 5 crops of the latest year, tracked across years
      var top5 = latestRecs.slice(0, 5).map(function (r) { return r.crop; });
      var palette = ['#2d8f5c', '#1a8a9e', '#d4793a', '#c9a843', '#3b7fc9'];
      var datasets = top5.map(function (crop, i) {
        return {
          label: crop,
          data: yrLabels.map(function (y) {
            var m = recs.filter(function (r) { return r.year === y && r.crop === crop; });
            if (!m.length) return null;
            return m.reduce(function (s, r) { return s + (Number(r.area_ha) || 0); }, 0);
          }),
          borderColor: palette[i], backgroundColor: palette[i], tension: 0.25, spanGaps: false, pointRadius: 2
        };
      });

      S.push(section(6, 'Crop Profile — Area, Production & Yield', {
        icon: 'fa-seedling', available: true, level: levelBadge('district', lvl).text,
        source: 'DES, Dept. of Agriculture and Farmers Welfare (data.desagri.gov.in) · ' +
          (meta.year_range ? meta.year_range[0] + ' to ' + meta.year_range[1] : '') +
          (meta.last_updated ? ' · last updated ' + meta.last_updated : ''),
        blocks: [
          kpiBlock([
            { label: 'LATEST YEAR PUBLISHED', value: latest, color: 'var(--cyan)' },
            { label: 'CROPS REPORTED', value: String(latestRecs.length), color: 'var(--green)' },
            { label: 'TOTAL SOWN AREA (ha)', value: fmt(totalArea, 'num', 0), color: 'var(--teal)' },
            { label: 'RECORDS IN SERIES', value: fmt(recs.length, 'num', 0), color: 'var(--yellow)' }
          ]),
          tableBlock([
            { label: 'Crop', align: 'left' }, { label: 'Season', align: 'left' },
            { label: 'Area (ha)', align: 'right', type: 'num', dec: 0 },
            { label: 'Production', align: 'right', type: 'num', dec: 0 },
            { label: 'Yield (t/ha)', align: 'right', type: 'num', dec: 2 },
            { label: 'Production unit', align: 'left' }
          ], rows, 'All crops reported for ' + latest + ', sorted by area. Production is in tonnes except where the row\'s own unit says otherwise (cotton/jute are in bales).'),
          chartBlock('vrChartCropTrend', {
            type: 'line',
            data: { labels: yrLabels, datasets: datasets },
            options: mergeOpts({ scales: { y: { title: { display: true, text: 'Area (hectares)' } } } })
          }, 'Sown area by year — the five largest crops of ' + latest + ' (X = crop year, Y = area in hectares). Gaps are years the source did not report that crop; they are left broken, never interpolated.')
        ]
      }));

      // ---- 7. season split
      var seasons = {};
      latestRecs.forEach(function (r) {
        var s = r.season || 'Not stated';
        if (!seasons[s]) seasons[s] = { area: 0, prod: 0, n: 0 };
        seasons[s].area += Number(r.area_ha) || 0;
        seasons[s].prod += Number(r.production) || 0;
        seasons[s].n += 1;
      });
      var sRows = Object.keys(seasons).sort().map(function (s) {
        return [s, seasons[s].n, seasons[s].area, totalArea > 0 ? seasons[s].area * 100 / totalArea : null];
      });
      S.push(section(7, 'Crop Season Analysis (Kharif / Rabi / Summer)', {
        icon: 'fa-calendar-days', available: true, level: levelBadge('district', lvl).text,
        source: 'DES, data.desagri.gov.in · season labels are the source\'s own · ' + latest,
        blocks: [
          tableBlock([
            { label: 'Season (as labelled by DES)', align: 'left' },
            { label: 'Crops reported', align: 'right', type: 'num', dec: 0 },
            { label: 'Area (ha)', align: 'right', type: 'num', dec: 0 },
            { label: 'Share of sown area (%)', align: 'right', type: 'num', dec: 1 }
          ], sRows, 'Seasonal split for ' + latest + ', aggregated from the per-crop rows above.'),
          noteBlock('A sowing/harvesting crop calendar (dates per crop) is not shown — this project carries no crop-calendar ' +
            'dataset, and dates cannot be derived from area/production tables.')
        ]
      }));
    })();

    // ---- 8. Horticulture (state level) --------------------------------
    (function () {
      var h = ok(D.hort) ? D.hort.data : null;
      if (!h || !h.records || !h.records.length) {
        S.push(section(8, 'Horticulture & Vegetables', {
          icon: 'fa-apple-whole', available: false,
          naReason: ctx.stateName
            ? 'Data not available for the selected location. ' + gapReason(D.hort, 'state horticulture table',
                'Horticultural Statistics at a Glance reports 28 of 36 states/UTs individually; the rest are folded into the source\'s own "OTHERS" aggregate and are never split out or guessed.')
            : 'Data not available for the selected location. Horticulture is published at STATE level only — select a State.',
          source: 'Horticultural Statistics at a Glance 2023, Horticulture Statistics Unit, DA&FW'
        }));
        return;
      }
      var recs = h.records.slice().sort(function (a, b) { return (b.area_ha || b.area || 0) - (a.area_ha || a.area || 0); });
      var hYears = recs.map(function (r) { return r.year; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort();
      var cols = Object.keys(recs[0]);
      var pick = function (r, names) { for (var i = 0; i < names.length; i++) { if (has(r[names[i]])) return r[names[i]]; } return null; };
      var rows = recs.slice(0, 40).map(function (r) {
        return [
          pick(r, ['crop', 'commodity', 'name']),
          pick(r, ['category', 'group', 'type']),
          pick(r, ['year']),
          pick(r, ['area_ha', 'area', 'area_000_ha']),
          pick(r, ['production_tonnes', 'production_t', 'production', 'production_000_t']),
          pick(r, ['yield_tonnes_per_ha', 'yield_t_per_ha', 'yield', 'productivity'])
        ];
      });
      S.push(section(8, 'Horticulture & Vegetables', {
        icon: 'fa-apple-whole', available: true, level: levelBadge('state', lvl).text,
        source: (h.metadata && h.metadata.source ? h.metadata.source : 'Horticultural Statistics at a Glance 2023') +
          (h.metadata && h.metadata.last_updated ? ' · ' + h.metadata.last_updated : ''),
        blocks: [
          noteBlock('STATE-LEVEL FIGURES. No district-wise, block-wise or village-wise horticulture dataset exists ' +
            'for India in this project (checked; see docs/CROP_DATA_COVERAGE.md). These are ' + esc(ctx.stateName) +
            '\'s state totals and are NOT specific to ' + esc(ctx.districtName || ctx.stateName) + '.'),
          tableBlock([
            { label: 'Crop', align: 'left' }, { label: 'Category', align: 'left' },
            { label: 'Year', align: 'left' },
            { label: 'Area (ha)', align: 'right', type: 'num', dec: 0 },
            { label: 'Production (t)', align: 'right', type: 'num', dec: 0 },
            { label: 'Yield (t/ha)', align: 'right', type: 'num', dec: 2 }
          ], rows, 'Reporting year(s) in this table: ' + hYears.join(', ') + '. ' +
            (recs.length > 40 ? 'Showing the 40 largest of ' + recs.length + ' crops.' : ''))
        ]
      }));
      void cols;
    })();

    // ---- 9. Rainfall & climate indices --------------------------------
    var climate = ok(D.climate) ? D.climate.data : null;
    (function () {
      if (!climate || !climate.indices) {
        S.push(section(9, 'Rainfall & Climate Indices', {
          icon: 'fa-cloud-rain', available: false,
          naReason: ctx.districtName
            ? 'Climate data not yet available for ' + esc(ctx.districtName) + '. ' + gapReason(D.climate, 'district climate index file',
                'Indices have been computed for 726 of India\'s districts so far; no neighbouring or parent unit\'s numbers are substituted here.')
            : 'Data not available for the selected location. Climate indices are computed per district — select a District.',
          source: 'IMD 0.05° gridded daily (5 original MP districts) / ERA5-Land + CHIRPS via Google Earth Engine'
        }));
        return;
      }
      var ix = climate.indices, meta = climate.metadata || {};
      var G = [
        ['Rainfall', [
          ['Mean annual rainfall', 'annual_rain_mm', 'mm/year', 1],
          ['R95p — rain on very wet days', 'r95p_mm', 'mm/year', 1],
          ['R99p — rain on extremely wet days', 'r99p_mm', 'mm/year', 1],
          ['Rx1day — wettest single day', 'rx1day_mm', 'mm', 1],
          ['Rx5day — wettest 5-day spell', 'rx5day_mm', 'mm', 1],
          ['95th-percentile daily-rain threshold', 'p95_threshold_mm', 'mm/day', 1],
          ['99th-percentile daily-rain threshold', 'p99_threshold_mm', 'mm/day', 1],
          ['Extreme rain days (above the 95th pct)', 'extreme_days', 'days/year', 2],
          ['CDD — longest dry spell', 'cdd', 'days', 1],
          ['CWD — longest wet spell', 'cwd', 'days', 1]
        ]],
        ['Temperature & heat', [
          ['Heatwave days', 'heatwave_days', 'days/year', 2],
          ['Severe heatwave days', 'severe_heatwave_days', 'days/year', 2],
          ['Maximum summer Tmax', 'max_summer_tmax', '°C', 2],
          ['Mean summer Tmax', 'mean_summer_tmax', '°C', 2]
        ]],
        ['Drought (McKee SPI)', [
          ['SPI-3 (mean)', 'spi_3', 'index', 3],
          ['SPI-6 (mean)', 'spi_6', 'index', 3],
          ['SPI-12 (mean)', 'spi_12', 'index', 3],
          ['Drought months', 'drought_months', 'months/year', 2],
          ['Severe drought months', 'severe_drought_months', 'months/year', 2],
          ['Drought probability', 'drought_probability_pct', '%', 1]
        ]]
      ];
      var blocks = [kpiBlock([
        { label: 'ANNUAL RAINFALL', value: fmt(ix.annual_rain_mm, 'num', 0) + ' mm', color: 'var(--blue)' },
        { label: 'MEAN SUMMER TMAX', value: fmt(ix.mean_summer_tmax, 'num', 1) + ' °C', color: 'var(--orange)' },
        { label: 'HEATWAVE DAYS/YR', value: fmt(ix.heatwave_days, 'num', 2), color: 'var(--red)' },
        { label: 'DROUGHT PROBABILITY', value: fmt(ix.drought_probability_pct, 'num', 1) + ' %', color: 'var(--yellow)' }
      ])];
      G.forEach(function (grp) {
        var rows = grp[1].filter(function (r) { return has(ix[r[1]]); })
          .map(function (r) { return [r[0], { v: ix[r[1]], dec: r[3] }, r[2]]; });
        if (rows.length) {
          blocks.push(tableBlock([
            { label: grp[0], align: 'left' },
            { label: 'Value', align: 'right', type: 'num', dec: 2 },
            { label: 'Unit', align: 'left' }
          ], rows));
        }
      });
      blocks.push(noteBlock('Every figure is a ' + esc(meta.years || '2000-2024') + ' mean for the whole district polygon. ' +
        'The underlying grids (ERA5-Land ~9 km, CHIRPS ~5.5 km) are far coarser than a village (~2 km²), so these are ' +
        'district climatology, not a village-resolved product — see docs/METHODOLOGY.md §3.1 on the modifiable areal unit problem.'));
      S.push(section(9, 'Rainfall & Climate Indices', {
        icon: 'fa-cloud-rain', available: true, level: levelBadge('district', lvl).text,
        source: (meta.source || 'ERA5-Land + CHIRPS via Google Earth Engine') + ' · ' + (meta.years || '2000-2024') +
          (meta.last_updated ? ' · last updated ' + meta.last_updated : ''),
        blocks: blocks
      }));
    })();

    // ---- 10. Drought & heat risk (rule-based advisory flags) ----------
    (function () {
      var a = ok(D.advisory) ? D.advisory.data : null;
      if (!a || !a.flags) {
        S.push(section(10, 'Drought & Heat Risk Assessment', {
          icon: 'fa-triangle-exclamation', available: false,
          naReason: ctx.districtName
            ? 'Data not available for the selected location. ' + gapReason(D.advisory, 'advisory flag file', 'Flags are derived from the climate/NDVI/soil-moisture files above; a district with none of those has no flags either.')
            : 'Data not available for the selected location. Risk flags are derived per district — select a District.',
          source: 'Rule-based layer over this portal\'s own published climate/NDVI/soil-moisture outputs'
        }));
        return;
      }
      var f = a.flags;
      var rows = Object.keys(f).map(function (k) {
        var label = k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        return [label, f[k].level, f[k].note || ''];
      });
      S.push(section(10, 'Drought & Heat Risk Assessment', {
        icon: 'fa-triangle-exclamation', available: true, level: levelBadge('district', lvl).text,
        source: (a.metadata && a.metadata.source ? 'Rule-based over this portal\'s own outputs' : '') +
          ' · fixed code-defined thresholds, see docs/METHODOLOGY.md §9' +
          (a.metadata && a.metadata.last_updated ? ' · ' + a.metadata.last_updated : ''),
        blocks: [
          tableBlock([
            { label: 'Risk flag', align: 'left' }, { label: 'Level', align: 'left' },
            { label: 'Basis (the exact real values and threshold used)', align: 'left' }
          ], rows),
          noteBlock('These are fixed threshold rules on real stored values — NOT a machine-learning model, NOT a ' +
            'probability, NOT a confidence score. Each row states the real numbers it was computed from.')
        ]
      }));
    })();

    // ---- 11. Soil moisture (the one genuinely multi-tier source) ------
    (function () {
      var sm = ok(D.soil) ? D.soil.data : null;
      if (!sm) {
        S.push(section(11, 'Soil Moisture (NASA SMAP L4)', {
          icon: 'fa-tint', available: false,
          naReason: ctx.districtName
            ? 'Data not available for the selected location. ' + gapReason(D.soil, 'SMAP soil-moisture file', 'Computed for 733 districts so far.')
            : 'Data not available for the selected location. Select a District (block and village tiers appear as you go deeper).',
          source: 'NASA SMAP L4 Global 3-hourly 9 km, via Google Earth Engine'
        }));
        return;
      }
      var meta = sm.metadata || {};
      var blocks = [];
      var dataLevel = 'district';
      var kpis = [];

      if (sm.district) {
        kpis.push({ label: 'DISTRICT SURFACE SM', value: fmt(sm.district.sm_surface_mean, 'num', 4) + ' m³/m³', color: 'var(--cyan)' });
        if (has(sm.district.sm_rootzone_mean)) {
          kpis.push({ label: 'DISTRICT ROOT-ZONE SM', value: fmt(sm.district.sm_rootzone_mean, 'num', 4) + ' m³/m³', color: 'var(--blue)' });
        }
      }
      // Block tier -- real, computed from that block's own villages' cells.
      var blockRow = null;
      if (ctx.blockName && sm.blocks) {
        blockRow = sm.blocks.filter(function (b) { return b.block_name === ctx.blockName; })[0] || null;
        if (blockRow) {
          dataLevel = 'block';
          kpis.push({ label: 'BLOCK SURFACE SM', value: fmt(blockRow.sm_surface_mean, 'num', 4) + ' m³/m³', color: 'var(--green)' });
        }
      }
      // Village tier -- the real 9 km cell nearest this village's centroid.
      var villCell = null;
      if (ctx.villageLgd && sm.villages && sm.district && sm.district.cells) {
        var entry = sm.villages[String(ctx.villageLgd)];
        if (entry) {
          var cellIdx = entry[2];
          villCell = sm.district.cells.filter(function (c) { return c.cell_index === cellIdx; })[0] || null;
          if (villCell) {
            dataLevel = 'village';
            kpis.push({ label: 'VILLAGE CELL SURFACE SM', value: fmt(villCell.sm_surface, 'num', 4) + ' m³/m³', color: 'var(--teal)' });
          }
        }
      }
      if (kpis.length) blocks.push(kpiBlock(kpis));

      var tierRows = [];
      if (sm.district) {
        tierRows.push(['District — ' + (ctx.districtName || ''), sm.district.sm_surface_mean, sm.district.sm_surface_stddev,
          sm.district.sm_rootzone_mean, sm.district.n_cells, 'real SMAP cells sampled over the district polygon']);
      }
      if (blockRow) {
        tierRows.push(['Block/Tehsil — ' + blockRow.block_name, blockRow.sm_surface_mean, blockRow.sm_surface_stddev,
          null, blockRow.n_villages, 'mean ± sd of this block\'s villages\' assigned cells']);
      }
      if (villCell) {
        tierRows.push(['Village — ' + (ctx.villageName || ''), villCell.sm_surface, null, villCell.sm_rootzone, 1,
          'the single 9 km cell nearest this village\'s centroid (shared with ' + (villCell.n_villages_sharing_cell - 1) + ' other villages)']);
      }
      blocks.push(tableBlock([
        { label: 'Tier', align: 'left' },
        { label: 'Surface SM (m³/m³)', align: 'right', type: 'num', dec: 4 },
        { label: 'Std. dev.', align: 'right', type: 'num', dec: 4 },
        { label: 'Root-zone SM (m³/m³)', align: 'right', type: 'num', dec: 4 },
        { label: 'N', align: 'right', type: 'num', dec: 0 },
        { label: 'What N counts', align: 'left' }
      ], tierRows, 'This is the only dataset in this report with genuinely computed block and village tiers.'));

      if (ctx.blockName && !blockRow) {
        blocks.push(noteBlock('No block tier for "' + esc(ctx.blockName) + '": the SMAP file names blocks from the ' +
          'Survey of India sub-district layer and this block name did not match one of them. The district figure above is shown instead, and is labelled as such.'));
      }
      if (ctx.villageLgd && !villCell) {
        blocks.push(noteBlock('No village tier for this village: it is not among the ' + fmt(sm.village_count_assigned, 'num', 0) +
          ' villages assigned a SMAP cell in this district file.'));
      }
      blocks.push(noteBlock('A 9 km SMAP cell is much larger than a village. The village row above is a real satellite ' +
        'reading, but it is a CELL value, not a village-resolved measurement — several villages share one cell.'));

      S.push(section(11, 'Soil Moisture (NASA SMAP L4)', {
        icon: 'fa-tint', available: true, level: levelBadge(dataLevel, lvl).text,
        source: (meta.source || 'NASA SMAP L4, via Google Earth Engine') + ' · ~9 km' +
          (meta.last_updated ? ' · ' + meta.last_updated : ''),
        blocks: blocks
      }));
    })();

    // ---- 12. Groundwater ----------------------------------------------
    (function () {
      var g = ok(D.gw) ? D.gw.data : null;
      if (!g || !g.district) {
        S.push(section(12, 'Groundwater — Water-Level Monitoring', {
          icon: 'fa-water', available: false,
          naReason: ctx.districtName
            ? 'Data not available for the selected location. ' + gapReason(D.gw, 'CGWB groundwater file', 'Real station data exists for 721 districts.')
            : 'Data not available for the selected location. Groundwater stations are aggregated per district — select a District.',
          source: 'Central Ground Water Board (CGWB), via National Water Data Portal'
        }));
        return;
      }
      var d = g.district, meta = g.metadata || {};
      var blocks = [kpiBlock([
        { label: 'LATEST MEAN WATER LEVEL', value: fmt(d.latest_gwl_mean_m, 'num', 2) + ' m bgl', color: 'var(--blue)' },
        { label: 'MONITORING STATIONS', value: fmt(d.n_stations, 'num', 0), color: 'var(--cyan)' },
        { label: 'LATEST READING', value: d.latest_reading_date || DASH, color: 'var(--teal)' },
        { label: 'MEAN TREND', value: (d.trend ? fmt(d.trend.mean_slope_m_per_year, 'num', 4) + ' m/yr' : DASH), color: 'var(--green)' }
      ])];
      if (d.trend) {
        blocks.push(tableBlock([{ label: 'District trend', align: 'left' }, { label: 'Value', align: 'left' }], [
          ['Mean slope', fmt(d.trend.mean_slope_m_per_year, 'num', 4) + ' m/year'],
          ['Direction (as classified by the source pipeline)', d.trend.direction || DASH],
          ['Stations with a computable trend', fmt(d.trend.n_stations_with_trend, 'num', 0) + ' of ' + fmt(d.n_stations, 'num', 0)]
        ]));
      }
      // Real block/village filtering: CGWB stations carry their own
      // block/tehsil/village names, so this is a genuine deeper-level read.
      var stations = g.stations || [];
      var dataLevel = 'district';
      var filtered = stations;
      if (ctx.blockName) {
        var bn = ctx.blockName.trim().toLowerCase();
        var bf = stations.filter(function (s) {
          return (s.block && String(s.block).trim().toLowerCase() === bn) ||
                 (s.tehsil && String(s.tehsil).trim().toLowerCase() === bn);
        });
        if (bf.length) { filtered = bf; dataLevel = 'block'; }
      }
      if (ctx.villageName) {
        var vn = ctx.villageName.trim().toLowerCase();
        var vf = filtered.filter(function (s) { return s.village && String(s.village).trim().toLowerCase() === vn; });
        if (vf.length) { filtered = vf; dataLevel = 'village'; }
      }
      var srows = filtered.slice(0, 60).map(function (s) {
        return [s.station, s.block || s.tehsil || DASH, s.village || DASH, s.latest_date,
          s.latest_gwl_m, s.trend ? s.trend.slope_m_per_year : null, s.n_readings,
          s.date_range ? s.date_range[0] + ' to ' + s.date_range[1] : DASH];
      });
      blocks.push(tableBlock([
        { label: 'Station', align: 'left' }, { label: 'Block/Tehsil', align: 'left' }, { label: 'Village', align: 'left' },
        { label: 'Latest reading date', align: 'left' },
        { label: 'Water level (m bgl)', align: 'right', type: 'num', dec: 2 },
        { label: 'Trend (m/yr)', align: 'right', type: 'num', dec: 4 },
        { label: 'Readings', align: 'right', type: 'num', dec: 0 },
        { label: 'Record span', align: 'left' }
      ], srows, (dataLevel === 'district'
          ? 'All ' + stations.length + ' CGWB stations in this district'
          : 'The ' + filtered.length + ' station(s) CGWB itself records inside ' + esc(dataLevel === 'village' ? ctx.villageName : ctx.blockName)) +
        (filtered.length > 60 ? ' — showing the first 60.' : '.') +
        ' "m bgl" = metres below ground level; a larger number means a deeper water table.'));

      if (ctx.blockName && dataLevel === 'district') {
        blocks.push(noteBlock('No CGWB station falls inside "' + esc(ctx.blockName) + '" (or the station\'s own block ' +
          'spelling differs from the Survey of India name). The district aggregate is shown instead, and is labelled as such.'));
      }
      blocks.push(noteBlock('Irrigation-well counts and command-area figures are not published in this source; only ' +
        'monitoring-well water levels are. Village-level irrigation source AREAS are in section 4, from a different source.'));

      S.push(section(12, 'Groundwater — Water-Level Monitoring', {
        icon: 'fa-water', available: true, level: levelBadge(dataLevel, lvl).text,
        source: (meta.source || 'CGWB via National Water Data Portal (nwdp.nwic.gov.in)') +
          (d.latest_reading_date ? ' · latest reading ' + d.latest_reading_date : ''),
        blocks: blocks
      }));
    })();

    // ---- 13. Soil nutrient profile -- NO REAL SOURCE ------------------
    S.push(section(13, 'Soil Type & Nutrient Profile (pH, NPK, micronutrients)', {
      icon: 'fa-vial', available: false,
      naReason: 'Data not available for the selected location. This project integrates no soil-type, soil-pH, ' +
        'macro/micronutrient or Soil Health Card dataset at any administrative level. The Soil Health Card portal ' +
        '(soilhealth.dac.gov.in) publishes village-level nutrient status and is the correct real source, but it is not ' +
        'fetched by any script in this repository — so nothing is shown here rather than a soil type inferred from ' +
        'the region, which would be a guess.',
      source: 'No source integrated. Candidate: Soil Health Card portal, DA&FW (not yet fetched).'
    }));

    // ---- 14. Vegetation / remote sensing ------------------------------
    (function () {
      var n = ok(D.ndvi) ? D.ndvi.data : null;
      if (!n || !n.annual_ndvi || !n.annual_ndvi.length) {
        S.push(section(14, 'Vegetation & Remote Sensing (NDVI)', {
          icon: 'fa-leaf', available: false,
          naReason: ctx.districtName
            ? 'Data not available for the selected location. ' + gapReason(D.ndvi, 'district NDVI file', 'MODIS NDVI is computed for 733 districts.')
            : 'Data not available for the selected location. NDVI is computed per district — select a District.',
          source: 'MODIS Terra MOD13Q1 v061 (250 m, 16-day), via Google Earth Engine'
        }));
        return;
      }
      var series = n.annual_ndvi, ps = n.period_summary || {}, meta = n.metadata || {};
      var rows = series.map(function (r) { return [r.year, r.ndvi_mean, r.ndvi_stddev, r.n_composites, r.pixel_count]; });
      S.push(section(14, 'Vegetation & Remote Sensing (NDVI)', {
        icon: 'fa-leaf', available: true, level: levelBadge('district', lvl).text,
        source: (meta.source ? 'MODIS Terra MOD13Q1 v061, 250 m, via Google Earth Engine' : '') +
          ' · ' + (ps.years_covered ? ps.years_covered + ' years' : '') + (meta.last_updated ? ' · ' + meta.last_updated : ''),
        blocks: [
          kpiBlock([
            { label: 'MEAN NDVI', value: fmt(ps.ndvi_mean, 'num', 4), color: 'var(--green)' },
            { label: 'MIN / MAX', value: fmt(ps.ndvi_min, 'num', 3) + ' / ' + fmt(ps.ndvi_max, 'num', 3), color: 'var(--teal)' },
            { label: 'STD. DEV.', value: fmt(ps.ndvi_stddev, 'num', 4), color: 'var(--cyan)' },
            { label: 'YEARS COVERED', value: fmt(ps.years_covered, 'num', 0), color: 'var(--yellow)' }
          ]),
          chartBlock('vrChartNdvi', {
            type: 'line',
            data: {
              labels: series.map(function (r) { return r.year; }),
              datasets: [{
                label: 'Annual mean NDVI', data: series.map(function (r) { return r.ndvi_mean; }),
                borderColor: '#2d8f5c', backgroundColor: 'rgba(45,143,92,0.12)', fill: true, tension: 0.3, pointRadius: 2
              }]
            },
            options: mergeOpts({ scales: { y: { title: { display: true, text: 'NDVI (dimensionless)' } } } })
          }, 'X = year, Y = annual mean NDVI (dimensionless, −1 to 1). Source: MODIS MOD13Q1 250 m via GEE.'),
          tableBlock([
            { label: 'Year', align: 'left' },
            { label: 'Mean NDVI', align: 'right', type: 'num', dec: 4 },
            { label: 'Std. dev.', align: 'right', type: 'num', dec: 4 },
            { label: '16-day composites', align: 'right', type: 'num', dec: 0 },
            { label: 'Pixels', align: 'right', type: 'num', dec: 0 }
          ], rows, 'Full annual series as published.'),
          noteBlock('EVI, NDMI, LST and a drought-stress index are NOT available: this project computes and stores NDVI ' +
            'only. They are each derivable from the same MODIS/Landsat archives via Google Earth Engine, but no script ' +
            'here produces them, so no such layer is shown.')
        ]
      }));
    })();

    // ---- 15. Mandi & market -------------------------------------------
    (function () {
      var m = ok(D.mandi) ? D.mandi.data : null;
      var dkey = ctx.districtSlug;
      var rec = (m && m.districts && dkey) ? m.districts[dkey] : null;
      var meta = (m && m.metadata) || {};
      if (!rec) {
        S.push(section(15, 'Mandi & Market Intelligence', {
          icon: 'fa-indian-rupee-sign', available: false,
          naReason: ctx.districtName
            ? 'Data not available for the selected location. This district is not among the ' +
              (m && m.districts ? Object.keys(m.districts).length : 733) + ' carried in the AGMARKNET pull ' +
              '(its Survey of India name may not match AGMARKNET\'s own district spelling). No price is carried over from another district.'
            : 'Data not available for the selected location. Mandi prices are aggregated per district — select a District.',
          source: 'AGMARKNET via data.gov.in, Ministry of Agriculture and Farmers Welfare'
        }));
        return;
      }
      if (!rec.records || !rec.records.length) {
        S.push(section(15, 'Mandi & Market Intelligence', {
          icon: 'fa-indian-rupee-sign', available: false,
          naReason: 'Data not available for the selected location/period. ' + (rec.note || '') +
            ' No price is interpolated, carried forward from an earlier day, or borrowed from a neighbouring mandi.',
          source: 'AGMARKNET via data.gov.in · release of ' + (meta.last_updated || '') +
            ' · note: most districts report no arrivals on any given day; ' +
            (m && m.districts ? Object.keys(m.districts).filter(function (k) { return !m.districts[k].records || !m.districts[k].records.length; }).length : '?') +
            ' of ' + (m && m.districts ? Object.keys(m.districts).length : '?') + ' districts are empty in this release'
        }));
        return;
      }
      var rows = rec.records.map(function (r) {
        return [r.market, r.commodity, r.variety, r.grade, r.arrival_date, r.min_price, r.max_price, r.modal_price];
      });
      S.push(section(15, 'Mandi & Market Intelligence', {
        icon: 'fa-indian-rupee-sign', available: true, level: levelBadge('district', lvl).text,
        source: 'AGMARKNET via data.gov.in, MoA&FW · APMC market, aggregated to district · release of ' + (meta.last_updated || ''),
        blocks: [
          kpiBlock([
            { label: 'PRICE RECORDS', value: fmt(rec.count, 'num', 0), color: 'var(--green)' },
            { label: 'ARRIVAL DATE(S)', value: (rec.arrival_dates || []).join(', ') || DASH, color: 'var(--cyan)' },
            { label: 'ROWS DROPPED AS UNUSABLE', value: fmt(rec.dropped, 'num', 0), color: 'var(--orange)' }
          ]),
          tableBlock([
            { label: 'Market (APMC)', align: 'left' }, { label: 'Commodity', align: 'left' },
            { label: 'Variety', align: 'left' }, { label: 'Grade', align: 'left' }, { label: 'Arrival date', align: 'left' },
            { label: 'Min (₹/qtl)', align: 'right', type: 'num', dec: 0 },
            { label: 'Max (₹/qtl)', align: 'right', type: 'num', dec: 0 },
            { label: 'Modal (₹/qtl)', align: 'right', type: 'num', dec: 0 }
          ], rows, 'Prices in ₹ per quintal, exactly as released. Rows without a usable min/max/modal price were dropped upstream, not repaired.'),
          noteBlock('A price TREND is not shown: this file is a single daily snapshot, not a historical price series. ' +
            'Plotting a trend from one day\'s rows would be fabrication.')
        ]
      }));
    })();

    // ---- 16/17/18/19: honest gaps -------------------------------------
    S.push(section(16, 'Pest & Disease Intelligence', {
      icon: 'fa-bug', available: false,
      naReason: 'Data not available for the selected location. No pest-surveillance or crop-disease dataset is integrated ' +
        'anywhere in this project at any level. The National Pest Surveillance System (NPSS, npss.dac.gov.in) and ICAR-CRIDA ' +
        'advisories are the real candidate sources; neither is fetched by any script here. Pest pressure is therefore not ' +
        'inferred from weather, which would be a model output presented as an observation.',
      source: 'No source integrated. Candidates: NPSS (DA&FW), ICAR-CRIDA.'
    }));
    S.push(section(17, 'Fertilizer & Input Use', {
      icon: 'fa-flask', available: false,
      naReason: 'Data not available for the selected location. No fertilizer consumption, seed, or agro-input dataset is ' +
        'integrated. Fertiliser Association of India and DA&FW publish state- and district-level NPK consumption; none is ' +
        'fetched by this repository, and no recommendation is generated from crop area, which would be an invented figure.',
      source: 'No source integrated. Candidates: FAI Fertiliser Statistics, DA&FW input statistics.'
    }));
    S.push(section(18, 'Socio-Economic & Infrastructure Profile', {
      icon: 'fa-people-roof', available: !!vp,
      naReason: 'Data not available for the selected location. Select a Village — and note that even then, only the ' +
        'Survey of India fields below exist here.',
      level: vp ? levelBadge('village', lvl).text : '',
      source: 'Survey of India village-boundary attribute table, via NWDP',
      blocks: vp ? [
        tableBlock([{ label: 'Indicator', align: 'left' }, { label: 'Value', align: 'left' }], (function () {
          var r = [];
          if (has(vp.population)) r.push(['Population', fmt(vp.population, 'num', 0)]);
          if (has(vp.households)) r.push(['Households', fmt(vp.households, 'num', 0)]);
          if (has(vp.avg_household_size)) r.push(['Average household size', String(vp.avg_household_size)]);
          if (has(vp.nearest_town)) r.push(['Nearest town', vp.nearest_town]);
          if (has(vp.nearest_town_distance_km)) r.push(['Distance to nearest town', vp.nearest_town_distance_km + ' km']);
          if (has(vp.has_pin_code)) r.push(['PIN code assigned', vp.has_pin_code === 1 ? 'Yes' : 'No']);
          if (has(vp.drainage_closed) || has(vp.drainage_open)) {
            r.push(['Drainage', (vp.drainage_closed === 1 ? 'Closed ' : '') + (vp.drainage_open === 1 ? 'Open' : '') || 'None recorded']);
          }
          return r;
        })()),
        noteBlock('THIS IS THE COMPLETE LIST. Literacy, worker classification (cultivators / agricultural labourers / ' +
          'household industry / other), SC/ST composition, school/health/bank/electricity amenities, road connectivity, ' +
          'livestock and farmer-category counts are NOT available: the Survey of India village layer used here carries 48 ' +
          'attribute columns, and none of those subjects is among them. Census of India village amenity tables are the real ' +
          'source and are not integrated in this project.')
      ] : []
    }));
    S.push(section(19, 'Government Schemes & Farmer Welfare', {
      icon: 'fa-hand-holding-dollar', available: false,
      naReason: 'Data not available for the selected location. No scheme enrollment or benefit-transfer dataset ' +
        '(PM-KISAN, PMFBY crop insurance, Soil Health Card, KCC, PMKSY) is integrated at any level. Several publish ' +
        'aggregate figures via data.gov.in; none is fetched here, and beneficiary counts are never estimated from population.',
      source: 'No source integrated. Candidates: PM-KISAN, PMFBY and SHC dashboards via data.gov.in.'
    }));

    // ---- 20. Data availability summary + source register --------------
    (function () {
      var rows = S.map(function (s) {
        return [s.n + '. ' + s.title, s.available ? 'Available' : 'Not available',
          s.available ? (s.level || '—') : '—', s.source || '—'];
      });
      S.push(section(20, 'Data Availability Summary & Source Register', {
        icon: 'fa-clipboard-check', available: true,
        level: 'Report-wide',
        source: 'Computed live from what actually loaded for this selection — not a static list',
        blocks: [
          kpiBlock([
            { label: 'SECTIONS WITH REAL DATA', value: String(S.filter(function (s) { return s.available; }).length) + ' of ' + String(S.length + 1), color: 'var(--green)' },
            { label: 'SELECTION LEVEL', value: lvl ? lvl.toUpperCase() : '—', color: 'var(--cyan)' },
            { label: 'GENERATED', value: new Date().toLocaleString('en-IN'), color: 'var(--teal)' }
          ]),
          tableBlock([
            { label: 'Section', align: 'left' }, { label: 'Status', align: 'left' },
            { label: 'Level of the data actually shown', align: 'left' }, { label: 'Source', align: 'left' }
          ], rows, 'A "Not available" row is the correct, intended output where this project has no real source — never a placeholder to be filled in later with an estimate.')
        ]
      }));
    })();

    return S;
  }

  function mergeOpts(extra) {
    var base = (typeof chartOpts === 'function')
      ? chartOpts({ color: 'rgba(0,0,0,0.06)' })
      : { responsive: true, maintainAspectRatio: false };
    // shallow-merge one level deep for scales/plugins
    var out = JSON.parse(JSON.stringify(base));
    if (!extra) return out;
    Object.keys(extra).forEach(function (k) {
      if (typeof extra[k] === 'object' && !Array.isArray(extra[k]) && out[k]) {
        Object.keys(extra[k]).forEach(function (k2) {
          out[k][k2] = Object.assign({}, out[k][k2] || {}, extra[k][k2]);
        });
      } else { out[k] = extra[k]; }
    });
    return out;
  }

  // =====================================================================
  // HTML RENDERER
  // =====================================================================
  function renderBlocks(sec) {
    var h = '';
    sec.blocks.forEach(function (b) {
      if (b.type === 'kpi') {
        if (!b.items || !b.items.length) return;
        h += '<div class="vr-kpis">' + b.items.map(function (i) {
          return '<div class="vr-kpi"><div class="vr-kpi-label">' + esc(i.label) + '</div>' +
            '<div class="vr-kpi-value" style="color:' + (i.color || 'var(--text)') + '">' + esc(i.value) + '</div></div>';
        }).join('') + '</div>';
      } else if (b.type === 'table') {
        if (!b.rows || !b.rows.length) return;
        h += '<div class="vr-table-wrap"><table class="vr-table"><thead><tr>' +
          b.cols.map(function (c) {
            return '<th class="' + (c.align === 'right' ? 'vr-r' : 'vr-l') + '">' + esc(c.label) + '</th>';
          }).join('') + '</tr></thead><tbody>' +
          b.rows.map(function (r) {
            return '<tr>' + r.map(function (cell, i) {
              var c = b.cols[i] || {};
              var val = cellValue(cell), dec = cellDec(cell, c);
              var txt = (c.type === 'num') ? fmt(val, 'num', dec) : (has(val) ? String(val) : DASH);
              return '<td class="' + (c.align === 'right' ? 'vr-r vr-num' : 'vr-l') + '">' + esc(txt) + '</td>';
            }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
        if (b.caption) h += '<div class="vr-caption">' + esc(b.caption) + '</div>';
      } else if (b.type === 'chart') {
        h += '<div class="vr-chart"><canvas id="' + esc(b.id) + '"></canvas></div>';
        if (b.caption) h += '<div class="vr-caption">' + esc(b.caption) + '</div>';
      } else if (b.type === 'note') {
        h += '<div class="vr-note">' + esc(b.text) + '</div>';
      }
    });
    return h;
  }

  function renderSectionHtml(sec) {
    var badge = sec.available && sec.level
      ? '<span class="vr-badge ' + (/no .*-specific source|State-level figure/.test(sec.level) ? 'vr-badge-coarse' : 'vr-badge-exact') + '">' + esc(sec.level) + '</span>'
      : (sec.available ? '' : '<span class="vr-badge vr-badge-na">Not available</span>');
    var body = sec.available
      ? renderBlocks(sec)
      : '<div class="vr-na"><i class="fa fa-circle-minus"></i><div><b>Data not available for the selected location/period.</b><br>' + esc(sec.naReason.replace(/^Data not available for the selected location[/a-z]*\.\s*/i, '')) + '</div></div>';
    return '<section class="vr-section" id="vr-sec-' + sec.n + '">' +
      '<div class="vr-sec-head"><span class="vr-sec-n">' + sec.n + '</span>' +
      '<i class="fa ' + esc(sec.icon) + '"></i>' +
      '<h3>' + esc(sec.title) + '</h3>' + badge + '</div>' +
      '<div class="vr-sec-body">' + body + '</div>' +
      (sec.source ? '<div class="vr-source">Source · ' + esc(sec.source) + '</div>' : '') +
      '</section>';
  }

  function renderToc(sections) {
    return '<nav class="vr-toc"><div class="vr-toc-title">Report contents</div>' +
      sections.map(function (s) {
        return '<a href="#vr-sec-' + s.n + '" class="vr-toc-item ' + (s.available ? '' : 'vr-toc-na') + '" ' +
          'onclick="VindhyaVillageReport._jump(' + s.n + ');return false;">' +
          '<span class="vr-toc-n">' + s.n + '</span>' + esc(s.title) +
          (s.available ? '' : ' <span class="vr-toc-tag">n/a</span>') + '</a>';
      }).join('') + '</nav>';
  }

  function destroyCharts() {
    _charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* already gone */ } });
    _charts = [];
  }

  function instantiateCharts(sections) {
    if (typeof Chart === 'undefined') return;
    sections.forEach(function (s) {
      if (!s.available) return;
      s.blocks.forEach(function (b) {
        if (b.type !== 'chart') return;
        var cv = el(b.id);
        if (!cv) return;
        try { _charts.push(new Chart(cv.getContext('2d'), b.config)); }
        catch (e) { console.warn('[village_report] chart failed:', b.id, e); }
      });
    });
  }

  // =====================================================================
  // SELECTOR UI
  // =====================================================================
  function optionsOf(selectId) {
    var s = el(selectId);
    if (!s) return [];
    var out = [];
    for (var i = 0; i < s.options.length; i++) {
      if (!s.options[i].value) continue;
      out.push({ value: s.options[i].value, label: s.options[i].textContent });
    }
    return out;
  }

  function driveMaster(selectId, value) {
    var s = el(selectId);
    if (!s) return;
    s.value = value;
    // A real 'change' event fires the inline onchange="onDistrictChange(...)"
    // attributes exactly as a user's own click does -- which is what keeps
    // the map, breadcrumb and every other loader in sync, without this
    // module reimplementing any of national_selector.js's cascade.
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Gram Panchayat names come from the village layer's own real gp_name
  // attribute, so the GP dropdown needs that file -- which otherwise only
  // arrives when a report is generated. Selecting a block must be enough
  // (caught live on Punjab/Ludhiana/Jagraon: the GP dropdown sat empty
  // because this read the cache without ever filling it), so kick the
  // fetch off here and rebuild the selector once it lands. _gpFetching
  // guards against re-entering on every 700 ms poll tick.
  var _gpFetching = {};
  function gpListForBlock(ctx) {
    var url = 'data/boundaries/' + 'soi/villages/' + ctx.stateSlug + '/' + ctx.districtSlug + '.geojson';
    var res = _cache[url];
    if (!res) {
      if (!_gpFetching[url]) {
        _gpFetching[url] = true;
        getJson(url).then(function () { rebuildSelectorOnly(); });
      }
      return { supported: null, names: [], loading: true };
    }
    if (!ok(res)) return { supported: null, names: [] };
    var feats = res.data.features.filter(function (f) {
      var p = f.properties || {};
      return !ctx.blockName || p.block_name === ctx.blockName || p.subdistrict_name === ctx.blockName;
    });
    var withGp = feats.filter(function (f) { return String(f.properties.gp_name || '').trim(); });
    var names = withGp.map(function (f) { return String(f.properties.gp_name).trim(); })
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    return { supported: names.length > 0, names: names, total: feats.length, withGp: withGp.length };
  }

  function villagesForGp(ctx, gp) {
    var res = _cache['data/boundaries/' + 'soi/villages/' + ctx.stateSlug + '/' + ctx.districtSlug + '.geojson'];
    if (!ok(res)) return [];
    return res.data.features.filter(function (f) {
      var p = f.properties || {};
      var inBlock = !ctx.blockName || p.block_name === ctx.blockName || p.subdistrict_name === ctx.blockName;
      return inBlock && String(p.gp_name || '').trim() === gp;
    });
  }

  function renderSelector(ctx) {
    var gp = ctx.blockName ? gpListForBlock(ctx) : { supported: null, names: [] };
    function sel(id, label, opts, value, disabled, placeholder) {
      return '<div class="vr-field"><label>' + esc(label) + '</label>' +
        '<select id="' + id + '"' + (disabled ? ' disabled' : '') + '>' +
        '<option value="">' + esc(placeholder) + '</option>' +
        opts.map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('') + '</select></div>';
    }
    var gpPlaceholder = !ctx.blockName ? '-- Select Block first --'
      : (gp.loading ? 'Loading…'
        : (gp.supported === false ? 'Not recorded by SoI in this block' : '-- All Gram Panchayats --'));
    var villageOpts = optionsOf('villageSelect');
    if (ctx.gpName) {
      var members = villagesForGp(ctx, ctx.gpName).map(function (f) { return String(f.properties.vil_lgd); });
      villageOpts = villageOpts.filter(function (o) { return members.indexOf(String(o.value)) >= 0; });
    }

    return '<div class="vr-selector">' +
      '<div class="vr-fields">' +
      sel('vr-state', 'State / UT', optionsOf('stateSelect'), ctx.stateName, false, '-- Select State --') +
      sel('vr-district', 'District', optionsOf('districtSelect'), ctx.districtName, !ctx.stateName, '-- Select District --') +
      sel('vr-block', 'Block / Tehsil', optionsOf('blockSelect'), ctx.blockName, !ctx.districtName, '-- Select Block/Tehsil --') +
      sel('vr-gp', 'Gram Panchayat', gp.names.map(function (n) { return { value: n, label: n }; }), ctx.gpName, !ctx.blockName || gp.supported === false || gp.loading, gpPlaceholder) +
      sel('vr-village', 'Village', villageOpts, ctx.villageLgd, !ctx.blockName, '-- Select Village --') +
      '</div>' +
      '<div class="vr-actions">' +
      '<button class="vr-btn vr-btn-primary" onclick="VindhyaVillageReport.view()"><i class="fa fa-file-lines"></i> View Report</button>' +
      '<button class="vr-btn" onclick="VindhyaVillageReport.browse()"><i class="fa fa-list"></i> Browse Report</button>' +
      '<button class="vr-btn" onclick="VindhyaVillageReport.pdf()"><i class="fa fa-file-pdf"></i> Download PDF</button>' +
      '<button class="vr-btn" onclick="VindhyaVillageReport.excel()"><i class="fa fa-file-excel"></i> Download Excel</button>' +
      '<button class="vr-btn" onclick="VindhyaVillageReport.print()"><i class="fa fa-print"></i> Print Report</button>' +
      '</div>' +
      (ctx.blockName && gp.supported === false
        ? '<div class="vr-gp-note"><i class="fa fa-circle-info"></i> Gram Panchayat is unavailable for this block: the Survey of India ' +
          'village layer leaves <code>gp_name</code> blank for all ' + gp.total + ' villages here. It is populated in other states ' +
          '(e.g. Punjab, Kerala), where this dropdown fills automatically. No GP name is invented to fill the gap, and there is no ' +
          'official SoI Gram Panchayat boundary product to fall back on.</div>'
        : (ctx.gpName ? '<div class="vr-gp-note"><i class="fa fa-circle-info"></i> Gram Panchayat <b>' + esc(ctx.gpName) + '</b> — ' +
            villagesForGp(ctx, ctx.gpName).length + ' member village(s), as recorded in each village\'s own Survey of India ' +
            '<code>gp_name</code> attribute. There is no official SoI Gram Panchayat boundary polygon; the map shows the member ' +
            'villages\' own real boundaries, which is their combined extent, not a GP boundary.</div>' : '')) +
      '</div>';
  }

  function wireSelector() {
    var map = [
      ['vr-state', 'stateSelect'], ['vr-district', 'districtSelect'],
      ['vr-block', 'blockSelect'], ['vr-village', 'villageSelect']
    ];
    map.forEach(function (p) {
      var s = el(p[0]);
      if (!s) return;
      s.onchange = function () {
        if (p[0] === 'vr-state' || p[0] === 'vr-district' || p[0] === 'vr-block') _gpChoice = '';
        driveMaster(p[1], this.value);
        setTimeout(function () { refresh(true); }, 350);
      };
    });
    var g = el('vr-gp');
    if (g) {
      g.onchange = function () {
        _gpChoice = this.value || '';
        highlightGp();
        refresh(true);
      };
    }
  }

  // GP has no official boundary product -- so this draws the member
  // villages' OWN real polygons and fits to them. Nothing is dissolved
  // into a synthetic GP outline (STANDING ORDERS #3).
  var _gpLayer = null;
  function highlightGp() {
    var mapObj = window.leafletMap;
    if (!mapObj || typeof L === 'undefined') return;
    if (_gpLayer) { try { mapObj.removeLayer(_gpLayer); } catch (e) { /* gone */ } _gpLayer = null; }
    var ctx = readContext();
    if (!ctx.gpName) return;
    var feats = villagesForGp(ctx, ctx.gpName);
    if (!feats.length) return;
    var fc = { type: 'FeatureCollection', features: feats };
    var grp = L.layerGroup();
    L.geoJSON(fc, { style: { color: '#000000', weight: 5, opacity: 0.6, fill: false } }).addTo(grp);
    var bright = L.geoJSON(fc, { style: { color: '#C6FF00', weight: 2, opacity: 1, fill: false } });
    bright.addTo(grp);
    grp.addTo(mapObj);
    _gpLayer = grp;
    try {
      var b = bright.getBounds();
      if (b.isValid()) mapObj.fitBounds(b, { padding: [30, 30] });
    } catch (e) { /* ignore */ }
  }

  // =====================================================================
  // MAP LAYER CONTROLS (owner's section 2). Only real, already-wired
  // basemaps are offered. The requested Agriculture/Water Bodies/Roads/
  // Rivers/LULC overlays have no sourced layer in this project and are
  // named as unavailable rather than faked with placeholder polygons.
  // =====================================================================
  function renderMapControls() {
    var maps = [
      ['Satellite (Esri)', 'Satellite', 'fa-satellite'],
      ['Street (OSM)', 'Street', 'fa-road'],
      ['Terrain (OpenTopoMap)', 'Terrain', 'fa-mountain'],
      ['Light (Carto Positron)', 'Light', 'fa-sun'],
      ['Dark (Carto Dark Matter)', 'Dark', 'fa-moon']
    ];
    return '<div class="vr-maprow"><span class="vr-maprow-label"><i class="fa fa-layer-group"></i> Map basemap</span>' +
      maps.map(function (m) {
        return '<button class="vr-chip' + ((window.currentBasemap || 'Satellite (Esri)') === m[0] ? ' active' : '') +
          '" onclick="VindhyaVillageReport._basemap(\'' + m[0].replace(/'/g, "\\'") + '\')"><i class="fa ' + m[2] + '"></i> ' + m[1] + '</button>';
      }).join('') +
      '<span class="vr-maprow-na" title="No sourced layer exists for these in this project — they are not shown rather than drawn from placeholder geometry.">' +
      'Agriculture / Water Bodies / Rivers / Roads / LULC overlays: no real source integrated</span></div>';
  }

  // =====================================================================
  // RENDER
  // =====================================================================
  function headerHtml(ctx) {
    var path = ['India'];
    if (ctx.stateName) path.push(ctx.stateName);
    if (ctx.districtName) path.push(ctx.districtName);
    if (ctx.blockName) path.push(ctx.blockName);
    if (ctx.gpName) path.push(ctx.gpName + ' (GP)');
    if (ctx.villageName) path.push(ctx.villageName);
    return '<div class="vr-report-head">' +
      '<div class="vr-title">VINDHYA CLIMATE INTELLIGENCE</div>' +
      '<div class="vr-subtitle">Village Profile &amp; Agricultural Intelligence Report</div>' +
      '<div class="vr-path">' + path.map(esc).join(' &rsaquo; ') + '</div>' +
      '<div class="vr-generated">Generated ' + esc(new Date().toLocaleString('en-IN')) +
      ' · Report level: <b>' + esc(ctx.level ? ctx.level.toUpperCase() : 'NONE') + '</b></div>' +
      '</div>';
  }

  function idleHtml() {
    return '<div class="btm-pane-empty">' +
      '<i class="fa fa-house u-icon-lg-muted"></i>' +
      '<div><b>Village Profile &amp; Agricultural Intelligence Report</b><br>' +
      'Choose <b>State &rarr; District &rarr; Block/Tehsil &rarr; Gram Panchayat &rarr; Village</b> above, then press ' +
      '<b>View Report</b>. Every section states its own source, period and admin level; where this project has no real ' +
      'data for a subject, that section says so instead of showing an estimate.</div>' +
      '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> Or use the map\'s Location Selector</button>' +
      '</div>';
  }

  function shell(ctx, bodyHtml) {
    return '<div class="section-header"><i class="fa fa-house u-cyan-sm"></i>' +
      '<div class="section-title">VILLAGE PROFILE &amp; AGRICULTURAL INTELLIGENCE REPORT</div></div>' +
      '<div class="vr-root">' + renderSelector(ctx) + renderMapControls() +
      '<div id="vr-body">' + bodyHtml + '</div></div>';
  }

  function refresh(autoRender) {
    var host = el('pane-village');
    if (!host) return;
    var ctx = readContext();
    _ctx = ctx;
    var shouldRender = _rendered && autoRender !== false;
    host.innerHTML = shell(ctx, shouldRender ? '<div class="vr-loading"><i class="fa fa-spinner fa-spin"></i> Loading real data for this selection…</div>' : (_rendered ? '' : idleHtml()));
    wireSelector();
    if (shouldRender) doRender();
  }

  function doRender() {
    var host = el('pane-village');
    if (!host) return;
    var ctx = readContext();
    _ctx = ctx;
    var body = el('vr-body');
    if (!ctx.stateName) {
      if (body) body.innerHTML = '<div class="vr-na"><i class="fa fa-circle-minus"></i><div>' +
        '<b>No location selected.</b><br>Select at least a State to generate a report.</div></div>';
      return;
    }
    if (body) body.innerHTML = '<div class="vr-loading"><i class="fa fa-spinner fa-spin"></i> Loading real data for this selection…</div>';
    loadAll(ctx).then(function (D) {
      // Selection may have changed while fetching -- drop a stale render
      // rather than painting an old location's numbers (STANDING ORDERS #2).
      var now = readContext();
      if (ctxSignature(now) !== ctxSignature(ctx)) return;
      destroyCharts();
      var sections = buildSections(ctx, D);
      _sections = sections;
      _rendered = true;
      var b = el('vr-body');
      if (!b) return;
      b.innerHTML = headerHtml(ctx) +
        (_showToc ? renderToc(sections) : '') +
        '<div class="vr-sections">' + sections.map(renderSectionHtml).join('') + '</div>' +
        '<div class="vr-footer">Every value above is read directly from a published file listed in section 20. ' +
        'Nothing is estimated, interpolated, or carried over from another location. Where a subject has no real source ' +
        'in this project, its section says "Data not available" — that is the intended output, not a missing feature.</div>';
      instantiateCharts(sections);
      // Rebuild the selector too, so the GP dropdown picks up the village
      // file that may have only just finished loading in this same pass.
      var sel = document.querySelector('.vr-selector');
      if (sel) {
        var tmp = document.createElement('div');
        tmp.innerHTML = renderSelector(ctx);
        sel.parentNode.replaceChild(tmp.firstChild, sel);
        wireSelector();
      }
    });
  }

  // =====================================================================
  // CSS -- injected from here so index.html needs only a <script> tag
  // (another agent has that file open; minimising the diff there).
  // =====================================================================
  var CSS = [
    '.vr-root{display:flex;flex-direction:column;gap:.6rem;padding:.6rem .75rem 1rem;}',
    '.vr-selector{background:#F7F9FB;border:1px solid var(--border);border-radius:var(--radius-8);padding:.6rem .7rem;}',
    '.vr-fields{display:flex;flex-wrap:wrap;gap:.5rem;}',
    '.vr-field{display:flex;flex-direction:column;gap:2px;min-width:150px;flex:1 1 150px;}',
    '.vr-field label{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-dim);}',
    '.vr-field select{font-size:var(--fs-1);padding:.35rem .4rem;border:1px solid var(--border);border-radius:var(--radius-4);background:#fff;color:var(--text);max-width:100%;}',
    '.vr-field select:disabled{opacity:.55;cursor:not-allowed;}',
    '.vr-actions{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.55rem;}',
    '.vr-btn{font-size:var(--fs-1);font-weight:600;padding:.4rem .8rem;border-radius:var(--radius-6);border:1px solid var(--border);background:#fff;color:var(--text-dim);cursor:pointer;transition:all .2s;}',
    '.vr-btn:hover{border-color:var(--cyan);color:var(--cyan);}',
    '.vr-btn-primary{background:var(--cyan);border-color:var(--cyan);color:#fff;}',
    '.vr-btn-primary:hover{background:#157486;color:#fff;}',
    '.vr-gp-note{margin-top:.5rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);background:rgba(26,138,158,.06);border-radius:var(--radius-4);padding:.4rem .55rem;}',
    '.vr-gp-note code{font-size:.92em;background:rgba(0,0,0,.05);padding:0 3px;border-radius:3px;}',
    '.vr-maprow{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;font-size:var(--fs-1);}',
    '.vr-maprow-label{font-weight:700;color:var(--text-dim);margin-right:.25rem;}',
    '.vr-chip{font-size:var(--fs-1);padding:.25rem .6rem;border-radius:999px;border:1px solid var(--border);background:#fff;color:var(--text-dim);cursor:pointer;}',
    '.vr-chip:hover{border-color:var(--cyan);color:var(--cyan);}',
    '.vr-chip.active{background:var(--cyan);border-color:var(--cyan);color:#fff;}',
    '.vr-maprow-na{font-size:10px;color:var(--text-dim);opacity:.8;font-style:italic;margin-left:.35rem;cursor:help;}',
    '.vr-loading{padding:1.5rem;text-align:center;color:var(--text-dim);font-size:var(--fs-2);}',
    '.vr-report-head{border:1px solid var(--border);border-top:3px solid var(--cyan);border-radius:var(--radius-8);padding:.8rem .9rem;background:#fff;}',
    '.vr-title{font-size:var(--fs-1);font-weight:800;letter-spacing:.12em;color:var(--cyan);}',
    '.vr-subtitle{font-size:var(--fs-4);font-weight:800;color:var(--text);line-height:1.25;margin-top:2px;}',
    '.vr-path{font-size:var(--fs-2);color:var(--text);margin-top:.35rem;font-weight:600;}',
    '.vr-generated{font-size:10px;color:var(--text-dim);margin-top:.25rem;}',
    '.vr-toc{position:sticky;top:0;z-index:5;background:#F7F9FB;border:1px solid var(--border);border-radius:var(--radius-8);padding:.55rem .7rem;margin-top:.6rem;max-height:220px;overflow:auto;}',
    '.vr-toc-title{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim);margin-bottom:.3rem;}',
    '.vr-toc-item{display:flex;align-items:center;gap:.4rem;font-size:var(--fs-1);color:var(--text);text-decoration:none;padding:.15rem .2rem;border-radius:3px;}',
    '.vr-toc-item:hover{background:rgba(26,138,158,.08);color:var(--cyan);}',
    '.vr-toc-n{display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:4px;background:var(--border);font-size:9px;font-weight:700;color:var(--text-dim);flex-shrink:0;}',
    '.vr-toc-na{opacity:.55;}',
    '.vr-toc-tag{font-size:9px;font-weight:700;color:var(--orange);}',
    '.vr-sections{display:flex;flex-direction:column;gap:.6rem;margin-top:.6rem;}',
    '.vr-section{border:1px solid var(--border);border-radius:var(--radius-8);background:#fff;overflow:hidden;}',
    '.vr-sec-head{display:flex;align-items:center;gap:.5rem;padding:.5rem .7rem;background:rgba(26,138,158,.04);border-bottom:1px solid var(--border);flex-wrap:wrap;}',
    '.vr-sec-n{display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:5px;background:var(--cyan);color:#fff;font-size:11px;font-weight:800;flex-shrink:0;}',
    '.vr-sec-head i{color:var(--cyan);font-size:.8rem;}',
    '.vr-sec-head h3{font-size:var(--fs-2);font-weight:800;color:var(--text);margin:0;letter-spacing:.01em;}',
    '.vr-badge{font-size:9px;font-weight:700;padding:.15rem .45rem;border-radius:999px;margin-left:auto;white-space:nowrap;}',
    '.vr-badge-exact{background:rgba(45,143,92,.12);color:#2d8f5c;}',
    '.vr-badge-coarse{background:rgba(212,121,58,.14);color:#a85c22;}',
    '.vr-badge-na{background:rgba(90,106,122,.12);color:var(--text-dim);}',
    '.vr-sec-body{padding:.6rem .7rem;}',
    '.vr-kpis{display:flex;flex-wrap:wrap;gap:.45rem;margin-bottom:.55rem;}',
    '.vr-kpi{flex:1 1 130px;min-width:120px;border:1px solid var(--border);border-radius:var(--radius-6);padding:.4rem .55rem;background:#FBFCFD;}',
    '.vr-kpi-label{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim);}',
    '.vr-kpi-value{font-size:var(--fs-3);font-weight:800;margin-top:2px;line-height:1.2;word-break:break-word;}',
    '.vr-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius-4);margin-bottom:.25rem;}',
    '.vr-table{border-collapse:collapse;width:100%;font-size:var(--fs-1);min-width:340px;}',
    '.vr-table th{background:#EEF3F6;font-weight:800;font-size:10px;letter-spacing:.03em;text-transform:uppercase;color:var(--text-dim);padding:.4rem .55rem;border-bottom:2px solid var(--border);white-space:nowrap;}',
    '.vr-table td{padding:.35rem .55rem;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top;}',
    '.vr-table tbody tr:nth-child(even){background:#FAFCFD;}',
    '.vr-table tbody tr:hover{background:rgba(26,138,158,.05);}',
    '.vr-table tbody tr:last-child td{border-bottom:none;}',
    '.vr-l{text-align:left;}',
    '.vr-r{text-align:right;}',
    '.vr-num{font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.vr-caption{font-size:10px;color:var(--text-dim);line-height:1.55;margin:.15rem 0 .5rem;}',
    '.vr-chart{position:relative;height:230px;margin:.35rem 0 .2rem;}',
    '.vr-note{font-size:var(--fs-1);line-height:1.65;color:var(--text-dim);background:rgba(90,106,122,.06);border-left:3px solid var(--border);border-radius:0 var(--radius-4) var(--radius-4) 0;padding:.4rem .55rem;margin:.35rem 0;}',
    '.vr-na{display:flex;gap:.6rem;align-items:flex-start;font-size:var(--fs-1);line-height:1.7;color:var(--text-dim);background:#F7F9FB;border:1px dashed var(--border);border-radius:var(--radius-6);padding:.65rem .75rem;}',
    '.vr-na i{color:var(--orange);margin-top:2px;}',
    '.vr-source{font-size:10px;color:var(--text-dim);padding:.35rem .7rem .5rem;border-top:1px solid var(--border);background:#FCFDFE;line-height:1.55;}',
    '.vr-footer{font-size:10px;color:var(--text-dim);line-height:1.7;margin-top:.7rem;padding-top:.5rem;border-top:1px solid var(--border);}',
    '@media (max-width:760px){.vr-field{flex:1 1 100%;}.vr-chart{height:200px;}.vr-actions .vr-btn{flex:1 1 45%;}}',
    // Print: only the report itself, on A4, with table headers repeating.
    '@media print{body *{visibility:hidden!important;}',
    '#pane-village,#pane-village *{visibility:visible!important;}',
    '#pane-village{position:absolute!important;left:0;top:0;width:100%;}',
    '.vr-selector,.vr-maprow,.vr-toc{display:none!important;}',
    '.vr-section{break-inside:avoid;page-break-inside:avoid;border:1px solid #999;}',
    '.vr-table thead{display:table-header-group;}',
    '.vr-table tfoot{display:table-footer-group;}',
    '.vr-table tr{break-inside:avoid;page-break-inside:avoid;}',
    '.vr-chart{height:210px;}',
    '@page{size:A4;margin:14mm 12mm;}}'
  ].join('\n');

  function injectCss() {
    if (el('vr-style')) return;
    var s = document.createElement('style');
    s.id = 'vr-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // =====================================================================
  // ACTIVATION: MutationObserver on the pane's own class (set by
  // setBtmTab/switchTab), plus a light poll while it is visible to catch
  // selections made on the MAP rather than in a dropdown.
  // =====================================================================
  function isActive() {
    var p = el('pane-village');
    return !!(p && p.classList.contains('active'));
  }

  function startWatch() {
    var pane = el('pane-village');
    if (!pane) return;
    // Two jobs, one observer:
    //  1) attributes -> the pane just became .active (setBtmTab/switchTab).
    //  2) childList  -> something ELSE replaced this pane's content.
    //     national_selector.js's renderVillageProfile()/
    //     resetVillageProfilePane() still write their older, simpler village
    //     card straight into #pane-village on every village selection, and
    //     they do it asynchronously (after the profile fetch resolves), so
    //     they can land after this module has already painted. Rather than
    //     edit that file -- another agent has uncommitted work in it -- this
    //     module simply reclaims the pane whenever its own .vr-root is gone.
    //     No loop is possible: every render() writes .vr-root back
    //     synchronously, so the guard below is false for our own writes.
    var obs = new MutationObserver(function () {
      if (!isActive()) return;
      if (!pane.querySelector('.vr-root')) refresh(_rendered);
    });
    obs.observe(pane, { attributes: true, attributeFilter: ['class'], childList: true });

    setInterval(function () {
      if (!isActive()) return;
      var sig = ctxSignature(readContext());
      var osig = optsSignature();
      if (sig !== _lastSig) {
        // A real selection change (dropdown OR map click) -- resync the
        // selector and re-run the report if one is already showing.
        _lastSig = sig;
        _lastOptsSig = osig;
        refresh(true);
        return;
      }
      if (osig !== _lastOptsSig) {
        // Same location, but a dropdown just finished loading its options.
        _lastOptsSig = osig;
        rebuildSelectorOnly();
      }
    }, 700);
  }

  // =====================================================================
  // PUBLIC API
  // =====================================================================
  window.VindhyaVillageReport = {
    reload: function () { refresh(false); },
    view: function () { _showToc = false; _rendered = true; doRender(); },
    browse: function () { _showToc = true; _rendered = true; doRender(); },
    print: function () {
      if (!_sections) { this.view(); setTimeout(function () { window.print(); }, 1200); return; }
      window.print();
    },
    pdf: function () { exportPdf(); },
    excel: function () { exportExcel(); },
    _jump: function (n) {
      var t2 = el('vr-sec-' + n);
      if (t2) t2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    _basemap: function (name) {
      if (typeof window.applyBasemap === 'function') window.applyBasemap(name);
      var row = document.querySelector('.vr-maprow');
      if (row) row.outerHTML = renderMapControls();
    },
    _sections: function () { return _sections; },
    _ctx: function () { return _ctx; }
  };

  // PDF/Excel live in village_report_export.js, and are handed the exact
  // same section model that was just rendered on screen -- so an export can
  // never contain a number the live report does not show.
  function exportVia(kind) {
    var E = window.VindhyaVillageReportExport;
    if (!E || !E[kind]) {
      alert('The export module (village_report_export.js) is not loaded, so ' +
        (kind === 'pdf' ? 'PDF' : 'Excel') + ' export is unavailable. "Print Report" needs no library and still works.');
      return;
    }
    if (!_sections) {
      alert('Generate the report first: choose a location and press "View Report".');
      return;
    }
    E[kind](_sections, _ctx);
  }
  function exportPdf() { exportVia('pdf'); }
  function exportExcel() { exportVia('excel'); }

  function boot() {
    injectCss();
    startWatch();
    if (isActive()) refresh(false);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 400);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
})();
