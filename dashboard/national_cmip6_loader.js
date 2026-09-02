/*
 * national_cmip6_loader.js -- real CMIP6 NEX-GDDP 2040 physical-model
 * projection, national coverage, from
 * dashboard/data/cmip6_2040/<state_slug>/<district_slug>.json
 * (scripts/09_gee_national_cmip6_2040.py, all 733 districts, real Earth
 * Engine reduceRegions over each district's actual Survey-of-India
 * polygon -- see that script's header and the JSON's own metadata block
 * for scenario/ensemble/window details).
 *
 * Scope, revised 2026-09-02 (methodology audit): this loader is now
 * authoritative for ALL 733 districts, INCLUDING the 5 original MP ones
 * (Bhopal/Indore/Jabalpur/Rewa/Sidhi). It previously skipped those 5 and
 * let mp_climate_loader.js's renderFuturePanel() draw them from
 * mp_climate_data.json's `future_2040` field
 * (scripts/05b_run_cmip6_2040.py, a 5km-buffer-around-a-single-centroid
 * method, this project's first real CMIP6 result, written before the
 * national version existed).
 *
 * Why the switch: both pipelines run the identical 8-model NEX-GDDP-CMIP6
 * ensemble, the same SSP2-4.5 scenario and the same 2036-2045 vs 2000-2014
 * windows -- the ONLY difference is the spatial unit. 05b reduces over a
 * 5 km buffer around one centroid point; 09 reduces over the district's
 * real Survey of India polygon, which is the same unit every other
 * district-level layer in this portal uses. Compared directly for those 5
 * districts (2026-09-02) the two agree closely -- hot days within 0.5-3.6
 * d/yr, peak Tmax within 0.3 degC, annual rain within 6% -- so this is a
 * refinement, not a contradiction, and neither was "wrong". The polygon
 * version simply measures the district rather than a disc near its middle,
 * so it wins, and having ONE method for all 733 districts removes the risk
 * of two differently-derived numbers appearing under one label. The 05b
 * output is retained in mp_climate_data.json, flagged `superseded_by`, for
 * provenance -- see docs/METHODOLOGY.md Sec 5.2 and docs/DATA_SOURCES.md.
 *
 * Pattern copied from groundwater_loader.js (manifest existence check,
 * 30s fetch timeout, honest "Not available" fallback) rather than
 * invented fresh.
 */
(function () {
  'use strict';

  var cache = {};

  function fetchWithTimeout(url) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var opts = controller ? { signal: controller.signal } : {};
    return fetch(url, opts).finally(function () { if (timer) clearTimeout(timer); });
  }

  function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(d === undefined ? 1 : d);
  }

  function delta(v, unit, invert) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    var arrow = v > 0.5 ? '▲' : v < -0.5 ? '▼' : '◆';
    var color = invert ? (v > 0 ? 'var(--green)' : 'var(--red)')
                       : (v > 0 ? 'var(--red)' : 'var(--green)');
    return '<span style="color:' + color + '">' + arrow + ' ' + fmt(Math.abs(v), 1) + unit + '</span>';
  }

  // Field-name compatibility. Files written before the 2026-09-02 audit
  // call the Tmax>=40 day count `heatwave_days_per_yr`; files written after
  // it call the same quantity `hot_days_tmax_ge40_per_yr` (the rename was
  // the point -- the old name claimed the IMD heatwave-event definition,
  // which this number has never been). The VALUE is identical under either
  // key, so reading both is safe and the label above is correct either way.
  function hotDays(f) {
    return (f.hot_days_tmax_ge40_per_yr !== undefined && f.hot_days_tmax_ge40_per_yr !== null)
      ? f.hot_days_tmax_ge40_per_yr : f.heatwave_days_per_yr;
  }
  function hotDaysDelta(f) {
    return (f.delta_hot_days_tmax_ge40_per_yr !== undefined && f.delta_hot_days_tmax_ge40_per_yr !== null)
      ? f.delta_hot_days_tmax_ge40_per_yr : f.delta_heatwave_days_per_yr;
  }

  // PEAK TMAX and Rx1day are max-type indices. Files written after the
  // 2026-09-02 audit carry metadata.max_index_definition and use the mean
  // of the PER-YEAR maxima (window-length invariant, the ETCCDI TXx/Rx1day
  // convention). Older files used a single maximum over the whole window,
  // which grows with window length -- so their 10-year-future vs
  // 15-year-baseline delta carries a systematic negative artefact. Rather
  // than silently show a delta we know is biased, say so on screen until
  // that district's file has been recomputed.
  function methodNote(f) {
    var corrected = !!(f.metadata && f.metadata.max_index_definition);
    if (corrected) return '';
    return '<br><span style="color:var(--orange)">Peak Tmax / Rx1day for this district have not yet been recomputed with the'
      + ' window-length-invariant (per-year maxima) method &mdash; their <i>vs baseline</i> change compares a 10-year future'
      + ' window against a 15-year baseline window and is biased low. Treat those two deltas as provisional.</span>';
  }

  function loadDistrictFile(stateSlug, dslug) {
    var key = stateSlug + '/' + dslug;
    if (cache[key] !== undefined) return Promise.resolve(cache[key]);
    return fetchWithTimeout('data/cmip6_2040/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) { cache[key] = file; return file; })
      .catch(function () { cache[key] = null; return null; });
  }

  // #future-2040-panel lives inside #mp-legacy-panel-wrap, which
  // mp_climate_loader.js creates with display:none and only ever reveals
  // (style.display='flex') for one of the 5 original IMD districts, then
  // hides again (_mpClimateClear()) once the selection moves away. This
  // loader must do the exact same reveal/hide itself for every OTHER
  // district -- writing into #future-2040-panel alone is not enough, its
  // parent wrap stays display:none otherwise and nothing becomes visible.
  // Found live 2026-09-02: the wrap and the panel both existed and this
  // loader's fetch/render logic was correct, but the wrap's display was
  // never toggled here, so real data was written into an invisible box.
  function setWrapVisible(visible) {
    var wrap = document.getElementById('mp-legacy-panel-wrap');
    if (wrap) wrap.style.display = visible ? 'flex' : 'none';
  }

  function renderEmpty(host, label) {
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-clock-rotate-left" style="color:var(--orange);font-size:0.7rem"></i>'
      + '<div class="section-title">2040 PROJECTION (SSP2-4.5, 8-MODEL CMIP6 ENSEMBLE)</div></div>'
      + '<div style="padding:0.6rem;font-size:0.7rem;font-weight:600;color:var(--text-dim)">'
      + 'CMIP6 future projection not available for ' + (label || 'this selection')
      + '. See scripts/09_gee_national_cmip6_2040.py.</div>';
    setWrapVisible(true); // show the honest "not available" message too, not just silence
  }

  function render(file, districtName) {
    var host = document.getElementById('future-2040-panel');
    if (!host) return;
    if (!file) { renderEmpty(host, districtName); return; }
    setWrapVisible(true);
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-clock-rotate-left" style="color:var(--orange);font-size:0.7rem"></i>'
      + '<div class="section-title">2040 PROJECTION (SSP2-4.5, 8-MODEL CMIP6 ENSEMBLE)</div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card" title="Mean number of March-June days per year with daily Tmax >= 40 degC, in the CMIP6 ensemble. This is a HOT-DAY COUNT. It is NOT the IMD heatwave-event index shown in the observed panels (which also requires a >= 4.5 degC departure from the day-of-year normal and a run of >= 2 consecutive days) -- the two are an order of magnitude apart and are not comparable.">'
      + '    <div class="metric-label">HOT DAYS/YR (TMAX &ge; 40&deg;C)</div><div class="metric-value cyan">' + fmt(hotDays(file), 1) + '</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(hotDaysDelta(file), ' d') + '</div></div>'
      + '  <div class="metric-card" title="Mean of the per-year March-June maxima (ETCCDI TXx convention), averaged over the 8-model ensemble."><div class="metric-label">PEAK TMAX</div><div class="metric-value" style="color:var(--red)">' + fmt(file.max_summer_tmax, 1) + '°C</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_max_summer_tmax, '°C') + '</div></div>'
      + '  <div class="metric-card" title="Annual rainfall on days above the ensemble 95th-percentile wet-day threshold."><div class="metric-label">R95p mm/yr</div><div class="metric-value" style="color:var(--blue)">' + fmt(file.r95p_mm_per_yr, 1) + '</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_r95p_mm_per_yr, ' mm', true) + '</div></div>'
      + '  <div class="metric-card" title="Mean of the per-year maximum 1-day rainfall (ETCCDI Rx1day convention)."><div class="metric-label">Rx1day mm</div><div class="metric-value" style="color:var(--blue)">' + fmt(file.rx1day_mm, 1) + '</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_rx1day_mm, ' mm', true) + '</div></div>'
      + '</div>'
      + '<div style="padding:0 0.75rem 0.6rem;font-size:0.62rem;color:var(--text-dim)">Source · NASA NEX-GDDP-CMIP6 via Google Earth Engine · '
      + (file.metadata ? file.metadata.future_window : '2036-2045') + ' vs ' + (file.metadata ? file.metadata.baseline_window : '2000-2014')
      + ' baseline · district-level (real SoI polygon, ~25km native grid) · not valid at block/village scale'
      + '<br>Model scenario, not an observation. &ldquo;Hot days&rdquo; here = days with Tmax &ge; 40&deg;C &mdash; <b>a different index from the IMD heatwave-event count</b> shown in the observed panels; compare the <i>vs baseline</i> change, not the absolute value against observed numbers.'
      + methodNote(file)
      + '</div>';
  }

  function handleSelection(stateName, districtName) {
    var host = document.getElementById('future-2040-panel');
    if (!host || !districtName) return;
    // No district is skipped any more. The 5 original MP districts used to
    // be handed to mp_climate_loader.js's renderFuturePanel() (05b's
    // centroid-buffer version); as of the 2026-09-02 methodology audit this
    // loader's real-SoI-polygon numbers are authoritative for every
    // district, so all 733 take the same path. See the file header.
    if (!stateName) { renderEmpty(host, districtName); return; }
    var stateSlug = slugify(stateName), dslug = slugify(districtName);
    loadDistrictFile(stateSlug, dslug).then(function (file) {
      render(file, districtName);
    });
  }

  // Wrap whatever's assigned to onDistrictChange -- but NOT at script-parse
  // time. Real bug found live 2026-09-02: national_selector.js's own boot()
  // (which is what actually assigns window.onDistrictChange to a real
  // function) runs on setTimeout(boot,50), AFTER every loader <script> tag
  // has already executed synchronously. Capturing window.onDistrictChange
  // here at top level grabbed `undefined`, wrapped it, and then
  // national_selector.js's boot() overwrote window.onDistrictChange
  // completely a moment later, discarding this wrapper entirely -- this
  // loader silently never ran. groundwater_loader.js already solved this
  // exact race with its own delayed boot(); same fix here.
  function boot() {
    if (typeof window.onDistrictChange !== 'function') { setTimeout(boot, 200); return; }
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      originalOnDistrictChange(distKey);
      var sel = (typeof window.getCurrentSelection === 'function') ? window.getCurrentSelection() : null;
      var stateName = sel ? sel.state : null;
      handleSelection(stateName, distKey);
    };
  }
  setTimeout(boot, 1000);
})();
