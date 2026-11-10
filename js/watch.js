/* What to Watch — popular movies by streaming service (TMDB discover). */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var IMG = 'https://image.tmdb.org/t/p/';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cardEl(m) {
    var d = document.createElement('div');
    d.className = 'mv-card';
    var ph = m.poster
      ? '<img src="' + IMG + 'w342' + esc(m.poster) + '" alt="' + esc(m.title) + ' poster" loading="lazy">'
      : '<div class="no-poster">No poster</div>';
    var meta = esc(m.year || '') + (m.vote ? ' · ★ ' + m.vote : '');
    d.innerHTML = '<div class="poster">' + ph + '</div>' +
      '<h4>' + esc(m.title) + '</h4>' +
      '<div class="meta">' + meta + '</div>';
    return d;
  }
  function movieCard(m) {
    var d = cardEl(m);
    d.addEventListener('click', function () {
      window.location.href = '/movies/?movie=' + m.id;
    });
    return d;
  }
  function loadService(provider, sectionId) {
    var grid = document.querySelector('#' + sectionId + ' .watch-grid');
    fetch(WORKER_URL + '/tmdb/discover?provider=' + provider)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        grid.innerHTML = '';
        var list = ((j && j.results) || []).slice(0, 12);
        if (!list.length) {
          grid.innerHTML = '<p class="mv-empty">Nothing loaded — try again later.</p>';
          return;
        }
        list.forEach(function (m) { grid.appendChild(movieCard(m)); });
      })
      .catch(function () {
        grid.innerHTML = '<p class="mv-empty">Couldn’t load this service — try again later.</p>';
      });
  }

  loadService('netflix', 'ws-netflix');
  loadService('prime', 'ws-prime');
  loadService('max', 'ws-max');

  // Hulu: exactly one entry, by request — Family Guy (TMDB TV 1434).
  var huluGrid = document.querySelector('#ws-hulu .watch-grid');
  function familyGuyCard(show) {
    var d = cardEl(show || { title: 'Family Guy', year: '1999', poster: null, vote: null });
    d.addEventListener('click', function () {
      window.open('https://www.themoviedb.org/tv/1434-family-guy', '_blank', 'noopener');
    });
    return d;
  }
  fetch(WORKER_URL + '/tmdb/tv?id=1434')
    .then(function (r) { return r.json(); })
    .then(function (j) { huluGrid.appendChild(familyGuyCard(j && j.show)); })
    .catch(function () { huluGrid.appendChild(familyGuyCard(null)); });
})();
