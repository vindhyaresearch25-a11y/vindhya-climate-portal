/* ===========================================================================
   mp_climate_loader.js  (VILLAGE-LEVEL)
   ---------------------------------------------------------------------------
   Loads data/mp_climate_data.json (village-level), patches MP_DISTRICTS,
   rebuilds the bottom charts per district, and shows village-level metrics
   when a village is picked from the dropdown.
   ======================================================================== */
(function(){
  'use strict';
  var DATA_URL = 'data/mp_climate_data.json';
  var state = { data: null, currentDistrict: null, currentVillage: null };

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

  function applyDistrictPatch(payload){
    if (typeof MP_DISTRICTS === 'undefined') return false;
    Object.keys(payload.districts).forEach(function(key){
      var d = payload.districts[key];
      if (!MP_DISTRICTS[key]) {
        // Add the district if it wasn't there (key matches the dashboard convention)
        MP_DISTRICTS[key] = {name: d.name, lat: d.lat, lng: d.lng, blocks: {}};
      }
      MP_DISTRICTS[key].name    = d.name;
      MP_DISTRICTS[key].lat     = d.lat;
      MP_DISTRICTS[key].lng     = d.lng;
      MP_DISTRICTS[key].risk    = d.risk;
      MP_DISTRICTS[key].drought = d.drought;
      MP_DISTRICTS[key].heat    = d.heat;
      if (d.ndvi != null) MP_DISTRICTS[key].ndvi = d.ndvi;
      MP_DISTRICTS[key].blocks  = (d.blocks && Object.keys(d.blocks).length > 0) ? d.blocks : (MP_DISTRICTS[key].blocks || {});   // real tehsil → villages
      MP_DISTRICTS[key]._imd    = d.indices;
      MP_DISTRICTS[key]._annual = d.annual;
      MP_DISTRICTS[key]._villages = d.villages || {};
      MP_DISTRICTS[key]._future = d.future_2040 || null;
    });
    console.log('[mp_climate_loader] patched', Object.keys(payload.districts).length, 'districts');
    return true;
  }

  function killChart(canvasId){
    var c = document.getElementById(canvasId); if (!c) return;
    var existing = Chart.getChart ? (Chart.getChart(canvasId) || Chart.getChart(c)) : null;
    if (existing) { try { existing.destroy(); } catch(e) {} }
  }

  // The chart canvases used to render as a large blank area (looked
  // broken/unfinished) until a district was selected -- these divs give
  // that empty state an honest message instead of nothing.
  function setChartEmpty(canvasId, show){
    var el = document.getElementById('empty-' + canvasId);
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function rebuildCharts(districtKey){
    if (typeof Chart === 'undefined' || !state.data) return;
    var ch = state.data.charts;
    var rain = ch.rainfall_monthly_mm[districtKey];
    var temp = ch.temperature_monthly_C[districtKey];
    if (!rain || !temp) return;
    setChartEmpty('chartRain', false);
    setChartEmpty('chartTemp', false);
    setChartEmpty('chartDrought', false);

    var grid = {color:'rgba(138,211,170,0.15)'};
    var commonOpts = (typeof chartOpts === 'function') ? chartOpts(grid)
      : {responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top'}}};

    killChart('chartRain');
    var rc = document.getElementById('chartRain');
    if (rc) new Chart(rc, {type:'bar', data:{
      labels: rain.labels,
      datasets: [
        {label:'Actual (mm)', data: rain.actual, backgroundColor:'rgba(92,195,205,0.5)', borderColor:'#5cc3cd', borderWidth:1},
        {label:'Climatology (mm)', type:'line', data: rain.normal, borderColor:'#6fc795', backgroundColor:'transparent', tension:0.4, borderWidth:2, pointRadius:0}
      ]}, options: commonOpts});

    killChart('chartTemp');
    var tc = document.getElementById('chartTemp');
    if (tc) new Chart(tc, {type:'line', data:{
      labels: temp.labels,
      datasets: [
        {label:'Tmax °C', data: temp.tmax, borderColor:'#f0a878', backgroundColor:'rgba(240,168,120,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0, pointHoverRadius:4},
        {label:'Tmin °C', data: temp.tmin, borderColor:'#5cc3cd', backgroundColor:'transparent', tension:0.4, borderWidth:2, pointRadius:0, pointHoverRadius:4}
      ]}, options: commonOpts});

    killChart('chartDrought');
    var dc = document.getElementById('chartDrought');
    if (dc && ch.rankings && ch.rankings.drought) {
      var labels = ch.rankings.drought.map(function(x){return x.district_name;});
      var vals   = ch.rankings.drought.map(function(x){return x.drought_probability_pct;});
      var colors = vals.map(function(v){return v>=70?'#ec8b9b':v>=50?'#f0a878':v>=30?'#e6cf6b':'#6fc795';});
      new Chart(dc, {type:'bar', data:{
        labels: labels,
        datasets: [{label:'Drought probability %', data: vals, backgroundColor: colors}]
      }, options: commonOpts});
    }
  }

  function renderTrendChart(districtKey){
    if (typeof Chart === 'undefined' || !state.data) return;
    var trends = state.data.charts && state.data.charts.annual_trends && state.data.charts.annual_trends[districtKey];
    if (!trends) return;
    setChartEmpty('chartTrends', false);
    var year = (typeof _hazardYear !== 'undefined' && _hazardYear) || 2024;
    // Historical data (2000-2024)
    var histLabels = trends.years;
    var hwHist = trends.heatwave_days;
    var rainHist = trends.annual_rain_mm;
    var spiHist = trends.spi_12;
    // Forecast data (2025-2040)
    var forecast = (typeof _forecast2040 !== 'undefined' && _forecast2040 && _forecast2040.districts && _forecast2040.districts[districtKey]) ? _forecast2040.districts[districtKey] : null;
    var fcLabels = forecast ? forecast.years : [];
    var hwFc = forecast ? forecast.heatwave_days : [];
    var rainFc = forecast ? forecast.annual_rain_mm : [];
    var spiFc = forecast ? forecast.spi_12 : [];
    // Combined labels up to selected year
    var allYears = histLabels.concat(fcLabels);
    var allHw = hwHist.concat(hwFc);
    var allRain = rainHist.concat(rainFc);
    var allSpi = spiHist.concat(spiFc);
    var maxYear = allYears.length > 0 ? allYears[allYears.length-1] : 2040;
    // Find index of selected year
    var sliceEnd = allYears.length;
    if (year >= 2000) {
      for (var i = 0; i < allYears.length; i++) {
        if (allYears[i] > year) { sliceEnd = i; break; }
      }
    }
    var labels = allYears.slice(0, sliceEnd);
    var hw = allHw.slice(0, sliceEnd);
    var rain = allRain.slice(0, sliceEnd);
    var spi = allSpi.slice(0, sliceEnd);

    // Mark forecast region
    var isForecast = labels.map(function(y){ return y > 2024; });
    var hwColors = hw.map(function(v,i){ return isForecast[i] ? 'rgba(240,168,120,0.25)' : 'rgba(240,168,120,0.5)'; });
    var rainColors = rain.map(function(v,i){ return isForecast[i] ? 'rgba(92,195,205,0.2)' : 'rgba(92,195,205,0.4)'; });

    killChart('chartTrends');
    var tc = document.getElementById('chartTrends');
    if (!tc) return;
    new Chart(tc, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label:'Heatwave Days', data:hw, backgroundColor:hwColors, borderColor:'#f0a878', borderWidth:1, yAxisID:'y'
          },
          {
            label:'Rainfall (mm)', data:rain, backgroundColor:rainColors, borderColor:'#5cc3cd', borderWidth:1, yAxisID:'y1'
          },
          {label:'SPI-12', data:spi, type:'line', borderColor:'#6fc795', backgroundColor:'transparent', tension:0.3, borderWidth:2, pointRadius:0, pointHoverRadius:4, yAxisID:'y'}
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend:{position:'top', labels:{boxWidth:10,font:{size:8}}},
          tooltip: {
            callbacks: {
              afterTitle: function(items){
                var y = items[0].label;
                return parseInt(y) > 2024 ? 'Indicative trend (OLS, not observed)' : '';
              }
            }
          }
        },
        scales: {
          x: {grid:{display:false}},
          y: {position:'left', grid:{color:'rgba(138,211,170,0.1)'}, ticks:{font:{size:8}}},
          y1: {position:'right', grid:{display:false}, ticks:{font:{size:8}}}
        }
      }
    });
    // Update year range label
    var lbl = document.getElementById('trendYearRange');
    if (lbl) lbl.textContent = '2000–' + (year > 2024 ? year + ' (AI)' : year);
    // Call NDVI chart render if available
    if (typeof window._renderNdviChart === 'function') window._renderNdviChart(districtKey);
  }

  // 2026-08-14: this function used to build a "7-day forecast" out of
  // Math.random() jitter around historical means -- a direct fabrication,
  // and one that only ever ran for the 5 MP_DISTRICTS this file covers.
  // Removed. The bottom panel's 7-Day Forecast tab is now driven by
  // national_forecast_loader.js (real Open-Meteo NWP data, any district/
  // block/village nationwide, triggered from national_selector.js's own
  // selection handlers) -- nothing left for this file to call here.

  function renderFuturePanel(districtKey){
    var d = state.data && state.data.districts[districtKey];
    if (!d) return;
    var f = d.future_2040;
    var host = document.getElementById('future-2040-panel'); if (!host) return;
    if (!f) {
      host.innerHTML = '<div style="padding:0.6rem;font-size:0.7rem;font-weight:600;color:var(--text-dim)">'
        + 'CMIP6 future projection unavailable for ' + (d.name || districtKey) + '. Currently run only for '
        + 'the 5 districts with a real IMD baseline (Bhopal, Indore, Jabalpur, Rewa, Sidhi) — '
        + 'see scripts/05b_run_cmip6_2040.py.</div>';
      return;
    }
    function delta(v, unit, invert){
      var arrow = v > 0.5 ? '▲' : v < -0.5 ? '▼' : '◆';
      var color = invert ? (v > 0 ? 'var(--green)' : 'var(--red)')
                         : (v > 0 ? 'var(--red)' : 'var(--green)');
      return '<span style="color:'+color+'">'+arrow+' '+fmt(Math.abs(v),1)+unit+'</span>';
    }
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-clock-rotate-left" style="color:var(--orange);font-size:0.7rem"></i>'
      + '<div class="section-title">2040 PROJECTION (SSP2-4.5, 8-MODEL CMIP6 ENSEMBLE)</div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card"><div class="metric-label">HEATWAVE DAYS/YR</div><div class="metric-value cyan">'+fmt(f.heatwave_days_per_yr,1)+'</div><div style="font-size:0.65rem;font-weight:600">vs baseline: '+delta(f.delta_heatwave_days_per_yr,' d')+'</div></div>'
      + '  <div class="metric-card"><div class="metric-label">PEAK TMAX</div><div class="metric-value" style="color:var(--red)">'+fmt(f.max_summer_tmax,1)+'°C</div><div style="font-size:0.65rem;font-weight:600">vs baseline: '+delta(f.delta_max_summer_tmax,'°C')+'</div></div>'
      + '  <div class="metric-card"><div class="metric-label">R95p mm/yr</div><div class="metric-value" style="color:var(--blue)">'+fmt(f.r95p_mm_per_yr,1)+'</div><div style="font-size:0.65rem;font-weight:600">vs baseline: '+delta(f.delta_r95p_mm_per_yr,' mm',true)+'</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx1day mm</div><div class="metric-value" style="color:var(--blue)">'+fmt(f.rx1day_mm,1)+'</div><div style="font-size:0.65rem;font-weight:600">vs baseline: '+delta(f.delta_rx1day_mm,' mm',true)+'</div></div>'
      + '</div>';
  }

  function renderVillagePanel(districtKey, villageName){
    var d = state.data && state.data.districts[districtKey];
    var host = document.getElementById('village-detail-panel'); if (!host) return;
    if (!d || !villageName) { host.innerHTML = ''; return; }
    // village name lookup
    var match = null;
    var vmap = d.villages || {};
    for (var id in vmap) {
      if ((vmap[id].name||'').toUpperCase() === (villageName||'').toUpperCase()) {
        match = vmap[id]; match._id = id; break;
      }
    }
    if (!match) {
      host.innerHTML = '<div style="padding:0.6rem;font-size:0.7rem;font-weight:600;color:var(--text-dim)">'
        + 'No data for village "'+villageName+'" — village may not be in shapefile.</div>';
      return;
    }
    var i = match.indices;
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-house" style="color:var(--green);font-size:0.7rem"></i>'
      + '<div class="section-title">VILLAGE: '+match.name+' (tehsil '+match.tehsil+', LGD '+match._id+')</div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card"><div class="metric-label">HEATWAVE D/YR</div><div class="metric-value cyan">'+fmt(i.heatwave_days,1)+'</div></div>'
      + '  <div class="metric-card"><div class="metric-label">MAX TMAX</div><div class="metric-value" style="color:var(--red)">'+fmt(i.max_summer_tmax,1)+'°C</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DROUGHT %</div><div class="metric-value" style="color:var(--orange)">'+fmt(i.drought_probability_pct,1)+'%</div></div>'
      + '  <div class="metric-card"><div class="metric-label">DROUGHT MO</div><div class="metric-value" style="color:var(--orange)">'+fmt(i.drought_months,1)+'</div></div>'
      + '  <div class="metric-card"><div class="metric-label">SPI-12</div><div class="metric-value" style="color:var(--blue)">'+fmt(i.spi_12,2)+'</div></div>'
      + '  <div class="metric-card"><div class="metric-label">ANNUAL RAIN</div><div class="metric-value" style="color:var(--blue)">'+fmt(i.annual_rain_mm,0)+' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">R95p</div><div class="metric-value" style="color:var(--blue)">'+fmt(i.r95p_mm,1)+' mm</div></div>'
      + '  <div class="metric-card"><div class="metric-label">Rx1day</div><div class="metric-value" style="color:var(--blue)">'+fmt(i.rx1day_mm,1)+' mm</div></div>'
      + '</div>'
      + '<div style="font-size:0.65rem;font-weight:600;color:var(--text-dim);padding:0 0.75rem 0.5rem">'
      + '  Centroid: '+fmt(match.lat,4)+', '+fmt(match.lon,4)+' — sampled from nearest IMD 0.05° pixel</div>';
  }

  function injectPanels(){
    var bp = document.getElementById('bottom-panel');
    if (!bp || document.getElementById('historical-indices-panel')) return;
    var wrap = document.createElement('div');
    wrap.id = 'mp-legacy-panel-wrap';
    // Owner report 2026-08-14: this column (historical/2040/village detail
    // -- real content ONLY for the 5 IMD districts) used to always render,
    // showing as a blank ~500px white gap for every other selection (all
    // 726 GEE districts, and the default no-selection view). display:none
    // by default now; refreshAll() (a real IMD district was selected)
    // reveals it, _mpClimateClear() (selection moved away) hides it again
    // -- same on/off switch, never a lingering empty box.
    // item 15d (2026-08-15): this wrap's own CSS (border-RIGHT, min/max-
    // WIDTH) was always designed as a side column sitting beside the
    // active tab pane -- but it was being inserted as a direct child of
    // #bottom-panel, which is flex-direction:COLUMN. That stacked it
    // vertically ABOVE .btm-tabs/.btm-content instead of beside the pane,
    // so it had to split #bottom-panel's fixed height with everything
    // else below it -- only ~100-150px left, 1.5 rows of cards visible,
    // no scroll indicator. Moving it inside .btm-content (a row-flex
    // container) puts it where its own CSS already expected it: a real
    // side column at .btm-content's full height, beside whichever pane
    // is active.
    // item 15d follow-up: wrap.style.display gets toggled to 'flex' by
    // refreshAll() below -- plain flex with no flex-direction defaults to
    // ROW, which laid its 3 stacked sections (historical/2040/village)
    // out SIDE BY SIDE instead of one under another, squeezing
    // future-2040-panel into a sliver that overflowed past the wrap's
    // own right edge entirely (found live: futureRect.left=687 was
    // already past wrapRect.right=721 minus its own width). Explicit
    // flex-direction:column fixes the actual stacking, not just the size.
    wrap.style.cssText = 'display:none;flex-direction:column;flex:1;overflow-y:auto;border-right:1px solid var(--border);min-width:380px;max-width:500px;';
    var h = document.createElement('div'); h.id = 'historical-indices-panel'; wrap.appendChild(h);
    var f = document.createElement('div'); f.id = 'future-2040-panel'; wrap.appendChild(f);
    var v = document.createElement('div'); v.id = 'village-detail-panel'; wrap.appendChild(v);
    var btmContent = bp.querySelector('.btm-content');
    if (btmContent) btmContent.insertBefore(wrap, btmContent.firstChild);
    else bp.insertBefore(wrap, bp.firstChild); // fallback, should never hit
  }

  var HAZARD_MAP = {
    heat: ['heatwave','tmax'],
    rain: ['rain','r95p','rx1day','rx5day','cdd','precip'],
    drought: ['drought','spi']
  };

  function hazardKind(){
    return (typeof _activeHazard !== 'undefined') ? _activeHazard : null;
  }

  function decorateHistoricalPanel(districtKey, villageName){
    var d = state.data && state.data.districts[districtKey];
    var host = document.getElementById('historical-indices-panel');
    if (!host) return;
    if (!d) { host.innerHTML = ''; return; }
    var idx = d.indices;
    // If a village is selected, try to use its indices instead of district average
    if (villageName) {
      var vmap = d.villages || {};
      for (var id in vmap) {
        if ((vmap[id].name||'').toUpperCase() === (villageName||'').toUpperCase()) {
          var vi = vmap[id].indices;
          if (vi) {
            idx = {
              village_count: 1,
              heatwave_days_mean: vi.heatwave_days,
              severe_heatwave_days_mean: vi.severe_heatwave_days,
              mean_summer_tmax: vi.max_summer_tmax,
              max_summer_tmax: vi.max_summer_tmax,
              drought_months_per_year_mean: vi.drought_months,
              drought_probability_pct: vi.drought_probability_pct,
              spi12_year_end_mean: vi.spi_12,
              annual_rain_mm_mean: vi.annual_rain_mm,
              r95p_mm_mean: vi.r95p_mm,
              rx1day_mm_mean: vi.rx1day_mm,
              rx5day_mm_mean: vi.rx5day_mm,
              cdd_mean: vi.cdd
            };
          }
          break;
        }
      }
    }
    // If a village was selected but has no indices of its own, fall back to the
    // district mean but say so explicitly in the header rather than labelling
    // district-level numbers as village-level.
    var usedVillageIndices = !!(villageName && idx !== d.indices);
    var hKind = hazardKind();
    var hKeys = hKind ? (HAZARD_MAP[hKind] || []) : [];
    var selYear = (typeof _hazardYear !== 'undefined' && _hazardYear) || '';
    var titleHtml = usedVillageIndices
      ? 'VILLAGE INDICES 2000–2024 <span style="color:var(--green)">'+villageName+'</span>'
      : (villageName
          ? 'DISTRICT INDICES 2000–2024 (' + d.name + ') <span style="color:var(--orange)">— no IMD-derived record for "'+villageName+'"; showing district mean</span>'
          : 'HISTORICAL INDICES 2000–2024 ('+ d.name +', '+ (idx.village_count||0) +' villages)');
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-chart-line" style="color:var(--cyan);font-size:0.7rem"></i>'
      + '<div class="section-title">'+titleHtml+(selYear?' <span style="color:var(--orange)">['+selYear+']</span>':'')+'</div></div>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;padding:0.75rem;">'
      + '  <div class="metric-card'+match_h(hKeys,'heatwave')+'"><div class="metric-label">HEATWAVE DAYS/YR</div><div class="metric-value cyan">'+fmt(idx.heatwave_days_mean,1)+'</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'heatwave')+'"><div class="metric-label">SEVERE HW DAYS</div><div class="metric-value" style="color:var(--red)">'+fmt(idx.severe_heatwave_days_mean,1)+'</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'tmax')+'"><div class="metric-label">MEAN SUMMER TMAX</div><div class="metric-value" style="color:var(--orange)">'+fmt(idx.mean_summer_tmax,1)+'°C</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'tmax')+'"><div class="metric-label">MAX SUMMER TMAX</div><div class="metric-value" style="color:var(--red)">'+fmt(idx.max_summer_tmax,1)+'°C</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'drought')+'"><div class="metric-label">DROUGHT MONTHS/YR</div><div class="metric-value" style="color:var(--orange)">'+fmt(idx.drought_months_per_year_mean,1)+'</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'drought')+'"><div class="metric-label">DROUGHT PROB %</div><div class="metric-value" style="color:var(--orange)">'+fmt(idx.drought_probability_pct,1)+'%</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'spi')+'"><div class="metric-label">SPI-12</div><div class="metric-value" style="color:var(--blue)">'+fmt(idx.spi12_year_end_mean,2)+'</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'rain')+'"><div class="metric-label">ANNUAL RAIN</div><div class="metric-value" style="color:var(--blue)">'+fmt(idx.annual_rain_mm_mean,0)+' mm</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'rain')+'"><div class="metric-label">R95p / YR</div><div class="metric-value" style="color:var(--blue)">'+fmt(idx.r95p_mm_mean,1)+' mm</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'rx1day')+'"><div class="metric-label">Rx1day</div><div class="metric-value" style="color:var(--blue)">'+fmt(idx.rx1day_mm_mean,1)+' mm</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'rx5day')+'"><div class="metric-label">Rx5day</div><div class="metric-value" style="color:var(--blue)">'+fmt(idx.rx5day_mm_mean,1)+' mm</div></div>'
      + '  <div class="metric-card'+match_h(hKeys,'cdd')+'"><div class="metric-label">CDD</div><div class="metric-value" style="color:var(--orange)">'+fmt(idx.cdd_mean,1)+' d</div></div>'
      + '</div>';
  }

  function match_h(hKeys, tag){
    var hK = hazardKind();
    return (!hK) ? '' : (hKeys.indexOf(tag) >= 0 ? ' hazard-tag' : '');
  }

  // ── Ministry of Agriculture Crop Classification ─────────────────
  var CROP_DATA = {
    soilTypes: {
      malwa:     {name:'Black Soil (Regur)',   zones:['indore','dhar','ujjain','ratlam','mandsaur','neemuch','dewas','shajapur','rajgarh','barwani','khargone','khandwa','burhanpur','alirajpur','jhabua'], crops_kharif:['Cotton','Soybean','Maize','Groundnut'], crops_rabi:['Wheat','Gram','Mustard','Safflower'], crops_zayed:['Watermelon','Muskmelon','Fodder'], fert:'10:26:26 NPK @ 125 kg/ha', irrigation:'Drip irrigation recommended. Avoid waterlogging on black soil.'},
      bundelkhand:{name:'Mixed Red & Black',   zones:['sagar','damoh','panna','chhatarpur','tikamgarh','niwari','datia','guna','ashoknagar','shivpuri','morena','bhind','gwalior'], crops_kharif:['Sesame','Groundnut','Bajra','Pigeonpea'], crops_rabi:['Gram','Wheat','Mustard','Lentil'], crops_zayed:['Cucumber','Pumpkin','Moong'], fert:'DAP @ 100 kg/ha + Urea @ 80 kg/ha', irrigation:'Water-scarce zone. Adopt sprinkler irrigation, practice mulching.'},
      narmada:   {name:'Alluvial Clay Loam',   zones:['narsinghpur','jabalpur','hoshangabad','harda','raisen','sehore','bhopal','mandla','dindori'], crops_kharif:['Rice','Soybean','Maize','Pigeonpea'], crops_rabi:['Wheat','Chickpea','Pea','Mustard'], crops_zayed:['Summer Moong','Fodder','Vegetables'], fert:'Urea @ 130 kg/ha + SSP @ 200 kg/ha', irrigation:'Canal irrigation available. Apply paddy irrigation schedule (2-5 cm standing water).'},
      vindhya:   {name:'Red & Yellow Loam',    zones:['rewa','sidhi','satna','maihar','mauganj','singrauli','shahdol','umaria','anuppur','katni'], crops_kharif:['Rice','Maize','Small Millets','Pigeonpea'], crops_rabi:['Wheat','Chickpea','Lentil','Pea','Mustard'], crops_zayed:['Fallow','Vegetables','Moong'], fert:'NPK @ 60:40:40 kg/ha + Zinc @ 25 kg/ha', irrigation:'Rainfed predominant. Farm ponds & check dams recommended.'},
      satpura:   {name:'Laterite & Sandy Loam',zones:['balaghat','seoni','chhindwara','betul','pandhurna'], crops_kharif:['Rice','Maize','Soybean','Ragi'], crops_rabi:['Wheat','Gram','Pea','Lentil'], crops_zayed:['Urd','Moong','Groundnut'], fert:'SSP @ 250 kg/ha + MOP @ 40 kg/ha', irrigation:'High rainfall zone. Drainage channels advised for rice fields.'}
    },
    seasons: {
      kharif: {label:'KHARIF (Monsoon Jun-Oct)', months:[5,6,7,8,9]},
      rabi:   {label:'RABI (Winter Oct-Mar)',    months:[9,10,11,0,1,2]},
      zayed:  {label:'ZAYED (Summer Mar-Jun)',   months:[2,3,4,5]}
    }
  };

  function getSoilType(districtKey){
    var st = CROP_DATA.soilTypes;
    for (var sk in st) {
      if (st[sk].zones.indexOf(districtKey) >= 0) return st[sk];
    }
    return st.malwa; // default
  }

  function getCurrentSeason(){
    var m = new Date().getMonth();
    if (m >= 5 && m <= 9) return 'kharif';    // Jun-Oct
    if (m >= 10 || m <= 2) return 'rabi';      // Nov-Mar
    return 'zayed';                             // Apr-May
  }

  function renderAgriculturePanel(districtKey, villageName){
    var d = state.data && state.data.districts[districtKey];
    if (!d) return;
    var dnEl = document.getElementById('agriDistName');
    if (dnEl) dnEl.textContent = '— '+ d.name + (villageName ? ' › '+villageName : '') + (window._hazardYear ? ' | Year '+window._hazardYear : '');
    var idx = d.indices;
    var vi = null;
    if (villageName) {
      var vmap = d.villages || {};
      for (var id in vmap) {
        if ((vmap[id].name||'').toUpperCase() === (villageName||'').toUpperCase()) {
          vi = vmap[id].indices; break;
        }
      }
    }
    // Rain/heat: village-level IMD indices if available, else the district mean.
    // A specific selected year can override rain (d.annual.annual_rain_mm is a
    // real per-year series); there is no per-year max_summer_tmax series in the
    // published data, so heat always uses the best real value available (village
    // or district mean) rather than an invented conversion from heatwave-day count.
    var rain = (vi && vi.annual_rain_mm != null) ? vi.annual_rain_mm
      : (idx && idx.annual_rain_mm_mean != null) ? idx.annual_rain_mm_mean : null;
    var heat = (vi && vi.max_summer_tmax != null) ? vi.max_summer_tmax
      : (idx && idx.max_summer_tmax != null) ? idx.max_summer_tmax : null;
    var yr = window._hazardYear;
    if (yr && d.annual && d.annual.years) {
      var yi = d.annual.years.indexOf(parseInt(yr));
      if (yi >= 0 && d.annual.annual_rain_mm[yi] != null) rain = d.annual.annual_rain_mm[yi];
    }
    var hasClimateData = rain != null && heat != null;
    // NDVI: real UNDP DiCRA district zonal series (dicra_ndvi_loader.js), latest
    // available point. District-level only -- never derived from SPI/rainfall,
    // and never claimed as village-specific.
    var ndvi = null, ndviIsReal = false;
    if (window._dicraNdvi && window._dicraNdvi.districts && window._dicraNdvi.districts[districtKey]) {
      var ndviSeries = window._dicraNdvi.districts[districtKey].ndvi_mean;
      if (ndviSeries && ndviSeries.length) { ndvi = ndviSeries[ndviSeries.length - 1]; ndviIsReal = true; }
    }

    // Season & soil
    var season = getCurrentSeason();
    var soil = getSoilType(districtKey);
    var sInfo = CROP_DATA.seasons[season];
    var el = function(id){ return document.getElementById(id); };

    // Season header
    var sLabelEl = el('agri-season-name');
    if (sLabelEl) {
      var sLabel = sInfo.label;
      if (season === 'zayed' && soil.crops_zayed && soil.crops_zayed.indexOf('Fallow') >= 0) sLabel += ' — Mostly Fallow';
      sLabelEl.textContent = sLabel;
    }
    if (el('agri-soil-type')) el('agri-soil-type').textContent = soil.name;

    var setTxt = function(id,v,c){ var e=document.getElementById(id); if(e){e.textContent=v;if(c)e.style.color=c;} };

    // Climate-suitability score per candidate crop. Inputs are real IMD rain/heat
    // (required) and real DiCRA NDVI (optional, only if ndviIsReal). This is a
    // heuristic ranking, not a yield forecast -- labelled as such in the UI.
    function scoreCrop(cropName, rainVal, heatVal, ndviVal) {
      var rainScore = Math.min(100, Math.max(0, (rainVal - 400) / 1600 * 100));
      var heatScore = Math.min(100, Math.max(0, 100 - (heatVal - 28) / 18 * 100));
      var base;
      if (ndviVal != null) {
        var ndviScore = Math.min(100, Math.max(0, (ndviVal - 0.2) / 0.4 * 100));
        base = Math.round(ndviScore * 0.3 + rainScore * 0.35 + heatScore * 0.35);
      } else {
        base = Math.round(rainScore * 0.5 + heatScore * 0.5);
      }
      var waterNeed = {Rice:90,Sugarcane:95,Cotton:70,Soybean:55,Maize:65,Wheat:60,Gram:35,Mustard:40,Bajra:30,Pigeonpea:35,Pea:40,Lentil:35,Linseed:45,Moong:35,BlackGram:35,Groundnut:55,Sesame:30,Ragi:40,KodoMillet:30,Urd:35,Cowpea:30,Safflower:40,Chickpea:35,Barley:30};
      var need = waterNeed[cropName.replace(/\s/g,'')] || 50;
      if (rainVal < need * 8) base -= 15;
      if (rainVal > need * 25) base -= 10;
      var heatTolerant = {Bajra:1,KodoMillet:1,Cotton:1,Sesame:1,Groundnut:1,Watermelon:1,Muskmelon:1};
      if (heatTolerant[cropName] && heatVal > 40) base += 5;
      if (!heatTolerant[cropName] && heatVal > 38) base -= 8;
      return Math.min(95, Math.max(10, base));
    }

    var recCrops = soil['crops_' + season] || soil.crops_kharif;
    var topCrop = null, altCrop = null, scores = [];
    if (hasClimateData) {
      scores = recCrops.map(function(c){ return {name:c, score:scoreCrop(c, rain, heat, ndviIsReal ? ndvi : null)}; });
      scores.sort(function(a,b){ return b.score - a.score; });
      topCrop = scores[0] || null;
      altCrop = scores[1] || null;
      if (season === 'zayed' && recCrops.indexOf('Fallow') >= 0) {
        topCrop = {name:'Fallow (most farms)', score:null};
        altCrop = scores[0] || null;
      }
    }

    if (hasClimateData && topCrop) {
      var suitability = topCrop.score == null ? 'SEASONAL' : topCrop.score >= 75 ? 'HIGH' : topCrop.score >= 50 ? 'MEDIUM' : 'LOW';
      var suitColor = topCrop.score == null ? 'var(--cyan)' : topCrop.score >= 75 ? 'var(--green)' : topCrop.score >= 50 ? 'var(--yellow)' : 'var(--red)';
      setTxt('agri-rec-crop', topCrop.name + (topCrop.score != null ? ' (suitability score ' + topCrop.score + '/100)' : ''));
      setTxt('agri-alt-crop', altCrop ? altCrop.name + (altCrop.score != null ? ' (' + altCrop.score + '/100)' : '') : 'Not available');
      setTxt('agri-suitability', suitability, suitColor);
      var cropScore = topCrop.score;
      var cropHealthEl = el('agri-crop-health');
      if (cropHealthEl) {
        if (cropScore == null) {
          cropHealthEl.textContent = 'Not scored (seasonal recommendation)';
          cropHealthEl.style.color = 'var(--text-dim)';
        } else {
          var chColor = cropScore > 70 ? 'var(--green)' : cropScore > 45 ? 'var(--yellow)' : 'var(--red)';
          cropHealthEl.innerHTML = cropScore+'/100<span style="font-size:0.65rem;font-weight:600;margin-left:0.3rem;color:'+chColor+'">'+(cropScore>70?'GOOD FIT':cropScore>45?'FAIR FIT':'POOR FIT')+'</span>';
          cropHealthEl.style.color = chColor;
        }
      }
    } else {
      setTxt('agri-rec-crop', 'Not available — no IMD rainfall/temperature record for this selection');
      setTxt('agri-alt-crop', 'Not available');
      setTxt('agri-suitability', 'NOT AVAILABLE', 'var(--text-dim)');
      var chEl = el('agri-crop-health');
      if (chEl) { chEl.textContent = 'Not available'; chEl.style.color = 'var(--text-dim)'; }
    }

    setTxt('agri-ndvi', ndviIsReal ? ndvi.toFixed(2) : 'Not available');
    setTxt('agri-rain', rain != null ? rain.toFixed(0)+' mm' : 'Not available');

    // Irrigation advisory: general agronomic guidance for the season, only
    // branching on real rainfall when it is available.
    var irrEl = el('agri-irrigation');
    if (irrEl) {
      if (season === 'kharif') {
        irrEl.textContent = (rain != null && rain > 1000)
          ? 'Monsoon rainfall adequate at district mean; prioritise drainage management.'
          : 'Supplemental irrigation may be needed. ' + (soil.irrigation || 'Drip/sprinkler recommended.');
      } else if (season === 'rabi') {
        irrEl.textContent = soil.irrigation || 'Schedule irrigation at critical growth stages (tillering, flowering, grain filling).';
      } else {
        irrEl.textContent = 'Frequent light irrigation recommended for summer crops. Mulching reduces evaporation.';
      }
    }

    // Nutrient management: static reference guidance by agro-climatic soil zone.
    var nutEl = el('agri-nutrient');
    if (nutEl) nutEl.textContent = soil.fert || 'Apply NPK as per soil test. Add FYM at 5-10 t/ha.';

    var fertEl = el('agri-fertilizer');
    if (fertEl) {
      fertEl.textContent = 'General guidance — a soil test is recommended before applying any fertilizer. '
        + (soil.fert || 'Apply NPK as per soil test result.');
    }

    var advisoryEl = el('agri-advisory');
    if (advisoryEl) {
      var locName = villageName || d.name;
      var parts = [];
      parts.push('<strong>' + locName + '</strong> — season: <strong>' + season.toUpperCase() + '</strong>, soil zone: ' + soil.name + '.');
      if (hasClimateData && topCrop) {
        parts.push('Climate-suitability ranking (from IMD rainfall/temperature' + (ndviIsReal ? ' and DiCRA NDVI' : '') + '): <strong>' + topCrop.name + '</strong>' + (altCrop ? ' ahead of ' + altCrop.name : '') + '. This is a heuristic ranking, not a yield forecast.');
      } else {
        parts.push('No IMD-derived rainfall/temperature record is available for this selection, so no crop ranking is shown.');
      }
      if (heat != null && heat > 40) parts.push('Heat stress is likely at this temperature level; consider shade nets and irrigating at dawn/dusk.');
      if (rain != null && rain < 600) parts.push('Rainfall is on the low side; drip irrigation and farm ponds for rainwater harvesting are worth considering.');
      parts.push('Fertilizer/irrigation guidance above is general reference information for this soil zone, not a site-specific soil test result.');
      advisoryEl.innerHTML = parts.join(' ');
    }

    // Groundwater: no CGWB/India-WRIS data is integrated into this dashboard, so
    // an absolute water-table depth is never shown. The stress/recharge fields
    // below are a heuristic derived from real IMD drought probability and
    // rainfall -- labelled INDICATIVE, not a groundwater measurement.
    var haveDroughtSignal = (vi && vi.drought_probability_pct != null) || (idx && idx.drought_probability_pct != null);
    if (haveDroughtSignal && rain != null) {
      var droughtPct = (vi && vi.drought_probability_pct != null) ? vi.drought_probability_pct : idx.drought_probability_pct;
      var gwStress = Math.min(100, Math.max(5, droughtPct * 1.1 + (heat != null && heat > 39 ? 10 : 0) - (rain > 1200 ? 15 : 0)));
      var gwStressLabel = gwStress > 65 ? 'HIGH (indicative)' : gwStress > 45 ? 'MODERATE (indicative)' : gwStress > 30 ? 'LOW-MODERATE (indicative)' : 'LOW (indicative)';
      var gwStressColor = gwStress > 65 ? 'var(--red)' : gwStress > 45 ? 'var(--orange)' : gwStress > 30 ? 'var(--green)' : 'var(--cyan)';
      setTxt('agri-gw-stress', gwStress.toFixed(0)+'% '+gwStressLabel, gwStressColor);
      var irrNeed = season === 'kharif' ? (rain < 800 ? 'HIGH' : 'LOW') : season === 'rabi' ? 'MODERATE' : 'HIGH';
      var irrNeedColor = irrNeed === 'HIGH' ? 'var(--red)' : irrNeed === 'MODERATE' ? 'var(--orange)' : 'var(--green)';
      setTxt('agri-gw-irr-need', irrNeed, irrNeedColor);
      var recharge = rain > 1200 ? 'GOOD (indicative)' : rain > 800 ? 'MODERATE (indicative)' : 'POOR (indicative)';
      var rechargeColor = rain > 1200 ? 'var(--green)' : rain > 800 ? 'var(--yellow)' : 'var(--red)';
      setTxt('agri-gw-recharge', recharge, rechargeColor);
    } else {
      setTxt('agri-gw-stress', 'Not available', 'var(--text-dim)');
      setTxt('agri-gw-irr-need', 'Not available', 'var(--text-dim)');
      setTxt('agri-gw-recharge', 'Not available', 'var(--text-dim)');
    }
    // MERA_KHET_PROMPT.md B2: checked 2026-08-09 whether India-WRIS
    // (indiawris.gov.in) has a public API/bulk download for groundwater
    // level -- it does not (no documented API found; the portal is a
    // form-based dashboard, no dev docs). CGWB's own site
    // (cgwb.gov.in) was also checked, no bulk machine-readable download
    // found. PENDING.md item 4 update, 2026-08-19: a real source WAS
    // found after all -- nwdp.nwic.gov.in (National Water Data Portal)
    // publishes CGWB's own quarterly manual groundwater-level readings as
    // plain CSV, no login. This default text below is the fallback for a
    // district that source doesn't (yet) cover -- groundwater_loader.js
    // (loaded after this file) overwrites this exact field with the real
    // reading + trend whenever dashboard/data/groundwater/<state>/
    // <district>.json exists for the selection; this string is what stays
    // on screen only when it does not. See scripts/16_fetch_groundwater.py.
    // Kept short -- this field sits in a small u-fmw80 metric-card (flex,
    // min-width 80px); the full source sentence overflowed it badly
    // (owner-verified live, 2026-08-19) when it was the long form. The
    // full sentence moves to a title="" hover tooltip instead.
    setTxt('agri-gw-level', 'No CGWB station data yet', 'var(--text-dim)');
    var gwLevelEl0 = document.getElementById('agri-gw-level');
    if (gwLevelEl0) gwLevelEl0.title = 'No CGWB monitoring station found for this district. '
      + 'Source: CGWB via National Water Data Portal (nwdp.nwic.gov.in).';
    renderWellIrrigation(districtKey, villageName);
  }

  // The OTHER half of B2 -- real, already-available data: every village's
  // own well/tubewell-irrigated area is in the Survey of India village
  // profile (irrigated_wells_tubewells_ha), fetched here directly (same
  // URL/cache pattern national_selector.js's own village-profile panel
  // uses -- a second fetch of the same small per-district file is cheap,
  // the browser HTTP cache absorbs it). This is real data; the CGWB
  // groundwater-LEVEL trend above it is not -- the two are never
  // combined into one "groundwater risk" score, since that combination
  // (MERA_KHET_PROMPT.md's actual stated goal -- "jyada nalkoop sinchai +
  // girta bhujal star = khatra") needs the CGWB half, which isn't
  // available.
  var _wellIrrCache = {};
  function renderWellIrrigation(districtKey, villageName) {
    var el2 = document.getElementById('agri-gw-wells');
    var noteEl = document.getElementById('agri-gw-note');
    if (!el2) return;
    var stateSelect = document.getElementById('stateSelect');
    var districtSelect = document.getElementById('districtSelect');
    var stateName = stateSelect ? stateSelect.value : null;
    var districtName = districtSelect ? districtSelect.value : null;
    if (!stateName || !districtName) { el2.textContent = '—'; if (noteEl) noteEl.textContent = ''; return; }
    var slugify = function (s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); };
    var sSlug = slugify(stateName), dSlug = slugify(districtName);
    var key = sSlug + '/' + dSlug;
    function render(data) {
      if (!data || !data.villages) {
        el2.textContent = 'Not available';
        el2.style.color = 'var(--text-dim)';
        if (noteEl) noteEl.textContent = 'No Survey of India village profile file for ' + districtName + '.';
        return;
      }
      var order = data.metadata && data.metadata.field_order;
      var iIrr = order ? order.indexOf('irrigated_wells_tubewells_ha') : -1;
      if (iIrr < 0) { el2.textContent = 'Not available'; el2.style.color = 'var(--text-dim)'; return; }
      var sum = 0, n = 0, total = 0;
      Object.keys(data.villages).forEach(function (k) {
        total++;
        var v = data.villages[k][iIrr];
        if (v != null) { sum += v; n++; }
      });
      el2.textContent = Math.round(sum).toLocaleString('en-IN') + ' ha';
      el2.style.color = null;
      if (noteEl) {
        noteEl.textContent = 'Sum of ' + n + '/' + total + ' villages in ' + districtName + ' with a recorded well/tubewell-irrigated area (Survey of India village profile, ' + (data.metadata && data.metadata.fetch_date || '') + '). Real groundwater-level trend for these wells is not available (see GW LEVEL TREND above) -- this figure alone does not indicate whether the water table is falling.';
      }
    }
    if (_wellIrrCache[key]) { render(_wellIrrCache[key]); return; }
    var url = (typeof resolveDataUrl === 'function') ? resolveDataUrl('data/' + 'village_profiles/' + sSlug + '/' + dSlug + '.json') : ('data/village_profiles/' + sSlug + '/' + dSlug + '.json');
    var ctl = new AbortController();
    var tmr = setTimeout(function () { ctl.abort(); }, 30000);
    fetch(url, { signal: ctl.signal }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { clearTimeout(tmr); _wellIrrCache[key] = d; render(d); })
      .catch(function () { clearTimeout(tmr); el2.textContent = 'Not available'; el2.style.color = 'var(--text-dim)'; });
  }

  function refreshAll(districtKey, villageName){
    state.currentDistrict = districtKey;
    state.currentVillage  = villageName || null;
    var wrap = document.getElementById('mp-legacy-panel-wrap');
    if (wrap) wrap.style.display = 'flex';
    try { rebuildCharts(districtKey); } catch(e) { console.warn('[loader] rebuildCharts:', e); }
    try { renderTrendChart(districtKey); } catch(e) { console.warn('[loader] renderTrendChart:', e); }
    // renderForecast() removed 2026-08-14 (was fabricated) -- the 7-Day
    // Forecast tab is now driven nationally by national_forecast_loader.js
    // via national_selector.js's selection handlers, not from here.
    try { decorateHistoricalPanel(districtKey, villageName); } catch(e) { console.warn('[loader] decorateHistoricalPanel:', e); }
    try { renderFuturePanel(districtKey); } catch(e) { console.warn('[loader] renderFuturePanel:', e); }
    try { renderVillagePanel(districtKey, villageName); } catch(e) { console.warn('[loader] renderVillagePanel:', e); }
    try { renderAgriculturePanel(districtKey, villageName); } catch(e) { console.warn('[loader] renderAgriculturePanel:', e); }
  }

  window._mpClimateRefresh = function(){
    var dk = state.currentDistrict;
    if (dk && state.data && state.data.districts[dk]) refreshAll(dk, state.currentVillage);
  };
  // Called directly from national_selector.js's selectVillage once it has
  // asynchronously resolved the real village name from the Survey of India
  // feature -- window.onVillageChange's own wrapper below can't do this
  // reliably itself, since it runs synchronously right after being called
  // with whatever raw value the Village dropdown held (a vil_lgd code, not
  // a name), before that async resolution finishes.
  window._mpClimateRefreshVillage = function(districtKey, villageName){
    if (districtKey && state.data && state.data.districts[districtKey]) refreshAll(districtKey, villageName);
  };

  // Called from national_selector.js whenever the selection moves to a
  // state/district with no real IMD data, so every panel this loader owns
  // drops back to empty rather than keeping the previous real district's
  // (or village's) numbers on screen -- most of the render* functions above
  // return early on `!d` without touching their host element, which is
  // correct for "don't re-render" but wrong for "the old selection is gone
  // now", so this does the clearing they don't.
  window._mpClimateClear = function(){
    state.currentDistrict = null;
    state.currentVillage = null;
    ['chartRain', 'chartTemp', 'chartDrought', 'chartTrends'].forEach(function(id){
      try { killChart(id); } catch(e) {}
      setChartEmpty(id, true);
    });
    ['historical-indices-panel', 'village-detail-panel', 'future-2040-panel'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    var wrap = document.getElementById('mp-legacy-panel-wrap');
    if (wrap) wrap.style.display = 'none';
    var agriName = document.getElementById('agriDistName'); if (agriName) agriName.textContent = '';
    // The map marker itself is national_selector.js's own `marker` var now
    // (built from the actual drawn polygon via turf.pointOnFeature at all
    // four levels) -- its clearBelow() already handles removing it, so
    // there's no window.villageMarker for this function to clean up.
  };

  function hookDistrictChange(){
    if (typeof onDistrictChange !== 'function') return;
    if (window._mpClimateHooked) return;
    // state.data.districts is keyed by MP_DISTRICTS' lowercase key
    // ("bhopal"), but whatever calls window.onDistrictChange/onVillageChange
    // may pass the District dropdown's raw value, which is now the
    // district's plain display name ("Bhopal") for every state including
    // MP, same as every other district nationally -- not necessarily
    // already-lowercase. Normalize before the lookup rather than assume.
    function resolveKey(v) { return v ? String(v).trim().toLowerCase() : null; }
    var origDist = onDistrictChange;
    window.onDistrictChange = function(key){
      origDist.call(this, key);
      var rk = resolveKey(key);
      if (rk && state.data && state.data.districts[rk]) refreshAll(rk, null);
    };
    if (typeof onVillageChange === 'function') {
      var origVil = onVillageChange;
      // No auto-refreshAll here -- name is whatever the Village dropdown's
      // raw value is at call time (a vil_lgd code, not a village name), and
      // this runs before national_selector.js's async name resolution
      // finishes. window._mpClimateRefreshVillage above is the correct,
      // explicit entry point for that, called once the real name is known.
      window.onVillageChange = function(name){
        origVil.call(this, name);
      };
    }
    window._mpClimateHooked = true;
  }

  function setLoadingStatus(msg, isError){
    var el = document.getElementById('data-status');
    if (!el) {
      var bp = document.getElementById('bottom-panel');
      if (!bp) return;
      el = document.createElement('div');
      el.id = 'data-status';
      el.style.cssText = 'padding:0.3rem 0.75rem;font-size:0.65rem;font-weight:600;flex-shrink:0;display:flex;align-items:center;gap:0.5rem;border-bottom:1px solid var(--border);background:rgba(10,31,20,0.98);';
      bp.insertBefore(el, bp.firstChild);
    }
    // Phase 2.8: error state must offer a real retry, not just say what
    // went wrong -- this loader used to just print the failure and stop.
    el.innerHTML = (isError
      ? '<span style="color:var(--red)">\u2716</span><span style="color:var(--red)">'+msg+'</span>' +
        '<button id="climate-retry-btn" style="margin-left:auto;background:var(--red);color:#fff;border:none;' +
        'border-radius:4px;padding:2px 10px;font-size:0.62rem;font-weight:700;cursor:pointer;">Retry</button>'
      : '<span class="live-dot"></span><span style="color:var(--text-dim)">'+msg+'</span>');
    el.style.display = 'flex';
    if (isError) {
      var btn = document.getElementById('climate-retry-btn');
      if (btn) btn.onclick = function () { setLoadingStatus('Retrying...', false); init(); };
    }
  }

  function init(){
    setLoadingStatus('Loading climate data...');
    fetchWithTimeout(DATA_URL).then(function(r){
      if (!r.ok) throw new Error('HTTP '+r.status+' loading '+DATA_URL);
      return r.json();
    }).then(function(payload){
      state.data = payload;
      window._mpClimateData = payload;
      window._mpClimateState = state;
      var tries = 0;
      var iv = setInterval(function(){
        if (applyDistrictPatch(payload) || ++tries > 40) {
          clearInterval(iv);
          injectPanels(); hookDistrictChange();
          // No default district -- charts/historical panel/etc stay in
          // their honest "select a district" placeholder state until the
          // user actually picks one (window.onDistrictChange, hooked
          // above, calls refreshAll then). Never pre-load Bhopal or any
          // other district just because data finished loading.
          setLoadingStatus('Data loaded: ' + Object.keys(payload.districts).length + ' districts', false);
          setTimeout(function(){
            var el = document.getElementById('data-status');
            if (el) el.style.display = 'none';
          }, 5000);
        }
      }, 250);
    }).catch(function(err){
      console.error('[mp_climate_loader] failed:', err);
      setLoadingStatus('Data load failed: '+err.message, true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
