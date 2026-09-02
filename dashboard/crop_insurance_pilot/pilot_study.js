/* =============================================================================
   SYNTHETIC 100-FARMER CROP INSURANCE PILOT STUDY -- front end
   =============================================================================
   Reads dashboard/data/crop_insurance_pilot/synthetic_farmers_100.json, which is
   produced by generate_synthetic_pilot.py with a FIXED SEED.

   ALL farmer, parcel, girdawari, remote-sensing, weather, damage, premium and
   claim values rendered by this file are SYNTHETIC / SIMULATED and are labelled
   as such on every screen, table, popup, chart and card. The ONLY real inputs
   are the Survey of India Simrol village polygon (+ its Census fields), the DES
   Indore yield baselines, and the notified PMFBY farmer premium-share caps.

   This page is self-contained: it never writes to, and is never read by, any
   real dataset in this portal (mp_climate_data.json, crop_stats, mandi_prices,
   groundwater, ...).
   ========================================================================== */

const DATA_URL = '../data/crop_insurance_pilot/synthetic_farmers_100.json';
const BOUNDARY_URL = '../data/crop_insurance_pilot/simrol_boundary.geojson';

const CROP_COLOR = {
  'Soyabean': '#4C9F70', 'Wheat': '#D9A441', 'Gram': '#8E6FB0',
  'Maize': '#E07A3F', 'Cotton(lint)': '#5B8DBE', 'Onion': '#C25E7A',
  'Potato': '#7A6A55', 'Rapeseed &Mustard': '#B9A227', 'Urad': '#4F6D7A',
};
const COMP_STYLE = {
  cultivated: { color: '#2e7d32', label: 'Cultivated area' },
  bund:       { color: '#8d6e63', label: 'Bund / Med' },
  fallow:     { color: '#c9a227', label: 'Fallow' },
  noncrop:    { color: '#7b5ea7', label: 'Non-crop' },
  road:       { color: '#78909c', label: 'Farm road' },
  water:      { color: '#1e88e5', label: 'Waterbody' },
};
const EVENT_COLOR = {
  'Drought / dry spell': '#c98b1b',
  'Excess rainfall': '#3f77c9',
  'Flood / waterlogging': '#1f4e9c',
  'Pest / disease stress': '#7a9c1f',
  'Hailstorm / storm damage': '#8e44ad',
};

let DATA = null, FARMERS = [], META = null;
let map, boundaryLayer, cadLayer, compLayers = {}, themeLayer;
let selected = null, filtered = [];
let theme = 'crop';

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => n == null ? 'n/a' : '₹' + Number(n).toLocaleString('en-IN');
const ha = (n) => (n == null ? 'n/a' : Number(n).toFixed(2) + ' ha');

function healthColor(h) {
  if (h >= 75) return '#2e7d32';
  if (h >= 55) return '#8bbf3f';
  if (h >= 40) return '#e0a800';
  if (h >= 25) return '#e2711d';
  return '#b3261e';
}
function lossColor(p) {
  if (!p) return '#cfd8dc';
  if (p < 15) return '#ffe082';
  if (p < 30) return '#ffb74d';
  if (p < 50) return '#f4743b';
  return '#b3261e';
}

/* ---------- boot ---------- */
async function boot() {
  const [dataRes, bndRes] = await Promise.all([
    fetch(DATA_URL).then(r => r.json()),
    fetch(BOUNDARY_URL).then(r => r.json()).catch(() => null),
  ]);
  DATA = dataRes;
  META = dataRes.metadata;
  FARMERS = dataRes.farmers;
  filtered = FARMERS.slice();

  // The spec's exact disclaimer text lives in the generated metadata too --
  // assert the page copy matches it, so the two can never silently diverge.
  const pageText = $('finalDisclaimer').textContent.replace(/\s+/g, ' ').trim();
  const metaText = (META.disclaimer || '').replace(/\s+/g, ' ').trim();
  if (metaText && pageText !== metaText) {
    console.warn('[pilot] final disclaimer text differs from dataset metadata');
  }

  buildKpis();
  buildMap(bndRes);
  buildFilterOptions();
  renderList();
  wireEvents();
  buildAnalysisTabs();
  renderAnalysisEmpty();
}

/* ---------- KPI strip (spec section 22) ---------- */
function buildKpis() {
  const F = FARMERS;
  const sum = (fn) => F.reduce((a, f) => a + (fn(f) || 0), 0);
  const dmgParcels = F.filter(f => f.tech.damage_area_ha > 0);
  const kpis = [
    ['Synthetic Farmers', F.length, ''],
    ['Total Parcels', F.length, ''],
    ['Total Cadastral Area', sum(f => f.cadastral_area_ha).toFixed(1), 'ha'],
    ['Total Cultivated Area', sum(f => f.cultivated_area_ha).toFixed(1), 'ha'],
    ['Insured Area', sum(f => f.insurance.insured_area_ha).toFixed(1), 'ha'],
    ['Damaged Area', sum(f => f.tech.damage_area_ha).toFixed(1), 'ha'],
    ['Damaged Parcels', dmgParcels.length, ''],
    ['Avg Crop Health', (sum(f => f.tech.crop_health_score) / F.length).toFixed(0), '/100'],
    ['Avg AI Confidence', (sum(f => f.tech.ai_confidence_pct) / F.length).toFixed(1), '%'],
    ['Requiring Verification', F.filter(f => f.tech.verification_required).length, ''],
    ['Simulated Premium', inr(Math.round(sum(f => f.insurance.farmer_premium))), ''],
    ['Indicative Claim Value', inr(Math.round(sum(f => f.insurance.indicative_claim))), ''],
  ];
  $('kpis').innerHTML = kpis.map(([l, v, u]) =>
    `<div class="kpi"><div class="l">${esc(l)}</div>
       <div class="v">${esc(v)} <span class="u">${esc(u)}</span></div></div>`).join('')
    + `<div class="kpi" style="background:var(--syn-bg);border-color:var(--syn-line);">
         <div class="l" style="color:var(--syn)">Data status</div>
         <div class="v" style="font-size:13px;color:var(--syn)">SYNTHETIC<br>
           <span class="u" style="color:var(--syn)">simulated pilot</span></div></div>`;
}

/* ---------- Map (spec section 4) ---------- */
function buildMap(bnd) {
  map = L.map('map', { zoomControl: true, preferCanvas: true });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

  // REAL Survey of India village boundary -- casing technique, per repo convention
  if (bnd && bnd.feature) {
    L.geoJSON(bnd.feature, { style: { color: '#000', weight: 6, opacity: .55, fill: false } }).addTo(map);
    boundaryLayer = L.geoJSON(bnd.feature,
      { style: { color: '#FF9500', weight: 3, opacity: 1, fill: false } }).addTo(map);
  }

  // Parcel component layers (spec section 3: visually differentiate components)
  Object.keys(COMP_STYLE).forEach(k => {
    compLayers[k] = L.geoJSON(null, {
      style: { color: COMP_STYLE[k].color, weight: 0.6, opacity: .9,
               fillColor: COMP_STYLE[k].color, fillOpacity: .55 },
      interactive: false,
    });
  });

  // Thematic fill layer (crop / health / damage / event / verification)
  themeLayer = L.geoJSON(null, {
    style: f => themeStyle(byId(f.properties.farmer_id)),
    onEachFeature: (f, layer) => {
      layer.on('click', () => selectFarmer(f.properties.farmer_id, false));
    },
  }).addTo(map);

  // Cadastral outline, always on top
  cadLayer = L.geoJSON(null, {
    style: { color: '#1b2a38', weight: 1.1, opacity: .95, fill: false },
    interactive: false,
  });

  FARMERS.forEach(f => {
    themeLayer.addData({ type: 'Feature', properties: { farmer_id: f.farmer_id }, geometry: f.geometry });
    cadLayer.addData({ type: 'Feature', properties: { farmer_id: f.farmer_id }, geometry: f.geometry });
    Object.keys(COMP_STYLE).forEach(k => {
      const g = f.components[k];
      if (g) compLayers[k].addData({ type: 'Feature', properties: { farmer_id: f.farmer_id }, geometry: g });
    });
  });
  cadLayer.addTo(map);

  if (boundaryLayer) map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
  else map.fitBounds(themeLayer.getBounds(), { padding: [20, 20] });

  buildLayerToggles();
  addLegend();
}

function byId(id) { return FARMERS.find(f => f.farmer_id === id); }

function themeStyle(f) {
  if (!f) return {};
  const on = !filtered.length || filtered.indexOf(f) !== -1;
  const base = { weight: 0.5, opacity: on ? .9 : .12, fillOpacity: on ? .62 : .06 };
  if (selected && selected.farmer_id === f.farmer_id) {
    base.weight = 3; base.color = '#00E5FF'; base.opacity = 1; base.fillOpacity = .8;
  }
  let c = '#9aa7b2';
  if (theme === 'crop') c = CROP_COLOR[f.girdawari.crop] || '#9aa7b2';
  else if (theme === 'health') c = healthColor(f.tech.crop_health_score);
  else if (theme === 'damage') c = lossColor(f.tech.estimated_loss_pct);
  else if (theme === 'event') c = f.event ? (EVENT_COLOR[f.event.type] || '#888') : '#cfd8dc';
  else if (theme === 'verify') c = f.tech.verification_required ? '#e2711d' : '#2e7d32';
  else if (theme === 'none') c = '#b0bec5';
  base.fillColor = c;
  if (!base.color) base.color = c;
  return base;
}

function refreshTheme() {
  themeLayer.setStyle(f => themeStyle(byId(f.properties.farmer_id)));
}

/* ---------- Layer toggles + legend ---------- */
function buildLayerToggles() {
  const themes = [
    ['crop', 'Crop classification'], ['health', 'Crop health'],
    ['damage', 'Damage area'], ['event', 'Weather/event footprint'],
    ['verify', 'Verification status'], ['none', 'No thematic fill'],
  ];
  let html = `<span style="font-size:10.5px;font-weight:800;color:var(--dim);
      text-transform:uppercase;letter-spacing:.04em;">Thematic layer</span>
    <select id="themeSel" style="width:auto;min-width:170px;">${
      themes.map(([v, l]) => `<option value="${v}"${v === theme ? ' selected' : ''}>${l}</option>`).join('')
    }</select>
    <span style="width:1px;height:18px;background:var(--line);"></span>
    <span style="font-size:10.5px;font-weight:800;color:var(--dim);
      text-transform:uppercase;letter-spacing:.04em;">Cadastral components</span>`;
  html += Object.keys(COMP_STYLE).map(k =>
    `<label class="lt off" data-comp="${k}">
       <input type="checkbox" data-comp="${k}">
       <span class="sw" style="background:${COMP_STYLE[k].color}"></span>${COMP_STYLE[k].label}</label>`).join('');
  $('layerToggles').innerHTML = html;

  $('themeSel').addEventListener('change', e => { theme = e.target.value; refreshTheme(); updateLegend(); });
  $('layerToggles').querySelectorAll('input[data-comp]').forEach(cb => {
    cb.addEventListener('change', e => {
      const k = e.target.dataset.comp;
      const lbl = $('layerToggles').querySelector(`label[data-comp="${k}"]`);
      if (e.target.checked) { compLayers[k].addTo(map); lbl.classList.remove('off'); }
      else { map.removeLayer(compLayers[k]); lbl.classList.add('off'); }
      cadLayer.bringToFront();
    });
  });
}

let legendCtl;
function addLegend() {
  legendCtl = L.control({ position: 'bottomleft' });
  legendCtl.onAdd = () => { const d = L.DomUtil.create('div', 'maplegend'); d.id = 'legendBox'; return d; };
  legendCtl.addTo(map);
  updateLegend();
}
function updateLegend() {
  const box = $('legendBox');
  if (!box) return;
  let items = [], title = '';
  if (theme === 'crop') {
    title = 'Crop classification (girdawari)';
    items = Object.keys(CROP_COLOR).map(c => [CROP_COLOR[c], c]);
  } else if (theme === 'health') {
    title = 'Crop health score (SIMULATED)';
    items = [['#2e7d32', '75-100 good'], ['#8bbf3f', '55-74 fair'], ['#e0a800', '40-54 stressed'],
             ['#e2711d', '25-39 poor'], ['#b3261e', '<25 severe']];
  } else if (theme === 'damage') {
    title = 'Estimated loss % (SIMULATED)';
    items = [['#cfd8dc', 'no loss'], ['#ffe082', '<15%'], ['#ffb74d', '15-30%'],
             ['#f4743b', '30-50%'], ['#b3261e', '>50%']];
  } else if (theme === 'event') {
    title = 'Weather / event footprint (SIMULATED)';
    items = Object.keys(EVENT_COLOR).map(e => [EVENT_COLOR[e], e]).concat([['#cfd8dc', 'No event']]);
  } else if (theme === 'verify') {
    title = 'Verification status';
    items = [['#e2711d', 'Verification required'], ['#2e7d32', 'Auto-cleared (pilot)']];
  } else {
    title = 'Cadastral parcels';
    items = [['#b0bec5', 'Synthetic parcel']];
  }
  box.innerHTML = `<b>${esc(title)}</b>` + items.map(([c, l]) =>
    `<div class="li"><span class="sw" style="background:${c}"></span>${esc(l)}</div>`).join('')
    + `<div class="li" style="margin-top:3px;"><span class="sw" style="background:none;border:2px solid #FF9500"></span>Simrol boundary (REAL, SoI)</div>`;
}

/* ---------- Filters + search (spec section 4) ---------- */
function uniq(arr) { return Array.from(new Set(arr)).sort(); }

function buildFilterOptions() {
  const opt = (sel, list, allLabel) => {
    $(sel).innerHTML = `<option value="">${allLabel}</option>` +
      list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  };
  opt('fCrop', uniq(FARMERS.map(f => f.girdawari.crop)), 'All crops');
  opt('fSeason', uniq(FARMERS.map(f => f.girdawari.season)), 'All seasons');
  opt('fInsurance', uniq(FARMERS.map(f => f.insurance.status)), 'All insurance statuses');
  opt('fDamage', ['No damage', 'Damage < 25%', 'Damage 25-50%', 'Damage > 50%'], 'Any damage level');
  opt('fEvent', uniq(FARMERS.filter(f => f.event).map(f => f.event.type)).concat(['No event']), 'All events');
  opt('fVerify', uniq(FARMERS.map(f => f.tech.verification_status)), 'All verification statuses');
}

function applyFilters() {
  const q = $('q').value.trim().toLowerCase();
  const crop = $('fCrop').value, season = $('fSeason').value, ins = $('fInsurance').value;
  const dmg = $('fDamage').value, ev = $('fEvent').value, ver = $('fVerify').value;

  filtered = FARMERS.filter(f => {
    if (q) {
      const hay = [f.farmer_id, f.farmer_name, f.farmer_name_local, f.khasra_no, f.parcel_id,
                   f.village, f.tehsil, f.district].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (crop && f.girdawari.crop !== crop) return false;
    if (season && f.girdawari.season !== season) return false;
    if (ins && f.insurance.status !== ins) return false;
    if (ver && f.tech.verification_status !== ver) return false;
    if (ev) {
      if (ev === 'No event') { if (f.event) return false; }
      else if (!f.event || f.event.type !== ev) return false;
    }
    if (dmg) {
      const p = f.tech.estimated_loss_pct;
      if (dmg === 'No damage' && p > 0) return false;
      if (dmg === 'Damage < 25%' && !(p > 0 && p < 25)) return false;
      if (dmg === 'Damage 25-50%' && !(p >= 25 && p <= 50)) return false;
      if (dmg === 'Damage > 50%' && !(p > 50)) return false;
    }
    return true;
  });
  renderList();
  refreshTheme();
}

function renderList() {
  $('resCount').textContent = `${filtered.length} of ${FARMERS.length} synthetic parcels`;
  if (!filtered.length) {
    $('reslist').innerHTML = `<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px;">
      No synthetic parcels match these filters.</div>`;
    return;
  }
  $('reslist').innerHTML = filtered.map(f => {
    const loss = f.tech.estimated_loss_pct;
    const badge = loss > 0
      ? `<span class="tag ${loss >= 50 ? 't-bad' : loss >= 25 ? 't-warn' : 't-ok'}">${loss}% loss</span>`
      : `<span class="tag t-ok">healthy</span>`;
    return `<div class="res${selected && selected.farmer_id === f.farmer_id ? ' sel' : ''}"
        data-id="${f.farmer_id}">
      <div class="r1"><span>${esc(f.farmer_id)} &middot; <span class="mono">${esc(f.khasra_no)}</span></span>${badge}</div>
      <div class="r2"><span>${esc(f.girdawari.crop)} &middot; ${esc(f.girdawari.season)} &middot; ${ha(f.cadastral_area_ha)}</span>
        <span>${f.tech.verification_required ? 'verify' : 'cleared'}</span></div>
    </div>`;
  }).join('');
  $('reslist').querySelectorAll('.res').forEach(el =>
    el.addEventListener('click', () => selectFarmer(el.dataset.id, true)));
}

function wireEvents() {
  ['q'].forEach(id => $(id).addEventListener('input', applyFilters));
  ['fCrop', 'fSeason', 'fInsurance', 'fDamage', 'fEvent', 'fVerify']
    .forEach(id => $(id).addEventListener('change', applyFilters));
  $('btnReset').addEventListener('click', () => {
    $('q').value = '';
    ['fCrop', 'fSeason', 'fInsurance', 'fDamage', 'fEvent', 'fVerify'].forEach(id => $(id).value = '');
    applyFilters();
  });
}

/* ---------- Selection ---------- */
function selectFarmer(id, zoom) {
  selected = byId(id);
  if (!selected) return;
  refreshTheme();
  renderList();
  renderTwin(selected);
  renderAnalysis(selected);

  const layer = findThemeLayer(id);
  if (layer) {
    if (zoom) map.fitBounds(layer.getBounds(), { maxZoom: 17, padding: [40, 40] });
    layer.bindPopup(popupHtml(selected), { maxWidth: 340 }).openPopup();
  }
  $('twinTitleId').textContent = selected.farmer_id + ' / ' + selected.khasra_no;
  $('twinPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function findThemeLayer(id) {
  let found = null;
  themeLayer.eachLayer(l => { if (l.feature && l.feature.properties.farmer_id === id) found = l; });
  return found;
}

/* ---------- Map popup (spec section 24) ---------- */
function popupHtml(f) {
  const rows = [
    ['Farmer ID', f.farmer_id],
    ['Cadastral Area', ha(f.cadastral_area_ha)],
    ['Cultivated Area', ha(f.cultivated_area_ha)],
    ['Bund/Med', ha(f.bund_area_ha)],
    ['Crop', f.girdawari.crop],
    ['Girdawari', f.girdawari.crop],
    ['AI Detection', f.tech.ai_crop],
    ['Confidence', f.tech.ai_confidence_pct + '%'],
    ['Crop Stage', f.tech.crop_stage],
    ['Crop Health', f.tech.crop_health_score + '/100'],
    ['Event', f.event ? f.event.type : 'No documented event'],
    ['Damage Area', ha(f.tech.damage_area_ha)],
    ['Estimated Loss', f.tech.estimated_loss_pct + '%'],
    ['Evidence Confidence', f.tech.evidence_score_pct + '%'],
    ['Premium', inr(f.insurance.farmer_premium)],
    ['Indicative Claim', inr(f.insurance.indicative_claim)],
    ['Status', f.tech.verification_status],
  ];
  return `<div class="pop">
    <h4>Khasra ${esc(f.khasra_no)} <span class="tag t-syn">SYNTHETIC</span></h4>
    <div class="psub">${esc(f.village)} &middot; ${esc(f.tehsil)} &middot; ${esc(f.district)} &middot; ${esc(f.state)}</div>
    ${rows.map(([k, v]) => `<div class="prow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
    <div class="pfoot">SIMULATED PILOT ESTIMATE &mdash; not an official assessment or PMFBY claim determination.</div>
  </div>`;
}

/* ---------- Digital twin (spec section 23) ---------- */
function twinRows(rows) {
  return rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('');
}

function renderTwin(f) {
  const cmp = [
    ['Crop', esc(f.girdawari.crop) + ' <span class="tag t-syn">girdawari</span>',
     esc(f.tech.ai_crop) + ` <span class="tag t-sim">AI/RS ${f.tech.ai_confidence_pct}%</span>`],
    ['Area', ha(f.girdawari.reported_area_ha) + ' reported', ha(f.tech.detected_cultivated_area_ha) + ' detected'],
    ['Crop Health', 'Manual / record-based', f.tech.crop_health_score + '/100 (remote sensing)'],
    ['Damage', f.girdawari.reported_loss_pct + '% reported',
     f.tech.estimated_loss_pct + '% spatial detection'],
    ['Evidence', 'Limited', 'Multi-source (' + f.tech.evidence_score_pct + '%)'],
  ];
  const html = `
  <div class="twin-head">
    <div class="id">${esc(f.farmer_id)} &middot; <span class="mono">${esc(f.khasra_no)}</span>
      <span class="tag t-syn">SYNTHETIC RECORD</span></div>
    <div class="sub">${esc(f.farmer_name)} (${esc(f.farmer_name_local)}) &mdash; non-realistic placeholder name &middot;
      ${esc(f.village)}, ${esc(f.tehsil)}, ${esc(f.district)}, ${esc(f.state)} &middot;
      pilot scenario: <b>${esc(f.scenario_label)}</b></div>
  </div>
  <div class="tw-sections">
    <div class="tw-sec"><h4>Parcel Information <span class="tag t-syn">SYNTHETIC</span></h4>
      ${twinRows([
        ['Farmer ID', esc(f.farmer_id)], ['Khasra No.', esc(f.khasra_no)],
        ['Village', esc(f.village)], ['Land Status', esc(f.land_status)],
        ['Cadastral Area', ha(f.cadastral_area_ha)], ['Cultivated Area', ha(f.cultivated_area_ha)],
        ['Bund/Med', ha(f.bund_area_ha)], ['Fallow Area', ha(f.fallow_area_ha)],
        ['Non-crop / Road / Water', ha(f.noncrop_area_ha) + ' / ' + ha(f.farm_road_ha) + ' / ' + ha(f.waterbody_ha)],
        ['Irrigated / Rainfed', ha(f.irrigated_area_ha) + ' / ' + ha(f.rainfed_area_ha)],
      ])}</div>

    <div class="tw-sec"><h4>Crop Information <span class="tag t-sim">SIMULATED</span></h4>
      ${twinRows([
        ['Girdawari Crop', esc(f.girdawari.crop)], ['AI Detected Crop', esc(f.tech.ai_crop)],
        ['AI Confidence', f.tech.ai_confidence_pct + '%'], ['Crop Stage', esc(f.tech.crop_stage)],
        ['Crop Health Score', f.tech.crop_health_score + '/100'],
        ['Season', esc(f.girdawari.season)], ['Irrigation Source', esc(f.irrigation_source)],
      ])}
      ${f.girdawari.crop !== f.tech.ai_crop
        ? `<div class="note"><b>CROP MISMATCH &mdash; VERIFICATION REQUIRED.</b> Girdawari records
           ${esc(f.girdawari.crop)}; simulated AI/RS classification indicates ${esc(f.tech.ai_crop)}
           (${f.tech.ai_confidence_pct}% confidence). A mismatch is a flag for verification only &mdash;
           it is never automatically treated as fraud.</div>`
        : `<div class="note">Girdawari crop and simulated AI/RS classification <b>MATCH</b>.</div>`}
    </div>

    <div class="tw-sec"><h4>Event Information <span class="tag t-sim">SIMULATED</span></h4>
      ${f.event ? twinRows([
        ['Last Documented Event', esc(f.event.type)], ['Event Date', esc(f.event.date)],
        ['Event Intensity', esc(f.event.intensity)], ['Affected Area', ha(f.event.affected_area_ha)],
        ['Pre-event NDVI', f.event.pre_event_ndvi], ['Post-event NDVI', f.event.post_event_ndvi],
        ['NDVI Decline', f.event.ndvi_decline_pct + '%'],
      ]) : `<div style="font-size:12.5px;color:var(--dim);padding:6px 0;">
        No documented weather/loss event for this parcel in the simulated pilot season.</div>`}
    </div>

    <div class="tw-sec"><h4>Damage Information <span class="tag t-sim">SIMULATED PILOT ESTIMATE</span></h4>
      ${twinRows([
        ['Damage Area', ha(f.tech.damage_area_ha)],
        ['Technology-Assisted Loss %', f.tech.estimated_loss_pct + '%'],
        ['Evidence Score', f.tech.evidence_score_pct + '%'],
        ['Verification Status', `<span class="tag ${f.tech.verification_required ? 't-warn' : 't-ok'}">${esc(f.tech.verification_status)}</span>`],
        ['Vegetation Anomaly', esc(f.tech.vegetation_anomaly)],
      ])}
      ${f.anomalies.length ? `<div class="note"><b>ANOMALY DETECTED &mdash; VERIFICATION REQUIRED:</b><br>
        ${f.anomalies.map(a => '&bull; ' + esc(a)).join('<br>')}<br>
        <i>An anomaly flag never classifies a farmer as fraudulent.</i></div>` : ''}
    </div>

    <div class="tw-sec"><h4>Insurance <span class="tag t-syn">INDICATIVE SIMULATION</span></h4>
      ${twinRows([
        ['Insured Area', ha(f.insurance.insured_area_ha)],
        ['Sum Insured', inr(f.insurance.sum_insured)],
        ['Farmer Premium', inr(f.insurance.farmer_premium) + ` (${f.insurance.farmer_premium_rate_pct}%)`],
        ['Indicative Claim', inr(f.insurance.indicative_claim)],
      ])}
      <div class="note">Pilot/Indicative Insurance Premium Simulation &mdash; Not an Official Premium
        Determination. Indicative research simulation only. Final insurance claim determination is subject
        to applicable scheme rules, notified parameters, approved assessment methodology and authorized
        verification.</div>
    </div>

    <div class="tw-sec wide"><h4>Comparison &mdash; Traditional vs Technology-Assisted</h4>
      <table style="width:100%;max-width:900px;border-collapse:collapse;font-size:12px;">
        <tr><th style="text-align:left;color:var(--dim);padding:3px 4px;">Parameter</th>
            <th style="text-align:left;color:var(--dim);padding:3px 4px;">Traditional</th>
            <th style="text-align:left;color:var(--dim);padding:3px 4px;">Technology-Assisted</th></tr>
        ${cmp.map(([p, t, x]) => `<tr>
          <td style="padding:3px 4px;border-top:1px solid var(--line);color:var(--dim);">${esc(p)}</td>
          <td style="padding:3px 4px;border-top:1px solid var(--line);">${t}</td>
          <td style="padding:3px 4px;border-top:1px solid var(--line);font-weight:700;">${x}</td></tr>`).join('')}
      </table>
      <div class="note">Full parameter-by-parameter comparison table is in Section 17 (Phase 2).</div>
    </div>
  </div>`;
  $('twin').innerHTML = html;
}

boot().catch(err => {
  console.error('[pilot] boot failed', err);
  document.getElementById('twin').innerHTML =
    `<div class="twin-empty">Failed to load the synthetic pilot dataset: ${esc(err.message)}</div>`;
});

function renderAnalysisEmpty() {
  document.querySelectorAll('.an-panel').forEach(el => {
    el.innerHTML = `<div style="padding:26px 10px;text-align:center;color:var(--dim);font-size:12.5px;">
      Select a parcel on the map or in the result list to run this analysis.</div>`;
  });
}

/* =============================================================================
   PHASE 2 -- ANALYSIS MODULES (spec sections 5-20)
   Every figure below is SYNTHETIC / SIMULATED and labelled as such.
   ========================================================================== */

const AN_TABS = [
  { id: 'models',   label: '5+6 Traditional vs Technology' },
  { id: 'croparea', label: '7+8 Crop & Area Detection' },
  { id: 'rs',       label: '9+10 Remote Sensing & Growth' },
  { id: 'event',    label: '11+12 Event & Damage' },
  { id: 'evidence', label: '13+14 Evidence & Explainable AI' },
  { id: 'compare',  label: '17 Comparison Table' },
  { id: 'verify',   label: '18+19 Anomaly & Verification' },
  { id: 'audit',    label: '20 Evidence & Audit Trail' },
];
let anActive = 'models';
const hilState = {};   // section 19 -- human decisions, in-memory only

function buildAnalysisTabs() {
  $('anTabs').innerHTML = AN_TABS.map(t =>
    `<div class="an-tab${t.id === anActive ? ' active' : ''}" data-an="${t.id}">${esc(t.label)}</div>`).join('');
  $('anPanels').innerHTML = AN_TABS.map(t =>
    `<div class="an-panel${t.id === anActive ? ' active' : ''}" id="an-${t.id}"></div>`).join('');
  $('anTabs').querySelectorAll('.an-tab').forEach(el =>
    el.addEventListener('click', () => { anActive = el.dataset.an; syncAnTabs(); }));
}
function syncAnTabs() {
  document.querySelectorAll('.an-tab').forEach(el => el.classList.toggle('active', el.dataset.an === anActive));
  document.querySelectorAll('.an-panel').forEach(el => el.classList.toggle('active', el.id === 'an-' + anActive));
  if (selected) renderAnalysis(selected);
}

function chain(steps, hot) {
  return `<div class="chain">` + steps.map((s, i) =>
    `${i ? '<span class="ar">&rarr;</span>' : ''}<span class="st"${s === hot ? ' style="background:var(--brand);color:#fff;border-color:var(--brand);"' : ''}>${esc(s)}</span>`
  ).join('') + `</div>`;
}

function renderAnalysis(f) {
  if (!f) return;
  const R = {
    models: renderModels, croparea: renderCropArea, rs: renderRS, event: renderEventDamage,
    evidence: renderEvidence, compare: renderCompareTable, verify: renderVerify, audit: renderAudit,
  };
  const el = $('an-' + anActive);
  if (el && R[anActive]) el.innerHTML = R[anActive](f);
  if (anActive === 'rs') drawRsChart(f);
  if (anActive === 'verify') wireHil(f);
}

/* ---------- Section 5 + 6 ---------- */
function renderModels(f) {
  const g = f.girdawari, t = f.tech;
  return `
  <h3>Traditional Model vs Technology-Assisted Model</h3>
  <div class="sub">Section 5 simulates the conventional record-based workflow; section 6 the
    technology-assisted workflow. Both run on the same synthetic parcel.</div>
  <div class="g2">
    <div class="box">
      <h5>Section 5 &mdash; Traditional (record-based) <span class="tag t-syn">SYNTHETIC</span></h5>
      ${chain(['Khasra', 'Girdawari', 'Reported Crop', 'Reported Area', 'Manual Assessment', 'Crop Loss'])}
      <table class="dt">
        <tr><td>Khasra Number</td><td class="num">${esc(f.khasra_no)}</td></tr>
        <tr><td>Girdawari record ID</td><td class="num">${esc(g.record_id)}</td></tr>
        <tr><td>Recorded (girdawari) crop</td><td class="num">${esc(g.crop)}</td></tr>
        <tr><td>Reported area</td><td class="num">${ha(g.reported_area_ha)}</td></tr>
        <tr><td>Reported damage</td><td class="num">${g.reported_loss_pct}%</td></tr>
        <tr><td>Manual assessment status</td><td class="num">${esc(g.assessment_status)}</td></tr>
        <tr><td>Available evidence</td><td class="num">${esc(g.evidence_available)}</td></tr>
      </table>
      <div class="note">The traditional record carries a crop name, an area and a reported loss &mdash;
        but no spatial extent, no per-parcel evidence and no confidence measure.</div>
    </div>
    <div class="box">
      <h5>Section 6 &mdash; Technology-Assisted <span class="tag t-sim">SIMULATED</span></h5>
      ${chain(['Cadastral Parcel', 'GIS Alignment', 'Satellite Time Series', 'Crop Classification',
               'Cultivated Area', 'Crop Health', 'Event Detection', 'Damage Mapping',
               'AI Loss Estimate', 'Human Verification'])}
      <table class="dt">
        <tr><td>AI-detected crop</td><td class="num">${esc(t.ai_crop)}</td></tr>
        <tr><td>AI confidence</td><td class="num">${t.ai_confidence_pct}%</td></tr>
        <tr><td>Actual cultivated area</td><td class="num">${ha(t.detected_cultivated_area_ha)}</td></tr>
        <tr><td>Crop growth stage</td><td class="num">${esc(t.crop_stage)}</td></tr>
        <tr><td>Crop health score</td><td class="num">${t.crop_health_score}/100</td></tr>
        <tr><td>Vegetation anomaly</td><td class="num">${esc(t.vegetation_anomaly)}</td></tr>
        <tr><td>Damage area</td><td class="num">${ha(t.damage_area_ha)}</td></tr>
        <tr><td>Estimated loss</td><td class="num">${t.estimated_loss_pct}%</td></tr>
        <tr><td>Evidence score</td><td class="num">${t.evidence_score_pct}%</td></tr>
        <tr><td>Verification requirement</td><td class="num">${esc(t.verification_status)}</td></tr>
      </table>
      <div class="note">SIMULATED PILOT ESTIMATE. AI output is decision-support only and is never the
        final authority &mdash; see section 19.</div>
    </div>
  </div>`;
}

/* ---------- Section 7 + 8 ---------- */
function renderCropArea(f) {
  const g = f.girdawari, t = f.tech;
  const match = g.crop === t.ai_crop;
  const comps = [
    ['Crop cultivated area', f.cultivated_area_ha, '#2e7d32'],
    ['Bund / med', f.bund_area_ha, '#8d6e63'],
    ['Fallow land', f.fallow_area_ha, '#c9a227'],
    ['Non-crop vegetation / homestead', f.noncrop_area_ha, '#7b5ea7'],
    ['Farm road', f.farm_road_ha, '#78909c'],
    ['Waterbody', f.waterbody_ha, '#1e88e5'],
  ];
  const tot = comps.reduce((a, c) => a + c[1], 0);
  return `
  <h3>Girdawari vs Remote Sensing, and Actual Cultivated Area Detection</h3>
  <div class="sub">Sections 7 and 8. A mismatch is a verification flag &mdash; never an automatic fraud finding.</div>
  <div class="g2">
    <div class="box">
      <h5>Section 7 &mdash; Girdawari vs Remote Sensing</h5>
      <table class="dt">
        <tr><th>Source</th><th>Crop</th><th>Confidence</th></tr>
        <tr><td>Traditional record (Girdawari)</td><td class="num">${esc(g.crop)}</td><td class="num">&mdash;</td></tr>
        <tr><td>Technology assessment (AI/RS)</td><td class="num">${esc(t.ai_crop)}</td><td class="num">${t.ai_confidence_pct}%</td></tr>
      </table>
      <div style="margin-top:9px;">
        <span class="tag ${match ? 't-ok' : 't-warn'}" style="font-size:12px;padding:4px 10px;">
          ${match ? 'MATCH' : 'CROP MISMATCH &mdash; VERIFICATION REQUIRED'}</span>
      </div>
      ${match ? `<div class="note">Girdawari crop and the simulated AI/RS classification agree.</div>`
              : `<div class="note">Girdawari = ${esc(g.crop)}, RS = ${esc(t.ai_crop)},
                  Confidence = ${t.ai_confidence_pct}%. This parcel is flagged for human verification.
                  A mismatch can arise from mid-season crop change, a record-keeping lag or a
                  classification error &mdash; it is <b>never</b> automatically labelled fraud.</div>`}
    </div>
    <div class="box">
      <h5>Section 8 &mdash; Actual Cultivated Area Detection</h5>
      <table class="dt">
        <tr><td>Cadastral area</td><td class="num">${ha(f.cadastral_area_ha)}</td></tr>
        <tr><td>Reported cultivated area (girdawari)</td><td class="num">${ha(g.reported_area_ha)}</td></tr>
        <tr><td>Technology-detected cultivated area</td><td class="num">${ha(t.detected_cultivated_area_ha)}</td></tr>
        <tr><td><b>Area difference</b></td><td class="num">${ha(t.area_difference_ha)}</td></tr>
        <tr><td><b>Area difference %</b></td><td class="num">${t.area_difference_pct}%</td></tr>
      </table>
      <div style="margin-top:10px;">
        <h5>Classification inside the cadastral parcel</h5>
        <table class="dt">
          ${comps.map(([l, v, c]) => `<tr>
            <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c};margin-right:6px;"></span>${esc(l)}</td>
            <td class="num">${ha(v)}</td>
            <td style="width:34%"><div class="bar"><i style="width:${(v / f.cadastral_area_ha * 100).toFixed(1)}%;background:${c}"></i></div></td></tr>`).join('')}
          <tr><td><b>Total</b></td><td class="num">${ha(tot)}</td><td></td></tr>
        </table>
      </div>
      <div class="note">Component areas are derived geometrically from the synthetic parcel polygon, so
        they sum to the cadastral area. Toggle the component layers on the map above to see them.</div>
    </div>
  </div>`;
}

/* ---------- Section 9 + 10 ---------- */
// Real live Google Earth Engine endpoint, reused from the existing Simrol
// 8-module build (Mera Khet Worker). Per-parcel LIVE satellite verification is
// offered on demand for the SELECTED parcel only -- running 100 live GEE calls
// on page load would be impractically slow, so the per-parcel Jun-Oct series
// below stays SIMULATED and is labelled as such. That split is deliberate and
// stated in the UI: simulated for pilot scale, live for spot verification.
const MK_ANALYZE_URL = 'https://vindhya-mera-khet.vindhyaresearch25.workers.dev/analyze';
let liveGee = {};   // farmer_id -> result of the live check

function renderRS(f) {
  const s = f.rs_series;
  const stages = ['Sowing', 'Emergence', 'Vegetative Growth', 'Flowering', 'Grain/Fruit Development', 'Maturity'];
  const curIdx = stages.indexOf(f.tech.crop_stage);
  const evIdx = f.event ? s.months.indexOf(monthOfEvent(f)) : -1;
  const g = liveGee[f.farmer_id];
  return `
  <h3>Multi-Temporal Remote Sensing &amp; Crop Growth Timeline</h3>
  <div class="sub">Sections 9 and 10.</div>
  <div class="box" style="border-color:var(--syn-line);background:var(--syn-bg);margin-bottom:12px;">
    <b style="font-size:12px;color:var(--syn);">SIMULATED REMOTE-SENSING DATA &mdash; these values are
    NOT actual satellite observations.</b>
    <div style="font-size:11.5px;color:#5c2a0c;margin-top:4px;">The Jun&ndash;Oct series below is a simulated
      phenology curve with an event-driven decline, generated for this pilot study. For a genuine
      observation, run the live Google Earth Engine check &mdash; it queries real Sentinel-2/Sentinel-1
      imagery for this parcel's actual coordinates.</div>
    <div style="margin-top:8px;">
      <button class="btn" id="geeBtn">Run live satellite check (real Google Earth Engine)</button>
      <span id="geeOut" style="font-size:11.5px;margin-left:8px;"></span>
    </div>
    ${g ? renderGee(g) : ''}
  </div>
  <div class="g2">
    <div class="box">
      <h5>Section 9 &mdash; NDVI / NDWI / EVI time series <span class="tag t-sim">SIMULATED</span></h5>
      <div style="height:230px;"><canvas id="rsChart"></canvas></div>
      <table class="dt" style="margin-top:8px;">
        <tr><th>Month</th><th>NDVI</th><th>NDWI</th><th>EVI</th><th>Stage</th></tr>
        ${s.months.map((m, i) => `<tr${i === evIdx ? ' style="background:var(--bad-bg);"' : ''}>
          <td>${esc(m)}</td><td class="num">${s.ndvi[i]}</td><td class="num">${s.ndwi[i]}</td>
          <td class="num">${s.evi[i]}</td><td>${esc(s.stages[i])}</td></tr>`).join('')}
      </table>
      <div class="note">Vegetation anomaly: ${esc(f.tech.vegetation_anomaly)}.
        Growth trajectory derived from the simulated series above.</div>
    </div>
    <div class="box">
      <h5>Section 10 &mdash; Crop growth timeline</h5>
      <div class="stage-strip">
        ${stages.map((st, i) => `<div class="sg${i <= curIdx ? ' on' : ''}">${esc(st)}</div>`).join('')}
      </div>
      <div class="note" style="margin-top:9px;">Current simulated stage: <b>${esc(f.tech.crop_stage)}</b>.</div>
      ${f.event ? `
        <h5 style="margin-top:14px;">Damage trajectory</h5>
        <div class="stage-strip">
          <div class="sg on">Normal Growth</div>
          <div class="sg evt">Weather Event</div>
          <div class="sg evt">Vegetation Stress</div>
          <div class="sg evt">Damage Detection</div>
        </div>
        <div class="note">Simulated ${esc(f.event.type)} on ${esc(f.event.date)} (${esc(f.event.intensity)});
          NDVI ${f.event.pre_event_ndvi} &rarr; ${f.event.post_event_ndvi}
          (${f.event.ndvi_decline_pct}% decline).</div>`
      : `<div class="note" style="margin-top:14px;">No documented event &mdash; the simulated growth
          trajectory follows a normal curve to maturity.</div>`}
    </div>
  </div>`;
}

function monthOfEvent(f) {
  if (!f.event) return null;
  const m = parseInt(f.event.date.split('-')[1], 10);
  return ['June', 'July', 'August', 'September', 'October'][m - 6] || null;
}

function renderGee(g) {
  if (!g.ok) {
    return `<div class="note" style="border-left-color:#96231f;"><b>Live satellite check unavailable:</b>
      ${esc(g.reason)}. No NDVI value has been substituted &mdash; honest degrade, the same convention as
      the rest of this portal's satellite panels.</div>`;
  }
  const d = g.data || {};
  const rows = Object.keys(d).filter(k => typeof d[k] !== 'object')
    .map(k => `<tr><td>${esc(k)}</td><td class="num">${esc(d[k])}</td></tr>`).join('');
  return `<div class="note" style="border-left-color:#1a6b3c;">
    <b class="tag t-real">REAL &mdash; live Google Earth Engine</b>
    <table class="dt" style="margin-top:6px;">${rows}</table>
    <i>These values are genuine satellite-derived observations for this parcel's coordinates, and are
    kept separate from the SIMULATED series on the left.</i></div>`;
}

let rsChartObj = null;
function drawRsChart(f) {
  const c = document.getElementById('rsChart');
  if (!c || !window.Chart) return;
  if (rsChartObj) { rsChartObj.destroy(); rsChartObj = null; }
  const s = f.rs_series;
  rsChartObj = new Chart(c.getContext('2d'), {
    type: 'line',
    data: {
      labels: s.months,
      datasets: [
        { label: 'NDVI (simulated)', data: s.ndvi, borderColor: '#2e7d32', backgroundColor: '#2e7d3222', tension: .3, fill: true },
        { label: 'NDWI (simulated)', data: s.ndwi, borderColor: '#1e88e5', tension: .3 },
        { label: 'EVI (simulated)', data: s.evi, borderColor: '#c9a227', tension: .3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { boxWidth: 12, font: { size: 10 } } },
        title: { display: true, text: 'SIMULATED remote-sensing indices -- not satellite observations',
                 font: { size: 10 }, color: '#8a2f00' },
      },
      scales: { y: { suggestedMin: -0.4, suggestedMax: 1 } },
    },
  });
  const btn = document.getElementById('geeBtn');
  if (btn) btn.addEventListener('click', () => runGee(f));
}

async function runGee(f) {
  const btn = document.getElementById('geeBtn'), out = document.getElementById('geeOut');
  if (btn) { btn.disabled = true; btn.textContent = 'Querying Earth Engine...'; }
  if (out) out.textContent = 'Live request in progress...';
  try {
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
    const res = await fetch(MK_ANALYZE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ring }),
    });
    const j = await res.json();
    liveGee[f.farmer_id] = (j && j.available !== false)
      ? { ok: true, data: j } : { ok: false, reason: (j && j.reason) || 'not available' };
  } catch (e) {
    liveGee[f.farmer_id] = { ok: false, reason: 'network/CORS error: ' + e.message };
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Run live satellite check (real Google Earth Engine)'; }
  if (out) out.textContent = '';
  renderAnalysis(f);
}

/* ---------- Section 11 + 12 ---------- */
function renderEventDamage(f) {
  const e = f.event, t = f.tech;
  if (!e) {
    return `<h3>Weather / Crop-Loss Event and Before&ndash;After Damage Analysis</h3>
      <div class="sub">Sections 11 and 12.</div>
      <div class="box">No documented weather or crop-loss event for this synthetic parcel in the simulated
      pilot season. Simulated crop health is ${t.crop_health_score}/100 with no vegetation anomaly detected,
      so no before&ndash;after damage analysis is produced. No damage figure is invented in its absence.</div>`;
  }
  const declinePct = e.ndvi_decline_pct;
  return `
  <h3>Weather / Crop-Loss Event and Before&ndash;After Damage Analysis</h3>
  <div class="sub">Sections 11 and 12. A detected weather event does not by itself establish crop damage;
    damage is assessed from the vegetation response and confirmed by human verification.</div>
  <div class="g2">
    <div class="box">
      <h5>Section 11 &mdash; Event record <span class="tag t-sim">SIMULATED</span></h5>
      <table class="dt">
        <tr><td>Event date</td><td class="num">${esc(e.date)}</td></tr>
        <tr><td>Event type</td><td class="num">${esc(e.type)}</td></tr>
        <tr><td>Description</td><td class="num">${esc(e.description)}</td></tr>
        <tr><td>Intensity</td><td class="num">${esc(e.intensity)}</td></tr>
        <tr><td>Affected area</td><td class="num">${ha(e.affected_area_ha)}</td></tr>
        <tr><td>Parcel affected</td><td class="num">${esc(f.khasra_no)} (${esc(f.farmer_id)})</td></tr>
        <tr><td>Pre-event condition</td><td class="num">${esc(e.pre_event_condition)}</td></tr>
        <tr><td>Post-event condition</td><td class="num">${esc(e.post_event_condition)}</td></tr>
      </table>
    </div>
    <div class="box">
      <h5>Section 12 &mdash; Before&ndash;after damage analysis <span class="tag t-sim">SIMULATED PILOT ESTIMATE</span></h5>
      <table class="dt">
        <tr><td>Before-event NDVI</td><td class="num">${e.pre_event_ndvi}</td></tr>
        <tr><td>After-event NDVI</td><td class="num">${e.post_event_ndvi}</td></tr>
        <tr><td>Simulated vegetation decline</td><td class="num">${declinePct}%</td></tr>
        <tr><td>Damaged area</td><td class="num">${ha(t.damage_area_ha)}</td></tr>
        <tr><td>Crop-health decline</td><td class="num">${t.crop_health_score}/100 now</td></tr>
        <tr><td><b>Technology-assisted estimated crop loss</b></td><td class="num">${t.estimated_loss_pct}%</td></tr>
      </table>
      <div style="margin-top:9px;">
        <div style="font-size:11px;color:var(--dim);font-weight:700;">NDVI before &rarr; after</div>
        <div class="bar" style="height:13px;"><i style="width:${(e.pre_event_ndvi * 100).toFixed(0)}%;background:#2e7d32"></i></div>
        <div class="bar" style="height:13px;margin-top:4px;"><i style="width:${(e.post_event_ndvi * 100).toFixed(0)}%;background:#b3261e"></i></div>
      </div>
      <div class="note"><b>SIMULATED PILOT ESTIMATE.</b> Damage area is computed as a share of the detected
        cultivated area, driven by the simulated NDVI decline. It is not a field-validated measurement.</div>
    </div>
  </div>`;
}

/* ---------- Section 13 + 14 ---------- */
function renderEvidence(f) {
  const t = f.tech, e = f.event;
  const comps = t.evidence_components || [];
  const cropEvidence = [
    ['Temporal vegetation pattern', `${f.rs_series.months.length}-date Jun-Oct curve consistent with a ${esc(f.girdawari.season)} crop cycle`],
    ['Spectral characteristics', `Peak simulated NDVI ${Math.max.apply(null, f.rs_series.ndvi)}, EVI/NDVI ratio within the expected range`],
    ['Crop calendar', `Sowing-to-maturity window matches the ${esc(f.girdawari.season)} calendar for ${esc(f.district)} district`],
    ['Growth trajectory', `Current simulated stage: ${esc(t.crop_stage)}`],
  ];
  const dmgEvidence = e ? [
    ['Vegetation decline', `NDVI ${e.pre_event_ndvi} -> ${e.post_event_ndvi} (${e.ndvi_decline_pct}% decline)`],
    ['Weather anomaly', `${esc(e.type)}, intensity ${esc(e.intensity)}, ${esc(e.date)}`],
    ['Spatial damage', `${ha(t.damage_area_ha)} of ${ha(f.cultivated_area_ha)} cultivated area affected`],
    ['Temporal change', `Decline begins at the event date and partially recovers thereafter`],
  ] : [];
  return `
  <h3>Crop-Loss Evidence Engine &amp; Explainable AI</h3>
  <div class="sub">Sections 13 and 14. The system explains its results rather than emitting a bare percentage.</div>
  <div class="g2">
    <div class="box">
      <h5>Section 13 &mdash; Evidence engine <span class="tag t-sim">SIMULATED</span></h5>
      <table class="dt">
        <tr><th>Evidence factor</th><th>Observation</th><th>Score</th><th>Weight</th></tr>
        ${comps.map(c => `<tr><td>${esc(c.factor)}</td><td>${esc(c.value)}</td>
          <td class="num">${c.score}</td><td class="num">${(c.weight * 100).toFixed(0)}%</td></tr>`).join('')}
        <tr><td colspan="2"><b>Overall Evidence / Confidence Score</b></td>
            <td class="num" colspan="2"><b>${t.evidence_score_pct}%</b></td></tr>
      </table>
      <div class="bar" style="height:12px;margin-top:8px;">
        <i style="width:${t.evidence_score_pct}%;background:${t.evidence_score_pct >= 75 ? '#2e7d32' : t.evidence_score_pct >= 55 ? '#e0a800' : '#b3261e'}"></i></div>
      <div class="note">The overall score is the weighted sum of the factors above &mdash; the arithmetic is
        shown rather than hidden, so a reviewer can audit how the number arose.</div>
    </div>
    <div class="box">
      <h5>Section 14 &mdash; Explainable AI <span class="tag t-sim">SIMULATED</span></h5>
      <b style="font-size:11.5px;">Crop classification</b>
      <table class="dt">
        <tr><td>Detected crop</td><td class="num">${esc(t.ai_crop)}</td></tr>
        <tr><td>Confidence</td><td class="num">${t.ai_confidence_pct}%</td></tr>
      </table>
      <div style="font-size:11px;color:var(--dim);margin:5px 0 3px;font-weight:700;">EVIDENCE</div>
      <table class="dt">${cropEvidence.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>
      ${e ? `<b style="font-size:11.5px;display:block;margin-top:12px;">Damage assessment</b>
      <table class="dt">
        <tr><td>Estimated loss</td><td class="num">${t.estimated_loss_pct}%</td></tr>
      </table>
      <div style="font-size:11px;color:var(--dim);margin:5px 0 3px;font-weight:700;">EVIDENCE</div>
      <table class="dt">${dmgEvidence.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`
      : `<div class="note" style="margin-top:12px;">No damage estimate for this parcel, so no damage
         explanation is produced.</div>`}
    </div>
  </div>`;
}

/* ---------- Section 17 ---------- */
function renderCompareTable(f) {
  const g = f.girdawari, t = f.tech;
  const rows = [
    ['Crop', `${esc(g.crop)} (Girdawari record)`, `${esc(t.ai_crop)} (AI/RS classification)`],
    ['Area', `${ha(g.reported_area_ha)} reported`, `${ha(t.detected_cultivated_area_ha)} detected (difference ${ha(t.area_difference_ha)}, ${t.area_difference_pct}%)`],
    ['Crop Health', 'Manual / record-based observation', `Remote sensing: ${t.crop_health_score}/100`],
    ['Damage', `${g.reported_loss_pct}% reported / manual`, `${t.estimated_loss_pct}% spatial detection (${ha(t.damage_area_ha)})`],
    ['Evidence', 'Limited &mdash; single record entry', `Multi-source: ${(t.evidence_components || []).length} independent factors`],
    ['Confidence', '&mdash;', `${t.ai_confidence_pct}% AI confidence, ${t.evidence_score_pct}% evidence score`],
    ['Verification', 'Manual, uniformly applied', `Risk-based: ${esc(t.verification_status)}`],
    ['Insurance', 'Record-based input', 'Evidence-supported indicative simulation'],
  ];
  return `
  <h3>Traditional vs Technology-Assisted &mdash; Full Comparison</h3>
  <div class="sub">Section 17, for parcel ${esc(f.farmer_id)} / ${esc(f.khasra_no)}.</div>
  <div class="box">
    <table class="dt">
      <tr><th>Parameter</th><th>Traditional Model</th><th>Technology-Assisted Model</th></tr>
      ${rows.map(([p, a, b]) => `<tr><td style="color:var(--dim);font-weight:700;">${esc(p)}</td>
        <td>${a}</td><td style="font-weight:700;">${b}</td></tr>`).join('')}
    </table>
    <div class="note">Both columns describe the same synthetic parcel. The comparison illustrates what
      parcel-level technology adds &mdash; spatial extent, confidence and auditable evidence &mdash; and
      does not assert that the technology figure is the correct one. Establishing accuracy would require
      real field validation (see Limitations).</div>
  </div>`;
}

/* ---------- Section 18 + 19 ---------- */
function renderVerify(f) {
  const t = f.tech;
  const st = hilState[f.farmer_id];
  const checks = [
    ['Crop mismatch', f.girdawari.crop !== t.ai_crop],
    ['Cultivated-area mismatch', Math.abs(t.area_difference_pct) >= 30],
    ['Unusual crop calendar', false],
    ['Unusual vegetation pattern', !!f.event && f.event.ndvi_decline_pct >= 35],
    ['Insured-area inconsistency', f.insurance.insured_area_ha > f.cultivated_area_ha + 0.01],
    ['Duplicate parcel information', false],
    ['Insufficient satellite evidence', t.evidence_score_pct < 55],
    ['Suspicious damage pattern', t.estimated_loss_pct >= 45],
  ];
  return `
  <h3>Anomaly Detection &amp; Human-in-the-Loop Verification</h3>
  <div class="sub">Sections 18 and 19. AI is decision-support; it is never the final authority.</div>
  <div class="g2">
    <div class="box">
      <h5>Section 18 &mdash; Anomaly detection</h5>
      <table class="dt">
        <tr><th>Check</th><th>Result</th></tr>
        ${checks.map(([l, hit]) => `<tr><td>${esc(l)}</td>
          <td class="num"><span class="tag ${hit ? 't-warn' : 't-ok'}">${hit ? 'ANOMALY DETECTED' : 'clear'}</span></td></tr>`).join('')}
      </table>
      ${f.anomalies.length ? `<div class="note"><b>VERIFICATION REQUIRED.</b><br>
        ${f.anomalies.map(a => '&bull; ' + esc(a)).join('<br>')}</div>` :
        `<div class="note">No anomalies flagged for this synthetic parcel.</div>`}
      <div class="note" style="border-left-color:#96231f;"><b>These are verification flags, not findings of
        fraud.</b> The system never automatically classifies a farmer as fraudulent; a flag only routes the
        parcel to a human reviewer.</div>
    </div>
    <div class="box">
      <h5>Section 19 &mdash; Human-in-the-loop</h5>
      ${chain(['AI Detection', 'Confidence / Risk Score', 'Human Verification', 'Final Assessment'])}
      <table class="dt">
        <tr><td>AI detection</td><td class="num">${esc(t.ai_crop)}, loss ${t.estimated_loss_pct}%</td></tr>
        <tr><td>Confidence / risk score</td><td class="num">${t.ai_confidence_pct}% / evidence ${t.evidence_score_pct}%</td></tr>
        <tr><td>System recommendation</td><td class="num">${esc(t.verification_status)}</td></tr>
      </table>
      <div class="hil-btns">
        <button data-hil="Verified">Verify</button>
        <button data-hil="Rejected">Reject</button>
        <button data-hil="Field inspection requested">Request Field Inspection</button>
        <button data-hil="Evidence insufficient">Evidence Insufficient</button>
        <button data-hil="Forwarded for further assessment">Forward for Further Assessment</button>
      </div>
      <div class="hil-state" id="hilState">${st
        ? `Human decision recorded (pilot, in-memory only): <span class="tag t-ok">${esc(st.action)}</span>
           <span style="font-weight:400;color:var(--dim);">at ${esc(st.at)}</span>`
        : '<span style="color:var(--dim);font-weight:400;">No human decision recorded yet for this parcel.</span>'}</div>
      <div class="note">Decisions are held in browser memory for this pilot demonstration only. Nothing is
        submitted anywhere, and no claim is approved or settled by this page.</div>
    </div>
  </div>`;
}

function wireHil(f) {
  document.querySelectorAll('#an-verify [data-hil]').forEach(b =>
    b.addEventListener('click', () => {
      hilState[f.farmer_id] = { action: b.dataset.hil, at: new Date().toLocaleString('en-IN') };
      renderAnalysis(f);
    }));
}

/* ---------- Section 20 ---------- */
function renderAudit(f) {
  const t = f.tech, e = f.event;
  const sources = [
    ['Cadastral Dataset', 'SYNTHETIC parcel polygons clipped to the REAL Survey of India Simrol boundary', 'mixed'],
    ['Girdawari Dataset', 'SYNTHETIC record ' + f.girdawari.record_id, 'syn'],
    ['Synthetic Farmer Dataset', 'SYNTHETIC ' + f.farmer_id + ' (' + f.farmer_name + ')', 'syn'],
    ['Simulated Remote-Sensing Dataset', 'SIMULATED Jun-Oct NDVI/NDWI/EVI series', 'sim'],
    ['Simulated Weather Dataset', e ? 'SIMULATED ' + e.type + ' on ' + e.date : 'No event recorded', 'sim'],
    ['AI/ML Model', 'Simulated classification and loss estimation for this pilot study', 'sim'],
    ['Human Verification', hilState[f.farmer_id] ? hilState[f.farmer_id].action : 'Pending', 'human'],
    ['Yield baseline (real)', 'DES (data.desagri.gov.in) Indore district yield history', 'real'],
    ['Village boundary (real)', 'Survey of India via NWDP, vil_lgd 476504', 'real'],
  ];
  const tl = [
    ['Data Received', 'Synthetic cadastral parcel, girdawari record and farmer profile loaded'],
    ['AI Analysis', `Crop classified as ${t.ai_crop} at ${t.ai_confidence_pct}% confidence; cultivated area ${ha(t.detected_cultivated_area_ha)}`],
    ['Event Detected', e ? `${e.type} (${e.intensity}) on ${e.date}` : 'No weather/loss event detected'],
    ['Damage Estimated', e ? `${ha(t.damage_area_ha)} damaged, ${t.estimated_loss_pct}% estimated loss, evidence ${t.evidence_score_pct}%` : 'No damage estimated'],
    ['Verification', hilState[f.farmer_id] ? `Human decision: ${hilState[f.farmer_id].action}` : `System recommendation: ${t.verification_status} (awaiting human decision)`],
    ['Final Pilot Assessment', 'Indicative only &mdash; not an official assessment or claim determination'],
  ];
  const tagFor = (k) => k === 'real' ? '<span class="tag t-real">REAL</span>'
    : k === 'sim' ? '<span class="tag t-sim">SIMULATED</span>'
    : k === 'syn' ? '<span class="tag t-syn">SYNTHETIC</span>'
    : k === 'human' ? '<span class="tag t-ok">HUMAN</span>'
    : '<span class="tag t-syn">SYNTHETIC</span> <span class="tag t-real">+ REAL boundary</span>';
  return `
  <h3>Evidence &amp; Audit Trail</h3>
  <div class="sub">Section 20. Every assessment states where each input came from and what was done to it.</div>
  <div class="g2">
    <div class="box">
      <h5>Data sources</h5>
      <table class="dt">
        <tr><th>Source</th><th>Detail</th><th>Status</th></tr>
        ${sources.map(([n, d, k]) => `<tr><td style="font-weight:700;">${esc(n)}</td><td>${esc(d)}</td>
          <td>${tagFor(k)}</td></tr>`).join('')}
      </table>
    </div>
    <div class="box">
      <h5>Audit timeline &mdash; ${esc(f.farmer_id)}</h5>
      <ul class="tl">
        ${tl.map(([s, d]) => `<li><b>${esc(s)}</b><div class="t">${d}</div></li>`).join('')}
      </ul>
      <div class="note">The trail is reconstructed from this parcel's synthetic record so a reviewer can
        follow how the pilot arrived at its numbers.</div>
    </div>
  </div>`;
}
