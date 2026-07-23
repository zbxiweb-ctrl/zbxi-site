/* The Brotherhood Worldwide map (members only, map.html). Waits for
   map-page.js to hydrate member data (zbxi:hydrated), then lazily loads
   Leaflet + OpenStreetMap tiles and pins each unique "current city" —
   actives and alumni alike (geocoded via Nominatim, cached in localStorage
   so each browser geocodes a city only once). */
(function () {
  'use strict';
  var sec = document.getElementById('alumniMapSec');
  var mapEl = document.getElementById('alumniMap');
  if (!sec || !mapEl) return;

  // Escape user-controlled data before it goes into popup HTML (brother names,
  // city labels). Matches the esc() helper every other file in this site uses.
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }

  var GEO_KEY = 'zbxi_geo_v1';
  var started = false;

  function loadLeaflet() {
    return new Promise(function (resolve, reject) {
      if (window.L) return resolve();
      // Subresource Integrity: pin the exact bytes so a compromised/edited CDN file
      // can't run. Hashes cross-verified byte-identical from unpkg AND cdnjs (Leaflet
      // 1.9.4). crossOrigin is required for the browser to check integrity on a
      // cross-origin resource.
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
      css.crossOrigin = 'anonymous';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
      js.crossOrigin = 'anonymous';
      js.onload = resolve;
      js.onerror = function () { reject(new Error('map library failed to load')); };
      document.head.appendChild(js);
    });
  }

  function geoCache() {
    try { return JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveGeo(cache) {
    try { localStorage.setItem(GEO_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  // Geocode one city via Nominatim (throttled by the caller).
  function geocode(city) {
    return fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(city))
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (rows && rows[0]) return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon) };
        return null;
      }).catch(function () { return null; });
  }

  function start(members) {
    if (started) return;
    started = true;
    var withCity = members.filter(function (b) { return b.city; });
    if (!withCity.length) return; // no data yet — section stays hidden

    sec.style.display = '';
    mapEl.innerHTML = '<p class="page-empty">Loading the map…</p>';

    loadLeaflet().then(function () {
      mapEl.innerHTML = '';
      // scrollWheelZoom (desktop) + touchZoom/dragging (mobile, on by default)
      var map = L.map(mapEl, { scrollWheelZoom: true }).setView([41.5, -76], 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      // ---- Fullscreen toggle (⛶) as a Leaflet control so clicks don't pan ----
      var isFull = false;
      function toggleFull() {
        isFull = !isFull;
        mapEl.classList.toggle('alumni-map--full', isFull);
        var b = mapEl.querySelector('.map-fs-btn');
        if (b) { b.innerHTML = isFull ? '✕' : '⛶'; b.title = isFull ? 'Exit fullscreen' : 'Fullscreen'; }
        setTimeout(function () { map.invalidateSize(); }, 60);   // let the layout settle, then refit tiles
      }
      var FsControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
          var b = L.DomUtil.create('button', 'map-fs-btn');
          b.type = 'button'; b.innerHTML = '⛶'; b.title = 'Fullscreen'; b.setAttribute('aria-label', 'Toggle fullscreen');
          L.DomEvent.disableClickPropagation(b);
          L.DomEvent.on(b, 'click', function (e) { L.DomEvent.stop(e); toggleFull(); });
          return b;
        }
      });
      map.addControl(new FsControl());
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isFull) toggleFull(); });

      // group brothers per city
      var byCity = {};
      withCity.forEach(function (b) {
        var key = b.city.trim().toLowerCase();
        (byCity[key] = byCity[key] || { label: b.city.trim(), brothers: [] }).brothers.push(b);
      });

      var cache = geoCache();
      var cities = Object.keys(byCity);
      var bounds = [];
      var i = 0;

      function pin(key, pt) {
        var g = byCity[key];
        var m = L.marker([pt.lat, pt.lon]).addTo(map);
        m.bindPopup('<b>' + esc(g.label) + '</b><br>' + g.brothers.map(function (b) {
          return '<a href="#" data-mapbro="' + esc(b.id) + '">' + esc(b.full_name) + '</a>';
        }).join('<br>'));
        bounds.push([pt.lat, pt.lon]);
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
        else map.setView([pt.lat, pt.lon], 6);
      }

      function next() {
        if (i >= cities.length) return;
        var key = cities[i++];
        if (cache[key]) { pin(key, cache[key]); next(); return; }
        geocode(byCity[key].label).then(function (pt) {
          if (pt) { cache[key] = pt; saveGeo(cache); pin(key, pt); }
          setTimeout(next, 1100); // Nominatim usage policy: ≤1 req/sec
        });
      }
      next();

      // popup names open the shared profile card
      mapEl.addEventListener('click', function (e) {
        var a = e.target.closest('[data-mapbro]');
        if (!a) return;
        e.preventDefault();
        var b = withCity.filter(function (x) { return x.id === a.dataset.mapbro; })[0];
        if (b && window.BrotherCard) window.BrotherCard.open(b, { portal: 'index.html#brothers-portal' });
      });
    }).catch(function () {
      mapEl.innerHTML = '<p class="page-empty">The map couldn\'t load right now.</p>';
    });
  }

  document.addEventListener('zbxi:hydrated', function () {
    if (window.ZBXI_MEMBERS) start(window.ZBXI_MEMBERS);
  });
  if (window.ZBXI_MEMBERS) start(window.ZBXI_MEMBERS);
})();
