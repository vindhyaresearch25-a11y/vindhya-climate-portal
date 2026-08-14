(function(){
  'use strict';
  var NDVI_URL = 'data/dicra_ndvi.json';
  var FORECAST_URL = 'data/forecast_2040.json';
  var state = { ndvi: null, forecast: null, currentDistrict: null };

  // 30s timeout on every fetch (STANDING ORDERS #5) -- a slow/hung request
  // degrades to the existing .catch() fallback instead of hanging the page.
  function fetchWithTimeout(url, opts){
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function(){ if (timer) clearTimeout(timer); });
  }

  function fmt(n, d){
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(d == null ? 1 : d);
  }

  function setNdviEmpty(show){
    var el = document.getElementById('empty-chartNdvi');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function renderNdviChart(districtKey){
    if (!state.ndvi || !state.ndvi.districts) return;
    var series = state.ndvi.districts[districtKey];
    // AUDIT_FIX_PROMPT.md item 9 (2026-08-14): this used to just return
    // here, leaving #chartNdvi a blank canvas with no message for any
    // district outside DiCRA's 52 -- national_ndvi_loader.js may still
    // fill the separate #national-ndvi-panel below with real GEE/MODIS
    // NDVI for those, but this canvas itself needs its own honest state.
    if (!series) { setNdviEmpty(true); return; }
    if (typeof Chart === 'undefined') return;
    setNdviEmpty(false);

    var dates = series.dates;
    var means = series.ndvi_mean;
    // Sample every Nth point for performance (278 points is fine)
    var labels = dates.map(function(d){ return d.slice(5); }); // MM-DD
    var years = dates.map(function(d){ return parseInt(d.slice(0,4)); });

    try { killChart('chartNdvi'); } catch(e) { console.warn('[dicra_ndvi] killChart:', e); }
    var nc = document.getElementById('chartNdvi');
    if (!nc) return;

    // Color points by year gradient
    var colors = years.map(function(y){
      return y >= 2024 ? '#5cc3cd' : y >= 2020 ? '#74a9cf' : y >= 2016 ? '#a8dadc' : '#bdc9e1';
    });

    // Show as connected line with points
    // Subsample labels for x-axis (show every ~6 months)
    var tickIndices = [];
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      if (d && d.endsWith('-01-01') || d && d.endsWith('-07-01') || tickIndices.length === 0) {
        tickIndices.push(i);
      }
    }
    // Add last point
    if (tickIndices.indexOf(dates.length-1) < 0) tickIndices.push(dates.length-1);

    try { new Chart(nc, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'NDVI '+districtKey.toUpperCase(),
          data: means,
          backgroundColor: 'rgba(111,199,149,0.15)',
          borderColor: '#6fc795',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true
        }, {
          label: 'Trend',
          data: means,
          type: 'line',
          borderColor: '#f0a878',
          borderWidth: 2,
          borderDash: [5,5],
          pointRadius: 0,
          tension: 0.5,
          fill: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position:'top', labels:{boxWidth:10,font:{size:8}} },
          tooltip: {
            callbacks: {
              title: function(items){ return dates[items[0].dataIndex] || ''; },
              label: function(item){ return 'NDVI: '+item.parsed.y.toFixed(4); }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              callback: function(val, idx){
                var d = dates[val];
                if (d) return d.slice(0,7);
                return '';
              },
              font: {size:6},
              maxTicksLimit: 15
            },
            grid: {display:false}
          },
          y: {
            min: 0, max: 0.9,
            grid: {color:'rgba(138,211,170,0.1)'},
            ticks: {font:{size:8}}
          }
        }
      }
    });
    } catch(e) { console.warn('[dicra_ndvi] new Chart:', e); }
  }

  function killChart(canvasId){
    var c = document.getElementById(canvasId); if (!c) return;
    var existing = Chart.getChart ? (Chart.getChart(canvasId) || Chart.getChart(c)) : null;
    if (existing) { try { existing.destroy(); } catch(e) {} }
  }

  function init(){
    Promise.all([
      fetchWithTimeout(NDVI_URL).then(function(r){ if (!r.ok) throw new Error('NDVI HTTP '+r.status); return r.json(); }),
      fetchWithTimeout(FORECAST_URL).then(function(r){ if (!r.ok) throw new Error('Forecast HTTP '+r.status); return r.json(); })
    ]).then(function(results){
      state.ndvi = results[0];
      state.forecast = results[1];
      window._dicraNdvi = state.ndvi;
      window._forecast2040 = state.forecast;
      console.log('[dicra_ndvi] loaded NDVI:', Object.keys(state.ndvi.districts).length, 'districts, forecast:', Object.keys(state.forecast.districts).length, 'districts');

      // Render the NDVI chart once the user actually picks a real district
      // with live climate data -- never falls back to "the first district"
      // after a timeout, which would render NDVI for an arbitrary district
      // nobody selected (a "no default anywhere" violation just like
      // mp_climate_loader.js's old auto-refreshAll(first) did).
      var iv = setInterval(function(){
        var dk = document.getElementById('districtSelect');
        // state.ndvi.districts is keyed lowercase ("bhopal"); dk.value is
        // the dropdown's plain display name ("Bhopal") now, same as every
        // other district nationally -- normalize before the lookup.
        var rk = dk && dk.value ? dk.value.trim().toLowerCase() : null;
        if (rk && window._mpClimateRefresh) {
          clearInterval(iv);
          try { renderNdviChart(rk); } catch(e) { console.warn('[dicra_ndvi] init render:', e); }
        }
      }, 250);

      // Also watch for district changes
      var origChange = window.onDistrictChange;
      if (origChange) {
        window._origNdviDistrictChange = origChange;
      }

      // Patch onDistrictChange to also update NDVI chart
      if (typeof hookDistrictChange === 'function') {
        // Already hooked by mp_climate_loader
      }

      // Expose render function for external calls
      window._renderNdviChart = renderNdviChart;

      console.log('[dicra_ndvi] ready');
    }).catch(function(err){
      console.error('[dicra_ndvi] failed:', err);
      // Phase 2.8: this used to fail silently (console only) -- the NDVI
      // pane just stayed an empty canvas forever with no explanation.
      var box = document.getElementById('ndvi-error-state');
      if (box) {
        box.classList.remove('u-hidden');
        box.innerHTML = '<b style="color:#c0392b">NDVI data failed to load</b><br>' +
          err.message + '<br><button id="ndvi-retry-btn" style="margin-top:8px;background:#c0392b;color:#fff;' +
          'border:none;border-radius:4px;padding:4px 14px;font-size:11px;font-weight:700;cursor:pointer;">Retry</button>';
        var btn = document.getElementById('ndvi-retry-btn');
        if (btn) btn.onclick = function () { box.classList.add('u-hidden'); init(); };
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
