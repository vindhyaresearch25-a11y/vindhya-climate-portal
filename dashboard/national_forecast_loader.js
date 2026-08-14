/* ===========================================================================
   national_forecast_loader.js
   ---------------------------------------------------------------------------
   Real 7-day forecast for the bottom panel's "7-Day Forecast" tab, for ANY
   selected district/block/village nationwide -- via Open-Meteo
   (api.open-meteo.com/v1/forecast), free/keyless real NWP-model output
   (ECMWF/GFS blend). Point comes from window.currentLocationPoint, set by
   national_selector.js's placeMarker() using turf.pointOnFeature on the
   actual selected boundary polygon (guaranteed inside it, unlike a naive
   centroid) -- the same point live_weather_loader.js already relies on.

   REPLACES mp_climate_loader.js's old renderForecast(), which built a
   "7-day forecast" using Math.random() jitter around historical means, for
   only the 5 MP_DISTRICTS with IMD data, doing nothing at all for the
   other 728 districts. That was a direct violation of this repo's own
   core rule (CLAUDE.md "No synthetic data, ever" -- a prior fabrication
   pattern this project exists specifically to have removed). Found live
   2026-08-14 while implementing AUDIT_FIX_PROMPT.md item 7b ("7-Day
   Forecast ... GRAPHICAL, sirf text nahi") -- fixing the fabrication and
   the graphical-content ask together, since the honest fix (a real API
   call) IS the graphical one.
   ======================================================================== */
(function(){
  'use strict';
  var OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
  var _chart = null;
  var _seq = 0; // guards against a slow earlier fetch overwriting a later selection

  function fetchWithTimeout(url){
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function(){ controller.abort(); }, 30000) : null;
    return fetch(url, controller ? {signal: controller.signal} : {}).finally(function(){ if (timer) clearTimeout(timer); });
  }

  function fmt(n){ return (n == null || isNaN(n)) ? '—' : Math.round(n); }

  function setLoading(placeName){
    var host = document.getElementById('forecastPanel');
    if (host) host.innerHTML = '<div class="u-empty-msg"><i class="fa fa-spinner fa-spin"></i> Loading real forecast' + (placeName ? ' for ' + esc(placeName) : '') + '…</div>';
  }

  function setEmpty(msg){
    var host = document.getElementById('forecastPanel');
    if (host) host.innerHTML = '<div class="u-empty-msg"><i class="fa fa-cloud u-icon-lg-muted"></i><b>Forecast not available</b><br>' + esc(msg) + '</div>';
  }

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  // Called by national_selector.js on every district/block/village pick.
  function load(lat, lon, placeName){
    var mySeq = ++_seq;
    var nameLabel = document.getElementById('forecastDistName');
    if (nameLabel) nameLabel.textContent = placeName || '';
    if (lat == null || lon == null) { setEmpty('No coordinates for this selection.'); return; }
    setLoading(placeName);
    var url = OPEN_METEO_BASE + '?latitude=' + lat + '&longitude=' + lon +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max' +
      '&forecast_days=7&timezone=Asia%2FKolkata';
    fetchWithTimeout(url).then(function(r){ return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function(data){ if (mySeq === _seq) render(data); })
      .catch(function(e){ console.warn('[national_forecast_loader]', e); if (mySeq === _seq) setEmpty('Network error reaching Open-Meteo — check connection and try again.'); });
  }

  function render(data){
    var daily = data && data.daily;
    var host = document.getElementById('forecastPanel');
    if (!host) return;
    if (!daily || !Array.isArray(daily.time) || !daily.time.length) { setEmpty('No forecast data returned for this location.'); return; }

    var tmax = daily.temperature_2m_max || [], tmin = daily.temperature_2m_min || [];
    var precip = daily.precipitation_sum || [], pop = daily.precipitation_probability_max || [];
    var dayLabels = daily.time.map(function(d){
      var dt = new Date(d + 'T00:00:00');
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-IN', { weekday: 'short' });
    });

    var cards = '';
    for (var i = 0; i < daily.time.length; i++){
      var isHeat = tmax[i] != null && tmax[i] >= 40;
      var isRain = (pop[i] || 0) >= 50;
      var icon = isHeat ? 'fa-sun' : isRain ? 'fa-cloud-rain' : 'fa-cloud';
      var iconColor = isHeat ? 'var(--red)' : isRain ? 'var(--cyan)' : 'var(--text-dim)';
      var dateStr = daily.time[i].slice(8, 10) + '/' + daily.time[i].slice(5, 7);
      cards += '<div class="forecast-day" style="background:' + (isHeat ? 'rgba(236,139,155,0.08)' : 'rgba(92,195,205,0.03)') + ';border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;">'
        + '<div style="font-size:0.6rem;font-weight:600;color:var(--text-dim);margin-bottom:0.2rem;">' + esc(dayLabels[i]) + '</div>'
        + '<div style="font-size:0.6rem;font-weight:600;color:var(--text-dim);margin-bottom:0.3rem;">' + esc(dateStr) + '</div>'
        + '<div style="font-size:0.9rem;margin-bottom:0.3rem;"><i class="fa ' + icon + '" style="color:' + iconColor + '"></i></div>'
        + '<div style="font-size:0.75rem;font-weight:700;color:' + (isHeat ? 'var(--red)' : 'var(--text)') + ';">' + fmt(tmax[i]) + '&deg; / ' + fmt(tmin[i]) + '&deg;C</div>'
        + '<div style="font-size:0.65rem;font-weight:600;color:var(--blue);">' + (precip[i] > 0 ? fmt(precip[i]) + 'mm' : '—') + '</div>'
        + '<div style="font-size:0.6rem;font-weight:600;margin-top:0.2rem;color:' + (pop[i] != null ? 'var(--cyan)' : 'var(--text-dim)') + ';">' + (pop[i] != null ? pop[i] + '% rain' : '—') + '</div>'
        + '</div>';
    }

    host.innerHTML =
      '<div class="u-forecast-grid">' + cards + '</div>'
      + '<div class="chart-wrap u-h140"><canvas id="chartForecastLine"></canvas></div>'
      + '<div class="metric-source" style="margin:0 var(--space-05) var(--space-05);">Source: Open-Meteo (ECMWF/GFS NWP model blend) · ~11 km · forecast issued ' + new Date().toISOString().slice(0, 10) + '. A different, forward-looking source from any historical IMD index shown elsewhere in this dashboard -- never merged into one number.</div>';

    if (typeof Chart === 'undefined') return;
    var ctx = document.getElementById('chartForecastLine');
    if (!ctx) return;
    if (_chart) { try { _chart.destroy(); } catch (e) {} }
    _chart = new Chart(ctx, {
      data: {
        labels: daily.time.map(function(d, i){ return dayLabels[i] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7); }),
        datasets: [
          { type: 'line', label: 'Max °C', data: tmax, borderColor: '#e05a5a', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, yAxisID: 'y' },
          { type: 'line', label: 'Min °C', data: tmin, borderColor: '#5cc3cd', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, yAxisID: 'y' },
          { type: 'bar', label: 'Rain (mm)', data: precip, backgroundColor: 'rgba(92,163,205,0.35)', yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, font: { size: 8 } } },
          tooltip: { callbacks: { label: function(item){ return item.dataset.label + ': ' + item.formattedValue + (item.dataset.yAxisID === 'y1' ? ' mm' : '°C'); } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 8 } } },
          y: { position: 'left', grid: { color: 'rgba(138,211,170,0.1)' }, ticks: { font: { size: 8 } } },
          y1: { position: 'right', grid: { display: false }, ticks: { font: { size: 8 } } }
        }
      }
    });
  }

  window.VindhyaForecast = { load: load };
})();
