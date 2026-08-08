/*
 * validation_loader.js -- Phase 8.6. Renders
 * dashboard/data/validation/<state_slug>/<district_slug>.json (real
 * Pearson correlation / mean bias / RMSE of CHIRPS+ERA5-Land against the
 * existing IMD annual_trends numbers, scripts/11_build_validation.py) into
 * the "Validation" bottom tab (#pane-validation, added alongside this
 * file). Only exists for the 5 original IMD districts (Bhopal, Indore,
 * Jabalpur, Rewa, Sidhi) -- CHIRPS/ERA5-Land here CHECK IMD, they never
 * substitute for it.
 */
(function () {
  'use strict';

  var cache = {};
  var VALID_SLUGS = ['bhopal', 'indore', 'jabalpur', 'rewa', 'sidhi'];

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

  function slugify(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function fmt(v, d) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d);
  }

  function statCard(label, value, color) {
    return '<div class="metric-card"><div class="metric-label">' + label + '</div>'
      + '<div class="metric-value" style="color:' + (color || 'var(--text)') + '">' + value + '</div></div>';
  }

  function renderFile(file, districtName) {
    var host = document.getElementById('validation-panel-body');
    if (!host) return;
    var meta = file.metadata || {};
    var rv = file.rainfall_validation || {};
    var hv = file.heatwave_validation || {};
    var rs = rv.stats, hs = hv.stats;

    var rainBlock = rs
      ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;">'
        + statCard('PEARSON r', fmt(rs.pearson_r, 3), rs.pearson_r >= 0.6 ? 'var(--green,#6fc795)' : rs.pearson_r >= 0.3 ? 'var(--orange)' : 'var(--red)')
        + statCard('MEAN BIAS (mm/yr)', (rs.mean_bias >= 0 ? '+' : '') + fmt(rs.mean_bias, 1), 'var(--blue)')
        + statCard('RMSE (mm)', fmt(rs.rmse, 1), 'var(--orange)')
        + statCard('YEARS (n)', rs.n_years, 'var(--cyan)')
        + '</div>'
      : '<div style="color:var(--text-dim);font-size:0.75rem;">Insufficient overlapping years to compute rainfall correlation.</div>';

    var hwBlock = hs
      ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-top:0.5rem;">'
        + statCard('PEARSON r', fmt(hs.pearson_r, 3), hs.pearson_r >= 0.6 ? 'var(--green,#6fc795)' : hs.pearson_r >= 0.3 ? 'var(--orange)' : 'var(--red)')
        + statCard('MEAN BIAS (days/yr)', (hs.mean_bias >= 0 ? '+' : '') + fmt(hs.mean_bias, 2), 'var(--blue)')
        + statCard('RMSE (days)', fmt(hs.rmse, 2), 'var(--orange)')
        + statCard('YEARS (n)', hs.n_years, 'var(--cyan)')
        + '</div>'
      : '<div style="color:var(--text-dim);font-size:0.75rem;margin-top:0.5rem;">Insufficient overlapping years to compute heatwave-day correlation.</div>';

    host.innerHTML = ''
      + '<div class="section-header"><div class="section-title">RAINFALL — CHIRPS vs IMD (' + (districtName || '') + ')</div></div>'
      + rainBlock
      + '<div class="section-header" style="margin-top:0.75rem;"><div class="section-title">HEATWAVE DAYS — ERA5-Land vs IMD</div></div>'
      + hwBlock
      + '<div style="margin-top:0.75rem;padding:0.6rem 0.7rem;background:rgba(92,195,205,0.08);border:1px solid rgba(92,195,205,0.3);border-radius:6px;font-size:0.72rem;line-height:1.6;color:var(--text);">'
      + '<b>Verdict:</b> ' + (file.verdict || '') + '</div>'
      + '<div style="font-size:0.62rem;font-weight:600;color:var(--text-dim);padding:0.6rem 0 0;">'
      + 'Source: ' + (meta.source || '') + ' Last updated: ' + (meta.last_updated || '') + '</div>';
  }

  function showEmpty(msg) {
    var host = document.getElementById('validation-panel-body');
    if (host) host.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:var(--fs-1);padding:1rem;"><i class="fa fa-check-double"></i> ' + msg + '</div>';
  }

  function handleDistrictChange(districtName) {
    if (!districtName) return;
    var dslug = slugify(districtName);
    if (VALID_SLUGS.indexOf(dslug) < 0) {
      showEmpty('Validation data available only for Bhopal, Indore, Jabalpur, Rewa and Sidhi (the 5 districts with a real IMD time series).');
      return;
    }
    if (cache[dslug]) { renderFile(cache[dslug], districtName); return; }
    fetchWithTimeout('data/validation/madhya_pradesh/' + dslug + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) {
        if (!file) { showEmpty('Validation file not found for ' + districtName + '.'); return; }
        cache[dslug] = file;
        renderFile(file, districtName);
      })
      .catch(function () { showEmpty('Validation data failed to load for ' + districtName + '.'); });
  }

  function boot() {
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      if (typeof originalOnDistrictChange === 'function') originalOnDistrictChange(distKey);
      handleDistrictChange(distKey);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }
})();
