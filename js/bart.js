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

  // Static SVG system map — lines + stations projected from real coords.
  // No tiles, no libraries: always there, loads instantly.
  var MAP_W = 1000, MAP_H = 1090, MAP_PAD = 46;
  var LABEL_STATIONS = { ANTC: 1, RICH: 1, DBRK: 1, MCAR: 1, CONC: 1, '12TH': 1,
    DALY: 1, MLBR: 1, SFIA: 1, COLS: 1, HAYW: 1, FRMT: 1,
    WARM: 1, BERY: 1, DUBL: 1, LAFY: 1, BAYF: 1, UCTY: 1 };
  var mapBounds = null;

  function project(la, lo) {
    var kx = Math.cos(37.7 * Math.PI / 180); // shrink lng degrees to match lat scale
    var x = MAP_PAD + (lo - mapBounds.minLo) * kx / mapBounds.w * (MAP_W - 2 * MAP_PAD);
    var y = MAP_PAD + (mapBounds.maxLa - la) / mapBounds.h * (MAP_H - 2 * MAP_PAD);
    return [x, y];
  }

  // Stylized SF Bay water outline (lat/lng waypoints, projected like stations)
  var BAY = [[38.02, -122.44], [38.10, -122.33], [38.11, -122.24], [38.06, -122.15],
    [38.03, -122.05], [37.99, -121.96], [37.95, -122.02], [37.94, -122.18],
    [37.94, -122.34], [37.90, -122.38], [37.86, -122.33], [37.82, -122.30],
    [37.77, -122.25], [37.72, -122.17], [37.66, -122.09], [37.58, -122.00],
    [37.50, -121.97], [37.43, -122.02], [37.41, -122.10], [37.44, -122.17],
    [37.51, -122.23], [37.57, -122.29], [37.62, -122.37], [37.68, -122.42],
    [37.74, -122.41], [37.79, -122.42], [37.83, -122.46], [37.89, -122.46],
    [37.95, -122.44]];

  function lineCount(abbr) {
    var n = 0;
    LINES.forEach(function (ln) { if (ln.stops.indexOf(abbr) >= 0) n++; });
    return n;
  }

  function initMap() {
    var el = document.getElementById('bart-map');
    if (!el) return;
    var las = [], los = [];
    STATIONS.forEach(function (s) { if (COORDS[s[0]]) { las.push(COORDS[s[0]][0]); los.push(COORDS[s[0]][1]); } });
    BAY.forEach(function (p) { las.push(p[0]); los.push(p[1]); });
    mapBounds = {
      minLa: Math.min.apply(null, las), maxLa: Math.max.apply(null, las),
      minLo: Math.min.apply(null, los), maxLo: Math.max.apply(null, los)
    };
    mapBounds.w = (mapBounds.maxLo - mapBounds.minLo) * Math.cos(37.7 * Math.PI / 180);
    mapBounds.h = mapBounds.maxLa - mapBounds.minLa;

    var out = ['<svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" role="img" aria-label="BART system map" class="bart-svg">'];
    out.push('<defs><filter id="waterBlur" x="-20%" y="-20%" width="140%" height="140%">' +
      '<feGaussianBlur stdDeviation="9"/></filter></defs>');
    var bayPts = BAY.map(function (p) {
      var q = project(p[0], p[1]);
      return q[0].toFixed(1) + ',' + q[1].toFixed(1);
    }).join(' ');
    out.push('<polygon points="' + bayPts + '" class="map-water" filter="url(#waterBlur)"/>');
    // Draw shared corridors as side-by-side bundles: group every segment
    // by the lines that use it, then offset each line perpendicular to the
    // track so overlapping lines all stay visible (station dots hide the
    // joints where the bundle changes).
    var segMap = {};
    LINES.forEach(function (ln, li) {
      for (var i = 0; i < ln.stops.length - 1; i++) {
        var sa = ln.stops[i], sb = ln.stops[i + 1];
        var key = sa < sb ? sa + '|' + sb : sb + '|' + sa;
        if (!segMap[key]) segMap[key] = { a: sa, b: sb, lines: [] };
        if (segMap[key].lines.indexOf(li) < 0) segMap[key].lines.push(li);
      }
    });
    function segPass(spacing, width, casing) {
      var str = '';
      Object.keys(segMap).forEach(function (key) {
        var seg = segMap[key];
        var pa = project(COORDS[seg.a][0], COORDS[seg.a][1]);
        var pb = project(COORDS[seg.b][0], COORDS[seg.b][1]);
        var dx = pb[0] - pa[0], dy = pb[1] - pa[1];
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var px = -dy / len, py = dx / len;
        seg.lines.forEach(function (li, idx) {
          var off = (idx - (seg.lines.length - 1) / 2) * spacing;
          str += '<line x1="' + (pa[0] + px * off).toFixed(1) + '" y1="' + (pa[1] + py * off).toFixed(1) +
            '" x2="' + (pb[0] + px * off).toFixed(1) + '" y2="' + (pb[1] + py * off).toFixed(1) +
            '"' + (casing ? ' class="seg-casing"' : ' stroke="' + LINES[li].color + '" opacity="0.97"') +
            ' stroke-width="' + width + '" stroke-linecap="round"/>';
        });
      });
      return str;
    }
    out.push(segPass(8.5, 9.5, true));  // background casing — separates the stripes
    out.push(segPass(8.5, 6, false));   // the bundled lines
    // Dashed box marking the area the downtown inset magnifies
    var c1 = project(37.838, -122.482), c2 = project(37.686, -122.280);
    out.push('<rect x="' + Math.min(c1[0], c2[0]).toFixed(1) + '" y="' + Math.min(c1[1], c2[1]).toFixed(1) +
      '" width="' + Math.abs(c2[0] - c1[0]).toFixed(1) + '" height="' + Math.abs(c2[1] - c1[1]).toFixed(1) +
      '" rx="14" class="map-inset-box"/>');
    out.push('<text x="' + (Math.min(c1[0], c2[0]) + 12).toFixed(1) + '" y="' + (Math.min(c1[1], c2[1]) + 26).toFixed(1) +
      '" class="map-inset-tag">DETAIL BELOW ↓</text>');
    STATIONS.forEach(function (s) {
      var c = COORDS[s[0]]; if (!c) return;
      var p = project(c[0], c[1]);
      var n = lineCount(s[0]);
      var r = n >= 3 ? 12 : (n === 2 ? 11 : 9);
      out.push('<g class="map-stn" data-abbr="' + s[0] + '">' +
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + r + '" data-r="' + r + '" data-abbr="' + s[0] + '" class="map-dot"/>' +
        '<title>' + esc(s[1]) + '</title></g>');
      if (LABEL_STATIONS[s[0]]) {
        var rightSide = p[0] > MAP_W * 0.7;
        var tx = rightSide ? p[0] - 16 : p[0] + 16;
        out.push('<text x="' + tx.toFixed(1) + '" y="' + (p[1] + 5).toFixed(1) + '" class="map-label"' +
          (rightSide ? ' text-anchor="end"' : '') + '>' + esc(s[1].split('/')[0].trim()) + '</text>');
      }
    });
    out.push('</svg>');
    out.push('<div id="bart-pin" class="bart-pin" hidden>📍</div>');
    el.innerHTML = out.join('');

    Array.prototype.forEach.call(el.querySelectorAll('.map-stn'), function (g) {
      g.addEventListener('click', function () {
        selectStation(g.getAttribute('data-abbr'));
        var board = document.getElementById('bart-board');
        if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    renderInset();
    highlightMarker();
  }

  function highlightMarker() {
    Array.prototype.forEach.call(document.querySelectorAll('.map-dot'), function (c) {
      var base = parseInt(c.getAttribute('data-r') || '10', 10);
      if (c.getAttribute('data-abbr') === currentAbbr) {
        c.setAttribute('r', String(base + 4)); c.classList.add('sel');
      } else {
        c.setAttribute('r', String(base)); c.classList.remove('sel');
      }
    });
  }

  // Magnified schematic strip of the shared trunk: Daly City → West Oakland
  // (west on the left, east on the right — matching the main map).
  // Stations evenly spaced so the downtown cluster is easy to read and tap.
  function renderInset() {
    var el = document.getElementById('bart-inset');
    if (!el) return;
    var stops = ['DALY', 'BALB', 'GLEN', '24TH', '16TH', 'CIVC', 'POWL', 'MONT', 'EMBR', 'WOAK'];
    var bundle = ['#f5c400', '#ed1c24', '#009e49', '#0099cc'];
    var W = 1000, CY = 104, X0 = 62, X1 = 938;
    var out = ['<svg viewBox="0 0 1000 208" role="img" aria-label="Downtown trunk detail" class="bart-svg">'];
    bundle.forEach(function (col, i) {
      var y = CY + (i - 1.5) * 8.5;
      out.push('<line x1="' + (X0 - 26) + '" y1="' + y.toFixed(1) + '" x2="' + (X1 + 26) + '" y2="' + y.toFixed(1) +
        '" stroke="' + col + '" stroke-width="6" stroke-linecap="round" opacity="0.97"/>');
    });
    stops.forEach(function (abbr, i) {
      var x = X0 + (X1 - X0) * i / (stops.length - 1);
      var above = i % 2 === 0;
      var anchor = i === 0 ? 'start' : (i === stops.length - 1 ? 'end' : 'middle');
      var name = stName(abbr).split('/')[0].trim();
      out.push('<g class="map-stn" data-abbr="' + abbr + '">' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + CY + '" r="11" data-r="11" data-abbr="' + abbr + '" class="map-dot"/>' +
        '<title>' + esc(stName(abbr)) + '</title></g>');
      out.push('<line x1="' + x.toFixed(1) + '" y1="' + (above ? CY - 14 : CY + 14) + '" x2="' + x.toFixed(1) +
        '" y2="' + (above ? CY - 30 : CY + 30) + '" stroke="var(--color-text-muted)" stroke-width="2" opacity="0.5"/>');
      out.push('<text x="' + x.toFixed(1) + '" y="' + (above ? CY - 40 : CY + 56) + '" text-anchor="' + anchor +
        '" class="map-label">' + esc(name) + '</text>');
    });
    out.push('</svg>');
    el.innerHTML = out.join('');
    Array.prototype.forEach.call(el.querySelectorAll('.map-stn'), function (g) {
      g.addEventListener('click', function () {
        selectStation(g.getAttribute('data-abbr'));
        var board = document.getElementById('bart-board');
        if (board) board.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // Place a % positioned pin over the SVG map for a lat/lng (address finder)
  function dropPin(la, lo) {
    var pin = document.getElementById('bart-pin');
    var wrap = document.getElementById('bart-map');
    if (!pin || !wrap || !mapBounds) return;
    var p = project(la, lo);
    pin.style.left = (p[0] / MAP_W * 100) + '%';
    pin.style.top = (p[1] / MAP_H * 100) + '%';
    pin.hidden = false;
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
        dropPin(la, lo);
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
