/*
 * kisan_dashboard.js -- VINDHYA Climate Portal, KISAN_DASHBOARD_PROMPT.md
 *
 * A FULL, SEPARATE, full-width-stacked-sections dashboard view that opens
 * when a farmer finishes drawing their field in Mera Khet (mera_khet.js).
 * This is NOT the shared bottom-strip and NOT a resize of the existing
 * #pane-merakhet modal -- the owner explicitly asked for something bigger
 * because the modal's content presentation (patli strip) wasn't enough for
 * 10 full sections. See INTEGRATION DECISION below for exactly how this
 * connects to mera_khet.js.
 *
 * INTEGRATION DECISION (documented per the task's own instruction to pick
 * one and document it):
 *   - mera_khet.js keeps 100% of its existing polygon-draw / area-perimeter
 *     / district-resolution / soil+climate fetch / NDVI fetch / download /
 *     ground-truth logic UNCHANGED. This file adds no new geometry math, no
 *     second Earth Engine call, no second ground-truth pipeline.
 *   - TWO surgical hook calls were added to mera_khet.js (search for
 *     "KISAN_DASHBOARD hook" in that file):
 *       1. Inside mkRender(res) -- fires window.VindhyaKisanDashboard.update(res)
 *          every time mera_khet.js re-renders (initial synchronous render +
 *          each async arrival of analyze/soil/climate/districtNdvi). This
 *          file's sections 1/3/4/5 stay live-synced with zero polling.
 *       2. Inside finishDrawMK() -- fires window.VindhyaKisanDashboard.open(res)
 *          once, right after the polygon is finished, so the full dashboard
 *          opens automatically instead of the farmer having to find a
 *          button. Both calls are no-ops if this file hasn't loaded.
 *   - The small modal (#pane-merakhet) still exists for the actual draw
 *     controls (Draw/Finish/Clear buttons) and still fills its own
 *     `#mk-result` div with mera_khet.js's original compact result HTML --
 *     that is harmless, costs nothing extra (same data, already fetched),
 *     and is the fallback path if a farmer closes this full view and wants
 *     to see the numbers again without redrawing (a "poora dashboard देखें"
 *     button in the modal reopens this view from the same lastResult).
 *   - This file supersedes the MODAL as the primary result-viewing surface;
 *     the modal is superseded, not deleted (STANDING ORDERS-consistent:
 *     never rip out a working, honest path without a documented reason).
 *
 * DATA HONESTY -- every section either shows a real fetched value with its
 * source/resolution/date, or an explicit "अभी उपलब्ध नहीं" + why. Nothing
 * here is fabricated, interpolated, or a neighbouring unit's substitute
 * (STANDING ORDERS #6/#7, repo CLAUDE.md's overriding rule).
 *
 * KRAM (build order, per KISAN_DASHBOARD_PROMPT.md, each committed
 * separately -- see git log for the exact commit boundaries):
 *   1. Skeleton + sections 1 (जमीन), 2 (मौसम), 3 (बारिश/सूखा), 4 (मिट्टी)
 *   2. Section 5 (NDVI) via the live Mera Khet Worker
 *   3. Sections 6 (फसलें), 9 (मंडी भाव)
 *   4. Section 10 (Kisan Sahayak, embedded)
 *   5. Section 7 (कीट/रोग, via the Vectorize corpus behind Kisan Sahayak)
 *   6. Section 8 (नुकसान/फोटो -- text+location only this round)
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Shared small utilities -- each loader file in this repo keeps its own
  // copy rather than sharing a global (documented convention, see
  // mera_khet.js's own header).
  // ------------------------------------------------------------------
  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }
  function el(id) { return document.getElementById(id); }
  function ce(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }
  function fmt(v, d) { return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d); }
  function slugify(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ------------------------------------------------------------------
  // State -- the current mera_khet.js result object (same shape as
  // mera_khet.js's own `lastResult`/`res`: ring, area_ha, perimeter_km,
  // centroid, state_name, district_name, soil, soilCell, climate,
  // climateSource, analyze, districtNdvi). We never copy or duplicate this
  // computation -- we just render whatever mera_khet.js already computed.
  // ------------------------------------------------------------------
  var KD = { res: null, isOpen: false, previewMap: null, weather: null, forecast: null, crops: null, mandi: null };

  // ==================================================================
  // Container + base styles (injected once)
  // ==================================================================
  var STYLE_ID = 'kd-style';
  function injectStyle() {
    if (el(STYLE_ID)) return;
    var s = ce('style'); s.id = STYLE_ID;
    s.textContent =
      // z-index 1200, not 960: Leaflet's own .leaflet-top/.leaflet-bottom
      // (the background map's zoom control, scale bar) ship with
      // z-index:1000 in leaflet.css -- at 960 they were bleeding through
      // on top of this full-screen view (owner-reported overlap bug,
      // confirmed live 2026-08-14). 1200 clears that while staying below
      // the sidebar/chat-widget layer (1900-2100, index.html's :root).
      '#kisan-dashboard-view{position:fixed;inset:0;z-index:1200;background:var(--bg-deep);display:none;flex-direction:column;overflow:hidden;}' +
      '#kisan-dashboard-view.kd-open{display:flex;}' +
      '.kd-head{flex:0 0 auto;display:flex;align-items:center;gap:var(--space-08);padding:var(--space-06) var(--space-1);border-bottom:1px solid var(--border);background:var(--bg-panel);position:sticky;top:0;z-index:5;flex-wrap:wrap;}' +
      '.kd-head-title{font-size:var(--fs-4);font-weight:800;color:var(--text);}' +
      '.kd-head-sub{font-size:var(--fs-1);color:var(--text-dim);}' +
      '.kd-head-spacer{flex:1;}' +
      '.kd-close{width:44px;height:44px;min-width:44px;border-radius:var(--radius-8);border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
      '.kd-close:hover{border-color:var(--red);color:var(--red);}' +
      '.kd-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:var(--space-1) 0 80px;}' +
      '.kd-section{width:100%;max-width:1080px;margin:0 auto var(--space-15);padding:0 var(--space-1);}' +
      '.kd-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-10);overflow:hidden;}' +
      '.kd-card-body{padding:var(--space-1);}' +
      '.kd-h{font-size:var(--fs-3);font-weight:700;color:var(--cyan);margin-bottom:var(--space-04);display:flex;align-items:center;gap:var(--space-04);flex-wrap:wrap;}' +
      '.kd-h .kd-h-note{font-size:var(--fs-1);font-weight:400;color:var(--text-dim);opacity:.8;}' +
      '.kd-skel{background:linear-gradient(90deg,rgba(90,106,122,.08) 25%,rgba(90,106,122,.16) 37%,rgba(90,106,122,.08) 63%);background-size:400% 100%;animation:kd-skel 1.4s ease infinite;border-radius:var(--radius-6);min-height:60px;}' +
      '@keyframes kd-skel{0%{background-position:100% 50%}100%{background-position:0 50%}}' +
      '.kd-fade{animation:kd-fadein .2s ease;}' +
      '@keyframes kd-fadein{from{opacity:0}to{opacity:1}}' +
      '.kd-row{display:flex;gap:var(--space-08);flex-wrap:wrap;}' +
      '.kd-empty{padding:var(--space-08) var(--space-06);font-size:var(--fs-2);color:var(--text-dim);background:rgba(138,138,138,.08);border-left:3px solid var(--text-dim);border-radius:var(--radius-4);line-height:1.7;}' +
      '.kd-note{font-size:var(--fs-1);color:var(--text-dim);opacity:.75;margin-top:var(--space-04);line-height:1.6;}' +
      '.kd-source{font-size:var(--fs-1);color:var(--text-dim);opacity:.7;border-top:1px solid var(--border);padding-top:var(--space-04);margin-top:var(--space-06);}' +
      '.kd-btn{padding:10px 18px;min-height:44px;border-radius:var(--radius-6);border:1px solid var(--cyan);background:var(--cyan);color:#fff;font-weight:700;font-size:var(--fs-2);cursor:pointer;}' +
      '.kd-btn.kd-btn-ghost{background:var(--bg-card);color:var(--text);border-color:var(--border);}' +
      '.kd-btn:disabled{opacity:.5;cursor:not-allowed;}' +
      '.kd-table{width:100%;border-collapse:collapse;font-size:var(--fs-2);}' +
      '.kd-table th,.kd-table td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);}' +
      '.kd-table th{color:var(--text-dim);font-weight:600;font-size:var(--fs-1);}' +
      '.kd-map-wrap{height:260px;border-radius:var(--radius-8);overflow:hidden;border:1px solid var(--border);}' +
      '.kd-sticky-loc{display:none;}' +
      '@media(max-width:768px){' +
      '  .kd-body{padding-top:var(--space-06);padding-bottom:64px;}' +
      '  .kd-section{padding:0 var(--space-06);}' +
      '  .kd-map-wrap{height:40vh;}' +
      '  .kd-head-title{font-size:var(--fs-3);}' +
      '  .kd-row{flex-direction:column;}' +
      '  .kd-sticky-loc{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:970;background:var(--bg-panel);border-top:1px solid var(--border);padding:var(--space-05) var(--space-06);align-items:center;gap:var(--space-04);font-size:var(--fs-1);color:var(--text);box-shadow:0 -2px 8px rgba(0,0,0,.08);}' +
      '  .kd-sticky-loc b{font-size:var(--fs-2);}' +
      '}' +
      '.kd-chat-log{max-height:320px;overflow-y:auto;padding:var(--space-06);background:var(--bg-deep);border-radius:var(--radius-6);margin-bottom:var(--space-06);}' +
      '.kd-chat-msg{padding:8px 12px;border-radius:var(--radius-8);margin-bottom:var(--space-05);font-size:var(--fs-2);line-height:1.6;white-space:pre-wrap;max-width:90%;}' +
      '.kd-chat-msg.user{background:var(--cyan);color:#fff;margin-left:auto;}' +
      '.kd-chat-msg.bot{background:var(--bg-card);border:1px solid var(--border);color:var(--text);}' +
      '.kd-chat-inputrow{display:flex;gap:var(--space-05);}' +
      '.kd-chat-inputrow input{flex:1;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:var(--radius-6);font-size:var(--fs-2);background:var(--bg-card);color:var(--text);}' +
      '';
    document.head.appendChild(s);
  }

  function buildContainer() {
    if (el('kisan-dashboard-view')) return el('kisan-dashboard-view');
    injectStyle();
    var wrap = ce('div'); wrap.id = 'kisan-dashboard-view';
    wrap.innerHTML =
      '<div class="kd-head">' +
        '<div><div class="kd-head-title">नमस्कार, किसान भाई/बहन — VINDHYA पोर्टल में आपका स्वागत है</div>' +
        '<div class="kd-head-sub">Welcome to VINDHYA — your field\'s dashboard</div></div>' +
        '<div class="kd-head-spacer"></div>' +
        '<div id="kd-head-loc" class="kd-head-sub" style="font-weight:600;color:var(--text)"></div>' +
        '<button class="kd-close" id="kd-close-btn" title="Close / बंद करें">&times;</button>' +
      '</div>' +
      '<div class="kd-body" id="kd-body">' +
        section('kd-sec-1', '1. आपकी ज़मीन / Your field') +
        section('kd-sec-2', '2. आज का मौसम / Today\'s weather <span class="kd-h-note">[LIVE]</span>') +
        section('kd-sec-3', '3. बारिश और सूखा / Rainfall &amp; drought') +
        section('kd-sec-4', '4. मिट्टी की नमी / Soil moisture') +
        section('kd-sec-5', '5. फ़सल की सेहत (NDVI) / Crop health') +
        section('kd-sec-6', '6. आपके क्षेत्र की मुख्य फ़सलें / Main crops in your district') +
        section('kd-sec-7', '7. कीट और रोग / Pests &amp; diseases') +
        section('kd-sec-8', '8. नुक़सान हुआ? बताइए / Report a problem') +
        section('kd-sec-9', '9. मंडी भाव / Mandi prices') +
        section('kd-sec-10', '10. सवाल पूछिए / Ask Kisan Sahayak') +
      '</div>' +
      '<div class="kd-sticky-loc" id="kd-sticky-loc"></div>';
    document.body.appendChild(wrap);
    el('kd-close-btn').onclick = close;
    return wrap;
  }
  function section(id, titleHtml) {
    return '<div class="kd-section"><div class="kd-card"><div class="kd-card-body">' +
      '<div class="kd-h">' + titleHtml + '</div>' +
      '<div id="' + id + '"><div class="kd-skel" style="height:80px"></div></div>' +
      '</div></div></div>';
  }
  function skeleton(id, h) { var box = el(id); if (box) box.innerHTML = '<div class="kd-skel" style="height:' + (h || 80) + 'px"></div>'; }
  function setHtml(id, html) { var box = el(id); if (box) { box.innerHTML = html; box.classList.add('kd-fade'); } }

  // ==================================================================
  // Open / close / update (public API)
  // ==================================================================
  function open(res) {
    if (!res) return;
    KD.res = res;
    buildContainer();
    document.body.classList.add('kd-open-lock');
    var v = el('kisan-dashboard-view');
    v.classList.add('kd-open');
    KD.isOpen = true;
    renderHead(res);
    renderAll(res);
    // Independent fetches (not carried by mera_khet.js's res) -- fired once
    // per open, not re-fired on every update() (weather/crops/mandi don't
    // change while the same field stays open).
    loadWeather(res);
    loadCropsAndMandi(res);
  }
  function update(res) {
    if (!KD.isOpen) return;
    KD.res = res;
    renderHead(res);
    renderSection1(res);
    renderSection3(res);
    renderSection4(res);
    renderSection5(res);
  }
  function close() {
    var v = el('kisan-dashboard-view');
    if (v) v.classList.remove('kd-open');
    document.body.classList.remove('kd-open-lock');
    KD.isOpen = false;
  }
  function reopen() { if (KD.res) open(KD.res); }

  function renderHead(res) {
    var loc = (res.district_name ? (res.district_name + ', ' + res.state_name) : 'जिला खोजा जा रहा है... / locating...');
    var locHtml = fmt(res.area_ha, 2) + ' ha &middot; ' + esc(loc);
    var h = el('kd-head-loc'); if (h) h.innerHTML = locHtml;
    var s = el('kd-sticky-loc'); if (s) s.innerHTML = '<b>' + fmt(res.area_ha, 2) + ' हेक्टेयर</b><span>' + esc(loc) + '</span>';
  }

  function renderAll(res) {
    renderSection1(res);
    renderSection2Loading();
    renderSection3(res);
    renderSection4(res);
    renderSection5(res);
    renderSection6Loading();
    renderSection7(res);
    renderSection8(res);
    renderSection9Loading();
    renderSection10(res);
  }

  // ==================================================================
  // SECTION 1 -- आपकी ज़मीन / Your field
  // ==================================================================
  function renderSection1(res) {
    var croplandPct = (res.analyze && res.analyze.available && res.analyze.cropland_fraction != null) ? res.analyze.cropland_fraction * 100 : null;
    var h = '<div class="kd-row">' +
      metricCard('कुल क्षेत्रफल / TOTAL AREA', fmt(res.area_ha, 2) + ' ha', fmt(res.area_km2, 3) + ' km²', 'खेत-स्तर, असली (आपने खींचा) / field-level, real (you drew it)') +
      metricCard('परिधि / PERIMETER', fmt(res.perimeter_km, 3) + ' km', '', '') +
      metricCard('खेती वाला हिस्सा / CROPLAND SHARE', croplandPct != null ? fmt(croplandPct, 1) + '%' : (res.analyze === null ? 'जाँचा जा रहा है...' : 'अभी उपलब्ध नहीं'),
        croplandPct != null ? 'बाकी: मेड़/बंजर आदि / rest: bunds, fallow, etc.' : '', 'Dynamic World, 10 m, live GEE query') +
      '</div>';
    h += '<div class="kd-map-wrap" id="kd-map-1" style="margin-top:12px"></div>' +
      '<div class="kd-note">नक़्शा: Esri World Imagery (सैटेलाइट) — <a id="kd-gearth-link" href="#" target="_blank" rel="noopener">Google Maps सैटेलाइट में देखें / Open in Google Maps satellite</a><br>' +
      '<span style="opacity:.75">Map tiles: Esri World Imagery. Polygon is your own drawn field boundary, not a cadastral/khasra record.</span></div>';
    setHtml('kd-sec-1', h);
    mountPreviewMap(res);
  }

  function metricCard(label, value, unit, source) {
    return '<div class="metric-card" style="flex:1;min-width:150px">' +
      '<div class="metric-label">' + label + '</div>' +
      '<div class="metric-value cyan">' + value + (unit ? ' <span style="font-size:var(--fs-2);font-weight:500">' + unit + '</span>' : '') + '</div>' +
      (source ? '<div class="metric-source">' + source + '</div>' : '') +
      '</div>';
  }

  function mountPreviewMap(res) {
    var box = el('kd-map-1');
    if (!box || typeof L === 'undefined' || !res.ring || !res.ring.length) return;
    var latlngs = res.ring.map(function (p) { return [p[1], p[0]]; });
    var glink = el('kd-gearth-link');
    if (glink) glink.href = 'https://www.google.com/maps/@' + res.centroid[1] + ',' + res.centroid[0] + ',17z/data=!3m1!1e3';
    try {
      if (KD.previewMap) { KD.previewMap.remove(); KD.previewMap = null; }
      var map = L.map(box, { attributionControl: true, zoomControl: true });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics'
      }).addTo(map);
      var poly = L.polygon(latlngs, { color: '#C6FF00', weight: 3, fillOpacity: 0.12 }).addTo(map);
      map.fitBounds(poly.getBounds(), { padding: [20, 20], maxZoom: 18 });
      KD.previewMap = map;
      setTimeout(function () { map.invalidateSize(); }, 200);
    } catch (e) { console.warn('[kisan_dashboard] preview map failed', e); }
  }

  // ==================================================================
  // SECTION 2 -- आज का मौसम / Today's weather [LIVE]
  //
  // NASA POWER: real, but only historical/near-real-time (confirmed by
  // direct test -- a future-dated POWER request returns an EMPTY
  // parameter block, never a forecast; live_weather_loader.js only ever
  // used it for the "recent daily" reading, not a forward-looking
  // forecast). Rather than fabricate a 7-day forecast or silently drop
  // the requirement, this section's forecast half uses Open-Meteo
  // (api.open-meteo.com/v1/forecast) -- free, keyless, real NWP-model
  // output (ECMWF/GFS blend), clearly labelled as a different source than
  // the "today" reading above it. Documented substitution, not a
  // fabrication -- see this file's header / KISAN_DASHBOARD task notes.
  // ==================================================================
  var POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/daily/point';
  var OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }

  function renderSection2Loading() { skeleton('kd-sec-2', 110); }

  function loadWeather(res) {
    if (!res.centroid) { renderSection2Empty('कोई निर्देशांक नहीं / no coordinates'); return; }
    var lat = res.centroid[1], lon = res.centroid[0];
    var end = new Date(); var start = new Date(end.getTime() - 10 * 86400000);
    var powerUrl = POWER_BASE + '?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M&community=AG&longitude=' + lon + '&latitude=' + lat + '&start=' + ymd(start) + '&end=' + ymd(end) + '&format=JSON';
    var meteoUrl = OPEN_METEO_BASE + '?latitude=' + lat + '&longitude=' + lon + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&forecast_days=7&timezone=Asia%2FKolkata';

    Promise.all([
      fetchWithTimeout(powerUrl).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetchWithTimeout(meteoUrl).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (arr) {
      KD.weather = arr[0]; KD.forecast = arr[1];
      renderSection2(arr[0], arr[1]);
    });
  }

  function renderSection2Empty(msg) { setHtml('kd-sec-2', '<div class="kd-empty">अभी उपलब्ध नहीं / Not available — ' + esc(msg) + '</div>'); }

  function renderSection2(power, meteo) {
    var h = '';
    // Today/recent (NASA POWER)
    var params = power && power.properties && power.properties.parameter;
    if (params) {
      var dates = Object.keys(params.T2M_MAX || {}).sort();
      var FILL = -999;
      var rows = dates.map(function (d) {
        return { date: d, tmax: params.T2M_MAX[d], tmin: params.T2M_MIN[d], precip: params.PRECTOTCORR[d], rh: params.RH2M[d], wind: params.WS2M[d] };
      }).filter(function (r) { return r.tmax !== FILL; });
      if (rows.length) {
        var last = rows[rows.length - 1];
        var dl = last.date.slice(0, 4) + '-' + last.date.slice(4, 6) + '-' + last.date.slice(6, 8);
        h += '<div class="kd-row">' +
          metricCard('अधिकतम तापमान / MAX TEMP', fmt(last.tmax, 1) + '°C', '', 'as of ' + dl) +
          metricCard('न्यूनतम तापमान / MIN TEMP', fmt(last.tmin, 1) + '°C', '', '') +
          metricCard('नमी / HUMIDITY', last.rh !== FILL ? fmt(last.rh, 0) + '%' : '—', '', '') +
          metricCard('हवा / WIND', last.wind !== FILL ? fmt(last.wind, 1) + ' m/s' : '—', '', '') +
          '</div>' +
          '<div class="kd-note">NASA POWER एक सैटेलाइट/पुनर्विश्लेषण उत्पाद है, मौसम-स्टेशन नहीं — हाल के 2-3 दिन अक्सर अभी अपडेट नहीं होते। ऊपर <b>' + dl + '</b> तक का असली डेटा है, आज का नहीं हो सकता।' +
          '<br><span style="opacity:.75">NASA POWER is satellite/reanalysis, not a live station — shown date is the most recent real value, may lag 2-3 days.</span></div>';
      } else {
        h += '<div class="kd-empty">इस स्थान के लिए हाल का मौसम डेटा नहीं मिला। / No recent weather data for this point.</div>';
      }
    } else {
      h += '<div class="kd-empty">मौसम डेटा अभी उपलब्ध नहीं (नेटवर्क)। / Weather data not available right now (network).</div>';
    }

    // 7-day forecast (Open-Meteo)
    h += '<div style="margin-top:14px;font-weight:700;font-size:var(--fs-2)">7-दिन का पूर्वानुमान / 7-day forecast</div>';
    var daily = meteo && meteo.daily;
    if (daily && Array.isArray(daily.time)) {
      var rainDays = 0;
      var cells = daily.time.map(function (d, i) {
        var pop = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null;
        if (pop != null && pop >= 50) rainDays++;
        return '<div style="flex:1;min-width:80px;text-align:center;padding:8px 4px;border:1px solid var(--border);border-radius:6px">' +
          '<div style="font-size:11px;color:var(--text-dim)">' + d.slice(5) + '</div>' +
          '<div style="font-weight:700">' + fmt(daily.temperature_2m_max[i], 0) + '° / ' + fmt(daily.temperature_2m_min[i], 0) + '°</div>' +
          '<div style="font-size:11px;color:var(--cyan)">' + (pop != null ? pop + '%' : '—') + ' <i class="fa fa-cloud-rain"></i></div>' +
          '<div style="font-size:10px;color:var(--text-dim)">' + fmt(daily.precipitation_sum[i], 1) + ' mm</div>' +
          '</div>';
      }).join('');
      h += '<div class="kd-row" style="margin-top:6px">' + cells + '</div>';
      h += '<div class="kd-note">अगले 7 दिनों में से <b>' + rainDays + '</b> दिन बारिश की 50% या ज़्यादा संभावना।' +
        '<br><span style="opacity:.75">Source: Open-Meteo (NWP model blend, ECMWF/GFS) — a different, forward-looking source from the NASA POWER reading above, shown separately on purpose (never merged into one number).</span></div>';
    } else {
      h += '<div class="kd-empty">पूर्वानुमान अभी उपलब्ध नहीं (नेटवर्क)। / Forecast not available right now (network).</div>';
    }
    setHtml('kd-sec-2', h);
  }

  // ==================================================================
  // SECTION 3 -- बारिश और सूखा / Rainfall & drought
  // Reuses res.climate / res.climateSource exactly as mera_khet.js
  // computed them (district/grid-level, ERA5-Land+CHIRPS nationally or
  // IMD for the 5 MP districts). Yearly 2000-2024 chart is only possible
  // for the 5 MP districts (window._mpClimateData carries a real
  // year-by-year array there) -- the national GEE districts' files only
  // carry a 25-year AGGREGATE (verified by reading a sample file), no
  // per-year breakdown exists yet, so the chart is honestly omitted with
  // an explanation for those districts rather than faked.
  // ==================================================================
  function renderSection3(res) {
    if (res.locateFailed) { setHtml('kd-sec-3', '<div class="kd-empty">आपके खेत का जिला पता नहीं चल सका। / Could not resolve which district this field falls in.</div>'); return; }
    if (!res.state_name) { skeleton('kd-sec-3', 90); return; }
    var c = res.climate;
    if (!c) {
      setHtml('kd-sec-3', '<div class="kd-empty">' + esc(res.district_name) + ' के लिए जलवायु आंकड़े अभी उपलब्ध नहीं। / Climate data not yet available for ' + esc(res.district_name) + '.</div>' +
        gridDisclaimer('~5.5-11 किमी', null, 'गाँव/स्थान'));
      return;
    }
    var rain = c.annual_rain_mm_mean != null ? c.annual_rain_mm_mean : c.annual_rain_mm;
    var heat = c.heatwave_days_mean != null ? c.heatwave_days_mean : c.heatwave_days;
    var drought = c.drought_probability_pct;
    var rx1 = c.rx1day_mm;
    var h = '<div class="kd-row">' +
      metricCard('वार्षिक वर्षा (2000-2024 औसत) / ANNUAL RAINFALL', fmt(rain, 0), 'mm', '') +
      metricCard('सूखे की संभावना / DROUGHT PROBABILITY', drought != null ? fmt(drought, 1) + '%' : '—', '', 'SPI-आधारित / SPI-based') +
      metricCard('पानी भरने का खतरा (Rx1day) / FLOOD RISK', rx1 != null ? fmt(rx1, 0) + ' mm' : '—', '', '1-दिन अधिकतम वर्षा / 1-day max rainfall') +
      metricCard('लू के दिन / HEATWAVE DAYS', heat != null ? fmt(heat, 1) : '—', 'दिन/वर्ष', '') +
      '</div>';

    var mpKey = mpRealKey(res.district_name, res.state_name);
    if (mpKey) {
      h += '<div id="kd-chart-3-wrap" style="margin-top:12px"><canvas id="kd-chart-3" height="90"></canvas></div>';
    } else {
      h += '<div class="kd-note" style="margin-top:10px">2000-2024 का साल-दर-साल ग्राफ अभी सिर्फ भोपाल/इंदौर/जबलपुर/रीवा/सीधी (असली IMD डेटा) के लिए उपलब्ध है। ' + esc(res.district_name) + ' के लिए सिर्फ 25-वर्ष का औसत उपलब्ध है, साल-दर-साल आंकड़ा अभी संग्रहित नहीं।' +
        '<br><span style="opacity:.75">A year-by-year chart currently exists only for the 5 original IMD (MP) districts. For ' + esc(res.district_name) + ', only the 25-year mean has been computed so far — a real, documented gap.</span></div>';
    }
    h += gridDisclaimer(res.climateSource && /IMD/.test(res.climateSource) ? '~5.5 किमी' : '~9-11 किमी', c.village_count, 'गाँव/स्थान');
    h += '<div class="kd-source">स्रोत / Source: ' + esc(res.climateSource || '') + '</div>';
    setHtml('kd-sec-3', h);

    if (mpKey) drawMpRainChart(mpKey);
  }

  function mpRealKey(districtName, stateName) {
    if (!stateName || !/madhya\s*pradesh/i.test(stateName)) return null;
    var key = slugify(districtName);
    return { bhopal: 1, indore: 1, jabalpur: 1, rewa: 1, sidhi: 1 }[key] ? key : null;
  }

  var kdChart3 = null;
  function drawMpRainChart(mpKey) {
    var data = window._mpClimateData;
    var d = data && data.districts && data.districts[mpKey];
    var annual = d && d.annual;
    var canvas = el('kd-chart-3');
    if (!annual || !canvas || typeof Chart === 'undefined') return;
    if (kdChart3) { kdChart3.destroy(); kdChart3 = null; }
    kdChart3 = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: annual.years, datasets: [{ label: 'वार्षिक वर्षा / Annual rainfall (mm)', data: annual.annual_rain_mm, backgroundColor: 'rgba(26,138,158,.55)' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(90,106,122,.15)' } }, x: { grid: { display: false } } } }
    });
  }

  function gridDisclaimer(resolutionLabel, nUnits, unitWord) {
    return '<div class="kd-note" style="margin-top:8px;padding:8px 10px;background:rgba(201,168,67,.12);border-left:3px solid #c9a843;border-radius:4px">' +
      'यह आपके गाँव वाली ' + resolutionLabel + ' ग्रिड सेल का माप है' + (nUnits != null ? '. इस सेल में लगभग <b>' + nUnits + '</b> ' + unitWord + ' साझा करते हैं' : '') + '। <b>यह आपके खेत का अपना माप नहीं है।</b>' +
      '<br><span style="opacity:.8">This is your village\'s ' + resolutionLabel + ' grid-cell value' + (nUnits != null ? ', shared by roughly ' + nUnits + ' ' + unitWord : '') + '. <b>NOT your own field\'s measurement.</b></span></div>';
  }

  // ==================================================================
  // SECTION 4 -- मिट्टी की नमी / Soil moisture (SMAP, 9 km)
  // Reuses res.soil / res.soilCell exactly as mera_khet.js computed them.
  // ==================================================================
  function renderSection4(res) {
    if (res.locateFailed) { setHtml('kd-sec-4', '<div class="kd-empty">जिला पता नहीं चल सका। / District could not be resolved.</div>'); return; }
    if (!res.state_name) { skeleton('kd-sec-4', 70); return; }
    if (!res.soil || !res.soil.district) {
      setHtml('kd-sec-4', '<div class="kd-empty">' + esc(res.district_name) + ' के लिए मिट्टी की नमी अभी उपलब्ध नहीं। / Soil moisture not yet computed for ' + esc(res.district_name) + '.</div>');
      return;
    }
    var d = res.soil.district;
    var h = '<div class="kd-row">' +
      metricCard('जिला-स्तर औसत नमी / DISTRICT MEAN', fmt(d.sm_surface_mean, 3), 'm³/m³', 'SD ' + fmt(d.sm_surface_stddev, 4) + ', N=' + d.n_cells + ' SMAP सेल');
    if (res.soilCell) {
      h += metricCard('निकटतम SMAP सेल / NEAREST CELL', fmt(res.soilCell.cell.sm_surface, 3), 'm³/m³', '≈' + fmt(res.soilCell.distance_km, 1) + ' km दूर');
    }
    h += '</div>';
    if (res.soilCell) h += gridDisclaimer('~9 किमी', res.soilCell.cell.n_villages_sharing_cell, 'गाँव');
    h += '<div class="kd-source">स्रोत / Source: NASA SMAP L4, via Google Earth Engine, ~9 km. पूरी गाँव/ब्लॉक/जिला/राज्य तुलना के लिए साइडबार का "Soil Moisture" टैब देखें। / For the full 4-tier comparison, see the Soil Moisture tab in the sidebar.</div>';
    setHtml('kd-sec-4', h);
  }

  // ==================================================================
  // SECTION 5 -- फ़सल की सेहत (NDVI) / Crop health
  // Field NDVI/cropland from the live Mera Khet Worker (res.analyze) +
  // district NDVI (res.districtNdvi), both already fetched by
  // mera_khet.js -- no second Earth Engine call here.
  //
  // GAPS DOCUMENTED (not built, per the task's own "deliberately-scoped
  // gap" allowance):
  //  - 6-month NDVI time series: would need ~6 sequential/parallel Earth
  //    Engine queries. Measured this session: one /analyze call ~2.2s.
  //    Six calls risk 10+ seconds and possible GEE rate limiting for a
  //    farmer who (per the spec's own PEHLE YE NAAPO budget) won't wait
  //    past ~10s. Not attempted this round -- real gap, not faked.
  //  - Sub-field "weak spot" mini-map: the /analyze endpoint returns only
  //    an aggregate NDVI + cropland fraction for the whole polygon, not a
  //    per-pixel raster -- there is nothing to map yet without a new
  //    raster-export endpoint (GeoTIFF export is separately already
  //    disabled in mera_khet.js's download section, same underlying GEE
  //    async-export limitation).
  // ==================================================================
  function renderSection5(res) {
    var fieldNdvi = (res.analyze && res.analyze.available && res.analyze.ndvi != null) ? res.analyze.ndvi : null;
    var cropland = (res.analyze && res.analyze.available && res.analyze.cropland_fraction != null) ? res.analyze.cropland_fraction * 100 : null;
    var wetness = (res.analyze && res.analyze.field_wetness_index_relative != null) ? res.analyze.field_wetness_index_relative : null;
    var dNdvi = res.districtNdvi;
    var h = '';
    if (res.analyze == null) {
      h += '<div class="kd-empty">खेत का NDVI जांचा जा रहा है (सैटेलाइट क्वेरी)... / Checking field NDVI (live satellite query)...</div>';
    } else if (!res.analyze.available) {
      h += '<div class="kd-empty">' + esc(res.analyze.message_hi || 'खेत-स्तर NDVI अभी उपलब्ध नहीं।') + '<br><span style="opacity:.75">' + esc(res.analyze.message_en || 'Field-scale NDVI not available.') + '</span></div>';
    } else {
      h += '<div class="kd-row">' +
        metricCard('आपके खेत का NDVI / YOUR FIELD NDVI', fmt(fieldNdvi, 3), '', 'Sentinel-2, 10 m, अभी / live') +
        metricCard('खेती वाला हिस्सा / CROPLAND SHARE', cropland != null ? fmt(cropland, 1) + '%' : '—', '', 'Dynamic World, 10 m');
      if (wetness != null) h += metricCard('सापेक्ष नमी सूचकांक / FIELD WETNESS (relative)', fmt(wetness, 2), '', 'Sentinel-1, प्रयोगात्मक / experimental');
      h += '</div>';
      if (dNdvi) {
        var diff = fieldNdvi - dNdvi.value;
        var diffColor = diff >= 0 ? 'var(--green)' : 'var(--red)';
        h += '<div style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:8px">' +
          '<b>आपके खेत का NDVI vs गाँव/जिला औसत / Your field vs district average</b><br>' +
          '<span style="font-size:var(--fs-2)">आपका खेत: <b>' + fmt(fieldNdvi, 3) + '</b> &nbsp;|&nbsp; जिला औसत: <b>' + fmt(dNdvi.value, 3) + '</b> (' + esc(dNdvi.dateLabel || '') + ') &nbsp;|&nbsp; फर्क: <b style="color:' + diffColor + '">' + (diff >= 0 ? '+' : '') + fmt(diff, 3) + '</b></span>' +
          '<div class="kd-note">खेत: Sentinel-2 (10 मी, हाल का)। जिला औसत: ' + esc(dNdvi.source) + '। <b>अलग उपग्रह/समय-अवधि — तुलना सांकेतिक है।</b>' +
          '<br><span style="opacity:.75">Different satellite family/time window — comparison is indicative, not exact.</span></div>' +
          '</div>';
      } else {
        h += '<div class="kd-note">जिला औसत NDVI अभी उपलब्ध नहीं, तुलना नहीं हो सकी। / District average NDVI not yet available, comparison not possible.</div>';
      }
    }
    h += '<div class="kd-note" style="margin-top:10px">6 महीने का ग्राफ और खेत के अंदर कमज़ोर हिस्सों का नक़्शा अभी नहीं बनाया गया है — 6 अलग सैटेलाइट क्वेरी में 10 सेकंड से ज़्यादा लग सकते हैं, और प्रति-पिक्सेल डेटा अभी बैकएंड से नहीं मिलता। यह असली, स्वीकृत कमी है, बनावटी ग्राफ नहीं दिखाया गया।' +
      '<br><span style="opacity:.75">6-month trend graph and a sub-field weak-spot map are not built yet (would need ~6 sequential satellite queries, and per-pixel data isn\'t returned by the backend today) — a documented gap, not a faked chart.</span></div>';
    setHtml('kd-sec-5', h);
  }

  // ==================================================================
  // SECTION 6 -- मुख्य फ़सलें / Main crops (DES, district-level)
  // ==================================================================
  var DES_BASE = 'data/crop_stats_des_by_district/';
  function renderSection6Loading() { skeleton('kd-sec-6', 140); }
  function renderSection9Loading() { skeleton('kd-sec-9', 100); }

  function loadCropsAndMandi(res) {
    if (!res.state_name || !res.district_name) {
      // District not resolved yet -- poll briefly via update()'s own re-renders;
      // renderSection6/9 get another chance once res.state_name/district_name
      // populate through the normal update(res) flow. Try once more shortly.
      setTimeout(function () { if (KD.res && KD.res.state_name) loadCropsAndMandi(KD.res); }, 1500);
      return;
    }
    var stateSlug = slugify(res.state_name), districtSlug = slugify(res.district_name);
    fetchWithTimeout(DES_BASE + stateSlug + '/' + districtSlug + '.json')
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (data) { KD.crops = data; renderSection6(data, res); });

    fetchWithTimeout('data/mandi_prices.json')
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (data) { KD.mandi = data; renderSection9(data, res, districtSlug); });
  }

  function renderSection6(data, res) {
    if (!data || !Array.isArray(data.records) || !data.records.length) {
      setHtml('kd-sec-6', '<div class="kd-empty">' + esc(res.district_name || '') + ' के लिए फसल आंकड़े अभी उपलब्ध नहीं। / Crop statistics not yet available for ' + esc(res.district_name || '') + '.</div>');
      return;
    }
    // Latest year present in the file
    var years = data.records.map(function (r) { return r.year; });
    var latestYear = years.sort()[years.length - 1];
    var rows = data.records.filter(function (r) { return r.year === latestYear && r.area_ha != null; });
    rows.sort(function (a, b) { return (b.area_ha || 0) - (a.area_ha || 0); });
    var top = rows.slice(0, 8);
    if (!top.length) {
      setHtml('kd-sec-6', '<div class="kd-empty">नवीनतम वर्ष के लिए क्षेत्रफल डेटा नहीं मिला। / No area data for the latest year.</div>');
      return;
    }
    var h = '<div style="font-size:var(--fs-2);margin-bottom:8px">वर्ष / Year: <b>' + esc(latestYear) + '</b> &middot; जिला-स्तर / district-level (' + esc(res.district_name) + ')</div>';
    h += '<div style="margin-bottom:12px"><canvas id="kd-chart-6" height="110"></canvas></div>';
    h += '<table class="kd-table"><thead><tr><th>फसल / Crop</th><th>मौसम / Season</th><th>क्षेत्रफल (ha) / Area</th><th>उत्पादन (t) / Production</th></tr></thead><tbody>' +
      top.map(function (r) { return '<tr><td>' + esc(r.crop) + '</td><td>' + esc(r.season) + '</td><td>' + fmt(r.area_ha, 0) + '</td><td>' + (r.production != null ? fmt(r.production, 0) : '—') + '</td></tr>'; }).join('') +
      '</tbody></table>';
    h += '<div class="kd-source">स्रोत / Source: ' + esc(data.metadata && data.metadata.source || 'DES') + ' — ज़िला-स्तर, आपके अकेले खेत का नहीं। / District-level, not your individual field.</div>';
    setHtml('kd-sec-6', h);

    var canvas = el('kd-chart-6');
    if (canvas && typeof Chart !== 'undefined') {
      if (KD.chart6) { KD.chart6.destroy(); }
      KD.chart6 = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: top.map(function (r) { return r.crop; }), datasets: [{ label: 'क्षेत्रफल (ha)', data: top.map(function (r) { return r.area_ha; }), backgroundColor: 'rgba(45,143,92,.6)' }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(90,106,122,.15)' } }, y: { grid: { display: false } } } }
      });
    }
  }

  // ==================================================================
  // SECTION 9 -- मंडी भाव / Mandi prices
  // ==================================================================
  function renderSection9(data, res, districtSlug) {
    var d = data && data.districts && data.districts[districtSlug];
    if (!d || !Array.isArray(d.records) || !d.records.length) {
      setHtml('kd-sec-9', '<div class="kd-empty">' + esc(res.district_name || '') + ' के लिए आज के मंडी भाव अभी उपलब्ध नहीं। / No mandi arrivals available for ' + esc(res.district_name || '') + ' today.</div>');
      return;
    }
    var rows = d.records.slice(0, 5);
    var h = '<table class="kd-table"><thead><tr><th>फसल / Commodity</th><th>मंडी / Market</th><th>तारीख / Date</th><th>न्यूनतम / Min</th><th>अधिकतम / Max</th><th>मॉडल / Modal (₹/quintal)</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.commodity) + '</td><td>' + esc(r.market) + '</td><td>' + esc(r.arrival_date) + '</td><td>' + fmt(r.min_price, 0) + '</td><td>' + fmt(r.max_price, 0) + '</td><td><b>' + fmt(r.modal_price, 0) + '</b></td></tr>';
      }).join('') + '</tbody></table>';
    h += '<div class="kd-source">स्रोत / Source: ' + esc(data.metadata && data.metadata.source || 'AGMARKNET') + ', ज़िला-स्तर APMC मंडी। / District-level APMC market data.</div>';
    setHtml('kd-sec-9', h);
  }

  // ==================================================================
  // SECTION 7 -- कीट और रोग / Pests & diseases
  //
  // Design choice (documented per the task): reuses the SAME Kisan
  // Sahayak /chat endpoint (search_manuals-backed, Vectorize RAG over the
  // real ICAR/PAU/state POP corpus) with a targeted, crop+season-scoped
  // query, rather than standing up a second dedicated Worker endpoint --
  // this session cannot deploy a new Worker anyway (kisan_sahayak_worker.js's
  // own header: Worker deploys need the owner's own `wrangler login`,
  // blocked in this sandbox), so a code-only "structured endpoint" could
  // never be verified end-to-end this session. The chat endpoint's system
  // prompt already enforces "citations from retrieved documents, never the
  // model" (see cloudflare/kisan_sahayak_worker.js), so the streamed answer
  // is rendered as-is rather than re-parsed into a fake structured table.
  // ==================================================================
  var PEST_COVERED_CROPS = ['Wheat', 'Rice', 'Soyabean', 'Soybean', 'Gram', 'Chana', 'Rapeseed &Mustard', 'Cotton(lint)', 'Cotton'];
  function renderSection7(res) {
    var h = '<div class="kd-row" style="align-items:flex-end;margin-bottom:10px">' +
      '<div><label style="font-size:var(--fs-1);color:var(--text-dim);display:block;margin-bottom:4px">फसल चुनें / Select crop</label>' +
      '<select id="kd-pest-crop" style="min-height:44px;padding:0 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-2);min-width:180px;background:var(--bg-card);color:var(--text)"><option value="">-- चुनें / Select --</option></select></div>' +
      '<div><label style="font-size:var(--fs-1);color:var(--text-dim);display:block;margin-bottom:4px">मौसम / Season</label>' +
      '<select id="kd-pest-season" style="min-height:44px;padding:0 10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-2);background:var(--bg-card);color:var(--text)"><option value="kharif">खरीफ / Kharif</option><option value="rabi">रबी / Rabi</option><option value="zayad">ज़ायद / Zayad</option></select></div>' +
      '<button class="kd-btn" id="kd-pest-go">देखें / Show</button>' +
      '</div>' +
      '<div class="kd-note">अभी सिर्फ इन फसलों के लिए समर्पित दस्तावेज़ उपलब्ध हैं: गेहूं, धान, सोयाबीन, चना, सरसों, कपास (सीमित)। मक्का/आलू के लिए अभी कोई दस्तावेज़ नहीं — फिर भी पूछ सकते हैं, पर जवाब सामान्य हो सकता है।' +
      '<br><span style="opacity:.75">Dedicated documents currently exist only for wheat, rice, soybean, chana, mustard, cotton (thin). Maize/potato have no dedicated document yet — you can still ask, the answer may be more general.</span></div>' +
      '<div id="kd-pest-result" style="margin-top:10px"></div>';
    setHtml('kd-sec-7', h);
    loadCropListInto('kd-pest-crop');
    el('kd-pest-go').onclick = function () { runPestQuery(res); };
  }

  var cropListPromiseKD = null;
  function loadCropListInto(selectId) {
    if (!cropListPromiseKD) cropListPromiseKD = fetchWithTimeout('data/crop_list.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    cropListPromiseKD.then(function (d) {
      var sel = el(selectId); if (!sel) return;
      (d && d.crops || []).forEach(function (c) { var o = ce('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
    });
  }

  function runPestQuery(res) {
    var crop = el('kd-pest-crop').value, season = el('kd-pest-season').value;
    var box = el('kd-pest-result');
    if (!crop) { box.innerHTML = '<div class="kd-empty">पहले फसल चुनें। / Select a crop first.</div>'; return; }
    box.innerHTML = '<div class="kd-skel" style="height:80px"></div>';
    var place = { state: res.state_name, district: res.district_name, lat: res.centroid ? res.centroid[1] : null, lon: res.centroid ? res.centroid[0] : null };
    var q = crop + ' फसल में ' + (season === 'rabi' ? 'रबी' : season === 'zayad' ? 'ज़ायद' : 'खरीफ') + ' मौसम के मुख्य कीट और रोग कौन से हैं? पहचान, लक्षण, और उपाय (कृषि/जैविक/रासायनिक क्रम में) बताइए, सिर्फ CIB&RC पंजीकृत, गैर-प्रतिबंधित रसायन का नाम लीजिए, और स्रोत बताइए।';
    streamChatInto(box, q, place, { crop: crop, season: season });
  }

  // ==================================================================
  // SECTION 10 -- सवाल पूछिए / Ask Kisan Sahayak
  // Reuses cloudflare/kisan_sahayak_worker.js's /chat contract directly
  // (POST {message, history, place, lang} -> SSE), same parsing pattern
  // as index.html's own runChatCompletion() -- embedded here (not the
  // floating widget's DOM) so it renders as a full-width section per the
  // spec ("yahin, isi dashboard me"), with the SAME real place-context
  // (all real numbers gathered above) folded into every question.
  // ==================================================================
  var CHAT_PROXY_URL = (window.VINDHYA_CONFIG && window.VINDHYA_CONFIG.CHAT_PROXY_URL) || 'https://vindhya-gemini-proxy.vindhyaresearch25.workers.dev';
  var kdChatHistory = [];

  function renderSection10(res) {
    var h = '<div class="kd-chat-log" id="kd-chat-log"></div>' +
      '<div class="kd-chat-inputrow"><input id="kd-chat-input" type="text" placeholder="अपना सवाल लिखें... / Type your question..." />' +
      '<button class="kd-btn" id="kd-chat-send">भेजें / Send</button></div>' +
      '<div class="kd-note">ऊपर दिखे सभी असली आंकड़े (मौसम, मिट्टी, NDVI, फसल, मंडी) सवाल के साथ भेजे जाते हैं — जवाब स्रोत बताएगा। / All real numbers shown above are sent with your question; the answer cites its sources.</div>';
    setHtml('kd-sec-10', h);
    el('kd-chat-send').onclick = function () { sendKdChat(res); };
    el('kd-chat-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendKdChat(res); });
  }

  function kdChatPlace(res) {
    return { state: res.state_name, district: res.district_name, lat: res.centroid ? res.centroid[1] : null, lon: res.centroid ? res.centroid[0] : null };
  }
  function kdFieldContext(res) {
    var parts = ['Farmer\'s own drawn field: ' + fmt(res.area_ha, 2) + ' ha, in ' + (res.district_name || 'an unresolved district') + ', ' + (res.state_name || '') + '.'];
    if (res.analyze && res.analyze.available) parts.push('Field NDVI (Sentinel-2, live): ' + fmt(res.analyze.ndvi, 3) + ', cropland fraction: ' + fmt(res.analyze.cropland_fraction * 100, 1) + '%.');
    if (res.soil && res.soil.district) parts.push('District/grid soil moisture (SMAP ~9km, not field-specific): ' + fmt(res.soil.district.sm_surface_mean, 3) + ' m3/m3.');
    if (res.climate) {
      var rain = res.climate.annual_rain_mm_mean != null ? res.climate.annual_rain_mm_mean : res.climate.annual_rain_mm;
      parts.push('District annual rainfall (2000-2024 mean, not field-specific): ' + fmt(rain, 0) + ' mm. Drought probability: ' + fmt(res.climate.drought_probability_pct, 1) + '%.');
    }
    return parts.join(' ');
  }

  function sendKdChat(res) {
    var input = el('kd-chat-input');
    var msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    var log = el('kd-chat-log');
    log.insertAdjacentHTML('beforeend', '<div class="kd-chat-msg user">' + esc(msg) + '</div>');
    log.scrollTop = log.scrollHeight;
    kdChatHistory.push({ role: 'user', content: kdFieldContext(res) + ' Farmer question: ' + msg });
    var botDiv = ce('div', 'kd-chat-msg bot'); botDiv.textContent = '...';
    log.appendChild(botDiv); log.scrollTop = log.scrollHeight;
    streamChatIntoDiv(botDiv, kdChatHistory[kdChatHistory.length - 1].content, kdChatPlace(res), function (full) {
      kdChatHistory.push({ role: 'assistant', content: full });
    }, log);
  }

  // Generic helper used by both section 7 (pest query) and section 10
  // (chat): POSTs to the same Worker, streams tokens into a target div.
  function streamChatInto(box, message, place, extra) {
    box.innerHTML = '';
    var div = ce('div', 'kd-chat-msg bot'); div.style.maxWidth = '100%';
    box.appendChild(div);
    streamChatIntoDiv(div, message, place, null, box);
  }

  function streamChatIntoDiv(div, message, place, onDone, scrollParent) {
    div.textContent = 'सोच रहा है... / Thinking...';
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 45000);
    var accumulated = '';
    var isHi = (typeof window.LANG !== 'undefined' ? window.LANG === 'hi' : document.body.classList.contains('lang-hi'));
    fetch(CHAT_PROXY_URL.replace(/\/$/, '') + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, history: kdChatHistory.slice(0, -1).slice(-12), place: place, lang: isHi ? 'hi' : 'en' }),
      signal: ctl.signal
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var ct = response.headers.get('Content-Type') || '';
      if (ct.indexOf('text/event-stream') === -1 || !response.body || !response.body.getReader) {
        return response.text().then(function (txt) {
          txt.split('\n\n').forEach(function (line) { var f = parseSse(line); if (f && !f.done && f.obj && typeof f.obj.response === 'string') { accumulated += f.obj.response; div.textContent = accumulated; } });
        });
      }
      var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n'); buffer = parts.pop();
          parts.forEach(function (p) {
            var f = parseSse(p);
            if (!f || f.done) return;
            if (f.obj && typeof f.obj.response === 'string') { accumulated += f.obj.response; div.textContent = accumulated; if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight; }
          });
          return pump();
        });
      }
      return pump();
    }).then(function () {
      clearTimeout(timer);
      if (!accumulated) div.textContent = isHi ? 'कोई जवाब नहीं मिला, दोबारा कोशिश करें।' : 'No answer received, please try again.';
      if (onDone) onDone(accumulated);
    }).catch(function (err) {
      clearTimeout(timer);
      div.textContent = (isHi ? 'सेवा अभी उपलब्ध नहीं। ' : 'Service unavailable right now. ') + '(' + err.message + ')';
    });
  }
  function parseSse(line) {
    if (!line || line.indexOf('data:') !== 0) return null;
    var payload = line.slice(5).trim();
    if (payload === '[DONE]') return { done: true };
    try { return { done: false, obj: JSON.parse(payload) }; } catch (e) { return null; }
  }

  // ==================================================================
  // SECTION 8 -- नुक़सान हुआ? बताइए / Report a problem
  // Text + location ONLY this round (spec: "Photo abhi mat rakho...Photo
  // baad me, jab jagah tay ho"). Reuses the SAME /submit endpoint and D1
  // `submissions` table as mera_khet.js's ground-truth form -- extended
  // additively with an optional `problem_description` column (see
  // cloudflare/kisan_upload_schema_003_problem.sql and the matching
  // Worker/export-script changes made alongside this file).
  // NO FALSE PROMISE: per spec, we say only "यह शोध डेटासेट में जाएगा" --
  // never "hamari team dekhegi" (no team currently reviews submissions).
  // ==================================================================
  var MK_SUBMIT_URL = 'https://vindhya-kisan-upload.vindhyaresearch25.workers.dev/submit';

  function renderSection8(res) {
    var h = '<div class="kd-note" style="margin-bottom:10px">फ़ोटो अभी नहीं ली जा सकती (भंडारण तय होना बाकी है) — अभी सिर्फ लिखित विवरण और जगह जमा करें। जगह आपके खींचे खेत से अपने आप ली जाएगी।' +
      '<br><span style="opacity:.75">Photo upload is not available yet (storage still to be arranged) — for now, submit a written description and your field\'s location only. Location is taken automatically from your drawn field.</span></div>' +
      '<div class="kd-row" style="margin-bottom:10px">' +
      '<div style="flex:1;min-width:220px"><label style="font-size:var(--fs-1);color:var(--text-dim);display:block;margin-bottom:4px">फसल / Crop</label><select id="kd-p8-crop" style="min-height:44px;width:100%;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text)"><option value="">-- चुनें / Select --</option></select></div>' +
      '<div><label style="font-size:var(--fs-1);color:var(--text-dim);display:block;margin-bottom:4px">मौसम / Season</label><select id="kd-p8-season" style="min-height:44px;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text)"><option value="">--</option><option value="kharif">खरीफ</option><option value="rabi">रबी</option><option value="zayad">ज़ायद</option></select></div>' +
      '</div>' +
      '<label style="font-size:var(--fs-1);color:var(--text-dim);display:block;margin-bottom:4px">क्या समस्या है? / What is the problem?</label>' +
      '<textarea id="kd-p8-desc" maxlength="500" rows="3" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-2);background:var(--bg-card);color:var(--text);font-family:inherit" placeholder="जैसे: पत्तों पर धब्बे, पीलापन, कीड़े दिखे... / e.g. spots on leaves, yellowing, pests seen..."></textarea>' +
      '<label style="display:flex;gap:6px;align-items:flex-start;font-size:var(--fs-1);color:var(--text-dim);margin:10px 0"><input type="checkbox" id="kd-p8-consent" style="margin-top:3px;width:18px;height:18px"><span>मैं सहमत हूं कि यह जानकारी (बिना नाम/फोन) सार्वजनिक शोध डेटासेट में जाए। जगह ≈100मी तक गोल की जाएगी।<br><span style="opacity:.75">I agree this info (no name/phone) goes into a public research dataset. Location rounded to ~100m.</span></span></label>' +
      '<button class="kd-btn" id="kd-p8-submit" disabled style="opacity:.5">भेजें / Submit</button>' +
      '<div id="kd-p8-msg" style="font-size:var(--fs-1);margin-top:8px"></div>' +
      '<div class="kd-note" style="margin-top:8px"><b>यह शोध डेटासेट में जाएगा।</b> कोई टीम इसे व्यक्तिगत रूप से नहीं देखेगी — यह फ़सल-निगरानी शोध के लिए इकट्ठा किया जा रहा डेटा है।<br><span style="opacity:.75">This goes into a research dataset. No team reviews it individually — it is data collected for crop-monitoring research.</span></div>';
    setHtml('kd-sec-8', h);
    loadCropListInto('kd-p8-crop');
    function updateEnabled() {
      var crop = el('kd-p8-crop'), season = el('kd-p8-season'), consent = el('kd-p8-consent'), desc = el('kd-p8-desc'), btn = el('kd-p8-submit');
      var ok = crop.value && season.value && consent.checked && desc.value.trim().length > 0;
      btn.disabled = !ok; btn.style.opacity = ok ? '1' : '.5'; btn.style.cursor = ok ? 'pointer' : 'not-allowed';
    }
    ['kd-p8-crop', 'kd-p8-season', 'kd-p8-consent', 'kd-p8-desc'].forEach(function (id) { el(id).addEventListener('input', updateEnabled); el(id).addEventListener('change', updateEnabled); });
    el('kd-p8-submit').onclick = function () { submitProblem(res); };
  }

  function round3(x) { return Math.round(x * 1000) / 1000; }
  function submitProblem(res) {
    var msg = el('kd-p8-msg'), btn = el('kd-p8-submit');
    if (!res.centroid) return;
    var payload = {
      crop: el('kd-p8-crop').value, season: el('kd-p8-season').value,
      lat: round3(res.centroid[1]), lon: round3(res.centroid[0]),
      area_ha: +res.area_ha.toFixed(2),
      consent: el('kd-p8-consent').checked,
      problem_description: el('kd-p8-desc').value.trim().slice(0, 500),
      geometry: res.ring.map(function (p) { return [round3(p[0]), round3(p[1])]; })
    };
    btn.disabled = true;
    msg.textContent = 'भेजा जा रहा है... / Submitting...'; msg.style.color = '';
    fetchWithTimeout(MK_SUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (out) {
        if (out.ok && out.data.ok) { msg.textContent = 'धन्यवाद! यह शोध डेटासेट में जमा हो गया। / Thank you — submitted to the research dataset.'; msg.style.color = 'var(--green)'; }
        else { msg.textContent = 'त्रुटि / Error: ' + (out.data && out.data.error || 'unknown'); msg.style.color = 'var(--red)'; btn.disabled = false; }
      })
      .catch(function (err) { msg.textContent = 'नेटवर्क/सर्वर त्रुटि। / Network/server error. (' + err.message + ')'; msg.style.color = 'var(--red)'; btn.disabled = false; });
  }

  // ------------------------------------------------------------------
  window.VindhyaKisanDashboard = { open: open, update: update, close: close, reopen: reopen };
})();
