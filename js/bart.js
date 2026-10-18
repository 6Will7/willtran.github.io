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
    ['WARM', 'Warm Springs / South Fremont'], ['WDUB', 'West Dublin / Pleasanton'],
    ['WOAK', 'West Oakland']
  ];

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
  try {
    var last = localStorage.getItem('bart_last');
    if (last) selectStation(last);
  } catch (e) {}
})();
