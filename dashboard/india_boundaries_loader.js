/*
 * india_boundaries_loader.js — all-India administrative boundary overlays.
 *
 * Source: Census of India 2011 district boundaries (36 states/UTs dissolved
 * from 760 districts). Layers load lazily on first toggle to keep initial
 * page weight low.
 *
 * Block and village boundaries for all India (~7,000 blocks, ~640,000
 * villages) are too large for raw GeoJSON; they are served as vector tiles.
 * See docs/REQUIREMENTS_ROADMAP.md ("All-India boundary architecture").
 */
(function () {
  'use strict';

  var STATES_URL = 'data/boundaries/india_states.geojson';
  var DISTRICTS_URL = 'data/boundaries/india_districts.geojson';

  var layers = { states: null, districts: null };
  var loading = {};

  var STYLE = {
    states:    { color: '#ffd166', weight: 2.2, fill: false, opacity: 0.95 },
    districts: { color: '#4cc9f0', weight: 1.0, fill: true, fillOpacity: 0.02, opacity: 0.75 }
  };

  function popupHtml(props, kind) {
    var name = kind === 'states' ? props.state : (props.district + '</b><br><span style="opacity:.75">' + props.state + '</span><b>');
    return '<b>' + name + '</b><br>' +
      '<span style="font-size:11px;opacity:.7">Source: ' + (props.source || 'Census of India 2011') +
      ' &middot; CRS EPSG:4326</span>';
  }

  function toggleLayer(kind, url, checkbox) {
    var map = window.leafletMap;
    if (!map) return;
    if (layers[kind]) {
      if (map.hasLayer(layers[kind])) { map.removeLayer(layers[kind]); }
      else { layers[kind].addTo(map); }
      return;
    }
    if (loading[kind]) return;
    loading[kind] = true;
    if (checkbox) checkbox.disabled = true;
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (gj) {
        layers[kind] = L.geoJSON(gj, {
          style: STYLE[kind],
          onEachFeature: function (f, lyr) {
            lyr.bindPopup(popupHtml(f.properties, kind));
            lyr.on('mouseover', function () { lyr.setStyle({ weight: STYLE[kind].weight + 1.4 }); });
            lyr.on('mouseout', function () { lyr.setStyle(STYLE[kind]); });
          }
        }).addTo(map);
      })
      .catch(function (e) { console.warn('[india_boundaries] ' + kind + ':', e); })
      .finally(function () { loading[kind] = false; if (checkbox) checkbox.disabled = false; });
  }

  function addControl() {
    var map = window.leafletMap;
    if (!map || !window.L) { setTimeout(addControl, 800); return; }
    var ctl = L.control({ position: 'topright' });
    ctl.onAdd = function () {
      var div = L.DomUtil.create('div', 'leaflet-bar');
      div.style.cssText = 'background:rgba(15,20,30,.88);padding:8px 10px;border-radius:6px;color:#e8e8e8;font-size:12px;line-height:1.9;min-width:150px';
      div.innerHTML =
        '<b style="font-size:11px;letter-spacing:.4px;opacity:.8">INDIA BOUNDARIES</b><br>' +
        '<label style="cursor:pointer;display:block"><input type="checkbox" id="chk-ind-states"> State / UT (36)</label>' +
        '<label style="cursor:pointer;display:block"><input type="checkbox" id="chk-ind-districts"> Districts (760)</label>' +
        '<span style="font-size:10px;opacity:.55">Census 2011 &middot; EPSG:4326</span>';
      L.DomEvent.disableClickPropagation(div);
      div.querySelector('#chk-ind-states').addEventListener('change', function () { toggleLayer('states', STATES_URL, this); });
      div.querySelector('#chk-ind-districts').addEventListener('change', function () { toggleLayer('districts', DISTRICTS_URL, this); });
      return div;
    };
    ctl.addTo(map);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addControl);
  else addControl();
})();
