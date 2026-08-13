/*
 * validation_loader.js -- Phase 8.6, extended 2026-08-12 (PENDING.md item
 * 7). Renders dashboard/data/validation/<state_slug>/<district_slug>.json
 * (real Pearson correlation / mean bias / RMSE of CHIRPS+ERA5-Land against
 * the existing IMD numbers, scripts/11_build_validation.py) into the
 * "Validation" bottom tab (#pane-validation, added alongside this file).
 * Only exists for the 5 original IMD districts (Bhopal, Indore, Jabalpur,
 * Rewa, Sidhi) -- CHIRPS/ERA5-Land here CHECK IMD, they never substitute
 * for it. Three comparisons rendered where present: rainfall (CHIRPS),
 * temperature (ERA5-Land Mar-Jun mean Tmax -- the literal "temperature"
 * comparison the spec asked for, added 2026-08-12), and heatwave days
 * (bonus/derived, kept from the original version). Rainfall and
 * temperature blocks also draw a line chart of both series' real
 * per-year values (file.*_validation.stats.imd_values/other_values) when
 * present -- the temperature block and both charts degrade to "not shown"
 * rather than an error on an older validation JSON file that predates
 * this extension (no temperature_validation key, or a stats object
 * without imd_values/other_values yet).
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

  function statBlock(stats, unitLabel, emptyMsg, precision) {
    return stats
      ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;margin-top:0.5rem;">'
        + statCard('PEARSON r', fmt(stats.pearson_r, 3), stats.pearson_r >= 0.6 ? 'var(--green,#6fc795)' : stats.pearson_r >= 0.3 ? 'var(--orange)' : 'var(--red)')
        + statCard('MEAN BIAS (' + unitLabel + ')', (stats.mean_bias >= 0 ? '+' : '') + fmt(stats.mean_bias, precision), 'var(--blue)')
        + statCard('RMSE (' + unitLabel + ')', fmt(stats.rmse, precision), 'var(--orange)')
        + statCard('YEARS (n)', stats.n_years, 'var(--cyan)')
        + '</div>'
      : '<div style="color:var(--text-dim);font-size:var(--fs-1);margin-top:0.5rem;">Insufficient overlapping years '
        + '<i class="fa fa-circle-info" title="' + String(emptyMsg).replace(/"/g, '&quot;') + '" '
        + 'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i></div>';
  }

  // Chart.js instances keyed by canvas id, so re-selecting a district
  // destroys the previous chart before drawing a new one (same pattern
  // mp_climate_loader.js's own killChart() uses -- this file keeps its
  // own copy rather than depending on that file's IIFE-local function).
  function killChart(canvasId) {
    var c = document.getElementById(canvasId);
    if (!c || typeof Chart === 'undefined') return;
    var existing = Chart.getChart ? (Chart.getChart(canvasId) || Chart.getChart(c)) : null;
    if (existing) { try { existing.destroy(); } catch (e) {} }
  }

  function drawSeriesChart(canvasId, stats, imdLabel, otherLabel, imdColor, otherColor) {
    killChart(canvasId);
    if (typeof Chart === 'undefined' || !stats || !stats.years_compared) return;
    var c = document.getElementById(canvasId);
    if (!c) return;
    new Chart(c, {
      type: 'line',
      data: {
        labels: stats.years_compared,
        datasets: [
          { label: imdLabel, data: stats.imd_values, borderColor: imdColor, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 2 },
          { label: otherLabel, data: stats.other_values, borderColor: otherColor, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, borderDash: [4, 3], pointRadius: 2 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } },
    });
  }

  function renderFile(file, districtName) {
    var host = document.getElementById('validation-panel-body');
    if (!host) return;
    var meta = file.metadata || {};
    var rv = file.rainfall_validation || {};
    var tv = file.temperature_validation || {}; // added 2026-08-12, PENDING.md item 7 -- absent in files not yet regenerated by 11_build_validation.py's extended version
    var hv = file.heatwave_validation || {};
    var rs = rv.stats, ts = tv.stats, hs = hv.stats;

    var rainBlock = statBlock(rs, 'mm/yr', 'Insufficient overlapping years to compute rainfall correlation.', 1);
    var tempBlock = tv.field
      ? statBlock(ts, '°C', 'Insufficient overlapping years to compute temperature correlation.', 2)
      : ''; // whole section omitted, not just empty, if this file predates the temperature_validation addition
    var hwBlock = statBlock(hs, 'days/yr', 'Insufficient overlapping years to compute heatwave-day correlation.', 2);

    host.innerHTML = ''
      + '<div class="section-header"><div class="section-title">RAINFALL — CHIRPS vs IMD (' + (districtName || '') + ')</div></div>'
      + rainBlock
      + (rs && rs.years_compared ? '<div style="height:140px;margin-top:0.4rem;"><canvas id="validation-chart-rain"></canvas></div>' : '')
      + (tv.field ? '<div class="section-header" style="margin-top:0.75rem;"><div class="section-title">TEMPERATURE (Mar–Jun mean Tmax) — ERA5-Land vs IMD</div></div>' + tempBlock
          + (ts && ts.years_compared ? '<div style="height:140px;margin-top:0.4rem;"><canvas id="validation-chart-temp"></canvas></div>' : '') : '')
      + '<div class="section-header" style="margin-top:0.75rem;"><div class="section-title">HEATWAVE DAYS — ERA5-Land vs IMD</div></div>'
      + hwBlock
      + '<div style="margin-top:0.75rem;padding:0.6rem 0.7rem;background:rgba(92,195,205,0.08);border:1px solid rgba(92,195,205,0.3);border-radius:6px;font-size:0.72rem;line-height:1.6;color:var(--text);">'
      + '<b>Verdict:</b> ' + (file.verdict || '') + '</div>'
      + '<div style="font-size:var(--fs-1);font-weight:600;color:var(--text-dim);padding:0.6rem 0 0;">'
      + 'Source · ' + (meta.source || '') + ' · ' + (meta.last_updated || '') + '</div>';

    if (rs && rs.years_compared) drawSeriesChart('validation-chart-rain', rs, 'IMD (mm)', 'CHIRPS (mm)', '#5cc3cd', '#f0a878');
    if (ts && ts.years_compared) drawSeriesChart('validation-chart-temp', ts, 'IMD (°C)', 'ERA5-Land (°C)', '#5cc3cd', '#f0a878');
  }

  function showEmpty(msg) {
    var host = document.getElementById('validation-panel-body');
    if (host) host.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:var(--fs-1);padding:1rem;"><i class="fa fa-check-double"></i> ' + msg + '</div>';
  }

  function handleDistrictChange(districtName) {
    if (!districtName) return;
    var dslug = slugify(districtName);
    if (VALID_SLUGS.indexOf(dslug) < 0) {
      showEmpty('Only Bhopal/Indore/Jabalpur/Rewa/Sidhi '
        + '<i class="fa fa-circle-info" title="Validation data available only for the 5 districts with a real IMD time series." '
        + 'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i>');
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
