/*
 * national_cmip6_loader.js -- real CMIP6 NEX-GDDP 2040 physical-model
 * projection, national coverage, from
 * dashboard/data/cmip6_2040/<state_slug>/<district_slug>.json
 * (scripts/09_gee_national_cmip6_2040.py, all 733 districts, real Earth
 * Engine reduceRegions over each district's actual Survey-of-India
 * polygon -- see that script's header and the JSON's own metadata block
 * for scenario/ensemble/window details).
 *
 * Scope split with mp_climate_loader.js's renderFuturePanel(): that
 * function already renders this exact same "2040 PROJECTION" panel for
 * the 5 original MP districts (Bhopal/Indore/Jabalpur/Rewa/Sidhi) from
 * mp_climate_data.json's `future_2040` field (scripts/05b_run_cmip6_2040.py,
 * a 5km-buffer-around-centroid method, run once as this project's first
 * real CMIP6 result before the national version existed). This file
 * DELIBERATELY does not touch those 5 -- MP_DISTRICTS[key] existing is the
 * exact same real-district check mp_climate_loader.js and
 * national_selector.js's mpRealDataKey() already use elsewhere in this
 * codebase, reused here rather than re-invented, so the two loaders never
 * race on the same panel for the same district.
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
      + '  <div class="metric-card"><div class="metric-label">HEATWAVE DAYS/YR</div><div class="metric-value cyan">' + fmt(file.heatwave_days_per_yr, 1) + '</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_heatwave_days_per_yr, ' d') + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">PEAK TMAX</div><div class="metric-value" style="color:var(--red)">' + fmt(file.max_summer_tmax, 1) + '°C</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_max_summer_tmax, '°C') + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">R95p mm/yr</div><div class="metric-value" style="color:var(--blue)">' + fmt(file.r95p_mm_per_yr, 1) + '</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_r95p_mm_per_yr, ' mm', true) + '</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx1day mm</div><div class="metric-value" style="color:var(--blue)">' + fmt(file.rx1day_mm, 1) + '</div><div style="font-size:0.65rem;font-weight:600">vs baseline: ' + delta(file.delta_rx1day_mm, ' mm', true) + '</div></div>'
      + '</div>'
      + '<div style="padding:0 0.75rem 0.6rem;font-size:0.62rem;color:var(--text-dim)">Source · NASA NEX-GDDP-CMIP6 via Google Earth Engine · '
      + (file.metadata ? file.metadata.future_window : '2036-2045') + ' vs ' + (file.metadata ? file.metadata.baseline_window : '2000-2014')
      + ' baseline · district-level (real SoI polygon, ~25km native grid) · not valid at block/village scale</div>';
  }

  function handleSelection(stateName, districtName) {
    var host = document.getElementById('future-2040-panel');
    if (!host || !districtName) return;
    // The 5 original MP districts keep mp_climate_loader.js's own
    // renderFuturePanel() (their own, separately-run 5km-buffer version,
    // predates this national file) -- never overwritten here.
    var lcKey = districtName.trim().toLowerCase();
    if (typeof window.MP_DISTRICTS !== 'undefined' && window.MP_DISTRICTS[lcKey]) return;

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
