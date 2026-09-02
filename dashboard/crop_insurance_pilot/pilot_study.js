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
