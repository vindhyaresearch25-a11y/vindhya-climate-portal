/*
 * groundwater_loader.js -- real CGWB groundwater-level readings, from
 * dashboard/data/groundwater/<state_slug>/<district_slug>.json
 * (scripts/16_fetch_groundwater.py, real CGWB quarterly manual readings
 * via the National Water Data Portal, nwdp.nwic.gov.in).
 *
 * PENDING.md item 4 previously closed this as a dead end (2026-08-09):
 * india-wris.gov.in (no API), gwdata.cgwb.gov.in (maintenance mode),
 * cgwb.gov.in (PDF only), data.gov.in (no resource_id found). This file
 * exists because a real source WAS found (2026-08-19) -- see
 * scripts/16_fetch_groundwater.py's header for the full account and
 * scripts/config.py's GWL_SOURCE_META for the provenance block repeated
 * in every JSON file this loader reads.
 *
 * Pattern deliberately copied from advisory_loader.js / soil_moisture_loader.js
 * rather than invented fresh: manifest-based existence lookup, 30s fetch
 * timeout, own tab/pane via addPane(), district/state tiers, honest
 * "Not available" fallback via showEmpty(). Three states/UTs
 * (Mizoram, Sikkim, Ladakh) are absent from the underlying NWDP dataset
 * itself -- these show the same honest gap as before, never guessed.
 *
 * This loader ALSO overwrites two fields owned by other loaders, once real
 * coverage exists for the selected district -- the same "several loaders
 * legitimately write the same shared DOM node" pattern already used
 * throughout this dashboard (mp_climate_loader.js/national_climate_loader.js
 * both already write m-gw before this file runs; script tag order in
 * index.html puts this file last, so its real-data write wins when it has
 * something real to say, and is a no-op otherwise):
 *   - #m-gw / #bar-gw -- the Climate Metrics side panel's Groundwater card.
 *   - #agri-gw-level -- the Agriculture pane's "GW LEVEL TREND" field
 *     (previously a hardcoded "No public API..." string in
 *     mp_climate_loader.js -- left untouched there as the correct fallback
 *     for districts this new source does NOT cover; only overwritten here
 *     for districts it DOES cover).
 * #agri-gw-stress / #agri-gw-irr-need / #agri-gw-recharge / #agri-gw-wells
 * are NOT touched -- those are a distinct heuristic (drought-probability-
 * derived, explicitly labelled "indicative") and the real Survey-of-India
 * well/tubewell-irrigated-area figure respectively, neither of which this
 * CGWB station data should be blended into.
 */
(function () {
  'use strict';

  var manifestPromise = null;
  var manifestSet = null;        // "stateSlug/districtSlug" -> true
  var manifestMeta = null;
  var districtsIndexPromise = null;
  var stateDistrictTotals = null;
  var cache = {};

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

  function infoIcon(title) {
    return '<i class="fa fa-circle-info" title="' + String(title).replace(/"/g, '&quot;') + '" '
      + 'style="color:var(--text-dim);opacity:0.7;cursor:help;font-size:0.85em;"></i>';
  }

  function slugify(s) {
    return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function el(id) { return document.getElementById(id); }

  function currentSelection() {
    var st = el('stateSelect'), ds = el('districtSelect'), bs = el('blockSelect'), vs = el('villageSelect');
    return {
      stateName: st ? st.value : '',
      districtName: ds ? ds.value : '',
      blockName: bs ? bs.value : '',
      vilLgd: vs ? vs.value : ''
    };
  }

  function fmt(v, d) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d == null ? 2 : d);
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  function loadManifest() {
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetchWithTimeout('data/groundwater/manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        manifestSet = {};
        manifestMeta = m || null;
        if (m && Array.isArray(m.districts)) m.districts.forEach(function (d) { manifestSet[d] = true; });
        return manifestSet;
      })
      .catch(function () { manifestSet = {}; manifestMeta = null; return manifestSet; });
    return manifestPromise;
  }

  function loadDistrictsIndex() {
    if (districtsIndexPromise) return districtsIndexPromise;
    districtsIndexPromise = fetchWithTimeout('data/boundaries/' + 'soi/districts_index.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) {
        stateDistrictTotals = {};
        if (idx && Array.isArray(idx.districts)) {
          idx.districts.forEach(function (d) {
            stateDistrictTotals[d.state_name] = (stateDistrictTotals[d.state_name] || 0) + 1;
          });
        }
        return stateDistrictTotals;
      })
      .catch(function () { stateDistrictTotals = {}; return stateDistrictTotals; });
    return districtsIndexPromise;
  }

  function loadDistrictFile(stateSlug, dslug) {
    var key = stateSlug + '/' + dslug;
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetchWithTimeout('data/groundwater/' + key + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (file) { if (file) cache[key] = file; return file; })
      .catch(function () { return null; });
  }

  function stateNotOnNwdp(stateName) {
    var list = (manifestMeta && manifestMeta.metadata && manifestMeta.metadata.not_on_nwdp) || [];
    return list.indexOf(stateName) !== -1;
  }

  // ---------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------
  function trendColor(direction) {
    if (!direction) return 'var(--text-dim)';
    if (direction.indexOf('deepening') !== -1) return 'var(--red)';
    if (direction.indexOf('rising') !== -1) return 'var(--green,#6fc795)';
    return 'var(--cyan)';
  }

  function trendLabel(direction) {
    if (!direction) return t('Not enough data', 'पर्याप्त डेटा नहीं');
    if (direction.indexOf('deepening') !== -1) return t('Deepening (water table falling)', 'गहराई बढ़ रही है (जल स्तर नीचे)');
    if (direction.indexOf('rising') !== -1) return t('Rising (water table improving)', 'जल स्तर ऊपर आ रहा है (सुधार)');
    return t('Broadly stable', 'लगभग स्थिर');
  }

  function statCard(label, value, color) {
    return '<div class="metric-card"><div class="metric-label">' + label + '</div>'
      + '<div class="metric-value" style="color:' + (color || 'var(--text)') + '">' + value + '</div></div>';
  }

  var SOURCE_LABEL = function () { return t('CGWB via NWDP · station points, district-aggregated', 'CGWB (NWDP के ज़रिए) · स्टेशन बिंदु, ज़िला-स्तर पर एकत्रित'); };
  var SOURCE_TOOLTIP = 'Central Ground Water Board manual quarterly readings, published via the National Water '
    + 'Data Portal (nwdp.nwic.gov.in). Real monitoring-well/piezometer point readings joined to this district by '
    + 'the row\'s own LGD district code, then averaged. Not a village- or block-resolved product. / CGWB के वास्तविक '
    + 'त्रैमासिक मैनुअल रीडिंग, LGD ज़िला कोड से जोड़े गए, फिर औसत किए गए।';
  var SOURCE_NOTE = SOURCE_LABEL() + ' ' + infoIcon(SOURCE_TOOLTIP);

  function renderDistrictTier(file, districtName) {
    var d = file.district || {};
    var meta = file.metadata || {};
    var h = '<div class="section-header"><i class="fa fa-water" style="color:var(--cyan)"></i>'
      + '<div class="section-title">GROUNDWATER — ' + districtName + ' (DISTRICT)</div></div>';

    if (!d.n_stations) {
      h += '<div style="padding:0.6rem 0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
        + t('No CGWB monitoring station found for this district', 'इस ज़िले के लिए कोई CGWB निगरानी स्टेशन नहीं मिला') + ' '
        + infoIcon((file.note || '') + ' State is covered by CGWB/NWDP; this specific district has no usable station reading.')
        + '</div>';
      h += '<div style="padding:0 0.75rem 0.5rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">' + SOURCE_NOTE + '</div>';
      return h;
    }

    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;padding:0.6rem 0.75rem;">'
      + statCard(t('LATEST GWL (m below ground)', 'हालिया GWL (ज़मीन से नीचे मी.)'), fmt(d.latest_gwl_mean_m) + ' m', 'var(--cyan)')
      + statCard(t('N STATIONS', 'स्टेशन संख्या'), d.n_stations, 'var(--green,#6fc795)')
      + statCard(t('LATEST READING DATE', 'हालिया रीडिंग तिथि'), d.latest_reading_date || '—', 'var(--text)')
      + '</div>';

    if (d.trend) {
      h += '<div style="padding:0 0.75rem 0.5rem;">'
        + '<div class="metric-card" style="border-left:3px solid ' + trendColor(d.trend.direction) + ';">'
        + '<div class="metric-label">' + t('TREND (OLS, real quarterly history)', 'ट्रेंड (OLS, वास्तविक इतिहास)') + '</div>'
        + '<div class="metric-value" style="color:' + trendColor(d.trend.direction) + ';font-size:1rem;">' + trendLabel(d.trend.direction) + '</div>'
        + '<div style="font-size:var(--fs-1);color:var(--text-dim);margin-top:0.3rem;">'
        + fmt(d.trend.mean_slope_m_per_year, 4) + ' m/yr · N=' + d.trend.n_stations_with_trend + ' ' + t('stations with a real trend', 'स्टेशन जिनके लिए वास्तविक ट्रेंड मौजूद है') + ' '
        + infoIcon('Plain OLS slope on each station\'s own real quarterly readings (>=4 points needed), averaged across stations. Indicative trend on real history, not a projection -- same style as forecast_2040.json.')
        + '</div></div></div>';
    } else {
      h += '<div style="padding:0 0.75rem 0.5rem;color:var(--text-dim);font-size:var(--fs-1);">'
        + t('Not enough real quarterly readings yet for a trend at any station', 'ट्रेंड के लिए पर्याप्त त्रैमासिक रीडिंग नहीं') + '</div>';
    }

    h += '<div class="section-header" style="margin-top:0.2rem;"><div class="section-title">' + t('STATIONS', 'स्टेशन') + '</div></div>';
    h += '<div style="max-height:200px;overflow:auto;padding:0 0.75rem;">';
    h += '<table style="width:100%;font-size:0.65rem;border-collapse:collapse;">'
      + '<thead><tr style="text-align:left;color:var(--text-dim)"><th>' + t('Station', 'स्टेशन') + '</th><th>' + t('Block', 'ब्लॉक') + '</th>'
      + '<th>' + t('Latest', 'हालिया') + '</th><th>' + t('Date', 'तिथि') + '</th><th>N</th></tr></thead><tbody>';
    (file.stations || []).forEach(function (s) {
      h += '<tr style="border-top:1px solid var(--border);">'
        + '<td style="padding:2px 0;">' + (s.station || '—') + '</td>'
        + '<td>' + (s.block || '—') + '</td>'
        + '<td style="color:var(--cyan)">' + fmt(s.latest_gwl_m) + ' m</td>'
        + '<td>' + (s.latest_date || '—') + '</td>'
        + '<td>' + (s.n_readings != null ? s.n_readings : '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';

    h += '<div style="padding:0.5rem 0.75rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">'
      + SOURCE_NOTE + (meta.date_range ? ' · ' + meta.date_range[0] + ' → ' + meta.date_range[1] : '') + '</div>';
    return h;
  }

  function renderStateTier(stateName, files, nTotal) {
    var h = '<div class="section-header"><i class="fa fa-water" style="color:var(--cyan)"></i>'
      + '<div class="section-title">GROUNDWATER — ' + stateName + ' (STATE)</div></div>';

    if (stateNotOnNwdp(stateName)) {
      h += '<div style="padding:0.6rem 0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
        + t('Not available for this state — not covered by the CGWB/NWDP dataset', 'इस राज्य के लिए उपलब्ध नहीं — CGWB/NWDP डेटासेट में शामिल नहीं') + ' '
        + infoIcon('Checked directly against the NWDP dataset page (2026-08-19): this state/UT has no CGWB groundwater-level resource published there. Not a fetch failure -- a real gap in the source itself.')
        + '</div>';
      return h;
    }

    var withData = files.filter(function (f) { return f.district && f.district.n_stations; });
    if (!withData.length) {
      h += '<div style="padding:0.5rem 0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
        + t('No district in this state has a usable CGWB station reading yet', 'इस राज्य के किसी ज़िले में उपयोगी CGWB स्टेशन रीडिंग नहीं') + '</div>';
      return h;
    }
    var vals = withData.map(function (f) { return f.district.latest_gwl_mean_m; }).filter(function (v) { return v != null; });
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var nStations = withData.reduce(function (a, f) { return a + (f.district.n_stations || 0); }, 0);
    var deepening = 0, rising = 0, stable = 0;
    withData.forEach(function (f) {
      var dir = f.district.trend && f.district.trend.direction;
      if (!dir) return;
      if (dir.indexOf('deepening') !== -1) deepening++;
      else if (dir.indexOf('rising') !== -1) rising++;
      else stable++;
    });
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;padding:0.6rem 0.75rem;">'
      + statCard(t('MEAN OF DISTRICT LATEST GWL', 'ज़िलों के हालिया GWL का औसत'), fmt(mean) + ' m', 'var(--cyan)')
      + statCard(t('N DISTRICTS', 'ज़िले'), withData.length + (nTotal ? ' ' + t('of', 'में से') + ' ' + nTotal : ''), 'var(--green,#6fc795)')
      + statCard(t('N STATIONS', 'स्टेशन'), nStations, 'var(--text)')
      + '</div>';
    h += '<div style="padding:0 0.75rem 0.5rem;font-size:var(--fs-1);color:var(--text-dim);">'
      + t('Trend across districts', 'ज़िलों में ट्रेंड') + ': '
      + '<span style="color:' + trendColor('deepening') + '">' + t('Deepening', 'गिरता') + ' ' + deepening + '</span> · '
      + '<span style="color:' + trendColor('rising') + '">' + t('Rising', 'सुधरता') + ' ' + rising + '</span> · '
      + '<span style="color:var(--text-dim)">' + t('Stable/insufficient', 'स्थिर/अपर्याप्त') + ' ' + (withData.length - deepening - rising) + '</span></div>';
    h += '<div style="padding:0 0.75rem 0.6rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">' + SOURCE_NOTE + '</div>';
    return h;
  }

  // ---------------------------------------------------------------------
  // Shared-field writers (m-gw / bar-gw / agri-gw-level) -- see file header.
  // ---------------------------------------------------------------------
  function setTxt(id, text, color) {
    var e = el(id);
    if (!e) return;
    e.textContent = text;
    if (color) e.style.color = color;
  }

  function updateSharedFields(file, districtName) {
    var d = file && file.district;
    if (!d || !d.n_stations) return; // leave the other loaders' honest "Not available" text alone
    var gwEl = el('m-gw'), barEl = el('bar-gw');
    if (gwEl) { gwEl.textContent = fmt(d.latest_gwl_mean_m) + ' m'; gwEl.className = 'metric-value cyan'; }
    if (barEl) {
      // Deeper (larger m) = worse; a rough 0-30m visual band (30m already covers the CGWB dataset's realistic depth range).
      var pct = Math.min(100, Math.max(0, Math.round((d.latest_gwl_mean_m || 0) / 30 * 100)));
      barEl.style.width = pct + '%';
      barEl.className = 'metric-bar-fill';
      barEl.style.background = 'var(--cyan)';
    }
    // Owner report (2026-09, Hinglish): this card silently showed the same
    // district number at block/village level with no label distinguishing
    // it from a block/village-specific reading -- the CGWB/NWDP source is
    // genuinely only ever resolved at district granularity (stations are
    // aggregated to their district, not their block), so there IS no more
    // specific real number to show here; climateLevelSuffix() says so
    // honestly instead of leaving it ambiguous, same convention already
    // used for the other Climate Metrics cards (national_selector.js).
    var gwLvlSuffix = (typeof window.climateLevelSuffix === 'function') ? window.climateLevelSuffix(false) : '';
    var trendEl = gwEl ? gwEl.parentElement.querySelector('.metric-trend span') : null;
    if (trendEl) trendEl.textContent = (d.trend ? trendLabel(d.trend.direction) : t('Select a district', 'ज़िला चुनें')) + gwLvlSuffix;
    var srcEl = gwEl ? gwEl.parentElement.querySelector('.metric-source') : null;
    if (srcEl) srcEl.textContent = 'Source · CGWB via NWDP · ' + (d.latest_reading_date || '') + gwLvlSuffix;

    // Kept short -- this field sits in a small u-fmw80 metric-card (flex,
    // min-width 80px, sized for one line like its siblings' "MODERATE
    // (indicative)"); the full sentence overflowed it badly (owner-verified
    // live, 2026-08-19). Full detail moves to a title="" hover tooltip.
    var shortDir = !d.trend ? '' : d.trend.direction.indexOf('deepening') !== -1 ? 'falling' :
      d.trend.direction.indexOf('rising') !== -1 ? 'rising' : 'stable';
    setTxt('agri-gw-level',
      fmt(d.latest_gwl_mean_m) + ' m bgl' + (shortDir ? ' · ' + shortDir : ''),
      trendColor(d.trend && d.trend.direction));
    var gwLevelEl = el('agri-gw-level');
    if (gwLevelEl) gwLevelEl.title = d.n_stations + ' CGWB station(s) · ' + trendLabel(d.trend && d.trend.direction)
      + ' · Source: CGWB via National Water Data Portal (nwdp.nwic.gov.in) · latest reading ' + (d.latest_reading_date || '');

    patchWellIrrigationNote(0);
  }

  // renderWellIrrigation() (mp_climate_loader.js) writes #agri-gw-note
  // asynchronously (its own village-profile fetch) with a fixed clause
  // "Real groundwater-level trend for these wells is not available" --
  // true when it was written (no source existed), now stale/wrong for a
  // district this new source covers. There is no ordering guarantee
  // between that fetch and this file's own manifest/district fetch (both
  // triggered by the same selection change), so this polls briefly rather
  // than assuming the note is already there. Patches that one clause only;
  // the real well/tubewell-count sentence around it is untouched. Gives up
  // silently after ~2s -- worst case the caveat is a beat stale, never
  // fabricated.
  function patchWellIrrigationNote(attempt) {
    var noteEl = el('agri-gw-note');
    var target = 'Real groundwater-level trend for these wells is not available (see GW LEVEL TREND above) -- this figure alone does not indicate whether the water table is falling.';
    if (noteEl && noteEl.textContent.indexOf(target) !== -1) {
      noteEl.textContent = noteEl.textContent.replace(target,
        'A real district-level groundwater-level trend IS now available (CGWB via NWDP, see GW LEVEL TREND above) -- but it is not resolved per-well, so it does not confirm the trend at each of these exact wells individually.');
      return;
    }
    if (attempt < 5) setTimeout(function () { patchWellIrrigationNote(attempt + 1); }, 400);
  }

  // ---------------------------------------------------------------------
  // Main render orchestration
  // ---------------------------------------------------------------------
  function showEmpty(msg) {
    var host = el('groundwater-panel-body');
    if (!host) return;
    host.className = 'btm-pane-empty';
    host.innerHTML = '<i class="fa fa-droplet-slash chart-empty-icon"></i><span>' + msg + '</span>'
      + '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> '
      + t('Select district', 'ज़िला चुनें') + '</button>';
  }

  function render() {
    var host = el('groundwater-panel-body');
    if (!host) return;
    host.className = 'u-scroll-pane';
    var sel = currentSelection();
    if (!sel.stateName) {
      showEmpty(t('Select a state/district/block/village', 'राज्य/ज़िला/ब्लॉक/गाँव चुनें'));
      return;
    }
    var stateSlug = slugify(sel.stateName);

    loadManifest().then(function () {
      if (!sel.districtName) {
        // STATE TIER
        var keys = Object.keys(manifestSet).filter(function (k) { return k.indexOf(stateSlug + '/') === 0; });
        if (!keys.length) {
          loadDistrictsIndex().then(function (totals) {
            var host2 = el('groundwater-panel-body');
            if (host2) host2.innerHTML = renderStateTier(sel.stateName, [], totals[sel.stateName]);
          });
          return;
        }
        Promise.all(keys.map(function (k) {
          var parts = k.split('/');
          return loadDistrictFile(parts[0], parts[1]);
        })).then(function (files) {
          files = files.filter(Boolean);
          loadDistrictsIndex().then(function (totals) {
            var host2 = el('groundwater-panel-body');
            if (host2) host2.innerHTML = renderStateTier(sel.stateName, files, totals[sel.stateName]);
            // Owner report (2026-09): m-gw stayed 'Not available' at state
            // level even though a real cross-district mean was already
            // computed and shown right above in this same pane. Guarded on
            // the selection still being this bare state so a fast
            // drill-down into a district isn't clobbered by this slower
            // state-wide fetch resolving late.
            var stillSameBareState = currentSelection().stateName === sel.stateName && !currentSelection().districtName;
            if (!stillSameBareState) return;
            var withData = files.filter(function (f) { return f.district && f.district.n_stations; });
            var gwEl = el('m-gw'), barEl = el('bar-gw');
            if (withData.length) {
              var vals = withData.map(function (f) { return f.district.latest_gwl_mean_m; }).filter(function (v) { return v != null; });
              var meanGwl = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
              if (gwEl) { gwEl.textContent = fmt(meanGwl) + ' m'; gwEl.className = 'metric-value cyan'; }
              if (barEl) { barEl.style.width = Math.min(100, Math.max(0, Math.round(meanGwl / 30 * 100))) + '%'; barEl.className = 'metric-bar-fill'; barEl.style.background = 'var(--cyan)'; }
              var trendEl2 = gwEl ? gwEl.parentElement.querySelector('.metric-trend span') : null;
              if (trendEl2) trendEl2.textContent = sel.stateName + ' state mean · ' + withData.length + (totals[sel.stateName] ? ' of ' + totals[sel.stateName] : '') + ' real districts';
              var srcEl2 = gwEl ? gwEl.parentElement.querySelector('.metric-source') : null;
              if (srcEl2) srcEl2.textContent = 'Source · CGWB via NWDP · state aggregate';
            } else {
              if (gwEl) gwEl.textContent = 'Not available';
              if (barEl) barEl.style.width = '0%';
            }
          });
        });
        return;
      }

      // DISTRICT (or block/village, falls back to parent district) TIER
      var dslug = slugify(sel.districtName);
      var key = stateSlug + '/' + dslug;
      if (!manifestSet[key]) {
        var covered = !stateNotOnNwdp(sel.stateName);
        host.innerHTML = '<div style="padding:0.75rem;color:var(--text-dim);font-size:var(--fs-2);">'
          + (covered
              ? t('No CGWB station data for this district', 'इस ज़िले के लिए CGWB डेटा नहीं')
              : t('Not available — this state is not covered by the CGWB/NWDP dataset', 'उपलब्ध नहीं — यह राज्य CGWB/NWDP डेटासेट में शामिल नहीं'))
          + ' · ' + sel.districtName + ' '
          + infoIcon('Checked directly against nwdp.nwic.gov.in (2026-08-19). No neighbouring district\'s value is substituted.')
          + '</div>';
        updateSharedFields(null, sel.districtName);
        return;
      }
      loadDistrictFile(stateSlug, dslug).then(function (file) {
        if (!file) { showEmpty(t('Failed to load', 'लोड नहीं हुआ') + ' · ' + sel.districtName); return; }
        var host2 = el('groundwater-panel-body');
        if (host2) host2.innerHTML = renderDistrictTier(file, sel.districtName);
        updateSharedFields(file, sel.districtName);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Pane + tab wiring (matches advisory_loader.js's addPane pattern).
  // ---------------------------------------------------------------------
  function addPane() {
    var first = document.querySelector('.btm-pane');
    var host = first ? first.parentNode : null;
    if (!host || el('pane-groundwater')) return;

    var p = document.createElement('div');
    p.className = 'btm-pane';
    p.id = 'pane-groundwater';
    p.innerHTML = '<div class="section-header"><i class="fa fa-water u-cyan-sm"></i>'
      + '<div class="section-title">GROUNDWATER — CGWB (NWDP)</div></div>'
      + '<div style="padding:0.4rem 0.75rem;font-size:var(--fs-1);line-height:1.6;color:var(--text-dim);">'
      + SOURCE_NOTE + '</div>'
      + '<div id="groundwater-panel-body" class="btm-pane-empty">'
      + '<i class="fa fa-droplet-slash chart-empty-icon"></i><span>' + t('Select a state/district/block/village', 'राज्य/ज़िला/ब्लॉक/गाँव चुनें') + '</span>'
      + '<button class="btm-pane-empty-btn" onclick="focusLocationSelector()"><i class="fa fa-location-crosshairs"></i> ' + t('Select district', 'ज़िला चुनें') + '</button></div>';
    host.appendChild(p);

    var firstTab = document.querySelector('.btm-tab');
    var tabs = firstTab ? firstTab.parentNode : null;
    if (tabs && !el('groundwater-tab')) {
      var tab = document.createElement('div');
      tab.innerHTML = '<i class="fa fa-water"></i>Groundwater';
      tab.className = 'btm-tab btm-tab-dup'; // sidebar "Groundwater & Irrigation" already links here (setNav 'ground')
      tab.id = 'groundwater-tab';
      tab.onclick = function () {
        var panes = document.querySelectorAll('.btm-pane'), i;
        for (i = 0; i < panes.length; i++) panes[i].classList.remove('active');
        el('pane-groundwater').classList.add('active');
        var tb = document.querySelectorAll('.btm-tab');
        for (i = 0; i < tb.length; i++) tb[i].classList.remove('active');
        this.classList.add('active');
        render();
      };
      tabs.appendChild(tab);
    }
  }

  // Owner-reported live bug (2026-09): m-soil/m-gw intermittently stayed
  // 'Not available' at DISTRICT level even though this file's own render()
  // had a real value to show, then correctly appeared once a block/village
  // was picked underneath. Root cause: national_climate_loader.js/
  // mp_climate_loader.js write a hardcoded 'Not available' to these same
  // fields as a synchronous default (documented there as "soil_moisture_
  // loader.js/groundwater_loader.js overwrite this right after, whenever
  // real coverage exists") -- an assumption that THIS file's own
  // onDistrictChange wrapper runs outermost (last), which depends on which
  // loader's own async boot()/setTimeout race finishes registering its
  // wrapper last. That race is NOT guaranteed to match <script> tag order
  // (every loader here boots off its own independent setTimeout chain --
  // see national_selector.js's own comment on the same non-determinism for
  // onBlockChange/onVillageChange). Deferring this file's render() to the
  // next tick guarantees it runs strictly after the ENTIRE synchronous
  // onDistrictChange call chain (every wrapper, in whatever order they
  // nested) has finished -- so this file's real-data write is always the
  // final word, never clobbered back to 'Not available' by a differently-
  // ordered reset.
  function wireSelectionHooks() {
    var originalOnDistrictChange = window.onDistrictChange;
    window.onDistrictChange = function (distKey) {
      if (typeof originalOnDistrictChange === 'function') originalOnDistrictChange(distKey);
      setTimeout(render, 0);
    };
    var originalOnBlockChange = window.onBlockChange;
    window.onBlockChange = function (blockName) {
      if (typeof originalOnBlockChange === 'function') originalOnBlockChange(blockName);
      setTimeout(render, 0);
    };
    var originalOnVillageChange = window.onVillageChange;
    window.onVillageChange = function (vilLgd) {
      if (typeof originalOnVillageChange === 'function') originalOnVillageChange(vilLgd);
      setTimeout(render, 0);
    };
    var stateSel = el('stateSelect');
    if (stateSel) stateSel.addEventListener('change', function () { setTimeout(render, 300); });
  }

  function boot() {
    if (!document.querySelector('.btm-pane')) { setTimeout(boot, 700); return; }
    try { addPane(); wireSelectionHooks(); } catch (e) { console.warn('[groundwater_loader]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1000); });
  } else {
    setTimeout(boot, 1000);
  }

  window.VindhyaGroundwater = { reload: render };
})();
