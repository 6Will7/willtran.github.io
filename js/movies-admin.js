/* Movies admin: list, edit, and delete logged movie reviews.
   Same shared admin token as the other admin pages (pre-filled from the portal). */
(function () {
  'use strict';
  var WORKER_URL = 'https://willtran-stocks-proxy.willtran98.workers.dev';
  var IMG = 'https://image.tmdb.org/t/p/';
  var tokenEl = document.getElementById('mv-admin-token');
  var loadBtn = document.getElementById('mv-admin-load');
  var msgEl = document.getElementById('mv-admin-msg');
  var listEl = document.getElementById('mv-admin-list');
  var filterRow = document.getElementById('mv-admin-filter-row');
  var filterEl = document.getElementById('mv-admin-filter');
  var allLogs = [];

  try { tokenEl.value = sessionStorage.getItem('movies_admin') || ''; } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(ts) {
    try {
      return new Date(ts * 1000).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch (e) { return ''; }
  }

  function token() { return tokenEl.value.trim(); }

  function api(body) {
    return fetch(WORKER_URL + '/movies/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function stars(r) {
    var full = Math.floor(r), half = (r - full) >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + ' (' + r.toFixed(1) + ')';
  }

  function ratingOptions(sel) {
    var html = '';
    for (var v = 0.5; v <= 5; v += 0.5) {
      html += '<option value="' + v.toFixed(1) + '"' + (v === sel ? ' selected' : '') + '>' + v.toFixed(1) + ' ★</option>';
    }
    return html;
  }

  function render() {
    var name = filterEl.value || '';
    var logs = name ? allLogs.filter(function (l) { return l.name === name; }) : allLogs;
    if (!logs.length) {
      listEl.innerHTML = '<p class="rest-sub">' +
        (allLogs.length ? 'No reviews from this friend.' : 'No reviews logged yet.') + '</p>';
      return;
    }
    listEl.innerHTML = '';
    logs.forEach(function (l) {
      var div = document.createElement('div');
      div.className = 'mv-admin-item';
      div.setAttribute('data-id', l.id);
      var ph = l.poster
        ? '<img src="' + IMG + 'w92' + esc(l.poster) + '" alt="" loading="lazy">'
        : '';
      div.innerHTML =
        '<div class="poster">' + ph + '</div>' +
        '<div class="body">' +
          '<h4>' + esc(l.title) + (l.year ? ' (' + esc(l.year) + ')' : '') + '</h4>' +
          '<div class="meta">' + esc(l.name) + ' · <span class="stars">' + esc(stars(l.rating)) + '</span>' +
            (l.watched_at ? ' · watched ' + esc(l.watched_at) : '') + ' · logged ' + esc(fmtDate(l.created_at)) + '</div>' +
          (l.review ? '<p class="review">' + esc(l.review) + '</p>' : '<p class="review"><em>No review text.</em></p>') +
          '<div class="mv-admin-actions">' +
            '<button class="btn-edit" data-action="edit">Edit</button>' +
            '<button class="btn-delete" data-action="delete">Delete</button>' +
          '</div>' +
        '</div>';
      listEl.appendChild(div);
    });
    listEl.querySelectorAll('[data-action="edit"]').forEach(function (b) {
      b.addEventListener('click', function () { startEdit(b.closest('.mv-admin-item')); });
    });
    listEl.querySelectorAll('[data-action="delete"]').forEach(function (b) {
      b.addEventListener('click', function () { removeLog(b.closest('.mv-admin-item')); });
    });
  }

  function startEdit(item) {
    var id = parseInt(item.getAttribute('data-id'), 10);
    var log = null;
    allLogs.forEach(function (l) { if (l.id === id) log = l; });
    if (!log) return;
    var body = item.querySelector('.body');
    var oldActions = item.querySelector('.mv-admin-actions');
    if (oldActions) oldActions.remove();
    var form = document.createElement('div');
    form.innerHTML =
      '<select class="mv-edit-rating" aria-label="Rating">' + ratingOptions(log.rating) + '</select>' +
      '<textarea class="mv-editbox" rows="4" aria-label="Review text">' + esc(log.review || '') + '</textarea>' +
      '<div class="mv-admin-actions">' +
        '<button class="btn-save" data-action="save">Save</button>' +
        '<button class="btn-edit" data-action="cancel">Cancel</button>' +
      '</div>';
    body.appendChild(form);
    form.querySelector('[data-action="cancel"]').addEventListener('click', render);
    form.querySelector('[data-action="save"]').addEventListener('click', function () {
      var rating = form.querySelector('.mv-edit-rating').value;
      var review = form.querySelector('.mv-editbox').value;
      msgEl.textContent = 'Saving…';
      api({ token: token(), action: 'edit', id: id, rating: rating, review: review })
        .then(function (res) {
          if (!res.ok) { msgEl.textContent = (res.j && res.j.error) || 'Save failed.'; return; }
          log.rating = parseFloat(rating);
          log.review = review;
          msgEl.textContent = 'Saved.';
          render();
        })
        .catch(function () { msgEl.textContent = 'Could not reach the server.'; });
    });
  }

  function removeLog(item) {
    var id = parseInt(item.getAttribute('data-id'), 10);
    var log = null;
    allLogs.forEach(function (l) { if (l.id === id) log = l; });
    if (!log) return;
    if (!window.confirm('Delete ' + log.name + '’s review of "' + log.title + '"? This cannot be undone.')) return;
    msgEl.textContent = 'Deleting…';
    api({ token: token(), action: 'delete', id: id })
      .then(function (res) {
        if (!res.ok) { msgEl.textContent = (res.j && res.j.error) || 'Delete failed.'; return; }
        allLogs = allLogs.filter(function (l) { return l.id !== id; });
        msgEl.textContent = 'Deleted.';
        render();
      })
      .catch(function () { msgEl.textContent = 'Could not reach the server.'; });
  }

  function load() {
    var t = token();
    if (!t) { msgEl.textContent = 'Enter your admin token.'; tokenEl.focus(); return; }
    try { sessionStorage.setItem('movies_admin', t); } catch (e) {}
    msgEl.textContent = 'Loading…';
    listEl.innerHTML = '';
    api({ token: t, action: 'list' })
      .then(function (res) {
        if (!res.ok) {
          msgEl.textContent = res.j && res.j.error === 'unauthorized' ? 'Wrong token — try again.' : ((res.j && res.j.error) || 'Load failed.');
          return;
        }
        allLogs = res.j.logs || [];
        var names = [];
        allLogs.forEach(function (l) { if (names.indexOf(l.name) < 0) names.push(l.name); });
        names.sort();
        filterEl.innerHTML = '<option value="">All friends (' + allLogs.length + ')</option>' +
          names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
        filterRow.hidden = false;
        msgEl.textContent = allLogs.length ? '' : 'No reviews logged yet.';
        render();
      })
      .catch(function () { msgEl.textContent = 'Could not reach the server — check your connection.'; });
  }

  loadBtn.addEventListener('click', load);
  tokenEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
  filterEl.addEventListener('change', render);
  if (token()) load();
})();
