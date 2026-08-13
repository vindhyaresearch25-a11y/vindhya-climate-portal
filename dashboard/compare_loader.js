/*
 * compare_loader.js — Phase 6 Multi-select Compare (FINAL_PROMPT.md).
 *
 * Sidebar-only "Compare" panel, fully separate from the main Location
 * Selector's state (national_selector.js) -- selecting/removing locations
 * here never touches stateSelect/districtSelect or the main map layers.
 *
 * HONEST SCOPING (read before extending):
 * - District tier only for now. State/Block/Village tiers are stubbed
 *   with an explicit "not built yet" message -- picking them must never
 *   silently show broken or wrong-tier data.
 * - Two genuinely different climate data shapes exist and are NOT
 *   conflated:
 *     1. The 5 original IMD districts (Bhopal/Indore/Jabalpur/Rewa/Sidhi,
 *        Madhya Pradesh only) -- data/mp_climate_data.json's
 *        charts.annual_trends has a REAL year-by-year series 2000-2024.
 *        The year slider drives a real value for these.
 *     2. Every other district with data/climate/<state>/<district>.json
 *        (GEE ERA5-Land/CHIRPS pipeline) -- its "indices" object is a
 *        SINGLE 2000-2024 period-average value per index, not a yearly
 *        series (verified against the file's own contents before writing
 *        this). The year slider does NOT change these values; the table
 *        and chart label them "2000-2024 avg" instead of pretending a
 *        specific year, and the chart draws them as a dashed flat
 *        reference line rather than a fabricated year-varying line.
 * - NDVI: data/dicra_ndvi.json only covers Madhya Pradesh's 52 districts
 *   (DiCRA/MODIS pull). Every other state honestly shows "Data not
 *   available" for NDVI -- never a neighbouring district's value.
 * - Population / Net area sown / Irrigated area: not present in any
 *   existing district-level file. Aggregated here, per selected district,
 *   from the real per-village SoI profile
 *   (data/village_profiles/<state>/<district>.json, HF-hosted) by summing
 *   the real per-village fields -- population, land_net_area_sown_ha,
 *   irrigated_area_total_ha -- across all villages in that file. Every
 *   aggregate shows how many villages it was summed from; a district with
 *   no village_profiles file (SoI coverage gap) honestly shows "Data not
 *   available", never a partial or estimated figure.
 */
(function () {
  'use strict';

  var MAX_LOCATIONS = 6;
  var MAX_LOCATIONS_MOBILE = 3;
  var MIN_LOCATIONS = 2;
  var COLORS = ['#1a8a9e', '#d4793a', '#2d8f5c', '#c0392b', '#3b7fc9', '#c9a843'];
  var MP_IMD_DISTRICTS = { 'bhopal': 1, 'indore': 1, 'jabalpur': 1, 'rewa': 1, 'sidhi': 1 };

  var CLIMATE_FIELDS = [
    { key: 'heatwave_days', label: 'Heatwave Days/yr', mpKey: 'heatwave_days', geeKey: 'heatwave_days', fmt: function (v) { return v.toFixed(1); } },
    { key: 'spi_12', label: 'SPI (12-mo)', mpKey: 'spi_12', geeKey: 'spi_12', fmt: function (v) { return v.toFixed(2); } },
    { key: 'annual_rain_mm', label: 'Rainfall (mm/yr)', mpKey: 'annual_rain_mm', geeKey: 'annual_rain_mm', fmt: function (v) { return Math.round(v).toLocaleString('en-IN'); } },
    { key: 'rx1day_mm', label: 'Rx1day (mm)', mpKey: 'rx1day_mm', geeKey: 'rx1day_mm', fmt: function (v) { return v.toFixed(1); } }
  ];
  var ALL_COLUMNS = CLIMATE_FIELDS.concat([
    { key: 'ndvi', label: 'NDVI', fmt: function (v) { return v.toFixed(3); } },
    { key: 'population', label: 'Population', fmt: function (v) { return Math.round(v).toLocaleString('en-IN'); } },
    { key: 'net_area_sown_ha', label: 'Net Area Sown (ha)', fmt: function (v) { return Math.round(v).toLocaleString('en-IN'); } },
    { key: 'irrigated_area_ha', label: 'Irrigated Area (ha)', fmt: function (v) { return Math.round(v).toLocaleString('en-IN'); } }
  ]);

  var state = {
    tier: 'district',
    locations: [],        // { stateName, districtName, stateSlug, districtSlug, color, isMp }
    year: 2024,
    sortCol: null,
    sortDir: 1,
    chartIndex: 'heatwave_days',
    districtsIndex: null, // cached districts_index.json ({state_name, district_name, district_lgd}[])
    cache: {}              // "stateSlug/districtSlug" -> { climate, ndvi, village }
  };

  function isHindi() {
    try {
      if (typeof window.LANG !== 'undefined') return window.LANG === 'hi';
      return document.body.classList.contains('lang-hi');
    } catch (e) { return false; }
  }
  function t(en, hi) { return isHindi() ? hi : en; }

  // i-icon tooltip helper -- long explanation goes in the title attribute,
  // never inline as panel text (item 2).
  function infoIcon(title) {
    return '<i class="fa fa-circle-info" title="' + String(title).replace(/"/g, '&quot;') + '" ' +
      'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i>';
  }

  function slugify(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function fetchWithTimeout(url, opts) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var o = opts || {};
    if (controller) o.signal = controller.signal;
    return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
  }

  function resolveUrl(path) {
    return (typeof window.resolveDataUrl === 'function') ? window.resolveDataUrl(path) : path;
  }

  function isMobile() { return window.innerWidth <= 768; }
  function maxLocations() { return isMobile() ? MAX_LOCATIONS_MOBILE : MAX_LOCATIONS; }

  // ---------------------------------------------------------------------
  // District search index
  // ---------------------------------------------------------------------
  function loadDistrictsIndex() {
    if (state.districtsIndex) return Promise.resolve(state.districtsIndex);
    // Built via concatenation (not one literal string) so app.py's
    // Streamlit URL-patcher, which matches the exact quoted substring
    // 'data/boundaries/', can rewrite this to the raw-CDN URL too.
    return fetchWithTimeout('data/boundaries/' + 'soi/districts_index.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { state.districtsIndex = j.districts || []; return state.districtsIndex; })
      .catch(function (err) { console.warn('[compare] districts_index load failed', err); return []; });
  }

  // ---------------------------------------------------------------------
  // Per-location data fetch
  // ---------------------------------------------------------------------
  function mpClimateData() {
    if (window._mpClimateDataCache) return Promise.resolve(window._mpClimateDataCache);
    return fetchWithTimeout('data/mp_climate_data.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { window._mpClimateDataCache = j; return j; });
  }

  function loadClimateFor(loc) {
    if (loc.isMp) {
      return mpClimateData().then(function (d) {
        var trend = d && d.charts && d.charts.annual_trends && d.charts.annual_trends[loc.districtSlug];
        if (!trend) return { available: false };
        return { available: true, periodAvg: false, trend: trend };
      }).catch(function (err) { return { available: false, error: err.message }; });
    }
    var url = 'data/climate/' + loc.stateSlug + '/' + loc.districtSlug + '.json';
    return fetchWithTimeout(url).then(function (r) {
      if (r.status === 404) return { available: false, notFound: true };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().then(function (j) { return { available: true, periodAvg: true, indices: j.indices, metadata: j.metadata }; });
    }).catch(function (err) { return { available: false, error: err && err.message }; });
  }

  function loadNdviFor(loc) {
    return fetchWithTimeout('data/dicra_ndvi.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var d = j.districts && j.districts[loc.districtSlug];
      if (!d) return { available: false };
      return { available: true, dates: d.dates, ndvi_mean: d.ndvi_mean };
    }).catch(function () { return { available: false }; });
  }

  function loadVillageAggFor(loc) {
    var url = resolveUrl('data/' + 'village_profiles/' + loc.stateSlug + '/' + loc.districtSlug + '.json');
    return fetchWithTimeout(url).then(function (r) {
      if (r.status === 404) return { available: false, notFound: true };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.villages) return { available: false };
      var order = j.metadata && j.metadata.field_order;
      if (!order) return { available: false };
      var iPop = order.indexOf('population');
      var iNas = order.indexOf('land_net_area_sown_ha');
      var iIrr = order.indexOf('irrigated_area_total_ha');
      var sumPop = 0, nPop = 0, sumNas = 0, nNas = 0, sumIrr = 0, nIrr = 0, total = 0;
      Object.keys(j.villages).forEach(function (k) {
        var v = j.villages[k];
        total++;
        if (iPop >= 0 && v[iPop] != null) { sumPop += v[iPop]; nPop++; }
        if (iNas >= 0 && v[iNas] != null) { sumNas += v[iNas]; nNas++; }
        if (iIrr >= 0 && v[iIrr] != null) { sumIrr += v[iIrr]; nIrr++; }
      });
      return {
        available: true,
        totalVillages: total,
        fetchDate: j.metadata.fetch_date,
        population: nPop ? { sum: sumPop, n: nPop } : null,
        net_area_sown_ha: nNas ? { sum: sumNas, n: nNas } : null,
        irrigated_area_ha: nIrr ? { sum: sumIrr, n: nIrr } : null
      };
    }).catch(function (err) { return { available: false, error: err && err.message }; });
  }

  function loadAllFor(loc) {
    var key = loc.stateSlug + '/' + loc.districtSlug;
    if (state.cache[key]) return Promise.resolve(state.cache[key]);
    return Promise.all([loadClimateFor(loc), loadNdviFor(loc), loadVillageAggFor(loc)]).then(function (r) {
      var bundle = { climate: r[0], ndvi: r[1], village: r[2] };
      state.cache[key] = bundle;
      return bundle;
    });
  }

  // ---------------------------------------------------------------------
  // Value accessors -- every one returns { value, label, note } or null
  // ---------------------------------------------------------------------
  function climateValue(bundle, fieldKey, year) {
    var c = bundle.climate;
    if (!c || !c.available) return null;
    if (!c.periodAvg) {
      var trend = c.trend;
      var idx = trend.years.indexOf(year);
      if (idx < 0 || !trend[fieldKey] || trend[fieldKey][idx] == null) return null;
      return { value: trend[fieldKey][idx], note: String(year) + ' (IMD, actual year)' };
    }
    var v = c.indices && c.indices[fieldKey];
    if (v == null) return null;
    return { value: v, note: '2000-2024 avg (ERA5-Land/CHIRPS)', isPeriodAvg: true };
  }

  function ndviValue(bundle, year) {
    var n = bundle.ndvi;
    if (!n || !n.available) return null;
    var vals = [];
    for (var i = 0; i < n.dates.length; i++) {
      if (n.dates[i].slice(0, 4) === String(year)) vals.push(n.ndvi_mean[i]);
    }
    if (!vals.length) return null;
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    return { value: mean, note: year + ' mean of ' + vals.length + ' obs (DiCRA/MODIS)' };
  }

  function villageValue(bundle, fieldKey) {
    var v = bundle.village;
    if (!v || !v.available) return null;
    var agg = v[fieldKey];
    if (!agg) return null;
    return { value: agg.sum, note: 'sum of ' + agg.n + '/' + v.totalVillages + ' villages, SoI ' + (v.fetchDate || '') };
  }

  function getCellValue(loc, bundle, colKey, year) {
    if (colKey === 'ndvi') return ndviValue(bundle, year);
    if (colKey === 'population' || colKey === 'net_area_sown_ha' || colKey === 'irrigated_area_ha') return villageValue(bundle, colKey);
    return climateValue(bundle, colKey, year);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function tierNotBuiltMsg(tier) {
    var names = { state: t('State', 'राज्य'), block: t('Block/Tehsil', 'ब्लॉक/तहसील'), village: t('Village', 'गांव') };
    return '<div style="padding:14px;font-size:12px;line-height:1.8;background:rgba(212,121,58,.08);' +
      'border:1px solid rgba(212,121,58,.3);border-radius:6px;color:var(--text)">' +
      '<b>' + t('Not built yet', 'अभी उपलब्ध नहीं') + '</b><br>' +
      t(names[tier] + '-tier · District tier only', names[tier] + '-स्तर · केवल ज़िला स्तर') + ' ' +
      infoIcon(names[tier] + '-tier Compare is not implemented yet. Switch to District above.') +
      '</div>';
  }

  function chipsHtml() {
    if (!state.locations.length) {
      return '<div style="font-size:var(--fs-1);opacity:.65;padding:var(--space-04) 0">' +
        t('Add 2–6 districts', '2–6 ज़िले जोड़ें') + '</div>';
    }
    return state.locations.map(function (loc, i) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;margin:2px 4px 2px 0;padding:3px 8px;' +
        'border-radius:12px;background:' + loc.color + '18;border:1.5px solid ' + loc.color + ';font-size:11px;color:var(--text)">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + loc.color + ';display:inline-block"></span>' +
        loc.districtName + ', ' + loc.stateName +
        '<i class="fa fa-xmark" data-compare-remove="' + i + '" style="cursor:pointer;opacity:.7;margin-left:2px"></i></span>';
    }).join('');
  }

  function searchResultsHtml(query) {
    if (!query || query.length < 2 || !state.districtsIndex) return '';
    var q = query.toLowerCase();
    var selected = {};
    state.locations.forEach(function (l) { selected[l.stateSlug + '/' + l.districtSlug] = 1; });
    var matches = state.districtsIndex.filter(function (d) {
      return d.district_name.toLowerCase().indexOf(q) === 0 || d.district_name.toLowerCase().indexOf(' ' + q) > -1;
    }).slice(0, 8);
    if (!matches.length) return '<div style="padding:6px 8px;font-size:11px;opacity:.6">' + t('No match', 'कोई मेल नहीं') + '</div>';
    return matches.map(function (d) {
      var key = slugify(d.state_name) + '/' + slugify(d.district_name);
      var already = selected[key];
      return '<div data-compare-pick="' + d.state_name.replace(/"/g, '&quot;') + '|' + d.district_name.replace(/"/g, '&quot;') + '" ' +
        'style="padding:5px 8px;font-size:12px;cursor:' + (already ? 'default' : 'pointer') + ';' +
        'opacity:' + (already ? '.4' : '1') + ';border-radius:4px" ' +
        'onmouseover="this.style.background=\'rgba(26,138,158,.08)\'" onmouseout="this.style.background=\'\'">' +
        d.district_name + ' <span style="opacity:.6">, ' + d.state_name + '</span>' +
        (already ? ' <span style="font-size:9.5px">(' + t('added', 'जुड़ा हुआ') + ')</span>' : '') + '</div>';
    }).join('');
  }

  function highlightClass(colKey, values) {
    // values: array of {i, value} for non-null cells in this column
    if (values.length < 2) return {};
    var max = values[0], min = values[0];
    values.forEach(function (v) { if (v.value > max.value) max = v; if (v.value < min.value) min = v; });
    var out = {};
    out[max.i] = 'max'; out[min.i] = (min.i === max.i) ? out[min.i] : 'min';
    return out;
  }

  function buildTable(bundles) {
    var cols = ALL_COLUMNS;
    var rows = state.locations.map(function (loc, i) {
      var cells = {};
      cols.forEach(function (c) { cells[c.key] = getCellValue(loc, bundles[i], c.key, state.year); });
      return { loc: loc, cells: cells };
    });

    if (state.sortCol) {
      rows.sort(function (a, b) {
        var av = a.cells[state.sortCol], bv = b.cells[state.sortCol];
        var an = av ? av.value : null, bn = bv ? bv.value : null;
        if (an == null && bn == null) return 0;
        if (an == null) return 1;
        if (bn == null) return -1;
        return (an - bn) * state.sortDir;
      });
    }

    var hi = {};
    cols.forEach(function (c) {
      var vals = [];
      rows.forEach(function (r, i) { if (r.cells[c.key]) vals.push({ i: i, value: r.cells[c.key].value }); });
      hi[c.key] = highlightClass(c.key, vals);
    });

    var h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11.5px;min-width:640px">';
    h += '<tr style="text-align:left">';
    h += '<th style="padding:6px 8px;border-bottom:2px solid var(--border);font-size:10.5px;opacity:.7">' + t('LOCATION', 'स्थान') + '</th>';
    cols.forEach(function (c) {
      var arrow = state.sortCol === c.key ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
      h += '<th data-compare-sort="' + c.key + '" style="padding:6px 8px;border-bottom:2px solid var(--border);' +
        'font-size:10.5px;opacity:.7;text-align:right;cursor:pointer;white-space:nowrap">' + c.label + arrow + '</th>';
    });
    h += '</tr>';

    rows.forEach(function (r, i) {
      h += '<tr style="border-bottom:1px solid var(--border)">';
      h += '<td style="padding:6px 8px"><span style="width:8px;height:8px;border-radius:50%;background:' + r.loc.color +
        ';display:inline-block;margin-right:6px"></span>' + r.loc.districtName + '</td>';
      cols.forEach(function (c) {
        var cell = r.cells[c.key];
        var cls = hi[c.key][i];
        var bg = cls === 'max' ? 'rgba(45,143,92,.12)' : (cls === 'min' ? 'rgba(192,57,43,.10)' : 'transparent');
        if (!cell) {
          h += '<td style="padding:6px 8px;text-align:right;opacity:.5;font-size:10.5px">' + t('Data not available', 'आंकड़े उपलब्ध नहीं') + '</td>';
        } else {
          h += '<td style="padding:6px 8px;text-align:right;background:' + bg + '" title="' + (cell.note || '') + '">' +
            c.fmt(cell.value) + (cell.isPeriodAvg ? ' <sup style="opacity:.6">avg</sup>' : '') + '</td>';
        }
      });
      h += '</tr>';
    });
    h += '</table></div>';

    h += '<div style="margin-top:var(--space-04);font-size:var(--fs-1);opacity:.65;line-height:1.7">' +
      t('Sources vary per column', 'हर कॉलम के स्रोत अलग हैं') + ' ' +
      infoIcon('Heatwave/SPI/Rainfall/Rx1day: IMD (5 original MP districts, real year selected) or ERA5-Land+CHIRPS via GEE (all other districts, 2000-2024 average, marked "avg" -- the year slider does not change this value). NDVI: DiCRA/MODIS, Madhya Pradesh districts only. Population/Net area sown/Irrigated area: summed from Survey of India per-village profiles. Hyphen = data genuinely not available, never a substituted or estimated figure.') +
      '</div>';
    return h;
  }

  function buildMobileCards(bundles) {
    var cols = ALL_COLUMNS;
    var shown = state.locations.slice(0, MAX_LOCATIONS_MOBILE);
    return shown.map(function (loc, i) {
      var b = bundles[i];
      var rows = cols.map(function (c) {
        var cell = getCellValue(loc, b, c.key, state.year);
        var val = cell ? c.fmt(cell.value) + (cell.isPeriodAvg ? ' (avg)' : '') : t('Data not available', 'आंकड़े उपलब्ध नहीं');
        return '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11.5px;border-bottom:1px solid var(--border)">' +
          '<span style="opacity:.7">' + c.label + '</span><span style="font-weight:600">' + val + '</span></div>';
      }).join('');
      return '<div style="border:1.5px solid ' + loc.color + ';border-radius:8px;padding:10px;margin-bottom:10px;background:' + loc.color + '0d">' +
        '<div style="font-weight:700;font-size:12.5px;margin-bottom:6px">' + loc.districtName + ', ' + loc.stateName + '</div>' + rows + '</div>';
    }).join('') + (state.locations.length > MAX_LOCATIONS_MOBILE ?
      '<div style="font-size:var(--fs-1);opacity:.65;padding:var(--space-04) 0">' +
      t('Showing 3 of ' + state.locations.length, state.locations.length + ' में से 3 दिख रहे') + ' ' +
      infoIcon('Remove one to see a different set, or view on desktop for all.') + '</div>' : '');
  }

  var _chart = null;
  function buildChart(bundles) {
    var canvas = document.getElementById('compare-chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    var field = CLIMATE_FIELDS.filter(function (f) { return f.key === state.chartIndex; })[0] || CLIMATE_FIELDS[0];
    var years = [];
    for (var y = 2000; y <= 2024; y++) years.push(y);

    var datasets = state.locations.map(function (loc, i) {
      var b = bundles[i];
      var c = b.climate;
      if (!c || !c.available) return null;
      if (!c.periodAvg) {
        var data = years.map(function (yr) {
          var idx = c.trend.years.indexOf(yr);
          return (idx >= 0 && c.trend[field.mpKey]) ? c.trend[field.mpKey][idx] : null;
        });
        return { label: loc.districtName + ' (actual/yr)', data: data, borderColor: loc.color, backgroundColor: loc.color + '33', tension: 0.25, spanGaps: true };
      }
      var v = c.indices && c.indices[field.geeKey];
      if (v == null) return null;
      return { label: loc.districtName + ' (2000-24 avg)', data: years.map(function () { return v; }), borderColor: loc.color, borderDash: [6, 4], backgroundColor: 'transparent', pointRadius: 0 };
    }).filter(Boolean);

    if (_chart) { _chart.destroy(); _chart = null; }
    _chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: years, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, title: { display: true, text: field.label, font: { size: 12 } } },
        scales: { x: { ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } }
      }
    });
  }

  function chartIndexPickerHtml() {
    return '<select id="compare-chart-field" style="font-size:11px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text)">' +
      CLIMATE_FIELDS.map(function (f) {
        return '<option value="' + f.key + '"' + (f.key === state.chartIndex ? ' selected' : '') + '>' + f.label + '</option>';
      }).join('') + '</select>';
  }

  function render() {
    var box = document.getElementById('compare-box');
    if (!box) return;

    var tierPicker = '<div style="margin-bottom:8px">' +
      ['district', 'state', 'block', 'village'].map(function (tr) {
        var active = tr === state.tier;
        return '<button data-compare-tier="' + tr + '" style="margin-right:5px;padding:3px 10px;border-radius:12px;font-size:11px;' +
          'border:1.5px solid ' + (active ? 'var(--cyan)' : 'var(--border)') + ';background:' + (active ? 'var(--cyan)' : 'transparent') +
          ';color:' + (active ? '#fff' : 'var(--text)') + ';cursor:pointer;text-transform:capitalize">' + tr + '</button>';
      }).join('') + '</div>';

    if (state.tier !== 'district') {
      box.innerHTML = '<div style="padding:14px">' + tierPicker + tierNotBuiltMsg(state.tier) + '</div>';
      wireTierButtons();
      return;
    }

    var search = '<div style="position:relative;margin-bottom:10px">' +
      '<input id="compare-search-input" type="text" placeholder="' + t('Search district to add...', 'ज़िला खोजें...') + '" ' +
      'style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:12px;box-sizing:border-box" ' +
      (state.locations.length >= maxLocations() ? 'disabled placeholder="' + t('Max ' + maxLocations() + ' reached -- remove one to add another', 'अधिकतम ' + maxLocations() + ' -- हटाकर जोड़ें') + '"' : '') + '>' +
      '<div id="compare-search-results" style="position:absolute;z-index:20;left:0;right:0;top:100%;background:var(--bg-card);' +
      'border:1px solid var(--border);border-radius:6px;max-height:220px;overflow-y:auto;box-shadow:0 4px 14px rgba(0,0,0,.12)"></div></div>';

    var yearSlider = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11.5px">' +
      '<span style="opacity:.7">' + t('Year', 'वर्ष') + '</span>' +
      '<input id="compare-year-slider" type="range" min="2000" max="2024" value="' + state.year + '" style="flex:1">' +
      '<b id="compare-year-label">' + state.year + '</b></div>' +
      '<div style="font-size:var(--fs-1);opacity:.6;margin-bottom:var(--space-04)">' +
      t('IMD districts + NDVI only', 'केवल IMD ज़िले + NDVI') + ' ' +
      infoIcon('Only affects IMD districts (Bhopal/Indore/Jabalpur/Rewa/Sidhi) and NDVI -- other districts show a fixed 2000-2024 average regardless of year.') + '</div>';

    var body;
    if (state.locations.length < MIN_LOCATIONS) {
      body = '<div style="padding:var(--space-08) 0;font-size:var(--fs-2);opacity:.7">' +
        t('Add at least 2 districts', 'कम से कम 2 ज़िले जोड़ें') + '</div>';
    } else {
      body = '<div style="padding:10px 0;font-size:11px;opacity:.7">' + t('Loading comparison...', 'तुलना लोड हो रही है...') + '</div>';
    }

    box.innerHTML = '<div style="padding:12px 14px">' + tierPicker +
      '<div style="margin-bottom:8px">' + chipsHtml() + '</div>' +
      search + yearSlider +
      '<div id="compare-export-bar" style="margin-bottom:8px;display:' + (state.locations.length >= MIN_LOCATIONS ? 'flex' : 'none') + ';gap:6px">' +
      '<button id="compare-export-csv" style="font-size:10.5px;padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer"><i class="fa fa-file-csv"></i> CSV</button>' +
      '<button id="compare-export-chart-png" style="font-size:10.5px;padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer"><i class="fa fa-image"></i> ' + t('Chart PNG', 'चार्ट PNG') + '</button>' +
      (typeof exportMapPNG === 'function' ? '<button id="compare-export-map-png" style="font-size:10.5px;padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer"><i class="fa fa-map"></i> ' + t('Map PNG', 'मैप PNG') + '</button>' : '') +
      '</div>' +
      '<div id="compare-body">' + body + '</div>' +
      (state.locations.length >= MIN_LOCATIONS ? ('<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<b style="font-size:11.5px">' + t('Chart', 'चार्ट') + '</b>' + chartIndexPickerHtml() + '</div>' +
        '<div style="height:220px"><canvas id="compare-chart-canvas"></canvas></div></div>') : '') +
      '</div>';

    wireControls();
    updateMapHighlight();

    if (state.locations.length >= MIN_LOCATIONS) {
      Promise.all(state.locations.map(loadAllFor)).then(function (bundles) {
        var stillSame = state.locations.map(function (l) { return l.stateSlug + '/' + l.districtSlug; }).join(',');
        var bodyEl = document.getElementById('compare-body');
        if (!bodyEl) return; // panel switched away while loading
        bodyEl.innerHTML = isMobile() ? buildMobileCards(bundles) : buildTable(bundles);
        wireSortHeaders();
        buildChart(bundles);
      }).catch(function (err) {
        var bodyEl = document.getElementById('compare-body');
        if (bodyEl) bodyEl.innerHTML = '<div style="color:#c0392b;font-size:11.5px">' + t('Failed to load comparison data.', 'तुलना डेटा लोड नहीं हुआ।') + ' ' + err.message + '</div>';
      });
    }
  }

  function wireTierButtons() {
    document.querySelectorAll('[data-compare-tier]').forEach(function (btn) {
      btn.onclick = function () { state.tier = btn.getAttribute('data-compare-tier'); render(); };
    });
  }

  function wireSortHeaders() {
    document.querySelectorAll('[data-compare-sort]').forEach(function (th) {
      th.onclick = function () {
        var col = th.getAttribute('data-compare-sort');
        if (state.sortCol === col) state.sortDir = -state.sortDir; else { state.sortCol = col; state.sortDir = -1; }
        render();
      };
    });
  }

  function addLocation(stateName, districtName) {
    if (state.locations.length >= maxLocations()) return;
    var stateSlug = slugify(stateName), districtSlug = slugify(districtName);
    if (state.locations.some(function (l) { return l.stateSlug === stateSlug && l.districtSlug === districtSlug; })) return;
    var color = COLORS[state.locations.length % COLORS.length];
    var isMp = stateSlug === 'madhya_pradesh' && MP_IMD_DISTRICTS[districtSlug];
    state.locations.push({ stateName: stateName, districtName: districtName, stateSlug: stateSlug, districtSlug: districtSlug, color: color, isMp: !!isMp });
    render();
  }

  function removeLocation(i) {
    state.locations.splice(i, 1);
    render();
  }

  function wireControls() {
    var searchInput = document.getElementById('compare-search-input');
    if (searchInput) {
      searchInput.oninput = function () {
        loadDistrictsIndex().then(function () {
          var resBox = document.getElementById('compare-search-results');
          if (resBox) resBox.innerHTML = searchResultsHtml(searchInput.value);
          wirePickHandlers();
        });
      };
      searchInput.onfocus = searchInput.oninput;
    }
    document.querySelectorAll('[data-compare-remove]').forEach(function (el) {
      el.onclick = function () { removeLocation(parseInt(el.getAttribute('data-compare-remove'), 10)); };
    });

    var yearSlider = document.getElementById('compare-year-slider');
    if (yearSlider) {
      yearSlider.oninput = function () {
        var lbl = document.getElementById('compare-year-label');
        if (lbl) lbl.textContent = yearSlider.value;
      };
      yearSlider.onchange = function () { state.year = parseInt(yearSlider.value, 10); render(); };
    }

    var chartField = document.getElementById('compare-chart-field');
    if (chartField) chartField.onchange = function () { state.chartIndex = chartField.value; render(); };

    var csvBtn = document.getElementById('compare-export-csv');
    if (csvBtn) csvBtn.onclick = exportCsv;
    var chartPngBtn = document.getElementById('compare-export-chart-png');
    if (chartPngBtn) chartPngBtn.onclick = exportChartPng;
    var mapPngBtn = document.getElementById('compare-export-map-png');
    if (mapPngBtn) mapPngBtn.onclick = function () { if (typeof exportMapPNG === 'function') exportMapPNG(); };

    wirePickHandlers();
    wireTierButtons();
  }

  function wirePickHandlers() {
    document.querySelectorAll('[data-compare-pick]').forEach(function (el) {
      el.onclick = function () {
        var parts = el.getAttribute('data-compare-pick').split('|');
        addLocation(parts[0], parts[1]);
      };
    });
  }

  function exportCsv() {
    Promise.all(state.locations.map(loadAllFor)).then(function (bundles) {
      var cols = ALL_COLUMNS;
      var lines = [['Location', 'State'].concat(cols.map(function (c) { return c.label; })).join(',')];
      state.locations.forEach(function (loc, i) {
        var row = [loc.districtName, loc.stateName].concat(cols.map(function (c) {
          var cell = getCellValue(loc, bundles[i], c.key, state.year);
          if (!cell) return 'Data not available';
          return c.fmt(cell.value) + (cell.isPeriodAvg ? ' (2000-2024 avg)' : '');
        }));
        lines.push(row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
      });
      var dateStr = new Date().toISOString().slice(0, 10);
      lines.push('');
      lines.push('"Source: IMD (5 original MP districts) / ERA5-Land+CHIRPS via Google Earth Engine / DiCRA-MODIS NDVI / Survey of India village profiles"');
      lines.push('"Generated ' + dateStr + ' -- VINDHYA Climate Intelligence Portal"');
      var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'vindhya-compare-' + dateStr + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
  }

  function exportChartPng() {
    var canvas = document.getElementById('compare-chart-canvas');
    if (!canvas) return;
    var scale = 2;
    var out = document.createElement('canvas');
    out.width = canvas.width * scale; out.height = canvas.height * scale + 50 * scale;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, canvas.height * scale);
    var dateStr = new Date().toISOString().slice(0, 10);
    ctx.fillStyle = '#1a2733'; ctx.font = 'bold ' + (13 * scale) + 'px Inter,sans-serif';
    ctx.fillText('VINDHYA Climate Intelligence Portal -- Compare Chart', 10 * scale, canvas.height * scale + 20 * scale);
    ctx.fillStyle = '#5a6a7a'; ctx.font = (10 * scale) + 'px Inter,sans-serif';
    ctx.fillText('Sources: IMD / ERA5-Land+CHIRPS (GEE) / DiCRA-MODIS -- generated ' + dateStr, 10 * scale, canvas.height * scale + 38 * scale);
    out.toBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'vindhya-compare-chart-' + dateStr + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  }

  // ---------------------------------------------------------------------
  // Map highlight -- own layer group, never touches national_selector.js's
  // state or layers. Fetches the same districts.geojson the main selector
  // uses (browser HTTP cache makes a repeat fetch cheap if it was already
  // loaded this session).
  // ---------------------------------------------------------------------
  var _compareLayerGroup = null;
  function updateMapHighlight() {
    var map = window.leafletMap;
    if (!map || typeof L === 'undefined') return;
    if (_compareLayerGroup) { map.removeLayer(_compareLayerGroup); _compareLayerGroup = null; }
    if (!state.locations.length) return;
    fetchWithTimeout(resolveUrl('data/boundaries/' + 'soi/districts.geojson')).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (geo) {
      _compareLayerGroup = L.layerGroup();
      var bounds = [];
      state.locations.forEach(function (loc) {
        var feature = geo.features.filter(function (f) {
          return f.properties && f.properties.state_name === loc.stateName && f.properties.district_name === loc.districtName;
        })[0];
        if (!feature) return;
        var layer = L.geoJSON(feature, { style: { color: loc.color, weight: 3, fill: true, fillOpacity: 0.15 } });
        layer.bindTooltip(loc.districtName, { permanent: true, direction: 'center', className: 'compare-label' });
        layer.addTo(_compareLayerGroup);
        try { bounds.push(layer.getBounds()); } catch (e) { /* ignore */ }
      });
      _compareLayerGroup.addTo(map);
      if (bounds.length) {
        var b = bounds[0];
        for (var i = 1; i < bounds.length; i++) b.extend(bounds[i]);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 9 });
      }
    }).catch(function (err) { console.warn('[compare] map highlight failed', err); });
  }

  // ---------------------------------------------------------------------
  // Pane + nav wiring (crop_stats_loader.js / live_weather_loader.js pattern)
  // ---------------------------------------------------------------------
  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || document.getElementById('pane-compare')) return;

    var p = document.createElement('div');
    p.innerHTML = '<div id="compare-box"></div>';
    p.className = 'btm-pane';
    p.id = 'pane-compare';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !document.getElementById('compare-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-code-compare"></i>' + t('Compare', 'तुलना करें');
      tab.className = 'btm-tab';
      tab.id = 'compare-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        document.getElementById('pane-compare').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        render();
      };
      tabs.appendChild(tab);
    }
  }

  function boot() {
    if (!document.querySelector('.btm-pane')) { setTimeout(boot, 700); return; }
    try { addPane(); } catch (e) { console.warn('[compare]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 950); });
  } else {
    setTimeout(boot, 950);
  }

  window.VindhyaCompare = { reload: render };
})();
