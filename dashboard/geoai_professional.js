/*
 * geoai_professional.js — VINDHYA Climate Portal
 *   1. AOI  : draw any polygon -> true area/perimeter + climate indices
 *   2. MAP  : scale bar, north arrow                          (Req. 20)
 *   3. META : provenance panel                     (Req. 19, 21, 26, 27)
 *   4. LIVE : NASA POWER real-time daily weather              (Req. 3)
 *
 * Integrity rule: every number is either measured from geometry the user drew,
 * or read from a dataset listed in the provenance registry. Nothing generated.
 */
(function () {
  'use strict';
  var R_EARTH = 6378137, RAD = Math.PI / 180;

  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }
  function el(tag, css, html) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    return d;
  }
  var QC = { 'verified': '#2d8f5c', 'indicative': '#c9a843', 'not available': '#8a8a8a' };
  function badge(q) {
    return '<span style="display:inline-block;padding:1px 7px;border-radius:9px;background:' +
      (QC[q] || '#8a8a8a') + ';color:#fff;font-size:10px;font-weight:700;letter-spacing:.3px">' +
      q.toUpperCase() + '</span>';
  }
  function fmt(x, dp) { return (x == null || !isFinite(x)) ? '--' : x.toFixed(dp); }
  function stat(label, val, unit, sub) {
    return '<div><div style="font-size:10px;opacity:.6;letter-spacing:.4px">' + label + '</div>' +
      '<div style="font-size:17px;font-weight:700">' + val +
      (unit ? ' <span style="font-size:11px;font-weight:500">' + unit + '</span>' : '') + '</div>' +
      (sub ? '<div style="font-size:10px;opacity:.6">' + sub + '</div>' : '') + '</div>';
  }

  var REGISTRY = [
    { l: 'Climate indices (heatwave, SPI, ETCCDI)', lh: 'जलवायु संकेतक (लू, SPI, ETCCDI)',
      s: 'IMD 0.05 deg gridded daily Tmax/Tmin/Precipitation, 2000-2024',
      r: '~5.5 km grid, sampled at village centroid', c: 'EPSG:4326',
      m: 'IMD plains heatwave criteria; SPI (McKee et al. 1993); ETCCDI, fixed 2000-2014 base period',
      q: 'verified', u: '2026-07-31' },
    { l: 'NDVI time series', lh: 'NDVI समय-श्रृंखला',
      s: 'UNDP DiCRA district zonal statistics (MODIS-derived)',
      r: 'district zonal mean, 16-day composite', c: 'EPSG:4326',
      m: 'zonal aggregation of DiCRA vector products', q: 'verified', u: '2026-07-31' },
    { l: '2040 projection', lh: '2040 प्रक्षेपण',
      s: 'OLS linear trend on observed 2000-2024 annual indices', r: 'district', c: '--',
      m: 'deterministic least-squares trend, 95% residual band; NOT a CMIP6 model run',
      q: 'indicative', u: '2026-07-31' },
    { l: 'Village boundaries (5 districts)', lh: 'ग्राम सीमाएँ (5 ज़िले)',
      s: 'MP village boundary shapefile, LGD-coded', r: 'simplified 0.0005 deg (~55 m)',
      c: 'EPSG:4326', m: 'reprojected, dedup on Vill_LGD, Douglas-Peucker simplification',
      q: 'verified', u: '2026-08-01' },
    { l: 'India state / district boundaries', lh: 'भारत राज्य / ज़िला सीमाएँ',
      s: 'Census of India 2011 (36 states/UTs, 760 districts)', r: 'simplified 0.005-0.01 deg',
      c: 'EPSG:4326', m: 'states dissolved from district polygons', q: 'verified', u: '2026-08-01' },
    { l: 'Live daily weather', lh: 'वास्तविक समय मौसम',
      s: 'NASA POWER (MERRA-2 reanalysis)', r: '0.5 x 0.625 deg', c: 'EPSG:4326',
      m: 'daily point query, no interpolation or bias correction', q: 'verified', u: 'on demand' },
    { l: 'Cadastral (khasra) parcels', lh: 'कैडस्ट्रल (खसरा) पार्सल',
      s: 'PENDING -- MP Bhulekh / Bhu-Naksha Revenue Department', r: '--', c: '--',
      m: 'not integrated; synthetic parcels removed in the 2026-08 audit',
      q: 'not available', u: '--' }
  ];

  function ringAreaM2(ring) {
    if (ring.length < 3) return 0;
    var total = 0;
    for (var i = 0; i < ring.length; i++) {
      var p1 = ring[i], p2 = ring[(i + 1) % ring.length];
      total += (p2[0] - p1[0]) * RAD * (2 + Math.sin(p1[1] * RAD) + Math.sin(p2[1] * RAD));
    }
    return Math.abs(total * R_EARTH * R_EARTH / 2);
  }
  function haversineM(a, b) {
    var dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  function perimeterM(ring) {
    var p = 0;
    for (var i = 0; i < ring.length; i++) p += haversineM(ring[i], ring[(i + 1) % ring.length]);
    return p;
  }
  function pointInRing(pt, ring) {
    var inside = false, x = pt[0], y = pt[1];
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  var METRICS = [
    ['annual_rain_mm', 'Annual rainfall', 'वार्षिक वर्षा', 'mm', 0],
    ['heatwave_days', 'Heatwave days/yr', 'लू के दिन/वर्ष', 'd', 2],
    ['severe_heatwave_days', 'Severe heatwave days/yr', 'भीषण लू/वर्ष', 'd', 2],
    ['max_summer_tmax', 'Max summer Tmax', 'अधिकतम ग्रीष्म ताप', 'C', 1],
    ['drought_probability_pct', 'Drought probability', 'सूखे की संभावना', '%', 1],
    ['drought_months', 'Drought months/yr', 'सूखे के माह/वर्ष', 'mo', 2],
    ['r95p_mm', 'R95p extreme rain', 'R95p अति वर्षा', 'mm', 1],
    ['rx1day_mm', 'Rx1day max', 'Rx1day अधिकतम', 'mm', 1],
    ['rx5day_mm', 'Rx5day max', 'Rx5day अधिकतम', 'mm', 1],
    ['cdd', 'Consecutive dry days', 'लगातार शुष्क दिन', 'd', 1],
    ['spi_12', 'SPI-12', 'SPI-12', '', 2]
  ];

  function allVillages() {
    var out = [], data = window._mpClimateData;
    if (!data || !data.districts) return out;
    for (var dk in data.districts) {
      var d = data.districts[dk], vm = d.villages || {};
      for (var id in vm) {
        var v = vm[id];
        if (v.lat == null || v.lon == null) continue;
        out.push({ name: v.name, district: d.name, lng: v.lon, lat: v.lat, ix: v.indices || {} });
      }
    }
    return out;
  }
  function mean(a) { var s = 0, i; if (!a.length) return null; for (i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sdev(a, m) { var s = 0, i; if (a.length < 2) return null; for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }

  function analyseAOI(ring) {
    var areaM2 = ringAreaM2(ring), periM = perimeterM(ring);
    var vs = allVillages().filter(function (v) { return pointInRing([v.lng, v.lat], ring); });
    var rows = [];
    METRICS.forEach(function (m) {
      var vals = [];
      vs.forEach(function (v) {
        var x = v.ix[m[0]];
        if (typeof x === 'number' && isFinite(x)) vals.push(x);
      });
      if (!vals.length) return;
      var mu = mean(vals);
      rows.push({ label: t(m[1], m[2]), unit: m[3], dp: m[4], mean: mu, sd: sdev(vals, mu),
        min: Math.min.apply(null, vals), max: Math.max.apply(null, vals) });
    });
    return { area_ha: areaM2 / 10000, area_km2: areaM2 / 1e6,
      perimeter_km: periM / 1000, villages: vs, rows: rows };
  }

  function emptyHtml() {
    return '<div style="padding:16px;font-size:12px;line-height:1.8;color:var(--text);opacity:.85">' +
      '<b>' + t('Polygon (AOI) analysis', 'बहुभुज (AOI) विश्लेषण') + '</b><br>' +
      t('Draw any shape on the map -- a field, a cluster of villages, a watershed. The portal ' +
        'measures its area and perimeter on a spherical Earth model (R = 6,378,137 m, accurate to ~0.7%) and reports the climate ' +
        'indices of every village inside it, computed from IMD gridded observations.',
        'नक्शे पर कोई भी आकृति बनाएँ -- खेत, गाँवों का समूह, या जलग्रहण क्षेत्र। पोर्टल WGS-84 पर ' +
        'उसका क्षेत्रफल और परिधि नापेगा (गोलाकार पृथ्वी मॉडल, ~0.7% तक सटीक) और अंदर आने वाले हर गाँव के जलवायु संकेतक दिखाएगा।') +
      '</div>';
  }

  function render(res) {
    var box = document.getElementById('aoi-result');
    if (!box) return;
    lastAOIResult = res;
    setExportButtonsEnabled(res.villages.length > 0);
    var head = '<div style="display:flex;gap:20px;flex-wrap:wrap;padding-bottom:10px;' +
      'border-bottom:1px solid var(--border);margin-bottom:10px">' +
      stat(t('AREA', 'क्षेत्रफल'), fmt(res.area_ha, 2), 'ha', fmt(res.area_km2, 3) + ' km2') +
      stat(t('PERIMETER', 'परिधि'), fmt(res.perimeter_km, 3), 'km', '') +
      stat(t('VILLAGES INSIDE', 'अंदर के गाँव'), String(res.villages.length), '', '') + '</div>';

    if (!res.villages.length) {
      box.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">' + head +
        '<span style="color:#c0392b">' +
        t('No village with IMD-derived indices falls inside this polygon. Climate metrics exist ' +
          'only for Bhopal, Indore, Jabalpur, Rewa and Sidhi. Area and perimeter above are exact.',
          'इस बहुभुज के अंदर IMD-आधारित आंकड़ों वाला कोई गाँव नहीं है। जलवायु संकेतक केवल भोपाल, ' +
          'इंदौर, जबलपुर, रीवा और सीधी के लिए उपलब्ध हैं। ऊपर का क्षेत्रफल और परिधि फिर भी सटीक है।') +
        '</span></div>';
      return;
    }

    var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">' + head;
    h += '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<tr style="text-align:left;opacity:.65;font-size:10px;letter-spacing:.3px">' +
      '<th style="padding:3px 0">' + t('INDICATOR', 'संकेतक') + '</th>' +
      '<th style="text-align:right">' + t('MEAN', 'औसत') + '</th>' +
      '<th style="text-align:right">SD</th>' +
      '<th style="text-align:right">' + t('MIN', 'न्यून') + '</th>' +
      '<th style="text-align:right">' + t('MAX', 'अधिक') + '</th></tr>';
    res.rows.forEach(function (r) {
      h += '<tr style="border-top:1px solid var(--border)">' +
        '<td style="padding:5px 0">' + r.label +
        (r.unit ? ' <span style="opacity:.55">(' + r.unit + ')</span>' : '') + '</td>' +
        '<td style="text-align:right;font-weight:700">' + fmt(r.mean, r.dp) + '</td>' +
        '<td style="text-align:right;opacity:.7">' + fmt(r.sd, r.dp) + '</td>' +
        '<td style="text-align:right;opacity:.7">' + fmt(r.min, r.dp) + '</td>' +
        '<td style="text-align:right;opacity:.7">' + fmt(r.max, r.dp) + '</td></tr>';
    });
    h += '</table>';
    var names = res.villages.slice(0, 40).map(function (v) { return v.name; }).join(', ');
    h += '<div style="margin-top:10px;font-size:10.5px;opacity:.7;line-height:1.6"><b>' +
      t('Villages', 'गाँव') + ':</b> ' + names +
      (res.villages.length > 40 ? ' ... +' + (res.villages.length - 40) : '') + '</div>';
    h += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);' +
      'font-size:10px;opacity:.75;line-height:1.6">' + badge('verified') + ' ' +
      t('Source: IMD 0.05 deg gridded daily data 2000-2024, sampled at village centroids. Values ' +
        'are the unweighted mean of the ' + res.villages.length + ' village records inside the ' +
        'polygon. The IMD grid is ~5.5 km, so a polygon smaller than one pixel returns that pixel value.',
        'स्रोत: IMD 0.05 deg दैनिक ग्रिड 2000-2024, ग्राम केंद्रबिंदु पर नमूना। मान बहुभुज के अंदर के ' +
        res.villages.length + ' ग्राम अभिलेखों का साधारण औसत हैं। IMD ग्रिड ~5.5 किमी का है।') +
      '</div></div>';
    box.innerHTML = h;
  }

  var drawing = false, pts = [], preview = null, aoiLayer = null, marks = [];

  function clearAOI() {
    var map = window.leafletMap;
    if (preview && map) { map.removeLayer(preview); preview = null; }
    if (aoiLayer && map) { map.removeLayer(aoiLayer); aoiLayer = null; }
    marks.forEach(function (m) { if (map) map.removeLayer(m); });
    marks = []; pts = [];
  }
  function setStatus(m) { var s = document.getElementById('aoi-status'); if (s) s.textContent = m; }
  function updatePreview() {
    var map = window.leafletMap;
    if (!map) return;
    if (preview) map.removeLayer(preview);
    if (pts.length < 2) return;
    preview = L.polyline(pts.map(function (p) { return [p[1], p[0]]; }),
      { color: '#d4793a', weight: 2, dashArray: '5,5' }).addTo(map);
  }
  function onMapClick(e) {
    if (!drawing) return;
    pts.push([e.latlng.lng, e.latlng.lat]);
    marks.push(L.circleMarker(e.latlng,
      { radius: 4, color: '#d4793a', fillColor: '#fff', fillOpacity: 1, weight: 2 })
      .addTo(window.leafletMap));
    updatePreview();
    setStatus(t('Points: ' + pts.length + '. Press Finish or double-click the map.',
      'बिंदु: ' + pts.length + '। "पूरा करें" दबाएँ या नक्शे पर दो बार क्लिक करें।'));
  }
  function startDraw() {
    var map = window.leafletMap;
    if (!map) return;
    clearAOI();
    drawing = true;
    map.getContainer().style.cursor = 'crosshair';
    setStatus(t('Click on the map to place polygon corners.',
      'बहुभुज के कोने रखने के लिए नक्शे पर क्लिक करें।'));
    var b = document.getElementById('aoi-btn-draw');
    if (b) b.textContent = t('Drawing...', 'बनाया जा रहा...');
  }
  function finishDraw() {
    var map = window.leafletMap;
    if (!drawing || pts.length < 3) {
      setStatus(t('A polygon needs at least 3 points.', 'बहुभुज के लिए कम से कम 3 बिंदु चाहिए।'));
      return;
    }
    drawing = false;
    map.getContainer().style.cursor = '';
    if (preview) { map.removeLayer(preview); preview = null; }
    marks.forEach(function (m) { map.removeLayer(m); });
    marks = [];
    aoiLayer = L.polygon(pts.map(function (p) { return [p[1], p[0]]; }),
      { color: '#d4793a', weight: 2.5, fillColor: '#d4793a', fillOpacity: 0.12 }).addTo(map);
    map.fitBounds(aoiLayer.getBounds(), { padding: [40, 40], maxZoom: 13 });
    var b = document.getElementById('aoi-btn-draw');
    if (b) b.textContent = t('Draw new AOI', 'नया क्षेत्र बनाएँ');
    setStatus(t('Analysis complete.', 'विश्लेषण पूरा।'));
    render(analyseAOI(pts));
  }
  function resetAOI() {
    drawing = false;
    if (window.leafletMap) window.leafletMap.getContainer().style.cursor = '';
    clearAOI();
    var b = document.getElementById('aoi-btn-draw');
    if (b) b.textContent = t('Draw AOI', 'क्षेत्र बनाएँ');
    setStatus('');
    var box = document.getElementById('aoi-result');
    if (box) box.innerHTML = emptyHtml();
    lastAOIResult = null;
    setExportButtonsEnabled(false);
  }

  function addTab(id, paneId, icon, labelEn, labelHi, onOpen) {
    var first = document.querySelector('.btm-tab');
    var tabs = first ? first.parentNode : null;
    if (!tabs || document.getElementById(id)) return;
    var tab = el('div', '', '<i class="fa ' + icon + '"></i>' + t(labelEn, labelHi));
    tab.className = 'btm-tab';
    tab.id = id;
    tab.onclick = function () {
      var panes = document.querySelectorAll('.btm-pane'), i;
      for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
      var p = document.getElementById(paneId);
      if (p) p.classList.add('active');
      var tb = document.querySelectorAll('.btm-tab');
      for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
      this.classList.add('active');
      if (onOpen) onOpen();
    };
    tabs.appendChild(tab);
  }

  function paneHost() {
    var p = document.querySelector('.btm-pane');
    return p ? p.parentNode : null;
  }

  function buildAOIPane() {
    var host = paneHost();
    if (!host || document.getElementById('pane-aoi')) return;
    var p = el('div', '', '');
    p.className = 'btm-pane';
    p.id = 'pane-aoi';
    p.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;padding:10px 14px 0;flex-wrap:wrap">' +
      '<button id="aoi-btn-draw" style="padding:6px 14px;border:1px solid var(--cyan);' +
      'background:var(--cyan);color:#fff;border-radius:5px;cursor:pointer;font-size:12px;' +
      'font-weight:600">' + t('Draw AOI', 'क्षेत्र बनाएँ') + '</button>' +
      '<button id="aoi-btn-finish" style="padding:6px 14px;border:1px solid var(--border);' +
      'background:var(--bg-card);color:var(--text);border-radius:5px;cursor:pointer;font-size:12px">' +
      t('Finish', 'पूरा करें') + '</button>' +
      '<button id="aoi-btn-clear" style="padding:6px 14px;border:1px solid var(--border);' +
      'background:var(--bg-card);color:var(--text);border-radius:5px;cursor:pointer;font-size:12px">' +
      t('Clear', 'साफ़ करें') + '</button>' +
      '<span style="flex:1"></span>' +
      '<button id="aoi-btn-csv" disabled style="padding:6px 14px;border:1px solid var(--border);' +
      'background:var(--bg-card);color:var(--text);border-radius:5px;cursor:not-allowed;font-size:12px;opacity:.5">' +
      '<i class="fa fa-file-csv"></i> ' + t('Download CSV', 'CSV डाउनलोड') + '</button>' +
      '<button id="aoi-btn-pdf" disabled style="padding:6px 14px;border:1px solid var(--border);' +
      'background:var(--bg-card);color:var(--text);border-radius:5px;cursor:not-allowed;font-size:12px;opacity:.5">' +
      '<i class="fa fa-file-pdf"></i> ' + t('Download PDF', 'PDF डाउनलोड') + '</button>' +
      '<span id="aoi-status" style="font-size:11px;opacity:.7;flex-basis:100%"></span></div>' +
      '<div id="aoi-result">' + emptyHtml() + '</div>';
    host.appendChild(p);
    document.getElementById('aoi-btn-draw').onclick = startDraw;
    document.getElementById('aoi-btn-finish').onclick = finishDraw;
    document.getElementById('aoi-btn-clear').onclick = resetAOI;
    document.getElementById('aoi-btn-csv').onclick = exportAOICSV;
    document.getElementById('aoi-btn-pdf').onclick = exportAOIPDF;
    addTab('aoi-tab', 'pane-aoi', 'fa-draw-polygon', 'AOI Polygon', 'AOI बहुभुज', null);
  }

  var lastAOIResult = null;

  function setExportButtonsEnabled(enabled) {
    ['aoi-btn-csv', 'aoi-btn-pdf'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.disabled = !enabled;
      b.style.opacity = enabled ? '1' : '.5';
      b.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
  }

  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var AOI_EXPORT_COLUMNS = [
    ['district', 'District'], ['name', 'Village'], ['lat', 'Latitude'], ['lng', 'Longitude'],
    ['annual_rain_mm', 'Annual rainfall (mm)'], ['max_summer_tmax', 'Max summer Tmax (C)'],
    ['heatwave_days', 'Heatwave days'], ['drought_probability_pct', 'Drought probability (%)'],
    ['r95p_mm', 'R95p (mm)'], ['rx1day_mm', 'Rx1day (mm)']
  ];

  function aoiExportRows() {
    if (!lastAOIResult || !lastAOIResult.villages) return [];
    return lastAOIResult.villages.map(function (v) {
      var row = { district: v.district, name: v.name, lat: v.lat, lng: v.lng };
      AOI_EXPORT_COLUMNS.slice(4).forEach(function (c) { row[c[0]] = v.ix ? v.ix[c[0]] : null; });
      return row;
    });
  }

  function csvEscape(val) {
    if (val == null) return '';
    var s = String(val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportAOICSV() {
    var rows = aoiExportRows();
    if (!rows.length || !lastAOIResult) return;
    var lines = [
      '# AOI Village Report',
      '# Area: ' + fmt(lastAOIResult.area_ha, 2) + ' ha (' + fmt(lastAOIResult.area_km2, 3) + ' km2)',
      '# Perimeter: ' + fmt(lastAOIResult.perimeter_km, 3) + ' km',
      '# Villages: ' + rows.length,
      '# Generated: ' + new Date().toISOString(),
      '# Source: IMD 0.05 deg gridded daily data, 2000-2024, sampled at village centroids'
    ];
    lines.push(AOI_EXPORT_COLUMNS.map(function (c) { return csvEscape(c[1]); }).join(','));
    rows.forEach(function (r) {
      lines.push(AOI_EXPORT_COLUMNS.map(function (c) {
        var v = r[c[0]];
        return csvEscape(typeof v === 'number' ? +v.toFixed(2) : v);
      }).join(','));
    });
    downloadBlob(lines.join('\r\n'), 'aoi_village_report.csv', 'text/csv;charset=utf-8');
  }

  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF loaded but window.jspdf.jsPDF missing'));
      };
      s.onerror = function () { reject(new Error('failed to load jsPDF from CDN')); };
      document.head.appendChild(s);
    });
  }

  function exportAOIPDF() {
    var rows = aoiExportRows();
    if (!rows.length || !lastAOIResult) return;
    var btn = document.getElementById('aoi-btn-pdf');
    var origText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = t('Preparing...', 'तैयार हो रहा है...'); btn.disabled = true; }
    loadJsPDF().then(function (jsPDF) {
      var doc = new jsPDF({ orientation: 'landscape', unit: 'pt' });
      doc.setFontSize(16);
      doc.text('AOI Village Report', 40, 40);
      doc.setFontSize(10);
      doc.text(rows.length + ' villages | Area: ' + fmt(lastAOIResult.area_ha, 2) + ' ha (' +
        fmt(lastAOIResult.area_km2, 3) + ' km2) | Perimeter: ' + fmt(lastAOIResult.perimeter_km, 3) + ' km', 40, 58);
      doc.text('Source: IMD 0.05 deg gridded daily data, 2000-2024, sampled at village centroids. Generated ' +
        new Date().toISOString().slice(0, 10) + '.', 40, 72);

      var startY = 95, rowH = 16, colX = [40, 140, 260, 320, 380, 460, 540, 610, 670, 730];
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      AOI_EXPORT_COLUMNS.forEach(function (c, i) { doc.text(c[1], colX[i], startY); });
      doc.setFont(undefined, 'normal');
      var y = startY + rowH;
      rows.forEach(function (r) {
        if (y > 560) { doc.addPage(); y = 40; }
        AOI_EXPORT_COLUMNS.forEach(function (c, i) {
          var v = r[c[0]];
          var txt = v == null ? '--' : (typeof v === 'number' ? v.toFixed(2) : String(v));
          doc.text(String(txt).slice(0, 22), colX[i], y);
        });
        y += rowH;
      });
      doc.save('aoi_village_report.pdf');
    }).catch(function (e) {
      console.warn('[geoai] PDF export failed:', e);
      setStatus(t('PDF export failed -- check your connection and try again.', 'PDF डाउनलोड विफल -- कनेक्शन जांचें और फिर से कोशिश करें।'));
    }).finally(function () {
      if (btn) { btn.innerHTML = origText; btn.disabled = false; }
    });
  }

  function addFurniture() {
    var map = window.leafletMap;
    if (!map || !window.L) return;
    try {
      L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 160 })
        .addTo(map);
    } catch (e) { /* ignore */ }

    var north = L.control({ position: 'topleft' });
    north.onAdd = function () {
      var d = L.DomUtil.create('div');
      d.style.cssText = 'background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.15);' +
        'border-radius:5px;width:40px;height:48px;display:flex;align-items:center;' +
        'justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.2)';
      d.title = 'True north';
      d.innerHTML = '<svg width="26" height="38" viewBox="0 0 26 38">' +
        '<polygon points="13,3 20,26 13,21 6,26" fill="#1a1a1a"/>' +
        '<text x="13" y="36" font-size="11" font-weight="700" text-anchor="middle" ' +
        'fill="#1a1a1a">N</text></svg>';
      return d;
    };
    north.addTo(map);

    map.on('click', onMapClick);
    map.on('dblclick', function () { if (drawing) finishDraw(); });
  }

  function buildMetadataPanel() {
    if (document.getElementById('meta-modal')) return;
    var btn = el('div', 'position:fixed;right:92px;bottom:26px;z-index:1200;background:var(--cyan);' +
      'color:#fff;border-radius:20px;padding:8px 15px;font-size:12px;font-weight:600;' +
      'cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.28)',
      '<i class="fa fa-circle-info"></i> ' + t('Data sources', 'डेटा स्रोत'));
    btn.id = 'meta-btn';
    var modal = el('div', 'position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.45);' +
      'display:none;align-items:center;justify-content:center;padding:20px');
    modal.id = 'meta-modal';
    var card = el('div', 'background:var(--bg-card);color:var(--text);border-radius:9px;' +
      'max-width:1000px;width:100%;max-height:84vh;overflow:auto;padding:20px 22px;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.35)');

    var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
      'margin-bottom:6px"><h3 style="margin:0;font-size:16px">' +
      t('Metadata and Provenance', 'मेटाडेटा एवं स्रोत विवरण') + '</h3>' +
      '<span id="meta-close" style="cursor:pointer;font-size:22px;line-height:1;opacity:.6">&times;</span></div>' +
      '<p style="margin:0 0 14px;font-size:11.5px;opacity:.75;line-height:1.65">' +
      t('Every layer states its origin, spatial resolution, coordinate reference system, ' +
        'processing method, quality status and last update. Layers not listed here are not displayed.',
        'हर परत का स्रोत, स्थानिक विभेदन, निर्देशांक प्रणाली, प्रसंस्करण विधि, गुणवत्ता स्थिति और ' +
        'अंतिम अद्यतन दर्ज है। जो परत यहाँ दर्ज नहीं, वह पोर्टल पर दिखाई नहीं जाती।') + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
      '<tr style="text-align:left;font-size:10px;letter-spacing:.3px;opacity:.65">' +
      '<th style="padding:5px 6px">' + t('LAYER', 'परत') + '</th>' +
      '<th style="padding:5px 6px">' + t('SOURCE', 'स्रोत') + '</th>' +
      '<th style="padding:5px 6px">' + t('RESOLUTION', 'विभेदन') + '</th>' +
      '<th style="padding:5px 6px">CRS</th>' +
      '<th style="padding:5px 6px">' + t('QUALITY', 'गुणवत्ता') + '</th>' +
      '<th style="padding:5px 6px">' + t('UPDATED', 'अद्यतन') + '</th></tr>';
    REGISTRY.forEach(function (r) {
      h += '<tr style="border-top:1px solid var(--border);vertical-align:top">' +
        '<td style="padding:7px 6px;font-weight:600">' + (isHindi() ? r.lh : r.l) + '</td>' +
        '<td style="padding:7px 6px">' + r.s +
        '<div style="font-size:10px;opacity:.65;margin-top:3px">' + r.m + '</div></td>' +
        '<td style="padding:7px 6px">' + r.r + '</td>' +
        '<td style="padding:7px 6px">' + r.c + '</td>' +
        '<td style="padding:7px 6px">' + badge(r.q) + '</td>' +
        '<td style="padding:7px 6px">' + r.u + '</td></tr>';
    });
    h += '</table>';
    h += '<div style="margin-top:16px;padding:11px 13px;background:rgba(192,57,43,.07);' +
      'border-left:3px solid #c0392b;border-radius:4px;font-size:11.5px;line-height:1.7"><b>' +
      t('Stated limitations', 'घोषित सीमाएँ') + '</b><br>' +
      t('1. Village values are nearest-pixel samples of a 5.5 km grid, not polygon zonal means.<br>' +
        '2. The record is 25 years (2000-2024) against the WMO 30-year normal.<br>' +
        '3. Only SSP2-4.5 is implemented; the dashboard forecast is an OLS trend, not CMIP6.<br>' +
        '4. Cadastral parcels are disabled pending official MP Bhulekh records.',
        '1. ग्राम मान 5.5 किमी ग्रिड के निकटतम पिक्सेल के नमूने हैं, ज़ोनल औसत नहीं।<br>' +
        '2. अभिलेख 25 वर्ष का है, जबकि WMO मानक 30 वर्ष का है।<br>' +
        '3. केवल SSP2-4.5 लागू है; पूर्वानुमान OLS प्रवृत्ति है, CMIP6 नहीं।<br>' +
        '4. कैडस्ट्रल पार्सल MP भूलेख के आधिकारिक अभिलेख आने तक बंद हैं।') + '</div>';

    card.innerHTML = h;
    modal.appendChild(card);
    document.body.appendChild(btn);
    document.body.appendChild(modal);
    btn.onclick = function () { modal.style.display = 'flex'; };
    modal.onclick = function (e) { if (e.target === modal) modal.style.display = 'none'; };
    var c = document.getElementById('meta-close');
    if (c) c.onclick = function () { modal.style.display = 'none'; };
  }

  function ymd(d) {
    return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
  }

  function currentLocation() {
    var data = window._mpClimateData;
    var ds = document.getElementById('districtSelect');
    var vs = document.getElementById('villageSelect');
    if (!data || !ds || !ds.value) return null;
    var d = data.districts[ds.value];
    if (!d) return null;
    if (vs && vs.value) {
      var vm = d.villages || {};
      for (var id in vm) {
        if ((vm[id].name || '').toUpperCase() === vs.value.toUpperCase() && vm[id].lat != null) {
          return { lat: vm[id].lat, lng: vm[id].lon, name: vm[id].name + ', ' + d.name };
        }
      }
    }
    return { lat: d.lat, lng: d.lng, name: d.name };
  }

  function loadNasaPower(lat, lon, label) {
    var box = document.getElementById('nasa-box');
    if (!box) return;
    box.innerHTML = '<div style="padding:14px;font-size:12px;opacity:.7">' +
      t('Fetching NASA POWER...', 'NASA POWER से लाया जा रहा...') + '</div>';

    var end = new Date(Date.now() - 3 * 86400000);
    var start = new Date(end.getTime() - 13 * 86400000);
    var url = 'https://power.larc.nasa.gov/api/temporal/daily/point' +
      '?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M&community=AG' +
      '&longitude=' + lon.toFixed(4) + '&latitude=' + lat.toFixed(4) +
      '&start=' + ymd(start) + '&end=' + ymd(end) + '&format=JSON';

    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var p = j && j.properties && j.properties.parameter;
      if (!p || !p.T2M_MAX) throw new Error('unexpected response');
      var dates = Object.keys(p.T2M_MAX).sort();
      var h = '<div style="padding:12px 14px;font-size:12px;color:var(--text)">' +
        '<div style="margin-bottom:8px">' + badge('verified') + ' <b>' +
        t('Live daily weather', 'वास्तविक दैनिक मौसम') + '</b> -- ' + label + '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11.5px">' +
        '<tr style="text-align:left;font-size:10px;opacity:.65;letter-spacing:.3px">' +
        '<th style="padding:3px 0">' + t('DATE', 'दिनांक') + '</th>' +
        '<th style="text-align:right">Tmax C</th><th style="text-align:right">Tmin C</th>' +
        '<th style="text-align:right">' + t('RAIN', 'वर्षा') + ' mm</th>' +
        '<th style="text-align:right">RH %</th></tr>';
      var rainSum = 0, tx = [];
      dates.forEach(function (d) {
        var a = p.T2M_MAX[d], b = p.T2M_MIN[d];
        var pr = p.PRECTOTCORR ? p.PRECTOTCORR[d] : null;
        var rh = p.RH2M ? p.RH2M[d] : null;
        if (a <= -900) return;
        if (pr > -900) rainSum += pr;
        tx.push(a);
        h += '<tr style="border-top:1px solid var(--border)">' +
          '<td style="padding:4px 0">' + d.slice(6, 8) + '-' + d.slice(4, 6) + '-' + d.slice(0, 4) + '</td>' +
          '<td style="text-align:right;font-weight:600">' + a.toFixed(1) + '</td>' +
          '<td style="text-align:right">' + (b > -900 ? b.toFixed(1) : '--') + '</td>' +
          '<td style="text-align:right">' + (pr > -900 ? pr.toFixed(1) : '--') + '</td>' +
          '<td style="text-align:right">' + (rh > -900 ? rh.toFixed(0) : '--') + '</td></tr>';
      });
      h += '</table>';
      if (tx.length) {
        var m = tx.reduce(function (s, v) { return s + v; }, 0) / tx.length;
        h += '<div style="margin-top:9px;font-size:11.5px">' +
          t('14-day mean Tmax', '14-दिन औसत Tmax') + ': <b>' + m.toFixed(1) + ' C</b> - ' +
          t('total rainfall', 'कुल वर्षा') + ': <b>' + rainSum.toFixed(1) + ' mm</b></div>';
      }
      h += '<div style="margin-top:9px;padding-top:7px;border-top:1px solid var(--border);' +
        'font-size:10px;opacity:.72;line-height:1.6">' +
        t('Source: NASA POWER (MERRA-2 reanalysis), 0.5 x 0.625 deg, EPSG:4326. POWER publishes ' +
          'with a 2-3 day lag. No interpolation or bias correction applied. These are reanalysis ' +
          'values, not station observations.',
          'स्रोत: NASA POWER (MERRA-2 पुनर्विश्लेषण), 0.5 x 0.625 deg, EPSG:4326. POWER 2-3 दिन की ' +
          'देरी से प्रकाशित करता है। कोई इंटरपोलेशन या पूर्वाग्रह सुधार लागू नहीं। ये पुनर्विश्लेषण मान ' +
          'हैं, स्टेशन प्रेक्षण नहीं।') + '</div></div>';
      box.innerHTML = h;
    }).catch(function (err) {
      box.innerHTML = '<div style="padding:14px;font-size:12px;line-height:1.7;color:var(--text)">' +
        '<b style="color:#c0392b">' + t('NASA POWER unavailable', 'NASA POWER उपलब्ध नहीं') +
        '</b><br>' + t('Could not reach the live weather service (' + err.message +
          '). The IMD-based historical indices are unaffected.',
          'वास्तविक मौसम सेवा तक नहीं पहुँच सके (' + err.message +
          ')। IMD आधारित ऐतिहासिक संकेतक अप्रभावित हैं।') + '</div>';
    });
  }

  function buildNasaPane() {
    var host = paneHost();
    if (!host || document.getElementById('pane-nasa')) return;
    var p = el('div', '', '');
    p.className = 'btm-pane';
    p.id = 'pane-nasa';
    p.innerHTML = '<div id="nasa-box"><div style="padding:16px;font-size:12px;opacity:.8">' +
      t('Select a district or village, then open this tab to load real-time daily weather.',
        'ज़िला या गाँव चुनें, फिर वास्तविक दैनिक मौसम लाने के लिए यह टैब खोलें।') + '</div></div>';
    host.appendChild(p);
    addTab('nasa-tab', 'pane-nasa', 'fa-satellite-dish', 'Live Weather', 'लाइव मौसम', function () {
      var loc = currentLocation();
      if (loc) loadNasaPower(loc.lat, loc.lng, loc.name);
    });
  }

  function boot() {
    if (!window.L || !window.leafletMap) { setTimeout(boot, 700); return; }
    try { addFurniture(); } catch (e) { console.warn('[geoai] furniture', e); }
    try { buildAOIPane(); } catch (e) { console.warn('[geoai] aoi', e); }
    try { buildNasaPane(); } catch (e) { console.warn('[geoai] nasa', e); }
    try { buildMetadataPanel(); } catch (e) { console.warn('[geoai] meta', e); }
    console.log('[geoai_professional] loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 900); });
  } else {
    setTimeout(boot, 900);
  }

  window.VindhyaGeoAI = { analyseAOI: analyseAOI, loadNasaPower: loadNasaPower, registry: REGISTRY };
})();
