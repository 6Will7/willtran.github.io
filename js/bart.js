/* BART Tracker — real-time departures via worker /bart/etd. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var REFRESH_MS = 30000;

  // All 50 BART stations: [abbr, name]
  var STATIONS = [
    ['12TH', '12th St / Oakland City Center'], ['16TH', '16th St Mission'],
    ['19TH', '19th St / Oakland'], ['24TH', '24th St Mission'],
    ['ANTC', 'Antioch'], ['ASHB', 'Ashby'],
    ['BALB', 'Balboa Park'], ['BAYF', 'Bay Fair'],
    ['BERY', 'Berryessa / North San José'], ['CAST', 'Castro Valley'],
    ['CIVC', 'Civic Center'], ['COLM', 'Colma'],
    ['COLS', 'Coliseum'], ['CONC', 'Concord'],
    ['DALY', 'Daly City'], ['DBRK', 'Downtown Berkeley'],
    ['DELN', 'El Cerrito del Norte'], ['PLZA', 'El Cerrito Plaza'],
    ['DUBL', 'Dublin / Pleasanton'], ['EMBR', 'Embarcadero'],
    ['FRMT', 'Fremont'], ['FTVL', 'Fruitvale'],
    ['GLEN', 'Glen Park'], ['HAYW', 'Hayward'],
    ['LAFY', 'Lafayette'], ['LAKE', 'Lake Merritt'],
    ['MCAR', 'MacArthur'], ['MLBR', 'Millbrae'],
    ['MLPT', 'Milpitas'], ['MONT', 'Montgomery St'],
    ['NBRK', 'North Berkeley'], ['NCON', 'North Concord / Martinez'],
    ['OAKL', "Oakland Int'l Airport"], ['ORIN', 'Orinda'],
    ['PCTR', 'Pittsburg Center'], ['PHIL', 'Pleasant Hill / Contra Costa Centre'],
    ['PITT', 'Pittsburg / Bay Point'], ['POWL', 'Powell St'],
    ['RICH', 'Richmond'], ['ROCK', 'Rockridge'],
    ['SBRN', 'San Bruno'], ['SFIA', "San Francisco Int'l Airport"],
    ['SANL', 'San Leandro'], ['SHAY', 'South Hayward'],
    ['SSAN', 'South San Francisco'], ['UCTY', 'Union City'],
    ['WARM', 'Warm Springs / South Fremont'], ['WCRK', 'Walnut Creek'],
    ['WDUB', 'West Dublin / Pleasanton'], ['WOAK', 'West Oakland']
  ];

  // Official station coordinates (BART API, gtfs lat/lng)
  var COORDS = {
    '12TH': [37.803768, -122.271450], '16TH': [37.765062, -122.419694],
    '19TH': [37.808350, -122.268602], '24TH': [37.752470, -122.418143],
    'ANTC': [37.995388, -121.780420], 'ASHB': [37.852803, -122.270062],
    'BALB': [37.721585, -122.447506], 'BAYF': [37.696924, -122.126514],
    'BERY': [37.368473, -121.874681], 'CAST': [37.690746, -122.075602],
    'CIVC': [37.779732, -122.414123], 'COLS': [37.753661, -122.196869],
    'COLM': [37.684638, -122.466233], 'CONC': [37.973737, -122.029095],
    'DALY': [37.706121, -122.469081], 'DBRK': [37.870104, -122.268133],
    'DUBL': [37.701687, -121.899179], 'DELN': [37.925086, -122.316794],
    'PLZA': [37.902632, -122.298904], 'EMBR': [37.792874, -122.397020],
    'FRMT': [37.557465, -121.976608], 'FTVL': [37.774836, -122.224175],
    'GLEN': [37.733064, -122.433817], 'HAYW': [37.669723, -122.087018],
    'LAFY': [37.893176, -122.124630], 'LAKE': [37.797027, -122.265180],
    'MCAR': [37.829065, -122.267040], 'MLBR': [37.600271, -122.386702],
    'MLPT': [37.410277, -121.891081], 'MONT': [37.789405, -122.401066],
    'NBRK': [37.873967, -122.283440], 'NCON': [38.003193, -122.024653],
    'OAKL': [37.713238, -122.212191], 'ORIN': [37.878361, -122.183791],
    'PCTR': [38.016941, -121.889457], 'PHIL': [37.928468, -122.056012],
    'PITT': [38.018914, -121.945154], 'POWL': [37.784471, -122.407974],
    'RICH': [37.936853, -122.353099], 'ROCK': [37.844702, -122.251371],
    'SBRN': [37.637761, -122.416287], 'SFIA': [37.615966, -122.392409],
    'SANL': [37.721947, -122.160844], 'SHAY': [37.634375, -122.057189],
    'SSAN': [37.664245, -122.443960], 'UCTY': [37.590630, -122.017388],
    'WCRK': [37.905522, -122.067527], 'WARM': [37.502171, -121.939313],
    'WDUB': [37.699756, -121.928240], 'WOAK': [37.804872, -122.295140]
  };

  // Line stop sequences for the map polylines
  var TRUNK = ['WOAK', 'EMBR', 'MONT', 'POWL', 'CIVC', '16TH', '24TH', 'GLEN', 'BALB', 'DALY'];
  var LINES = [
    { color: '#f5c400', stops: ['ANTC', 'PCTR', 'PITT', 'NCON', 'CONC', 'WCRK', 'PHIL', 'LAFY', 'ORIN', 'ROCK', 'MCAR', '19TH', '12TH'].concat(TRUNK, ['COLM', 'SSAN', 'SBRN', 'SFIA']) },
    { color: '#ed1c24', stops: ['RICH', 'DELN', 'PLZA', 'NBRK', 'DBRK', 'ASHB', 'MCAR', '19TH', '12TH'].concat(TRUNK, ['COLM', 'SSAN', 'SBRN', 'SFIA', 'MLBR']) },
    { color: '#009e49', stops: ['BERY', 'MLPT', 'WARM', 'FRMT', 'UCTY', 'SHAY', 'HAYW', 'SANL', 'BAYF', 'COLS', 'FTVL', 'LAKE', '12TH'].concat(TRUNK) },
    { color: '#0099cc', stops: ['DUBL', 'WDUB', 'CAST', 'BAYF', 'COLS', 'FTVL', 'LAKE', '12TH'].concat(TRUNK) },
    { color: '#ff9933', stops: ['RICH', 'DELN', 'PLZA', 'NBRK', 'DBRK', 'ASHB', 'MCAR', '19TH', '12TH', 'LAKE', 'FTVL', 'COLS', 'BAYF', 'SANL', 'HAYW', 'SHAY', 'UCTY', 'FRMT', 'WARM', 'MLPT', 'BERY'] },
    { color: '#7a68a6', stops: ['COLS', 'OAKL'] }
  ];
  var markers = {};
  var bartMap = null;
  var addrMarker = null;

  function initMap() {
    var el = document.getElementById('bart-map');
    if (!el || !window.L) return;
    var map = L.map('bart-map', { scrollWheelZoom: false });
    bartMap = map;
    map.on('focus', function () { map.scrollWheelZoom.enable(); });
    map.on('blur', function () { map.scrollWheelZoom.disable(); });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 18
    }).addTo(map);
    LINES.forEach(function (ln) {
      var pts = ln.stops.map(function (a) { return COORDS[a]; }).filter(Boolean);
      L.polyline(pts, { color: ln.color, weight: 3.5, opacity: 0.85 }).addTo(map);
    });
    STATIONS.forEach(function (s) {
      var c = COORDS[s[0]];
      if (!c) return;
      var m = L.circleMarker(c, {
        radius: 6, color: '#fff', weight: 2, fillColor: '#44403c', fillOpacity: 1
      }).addTo(map);
      m.bindTooltip(s[1], { direction: 'top', offset: [0, -8] });
      m.on('click', function () {
        selectStation(s[0]);
        var board = document.getElementById('bart-board');
        if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      markers[s[0]] = m;
    });
    var all = STATIONS.map(function (s) { return COORDS[s[0]]; }).filter(Boolean);
    map.fitBounds(L.latLngBounds(all).pad(0.04));
  }

  function highlightMarker() {
    Object.keys(markers).forEach(function (a) {
      markers[a].setStyle(a === currentAbbr
        ? { fillColor: '#2563eb', radius: 9 }
        : { fillColor: '#44403c', radius: 6 });
    });
    var m = markers[currentAbbr];
    if (m) m.bringToFront();
  }

  var searchEl = document.getElementById('bart-search');
  var listEl = document.getElementById('bart-station-list');
  var favsEl = document.getElementById('bart-favs');
  var boardEl = document.getElementById('bart-board');
  var nameEl = document.getElementById('bart-station-name');
  var updatedEl = document.getElementById('bart-updated');
  var depsEl = document.getElementById('bart-deps');
  var msgEl = document.getElementById('bart-msg');

  var currentAbbr = null;
  var dirFilter = 'all';
  var departures = [];
  var refreshTimer = null;
  var lastFetch = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getFavs() {
    try { return JSON.parse(localStorage.getItem('bart_favs') || '[]'); }
    catch (e) { return []; }
  }
  function setFavs(f) {
    try { localStorage.setItem('bart_favs', JSON.stringify(f)); } catch (e) {}
  }
  function stName(abbr) {
    for (var i = 0; i < STATIONS.length; i++) {
      if (STATIONS[i][0] === abbr) return STATIONS[i][1];
    }
    return abbr;
  }

  function renderFavs() {
    var favs = getFavs();
    favsEl.innerHTML = '';
    if (!favs.length) return;
    var label = document.createElement('span');
    label.className = 'bart-fav-label';
    label.textContent = 'Quick:';
    favsEl.appendChild(label);
    favs.forEach(function (abbr) {
      var b = document.createElement('button');
      b.className = 'mv-friend bart-fav' + (abbr === currentAbbr ? ' active' : '');
      b.textContent = stName(abbr);
      b.addEventListener('click', function () { selectStation(abbr); });
      favsEl.appendChild(b);
    });
  }

  function renderStationList(filter) {
    var q = (filter || '').toLowerCase().trim();
    var matches = STATIONS.filter(function (s) {
      return !q || s[1].toLowerCase().indexOf(q) >= 0 || s[0].toLowerCase().indexOf(q) >= 0;
    }).slice(0, 12);
    listEl.innerHTML = '';
    if (!matches.length) {
      listEl.innerHTML = '<div class="bart-no-match">No stations match.</div>';
    } else {
      matches.forEach(function (s) {
        var d = document.createElement('div');
        d.className = 'bart-station-opt';
        d.innerHTML = '<span>' + esc(s[1]) + '</span><code>' + esc(s[0]) + '</code>';
        d.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectStation(s[0]);
        });
        listEl.appendChild(d);
      });
    }
    listEl.hidden = false;
  }

  function selectStation(abbr) {
    currentAbbr = abbr;
    searchEl.value = stName(abbr);
    listEl.hidden = true;
    try { localStorage.setItem('bart_last', abbr); } catch (e) {}
    renderFavs();
    highlightMarker();
    load();
  }

  function toggleFav() {
    var favs = getFavs();
    var i = favs.indexOf(currentAbbr);
    if (i >= 0) favs.splice(i, 1);
    else favs.push(currentAbbr);
    setFavs(favs);
    renderFavs();
    renderHead();
  }

  function renderHead() {
    var favs = getFavs();
    var isFav = favs.indexOf(currentAbbr) >= 0;
    nameEl.innerHTML = esc(stName(currentAbbr)) +
      ' <button id="bart-star" class="bart-star' + (isFav ? ' on' : '') + '" aria-label="Toggle favorite">' +
      (isFav ? '★' : '☆') + '</button>';
    var star = document.getElementById('bart-star');
    if (star) star.addEventListener('click', toggleFav);
  }

  function fmtMin(d) {
    if (d.leaving || d.minutes <= 0) return '<span class="leaving">Leaving</span>';
    return '<span class="mins">' + d.minutes + '</span><span class="min-label"> min</span>';
  }

  function render() {
    var list = dirFilter === 'all' ? departures : departures.filter(function (d) {
      return d.direction === dirFilter;
    });
    depsEl.innerHTML = '';
    if (!list.length) {
      depsEl.innerHTML = '<p class="mv-empty">No trains right now — check back shortly.</p>';
      return;
    }
    // Group by destination
    var groups = {}, order = [];
    list.forEach(function (d) {
      var k = d.destAbbr || d.dest;
      if (!groups[k]) { groups[k] = { dest: d.dest, color: d.color, items: [] }; order.push(k); }
      groups[k].items.push(d);
    });
    order.forEach(function (k) {
      var g = groups[k];
      var sec = document.createElement('div');
      sec.className = 'bart-dest';
      var h = document.createElement('div');
      h.className = 'bart-dest-head';
      h.innerHTML = '<span class="bart-line-dot" style="background:' + esc(g.color || '#888') + '"></span>' +
        '<span class="bart-dest-name">' + esc(g.dest) + '</span>';
      sec.appendChild(h);
      // Show up to 3 soonest per destination
      g.items.slice(0, 3).forEach(function (d) {
        var row = document.createElement('div');
        row.className = 'bart-dep';
        row.innerHTML =
          '<div class="bart-time">' + fmtMin(d) + '</div>' +
          '<div class="bart-meta">' +
            (d.platform ? '<span>Platform ' + esc(d.platform) + '</span>' : '') +
            (d.length ? '<span>' + esc(d.length) + '-car</span>' : '') +
            (d.bikes ? '<span title="Bikes allowed">🚲</span>' : '') +
          '</div>';
        sec.appendChild(row);
      });
      depsEl.appendChild(sec);
    });
    var ago = Math.max(0, Math.round((Date.now() - lastFetch) / 1000));
    updatedEl.textContent = 'Updated ' + ago + 's ago · auto-refreshes every 30s';
  }

  function load() {
    if (!currentAbbr) return;
    boardEl.hidden = false;
    msgEl.textContent = '';
    depsEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    renderHead();
    fetch(WORKER_URL + '/bart/etd?orig=' + encodeURIComponent(currentAbbr))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          depsEl.innerHTML = '';
          msgEl.textContent = (res.j && res.j.error) || 'Could not load departures.';
          return;
        }
        departures = (res.j && res.j.departures) || [];
        lastFetch = Date.now();
        render();
        scheduleRefresh();
      })
      .catch(function () {
        depsEl.innerHTML = '';
        msgEl.textContent = 'Could not load departures — check your connection.';
      });
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (currentAbbr && !document.hidden) {
        // Silent refresh: keep old data visible while fetching
        fetch(WORKER_URL + '/bart/etd?orig=' + encodeURIComponent(currentAbbr))
          .then(function (r) { return r.json(); })
          .then(function (j) {
            departures = (j && j.departures) || [];
            lastFetch = Date.now();
            render();
          })
          .catch(function () {})
          .then(function () { scheduleRefresh(); });
      } else {
        scheduleRefresh();
      }
    }, REFRESH_MS);
  }

  // Station search
  searchEl.addEventListener('input', function () { renderStationList(searchEl.value); });
  searchEl.addEventListener('focus', function () { renderStationList(searchEl.value); });
  searchEl.addEventListener('blur', function () {
    setTimeout(function () { listEl.hidden = true; }, 150);
  });
  searchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var first = listEl.querySelector('.bart-station-opt');
      if (first) first.dispatchEvent(new Event('mousedown'));
    }
    if (e.key === 'Escape') { listEl.hidden = true; searchEl.blur(); }
  });
  document.addEventListener('click', function (e) {
    if (!listEl.hidden && !listEl.contains(e.target) && e.target !== searchEl) {
      listEl.hidden = true;
    }
  });

  // Direction filter
  Array.prototype.forEach.call(document.querySelectorAll('.bart-dir'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.bart-dir'), function (x) {
        x.classList.remove('active');
      });
      b.classList.add('active');
      dirFilter = b.getAttribute('data-dir');
      render();
    });
  });

  // Restore last station
  renderFavs();
  initMap();
  loadAdvisories();
  try {
    var last = localStorage.getItem('bart_last');
    if (last) selectStation(last);
  } catch (e) {}

  // ---- Nearest-station finder (address → closest BART / Muni / VTA) ----
  function havMi(la1, lo1, la2, lo2) {
    var R = 3958.8, rad = Math.PI / 180;
    var dp = (la2 - la1) * rad, dl = (lo2 - lo1) * rad;
    var x = Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  var nearForm = document.getElementById('bart-near-form');
  var nearInput = document.getElementById('bart-near-input');
  var nearResults = document.getElementById('bart-near-results');
  if (nearForm) nearForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = nearInput.value.trim();
    if (!q) return;
    if (typeof TRANSIT_STATIONS === 'undefined') {
      nearResults.innerHTML = '<p class="near-msg">Station data failed to load.</p>';
      return;
    }
    nearResults.innerHTML = '<p class="near-msg">Searching…</p>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us' +
      '&viewbox=-123.2,38.7,-120.8,36.9&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.length) {
          nearResults.innerHTML = '<p class="near-msg">Couldn\'t find that address — try adding a city.</p>';
          return;
        }
        var la = parseFloat(res[0].lat), lo = parseFloat(res[0].lon);
        var scored = TRANSIT_STATIONS.map(function (s) {
          return { s: s, d: havMi(la, lo, s.la, s.lo) };
        }).sort(function (a, b) { return a.d - b.d; }).slice(0, 6);
        var place = String(res[0].display_name || q).split(',').slice(0, 2).join(',').trim();
        var html = '<p class="near-head">Nearest stations to <strong>' + esc(place) + '</strong>:</p>';
        scored.forEach(function (r0, idx) {
          var walk = Math.max(1, Math.round(r0.d / 3 * 60));
          html += '<div class="near-row' + (r0.s.a ? ' clickable" data-abbr="' + r0.s.a + '"' : '"') + '>' +
            '<span class="near-rank">' + (idx + 1) + '</span>' +
            '<span class="near-badge ' + r0.s.s + '">' + r0.s.s + '</span>' +
            '<span class="near-name">' + esc(r0.s.n) + (r0.s.a ? '<small>Tap for departures</small>' : '') + '</span>' +
            '<span class="near-dist">' + r0.d.toFixed(1) + ' mi<small>~' + walk + ' min walk</small></span></div>';
        });
        nearResults.innerHTML = html;
        Array.prototype.forEach.call(nearResults.querySelectorAll('.near-row.clickable'), function (row) {
          row.addEventListener('click', function () {
            selectStation(row.getAttribute('data-abbr'));
            var board = document.getElementById('bart-board');
            if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
        if (bartMap && window.L) {
          if (addrMarker) bartMap.removeLayer(addrMarker);
          addrMarker = L.marker([la, lo]).addTo(bartMap)
            .bindTooltip('You: ' + q, { direction: 'top' });
          var pts = [[la, lo]];
          scored.slice(0, 3).forEach(function (r0) { pts.push([r0.s.la, r0.s.lo]); });
          bartMap.flyToBounds(L.latLngBounds(pts).pad(0.15), { duration: 0.8 });
        }
      })
      .catch(function () {
        nearResults.innerHTML = '<p class="near-msg">Address lookup failed — check your connection.</p>';
      });
  });

  // Service advisories banner
  function loadAdvisories() {
    var box = document.getElementById('bart-alerts');
    if (!box) return;
    fetch(WORKER_URL + '/bart/advisory')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var html = '';
        (j.advisories || []).forEach(function (a) {
          html += '<div class="bart-alert"><span class="alert-tag">Alert</span>' + esc(a) + '</div>';
        });
        if ((j.elevators || []).length) {
          html += '<div class="bart-alert elevator"><span class="alert-tag">Elevators</span>' +
            esc(j.elevators.join(' ')) + '</div>';
        }
        if (!html) {
          html = '<p class="bart-alerts-ok"><span class="dot">●</span> No active service alerts</p>';
        }
        box.innerHTML = html;
      })
      .catch(function () {});
  }
})();
