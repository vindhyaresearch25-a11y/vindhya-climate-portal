/*
 * live_weather_loader.js — NASA POWER daily point data for the currently
 * selected location (FINAL_PROMPT.md Phase 9's "Live Weather" panel,
 * identified in docs/PANEL_SOURCE_AUDIT.md as the clearest real
 * integration win: NASA POWER's API is free, keyless, no registration).
 *
 * Honesty note this panel exists specifically to get right: NASA POWER
 * is a satellite/reanalysis product (GEOS-IT via POWER), not a live
 * weather-station feed -- its most recent ~2-3 days are typically
 * unfilled (returned as the API's own -999 fill value) while the
 * pipeline catches up. This loader never shows -999 as if it were a
 * real reading, and always labels the data by its actual date, not as
 * "today's weather" -- see renderWeather()'s "as of <date>" text.
 *
 * Point used: window.currentLocationPoint, set by national_selector.js's
 * placeMarker() via turf.pointOnFeature on the currently selected
 * boundary (state/district/block/village -- whichever is most specific),
 * so this works at every level, not just district.
 */
(function () {
  'use strict';

  var POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/daily/point';
  var PARAMETERS = 'T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M';
  var FILL_VALUE = -999;
  var LOOKBACK_DAYS = 10; // wide enough to always land on real data past the reporting lag

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }

  function ymd(d) {
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function fetchPower(lat, lon) {
    var end = new Date();
    var start = new Date(end.getTime() - LOOKBACK_DAYS * 86400000);
    var url = POWER_BASE + '?parameters=' + PARAMETERS + '&community=AG&longitude=' + lon +
      '&latitude=' + lat + '&start=' + ymd(start) + '&end=' + ymd(end) + '&format=JSON';
    return fetchWithTimeout(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function render() {
    var box = document.getElementById('live-weather-box');
    if (!box) return;
    var pt = window.currentLocationPoint;
    if (!pt) {
      box.innerHTML = '<div class="btm-pane-empty"><i class="fa fa-cloud-sun u-icon-lg-muted"></i>' +
        '<div><b>' + t('Live Weather', 'मौसम') + '</b><br>' +
        t('Select a district, block or village to see live weather for that point', 'उस स्थान का लाइव मौसम देखने के लिए ज़िला, ब्लॉक या गाँव चुनें') + '</div>' +
        '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> ' +
        t('Select district', 'ज़िला चुनें') + '</button></div>';
      return;
    }
    box.innerHTML = '<div style="padding:16px;font-size:12px;opacity:.8">' +
      t('Loading weather...', 'मौसम लाया जा रहा है...') + '</div>';

    fetchPower(pt.lat, pt.lon).then(function (data) {
      var params = data && data.properties && data.properties.parameter;
      if (!params) throw new Error('no parameter block in response');

      var dates = Object.keys(params.T2M_MAX || {}).sort();
      var rows = dates.map(function (d) {
        var tmax = params.T2M_MAX[d], tmin = params.T2M_MIN[d], precip = params.PRECTOTCORR[d],
            rh = params.RH2M[d], wind = params.WS2M[d];
        return {
          date: d,
          tmax: tmax === FILL_VALUE ? null : tmax,
          tmin: tmin === FILL_VALUE ? null : tmin,
          precip: precip === FILL_VALUE ? null : precip,
          rh: rh === FILL_VALUE ? null : rh,
          wind: wind === FILL_VALUE ? null : wind,
        };
      }).filter(function (r) { return r.tmax !== null || r.precip !== null; }); // drop pure-fill rows

      if (!rows.length) {
        box.innerHTML = '<div style="padding:var(--space-07) var(--space-08);font-size:var(--fs-2);line-height:1.8">' +
          '<b>' + t('Live Weather', 'मौसम') + '</b><br>' +
          t('No data · NASA POWER', 'कोई डेटा नहीं · NASA POWER') +
          '</div>';
        return;
      }

      var latest = rows[rows.length - 1];
      var fmtDate = function (ymdStr) {
        return ymdStr.slice(0, 4) + '-' + ymdStr.slice(4, 6) + '-' + ymdStr.slice(6, 8);
      };
      var fmt = function (v, d) { return v == null ? '—' : v.toFixed(d == null ? 1 : d); };

      var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">';
      h += '<div style="margin-bottom:9px"><span style="display:inline-block;padding:1px 7px;border-radius:9px;' +
        'background:#3b7fc9;color:#fff;font-size:10px;font-weight:700;letter-spacing:.3px">NASA POWER</span> ' +
        '<b>' + t('Weather as of ', 'मौसम, दिनांक ') + fmtDate(latest.date) + '</b></div>';
      h += '<div style="display:flex;gap:0.5rem;margin-bottom:9px;flex-wrap:wrap">' +
        '<div class="metric-card" style="flex:1;min-width:90px;"><div class="metric-label">' + t('MAX TEMP', 'अधि. तापमान') + '</div>' +
        '<div class="metric-value" style="color:var(--orange)">' + fmt(latest.tmax) + '°C</div></div>' +
        '<div class="metric-card" style="flex:1;min-width:90px;"><div class="metric-label">' + t('MIN TEMP', 'न्यू. तापमान') + '</div>' +
        '<div class="metric-value" style="color:var(--cyan)">' + fmt(latest.tmin) + '°C</div></div>' +
        '<div class="metric-card" style="flex:1;min-width:90px;"><div class="metric-label">' + t('RAINFALL', 'वर्षा') + '</div>' +
        '<div class="metric-value" style="color:var(--blue)">' + fmt(latest.precip) + ' mm</div></div>' +
        '<div class="metric-card" style="flex:1;min-width:90px;"><div class="metric-label">' + t('HUMIDITY', 'नमी') + '</div>' +
        '<div class="metric-value">' + fmt(latest.rh, 0) + '%</div></div>' +
        '<div class="metric-card" style="flex:1;min-width:90px;"><div class="metric-label">' + t('WIND', 'हवा') + '</div>' +
        '<div class="metric-value">' + fmt(latest.wind) + ' m/s</div></div>' +
        '</div>';

      h += '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
        '<tr style="text-align:left;font-size:9.5px;opacity:.65;letter-spacing:.3px">' +
        '<th style="padding:2px 0">' + t('DATE', 'दिनांक') + '</th>' +
        '<th style="text-align:right">' + t('MAX °C', 'अधि. °C') + '</th>' +
        '<th style="text-align:right">' + t('MIN °C', 'न्यू. °C') + '</th>' +
        '<th style="text-align:right">' + t('RAIN mm', 'वर्षा mm') + '</th></tr>';
      rows.slice(-7).reverse().forEach(function (r) {
        h += '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:3px 0">' + fmtDate(r.date) + '</td>' +
          '<td style="text-align:right">' + fmt(r.tmax) + '</td>' +
          '<td style="text-align:right">' + fmt(r.tmin) + '</td>' +
          '<td style="text-align:right">' + fmt(r.precip) + '</td></tr>';
      });
      h += '</table>';

      h += '<div style="margin-top:6px;padding-top:8px;border-top:1px solid var(--border);' +
        'font-size:10px;opacity:.75;line-height:1.6">' +
        t('Source: NASA POWER (power.larc.nasa.gov), GEOS-IT satellite/reanalysis -- not a live station feed. ' +
          'The most recent 1-3 days are usually not yet processed by NASA and are omitted here rather than shown as zero.',
          'स्रोत: NASA POWER (power.larc.nasa.gov), उपग्रह/रीएनालिसिस -- यह किसी लाइव स्टेशन का सीधा डेटा नहीं है। ' +
          'हाल के 1-3 दिन आमतौर पर अभी संसाधित नहीं होते, इसलिए यहाँ नहीं दिखाए गए।') +
        '</div></div>';

      box.innerHTML = h;
    }).catch(function (err) {
      console.error('[live_weather_loader] failed:', err);
      box.innerHTML = '<div style="padding:12px 14px;font-size:12px;line-height:1.8">' +
        '<b style="color:#c0392b">' + t('Weather failed to load', 'मौसम लोड नहीं हुआ') + '</b><br>' +
        err.message +
        '<br><button id="weather-retry-btn" style="margin-top:8px;background:#c0392b;color:#fff;' +
        'border:none;border-radius:4px;padding:4px 14px;font-size:11px;font-weight:700;cursor:pointer;">' +
        t('Retry', 'फिर कोशिश करें') + '</button></div>';
      var btn = document.getElementById('weather-retry-btn');
      if (btn) btn.onclick = function () { render(); };
    });
  }

  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || document.getElementById('pane-liveweather')) return;

    var p = document.createElement('div');
    p.innerHTML = '<div id="live-weather-box"></div>';
    p.className = 'btm-pane';
    p.id = 'pane-liveweather';
    host.appendChild(p);
    // AUDIT_FIX_PROMPT.md item 9: setNav('liveweather') already calls
    // VindhyaLiveWeather.reload() (=render()) after setBtmTab(), so the
    // sidebar path was already fine -- this eager call just guarantees
    // #live-weather-box isn't a blank empty div on first page load either,
    // for consistency with mandi_loader.js's/crop_stats_loader.js's fix.
    render();

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !document.getElementById('liveweather-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-cloud-sun"></i>' + t('Live Weather', 'मौसम');
      tab.className = 'btm-tab btm-tab-dup'; // owner report 2026-08-14: sidebar already has this exact item, this button was a visible duplicate
      tab.id = 'liveweather-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        document.getElementById('pane-liveweather').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        render();
      };
      tabs.appendChild(tab);
    }

    var ds = document.getElementById('districtSelect');
    if (ds) ds.addEventListener('change', function () {
      var pane = document.getElementById('pane-liveweather');
      if (pane && pane.classList.contains('active')) setTimeout(render, 400); // let placeMarker() set currentLocationPoint first
    });
  }

  function boot() {
    if (!document.querySelector('.btm-pane')) { setTimeout(boot, 700); return; }
    try { addPane(); } catch (e) { console.warn('[live_weather_loader]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 950); });
  } else {
    setTimeout(boot, 950);
  }

  window.VindhyaLiveWeather = { reload: render };
})();
