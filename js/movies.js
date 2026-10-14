/* Movies — Letterboxd-lite for friends. Unlisted pages; display names only. */
(function () {
  'use strict';

  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var IMG = 'https://image.tmdb.org/t/p/';

  var nameEl = document.getElementById('mv-name');
  var nameSave = document.getElementById('mv-name-save');

  function myName() {
    try { return (localStorage.getItem('movies_name') || '').trim(); } catch (e) { return ''; }
  }
  function setNameUI() { nameEl.value = myName(); }
  setNameUI();
  nameSave.addEventListener('click', function () {
    var v = nameEl.value.trim().slice(0, 30);
    if (!v) return;
    try { localStorage.setItem('movies_name', v); } catch (e) {}
    setNameUI();
    renderDiaryTab();
    renderWatchlistTab();
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function poster(p, size) {
    if (!p) return '';
    return IMG + (size || 'w342') + p;
  }
  // 4.5 -> "★★★★½", 3 -> "★★★"
  function stars(r) {
    if (r == null) return '';
    var full = Math.floor(r), half = (r - full) >= 0.5 ? '½' : '';
    return '★'.repeat(full) + half;
  }
  function fmtDate(ts) {
    try {
      return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return ''; }
  }

  /* ---------- Tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.mv-tab'));
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      var id = t.getAttribute('data-tab');
      ['discover', 'feed', 'diary', 'watchlist'].forEach(function (k) {
        document.getElementById('mv-tab-' + k).hidden = (k !== id);
      });
      if (id === 'feed') renderFeed();
      if (id === 'diary') renderDiaryTab();
      if (id === 'watchlist') renderWatchlistTab();
    });
  });

  /* ---------- Movie cards ---------- */
  function cardEl(m, extra) {
    var d = document.createElement('div');
    d.className = 'mv-card' + (extra ? ' ' + extra : '');
    var ph = m.poster
      ? '<img src="' + poster(m.poster) + '" alt="" loading="lazy">'
      : '<div class="no-poster">No poster</div>';
    d.innerHTML = '<div class="poster">' + ph + '</div>' +
      '<h4>' + esc(m.title) + '</h4>' +
      '<div class="meta">' + esc(m.year || '') + '</div>';
    d.addEventListener('click', function () { openMovie(m.id || m.tmdb_id); });
    return d;
  }

  /* ---------- Discover ---------- */
  var searchEl = document.getElementById('mv-search');
  var resultsEl = document.getElementById('mv-results');
  var trendingEl = document.getElementById('mv-trending');

  function doSearch() {
    var q = searchEl.value.trim();
    if (!q) return;
    resultsEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    fetch(WORKER_URL + '/tmdb/search?query=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        resultsEl.innerHTML = '';
        var list = (j && j.results) || [];
        if (!list.length) { resultsEl.innerHTML = '<p class="mv-empty">No movies found.</p>'; return; }
        var h = document.createElement('h3');
        h.textContent = 'Results';
        resultsEl.appendChild(h);
        var g = document.createElement('div');
        g.className = 'mv-grid';
        list.forEach(function (m) { g.appendChild(cardEl(m)); });
        resultsEl.appendChild(g);
      })
      .catch(function () { resultsEl.innerHTML = '<p class="mv-empty">Search failed — try again.</p>'; });
  }
  document.getElementById('mv-search-btn').addEventListener('click', doSearch);
  searchEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

  fetch(WORKER_URL + '/tmdb/trending')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      trendingEl.innerHTML = '';
      ((j && j.results) || []).slice(0, 12).forEach(function (m) {
        trendingEl.appendChild(cardEl(m));
      });
    })
    .catch(function () { trendingEl.innerHTML = '<p class="mv-empty">Could not load trending.</p>'; });

  /* ---------- Feed ---------- */
  var feedEl = document.getElementById('mv-feed');
  function renderFeed() {
    feedEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    fetch(WORKER_URL + '/movies/feed?limit=40')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        feedEl.innerHTML = '';
        var logs = (j && j.logs) || [];
        if (!logs.length) { feedEl.innerHTML = '<p class="mv-empty">Nothing logged yet — be the first.</p>'; return; }
        logs.forEach(function (l) {
          var d = document.createElement('div');
          d.className = 'mv-feed-item';
          var ph = l.poster
            ? '<img src="' + poster(l.poster, 'w185') + '" alt="" loading="lazy">'
            : '';
          d.innerHTML = '<div class="poster">' + ph + '</div>' +
            '<div class="mv-feed-body">' +
            '<span class="who">' + esc(l.name) + '</span> ' +
            '<span class="mv-stars">' + stars(l.rating) + '</span>' +
            '<div class="what"><a href="#" data-movie="' + l.tmdb_id + '">' + esc(l.title) + '</a>' +
            (l.year ? ' <span class="meta">(' + esc(l.year) + ')</span>' : '') + '</div>' +
            (l.review ? '<div class="review">' + esc(l.review) + '</div>' : '') +
            '<div class="when">' + fmtDate(l.created_at) +
            (l.watched_at ? ' · watched ' + esc(l.watched_at) : '') + '</div>' +
            '</div>';
          feedEl.appendChild(d);
        });
        feedEl.querySelectorAll('[data-movie]').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            openMovie(parseInt(a.getAttribute('data-movie'), 10));
          });
        });
      })
      .catch(function () { feedEl.innerHTML = '<p class="mv-empty">Could not load the feed.</p>'; });
  }

  /* ---------- Diary ---------- */
  var friendsEl = document.getElementById('mv-friends');
  var diaryEl = document.getElementById('mv-diary');
  var diaryName = null; // null = me

  function renderDiaryTab() {
    var me = myName();
    diaryName = diaryName || me;
    friendsEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    diaryEl.innerHTML = '';
    fetch(WORKER_URL + '/movies/users')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        friendsEl.innerHTML = '';
        var users = (j && j.users) || [];
        if (!users.length) {
          friendsEl.innerHTML = '<p class="mv-empty">No diaries yet.</p>';
          return;
        }
        // "Me" chip first if I have a name
        var names = users.map(function (u) { return u.name; });
        if (me && names.indexOf(me) < 0) names.unshift(me);
        names.forEach(function (n) {
          var u = users.filter(function (x) { return x.name === n; })[0] || { name: n, logs: 0 };
          var b = document.createElement('button');
          b.className = 'mv-friend' + ((diaryName || me) === n ? ' active' : '');
          b.innerHTML = esc(n) + ' <span class="n">' + u.logs + '</span>';
          b.addEventListener('click', function () { diaryName = n; renderDiaryTab(); });
          friendsEl.appendChild(b);
        });
        loadDiary(diaryName || me);
      })
      .catch(function () { friendsEl.innerHTML = '<p class="mv-empty">Could not load friends.</p>'; });
  }

  function loadDiary(name) {
    if (!name) { diaryEl.innerHTML = '<p class="mv-empty">Enter your name above to start your diary.</p>'; return; }
    diaryEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    fetch(WORKER_URL + '/movies/diary?name=' + encodeURIComponent(name))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        diaryEl.innerHTML = '';
        var logs = (j && j.logs) || [];
        if (!logs.length) { diaryEl.innerHTML = '<p class="mv-empty">No films logged yet.</p>'; return; }
        logs.forEach(function (l) {
          var c = cardEl({ id: l.tmdb_id, title: l.title, poster: l.poster, year: l.year }, 'mv-diary-card');
          var s = document.createElement('div');
          s.className = 'mv-stars';
          s.textContent = stars(l.rating);
          c.appendChild(s);
          if (name === myName()) {
            var u = document.createElement('button');
            u.className = 'mv-unlog';
            u.textContent = 'remove';
            u.addEventListener('click', function (e) {
              e.stopPropagation();
              if (!confirm('Remove "' + l.title + '" from your diary?')) return;
              fetch(WORKER_URL + '/movies/unlog', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, tmdb_id: l.tmdb_id })
              }).then(function () { loadDiary(name); });
            });
            c.appendChild(u);
          }
          diaryEl.appendChild(c);
        });
      })
      .catch(function () { diaryEl.innerHTML = '<p class="mv-empty">Could not load diary.</p>'; });
  }

  /* ---------- Watchlist ---------- */
  var watchEl = document.getElementById('mv-watchlist');
  function renderWatchlistTab() {
    var me = myName();
    if (!me) { watchEl.innerHTML = '<p class="mv-empty">Enter your name above to see your watchlist.</p>'; return; }
    watchEl.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    fetch(WORKER_URL + '/movies/get-watchlist?name=' + encodeURIComponent(me))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        watchEl.innerHTML = '';
        var items = (j && j.items) || [];
        if (!items.length) { watchEl.innerHTML = '<p class="mv-empty">Your watchlist is empty — tap + Watchlist on any movie.</p>'; return; }
        items.forEach(function (it) {
          var c = cardEl({ id: it.tmdb_id, title: it.title, poster: it.poster });
          var u = document.createElement('button');
          u.className = 'mv-unlog';
          u.textContent = 'remove';
          u.addEventListener('click', function (e) {
            e.stopPropagation();
            fetch(WORKER_URL + '/movies/unwatch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: me, tmdb_id: it.tmdb_id })
            }).then(function () { renderWatchlistTab(); });
          });
          c.appendChild(u);
          watchEl.appendChild(c);
        });
      })
      .catch(function () { watchEl.innerHTML = '<p class="mv-empty">Could not load watchlist.</p>'; });
  }

  /* ---------- Movie modal ---------- */
  var modal = document.getElementById('mv-modal');
  var modalBody = document.getElementById('mv-modal-body');
  var currentMovie = null;
  var currentRating = 0;

  document.getElementById('mv-modal-close').addEventListener('click', function () {
    modal.hidden = true;
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal) modal.hidden = true;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) modal.hidden = true;
  });

  function openMovie(id) {
    modal.hidden = false;
    modalBody.innerHTML = '<div class="loader-center"><div class="spinner"></div></div>';
    Promise.all([
      fetch(WORKER_URL + '/tmdb/movie?id=' + id).then(function (r) { return r.json(); }),
      fetch(WORKER_URL + '/movies/movie-users?tmdb_id=' + id).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (res) {
      var m = res[0] && res[0].movie;
      if (!m) { modalBody.innerHTML = '<p class="mv-empty">Movie not found.</p>'; return; }
      currentMovie = m;
      currentRating = 0;
      renderModal(m, (res[1] && res[1].logs) || []);
    }).catch(function () {
      modalBody.innerHTML = '<p class="mv-empty">Could not load movie.</p>';
    });
  }

  function renderModal(m, friendLogs) {
    var me = myName();
    var mine = friendLogs.filter(function (l) { return l.name === me; })[0];
    var others = friendLogs.filter(function (l) { return l.name !== me; });
    if (mine) currentRating = mine.rating;

    var ph = m.poster
      ? '<img src="' + poster(m.poster, 'w342') + '" alt="">'
      : '<div class="no-poster">No poster</div>';
    var html = '<div class="mv-modal-hero">' +
      '<div class="poster">' + ph + '</div>' +
      '<div><h3>' + esc(m.title) + '</h3>' +
      '<div class="meta">' + esc([m.year, m.runtime ? m.runtime + ' min' : null,
        (m.genres || []).join(', ')].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="overview">' + esc(m.overview || 'No synopsis.') + '</div></div>' +
      '</div>';

    if (others.length) {
      html += '<div class="mv-friends-ratings"><strong>Friends:</strong>' +
        others.map(function (l) {
          return '<div class="fr">' + esc(l.name) + ' <span class="mv-stars">' + stars(l.rating) + '</span>' +
            (l.review ? ' — ' + esc(l.review.slice(0, 140)) : '') + '</div>';
        }).join('') + '</div>';
    }

    html += '<div class="mv-logform"><h4>' + (mine ? 'Your log' : 'Log this movie') + '</h4>' +
      '<div class="mv-star-row" id="mv-stars"></div>' +
      '<div class="mv-hint">Tap a star to rate — tap the same star again for a half star.</div>' +
      '<input type="date" id="mv-date" value="' + (mine ? esc(mine.watched_at || '') : new Date().toISOString().slice(0, 10)) + '" aria-label="Date watched">' +
      '<textarea id="mv-review" placeholder="Your review (optional)" maxlength="2000">' +
      (mine ? esc(mine.review || '') : '') + '</textarea>' +
      '<div class="row">' +
      '<button id="mv-save" class="btn btn-primary">Save to diary</button>' +
      '<button id="mv-watch" class="btn">+ Watchlist</button>' +
      '</div><p class="mv-msg" id="mv-msg"></p></div>';

    modalBody.innerHTML = html;

    // Star widget
    var starRow = document.getElementById('mv-stars');
    function paintStars() {
      starRow.innerHTML = '';
      for (var i = 1; i <= 5; i++) {
        (function (i) {
          var b = document.createElement('button');
          b.className = 'mv-star';
          b.textContent = '★';
          b.setAttribute('aria-label', i + ' stars');
          if (currentRating >= i) b.classList.add('lit');
          else if (currentRating === i - 0.5) b.classList.add('half');
          b.addEventListener('click', function () {
            if (currentRating === i) currentRating = i - 0.5;
            else currentRating = i;
            paintStars();
          });
          starRow.appendChild(b);
        })(i);
      }
    }
    paintStars();

    var msgEl = document.getElementById('mv-msg');
    document.getElementById('mv-save').addEventListener('click', function () {
      if (!me) { msgEl.textContent = 'Enter your name at the top first.'; return; }
      if (!currentRating) { msgEl.textContent = 'Pick a star rating first.'; return; }
      msgEl.textContent = 'Saving…';
      fetch(WORKER_URL + '/movies/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: me,
          tmdb_id: m.id,
          title: m.title,
          poster: m.poster || '',
          year: m.year || '',
          rating: currentRating,
          review: document.getElementById('mv-review').value.trim(),
          watched_at: document.getElementById('mv-date').value
        })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        msgEl.textContent = (res.ok && res.j.ok) ? 'Saved ✓' : ((res.j && res.j.error) || 'Save failed.');
      })
      .catch(function () { msgEl.textContent = 'Save failed.'; });
    });

    document.getElementById('mv-watch').addEventListener('click', function () {
      if (!me) { msgEl.textContent = 'Enter your name at the top first.'; return; }
      fetch(WORKER_URL + '/movies/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: me, tmdb_id: m.id, title: m.title, poster: m.poster || '' })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        msgEl.textContent = (res.ok && res.j.ok) ? 'Added to your watchlist ✓' : 'Already on your watchlist.';
      })
      .catch(function () { msgEl.textContent = 'Failed.'; });
    });
  }
})();
