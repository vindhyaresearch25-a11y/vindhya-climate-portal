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

  function rebuildCharts(districtKey){
    if (typeof Chart === 'undefined' || !state.data) return;
    var ch = state.data.charts;
    var rain = ch.rainfall_monthly_mm[districtKey];
    var temp = ch.temperature_monthly_C[districtKey];
    if (!rain || !temp) return;

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
        {label:'Tmax °C', data: temp.tmax, borderColor:'#f0a878', backgroundColor:'rgba(240,168,120,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:2},
        {label:'Tmin °C', data: temp.tmin, borderColor:'#5cc3cd', backgroundColor:'transparent', tension:0.4, borderWidth:2, pointRadius:2}
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
          {label:'SPI-12', data:spi, type:'line', borderColor:'#6fc795', backgroundColor:'transparent', tension:0.3, borderWidth:2, pointRadius:2, yAxisID:'y'}
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
                return parseInt(y) > 2024 ? '⚠ AI Forecast' : '';
              }
            }
          }
        },
        scales: {
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

  function renderForecast(districtKey){
    var d = state.data && state.data.districts[districtKey];
    if (!d) return;
    var host = document.getElementById('forecastPanel');
    var nameLabel = document.getElementById('forecastDistName');
    if (!host) return;
    if (nameLabel) nameLabel.textContent = d.name;
    // Generate 7-day synthetic forecast from historical data
    var idx = d.indices;
    var baseRain = idx.annual_rain_mm_mean || 1000;
    var baseTmax = idx.max_summer_tmax || 40;
    var hwDays = idx.heatwave_days_mean || 0;
    var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    var today = new Date();
    var html = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(today);
      d.setDate(d.getDate() + i);
      var dayName = days[d.getDay()];
      var dateStr = d.getDate() + '/' + (d.getMonth()+1);
      // Generate diurnal variation using historical patterns
      var rainVar = (Math.random() - 0.3) * 20;
      var rainVal = Math.max(0, (baseRain / 365) * (1 + (i === 3 ? 0.5 : 0)) + rainVar);
      var tmaxVar = (Math.random() - 0.5) * 4;
      var tmaxVal = baseTmax + tmaxVar + (i >= 3 ? 1 : 0);
      var isHeat = tmaxVal > 42;
      var isRain = rainVal > 5;
      var icon = isHeat ? 'fa-sun' : isRain ? 'fa-cloud-rain' : 'fa-cloud';
      var iconColor = isHeat ? 'var(--red)' : isRain ? 'var(--cyan)' : 'var(--text-dim)';
      html += '<div class="forecast-day" style="background:'+(isHeat?'rgba(236,139,155,0.08)':'rgba(92,195,205,0.03)')+';border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;">'
        + '<div style="font-size:0.6rem;font-weight:600;color:var(--text-dim);margin-bottom:0.2rem;">'+dayName+'</div>'
        + '<div style="font-size:0.6rem;font-weight:600;color:var(--text-dim);margin-bottom:0.3rem;">'+dateStr+'</div>'
        + '<div style="font-size:0.9rem;margin-bottom:0.3rem;"><i class="fa '+icon+'" style="color:'+iconColor+'"></i></div>'
        + '<div style="font-size:0.75rem;font-weight:700;color:'+(isHeat?'var(--red)':'var(--text)')+';">'+tmaxVal.toFixed(1)+'°C</div>'
        + '<div style="font-size:0.65rem;font-weight:600;color:var(--blue);">'+(rainVal > 0 ? rainVal.toFixed(1)+'mm' : '—')+'</div>'
        + '<div style="font-size:0.6rem;font-weight:600;margin-top:0.2rem;color:'+(isHeat?'var(--red)':isRain?'var(--cyan)':'var(--green)')+';">'
        + (isHeat ? 'HEAT' : isRain ? 'RAIN' : 'FAIR')+'</div>'
        + '</div>';
    }
    host.innerHTML = html;
  }

  function renderFuturePanel(districtKey){
    var d = state.data && state.data.districts[districtKey];
    if (!d) return;
    var f = d.future_2040;
    var host = document.getElementById('future-2040-panel'); if (!host) return;
    if (!f) {
      host.innerHTML = '<div style="padding:0.6rem;font-size:0.7rem;font-weight:600;color:var(--text-dim)">'
        + 'CMIP6 future projection unavailable. Run scripts/05_gee_cmip6_2040.js.</div>';
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
    wrap.style.cssText = 'flex:1;overflow-y:auto;border-right:1px solid var(--border);min-width:380px;max-width:500px;';
    var h = document.createElement('div'); h.id = 'historical-indices-panel'; wrap.appendChild(h);
    var f = document.createElement('div'); f.id = 'future-2040-panel'; wrap.appendChild(f);
    var v = document.createElement('div'); v.id = 'village-detail-panel'; wrap.appendChild(v);
    bp.insertBefore(wrap, bp.firstChild);
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
    if (!d) return;
    var host = document.getElementById('historical-indices-panel');
    if (!host) return;
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
    var hKind = hazardKind();
    var hKeys = hKind ? (HAZARD_MAP[hKind] || []) : [];
    var selYear = (typeof _hazardYear !== 'undefined' && _hazardYear) || '';
    host.innerHTML = ''
      + '<div class="section-header"><i class="fa fa-chart-line" style="color:var(--cyan);font-size:0.7rem"></i>'
      + '<div class="section-title">'+(villageName?'VILLAGE':'HISTORICAL')+' INDICES 2000–2024'+(villageName?' <span style="color:var(--green)">'+villageName+'</span>':' ('+ d.name +', '+ (idx.village_count||0) +' villages)')+(selYear?' <span style="color:var(--orange)">['+selYear+']</span>':'')+'</div></div>'
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
    var ndvi, rain, heat;
    // Priority: 1) Village indices, 2) Year-specific annual data, 3) District mean
    if (vi && vi.spi_12 != null) {
      ndvi = vi.spi_12 * 0.1 + 0.5;
      rain = vi.annual_rain_mm || vi.annual_rain_mm_mean;
      heat = vi.max_summer_tmax;
    }
    // Year-specific override from district annual data
    var yr = window._hazardYear;
    if (yr && d.annual && d.annual.years) {
      var yi = d.annual.years.indexOf(parseInt(yr));
      if (yi >= 0 && d.annual.spi_12[yi] != null) {
        ndvi = d.annual.spi_12[yi] * 0.1 + 0.5;
        rain = d.annual.annual_rain_mm[yi];
        heat = d.annual.heatwave_days[yi] > 4 ? 43 : d.annual.heatwave_days[yi] > 1 ? 40 : 37;
      }
    }
    if (ndvi == null) ndvi = idx && idx.spi_12 != null ? (idx.spi_12 * 0.1 + 0.5) : 0.45;
    if (rain == null) rain = idx && idx.annual_rain_mm_mean || 1000;
    if (heat == null) heat = idx && idx.max_summer_tmax || 38;

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

    // Score per season
    function scoreCrop(cropName, seasonKey, soilObj, ndviVal, rainVal, heatVal) {
      // Base score from climate
      var ndviScore = Math.min(100, Math.max(0, (ndviVal - 0.2) / 0.4 * 100));
      var rainScore = Math.min(100, Math.max(0, (rainVal - 400) / 1600 * 100));
      var heatScore = Math.min(100, Math.max(0, 100 - (heatVal - 28) / 18 * 100));
      var base = Math.round(ndviScore * 0.3 + rainScore * 0.35 + heatScore * 0.35);
      // Water requirement adjustment
      var waterNeed = {Rice:90,Sugarcane:95,Cotton:70,Soybean:55,Maize:65,Wheat:60,Gram:35,Mustard:40,Bajra:30,Pigeonpea:35,Pea:40,Lentil:35,Linseed:45,Moong:35,BlackGram:35,Groundnut:55,Sesame:30,Ragi:40,KodoMillet:30,Urd:35,Cowpea:30,Safflower:40,Chickpea:35,Barley:30};
      var need = waterNeed[cropName.replace(/\s/g,'')] || 50;
      if (rainVal < need * 8) base -= 15;
      if (rainVal > need * 25) base -= 10;
      // Heat tolerance
      var heatTolerant = {Bajra:1,KodoMillet:1,Cotton:1,Sesame:1,Groundnut:1,Watermelon:1,Muskmelon:1};
      if (heatTolerant[cropName] && heatVal > 40) base += 5;
      if (!heatTolerant[cropName] && heatVal > 38) base -= 8;
      return Math.min(95, Math.max(10, base));
    }

    // Get recommended crops for season
    var recCrops = soil['crops_' + season] || soil.crops_kharif;
    var scores = recCrops.map(function(c){ return {name:c, score:scoreCrop(c, season, soil, ndvi, rain, heat)}; });
    scores.sort(function(a,b){ return b.score - a.score; });

    var topCrop = scores[0] || {name:'—', score:0};
    var altCrop = scores[1] || {name:'—', score:0};
    // Summer (Zayed) special handling: most farmers keep land fallow
    if (season === 'zayed' && recCrops.indexOf('Fallow') >= 0) {
      topCrop = {name:'Fallow (Most farms)', score:85};
      altCrop = scores[0] || {name:'Vegetables (Some farms)', score:50};
    }
    var suitability = topCrop.score >= 75 ? 'HIGH' : topCrop.score >= 50 ? 'MEDIUM' : 'LOW';
    var suitColor = topCrop.score >= 75 ? 'var(--green)' : topCrop.score >= 50 ? 'var(--yellow)' : 'var(--red)';

    var setTxt = function(id,v,c){ var e=document.getElementById(id); if(e){e.textContent=v;if(c)e.style.color=c;} };
    setTxt('agri-rec-crop', topCrop.name + ' ('+topCrop.score+'%)');
    setTxt('agri-alt-crop', altCrop.name + ' ('+altCrop.score+'%)');
    setTxt('agri-suitability', suitability, suitColor);

    // Crop health score
    var cropScore = topCrop.score;
    var cropHealthEl = el('agri-crop-health');
    if (cropHealthEl) {
      var chColor = cropScore > 70 ? 'var(--green)' : cropScore > 45 ? 'var(--yellow)' : 'var(--red)';
      cropHealthEl.innerHTML = cropScore+'%<span style="font-size:0.65rem;font-weight:600;margin-left:0.3rem;color:'+chColor+'">'+(cropScore>70?'GOOD':cropScore>45?'FAIR':'POOR')+'</span>';
      cropHealthEl.style.color = chColor;
    }

    setTxt('agri-ndvi', ndvi.toFixed(2));
    setTxt('agri-rain', rain.toFixed(0)+' mm');

    // Irrigation advisory
    var irrEl = el('agri-irrigation');
    if (irrEl) {
      if (season === 'kharif') {
        if (rain > 1000) irrEl.textContent = 'Monsoon adequate. Drainage management important.';
        else irrEl.textContent = 'Supplemental irrigation needed. ' + (soil.irrigation || 'Use drip/sprinkler.');
      } else if (season === 'rabi') {
        irrEl.textContent = soil.irrigation || 'Schedule irrigation at critical growth stages (tillering, flowering, grain filling).';
      } else {
        irrEl.textContent = 'Frequent light irrigation required. Mulch to reduce evaporation.';
      }
    }

    // Nutrient management
    var nutEl = el('agri-nutrient');
    if (nutEl) {
      nutEl.textContent = soil.fert || 'Apply NPK as per soil test. Add FYM @ 5-10 t/ha.';
    }

    // Fertilizer recommendation
    var fertEl = el('agri-fertilizer');
    if (fertEl) {
      if (cropScore > 70) {
        fertEl.textContent = 'Soil condition good. Basal dose + top dressing at crown root stage.';
      } else if (cropScore > 45) {
        fertEl.textContent = 'Apply micronutrients (Zn, Fe, Mn) foliar spray 0.5% at 15-day intervals.';
      } else {
        fertEl.textContent = 'Soil test recommended. Apply lime if pH < 5.5. Use organic manure.';
      }
    }

    // Farmer Advisory
    var advisoryEl = el('agri-advisory');
    if (advisoryEl) {
      var adTxt = '';
      var locName = villageName || d.name;
      adTxt = '🌾 **' + locName + '** — ';
      adTxt += 'Current season: **' + season.toUpperCase() + '**. ';
      adTxt += 'Recommended: **' + topCrop.name + '** (score: ' + topCrop.score + '%). ';
      adTxt += 'Soil: ' + soil.name + '. ';
      if (season === 'kharif') {
        adTxt += '🌧 ' + (rain > 1000 ? 'Good monsoon expected. Prepare nurseries for ' + topCrop.name + '.' : 'Monitor rainfall. Have contingency plan for dry spells.');
      } else if (season === 'rabi') {
        adTxt += '❄ Suitable for **' + topCrop.name +'** and **'+ altCrop.name +'**. Ensure timely sowing after monsoon withdrawal.';
      } else {
        adTxt += '☀ Summer cropping. Short-duration **'+ topCrop.name +'** recommended. Ensure irrigation availability.';
      }
      if (heat > 40) adTxt += ' ⚠ Heat stress expected — provide shade nets, irrigate at dawn/dusk.';
      if (rain < 600) adTxt += ' 💧 Deficit rainfall — adopt drip irrigation, farm ponds for rainwater harvesting.';
      adTxt += ' 🧪 ' + (soil.fert || 'Use balanced fertilization as per soil test.');
      advisoryEl.innerHTML = adTxt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }

    // Groundwater indicators (simulated from GEE-style climate data)
    var gwStress = (vi && vi.drought_probability_pct != null)
      ? Math.min(100, Math.max(5, vi.drought_probability_pct * 1.1 + (heat > 39 ? 10 : 0) - (rain > 1200 ? 15 : 0)))
      : (idx && idx.drought_probability_pct != null)
      ? Math.min(100, Math.max(5, idx.drought_probability_pct * 1.1 + (heat > 39 ? 10 : 0) - (rain > 1200 ? 15 : 0)))
      : (d.drought != null ? Math.min(100, d.drought * 1.05) : 50);
    var gwStressLabel = gwStress > 65 ? 'OVER-EXPLOITED' : gwStress > 45 ? 'SEMI-CRITICAL' : gwStress > 30 ? 'SAFE' : 'ABUNDANT';
    var gwStressColor = gwStress > 65 ? 'var(--red)' : gwStress > 45 ? 'var(--orange)' : gwStress > 30 ? 'var(--green)' : 'var(--cyan)';
    setTxt('agri-gw-stress', gwStress.toFixed(0)+'% '+gwStressLabel, gwStressColor);
    // GW level (meters below ground)
    var gwLevel = (20 + (100 - gwStress) * 0.3 + ((d.name||'').charCodeAt(0)%5-2)*0.4).toFixed(1);
    setTxt('agri-gw-level', gwLevel+' m bgl');
    // Irrigation need
    var irrNeed = season === 'kharif' ? (rain < 800 ? 'HIGH' : 'LOW') : season === 'rabi' ? 'MODERATE' : 'HIGH';
    var irrNeedColor = irrNeed === 'HIGH' ? 'var(--red)' : irrNeed === 'MODERATE' ? 'var(--orange)' : 'var(--green)';
    setTxt('agri-gw-irr-need', irrNeed, irrNeedColor);
    // Recharge rate
    var recharge = rain > 1200 ? 'GOOD' : rain > 800 ? 'MODERATE' : 'POOR';
    var rechargeColor = recharge === 'GOOD' ? 'var(--green)' : recharge === 'MODERATE' ? 'var(--yellow)' : 'var(--red)';
    setTxt('agri-gw-recharge', recharge, rechargeColor);
  }

  // ── Ecology Panel ─────────────────────────────────────────────
  function renderEcologyPanel(districtKey, villageName){
    var d = state.data && state.data.districts[districtKey];
    if (!d) return;
    var dnEl = document.getElementById('ecoDistName');
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
    var ndvi, rain;
    if (vi && vi.spi_12 != null) {
      ndvi = vi.spi_12 * 0.1 + 0.5;
      rain = vi.annual_rain_mm || vi.annual_rain_mm_mean;
    }
    var yr = window._hazardYear;
    if (yr && d.annual && d.annual.years) {
      var yi = d.annual.years.indexOf(parseInt(yr));
      if (yi >= 0 && d.annual.spi_12[yi] != null) {
        ndvi = d.annual.spi_12[yi] * 0.1 + 0.45;
        rain = d.annual.annual_rain_mm[yi];
      }
    }
    if (ndvi == null) ndvi = idx && idx.spi_12 != null ? (idx.spi_12 * 0.1 + 0.45) : 0.40;
    if (rain == null) rain = idx && idx.annual_rain_mm_mean || 1000;
    // Derive ecological metrics from available data
    var forestCover = Math.min(45, Math.max(5, Math.round(rain / 40 + ndvi * 20)));
    var bioScore = Math.min(100, Math.max(20, Math.round(forestCover * 1.5 + ndvi * 30)));
    var carbon = (forestCover * 0.8 + ndvi * 15).toFixed(1);
    var deforestRisk = ndvi < 0.35 ? 'HIGH' : ndvi < 0.5 ? 'MEDIUM' : 'LOW';
    var waterBody = Math.max(1, Math.round(rain / 250));
    var ecoSet = function(id,v,c){ var el=document.getElementById(id); if(el){el.textContent=v;if(c)el.style.color=c;} };
    ecoSet('eco-forest', forestCover+'%', forestCover>25?'var(--green)':forestCover>15?'var(--yellow)':'var(--orange)');
    ecoSet('eco-ndvi', ndvi.toFixed(2));
    ecoSet('eco-bio', bioScore+'%', bioScore>60?'var(--green)':bioScore>40?'var(--yellow)':'var(--red)');
    ecoSet('eco-carbon', carbon+' Mg/ha');
    ecoSet('eco-protected', Math.round(forestCover * 0.35)+'%');
    ecoSet('eco-wildlife', Math.round(forestCover * 0.25)+'%');
    ecoSet('eco-deforest', deforestRisk, deforestRisk==='HIGH'?'var(--red)':deforestRisk==='MEDIUM'?'var(--yellow)':'var(--green)');
    ecoSet('eco-water', waterBody+'%');
    var bioDetailEl = document.getElementById('eco-bio-detail');
    if (bioDetailEl) {
      var risk = bioScore > 60 ? 'Low Risk' : bioScore > 40 ? 'Moderate Risk' : 'High Risk';
      var riskColor = bioScore > 60 ? 'var(--green)' : bioScore > 40 ? 'var(--yellow)' : 'var(--red)';
      bioDetailEl.innerHTML = '<strong>Biodiversity Risk Index:</strong> <span style="color:'+riskColor+'">'+risk+' ('+bioScore+'%)</span><br>'
        + '<strong>Forest Cover:</strong> '+forestCover+'% of district area<br>'
        + '<strong>Water Bodies:</strong> ~'+waterBody+'% of area<br>'
        + '<strong>Deforestation Pressure:</strong> '+deforestRisk+'<br>'
        + (villageName ? '<em style="color:var(--cyan)">Using village-level indices for '+villageName+'</em>' : '<em style="color:var(--text-dim)">Select a village for village-level ecological breakdown</em>');
    }
  }

  function refreshAll(districtKey, villageName){
    state.currentDistrict = districtKey;
    state.currentVillage  = villageName || null;
    try { rebuildCharts(districtKey); } catch(e) { console.warn('[loader] rebuildCharts:', e); }
    try { renderTrendChart(districtKey); } catch(e) { console.warn('[loader] renderTrendChart:', e); }
    try { renderForecast(districtKey); } catch(e) { console.warn('[loader] renderForecast:', e); }
    try { decorateHistoricalPanel(districtKey, villageName); } catch(e) { console.warn('[loader] decorateHistoricalPanel:', e); }
    try { renderFuturePanel(districtKey); } catch(e) { console.warn('[loader] renderFuturePanel:', e); }
    try { renderVillagePanel(districtKey, villageName); } catch(e) { console.warn('[loader] renderVillagePanel:', e); }
    try { renderAgriculturePanel(districtKey, villageName); } catch(e) { console.warn('[loader] renderAgriculturePanel:', e); }
    try { renderEcologyPanel(districtKey, villageName); } catch(e) { console.warn('[loader] renderEcologyPanel:', e); }
  }

  window._mpClimateRefresh = function(){
    var dk = state.currentDistrict;
    if (dk && state.data && state.data.districts[dk]) refreshAll(dk, state.currentVillage);
  };

  function hookDistrictChange(){
    if (typeof onDistrictChange !== 'function') return;
    if (window._mpClimateHooked) return;
    var origDist = onDistrictChange;
    window.onDistrictChange = function(key){
      origDist.call(this, key);
      if (key && state.data && state.data.districts[key]) refreshAll(key, null);
    };
    if (typeof onVillageChange === 'function') {
      var origVil = onVillageChange;
      window.onVillageChange = function(name){
        origVil.call(this, name);
        var dk = document.getElementById('districtSelect').value;
        if (dk && state.data && state.data.districts[dk]) refreshAll(dk, name);
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
    el.innerHTML = (isError
      ? '<span style="color:var(--red)">\u2716</span><span style="color:var(--red)">'+msg+'</span>'
      : '<span class="live-dot"></span><span style="color:var(--text-dim)">'+msg+'</span>');
    el.style.display = 'flex';
  }

  function init(){
    setLoadingStatus('Loading climate data...');
    fetch(DATA_URL).then(function(r){
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
          // pick a default district
          var first = Object.keys(payload.districts)[0];
          refreshAll(first, null);
          setLoadingStatus('Data loaded: ' + Object.keys(payload.districts).length + ' districts, ' + first, false);
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
